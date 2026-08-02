// Llamadas a las APIs de origen de cada modelo.
// Todas las funciones de imagen devuelven [{ buffer, mime }].

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TIMEOUT_MS = 300000; // la generación en 4K puede tardar varios minutos

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/png';
}

// Las refs pueden ser rutas de archivo o data URLs (copias etiquetadas al vuelo).
async function readAsBase64(filePath) {
  if (filePath.startsWith('data:')) {
    const [head, data] = filePath.split(',');
    return { base64: data, mime: head.slice(5).split(';')[0] || 'image/png' };
  }
  const buf = await readFile(filePath);
  return { base64: buf.toString('base64'), mime: mimeFor(filePath) };
}

async function readAsDataUrl(filePath) {
  if (filePath.startsWith('data:')) return filePath;
  const { base64, mime } = await readAsBase64(filePath);
  return `data:${mime};base64,${base64}`;
}

function sniffMime(buf) {
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/png';
}

async function apiFetch(url, options, label) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error(`${label}: la petición superó los ${TIMEOUT_MS / 1000}s`);
    throw new Error(`${label}: error de red — ${err.message}`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      detail = text.slice(0, 600);
    } catch {}
    throw new Error(`${label}: HTTP ${res.status} — ${detail}`);
  }
  return res;
}

async function downloadImage(url, label) {
  if (url.startsWith('data:')) {
    const [head, data] = url.split(',');
    const mime = head.slice(5).split(';')[0] || 'image/png';
    return { buffer: Buffer.from(data, 'base64'), mime };
  }
  const res = await apiFetch(url, {}, `${label} (descarga)`);
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
  return { buffer: Buffer.from(await res.arrayBuffer()), mime };
}

// ---------------------------------------------------------------------------
// Google Gemini (familia Nano Banana)
// ---------------------------------------------------------------------------

export async function generateGemini({ apiKey, apiModel, prompt, preface, refPaths, aspectRatio, resolution, supportsSize }) {
  if (!apiKey) throw new Error('Falta la API key de Gemini (Google AI Studio). Cargala en Configuración.');
  const parts = [];
  // la nota sobre las etiquetas va ANTES de las imágenes: así el modelo las
  // interpreta como pruebas anotadas al momento de mirarlas
  if (preface) parts.push({ text: preface });
  for (const ref of refPaths) {
    const { base64, mime } = await readAsBase64(ref);
    parts.push({ inline_data: { mime_type: mime, data: base64 } });
  }
  parts.push({ text: prompt });

  const imageConfig = {};
  if (aspectRatio && aspectRatio !== 'auto') imageConfig.aspectRatio = aspectRatio;
  if (supportsSize && resolution && resolution !== 'auto' && resolution !== '1K') imageConfig.imageSize = resolution;

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {})
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent`;
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, `Gemini ${apiModel}`);

  const json = await res.json();
  const outParts = json?.candidates?.[0]?.content?.parts || [];
  const images = outParts
    .filter((p) => p.inlineData?.data || p.inline_data?.data)
    .map((p) => {
      const d = p.inlineData || p.inline_data;
      return { buffer: Buffer.from(d.data, 'base64'), mime: d.mimeType || d.mime_type || 'image/png' };
    });
  if (!images.length) {
    const finish = json?.candidates?.[0]?.finishReason || '';
    const text = outParts.find((p) => p.text)?.text || '';
    const block = json?.promptFeedback?.blockReason || '';
    throw new Error(`Gemini no devolvió imagen${finish ? ` (finishReason: ${finish})` : ''}${block ? ` (bloqueo: ${block})` : ''}${text ? ` — ${text.slice(0, 300)}` : ''}`);
  }
  return images;
}

// Convierte una imagen de referencia en una direccion artistica reutilizable.
// El analisis excluye deliberadamente sujetos y contenido de escena.
export async function analyzeArtStyle({ apiKey, imagePath, apiModel = 'gemini-3.5-flash' }) {
  if (!apiKey) throw new Error('Falta la API key de Gemini (Google AI Studio). Cargala en Configuracion.');
  const { base64, mime } = await readAsBase64(imagePath);
  const instruction = `Analyze only the reusable visual style of the attached image and write one production-ready English prompt for an image-generation model.

