import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('public/app.js');

function setup() {
  const nodes = new Map(), stamps = [], stored = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { listeners: {}, children: [], addEventListener(type, fn) { this.listeners[type] = fn; }, appendChild(child) { this.children.push(child); } });
    return nodes.get(id);
  };
  const context = vm.createContext({
    state: { mode: 'image', referenceTagsEnabled: false, refs: [{ key: 'uploads/one.png', label: 'Penelope' }], video: { mode: 'reference' } },
    $: node, localStorage: { setItem: (key, value) => stored.set(key, value) },
    renderHighlight() {}, supportsMultimediaVideoRefs: (model) => model?.multimedia,
    stampLabel: async (key, label) => { stamps.push({ key, label }); return 'data:image/jpeg;base64,AAA'; },
    referenceKind: (ref) => ref.kind || 'image', toast() {}, tr: (key) => key,
    activeRefModel: () => ({}), activeRefLimit: () => 1, currentVideoModel: () => ({}),
    videoModeAllowsMultimedia: () => true, typedVideoReferenceMention: () => '@image1',
    document: { createElement: () => ({ innerHTML: '', querySelector: () => ({ addEventListener() {} }) }) },
    esc: (text) => text, IC: () => '', fileUrl: (key) => key, syncReferenceAudioButtons() {}, referenceAudioKey: ''
  });
  vm.runInContext(source.slice(source.indexOf('function normalizeReferenceLabel('), source.indexOf('function addRef(')), context);
  vm.runInContext(source.slice(source.indexOf('async function buildLabeledRefs('), source.indexOf('// voces / controles de audio')), context);
  return { context, node, stamps, stored };
}

test('reference labels default to off, restore explicit opt-in and tolerate unavailable storage', () => {
  const core = read('public/app-core.js');
  const initializer = core.match(/referenceTagsEnabled: (\(\(\) => .*?\}\)\(\)),/)[1];
  for (const [value, expected] of [[null, false], ['false', false], ['true', true], ['invalid', false]]) {
    assert.equal(vm.runInNewContext(initializer, { localStorage: { getItem: () => value } }), expected);
  }
  assert.equal(vm.runInNewContext(initializer, { localStorage: { getItem: () => { throw new Error('blocked'); } } }), false);
  assert.doesNotMatch(read('public/index.html').match(/<input id="referenceTagsEnabled"[^>]*>/)[0], /checked/);
});

test('disabled labels send original references without stamping; opt-in restores stamping only in eligible modes', async () => {
  const { context, stamps } = setup();
  const { refs } = context.state;
  assert.equal(Object.keys(await context.buildCreationLabeledRefs(refs, {}, false)).length, 0);
  assert.equal(stamps.length, 0);
  context.state.referenceTagsEnabled = true;
  assert.ok((await context.buildCreationLabeledRefs(refs, {}, false))['uploads/one.png']);
  assert.equal(stamps[0].label, 'Penelope');
  await context.buildCreationLabeledRefs(refs, { multimedia: true }, true);
  context.state.video.mode = 'frames';
  await context.buildCreationLabeledRefs(refs, {}, true);
  assert.equal(stamps.length, 1);
  context.state.referenceTagsEnabled = false;
  await context.buildLabeledRefs(refs);
  assert.equal(stamps.length, 2, 'The automation/shared engine is not controlled by the creation checkbox');
});

test('toggle hides label badges and T controls without deleting names or references', () => {
  const { context, node, stored } = setup();
  context.renderRefs();
  let html = node('#refsStrip').children.at(-1).innerHTML;
  assert.doesNotMatch(html, /ref-label-tag|ref-label-btn/);
  assert.match(html, /@image1/);
  node('#referenceTagsEnabled').listeners.change({ target: { checked: true } });
  html = node('#refsStrip').children.at(-1).innerHTML;
  assert.match(html, /ref-label-tag/);
  assert.match(html, /ref-label-btn/);
  assert.match(html, /@Penelope/);
  assert.equal(stored.get('manifestadorReferenceTags'), 'true');
  node('#referenceTagsEnabled').listeners.change({ target: { checked: false } });
  assert.equal(context.state.refs.length, 1);
  assert.equal(context.state.refs[0].label, 'Penelope');
  assert.equal(stored.get('manifestadorReferenceTags'), 'false');
});

test('saved name citations resolve to numbered images only for unlabelled image requests', () => {
  const { context } = setup();
  context.state.refs.push({ key: 'uploads/two.png', label: '@Artistic Style' }, { key: 'uploads/three.png', label: 'Penelope Blue' });
  const prompt = '@Penelope with @Artistic Style and @Penelope Blue, @Penelopes unchanged; mail@Penelope unchanged, @image1 unchanged.';
  assert.equal(context.creationReferencePrompt(prompt), '@image1 with @image2 and @image3, @Penelopes unchanged; mail@Penelope unchanged, @image1 unchanged.');
  assert.equal(context.state.refs[1].label, '@Artistic Style');
  context.state.referenceTagsEnabled = true;
  assert.equal(context.creationReferencePrompt(prompt), prompt);
  context.state.referenceTagsEnabled = false;
  for (const mode of ['video', 'audio', 'music', 'comfyui']) {
    context.state.mode = mode;
    assert.equal(context.creationReferencePrompt(prompt), prompt);
  }
  assert.match(source, /const prompt = creationReferencePrompt\(promptBox.value.trim\(\)\)/);
  assert.match(source, /const labeledRefs = await buildCreationLabeledRefs\(refsUsed, model, isVideo\)/);
});
