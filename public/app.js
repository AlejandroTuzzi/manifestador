/* Manifestador — frontend */

const $ = (s) => document.querySelector(s);
const IC = (n, cls = 'ic') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  config: null,
  models: [],
  characters: [],
  prompts: [],
  promptCategoriesExtra: {},
  assetLinks: [],
  promptQuickCategory: '',
  promptQuickSearch: '',
  history: [],
  voices: null,          // null = aún no cargadas
  assets: { generated: [], uploads: [], audio: [], video: [] },
  mode: 'image',
  modelId: null,
  aspectRatio: '1:1',
  resolution: '1K',
  batch: 1,
  videoModels: [],
  video: { modelId: null, mode: 'reference', aspectRatio: '16:9', resolution: '720p', duration: 5, audio: false },
  refs: [],              // [{ key, fromChar }]
  voiceId: '',
  currentEntry: null,
  currentOutput: 0,
  assetsZone: 'generated',
  selectedAssets: new Set(),
  assetRange: { from: null, to: null },
  assetFilterCharacterId: '',
  assetFilterSeriesId: '',
  series: [],
  editingSeriesId: null,
  seriesDraftCharacterIds: new Set(),
  pendingSeriesAssetKey: null,
  scripts: [],
  scriptEditor: null,        // copia de trabajo del guion abierto en el editor
  scriptDirty: false,
  scriptBriefText: '',
  storyboardScript: null,    // copia de trabajo en el área de asignación de assets (guion solo lectura)
  shotAssetsTarget: null,    // { si, hi } índice del plano cuyo modal de assets está abierto
  shotAssetsZone: 'series',
  pickerTab: 'upload',
  pickerCharacterId: '',     // drill-down del tab Personajes del picker
  pickerVariantId: '',
  charAssetPicker: null,     // { characterId, variantId, zone } al elegir un asset como foto de variante
  shotPromptTarget: null,    // { si, hi } del plano que está eligiendo prompt de la biblioteca
  scriptViewId: null,        // guion abierto en la vista de lectura "Ver guion"
  elements: [],              // locaciones y objetos
  elementLinks: [],
  editingElementId: null,
  elementKindFilter: '',
  elementCategoryFilter: '',
  pickerElementId: '',       // drill-down del tab Locaciones/Objetos del picker
  pickerElementVariantId: '',
  pickerSeriesId: '',        // drill-down del tab Series del picker
  shotList: [],              // duraciones (s) de cada toma del armador de video
  editingCharId: null,
  pendingCharacterAsset: null,
  variantEditor: null,
  promptEditor: null,
  pendingAssociationKey: null,
  lightboxKeys: [],
  lightboxIndex: 0,
  generationJobs: [],
  activeGenerations: 0,
  pinnedId: localStorage.getItem('pinnedCharacterId') || '',
  characterVariantId: localStorage.getItem('pinnedCharacterVariantId') || ''
};

const AUDIO_TAGS = [
  'laughs', 'whispers', 'sighs', 'excited', 'sad', 'angry', 'sarcastic',
  'curious', 'crying', 'shouting', 'giggles', 'gasps', 'pause', 'sings',
  'mischievously', 'nervously', 'clears throat', 'exhales'
];

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fileUrl(key) {
  return '/files/' + key.split('/').map(encodeURIComponent).join('/');
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 7000 : 3000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && json.loginRequired) showLogin();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function currentModel() {
  return state.models.find((m) => m.id === state.modelId) || state.models[0];
}

function currentVideoModel() {
  return state.videoModels.find((m) => m.id === state.video.modelId) || state.videoModels[0];
}

// el modelo cuyo límite de referencias aplica según el modo activo
function activeRefModel() {
  return state.mode === 'video' ? currentVideoModel() : currentModel();
}

function activeRefLimit() {
  const m = activeRefModel();
  if (!m) return 0;
  if (state.mode === 'video') return m.refLimits?.[state.video.mode] ?? m.maxRefs;
  return m.maxRefs;
}

// Personajes, locaciones/objetos y series se listan siempre alfabéticamente:
// es más fácil de navegar que por fecha de creación. Se llama al inicio de cada
// render que arma una lista, así vale para cualquier mutación previa.
const byName = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });

function sortEntities() {
  state.characters.sort((a, b) => byName(a.name, b.name));
  state.elements.sort((a, b) => byName(a.name, b.name));
  state.series.sort((a, b) => byName(a.title, b.title));
}

// encuadre de la foto de portada (personajes y elementos): mover (object-position)
// + acercar (scale). La miniatura de tarjeta usa exactamente el mismo render.
function avatarStyle(entity) {
  const p = entity?.avatarPos || {};
  const x = p.x ?? 50, y = p.y ?? 50, z = p.zoom ?? 1;
  return `object-position:${x}% ${y}%;transform:scale(${z});transform-origin:${x}% ${y}%`;
}

function avatarHtml(entity, phIcon) {
  const cover = entity.photos[0];
  return cover
    ? `<div class="char-avatar"><img src="${fileUrl(cover)}" style="${avatarStyle(entity)}" alt=""></div>`
    : `<div class="char-avatar ph">${IC(phIcon, 'ic ic-lg')}</div>`;
}

// Herramienta de encuadre: cuadrado con la portada; se arrastra para mover y se
// usa la rueda o el slider para acercar. Guarda al soltar / al cambiar el zoom.
function buildCoverPositioner(entity, onSave) {
  const wrap = document.createElement('div');
  wrap.className = 'cover-positioner';
  const pos = { x: 50, y: 50, zoom: 1, ...(entity.avatarPos || {}) };
  wrap.innerHTML = `
    <div class="cover-square"><img src="${fileUrl(entity.photos[0])}" draggable="false" alt=""></div>
    <div class="cover-tools">
      <span class="hint">Arrastrá para mover · rueda o slider para acercar</span>
      <label class="cover-zoom">Zoom <input type="range" min="1" max="4" step="0.05" value="${pos.zoom}"></label>
      <button type="button" class="mini-btn" data-cover="center">Restablecer</button>
    </div>`;
  const img = wrap.querySelector('img');
  const zoomInput = wrap.querySelector('input[type="range"]');
  const apply = () => { img.style = `object-position:${pos.x}% ${pos.y}%;transform:scale(${pos.zoom});transform-origin:${pos.x}% ${pos.y}%`; };
  const save = () => onSave({ x: Math.round(pos.x), y: Math.round(pos.y), zoom: Math.round(pos.zoom * 100) / 100 });
  apply();

  let drag = null;
  const square = wrap.querySelector('.cover-square');
  square.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    square.setPointerCapture(e.pointerId);
    square.classList.add('dragging');
  });
  square.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rect = square.getBoundingClientRect();
    // dividido por el zoom para que el paneo se sienta parejo al acercar
    pos.x = Math.max(0, Math.min(100, drag.px - ((e.clientX - drag.x) / rect.width) * 100 / pos.zoom));
    pos.y = Math.max(0, Math.min(100, drag.py - ((e.clientY - drag.y) / rect.height) * 100 / pos.zoom));
    apply();
  });
  const end = () => { if (!drag) { return; } drag = null; square.classList.remove('dragging'); save(); };
  square.addEventListener('pointerup', end);
  square.addEventListener('pointercancel', end);
  square.addEventListener('wheel', (e) => {
    e.preventDefault();
    pos.zoom = Math.max(1, Math.min(4, Math.round((pos.zoom - e.deltaY * 0.002) * 100) / 100));
    zoomInput.value = pos.zoom;
    apply();
    clearTimeout(square._zt); square._zt = setTimeout(save, 250);
  }, { passive: false });
  zoomInput.addEventListener('input', () => { pos.zoom = Number(zoomInput.value); apply(); });
  zoomInput.addEventListener('change', save);
  wrap.querySelector('[data-cover="center"]').addEventListener('click', () => {
    pos.x = 50; pos.y = 50; pos.zoom = 1; zoomInput.value = 1; apply(); save();
  });
  return wrap;
}

function pinnedChar() {
  return state.characters.find((c) => c.id === state.pinnedId) || null;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// navegación
// ---------------------------------------------------------------------------

$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
    const view = btn.dataset.view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'assets') refreshAssets();
    if (view === 'characters') renderCharacters();
    if (view === 'series') renderSeries();
    if (view === 'elements') renderElements();
    if (view === 'poser') window.poserEnter?.();
    if (view === 'prompts') renderPromptLibrary();
    if (view === 'costs') loadCosts();
  });
});

function goToCreate() {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === 'create'));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-create'));
}

// ---------------------------------------------------------------------------
// modo imagen / audio
// ---------------------------------------------------------------------------

function setMode(mode) {
  state.mode = mode;
  // el personaje anclado aporta refs distintas según el modo
  // (asset:// verificado en video, fotos en imagen)
  if (state.pinnedId) applyPinnedCharacterPhotos();
  $('#modeImage').classList.toggle('active', mode === 'image');
  $('#modeVideo').classList.toggle('active', mode === 'video');
  $('#modeAudio').classList.toggle('active', mode === 'audio');
  $('#imageControls').hidden = mode !== 'image';
  $('#videoControls').hidden = mode !== 'video';
  $('#audioControls').hidden = mode !== 'audio';
  $('#tagPalette').hidden = mode !== 'audio';
  // el armador de tomas es propio del video
  $('#btnShotList').hidden = mode !== 'video';
  if (mode !== 'video') $('#shotListPanel').hidden = true;
  $('.editor-wrap').classList.toggle('tags-on', mode === 'audio' || mode === 'video');
  $('#promptBox').placeholder = mode === 'audio'
    ? 'Escribí el texto a locutar… usá [risas] o [whispers] para expresiones'
    : mode === 'video'
    ? 'Describí la escena en movimiento: acción, cámara, ambiente…'
    : 'Escribí lo que querés manifestar…';
  $('#btnGenerate').innerHTML = mode === 'audio' ? `${IC('mic')} Dar voz` : mode === 'video' ? `${IC('film')} Manifestar video` : `${IC('spark')} Manifestar`;
  if (mode === 'audio' && state.voices === null) loadVoices(false);
  if (mode === 'video') renderVideoControls();
  if (mode === 'image') renderRefs();
  renderHighlight();
  renderPinnedHint();
  updateEstimate();
}

$('#modeImage').addEventListener('click', () => setMode('image'));
$('#modeVideo').addEventListener('click', () => setMode('video'));
$('#modeAudio').addEventListener('click', () => setMode('audio'));

// ---------------------------------------------------------------------------
// resaltado de corchetes (modo audio)
// ---------------------------------------------------------------------------

const promptBox = $('#promptBox');
const highlighter = $('#highlighter');

function renderHighlight() {
  const text = promptBox.value;
  if (state.mode === 'audio') {
    highlighter.innerHTML = esc(text).replace(/\[([^\]\n]{1,60})\]/g, '<span class="tag">[$1]</span>') + '\n';
  } else if (state.mode === 'video' && state.video.mode === 'reference') {
    highlighter.innerHTML = esc(text).replace(/@image\d+/gi, '<span class="tag">$&</span>') + '\n';
  } else if (state.mode === 'video') {
    highlighter.innerHTML = esc(text) + '\n';
  } else {
    return;
  }
  highlighter.scrollTop = promptBox.scrollTop;
}

promptBox.addEventListener('input', () => { renderHighlight(); if (state.mode === 'audio') updateEstimate(); });
promptBox.addEventListener('scroll', () => { highlighter.scrollTop = promptBox.scrollTop; });
new ResizeObserver(() => {
  highlighter.style.height = promptBox.offsetHeight + 'px';
}).observe(promptBox);

function insertAtCursor(text) {
  const start = promptBox.selectionStart ?? promptBox.value.length;
  promptBox.setRangeText(text, start, promptBox.selectionEnd ?? start, 'end');
  promptBox.focus();
  renderHighlight();
}

function renderTagPalette() {
  const custom = state.config?.customAudioTags || [];
  const tags = [...AUDIO_TAGS, ...custom.filter((tag) => !AUDIO_TAGS.some((base) => base.toLowerCase() === tag.toLowerCase()))];
  $('#tagPalette').innerHTML = tags
    .map((t) => custom.includes(t)
      ? `<span class="tag-chip custom"><button data-tag="${esc(t)}" title="Insertar expresión">[${esc(t)}]</button><button class="tag-remove" data-remove-tag="${esc(t)}" title="Borrar expresión">×</button></span>`
      : `<button class="tag-chip" data-tag="${esc(t)}" title="Expresión nativa">[${esc(t)}]</button>`)
    .join('') + `<button class="tag-chip" data-tag="__custom">[ + propia ]</button>`;
  $$('#tagPalette [data-tag]').forEach((b) => {
    b.addEventListener('click', async () => {
      let tag = b.dataset.tag;
      if (tag === '__custom') {
        tag = window.prompt('Expresión (sin corchetes):', '');
        if (!tag) return;
        tag = cleanAudioTag(tag);
        if (!tag) return;
        await saveCustomAudioTag(tag);
      }
      insertAtCursor(`[${tag}] `);
    });
  });
  $$('#tagPalette [data-remove-tag]').forEach((b) => {
    b.addEventListener('click', () => removeCustomAudioTag(b.dataset.removeTag));
  });
}

async function copyPrompt(text) {
  if (!text) return toast('Este asset no tiene un prompt guardado', 'err');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
  }
  toast('Prompt copiado');
}

function assetInfo(key) {
  for (const zone of Object.values(state.assets)) {
    const found = zone.find((item) => item.key === key);
    if (found) return found;
  }
  const entry = state.history.find((item) => (item.outputs || []).includes(key));
  return entry ? { prompt: entry.prompt } : null;
}

function showLogin() {
  $('#loginModal').hidden = false;
  setTimeout(() => $('#loginPassword').focus(), 0);
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('#loginError');
  error.textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#loginPassword').value })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'No se pudo acceder');
    $('#loginModal').hidden = true;
    $('#loginPassword').value = '';
    await init();
  } catch (err) { error.textContent = err.message; }
});

function cleanAudioTag(tag) {
  return String(tag || '').trim().replace(/^\[+|\]+$/g, '').trim().slice(0, 60);
}

async function saveCustomAudioTag(tag) {
  const current = state.config.customAudioTags || [];
  if (AUDIO_TAGS.some((x) => x.toLowerCase() === tag.toLowerCase())
    || current.some((x) => x.toLowerCase() === tag.toLowerCase())) return;
  const customAudioTags = [...current, tag];
  try {
    state.config = await api('/api/config', { method: 'PUT', body: { customAudioTags } });
    renderTagPalette();
    renderConfigAudioTags();
    toast(`[${tag}] añadida a tus expresiones`);
  } catch (e) {
    toast(`Se insertará, pero no se pudo guardar: ${e.message}`, 'err');
  }
}

async function removeCustomAudioTag(tag) {
  const customAudioTags = (state.config.customAudioTags || []).filter((x) => x !== tag);
  try {
    state.config = await api('/api/config', { method: 'PUT', body: { customAudioTags } });
    renderTagPalette();
    renderConfigAudioTags();
    toast(`[${tag}] eliminada`);
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderConfigAudioTags() {
  const box = $('#configAudioTags');
  if (!box || !state.config) return;
  const custom = state.config.customAudioTags || [];
  box.innerHTML = AUDIO_TAGS.map((tag) => `<span class="manager-tag native" title="Expresión nativa">[${esc(tag)}]</span>`).join('')
    + custom.map((tag) => `<span class="manager-tag custom">[${esc(tag)}]<button type="button" data-config-remove="${esc(tag)}" title="Borrar">×</button></span>`).join('');
  box.querySelectorAll('[data-config-remove]').forEach((button) => {
    button.addEventListener('click', () => removeCustomAudioTag(button.dataset.configRemove));
  });
}

async function addAudioTagFromConfig() {
  const input = $('#newAudioTag');
  const tag = cleanAudioTag(input.value);
  if (!tag) return;
  await saveCustomAudioTag(tag);
  input.value = '';
  input.focus();
}

$('#btnAddAudioTag').addEventListener('click', addAudioTagFromConfig);
$('#newAudioTag').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addAudioTagFromConfig(); }
});

// ---------------------------------------------------------------------------
// traducción
// ---------------------------------------------------------------------------

async function translate(target) {
  const text = promptBox.value.trim();
  if (!text) return toast('La caja está vacía', 'err');
  const btn = target === 'en' ? $('#btnToEn') : $('#btnToEs');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '…';
  try {
    const { text: out } = await api('/api/translate', { method: 'POST', body: { text, target } });
    promptBox.value = out;
    renderHighlight();
    toast(target === 'en' ? 'Traducido al inglés' : 'Traducido al castellano');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

$('#btnToEn').addEventListener('click', () => translate('en'));
$('#btnToEs').addEventListener('click', () => translate('es'));

// ---------------------------------------------------------------------------
// controles de imagen
// ---------------------------------------------------------------------------

function chipRow(container, values, active, onPick, labelFn = (v) => v) {
  container.innerHTML = '';
  for (const v of values) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (container.id === 'modelChips' ? ' model-chip' : '');
    b.textContent = labelFn(v);
    b.classList.toggle('active', v === active);
    b.addEventListener('click', () => onPick(v));
    container.appendChild(b);
  }
}

function renderImageControls() {
  const m = currentModel();
  if (!m) return;
  state.modelId = m.id;
  if (!m.aspectRatios.includes(state.aspectRatio)) state.aspectRatio = m.aspectRatios[0];
  if (!m.resolutions.includes(state.resolution)) state.resolution = m.resolutions[0];
  if (state.refs.length > m.maxRefs) state.refs = state.refs.slice(0, m.maxRefs);

  chipRow($('#modelChips'), state.models.map((x) => x.id), m.id,
    (id) => { state.modelId = id; renderImageControls(); },
    (id) => state.models.find((x) => x.id === id).name);
  chipRow($('#arChips'), m.aspectRatios, state.aspectRatio,
    (v) => { state.aspectRatio = v; renderImageControls(); });
  chipRow($('#resChips'), m.resolutions, state.resolution,
    (v) => { state.resolution = v; renderImageControls(); });
  chipRow($('#batchChips'), [1, 2, 3, 4], state.batch,
    (v) => { state.batch = v; renderImageControls(); },
    (v) => `×${v}`);

  $('#modelNote').textContent = m.notes || '';
  renderRefs();
  renderCharacterVariantControl();
  updateEstimate();
}

function renderVideoControls() {
  const m = currentVideoModel();
  if (!m) return;
  state.video.modelId = m.id;
  if (!m.aspectRatios.includes(state.video.aspectRatio)) state.video.aspectRatio = m.aspectRatios[0];
  if (!m.resolutions.includes(state.video.resolution)) state.video.resolution = m.resolutions[0];
  if (!m.durations.includes(state.video.duration)) state.video.duration = m.durations[0];
  if (state.refs.length > activeRefLimit()) state.refs = state.refs.slice(0, activeRefLimit());

  chipRow($('#videoModelChips'), state.videoModels.map((x) => x.id), m.id,
    (id) => { state.video.modelId = id; renderVideoControls(); },
    (id) => state.videoModels.find((x) => x.id === id).name);
  chipRow($('#videoModeChips'), ['reference', 'frames'], state.video.mode,
    (v) => { state.video.mode = v; renderVideoControls(); },
    (v) => (v === 'reference' ? 'Referencias (@)' : 'Inicio → Fin'));
  $('#videoRefsHint').textContent = state.video.mode === 'reference'
    ? 'mencionalas en el prompt con @image1, @image2… (botón @ en cada miniatura)'
    : '1ª imagen = fotograma inicial · 2ª = final';
  chipRow($('#videoArChips'), m.aspectRatios, state.video.aspectRatio,
    (v) => { state.video.aspectRatio = v; renderVideoControls(); });
  chipRow($('#videoResChips'), m.resolutions, state.video.resolution,
    (v) => { state.video.resolution = v; renderVideoControls(); });
  chipRow($('#videoDurChips'), m.durations, state.video.duration,
    (v) => {
      state.video.duration = v;
      // al cambiar la duración del clip, las tomas se re-reparten solas
      if (state.shotList.length) state.shotList = shotListEven(state.shotList.length);
      renderVideoControls();
      if (!$('#shotListPanel').hidden) renderShotList();
    },
    (v) => `${v}s`);

  $('#videoAudioRow').hidden = !m.audio;
  $('#videoAudio').checked = m.audio && state.video.audio;
  $('#videoModelNote').textContent = m.notes || '';
  renderRefs();
  updateEstimate();
}

$('#videoAudio').addEventListener('change', (e) => { state.video.audio = e.target.checked; });

function renderRefs() {
  const isVideo = state.mode === 'video';
  const m = activeRefModel();
  if (!m) return;
  const maxRefs = activeRefLimit();
  const strip = $(isVideo ? '#videoRefsStrip' : '#refsStrip');
  strip.innerHTML = '';
  $(isVideo ? '#videoRefsCount' : '#refsCount').textContent = `${state.refs.length}/${maxRefs}`;
  const refMode = isVideo ? state.video.mode : null;
  state.refs.forEach((r, i) => {
    const isAsset = r.key.startsWith('asset://');
    const d = document.createElement('div');
    d.className = 'ref-thumb' + (r.fromChar ? ' from-char' : '') + (isAsset ? ' verified-asset' : '');
    // cómo se cita esta ref en el prompt: en video Seedance exige @imageN;
    // en imagen se cita por su etiqueta (si tiene) para decirle quién es quién
    const mention = refMode === 'reference' || !r.label ? `@image${i + 1}` : `@${r.label}`;
    const badge = refMode === 'reference' ? `<button class="ref-at" title="Insertar @image${i + 1} en el prompt">@${i + 1}</button>`
      : refMode === 'frames' ? `<span class="ref-badge">${i === 0 ? 'inicio' : 'fin'}</span>`
      : !isVideo && !isAsset ? `<button class="ref-at" title="Insertar ${esc(mention)} en el prompt">@${i + 1}</button>`
      : '';
    d.innerHTML = isAsset
      ? `<div class="asset-face" title="${esc(r.key)}">${IC('user', 'ic ic-lg')}<span>verificado</span></div>${badge}<button class="rm" title="Quitar">×</button>`
      : `<img src="${fileUrl(r.key)}" alt="">${r.label ? `<span class="ref-label-tag" title="La IA verá este texto sobre la imagen">${esc(r.label)}</span>` : ''}${badge}<button class="rm" title="Quitar">×</button><button class="ref-label-btn${r.label ? ' on' : ''}" title="${r.label ? `Etiqueta: ${esc(r.label)}` : 'Etiquetar para la IA (quién es quién)'}">T</button>`;
    d.querySelector('.rm').addEventListener('click', () => {
      state.refs.splice(i, 1);
      renderRefs();
      renderHighlight();
    });
    d.querySelector('.ref-label-btn')?.addEventListener('click', () => {
      const value = window.prompt(
        'Texto que la IA verá sobreimpreso en esta referencia (solo en la petición, la imagen no se modifica). Vacío = sin etiqueta:',
        r.label || refLabelSuggestion(r.key)
      );
      if (value === null) return;
      r.label = value.trim();
      renderRefs();
    });
    d.querySelector('.ref-at')?.addEventListener('click', () => insertAtCursor(`${mention} `));
    d.querySelector('img')?.addEventListener('click', () => openLightbox(r.key, state.refs.filter((ref) => !ref.key.startsWith('asset://')).map((ref) => ref.key)));
    strip.appendChild(d);
  });
  if (state.refs.length < maxRefs) {
    const add = document.createElement('button');
    add.className = 'ref-add';
    add.textContent = '+';
    add.title = 'Agregar imagen de referencia';
    add.addEventListener('click', () => openPicker());
    strip.appendChild(add);
  }
}

function addRef(key, fromChar = false) {
  const m = activeRefModel();
  const maxRefs = activeRefLimit();
  if (state.refs.some((r) => r.key === key)) return;
  if (state.refs.length >= maxRefs) {
    return toast(`${m.name} admite hasta ${maxRefs} referencia(s) en este modo`, 'err');
  }
  // las fotos de personajes llevan siempre el nombre como etiqueta (editable con T)
  state.refs.push({ key, fromChar, label: refLabelSuggestion(key) });
  renderRefs();
}

// nombre sugerido para etiquetar una ref que viene de un personaje o elemento
function refLabelSuggestion(key) {
  const charMatch = /^characters\/([^/]+)(?:\/variants\/([^/]+))?\//.exec(key);
  if (charMatch) return state.characters.find((c) => c.id === charMatch[1])?.name || '';
  const elMatch = /^elements\/([^/]+)(?:\/variants\/([^/]+))?\//.exec(key);
  if (elMatch) {
    const el = state.elements.find((x) => x.id === elMatch[1]);
    if (!el) return '';
    const variant = elMatch[2] ? (el.variants || []).find((v) => v.id === elMatch[2]) : null;
    return variant ? `${el.name} · ${variant.name}` : el.name;
  }
  return '';
}

// Estampa el texto sobre una COPIA de la imagen: chapita centrada arriba, de
// media imagen de ancho y blanco semitransparente, para que la IA la lea sin
// tapar la escena. El archivo original no se toca: la copia va solo en la
// petición. Se dimensiona por el ANCHO (si se usara el alto, en una imagen
// vertical el cartel se comería media escena).
function stampLabel(key, text) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const label = text.toUpperCase();
      const bannerW = Math.round(canvas.width * 0.5);
      let fontSize = Math.max(12, Math.round(canvas.width * 0.035));
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      // si el texto no entra en la mitad del ancho, achicamos la tipografía
      const padding = Math.round(fontSize * 0.6);
      while (fontSize > 10 && ctx.measureText(label).width > bannerW - padding * 2) {
        fontSize -= 1;
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      }
      const bannerH = Math.round(fontSize * 1.5);
      const x = Math.round((canvas.width - bannerW) / 2);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillRect(x, 0, bannerW, bannerH);
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, canvas.width / 2, bannerH / 2, bannerW - padding * 2);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen para etiquetarla'));
    img.src = fileUrl(key);
  });
}

