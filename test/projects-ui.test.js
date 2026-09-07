import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('Proyectos integra navegación, editor, tareas y asociación desde Assets', async () => {
  const [html, app, server] = await Promise.all([
    load('public/index.html'),
    load('public/app.js'),
    load('server.js')
  ]);

  for (const marker of [
    'data-view="projects"', 'id="view-projects"', 'id="projectForm"',
    'id="projectDeadline"', 'id="projectTasksEditor"', 'id="btnProjectsSelected"',
    'id="assetFilterProject"', 'id="projectAssignForm"'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(app, /function renderProjects\(/);
  assert.match(app, /function renderProjectTasksEditor\(/);
  assert.match(app, /function openProjectAssign\(/);
  assert.match(app, /id="lbProject"/);
  assert.match(app, /assetMatchesProject\(a, state\.assetFilterProjectId\)/);

  assert.match(server, /readJson\('projects\.json', \[\]\)/);
  assert.match(server, /\/api\\\/projects/);
  assert.match(server, /'projects\.json', 'series\.json'/);
  assert.match(server, /updateJson\('projects\.json'/);
});

test('las fechas de Proyectos conservan controles oscuros', async () => {
  const css = await load('public/style.css');
  assert.match(css, /project-editor-box input\[type="date"\][^{]*\{[^}]*color-scheme:\s*dark/s);
});

test('seleccionar o asociar assets no reconstruye las miniaturas de video', async () => {
  const app = await load('public/app.js');
  const toggleSelection = app.match(/function toggleAssetSelection\(key\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(toggleSelection, /syncAssetSelectionUi\(\)/);
  assert.doesNotMatch(toggleSelection, /renderAssetsGrid\(\)/);
  assert.match(app, /card\.dataset\.assetKey = a\.key/);
  assert.match(app, /function syncAssetSelectionUi\(\)/);

  const projectSubmit = app.slice(app.indexOf("$('#projectAssignForm')"), app.indexOf('// ---------------------------------------------------------------------------\n// series'));
  assert.match(projectSubmit, /syncAssetSelectionUi\(\)/);
  assert.doesNotMatch(projectSubmit, /renderAssetsGrid\(\)/);
});
