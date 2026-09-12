import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { RATING_FIELDS, changeInspiration, inspirationUrl, visibleInspiration, inspirationError } from '../lib/series-inspiration.js';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const change = (store, kind, method, id, body = {}, options = {}) => changeInspiration(store, kind, method, id, body, { now: 100, ...options });
const producer = () => change({}, 'producers', 'POST', 'p1', { name: ' Studio ', description: 'Source', url: 'https://example.com' });
const entry = () => change(producer(), 'entries', 'POST', 'e1', { title: 'Drama', producerId: 'p1', rating: 5, consistency: 4, quality: 3, continuity: 2, narrative: 1, sound: 5, tags: [' Top ', 'top', 'Romance'], url: 'https://example.com/watch' });

test('inspiration: episode count and decimal minutes are optional, validated and preserved on edits', () => {
  const original = entry();
  assert.equal(original.entries[0].episodeCount, null);
  let store = change(original, 'entries', 'PUT', 'e1', { episodeCount: 80, episodeDurationMinutes: 1.5 });
  store = change(store, 'entries', 'PUT', 'e1', { title: 'Updated' });
  assert.equal(store.entries[0].episodeCount, 80);
  assert.equal(store.entries[0].episodeDurationMinutes, 1.5);
  for (const patch of [{ episodeCount: 1.5 }, { episodeCount: -1 }, { episodeCount: 0 }, { episodeDurationMinutes: 0 }, { episodeDurationMinutes: Infinity }, { episodeDurationMinutes: '2' }]) assert.throws(() => change(store, 'entries', 'PUT', 'e1', patch), { localizationCode: 'inspirationEpisodes' });
  store = change(store, 'entries', 'PUT', 'e1', { episodeCount: null, episodeDurationMinutes: null });
  assert.equal(store.entries[0].episodeCount, null);
  assert.equal(store.entries[0].episodeDurationMinutes, null);
});

test('inspiration: stores six independent star ratings, links, tags and reusable producers', () => {
  const store = entry();
  assert.deepEqual(store.entries[0].tags, ['Top', 'Romance']);
  assert.deepEqual(RATING_FIELDS.map(field => store.entries[0][field]), [5, 4, 3, 2, 1, 5]);
  const next = change(store, 'entries', 'POST', 'e2', { title: 'Second', producerId: 'p1', description: 'Synopsis', appreciation: 'Great lighting', genre: 'Drama', imageKey: 'uploads/cover.jpg' });
  assert.equal(next.producers.length, 1);
  assert.equal(next.entries.length, 2);
  assert.equal(next.entries[0].appreciation, 'Great lighting');
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
});

test('inspiration: updates preserve creation time and producer references; delete unlinks without deleting entries', () => {
  let store = change(entry(), 'producers', 'PUT', 'p1', { name: 'New studio' }, { now: 200 });
  assert.equal(store.producers[0].ts, 100);
  assert.equal(store.producers[0].updatedAt, 200);
  assert.equal(store.entries[0].producerId, 'p1');
  store = change(store, 'entries', 'PUT', 'e1', { sound: 2 });
  assert.equal(store.entries[0].rating, 5);
  assert.equal(store.entries[0].sound, 2);
  store = change(store, 'producers', 'DELETE', 'p1');
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].producerId, '');
  assert.equal(store.producers.length, 0);
  assert.equal(change(store, 'entries', 'DELETE', 'e1').entries.length, 0);
});

test('inspiration: invalid ratings are rejected for every dimension, without mutating the store', () => {
  const store = entry(), original = JSON.stringify(store);
  for (const field of RATING_FIELDS) for (const value of [0, 6, -1, 2.5, '5', NaN, Infinity, true]) {
    assert.throws(() => change(store, 'entries', 'PUT', 'e1', { [field]: value }), { localizationCode: 'inspirationRating', status: 400 });
  }
  assert.equal(JSON.stringify(store), original);
});

test('inspiration: validates required names, unique producers and relationships', () => {
  assert.throws(() => change({}, 'entries', 'POST', 'e1', { title: ' ' }), { localizationCode: 'inspirationTitle' });
  assert.throws(() => change({}, 'producers', 'POST', 'p1', { name: '' }), { localizationCode: 'inspirationName' });
  assert.throws(() => change(producer(), 'producers', 'POST', 'p2', { name: 'studio' }), { localizationCode: 'inspirationDuplicate' });
  assert.throws(() => change({}, 'entries', 'POST', 'e1', { title: 'Drama', producerId: 'missing' }), { localizationCode: 'inspirationProducer' });
  assert.throws(() => change({}, 'entries', 'PUT', 'missing', {}), { status: 404 });
});

