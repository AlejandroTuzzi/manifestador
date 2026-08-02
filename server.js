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
  generateGemini, generateSeedream, generateOpenAIImage, generateSeedanceVideo, generateScreenplay,
  listVoices, generateSpeech, generateMusic, translateText, searchUpdatedPricing, testService
} from './lib/providers.js';
import { mergePricing, imagePrice, videoPrice, audioPrice, musicPrice, translatePrice, scriptPrice } from './lib/pricing.js';
import { POSER_BODY_PARTS } from './public/poser-bodyparts.js';
import {
  registerHeyGenOAuthClient, heyGenAuthorizationUrl, exchangeHeyGenOAuthCode,
  refreshHeyGenOAuthToken, getHeyGenMcpUser, getHeyGenApiUser,
  uploadHeyGenAssetWithKey, uploadHeyGenAssetWithMcp,
  createHeyGenVideoWithKey, createHeyGenVideoWithMcp,
  getHeyGenVideoWithKey, getHeyGenVideoWithMcp,
  waitForHeyGenVideo, downloadHeyGenVideo
} from './lib/heygen.js';

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
  keys: { gemini: '', googleTranslate: '', ark: '', elevenlabs: '', openai: '', suno: '', heygen: '' },
  openaiModel: 'gpt-5-mini',
  audioModelId: AUDIO_MODEL.id,
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
  return {
    enabled: saved?.enabled === true,
    preset,
    intensity: Number.isFinite(enteredIntensity) ? Math.max(0, Math.min(100, Math.round(enteredIntensity))) : 35
  };
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

  if (model.requiresRegisteredCharacter) {
    const characters = await readJson('characters.json', []);
    const character = characters.find((item) => item.id === req.heygenCharacterId);
    if (!character?.heygen?.avatarId || !character?.heygen?.imageKey) {
      throw new Error('Elegí un personaje con variante HeyGen completa (imagen espejo y código de avatar).');
    }
    await fs.access(await resolveAssetKey(character.heygen.imageKey));
    characterId = character.id;
    payload = {
      type: 'avatar',
      avatar_id: character.heygen.avatarId,
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

  const motionPrompt = String(req.heygenMotionPrompt || '').trim().slice(0, 1000);
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
  const requestedText = String(req.text || '').trim();
  if (!requestedText) throw new Error('El texto está vacío.');
  const model = getAudioModel(req.audioModelId || req.modelId || cfg.audioModelId);
  // Las etiquetas [shouting], [whispers], etc. son instrucciones propias de
  // Eleven v3. En Multilingual v2 se quitan para que nunca se locuten.
  const text = model.supportsAudioTags ? requestedText : stripTags(requestedText);
  if (!text) throw new Error('El texto sólo contiene etiquetas de expresión; escribí algo para locutar.');
  const { buffer, mime } = await generateSpeech({
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

function invalidateAutomationOutput(output = {}, { image = false, text = false, audio = false } = {}) {
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
  }
  if (audio) {
    delete next.audioKeys;
    delete next.audioCountExpected;
  }
  if (image || text || audio) {
    delete next.videoKey;
    delete next.completedAt;
  }
  return next;
}

// La voz del narrador es del proyecto; los diálogos usan la voz del personaje
// asignado (si tiene), con la del narrador como respaldo.
const DEFAULT_AUTOMATION_CONFIG = {
  imageModelId: 'nano-banana-pro',
  fallbackImageModelId: '',
  artStyle: 'Photorealistic cinematic realism, natural human anatomy, realistic skin and materials, restrained color grading, consistent lighting and lens language',
  aspectRatio: '9:16',
  resolution: '2K',
  narratorVoiceId: '',
  narratorVoiceName: '',
  audioModelId: AUDIO_MODEL.id,
  includeLogos: false,
  videoEffect: {
    enabled: false,
    preset: 'wiggle',
    intensity: 35
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
  titleOverlay: { ...DEFAULT_TITLE_OVERLAY }
};

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
  const blockImages = project.blocks?.length || 0;
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
  const estimatedTotal = resourceImageCost + blockImageCost + audioCost + generatedMusicCost;

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
    generatedCharacters: normalizeAutomationGeneratedCharacters(prev.generatedCharacters || src.generatedCharacters, requirements.characters),
    assignments: prev.assignments || { characters: {}, locations: {}, objects: {} },
    config: {
      ...DEFAULT_AUTOMATION_CONFIG,
      ...(prev.config || {}),
      artStyle: String(prev.config?.artStyle || DEFAULT_AUTOMATION_CONFIG.artStyle).slice(0, 1200),
      audioModelId: getAudioModel(prev.config?.audioModelId).id,
      includeLogos: prev.config?.includeLogos === true,
      videoEffect: normalizeAutomationVideoEffect(prev.config?.videoEffect),
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
      arkAssetId: String(body.arkAssetId || '').trim().replace(/^asset:\/\//, ''),
      heygen: { avatarId: String(body.heygenAvatarId || '').trim().slice(0, 200), imageKey: '' }
    }),
    applyUpdate: (e, body) => {
      if (body.name !== undefined) e.name = String(body.name).trim() || e.name;
      if (body.description !== undefined) e.description = String(body.description);
      if (body.voiceId !== undefined) e.voiceId = body.voiceId;
      if (body.voiceName !== undefined) e.voiceName = body.voiceName;
      if (body.arkAssetId !== undefined) e.arkAssetId = String(body.arkAssetId).trim().replace(/^asset:\/\//, '');
      if (body.heygenAvatarId !== undefined) e.heygen = {
        ...(e.heygen || {}), avatarId: String(body.heygenAvatarId || '').trim().slice(0, 200)
      };
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

    if (p.startsWith('/api/') || p.startsWith('/files/') || p.startsWith('/fonts/')) {
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
      const [cfg, characters, prompts, promptCategories, history, pricing, assetLinks, series, scripts, elements, elementLinks, automations, fonts, transitionSounds] = await Promise.all([
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
        listTransitionSounds()
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
        automations: automations.map((project) => ({
          ...project,
          config: {
            ...project.config,
            includeLogos: project.config?.includeLogos === true,
            videoEffect: normalizeAutomationVideoEffect(project.config?.videoEffect),
            audioModelId: getAudioModel(project.config?.audioModelId).id,
            transitionSound: normalizeAutomationTransitionSound(project.config?.transitionSound),
            music: normalizeAutomationMusic(project.config?.music, project.requirements?.music),
            overlay: normalizeAutomationOverlay(project.config?.overlay),
            titleOverlay: normalizeAutomationTitleOverlay(project.config?.titleOverlay, project.blocks, project.integration?.scriptTitle || project.name)
          }
        })),
        fonts,
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
            includeLogos: body.config.includeLogos !== undefined
              ? body.config.includeLogos === true
              : prev.config?.includeLogos === true,
            videoEffect: normalizeAutomationVideoEffect({
              ...prev.config?.videoEffect,
              ...(body.config.videoEffect || {})
            }),
            audioModelId: getAudioModel(body.config.audioModelId ?? prev.config?.audioModelId).id,
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
            next.outputs = Object.fromEntries(Object.entries(next.outputs || {}).map(([blockId, output]) => [
              blockId,
              invalidateAutomationOutput(output, { text: true })
            ]));
            next.finalOutput = null;
          }
          if (body.config?.titleOverlay !== undefined) {
            const previousTitle = normalizeAutomationTitleOverlay(prev.config?.titleOverlay, prev.blocks, prev.integration?.scriptTitle || prev.name);
            const nextTitle = normalizeAutomationTitleOverlay(next.config?.titleOverlay, next.blocks, next.integration?.scriptTitle || next.name);
            const titleRenderingChanged = automationTitleRenderSignature(previousTitle, prev.blocks, prev.integration?.scriptTitle || prev.name)
              !== automationTitleRenderSignature(nextTitle, next.blocks, next.integration?.scriptTitle || next.name);
            if (titleRenderingChanged) {
              const affectsEveryBlock = previousTitle.mode === 'block' || nextTitle.mode === 'block';
              const affectedBlockIds = new Set([previousTitle.blockId, nextTitle.blockId].filter(Boolean));
              next.outputs = Object.fromEntries(Object.entries(next.outputs || {}).map(([blockId, output]) => [
                blockId,
                affectsEveryBlock || affectedBlockIds.has(blockId) ? invalidateAutomationOutput(output, { text: true }) : output
              ]));
              next.finalOutput = null;
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
            if (sanitized.some((block) => !block.imagePrompt.trim() || !block.items.length)) {
              throw new Error('Cada bloque debe conservar un prompt visual y al menos un texto de narración o diálogo.');
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
                const textChanged = JSON.stringify(previousBlock.items || []) !== JSON.stringify(block.items || []);
                const blockTitleChanged = previousBlock.title !== block.title
                  && next.config?.titleOverlay?.enabled === true
                  && next.config?.titleOverlay?.mode === 'block';
                if (promptChanged || textChanged || blockTitleChanged) generationChanged = true;
                output = invalidateAutomationOutput(output, {
                  image: promptChanged,
                  text: textChanged || blockTitleChanged,
                  audio: textChanged
                });
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
            audioModelId: getAudioModel(next.config?.audioModelId).id,
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

    // Muxea el video de un bloque: imagen fija (ya con el texto quemado) + audio(s)
    // en secuencia → mp4 que dura lo que el audio. El overlay lo quema el cliente
    // por canvas (WYSIWYG con el visualizador); acá solo se arma el video.
    const automationVideoMatch = /^\/api\/automations\/([a-z0-9]+)\/video$/.exec(p);
    if (automationVideoMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const cfg = await getConfig();
      const ffmpegExecutable = await resolveFfmpegExecutable(cfg.ffmpegPath);
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
      await runFfmpeg(ffmpegExecutable, args);
      const key = `video/${name}`;
      const category = String(body.category || '').slice(0, 80);
      await updateJson('asset-metadata.json', {}, (m) => {
        m[key] = { type: 'video', modelId: 'ffmpeg', modelName: 'Automatizador', ts: Date.now(), category, automationId: automationVideoMatch[1], blockId: String(body.blockId || '') };
        return m;
      });
      return send(res, 200, { videoKey: key });
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

    // Posproducción opcional: reconstruye cada toma con su imagen limpia, aplica
    // el efecto y recién después agrega la capa PNG de texto. Reutiliza el audio
    // del MP4 final, no llama modelos y mantiene disponible el master anterior.
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
      const effect = normalizeAutomationVideoEffect({
        ...project.config?.videoEffect,
        ...(body.videoEffect || body || {}),
        enabled: true
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
      for (const block of project.blocks || []) {
        const output = project.outputs?.[block.id] || {};
        const imageKey = String(output.imageKey || '');
        const textLayerKey = String(output.textLayerKey || '');
        const blockVideoKey = String(output.videoKey || '');
        if (!/^(generated|uploads)\//.test(imageKey)) {
          return send(res, 400, { error: `Falta la imagen limpia de “${block.title || block.id}”.` });
        }
        if (!/^(generated|uploads)\//.test(textLayerKey)) {
          return send(res, 400, { error: `Falta la capa de subtítulos de “${block.title || block.id}”. Volvé a aplicar el efecto para prepararla.` });
        }
        if (!/^video\//.test(blockVideoKey)) {
          return send(res, 400, { error: `Falta el video terminado de “${block.title || block.id}”.` });
        }
        const [imagePath, textLayerPath, blockVideoPath] = await Promise.all([
          resolveAssetKey(imageKey), resolveAssetKey(textLayerKey), resolveAssetKey(blockVideoKey)
        ]);
        const stats = await Promise.all([
          fs.stat(imagePath).catch(() => null),
          fs.stat(textLayerPath).catch(() => null),
          fs.stat(blockVideoPath).catch(() => null)
        ]);
        if (stats.some((stat) => !stat?.isFile())) {
          return send(res, 400, { error: `No encuentro todos los materiales locales de “${block.title || block.id}”.` });
        }
        blockSources.push({ block, imagePath, textLayerPath, blockVideoPath });
      }
      if (!blockSources.length) return send(res, 400, { error: 'El proyecto no tiene tomas para procesar.' });

      const blockDurations = await Promise.all(
        blockSources.map((source) => probeMediaDuration(ffmpegExecutable, source.blockVideoPath))
      );
      if (blockDurations.some((blockDuration) => !blockDuration)) {
        return send(res, 400, { error: 'No pude calcular la duración de todas las tomas. Verificá que ffprobe esté junto a ffmpeg.' });
      }
      const contentDuration = blockDurations.reduce((sum, blockDuration) => sum + blockDuration, 0);
      const effectFilters = automationVideoEffectFilters(effect, width, height);
      const name = `${ts()}-efecto-${effect.preset}-${sanitizeName(project.name)}-${newId()}.mp4`;
      const outDir = resolveDir(cfg.paths.video);
      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, name);
      const args = ['-y', '-i', sourcePath];
      for (const source of blockSources) {
        args.push('-loop', '1', '-framerate', '25', '-i', source.imagePath);
        args.push('-loop', '1', '-framerate', '25', '-i', source.textLayerPath);
      }
      const filters = [
        `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,format=yuv420p[base]`
      ];
      const shotLabels = [];
      for (let index = 0; index < blockSources.length; index++) {
        const imageInputIndex = 1 + index * 2;
        const layerInputIndex = imageInputIndex + 1;
        const blockDuration = blockDurations[index].toFixed(3);
        filters.push(
          `[${imageInputIndex}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25,` +
          `${effectFilters},trim=start=0:end=${blockDuration},setpts=PTS-STARTPTS[effectbg${index}]`
        );
        filters.push(
          `[${layerInputIndex}:v:0]format=rgba,scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,` +
          `trim=start=0:end=${blockDuration},setpts=PTS-STARTPTS,format=rgba[textlayer${index}]`
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
      await runFfmpeg(ffmpegExecutable, args);

      const videoKey = `video/${name}`;
      const processedAt = Date.now();
      const presetName = AUTOMATION_VIDEO_EFFECTS[effect.preset].name;
      await updateJson('asset-metadata.json', {}, (metadata) => {
        metadata[videoKey] = {
          type: 'video',
          modelId: 'ffmpeg',
          modelName: 'Posproducción FFmpeg',
          ts: processedAt,
          category: `Auto: ${project.name}`,
          automationId: project.id,
          autoKind: 'post-effect',
          sourceVideoKey,
          effectPreset: effect.preset,
          effectName: presetName,
          effectIntensity: effect.intensity,
          width,
          height,
          subtitleLayerCount: blockSources.length,
          subtitlesPreserved: true,
          logoPreserved: project.finalOutput.includeLogos === true,
          cost: 0
        };
        return metadata;
      });

      let updatedProject = null;
      await updateJson('automations.json', [], (all) => all.map((item) => {
        if (item.id !== projectId) return item;
        updatedProject = {
          ...item,
          config: {
            ...item.config,
            videoEffect: effect,
            transitionSound: normalizeAutomationTransitionSound(item.config?.transitionSound),
            music: normalizeAutomationMusic(item.config?.music, item.requirements?.music),
            overlay: normalizeAutomationOverlay(item.config?.overlay),
            titleOverlay: normalizeAutomationTitleOverlay(item.config?.titleOverlay, item.blocks, item.integration?.scriptTitle || item.name)
          },
          effectOutput: {
            videoKey,
            sourceVideoKey,
            processedAt,
            preset: effect.preset,
            presetName,
            intensity: effect.intensity,
            width,
            height,
            subtitleLayerCount: blockSources.length,
            subtitlesPreserved: true,
            logoPreserved: project.finalOutput.includeLogos === true
          },
          updatedAt: processedAt
        };
        return updatedProject;
      }));
      if (!updatedProject) return send(res, 404, { error: 'El proyecto fue eliminado durante la posproducción.' });
      return send(res, 200, { project: updatedProject, effectOutput: updatedProject.effectOutput });
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
      await updateJson('automations.json', [], (all) => all.map((project) => ({
        ...project,
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
          videoKey: swap(output.videoKey),
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
          videoKey: removed.has(output.videoKey) ? null : output.videoKey,
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
        return { ...project, generatedCharacters, assignments, outputs, config: { ...project.config, music, overlay }, finalOutput, effectOutput };
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
        heygen: { avatarId: String(source.heygen?.avatarId || ''), imageKey: '' },
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
      let heygen = { avatarId: character.heygen?.avatarId || '', image: '' };
      if (character.heygen?.imageKey) {
        const ext = path.extname(character.heygen.imageKey).toLowerCase();
        heygen.image = `heygen/mirror${ext}`;
        entries.push({ name: heygen.image, data: await fs.readFile(await resolveAssetKey(character.heygen.imageKey)) });
      }
      const manifest = { format: 'manifestador-character', version: 2, exportedAt: Date.now(), character: { name: character.name, description: character.description || '', voiceId: character.voiceId || '', voiceName: character.voiceName || '', photos, variants, heygen } };
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
