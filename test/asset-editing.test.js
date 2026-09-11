import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('public/asset-editor.js');
function setup() {
  const nodes = new Map(), requests = [], drawings = [];
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, { listeners: {}, value: '0', hidden: true, style: {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
      setPointerCapture(id) { this.capture = id; }, hasPointerCapture(id) { return this.capture === id; },
      releasePointerCapture() { this.capture = null; },
      addEventListener(type, fn) { this.listeners[type] = fn; }, click() {}, focus() {},
      getContext: () => ({ drawImage: (...args) => drawings.push(args), clearRect() {}, fillRect() {}, strokeRect() {} }) });
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

test('crop hit testing distinguishes all handles, edges, interior and outside', () => {
  const { context } = setup();
  const rect = { x: 200, y: 200, width: 400, height: 300 };
  for (const [mode, x, y] of context.assetCropHandles(rect)) {
    assert.equal(context.assetCropHitTest(rect, { x, y }, 10, 10), mode);
  }
  assert.equal(context.assetCropHitTest(rect, { x: 300, y: 205 }, 10, 10), 'n');
  assert.equal(context.assetCropHitTest(rect, { x: 400, y: 350 }, 10, 10), 'move');
  assert.equal(context.assetCropHitTest(rect, { x: 100, y: 100 }, 10, 10), 'draw');
  // A larger tolerance in source pixels keeps small previews easy to grab.
  assert.equal(context.assetCropHitTest(rect, { x: 225, y: 200 }, 40, 40), 'nw');
});

test('moving crops preserves size and resizing keeps the opposite edges anchored', () => {
  const { context } = setup();
  const rect = { x: 200, y: 200, width: 400, height: 300 };
  const adjust = (mode, dx, dy) => JSON.parse(JSON.stringify(context.adjustAssetCrop(rect, mode, dx, dy, 1000, 800)));
  assert.deepEqual(adjust('move', 10000, -10000), { x: 600, y: 0, width: 400, height: 300 });
  assert.deepEqual(adjust('move', 13, -7), { x: 213, y: 193, width: 400, height: 300 });
  for (const mode of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
    for (const delta of [-10000, -15, 15, 10000]) {
      const r = adjust(mode, delta, delta);
      assert.ok(r.width >= 1 && r.height >= 1);
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1000 && r.y + r.height <= 800);
      assert.equal(mode.includes('w') ? r.x + r.width : r.x, mode.includes('w') ? 600 : 200);
      assert.equal(mode.includes('n') ? r.y + r.height : r.y, mode.includes('n') ? 500 : 200);
    }
  }
});

test('all resize handles preserve the selected aspect ratio within pixel rounding', () => {
  const { context } = setup();
  for (const ratio of [1, 16 / 9, 9 / 16, 4 / 3]) {
    const rect = { x: 200, y: 200, width: Math.round(180 * ratio), height: 180 };
    for (const mode of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
      for (const [dx, dy] of [[-10000, -10000], [10000, 10000], [-17, 23], [23, -17], [0, 47], [47, 0]]) {
        const r = context.adjustAssetCrop(rect, mode, dx, dy, 1000, 800, ratio);
        assert.ok(r.width >= 1 && r.height >= 1);
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1000 && r.y + r.height <= 800);
        assert.ok(Math.abs(r.width - r.height * ratio) <= (1 + ratio) / 2 + 0.001, `${mode}: ${JSON.stringify(r)} at ${ratio}`);
        if (mode.includes('w')) assert.ok(Math.abs(r.x + r.width - rect.x - rect.width) <= 1);
        if (mode.includes('e')) assert.equal(r.x, rect.x);
        if (mode.includes('n')) assert.ok(Math.abs(r.y + r.height - rect.y - rect.height) <= 1);
        if (mode.includes('s')) assert.equal(r.y, rect.y);
        if (mode === 'w' || mode === 'e') assert.ok(Math.abs(r.y + r.height / 2 - rect.y - rect.height / 2) <= 1);
        if (mode === 'n' || mode === 's') assert.ok(Math.abs(r.x + r.width / 2 - rect.x - rect.width / 2) <= 1);
      }
    }
  }
});

