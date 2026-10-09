import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function sortedResolutions('), source.indexOf('function chipRow('));
const sort = vm.runInNewContext(`${helper}; sortedResolutions`);

test('resolution options ascend without mutating catalog defaults', () => {
  for (const [input, expected] of [
    [['768p', '480p', '1080p', '2k'], ['480p', '768p', '1080p', '2k']],
    [['720p', '480p', '1080p'], ['480p', '720p', '1080p']],
    [['4K', '2K', '1K'], ['1K', '2K', '4K']],
    [['1080P', '720P', '480P'], ['480P', '720P', '1080P']],
  ]) {
    const original = [...input];
    assert.deepEqual(Array.from(sort(input)), expected);
    assert.deepEqual(input, original);
  }
});
