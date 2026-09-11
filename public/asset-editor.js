/* Asset editing tools: crop geometry is independent of the UI for reuse/tests. */
function normalizeAssetCrop(rect, width, height) {
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  const x = Math.max(0, Math.min(width - 1, number(rect.x, 0)));
  const y = Math.max(0, Math.min(height - 1, number(rect.y, 0)));
  return { x, y, width: Math.max(1, Math.min(width - x, number(rect.width, width))),
    height: Math.max(1, Math.min(height - y, number(rect.height, height))) };
}

function assetCropFromPoints(start, end, width, height, ratio = 0) {
  const dx = end.x - start.x, dy = end.y - start.y;
  let w = Math.abs(dx), h = Math.abs(dy);
  if (ratio > 0) {
    w = Math.min(w, h * ratio); h = w / ratio;
  }
  return normalizeAssetCrop({ x: dx < 0 ? start.x - w : start.x, y: dy < 0 ? start.y - h : start.y, width: w, height: h }, width, height);
}

const assetEdit = { image: null, key: '', metadata: {}, rect: null, request: 0, result: '', saving: false, start: null };

async function openAssetEditor(key) {
  closeLightbox();
  $('.nav-btn[data-view="asset-editor"]').click();
  const request = ++assetEdit.request;
  assetEdit.image = null; assetEdit.result = ''; assetEdit.start = null;
  $('#assetEditorFields').disabled = true;
  $('#assetEditorCanvas').hidden = true;
  $('#assetEditorResult').hidden = true;
  $('#assetEditorEmpty').hidden = true;
  $('#assetEditorName').textContent = key.split('/').pop();
  $('#assetEditorStatus').textContent = tr('assetEditor.loading');
  try {
    const assets = await api('/api/assets', { task: false });
    const metadata = Object.values(assets).flat().find((asset) => asset.key === key) || {};
    const owner = [...state.characters, ...state.elements].find((item) =>
      (item.photos || []).includes(key) || (item.variants || []).some((variant) => (variant.photos || []).includes(key)));
    const variant = owner?.variants?.find((item) => (item.photos || []).includes(key));
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(tr('assetEditor.loadFailed')));
      image.src = fileUrl(key);
    });
    if (request !== assetEdit.request) return;
    assetEdit.image = img; assetEdit.key = key;
    assetEdit.metadata = { ...metadata, nsfw: Boolean(metadata.nsfw || owner?.nsfw || variant?.nsfw) };
    $('#assetEditorName').textContent = metadata.name || key.split('/').pop();
    $('#assetEditorCanvas').hidden = false;
    $('#assetEditorFields').disabled = false;
    $('#assetEditorStatus').textContent = '';
    resetAssetCrop();
  } catch (error) {
    if (request === assetEdit.request) $('#assetEditorStatus').textContent = error.message;
  }
}

function resetAssetCrop() {
  const img = assetEdit.image;
  if (!img) return;
  const ratio = Number($('#assetEditorRatio').value);
  let width = img.naturalWidth, height = img.naturalHeight;
  if (ratio > 0) { width = Math.min(width, height * ratio); height = width / ratio; }
  assetEdit.rect = normalizeAssetCrop({ x: (img.naturalWidth - width) / 2, y: (img.naturalHeight - height) / 2, width, height }, img.naturalWidth, img.naturalHeight);
  drawAssetCrop();
}

function drawAssetCrop() {
  const img = assetEdit.image;
  if (!img) return;
  const canvas = $('#assetEditorCanvas');
  const scale = Math.min(1, 1000 / img.naturalWidth, 720 / img.naturalHeight);
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const r = assetEdit.rect;
  const x = r.x * canvas.width / img.naturalWidth, y = r.y * canvas.height / img.naturalHeight;
  const w = r.width * canvas.width / img.naturalWidth, h = r.height * canvas.height / img.naturalHeight;
  ctx.fillStyle = 'rgba(12,7,18,.65)';
  ctx.fillRect(0, 0, canvas.width, y); ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
  ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, canvas.width - x - w, h);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--pink').trim() || '#ec4899';
  ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  for (const [field, value] of Object.entries(r)) $(`#assetCrop${field[0].toUpperCase()}${field.slice(1)}`).value = value;
}

