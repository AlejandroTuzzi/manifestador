import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('public/asset-editor.js');
function setup() {
  const nodes = new Map(), requests = [], drawings = [];
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, { listeners: {}, value: '0', hidden: true,
      addEventListener(type, fn) { this.listeners[type] = fn; }, click() {},
      getContext: () => ({ drawImage: (...args) => drawings.push(args), fillRect() {}, strokeRect() {} }) });
    return nodes.get(key);
  };
  const state = { assets: { uploads: [] }, characters: [], elements: [] };
  const context = vm.createContext({
    $: node, state, tr: (key) => key, toast() {}, fileUrl: (key) => `/files/${key}`,
    closeLightbox() {}, readFileAsDataUrl: async () => 'data:image/png;base64,AAAA',
    document: { createElement: () => ({ getContext: () => ({ drawImage: (...args) => drawings.push(args) }), toBlob: (callback) => callback({}) }), documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#ec4899' }),
    api: async (url, options) => { requests.push({ url, options }); return { key: 'uploads/copy.png', name: 'copy.png' }; }
  });
  vm.runInContext(source, context);
  return { context, node, state, requests, drawings };
}

test('crop rectangles stay within source pixels and never have zero dimensions', () => {
  const { context } = setup();
  const normalize = (rect) => JSON.parse(JSON.stringify(context.normalizeAssetCrop(rect, 100, 80)));
  assert.deepEqual(normalize({ x: -10, y: 90, width: 400, height: 0 }), { x: 0, y: 79, width: 100, height: 1 });
  assert.deepEqual(normalize({ x: NaN, y: Infinity, width: NaN, height: 40 }), { x: 0, y: 0, width: 100, height: 40 });
  for (const end of [{ x: 80, y: 60 }, { x: 5, y: 5 }]) {
    const rect = context.assetCropFromPoints({ x: 40, y: 40 }, end, 100, 80, 1);
    assert.equal(rect.width, rect.height);
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 100);
    assert.ok(rect.y >= 0 && rect.y + rect.height <= 80);
  }
});

test('saving crops uses source pixel coordinates, preserves classification and creates a copy', async () => {
  const { context, node, state, requests, drawings } = setup();
  context.sourceImage = { naturalWidth: 100, naturalHeight: 80 };
  vm.runInContext("Object.assign(assetEdit, { image: sourceImage, key: 'uploads/original.png', rect: {x: 10, y: 20, width: 30, height: 40}, metadata: { nsfw: true, category: 'Style', tags: ['portrait'] } });", context);
  await node('#assetEditorSave').listeners.click();
  assert.equal(drawings[0][0], context.sourceImage);
  assert.deepEqual(drawings[0].slice(1), [10, 20, 30, 40, 0, 0, 30, 40]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/assets/visual');
  assert.equal(requests[0].options.body.name, 'original_crop.png');
  assert.equal(requests[0].options.body.nsfw, true);
  assert.equal(requests[0].options.body.category, 'Style');
  assert.deepEqual(Array.from(requests[0].options.body.tags), ['portrait']);
  assert.equal(state.assets.uploads[0].key, 'uploads/copy.png');
  assert.equal(vm.runInContext('assetEdit.key', context), 'uploads/original.png');
  assert.equal(node('#assetEditorResult').hidden, false);
});

test('excessively large crops are rejected before canvas allocation or upload', async () => {
  const { context, node, requests, drawings } = setup();
  vm.runInContext("Object.assign(assetEdit, { image: {}, rect: {width: 10000, height: 10000} });", context);
  await node('#assetEditorSave').listeners.click();
  assert.equal(requests.length, 0);
  assert.equal(drawings.length, 0);
  assert.equal(node('#assetEditorStatus').textContent, 'assetEditor.tooLarge');
  assert.equal(node('#assetEditorFields').disabled, false);
});

test('editor integrates navigation, viewer entry, single-image picker and startup scripts', () => {
  const html = read('public/index.html'), app = read('public/app.js');
  assert.match(html, /data-view="asset-editor"/);
  assert.match(html, /id="view-asset-editor"/);
  assert.match(app, /id="lbEditAsset"/);
  assert.match(app, /openAssetEditor\(key\)/);
  assert.ok(html.indexOf('src="app-core.js"') < html.indexOf('src="asset-editor.js"'));
  assert.ok(html.indexOf('src="asset-editor.js"') < html.indexOf('src="app.js"'));
});