Describe, when visually supported: the overall aesthetic, artistic movement or tradition, medium and physical support, photographic or cinematographic technique, camera and lens character, depth of field, composition language, lighting, palette and contrast, texture, grain, brushwork or rendering method, finishing, post-processing and period feel.

Ignore and do not mention the subject, identity, people, clothing, objects, location, actions, scene content, readable text, logos or the specific composition. Do not instruct the model to recreate the depicted scene. The result must describe style only and remain useful for unrelated subjects.

Return only the English style prompt as one compact paragraph. No title, markdown, labels, explanation or preamble.`;
  const body = {
    contents: [{ parts: [
      { text: instruction },
      { inline_data: { mime_type: mime, data: base64 } }
    ] }],
    generationConfig: {
      responseModalities: ['TEXT'],
      temperature: 0.25,
      maxOutputTokens: 700
    }
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent`;
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, `Gemini ${apiModel} (analisis de estilo)`);
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || '').join('\n').trim();
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || '';
    throw new Error(`Gemini no devolvio un analisis de estilo${reason ? ` (${reason})` : ''}.`);
  }
  return { text, model: apiModel };
}

// ---------------------------------------------------------------------------
// BytePlus ModelArk (Seedream)
// ---------------------------------------------------------------------------

// Seedream 5.0 exige un área mínima de 3.686.400 px (~1920x1920).
const SEEDREAM_MIN_AREA = 3686400;

function seedreamSize(aspectRatio, resolution) {
  const areas = { '1K': 2048 * 2048, '2K': 2048 * 2048, '4K': 4096 * 4096 };
  const area = Math.max(areas[resolution] || areas['2K'], SEEDREAM_MIN_AREA);
  let [w, h] = (aspectRatio || '1:1').split(':').map(Number);
  if (!w || !h) [w, h] = [1, 1];
  const scale = Math.sqrt(area / (w * h));
  const round8 = (n) => Math.min(4096, Math.round((n * scale) / 8) * 8);
  let W = round8(w);
  let H = round8(h);
  // si el recorte a 4096 o el redondeo dejó el área por debajo del mínimo, compensar el otro lado
  if (W * H < SEEDREAM_MIN_AREA) {
    if (W >= H) H = Math.min(4096, Math.ceil(SEEDREAM_MIN_AREA / W / 8) * 8);
    else W = Math.min(4096, Math.ceil(SEEDREAM_MIN_AREA / H / 8) * 8);
  }
  return `${W}x${H}`;
}

