/* Optional, image-backed details belonging to a character's wardrobe variant. */
let distinctiveEditor = null;
let distinctiveCursor = { start: 0, end: 0 };

function visibleDistinctiveElements(character, variant) {
  if (!contentIsVisible(character) || !contentIsVisible(variant)) return [];
  return (variant.distinctiveElements || []).filter((item) => contentIsVisible(item));
}

function renderDistinctiveSections(character) {
  $$('#charModalBody [data-distinctive-variant]').forEach((root) => {
    const variant = (character.variants || []).find((v) => v.id === root.dataset.distinctiveVariant);
    if (!variant) return;
    root.innerHTML = `<div class="variant-manager-head"><strong>${esc(tr('distinctive.title'))}</strong><button type="button" class="mini-btn" data-distinctive-add>${IC('plus')} ${esc(tr('distinctive.add'))}</button></div>
      <div class="distinctive-list">${visibleDistinctiveElements(character, variant).map((item) => `<div class="distinctive-card">
        <img src="${fileUrl(item.imageKey)}" alt="" loading="lazy"><div><p>${esc(item.text)}</p>${nsfwBadgeHtml(item)}
        <button type="button" class="mini-btn" data-distinctive-edit="${esc(item.id)}">${esc(tr('common.edit'))}</button>
        <button type="button" class="mini-btn danger" data-distinctive-remove="${esc(item.id)}">${esc(tr('common.remove'))}</button></div></div>`).join('') || `<p class="hint">${esc(tr('distinctive.empty'))}</p>`}</div>`;
    root.querySelector('[data-distinctive-add]').addEventListener('click', () => openDistinctiveEditor(character.id, variant.id));
    root.querySelectorAll('[data-distinctive-edit]').forEach((button) => button.addEventListener('click', () => openDistinctiveEditor(character.id, variant.id, button.dataset.distinctiveEdit)));
    root.querySelectorAll('[data-distinctive-remove]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm(tr('distinctive.removeConfirm'))) return;
      button.disabled = true;
      try {
        const current = state.characters.find((c) => c.id === character.id)?.variants?.find((v) => v.id === variant.id);
        await saveDistinctiveList(character.id, variant.id, (current?.distinctiveElements || []).filter((item) => item.id !== button.dataset.distinctiveRemove));
      } catch (error) { toast(error.message, 'err'); button.disabled = false; }
    }));
  });
}

async function saveDistinctiveList(ownerId, variantId, distinctiveElements) {
  const updated = await api(`/api/characters/${ownerId}/variants/${variantId}`, { method: 'PUT', body: { distinctiveElements } });
  const index = state.characters.findIndex((c) => c.id === ownerId);
  if (index >= 0) state.characters[index] = updated;
  // Refresh only these sections; don't overwrite unsaved character form fields.
  if (state.editingCharId === ownerId) renderDistinctiveSections(updated);
  return updated;
}

function showDistinctivePreview(src) {
  const preview = $('#distinctivePreview');
  preview.hidden = !src;
  if (src) preview.src = src;
  else preview.removeAttribute('src');
}

async function openDistinctiveEditor(ownerId, variantId, itemId = '') {
  const owner = state.characters.find((c) => c.id === ownerId);
  const variant = owner?.variants?.find((v) => v.id === variantId);
  if (!variant) return;
  const item = variant.distinctiveElements?.find((entry) => entry.id === itemId);
  const editor = { ownerId, variantId, itemId, imageKey: item?.imageKey || '', file: null, assets: [], saving: false };
  distinctiveEditor = editor;
  $('#distinctiveEditorTitle').textContent = tr(item ? 'distinctive.edit' : 'distinctive.add');
  $('#distinctiveText').value = item?.text || '';
  $('#distinctiveNsfw').checked = Boolean(item?.nsfw || owner.nsfw || variant.nsfw);
  $('#distinctiveFile').value = '';
  $('#distinctiveAsset').innerHTML = `<option value="">${esc(tr('distinctive.chooseUploaded'))}</option>`;
  $('#distinctiveEditorStatus').textContent = '';
  showDistinctivePreview(editor.imageKey ? fileUrl(editor.imageKey) : '');
  $('#distinctiveEditorModal').hidden = false;
  $('#distinctiveText').focus();
  try {
    const assets = await api('/api/assets', { task: false });
    if (distinctiveEditor !== editor) return;
    editor.assets = (assets.uploads || []).filter((asset) => contentIsVisible(asset) && /\.(png|jpe?g|webp)$/i.test(asset.key));
    $('#distinctiveAsset').innerHTML = `<option value="">${esc(tr('distinctive.chooseUploaded'))}</option>` + editor.assets.map((asset) => `<option value="${esc(asset.key)}">${esc(asset.name || asset.key.split('/').pop())}</option>`).join('');
    $('#distinctiveAsset').value = editor.imageKey;
  } catch (error) { if (distinctiveEditor === editor) $('#distinctiveEditorStatus').textContent = error.message; }
}

