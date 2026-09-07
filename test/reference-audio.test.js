import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function setup() {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }, setAttribute(name, value) { this[name] = value; } });
    return nodes.get(id);
  };
  const events = {};
  const audio = Object.assign(node('#assetPlayerAudio'), {
    paused: true, ended: false, src: '', loads: 0,
    load() { this.loads++; },
    play() { this.paused = false; this.ended = false; events.play?.(); return Promise.resolve(); },
    pause() { this.paused = true; events.pause?.(); },
    removeAttribute(name) { this[name] = ''; },
    addEventListener(name, callback) { events[name] = callback; }
  });
  const buttons = ['audio/one.mp3', 'audio/two.wav'].map((key) => Object.assign(node(key), { dataset: { refAudioKey: key } }));
  const preview = Object.assign(node('preview'), { dataset: { refAudioKey: 'audio/one.mp3' } });
  const toasts = [];
  const context = vm.createContext({
    $: node, $$: (selector) => selector === '.ref-audio-play' ? [...buttons, preview] : selector === '#pickerBody .picker-audio-play' ? [preview] : [],
    state: { assets: { audio: [] }, refs: [], mode: 'video' },
    document: { body: { classList: { add() {}, remove() {} } } },
    IC: (name) => name, tr: (key) => key, esc: (text) => text, fileUrl: (key) => `/files/${key}`,
    sbAudioName: (key) => key, AUDIO_KIND_LABELS: { voice: 'Voice' },
    toast: (...args) => toasts.push(args), activeRefModel: () => null,
    referenceKind: () => 'audio'
  });
  vm.runInContext(source.slice(source.indexOf("const assetAudioPlayer ="), source.indexOf('// Photoshop: vigilancia')), context);
  vm.runInContext(source.slice(source.indexOf('function renderRefs()'), source.indexOf('function addRef(')), context);
  vm.runInContext(source.slice(source.indexOf('function pickerAudioPreviewHtml('), source.indexOf('function renderEntityPicker(')), context);
  return { context, audio, buttons, preview, node, events, toasts };
}

test('picker play button stops click propagation and previews without selecting or closing', () => {
  const { context, audio, preview, node } = setup();
  node('#pickerModal').hidden = false;
  context.bindPickerAudioButtons();
  let stopped = false;
  preview.listeners.click({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(audio.paused, false);
  assert.equal(context.state.refs.length, 0);
  assert.equal(node('#pickerModal').hidden, false);
  assert.equal(preview['aria-pressed'], 'true');
  preview.listeners.click({ stopPropagation() {} });
  assert.equal(audio.paused, true);
  assert.equal(preview.innerHTML, 'play');
  assert.doesNotMatch(context.pickerAudioPreviewHtml('audio/one.mp3'), /picker-audio-select/);
});

test('leaving the picker stops its preview but does not stop another audio source', () => {
  const { context, audio } = setup();
  context.togglePickerAudio('audio/one.mp3');
  context.stopPickerAudioPreview();
  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  context.toggleReferenceAudio('audio/two.wav');
  context.stopPickerAudioPreview();
  assert.equal(audio.paused, false);
  assert.equal(audio.src, '/files/audio/two.wav');
});

test('selection, closing and tab changes stop picker previews', () => {
  assert.match(source, /function pickRef\(key, kind = 'image'\) \{\s*stopPickerAudioPreview\(\)/);
  assert.match(source, /async function setPickerTab\(src\) \{\s*stopPickerAudioPreview\(\)/);
  assert.match(source, /\$\('#pickerClose'\)\.addEventListener\('click', \(\) => \{ stopPickerAudioPreview\(\)/);
});

test('reference thumbnail plays and pauses through the existing audio player', () => {
  const { context, audio, buttons, node } = setup();
  context.toggleReferenceAudio('audio/one.mp3');
  assert.equal(audio.src, '/files/audio/one.mp3');
  assert.equal(audio.paused, false);
  assert.equal(node('#assetAudioPlayer').hidden, false);
  assert.equal(buttons[0].innerHTML, 'pause');
  assert.equal(buttons[0]['aria-pressed'], 'true');
  context.toggleReferenceAudio('audio/one.mp3');
  assert.equal(audio.paused, true);
  assert.equal(audio.loads, 1, 'pausing must not reload the file');
  assert.equal(buttons[0].innerHTML, 'play');
  assert.equal(buttons[0]['aria-label'], 'create.refs.playAudio');
});

test('switching references uses one player and playback events synchronize both thumbnails', () => {
  const { context, audio, buttons, events } = setup();
  context.toggleReferenceAudio('audio/one.mp3');
  context.toggleReferenceAudio('audio/two.wav');
  assert.equal(audio.src, '/files/audio/two.wav');
  assert.equal(buttons[0]['aria-pressed'], 'false');
  assert.equal(buttons[1]['aria-pressed'], 'true');
  audio.ended = true;
  events.ended();
  assert.equal(buttons[1].innerHTML, 'play');
});

test('removing the playing reference stops it; rerendering and unrelated asset playback do not', () => {
  const { context, audio, node } = setup();
  context.state.refs = [{ key: 'audio/one.mp3' }];
  context.toggleReferenceAudio('audio/one.mp3');
  context.renderRefs();
  assert.equal(audio.paused, false);
  context.state.refs = [];
  context.renderRefs();
  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  assert.equal(node('#assetAudioPlayer').hidden, true);
  context.openAssetAudioPlayer('audio/two.wav');
  context.renderRefs();
  assert.equal(audio.paused, false);
});

test('playback failures use the translated error path', async () => {
  const { context, audio, toasts } = setup();
  audio.play = () => Promise.reject(new Error('NotSupportedError'));
  context.toggleReferenceAudio('audio/one.mp3');
  await Promise.resolve();
  assert.deepEqual(toasts, [['player.playFailed', 'err']]);
});

test('thumbnail playback remains separate from remove and prompt citation controls', () => {
  const render = source.slice(source.indexOf('function renderRefs()'), source.indexOf('function addRef('));
  assert.match(render, /type="button" class="asset-face ref-audio-play"/);
  assert.match(render, /event\.stopPropagation\(\);\s*toggleReferenceAudio\(r\.key\)/);
  assert.match(render, /querySelector\('\.ref-at'\)/);
  assert.match(render, /querySelector\('\.rm'\)/);
});