test('inspiration: only safe web links and local image asset keys are accepted', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/a', '//example.com', 'https://user:pass@example.com', 'garbage']) assert.throws(() => inspirationUrl(url), { localizationCode: 'inspirationUrl' });
  assert.equal(inspirationUrl(' https://example.com/watch?q=one '), 'https://example.com/watch?q=one');
  assert.equal(inspirationUrl(''), '');
  for (const key of ['uploads/../config.json', 'C:/cover.jpg', 'https://example.com/a.png', 'uploads/a.mp4', 'uploads/a.svg', 'uploads/a\\b.png']) assert.throws(() => change({}, 'entries', 'POST', 'e1', { title: 'Test', imageKey: key }), { localizationCode: 'inspirationImage' });
});

test('inspiration: NSFW filtering includes covers and associated production companies', () => {
  let store = change(entry(), 'entries', 'POST', 'e2', { title: 'Hidden', nsfw: true }, { nsfwEnabled: true });
  assert.equal(visibleInspiration(store, false).entries.length, 1);
  assert.equal(visibleInspiration(store, true).entries.length, 2);
  assert.throws(() => change(store, 'entries', 'PUT', 'e2', { title: 'Change' }), { status: 404 });
  assert.throws(() => change(store, 'entries', 'POST', 'e3', { title: 'Hidden', nsfw: true }), { status: 403 });
  store = change(store, 'entries', 'PUT', 'e1', { imageKey: 'uploads/cover.jpg' });
  assert.equal(visibleInspiration(store, false, { 'uploads/cover.jpg': { nsfw: true } }).entries.length, 0);
  store = change(store, 'producers', 'PUT', 'p1', { nsfw: true }, { nsfwEnabled: true });
  assert.deepEqual(visibleInspiration(store, false), { entries: [], producers: [] });
});

test('inspiration: all dynamically resolved labels and helper error codes exist in ES and EN', () => {
  const catalogs = ['es', 'en'].map(locale => {
    let catalog;
    vm.runInNewContext(read(`public/locales/${locale}.js`), { window: { ManifestadorI18n: { register: (_, messages) => { catalog = messages; } } } });
    return catalog;
  });
  const source = read('public/series-inspiration.js');
  const keys = [...RATING_FIELDS, ...[...source.matchAll(/(?:label|button)\('([^']+)'/g)].map(match => match[1])].map(key => 'inspiration.' + key);
  keys.push(...[...read('lib/series-inspiration.js').matchAll(/inspirationError\('([^']+)'/g)].map(match => 'errors.' + match[1]));
  for (const key of keys) for (const catalog of catalogs) assert.ok(catalog[key], key);
});

test('inspiration routes: save/reload, missing cover rollback and producer unlinking use one collection', async () => {
  const server = read('server.js');
  const source = server.slice(server.indexOf("    if (p === '/api/series-inspiration'"), server.indexOf("    if (p === '/api/series' && req.method === 'POST')"));
  let persisted = {}, id = 0;
  const run = (p, method, body = {}) => vm.runInNewContext(`(async () => { ${source} })()`, {
    p, req: { method }, res: {}, changeInspiration, visibleInspiration, inspirationError,
    readJson: async file => file === 'series-inspiration.json' ? structuredClone(persisted) : {},
    getConfig: async () => ({ nsfwEnabled: false }), readJsonBody: async () => body,
    newId: () => 'id' + ++id, send: (_, status, payload) => ({ status, payload }),
    resolveAssetKey: async key => key, fs: { stat: async key => ({ isFile: () => key !== 'uploads/missing.jpg' }) },
    updateJson: async (file, fallback, updater) => {
      assert.equal(file, 'series-inspiration.json');
      const next = await updater(structuredClone(persisted)); persisted = JSON.parse(JSON.stringify(next)); return next;
    }
  });
  const p = await run('/api/series-inspiration/producers', 'POST', { name: 'Studio' });
  const saved = await run('/api/series-inspiration/entries', 'POST', { title: 'Drama', producerId: p.payload.id, imageKey: 'uploads/cover.jpg', rating: 5 });
  const reloaded = await run('/api/series-inspiration', 'GET');
  assert.equal(reloaded.payload.entries[0].id, saved.payload.id);
  const original = JSON.stringify(persisted);
  await assert.rejects(run('/api/series-inspiration/entries/' + saved.payload.id, 'PUT', { imageKey: 'uploads/missing.jpg' }), { localizationCode: 'inspirationImage' });
  assert.equal(JSON.stringify(persisted), original);
  await run('/api/series-inspiration/producers/' + p.payload.id, 'DELETE');
  assert.equal(persisted.entries[0].producerId, '');
  assert.equal(persisted.entries.length, 1);
  await assert.rejects(run('/api/series-inspiration/entries', 'PUT', {}), { status: 404 });
});
