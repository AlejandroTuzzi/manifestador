// Manifestador — servidor local sin dependencias externas.
// Ejecutar con: npm start   (luego abrir http://localhost:7777)

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';

import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODEL, getImageModel, getVideoModel } from './lib/models.js';
import {
  generateGemini, generateSeedream, generateOpenAIImage, generateSeedanceVideo, generateScreenplay,
  listVoices, generateSpeech, translateText, searchUpdatedPricing, testService
} from './lib/providers.js';
import { mergePricing, imagePrice, videoPrice, audioPrice, translatePrice, scriptPrice } from './lib/pricing.js';
import { POSER_BODY_PARTS } from './public/poser-bodyparts.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT ? Number(process.env.PORT) : 7777;
const sessions = new Map();

// Se agrega automáticamente (sin mostrarse en la caja) cuando alguna
// referencia viene del Poser, para que el modelo la tome solo como pose.
const DEFAULT_POSER_PROMPT = 'The attached 3D figure render is ONLY a reference for pose and framing. Exactly replicate the camera position, angle and framing, and the character\'s full body pose — torso, head, arms, hands and legs — precisely matching the reference. Do NOT copy the 3D model\'s appearance: ignore its clothing, colors, materials and anatomy style. The main character must keep their own clothing, facial features and morphology.';

const DEFAULT_CONFIG = {
  poserPrompt: DEFAULT_POSER_PROMPT,
  photoshopPath: '',
  keys: { gemini: '', googleTranslate: '', ark: '', fal: '', elevenlabs: '', openai: '' },
  openaiModel: 'gpt-5-mini',
  paths: {
    poser: 'assets/poser',
    video: 'assets/video',
    generated: 'assets/generated',
    uploads: 'assets/uploads',
    audio: 'assets/audio'
  },
  endpoints: {
    ark: 'https://ark.ap-southeast.bytepluses.com/api/v3'
  },
  seedreamModelId: 'seedream-5-0-lite',
  seedanceModelId: '',
  seedanceMiniModelId: '',
  customAudioTags: [],
  accessPasswordHash: ''
};

// ---------------------------------------------------------------------------
// Almacenamiento en JSON
// ---------------------------------------------------------------------------

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(value, null, 2), 'utf8');
}

const jsonLocks = new Map();
async function updateJson(file, fallback, updater) {
  const previous = jsonLocks.get(file) || Promise.resolve();
  const task = previous.then(async () => {
    const current = await readJson(file, fallback);
    const next = await updater(current);
    await writeJson(file, next);
    return next;
  });
  jsonLocks.set(file, task.catch(() => {}));
  return task;
}

async function getConfig() {
  const cfg = await readJson('config.json', {});
  const savedKeys = cfg.keys || {};
  const savedEndpoints = cfg.endpoints || {};
  const merged = {
    ...DEFAULT_CONFIG,
    ...cfg,
    keys: Object.fromEntries(Object.keys(DEFAULT_CONFIG.keys).map((key) => [key, savedKeys[key] || ''])),
    paths: { ...DEFAULT_CONFIG.paths, ...(cfg.paths || {}) },
    endpoints: Object.fromEntries(Object.keys(DEFAULT_CONFIG.endpoints).map((key) => [key, savedEndpoints[key] || DEFAULT_CONFIG.endpoints[key]]))
  };
  return merged;
}

function resolveDir(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

async function getPricing() {
  return mergePricing(await readJson('pricing.json', null));
}

function publicConfig(cfg) {
  const { accessPasswordHash, ...safe } = cfg;
  return { ...safe, accessProtected: Boolean(accessPasswordHash), poserPromptDefault: DEFAULT_POSER_PROMPT };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function sessionToken(req) {
  const cookie = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('manifestador_session='));
  return cookie ? cookie.slice('manifestador_session='.length) : '';
}

// Registro de consumo: una línea por operación cobrada.
async function recordCost(entry) {
  let recorded;
  await updateJson('ledger.json', [], (ledger) => {
    recorded = { ts: Date.now(), ...entry, cost: Number(entry.cost.toFixed(6)) };
    return [recorded, ...ledger].slice(0, 20000);
  });
  return recorded;
}

async function recordAssetMetadata(entry) {
  await updateJson('asset-metadata.json', {}, (metadata) => {
    for (const key of entry.outputs || []) metadata[key] = {
      prompt: entry.prompt || '', type: entry.type, modelId: entry.modelId,
      modelName: entry.modelName, characterId: entry.characterId || null,
      characterVariantId: entry.characterVariantId || null, ts: entry.ts,
      aspectRatio: entry.aspectRatio || null, resolution: entry.resolution || null,
      batch: entry.batch || 1, refs: entry.refs || [], voiceId: entry.voiceId || null,
      voiceName: entry.voiceName || null, cost: entry.cost || 0
    };
    return metadata;
  });
}

// ZIP mínimo y portable (entradas almacenadas, sin dependencias externas).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function createZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    centrals.push(central); offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
function readStoredZip(buffer) {
  const files = new Map(); let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8); const size = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26); const extraLen = buffer.readUInt16LE(offset + 28);
    if (method !== 0) throw new Error('El ZIP usa una compresión no compatible. Exportalo desde Manifestador.');
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf8').replace(/\\/g, '/');
    if (name.includes('..') || name.startsWith('/')) throw new Error('Ruta insegura dentro del ZIP.');
    const start = offset + 30 + nameLen + extraLen; const end = start + size;
    if (end > buffer.length) throw new Error('ZIP incompleto.');
    files.set(name, buffer.subarray(start, end)); offset = end;
    if (files.size > 500) throw new Error('El ZIP contiene demasiados archivos.');
  }
  return files;
}

function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Un "asset key" es "<zona>/<archivo>" p. ej. "generated/123.png" o
// "characters/<id>/<archivo>". Se resuelve contra la carpeta configurada.
async function resolveAssetKey(key) {
  const cfg = await getConfig();
  const parts = String(key).split('/').filter(Boolean);
  const zone = parts.shift();
  if (!parts.length) throw new Error(`Asset inválido: ${key}`);
  let baseDir;
  if (zone === 'generated') baseDir = resolveDir(cfg.paths.generated);
  else if (zone === 'uploads') baseDir = resolveDir(cfg.paths.uploads);
  else if (zone === 'audio') baseDir = resolveDir(cfg.paths.audio);
  else if (zone === 'video') baseDir = resolveDir(cfg.paths.video);
  else if (zone === 'characters') baseDir = path.join(DATA_DIR, 'characters');
  else if (zone === 'elements') baseDir = path.join(DATA_DIR, 'elements');
  else if (zone === 'poser') baseDir = path.join(DATA_DIR, 'poser');
  else if (zone === 'poser-models') baseDir = resolveDir(cfg.paths.poser);
  else throw new Error(`Zona de asset desconocida: ${zone}`);
  const abs = path.join(baseDir, ...parts);
  const normBase = path.resolve(baseDir) + path.sep;
  if (!path.resolve(abs).startsWith(normBase)) throw new Error('Ruta fuera de la zona permitida');
  return abs;
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function extForMime(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'audio/mpeg') return '.mp3';
  return '.png';
}

async function saveBuffer(zone, name, buffer) {
  const cfg = await getConfig();
  const dir = zone === 'audio' ? resolveDir(cfg.paths.audio)
    : zone === 'uploads' ? resolveDir(cfg.paths.uploads)
    : zone === 'video' ? resolveDir(cfg.paths.video)
    : resolveDir(cfg.paths.generated);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buffer);
  return `${zone}/${name}`;
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('dataUrl inválido');
  const mime = m[1] || 'application/octet-stream';
  const buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { mime, buffer };
}

