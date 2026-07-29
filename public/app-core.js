/* Manifestador — frontend · núcleo compartido (estado, helpers, constantes).
   Se carga ANTES que app.js: define $, $$, IC, state y los helpers que el resto
   usa. No engancha eventos ni corre lógica al cargar (bloque fundacional puro). */

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
  musicModel: null,
  music: { version: 'V5_5', customMode: true, instrumental: false, style: '', title: '' },
  refs: [],              // [{ key, fromChar, label }]
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
  shotAssetsField: 'assetKeys',   // 'assetKeys' (imágenes/video) o 'audioKeys'
  pickerTab: 'upload',
  replaceRefIndex: null,     // índice de la ref que el picker va a reemplazar (null = agregar)
  pickerCharacterId: '',     // drill-down del tab Personajes del picker
  pickerVariantId: '',
  charAssetPicker: null,     // { entity, ownerId, variantId, zone, added } al elegir un asset como foto
  shotPromptTarget: null,    // { si, hi } del plano que está eligiendo prompt de la biblioteca
  scriptViewId: null,        // guion abierto en la vista de lectura "Ver guion"
  elements: [],              // locaciones y objetos
  elementLinks: [],
  automations: [],           // proyectos del automatizador
  openAutomationId: null,    // proyecto abierto en la vista de detalle
  overlayBgPick: false,      // el picker está eligiendo fondo de referencia del overlay
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
