// Manifestador — servidor local sin dependencias externas.
// Ejecutar con: npm start   (luego abrir http://localhost:7777)

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';

import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS, AUDIO_MODEL, MUSIC_MODEL, getImageModel, getVideoModel, getAudioModel } from './lib/models.js';
import {
  generateGemini, analyzeArtStyle, generateSeedream, generateOpenAIImage, generateSeedanceVideo,
  generateMiniMaxH3Video, regenerateMiniMaxH3Video, generateScreenplay,
  listVoices, generateSpeech, generateMusic, translateText, searchUpdatedPricing, testService
} from './lib/providers.js';
import { mergePricing, imagePrice, videoPrice, audioPrice, musicPrice, translatePrice, scriptPrice } from './lib/pricing.js';
import { renderDynamicTextOverlay } from './lib/remotion-renderer.js';
import { POSER_BODY_PARTS } from './public/poser-bodyparts.js';
import {
  registerHeyGenOAuthClient, heyGenAuthorizationUrl, exchangeHeyGenOAuthCode,
  refreshHeyGenOAuthToken, getHeyGenMcpUser, getHeyGenApiUser,
  uploadHeyGenAssetWithKey, uploadHeyGenAssetWithMcp,
  createHeyGenVideoWithKey, createHeyGenVideoWithMcp,
  getHeyGenVideoWithKey, getHeyGenVideoWithMcp,
  waitForHeyGenVideo, downloadHeyGenVideo
} from './lib/heygen.js';
import {
  TUZZI_TYPES, loadWorkflow, scanWorkflowSlots, comfyResolutionPixels, fillSlots,
  submitPrompt, watchProgress, waitForHistory, extractOutputs, downloadView, checkComfyHealth
} from './lib/comfyBridge.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const AUTOMATION_LOGO_DIR = path.join(PUBLIC_DIR, 'logos');
const AUTOMATION_SOUND_DIR = path.join(PUBLIC_DIR, 'sounds');
const AUTOMATION_LOGOS = {
  horizontal: 'logo-controversy-tracker-horizontal.mp4',
  vertical: 'logo-controversy-tracker-vertical.mp4'
};
const AUTOMATION_LOGO_FADE_SECONDS = 0.75;
const PORT = process.env.PORT ? Number(process.env.PORT) : 7777;
const sessions = new Map();
const automationAssemblyJobs = new Set();
const heygenOAuthStates = new Map();
const comfyProgress = new Map(); // genId -> { current, total }

// Se agrega automáticamente (sin mostrarse en la caja) cuando alguna
// referencia viene del Poser, para que el modelo la tome solo como pose.
const DEFAULT_POSER_PROMPT = 'The attached 3D figure render is ONLY a reference for pose and framing. Exactly replicate the camera position, angle and framing, and the character\'s full body pose — torso, head, arms, hands and legs — precisely matching the reference. Do NOT copy the 3D model\'s appearance: ignore its clothing, colors, materials and anatomy style. The main character must keep their own clothing, facial features and morphology.';

// Se antepone (sin mostrarse en la caja) cuando alguna referencia lleva
// etiqueta estampada. Va PRIMERO y en pocas palabras: cuando la instrucción
// iba al final y describía el cartel en detalle, los modelos lo replicaban
// igual (describir un elemento visual tiende a reforzarlo). Ahora se enuncia
// como una propiedad del resultado —una fotografía limpia, sin sobreimpresos—
// en vez de como una prohibición sobre algo descripto.
const LABELED_REFS_PROMPT = 'The reference images are annotated working proofs. A name tag identifies the subject to preserve; a tag reading ARTISTIC STYLE identifies a style-only reference, from which you must use only its medium, technique, lighting, palette, texture and overall visual treatment, never its people, objects, setting, action or composition. The tags are instructions, not part of any scene. Read them, then ignore their graphic appearance. Produce a clean, unannotated image with no overlay, tag, strip, banner, caption or lettering added on top. Text that physically exists inside the requested scene is rendered as usual.';

const DEFAULT_CONFIG = {
  poserPrompt: DEFAULT_POSER_PROMPT,
  photoshopPath: '',
  ffmpegPath: '',
  keys: { gemini: '', googleTranslate: '', ark: '', minimax: '', elevenlabs: '', openai: '', suno: '', heygen: '' },
  openaiModel: 'gpt-5-mini',
  audioModelId: AUDIO_MODEL.id,
  heygenAuthMode: 'key',
  paths: {
    poser: 'assets/poser',
    video: 'assets/video',
    generated: 'assets/generated',
    uploads: 'assets/uploads',
    audio: 'assets/audio'
  },
  endpoints: {
    ark: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    minimax: 'https://api.minimax.io',
    suno: 'https://api.sunoapi.org'
  },
  seedreamModelId: 'seedream-5-0-lite',
  seedanceModelId: '',
  seedanceMiniModelId: '',
  sunoModelId: 'V5_5',
  customAudioTags: [],
  accessPasswordHash: '',
  comfyui: { host: '127.0.0.1', port: 8188, workflowPath: '' }
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
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  let renamed = false;
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await fs.rename(tmp, dest);
        renamed = true;
        break;
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt === 5) throw error;
        // Windows puede bloquear el destino durante unos milisegundos por el
        // antivirus, el indexador o una vista previa. Reintentamos sin perder
        // el JSON original ni reutilizar el mismo temporal entre escrituras.
        await new Promise((resolve) => setTimeout(resolve, 40 * (2 ** attempt)));
      }
    }
  } finally {
    if (!renamed) await fs.unlink(tmp).catch(() => {});
  }
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
    endpoints: Object.fromEntries(Object.keys(DEFAULT_CONFIG.endpoints).map((key) => [key, savedEndpoints[key] || DEFAULT_CONFIG.endpoints[key]])),
    comfyui: { ...DEFAULT_CONFIG.comfyui, ...(cfg.comfyui || {}) }
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

function oauthRedirectUri(req) {
  const host = String(req.headers.host || `localhost:${PORT}`);
  return `http://${host}/api/heygen/oauth/callback`;
}

function oauthExpiry(token) {
  return Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000;
}

async function getHeyGenOAuth({ refresh = true } = {}) {
  const auth = await readJson('heygen-oauth.json', {});
  if (!auth.accessToken) throw new Error('HeyGen OAuth no está conectado. Conectalo desde Configuración.');
  if (!refresh || auth.expiresAt > Date.now() + 60_000) return auth;
  if (!auth.refreshToken || !auth.clientId) throw new Error('La sesión OAuth de HeyGen venció. Volvé a conectarla.');
  const token = await refreshHeyGenOAuthToken({ clientId: auth.clientId, refreshToken: auth.refreshToken });
  const next = {
    ...auth,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || auth.refreshToken,
    expiresAt: oauthExpiry(token),
    scope: token.scope || auth.scope,
    updatedAt: Date.now()
  };
  await writeJson('heygen-oauth.json', next);
  return next;
}

function safeHeyGenAccount(value) {
  const data = value?.data || value || {};
  return {
    id: data.id || data.user_id || '',
    name: data.name || data.username || '',
    email: data.email || '',
    billingType: data.billing_type || data.billingType || '',
    balance: data.balance ?? data.credit_balance ?? null
  };
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
    voiceName: entry.voiceName || null, cost: entry.cost || 0,
    audioKind: entry.audioKind || (entry.modelId === MUSIC_MODEL.id ? 'music' : entry.type === 'audio' ? 'voice' : null),
    musicTags: normalizeMusicTags(entry.musicTags)
  };
}

function sanitizeAudioKind(value, fallback = 'voice') {
  return ['voice', 'music', 'sound'].includes(value) ? value : fallback;
}

function sanitizeMusicTagList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  return source.map((tag) => String(tag || '').trim().replace(/\s+/g, ' ').slice(0, 60))
    .filter((tag) => tag && !seen.has(tag.toLocaleLowerCase('es')) && seen.add(tag.toLocaleLowerCase('es')))
    .slice(0, 30);
}

function normalizeMusicTags(value = {}) {
  return {
    genres: sanitizeMusicTagList(value.genres ?? value.genre),
    instruments: sanitizeMusicTagList(value.instruments ?? value.instrument ?? value.instrumentation),
    moods: sanitizeMusicTagList(value.moods ?? value.mood ?? value.feelings ?? value.feeling ?? value.sentiments ?? value.sentiment ?? value.emotions)
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

function sanitizeVisualCategory(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeVisualTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  return source.map((tag) => String(tag || '').trim().replace(/\s+/g, ' ').slice(0, 50))
    .filter((tag) => tag && !seen.has(tag.toLocaleLowerCase('es')) && seen.add(tag.toLocaleLowerCase('es')))
    .slice(0, 40);
}

function validateUploadedVisual(mime, buffer, originalName = '') {
  const lowerMime = String(mime || '').toLowerCase();
  const lowerName = String(originalName || '').toLowerCase();
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const isMp4Family = buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  const isWebm = buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  const looksLikeImage = lowerMime.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lowerName);
  if (isPng && looksLikeImage) return { kind: 'image', zone: 'uploads', extension: '.png', mime: 'image/png' };
  if (isJpeg && looksLikeImage) return { kind: 'image', zone: 'uploads', extension: '.jpg', mime: 'image/jpeg' };
  if (isWebp && looksLikeImage) return { kind: 'image', zone: 'uploads', extension: '.webp', mime: 'image/webp' };
  if (isWebm && (lowerMime.startsWith('video/') || lowerName.endsWith('.webm'))) return { kind: 'video', zone: 'video', extension: '.webm', mime: 'video/webm' };
  if (isMp4Family && (lowerMime.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(lowerName))) {
    const isMov = lowerMime === 'video/quicktime' || lowerName.endsWith('.mov');
    return { kind: 'video', zone: 'video', extension: isMov ? '.mov' : '.mp4', mime: isMov ? 'video/quicktime' : 'video/mp4' };
  }
  throw new Error('El archivo debe ser una imagen PNG/JPG/WebP o un video MP4/MOV/WebM válido.');
}

function heyGenMotionPromptValue(heygen = {}, field = 'wideMotionPrompt') {
  const source = heygen && typeof heygen === 'object' ? heygen : {};
  const value = Object.prototype.hasOwnProperty.call(source, field) ? source[field] : source.motionPrompt;
  return String(value || '').trim().slice(0, 1000);
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function extForMime(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return '.mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave') return '.wav';
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

// Acepta tanto la ruta completa al ejecutable como su carpeta (por ejemplo
// C:\ffmpeg\bin). Esto evita intentar hacer spawn() sobre un directorio.
async function resolveFfmpegExecutable(configuredPath) {
  const configured = String(configuredPath || '').trim().replace(/^"(.*)"$/, '$1');
  if (!configured) throw new Error('Configurá la ruta de ffmpeg en Configuración para armar el video.');
  const stat = await fs.stat(configured).catch(() => null);
  const candidates = stat?.isDirectory()
    ? [path.join(configured, 'ffmpeg.exe'), path.join(configured, 'ffmpeg')]
    : [configured];
  for (const candidate of candidates) {
    const candidateStat = await fs.stat(candidate).catch(() => null);
    if (candidateStat?.isFile()) return candidate;
  }
  throw new Error(`No encuentro ffmpeg en “${configured}”. Elegí la carpeta bin o el archivo ffmpeg.exe.`);
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

async function probeVideoDimensions(ffmpegExecutable, videoPath) {
  const extension = path.extname(ffmpegExecutable).toLowerCase() === '.exe' ? '.exe' : '';
  const ffprobe = path.join(path.dirname(ffmpegExecutable), `ffprobe${extension}`);
  const stat = await fs.stat(ffprobe).catch(() => null);
  if (!stat?.isFile()) return null;
  return new Promise((resolve) => {
    execFile(ffprobe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      videoPath
    ], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const stream = JSON.parse(stdout)?.streams?.[0];
        const width = Math.floor(Number(stream?.width) / 2) * 2;
        const height = Math.floor(Number(stream?.height) / 2) * 2;
        resolve(width > 0 && height > 0 ? { width, height } : null);
      } catch {
        resolve(null);
      }
    });
  });
}

async function probeMediaDuration(ffmpegExecutable, mediaPath) {
  const extension = path.extname(ffmpegExecutable).toLowerCase() === '.exe' ? '.exe' : '';
  const ffprobe = path.join(path.dirname(ffmpegExecutable), `ffprobe${extension}`);
  const stat = await fs.stat(ffprobe).catch(() => null);
  if (!stat?.isFile()) return null;
  return new Promise((resolve) => {
    execFile(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      mediaPath
    ], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      const duration = Number(String(stdout || '').trim());
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    });
  });
}