function sanitizeName(name) {
  return String(name || 'archivo').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

// ---------------------------------------------------------------------------
// Photoshop: detección de la instalación y apertura de archivos
// ---------------------------------------------------------------------------

async function detectPhotoshop() {
  // 1) el registro de Windows (App Paths lo escribe el instalador de Adobe)
  try {
    const out = await new Promise((resolve, reject) => {
      execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe', '/ve'],
        { windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    const m = /REG_SZ\s+(.+\.exe)/i.exec(out);
    if (m) {
      const exe = m[1].trim();
      await fs.access(exe);
      return exe;
    }
  } catch {}
  // 2) las carpetas típicas de instalación; gana la versión más nueva
  const roots = [...new Set([process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean))];
  const found = [];
  for (const root of roots) {
    const adobe = path.join(root, 'Adobe');
    for (const dir of await fs.readdir(adobe).catch(() => [])) {
      if (!/photoshop/i.test(dir)) continue;
      const exe = path.join(adobe, dir, 'Photoshop.exe');
      try { await fs.access(exe); found.push(exe); } catch {}
    }
  }
  found.sort();
  return found.pop() || null;
}

// ---------------------------------------------------------------------------
// Generación
// ---------------------------------------------------------------------------

async function runImageGeneration(req) {
  const cfg = await getConfig();
  const model = getImageModel(req.modelId);
  if (!model) throw new Error(`Modelo desconocido: ${req.modelId}`);
  const prompt = String(req.prompt || '').trim();
  if (!prompt) throw new Error('El prompt está vacío.');

  const refs = (req.refs || []).slice(0, model.maxRefs);
  if (refs.length < model.minRefs) {
    throw new Error(`${model.name} necesita al menos ${model.minRefs} imagen(es) de referencia.`);
  }
  if (refs.some((key) => String(key).startsWith('asset://'))) {
    throw new Error('Los assets verificados de Seedance (asset://) solo sirven para video. Para imágenes usá fotos comunes.');
  }
  // Refs etiquetadas: el cliente manda una copia con el texto estampado
  // (data URL) que reemplaza al archivo SOLO en esta petición.
  const labeledRefs = req.labeledRefs && typeof req.labeledRefs === 'object' ? req.labeledRefs : {};
  const validStamp = (v) => typeof v === 'string' && v.startsWith('data:image/') && v.length < 40 * 1024 * 1024;
  const refPaths = [];
  for (const key of refs) refPaths.push(validStamp(labeledRefs[key]) ? labeledRefs[key] : await resolveAssetKey(key));
  const characterRefs = refs.map((key) => /^characters\/([^/]+)(?:\/variants\/([^/]+))?\//.exec(key)).filter(Boolean);
  const inferredCharacter = characterRefs.length && characterRefs.every((match) => match[1] === characterRefs[0][1])
    ? { characterId: characterRefs[0][1], variantId: characterRefs.every((match) => (match[2] || null) === (characterRefs[0][2] || null)) ? (characterRefs[0][2] || null) : null }
    : null;

  const batch = Math.max(1, Math.min(4, Number(req.batch) || 1));
  const apiModel = model.provider === 'seedream' ? (cfg.seedreamModelId || model.apiModel) : model.apiModel;

  // Si alguna referencia viene del Poser, se anexa el prompt de pose
  // (invisible en la caja) para que la IA la use solo como pose/encuadre.
  const hasPoserRef = refs.some((key) => String(key).startsWith('poser/'));
  const sentPrompt = hasPoserRef && cfg.poserPrompt?.trim()
    ? `${prompt}\n\n${cfg.poserPrompt.trim()}`
    : prompt;

  const call = async () => {
    switch (model.provider) {
      case 'gemini':
        return generateGemini({
          apiKey: cfg.keys.gemini, apiModel, prompt: sentPrompt, refPaths,
          aspectRatio: req.aspectRatio, resolution: req.resolution,
          supportsSize: model.resolutions.length > 1
        });
      case 'seedream':
        return generateSeedream({
          apiKey: cfg.keys.ark, apiModel, endpoint: cfg.endpoints.ark,
          prompt: sentPrompt, refPaths, aspectRatio: req.aspectRatio, resolution: req.resolution
        });
      case 'openai':
        return generateOpenAIImage({
          apiKey: cfg.keys.openai, apiModel, prompt: sentPrompt, refPaths,
          aspectRatio: req.aspectRatio, resolution: req.resolution
        });
      default:
        throw new Error(`Proveedor no implementado: ${model.provider}`);
    }
  };

  const results = await Promise.allSettled(Array.from({ length: batch }, call));
  const outputs = [];
  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const img of r.value) {
        const name = `${ts()}-${model.id}-${newId()}${extForMime(img.mime)}`;
        outputs.push(await saveBuffer('generated', name, img.buffer));
      }
    } else {
      errors.push(r.reason?.message || String(r.reason));
    }
  }
  if (!outputs.length) throw new Error(errors[0] || 'La generación falló sin detalle.');

  const pricing = await getPricing();
  const unit = imagePrice(pricing, model.id, req.resolution || 'auto');
  const cost = unit * outputs.length;
  await recordCost({
    type: 'image', modelId: model.id, label: model.name,
    units: outputs.length, unitLabel: 'imagen(es)', cost
  });

  const entry = {
    id: newId(),
    ts: Date.now(),
    type: 'image',
    modelId: model.id,
    modelName: model.name,
    prompt,
    aspectRatio: req.aspectRatio || 'auto',
    resolution: req.resolution || 'auto',
    batch,
    refs,
    characterId: req.characterId || inferredCharacter?.characterId || null,
    characterVariantId: req.characterVariantId || inferredCharacter?.variantId || null,
    outputs,
    errors,
    cost: Number(cost.toFixed(6))
  };
  await updateJson('history.json', [], (history) => [entry, ...history].slice(0, 1000));
  await recordAssetMetadata(entry);
  if (entry.characterId) {
    await updateJson('asset-links.json', [], (links) => {
      const existing = new Set(links.map((link) => link.key));
      const additions = outputs.filter((key) => !existing.has(key)).map((key) => ({ key, characterId: entry.characterId, variantId: entry.characterVariantId, ts: Date.now() }));
      return [...additions, ...links].slice(0, 10000);
    });
  }
  return entry;
}

async function runVideoGeneration(req) {
  const cfg = await getConfig();
  const model = getVideoModel(req.modelId);
  if (!model) throw new Error(`Modelo de video desconocido: ${req.modelId}`);
  const prompt = String(req.prompt || '').trim();
  if (!prompt) throw new Error('El prompt está vacío.');

  const mode = req.mode === 'frames' ? 'frames' : 'reference';
  const refLimit = model.refLimits?.[mode] ?? model.maxRefs;
  const refs = Array.isArray(req.refs) ? req.refs.slice(0, refLimit) : [];
  const labeledRefs = req.labeledRefs && typeof req.labeledRefs === 'object' ? req.labeledRefs : {};
  const validStamp = (v) => typeof v === 'string' && v.startsWith('data:image/') && v.length < 40 * 1024 * 1024;
  const refPaths = [];
  for (const key of refs) {
    // "asset://<id>": rostro verificado de ModelArk, va directo a la API
    if (/^asset:\/\/[A-Za-z0-9._-]+$/.test(key)) refPaths.push(key);
    else if (validStamp(labeledRefs[key])) refPaths.push(labeledRefs[key]);
    else refPaths.push(await resolveAssetKey(key));
  }

  const aspectRatio = model.aspectRatios.includes(req.aspectRatio) ? req.aspectRatio : model.aspectRatios[0];
  const resolution = model.resolutions.includes(req.resolution) ? req.resolution : model.resolutions[0];
  const duration = model.durations.includes(Number(req.duration)) ? Number(req.duration) : model.durations[0];
  const audio = model.audio ? Boolean(req.audio) : null;

  const hasPoserRef = refs.some((key) => String(key).startsWith('poser/'));
  const sentPrompt = hasPoserRef && cfg.poserPrompt?.trim()
    ? `${prompt}\n\n${cfg.poserPrompt.trim()}`
    : prompt;

  const apiModel = model.id === 'seedance-2'
    ? (cfg.seedanceModelId || model.apiModel)
    : (cfg.seedanceMiniModelId || model.apiModel);

  const video = await generateSeedanceVideo({
    apiKey: cfg.keys.ark, apiModel, endpoint: cfg.endpoints.ark,
    prompt: sentPrompt, refPaths, mode, aspectRatio, resolution, duration, audio
  });

  const name = `${ts()}-${model.id}-${newId()}.mp4`;
  const key = await saveBuffer('video', name, video.buffer);

  const pricing = await getPricing();
  const cost = videoPrice(pricing, model.id, resolution) * duration;
  await recordCost({
    type: 'video', modelId: model.id, label: model.name,
    units: duration, unitLabel: 'segundo(s)', cost
  });

  const entry = {
    id: newId(),
    ts: Date.now(),
    type: 'video',
    modelId: model.id,
    modelName: model.name,
    prompt,
    mode,
    aspectRatio,
    resolution,
    duration,
    audio: Boolean(audio),
    refs,
    characterId: req.characterId || null,
    outputs: [key],
    errors: [],
    cost: Number(cost.toFixed(6))
  };
  await updateJson('history.json', [], (history) => [entry, ...history].slice(0, 1000));
  await recordAssetMetadata(entry);
  return entry;
}

async function runAudioGeneration(req) {
  const cfg = await getConfig();
  const text = String(req.text || '').trim();
  if (!text) throw new Error('El texto está vacío.');
  const { buffer, mime } = await generateSpeech({
    apiKey: cfg.keys.elevenlabs,
    voiceId: req.voiceId,
    text,
    modelId: AUDIO_MODEL.apiModel,
    stability: req.stability
  });
  const name = `${ts()}-voz-${newId()}${extForMime(mime)}`;
  const key = await saveBuffer('audio', name, buffer);

  const pricing = await getPricing();
  const cost = audioPrice(pricing, text.length);
  await recordCost({
    type: 'audio', modelId: AUDIO_MODEL.id, label: `${AUDIO_MODEL.name} (${req.voiceName || 'voz'})`,
    units: text.length, unitLabel: 'caracteres', cost
  });

  const entry = {
    id: newId(),
    ts: Date.now(),
    type: 'audio',
    modelId: AUDIO_MODEL.id,
    modelName: AUDIO_MODEL.name,
    prompt: text,
    voiceId: req.voiceId,
    voiceName: req.voiceName || '',
    characterId: req.characterId || null,
    outputs: [key],
    errors: [],
    cost: Number(cost.toFixed(6))
  };
  await updateJson('history.json', [], (history) => [entry, ...history].slice(0, 1000));
  await recordAssetMetadata(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Listado de assets
// ---------------------------------------------------------------------------

async function listZone(zone) {
  const cfg = await getConfig();
  const dir = zone === 'audio' ? resolveDir(cfg.paths.audio)
    : zone === 'uploads' ? resolveDir(cfg.paths.uploads)
    : zone === 'video' ? resolveDir(cfg.paths.video)
    : resolveDir(cfg.paths.generated);
  let entries = [];
  try {
    const names = await fs.readdir(dir);
    for (const n of names) {
      const st = await fs.stat(path.join(dir, n)).catch(() => null);
      if (st?.isFile()) entries.push({ key: `${zone}/${n}`, name: n, mtime: st.mtimeMs, size: st.size });
    }
  } catch {}
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? (headers.mime || 'application/octet-stream') : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers.extra
  });
  res.end(data);
}

function readBody(req, limit = 150 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw new Error('JSON inválido');
  }
}

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// ---------------------------------------------------------------------------
// Guiones — mismo modelo que Hookcast (escenas → planos → acciones/diálogos)
// ---------------------------------------------------------------------------

const SCRIPT_FORMATS = ['Vertical 9:16', 'Horizontal 16:9', 'Square 1:1'];
const SCRIPT_TIMES = ['Dawn', 'Day', 'Afternoon', 'Night'];
const SCRIPT_LENSES = ['Wide angle', 'Normal', 'Telephoto'];
const SCRIPT_SIZES = ['Extreme wide', 'Wide', 'Full', 'Medium', 'Medium close-up', 'Close-up', 'Extreme close-up', 'Insert'];
const LEGACY_SCRIPT_TIMES = { Amanecer: 'Dawn', 'Día': 'Day', Tarde: 'Afternoon', Noche: 'Night' };
const LEGACY_SCRIPT_LENSES = { 'Gran angular': 'Wide angle', Tele: 'Telephoto' };

// Escena tal como viene de Hookcast (con posibles campos viejos: slugline
// suelto o description/dialogues sin planos) → forma canónica con shots.
function hookcastScene(scene) {
  let { intExt, location, timeOfDay } = scene;
  if (!location && !intExt && scene.slugline) {
    const m = /^\s*(INT|EXT)\.?\s*(.*?)\s*(?:[—–-]+\s*(.+?)\s*)?$/i.exec(scene.slugline);
    const raw = (m?.[3] || '').toLowerCase();
    timeOfDay = raw.includes('noche') || raw.includes('night') ? 'Night'
      : raw.includes('tarde') || raw.includes('afternoon') || raw.includes('evening') || raw.includes('dusk') ? 'Afternoon'
      : raw.includes('amanecer') || raw.includes('dawn') || raw.includes('sunrise') ? 'Dawn' : 'Day';
    intExt = m?.[1]?.toUpperCase() === 'EXT' ? 'EXT' : 'INT';
    location = m ? m[2] : scene.slugline;
  }
  let shots = scene.shots;
  if (!Array.isArray(shots)) {
    const items = [];
    if (scene.description) items.push({ kind: 'action', character: '', text: scene.description });
    for (const d of scene.dialogues || []) items.push({ kind: 'dialogue', character: d.character || '', text: d.line || '' });
    shots = [{ size: 'Medium', lens: scene.lens || 'Normal', camera: scene.camera || '', items }];
  }
  return { ...scene, intExt, location, timeOfDay, shots };
}

function sanitizeScriptScenes(scenes) {
  return (Array.isArray(scenes) ? scenes : []).slice(0, 100).map((scene) => ({
    id: newId(),
    intExt: scene.intExt === 'EXT' ? 'EXT' : 'INT',
    location: String(scene.location || '').slice(0, 120),
    timeOfDay: SCRIPT_TIMES.includes(scene.timeOfDay) ? scene.timeOfDay : (LEGACY_SCRIPT_TIMES[scene.timeOfDay] || 'Day'),
    shots: (Array.isArray(scene.shots) ? scene.shots : []).slice(0, 50).map((shot) => ({
      id: newId(),
      size: SCRIPT_SIZES.includes(shot.size) ? shot.size : 'Medium',
      lens: SCRIPT_LENSES.includes(shot.lens) ? shot.lens : (LEGACY_SCRIPT_LENSES[shot.lens] || 'Normal'),
      camera: String(shot.camera || '').slice(0, 600),
      items: (Array.isArray(shot.items) ? shot.items : []).slice(0, 50).map((item) => ({
        id: newId(),
        kind: item.kind === 'dialogue' ? 'dialogue' : 'action',
        character: String(item.character || '').slice(0, 80),
        text: String(item.text || '').slice(0, 1500)
      })),
      assetKeys: [...new Set((Array.isArray(shot.assetKeys) ? shot.assetKeys : []).map(String))]
        .filter((key) => /^(generated|uploads|video|audio)\//.test(key)).slice(0, 200),
      prompt: String(shot.prompt || '').slice(0, 5000),
      promptId: String(shot.promptId || ''),
      promptTitle: String(shot.promptTitle || '').slice(0, 120)
    }))
  }));
}

function sanitizeScriptCast(list, characters) {
  return (Array.isArray(list) ? list : []).slice(0, 50).map((ch) => ({
    id: newId(),
    characterId: characters.some((c) => c.id === ch.characterId) ? ch.characterId : '',
    name: String(ch.name || '').trim().slice(0, 80),
    role: String(ch.role || '').slice(0, 160)
  })).filter((ch) => ch.name);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // La interfaz estática es pública para poder mostrar el login; datos y archivos no.
    if (p === '/api/auth/login' && req.method === 'POST') {
      const cfg = await getConfig();
      const body = await readJsonBody(req);
      if (!cfg.accessPasswordHash || !verifyPassword(String(body.password || ''), cfg.accessPasswordHash)) {
        return send(res, 401, { error: 'Clave incorrecta' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + 30 * 24 * 60 * 60 * 1000);
      return send(res, 200, { ok: true }, { extra: { 'Set-Cookie': `manifestador_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` } });
    }
    if (p === '/api/auth/status' && req.method === 'GET') {
      const cfg = await getConfig();
      const token = sessionToken(req);
      return send(res, 200, { protected: Boolean(cfg.accessPasswordHash), authenticated: !cfg.accessPasswordHash || (sessions.get(token) || 0) > Date.now() });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      sessions.delete(sessionToken(req));
      return send(res, 200, { ok: true }, { extra: { 'Set-Cookie': 'manifestador_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' } });
    }
    if (p.startsWith('/api/') || p.startsWith('/files/')) {
      const cfg = await getConfig();
      const token = sessionToken(req);
      if (cfg.accessPasswordHash && (sessions.get(token) || 0) <= Date.now()) {
        return send(res, 401, { error: 'Acceso bloqueado', loginRequired: true });
      }
    }

    // --- archivos de assets ---
    if (p.startsWith('/files/')) {
      const key = decodeURIComponent(p.slice('/files/'.length));
      const abs = await resolveAssetKey(key);
      const buf = await fs.readFile(abs).catch(() => null);
      if (!buf) return send(res, 404, { error: 'No encontrado' });
      const mime = STATIC_MIME[path.extname(abs).toLowerCase()]
        || (abs.endsWith('.mp3') ? 'audio/mpeg' : abs.endsWith('.mp4') ? 'video/mp4'
        : abs.endsWith('.webm') ? 'video/webm' : abs.endsWith('.jpg') || abs.endsWith('.jpeg') ? 'image/jpeg'
        : abs.endsWith('.webp') ? 'image/webp' : 'image/png');
      return send(res, 200, buf, { mime });
    }

    // --- API ---
    if (p === '/api/state' && req.method === 'GET') {
      const [cfg, characters, prompts, promptCategories, history, pricing, assetLinks, series, scripts, elements, elementLinks] = await Promise.all([
        getConfig(),
        readJson('characters.json', []),
        readJson('prompts.json', []),
        readJson('prompt-categories.json', {}),
        readJson('history.json', []),
        getPricing(),
        readJson('asset-links.json', []),
        readJson('series.json', []),
        readJson('scripts.json', []),
        readJson('elements.json', []),
        readJson('element-links.json', [])
      ]);
      return send(res, 200, {
        config: publicConfig(cfg),
        models: IMAGE_MODELS,
        videoModels: VIDEO_MODELS,
        audioModel: AUDIO_MODEL,
        characters,
        prompts,
        promptCategories,
        history: history.slice(0, 200),
        pricing,
        assetLinks,
        series,
        scripts,
        elements,
        elementLinks
      });
    }

    if (p === '/api/prompt-categories' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const mode = ['image', 'video', 'audio'].includes(body.mode) ? body.mode : null;
      const name = String(body.name || '').trim().slice(0, 80);
      if (!mode || !name) throw new Error('Faltan el tipo o el nombre de la categoría.');
      const promptCategories = await updateJson('prompt-categories.json', {}, (all) => {
        const forMode = all[mode] || [];
        return forMode.includes(name) ? all : { ...all, [mode]: [...forMode, name] };
      });
      return send(res, 200, { promptCategories });
    }

    if (p === '/api/config' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (body.accessPassword && String(body.accessPassword).length < 6) {
        return send(res, 400, { error: 'La clave debe tener al menos 6 caracteres.' });
      }
      const cfg = await getConfig();
      const next = {
        ...cfg,
        keys: { ...cfg.keys, ...(body.keys || {}) },
        paths: { ...cfg.paths, ...(body.paths || {}) },
        endpoints: { ...cfg.endpoints, ...(body.endpoints || {}) },
        seedreamModelId: body.seedreamModelId ?? cfg.seedreamModelId,
        seedanceModelId: body.seedanceModelId ?? cfg.seedanceModelId,
        seedanceMiniModelId: body.seedanceMiniModelId ?? cfg.seedanceMiniModelId,
        openaiModel: body.openaiModel ?? cfg.openaiModel,
        poserPrompt: body.poserPrompt !== undefined ? String(body.poserPrompt) : cfg.poserPrompt,
        photoshopPath: body.photoshopPath !== undefined ? String(body.photoshopPath).trim() : cfg.photoshopPath,
        customAudioTags: Array.isArray(body.customAudioTags)
          ? [...new Set(body.customAudioTags.map((tag) => String(tag).trim().replace(/^\[|\]$/g, '')).filter(Boolean))].slice(0, 100)
          : (cfg.customAudioTags || []),
        accessPasswordHash: body.accessPassword
          ? hashPassword(String(body.accessPassword))
          : cfg.accessPasswordHash
      };
      await writeJson('config.json', next);
      return send(res, 200, publicConfig(next));
    }

    if (p === '/api/upload' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { mime, buffer } = parseDataUrl(body.dataUrl);
      const name = `${ts()}-${sanitizeName(body.name).replace(/\.[^.]+$/, '')}${extForMime(mime)}`;
      const key = await saveBuffer('uploads', name, buffer);
      return send(res, 200, { key, name });
    }

    if (p === '/api/assets' && req.method === 'GET') {
      const [generated, uploads, audio, video, savedMetadata, history] = await Promise.all([
        listZone('generated'), listZone('uploads'), listZone('audio'), listZone('video'),
        readJson('asset-metadata.json', {}), readJson('history.json', [])
      ]);
      const metadata = { ...savedMetadata };
      let changed = false;
      for (const entry of history) for (const key of entry.outputs || []) {
        const fromHistory = {
          prompt: entry.prompt || '', type: entry.type, modelId: entry.modelId, modelName: entry.modelName,
          characterId: entry.characterId || null, characterVariantId: entry.characterVariantId || null, ts: entry.ts,
          aspectRatio: entry.aspectRatio || null, resolution: entry.resolution || null, batch: entry.batch || 1,
          refs: entry.refs || [], voiceId: entry.voiceId || null, voiceName: entry.voiceName || null, cost: entry.cost || 0
        };
        const before = metadata[key] || {};
        const enriched = { ...fromHistory, ...before };
        if (Object.keys(fromHistory).some((field) => before[field] === undefined)) changed = true;
        metadata[key] = enriched;
      }
      if (changed) await writeJson('asset-metadata.json', metadata);
      for (const item of [...generated, ...uploads, ...audio, ...video]) Object.assign(item, metadata[item.key] || {});
      return send(res, 200, { generated, uploads, audio, video });
    }

    if (p === '/api/asset-links' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const key = String(body.key || '');
      if (!/^(generated|uploads)\//.test(key)) throw new Error('Solo se pueden asociar imágenes.');
      await fs.access(await resolveAssetKey(key));
      const characters = await readJson('characters.json', []);
      const character = characters.find((c) => c.id === body.characterId);
      if (!character) throw new Error('Personaje no encontrado.');
      const variantId = body.variantId || null;
      if (variantId && !(character.variants || []).some((v) => v.id === variantId)) throw new Error('Variante no encontrada.');
      const next = await updateJson('asset-links.json', [], (links) =>
        [{ key, characterId: character.id, variantId, ts: Date.now() }, ...links.filter((link) => link.key !== key)].slice(0, 10000));
      return send(res, 200, { links: next });
    }
    if (p === '/api/asset-links' && req.method === 'DELETE') {
      const key = url.searchParams.get('key');
      const next = await updateJson('asset-links.json', [], (links) => links.filter((link) => link.key !== key));
      return send(res, 200, { links: next });
    }

    // --- series ---
    if (p === '/api/series' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const characters = await readJson('characters.json', []);
      const item = {
        id: newId(),
        title: String(body.title || '').trim() || 'Sin título',
        description: String(body.description || ''),
        format: body.format === '16:9' ? '16:9' : '9:16',
        chapters: Math.max(1, Math.min(500, parseInt(body.chapters, 10) || 1)),
        chapterSeconds: Math.max(1, Math.min(36000, parseInt(body.chapterSeconds, 10) || 60)),
        characterIds: [...new Set((Array.isArray(body.characterIds) ? body.characterIds : []).map(String))]
          .filter((cid) => characters.some((c) => c.id === cid)),
        assetKeys: [],
        ts: Date.now()
      };
      await updateJson('series.json', [], (all) => [item, ...all]);
      return send(res, 200, item);
    }

    const seriesMatch = /^\/api\/series\/([a-z0-9]+)(\/assets)?$/.exec(p);
    if (seriesMatch) {
      const [, seriesId, isSeriesAssets] = seriesMatch;
      const series = await readJson('series.json', []);
      const seriesIdx = series.findIndex((s) => s.id === seriesId);
      if (seriesIdx === -1) return send(res, 404, { error: 'Serie no encontrada' });
      const item = series[seriesIdx];

      if (isSeriesAssets && req.method === 'POST') {
        const body = await readJsonBody(req);
        const keys = [...new Set((Array.isArray(body.keys) ? body.keys : [body.key]).map(String).filter(Boolean))];
        if (!keys.length) throw new Error('No se indicó ningún asset.');
        if (keys.length > 1000) throw new Error('Demasiados assets en una sola operación.');
        for (const key of keys) {
          if (!/^(generated|uploads|video|audio)\//.test(key)) throw new Error(`Ese archivo no se puede asociar a una serie: ${key}`);
          await fs.access(await resolveAssetKey(key));
        }
        item.assetKeys = [...keys, ...(item.assetKeys || []).filter((k) => !keys.includes(k))];
        await writeJson('series.json', series);
        return send(res, 200, item);
      }
      if (isSeriesAssets && req.method === 'DELETE') {
        const key = url.searchParams.get('key');
        item.assetKeys = (item.assetKeys || []).filter((k) => k !== key);
        await writeJson('series.json', series);
        return send(res, 200, item);
      }
      if (!isSeriesAssets && req.method === 'PUT') {
        const body = await readJsonBody(req);
        let characterIds = item.characterIds || [];
        if (body.characterIds !== undefined) {
          const characters = await readJson('characters.json', []);
          characterIds = [...new Set((Array.isArray(body.characterIds) ? body.characterIds : []).map(String))]
            .filter((cid) => characters.some((c) => c.id === cid));
        }
        series[seriesIdx] = {
          ...item,
          title: body.title !== undefined ? (String(body.title).trim() || item.title) : item.title,
          description: body.description !== undefined ? String(body.description) : item.description,
          format: body.format !== undefined ? (body.format === '16:9' ? '16:9' : '9:16') : item.format,
          chapters: body.chapters !== undefined ? Math.max(1, Math.min(500, parseInt(body.chapters, 10) || 1)) : item.chapters,
          chapterSeconds: body.chapterSeconds !== undefined ? Math.max(1, Math.min(36000, parseInt(body.chapterSeconds, 10) || 60)) : item.chapterSeconds,
          characterIds
        };
        await writeJson('series.json', series);
        return send(res, 200, series[seriesIdx]);
      }
      if (!isSeriesAssets && req.method === 'DELETE') {
        series.splice(seriesIdx, 1);
        await writeJson('series.json', series);
        await updateJson('scripts.json', [], (all) => all.filter((sc) => sc.seriesId !== seriesId));
        return send(res, 200, { ok: true });
      }
    }

    // --- guiones (dentro de una serie) ---
    if (p === '/api/scripts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const series = await readJson('series.json', []);
      const serie = series.find((s) => s.id === body.seriesId);
      if (!serie) throw new Error('Serie no encontrada.');
      const item = {
        id: newId(),
        seriesId: serie.id,
        title: String(body.title || '').trim().slice(0, 140) || 'Guion nuevo',
        summary: '',
        format: serie.format === '16:9' ? 'Horizontal 16:9' : 'Vertical 9:16',
        characters: [],
        scenes: [],
        source: 'manual',
        ts: Date.now(),
        updatedAt: Date.now()
      };
      await updateJson('scripts.json', [], (all) => [item, ...all]);
      return send(res, 200, item);
    }

    if (p === '/api/scripts/import' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const series = await readJson('series.json', []);
      const serie = series.find((s) => s.id === body.seriesId);
      if (!serie) throw new Error('Serie no encontrada.');
      const data = body.data;
      const source = data?.format === 'hookcast-script' ? data.script : data;
      if (!source || !Array.isArray(source.scenes)) throw new Error('Ese JSON no parece un guion exportado de Hookcast.');
      const characters = await readJson('characters.json', []);
      // el elenco se matchea contra tus personajes por nombre
      const cast = (Array.isArray(source.characters) ? source.characters : []).map((ch) => {
        const match = characters.find((c) => c.name.trim().toLowerCase() === String(ch.name || '').trim().toLowerCase());
        return { characterId: match?.id || '', name: ch.name, role: ch.role };
      });
      const item = {
        id: newId(),
        seriesId: serie.id,
        title: String(source.title || '').trim().slice(0, 140) || 'Guion importado',
        summary: String(source.summary || '').slice(0, 3000),
        format: SCRIPT_FORMATS.includes(source.format) ? source.format : (serie.format === '16:9' ? 'Horizontal 16:9' : 'Vertical 9:16'),
        characters: sanitizeScriptCast(cast, characters),
        scenes: sanitizeScriptScenes(source.scenes.map(hookcastScene)),
        source: 'hookcast',
        ts: Date.now(),
        updatedAt: Date.now()
      };
      await updateJson('scripts.json', [], (all) => [item, ...all]);
      const matched = item.characters.map((c) => c.characterId).filter(Boolean);
      if (matched.length) {
        serie.characterIds = [...new Set([...(serie.characterIds || []), ...matched])];
        await writeJson('series.json', series);
      }
      return send(res, 200, { script: item, serie });
    }

    const scriptMatch = /^\/api\/scripts\/([a-z0-9]+)(\/generate)?$/.exec(p);
    if (scriptMatch) {
      const [, scriptId, isGenerate] = scriptMatch;
      const scripts = await readJson('scripts.json', []);
      const scriptIdx = scripts.findIndex((sc) => sc.id === scriptId);
      if (scriptIdx === -1) return send(res, 404, { error: 'Guion no encontrado' });
      const script = scripts[scriptIdx];

      if (!isGenerate && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const characters = await readJson('characters.json', []);
        scripts[scriptIdx] = {
          ...script,
          title: body.title !== undefined ? (String(body.title).trim().slice(0, 140) || script.title) : script.title,
          summary: body.summary !== undefined ? String(body.summary).slice(0, 3000) : script.summary,
          format: SCRIPT_FORMATS.includes(body.format) ? body.format : script.format,
          characters: body.characters !== undefined ? sanitizeScriptCast(body.characters, characters) : script.characters,
          scenes: body.scenes !== undefined ? sanitizeScriptScenes(body.scenes) : script.scenes,
          updatedAt: Date.now()
        };
        await writeJson('scripts.json', scripts);
        return send(res, 200, scripts[scriptIdx]);
      }

      if (!isGenerate && req.method === 'DELETE') {
        scripts.splice(scriptIdx, 1);
        await writeJson('scripts.json', scripts);
        return send(res, 200, { ok: true });
      }

      if (isGenerate && req.method === 'POST') {
        const body = await readJsonBody(req);
        const brief = String(body.brief || '').trim().slice(0, 6000);
        if (!brief) throw new Error('Escribí un brief de la historia para generar el guion.');
        const cfg = await getConfig();
        const characters = await readJson('characters.json', []);
        const cast = (script.characters || []).map((ch) => ({
          name: ch.name,
          role: ch.role,
          description: characters.find((c) => c.id === ch.characterId)?.description || ''
        }));
        const generated = await generateScreenplay({
          apiKey: cfg.keys.openai,
          model: cfg.openaiModel,
          brief,
          cast,
          currentTitle: script.title,
          format: script.format
        });
        const pricing = await getPricing();
        await recordCost({
          type: 'script', modelId: cfg.openaiModel || 'gpt-5-mini', label: 'Guionista IA (OpenAI)',
          units: generated.tokens, unitLabel: 'tokens', cost: scriptPrice(pricing, generated.tokens)
        });
        scripts[scriptIdx] = {
          ...script,
          title: String(generated.title || script.title).trim().slice(0, 140) || script.title,
          scenes: sanitizeScriptScenes(generated.scenes),
          updatedAt: Date.now()
        };
        await writeJson('scripts.json', scripts);
        return send(res, 200, scripts[scriptIdx]);
      }
    }

    if (p === '/api/generate/image' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const entry = await runImageGeneration(body);
      return send(res, 200, entry);
    }

    if (p === '/api/generate/video' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const entry = await runVideoGeneration(body);
      return send(res, 200, entry);
    }

    if (p === '/api/generate/audio' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const entry = await runAudioGeneration(body);
      return send(res, 200, entry);
    }

    if (p === '/api/translate' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const cfg = await getConfig();
      const text = await translateText({
        apiKey: cfg.keys.googleTranslate,
        text: String(body.text || ''),
        target: body.target === 'es' ? 'es' : 'en'
      });
      const pricing = await getPricing();
      await recordCost({
        type: 'translate', modelId: 'google-translate-nmt', label: 'Google Translation',
        units: String(body.text || '').length, unitLabel: 'caracteres',
        cost: translatePrice(pricing, String(body.text || '').length)
      });
      return send(res, 200, { text });
    }

    // --- consumo y precios ---
    if (p === '/api/costs' && req.method === 'GET') {
      const [pricing, ledger] = await Promise.all([getPricing(), readJson('ledger.json', [])]);
      const byMonth = {};
      const byModelThisMonth = {};
      const nowMonth = monthKey(Date.now());
      let total = 0;
      for (const e of ledger) {
        total += e.cost;
        const mk = monthKey(e.ts);
        byMonth[mk] = (byMonth[mk] || 0) + e.cost;
        if (mk === nowMonth) {
          const k = e.label || e.modelId;
          byModelThisMonth[k] = (byModelThisMonth[k] || { cost: 0, count: 0 });
          byModelThisMonth[k].cost += e.cost;
          byModelThisMonth[k].count += 1;
        }
      }
      return send(res, 200, {
        pricing,
        total,
        currentMonth: nowMonth,
        currentMonthTotal: byMonth[nowMonth] || 0,
        byMonth,
        byModelThisMonth,
        recent: ledger.slice(0, 100)
      });
    }

    if (p === '/api/pricing' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const current = await getPricing();
      const next = mergePricing({ ...current, ...body, updatedAt: Date.now(), note: 'Editado a mano' });
      await writeJson('pricing.json', next);
      return send(res, 200, next);
    }

    if (p === '/api/pricing/refresh' && req.method === 'POST') {
      const cfg = await getConfig();
      const current = await getPricing();
      const found = await searchUpdatedPricing({
        apiKey: cfg.keys.openai,
        model: cfg.openaiModel,
        currentPricing: { image: current.image, audio: current.audio }
      });
      const next = mergePricing({
        image: found.image,
        audio: found.audio,
        updatedAt: Date.now(),
        note: 'Actualizado por OpenAI (búsqueda web)'
      });
      await writeJson('pricing.json', next);
      return send(res, 200, { pricing: next, changes: found.changes || [] });
    }

    if (p === '/api/test' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const cfg = await getConfig();
      const service = String(body.service || '');
      const endpoint = body.endpoint || (service === 'ark' ? cfg.endpoints.ark : '');
      const result = await testService({
        service,
        key: body.key || cfg.keys[service] || '',
        endpoint,
        seedreamModelId: body.seedreamModelId || cfg.seedreamModelId
      });
      return send(res, 200, result);
    }

    if (p === '/api/voices' && req.method === 'GET') {
      const cfg = await getConfig();
      const voices = await listVoices({ apiKey: cfg.keys.elevenlabs });
      return send(res, 200, { voices });
    }

    // --- prompts archivados ---
    if (p === '/api/prompts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const prompts = await readJson('prompts.json', []);
      const item = {
        id: newId(),
        title: String(body.title || '').trim() || 'Sin título',
        text: String(body.text || ''),
        mode: ['audio', 'video'].includes(body.mode) ? body.mode : 'image',
        category: String(body.category || '').trim() || 'General',
        ts: Date.now()
      };
      prompts.unshift(item);
      await writeJson('prompts.json', prompts);
      return send(res, 200, item);
    }
    if (p.startsWith('/api/prompts/') && req.method === 'PUT') {
      const id = p.split('/').pop();
      const body = await readJsonBody(req);
      const prompts = await readJson('prompts.json', []);
      const idx = prompts.findIndex((x) => x.id === id);
      if (idx === -1) return send(res, 404, { error: 'Prompt no encontrado' });
      prompts[idx] = {
        ...prompts[idx],
        title: body.title !== undefined ? String(body.title).trim() || 'Sin título' : prompts[idx].title,
        text: body.text !== undefined ? String(body.text) : prompts[idx].text,
        category: body.category !== undefined ? String(body.category).trim() || 'General' : (prompts[idx].category || 'General'),
        mode: body.mode !== undefined ? (['audio', 'video'].includes(body.mode) ? body.mode : 'image') : prompts[idx].mode
      };
      await writeJson('prompts.json', prompts);
      return send(res, 200, prompts[idx]);
    }
    if (p.startsWith('/api/prompts/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      const prompts = await readJson('prompts.json', []);
      await writeJson('prompts.json', prompts.filter((x) => x.id !== id));
      return send(res, 200, { ok: true });
    }

    // --- historial ---
    if (p.startsWith('/api/history/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      const history = await readJson('history.json', []);
      await writeJson('history.json', history.filter((x) => x.id !== id));
      return send(res, 200, { ok: true });
    }
    if (p === '/api/history' && req.method === 'DELETE') {
      const history = await readJson('history.json', []);
      await writeJson('history.json', []);
      return send(res, 200, { ok: true, deleted: history.length });
    }

    // --- borrado de assets (los archivos se eliminan de disco) ---
    if (p === '/api/assets/delete' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const keys = [...new Set(Array.isArray(body.keys) ? body.keys.map(String) : [])];
      if (!keys.length) throw new Error('No se seleccionaron assets.');
      if (keys.length > 5000) throw new Error('Demasiados assets en una sola operación.');
      const allowed = keys.filter((key) => /^(generated|uploads|audio|video)\//.test(key));
      if (allowed.length !== keys.length) throw new Error('La selección contiene assets no eliminables.');
      for (const key of allowed) {
        await fs.unlink(await resolveAssetKey(key)).catch((err) => {
          if (err?.code !== 'ENOENT') throw err;
        });
      }
      const removed = new Set(allowed);
      const metadata = await readJson('asset-metadata.json', {});
      for (const key of removed) delete metadata[key];
      await writeJson('asset-metadata.json', metadata);
      const links = await readJson('asset-links.json', []);
      await writeJson('asset-links.json', links.filter((link) => !removed.has(link.key)));
      await updateJson('element-links.json', [], (links2) => links2.filter((link) => !removed.has(link.key)));
      await updateJson('series.json', [], (all) => all.map((s) => ({
        ...s,
        assetKeys: (s.assetKeys || []).filter((key) => !removed.has(key))
      })));
      await updateJson('scripts.json', [], (all) => all.map((sc) => ({
        ...sc,
        scenes: (sc.scenes || []).map((scene) => ({
          ...scene,
          shots: (scene.shots || []).map((shot) => ({
            ...shot,
            assetKeys: (shot.assetKeys || []).filter((key) => !removed.has(key))
          }))
        }))
      })));
      const history = await readJson('history.json', []);
      const cleaned = history.map((entry) => ({
        ...entry,
        outputs: (entry.outputs || []).filter((key) => !removed.has(key)),
        refs: (entry.refs || []).filter((key) => !removed.has(key))
      })).filter((entry) => entry.outputs.length);
      await writeJson('history.json', cleaned);
      return send(res, 200, { ok: true, deleted: allowed.length, history: cleaned.slice(0, 200) });
    }

    // --- personajes ---
    if (p === '/api/characters' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const characters = await readJson('characters.json', []);
      const item = {
        id: newId(),
        name: String(body.name || '').trim() || 'Sin nombre',
        description: String(body.description || ''),
        voiceId: body.voiceId || '',
        voiceName: body.voiceName || '',
        arkAssetId: String(body.arkAssetId || '').trim().replace(/^asset:\/\//, ''),
        photos: [],
        variants: [],
        ts: Date.now()
      };
      characters.unshift(item);
      await writeJson('characters.json', characters);
      return send(res, 200, item);
    }

    if (p === '/api/characters/import' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const zipBuffer = Buffer.from(String(body.zipBase64 || ''), 'base64');
      if (!zipBuffer.length || zipBuffer.length > 150 * 1024 * 1024) throw new Error('ZIP vacío o demasiado grande.');
      const files = readStoredZip(zipBuffer);
      const manifestBuffer = files.get('character.json');
      if (!manifestBuffer) throw new Error('El ZIP no contiene character.json.');
      const manifest = JSON.parse(manifestBuffer.toString('utf8'));
      if (manifest.format !== 'manifestador-character' || !manifest.character) throw new Error('Este ZIP no es un personaje de Manifestador.');
      const source = manifest.character;
      const id = newId();
      const characterDir = path.join(DATA_DIR, 'characters', id);
      const item = {
        id, name: String(source.name || 'Personaje importado'), description: String(source.description || ''),
        voiceId: String(source.voiceId || ''), voiceName: String(source.voiceName || ''), photos: [], variants: [], ts: Date.now()
      };
      await fs.mkdir(characterDir, { recursive: true });
      for (const [index, file] of (source.photos || []).entries()) {
        const data = files.get(file); if (!data) continue;
        const ext = path.extname(file).toLowerCase(); if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue;
        const name = `import-original-${index + 1}${ext}`; await fs.writeFile(path.join(characterDir, name), data);
        item.photos.push(`characters/${id}/${name}`);
      }
      for (const sourceVariant of source.variants || []) {
        const variantId = newId();
        const variant = { id: variantId, name: String(sourceVariant.name || 'Variante'), description: String(sourceVariant.description || ''), photos: [], ts: Date.now() };
        const dir = path.join(characterDir, 'variants', variantId); await fs.mkdir(dir, { recursive: true });
        for (const [index, file] of (sourceVariant.photos || []).entries()) {
          const data = files.get(file); if (!data) continue;
          const ext = path.extname(file).toLowerCase(); if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue;
          const name = `import-${index + 1}${ext}`; await fs.writeFile(path.join(dir, name), data);
          variant.photos.push(`characters/${id}/variants/${variantId}/${name}`);
        }
        item.variants.push(variant);
      }
      await updateJson('characters.json', [], (characters) => [item, ...characters]);
      return send(res, 200, item);
    }

    const exportMatch = /^\/api\/characters\/([a-z0-9]+)\/export$/.exec(p);
    if (exportMatch && req.method === 'GET') {
      const characters = await readJson('characters.json', []);
      const character = characters.find((c) => c.id === exportMatch[1]);
      if (!character) return send(res, 404, { error: 'Personaje no encontrado' });
      const entries = []; const photos = [];
      for (const [index, key] of (character.photos || []).entries()) {
        const ext = path.extname(key).toLowerCase(); const file = `original/${index + 1}${ext}`;
        entries.push({ name: file, data: await fs.readFile(await resolveAssetKey(key)) }); photos.push(file);
      }
      const variants = [];
      for (const [variantIndex, variant] of (character.variants || []).entries()) {
        const variantPhotos = [];
        for (const [index, key] of (variant.photos || []).entries()) {
          const ext = path.extname(key).toLowerCase(); const file = `variants/${variantIndex + 1}/${index + 1}${ext}`;
          entries.push({ name: file, data: await fs.readFile(await resolveAssetKey(key)) }); variantPhotos.push(file);
        }
        variants.push({ name: variant.name, description: variant.description || '', photos: variantPhotos });
      }
      const manifest = { format: 'manifestador-character', version: 1, exportedAt: Date.now(), character: { name: character.name, description: character.description || '', voiceId: character.voiceId || '', voiceName: character.voiceName || '', photos, variants } };
      entries.unshift({ name: 'character.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });
      const zip = createZip(entries);
      const filename = `${sanitizeName(character.name || 'personaje').replace(/\.[^.]+$/, '')}.manifestador.zip`;
      return send(res, 200, zip, { mime: 'application/zip', extra: { 'Content-Disposition': `attachment; filename="${filename}"` } });
    }

    // --- locaciones y objetos ("elementos"): espejo de personajes ---
    if (p === '/api/elements' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const item = {
        id: newId(),
        kind: body.kind === 'object' ? 'object' : 'location',
        name: String(body.name || '').trim() || 'Sin nombre',
        category: String(body.category || '').trim().slice(0, 80),
        description: String(body.description || ''),
        photos: [],
        variants: [],
        ts: Date.now()
      };
      await updateJson('elements.json', [], (all) => [item, ...all]);
      return send(res, 200, item);
    }

    if (p === '/api/element-links' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const key = String(body.key || '');
      if (!/^(generated|uploads)\//.test(key)) throw new Error('Solo se pueden asociar imágenes.');
      await fs.access(await resolveAssetKey(key));
      const elements = await readJson('elements.json', []);
      const element = elements.find((el) => el.id === body.elementId);
      if (!element) throw new Error('Locación u objeto no encontrado.');
      const variantId = body.variantId || null;
      if (variantId && !(element.variants || []).some((v) => v.id === variantId)) throw new Error('Variante no encontrada.');
      const next = await updateJson('element-links.json', [], (links) =>
        [{ key, elementId: element.id, variantId, ts: Date.now() }, ...links.filter((link) => link.key !== key)].slice(0, 10000));
      return send(res, 200, { links: next });
    }
    if (p === '/api/element-links' && req.method === 'DELETE') {
      const key = url.searchParams.get('key');
      const next = await updateJson('element-links.json', [], (links) => links.filter((link) => link.key !== key));
      return send(res, 200, { links: next });
    }

    const elVariantMatch = /^\/api\/elements\/([a-z0-9]+)\/variants(?:\/([a-z0-9]+))?(\/photos)?$/.exec(p);
    if (elVariantMatch) {
      const [, id, variantId, isPhotos] = elVariantMatch;
      const elements = await readJson('elements.json', []);
      const idx = elements.findIndex((el) => el.id === id);
      if (idx === -1) return send(res, 404, { error: 'Locación u objeto no encontrado' });
      const el = elements[idx];
      el.variants = el.variants || [];

      if (!variantId && req.method === 'POST') {
        const body = await readJsonBody(req);
        const variant = { id: newId(), name: String(body.name || '').trim() || 'Nueva variante', description: String(body.description || ''), photos: [], ts: Date.now() };
        el.variants.push(variant);
        await writeJson('elements.json', elements);
        return send(res, 200, el);
      }
      const variant = el.variants.find((v) => v.id === variantId);
      if (!variant) return send(res, 404, { error: 'Variante no encontrada' });
      if (!isPhotos && req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (body.name !== undefined) variant.name = String(body.name).trim() || variant.name;
        if (body.description !== undefined) variant.description = String(body.description);
        await writeJson('elements.json', elements);
        return send(res, 200, el);
      }
      if (!isPhotos && req.method === 'DELETE') {
        el.variants = el.variants.filter((v) => v.id !== variantId);
        const links = await readJson('element-links.json', []);
        await writeJson('element-links.json', links.map((link) =>
          link.elementId === id && link.variantId === variantId ? { ...link, variantId: null } : link));
        await writeJson('elements.json', elements);
        await fs.rm(path.join(DATA_DIR, 'elements', id, 'variants', variantId), { recursive: true, force: true }).catch(() => {});
        return send(res, 200, el);
      }
      if (isPhotos && req.method === 'POST') {
        const body = await readJsonBody(req);
        const dir = path.join(DATA_DIR, 'elements', id, 'variants', variantId);
        await fs.mkdir(dir, { recursive: true });
        let name;
        if (body.assetKey) {
          const assetKey = String(body.assetKey);
          if (!/^(generated|uploads)\//.test(assetKey)) throw new Error('Solo se pueden usar imágenes como foto.');
          const source = await resolveAssetKey(assetKey);
          const ext = path.extname(source).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Formato de imagen no admitido.');
          name = `${ts()}-asset-${newId()}${ext}`;
          await fs.copyFile(source, path.join(dir, name));
        } else {
          const { mime, buffer } = parseDataUrl(body.dataUrl);
          name = `${ts()}-${sanitizeName(body.name).replace(/\.[^.]+$/, '')}${extForMime(mime)}`;
          await fs.writeFile(path.join(dir, name), buffer);
        }
        variant.photos.push(`elements/${id}/variants/${variantId}/${name}`);
        await writeJson('elements.json', elements);
        return send(res, 200, el);
      }
      if (isPhotos && req.method === 'DELETE') {
        const key = url.searchParams.get('key');
        variant.photos = variant.photos.filter((k) => k !== key);
        if (key) await fs.unlink(await resolveAssetKey(key)).catch(() => {});
        await writeJson('elements.json', elements);
        return send(res, 200, el);
      }
    }

    const elementMatch = /^\/api\/elements\/([a-z0-9]+)(\/photos)?$/.exec(p);
    if (elementMatch) {
      const [, id, isPhotos] = elementMatch;
      const elements = await readJson('elements.json', []);
      const idx = elements.findIndex((el) => el.id === id);
      if (idx === -1) return send(res, 404, { error: 'Locación u objeto no encontrado' });
      const el = elements[idx];

      if (isPhotos && req.method === 'POST') {
        const body = await readJsonBody(req);
        const dir = path.join(DATA_DIR, 'elements', id);
        await fs.mkdir(dir, { recursive: true });
        let name;
        if (body.assetKey) {
          const assetKey = String(body.assetKey);
          if (!/^(generated|uploads)\//.test(assetKey)) throw new Error('Solo se pueden usar imágenes como foto.');
          const source = await resolveAssetKey(assetKey);
          const ext = path.extname(source).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Formato de imagen no admitido.');
          name = `${ts()}-asset-${newId()}${ext}`;
          await fs.copyFile(source, path.join(dir, name));
        } else {
          const { mime, buffer } = parseDataUrl(body.dataUrl);
          name = `${ts()}-${sanitizeName(body.name).replace(/\.[^.]+$/, '')}${extForMime(mime)}`;
          await fs.writeFile(path.join(dir, name), buffer);
        }
        el.photos.push(`elements/${id}/${name}`);
        await writeJson('elements.json', elements);
        return send(res, 200, el);
      }
      if (isPhotos && req.method === 'DELETE') {
        const key = url.searchParams.get('key');
        el.photos = el.photos.filter((k) => k !== key);
        if (key) await fs.unlink(await resolveAssetKey(key)).catch(() => {});
        await writeJson('elements.json', elements);
        return send(res, 200, el);
      }
      if (!isPhotos && req.method === 'PUT') {
        const body = await readJsonBody(req);
        elements[idx] = {
          ...el,
          kind: body.kind !== undefined ? (body.kind === 'object' ? 'object' : 'location') : el.kind,
          name: body.name !== undefined ? (String(body.name).trim() || el.name) : el.name,
          category: body.category !== undefined ? String(body.category).trim().slice(0, 80) : (el.category || ''),
          description: body.description !== undefined ? String(body.description) : el.description,
          variants: el.variants || []
        };
        await writeJson('elements.json', elements);
        return send(res, 200, elements[idx]);
      }
      if (!isPhotos && req.method === 'DELETE') {
        const links = await readJson('element-links.json', []);
        await writeJson('element-links.json', links.filter((link) => link.elementId !== id));
        elements.splice(idx, 1);
        await writeJson('elements.json', elements);
        await fs.rm(path.join(DATA_DIR, 'elements', id), { recursive: true, force: true }).catch(() => {});
        return send(res, 200, { ok: true });
      }
    }

    // --- Poser: modelos XNALara/XPS (carpetas en assets/poser) y poses ---
    if (p === '/api/poser' && req.method === 'GET') {
      const cfg = await getConfig();
      const base = resolveDir(cfg.paths.poser);
      await fs.mkdir(base, { recursive: true });
      const models = [];
      for (const entry of await fs.readdir(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const files = [];
        const walk = async (rel) => {
          for (const e of await fs.readdir(path.join(base, entry.name, rel), { withFileTypes: true })) {
            if (files.length >= 500) return;
            const relPath = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) await walk(relPath);
            else {
              const st = await fs.stat(path.join(base, entry.name, relPath)).catch(() => null);
              if (st) files.push({ name: relPath, size: st.size });
            }
          }
        };
        await walk('').catch(() => {});
        const meshes = files.filter((f) => /\.(mesh\.ascii|ascii|mesh|xps)$/i.test(f.name));
        if (!meshes.length) continue;
        // si hay varias mallas preferimos la .ascii, que es la más compatible
        const meshFile = (meshes.find((f) => /\.ascii$/i.test(f.name)) || meshes[0]).name;
        models.push({ id: entry.name, name: entry.name, meshFile, files });
      }
      models.sort((a, b) => a.name.localeCompare(b.name));
      const [poses, aliases, bodymap] = await Promise.all([
        readJson('poser-poses.json', []),
        readJson('poser-aliases.json', {}),
        readJson('poser-bodymap.json', {})
      ]);
      return send(res, 200, { models, poses, aliases, bodymap, folder: cfg.paths.poser });
    }
    // --- Photoshop ---
    if (p === '/api/photoshop/detect' && req.method === 'POST') {
      const exe = await detectPhotoshop();
      if (!exe) return send(res, 404, { error: 'No encontré Photoshop instalado. Cargá la ruta a mano.' });
      const cfg = await getConfig();
      await writeJson('config.json', { ...cfg, photoshopPath: exe });
      return send(res, 200, { path: exe });
    }
    if (p === '/api/photoshop/open' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const cfg = await getConfig();
      if (!cfg.photoshopPath) return send(res, 400, { error: 'Configurá la ruta de Photoshop en Configuración (o usá "Detectar").' });
      const exeOk = await fs.access(cfg.photoshopPath).then(() => true, () => false);
      if (!exeOk) return send(res, 400, { error: 'No encuentro Photoshop en la ruta configurada. Revisala en Configuración.' });
      const abs = await resolveAssetKey(String(body.key || ''));
      await fs.access(abs);
      spawn(cfg.photoshopPath, [abs], { detached: true, stdio: 'ignore' }).unref();
      const st = await fs.stat(abs);
      return send(res, 200, { ok: true, mtime: st.mtimeMs });
    }
    if (p === '/api/assets/mtimes' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const keys = Array.isArray(body.keys) ? body.keys.slice(0, 50) : [];
      const out = {};
      for (const key of keys) {
        try { out[key] = (await fs.stat(await resolveAssetKey(String(key)))).mtimeMs; }
        catch { out[key] = null; }
      }
      return send(res, 200, out);
    }

    if (p === '/api/poser/captures' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { buffer } = parseDataUrl(body.dataUrl);
      const dir = path.join(DATA_DIR, 'poser', 'captures');
      await fs.mkdir(dir, { recursive: true });
      const name = `${ts()}-${sanitizeName(body.name).replace(/\.[^.]+$/, '')}.png`;
      await fs.writeFile(path.join(dir, name), buffer);
      return send(res, 200, { key: `poser/captures/${name}` });
    }
    if (p === '/api/poser/aliases' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const modelId = String(body.modelId || '');
      const bone = String(body.bone || '');
      const label = String(body.label || '').trim().slice(0, 60);
      if (!modelId || !bone) throw new Error('Faltan modelo o hueso.');
      const aliases = await updateJson('poser-aliases.json', {}, (all) => {
        const forModel = { ...(all[modelId] || {}) };
        if (label) forModel[bone] = label;
        else delete forModel[bone];
        return { ...all, [modelId]: forModel };
      });
      return send(res, 200, { aliases });
    }
    if (p === '/api/poser/bodymap' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const modelId = String(body.modelId || '');
      const part = String(body.part || '');
      const bone = String(body.bone || '');
      if (!modelId || !part) throw new Error('Faltan modelo o parte del cuerpo.');
      if (!POSER_BODY_PARTS.some((x) => x.id === part)) throw new Error('Parte de cuerpo desconocida.');
      const bodymap = await updateJson('poser-bodymap.json', {}, (all) => {
        const forModel = { ...(all[modelId] || {}) };
        if (bone) forModel[part] = bone;
        else delete forModel[part];
        return { ...all, [modelId]: forModel };
      });
      return send(res, 200, { bodymap });
    }
    if (p === '/api/poser/poses' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const item = {
        id: newId(),
        modelId: String(body.modelId || ''),
        name: String(body.name || '').trim() || 'Pose',
        category: String(body.category || '').trim() || 'General',
        bones: body.bones && typeof body.bones === 'object' ? body.bones : {},
        camera: body.camera && typeof body.camera === 'object' ? body.camera : null,
        hidden: Array.isArray(body.hidden) ? body.hidden.slice(0, 500).map(String) : [],
        thumbKey: null,
        ts: Date.now()
      };
      if (body.thumbDataUrl) {
        const { buffer } = parseDataUrl(body.thumbDataUrl);
        await fs.mkdir(path.join(DATA_DIR, 'poser', 'thumbs'), { recursive: true });
        await fs.writeFile(path.join(DATA_DIR, 'poser', 'thumbs', `${item.id}.png`), buffer);
        item.thumbKey = `poser/thumbs/${item.id}.png`;
      }
      const poses = await updateJson('poser-poses.json', [], (all) => [item, ...all].slice(0, 2000));
      return send(res, 200, { pose: item, poses });
    }
    const poserPoseMatch = /^\/api\/poser\/poses\/([a-z0-9]+)$/.exec(p);
    if (poserPoseMatch && req.method === 'PUT') {
      const body = await readJsonBody(req);
      let updated;
      const poses = await updateJson('poser-poses.json', [], (all) => all.map((x) => {
        if (x.id !== poserPoseMatch[1]) return x;
        updated = {
          ...x,
          name: body.name !== undefined ? String(body.name).trim() || x.name : x.name,
          category: body.category !== undefined ? String(body.category).trim() || 'General' : x.category
        };
        return updated;
      }));
      if (!updated) return send(res, 404, { error: 'Pose no encontrada' });
      return send(res, 200, { pose: updated, poses });
    }
    if (poserPoseMatch && req.method === 'DELETE') {
      const poses = await updateJson('poser-poses.json', [], (all) => all.filter((x) => x.id !== poserPoseMatch[1]));
      await fs.unlink(path.join(DATA_DIR, 'poser', 'thumbs', `${poserPoseMatch[1]}.png`)).catch(() => {});
      return send(res, 200, { poses });
    }

    const variantMatch = /^\/api\/characters\/([a-z0-9]+)\/variants(?:\/([a-z0-9]+))?(\/photos)?$/.exec(p);
    if (variantMatch) {
      const [, id, variantId, isPhotos] = variantMatch;
      const characters = await readJson('characters.json', []);
      const idx = characters.findIndex((c) => c.id === id);
      if (idx === -1) return send(res, 404, { error: 'Personaje no encontrado' });
      const ch = characters[idx];
      ch.variants = ch.variants || [];

      if (!variantId && req.method === 'POST') {
        const body = await readJsonBody(req);
        const variant = { id: newId(), name: String(body.name || '').trim() || 'Nueva variante', description: String(body.description || ''), photos: [], ts: Date.now() };
        ch.variants.push(variant);
        await writeJson('characters.json', characters);
        return send(res, 200, ch);
      }
      const variant = ch.variants.find((v) => v.id === variantId);
      if (!variant) return send(res, 404, { error: 'Variante no encontrada' });
      if (!isPhotos && req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (body.name !== undefined) variant.name = String(body.name).trim() || variant.name;
        if (body.description !== undefined) variant.description = String(body.description);
        await writeJson('characters.json', characters);
        return send(res, 200, ch);
      }
      if (!isPhotos && req.method === 'DELETE') {
        ch.variants = ch.variants.filter((v) => v.id !== variantId);
        const links = await readJson('asset-links.json', []);
        await writeJson('asset-links.json', links.map((link) =>
          link.characterId === id && link.variantId === variantId ? { ...link, variantId: null } : link));
        await writeJson('characters.json', characters);
        await fs.rm(path.join(DATA_DIR, 'characters', id, 'variants', variantId), { recursive: true, force: true }).catch(() => {});
        return send(res, 200, ch);
      }
      if (isPhotos && req.method === 'POST') {
        const body = await readJsonBody(req);
        const dir = path.join(DATA_DIR, 'characters', id, 'variants', variantId);
        await fs.mkdir(dir, { recursive: true });
        let name;
        if (body.assetKey) {
          const assetKey = String(body.assetKey);
          if (!/^(generated|uploads)\//.test(assetKey)) throw new Error('Solo se pueden usar imágenes como foto de variante.');
          const source = await resolveAssetKey(assetKey);
          const ext = path.extname(source).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Formato de imagen no admitido.');
          name = `${ts()}-asset-${newId()}${ext}`;
          await fs.copyFile(source, path.join(dir, name));
        } else {
          const { mime, buffer } = parseDataUrl(body.dataUrl);
          name = `${ts()}-${sanitizeName(body.name).replace(/\.[^.]+$/, '')}${extForMime(mime)}`;
          await fs.writeFile(path.join(dir, name), buffer);
        }
        variant.photos.push(`characters/${id}/variants/${variantId}/${name}`);
        await writeJson('characters.json', characters);
        return send(res, 200, ch);
      }
      if (isPhotos && req.method === 'DELETE') {
        const key = url.searchParams.get('key');
        variant.photos = variant.photos.filter((k) => k !== key);
        if (key) await fs.unlink(await resolveAssetKey(key)).catch(() => {});
        await writeJson('characters.json', characters);
        return send(res, 200, ch);
      }
    }

    const charMatch = /^\/api\/characters\/([a-z0-9]+)(\/photos)?$/.exec(p);
    if (charMatch) {
      const [, id, isPhotos] = charMatch;
      const characters = await readJson('characters.json', []);
      const idx = characters.findIndex((c) => c.id === id);
      if (idx === -1) return send(res, 404, { error: 'Personaje no encontrado' });
      const ch = characters[idx];

      if (isPhotos && req.method === 'POST') {
        const body = await readJsonBody(req);
        const dir = path.join(DATA_DIR, 'characters', id);
        await fs.mkdir(dir, { recursive: true });
        let name;
        if (body.assetKey) {
          const assetKey = String(body.assetKey);
          if (!/^(generated|uploads)\//.test(assetKey)) throw new Error('Solo se pueden usar imágenes como foto de personaje.');
          const source = await resolveAssetKey(assetKey);
          const ext = path.extname(source).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Formato de imagen no admitido.');
          name = `${ts()}-asset-${newId()}${ext}`;
          await fs.copyFile(source, path.join(dir, name));
        } else {
          const { mime, buffer } = parseDataUrl(body.dataUrl);
          name = `${ts()}-${sanitizeName(body.name).replace(/\.[^.]+$/, '')}${extForMime(mime)}`;
          await fs.writeFile(path.join(dir, name), buffer);
        }
        ch.photos.push(`characters/${id}/${name}`);
        await writeJson('characters.json', characters);
        return send(res, 200, ch);
      }
      if (isPhotos && req.method === 'DELETE') {
        const key = url.searchParams.get('key');
        ch.photos = ch.photos.filter((k) => k !== key);
        if (key) await fs.unlink(await resolveAssetKey(key)).catch(() => {});
        await writeJson('characters.json', characters);
        return send(res, 200, ch);
      }
      if (isPhotos && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const order = Array.isArray(body.order) ? body.order.map(String) : [];
        const sameSet = order.length === ch.photos.length
          && new Set(order).size === order.length
          && order.every((k) => ch.photos.includes(k));
        if (!sameSet) return send(res, 400, { error: 'El orden no coincide con las fotos del personaje' });
        ch.photos = order;
        await writeJson('characters.json', characters);
        return send(res, 200, ch);
      }
      if (!isPhotos && req.method === 'PUT') {
        const body = await readJsonBody(req);
        characters[idx] = {
          ...ch,
          name: body.name !== undefined ? String(body.name).trim() : ch.name,
          description: body.description !== undefined ? String(body.description) : ch.description,
          voiceId: body.voiceId !== undefined ? body.voiceId : ch.voiceId,
          voiceName: body.voiceName !== undefined ? body.voiceName : ch.voiceName,
          arkAssetId: body.arkAssetId !== undefined ? String(body.arkAssetId).trim().replace(/^asset:\/\//, '') : (ch.arkAssetId || ''),
          variants: ch.variants || []
        };
        await writeJson('characters.json', characters);
        return send(res, 200, characters[idx]);
      }
      if (!isPhotos && req.method === 'DELETE') {
        const links = await readJson('asset-links.json', []);
        await writeJson('asset-links.json', links.filter((link) => link.characterId !== id));
        await updateJson('series.json', [], (all) => all.map((s) => ({
          ...s,
          characterIds: (s.characterIds || []).filter((cid) => cid !== id)
        })));
        characters.splice(idx, 1);
        await writeJson('characters.json', characters);
        await fs.rm(path.join(DATA_DIR, 'characters', id), { recursive: true, force: true }).catch(() => {});
        return send(res, 200, { ok: true });
      }
    }

    // --- estáticos ---
    if (req.method === 'GET') {
      const rel = p === '/' ? 'index.html' : p.slice(1);
      const abs = path.join(PUBLIC_DIR, rel);
      if (path.resolve(abs).startsWith(path.resolve(PUBLIC_DIR))) {
        const buf = await fs.readFile(abs).catch(() => null);
        if (buf) {
          return send(res, 200, buf, { mime: STATIC_MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
        }
      }
    }

    return send(res, 404, { error: 'Ruta no encontrada' });
  } catch (err) {
    return send(res, 500, { error: err.message || String(err) });
  }
});

// La generación de video mantiene el request abierto varios minutos:
// el timeout por defecto de Node (5 min) lo cortaría a mitad de camino.
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 31 * 60 * 1000;

server.listen(PORT, () => {
  console.log('');
  console.log('  ✨ Manifestador está corriendo');
  console.log(`  →  http://localhost:${PORT}`);
  console.log('');
});