async function buildLabeledRefs(refItems) {
  const out = {};
  for (const r of refItems) {
    if (!r.label || r.key.startsWith('asset://')) continue;
    try {
      out[r.key] = await stampLabel(r.key, r.label);
    } catch {
      toast(`No pude etiquetar una referencia; va sin etiqueta`, 'err');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// voces / controles de audio
// ---------------------------------------------------------------------------

async function loadVoices(showErrors = true) {
  try {
    const { voices } = await api('/api/voices');
    state.voices = voices;
  } catch (e) {
    state.voices = [];
    $('#voiceHint').textContent = 'No pude cargar voces — revisá la key de ElevenLabs en Configuración';
    if (showErrors) toast(e.message, 'err');
  }
  renderVoiceSelect();
  if (state.editingCharId !== null) renderCharModal();
}

function renderVoiceSelect() {
  const sel = $('#voiceSelect');
  const voices = state.voices || [];
  sel.innerHTML = '<option value="">— elegir voz —</option>' + voices
    .map((v) => `<option value="${v.id}">${esc(v.name)}${v.category ? ` · ${esc(v.category)}` : ''}</option>`)
    .join('');
  const pc = pinnedChar();
  if (pc?.voiceId && voices.some((v) => v.id === pc.voiceId)) {
    sel.value = pc.voiceId;
    state.voiceId = pc.voiceId;
    $('#voiceHint').textContent = `voz de ${pc.name} (personaje anclado)`;
  } else if (state.voiceId && voices.some((v) => v.id === state.voiceId)) {
    sel.value = state.voiceId;
  }
}

$('#voiceSelect').addEventListener('change', (e) => { state.voiceId = e.target.value; });
$('#btnReloadVoices').addEventListener('click', () => loadVoices(true));

// ---------------------------------------------------------------------------
// personaje anclado
// ---------------------------------------------------------------------------

function setPinned(id) {
  // quitar refs del personaje anterior
  state.refs = state.refs.filter((r) => !r.fromChar);
  state.pinnedId = id || '';
  state.characterVariantId = '';
  localStorage.setItem('pinnedCharacterId', state.pinnedId);
  localStorage.setItem('pinnedCharacterVariantId', '');
  const pc = pinnedChar();
  if (pc) {
    applyPinnedCharacterPhotos();
    if (pc.voiceId) state.voiceId = pc.voiceId;
    toast(`${pc.name} anclado`);
  }
  renderPinned();
  renderPinnedHint();
  renderRefs();
  renderVoiceSelect();
  renderCharacters();
  renderCharacterVariantControl();
}

function applyPinnedCharacterPhotos() {
  state.refs = state.refs.filter((r) => !r.fromChar);
  const pc = pinnedChar();
  if (!pc) return;
  // En video, un personaje con rostro real verificado va como asset://
  // (Seedance rechaza fotos con caras reales como input directo).
  if (state.mode === 'video' && pc.arkAssetId) {
    if (state.refs.length < activeRefLimit()) state.refs.push({ key: `asset://${pc.arkAssetId}`, fromChar: true });
    return;
  }
  const variant = (pc.variants || []).find((v) => v.id === state.characterVariantId);
  const photos = variant?.photos?.length ? variant.photos : pc.photos;
  for (const photo of photos.slice(0, Math.max(0, activeRefLimit() - state.refs.length))) {
    state.refs.push({ key: photo, fromChar: true, label: pc.name });
  }
}

function renderCharacterVariantControl() {
  sortEntities();
  const pc = pinnedChar();
  const row = $('#characterVariantRow');
  row.hidden = !pc || !(pc.variants || []).length;
  if (row.hidden) return;
  const select = $('#characterVariantSelect');
  select.innerHTML = `<option value="">Original (${pc.photos.length} fotos)</option>`
    + (pc.variants || []).map((v) => `<option value="${v.id}">${esc(v.name)} (${v.photos.length} fotos)</option>`).join('');
  select.value = state.characterVariantId;
}

$('#characterVariantSelect').addEventListener('change', (e) => {
  state.characterVariantId = e.target.value;
  localStorage.setItem('pinnedCharacterVariantId', state.characterVariantId);
  applyPinnedCharacterPhotos();
  renderRefs();
  renderPinnedHint();
});

function renderPinned() {
  const pc = pinnedChar();
  const card = $('#pinnedCard');
  card.hidden = !pc;
  if (!pc) return;
  const avatar = pc.photos[0]
    ? `<img src="${fileUrl(pc.photos[0])}" alt="">`
    : `<div class="char-avatar ph" style="width:40px;height:40px">${IC('user')}</div>`;
  $('#pinnedInfo').innerHTML = `${avatar}<div>
    <div class="pi-name">${esc(pc.name)}</div>
    <div class="pi-voice">${pc.voiceName ? IC('mic') + ' ' + esc(pc.voiceName) : 'sin voz asignada'}</div>
  </div>`;
}

function renderPinnedHint() {
  const pc = pinnedChar();
  const hint = $('#pinnedHint');
  hint.hidden = !pc;
  if (!pc) return;
  const variant = (pc.variants || []).find((v) => v.id === state.characterVariantId);
  hint.textContent = state.mode === 'image'
    ? `${pc.name}${variant ? ` · ${variant.name}` : ' · Original'}: sus fotos van como referencia`
    : state.mode === 'video' && pc.arkAssetId
    ? `${pc.name}: va como rostro real verificado (asset de ModelArk)`
    : `${pc.name}: ${pc.voiceName ? 'habla con su voz (' + pc.voiceName + ')' : 'no tiene voz asignada'}`;
}

$('#unpinBtn').addEventListener('click', () => setPinned(''));

// ---------------------------------------------------------------------------
// lista de tomas para video: arma el esqueleto "Shot N:" con sus tiempos
//
// La forma documentada para Seedance 2.0 es la toma numerada ("Shot 1: …"),
// con marca de tiempo de INICIO entre corchetes ("[0s]", "[3s]"). Los rangos
// tipo "[00-03s]" no son el formato documentado y fijar segundos exactos puede
// degradar el resultado, por eso las marcas son opcionales.
// ---------------------------------------------------------------------------

function videoMaxDuration() {
  return state.video.duration || currentVideoModel()?.durations?.at(-1) || 10;
}

function shotListEven(count = state.shotList.length) {
  const total = videoMaxDuration();
  const n = Math.max(1, count);
  const base = Math.floor((total / n) * 10) / 10;
  const rows = Array.from({ length: n }, () => base);
  // el resto se lo lleva la última toma para cerrar justo en el total
  rows[n - 1] = Math.round((total - base * (n - 1)) * 10) / 10;
  return rows;
}

function renderShotList() {
  const total = videoMaxDuration();
  const used = Math.round(state.shotList.reduce((sum, d) => sum + d, 0) * 10) / 10;
  $('#shotListTotal').textContent = `${state.shotList.length} toma${state.shotList.length === 1 ? '' : 's'} · ${fmtSec(used)} asignados · clip de ${fmtSec(total)}`;
  const warn = $('#shotListWarn');
  warn.textContent = used > total ? `Se pasa ${fmtSec(Math.round((used - total) * 10) / 10)} del clip: acortá tomas o usá “Repartir parejo”`
    : used < total ? `Quedan ${fmtSec(Math.round((total - used) * 10) / 10)} sin asignar` : '';
  warn.className = 'hint' + (used > total ? ' warn' : '');

  let at = 0;
  $('#shotListRows').innerHTML = state.shotList.map((dur, i) => {
    const start = Math.round(at * 10) / 10;
    at = Math.round((at + dur) * 10) / 10;
    // los rangos se muestran tal cual son (sin recortarlos al clip): si una
    // toma queda fuera, se marca en rojo en vez de mostrar un rango invertido
    const over = at > total;
    return `<div class="shot-list-row${over ? ' over' : ''}">
      <span class="shot-list-n">Shot ${i + 1}</span>
      <span class="shot-list-range">${fmtSec(start)} → ${fmtSec(at)}${start >= total ? ' · fuera del clip' : over ? ' · se corta' : ''}</span>
      <span class="num-field">
        <input type="number" min="0.5" max="${total}" step="0.5" value="${dur}" data-shotdur="${i}">
        <span class="num-steps">
          <button type="button" class="num-step" data-shotstep="${i}:1" title="Más">${IC('right')}</button>
          <button type="button" class="num-step" data-shotstep="${i}:-1" title="Menos">${IC('right')}</button>
        </span>
      </span> s
      <button class="mini-btn danger" data-shotdel="${i}" title="Quitar">×</button>
    </div>`;
  }).join('');
  $('#shotListRows').querySelectorAll('[data-shotdur]').forEach((input) => input.addEventListener('change', () => {
    const i = Number(input.dataset.shotdur);
    state.shotList[i] = Math.max(0.5, Math.min(total, Number(input.value) || 0.5));
    renderShotList();
  }));
  $('#shotListRows').querySelectorAll('[data-shotstep]').forEach((b) => b.addEventListener('click', () => {
    const [i, dir] = b.dataset.shotstep.split(':').map(Number);
    state.shotList[i] = Math.max(0.5, Math.min(total, Math.round((state.shotList[i] + dir * 0.5) * 10) / 10));
    renderShotList();
  }));
  $('#shotListRows').querySelectorAll('[data-shotdel]').forEach((b) => b.addEventListener('click', () => {
    state.shotList.splice(Number(b.dataset.shotdel), 1);
    if (!state.shotList.length) state.shotList = shotListEven(1);
    renderShotList();
  }));
  $('#shotListPreview').textContent = shotListText();
}

const fmtSec = (s) => `${Number.isInteger(s) ? s : s.toFixed(1)}s`;

function shotListText() {
  const marks = $('#shotListMarks').checked;
  let at = 0;
  return state.shotList.map((dur, i) => {
    const line = `${marks ? `[${fmtSec(at)}] ` : ''}Shot ${i + 1}: `;
    at = Math.round((at + dur) * 10) / 10;
    return line;
  }).join('\n');
}

function openShotList() {
  if (!state.shotList.length) state.shotList = shotListEven(3);
  $('#shotListPanel').hidden = false;
  renderShotList();
}

$('#btnShotList').addEventListener('click', () => {
  const panel = $('#shotListPanel');
  if (panel.hidden) openShotList(); else panel.hidden = true;
});
$('#shotListClose').addEventListener('click', () => { $('#shotListPanel').hidden = true; });
$('#shotListMarks').addEventListener('change', renderShotList);
$('#shotListAdd').addEventListener('click', () => {
  // la toma nueva ocupa lo que quede libre del clip: así no se pasa sola
  const total = videoMaxDuration();
  const used = state.shotList.reduce((sum, d) => sum + d, 0);
  const free = Math.round((total - used) * 10) / 10;
  if (free < 0.5) {
    // ya no entra: se reparte todo de nuevo entre una toma más
    state.shotList = shotListEven(state.shotList.length + 1);
    toast('No quedaba lugar: repartí el clip entre todas las tomas');
  } else {
    state.shotList.push(Math.min(free, 2));
  }
  renderShotList();
});
$('#shotListEven').addEventListener('click', () => {
  state.shotList = shotListEven(state.shotList.length);
  renderShotList();
});
$('#shotListInsert').addEventListener('click', () => {
  const text = shotListText();
  const current = promptBox.value.trimEnd();
  promptBox.value = current ? `${current}\n\n${text}` : text;
  renderHighlight();
  $('#shotListPanel').hidden = true;
  // el cursor queda al final de la primera toma, listo para escribir
  const firstEnd = promptBox.value.indexOf('\n', promptBox.value.length - text.length);
  const pos = firstEnd === -1 ? promptBox.value.length : firstEnd;
  promptBox.focus();
  promptBox.setSelectionRange(pos, pos);
  toast(`${state.shotList.length} tomas insertadas — completá cada una en inglés`);
});

// ---------------------------------------------------------------------------
// panel "Toma del guion": consulta de qué hay que generar, sin salir de Crear
// ---------------------------------------------------------------------------

function shotPanelScripts() {
  return state.scripts.filter((sc) => sc.seriesId === $('#shotPanelSeries').value);
}

function shotPanelCurrent() {
  const sc = state.scripts.find((x) => x.id === $('#shotPanelScript').value);
  if (!sc) return null;
  const [si, hi] = String($('#shotPanelShot').value || '').split(':').map(Number);
  const scene = sc.scenes[si];
  const shot = scene?.shots[hi];
  return shot ? { script: sc, scene, shot, si, hi } : null;
}

function renderShotPanelSeries() {
  sortEntities();
  const sel = $('#shotPanelSeries');
  const withScripts = state.series.filter((s) => state.scripts.some((sc) => sc.seriesId === s.id));
  sel.innerHTML = withScripts.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
  renderShotPanelScripts();
}

function renderShotPanelScripts() {
  const sel = $('#shotPanelScript');
  sel.innerHTML = shotPanelScripts().map((sc) => `<option value="${sc.id}">${esc(sc.title)}</option>`).join('');
  renderShotPanelShots();
}

function renderShotPanelShots() {
  const sc = state.scripts.find((x) => x.id === $('#shotPanelScript').value);
  const options = [];
  (sc?.scenes || []).forEach((scene, si) => scene.shots.forEach((shot, hi) => {
    options.push(`<option value="${si}:${hi}">Plano ${si + 1}.${hi + 1} — ${esc((scene.location || 'Sin locación').slice(0, 40))}</option>`);
  }));
  $('#shotPanelShot').innerHTML = options.join('');
  renderShotPanelBody();
}

function renderShotPanelBody() {
  const body = $('#shotPanelBody');
  const current = shotPanelCurrent();
  if (!current) {
    body.innerHTML = '<div class="hint">Elegí una serie con guiones para ver sus tomas. Los guiones se crean o importan desde Series.</div>';
    return;
  }
  const { script, scene, shot, si, hi } = current;
  const serie = state.series.find((s) => s.id === script.seriesId);
  body.innerHTML = `
    <div class="shot-panel-head">
      <strong>Plano ${si + 1}.${hi + 1}</strong>
      <span class="sb-slug">${esc(`${scene.intExt}. ${(scene.location || '').toUpperCase()} — ${scene.timeOfDay}`)}</span>
      <span class="sb-shot-specs">${esc(shot.size)} · ${esc(shot.lens)}${serie ? ` · ${esc(serie.format)}` : ''}</span>
    </div>
    ${shot.camera ? `<div class="sb-camera">${esc(shot.camera)}</div>` : ''}
    ${shot.items.length ? `<div class="sb-items">${shot.items.map(sbItemLine).join('')}</div>` : ''}
    ${sbPromptView(shot)}
    ${(shot.assetKeys || []).length ? `<div class="sb-assets" data-shotpanelstrip="1">${shot.assetKeys.map((k) =>
      `<button class="script-asset-thumb" data-k="${esc(k)}" title="${esc(k)}">${seriesAssetThumb(k)}</button>`).join('')}</div>` : ''}
    <div class="shot-panel-actions">
      ${shot.prompt ? `<button class="mini-btn" id="shotPanelUsePrompt">${IC('copy')} Usar su prompt en la caja</button>` : ''}
      <button class="mini-btn" id="shotPanelCopyDesc">${IC('copy')} Copiar la descripción</button>
    </div>`;
  body.querySelectorAll('.script-asset-thumb').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.k;
    if (!key.startsWith('audio/')) openLightbox(key, (shot.assetKeys || []).filter((x) => !x.startsWith('audio/')));
  }));
  $('#shotPanelUsePrompt')?.addEventListener('click', () => {
    promptBox.value = shot.prompt;
    renderHighlight();
    promptBox.focus();
    toast('Prompt del plano cargado en la caja');
  });
  $('#shotPanelCopyDesc')?.addEventListener('click', () => {
    const text = [
      `${scene.intExt}. ${(scene.location || '').toUpperCase()} — ${scene.timeOfDay}`,
      `${shot.size} · ${shot.lens}${shot.camera ? ` · ${shot.camera}` : ''}`,
      ...shot.items.map((item) => item.kind === 'dialogue' ? `${item.character}: ${item.text}` : item.text)
    ].join('\n');
    copyPrompt(text);
  });
}

function moveShotPanel(delta) {
  const sel = $('#shotPanelShot');
  const next = sel.selectedIndex + delta;
  if (next < 0 || next >= sel.options.length) return;
  sel.selectedIndex = next;
  renderShotPanelBody();
}

$('#btnShotPanel').addEventListener('click', () => {
  const panel = $('#shotPanel');
  const show = panel.hidden;
  panel.hidden = !show;
  $('#btnShotPanel').classList.toggle('active', show);
  if (show) renderShotPanelSeries();
});
$('#shotPanelSeries').addEventListener('change', renderShotPanelScripts);
$('#shotPanelScript').addEventListener('change', renderShotPanelShots);
$('#shotPanelShot').addEventListener('change', renderShotPanelBody);
$('#shotPanelPrev').addEventListener('click', () => moveShotPanel(-1));
$('#shotPanelNext').addEventListener('click', () => moveShotPanel(1));

// ---------------------------------------------------------------------------
// generación
// ---------------------------------------------------------------------------

async function generate() {
  const prompt = promptBox.value.trim();
  if (!prompt) return toast('Escribí un prompt primero', 'err');
  const pc = pinnedChar();
  const voiceId = state.voiceId || pc?.voiceId;
  const voice = (state.voices || []).find((v) => v.id === voiceId);
  const isImage = state.mode === 'image';
  const isVideo = state.mode === 'video';
  const model = isVideo ? currentVideoModel() : currentModel();
  // las etiquetas se estampan acá, sobre copias: el asset guardado queda limpio
  const refsUsed = isImage ? state.refs : isVideo ? state.refs.slice(0, activeRefLimit()) : [];
  const labeledRefs = refsUsed.some((r) => r.label) ? await buildLabeledRefs(refsUsed) : {};
  const job = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: 'queued', prompt, createdAt: Date.now(),
    label: isImage ? `${model.name} · ${state.resolution} · ×${state.batch}`
      : isVideo ? `${model.name} · ${state.video.resolution} · ${state.video.duration}s`
      : `Eleven v3 · ${voice?.name || pc?.voiceName || 'voz'}`,
    path: isImage ? '/api/generate/image' : isVideo ? '/api/generate/video' : '/api/generate/audio',
    body: isImage ? {
      modelId: state.modelId, prompt, aspectRatio: state.aspectRatio,
      resolution: state.resolution, batch: state.batch,
      refs: state.refs.map((r) => r.key), labeledRefs, characterId: state.pinnedId || null,
      characterVariantId: state.characterVariantId || null
    } : isVideo ? {
      modelId: state.video.modelId, prompt, mode: state.video.mode,
      aspectRatio: state.video.aspectRatio, resolution: state.video.resolution,
      duration: state.video.duration, audio: state.video.audio,
      refs: state.refs.slice(0, activeRefLimit()).map((r) => r.key), labeledRefs,
      characterId: state.pinnedId || null
    } : { text: prompt, voiceId, voiceName: voice?.name || pc?.voiceName || '', characterId: state.pinnedId || null }
  };
  state.generationJobs.unshift(job);
  renderGenerationQueue();
  pumpGenerationQueue();
  toast('Generación añadida a la cola');
}

function pumpGenerationQueue() {
  while (state.activeGenerations < 3) {
    const job = [...state.generationJobs].reverse().find((item) => item.status === 'queued');
    if (!job) break;
    runGenerationJob(job);
  }
}

async function runGenerationJob(job) {
  job.status = 'running';
  job.startedAt = Date.now();
  state.activeGenerations += 1;
  renderGenerationQueue();
  try {
    const entry = await api(job.path, { method: 'POST', body: job.body });
    job.status = 'done'; job.entry = entry; job.finishedAt = Date.now();
    state.history.unshift(entry);
    if (entry.type === 'image' && entry.characterId) {
      for (const key of entry.outputs) state.assetLinks.unshift({ key, characterId: entry.characterId, variantId: entry.characterVariantId || null, ts: entry.ts });
      renderCharacters();
    }
    showEntry(entry);
    renderHistory();
    const costTxt = entry.cost ? ` — $${entry.cost.toFixed(3)}` : '';
    if (entry.errors?.length) toast(`Listo, pero ${entry.errors.length} del lote fallaron: ${entry.errors[0]}`, 'err');
    else toast(`Manifestado${costTxt}`);
  } catch (e) {
    job.status = 'error'; job.error = e.message; job.finishedAt = Date.now();
    toast(e.message, 'err');
  } finally {
    state.activeGenerations -= 1;
    renderGenerationQueue();
    pumpGenerationQueue();
  }
}

function renderGenerationQueue() {
  const box = $('#generationQueue');
  box.hidden = !state.generationJobs.length;
  if (box.hidden) return;
  const active = state.generationJobs.filter((j) => j.status === 'running').length;
  const queued = state.generationJobs.filter((j) => j.status === 'queued').length;
  box.innerHTML = `<div class="generation-queue-head"><span>Cola de generación</span><span>${active} activas · ${queued} esperando</span></div>`
    + state.generationJobs.slice(0, 12).map((job) => `<div class="generation-job ${job.status}" data-job="${job.id}">
      <div class="job-status">${job.status === 'queued' ? 'Ⅱ' : job.status === 'running' ? '●' : job.status === 'done' ? '✓' : '!'}</div>
      <div class="job-main"><div class="job-title">${esc(job.label)}</div><div class="job-prompt ${job.status === 'error' ? 'job-error' : ''}">${esc(job.error || job.prompt)}</div></div>
      <div class="job-actions">${job.entry ? '<button class="mini-btn" data-job-act="view">Ver</button>' : ''}${['done','error'].includes(job.status) ? '<button class="icon-btn" data-job-act="dismiss">×</button>' : ''}</div>
    </div>`).join('');
  box.querySelectorAll('[data-job]').forEach((row) => row.querySelectorAll('[data-job-act]').forEach((button) => button.addEventListener('click', () => {
    const job = state.generationJobs.find((item) => item.id === row.dataset.job);
    if (button.dataset.jobAct === 'view' && job?.entry) showEntry(job.entry);
    if (button.dataset.jobAct === 'dismiss') { state.generationJobs = state.generationJobs.filter((item) => item.id !== row.dataset.job); renderGenerationQueue(); }
  })));
}

$('#btnGenerate').addEventListener('click', generate);
promptBox.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
});

// ---------------------------------------------------------------------------
// vista grande + historial
// ---------------------------------------------------------------------------

function showEntry(entry, outputIdx = 0) {
  state.currentEntry = entry;
  state.currentOutput = outputIdx;
  const bv = $('#bigView');
  bv.hidden = false;

  if (entry.type === 'audio') {
    bv.innerHTML = `
      <div class="bv-media"><div style="padding:8px;color:var(--pink)">${IC('mic', 'ic ic-lg')}</div>
        <audio controls autoplay src="${fileUrl(entry.outputs[0])}"></audio>
      </div>
      <div class="bv-meta">${esc(entry.voiceName || 'voz')} · Eleven v3 · ${fmtDate(entry.ts)}</div>
      <div class="bv-actions">
        <button class="mini-btn" data-act="copy">${IC('copy')} Copiar prompt</button>
        <button class="mini-btn" data-act="regen">${IC('refresh')} Regenerar</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} Editar envío</button>
        <a class="mini-btn" href="${fileUrl(entry.outputs[0])}" download>${IC('download')} Descargar</a>
      </div>`;
  } else if (entry.type === 'video') {
    const key = entry.outputs[0];
    bv.innerHTML = `
      <div class="bv-media"><video controls autoplay loop src="${fileUrl(key)}"></video></div>
      <div class="bv-meta">${esc(entry.modelName)} · ${entry.aspectRatio} · ${entry.resolution} · ${entry.duration}s${entry.audio ? ' · con audio' : ''} · ${fmtDate(entry.ts)}</div>
      <div class="bv-actions">
        <button class="mini-btn" data-act="copy">${IC('copy')} Copiar prompt</button>
        <button class="mini-btn" data-act="regen">${IC('refresh')} Regenerar</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} Editar envío</button>
        <a class="mini-btn" href="${fileUrl(key)}" download>${IC('download')} Descargar</a>
      </div>`;
  } else {
    const key = entry.outputs[outputIdx] || entry.outputs[0];
    const thumbs = entry.outputs.length > 1
      ? `<div class="bv-thumbs">${entry.outputs.map((o, i) =>
          `<img src="${fileUrl(o)}" class="${i === outputIdx ? 'sel' : ''}" data-i="${i}" alt="">`).join('')}</div>`
      : '';
    bv.innerHTML = `
      <div class="bv-media bv-media-nav">
        ${entry.outputs.length > 1 ? `<button class="bv-nav bv-prev" data-output-nav="-1" title="Anterior">${IC('left', 'ic ic-lg')}</button>` : ''}
        <img id="bvMain" src="${fileUrl(key)}" alt="">
        ${entry.outputs.length > 1 ? `<button class="bv-nav bv-next" data-output-nav="1" title="Siguiente">${IC('right', 'ic ic-lg')}</button>` : ''}
      </div>
      ${entry.outputs.length > 1 ? `<div class="bv-counter">${outputIdx + 1} / ${entry.outputs.length}</div>` : ''}
      ${thumbs}
      <div class="bv-meta">${esc(entry.modelName)} · ${entry.aspectRatio} · ${entry.resolution}${entry.batch > 1 ? ` · lote ×${entry.batch}` : ''} · ${fmtDate(entry.ts)}</div>
      <div class="bv-actions">
        <button class="mini-btn" data-act="copy">${IC('copy')} Copiar prompt</button>
        <button class="mini-btn" data-act="ref">${IC('link')} Usar como referencia</button>
        <button class="mini-btn" data-act="character">${IC('user')} Convertir en personaje</button>
        <button class="mini-btn" data-act="regen">${IC('refresh')} Regenerar</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} Editar envío</button>
        <a class="mini-btn" href="${fileUrl(key)}" download>${IC('download')} Descargar</a>
      </div>`;
    $('#bvMain').addEventListener('click', () => openLightbox(key, entry.outputs));
    $$('#bigView .bv-thumbs img').forEach((im) => {
      im.addEventListener('click', () => showEntry(entry, Number(im.dataset.i)));
    });
    $$('#bigView [data-output-nav]').forEach((button) => button.addEventListener('click', () => {
      const next = (outputIdx + Number(button.dataset.outputNav) + entry.outputs.length) % entry.outputs.length;
      showEntry(entry, next);
    }));
  }
  $$('#bigView [data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'regen') regenerate(entry);
      if (act === 'copy') copyPrompt(entry.prompt);
      if (act === 'edit') editEntry(entry);
      if (act === 'ref') { addRef(entry.outputs[state.currentOutput]); toast('Agregada como referencia'); }
      if (act === 'character') openCharModal(null, entry.outputs[state.currentOutput]);
    });
  });
}

