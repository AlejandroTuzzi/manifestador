import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('public/app.js');

function setup({ limit = 12, multimedia = true, mediaLimits = { image: 9, video: 3, audio: 3 } } = {}) {
  const nodes = new Map();
  const element = () => ({ hidden: false, dataset: {}, attrs: {}, listeners: {},
    classList: { toggle() {} }, setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; }, querySelector() { return null; }
  });
  const node = (key) => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  let cards = [];
  const added = [], errors = [];
  const state = { refs: [], pickerMulti: true, pickerSelection: new Map() };
  const context = vm.createContext({
    state, $: node, $$: (selector) => selector === '#pickerBody .pick[data-key]' ? cards : [],
    tr: (key) => key, trn: (key, count) => `${count} selected`,
    activeRefLimit: () => limit, activeRefModel: () => ({ name: 'Model', mediaLimits }),
    isVideoMultimediaPicker: () => multimedia,
    referenceKind: (ref) => ref.kind || 'image',
    toast: (error) => errors.push(error), renderHighlight() {}, bindPickerAudioButtons() {},
    pickRef: (key, kind) => { state.refs.push({ key, kind }); added.push({ key, kind }); return true; }
  });
  vm.runInContext(source.slice(source.indexOf('function pickerAllowsMultiple('), source.indexOf("$('#pickerSelectionAdd').addEventListener")), context);
  context.renderPickerSelectionPreviews = () => {};
  return { context, state, added, errors, node, showCards(keys) {
    cards = keys.map((key) => Object.assign(element(), { dataset: { key, kind: key.startsWith('audio/') ? 'audio' : 'image' } }));
    context.bindPickerReferenceCards();
    return cards;
  } };
}

test('multiple references are staged across galleries, toggled and confirmed in selection order', () => {
  const { context, state, added, node, showCards } = setup();
  const [image] = showCards(['uploads/a.png']);
  image.listeners.click();
  assert.equal(state.refs.length, 0);
  assert.equal(node('#pickerModal').hidden, false);
  const [audio] = showCards(['audio/b.mp3']);
  audio.listeners.click();
  assert.equal(node('#pickerSelectionCount').textContent, '2 selected');
  const [sameImage] = showCards(['uploads/a.png']);
  assert.equal(sameImage.attrs['aria-pressed'], 'true');
  assert.equal(sameImage.dataset.selectionMark, '✓ 1');
  sameImage.listeners.click();
  assert.equal(state.pickerSelection.size, 1);
  sameImage.listeners.click();
  context.confirmPickerSelection();
  assert.deepEqual(added, [{ key: 'audio/b.mp3', kind: 'audio' }, { key: 'uploads/a.png', kind: 'image' }]);
  assert.equal(state.pickerSelection.size, 0);
  assert.equal(node('#pickerModal').hidden, true);
});

test('selection checks total, per-media and existing-reference limits before adding', () => {
  const { context, state, errors } = setup({ limit: 4, mediaLimits: { image: 2, audio: 1, video: 1 } });
  state.refs.push({ key: 'uploads/existing.png', kind: 'image' });
  assert.equal(context.selectPickerReference('uploads/existing.png'), false);
  assert.equal(errors.at(-1), 'picker.duplicateReference');
  context.selectPickerReference('audio/a.mp3', 'audio');
  assert.equal(context.selectPickerReference('audio/b.mp3', 'audio'), false);
  assert.equal(errors.at(-1), 'create.refs.mediaLimit');
  context.selectPickerReference('uploads/new.png');
  context.selectPickerReference('video/clip.mp4', 'video');
  assert.equal(context.selectPickerReference('uploads/extra.png'), false);
  assert.equal(errors.at(-1), 'create.refs.modelLimit');
  assert.equal(state.pickerSelection.size, 3);
  assert.equal(context.selectPickerReference('video/clip.mp4', 'video'), true, 'deselect remains possible at the limit');
});

test('image-only models reject audio and start/end models allow two ordered selections', () => {
  const { context, errors } = setup({ multimedia: false, limit: 2 });
  assert.equal(context.selectPickerReference('audio/a.mp3', 'audio'), false);
  assert.equal(errors.at(-1), 'create.refs.onlyImages');
  assert.equal(context.selectPickerReference('uploads/start.png'), true);
  assert.equal(context.selectPickerReference('uploads/end.png'), true);
  assert.equal(context.selectPickerReference('uploads/third.png'), false);
});

test('replacement, ComfyUI slots, style media and overlay images retain single selection', () => {
  const { context, state, added, node } = setup();
  assert.equal(context.pickerAllowsMultiple(), true);
  for (const [field, value] of [['replaceRefIndex', 0], ['comfyPickerSlot', 'slot'], ['promptStyleImagePick', true], ['overlayBgPick', true]]) {
    state[field] = value;
    assert.equal(context.pickerAllowsMultiple(), false, field);
    delete state[field];
  }
  assert.equal(setup({ limit: 1 }).context.pickerAllowsMultiple(), false);
  state.pickerMulti = false;
  context.selectPickerReference('uploads/one.png');
  assert.equal(added.length, 1);
  assert.equal(node('#pickerModal').hidden, true);
});

test('keyboard selection ignores the nested playback button and never replaces media nodes', () => {
  const { context, state, showCards } = setup();
  const [card] = showCards(['audio/a.mp3']);
  let prevented = false;
  card.innerHTML = 'original media node';
  card.listeners.keydown({ target: {}, key: ' ', preventDefault() { throw new Error('nested control intercepted'); } });
  assert.equal(state.pickerSelection.size, 0);
  card.listeners.keydown({ target: card, key: ' ', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(state.pickerSelection.size, 1);
  context.syncPickerSelection();
  assert.equal(card.innerHTML, 'original media node');
});

test('failed additions remain selected so they can be corrected without losing the batch', () => {
  const { context, state, node } = setup();
  context.selectPickerReference('uploads/fail.png');
  context.pickRef = () => false;
  context.confirmPickerSelection();
  assert.equal(state.pickerSelection.size, 1);
  assert.equal(node('#pickerModal').hidden, false);
});

test('newly uploaded files join the draft selection until confirmation', async () => {
  const { context, state, added, node } = setup();
  let counter = 0;
  Object.assign(context, {
    isPromptLoraMediaPicker: () => false, referenceFileKind: () => 'image',
    readFileAsDataUrl: async () => 'data:image/png;base64,AA==',
    currentVideoModel: () => ({ id: 'test' }),
    api: async () => ({ key: `uploads/${++counter}.png` }),
    refreshAssets() { throw new Error('main gallery must not be rebuilt'); }
  });
  vm.runInContext(source.slice(source.indexOf('async function uploadFiles('), source.indexOf('function isCreateViewActive(')), context);
  await context.uploadFiles([{ name: 'one.png', size: 10 }, { name: 'two.png', size: 10 }], true);
  assert.equal(state.pickerSelection.size, 2);
  assert.equal(state.pickerSelection.get('uploads/1.png').name, 'one.png');
  assert.equal(added.length, 0);
  assert.equal(node('#pickerModal').hidden, false);
  context.confirmPickerSelection();
  assert.equal(added.length, 2);
});

test('audio playback has a small target positioned at the exact thumbnail center', () => {
  const css = read('public/style.css');
  const button = css.match(/\.picker-grid \.picker-audio-play \{([^}]+)\}/)[1];
  assert.match(button, /top: 50%; left: 50%; transform: translate\(-50%, -50%\)/);
  assert.match(button, /width: 30px; height: 30px/);
  assert.doesNotMatch(source, /class="picker-audio-select"/);
});
