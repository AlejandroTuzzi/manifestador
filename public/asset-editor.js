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

function assetCropHandles(rect) {
  const { x, y, width: w, height: h } = rect;
  return [['nw', x, y], ['ne', x + w, y], ['sw', x, y + h], ['se', x + w, y + h],
    ['n', x + w / 2, y], ['s', x + w / 2, y + h], ['w', x, y + h / 2], ['e', x + w, y + h / 2]];
}

function assetCropHitTest(rect, point, toleranceX, toleranceY) {
  const nearby = assetCropHandles(rect).map(([mode, x, y]) => ({ mode,
    distance: Math.hypot((point.x - x) / toleranceX, (point.y - y) / toleranceY) }))
    .filter((handle) => handle.distance <= 1).sort((a, b) => a.distance - b.distance);
  if (nearby.length) return nearby[0].mode;
  if (point.x >= rect.x && point.x <= rect.x + rect.width) {
    if (Math.abs(point.y - rect.y) <= toleranceY) return 'n';
    if (Math.abs(point.y - rect.y - rect.height) <= toleranceY) return 's';
  }
  if (point.y >= rect.y && point.y <= rect.y + rect.height) {
    if (Math.abs(point.x - rect.x) <= toleranceX) return 'w';
    if (Math.abs(point.x - rect.x - rect.width) <= toleranceX) return 'e';
  }
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height ? 'move' : 'draw';
}

function adjustAssetCrop(rect, mode, dx, dy, width, height, ratio = 0) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  if (mode === 'move') return normalizeAssetCrop({ ...rect,
    x: clamp(rect.x + dx, 0, width - rect.width), y: clamp(rect.y + dy, 0, height - rect.height) }, width, height);
  const west = mode.includes('w'), east = mode.includes('e'), north = mode.includes('n'), south = mode.includes('s');
  const right = rect.x + rect.width, bottom = rect.y + rect.height;
  if (!(ratio > 0)) {
    const x = west ? clamp(rect.x + dx, 0, right - 1) : rect.x;
    const y = north ? clamp(rect.y + dy, 0, bottom - 1) : rect.y;
    const r = east ? clamp(right + dx, x + 1, width) : right;
    const b = south ? clamp(bottom + dy, y + 1, height) : bottom;
    return normalizeAssetCrop({ x, y, width: r - x, height: b - y }, width, height);
  }
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  let w, h, x, y;
  if ((west || east) && (north || south)) {
    const ax = west ? right : rect.x, ay = north ? bottom : rect.y;
    const desiredW = rect.width + (west ? -dx : dx);
    const desiredH = rect.height + (north ? -dy : dy);
    const maxW = Math.min(west ? ax : width - ax, (north ? ay : height - ay) * ratio);
    w = clamp(Math.abs(dx) >= Math.abs(dy * ratio) ? desiredW : desiredH * ratio, Math.min(maxW, Math.max(1, ratio)), maxW);
    h = w / ratio; x = west ? ax - w : ax; y = north ? ay - h : ay;
  } else if (west || east) {
    const ax = west ? right : rect.x;
    const maxW = Math.min(west ? ax : width - ax, 2 * Math.min(cy, height - cy) * ratio);
    w = clamp(rect.width + (west ? -dx : dx), Math.min(maxW, Math.max(1, ratio)), maxW);
    h = w / ratio; x = west ? ax - w : ax; y = cy - h / 2;
  } else {
    const ay = north ? bottom : rect.y;
    const maxH = Math.min(north ? ay : height - ay, 2 * Math.min(cx, width - cx) / ratio);
    h = clamp(rect.height + (north ? -dy : dy), Math.min(maxH, Math.max(1, 1 / ratio)), maxH);
    w = h * ratio; x = cx - w / 2; y = north ? ay - h : ay;
  }
  return normalizeAssetCrop({ x, y, width: w, height: h }, width, height);
}

