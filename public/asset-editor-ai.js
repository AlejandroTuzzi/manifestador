/* AI region editing for the asset editor (GPT Image 2.5/2.6): marks or a mask over the open image.
   Drawing and size rules are independent of the UI for reuse/tests. */
function assetAiAspectRatio(width, height) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height) || 1;
  return `${width / divisor}:${height / divisor}`;
}

// The model's output limits proportions to 3:1; the marks layer to 16.7 MP.
function assetAiSizeProblem(width, height, hasLayer) {
  if (Math.max(width / height, height / width) > 3) return 'assetEditor.ai.ratioLimit';
  return hasLayer && width * height > 16777216 ? 'assetEditor.ai.tooLarge' : '';
}

function drawAssetAiStroke(ctx, stroke, scale, filled) {
  const points = stroke.points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
  const [start] = points, end = points[points.length - 1];
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.size * scale;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  if (stroke.tool === 'rect') ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y);
  else if (stroke.tool === 'ellipse') ctx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2);
  else {
    ctx.moveTo(start.x, start.y);
    for (const point of points.length > 1 ? points.slice(1) : points) ctx.lineTo(point.x, point.y);
  }
  if (stroke.tool === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x), head = Math.max(ctx.lineWidth * 4, 14 * scale);
    for (const side of [-0.5, 0.5]) {
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - head * Math.cos(angle + side), end.y - head * Math.sin(angle + side));
    }
  }
  if (filled && ['rect', 'ellipse'].includes(stroke.tool)) ctx.fill();
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

function drawAssetAiStrokes(ctx, strokes, scale, filled) {
  for (const stroke of strokes) drawAssetAiStroke(ctx, stroke, scale, filled);
}

const assetAi = {
  image: null, key: '', tool: 'crop', mode: 'markup', strokes: { markup: [], mask: [] }, drawing: null,
  refs: [], options: { quality: 'medium', complexity: 'low' }, modelId: 'gpt-image-2.6-sunburst',
  session: 0, busy: false, result: '', layer: document.createElement('canvas')
};
const MAX_ASSET_AI_REFS = 15; // GPT Image admits 16 images; the open image is the first one.

function assetAiStrokes() {
  return assetAi.strokes[assetAi.mode];
}

function assetAiMaskColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--pink').trim() || '#ec4899';
}

function renderAssetAiCanvas() {
  const img = assetAi.image;
  if (!img) return;
  const canvas = $('#assetEditorAiCanvas');
  const scale = Math.min(1, 1000 / img.naturalWidth, 720 / img.naturalHeight);
  canvas.width = assetAi.layer.width = Math.round(img.naturalWidth * scale);
  canvas.height = assetAi.layer.height = Math.round(img.naturalHeight * scale);
  drawAssetAiStrokes(assetAi.layer.getContext('2d'), assetAiStrokes(), scale, assetAi.mode === 'mask');
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (assetAi.mode === 'mask') ctx.globalAlpha = 0.55;
  ctx.drawImage(assetAi.layer, 0, 0);
  ctx.globalAlpha = 1;
  syncAssetAiButtons();
}

// PNG at the source's exact dimensions. In a mask, transparent pixels are the editable area.
function exportAssetAiLayer() {
  const { naturalWidth: width, naturalHeight: height } = assetAi.image;
  const layer = document.createElement('canvas');
  layer.width = width; layer.height = height;
  drawAssetAiStrokes(layer.getContext('2d'), assetAiStrokes(), 1, assetAi.mode === 'mask');
  if (assetAi.mode === 'markup') return layer.toDataURL('image/png');
  const mask = document.createElement('canvas');
  mask.width = width; mask.height = height;
  const ctx = mask.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(layer, 0, 0);
  return mask.toDataURL('image/png');
}

function syncAssetAiButtons() {
  const empty = !assetAiStrokes().length;
  $('#assetAiUndo').disabled = empty;
  $('#assetAiClear').disabled = empty;
  $('#assetAiGenerate').disabled = assetAi.busy;
  $('#assetAiGenerate').textContent = tr(assetAi.busy ? 'assetEditor.ai.generating' : 'assetEditor.ai.generate');
}

function assetAiModels() {
  return (state.models || []).filter((model) => model.openaiExtended);
}