function closeDistinctiveEditor() {
  if (distinctiveEditor?.saving) return;
  distinctiveEditor = null;
  $('#distinctiveEditorModal').hidden = true;
  showDistinctivePreview('');
}
$('#distinctiveEditorClose').addEventListener('click', closeDistinctiveEditor);
$('#distinctiveEditorCancel').addEventListener('click', closeDistinctiveEditor);
$('#distinctiveAsset').addEventListener('change', (event) => {
  if (!distinctiveEditor || distinctiveEditor.saving || !event.target.value) return;
  distinctiveEditor.imageKey = event.target.value;
  distinctiveEditor.file = null;
  $('#distinctiveFile').value = '';
  if (distinctiveEditor.assets.find((asset) => asset.key === event.target.value)?.nsfw) $('#distinctiveNsfw').checked = true;
  showDistinctivePreview(fileUrl(event.target.value));
});
$('#distinctiveFile').addEventListener('change', async (event) => {
  const editor = distinctiveEditor, file = event.target.files?.[0];
  if (!editor || editor.saving || !file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    event.target.value = ''; toast(tr('errors.distinctiveElementInvalid'), 'err'); return;
  }
  editor.file = file;
  $('#distinctiveAsset').value = '';
  try {
    const dataUrl = await readFileAsDataUrl(file);
    if (distinctiveEditor === editor && editor.file === file) showDistinctivePreview(dataUrl);
  } catch (error) { if (distinctiveEditor === editor) { editor.file = null; toast(error.message, 'err'); } }
});
$('#distinctiveEditorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const editor = distinctiveEditor;
  if (!editor || editor.saving) return;
  const text = $('#distinctiveText').value.trim();
  if (!text || (!editor.file && !editor.imageKey)) return toast(tr('errors.distinctiveElementInvalid'), 'err');
  const owner = state.characters.find((c) => c.id === editor.ownerId);
  const variant = owner?.variants?.find((v) => v.id === editor.variantId);
  if (!variant) return toast(tr('errors.variantNotFound'), 'err');
  const nsfw = Boolean($('#distinctiveNsfw').checked || owner.nsfw || variant.nsfw || editor.assets.find((a) => a.key === editor.imageKey)?.nsfw);
  editor.saving = true;
  $('#distinctiveEditorFields').disabled = true;
  $('#distinctiveEditorSave').disabled = true;
  $('#distinctiveEditorStatus').textContent = tr('distinctive.saving');
  try {
    if (editor.file) {
      const asset = await api('/api/assets/visual', { method: 'POST', body: { name: editor.file.name, dataUrl: await readFileAsDataUrl(editor.file), nsfw } });
      editor.imageKey = asset.key; editor.file = null;
    }
    const item = { id: editor.itemId || crypto.randomUUID(), imageKey: editor.imageKey, text, nsfw };
    const current = owner.variants.find((v) => v.id === editor.variantId).distinctiveElements || [];
    await saveDistinctiveList(editor.ownerId, editor.variantId, editor.itemId ? current.map((entry) => entry.id === editor.itemId ? item : entry) : [...current, item]);
    editor.saving = false;
    closeDistinctiveEditor();
    toast(tr('distinctive.saved'));
  } catch (error) { $('#distinctiveEditorStatus').textContent = error.message; }
  finally { editor.saving = false; $('#distinctiveEditorFields').disabled = false; $('#distinctiveEditorSave').disabled = false; }
});

function distinctiveChoices() {
  return state.characters.flatMap((character) => (character.variants || []).flatMap((variant) =>
    visibleDistinctiveElements(character, variant).map((item) => ({ character, variant, item }))));
}

