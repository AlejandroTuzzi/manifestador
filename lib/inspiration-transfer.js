import { createHash } from 'node:crypto';
import { changeInspiration, inspirationError } from './series-inspiration.js';
import { importMatch, importIds, rememberImport } from './library-transfer.js';

export function parseLibraryManifest(files, filename, format) {
  try {
    const manifest = JSON.parse(files.get(filename)?.toString('utf8') || '');
    if (manifest?.format !== format || manifest.version !== 1 || !Array.isArray(manifest.entries) || !Array.isArray(manifest.producers) || manifest.entries.length > 5000 || manifest.producers.length > 5000) throw 0;
    return manifest;
  } catch { throw inspirationError('transferManifest'); }
}

export async function exportInspirationArchive(collection, readImage) {
  const files = [], images = new Map();
  const entries = [];
  for (const item of collection.entries) {
    let image = '';
    if (item.imageKey) {
      let data;
      try { data = await readImage(item.imageKey); } catch { throw inspirationError('inspirationImage'); }
      const hash = createHash('sha256').update(data).digest('hex');
      image = images.get(hash);
      if (!image) {
        const extension = item.imageKey.match(/\.(png|jpe?g|webp)$/i)?.[0];
        if (!extension) throw inspirationError('inspirationImage');
        image = `covers/${hash}${extension.toLowerCase()}`;
        images.set(hash, image); files.push({ name: image, data });
      }
    }
    const { imageKey, ...portable } = item;
    entries.push({ ...portable, importIds: importIds(item), image });
  }
  const manifest = { format: 'manifestador-inspiration', version: 1, exportedAt: Date.now(), entries,
    producers: collection.producers.map(item => ({ ...item, importIds: importIds(item) })) };
  files.unshift({ name: 'inspiration.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });
  if (files.length > 5000 || files.reduce((size, file) => size + file.data.length, 0) > 149 * 1024 * 1024) throw inspirationError('transferSize');
  return files;
}

export async function importInspirationArchive(current, manifest, { files, newId, saveImage, validateImage, nsfwEnabled }) {
  let next = structuredClone({ entries: current.entries || [], producers: current.producers || [] });
  const stats = { imported: 0, skipped: 0, hidden: 0 };
  const producers = new Map(), hiddenProducers = new Set(), covers = new Map(), pending = [];
  const now = Date.now();
  for (const source of manifest.producers) {
    if (!source || typeof source.id !== 'string' || !source.id || producers.has(source.id) || hiddenProducers.has(source.id)) throw inspirationError('transferManifest');
    if (source.nsfw && !nsfwEnabled) { hiddenProducers.add(source.id); stats.hidden++; continue; }
    const existing = importMatch(next.producers, source, 'producers');
    if (existing) {
      if (existing.nsfw && !nsfwEnabled) { hiddenProducers.add(source.id); stats.hidden++; continue; }
      next.producers = next.producers.map(item => item.id === existing.id ? rememberImport(item, source) : item);
      producers.set(source.id, existing.id); stats.skipped++; continue;
    }
    const id = newId();
    next = changeInspiration(next, 'producers', 'POST', id, source, { nsfwEnabled, now });
    next.producers = next.producers.map(item => item.id === id ? rememberImport(item, source) : item);
    producers.set(source.id, id); stats.imported++;
  }
  for (const source of manifest.entries) {
    if (!source || typeof source !== 'object') throw inspirationError('transferManifest');
    if (!nsfwEnabled && (source.nsfw || hiddenProducers.has(source.producerId))) { stats.hidden++; continue; }
    if (source.producerId && !producers.has(source.producerId)) throw inspirationError('inspirationProducer');
    const mapped = { ...source, producerId: producers.get(source.producerId) || '', imageKey: '' };
    const existing = importMatch(next.entries, mapped, 'entries');
    if (existing) {
      if (!nsfwEnabled && existing.nsfw) { stats.hidden++; continue; }
      next.entries = next.entries.map(item => item.id === existing.id ? rememberImport(item, source) : item);
      stats.skipped++; continue;
    }
    const id = newId();
    next = changeInspiration(next, 'entries', 'POST', id, mapped, { nsfwEnabled, now });
    next.entries = next.entries.map(item => item.id === id ? rememberImport(item, source) : item);
    if (source.image) {
      const data = files.get(source.image);
      if (!data || !/\.(png|jpe?g|webp)$/i.test(source.image)) throw inspirationError('inspirationImage');
      await validateImage(source.image, data);
      const hash = createHash('sha256').update(data).digest('hex') + ':' + Boolean(source.nsfw);
      pending.push({ id, source, data, hash });
    }
    stats.imported++;
  }
  // Validate all records before writing any cover. Repeated imports skip writes.
  for (const { id, source, data, hash } of pending) {
    let imageKey = covers.get(hash);
    if (!imageKey) { imageKey = await saveImage(source, data); covers.set(hash, imageKey); }
    next.entries = next.entries.map(item => item.id === id ? { ...item, imageKey } : item);
  }
  return { collection: next, stats };
}
