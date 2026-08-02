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
  fonts: [],              // fuentes tipográficas personalizadas persistentes
  promptCategoriesExtra: {},
  assetLinks: [],
  promptQuickCategory: '',
  promptQuickSearch: '',
  history: [],
  voices: null,          // null = aún no cargadas
  audioModels: [],
  audioModelId: 'eleven-v3',
  assets: { generated: [], uploads: [], audio: [], video: [] },
  mode: 'image',
  modelId: null,
  aspectRatio: '1:1',
  resolution: '1K',
  batch: 1,
  videoModels: [],
  video: {
    modelId: null, mode: 'reference', aspectRatio: '16:9', resolution: '720p', duration: 5, audio: false,
    heygenAuthMode: 'oauth', heygenCharacterId: '', heygenVoiceId: '', heygenMotionPrompt: '', heygenExpressiveness: 'low'
  },
  heygenOAuth: { connected: false, localhostSupported: true },
  musicModel: null,
  music: { version: 'V5_5', customMode: true, instrumental: false, style: '', title: '' },
  transitionSounds: [],   // catálogo local, agrupado por las carpetas de public/sounds
  refs: [],              // [{ key, fromChar, label }]
  voiceId: '',
  currentEntry: null,
  currentOutput: 0,
  assetsZone: 'generated',
  assetAudioKind: 'all',
  audioUploadAutomationId: null,
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
  costProjectId: '',         // proyecto elegido en la estimación de Consumo
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
  uiTasks: [],             // monitor global de operaciones, visible desde cualquier vista
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

let uiTaskSequence = 0;

function renderTaskMonitor() {
  const panel = $('#taskMonitor');
  const list = $('#taskMonitorList');
  if (!panel || !list) return;
  const visible = [...state.uiTasks]
    .sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1)
      || (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, 6);
  panel.hidden = false;
  if (!visible.length) {
    panel.classList.remove('has-running');
    const summary = $('#taskMonitorSummary');
    if (summary) summary.textContent = 'Sin tareas activas';
    list.innerHTML = '<span class="task-monitor-empty">La actividad aparecerá aquí.</span>';
    return;
  }
  const running = state.uiTasks.filter((task) => task.status === 'running');
  panel.classList.toggle('has-running', running.length > 0);
  const summary = $('#taskMonitorSummary');
  if (summary) summary.textContent = running.length
    ? `${running.length} en ejecución`
    : 'Actividad reciente';
  list.innerHTML = visible.map((task) => {
    const hasTotal = Number(task.total) > 0;
    const counter = hasTotal
      ? `${Math.min(Number(task.current) || 0, Number(task.total))}/${Number(task.total)}`
      : task.status === 'done' ? 'Listo' : task.status === 'error' ? 'Error' : 'En curso';
    return `<div class="task-monitor-item ${task.status}">
      <span class="task-dot"></span>
      <span class="task-item-copy"><strong>${esc(task.title)}</strong><small>${esc(task.detail || (task.status === 'done' ? 'Completado' : 'Esperando respuesta…'))}</small></span>
      <span class="task-counter">${esc(counter)}</span>
    </div>`;
  }).join('');
}

function startUiTask(spec = {}) {
  const task = {
    id: `task-${Date.now()}-${++uiTaskSequence}`,
    title: String(spec.title || 'Procesando').slice(0, 100),
    detail: String(spec.detail || '').slice(0, 240),
    current: Math.max(0, Number(spec.current) || 0),
    total: Math.max(0, Number(spec.total) || 0),
    status: 'running',
    startedAt: Date.now()
  };
  state.uiTasks.unshift(task);
  renderTaskMonitor();
  return task.id;
}

function updateUiTask(taskId, patch = {}) {
  const task = state.uiTasks.find((item) => item.id === taskId);
  if (!task) return;
  if (patch.title !== undefined) task.title = String(patch.title).slice(0, 100);
  if (patch.detail !== undefined) task.detail = String(patch.detail).slice(0, 240);
  if (patch.current !== undefined) task.current = Math.max(0, Number(patch.current) || 0);
  if (patch.total !== undefined) task.total = Math.max(0, Number(patch.total) || 0);
  renderTaskMonitor();
}

function finishUiTask(taskId, { error = '', detail = '' } = {}) {
  const task = state.uiTasks.find((item) => item.id === taskId);
  if (!task) return;
  task.status = error ? 'error' : 'done';
  task.detail = String(error || detail || (error ? 'La tarea falló.' : 'Completado')).slice(0, 240);
  if (!error && task.total > 0) task.current = task.total;
  task.finishedAt = Date.now();
  renderTaskMonitor();
  setTimeout(() => {
    state.uiTasks = state.uiTasks.filter((item) => item.id !== taskId);
    renderTaskMonitor();
  }, error ? 12000 : 6000);
}

function inferredApiTask(path, method, body) {
  if (method === 'GET') return null;
  if (path === '/api/generate/image') return { title: 'Generando imagen', detail: 'Esperando al modelo de imagen…', total: Math.max(1, Number(body?.batch) || 1), current: 1 };
  if (path === '/api/generate/video') return { title: 'Generando video', detail: 'Esperando al modelo de video…' };
  if (path === '/api/generate/audio') return { title: 'Generando voz', detail: 'Esperando a ElevenLabs…' };
  if (path === '/api/generate/music' || /\/music\/generate$/.test(path)) return { title: 'Generando música', detail: 'Esperando a Suno…', total: 2, current: 1 };
  if (path === '/api/translate') return { title: 'Traduciendo texto', detail: 'Esperando la traducción…' };
  if (/\/automations\/[a-z0-9]+\/assemble$/.test(path)) return { title: 'Ensamblando video final', detail: 'Uniendo tomas, audio y música con FFmpeg…' };
  if (/\/automations\/[a-z0-9]+\/effect$/.test(path)) return { title: 'Aplicando efecto final', detail: 'Procesando imagen y conservando subtítulos nítidos…' };
  if (/\/automations\/[a-z0-9]+\/video$/.test(path)) return { title: 'Armando toma', detail: 'Sincronizando imagen y audio con FFmpeg…' };
  if (/\/scripts\/[a-z0-9]+\/generate$/.test(path)) return { title: 'Generando guion', detail: 'Esperando la respuesta del modelo…' };
  if (path === '/api/upload' || path === '/api/assets/audio') return { title: 'Guardando asset', detail: 'Subiendo el archivo a Manifestador…' };
  if (path === '/api/assets/zip') return { title: 'Preparando descarga', detail: 'Empaquetando los assets seleccionados…' };
  return null;
}

async function api(path, opts = {}) {
  const { task: requestedTask, ...requestOptions } = opts;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const taskSpec = requestedTask === false
    ? null
    : (typeof requestedTask === 'string' ? { title: requestedTask } : requestedTask || inferredApiTask(path, method, requestOptions.body));
  const taskId = taskSpec ? startUiTask(taskSpec) : '';
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...requestOptions,
      body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && json.loginRequired) showLogin();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (taskId) finishUiTask(taskId);
    return json;
  } catch (error) {
    if (taskId) finishUiTask(taskId, { error: error.message });
    throw error;
  }
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