async function regenerate(entry) {
  promptBox.value = entry.prompt;
  renderHighlight();
  if (entry.type === 'audio') {
    setMode('audio');
    state.voiceId = entry.voiceId || state.voiceId;
    renderVoiceSelect();
    if (state.voiceId !== entry.voiceId && entry.voiceId) {
      state.voiceId = entry.voiceId;
      $('#voiceSelect').value = entry.voiceId;
    }
  } else if (entry.type === 'video') {
    setMode('video');
    state.video.modelId = entry.modelId;
    state.video.aspectRatio = entry.aspectRatio;
    state.video.resolution = entry.resolution;
    state.video.mode = entry.mode || 'reference';
    state.video.duration = entry.duration || 5;
    state.video.audio = Boolean(entry.audio);
    state.refs = (entry.refs || []).map((k) => ({ key: k, fromChar: false }));
    renderVideoControls();
  } else {
    setMode('image');
    state.modelId = entry.modelId;
    state.aspectRatio = entry.aspectRatio;
    state.resolution = entry.resolution;
    state.batch = entry.batch || 1;
    state.refs = (entry.refs || []).map((k) => ({ key: k, fromChar: false }));
    renderImageControls();
  }
  goToCreate();
  await generate();
}

function editEntry(entry) {
  promptBox.value = entry.prompt;
  if (entry.type === 'audio') {
    setMode('audio');
    if (entry.voiceId) { state.voiceId = entry.voiceId; renderVoiceSelect(); $('#voiceSelect').value = entry.voiceId; }
  } else if (entry.type === 'video') {
    setMode('video');
    state.video.modelId = entry.modelId;
    state.video.aspectRatio = entry.aspectRatio;
    state.video.resolution = entry.resolution;
    state.video.mode = entry.mode || 'reference';
    state.video.duration = entry.duration || 5;
    state.video.audio = Boolean(entry.audio);
    state.refs = (entry.refs || []).map((k) => ({ key: k, fromChar: false }));
    renderVideoControls();
  } else {
    setMode('image');
    state.modelId = entry.modelId;
    state.aspectRatio = entry.aspectRatio;
    state.resolution = entry.resolution;
    state.batch = entry.batch || 1;
    state.refs = (entry.refs || []).map((k) => ({ key: k, fromChar: false }));
    renderImageControls();
  }
  renderHighlight();
  goToCreate();
  promptBox.focus();
  toast('Envío cargado en la caja — editalo y manifestá');
}

function renderHistory() {
  const list = $('#historyList');
  if (!state.history.length) {
    list.innerHTML = '<div class="empty-note">Todavía no manifestaste nada. Todo llega.</div>';
    return;
  }
  list.innerHTML = '';
  for (const entry of state.history) {
    const item = document.createElement('div');
    item.className = 'hist-item';
    const thumbs = entry.type === 'audio'
      ? `<div class="hist-audio-icon">${IC('mic', 'ic ic-lg')}</div>`
      : entry.type === 'video'
      ? entry.outputs.slice(0, 4).map((o, i) => `<video src="${fileUrl(o)}" data-i="${i}" preload="metadata" muted></video>`).join('')
      : entry.outputs.slice(0, 4).map((o, i) => `<img src="${fileUrl(o)}" data-i="${i}" alt="" loading="lazy">`).join('');
    item.innerHTML = `
      <div class="hist-thumbs">${thumbs}</div>
      <div class="hist-body">
        <div class="hist-prompt">${esc(entry.prompt)}</div>
        <div class="hist-meta">${esc(entry.modelName)}${entry.type === 'audio' ? ` · ${esc(entry.voiceName || '')}` : entry.type === 'video' ? ` · ${entry.aspectRatio} · ${entry.resolution} · ${entry.duration}s` : ` · ${entry.aspectRatio} · ${entry.resolution}${entry.batch > 1 ? ' · ×' + entry.batch : ''}`} · ${fmtDate(entry.ts)}${entry.errors?.length ? ` · <span class="err">${entry.errors.length} error(es) en el lote</span>` : ''}</div>
      </div>
      <div class="hist-actions">
        <button class="mini-btn" data-act="view">${IC('eye')} Ver</button>
        <button class="mini-btn" data-act="regen" title="Regenerar">${IC('refresh')}</button>
        <button class="mini-btn" data-act="edit" title="Editar envío">${IC('edit')}</button>
        ${entry.type === 'image' ? `<button class="mini-btn" data-act="ref" title="Usar como referencia">${IC('link')}</button>` : ''}
        <button class="mini-btn danger" data-act="del" title="Borrar">${IC('trash')}</button>
      </div>`;
    item.querySelectorAll('.hist-thumbs img, .hist-thumbs video').forEach((im) => {
      im.addEventListener('click', () => showEntry(entry, Number(im.dataset.i)));
    });
    item.querySelector('.hist-audio-icon')?.addEventListener('click', () => showEntry(entry));
    item.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'view') { showEntry(entry); $('#bigView').scrollIntoView({ behavior: 'smooth' }); }
        if (act === 'regen') regenerate(entry);
        if (act === 'edit') editEntry(entry);
        if (act === 'ref') { addRef(entry.outputs[0]); toast('Agregada como referencia'); }
        if (act === 'del') {
          await api(`/api/history/${entry.id}`, { method: 'DELETE' });
          state.history = state.history.filter((x) => x.id !== entry.id);
          renderHistory();
          toast('Borrado del historial (los archivos quedan en tu carpeta)');
        }
      });
    });
    list.appendChild(item);
  }
}

$('#btnClearHistory').addEventListener('click', async () => {
  if (!state.history.length) return toast('El historial ya está vacío');
  if (!confirm(`¿Borrar las ${state.history.length} operaciones del historial?\n\nLos archivos de Assets no se borrarán.`)) return;
  const result = await api('/api/history', { method: 'DELETE' });
  state.history = [];
  $('#bigView').hidden = true;
  renderHistory();
  toast(`${result.deleted} operaciones borradas del historial`);
});

// ---------------------------------------------------------------------------
// prompts archivados
// ---------------------------------------------------------------------------

$('#btnSavePrompt').addEventListener('click', async () => {
  const text = promptBox.value.trim();
  if (!text) return toast('La caja está vacía', 'err');
  openPromptEditor({ initialText: text, initialMode: state.mode, source: 'quick' });
});

$('#btnPrompts').addEventListener('click', () => {
  const panel = $('#promptsPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderPromptsPanel();
});

function renderPromptsPanel() {
  const panel = $('#promptsPanel');
  if (!state.prompts.length) {
    panel.innerHTML = '<div class="empty-note" style="padding:10px 0">No hay prompts archivados. Guardá los que uses seguido con el botón Guardar.</div>';
    return;
  }
  panel.innerHTML = '';
  const categories = promptCategories();
  const toolbar = document.createElement('div');
  toolbar.className = 'prompts-quick-tools';
  toolbar.innerHTML = `
    <select class="select" id="quickPromptCategory"><option value="">Todas las categorías</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
    <input id="quickPromptSearch" type="search" placeholder="Buscar por título o contenido…" value="${esc(state.promptQuickSearch)}">
    <span class="hint" id="quickPromptCount"></span>`;
  panel.appendChild(toolbar);
  const categorySelect = toolbar.querySelector('#quickPromptCategory');
  categorySelect.value = state.promptQuickCategory;
  categorySelect.addEventListener('change', () => { state.promptQuickCategory = categorySelect.value; renderPromptsPanel(); });
  toolbar.querySelector('#quickPromptSearch').addEventListener('input', (e) => {
    state.promptQuickSearch = e.target.value;
    renderPromptsPanel();
    const input = $('#quickPromptSearch'); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  });
  const query = state.promptQuickSearch.trim().toLowerCase();
  const filtered = state.prompts.filter((pr) =>
    (!state.promptQuickCategory || (pr.category || 'General') === state.promptQuickCategory)
    && (!query || `${pr.title} ${pr.text} ${pr.category || ''}`.toLowerCase().includes(query)));
  toolbar.querySelector('#quickPromptCount').textContent = `${filtered.length} de ${state.prompts.length}`;
  if (!filtered.length) {
    panel.insertAdjacentHTML('beforeend', '<div class="empty-note" style="padding:14px 0">No hay prompts que coincidan con el filtro.</div>');
    return;
  }
  for (const pr of filtered) {
    const d = document.createElement('div');
    d.className = 'prompt-item';
    d.innerHTML = `<span class="p-mode">${pr.mode === 'audio' ? IC('mic') : pr.mode === 'video' ? IC('film') : IC('image')}</span>
      <span class="p-title">${esc(pr.category || 'General')} · ${esc(pr.title)}</span>
      <span class="p-text">${esc(pr.text)}</span>
      <button class="icon-btn" title="Eliminar">${IC('x')}</button>`;
    d.addEventListener('click', (e) => {
      if (e.target.closest('.icon-btn')) return;
      promptBox.value = pr.text;
      setMode(['audio', 'video'].includes(pr.mode) ? pr.mode : 'image');
      renderHighlight();
      promptBox.focus();
    });
    d.querySelector('.icon-btn').addEventListener('click', async () => {
      await api(`/api/prompts/${pr.id}`, { method: 'DELETE' });
      state.prompts = state.prompts.filter((x) => x.id !== pr.id);
      renderPromptsPanel();
    });
    panel.appendChild(d);
  }
}

// ---------------------------------------------------------------------------
// selector de referencias (picker)
// ---------------------------------------------------------------------------

function openPicker() {
  $('#pickerModal').hidden = false;
  setPickerTab(state.pickerTab || 'upload');
}

$('#pickerClose').addEventListener('click', () => { $('#pickerModal').hidden = true; });
$$('#pickerTabs .tab').forEach((t) => {
  t.addEventListener('click', () => setPickerTab(t.dataset.src));
});

async function setPickerTab(src) {
  state.pickerTab = src;
  $$('#pickerTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.src === src));
  const body = $('#pickerBody');

  if (src === 'upload') {
    body.innerHTML = '<div class="drop-zone" id="dropZone">Arrastrá imágenes acá<br>o hacé clic para elegir archivos</div>';
    const dz = $('#dropZone');
    dz.addEventListener('click', () => {
      $('#fileInput').onchange = async (e) => { await uploadFiles([...e.target.files], true); e.target.value = ''; };
      $('#fileInput').click();
    });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault();
      dz.classList.remove('over');
      await uploadFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')), true);
    });
    return;
  }

  if (src === 'poses') {
    const { poses } = await api('/api/poser');
    const withThumb = poses.filter((x) => x.thumbKey);
    body.innerHTML = withThumb.length
      ? `<div class="picker-grid">${withThumb.map((x) =>
          `<div class="pick" data-key="${esc(x.thumbKey)}"><img src="${fileUrl(x.thumbKey)}" loading="lazy" alt=""><div class="p-label">${esc(x.category || 'General')} · ${esc(x.name)}</div></div>`
        ).join('')}</div>`
      : '<div class="empty-note">Todavía no guardaste escenas en el Poser.</div>';
  } else if (src === 'characters') {
    renderPickerCharacters();
    return;
  } else if (src === 'elements') {
    renderPickerElements();
    return;
  } else if (src === 'series') {
    renderPickerSeries();
    return;
  } else {
    await refreshAssets();
    const items = state.assets[src] || [];
    body.innerHTML = items.length
      ? `<div class="picker-grid">${items.map((a) =>
          `<div class="pick" data-key="${esc(a.key)}"><img src="${fileUrl(a.key)}" loading="lazy" alt=""><div class="p-label">${esc(a.name)}</div></div>`
        ).join('')}</div>`
      : '<div class="empty-note">Nada por acá todavía.</div>';
  }

  $$('#pickerBody .pick').forEach((p) => {
    p.addEventListener('click', () => {
      addRef(p.dataset.key);
      $('#pickerModal').hidden = true;
    });
  });
}

// Drill-down genérico del picker: lista de entidades → (opcional) chips de
// versión → fotos. Lo usan Personajes, Locaciones/Objetos y Series con su
// propia config. `render` es la función-wrapper de cada tab (para re-dibujar).
function renderEntityPicker(cfg) {
  sortEntities();
  const body = $('#pickerBody');
  const chosen = cfg.items().find((x) => x.id === state[cfg.idKey]);
  const attachPick = () => body.querySelectorAll('.pick[data-key]').forEach((p) =>
    p.addEventListener('click', () => { addRef(p.dataset.key); $('#pickerModal').hidden = true; }));

  if (!chosen) {
    const items = cfg.items();
    body.innerHTML = items.length
      ? `<div class="picker-grid">${items.map((it) => {
          const cover = cfg.cover(it);
          return `<div class="pick" data-id="${it.id}">${cover
            ? `<img src="${fileUrl(cover)}" loading="lazy" alt="">`
            : `<div class="pick-ph">${IC(cfg.icon, 'ic ic-lg')}</div>`}<div class="p-label">${esc(cfg.label(it))}</div></div>`;
        }).join('')}</div>`
      : `<div class="empty-note">${cfg.empty}</div>`;
    body.querySelectorAll('[data-id]').forEach((n) => n.addEventListener('click', () => {
      state[cfg.idKey] = n.dataset.id;
      if (cfg.variantKey) state[cfg.variantKey] = '';
      cfg.render();
    }));
    return;
  }

  const groups = cfg.groups(chosen);
  const group = groups.find((g) => g.id === (cfg.variantKey ? state[cfg.variantKey] : '')) || groups[0];
  body.innerHTML = `
    <div class="picker-char-head">
      <button class="mini-btn" id="pickerBack">← ${esc(cfg.backLabel)}</button>
      <strong>${esc(cfg.title(chosen))}</strong>
      ${groups.length > 1
        ? `<div class="chips">${groups.map((g) => `<button class="chip${g.id === group.id ? ' active' : ''}" data-vg="${esc(g.id)}">${esc(g.name)} (${g.photos.length})</button>`).join('')}</div>`
        : `<span class="hint">${group.photos.length} imagen${group.photos.length === 1 ? '' : 'es'}</span>`}
    </div>
    ${group.photos.length
      ? `<div class="picker-grid">${group.photos.map((ph) =>
          `<div class="pick" data-key="${esc(ph)}"><img src="${fileUrl(ph)}" loading="lazy" alt=""><div class="p-label">${esc(cfg.photoLabel(chosen, group))}</div></div>`).join('')}</div>`
      : `<div class="empty-note">${cfg.emptyPhotos}</div>`}`;
  $('#pickerBack').addEventListener('click', () => {
    state[cfg.idKey] = '';
    if (cfg.variantKey) state[cfg.variantKey] = '';
    cfg.render();
  });
  if (cfg.variantKey) body.querySelectorAll('[data-vg]').forEach((b) =>
    b.addEventListener('click', () => { state[cfg.variantKey] = b.dataset.vg; cfg.render(); }));
  attachPick();
}

const entityVariantGroups = (e) => [
  { id: '', name: 'Original', photos: e.photos || [] },
  ...(e.variants || []).map((v) => ({ id: v.id, name: v.name, photos: v.photos || [] }))
];
const firstPhoto = (e) => e.photos[0] || (e.variants || []).find((v) => (v.photos || []).length)?.photos[0];
const seriesImages = (s) => (s.assetKeys || []).filter((k) => !/^(audio|video)\//.test(k));

function renderPickerCharacters() {
  renderEntityPicker({
    idKey: 'pickerCharacterId', variantKey: 'pickerVariantId', icon: 'user',
    items: () => state.characters, cover: firstPhoto, groups: entityVariantGroups,
    label: (c) => `${c.name}${(c.variants || []).length ? ` · ${1 + c.variants.length} versiones` : ''}`,
    title: (c) => c.name, photoLabel: (c, g) => `${c.name} · ${g.name}`,
    backLabel: 'Personajes', empty: 'Todavía no hay personajes.',
    emptyPhotos: 'Esta versión todavía no tiene fotos.', render: renderPickerCharacters
  });
}

function renderPickerElements() {
  renderEntityPicker({
    idKey: 'pickerElementId', variantKey: 'pickerElementVariantId', icon: 'globe',
    items: () => state.elements, cover: firstPhoto, groups: entityVariantGroups,
    label: (el) => `${el.name} · ${ELEMENT_KIND_LABEL[el.kind] || ''}${(el.variants || []).length ? ` · ${1 + el.variants.length} versiones` : ''}`,
    title: (el) => el.name, photoLabel: (el, g) => `${el.name} · ${g.name}`,
    backLabel: 'Locaciones y objetos', empty: 'Todavía no hay locaciones ni objetos.',
    emptyPhotos: 'Esta versión todavía no tiene fotos.', render: renderPickerElements
  });
}

function renderPickerSeries() {
  renderEntityPicker({
    idKey: 'pickerSeriesId', variantKey: null, icon: 'layers',
    items: () => state.series, cover: (s) => seriesImages(s)[0],
    groups: (s) => [{ id: '', name: s.title, photos: seriesImages(s) }],
    label: (s) => `${s.title} · ${seriesImages(s).length} img`,
    title: (s) => s.title, photoLabel: (s) => s.title,
    backLabel: 'Series', empty: 'Todavía no hay series.',
    emptyPhotos: 'Esta serie no tiene imágenes asociadas todavía.', render: renderPickerSeries
  });
}

async function uploadFiles(files, asRefs) {
  if (!files.length) return;
  for (const f of files) {
    try {
      // el cuerpo de la petición admite 150 MB y el base64 infla ~33%
      if (f.size > 100 * 1024 * 1024) {
        toast(`${f.name}: pesa más de 100 MB, achicalo antes de subirlo`, 'err');
        continue;
      }
      const dataUrl = await readFileAsDataUrl(f);
      const { key } = await api('/api/upload', { method: 'POST', body: { name: f.name, dataUrl } });
      if (asRefs) addRef(key);
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 'err');
    }
  }
  if (asRefs) {
    $('#pickerModal').hidden = true;
    toast(`${files.length} imagen(es) subida(s) y agregada(s) como referencia`);
  } else {
    toast(`${files.length} imagen(es) subida(s)`);
  }
  refreshAssets();
}

function isCreateViewActive() {
  return $('#view-create')?.classList.contains('active');
}

