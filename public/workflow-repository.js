(() => {
  const form = $('#workflowRepositoryForm'), list = $('#workflowRepositoryList');
  const field = name => form.elements.namedItem(name);
  let items = [], categories = [], editing = '', busy = false;
  const filter = $('#workflowRepositoryFilter');
  function categoryOptions() {
    const selected = field('category').value, filtered = filter.value;
    const names = [...new Set([...categories, ...items.map(item => item.category).filter(Boolean)])].sort((a,b) => a.localeCompare(b, document.documentElement.lang || undefined));
    const options = names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
    field('category').innerHTML = `<option value="">${esc(tr('workflowRepo.uncategorized'))}</option>` + options;
    filter.innerHTML = `<option value="">${esc(tr('categories.all'))}</option>` + options;
    field('category').value = names.includes(selected) ? selected : '';
    filter.value = names.includes(filtered) ? filtered : '';
  }
  filter.onchange = render;
  $('#workflowRepositoryCreateCategory').onclick = async () => {
    if (busy) return;
    const name = field('newCategory').value.trim();
    if (!name) { toast(tr('categories.nameRequired'),'err'); field('newCategory').focus(); return; }
    busy = true;
    try {
      categories = await api('/api/workflow-repository-categories', { method:'POST', body:{ name } });
      categoryOptions();
      const key = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      field('category').value = categories.find(category => key(category) === key(name)) || categories[categories.length - 1];
      field('newCategory').value = '';
    } catch (error) { toast(error.message,'err'); } finally { busy = false; }
  };
  function reset() { editing = ''; form.reset(); field('file').required = true; form.hidden = true; $('#workflowRepositoryAdd').setAttribute('aria-expanded','false'); }
  function showForm() { form.hidden = false; $('#workflowRepositoryCancel').hidden = false; $('#workflowRepositoryAdd').setAttribute('aria-expanded','true'); field('title').focus(); }
  $('#workflowRepositoryAdd').onclick = () => { if (busy) return; if (form.hidden) reset(); showForm(); };
  function render() {
    const visible = items.filter(item => !filter.value || item.category === filter.value);
    list.innerHTML = visible.length ? visible.map(item => `<article class="char-card"><h3>${esc(item.title)}</h3><span class="hint">${esc(item.category || tr('workflowRepo.uncategorized'))}</span><p class="char-desc">${esc(item.description)}</p><p class="hint">${esc(item.filename)}</p><div class="char-actions"><a class="mini-btn" href="/api/workflow-repository/${encodeURIComponent(item.id)}/download" download>${IC('download')} ${esc(tr('common.download'))}</a><button type="button" class="mini-btn" data-edit="${esc(item.id)}">${esc(tr('common.edit'))}</button><button type="button" class="mini-btn danger" data-delete="${esc(item.id)}">${esc(tr('common.delete'))}</button></div></article>`).join('') : `<p class="empty-note">${esc(tr('workflowRepo.empty'))}</p>`;
  }
  async function load() {
    try { [items,categories] = await Promise.all([api('/api/workflow-repository'),api('/api/workflow-repository-categories')]); categoryOptions(); render(); } catch (error) { toast(error.message,'err'); }
  }
  $$('#snippetRepositoryTabs [data-repository-tab]').forEach(button => button.addEventListener('click', () => {
    const workflows = button.dataset.repositoryTab === 'workflows';
    $('#snippetCodePanel').hidden = workflows; $('#workflowRepositoryPanel').hidden = !workflows;
    $$('#snippetRepositoryTabs button').forEach(node => node.classList.toggle('active', node === button));
    if (workflows) load();
  }));
  $('#workflowRepositoryCancel').onclick = () => { if (!busy) { reset(); $('#workflowRepositoryAdd').focus(); } };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; form.querySelector('button[type="submit"]').disabled = true;
    try {
      const file = field('file').files[0];
      const body = { title:field('title').value, description:field('description').value, category:field('category').value };
      if (file) {
        if (file.size > 10 * 1024 * 1024 || !/\.json$/i.test(file.name)) throw new Error(tr('errors.workflowRepositoryInvalid'));
        body.content = await file.text(); body.filename = file.name;
      }
      const newCategory = field('newCategory').value.trim();
      if (newCategory) {
        categories = await api('/api/workflow-repository-categories', { method:'POST', body:{ name:newCategory } });
        const key = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        body.category = categories.find(category => key(category) === key(newCategory)) || categories[categories.length - 1];
        categoryOptions();
        field('category').value = body.category;
        field('newCategory').value = '';
      }
      const saved = await api('/api/workflow-repository' + (editing ? '/' + editing : ''), { method:editing ? 'PUT' : 'POST', body });
      items = [saved,...items.filter(item => item.id !== saved.id)]; reset(); categoryOptions(); filter.value = saved.category || ''; render(); toast(tr('workflowRepo.saved'));
    } catch (error) { toast(error.message,'err'); }
    finally { busy = false; form.querySelector('button[type="submit"]').disabled = false; }
  };
  list.onclick = async event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    const item = items.find(item => item.id === (button.dataset.edit || button.dataset.delete)); if (!item) return;
    if (button.dataset.edit) {
      editing = item.id; field('title').value = item.title; field('description').value = item.description;
      field('category').value = item.category || '';
      field('newCategory').value = '';
      field('file').value = ''; field('file').required = false; showForm(); return;
    }
    if (!confirm(tr('workflowRepo.deleteConfirm', { title:item.title }))) return;
    busy = true; button.disabled = true;
    try { await api('/api/workflow-repository/' + item.id, { method:'DELETE' }); items = items.filter(other => other.id !== item.id); if (editing === item.id) reset(); render(); }
    catch (error) { toast(error.message,'err'); } finally { busy = false; button.disabled = false; }
  };
})();
