import { createHash } from 'node:crypto';
import { importMatch, rememberImport } from './library-transfer.js';

const fail = () => { throw Object.assign(new Error('seriesTransfer'), { localizationCode: 'seriesTransfer', status: 400 }); };
const hash = data => createHash('sha256').update(data).digest('hex');
const assetPrefix = /^(uploads|generated|characters|elements|video|audio)\//;
export const validSeriesAsset = key => typeof key === 'string' && assetPrefix.test(key) && !key.split('/').some(part => !part || part === '.' || part === '..') && !/[\\:\x00-\x1f]/.test(key) && /\.(png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|m4a|ogg|flac)$/i.test(key);
function walk(value, visit, depth = 0) {
  if (depth > 40) fail();
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.map(item => walk(item, visit, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__','prototype','constructor'].includes(key)).map(([key,item]) => [key, walk(item, visit, depth + 1)]));
  return value;
}
function keysOf(value) {
  const keys = new Set();
  walk(value, text => { if (assetPrefix.test(text)) { if (!validSeriesAsset(text)) fail(); keys.add(text); } return text; });
  return [...keys];
}
export async function exportSeriesArchive(series, characters, scripts, metadata, readAsset, assetLinks = []) {
  const records = { series, characters: characters.filter(c => (series.characterIds || []).includes(c.id)), scripts: scripts.filter(s => s.seriesId === series.id), assetLinks:assetLinks.filter(link => (series.characterIds || []).includes(link.characterId)) };
  const files = [], assets = []; let size = 0;
  for (const key of keysOf(records)) {
    const data = await readAsset(key); size += data.length;
    if (size > 149 * 1024 * 1024 || assets.length >= 4900) fail();
    const digest = hash(data), file = `assets/${digest}`;
    if (!files.some(item => item.name === file)) files.push({ name: file, data });
    const m = metadata[key] || {};
    assets.push({ key, file, hash: digest, metadata: { nsfw: Boolean(m.nsfw), tags: Array.isArray(m.tags) ? m.tags.filter(t => typeof t === 'string') : [], type: m.type || '', modelId: m.modelId || 'import' } });
  }
  files.unshift({ name:'series.json', data:Buffer.from(JSON.stringify({ format:'manifestador-series', version:1, ...records, assets })) });
  return files;
}
export function parseSeriesArchive(files) {
  let manifest;
  try { manifest = JSON.parse(files.get('series.json').toString('utf8')); } catch { fail(); }
  if (manifest?.format !== 'manifestador-series' || manifest.version !== 1 || !manifest.series?.id || typeof manifest.series.title !== 'string' || !Array.isArray(manifest.series.assetKeys) || !Array.isArray(manifest.series.characterIds)) fail();
  for (const key of ['characters','scripts','assets']) if (!Array.isArray(manifest[key]) || manifest[key].length > 4900) fail();
  for (const kind of ['characters','scripts']) {
    const seen = new Set();
    for (const item of manifest[kind]) {
      if (!item || typeof item.id !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(item.id) || seen.has(item.id)) fail();
      seen.add(item.id);
      if (kind === 'characters' && (typeof item.name !== 'string' || !Array.isArray(item.photos) || !Array.isArray(item.variants))) fail();
      if (kind === 'scripts' && (typeof item.title !== 'string' || item.seriesId !== manifest.series.id || !Array.isArray(item.scenes))) fail();
    }
  }
  if (manifest.series.characterIds.some(id => !manifest.characters.some(c => c.id === id))) fail();
  manifest.assetLinks ||= [];
  if (!Array.isArray(manifest.assetLinks) || manifest.assetLinks.length > 4900 || manifest.assetLinks.some(link => !link || !validSeriesAsset(link.key) || !manifest.characters.some(c => c.id === link.characterId))) fail();
  const seen = new Set();
  for (const asset of manifest.assets) {
    if (!asset || !validSeriesAsset(asset.key) || seen.has(asset.key) || !/^[a-f0-9]{64}$/.test(asset.hash) || asset.file !== `assets/${asset.hash}` || !files.has(asset.file) || hash(files.get(asset.file)) !== asset.hash) fail();
    seen.add(asset.key);
  }
  if (keysOf({ series:manifest.series, characters:manifest.characters, scripts:manifest.scripts, assetLinks:manifest.assetLinks }).some(key => !seen.has(key))) fail();
  return manifest;
}
export async function planSeriesImport(current, manifest, files, readAsset, newId) {
  const assetMap = new Map(), writes = [], hashes = new Map();
  // Search tracked assets by content, not merely by filename.
  for (const key of new Set([...Object.keys(current.metadata), ...keysOf({ series:current.series, characters:current.characters, scripts:current.scripts })])) {
    if (!validSeriesAsset(key)) continue;
    const data = await readAsset(key).catch(() => null);
    if (data) hashes.set(hash(data), key);
  }
  for (const asset of manifest.assets) {
    const existing = await readAsset(asset.key).catch(() => null);
    const key = existing ? asset.key : hashes.get(asset.hash) || asset.key;
    assetMap.set(asset.key, key);
    if (existing && hashes.get(hash(existing)) === key && hash(existing) !== asset.hash) hashes.delete(hash(existing));
    if (existing ? hash(existing) !== asset.hash : !hashes.has(asset.hash)) writes.push({ key, data:files.get(asset.file) });
    hashes.set(asset.hash, key);
  }
  const remap = value => walk(value, text => assetMap.get(text) || text);
  const characters = [...current.characters], characterMap = new Map();
  for (const source of manifest.characters) {
    const old = importMatch(characters, source, 'characters');
    const item = rememberImport({ ...remap(source), id:old?.id || newId() }, source);
    characterMap.set(source.id, item.id);
    const index = characters.findIndex(c => c.id === item.id);
    if (index < 0) characters.push(item); else characters[index] = item;
  }
  const old = importMatch(current.series, manifest.series, 'series');
  const series = rememberImport({ ...remap(manifest.series), id:old?.id || newId(), characterIds:manifest.series.characterIds.map(id => characterMap.get(id)) }, manifest.series);
  const scripts = [...current.scripts];
  for (const source of manifest.scripts) {
    const existing = importMatch(scripts.filter(s => s.seriesId === series.id), source, 'scripts');
    const item = rememberImport({ ...remap(source), id:existing?.id || newId(), seriesId:series.id }, source);
    const index = scripts.findIndex(s => s.id === item.id);
    if (index < 0) scripts.push(item); else scripts[index] = item;
  }
  const metadata = { ...current.metadata };
  for (const asset of manifest.assets) {
    const key = assetMap.get(asset.key), m = asset.metadata || {};
    metadata[key] = { ...metadata[key], nsfw:Boolean(m.nsfw || metadata[key]?.nsfw), tags:Array.isArray(m.tags) ? m.tags.filter(t => typeof t === 'string') : [], type:typeof m.type === 'string' ? m.type : '', modelId:typeof m.modelId === 'string' ? m.modelId : 'import', ts:Date.now() };
  }
  const assetLinks = manifest.assetLinks.map(link => ({ ...remap(link), characterId:characterMap.get(link.characterId) }));
  return { series, characters, scripts, metadata, writes, assetLinks, assetKeys:[...assetMap.values()], updated:Boolean(old) };
}
