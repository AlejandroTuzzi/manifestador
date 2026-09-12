/* Curated references live separately from production series and their assets. */
(() => {
  const fields = ['rating', 'consistency', 'quality', 'continuity', 'narrative', 'sound'];
  let collection = { entries: [], producers: [] };
  let active = false, loaded = false, requestVersion = 0, draft = null, producerId = '', busy = false, producerBusy = false;
  let filters = { query: '', genre: '', producer: '', minimum: '' };
  const panel = $('#seriesInspirationPanel');
  const label = key => esc(tr(`inspiration.${key}`));
  const button = (key, action, icon = '') => `<button type="button" class="tool-btn" data-action="${action}">${icon ? IC(icon) : ''}<span data-i18n="inspiration.${key}">${label(key)}</span></button>`;
  const translatedLabel = (key, control) => `<label><span data-i18n="${key}">${esc(tr(key))}</span>${control}</label>`;
  const input = (name, key, type = 'text', required = false, max = 200) => translatedLabel(key, `<input name="${name}" type="${type}" maxlength="${max}"${required ? ' required' : ''}>`);
  const textarea = (name, key) => translatedLabel(key, `<textarea name="${name}" maxlength="10000"></textarea>`);
  const closeButton = '<button type="button" class="icon-btn" data-close data-i18n-aria-label="common.close">' + IC('x') + '</button>';
  const nsfwInput = '<label class="check-row inspiration-nsfw"><input name="nsfw" type="checkbox"><span data-i18n="common.nsfwContent"></span></label>';
  document.body.insertAdjacentHTML('beforeend', `
    <input id="inspirationImportFile" type="file" accept=".zip,application/zip" hidden>
    <div id="inspirationEditor" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="inspirationEditorTitle">
      <form id="inspirationForm" class="modal-box form-modal-box inspiration-form">
        <div class="modal-head"><h3 id="inspirationEditorTitle" data-i18n="inspiration.entry"></h3>${closeButton}</div>
        ${input('title', 'common.title', 'text', true)}
        ${translatedLabel('inspiration.cover', '<input name="cover" type="file" accept="image/png,image/jpeg,image/webp">')}
        <p class="hint" data-i18n="inspiration.coverHint"></p>
        <img id="inspirationCoverPreview" class="inspiration-preview" alt="" hidden>
        ${button('removeCover', 'remove-cover')}
        ${input('url', 'inspiration.link', 'url', false, 2000)}
        ${translatedLabel('inspiration.producer', '<select name="producerId" class="select"></select>')}
        ${button('producers', 'producers', 'plus')}
        ${input('genre', 'inspiration.genre', 'text', false, 100)}
        ${translatedLabel('inspiration.episodeCount', '<input name="episodeCount" type="number" min="1" step="1">')}
        ${translatedLabel('inspiration.episodeDurationMinutes', '<input name="episodeDurationMinutes" type="number" min="0" step="any">')}
        <p class="hint" data-i18n="inspiration.episodesHint"></p>
        <div id="inspirationRatings" class="inspiration-ratings"></div>
        ${translatedLabel('inspiration.tags', '<div class="inspiration-tag-input"><input name="tagInput" type="text" maxlength="100" data-i18n-placeholder="inspiration.tagHint">' + button('addTag', 'add-tag', 'plus') + '</div>')}
        <div id="inspirationTags" class="inspiration-tags"></div>
        <p class="hint" data-i18n="inspiration.reuseTags"></p>
        <div id="inspirationTagSuggestions" class="inspiration-tags" role="group" data-i18n-aria-label="inspiration.reuseTags"></div>
        ${textarea('description', 'common.description')}
        ${textarea('appreciation', 'inspiration.appreciation')}
        ${nsfwInput}
        <div class="form-modal-actions"><button type="button" class="tool-btn" data-close data-i18n="common.cancel"></button><button type="submit" class="generate-btn small" data-i18n="common.save"></button></div>
      </form>
    </div>
    <div id="inspirationProducers" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="inspirationProducersTitle">
      <div class="modal-box form-modal-box inspiration-form">
        <div class="modal-head"><h3 id="inspirationProducersTitle" data-i18n="inspiration.producers"></h3>${closeButton}</div>
        <form id="inspirationProducerForm" class="inspiration-producer-form">
          <h4 id="inspirationProducerMode"></h4>
          ${input('name', 'common.name', 'text', true, 160)}
          ${textarea('description', 'common.description')}
          ${input('url', 'inspiration.producerLink', 'url', false, 2000)}
          ${nsfwInput}
          <div class="form-modal-actions">${button('newProducer', 'new-producer', 'plus')}<button type="submit" class="generate-btn small" data-i18n="common.save"></button></div>
        </form>
        <div id="inspirationProducerList"></div>
      </div>
    </div>`);
  const editor = $('#inspirationEditor'), form = $('#inspirationForm');
  const producersModal = $('#inspirationProducers'), producerForm = $('#inspirationProducerForm');
  const control = name => form.elements.namedItem(name);
  function translate() { i18n.apply(document); }
  function sortedProducers() { return collection.producers.filter(contentIsVisible).slice().sort((a, b) => a.name.localeCompare(b.name, i18n.localeTag())); }
  function options(items, selected, emptyKey) {
    return `<option value="">${label(emptyKey)}</option>` + items.map(([value, text]) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(text)}</option>`).join('');
  }
  function starText(value) { return `<span class="inspiration-stars-read" aria-label="${esc(tr('inspiration.stars', { count: value }))}" title="${esc(tr('inspiration.stars', { count: value }))}">${'★'.repeat(value)}<span>${'☆'.repeat(5 - value)}</span></span>`; }
  function renderCards() {
    const query = filters.query.trim().toLocaleLowerCase(i18n.localeTag());
    const entries = collection.entries.filter(contentIsVisible).filter(item => {
      const producer = collection.producers.find(p => p.id === item.producerId);
      const text = [item.title, item.description, item.appreciation, item.genre, producer?.name, ...item.tags].join(' ').toLocaleLowerCase(i18n.localeTag());
      return (!query || text.includes(query)) && (!filters.genre || item.genre === filters.genre) && (!filters.producer || item.producerId === filters.producer) && (!filters.minimum || item.rating >= Number(filters.minimum));
    }).sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title, i18n.localeTag()));
    $('#inspirationCards').innerHTML = entries.map(item => {
      const producer = collection.producers.find(p => p.id === item.producerId);
      return `<article class="char-card inspiration-card" data-entry="${esc(item.id)}">
        ${item.imageKey ? `<button type="button" class="inspiration-cover" data-action="cover" aria-label="${label('viewCover')}"><img src="${fileUrl(item.imageKey)}" alt="${esc(item.title)}" loading="lazy"></button>` : ''}
        <h3>${esc(item.title)} ${nsfwBadgeHtml(item)}</h3>
        ${item.episodeCount ? `<p class="hint">${label('episodeCount')}: ${esc(i18n.formatNumber(item.episodeCount))}</p>` : ''}
        ${item.episodeDurationMinutes ? `<p class="hint">${esc(tr('inspiration.episodeDurationSummary', { minutes: i18n.formatNumber(item.episodeDurationMinutes, { maximumFractionDigits: 3 }) }))}</p>` : ''}
        <div class="inspiration-tags">${item.genre ? `<span class="chip">${esc(item.genre)}</span>` : ''}${item.tags.map(tag => `<span class="chip">${esc(tag)}</span>`).join('')}</div>
        ${producer ? `<p class="inspiration-credit">${label('producer')}: <button type="button" class="mini-btn" data-action="producer" data-producer="${esc(producer.id)}">${esc(producer.name)}</button></p>` : ''}
        <div class="inspiration-ratings">${fields.map(field => `<div class="inspiration-rating"><span>${label(field)}</span>${starText(item[field] ?? 3)}</div>`).join('')}</div>
        ${item.description ? `<p class="profile-text">${esc(item.description)}</p>` : ''}
        ${item.appreciation ? `<details><summary>${label('appreciation')}</summary><p class="profile-text">${esc(item.appreciation)}</p></details>` : ''}
        <div class="inspiration-actions">${item.url ? `<a class="tool-btn" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${label('watch')}</a>` : ''}
          <button type="button" class="tool-btn" data-action="edit">${IC('edit')} ${esc(tr('common.edit'))}</button>
          <button type="button" class="tool-btn" data-action="delete">${IC('trash')} ${esc(tr('common.delete'))}</button></div>
      </article>`;
    }).join('') || `<p class="hint">${label('empty')}</p>`;
  }
  function renderPanel() {
    panel.innerHTML = `<div class="inspiration-actions">${button('new', 'new', 'plus')}${button('producers', 'producers')}${button('refresh', 'refresh')}${button('export', 'export', 'download')}${button('import', 'import', 'upload')}</div><p class="hint">${label('transferHint')}</p>
      <div class="inspiration-filters">
        ${translatedLabel('common.search', '<input id="inspirationSearch" type="search">')}
        ${translatedLabel('inspiration.genre', '<select id="inspirationGenre" class="select"></select>')}
        ${translatedLabel('inspiration.producer', '<select id="inspirationProducerFilter" class="select"></select>')}
        ${translatedLabel('inspiration.minimum', '<select id="inspirationMinimum" class="select"></select>')}
      </div><div id="inspirationCards" class="chars-grid"></div>`;
    $('#inspirationSearch').value = filters.query;
    const genres = [...new Set(collection.entries.filter(contentIsVisible).map(item => item.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, i18n.localeTag()));
    if (!genres.includes(filters.genre)) filters.genre = '';
    if (!collection.producers.some(p => p.id === filters.producer)) filters.producer = '';
    $('#inspirationGenre').innerHTML = options(genres.map(value => [value, value]), filters.genre, 'allGenres');
    $('#inspirationProducerFilter').innerHTML = options(sortedProducers().map(p => [p.id, p.name]), filters.producer, 'allProducers');
    $('#inspirationMinimum').innerHTML = options([1, 2, 3, 4, 5].map(value => [String(value), tr('inspiration.stars', { count: value })]), filters.minimum, 'anyRating');
    for (const [id, key] of [['inspirationSearch', 'query'], ['inspirationGenre', 'genre'], ['inspirationProducerFilter', 'producer'], ['inspirationMinimum', 'minimum']]) {
      $('#' + id).addEventListener('input', event => { filters[key] = event.target.value; renderCards(); });
    }
    renderCards();
    translate();
  }
  async function load() {
    const version = ++requestVersion;
    if (!loaded) panel.innerHTML = `<p class="hint">${label('loading')}</p>`;
    try {
      const result = await api('/api/series-inspiration');
      if (version !== requestVersion) return;
      collection = result; loaded = true; renderPanel();
    } catch (error) {
      if (version !== requestVersion) return;
      panel.innerHTML = `<p class="hint">${esc(error.message)}</p>${button('refresh', 'refresh')}`;
    }
  }
  function acceptResult(result) { ++requestVersion; collection = result; loaded = true; renderPanel(); }
  function setTab(value) {
    active = value; panel.hidden = !value; $('#seriesGrid').hidden = value; $('#btnNewSeries').hidden = value;
    for (const [id, selected] of [['seriesOwnTab', !value], ['seriesInspirationTab', value]]) {
      $('#' + id).classList.toggle('active', selected); $('#' + id).setAttribute('aria-selected', String(selected));
    }
    if (value) load();
  }
  $('#seriesOwnTab').onclick = () => setTab(false);
  $('#seriesInspirationTab').onclick = () => setTab(true);
  for (const id of ['seriesOwnTab', 'seriesInspirationTab']) $('#' + id).onkeydown = event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setTab(event.key === 'Home' ? false : event.key === 'End' ? true : !active); $(active ? '#seriesInspirationTab' : '#seriesOwnTab').focus(); }
  };
  $('.nav-btn[data-view="series"]')?.addEventListener('click', () => { if (active) load(); });
  function producerOptions(selected = control('producerId').value) {
    control('producerId').innerHTML = options(sortedProducers().map(p => [p.id, p.name]), selected, 'noProducer');
  }
  function renderRatings() {
    $('#inspirationRatings').innerHTML = fields.map(field => `<div class="inspiration-rating"><span id="inspiration-rating-${field}">${label(field)}</span><div class="inspiration-stars" role="radiogroup" aria-labelledby="inspiration-rating-${field}">${[1, 2, 3, 4, 5].map(value => `<button type="button" role="radio" aria-checked="${draft[field] === value}" tabindex="${draft[field] === value ? 0 : -1}" class="${value <= draft[field] ? 'filled' : ''}" data-rating="${field}" data-value="${value}" aria-label="${esc(tr('inspiration.stars', { count: value }))}">★</button>`).join('')}</div></div>`).join('');
  }
  function renderTags() {
    $('#inspirationTags').innerHTML = draft.tags.map((tag, index) => `<button type="button" class="mini-btn" data-tag="${index}" aria-label="${esc(tr('inspiration.removeTag', { tag }))}">${esc(tag)} ${IC('x')}</button>`).join('');
    renderTagSuggestions();
  }
  function renderTagSuggestions() {
    const normalize = value => String(value).trim().toLocaleLowerCase(i18n.localeTag());
    const selected = new Set(draft.tags.map(normalize));
    const query = normalize(control('tagInput').value);
    const available = new Map();
    for (const entry of collection.entries.filter(contentIsVisible)) for (const tag of entry.tags || []) {
      const key = normalize(tag);
      if (key && !selected.has(key) && (!query || key.includes(query)) && !available.has(key)) available.set(key, tag);
    }
    const tags = [...available.values()].sort((a, b) => a.localeCompare(b, i18n.localeTag())).slice(0, 30);
    $('#inspirationTagSuggestions').innerHTML = tags.map(tag => `<button type="button" class="mini-btn" data-existing-tag="${esc(tag)}"${draft.tags.length >= 50 ? ' disabled' : ''}>${IC('plus')} ${esc(tag)}</button>`).join('') || `<span class="hint">${label('noTagSuggestions')}</span>`;
  }
  function addTags() {
    for (const text of control('tagInput').value.split(/[,;\n]/)) {
      const tag = text.trim().slice(0, 100);
      if (tag && draft.tags.length < 50 && !draft.tags.some(old => old.toLowerCase() === tag.toLowerCase())) draft.tags.push(tag);
    }
    control('tagInput').value = ''; renderTags();
  }
  function preview() {
    const source = draft.pendingImage || (draft.imageKey ? fileUrl(draft.imageKey) : '');
    const image = $('#inspirationCoverPreview'); image.hidden = !source;
    if (source) image.src = source; else image.removeAttribute('src');
    form.querySelector('[data-action="remove-cover"]').hidden = !source;
  }
  function openEntry(item = {}) {
    draft = { ...item, tags: [...(item.tags || [])], imageKey: item.imageKey || '', pendingImage: '', pendingName: '' };
    form.reset();
    for (const field of fields) draft[field] = item[field] ?? 3;
    for (const name of ['title', 'url', 'genre', 'description', 'appreciation']) control(name).value = item[name] || '';
    for (const name of ['episodeCount', 'episodeDurationMinutes']) control(name).value = item[name] ?? '';
    control('nsfw').checked = item.nsfw ?? Boolean(state.config?.nsfwUploadDefault);
    form.querySelector('.inspiration-nsfw').hidden = !state.config?.nsfwEnabled;
    producerOptions(item.producerId || ''); renderRatings(); renderTags(); preview(); translate();
    editor.hidden = false; control('title').focus();
  }
  function closeEntry() { if (busy) return; editor.hidden = true; draft = null; $('#seriesInspirationTab').focus(); }
  function resetProducer(item = {}) {
    producerId = item.id || ''; producerForm.reset();
    for (const name of ['name', 'description', 'url']) producerForm.elements.namedItem(name).value = item[name] || '';
    producerForm.elements.namedItem('nsfw').checked = item.nsfw ?? Boolean(state.config?.nsfwUploadDefault);
    producerForm.querySelector('.inspiration-nsfw').hidden = !state.config?.nsfwEnabled;
    $('#inspirationProducerMode').textContent = tr(item.id ? 'inspiration.editProducer' : 'inspiration.newProducer');
  }
  function renderProducers() {
    $('#inspirationProducerList').innerHTML = sortedProducers().map(p => `<article class="inspiration-producer" data-producer="${esc(p.id)}"><h4>${esc(p.name)} ${nsfwBadgeHtml(p)}</h4><p class="profile-text">${esc(p.description)}</p><div class="inspiration-actions">${p.url ? `<a class="tool-btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${label('producerLink')}</a>` : ''}<button type="button" class="tool-btn" data-action="edit-producer">${esc(tr('common.edit'))}</button><button type="button" class="tool-btn" data-action="delete-producer">${esc(tr('common.delete'))}</button></div></article>`).join('') || `<p class="hint">${label('noProducers')}</p>`;
  }
  function openProducers(id = '') { resetProducer(collection.producers.find(p => p.id === id)); renderProducers(); translate(); producersModal.hidden = false; producerForm.elements.namedItem('name').focus(); }
  function closeProducers() { if (producerBusy) return; producersModal.hidden = true; (editor.hidden ? $('#seriesInspirationTab') : control('producerId')).focus(); }
  for (const node of editor.querySelectorAll('[data-close]')) node.onclick = closeEntry;
  for (const node of producersModal.querySelectorAll('[data-close]')) node.onclick = closeProducers;
  function setBusy(root, value) { root.querySelectorAll('button, input, textarea, select').forEach(node => { node.disabled = value; }); }
  panel.onclick = async event => {
    const target = event.target.closest('[data-action]'); if (!target || busy || producerBusy) return;
    const action = target.dataset.action;
    const item = collection.entries.find(item => item.id === target.closest('[data-entry]')?.dataset.entry);
    if (action === 'new') openEntry();
    if (action === 'producers') openProducers();
    if (action === 'refresh') load();
    if (action === 'import') $('#inspirationImportFile').click();
    if (action === 'export') {
      busy = true; target.disabled = true;
      try {
        const response = await fetch('/api/series-inspiration/export');
        if (!response.ok) throw new Error(i18n.errorMessage(await response.json(), `HTTP ${response.status}`));
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'inspiration.manifestador.zip'; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { toast(error.message, 'err'); }
      finally { busy = false; target.disabled = false; }
    }
    if (action === 'producer') openProducers(target.dataset.producer);
    if (action === 'edit' && item) openEntry(item);
    if (action === 'cover' && item?.imageKey) openLightbox(item.imageKey, [item.imageKey]);
    if (action === 'delete' && item && confirm(tr('inspiration.confirmDelete', { title: item.title }))) {
      busy = true; target.disabled = true;
      try { acceptResult(await api(`/api/series-inspiration/entries/${item.id}`, { method: 'DELETE' })); }
      catch (error) { toast(error.message, 'err'); } finally { busy = false; target.disabled = false; }
    }
  };
  $('#inspirationImportFile').onchange = async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || busy) return;
    if (file.size > 150 * 1024 * 1024) { toast(tr('errors.transferSize'), 'err'); return; }
    busy = true; setBusy(panel, true);
    try {
      const data = await readFileAsDataUrl(file);
      const result = await api('/api/series-inspiration/import', { method: 'POST', body: { zipBase64: data.split(',')[1] } });
      acceptResult(result);
      toast(tr('transfer.summary', { imported: i18n.formatNumber(result.imported), skipped: i18n.formatNumber(result.skipped), hidden: i18n.formatNumber(result.hidden) }));
    } catch (error) { toast(error.message || tr('errors.transferManifest'), 'err'); }
    finally { busy = false; setBusy(panel, false); }
  };
  form.onclick = event => {
    if (busy) return;
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.rating) { draft[target.dataset.rating] = Number(target.dataset.value); renderRatings(); form.querySelector(`[data-rating="${target.dataset.rating}"][data-value="${target.dataset.value}"]`).focus(); }
    if (target.dataset.tag !== undefined) { draft.tags.splice(Number(target.dataset.tag), 1); renderTags(); }
    if (target.dataset.existingTag !== undefined) { control('tagInput').value = target.dataset.existingTag; addTags(); control('tagInput').focus(); }
    if (target.dataset.action === 'add-tag') addTags();
    if (target.dataset.action === 'producers') openProducers();
    if (target.dataset.action === 'remove-cover') { draft.pendingImage = ''; draft.imageKey = ''; control('cover').value = ''; preview(); }
  };
  control('tagInput').oninput = () => { if (draft) renderTagSuggestions(); };
  form.onkeydown = event => {
    const target = event.target;
    if (target.dataset.rating && ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const value = event.key === 'Home' ? 1 : event.key === 'End' ? 5 : Math.max(1, Math.min(5, Number(target.dataset.value) + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1)));
      form.querySelector(`[data-rating="${target.dataset.rating}"][data-value="${value}"]`).click();
    }
    if (target === control('tagInput') && ['Enter', ','].includes(event.key)) { event.preventDefault(); addTags(); }
  };
  control('cover').onchange = async () => {
    const file = control('cover').files[0], current = draft;
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { control('cover').value = ''; toast(tr('inspiration.imageError'), 'err'); return; }
    busy = true; setBusy(editor, true);
    try { const data = await readFileAsDataUrl(file); if (current === draft) { draft.pendingImage = data; draft.pendingName = file.name; preview(); } }
    catch { toast(tr('inspiration.imageError'), 'err'); }
    finally { busy = false; setBusy(editor, false); }
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !draft) return;
    addTags(); busy = true; setBusy(editor, true);
    try {
      const body = { tags: draft.tags, imageKey: draft.imageKey, nsfw: Boolean(state.config?.nsfwEnabled && control('nsfw').checked) };
      for (const name of ['title', 'url', 'producerId', 'genre', 'description', 'appreciation']) body[name] = control(name).value;
      for (const field of fields) body[field] = draft[field];
      for (const name of ['episodeCount', 'episodeDurationMinutes']) body[name] = control(name).value === '' ? null : Number(control(name).value);
      if ((body.episodeCount !== null && (!Number.isSafeInteger(body.episodeCount) || body.episodeCount <= 0)) || (body.episodeDurationMinutes !== null && (!Number.isFinite(body.episodeDurationMinutes) || body.episodeDurationMinutes <= 0))) throw new Error(tr('errors.inspirationEpisodes'));
      if (draft.pendingImage) {
        const uploaded = await api('/api/assets/visual', { method: 'POST', body: { name: draft.pendingName, dataUrl: draft.pendingImage, nsfw: body.nsfw } });
        draft.imageKey = uploaded.key; draft.pendingImage = ''; body.imageKey = uploaded.key; preview();
      }
      const result = await api('/api/series-inspiration/entries' + (draft.id ? '/' + draft.id : ''), { method: draft.id ? 'PUT' : 'POST', body });
      acceptResult(result); busy = false; closeEntry(); toast(tr('common.saved'));
    } catch (error) { toast(error.message, 'err'); }
    finally { busy = false; setBusy(editor, false); }
  };
  producersModal.onclick = async event => {
    const target = event.target.closest('[data-action]'); if (!target || producerBusy) return;
    if (target.dataset.action === 'new-producer') { resetProducer(); producerForm.elements.namedItem('name').focus(); }
    const id = target.closest('[data-producer]')?.dataset.producer;
    if (target.dataset.action === 'edit-producer') { resetProducer(collection.producers.find(p => p.id === id)); producerForm.elements.namedItem('name').focus(); }
    if (target.dataset.action === 'delete-producer' && confirm(tr('inspiration.confirmProducerDelete'))) {
      producerBusy = true; setBusy(producersModal, true);
      try {
        acceptResult(await api(`/api/series-inspiration/producers/${id}`, { method: 'DELETE' }));
        if (producerId === id) resetProducer(); renderProducers(); producerOptions();
      } catch (error) { toast(error.message, 'err'); }
      finally { producerBusy = false; setBusy(producersModal, false); }
    }
  };
  producerForm.onsubmit = async event => {
    event.preventDefault(); if (producerBusy) return;
    producerBusy = true; setBusy(producersModal, true);
    try {
      const body = {}; for (const name of ['name', 'description', 'url']) body[name] = producerForm.elements.namedItem(name).value;
      body.nsfw = Boolean(state.config?.nsfwEnabled && producerForm.elements.namedItem('nsfw').checked);
      const result = await api('/api/series-inspiration/producers' + (producerId ? '/' + producerId : ''), { method: producerId ? 'PUT' : 'POST', body });
      acceptResult(result); producerOptions(editor.hidden ? control('producerId').value : result.id); resetProducer(); renderProducers(); toast(tr('common.saved'));
    } catch (error) { toast(error.message, 'err'); }
    finally { producerBusy = false; setBusy(producersModal, false); }
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (!producersModal.hidden) closeProducers(); else if (!editor.hidden) closeEntry(); }
    if (event.key === 'Tab') {
      const modal = !producersModal.hidden ? producersModal : !editor.hidden ? editor : null;
      if (!modal) return;
      const nodes = [...modal.querySelectorAll('button, input, textarea, select, a[href]')].filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  window.addEventListener('manifestador:localechange', () => { if (loaded) renderPanel(); if (draft) { renderRatings(); renderTags(); producerOptions(); } renderProducers(); $('#inspirationProducerMode').textContent = tr(producerId ? 'inspiration.editProducer' : 'inspiration.newProducer'); translate(); });
  translate();
})();
