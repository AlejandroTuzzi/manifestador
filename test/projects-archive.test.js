import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const server = read('server.js');
const app = read('public/app.js');

function backend() {
  let id = 0;
  const context = vm.createContext({ newId: () => `id${++id}` });
  vm.runInContext(server.slice(server.indexOf('function normalizeProjectDate('), server.indexOf('// HTTP\n') >= 0
    ? server.lastIndexOf('// ---------------------------------------------------------------------------', server.indexOf('// HTTP\n'))
    : server.indexOf('// Un throw new Error')), context);
  return context;
}

test('new projects are active; closing and reopening preserve their data through serialization', () => {
  const api = backend();
  const project = api.createWorkspaceProject({ name: 'Campaign', description: 'Description', deadline: '2026-12-01',
    nsfw: true, assetKeys: ['video/one.mp4', 'audio/one.wav'],
    tasks: [{ name: 'Deliver', description: 'Review', deadline: '2026-11-30', checklist: [{ text: 'Approve', done: true }] }]
  });
  assert.equal(project.archived, false);
  const original = JSON.parse(JSON.stringify(project));
  api.updateWorkspaceProject(project, { archived: true });
  assert.equal(project.archived, true);
  assert.ok(project.archivedAt > 0);
  const closedAt = project.archivedAt;
  api.updateWorkspaceProject(project, { archived: true });
  assert.equal(project.archivedAt, closedAt, 'closing twice must retain the first closing date');
  const reloaded = JSON.parse(JSON.stringify(project));
  api.updateWorkspaceProject(reloaded, { archived: false });
  assert.equal(reloaded.archived, false);
  assert.equal(reloaded.archivedAt, null);
  for (const key of ['id', 'name', 'description', 'deadline', 'nsfw', 'tasks', 'assetKeys', 'ts']) {
    assert.deepEqual(reloaded[key], original[key], key);
  }
});

test('ordinary edits preserve archived status and legacy projects can be archived', () => {
  const api = backend();
  const project = { id: 'legacy', name: 'Legacy', tasks: [], assetKeys: ['uploads/a.png'] };
  api.updateWorkspaceProject(project, { archived: true });
  const timestamp = project.archivedAt;
  api.updateWorkspaceProject(project, { name: 'Renamed' });
  assert.equal(project.archived, true);
  assert.equal(project.archivedAt, timestamp);
  api.updateWorkspaceProject(project, { archived: 'false' });
  assert.equal(project.archived, true, 'only a boolean may change status');
});

test('Active and Archived filter projects without losing them or exposing hidden content', () => {
  const state = { workspaceProjects: [{ id: 'old', name: 'Old' }, { id: 'active', archived: false },
    { id: 'closed', name: 'Closed', archived: true }, { id: 'hidden', archived: true, nsfw: true }] };
  const context = vm.createContext({ state, contentIsVisible: (item) => !item.nsfw, tr: () => 'Archived' });
  vm.runInContext(app.slice(app.indexOf('function workspaceProjectDisplayName('), app.indexOf('async function setWorkspaceProjectArchived(')), context);
  assert.deepEqual(Array.from(context.visibleWorkspaceProjects(), (item) => item.id), ['old', 'active']);
  state.projectArchiveView = true;
  assert.deepEqual(Array.from(context.visibleWorkspaceProjects(), (item) => item.id), ['closed']);
  assert.equal(context.workspaceProjectDisplayName(state.workspaceProjects[2]), 'Closed · Archived');
  assert.equal(state.workspaceProjects.length, 4);
});

test('archive action uses the existing persistent update route, not deletion', async () => {
  const calls = [], updates = [];
  const context = vm.createContext({
    api: async (url, options) => { calls.push({ url, options }); return { id: 'p1', name: 'Project', ...options.body }; },
    replaceWorkspaceProject: async (item) => updates.push(item), tr: (key) => key, toast() {}
  });
  vm.runInContext(app.slice(app.indexOf('async function setWorkspaceProjectArchived('), app.indexOf("$$('#projectArchiveTabs")), context);
  await context.setWorkspaceProjectArchived({ id: 'p1' }, true);
  await context.setWorkspaceProjectArchived({ id: 'p1' }, false);
  assert.equal(calls[0].url, '/api/projects/p1');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.body.archived, true);
  assert.equal(calls[1].options.body.archived, false);
  assert.equal(updates.length, 2);
  assert.match(server, /mutateProject\(\(project\) => updateWorkspaceProject\(project, body\)\)/);
});
