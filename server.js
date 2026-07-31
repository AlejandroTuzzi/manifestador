// Manifestador — servidor local sin dependencias externas.
// Ejecutar con: npm start   (luego abrir http://localhost:7777)

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';

import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODEL, MUSIC_MODEL, getImageModel, getVideoModel } from './lib/models.js';
import {
  generateGemini, generateSeedream, generateOpenAIImage, generateSeedanceVideo, generateScreenplay,
  listVoices, generateSpeech, generateMusic, translateText, searchUpdatedPricing, testService
} from './lib/providers.js';
import { mergePricing, imagePrice, videoPrice, audioPrice, musicPrice, translatePrice, scriptPrice } from './lib/pricing.js';
import { POSER_BODY_PARTS } from './public/poser-bodyparts.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT ? Number(process.env.PORT) : 7777;
const sessions = new Map();

// Se agrega automáticamente (sin mostrarse en la caja) cuando alguna
// referencia viene del Poser, para que el modelo la tome solo como pose.
const DEFAULT_POSER_PROMPT = 'The attached 3D figure render is ONLY a reference for pose and framing. Exactly replicate the camera position, angle and framing, and the character\'s full body pose — torso, head, arms, hands and legs — precisely matching the reference. Do NOT copy the 3D model\'s appearance: ignore its clothing, colors, materials and anatomy style. The main character must keep their own clothing, facial features and morphology.';

// Se antepone (sin mostrarse en la caja) cuando alguna referencia lleva
// etiqueta estampada. Va PRIMERO y en pocas palabras: cuando la instrucción
// iba al final y describía el cartel en detalle, los modelos lo replicaban
// igual (describir un elemento visual tiende a reforzarlo). Ahora se enuncia
// como una propiedad del resultado —una fotografía limpia, sin sobreimpresos—
// en vez de como una prohibición sobre algo descripto.
const LABELED_REFS_PROMPT = 'The reference images are annotated working proofs: the name tag across the top of each one identifies the subject for you and is not part of its scene. Read the tags, then ignore them. Produce a clean, unannotated photograph: the frame contains only the depicted scene, edge to edge, with no overlay, tag, strip, banner, caption or lettering added on top of it. Text that physically exists inside the scene (signage, posters, packaging, screens, graffiti, or any text the prompt asks for) is rendered as usual.';

