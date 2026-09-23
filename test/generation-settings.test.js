import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { generationSettings } from '../lib/generation-settings.js';

test('snapshots retain provider settings and references, not credentials or retry/task IDs', () => {
  const body = { prompt: 'A scene', refs: ['uploads/ref.png'], labeledRefs: { 'uploads/ref.png': 'data:image/png;base64,abc' },
    wanOptions: { seed: 0, promptExtend: false }, heygenMotionPrompt: 'Wave', apiKey: 'SECRET',
    authorization: 'SECRET', idempotencyKey: 'old', wanTaskId: 'old', genId: 'old' };
  const snapshot = generationSettings('video', body);
  assert.equal(snapshot.request.wanOptions.seed, 0);
  assert.equal(snapshot.request.wanOptions.promptExtend, false);
  assert.ok(snapshot.request.labeledRefs);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET|idempotencyKey|wanTaskId|genId/);
  body.refs.push('another');
  assert.equal(snapshot.request.refs.length, 1);
});

function archiveHarness() {
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const store = {};
  let number = 0;
  const context = vm.createContext({ generationSettings, generationContext: new AsyncLocalStorage(),
    newId: () => `request${++number}`, getConfig: async () => ({ keys: { qwen: 'SECRET' } }),
    readJson: async (key, fallback) => store[key] || fallback,
    writeJson: async (key, value) => { store[key] = structuredClone(value); },
    updateJson: async (key, fallback, update) => { store[key] = structuredClone(update(store[key] || fallback)); },
    fs: { mkdir: async () => {} }, path: { join: (...parts) => parts.join('/') }, DATA_DIR: 'test',
    timedGeneration: fn => fn()
  });
  vm.runInContext(source.slice(source.indexOf('async function recordedGeneration('), source.indexOf('async function timedGeneration(')), context);
  return { context, store };
}

test('failed requests persist before submission, redact keys and can be retrieved after failure', async () => {
  const { context, store } = archiveHarness();
  await assert.rejects(context.recordedGeneration('video', { modelId: 'wan-3', prompt: 'Scene', duration: 10 }, async () => {
    assert.equal(store['generation-requests/request1.json'].request.duration, 10);
    throw new Error('Provider rejected SECRET');
  }));
  const saved = store['generation-requests/request1.json'];
  assert.equal(saved.status, 'failed');
  assert.equal(saved.request.prompt, 'Scene');
  assert.equal(saved.error, 'Provider rejected [redacted]');
});

test('successful and sibling outputs share a durable snapshot identifier', async () => {
  const { context, store } = archiveHarness();
  store['history.json'] = [{ id: 'first' }, { id: 'second' }];
  const entry = await context.recordedGeneration('comfyui', { workflowId: 'wf', customValues: { 0: 42 } }, async () => {
    assert.equal(context.generationContext.getStore().id, 'request1');
    return { id: 'first', outputs: ['generated/a.png'], siblingEntries: [{ id: 'second', outputs: ['video/a.mp4'] }] };
  });
  assert.equal(entry.generationRequestId, 'request1');
  assert.equal(entry.siblingEntries[0].generationRequestId, 'request1');
  assert.equal(store['history.json'][1].generationRequestId, 'request1');
  assert.equal(store['generation-requests/request1.json'].outputs.length, 2);
});

test('restoring a request fills inputs without calling generation or replaying IDs', async () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  let edited;
  const controls = new Map();
  const context = vm.createContext({
    state: { videoModels: [{ id: 'wan-3' }], video: {}, refs: [] },
    $: id => { if (!controls.has(id)) controls.set(id, {}); return controls.get(id); },
    promptBox: { value: '', focus() {} }, editEntry: entry => { edited = entry; },
    renderRefs() {}, renderHighlight() {}, goToCreate() {}, toast() {}, tr: key => key,
    generate: () => { throw new Error('Must not generate'); }, api: () => { throw new Error('Must not call APIs'); }
  });
  vm.runInContext(source.slice(source.indexOf('async function restoreGenerationSettings('), source.indexOf('async function restoreEntrySettings(')), context);
  await context.restoreGenerationSettings({ kind: 'video', request: { modelId: 'wan-3', prompt: 'Original', duration: -1,
    audio: false, avoidMusic: true, wanOptions: { seed: 0 }, refs: ['audio/ref.wav'], refKinds: ['audio'] } });
  assert.equal(context.promptBox.value, 'Original');
  assert.equal(edited.requestedDuration, -1);
  assert.equal(edited.audio, false);
  assert.equal(edited.wanOptions.seed, 0);
  assert.equal(context.state.refs[0].kind, 'audio');
});
