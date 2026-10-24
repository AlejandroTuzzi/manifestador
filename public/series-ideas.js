(() => {
  const panel = $('#seriesIdeasPanel');
  const tab = document.createElement('button');
  tab.id = 'seriesIdeasTab'; tab.className = 'tool-btn'; tab.type = 'button';
  tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', panel.id);
  tab.setAttribute('aria-selected', 'false'); tab.dataset.i18n = 'ideas.title';
  $('#seriesInspirationTab').after(tab);
  let data = { entries: [], categories: [] }, filter = '', draft = null, categoryId = '', busy = false;
  let viewingId = '';
  function ideaPreview(text) {
    const characters = Array.from(String(text || ''));
    return characters.slice(0, 500).join('') + (characters.length > 500 ? '…' : '');
  }
  const t = key => esc(tr(key));
  const button = (action, key) => `<button type="button" class="mini-btn" data-idea-action="${action}">${t(key)}</button>`;
  const field = (name, key, value = '', multiline = false) => `<label><span>${t(key)}</span>${multiline
    ? `<textarea name="${name}" rows="3" maxlength="20000">${esc(value)}</textarea>`
    : `<input name="${name}" value="${esc(value)}" maxlength="5000"${name === 'name' ? ' required' : ''}>`}</label>`;
  const characterFields = ['name', 'sex', 'physical', 'profession', 'relationships', 'role', 'description', 'emotionalLever'];
  function options(value, all = false) {
    return `<option value="">${t(all ? 'ideas.allCategories' : 'ideas.noCategory')}</option>` + data.categories.map(c => `<option value="${esc(c.id)}"${c.id === value ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  }
  function capture() {
    const form = panel.querySelector('#ideaForm');
    if (!form || !draft) return;
    for (const key of ['name', 'categoryId', 'development']) draft[key] = form.elements.namedItem(key).value;
    draft.nsfw = form.elements.namedItem('nsfw')?.checked || false;
    IdeaOutline.capture(panel, draft);
    draft.characters = [...form.querySelectorAll('[data-idea-character]')].map(card => Object.fromEntries(characterFields.map(key => [key, card.querySelector(`[name="character-${key}"]`).value])));
  }
  function render() {
    panel.innerHTML = `<div class="inspiration-tabs">${button('new', 'ideas.new')}${button('categories', 'ideas.categories')}</div>`;
    const viewing = data.entries.find(item => item.id === viewingId);
    if (viewing && !draft) {
      panel.insertAdjacentHTML('beforeend', `<article class="idea-editor idea-reader">
        <div class="inspiration-tabs">${button('back', 'ideas.back')}${button(`edit:${viewing.id}`, 'common.edit')}</div>
        <h2>${esc(viewing.name)} ${nsfwBadgeHtml(viewing)}</h2>
        <p class="hint">${esc(data.categories.find(c => c.id === viewing.categoryId)?.name || '')}</p>
        <div class="idea-story">${esc(viewing.development)}</div>
        ${IdeaOutline.render(viewing)}
        <h3>${t('ideas.characters')}</h3>
        ${viewing.characters.map(character => `<section class="idea-character"><h3>${esc(character.name)}</h3>${characterFields.filter(key => key !== 'name' && character[key]).map(key => `<h4>${t(`ideas.${key}`)}</h4><p class="idea-story">${esc(character[key])}</p>`).join('')}</section>`).join('')}
        <div>${button('back', 'ideas.back')}</div>
      </article>`);
    } else if (draft) {
      panel.insertAdjacentHTML('beforeend', `<form id="ideaForm" class="inspiration-form idea-editor">
        ${field('name', 'common.name', draft.name)}
        <label><span>${t('ideas.category')}</span><select name="categoryId" class="select">${options(draft.categoryId)}</select></label>
        ${field('development', 'ideas.development', draft.development, true)}
        ${IdeaOutline.render(draft, true)}
        <h3>${t('ideas.characters')}</h3><p class="hint">${t('ideas.privateCharacters')}</p>
        ${draft.characters.map((character, index) => `<fieldset class="idea-character" data-idea-character="${index}"><legend>${t('ideas.character')} ${index + 1}</legend><div class="idea-fields">${characterFields.map(key => field(`character-${key}`, `ideas.${key}`, character[key] || '', !['name', 'sex', 'profession', 'role'].includes(key))).join('')}</div>${button(`remove:${index}`, 'common.delete')}</fieldset>`).join('')}
        ${button('add-character', 'ideas.addCharacter')}
        <label class="check-row"><input type="checkbox" name="nsfw"${draft.nsfw ? ' checked' : ''}><span>${t('common.nsfwContent')}</span></label>
        <div class="form-modal-actions">${button('cancel', 'common.cancel')}<button class="generate-btn small" type="submit">${t('common.save')}</button></div>
      </form>`);
      panel.querySelector('#ideaForm').onsubmit = async event => { event.preventDefault(); capture(); await save('entries', draft.id, draft); };
    } else {
      panel.insertAdjacentHTML('beforeend', `<select id="ideaFilter" class="select" aria-label="${t('ideas.category')}">${options(filter, true)}</select><div class="ideas-list">${data.entries.filter(item => !filter || item.categoryId === filter).map(item => `<article class="char-card idea-card"><h3>${esc(item.name)} ${nsfwBadgeHtml(item)}</h3><p class="hint">${esc(data.categories.find(c => c.id === item.categoryId)?.name || '')}</p><p>${esc(ideaPreview(item.development))}</p><p>${esc(item.characters.map(c => c.name).filter(Boolean).join(', '))}</p><div class="inspiration-tabs">${button(`view:${item.id}`, 'ideas.view')}${button(`edit:${item.id}`, 'common.edit')}${button(`delete:${item.id}`, 'common.delete')}</div></article>`).join('') || `<p class="hint">${t('ideas.empty')}</p>`}</div>`);
      panel.querySelector('#ideaFilter').onchange = event => { filter = event.target.value; render(); };
    }
    panel.insertAdjacentHTML('beforeend', `<section id="ideaCategories" class="idea-editor" hidden><h3>${t('ideas.categories')}</h3><form id="ideaCategoryForm" class="inspiration-form">${field('name', 'common.name')}<div class="inspiration-tabs"><button type="submit" class="mini-btn">${t('common.save')}</button>${button('new-category', 'ideas.newCategory')}</div></form>${data.categories.map(c => `<div class="inspiration-tabs"><span>${esc(c.name)}</span>${button(`category-edit:${c.id}`, 'common.edit')}${button(`category-delete:${c.id}`, 'common.delete')}</div>`).join('')}</section>`);
    panel.querySelector('#ideaCategoryForm').onsubmit = async event => { event.preventDefault(); capture(); await save('categories', categoryId, { name: event.target.elements.namedItem('name').value }); };
  }
  async function save(kind, id, body, remove = false) {
    if (busy) return;
    busy = true;
    panel.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      data = await api(`/api/series-ideas/${kind}${id ? '/' + id : ''}`, { method: remove ? 'DELETE' : id ? 'PUT' : 'POST', body });
      if (kind === 'entries') draft = null;
      categoryId = '';
      if (!data.categories.some(c => c.id === filter)) filter = '';
      render();
      if (kind === 'categories') panel.querySelector('#ideaCategories').hidden = false;
      toast(tr('common.saved'));
    } catch (error) { toast(error.message, 'err'); }
    finally { busy = false; panel.querySelectorAll('button').forEach(b => b.disabled = false); }
  }
  panel.onclick = async event => {
    const outlineAction = event.target.closest('[data-outline-action]')?.dataset.outlineAction;
    if (outlineAction && draft && !busy) {
      if (outlineAction.includes('remove') && !confirm(tr('outline.confirmRemove'))) return;
      capture(); IdeaOutline.change(draft, outlineAction); render(); return;
    }
    const action = event.target.closest('[data-idea-action]')?.dataset.ideaAction;
    if (!action || busy) return;
    const [kind, id] = action.split(':');
    if (kind === 'view' || kind === 'back') {
      viewingId = kind === 'view' ? id : '';
      render(); panel.scrollIntoView({ block: 'start' });
    }
    if (kind === 'categories') { capture(); panel.querySelector('#ideaCategories').hidden = !panel.querySelector('#ideaCategories').hidden; }
    if (kind === 'new' || kind === 'edit') {
      if (draft && !confirm(tr('ideas.discard'))) return;
      viewingId = '';
      draft = kind === 'edit' ? structuredClone(data.entries.find(item => item.id === id)) : { name: '', categoryId: '', development: '', characters: [] };
      render();
    }
    if (kind === 'cancel' && confirm(tr('ideas.discard'))) { draft = null; render(); }
    if (kind === 'add-character') { capture(); draft.characters.push({}); render(); }
    if (kind === 'remove' && confirm(tr('ideas.confirmDelete'))) { capture(); draft.characters.splice(Number(id), 1); render(); }
    if (kind === 'delete' && confirm(tr('ideas.confirmDelete'))) await save('entries', id, {}, true);
    if (kind === 'category-delete' && confirm(tr('ideas.deleteCategory'))) { capture(); await save('categories', id, {}, true); }
    if (kind === 'category-edit' || kind === 'new-category') {
      categoryId = id || '';
      panel.querySelector('#ideaCategoryForm').elements.namedItem('name').value = data.categories.find(c => c.id === id)?.name || '';
      panel.querySelector('#ideaCategoryForm input').focus();
    }
  };
  panel.addEventListener('input', event => {
    if (!draft || !event.target.closest('[data-outline-editor]')) return;
    capture();
    const preview = panel.querySelector('[data-outline-preview]');
    const scroll = preview.querySelector('.outline-scroll')?.scrollLeft || 0;
    preview.innerHTML = IdeaOutline.graph(draft.outline);
    if (preview.querySelector('.outline-scroll')) preview.querySelector('.outline-scroll').scrollLeft = scroll;
  });
  tab.onclick = async () => {
    $('#seriesGrid').hidden = true; $('#seriesInspirationPanel').hidden = true;
    $('#btnNewSeries').hidden = true; $('#btnImportSeries').hidden = true;
    panel.hidden = false;
    for (const node of document.querySelectorAll('#view-series [role="tab"]')) {
      node.classList.toggle('active', node === tab); node.setAttribute('aria-selected', String(node === tab));
    }
    try { data = await api('/api/series-ideas', { task: false }); capture(); render(); }
    catch (error) { toast(error.message, 'err'); }
  };
  for (const id of ['seriesOwnTab', 'seriesFinishedTab', 'seriesInspirationTab']) {
    $('#' + id).addEventListener('click', () => { capture(); panel.hidden = true; $('#btnImportSeries').hidden = id === 'seriesInspirationTab'; tab.classList.remove('active'); tab.setAttribute('aria-selected', 'false'); });
  }
  const tabs = ['seriesOwnTab', 'seriesFinishedTab', 'seriesInspirationTab', 'seriesIdeasTab'];
  tabs.forEach((id, index) => {
    $('#' + id).onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      $('#' + tabs[next]).click(); $('#' + tabs[next]).focus();
    };
  });
  window.addEventListener('manifestador:localechange', () => { capture(); render(); i18n.apply(tab); });
  i18n.apply(document);
})();
