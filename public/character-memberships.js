/* Series and project membership of a character: editor checklist and Characters filters. */
const CHARACTER_MEMBERSHIP_GROUPS = [
  { kind: 'series', bodyKey: 'series', titleKey: 'series.title', list: () => state.series || [], label: (item) => item.title, closedKey: 'series.finished' },
  { kind: 'project', bodyKey: 'projects', titleKey: 'projects.title', list: () => state.workspaceProjects || [], label: (item) => item.name, closedKey: 'projects.archived' }
];

const hasCharacter = (item, characterId) => Boolean(characterId) && (item.characterIds || []).includes(characterId);

// A new character starts in the series or project that Characters is filtered by.
function characterMembershipDraft(characterId) {
  const draft = new Set();
  const filtered = { series: state.characterFilterSeriesId, project: state.characterFilterProjectId };
  for (const group of CHARACTER_MEMBERSHIP_GROUPS) {
    for (const item of group.list()) {
      const member = characterId ? hasCharacter(item, characterId) : !item.archived && item.id === filtered[group.kind];
      if (member) draft.add(`${group.kind}:${item.id}`);
    }
  }
  return draft;
}

// Completed items can't take new characters, so they only appear when the character is already in them.
function characterMembershipEditorHtml(characterId) {
  const draft = state.characterMembershipDraft || new Set();
  const groups = CHARACTER_MEMBERSHIP_GROUPS.map((group) => {
    const items = group.list().filter((item) => contentIsVisible(item) && (!item.archived || hasCharacter(item, characterId)));
    if (!items.length) return '';
    const rows = items.map((item) => {
      const value = `${group.kind}:${item.id}`;
      const closed = item.archived ? ` · ${tr(group.closedKey)}` : '';
      return `<label class="check-row"><input type="checkbox" data-character-membership="${esc(value)}"${draft.has(value) ? ' checked' : ''}${item.archived ? ' disabled' : ''}> ${esc(group.label(item) + closed)}</label>`;
    }).join('');
    return `<div class="character-membership-group"><span class="character-membership-title">${esc(tr(group.titleKey))}</span><div class="character-membership-list">${rows}</div></div>`;
  }).join('');
  return `<div class="character-memberships"><label>${esc(tr('characters.editor.memberships'))}</label>${groups
    ? `<div class="character-membership-groups">${groups}</div><div class="hint">${esc(tr('characters.editor.membershipsHint'))}</div>`
    : `<div class="hint">${esc(tr('characters.editor.membershipsEmpty'))}</div>`}</div>`;
}

function bindCharacterMembershipEditor() {
  $$('#charModalBody [data-character-membership]').forEach((input) => input.addEventListener('change', () => {
    const draft = state.characterMembershipDraft || (state.characterMembershipDraft = new Set());
    if (input.checked) draft.add(input.dataset.characterMembership);
    else draft.delete(input.dataset.characterMembership);
  }));
}

// Only items shown in the editor are sent, so hidden or completed ones keep their characters.
function characterMembershipChanges(characterId) {
  const draft = state.characterMembershipDraft || new Set();
  const changes = {};
  let count = 0;
  for (const group of CHARACTER_MEMBERSHIP_GROUPS) {
    changes[group.bodyKey] = {};
    for (const item of group.list()) {
      if (!contentIsVisible(item) || item.archived) continue;
      const wanted = draft.has(`${group.kind}:${item.id}`);
      if (wanted === hasCharacter(item, characterId)) continue;
      changes[group.bodyKey][item.id] = wanted;
      count++;
    }
  }
  return count ? changes : null;
}

async function saveCharacterMemberships(characterId) {
  const changes = characterMembershipChanges(characterId);
  if (!changes) return;
  const result = await api(`/api/characters/${characterId}/memberships`, { method: 'PUT', body: changes });
  for (const item of result.series || []) {
    const index = state.series.findIndex((series) => series.id === item.id);
    if (index >= 0) state.series[index] = item;
  }
  if ((result.series || []).length) renderSeries();
  for (const item of result.projects || []) await replaceWorkspaceProject(item);
}

function renderCharacterGroupFilters() {
  for (const group of CHARACTER_MEMBERSHIP_GROUPS) {
    const select = $(group.kind === 'series' ? '#characterFilterSeries' : '#characterFilterProject');
    const field = group.kind === 'series' ? 'characterFilterSeriesId' : 'characterFilterProjectId';
    const items = group.list().filter(contentIsVisible);
    const all = tr(group.kind === 'series' ? 'common.allFeminine' : 'common.allMasculine');
    select.innerHTML = `<option value="">${esc(all)}</option>` + items.map((item) =>
      `<option value="${esc(item.id)}">${esc(group.label(item) + (item.archived ? ` · ${tr(group.closedKey)}` : ''))}</option>`).join('');
    if (!items.some((item) => item.id === state[field])) state[field] = '';
    select.value = state[field];
  }
}

function characterInGroupFilters(character) {
  return CHARACTER_MEMBERSHIP_GROUPS.every((group) => {
    const id = group.kind === 'series' ? state.characterFilterSeriesId : state.characterFilterProjectId;
    return !id || hasCharacter(group.list().find((item) => item.id === id) || {}, character.id);
  });
}

$('#characterFilterSeries').addEventListener('change', (event) => { state.characterFilterSeriesId = event.target.value; renderCharacters(); });
$('#characterFilterProject').addEventListener('change', (event) => { state.characterFilterProjectId = event.target.value; renderCharacters(); });