document.addEventListener('paste', async (e) => {
  if (!isCreateViewActive() || !['image', 'video'].includes(state.mode)) return;
  if (!e.clipboardData?.items?.length) return;
  const files = [...e.clipboardData.items]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      return new File([file], file.name || `clipboard-${Date.now()}-${index + 1}.${ext}`, { type: file.type });
    })
    .filter(Boolean);
  if (!files.length) return;
  e.preventDefault();
  try {
    await uploadFiles(files, true);
    toast(`${files.length} imagen${files.length === 1 ? '' : 'es'} pegada${files.length === 1 ? '' : 's'} como referencia`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------

async function refreshAssets() {
  state.assets = await api('/api/assets');
  renderAssetFilterOptions();
  renderAssetsGrid();
}

function renderAssetFilterOptions() {
  const charSel = $('#assetFilterCharacter');
  const seriesSel = $('#assetFilterSeries');
  charSel.innerHTML = '<option value="">Todos</option>' + state.characters.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  seriesSel.innerHTML = '<option value="">Todas</option>' + state.series.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
  charSel.value = state.characters.some((c) => c.id === state.assetFilterCharacterId) ? state.assetFilterCharacterId : '';
  seriesSel.value = state.series.some((s) => s.id === state.assetFilterSeriesId) ? state.assetFilterSeriesId : '';
  state.assetFilterCharacterId = charSel.value;
  state.assetFilterSeriesId = seriesSel.value;
}

$('#assetFilterCharacter').addEventListener('change', () => {
  state.assetFilterCharacterId = $('#assetFilterCharacter').value;
  renderAssetsGrid();
});
$('#assetFilterSeries').addEventListener('change', () => {
  state.assetFilterSeriesId = $('#assetFilterSeries').value;
  renderAssetsGrid();
});

$$('#view-assets .tabs .tab').forEach((t) => {
  t.addEventListener('click', () => {
    state.assetsZone = t.dataset.zone;
    state.selectedAssets.clear();
    $$('#view-assets .tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    renderAssetsGrid();
  });
});

$('#btnUploadAsset').addEventListener('click', () => {
  $('#fileInput').onchange = async (e) => { await uploadFiles([...e.target.files], false); e.target.value = ''; };
  $('#fileInput').click();
});

function renderAssetsGrid() {
  const grid = $('#assetsGrid');
  const allItems = state.assets[state.assetsZone] || [];
  const items = visibleAssets();
  $('#assetsSummary').textContent = `${items.length} de ${allItems.length} assets`;
  updateAssetSelection();
  if (!items.length) {
    grid.innerHTML = '<div class="empty-note">No hay assets en este rango.</div>';
    return;
  }
  grid.innerHTML = '';
  for (const group of groupAssetSessions(items)) {
    const section = document.createElement('section');
    section.className = 'asset-session';
    const start = new Date(group[group.length - 1].mtime);
    const end = new Date(group[0].mtime);
    const title = start.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    const time = (date) => date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    section.innerHTML = `<div class="asset-session-head"><div><h3>${esc(title)}</h3><span>${time(start)}–${time(end)} · ${group.length} archivo${group.length === 1 ? '' : 's'}</span></div><button class="mini-btn session-select">Seleccionar grupo</button></div><div class="asset-session-grid"></div>`;
    const sessionGrid = section.querySelector('.asset-session-grid');
    section.querySelector('.session-select').addEventListener('click', () => {
      const every = group.every((a) => state.selectedAssets.has(a.key));
      group.forEach((a) => every ? state.selectedAssets.delete(a.key) : state.selectedAssets.add(a.key));
      renderAssetsGrid();
    });
    for (const a of group) {
      const card = document.createElement('div');
      card.className = `asset-card${state.selectedAssets.has(a.key) ? ' selected' : ''}`;
      card.innerHTML = `<button class="asset-check" title="Seleccionar">${state.selectedAssets.has(a.key) ? '✓' : ''}</button><button class="asset-series" title="Asociar a serie">${IC('layers')}</button><button class="asset-info" title="Información">${IC('info')}</button>${a.prompt ? `<button class="asset-copy" title="Copiar prompt">${IC('copy')}</button>` : ''}<button class="asset-delete" title="Borrar">${IC('trash')}</button>`;
      if (state.assetsZone === 'audio') {
        card.insertAdjacentHTML('beforeend', `<div class="audio-tile">${IC('play', 'ic ic-lg')}</div><div class="a-name">${esc(a.name)}</div>`);
        card.querySelector('.audio-tile').addEventListener('click', () => toggleAudioPlay(card, a.key));
      } else if (state.assetsZone === 'video') {
        card.insertAdjacentHTML('beforeend', `<video src="${fileUrl(a.key)}" preload="metadata" muted></video><div class="a-name">${esc(a.name)}</div>`);
        card.querySelector('video').addEventListener('click', () => openLightbox(a.key, items.map((item) => item.key)));
      } else {
        card.insertAdjacentHTML('beforeend', `<img src="${fileUrl(a.key)}" loading="lazy" alt=""><div class="a-name">${esc(a.name)}</div>`);
        card.querySelector('img').addEventListener('click', () => openLightbox(a.key, items.map((item) => item.key)));
      }
      card.querySelector('.asset-check').addEventListener('click', () => toggleAssetSelection(a.key));
      card.querySelector('.asset-series').addEventListener('click', () => openSeriesAssign(a.key));
      card.querySelector('.asset-info').addEventListener('click', () => openAssetInfo(a));
      card.querySelector('.asset-copy')?.addEventListener('click', () => copyPrompt(a.prompt));
      card.querySelector('.asset-delete').addEventListener('click', () => deleteAssets([a.key]));
      sessionGrid.appendChild(card);
    }
    grid.appendChild(section);
  }
}

function usePrompt(pr) {
  promptBox.value = pr.text;
  setMode(['audio', 'video'].includes(pr.mode) ? pr.mode : 'image');
  renderHighlight();
  goToCreate();
  promptBox.focus();
}

function promptCategories(mode = null) {
  const source = mode ? state.prompts.filter((p) => (p.mode || 'image') === mode) : state.prompts;
  const fromPrompts = source.map((p) => p.category || 'General');
  const extra = mode
    ? (state.promptCategoriesExtra[mode] || [])
    : Object.values(state.promptCategoriesExtra).flat();
  return [...new Set([...fromPrompts, ...extra])].sort((a, b) => a.localeCompare(b));
}

function renderPromptEditorCategories() {
  const cats = promptCategories($('#promptEditorMode').value);
  chipRow($('#promptEditorCategoryChips'), cats, $('#promptEditorCategory').value.trim(), (c) => {
    $('#promptEditorCategory').value = c;
    renderPromptEditorCategories();
  });
}

function openPromptEditor({ prompt = null, initialText = '', initialMode = state.mode, source = 'library' } = {}) {
  state.promptEditor = { id: prompt?.id || null, source };
  $('#promptEditorTitle').textContent = prompt ? 'Editar prompt' : 'Nuevo prompt';
  $('#promptEditorName').value = prompt?.title || (initialText ? initialText.slice(0, 60) : '');
  $('#promptEditorCategory').value = prompt?.category || 'General';
  $('#promptEditorMode').value = prompt?.mode || (['audio', 'video'].includes(initialMode) ? initialMode : 'image');
  $('#promptEditorText').value = prompt?.text || initialText || '';
  renderPromptEditorCategories();
  $('#promptEditorModal').hidden = false;
  setTimeout(() => $('#promptEditorName').focus(), 0);
}

$('#promptEditorMode').addEventListener('change', renderPromptEditorCategories);
$('#promptEditorCategory').addEventListener('input', renderPromptEditorCategories);

function closePromptEditor() {
  $('#promptEditorModal').hidden = true;
  state.promptEditor = null;
}

$('#promptEditorClose').addEventListener('click', closePromptEditor);
$('#promptEditorCancel').addEventListener('click', closePromptEditor);
$('#promptEditorModal').addEventListener('click', (e) => { if (e.target.id === 'promptEditorModal') closePromptEditor(); });
$('#promptEditorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editor = state.promptEditor || {};
  const body = {
    title: $('#promptEditorName').value.trim(),
    category: $('#promptEditorCategory').value.trim() || 'General',
    mode: ['audio', 'video'].includes($('#promptEditorMode').value) ? $('#promptEditorMode').value : 'image',
    text: $('#promptEditorText').value.trim()
  };
  if (!body.title || !body.text) return;
  try {
    if (editor.id) {
      const updated = await api(`/api/prompts/${editor.id}`, { method: 'PUT', body });
      state.prompts[state.prompts.findIndex((p) => p.id === editor.id)] = updated;
      toast('Prompt actualizado');
    } else {
      const item = await api('/api/prompts', { method: 'POST', body });
      state.prompts.unshift(item);
      if (editor.source === 'quick') $('#promptsPanel').hidden = false;
      toast('Prompt archivado');
    }
    closePromptEditor();
    renderPromptLibrary();
    renderPromptsPanel();
  } catch (err) {
    toast(err.message, 'err');
  }
});

function renderPromptLibrary() {
  const library = $('#promptLibrary');
  if (!library) return;
  const categories = promptCategories();
  const filter = $('#promptCategoryFilter');
  const selected = filter.value;
  filter.innerHTML = '<option value="">Todas las categorías</option>' + categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  filter.value = selected;
  const query = $('#promptSearch').value.trim().toLowerCase();
  const items = state.prompts.filter((p) => (!filter.value || (p.category || 'General') === filter.value)
    && (!query || `${p.title} ${p.text} ${p.category || ''}`.toLowerCase().includes(query)));
  library.innerHTML = items.length ? items.map((pr) => `
    <article class="prompt-library-card" data-prompt="${pr.id}">
      <div class="prompt-library-head"><div><span class="prompt-category">${esc(pr.category || 'General')}</span><h3>${esc(pr.title)}</h3></div><span>${pr.mode === 'audio' ? IC('mic') : pr.mode === 'video' ? IC('film') : IC('image')}</span></div>
      <div class="prompt-library-text">${esc(pr.text)}</div>
      <div class="prompt-library-actions"><button class="mini-btn" data-pact="use">Usar</button><button class="mini-btn" data-pact="edit">${IC('edit')} Editar</button><button class="mini-btn danger" data-pact="delete">${IC('trash')}</button></div>
    </article>`).join('') : '<div class="empty-note">No hay prompts que coincidan.</div>';
  library.querySelectorAll('[data-prompt]').forEach((card) => {
    const pr = state.prompts.find((p) => p.id === card.dataset.prompt);
    card.querySelector('[data-pact="use"]').addEventListener('click', () => usePrompt(pr));
    card.querySelector('[data-pact="edit"]').addEventListener('click', () => openPromptEditor({ prompt: pr }));
    card.querySelector('[data-pact="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Borrar “${pr.title}”?`)) return;
      await api(`/api/prompts/${pr.id}`, { method: 'DELETE' });
      state.prompts = state.prompts.filter((p) => p.id !== pr.id);
      renderPromptLibrary(); renderPromptsPanel();
    });
  });
}

$('#promptSearch').addEventListener('input', renderPromptLibrary);
$('#promptCategoryFilter').addEventListener('change', renderPromptLibrary);

$('#btnNewPromptCategory').addEventListener('click', () => {
  $('#newCategoryRow').hidden = false;
  $('#newCategoryName').value = '';
  $('#newCategoryName').focus();
});
$('#newCategoryCancel').addEventListener('click', () => { $('#newCategoryRow').hidden = true; });
$('#newCategoryName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#newCategorySave').click(); } });
$('#newCategorySave').addEventListener('click', async () => {
  const mode = $('#newCategoryMode').value;
  const name = $('#newCategoryName').value.trim();
  if (!name) return toast('Escribí un nombre para la categoría', 'err');
  try {
    const { promptCategories: updated } = await api('/api/prompt-categories', { method: 'POST', body: { mode, name } });
    state.promptCategoriesExtra = updated;
    $('#newCategoryRow').hidden = true;
    renderPromptLibrary();
    $('#promptCategoryFilter').value = name;
    renderPromptLibrary();
    toast(`Categoría "${name}" creada`);
  } catch (err) {
    toast(err.message, 'err');
  }
});
$('#btnNewPrompt').addEventListener('click', () => openPromptEditor({ initialMode: state.mode }));

function groupAssetSessions(items) {
  const groups = [];
  for (const item of items) {
    const lastGroup = groups[groups.length - 1];
    const previous = lastGroup?.[lastGroup.length - 1];
    if (!previous || previous.mtime - item.mtime > 60 * 60 * 1000) groups.push([item]);
    else lastGroup.push(item);
  }
  return groups;
}

function assetMatchesCharacter(a, characterId) {
  if (!characterId) return true;
  if (a.characterId === characterId) return true;
  return state.assetLinks.some((link) => link.key === a.key && link.characterId === characterId);
}

function assetMatchesSeries(a, seriesId) {
  if (!seriesId) return true;
  const s = state.series.find((x) => x.id === seriesId);
  return Boolean(s && (s.assetKeys || []).includes(a.key));
}

function visibleAssets() {
  return (state.assets[state.assetsZone] || []).filter((a) =>
    (!state.assetRange.from || a.mtime >= state.assetRange.from)
    && (!state.assetRange.to || a.mtime <= state.assetRange.to)
    && assetMatchesCharacter(a, state.assetFilterCharacterId)
    && assetMatchesSeries(a, state.assetFilterSeriesId));
}

function toggleAssetSelection(key) {
  state.selectedAssets.has(key) ? state.selectedAssets.delete(key) : state.selectedAssets.add(key);
  renderAssetsGrid();
}

function updateAssetSelection() {
  $('#selectedCount').textContent = state.selectedAssets.size;
  $('#btnDeleteSelected').disabled = !state.selectedAssets.size;
  $('#seriesSelectedCount').textContent = state.selectedAssets.size;
  $('#btnSeriesSelected').disabled = !state.selectedAssets.size;
}

async function deleteAssets(keys) {
  if (!keys.length) return;
  if (!confirm(`¿Borrar definitivamente ${keys.length} archivo${keys.length === 1 ? '' : 's'} del disco?\n\nEsta acción no se puede deshacer.`)) return;
  const result = await api('/api/assets/delete', { method: 'POST', body: { keys } });
  keys.forEach((key) => state.selectedAssets.delete(key));
  state.series.forEach((s) => { s.assetKeys = (s.assetKeys || []).filter((key) => !keys.includes(key)); });
  state.history = result.history;
  renderHistory();
  await refreshAssets();
  toast(`${result.deleted} asset${result.deleted === 1 ? '' : 's'} eliminado${result.deleted === 1 ? '' : 's'}`);
}

$('#btnDeleteSelected').addEventListener('click', () => deleteAssets([...state.selectedAssets]));
$('#btnSeriesSelected').addEventListener('click', () => openSeriesAssign([...state.selectedAssets]));
$('#btnSelectVisible').addEventListener('click', () => {
  const visible = visibleAssets();
  const every = visible.length && visible.every((a) => state.selectedAssets.has(a.key));
  visible.forEach((a) => every ? state.selectedAssets.delete(a.key) : state.selectedAssets.add(a.key));
  renderAssetsGrid();
});

function localDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function setAssetRange(from, to) {
  state.assetRange = { from: from?.getTime() || null, to: to?.getTime() || null };
  $('#assetFrom').value = from ? localDateTimeValue(from) : '';
  $('#assetTo').value = to ? localDateTimeValue(to) : '';
  renderAssetsGrid();
}

$$('[data-range]').forEach((button) => button.addEventListener('click', () => {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  if (button.dataset.range === 'all') return setAssetRange(null, null);
  if (button.dataset.range === 'today') return setAssetRange(start, end);
  if (button.dataset.range === 'morning') { end.setHours(11, 59, 59, 999); return setAssetRange(start, end); }
  start.setHours(12, 0, 0, 0); return setAssetRange(start, end);
}));

$('#btnApplyAssetRange').addEventListener('click', () => {
  const from = $('#assetFrom').value ? new Date($('#assetFrom').value) : null;
  const to = $('#assetTo').value ? new Date($('#assetTo').value) : null;
  if (from && to && from > to) return toast('El inicio del rango es posterior al final', 'err');
  setAssetRange(from, to);
});

let playingAudio = null;
function toggleAudioPlay(card, key) {
  if (playingAudio) { playingAudio.pause(); playingAudio = null; }
  const tile = card.querySelector('.audio-tile');
  const wasPlaying = tile.dataset.playing === '1';
  $$('.audio-tile').forEach((t) => { t.innerHTML = IC('play', 'ic ic-lg'); t.dataset.playing = ''; });
  if (wasPlaying) return;
  playingAudio = new Audio(fileUrl(key));
  playingAudio.play();
  tile.innerHTML = IC('pause', 'ic ic-lg');
  tile.dataset.playing = '1';
  playingAudio.onended = () => { tile.innerHTML = IC('play', 'ic ic-lg'); tile.dataset.playing = ''; };
}

// ---------------------------------------------------------------------------
// Photoshop: vigilancia de archivos abiertos afuera. Cuando el archivo cambia
// en disco (guardaste en Photoshop), se refrescan las <img> sin recargar.
const psWatch = new Map(); // key -> { mtime, since }
let psWatchTimer = null;

function watchPhotoshopFile(key, mtime) {
  psWatch.set(key, { mtime, since: Date.now() });
  if (!psWatchTimer) psWatchTimer = setInterval(pollPhotoshopFiles, 3000);
}

async function pollPhotoshopFiles() {
  for (const [key, w] of psWatch) {
    if (Date.now() - w.since > 4 * 60 * 60 * 1000) psWatch.delete(key); // 4 h y soltamos
  }
  if (!psWatch.size) {
    clearInterval(psWatchTimer);
    psWatchTimer = null;
    return;
  }
  let mtimes;
  try {
    mtimes = await api('/api/assets/mtimes', { method: 'POST', body: { keys: [...psWatch.keys()] } });
  } catch {
    return; // reintentamos en el próximo tick
  }
  for (const [key, w] of psWatch) {
    const current = mtimes[key];
    if (current === null) { psWatch.delete(key); continue; }
    if (current && current !== w.mtime) {
      w.mtime = current;
      refreshAssetImages(key);
      toast('Imagen actualizada desde Photoshop');
    }
  }
}

function refreshAssetImages(key) {
  const base = fileUrl(key);
  $$('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src === base || src.startsWith(`${base}?`)) img.src = `${base}?v=${Date.now()}`;
  });
}

// lightbox
// ---------------------------------------------------------------------------

function isVideoKey(key) {
  return String(key).startsWith('video/') || /\.(mp4|webm)$/i.test(String(key));
}

function closeLightbox() {
  document.querySelector('#lightbox').hidden = true;
  const v = $('#lbVideo');
  v.pause();
  v.removeAttribute('src');
}

function openLightbox(key, keys = null) {
  state.lightboxKeys = keys?.length ? [...new Set(keys)] : [key];
  state.lightboxIndex = Math.max(0, state.lightboxKeys.indexOf(key));
  $('#lightbox').hidden = false;
  $('#lbZoomWrap').classList.remove('zoomed');
  const isVideo = isVideoKey(key);
  $('#lbImg').hidden = isVideo;
  $('#lbVideo').hidden = !isVideo;
  if (isVideo) {
    $('#lbImg').removeAttribute('src');
    $('#lbVideo').src = fileUrl(key);
    $('#lbVideo').play().catch(() => {});
  } else {
    $('#lbVideo').pause();
    $('#lbVideo').removeAttribute('src');
    $('#lbImg').src = fileUrl(key);
  }
  const info = assetInfo(key);
  const multiple = state.lightboxKeys.length > 1;
  $('#lbPrev').hidden = !multiple; $('#lbNext').hidden = !multiple; $('#lbCounter').hidden = !multiple;
  $('#lbCounter').textContent = multiple ? `${state.lightboxIndex + 1} / ${state.lightboxKeys.length}` : '';
  $('#lbActions').innerHTML = `
    ${info ? `<button class="mini-btn" id="lbInfo">${IC('info')} Información</button>` : ''}
    ${info?.prompt ? `<button class="mini-btn" id="lbCopyPrompt">${IC('copy')} Copiar prompt</button>` : ''}
    ${!isVideo ? `<button class="mini-btn" id="lbRef">${IC('link')} Usar como referencia</button>` : ''}
    ${!isVideo && /^(generated|uploads)\//.test(key) ? `<button class="mini-btn" id="lbAssociate">${IC('user')} Asociar a personaje/elemento</button>` : ''}
    <button class="mini-btn" id="lbSeries">${IC('layers')} Asociar a serie</button>
    ${!isVideo && key.startsWith('generated/') ? `<button class="mini-btn" id="lbCharacter">${IC('user')} Convertir en personaje</button>` : ''}
    ${!isVideo ? `<button class="mini-btn" id="lbPhotoshop">${IC('pen')} Abrir en Photoshop</button>` : ''}
    <a class="mini-btn" href="${fileUrl(key)}" download>${IC('download')} Descargar</a>`;
  $('#lbPhotoshop')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/photoshop/open', { method: 'POST', body: { key } });
      watchPhotoshopFile(key, r.mtime);
      toast('Abriendo en Photoshop… al guardar allá, acá se actualiza sola');
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#lbRef')?.addEventListener('click', () => {
    addRef(key);
    closeLightbox();
    goToCreate();
    if (state.mode === 'audio') setMode('image');
    toast('Agregada como referencia');
  });
  $('#lbCopyPrompt')?.addEventListener('click', () => copyPrompt(info.prompt));
  $('#lbInfo')?.addEventListener('click', () => openAssetInfo({ key, ...info }));
  $('#lbCharacter')?.addEventListener('click', () => {
    closeLightbox();
    openCharModal(null, key);
  });
  $('#lbAssociate')?.addEventListener('click', () => associateAsset(key));
  $('#lbSeries')?.addEventListener('click', () => openSeriesAssign(key));
}

function navigateLightbox(delta) {
  if (state.lightboxKeys.length < 2) return;
  state.lightboxIndex = (state.lightboxIndex + delta + state.lightboxKeys.length) % state.lightboxKeys.length;
  openLightbox(state.lightboxKeys[state.lightboxIndex], state.lightboxKeys);
}
$('#lbPrev').addEventListener('click', () => navigateLightbox(-1));
$('#lbNext').addEventListener('click', () => navigateLightbox(1));

// --- lupita: click en la imagen → 100% centrado en el punto; arrastre para recorrerla ---
const lbZoomWrap = $('#lbZoomWrap');
let lbPan = null;
let lbPanMoved = false;

$('#lbImg').addEventListener('click', (e) => {
  if (lbPanMoved) { lbPanMoved = false; return; } // fue un arrastre, no un click
  const img = e.target;
  const zoomed = lbZoomWrap.classList.toggle('zoomed');
  if (!zoomed) return;
  const rx = e.offsetX / img.clientWidth;
  const ry = e.offsetY / img.clientHeight;
  requestAnimationFrame(() => {
    lbZoomWrap.scrollLeft = rx * img.naturalWidth - lbZoomWrap.clientWidth / 2;
    lbZoomWrap.scrollTop = ry * img.naturalHeight - lbZoomWrap.clientHeight / 2;
  });
});
lbZoomWrap.addEventListener('mousedown', (e) => {
  if (!lbZoomWrap.classList.contains('zoomed')) return;
  lbPan = { x: e.clientX, y: e.clientY, sl: lbZoomWrap.scrollLeft, st: lbZoomWrap.scrollTop };
  lbPanMoved = false;
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!lbPan) return;
  const dx = e.clientX - lbPan.x;
  const dy = e.clientY - lbPan.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) lbPanMoved = true;
  lbZoomWrap.scrollLeft = lbPan.sl - dx;
  lbZoomWrap.scrollTop = lbPan.st - dy;
});
window.addEventListener('mouseup', () => { lbPan = null; });