function renderAssetAiOptions() {
  const models = assetAiModels();
  const model = models.find((item) => item.id === assetAi.modelId) || models[0];
  if (!model) return;
  assetAi.modelId = model.id;
  $('#assetAiModel').innerHTML = models.map((item) => `<option value="${esc(item.id)}"${item.id === model.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
  const root = $('#assetEditorAiOptions');
  root.innerHTML = openaiOptionsMarkup(assetAi.options, model, { edit: true });
  syncOpenaiOptions(root);
  root.oninput = () => { assetAi.options = readOpenaiOptions(root); };
}

function renderAssetAiRefs() {
  $('#assetAiRefList').innerHTML = assetAi.refs.map((key) => `<span class="ref-thumb"><img src="${fileUrl(key)}" alt=""><button type="button" class="rm" data-asset-ai-ref="${esc(key)}" title="${esc(tr('common.remove'))}">×</button></span>`).join('');
  $('#assetAiRefList').querySelectorAll('[data-asset-ai-ref]').forEach((button) => button.addEventListener('click', () => {
    assetAi.refs = assetAi.refs.filter((key) => key !== button.dataset.assetAiRef);
    renderAssetAiRefs();
  }));
  $('#assetAiAddRef').disabled = assetAi.refs.length >= MAX_ASSET_AI_REFS;
}

function syncAssetAiMode() {
  const mask = assetAi.mode === 'mask';
  $('#assetAiMode').value = assetAi.mode;
  $('#assetAiModeHint').textContent = tr(mask ? 'assetEditor.ai.maskHint' : 'assetEditor.ai.markupHint');
  $('#assetAiColorField').hidden = mask;
  $('#assetAiTool').querySelector('[value="arrow"]').hidden = mask;
  if (mask && $('#assetAiTool').value === 'arrow') $('#assetAiTool').value = 'brush';
  renderAssetAiCanvas();
}

function setAssetEditorTool(tool) {
  assetAi.tool = tool;
  const ai = tool === 'ai';
  $('#assetEditorModeCrop').classList.toggle('active', !ai);
  $('#assetEditorModeAi').classList.toggle('active', ai);
  $('#assetEditorModeCrop').setAttribute('aria-selected', String(!ai));
  $('#assetEditorModeAi').setAttribute('aria-selected', String(ai));
  $('#assetEditorCropPanel').hidden = ai;
  $('#assetEditorAiPanel').hidden = !ai;
  $('#assetEditorCanvas').hidden = ai || !assetAi.image;
  $('#assetEditorAiCanvas').hidden = !ai || !assetAi.image;
  if (ai) {
    renderAssetAiOptions();
    renderAssetAiRefs();
    syncAssetAiMode();
  }
}

function assetAiPointer(event) {
  const bounds = $('#assetEditorAiCanvas').getBoundingClientRect();
  const { naturalWidth: width, naturalHeight: height } = assetAi.image;
  return { x: Math.max(0, Math.min(width, (event.clientX - bounds.left) / bounds.width * width)),
    y: Math.max(0, Math.min(height, (event.clientY - bounds.top) / bounds.height * height)) };
}

$('#assetEditorAiCanvas').addEventListener('pointerdown', (event) => {
  if (!assetAi.image || assetAi.drawing || event.isPrimary === false || (event.button !== 0 && event.pointerType === 'mouse')) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const stroke = { tool: $('#assetAiTool').value, color: assetAi.mode === 'mask' ? assetAiMaskColor() : $('#assetAiColor').value,
    size: Number($('#assetAiSize').value) * assetAi.image.naturalWidth / bounds.width, points: [assetAiPointer(event)] };
  assetAiStrokes().push(stroke);
  assetAi.drawing = { stroke, pointerId: event.pointerId };
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  renderAssetAiCanvas();
});
$('#assetEditorAiCanvas').addEventListener('pointermove', (event) => {
  const drawing = assetAi.drawing;
  if (!drawing || drawing.pointerId !== event.pointerId) return;
  const freehand = ['brush', 'eraser'].includes(drawing.stroke.tool);
  drawing.stroke.points[freehand ? drawing.stroke.points.length : 1] = assetAiPointer(event);
  renderAssetAiCanvas();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#assetEditorAiCanvas').addEventListener(type, (event) => {
  if (assetAi.drawing?.pointerId !== event.pointerId) return;
  assetAi.drawing = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
});

$('#assetEditorModeCrop').addEventListener('click', () => setAssetEditorTool('crop'));
$('#assetEditorModeAi').addEventListener('click', () => setAssetEditorTool('ai'));
$('#assetAiMode').addEventListener('change', (event) => { assetAi.mode = event.target.value; syncAssetAiMode(); });
$('#assetAiModel').addEventListener('change', (event) => { assetAi.modelId = event.target.value; renderAssetAiOptions(); });
$('#assetAiUndo').addEventListener('click', () => { assetAiStrokes().pop(); renderAssetAiCanvas(); });
$('#assetAiClear').addEventListener('click', () => { assetAi.strokes[assetAi.mode] = []; renderAssetAiCanvas(); });
$('#assetAiAddRef').addEventListener('click', () => {
  state.assetEditorRefPick = true;
  openPicker();
  $('#pickerTitle').textContent = tr('assetEditor.ai.addRef');
});
$('#assetAiResult').addEventListener('click', () => { if (assetAi.result) openLightbox(assetAi.result); });
$('#assetAiContinue').addEventListener('click', async () => {
  if (!assetAi.result) return;
  assetAi.strokes = { markup: [], mask: [] };
  await openAssetEditor(assetAi.result);
});

$('#assetAiGenerate').addEventListener('click', async () => {
  if (!assetAi.image || assetAi.busy) return;
  const prompt = $('#assetAiPrompt').value.trim();
  const status = $('#assetEditorAiStatus');
  if (!prompt) { status.textContent = tr('assetEditor.ai.promptRequired'); return; }
  const { naturalWidth: width, naturalHeight: height } = assetAi.image;
  const hasLayer = assetAiStrokes().length > 0;
  const problem = assetAiSizeProblem(width, height, hasLayer);
  if (problem) { status.textContent = tr(problem); return; }
  const session = assetAi.session;
  assetAi.busy = true;
  assetAi.options = readOpenaiOptions($('#assetEditorAiOptions'));
  syncAssetAiButtons();
  status.textContent = tr('assetEditor.ai.generating');
  $('#assetAiResultActions').hidden = true;
  try {
    const entry = await api('/api/generate/image', { method: 'POST', body: {
      modelId: assetAi.modelId, prompt, batch: 1, refs: [assetAi.key, ...assetAi.refs],
      // Output keeps the source's proportions: a different ratio makes the model invent image.
      aspectRatio: assetAiAspectRatio(width, height), resolution: $('#assetAiResolution').value,
      openaiImage: assetAi.options,
      ...(hasLayer ? { openaiEdit: { mode: assetAi.mode, layer: exportAssetAiLayer() } } : {})
    } });
    const key = entry.outputs[0];
    state.history.unshift(entry);
    renderHistory();
    state.assets.generated = [{ key, name: key.split('/').pop(), mtime: Date.now() }, ...(state.assets.generated || [])];
    toast(tr('assetEditor.ai.done'));
    if (session === assetAi.session) {
      assetAi.result = key;
      status.textContent = tr('assetEditor.ai.done');
      $('#assetAiResultActions').hidden = false;
    }
  } catch (error) {
    if (session === assetAi.session) status.textContent = error.message;
    else toast(error.message, 'err');
  } finally {
    assetAi.busy = false;
    syncAssetAiButtons();
  }
});

globalThis.assetEditorAi = {
  sourceChanged(image, key = '') {
    assetAi.session++;
    Object.assign(assetAi, { image, key, strokes: { markup: [], mask: [] }, drawing: null, refs: [], result: '' });
    $('#assetEditorAiStatus').textContent = '';
    $('#assetAiResultActions').hidden = true;
    $('#assetEditorAiFields').disabled = !image;
    setAssetEditorTool(assetAi.tool);
  },
  blocksLeaving() {
    return (assetAi.strokes.markup.length + assetAi.strokes.mask.length) > 0 && !confirm(tr('assetEditor.ai.discardConfirm'));
  },
  addReference(key) {
    if (key === assetAi.key || assetAi.refs.includes(key) || assetAi.refs.length >= MAX_ASSET_AI_REFS) return;
    assetAi.refs.push(key);
    renderAssetAiRefs();
  },
  // An edit from the history reopens here: its marks are not stored, only its source and settings.
  async open(entry) {
    await openAssetEditor(entry.refs[0]);
    if (assetAi.key !== entry.refs[0]) return;
    Object.assign(assetAi, { mode: entry.openaiEdit.mode, modelId: entry.modelId, refs: entry.refs.slice(1), options: entry.openaiImage || assetAi.options });
    $('#assetAiPrompt').value = entry.prompt;
    setAssetEditorTool('ai');
    $('#assetEditorAiStatus').textContent = tr('assetEditor.ai.redraw');
  }
};
