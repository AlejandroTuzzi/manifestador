(() => {
  const root = $('#llmWorkspace');
  let chats = [], models = [], selected = '', busy = false, timer;
  const drafts = new Map();
  const t = key => esc(tr(key));
  const active = () => chats.find(c => c.id === selected);
  function associationOptions(chat) {
    const options = [{ value: '', label: tr('llms.unlinked') }];
    for (const [type, items] of [['series', state.series], ['project', state.workspaceProjects]]) {
      for (const item of items.filter(contentIsVisible)) {
        const value = `${type}:${item.id}`;
        if (!item.archived || value === `${chat?.association?.type}:${chat?.association?.id}`) options.push({ value, label: `${tr(type === 'series' ? 'series.title' : 'llms.project')}: ${item.title || item.name}` });
      }
    }
    return options.map(o => `<option value="${esc(o.value)}"${o.value === `${chat?.association?.type}:${chat?.association?.id}` ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  }
  function render() {
    const chat = active();
    const pending = chat?.status === 'pending';
    root.innerHTML = `<div class="llm-layout"><aside class="llm-sidebar"><button class="generate-btn small" type="button" data-chat-new>${t('llms.new')}</button><div class="llm-chat-list">${chats.map(c => `<button type="button" class="tool-btn${selected === c.id ? ' active' : ''}" data-chat-id="${esc(c.id)}">${esc(c.title)} ${c.status === 'pending' ? '…' : ''}</button>`).join('')}</div></aside><div class="llm-main">
      <form id="llmSettings" class="llm-settings">
      <label>${t('common.name')}<input name="title" required maxlength="200" value="${esc(chat?.title || tr('llms.new'))}"></label>
      <label>${t('llms.model')}<select name="modelId" class="select">${models.map(m => `<option value="${esc(m.id)}"${m.id === chat?.modelId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label>${t('llms.association')}<select name="association" class="select">${associationOptions(chat)}</select></label>
      <label class="check-row"><input name="nsfw" type="checkbox"${chat?.nsfw ? ' checked' : ''}${state.config?.nsfwEnabled ? '' : ' disabled'}>${t('common.nsfwContent')}</label>
      <button type="submit" class="mini-btn"${pending ? ' disabled' : ''}>${t(chat ? 'common.save' : 'llms.create')}</button>
      ${chat ? `<button type="button" class="mini-btn danger" data-chat-delete${pending ? ' disabled' : ''}>${t('common.delete')}</button>` : ''}</form>
      <p class="hint" id="llmRates"></p>
      <div class="llm-messages" role="log" aria-label="${t('llms.messages')}">${chat?.messages.map(m => `<article class="llm-message llm-${m.role}"><header><strong>${t(m.role === 'user' ? 'llms.you' : 'llms.assistant')}</strong><button type="button" class="mini-btn" data-message-copy="${esc(m.id)}">${t('llms.copy')}</button></header><div class="llm-message-text">${esc(m.content)}</div>${m.role === 'assistant' ? `<small>${esc(models.find(model => model.id === m.modelId)?.name || m.modelId)} · ≈ US$ ${Number(m.cost || 0).toFixed(6)}</small>` : ''}</article>`).join('') || `<p class="hint">${t('llms.empty')}</p>`}</div>
      ${pending ? `<p role="status">${t('llms.generating')}</p>` : ['error', 'interrupted'].includes(chat?.status) ? `<p role="alert">${t('llms.failed')}</p>` : ''}
      ${chat ? `<form id="llmComposer"><textarea name="content" rows="5" maxlength="40000" required aria-label="${t('llms.message')}" placeholder="${t('llms.message')}">${esc(drafts.get(selected) || '')}</textarea><button type="submit" class="generate-btn small"${pending ? ' disabled' : ''}>${t('llms.send')}</button></form>` : ''}
    </div></div>`;
    const settings = $('#llmSettings');
    const rates = () => {
      const model = models.find(m => m.id === settings.elements.modelId.value);
      $('#llmRates').textContent = model ? tr('llms.rates', { input: model.input, output: model.output }) : '';
    };
    settings.elements.modelId.onchange = rates; rates();
    settings.onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      const [type, id] = settings.elements.association.value.split(':');
      await action(async () => {
        const saved = await api('/api/llm-chats' + (chat ? '/' + chat.id : ''), { method: chat ? 'PUT' : 'POST', body: { title: settings.elements.title.value, modelId: settings.elements.modelId.value, association: id ? { type, id } : null, nsfw: settings.elements.nsfw.checked } });
        selected = saved.id; await load();
      });
    };
    const composer = $('#llmComposer');
    if (composer) {
      composer.elements.content.oninput = () => drafts.set(chat.id, composer.elements.content.value);
      composer.onsubmit = async event => {
        event.preventDefault(); if (busy || pending) return;
        const content = composer.elements.content.value.trim(); if (!content) return;
        await action(async () => {
          await api(`/api/llm-chats/${chat.id}/messages`, { method: 'POST', body: { content }, task: false });
          drafts.delete(chat.id); await load();
        });
      };
    }
  }
  async function action(fn) {
    busy = true;
    root.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await fn(); } catch (error) { toast(error.message, 'err'); render(); }
    finally { busy = false; }
  }
  async function load(poll = false) {
    clearTimeout(timer);
    try {
      const result = await api('/api/llm-chats', { task: false });
      const changed = JSON.stringify(chats) !== JSON.stringify(result.chats);
      chats = result.chats; models = result.models;
      if (selected && !active()) selected = '';
      if (!poll || changed) render();
      if (chats.some(c => c.status === 'pending')) timer = setTimeout(() => load(true), 2000);
    } catch (error) { toast(error.message, 'err'); }
  }
  root.onclick = async event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    if (button.hasAttribute('data-chat-new')) { selected = ''; render(); }
    if (button.dataset.chatId) { selected = button.dataset.chatId; render(); }
    if (button.hasAttribute('data-chat-delete') && confirm(tr('llms.deleteConfirm'))) await action(async () => { await api(`/api/llm-chats/${selected}`, { method: 'DELETE' }); selected = ''; await load(); });
    if (button.dataset.messageCopy) {
      try { await navigator.clipboard.writeText(active().messages.find(m => m.id === button.dataset.messageCopy).content); }
      catch { toast(tr('llms.copyFailed'), 'err'); }
    }
  };
  $('.nav-btn[data-view="llms"]').addEventListener('click', () => load());
  $('#veniceTest').onclick = async event => {
    event.target.disabled = true;
    try { await api('/api/llm-chats/test', { method: 'POST', body: { key: $('#configForm').key_venice.value.trim() } }); toast(tr('llms.connected')); }
    catch (error) { toast(error.message, 'err'); }
    finally { event.target.disabled = false; }
  };
  window.addEventListener('manifestador:localechange', () => { if (models.length) render(); });
})();
