import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function setup({ multimedia = false, lora = false, nsfw = false, audio = 3, comfy = false } = {}) {
  const context = vm.createContext({
    state: { comfyPickerSlot: comfy ? 'image' : null, workspaceProjects: [], refs: [], pickerSelection: new Map() },
    isVideoMultimediaPicker: () => multimedia,
    isPromptLoraMediaPicker: () => lora,
    currentVideoModel: () => ({ mediaLimits: { image: 9, video: 3, audio } }),
    contentIsVisible: (item) => nsfw || !item.nsfw,
    tr: (key) => key, trn: (key, count) => `${count} assets`,
    i18n: { formatNumber: (number) => String(number) },
    esc: (text) => String(text), fileUrl: (key) => `/files/${key}`,
    nsfwBadgeHtml: (item) => item.nsfw ? 'NSFW' : '', IC: (icon) => icon,
    $$: () => [], syncReferenceAudioButtons() {},
    renderEntityPicker: (cfg) => { context.config = cfg; }
  });
  vm.runInContext(source.slice(source.indexOf('function referenceKind('), source.indexOf('function supportsMultimediaVideoRefs(')), context);
  vm.runInContext(source.slice(source.indexOf('function pickerAudioPreviewHtml('), source.indexOf('function renderEntityPicker(')), context);
  vm.runInContext(source.slice(source.indexOf('function pickerAllowsMultiple('), source.indexOf("$('#pickerSelectionAdd').addEventListener")), context);
  vm.runInContext(source.slice(source.indexOf('function projectReferenceAssets('), source.indexOf('function referenceFileKind(')), context);
  return context;
}
const assets = {
  uploads: [{ key: 'uploads/top.png', name: 'Top' }, { key: 'uploads/hidden.png', nsfw: true }],
  generated: [{ key: 'generated/backdrop.png' }],
  video: [{ key: 'video/clip.mp4', name: 'Clip' }],
  audio: [{ key: 'audio/voice.mp3', name: 'Voice' }]
};
const project = { id: 'p1', name: 'Campaign', assetKeys: [
  'uploads/top.png', 'video/clip.mp4', 'audio/voice.mp3', 'uploads/hidden.png', 'uploads/deleted.png', 'uploads/top.png'
] };
const keys = (context) => Array.from(context.projectReferenceAssets(project, assets), (asset) => asset.key);

test('Projects is wired into the existing reference tabs without rebuilding the main gallery', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const tabs = html.slice(html.indexOf('id="pickerTabs"'), html.indexOf('id="pickerBody"'));
  assert.match(tabs, /data-src="projects" data-i18n="nav.projects"/);
  const branch = source.slice(source.indexOf("} else if (src === 'projects')"), source.indexOf('// Drill-down genérico'));
  assert.match(branch, /renderPickerProjects\(\)/);
  assert.doesNotMatch(branch.slice(0, branch.indexOf('} else {')), /await refreshAssets\(/);
});

test('project image references exclude unrelated, deleted, hidden and duplicate assets', () => {
  assert.deepEqual(keys(setup()), ['uploads/top.png']);
  assert.deepEqual(keys(setup({ nsfw: true })), ['uploads/top.png', 'uploads/hidden.png']);
});

test('project references respect multimedia, audio support, LoRA and image-only slots', () => {
  assert.deepEqual(keys(setup({ multimedia: true })), ['uploads/top.png', 'video/clip.mp4', 'audio/voice.mp3']);
  assert.deepEqual(keys(setup({ multimedia: true, audio: 0 })), ['uploads/top.png', 'video/clip.mp4']);
  assert.deepEqual(keys(setup({ lora: true })), ['uploads/top.png', 'video/clip.mp4']);
  assert.deepEqual(keys(setup({ multimedia: true, comfy: true })), ['uploads/top.png']);
});

test('project picker uses project assets, names, media types and bounded pages', () => {
  const context = setup({ multimedia: true });
  context.state.workspaceProjects = [project, { id: 'hidden', nsfw: true }];
  context.state.pickerProjectAssets = assets;
  context.renderPickerProjects();
  const cfg = context.config;
  assert.equal(cfg.items().length, 1);
  assert.equal(cfg.pageSize, 24);
  assert.equal(cfg.cover(project), 'uploads/top.png');
  assert.equal(cfg.photoLabel(project, {}, 'video/clip.mp4'), 'Clip');
  assert.equal(cfg.kind('video/clip.mp4'), 'video');
  assert.equal(cfg.kind('audio/voice.mp3'), 'audio');
  assert.match(cfg.preview('video/clip.mp4'), /<video .*muted playsinline/);
  assert.doesNotMatch(cfg.preview('audio/voice.mp3'), /<(?:video|img)/);
});

test('shared entity picker paginates and forwards the selected media kind', () => {
  const context = setup({ multimedia: true });
  const listeners = {};
  const pick = { dataset: { key: 'video/clip.mp4', kind: 'video' }, classList: { toggle() {} }, setAttribute() {}, querySelector: () => null,
    addEventListener: (event, callback) => { if (event === 'click') listeners.pick = callback; } };
  const body = { innerHTML: '', querySelectorAll: (selector) => selector === '.pick[data-key]' ? [pick] : [] };
  const modal = { hidden: false };
  context.$ = (selector) => selector === '#pickerBody' ? body : selector === '#pickerModal' ? modal
    : { addEventListener: (event, callback) => { listeners[selector] = callback; } };
  context.$$ = (selector) => selector === '#pickerBody .pick[data-key]' ? [pick] : [];
  context.sortEntities = () => {};
  context.pickRef = (key, kind) => { context.selected = { key, kind }; };
  context.state.workspaceProjects = [{ ...project, assetKeys: Array.from({ length: 30 }, (_, index) => `video/${index}.mp4`) }];
  context.state.pickerProjectAssets = { video: context.state.workspaceProjects[0].assetKeys.map((key) => ({ key, name: key })) };
  context.state.pickerProjectId = 'p1';
  vm.runInContext(source.slice(source.indexOf('function renderEntityPicker('), source.indexOf('const entityVariantGroups')), context);
  context.renderPickerProjects();
  assert.equal((body.innerHTML.match(/<video /g) || []).length, 24);
  listeners['#pickerPageNext']();
  assert.equal((body.innerHTML.match(/<video /g) || []).length, 6);
  listeners.pick();
  assert.deepEqual(context.selected, { key: 'video/clip.mp4', kind: 'video' });
  assert.equal(modal.hidden, true);
  listeners['#pickerBack']();
  assert.equal(context.state.pickerProjectId, '');
});