const DEFAULT_CONFIG = {
  poserPrompt: DEFAULT_POSER_PROMPT,
  photoshopPath: '',
  ffmpegPath: '',
  keys: { gemini: '', googleTranslate: '', ark: '', elevenlabs: '', openai: '', suno: '' },
  openaiModel: 'gpt-5-mini',
  paths: {
    poser: 'assets/poser',
    video: 'assets/video',
    generated: 'assets/generated',
    uploads: 'assets/uploads',
    audio: 'assets/audio'
  },
  endpoints: {
    ark: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    suno: 'https://api.sunoapi.org'
  },
  seedreamModelId: 'seedream-5-0-lite',
  seedanceModelId: '',
  seedanceMiniModelId: '',
  sunoModelId: 'V5_5',
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
  const dest = path.join(DATA_DIR, file);
  // escritura atómica: si el proceso muere a mitad, el archivo original queda
  // intacto (nunca un JSON a medio escribir). El rename es atómico en el mismo
  // volumen; el tmp lleva el pid para no chocar entre escrituras simultáneas.
  const tmp = `${dest}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, dest);
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

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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

function metadataFromEntry(entry) {
  return {
    prompt: entry.prompt || '', type: entry.type, modelId: entry.modelId,
    modelName: entry.modelName, characterId: entry.characterId || null,
    characterVariantId: entry.characterVariantId || null, ts: entry.ts,
    aspectRatio: entry.aspectRatio || null, resolution: entry.resolution || null,
    batch: entry.batch || 1, refs: entry.refs || [], voiceId: entry.voiceId || null,
    voiceName: entry.voiceName || null, cost: entry.cost || 0
  };
}

// La metadata de cada asset se persiste al generarlo (acá). /api/assets solo la
// lee, sin re-derivarla del historial en cada refresco.
async function recordAssetMetadata(entry) {
  await updateJson('asset-metadata.json', {}, (metadata) => {
    for (const key of entry.outputs || []) metadata[key] = metadataFromEntry(entry);
    return metadata;
  });
}

// Backfill + limpieza de una sola vez por arranque: completa la metadata de
// assets viejos (previos a que se persistiera al generar) desde el historial y
// descarta las entradas huérfanas (archivos borrados por fuera de la app).
// Después de la primera vez, /api/assets solo lee la metadata.
let assetMetadataBackfilled = false;
async function backfilledAssetMetadata(liveKeys = null) {
  const metadata = await readJson('asset-metadata.json', {});
  if (assetMetadataBackfilled) return metadata;
  assetMetadataBackfilled = true;
  const history = await readJson('history.json', []);
  const missing = {};
  for (const entry of history) for (const key of entry.outputs || []) {
    if (!metadata[key]) missing[key] = metadataFromEntry(entry);
  }
  const next = { ...missing, ...metadata };
  // huérfanos: metadata de archivos que ya no existen (borrados por fuera)
  if (liveKeys) for (const key of Object.keys(next)) if (!liveKeys.has(key)) delete next[key];
  const changed = Object.keys(missing).length || (liveKeys && Object.keys(next).length !== Object.keys(metadata).length);
  if (changed) await updateJson('asset-metadata.json', {}, () => next);
  return next;
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

// ffmpeg como binario externo (config.ffmpegPath), igual que Photoshop: mantiene
// la app sin dependencias npm. Devuelve el stderr para diagnosticar si falla.
function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(bin, args, { windowsHide: true });
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', (e) => reject(new Error(`No se pudo ejecutar ffmpeg: ${e.message}`)));
    ps.on('close', (code) => code === 0 ? resolve(err) : reject(new Error(`ffmpeg falló (código ${code}): ${err.slice(-600)}`)));
  });
}

function sanitizeName(name) {
  return String(name || 'archivo').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

// slug legible a partir de un texto: quita [tags] y su interior, deja pocas
// palabras. Sirve para nombrar el audio con una pista de lo que dice.
function textSlug(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-')
    .slice(0, 48)
    .toLowerCase();
}

// nombre de voz apto para archivo, legible (conserva mayúsculas y espacios)
function voiceNameForFile(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

// encuadre de la portada: posición (0–100 por eje) y zoom (1–4)
function sanitizeAvatarPos(pos) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v))));
  const zoom = Number(pos?.zoom);
  return {
    x: Number.isFinite(Number(pos?.x)) ? clamp(pos.x) : 50,
    y: Number.isFinite(Number(pos?.y)) ? clamp(pos.y) : 50,
    zoom: Number.isFinite(zoom) ? Math.max(1, Math.min(4, Math.round(zoom * 100) / 100)) : 1
  };
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
  // la nota de las etiquetas va adelante (los modelos de imagen pesan más lo
  // que leen primero); el prompt del Poser sigue yendo detrás del pedido
  const preface = refs.some((key) => validStamp(labeledRefs[key])) ? LABELED_REFS_PROMPT : '';
  const suffix = hasPoserRef && cfg.poserPrompt?.trim() ? cfg.poserPrompt.trim() : '';
  const sentPrompt = [prompt, suffix].filter(Boolean).join('\n\n');

  const call = async () => {
    switch (model.provider) {
      case 'gemini':
        return generateGemini({
          apiKey: cfg.keys.gemini, apiModel, prompt: sentPrompt, preface, refPaths,
          aspectRatio: req.aspectRatio, resolution: req.resolution,
          supportsSize: model.resolutions.length > 1
        });
      case 'seedream':
        return generateSeedream({
          apiKey: cfg.keys.ark, apiModel, endpoint: cfg.endpoints.ark,
          prompt: sentPrompt, preface, refPaths, aspectRatio: req.aspectRatio, resolution: req.resolution
        });
      case 'openai':
        return generateOpenAIImage({
          apiKey: cfg.keys.openai, apiModel, prompt: sentPrompt, preface, refPaths,
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
  const preface = refs.some((key) => validStamp(labeledRefs[key])) ? LABELED_REFS_PROMPT : '';
  const suffix = hasPoserRef && cfg.poserPrompt?.trim() ? cfg.poserPrompt.trim() : '';
  const sentPrompt = [preface, prompt, suffix].filter(Boolean).join('\n\n');

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
  // nombre: "<voz> - <texto>", el texto sin [corchetes] ni su interior, corto e
  // incremental si ya existe uno igual: "Alejandro - hola-como-estas.mp3", "…-2.mp3"
  const ext = extForMime(mime);
  const slug = textSlug(text) || 'voz';
  const voice = voiceNameForFile(req.voiceName);
  const base = voice ? `${voice} - ${slug}` : slug;
  const audioDir = resolveDir(cfg.paths.audio);
  await fs.mkdir(audioDir, { recursive: true });
  const existing = new Set(await fs.readdir(audioDir).catch(() => []));
  let name = `${base}${ext}`;
  for (let n = 2; existing.has(name); n++) name = `${base}-${n}${ext}`;
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

async function runMusicGeneration(req) {
  const cfg = await getConfig();
  const customMode = Boolean(req.customMode);
  const instrumental = Boolean(req.instrumental);
  const model = MUSIC_MODEL.versions.includes(req.model) ? req.model : (cfg.sunoModelId || MUSIC_MODEL.defaultVersion);
  const prompt = String(req.prompt || '').trim();
  const style = String(req.style || '').trim();
  const title = String(req.title || '').trim();

  const tracks = await generateMusic({
    apiKey: cfg.keys.suno, endpoint: cfg.endpoints.suno,
    model, prompt, style, title, instrumental, customMode
  });

  // las 2 variantes se guardan como audios: "<título> - 1.mp3", "… - 2.mp3"
  const slug = textSlug(title || style || prompt) || 'cancion';
  const audioDir = resolveDir(cfg.paths.audio);
  await fs.mkdir(audioDir, { recursive: true });
  const existing = new Set(await fs.readdir(audioDir).catch(() => []));
  const outputs = [];
  for (const [i, track] of tracks.entries()) {
    let name = `${slug}-${i + 1}.mp3`;
    for (let n = 2; existing.has(name); n++) name = `${slug}-${i + 1}-${n}.mp3`;
    existing.add(name);
    outputs.push(await saveBuffer('audio', name, track.buffer));
  }

  const pricing = await getPricing();
  const cost = musicPrice(pricing) * outputs.length;
  await recordCost({
    type: 'music', modelId: `suno-${model}`, label: `Suno ${model}`,
    units: outputs.length, unitLabel: 'pista(s)', cost
  });

  const entry = {
    id: newId(),
    ts: Date.now(),
    type: 'audio',
    modelId: MUSIC_MODEL.id,
    modelName: `Suno ${model}`,
    prompt: [title, style, prompt].filter(Boolean).join(' · ') || prompt,
    voiceId: null,
    voiceName: '',
    characterId: null,
    outputs,
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
      // los audios van en su propio espacio (audioKeys); si algún audio venía
      // en assetKeys de un guion viejo, se migra acá
      assetKeys: [...new Set((Array.isArray(shot.assetKeys) ? shot.assetKeys : []).map(String))]
        .filter((key) => /^(generated|uploads|video)\//.test(key)).slice(0, 200),
      audioKeys: [...new Set([
        ...(Array.isArray(shot.audioKeys) ? shot.audioKeys : []),
        ...(Array.isArray(shot.assetKeys) ? shot.assetKeys : [])
      ].map(String))].filter((key) => /^audio\//.test(key)).slice(0, 200),
      prompt: String(shot.prompt || '').slice(0, 5000),
      promptId: String(shot.promptId || ''),
      promptTitle: String(shot.promptTitle || '').slice(0, 120)
    }))
  }));
}

// ---------------------------------------------------------------------------
// Automatizador: proyectos con guion propio (bloques prompt+texto), asignación
// de roles a personajes/locaciones/objetos, y config de imagen/voz/texto.
// El guion llega de Controversy Tracker como JSON con roles en MAYÚSCULAS.
// ---------------------------------------------------------------------------

const AUTOMATION_CONTRACT = 'manifestador-production@1';

const DEFAULT_OVERLAY = {
  font: 'sans-serif',
  fontSizePct: 6,          // alto de letra como % del alto de la imagen
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidthPct: 0.5,     // grosor del borde como % del alto
  position: 'bottom',      // preset rápido: top | center | bottom (setea y)
  x: 50,                   // centro del texto, % del ancho (arrastrable)
  y: 88,                   // centro del texto, % del alto (arrastrable)
  align: 'center',         // left | center | right
  maxWidthPct: 88,         // ancho máximo del texto como % del ancho
  bg: false,               // caja semitransparente detrás del texto
  bgColor: '#000000',
  bgOpacity: 0.45,
  highlightColor: '#fbbf24', // color de las palabras dramáticas (highlights)
  previewBg: ''            // asset de fondo SOLO para previsualizar (no se usa al generar)
};

// La voz del narrador es del proyecto; los diálogos usan la voz del personaje
// asignado (si tiene), con la del narrador como respaldo.
const DEFAULT_AUTOMATION_CONFIG = {
  imageModelId: 'nano-banana-pro',
  aspectRatio: '9:16',
  resolution: '2K',
  narratorVoiceId: '',
  narratorVoiceName: '',
  overlay: { ...DEFAULT_OVERLAY }
};

const stripTags = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
const roleId = (r) => String(r || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// normaliza un proyecto (importado o editado); conserva lo previo (asignaciones,
// config, outputs) al re-guardar
function sanitizeAutomation(src, prev = {}) {
  const reqList = (arr, withVoice) => (Array.isArray(arr) ? arr : []).slice(0, 50).map((x) => {
    const role = roleId(x.role);
    if (!role) return null;
    const o = { role, description: String(x.description || '').slice(0, 800) };
    if (withVoice) o.voice = String(x.voice || '');
    return o;
  }).filter(Boolean);

  const requirements = {
    characters: reqList(src.requirements?.characters, true),
    locations: reqList(src.requirements?.locations, false),
    objects: reqList(src.requirements?.objects, false)
  };

  const blocks = (Array.isArray(src.blocks) ? src.blocks : []).slice(0, 500).map((b, i) => {
    // items: narración (voz del narrador) o diálogo (voz del personaje). El
    // texto llega LIMPIO de Controversy Tracker; los tags de emoción para el
    // audio y los highlights los agrega el automatizador. Compatible con los
    // items de los guiones de series (kind + character + text).
    const raw = Array.isArray(b.items) ? b.items : Array.isArray(b.segments) ? b.segments : null;
    let items;
    if (raw) {
      items = raw.slice(0, 60).map((it) => ({
        kind: (/^dialog/i.test(it.kind) || it.character) ? 'dialogue' : 'narration',
        character: roleId(it.character),
        text: stripTags(String(it.text || '')).slice(0, 2000)
      })).filter((it) => it.text);
    } else {
      const t = stripTags(String(b.narration ?? b.text ?? b.caption ?? '')).slice(0, 4000);
      items = t ? [{ kind: 'narration', character: '', text: t }] : [];
    }
    const characters = [...new Set([
      ...(Array.isArray(b.characters) ? b.characters : []).map(roleId),
      ...items.filter((it) => it.kind === 'dialogue').map((it) => it.character)
    ].filter(Boolean))];
    return {
      id: String(b.id || `b${i + 1}`).slice(0, 40),
      title: String(b.title || `Bloque ${i + 1}`).slice(0, 160),
      imagePrompt: String(b.imagePrompt ?? b.prompt ?? '').slice(0, 4000),
      negativePrompt: String(b.negativePrompt || '').slice(0, 2000),
      items,
      characters,
      location: roleId(b.location),
      prop: roleId(b.prop),
      sourceReferences: [...new Set((Array.isArray(b.sourceReferences) ? b.sourceReferences : []).map(String))].slice(0, 20),
      sourceQuote: String(b.sourceQuote || '').slice(0, 4000),
      quoteReference: String(b.quoteReference || '').slice(0, 80),
      estimatedDuration: Math.max(0, Math.min(3600, Number(b.estimatedDuration) || 0))
    };
  });

  const projectData = src.project && typeof src.project === 'object' ? src.project : null;
  const scriptData = src.script && typeof src.script === 'object' ? src.script : null;
  return {
    id: prev.id || newId(),
    name: String(projectData?.name ?? src.project ?? src.name ?? prev.name ?? 'Proyecto').trim().slice(0, 120) || 'Proyecto',
    requirements,
    blocks,
    assignments: prev.assignments || { characters: {}, locations: {}, objects: {} },
    config: prev.config || { ...DEFAULT_AUTOMATION_CONFIG },
    outputs: prev.outputs || {},
    integration: src.schema === AUTOMATION_CONTRACT ? {
      contract: AUTOMATION_CONTRACT,
      source: String(projectData?.source || 'controversy-tracker').slice(0, 80),
      externalProjectId: String(projectData?.id || '').slice(0, 120),
      externalScriptId: String(scriptData?.id || '').slice(0, 120),
      sourceUrl: String(projectData?.sourceUrl || '').slice(0, 2000),
      generatedAt: String(src.generatedAt || ''),
      scriptTitle: String(scriptData?.title || '').slice(0, 160),
      premise: String(scriptData?.premise || '').slice(0, 4000),
      conclusion: String(scriptData?.conclusion || '').slice(0, 4000)
    } : prev.integration,
    ts: prev.ts || Date.now(),
    updatedAt: Date.now()
  };
}

function validateAutomationSource(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) {
    throw new Error('El guion debe ser un objeto JSON.');
  }
  if (src.schema !== undefined && src.schema !== AUTOMATION_CONTRACT) {
    throw new Error(`Contrato no compatible: se esperaba ${AUTOMATION_CONTRACT}.`);
  }
  if (src.schema !== AUTOMATION_CONTRACT) {
    if (!Array.isArray(src.blocks)) {
      if (Array.isArray(src.cycles)) {
        throw new Error('Este archivo es una cola de ComfyUI. Exportá “Guion para Manifestador” desde Controversy Tracker.');
      }
      throw new Error('El JSON no contiene una lista blocks válida.');
    }
    return src;
  }

  if (!src.project || typeof src.project !== 'object' || !String(src.project.id || '').trim() || !String(src.project.name || '').trim()) {
    throw new Error('El contrato no contiene un proyecto válido.');
  }
  if (!src.script || typeof src.script !== 'object' || !String(src.script.id || '').trim()) {
    throw new Error('El contrato no contiene un identificador de guion.');
  }
  if (!src.requirements || typeof src.requirements !== 'object') {
    throw new Error('El contrato no contiene requirements.');
  }
  for (const kind of ['characters', 'locations', 'objects']) {
    if (!Array.isArray(src.requirements[kind])) throw new Error(`requirements.${kind} debe ser una lista.`);
  }
  if (!Array.isArray(src.blocks) || !src.blocks.length) {
    throw new Error('El guion para Manifestador no contiene bloques.');
  }

  const declared = {
    characters: new Set(src.requirements.characters.map((item) => roleId(item?.role)).filter(Boolean)),
    locations: new Set(src.requirements.locations.map((item) => roleId(item?.role)).filter(Boolean)),
    objects: new Set(src.requirements.objects.map((item) => roleId(item?.role)).filter(Boolean))
  };
  const allDeclared = new Set([...declared.characters, ...declared.locations, ...declared.objects]);
  if (allDeclared.size !== declared.characters.size + declared.locations.size + declared.objects.size) {
    throw new Error('Un mismo rol no puede declararse como más de un tipo de ficha.');
  }

  src.blocks.forEach((block, index) => {
    if (!block || typeof block !== 'object') throw new Error(`El bloque ${index + 1} no es válido.`);
    if (!String(block.imagePrompt || '').trim()) throw new Error(`El bloque ${index + 1} no tiene prompt visual.`);
    if (!Array.isArray(block.items) || !block.items.some((item) => String(item?.text || '').trim())) {
      throw new Error(`El bloque ${index + 1} no tiene texto para producir.`);
    }
    const characters = new Set((Array.isArray(block.characters) ? block.characters : []).map(roleId).filter(Boolean));
    for (const item of block.items) {
      if (item?.kind === 'dialogue') characters.add(roleId(item.character));
    }
    if ([...characters].some((role) => !declared.characters.has(role))) {
      throw new Error(`El bloque ${index + 1} usa un personaje no declarado.`);
    }
    const location = roleId(block.location);
    const prop = roleId(block.prop);
    if (location && !declared.locations.has(location)) throw new Error(`El bloque ${index + 1} usa una locación no declarada.`);
    if (prop && !declared.objects.has(prop)) throw new Error(`El bloque ${index + 1} usa un objeto no declarado.`);
    const assigned = new Set([...characters, location, prop].filter(Boolean));
    const promptRoles = [...String(block.imagePrompt).matchAll(/@([A-Za-z0-9_]+)/g)].map((match) => roleId(match[1]));
    if (promptRoles.some((role) => !allDeclared.has(role) || !assigned.has(role))) {
      throw new Error(`El prompt del bloque ${index + 1} contiene un @ROLE no declarado o no asignado.`);
    }
  });
  return src;
}

function sanitizeScriptCast(list, characters) {
  return (Array.isArray(list) ? list : []).slice(0, 50).map((ch) => ({
    id: newId(),
    characterId: characters.some((c) => c.id === ch.characterId) ? ch.characterId : '',
    name: String(ch.name || '').trim().slice(0, 80),
    role: String(ch.role || '').slice(0, 160)
  })).filter((ch) => ch.name);
}

// ---------------------------------------------------------------------------
// Entidades con fotos y variantes: personajes y "elementos" (locaciones/objetos)
// comparten toda la lógica de fotos, variantes y vínculos. Solo cambian los
// campos propios y el archivo de vínculos, definidos en el "meta" de cada uno.
// Todo pasa por updateJson → escrituras atómicas y sin pisarse entre sí.
// ---------------------------------------------------------------------------

const ENTITY_META = {
  characters: {
    base: 'characters',
    file: 'characters.json',
    linksPath: '/api/asset-links',
    linksFile: 'asset-links.json',
    ownerField: 'characterId',
    notFound: 'Personaje no encontrado',
    allowReorder: true,
    buildCreate: (body) => ({
      name: String(body.name || '').trim() || 'Sin nombre',
      description: String(body.description || ''),
      voiceId: body.voiceId || '',
      voiceName: body.voiceName || '',
      arkAssetId: String(body.arkAssetId || '').trim().replace(/^asset:\/\//, '')
    }),
    applyUpdate: (e, body) => {
      if (body.name !== undefined) e.name = String(body.name).trim() || e.name;
      if (body.description !== undefined) e.description = String(body.description);
      if (body.voiceId !== undefined) e.voiceId = body.voiceId;
      if (body.voiceName !== undefined) e.voiceName = body.voiceName;
      if (body.arkAssetId !== undefined) e.arkAssetId = String(body.arkAssetId).trim().replace(/^asset:\/\//, '');
    },
    onDelete: async (id) => {
      await updateJson('asset-links.json', [], (links) => links.filter((l) => l.characterId !== id));
      await updateJson('series.json', [], (all) => all.map((s) => ({
        ...s, characterIds: (s.characterIds || []).filter((cid) => cid !== id)
      })));
    }
  },
  elements: {
    base: 'elements',
    file: 'elements.json',
    linksPath: '/api/element-links',
    linksFile: 'element-links.json',
    ownerField: 'elementId',
    notFound: 'Locación u objeto no encontrado',
    allowReorder: false,
    buildCreate: (body) => ({
      kind: body.kind === 'object' ? 'object' : 'location',
      name: String(body.name || '').trim() || 'Sin nombre',
      category: String(body.category || '').trim().slice(0, 80),
      description: String(body.description || '')
    }),
    applyUpdate: (e, body) => {
      if (body.kind !== undefined) e.kind = body.kind === 'object' ? 'object' : 'location';
      if (body.name !== undefined) e.name = String(body.name).trim() || e.name;
      if (body.category !== undefined) e.category = String(body.category).trim().slice(0, 80);
      if (body.description !== undefined) e.description = String(body.description);
    },
    onDelete: async (id) => {
      await updateJson('element-links.json', [], (links) => links.filter((l) => l.elementId !== id));
    }
  }
};

// copia un asset (o guarda un dataUrl) como foto y devuelve el nombre de archivo
async function saveEntityPhoto(destDir, body) {
  await fs.mkdir(destDir, { recursive: true });
  if (body.assetKey) {
    const assetKey = String(body.assetKey);
    if (!/^(generated|uploads)\//.test(assetKey)) throw new Error('Solo se pueden usar imágenes como foto.');
    const source = await resolveAssetKey(assetKey);
    const ext = path.extname(source).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Formato de imagen no admitido.');
    const name = `${ts()}-asset-${newId()}${ext}`;
    await fs.copyFile(source, path.join(destDir, name));
    return name;
  }
  const { mime, buffer } = parseDataUrl(body.dataUrl);
  const name = `${ts()}-${sanitizeName(body.name).replace(/\.[^.]+$/, '')}${extForMime(mime)}`;
  await fs.writeFile(path.join(destDir, name), buffer);
  return name;
}

// resuelve las rutas de una entidad; devuelve true si la manejó, false si no
async function serveEntityRoutes(meta, { p, req, res, url }) {
  const { base, file, linksPath, linksFile, ownerField, notFound } = meta;

  // crear
  if (p === `/api/${base}` && req.method === 'POST') {
    const body = await readJsonBody(req);
    const item = { id: newId(), ...meta.buildCreate(body), photos: [], variants: [], avatarPos: { x: 50, y: 50, zoom: 1 }, ts: Date.now() };
    await updateJson(file, [], (all) => [item, ...all]);
    send(res, 200, item);
    return true;
  }

  // vínculos asset ↔ entidad
  if (p === linksPath && req.method === 'POST') {
    const body = await readJsonBody(req);
    const key = String(body.key || '');
    if (!/^(generated|uploads)\//.test(key)) throw new Error('Solo se pueden asociar imágenes.');
    await fs.access(await resolveAssetKey(key));
    const owner = (await readJson(file, [])).find((e) => e.id === body[ownerField]);
    if (!owner) throw new Error(`${notFound}.`);
    const variantId = body.variantId || null;
    if (variantId && !(owner.variants || []).some((v) => v.id === variantId)) throw new Error('Variante no encontrada.');
    const next = await updateJson(linksFile, [], (links) =>
      [{ key, [ownerField]: owner.id, variantId, ts: Date.now() }, ...links.filter((l) => l.key !== key)].slice(0, 10000));
    send(res, 200, { links: next });
    return true;
  }
  if (p === linksPath && req.method === 'DELETE') {
    const key = url.searchParams.get('key');
    const next = await updateJson(linksFile, [], (links) => links.filter((l) => l.key !== key));
    send(res, 200, { links: next });
    return true;
  }

  // variantes: /api/{base}/:id/variants[/:vid][/photos]
  const vm = new RegExp(`^/api/${base}/([a-z0-9]+)/variants(?:/([a-z0-9]+))?(/photos)?$`).exec(p);
  if (vm) {
    const [, id, variantId, isPhotos] = vm;

    if (!variantId && req.method === 'POST') {
      const body = await readJsonBody(req);
      let out = null;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        if (!e) return all;
        e.variants = e.variants || [];
        e.variants.push({ id: newId(), name: String(body.name || '').trim() || 'Nueva variante', description: String(body.description || ''), photos: [], ts: Date.now() });
        out = e; return all;
      });
      return out ? (send(res, 200, out), true) : (send(res, 404, { error: notFound }), true);
    }

    if (variantId && isPhotos && req.method === 'POST') {
      const body = await readJsonBody(req);
      const destDir = path.join(DATA_DIR, base, id, 'variants', variantId);
      const name = await saveEntityPhoto(destDir, body);
      let out = null, bad = null;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        const v = e && (e.variants || []).find((x) => x.id === variantId);
        if (!e) { bad = notFound; return all; }
        if (!v) { bad = 'Variante no encontrada'; return all; }
        v.photos.push(`${base}/${id}/variants/${variantId}/${name}`);
        out = e; return all;
      });
      if (bad) { await fs.unlink(path.join(destDir, name)).catch(() => {}); return send(res, 404, { error: bad }), true; }
      return send(res, 200, out), true;
    }

    if (variantId && !isPhotos && req.method === 'PUT') {
      const body = await readJsonBody(req);
      let out = null, bad = null;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        const v = e && (e.variants || []).find((x) => x.id === variantId);
        if (!v) { bad = e ? 'Variante no encontrada' : notFound; return all; }
        if (body.name !== undefined) v.name = String(body.name).trim() || v.name;
        if (body.description !== undefined) v.description = String(body.description);
        // ficha de personaje: una foto de la variante como imagen canónica
        if (body.sheet !== undefined) v.sheet = (v.photos || []).includes(body.sheet) ? body.sheet : '';
        out = e; return all;
      });
      return bad ? (send(res, 404, { error: bad }), true) : (send(res, 200, out), true);
    }

    if (variantId && !isPhotos && req.method === 'DELETE') {
      let out = null, found = false;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        if (!e) return all;
        found = (e.variants || []).some((v) => v.id === variantId);
        e.variants = (e.variants || []).filter((v) => v.id !== variantId);
        out = e; return all;
      });
      if (!out) return send(res, 404, { error: notFound }), true;
      if (found) {
        await updateJson(linksFile, [], (links) => links.map((l) =>
          l[ownerField] === id && l.variantId === variantId ? { ...l, variantId: null } : l));
        await fs.rm(path.join(DATA_DIR, base, id, 'variants', variantId), { recursive: true, force: true }).catch(() => {});
      }
      return send(res, 200, out), true;
    }

    if (variantId && isPhotos && req.method === 'DELETE') {
      const key = url.searchParams.get('key');
      let out = null;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        const v = e && (e.variants || []).find((x) => x.id === variantId);
        if (v) { v.photos = v.photos.filter((k) => k !== key); if (v.sheet === key) v.sheet = ''; }
        out = e; return all;
      });
      if (!out) return send(res, 404, { error: notFound }), true;
      if (key) await fs.unlink(await resolveAssetKey(key)).catch(() => {});
      return send(res, 200, out), true;
    }
  }

  // entidad: /api/{base}/:id[/photos]
  const em = new RegExp(`^/api/${base}/([a-z0-9]+)(/photos)?$`).exec(p);
  if (em) {
    const [, id, isPhotos] = em;

    if (isPhotos && req.method === 'POST') {
      const body = await readJsonBody(req);
      const name = await saveEntityPhoto(path.join(DATA_DIR, base, id), body);
      let out = null;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        if (e) e.photos.push(`${base}/${id}/${name}`);
        out = e; return all;
      });
      if (!out) { await fs.unlink(path.join(DATA_DIR, base, id, name)).catch(() => {}); return send(res, 404, { error: notFound }), true; }
      return send(res, 200, out), true;
    }
    if (isPhotos && req.method === 'DELETE') {
      const key = url.searchParams.get('key');
      let out = null;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        if (e) { e.photos = e.photos.filter((k) => k !== key); if (e.sheet === key) e.sheet = ''; }
        out = e; return all;
      });
      if (!out) return send(res, 404, { error: notFound }), true;
      if (key) await fs.unlink(await resolveAssetKey(key)).catch(() => {});
      return send(res, 200, out), true;
    }
    if (isPhotos && req.method === 'PUT' && meta.allowReorder) {
      const body = await readJsonBody(req);
      const order = Array.isArray(body.order) ? body.order.map(String) : [];
      let out = null, mismatch = false;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        if (!e) return all;
        const same = order.length === e.photos.length && new Set(order).size === order.length && order.every((k) => e.photos.includes(k));
        if (!same) { mismatch = true; return all; }
        e.photos = order; out = e; return all;
      });
      if (mismatch) return send(res, 400, { error: 'El orden no coincide con las fotos' }), true;
      return out ? (send(res, 200, out), true) : (send(res, 404, { error: notFound }), true);
    }
    if (!isPhotos && req.method === 'PUT') {
      const body = await readJsonBody(req);
      let out = null;
      await updateJson(file, [], (all) => {
        const e = all.find((x) => x.id === id);
        if (!e) return all;
        meta.applyUpdate(e, body);
        if (body.avatarPos !== undefined) e.avatarPos = sanitizeAvatarPos(body.avatarPos);
        // ficha del Original: una de sus fotos como imagen canónica
        if (body.sheet !== undefined) e.sheet = (e.photos || []).includes(body.sheet) ? body.sheet : '';
        e.variants = e.variants || [];
        out = e; return all;
      });
      return out ? (send(res, 200, out), true) : (send(res, 404, { error: notFound }), true);
    }
    if (!isPhotos && req.method === 'DELETE') {
      let existed = false;
      await updateJson(file, [], (all) => {
        existed = all.some((x) => x.id === id);
        return all.filter((x) => x.id !== id);
      });
      if (!existed) return send(res, 404, { error: notFound }), true;
      await meta.onDelete(id);
      await fs.rm(path.join(DATA_DIR, base, id), { recursive: true, force: true }).catch(() => {});
      send(res, 200, { ok: true });
      return true;
    }
  }

  return false;
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

    // Integración local servidor-a-servidor con Controversy Tracker. Usa la
    // misma clave de acceso de Manifestador, pero nunca depende de cookies.
    if (p === '/api/integrations/controversy-tracker/health' && req.method === 'GET') {
      if (!isLoopbackRequest(req)) return send(res, 403, { error: 'La integración con Controversy Tracker sólo admite conexiones locales.' });
      const cfg = await getConfig();
      const key = String(req.headers['x-manifestador-access-key'] || '');
      if (cfg.accessPasswordHash && !verifyPassword(key, cfg.accessPasswordHash)) {
        return send(res, 401, { error: 'La clave de acceso de Manifestador no es válida.' });
      }
      return send(res, 200, {
        ok: true,
        service: 'manifestador',
        contract: AUTOMATION_CONTRACT,
        protected: Boolean(cfg.accessPasswordHash)
      });
    }
    if (p === '/api/integrations/controversy-tracker/projects' && req.method === 'POST') {
      if (!isLoopbackRequest(req)) return send(res, 403, { error: 'La integración con Controversy Tracker sólo admite conexiones locales.' });
      const cfg = await getConfig();
      const key = String(req.headers['x-manifestador-access-key'] || '');
      if (cfg.accessPasswordHash && !verifyPassword(key, cfg.accessPasswordHash)) {
        return send(res, 401, { error: 'La clave de acceso de Manifestador no es válida.' });
      }
      let source;
      try {
        source = validateAutomationSource(await readJsonBody(req));
      } catch (error) {
        return send(res, 400, { error: error.message || 'Guion para Manifestador no válido.' });
      }
      if (source.schema !== AUTOMATION_CONTRACT) {
        return send(res, 400, { error: `La conexión directa requiere el contrato ${AUTOMATION_CONTRACT}.` });
      }
      const externalProjectId = String(source.project.id);
      let out = null;
      let created = false;
      await updateJson('automations.json', [], (all) => {
        const index = all.findIndex((item) => item.integration?.externalProjectId === externalProjectId);
        if (index === -1) {
          out = sanitizeAutomation(source);
          created = true;
          return [out, ...all];
        }
        out = sanitizeAutomation(source, all[index]);
        all[index] = out;
        return all;
      });
      return send(res, 200, {
        automationId: out.id,
        externalProjectId,
        importedBlocks: out.blocks.length,
        created,
        status: 'ready-for-assignment'
      });
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
      // Soporte de rangos: el navegador lo necesita para saber la duración de
      // audios/videos VBR (busca hasta el final) y para hacer scrubbing.
      const range = req.headers.range;
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
        if (start > end || start >= buf.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` });
          return res.end();
        }
        res.writeHead(206, {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${buf.length}`,
          'Content-Length': end - start + 1
        });
        return res.end(buf.subarray(start, end + 1));
      }
      return send(res, 200, buf, { mime, extra: { 'Accept-Ranges': 'bytes' } });
    }

    // --- API ---
    if (p === '/api/state' && req.method === 'GET') {
      const [cfg, characters, prompts, promptCategories, history, pricing, assetLinks, series, scripts, elements, elementLinks, automations] = await Promise.all([
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
        readJson('element-links.json', []),
        readJson('automations.json', [])
      ]);
      return send(res, 200, {
        config: publicConfig(cfg),
        models: IMAGE_MODELS,
        videoModels: VIDEO_MODELS,
        audioModel: AUDIO_MODEL,
        musicModel: MUSIC_MODEL,
        characters,
        prompts,
        promptCategories,
        history: history.slice(0, 200),
        pricing,
        assetLinks,
        series,
        scripts,
        elements,
        elementLinks,
        automations
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
        sunoModelId: body.sunoModelId ?? cfg.sunoModelId,
        openaiModel: body.openaiModel ?? cfg.openaiModel,
        poserPrompt: body.poserPrompt !== undefined ? String(body.poserPrompt) : cfg.poserPrompt,
        photoshopPath: body.photoshopPath !== undefined ? String(body.photoshopPath).trim() : cfg.photoshopPath,
        ffmpegPath: body.ffmpegPath !== undefined ? String(body.ffmpegPath).trim() : cfg.ffmpegPath,
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
      const [generated, uploads, audio, video] = await Promise.all([
        listZone('generated'), listZone('uploads'), listZone('audio'), listZone('video')
      ]);
      const all = [...generated, ...uploads, ...audio, ...video];
      const metadata = await backfilledAssetMetadata(new Set(all.map((a) => a.key)));
      for (const item of all) Object.assign(item, metadata[item.key] || {});
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
      // el updater re-busca la serie bajo el lock; devuelve null si no existe
      const mutateSeries = async (fn) => {
        let out = null;
        await updateJson('series.json', [], (all) => {
          const s = all.find((x) => x.id === seriesId);
          if (s) { fn(s); out = s; }
          return all;
        });
        return out;
      };

      if (isSeriesAssets && req.method === 'POST') {
        const body = await readJsonBody(req);
        const keys = [...new Set((Array.isArray(body.keys) ? body.keys : [body.key]).map(String).filter(Boolean))];
        if (!keys.length) throw new Error('No se indicó ningún asset.');
        if (keys.length > 1000) throw new Error('Demasiados assets en una sola operación.');
        for (const key of keys) {
          if (!/^(generated|uploads|video|audio)\//.test(key)) throw new Error(`Ese archivo no se puede asociar a una serie: ${key}`);
          await fs.access(await resolveAssetKey(key));
        }
        const item = await mutateSeries((s) => { s.assetKeys = [...keys, ...(s.assetKeys || []).filter((k) => !keys.includes(k))]; });
        return item ? send(res, 200, item) : send(res, 404, { error: 'Serie no encontrada' });
      }
      if (isSeriesAssets && req.method === 'DELETE') {
        const key = url.searchParams.get('key');
        const item = await mutateSeries((s) => { s.assetKeys = (s.assetKeys || []).filter((k) => k !== key); });
        return item ? send(res, 200, item) : send(res, 404, { error: 'Serie no encontrada' });
      }
      if (!isSeriesAssets && req.method === 'PUT') {
        const body = await readJsonBody(req);
        let validIds = null;
        if (body.characterIds !== undefined) {
          const characters = await readJson('characters.json', []);
          validIds = [...new Set((Array.isArray(body.characterIds) ? body.characterIds : []).map(String))]
            .filter((cid) => characters.some((c) => c.id === cid));
        }
        const item = await mutateSeries((s) => {
          if (body.title !== undefined) s.title = String(body.title).trim() || s.title;
          if (body.description !== undefined) s.description = String(body.description);
          if (body.format !== undefined) s.format = body.format === '16:9' ? '16:9' : '9:16';
          if (body.chapters !== undefined) s.chapters = Math.max(1, Math.min(500, parseInt(body.chapters, 10) || 1));
          if (body.chapterSeconds !== undefined) s.chapterSeconds = Math.max(1, Math.min(36000, parseInt(body.chapterSeconds, 10) || 60));
          if (validIds) s.characterIds = validIds;
        });
        return item ? send(res, 200, item) : send(res, 404, { error: 'Serie no encontrada' });
      }
      if (!isSeriesAssets && req.method === 'DELETE') {
        let existed = false;
        await updateJson('series.json', [], (all) => { existed = all.some((s) => s.id === seriesId); return all.filter((s) => s.id !== seriesId); });
        if (!existed) return send(res, 404, { error: 'Serie no encontrada' });
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
        await updateJson('series.json', [], (all) => all.map((s) =>
          s.id === serie.id ? { ...s, characterIds: [...new Set([...(s.characterIds || []), ...matched])] } : s));
        serie.characterIds = [...new Set([...(serie.characterIds || []), ...matched])];
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
        let out = null;
        await updateJson('scripts.json', [], (all) => {
          const i = all.findIndex((sc) => sc.id === scriptId);
          if (i === -1) return all;
          all[i] = {
            ...all[i],
            title: body.title !== undefined ? (String(body.title).trim().slice(0, 140) || all[i].title) : all[i].title,
            summary: body.summary !== undefined ? String(body.summary).slice(0, 3000) : all[i].summary,
            format: SCRIPT_FORMATS.includes(body.format) ? body.format : all[i].format,
            characters: body.characters !== undefined ? sanitizeScriptCast(body.characters, characters) : all[i].characters,
            scenes: body.scenes !== undefined ? sanitizeScriptScenes(body.scenes) : all[i].scenes,
            updatedAt: Date.now()
          };
          out = all[i]; return all;
        });
        return out ? send(res, 200, out) : send(res, 404, { error: 'Guion no encontrado' });
      }

      if (!isGenerate && req.method === 'DELETE') {
        await updateJson('scripts.json', [], (all) => all.filter((sc) => sc.id !== scriptId));
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
        let out = null;
        await updateJson('scripts.json', [], (all) => {
          const i = all.findIndex((sc) => sc.id === scriptId);
          if (i === -1) return all;
          all[i] = {
            ...all[i],
            title: String(generated.title || all[i].title).trim().slice(0, 140) || all[i].title,
            scenes: sanitizeScriptScenes(generated.scenes),
            updatedAt: Date.now()
          };
          out = all[i]; return all;
        });
        return out ? send(res, 200, out) : send(res, 404, { error: 'Guion no encontrado' });
      }
    }

    // --- automatizaciones ---
    if (p === '/api/automations' && req.method === 'POST') {
      const body = await readJsonBody(req);
      // { data } = importar de Controversy Tracker; si no, proyecto vacío con { name }
      let source = { name: body.name, blocks: [] };
      if (body.data && typeof body.data === 'object') {
        try {
          source = validateAutomationSource(body.data);
        } catch (error) {
          return send(res, 400, { error: error.message || 'Guion JSON no válido.' });
        }
      }
      const item = sanitizeAutomation(source);
      await updateJson('automations.json', [], (all) => [item, ...all]);
      return send(res, 200, item);
    }

    const automationMatch = /^\/api\/automations\/([a-z0-9]+)$/.exec(p);
    if (automationMatch) {
      const projectId = automationMatch[1];
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        let out = null;
        await updateJson('automations.json', [], (all) => {
          const i = all.findIndex((x) => x.id === projectId);
          if (i === -1) return all;
          const prev = all[i];
          // se puede actualizar nombre, asignaciones, config y (al reimportar) el guion
          const next = { ...prev };
          if (body.name !== undefined) next.name = String(body.name).trim().slice(0, 120) || prev.name;
          if (body.assignments !== undefined) next.assignments = {
            characters: { ...(body.assignments.characters || {}) },
            locations: { ...(body.assignments.locations || {}) },
            objects: { ...(body.assignments.objects || {}) }
          };
          if (body.config !== undefined) next.config = { ...prev.config, ...body.config, overlay: { ...prev.config.overlay, ...(body.config.overlay || {}) } };
          // outputs por bloque (imagen, imagen+texto, audios, video) — se mergea por id de bloque
          if (body.outputs !== undefined && body.outputs && typeof body.outputs === 'object') next.outputs = { ...prev.outputs, ...body.outputs };
          if (body.data !== undefined) {
            const re = sanitizeAutomation(body.data, prev);
            next.requirements = re.requirements; next.blocks = re.blocks; next.name = re.name;
          }
          next.updatedAt = Date.now();
          all[i] = next; out = next; return all;
        });
        return out ? send(res, 200, out) : send(res, 404, { error: 'Proyecto no encontrado' });
      }
      if (req.method === 'DELETE') {
        await updateJson('automations.json', [], (all) => all.filter((x) => x.id !== projectId));
        return send(res, 200, { ok: true });
      }
    }

    // Muxea el video de un bloque: imagen fija (ya con el texto quemado) + audio(s)
    // en secuencia → mp4 que dura lo que el audio. El overlay lo quema el cliente
    // por canvas (WYSIWYG con el visualizador); acá solo se arma el video.
    const automationVideoMatch = /^\/api\/automations\/([a-z0-9]+)\/video$/.exec(p);
    if (automationVideoMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const cfg = await getConfig();
      if (!cfg.ffmpegPath) return send(res, 400, { error: 'Configurá la ruta de ffmpeg en Configuración para armar el video.' });
      const imageKey = String(body.imageKey || '');
      const audioKeys = (Array.isArray(body.audioKeys) ? body.audioKeys : []).map(String).filter((k) => /^audio\//.test(k));
      if (!/^(generated|uploads)\//.test(imageKey)) return send(res, 400, { error: 'Falta la imagen del bloque.' });
      if (!audioKeys.length) return send(res, 400, { error: 'Falta el audio del bloque.' });
      const imgPath = await resolveAssetKey(imageKey);
      const audioPaths = [];
      for (const k of audioKeys) audioPaths.push(await resolveAssetKey(k));
      const name = `${ts()}-auto-${newId()}.mp4`;
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, name);
      const args = ['-y', '-loop', '1', '-i', imgPath];
      for (const a of audioPaths) args.push('-i', a);
      if (audioPaths.length > 1) {
        const inputs = audioPaths.map((_, i) => `[${i + 1}:a]`).join('');
        args.push('-filter_complex', `${inputs}concat=n=${audioPaths.length}:v=0:a=1[a]`, '-map', '0:v', '-map', '[a]');
      } else {
        args.push('-map', '0:v', '-map', '1:a');
      }
      // dimensiones pares (requisito de yuv420p) y cierre al terminar el audio
      args.push('-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-r', '25',
        '-c:a', 'aac', '-b:a', '192k', '-shortest', outPath);
      await runFfmpeg(cfg.ffmpegPath, args);
      const key = `video/${name}`;
      const category = String(body.category || '').slice(0, 80);
      await updateJson('asset-metadata.json', {}, (m) => {
        m[key] = { type: 'video', modelId: 'ffmpeg', modelName: 'Automatizador', ts: Date.now(), category, automationId: automationVideoMatch[1], blockId: String(body.blockId || '') };
        return m;
      });
      return send(res, 200, { videoKey: key });
    }

    // Etiqueta assets con la categoría del proyecto (y bloque) para agruparlos en Assets.
    if (p === '/api/assets/tag' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).filter(Boolean);
      await updateJson('asset-metadata.json', {}, (m) => {
        for (const k of keys) m[k] = {
          ...(m[k] || {}),
          category: body.category !== undefined ? String(body.category).slice(0, 80) : m[k]?.category,
          automationId: body.automationId !== undefined ? String(body.automationId) : m[k]?.automationId,
          blockId: body.blockId !== undefined ? String(body.blockId) : m[k]?.blockId,
          autoKind: body.autoKind !== undefined ? String(body.autoKind) : m[k]?.autoKind
        };
        return m;
      });
      return send(res, 200, { ok: true });
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

    if (p === '/api/generate/music' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const entry = await runMusicGeneration(body);
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
      const endpoint = body.endpoint || (service === 'ark' ? cfg.endpoints.ark : service === 'suno' ? cfg.endpoints.suno : '');
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
      const item = {
        id: newId(),
        title: String(body.title || '').trim() || 'Sin título',
        text: String(body.text || ''),
        mode: ['audio', 'video'].includes(body.mode) ? body.mode : 'image',
        category: String(body.category || '').trim() || 'General',
        ts: Date.now()
      };
      await updateJson('prompts.json', [], (all) => [item, ...all]);
      return send(res, 200, item);
    }
    if (p.startsWith('/api/prompts/') && req.method === 'PUT') {
      const id = p.split('/').pop();
      const body = await readJsonBody(req);
      let out = null;
      await updateJson('prompts.json', [], (all) => {
        const i = all.findIndex((x) => x.id === id);
        if (i === -1) return all;
        all[i] = {
          ...all[i],
          title: body.title !== undefined ? String(body.title).trim() || 'Sin título' : all[i].title,
          text: body.text !== undefined ? String(body.text) : all[i].text,
          category: body.category !== undefined ? String(body.category).trim() || 'General' : (all[i].category || 'General'),
          mode: body.mode !== undefined ? (['audio', 'video'].includes(body.mode) ? body.mode : 'image') : all[i].mode
        };
        out = all[i]; return all;
      });
      return out ? send(res, 200, out) : send(res, 404, { error: 'Prompt no encontrado' });
    }
    if (p.startsWith('/api/prompts/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      await updateJson('prompts.json', [], (all) => all.filter((x) => x.id !== id));
      return send(res, 200, { ok: true });
    }

    // --- historial ---
    if (p.startsWith('/api/history/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      await updateJson('history.json', [], (all) => all.filter((x) => x.id !== id));
      return send(res, 200, { ok: true });
    }
    if (p === '/api/history' && req.method === 'DELETE') {
      let deleted = 0;
      await updateJson('history.json', [], (all) => { deleted = all.length; return []; });
      return send(res, 200, { ok: true, deleted });
    }

    // --- borrado de assets (los archivos se eliminan de disco) ---
    // renombrar un asset: renombra el archivo y actualiza TODAS las referencias
    // (metadata, vínculos, series, guiones, historial) para no romper nada.
    if (p === '/api/assets/rename' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const oldKey = String(body.key || '');
      if (!/^(generated|uploads|audio|video)\//.test(oldKey)) throw new Error('Ese asset no se puede renombrar.');
      const zone = oldKey.split('/')[0];
      const ext = path.extname(oldKey);
      const base = sanitizeName(body.name || '').replace(/\.[^.]+$/, '').replace(/^[.\-_]+/, '') || 'archivo';
      const abs = await resolveAssetKey(oldKey);
      const dir = path.dirname(abs);
      const existing = new Set(await fs.readdir(dir).catch(() => []));
      const oldName = path.basename(abs);
      existing.delete(oldName);
      let newName = `${base}${ext}`;
      for (let n = 2; existing.has(newName); n++) newName = `${base}-${n}${ext}`;
      const newKey = `${zone}/${newName}`;
      if (newKey === oldKey) return send(res, 200, { oldKey, newKey });
      await fs.rename(abs, path.join(dir, newName));
      const swap = (k) => (k === oldKey ? newKey : k);
      await updateJson('asset-metadata.json', {}, (m) => {
        if (m[oldKey]) { m[newKey] = m[oldKey]; delete m[oldKey]; }
        return m;
      });
      await updateJson('asset-links.json', [], (links) => links.map((l) => l.key === oldKey ? { ...l, key: newKey } : l));
      await updateJson('element-links.json', [], (links) => links.map((l) => l.key === oldKey ? { ...l, key: newKey } : l));
      await updateJson('series.json', [], (all) => all.map((s) => ({ ...s, assetKeys: (s.assetKeys || []).map(swap) })));
      await updateJson('scripts.json', [], (all) => all.map((sc) => ({
        ...sc,
        scenes: (sc.scenes || []).map((scene) => ({
          ...scene,
          shots: (scene.shots || []).map((shot) => ({
            ...shot,
            assetKeys: (shot.assetKeys || []).map(swap),
            audioKeys: (shot.audioKeys || []).map(swap)
          }))
        }))
      })));
      await updateJson('history.json', [], (all) => all.map((e) => ({
        ...e, outputs: (e.outputs || []).map(swap), refs: (e.refs || []).map(swap)
      })));
      return send(res, 200, { oldKey, newKey, name: newName });
    }

    // descarga en lote: ZIP con los assets seleccionados (nombres únicos)
    if (p === '/api/assets/zip' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const keys = [...new Set(Array.isArray(body.keys) ? body.keys.map(String) : [])]
        .filter((key) => /^(generated|uploads|audio|video)\//.test(key));
      if (!keys.length) throw new Error('No se seleccionaron assets.');
      if (keys.length > 2000) throw new Error('Demasiados assets en una sola descarga.');
      const used = new Set();
      const entries = [];
      for (const key of keys) {
        const buf = await fs.readFile(await resolveAssetKey(key)).catch(() => null);
        if (!buf) continue;
        let name = decodeURIComponent(key.split('/').pop());
        if (used.has(name)) {
          const ext = path.extname(name); const base = name.slice(0, -ext.length || undefined);
          let n = 2; while (used.has(`${base}-${n}${ext}`)) n++;
          name = `${base}-${n}${ext}`;
        }
        used.add(name);
        entries.push({ name, data: buf });
      }
      if (!entries.length) throw new Error('No se encontró ninguno de los archivos.');
      const zip = createZip(entries);
      const filename = `manifestador-${entries.length}-assets.zip`;
      return send(res, 200, zip, { mime: 'application/zip', extra: { 'Content-Disposition': `attachment; filename="${filename}"` } });
    }

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
      await updateJson('asset-metadata.json', {}, (meta) => {
        for (const key of removed) delete meta[key];
        return meta;
      });
      await updateJson('asset-links.json', [], (links) => links.filter((link) => !removed.has(link.key)));
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
      const cleaned = await updateJson('history.json', [], (all) => all.map((entry) => ({
        ...entry,
        outputs: (entry.outputs || []).filter((key) => !removed.has(key)),
        refs: (entry.refs || []).filter((key) => !removed.has(key))
      })).filter((entry) => entry.outputs.length));
      return send(res, 200, { ok: true, deleted: allowed.length, history: cleaned.slice(0, 200) });
    }

    // --- personajes y elementos: fotos, variantes, vínculos y CRUD compartidos ---
    if (await serveEntityRoutes(ENTITY_META.characters, { p, req, res, url })) return;
    if (await serveEntityRoutes(ENTITY_META.elements, { p, req, res, url })) return;

    // import/export son exclusivos de personajes (ZIP con manifest)
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

    // export de guion: ZIP con los assets asignados a cada plano, nombrados por
    // escena y plano (E01_P01.02_01.jpg) y agrupados en carpetas por escena,
    // listos para ordenar en el programa de animación.
    const scriptExportMatch = /^\/api\/scripts\/([a-z0-9]+)\/export$/.exec(p);
    if (scriptExportMatch && req.method === 'GET') {
      const scripts = await readJson('scripts.json', []);
      const script = scripts.find((s) => s.id === scriptExportMatch[1]);
      if (!script) return send(res, 404, { error: 'Guion no encontrado' });
      const pad = (n) => String(n).padStart(2, '0');
      const entries = [];
      const lines = [`${script.title}`, `${script.format || ''}`.trim(), ''];
      for (const [si, scene] of (script.scenes || []).entries()) {
        const SS = pad(si + 1);
        const slug = `${scene.intExt}. ${(scene.location || '').toUpperCase()} — ${scene.timeOfDay}`;
        const folder = `Escena ${SS}${scene.location ? ' - ' + sanitizeName(scene.location).slice(0, 40) : ''}`;
        lines.push(`ESCENA ${si + 1} · ${slug}`);
        for (const [hi, shot] of (scene.shots || []).entries()) {
          const HH = pad(hi + 1);
          lines.push(`  Plano ${si + 1}.${hi + 1} · ${shot.size} · ${shot.lens}${shot.camera ? ` · ${shot.camera}` : ''}`);
          for (const item of shot.items || []) {
            lines.push(item.kind === 'dialogue' ? `    ${item.character}: ${item.text}` : `    ${item.text}`);
          }
          if (shot.prompt) lines.push(`    [prompt] ${shot.promptTitle ? shot.promptTitle + ': ' : ''}${shot.prompt}`);
          for (const [ai, key] of (shot.assetKeys || []).entries()) {
            const buf = await fs.readFile(await resolveAssetKey(key)).catch(() => null);
            if (!buf) continue;
            const ext = path.extname(key).toLowerCase() || '.jpg';
            const file = `${folder}/E${SS}_P${SS}.${HH}_${pad(ai + 1)}${ext}`;
            entries.push({ name: file, data: buf });
            lines.push(`      → ${file}`);
          }
          for (const [ai, key] of (shot.audioKeys || []).entries()) {
            const buf = await fs.readFile(await resolveAssetKey(key)).catch(() => null);
            if (!buf) continue;
            const ext = path.extname(key).toLowerCase() || '.mp3';
            const file = `${folder}/E${SS}_P${SS}.${HH}_audio${pad(ai + 1)}${ext}`;
            entries.push({ name: file, data: buf });
            lines.push(`      ♪ ${file}`);
          }
          lines.push('');
        }
      }
      entries.unshift({ name: 'guion.txt', data: Buffer.from(lines.join('\n'), 'utf8') });
      const zip = createZip(entries);
      const filename = `${sanitizeName(script.title || 'guion').replace(/\.[^.]+$/, '')}.assets.zip`;
      return send(res, 200, zip, { mime: 'application/zip', extra: { 'Content-Disposition': `attachment; filename="${filename}"` } });
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
