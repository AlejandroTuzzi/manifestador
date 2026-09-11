import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createPhotoIdentityCache, uniqueCharacterGallery } from '../lib/character-gallery.js';

test('gallery deduplicates identical copies across original and outfits without changing associations', async () => {
  const character = { description: 'A character', photos: ['original/a.png', 'original/a.png'], variants: [
    { id: 'gala', name: 'Gala', photos: ['gala/copy.png', 'gala/b.png'] },
    { id: 'casual', name: 'Casual', photos: ['original/a.png', 'casual/copy.png'] }
  ] };
  const snapshot = structuredClone(character), calls = [];
  const groups = await uniqueCharacterGallery(character, async (key) => { calls.push(key); return key.endsWith('/b.png') ? 'image-b' : 'image-a'; });
  assert.deepEqual(groups.map((group) => group.photos.map((photo) => photo.key)), [['original/a.png'], ['gala/b.png']]);
  assert.deepEqual(groups[0].photos[0].groups.map((group) => group.id), [null, 'gala', 'casual']);
  assert.equal(calls.filter((key) => key === 'original/a.png').length, 1);
  assert.deepEqual(character, snapshot);
});

test('distinct images are retained, empty galleries work and hidden outfits do not leak memberships', async () => {
  const character = { photos: ['a.png'], variants: [{ id: 'hidden', name: 'Hidden', nsfw: true, photos: ['a.png', 'b.png'] }] };
  const groups = await uniqueCharacterGallery(character, async (key) => key);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].photos[0].groups.length, 1);
  const visible = await uniqueCharacterGallery(character, async (key) => key, { nsfwEnabled: true });
  assert.equal(visible.flatMap((group) => group.photos).length, 2);
  assert.equal(visible[0].photos[0].groups.length, 2);
  assert.equal((await uniqueCharacterGallery({}, async (key) => key))[0].photos.length, 0);
});

test('file identity detects copies with different names and invalidates changed files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'manifestador-gallery-test-'));
  try {
    await fs.writeFile(path.join(folder, 'one.png'), 'image bytes');
    await fs.writeFile(path.join(folder, 'two.png'), 'image bytes');
    const identify = createPhotoIdentityCache((key) => path.join(folder, key), { maxEntries: 2 });
    const first = await identify('one.png');
    assert.equal(await identify('two.png'), first);
    assert.equal(await identify('one.png'), first);
    await fs.writeFile(path.join(folder, 'one.png'), 'different image bytes');
    assert.notEqual(await identify('one.png'), first);
    assert.equal(await identify('two.png'), first);
    assert.equal(await identify('missing.png'), 'key:missing.png');
    assert.notEqual(await identify('missing.png'), await identify('another-missing.png'));
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('gallery rendering and lightbox navigation both use the unique photos', async () => {
  const source = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const nodes = new Map(), buttons = [];
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, innerHTML: '', querySelectorAll: () => buttons });
    return nodes.get(id);
  };
  let lightbox;
  buttons.push({ dataset: { galleryPhoto: 'copy.png' }, addEventListener(_type, handler) { this.click = handler; } });
  const context = vm.createContext({
    state: { characters: [{ id: 'a', name: 'Character A' }, { id: 'b', name: 'Character B' }] },
    $: node, esc: (value) => value, tr: (key) => key, trn: (_key, count) => String(count), fileUrl: (key) => key,
    openLightbox: (_key, keys) => { lightbox = Array.from(keys); },
    api: async () => ({ groups: [{ id: null, photos: [{ key: 'copy.png', groups: [{ id: null }, { id: 'gala', name: 'Gala' }] }] }] })
  });
  vm.runInContext(source.slice(source.indexOf('let characterGalleryRequest ='), source.indexOf('function openCharacterAssets(')), context);
  await context.openCharacterGallery('a');
  assert.equal((node('#characterGalleryBody').innerHTML.match(/data-gallery-photo=/g) || []).length, 1);
  assert.match(node('#characterGalleryBody').innerHTML, /picker.original · Gala/);
  buttons[0].click();
  assert.deepEqual(lightbox, ['copy.png']);
  const pending = [];
  context.api = () => new Promise((resolve) => pending.push(resolve));
  const first = context.openCharacterGallery('a'), second = context.openCharacterGallery('b');
  pending[1]({ groups: [] });
  await second;
  pending[0]({ groups: [{ id: 'stale', name: 'Stale', photos: [] }] });
  await first;
  assert.doesNotMatch(node('#characterGalleryBody').innerHTML, /Stale/);
  assert.equal(node('#characterGalleryTitle').textContent, 'Character B');
});
