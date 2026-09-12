import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const server = read('server.js'), app = read('public/app.js');

test('project character routes support creation, idempotent linking and unlinking without altering characters', async () => {
  const characters = [{ id: 'char1', name: 'Observer' }];
  let projects = [], body = {}, response;
  const context = vm.createContext({ newId: () => 'proj1',
    readJsonBody: async () => body, readJson: async (file) => file === 'characters.json' ? characters : projects,
    updateJson: async (_file, _fallback, fn) => { projects = fn(projects); return projects; },
    send: (_res, status, value) => { response = { status, value }; },
    sendError: (_res, status, code) => { response = { status, code }; }
  });
  vm.runInContext(server.slice(server.indexOf('function normalizeProjectDate('), server.indexOf('// Un throw new Error')), context);
  vm.runInContext(`async function request(p, method) { const req = {method}, res = {}, url = new URL('http://localhost' + p); p = url.pathname;
    ${server.slice(server.indexOf("if (p === '/api/projects' && req.method === 'POST')"), server.indexOf("if (p === '/api/series' && req.method === 'POST')"))}
  }`, Object.assign(context, { URL }));
  body = { name: 'Campaign', characterIds: ['char1', 'char1'] };
  await context.request('/api/projects', 'POST');
  assert.equal(response.status, 200);
  assert.deepEqual(Array.from(projects[0].characterIds), ['char1']);
  body = { characterId: 'char1' };
  await context.request('/api/projects/proj1/characters', 'POST');
  assert.equal(projects[0].characterIds.length, 1);
  body = { name: 'Renamed', archived: true };
  await context.request('/api/projects/proj1', 'PUT');
  assert.equal(projects[0].characterIds.length, 1);
  body = { characterId: 'missing' };
  await context.request('/api/projects/proj1/characters', 'POST');
  assert.equal(response.code, 'workspaceProjectCharacterMissing');
  await context.request('/api/projects/proj1/characters?characterId=char1', 'DELETE');
  assert.equal(projects[0].characterIds.length, 0);
  assert.equal(characters[0].name, 'Observer');
});

test('project/series profile links open the shared read-only sheet and do not change selection', () => {
  let handler, opened;
  const button = { dataset: { openLinkedCharacter: 'char1' }, addEventListener: (_type, fn) => { handler = fn; } };
  const state = { characters: [{ id: 'char1' }], seriesDraftCharacterIds: new Set(['char1']) };
  const context = vm.createContext({ state, contentIsVisible: (item) => !item.nsfw, openCharacterProfile: (id) => { opened = id; } });
  vm.runInContext(app.slice(app.indexOf('function bindLinkedCharacterButtons('), app.indexOf('function renderProjectCharacterChoices(')), context);
  context.bindLinkedCharacterButtons({ querySelectorAll: () => [button] });
  let prevented = false, stopped = false;
  handler({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(opened, 'char1'); assert.ok(prevented && stopped);
  assert.ok(state.seriesDraftCharacterIds.has('char1'));
  const profile = read('public/character-profile.js');
  assert.doesNotMatch(profile, /openCharModal|<input|<textarea|method: ['"](?:POST|PUT|DELETE)/);
  for (const field of ['description', 'voiceName', 'variants', 'distinctiveElements', 'heygen']) assert.ok(profile.includes(field));
  assert.match(profile, /openCharacterAssets\(id\)/);
  assert.match(profile, /openCharacterGallery\(id\)/);
  assert.match(app, /if \(act === 'profile'\) openCharacterProfile\(c.id\)/);
});

test('late photo assignment updates its captured character, not the currently open picker', () => {
  const first = { id: 'char1', photos: [] }, second = { id: 'char2', photos: [] };
  const state = { characters: [first, second], charAssetPicker: { entity: 'character', ownerId: 'char2' }, editingCharId: 'char2' };
  let renderedEditor = 0;
  const context = vm.createContext({ state, renderCharModal: () => renderedEditor++, renderCharacters() {}, renderPinned() {} });
  vm.runInContext(app.slice(app.indexOf('function refreshPickerEntity('), app.indexOf('function renderCharAssetPickerGrid(')), context);
  const updated = { id: 'char1', photos: ['characters/char1/copied.png'] };
  context.refreshPickerEntity(updated, { entity: 'character', ownerId: 'char1' });
  assert.equal(state.characters[0], updated);
  assert.equal(state.characters[1], second);
  assert.equal(renderedEditor, 0);
  state.charAssetPicker = null;
  context.refreshPickerEntity(updated, { entity: 'character', ownerId: 'char1' });
  assert.equal(state.characters[0], updated);
});

test('association dialogs are above galleries and errors are visible above all sheets', () => {
  const css = read('public/style.css');
  assert.match(css, /#characterGalleryModal\s*\{ z-index: 120/);
  assert.match(css, /#lightbox\s*\{ z-index: 130/);
  assert.match(css, /#seriesAssignModal, #projectAssignModal\s*\{ z-index: 145/);
  assert.match(app, /cp.queue = \(cp.queue \|\| Promise.resolve\(\)\).then\(async/);
  assert.match(app, /const asPhotoRequested = \$\('#associateAsPhoto'\).checked/);
});