function assetCropPointer(event) {
  const bounds = $('#assetEditorCanvas').getBoundingClientRect();
  return { x: Math.max(0, Math.min(assetEdit.image.naturalWidth, (event.clientX - bounds.left) / bounds.width * assetEdit.image.naturalWidth)),
    y: Math.max(0, Math.min(assetEdit.image.naturalHeight, (event.clientY - bounds.top) / bounds.height * assetEdit.image.naturalHeight)) };
}

$('#assetEditorCanvas').addEventListener('pointerdown', (event) => {
  if (!assetEdit.image || assetEdit.saving || (event.button !== 0 && event.pointerType === 'mouse')) return;
  assetEdit.start = assetCropPointer(event);
  event.currentTarget.setPointerCapture(event.pointerId);
});
$('#assetEditorCanvas').addEventListener('pointermove', (event) => {
  if (!assetEdit.start) return;
  assetEdit.rect = assetCropFromPoints(assetEdit.start, assetCropPointer(event), assetEdit.image.naturalWidth, assetEdit.image.naturalHeight, Number($('#assetEditorRatio').value));
  drawAssetCrop();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#assetEditorCanvas').addEventListener(type, () => { assetEdit.start = null; });
for (const field of ['X', 'Y', 'Width', 'Height']) $(`#assetCrop${field}`).addEventListener('change', () => {
  const rect = { x: $('#assetCropX').value, y: $('#assetCropY').value, width: $('#assetCropWidth').value, height: $('#assetCropHeight').value };
  // Explicit numeric dimensions switch to free crop rather than silently changing another field.
  $('#assetEditorRatio').value = '0';
  assetEdit.rect = normalizeAssetCrop(rect, assetEdit.image.naturalWidth, assetEdit.image.naturalHeight);
  drawAssetCrop();
});
$('#assetEditorRatio').addEventListener('change', resetAssetCrop);
$('#assetEditorReset').addEventListener('click', resetAssetCrop);
$('#assetEditorChoose').addEventListener('click', () => {
  state.assetEditorImagePick = true;
  openPicker();
  $('#pickerTitle').textContent = tr('assetEditor.choose');
});
$('#assetEditorSave').addEventListener('click', async () => {
  if (!assetEdit.image || assetEdit.saving) return;
  const request = assetEdit.request, rect = { ...assetEdit.rect }, source = assetEdit.key, metadata = assetEdit.metadata;
  assetEdit.saving = true;
  $('#assetEditorFields').disabled = true;
  $('#assetEditorChoose').disabled = true;
  $('#assetEditorStatus').textContent = tr('assetEditor.saving');
  try {
    if (rect.width * rect.height > 32 * 1024 * 1024) throw new Error(tr('assetEditor.tooLarge'));
    const canvas = document.createElement('canvas');
    canvas.width = rect.width; canvas.height = rect.height;
    canvas.getContext('2d').drawImage(assetEdit.image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error(tr('assetEditor.saveFailed'));
    const result = await api('/api/assets/visual', { method: 'POST', body: {
      name: `${source.split('/').pop().replace(/\.[^.]+$/, '')}_crop.png`, dataUrl: await readFileAsDataUrl(blob),
      category: metadata.category || '', tags: metadata.tags || [], nsfw: metadata.nsfw
    } });
    // Make the result immediately available without rebuilding all media cards.
    state.assets.uploads = [result, ...(state.assets.uploads || [])];
    if (request === assetEdit.request) {
      assetEdit.result = result.key;
      $('#assetEditorResult').hidden = false;
      $('#assetEditorStatus').textContent = tr('assetEditor.saved');
    }
    toast(tr('assetEditor.saved'));
  } catch (error) {
    if (request === assetEdit.request) $('#assetEditorStatus').textContent = error.message;
  } finally {
    assetEdit.saving = false;
    $('#assetEditorFields').disabled = !assetEdit.image;
    $('#assetEditorChoose').disabled = false;
  }
});
$('#assetEditorResult').addEventListener('click', () => { if (assetEdit.result) openLightbox(assetEdit.result); });