export async function generateSeedream({ apiKey, apiModel, endpoint, prompt, preface, refPaths, aspectRatio, resolution }) {
  if (!apiKey) throw new Error('Falta la API key de BytePlus ModelArk (Ark). Cargala en Configuración.');
  const base = (endpoint || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
  const body = {
    model: apiModel,
    prompt: preface ? `${preface}\n\n${prompt}` : prompt,
    size: seedreamSize(aspectRatio, resolution),
    response_format: 'b64_json',
    watermark: false
  };
  if (refPaths.length === 1) body.image = await readAsDataUrl(refPaths[0]);
  else if (refPaths.length > 1) body.image = await Promise.all(refPaths.map(readAsDataUrl));

  const res = await apiFetch(`${base}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, `Seedream ${apiModel}`);

  const json = await res.json();
  const items = json?.data || [];
  const images = [];
  for (const item of items) {
    if (item.b64_json) {
      const buffer = Buffer.from(item.b64_json, 'base64');
      images.push({ buffer, mime: sniffMime(buffer) });
    } else if (item.url) {
      images.push(await downloadImage(item.url, 'Seedream'));
    }
  }
  if (!images.length) throw new Error(`Seedream no devolvió imágenes — ${JSON.stringify(json).slice(0, 400)}`);
  return images;
}

// ---------------------------------------------------------------------------
// OpenAI GPT Image 2
// ---------------------------------------------------------------------------

// La API acepta cualquier tamaño en píxeles con estas reglas: bordes múltiplos
// de 16, borde máximo 3840, área entre 655.360 y 8.294.400 px y ratio ≤ 3:1.
// Acá se traduce la convención 1K/2K/4K de la app a un WxH válido por ratio.
function gptImageSize(aspectRatio, resolution) {
  const [a, b] = (aspectRatio && aspectRatio !== 'auto' ? aspectRatio : '1:1').split(':').map(Number);
  const MIN_AREA = 655360;
  const MAX_AREA = 8294400;
  const MAX_EDGE = 3840;
  const targetArea = resolution === '4K' ? MAX_AREA : resolution === '2K' ? 4194304 : 1048576;
  const snap = (v) => Math.round(v / 16) * 16;
  let w = Math.sqrt((targetArea * a) / b);
  const scale = Math.min(1, MAX_EDGE / Math.max(w, (w * b) / a));
  w = snap(w * scale);
  let h = snap((w * b) / a);
  while (w * h < MIN_AREA) { w += 16; h = snap((w * b) / a); }
  while (w * h > MAX_AREA || w > MAX_EDGE || h > MAX_EDGE) { w -= 16; h = snap((w * b) / a); }
  return `${w}x${h}`;
}

export async function generateOpenAIImage({ apiKey, apiModel, prompt: userPrompt, preface, refPaths, aspectRatio, resolution }) {
  if (!apiKey) throw new Error('Falta la API key de OpenAI. Cargala en Configuración.');
  const prompt = preface ? `${preface}\n\n${userPrompt}` : userPrompt;
  const size = gptImageSize(aspectRatio, resolution);
  // 1K con calidad media (mucho más barata); 2K/4K con calidad alta
  const quality = resolution === '2K' || resolution === '4K' ? 'high' : 'medium';

  let res;
  if (refPaths.length) {
    // con referencias se usa el endpoint de edición, que las recibe como archivos
    const form = new FormData();
    form.append('model', apiModel);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('moderation', 'low');
    for (const [index, ref] of refPaths.entries()) {
      const { base64, mime } = await readAsBase64(ref);
      form.append('image[]', new Blob([Buffer.from(base64, 'base64')], { type: mime }), `ref-${index + 1}${ref.startsWith('data:') ? '.jpg' : (path.extname(ref) || '.png')}`);
    }
    res = await apiFetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    }, `OpenAI ${apiModel} (edits)`);
  } else {
    res = await apiFetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: apiModel, prompt, size, quality, moderation: 'low', n: 1 })
    }, `OpenAI ${apiModel}`);
  }

  const json = await res.json();
  const images = (json.data || []).filter((d) => d.b64_json).map((d) => {
    const buffer = Buffer.from(d.b64_json, 'base64');
    return { buffer, mime: sniffMime(buffer) };
  });
  if (!images.length) throw new Error(`OpenAI no devolvió imágenes — ${JSON.stringify(json).slice(0, 300)}`);
  return images;
}

// ---------------------------------------------------------------------------
// Seedance (video) — BytePlus ModelArk usa tareas asíncronas: se crea la
// tarea, se consulta cada unos segundos y al terminar entrega una URL.
// Los parámetros van como comandos de texto al final del prompt.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateSeedanceVideo({ apiKey, apiModel, endpoint, prompt, refPaths, mode, aspectRatio, resolution, duration, audio }) {
  if (!apiKey) throw new Error('Falta la API key de BytePlus ModelArk (Ark). Cargala en Configuración.');
  const base = (endpoint || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  let text = `${prompt} --ratio ${aspectRatio} --resolution ${resolution} --duration ${duration} --watermark false`;
  if (audio !== null) text += ` --audio ${audio ? 'true' : 'false'}`;
  const content = [{ type: 'text', text }];
  // Las refs "asset://<id>" son rostros verificados de la biblioteca de
  // personas reales de ModelArk: van tal cual, sin leerse como archivo.
  const toUrl = (ref) => (ref.startsWith('asset://') ? ref : readAsDataUrl(ref));
  if (mode === 'frames') {
    // fotograma inicial y final
    if (refPaths[0]) content.push({ type: 'image_url', image_url: { url: await toUrl(refPaths[0]) }, role: 'first_frame' });
    if (refPaths[1]) content.push({ type: 'image_url', image_url: { url: await toUrl(refPaths[1]) }, role: 'last_frame' });
  } else {
    // modo Referencias (estilo Omni): las imágenes se mencionan en el prompt
    // como @image1, @image2… en el orden en que van acá
    for (const refPath of refPaths) {
      content.push({ type: 'image_url', image_url: { url: await toUrl(refPath) }, role: 'reference_image' });
    }
  }

  const created = await apiFetch(`${base}/contents/generations/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: apiModel, content })
  }, `Seedance ${apiModel}`);
  const task = await created.json();
  if (!task?.id) throw new Error(`Seedance no devolvió una tarea — ${JSON.stringify(task).slice(0, 300)}`);

  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    await sleep(5000);
    if (Date.now() > deadline) throw new Error('Seedance tardó más de 15 minutos; la tarea sigue en su consola pero acá la soltamos.');
    const res = await fetch(`${base}/contents/generations/tasks/${task.id}`, { headers, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!res) continue; // corte de red transitorio: reintentamos
    const json = await res.json().catch(() => ({}));
    const status = json.status || '';
    if (status === 'succeeded') {
      const url = json.content?.video_url;
      if (!url) throw new Error(`Seedance terminó sin URL de video — ${JSON.stringify(json).slice(0, 300)}`);
      const dl = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!dl.ok) throw new Error(`No pude descargar el video (HTTP ${dl.status}).`);
      return {
        buffer: Buffer.from(await dl.arrayBuffer()),
        mime: 'video/mp4',
        tokens: json.usage?.completion_tokens || 0
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(json.error?.message || json.failure_reason || `La tarea de Seedance terminó en "${status}".`);
    }
    // queued / running: seguimos esperando
  }
}

