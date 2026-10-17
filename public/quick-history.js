(() => {
  const trigger = $('#btnQuickHistory');
  const menu = document.createElement('div'), preview = document.createElement('div');
  menu.id = 'quickHistoryMenu'; menu.className = 'quick-history-menu'; menu.setAttribute('popover', 'manual');
  preview.className = 'quick-history-preview'; preview.setAttribute('popover', 'manual');
  document.body.append(menu, preview);
  let version = 0, snapshots = [], opened = false;
  const text = key => esc(tr(key));
  const name = snapshot => {
    const id = snapshot.request?.modelId || snapshot.request?.audioModelId || snapshot.modelId;
    return [...state.models, ...state.videoModels, ...(state.audioModels || [])].find(model => model.id === id)?.name || id || '';
  };
  function position(node, rect, above = false) {
    const width = node.offsetWidth, height = node.offsetHeight;
    const top = above ? rect.top - height - 8 : rect.bottom + 8;
    node.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
  }
  function close() {
    ++version; opened = false;
    menu.hidePopover(); preview.hidePopover(); trigger.setAttribute('aria-expanded', 'false');
  }
  window.closeQuickHistory = close;
  function showPreview(snapshot) {
    const body = snapshot.request || {};
    const refs = Array.isArray(body.refs) ? body.refs : Object.values(body.refs || {});
    preview.innerHTML = `<strong>${esc(name(snapshot))}</strong><p class="hint">${esc([body.resolution, body.aspectRatio, body.duration ? `${body.duration}s` : '', body.voiceId || ''].filter(Boolean).join(' · '))}</p><div class="quick-history-prompt">${esc(body.prompt ?? body.text ?? '')}</div><div class="quick-history-refs">${refs.map((key, i) => {
      const kind = body.refKinds?.[i] || (/\.(mp3|wav|m4a|ogg)$/i.test(key) ? 'audio' : /\.(mp4|mov|webm)$/i.test(key) ? 'video' : 'image');
      return `<div>${kind === 'image' ? `<img src="${esc(fileUrl(key))}" loading="lazy" alt="">` : `<span>${IC(kind === 'audio' ? 'mic' : 'film')}</span>`}<small>${esc(body.referenceLabels?.[i] || key.split('/').pop())}</small></div>`;
    }).join('')}</div>`;
    preview.showPopover();
    const rect = menu.getBoundingClientRect();
    // Use the free side of the menu; never cover its selectable rows.
    const right = innerWidth - rect.right - 16, left = rect.left - 16;
    preview.style.width = ''; preview.style.maxHeight = '';
    if (Math.max(right, left) >= 260) {
      const useRight = right >= left, room = useRight ? right : left;
      preview.style.width = `${Math.min(520, room)}px`;
      preview.style.left = `${useRight ? rect.right + 8 : rect.left - preview.offsetWidth - 8}px`;
      preview.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - preview.offsetHeight - 8))}px`;
    } else {
      const above = rect.top - 16, below = innerHeight - rect.bottom - 16;
      preview.style.maxHeight = `${Math.max(60, Math.max(above, below))}px`;
      position(preview, rect, above >= below);
    }
  }
  trigger.addEventListener('click', async () => {
    if (opened) { close(); return; }
    opened = true; const request = ++version, mode = state.mode;
    trigger.setAttribute('aria-expanded', 'true');
    menu.innerHTML = `<p class="hint">${text('quickHistory.loading')}</p>`;
    menu.showPopover(); position(menu, trigger.getBoundingClientRect());
    try {
      const { requests } = await api('/api/generation-requests', { task: false });
      const recent = requests.filter(item => item.kind === mode).sort((a, b) => b.ts - a.ts).slice(0, 5);
      const results = await Promise.allSettled(recent.map(item => api(`/api/generation-requests?id=${encodeURIComponent(item.id)}`, { task: false })));
      if (version !== request) return;
      snapshots = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      menu.innerHTML = snapshots.length ? snapshots.map((snapshot, index) => `<button type="button" class="tool-btn" data-quick-history="${index}"><strong>${esc(name(snapshot))}</strong><small>${esc(fmtDate(snapshot.ts))} · ${esc(tr(`recovery.status.${snapshot.status}`))}</small><span>${esc(String(snapshot.request?.prompt ?? snapshot.request?.text ?? '').slice(0, 110))}</span></button>`).join('') : `<p class="hint">${text('quickHistory.empty')}</p>`;
      position(menu, trigger.getBoundingClientRect());
      menu.querySelectorAll('[data-quick-history]').forEach(button => {
        const snapshot = snapshots[Number(button.dataset.quickHistory)];
        button.addEventListener('mouseenter', () => showPreview(snapshot));
        button.addEventListener('focus', () => showPreview(snapshot));
        button.addEventListener('click', async () => {
          close();
          try { await restoreGenerationSettings(snapshot); } catch (error) { toast(error.message, 'err'); }
        });
      });
    } catch (error) { if (version === request) { close(); toast(error.message, 'err'); } }
  });
  document.addEventListener('pointerdown', event => { if (opened && !menu.contains(event.target) && !preview.contains(event.target) && !trigger.contains(event.target)) close(); });
  document.addEventListener('keydown', event => { if (opened && event.key === 'Escape') { close(); trigger.focus(); } });
  window.addEventListener('resize', close);
  document.addEventListener('scroll', event => { if (opened && !menu.contains(event.target) && !preview.contains(event.target)) close(); }, true);
  window.addEventListener('manifestador:localechange', close);
})();
