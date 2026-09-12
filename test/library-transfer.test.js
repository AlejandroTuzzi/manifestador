import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { importName, importIds, importMatch, rememberImport } from '../lib/library-transfer.js';
import { exportInspirationArchive, importInspirationArchive, parseLibraryManifest } from '../lib/inspiration-transfer.js';
import { changeInspiration } from '../lib/series-inspiration.js';
import { normalizeVocabularyWords, sanitizeVocabularyEntry } from '../lib/vocabulary.js';
import { normalizeDistinctiveElements } from '../lib/distinctive-elements.js';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const zipTools = vm.runInNewContext(`${server.slice(server.indexOf('const CRC_TABLE ='), server.indexOf('function monthKey('))}\n({createZip, readStoredZip})`, {
  Buffer, localizedServerError: code => Object.assign(new Error(code), { localizationCode: code })
});
const png = Buffer.from('portable image bytes');
function fixture() {
  let store = changeInspiration({}, 'producers', 'POST', 'studio', { name: 'Studio', description: 'Production', url: 'https://example.com' });
  return changeInspiration(store, 'entries', 'POST', 'drama', { title: 'Drama', producerId: 'studio', imageKey: 'uploads/cover.png', rating: 5, consistency: 4, quality: 3, continuity: 2, narrative: 1, sound: 5, tags: ['A'], appreciation: 'Lighting', description: 'Synopsis', genre: 'Romance', url: 'https://example.com/drama' });
}
function importer(files, prefix = 'pc') {
  let counter = 0;
  const writes = [];
  return { writes, options: { files, nsfwEnabled: false, newId: () => prefix + ++counter, validateImage: async () => {}, saveImage: async source => { writes.push(source.image); return `uploads/${prefix}-${writes.length}.png`; } } };
}

test('portable identity normalizes spacing, case and accents but does not fuzzy-match unrelated names', () => {
  assert.equal(importName('  PÉNÉLOPE   Cruz '), 'penelope cruz');
  assert.ok(importMatch([{ id: 'a', name: 'Pénélope' }], { name: ' penelope ' }, 'characters'));
  assert.equal(importMatch([{ id: 'a', title: 'Drama 1', producerId: 'p' }], { title: 'Drama 2', producerId: 'p' }, 'entries'), undefined);
  assert.equal(importMatch([{ title: 'Shirts', category: 'Clothes' }], { title: 'Shirts', category: 'Architecture' }, 'vocabulary'), undefined);
  assert.equal(importMatch([{ title: 'Drama', producerId: 'one' }], { title: 'Drama', producerId: 'two' }, 'entries'), undefined);
  const saved = rememberImport({ id: 'pc2', name: 'Renamed' }, { id: 'pc1' });
  assert.ok(importMatch([saved], { id: 'pc1', name: 'Original' }, 'characters'));
  assert.deepEqual(importIds({ id: '../../bad', importIds: ['good', 'good', 12] }), ['good']);
});

test('inspiration ZIP round trip preserves all fields and associations across three PCs without duplicate images', async () => {
  const original = fixture();
  original.entries[0].episodeCount = 80;
  original.entries[0].episodeDurationMinutes = 1.5;
  const packed = await exportInspirationArchive(original, async () => png);
  const bytes = zipTools.createZip(packed);
  const files = zipTools.readStoredZip(bytes);
  const manifest = parseLibraryManifest(files, 'inspiration.json', 'manifestador-inspiration');
  assert.equal(files.size, 2);
  const pc2 = importer(files, 'second');
  const first = await importInspirationArchive({}, manifest, pc2.options);
  assert.equal(first.stats.imported, 2);
  const record = first.collection.entries[0];
  assert.equal(record.episodeCount, 80);
  assert.equal(record.episodeDurationMinutes, 1.5);
  for (const key of ['title', 'description', 'appreciation', 'url', 'genre', 'rating', 'consistency', 'quality', 'continuity', 'narrative', 'sound']) assert.equal(record[key], original.entries[0][key], key);
  assert.equal(record.producerId, first.collection.producers[0].id);
  const again = await importInspirationArchive(first.collection, manifest, pc2.options);
  assert.equal(again.stats.imported, 0); assert.equal(again.stats.skipped, 2); assert.equal(pc2.writes.length, 1);
  const pc2Zip = await exportInspirationArchive(again.collection, async () => png);
  const pc3Files = zipTools.readStoredZip(zipTools.createZip(pc2Zip));
  const pc3Manifest = parseLibraryManifest(pc3Files, 'inspiration.json', 'manifestador-inspiration');
  const pc3 = importer(pc3Files, 'third');
  const third = await importInspirationArchive({}, pc3Manifest, pc3.options);
  const pc1 = importer(pc3Files, 'first');
  const backHome = await importInspirationArchive(original, pc3Manifest, pc1.options);
  assert.equal(third.collection.entries.length, 1);
  assert.equal(backHome.stats.imported, 0); assert.equal(pc1.writes.length, 0);
});