// ---------------------------------------------------------------------------
// Suno (música) — proveedor tipo sunoapi.org: se crea la tarea, se pollea
// record-info hasta SUCCESS y se descargan las variantes generadas.
// ---------------------------------------------------------------------------

export async function generateMusic({ apiKey, endpoint, model, prompt, style, title, instrumental, customMode }) {
  if (!apiKey) throw new Error('Falta la API key de Suno. Cargala en Configuración.');
  const base = (endpoint || 'https://api.sunoapi.org').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  const body = { model, customMode: Boolean(customMode), instrumental: Boolean(instrumental) };
  if (customMode) {
    // en modo custom el prompt es la LETRA; estilo y título son obligatorios
    // (salvo instrumental, que no lleva letra)
    body.prompt = instrumental ? '' : String(prompt || '');
    body.style = String(style || '');
    body.title = String(title || '');
    if (!body.style.trim()) throw new Error('En modo custom el estilo/género es obligatorio.');
    if (!body.title.trim()) throw new Error('En modo custom el título es obligatorio.');
  } else {
    // modo simple: el prompt es una descripción de la canción
    body.prompt = String(prompt || '');
    if (!body.prompt.trim()) throw new Error('Escribí una descripción de la canción.');
  }

  const created = await apiFetch(`${base}/api/v1/generate`, {
    method: 'POST', headers, body: JSON.stringify(body)
  }, 'Suno');
  const start = await created.json();
  const taskId = start?.data?.taskId || start?.data?.task_id || start?.taskId;
  if (!taskId) throw new Error(`Suno no devolvió una tarea — ${JSON.stringify(start).slice(0, 300)}`);

  const deadline = Date.now() + 8 * 60 * 1000;
  for (;;) {
    await sleep(6000);
    if (Date.now() > deadline) throw new Error('Suno tardó más de 8 minutos; la tarea sigue en tu proveedor pero acá la soltamos.');
    const res = await fetch(`${base}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, { headers, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!res) continue;
    const json = await res.json().catch(() => ({}));
    const status = String(json?.data?.status || '').toUpperCase();
    if (status.includes('SUCCESS') || status.includes('COMPLETE')) {
      // distintas variantes del wrapper: response.data / response.sunoData / data
      const list = json.data.response?.data || json.data.response?.sunoData || json.data.data || [];
      const tracks = [];
      for (const t of list) {
        const url = t.audio_url || t.audioUrl || t.source_audio_url;
        if (!url) continue;
        const dl = await fetch(url, { signal: AbortSignal.timeout(300000) }).catch(() => null);
        if (!dl || !dl.ok) continue;
        tracks.push({
          buffer: Buffer.from(await dl.arrayBuffer()),
          mime: 'audio/mpeg',
          title: t.title || title || '',
          tags: t.tags || style || '',
          duration: t.duration || null
        });
      }
      if (!tracks.length) throw new Error(`Suno terminó sin audios — ${JSON.stringify(json).slice(0, 300)}`);
      return tracks;
    }
    if (status.includes('FAIL') || status.includes('ERROR') || status.includes('SENSITIVE')) {
      throw new Error(json?.data?.errorMessage || json?.msg || `La tarea de Suno terminó en "${status}".`);
    }
    // PENDING / TEXT_SUCCESS / FIRST_SUCCESS: seguimos esperando
  }
}

// ---------------------------------------------------------------------------
// Prueba de conexión por servicio (sin generar nada ni gastar créditos)
// ---------------------------------------------------------------------------

export async function testService({ service, key, endpoint, seedreamModelId }) {
  if (!key) return { ok: false, detail: 'No hay API key cargada.' };
  const opts = (extra = {}) => ({ signal: AbortSignal.timeout(20000), ...extra });
  const isAuthFail = (s) => s === 401 || s === 403;

  try {
    switch (service) {
      case 'gemini': {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
          opts({ headers: { 'x-goog-api-key': key } }));
        return r.ok
          ? { ok: true, detail: 'Key válida.' }
          : { ok: false, detail: `Key rechazada (HTTP ${r.status}).` };
      }

      case 'googleTranslate': {
        const r = await fetch(`https://translation.googleapis.com/language/translate/v2/languages?target=es&key=${encodeURIComponent(key)}`, opts());
        return r.ok
          ? { ok: true, detail: 'Google Cloud Translation habilitado.' }
          : { ok: false, detail: `Key rechazada o API no habilitada (HTTP ${r.status}).` };
      }

      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models',
          opts({ headers: { Authorization: `Bearer ${key}` } }));
        return r.ok
          ? { ok: true, detail: 'Key válida.' }
          : { ok: false, detail: `Key rechazada (HTTP ${r.status}).` };
      }

      case 'elevenlabs': {
        const r = await fetch('https://api.elevenlabs.io/v1/user/subscription',
          opts({ headers: { 'xi-api-key': key } }));
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          const detail = j.character_limit
            ? `Key válida — plan ${j.tier || '?'}, ${j.character_count ?? '?'}/${j.character_limit} caracteres usados.`
            : 'Key válida.';
          return { ok: true, detail };
        }
        // Una key con permisos restringidos (solo TTS/voces) rechaza el endpoint
        // de suscripción: probamos con el listado de voces antes de darla por mala.
        const r2 = await fetch('https://api.elevenlabs.io/v1/voices',
          opts({ headers: { 'xi-api-key': key } }));
        if (r2.ok) return { ok: true, detail: 'Key válida (permisos restringidos: no puedo leer el plan).' };
        return { ok: false, detail: `Key rechazada (HTTP ${r.status}).` };
      }

      // Ark y fal no tienen endpoint gratuito de validación:
      // se manda una petición vacía y se distingue error de auth vs. de parámetros.
      case 'ark': {
        const base = (endpoint || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
        const r = await fetch(`${base}/images/generations`, opts({
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: seedreamModelId || 'seedream-5-0-lite', prompt: '' })
        }));
        if (isAuthFail(r.status)) return { ok: false, detail: `Key rechazada (HTTP ${r.status}).` };
        const txt = (await r.text().catch(() => '')).slice(0, 300);
        if (/model.*(not.*(exist|found)|invalid)|NotFound/i.test(txt)) {
          return { ok: true, detail: 'Key válida, pero el ID de modelo Seedream no existe — revisalo en Avanzado.' };
        }
        return { ok: true, detail: 'Autenticación OK.' };
      }

      // Suno (proveedor tipo sunoapi.org): consultamos los créditos, que valida
      // la key sin generar música.
      case 'suno': {
        const base = (endpoint || 'https://api.sunoapi.org').replace(/\/$/, '');
        const r = await fetch(`${base}/api/v1/generate/credit`, opts({ headers: { Authorization: `Bearer ${key}` } }));
        if (isAuthFail(r.status)) return { ok: false, detail: `Key rechazada (HTTP ${r.status}).` };
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          const credits = j?.data ?? j?.credits;
          return { ok: true, detail: credits != null ? `Key válida — ${credits} créditos.` : 'Key válida.' };
        }
        return { ok: true, detail: 'Key guardada (no pude leer créditos; probá generando).' };
      }

      default:
        return { ok: false, detail: `Servicio desconocido: ${service}` };
    }
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'La petición superó los 20s.' : err.message;
    return { ok: false, detail: `Error de red — ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Traducción literal con Google Cloud Translation Basic (NMT)
// ---------------------------------------------------------------------------

export async function translateText({ apiKey, text, target }) {
  if (!apiKey) throw new Error('Falta la API key de Google Cloud Translation (Configuración).');
  const res = await apiFetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ q: text, target: target === 'es' ? 'es' : 'en', format: 'text', model: 'nmt' })
  }, 'Google Cloud Translation');
  const json = await res.json();
  const out = json?.data?.translations?.[0]?.translatedText;
  if (!out) throw new Error('Google Cloud Translation no devolvió una traducción.');
  return out.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ---------------------------------------------------------------------------
// OpenAI — rastreo web de precios actualizados
// ---------------------------------------------------------------------------

export async function searchUpdatedPricing({ apiKey, model, currentPricing }) {
  if (!apiKey) throw new Error('Falta la API key de OpenAI. Cargala en Configuración.');
  const instructions = `You are a pricing researcher. Search the web for the CURRENT official API pricing (USD) of these image/audio generation models:

1. "nano-banana" → Google Gemini 2.5 Flash Image (per generated image)
2. "nano-banana-2" → Google Gemini 3.1 Flash Image (per image, at 1K/2K and at 4K if different)
3. "nano-banana-2-lite" → Google Gemini 3.1 Flash Lite Image (per image)
4. "seedream-5-lite" → ByteDance Seedream 5.0 Lite on BytePlus ModelArk (per image)
5. "eleven-v3" → ElevenLabs Eleven v3 TTS, approximate USD per 1000 characters on a paid plan (e.g. Creator)
6. "eleven-multilingual-v2" → ElevenLabs Multilingual v2 TTS, approximate USD per 1000 characters on the same plan

Current values stored by the app (USD):
${JSON.stringify(currentPricing, null, 2)}

Compare with what you find. Reply ONLY with a JSON object (no markdown fences, no commentary) in exactly this shape — include every key, using the found price or keeping the current value if you found no reliable signal:
{
  "image": {
    "nano-banana": {"1K": number},
    "nano-banana-2": {"1K": number, "2K": number, "4K": number},
    "nano-banana-2-lite": {"1K": number},
    "seedream-5-lite": {"1K": number, "2K": number, "4K": number}
  },
  "audio": {
    "eleven-v3": {"per1kChars": number},
    "eleven-multilingual-v2": {"per1kChars": number}
  },
  "changes": ["human-readable summary in Spanish of each price that changed, or empty array"]
}`;

  const res = await apiFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'gpt-5-mini',
      tools: [{ type: 'web_search' }],
      input: instructions
    })
  }, 'OpenAI (precios)');

  const json = await res.json();
  let text = json.output_text;
  if (!text && Array.isArray(json.output)) {
    text = json.output
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('');
  }
  if (!text) throw new Error('OpenAI no devolvió texto.');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`OpenAI no devolvió JSON parseable: ${text.slice(0, 300)}`);
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error(`JSON inválido de OpenAI: ${match[0].slice(0, 300)}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// OpenAI — guionista IA (mismo esquema y prompt que Hookcast, sin el sketch)
// ---------------------------------------------------------------------------

const SCREENPLAY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'scenes'],
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 140 },
    scenes: {
      type: 'array',
      minItems: 3,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['intExt', 'location', 'timeOfDay', 'shots'],
        properties: {
          intExt: { type: 'string', enum: ['INT', 'EXT'] },
          location: { type: 'string', minLength: 2, maxLength: 120 },
          timeOfDay: { type: 'string', enum: ['Dawn', 'Day', 'Afternoon', 'Night'] },
          shots: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['size', 'lens', 'camera', 'items'],
              properties: {
                size: { type: 'string', enum: ['Extreme wide', 'Wide', 'Full', 'Medium', 'Medium close-up', 'Close-up', 'Extreme close-up', 'Insert'] },
                lens: { type: 'string', enum: ['Wide angle', 'Normal', 'Telephoto'] },
                camera: { type: 'string', minLength: 10, maxLength: 600 },
                items: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 10,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'character', 'text'],
                    properties: {
                      kind: { type: 'string', enum: ['action', 'dialogue'] },
                      character: { type: 'string', maxLength: 80 },
                      text: { type: 'string', minLength: 1, maxLength: 500 }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

export async function generateScreenplay({ apiKey, model, brief, cast, currentTitle, format }) {
  if (!apiKey) throw new Error('Falta la API key de OpenAI. Cargala en Configuración.');
  const castSummary = cast.length
    ? cast.map((member) => `- ${member.name}${member.role ? ` (${member.role})` : ''}${member.description ? `: ${member.description}` : ''}`).join('\n')
    : 'No cast has been assigned. Invent the minimal cast the brief needs and use consistent character names.';
  const hasTitle = currentTitle && !/^(untitled|sin t[ií]tulo|guion nuevo)/i.test(currentTitle.trim());

  const prompt = `You are a senior screenwriter and director specialized in vertical micro-drama (ReelShort-style: 9:16 vertical video, 1-2 minute episodes, hook in the first 3 seconds, a cliffhanger at the end).

Write a technical shooting script (guion técnico) from the brief below, broken into scenes and shots. The whole production shoots in ${format} — frame every camera choice for that format. For every scene provide:
- intExt: INT or EXT.
- location: the place, short and uppercase-friendly (e.g. "HOTEL SUITE"), in the language of the brief.
- timeOfDay: exactly one of Dawn, Day, Afternoon, Night.
- shots: the scene broken into 1-6 shots (tomas) in shooting order. Each shot is a single camera setup:
  - size: the shot size (plano), exactly one of Extreme wide, Wide, Full, Medium, Medium close-up, Close-up, Extreme close-up, Insert. Vary sizes across shots — do not give every shot the same size.
  - lens: exactly one of Wide angle, Normal, Telephoto — the lens for this shot.
  - camera: angle, movement and feel (e.g. "Low angle, slow push-in, handheld"). Specific and shootable, 1-2 sentences. Do not repeat the size or lens here.
  - items: the ordered content of the shot. Each item is either kind "action" (a visual beat — what we see, present tense, concrete and filmable; leave character empty) or kind "dialogue" (character: an assigned cast name exactly as given, text: the spoken line, short and punchy for vertical pacing). A shot can be pure action with no dialogue. Cut to a new shot whenever the camera setup should change — do not cram a whole scene into one shot. If you must add an unavoidable minor part, name it generically, e.g. "Waiter".

Structure rules: open with a strong hook scene; escalate; end the script (or episode) on a cliffhanger. 6-12 scenes unless the brief asks otherwise.
Title: ${hasTitle ? `keep exactly this title: ${currentTitle}` : 'propose a sharp title in the language of the brief'}.
Write the entire script in the same language as the brief. Do not mention that an AI wrote it. Return only the JSON structure.

ASSIGNED CAST:
${castSummary}

BRIEF:
${brief}`;

  const res = await apiFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'gpt-5-mini',
      store: false,
      reasoning: { effort: 'medium' },
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      text: { format: { type: 'json_schema', name: 'manifestador_technical_script', strict: true, schema: SCREENPLAY_SCHEMA } }
    })
  }, 'OpenAI (guion)');

  const json = await res.json();
  let text = json.output_text;
  if (!text && Array.isArray(json.output)) {
    text = json.output
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('');
  }
  if (!text) throw new Error('OpenAI no devolvió el guion.');
  let generated;
  try {
    generated = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI devolvió un guion en formato inesperado: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(generated.scenes) || !generated.scenes.length) throw new Error('OpenAI devolvió un guion vacío.');
  return { ...generated, tokens: json.usage?.total_tokens || 0 };
}

// ---------------------------------------------------------------------------
// ElevenLabs (voces + TTS; el model_id se elige por generación)
// ---------------------------------------------------------------------------

export async function listVoices({ apiKey }) {
  if (!apiKey) throw new Error('Falta la API key de ElevenLabs. Cargala en Configuración.');
  const res = await apiFetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey }
  }, 'ElevenLabs (voces)');
  const json = await res.json();
  return (json?.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category || '',
    labels: v.labels || {},
    previewUrl: v.preview_url || ''
  }));
}

export async function generateSpeech({ apiKey, voiceId, text, modelId = 'eleven_v3', stability = null }) {
  if (!apiKey) throw new Error('Falta la API key de ElevenLabs. Cargala en Configuración.');
  if (!voiceId) throw new Error('Elegí una voz (o ancla un personaje con voz asignada).');
  const body = { text, model_id: modelId };
  if (stability !== null && stability !== undefined && stability !== '') {
    body.voice_settings = { stability: Number(stability) };
  }
  const res = await apiFetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    'ElevenLabs TTS'
  );
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' };
}