test('pointer interactions move, resize, redraw and release capture without secondary pointer interference', () => {
  const { context, node } = setup();
  vm.runInContext('Object.assign(assetEdit, { image: {naturalWidth:1000,naturalHeight:800}, rect: {x:200,y:200,width:400,height:300} });', context);
  const canvas = node('#assetEditorCanvas');
  const fire = (type, x, y, extra = {}) => canvas.listeners[type]({ currentTarget: canvas, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, preventDefault() {}, ...extra });
  const rect = () => JSON.parse(vm.runInContext('JSON.stringify(assetEdit.rect)', context));
  fire('pointerdown', 400, 350);
  assert.equal(canvas.style.cursor, 'move');
  assert.equal(canvas.capture, 1);
  fire('pointermove', 900, 600, { pointerId: 2 });
  assert.equal(rect().x, 200);
  fire('pointermove', 413, 343);
  assert.deepEqual(rect(), { x: 213, y: 193, width: 400, height: 300 });
  assert.equal(node('#assetCropX').value, 213);
  fire('pointerup', 420, 340);
  assert.deepEqual(rect(), { x: 220, y: 190, width: 400, height: 300 });
  assert.equal(canvas.capture, null);
  fire('pointerdown', 620, 490);
  assert.equal(canvas.style.cursor, 'nwse-resize');
  fire('pointermove', 630, 510);
  assert.deepEqual(rect(), { x: 220, y: 190, width: 410, height: 320 });
  fire('pointercancel', 630, 510);
  fire('pointermove', 900, 600);
  assert.equal(rect().width, 410);
  fire('pointerdown', 300, 300, { shiftKey: true });
  fire('pointerup', 400, 400);
  assert.deepEqual(rect(), { x: 300, y: 300, width: 100, height: 100 });
  vm.runInContext('assetEdit.saving = true', context);
  fire('pointerdown', 350, 350);
  assert.equal(canvas.capture, null);
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

function loadEditorFixture(context, cropped = true) {
  vm.runInContext(`Object.assign(assetEdit, { image: {naturalWidth:100,naturalHeight:80}, key:'uploads/original.png', rect: {x:0,y:0,width:${cropped ? 50 : 100},height:80} });`, context);
}

test('closing an unchanged image clears the editor without prompting or saving', async () => {
  const { context, node, requests } = setup();
  loadEditorFixture(context, false);
  assert.equal(context.assetEditorHasChanges(), false);
  const request = vm.runInContext('assetEdit.request', context);
  assert.equal(await context.closeAssetEditor(), true);
  assert.equal(vm.runInContext('assetEdit.image', context), null);
  assert.equal(vm.runInContext('assetEdit.request', context), request + 1);
  assert.equal(node('#assetEditorConfirm').hidden, true);
  assert.equal(node('#assetEditorEmpty').hidden, false);
  assert.equal(node('#assetEditorCanvas').hidden, true);
  assert.equal(node('#assetEditorClose').hidden, true);
  assert.equal(node('#assetEditorFields').disabled, true);
  assert.equal(requests.length, 0);
});

test('unsaved close can be cancelled or discarded without uploading or deleting the source', async () => {
  const { context, node, requests } = setup();
  loadEditorFixture(context);
  let closing = context.closeAssetEditor();
  assert.equal(node('#assetEditorConfirm').hidden, false);
  node('#assetEditorKeepEditing').listeners.click();
  assert.equal(await closing, false);
  assert.equal(vm.runInContext('assetEdit.key', context), 'uploads/original.png');
  assert.equal(context.assetEditorHasChanges(), true);
  closing = context.closeAssetEditor();
  node('#assetEditorDiscard').listeners.click();
  assert.equal(await closing, true);
  assert.equal(vm.runInContext('assetEdit.image', context), null);
  assert.equal(requests.length, 0);
});

test('save from the close confirmation persists a copy before clearing the editor', async () => {
  const { context, node, requests, state } = setup();
  loadEditorFixture(context);
  const closing = context.closeAssetEditor();
  await node('#assetEditorConfirmSave').listeners.click();
  assert.equal(await closing, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.body.name, 'original_crop.png');
  assert.equal(state.assets.uploads[0].key, 'uploads/copy.png');
  assert.equal(vm.runInContext('assetEdit.image', context), null);
  assert.equal(node('#assetEditorConfirm').hidden, true);
});

test('failed save keeps the confirmation and edits open, allowing retry', async () => {
  const { context, node } = setup();
  loadEditorFixture(context);
  const workingApi = context.api;
  context.api = async () => { throw new Error('Upload failed'); };
  const closing = context.closeAssetEditor();
  await node('#assetEditorConfirmSave').listeners.click();
  assert.equal(node('#assetEditorConfirm').hidden, false);
  assert.equal(node('#assetEditorConfirmError').textContent, 'Upload failed');
  assert.equal(node('#assetEditorConfirmSave').disabled, false);
  assert.equal(vm.runInContext('assetEdit.key', context), 'uploads/original.png');
  assert.equal(context.assetEditorHasChanges(), true);
  context.api = workingApi;
  await node('#assetEditorConfirmSave').listeners.click();
  assert.equal(await closing, true);
});

test('saving updates the clean snapshot; further edits become dirty and reverting clears it', async () => {
  const { context, node, requests } = setup();
  loadEditorFixture(context);
  assert.equal(await context.saveAssetEditor(), true);
  assert.equal(context.assetEditorHasChanges(), false);
  vm.runInContext('assetEdit.rect.width = 40; drawAssetCrop();', context);
  assert.equal(context.assetEditorHasChanges(), true);
  assert.equal(node('#assetEditorDirty').hidden, false);
  vm.runInContext('assetEdit.rect.width = 50; drawAssetCrop();', context);
  assert.equal(context.assetEditorHasChanges(), false);
  assert.equal(node('#assetEditorDirty').hidden, true);
  await node('#assetEditorSaveClose').listeners.click();
  assert.equal(requests.length, 1, 'Save and close must not duplicate an already saved crop');
  assert.equal(vm.runInContext('assetEdit.image', context), null);
});

test('save and close creates a copy even for an untouched selection and stays open on failure', async () => {
  const { context, node, requests } = setup();
  loadEditorFixture(context, false);
  await node('#assetEditorSaveClose').listeners.click();
  assert.equal(requests.length, 1);
  assert.equal(vm.runInContext('assetEdit.image', context), null);
  loadEditorFixture(context);
  context.api = async () => { throw new Error('Upload failed'); };
  await node('#assetEditorSaveClose').listeners.click();
  assert.equal(vm.runInContext('assetEdit.key', context), 'uploads/original.png');
  assert.equal(context.assetEditorHasChanges(), true);
});

test('pending saves block closing and image replacement; cancelled replacements preserve edits', async () => {
  const { context, node } = setup();
  loadEditorFixture(context);
  let finishUpload;
  context.api = () => new Promise((resolve) => { finishUpload = resolve; });
  const saving = context.saveAssetEditor();
  assert.equal(await context.closeAssetEditor(), false);
  await context.openAssetEditor('uploads/another.png');
  assert.equal(vm.runInContext('assetEdit.key', context), 'uploads/original.png');
  finishUpload({ key: 'uploads/copy.png' });
  await saving;
  vm.runInContext('assetEdit.rect.width = 40', context);
  const opening = context.openAssetEditor('uploads/another.png');
  assert.equal(node('#assetEditorConfirm').hidden, false);
  const repeatedClose = await context.closeAssetEditor();
  assert.equal(repeatedClose, false);
  node('#assetEditorKeepEditing').listeners.click();
  await opening;
  assert.equal(vm.runInContext('assetEdit.key', context), 'uploads/original.png');
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