function openAssetInfo(asset) {
  closeLightbox();
  const character = state.characters.find((c) => c.id === asset.characterId);
  const variant = (character?.variants || []).find((v) => v.id === asset.characterVariantId);
  const rows = [
    ['Modelo', asset.modelName || asset.modelId || 'Sin información'],
    ['Tipo', asset.type || (asset.key?.startsWith('audio/') ? 'audio' : 'imagen')],
    ['Proporción', asset.aspectRatio || '—'], ['Resolución', asset.resolution || '—'],
    ['Lote', asset.batch || 1], ['Referencias', (asset.refs || []).length],
    ['Personaje', character ? `${character.name} · ${variant?.name || 'Original'}` : '—'],
    ['Fecha', asset.ts ? fmtDate(asset.ts) : '—'], ['Costo estimado', asset.cost ? `$${Number(asset.cost).toFixed(4)}` : '—']
  ];
  $('#assetInfoBody').innerHTML = `
    ${asset.key && !asset.key.startsWith('audio/') ? `<img class="asset-info-preview" src="${fileUrl(asset.key)}" alt="">` : ''}
    <div class="asset-info-grid">${rows.map(([label, value]) => `<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
    <div class="asset-info-prompt"><div><span>Prompt utilizado</span>${asset.prompt ? `<button class="mini-btn" id="assetInfoCopy">${IC('copy')} Copiar</button>` : ''}</div><pre>${esc(asset.prompt || 'No hay prompt guardado para este asset.')}</pre></div>`;
  $('#assetInfoCopy')?.addEventListener('click', () => copyPrompt(asset.prompt));
  $('#assetInfoModal').hidden = false;
}
$('#assetInfoClose').addEventListener('click', () => { $('#assetInfoModal').hidden = true; });
$('#assetInfoModal').addEventListener('click', (e) => { if (e.target.id === 'assetInfoModal') $('#assetInfoModal').hidden = true; });

function associationIsElement() {
  return $('#associateTargetType').value === 'element';
}

async function associateAsset(key) {
  if (!state.characters.length && !state.elements.length) return toast('Primero creá un personaje o una locación/objeto', 'err');
  state.pendingAssociationKey = key;
  closeLightbox();
  const existingChar = state.assetLinks.find((link) => link.key === key);
  const existingEl = state.elementLinks.find((link) => link.key === key);
  const preferElement = (existingEl && !existingChar) || !state.characters.length;
  $('#associateTargetType').value = preferElement && state.elements.length ? 'element' : 'character';
  const existing = $('#associateTargetType').value === 'element' ? existingEl : existingChar;
  renderAssociationOwners(existing ? (existing.characterId || existing.elementId) : '', existing?.variantId || '');
  $('#associateAsPhoto').checked = false;
  $('#associateAssetPreview').innerHTML = `<img src="${fileUrl(key)}" alt=""><div><strong>${existing ? 'Reasignar asset' : 'Nuevo vínculo'}</strong><div class="hint">El archivo no se moverá ni duplicará.</div></div>`;
  $('#associateAssetModal').hidden = false;
}

function renderAssociationOwners(ownerId = '', variantId = '') {
  sortEntities();
  const isElement = associationIsElement();
  $('#associateOwnerLabelText').textContent = isElement ? 'Locación u objeto' : 'Personaje';
  const list = isElement ? state.elements : state.characters;
  const select = $('#associateCharacter');
  select.innerHTML = list.map((c) => `<option value="${c.id}">${esc(c.name)}${isElement ? ` (${ELEMENT_KIND_LABEL[c.kind] || ''})` : ''}</option>`).join('');
  if (ownerId && list.some((c) => c.id === ownerId)) select.value = ownerId;
  renderAssociationVariants(variantId);
}

function renderAssociationVariants(selected = '') {
  const list = associationIsElement() ? state.elements : state.characters;
  const owner = list.find((c) => c.id === $('#associateCharacter').value);
  $('#associateVariant').innerHTML = '<option value="">Original</option>' + (owner?.variants || []).map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  $('#associateVariant').value = selected;
}

$('#associateTargetType').addEventListener('change', () => renderAssociationOwners());
$('#associateCharacter').addEventListener('change', () => renderAssociationVariants());
$('#associateAssetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = state.pendingAssociationKey;
  const isElement = associationIsElement();
  const ownerId = $('#associateCharacter').value;
  const variantId = $('#associateVariant').value || null;
  try {
    if (isElement) {
      const result = await api('/api/element-links', { method: 'POST', body: { key, elementId: ownerId, variantId } });
      state.elementLinks = result.links;
    } else {
      const result = await api('/api/asset-links', { method: 'POST', body: { key, characterId: ownerId, variantId } });
      state.assetLinks = result.links;
    }
    let asPhoto = false;
    if ($('#associateAsPhoto').checked) {
      const base = isElement ? `/api/elements/${ownerId}` : `/api/characters/${ownerId}`;
      const endpoint = variantId ? `${base}/variants/${variantId}/photos` : `${base}/photos`;
      const updated = await api(endpoint, { method: 'POST', body: { assetKey: key } });
      asPhoto = true;
      if (isElement) {
        state.elements[state.elements.findIndex((x) => x.id === ownerId)] = updated;
      } else {
        state.characters[state.characters.findIndex((x) => x.id === ownerId)] = updated;
        if (state.pinnedId === ownerId) { applyPinnedCharacterPhotos(); renderRefs(); renderCharacterVariantControl(); }
      }
    }
    $('#associateAssetModal').hidden = true;
    const list = isElement ? state.elements : state.characters;
    const owner = list.find((c) => c.id === ownerId);
    const variant = (owner?.variants || []).find((v) => v.id === variantId);
    toast(`Asset asociado a ${owner.name} · ${variant?.name || 'Original'}${asPhoto ? ' y agregado como foto' : ''}`);
    if (isElement) renderElements(); else { renderCharacters(); renderPinned(); }
  } catch (err) {
    toast(err.message, 'err');
  }
});
function closeAssociateAsset() { $('#associateAssetModal').hidden = true; state.pendingAssociationKey = null; }
$('#associateAssetClose').addEventListener('click', closeAssociateAsset);
$('#associateAssetCancel').addEventListener('click', closeAssociateAsset);
$('#associateAssetModal').addEventListener('click', (e) => { if (e.target.id === 'associateAssetModal') closeAssociateAsset(); });
$('#lbClose').addEventListener('click', () => { closeLightbox(); });
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (!$('#lightbox').hidden && e.key === 'ArrowLeft') { e.preventDefault(); navigateLightbox(-1); return; }
  if (!$('#lightbox').hidden && e.key === 'ArrowRight') { e.preventDefault(); navigateLightbox(1); return; }
  if (e.key === 'Escape') {
    closeLightbox(); $('#pickerModal').hidden = true; $('#charModal').hidden = true;
    $('#characterGalleryModal').hidden = true; $('#variantEditorModal').hidden = true; $('#associateAssetModal').hidden = true;
    $('#assetInfoModal').hidden = true;
    $('#seriesModal').hidden = true; $('#seriesAssignModal').hidden = true; state.editingSeriesId = null;
    $('#charAssetPickerModal').hidden = true; state.charAssetPicker = null;
    $('#shotPromptModal').hidden = true; state.shotPromptTarget = null;
    $('#elementModal').hidden = true; state.editingElementId = null;
    if (!$('#shotAssetsModal').hidden) closeShotAssets();
    $('#promptEditorModal').hidden = true; state.promptEditor = null;
  }
});

// ---------------------------------------------------------------------------
// series
// ---------------------------------------------------------------------------

function fmtSeriesStructure(s) {
  const total = (s.chapters || 0) * (s.chapterSeconds || 0);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  const totalTxt = mins ? `${mins} min${secs ? ` ${secs} s` : ''}` : `${secs} s`;
  return `${s.chapters} capítulo${s.chapters === 1 ? '' : 's'} × ${s.chapterSeconds} s · ${totalTxt} en total`;
}

function seriesAssetThumb(key) {
  if (key.startsWith('audio/')) return `<div class="series-audio">${IC('mic')}</div>`;
  if (key.startsWith('video/')) return `<video src="${fileUrl(key)}" preload="metadata" muted></video>`;
  return `<img src="${fileUrl(key)}" loading="lazy" alt="">`;
}

function renderSeries() {
  sortEntities();
  const grid = $('#seriesGrid');
  if (!state.series.length) {
    grid.innerHTML = '<div class="empty-note">Creá tu primera serie: título, descripción, formato y estructura. Después asociale personajes y assets.</div>';
    return;
  }
  grid.innerHTML = '';
  for (const s of state.series) {
    const characters = (s.characterIds || []).map((id) => state.characters.find((c) => c.id === id)).filter(Boolean);
    const assetCount = (s.assetKeys || []).length;
    const card = document.createElement('div');
    card.className = 'char-card';
    card.innerHTML = `
      <div class="series-head-row">
        <div class="char-name">${esc(s.title)}</div>
        <span class="series-format">${esc(s.format)}</span>
      </div>
      <div class="hint" style="margin-bottom:8px">${esc(fmtSeriesStructure(s))}</div>
      <div class="char-desc">${esc(s.description || '')}</div>
      <div class="series-chars">${characters.length
        ? characters.map((c) => c.photos[0]
          ? `<img src="${fileUrl(c.photos[0])}" title="${esc(c.name)}" alt="">`
          : `<span class="series-char-ph" title="${esc(c.name)}">${IC('user')}</span>`).join('')
        : '<span class="hint">Sin personajes asociados</span>'}</div>
      <div class="char-actions">
        <button class="mini-btn accent" data-act="view">${IC('eye')} Ver guion</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} Editar</button>
        <button class="mini-btn" data-act="scripts">${IC('clapper')} Guiones${state.scripts.filter((sc) => sc.seriesId === s.id).length ? ` (${state.scripts.filter((sc) => sc.seriesId === s.id).length})` : ''}</button>
        <button class="mini-btn" data-act="assets">${IC('image')} Assets${assetCount ? ` (${assetCount})` : ''}</button>
        <button class="mini-btn danger" data-act="del" title="Eliminar">${IC('trash')}</button>
      </div>`;
    card.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'view') {
          const list = state.scripts.filter((sc) => sc.seriesId === s.id);
          if (!list.length) return toast('Esta serie todavía no tiene guiones — creá o importá uno desde “Guiones”', 'err');
          if (list.length === 1) return openScriptView(list[0].id);
          openSeriesScripts(s.id); // varios guiones: se elige desde la lista
        }
        if (act === 'edit') openSeriesModal(s.id);
        if (act === 'scripts') openSeriesScripts(s.id);
        if (act === 'assets') openSeriesAssets(s.id);
        if (act === 'del') {
          if (!confirm(`¿Eliminar la serie “${s.title}”?\n\nSe eliminan también sus guiones. Los personajes y assets no se borran.`)) return;
          await api(`/api/series/${s.id}`, { method: 'DELETE' });
          state.series = state.series.filter((x) => x.id !== s.id);
          state.scripts = state.scripts.filter((sc) => sc.seriesId !== s.id);
          renderSeries();
          renderCharacters();
        }
      });
    });
    grid.appendChild(card);
  }
}

function openSeriesAssets(id) {
  const s = state.series.find((x) => x.id === id);
  if (!s) return;
  const keys = s.assetKeys || [];
  const viewable = keys.filter((key) => !key.startsWith('audio/'));
  $('#characterGalleryTitle').textContent = `${s.title} · Assets asociados`;
  $('#characterGalleryBody').innerHTML = `<section class="character-gallery-group">
    <div class="character-gallery-group-head"><h4>${esc(s.title)}</h4><span>${keys.length} asset${keys.length === 1 ? '' : 's'}</span></div>
    <div class="character-gallery-grid linked-assets">${keys.length ? keys.map((key) => `
      <div class="linked-asset">${key.startsWith('audio/')
        ? `<div class="series-audio big">${IC('mic', 'ic ic-lg')}</div>`
        : `<button data-gallery-photo="${esc(key)}">${seriesAssetThumb(key)}</button>`}
      <button class="linked-remove" data-unlink="${esc(key)}" title="Quitar de la serie">×</button></div>`).join('') : '<div class="hint">Sin assets asociados. Desde Assets, usá el botón de capas o “Asociar a serie” en el visor.</div>'}</div>
  </section>`;
  $('#characterGalleryBody').querySelectorAll('[data-gallery-photo]').forEach((button) =>
    button.addEventListener('click', () => openLightbox(button.dataset.galleryPhoto, viewable)));
  $('#characterGalleryBody').querySelectorAll('[data-unlink]').forEach((button) =>
    button.addEventListener('click', async () => {
      const updated = await api(`/api/series/${id}/assets?key=${encodeURIComponent(button.dataset.unlink)}`, { method: 'DELETE' });
      state.series[state.series.findIndex((x) => x.id === id)] = updated;
      openSeriesAssets(id);
      renderSeries();
    }));
  $('#characterGalleryModal').hidden = false;
}

function updateSeriesStructureHint() {
  $('#seriesStructureHint').textContent = fmtSeriesStructure({
    chapters: parseInt($('#seriesChapters').value, 10) || 0,
    chapterSeconds: parseInt($('#seriesChapterSeconds').value, 10) || 0
  });
}

function renderSeriesCharacterChips() {
  sortEntities();
  const wrap = $('#seriesCharacterChips');
  if (!state.characters.length) {
    wrap.innerHTML = '<span class="hint">Todavía no hay personajes creados.</span>';
    return;
  }
  wrap.innerHTML = '';
  for (const c of state.characters) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip series-chip' + (state.seriesDraftCharacterIds.has(c.id) ? ' active' : '');
    btn.innerHTML = `${c.photos[0] ? `<img src="${fileUrl(c.photos[0])}" alt="">` : IC('user')} ${esc(c.name)}`;
    btn.addEventListener('click', () => {
      state.seriesDraftCharacterIds.has(c.id) ? state.seriesDraftCharacterIds.delete(c.id) : state.seriesDraftCharacterIds.add(c.id);
      renderSeriesCharacterChips();
    });
    wrap.appendChild(btn);
  }
}

function renderSeriesModalAssets() {
  const s = state.editingSeriesId ? state.series.find((x) => x.id === state.editingSeriesId) : null;
  $('#seriesAssetsBlock').hidden = !s;
  if (!s) return;
  const keys = s.assetKeys || [];
  $('#seriesAssetsList').innerHTML = keys.length
    ? keys.map((key) => `<div class="series-asset">${seriesAssetThumb(key)}<button type="button" class="linked-remove" data-unlink="${esc(key)}" title="Quitar de la serie">×</button></div>`).join('')
    : '<span class="hint">Sin assets todavía.</span>';
  $('#seriesAssetsList').querySelectorAll('[data-unlink]').forEach((button) =>
    button.addEventListener('click', async () => {
      const updated = await api(`/api/series/${s.id}/assets?key=${encodeURIComponent(button.dataset.unlink)}`, { method: 'DELETE' });
      state.series[state.series.findIndex((x) => x.id === s.id)] = updated;
      renderSeriesModalAssets();
      renderSeries();
    }));
}

function openSeriesModal(id = null) {
  const s = id ? state.series.find((x) => x.id === id) : null;
  state.editingSeriesId = s ? s.id : null;
  state.seriesDraftCharacterIds = new Set(s?.characterIds || []);
  $('#seriesModalTitle').textContent = s ? 'Editar serie' : 'Nueva serie';
  $('#seriesTitle').value = s?.title || '';
  $('#seriesDescription').value = s?.description || '';
  $('#seriesFormat').value = s?.format || '9:16';
  $('#seriesChapters').value = s?.chapters || 5;
  $('#seriesChapterSeconds').value = s?.chapterSeconds || 90;
  renderSeriesCharacterChips();
  renderSeriesModalAssets();
  updateSeriesStructureHint();
  $('#seriesModal').hidden = false;
  setTimeout(() => $('#seriesTitle').focus(), 0);
}

function closeSeriesModal() {
  $('#seriesModal').hidden = true;
  state.editingSeriesId = null;
}

$('#btnNewSeries').addEventListener('click', () => openSeriesModal(null));
$('#seriesModalClose').addEventListener('click', closeSeriesModal);
$('#seriesModalCancel').addEventListener('click', closeSeriesModal);
$('#seriesModal').addEventListener('click', (e) => { if (e.target.id === 'seriesModal') closeSeriesModal(); });
$('#seriesChapters').addEventListener('input', updateSeriesStructureHint);
$('#seriesChapterSeconds').addEventListener('input', updateSeriesStructureHint);

$('#seriesForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: $('#seriesTitle').value.trim(),
    description: $('#seriesDescription').value.trim(),
    format: $('#seriesFormat').value,
    chapters: parseInt($('#seriesChapters').value, 10) || 1,
    chapterSeconds: parseInt($('#seriesChapterSeconds').value, 10) || 60,
    characterIds: [...state.seriesDraftCharacterIds]
  };
  if (!body.title) return;
  try {
    if (state.editingSeriesId) {
      const updated = await api(`/api/series/${state.editingSeriesId}`, { method: 'PUT', body });
      state.series[state.series.findIndex((x) => x.id === updated.id)] = updated;
      toast('Serie actualizada');
    } else {
      const created = await api('/api/series', { method: 'POST', body });
      state.series.unshift(created);
      toast(`Serie “${created.title}” creada`);
    }
    closeSeriesModal();
    renderSeries();
    renderCharacters();
    renderAssetFilterOptions();
  } catch (err) {
    toast(err.message, 'err');
  }
});

function openSeriesAssign(keyOrKeys) {
  const keys = [...new Set(Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys])];
  if (!keys.length) return;
  if (!state.series.length) return toast('Primero creá una serie en la sección Series', 'err');
  state.pendingSeriesAssetKey = keys;
  closeLightbox();
  const select = $('#seriesAssignSelect');
  select.innerHTML = state.series.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
  if (keys.length === 1) {
    const current = state.series.filter((s) => (s.assetKeys || []).includes(keys[0]));
    if (current.length) select.value = current[0].id;
    $('#seriesAssignPreview').innerHTML = `${seriesAssetThumb(keys[0])}<div><strong>${current.length ? `Ya está en ${current.map((s) => `“${esc(s.title)}”`).join(', ')}` : 'Nuevo vínculo'}</strong><div class="hint">Un asset puede estar en varias series a la vez.</div></div>`;
  } else {
    $('#seriesAssignPreview').innerHTML = `<div class="series-assign-batch">${keys.slice(0, 4).map(seriesAssetThumb).join('')}${keys.length > 4 ? `<div class="series-audio">+${keys.length - 4}</div>` : ''}</div><div><strong>${keys.length} assets seleccionados</strong><div class="hint">Se asocian todos a la serie elegida.</div></div>`;
  }
  $('#seriesAssignModal').hidden = false;
}

function closeSeriesAssign() {
  $('#seriesAssignModal').hidden = true;
  state.pendingSeriesAssetKey = null;
}

$('#seriesAssignClose').addEventListener('click', closeSeriesAssign);
$('#seriesAssignCancel').addEventListener('click', closeSeriesAssign);
$('#seriesAssignModal').addEventListener('click', (e) => { if (e.target.id === 'seriesAssignModal') closeSeriesAssign(); });
$('#seriesAssignForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const seriesId = $('#seriesAssignSelect').value;
  const keys = state.pendingSeriesAssetKey || [];
  try {
    const updated = await api(`/api/series/${seriesId}/assets`, { method: 'POST', body: { keys } });
    state.series[state.series.findIndex((x) => x.id === updated.id)] = updated;
    closeSeriesAssign();
    toast(keys.length === 1 ? `Asset asociado a “${updated.title}”` : `${keys.length} assets asociados a “${updated.title}”`);
    renderSeries();
    renderAssetsGrid();
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// guiones — mismo modelo y funciones que Hookcast (escenas → planos → ítems),
// más assets asociados a cada plano
// ---------------------------------------------------------------------------

const SCRIPT_FORMATS = ['Vertical 9:16', 'Horizontal 16:9', 'Square 1:1'];
const SCRIPT_TIMES = ['Dawn', 'Day', 'Afternoon', 'Night'];
const SCRIPT_LENSES = ['Wide angle', 'Normal', 'Telephoto'];
const SCRIPT_SIZES = ['Extreme wide', 'Wide', 'Full', 'Medium', 'Medium close-up', 'Close-up', 'Extreme close-up', 'Insert'];

// ids provisorios del editor; el server los regenera al guardar
const tmpId = () => Math.random().toString(36).slice(2, 14);
const newScriptShot = () => ({ id: tmpId(), size: 'Medium', lens: 'Normal', camera: '', items: [], assetKeys: [] });
const newScriptScene = () => ({ id: tmpId(), intExt: 'INT', location: '', timeOfDay: 'Day', shots: [newScriptShot()] });

function moveInArray(arr, i, d) {
  const j = i + d;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function scriptShotCount(sc) {
  return (sc.scenes || []).reduce((n, scene) => n + (scene.shots || []).length, 0);
}

// --- lista de guiones de una serie (modal) ---

function openSeriesScripts(seriesId) {
  const s = state.series.find((x) => x.id === seriesId);
  if (!s) return;
  const scripts = state.scripts.filter((sc) => sc.seriesId === seriesId);
  $('#characterGalleryTitle').textContent = `${s.title} · Guiones`;
  $('#characterGalleryBody').innerHTML = `
    <div class="script-list-toolbar">
      <button class="generate-btn small" id="scriptListNew">${IC('plus')} Nuevo guion</button>
      <button class="mini-btn" id="scriptListImport">${IC('upload')} Importar JSON de Hookcast</button>
    </div>
    ${scripts.length ? scripts.map((sc) => {
      const shots = scriptShotCount(sc);
      return `<div class="script-row" data-script="${sc.id}">
        <div>
          <strong>${esc(sc.title)}</strong>
          <div class="hint">${sc.scenes.length} escena${sc.scenes.length === 1 ? '' : 's'} · ${shots} plano${shots === 1 ? '' : 's'} · ${esc(sc.format)}${sc.source === 'hookcast' ? ' · importado de Hookcast' : ''} · ${fmtDate(sc.updatedAt || sc.ts)}</div>
        </div>
        <div class="script-row-actions">
          <button class="mini-btn accent" data-sact="view">${IC('eye')} Ver</button>
          <button class="mini-btn" data-sact="open">${IC('edit')} Editar guion</button>
          <button class="mini-btn" data-sact="assign">${IC('image')} Asignar assets</button>
          <button class="mini-btn danger" data-sact="del" title="Eliminar">${IC('trash')}</button>
        </div>
      </div>`;
    }).join('') : '<div class="hint" style="margin-top:12px">Sin guiones todavía: creá uno acá o importá el JSON exportado desde Hookcast (Export JSON, en el editor del guion).</div>'}`;
  $('#scriptListNew').addEventListener('click', async () => {
    try {
      const created = await api('/api/scripts', { method: 'POST', body: { seriesId } });
      state.scripts.unshift(created);
      $('#characterGalleryModal').hidden = true;
      renderSeries();
      openScriptEditor(created.id);
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#scriptListImport').addEventListener('click', () => {
    $('#scriptImportInput').onchange = async (e) => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const result = await api('/api/scripts/import', { method: 'POST', body: { seriesId, data } });
        state.scripts.unshift(result.script);
        const idx = state.series.findIndex((x) => x.id === seriesId);
        if (idx !== -1) state.series[idx] = result.serie;
        const matched = result.script.characters.filter((ch) => ch.characterId).length;
        toast(`“${result.script.title}” importado — ${result.script.scenes.length} escenas${matched ? `, ${matched} personaje${matched === 1 ? '' : 's'} reconocido${matched === 1 ? '' : 's'}` : ''}`);
        renderSeries(); renderCharacters();
        openSeriesScripts(seriesId);
      } catch (err) { toast(`No se pudo importar: ${err.message}`, 'err'); }
    };
    $('#scriptImportInput').click();
  });
  $('#characterGalleryBody').querySelectorAll('.script-row').forEach((row) => {
    const sc = state.scripts.find((x) => x.id === row.dataset.script);
    row.querySelector('[data-sact="view"]').addEventListener('click', () => {
      $('#characterGalleryModal').hidden = true;
      openScriptView(sc.id);
    });
    row.querySelector('[data-sact="open"]').addEventListener('click', () => {
      $('#characterGalleryModal').hidden = true;
      openScriptEditor(sc.id);
    });
    row.querySelector('[data-sact="assign"]').addEventListener('click', () => {
      $('#characterGalleryModal').hidden = true;
      openStoryboard(sc.id);
    });
    row.querySelector('[data-sact="del"]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el guion “${sc.title}”?`)) return;
      await api(`/api/scripts/${sc.id}`, { method: 'DELETE' });
      state.scripts = state.scripts.filter((x) => x.id !== sc.id);
      renderSeries();
      openSeriesScripts(seriesId);
    });
  });
  $('#characterGalleryModal').hidden = false;
}

// --- editor de guion (vista propia, se entra desde Series) ---

function markScriptDirty() { state.scriptDirty = true; $('#scriptDirtyBadge').hidden = false; }
function clearScriptDirty() { state.scriptDirty = false; $('#scriptDirtyBadge').hidden = true; }

function openScriptEditor(id) {
  const sc = state.scripts.find((x) => x.id === id);
  if (!sc) return;
  state.scriptEditor = structuredClone(sc);
  state.scriptBriefText = '';
  clearScriptDirty();
  $$('.nav-btn').forEach((b) => b.classList.remove('active'));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-script'));
  renderScriptEditor();
  window.scrollTo(0, 0);
}

function closeScriptEditor() {
  if (state.scriptDirty && !confirm('Hay cambios sin guardar en el guion. ¿Salir igual?')) return;
  state.scriptEditor = null;
  clearScriptDirty();
  $('.nav-btn[data-view="series"]').click();
}
$('#scriptBack').addEventListener('click', closeScriptEditor);

