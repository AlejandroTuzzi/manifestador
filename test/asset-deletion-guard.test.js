import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { protectedAssetKeys, protectedAssetAssociations } from '../lib/asset-deletion-guard.js';

test('character and location associations protect assets, including hidden entities and variants', () => {
  const data = {
    characterLinks: [{ characterId: 'c', variantId: 'v', key: 'video/linked.mp4' }],
    elementLinks: [{ elementId: 'l', key: 'uploads/location.png' }, { elementId: 'o', key: 'uploads/object.png' }],
    characters: [{ id: 'c', nsfw: true, photos: ['uploads/photo.png'], heygen: { imageKey: 'uploads/mirror.png' }, variants: [{ sheet: 'uploads/sheet.png', photos: ['uploads/variant.png'], distinctiveElements: [{ imageKey: 'uploads/ring.png' }] }] }],
    elements: [{ id: 'l', kind: 'location', variants: [{ photos: ['uploads/location-variant.png'] }] }, { id: 'o', kind: 'object' }]
  };
  const protectedKeys = ['video/linked.mp4', 'uploads/location.png', 'uploads/photo.png', 'uploads/mirror.png', 'uploads/sheet.png', 'uploads/variant.png', 'uploads/ring.png', 'uploads/location-variant.png'];
  assert.deepEqual(protectedAssetKeys([...protectedKeys, 'uploads/object.png', 'uploads/free.png'], data), protectedKeys);
  assert.deepEqual(protectedAssetKeys(['uploads/./PHOTO.png'], data), ['uploads/./PHOTO.png']);
  assert.deepEqual(protectedAssetKeys(['uploads/photo.png'], {}), []);
});

test('bulk deletion fails before unlink or metadata changes when any asset is protected', async () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf("    if (p === '/api/assets/delete'");
  const end = source.indexOf('      const removed = new Set(allowed);', start);
  const route = source.slice(start, end) + '\n}';
  const unlinked = [];
  const context = {
    p: '/api/assets/delete', req: { method: 'POST' },
    readJsonBody: async () => ({ keys: ['uploads/free.png', 'uploads/linked.png'] }),
    resolveAssetKey: async key => key,
    fs: { unlink: async key => { unlinked.push(key); } },
    assertAssetsDeletable: async keys => {
      if (protectedAssetKeys(keys, { characterLinks: [{ key: 'uploads/linked.png', characterId: 'c' }] }).length) throw Object.assign(new Error('blocked'), { status: 409 });
    }
  };
  await assert.rejects(vm.runInNewContext(`(async () => { ${route} })()`, context), { status: 409 });
  assert.deepEqual(unlinked, []);
  context.assertAssetsDeletable = async () => {};
  await vm.runInNewContext(`(async () => { ${route} })()`, context);
  assert.deepEqual(unlinked, ['uploads/free.png', 'uploads/linked.png']);
});

test('server guard reads all associations without applying visibility filters; cleanup uses the guard too', async () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('async function assetDeletionConflicts('), source.indexOf('async function updateJson('));
  const context = {
    protectedAssetKeys, protectedAssetAssociations, getConfig: async () => ({ nsfwEnabled: false }),
    readJson: async (file, fallback) => file === 'element-links.json' ? [{ elementId: 'hidden', key: 'uploads/hidden.png' }] : fallback,
    localizedServerError: code => Object.assign(new Error(code), { localizationCode: code })
  };
  await assert.rejects(vm.runInNewContext(`(async () => { ${helpers}; await assertAssetsDeletable(['uploads/hidden.png']); })()`, context), { status: 409, localizationCode: 'assetAssociatedDeletion' });
  assert.match(source, /await assertAssetsDeletable\(plan\.deletable\.map/);
  assert.equal((source.match(/await assetDeletionConflicts\(\[key\]\)/g) || []).length, 2);
});

test('blocking details identify names and variants, while hidden entities remain private', () => {
  const data = { characters: [{ id: 'c', name: 'Observador', variants: [{ id: 'v', name: 'Traje', photos: ['uploads/a.png'] }] }], elementLinks: [{ elementId: 'l', key: 'uploads/a.png' }], elements: [{ id: 'l', name: 'Palacio', kind: 'location', nsfw: true }] };
  const result = protectedAssetAssociations(['uploads/a.png'], data)[0];
  assert.ok(result.associations.some(link => link.name === 'Observador' && link.variantName === 'Traje'));
  assert.ok(result.associations.some(link => link.kind === 'location' && link.hidden && !link.name));
  assert.ok(protectedAssetAssociations(['uploads/a.png'], { ...data, nsfwEnabled: true })[0].associations.some(link => link.name === 'Palacio'));
});

test('deleteAssets catches the rejection, shows the warning and preserves the selection', async () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function deleteAssets(keys)'), source.indexOf('async function duplicateAssets(keys)'));
  const warnings = [], notices = [], selectedAssets = new Set(['uploads/a.png']);
  const error = Object.assign(new Error('Blocked'), { code: 'assetAssociatedDeletion', details: { assets: [] } });
  const context = { confirm: () => true, trn: () => '', api: async () => { throw error; }, showAssetDeletionWarning: value => warnings.push(value), toast: value => notices.push(value), state: { selectedAssets } };
  assert.equal(await vm.runInNewContext(`${code}; deleteAssets(['uploads/a.png']);`, context), false);
  assert.equal(warnings[0], error); assert.equal(selectedAssets.size, 1);
  context.api = async () => { throw new Error('Network error'); };
  await vm.runInNewContext(`${code}; deleteAssets(['uploads/a.png']);`, context);
  assert.deepEqual(notices, ['Network error']);
});

test('warning renders the exact translated association message safely above the viewer', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function showAssetDeletionWarning('), source.indexOf('async function deleteAssets(keys)'));
  let catalog;
  vm.runInNewContext(fs.readFileSync(new URL('../public/locales/es.js', import.meta.url), 'utf8'), { window: { ManifestadorI18n: { register: (_, entries) => { catalog = entries; } } } });
  const button = { focus() {} }, modal = { querySelector: () => button };
  const context = { $: () => modal, document: { activeElement: button }, esc: text => String(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;'), tr: (key, args = {}) => (catalog[key] || key).replace('{name}', args.name) };
  vm.runInNewContext(`${code}; showAssetDeletionWarning({ message: 'Bloqueado', details: { assets: [{ key: 'uploads/a.png', associations: [{ kind: 'character', name: 'Observador <X>', variantName: 'Traje' }] }] } });`, context);
  assert.equal(modal.hidden, false);
  assert.match(modal.innerHTML, /Este asset no se puede eliminar porque está asociado al personaje Observador &lt;X&gt;\./);
  button.onclick(); assert.equal(modal.hidden, true);
});