async function dominantVideoDimensions(ffmpegExecutable, videoPaths) {
  const dimensions = (await Promise.all(
    videoPaths.map((videoPath) => probeVideoDimensions(ffmpegExecutable, videoPath))
  )).filter(Boolean);
  if (!dimensions.length) return null;
  const counts = new Map();
  for (const item of dimensions) {
    const key = `${item.width}x${item.height}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return dimensions.reduce((best, item) => {
    const itemCount = counts.get(`${item.width}x${item.height}`) || 0;
    const bestCount = counts.get(`${best.width}x${best.height}`) || 0;
    return itemCount > bestCount ? item : best;
  }, dimensions[0]);
}

function automationVideoDimensions(aspectRatio) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspectRatio || '9:16'));
  const ratioWidth = Number(match?.[1]) || 9;
  const ratioHeight = Number(match?.[2]) || 16;
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  if (ratioWidth >= ratioHeight) {
    const height = 1080;
    return { width: even(height * ratioWidth / ratioHeight), height };
  }
  const width = 1080;
  return { width, height: even(width * ratioHeight / ratioWidth) };
}

const AUTOMATION_VIDEO_EFFECTS = Object.freeze({
  wiggle: { name: 'Wiggle suave' },
  oldFilm: { name: 'Cinta vieja' },
  vhs: { name: 'VHS' }
});

function normalizeAutomationVideoEffect(saved = {}) {
  const preset = Object.hasOwn(AUTOMATION_VIDEO_EFFECTS, saved?.preset) ? saved.preset : 'wiggle';
  const enteredIntensity = Number(saved?.intensity);
  const enteredMaskOpacity = Number(saved?.maskOpacity);
  const maskColor = /^#[0-9a-f]{6}$/i.test(String(saved?.maskColor || ''))
    ? String(saved.maskColor).toLowerCase()
    : '#000000';
  return {
    enabled: saved?.enabled === true,
    preset,
    intensity: Number.isFinite(enteredIntensity) ? Math.max(0, Math.min(100, Math.round(enteredIntensity))) : 35,
    maskEnabled: saved?.maskEnabled === true,
    maskColor,
    maskOpacity: Number.isFinite(enteredMaskOpacity) ? Math.max(0, Math.min(100, Math.round(enteredMaskOpacity))) : 10
  };
}

async function validateMiniMaxH3Media(mediaRefs, ffmpegExecutable) {
  const limits = { image: 30, video: 50, audio: 15 };
  const allowed = {
    image: new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']),
    video: new Set(['.mp4', '.mov']),
    audio: new Set(['.mp3', '.wav'])
  };
  const totals = { video: 0, audio: 0 };
  for (const ref of mediaRefs) {
    if (String(ref.path || '').startsWith('data:')) continue;
    const kind = ['image', 'video', 'audio'].includes(ref.kind) ? ref.kind : 'image';
    const extension = path.extname(ref.path).toLowerCase();
    if (!allowed[kind].has(extension)) {
      throw new Error(`MiniMax H3 no admite ${extension || 'ese formato'} como ${kind === 'image' ? 'imagen' : kind === 'video' ? 'video' : 'audio'} de referencia.`);
    }
    const stat = await fs.stat(ref.path);
    if (stat.size > limits[kind] * 1024 * 1024) {
      throw new Error(`Una referencia de ${kind === 'image' ? 'imagen' : kind === 'video' ? 'video' : 'audio'} supera ${limits[kind]} MB, el máximo de MiniMax H3.`);
    }
    if (kind === 'video' || kind === 'audio') {
      const duration = await probeMediaDuration(ffmpegExecutable, ref.path);
      if (!duration || duration < 2 || duration > 15.01) {
        throw new Error(`Cada ${kind === 'video' ? 'video' : 'audio'} de referencia H3 debe durar entre 2 y 15 segundos.`);
      }
      totals[kind] += duration;
    }
  }
  if (totals.video > 15.01) throw new Error('Los videos de referencia H3 no pueden superar 15 segundos en total.');
  if (totals.audio > 15.01) throw new Error('Los audios de referencia H3 no pueden superar 15 segundos en total.');
}

async function probeHasAudioStream(ffmpegExecutable, mediaPath) {
  const extension = path.extname(ffmpegExecutable).toLowerCase() === '.exe' ? '.exe' : '';
  const ffprobe = path.join(path.dirname(ffmpegExecutable), `ffprobe${extension}`);
  const stat = await fs.stat(ffprobe).catch(() => null);
  if (!stat?.isFile()) return false;
  return new Promise((resolve) => {
    execFile(ffprobe, [
      '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index',
      '-of', 'default=noprint_wrappers=1:nokey=1', mediaPath
    ], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(!error && String(stdout || '').trim() !== '');
    });
  });
}

function automationVideoMaskFilter(effect) {
  const normalized = normalizeAutomationVideoEffect(effect);
  if (!normalized.maskEnabled || normalized.maskOpacity <= 0) return '';
  const color = normalized.maskColor.slice(1);
  const opacity = (normalized.maskOpacity / 100).toFixed(3);
  return `,drawbox=x=0:y=0:w=iw:h=ih:color=0x${color}@${opacity}:t=fill`;
}

// Devuelve una cadena de filtros que siempre conserva las dimensiones originales.
// La intensidad se traduce a rangos deliberadamente moderados: 100% sigue siendo
// utilizable para texto y rostros, pero deja el efecto claramente visible.
function automationVideoEffectFilters(effect, width, height) {
  const normalized = normalizeAutomationVideoEffect(effect);
  const amount = normalized.intensity / 100;
  if (normalized.intensity === 0) return 'setsar=1,format=yuv420p';
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  const margin = even(Math.max(8, Math.min(width, height) * (0.012 + amount * 0.028)));
  const scaledWidth = even(width + margin * 2);
  const scaledHeight = even(height + margin * 2);

  if (normalized.preset === 'oldFilm') {
    const jitterX = (0.4 + amount * 2.8).toFixed(2);
    const jitterY = (0.25 + amount * 1.8).toFixed(2);
    const brightness = (0.004 + amount * 0.024).toFixed(4);
    const noise = Math.round(3 + amount * 19);
    const saturation = (0.9 - amount * 0.32).toFixed(3);
    const contrast = (1.03 + amount * 0.18).toFixed(3);
    const vignetteAngle = (Math.PI / (5.2 - amount * 1.7)).toFixed(4);
    return [
      `scale=${scaledWidth}:${scaledHeight}`,
      `crop=${width}:${height}:x='(in_w-out_w)/2+${jitterX}*sin(2*PI*t*8.7)':y='(in_h-out_h)/2+${jitterY}*sin(2*PI*t*6.1)'`,
      `eq=contrast=${contrast}:brightness='${brightness}*sin(2*PI*t*4.3)':saturation=${saturation}:eval=frame`,
      `noise=alls=${noise}:allf=t+u`,
      `vignette=angle=${vignetteAngle}`,
      'setsar=1',
      'format=yuv420p'
    ].join(',');
  }

  if (normalized.preset === 'vhs') {
    const jitterX = (1 + amount * 7).toFixed(2);
    const jitterY = (0.3 + amount * 2.2).toFixed(2);
    const channelShift = Math.max(1, Math.round(1 + amount * 8));
    const noise = Math.round(2 + amount * 13);
    const scanOpacity = (0.035 + amount * 0.13).toFixed(3);
    const scanHeight = Math.max(3, Math.round(height / 180));
    const saturation = (0.98 - amount * 0.22).toFixed(3);
    const contrast = (1.01 + amount * 0.11).toFixed(3);
    return [
      `scale=${scaledWidth}:${scaledHeight}`,
      `crop=${width}:${height}:x='(in_w-out_w)/2+${jitterX}*sin(2*PI*t*11.3)':y='(in_h-out_h)/2+${jitterY}*sin(2*PI*t*7.1)'`,
      `rgbashift=rh=${channelShift}:bh=-${channelShift}:edge=smear`,
      `eq=contrast=${contrast}:brightness=-0.008:saturation=${saturation}`,
      `noise=alls=${noise}:allf=t+u`,
      `drawgrid=w=iw:h=${scanHeight}:t=1:c=black@${scanOpacity}`,
      'setsar=1',
      'format=yuv420p'
    ].join(',');
  }

  const angle = (0.0015 + amount * 0.011).toFixed(5);
  const x = (0.5 + amount * 5.5).toFixed(2);
  const y = (0.35 + amount * 3.8).toFixed(2);
  const frequency = (0.55 + amount * 0.7).toFixed(2);
  return [
    `scale=${scaledWidth}:${scaledHeight}`,
    `rotate='${angle}*sin(2*PI*t*${frequency})':ow=iw:oh=ih:c=black@0`,
    `crop=${width}:${height}:x='(in_w-out_w)/2+${x}*sin(2*PI*t*1.17)':y='(in_h-out_h)/2+${y}*sin(2*PI*t*0.91)'`,
    'setsar=1',
    'format=yuv420p'
  ].join(',');
}

function automationLogoForDimensions(width, height) {
  const variant = height > width ? 'vertical' : 'horizontal';
  return {
    variant,
    fileName: AUTOMATION_LOGOS[variant],
    filePath: path.join(AUTOMATION_LOGO_DIR, AUTOMATION_LOGOS[variant])
  };
}

const TRANSITION_SOUND_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg']);

async function listTransitionSounds() {
  const categories = (await fs.readdir(AUTOMATION_SOUND_DIR, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const sounds = [];
  for (const categoryEntry of categories) {
    const category = categoryEntry.name;
    const categoryDir = path.join(AUTOMATION_SOUND_DIR, category);
    const files = (await fs.readdir(categoryDir, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && TRANSITION_SOUND_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const file of files) {
      const id = `${category}/${file.name}`;
      sounds.push({
        id,
        category,
        name: path.basename(file.name, path.extname(file.name)).replace(/[_-]+/g, ' '),
        url: `/sounds/${[category, file.name].map(encodeURIComponent).join('/')}`,
        filePath: path.join(categoryDir, file.name)
      });
    }
  }
  return sounds;
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
  // Este flujo es exclusivamente de imagen: `mode` pertenece a video y no
  // existe aquí. Las referencias etiquetadas siempre necesitan su prefacio.
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

// El key de un asset ya guardado se sirve tal cual en /files/. Una ref que
// todavía es un data: URL (etiquetada, o recién subida sin guardar) se
// escribe como archivo temporal bajo la zona "uploads" y se borra al final,
// haya salido bien la corrida o no.
async function resolveComfyRefUrl(key, tempFiles) {
  if (!key) return null;
  let assetKey = key;
  if (String(key).startsWith('data:')) {
    const { mime, buffer } = parseDataUrl(key);
    const name = `${ts()}-comfy-tmp-${newId()}${extForMime(mime)}`;
    assetKey = await saveBuffer('uploads', name, buffer);
    tempFiles.push(assetKey);
  }
  const filesPath = '/files/' + assetKey.split('/').map(encodeURIComponent).join('/');
  return `http://127.0.0.1:${PORT}${filesPath}`;
}

// No es un modelo del catálogo: ComfyUI es un único destino de paso. El
// usuario arma y mantiene su propio workflow en ComfyUI; acá solo se buscan
// los nodos Tuzzi reconocidos y se llenan los que estén presentes.
async function runComfyUIGeneration(req) {
  const cfg = await getConfig();
  const prompt = String(req.prompt || '').trim();
  if (!prompt) throw new Error('El prompt está vacío.');

  const graph = await loadWorkflow(cfg.comfyui.workflowPath);
  const slots = scanWorkflowSlots(graph);
  const hasOutput = slots[TUZZI_TYPES.outputImage] || slots[TUZZI_TYPES.outputVideo] || slots[TUZZI_TYPES.outputAudio];
  if (!hasOutput) {
    throw new Error('Este workflow no tiene ningún nodo Tuzzi de salida (Imagen/Video/Audio) — Manifestador no podría recibir el resultado.');
  }

  const refsIn = req.refs && typeof req.refs === 'object' ? req.refs : {};
  const tempFiles = [];
  const genId = String(req.genId || '').trim();
  let stopProgress = null;
  try {
    const [reference, poseControlNet, poseIpAdapter] = await Promise.all([
      resolveComfyRefUrl(refsIn.reference, tempFiles),
      resolveComfyRefUrl(refsIn.poseControlNet, tempFiles),
      resolveComfyRefUrl(refsIn.poseIpAdapter, tempFiles)
    ]);
    const [width, height] = comfyResolutionPixels(req.aspectRatio, req.resolution);
    const filled = fillSlots(graph, slots, { prompt, reference, poseControlNet, poseIpAdapter, width, height });

    const clientId = crypto.randomUUID();
    const promptId = await submitPrompt(cfg, filled, clientId);
    if (genId) {
      comfyProgress.set(genId, { current: 0, total: 0 });
      stopProgress = watchProgress(cfg, clientId, promptId, (p) => comfyProgress.set(genId, p));
    }

    const historyEntry = await waitForHistory(cfg, promptId);
    const outputGroups = extractOutputs(historyEntry, slots);
    if (!outputGroups.length) {
      throw new Error('ComfyUI terminó, pero ninguno de tus nodos Tuzzi de salida produjo un archivo (revisá el workflow en la interfaz de ComfyUI).');
    }

    const zoneFor = { image: 'generated', video: 'video', audio: 'audio' };
    const entries = [];
    for (const group of outputGroups) {
      const outputs = [];
      for (const file of group.files) {
        const buffer = await downloadView(cfg, file);
        const name = `${ts()}-comfyui-${newId()}${path.extname(file.filename) || ''}`;
        outputs.push(await saveBuffer(zoneFor[group.kind], name, buffer));
      }
      const entry = {
        id: newId(), ts: Date.now(), type: group.kind, modelId: 'comfyui', modelName: 'ComfyUI',
        prompt, aspectRatio: req.aspectRatio || 'auto', resolution: req.resolution || 'auto',
        refs: Object.values(refsIn).filter(Boolean), outputs, errors: [], cost: 0,
        comfyPromptId: promptId, comfyWorkflowPath: cfg.comfyui.workflowPath
      };
      await updateJson('history.json', [], (history) => [entry, ...history].slice(0, 1000));
      await recordAssetMetadata(entry);
      entries.push(entry);
    }
    return entries[0];
  } finally {
    stopProgress?.();
    if (genId) comfyProgress.delete(genId);
    for (const key of tempFiles) await fs.unlink(await resolveAssetKey(key)).catch(() => {});
  }
}

async function runHeyGenVideoGeneration(req, cfg, model) {
  const prompt = String(req.prompt || '').trim();
  if (!prompt) throw new Error('El texto que dirá el avatar está vacío.');
  if (prompt.length > 5000) throw new Error('HeyGen admite hasta 5000 caracteres por video.');

  const authMode = req.heygenAuthMode === 'key' ? 'key' : 'oauth';
  const apiKey = String(cfg.keys.heygen || '').trim();
  const oauth = authMode === 'oauth' ? await getHeyGenOAuth() : null;
  if (authMode === 'key' && !apiKey) throw new Error('Falta la API key de HeyGen en Configuración.');
  const aspectRatio = model.aspectRatios.includes(req.aspectRatio) ? req.aspectRatio : model.aspectRatios[0];
  const resolution = model.resolutions.includes(req.resolution) ? req.resolution : model.resolutions[0];
  const voiceId = String(req.heygenVoiceId || '').trim();
  const idempotencyKey = String(req.idempotencyKey || crypto.randomUUID()).slice(0, 120);
  let payload;
  let refs = [];
  let characterId = null;
  let characterMotionPrompt = '';

  if (model.requiresRegisteredCharacter) {
    const characters = await readJson('characters.json', []);
    const character = characters.find((item) => item.id === req.heygenCharacterId);
    const avatarId = character?.heygen?.wideAvatarId || character?.heygen?.avatarId || '';
    if (!avatarId) {
      throw new Error('Elegí un personaje con código de avatar HeyGen.');
    }
    characterId = character.id;
    characterMotionPrompt = heyGenMotionPromptValue(character.heygen, 'wideMotionPrompt');
    payload = {
      type: 'avatar',
      avatar_id: avatarId,
      script: prompt,
      resolution,
      aspect_ratio: aspectRatio,
      engine: { type: model.engine }
    };
    if (voiceId) payload.voice_id = voiceId;
  } else {
    const key = String((Array.isArray(req.refs) ? req.refs : [])[0] || '');
    if (!key || key.startsWith('asset://')) throw new Error('HeyGen Imagen libre necesita una imagen local.');
    const imagePath = await resolveAssetKey(key);
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : '';
    if (!mime) throw new Error('La referencia debe ser una imagen JPG, PNG o WebP.');
    if (!voiceId) throw new Error('HeyGen Imagen libre necesita el código de una voz de HeyGen.');
    const buffer = await fs.readFile(imagePath);
    const upload = authMode === 'oauth'
      ? await uploadHeyGenAssetWithMcp({ accessToken: oauth.accessToken, buffer, filename: path.basename(imagePath), mime })
      : await uploadHeyGenAssetWithKey({ apiKey, buffer, filename: path.basename(imagePath), mime, idempotencyKey: `${idempotencyKey}-asset` });
    if (!upload.asset_id) throw new Error('HeyGen subió la imagen, pero no devolvió su asset_id.');
    refs = [key];
    payload = {
      type: 'image',
      image: { type: 'asset_id', asset_id: upload.asset_id },
      script: prompt,
      voice_id: voiceId,
      resolution,
      aspect_ratio: aspectRatio,
      engine: { type: model.engine }
    };
  }

  const motionPrompt = String(req.heygenMotionPrompt || characterMotionPrompt || '').trim().slice(0, 1000);
  if (model.supportsMotion && motionPrompt) payload.motion_prompt = motionPrompt;
  if (model.engine === 'avatar_iv' && ['low', 'medium', 'high'].includes(req.heygenExpressiveness)) {
    payload.expressiveness = req.heygenExpressiveness;
  }

  const created = authMode === 'oauth'
    ? await createHeyGenVideoWithMcp({ accessToken: oauth.accessToken, payload })
    : await createHeyGenVideoWithKey({ apiKey, payload, idempotencyKey });
  const videoId = created.video_id || created.id;
  if (!videoId) throw new Error('HeyGen aceptó la solicitud, pero no devolvió video_id.');
  const finished = await waitForHeyGenVideo(() => authMode === 'oauth'
    ? getHeyGenVideoWithMcp({ accessToken: oauth.accessToken, videoId })
    : getHeyGenVideoWithKey({ apiKey, videoId }));
  const buffer = await downloadHeyGenVideo(finished.video_url);
  const key = await saveBuffer('video', `${ts()}-${model.id}-${newId()}.mp4`, buffer);
  const duration = Number(finished.duration || finished.duration_seconds || created.duration || 0);
  // OAuth consume el plan web; no inventamos un cargo marginal. Con API key
  // guardamos una estimación por segundo para que el ledger no quede ciego.
  const cost = authMode === 'key' && duration > 0 ? duration * Number(model.apiPricePerSecond || 0) : 0;
  await recordCost({
    type: 'video', modelId: model.id,
    label: `${model.name}${authMode === 'oauth' ? ' (plan HeyGen)' : ' (API)'}`,
    units: duration || 1, unitLabel: duration ? 'segundo(s)' : 'video', cost
  });
  const entry = {
    id: newId(), ts: Date.now(), type: 'video', modelId: model.id, modelName: model.name,
    prompt, mode: 'heygen', aspectRatio, resolution, duration, audio: true, refs,
    characterId, outputs: [key], errors: [], cost: Number(cost.toFixed(6)),
    heygenVideoId: videoId, heygenAuthMode: authMode
  };
  await updateJson('history.json', [], (history) => [entry, ...history].slice(0, 1000));
  await recordAssetMetadata(entry);
  return entry;
}

async function runVideoGeneration(req) {
  const cfg = await getConfig();
  const model = getVideoModel(req.modelId);
  if (!model) throw new Error(`Modelo de video desconocido: ${req.modelId}`);
  if (model.provider === 'heygen') return runHeyGenVideoGeneration(req, cfg, model);
  const prompt = String(req.prompt || '').trim();
  if (!prompt) throw new Error('El prompt está vacío.');

  const mode = req.mode === 'frames' ? 'frames' : 'reference';
  const refLimit = model.refLimits?.[mode] ?? model.maxRefs;
  const refs = Array.isArray(req.refs) ? req.refs.slice(0, refLimit) : [];
  const labeledRefs = req.labeledRefs && typeof req.labeledRefs === 'object' ? req.labeledRefs : {};
  const validStamp = (v) => typeof v === 'string' && v.startsWith('data:image/') && v.length < 40 * 1024 * 1024;
  const refKinds = Array.isArray(req.refKinds) ? req.refKinds.slice(0, refs.length) : [];
  const refPaths = [];
  const mediaRefs = [];
  for (const [index, key] of refs.entries()) {
    // "asset://<id>": rostro verificado de ModelArk, va directo a la API
    let resolved;
    if (/^asset:\/\/[A-Za-z0-9._-]+$/.test(key)) resolved = key;
    // Los fotogramas deben llegar limpios: una etiqueta estampada cambia el
    // frame exacto y puede hacer que el proveedor degrade el control del final.
    else if (mode !== 'frames' && validStamp(labeledRefs[key])) resolved = labeledRefs[key];
    else resolved = await resolveAssetKey(key);
    refPaths.push(resolved);
    const inferredKind = key.startsWith('video/') ? 'video' : key.startsWith('audio/') ? 'audio' : 'image';
    mediaRefs.push({ path: resolved, kind: ['image', 'video', 'audio'].includes(refKinds[index]) ? refKinds[index] : inferredKind, key });
  }
  if (mode === 'frames' && mediaRefs.length !== 2) {
    throw new Error('Inicio → Fin necesita exactamente dos imágenes: entrada y salida, en ese orden.');
  }

  const aspectRatio = model.aspectRatios.includes(req.aspectRatio) ? req.aspectRatio : model.aspectRatios[0];
  const resolution = model.resolutions.includes(req.resolution) ? req.resolution : model.resolutions[0];
  const duration = model.durations.includes(Number(req.duration)) ? Number(req.duration) : model.durations[0];
  const audio = model.audio ? Boolean(req.audio) : null;

  const hasPoserRef = refs.some((key) => String(key).startsWith('poser/'));
  const preface = refs.some((key) => validStamp(labeledRefs[key])) ? LABELED_REFS_PROMPT : '';
  const suffix = hasPoserRef && cfg.poserPrompt?.trim() ? cfg.poserPrompt.trim() : '';
  const sentPrompt = [preface, prompt, suffix].filter(Boolean).join('\n\n');

  if (model.provider === 'minimax') {
    if (mediaRefs.some((ref) => String(ref.path || '').startsWith('asset://'))) {
      throw new Error('MiniMax H3 no puede leer IDs privados de ModelArk. Elegí las fotos locales del personaje desde Assets.');
    }
    if (mode === 'frames' && mediaRefs.some((ref) => ref.kind !== 'image')) {
      throw new Error('El modo Inicio → Fin de MiniMax H3 sólo acepta imágenes. Usá Referencias para video o audio.');
    }
    const h3Ffmpeg = mediaRefs.some((ref) => ref.kind === 'video' || ref.kind === 'audio')
      ? await resolveFfmpegExecutable(cfg.ffmpegPath)
      : null;
    await validateMiniMaxH3Media(mediaRefs, h3Ffmpeg);
    const video = await generateMiniMaxH3Video({
      apiKey: cfg.keys.minimax,
      endpoint: cfg.endpoints.minimax,
      apiModel: model.apiModel,
      prompt: sentPrompt,
      mediaRefs,
      mode,
      aspectRatio,
      resolution,
      duration,
      contextIr: req.h3ContextIr === true
    });
    const name = `${ts()}-${model.id}-${newId()}.mp4`;
    const key = await saveBuffer('video', name, video.buffer);
    const pricing = await getPricing();
    const perSecond = videoPrice(pricing, model.id, resolution);
    const outputSeconds = Number(video.usage?.output_seconds) || duration;
    const inputSeconds = Number(video.usage?.input_seconds) || 0;
    const inputImages = Number(video.usage?.input_image_count) || mediaRefs.filter((ref) => ref.kind === 'image').length;
    const generationCost = perSecond * (outputSeconds + inputSeconds) + Math.max(0, inputImages - 5) * 0.04;
    const contextCost = video.contextUsage
      ? (Number(video.contextUsage.prompt_tokens) || 0) * 0.9 / 1_000_000
        + (Number(video.contextUsage.completion_tokens) || 0) * 3.6 / 1_000_000
      : 0;
    const cost = generationCost + contextCost;
    await recordCost({
      type: 'video', modelId: model.id, label: `${model.name} ${resolution}`,
      units: outputSeconds, unitLabel: 'segundo(s)', cost
    });
    const entry = {
      id: newId(), ts: Date.now(), type: 'video', modelId: model.id, modelName: model.name,
      prompt, sentPrompt: video.finalPrompt, mode, aspectRatio: video.ratio || aspectRatio,
      resolution, duration: outputSeconds, audio: true, refs, refKinds: mediaRefs.map((ref) => ref.kind),
      characterId: req.characterId || null, outputs: [key], errors: [], cost: Number(cost.toFixed(6)),
      h3TaskId: video.taskId, h3ContextTaskId: video.contextTaskId || '', h3ContextIr: req.h3ContextIr === true
    };
    await updateJson('history.json', [], (history) => [entry, ...history].slice(0, 1000));
    await recordAssetMetadata(entry);
    return entry;
  }

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

function captionWordsFromAlignment(alignment) {
  const characters = Array.isArray(alignment?.characters) ? alignment.characters : [];
  const starts = Array.isArray(alignment?.character_start_times_seconds) ? alignment.character_start_times_seconds : [];
  const ends = Array.isArray(alignment?.character_end_times_seconds) ? alignment.character_end_times_seconds : [];
  const length = Math.min(characters.length, starts.length, ends.length);
  const words = [];
  let current = null;
  let insideTag = false;
  const flush = () => {
    if (!current?.text.trim()) { current = null; return; }
    words.push({
      text: current.text.trim(),
      start: Number(Math.max(0, current.start).toFixed(3)),
      end: Number(Math.max(current.start, current.end).toFixed(3))
    });
    current = null;
  };
  for (let index = 0; index < length; index++) {
    const character = String(characters[index] ?? '');
    if (character === '[') { flush(); insideTag = true; continue; }
    if (insideTag) {
      if (character === ']') insideTag = false;
      continue;
    }
    if (/\s/u.test(character)) { flush(); continue; }
    const start = Number(starts[index]);
    const end = Number(ends[index]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!current) current = { text: '', start, end };
    current.text += character;
    current.end = Math.max(current.end, end);
  }
  flush();
  return words.slice(0, 2000);
}

function approximateCaptionWords(text, duration) {
  const tokens = stripTags(text).split(/\s+/u).filter(Boolean).slice(0, 2000);
  const totalDuration = Math.max(0.2, Number(duration) || 0.2);
  const weights = tokens.map((token) => Math.max(1, token.replace(/[^\p{L}\p{N}]/gu, '').length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = 0;
  return tokens.map((token, index) => {
    const start = cursor;
    cursor += totalDuration * (weights[index] / totalWeight);
    return { text: token, start: Number(start.toFixed(3)), end: Number(cursor.toFixed(3)) };
  });
}

async function runAudioGeneration(req) {
  const cfg = await getConfig();
  const requestedText = String(req.text || '').trim();
  if (!requestedText) throw new Error('El texto está vacío.');
  const model = getAudioModel(req.audioModelId || req.modelId || cfg.audioModelId);
  // Las etiquetas [shouting], [whispers], etc. son instrucciones propias de
  // Eleven v3. En Multilingual v2 se quitan para que nunca se locuten.
  const text = model.supportsAudioTags ? requestedText : stripTags(requestedText);
  if (!text) throw new Error('El texto sólo contiene etiquetas de expresión; escribí algo para locutar.');
  const { buffer, mime, alignment } = await generateSpeech({
    apiKey: cfg.keys.elevenlabs,
    voiceId: req.voiceId,
    text,
    modelId: model.apiModel,
    stability: req.stability
  });
  // nombre: "<voz> - <texto>", el texto sin [corchetes] ni su interior, corto e
  // incremental si ya existe uno igual: "Alejandro - hola-como-estas.mp3", "…-2.mp3"
  const ext = extForMime(mime);
  const slug = textSlug(requestedText) || 'voz';
  const voice = voiceNameForFile(req.voiceName);
  const base = voice ? `${voice} - ${slug}` : slug;
  const audioDir = resolveDir(cfg.paths.audio);
  await fs.mkdir(audioDir, { recursive: true });
  const existing = new Set(await fs.readdir(audioDir).catch(() => []));
  let name = `${base}${ext}`;
  for (let n = 2; existing.has(name); n++) name = `${base}-${n}${ext}`;
  const key = await saveBuffer('audio', name, buffer);
  const captionWords = captionWordsFromAlignment(alignment);
  await updateJson('audio-captions.json', {}, (captions) => ({
    ...captions,
    [key]: {
      audioKey: key,
      text: stripTags(requestedText),
      speechText: text,
      source: captionWords.length ? 'elevenlabs-alignment' : 'unavailable',
      words: captionWords,
      ts: Date.now()
    }
  }));

  const pricing = await getPricing();
  const cost = audioPrice(pricing, text.length, model.id);
  await recordCost({
    type: 'audio', modelId: model.id, label: `${model.name} (${req.voiceName || 'voz'})`,
    units: text.length, unitLabel: 'caracteres', cost
  });

  const entry = {
    id: newId(),
    ts: Date.now(),
    type: 'audio',
    modelId: model.id,
    modelName: model.name,
    prompt: requestedText,
    speechText: text,
    voiceId: req.voiceId,
    voiceName: req.voiceName || '',
    audioKind: 'voice',
    characterId: req.characterId || null,
    captionTiming: { source: captionWords.length ? 'elevenlabs-alignment' : 'unavailable', wordCount: captionWords.length },
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
  const musicTags = normalizeMusicTags(req.musicTags || {
    genres: req.genres,
    instruments: req.instruments,
    moods: req.moods
  });

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
    audioKind: 'music',
    musicTags,
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

function normalizedTagKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

function musicMatchScore(required, candidate) {
  const wanted = normalizeMusicTags(required);
  const available = normalizeMusicTags(candidate);
  const overlap = (left, right) => {
    const set = new Set(right.map(normalizedTagKey));
    return left.reduce((sum, tag) => sum + (set.has(normalizedTagKey(tag)) ? 1 : 0), 0);
  };
  return overlap(wanted.genres, available.genres) * 4
    + overlap(wanted.moods, available.moods) * 3
    + overlap(wanted.instruments, available.instruments) * 2;
}

async function findAutomaticMusicTrack(musicConfig) {
  const [items, metadata] = await Promise.all([listZone('audio'), readJson('asset-metadata.json', {})]);
  const candidates = items.map((item) => {
    const meta = metadata[item.key] || {};
    const kind = sanitizeAudioKind(meta.audioKind, meta.modelId === MUSIC_MODEL.id ? 'music' : 'voice');
    return { ...item, ...meta, audioKind: kind, musicTags: normalizeMusicTags(meta.musicTags) };
  }).filter((item) => item.audioKind === 'music');
  if (!candidates.length) return null;
  candidates.sort((a, b) => musicMatchScore(musicConfig, b.musicTags) - musicMatchScore(musicConfig, a.musicTags)
    || b.mtime - a.mtime);
  const selected = candidates[0];
  return { key: selected.key, name: selected.name, score: musicMatchScore(musicConfig, selected.musicTags), musicTags: selected.musicTags };
}

function validateUploadedAudio(mime, buffer) {
  const isWav = buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  const isMp3 = buffer.length >= 3 && (buffer.subarray(0, 3).toString('ascii') === 'ID3'
    || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
  if (!isWav && !isMp3) {
    throw new Error('El archivo debe ser un MP3 o WAV válido.');
  }
  return isWav ? { extension: '.wav', mime: 'audio/wav' } : { extension: '.mp3', mime: 'audio/mpeg' };
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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
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
  fontSizePx: 64,          // píxeles tipográficos sobre un lienzo de 1080 px de alto
  fontWeight: 700,
  fontItalic: false,
  fontUnderline: false,
  fontStrikeThrough: false,
  textTransform: 'none',   // none | uppercase | lowercase | capitalize
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidthPx: 3,        // píxeles de borde sobre un lienzo de 1080 px de alto
  position: 'bottom',      // preset rápido: top | center | bottom (setea y)
  x: 50,                   // centro del texto, % del ancho (arrastrable)
  y: 88,                   // centro del texto, % del alto (arrastrable)
  align: 'center',         // left | center | right
  maxWidthPct: 88,         // ancho máximo del texto como % del ancho
  bg: false,               // caja semitransparente detrás del texto
  bgColor: '#000000',
  bgOpacity: 0.45,
  highlightFont: '',       // vacío = usa la fuente principal
  highlightFontSizePx: 64,
  highlightFontWeight: 800,
  highlightFontItalic: false,
  highlightFontUnderline: false,
  highlightFontStrikeThrough: false,
  highlightTextTransform: 'none',
  highlightColor: '#fbbf24',
  highlightStrokeColor: '#000000',
  highlightStrokeWidthPx: 3,
  previewBg: ''            // asset de fondo SOLO para previsualizar (no se usa al generar)
};

const DEFAULT_TITLE_OVERLAY = {
  enabled: false,
  mode: 'block',
  blockId: '',
  text: '',
  font: 'sans-serif',
  fontSizePx: 96,
  fontWeight: 900,
  fontItalic: false,
  fontUnderline: false,
  fontStrikeThrough: false,
  textTransform: 'none',
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidthPx: 3,
  position: 'top',
  x: 50,
  y: 14,
  align: 'center',
  maxWidthPct: 88,
  bg: false,
  bgColor: '#000000',
  bgOpacity: 0.45
};

const DEFAULT_DYNAMIC_TEXT = {
  enabled: false,
  titleAnimation: 'rise',
  captionAnimation: 'word-pop',
  wordsPerPage: 5
};

function normalizeAutomationDynamicText(saved = {}) {
  const dynamic = { ...DEFAULT_DYNAMIC_TEXT, ...(saved || {}) };
  dynamic.enabled = dynamic.enabled === true;
  dynamic.titleAnimation = ['rise', 'slam', 'typewriter'].includes(dynamic.titleAnimation) ? dynamic.titleAnimation : DEFAULT_DYNAMIC_TEXT.titleAnimation;
  dynamic.captionAnimation = ['word-pop', 'karaoke', 'bounce'].includes(dynamic.captionAnimation) ? dynamic.captionAnimation : DEFAULT_DYNAMIC_TEXT.captionAnimation;
  dynamic.wordsPerPage = Math.max(1, Math.min(12, Math.round(Number(dynamic.wordsPerPage) || DEFAULT_DYNAMIC_TEXT.wordsPerPage)));
  return dynamic;
}

function normalizeAutomationOverlay(saved = {}) {
  const overlay = { ...DEFAULT_OVERLAY, ...(saved || {}) };
  // Migración desde las unidades antiguas: 1% de un lienzo de referencia de
  // 1080 px equivale a 10,8 px. Conserva la apariencia pero muestra cifras
  // intuitivas y evita seguir multiplicando porcentajes en la interfaz.
  if (saved.fontSizePx === undefined && Number.isFinite(Number(saved.fontSizePct))) {
    overlay.fontSizePx = Number((Number(saved.fontSizePct) * 10.8).toFixed(1));
  }
  if (saved.strokeWidthPx === undefined && Number.isFinite(Number(saved.strokeWidthPct))) {
    overlay.strokeWidthPx = Number((Number(saved.strokeWidthPct) * 10.8).toFixed(1));
  }
  if (saved.highlightFontSizePx === undefined) overlay.highlightFontSizePx = overlay.fontSizePx;
  if (saved.highlightStrokeWidthPx === undefined) overlay.highlightStrokeWidthPx = overlay.strokeWidthPx;
  overlay.fontSizePx = Math.max(8, Math.min(300, Number(overlay.fontSizePx) || DEFAULT_OVERLAY.fontSizePx));
  overlay.strokeWidthPx = Math.max(0, Math.min(30, Number(overlay.strokeWidthPx) || 0));
  overlay.fontWeight = Math.max(100, Math.min(900, Number(overlay.fontWeight) || DEFAULT_OVERLAY.fontWeight));
  overlay.highlightFontSizePx = Math.max(8, Math.min(300, Number(overlay.highlightFontSizePx) || overlay.fontSizePx));
  overlay.highlightStrokeWidthPx = Math.max(0, Math.min(30, Number(overlay.highlightStrokeWidthPx) || 0));
  overlay.highlightFontWeight = Math.max(100, Math.min(900, Number(overlay.highlightFontWeight) || DEFAULT_OVERLAY.highlightFontWeight));
  overlay.fontItalic = overlay.fontItalic === true;
  overlay.fontUnderline = overlay.fontUnderline === true;
  overlay.fontStrikeThrough = overlay.fontStrikeThrough === true;
  overlay.highlightFontItalic = overlay.highlightFontItalic === true;
  overlay.highlightFontUnderline = overlay.highlightFontUnderline === true;
  overlay.highlightFontStrikeThrough = overlay.highlightFontStrikeThrough === true;
  overlay.textTransform = ['none', 'uppercase', 'lowercase', 'capitalize'].includes(overlay.textTransform) ? overlay.textTransform : 'none';
  overlay.highlightTextTransform = ['none', 'uppercase', 'lowercase', 'capitalize'].includes(overlay.highlightTextTransform) ? overlay.highlightTextTransform : 'none';
  overlay.align = ['left', 'center', 'right'].includes(overlay.align) ? overlay.align : 'center';
  return overlay;
}

function normalizeAutomationTitleOverlay(saved = {}, blocks = [], fallbackText = '') {
  const title = { ...DEFAULT_TITLE_OVERLAY, ...(saved || {}) };
  const blockIds = (blocks || []).map((block) => String(block.id));
  title.enabled = title.enabled === true;
  title.mode = ['block', 'project'].includes(title.mode) ? title.mode : 'block';
  title.blockId = blockIds.includes(String(title.blockId || '')) ? String(title.blockId) : (blockIds[0] || '');
  title.text = String(title.text || fallbackText || '').trim().slice(0, 300);
  title.font = String(title.font || DEFAULT_TITLE_OVERLAY.font).slice(0, 160);
  title.fontSizePx = Math.max(8, Math.min(300, Number(title.fontSizePx) || DEFAULT_TITLE_OVERLAY.fontSizePx));
  title.fontWeight = Math.max(100, Math.min(900, Number(title.fontWeight) || DEFAULT_TITLE_OVERLAY.fontWeight));
  title.fontItalic = title.fontItalic === true;
  title.fontUnderline = title.fontUnderline === true;
  title.fontStrikeThrough = title.fontStrikeThrough === true;
  title.textTransform = ['none', 'uppercase', 'lowercase', 'capitalize'].includes(title.textTransform) ? title.textTransform : 'none';
  title.strokeWidthPx = Math.max(0, Math.min(30, Number(title.strokeWidthPx) || 0));
  title.position = ['top', 'center', 'bottom'].includes(title.position) ? title.position : 'top';
  const x = Number(title.x);
  const y = Number(title.y);
  title.x = Math.max(0, Math.min(100, Number.isFinite(x) ? x : 50));
  title.y = Math.max(0, Math.min(100, Number.isFinite(y) ? y : DEFAULT_TITLE_OVERLAY.y));
  title.align = ['left', 'center', 'right'].includes(title.align) ? title.align : 'center';
  title.maxWidthPct = Math.max(20, Math.min(100, Number(title.maxWidthPct) || DEFAULT_TITLE_OVERLAY.maxWidthPct));
  title.bg = title.bg === true;
  const bgOpacity = Number(title.bgOpacity);
  title.bgOpacity = Math.max(0, Math.min(1, Number.isFinite(bgOpacity) ? bgOpacity : DEFAULT_TITLE_OVERLAY.bgOpacity));
  return title;
}

function automationTitleRenderSignature(saved = {}, blocks = [], fallbackText = '') {
  const normalized = normalizeAutomationTitleOverlay(saved, blocks, fallbackText);
  if (!normalized.enabled) return JSON.stringify({ enabled: false });
  if (normalized.mode === 'block') {
    delete normalized.blockId;
    delete normalized.text;
  }
  return JSON.stringify(normalized);
}

function automationOverlayRenderSignature(saved = {}) {
  const normalized = normalizeAutomationOverlay(saved);
  delete normalized.previewBg;
  return JSON.stringify(normalized);
}

function automationDynamicTextRenderSignature(saved = {}) {
  return JSON.stringify(normalizeAutomationDynamicText(saved));
}

function invalidateAutomationOutput(output = {}, { image = false, text = false, audio = false, video = false } = {}) {
  const next = { ...(output || {}) };
  if (image) {
    delete next.imageKey;
    delete next.imageModelId;
    delete next.imageModelName;
    delete next.fallbackUsed;
    delete next.recoveredImage;
    text = true;
  }
  if (text) {
    delete next.textImageKey;
    delete next.textLayerKey;
    delete next.motionOverlayKey;
  }
  if (audio) {
    delete next.audioKeys;
    delete next.audioCountExpected;
  }
  if (image || text || audio || video) {
    delete next.videoKey;
    delete next.completedAt;
  }
  // Un cambio puramente visual (tipografía, animación o título) puede volver a
  // componer localmente los planos HeyGen ya pagados. Sólo una imagen o un
  // audio nuevo invalida esos segmentos de origen.
  if (image || audio) {
    delete next.heygenSegmentVideoKeys;
    delete next.h3SegmentVideoKeys;
    delete next.h3SegmentDurations;
    delete next.heygenFraming;
    delete next.generator;
  }
  return next;
}

// La voz del narrador es del proyecto; los diálogos usan la voz del personaje
// asignado (si tiene), con la del narrador como respaldo.
const DEFAULT_AUTOMATION_CONFIG = {
  imageModelId: 'nano-banana-pro',
  fallbackImageModelId: '',
  artStyle: 'Photorealistic cinematic realism, natural human anatomy, realistic skin and materials, restrained color grading, consistent lighting and lens language',
  artStylePromptId: '',
  artStyleImageKey: '',
  aspectRatio: '9:16',
  resolution: '2K',
  narratorVoiceId: '',
  narratorVoiceName: '',
  audioModelId: AUDIO_MODEL.id,
  heygenAuthMode: 'key',
  includeLogos: false,
  videoEffect: {
    enabled: false,
    preset: 'wiggle',
    intensity: 35,
    maskEnabled: false,
    maskColor: '#000000',
    maskOpacity: 10
  },
  transitionSound: {
    enabled: false,
    soundId: ''
  },
  music: {
    enabled: false,
    source: 'asset',       // asset | auto | suno
    assetKey: '',
    genres: [],
    instruments: [],
    moods: [],
    gainDb: -15,
    fadeOut: false,
    fadeOutSeconds: 5,
    sunoModel: MUSIC_MODEL.defaultVersion
  },
  overlay: { ...DEFAULT_OVERLAY },
  titleOverlay: { ...DEFAULT_TITLE_OVERLAY },
  dynamicText: { ...DEFAULT_DYNAMIC_TEXT }
};

const DEFAULT_SUBTITLER_PROJECT = {
  id: '',
  name: 'Proyecto de subtítulos',
  sourceVideoKey: '',
  sourceName: '',
  languageCode: '',
  noVerbatim: true,
  transcript: null,
  lines: [],
  config: {
    overlay: { ...DEFAULT_OVERLAY },
    titleOverlay: { ...DEFAULT_TITLE_OVERLAY, mode: 'project' },
    dynamicText: { ...DEFAULT_DYNAMIC_TEXT, enabled: true }
  },
  outputs: [],
  createdAt: 0,
  updatedAt: 0
};

const DEFAULT_SUBTITLER_STORE = {
  activeProjectId: '',
  projects: []
};

function normalizeSubtitleLine(line = {}, index = 0) {
  const start = Math.max(0, Number(line.start) || 0);
  const end = Math.max(start + 0.04, Number(line.end) || start + 0.04);
  const sourceWords = (Array.isArray(line.sourceWords) ? line.sourceWords : []).slice(0, 80).map((word) => {
    const wordStart = Math.max(0, Number(word.start) || 0);
    return {
      text: String(word.text || '').trim().slice(0, 120),
      start: wordStart,
      end: Math.max(wordStart + 0.01, Number(word.end) || wordStart + 0.01),
      speakerId: String(word.speakerId || '').slice(0, 80)
    };
  }).filter((word) => word.text);
  const sourceText = String(line.sourceText || '').trim().slice(0, 2000);
  return {
    id: String(line.id || `line-${index + 1}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 80) || `line-${index + 1}`,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    text: String(line.text || sourceText).trim().slice(0, 2000),
    sourceText,
    speakerId: String(line.speakerId || '').slice(0, 80),
    sourceWords
  };
}

function normalizeSubtitlerProject(saved = {}, index = 0) {
  const sourceVideoKey = /^video\/[\w./ -]+$/i.test(String(saved.sourceVideoKey || ''))
    && !String(saved.sourceVideoKey).includes('..') ? String(saved.sourceVideoKey) : '';
  const fallbackId = index === 0 ? 'subtitulos-inicial' : `subtitulos-${index + 1}`;
  return {
    ...DEFAULT_SUBTITLER_PROJECT,
    ...(saved || {}),
    id: String(saved.id || fallbackId).replace(/[^a-z0-9_-]/gi, '').slice(0, 80) || fallbackId,
    name: String(saved.name || 'Proyecto de subtítulos').trim().slice(0, 160) || 'Proyecto de subtítulos',
    sourceVideoKey,
    sourceName: String(saved.sourceName || '').slice(0, 260),
    languageCode: /^[a-z]{2,3}$/i.test(String(saved.languageCode || '')) ? String(saved.languageCode).toLowerCase() : '',
    noVerbatim: saved.noVerbatim !== false,
    transcript: saved.transcript && typeof saved.transcript === 'object' ? {
      text: String(saved.transcript.text || '').slice(0, 500000),
      languageCode: String(saved.transcript.languageCode || '').slice(0, 20),
      languageProbability: Number(saved.transcript.languageProbability) || 0,
      modelId: 'scribe_v2',
      transcribedAt: Number(saved.transcript.transcribedAt) || 0,
      duration: Math.max(0, Number(saved.transcript.duration) || 0)
    } : null,
    lines: (Array.isArray(saved.lines) ? saved.lines : []).slice(0, 10000).map(normalizeSubtitleLine).filter((line) => line.text),
    config: {
      overlay: normalizeAutomationOverlay(saved.config?.overlay),
      titleOverlay: normalizeAutomationTitleOverlay(saved.config?.titleOverlay, [], saved.config?.titleOverlay?.text || ''),
      dynamicText: normalizeAutomationDynamicText({ enabled: true, ...(saved.config?.dynamicText || {}) })
    },
    outputs: (Array.isArray(saved.outputs) ? saved.outputs : []).filter((item) => /^video\//.test(String(item?.videoKey || ''))).slice(0, 20),
    createdAt: Number(saved.createdAt) || Number(saved.updatedAt) || 0,
    updatedAt: Number(saved.updatedAt) || 0
  };
}

function normalizeSubtitlerStore(saved = {}) {
  // Migra automáticamente el formato inicial de un único trabajo a proyectos.
  const legacyProject = !Array.isArray(saved?.projects) && saved && typeof saved === 'object'
    && (saved.sourceVideoKey || saved.transcript || saved.lines?.length || saved.outputs?.length)
    ? [{ ...saved, id: saved.id || 'subtitulos-inicial', name: saved.name || saved.sourceName || 'Proyecto de subtítulos' }]
    : [];
  let projects = (Array.isArray(saved?.projects) ? saved.projects : legacyProject)
    .slice(0, 500)
    .map(normalizeSubtitlerProject);
  if (!projects.length) {
    projects = [normalizeSubtitlerProject({
      id: 'subtitulos-inicial', name: 'Proyecto de subtítulos', createdAt: Date.now(), updatedAt: Date.now()
    })];
  }
  const ids = new Set();
  projects = projects.map((project, index) => {
    let id = project.id;
    while (ids.has(id)) id = `${project.id}-${index + 1}`;
    ids.add(id);
    return { ...project, id };
  });
  const requestedActive = String(saved?.activeProjectId || '');
  return {
    ...DEFAULT_SUBTITLER_STORE,
    activeProjectId: projects.some((project) => project.id === requestedActive) ? requestedActive : projects[0].id,
    projects
  };
}

function subtitlerForClient(storeValue = {}) {
  const store = normalizeSubtitlerStore(storeValue);
  const active = store.projects.find((project) => project.id === store.activeProjectId) || store.projects[0];
  return {
    ...active,
    activeProjectId: active.id,
    projects: [...store.projects]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((project) => ({
        id: project.id,
        name: project.name,
        sourceName: project.sourceName,
        lineCount: project.lines.length,
        outputCount: project.outputs.length,
        dynamicTextEnabled: project.config.dynamicText.enabled,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      }))
  };
}

function replaceSubtitlerProject(storeValue, projectValue) {
  const store = normalizeSubtitlerStore(storeValue);
  const project = normalizeSubtitlerProject(projectValue);
  return {
    activeProjectId: project.id,
    projects: store.projects.map((item) => item.id === project.id ? project : item)
  };
}

function activeSubtitlerProject(storeValue = {}, requestedId = '') {
  const store = normalizeSubtitlerStore(storeValue);
  const id = String(requestedId || store.activeProjectId);
  return store.projects.find((project) => project.id === id)
    || store.projects.find((project) => project.id === store.activeProjectId)
    || store.projects[0];
}

function joinTranscriptTokens(tokens) {
  return tokens.join(' ').replace(/\s+([,.;:!?…])/g, '$1').replace(/([¿¡])\s+/g, '$1').trim();
}

function subtitleLinesFromScribe(words = []) {
  const timed = [];
  for (const item of words) {
    const text = String(item?.text || '').trim();
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    if (item.type && item.type !== 'word') continue;
    timed.push({ text, start, end, speakerId: String(item.speaker_id || '') });
  }
  const lines = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const sourceText = joinTranscriptTokens(current.map((word) => word.text));
    lines.push(normalizeSubtitleLine({
      id: `line-${lines.length + 1}`,
      start: current[0].start,
      end: current[current.length - 1].end,
      text: sourceText,
      sourceText,
      speakerId: current.find((word) => word.speakerId)?.speakerId || '',
      sourceWords: current
    }, lines.length));
    current = [];
  };
  for (const word of timed) {
    const nextText = joinTranscriptTokens([...current.map((item) => item.text), word.text]);
    const speakerChanged = current.length && word.speakerId && current[0].speakerId && word.speakerId !== current[0].speakerId;
    const longGap = current.length && word.start - current[current.length - 1].end > 0.7;
    if (current.length && (speakerChanged || longGap || current.length >= 7 || nextText.length > 48)) flush();
    current.push(word);
    if (/[.!?…][”"']?$/.test(word.text) && current.length >= 3) flush();
  }
  flush();
  return lines;
}

function subtitleWordsFromLines(lines = []) {
  const words = [];
  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = normalizeSubtitleLine(rawLine, lineIndex);
    const tokens = String(line.text || '').split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const original = line.sourceWords || [];
    const exactText = line.sourceText && line.text.trim() === line.sourceText.trim();
    const originalStart = original[0]?.start ?? line.start;
    const originalEnd = original.at(-1)?.end ?? line.end;
    const originalSpan = Math.max(0.01, originalEnd - originalStart);
    const targetSpan = Math.max(0.04, line.end - line.start);
    const remapTime = (value) => line.start + targetSpan * Math.max(0, Math.min(1, (value - originalStart) / originalSpan));
    if (original.length === tokens.length) {
      for (const [index, token] of tokens.entries()) words.push({
        text: token,
        start: Number(remapTime(original[index].start).toFixed(3)),
        end: Number(remapTime(original[index].end).toFixed(3))
      });
      continue;
    }
    if (exactText && original.length) {
      for (const word of original) words.push({
        text: word.text,
        start: Number(remapTime(word.start).toFixed(3)),
        end: Number(remapTime(word.end).toFixed(3))
      });
      continue;
    }
    const span = Math.max(0.04, line.end - line.start);
    for (const [index, token] of tokens.entries()) {
      words.push({
        text: token,
        start: Number((line.start + span * index / tokens.length).toFixed(3)),
        end: Number((line.start + span * (index + 1) / tokens.length).toFixed(3))
      });
    }
  }
  return words.sort((left, right) => left.start - right.start || left.end - right.end);
}

async function transcribeSubtitleAudio({ apiKey, audioPath, languageCode = '', noVerbatim = true }) {
  if (!apiKey) throw new Error('Falta la API key de ElevenLabs en Configuración.');
  const audio = await fs.readFile(audioPath);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), path.basename(audioPath));
  form.append('model_id', 'scribe_v2');
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  form.append('diarize', 'true');
  form.append('no_verbatim', noVerbatim ? 'true' : 'false');
  if (languageCode) form.append('language_code', languageCode);
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': apiKey }, body: form, signal: AbortSignal.timeout(30 * 60 * 1000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.detail?.message || result?.detail || result?.error || `ElevenLabs Scribe: HTTP ${response.status}`);
  return result;
}

function normalizeAutomationMusic(saved = {}, requirement = {}) {
  const requiredTags = normalizeMusicTags(requirement);
  const music = {
    ...DEFAULT_AUTOMATION_CONFIG.music,
    ...(saved || {})
  };
  music.enabled = music.enabled === true;
  music.source = ['asset', 'auto', 'suno'].includes(music.source) ? music.source : 'asset';
  music.assetKey = /^audio\//.test(String(music.assetKey || '')) ? String(music.assetKey) : '';
  music.genres = sanitizeMusicTagList(music.genres?.length ? music.genres : requiredTags.genres);
  music.instruments = sanitizeMusicTagList(music.instruments?.length ? music.instruments : requiredTags.instruments);
  music.moods = sanitizeMusicTagList(music.moods?.length ? music.moods : requiredTags.moods);
  const savedGainDb = Number(saved?.gainDb);
  const legacyVolumePct = Number(saved?.volumePct);
  const migratedGainDb = Number.isFinite(legacyVolumePct)
    ? (legacyVolumePct <= 0 ? -60 : 20 * Math.log10(Math.min(100, legacyVolumePct) / 100))
    : DEFAULT_AUTOMATION_CONFIG.music.gainDb;
  music.gainDb = Math.max(-60, Math.min(0, Number.isFinite(savedGainDb) ? savedGainDb : migratedGainDb));
  delete music.volumePct;
  music.fadeOut = music.fadeOut === true;
  const fadeOutSeconds = Number(music.fadeOutSeconds);
  music.fadeOutSeconds = Number.isFinite(fadeOutSeconds)
    ? Math.max(0.25, Math.min(30, fadeOutSeconds))
    : DEFAULT_AUTOMATION_CONFIG.music.fadeOutSeconds;
  music.sunoModel = MUSIC_MODEL.versions.includes(music.sunoModel) ? music.sunoModel : MUSIC_MODEL.defaultVersion;
  return music;
}

function normalizeAutomationTransitionSound(saved = {}) {
  return {
    enabled: saved?.enabled === true,
    soundId: String(saved?.soundId || '').trim().slice(0, 300)
  };
}

const stripTags = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
const roleId = (r) => String(r || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

function automationAudioText(text) {
  const clean = String(text || '').trim();
  let tag = '';
  if (/[!¡]/.test(clean) && clean === clean.toUpperCase()) tag = '[shouting]';
  else if (/[!¡]/.test(clean)) tag = '[excited]';
  else if (/\?/.test(clean)) tag = '[curious]';
  else if (/\.\.\.$|…$/.test(clean)) tag = '[sighs]';
  else if (/(triste|llor|adiós|adios|perdón|perdon|muerte)/i.test(clean)) tag = '[sad]';
  else if (/(nunca|jamás|jamas|odio|basta|traición|traicion)/i.test(clean)) tag = '[angry]';
  return tag ? `${tag} ${clean}` : clean;
}

function rgbaFromHex(hex, opacity) {
  const normalized = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? String(hex).slice(1) : '000000';
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${Math.max(0, Math.min(1, Number(opacity) || 0)).toFixed(3)})`;
}

async function remotionFontFaces(families) {
  const requested = new Set((families || []).map(String).filter((family) => family.startsWith('ManifestadorFont_')));
  if (!requested.size) return [];
  const fonts = await readJson('fonts.json', []);
  const faces = [];
  for (const font of fonts) {
    if (!requested.has(font.family)) continue;
    const fontPath = path.join(DATA_DIR, 'fonts', path.basename(String(font.file || '')));
    const buffer = await fs.readFile(fontPath).catch(() => null);
    if (!buffer) continue;
    const format = font.format === 'otf' ? 'opentype' : font.format === 'ttf' ? 'truetype' : font.format;
    const mime = font.format === 'woff2' ? 'font/woff2' : font.format === 'woff' ? 'font/woff' : 'font/ttf';
    faces.push({ family: font.family, format, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` });
  }
  return faces;
}

async function automationCaptionTimeline({ audioKeys, audioPaths, ffmpegExecutable, textHints = [] }) {
  const [savedCaptions, history] = await Promise.all([
    readJson('audio-captions.json', {}),
    readJson('history.json', [])
  ]);
  const nextCaptions = { ...savedCaptions };
  const words = [];
  let offset = 0;
  let changed = false;
  for (let index = 0; index < audioKeys.length; index++) {
    const key = audioKeys[index];
    const duration = await probeMediaDuration(ffmpegExecutable, audioPaths[index]);
    if (!duration) continue;
    const saved = savedCaptions[key];
    let localWords = Array.isArray(saved?.words) ? saved.words : [];
    if (!localWords.length) {
      const historyEntry = history.find((entry) => Array.isArray(entry.outputs) && entry.outputs.includes(key));
      const fallbackText = historyEntry?.speechText || historyEntry?.prompt || textHints[index] || '';
      localWords = approximateCaptionWords(fallbackText, duration);
      nextCaptions[key] = {
        audioKey: key,
        text: stripTags(fallbackText),
        speechText: fallbackText,
        source: 'estimated-from-duration',
        words: localWords,
        ts: Date.now()
      };
      changed = true;
    }
    for (const word of localWords) {
      const start = Math.max(0, Math.min(duration, Number(word.start) || 0));
      const end = Math.max(start, Math.min(duration, Number(word.end) || start));
      if (!String(word.text || '').trim()) continue;
      words.push({
        text: String(word.text).trim(),
        start: Number((offset + start).toFixed(3)),
        end: Number((offset + end).toFixed(3))
      });
    }
    offset += duration;
  }
  if (changed) await writeJson('audio-captions.json', nextCaptions);
  return { words, duration: offset };
}

function automationTitleText(project, block) {
  const title = normalizeAutomationTitleOverlay(project.config?.titleOverlay, project.blocks, project.integration?.scriptTitle || project.name);
  if (!title.enabled) return { text: '', config: title };
  if (title.mode === 'block') return { text: String(block.title || ''), config: title };
  if (String(title.blockId || '') !== String(block.id || '')) return { text: '', config: title };
  return { text: title.text || project.integration?.scriptTitle || project.name, config: title };
}

async function renderSubtitleMotionOverlay({
  dynamicText, overlay: savedOverlay, titleOverlay: savedTitle, titleText = '', timeline,
  duration, width, height, outDir, fileLabel = 'subtitulos', metadata: assetMetadata = {}
}) {
  const dynamic = normalizeAutomationDynamicText(dynamicText);
  const overlay = normalizeAutomationOverlay(savedOverlay);
  const title = normalizeAutomationTitleOverlay(savedTitle, [], titleText);
  const renderDuration = Number(duration) || Number(timeline?.duration) || 0;
  if (!renderDuration) throw new Error('No pude calcular la duración para los subtítulos.');
  const scale = height / 1080;
  const fontFaces = await remotionFontFaces([
    overlay.font,
    overlay.highlightFont,
    title.font
  ]);
  const styleFor = (highlighted) => ({
    fontFamily: highlighted ? (overlay.highlightFont || overlay.font) : overlay.font,
    fontSizePx: Number((Math.max(8, highlighted ? overlay.highlightFontSizePx : overlay.fontSizePx) * scale).toFixed(2)),
    fontWeight: highlighted ? overlay.highlightFontWeight : overlay.fontWeight,
    italic: highlighted ? overlay.highlightFontItalic : overlay.fontItalic,
    underline: highlighted ? overlay.highlightFontUnderline : overlay.fontUnderline,
    strikeThrough: highlighted ? overlay.highlightFontStrikeThrough : overlay.fontStrikeThrough,
    textTransform: highlighted ? overlay.highlightTextTransform : overlay.textTransform,
    color: highlighted ? overlay.highlightColor : overlay.color,
    strokeColor: highlighted ? overlay.highlightStrokeColor : overlay.strokeColor,
    strokeWidthPx: Number((Math.max(0, highlighted ? overlay.highlightStrokeWidthPx : overlay.strokeWidthPx) * scale).toFixed(2))
  });
  const inputProps = {
    width,
    height,
    fps: 25,
    durationSeconds: renderDuration,
    fontFaces,
    title: {
      enabled: Boolean(titleText),
      text: titleText,
      animation: dynamic.enabled ? dynamic.titleAnimation : 'none',
      start: 0,
      duration: Math.min(renderDuration, 3.4),
      x: title.x,
      y: title.y,
      align: title.align,
      maxWidthPct: title.maxWidthPct,
      style: {
        fontFamily: title.font,
        fontSizePx: Number((title.fontSizePx * scale).toFixed(2)),
        fontWeight: title.fontWeight,
        italic: title.fontItalic,
        underline: title.fontUnderline,
        strikeThrough: title.fontStrikeThrough,
        textTransform: title.textTransform,
        color: title.color,
        strokeColor: title.strokeColor,
        strokeWidthPx: Number((title.strokeWidthPx * scale).toFixed(2)),
        background: title.bg,
        backgroundColor: rgbaFromHex(title.bgColor, title.bgOpacity)
      }
    },
    captions: {
      enabled: (timeline?.words || []).length > 0,
      words: timeline?.words || [],
      animation: dynamic.enabled ? dynamic.captionAnimation : 'none',
      wordsPerPage: dynamic.wordsPerPage,
      x: overlay.x,
      y: overlay.y,
      align: overlay.align,
      maxWidthPct: overlay.maxWidthPct,
      background: overlay.bg,
      backgroundColor: rgbaFromHex(overlay.bgColor, overlay.bgOpacity),
      style: styleFor(false),
      activeStyle: styleFor(true)
    }
  };
  await fs.mkdir(outDir, { recursive: true });
  const name = `${ts()}-remotion-${sanitizeName(fileLabel)}-${newId()}.webm`;
  const outputPath = path.join(outDir, name);
  await renderDynamicTextOverlay({ outputPath, inputProps });
  const key = `video/${name}`;
  await updateJson('asset-metadata.json', {}, (allMetadata) => ({
    ...allMetadata,
    [key]: {
      type: 'video', modelId: 'remotion-dynamic-text', modelName: 'Remotion · texto dinámico', ts: Date.now(),
      transparent: true, wordCount: (timeline?.words || []).length, duration: renderDuration, cost: 0,
      ...assetMetadata
    }
  }));
  return { key, path: outputPath, duration: renderDuration, wordCount: (timeline?.words || []).length };
}

async function renderAutomationMotionOverlay({ project, block, audioKeys, audioPaths, ffmpegExecutable, width, height, outDir, textHints = [] }) {
  const dynamic = normalizeAutomationDynamicText(project.config?.dynamicText);
  if (!dynamic.enabled) return null;
  const timeline = await automationCaptionTimeline({ audioKeys, audioPaths, ffmpegExecutable, textHints });
  const duration = timeline.duration || await Promise.all(audioPaths.map((audioPath) => probeMediaDuration(ffmpegExecutable, audioPath)))
    .then((items) => items.reduce((sum, item) => sum + (item || 0), 0));
  const { text: titleText, config: title } = automationTitleText(project, block);
  return renderSubtitleMotionOverlay({
    dynamicText: dynamic,
    overlay: project.config?.overlay,
    titleOverlay: title,
    titleText,
    timeline,
    duration,
    width,
    height,
    outDir,
    fileLabel: `auto-${block.title || block.id}`,
    metadata: {
      category: `Auto: ${project.name}`.slice(0, 80), automationId: project.id, blockId: block.id,
      autoKind: 'dynamic-text-overlay'
    }
  });
}

function automationProjectCostEstimate(project, pricing, assetMetadata) {
  const imageModelId = String(project.config?.imageModelId || '');
  const imageModel = getImageModel(imageModelId);
  const modelName = imageModel?.name || imageModelId || 'Modelo sin definir';
  const configuredResolution = String(project.config?.resolution || 'auto');
  const blockResolution = imageModel?.resolutions.includes(configuredResolution)
    ? configuredResolution
    : (imageModel?.resolutions[0] || configuredResolution);
  const resourceResolution = imageModel
    ? (imageModel.resolutions.includes('2K') ? '2K'
      : imageModel.resolutions.includes('4K') ? '4K'
      : imageModel.resolutions[0])
    : blockResolution;
  const resourceImages =
    (project.requirements?.characters?.length || 0) +
    (project.requirements?.locations?.length || 0) +
    (project.requirements?.objects?.length || 0);
  const blockImages = (project.blocks || []).filter((block) => block.generator === 'image' || (block.generator === 'h3' && block.h3Mode !== 'frames')).length;
  const audioModel = getAudioModel(project.config?.audioModelId);
  const audioTexts = (project.blocks || []).flatMap((block) =>
    (block.items || []).map((item) => audioModel.supportsAudioTags ? automationAudioText(item.text) : stripTags(item.text)).filter(Boolean)
  );
  const audioCharacters = audioTexts.reduce((sum, text) => sum + text.length, 0);
  const resourceImageCost = resourceImages * imagePrice(pricing, imageModelId, resourceResolution);
  const blockImageCost = blockImages * imagePrice(pricing, imageModelId, blockResolution);
  const audioCost = audioPrice(pricing, audioCharacters, audioModel.id);
  const music = normalizeAutomationMusic(project.config?.music, project.requirements?.music);
  const generatedMusicTracks = music.enabled && music.source === 'suno' ? 2 : 0;
  const generatedMusicCost = generatedMusicTracks * musicPrice(pricing);
  const h3Blocks = (project.blocks || []).filter((block) => block.generator === 'h3');
  let h3EstimatedSeconds = 0;
  for (const block of h3Blocks) {
    const approximate = Number(block.estimatedDuration) > 0
      ? Number(block.estimatedDuration)
      : Math.max(1, (block.items || []).reduce((sum, item) => sum + String(item.text || '').length, 0) / 14);
    let remaining = approximate;
    while (remaining > 0.001) {
      const chunk = Math.min(15, remaining);
      h3EstimatedSeconds += Math.max(4, Math.ceil(chunk));
      remaining -= chunk;
    }
  }
  const h3ResolutionCosts = h3Blocks.reduce((sum, block) => {
    const approximate = Number(block.estimatedDuration) > 0
      ? Number(block.estimatedDuration)
      : Math.max(1, (block.items || []).reduce((total, item) => total + String(item.text || '').length, 0) / 14);
    let billedSeconds = 0;
    for (let remaining = approximate; remaining > 0.001; remaining -= Math.min(15, remaining)) {
      billedSeconds += Math.max(4, Math.ceil(Math.min(15, remaining)));
    }
    return sum + billedSeconds * videoPrice(pricing, 'minimax-h3', block.h3Resolution === '2K' ? '2K' : '768P');
  }, 0);
  const estimatedTotal = resourceImageCost + blockImageCost + audioCost + generatedMusicCost + h3ResolutionCosts;

  const linkedMetadata = Object.values(assetMetadata || {}).filter((metadata) =>
    metadata?.automationId === project.id
  );
  const spent = linkedMetadata.reduce((sum, metadata) => sum + (Number(metadata.cost) || 0), 0);
  return {
    id: project.id,
    name: project.name,
    ts: project.ts,
    updatedAt: project.updatedAt,
    modelId: imageModelId,
    modelName,
    aspectRatio: project.config?.aspectRatio || '',
    resolution: blockResolution,
    estimatedTotal: Number(estimatedTotal.toFixed(6)),
    spent: Number(spent.toFixed(6)),
    breakdown: {
      resourceImages,
      resourceResolution,
      resourceImageCost: Number(resourceImageCost.toFixed(6)),
      blockImages,
      blockResolution,
      blockImageCost: Number(blockImageCost.toFixed(6)),
      h3Blocks: h3Blocks.length,
      h3EstimatedSeconds,
      h3VideoCost: Number(h3ResolutionCosts.toFixed(6)),
      audioItems: audioTexts.length,
      audioCharacters,
      audioModelId: audioModel.id,
      audioModelName: audioModel.name,
      audioCost: Number(audioCost.toFixed(6)),
      musicEnabled: music.enabled,
      musicSource: music.source,
      generatedMusicTracks,
      musicCost: Number(generatedMusicCost.toFixed(6)),
      localVideoCost: 0
    }
  };
}

function normalizeAutomationGeneratedCharacters(saved = {}, requirements = []) {
  const allowedRoles = new Set((requirements || []).map((item) => roleId(item.role)).filter(Boolean));
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  return Object.fromEntries(Object.entries(source).flatMap(([rawRole, raw]) => {
    const role = roleId(rawRole);
    if (!role || !allowedRoles.has(role) || !raw || typeof raw !== 'object') return [];
    const assetKey = String(raw.assetKey || raw.sheet || '').trim();
    if (!/^(generated|uploads)\/[\w./ -]+$/i.test(assetKey) || assetKey.includes('..')) return [];
    return [[role, {
      id: `automation-character:${role}`,
      role,
      name: String(raw.name || role).trim().slice(0, 120) || role,
      description: String(raw.description || '').slice(0, 1600),
      clothing: String(raw.clothing || '').slice(0, 800),
      assetKey,
      sheet: assetKey,
      photos: [assetKey],
      voiceId: String(raw.voiceId || '').slice(0, 200),
      voiceName: String(raw.voiceName || '').slice(0, 200),
      modelId: String(raw.modelId || '').slice(0, 120),
      generatedAt: Number(raw.generatedAt) || Date.now()
    }]];
  }));
}

// normaliza un proyecto (importado o editado); conserva lo previo (asignaciones,
// config, outputs) al re-guardar
function sanitizeAutomation(src, prev = {}) {
  const reqList = (arr, withVoice) => (Array.isArray(arr) ? arr : []).slice(0, 50).map((x) => {
    const role = roleId(x.role);
    if (!role) return null;
    const o = { role, description: String(x.description || '').slice(0, 800) };
    if (withVoice) {
      o.clothing = String(x.clothing || '').slice(0, 800);
      o.voice = String(x.voice || '').slice(0, 400);
    }
    return o;
  }).filter(Boolean);

  const requirements = {
    characters: reqList(src.requirements?.characters, true),
    locations: reqList(src.requirements?.locations, false),
    objects: reqList(src.requirements?.objects, false),
    music: normalizeMusicTags(src.requirements?.music || src.music || src.script?.music || src.project?.music || prev.requirements?.music || {})
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
      estimatedDuration: Math.max(0, Math.min(3600, Number(b.estimatedDuration) || 0)),
      generator: ['image', 'heygen', 'assets', 'h3'].includes(b.generator) ? b.generator : 'image',
      heygenCharacterId: /^[a-z0-9]+$/.test(String(b.heygenCharacterId || '')) ? String(b.heygenCharacterId) : '',
      heygenFraming: ['wide', 'close', 'split'].includes(b.heygenFraming) ? b.heygenFraming : 'wide',
      assetKeys: normalizeAutomationAssetKeys(b.assetKeys),
      assetMuteOriginal: b.assetMuteOriginal !== false,
      h3Mode: b.h3Mode === 'frames' ? 'frames' : 'reference',
      h3Resolution: b.h3Resolution === '2K' ? '2K' : '768P',
      h3ContextIr: b.h3ContextIr === true,
      h3UseNarrationReference: b.h3UseNarrationReference !== false,
      h3KeepGeneratedAudio: b.h3KeepGeneratedAudio === true,
      h3ReferenceKeys: normalizeAutomationH3ReferenceKeys(b.h3ReferenceKeys)
    };
  });

  const projectData = src.project && typeof src.project === 'object' ? src.project : null;
  const scriptData = src.script && typeof src.script === 'object' ? src.script : null;
  return {
    id: prev.id || newId(),
    name: String(projectData?.name ?? src.project ?? src.name ?? prev.name ?? 'Proyecto').trim().slice(0, 120) || 'Proyecto',
    requirements,
    blocks,
    generatedCharacters: normalizeAutomationGeneratedCharacters(prev.generatedCharacters || src.generatedCharacters, requirements.characters),
    assignments: prev.assignments || { characters: {}, locations: {}, objects: {} },
    config: {
      ...DEFAULT_AUTOMATION_CONFIG,
      ...(prev.config || {}),
      artStyle: String(prev.config?.artStyle || DEFAULT_AUTOMATION_CONFIG.artStyle).slice(0, 1200),
      artStylePromptId: String(prev.config?.artStylePromptId || '').slice(0, 80),
      artStyleImageKey: normalizeStyleImageKey(prev.config?.artStyleImageKey),
      audioModelId: getAudioModel(prev.config?.audioModelId).id,
      heygenAuthMode: prev.config?.heygenAuthMode === 'oauth' ? 'oauth' : 'key',
      includeLogos: prev.config?.includeLogos === true,
      videoEffect: normalizeAutomationVideoEffect(prev.config?.videoEffect),
      dynamicText: normalizeAutomationDynamicText(prev.config?.dynamicText),
      transitionSound: normalizeAutomationTransitionSound(prev.config?.transitionSound),
      music: normalizeAutomationMusic(prev.config?.music, requirements.music),
      overlay: normalizeAutomationOverlay(prev.config?.overlay),
      titleOverlay: normalizeAutomationTitleOverlay(
        prev.config?.titleOverlay,
        blocks,
        scriptData?.title || projectData?.name || src.name || prev.name
      )
    },
    outputs: prev.outputs || {},
    finalOutput: prev.finalOutput || null,
    effectOutput: prev.effectOutput || null,
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

function automationForClient(project) {
  return {
    ...project,
    config: {
      ...project.config,
      heygenAuthMode: project.config?.heygenAuthMode === 'oauth' ? 'oauth' : 'key',
      includeLogos: project.config?.includeLogos === true,
      videoEffect: normalizeAutomationVideoEffect(project.config?.videoEffect),
      dynamicText: normalizeAutomationDynamicText(project.config?.dynamicText),
      audioModelId: getAudioModel(project.config?.audioModelId).id,
      transitionSound: normalizeAutomationTransitionSound(project.config?.transitionSound),
      music: normalizeAutomationMusic(project.config?.music, project.requirements?.music),
      overlay: normalizeAutomationOverlay(project.config?.overlay),
      titleOverlay: normalizeAutomationTitleOverlay(
        project.config?.titleOverlay,
        project.blocks,
        project.integration?.scriptTitle || project.name
      )
    }
  };
}

const AUTOMATION_CLEANUP_REFERENCE_FILES = [
  'asset-links.json', 'element-links.json', 'series.json', 'scripts.json',
  'characters.json', 'elements.json', 'prompts.json', 'overlay-presets.json',
  'subtitler.json'
];

function isCleanupAssetKey(value) {
  const key = String(value || '');
  return /^(generated|uploads|audio|video)\//.test(key)
    && key.length <= 700
    && !key.includes('..')
    && !key.includes('\\')
    && !/[\x00-\x1f]/.test(key);
}

function collectStoredAssetKeys(value, target = new Set()) {
  if (typeof value === 'string') {
    if (isCleanupAssetKey(value)) target.add(value);
    return target;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStoredAssetKeys(item, target);
    return target;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStoredAssetKeys(item, target);
  }
  return target;
}

async function automationCleanupPlan(projectId) {
  const [automations, metadata, ...referenceDocuments] = await Promise.all([
    readJson('automations.json', []),
    readJson('asset-metadata.json', {}),
    ...AUTOMATION_CLEANUP_REFERENCE_FILES.map((file) => readJson(file, []))
  ]);
  const project = automations.find((item) => item.id === projectId);
  if (!project) return null;

  // Lo que el proyecto todavía referencia es material vigente: imágenes
  // limpias, capas, audios, tomas, planos HeyGen, música y masters finales.
  const activeKeys = collectStoredAssetKeys(project);
  // También se preserva cualquier resultado que el usuario haya reutilizado
  // en otro proyecto, serie, guion, personaje, elemento, prompt o preset.
  const sharedKeys = new Set();
  for (const other of automations) if (other.id !== projectId) collectStoredAssetKeys(other, sharedKeys);
  for (const document of referenceDocuments) collectStoredAssetKeys(document, sharedKeys);

  const candidates = Object.entries(metadata)
    .filter(([key, item]) => isCleanupAssetKey(key) && String(item?.automationId || '') === projectId)
    .map(([key, item]) => ({ key, metadata: item || {} }));
  const deletable = candidates.filter((item) => !activeKeys.has(item.key) && !sharedKeys.has(item.key));
  let deleteBytes = 0;
  for (const item of deletable) {
    const stat = await fs.stat(await resolveAssetKey(item.key)).catch(() => null);
    item.bytes = stat?.isFile() ? stat.size : 0;
    deleteBytes += item.bytes;
  }
  const byType = {};
  for (const item of deletable) {
    const type = item.key.split('/')[0];
    byType[type] = (byType[type] || 0) + 1;
  }
  return {
    project,
    candidates,
    deletable,
    activeCount: candidates.filter((item) => activeKeys.has(item.key)).length,
    sharedCount: candidates.filter((item) => !activeKeys.has(item.key) && sharedKeys.has(item.key)).length,
    deleteBytes,
    byType
  };
}

function sanitizeOverlayPreset(body = {}, previous = {}) {
  const overlay = normalizeAutomationOverlay(body.overlay || previous.overlay || {});
  delete overlay.previewBg;
  const titleOverlay = normalizeAutomationTitleOverlay(body.titleOverlay || previous.titleOverlay || {}, [], '');
  const dynamicText = normalizeAutomationDynamicText(body.dynamicText || previous.dynamicText || {});
  delete titleOverlay.enabled;
  delete titleOverlay.mode;
  delete titleOverlay.blockId;
  delete titleOverlay.text;
  return {
    id: previous.id || newId(),
    name: String(body.name ?? previous.name ?? '').trim().slice(0, 100) || 'Estilo sin nombre',
    overlay,
    titleOverlay,
    dynamicText,
    ts: previous.ts || Date.now(),
    updatedAt: Date.now()
  };
}

function normalizeStyleImageKey(value) {
  const key = String(value || '').trim();
  if (!key || key.includes('..')) return '';
  return /^(generated|uploads|characters|elements|poser)\/[\w./ -]+$/i.test(key) ? key : '';
}

function normalizeAutomationAssetKeys(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter((key) => {
    if (!/^(generated|uploads|video)\//i.test(key) || key.length > 500 || key.includes('..')
      || key.includes('\\') || /[\x00-\x1f]/.test(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 60);
}

function normalizeAutomationH3ReferenceKeys(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter((key) => {
    if (!/^(generated|uploads|video|audio)\//i.test(key) || key.length > 500 || key.includes('..')
      || key.includes('\\') || /[\x00-\x1f]/.test(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
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
    buildCreate: (body) => {
      const wideMotionPrompt = String(body.heygenWideMotionPrompt ?? body.heygenMotionPrompt ?? '').trim().slice(0, 1000);
      const closeMotionPrompt = String(body.heygenCloseMotionPrompt ?? body.heygenMotionPrompt ?? '').trim().slice(0, 1000);
      return {
        name: String(body.name || '').trim() || 'Sin nombre',
        description: String(body.description || ''),
        voiceId: body.voiceId || '',
        voiceName: body.voiceName || '',
        arkAssetId: String(body.arkAssetId || '').trim().replace(/^asset:\/\//, ''),
        heygen: {
          avatarId: String(body.heygenWideAvatarId || body.heygenAvatarId || '').trim().slice(0, 200),
          wideAvatarId: String(body.heygenWideAvatarId || body.heygenAvatarId || '').trim().slice(0, 200),
          closeAvatarId: String(body.heygenCloseAvatarId || '').trim().slice(0, 200),
          motionPrompt: wideMotionPrompt,
          wideMotionPrompt,
          closeMotionPrompt,
          imageKey: ''
        }
      };
    },
    applyUpdate: (e, body) => {
      if (body.name !== undefined) e.name = String(body.name).trim() || e.name;
      if (body.description !== undefined) e.description = String(body.description);
      if (body.voiceId !== undefined) e.voiceId = body.voiceId;
      if (body.voiceName !== undefined) e.voiceName = body.voiceName;
      if (body.arkAssetId !== undefined) e.arkAssetId = String(body.arkAssetId).trim().replace(/^asset:\/\//, '');
      if (body.heygenAvatarId !== undefined || body.heygenWideAvatarId !== undefined
        || body.heygenCloseAvatarId !== undefined || body.heygenMotionPrompt !== undefined
        || body.heygenWideMotionPrompt !== undefined || body.heygenCloseMotionPrompt !== undefined) {
        const wideAvatarId = String(body.heygenWideAvatarId ?? body.heygenAvatarId ?? e.heygen?.wideAvatarId ?? e.heygen?.avatarId ?? '').trim().slice(0, 200);
        const legacyMotionPrompt = body.heygenMotionPrompt;
        const wideMotionPrompt = String(body.heygenWideMotionPrompt ?? legacyMotionPrompt ?? heyGenMotionPromptValue(e.heygen, 'wideMotionPrompt')).trim().slice(0, 1000);
        const closeMotionPrompt = String(body.heygenCloseMotionPrompt ?? legacyMotionPrompt ?? heyGenMotionPromptValue(e.heygen, 'closeMotionPrompt')).trim().slice(0, 1000);
        e.heygen = {
          ...(e.heygen || {}),
          avatarId: wideAvatarId,
          wideAvatarId,
          closeAvatarId: String(body.heygenCloseAvatarId ?? e.heygen?.closeAvatarId ?? '').trim().slice(0, 200),
          motionPrompt: wideMotionPrompt,
          wideMotionPrompt,
          closeMotionPrompt
        };
      }
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
    if (!/^(generated|uploads|characters|elements)\//.test(assetKey)) throw new Error('Solo se pueden usar imágenes como foto.');
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
    if (!/^(generated|uploads|characters|elements)\//.test(key)) throw new Error('Solo se pueden asociar imágenes.');
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

    // HeyGen vuelve desde otro sitio y puede no traer la cookie local; el
    // state de un solo uso + PKCE autentican este callback.
    if (p === '/api/heygen/oauth/callback' && req.method === 'GET') {
      const state = String(url.searchParams.get('state') || '');
      const pending = heygenOAuthStates.get(state);
      heygenOAuthStates.delete(state);
      let ok = false; let detail = '';
      try {
        if (!pending || pending.expiresAt < Date.now()) throw new Error('La solicitud OAuth venció. Volvé a iniciarla desde Manifestador.');
        const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
        if (oauthError) throw new Error(oauthError);
        const code = String(url.searchParams.get('code') || '');
        if (!code) throw new Error('HeyGen no devolvió el código OAuth.');
        const token = await exchangeHeyGenOAuthCode({
          clientId: pending.clientId, redirectUri: pending.redirectUri, code, codeVerifier: pending.codeVerifier
        });
        await writeJson('heygen-oauth.json', {
          clientId: pending.clientId, redirectUri: pending.redirectUri,
          accessToken: token.access_token, refreshToken: token.refresh_token || '',
          expiresAt: oauthExpiry(token), scope: token.scope || '', updatedAt: Date.now()
        });
        ok = true; detail = 'HeyGen quedó conectado con OAuth.';
      } catch (error) { detail = error.message || 'No se pudo conectar HeyGen.'; }
      const safeDetail = JSON.stringify(detail).replace(/</g, '\\u003c');
      const html = `<!doctype html><html><meta charset="utf-8"><title>HeyGen · Manifestador</title><body style="font:16px system-ui;padding:40px;background:#17101f;color:#fff"><h2>${ok ? 'HeyGen conectado' : 'No se pudo conectar HeyGen'}</h2><p>${detail.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</p><script>window.opener?.postMessage({type:'manifestador-heygen-oauth',ok:${ok},detail:${safeDetail}},location.origin);setTimeout(()=>window.close(),900)</script></body></html>`;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    // Integración local servidor-a-servidor con Controversy Tracker. El límite
    // de confianza es loopback: la contraseña sigue protegiendo la interfaz,
    // archivos y APIs de usuario, pero no puede dejar inoperante el conector
    // por una copia ausente o desactualizada en el IndexedDB del Tracker.
    if (p === '/api/integrations/controversy-tracker/health' && req.method === 'GET') {
      if (!isLoopbackRequest(req)) return send(res, 403, { error: 'La integración con Controversy Tracker sólo admite conexiones locales.' });
      const cfg = await getConfig();
      return send(res, 200, {
        ok: true,
        service: 'manifestador',
        contract: AUTOMATION_CONTRACT,
        protected: false,
        appProtected: Boolean(cfg.accessPasswordHash),
        transport: 'loopback'
      });
    }
    if (p === '/api/integrations/controversy-tracker/projects' && req.method === 'POST') {
      if (!isLoopbackRequest(req)) return send(res, 403, { error: 'La integración con Controversy Tracker sólo admite conexiones locales.' });
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
        out.finalOutput = null;
        out.effectOutput = null;
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

    // Los nodos Tuzzi de ComfyUI (mismo equipo) necesitan descargar referencias
    // de /files/ sin sesión de navegador — mismo criterio de confianza que ya
    // usa la integración con Controversy Tracker (isLoopbackRequest).
    if ((p.startsWith('/api/') || p.startsWith('/files/') || p.startsWith('/fonts/')) && !(p.startsWith('/files/') && isLoopbackRequest(req))) {
      const cfg = await getConfig();
      const token = sessionToken(req);
      if (cfg.accessPasswordHash && (sessions.get(token) || 0) <= Date.now()) {
        return send(res, 401, { error: 'Acceso bloqueado', loginRequired: true });
      }
    }

    if (p === '/api/heygen/oauth/start' && req.method === 'POST') {
      if (!isLoopbackRequest(req)) return send(res, 403, { error: 'Por seguridad, HeyGen OAuth sólo se inicia desde localhost.' });
      const redirectUri = oauthRedirectUri(req);
      if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(redirectUri)) {
        return send(res, 400, { error: 'Abrí Manifestador con localhost o 127.0.0.1 para conectar HeyGen OAuth.' });
      }
      const saved = await readJson('heygen-oauth.json', {});
      let clientId = saved.redirectUri === redirectUri ? saved.clientId : '';
      if (!clientId) clientId = (await registerHeyGenOAuthClient(redirectUri)).client_id;
      const state = crypto.randomBytes(24).toString('base64url');
      const codeVerifier = crypto.randomBytes(48).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      heygenOAuthStates.set(state, { clientId, redirectUri, codeVerifier, expiresAt: Date.now() + 10 * 60_000 });
      return send(res, 200, { url: heyGenAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }), localhostSupported: true });
    }
    if (p === '/api/heygen/oauth/status' && req.method === 'GET') {
      const saved = await readJson('heygen-oauth.json', {});
      if (!saved.accessToken) return send(res, 200, { connected: false, localhostSupported: true });
      try {
        const auth = await getHeyGenOAuth();
        const account = safeHeyGenAccount(await getHeyGenMcpUser(auth.accessToken));
        return send(res, 200, { connected: true, localhostSupported: true, expiresAt: auth.expiresAt, account });
      } catch (error) {
        return send(res, 200, { connected: false, localhostSupported: true, error: error.message });
      }
    }
    if (p === '/api/heygen/oauth/disconnect' && req.method === 'POST') {
      const saved = await readJson('heygen-oauth.json', {});
      await writeJson('heygen-oauth.json', { clientId: saved.clientId || '', redirectUri: saved.redirectUri || '' });
      return send(res, 200, { connected: false, localhostSupported: true });
    }

    // --- fuentes personalizadas persistentes ---
    if (p.startsWith('/fonts/')) {
      const fileName = decodeURIComponent(p.slice('/fonts/'.length));
      if (!fileName || path.basename(fileName) !== fileName) return send(res, 400, { error: 'Nombre de fuente inválido.' });
      const fontDir = path.join(DATA_DIR, 'fonts');
      const abs = path.join(fontDir, fileName);
      const resolved = path.resolve(abs);
      if (!resolved.startsWith(path.resolve(fontDir) + path.sep)) return send(res, 400, { error: 'Ruta de fuente inválida.' });
      const buf = await fs.readFile(resolved).catch(() => null);
      if (!buf) return send(res, 404, { error: 'Fuente no encontrada.' });
      return send(res, 200, buf, { mime: STATIC_MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream' });
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
      const [cfg, characters, prompts, promptCategories, history, pricing, assetLinks, series, scripts, elements, elementLinks, automations, fonts, overlayPresets, transitionSounds, subtitler] = await Promise.all([
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
        readJson('automations.json', []),
        readJson('fonts.json', []),
        readJson('overlay-presets.json', []),
        listTransitionSounds(),
        readJson('subtitler.json', DEFAULT_SUBTITLER_STORE)
      ]);
      return send(res, 200, {
        config: publicConfig(cfg),
        models: IMAGE_MODELS,
        videoModels: VIDEO_MODELS,
        audioModels: AUDIO_MODELS,
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
        automations: automations.map(automationForClient),
        fonts,
        overlayPresets,
        subtitler: subtitlerForClient(subtitler),
        transitionSounds: transitionSounds.map((sound) => ({
          id: sound.id,
          category: sound.category,
          name: sound.name,
          url: sound.url
        }))
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

    if (p === '/api/fonts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const originalName = String(body.fileName || body.name || '').trim();
      const extension = path.extname(originalName).toLowerCase();
      if (!['.ttf', '.otf', '.woff', '.woff2'].includes(extension)) {
        return send(res, 400, { error: 'Formato no admitido. Usá TTF, OTF, WOFF o WOFF2.' });
      }
      const { buffer } = parseDataUrl(body.dataUrl);
      if (!buffer.length || buffer.length > 25 * 1024 * 1024) {
        return send(res, 400, { error: 'La fuente está vacía o supera el límite de 25 MB.' });
      }
      const signature = buffer.subarray(0, 4).toString('latin1');
      const validSignature = extension === '.woff' ? signature === 'wOFF'
        : extension === '.woff2' ? signature === 'wOF2'
        : extension === '.otf' ? signature === 'OTTO'
        : buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00]))
          || signature === 'true' || signature === 'typ1';
      if (!validSignature) return send(res, 400, { error: 'El archivo no parece contener una fuente válida.' });

      const id = newId();
      const displayName = String(body.name || path.basename(originalName, extension) || 'Fuente personalizada').trim().slice(0, 100);
      const file = `${id}-${sanitizeName(path.basename(originalName, extension))}${extension}`;
      const fontDir = path.join(DATA_DIR, 'fonts');
      await fs.mkdir(fontDir, { recursive: true });
      await fs.writeFile(path.join(fontDir, file), buffer);
      const item = {
        id,
        name: displayName || 'Fuente personalizada',
        family: `ManifestadorFont_${id}`,
        file,
        format: extension.slice(1),
        ts: Date.now()
      };
      await updateJson('fonts.json', [], (fonts) => [item, ...fonts]);
      return send(res, 200, item);
    }

    if (p === '/api/overlay-presets' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const item = sanitizeOverlayPreset(body);
      await updateJson('overlay-presets.json', [], (all) => [item, ...all].slice(0, 200));
      return send(res, 200, item);
    }
    if (p.startsWith('/api/overlay-presets/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      let found = false;
      await updateJson('overlay-presets.json', [], (all) => {
        found = all.some((item) => item.id === id);
        return all.filter((item) => item.id !== id);
      });
      return found ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Estilo no encontrado.' });
    }

    // --- Subtitulador independiente: video → audio temporal → Scribe v2 →
    // líneas editables → motor compartido Remotion → MP4 subtitulado. ---
    if (p === '/api/subtitler' && req.method === 'GET') {
      return send(res, 200, subtitlerForClient(await readJson('subtitler.json', DEFAULT_SUBTITLER_STORE)));
    }
    if (p === '/api/subtitler/projects' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const store = normalizeSubtitlerStore(await readJson('subtitler.json', DEFAULT_SUBTITLER_STORE));
      const now = Date.now();
      const project = normalizeSubtitlerProject({
        id: newId(),
        name: String(body.name || '').trim() || `Subtítulos ${store.projects.length + 1}`,
        createdAt: now,
        updatedAt: now,
        config: {
          overlay: { ...DEFAULT_OVERLAY },
          titleOverlay: { ...DEFAULT_TITLE_OVERLAY, mode: 'project' },
          dynamicText: { ...DEFAULT_DYNAMIC_TEXT, enabled: true }
        }
      }, store.projects.length);
      const nextStore = { activeProjectId: project.id, projects: [project, ...store.projects] };
      await writeJson('subtitler.json', nextStore);
      return send(res, 200, subtitlerForClient(nextStore));
    }
    const subtitlerOpenMatch = p.match(/^\/api\/subtitler\/projects\/([a-z0-9_-]+)\/open$/i);
    if (subtitlerOpenMatch && req.method === 'POST') {
      const store = normalizeSubtitlerStore(await readJson('subtitler.json', DEFAULT_SUBTITLER_STORE));
      const id = subtitlerOpenMatch[1];
      if (!store.projects.some((project) => project.id === id)) return send(res, 404, { error: 'Proyecto de subtítulos no encontrado.' });
      const nextStore = { ...store, activeProjectId: id };
      await writeJson('subtitler.json', nextStore);
      return send(res, 200, subtitlerForClient(nextStore));
    }
    const subtitlerDeleteMatch = p.match(/^\/api\/subtitler\/projects\/([a-z0-9_-]+)$/i);
    if (subtitlerDeleteMatch && req.method === 'DELETE') {
      const store = normalizeSubtitlerStore(await readJson('subtitler.json', DEFAULT_SUBTITLER_STORE));
      const id = subtitlerDeleteMatch[1];
      if (!store.projects.some((project) => project.id === id)) return send(res, 404, { error: 'Proyecto de subtítulos no encontrado.' });
      let projects = store.projects.filter((project) => project.id !== id);
      if (!projects.length) {
        const now = Date.now();
        projects = [normalizeSubtitlerProject({ id: newId(), name: 'Proyecto de subtítulos', createdAt: now, updatedAt: now })];
      }
      const nextStore = {
        activeProjectId: store.activeProjectId === id ? projects[0].id : store.activeProjectId,
        projects
      };
      await writeJson('subtitler.json', nextStore);
      return send(res, 200, subtitlerForClient(nextStore));
    }
    if (p === '/api/subtitler' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const store = normalizeSubtitlerStore(await readJson('subtitler.json', DEFAULT_SUBTITLER_STORE));
      const previous = activeSubtitlerProject(store, body.projectId);
      const { projectId, projects, activeProjectId, id, ...changes } = body;
      const next = normalizeSubtitlerProject({
        ...previous,
        ...changes,
        id: previous.id,
        config: { ...previous.config, ...(changes.config || {}) },
        outputs: previous.outputs,
        updatedAt: Date.now()
      });
      if (next.sourceVideoKey) await fs.access(await resolveAssetKey(next.sourceVideoKey));
      const nextStore = replaceSubtitlerProject(store, next);
      await writeJson('subtitler.json', nextStore);
      return send(res, 200, subtitlerForClient(nextStore));
    }
    if (p === '/api/subtitler/transcribe' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const store = normalizeSubtitlerStore(await readJson('subtitler.json', DEFAULT_SUBTITLER_STORE));
      const previous = activeSubtitlerProject(store, body.projectId);
      const sourceVideoKey = String(body.sourceVideoKey || previous.sourceVideoKey || '');
      if (!/^video\//.test(sourceVideoKey) || sourceVideoKey.includes('..')) {
        return send(res, 400, { error: 'Elegí o subí un video antes de transcribir.' });
      }
      const cfg = await getConfig();
      if (!cfg.keys.elevenlabs) return send(res, 400, { error: 'Falta la API key de ElevenLabs en Configuración.' });
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const sourcePath = await resolveAssetKey(sourceVideoKey);
      if (!(await probeHasAudioStream(ffmpegExecutable, sourcePath))) {
        return send(res, 400, { error: 'El video no contiene una pista de audio para transcribir.' });
      }
      const duration = await probeMediaDuration(ffmpegExecutable, sourcePath);
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const tempAudioPath = path.join(outDir, `.${ts()}-scribe-${newId()}.mp3`);
      let transcription;
      try {
        await runFfmpeg(ffmpegExecutable, [
          '-y', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', tempAudioPath
        ]);
        transcription = await transcribeSubtitleAudio({
          apiKey: cfg.keys.elevenlabs,
          audioPath: tempAudioPath,
          languageCode: /^[a-z]{2,3}$/i.test(String(body.languageCode || '')) ? String(body.languageCode).toLowerCase() : '',
          noVerbatim: body.noVerbatim !== false
        });
      } finally {
        await fs.unlink(tempAudioPath).catch(() => {});
      }
      const lines = subtitleLinesFromScribe(transcription?.words || []);
      if (!lines.length) return send(res, 422, { error: 'ElevenLabs no detectó palabras con marcas temporales en este video.' });
      const sourceName = path.basename(sourceVideoKey);
      const next = normalizeSubtitlerProject({
        ...previous,
        sourceVideoKey,
        sourceName,
        languageCode: body.languageCode || '',
        noVerbatim: body.noVerbatim !== false,
        transcript: {
          text: transcription.text || lines.map((line) => line.text).join(' '),
          languageCode: transcription.language_code || '',
          languageProbability: transcription.language_probability || 0,
          modelId: 'scribe_v2',
          transcribedAt: Date.now(),
          duration: duration || lines[lines.length - 1].end
        },
        lines,
        updatedAt: Date.now()
      });
      const nextStore = replaceSubtitlerProject(store, next);
      await writeJson('subtitler.json', nextStore);
      return send(res, 200, subtitlerForClient(nextStore));
    }
    if (p === '/api/subtitler/render' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const store = normalizeSubtitlerStore(await readJson('subtitler.json', DEFAULT_SUBTITLER_STORE));
      const previous = activeSubtitlerProject(store, body.projectId);
      const draft = normalizeSubtitlerProject({
        ...previous,
        ...body,
        config: { ...previous.config, ...(body.config || {}) },
        outputs: previous.outputs
      });
      if (!draft.sourceVideoKey) return send(res, 400, { error: 'Elegí o subí un video.' });
      if (!draft.lines.length) return send(res, 400, { error: 'Primero transcribí el video y revisá sus líneas.' });
      const words = subtitleWordsFromLines(draft.lines);
      if (!words.length) return send(res, 400, { error: 'No quedaron palabras para subtitular.' });
      const cfg = await getConfig();
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const sourcePath = await resolveAssetKey(draft.sourceVideoKey);
      const dimensions = await probeVideoDimensions(ffmpegExecutable, sourcePath);
      const duration = await probeMediaDuration(ffmpegExecutable, sourcePath);
      if (!dimensions || !duration) return send(res, 400, { error: 'No pude leer las dimensiones o duración del video.' });
      const width = Math.max(2, Math.floor(dimensions.width / 2) * 2);
      const height = Math.max(2, Math.floor(dimensions.height / 2) * 2);
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const layer = await renderSubtitleMotionOverlay({
        dynamicText: draft.config.dynamicText,
        overlay: draft.config.overlay,
        titleOverlay: draft.config.titleOverlay,
        titleText: draft.config.titleOverlay.enabled ? draft.config.titleOverlay.text : '',
        timeline: { words, duration }, duration, width, height, outDir,
        fileLabel: `subtitulos-${draft.sourceName || 'video'}`,
        metadata: { category: 'Subtitulador', subtitlerKind: 'text-overlay', subtitlerProjectId: draft.id, sourceVideoKey: draft.sourceVideoKey }
      });
      const outputName = `${ts()}-subtitulado-${sanitizeName(path.basename(draft.sourceVideoKey, path.extname(draft.sourceVideoKey)))}-${newId()}.mp4`;
      const outputPath = path.join(outDir, outputName);
      await runFfmpeg(ffmpegExecutable, [
        '-y', '-i', sourcePath, '-c:v', 'libvpx', '-i', layer.path, '-filter_complex',
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25[base];` +
        `[1:v]scale=${width}:${height},format=rgba,setpts=PTS-STARTPTS[layer];` +
        '[base][layer]overlay=0:0:eof_action=pass:shortest=0:format=auto,format=yuv420p[v]',
        '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k', '-t', String(duration), outputPath
      ]);
      const videoKey = `video/${outputName}`;
      const renderedAt = Date.now();
      await updateJson('asset-metadata.json', {}, (metadata) => ({
        ...metadata,
        [videoKey]: {
          type: 'video', modelId: 'remotion-subtitler', modelName: 'Subtitulador · Remotion', ts: renderedAt,
          category: 'Subtitulador', subtitlerKind: 'rendered-video', subtitlerProjectId: draft.id, sourceVideoKey: draft.sourceVideoKey,
          motionOverlayKey: layer.key, wordCount: words.length, duration, cost: 0
        }
      }));
      const output = { videoKey, motionOverlayKey: layer.key, sourceVideoKey: draft.sourceVideoKey, wordCount: words.length, duration, width, height, renderedAt };
      const next = normalizeSubtitlerProject({ ...draft, outputs: [output, ...previous.outputs].slice(0, 20), updatedAt: renderedAt });
      const nextStore = replaceSubtitlerProject(store, next);
      await writeJson('subtitler.json', nextStore);
      return send(res, 200, subtitlerForClient(nextStore));
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
        audioModelId: getAudioModel(body.audioModelId ?? cfg.audioModelId).id,
        poserPrompt: body.poserPrompt !== undefined ? String(body.poserPrompt) : cfg.poserPrompt,
        photoshopPath: body.photoshopPath !== undefined ? String(body.photoshopPath).trim() : cfg.photoshopPath,
        ffmpegPath: body.ffmpegPath !== undefined ? String(body.ffmpegPath).trim() : cfg.ffmpegPath,
        comfyui: {
          host: body.comfyui?.host !== undefined ? String(body.comfyui.host).trim() || DEFAULT_CONFIG.comfyui.host : cfg.comfyui.host,
          port: body.comfyui?.port !== undefined ? Number(body.comfyui.port) || DEFAULT_CONFIG.comfyui.port : cfg.comfyui.port,
          workflowPath: body.comfyui?.workflowPath !== undefined ? String(body.comfyui.workflowPath).trim() : cfg.comfyui.workflowPath
        },
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

    // Carga multimedia clasificada para Assets. Las imágenes se guardan en
    // Subidas y los videos en Videos, conservando una categoría y etiquetas
    // comunes que pueden editarse y filtrarse después.
    if (p === '/api/assets/visual' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { mime, buffer } = parseDataUrl(body.dataUrl);
      if (buffer.length > 100 * 1024 * 1024) throw new Error('El archivo supera el límite de 100 MB.');
      const visual = validateUploadedVisual(mime, buffer, body.name);
      const category = sanitizeVisualCategory(body.category);
      const tags = normalizeVisualTags(body.tags);
      const base = sanitizeName(body.name || visual.kind).replace(/\.[^.]+$/, '') || visual.kind;
      const cfg = await getConfig();
      const targetDir = resolveDir(visual.zone === 'video' ? cfg.paths.video : cfg.paths.uploads);
      await fs.mkdir(targetDir, { recursive: true });
      const existing = new Set(await fs.readdir(targetDir).catch(() => []));
      let name = `${ts()}-${base}${visual.extension}`;
      for (let index = 2; existing.has(name); index++) name = `${ts()}-${base}-${index}${visual.extension}`;
      const key = await saveBuffer(visual.zone, name, buffer);
      const metadata = {
        type: visual.kind, modelId: 'upload', modelName: 'Archivo subido', ts: Date.now(),
        prompt: '', cost: 0, category, tags, mime: visual.mime
      };
      await updateJson('asset-metadata.json', {}, (all) => ({ ...all, [key]: metadata }));
      return send(res, 200, { key, name, ...metadata });
    }

    // Carga de audios a su biblioteca propia. A diferencia del cargador de
    // imágenes, conserva la clasificación y las etiquetas necesarias para que
    // el Automatizador pueda encontrar música compatible con una obra.
    if (p === '/api/assets/audio' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { mime, buffer } = parseDataUrl(body.dataUrl);
      if (buffer.length > 100 * 1024 * 1024) throw new Error('El audio supera el límite de 100 MB.');
      const audioFile = validateUploadedAudio(mime, buffer);
      const audioKind = sanitizeAudioKind(body.audioKind);
      const musicTags = audioKind === 'music' ? normalizeMusicTags(body.musicTags) : normalizeMusicTags();
      const base = sanitizeName(body.name || 'audio').replace(/\.[^.]+$/, '') || 'audio';
      const audioDir = resolveDir((await getConfig()).paths.audio);
      await fs.mkdir(audioDir, { recursive: true });
      const existing = new Set(await fs.readdir(audioDir).catch(() => []));
      let name = `${ts()}-${base}${audioFile.extension}`;
      for (let n = 2; existing.has(name); n++) name = `${ts()}-${base}-${n}${audioFile.extension}`;
      const key = await saveBuffer('audio', name, buffer);
      const metadata = {
        type: 'audio', modelId: 'upload', modelName: 'Archivo subido', ts: Date.now(),
        prompt: '', cost: 0, audioKind, musicTags
      };
      await updateJson('asset-metadata.json', {}, (all) => ({ ...all, [key]: metadata }));
      return send(res, 200, { key, name, ...metadata });
    }

    if (p === '/api/assets' && req.method === 'GET') {
      const [generated, uploads, audio, video] = await Promise.all([
        listZone('generated'), listZone('uploads'), listZone('audio'), listZone('video')
      ]);
      const all = [...generated, ...uploads, ...audio, ...video];
      const metadata = await backfilledAssetMetadata(new Set(all.map((a) => a.key)));
      for (const item of all) {
        Object.assign(item, metadata[item.key] || {});
        if (item.key.startsWith('audio/')) {
          item.audioKind = sanitizeAudioKind(item.audioKind, item.modelId === MUSIC_MODEL.id ? 'music' : 'voice');
          item.musicTags = normalizeMusicTags(item.musicTags);
        } else {
          item.category = sanitizeVisualCategory(item.category);
          item.tags = normalizeVisualTags(item.tags);
        }
      }
      return send(res, 200, { generated, uploads, audio, video });
    }

    if (p === '/api/asset-links' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const key = String(body.key || '');
      if (!/^(generated|uploads|characters|elements)\//.test(key)) throw new Error('Solo se pueden asociar imágenes.');
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
          if (!/^(generated|uploads|characters|elements|video|audio)\//.test(key)) throw new Error(`Ese archivo no se puede asociar a una serie: ${key}`);
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
    if (p === '/api/automations' && req.method === 'GET') {
      const automations = await readJson('automations.json', []);
      return send(res, 200, { automations: automations.map(automationForClient) });
    }

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
          if (body.generatedCharacters !== undefined) {
            next.generatedCharacters = normalizeAutomationGeneratedCharacters(body.generatedCharacters, next.requirements?.characters);
          }
          if (body.config !== undefined) next.config = {
            ...prev.config,
            ...body.config,
            artStyle: body.config.artStyle !== undefined
              ? String(body.config.artStyle).trim().slice(0, 1200)
              : prev.config.artStyle,
            artStylePromptId: body.config.artStylePromptId !== undefined
              ? String(body.config.artStylePromptId || '').trim().slice(0, 80)
              : (prev.config.artStylePromptId || ''),
            artStyleImageKey: body.config.artStyleImageKey !== undefined
              ? normalizeStyleImageKey(body.config.artStyleImageKey)
              : normalizeStyleImageKey(prev.config.artStyleImageKey),
            includeLogos: body.config.includeLogos !== undefined
              ? body.config.includeLogos === true
              : prev.config?.includeLogos === true,
            videoEffect: normalizeAutomationVideoEffect({
              ...prev.config?.videoEffect,
              ...(body.config.videoEffect || {})
            }),
            dynamicText: normalizeAutomationDynamicText({
              ...prev.config?.dynamicText,
              ...(body.config.dynamicText || {})
            }),
            audioModelId: getAudioModel(body.config.audioModelId ?? prev.config?.audioModelId).id,
            heygenAuthMode: (body.config.heygenAuthMode ?? prev.config?.heygenAuthMode) === 'oauth' ? 'oauth' : 'key',
            transitionSound: normalizeAutomationTransitionSound({
              ...prev.config?.transitionSound,
              ...(body.config.transitionSound || {})
            }),
            music: normalizeAutomationMusic({ ...prev.config.music, ...(body.config.music || {}) }, prev.requirements?.music),
            overlay: normalizeAutomationOverlay({ ...prev.config.overlay, ...(body.config.overlay || {}) }),
            titleOverlay: normalizeAutomationTitleOverlay(
              { ...prev.config?.titleOverlay, ...(body.config.titleOverlay || {}) },
              next.blocks,
              prev.integration?.scriptTitle || next.name
            )
          };
          if (body.config?.overlay !== undefined
            && automationOverlayRenderSignature(prev.config?.overlay) !== automationOverlayRenderSignature(next.config?.overlay)) {
            if (next.finalOutput?.videoKey) next.textRefreshRequiredAt = Date.now();
            else next.outputs = Object.fromEntries(Object.entries(next.outputs || {}).map(([blockId, output]) => [
              blockId, invalidateAutomationOutput(output, { text: true })
            ]));
          }
          if (body.config?.dynamicText !== undefined
            && automationDynamicTextRenderSignature(prev.config?.dynamicText) !== automationDynamicTextRenderSignature(next.config?.dynamicText)) {
            if (next.finalOutput?.videoKey) next.textRefreshRequiredAt = Date.now();
            else next.outputs = Object.fromEntries(Object.entries(next.outputs || {}).map(([blockId, output]) => [
              blockId, invalidateAutomationOutput(output, { text: true })
            ]));
          }
          if (body.config?.titleOverlay !== undefined) {
            const previousTitle = normalizeAutomationTitleOverlay(prev.config?.titleOverlay, prev.blocks, prev.integration?.scriptTitle || prev.name);
            const nextTitle = normalizeAutomationTitleOverlay(next.config?.titleOverlay, next.blocks, next.integration?.scriptTitle || next.name);
            const titleRenderingChanged = automationTitleRenderSignature(previousTitle, prev.blocks, prev.integration?.scriptTitle || prev.name)
              !== automationTitleRenderSignature(nextTitle, next.blocks, next.integration?.scriptTitle || next.name);
            if (titleRenderingChanged) {
              if (next.finalOutput?.videoKey) next.textRefreshRequiredAt = Date.now();
              else {
                const affectsEveryBlock = previousTitle.mode === 'block' || nextTitle.mode === 'block';
                const affectedBlockIds = new Set([previousTitle.blockId, nextTitle.blockId].filter(Boolean));
                next.outputs = Object.fromEntries(Object.entries(next.outputs || {}).map(([blockId, output]) => [
                  blockId,
                  affectsEveryBlock || affectedBlockIds.has(blockId) ? invalidateAutomationOutput(output, { text: true }) : output
                ]));
              }
            }
          }
          if (body.config?.music !== undefined
            && JSON.stringify(normalizeAutomationMusic(prev.config?.music, prev.requirements?.music))
              !== JSON.stringify(normalizeAutomationMusic(next.config?.music, prev.requirements?.music))) next.finalOutput = null;
          if (body.config?.includeLogos !== undefined
            && (prev.config?.includeLogos === true) !== (next.config?.includeLogos === true)) next.finalOutput = null;
          if (body.config?.transitionSound !== undefined
            && JSON.stringify(normalizeAutomationTransitionSound(prev.config?.transitionSound))
              !== JSON.stringify(normalizeAutomationTransitionSound(next.config?.transitionSound))) next.finalOutput = null;
          // outputs por bloque (imagen, imagen+texto, audios, video) — se mergea por id de bloque
          if (body.outputs !== undefined && body.outputs && typeof body.outputs === 'object') {
            const changesRenderedVideo = Object.entries(body.outputs).some(([blockId, output]) =>
              String(prev.outputs?.[blockId]?.videoKey || '') !== String(output?.videoKey || ''));
            next.outputs = { ...prev.outputs, ...body.outputs };
            if (changesRenderedVideo) next.finalOutput = null;
          }
          if (body.blocks !== undefined) {
            const sanitized = sanitizeAutomation({ ...prev, requirements: prev.requirements, blocks: body.blocks }, prev).blocks;
            if (sanitized.some((block) => (block.generator !== 'assets' && !block.imagePrompt.trim()) || !block.items.length)) {
              throw new Error('Cada bloque debe conservar al menos un texto y, salvo que use Assets, un prompt visual.');
            }
            const previousById = new Map((prev.blocks || []).map((block) => [block.id, block]));
            const nextOutputs = {};
            let generationChanged = sanitized.length !== (prev.blocks || []).length;
            for (const block of sanitized) {
              const previousBlock = previousById.get(block.id);
              let output = next.outputs?.[block.id] || {};
              if (!previousBlock) {
                generationChanged = true;
              } else {
                const promptChanged = previousBlock.imagePrompt !== block.imagePrompt
                  || previousBlock.negativePrompt !== block.negativePrompt;
                const h3IsRelevant = previousBlock.generator === 'h3' || block.generator === 'h3';
                const h3GenerationChanged = h3IsRelevant && (
                  previousBlock.h3Mode !== block.h3Mode
                  || previousBlock.h3Resolution !== block.h3Resolution
                  || previousBlock.h3ContextIr !== block.h3ContextIr
                  || previousBlock.h3UseNarrationReference !== block.h3UseNarrationReference
                  || JSON.stringify(previousBlock.h3ReferenceKeys || []) !== JSON.stringify(block.h3ReferenceKeys || [])
                );
                const generatorChanged = previousBlock.generator !== block.generator
                  || previousBlock.heygenCharacterId !== block.heygenCharacterId
                  || previousBlock.heygenFraming !== block.heygenFraming
                  || h3GenerationChanged;
                const h3AudioOutputChanged = h3IsRelevant
                  && previousBlock.h3KeepGeneratedAudio !== block.h3KeepGeneratedAudio;
                const assetVisualChanged = JSON.stringify(previousBlock.assetKeys || []) !== JSON.stringify(block.assetKeys || [])
                  || previousBlock.assetMuteOriginal !== block.assetMuteOriginal;
                const textChanged = JSON.stringify(previousBlock.items || []) !== JSON.stringify(block.items || []);
                const blockTitleChanged = previousBlock.title !== block.title
                  && next.config?.titleOverlay?.enabled === true
                  && next.config?.titleOverlay?.mode === 'block';
                const titleOnlyRefresh = blockTitleChanged && next.finalOutput?.videoKey
                  && !promptChanged && !generatorChanged && !assetVisualChanged && !textChanged && !h3AudioOutputChanged;
                if (titleOnlyRefresh) {
                  next.textRefreshRequiredAt = Date.now();
                } else {
                  if (promptChanged || generatorChanged || assetVisualChanged || textChanged || blockTitleChanged || h3AudioOutputChanged) generationChanged = true;
                  output = invalidateAutomationOutput(output, {
                    image: promptChanged || generatorChanged,
                    text: textChanged || blockTitleChanged || generatorChanged || assetVisualChanged,
                    audio: textChanged || generatorChanged,
                    video: h3AudioOutputChanged
                  });
                }
              }
              nextOutputs[block.id] = output;
            }
            next.blocks = sanitized;
            next.outputs = nextOutputs;
            next.config.titleOverlay = normalizeAutomationTitleOverlay(
              next.config?.titleOverlay,
              next.blocks,
              next.integration?.scriptTitle || next.name
            );
            if (generationChanged) next.finalOutput = null;
          }
          if (body.data !== undefined) {
            const re = sanitizeAutomation(body.data, prev);
            next.requirements = re.requirements; next.blocks = re.blocks; next.name = re.name;
            next.finalOutput = null;
          }
          next.config = {
            ...next.config,
            includeLogos: next.config?.includeLogos === true,
            videoEffect: normalizeAutomationVideoEffect(next.config?.videoEffect),
            dynamicText: normalizeAutomationDynamicText(next.config?.dynamicText),
            audioModelId: getAudioModel(next.config?.audioModelId).id,
            heygenAuthMode: next.config?.heygenAuthMode === 'oauth' ? 'oauth' : 'key',
            transitionSound: normalizeAutomationTransitionSound(next.config?.transitionSound),
            music: normalizeAutomationMusic(next.config?.music, next.requirements?.music),
            overlay: normalizeAutomationOverlay(next.config?.overlay),
            titleOverlay: normalizeAutomationTitleOverlay(next.config?.titleOverlay, next.blocks, next.integration?.scriptTitle || next.name)
          };
          next.generatedCharacters = normalizeAutomationGeneratedCharacters(next.generatedCharacters, next.requirements?.characters);
          if (!next.finalOutput) next.effectOutput = null;
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

    const automationFinalizeMatch = /^\/api\/automations\/([a-z0-9]+)\/finalize$/.exec(p);
    if (automationFinalizeMatch && ['GET', 'POST'].includes(req.method)) {
      const projectId = automationFinalizeMatch[1];
      if (automationAssemblyJobs.has(projectId)) {
        return send(res, 409, { error: 'El proyecto todavía se está ensamblando. Esperá a que termine antes de finalizarlo.' });
      }
      const plan = await automationCleanupPlan(projectId);
      if (!plan) return send(res, 404, { error: 'Proyecto no encontrado.' });
      const summary = {
        generatedCount: plan.candidates.length,
        deleteCount: plan.deletable.length,
        deleteBytes: plan.deleteBytes,
        activeCount: plan.activeCount,
        sharedCount: plan.sharedCount,
        byType: plan.byType,
        sample: plan.deletable.slice(0, 12).map((item) => ({
          key: item.key,
          name: path.basename(item.key),
          bytes: item.bytes,
          kind: item.metadata.autoKind || item.metadata.type || item.key.split('/')[0]
        }))
      };
      if (req.method === 'GET') return send(res, 200, summary);

      const removed = new Set();
      const failed = [];
      for (const item of plan.deletable) {
        try {
          await fs.unlink(await resolveAssetKey(item.key));
          removed.add(item.key);
        } catch (error) {
          if (error?.code === 'ENOENT') removed.add(item.key);
          else failed.push({ key: item.key, error: error?.message || String(error) });
        }
      }

      await updateJson('asset-metadata.json', {}, (all) => {
        for (const key of removed) delete all[key];
        return all;
      });
      await updateJson('asset-links.json', [], (links) => links.filter((link) => !removed.has(link.key)));
      await updateJson('element-links.json', [], (links) => links.filter((link) => !removed.has(link.key)));
      await updateJson('series.json', [], (all) => all.map((series) => ({
        ...series,
        assetKeys: (series.assetKeys || []).filter((key) => !removed.has(key))
      })));
      await updateJson('scripts.json', [], (all) => all.map((script) => ({
        ...script,
        scenes: (script.scenes || []).map((scene) => ({
          ...scene,
          shots: (scene.shots || []).map((shot) => ({
            ...shot,
            assetKeys: (shot.assetKeys || []).filter((key) => !removed.has(key)),
            audioKeys: (shot.audioKeys || []).filter((key) => !removed.has(key))
          }))
        }))
      })));
      const cleanedHistory = await updateJson('history.json', [], (all) => all.map((entry) => ({
        ...entry,
        outputs: (entry.outputs || []).filter((key) => !removed.has(key)),
        refs: (entry.refs || []).filter((key) => !removed.has(key))
      })).filter((entry) => entry.outputs.length));
      await updateJson('audio-captions.json', {}, (captions) => {
        for (const key of removed) delete captions[key];
        return captions;
      });

      const finalizedAt = Date.now();
      let updatedProject = null;
      await updateJson('automations.json', [], (all) => all.map((project) => {
        if (project.id !== projectId) return project;
        updatedProject = {
          ...project,
          finalization: {
            finalizedAt,
            deletedCount: removed.size,
            deletedBytes: plan.deletable.filter((item) => removed.has(item.key)).reduce((sum, item) => sum + item.bytes, 0),
            retainedActiveCount: plan.activeCount,
            retainedSharedCount: plan.sharedCount,
            failedCount: failed.length
          },
          updatedAt: finalizedAt
        };
        return updatedProject;
      }));
      return send(res, 200, {
        ...summary,
        deleted: removed.size,
        failed,
        project: automationForClient(updatedProject),
        history: cleanedHistory.slice(0, 200)
      });
    }

    const automationMusicMatch = /^\/api\/automations\/([a-z0-9]+)\/music\/(auto-select|generate)$/.exec(p);
    if (automationMusicMatch && req.method === 'POST') {
      const [projectId, action] = [automationMusicMatch[1], automationMusicMatch[2]];
      const projects = await readJson('automations.json', []);
      const project = projects.find((item) => item.id === projectId);
      if (!project) return send(res, 404, { error: 'Proyecto no encontrado.' });
      const requested = await readJsonBody(req);
      const music = normalizeAutomationMusic({ ...project.config?.music, ...requested }, project.requirements?.music);

      let selected;
      let entry = null;
      if (action === 'auto-select') {
        selected = await findAutomaticMusicTrack(music);
        if (!selected) return send(res, 400, { error: 'No hay músicas clasificadas en Assets. Subí o generá una primero.' });
      } else {
        const styleParts = [
          'Instrumental background score designed to support spoken narration without overpowering voices',
          music.genres.length ? `Genre: ${music.genres.join(', ')}` : '',
          music.instruments.length ? `Instruments: ${music.instruments.join(', ')}` : '',
          music.moods.length ? `Mood and emotional tone: ${music.moods.join(', ')}` : '',
          'No vocals, no spoken words, cohesive cinematic arrangement, loop-friendly ending'
        ].filter(Boolean);
        entry = await runMusicGeneration({
          model: music.sunoModel,
          prompt: '',
          style: styleParts.join('. '),
          title: `${project.name} - Background score`.slice(0, 80),
          instrumental: true,
          customMode: true,
          musicTags: { genres: music.genres, instruments: music.instruments, moods: music.moods }
        });
        selected = { key: entry.outputs[0], name: path.basename(entry.outputs[0]), score: null, musicTags: normalizeMusicTags(music) };
        await updateJson('asset-metadata.json', {}, (metadata) => {
          for (const key of entry.outputs) metadata[key] = {
            ...(metadata[key] || {}),
            audioKind: 'music', musicTags: normalizeMusicTags(music),
            automationId: project.id, autoKind: 'background-music',
            cost: Number(entry.cost || 0) / Math.max(1, entry.outputs.length)
          };
          return metadata;
        });
      }

      let updatedProject;
      await updateJson('automations.json', [], (all) => all.map((item) => {
        if (item.id !== projectId) return item;
        updatedProject = {
          ...item,
          config: {
            ...item.config,
            music: normalizeAutomationMusic({ ...music, enabled: true, source: action === 'generate' ? 'suno' : 'auto', assetKey: selected.key }, item.requirements?.music),
            overlay: normalizeAutomationOverlay(item.config?.overlay)
          },
          finalOutput: null,
          effectOutput: null,
          updatedAt: Date.now()
        };
        return updatedProject;
      }));
      return send(res, 200, { project: updatedProject, selected, entry });
    }

    // Genera una toma de Automatizador con uno o dos avatares HeyGen usando
    // exactamente los audios que ya produjo ElevenLabs. Si hay dos encuadres,
    // cada grupo de audio se envia por separado y los clips se unen localmente.
    const automationHeyGenBlockMatch = /^\/api\/automations\/([a-z0-9]+)\/heygen-block$/.exec(p);
    if (automationHeyGenBlockMatch && req.method === 'POST') {
      const projectId = automationHeyGenBlockMatch[1];
      const body = await readJsonBody(req);
      const projects = await readJson('automations.json', []);
      const project = projects.find((item) => item.id === projectId);
      if (!project) return send(res, 404, { error: 'Proyecto no encontrado.' });
      const block = project.blocks?.find((item) => item.id === String(body.blockId || ''));
      if (!block) return send(res, 404, { error: 'Bloque no encontrado.' });
      if (block.generator !== 'heygen') return send(res, 400, { error: 'Este bloque no está configurado para HeyGen.' });
      const characters = await readJson('characters.json', []);
      const requestedCharacterId = String(body.characterId || '');
      if (requestedCharacterId && requestedCharacterId !== block.heygenCharacterId) {
        return send(res, 400, { error: 'El personaje no coincide con la variante HeyGen guardada en el bloque.' });
      }
      const character = characters.find((item) => item.id === String(block.heygenCharacterId || ''));
      if (!character) return send(res, 404, { error: 'Personaje HeyGen no encontrado.' });
      const wideAvatarId = String(character.heygen?.wideAvatarId || character.heygen?.avatarId || '').trim();
      const closeAvatarId = String(character.heygen?.closeAvatarId || '').trim();
      if (!wideAvatarId) return send(res, 400, { error: 'La variante HeyGen necesita el código de plano general.' });

      const framing = ['wide', 'close', 'split'].includes(body.framing) ? body.framing : 'wide';
      if (['close', 'split'].includes(framing) && !closeAvatarId) return send(res, 400, { error: 'Falta el código HeyGen de primer plano.' });
      const rawGroups = Array.isArray(body.audioGroups) ? body.audioGroups : [];
      const audioGroups = rawGroups.map((group) => (Array.isArray(group) ? group : []).map(String).filter((key) => /^audio\//.test(key))).filter((group) => group.length);
      const expectedGroups = framing === 'split' ? 2 : 1;
      if (audioGroups.length !== expectedGroups) return send(res, 400, { error: `HeyGen necesita ${expectedGroups} grupo(s) de audio para este encuadre.` });
      const requestedSegmentIndex = body.regenerateSegmentIndex === undefined ? -1 : Number(body.regenerateSegmentIndex);
      const regenerateSegmentIndex = framing === 'split' && [0, 1].includes(requestedSegmentIndex) ? requestedSegmentIndex : -1;
      if (body.regenerateSegmentIndex !== undefined && regenerateSegmentIndex < 0) {
        return send(res, 400, { error: 'Sólo se puede regenerar un plano individual en una toma HeyGen de dos planos.' });
      }

      const cfg = await getConfig();
      const authMode = project.config?.heygenAuthMode === 'oauth' ? 'oauth' : 'key';
      const apiKey = String(cfg.keys.heygen || '').trim();
      const oauth = authMode === 'oauth' ? await getHeyGenOAuth() : null;
      if (authMode === 'key' && !apiKey) return send(res, 400, { error: 'Falta la API key de HeyGen en Configuración.' });
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const temporaryAudioPaths = [];

      const audioPathForGroup = async (keys, index) => {
        const paths = [];
        for (const key of keys) paths.push(await resolveAssetKey(key));
        if (paths.length === 1) return paths[0];
        const tempPath = path.join(outDir, `.heygen-audio-${projectId}-${block.id}-${index}-${newId()}.mp3`);
        const args = ['-y'];
        for (const inputPath of paths) args.push('-i', inputPath);
        const inputs = paths.map((_, inputIndex) => `[${inputIndex}:a]`).join('');
        args.push('-filter_complex', `${inputs}concat=n=${paths.length}:v=0:a=1[a]`, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '192k', tempPath);
        await runFfmpeg(ffmpegExecutable, args);
        temporaryAudioPaths.push(tempPath);
        return tempPath;
      };

      try {
        const preparedAudioPaths = [];
        for (const [index, group] of audioGroups.entries()) preparedAudioPaths.push(await audioPathForGroup(group, index));
        const avatarIds = framing === 'split' ? [wideAvatarId, closeAvatarId] : [framing === 'close' ? closeAvatarId : wideAvatarId];
        const aspectRatio = ['16:9', '9:16', '4:5', '5:4', '1:1', 'auto'].includes(project.config?.aspectRatio) ? project.config.aspectRatio : '9:16';
        const resolution = project.config?.resolution === '1K' ? '720p' : '1080p';
        const { width, height } = automationVideoDimensions(aspectRatio);
        const generateClip = async (audioPath, index) => {
          const buffer = await fs.readFile(audioPath);
          const extension = path.extname(audioPath).toLowerCase();
          const mime = extension === '.wav' ? 'audio/wav' : extension === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
          const idem = `automation-${projectId}-${block.id}-${index}-${newId()}`;
          const upload = authMode === 'oauth'
            ? await uploadHeyGenAssetWithMcp({ accessToken: oauth.accessToken, buffer, filename: path.basename(audioPath), mime })
            : await uploadHeyGenAssetWithKey({ apiKey, buffer, filename: path.basename(audioPath), mime, idempotencyKey: `${idem}-audio` });
          if (!upload.asset_id) throw new Error('HeyGen subió el audio, pero no devolvió asset_id.');
          const payload = {
            type: 'avatar',
            avatar_id: avatarIds[index],
            audio_asset_id: upload.asset_id,
            title: `${project.name} - ${block.title || block.id} - ${index + 1}`.slice(0, 160),
            resolution,
            aspect_ratio: aspectRatio,
            output_format: 'mp4',
            engine: { type: 'avatar_iv' }
          };
          const usesClosePrompt = framing === 'close' || (framing === 'split' && index === 1);
          const motionPrompt = heyGenMotionPromptValue(character.heygen, usesClosePrompt ? 'closeMotionPrompt' : 'wideMotionPrompt');
          if (motionPrompt) payload.motion_prompt = motionPrompt;
          const created = authMode === 'oauth'
            ? await createHeyGenVideoWithMcp({ accessToken: oauth.accessToken, payload })
            : await createHeyGenVideoWithKey({ apiKey, payload, idempotencyKey: idem });
          const videoId = created.video_id || created.id;
          if (!videoId) throw new Error('HeyGen aceptó el audio, pero no devolvió video_id.');
          const finished = await waitForHeyGenVideo(() => authMode === 'oauth'
            ? getHeyGenVideoWithMcp({ accessToken: oauth.accessToken, videoId })
            : getHeyGenVideoWithKey({ apiKey, videoId }));
          const videoBuffer = await downloadHeyGenVideo(finished.video_url);
          const key = await saveBuffer('video', `${ts()}-auto-heygen-${index + 1}-${newId()}.mp4`, videoBuffer);
          const duration = Number(finished.duration || finished.duration_seconds || created.duration || 0);
          const model = getVideoModel('heygen-avatar-iv');
          const cost = authMode === 'key' && duration > 0 ? duration * Number(model?.apiPricePerSecond || 0) : 0;
          await recordCost({ type: 'video', modelId: 'heygen-avatar-iv', label: `HeyGen Avatar IV${authMode === 'oauth' ? ' (plan web)' : ' (API)'}`, units: duration || 1, unitLabel: duration ? 'segundo(s)' : 'video', cost });
          return { key, videoId, duration, cost, reused: false };
        };

        // Cada clip queda ligado al proyecto apenas se descarga. Si el segundo
        // plano o FFmpeg fallan después, Continuar reutiliza lo ya pagado.
        const storedSegmentKeys = Array.isArray(project.outputs?.[block.id]?.heygenSegmentVideoKeys)
          ? project.outputs[block.id].heygenSegmentVideoKeys.slice(0, expectedGroups)
          : [];
        const clipResults = Array(expectedGroups).fill(null);
        for (const [index, key] of storedSegmentKeys.entries()) {
          if (index === regenerateSegmentIndex) continue;
          if (!/^video\//.test(String(key || ''))) break;
          const exists = await fs.access(await resolveAssetKey(key)).then(() => true).catch(() => false);
          if (!exists) break;
          clipResults[index] = { key, videoId: '', duration: 0, cost: 0, reused: true };
        }
        if (regenerateSegmentIndex >= 0 && !clipResults[regenerateSegmentIndex === 0 ? 1 : 0]) {
          return send(res, 400, { error: 'No encuentro el otro plano guardado. Usá Continuar para reconstruir la toma completa.' });
        }
        for (let index = 0; index < preparedAudioPaths.length; index++) {
          if (clipResults[index]) continue;
          const clip = await generateClip(preparedAudioPaths[index], index);
          clipResults[index] = clip;
          const partialKeys = clipResults.map((item) => item?.key || '');
          while (partialKeys.length && !partialKeys[partialKeys.length - 1]) partialKeys.pop();
          await updateJson('automations.json', [], (all) => all.map((item) => item.id !== projectId ? item : ({
            ...item,
            outputs: {
              ...(item.outputs || {}),
              [block.id]: {
                ...(item.outputs?.[block.id] || {}),
                heygenSegmentVideoKeys: partialKeys,
                generator: 'heygen',
                heygenFraming: framing,
                ...(regenerateSegmentIndex >= 0 ? { videoKey: null, completedAt: null } : {}),
                ts: Date.now()
              }
            },
            updatedAt: Date.now()
          })));
        }

        if (clipResults.some((item) => !item)) throw new Error('No se pudieron preparar todos los planos HeyGen.');
        const segmentVideoKeys = clipResults.map((item) => item.key);
        let videoKey = segmentVideoKeys[0];
        if (segmentVideoKeys.length === 2) {
          const videoPaths = [];
          for (const key of segmentVideoKeys) videoPaths.push(await resolveAssetKey(key));
          const name = `${ts()}-auto-heygen-unido-${newId()}.mp4`;
          const outPath = path.join(outDir, name);
          const args = ['-y', '-i', videoPaths[0], '-i', videoPaths[1], '-filter_complex',
            `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25[v0];` +
            `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25[v1];` +
            `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];` +
            `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a1];` +
            '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
            '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', outPath];
          await runFfmpeg(ffmpegExecutable, args);
          videoKey = `video/${name}`;
        }

        const captionAudioKeys = audioGroups.flat();
        const captionAudioPaths = [];
        for (const key of captionAudioKeys) captionAudioPaths.push(await resolveAssetKey(key));
        const motionOverlay = await renderAutomationMotionOverlay({
          project,
          block,
          audioKeys: captionAudioKeys,
          audioPaths: captionAudioPaths,
          ffmpegExecutable,
          width,
          height,
          outDir
        });
        const textLayerKey = String(body.textLayerKey || '');
        if (motionOverlay) {
          const baseVideoPath = await resolveAssetKey(videoKey);
          const name = `${ts()}-auto-heygen-remotion-${newId()}.mp4`;
          const outPath = path.join(outDir, name);
          const args = ['-y', '-i', baseVideoPath, '-c:v', 'libvpx', '-i', motionOverlay.path, '-filter_complex',
            `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25[base];` +
            `[1:v]scale=${width}:${height},format=rgba,setpts=PTS-STARTPTS[layer];` +
            '[base][layer]overlay=0:0:shortest=1:format=auto,format=yuv420p[v]',
            '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '192k', '-shortest', outPath];
          await runFfmpeg(ffmpegExecutable, args);
          videoKey = `video/${name}`;
        } else if (/^(generated|uploads)\//.test(textLayerKey)) {
          const baseVideoPath = await resolveAssetKey(videoKey);
          const textLayerPath = await resolveAssetKey(textLayerKey);
          const name = `${ts()}-auto-heygen-texto-${newId()}.mp4`;
          const outPath = path.join(outDir, name);
          const args = ['-y', '-i', baseVideoPath, '-i', textLayerPath, '-filter_complex',
            `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[base];` +
            `[1:v]scale=${width}:${height},format=rgba[layer];[base][layer]overlay=0:0:format=auto,format=yuv420p[v]`,
            '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '192k', '-shortest', outPath];
          await runFfmpeg(ffmpegExecutable, args);
          videoKey = `video/${name}`;
        }

        const category = `Auto: ${project.name}`.slice(0, 80);
        await updateJson('asset-metadata.json', {}, (metadata) => {
          for (const [index, item] of clipResults.entries()) {
            if (item.reused && metadata[item.key]) continue;
            metadata[item.key] = {
              type: 'video', modelId: 'heygen-avatar-iv', modelName: 'HeyGen Avatar IV', ts: Date.now(), category,
              automationId: projectId, blockId: block.id, heygenVideoId: item.videoId, heygenFraming: framing === 'split' ? (index === 0 ? 'wide' : 'close') : framing,
              characterId: character.id, cost: Number(item.cost.toFixed(6))
            };
          }
          if (!segmentVideoKeys.includes(videoKey)) metadata[videoKey] = {
            type: 'video', modelId: 'ffmpeg', modelName: 'HeyGen · composición local', ts: Date.now(), category,
            automationId: projectId, blockId: block.id, heygenFraming: framing, characterId: character.id,
            motionOverlayKey: motionOverlay?.key || null, cost: 0
          };
          return metadata;
        });
        return send(res, 200, { videoKey, segmentVideoKeys, framing, characterId: character.id, motionOverlayKey: motionOverlay?.key || '' });
      } finally {
        for (const tempPath of temporaryAudioPaths) await fs.unlink(tempPath).catch(() => {});
      }
    }

    // MiniMax H3 dentro del Automatizador. Divide cada voz en tramos de hasta
    // 15 segundos, conserva los clips originales para reensamblar textos sin
    // volver a pagar el modelo y ajusta el master a la duración exacta de TTS.
    const automationH3BlockMatch = /^\/api\/automations\/([a-z0-9]+)\/h3-block$/.exec(p);
    if (automationH3BlockMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const projectId = automationH3BlockMatch[1];
      const projects = await readJson('automations.json', []);
      const project = projects.find((item) => item.id === projectId);
      if (!project) return send(res, 404, { error: 'Proyecto no encontrado.' });
      const block = project.blocks?.find((item) => item.id === String(body.blockId || ''));
      if (!block) return send(res, 404, { error: 'Bloque no encontrado.' });
      if (block.generator !== 'h3') return send(res, 400, { error: 'Este bloque no está configurado para MiniMax H3.' });

      const cfg = await getConfig();
      if (!cfg.keys.minimax) return send(res, 400, { error: 'Falta la API key de MiniMax en Configuración.' });
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const audioKeys = (Array.isArray(body.audioKeys) ? body.audioKeys : []).map(String).filter((key) => /^audio\//.test(key));
      if (!audioKeys.length) return send(res, 400, { error: 'Falta la narración del bloque.' });
      const audioPaths = await Promise.all(audioKeys.map((key) => resolveAssetKey(key)));
      const audioDurations = await Promise.all(audioPaths.map((audioPath) => probeMediaDuration(ffmpegExecutable, audioPath)));
      if (audioDurations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
        return send(res, 400, { error: 'No pude calcular la duración de todos los audios del bloque.' });
      }

      const mode = block.h3Mode === 'frames' ? 'frames' : 'reference';
      const configuredKeys = normalizeAutomationH3ReferenceKeys(block.h3ReferenceKeys);
      const imageKey = String(body.imageKey || '');
      let referenceKeys;
      if (mode === 'frames') {
        referenceKeys = configuredKeys;
        if (referenceKeys.length !== 2 || referenceKeys.some((key) => /^(video|audio)\//.test(key))) {
          return send(res, 400, { error: 'Inicio → Fin de H3 necesita exactamente dos imágenes: entrada y salida.' });
        }
      } else {
        if (!/^(generated|uploads)\//.test(imageKey)) return send(res, 400, { error: 'Falta la imagen base del bloque H3.' });
        referenceKeys = [...new Set([imageKey, ...configuredKeys])];
      }
      const referencePaths = await Promise.all(referenceKeys.map((key) => resolveAssetKey(key)));
      const allStats = await Promise.all([...referencePaths, ...audioPaths].map((filePath) => fs.stat(filePath).catch(() => null)));
      if (allStats.some((stat) => !stat?.isFile())) return send(res, 400, { error: 'No encuentro una o más referencias de MiniMax H3.' });

      const chunks = [];
      for (const [audioIndex, audioDuration] of audioDurations.entries()) {
        let start = 0;
        while (start < audioDuration - 0.001) {
          const duration = Math.min(15, audioDuration - start);
          chunks.push({ audioIndex, start, duration, requestDuration: Math.max(4, Math.min(15, Math.ceil(duration))) });
          start += duration;
        }
      }
      if (!chunks.length) return send(res, 400, { error: 'La narración no contiene audio utilizable.' });

      const model = getVideoModel('minimax-h3');
      const resolution = block.h3Resolution === '2K' ? '2K' : '768P';
      const aspectRatio = model.aspectRatios.includes(project.config?.aspectRatio) ? project.config.aspectRatio : '9:16';
      const { width, height } = automationVideoDimensions(aspectRatio);
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const temporaryPaths = [];
      const storedKeys = (Array.isArray(body.reuseSegmentKeys) ? body.reuseSegmentKeys : [])
        .map((key) => String(key || '').trim())
        .filter((key) => /^video\//.test(key) && key.length <= 500 && !key.includes('..') && !key.includes('\\'))
        .slice(0, 500);
      const clipResults = Array(chunks.length).fill(null);
      for (const [index, key] of storedKeys.slice(0, chunks.length).entries()) {
        const exists = await fs.access(await resolveAssetKey(key)).then(() => true).catch(() => false);
        if (!exists) break;
        clipResults[index] = { key, reused: true };
      }

      try {
        for (const [index, chunk] of chunks.entries()) {
          if (clipResults[index]) continue;
          const refs = [];
          for (const [refIndex, key] of referenceKeys.entries()) {
            refs.push({
              key, path: referencePaths[refIndex],
              kind: key.startsWith('video/') ? 'video' : key.startsWith('audio/') ? 'audio' : 'image'
            });
          }
          if (mode === 'reference' && block.h3UseNarrationReference !== false) {
            const chunkPath = path.join(outDir, `.h3-voice-${projectId}-${block.id}-${index}-${newId()}.mp3`);
            await runFfmpeg(ffmpegExecutable, [
              '-y', '-ss', chunk.start.toFixed(6), '-i', audioPaths[chunk.audioIndex],
              '-af', 'apad', '-t', String(chunk.requestDuration), '-c:a', 'libmp3lame', '-b:a', '192k', chunkPath
            ]);
            temporaryPaths.push(chunkPath);
            refs.push({ key: audioKeys[chunk.audioIndex], path: chunkPath, kind: 'audio' });
          }
          const counts = {
            image: refs.filter((ref) => ref.kind === 'image').length,
            video: refs.filter((ref) => ref.kind === 'video').length,
            audio: refs.filter((ref) => ref.kind === 'audio').length
          };
          if (refs.length > 12 || counts.image > 9 || counts.video > 3 || counts.audio > 3) {
            throw new Error('Las referencias del bloque superan los límites de H3: 9 imágenes, 3 videos, 3 audios y 12 archivos en total.');
          }
          await validateMiniMaxH3Media(refs, ffmpegExecutable);
          const prompt = [
            project.config?.artStyle ? `GLOBAL ART DIRECTION — preserve this aesthetic consistently: ${String(project.config.artStyle).slice(0, 1200)}` : '',
            block.imagePrompt,
            block.negativePrompt ? `Avoid: ${block.negativePrompt}` : '',
            block.h3UseNarrationReference !== false && mode === 'reference'
              ? 'Use the supplied voice audio as the exact performance and timing reference. Preserve speaker identity and synchronize visible speech when a person is on screen.'
              : ''
          ].filter(Boolean).join('\n\n').slice(0, 7000);
          const generated = await generateMiniMaxH3Video({
            apiKey: cfg.keys.minimax, endpoint: cfg.endpoints.minimax, apiModel: model.apiModel,
            prompt, mediaRefs: refs, mode, aspectRatio, resolution,
            duration: chunk.requestDuration, contextIr: block.h3ContextIr === true
          });
          const key = await saveBuffer('video', `${ts()}-auto-h3-${index + 1}-${newId()}.mp4`, generated.buffer);
          const pricing = await getPricing();
          const outputSeconds = Number(generated.usage?.output_seconds) || chunk.requestDuration;
          const inputSeconds = Number(generated.usage?.input_seconds) || 0;
          const inputImages = Number(generated.usage?.input_image_count) || counts.image;
          const contextCost = generated.contextUsage
            ? (Number(generated.contextUsage.prompt_tokens) || 0) * 0.9 / 1_000_000
              + (Number(generated.contextUsage.completion_tokens) || 0) * 3.6 / 1_000_000
            : 0;
          const cost = videoPrice(pricing, model.id, resolution) * (outputSeconds + inputSeconds)
            + Math.max(0, inputImages - 5) * 0.04 + contextCost;
          await recordCost({
            type: 'video', modelId: model.id, label: `${model.name} ${resolution} · Automatizador`,
            units: outputSeconds, unitLabel: 'segundo(s)', cost
          });
          clipResults[index] = { key, taskId: generated.taskId, finalPrompt: generated.finalPrompt, cost, reused: false };
          const partialKeys = clipResults.map((item) => item?.key || '').filter(Boolean);
          await updateJson('automations.json', [], (all) => all.map((item) => item.id !== projectId ? item : ({
            ...item, outputs: { ...(item.outputs || {}), [block.id]: {
              ...(item.outputs?.[block.id] || {}), h3SegmentVideoKeys: partialKeys,
              generator: 'h3', h3Resolution: resolution, ts: Date.now()
            } }, updatedAt: Date.now()
          })));
          await updateJson('asset-metadata.json', {}, (metadata) => {
            metadata[key] = {
              type: 'video', modelId: model.id, modelName: model.name, ts: Date.now(),
              category: `Auto: ${project.name}`.slice(0, 80), automationId: projectId, blockId: block.id,
              h3TaskId: generated.taskId, h3ContextIr: block.h3ContextIr === true,
              h3ChunkIndex: index, h3Resolution: resolution, duration: chunk.duration,
              cost: Number(cost.toFixed(6))
            };
            return metadata;
          });
        }

        const segmentVideoKeys = clipResults.map((item) => item.key);
        const segmentPaths = await Promise.all(segmentVideoKeys.map((key) => resolveAssetKey(key)));
        const exactDuration = chunks.reduce((sum, chunk) => sum + chunk.duration, 0);
        const motionOverlay = await renderAutomationMotionOverlay({
          project, block, audioKeys, audioPaths, ffmpegExecutable, width, height, outDir,
          textHints: (block.items || []).map((item) => item.text)
        });
        const name = `${ts()}-auto-h3-${sanitizeName(block.title || block.id)}-${newId()}.mp4`;
        const outPath = path.join(outDir, name);
        const args = ['-y'];
        for (const segmentPath of segmentPaths) args.push('-i', segmentPath);
        const firstAudioInput = segmentPaths.length;
        for (const audioPath of audioPaths) args.push('-i', audioPath);
        let layerInputIndex;
        if (motionOverlay) {
          args.push('-c:v', 'libvpx', '-i', motionOverlay.path);
          layerInputIndex = segmentPaths.length + audioPaths.length;
        } else {
          const textLayerKey = String(body.textLayerKey || '');
          if (!/^(generated|uploads)\//.test(textLayerKey)) return send(res, 400, { error: 'Falta la capa estática de títulos y subtítulos.' });
          args.push('-loop', '1', '-framerate', '25', '-i', await resolveAssetKey(textLayerKey));
          layerInputIndex = segmentPaths.length + audioPaths.length;
        }

        const filters = [];
        const visualLabels = [];
        for (const [index, chunk] of chunks.entries()) {
          filters.push(`[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
            `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,` +
            `trim=start=0:duration=${chunk.duration.toFixed(6)},setpts=PTS-STARTPTS,format=yuv420p[h3v${index}]`);
          visualLabels.push(`[h3v${index}]`);
        }
        filters.push(`${visualLabels.join('')}concat=n=${visualLabels.length}:v=1:a=0[visual]`);

        const useGeneratedAudio = block.h3KeepGeneratedAudio === true
          && (await Promise.all(segmentPaths.map((segmentPath) => probeHasAudioStream(ffmpegExecutable, segmentPath)))).every(Boolean);
        let audioLabel;
        if (useGeneratedAudio) {
          const labels = [];
          for (const [index, chunk] of chunks.entries()) {
            filters.push(`[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
              `atrim=start=0:duration=${chunk.duration.toFixed(6)},asetpts=PTS-STARTPTS[h3a${index}]`);
            labels.push(`[h3a${index}]`);
          }
          filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[h3audio]`);
          audioLabel = 'h3audio';
        } else if (audioPaths.length > 1) {
          const labels = [];
          for (let index = 0; index < audioPaths.length; index++) {
            filters.push(`[${firstAudioInput + index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[voice${index}]`);
            labels.push(`[voice${index}]`);
          }
          filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[voice]`);
          audioLabel = 'voice';
        } else {
          filters.push(`[${firstAudioInput}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[voice]`);
          audioLabel = 'voice';
        }
        filters.push(`[${layerInputIndex}:v:0]scale=${width}:${height},format=rgba,` +
          `trim=start=0:duration=${exactDuration.toFixed(6)},setpts=PTS-STARTPTS[layer]`);
        filters.push('[visual][layer]overlay=0:0:shortest=1:format=auto,format=yuv420p[vout]');
        args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', `[${audioLabel}]`,
          '-t', exactDuration.toFixed(6), '-r', '25', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', outPath);
        await runFfmpeg(ffmpegExecutable, args);
        const videoKey = `video/${name}`;
        await updateJson('asset-metadata.json', {}, (metadata) => {
          metadata[videoKey] = {
            type: 'video', modelId: 'minimax-h3-assembly', modelName: 'Automatizador · MiniMax H3', ts: Date.now(),
            category: `Auto: ${project.name}`.slice(0, 80), automationId: projectId, blockId: block.id,
            h3SegmentVideoKeys: segmentVideoKeys, h3SegmentDurations: chunks.map((chunk) => chunk.duration), h3Resolution: resolution, h3Mode: mode,
            h3KeepGeneratedAudio: useGeneratedAudio, motionOverlayKey: motionOverlay?.key || null,
            width, height, duration: exactDuration, cost: 0
          };
          return metadata;
        });
        return send(res, 200, {
          videoKey, segmentVideoKeys, segmentDurations: chunks.map((chunk) => chunk.duration), motionOverlayKey: motionOverlay?.key || '',
          duration: exactDuration, h3Resolution: resolution, h3Mode: mode,
          keptGeneratedAudio: useGeneratedAudio
        });
      } finally {
        await Promise.all(temporaryPaths.map((filePath) => fs.unlink(filePath).catch(() => {})));
      }
    }

    // Monta un bloque a partir de una secuencia ordenada de Assets. Cada imagen
    // o video recibe la misma fracción de la duración de la voz; los videos se
    // repiten si son más cortos. El audio original puede mezclarse o silenciarse.
    const automationAssetBlockMatch = /^\/api\/automations\/([a-z0-9]+)\/asset-block$/.exec(p);
    if (automationAssetBlockMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const projectId = automationAssetBlockMatch[1];
      const projects = await readJson('automations.json', []);
      const project = projects.find((item) => item.id === projectId);
      if (!project) return send(res, 404, { error: 'Proyecto no encontrado.' });
      const block = project.blocks?.find((item) => item.id === String(body.blockId || ''));
      if (!block) return send(res, 404, { error: 'Bloque no encontrado.' });
      if (block.generator !== 'assets') return send(res, 400, { error: 'Este bloque no está configurado para usar Assets.' });
      const assetKeys = normalizeAutomationAssetKeys(block.assetKeys);
      if (!assetKeys.length) return send(res, 400, { error: 'Elegí al menos una imagen o video para este bloque.' });
      const audioKeys = (Array.isArray(body.audioKeys) ? body.audioKeys : []).map(String).filter((key) => /^audio\//.test(key));
      if (!audioKeys.length) return send(res, 400, { error: 'Falta el audio narrado del bloque.' });

      const cfg = await getConfig();
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const assetPaths = await Promise.all(assetKeys.map((key) => resolveAssetKey(key)));
      const audioPaths = await Promise.all(audioKeys.map((key) => resolveAssetKey(key)));
      const allStats = await Promise.all([...assetPaths, ...audioPaths].map((filePath) => fs.stat(filePath).catch(() => null)));
      if (allStats.some((stat) => !stat?.isFile())) return send(res, 400, { error: 'No encuentro uno o más Assets seleccionados.' });
      const audioDurations = await Promise.all(audioPaths.map((audioPath) => probeMediaDuration(ffmpegExecutable, audioPath)));
      if (audioDurations.some((duration) => !duration)) return send(res, 400, { error: 'No pude calcular la duración de todos los audios.' });
      const exactDuration = audioDurations.reduce((sum, duration) => sum + duration, 0);
      const segmentDuration = exactDuration / assetPaths.length;
      const { width, height } = automationVideoDimensions(project.config?.aspectRatio);
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const name = `${ts()}-auto-assets-${sanitizeName(block.title || block.id)}-${newId()}.mp4`;
      const outPath = path.join(outDir, name);
      const isVideo = assetKeys.map((key) => key.startsWith('video/'));
      const muteOriginal = block.assetMuteOriginal !== false;
      const hasOriginalAudio = muteOriginal
        ? isVideo.map(() => false)
        : await Promise.all(assetPaths.map((assetPath, index) => isVideo[index] ? probeHasAudioStream(ffmpegExecutable, assetPath) : false));

      const args = ['-y'];
      for (let index = 0; index < assetPaths.length; index++) {
        if (isVideo[index]) args.push('-stream_loop', '-1');
        else args.push('-loop', '1', '-framerate', '25');
        args.push('-i', assetPaths[index]);
      }
      const firstAudioInput = assetPaths.length;
      for (const audioPath of audioPaths) args.push('-i', audioPath);

      const motionOverlay = await renderAutomationMotionOverlay({
        project, block, audioKeys, audioPaths, ffmpegExecutable, width, height, outDir,
        textHints: (block.items || []).map((item) => item.text)
      });
      let layerInputIndex = -1;
      if (motionOverlay) {
        args.push('-c:v', 'libvpx', '-i', motionOverlay.path);
        layerInputIndex = assetPaths.length + audioPaths.length;
      } else {
        const textLayerKey = String(body.textLayerKey || '');
        if (!/^(generated|uploads)\//.test(textLayerKey)) return send(res, 400, { error: 'Falta la capa estática de títulos y subtítulos.' });
        const textLayerPath = await resolveAssetKey(textLayerKey);
        args.push('-loop', '1', '-framerate', '25', '-i', textLayerPath);
        layerInputIndex = assetPaths.length + audioPaths.length;
      }

      const filters = [];
      const visualLabels = [];
      const segment = segmentDuration.toFixed(6);
      for (let index = 0; index < assetPaths.length; index++) {
        filters.push(
          `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,` +
          `trim=start=0:duration=${segment},setpts=PTS-STARTPTS,format=yuv420p[assetv${index}]`
        );
        visualLabels.push(`[assetv${index}]`);
      }
      filters.push(`${visualLabels.join('')}concat=n=${visualLabels.length}:v=1:a=0[visual]`);

      if (audioPaths.length > 1) {
        const voiceLabels = [];
        for (let index = 0; index < audioPaths.length; index++) {
          const label = `voicepart${index}`;
          filters.push(`[${firstAudioInput + index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[${label}]`);
          voiceLabels.push(`[${label}]`);
        }
        filters.push(`${voiceLabels.join('')}concat=n=${audioPaths.length}:v=0:a=1[voice]`);
      } else {
        filters.push(`[${firstAudioInput}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[voice]`);
      }

      let audioLabel = 'voice';
      if (!muteOriginal) {
        const originalLabels = [];
        for (let index = 0; index < assetPaths.length; index++) {
          const label = `original${index}`;
          originalLabels.push(`[${label}]`);
          if (hasOriginalAudio[index]) {
            filters.push(
              `[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
              `atrim=start=0:duration=${segment},asetpts=PTS-STARTPTS[${label}]`
            );
          } else {
            filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${segment},asetpts=PTS-STARTPTS[${label}]`);
          }
        }
        filters.push(`${originalLabels.join('')}concat=n=${originalLabels.length}:v=0:a=1[originalaudio]`);
        filters.push('[voice][originalaudio]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[mixedaudio]');
        audioLabel = 'mixedaudio';
      }

      filters.push(
        `[${layerInputIndex}:v:0]scale=${width}:${height},format=rgba,trim=start=0:duration=${exactDuration.toFixed(6)},` +
        'setpts=PTS-STARTPTS[layer]'
      );
      filters.push('[visual][layer]overlay=0:0:shortest=1:format=auto,format=yuv420p[vout]');
      args.push(
        '-filter_complex', filters.join(';'),
        '-map', '[vout]', '-map', `[${audioLabel}]`,
        '-t', exactDuration.toFixed(6), '-r', '25',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', outPath
      );
      await runFfmpeg(ffmpegExecutable, args);
      const videoKey = `video/${name}`;
      await updateJson('asset-metadata.json', {}, (metadata) => {
        metadata[videoKey] = {
          type: 'video', modelId: 'ffmpeg', modelName: 'Automatizador · Assets', ts: Date.now(),
          category: `Auto: ${project.name}`.slice(0, 80), automationId: projectId, blockId: block.id,
          sourceAssetKeys: assetKeys, assetMuteOriginal: muteOriginal, segmentDuration,
          motionOverlayKey: motionOverlay?.key || null, width, height, duration: exactDuration, cost: 0
        };
        return metadata;
      });
      return send(res, 200, {
        videoKey, motionOverlayKey: motionOverlay?.key || '', assetKeys,
        assetMuteOriginal: muteOriginal, segmentDuration, duration: exactDuration
      });
    }

    // Muxea el video de un bloque: imagen fija + audio(s) en secuencia. Con texto
    // dinámico activo, Remotion entrega una capa transparente sincronizada que
    // FFmpeg compone sobre la imagen limpia.
    const automationVideoMatch = /^\/api\/automations\/([a-z0-9]+)\/video$/.exec(p);
    if (automationVideoMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const projectId = automationVideoMatch[1];
      const projects = await readJson('automations.json', []);
      const project = projects.find((item) => item.id === projectId);
      if (!project) return send(res, 404, { error: 'Proyecto no encontrado.' });
      const block = project.blocks?.find((item) => item.id === String(body.blockId || ''));
      if (!block) return send(res, 404, { error: 'Bloque no encontrado.' });
      const cfg = await getConfig();
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const imageKey = String(body.imageKey || '');
      const audioKeys = (Array.isArray(body.audioKeys) ? body.audioKeys : []).map(String).filter((k) => /^audio\//.test(k));
      if (!/^(generated|uploads)\//.test(imageKey)) return send(res, 400, { error: 'Falta la imagen del bloque.' });
      if (!audioKeys.length) return send(res, 400, { error: 'Falta el audio del bloque.' });
      const imgPath = await resolveAssetKey(imageKey);
      const audioPaths = [];
      for (const k of audioKeys) audioPaths.push(await resolveAssetKey(k));
      const audioDurations = await Promise.all(audioPaths.map((audioPath) => probeMediaDuration(ffmpegExecutable, audioPath)));
      const exactDuration = audioDurations.every((duration) => Number.isFinite(duration) && duration > 0)
        ? audioDurations.reduce((sum, duration) => sum + duration, 0)
        : null;
      const name = `${ts()}-auto-${newId()}.mp4`;
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, name);
      const detectedDimensions = await probeVideoDimensions(ffmpegExecutable, imgPath);
      const fallbackDimensions = automationVideoDimensions(project.config?.aspectRatio);
      const width = detectedDimensions?.width || fallbackDimensions.width;
      const height = detectedDimensions?.height || fallbackDimensions.height;
      const motionOverlay = await renderAutomationMotionOverlay({
        project,
        block,
        audioKeys,
        audioPaths,
        ffmpegExecutable,
        width,
        height,
        outDir,
        textHints: (block.items || []).map((item) => item.text)
      });
      const args = ['-y', '-loop', '1', '-i', imgPath];
      for (const a of audioPaths) args.push('-i', a);
      if (motionOverlay) args.push('-c:v', 'libvpx', '-i', motionOverlay.path);
      if (motionOverlay) {
        const filters = [];
        let audioMap = '1:a';
        if (audioPaths.length > 1) {
          const inputs = audioPaths.map((_, i) => `[${i + 1}:a]`).join('');
          filters.push(`${inputs}concat=n=${audioPaths.length}:v=0:a=1[a]`);
          audioMap = '[a]';
        }
        const overlayInputIndex = audioPaths.length + 1;
        filters.push(
          `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=25[base]`,
          `[${overlayInputIndex}:v]scale=${width}:${height},format=rgba,setpts=PTS-STARTPTS[motion]`,
          '[base][motion]overlay=0:0:shortest=1:format=auto,format=yuv420p[v]'
        );
        args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', audioMap);
      } else if (audioPaths.length > 1) {
        const inputs = audioPaths.map((_, i) => `[${i + 1}:a]`).join('');
        args.push('-filter_complex', `${inputs}concat=n=${audioPaths.length}:v=0:a=1[a]`, '-map', '0:v', '-map', '[a]');
      } else {
        args.push('-map', '0:v', '-map', '1:a');
      }
      // dimensiones pares (requisito de yuv420p) y cierre al terminar el audio
      args.push('-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
        ...(motionOverlay ? [] : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']), '-r', '25',
        '-c:a', 'aac', '-b:a', '192k');
      // -shortest por sí solo puede conservar varios segundos de fotogramas en
      // cola cuando la imagen fija tarda más en codificarse que el audio en
      // demuxearse. El límite explícito garantiza que el MP4 mida exactamente
      // la suma de los audios, incluso en regeneraciones con imágenes pesadas.
      if (exactDuration) args.push('-t', exactDuration.toFixed(3));
      args.push('-shortest', outPath);
      await runFfmpeg(ffmpegExecutable, args);
      const key = `video/${name}`;
      const category = String(body.category || '').slice(0, 80);
      await updateJson('asset-metadata.json', {}, (m) => {
        m[key] = { type: 'video', modelId: 'ffmpeg', modelName: 'Automatizador', ts: Date.now(), category, automationId: projectId, blockId: block.id, motionOverlayKey: motionOverlay?.key || null };
        return m;
      });
      return send(res, 200, { videoKey: key, motionOverlayKey: motionOverlay?.key || '' });
    }

    // Ensambla los MP4 terminados de todos los bloques, respetando exactamente
    // el orden del guion. No vuelve a generar imágenes ni audios. Se normalizan
    // tamaño, fps y audio para tolerar bloques creados con modelos distintos.
    const automationAssembleMatch = /^\/api\/automations\/([a-z0-9]+)\/assemble$/.exec(p);
    if (automationAssembleMatch && req.method === 'POST') {
      const projectId = automationAssembleMatch[1];
      const projects = await readJson('automations.json', []);
      const project = projects.find((item) => item.id === projectId);
      if (!project) return send(res, 404, { error: 'Proyecto no encontrado.' });
      if (!project.blocks?.length) return send(res, 400, { error: 'El proyecto no tiene bloques para ensamblar.' });

      const missingBlocks = project.blocks.filter((block) => !project.outputs?.[block.id]?.videoKey);
      if (missingBlocks.length) {
        const names = missingBlocks.slice(0, 8).map((block) => block.title || block.id).join(', ');
        const extra = missingBlocks.length > 8 ? ` y ${missingBlocks.length - 8} más` : '';
        return send(res, 400, { error: `Faltan videos terminados: ${names}${extra}.` });
      }

      const videoPaths = [];
      for (const block of project.blocks) {
        const key = String(project.outputs[block.id].videoKey || '');
        if (!/^video\//.test(key)) return send(res, 400, { error: `El video de “${block.title || block.id}” no es válido.` });
        const filePath = await resolveAssetKey(key);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) return send(res, 400, { error: `No encuentro el video de “${block.title || block.id}”. Regenerá ese bloque.` });
        videoPaths.push(filePath);
      }

      const cfg = await getConfig();
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const detectedDimensions = await dominantVideoDimensions(ffmpegExecutable, videoPaths);
      const { width, height } = detectedDimensions || automationVideoDimensions(project.config?.aspectRatio);
      const name = `${ts()}-final-${sanitizeName(project.name)}-${newId()}.mp4`;
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, name);
      const args = ['-y'];
      for (const videoPath of videoPaths) args.push('-i', videoPath);

      const includeLogos = project.config?.includeLogos === true;
      const logo = includeLogos ? automationLogoForDimensions(width, height) : null;
      let logoDuration = 0;
      if (logo) {
        const logoStat = await fs.stat(logo.filePath).catch(() => null);
        if (!logoStat?.isFile()) {
          return send(res, 500, { error: `No encuentro el logo ${logo.variant} incluido con Manifestador.` });
        }
        logoDuration = await probeMediaDuration(ffmpegExecutable, logo.filePath) || 0;
      }

      const music = normalizeAutomationMusic(project.config?.music, project.requirements?.music);
      const transitionSound = normalizeAutomationTransitionSound(project.config?.transitionSound);
      let musicKey = '';
      let musicPath = '';
      let selectedTransitionSound = null;
      let transitionSoundPath = '';
      let transitionSoundDuration = 0;
      let finalDuration = null;
      let blockDurations = null;
      let appliedFadeOutSeconds = 0;
      let automaticMusic = null;
      if (music.enabled) {
        if (music.source === 'auto') {
          automaticMusic = await findAutomaticMusicTrack(music);
          if (!automaticMusic) return send(res, 400, { error: 'La música está en automático, pero no hay pistas clasificadas como Música en Assets.' });
          musicKey = automaticMusic.key;
        } else {
          musicKey = music.assetKey;
        }
        if (!/^audio\//.test(musicKey)) return send(res, 400, { error: 'Elegí, subí o generá una música antes del ensamble.' });
        musicPath = await resolveAssetKey(musicKey);
        const musicStat = await fs.stat(musicPath).catch(() => null);
        if (!musicStat?.isFile()) return send(res, 400, { error: 'No encuentro la música elegida. Seleccioná otra pista.' });
        // La entrada se repite indefinidamente; amix la corta cuando termina la
        // narración concatenada, de modo que nunca alarga el video final.
        args.push('-stream_loop', '-1', '-i', musicPath);
      }

      if (transitionSound.enabled && videoPaths.length > 1) {
        const transitionSounds = await listTransitionSounds();
        selectedTransitionSound = transitionSounds.find((sound) => sound.id === transitionSound.soundId) || null;
        if (!selectedTransitionSound) {
          return send(res, 400, { error: 'El sonido de transición elegido ya no está disponible. Elegí otro en el panel Automatizar.' });
        }
        transitionSoundPath = selectedTransitionSound.filePath;
        const soundStat = await fs.stat(transitionSoundPath).catch(() => null);
        if (!soundStat?.isFile()) return send(res, 400, { error: 'No encuentro el sonido de transición elegido.' });
        transitionSoundDuration = await probeMediaDuration(ffmpegExecutable, transitionSoundPath) || 0;
        if (!transitionSoundDuration) {
          return send(res, 400, { error: 'No pude leer la duración del sonido de transición. Verificá el archivo de audio.' });
        }
        args.push('-i', transitionSoundPath);
      }

      if (includeLogos || transitionSoundPath || musicPath) {
        blockDurations = await Promise.all(videoPaths.map((videoPath) => probeMediaDuration(ffmpegExecutable, videoPath)));
        if (blockDurations.some((duration) => !duration)) {
          return send(res, 400, { error: 'No pude calcular la duración de los bloques para preparar el ensamble. Verificá que ffprobe esté junto a ffmpeg.' });
        }
        finalDuration = blockDurations.reduce((sum, duration) => sum + duration, 0);
        if (musicPath && music.fadeOut) appliedFadeOutSeconds = Math.min(music.fadeOutSeconds, finalDuration);
      }

      const transitionInputIndex = transitionSoundPath ? videoPaths.length + (musicPath ? 1 : 0) : -1;
      const logoInputIndex = logo ? videoPaths.length + (musicPath ? 1 : 0) + (transitionSoundPath ? 1 : 0) : -1;
      if (logo) args.push('-i', logo.filePath);

      const filters = [];
      for (let index = 0; index < videoPaths.length; index++) {
        filters.push(
          `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,` +
          `format=yuv420p,setpts=PTS-STARTPTS[v${index}]`
        );
        filters.push(
          `[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
          `asetpts=PTS-STARTPTS[a${index}]`
        );
      }
      const concatInputs = videoPaths.map((_, index) => `[v${index}][a${index}]`).join('');
      filters.push(`${concatInputs}concat=n=${videoPaths.length}:v=1:a=1[vout][voiceout]`);
      let contentAudioLabel = 'voiceout';
      let transitionCount = 0;
      if (transitionSoundPath && blockDurations) {
        transitionCount = videoPaths.length - 1;
        const sourceLabels = Array.from({ length: transitionCount }, (_, index) => `[transitionSource${index}]`).join('');
        const normalizedSource = `[${transitionInputIndex}:a:0]aresample=48000,` +
          'aformat=sample_fmts=fltp:channel_layouts=stereo';
        if (transitionCount > 1) {
          filters.push(`${normalizedSource},asplit=${transitionCount}${sourceLabels}`);
        } else {
          filters.push(`${normalizedSource}[transitionSource0]`);
        }
        let boundary = 0;
        const transitionLabels = [];
        for (let index = 0; index < transitionCount; index++) {
          boundary += blockDurations[index];
          // Centra el golpe sobre cada corte interno. El pequeño margen impide
          // que un bloque excepcionalmente corto lleve sonido desde el fotograma inicial.
          const startAt = Math.max(0.05, boundary - (transitionSoundDuration / 2));
          const delayMs = Math.round(startAt * 1000);
          const label = `transition${index}`;
          transitionLabels.push(`[${label}]`);
          filters.push(
            `[transitionSource${index}]atrim=start=0:end=${transitionSoundDuration.toFixed(3)},` +
            `asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[${label}]`
          );
        }
        filters.push(
          `[voiceout]${transitionLabels.join('')}amix=inputs=${transitionCount + 1}:` +
          'duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[voicefx]'
        );
        contentAudioLabel = 'voicefx';
      }
      if (musicPath) {
        const musicInputIndex = videoPaths.length;
        const gainDb = Math.max(-60, Math.min(0, music.gainDb));
        // La entrada musical usa -stream_loop -1. Siempre hay que acotarla a la
        // duración del contenido, aunque el fade esté desactivado; de lo contrario
        // FFmpeg puede finalizar el MP4 pero quedar esperando la fuente infinita.
        const trimFilter = finalDuration
          ? `,atrim=end=${finalDuration.toFixed(3)},asetpts=PTS-STARTPTS`
          : '';
        const fadeFilter = appliedFadeOutSeconds > 0
          ? `,afade=t=out:st=${Math.max(0, finalDuration - appliedFadeOutSeconds).toFixed(3)}:d=${appliedFadeOutSeconds.toFixed(3)}`
          : '';
        filters.push(`[${musicInputIndex}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${gainDb.toFixed(2)}dB${trimFilter}${fadeFilter}[music]`);
        filters.push(`[${contentAudioLabel}][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`);
      } else {
        filters.push(`[${contentAudioLabel}]anull[aout]`);
      }

      let finalVideoLabel = 'vout';
      let finalAudioLabel = 'aout';
      let fadeToBlackSeconds = 0;
      if (logo) {
        fadeToBlackSeconds = Math.min(AUTOMATION_LOGO_FADE_SECONDS, finalDuration || AUTOMATION_LOGO_FADE_SECONDS);
        const fadeStart = Math.max(0, (finalDuration || fadeToBlackSeconds) - fadeToBlackSeconds);
        filters.push(`[vout]fade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeToBlackSeconds.toFixed(3)}[vcontent]`);
        // El logo ocupa todo el lienzo. En 1:1 se usa el horizontal y se recorta
        // el excedente lateral para conservar su escala, en vez de reducirlo.
        filters.push(
          `[${logoInputIndex}:v:0]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
          `crop=${width}:${height},setsar=1,fps=25,format=yuv420p,setpts=PTS-STARTPTS[vlogo]`
        );
        filters.push(
          `[${logoInputIndex}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
          `asetpts=PTS-STARTPTS[alogo]`
        );
        // La mezcla de voz y música termina con el contenido. El logo se concatena
        // después con su pista original, por lo que la música nunca lo invade.
        filters.push('[vcontent][aout][vlogo][alogo]concat=n=2:v=1:a=1[vfinal][afinal]');
        finalVideoLabel = 'vfinal';
        finalAudioLabel = 'afinal';
      }
      args.push(
        '-filter_complex', filters.join(';'),
        '-map', `[${finalVideoLabel}]`, '-map', `[${finalAudioLabel}]`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest',
        outPath
      );
      if (automationAssemblyJobs.has(projectId)) {
        return send(res, 409, { error: 'Este proyecto ya tiene un ensamble en curso. Esperá a que termine antes de iniciarlo otra vez.' });
      }
      automationAssemblyJobs.add(projectId);
      try {
        await runFfmpeg(ffmpegExecutable, args);
      } finally {
        automationAssemblyJobs.delete(projectId);
      }

      const key = `video/${name}`;
      const assembledAt = Date.now();
      await updateJson('asset-metadata.json', {}, (metadata) => {
        metadata[key] = {
          type: 'video',
          modelId: 'ffmpeg',
          modelName: 'Ensamble final',
          ts: assembledAt,
          category: `Auto: ${project.name}`,
          automationId: project.id,
          autoKind: 'final-assembly',
          blockCount: project.blocks.length,
          aspectRatio: project.config?.aspectRatio || null,
          width,
          height,
          dimensionsSource: detectedDimensions ? 'block-videos' : 'project-aspect-ratio',
          includeLogos,
          logoVariant: logo?.variant || null,
          logoDuration: logoDuration || null,
          fadeToBlackSeconds: logo ? fadeToBlackSeconds : 0,
          musicKey: musicKey || null,
          musicGainDb: musicKey ? music.gainDb : null,
          musicFadeOutSeconds: musicKey && music.fadeOut ? appliedFadeOutSeconds : 0,
          transitionSoundId: selectedTransitionSound?.id || null,
          transitionSoundName: selectedTransitionSound?.name || null,
          transitionSoundCategory: selectedTransitionSound?.category || null,
          transitionCount
        };
        return metadata;
      });

      let updatedProject = null;
      await updateJson('automations.json', [], (all) => {
        const index = all.findIndex((item) => item.id === projectId);
        if (index === -1) return all;
        const finalOutput = {
          videoKey: key,
          assembledAt,
          blockCount: project.blocks.length,
          width,
          height,
          includeLogos,
          logoVariant: logo?.variant || null,
          logoDuration: logoDuration || null,
          fadeToBlackSeconds: logo ? fadeToBlackSeconds : 0,
          musicKey: musicKey || null,
          musicGainDb: musicKey ? music.gainDb : null,
          musicFadeOutSeconds: musicKey && music.fadeOut ? appliedFadeOutSeconds : 0,
          transitionSoundId: selectedTransitionSound?.id || null,
          transitionSoundName: selectedTransitionSound?.name || null,
          transitionSoundCategory: selectedTransitionSound?.category || null,
          transitionCount
        };
        all[index] = {
          ...all[index],
          config: {
            ...all[index].config,
            includeLogos,
            transitionSound: normalizeAutomationTransitionSound(transitionSound),
            music: normalizeAutomationMusic({ ...music, assetKey: musicKey || music.assetKey }, all[index].requirements?.music),
            overlay: normalizeAutomationOverlay(all[index].config?.overlay)
          },
          finalOutput,
          effectOutput: null,
          updatedAt: assembledAt
        };
        updatedProject = all[index];
        return all;
      });
      if (!updatedProject) return send(res, 404, { error: 'El proyecto fue eliminado durante el ensamble.' });
      return send(res, 200, { project: updatedProject, finalOutput: updatedProject.finalOutput });
    }

    // Regenera exclusivamente la capa animada de títulos/subtítulos de un
    // bloque. Reutiliza los audios existentes y no llama a ningún proveedor.
    const automationTextLayerMatch = /^\/api\/automations\/([a-z0-9]+)\/text-layer$/.exec(p);
    if (automationTextLayerMatch && req.method === 'POST') {
      const projectId = automationTextLayerMatch[1];
      const body = await readJsonBody(req);
      const projects = await readJson('automations.json', []);
      const project = projects.find((item) => item.id === projectId);
      if (!project) return send(res, 404, { error: 'Proyecto no encontrado.' });
      if (!normalizeAutomationDynamicText(project.config?.dynamicText).enabled) {
        return send(res, 400, { error: 'Este proyecto no tiene texto dinámico activo.' });
      }
      const block = (project.blocks || []).find((item) => item.id === String(body.blockId || ''));
      if (!block) return send(res, 404, { error: 'Bloque no encontrado.' });
      const output = project.outputs?.[block.id] || {};
      const audioKeys = (Array.isArray(output.audioKeys) ? output.audioKeys : [])
        .map(String).filter((key) => /^audio\//.test(key));
      if (!audioKeys.length) return send(res, 400, { error: `Faltan los audios existentes de “${block.title || block.id}”.` });
      const cfg = await getConfig();
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const audioPaths = await Promise.all(audioKeys.map((key) => resolveAssetKey(key)));
      const fallbackDimensions = automationVideoDimensions(project.config?.aspectRatio);
      let detectedDimensions = null;
      if (/^video\//.test(String(output.videoKey || ''))) {
        const blockVideoPath = await resolveAssetKey(output.videoKey).catch(() => null);
        if (blockVideoPath) detectedDimensions = await probeVideoDimensions(ffmpegExecutable, blockVideoPath);
      }
      const width = Number(project.finalOutput?.width) || detectedDimensions?.width || fallbackDimensions.width;
      const height = Number(project.finalOutput?.height) || detectedDimensions?.height || fallbackDimensions.height;
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const rendered = await renderAutomationMotionOverlay({
        project,
        block,
        audioKeys,
        audioPaths,
        ffmpegExecutable,
        width,
        height,
        outDir,
        textHints: (block.items || []).map((item) => item.text)
      });
      if (!rendered?.key) return send(res, 500, { error: 'Remotion no devolvió la nueva capa de texto.' });
      let updatedProject = null;
      await updateJson('automations.json', [], (all) => all.map((item) => {
        if (item.id !== projectId) return item;
        updatedProject = {
          ...item,
          outputs: {
            ...(item.outputs || {}),
            [block.id]: {
              ...(item.outputs?.[block.id] || {}),
              motionOverlayKey: rendered.key,
              textRefreshedAt: Date.now()
            }
          },
          updatedAt: Date.now()
        };
        return updatedProject;
      }));
      return send(res, 200, { project: automationForClient(updatedProject), motionOverlayKey: rendered.key });
    }

    // Posproducción opcional: reconstruye cada toma desde su imagen limpia o los
    // segmentos originales de HeyGen, aplica efecto y máscara, y recién después
    // agrega la capa PNG de texto. Reutiliza el audio del MP4 final, no llama
    // modelos y mantiene disponible el master anterior.
    const automationEffectMatch = /^\/api\/automations\/([a-z0-9]+)\/effect$/.exec(p);
    if (automationEffectMatch && req.method === 'POST') {
      const projectId = automationEffectMatch[1];
      const projects = await readJson('automations.json', []);
      const project = projects.find((item) => item.id === projectId);
      if (!project) return send(res, 404, { error: 'Proyecto no encontrado.' });
      if (!project.finalOutput?.videoKey) {
        return send(res, 400, { error: 'Primero ensamblá el video final limpio.' });
      }

      const body = await readJsonBody(req);
      const textRefreshTarget = ['final', 'effect'].includes(body.textRefreshTarget)
        ? body.textRefreshTarget
        : '';
      const isTextRefresh = Boolean(textRefreshTarget);
      const textLayersRefreshed = isTextRefresh || body.textLayersRefreshed === true;
      if (textRefreshTarget === 'effect' && !project.effectOutput?.videoKey) {
        return send(res, 400, { error: 'El proyecto todavía no tiene una versión con efectos para actualizar.' });
      }
      if (textRefreshTarget === 'final' && project.effectOutput?.videoKey) {
        return send(res, 400, { error: 'Ya existe una versión con efectos; la actualización de textos debe aplicarse solamente sobre esa versión.' });
      }
      const applyEffects = !isTextRefresh || textRefreshTarget === 'effect';
      const preservedEffect = textRefreshTarget === 'effect' ? {
        preset: project.effectOutput.preset,
        intensity: project.effectOutput.intensity,
        maskEnabled: project.effectOutput.maskEnabled,
        maskColor: project.effectOutput.maskColor,
        maskOpacity: project.effectOutput.maskOpacity
      } : null;
      const effect = normalizeAutomationVideoEffect({
        ...project.config?.videoEffect,
        ...(preservedEffect || body.videoEffect || body || {}),
        enabled: applyEffects
      });
      const sourceVideoKey = String(project.finalOutput.videoKey);
      if (!/^video\//.test(sourceVideoKey)) return send(res, 400, { error: 'El ensamble final no es un video válido.' });
      const sourcePath = await resolveAssetKey(sourceVideoKey);
      const sourceStat = await fs.stat(sourcePath).catch(() => null);
      if (!sourceStat?.isFile()) return send(res, 400, { error: 'No encuentro el ensamble final. Volvé a ensamblarlo.' });

      const cfg = await getConfig();
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
      const detectedDimensions = await probeVideoDimensions(ffmpegExecutable, sourcePath);
      const fallbackDimensions = automationVideoDimensions(project.config?.aspectRatio);
      const width = Number(project.finalOutput.width) || detectedDimensions?.width || fallbackDimensions.width;
      const height = Number(project.finalOutput.height) || detectedDimensions?.height || fallbackDimensions.height;
      const duration = await probeMediaDuration(ffmpegExecutable, sourcePath);
      if (!duration) return send(res, 400, { error: 'No pude leer la duración del ensamble. Verificá que ffprobe esté junto a ffmpeg.' });

      const blockSources = [];
      const dynamicTextEnabled = normalizeAutomationDynamicText(project.config?.dynamicText).enabled;
      for (const block of project.blocks || []) {
        const output = project.outputs?.[block.id] || {};
        const imageKey = String(output.imageKey || '');
        const textLayerKey = String(output.textLayerKey || '');
        const motionOverlayKey = String(output.motionOverlayKey || '');
        const blockVideoKey = String(output.videoKey || '');
        const isHeyGen = block.generator === 'heygen' || output.generator === 'heygen';
        const isH3 = block.generator === 'h3' || output.generator === 'h3';
        const isAssetBlock = block.generator === 'assets' || output.generator === 'assets';
        const selectedAssetKeys = normalizeAutomationAssetKeys(block.assetKeys);
        const heygenSegmentKeys = (Array.isArray(output.heygenSegmentVideoKeys) ? output.heygenSegmentVideoKeys : [])
          .map(String)
          .filter((key) => /^video\//.test(key));
        const h3SegmentKeys = (Array.isArray(output.h3SegmentVideoKeys) ? output.h3SegmentVideoKeys : [])
          .map(String)
          .filter((key) => /^video\//.test(key));
        const h3SegmentDurations = (Array.isArray(output.h3SegmentDurations) ? output.h3SegmentDurations : [])
          .map(Number)
          .filter((duration) => Number.isFinite(duration) && duration > 0);
        if (!isHeyGen && !isH3 && !isAssetBlock && !/^(generated|uploads)\//.test(imageKey)) {
          return send(res, 400, { error: `Falta la imagen limpia de “${block.title || block.id}”.` });
        }
        if (isHeyGen && !heygenSegmentKeys.length) {
          return send(res, 400, { error: `Faltan los planos originales de HeyGen de “${block.title || block.id}”. Regenerá esa toma una vez para recuperarlos.` });
        }
        if (isH3 && !h3SegmentKeys.length) {
          return send(res, 400, { error: `Faltan los tramos originales de MiniMax H3 de “${block.title || block.id}”. Regenerá esa toma una vez para recuperarlos.` });
        }
        if (isAssetBlock && !selectedAssetKeys.length) {
          return send(res, 400, { error: `Faltan los Assets seleccionados de “${block.title || block.id}”.` });
        }
        const layerKey = dynamicTextEnabled ? motionOverlayKey : textLayerKey;
        const layerIsVideo = dynamicTextEnabled;
        if (layerIsVideo ? !/^video\//.test(layerKey) : !/^(generated|uploads)\//.test(layerKey)) {
          return send(res, 400, { error: `Falta la capa ${layerIsVideo ? 'animada' : 'de subtítulos'} de “${block.title || block.id}”. Volvé a generar esa toma para prepararla.` });
        }
        if (!/^video\//.test(blockVideoKey)) {
          return send(res, 400, { error: `Falta el video terminado de “${block.title || block.id}”.` });
        }
        const visualKeys = isHeyGen ? heygenSegmentKeys : isH3 ? h3SegmentKeys : isAssetBlock ? selectedAssetKeys : [imageKey];
        const visualKinds = visualKeys.map((key) => key.startsWith('video/') ? 'video' : 'image');
        const [visualPaths, textLayerPath, blockVideoPath] = await Promise.all([
          Promise.all(visualKeys.map((key) => resolveAssetKey(key))),
          resolveAssetKey(layerKey),
          resolveAssetKey(blockVideoKey)
        ]);
        const stats = await Promise.all([
          ...visualPaths.map((visualPath) => fs.stat(visualPath).catch(() => null)),
          fs.stat(textLayerPath).catch(() => null),
          fs.stat(blockVideoPath).catch(() => null)
        ]);
        if (stats.some((stat) => !stat?.isFile())) {
          return send(res, 400, { error: `No encuentro todos los materiales locales de “${block.title || block.id}”.` });
        }
        blockSources.push({
          block,
          kind: isHeyGen ? 'heygen' : isH3 ? 'h3' : isAssetBlock ? 'assets' : 'image',
          visualPaths, visualKinds, textLayerPath, layerIsVideo, blockVideoPath,
          segmentDurations: isH3 ? h3SegmentDurations : []
        });
      }
      if (!blockSources.length) return send(res, 400, { error: 'El proyecto no tiene tomas para procesar.' });

      const blockDurations = await Promise.all(
        blockSources.map((source) => probeMediaDuration(ffmpegExecutable, source.blockVideoPath))
      );
      if (blockDurations.some((blockDuration) => !blockDuration)) {
        return send(res, 400, { error: 'No pude calcular la duración de todas las tomas. Verificá que ffprobe esté junto a ffmpeg.' });
      }
      const contentDuration = blockDurations.reduce((sum, blockDuration) => sum + blockDuration, 0);
      const effectFilters = applyEffects ? automationVideoEffectFilters(effect, width, height) : 'format=yuv420p';
      const maskFilter = applyEffects ? automationVideoMaskFilter(effect) : '';
      const name = isTextRefresh
        ? `${ts()}-textos-${textRefreshTarget}-${sanitizeName(project.name)}-${newId()}.mp4`
        : `${ts()}-efecto-${effect.preset}-${sanitizeName(project.name)}-${newId()}.mp4`;
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, name);
      const args = ['-y', '-i', sourcePath];
      let nextInputIndex = 1;
      for (const source of blockSources) {
        source.visualInputIndexes = [];
        for (const [visualIndex, visualPath] of source.visualPaths.entries()) {
          if (source.visualKinds[visualIndex] === 'image') args.push('-loop', '1', '-framerate', '25');
          else if (source.kind === 'assets') args.push('-stream_loop', '-1');
          args.push('-i', visualPath);
          source.visualInputIndexes.push(nextInputIndex++);
        }
        if (!source.layerIsVideo) args.push('-loop', '1', '-framerate', '25');
        else args.push('-c:v', 'libvpx');
        args.push('-i', source.textLayerPath);
        source.layerInputIndex = nextInputIndex++;
      }
      const filters = [
        `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,format=yuv420p[base]`
      ];
      const shotLabels = [];
      for (let index = 0; index < blockSources.length; index++) {
        const source = blockSources[index];
        const layerInputIndex = source.layerInputIndex;
        const blockDuration = blockDurations[index].toFixed(3);
        if (source.kind === 'image') {
          filters.push(
            `[${source.visualInputIndexes[0]}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
            `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,` +
            `${effectFilters}${maskFilter},trim=start=0:end=${blockDuration},setpts=PTS-STARTPTS[effectbg${index}]`
          );
        } else if (source.kind === 'assets') {
          const assetSegmentDuration = Number(blockDuration) / source.visualInputIndexes.length;
          const assetLabels = [];
          for (const [assetIndex, inputIndex] of source.visualInputIndexes.entries()) {
            const label = `assetfx${index}_${assetIndex}`;
            filters.push(
              `[${inputIndex}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
              `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,` +
              `${effectFilters}${maskFilter},trim=start=0:duration=${assetSegmentDuration.toFixed(6)},` +
              `setpts=PTS-STARTPTS[${label}]`
            );
            assetLabels.push(`[${label}]`);
          }
          filters.push(`${assetLabels.join('')}concat=n=${assetLabels.length}:v=1:a=0[effectbg${index}]`);
        } else {
          const segmentLabels = [];
          for (const [segmentIndex, inputIndex] of source.visualInputIndexes.entries()) {
            const label = `heygen${index}_${segmentIndex}`;
            const h3Trim = source.kind === 'h3' && Number(source.segmentDurations?.[segmentIndex]) > 0
              ? `trim=start=0:duration=${Number(source.segmentDurations[segmentIndex]).toFixed(6)},`
              : '';
            filters.push(
              `[${inputIndex}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
              `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,` +
              `format=yuv420p,${h3Trim}setpts=PTS-STARTPTS[${label}]`
            );
            segmentLabels.push(`[${label}]`);
          }
          const visualLabel = `heygenbase${index}`;
          if (segmentLabels.length === 1) {
            filters.push(`${segmentLabels[0]}null[${visualLabel}]`);
          } else {
            filters.push(`${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=1:a=0[${visualLabel}]`);
          }
          filters.push(
            `[${visualLabel}]${effectFilters}${maskFilter},trim=start=0:end=${blockDuration},` +
            `setpts=PTS-STARTPTS[effectbg${index}]`
          );
        }
        filters.push(
          `[${layerInputIndex}:v:0]format=rgba,scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,` +
          `${source.layerIsVideo ? 'fps=25,' : ''}trim=start=0:end=${blockDuration},setpts=PTS-STARTPTS,format=rgba[textlayer${index}]`
        );
        filters.push(
          `[effectbg${index}][textlayer${index}]overlay=x=0:y=0:shortest=1:format=auto,` +
          `format=yuv420p,setpts=PTS-STARTPTS[shot${index}]`
        );
        shotLabels.push(`[shot${index}]`);
      }
      const fadeToBlackSeconds = project.finalOutput.includeLogos
        ? Math.max(0, Math.min(contentDuration, Number(project.finalOutput.fadeToBlackSeconds) || AUTOMATION_LOGO_FADE_SECONDS))
        : 0;
      const finalContentFilter = fadeToBlackSeconds > 0
        ? `fade=t=out:st=${Math.max(0, contentDuration - fadeToBlackSeconds).toFixed(3)}:d=${fadeToBlackSeconds.toFixed(3)},`
        : '';
      filters.push(
        `${shotLabels.join('')}concat=n=${shotLabels.length}:v=1:a=0,fps=25,` +
        `${finalContentFilter}format=yuv420p[effectcontent]`
      );
      // El ensamble anterior se usa como lienzo temporal y fuente de audio. El
      // contenido reconstruido lo cubre por completo; al terminar, eof_action=pass
      // deja visible el logo original (si existe), sin efectos ni subtítulos.
      filters.push('[base][effectcontent]overlay=x=0:y=0:eof_action=pass:shortest=0:format=auto,format=yuv420p[vout]');
      args.push(
        '-filter_complex', filters.join(';'),
        '-map', '[vout]', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart',
        outPath
      );
      if (automationAssemblyJobs.has(projectId)) {
        return send(res, 409, { error: 'Este proyecto ya tiene una posproducción en curso. Esperá a que termine.' });
      }
      automationAssemblyJobs.add(projectId);
      try {
        await runFfmpeg(ffmpegExecutable, args);
      } finally {
        automationAssemblyJobs.delete(projectId);
      }

      const videoKey = `video/${name}`;
      const processedAt = Date.now();
      const presetName = AUTOMATION_VIDEO_EFFECTS[effect.preset].name;
      await updateJson('asset-metadata.json', {}, (metadata) => {
        metadata[videoKey] = {
          type: 'video',
          modelId: 'ffmpeg',
          modelName: isTextRefresh ? 'Textos actualizados · FFmpeg' : 'Posproducción FFmpeg',
          ts: processedAt,
          category: `Auto: ${project.name}`,
          automationId: project.id,
          autoKind: isTextRefresh ? `text-refresh-${textRefreshTarget}` : 'post-effect',
          sourceVideoKey,
          effectPreset: applyEffects ? effect.preset : null,
          effectName: applyEffects ? presetName : null,
          effectIntensity: applyEffects ? effect.intensity : null,
          maskEnabled: applyEffects ? effect.maskEnabled : false,
          maskColor: applyEffects ? effect.maskColor : null,
          maskOpacity: applyEffects ? effect.maskOpacity : 0,
          width,
          height,
          subtitleLayerCount: blockSources.length,
          subtitlesPreserved: true,
          textsRefreshed: textLayersRefreshed,
          textRefreshTarget: textRefreshTarget || null,
          logoPreserved: project.finalOutput.includeLogos === true,
          cost: 0
        };
        return metadata;
      });

      let updatedProject = null;
      await updateJson('automations.json', [], (all) => all.map((item) => {
        if (item.id !== projectId) return item;
        const baseProject = {
          ...item,
          config: {
            ...item.config,
            videoEffect: isTextRefresh ? item.config?.videoEffect : effect,
            dynamicText: normalizeAutomationDynamicText(item.config?.dynamicText),
            transitionSound: normalizeAutomationTransitionSound(item.config?.transitionSound),
            music: normalizeAutomationMusic(item.config?.music, item.requirements?.music),
            overlay: normalizeAutomationOverlay(item.config?.overlay),
            titleOverlay: normalizeAutomationTitleOverlay(item.config?.titleOverlay, item.blocks, item.integration?.scriptTitle || item.name)
          },
          textRefreshRequiredAt: textLayersRefreshed ? null : item.textRefreshRequiredAt,
          updatedAt: processedAt
        };
        const nextEffectOutput = {
          ...(isTextRefresh ? item.effectOutput : {}),
          videoKey,
          sourceVideoKey,
          processedAt,
          preset: effect.preset,
          presetName,
          intensity: effect.intensity,
          maskEnabled: effect.maskEnabled,
          maskColor: effect.maskColor,
          maskOpacity: effect.maskOpacity,
          width,
          height,
          subtitleLayerCount: blockSources.length,
          subtitlesPreserved: true,
          textsRefreshed: textLayersRefreshed,
          textRefreshedAt: textLayersRefreshed ? processedAt : null,
          logoPreserved: project.finalOutput.includeLogos === true
        };
        if (textRefreshTarget === 'final') {
          updatedProject = {
            ...baseProject,
            finalOutput: {
              ...item.finalOutput,
              videoKey,
              assembledAt: processedAt,
              textsRefreshed: true,
              textRefreshedAt: processedAt
            },
            effectOutput: null
          };
        } else {
          updatedProject = {
            ...baseProject,
            effectOutput: nextEffectOutput
          };
        }
        return updatedProject;
      }));
      if (!updatedProject) return send(res, 404, { error: 'El proyecto fue eliminado durante la posproducción.' });
      return send(res, 200, {
        project: updatedProject,
        finalOutput: updatedProject.finalOutput,
        effectOutput: updatedProject.effectOutput,
        textRefreshTarget: textRefreshTarget || null
      });
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
          automationName: body.automationName !== undefined ? String(body.automationName).slice(0, 120) : m[k]?.automationName,
          generatedByAutomation: body.automationId !== undefined ? true : m[k]?.generatedByAutomation,
          blockId: body.blockId !== undefined ? String(body.blockId) : m[k]?.blockId,
          autoKind: body.autoKind !== undefined ? String(body.autoKind) : m[k]?.autoKind
        };
        return m;
      });
      return send(res, 200, { ok: true });
    }

    if (p === '/api/assets/audio-metadata' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const key = String(body.key || '');
      if (!/^audio\//.test(key)) throw new Error('Ese asset no es un audio.');
      await fs.access(await resolveAssetKey(key));
      const audioKind = sanitizeAudioKind(body.audioKind);
      const musicTags = audioKind === 'music' ? normalizeMusicTags(body.musicTags) : normalizeMusicTags();
      let updated;
      await updateJson('asset-metadata.json', {}, (all) => {
        updated = {
          ...(all[key] || { type: 'audio', modelId: 'unknown', modelName: 'Audio', ts: Date.now(), cost: 0 }),
          audioKind,
          musicTags
        };
        all[key] = updated;
        return all;
      });
      return send(res, 200, { key, ...updated });
    }

    if (p === '/api/assets/visual-metadata' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const keys = [...new Set((Array.isArray(body.keys) ? body.keys : [body.key]).map(String)
        .filter((key) => /^(generated|uploads|video)\//.test(key)))].slice(0, 5000);
      if (!keys.length) throw new Error('Elegí al menos una imagen o video para clasificar.');
      for (const key of keys) await fs.access(await resolveAssetKey(key));
      const category = sanitizeVisualCategory(body.category);
      const tags = normalizeVisualTags(body.tags);
      const updated = {};
      await updateJson('asset-metadata.json', {}, (all) => {
        for (const key of keys) {
          const previous = all[key] || {};
          updated[key] = {
            ...previous,
            type: key.startsWith('video/') ? 'video' : (previous.type || 'image'),
            category,
            tags,
            metadataUpdatedAt: Date.now()
          };
          all[key] = updated[key];
        }
        return all;
      });
      return send(res, 200, { keys, metadata: updated });
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

    if (p === '/api/generate/video/h3-regenerate-2k' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const history = await readJson('history.json', []);
      const source = history.find((entry) => entry.id === String(body.historyId || ''));
      if (!source || source.modelId !== 'minimax-h3') return send(res, 404, { error: 'No encuentro la generación MiniMax H3 original.' });
      if (source.resolution !== '768P') return send(res, 400, { error: 'Sólo se pueden promover a 2K los videos H3 generados en 768P.' });
      const sourceKey = source.outputs?.[0];
      if (!/^video\//.test(String(sourceKey || ''))) return send(res, 400, { error: 'Falta el MP4 768P original.' });
      const refs = Array.isArray(source.refs) ? source.refs : [];
      const refKinds = Array.isArray(source.refKinds) ? source.refKinds : [];
      const mediaRefs = [];
      for (const [index, key] of refs.entries()) {
        if (/^asset:\/\//.test(key)) return send(res, 400, { error: 'La regeneración 2K no admite referencias remotas de ModelArk.' });
        mediaRefs.push({
          path: await resolveAssetKey(key), key,
          kind: ['image', 'video', 'audio'].includes(refKinds[index]) ? refKinds[index]
            : key.startsWith('video/') ? 'video' : key.startsWith('audio/') ? 'audio' : 'image'
        });
      }
      const cfg = await getConfig();
      const regenerated = await regenerateMiniMaxH3Video({
        apiKey: cfg.keys.minimax, endpoint: cfg.endpoints.minimax,
        prompt: source.sentPrompt || source.prompt, mediaRefs, mode: source.mode,
        baseVideoPath: await resolveAssetKey(sourceKey)
      });
      const key = await saveBuffer('video', `${ts()}-minimax-h3-2k-${newId()}.mp4`, regenerated.buffer);
      const outputSeconds = Number(regenerated.usage?.output_seconds) || Number(source.duration) || 0;
      const inputSeconds = Number(regenerated.usage?.input_seconds) || 0;
      const inputImages = Number(regenerated.usage?.input_image_count) || mediaRefs.filter((ref) => ref.kind === 'image').length;
      const cost = 0.05 * (outputSeconds + inputSeconds) + Math.max(0, inputImages - 5) * 0.025;
      await recordCost({ type: 'video', modelId: 'minimax-h3-regeneration', label: 'MiniMax H3 · 768P → 2K', units: outputSeconds, unitLabel: 'segundo(s)', cost });
      const entry = {
        ...source, id: newId(), ts: Date.now(), resolution: '2K', outputs: [key],
        cost: Number(cost.toFixed(6)), h3TaskId: regenerated.taskId,
        h3RegeneratedFrom: source.id, errors: []
      };
      await updateJson('history.json', [], (items) => [entry, ...items].slice(0, 1000));
      await recordAssetMetadata(entry);
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

    if (p === '/api/generate/comfyui' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const entry = await runComfyUIGeneration(body);
      return send(res, 200, entry);
    }

    if (p === '/api/generate/progress' && req.method === 'GET') {
      const genId = url.searchParams.get('id') || '';
      return send(res, 200, comfyProgress.get(genId) || { current: 0, total: 0 });
    }

    if (p === '/api/comfyui/scan' && req.method === 'GET') {
      const cfg = await getConfig();
      const graph = await loadWorkflow(cfg.comfyui.workflowPath);
      const slots = scanWorkflowSlots(graph);
      const found = Object.fromEntries(Object.entries(TUZZI_TYPES).map(([key, type]) => [key, (slots[type] || []).length]));
      return send(res, 200, { slots: found });
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
      const [pricing, ledger, automations, assetMetadata] = await Promise.all([
        getPricing(),
        readJson('ledger.json', []),
        readJson('automations.json', []),
        readJson('asset-metadata.json', {})
      ]);
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
      const projects = automations
        .map((project) => automationProjectCostEstimate(project, pricing, assetMetadata))
        .sort((a, b) => (b.updatedAt || b.ts || 0) - (a.updatedAt || a.ts || 0));
      return send(res, 200, {
        pricing,
        total,
        currentMonth: nowMonth,
        currentMonthTotal: byMonth[nowMonth] || 0,
        byMonth,
        byModelThisMonth,
        projects,
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
        // El rastreador histórico conoce v3. Conservamos cualquier tarifa
        // específica de Multilingual v2 hasta que también sea devuelta.
        audio: { ...current.audio, ...(found.audio || {}) },
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
      if (service === 'heygen') {
        const account = safeHeyGenAccount(await getHeyGenApiUser(body.key || cfg.keys.heygen || ''));
        const label = account.email || account.name || account.id || 'cuenta válida';
        return send(res, 200, { ok: true, detail: `Conectado a ${label}${account.billingType ? ` · ${account.billingType}` : ''}`, account });
      }
      if (service === 'comfyui') {
        const testCfg = { comfyui: { ...cfg.comfyui, ...(body.comfyui || {}) } };
        await checkComfyHealth(testCfg);
        let slotsDetail = '';
        try {
          const graph = await loadWorkflow(testCfg.comfyui.workflowPath);
          const slots = scanWorkflowSlots(graph);
          const found = Object.keys(TUZZI_TYPES).filter((key) => (slots[TUZZI_TYPES[key]] || []).length);
          slotsDetail = ` Nodos Tuzzi detectados: ${found.length ? found.join(', ') : 'ninguno'}.`;
        } catch (error) {
          slotsDetail = ` (ComfyUI responde, pero no pude leer el workflow: ${error.message})`;
        }
        return send(res, 200, { ok: true, detail: `ComfyUI responde.${slotsDetail}` });
      }
      const endpoint = body.endpoint || (service === 'ark' ? cfg.endpoints.ark
        : service === 'minimax' ? cfg.endpoints.minimax
          : service === 'suno' ? cfg.endpoints.suno : '');
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
    if (p === '/api/prompts/analyze-style' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const imageKey = normalizeStyleImageKey(body.imageKey);
      if (!imageKey) return send(res, 400, { error: 'Elegí una imagen válida para analizar.' });
      const cfg = await getConfig();
      const result = await analyzeArtStyle({
        apiKey: cfg.keys.gemini,
        imagePath: await resolveAssetKey(imageKey)
      });
      return send(res, 200, result);
    }

    if (p === '/api/prompts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const isStyle = body.kind === 'style' || String(body.category || '').trim().toLowerCase() === 'estilos';
      const styleImageKey = isStyle ? normalizeStyleImageKey(body.styleImageKey) : '';
      if (isStyle && !styleImageKey) return send(res, 400, { error: 'Los estilos necesitan una imagen de referencia.' });
      const item = {
        id: newId(),
        title: String(body.title || '').trim() || 'Sin título',
        text: String(body.text || ''),
        mode: isStyle ? 'image' : (['audio', 'video'].includes(body.mode) ? body.mode : 'image'),
        category: isStyle ? 'Estilos' : (String(body.category || '').trim() || 'General'),
        kind: isStyle ? 'style' : 'prompt',
        styleImageKey,
        ts: Date.now()
      };
      await updateJson('prompts.json', [], (all) => [item, ...all]);
      return send(res, 200, item);
    }
    if (p.startsWith('/api/prompts/') && req.method === 'PUT') {
      const id = p.split('/').pop();
      const body = await readJsonBody(req);
      let out = null;
      let invalidStyle = false;
      await updateJson('prompts.json', [], (all) => {
        const i = all.findIndex((x) => x.id === id);
        if (i === -1) return all;
        const requestedCategory = body.category !== undefined ? String(body.category).trim() || 'General' : (all[i].category || 'General');
        const isStyle = body.kind === 'style' || requestedCategory.toLowerCase() === 'estilos';
        const styleImageKey = isStyle
          ? normalizeStyleImageKey(body.styleImageKey !== undefined ? body.styleImageKey : all[i].styleImageKey)
          : '';
        if (isStyle && !styleImageKey) { invalidStyle = true; return all; }
        all[i] = {
          ...all[i],
          title: body.title !== undefined ? String(body.title).trim() || 'Sin título' : all[i].title,
          text: body.text !== undefined ? String(body.text) : all[i].text,
          category: isStyle ? 'Estilos' : requestedCategory,
          mode: isStyle ? 'image' : (body.mode !== undefined ? (['audio', 'video'].includes(body.mode) ? body.mode : 'image') : all[i].mode),
          kind: isStyle ? 'style' : 'prompt',
          styleImageKey
        };
        out = all[i]; return all;
      });
      if (invalidStyle) return send(res, 400, { error: 'Los estilos necesitan una imagen de referencia.' });
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
        for (const metadata of Object.values(m)) {
          if (Array.isArray(metadata?.sourceAssetKeys)) metadata.sourceAssetKeys = metadata.sourceAssetKeys.map(swap);
          if (metadata?.motionOverlayKey) metadata.motionOverlayKey = swap(metadata.motionOverlayKey);
        }
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
      await updateJson('audio-captions.json', {}, (captions) => {
        if (!captions[oldKey]) return captions;
        captions[newKey] = { ...captions[oldKey], audioKey: newKey };
        delete captions[oldKey];
        return captions;
      });
      await updateJson('automations.json', [], (all) => all.map((project) => ({
        ...project,
        blocks: (project.blocks || []).map((block) => ({
          ...block,
          assetKeys: (block.assetKeys || []).map(swap)
        })),
        generatedCharacters: Object.fromEntries(Object.entries(project.generatedCharacters || {}).map(([role, character]) => [role, {
          ...character,
          assetKey: swap(character.assetKey),
          sheet: swap(character.sheet),
          photos: (character.photos || []).map(swap)
        }])),
        outputs: Object.fromEntries(Object.entries(project.outputs || {}).map(([blockId, output]) => [blockId, {
          ...output,
          imageKey: swap(output.imageKey),
          textImageKey: swap(output.textImageKey),
          textLayerKey: swap(output.textLayerKey),
          motionOverlayKey: swap(output.motionOverlayKey),
          videoKey: swap(output.videoKey),
          assetKeys: (output.assetKeys || []).map(swap),
          audioKeys: (output.audioKeys || []).map(swap)
        }])),
        config: {
          ...project.config,
          music: normalizeAutomationMusic({
            ...project.config?.music,
            assetKey: swap(project.config?.music?.assetKey)
          }, project.requirements?.music),
          overlay: normalizeAutomationOverlay({ ...project.config?.overlay, previewBg: swap(project.config?.overlay?.previewBg) })
        },
        finalOutput: project.finalOutput ? {
          ...project.finalOutput,
          videoKey: swap(project.finalOutput.videoKey),
          musicKey: swap(project.finalOutput.musicKey)
        } : null,
        effectOutput: project.effectOutput ? {
          ...project.effectOutput,
          videoKey: swap(project.effectOutput.videoKey),
          sourceVideoKey: swap(project.effectOutput.sourceVideoKey)
        } : null
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
      await updateJson('audio-captions.json', {}, (captions) => {
        for (const key of removed) delete captions[key];
        return captions;
      });
      await updateJson('automations.json', [], (all) => all.map((project) => {
        const music = normalizeAutomationMusic(project.config?.music, project.requirements?.music);
        if (removed.has(music.assetKey)) music.assetKey = '';
        const finalOutput = project.finalOutput && !removed.has(project.finalOutput.videoKey)
          ? { ...project.finalOutput, musicKey: removed.has(project.finalOutput.musicKey) ? null : project.finalOutput.musicKey }
          : null;
        const effectOutput = project.effectOutput
          && !removed.has(project.effectOutput.videoKey)
          && !removed.has(project.effectOutput.sourceVideoKey)
          && finalOutput
          ? { ...project.effectOutput }
          : null;
        const outputs = Object.fromEntries(Object.entries(project.outputs || {}).map(([blockId, output]) => [blockId, {
          ...output,
          imageKey: removed.has(output.imageKey) ? null : output.imageKey,
          textImageKey: removed.has(output.textImageKey) ? null : output.textImageKey,
          textLayerKey: removed.has(output.textLayerKey) ? null : output.textLayerKey,
          motionOverlayKey: removed.has(output.motionOverlayKey) ? null : output.motionOverlayKey,
          videoKey: removed.has(output.videoKey) ? null : output.videoKey,
          assetKeys: (output.assetKeys || []).filter((key) => !removed.has(key)),
          audioKeys: (output.audioKeys || []).filter((key) => !removed.has(key))
        }]));
        const generatedCharacters = Object.fromEntries(Object.entries(project.generatedCharacters || {})
          .filter(([, character]) => !removed.has(character.assetKey || character.sheet)));
        const assignments = {
          ...project.assignments,
          characters: Object.fromEntries(Object.entries(project.assignments?.characters || {}).filter(([role, id]) =>
            !String(id).startsWith('automation-character:') || generatedCharacters[role]?.id === id))
        };
        const overlay = normalizeAutomationOverlay(project.config?.overlay);
        if (removed.has(overlay.previewBg)) overlay.previewBg = '';
        const blocks = (project.blocks || []).map((block) => ({
          ...block,
          assetKeys: (block.assetKeys || []).filter((key) => !removed.has(key))
        }));
        return { ...project, blocks, generatedCharacters, assignments, outputs, config: { ...project.config, music, overlay }, finalOutput, effectOutput };
      }));
      return send(res, 200, { ok: true, deleted: allowed.length, history: cleaned.slice(0, 200) });
    }

    // Imagen espejo local del avatar que ya fue registrado en HeyGen. Nunca se
    // sube ni registra automáticamente: sirve para identificar visualmente el
    // código remoto y para impedir que se elija el personaje equivocado.
    const heygenImageMatch = /^\/api\/characters\/([a-z0-9]+)\/heygen-image$/.exec(p);
    if (heygenImageMatch && ['POST', 'DELETE'].includes(req.method)) {
      const id = heygenImageMatch[1];
      const characters = await readJson('characters.json', []);
      const character = characters.find((item) => item.id === id);
      if (!character) return send(res, 404, { error: 'Personaje no encontrado' });
      const previous = character.heygen?.imageKey || '';
      let imageKey = '';
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body.dataUrl && !String(body.dataUrl).startsWith('data:image/')) throw new Error('La variante HeyGen debe ser una imagen.');
        const dir = path.join(DATA_DIR, 'characters', id, 'heygen');
        const name = await saveEntityPhoto(dir, body);
        imageKey = `characters/${id}/heygen/${name}`;
      }
      let updated;
      await updateJson('characters.json', [], (all) => all.map((item) => {
        if (item.id !== id) return item;
        updated = { ...item, heygen: { ...(item.heygen || {}), imageKey } };
        return updated;
      }));
      if (previous && previous !== imageKey) await fs.unlink(await resolveAssetKey(previous)).catch(() => {});
      return send(res, 200, updated);
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
        voiceId: String(source.voiceId || ''), voiceName: String(source.voiceName || ''),
        heygen: {
          avatarId: String(source.heygen?.wideAvatarId || source.heygen?.avatarId || ''),
          wideAvatarId: String(source.heygen?.wideAvatarId || source.heygen?.avatarId || ''),
          closeAvatarId: String(source.heygen?.closeAvatarId || ''),
          motionPrompt: heyGenMotionPromptValue(source.heygen, 'wideMotionPrompt'),
          wideMotionPrompt: heyGenMotionPromptValue(source.heygen, 'wideMotionPrompt'),
          closeMotionPrompt: heyGenMotionPromptValue(source.heygen, 'closeMotionPrompt'),
          imageKey: ''
        },
        photos: [], variants: [], ts: Date.now()
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
      if (source.heygen?.image) {
        const data = files.get(source.heygen.image);
        const ext = path.extname(source.heygen.image).toLowerCase();
        if (data && ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          const dir = path.join(characterDir, 'heygen'); await fs.mkdir(dir, { recursive: true });
          const name = `mirror${ext}`; await fs.writeFile(path.join(dir, name), data);
          item.heygen.imageKey = `characters/${id}/heygen/${name}`;
        }
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
      let heygen = {
        avatarId: character.heygen?.wideAvatarId || character.heygen?.avatarId || '',
        wideAvatarId: character.heygen?.wideAvatarId || character.heygen?.avatarId || '',
        closeAvatarId: character.heygen?.closeAvatarId || '',
        motionPrompt: heyGenMotionPromptValue(character.heygen, 'wideMotionPrompt'),
        wideMotionPrompt: heyGenMotionPromptValue(character.heygen, 'wideMotionPrompt'),
        closeMotionPrompt: heyGenMotionPromptValue(character.heygen, 'closeMotionPrompt'),
        image: ''
      };
      if (character.heygen?.imageKey) {
        const ext = path.extname(character.heygen.imageKey).toLowerCase();
        heygen.image = `heygen/mirror${ext}`;
        entries.push({ name: heygen.image, data: await fs.readFile(await resolveAssetKey(character.heygen.imageKey)) });
      }
      const manifest = { format: 'manifestador-character', version: 3, exportedAt: Date.now(), character: { name: character.name, description: character.description || '', voiceId: character.voiceId || '', voiceName: character.voiceName || '', photos, variants, heygen } };
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
      // URL.pathname conserva los espacios como %20. Decodificamos para que
      // categorías legibles como “Projector Slide” puedan vivir como carpetas.
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
      const abs = path.join(PUBLIC_DIR, rel);
      const publicRoot = path.resolve(PUBLIC_DIR);
      const resolvedStatic = path.resolve(abs);
      if (resolvedStatic === publicRoot || resolvedStatic.startsWith(publicRoot + path.sep)) {
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