function renderScriptEditor() {
  const ed = state.scriptEditor;
  if (!ed) return;
  const serie = state.series.find((s) => s.id === ed.seriesId);
  $('#scriptViewTitle').textContent = ed.title || 'Guion';
  $('#scriptViewSeries').textContent = serie ? `Serie: ${serie.title} · ${serie.format}` : '';
  $('#scriptEditorRoot').innerHTML = `
    <datalist id="scriptCastList"></datalist>
    <section class="script-block">
      <h3>Datos y elenco</h3>
      <div class="script-meta-grid">
        <label>Título<input id="scMetaTitle" maxlength="140" value="${esc(ed.title)}"></label>
        <label>Formato<select id="scMetaFormat" class="select">${SCRIPT_FORMATS.map((f) => `<option${f === ed.format ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
      </div>
      <label class="script-label">Sinopsis<textarea id="scMetaSummary" rows="2" maxlength="3000" placeholder="Un párrafo sobre de qué va este guion.">${esc(ed.summary || '')}</textarea></label>
      <div class="script-cast" id="scriptCastRows"></div>
      <button class="mini-btn" id="scCastAdd">${IC('plus')} Agregar al elenco</button>
    </section>
    <section class="script-block">
      <h3>Guionista IA</h3>
      <p class="hint">Contá la historia y la IA escribe el guion técnico completo — escena por escena, con cámara, acciones y diálogos del elenco asignado. Usa tu API key de OpenAI (Configuración).</p>
      <label class="script-label">Brief de la historia<textarea id="scBrief" rows="4" maxlength="6000" placeholder="Premisa, tono, beats clave, giro, cómo termina… El guion se escribe en el idioma del brief.">${esc(state.scriptBriefText || '')}</textarea></label>
      <button class="generate-btn small" id="scGenerate">${ed.scenes.length ? 'Regenerar guion completo con IA' : 'Generar guion completo con IA'}</button>
    </section>
    <section class="script-block">
      <h3>Guion técnico</h3>
      <div id="scriptScenes"></div>
      <button class="mini-btn" id="scAddScene">${IC('plus')} Agregar escena</button>
    </section>`;
  $('#scMetaTitle').addEventListener('input', (e) => { ed.title = e.target.value; $('#scriptViewTitle').textContent = ed.title || 'Guion'; markScriptDirty(); });
  $('#scMetaFormat').addEventListener('change', (e) => { ed.format = e.target.value; markScriptDirty(); });
  $('#scMetaSummary').addEventListener('input', (e) => { ed.summary = e.target.value; markScriptDirty(); });
  $('#scBrief').addEventListener('input', (e) => { state.scriptBriefText = e.target.value; });
  $('#scCastAdd').addEventListener('click', () => {
    ed.characters.push({ id: tmpId(), characterId: '', name: '', role: '' });
    markScriptDirty();
    renderScriptCast();
  });
  $('#scAddScene').addEventListener('click', () => {
    ed.scenes.push(newScriptScene());
    markScriptDirty();
    renderScriptScenes();
  });
  $('#scGenerate').addEventListener('click', generateScriptWithAI);
  renderScriptCast();
  renderScriptScenes();
}

function renderScriptCastDatalist() {
  const list = $('#scriptCastList');
  if (list) list.innerHTML = state.scriptEditor.characters.filter((ch) => ch.name.trim()).map((ch) => `<option value="${esc(ch.name)}">`).join('');
}

function renderScriptCast() {
  const ed = state.scriptEditor;
  const wrap = $('#scriptCastRows');
  wrap.innerHTML = ed.characters.length ? ed.characters.map((ch, i) => `
    <div class="script-cast-row" data-i="${i}">
      <label>Personaje<select class="select" data-f="characterId">
        <option value="">Sin vincular</option>
        ${state.characters.map((c) => `<option value="${c.id}"${c.id === ch.characterId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select></label>
      <label>Nombre en el guion<input data-f="name" maxlength="80" value="${esc(ch.name)}" placeholder="VALENTINA"></label>
      <label>Rol<input data-f="role" maxlength="160" value="${esc(ch.role || '')}" placeholder="Protagonista"></label>
      <button class="icon-btn script-row-remove" title="Quitar del elenco">${IC('x')}</button>
    </div>`).join('') : '<p class="hint">Sin elenco todavía. Sumá personajes para que la IA y los diálogos los usen.</p>';
  wrap.querySelectorAll('.script-cast-row').forEach((row) => {
    const ch = ed.characters[Number(row.dataset.i)];
    row.querySelector('[data-f="characterId"]').addEventListener('change', (e) => {
      ch.characterId = e.target.value;
      const linked = state.characters.find((c) => c.id === ch.characterId);
      if (linked) { ch.name = linked.name; row.querySelector('[data-f="name"]').value = linked.name; renderScriptCastDatalist(); }
      markScriptDirty();
    });
    row.querySelector('[data-f="name"]').addEventListener('input', (e) => { ch.name = e.target.value; renderScriptCastDatalist(); markScriptDirty(); });
    row.querySelector('[data-f="role"]').addEventListener('input', (e) => { ch.role = e.target.value; markScriptDirty(); });
    row.querySelector('.script-row-remove').addEventListener('click', () => {
      ed.characters.splice(Number(row.dataset.i), 1);
      markScriptDirty();
      renderScriptCast();
    });
  });
  renderScriptCastDatalist();
}

function renderScriptScenes() {
  const ed = state.scriptEditor;
  const wrap = $('#scriptScenes');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!ed.scenes.length) {
    wrap.innerHTML = '<p class="hint">Sin escenas todavía. Agregá la primera o generá el guion completo con IA.</p>';
    return;
  }
  ed.scenes.forEach((scene, si) => wrap.appendChild(buildSceneCard(scene, si)));
}

function buildSceneCard(scene, si) {
  const ed = state.scriptEditor;
  const card = document.createElement('article');
  card.className = 'script-scene';
  card.innerHTML = `
    <header class="script-scene-head">
      <strong>Escena ${si + 1}</strong>
      <div class="script-mini-actions">
        <button class="mini-btn" data-a="up"${si === 0 ? ' disabled' : ''} title="Subir escena">↑</button>
        <button class="mini-btn" data-a="down"${si === ed.scenes.length - 1 ? ' disabled' : ''} title="Bajar escena">↓</button>
        <button class="mini-btn danger" data-a="del">${IC('trash')} Eliminar</button>
      </div>
    </header>
    <div class="script-slug-row">
      <label>Int / Ext<select class="select" data-f="intExt"><option${scene.intExt !== 'EXT' ? ' selected' : ''}>INT</option><option${scene.intExt === 'EXT' ? ' selected' : ''}>EXT</option></select></label>
      <label>Locación<input data-f="location" maxlength="120" value="${esc(scene.location || '')}" placeholder="SUITE DEL HOTEL"></label>
      <label>Momento<select class="select" data-f="timeOfDay">${SCRIPT_TIMES.map((t) => `<option${t === scene.timeOfDay ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <div class="script-shots"></div>
    <button class="mini-btn" data-a="addshot">${IC('plus')} Agregar plano</button>`;
  card.querySelector('[data-a="up"]').addEventListener('click', () => { moveInArray(ed.scenes, si, -1); markScriptDirty(); renderScriptScenes(); });
  card.querySelector('[data-a="down"]').addEventListener('click', () => { moveInArray(ed.scenes, si, 1); markScriptDirty(); renderScriptScenes(); });
  card.querySelector('[data-a="del"]').addEventListener('click', () => {
    if (!confirm(`¿Eliminar la escena ${si + 1}?`)) return;
    ed.scenes.splice(si, 1);
    markScriptDirty();
    renderScriptScenes();
  });
  card.querySelector('[data-a="addshot"]').addEventListener('click', () => {
    scene.shots.push(newScriptShot());
    markScriptDirty();
    renderScriptScenes();
  });
  card.querySelector('[data-f="intExt"]').addEventListener('change', (e) => { scene.intExt = e.target.value; markScriptDirty(); });
  card.querySelector('[data-f="location"]').addEventListener('input', (e) => { scene.location = e.target.value; markScriptDirty(); });
  card.querySelector('[data-f="timeOfDay"]').addEventListener('change', (e) => { scene.timeOfDay = e.target.value; markScriptDirty(); });
  const shotsWrap = card.querySelector('.script-shots');
  scene.shots.forEach((shot, hi) => shotsWrap.appendChild(buildShotCard(scene, shot, si, hi)));
  return card;
}

function buildShotCard(scene, shot, si, hi) {
  const div = document.createElement('div');
  div.className = 'script-shot';
  div.innerHTML = `
    <div class="script-shot-head">
      <strong>Plano ${si + 1}.${hi + 1}</strong>
      <div class="script-mini-actions">
        <button class="mini-btn" data-a="insert" title="Insertar un plano nuevo debajo de este">${IC('plus')} Insertar debajo</button>
        <button class="mini-btn" data-a="up"${hi === 0 ? ' disabled' : ''} title="Subir plano">↑</button>
        <button class="mini-btn" data-a="down"${hi === scene.shots.length - 1 ? ' disabled' : ''} title="Bajar plano">↓</button>
        <button class="mini-btn danger" data-a="del"${scene.shots.length === 1 ? ' disabled' : ''} title="Quitar plano">${IC('trash')}</button>
      </div>
    </div>
    <div class="script-camera-row">
      <label>Plano (tamaño)<select class="select" data-f="size">${SCRIPT_SIZES.map((x) => `<option${x === shot.size ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Lente<select class="select" data-f="lens">${SCRIPT_LENSES.map((x) => `<option${x === shot.lens ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Cámara — ángulo, movimiento, sensación<textarea data-f="camera" rows="2" maxlength="600" placeholder="Ángulo bajo, push-in lento, cámara en mano.">${esc(shot.camera || '')}</textarea></label>
    </div>
    <div class="script-items"></div>
    <div class="script-shot-foot">
      <button class="mini-btn" data-a="addaction">${IC('plus')} Acción</button>
      <button class="mini-btn" data-a="adddialogue">${IC('plus')} Diálogo</button>
    </div>`;
  div.querySelector('[data-a="insert"]').addEventListener('click', () => {
    scene.shots.splice(hi + 1, 0, newScriptShot());
    markScriptDirty();
    renderScriptScenes();
  });
  div.querySelector('[data-a="up"]').addEventListener('click', () => { moveInArray(scene.shots, hi, -1); markScriptDirty(); renderScriptScenes(); });
  div.querySelector('[data-a="down"]').addEventListener('click', () => { moveInArray(scene.shots, hi, 1); markScriptDirty(); renderScriptScenes(); });
  div.querySelector('[data-a="del"]').addEventListener('click', () => {
    scene.shots.splice(hi, 1);
    markScriptDirty();
    renderScriptScenes();
  });
  div.querySelector('[data-f="size"]').addEventListener('change', (e) => { shot.size = e.target.value; markScriptDirty(); });
  div.querySelector('[data-f="lens"]').addEventListener('change', (e) => { shot.lens = e.target.value; markScriptDirty(); });
  div.querySelector('[data-f="camera"]').addEventListener('input', (e) => { shot.camera = e.target.value; markScriptDirty(); });
  div.querySelector('[data-a="addaction"]').addEventListener('click', () => {
    shot.items.push({ id: tmpId(), kind: 'action', character: '', text: '' });
    markScriptDirty();
    renderScriptScenes();
  });
  div.querySelector('[data-a="adddialogue"]').addEventListener('click', () => {
    shot.items.push({ id: tmpId(), kind: 'dialogue', character: '', text: '' });
    markScriptDirty();
    renderScriptScenes();
  });
  const itemsWrap = div.querySelector('.script-items');
  shot.items.forEach((item, ii) => itemsWrap.appendChild(buildItemRow(shot, item, ii)));
  return div;
}

function buildItemRow(shot, item, ii) {
  const row = document.createElement('div');
  row.className = `script-item ${item.kind}`;
  if (item.kind === 'dialogue') {
    row.innerHTML = `
      <label>Personaje<input data-f="character" maxlength="80" list="scriptCastList" value="${esc(item.character || '')}" placeholder="VALENTINA"></label>
      <label>Línea<input data-f="text" maxlength="500" value="${esc(item.text || '')}" placeholder="Nunca tendrías que haber encontrado eso."></label>
      <button class="icon-btn script-row-remove" title="Quitar diálogo">${IC('x')}</button>`;
    row.querySelector('[data-f="character"]').addEventListener('input', (e) => { item.character = e.target.value; markScriptDirty(); });
  } else {
    row.innerHTML = `
      <label>Acción<textarea data-f="text" rows="2" maxlength="1500" placeholder="Qué vemos en este plano, en presente.">${esc(item.text || '')}</textarea></label>
      <button class="icon-btn script-row-remove" title="Quitar acción">${IC('x')}</button>`;
  }
  row.querySelector('[data-f="text"]').addEventListener('input', (e) => { item.text = e.target.value; markScriptDirty(); });
  row.querySelector('.script-row-remove').addEventListener('click', () => {
    shot.items.splice(ii, 1);
    markScriptDirty();
    renderScriptScenes();
  });
  return row;
}

async function saveScript() {
  const ed = state.scriptEditor;
  if (!ed) return false;
  try {
    const updated = await api(`/api/scripts/${ed.id}`, { method: 'PUT', body: {
      title: ed.title, summary: ed.summary, format: ed.format,
      characters: ed.characters, scenes: ed.scenes
    } });
    state.scripts[state.scripts.findIndex((x) => x.id === updated.id)] = updated;
    state.scriptEditor = structuredClone(updated);
    clearScriptDirty();
    renderScriptEditor();
    toast('Guion guardado');
    return true;
  } catch (err) {
    toast(err.message, 'err');
    return false;
  }
}
$('#btnSaveScript').addEventListener('click', saveScript);

async function generateScriptWithAI() {
  const ed = state.scriptEditor;
  if (!ed) return;
  const brief = $('#scBrief').value.trim();
  if (!brief) return toast('Escribí un brief de la historia para generar el guion', 'err');
  if (ed.scenes.length && !confirm('Generar con IA reemplaza todas las escenas actuales. ¿Continuar?')) return;
  const btn = $('#scGenerate');
  btn.disabled = true;
  btn.textContent = 'Escribiendo el guion… puede tardar un minuto';
  try {
    if (state.scriptDirty && !(await saveScript())) throw new Error('No se pudo guardar el guion antes de generar.');
    const updated = await api(`/api/scripts/${state.scriptEditor.id}/generate`, { method: 'POST', body: { brief } });
    state.scripts[state.scripts.findIndex((x) => x.id === updated.id)] = updated;
    state.scriptEditor = structuredClone(updated);
    clearScriptDirty();
    renderScriptEditor();
    toast(`Guion generado: ${updated.scenes.length} escenas, ${scriptShotCount(updated)} planos`);
  } catch (err) {
    toast(err.message, 'err');
    renderScriptEditor();
  }
}

// --- asignación de assets: otra área del pipeline, con el guion solo lectura ---

function openStoryboard(id) {
  const sc = state.scripts.find((x) => x.id === id);
  if (!sc) return;
  state.storyboardScript = structuredClone(sc);
  $$('.nav-btn').forEach((b) => b.classList.remove('active'));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-storyboard'));
  renderStoryboard();
  window.scrollTo(0, 0);
}
$('#storyboardBack').addEventListener('click', () => {
  state.storyboardScript = null;
  $('.nav-btn[data-view="series"]').click();
});

function sbItemLine(item) {
  return item.kind === 'dialogue'
    ? `<div class="sb-dialogue"><strong>${esc(item.character || '¿?')}</strong>${esc(item.text)}</div>`
    : `<div class="sb-action">${esc(item.text)}</div>`;
}

// bloque colapsable del prompt asignado a un plano — se usa en el storyboard
// y en "Ver guion"; arranca cerrado para no alargar la lectura del guion
function sbPromptView(shot) {
  if (!shot.prompt) return '';
  return `<details class="sb-prompt-view">
    <summary>Prompt utilizado${shot.promptTitle ? `: <strong>${esc(shot.promptTitle)}</strong>` : ''}</summary>
    <pre>${esc(shot.prompt)}</pre>
  </details>`;
}

function renderStoryboard() {
  const sb = state.storyboardScript;
  if (!sb) return;
  const serie = state.series.find((s) => s.id === sb.seriesId);
  $('#storyboardTitle').textContent = `Asignar assets · ${sb.title}`;
  $('#storyboardSeries').textContent = serie ? `Serie: ${serie.title} · ${sb.format} · el guion no se edita acá` : '';
  const root = $('#storyboardRoot');
  if (!sb.scenes.length) {
    root.innerHTML = '<p class="hint">Este guion todavía no tiene escenas. Se editan en “Editar guion”.</p>';
    return;
  }
  root.innerHTML = sb.scenes.map((scene, si) => `
    <article class="sb-scene">
      <div class="sb-scene-head">
        <h4>Escena ${si + 1}</h4>
        <span class="sb-slug">${esc(`${scene.intExt}. ${(scene.location || '').toUpperCase()} — ${scene.timeOfDay}`)}</span>
      </div>
      ${scene.shots.map((shot, hi) => `
        <div class="sb-shot">
          <div class="sb-shot-head">
            <div><strong>Plano ${si + 1}.${hi + 1}</strong> <span class="sb-shot-specs">· ${esc(shot.size)} · ${esc(shot.lens)}</span></div>
            <button class="mini-btn" data-sb="${si}:${hi}">${IC('image')} Asignar assets${(shot.assetKeys || []).length ? ` (${shot.assetKeys.length})` : ''}</button>
          </div>
          ${shot.camera ? `<div class="sb-camera">${esc(shot.camera)}</div>` : ''}
          ${shot.items.length ? `<div class="sb-items">${shot.items.map(sbItemLine).join('')}</div>` : ''}
          <div class="sb-assets" data-sbstrip="${si}:${hi}">${(shot.assetKeys || []).map((k) => `<button class="script-asset-thumb" data-k="${esc(k)}" title="${esc(k)}">${seriesAssetThumb(k)}</button>`).join('')}</div>
          <div class="sb-prompt">
            <div class="sb-prompt-head"><span>Prompt del plano</span><div class="sb-prompt-actions">
              ${shot.prompt ? `<button class="mini-btn" data-sbcopy="${si}:${hi}">${IC('copy')} Copiar</button><button class="mini-btn danger" data-sbclearprompt="${si}:${hi}">Quitar</button>` : ''}
              <button class="mini-btn" data-sbpickprompt="${si}:${hi}">${IC('book')} Elegir de Prompts</button>
            </div></div>
            ${shot.prompt ? sbPromptView(shot) : '<span class="hint">Sin prompt asignado — elegilo de tu biblioteca de Prompts.</span>'}
          </div>
        </div>`).join('')}
    </article>`).join('');
  root.querySelectorAll('[data-sb]').forEach((b) => b.addEventListener('click', () => {
    const [si, hi] = b.dataset.sb.split(':').map(Number);
    openShotAssets(si, hi);
  }));
  root.querySelectorAll('.script-asset-thumb').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.k;
    const [si, hi] = b.closest('[data-sbstrip]').dataset.sbstrip.split(':').map(Number);
    const keys = (sb.scenes[si].shots[hi].assetKeys || []).filter((x) => !x.startsWith('audio/'));
    if (!key.startsWith('audio/')) openLightbox(key, keys);
  }));
  root.querySelectorAll('[data-sbpickprompt]').forEach((b) => b.addEventListener('click', () => {
    const [si, hi] = b.dataset.sbpickprompt.split(':').map(Number);
    openShotPromptPicker(si, hi);
  }));
  root.querySelectorAll('[data-sbclearprompt]').forEach((b) => b.addEventListener('click', async () => {
    const [si, hi] = b.dataset.sbclearprompt.split(':').map(Number);
    const shot = sb.scenes[si].shots[hi];
    shot.prompt = ''; shot.promptId = ''; shot.promptTitle = '';
    await saveStoryboard('Prompt quitado del plano');
    renderStoryboard();
  }));
  root.querySelectorAll('[data-sbcopy]').forEach((b) => b.addEventListener('click', () => {
    const [si, hi] = b.dataset.sbcopy.split(':').map(Number);
    copyPrompt(sb.scenes[si].shots[hi].prompt || '');
  }));
}

// --- Ver guion: lectura completa (guion + prompts + assets por plano) ---

function openScriptView(id) {
  const sc = state.scripts.find((x) => x.id === id);
  if (!sc) return;
  state.scriptViewId = id;
  $$('.nav-btn').forEach((b) => b.classList.remove('active'));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-scriptview'));
  renderScriptView();
  window.scrollTo(0, 0);
}
$('#scriptViewBack').addEventListener('click', () => {
  state.scriptViewId = null;
  $('.nav-btn[data-view="series"]').click();
});

function renderScriptView() {
  const sc = state.scripts.find((x) => x.id === state.scriptViewId);
  if (!sc) return;
  const serie = state.series.find((s) => s.id === sc.seriesId);
  const shots = scriptShotCount(sc);
  $('#scriptViewTitle').textContent = sc.title;
  $('#scriptViewMeta').textContent = `${serie ? `Serie: ${serie.title} · ` : ''}${sc.format} · ${sc.scenes.length} escena${sc.scenes.length === 1 ? '' : 's'} · ${shots} plano${shots === 1 ? '' : 's'}`;
  const root = $('#scriptViewRoot');
  const cast = sc.characters || [];
  root.innerHTML = `
    ${sc.summary ? `<p class="vg-summary">${esc(sc.summary)}</p>` : ''}
    ${cast.length ? `<div class="vg-cast">${cast.map((ch) => {
      const linked = state.characters.find((x) => x.id === ch.characterId);
      return `<span class="chip vg-cast-chip">${linked?.photos[0] ? `<img src="${fileUrl(linked.photos[0])}" alt="">` : ''}${esc(ch.name)}${ch.role ? ` <em>— ${esc(ch.role)}</em>` : ''}</span>`;
    }).join('')}</div>` : ''}
    ${sc.scenes.length ? sc.scenes.map((scene, si) => `
      <article class="sb-scene">
        <div class="sb-scene-head">
          <h4>Escena ${si + 1}</h4>
          <span class="sb-slug">${esc(`${scene.intExt}. ${(scene.location || '').toUpperCase()} — ${scene.timeOfDay}`)}</span>
        </div>
        ${scene.shots.map((shot, hi) => `
          <div class="sb-shot">
            <div class="sb-shot-head"><div><strong>Plano ${si + 1}.${hi + 1}</strong> <span class="sb-shot-specs">· ${esc(shot.size)} · ${esc(shot.lens)}</span></div></div>
            ${shot.camera ? `<div class="sb-camera">${esc(shot.camera)}</div>` : ''}
            ${shot.items.length ? `<div class="sb-items">${shot.items.map(sbItemLine).join('')}</div>` : ''}
            ${sbPromptView(shot)}
            ${(shot.assetKeys || []).length ? `<div class="sb-assets" data-vgstrip="${si}:${hi}">${shot.assetKeys.map((k) =>
              `<button class="script-asset-thumb" data-k="${esc(k)}" title="${esc(k)}">${seriesAssetThumb(k)}</button>`).join('')}</div>` : ''}
          </div>`).join('')}
      </article>`).join('') : '<p class="hint">Este guion todavía no tiene escenas.</p>'}`;
  root.querySelectorAll('.script-asset-thumb').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.k;
    const [si, hi] = b.closest('[data-vgstrip]').dataset.vgstrip.split(':').map(Number);
    const keys = (sc.scenes[si].shots[hi].assetKeys || []).filter((x) => !x.startsWith('audio/'));
    if (!key.startsWith('audio/')) openLightbox(key, keys);
  }));
}

// --- picker de prompts de la biblioteca para un plano ---

function openShotPromptPicker(si, hi) {
  if (!state.prompts.length) return toast('Todavía no hay prompts guardados — archivalos desde la caja de Crear', 'err');
  state.shotPromptTarget = { si, hi };
  $('#shotPromptTitle').textContent = `Prompt para el plano ${si + 1}.${hi + 1}`;
  $('#shotPromptSearch').value = '';
  const cats = promptCategories();
  $('#shotPromptCategory').innerHTML = '<option value="">Todas las categorías</option>'
    + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  renderShotPromptList();
  $('#shotPromptModal').hidden = false;
  setTimeout(() => $('#shotPromptSearch').focus(), 0);
}

function renderShotPromptList() {
  const query = $('#shotPromptSearch').value.trim().toLowerCase();
  const cat = $('#shotPromptCategory').value;
  const items = state.prompts.filter((p) => (!cat || (p.category || 'General') === cat)
    && (!query || `${p.title} ${p.text} ${p.category || ''}`.toLowerCase().includes(query)));
  $('#shotPromptList').innerHTML = items.length ? items.map((p) => `
    <button class="shot-prompt-row" data-p="${p.id}">
      <div><strong>${esc(p.title)}</strong><span>${esc(p.category || 'General')}</span>${p.mode === 'video' ? IC('film') : p.mode === 'audio' ? IC('mic') : IC('image')}</div>
      <div class="shot-prompt-text">${esc(p.text)}</div>
    </button>`).join('') : '<div class="hint">No hay prompts que coincidan.</div>';
  $('#shotPromptList').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', async () => {
    const pr = state.prompts.find((x) => x.id === b.dataset.p);
    const target = state.shotPromptTarget;
    const shot = state.storyboardScript?.scenes[target?.si]?.shots[target?.hi];
    if (!pr || !shot) return;
    shot.prompt = pr.text;
    shot.promptId = pr.id;
    shot.promptTitle = pr.title;
    closeShotPromptPicker();
    await saveStoryboard(`Prompt “${pr.title}” asignado al plano`);
    renderStoryboard();
  }));
}

$('#shotPromptSearch').addEventListener('input', renderShotPromptList);
$('#shotPromptCategory').addEventListener('change', renderShotPromptList);
function closeShotPromptPicker() {
  $('#shotPromptModal').hidden = true;
  state.shotPromptTarget = null;
}
$('#shotPromptClose').addEventListener('click', closeShotPromptPicker);
$('#shotPromptModal').addEventListener('click', (e) => { if (e.target.id === 'shotPromptModal') closeShotPromptPicker(); });

async function saveStoryboard(message) {
  const sb = state.storyboardScript;
  if (!sb) return;
  try {
    const updated = await api(`/api/scripts/${sb.id}`, { method: 'PUT', body: { scenes: sb.scenes } });
    state.scripts[state.scripts.findIndex((x) => x.id === updated.id)] = updated;
    state.storyboardScript = structuredClone(updated);
    if (message) toast(message);
  } catch (err) {
    toast(err.message, 'err');
  }
}

// el plano se identifica por índice (los ids se regeneran al guardar)
function currentShotAssetsShot() {
  const sb = state.storyboardScript;
  const target = state.shotAssetsTarget;
  if (!sb || !target) return null;
  return sb.scenes[target.si]?.shots[target.hi] || null;
}

async function openShotAssets(si, hi) {
  const sb = state.storyboardScript;
  const shot = sb?.scenes[si]?.shots[hi];
  if (!shot) return;
  state.shotAssetsTarget = { si, hi };
  state.shotAssetsZone = 'series';
  const zonesEmpty = !state.assets.generated.length && !state.assets.uploads.length
    && !state.assets.video.length && !state.assets.audio.length;
  if (zonesEmpty) {
    try { state.assets = await api('/api/assets'); } catch { /* sin assets no bloqueamos el modal */ }
  }
  $('#shotAssetsTitle').textContent = `Assets del plano ${si + 1}.${hi + 1}`;
  renderShotAssetsGrid();
  $('#shotAssetsModal').hidden = false;
}

function renderShotAssetsGrid() {
  const shot = currentShotAssetsShot();
  if (!shot) return;
  $$('#shotAssetsTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.szone === state.shotAssetsZone));
  const serie = state.series.find((s) => s.id === state.storyboardScript.seriesId);
  const keys = state.shotAssetsZone === 'series'
    ? (serie?.assetKeys || [])
    : (state.assets[state.shotAssetsZone] || []).map((a) => a.key);
  const selected = shot.assetKeys || [];
  $('#shotAssetsGrid').innerHTML = keys.length ? keys.map((k) => `
    <button class="shot-asset-cell${selected.includes(k) ? ' selected' : ''}" data-k="${esc(k)}" title="${esc(k)}">
      ${seriesAssetThumb(k)}${selected.includes(k) ? `<span class="shot-asset-check">${IC('check')}</span>` : ''}
    </button>`).join('')
    : `<div class="hint">${state.shotAssetsZone === 'series'
      ? 'La serie todavía no tiene assets asociados — asociale assets desde la sección Assets.'
      : 'No hay assets en esta zona.'}</div>`;
  $('#shotAssetsGrid').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    shot.assetKeys = shot.assetKeys || [];
    shot.assetKeys = shot.assetKeys.includes(k) ? shot.assetKeys.filter((x) => x !== k) : [...shot.assetKeys, k];
    renderShotAssetsGrid();
  }));
}

$$('#shotAssetsTabs .tab').forEach((t) => t.addEventListener('click', () => {
  state.shotAssetsZone = t.dataset.szone;
  renderShotAssetsGrid();
}));

// al cerrar el modal se guarda solo la asignación (el guion no se toca acá)
async function closeShotAssets() {
  $('#shotAssetsModal').hidden = true;
  state.shotAssetsTarget = null;
  if (!state.storyboardScript) return;
  await saveStoryboard('Asignación guardada');
  renderStoryboard();
}
$('#shotAssetsClose').addEventListener('click', closeShotAssets);
$('#shotAssetsDone').addEventListener('click', closeShotAssets);
$('#shotAssetsModal').addEventListener('click', (e) => { if (e.target.id === 'shotAssetsModal') closeShotAssets(); });

// ---------------------------------------------------------------------------
// personajes
// ---------------------------------------------------------------------------

function renderCharacters() {
  sortEntities();
  const grid = $('#charsGrid');
  if (!state.characters.length) {
    grid.innerHTML = '<div class="empty-note">Creá tu primer personaje: nombre, descripción, fotos y una voz de ElevenLabs.</div>';
    return;
  }
  grid.innerHTML = '';
  for (const c of state.characters) {
    const card = document.createElement('div');
    card.className = 'char-card' + (c.id === state.pinnedId ? ' pinned' : '');
    const avatar = avatarHtml(c, 'user');
    const minis = c.photos.slice(1, 5).map((p) => `<img src="${fileUrl(p)}" alt="">`).join('')
      + (c.photos.length > 5 ? `<div class="more">+${c.photos.length - 5}</div>` : '');
    const linkedCount = state.assetLinks.filter((link) => link.characterId === c.id).length;
    const inSeries = state.series.filter((s) => (s.characterIds || []).includes(c.id));
    card.innerHTML = `
      <div class="char-top">${avatar}<div>
        <div class="char-name">${esc(c.name)}</div>
        <div class="char-voice">${c.voiceName ? IC('mic') + ' ' + esc(c.voiceName) : '<span style="color:#6f5f8d">sin voz</span>'}</div>
      </div></div>
      <div class="char-desc">${esc(c.description || '')}</div>
      ${(c.variants || []).length ? `<div class="hint" style="margin-bottom:8px">${(c.variants || []).length} variante${c.variants.length === 1 ? '' : 's'} de outfit</div>` : ''}
      ${inSeries.length ? `<div class="char-series">${IC('layers')} ${inSeries.map((s) => esc(s.title)).join(' · ')}</div>` : ''}
      <div class="char-photos-mini">${minis}</div>
      <div class="char-actions">
        <button class="mini-btn" data-act="pin">${IC('pin')} ${c.id === state.pinnedId ? 'Anclado' : 'Anclar'}</button>
        <button class="mini-btn" data-act="use">${IC('link')} Usar fotos</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} Editar</button>
        <button class="mini-btn" data-act="variants">Variantes</button>
        <button class="mini-btn" data-act="gallery">${IC('eye')} Ver fotos</button>
        <button class="mini-btn" data-act="assets">${IC('image')} Assets${linkedCount ? ` (${linkedCount})` : ''}</button>
        <a class="mini-btn" href="/api/characters/${c.id}/export" download>${IC('download')} Exportar ZIP</a>
        <button class="mini-btn danger" data-act="del" title="Eliminar">${IC('trash')}</button>
      </div>`;
    card.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'pin') setPinned(c.id === state.pinnedId ? '' : c.id);
        if (act === 'use') {
          setMode('image');
          for (const p of c.photos) addRef(p, false);
          goToCreate();
          toast(`Fotos de ${c.name} agregadas como referencia`);
        }
        if (act === 'edit') openCharModal(c.id);
        if (act === 'variants') openCharModal(c.id);
        if (act === 'gallery') openCharacterGallery(c.id);
        if (act === 'assets') openCharacterAssets(c.id);
        if (act === 'del') {
          if (!confirm(`¿Eliminar a ${c.name} y sus fotos?`)) return;
          await api(`/api/characters/${c.id}`, { method: 'DELETE' });
          state.characters = state.characters.filter((x) => x.id !== c.id);
          state.series.forEach((s) => { s.characterIds = (s.characterIds || []).filter((cid) => cid !== c.id); });
          if (state.pinnedId === c.id) setPinned('');
          renderCharacters();
        }
      });
    });
    grid.appendChild(card);
  }
}

function openCharacterGallery(id) {
  const c = state.characters.find((x) => x.id === id);
  if (!c) return;
  $('#characterGalleryTitle').textContent = c.name;
  const groups = [{ name: 'Original', description: c.description || '', photos: c.photos || [] }, ...(c.variants || [])];
  $('#characterGalleryBody').innerHTML = groups.map((group) => `
    <section class="character-gallery-group">
      <div class="character-gallery-group-head"><h4>${esc(group.name)}</h4><span>${group.photos.length} foto${group.photos.length === 1 ? '' : 's'}</span></div>
      ${group.description ? `<p>${esc(group.description)}</p>` : ''}
      <div class="character-gallery-grid">${group.photos.length
        ? group.photos.map((photo) => `<button data-gallery-photo="${esc(photo)}"><img src="${fileUrl(photo)}" loading="lazy" alt=""></button>`).join('')
        : '<div class="hint">Esta variante todavía no tiene fotos.</div>'}</div>
    </section>`).join('');
  $('#characterGalleryBody').querySelectorAll('[data-gallery-photo]').forEach((button) => {
    button.addEventListener('click', () => openLightbox(button.dataset.galleryPhoto, groups.flatMap((group) => group.photos || [])));
  });
  $('#characterGalleryModal').hidden = false;
}

function openCharacterAssets(id) {
  const c = state.characters.find((x) => x.id === id);
  if (!c) return;
  $('#characterGalleryTitle').textContent = `${c.name} · Assets asociados`;
  const groups = [
    { id: null, name: 'Original' },
    ...(c.variants || []).map((v) => ({ id: v.id, name: v.name }))
  ];
  const links = state.assetLinks.filter((link) => link.characterId === id);
  $('#characterGalleryBody').innerHTML = groups.map((group) => {
    const items = links.filter((link) => (link.variantId || null) === group.id);
    return `<section class="character-gallery-group">
      <div class="character-gallery-group-head"><h4>${esc(group.name)}</h4><span>${items.length} asset${items.length === 1 ? '' : 's'}</span></div>
      <div class="character-gallery-grid linked-assets">${items.length ? items.map((link) => `
        <div class="linked-asset"><button data-gallery-photo="${esc(link.key)}"><img src="${fileUrl(link.key)}" loading="lazy" alt=""></button><button class="linked-remove" data-unlink="${esc(link.key)}" title="Quitar asociación">×</button></div>`).join('') : '<div class="hint">Sin assets asociados.</div>'}</div>
    </section>`;
  }).join('');
  $('#characterGalleryBody').querySelectorAll('[data-gallery-photo]').forEach((button) => button.addEventListener('click', () => openLightbox(button.dataset.galleryPhoto, links.map((link) => link.key))));
  $('#characterGalleryBody').querySelectorAll('[data-unlink]').forEach((button) => button.addEventListener('click', async () => {
    const result = await api(`/api/asset-links?key=${encodeURIComponent(button.dataset.unlink)}`, { method: 'DELETE' });
    state.assetLinks = result.links;
    openCharacterAssets(id);
    renderCharacters();
  }));
  $('#characterGalleryModal').hidden = false;
}

$('#characterGalleryClose').addEventListener('click', () => { $('#characterGalleryModal').hidden = true; });
$('#characterGalleryModal').addEventListener('click', (e) => {
  if (e.target.id === 'characterGalleryModal') $('#characterGalleryModal').hidden = true;
});

$('#btnNewChar').addEventListener('click', () => openCharModal(null));
$('#btnImportCharacter').addEventListener('click', () => $('#characterImportInput').click());
$('#characterImportInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const created = await api('/api/characters/import', { method: 'POST', body: { zipBase64: dataUrl.split(',')[1] } });
    state.characters.unshift(created); renderCharacters();
    toast(`${created.name} importado con ${created.photos.length} fotos y ${created.variants.length} variantes`);
  } catch (err) { toast(`No se pudo importar: ${err.message}`, 'err'); }
});
$('#charModalClose').addEventListener('click', () => {
  $('#charModal').hidden = true;
  state.editingCharId = null;
  state.pendingCharacterAsset = null;
});

function openCharModal(id, assetKey = null) {
  state.editingCharId = id || '';
  state.pendingCharacterAsset = id ? null : assetKey;
  $('#charModal').hidden = false;
  $('#charModalTitle').textContent = id ? 'Editar personaje' : 'Nuevo personaje';
  if (state.voices === null) loadVoices(false);
  renderCharModal();
}

function renderCharModal() {
  const id = state.editingCharId;
  const c = state.characters.find((x) => x.id === id) || { name: '', description: '', voiceId: '', photos: [] };
  const voices = state.voices || [];
  const body = $('#charModalBody');
  body.innerHTML = `
    ${state.pendingCharacterAsset ? `<div class="character-source"><img src="${fileUrl(state.pendingCharacterAsset)}" alt=""><div><strong>Foto inicial</strong><span>Se copiará al archivo del personaje cuando lo crees.</span></div></div>` : ''}
    <div><label>Nombre</label><input type="text" id="chName" value="${esc(c.name)}" placeholder="ej: Luna"></div>
    <div><label>Descripción</label><textarea id="chDesc" placeholder="quién es, cómo se ve, su vibra…">${esc(c.description || '')}</textarea></div>
    <div><label>Voz de ElevenLabs</label>
      <select id="chVoice">
        <option value="">— sin voz —</option>
        ${voices.map((v) => `<option value="${v.id}" ${v.id === c.voiceId ? 'selected' : ''}>${esc(v.name)}${v.category ? ' · ' + esc(v.category) : ''}</option>`).join('')}
      </select>
      ${voices.length ? '' : '<div class="hint" style="margin-top:4px">Cargá la key de ElevenLabs en Configuración y recargá.</div>'}
    </div>
    <div><label>Asset ID de Seedance (rostro real verificado)</label>
      <input type="text" id="chArkAsset" value="${esc(c.arkAssetId || '')}" placeholder="ej: asset-20260222234430-mxpgh">
      <div class="hint" style="margin-top:4px">Para personas reales: verificá la identidad en la consola de ModelArk (Playground → My assets → Real-human) y pegá acá el asset ID. En video se usa en lugar de las fotos, que Seedance rechaza si tienen rostros reales.</div>
    </div>
    ${id ? `
    ${c.photos.length ? '<div><label>Portada</label><div id="chCover"></div></div>' : ''}
    <div><label>Fotos (${c.photos.length})</label>
      ${c.photos.length > 1 ? '<div class="hint" style="margin-bottom:6px">Arrastrá para ordenar — la primera es la foto de perfil</div>' : ''}
      <div class="char-photos-grid" id="chPhotos">
        ${c.photos.map((p, pi) => `<div class="ref-thumb${pi === 0 ? ' is-profile' : ''}" draggable="true" data-photo="${esc(p)}"><img src="${fileUrl(p)}" draggable="false" alt=""><button class="rm" data-key="${esc(p)}">×</button></div>`).join('')}
        <button class="ref-add" id="chAddPhoto">+</button>
      </div>
    </div>
    <div class="variant-manager">
      <div class="variant-manager-head"><label>Variantes / outfits (${(c.variants || []).length})</label><button type="button" class="mini-btn" id="chAddVariant">${IC('plus')} Nueva variante</button></div>
      <div class="variant-list">${(c.variants || []).map((v) => `
        <div class="variant-item" data-variant="${v.id}">
          <div class="variant-item-head"><strong>${esc(v.name)}</strong><div>
            <button type="button" class="mini-btn" data-vact="rename">Editar</button>
            <button type="button" class="mini-btn" data-vact="photo">${IC('upload')} Subir</button>
            <button type="button" class="mini-btn" data-vact="fromassets">${IC('image')} Desde assets</button>
            <button type="button" class="mini-btn danger" data-vact="delete">${IC('trash')}</button>
          </div></div>
          ${v.description ? `<div class="hint">${esc(v.description)}</div>` : ''}
          <div class="variant-photos">${v.photos.map((p) => `<span class="ref-thumb"><img src="${fileUrl(p)}" alt=""><button class="rm" data-vphoto="${esc(p)}">×</button></span>`).join('') || '<span class="hint">Sin fotos todavía</span>'}</div>
        </div>`).join('')}</div>
    </div>` : '<p class="hint">Guardá el personaje primero y después subile fotos y variantes.</p>'}
    <button class="generate-btn small" id="chSave">${id ? 'Guardar cambios' : 'Crear personaje'}</button>`;

  if (id && c.photos.length) {
    $('#chCover').appendChild(buildCoverPositioner(c, async (avatarPos) => {
      const updated = await api(`/api/characters/${id}`, { method: 'PUT', body: { avatarPos } });
      state.characters[state.characters.findIndex((x) => x.id === id)] = updated;
      renderCharacters();
      renderPinned();
    }));
  }

  $('#chSave').addEventListener('click', async () => {
    const voices2 = state.voices || [];
    const voiceId = $('#chVoice').value;
    const payload = {
      name: $('#chName').value,
      description: $('#chDesc').value,
      voiceId,
      voiceName: voices2.find((v) => v.id === voiceId)?.name || '',
      arkAssetId: $('#chArkAsset').value.trim()
    };
    try {
      if (id) {
        const updated = await api(`/api/characters/${id}`, { method: 'PUT', body: payload });
        const i = state.characters.findIndex((x) => x.id === id);
        state.characters[i] = updated;
        $('#charModal').hidden = true;
        state.editingCharId = null;
        toast('Personaje actualizado');
      } else {
        let created = await api('/api/characters', { method: 'POST', body: payload });
        if (state.pendingCharacterAsset) {
          created = await api(`/api/characters/${created.id}/photos`, {
            method: 'POST', body: { assetKey: state.pendingCharacterAsset }
          });
        }
        state.characters.unshift(created);
        state.editingCharId = created.id;
        state.pendingCharacterAsset = null;
        $('#charModalTitle').textContent = 'Editar personaje';
        renderCharModal();
        toast(created.photos.length ? 'Personaje creado con su foto inicial' : 'Personaje creado — ahora subile fotos');
      }
      renderCharacters();
      renderPinned();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#chAddPhoto')?.addEventListener('click', () => {
    $('#fileInput').onchange = async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const f of files) {
        try {
          const dataUrl = await readFileAsDataUrl(f);
          const updated = await api(`/api/characters/${id}/photos`, { method: 'POST', body: { name: f.name, dataUrl } });
          const i = state.characters.findIndex((x) => x.id === id);
          state.characters[i] = updated;
        } catch (err) {
          toast(`${f.name}: ${err.message}`, 'err');
        }
      }
      renderCharModal();
      renderCharacters();
      renderPinned();
    };
    $('#fileInput').click();
  });

  $('#chAddVariant')?.addEventListener('click', () => openVariantEditor(id));

  $$('#charModalBody .variant-item').forEach((item) => {
    const variantId = item.dataset.variant;
    const variant = (c.variants || []).find((v) => v.id === variantId);
    item.querySelector('[data-vact="rename"]').addEventListener('click', () => openVariantEditor(id, variantId));
    item.querySelector('[data-vact="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Borrar la variante “${variant.name}” y sus fotos?`)) return;
      const updated = await api(`/api/characters/${id}/variants/${variantId}`, { method: 'DELETE' });
      state.characters[state.characters.findIndex((x) => x.id === id)] = updated;
      if (state.characterVariantId === variantId) { state.characterVariantId = ''; applyPinnedCharacterPhotos(); }
      renderCharModal(); renderCharacters(); renderCharacterVariantControl(); renderRefs();
    });
    item.querySelector('[data-vact="fromassets"]').addEventListener('click', () => openCharAssetPicker(id, variantId));
    item.querySelector('[data-vact="photo"]').addEventListener('click', () => {
      $('#fileInput').onchange = async (e) => {
        const files = [...e.target.files]; e.target.value = '';
        let updated;
        for (const f of files) {
          const dataUrl = await readFileAsDataUrl(f);
          updated = await api(`/api/characters/${id}/variants/${variantId}/photos`, { method: 'POST', body: { name: f.name, dataUrl } });
        }
        if (updated) state.characters[state.characters.findIndex((x) => x.id === id)] = updated;
        if (state.pinnedId === id && state.characterVariantId === variantId) { applyPinnedCharacterPhotos(); renderRefs(); }
        renderCharModal(); renderCharacters(); renderCharacterVariantControl();
      };
      $('#fileInput').click();
    });
    item.querySelectorAll('[data-vphoto]').forEach((button) => button.addEventListener('click', async () => {
      const updated = await api(`/api/characters/${id}/variants/${variantId}/photos?key=${encodeURIComponent(button.dataset.vphoto)}`, { method: 'DELETE' });
      state.characters[state.characters.findIndex((x) => x.id === id)] = updated;
      if (state.pinnedId === id && state.characterVariantId === variantId) { applyPinnedCharacterPhotos(); renderRefs(); }
      renderCharModal(); renderCharacters(); renderCharacterVariantControl();
    }));
  });

  $$('#chPhotos .rm').forEach((b) => {
    b.addEventListener('click', async () => {
      const updated = await api(`/api/characters/${id}/photos?key=${encodeURIComponent(b.dataset.key)}`, { method: 'DELETE' });
      const i = state.characters.findIndex((x) => x.id === id);
      state.characters[i] = updated;
      renderCharModal();
      renderCharacters();
      renderPinned();
    });
  });

  setupCharPhotoDrag(id);
}

