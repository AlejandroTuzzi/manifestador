(() => {
  const root = $('#llmWorkspace');
  let chats = [], models = [], selected = '', busy = false, timer;
  const drafts = new Map();
  const fileDrafts = new Map();
  const fileLinks = files => `<div class="llm-attachments">${(files || []).map(f => `<a class="mini-btn" href="/api/chat-files/${encodeURIComponent(f.id)}" download>${esc(f.name)}</a>`).join('')}</div>`;
  let archiveView = false;
  const t = key => esc(tr(key));
  const active = () => chats.find(c => c.id === selected);
  function scrollChatToEnd() {
    const messages = root.querySelector('.llm-messages');
    if (!messages) return;
    // Scroll only the conversation, never the page or another open view.
    messages.scrollTop = messages.scrollHeight;
    requestAnimationFrame(() => {
      if (messages.isConnected) messages.scrollTop = messages.scrollHeight;
    });
  }
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
    releaseChatDictation();
    const chat = active();
    const pending = chat?.status === 'pending';
    root.innerHTML = `<div class="llm-layout"><aside class="llm-sidebar"><button class="generate-btn small" type="button" data-chat-new>${t('llms.new')}</button><div class="llm-list-tabs"><button type="button" class="mini-btn${!archiveView ? ' accent' : ''}" data-chat-list="current" aria-pressed="${!archiveView}">${t('llms.current')}</button><button type="button" class="mini-btn${archiveView ? ' accent' : ''}" data-chat-list="archive" aria-pressed="${archiveView}">${t('llms.archived')}</button></div><div class="llm-chat-list">${chats.filter(c => Boolean(c.archived) === archiveView).map(c => `<button type="button" class="tool-btn${selected === c.id ? ' active' : ''}" data-chat-id="${esc(c.id)}">${esc(c.title)} ${c.status === 'pending' ? '…' : ''}</button>`).join('')}</div></aside><div class="llm-main">
      <form id="llmSettings" class="llm-settings">
      <label>${t('common.name')}<input name="title" required maxlength="200" value="${esc(chat?.title || tr('llms.new'))}"></label>
      <label>${t('llms.model')}<select name="modelId" class="select">${models.map(m => `<option value="${esc(m.id)}"${m.id === chat?.modelId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label>${t('llms.association')}<select name="association" class="select">${associationOptions(chat)}</select></label>
      <label class="check-row"><input name="nsfw" type="checkbox"${chat?.nsfw ? ' checked' : ''}${state.config?.nsfwEnabled ? '' : ' disabled'}>${t('common.nsfwContent')}</label>
      <button type="submit" class="mini-btn"${pending ? ' disabled' : ''}>${t(chat ? 'common.save' : 'llms.create')}</button>
      ${chat ? `<button type="button" class="mini-btn" data-chat-archive${pending ? ' disabled' : ''}>${t(chat.archived ? 'llms.restore' : 'llms.archive')}</button><button type="button" class="mini-btn danger" data-chat-delete${pending ? ' disabled' : ''}>${t('common.delete')}</button>` : ''}</form>
      <p class="hint" id="llmRates"></p>
      ${chat ? `<button type="button" class="mini-btn" data-chat-context>${t('llms.viewContext')}</button><div id="llmContext" class="llm-message" hidden></div>` : ''}
      <div class="llm-messages" role="log" aria-label="${t('llms.messages')}">${chat?.messages.map(m => `<article class="llm-message llm-${m.role}"><header><strong>${t(m.role === 'user' ? 'llms.you' : 'llms.assistant')}</strong><button type="button" class="mini-btn" data-message-copy="${esc(m.id)}">${t('llms.copy')}</button></header><div class="llm-message-text">${esc(m.content)}</div>${m.role === 'assistant' ? `<small>${esc(models.find(model => model.id === m.modelId)?.name || m.modelId)} · ≈ US$ ${Number(m.cost || 0).toFixed(6)}</small>` : ''}</article>`).join('') || `<p class="hint">${t('llms.empty')}</p>`}</div>
      <p class="llm-waiting" role="status" aria-live="polite"${pending ? '' : ' hidden'}><span class="llm-waiting-spinner" aria-hidden="true"></span><span>${t('llms.generating')}</span></p>
      ${['error', 'interrupted'].includes(chat?.status) ? `<p role="alert">${t('llms.failed')}</p>` : ''}
      ${chat?.archived ? `<p class="hint">${t('llms.archivedHint')}</p>` : chat ? `<form id="llmComposer"><textarea name="content" rows="5" maxlength="40000" required aria-label="${t('llms.message')}" placeholder="${t('llms.message')}">${esc(drafts.get(selected) || '')}</textarea><button type="submit" class="generate-btn small"${pending ? ' disabled' : ''}>${t('llms.send')}</button></form>` : ''}
    </div></div>`;
    const settings = $('#llmSettings');
    if (chat) {
      const hasImages = chat.messages.some(m => m.attachments?.some(f => f.kind === 'image'))
        || (fileDrafts.get(chat.id) || []).some(f => f.kind === 'image');
      settings.insertAdjacentHTML('beforeend', `<button type="button" class="mini-btn danger" data-chat-remove-images${pending || !hasImages ? ' disabled' : ''}>${t('llms.removeImages')}</button>`);
    }
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
    root.querySelectorAll('[data-message-copy]').forEach(copy => {
      copy.insertAdjacentHTML('afterend', `<button type="button" class="mini-btn danger" data-message-delete="${esc(copy.dataset.messageCopy)}"${pending ? ' disabled' : ''}>${t('common.delete')}</button>`);
    });
    root.querySelectorAll('.llm-message-text').forEach((node, index) => {
      node.insertAdjacentHTML('afterend', fileLinks(chat?.messages[index]?.attachments));
    });
    if (composer) {
      const dictationButton = document.createElement('button');
      dictationButton.type = 'button';
      dictationButton.className = 'tool-btn';
      dictationButton.innerHTML = `${IC('mic')} ${t('dictation.title')}`;
      dictationButton.setAttribute('aria-expanded', 'false');
      dictationButton.setAttribute('aria-controls', 'dictationPanel');
      composer.prepend(dictationButton);
      dictationButton.onclick = () => toggleChatDictation(composer.elements.content, composer, dictationButton);
      composer.elements.content.required = false;
      const model = models.find(m => m.id === chat.modelId);
      const files = fileDrafts.get(chat.id) || [];
      composer.insertAdjacentHTML('afterbegin', `<div class="llm-file-tools"><select class="select" id="llmAttach" aria-label="${t('llms.attach')}"${pending ? ' disabled' : ''}><option value="">${t('llms.attach')}</option><option value="image"${model?.vision ? '' : ' disabled'}>${t('llms.image')}</option><option value="document"${model?.documents ? '' : ' disabled'}>${t('assets.documents')}</option></select><span class="hint">${t('llms.fileHint')}</span></div><div class="llm-attachments">${files.map(f => `<span class="llm-file-chip">${esc(f.name)}<button type="button" class="mini-btn" data-file-remove="${esc(f.id)}" aria-label="${t('llms.removeFile')}">×</button></span>`).join('')}</div>`);
      $('#llmAttach').onchange = async event => {
        const kind = event.target.value; event.target.value = '';
        if (!kind || busy || pending) return;
        const remaining = 4 - (fileDrafts.get(chat.id) || []).length;
        if (!remaining) { toast(tr('errors.llmFileLimit'), 'err'); return; }
        openPicker(null, {kind, limit:remaining, nsfw:chat.nsfw, onSelect:async refs => {
          const current = [...(fileDrafts.get(chat.id) || [])];
          const documents = kind === 'document' ? (await api('/api/chat-files', {task:false})).files : [];
          const additions = [];
          for (const ref of refs) {
            if (current.some(f => f.id === ref.key || f.sourceKey === ref.key)) continue;
            const file = kind === 'document' ? documents.find(f => f.id === ref.key && f.kind === 'document')
              : await api('/api/chat-files', {method:'POST',body:{assetKey:ref.key,nsfw:chat.nsfw},task:false});
            if (!file) throw new Error(tr('errors.llmFileInvalid'));
            additions.push(file);
          }
          if (current.length + additions.length > 4) throw new Error(tr('errors.llmFileLimit'));
          fileDrafts.set(chat.id, [...current,...additions]);
          render();
        }});
      };
      composer.elements.content.oninput = () => drafts.set(chat.id, composer.elements.content.value);
      composer.elements.content.onkeydown = event => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (event.repeat || busy || pending || (!composer.elements.content.value.trim() && !fileDrafts.get(chat.id)?.length)) return;
        composer.requestSubmit();
      };
      composer.onsubmit = async event => {
        event.preventDefault(); if (busy || pending) return;
        stopPromptDictation();
        const content = composer.elements.content.value.trim();
        const attachments = (fileDrafts.get(chat.id) || []).map(f => f.id);
        if (!content && !attachments.length) return;
        root.querySelector('.llm-waiting').hidden = false;
        await action(async () => {
          await api(`/api/llm-chats/${chat.id}/messages`, { method: 'POST', body: { content, attachments }, task: false });
          drafts.delete(chat.id); fileDrafts.delete(chat.id); await load();
        });
      };
    }
    scrollChatToEnd();
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
    if (button.dataset.fileRemove) { fileDrafts.set(selected, (fileDrafts.get(selected) || []).filter(f => f.id !== button.dataset.fileRemove)); render(); }
    if (button.hasAttribute('data-chat-new')) { selected = ''; archiveView = false; render(); }
    if (button.dataset.chatList) { archiveView = button.dataset.chatList === 'archive'; selected = ''; render(); }
    if (button.hasAttribute('data-chat-archive')) await action(async () => {
      const archived = !active().archived;
      await api(`/api/llm-chats/${selected}/archive`, { method: 'PUT', body: { archived } });
      archiveView = archived; await load();
    });
    if (button.dataset.chatId) { selected = button.dataset.chatId; render(); }
    if (button.hasAttribute('data-chat-context')) {
      const box = $('#llmContext'), chatId = selected;
      if (!box.hidden) { box.hidden = true; return; }
      button.disabled = true;
      try {
        const context = await api(`/api/llm-chats/${chatId}/context`, { task: false });
        if (selected !== chatId || !box.isConnected) return;
        box.innerHTML = `<p class="hint">${t('llms.contextPreviewHint')}</p>` + (context.messages.length
          ? context.messages.map(message => `<p><strong>${t(message.role === 'system' ? 'llms.contextSystem' : 'llms.contextReference')}</strong></p><div class="llm-message-text">${esc(message.content)}</div>`).join('')
          : `<p>${t('llms.noContext')}</p>`);
        box.hidden = false;
      } catch (error) { toast(error.message, 'err'); }
      finally { button.disabled = false; }
    }
    if (button.hasAttribute('data-chat-delete') && confirm(tr('llms.deleteConfirm'))) await action(async () => { await api(`/api/llm-chats/${selected}`, { method: 'DELETE' }); selected = ''; await load(); });
    if (button.hasAttribute('data-chat-remove-images') && confirm(tr('llms.removeImagesConfirm'))) {
      const chatId = selected;
      await action(async () => {
        await api(`/api/llm-chats/${chatId}/images`, { method: 'DELETE', task: false });
        fileDrafts.set(chatId, (fileDrafts.get(chatId) || []).filter(f => f.kind !== 'image'));
        await load();
        toast(tr('llms.imagesRemoved'));
      });
    }
    if (button.dataset.messageCopy) {
      try { await navigator.clipboard.writeText(active().messages.find(m => m.id === button.dataset.messageCopy).content); }
      catch { toast(tr('llms.copyFailed'), 'err'); }
    }
    if (button.dataset.messageDelete && confirm(tr('llms.deleteMessageConfirm'))) {
      const chatId = selected;
      await action(async () => {
        await api(`/api/llm-chats/${chatId}/messages/${encodeURIComponent(button.dataset.messageDelete)}`, {method:'DELETE',task:false});
        await load();
      });
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