function assetCropCursor(mode) {
  return ({ move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' })[mode] || 'crosshair';
}

const assetEdit = { image: null, key: '', metadata: {}, rect: null, savedRect: null, request: 0, result: '', saving: false, drag: null, confirmResolve: null, confirmFocus: null };

function assetEditorHasChanges() {
  if (!assetEdit.image || !assetEdit.rect) return false;
  const saved = assetEdit.savedRect || { x: 0, y: 0, width: assetEdit.image.naturalWidth, height: assetEdit.image.naturalHeight };
  return ['x', 'y', 'width', 'height'].some((field) => assetEdit.rect[field] !== saved[field]);
}

function syncAssetEditorChanges() {
  $('#assetEditorDirty').hidden = !assetEditorHasChanges();
}

function confirmAssetEditorLeave() {
  if (assetEdit.saving || assetEdit.confirmResolve) return Promise.resolve(false);
  if (!assetEditorHasChanges()) return Promise.resolve(true);
  assetEdit.drag = null;
  assetEdit.confirmFocus = document.activeElement;
  $('#assetEditorConfirmError').textContent = '';
  $('#assetEditorConfirm').hidden = false;
  $('#assetEditorKeepEditing').focus();
  return new Promise((resolve) => { assetEdit.confirmResolve = resolve; });
}

function finishAssetEditorConfirm(proceed) {
  if (assetEdit.saving) return;
  const resolve = assetEdit.confirmResolve;
  assetEdit.confirmResolve = null;
  $('#assetEditorConfirm').hidden = true;
  assetEdit.confirmFocus?.focus();
  assetEdit.confirmFocus = null;
  resolve?.(proceed);
}

function clearAssetEditor() {
  ++assetEdit.request; // Ignore a pending image load after closing.
  Object.assign(assetEdit, { image: null, key: '', metadata: {}, rect: null, savedRect: null, result: '', drag: null });
  const canvas = $('#assetEditorCanvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  canvas.hidden = true;
  canvas.style.cursor = 'crosshair';
  $('#assetEditorFields').disabled = true;
  $('#assetEditorClose').hidden = true;
  $('#assetEditorResult').hidden = true;
  $('#assetEditorEmpty').hidden = false;
  $('#assetEditorName').textContent = '';
  $('#assetEditorStatus').textContent = '';
  $('#assetEditorRatio').value = '0';
  for (const field of ['X', 'Y', 'Width', 'Height']) $(`#assetCrop${field}`).value = '';
  syncAssetEditorChanges();
  $('#assetEditorChoose').focus();
}

async function closeAssetEditor() {
  if (!(await confirmAssetEditorLeave())) return false;
  clearAssetEditor();
  return true;
}

async function openAssetEditor(key) {
  if (!(await confirmAssetEditorLeave())) return;
  closeLightbox();
  $('.nav-btn[data-view="asset-editor"]').click();
  const request = ++assetEdit.request;
  assetEdit.image = null; assetEdit.result = ''; assetEdit.drag = null; assetEdit.savedRect = null;
  assetEdit.key = key; assetEdit.rect = null;
  $('#assetEditorClose').hidden = false;
  syncAssetEditorChanges();
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
  assetEdit.drag = null;
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
  if (canvas.width !== Math.round(img.naturalWidth * scale)) canvas.width = Math.round(img.naturalWidth * scale);
  if (canvas.height !== Math.round(img.naturalHeight * scale)) canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const r = assetEdit.rect;
  const x = r.x * canvas.width / img.naturalWidth, y = r.y * canvas.height / img.naturalHeight;
  const w = r.width * canvas.width / img.naturalWidth, h = r.height * canvas.height / img.naturalHeight;
  ctx.fillStyle = 'rgba(12,7,18,.65)';
  ctx.fillRect(0, 0, canvas.width, y); ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
  ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, canvas.width - x - w, h);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--pink').trim() || '#ec4899';
  ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  // Keep visible handles the same CSS size when the image is scaled down.
  const handleSize = 8 * canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0c0712';
  for (const [, hx, hy] of assetCropHandles(r)) {
    const left = hx * canvas.width / img.naturalWidth - handleSize / 2;
    const top = hy * canvas.height / img.naturalHeight - handleSize / 2;
    ctx.fillRect(left, top, handleSize, handleSize);
    ctx.strokeRect(left, top, handleSize, handleSize);
  }
  for (const [field, value] of Object.entries(r)) $(`#assetCrop${field[0].toUpperCase()}${field.slice(1)}`).value = value;
  syncAssetEditorChanges();
}

function assetCropPointer(event) {
  const bounds = $('#assetEditorCanvas').getBoundingClientRect();
  return { x: Math.max(0, Math.min(assetEdit.image.naturalWidth, (event.clientX - bounds.left) / bounds.width * assetEdit.image.naturalWidth)),
    y: Math.max(0, Math.min(assetEdit.image.naturalHeight, (event.clientY - bounds.top) / bounds.height * assetEdit.image.naturalHeight)) };
}

$('#assetEditorCanvas').addEventListener('pointerdown', (event) => {
  if (!assetEdit.image || assetEdit.saving || assetEdit.drag || event.isPrimary === false || (event.button !== 0 && event.pointerType === 'mouse')) return;
  const start = assetCropPointer(event);
  const bounds = event.currentTarget.getBoundingClientRect();
  const targetSize = event.pointerType === 'touch' ? 18 : 10;
  const mode = event.shiftKey ? 'draw' : assetCropHitTest(assetEdit.rect, start,
    targetSize * assetEdit.image.naturalWidth / bounds.width, targetSize * assetEdit.image.naturalHeight / bounds.height);
  assetEdit.drag = { start, mode, rect: { ...assetEdit.rect }, ratio: Number($('#assetEditorRatio').value), pointerId: event.pointerId };
  event.currentTarget.style.cursor = assetCropCursor(mode);
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
});

function updateAssetCropDrag(event) {
  const drag = assetEdit.drag;
  if (!assetEdit.image || assetEdit.saving || !drag || drag.pointerId !== event.pointerId) return;
  const point = assetCropPointer(event), img = assetEdit.image;
  assetEdit.rect = drag.mode === 'draw'
    ? assetCropFromPoints(drag.start, point, img.naturalWidth, img.naturalHeight, drag.ratio)
    : adjustAssetCrop(drag.rect, drag.mode, point.x - drag.start.x, point.y - drag.start.y, img.naturalWidth, img.naturalHeight, drag.ratio);
  drawAssetCrop();
}

$('#assetEditorCanvas').addEventListener('pointermove', (event) => {
  if (!assetEdit.image || assetEdit.saving) return;
  if (assetEdit.drag) return updateAssetCropDrag(event);
  const bounds = event.currentTarget.getBoundingClientRect();
  const mode = event.shiftKey ? 'draw' : assetCropHitTest(assetEdit.rect, assetCropPointer(event),
    10 * assetEdit.image.naturalWidth / bounds.width, 10 * assetEdit.image.naturalHeight / bounds.height);
  event.currentTarget.style.cursor = assetCropCursor(mode);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#assetEditorCanvas').addEventListener(type, (event) => {
  if (assetEdit.drag?.pointerId !== event.pointerId) return;
  if (type === 'pointerup') updateAssetCropDrag(event);
  assetEdit.drag = null;
  event.currentTarget.style.cursor = 'crosshair';
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
});
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
async function saveAssetEditor() {
  if (!assetEdit.image || assetEdit.saving) return false;
  const request = assetEdit.request, rect = { ...assetEdit.rect }, source = assetEdit.key, metadata = assetEdit.metadata;
  assetEdit.saving = true;
  assetEdit.drag = null;
  $('#assetEditorFields').disabled = true;
  $('#assetEditorChoose').disabled = true;
  $('#assetEditorClose').disabled = true;
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
      assetEdit.savedRect = rect;
      syncAssetEditorChanges();
      $('#assetEditorResult').hidden = false;
      $('#assetEditorStatus').textContent = tr('assetEditor.saved');
    }
    toast(tr('assetEditor.saved'));
    return request === assetEdit.request;
  } catch (error) {
    if (request === assetEdit.request) $('#assetEditorStatus').textContent = error.message;
    return false;
  } finally {
    assetEdit.saving = false;
    $('#assetEditorFields').disabled = !assetEdit.image;
    $('#assetEditorChoose').disabled = false;
    $('#assetEditorClose').disabled = false;
  }
}
$('#assetEditorSave').addEventListener('click', saveAssetEditor);
$('#assetEditorClose').addEventListener('click', closeAssetEditor);
$('#assetEditorSaveClose').addEventListener('click', async () => {
  if (assetEdit.confirmResolve) return;
  if (assetEdit.result && !assetEditorHasChanges() && !assetEdit.saving) clearAssetEditor();
  else if (await saveAssetEditor()) clearAssetEditor();
});
$('#assetEditorKeepEditing').addEventListener('click', () => finishAssetEditorConfirm(false));
$('#assetEditorDiscard').addEventListener('click', () => finishAssetEditorConfirm(true));
$('#assetEditorConfirmSave').addEventListener('click', async () => {
  if (!assetEdit.confirmResolve || assetEdit.saving) return;
  const buttons = ['#assetEditorKeepEditing', '#assetEditorDiscard', '#assetEditorConfirmSave'];
  buttons.forEach((id) => { $(id).disabled = true; });
  $('#assetEditorConfirmError').textContent = tr('assetEditor.saving');
  const saved = await saveAssetEditor();
  buttons.forEach((id) => { $(id).disabled = false; });
  if (saved) finishAssetEditorConfirm(true);
  else $('#assetEditorConfirmError').textContent = $('#assetEditorStatus').textContent;
});
$('#assetEditorConfirm').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); finishAssetEditorConfirm(false);
  } else if (event.key === 'Tab') {
    const buttons = ['#assetEditorKeepEditing', '#assetEditorDiscard', '#assetEditorConfirmSave'].map((id) => $(id)).filter((button) => !button.disabled);
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }
});
$('#assetEditorResult').addEventListener('click', () => { if (assetEdit.result) openLightbox(assetEdit.result); });
