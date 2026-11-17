import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { applyCharacterMemberships } from '../lib/character-memberships.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('memberships only change listed, open series or projects', () => {
  const items = [
    { id: 'open', characterIds: ['other'] },
    { id: 'member', characterIds: ['c1', 'other'] },
    { id: 'closed', archived: true, characterIds: [] },
    { id: 'unlisted', characterIds: ['c1'] }
  ];
  const { items: next, changed } = applyCharacterMemberships(items, 'c1', { open: true, member: false, closed: true, missing: true }, { touchedAt: 42 });
  assert.deepEqual(next.map((item) => item.characterIds), [['other', 'c1'], ['other'], [], ['c1']]);
  assert.deepEqual(changed.map((item) => [item.id, item.updatedAt]), [['open', 42], ['member', 42]]);
  assert.equal(next[3], items[3]);
  assert.deepEqual(applyCharacterMemberships(items, 'c1', { member: true }).changed, []);
  assert.deepEqual(applyCharacterMemberships(items, 'c1', null).changed, []);
});

function editorContext() {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', value: '', addEventListener() {} });
    return elements.get(selector);
  };
  const requests = [];
  const state = {
    series: [
      { id: 's1', title: 'Serie <A>', characterIds: ['c1'] },
      { id: 's2', title: 'Serie B', characterIds: [] },
      { id: 's3', title: 'Finalizada', archived: true, characterIds: ['c1'] },
      { id: 's4', title: 'Oculta', nsfw: true, characterIds: ['c1'] }
    ],
    workspaceProjects: [{ id: 'p1', name: 'Proyecto', characterIds: [] }],
    characterFilterSeriesId: '',
    characterFilterProjectId: ''
  };
  const context = vm.createContext({
    state, $: element, $$: () => [],
    tr: (key) => key, esc: (value) => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    contentIsVisible: (item) => !item.nsfw,
    api: async (url, options) => { requests.push({ url, options }); return { series: [{ ...state.series[1], characterIds: ['c1'] }], projects: [] }; },
    renderSeries: () => {}, replaceWorkspaceProject: async () => {}, renderCharacters: () => {}
  });
  vm.runInContext(read('public/character-memberships.js'), context);
  return { context, state, requests, element };
}

test('the editor keeps hidden and completed memberships out of the request', async () => {
  const { context, state, requests } = editorContext();
  state.characterMembershipDraft = context.characterMembershipDraft('c1');
  assert.deepEqual([...state.characterMembershipDraft].sort(), ['series:s1', 'series:s3', 'series:s4']);
  const html = context.characterMembershipEditorHtml('c1');
  assert.match(html, /data-character-membership="series:s3" checked disabled/);
  assert.doesNotMatch(html, /Oculta/);
  assert.match(html, /Serie &lt;A&gt;/);
  state.characterMembershipDraft.delete('series:s1');
  state.characterMembershipDraft.add('series:s2');
  state.characterMembershipDraft.add('project:p1');
  await context.saveCharacterMemberships('c1');
  assert.equal(requests[0].url, '/api/characters/c1/memberships');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].options.body)), { series: { s1: false, s2: true }, projects: { p1: true } });
  assert.deepEqual(state.series[1].characterIds, ['c1']);
  requests.length = 0;
  state.characterMembershipDraft = context.characterMembershipDraft('c1');
  await context.saveCharacterMemberships('c1');
  assert.equal(requests.length, 0);
});

test('a new character starts in the filtered series and the filters narrow the grid', () => {
  const { context, state, element } = editorContext();
  state.characterFilterSeriesId = 's2';
  assert.deepEqual([...context.characterMembershipDraft('')], ['series:s2']);
  state.characterFilterSeriesId = 's3';
  assert.deepEqual([...context.characterMembershipDraft('')], []);
  state.characterFilterSeriesId = 's1';
  context.renderCharacterGroupFilters();
  assert.equal(element('#characterFilterSeries').value, 's1');
  assert.doesNotMatch(element('#characterFilterSeries').innerHTML, /Oculta/);
  assert.match(element('#characterFilterSeries').innerHTML, /Finalizada · series.finished/);
  assert.equal(context.characterInGroupFilters({ id: 'c1' }), true);
  assert.equal(context.characterInGroupFilters({ id: 'c2' }), false);
  state.characterFilterProjectId = 'p1';
  assert.equal(context.characterInGroupFilters({ id: 'c1' }), false);
  state.characterFilterSeriesId = 'gone';
  state.characterFilterProjectId = '';
  context.renderCharacterGroupFilters();
  assert.equal(state.characterFilterSeriesId, '');
});

test('the page wires memberships, filters and the HeyGen avatar field', () => {
  const app = read('public/app.js'), html = read('public/index.html'), server = read('server.js');
  assert.ok(html.indexOf('src="character-memberships.js"') < html.indexOf('src="app.js"'));
  for (const id of ['characterFilterSeries', 'characterFilterProject', 'heygenAvatarId']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /heygenCharacterSelect/);
  assert.match(app, /characterMembershipEditorHtml\(id\)/);
  assert.match(app, /await saveCharacterMemberships\(created\.id\)/);
  assert.match(app, /characterInGroupFilters\(c\)/);
  assert.match(app, /heygenAvatarId: state\.video\.heygenAvatarId/);
  assert.match(server, /\/api\\\/characters\\\/\(\[a-z0-9\]\+\)\\\/memberships/);
  assert.match(server, /const avatarId = String\(req\.heygenAvatarId \|\| ''\)/);
  assert.doesNotMatch(server, /heygenCharacterId/);
});

test('new texts exist in both languages', () => {
  for (const locale of ['es', 'en']) {
    const text = read(`public/locales/${locale}.js`);
    for (const key of ['characters.editor.memberships', 'characters.editor.membershipsHint', 'characters.editor.membershipsEmpty',
      'create.heygen.avatar', 'create.heygen.avatarPlaceholder', 'create.heygen.avatarHint', 'create.validation.heygenAvatar', 'errors.heygenAvatarRequired']) {
      assert.ok(text.includes(`'${key}'`), `${locale}: falta ${key}`);
    }
    assert.doesNotMatch(text, /characters\.editor\.(?:heygenVariant|mirror|wideAvatar)|create\.heygen\.character'/);
  }
});