function setupCharPhotoDrag(id) {
  const grid = $('#chPhotos');
  if (!grid || grid.querySelectorAll('[data-photo]').length < 2) return;
  let dragging = null;

  grid.querySelectorAll('[data-photo]').forEach((thumb) => {
    thumb.addEventListener('dragstart', (e) => {
      dragging = thumb;
      thumb.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', thumb.dataset.photo);
    });
    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging');
      dragging = null;
    });
  });

  grid.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const target = e.target.closest('[data-photo]');
    if (!target || target === dragging) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    grid.insertBefore(dragging, before ? target : target.nextSibling);
  });

  grid.addEventListener('drop', async (e) => {
    if (!dragging) return;
    e.preventDefault();
    const order = [...grid.querySelectorAll('[data-photo]')].map((el) => el.dataset.photo);
    const i = state.characters.findIndex((x) => x.id === id);
    const previous = state.characters[i]?.photos || [];
    if (order.join('\n') === previous.join('\n')) return;
    try {
      const updated = await api(`/api/characters/${id}/photos`, { method: 'PUT', body: { order } });
      state.characters[i] = updated;
      if (state.pinnedId === id && !state.characterVariantId) applyPinnedCharacterPhotos();
      renderCharModal();
      renderCharacters();
      renderPinned();
      renderRefs();
    } catch (err) {
      toast(err.message, 'err');
      renderCharModal();
    }
  });
}

// elegir un asset como foto (de variante de personaje, o de locación/objeto y
// sus variantes) sin salir del modal correspondiente
async function openCharAssetPicker(target) {
  // acepta la forma vieja (characterId, variantId) y la nueva ({entity, ownerId, variantId})
  const t = typeof target === 'object' && target !== null && target.ownerId !== undefined
    ? target
    : { entity: 'character', ownerId: arguments[0], variantId: arguments[1] };
  // added: assetKey → key de la foto ya creada en esta sesión, para dar feedback
  // y permitir quitar (las fotos se copian con otro nombre, no hay vínculo directo)
  state.charAssetPicker = { ...t, zone: 'generated', added: new Map() };
  if (!state.assets.generated.length && !state.assets.uploads.length) {
    try { state.assets = await api('/api/assets'); } catch { /* sin assets igual mostramos el modal */ }
  }
  const owner = (t.entity === 'element' ? state.elements : state.characters).find((x) => x.id === t.ownerId);
  const v = (owner?.variants || []).find((x) => x.id === t.variantId);
  $('#charAssetPickerTitle').textContent = `Fotos para “${v?.name || owner?.name || ''}”`;
  renderCharAssetPickerGrid();
  $('#charAssetPickerModal').hidden = false;
}

function pickerTargetPhotos(entity) {
  const cp = state.charAssetPicker;
  const owner = entity || (cp.entity === 'element' ? state.elements : state.characters).find((x) => x.id === cp.ownerId);
  if (!owner) return [];
  return cp.variantId ? ((owner.variants || []).find((v) => v.id === cp.variantId)?.photos || []) : (owner.photos || []);
}

function refreshPickerEntity(updated) {
  const cp = state.charAssetPicker;
  if (cp.entity === 'element') {
    state.elements[state.elements.findIndex((x) => x.id === cp.ownerId)] = updated;
    renderElementModal();
    renderElements();
  } else {
    state.characters[state.characters.findIndex((x) => x.id === cp.ownerId)] = updated;
    if (state.pinnedId === cp.ownerId) { applyPinnedCharacterPhotos(); renderRefs(); renderCharacterVariantControl(); }
    renderCharModal();
    renderCharacters();
    renderPinned();
  }
}

function renderCharAssetPickerGrid() {
  const cp = state.charAssetPicker;
  if (!cp) return;
  $$('#charAssetPickerTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.czone === cp.zone));
  const items = (state.assets[cp.zone] || []).filter((a) => /\.(png|jpe?g|webp)$/i.test(a.key));
  const added = cp.added.size;
  $('#charAssetPickerHint').textContent = added ? `${added} agregada${added === 1 ? '' : 's'} en esta tanda — clickeá de nuevo para quitar` : '';
  $('#charAssetPickerGrid').innerHTML = items.length ? items.map((a) => {
    const on = cp.added.has(a.key);
    return `<button class="shot-asset-cell${on ? ' selected' : ''}" data-k="${esc(a.key)}" title="${esc(a.name)}">
      <img src="${fileUrl(a.key)}" loading="lazy" alt="">${on ? `<span class="shot-asset-check">${IC('check')}</span>` : ''}</button>`;
  }).join('') : '<div class="hint">No hay imágenes en esta zona.</div>';
  $('#charAssetPickerGrid').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.k;
    if (!cp.ownerId) return;
    b.disabled = true;
    const base = cp.entity === 'element' ? `/api/elements/${cp.ownerId}` : `/api/characters/${cp.ownerId}`;
    const endpoint = cp.variantId ? `${base}/variants/${cp.variantId}/photos` : `${base}/photos`;
    try {
      if (cp.added.has(key)) {
        const photoKey = cp.added.get(key);
        const updated = await api(`${endpoint}?key=${encodeURIComponent(photoKey)}`, { method: 'DELETE' });
        cp.added.delete(key);
        refreshPickerEntity(updated);
        toast('Foto quitada');
      } else {
        const before = pickerTargetPhotos();
        const updated = await api(endpoint, { method: 'POST', body: { assetKey: key } });
        const newKey = pickerTargetPhotos(updated).find((k) => !before.includes(k));
        if (newKey) cp.added.set(key, newKey);
        refreshPickerEntity(updated);
        toast('Foto agregada');
      }
      renderCharAssetPickerGrid();
    } catch (err) {
      toast(err.message, 'err');
      b.disabled = false;
    }
  }));
}

$$('#charAssetPickerTabs .tab').forEach((t) => t.addEventListener('click', () => {
  if (!state.charAssetPicker) return;
  state.charAssetPicker.zone = t.dataset.czone;
  renderCharAssetPickerGrid();
}));

function closeCharAssetPicker() {
  $('#charAssetPickerModal').hidden = true;
  state.charAssetPicker = null;
}
$('#charAssetPickerClose').addEventListener('click', closeCharAssetPicker);
$('#charAssetPickerDone').addEventListener('click', closeCharAssetPicker);
$('#charAssetPickerModal').addEventListener('click', (e) => { if (e.target.id === 'charAssetPickerModal') closeCharAssetPicker(); });

// sirve para variantes de personajes Y de locaciones/objetos (entity)
function openVariantEditor(ownerId, variantId = null, entity = 'character') {
  const owner = (entity === 'element' ? state.elements : state.characters).find((c) => c.id === ownerId);
  const variant = (owner?.variants || []).find((v) => v.id === variantId);
  state.variantEditor = { ownerId, variantId, entity };
  $('#variantEditorTitle').textContent = variant ? 'Editar variante' : 'Nueva variante';
  $('#variantEditorName').value = variant?.name || '';
  $('#variantEditorDescription').value = variant?.description || '';
  $('#variantEditorModal').hidden = false;
  setTimeout(() => $('#variantEditorName').focus(), 0);
}