function renderDistinctiveQuickVariants() {
  const characterId = $('#distinctiveQuickCharacter').value;
  const variants = new Map(distinctiveChoices().filter((choice) => !characterId || choice.character.id === characterId).map(({ variant }) => [variant.id, variant]));
  $('#distinctiveQuickVariant').innerHTML = `<option value="">${esc(tr('distinctive.allVariants'))}</option>` + [...variants.values()].map((variant) => `<option value="${esc(variant.id)}">${esc(variant.name)}</option>`).join('');
  renderDistinctiveQuick();
}

function renderDistinctiveQuick() {
  const choices = distinctiveChoices().filter(({ character, variant }) =>
    (!$('#distinctiveQuickCharacter').value || character.id === $('#distinctiveQuickCharacter').value)
    && (!$('#distinctiveQuickVariant').value || variant.id === $('#distinctiveQuickVariant').value));
  $('#distinctiveQuickList').innerHTML = choices.map(({ character, variant, item }, index) => `<div class="distinctive-card">
    <img src="${fileUrl(item.imageKey)}" alt="" loading="lazy"><div><strong>${esc(character.name)} · ${esc(variant.name)}</strong>${nsfwBadgeHtml(item)}<p>${esc(item.text)}</p>
    <button type="button" class="mini-btn accent" data-distinctive-insert="${index}">${esc(tr('distinctive.insert'))}</button></div></div>`).join('') || `<p class="hint">${esc(tr('distinctive.noChoices'))}</p>`;
  $$('#distinctiveQuickList [data-distinctive-insert]').forEach((button) => button.addEventListener('click', () => {
    insertDistinctiveElement(choices[Number(button.dataset.distinctiveInsert)]);
  }));
}

function insertDistinctiveElement(choice) {
  if (!choice || !['image', 'video'].includes(state.mode) || activeRefLimit() < 1) return toast(tr('distinctive.imageModeRequired'), 'err');
  const { character, variant, item } = choice;
  if (!visibleDistinctiveElements(character, variant).some((entry) => entry.id === item.id)) return;
  // addRef enforces total/per-media limits. Don't insert text if the image can't be attached.
  if (!state.refs.some((ref) => ref.key === item.imageKey) && !addRef(item.imageKey, false, 'image')) return;
  const box = $('#promptBox');
  const start = Math.min(distinctiveCursor.start, box.value.length), end = Math.min(distinctiveCursor.end, box.value.length);
  const before = box.value.slice(0, start), after = box.value.slice(end);
  const text = `${before && !/\s$/.test(before) ? ' ' : ''}${item.text}${after && !/^[\s.,;:!?]/.test(after) ? ' ' : ''}`;
  box.setSelectionRange(start, end);
  insertAtCursor(text);
  $('#distinctiveQuickModal').hidden = true;
  toast(tr('distinctive.inserted'));
}

$('#btnDistinctive').addEventListener('click', () => {
  const box = $('#promptBox');
  distinctiveCursor = { start: box.selectionStart ?? box.value.length, end: box.selectionEnd ?? box.value.length };
  const characters = new Map(distinctiveChoices().map(({ character }) => [character.id, character]));
  $('#distinctiveQuickCharacter').innerHTML = `<option value="">${esc(tr('distinctive.allCharacters'))}</option>` + [...characters.values()].map((character) => `<option value="${esc(character.id)}">${esc(character.name)}</option>`).join('');
  $('#distinctiveQuickCharacter').value = characters.has(state.pinnedId) ? state.pinnedId : '';
  renderDistinctiveQuickVariants();
  if ([...$('#distinctiveQuickVariant').options].some((option) => option.value === state.characterVariantId)) $('#distinctiveQuickVariant').value = state.characterVariantId;
  renderDistinctiveQuick();
  $('#distinctiveQuickModal').hidden = false;
  $('#distinctiveQuickCharacter').focus();
});
$('#distinctiveQuickCharacter').addEventListener('change', renderDistinctiveQuickVariants);
$('#distinctiveQuickVariant').addEventListener('change', renderDistinctiveQuick);
$('#distinctiveQuickClose').addEventListener('click', () => { $('#distinctiveQuickModal').hidden = true; $('#promptBox').focus(); });

for (const id of ['#distinctiveEditorModal', '#distinctiveQuickModal']) $(id).addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation();
    if (id === '#distinctiveEditorModal') closeDistinctiveEditor();
    else $('#distinctiveQuickClose').click();
  } else if (event.key === 'Tab') {
    const controls = [...$(id).querySelectorAll('button, input, select, textarea')].filter((control) => !control.matches(':disabled') && !control.hidden);
    const index = controls.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
  }
});