test('import keeps local ratings and notes, recognizes legacy names and does not duplicate within one archive', async () => {
  const original = fixture();
  const files = new Map((await exportInspirationArchive(original, async () => png)).map(file => [file.name, file.data]));
  const manifest = parseLibraryManifest(files, 'inspiration.json', 'manifestador-inspiration');
  manifest.entries[0].id = 'remote'; manifest.entries[0].importIds = [];
  manifest.entries[0].title = ' DRAMA '; manifest.entries[0].rating = 1; manifest.entries[0].appreciation = 'Changed';
  manifest.entries.push({ ...manifest.entries[0] });
  const worker = importer(files);
  const imported = await importInspirationArchive(original, manifest, worker.options);
  assert.equal(imported.collection.entries.length, 1);
  assert.equal(imported.collection.entries[0].rating, 5);
  assert.equal(imported.collection.entries[0].appreciation, 'Lighting');
  assert.equal(worker.writes.length, 0);
  const updated = changeInspiration(imported.collection, 'entries', 'PUT', 'drama', { title: 'Local renamed' });
  assert.ok(updated.entries[0].importIds.includes('remote'));
});

test('bad manifests, missing covers and invalid ratings fail before any cover is written; NSFW is skipped', async () => {
  const files = new Map((await exportInspirationArchive(fixture(), async () => png)).map(file => [file.name, file.data]));
  const manifest = parseLibraryManifest(files, 'inspiration.json', 'manifestador-inspiration');
  const worker = importer(files);
  manifest.entries.push({ ...manifest.entries[0], id: 'bad', importIds: [], title: 'Bad', rating: 9 });
  await assert.rejects(importInspirationArchive({}, manifest, worker.options), { localizationCode: 'inspirationRating' });
  assert.equal(worker.writes.length, 0);
  manifest.entries.pop(); manifest.entries[0].image = 'covers/missing.png';
  await assert.rejects(importInspirationArchive({}, manifest, worker.options), { localizationCode: 'inspirationImage' });
  manifest.producers[0].nsfw = true;
  const hidden = await importInspirationArchive({}, manifest, worker.options);
  assert.equal(hidden.stats.hidden, 2); assert.equal(hidden.collection.entries.length, 0);
  assert.throws(() => parseLibraryManifest(new Map(), 'inspiration.json', 'manifestador-inspiration'), { localizationCode: 'transferManifest' });
});

test('ZIP reader detects corrupt bytes and truncated archives, with no path traversal', () => {
  const zip = zipTools.createZip([{ name: 'sample.txt', data: Buffer.from('test') }]);
  assert.equal(zipTools.readStoredZip(zip).get('sample.txt').toString(), 'test');
  const corrupt = Buffer.from(zip); corrupt[40] ^= 1;
  assert.throws(() => zipTools.readStoredZip(corrupt), { localizationCode: 'transferArchive' });
  assert.throws(() => zipTools.readStoredZip(zip.subarray(0, zip.length - 10)), { localizationCode: 'transferArchive' });
  assert.throws(() => zipTools.readStoredZip(zipTools.createZip([{ name: '../config.json', data: png }])));
});

