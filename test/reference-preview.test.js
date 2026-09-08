import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

// Small DOM double for node identity and event tests; no browser or media decode.
class Element {
  constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.nodes = new Map(); this.writes = 0; this.insertions = 0; }
  set innerHTML(value) { this.markup = value; this.writes++; }
  get innerHTML() { return this.markup; }
  querySelector(selector) {
    if (selector === '.ref-audio-play' && !this.markup?.includes('ref-audio-play')) return null;
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  setAttribute(name, value) { this[name] = value; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  insertBefore(child, next) { child.remove(); const index = next ? this.children.indexOf(next) : this.children.length; this.children.splice(index, 0, child); child.parent = this; this.insertions++; }
}

function setup() {
  const root = new Element();
  const state = { pickerMulti: true, pickerSelection: new Map() };
  const played = [];
  const context = vm.createContext({
    state, $: () => root, document: { createElement: () => new Element() },
    i18n: { formatNumber: String }, esc: (text) => String(text).replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    fileUrl: (key) => `/files/${key}`, IC: (name) => name, tr: (key, values) => `${key}: ${values.name}`,
    pickerAudioKey: '', stopPickerAudioPreview() {}, syncReferenceAudioButtons() {},
    togglePickerAudio: (key) => played.push(key),
    selectPickerReference: (key) => { state.pickerSelection.delete(key); context.renderPickerSelectionPreviews(); }
  });
  vm.runInContext(app.slice(app.indexOf('function renderPickerSelectionPreviews('), app.indexOf('function bindPickerReferenceCards(')), context);
  return { root, state, context, played };
}

test('accumulated references display original filenames, image/video previews and removable audio', () => {
  const { root, state, context, played } = setup();
  for (const ref of [{ key: 'uploads/1.png', kind: 'image', name: 'Photo.png' },
    { key: 'video/2.mp4', kind: 'video', name: 'Clip.mp4' }, { key: 'audio/3.wav', kind: 'audio', name: 'Voice.wav' }]) state.pickerSelection.set(ref.key, ref);
  context.renderPickerSelectionPreviews();
  assert.equal(root.hidden, false);
  assert.equal(root.children.length, 3);
  assert.match(root.children[0].innerHTML, /<img .*Photo.png/);
  assert.match(root.children[1].innerHTML, /<video .*preload="metadata"/);
  const audio = root.children[2];
  assert.equal(audio.title, 'Voice.wav');
  assert.equal(audio.querySelector('.picker-selected-order').textContent, '3');
  audio.querySelector('.ref-audio-play').listeners.click();
  assert.deepEqual(played, ['audio/3.wav']);
  audio.querySelector('.picker-selected-remove').listeners.click();
  assert.equal(state.pickerSelection.has('audio/3.wav'), false);
  assert.equal(root.children.length, 2);
});

test('updating selection reuses media nodes without reassigning markup or moving unchanged cards', () => {
  const { root, state, context } = setup();
  state.pickerSelection.set('video/1.mp4', { key: 'video/1.mp4', kind: 'video' });
  context.renderPickerSelectionPreviews();
  const original = root.children[0];
  context.renderPickerSelectionPreviews();
  assert.equal(root.insertions, 1);
  state.pickerSelection.set('uploads/2.png', { key: 'uploads/2.png', kind: 'image' });
  context.renderPickerSelectionPreviews();
  assert.equal(root.children[0], original);
  assert.equal(original.writes, 1);
  assert.equal(root.insertions, 2);
  state.pickerSelection.clear();
  context.renderPickerSelectionPreviews();
  assert.equal(root.children.length, 0);
  assert.equal(root.hidden, true);
});