function closeVariantEditor() { $('#variantEditorModal').hidden = true; state.variantEditor = null; }
$('#variantEditorClose').addEventListener('click', closeVariantEditor);
$('#variantEditorCancel').addEventListener('click', closeVariantEditor);
$('#variantEditorModal').addEventListener('click', (e) => { if (e.target.id === 'variantEditorModal') closeVariantEditor(); });
$('#variantEditorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ownerId, variantId, entity } = state.variantEditor || {};
  if (!ownerId) return;
  const body = { name: $('#variantEditorName').value.trim(), description: $('#variantEditorDescription').value.trim() };
  if (!body.name) return;
  const base = entity === 'element' ? `/api/elements/${ownerId}/variants` : `/api/characters/${ownerId}/variants`;
  try {
    const updated = await api(variantId ? `${base}/${variantId}` : base, { method: variantId ? 'PUT' : 'POST', body });
    if (entity === 'element') {
      state.elements[state.elements.findIndex((x) => x.id === ownerId)] = updated;
      closeVariantEditor();
      renderElementModal(); renderElements();
    } else {
      state.characters[state.characters.findIndex((x) => x.id === ownerId)] = updated;
      closeVariantEditor();
      renderCharModal(); renderCharacters(); renderCharacterVariantControl();
    }
    toast(variantId ? 'Variante actualizada' : 'Variante creada');
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// locaciones y objetos ("elementos")
// ---------------------------------------------------------------------------

const ELEMENT_KIND_LABEL = { location: 'Locación', object: 'Objeto' };

function elementCategories(kind = '') {
  return [...new Set(state.elements
    .filter((el) => !kind || el.kind === kind)
    .map((el) => (el.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function renderElements() {
  sortEntities();
  const catSel = $('#elementCategoryFilter');
  const cats = elementCategories(state.elementKindFilter);
  catSel.innerHTML = '<option value="">Todas</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  catSel.value = cats.includes(state.elementCategoryFilter) ? state.elementCategoryFilter : '';
  state.elementCategoryFilter = catSel.value;
  $$('#elementKindChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.ekind === state.elementKindFilter));

  const grid = $('#elementsGrid');
  const items = state.elements.filter((el) =>
    (!state.elementKindFilter || el.kind === state.elementKindFilter)
    && (!state.elementCategoryFilter || (el.category || '') === state.elementCategoryFilter));
  if (!items.length) {
    grid.innerHTML = '<div class="empty-note">Creá tu primera locación u objeto: nombre, categoría, fotos y variantes (ej: “Fábrica abandonada” → “en invierno”).</div>';
    return;
  }
  grid.innerHTML = '';
  for (const el of items) {
    const card = document.createElement('div');
    card.className = 'char-card';
    const avatar = avatarHtml(el, 'globe');
    const minis = el.photos.slice(1, 5).map((p) => `<img src="${fileUrl(p)}" alt="">`).join('')
      + (el.photos.length > 5 ? `<div class="more">+${el.photos.length - 5}</div>` : '');
    const linkedCount = state.elementLinks.filter((link) => link.elementId === el.id).length;
    card.innerHTML = `
      <div class="char-top">${avatar}<div>
        <div class="char-name">${esc(el.name)}</div>
        <div class="element-meta"><span class="element-kind-badge ${el.kind}">${ELEMENT_KIND_LABEL[el.kind] || el.kind}</span>${el.category ? `<span class="element-category">${esc(el.category)}</span>` : ''}</div>
      </div></div>
      <div class="char-desc">${esc(el.description || '')}</div>
      ${(el.variants || []).length ? `<div class="hint" style="margin-bottom:8px">${el.variants.length} variante${el.variants.length === 1 ? '' : 's'}</div>` : ''}
      <div class="char-photos-mini">${minis}</div>
      <div class="char-actions">
        <button class="mini-btn" data-eact="use">${IC('link')} Usar fotos</button>
        <button class="mini-btn" data-eact="edit">${IC('edit')} Editar</button>
        <button class="mini-btn" data-eact="gallery">${IC('eye')} Ver fotos</button>
        <button class="mini-btn" data-eact="assets">${IC('image')} Assets${linkedCount ? ` (${linkedCount})` : ''}</button>
        <button class="mini-btn danger" data-eact="del" title="Eliminar">${IC('trash')}</button>
      </div>`;
    card.querySelectorAll('[data-eact]').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.eact;
        if (act === 'use') {
          if (!el.photos.length) return toast('No tiene fotos todavía', 'err');
          setMode('image');
          for (const p of el.photos) addRef(p, false);
          goToCreate();
          toast(`Fotos de ${el.name} agregadas como referencia`);
        }
        if (act === 'edit') openElementModal(el.id);
        if (act === 'gallery') openElementGallery(el.id);
        if (act === 'assets') openElementAssets(el.id);
        if (act === 'del') {
          if (!confirm(`¿Eliminar “${el.name}” y sus fotos?`)) return;
          await api(`/api/elements/${el.id}`, { method: 'DELETE' });
          state.elements = state.elements.filter((x) => x.id !== el.id);
          state.elementLinks = state.elementLinks.filter((link) => link.elementId !== el.id);
          renderElements();
        }
      });
    });
    grid.appendChild(card);
  }
}

$('#btnNewElement').addEventListener('click', () => openElementModal(null));
$$('#elementKindChips .chip').forEach((c) => c.addEventListener('click', () => {
  state.elementKindFilter = c.dataset.ekind;
  renderElements();
}));
$('#elementCategoryFilter').addEventListener('change', () => {
  state.elementCategoryFilter = $('#elementCategoryFilter').value;
  renderElements();
});

function openElementModal(id) {
  state.editingElementId = id || null;
  $('#elementModalTitle').textContent = id ? 'Editar locación u objeto' : 'Nueva locación u objeto';
  renderElementModal();
  $('#elementModal').hidden = false;
}
function closeElementModal() {
  $('#elementModal').hidden = true;
  state.editingElementId = null;
}
$('#elementModalClose').addEventListener('click', closeElementModal);
$('#elementModal').addEventListener('click', (e) => { if (e.target.id === 'elementModal') closeElementModal(); });

function renderElementModal() {
  const id = state.editingElementId;
  const el = id ? state.elements.find((x) => x.id === id) : null;
  const thumb = (p, attr) => `<span class="ref-thumb"><img src="${fileUrl(p)}" alt=""><button class="rm" ${attr}="${esc(p)}" title="Quitar">×</button></span>`;
  $('#elementModalBody').innerHTML = `
    <label>Tipo
      <select id="elKind" class="select">
        <option value="location"${(el?.kind || 'location') === 'location' ? ' selected' : ''}>Locación</option>
        <option value="object"${el?.kind === 'object' ? ' selected' : ''}>Objeto</option>
      </select>
    </label>
    <label>Nombre<input id="elName" type="text" maxlength="120" value="${esc(el?.name || '')}" placeholder="Ej: Fábrica abandonada, Espada mandoble"></label>
    <label>Categoría<input id="elCategory" type="text" maxlength="80" value="${esc(el?.category || '')}" placeholder="Ej: Exteriores, Armas… escribí para crear una nueva"></label>
    <div id="elCategoryChips" class="chips"></div>
    <label>Descripción<textarea id="elDescription" rows="3">${esc(el?.description || '')}</textarea></label>
    ${el ? `
    ${el.photos.length ? '<div class="variant-manager"><label>Portada</label><div id="elCover"></div></div>' : ''}
    <div class="variant-manager">
      <div class="variant-manager-head"><label>Fotos (${el.photos.length})</label><div>
        <button type="button" class="mini-btn" id="elAddPhoto">${IC('upload')} Subir</button>
        <button type="button" class="mini-btn" id="elAddFromAssets">${IC('image')} Desde assets</button>
      </div></div>
      <div class="variant-photos">${el.photos.map((p) => thumb(p, 'data-elphoto')).join('') || '<span class="hint">Sin fotos todavía</span>'}</div>
    </div>
    <div class="variant-manager">
      <div class="variant-manager-head"><label>Variantes (${(el.variants || []).length})</label><button type="button" class="mini-btn" id="elAddVariant">${IC('plus')} Nueva variante</button></div>
      <div class="variant-list">${(el.variants || []).map((v) => `
        <div class="variant-item" data-elvariant="${v.id}">
          <div class="variant-item-head"><strong>${esc(v.name)}</strong><div>
            <button type="button" class="mini-btn" data-evact="rename">Editar</button>
            <button type="button" class="mini-btn" data-evact="photo">${IC('upload')} Subir</button>
            <button type="button" class="mini-btn" data-evact="fromassets">${IC('image')} Desde assets</button>
            <button type="button" class="mini-btn danger" data-evact="delete">${IC('trash')}</button>
          </div></div>
          ${v.description ? `<div class="hint">${esc(v.description)}</div>` : ''}
          <div class="variant-photos">${v.photos.map((p) => thumb(p, 'data-evphoto')).join('') || '<span class="hint">Sin fotos todavía</span>'}</div>
        </div>`).join('')}</div>
    </div>` : '<p class="hint">Guardalo primero y después cargale fotos y variantes.</p>'}
    <button class="generate-btn small" id="elSave">${el ? 'Guardar cambios' : 'Crear'}</button>`;

  const body = $('#elementModalBody');
  const renderElCategoryChips = () => chipRow($('#elCategoryChips'), elementCategories(), $('#elCategory').value.trim(), (c) => {
    $('#elCategory').value = c;
    renderElCategoryChips();
  });
  renderElCategoryChips();
  $('#elCategory').addEventListener('input', renderElCategoryChips);

  const refreshElement = (updated) => {
    state.elements[state.elements.findIndex((x) => x.id === updated.id)] = updated;
    renderElementModal();
    renderElements();
  };

  $('#elSave').addEventListener('click', async () => {
    const payload = {
      kind: $('#elKind').value,
      name: $('#elName').value.trim(),
      category: $('#elCategory').value.trim(),
      description: $('#elDescription').value.trim()
    };
    if (!payload.name) return toast('Poné un nombre', 'err');
    try {
      if (id) {
        refreshElement(await api(`/api/elements/${id}`, { method: 'PUT', body: payload }));
        toast('Guardado');
      } else {
        const created = await api('/api/elements', { method: 'POST', body: payload });
        state.elements.unshift(created);
        state.editingElementId = created.id;
        $('#elementModalTitle').textContent = 'Editar locación u objeto';
        renderElementModal();
        renderElements();
        toast(`${created.name} — ahora cargale fotos`);
      }
    } catch (err) { toast(err.message, 'err'); }
  });

  if (!el) return;

  const uploadPhotos = (endpoint) => {
    $('#fileInput').onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      let updated;
      for (const f of files) {
        try {
          const dataUrl = await readFileAsDataUrl(f);
          updated = await api(endpoint, { method: 'POST', body: { name: f.name, dataUrl } });
        } catch (err) { toast(`${f.name}: ${err.message}`, 'err'); }
      }
      if (updated) refreshElement(updated);
    };
    $('#fileInput').click();
  };

  if (el.photos.length) {
    $('#elCover').appendChild(buildCoverPositioner(el, async (avatarPos) => {
      refreshElement(await api(`/api/elements/${id}`, { method: 'PUT', body: { avatarPos } }));
    }));
  }

  $('#elAddPhoto')?.addEventListener('click', () => uploadPhotos(`/api/elements/${id}/photos`));
  $('#elAddFromAssets')?.addEventListener('click', () => openCharAssetPicker({ entity: 'element', ownerId: id, variantId: null }));
  $('#elAddVariant')?.addEventListener('click', () => openVariantEditor(id, null, 'element'));

  body.querySelectorAll('[data-elphoto]').forEach((b) => b.addEventListener('click', async () => {
    refreshElement(await api(`/api/elements/${id}/photos?key=${encodeURIComponent(b.dataset.elphoto)}`, { method: 'DELETE' }));
  }));
  body.querySelectorAll('.variant-photos img').forEach((img) => img.addEventListener('click', () => {
    const key = img.src.includes('/files/') ? decodeURIComponent(img.src.split('/files/')[1]) : null;
    if (key) openLightbox(key, [...el.photos, ...(el.variants || []).flatMap((v) => v.photos)]);
  }));

  body.querySelectorAll('.variant-item').forEach((item) => {
    const variantId = item.dataset.elvariant;
    const variant = (el.variants || []).find((v) => v.id === variantId);
    item.querySelector('[data-evact="rename"]').addEventListener('click', () => openVariantEditor(id, variantId, 'element'));
    item.querySelector('[data-evact="photo"]').addEventListener('click', () => uploadPhotos(`/api/elements/${id}/variants/${variantId}/photos`));
    item.querySelector('[data-evact="fromassets"]').addEventListener('click', () => openCharAssetPicker({ entity: 'element', ownerId: id, variantId }));
    item.querySelector('[data-evact="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Borrar la variante “${variant.name}” y sus fotos?`)) return;
      refreshElement(await api(`/api/elements/${id}/variants/${variantId}`, { method: 'DELETE' }));
    });
    item.querySelectorAll('[data-evphoto]').forEach((b) => b.addEventListener('click', async () => {
      refreshElement(await api(`/api/elements/${id}/variants/${variantId}/photos?key=${encodeURIComponent(b.dataset.evphoto)}`, { method: 'DELETE' }));
    }));
  });
}

function openElementGallery(id) {
  const el = state.elements.find((x) => x.id === id);
  if (!el) return;
  $('#characterGalleryTitle').textContent = `${el.name} · ${ELEMENT_KIND_LABEL[el.kind] || ''}`;
  const groups = [{ name: 'Original', description: el.description || '', photos: el.photos || [] }, ...(el.variants || [])];
  $('#characterGalleryBody').innerHTML = groups.map((group) => `
    <section class="character-gallery-group">
      <div class="character-gallery-group-head"><h4>${esc(group.name)}</h4><span>${group.photos.length} foto${group.photos.length === 1 ? '' : 's'}</span></div>
      ${group.description ? `<p>${esc(group.description)}</p>` : ''}
      <div class="character-gallery-grid">${group.photos.length
        ? group.photos.map((photo) => `<button data-gallery-photo="${esc(photo)}"><img src="${fileUrl(photo)}" loading="lazy" alt=""></button>`).join('')
        : '<div class="hint">Esta variante todavía no tiene fotos.</div>'}</div>
    </section>`).join('');
  $('#characterGalleryBody').querySelectorAll('[data-gallery-photo]').forEach((button) => {
    button.addEventListener('click', () => openLightbox(button.dataset.galleryPhoto, groups.flatMap((group) => group.photos || [])));
  });
  $('#characterGalleryModal').hidden = false;
}

function openElementAssets(id) {
  const el = state.elements.find((x) => x.id === id);
  if (!el) return;
  $('#characterGalleryTitle').textContent = `${el.name} · Assets asociados`;
  const groups = [{ id: null, name: 'Original' }, ...(el.variants || []).map((v) => ({ id: v.id, name: v.name }))];
  const links = state.elementLinks.filter((link) => link.elementId === id);
  $('#characterGalleryBody').innerHTML = groups.map((group) => {
    const items = links.filter((link) => (link.variantId || null) === group.id);
    return `<section class="character-gallery-group">
      <div class="character-gallery-group-head"><h4>${esc(group.name)}</h4><span>${items.length} asset${items.length === 1 ? '' : 's'}</span></div>
      <div class="character-gallery-grid linked-assets">${items.length ? items.map((link) => `
        <div class="linked-asset"><button data-gallery-photo="${esc(link.key)}"><img src="${fileUrl(link.key)}" loading="lazy" alt=""></button><button class="linked-remove" data-elunlink="${esc(link.key)}" title="Quitar asociación">×</button></div>`).join('') : '<div class="hint">Sin assets asociados.</div>'}</div>
    </section>`;
  }).join('');
  $('#characterGalleryBody').querySelectorAll('[data-gallery-photo]').forEach((button) => button.addEventListener('click', () => openLightbox(button.dataset.galleryPhoto, links.map((link) => link.key))));
  $('#characterGalleryBody').querySelectorAll('[data-elunlink]').forEach((button) => button.addEventListener('click', async () => {
    const result = await api(`/api/element-links?key=${encodeURIComponent(button.dataset.elunlink)}`, { method: 'DELETE' });
    state.elementLinks = result.links;
    openElementAssets(id);
    renderElements();
  }));
  $('#characterGalleryModal').hidden = false;
}

// ---------------------------------------------------------------------------
// consumo y precios
// ---------------------------------------------------------------------------

function imgPrice(modelId, res) {
  const t = state.pricing?.image?.[modelId] || {};
  return t[res] ?? t.auto ?? t['1K'] ?? Object.values(t)[0] ?? 0;
}

function updateEstimate() {
  const el = $('#costEstimate');
  if (!state.pricing) { el.textContent = ''; return; }
  if (state.mode === 'image') {
    const p = imgPrice(state.modelId, state.resolution) * state.batch;
    el.textContent = p ? `≈ $${p.toFixed(3)}` : '';
  } else if (state.mode === 'video') {
    const t = state.pricing.video?.[state.video.modelId] || {};
    const perSec = t[state.video.resolution] ?? Object.values(t)[0] ?? 0;
    const p = perSec * state.video.duration;
    el.textContent = p ? `≈ $${p.toFixed(3)} (${state.video.duration}s)` : '';
  } else {
    const per1k = state.pricing.audio?.['eleven-v3']?.per1kChars ?? 0;
    const chars = promptBox.value.length;
    el.textContent = chars
      ? `≈ $${((chars / 1000) * per1k).toFixed(3)} (${chars} car.)`
      : `$${per1k.toFixed(2)} / 1k caracteres`;
  }
}

const fmtUsd = (n) => `$${(n || 0).toFixed(n >= 10 ? 2 : 3)}`;

async function loadCosts() {
  let data;
  try {
    data = await api('/api/costs');
  } catch (e) {
    return toast(e.message, 'err');
  }
  state.pricing = data.pricing;
  updateEstimate();

  const [y, m] = data.currentMonth.split('-');
  const monthName = new Date(Number(y), Number(m) - 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' });
  $('#costsSummary').innerHTML = `
    <div class="cost-tile">
      <div class="ct-label">Este mes</div>
      <div class="ct-value">${fmtUsd(data.currentMonthTotal)}</div>
      <div class="ct-sub">${esc(monthName)}</div>
    </div>
    <div class="cost-tile">
      <div class="ct-label">Total histórico</div>
      <div class="ct-value">${fmtUsd(data.total)}</div>
      <div class="ct-sub">desde que empezaste a manifestar</div>
    </div>
    <div class="cost-tile">
      <div class="ct-label">Operaciones registradas</div>
      <div class="ct-value">${data.recent.length >= 100 ? '100+' : data.recent.length}</div>
      <div class="ct-sub">estimaciones, no factura oficial</div>
    </div>`;

  const byModel = Object.entries(data.byModelThisMonth).sort((a, b) => b[1].cost - a[1].cost);
  $('#costsByModel').innerHTML = byModel.length
    ? byModel.map(([k, v]) => `<div class="cost-row">
        <span class="cr-label">${esc(k)}<span class="cr-sub">×${v.count}</span></span>
        <span class="cr-value">${fmtUsd(v.cost)}</span></div>`).join('')
    : '<div class="empty-note" style="padding:8px 0">Sin consumo este mes.</div>';

  const byMonth = Object.entries(data.byMonth).sort((a, b) => b[0].localeCompare(a[0]));
  $('#costsByMonth').innerHTML = byMonth.length
    ? byMonth.map(([k, v]) => `<div class="cost-row"><span class="cr-label">${esc(k)}</span><span class="cr-value">${fmtUsd(v)}</span></div>`).join('')
    : '<div class="empty-note" style="padding:8px 0">Todavía no hay registros.</div>';

  $('#pricingUpdated').textContent = data.pricing.updatedAt
    ? `· ${esc(data.pricing.note || '')} · ${fmtDate(data.pricing.updatedAt)}`
    : '· valores iniciales estimados';

  let rows = '';
  for (const [modelId, table] of Object.entries(data.pricing.image)) {
    const name = state.models.find((x) => x.id === modelId)?.name || modelId;
    rows += `<div class="pricing-row"><span class="pr-name">${esc(name)}</span>` +
      Object.entries(table).map(([res, val]) =>
        `<label class="pr-unit">${res} <input type="number" step="0.001" min="0" data-model="${esc(modelId)}" data-res="${esc(res)}" value="${val}"></label>`
      ).join('') + `<span class="pr-unit">USD/imagen</span></div>`;
  }
  for (const [modelId, table] of Object.entries(data.pricing.video || {})) {
    const name = state.videoModels.find((x) => x.id === modelId)?.name || modelId;
    rows += `<div class="pricing-row"><span class="pr-name">${esc(name)}</span>` +
      Object.entries(table).map(([res, val]) =>
        `<label class="pr-unit">${res} <input type="number" step="0.001" min="0" data-vmodel="${esc(modelId)}" data-res="${esc(res)}" value="${val}"></label>`
      ).join('') + `<span class="pr-unit">USD/segundo</span></div>`;
  }
  rows += `<div class="pricing-row"><span class="pr-name">Eleven v3</span>
    <label class="pr-unit">1k car. <input type="number" step="0.001" min="0" data-audio="per1kChars" value="${data.pricing.audio['eleven-v3'].per1kChars}"></label>
    <span class="pr-unit">USD/1000 caracteres</span></div>`;
  $('#pricingTable').innerHTML = `<div class="pricing-table">${rows}</div>`;

  $('#costsLedger').innerHTML = data.recent.length
    ? data.recent.slice(0, 40).map((e) => `<div class="cost-row">
        <span class="cr-label">${e.type === 'image' ? IC('image') : e.type === 'video' ? IC('film') : e.type === 'audio' ? IC('mic') : IC('globe')} ${esc(e.label || e.modelId)}
          <span class="cr-sub">${e.units} ${esc(e.unitLabel || '')} · ${fmtDate(e.ts)}</span></span>
        <span class="cr-value">${fmtUsd(e.cost)}</span></div>`).join('')
    : '<div class="empty-note" style="padding:8px 0">Todavía no generaste nada.</div>';
}

$('#btnRefreshPricing').addEventListener('click', async () => {
  const btn = $('#btnRefreshPricing');
  btn.disabled = true;
  const prev = btn.innerHTML;
  btn.innerHTML = 'Rastreando la web…';
  try {
    const { changes } = await api('/api/pricing/refresh', { method: 'POST' });
    await loadCosts();
    if (changes?.length) toast(`Precios actualizados: ${changes.join(' · ')}`);
    else toast('Precios verificados — sin cambios detectados');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = prev;
  }
});

$('#btnSavePricing').addEventListener('click', async () => {
  const image = {};
  $$('#pricingTable input[data-model]').forEach((inp) => {
    const m = inp.dataset.model;
    image[m] = image[m] || {};
    image[m][inp.dataset.res] = Number(inp.value) || 0;
  });
  const video = {};
  $$('#pricingTable input[data-vmodel]').forEach((inp) => {
    const m = inp.dataset.vmodel;
    video[m] = video[m] || {};
    video[m][inp.dataset.res] = Number(inp.value) || 0;
  });
  const per1k = Number($('#pricingTable input[data-audio]')?.value) || 0;
  try {
    state.pricing = await api('/api/pricing', {
      method: 'PUT',
      body: { image, video, audio: { 'eleven-v3': { per1kChars: per1k } } }
    });
    updateEstimate();
    toast('Tarifas guardadas');
    loadCosts();
  } catch (e) {
    toast(e.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// configuración
// ---------------------------------------------------------------------------

function fillConfigForm() {
  const f = $('#configForm');
  const c = state.config;
  f.key_gemini.value = c.keys.gemini || '';
  f.key_googleTranslate.value = c.keys.googleTranslate || '';
  f.key_ark.value = c.keys.ark || '';
  f.key_elevenlabs.value = c.keys.elevenlabs || '';
  f.key_openai.value = c.keys.openai || '';
  f.openaiModel.value = c.openaiModel || 'gpt-5-mini';
  f.path_generated.value = c.paths.generated || '';
  f.path_uploads.value = c.paths.uploads || '';
  f.path_audio.value = c.paths.audio || '';
  f.path_video.value = c.paths.video || '';
  f.seedreamModelId.value = c.seedreamModelId || '';
  f.seedanceModelId.value = c.seedanceModelId || '';
  f.seedanceMiniModelId.value = c.seedanceMiniModelId || '';
  f.endpoint_ark.value = c.endpoints.ark || '';
  f.poserPrompt.value = c.poserPrompt || '';
  f.photoshopPath.value = c.photoshopPath || '';
  renderConfigAudioTags();
  $('#accessStatus').textContent = c.accessProtected
    ? 'La aplicación está protegida. Escribí una nueva clave solo si querés cambiarla.'
    : 'Todavía no hay clave: establecé una de al menos 6 caracteres.';
}

// Probar conexión: usa lo que haya en el formulario (aunque no esté guardado);
// si el campo está vacío, el servidor prueba con la key ya guardada.
$$('.test-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const service = btn.dataset.service;
    const f = $('#configForm');
    const out = $(`.test-result[data-result="${service}"]`);
    btn.disabled = true;
    out.className = 'test-result busy';
    out.textContent = 'Probando…';
    try {
      const body = { service, key: f[`key_${service}`].value.trim() };
      if (service === 'ark') {
        body.endpoint = f.endpoint_ark.value.trim();
        body.seedreamModelId = f.seedreamModelId.value.trim();
      }
      const r = await api('/api/test', { method: 'POST', body });
      out.className = `test-result ${r.ok ? 'ok' : 'err'}`;
      out.textContent = `${r.ok ? '✓' : '✗'} ${r.detail}`;
    } catch (e) {
      out.className = 'test-result err';
      out.textContent = `✗ ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });
});

$('#psDetectBtn').addEventListener('click', async () => {
  const btn = $('#psDetectBtn');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    const r = await api('/api/photoshop/detect', { method: 'POST' });
    $('#configForm').photoshopPath.value = r.path;
    if (state.config) state.config.photoshopPath = r.path;
    toast('Photoshop detectado y vinculado');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Detectar automáticamente';
  }
});

$('#poserPromptDefaultBtn').addEventListener('click', () => {
  $('#configForm').poserPrompt.value = state.config?.poserPromptDefault || '';
});

$('#configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.accessPassword.value && f.accessPassword.value !== f.accessPasswordConfirm.value) {
    return toast('Las claves de acceso no coinciden', 'err');
  }
  try {
    state.config = await api('/api/config', {
      method: 'PUT',
      body: {
        keys: {
          gemini: f.key_gemini.value.trim(),
          googleTranslate: f.key_googleTranslate.value.trim(),
          ark: f.key_ark.value.trim(),
          elevenlabs: f.key_elevenlabs.value.trim(),
          openai: f.key_openai.value.trim()
        },
        openaiModel: f.openaiModel.value.trim() || 'gpt-5-mini',
        paths: {
          generated: f.path_generated.value.trim(),
          uploads: f.path_uploads.value.trim(),
          audio: f.path_audio.value.trim(),
          video: f.path_video.value.trim()
        },
        endpoints: {
          ark: f.endpoint_ark.value.trim()
        },
        seedreamModelId: f.seedreamModelId.value.trim(),
        seedanceModelId: f.seedanceModelId.value.trim(),
        seedanceMiniModelId: f.seedanceMiniModelId.value.trim(),
        poserPrompt: f.poserPrompt.value.trim(),
        photoshopPath: f.photoshopPath.value.trim(),
        accessPassword: f.accessPassword.value
      }
    });
    renderTagPalette();
    f.accessPassword.value = '';
    f.accessPasswordConfirm.value = '';
    fillConfigForm();
    toast('Configuración guardada (queda solo en tu máquina)');
    state.voices = null; // por si cambió la key de ElevenLabs
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

async function init() {
  try {
    const s = await api('/api/state');
    state.config = s.config;
    state.models = s.models;
    state.videoModels = s.videoModels || [];
    state.characters = s.characters;
    state.prompts = s.prompts;
    state.promptCategoriesExtra = s.promptCategories || {};
    state.assetLinks = s.assetLinks || [];
    state.series = s.series || [];
    state.scripts = s.scripts || [];
    state.elements = s.elements || [];
    state.elementLinks = s.elementLinks || [];
    state.history = s.history;
    state.pricing = s.pricing;
    state.modelId = s.models[0]?.id;
  } catch (e) {
    toast('No pude cargar el estado: ' + e.message, 'err');
    return;
  }
  renderImageControls();
  if (state.pinnedId && pinnedChar()) {
    if (!(pinnedChar().variants || []).some((v) => v.id === state.characterVariantId)) state.characterVariantId = '';
    applyPinnedCharacterPhotos();
    renderRefs();
    renderCharacterVariantControl();
  }
  renderTagPalette();
  renderHistory();
  renderCharacters();
  renderPinned();
  renderPinnedHint();
  fillConfigForm();
  setMode('image');
  if (state.pinnedId && !pinnedChar()) setPinned('');

  // deep-links: #audio, #assets, #characters, #series, #prompts, #costs, #config
  const h = location.hash.slice(1);
  if (h === 'audio') setMode('audio');
  else if (['assets', 'characters', 'series', 'prompts', 'costs', 'config'].includes(h)) {
    $(`.nav-btn[data-view="${h}"]`)?.click();
  }
}

init();

// ---------------------------------------------------------------------------
// puente para el módulo Poser (poser.js, ES module)
// ---------------------------------------------------------------------------

window.manifestadorBridge = {
  api, toast, esc, fileUrl, addRef, IC, readFileAsDataUrl, goToCreate,
  getState: () => state
};