function legacyRoutes() {
  const db = new Map(), writes = [], locks = new Map();
  let serial = 0, files = new Map();
  const context = {
    Buffer, path, DATA_DIR: '/virtual', importMatch, importIds, rememberImport, normalizeVocabularyWords, sanitizeVocabularyEntry, normalizeDistinctiveElements,
    newId: () => 'id' + ++serial, ts: () => 'time', baseName: () => 'cover', resolveDir: value => value,
    sameCategory: (a, b) => importName(a) === importName(b),
    heyGenMotionPromptValue: (source, key) => source?.[key] || '',
    readStoredZip: () => files, readJsonBody: async () => ({ zipBase64: 'AAAA' }),
    getConfig: async () => ({ nsfwEnabled: false, paths: { uploads: '/virtual/uploads' } }),
    readJson: async (key, fallback) => structuredClone(db.get(key) ?? fallback),
    updateJson: (key, fallback, fn) => {
      const promise = (locks.get(key) || Promise.resolve()).then(async () => { const value = await fn(structuredClone(db.get(key) ?? fallback)); db.set(key, structuredClone(value)); return value; });
      locks.set(key, promise.catch(() => {})); return promise;
    },
    fs: { mkdir: async () => {}, readdir: async () => [], writeFile: async (name, data) => { writes.push(name); } },
    saveBuffer: async (zone, name) => { writes.push(name); return zone + '/' + name; },
    send: (_, status, value) => value, res: {}
  };
  const run = (kind, manifest) => {
    files = new Map([[kind === 'characters' ? 'character.json' : 'vocabulary.json', Buffer.from(JSON.stringify(manifest))], ['image.png', png]]);
    const start = server.indexOf(`    if (p === '/api/${kind}/import'`);
    const end = kind === 'characters' ? server.indexOf('    const exportMatch', start) : server.indexOf("    if (p === '/api/vocabulary-categories'", start);
    return vm.runInNewContext(`(async () => { ${server.slice(start, end)} })()`, { ...context, p: '/api/' + kind + '/import', req: { method: 'POST' } });
  };
  return { run, db, writes };
}

test('legacy character ZIP: concurrent repeated imports create only one character and one set of files', async () => {
  const worker = legacyRoutes();
  const manifest = { format: 'manifestador-character', version: 3, character: { name: 'Pénélope', photos: ['image.png'], variants: [{ name: 'Dress', photos: ['image.png'] }] } };
  const [a, b] = await Promise.all([worker.run('characters', manifest), worker.run('characters', manifest)]);
  assert.ok(a.id); assert.equal(b.importSkipped, true);
  assert.equal(worker.db.get('characters.json').length, 1); assert.equal(worker.writes.length, 2);
  manifest.character.name = '  PENELOPE ';
  assert.equal((await worker.run('characters', manifest)).importSkipped, true);
  assert.equal(worker.writes.length, 2);
});

test('legacy vocabulary ZIP: normalized matching skips before saving images and retains original terms', async () => {
  const worker = legacyRoutes();
  const manifest = { format: 'manifestador-vocabulary', version: 1, categories: ['Clothes'], entries: [{ title: 'Shirts', category: 'Clothes', image: 'image.png', words: ['Crop top'] }] };
  const first = await worker.run('vocabulary', manifest);
  manifest.entries[0].title = ' SHIRTS '; manifest.entries[0].words = ['Changed'];
  const second = await worker.run('vocabulary', manifest);
  assert.equal(first.imported, 1); assert.equal(second.imported, 0); assert.equal(second.skipped, 1);
  assert.equal(worker.writes.length, 1);
  assert.deepEqual([...worker.db.get('vocabulary.json')[0].words], ['Crop top']);
  assert.equal(worker.db.get('vocabulary-categories.json').length, 1);
});
