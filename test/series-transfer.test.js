import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSeriesArchive, parseSeriesArchive, planSeriesImport, validSeriesAsset } from '../lib/series-transfer.js';
const source = { id:'series1', title:'Story', characterIds:['char1'], assetKeys:['uploads/a.png'] };
const characters = [{ id:'char1', name:'Person', photos:['uploads/a.png'], variants:[] }];
const scripts = [{ id:'script1', title:'Pilot', seriesId:'series1', scenes:[] }];
const read = async () => Buffer.from('image');
const empty = () => ({ series:[], characters:[], scripts:[], metadata:{} });
const missing = async () => { throw new Error('missing'); };
let id = 0; const newId = () => 'new' + ++id;
async function archive() { return new Map((await exportSeriesArchive(source, characters, scripts, {}, read)).map(file => [file.name,file.data])); }
test('series round trip remaps linked characters and scripts and repeated imports do not duplicate', async () => {
  const files = await archive(), manifest = parseSeriesArchive(files);
  const first = await planSeriesImport(empty(), manifest, files, missing, newId);
  assert.equal(first.writes.length,1);
  assert.equal(first.series.characterIds[0],first.characters[0].id);
  assert.equal(first.scripts[0].seriesId,first.series.id);
  const second = await planSeriesImport({ ...first, series:[first.series] }, manifest, files, read, newId);
  assert.equal(second.series.id,first.series.id);
  assert.equal(second.characters.length,1);
  assert.equal(second.scripts.length,1);
  assert.equal(second.writes.length,0);
});
test('same asset path is replaced, while identical assets under another path are reused', async () => {
  const files = await archive(), manifest = parseSeriesArchive(files);
  const replaced = await planSeriesImport(empty(), manifest, files, async () => Buffer.from('old'), newId);
  assert.equal(replaced.writes[0].key,'uploads/a.png');
  const current = empty(); current.metadata['uploads/local.png'] = {};
  const reused = await planSeriesImport(current, manifest, files, async key => key === 'uploads/local.png' ? read() : missing(), newId);
  assert.equal(reused.writes.length,0);
  assert.deepEqual(reused.series.assetKeys,['uploads/local.png']);
  assert.deepEqual(reused.characters[0].photos,['uploads/local.png']);
});
test('rejects unsafe paths, missing media and corrupted media before importing', async () => {
  for (const key of ['uploads/../config.json','uploads/a.html','uploads/a:stream.png','uploads/./a.png']) assert.equal(validSeriesAsset(key),false);
  const files = await archive();
  const media = [...files.keys()].find(key => key.startsWith('assets/'));
  files.set(media,Buffer.from('corrupt'));
  assert.throws(() => parseSeriesArchive(files), { localizationCode:'seriesTransfer' });
  files.delete(media);
  assert.throws(() => parseSeriesArchive(files), { localizationCode:'seriesTransfer' });
});
