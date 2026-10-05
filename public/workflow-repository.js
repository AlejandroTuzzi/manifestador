(() => {
  const form = $('#workflowRepositoryForm'), list = $('#workflowRepositoryList');
  const field = name => form.elements.namedItem(name);
  let items = [], editing = '', busy = false;
  function reset() { editing = ''; form.reset(); field('file').required = true; $('#workflowRepositoryCancel').hidden = true; }
  function render() {
    list.innerHTML = items.length ? items.map(item => `<article class="char-card"><h3>${esc(item.title)}</h3><p class="char-desc">${esc(item.description)}</p><p class="hint">${esc(item.filename)}</p><div class="char-actions"><a class="mini-btn" href="/api/workflow-repository/${encodeURIComponent(item.id)}/download" download>${IC('download')} ${esc(tr('common.download'))}</a><button type="button" class="mini-btn" data-edit="${esc(item.id)}">${esc(tr('common.edit'))}</button><button type="button" class="mini-btn danger" data-delete="${esc(item.id)}">${esc(tr('common.delete'))}</button></div></article>`).join('') : `<p class="empty-note">${esc(tr('workflowRepo.empty'))}</p>`;
  }
  async function load() {
    try { items = await api('/api/workflow-repository'); render(); } catch (error) { toast(error.message,'err'); }
  }
  $$('#snippetRepositoryTabs [data-repository-tab]').forEach(button => button.addEventListener('click', () => {
    const workflows = button.dataset.repositoryTab === 'workflows';
    $('#snippetCodePanel').hidden = workflows; $('#workflowRepositoryPanel').hidden = !workflows;
    $$('#snippetRepositoryTabs button').forEach(node => node.classList.toggle('active', node === button));
    if (workflows) load();
  }));
  $('#workflowRepositoryCancel').onclick = () => { if (!busy) reset(); };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; form.querySelector('button[type="submit"]').disabled = true;
    try {
      const file = field('file').files[0];
      const body = { title:field('title').value, description:field('description').value };
      if (file) {
        if (file.size > 10 * 1024 * 1024 || !/\.json$/i.test(file.name)) throw new Error(tr('errors.workflowRepositoryInvalid'));
        body.content = await file.text(); body.filename = file.name;
      }
      const saved = await api('/api/workflow-repository' + (editing ? '/' + editing : ''), { method:editing ? 'PUT' : 'POST', body });
      items = [saved,...items.filter(item => item.id !== saved.id)]; reset(); render(); toast(tr('workflowRepo.saved'));
    } catch (error) { toast(error.message,'err'); }
    finally { busy = false; form.querySelector('button[type="submit"]').disabled = false; }
  };
  list.onclick = async event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    const item = items.find(item => item.id === (button.dataset.edit || button.dataset.delete)); if (!item) return;
    if (button.dataset.edit) {
      editing = item.id; field('title').value = item.title; field('description').value = item.description;
      field('file').value = ''; field('file').required = false; $('#workflowRepositoryCancel').hidden = false; field('title').focus(); return;
    }
    if (!confirm(tr('workflowRepo.deleteConfirm', { title:item.title }))) return;
    busy = true; button.disabled = true;
    try { await api('/api/workflow-repository/' + item.id, { method:'DELETE' }); items = items.filter(other => other.id !== item.id); if (editing === item.id) reset(); render(); }
    catch (error) { toast(error.message,'err'); } finally { busy = false; button.disabled = false; }
  };
})();
