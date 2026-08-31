/* Manifestador — frontend · vistas, features y arranque.
   Requiere app-core.js cargado antes (estado y helpers compartidos). */

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
    if (view === 'automatizador') renderAutomations();
    if (view === 'subtitler') {
      const ready = (state.assets.video || []).length ? Promise.resolve() : refreshAssets().catch(() => undefined);
      ready.then(renderSubtitler);
    }
    if (view === 'elements') renderElements();
    if (view === 'poser') window.poserEnter?.();
    if (view === 'prompts') renderPromptLibrary();
    if (view === 'vocabulary') renderVocabularyLibrary();
    if (view === 'snippets') renderSnippetLibrary();
    if (view === 'costs') { state.costProjectId = ''; loadCosts(); }
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
  $('#modeMusic').classList.toggle('active', mode === 'music');
  $('#modeComfyUI').classList.toggle('active', mode === 'comfyui');
  $('#imageControls').hidden = mode !== 'image';
  $('#videoControls').hidden = mode !== 'video';
  $('#audioControls').hidden = mode !== 'audio';
  $('#musicControls').hidden = mode !== 'music';
  $('#comfyuiControls').hidden = mode !== 'comfyui';
  const audioModel = (state.audioModels || []).find((model) => model.id === state.audioModelId);
  $('#tagPalette').hidden = mode !== 'audio' || audioModel?.supportsAudioTags === false;
  // el armador de tomas es propio del video
  $('#btnShotList').hidden = mode !== 'video';
  if (mode !== 'video') $('#shotListPanel').hidden = true;
  $('.editor-wrap').classList.toggle('tags-on', mode === 'image' || (mode === 'audio' && audioModel?.supportsAudioTags !== false) || mode === 'video');
  $('#promptBox').placeholder = mode === 'audio'
    ? (audioModel?.supportsAudioTags === false
      ? 'Escribí el texto a locutar… Multilingual v2 prioriza una narración estable'
      : 'Escribí el texto a locutar… usá [risas] o [whispers] para expresiones')
    : mode === 'video'
    ? 'Describí la escena en movimiento: acción, cámara, ambiente…'
    : mode === 'music'
    ? (state.music.customMode ? 'Escribí la LETRA de la canción (versos, estribillo)…' : 'Describí la canción: género, ánimo, instrumentos, tema…')
    : mode === 'comfyui'
    ? 'Escribí el prompt que va a recibir tu workflow de ComfyUI…'
    : 'Escribí lo que querés manifestar…';
  $('#btnGenerate').innerHTML = mode === 'audio' ? `${IC('mic')} Dar voz` : mode === 'video' ? `${IC('film')} Manifestar video` : mode === 'music' ? `${IC('music')} Componer` : mode === 'comfyui' ? `${IC('layers')} Manifestar (ComfyUI)` : `${IC('spark')} Manifestar`;
  if (mode === 'audio' && state.voices === null) loadVoices(false);
  if (mode === 'audio') renderAudioModelSelect();
  if (mode === 'video') renderVideoControls();
  if (mode === 'music') renderMusicControls();
  if (mode === 'image') renderRefs();
  if (mode === 'comfyui') { renderComfyControls(); refreshComfySlots(); }
  renderHighlight();
  renderPinnedHint();
  updateEstimate();
}

$('#modeImage').addEventListener('click', () => setMode('image'));
$('#modeVideo').addEventListener('click', () => setMode('video'));
$('#modeAudio').addEventListener('click', () => setMode('audio'));
$('#modeMusic').addEventListener('click', () => setMode('music'));
$('#modeComfyUI').addEventListener('click', () => setMode('comfyui'));

// ---------------------------------------------------------------------------
// controles de música (Suno)
// ---------------------------------------------------------------------------

function renderMusicControls() {
  const m = state.musicModel;
  if (!m) return;
  chipRow($('#musicModelChips'), m.versions, state.music.version, (v) => { state.music.version = v; renderMusicControls(); });
  $('#musicCustom').checked = state.music.customMode;
  $('#musicInstrumental').checked = state.music.instrumental;
  $('#musicStyle').value = state.music.style;
  $('#musicTitle').value = state.music.title;
  // en modo simple no hay estilo/título; en instrumental no hay letra en la caja
  $('#musicStyleRow').hidden = !state.music.customMode;
  $('#musicTitleRow').hidden = !state.music.customMode;
  $('#musicHint').textContent = state.music.customMode
    ? (state.music.instrumental ? 'Instrumental: la caja de arriba se ignora; definí estilo y título.' : 'La caja de arriba es la LETRA. Estilo y título son obligatorios.')
    : 'Modo simple: la caja de arriba es una descripción; Suno inventa letra y estilo.';
  $('#promptBox').placeholder = state.music.customMode
    ? 'Escribí la LETRA de la canción (versos, estribillo)…'
    : 'Describí la canción: género, ánimo, instrumentos, tema…';
}

$('#musicCustom').addEventListener('change', (e) => { state.music.customMode = e.target.checked; renderMusicControls(); updateEstimate(); });
$('#musicInstrumental').addEventListener('change', (e) => { state.music.instrumental = e.target.checked; renderMusicControls(); });
$('#musicStyle').addEventListener('input', (e) => { state.music.style = e.target.value; });
$('#musicTitle').addEventListener('input', (e) => { state.music.title = e.target.value; });

// ---------------------------------------------------------------------------
// controles de ComfyUI (puente a un workflow externo)
// ---------------------------------------------------------------------------

const COMFY_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const COMFY_RESOLUTIONS = ['1K', '2K', '4K'];
const COMFY_REF_SLOTS = {
  reference: { strip: '#comfyRefReference', title: 'Elegir imagen de referencia' },
  poseControlNet: { strip: '#comfyRefPoseControlNet', title: 'Elegir pose (ControlNet)' },
  poseIpAdapter: { strip: '#comfyRefPoseIpAdapter', title: 'Elegir face (IP-Adapter)' }
};
const COMFY_SLOT_LABELS = {
  prompt: 'Prompt', reference: 'Referencia', poseControlNet: 'Pose ControlNet', poseIpAdapter: 'Face IP-Adapter',
  resolution: 'Resolución', outputImage: 'Salida imagen', outputVideo: 'Salida video', outputAudio: 'Salida audio',
  customValues: 'Valores Personalizados'
};

function renderComfyControls() {
  if (state.comfyuiWorkflows.length && !state.comfyuiWorkflows.some((w) => w.id === state.comfyui.workflowId)) {
    state.comfyui.workflowId = state.comfyuiWorkflows[0].id;
  }
  $('#comfyLoopToggle').checked = state.comfyui.loop;
  chipRow($('#comfyWorkflowChips'), state.comfyuiWorkflows.map((w) => w.id), state.comfyui.workflowId,
    (id) => { state.comfyui.workflowId = id; renderComfyControls(); refreshComfySlots(); },
    (id) => state.comfyuiWorkflows.find((w) => w.id === id)?.name || id);
  const current = state.comfyuiWorkflows.find((w) => w.id === state.comfyui.workflowId);
  $('#comfyWorkflowDesc').textContent = current?.description || '';
  $('#comfyWorkflowEmpty').hidden = Boolean(state.comfyuiWorkflows.length);
  chipRow($('#comfyArChips'), COMFY_ASPECT_RATIOS, state.comfyui.aspectRatio,
    (v) => { state.comfyui.aspectRatio = v; renderComfyControls(); });
  chipRow($('#comfyResChips'), COMFY_RESOLUTIONS, state.comfyui.resolution,
    (v) => { state.comfyui.resolution = v; renderComfyControls(); });
  for (const slot of Object.keys(COMFY_REF_SLOTS)) renderComfyRefSlot(slot);
  $('#comfyReqReference').hidden = !current?.requiredRefs?.reference;
  $('#comfyReqPoseControlNet').hidden = !current?.requiredRefs?.poseControlNet;
  $('#comfyReqPoseIpAdapter').hidden = !current?.requiredRefs?.poseIpAdapter;
  renderComfyCustomValues();
  renderComfySlotsHint();
}

function missingComfyRequiredRefs() {
  const wf = state.comfyuiWorkflows.find((w) => w.id === state.comfyui.workflowId);
  const labels = { reference: 'Referencia', poseControlNet: 'Pose (ControlNet)', poseIpAdapter: 'Face (IP-Adapter)' };
  return Object.entries(wf?.requiredRefs || {})
    .filter(([slot, required]) => required && !state.comfyui.refs[slot])
    .map(([slot]) => labels[slot] || slot);
}

const COMFY_CV_MODES = [['fixed', 'Fijo'], ['increment', 'Auto +1'], ['random', 'Random']];

function renderComfyCustomValues() {
  const box = $('#comfyCustomValuesRow');
  const wf = state.comfyuiWorkflows.find((w) => w.id === state.comfyui.workflowId);
  const enabled = (wf?.customValues || []).map((cv, i) => ({ ...cv, i })).filter((cv) => cv.enabled);
  if (!enabled.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = enabled.map((cv) => {
    const st = state.comfyui.customValues[cv.i] || (state.comfyui.customValues[cv.i] = { mode: 'fixed', value: '' });
    return `<div class="comfy-cv-item">
      <label>${esc(cv.label || `Valor ${cv.i + 1}`)}</label>
      <input type="number" class="text-input" step="any" data-cv-value="${cv.i}" value="${esc(st.value)}" placeholder="0">
      <div class="chips comfy-cv-mode" data-cv-mode-group="${cv.i}">
        ${COMFY_CV_MODES.map(([mode, label]) => `<button type="button" class="chip${st.mode === mode ? ' active' : ''}" data-mode="${mode}">${label}</button>`).join('')}
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-cv-value]').forEach((inp) => {
    inp.addEventListener('input', () => { state.comfyui.customValues[inp.dataset.cvValue].value = inp.value; });
  });
  box.querySelectorAll('[data-cv-mode-group]').forEach((group) => {
    const idx = group.dataset.cvModeGroup;
    group.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.comfyui.customValues[idx].mode = btn.dataset.mode;
        group.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
  });
}

// Resuelve fijo/autoincremental/random a un número final por slot activo,
// justo antes de encolar. Random: entero entre 1 y el valor escrito (tope
// inclusive). Autoincremental: se manda el valor actual y se suma 1 después
// de encolar, para la próxima generación.
function resolveComfyCustomValues() {
  const wf = state.comfyuiWorkflows.find((w) => w.id === state.comfyui.workflowId);
  const values = {};
  const postIncrement = [];
  (wf?.customValues || []).forEach((cv, i) => {
    if (!cv.enabled) return;
    const st = state.comfyui.customValues[i];
    if (!st || st.value === '' || st.value === undefined) return;
    const typed = Number(st.value);
    if (!Number.isFinite(typed)) return;
    if (st.mode === 'random') {
      const bound = Math.max(1, Math.floor(typed));
      values[i] = Math.floor(Math.random() * bound) + 1;
    } else {
      values[i] = typed;
      if (st.mode === 'increment') postIncrement.push(i);
    }
  });
  return { values, postIncrement };
}

function applyComfyPostIncrement(postIncrement) {
  if (!postIncrement?.length) return;
  for (const i of postIncrement) {
    const st = state.comfyui.customValues[i];
    st.value = String((Number(st.value) || 0) + 1);
  }
  renderComfyCustomValues();
}

// Arma el body de una generación ComfyUI a partir del estado actual de la
// pestaña (no depende de state.mode) — lo usan tanto el botón "Manifestar"
// como la generación ininterrumpida, para no duplicar la lógica.
function buildComfyGenerationBody(prompt) {
  const comfyResolved = resolveComfyCustomValues();
  const body = {
    workflowId: state.comfyui.workflowId, prompt,
    aspectRatio: state.comfyui.aspectRatio, resolution: state.comfyui.resolution,
    refs: { ...state.comfyui.refs }, customValues: comfyResolved.values,
    genId: `comfyui-${Date.now()}-${Math.random().toString(16).slice(2)}`
  };
  return { body, postIncrement: comfyResolved.postIncrement };
}

function comfyJobLabel() {
  return `ComfyUI · ${state.comfyuiWorkflows.find((w) => w.id === state.comfyui.workflowId)?.name || 'workflow'} · ${state.comfyui.aspectRatio} · ${state.comfyui.resolution}`;
}

// Encola la siguiente vuelta de la generación ininterrumpida, con el mismo
// prompt de la vuelta anterior. Se llama sola cuando termina cada job
// marcado comfyLoop, mientras state.comfyui.loop siga activo.
function queueComfyLoopJob(prompt) {
  const { body, postIncrement } = buildComfyGenerationBody(prompt);
  applyComfyPostIncrement(postIncrement);
  const job = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: 'queued', prompt, createdAt: Date.now(),
    label: `${comfyJobLabel()} · ininterrumpida`,
    path: '/api/generate/comfyui', body,
    comfyLoop: true, loopPrompt: prompt
  };
  state.generationJobs.unshift(job);
  renderGenerationQueue();
  pumpGenerationQueue();
}

$('#comfyLoopToggle').addEventListener('change', (e) => {
  state.comfyui.loop = e.target.checked;
  if (!state.comfyui.loop) toast('Generación ininterrumpida desactivada — se corta después de la que esté corriendo');
});

function renderComfyRefSlot(slot) {
  const el = $(COMFY_REF_SLOTS[slot].strip);
  const key = state.comfyui.refs[slot];
  el.innerHTML = '';
  if (key) {
    const d = document.createElement('div');
    d.className = 'ref-thumb ref-image';
    d.innerHTML = `<img src="${fileUrl(key)}" alt=""><button class="rm" title="Quitar">×</button>`;
    d.querySelector('img').addEventListener('click', () => openLightbox(key, null, {
      refRemover: () => { state.comfyui.refs[slot] = null; renderComfyRefSlot(slot); return true; }
    }));
    d.querySelector('.rm').addEventListener('click', () => { state.comfyui.refs[slot] = null; renderComfyRefSlot(slot); });
    el.appendChild(d);
  } else {
    const add = document.createElement('button');
    add.className = 'ref-add';
    add.textContent = '+';
    add.title = 'Agregar imagen';
    add.addEventListener('click', () => openComfyPicker(slot));
    el.appendChild(add);
  }
}

function openComfyPicker(slot) {
  state.comfyPickerSlot = slot;
  openPicker(null);
  $('#pickerTitle').textContent = COMFY_REF_SLOTS[slot].title;
}

function renderComfySlotsHint() {
  const hint = $('#comfySlotsHint');
  if (!state.comfyui.workflowId) { hint.textContent = 'Agregá y elegí un workflow arriba (o creá uno nuevo en Configuración → ComfyUI).'; return; }
  const slots = state.comfyui.slots;
  if (!slots) { hint.textContent = 'No pude leer este workflow — revisá la ruta en Configuración → ComfyUI.'; return; }
  const found = Object.entries(slots).filter(([, n]) => n > 0).map(([k]) => COMFY_SLOT_LABELS[k] || k);
  hint.textContent = found.length ? `Nodos detectados: ${found.join(', ')}.` : 'Este workflow no tiene ningún nodo Tuzzi.';
}

async function refreshComfySlots() {
  if (!state.comfyui.workflowId) { state.comfyui.slots = null; renderComfySlotsHint(); return; }
  try {
    const r = await api(`/api/comfyui/scan?id=${encodeURIComponent(state.comfyui.workflowId)}`, { task: false });
    state.comfyui.slots = r.slots;
  } catch {
    state.comfyui.slots = null;
  }
  renderComfySlotsHint();
}

// --- biblioteca de workflows (Configuración → ComfyUI) ---

function renderComfyWorkflowsList() {
  const box = $('#comfyWorkflowsList');
  if (!state.comfyuiWorkflows.length) {
    box.innerHTML = '<div class="empty-note">Todavía no agregaste ningún workflow.</div>';
    return;
  }
  box.innerHTML = state.comfyuiWorkflows.map((wf) => `<div class="comfy-wf-item" data-id="${esc(wf.id)}">
    <div class="comfy-wf-main">
      <strong>${esc(wf.name)}</strong>
      ${wf.description ? `<span class="hint">${esc(wf.description)}</span>` : ''}
      <span class="hint">${esc(wf.path)}</span>
      <span class="hint comfy-wf-slots"></span>
    </div>
    <div class="comfy-wf-actions">
      <button type="button" class="mini-btn" data-act="scan">Detectar nodos</button>
      <button type="button" class="mini-btn" data-act="edit">Editar</button>
      <button type="button" class="mini-btn danger" data-act="delete">Borrar</button>
    </div>
  </div>`).join('');
  box.querySelectorAll('.comfy-wf-item').forEach((row) => {
    const id = row.dataset.id;
    const wf = state.comfyuiWorkflows.find((w) => w.id === id);
    row.querySelector('[data-act="scan"]').addEventListener('click', async () => {
      const slotsEl = row.querySelector('.comfy-wf-slots');
      slotsEl.textContent = 'Escaneando…';
      try {
        const r = await api(`/api/comfyui/scan?id=${encodeURIComponent(id)}`, { task: false });
        const found = Object.entries(r.slots).filter(([, n]) => n > 0).map(([k]) => COMFY_SLOT_LABELS[k] || k);
        slotsEl.textContent = found.length ? `Nodos: ${found.join(', ')}` : 'Sin nodos Tuzzi detectados';
      } catch (e) {
        slotsEl.textContent = `Error: ${e.message}`;
      }
    });
    row.querySelector('[data-act="edit"]').addEventListener('click', () => openComfyWorkflowForm(wf));
    row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Borrar el workflow "${wf.name}"?`)) return;
      await api(`/api/comfyui/workflows/${wf.id}`, { method: 'DELETE' });
      state.comfyuiWorkflows = state.comfyuiWorkflows.filter((x) => x.id !== wf.id);
      renderComfyWorkflowsList();
      if (state.comfyui.workflowId === wf.id) { state.comfyui.workflowId = ''; renderComfyControls(); }
    });
  });
}

let comfyWorkflowEditingId = null;

function renderComfyWorkflowCvForm(customValues = []) {
  const box = $('#comfyWorkflowCvRows');
  box.innerHTML = Array.from({ length: 5 }, (_, i) => {
    const cv = customValues[i] || {};
    return `<label class="comfy-cv-form-row">
      <input type="checkbox" data-cv-enabled="${i}" ${cv.enabled ? 'checked' : ''}>
      <input type="text" class="text-input" data-cv-label="${i}" maxlength="60" placeholder="Título (ej: Ip Adapter Weight)" value="${esc(cv.label || '')}" ${cv.enabled ? '' : 'disabled'}>
    </label>`;
  }).join('');
  box.querySelectorAll('[data-cv-enabled]').forEach((chk) => {
    chk.addEventListener('change', () => {
      box.querySelector(`[data-cv-label="${chk.dataset.cvEnabled}"]`).disabled = !chk.checked;
    });
  });
}

function readComfyWorkflowCvForm() {
  const box = $('#comfyWorkflowCvRows');
  return Array.from({ length: 5 }, (_, i) => ({
    enabled: box.querySelector(`[data-cv-enabled="${i}"]`).checked,
    label: box.querySelector(`[data-cv-label="${i}"]`).value.trim()
  }));
}

function openComfyWorkflowForm(wf = null) {
  comfyWorkflowEditingId = wf?.id || null;
  $('#comfyWorkflowFormName').value = wf?.name || '';
  $('#comfyWorkflowFormDesc').value = wf?.description || '';
  $('#comfyWorkflowFormPath').value = wf?.path || '';
  renderComfyWorkflowCvForm(wf?.customValues || []);
  $('#comfyWorkflowReqReference').checked = Boolean(wf?.requiredRefs?.reference);
  $('#comfyWorkflowReqPoseControlNet').checked = Boolean(wf?.requiredRefs?.poseControlNet);
  $('#comfyWorkflowReqPoseIpAdapter').checked = Boolean(wf?.requiredRefs?.poseIpAdapter);
  $('#comfyWorkflowFormRow').hidden = false;
  $('#comfyWorkflowCvFormRow').hidden = false;
  $('#comfyWorkflowReqRefsRow').hidden = false;
  $('#comfyWorkflowFormActions').hidden = false;
  $('#comfyWorkflowFormName').focus();
}
function closeComfyWorkflowForm() {
  comfyWorkflowEditingId = null;
  $('#comfyWorkflowFormRow').hidden = true;
  $('#comfyWorkflowCvFormRow').hidden = true;
  $('#comfyWorkflowReqRefsRow').hidden = true;
  $('#comfyWorkflowFormActions').hidden = true;
}
$('#btnAddComfyWorkflow').addEventListener('click', () => openComfyWorkflowForm());
$('#comfyWorkflowFormCancel').addEventListener('click', closeComfyWorkflowForm);
$('#comfyWorkflowFormSave').addEventListener('click', async () => {
  const name = $('#comfyWorkflowFormName').value.trim();
  const description = $('#comfyWorkflowFormDesc').value.trim();
  const path = $('#comfyWorkflowFormPath').value.trim();
  if (!path) return toast('Falta la ruta/URL del workflow', 'err');
  try {
    const body = {
      name, description, path, customValues: readComfyWorkflowCvForm(),
      requiredRefs: {
        reference: $('#comfyWorkflowReqReference').checked,
        poseControlNet: $('#comfyWorkflowReqPoseControlNet').checked,
        poseIpAdapter: $('#comfyWorkflowReqPoseIpAdapter').checked
      }
    };
    const saved = comfyWorkflowEditingId
      ? await api(`/api/comfyui/workflows/${comfyWorkflowEditingId}`, { method: 'PUT', body })
      : await api('/api/comfyui/workflows', { method: 'POST', body });
    state.comfyuiWorkflows = comfyWorkflowEditingId
      ? state.comfyuiWorkflows.map((w) => (w.id === saved.id ? saved : w))
      : [saved, ...state.comfyuiWorkflows];
    closeComfyWorkflowForm();
    renderComfyWorkflowsList();
    renderComfyControls();
    toast('Workflow guardado');
  } catch (e) {
    toast(e.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// resaltado de corchetes (modo audio)
// ---------------------------------------------------------------------------

const promptBox = $('#promptBox');
const highlighter = $('#highlighter');

function highlightReferenceMentions(text, mentions) {
  const values = [...new Set(mentions.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (!values.length) return esc(text);
  const pattern = values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const matcher = new RegExp(`(${pattern})`, 'giu');
  const wanted = new Set(values.map((value) => value.toLocaleLowerCase('es')));
  return text.split(matcher).map((part) => wanted.has(part.toLocaleLowerCase('es'))
    ? `<span class="tag">${esc(part)}</span>`
    : esc(part)).join('');
}

function renderHighlight() {
  const text = promptBox.value;
  if (state.mode === 'audio') {
    highlighter.innerHTML = esc(text).replace(/\[([^\]\n]{1,60})\]/g, '<span class="tag">[$1]</span>') + '\n';
  } else if (state.mode === 'image') {
    const mentions = state.refs.map((ref, index) => {
      const label = normalizeReferenceLabel(ref.label);
      return label ? `@${label}` : `@image${index + 1}`;
    });
    highlighter.innerHTML = highlightReferenceMentions(text, mentions) + '\n';
  } else if (state.mode === 'video' && videoModeAllowsMultimedia()) {
    const pattern = currentVideoModel()?.provider === 'omni'
      ? /<(?:IMAGE|VIDEO)_REF_\d+>/gi
      : /@(image|video|audio)\d+/gi;
    highlighter.innerHTML = esc(text).replace(pattern, '<span class="tag">$&</span>') + '\n';
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

function heygenWideAvatarId(character) {
  return character?.heygen?.wideAvatarId || character?.heygen?.avatarId || '';
}

function heygenMotionPromptFor(character, framing = 'wide') {
  const heygen = character?.heygen || {};
  const field = framing === 'close' ? 'closeMotionPrompt' : 'wideMotionPrompt';
  return Object.prototype.hasOwnProperty.call(heygen, field) ? (heygen[field] || '') : (heygen.motionPrompt || '');
}

function heygenCharacterReady(character) {
  return Boolean(heygenWideAvatarId(character));
}

function referenceKind(ref) {
  if (['image', 'video', 'audio'].includes(ref?.kind)) return ref.kind;
  const key = String(ref?.key || '');
  return key.startsWith('video/') ? 'video' : key.startsWith('audio/') ? 'audio' : 'image';
}

function supportsMultimediaVideoRefs(model = currentVideoModel()) {
  return Boolean(model?.supportsMultimediaReferences || model?.provider === 'minimax');
}

function videoModeAllowsMultimedia(model = currentVideoModel(), mode = state.video.mode) {
  if (!supportsMultimediaVideoRefs(model)) return false;
  return mode === 'reference' || (model?.provider === 'omni' && ['edit', 'extend'].includes(mode));
}

function typedVideoReferenceMention(model, kind, number) {
  const type = `${kind[0].toUpperCase()}${kind.slice(1)}`;
  if (model?.provider === 'omni') return `<${kind.toUpperCase()}_REF_${number - 1}>`;
  return model?.id === 'seedance-2-5' ? `@${type}${number}` : `${type} ${number}`;
}

function renderVideoControls() {
  const m = currentVideoModel();
  if (!m) return;
  const isHeyGen = m.provider === 'heygen';
  const isH3 = m.provider === 'minimax';
  const isOmni = m.provider === 'omni';
  const isSeedance25 = m.id === 'seedance-2-5';
  const multimediaRefs = supportsMultimediaVideoRefs(m);
  state.video.modelId = m.id;
  if (!m.aspectRatios.includes(state.video.aspectRatio)) state.video.aspectRatio = m.aspectRatios[0];
  if (!m.resolutions.includes(state.video.resolution)) state.video.resolution = m.resolutions[0];
  if (!m.durations.includes(state.video.duration)) state.video.duration = m.durations[0];
  if (state.refs.length > activeRefLimit()) state.refs = state.refs.slice(0, activeRefLimit());

  chipRow($('#videoModelChips'), state.videoModels.map((x) => x.id), m.id,
    (id) => {
      state.video.modelId = id;
      const next = state.videoModels.find((model) => model.id === id);
      if (next?.provider !== 'omni' && ['edit', 'extend'].includes(state.video.mode)) state.video.mode = 'reference';
      if (!supportsMultimediaVideoRefs(next)) state.refs = state.refs.filter((ref) => referenceKind(ref) === 'image');
      applyPinnedCharacterPhotos(); renderVideoControls();
    },
    (id) => state.videoModels.find((x) => x.id === id).name);
  const videoModes = isOmni ? ['reference', 'frames', 'edit', 'extend'] : ['reference', 'frames'];
  if (!videoModes.includes(state.video.mode)) state.video.mode = 'reference';
  chipRow($('#videoModeChips'), videoModes, state.video.mode,
    (v) => {
      state.video.mode = v;
      if (!['edit', 'extend'].includes(v)) {
        state.video.omniPreviousInteractionId = '';
        state.video.omniSourceHistoryId = '';
        state.video.omniChainDepth = 0;
        state.video.omniCumulativeDuration = 0;
      }
      renderVideoControls();
    },
    (v) => ({ reference: 'Referencias (@)', frames: 'Inicio → Fin', edit: 'Editar video', extend: 'Extender video' }[v]));
  $('#videoRefsHint').textContent = isHeyGen
    ? 'Usá una imagen JPG o PNG: puede venir de cualquier asset o personaje.'
    : isH3 && state.video.mode === 'reference'
    ? 'Citá las referencias como Image 1, Video 1 o Audio 1. Podés combinar estética, personaje, movimiento, cámara, voz y ritmo.'
    : isSeedance25 && state.video.mode === 'reference'
    ? 'Citá las referencias como @Image1, @Video1 o @Audio1. Podés combinar hasta 50 archivos entre imagen, video y audio.'
    : isOmni && state.video.mode === 'reference'
    ? 'Citá imágenes como <IMAGE_REF_0> y videos como <VIDEO_REF_0>. Hasta 6 imágenes y 3 clips de 3 segundos; el audio de esos clips se ignora.'
    : isOmni && state.video.mode === 'edit'
    ? (state.video.omniPreviousInteractionId ? 'Esta edición continúa el resultado Omni elegido. Podés sumar imágenes de referencia.' : 'Elegí un video de hasta 10 segundos. Pedí un cambio simple; Omni conservará lo demás.')
    : isOmni && state.video.mode === 'extend'
    ? (state.video.omniPreviousInteractionId ? 'Continúa la conversación elegida y agrega una toma al final, hasta 40 segundos acumulados.' : 'Elegí un video de hasta 10 segundos para generar una continuación al final.')
    : state.video.mode === 'reference'
    ? 'mencionalas en el prompt con @image1, @image2… (botón @ en cada miniatura)'
    : '1ª imagen = fotograma inicial · 2ª = final';
  $('#videoRefsLabel').textContent = multimediaRefs ? 'Referencias' : 'Imágenes';
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

  if (isH3) state.video.audio = true;
  $('#videoAudioRow').hidden = !m.audio;
  $('#videoAudio').checked = m.audio && state.video.audio;
  $('#videoAudio').disabled = isH3;
  $('#videoDurationRow').hidden = isHeyGen;
  $('#videoModeRow').hidden = isHeyGen;
  $('#videoAudioRow').hidden = isHeyGen || !m.audio;
  $('#heygenVideoControls').hidden = !isHeyGen;
  $('#h3VideoControls').hidden = !isH3;
  $('#omniVideoControls').hidden = !isOmni;
  if (isOmni) {
    const linked = ['edit', 'extend'].includes(state.video.mode) && Boolean(state.video.omniPreviousInteractionId);
    $('#omniChainHint').textContent = linked
      ? `Continuando una generación Omni · turno ${state.video.omniChainDepth + 1}${state.video.omniCumulativeDuration ? ` · ${state.video.omniCumulativeDuration}s actuales` : ''}.`
      : 'Nueva generación independiente; para continuidad elegí Editar o Extender desde un resultado del historial.';
    $('#omniClearConversation').hidden = !linked;
  }
  $('#h3ContextIr').checked = isH3 && state.video.h3ContextIr;
  $('#videoRefsStrip').closest('.control-row').hidden = isHeyGen && m.requiresRegisteredCharacter;
  $('#btnShotList').hidden = isHeyGen;
  if (isHeyGen) {
    state.video.mode = 'reference';
    const eligible = state.characters.filter(heygenCharacterReady);
    if (!eligible.some((character) => character.id === state.video.heygenCharacterId)) {
      state.video.heygenCharacterId = eligible[0]?.id || '';
    }
    $('#heygenCharacterRow').hidden = !m.requiresRegisteredCharacter;
    $('#heygenCharacterSelect').innerHTML = eligible.length
      ? eligible.map((character) => `<option value="${character.id}">${esc(character.name)} · HeyGen${character.heygen?.closeAvatarId ? ' · 2 planos' : ' · 1 plano'}</option>`).join('')
      : '<option value="">— no hay personajes HeyGen completos —</option>';
    $('#heygenCharacterSelect').value = state.video.heygenCharacterId;
    $('#heygenCharacterHint').textContent = eligible.length
      ? 'Sólo aparecen personajes con código de avatar. La imagen espejo es una referencia local opcional.'
      : 'Creá la variante HeyGen en Personajes para habilitar este modelo.';
    $('#heygenVoiceRow').hidden = false;
    $('#heygenMotionRow').hidden = !m.supportsMotion;
    $('#heygenAuthMode').value = state.video.heygenAuthMode;
    $('#heygenVoiceId').value = state.video.heygenVoiceId;
    $('#heygenMotionPrompt').value = state.video.heygenMotionPrompt;
    $('#heygenExpressiveness').value = state.video.heygenExpressiveness;
    $('#heygenVideoAuthStatus').textContent = state.video.heygenAuthMode === 'oauth'
      ? (state.heygenOAuth.connected ? 'OAuth conectado' : 'OAuth sin conectar; hacelo desde Configuración')
      : (state.config?.keys?.heygen ? 'API key configurada' : 'Falta guardar la API key');
    $('#promptBox').placeholder = 'Escribí el texto que dirá el avatar…';
  } else if (state.mode === 'video') {
    $('#promptBox').placeholder = 'Describí el video que querés manifestar…';
  }
  $('#videoModelNote').textContent = m.notes || '';
  renderRefs();
  updateEstimate();
}

$('#videoAudio').addEventListener('change', (e) => { state.video.audio = e.target.checked; });
$('#h3ContextIr').addEventListener('change', (e) => { state.video.h3ContextIr = e.target.checked; });
$('#omniClearConversation').addEventListener('click', () => {
  state.video.omniPreviousInteractionId = '';
  state.video.omniSourceHistoryId = '';
  state.video.omniChainDepth = 0;
  state.video.omniCumulativeDuration = 0;
  renderVideoControls();
});
$('#heygenAuthMode').addEventListener('change', (e) => { state.video.heygenAuthMode = e.target.value; renderVideoControls(); });
$('#heygenCharacterSelect').addEventListener('change', (e) => { state.video.heygenCharacterId = e.target.value; });
$('#heygenVoiceId').addEventListener('input', (e) => { state.video.heygenVoiceId = e.target.value.trim(); });
$('#heygenMotionPrompt').addEventListener('input', (e) => { state.video.heygenMotionPrompt = e.target.value; });
$('#heygenExpressiveness').addEventListener('change', (e) => { state.video.heygenExpressiveness = e.target.value; });

function normalizeReferenceLabel(value) {
  return String(value || '').trim().replace(/^@+/, '').replace(/\s+/g, ' ').slice(0, 100);
}

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
    r.label = normalizeReferenceLabel(r.label);
    const isAsset = r.key.startsWith('asset://');
    const kind = referenceKind(r);
    const videoModel = isVideo ? currentVideoModel() : null;
    const typedMultimedia = isVideo && videoModeAllowsMultimedia(videoModel, refMode);
    const typeNumber = state.refs.slice(0, i + 1).filter((ref) => referenceKind(ref) === kind).length;
    const d = document.createElement('div');
    d.className = `ref-thumb ref-${kind}` + (r.fromChar ? ' from-char' : '') + (isAsset ? ' verified-asset' : '');
    // cómo se cita esta ref en el prompt: en video Seedance exige @imageN;
    // en imagen se cita por su etiqueta (si tiene) para decirle quién es quién
    const typedMention = typedVideoReferenceMention(videoModel, kind, typeNumber);
    const mention = typedMultimedia && refMode === 'reference' ? typedMention : refMode === 'reference' || !r.label ? `@image${i + 1}` : `@${r.label}`;
    const badge = typedMultimedia && refMode === 'reference' ? `<button class="ref-at" title="Insertar ${typedMention} en el prompt">${kind === 'image' ? 'IMG' : kind === 'video' ? 'VID' : 'AUD'} ${typeNumber}</button>`
      : refMode === 'reference' ? `<button class="ref-at" title="Insertar @image${i + 1} en el prompt">@${i + 1}</button>`
      : refMode === 'frames' ? `<span class="ref-badge">${i === 0 ? 'inicio' : 'fin'}</span>`
      : !isVideo && !isAsset ? `<button class="ref-at" title="Insertar ${esc(mention)} en el prompt">${esc(mention)}</button>`
      : '';
    d.innerHTML = isAsset
      ? `<div class="asset-face" title="${esc(r.key)}">${IC('user', 'ic ic-lg')}<span>verificado</span></div>${badge}<button class="rm" title="Quitar">×</button>`
      : `${kind === 'video' ? `<video src="${fileUrl(r.key)}" muted preload="metadata"></video>`
        : kind === 'audio' ? `<div class="asset-face" title="${esc(r.key)}">${IC('mic', 'ic ic-lg')}<span>audio</span></div>`
          : `<img src="${fileUrl(r.key)}" alt="">`}${kind === 'image' && r.label ? `<span class="ref-label-tag" title="La IA verá este texto sobre la imagen">${esc(r.label)}</span>` : ''}${badge}<button class="rm" title="Quitar">×</button>${kind === 'image' ? `<button class="ref-replace" title="Reemplazar imagen (conserva su posición y cita)">${IC('refresh')}</button><button class="ref-label-btn${r.label ? ' on' : ''}" title="${r.label ? `Etiqueta: ${esc(r.label)}` : 'Etiquetar para la IA (quién es quién)'}">T</button>` : ''}`;
    d.querySelector('.rm').addEventListener('click', () => {
      state.refs.splice(i, 1);
      renderRefs();
      renderHighlight();
    });
    d.querySelector('.ref-replace')?.addEventListener('click', () => openPicker(i));
    d.querySelector('.ref-label-btn')?.addEventListener('click', () => {
      const value = window.prompt(
        'Texto que la IA verá sobreimpreso en esta referencia (solo en la petición, la imagen no se modifica). Vacío = sin etiqueta:',
        r.label || refLabelSuggestion(r.key)
      );
      if (value === null) return;
      r.label = normalizeReferenceLabel(value);
      renderRefs();
      renderHighlight();
    });
    d.querySelector('.ref-at')?.addEventListener('click', () => insertAtCursor(`${mention} `));
    const refRemover = (key) => {
      const idx = state.refs.findIndex((ref) => ref.key === key);
      if (idx === -1) return false;
      state.refs.splice(idx, 1);
      renderRefs();
      renderHighlight();
      return true;
    };
    d.querySelector('img')?.addEventListener('click', () => openLightbox(r.key, state.refs.filter((ref) => !ref.key.startsWith('asset://')).map((ref) => ref.key), { refRemover }));
    d.querySelector('video')?.addEventListener('click', () => openLightbox(r.key, state.refs.filter((ref) => referenceKind(ref) === 'video').map((ref) => ref.key), { refRemover }));
    strip.appendChild(d);
  });
  if (state.refs.length < maxRefs) {
    const add = document.createElement('button');
    add.className = 'ref-add';
    add.textContent = '+';
    add.title = isVideo && videoModeAllowsMultimedia()
      ? `Agregar imagen${(currentVideoModel()?.mediaLimits?.video || 0) > 0 ? ', video' : ''}${(currentVideoModel()?.mediaLimits?.audio || 0) > 0 ? ' o audio' : ''} de referencia para ${currentVideoModel().name}`
      : 'Agregar imagen de referencia';
    add.addEventListener('click', () => openPicker());
    strip.appendChild(add);
  }
}

function addRef(key, fromChar = false, kind = 'image') {
  const m = activeRefModel();
  const maxRefs = activeRefLimit();
  const normalizedKind = ['image', 'video', 'audio'].includes(kind) ? kind : 'image';
  const isMultimediaReference = state.mode === 'video' && videoModeAllowsMultimedia();
  if (state.refs.some((r) => r.key === key)) return false;
  if (normalizedKind !== 'image' && !isMultimediaReference) {
    toast('Este modo sólo admite imágenes como referencia.', 'err');
    return false;
  }
  if (state.refs.length >= maxRefs) {
    toast(`${m.name} admite hasta ${maxRefs} referencia(s) en este modo`, 'err');
    return false;
  }
  if (isMultimediaReference) {
    const mediaLimit = m.mediaLimits?.[normalizedKind];
    const kindCount = state.refs.filter((ref) => referenceKind(ref) === normalizedKind).length;
    if (mediaLimit != null && kindCount >= mediaLimit) {
      const label = normalizedKind === 'image' ? 'imágenes' : normalizedKind === 'video' ? 'videos' : 'audios';
      toast(`${m.name} admite hasta ${mediaLimit} ${label} de referencia.`, 'err');
      return false;
    }
  }
  // las fotos de personajes llevan siempre el nombre como etiqueta (editable con T)
  state.refs.push({ key, fromChar, kind: normalizedKind, label: normalizedKind === 'image' ? normalizeReferenceLabel(refLabelSuggestion(key)) : '' });
  renderRefs();
  return true;
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
    const label = normalizeReferenceLabel(r.label);
    if (referenceKind(r) !== 'image' || !label || r.key.startsWith('asset://')) continue;
    try {
      out[r.key] = await stampLabel(r.key, label);
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
    // alfabético por nombre, para encontrarlas más fácil en el selector
    state.voices = (voices || []).sort((a, b) => byName(a.name, b.name));
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

function renderAudioModelSelect() {
  const select = $('#audioModelSelect');
  if (!select) return;
  const models = state.audioModels || [];
  const selected = models.find((model) => model.id === state.audioModelId) || models[0];
  if (selected) state.audioModelId = selected.id;
  select.innerHTML = models.map((model) =>
    `<option value="${esc(model.id)}"${model.id === state.audioModelId ? ' selected' : ''}>${esc(model.name)}</option>`
  ).join('');
  $('#audioModelHint').textContent = selected?.notes || '';
}

$('#voiceSelect').addEventListener('change', (e) => { state.voiceId = e.target.value; });
$('#btnReloadVoices').addEventListener('click', () => loadVoices(true));
$('#audioModelSelect').addEventListener('change', async (event) => {
  const previous = state.audioModelId;
  state.audioModelId = event.target.value;
  setMode('audio');
  try {
    state.config = await api('/api/config', { method: 'PUT', body: { audioModelId: state.audioModelId } });
    updateEstimate();
  } catch (error) {
    state.audioModelId = previous;
    setMode('audio');
    toast(error.message, 'err');
  }
});

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
  const videoModel = state.mode === 'video' ? currentVideoModel() : null;
  if (videoModel?.provider === 'heygen') {
    if (videoModel.requiresRegisteredCharacter) {
      if (heygenCharacterReady(pc)) state.video.heygenCharacterId = pc.id;
      return;
    }
    const key = pc.heygen?.imageKey || pc.photos?.[0];
    if (key && state.refs.length < activeRefLimit()) state.refs.push({ key, fromChar: true, label: pc.name });
    return;
  }
  // Los personajes reales verificados se conservan como assets privados de
  // ModelArk cuando el modelo de video pertenece a Seedance.
  if (state.mode === 'video' && videoModel?.provider === 'seedance' && pc.arkAssetId) {
    if (state.refs.length < activeRefLimit()) state.refs.push({ key: `asset://${pc.arkAssetId}`, fromChar: true });
    return;
  }
  if (supportsMultimediaVideoRefs(videoModel)) {
    const variant = (pc.variants || []).find((v) => v.id === state.characterVariantId);
    const photos = variant?.photos?.length ? variant.photos : pc.photos;
    const currentImages = state.refs.filter((ref) => referenceKind(ref) === 'image').length;
    const availableImages = Math.max(0, Math.min(
      activeRefLimit() - state.refs.length,
      (videoModel.mediaLimits?.image || 9) - currentImages
    ));
    for (const photo of photos.slice(0, availableImages)) {
      state.refs.push({ key: photo, fromChar: true, kind: 'image', label: pc.name });
    }
    return;
  }
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
    : state.mode === 'video' && currentVideoModel()?.provider === 'seedance' && pc.arkAssetId
    ? `${pc.name}: va como rostro real verificado (asset de ModelArk)`
    : state.mode === 'video' && supportsMultimediaVideoRefs()
    ? `${pc.name}: sus fotos locales van como referencias de ${currentVideoModel().name}`
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

// recuerda en qué serie/guion/toma quedó el panel, para no re-navegar cada vez
function loadShotPanel() {
  try { return JSON.parse(localStorage.getItem('shotPanelState') || '{}'); } catch { return {}; }
}
function saveShotPanel() {
  try {
    localStorage.setItem('shotPanelState', JSON.stringify({
      seriesId: $('#shotPanelSeries').value,
      scriptId: $('#shotPanelScript').value,
      shot: $('#shotPanelShot').value
    }));
  } catch { /* localStorage no disponible */ }
}
function restoreSelect(sel, value) {
  if (value && [...sel.options].some((o) => o.value === value)) sel.value = value;
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
  restoreSelect(sel, loadShotPanel().seriesId);
  renderShotPanelScripts();
}

function renderShotPanelScripts() {
  const sel = $('#shotPanelScript');
  sel.innerHTML = shotPanelScripts().map((sc) => `<option value="${sc.id}">${esc(sc.title)}</option>`).join('');
  restoreSelect(sel, loadShotPanel().scriptId);
  renderShotPanelShots();
}

function renderShotPanelShots() {
  const sc = state.scripts.find((x) => x.id === $('#shotPanelScript').value);
  const options = [];
  (sc?.scenes || []).forEach((scene, si) => scene.shots.forEach((shot, hi) => {
    options.push(`<option value="${si}:${hi}">Plano ${si + 1}.${hi + 1} — ${esc((scene.location || 'Sin locación').slice(0, 40))}</option>`);
  }));
  $('#shotPanelShot').innerHTML = options.join('');
  restoreSelect($('#shotPanelShot'), loadShotPanel().shot);
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
  saveShotPanel(); // recuerda esta serie/guion/toma para la próxima vez
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
  const isImage = state.mode === 'image';
  const isVideo = state.mode === 'video';
  const isMusic = state.mode === 'music';
  const isComfy = state.mode === 'comfyui';
  // validación del prompt según el modo (en música instrumental no hay letra)
  if (isMusic) {
    const mm = state.music;
    if (mm.customMode && !mm.style.trim()) return toast('Poné un estilo/género para la canción', 'err');
    if (mm.customMode && !mm.title.trim()) return toast('Poné un título para la canción', 'err');
    if (mm.customMode && !mm.instrumental && !prompt) return toast('Escribí la letra (o activá instrumental)', 'err');
    if (!mm.customMode && !prompt) return toast('Describí la canción', 'err');
  } else if (!prompt) {
    return toast('Escribí un prompt primero', 'err');
  }
  if (isComfy && !state.comfyui.workflowId) return toast('Elegí un workflow de ComfyUI primero', 'err');
  if (isComfy) {
    const missing = missingComfyRequiredRefs();
    if (missing.length) return toast(`Este workflow requiere: ${missing.join(', ')}`, 'err');
  }
  const pc = pinnedChar();
  const voiceId = state.voiceId || pc?.voiceId;
  const voice = (state.voices || []).find((v) => v.id === voiceId);
  const audioModel = (state.audioModels || []).find((candidate) => candidate.id === state.audioModelId) || state.audioModels?.[0];
  const model = isVideo ? currentVideoModel() : currentModel();
  const isHeyGen = isVideo && model?.provider === 'heygen';
  const isH3 = isVideo && model?.provider === 'minimax';
  const isOmni = isVideo && model?.provider === 'omni';
  const isSeedance25 = isVideo && model?.id === 'seedance-2-5';
  if (isImage && state.refs.length < (model?.minRefs || 0)) {
    return toast(`${model.name} necesita al menos ${model.minRefs} imagen(es) de referencia`, 'err');
  }
  if (isHeyGen && model.requiresRegisteredCharacter) {
    const character = state.characters.find((item) => item.id === state.video.heygenCharacterId);
    if (!heygenCharacterReady(character)) {
      return toast('Este modelo necesita un personaje con variante HeyGen completa', 'err');
    }
  }
  if (isHeyGen && !model.requiresRegisteredCharacter) {
    if (state.refs.length !== 1 || state.refs[0].key.startsWith('asset://')) return toast('Elegí exactamente una imagen', 'err');
    if (!state.video.heygenVoiceId.trim()) return toast('Pegá el código de una voz de HeyGen', 'err');
  }
  if (isHeyGen && state.video.heygenAuthMode === 'oauth' && !state.heygenOAuth.connected) return toast('Conectá HeyGen OAuth desde Configuración', 'err');
  if (isHeyGen && state.video.heygenAuthMode === 'key' && !state.config?.keys?.heygen) return toast('Guardá la API key de HeyGen en Configuración', 'err');
  if (isH3 && !state.config?.keys?.minimax) return toast('Guardá la API key de MiniMax en Configuración', 'err');
  if (isOmni && !state.config?.keys?.gemini) return toast('Guardá la API key de Gemini en Configuración', 'err');
  if (isSeedance25 && !state.config?.keys?.ark) return toast('Guardá la API key de BytePlus ModelArk en Configuración', 'err');
  if (isH3) {
    const counts = state.refs.reduce((out, ref) => {
      out[referenceKind(ref)] += 1;
      return out;
    }, { image: 0, video: 0, audio: 0 });
    if (state.video.mode === 'frames' && (counts.video || counts.audio)) return toast('Inicio → Fin sólo admite imágenes.', 'err');
    if (counts.image > 9 || counts.video > 3 || counts.audio > 3 || state.refs.length > 12) return toast('H3 admite 9 imágenes, 3 videos y 3 audios; máximo 12 referencias.', 'err');
    if (state.video.mode === 'reference' && counts.audio && !counts.image && !counts.video) return toast('El audio H3 necesita al menos una imagen o video de referencia.', 'err');
  }
  if (isSeedance25) {
    const counts = state.refs.reduce((out, ref) => {
      out[referenceKind(ref)] += 1;
      return out;
    }, { image: 0, video: 0, audio: 0 });
    if (state.video.mode === 'frames' && (counts.video || counts.audio)) return toast('Inicio → Fin sólo admite imágenes.', 'err');
    if (counts.image > 30 || counts.video > 10 || counts.audio > 10 || state.refs.length > 50) return toast('Seedance 2.5 admite 30 imágenes, 10 videos y 10 audios; máximo 50 referencias.', 'err');
  }
  if (isOmni) {
    const counts = state.refs.reduce((out, ref) => {
      out[referenceKind(ref)] += 1;
      return out;
    }, { image: 0, video: 0, audio: 0 });
    if (counts.audio) return toast('Gemini Omni todavía no admite audio subido como referencia.', 'err');
    if (counts.image > 6 || counts.video > 3 || state.refs.length > 9) return toast('Gemini Omni admite hasta 6 imágenes y 3 clips de referencia.', 'err');
    if (state.video.mode === 'frames' && (counts.image !== 2 || counts.video)) return toast('Inicio → Fin de Omni necesita exactamente dos imágenes.', 'err');
    if (['edit', 'extend'].includes(state.video.mode) && !state.video.omniPreviousInteractionId && counts.video !== 1) {
      return toast(`${state.video.mode === 'edit' ? 'Editar' : 'Extender'} necesita un video de origen o un resultado Omni elegido desde el historial.`, 'err');
    }
    if (state.video.mode === 'extend' && state.video.omniPreviousInteractionId
      && state.video.omniCumulativeDuration + state.video.duration > 40) {
      return toast('Esta extensión superaría el máximo acumulado de 40 segundos de Omni.', 'err');
    }
  }
  if (isVideo && !isHeyGen && state.video.mode === 'frames' && state.refs.length !== 2) {
    return toast('Inicio → Fin necesita exactamente dos imágenes: la primera es entrada y la segunda es salida.', 'err');
  }
  // las etiquetas se estampan acá, sobre copias: el asset guardado queda limpio
  const refsUsed = isImage ? state.refs : isVideo ? state.refs.slice(0, activeRefLimit()) : [];
  const labeledRefs = !supportsMultimediaVideoRefs(model) && !(isVideo && state.video.mode === 'frames') && refsUsed.some((r) => r.label)
    ? await buildLabeledRefs(refsUsed) : {};
  const comfyBuild = isComfy ? buildComfyGenerationBody(prompt) : null;
  const job = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: 'queued', prompt, createdAt: Date.now(),
    label: isImage ? `${model.name} · ${state.resolution} · ×${state.batch}`
      : isVideo ? `${model.name} · ${state.video.resolution}${isHeyGen ? '' : ` · ${state.video.duration}s`}`
      : isMusic ? `Suno ${state.music.version}${state.music.instrumental ? ' · instrumental' : ''}`
      : isComfy ? comfyJobLabel()
      : `${audioModel?.name || 'ElevenLabs'} · ${voice?.name || pc?.voiceName || 'voz'}`,
    path: isImage ? '/api/generate/image' : isVideo ? '/api/generate/video' : isMusic ? '/api/generate/music' : isComfy ? '/api/generate/comfyui' : '/api/generate/audio',
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
      refKinds: state.refs.slice(0, activeRefLimit()).map(referenceKind),
      h3ContextIr: isH3 && state.video.h3ContextIr,
      omniPreviousInteractionId: isOmni && ['edit', 'extend'].includes(state.video.mode) ? state.video.omniPreviousInteractionId : '',
      omniSourceHistoryId: isOmni && ['edit', 'extend'].includes(state.video.mode) ? state.video.omniSourceHistoryId : '',
      characterId: state.pinnedId || null,
      heygenAuthMode: state.video.heygenAuthMode,
      heygenCharacterId: state.video.heygenCharacterId,
      heygenVoiceId: state.video.heygenVoiceId,
      heygenMotionPrompt: state.video.heygenMotionPrompt,
      heygenExpressiveness: state.video.heygenExpressiveness
    } : isMusic ? {
      model: state.music.version, prompt,
      style: state.music.style, title: state.music.title,
      instrumental: state.music.instrumental, customMode: state.music.customMode
    } : isComfy ? comfyBuild.body : {
      text: prompt,
      audioModelId: audioModel?.id || state.audioModelId,
      voiceId,
      voiceName: voice?.name || pc?.voiceName || '',
      characterId: state.pinnedId || null
    }
  };
  if (isHeyGen) job.body.idempotencyKey = job.id;
  if (isComfy && state.comfyui.loop) { job.comfyLoop = true; job.loopPrompt = prompt; }
  state.generationJobs.unshift(job);
  renderGenerationQueue();
  pumpGenerationQueue();
  if (isComfy) applyComfyPostIncrement(comfyBuild.postIncrement);
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
  let progressTimer = null;
  if (job.body?.genId) {
    progressTimer = setInterval(async () => {
      try {
        const p = await api(`/api/generate/progress?id=${encodeURIComponent(job.body.genId)}`, { task: false });
        if (p.total > 0) { job.progress = p; renderGenerationQueue(); }
      } catch {}
    }, 700);
  }
  try {
    const entry = await api(job.path, { method: 'POST', body: job.body });
    job.status = 'done'; job.entry = entry; job.finishedAt = Date.now();
    // Un workflow de ComfyUI con más de un nodo de salida (ej. imagen + audio
    // en el mismo grafo) devuelve entradas hermanas ya guardadas en el
    // historial del servidor — hay que sumarlas acá también.
    if (entry.siblingEntries?.length) state.history.unshift(...entry.siblingEntries);
    state.history.unshift(entry);
    if (entry.type === 'image' && entry.characterId) {
      for (const key of entry.outputs) state.assetLinks.unshift({ key, characterId: entry.characterId, variantId: entry.characterVariantId || null, ts: entry.ts });
      renderCharacters();
    }
    showEntry(entry);
    renderHistory();
    const costTxt = entry.cost ? ` — $${entry.cost.toFixed(3)}` : '';
    if (entry.errors?.length) toast(`Listo, pero ${entry.errors.length} del lote fallaron: ${entry.errors[0]}`, 'err');
    else if (job.kind === 'h3-promotion') toast(`Versión MiniMax H3 2K terminada${costTxt}`);
    else toast(`Manifestado${costTxt}`);
  } catch (e) {
    job.status = 'error'; job.error = e.message; job.finishedAt = Date.now();
    if (job.kind === 'h3-promotion' && state.currentEntry?.id === job.body?.historyId) {
      showEntry(state.currentEntry);
    }
    toast(e.message, 'err');
    if (job.comfyLoop && state.comfyui.loop) {
      state.comfyui.loop = false;
      $('#comfyLoopToggle').checked = false;
      toast('Generación ininterrumpida detenida por un error', 'err');
    }
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    job.progress = null;
    state.activeGenerations -= 1;
    renderGenerationQueue();
    pumpGenerationQueue();
    if (job.status === 'done' && job.comfyLoop && state.comfyui.loop) queueComfyLoopJob(job.loopPrompt);
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
      <div class="job-main">
        <div class="job-title">${esc(job.label)}${job.progress?.total ? ` · paso ${job.progress.current}/${job.progress.total}` : ''}</div>
        ${job.progress?.total ? `<div class="job-progress-bar"><div style="width:${Math.min(100, Math.round(job.progress.current / job.progress.total * 100))}%"></div></div>` : ''}
        <div class="job-prompt ${job.status === 'error' ? 'job-error' : ''}">${esc(job.error || job.prompt)}</div>
      </div>
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

function existingH3Promotion(sourceId) {
  return state.history.find((item) => (
    item.modelId === 'minimax-h3'
    && item.resolution === '2K'
    && item.h3RegeneratedFrom === sourceId
  ));
}

function activeH3PromotionJob(sourceId) {
  return state.generationJobs.find((job) => (
    job.kind === 'h3-promotion'
    && job.body?.historyId === sourceId
    && ['queued', 'running'].includes(job.status)
  ));
}

function h3PromotionAction(entry) {
  if (entry.modelId !== 'minimax-h3' || entry.resolution !== '768P') return '';
  if (existingH3Promotion(entry.id)) {
    return `<button class="mini-btn accent" data-act="h3-2k-view">${IC('spark')} Ver versión 2K</button>`;
  }
  if (activeH3PromotionJob(entry.id)) {
    return `<button class="mini-btn accent" disabled>${IC('spark')} Promoción a 2K en curso…</button>`;
  }
  return `<button class="mini-btn accent" data-act="h3-2k">${IC('spark')} Promover a 2K</button>`;
}

function omniHistoryActions(entry) {
  if (entry.type !== 'video') return '';
  const canUseUploaded = Number(entry.duration) > 0 && Number(entry.duration) <= 10.01;
  const canContinue = entry.modelId === 'gemini-omni-1-1-flash' && Boolean(entry.omniInteractionId);
  if (!canUseUploaded && !canContinue) return '';
  const cumulative = Number(entry.omniCumulativeDuration) || Number(entry.duration) || 0;
  return `<button class="mini-btn accent" data-act="omni-edit">${IC('edit')} Editar con Omni</button>
    ${canContinue && cumulative >= 40 ? '' : `<button class="mini-btn accent" data-act="omni-extend">${IC('right')} Extender con Omni</button>`}`;
}

function loadVideoIntoOmni(entry, mode) {
  const canContinue = entry.modelId === 'gemini-omni-1-1-flash' && Boolean(entry.omniInteractionId);
  if (!canContinue && Number(entry.duration) > 10.01) {
    toast('Para subirlo a Omni, el video de origen debe durar como máximo 10 segundos.', 'err');
    return;
  }
  setMode('video');
  state.video.modelId = 'gemini-omni-1-1-flash';
  state.video.mode = mode;
  state.video.aspectRatio = ['16:9', '9:16'].includes(entry.aspectRatio) ? entry.aspectRatio : '16:9';
  state.video.resolution = ['360p', '720p', '1080p', '4K'].includes(entry.resolution) ? entry.resolution : '720p';
  state.video.duration = mode === 'extend' ? 10 : Math.max(3, Math.min(10, Number(entry.duration) || 5));
  state.video.audio = true;
  state.video.omniPreviousInteractionId = canContinue ? entry.omniInteractionId : '';
  state.video.omniSourceHistoryId = canContinue ? entry.id : '';
  state.video.omniChainDepth = Number(entry.omniChainDepth) || 0;
  state.video.omniCumulativeDuration = Number(entry.omniCumulativeDuration) || Number(entry.duration) || 0;
  state.refs = canContinue ? [] : [{ key: entry.outputs[0], fromChar: false, kind: 'video', label: '' }];
  promptBox.value = '';
  renderVideoControls();
  renderHighlight();
  goToCreate();
  promptBox.focus();
  toast(mode === 'edit' ? 'Video preparado para una edición conversacional con Omni' : 'Video preparado para extender con Omni');
}

function queueH3Promotion(entry) {
  const existing = existingH3Promotion(entry.id);
  if (existing) {
    showEntry(existing);
    toast('La versión MiniMax H3 2K ya existe');
    return;
  }
  if (activeH3PromotionJob(entry.id)) {
    toast('La promoción a 2K ya está en la cola');
    return;
  }
  if (!confirm('¿Crear la versión 2K aprobada de este video H3? La regeneración cuesta USD 0,05 por segundo, más las referencias facturables.')) return;
  // La confirmación puede dejar pasar tiempo suficiente para que otra vista o
  // acción haya encolado la misma promoción; comprobamos una vez más.
  if (existingH3Promotion(entry.id) || activeH3PromotionJob(entry.id)) {
    toast('La promoción a 2K ya está en la cola');
    return;
  }

  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.generationJobs.unshift({
    id: jobId,
    kind: 'h3-promotion',
    status: 'queued',
    prompt: entry.prompt,
    createdAt: Date.now(),
    label: `MiniMax H3 · ${entry.resolution} → 2K`,
    path: '/api/generate/video/h3-regenerate-2k',
    body: { historyId: entry.id, idempotencyKey: jobId }
  });
  renderGenerationQueue();
  pumpGenerationQueue();
  showEntry(entry);
  toast('Promoción a 2K añadida a la cola');
}

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
      <div class="bv-meta">${esc(entry.voiceName || 'voz')} · ${esc(entry.modelName || 'ElevenLabs')} · ${fmtDate(entry.ts)}${entry.durationMs ? ` · tardó ${fmtDuration(entry.durationMs)}` : ''}</div>
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
      <div class="bv-meta">${esc(entry.modelName)} · ${entry.aspectRatio} · ${entry.resolution} · ${entry.duration}s${entry.audio ? ' · con audio' : ''} · ${fmtDate(entry.ts)}${entry.durationMs ? ` · tardó ${fmtDuration(entry.durationMs)}` : ''}</div>
      <div class="bv-actions">
        <button class="mini-btn" data-act="copy">${IC('copy')} Copiar prompt</button>
        <button class="mini-btn" data-act="regen">${IC('refresh')} Regenerar</button>
        ${h3PromotionAction(entry)}
        ${omniHistoryActions(entry)}
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
      <div class="bv-meta">${esc(entry.modelName)} · ${entry.aspectRatio} · ${entry.resolution}${entry.batch > 1 ? ` · lote ×${entry.batch}` : ''} · ${fmtDate(entry.ts)}${entry.durationMs ? ` · tardó ${fmtDuration(entry.durationMs)}` : ''}</div>
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
    b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'regen') regenerate(entry);
      if (act === 'copy') copyPrompt(entry.prompt);
      if (act === 'edit') editEntry(entry);
      if (act === 'ref') { addRef(entry.outputs[state.currentOutput]); toast('Agregada como referencia'); }
      if (act === 'character') openCharModal(null, entry.outputs[state.currentOutput]);
      if (act === 'h3-2k') queueH3Promotion(entry);
      if (act === 'omni-edit') loadVideoIntoOmni(entry, 'edit');
      if (act === 'omni-extend') loadVideoIntoOmni(entry, 'extend');
      if (act === 'h3-2k-view') {
        const upgraded = existingH3Promotion(entry.id);
        if (upgraded) showEntry(upgraded);
      }
    });
  });
}

async function regenerate(entry) {
  promptBox.value = entry.prompt;
  renderHighlight();
  if (entry.type === 'audio') {
    if ((state.audioModels || []).some((model) => model.id === entry.modelId)) state.audioModelId = entry.modelId;
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
    state.video.h3ContextIr = entry.h3ContextIr === true;
    state.video.omniPreviousInteractionId = entry.omniPreviousInteractionId || '';
    state.video.omniSourceHistoryId = entry.omniSourceHistoryId || '';
    state.video.omniChainDepth = Math.max(0, (Number(entry.omniChainDepth) || 0) - (entry.omniPreviousInteractionId ? 1 : 0));
    state.video.omniCumulativeDuration = entry.mode === 'extend'
      ? Math.max(0, (Number(entry.omniCumulativeDuration) || 0) - (Number(entry.duration) || 0))
      : Number(entry.omniCumulativeDuration) || 0;
    state.refs = (entry.refs || []).map((k, index) => ({ key: k, fromChar: false, kind: entry.refKinds?.[index] }));
    renderVideoControls();
  } else {
    setMode('image');
    state.modelId = entry.modelId;
    state.aspectRatio = entry.aspectRatio;
    state.resolution = entry.resolution;
    state.batch = entry.batch || 1;
    state.video.h3ContextIr = entry.h3ContextIr === true;
    state.refs = (entry.refs || []).map((k, index) => ({ key: k, fromChar: false, kind: entry.refKinds?.[index] }));
    renderImageControls();
  }
  goToCreate();
  await generate();
}

function editEntry(entry) {
  promptBox.value = entry.prompt;
  if (entry.type === 'audio') {
    if ((state.audioModels || []).some((model) => model.id === entry.modelId)) state.audioModelId = entry.modelId;
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
    state.video.h3ContextIr = entry.h3ContextIr === true;
    state.video.omniPreviousInteractionId = entry.omniPreviousInteractionId || '';
    state.video.omniSourceHistoryId = entry.omniSourceHistoryId || '';
    state.video.omniChainDepth = Math.max(0, (Number(entry.omniChainDepth) || 0) - (entry.omniPreviousInteractionId ? 1 : 0));
    state.video.omniCumulativeDuration = entry.mode === 'extend'
      ? Math.max(0, (Number(entry.omniCumulativeDuration) || 0) - (Number(entry.duration) || 0))
      : Number(entry.omniCumulativeDuration) || 0;
    state.refs = (entry.refs || []).map((k, index) => ({ key: k, fromChar: false, kind: entry.refKinds?.[index] }));
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
        <div class="hist-meta">${esc(entry.modelName)}${entry.type === 'audio' ? ` · ${esc(entry.voiceName || '')}` : entry.type === 'video' ? ` · ${entry.aspectRatio} · ${entry.resolution} · ${entry.duration}s` : ` · ${entry.aspectRatio} · ${entry.resolution}${entry.batch > 1 ? ' · ×' + entry.batch : ''}`} · ${fmtDate(entry.ts)}${entry.durationMs ? ` · tardó ${fmtDuration(entry.durationMs)}` : ''}${entry.errors?.length ? ` · <span class="err">${entry.errors.length} error(es) en el lote</span>` : ''}</div>
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
  $('#vocabularyQuickPanel').hidden = true;
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
  const visiblePromptTotal = state.prompts.filter(contentIsVisible).length;
  const filtered = state.prompts.filter((pr) =>
    contentIsVisible(pr) && (!state.promptQuickCategory || (pr.category || 'General') === state.promptQuickCategory)
    && (!query || (isLoraPrompt(pr) ? loraSearchText(pr) : `${pr.title} ${pr.text} ${pr.category || ''}`).toLowerCase().includes(query)));
  toolbar.querySelector('#quickPromptCount').textContent = `${filtered.length} de ${visiblePromptTotal}`;
  if (!filtered.length) {
    panel.insertAdjacentHTML('beforeend', '<div class="empty-note" style="padding:14px 0">No hay prompts que coincidan con el filtro.</div>');
    return;
  }
  for (const pr of filtered) {
    const d = document.createElement('div');
    d.className = `prompt-item${isStylePrompt(pr) ? ' style' : ''}${isLoraPrompt(pr) ? ' lora' : ''}`;
    const mediaKey = isLoraPrompt(pr) ? (pr.lora?.mediaKey || pr.styleImageKey) : pr.styleImageKey;
    d.innerHTML = `${(isStylePrompt(pr) || isLoraPrompt(pr)) && mediaKey ? `<span class="prompt-item-style-thumb">${promptMediaPreviewHtml(mediaKey, '')}${isStylePrompt(pr) ? '<span class="prompt-style-label">ARTISTIC STYLE</span>' : ''}</span>` : ''}<span class="p-mode">${pr.mode === 'audio' ? IC('mic') : pr.mode === 'video' ? IC('film') : IC('image')}</span>
      <span class="p-title">${esc(pr.category || 'General')} · ${esc(pr.title)}${nsfwBadgeHtml(pr, 'compact')}</span>
      <span class="p-text">${esc(isLoraPrompt(pr) ? (pr.lora?.description || pr.lora?.fileName || '') : pr.text)}</span>
      ${isLoraPrompt(pr) ? loraInvocationHtml(pr, 'quick-') : ''}
      <button class="icon-btn" title="Eliminar">${IC('x')}</button>`;
    d.addEventListener('click', (e) => {
      if (e.target.closest('.icon-btn') || isLoraPrompt(pr)) return;
      usePrompt(pr);
    });
    if (isLoraPrompt(pr)) bindLoraInvocation(d, pr, 'quick-');
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

// replaceIndex null = agregar una referencia nueva; un índice = reemplazar esa
// referencia in-place (conserva posición, cita y etiqueta)
function isVideoMultimediaPicker() {
  return state.mode === 'video'
    && videoModeAllowsMultimedia()
    && state.replaceRefIndex == null
    && !state.promptStyleImagePick
    && !state.overlayBgPick;
}

function isPromptLoraMediaPicker() {
  return Boolean(state.promptStyleImagePick && promptEditorIsLora());
}

function openPicker(replaceIndex = null) {
  state.replaceRefIndex = replaceIndex;
  const multimedia = isVideoMultimediaPicker();
  const loraMedia = isPromptLoraMediaPicker();
  const multimediaAudio = multimedia && (currentVideoModel()?.mediaLimits?.audio || 0) > 0;
  $('#pickerTitle').textContent = replaceIndex != null
    ? 'Reemplazar imagen de referencia'
    : loraMedia ? 'Elegir imagen o video ilustrativo del LoRA' : multimedia ? `Elegir referencia para ${currentVideoModel().name}` : 'Elegir imagen de referencia';
  $('#pickerVideoTab').hidden = !(multimedia || loraMedia);
  $('#pickerAudioTab').hidden = !multimediaAudio;
  if (!(multimedia || loraMedia) && ['video', 'audio'].includes(state.pickerTab)) state.pickerTab = 'upload';
  if (!multimediaAudio && state.pickerTab === 'audio') state.pickerTab = 'upload';
  if (loraMedia && state.pickerTab === 'audio') state.pickerTab = 'upload';
  $('#pickerModal').hidden = false;
  setPickerTab(state.pickerTab || 'upload');
}

// una selección del picker: reemplaza si estamos en ese modo, o agrega
function pickRef(key, kind = 'image') {
  if (state.comfyPickerSlot) {
    const slot = state.comfyPickerSlot;
    state.comfyPickerSlot = null;
    $('#pickerModal').hidden = true;
    state.comfyui.refs[slot] = key;
    renderComfyRefSlot(slot);
    return;
  }
  if (state.promptStyleImagePick) {
    state.promptStyleImagePick = false;
    state.replaceRefIndex = null;
    $('#pickerModal').hidden = true;
    if (state.promptEditor) {
      if (typeof state.promptLoraMediaTarget === 'number') {
        const item = state.promptEditor.loraUseCases?.[state.promptLoraMediaTarget];
        if (item) item.mediaKey = key;
      } else {
        state.promptEditor.styleImageKey = key;
      }
      state.promptLoraMediaTarget = null;
      renderPromptStylePreview();
      renderPromptLoraUseCases();
      $('#promptStyleStatus').textContent = promptEditorIsLora()
        ? 'Imagen ilustrativa lista. No se enviará como referencia al generar.'
        : 'Imagen de estilo lista y obligatoria.';
    }
    return;
  }
  if (state.overlayBgPick) {
    state.overlayBgPick = false;
    $('#pickerModal').hidden = true;
    const pr = currentAutomation();
    if (pr) saveAutomation({ config: { overlay: { previewBg: key } } }).then(() => renderAutomationProject());
    return;
  }
  if (state.replaceRefIndex != null) return replaceRef(state.replaceRefIndex, key);
  return addRef(key, false, kind);
}

function replaceRef(i, key) {
  if (i < 0 || i >= state.refs.length) { state.replaceRefIndex = null; return; }
  if (state.refs.some((r, j) => j !== i && r.key === key)) return toast('Esa imagen ya está en las referencias', 'err');
  const prev = state.refs[i];
  // conserva la etiqueta (y por lo tanto la cita @Etiqueta); si no tenía, sugiere una
  state.refs[i] = { key, fromChar: false, label: prev.label || refLabelSuggestion(key) };
  state.replaceRefIndex = null;
  renderRefs();
  renderHighlight();
  toast('Referencia reemplazada — el orden y la cita se mantienen');
}

$('#pickerClose').addEventListener('click', () => { $('#pickerModal').hidden = true; state.replaceRefIndex = null; state.overlayBgPick = false; state.promptStyleImagePick = false; state.promptLoraMediaTarget = null; state.comfyPickerSlot = null; });
$$('#pickerTabs .tab').forEach((t) => {
  t.addEventListener('click', () => setPickerTab(t.dataset.src));
});

async function setPickerTab(src) {
  const multimedia = isVideoMultimediaPicker();
  const loraMedia = isPromptLoraMediaPicker();
  if (src === 'audio' && !multimedia) src = 'upload';
  if (src === 'video' && !(multimedia || loraMedia)) src = 'upload';
  state.pickerTab = src;
  $$('#pickerTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.src === src));
  const body = $('#pickerBody');

  if (src === 'upload') {
    const input = $('#fileInput');
    input.accept = multimedia
      ? '.jpg,.jpeg,.png,.webp,.mp4,.mov,.mp3,.wav,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/wav'
      : loraMedia ? '.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm' : 'image/*';
    body.innerHTML = `<div class="drop-zone" id="dropZone">${multimedia
      ? `Arrastrá imágenes, videos o audios acá<br><small>${esc(currentVideoModel()?.name || 'Video multimodal')}: JPG, PNG, WebP, MP4, MOV, MP3 o WAV</small>`
      : loraMedia ? 'Arrastrá una imagen o video ilustrativo acá'
      : 'Arrastrá imágenes acá'}<br>o hacé clic para elegir archivos</div>`;
    const dz = $('#dropZone');
    dz.addEventListener('click', () => {
      input.onchange = async (e) => { await uploadFiles([...e.target.files], true); e.target.value = ''; };
      input.click();
    });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault();
      dz.classList.remove('over');
      const files = [...e.dataTransfer.files].filter((file) => multimedia
        ? ['image', 'video', ...((currentVideoModel()?.mediaLimits?.audio || 0) > 0 ? ['audio'] : [])].includes(referenceFileKind(file))
        : loraMedia ? ['image', 'video'].includes(referenceFileKind(file))
        : referenceFileKind(file) === 'image');
      await uploadFiles(files, true);
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
    const kind = src === 'video' ? 'video' : src === 'audio' ? 'audio' : 'image';
    body.innerHTML = items.length
      ? `<div class="picker-grid">${items.map((a) =>
          `<div class="pick pick-${kind}" data-key="${esc(a.key)}" data-kind="${kind}">${nsfwBadgeHtml(a, 'overlay')}${kind === 'video'
            ? `<video src="${fileUrl(a.key)}" muted preload="metadata"></video>`
            : kind === 'audio' ? `<span class="picker-audio">${IC('mic', 'ic ic-lg')}<small>Audio</small></span>`
              : `<img src="${fileUrl(a.key)}" loading="lazy" alt="">`}<div class="p-label">${esc(a.name)}</div></div>`
        ).join('')}</div>`
      : '<div class="empty-note">Nada por acá todavía.</div>';
  }

  $$('#pickerBody .pick').forEach((p) => {
    p.addEventListener('click', () => {
      pickRef(p.dataset.key, p.dataset.kind || 'image');
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
    p.addEventListener('click', () => { pickRef(p.dataset.key); $('#pickerModal').hidden = true; }));

  if (!chosen) {
    const items = cfg.items();
    body.innerHTML = items.length
      ? `<div class="picker-grid">${items.map((it) => {
          const cover = cfg.cover(it);
          // respeta el encuadre de portada (avatarPos) igual que la tarjeta,
          // solo cuando la miniatura es la foto de portada del personaje/elemento
          const style = it.avatarPos && cover === it.photos?.[0] ? ` style="${avatarStyle(it)}"` : '';
          return `<div class="pick" data-id="${it.id}">${nsfwBadgeHtml(it, 'overlay')}${cover
            ? `<img src="${fileUrl(cover)}"${style} loading="lazy" alt="">`
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

function referenceFileKind(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (type.startsWith('video/') || /\.(mp4|mov|webm)$/.test(name)) return 'video';
  if (type.startsWith('audio/') || /\.(mp3|wav)$/.test(name)) return 'audio';
  if (type.startsWith('image/') || /\.(png|jpe?g|webp)$/.test(name)) return 'image';
  return '';
}

async function uploadFiles(files, asRefs) {
  if (!files.length) return;
  // en modo reemplazo solo tiene sentido una imagen: se usa la primera
  const replacing = asRefs && state.replaceRefIndex != null;
  const list = replacing ? files.slice(0, 1) : files;
  const multimedia = asRefs && isVideoMultimediaPicker();
  const loraMedia = asRefs && isPromptLoraMediaPicker();
  const initialRefTotal = state.refs.length;
  const initialRefCounts = state.refs.reduce((counts, ref) => {
    counts[referenceKind(ref)]++;
    return counts;
  }, { image: 0, video: 0, audio: 0 });
  const addedCounts = { image: 0, video: 0, audio: 0 };
  let uploaded = 0;
  for (const f of list) {
    try {
      const kind = referenceFileKind(f);
      if (!kind || (!multimedia && !loraMedia && kind !== 'image') || (loraMedia && !['image', 'video'].includes(kind))) {
        toast(`${f.name}: formato no admitido como referencia`, 'err');
        continue;
      }
      if (multimedia) {
        const totalLimit = activeRefLimit();
        if (initialRefTotal + addedCounts.image + addedCounts.video + addedCounts.audio >= totalLimit) {
          toast(`${f.name}: ${currentVideoModel()?.name || 'el modelo'} admite hasta ${totalLimit} referencias en total`, 'err');
          continue;
        }
        const mediaLimit = currentVideoModel()?.mediaLimits?.[kind];
        if (mediaLimit != null && initialRefCounts[kind] + addedCounts[kind] >= mediaLimit) {
          const label = kind === 'image' ? 'imágenes' : kind === 'video' ? 'videos' : 'audios';
          toast(`${f.name}: ${currentVideoModel()?.name || 'el modelo'} admite hasta ${mediaLimit} ${label} de referencia`, 'err');
          continue;
        }
      }
      // el cuerpo de la petición admite 150 MB y el base64 infla ~33%
      if (f.size > 100 * 1024 * 1024) {
        toast(`${f.name}: pesa más de 100 MB, achicalo antes de subirlo`, 'err');
        continue;
      }
      if (multimedia) {
        // ModelArk limita a 64 MB el cuerpo completo; reservamos margen para
        // el crecimiento de base64, el prompt y las demás referencias.
        const sizeLimitMb = currentVideoModel()?.id === 'seedance-2-5'
          ? { image: 30, video: 45, audio: 15 }[kind]
          : { image: 30, video: 50, audio: 15 }[kind];
        if (f.size > sizeLimitMb * 1024 * 1024) {
          toast(`${f.name}: supera el máximo de ${sizeLimitMb} MB para referencias ${kind === 'image' ? 'de imagen' : kind === 'video' ? 'de video' : 'de audio'} en Manifestador`, 'err');
          continue;
        }
      }
      const dataUrl = await readFileAsDataUrl(f);
      const upload = (multimedia || loraMedia)
        ? kind === 'audio'
          ? await api('/api/assets/audio', { method: 'POST', body: { name: f.name, dataUrl, audioKind: 'sound' } })
          : await api('/api/assets/visual', { method: 'POST', body: { name: f.name, dataUrl, category: loraMedia ? 'LORAS' : '', tags: [], nsfw: loraMedia && $('#promptEditorNsfw')?.checked } })
        : await api('/api/upload', { method: 'POST', body: { name: f.name, dataUrl } });
      const added = asRefs ? pickRef(upload.key, kind) : true;
      if (added !== false) {
        uploaded++;
        addedCounts[kind]++;
      }
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 'err');
    }
  }
  if (asRefs) {
    $('#pickerModal').hidden = true;
    if (!replacing && uploaded) toast(`${uploaded} archivo${uploaded === 1 ? '' : 's'} subido${uploaded === 1 ? '' : 's'} y agregado${uploaded === 1 ? '' : 's'} como referencia`);
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

const AUDIO_KIND_LABELS = { voice: 'Voz', music: 'Música', sound: 'Sonido' };
const splitMusicTags = (value) => [...new Set(String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 30);
const musicTagSummary = (tags = {}) => [...(tags.genres || []), ...(tags.instruments || []), ...(tags.moods || [])];
const splitVisualTags = (value) => [...new Set(String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 40);

function visualAssetItems() {
  return ['generated', 'uploads', 'video'].flatMap((zone) => state.assets[zone] || []);
}

function updateVisualTaxonomyOptions() {
  const items = visualAssetItems();
  const categories = [...new Set(items.map((item) => String(item.category || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'es'));
  const tags = [...new Set(items.flatMap((item) => item.tags || []).map((tag) => String(tag).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'es'));
  $('#visualCategoryList').innerHTML = categories.map((category) => `<option value="${esc(category)}"></option>`).join('');
  $('#assetTagsList').innerHTML = tags.map((tag) => `<option value="${esc(tag)}"></option>`).join('');
}

function openVisualUpload(kind = 'image') {
  state.visualUploadKind = kind === 'video' ? 'video' : 'image';
  $('#visualUploadForm').reset();
  $('#visualUploadNsfw').checked = Boolean(state.config?.nsfwUploadDefault);
  $('#visualUploadTitle').textContent = state.visualUploadKind === 'video' ? 'Subir videos' : 'Subir imágenes';
  $('#visualUploadHint').textContent = state.visualUploadKind === 'video'
    ? 'MP4, MOV o WebM · hasta 100 MB por archivo.'
    : 'PNG, JPG o WebP · hasta 100 MB por archivo.';
  $('#visualUploadFiles').accept = state.visualUploadKind === 'video'
    ? '.mp4,.mov,.m4v,.webm,video/mp4,video/quicktime,video/webm'
    : '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
  $('#visualUploadStatus').textContent = '';
  updateVisualTaxonomyOptions();
  $('#visualUploadModal').hidden = false;
}

function closeVisualUpload() {
  $('#visualUploadModal').hidden = true;
  $('#visualUploadForm').reset();
}

$('#visualUploadClose').addEventListener('click', closeVisualUpload);
$('#visualUploadCancel').addEventListener('click', closeVisualUpload);
$('#visualUploadModal').addEventListener('click', (event) => { if (event.target.id === 'visualUploadModal') closeVisualUpload(); });
$('#visualUploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const files = [...($('#visualUploadFiles').files || [])];
  if (!files.length) return;
  const invalidType = files.find((file) => state.visualUploadKind === 'video'
    ? !file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)
    : !file.type.startsWith('image/') && !/\.(png|jpe?g|webp)$/i.test(file.name));
  if (invalidType) return toast(`${invalidType.name}: el tipo de archivo no coincide con esta carga.`, 'err');
  const oversized = files.find((file) => file.size > 100 * 1024 * 1024);
  if (oversized) return toast(`${oversized.name}: supera el límite de 100 MB.`, 'err');
  const submit = $('#visualUploadSubmit');
  submit.disabled = true;
  const category = $('#visualUploadCategory').value.trim();
  const tags = splitVisualTags($('#visualUploadTags').value);
  let uploaded = 0;
  const failures = [];
  for (const [index, file] of files.entries()) {
    $('#visualUploadStatus').textContent = `Subiendo ${index + 1}/${files.length} · ${file.name}…`;
    try {
      await api('/api/assets/visual', {
        method: 'POST',
        body: { name: file.name, dataUrl: await readFileAsDataUrl(file), category, tags, nsfw: $('#visualUploadNsfw').checked }
      });
      uploaded++;
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }
  submit.disabled = false;
  if (uploaded) {
    closeVisualUpload();
    state.assetsZone = state.visualUploadKind === 'video' ? 'video' : 'uploads';
    $$('#view-assets .tabs .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.zone === state.assetsZone));
    $('#audioKindTabs').hidden = true;
    await refreshAssets();
  }
  if (failures.length) toast(`${uploaded}/${files.length} archivos subidos. ${failures[0]}`, 'err');
  else {
    const isVideo = state.visualUploadKind === 'video';
    const noun = isVideo ? `video${uploaded === 1 ? '' : 's'}` : `imagen${uploaded === 1 ? '' : 'es'}`;
    const adjective = isVideo
      ? `subido${uploaded === 1 ? '' : 's'} y clasificado${uploaded === 1 ? '' : 's'}`
      : `subida${uploaded === 1 ? '' : 's'} y clasificada${uploaded === 1 ? '' : 's'}`;
    toast(`${uploaded} ${noun} ${adjective}.`);
  }
});

$$('[data-password-toggle]').forEach((button) => {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    const input = button.closest('.key-row')?.querySelector('input');
    if (!input) return;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.classList.toggle('active', visible);
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? 'Ocultar clave' : 'Mostrar clave');
    button.title = visible ? 'Ocultar clave' : 'Mostrar clave';
  });
});

function openVisualClassify(keys, { category = '', tags = [], nsfw = false } = {}) {
  state.visualClassifyKeys = [...new Set(keys)].filter((key) => /^(generated|uploads|video)\//.test(key));
  if (!state.visualClassifyKeys.length) return toast('Seleccioná imágenes o videos para categorizar.', 'err');
  $('#visualClassifyForm').reset();
  $('#visualClassifyCategory').value = category || '';
  $('#visualClassifyTags').value = (tags || []).join(', ');
  $('#visualClassifyNsfw').checked = Boolean(nsfw);
  $('#visualClassifyHint').textContent = `La clasificación se aplicará a ${state.visualClassifyKeys.length} asset${state.visualClassifyKeys.length === 1 ? '' : 's'}.`;
  updateVisualTaxonomyOptions();
  $('#visualClassifyModal').hidden = false;
}

function closeVisualClassify() {
  $('#visualClassifyModal').hidden = true;
  state.visualClassifyKeys = [];
}

$('#visualClassifyClose').addEventListener('click', closeVisualClassify);
$('#visualClassifyCancel').addEventListener('click', closeVisualClassify);
$('#visualClassifyModal').addEventListener('click', (event) => { if (event.target.id === 'visualClassifyModal') closeVisualClassify(); });
$('#visualClassifyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    const result = await api('/api/assets/visual-metadata', {
      method: 'POST',
      body: {
        keys: state.visualClassifyKeys,
        category: $('#visualClassifyCategory').value.trim(),
        tags: splitVisualTags($('#visualClassifyTags').value),
        nsfw: $('#visualClassifyNsfw').checked
      }
    });
    const count = result.keys?.length || state.visualClassifyKeys.length;
    closeVisualClassify();
    state.selectedAssets.clear();
    await refreshAssets();
    toast(`${count} asset${count === 1 ? '' : 's'} clasificado${count === 1 ? '' : 's'}.`);
  } catch (error) {
    if (submit) submit.disabled = false;
    toast(error.message, 'err');
  }
});

function openAudioUpload({ automationId = null, kind = 'voice', musicTags = {} } = {}) {
  state.audioUploadAutomationId = automationId;
  $('#audioUploadForm').reset();
  $('#audioUploadNsfw').checked = Boolean(state.config?.nsfwUploadDefault);
  $('#audioUploadKind').value = ['voice', 'music', 'sound'].includes(kind) ? kind : 'voice';
  $('#audioUploadKind').disabled = Boolean(automationId);
  if (automationId) $('#audioUploadKind').value = 'music';
  $('#audioUploadGenres').value = (musicTags.genres || []).join(', ');
  $('#audioUploadInstruments').value = (musicTags.instruments || []).join(', ');
  $('#audioUploadMoods').value = (musicTags.moods || []).join(', ');
  $('#audioUploadMusicTags').hidden = $('#audioUploadKind').value !== 'music';
  $('#audioUploadModal').hidden = false;
}

function closeAudioUpload() {
  $('#audioUploadModal').hidden = true;
  state.audioUploadAutomationId = null;
}

$('#audioUploadKind').addEventListener('change', () => {
  $('#audioUploadMusicTags').hidden = $('#audioUploadKind').value !== 'music';
});
$('#audioUploadClose').addEventListener('click', closeAudioUpload);
$('#audioUploadCancel').addEventListener('click', closeAudioUpload);
$('#audioUploadModal').addEventListener('click', (event) => { if (event.target.id === 'audioUploadModal') closeAudioUpload(); });
$('#audioUploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('#audioUploadFile').files?.[0];
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) return toast('El audio supera el límite de 100 MB.', 'err');
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    const audioKind = $('#audioUploadKind').value;
    const uploaded = await api('/api/assets/audio', {
      method: 'POST',
      body: {
        name: file.name,
        dataUrl: await readFileAsDataUrl(file),
        audioKind,
        nsfw: $('#audioUploadNsfw').checked,
        musicTags: {
          genres: splitMusicTags($('#audioUploadGenres').value),
          instruments: splitMusicTags($('#audioUploadInstruments').value),
          moods: splitMusicTags($('#audioUploadMoods').value)
        }
      }
    });
    const automationId = state.audioUploadAutomationId;
    closeAudioUpload();
    await refreshAssets();
    if (automationId) {
      const project = state.automations.find((item) => item.id === automationId);
      if (project) {
        await saveAutomation({ config: { music: { ...project.config.music, enabled: true, source: 'asset', assetKey: uploaded.key } } });
        renderAutomationProject();
      }
    }
    toast(`${AUDIO_KIND_LABELS[audioKind]} subida y clasificada.`, 'ok');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    if (submit) submit.disabled = false;
  }
});

async function refreshAssets() {
  state.assets = await api('/api/assets');
  if (assetAudioKey && !(state.assets.audio || []).some((item) => item.key === assetAudioKey)) closeAssetAudioPlayer();
  else if (assetAudioKey) updateAssetAudioPlayer();
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
  const visualItems = state.assetsZone === 'audio' ? [] : (state.assets[state.assetsZone] || []);
  const categories = [...new Set(visualItems.map((item) => String(item.category || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'es'));
  $('#assetFilterCategory').innerHTML = '<option value="">Todas</option>' + categories.map((category) =>
    `<option value="${esc(category)}">${esc(category)}</option>`).join('');
  $('#assetFilterCategory').value = categories.includes(state.assetFilterCategory) ? state.assetFilterCategory : '';
  state.assetFilterCategory = $('#assetFilterCategory').value;
  $('#assetFilterSearch').value = state.assetFilterSearch;
  $('#assetFilterTags').value = state.assetFilterTags;
  $$('[data-visual-asset-filter]').forEach((field) => { field.hidden = state.assetsZone === 'audio'; });
  updateVisualTaxonomyOptions();
}

$('#assetFilterCharacter').addEventListener('change', () => {
  state.assetFilterCharacterId = $('#assetFilterCharacter').value;
  renderAssetsGrid();
});
$('#assetFilterSeries').addEventListener('change', () => {
  state.assetFilterSeriesId = $('#assetFilterSeries').value;
  renderAssetsGrid();
});
$('#assetFilterSearch').addEventListener('input', () => {
  state.assetFilterSearch = $('#assetFilterSearch').value;
  renderAssetsGrid();
});
$('#assetFilterCategory').addEventListener('change', () => {
  state.assetFilterCategory = $('#assetFilterCategory').value;
  renderAssetsGrid();
});
$('#assetFilterTags').addEventListener('input', () => {
  state.assetFilterTags = $('#assetFilterTags').value;
  renderAssetsGrid();
});

$$('#view-assets .tabs .tab').forEach((t) => {
  t.addEventListener('click', () => {
    state.assetsZone = t.dataset.zone;
    state.selectedAssets.clear();
    $$('#view-assets .tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    $('#audioKindTabs').hidden = state.assetsZone !== 'audio';
    $('#btnUploadAsset').innerHTML = state.assetsZone === 'audio'
      ? `${IC('upload')} Subir audio`
      : state.assetsZone === 'video' ? `${IC('upload')} Subir videos` : `${IC('upload')} Subir imágenes`;
    renderAssetFilterOptions();
    renderAssetsGrid();
  });
});

$$('#audioKindTabs [data-audio-kind]').forEach((button) => button.addEventListener('click', () => {
  state.assetAudioKind = button.dataset.audioKind;
  $$('#audioKindTabs [data-audio-kind]').forEach((item) => item.classList.toggle('active', item === button));
  state.selectedAssets.clear();
  renderAssetsGrid();
}));

$('#btnUploadAsset').addEventListener('click', () => {
  if (state.assetsZone === 'audio') {
    const kind = state.assetAudioKind === 'all' ? 'voice' : state.assetAudioKind;
    return openAudioUpload({ kind });
  }
  openVisualUpload(state.assetsZone === 'video' ? 'video' : 'image');
});

function automationAssetProjectLabel(asset) {
  if (!asset?.automationId) return '';
  const project = state.automations.find((item) => item.id === asset.automationId);
  return project?.name || asset.automationName || String(asset.category || '').replace(/^Auto:\s*/i, '') || 'Proyecto';
}

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
      card.innerHTML = `<button class="asset-check" title="Seleccionar">${state.selectedAssets.has(a.key) ? '✓' : ''}</button><button class="asset-series" title="Asociar a serie">${IC('layers')}</button><a class="asset-download" href="${fileUrl(a.key)}" download="${esc(a.name)}" title="Descargar">${IC('download')}</a><button class="asset-info" title="Información">${IC('info')}</button>${a.prompt ? `<button class="asset-copy" title="Copiar prompt">${IC('copy')}</button>` : ''}<button class="asset-delete" title="Borrar">${IC('trash')}</button>`;
      const automationProjectLabel = automationAssetProjectLabel(a);
      if (a.nsfw) card.insertAdjacentHTML('beforeend', nsfwBadgeHtml(a, 'overlay'));
      if (automationProjectLabel) card.insertAdjacentHTML('beforeend', `<span class="asset-project-badge" title="Generado por el Automatizador · ${esc(automationProjectLabel)}">${IC('spark')} ${esc(automationProjectLabel)}</span>`);
      if (state.assetsZone === 'audio') {
        const kind = a.audioKind || 'voice';
        const tags = kind === 'music' ? musicTagSummary(a.musicTags).slice(0, 4) : [];
        card.insertAdjacentHTML('beforeend', `<div class="audio-tile" data-audiokey="${esc(a.key)}" title="Abrir en el reproductor"><span class="audio-kind-badge ${kind}">${esc(AUDIO_KIND_LABELS[kind] || 'Audio')}</span><span class="audio-tile-icon">${IC('play', 'ic ic-lg')}</span><span class="audio-dur audio-tile-dur" data-durkey="${esc(a.key)}"></span></div><div class="a-name">${esc(a.name)}</div>${tags.length ? `<div class="audio-card-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}`);
        card.querySelector('.audio-tile').addEventListener('click', () => toggleAudioPlay(card, a.key));
      } else if (state.assetsZone === 'video') {
        card.insertAdjacentHTML('beforeend', `<video src="${fileUrl(a.key)}" preload="metadata" muted></video><div class="a-name">${esc(a.name)}</div>`);
        card.querySelector('video').addEventListener('click', () => openLightbox(a.key, items.map((item) => item.key)));
      } else {
        card.insertAdjacentHTML('beforeend', `<img src="${fileUrl(a.key)}" loading="lazy" alt=""><div class="a-name">${esc(a.name)}</div>`);
        card.querySelector('img').addEventListener('click', () => openLightbox(a.key, items.map((item) => item.key)));
      }
      if (state.assetsZone !== 'audio' && (a.category || a.tags?.length)) {
        card.insertAdjacentHTML('beforeend', `<div class="asset-card-taxonomy">${a.category ? `<span class="category">${esc(a.category)}</span>` : ''}${(a.tags || []).slice(0, 3).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>`);
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
  if (state.assetsZone === 'audio') fillAudioDurations(grid);
  if (assetAudioKey) updateAssetAudioPlayer();
  syncAssetAudioTiles();
}

const STYLE_CATEGORY = 'Estilos';
const LORA_CATEGORY = 'LORAS';
const ARTISTIC_STYLE_LABEL = 'ARTISTIC STYLE';

function isStylePrompt(pr) {
  return pr?.kind === 'style' || String(pr?.category || '').trim().toLowerCase() === STYLE_CATEGORY.toLowerCase();
}

function isLoraPrompt(pr) {
  return pr?.kind === 'lora' || String(pr?.category || '').trim().toLowerCase() === LORA_CATEGORY.toLowerCase();
}

function contentIsVisible(item) {
  return Boolean(state.config?.nsfwEnabled) || !item?.nsfw;
}

function nsfwBadgeHtml(item, extraClass = '') {
  return item?.nsfw
    ? `<span class="nsfw-badge${extraClass ? ` ${extraClass}` : ''}" title="Contenido NSFW" aria-label="Contenido NSFW">${IC('alert')}<span>NSFW</span></span>`
    : '';
}

function loraSearchText(pr) {
  const lora = pr?.lora || {};
  return [pr?.title, pr?.category, lora.description, lora.fileName, lora.usageInfo,
    ...(lora.triggerWords || []), ...(lora.useCases || []).flatMap((item) => [item.name, item.prompt])].filter(Boolean).join(' ');
}

function prepareLoraPromptTarget() {
  if (!['image', 'comfyui'].includes(state.mode)) setMode('image');
  goToCreate();
  promptBox.focus();
}

function insertLoraTrigger(trigger) {
  const word = String(trigger || '').trim();
  if (!word) return;
  prepareLoraPromptTarget();
  const current = promptBox.value.trimEnd();
  promptBox.value = current ? `${current.replace(/[\s,]+$/, '')}, ${word}` : word;
  renderHighlight();
  promptBox.setSelectionRange(promptBox.value.length, promptBox.value.length);
  toast(`Trigger “${word}” añadido`);
}

function insertLoraUseCase(useCase) {
  const text = String(useCase?.prompt || '').trim();
  if (!text) return;
  prepareLoraPromptTarget();
  promptBox.value = text;
  renderHighlight();
  promptBox.setSelectionRange(promptBox.value.length, promptBox.value.length);
  toast(`Caso de uso “${useCase.name || 'sin nombre'}” aplicado`);
}

function loraInvocationHtml(pr, prefix = '') {
  const lora = pr?.lora || {};
  return `${(lora.triggerWords || []).length ? `<div class="prompt-lora-triggers">${lora.triggerWords.map((trigger, index) => `<button type="button" class="prompt-lora-trigger" data-${prefix}lora-trigger="${index}" title="Añadir al prompt con coma">${esc(trigger)}</button>`).join('')}</div>` : ''}
    ${(lora.useCases || []).length ? `<div class="prompt-lora-cases">${lora.useCases.map((item, index) => `<button type="button" class="prompt-lora-case${item.mediaKey ? ' has-media' : ''}" data-${prefix}lora-case="${index}" title="${esc(item.prompt)}">${item.mediaKey ? IC(isVideoMediaKey(item.mediaKey) ? 'film' : 'image') : ''}${esc(item.name)}</button>`).join('')}</div>` : ''}`;
}

function bindLoraInvocation(root, pr, prefix = '') {
  root.querySelectorAll(`[data-${prefix}lora-trigger]`).forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    insertLoraTrigger(pr.lora?.triggerWords?.[Number(button.getAttribute(`data-${prefix}lora-trigger`))]);
  }));
  root.querySelectorAll(`[data-${prefix}lora-case]`).forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    insertLoraUseCase(pr.lora?.useCases?.[Number(button.getAttribute(`data-${prefix}lora-case`))]);
  }));
}

function addStyleReference(key) {
  if (!key) return true;
  const existing = state.refs.find((ref) => ref.key === key);
  if (existing) {
    existing.label = ARTISTIC_STYLE_LABEL;
    renderRefs();
    return true;
  }
  const model = activeRefModel();
  const maxRefs = activeRefLimit();
  if (state.refs.length >= maxRefs) {
    toast(`${model.name} admite hasta ${maxRefs} referencia(s); liberá una para aplicar el estilo.`, 'err');
    return false;
  }
  state.refs.unshift({ key, fromChar: false, label: ARTISTIC_STYLE_LABEL });
  renderRefs();
  return true;
}

function usePrompt(pr) {
  if (isLoraPrompt(pr)) return;
  const mode = isStylePrompt(pr) ? 'image' : (['audio', 'video'].includes(pr.mode) ? pr.mode : 'image');
  setMode(mode);
  if (isStylePrompt(pr) && !addStyleReference(pr.styleImageKey)) return;
  promptBox.value = pr.text;
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
  const builtIn = !mode || mode === 'image' ? [STYLE_CATEGORY, LORA_CATEGORY] : [];
  return [...new Set([...builtIn, ...fromPrompts, ...extra])].sort((a, b) => a.localeCompare(b));
}

function sameCategoryName(left, right) {
  return String(left || '').trim().toLocaleLowerCase('es') === String(right || '').trim().toLocaleLowerCase('es');
}

function isManagedPromptCategory(name) {
  return Boolean(name) && !['General', STYLE_CATEGORY, LORA_CATEGORY].some((reserved) => sameCategoryName(reserved, name));
}

function promptEditorIsStyle() {
  return String($('#promptEditorCategory').value || '').trim().toLowerCase() === STYLE_CATEGORY.toLowerCase();
}

function promptEditorIsLora() {
  return String($('#promptEditorCategory').value || '').trim().toLowerCase() === LORA_CATEGORY.toLowerCase();
}

function isVideoMediaKey(key) {
  return /^video\//i.test(String(key || '')) || /\.(mp4|mov|m4v|webm)$/i.test(String(key || ''));
}

function promptMediaPreviewHtml(key, alt = '') {
  if (!key) return '';
  return isVideoMediaKey(key)
    ? `<video src="${esc(fileUrl(key))}" muted controls preload="metadata" aria-label="${esc(alt)}"></video>`
    : `<img src="${esc(fileUrl(key))}" alt="${esc(alt)}">`;
}

function renderPromptStylePreview() {
  const key = state.promptEditor?.styleImageKey || '';
  $('#promptStylePreview').innerHTML = key
    ? `${promptMediaPreviewHtml(key, promptEditorIsLora() ? 'Archivo ilustrativo del LoRA' : 'Referencia de estilo')}${promptEditorIsLora() ? '' : `<span class="prompt-style-label">${ARTISTIC_STYLE_LABEL}</span>`}`
    : `<div class="prompt-style-placeholder">${promptEditorIsLora() ? 'Imagen ilustrativa opcional del LoRA' : 'Elegí la imagen que define la estética'}</div>`;
}

function renderPromptLoraTriggers() {
  const words = state.promptEditor?.loraTriggerWords || [];
  $('#promptLoraTriggerChips').innerHTML = words.length
    ? words.map((word, index) => `<span class="prompt-lora-editor-trigger">${esc(word)}<button type="button" data-lora-remove-trigger="${index}" title="Quitar">×</button></span>`).join('')
    : '<span class="hint">Todavía no hay trigger words.</span>';
  $('#promptLoraTriggerChips').querySelectorAll('[data-lora-remove-trigger]').forEach((button) => button.addEventListener('click', () => {
    state.promptEditor.loraTriggerWords.splice(Number(button.dataset.loraRemoveTrigger), 1);
    renderPromptLoraTriggers();
  }));
}

function addPromptLoraTrigger() {
  if (!state.promptEditor) return;
  const input = $('#promptLoraTriggerInput');
  const additions = input.value.split(',').map((word) => word.trim()).filter(Boolean);
  const existing = new Set(state.promptEditor.loraTriggerWords.map((word) => word.toLocaleLowerCase()));
  for (const word of additions) {
    if (!existing.has(word.toLocaleLowerCase()) && state.promptEditor.loraTriggerWords.length < 50) {
      state.promptEditor.loraTriggerWords.push(word.slice(0, 120));
      existing.add(word.toLocaleLowerCase());
    }
  }
  input.value = '';
  renderPromptLoraTriggers();
  input.focus();
}

function renderPromptLoraUseCases() {
  const useCases = state.promptEditor?.loraUseCases || [];
  $('#promptLoraUseCases').innerHTML = useCases.length ? useCases.map((item, index) => `
    <div class="prompt-lora-use-case" data-lora-use-case="${index}">
      <input type="text" maxlength="100" value="${esc(item.name || '')}" placeholder="Nombre del caso">
      <textarea maxlength="4000" placeholder="Prompt completo para este caso">${esc(item.prompt || '')}</textarea>
      <div class="prompt-lora-case-media">${item.mediaKey ? `<div class="prompt-lora-case-preview">${promptMediaPreviewHtml(item.mediaKey, `Referencia de ${item.name || 'caso de uso'}`)}</div>` : '<span class="hint">Sin imagen o video propio.</span>'}
        <button type="button" class="mini-btn" data-lora-case-upload="${index}">${IC('upload')} Subir</button>
        <button type="button" class="mini-btn" data-lora-case-assets="${index}">${IC('image')} Assets</button>
        ${item.mediaKey ? `<button type="button" class="mini-btn danger" data-lora-case-clear="${index}">Quitar</button>` : ''}
      </div>
      <button type="button" class="icon-btn" data-lora-remove-case="${index}" title="Quitar caso">${IC('trash')}</button>
    </div>`).join('') : '<span class="hint">Añadí casos de uso para invocar prompts completos.</span>';
  $('#promptLoraUseCases').querySelectorAll('[data-lora-use-case]').forEach((row) => {
    const index = Number(row.dataset.loraUseCase);
    row.querySelector('input').addEventListener('input', (event) => { state.promptEditor.loraUseCases[index].name = event.target.value; });
    row.querySelector('textarea').addEventListener('input', (event) => { state.promptEditor.loraUseCases[index].prompt = event.target.value; });
  });
  $('#promptLoraUseCases').querySelectorAll('[data-lora-remove-case]').forEach((button) => button.addEventListener('click', () => {
    state.promptEditor.loraUseCases.splice(Number(button.dataset.loraRemoveCase), 1);
    renderPromptLoraUseCases();
  }));
  $('#promptLoraUseCases').querySelectorAll('[data-lora-case-assets]').forEach((button) => button.addEventListener('click', () => {
    state.promptLoraMediaTarget = Number(button.dataset.loraCaseAssets);
    state.promptStyleImagePick = true;
    openPicker();
  }));
  $('#promptLoraUseCases').querySelectorAll('[data-lora-case-upload]').forEach((button) => button.addEventListener('click', () => {
    state.promptLoraMediaTarget = Number(button.dataset.loraCaseUpload);
    $('#promptStyleUpload').click();
  }));
  $('#promptLoraUseCases').querySelectorAll('[data-lora-case-clear]').forEach((button) => button.addEventListener('click', () => {
    state.promptEditor.loraUseCases[Number(button.dataset.loraCaseClear)].mediaKey = '';
    renderPromptLoraUseCases();
  }));
}

function fillPromptLoraFields() {
  const lora = state.promptEditor?.lora || {};
  $('#promptLoraDescription').value = lora.description || '';
  $('#promptLoraFileName').value = lora.fileName || '';
  $('#promptLoraUsageInfo').value = lora.usageInfo || '';
  renderPromptLoraTriggers();
  renderPromptLoraUseCases();
}

function syncPromptEditorStyleFields() {
  const isStyle = promptEditorIsStyle();
  const isLora = promptEditorIsLora();
  $('#promptStyleFields').hidden = !(isStyle || isLora);
  $('#promptLoraFields').hidden = !isLora;
  $('#promptStyleAnalyzeBtn').hidden = isLora;
  $('#promptStyleStatus').textContent = isLora
    ? 'La imagen es opcional e ilustrativa; no se enviará como referencia al generar.'
    : 'La imagen es obligatoria. La IA describirá solo la estética, técnica, soporte, luz, color y textura.';
  $('#promptEditorTextField').hidden = isLora;
  $('#promptEditorTextLabel').textContent = isStyle ? 'Prompt de estilo (en inglés)' : 'Prompt';
  $('#promptEditorMode').disabled = isStyle || isLora;
  $('#promptEditorText').required = !isLora;
  if (isStyle || isLora) $('#promptEditorMode').value = 'image';
  renderPromptStylePreview();
  if (isLora && !state.promptEditor?.loraFieldsFilled) {
    state.promptEditor.loraFieldsFilled = true;
    fillPromptLoraFields();
  }
}

function renderPromptEditorCategories() {
  const cats = promptCategories($('#promptEditorMode').value);
  chipRow($('#promptEditorCategoryChips'), cats, $('#promptEditorCategory').value.trim(), (c) => {
    $('#promptEditorCategory').value = c;
    renderPromptEditorCategories();
  });
  syncPromptEditorStyleFields();
}

function openPromptEditor({ prompt = null, initialText = '', initialMode = state.mode, source = 'library' } = {}) {
  state.promptEditor = {
    id: prompt?.id || null, source, styleImageKey: prompt?.lora?.mediaKey || prompt?.styleImageKey || '', lora: prompt?.lora || {}, nsfw: Boolean(prompt?.nsfw),
    loraTriggerWords: [...(prompt?.lora?.triggerWords || [])],
    loraUseCases: (prompt?.lora?.useCases || []).map((item) => ({ ...item })),
    loraFieldsFilled: false
  };
  $('#promptEditorTitle').textContent = prompt ? 'Editar prompt' : 'Nuevo prompt';
  $('#promptEditorName').value = prompt?.title || (initialText ? initialText.slice(0, 60) : '');
  $('#promptEditorCategory').value = prompt?.category || 'General';
  $('#promptEditorMode').value = prompt?.mode || (['audio', 'video'].includes(initialMode) ? initialMode : 'image');
  $('#promptEditorText').value = prompt?.text || initialText || '';
  $('#promptEditorNsfw').checked = Boolean(prompt?.nsfw);
  renderPromptEditorCategories();
  $('#promptEditorModal').hidden = false;
  setTimeout(() => $('#promptEditorName').focus(), 0);
}

$('#promptEditorMode').addEventListener('change', renderPromptEditorCategories);
$('#promptEditorCategory').addEventListener('input', renderPromptEditorCategories);
$('#promptLoraAddTrigger').addEventListener('click', addPromptLoraTrigger);
$('#promptLoraTriggerInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addPromptLoraTrigger(); } });
$('#promptLoraAddUseCase').addEventListener('click', () => {
  if (!state.promptEditor) return;
  state.promptEditor.loraUseCases.push({ name: '', prompt: '', mediaKey: '' });
  renderPromptLoraUseCases();
  $('#promptLoraUseCases [data-lora-use-case]:last-child input')?.focus();
});

$('#promptStyleUploadBtn').addEventListener('click', () => { state.promptLoraMediaTarget = null; $('#promptStyleUpload').click(); });
$('#promptStyleUpload').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !state.promptEditor) return;
  try {
    $('#promptStyleStatus').textContent = 'Subiendo imagen…';
    const kind = referenceFileKind(file);
    if (promptEditorIsStyle() && kind !== 'image') throw new Error('Los estilos necesitan una imagen.');
    if (promptEditorIsLora() && !['image', 'video'].includes(kind)) throw new Error('El LoRA admite una imagen o video ilustrativo.');
    const dataUrl = await readFileAsDataUrl(file);
    const { key } = promptEditorIsLora()
      ? await api('/api/assets/visual', { method: 'POST', body: { name: file.name, dataUrl, category: 'LORAS', tags: [], nsfw: $('#promptEditorNsfw').checked } })
      : await api('/api/upload', { method: 'POST', body: { name: file.name, dataUrl } });
    if (typeof state.promptLoraMediaTarget === 'number') {
      const item = state.promptEditor.loraUseCases?.[state.promptLoraMediaTarget];
      if (item) item.mediaKey = key;
      renderPromptLoraUseCases();
    } else {
      state.promptEditor.styleImageKey = key;
    }
    state.promptLoraMediaTarget = null;
    renderPromptStylePreview();
    $('#promptStyleStatus').textContent = promptEditorIsLora()
      ? 'Imagen ilustrativa lista. No se enviará como referencia al generar.'
      : 'Imagen lista. Podés escribir el estilo o pedir el análisis con IA.';
  } catch (err) {
    $('#promptStyleStatus').textContent = err.message;
    toast(err.message, 'err');
  }
});
$('#promptStyleAssetsBtn').addEventListener('click', () => {
  state.promptLoraMediaTarget = null;
  state.promptStyleImagePick = true;
  openPicker();
  $('#pickerTitle').textContent = promptEditorIsLora() ? 'Elegir imagen ilustrativa del LoRA' : 'Elegir imagen para el estilo artístico';
});
$('#promptStyleAnalyzeBtn').addEventListener('click', async () => {
  const key = state.promptEditor?.styleImageKey;
  if (!key) return toast('Primero elegí una imagen para analizar.', 'err');
  const button = $('#promptStyleAnalyzeBtn');
  button.disabled = true;
  $('#promptStyleStatus').textContent = 'Analizando estética, técnica, luz, color y textura…';
  try {
    const result = await api('/api/prompts/analyze-style', { method: 'POST', body: { imageKey: key } });
    $('#promptEditorText').value = result.text || '';
    $('#promptStyleStatus').textContent = `Estilo escrito con ${result.model || 'IA'}. Revisalo y guardalo cuando esté listo.`;
    if (!$('#promptEditorName').value.trim()) $('#promptEditorName').value = 'Estilo artístico';
  } catch (err) {
    $('#promptStyleStatus').textContent = err.message;
    toast(err.message, 'err');
  } finally {
    button.disabled = false;
  }
});

function closePromptEditor() {
  $('#promptEditorModal').hidden = true;
  state.promptEditor = null;
  state.promptStyleImagePick = false;
  state.promptLoraMediaTarget = null;
}

$('#promptEditorClose').addEventListener('click', closePromptEditor);
$('#promptEditorCancel').addEventListener('click', closePromptEditor);
$('#promptEditorModal').addEventListener('click', (e) => { if (e.target.id === 'promptEditorModal') closePromptEditor(); });
$('#promptEditorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editor = state.promptEditor || {};
  const isLora = promptEditorIsLora();
  const rawLoraUseCases = (editor.loraUseCases || []).map((item) => ({
    name: String(item.name || '').trim(), prompt: String(item.prompt || '').trim(), mediaKey: item.mediaKey || ''
  }));
  if (isLora && rawLoraUseCases.some((item) => (item.name || item.prompt) && !(item.name && item.prompt))) {
    return toast('Cada caso de uso debe tener nombre y prompt completos.', 'err');
  }
  const loraUseCases = rawLoraUseCases.filter((item) => item.name && item.prompt);
  const body = {
    title: $('#promptEditorName').value.trim(),
    category: $('#promptEditorCategory').value.trim() || 'General',
    mode: ['audio', 'video'].includes($('#promptEditorMode').value) ? $('#promptEditorMode').value : 'image',
    text: isLora ? '' : $('#promptEditorText').value.trim(),
    kind: isLora ? 'lora' : promptEditorIsStyle() ? 'style' : 'prompt',
    nsfw: $('#promptEditorNsfw').checked,
    styleImageKey: (promptEditorIsStyle() || isLora) ? (editor.styleImageKey || '') : '',
    lora: isLora ? {
      description: $('#promptLoraDescription').value.trim(),
      mediaKey: editor.styleImageKey || '',
      fileName: $('#promptLoraFileName').value.trim(),
      triggerWords: editor.loraTriggerWords || [],
      useCases: loraUseCases,
      usageInfo: $('#promptLoraUsageInfo').value.trim()
    } : null
  };
  if (!body.title || (!isLora && !body.text)) return;
  if (body.kind === 'style' && !body.styleImageKey) return toast('Elegí una imagen para este estilo.', 'err');
  if (body.kind === 'lora' && !body.lora.fileName) return toast('Escribí el nombre del archivo LoRA.', 'err');
  if (body.kind === 'lora' && !body.lora.triggerWords.length && !body.lora.useCases.length) {
    return toast('Añadí al menos una trigger word o un caso de uso.', 'err');
  }
  try {
    if (editor.id) {
      const updated = await api(`/api/prompts/${editor.id}`, { method: 'PUT', body });
      if (!contentIsVisible(updated)) state.prompts = state.prompts.filter((p) => p.id !== editor.id);
      else state.prompts[state.prompts.findIndex((p) => p.id === editor.id)] = updated;
      toast('Prompt actualizado');
    } else {
      const item = await api('/api/prompts', { method: 'POST', body });
      if (!item.nsfw || state.config?.nsfwEnabled) state.prompts.unshift(item);
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
  updatePromptCategoryActions();
  const query = $('#promptSearch').value.trim().toLowerCase();
  const items = state.prompts.filter((p) => contentIsVisible(p) && (!filter.value || (p.category || 'General') === filter.value)
    && (!query || (isLoraPrompt(p) ? loraSearchText(p) : `${p.title} ${p.text} ${p.category || ''}`).toLowerCase().includes(query)));
  library.innerHTML = items.length ? items.map((pr) => `
    <article class="prompt-library-card" data-prompt="${pr.id}">
      <div class="prompt-library-head"><div><span class="prompt-category">${esc(pr.category || 'General')}</span>${nsfwBadgeHtml(pr)}<h3>${esc(pr.title)}</h3></div><span>${pr.mode === 'audio' ? IC('mic') : pr.mode === 'video' ? IC('film') : IC('image')}</span></div>
      ${isStylePrompt(pr) && pr.styleImageKey ? `<div class="prompt-style-image"><img src="${esc(fileUrl(pr.styleImageKey))}" alt="Referencia de ${esc(pr.title)}"><span class="prompt-style-label">${ARTISTIC_STYLE_LABEL}</span></div>` : ''}
      ${isLoraPrompt(pr) && (pr.lora?.mediaKey || pr.styleImageKey) ? `<div class="prompt-lora-image">${promptMediaPreviewHtml(pr.lora?.mediaKey || pr.styleImageKey, `Archivo ilustrativo de ${pr.title}`)}</div>` : ''}
      ${isLoraPrompt(pr) ? `${pr.lora?.fileName ? `<div class="prompt-lora-file">${esc(pr.lora.fileName)}</div>` : ''}<div class="prompt-lora-description">${esc(pr.lora?.description || '')}</div>${loraInvocationHtml(pr)}${pr.lora?.usageInfo ? `<div class="prompt-lora-usage"><strong>Uso correcto:</strong> ${esc(pr.lora.usageInfo)}</div>` : ''}` : `<div class="prompt-library-text">${esc(pr.text)}</div>`}
      <div class="prompt-library-actions">${isLoraPrompt(pr) ? '' : '<button class="mini-btn" data-pact="use">Usar</button>'}<button class="mini-btn" data-pact="edit">${IC('edit')} Editar</button><button class="mini-btn danger" data-pact="delete">${IC('trash')}</button></div>
    </article>`).join('') : '<div class="empty-note">No hay prompts que coincidan.</div>';
  library.querySelectorAll('[data-prompt]').forEach((card) => {
    const pr = state.prompts.find((p) => p.id === card.dataset.prompt);
    card.querySelector('[data-pact="use"]')?.addEventListener('click', () => usePrompt(pr));
    if (isLoraPrompt(pr)) bindLoraInvocation(card, pr);
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

function updatePromptCategoryActions() {
  const editable = isManagedPromptCategory($('#promptCategoryFilter').value);
  $('#btnEditPromptCategory').hidden = !editable;
  $('#btnDeletePromptCategory').hidden = !editable;
}

function openPromptCategoryForm(category = '') {
  const row = $('#newCategoryRow');
  const editing = Boolean(category);
  row.dataset.action = editing ? 'edit' : 'create';
  row.dataset.originalName = category;
  row.hidden = false;
  $('#newCategoryMode').hidden = editing;
  $('#newCategoryName').value = category;
  $('#newCategorySave').textContent = editing ? 'Guardar cambios' : 'Crear';
  $('#newCategoryName').focus();
  $('#newCategoryName').select();
}

function closePromptCategoryForm() {
  const row = $('#newCategoryRow');
  row.hidden = true;
  row.dataset.action = '';
  row.dataset.originalName = '';
  $('#newCategoryMode').hidden = false;
  $('#newCategorySave').textContent = 'Crear';
}

function updateOpenPromptCategory(oldName, newName) {
  state.prompts = state.prompts.map((prompt) => (
    sameCategoryName(prompt.category || 'General', oldName) ? { ...prompt, category: newName } : prompt
  ));
  if (sameCategoryName(state.promptQuickCategory, oldName)) state.promptQuickCategory = newName === 'General' ? '' : newName;
  if (!$('#promptEditorModal').hidden && sameCategoryName($('#promptEditorCategory').value, oldName)) {
    $('#promptEditorCategory').value = newName;
    renderPromptEditorCategories();
  }
}

$('#btnNewPromptCategory').addEventListener('click', () => openPromptCategoryForm());
$('#btnEditPromptCategory').addEventListener('click', () => {
  const category = $('#promptCategoryFilter').value;
  if (isManagedPromptCategory(category)) openPromptCategoryForm(category);
});
$('#btnDeletePromptCategory').addEventListener('click', async () => {
  const name = $('#promptCategoryFilter').value;
  if (!isManagedPromptCategory(name)) return;
  if (!confirm(`¿Borrar la categoría “${name}”?\n\nLos prompts que la usan se conservarán y pasarán a General.`)) return;
  try {
    const { promptCategories: updated, affected = 0 } = await api('/api/prompt-categories', { method: 'DELETE', body: { name } });
    state.promptCategoriesExtra = updated;
    updateOpenPromptCategory(name, 'General');
    $('#promptCategoryFilter').value = '';
    closePromptCategoryForm();
    renderPromptLibrary();
    renderPromptsPanel();
    toast(`Categoría “${name}” borrada${affected ? ` · ${affected} prompt${affected === 1 ? '' : 's'} movido${affected === 1 ? '' : 's'} a General` : ''}`);
  } catch (err) {
    toast(err.message, 'err');
  }
});
$('#newCategoryCancel').addEventListener('click', closePromptCategoryForm);
$('#newCategoryName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#newCategorySave').click(); } });
$('#newCategorySave').addEventListener('click', async () => {
  const row = $('#newCategoryRow');
  const editing = row.dataset.action === 'edit';
  const originalName = row.dataset.originalName || '';
  const mode = $('#newCategoryMode').value;
  const name = $('#newCategoryName').value.trim();
  if (!name) return toast('Escribí un nombre para la categoría', 'err');
  try {
    const { promptCategories: updated, affected = 0 } = editing
      ? await api('/api/prompt-categories', { method: 'PUT', body: { name: originalName, newName: name } })
      : await api('/api/prompt-categories', { method: 'POST', body: { mode, name } });
    state.promptCategoriesExtra = updated;
    if (editing) updateOpenPromptCategory(originalName, name);
    closePromptCategoryForm();
    renderPromptLibrary();
    $('#promptCategoryFilter').value = name;
    renderPromptLibrary();
    renderPromptsPanel();
    toast(editing
      ? `Categoría actualizada${affected ? ` en ${affected} prompt${affected === 1 ? '' : 's'}` : ''}`
      : `Categoría "${name}" creada`);
  } catch (err) {
    toast(err.message, 'err');
  }
});
$('#btnNewPrompt').addEventListener('click', () => openPromptEditor({ initialMode: state.mode }));

// ---------------------------------------------------------------------------
// vocabulario visual — fichas ilustradas y consulta rápida desde Creación
// ---------------------------------------------------------------------------

function normalizeVocabularyWordsClient(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/);
  const seen = new Set();
  return source.map((word) => String(word || '').trim().replace(/\s+/g, ' ').slice(0, 120)).filter((word) => {
    const key = word.toLocaleLowerCase('es');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100);
}

function vocabularyCategories() {
  return [...new Set(['General', ...state.vocabularyCategoriesExtra, ...state.vocabulary.map((item) => item.category).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b));
}

function isManagedVocabularyCategory(name) {
  return Boolean(name) && !sameCategoryName(name, 'General');
}

function updateVocabularyCategoryActions() {
  const editable = isManagedVocabularyCategory($('#vocabularyCategoryFilter').value);
  $('#btnEditVocabularyCategory').hidden = !editable;
  $('#btnDeleteVocabularyCategory').hidden = !editable;
}

function vocabularySearchText(item) {
  return `${item.title || ''} ${item.category || ''} ${(item.words || []).join(' ')}`.toLocaleLowerCase('es');
}

function filteredVocabulary(query = '', category = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('es');
  return state.vocabulary.filter((item) => contentIsVisible(item)
    && (!category || sameCategoryName(item.category, category))
    && (!needle || vocabularySearchText(item).includes(needle)));
}

async function copyVocabularyWord(word) {
  const text = String(word || '').trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast(`“${text}” copiado`);
}

// En el panel rápido (mientras se escribe) el click INSERTA en el cursor del
// prompt; en la biblioteca (sin prompt a la vista) copia al portapapeles.
function insertVocabularyWord(word) {
  const text = String(word || '').trim();
  if (!text) return;
  const caret = promptBox.selectionStart ?? promptBox.value.length;
  const before = promptBox.value.slice(0, caret);
  const lead = before.length && !/[\s,([{]$/.test(before) ? ' ' : '';
  insertAtCursor(`${lead}${text} `);
  toast(`“${text}” insertado`);
}

function vocabularyWordsMarkup(item, actionLabel = 'Copiar', icon = 'copy') {
  return `<div class="vocabulary-words">${(item.words || []).map((word, index) => `
    <button type="button" class="vocabulary-word" data-vocabulary-word="${index}" title="${esc(actionLabel)} ${esc(word)}">
      <span>${esc(word)}</span>${IC(icon)}
    </button>`).join('')}</div>`;
}

function bindVocabularyWords(root, item, onWord = copyVocabularyWord) {
  root.querySelectorAll('[data-vocabulary-word]').forEach((button) => button.addEventListener('click', () => {
    onWord(item.words?.[Number(button.dataset.vocabularyWord)]);
  }));
}

function vocabularyImageKeys(items = state.vocabulary) {
  return [...new Set(items.map((item) => item.imageKey).filter(Boolean))];
}

function renderVocabularyLibrary() {
  const library = $('#vocabularyLibrary');
  if (!library) return;
  const categories = vocabularyCategories();
  if (state.vocabularyCategoryFilter && !categories.some((category) => sameCategoryName(category, state.vocabularyCategoryFilter))) {
    state.vocabularyCategoryFilter = '';
  }
  $('#vocabularySearch').value = state.vocabularySearch;
  const filter = $('#vocabularyCategoryFilter');
  filter.innerHTML = '<option value="">Todas las categorías</option>'
    + categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
  filter.value = state.vocabularyCategoryFilter;
  updateVocabularyCategoryActions();
  const items = filteredVocabulary(state.vocabularySearch, state.vocabularyCategoryFilter);
  $('#vocabularyCount').textContent = `${items.length} de ${state.vocabulary.length} ficha${state.vocabulary.length === 1 ? '' : 's'}`;
  library.innerHTML = items.length ? items.map((item) => `
    <article class="vocabulary-card" data-vocabulary-id="${esc(item.id)}">
      <button type="button" class="vocabulary-card-image" data-vocabulary-image aria-label="Ampliar ${esc(item.title)}"><img src="${esc(fileUrl(item.imageKey))}" alt="Referencia visual de ${esc(item.title)}" loading="lazy"></button>
      <div class="vocabulary-card-head">
        <div><span class="prompt-category">${esc(item.category)}</span><h3>${esc(item.title)}</h3></div>
        ${nsfwBadgeHtml(item)}
      </div>
      ${vocabularyWordsMarkup(item)}
      <div class="vocabulary-card-actions">
        <button type="button" class="mini-btn" data-vocabulary-action="edit">${IC('edit')} Editar</button>
        <button type="button" class="mini-btn danger" data-vocabulary-action="delete">${IC('trash')} Borrar</button>
      </div>
    </article>`).join('') : '<div class="empty-note">No hay fichas de vocabulario que coincidan con la búsqueda.</div>';
  const visibleImageKeys = vocabularyImageKeys(items);
  library.querySelectorAll('[data-vocabulary-id]').forEach((card) => {
    const item = state.vocabulary.find((entry) => entry.id === card.dataset.vocabularyId);
    if (!item) return;
    bindVocabularyWords(card, item);
    card.querySelector('[data-vocabulary-image]').addEventListener('click', () => openLightbox(item.imageKey, visibleImageKeys));
    card.querySelector('[data-vocabulary-action="edit"]').addEventListener('click', () => openVocabularyEditor(item));
    card.querySelector('[data-vocabulary-action="delete"]').addEventListener('click', () => deleteVocabularyEntry(item));
  });
}

function openVocabularyCategoryForm(category = '') {
  const row = $('#newVocabularyCategoryRow');
  const editing = Boolean(category);
  row.dataset.action = editing ? 'edit' : 'create';
  row.dataset.originalName = category;
  row.hidden = false;
  $('#newVocabularyCategoryName').value = category;
  $('#newVocabularyCategorySave').textContent = editing ? 'Guardar cambios' : 'Crear';
  $('#newVocabularyCategoryName').focus();
  $('#newVocabularyCategoryName').select();
}

function closeVocabularyCategoryForm() {
  const row = $('#newVocabularyCategoryRow');
  row.hidden = true;
  row.dataset.action = '';
  row.dataset.originalName = '';
  $('#newVocabularyCategorySave').textContent = 'Crear';
}

function updateOpenVocabularyCategory(oldName, newName) {
  state.vocabulary = state.vocabulary.map((item) => (
    sameCategoryName(item.category, oldName) ? { ...item, category: newName } : item
  ));
  if (sameCategoryName(state.vocabularyCategoryFilter, oldName)) state.vocabularyCategoryFilter = newName === 'General' ? '' : newName;
  if (sameCategoryName(state.vocabularyQuickCategory, oldName)) state.vocabularyQuickCategory = newName === 'General' ? '' : newName;
  if (!$('#vocabularyEditorModal').hidden && sameCategoryName($('#vocabularyEditorCategory').value, oldName)) {
    $('#vocabularyEditorCategory').value = newName;
  }
}

function renderVocabularyQuickPanel() {
  const panel = $('#vocabularyQuickPanel');
  if (!panel || panel.hidden) return;
  const categories = vocabularyCategories();
  if (state.vocabularyQuickCategory && !categories.some((category) => sameCategoryName(category, state.vocabularyQuickCategory))) {
    state.vocabularyQuickCategory = '';
  }
  const items = filteredVocabulary(state.vocabularyQuickSearch, state.vocabularyQuickCategory);
  panel.innerHTML = `
    <div class="vocabulary-quick-head">
      <div><strong>Vocabulario visual</strong><span class="hint">Consultá la imagen y hacé click en una palabra para insertarla en el prompt donde tengas el cursor.</span></div>
      <button type="button" class="icon-btn" data-vocabulary-quick-close title="Cerrar"><svg class="ic"><use href="#i-x"/></svg></button>
    </div>
    <div class="vocabulary-quick-tools">
      <input type="search" data-vocabulary-quick-search placeholder="Buscar prendas, construcciones, materiales…" value="${esc(state.vocabularyQuickSearch)}">
      <select class="select" data-vocabulary-quick-category><option value="">Todas las categorías</option>${categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('')}</select>
      <span class="hint">${items.length} resultado${items.length === 1 ? '' : 's'}</span>
    </div>
    <div class="vocabulary-quick-grid">${items.length ? items.map((item) => `
      <article class="vocabulary-quick-card" data-vocabulary-quick-id="${esc(item.id)}">
        <button type="button" class="vocabulary-quick-image" data-vocabulary-quick-image aria-label="Ampliar ${esc(item.title)}"><img src="${esc(fileUrl(item.imageKey))}" alt="Referencia visual de ${esc(item.title)}" loading="lazy"></button>
        <div class="vocabulary-quick-copy">
          <span class="prompt-category">${esc(item.category)}</span>
          <h4>${esc(item.title)}${nsfwBadgeHtml(item, 'compact')}</h4>
          ${vocabularyWordsMarkup(item, 'Insertar', 'plus')}
        </div>
      </article>`).join('') : `<div class="empty-note">No hay coincidencias. <button type="button" class="mini-btn" data-open-vocabulary-section>${IC('plus')} Administrar vocabulario</button></div>`}</div>`;
  const category = panel.querySelector('[data-vocabulary-quick-category]');
  category.value = state.vocabularyQuickCategory;
  category.addEventListener('change', () => {
    state.vocabularyQuickCategory = category.value;
    renderVocabularyQuickPanel();
  });
  panel.querySelector('[data-vocabulary-quick-search]').addEventListener('input', (event) => {
    const caret = event.target.selectionStart;
    state.vocabularyQuickSearch = event.target.value;
    renderVocabularyQuickPanel();
    const input = panel.querySelector('[data-vocabulary-quick-search]');
    input.focus();
    input.setSelectionRange(caret, caret);
  });
  panel.querySelector('[data-vocabulary-quick-close]').addEventListener('click', () => { panel.hidden = true; });
  panel.querySelector('[data-open-vocabulary-section]')?.addEventListener('click', () => $('.nav-btn[data-view="vocabulary"]')?.click());
  const visibleImageKeys = vocabularyImageKeys(items);
  panel.querySelectorAll('[data-vocabulary-quick-id]').forEach((card) => {
    const item = state.vocabulary.find((entry) => entry.id === card.dataset.vocabularyQuickId);
    if (!item) return;
    bindVocabularyWords(card, item, insertVocabularyWord);
    card.querySelector('[data-vocabulary-quick-image]').addEventListener('click', () => openLightbox(item.imageKey, visibleImageKeys));
  });
}

$('#btnVocabulary').addEventListener('click', () => {
  const panel = $('#vocabularyQuickPanel');
  $('#promptsPanel').hidden = true;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderVocabularyQuickPanel();
});

function renderVocabularyEditorWords() {
  const words = state.vocabularyEditor?.words || [];
  $('#vocabularyEditorWordChips').innerHTML = words.length ? words.map((word, index) => `
    <span class="vocabulary-editor-chip">${esc(word)}<button type="button" data-vocabulary-remove-word="${index}" title="Quitar">×</button></span>`).join('') : '<span class="hint">Todavía no hay palabras.</span>';
  $('#vocabularyEditorWordChips').querySelectorAll('[data-vocabulary-remove-word]').forEach((button) => button.addEventListener('click', () => {
    state.vocabularyEditor.words.splice(Number(button.dataset.vocabularyRemoveWord), 1);
    renderVocabularyEditorWords();
  }));
}

function addVocabularyEditorWords() {
  if (!state.vocabularyEditor) return;
  const input = $('#vocabularyEditorWordInput');
  state.vocabularyEditor.words = normalizeVocabularyWordsClient([
    ...state.vocabularyEditor.words,
    ...String(input.value || '').split(/[,;\n]/)
  ]);
  input.value = '';
  renderVocabularyEditorWords();
}

function renderVocabularyEditorImage() {
  const editor = state.vocabularyEditor;
  const preview = $('#vocabularyEditorPreview');
  preview.innerHTML = '';
  const source = editor?.pendingDataUrl || (editor?.imageKey ? fileUrl(editor.imageKey) : '');
  if (!source) {
    preview.innerHTML = '<span>Elegí una imagen ilustrativa</span>';
    $('#vocabularyEditorImageStatus').textContent = 'La imagen es obligatoria.';
    $('#vocabularyEditorAnalyze').disabled = true;
    return;
  }
  const image = document.createElement('img');
  image.src = source;
  image.alt = 'Vista previa del vocabulario';
  preview.appendChild(image);
  $('#vocabularyEditorAnalyze').disabled = false;
  $('#vocabularyEditorImageStatus').textContent = editor.pendingFileName || 'Imagen guardada. Podés reemplazarla.';
  if (!editor.pendingDataUrl && editor.imageKey) preview.onclick = () => openLightbox(editor.imageKey, [editor.imageKey]);
  else preview.onclick = null;
}

function openVocabularyEditor(item = null) {
  state.vocabularyEditor = {
    id: item?.id || null,
    imageKey: item?.imageKey || '',
    pendingDataUrl: '',
    pendingFileName: '',
    words: [...(item?.words || [])]
  };
  $('#vocabularyEditorTitle').textContent = item ? 'Editar ficha de vocabulario' : 'Nueva ficha de vocabulario';
  $('#vocabularyEditorName').value = item?.title || '';
  $('#vocabularyEditorCategory').value = item?.category || '';
  $('#vocabularyEditorNsfw').checked = Boolean(item?.nsfw);
  $('#vocabularyCategoryList').innerHTML = vocabularyCategories().map((category) => `<option value="${esc(category)}"></option>`).join('');
  $('#vocabularyEditorWordInput').value = '';
  renderVocabularyEditorWords();
  renderVocabularyEditorImage();
  $('#vocabularyEditorModal').hidden = false;
  setTimeout(() => $('#vocabularyEditorName').focus(), 0);
}

function closeVocabularyEditor() {
  $('#vocabularyEditorModal').hidden = true;
  $('#vocabularyEditorFile').value = '';
  state.vocabularyEditor = null;
}

async function deleteVocabularyEntry(item) {
  if (!confirm(`¿Borrar la ficha “${item.title}”?\n\nLa imagen se conservará en Assets.`)) return;
  try {
    await api(`/api/vocabulary/${item.id}`, { method: 'DELETE' });
    state.vocabulary = state.vocabulary.filter((entry) => entry.id !== item.id);
    renderVocabularyLibrary();
    renderVocabularyQuickPanel();
    toast('Ficha de vocabulario borrada');
  } catch (error) {
    toast(error.message, 'err');
  }
}

$('#btnNewVocabulary').addEventListener('click', () => openVocabularyEditor());
$('#btnImportVocabulary').addEventListener('click', () => $('#vocabularyImportInput').click());
$('#vocabularyImportInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const { imported = 0, entries = [], vocabularyCategories = [] } = await api('/api/vocabulary/import', {
      method: 'POST', body: { zipBase64: dataUrl.split(',')[1] }
    });
    state.vocabularyCategoriesExtra = vocabularyCategories;
    state.vocabulary = [...entries.filter((item) => contentIsVisible(item)), ...state.vocabulary];
    renderVocabularyLibrary();
    renderVocabularyQuickPanel();
    toast(imported ? `${imported} ficha${imported === 1 ? '' : 's'} de vocabulario importada${imported === 1 ? '' : 's'}` : 'No había fichas nuevas en el ZIP', imported ? 'ok' : 'err');
  } catch (err) { toast(`No se pudo importar: ${err.message}`, 'err'); }
});
$('#vocabularySearch').addEventListener('input', (event) => { state.vocabularySearch = event.target.value; renderVocabularyLibrary(); });
$('#vocabularyCategoryFilter').addEventListener('change', (event) => { state.vocabularyCategoryFilter = event.target.value; renderVocabularyLibrary(); });
$('#btnNewVocabularyCategory').addEventListener('click', () => openVocabularyCategoryForm());
$('#btnEditVocabularyCategory').addEventListener('click', () => {
  const category = $('#vocabularyCategoryFilter').value;
  if (isManagedVocabularyCategory(category)) openVocabularyCategoryForm(category);
});
$('#btnDeleteVocabularyCategory').addEventListener('click', async () => {
  const name = $('#vocabularyCategoryFilter').value;
  if (!isManagedVocabularyCategory(name)) return;
  if (!confirm(`¿Borrar la categoría “${name}”?\n\nLas fichas se conservarán y pasarán a General.`)) return;
  try {
    const { vocabularyCategories: updated, affected = 0 } = await api('/api/vocabulary-categories', { method: 'DELETE', body: { name } });
    state.vocabularyCategoriesExtra = updated;
    updateOpenVocabularyCategory(name, 'General');
    state.vocabularyCategoryFilter = '';
    closeVocabularyCategoryForm();
    renderVocabularyLibrary();
    renderVocabularyQuickPanel();
    toast(`Categoría “${name}” borrada${affected ? ` · ${affected} ficha${affected === 1 ? '' : 's'} movida${affected === 1 ? '' : 's'} a General` : ''}`);
  } catch (error) {
    toast(error.message, 'err');
  }
});
$('#newVocabularyCategoryCancel').addEventListener('click', closeVocabularyCategoryForm);
$('#newVocabularyCategoryName').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('#newVocabularyCategorySave').click();
  }
});
$('#newVocabularyCategorySave').addEventListener('click', async () => {
  const row = $('#newVocabularyCategoryRow');
  const editing = row.dataset.action === 'edit';
  const originalName = row.dataset.originalName || '';
  const name = $('#newVocabularyCategoryName').value.trim();
  if (!name) return toast('Escribí un nombre para la categoría.', 'err');
  try {
    const { vocabularyCategories: updated, affected = 0 } = editing
      ? await api('/api/vocabulary-categories', { method: 'PUT', body: { name: originalName, newName: name } })
      : await api('/api/vocabulary-categories', { method: 'POST', body: { name } });
    state.vocabularyCategoriesExtra = updated;
    if (editing) updateOpenVocabularyCategory(originalName, name);
    closeVocabularyCategoryForm();
    state.vocabularyCategoryFilter = name;
    renderVocabularyLibrary();
    renderVocabularyQuickPanel();
    toast(editing
      ? `Categoría actualizada${affected ? ` en ${affected} ficha${affected === 1 ? '' : 's'}` : ''}`
      : `Categoría “${name}” creada`);
  } catch (error) {
    toast(error.message, 'err');
  }
});
$('#vocabularyEditorClose').addEventListener('click', closeVocabularyEditor);
$('#vocabularyEditorCancel').addEventListener('click', closeVocabularyEditor);
$('#vocabularyEditorModal').addEventListener('click', (event) => { if (event.target.id === 'vocabularyEditorModal') closeVocabularyEditor(); });
$('#vocabularyEditorUpload').addEventListener('click', () => $('#vocabularyEditorFile').click());
$('#vocabularyEditorAnalyze').addEventListener('click', async () => {
  const editor = state.vocabularyEditor;
  if (!editor?.pendingDataUrl && !editor?.imageKey) return toast('Subí una imagen antes de analizarla.', 'err');
  const button = $('#vocabularyEditorAnalyze');
  button.disabled = true;
  $('#vocabularyEditorImageStatus').textContent = 'La IA está leyendo la jerarquía visual y separando etiquetas de títulos y descripciones…';
  try {
    const result = await api('/api/vocabulary/analyze-image', {
      method: 'POST',
      body: editor.pendingDataUrl
        ? { dataUrl: editor.pendingDataUrl, name: editor.pendingFileName || 'vocabulario.png' }
        : { imageKey: editor.imageKey }
    });
    const before = editor.words.length;
    editor.words = normalizeVocabularyWordsClient([...editor.words, ...(result.words || [])]);
    renderVocabularyEditorWords();
    const added = editor.words.length - before;
    const titleNote = result.ignoredTitle ? ` Se reconoció y omitió el título “${result.ignoredTitle}”.` : '';
    $('#vocabularyEditorImageStatus').textContent = `${result.words?.length || 0} término${result.words?.length === 1 ? '' : 's'} detectado${result.words?.length === 1 ? '' : 's'}${added !== (result.words?.length || 0) ? ` · ${added} nuevo${added === 1 ? '' : 's'}` : ''}.${titleNote}`;
    toast(`${added} palabra${added === 1 ? '' : 's'} añadida${added === 1 ? '' : 's'} por IA`);
  } catch (error) {
    $('#vocabularyEditorImageStatus').textContent = error.message;
    toast(error.message, 'err');
  } finally {
    button.disabled = !state.vocabularyEditor || (!state.vocabularyEditor.pendingDataUrl && !state.vocabularyEditor.imageKey);
  }
});
$('#vocabularyEditorAddWord').addEventListener('click', () => { addVocabularyEditorWords(); $('#vocabularyEditorWordInput').focus(); });
$('#vocabularyEditorWordInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addVocabularyEditorWords();
  }
});
$('#vocabularyEditorFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !state.vocabularyEditor) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('Usá una imagen PNG, JPG o WebP.', 'err');
  if (file.size > 100 * 1024 * 1024) return toast('La imagen supera el límite de 100 MB.', 'err');
  try {
    state.vocabularyEditor.pendingDataUrl = await readFileAsDataUrl(file);
    state.vocabularyEditor.pendingFileName = file.name;
    renderVocabularyEditorImage();
  } catch (error) {
    toast(error.message, 'err');
  }
});

$('#vocabularyEditorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const editor = state.vocabularyEditor;
  if (!editor) return;
  if ($('#vocabularyEditorWordInput').value.trim()) addVocabularyEditorWords();
  const title = $('#vocabularyEditorName').value.trim();
  const category = $('#vocabularyEditorCategory').value.trim();
  const words = normalizeVocabularyWordsClient(editor.words);
  const nsfw = $('#vocabularyEditorNsfw').checked;
  if (!title) return toast('Escribí un título para la ficha.', 'err');
  if (!category) return toast('Escribí o elegí una categoría.', 'err');
  if (!words.length) return toast('Añadí al menos una palabra.', 'err');
  if (!editor.imageKey && !editor.pendingDataUrl) return toast('Subí una imagen para esta ficha.', 'err');
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    let imageKey = editor.imageKey;
    if (editor.pendingDataUrl) {
      const uploaded = await api('/api/assets/visual', {
        method: 'POST',
        body: {
          name: editor.pendingFileName || `${title}.png`,
          dataUrl: editor.pendingDataUrl,
          category: 'Vocabulario',
          tags: [category, ...words],
          nsfw
        }
      });
      imageKey = uploaded.key;
    } else {
      await api('/api/assets/visual-metadata', {
        method: 'POST',
        body: { keys: [imageKey], category: 'Vocabulario', tags: [category, ...words], nsfw }
      });
    }
    const body = { title, category, imageKey, words, nsfw };
    const saved = editor.id
      ? await api(`/api/vocabulary/${editor.id}`, { method: 'PUT', body })
      : await api('/api/vocabulary', { method: 'POST', body });
    state.vocabulary = state.vocabulary.filter((item) => item.id !== saved.id);
    if (contentIsVisible(saved)) state.vocabulary.unshift(saved);
    closeVocabularyEditor();
    renderVocabularyLibrary();
    renderVocabularyQuickPanel();
    toast(editor.id ? 'Ficha de vocabulario actualizada' : 'Ficha de vocabulario guardada');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// snippets de código (JS/ExtendScript, Python, Bash) — biblioteca separada de
// Prompts a propósito: sin botón "Usar" hacia la caja de generación, sin
// mezclarse en ninguna lista/búsqueda de prompts.
// ---------------------------------------------------------------------------

const SNIPPET_LANGUAGE_LABELS = { javascript: 'JavaScript / ExtendScript', python: 'Python', bash: 'Bash' };

function snippetCategories() {
  const fromSnippets = state.snippets.map((s) => s.category).filter(Boolean);
  return [...new Set([...fromSnippets, ...state.snippetCategoriesExtra])].sort((a, b) => a.localeCompare(b));
}

function renderSnippetEditorCategories() {
  chipRow($('#snippetEditorCategoryChips'), snippetCategories(), $('#snippetEditorCategory').value.trim(), (c) => {
    $('#snippetEditorCategory').value = c;
    renderSnippetEditorCategories();
  });
}

function openSnippetEditor(snippet = null) {
  state.snippetEditor = { id: snippet?.id || null };
  $('#snippetEditorTitle').textContent = snippet ? 'Editar snippet' : 'Guardar snippet';
  $('#snippetEditorName').value = snippet?.title || '';
  $('#snippetEditorLanguage').value = snippet?.language || 'javascript';
  $('#snippetEditorCategory').value = snippet?.category || '';
  $('#snippetEditorCode').value = snippet?.code || '';
  $('#snippetEditorNotes').value = snippet?.notes || '';
  renderSnippetEditorCategories();
  $('#snippetEditorModal').hidden = false;
  setTimeout(() => $('#snippetEditorName').focus(), 0);
}

function closeSnippetEditor() {
  $('#snippetEditorModal').hidden = true;
  state.snippetEditor = null;
}

$('#btnNewSnippet').addEventListener('click', () => openSnippetEditor());
$('#snippetEditorClose').addEventListener('click', closeSnippetEditor);
$('#snippetEditorCancel').addEventListener('click', closeSnippetEditor);
$('#snippetEditorModal').addEventListener('click', (e) => { if (e.target.id === 'snippetEditorModal') closeSnippetEditor(); });
$('#snippetEditorCategory').addEventListener('input', renderSnippetEditorCategories);

function openSnippetView(sn) {
  $('#snippetViewTitle').textContent = sn.title;
  $('#snippetViewMeta').textContent = `${SNIPPET_LANGUAGE_LABELS[sn.language] || sn.language}${sn.category ? ` · ${sn.category}` : ''}`;
  const codeEl = $('#snippetViewCode');
  codeEl.className = `language-${sn.language}`;
  codeEl.textContent = sn.code;
  window.Prism?.highlightElement(codeEl);
  $('#snippetViewNotes').hidden = !sn.notes;
  $('#snippetViewNotes').textContent = sn.notes || '';
  $('#snippetViewCopy').onclick = () => copyPrompt(sn.code);
  $('#snippetViewEdit').onclick = () => { closeSnippetView(); openSnippetEditor(sn); };
  $('#snippetViewModal').hidden = false;
}

function closeSnippetView() {
  $('#snippetViewModal').hidden = true;
}

$('#snippetViewClose').addEventListener('click', closeSnippetView);
$('#snippetViewModal').addEventListener('click', (e) => { if (e.target.id === 'snippetViewModal') closeSnippetView(); });

$('#snippetEditorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editor = state.snippetEditor || {};
  const body = {
    title: $('#snippetEditorName').value.trim(),
    language: $('#snippetEditorLanguage').value,
    category: $('#snippetEditorCategory').value.trim(),
    code: $('#snippetEditorCode').value,
    notes: $('#snippetEditorNotes').value.trim()
  };
  if (!body.title || !body.code.trim()) return toast('Falta el título o el código', 'err');
  try {
    if (editor.id) {
      const updated = await api(`/api/snippets/${editor.id}`, { method: 'PUT', body });
      state.snippets[state.snippets.findIndex((s) => s.id === editor.id)] = updated;
      toast('Snippet actualizado');
    } else {
      const item = await api('/api/snippets', { method: 'POST', body });
      state.snippets.unshift(item);
      toast('Snippet guardado');
    }
    closeSnippetEditor();
    renderSnippetLibrary();
  } catch (err) {
    toast(err.message, 'err');
  }
});

function renderSnippetLibrary() {
  const library = $('#snippetLibrary');
  if (!library) return;
  const categories = snippetCategories();
  const filter = $('#snippetCategoryFilter');
  const selectedCategory = filter.value;
  filter.innerHTML = '<option value="">Todas las categorías</option>' + categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  filter.value = selectedCategory;
  updateSnippetCategoryActions();
  const language = $('#snippetLanguageFilter').value;
  const query = $('#snippetSearch').value.trim().toLowerCase();
  const items = state.snippets.filter((s) => (!language || s.language === language)
    && (!selectedCategory || s.category === selectedCategory)
    && (!query || `${s.title} ${s.code} ${s.notes} ${s.category || ''}`.toLowerCase().includes(query)));
  library.innerHTML = items.length ? items.map((sn) => `
    <article class="prompt-library-card" data-snippet="${sn.id}">
      <div class="prompt-library-head"><div>${sn.category ? `<span class="prompt-category">${esc(sn.category)}</span>` : ''}<h3>${esc(sn.title)}</h3></div><span class="snippet-lang-badge">${esc(SNIPPET_LANGUAGE_LABELS[sn.language] || sn.language)}</span></div>
      <pre class="snippet-code-block"><code class="language-${esc(sn.language)}">${esc(sn.code)}</code></pre>
      ${sn.notes ? `<div class="prompt-library-text">${esc(sn.notes)}</div>` : ''}
      <div class="prompt-library-actions"><button class="mini-btn" data-sact="view">${IC('eye')} Ver</button><button class="mini-btn" data-sact="copy">${IC('copy')} Copiar</button><button class="mini-btn" data-sact="edit">${IC('edit')} Editar</button><button class="mini-btn danger" data-sact="delete">${IC('trash')}</button></div>
    </article>`).join('') : '<div class="empty-note">No hay snippets que coincidan.</div>';
  library.querySelectorAll('[data-snippet]').forEach((card) => {
    const sn = state.snippets.find((s) => s.id === card.dataset.snippet);
    card.querySelector('[data-sact="view"]').addEventListener('click', () => openSnippetView(sn));
    card.querySelector('[data-sact="copy"]').addEventListener('click', () => copyPrompt(sn.code));
    card.querySelector('[data-sact="edit"]').addEventListener('click', () => openSnippetEditor(sn));
    card.querySelector('[data-sact="delete"]').addEventListener('click', async () => {
      if (!confirm(`¿Borrar “${sn.title}”?`)) return;
      await api(`/api/snippets/${sn.id}`, { method: 'DELETE' });
      state.snippets = state.snippets.filter((s) => s.id !== sn.id);
      renderSnippetLibrary();
    });
  });
  window.Prism?.highlightAllUnder(library);
}

$('#snippetSearch').addEventListener('input', renderSnippetLibrary);
$('#snippetLanguageFilter').addEventListener('change', renderSnippetLibrary);
$('#snippetCategoryFilter').addEventListener('change', renderSnippetLibrary);

function updateSnippetCategoryActions() {
  const selected = Boolean($('#snippetCategoryFilter').value);
  $('#btnEditSnippetCategory').hidden = !selected;
  $('#btnDeleteSnippetCategory').hidden = !selected;
}

function openSnippetCategoryForm(category = '') {
  const row = $('#newSnippetCategoryRow');
  const editing = Boolean(category);
  row.dataset.action = editing ? 'edit' : 'create';
  row.dataset.originalName = category;
  row.hidden = false;
  $('#newSnippetCategoryName').value = category;
  $('#newSnippetCategorySave').textContent = editing ? 'Guardar cambios' : 'Crear';
  $('#newSnippetCategoryName').focus();
  $('#newSnippetCategoryName').select();
}

function closeSnippetCategoryForm() {
  const row = $('#newSnippetCategoryRow');
  row.hidden = true;
  row.dataset.action = '';
  row.dataset.originalName = '';
  $('#newSnippetCategorySave').textContent = 'Crear';
}

function updateOpenSnippetCategory(oldName, newName) {
  state.snippets = state.snippets.map((snippet) => (
    sameCategoryName(snippet.category, oldName) ? { ...snippet, category: newName } : snippet
  ));
  if (!$('#snippetEditorModal').hidden && sameCategoryName($('#snippetEditorCategory').value, oldName)) {
    $('#snippetEditorCategory').value = newName;
    renderSnippetEditorCategories();
  }
}

$('#btnNewSnippetCategory').addEventListener('click', () => openSnippetCategoryForm());
$('#btnEditSnippetCategory').addEventListener('click', () => {
  const category = $('#snippetCategoryFilter').value;
  if (category) openSnippetCategoryForm(category);
});
$('#btnDeleteSnippetCategory').addEventListener('click', async () => {
  const name = $('#snippetCategoryFilter').value;
  if (!name) return;
  if (!confirm(`¿Borrar la categoría “${name}”?\n\nLos snippets que la usan se conservarán sin categoría.`)) return;
  try {
    const { snippetCategories: updated, affected = 0 } = await api('/api/snippet-categories', { method: 'DELETE', body: { name } });
    state.snippetCategoriesExtra = updated;
    updateOpenSnippetCategory(name, '');
    $('#snippetCategoryFilter').value = '';
    closeSnippetCategoryForm();
    renderSnippetLibrary();
    toast(`Categoría “${name}” borrada${affected ? ` · ${affected} snippet${affected === 1 ? '' : 's'} conservado${affected === 1 ? '' : 's'} sin categoría` : ''}`);
  } catch (err) {
    toast(err.message, 'err');
  }
});
$('#newSnippetCategoryCancel').addEventListener('click', closeSnippetCategoryForm);
$('#newSnippetCategoryName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#newSnippetCategorySave').click(); } });
$('#newSnippetCategorySave').addEventListener('click', async () => {
  const row = $('#newSnippetCategoryRow');
  const editing = row.dataset.action === 'edit';
  const originalName = row.dataset.originalName || '';
  const name = $('#newSnippetCategoryName').value.trim();
  if (!name) return toast('Escribí un nombre para la categoría', 'err');
  try {
    const { snippetCategories: updated, affected = 0 } = editing
      ? await api('/api/snippet-categories', { method: 'PUT', body: { name: originalName, newName: name } })
      : await api('/api/snippet-categories', { method: 'POST', body: { name } });
    state.snippetCategoriesExtra = updated;
    if (editing) updateOpenSnippetCategory(originalName, name);
    closeSnippetCategoryForm();
    renderSnippetLibrary();
    $('#snippetCategoryFilter').value = name;
    renderSnippetLibrary();
    toast(editing
      ? `Categoría actualizada${affected ? ` en ${affected} snippet${affected === 1 ? '' : 's'}` : ''}`
      : `Categoría "${name}" creada`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

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

function normalizedAssetFilterText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

function visibleAssets() {
  const search = normalizedAssetFilterText(state.assetFilterSearch);
  const category = normalizedAssetFilterText(state.assetFilterCategory);
  const requiredTags = splitVisualTags(state.assetFilterTags).map(normalizedAssetFilterText);
  return (state.assets[state.assetsZone] || []).filter((a) =>
    (!state.assetRange.from || a.mtime >= state.assetRange.from)
    && (!state.assetRange.to || a.mtime <= state.assetRange.to)
    && (state.assetsZone !== 'audio' || state.assetAudioKind === 'all' || (a.audioKind || 'voice') === state.assetAudioKind)
    && (state.assetsZone === 'audio' || !search || normalizedAssetFilterText([a.name, a.prompt, a.category, ...(a.tags || [])].join(' ')).includes(search))
    && (state.assetsZone === 'audio' || !category || normalizedAssetFilterText(a.category) === category)
    && (state.assetsZone === 'audio' || !requiredTags.length || requiredTags.every((wanted) =>
      (a.tags || []).some((tag) => normalizedAssetFilterText(tag).includes(wanted))))
    && assetMatchesCharacter(a, state.assetFilterCharacterId)
    && assetMatchesSeries(a, state.assetFilterSeriesId));
}

function toggleAssetSelection(key) {
  state.selectedAssets.has(key) ? state.selectedAssets.delete(key) : state.selectedAssets.add(key);
  renderAssetsGrid();
}

function updateAssetSelection() {
  const n = state.selectedAssets.size;
  $('#selectedCount').textContent = n;
  $('#btnDeleteSelected').disabled = !n;
  $('#seriesSelectedCount').textContent = n;
  $('#btnSeriesSelected').disabled = !n;
  $('#downloadSelectedCount').textContent = n;
  $('#btnDownloadSelected').disabled = !n;
  $('#classifySelectedCount').textContent = n;
  $('#btnClassifySelected').disabled = !n || state.assetsZone === 'audio';
  $('#duplicateSelectedCount').textContent = n;
  $('#btnDuplicateSelected').disabled = !n;
}

// descarga en lote: pide el ZIP y lo baja vía blob (el POST no puede ser un link)
async function downloadAssets(keys) {
  if (!keys.length) return;
  const btn = $('#btnDownloadSelected');
  btn.disabled = true;
  try {
    const res = await fetch('/api/assets/zip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `manifestador-${keys.length}-assets.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast(`${keys.length} asset${keys.length === 1 ? '' : 's'} descargado${keys.length === 1 ? '' : 's'} en un ZIP`);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    updateAssetSelection();
  }
}
$('#btnDownloadSelected').addEventListener('click', () => downloadAssets([...state.selectedAssets]));

async function deleteAssets(keys) {
  if (!keys.length) return;
  if (!confirm(`¿Borrar definitivamente ${keys.length} archivo${keys.length === 1 ? '' : 's'} del disco?\n\nEsta acción no se puede deshacer.`)) return;
  const result = await api('/api/assets/delete', { method: 'POST', body: { keys } });
  keys.forEach((key) => state.selectedAssets.delete(key));
  state.series.forEach((s) => { s.assetKeys = (s.assetKeys || []).filter((key) => !keys.includes(key)); });
  state.automations.forEach((project) => {
    (project.blocks || []).forEach((block) => {
      block.assetKeys = (block.assetKeys || []).filter((key) => !keys.includes(key));
    });
    Object.values(project.outputs || {}).forEach((output) => {
      if (keys.includes(output.imageKey)) output.imageKey = null;
      if (keys.includes(output.textImageKey)) output.textImageKey = null;
      if (keys.includes(output.textLayerKey)) output.textLayerKey = null;
      if (keys.includes(output.motionOverlayKey)) output.motionOverlayKey = null;
      if (keys.includes(output.videoKey)) output.videoKey = null;
      output.assetKeys = (output.assetKeys || []).filter((key) => !keys.includes(key));
      output.audioKeys = (output.audioKeys || []).filter((key) => !keys.includes(key));
    });
    if (keys.includes(project.config?.music?.assetKey)) project.config.music.assetKey = '';
    if (keys.includes(project.finalOutput?.videoKey)) project.finalOutput = null;
    else if (keys.includes(project.finalOutput?.musicKey)) project.finalOutput.musicKey = null;
    if (keys.includes(project.effectOutput?.videoKey) || keys.includes(project.effectOutput?.sourceVideoKey) || !project.finalOutput) {
      project.effectOutput = null;
    }
  });
  state.history = result.history;
  renderHistory();
  await refreshAssets();
  toast(`${result.deleted} asset${result.deleted === 1 ? '' : 's'} eliminado${result.deleted === 1 ? '' : 's'}`);
  return true;
}

async function duplicateAssets(keys) {
  if (!keys.length) return;
  try {
    const result = await api('/api/assets/duplicate', { method: 'POST', body: { keys } });
    await refreshAssets();
    toast(`${result.keys.length} asset${result.keys.length === 1 ? '' : 's'} duplicado${result.keys.length === 1 ? '' : 's'}`);
    return result.keys;
  } catch (e) {
    toast(e.message, 'err');
  }
}

$('#btnDeleteSelected').addEventListener('click', () => deleteAssets([...state.selectedAssets]));
$('#btnDuplicateSelected').addEventListener('click', () => duplicateAssets([...state.selectedAssets]));
$('#btnSeriesSelected').addEventListener('click', () => openSeriesAssign([...state.selectedAssets]));
$('#btnClassifySelected').addEventListener('click', () => {
  const selected = [...state.selectedAssets];
  const first = [...state.assets.generated, ...state.assets.uploads, ...state.assets.video].find((item) => item.key === selected[0]);
  openVisualClassify(selected, selected.length === 1 ? first || {} : {});
});
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

const assetAudioPlayer = $('#assetAudioPlayer');
const playingAudio = $('#assetPlayerAudio');
let assetAudioKey = '';

function assetAudioItems() {
  const all = state.assets.audio || [];
  if (state.assetsZone !== 'audio') return all;
  const visible = visibleAssets();
  return visible.some((item) => item.key === assetAudioKey) ? visible : all;
}

function syncAssetAudioTiles() {
  const isPlaying = assetAudioKey && !playingAudio.paused && !playingAudio.ended;
  $$('.audio-tile').forEach((tile) => {
    const active = tile.dataset.audiokey === assetAudioKey && isPlaying;
    tile.dataset.playing = active ? '1' : '';
    const icon = tile.querySelector('.audio-tile-icon');
    if (icon) icon.innerHTML = IC(active ? 'pause' : 'play', 'ic ic-lg');
  });
}

function updateAssetAudioPlayer() {
  if (!assetAudioKey) return;
  const item = (state.assets.audio || []).find((entry) => entry.key === assetAudioKey);
  const items = assetAudioItems();
  const index = items.findIndex((entry) => entry.key === assetAudioKey);
  const kind = item?.audioKind || 'voice';
  $('#assetPlayerKind').textContent = AUDIO_KIND_LABELS[kind] || 'Audio';
  $('#assetPlayerName').textContent = item?.name || sbAudioName(assetAudioKey);
  $('#assetPlayerPosition').textContent = index >= 0 ? `${index + 1} / ${items.length}` : '';
  $('#assetPlayerPrev').disabled = index <= 0;
  $('#assetPlayerNext').disabled = index < 0 || index >= items.length - 1;
}

function openAssetAudioPlayer(key, autoplay = true) {
  const changed = assetAudioKey !== key;
  assetAudioKey = key;
  assetAudioPlayer.hidden = false;
  document.body.classList.add('asset-player-open');
  if (changed) {
    playingAudio.src = fileUrl(key);
    playingAudio.load();
  }
  updateAssetAudioPlayer();
  syncAssetAudioTiles();
  if (autoplay) playingAudio.play().catch(() => toast('No se pudo reproducir este audio', 'err'));
}

function toggleAudioPlay(card, key) {
  const sameTrack = assetAudioKey === key;
  assetAudioPlayer.hidden = false;
  document.body.classList.add('asset-player-open');
  if (!sameTrack) return openAssetAudioPlayer(key);
  updateAssetAudioPlayer();
  if (playingAudio.paused || playingAudio.ended) playingAudio.play().catch(() => toast('No se pudo reproducir este audio', 'err'));
  else playingAudio.pause();
}

function navigateAssetAudio(direction) {
  const items = assetAudioItems();
  const index = items.findIndex((entry) => entry.key === assetAudioKey);
  const next = items[index + direction];
  if (next) openAssetAudioPlayer(next.key);
}

function closeAssetAudioPlayer() {
  playingAudio.pause();
  assetAudioKey = '';
  playingAudio.removeAttribute('src');
  playingAudio.load();
  assetAudioPlayer.hidden = true;
  document.body.classList.remove('asset-player-open');
  syncAssetAudioTiles();
}

playingAudio.addEventListener('play', syncAssetAudioTiles);
playingAudio.addEventListener('pause', syncAssetAudioTiles);
playingAudio.addEventListener('ended', syncAssetAudioTiles);
playingAudio.addEventListener('error', () => {
  if (assetAudioKey) toast('El reproductor no pudo abrir este archivo', 'err');
  syncAssetAudioTiles();
});
$('#assetPlayerPrev').addEventListener('click', () => navigateAssetAudio(-1));
$('#assetPlayerNext').addEventListener('click', () => navigateAssetAudio(1));
$('#assetPlayerClose').addEventListener('click', closeAssetAudioPlayer);

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

function isReusableImageKey(key) {
  return /^(generated|uploads|characters|elements)\//.test(String(key));
}

function closeLightbox() {
  document.querySelector('#lightbox').hidden = true;
  const v = $('#lbVideo');
  v.pause();
  v.removeAttribute('src');
  state.lightboxRefRemover = null;
}

// opts.refRemover: si el lightbox se abre desde una tira de referencias (no
// desde Assets), pasar (key) => boolean que quite esa key de la selección
// actual y devuelva true si lo hizo. Mientras esté seteado, Delete quita la
// referencia en vez de borrar el archivo del disco.
function openLightbox(key, keys = null, opts = {}) {
  state.lightboxKeys = keys?.length ? [...new Set(keys)] : [key];
  state.lightboxIndex = Math.max(0, state.lightboxKeys.indexOf(key));
  state.lightboxRefRemover = typeof opts.refRemover === 'function' ? opts.refRemover : null;
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
    ${!isVideo && isReusableImageKey(key) ? `<button class="mini-btn" id="lbAssociate">${IC('user')} Asociar a personaje/elemento</button>` : ''}
    <button class="mini-btn" id="lbSeries">${IC('layers')} Asociar a serie</button>
    ${!isVideo && isReusableImageKey(key) ? `<button class="mini-btn" id="lbCharacter">${IC('user')} Convertir en personaje</button>` : ''}
    ${!isVideo ? `<button class="mini-btn" id="lbPhotoshop">${IC('pen')} Abrir en Photoshop</button>` : ''}
    ${/^(generated|uploads|audio|video)\//.test(key) ? `<button class="mini-btn" id="lbDuplicate">${IC('copy')} Duplicar</button>` : ''}
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
  $('#lbDuplicate')?.addEventListener('click', () => duplicateAssets([key]));
}

function navigateLightbox(delta) {
  if (state.lightboxKeys.length < 2) return;
  state.lightboxIndex = (state.lightboxIndex + delta + state.lightboxKeys.length) % state.lightboxKeys.length;
  const refRemover = state.lightboxRefRemover;
  openLightbox(state.lightboxKeys[state.lightboxIndex], state.lightboxKeys, { refRemover });
}
$('#lbPrev').addEventListener('click', () => navigateLightbox(-1));
$('#lbNext').addEventListener('click', () => navigateLightbox(1));

// Delete mientras se está viendo un asset en el lightbox: borra el archivo del
// disco (misma confirmación y limpieza que el borrado en masa de Assets) y
// pasa al siguiente de la tanda, o cierra si era el único.
async function deleteLightboxAsset() {
  const key = state.lightboxKeys[state.lightboxIndex];
  if (!key) return;
  const remaining = state.lightboxKeys.filter((k) => k !== key);
  const deleted = await deleteAssets([key]);
  if (!deleted) return;
  if (!remaining.length) { closeLightbox(); return; }
  state.lightboxKeys = remaining;
  state.lightboxIndex = Math.min(state.lightboxIndex, remaining.length - 1);
  openLightbox(state.lightboxKeys[state.lightboxIndex], state.lightboxKeys);
}

// Espejo de deleteLightboxAsset(): si quedan más referencias en la tira,
// sigue mostrándolas en vez de cerrar el visor de una.
function removeLightboxRef() {
  const key = state.lightboxKeys[state.lightboxIndex];
  if (!key || !state.lightboxRefRemover(key)) return;
  const remover = state.lightboxRefRemover;
  const remaining = state.lightboxKeys.filter((k) => k !== key);
  if (!remaining.length) { closeLightbox(); return; }
  state.lightboxKeys = remaining;
  state.lightboxIndex = Math.min(state.lightboxIndex, remaining.length - 1);
  openLightbox(state.lightboxKeys[state.lightboxIndex], state.lightboxKeys, { refRemover: remover });
}

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
  const isAudio = asset.key?.startsWith('audio/');
  const isVideo = asset.key?.startsWith('video/');
  const audioKind = asset.audioKind || 'voice';
  const musicTags = asset.musicTags || { genres: [], instruments: [], moods: [] };
  const automationProjectLabel = automationAssetProjectLabel(asset);
  const character = state.characters.find((c) => c.id === asset.characterId);
  const variant = (character?.variants || []).find((v) => v.id === asset.characterVariantId);
  const rows = [
    ['Modelo', asset.modelName || asset.modelId || 'Sin información'],
    ['Tipo', isAudio ? AUDIO_KIND_LABELS[audioKind] || 'Audio' : isVideo ? 'Video' : asset.type || 'Imagen'],
    ...(automationProjectLabel ? [['Proyecto', automationProjectLabel], ['Origen', 'Generado por el Automatizador']] : []),
    ...(!isAudio ? [['Categoría', asset.category || '—'], ['Etiquetas', (asset.tags || []).join(', ') || '—']] : []),
    ...(isAudio ? [['Duración', '__DUR__']] : []),
    ['Proporción', asset.aspectRatio || '—'], ['Resolución', asset.resolution || '—'],
    ['Lote', asset.batch || 1], ['Referencias', (asset.refs || []).length],
    ['Personaje', character ? `${character.name} · ${variant?.name || 'Original'}` : '—'],
    ['Fecha', asset.ts ? fmtDate(asset.ts) : '—'], ['Costo estimado', asset.cost ? `$${Number(asset.cost).toFixed(4)}` : '—']
  ];
  const baseName = decodeURIComponent(asset.key.split('/').pop() || '').replace(/\.[^.]+$/, '');
  const ext = (asset.key.match(/\.[^.]+$/) || [''])[0];
  $('#assetInfoBody').innerHTML = `
    ${asset.key && !isAudio ? (isVideo
      ? `<video class="asset-info-preview" src="${fileUrl(asset.key)}" controls preload="metadata"></video>`
      : `<img class="asset-info-preview" src="${fileUrl(asset.key)}" alt="">`) : ''}
    <div class="asset-info-rename">
      <span>Nombre del archivo</span>
      <div><input id="assetRenameInput" type="text" maxlength="80" value="${esc(baseName)}"><span class="asset-info-ext">${esc(ext)}</span><button class="mini-btn" id="assetRenameBtn">Renombrar</button></div>
    </div>
    <div class="asset-info-grid">${rows.map(([label, value]) => `<div><span>${label}</span><strong>${value === '__DUR__' ? `<span class="audio-dur" data-durkey="${esc(asset.key)}">…</span>` : esc(value)}</strong></div>`).join('')}</div>
    ${isAudio ? `<div class="asset-info-audio-action"><button type="button" class="generate-btn small" id="assetInfoPlay">${IC('play')} Abrir en el reproductor</button></div><div class="audio-metadata-editor">
      <h4>Clasificación del audio</h4>
      <label>Tipo<select class="select" id="assetAudioKind">${[['voice', 'Voz'], ['music', 'Música'], ['sound', 'Sonido']].map(([value, label]) => `<option value="${value}"${audioKind === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <div id="assetMusicFields" class="audio-music-fields"${audioKind === 'music' ? '' : ' hidden'}>
        <label>Género<input id="assetMusicGenres" type="text" value="${esc((musicTags.genres || []).join(', '))}" placeholder="ambient, orchestral"></label>
        <label>Instrumentos<input id="assetMusicInstruments" type="text" value="${esc((musicTags.instruments || []).join(', '))}" placeholder="piano, strings"></label>
        <label>Sentimientos<input id="assetMusicMoods" type="text" value="${esc((musicTags.moods || []).join(', '))}" placeholder="mysterious, tense"></label>
      </div>
      <label class="check-row"><input id="assetAudioNsfw" type="checkbox"${asset.nsfw ? ' checked' : ''}> Contenido NSFW</label>
      <button type="button" class="mini-btn" id="assetAudioMetadataSave">Guardar clasificación</button>
    </div>` : ''}
    ${!isAudio ? `<div class="visual-metadata-editor">
      <h4>Clasificación visual</h4>
      <label>Categoría<input id="assetVisualCategory" type="text" maxlength="80" list="visualCategoryList" value="${esc(asset.category || '')}" placeholder="Ej: Archivo histórico"></label>
      <label>Etiquetas<input id="assetVisualTags" type="text" maxlength="500" value="${esc((asset.tags || []).join(', '))}" placeholder="noir, ciudad, noche"></label>
      <label class="check-row"><input id="assetVisualNsfw" type="checkbox"${asset.nsfw ? ' checked' : ''}> Contenido NSFW</label>
      <span class="hint">Separá las etiquetas con comas. Podrás combinarlas desde los filtros de Assets.</span>
      <button type="button" class="mini-btn" id="assetVisualMetadataSave">Guardar clasificación</button>
    </div>` : ''}
    <div class="asset-info-prompt"><div><span>Prompt utilizado</span>${asset.prompt ? `<button class="mini-btn" id="assetInfoCopy">${IC('copy')} Copiar</button>` : ''}</div><pre>${esc(asset.prompt || 'No hay prompt guardado para este asset.')}</pre></div>`;
  fillAudioDurations($('#assetInfoBody'));
  $('#assetInfoPlay')?.addEventListener('click', () => {
    $('#assetInfoModal').hidden = true;
    openAssetAudioPlayer(asset.key);
  });
  $('#assetInfoCopy')?.addEventListener('click', () => copyPrompt(asset.prompt));
  $('#assetRenameBtn').addEventListener('click', () => renameAsset(asset.key, $('#assetRenameInput').value));
  $('#assetRenameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); renameAsset(asset.key, e.target.value); } });
  $('#assetAudioKind')?.addEventListener('change', () => { $('#assetMusicFields').hidden = $('#assetAudioKind').value !== 'music'; });
  $('#assetAudioMetadataSave')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const updated = await api('/api/assets/audio-metadata', {
        method: 'POST',
        body: {
          key: asset.key,
          audioKind: $('#assetAudioKind').value,
          nsfw: $('#assetAudioNsfw').checked,
          musicTags: {
            genres: splitMusicTags($('#assetMusicGenres').value),
            instruments: splitMusicTags($('#assetMusicInstruments').value),
            moods: splitMusicTags($('#assetMusicMoods').value)
          }
        }
      });
      Object.assign(asset, updated);
      await refreshAssets();
      openAssetInfo(asset);
      toast('Clasificación de audio guardada.', 'ok');
    } catch (error) {
      event.currentTarget.disabled = false;
      toast(error.message, 'err');
    }
  });
  $('#assetVisualMetadataSave')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const result = await api('/api/assets/visual-metadata', {
        method: 'POST',
        body: {
          key: asset.key,
          category: $('#assetVisualCategory').value.trim(),
          tags: splitVisualTags($('#assetVisualTags').value),
          nsfw: $('#assetVisualNsfw').checked
        }
      });
      Object.assign(asset, result.metadata?.[asset.key] || {});
      await refreshAssets();
      $('#assetInfoModal').hidden = true;
      toast('Clasificación visual guardada.');
    } catch (error) {
      event.currentTarget.disabled = false;
      toast(error.message, 'err');
    }
  });
  $('#assetInfoModal').hidden = false;
}

// renombra el archivo del asset y recarga las colecciones que lo referencian
async function renameAsset(oldKey, name) {
  const clean = String(name || '').trim();
  if (!clean) return toast('Poné un nombre', 'err');
  try {
    const res = await api('/api/assets/rename', { method: 'POST', body: { key: oldKey, name: clean } });
    const s = await api('/api/state');
    state.assetLinks = s.assetLinks || [];
    state.elementLinks = s.elementLinks || [];
    state.series = s.series || [];
    state.scripts = s.scripts || [];
    state.automations = s.automations || [];
    state.history = s.history || [];
    await refreshAssets();
    $('#assetInfoModal').hidden = true;
    toast(`Renombrado a “${res.name}”`);
  } catch (err) {
    toast(err.message, 'err');
  }
}
$('#assetInfoClose').addEventListener('click', () => { $('#assetInfoModal').hidden = true; });
$('#assetInfoModal').addEventListener('click', (e) => { if (e.target.id === 'assetInfoModal') $('#assetInfoModal').hidden = true; });

function associationIsElement() {
  return $('#associateTargetType').value === 'element';
}

const NEW_ASSOCIATION_VARIANT = '__new__';

function toggleAssociationNewVariant() {
  const creating = $('#associateVariant').value === NEW_ASSOCIATION_VARIANT;
  $('#associateNewVariantFields').hidden = !creating;
  if (creating) setTimeout(() => $('#associateNewVariantName').focus(), 0);
}

function resetAssociationNewVariant() {
  $('#associateNewVariantName').value = '';
  $('#associateNewVariantDescription').value = '';
  $('#associateNewVariantFields').hidden = true;
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
  resetAssociationNewVariant();
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
  $('#associateVariant').innerHTML = '<option value="">Original</option>'
    + (owner?.variants || []).map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')
    + `<option value="${NEW_ASSOCIATION_VARIANT}">＋ Crear nueva variante…</option>`;
  $('#associateVariant').value = selected;
  toggleAssociationNewVariant();
}

$('#associateTargetType').addEventListener('change', () => { resetAssociationNewVariant(); renderAssociationOwners(); });
$('#associateCharacter').addEventListener('change', () => { resetAssociationNewVariant(); renderAssociationVariants(); });
$('#associateVariant').addEventListener('change', toggleAssociationNewVariant);
$('#associateAssetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = state.pendingAssociationKey;
  const isElement = associationIsElement();
  const ownerId = $('#associateCharacter').value;
  let variantId = $('#associateVariant').value || null;
  try {
    if (variantId === NEW_ASSOCIATION_VARIANT) {
      const name = $('#associateNewVariantName').value.trim();
      const description = $('#associateNewVariantDescription').value.trim();
      if (!name) {
        $('#associateNewVariantName').focus();
        return toast('Poné un nombre para la nueva variante', 'err');
      }
      const owners = isElement ? state.elements : state.characters;
      const ownerBefore = owners.find((item) => item.id === ownerId);
      const previousIds = new Set((ownerBefore?.variants || []).map((variant) => variant.id));
      const base = isElement ? `/api/elements/${ownerId}/variants` : `/api/characters/${ownerId}/variants`;
      const updated = await api(base, { method: 'POST', body: { name, description } });
      const created = (updated.variants || []).find((variant) => !previousIds.has(variant.id));
      if (!created) throw new Error('La variante se guardó, pero no pude identificarla para asociar el asset.');
      owners[owners.findIndex((item) => item.id === ownerId)] = updated;
      variantId = created.id;
      renderAssociationVariants(variantId);
    }
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
function closeAssociateAsset() {
  $('#associateAssetModal').hidden = true;
  state.pendingAssociationKey = null;
  resetAssociationNewVariant();
}
$('#associateAssetClose').addEventListener('click', closeAssociateAsset);
$('#associateAssetCancel').addEventListener('click', closeAssociateAsset);
$('#associateAssetModal').addEventListener('click', (e) => { if (e.target.id === 'associateAssetModal') closeAssociateAsset(); });
$('#lbClose').addEventListener('click', () => { closeLightbox(); });
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (!$('#lightbox').hidden && e.key === 'ArrowLeft') { e.preventDefault(); navigateLightbox(-1); return; }
  if (!$('#lightbox').hidden && e.key === 'ArrowRight') { e.preventDefault(); navigateLightbox(1); return; }
  if (!$('#lightbox').hidden && e.key === 'Delete') {
    e.preventDefault();
    if (state.lightboxRefRemover) removeLightboxRef();
    else deleteLightboxAsset();
    return;
  }
  if (e.key === 'Escape') {
    closeLightbox(); $('#pickerModal').hidden = true; $('#charModal').hidden = true;
    closeAudioUpload();
    $('#characterGalleryModal').hidden = true; $('#variantEditorModal').hidden = true; $('#associateAssetModal').hidden = true;
    $('#assetInfoModal').hidden = true;
    $('#seriesModal').hidden = true; $('#seriesAssignModal').hidden = true; state.editingSeriesId = null;
    $('#charAssetPickerModal').hidden = true; state.charAssetPicker = null;
    $('#shotPromptModal').hidden = true; state.shotPromptTarget = null;
    $('#elementModal').hidden = true; state.editingElementId = null;
    if (!$('#shotAssetsModal').hidden) closeShotAssets();
    $('#promptEditorModal').hidden = true; state.promptEditor = null;
    $('#snippetEditorModal').hidden = true; state.snippetEditor = null;
    $('#snippetViewModal').hidden = true;
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
  const visibleCharacters = state.characters.filter(contentIsVisible);
  if (!visibleCharacters.length) {
    wrap.innerHTML = '<span class="hint">Todavía no hay personajes creados.</span>';
    return;
  }
  wrap.innerHTML = '';
  for (const c of visibleCharacters) {
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
      const assetCount = (sc.scenes || []).reduce((n, s) => n + (s.shots || []).reduce((m, sh) => m + (sh.assetKeys || []).length + (sh.audioKeys || []).length, 0), 0);
      return `<div class="script-row" data-script="${sc.id}">
        <div>
          <strong>${esc(sc.title)}</strong>
          <div class="hint">${sc.scenes.length} escena${sc.scenes.length === 1 ? '' : 's'} · ${shots} plano${shots === 1 ? '' : 's'} · ${esc(sc.format)}${sc.source === 'hookcast' ? ' · importado de Hookcast' : ''} · ${fmtDate(sc.updatedAt || sc.ts)}</div>
        </div>
        <div class="script-row-actions">
          <button class="mini-btn accent" data-sact="view">${IC('eye')} Ver</button>
          <button class="mini-btn" data-sact="open">${IC('edit')} Editar guion</button>
          <button class="mini-btn" data-sact="assign">${IC('image')} Asignar assets</button>
          ${assetCount ? `<a class="mini-btn" href="/api/scripts/${sc.id}/export" download title="ZIP con los ${assetCount} assets asignados, nombrados por escena y plano">${IC('download')} Exportar assets (${assetCount})</a>` : ''}
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

// chip de audio reproducible (storyboard y Ver guion)
function sbAudioName(key) {
  return decodeURIComponent(key.split('/').pop() || key).replace(/\.[^.]+$/, '');
}
function audioChipHtml(key) {
  return `<button class="sb-audio-chip" data-audiokey="${esc(key)}" title="${esc(key)}">${IC('play')} ${esc(sbAudioName(key))}<span class="audio-dur" data-durkey="${esc(key)}"></span></button>`;
}

// duración de un audio, leída en el cliente (con caché) y rellenada donde
// aparezca un <span class="audio-dur" data-durkey="...">
const audioDurCache = new Map();
function fmtDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fillAudioDurations(root = document) {
  root.querySelectorAll('[data-durkey]').forEach((el) => {
    if (el.dataset.filled) return;
    const key = el.dataset.durkey;
    if (audioDurCache.has(key)) { el.textContent = audioDurCache.get(key); el.dataset.filled = '1'; return; }
    const a = new Audio();
    a.preload = 'metadata';
    let done = false;
    const finalize = () => {
      if (done || !isFinite(a.duration) || a.duration <= 0) return;
      done = true;
      const d = fmtDuration(a.duration);
      audioDurCache.set(key, d);
      el.textContent = d;
      el.dataset.filled = '1';
      a.removeAttribute('src');
    };
    a.addEventListener('loadedmetadata', () => {
      // muchos mp3 (VBR sin header) reportan duración Infinity hasta que se
      // busca hasta el final; ese seek fuerza al navegador a calcularla
      if (isFinite(a.duration) && a.duration > 0) finalize();
      else { try { a.currentTime = 1e101; } catch { /* seek no soportado */ } }
    });
    a.addEventListener('durationchange', finalize);
    a.addEventListener('error', () => { el.dataset.filled = '1'; });
    a.src = fileUrl(key);
  });
}
let sbAudioEl = null;
function playAudioChip(btn) {
  const key = btn.dataset.audiokey;
  const wasThis = sbAudioEl && sbAudioEl.dataset?.key === key && !sbAudioEl.paused;
  if (sbAudioEl) { sbAudioEl.pause(); sbAudioEl = null; }
  document.querySelectorAll('.sb-audio-chip.playing').forEach((c) => c.classList.remove('playing'));
  if (wasThis) return;
  sbAudioEl = new Audio(fileUrl(key));
  sbAudioEl.dataset.key = key;
  sbAudioEl.play().catch(() => {});
  btn.classList.add('playing');
  sbAudioEl.onended = () => btn.classList.remove('playing');
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
          <div class="sb-audio-row">
            <button class="mini-btn" data-sbaudio="${si}:${hi}">${IC('mic')} Asignar audio${(shot.audioKeys || []).length ? ` (${shot.audioKeys.length})` : ''}</button>
            <div class="sb-audios" data-sbaudiostrip="${si}:${hi}">${(shot.audioKeys || []).map(audioChipHtml).join('')}</div>
          </div>
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
  root.querySelectorAll('[data-sbaudio]').forEach((b) => b.addEventListener('click', () => {
    const [si, hi] = b.dataset.sbaudio.split(':').map(Number);
    openShotAssets(si, hi, 'audioKeys');
  }));
  root.querySelectorAll('[data-audiokey]').forEach((b) => b.addEventListener('click', () => playAudioChip(b)));
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
  fillAudioDurations(root);
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
            ${(shot.audioKeys || []).length ? `<div class="sb-audios">${IC('mic')} ${shot.audioKeys.map(audioChipHtml).join('')}</div>` : ''}
          </div>`).join('')}
      </article>`).join('') : '<p class="hint">Este guion todavía no tiene escenas.</p>'}`;
  root.querySelectorAll('.script-asset-thumb').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.k;
    const [si, hi] = b.closest('[data-vgstrip]').dataset.vgstrip.split(':').map(Number);
    const keys = (sc.scenes[si].shots[hi].assetKeys || []).filter((x) => !x.startsWith('audio/'));
    if (!key.startsWith('audio/')) openLightbox(key, keys);
  }));
  root.querySelectorAll('[data-audiokey]').forEach((b) => b.addEventListener('click', () => playAudioChip(b)));
  fillAudioDurations(root);
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
  const items = state.prompts.filter((p) => !isLoraPrompt(p) && (!cat || (p.category || 'General') === cat)
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

// field: 'assetKeys' (imágenes y video) o 'audioKeys' (audio, espacio separado)
async function openShotAssets(si, hi, field = 'assetKeys') {
  const sb = state.storyboardScript;
  const shot = sb?.scenes[si]?.shots[hi];
  if (!shot) return;
  const audioMode = field === 'audioKeys';
  state.shotAssetsTarget = { si, hi };
  state.shotAssetsField = field;
  state.shotAssetsZone = audioMode ? 'audio' : 'series';
  const zonesEmpty = !state.assets.generated.length && !state.assets.uploads.length
    && !state.assets.video.length && !state.assets.audio.length;
  if (zonesEmpty) {
    try { state.assets = await api('/api/assets'); } catch { /* sin assets no bloqueamos el modal */ }
  }
  // solo se muestran las pestañas que corresponden al tipo
  $$('#shotAssetsTabs .tab').forEach((t) => {
    const z = t.dataset.szone;
    t.hidden = !(z === 'series' || (audioMode ? z === 'audio' : z !== 'audio'));
  });
  $('#shotAssetsTitle').textContent = `${audioMode ? 'Audio' : 'Assets'} del plano ${si + 1}.${hi + 1}`;
  renderShotAssetsGrid();
  $('#shotAssetsModal').hidden = false;
}

function renderShotAssetsGrid() {
  const shot = currentShotAssetsShot();
  if (!shot) return;
  const field = state.shotAssetsField || 'assetKeys';
  const audioMode = field === 'audioKeys';
  $$('#shotAssetsTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.szone === state.shotAssetsZone));
  const serie = state.series.find((s) => s.id === state.storyboardScript.seriesId);
  const isAudio = (k) => k.startsWith('audio/');
  let keys = state.shotAssetsZone === 'series'
    ? (serie?.assetKeys || []).filter((k) => audioMode ? isAudio(k) : !isAudio(k))
    : (state.assets[state.shotAssetsZone] || []).map((a) => a.key);
  const selected = shot[field] || [];
  $('#shotAssetsGrid').className = audioMode ? 'shot-audio-list' : 'shot-assets-grid';
  $('#shotAssetsGrid').innerHTML = keys.length ? keys.map((k) => audioMode
    ? `<div class="shot-audio-cell${selected.includes(k) ? ' selected' : ''}" data-k="${esc(k)}" title="${esc(k)}">
        <button class="shot-audio-play" data-audiokey="${esc(k)}" title="Reproducir">${IC('play')}</button>
        <span class="shot-audio-cell-name">${esc(sbAudioName(k))}</span>
        <span class="audio-dur shot-audio-cell-dur" data-durkey="${esc(k)}"></span>
        <span class="shot-audio-cell-check">${selected.includes(k) ? IC('check') : ''}</span>
      </div>`
    : `<button class="shot-asset-cell${selected.includes(k) ? ' selected' : ''}" data-k="${esc(k)}" title="${esc(k)}">
        ${seriesAssetThumb(k)}${selected.includes(k) ? `<span class="shot-asset-check">${IC('check')}</span>` : ''}
      </button>`).join('')
    : `<div class="hint">${state.shotAssetsZone === 'series'
      ? `La serie no tiene ${audioMode ? 'audios' : 'assets'} asociados — asocialos desde la sección Assets.`
      : 'No hay audios en esta zona todavía. Generá voces en Crear → Audio.'}</div>`;
  $('#shotAssetsGrid').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    shot[field] = shot[field] || [];
    shot[field] = shot[field].includes(k) ? shot[field].filter((x) => x !== k) : [...shot[field], k];
    renderShotAssetsGrid();
  }));
  // el play no debe alternar la selección de la celda
  $('#shotAssetsGrid').querySelectorAll('.shot-audio-play').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    playAudioChip(b);
  }));
  fillAudioDurations($('#shotAssetsGrid'));
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
        <div class="char-name">${esc(c.name)}${nsfwBadgeHtml(c)}</div>
        <div class="char-voice">${c.voiceName ? IC('mic') + ' ' + esc(c.voiceName) : '<span style="color:#6f5f8d">sin voz</span>'}</div>
      </div></div>
      <div class="char-desc">${esc(c.description || '')}</div>
      ${heygenCharacterReady(c) ? `<div class="heygen-card-badge">HeyGen · ${c.heygen?.closeAvatarId ? '2 planos' : '1 plano'}</div>` : ''}
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
  const c = state.characters.find((x) => x.id === id) || { name: '', description: '', voiceId: '', photos: [], heygen: { avatarId: '', wideAvatarId: '', closeAvatarId: '', wideMotionPrompt: '', closeMotionPrompt: '', imageKey: '' } };
  const voices = state.voices || [];
  const body = $('#charModalBody');
  body.innerHTML = `
    ${state.pendingCharacterAsset ? `<div class="character-source"><img src="${fileUrl(state.pendingCharacterAsset)}" alt=""><div><strong>Foto inicial</strong><span>Se copiará al archivo del personaje cuando lo crees.</span></div></div>` : ''}
    <div><label>Nombre</label><input type="text" id="chName" value="${esc(c.name)}" placeholder="ej: Luna"></div>
    <div><label>Descripción</label><textarea id="chDesc" placeholder="quién es, cómo se ve, su vibra…">${esc(c.description || '')}</textarea></div>
    <label class="check-row"><input type="checkbox" id="chNsfw"${c.nsfw ? ' checked' : ''}> Contenido NSFW</label>
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
    <div class="heygen-character-card">
      <div class="variant-manager-head"><label>Variante especial · HeyGen</label>${heygenCharacterReady(c) ? '<span class="heygen-ready">Lista para video</span>' : ''}</div>
      <label class="heygen-character-field"><span>Plano general · avatar_id</span><input type="text" id="chHeyGenWideAvatar" value="${esc(heygenWideAvatarId(c))}" placeholder="91bd75d9e4414cc58043c82bcfc340f4"></label>
      <label class="heygen-character-field"><span>Primer plano · avatar_id</span><input type="text" id="chHeyGenCloseAvatar" value="${esc(c.heygen?.closeAvatarId || '')}" placeholder="6f85c7941c594c94ae8594e17337bef0"></label>
      <label class="heygen-character-field"><span>Prompt de comportamiento · plano general</span><textarea id="chHeyGenWideMotionPrompt" maxlength="1000" rows="3" placeholder="Describe cómo debe comportarse y moverse el personaje en el plano general…">${esc(heygenMotionPromptFor(c, 'wide'))}</textarea></label>
      <label class="heygen-character-field"><span>Prompt de comportamiento · primer plano</span><textarea id="chHeyGenCloseMotionPrompt" maxlength="1000" rows="3" placeholder="Describe la actuación facial y el movimiento para el primer plano…">${esc(heygenMotionPromptFor(c, 'close'))}</textarea></label>
      <div class="hint" style="margin-top:4px">Cada instrucción se envía únicamente con su encuadre. El plano general es obligatorio y el primer plano habilita la toma alternada. La imagen espejo es una referencia visual local y opcional.</div>
      ${id ? `<div class="heygen-mirror">
        ${c.heygen?.imageKey ? `<img src="${fileUrl(c.heygen.imageKey)}" alt="Imagen espejo de HeyGen">` : '<div class="heygen-mirror-empty">Sin imagen espejo</div>'}
        <div><button type="button" class="mini-btn" id="chHeyGenUpload">${IC('upload')} Subir imagen espejo</button>
        <input type="file" id="chHeyGenFileInput" accept="image/png,image/jpeg,image/webp" hidden>
        ${c.photos?.[0] ? `<button type="button" class="mini-btn" id="chHeyGenUseCover">Usar portada</button>` : ''}
        ${c.heygen?.imageKey ? `<button type="button" class="mini-btn danger" id="chHeyGenRemove">Quitar</button>` : ''}</div>
      </div>` : '<p class="hint">Creá el personaje primero para subir su imagen espejo.</p>'}
    </div>
    ${id ? `
    ${c.photos.length ? '<div><label>Portada</label><div id="chCover"></div></div>' : ''}
    <div>
      <div class="variant-manager-head"><label>Fotos (${c.photos.length})</label><div>
        <button type="button" class="mini-btn" id="chAddPhoto">${IC('upload')} Subir</button>
        <button type="button" class="mini-btn" id="chAddPhotoFromAssets">${IC('image')} Desde assets</button>
      </div></div>
      ${c.photos.length > 1 ? '<div class="hint" style="margin-bottom:6px">Arrastrá para ordenar — la primera es la foto de perfil</div>' : ''}
      <div class="char-photos-grid" id="chPhotos">
        ${c.photos.map((p, pi) => `<div class="ref-thumb${pi === 0 ? ' is-profile' : ''}${p === c.sheet ? ' is-sheet' : ''}" draggable="true" data-photo="${esc(p)}"><img src="${fileUrl(p)}" draggable="false" alt=""><button class="ficha-btn" data-ficha="${esc(p)}" title="${p === c.sheet ? 'Ficha del personaje (clic para quitar)' : 'Marcar como ficha de personaje'}">${IC('star')}</button><button class="rm" data-key="${esc(p)}">×</button></div>`).join('')}
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
          <div class="variant-photos">${v.photos.map((p) => `<span class="ref-thumb${p === v.sheet ? ' is-sheet' : ''}"><img src="${fileUrl(p)}" alt=""><button class="ficha-btn" data-vficha="${esc(p)}" title="${p === v.sheet ? 'Ficha de la variante (clic para quitar)' : 'Marcar como ficha de la variante'}">${IC('star')}</button><button class="rm" data-vphoto="${esc(p)}">×</button></span>`).join('') || '<span class="hint">Sin fotos todavía</span>'}</div>
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
      nsfw: $('#chNsfw').checked,
      voiceId,
      voiceName: voices2.find((v) => v.id === voiceId)?.name || '',
      arkAssetId: $('#chArkAsset').value.trim(),
      heygenWideAvatarId: $('#chHeyGenWideAvatar').value.trim(),
      heygenCloseAvatarId: $('#chHeyGenCloseAvatar').value.trim(),
      heygenWideMotionPrompt: $('#chHeyGenWideMotionPrompt').value.trim(),
      heygenCloseMotionPrompt: $('#chHeyGenCloseMotionPrompt').value.trim()
    };
    try {
      if (id) {
        const updated = await api(`/api/characters/${id}`, { method: 'PUT', body: payload });
        const i = state.characters.findIndex((x) => x.id === id);
        state.characters[i] = updated;
        $('#charModal').hidden = true;
        state.editingCharId = null;
        toast('Personaje actualizado');
        if (!contentIsVisible(updated)) state.characters = state.characters.filter((item) => item.id !== updated.id);
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
  $('#chAddPhotoFromAssets')?.addEventListener('click', () => openCharAssetPicker({
    entity: 'character', ownerId: id, variantId: null
  }));

  $('#chHeyGenUpload')?.addEventListener('click', () => $('#chHeyGenFileInput').click());
  $('#chHeyGenFileInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const button = $('#chHeyGenUpload');
    try {
      button.disabled = true;
      const updated = await api(`/api/characters/${id}/heygen-image`, {
        method: 'POST',
        body: { name: file.name, dataUrl: await readFileAsDataUrl(file) }
      });
      state.characters[state.characters.findIndex((item) => item.id === id)] = updated;
      renderCharModal();
      renderCharacters();
      renderVideoControls();
      toast('Imagen espejo actualizada.');
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'err');
    }
  });
  $('#chHeyGenUseCover')?.addEventListener('click', async () => {
    const button = $('#chHeyGenUseCover');
    try {
      button.disabled = true;
      const updated = await api(`/api/characters/${id}/heygen-image`, { method: 'POST', body: { assetKey: c.photos[0] } });
      state.characters[state.characters.findIndex((item) => item.id === id)] = updated;
      renderCharModal();
      renderCharacters();
      renderVideoControls();
      toast('Portada usada como imagen espejo.');
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'err');
    }
  });
  $('#chHeyGenRemove')?.addEventListener('click', async () => {
    const button = $('#chHeyGenRemove');
    try {
      button.disabled = true;
      const updated = await api(`/api/characters/${id}/heygen-image`, { method: 'DELETE' });
      state.characters[state.characters.findIndex((item) => item.id === id)] = updated;
      renderCharModal();
      renderCharacters();
      renderVideoControls();
      toast('Imagen espejo quitada.');
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'err');
    }
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
    // ficha de la variante: marca/quita esta foto como imagen canónica
    item.querySelectorAll('[data-vficha]').forEach((button) => button.addEventListener('click', async () => {
      const key = button.dataset.vficha;
      const sheet = variant.sheet === key ? '' : key;
      const updated = await api(`/api/characters/${id}/variants/${variantId}`, { method: 'PUT', body: { sheet } });
      state.characters[state.characters.findIndex((x) => x.id === id)] = updated;
      renderCharModal();
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

  // ficha del Original: marca/quita esta foto como imagen canónica
  $$('#chPhotos [data-ficha]').forEach((b) => {
    b.addEventListener('click', async () => {
      const key = b.dataset.ficha;
      const sheet = c.sheet === key ? '' : key;
      const updated = await api(`/api/characters/${id}`, { method: 'PUT', body: { sheet } });
      state.characters[state.characters.findIndex((x) => x.id === id)] = updated;
      renderCharModal();
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
    contentIsVisible(el) && (!state.elementKindFilter || el.kind === state.elementKindFilter)
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
        <div class="char-name">${esc(el.name)}${nsfwBadgeHtml(el)}</div>
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
    <label class="check-row"><input type="checkbox" id="elNsfw"${el?.nsfw ? ' checked' : ''}> Contenido NSFW</label>
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
    if (!contentIsVisible(updated)) {
      state.elements = state.elements.filter((item) => item.id !== updated.id);
      closeElementModal();
      renderElements();
      return;
    }
    state.elements[state.elements.findIndex((x) => x.id === updated.id)] = updated;
    renderElementModal();
    renderElements();
  };

  $('#elSave').addEventListener('click', async () => {
    const payload = {
      kind: $('#elKind').value,
      name: $('#elName').value.trim(),
      category: $('#elCategory').value.trim(),
      description: $('#elDescription').value.trim(),
      nsfw: $('#elNsfw').checked
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
// Automatizador: proyectos con guion de bloques (prompt+texto), asignación de
// roles a personajes/locaciones/objetos y config de imagen/voz/texto.
// ---------------------------------------------------------------------------

// roles sin asignar (personajes y locaciones obligatorios; objetos también si se declararon)
let automationSyncTimer = null;
let automationSyncInFlight = false;
let automationSyncNeedsRender = false;

function automationListSignature(projects) {
  return (projects || []).map((project) =>
    `${project.id}:${Number(project.updatedAt) || 0}:${project.blocks?.length || 0}`
  ).join('|');
}

function renderSyncedAutomationProject() {
  if (!$('#view-automation')?.classList.contains('active')) return;
  const active = document.activeElement;
  if (active?.matches('input, textarea, select') && active.closest('#view-automation')) {
    automationSyncNeedsRender = true;
    return;
  }
  automationSyncNeedsRender = false;
  renderAutomationProject();
}

async function syncAutomations() {
  if (automationSyncInFlight || document.hidden || !state.config) return;
  automationSyncInFlight = true;
  try {
    const result = await api('/api/automations', { task: false });
    const incoming = Array.isArray(result.automations) ? result.automations : [];
    if (automationListSignature(incoming) === automationListSignature(state.automations)) return;

    const previous = new Map(state.automations.map((project) => [project.id, project]));
    const added = incoming.filter((project) => !previous.has(project.id));
    const changedIds = new Set(incoming.filter((project) => {
      const current = previous.get(project.id);
      return current && Number(current.updatedAt) !== Number(project.updatedAt);
    }).map((project) => project.id));
    state.automations = incoming;

    if ($('#view-automatizador')?.classList.contains('active')) renderAutomations();
    if (state.openAutomationId && changedIds.has(state.openAutomationId)) renderSyncedAutomationProject();

    const received = added.find((project) => project.integration?.source === 'controversy-tracker');
    const updated = incoming.find((project) =>
      changedIds.has(project.id) && project.integration?.source === 'controversy-tracker');
    if (received) toast(`Nuevo guion recibido: ${received.name}`, 'ok');
    else if (updated) toast(`Guion actualizado: ${updated.name}`, 'ok');
  } catch {
    // La siguiente consulta reintenta. Los errores de sesión ya los gestiona api().
  } finally {
    automationSyncInFlight = false;
  }
}

function startAutomationSync() {
  if (automationSyncTimer) return;
  automationSyncTimer = setInterval(syncAutomations, 2500);
  window.addEventListener('focus', syncAutomations);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAutomations();
  });
  document.addEventListener('focusout', () => {
    if (!automationSyncNeedsRender) return;
    setTimeout(renderSyncedAutomationProject, 0);
  });
}

function automationMissing(pr) {
  const miss = [];
  for (const r of pr.requirements.characters) if (!automationAssignedEntity(pr, 'characters', r.role)) miss.push(`personaje ${r.role}`);
  for (const r of pr.requirements.locations) if (!automationAssignedEntity(pr, 'locations', r.role)) miss.push(`locación ${r.role}`);
  for (const r of pr.requirements.objects) if (!automationAssignedEntity(pr, 'objects', r.role)) miss.push(`objeto ${r.role}`);
  return miss;
}

function renderAutomations() {
  const grid = $('#automationsGrid');
  if (!state.automations.length) {
    grid.innerHTML = '<div class="empty-note">Todavía no hay proyectos. Importá un guion JSON de Controversy Tracker o creá un proyecto vacío.</div>';
    return;
  }
  grid.innerHTML = '';
  for (const pr of state.automations) {
    const missing = automationMissing(pr).length;
    const card = document.createElement('div');
    card.className = 'char-card';
    card.innerHTML = `
      <div class="char-name">${esc(pr.name)}</div>
      <div class="hint" style="margin-bottom:8px">${pr.blocks.length} bloque${pr.blocks.length === 1 ? '' : 's'} · ${pr.requirements.characters.length} personaje(s), ${pr.requirements.locations.length} locación(es), ${pr.requirements.objects.length} objeto(s)</div>
      <div class="automation-status ${missing ? 'pending' : 'ready'}">${missing ? `Faltan asignar ${missing} rol${missing === 1 ? '' : 'es'}` : 'Todo asignado ✓'}</div>
      <div class="char-actions">
        <button class="mini-btn accent" data-aact="open">${IC('edit')} Abrir</button>
        <button class="mini-btn danger" data-aact="del">${IC('trash')}</button>
      </div>`;
    card.querySelector('[data-aact="open"]').addEventListener('click', () => openAutomation(pr.id));
    card.querySelector('[data-aact="del"]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el proyecto “${pr.name}”?`)) return;
      await api(`/api/automations/${pr.id}`, { method: 'DELETE' });
      state.automations = state.automations.filter((x) => x.id !== pr.id);
      renderAutomations();
    });
    grid.appendChild(card);
  }
}

$('#btnNewAutomation').addEventListener('click', async () => {
  const name = window.prompt('Nombre del proyecto:', 'Nuevo proyecto');
  if (name === null) return;
  try {
    const created = await api('/api/automations', { method: 'POST', body: { name: name.trim() || 'Nuevo proyecto' } });
    state.automations.unshift(created);
    openAutomation(created.id);
  } catch (err) { toast(err.message, 'err'); }
});

$('#btnImportAutomation').addEventListener('click', () => $('#automationImportInput').click());
$('#automationImportInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const created = await api('/api/automations', { method: 'POST', body: { data } });
    state.automations.unshift(created);
    toast(`“${created.name}” importado — ${created.blocks.length} bloques`);
    openAutomation(created.id);
  } catch (err) { toast(`No se pudo importar: ${err.message}`, 'err'); }
});

function currentAutomation() {
  return state.automations.find((x) => x.id === state.openAutomationId) || null;
}

function formatAutomationBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function finalizeAutomationProject(projectId) {
  const project = state.automations.find((item) => item.id === projectId);
  const button = $('#autoFinalize');
  if (!project || !button) return;
  const originalHtml = button.innerHTML;
  try {
    button.disabled = true;
    button.textContent = 'Calculando material descartado…';
    const preview = await api(`/api/automations/${projectId}/finalize`);
    if (preview.deleteCount) {
      const detail = [
        `${preview.deleteCount} archivo${preview.deleteCount === 1 ? '' : 's'} descartado${preview.deleteCount === 1 ? '' : 's'}`,
        `${formatAutomationBytes(preview.deleteBytes)} recuperables`,
        `${preview.activeCount} materiales vigentes preservados`,
        preview.sharedCount ? `${preview.sharedCount} reutilizados en otras secciones preservados` : ''
      ].filter(Boolean).join('\n');
      if (!confirm(`¿Finalizar “${project.name}” y limpiar sus descartes?\n\n${detail}\n\nLos archivos eliminados no se pueden recuperar.`)) {
        button.disabled = false;
        button.innerHTML = originalHtml;
        return;
      }
    }
    button.textContent = preview.deleteCount ? 'Eliminando descartes…' : 'Comprobando proyecto…';
    const result = await api(`/api/automations/${projectId}/finalize`, { method: 'POST' });
    const index = state.automations.findIndex((item) => item.id === projectId);
    if (index !== -1) state.automations[index] = result.project;
    state.history = result.history || state.history;
    renderHistory();
    await refreshAssets();
    if (state.openAutomationId === projectId) renderAutomationProject();
    if (result.failed?.length) {
      toast(`${result.deleted} archivos eliminados; ${result.failed.length} no pudieron borrarse y se intentarán en la próxima finalización.`, 'err');
    } else if (result.deleted) {
      toast(`Proyecto finalizado: ${result.deleted} descarte${result.deleted === 1 ? '' : 's'} eliminado${result.deleted === 1 ? '' : 's'} y ${formatAutomationBytes(result.project.finalization?.deletedBytes)} liberados.`, 'ok');
    } else {
      toast('Proyecto finalizado: no había material descartado para eliminar.', 'ok');
    }
  } catch (error) {
    button.disabled = false;
    button.innerHTML = originalHtml;
    toast(error.message, 'err');
  }
}

function openAutomation(id) {
  state.openAutomationId = id;
  $$('.nav-btn').forEach((b) => b.classList.remove('active'));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-automation'));
  renderAutomationProject();
  refreshAssets().then(() => {
    if (state.openAutomationId === id) renderAutomationProject();
  }).catch(() => {});
  window.scrollTo(0, 0);
}
$('#automationBack').addEventListener('click', () => {
  state.openAutomationId = null;
  $('.nav-btn[data-view="automatizador"]').click();
});
$('#automationDelete').addEventListener('click', async () => {
  const pr = currentAutomation();
  if (!pr || !confirm(`¿Eliminar el proyecto “${pr.name}”?`)) return;
  await api(`/api/automations/${pr.id}`, { method: 'DELETE' });
  state.automations = state.automations.filter((x) => x.id !== pr.id);
  state.openAutomationId = null;
  $('.nav-btn[data-view="automatizador"]').click();
});
$('#automationSave').addEventListener('click', async () => {
  const pr = currentAutomation();
  if (!pr) return;
  const name = $('#autoProjectName')?.value.trim() || pr.name;
  const artStyle = $('#autoArtStyle')?.value.trim() || pr.config.artStyle || DEFAULT_AUTOMATION_ART_STYLE;
  const updated = await saveAutomation({ name, config: { artStyle } });
  if (updated) {
    $('#automationTitle').textContent = updated.name;
    toast('Proyecto guardado');
  }
});

async function saveAutomation(patch) {
  const pr = currentAutomation();
  if (!pr) return null;
  try {
    const updated = await api(`/api/automations/${pr.id}`, { method: 'PUT', body: patch });
    state.automations[state.automations.findIndex((x) => x.id === pr.id)] = updated;
    return updated;
  } catch (err) {
    toast(err.message, 'err');
    return null;
  }
}

function automationRequirement(pr, kind, role) {
  return (pr.requirements?.[kind] || []).find((item) => item.role === role) || null;
}

function automationRoleName(role) {
  return String(role || '').toLowerCase().split('_').filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Sin nombre';
}

function automationGeneratedCharacter(pr, role) {
  return pr?.generatedCharacters?.[role] || null;
}

function automationAssignedEntity(pr, kind, role) {
  const id = pr?.assignments?.[kind]?.[role];
  if (!id) return null;
  if (kind === 'characters') {
    const generated = automationGeneratedCharacter(pr, role);
    if (generated?.id === id) return { ...generated, automationOnly: true };
    return state.characters.find((item) => item.id === id) || null;
  }
  return state.elements.find((item) => item.id === id) || null;
}

function automationPromptMentionMap(pr) {
  const entries = [];
  for (const kind of ['characters', 'locations', 'objects']) {
    for (const requirement of pr.requirements?.[kind] || []) {
      const role = String(requirement.role || '').toUpperCase();
      const entity = automationAssignedEntity(pr, kind, requirement.role);
      const label = normalizeReferenceLabel(entity?.name || requirement.role);
      if (role && label) entries.push({ role, label });
    }
  }
  return entries;
}

function regexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// En pantalla y al generar se ve el nombre exacto estampado en la ficha.
// Internamente se guardan @ROLES estables para que cambiar una asignación no
// rompa el contrato del proyecto.
function automationPromptForEditor(pr, value) {
  let prompt = String(value || '');
  for (const { role, label } of automationPromptMentionMap(pr).sort((a, b) => b.role.length - a.role.length)) {
    prompt = prompt.replace(new RegExp(`@?\\b${regexLiteral(role)}\\b`, 'g'), () => `@${label}`);
  }
  return prompt;
}

function automationPromptFromEditor(pr, value) {
  let prompt = String(value || '');
  const entries = automationPromptMentionMap(pr).sort((a, b) => b.label.length - a.label.length);
  for (const { role, label } of entries) {
    prompt = prompt.replace(new RegExp(`@${regexLiteral(label)}(?![\\p{L}\\p{N}_])`, 'giu'), () => `@${role}`);
  }
  for (const { role } of entries) {
    prompt = prompt.replace(new RegExp(`@?\\b${regexLiteral(role)}\\b`, 'g'), `@${role}`);
  }
  return prompt;
}

const DEFAULT_AUTOMATION_ART_STYLE = 'Photorealistic cinematic realism, natural human anatomy, realistic skin and materials, restrained color grading, consistent lighting and lens language';
const DEFAULT_AUTOMATION_TITLE_OVERLAY = {
  enabled: false, mode: 'block', blockId: '', text: '', font: 'sans-serif', fontSizePx: 96, fontWeight: 900,
  fontItalic: false, fontUnderline: false, fontStrikeThrough: false, textTransform: 'none',
  color: '#ffffff', strokeColor: '#000000', strokeWidthPx: 3,
  position: 'top', x: 50, y: 14, align: 'center', maxWidthPct: 88,
  bg: false, bgColor: '#000000', bgOpacity: 0.45
};
const SYSTEM_OVERLAY_FONTS = ['sans-serif', 'serif', 'monospace', 'Impact', 'Georgia', 'Arial Black'];
const loadedCustomFontIds = new Set();
let automationTransitionPreview = null;

function automationTransitionSoundOptions(selectedId = '') {
  const groups = new Map();
  for (const sound of state.transitionSounds || []) {
    if (!groups.has(sound.category)) groups.set(sound.category, []);
    groups.get(sound.category).push(sound);
  }
  return '<option value="">— elegí un sonido —</option>' + [...groups.entries()].map(([category, sounds]) =>
    `<optgroup label="${esc(category)}">${sounds.map((sound) => `<option value="${esc(sound.id)}"${sound.id === selectedId ? ' selected' : ''}>${esc(sound.name)}</option>`).join('')}</optgroup>`
  ).join('');
}

function previewAutomationTransitionSound(soundId) {
  const sound = (state.transitionSounds || []).find((item) => item.id === soundId);
  if (!sound) return;
  if (automationTransitionPreview) automationTransitionPreview.pause();
  automationTransitionPreview = new Audio(sound.url);
  automationTransitionPreview.loop = false;
  automationTransitionPreview.play().catch(() => toast('No se pudo reproducir este sonido de transición', 'err'));
  automationTransitionPreview.addEventListener('ended', () => { automationTransitionPreview = null; }, { once: true });
}

function customFontUrl(font) {
  return `/fonts/${encodeURIComponent(font.file)}`;
}

async function registerCustomFont(font) {
  if (!font?.id || loadedCustomFontIds.has(font.id)) return;
  const face = new FontFace(font.family, `url("${customFontUrl(font)}")`);
  await face.load();
  document.fonts.add(face);
  loadedCustomFontIds.add(font.id);
}

async function registerCustomFonts(fonts) {
  const results = await Promise.allSettled((fonts || []).map(registerCustomFont));
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) console.warn(`${failed} fuente(s) personalizada(s) no pudieron cargarse.`);
}

function overlayFontOptions(selected, { inherit = false } = {}) {
  const options = [];
  if (inherit) options.push({ value: '', label: 'Misma fuente que el texto normal' });
  for (const font of SYSTEM_OVERLAY_FONTS) options.push({ value: font, label: font });
  for (const font of state.fonts || []) options.push({ value: font.family, label: `${font.name} · personalizada` });
  if (selected && !options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: `${selected} · no disponible` });
  }
  return options.map((option) =>
    `<option value="${esc(option.value)}"${option.value === selected ? ' selected' : ''}>${esc(option.label)}</option>`
  ).join('');
}

function canvasFontFamily(font) {
  const family = String(font || 'sans-serif');
  return /^[a-z-]+$/i.test(family) ? family : `"${family.replace(/["\\]/g, '')}"`;
}

async function ensureOverlayFonts(...overlays) {
  const families = [...new Set(overlays.flatMap((overlay) => [overlay?.font, overlay?.highlightFont || overlay?.font]).filter(Boolean))];
  await Promise.allSettled(families.map((family) => document.fonts.load(`700 64px ${canvasFontFamily(family)}`)));
}

function automationArtPromptOptions() {
  const prompts = (state.prompts || [])
    .filter((prompt) => !['audio', 'video'].includes(prompt.mode) && !isLoraPrompt(prompt))
    .sort((a, b) => Number(isStylePrompt(b)) - Number(isStylePrompt(a)) || String(a.title).localeCompare(String(b.title)));
  if (!prompts.length) return '<option value="">— no hay prompts guardados —</option>';
  return '<option value="">— elegí un prompt guardado —</option>' + prompts.map((prompt) =>
    `<option value="${esc(prompt.id)}"${prompt.id === currentAutomation()?.config?.artStylePromptId ? ' selected' : ''}>${isStylePrompt(prompt) ? 'Estilo con referencia' : 'Imagen'} · ${esc(prompt.category || 'General')} · ${esc(prompt.title)}</option>`
  ).join('');
}

// Vista previa compartida por Automatizador y Subtitulador. Ambos consumen la
// misma estructura de estilo que luego interpreta el motor Remotion del servidor.
function applySubtitlePreviewStyles({ preview, text, titleText, overlay, titleOverlay, visibleTitle = '' }) {
  if (!preview || !text || !titleText) return;
  const h = preview.clientHeight || 320;
  const scale = h / 1080;
  const normalSize = Math.max(4, (overlay.fontSizePx || 64) * scale);
  const highlightSize = Math.max(4, (overlay.highlightFontSizePx || overlay.fontSizePx || 64) * scale);
  Object.assign(text.style, {
    lineHeight: `${Math.max(normalSize, highlightSize) * 1.2}px`,
    left: (overlay.x ?? 50) + '%', top: (overlay.y ?? 88) + '%',
    maxWidth: (overlay.maxWidthPct || 88) + '%', textAlign: overlay.align || 'center',
    transform: `translate(${overlay.align === 'left' ? '0' : overlay.align === 'right' ? '-100%' : '-50%'}, -50%)`
  });
  text.querySelectorAll('.ov-normal').forEach((normal) => Object.assign(normal.style, {
    fontFamily: overlay.font, fontSize: normalSize + 'px', fontWeight: overlay.fontWeight || 700,
    fontStyle: overlay.fontItalic ? 'italic' : 'normal', textTransform: overlay.textTransform || 'none',
    textDecorationLine: [overlay.fontUnderline && 'underline', overlay.fontStrikeThrough && 'line-through'].filter(Boolean).join(' ') || 'none',
    color: overlay.color, webkitTextStroke: `${Math.max(0, (overlay.strokeWidthPx || 0) * scale)}px ${overlay.strokeColor}`
  }));
  const highlight = text.querySelector('.ov-hl');
  if (highlight) Object.assign(highlight.style, {
    fontFamily: overlay.highlightFont || overlay.font, fontSize: highlightSize + 'px', fontWeight: overlay.highlightFontWeight || 800,
    fontStyle: overlay.highlightFontItalic ? 'italic' : 'normal', textTransform: overlay.highlightTextTransform || 'none',
    textDecorationLine: [overlay.highlightFontUnderline && 'underline', overlay.highlightFontStrikeThrough && 'line-through'].filter(Boolean).join(' ') || 'none',
    color: overlay.highlightColor || '#fbbf24',
    webkitTextStroke: `${Math.max(0, (overlay.highlightStrokeWidthPx || 0) * scale)}px ${overlay.highlightStrokeColor || '#000000'}`
  });
  text.classList.toggle('has-bg', !!overlay.bg);

  const titleSize = Math.max(4, (titleOverlay.fontSizePx || 96) * scale);
  titleText.hidden = !titleOverlay.enabled || !visibleTitle;
  titleText.textContent = visibleTitle;
  Object.assign(titleText.style, {
    fontFamily: titleOverlay.font || 'sans-serif', fontSize: titleSize + 'px', fontWeight: titleOverlay.fontWeight || 900,
    fontStyle: titleOverlay.fontItalic ? 'italic' : 'normal', textTransform: titleOverlay.textTransform || 'none',
    textDecorationLine: [titleOverlay.fontUnderline && 'underline', titleOverlay.fontStrikeThrough && 'line-through'].filter(Boolean).join(' ') || 'none',
    color: titleOverlay.color || '#ffffff',
    webkitTextStroke: `${Math.max(0, (titleOverlay.strokeWidthPx || 0) * scale)}px ${titleOverlay.strokeColor || '#000000'}`,
    left: (titleOverlay.x ?? 50) + '%', top: (titleOverlay.y ?? 14) + '%', maxWidth: (titleOverlay.maxWidthPct || 88) + '%',
    textAlign: titleOverlay.align || 'center', lineHeight: `${titleSize * 1.15}px`,
    transform: `translate(${titleOverlay.align === 'left' ? '0' : titleOverlay.align === 'right' ? '-100%' : '-50%'}, -50%)`
  });
  titleText.classList.toggle('has-bg', !!titleOverlay.bg);
}

function automationHeyGenCharacters() {
  return state.characters.filter(heygenCharacterReady);
}

function automationBlockHeyGenCharacter(pr, block) {
  const direct = state.characters.find((character) => character.id === block.heygenCharacterId && heygenCharacterReady(character));
  if (direct) return direct;
  for (const role of block.characters || []) {
    const assigned = automationAssignedEntity(pr, 'characters', role);
    if (assigned && heygenCharacterReady(assigned)) return assigned;
  }
  return automationHeyGenCharacters()[0] || null;
}

function automationVisualAssets() {
  const seen = new Set();
  return ['generated', 'uploads', 'video'].flatMap((zone) => (state.assets[zone] || []).map((item) => ({ ...item, zone })))
    .filter((item) => item?.key && !seen.has(item.key) && seen.add(item.key));
}

function automationReferenceAssets() {
  const seen = new Set();
  return ['generated', 'uploads', 'video', 'audio']
    .flatMap((zone) => (state.assets[zone] || []).map((item) => ({ ...item, zone })))
    .filter((item) => item?.key && !seen.has(item.key) && seen.add(item.key));
}

function automationVisualAsset(key) {
  return automationReferenceAssets().find((item) => item.key === key) || { key, name: String(key).split('/').pop(), zone: String(key).split('/')[0] };
}

function automationAssetPreview(item, key = item.key) {
  if (item.zone === 'video') return `<video src="${fileUrl(key)}" muted preload="metadata"></video>`;
  if (item.zone === 'audio') return `<span class="automation-assets-audio">${IC('mic', 'ic ic-lg')}</span>`;
  return `<img src="${fileUrl(key)}" loading="lazy" alt="">`;
}

function automationBlockAssetSelectionMarkup(keys = []) {
  return keys.length ? keys.map((key, index) => {
    const item = automationVisualAsset(key);
    const preview = automationAssetPreview(item, key);
    return `<span class="auto-block-asset-chip" title="${esc(item.name || key)}"><b>${index + 1}</b>${preview}</span>`;
  }).join('') : '<span class="hint">Todavía no elegiste imágenes, videos o audios.</span>';
}

function overlayPresetOptions() {
  const items = state.overlayPresets || [];
  return `<option value="">— elegí un estilo guardado —</option>` + items.map((item) =>
    `<option value="${esc(item.id)}">${esc(item.name)}</option>`
  ).join('');
}

function automationStyleRefItems(pr) {
  const key = pr?.config?.artStyleImageKey || '';
  return key ? [{ key, label: ARTISTIC_STYLE_LABEL }] : [];
}

function automationStyleReferenceMarkup(pr) {
  const key = pr?.config?.artStyleImageKey || '';
  if (!key) return '';
  return `<div class="auto-style-reference">
    <div class="prompt-style-image"><img src="${esc(fileUrl(key))}" alt="Referencia de estilo"><span class="prompt-style-label">${ARTISTIC_STYLE_LABEL}</span></div>
    <p>Esta imagen se enviará como referencia visual en cada ficha y bloque. Manifestador rotula una copia temporal; el archivo original permanece intacto.</p>
  </div>`;
}

function automationProjectArtStyle(pr) {
  return $('#autoArtStyle')?.value.trim() || pr?.config?.artStyle || DEFAULT_AUTOMATION_ART_STYLE;
}

function automationStyledPrompt(pr, prompt) {
  const artStyle = automationProjectArtStyle(pr);
  return `GLOBAL ART DIRECTION — mandatory for every image in this project: ${artStyle}. Keep the rendering technique, realism level, character proportions, materials, color palette, lighting logic and lens language consistent with every other project asset. Do not switch to cartoon, anime, illustration, 3D render or another visual medium unless the global art direction explicitly requires it.\n\n${prompt}`;
}

function automationResourcePrompt(kind, requirement) {
  const description = String(requirement.description || '').trim() || 'no additional visual description was provided';
  if (kind === 'characters') {
    const clothing = String(requirement.clothing || '').trim()
      || 'the clothing stated in the character description, preserved exactly across all three views';
    return `Create a horizontal character reference sheet containing exactly three views of the same character: one full-body front view, one full-body back view, and one close-up portrait of the face. Preserve exactly the same identity, anatomy, hairstyle and clothing across all three views. Use a neutral pose and neutral expression, even studio lighting and a plain gray background. No text, labels, decorative frames or unrelated objects. Character description: ${description}. Clothing: ${clothing}.`;
  }
  if (kind === 'locations') {
    return `Create a production reference image for this background location. Use one clean wide establishing view in a horizontal 16:9 composition, with the camera at human eye level, neutral readable lighting and enough spatial detail to reuse the image as a reference in later shots. Do not include characters, visible text, readable signs, logos, frames or collages. Location description: ${description}.`;
  }
  return `Create a production reference sheet for this object: one main three-quarter view, one front view and one close-up of its important details, preserving exactly the same design in every view. Use a plain gray background and even studio lighting. No people, text, labels, decorative frames or unrelated objects. Object description: ${description}.`;
}

function automationResourceImageSettings(model, kind) {
  const preferredAspect = kind === 'characters' ? ['3:2', '16:9', '4:3'] : kind === 'locations' ? ['16:9', '3:2', '4:3'] : ['3:2', '1:1', '4:3'];
  const aspectRatio = preferredAspect.find((value) => model.aspectRatios.includes(value)) || model.aspectRatios[0];
  const resolution = model.resolutions.includes('2K')
    ? '2K'
    : (model.resolutions.includes('4K') ? '4K' : model.resolutions[0]);
  return { aspectRatio, resolution };
}

async function assignAutomationCharacterVoice(projectId, role, card) {
  const pr = state.automations.find((item) => item.id === projectId);
  const characterId = pr?.assignments?.characters?.[role];
  if (!pr || !characterId) return toast('Primero asigná o generá el personaje.', 'err');
  const voiceId = card.querySelector('[data-role-voice]')?.value || '';
  const voiceName = (state.voices || []).find((voice) => voice.id === voiceId)?.name || '';
  const button = card.querySelector('[data-save-role-voice]');
  try {
    if (button) button.disabled = true;
    const generated = automationGeneratedCharacter(pr, role);
    if (generated?.id === characterId) {
      const updatedProject = await api(`/api/automations/${projectId}`, {
        method: 'PUT',
        body: {
          generatedCharacters: {
            ...(pr.generatedCharacters || {}),
            [role]: { ...generated, voiceId, voiceName }
          }
        }
      });
      state.automations[state.automations.findIndex((item) => item.id === projectId)] = updatedProject;
      toast(voiceId ? `Voz ${voiceName} asignada al recurso @${role}` : `Voz quitada del recurso @${role}`);
      renderAutomationProject();
      return;
    }
    const updated = await api(`/api/characters/${characterId}`, { method: 'PUT', body: { voiceId, voiceName } });
    const index = state.characters.findIndex((item) => item.id === characterId);
    if (index !== -1) state.characters[index] = updated;
    toast(voiceId ? `Voz ${voiceName} asignada a ${updated.name}` : `Voz quitada de ${updated.name}`);
    renderAutomationProject();
  } catch (error) {
    toast(error.message, 'err');
    if (button) button.disabled = false;
  }
}

async function createAutomationResource({ projectId, kind, role, modelId, prompt, voiceId = '', setStatus = () => {} }) {
  const pr = state.automations.find((item) => item.id === projectId);
  const requirement = pr && automationRequirement(pr, kind, role);
  const model = state.models.find((item) => item.id === modelId);
  if (!pr || !requirement || !model) throw new Error('No se encontró el rol o el modelo seleccionado.');
  if (!prompt) throw new Error('El prompt de la ficha está vacío.');

  let created = null;
  try {
    setStatus(`Generando con ${model.name}…`);
    const styleRefs = automationStyleRefItems(pr);
    const labeledRefs = await buildLabeledRefs(styleRefs);
    const generated = await api('/api/generate/image', {
      method: 'POST',
      body: {
        modelId: model.id,
        prompt: automationStyledPrompt(pr, prompt),
        refs: styleRefs.map((ref) => ref.key),
        labeledRefs,
        batch: 1,
        ...automationResourceImageSettings(model, kind)
      }
    });
    const assetKey = generated.outputs?.[0];
    if (!assetKey) throw new Error('El modelo no devolvió una imagen.');

    setStatus('Guardando la ficha y asignándola al rol…');
    if (kind === 'characters') {
      const voiceName = (state.voices || []).find((voice) => voice.id === voiceId)?.name || '';
      const description = [
        requirement.description,
        requirement.clothing ? `Vestimenta: ${requirement.clothing}` : ''
      ].filter(Boolean).join('\n\n');
      created = {
        id: `automation-character:${role}`,
        role,
        name: automationRoleName(role),
        description,
        clothing: requirement.clothing || '',
        voiceId,
        voiceName,
        modelId: model.id,
        assetKey,
        sheet: assetKey,
        photos: [assetKey],
        generatedAt: Date.now(),
        automationOnly: true
      };
    } else {
      created = await api('/api/elements', {
        method: 'POST',
        body: {
          kind: kind === 'objects' ? 'object' : 'location',
          name: automationRoleName(role),
          category: `Automatizador · ${pr.name}`,
          description: requirement.description || ''
        }
      });
    }

    let entity = created;
    if (kind !== 'characters') {
      entity = await api(`/api/elements/${created.id}/photos`, {
        method: 'POST',
        body: { assetKey }
      });
      const sheet = entity.photos?.[entity.photos.length - 1] || '';
      if (sheet) entity = await api(`/api/elements/${created.id}`, { method: 'PUT', body: { sheet } });
      state.elements.unshift(entity);
    }

    await api('/api/assets/tag', {
      method: 'POST',
      body: {
        keys: [assetKey],
        category: `Automatizador · ${pr.name}`,
        automationId: pr.id,
        automationName: pr.name,
        autoKind: kind === 'characters' ? 'character-sheet' : kind === 'locations' ? 'background-sheet' : 'object-sheet'
      }
    });

    const assignments = {
      characters: { ...(pr.assignments.characters || {}) },
      locations: { ...(pr.assignments.locations || {}) },
      objects: { ...(pr.assignments.objects || {}) }
    };
    assignments[kind][role] = entity.id;
    const updatedProject = await api(`/api/automations/${pr.id}`, {
      method: 'PUT',
      body: {
        assignments,
        ...(kind === 'characters' ? {
          generatedCharacters: { ...(pr.generatedCharacters || {}), [role]: entity }
        } : {})
      }
    });
    state.automations[state.automations.findIndex((item) => item.id === pr.id)] = updatedProject;
    return { entity, assetKey, project: updatedProject };
  } catch (error) {
    error.automationResourceCreated = Boolean(created);
    throw error;
  }
}

async function generateAutomationResource(projectId, kind, role, card) {
  const modelId = card.querySelector('[data-role-model]')?.value;
  const prompt = card.querySelector('[data-role-prompt]')?.value.trim();
  const voiceId = kind === 'characters' ? (card.querySelector('[data-role-voice]')?.value || '') : '';
  const button = card.querySelector('[data-generate-resource]');
  const status = card.querySelector('[data-role-status]');
  const setStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('warn', error);
  };
  try {
    button.disabled = true;
    await createAutomationResource({ projectId, kind, role, modelId, prompt, voiceId, setStatus });
    toast(`${kind === 'characters' ? 'Ficha interna' : kind === 'locations' ? 'Fondo' : 'Objeto'} generada y asignada a @${role}${kind === 'characters' ? '; no se añadió a Personajes' : ''}`);
    renderAutomationProject();
  } catch (error) {
    const suffix = error.automationResourceCreated ? ' El recurso quedó creado y podés asignarlo manualmente.' : '';
    setStatus(`${error.message}${suffix}`, true);
    toast(`${error.message}${suffix}`, 'err');
    button.disabled = false;
  }
}

async function generateAllAutomationResources(projectId) {
  const pr = state.automations.find((item) => item.id === projectId);
  const root = $('#automationRoot');
  if (!pr || !root) return;

  // Se capturan ahora el modelo, prompt y voz visibles de cada ficha para
  // respetar exactamente la selección del usuario durante todo el lote.
  const tasks = [...root.querySelectorAll('[data-role-card]')].map((card) => {
    const [kind, role] = card.dataset.roleCard.split(':');
    if (pr.assignments?.[kind]?.[role]) return null;
    return {
      kind,
      role,
      card,
      modelId: card.querySelector('[data-role-model]')?.value || '',
      prompt: card.querySelector('[data-role-prompt]')?.value.trim() || '',
      voiceId: kind === 'characters' ? (card.querySelector('[data-role-voice]')?.value || '') : ''
    };
  }).filter(Boolean);

  if (!tasks.length) return toast('Todos los assets requeridos ya están asignados.', 'ok');
  if (!confirm(`¿Generar y asignar los ${tasks.length} assets faltantes? Se realizará una generación de imagen por cada rol.`)) return;
  const monitorTaskId = startUiTask({
    title: `Generando assets de ${pr.name}`,
    detail: `Preparando el primer rol de ${tasks.length}…`,
    total: tasks.length,
    current: 1
  });

  const bulkButton = $('#autoGenerateAllResources');
  const progress = $('#autoResourcesProgress');
  if (bulkButton) bulkButton.disabled = true;
  root.querySelectorAll('[data-generate-resource]').forEach((button) => { button.disabled = true; });
  let completed = 0;
  const errors = [];

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    updateUiTask(monitorTaskId, { current: index + 1, detail: `${index + 1}/${tasks.length} · preparando @${task.role}…` });
    const status = task.card.querySelector('[data-role-status]');
    const setStatus = (message, error = false) => {
      if (status) {
        status.textContent = message;
        status.classList.toggle('warn', error);
      }
      if (progress) progress.textContent = `${index + 1}/${tasks.length} · @${task.role} · ${message}`;
      updateUiTask(monitorTaskId, { detail: `${index + 1}/${tasks.length} · @${task.role} · ${message}` });
    };
    try {
      await createAutomationResource({ projectId, ...task, setStatus });
      completed++;
      setStatus('Generado y asignado ✓');
      updateUiTask(monitorTaskId, { current: index + 1 });
    } catch (error) {
      const suffix = error.automationResourceCreated ? ' El recurso quedó creado para asignarlo manualmente.' : '';
      const message = `${error.message}${suffix}`;
      errors.push(`@${task.role}: ${message}`);
      setStatus(`Falló: ${message}`, true);
    }
  }

  if (state.openAutomationId === projectId) renderAutomationProject();
  if (errors.length) {
    finishUiTask(monitorTaskId, { error: `${completed}/${tasks.length} completados · ${errors.length} con error` });
    toast(`Assets: ${completed}/${tasks.length} generados. Fallaron ${errors.length}; podés reintentar sólo los faltantes.`, 'err');
  } else {
    finishUiTask(monitorTaskId, { detail: `${completed}/${tasks.length} assets generados y asignados.` });
    toast(`Todos los assets fueron generados y asignados: ${completed}/${tasks.length}.`, 'ok');
  }
}

function bindAutomationAssetOpeners(root) {
  root?.querySelectorAll('[data-open-asset]').forEach((button) => {
    if (button.dataset.assetBound === '1') return;
    button.dataset.assetBound = '1';
    button.addEventListener('click', () => openLightbox(button.dataset.openAsset));
  });
}

function bindAutomationHeyGenSegmentActions(root, project) {
  root?.querySelectorAll('[data-regenerate-heygen-segment]').forEach((button) => {
    if (button.dataset.heygenSegmentBound === '1') return;
    button.dataset.heygenSegmentBound = '1';
    button.addEventListener('click', async () => {
      const liveProject = state.automations.find((item) => item.id === project?.id) || project;
      const block = liveProject?.blocks?.find((item) => item.id === button.dataset.blockId);
      const output = block && liveProject.outputs?.[block.id];
      const segmentIndex = Number(button.dataset.segmentIndex);
      const segmentKeys = Array.isArray(output?.heygenSegmentVideoKeys) ? output.heygenSegmentVideoKeys : [];
      if (!block || block.generator !== 'heygen' || block.heygenFraming !== 'split' || segmentKeys.length !== 2 || ![0, 1].includes(segmentIndex)) {
        return toast('Esta toma ya no tiene dos planos HeyGen completos.', 'err');
      }
      const expectedAudio = Number(output.audioCountExpected) || (block.items || []).length;
      if (!Array.isArray(output.audioKeys) || output.audioKeys.length < expectedAudio) {
        return toast('Faltan audios guardados para regenerar sólo este plano.', 'err');
      }
      const label = segmentIndex === 0 ? 'plano general' : 'primer plano';
      if (!confirm(`¿Regenerar únicamente el ${label} de “${block.title || 'este bloque'}”? Se conservarán el otro plano y todos los audios; HeyGen consumirá sólo esta nueva toma y luego se volverán a unir ambas.`)) return;
      button.disabled = true;
      await runAutomationBlock(liveProject.id, block, button.closest('.auto-block'), {
        requireExistingAudio: true,
        regenerateHeyGenSegment: segmentIndex
      });
    });
  });
}

function renderAutomationAssetsPicker() {
  const picker = state.automationAssetPicker;
  if (!picker) return;
  const search = String(picker.search || '').trim().toLocaleLowerCase('es');
  const selected = new Set(picker.keys);
  const generativeVideoPicker = picker.purpose === 'generative-video-block';
  const sourceItems = generativeVideoPicker ? automationReferenceAssets() : automationVisualAssets();
  const items = sourceItems.filter((item) =>
    (picker.zone === 'all' || item.zone === picker.zone)
    && (!search || String(item.name || item.key).toLocaleLowerCase('es').includes(search))
  );
  $$('#automationAssetsTabs [data-auto-assets-zone]').forEach((button) =>
    button.classList.toggle('active', button.dataset.autoAssetsZone === picker.zone));
  $('#automationAssetsSearch').value = picker.search || '';
  $('#automationAssetsPickerGrid').innerHTML = items.length ? items.map((item) => {
    const preview = automationAssetPreview(item);
    return `<button type="button" class="automation-assets-pick${selected.has(item.key) ? ' selected' : ''}" data-auto-asset-key="${esc(item.key)}">${preview}<span>${esc(item.name || item.key)}</span><b>${selected.has(item.key) ? picker.keys.indexOf(item.key) + 1 : '+'}</b></button>`;
  }).join('') : '<div class="empty-note">No hay Assets que coincidan con este filtro.</div>';
  $('#automationAssetsPickerGrid').querySelectorAll('[data-auto-asset-key]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.autoAssetKey;
    const index = picker.keys.indexOf(key);
    if (index >= 0) picker.keys.splice(index, 1);
    else {
      const item = automationVisualAsset(key);
      const next = [...picker.keys, key].map(automationVisualAsset);
      const counts = {
        image: next.filter((candidate) => !['video', 'audio'].includes(candidate.zone)).length,
        video: next.filter((candidate) => candidate.zone === 'video').length,
        audio: next.filter((candidate) => candidate.zone === 'audio').length
      };
      const limits = picker.mediaLimits || {};
      if (generativeVideoPicker && (next.length > limits.total || counts.image > limits.image || counts.video > limits.video || counts.audio > limits.audio)) {
        return toast(`${picker.modelName} admite hasta ${limits.total} referencias: ${limits.image} imágenes, ${limits.video} videos y ${limits.audio} audios.`, 'err');
      }
      picker.keys.push(item.key);
    }
    renderAutomationAssetsPicker();
  }));

  $('#automationAssetsCount').textContent = `${picker.keys.length} seleccionado${picker.keys.length === 1 ? '' : 's'}`;
  $('#automationAssetsOrder').innerHTML = picker.keys.length ? picker.keys.map((key, index) => {
    const item = automationVisualAsset(key);
    const preview = automationAssetPreview(item, key);
    return `<div class="automation-assets-order-item" data-order-key="${esc(key)}"><b>${index + 1}</b>${preview}<span title="${esc(item.name || key)}">${esc(item.name || key)}</span><button type="button" class="icon-btn" data-order-up${index ? '' : ' disabled'} title="Subir">↑</button><button type="button" class="icon-btn" data-order-down${index < picker.keys.length - 1 ? '' : ' disabled'} title="Bajar">↓</button><button type="button" class="icon-btn" data-order-remove title="Quitar">×</button></div>`;
  }).join('') : `<span class="hint">${generativeVideoPicker ? `Sin referencias adicionales: ${esc(picker.modelName)} usará la imagen base del bloque.` : 'Elegí al menos una imagen o video.'}</span>`;
  $('#automationAssetsOrder').querySelectorAll('[data-order-key]').forEach((row) => {
    const key = row.dataset.orderKey;
    row.querySelector('[data-order-up]')?.addEventListener('click', () => {
      const index = picker.keys.indexOf(key);
      if (index > 0) [picker.keys[index - 1], picker.keys[index]] = [picker.keys[index], picker.keys[index - 1]];
      renderAutomationAssetsPicker();
    });
    row.querySelector('[data-order-down]')?.addEventListener('click', () => {
      const index = picker.keys.indexOf(key);
      if (index >= 0 && index < picker.keys.length - 1) [picker.keys[index], picker.keys[index + 1]] = [picker.keys[index + 1], picker.keys[index]];
      renderAutomationAssetsPicker();
    });
    row.querySelector('[data-order-remove]')?.addEventListener('click', () => {
      picker.keys = picker.keys.filter((candidate) => candidate !== key);
      renderAutomationAssetsPicker();
    });
  });
}

async function openAutomationAssetsPicker(blockElement, block) {
  if (!automationVisualAssets().length) {
    try { await refreshAssets(); } catch { /* el modal mostrará el estado vacío */ }
  }
  const settings = blockElement.querySelector('[data-block-assets-settings]');
  let keys = [];
  try { keys = JSON.parse(settings?.dataset.assetKeys || '[]'); } catch { keys = []; }
  state.automationAssetPicker = {
    purpose: 'assets-block',
    blockElement,
    blockId: block.id,
    keys: Array.isArray(keys) ? [...keys] : [],
    zone: 'all',
    search: ''
  };
  $('#automationAssetsTitle').textContent = `Assets · ${block.title || 'Bloque'}`;
  renderAutomationAssetsPicker();
  $('#automationAssetsModal').hidden = false;
}

async function openGenerativeVideoBlockAssetsPicker(blockElement, block, modelId) {
  try { await refreshAssets(); } catch { /* el modal mostrará el último estado disponible */ }
  const isSeedance25 = modelId === 'seedance-2-5';
  const isOmni = modelId === 'gemini-omni-1-1-flash';
  const model = state.videoModels.find((item) => item.id === modelId);
  const settingsSelector = isOmni ? '[data-block-omni-settings]' : isSeedance25 ? '[data-block-seedance25-settings]' : '[data-block-h3-settings]';
  const settings = blockElement.querySelector(settingsSelector);
  const datasetKey = isOmni ? 'omniReferenceKeys' : isSeedance25 ? 'seedance25ReferenceKeys' : 'h3ReferenceKeys';
  let keys = [];
  try { keys = JSON.parse(settings?.dataset[datasetKey] || '[]'); } catch { keys = []; }
  state.automationAssetPicker = {
    purpose: 'generative-video-block', blockElement, blockId: block?.id || '', modelId,
    modelName: model?.name || modelId,
    mediaLimits: isOmni ? { ...(model?.mediaLimits || {}), image: 5, total: 8 } : (model?.mediaLimits || {}), settingsSelector,
    datasetKey, listSelector: isOmni ? '[data-block-omni-list]' : isSeedance25 ? '[data-block-seedance25-list]' : '[data-block-h3-list]',
    keys: Array.isArray(keys) ? [...keys] : [], zone: 'all', search: ''
  };
  $('#automationAssetsAudioTab').hidden = (model?.mediaLimits?.audio || 0) === 0;
  if ((model?.mediaLimits?.audio || 0) === 0 && state.automationAssetPicker.zone === 'audio') state.automationAssetPicker.zone = 'all';
  $('#automationAssetsTitle').textContent = `Referencias ${model?.name || ''} · ${block.title || 'Bloque'}`;
  renderAutomationAssetsPicker();
  $('#automationAssetsModal').hidden = false;
}

function closeAutomationAssetsPicker(commit = false) {
  const picker = state.automationAssetPicker;
  if (commit && picker?.purpose === 'generative-video-block' && picker.blockElement) {
    const settings = picker.blockElement.querySelector(picker.settingsSelector);
    settings.dataset[picker.datasetKey] = JSON.stringify(picker.keys);
    settings.querySelector(picker.listSelector).innerHTML = automationBlockAssetSelectionMarkup(picker.keys);
  } else if (commit && picker?.blockElement) {
    const settings = picker.blockElement.querySelector('[data-block-assets-settings]');
    settings.dataset.assetKeys = JSON.stringify(picker.keys);
    settings.querySelector('[data-block-assets-list]').innerHTML = automationBlockAssetSelectionMarkup(picker.keys);
  }
  $('#automationAssetsModal').hidden = true;
  $('#automationAssetsAudioTab').hidden = true;
  state.automationAssetPicker = null;
}

$$('#automationAssetsTabs [data-auto-assets-zone]').forEach((button) => button.addEventListener('click', () => {
  if (!state.automationAssetPicker) return;
  state.automationAssetPicker.zone = button.dataset.autoAssetsZone;
  renderAutomationAssetsPicker();
}));
$('#automationAssetsSearch').addEventListener('input', () => {
  if (!state.automationAssetPicker) return;
  state.automationAssetPicker.search = $('#automationAssetsSearch').value;
  renderAutomationAssetsPicker();
});
$('#automationAssetsClose').addEventListener('click', () => closeAutomationAssetsPicker(false));
$('#automationAssetsCancel').addEventListener('click', () => closeAutomationAssetsPicker(false));
$('#automationAssetsDone').addEventListener('click', () => {
  if (!state.automationAssetPicker?.keys.length) return toast('Elegí al menos un archivo.', 'err');
  closeAutomationAssetsPicker(true);
});
$('#automationAssetsModal').addEventListener('click', (event) => {
  if (event.target.id === 'automationAssetsModal') closeAutomationAssetsPicker(false);
});

function renderAutomationProject() {
  const pr = currentAutomation();
  if (!pr) return;
  sortEntities();
  $('#automationTitle').textContent = pr.name;
  const missing = automationMissing(pr);
  $('#automationMeta').textContent = `${pr.blocks.length} bloques · ${missing.length ? `faltan ${missing.length} asignaciones` : 'listo para automatizar'}`;
  const models = state.models || [];
  const model = models.find((m) => m.id === pr.config.imageModelId) || models[0];
  const chars = state.characters;
  const locs = state.elements.filter((e) => e.kind === 'location');
  const objs = state.elements.filter((e) => e.kind === 'object');
  const completedVideos = pr.blocks.filter((block) => pr.outputs?.[block.id]?.videoKey).length;
  const allVideosReady = pr.blocks.length > 0 && completedVideos === pr.blocks.length;
  const finalOutput = pr.finalOutput?.videoKey ? pr.finalOutput : null;
  const effectOutput = pr.effectOutput?.videoKey ? pr.effectOutput : null;
  const textRefreshOutput = effectOutput || finalOutput;
  const textRefreshTargetLabel = effectOutput ? 'la versión con efectos' : 'el video final limpio';
  const textRefreshPending = Boolean(pr.textRefreshRequiredAt);
  const finalization = pr.finalization || null;
  const includeLogos = pr.config?.includeLogos === true;
  const videoEffect = {
    enabled: false,
    preset: 'wiggle',
    intensity: 35,
    maskEnabled: false,
    maskColor: '#000000',
    maskOpacity: 10,
    ...(pr.config?.videoEffect || {})
  };
  const dynamicText = {
    enabled: false,
    titleAnimation: 'rise',
    captionAnimation: 'word-pop',
    wordsPerPage: 5,
    ...(pr.config?.dynamicText || {})
  };
  const automationAudioModel = (state.audioModels || []).find((candidate) => candidate.id === pr.config?.audioModelId)
    || state.audioModels?.[0];
  const transitionSound = { enabled: false, soundId: '', ...(pr.config?.transitionSound || {}) };
  const selectedTransitionSound = (state.transitionSounds || []).find((sound) => sound.id === transitionSound.soundId);
  const titleOverlay = {
    ...DEFAULT_AUTOMATION_TITLE_OVERLAY,
    text: pr.integration?.scriptTitle || pr.name,
    blockId: pr.blocks[0]?.id || '',
    ...(pr.config?.titleOverlay || {})
  };
  const savedMusic = pr.config.music || {};
  const legacyGainDb = Number.isFinite(Number(savedMusic.volumePct))
    ? (Number(savedMusic.volumePct) <= 0 ? -60 : 20 * Math.log10(Math.min(100, Number(savedMusic.volumePct)) / 100))
    : -15;
  const music = {
    enabled: false, source: 'asset', assetKey: '', genres: [], instruments: [], moods: [], gainDb: legacyGainDb,
    fadeOut: false, fadeOutSeconds: 5,
    sunoModel: state.musicModel?.defaultVersion || 'V5_5', ...savedMusic
  };
  const musicAssets = (state.assets.audio || []).filter((asset) => (asset.audioKind || (asset.modelId === 'suno' ? 'music' : 'voice')) === 'music');
  const selectedMusic = musicAssets.find((asset) => asset.key === music.assetKey);
  const musicTestVoiceKey = pr.blocks.map((block) => pr.outputs?.[block.id]?.audioKeys?.[0]).find(Boolean) || '';

  const assignRow = (kind, r, options) => {
    const cur = pr.assignments[kind]?.[r.role] || '';
    const generated = kind === 'characters' ? automationGeneratedCharacter(pr, r.role) : null;
    const assigned = generated?.id === cur ? { ...generated, automationOnly: true } : options.find((item) => item.id === cur);
    const cover = assigned && (assigned.sheet || assigned.photos?.[0]);
    const selectedVoiceId = kind === 'characters' ? (assigned?.voiceId || '') : '';
    const kindLabel = kind === 'characters' ? 'personaje' : kind === 'locations' ? 'fondo' : 'objeto';
    return `<div class="assign-row resource-role-card" data-role-card="${kind}:${esc(r.role)}">
      <div class="assign-copy">
        <span class="assign-role">@${esc(r.role)}</span>
        <span class="assign-desc hint">${esc(r.description || '')}</span>
        ${r.clothing ? `<span class="assign-detail"><strong>Vestimenta:</strong> ${esc(r.clothing)}</span>` : ''}
        ${kind === 'characters' && r.voice ? `<span class="assign-detail"><strong>Voz sugerida:</strong> ${esc(r.voice)}</span>` : ''}
      </div>
        ${cover ? `<button type="button" class="role-sheet-preview" data-open-asset="${esc(cover)}" title="Abrir ficha y acciones${assigned?.automationOnly ? '; desde ahí puedes convertirla manualmente en personaje' : ''}"><img src="${fileUrl(cover)}" alt=""></button>` : ''}
      <div class="role-resource-controls">
        <label>${kind === 'locations' ? 'Fondo asignado' : `${kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1)} asignado`}</label>
         <select class="select" data-assign="${kind}:${esc(r.role)}">
           <option value="">— sin asignar —</option>
           ${generated ? `<option value="${esc(generated.id)}"${generated.id === cur ? ' selected' : ''}>${esc(generated.name)} · sólo este proyecto</option>` : ''}
           ${options.map((o) => `<option value="${o.id}"${o.id === cur ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}
         </select>
        <label>Modelo para generar esta ficha</label>
        <div class="role-generate-line">
          <select class="select" data-role-model>
            ${models.map((item) => `<option value="${item.id}"${item.id === model?.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}
          </select>
          <button type="button" class="mini-btn" data-generate-resource>${IC('spark')} Generar ${kindLabel}</button>
        </div>
        ${kind === 'characters' ? `<label>Voz del personaje</label>
          <div class="role-generate-line">
            <select class="select" data-role-voice>
              <option value="">— sin voz propia —</option>
              ${(state.voices || []).map((voice) => `<option value="${voice.id}"${voice.id === selectedVoiceId ? ' selected' : ''}>${esc(voice.name)}${voice.category ? ` · ${esc(voice.category)}` : ''}</option>`).join('')}
            </select>
            <button type="button" class="mini-btn" data-save-role-voice${cur ? '' : ' disabled'}>Guardar voz</button>
          </div>
          <span class="hint">${cur ? (assigned?.voiceId ? `Voz actual: ${esc(assigned.voiceName || assigned.voiceId)}` : 'Este personaje todavía no tiene voz propia.') : 'La voz elegida se guardará con el recurso interno del proyecto.'}${assigned?.automationOnly ? ' No se añadió a la biblioteca de Personajes.' : ''}</span>` : ''}
      </div>
      <label class="role-prompt-label">Prompt de la ficha · inglés
        <textarea data-role-prompt rows="5">${esc(automationResourcePrompt(kind, r))}</textarea>
      </label>
      <span class="hint role-status" data-role-status></span>
    </div>`;
  };

  $('#automationRoot').innerHTML = `
    <div class="automation-panel">
      <div class="automation-panel-heading">
        <div>
          <h3>Asignación de roles</h3>
          <span class="hint" id="autoResourcesProgress">${missing.length ? `${missing.length} assets requeridos todavía no están asignados.` : 'Todos los assets requeridos están asignados.'}</span>
        </div>
        <button type="button" class="generate-btn" id="autoGenerateAllResources"${missing.length ? '' : ' disabled'}>
          ${IC('spark')} Generar todos los assets faltantes
        </button>
      </div>
      ${pr.requirements.characters.length ? `<div class="assign-group"><h4>Personajes</h4>${pr.requirements.characters.map((r) => assignRow('characters', r, chars)).join('')}</div>` : ''}
      ${pr.requirements.locations.length ? `<div class="assign-group"><h4>Locaciones</h4>${pr.requirements.locations.map((r) => assignRow('locations', r, locs)).join('')}</div>` : ''}
      ${pr.requirements.objects.length ? `<div class="assign-group"><h4>Objetos</h4>${pr.requirements.objects.map((r) => assignRow('objects', r, objs)).join('')}</div>` : ''}
      ${!pr.requirements.characters.length && !pr.requirements.locations.length && !pr.requirements.objects.length ? '<p class="hint">Este proyecto no declara requisitos. Importá un guion de Controversy Tracker para tenerlos.</p>' : ''}
    </div>

    <div class="automation-panel">
      <h3>Configuración</h3>
      <div class="control-row"><label>Nombre del proyecto</label>
        <input type="text" id="autoProjectName" maxlength="120" value="${esc(pr.name)}">
        <span class="hint">Los cambios del proyecto se guardan en Manifestador. El botón superior confirma el nombre.</span>
      </div>
      <div class="control-row auto-style-row"><label>Estilo artístico global</label>
        <div class="auto-style-field">
          <textarea id="autoArtStyle" maxlength="1200" rows="3" placeholder="Write the global art direction in English…">${esc(pr.config.artStyle || DEFAULT_AUTOMATION_ART_STYLE)}</textarea>
          <div class="auto-style-prompt-tools">
            <select class="select" id="autoArtPrompt">${automationArtPromptOptions()}</select>
            <button type="button" class="mini-btn" id="autoApplyArtPrompt"${(state.prompts || []).some((prompt) => !['audio', 'video'].includes(prompt.mode)) ? '' : ' disabled'}>${IC('book')} Usar prompt guardado</button>
          </div>
          ${automationStyleReferenceMarkup(pr)}
          <span class="hint">Escribilo en inglés o cargalo desde tu biblioteca de Prompts. Se añade obligatoriamente a todas las fichas y bloques para mantener el mismo lenguaje visual.</span>
        </div>
      </div>
      <div class="control-row"><label>Modelo de imagen</label>
        <select class="select" id="autoModel">${models.map((m) => `<option value="${m.id}"${m.id === model?.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <label>Modelo de respaldo</label>
        <select class="select" id="autoFallbackModel">
          <option value="">— sin respaldo —</option>
          ${models.map((m) => `<option value="${m.id}"${m.id === pr.config.fallbackImageModelId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select>
        <span class="hint">Si el principal rechaza o falla, se intenta una vez con este modelo.</span>
      </div>
      <div class="control-row"><label>Proporción</label>
        <select class="select" id="autoAr">${(model?.aspectRatios || []).map((a) => `<option${a === pr.config.aspectRatio ? ' selected' : ''}>${a}</option>`).join('')}</select>
        <label>Resolución</label>
        <select class="select" id="autoRes">${(model?.resolutions || []).map((r) => `<option${r === pr.config.resolution ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="control-row"><label>Voz del narrador</label>
        <select class="select" id="autoVoice"><option value="">— elegí una voz —</option>${(state.voices || []).map((v) => `<option value="${v.id}"${v.id === pr.config.narratorVoiceId ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        <label>Modelo de ElevenLabs</label>
        <select class="select" id="autoAudioModel">${(state.audioModels || []).map((audioModel) => `<option value="${esc(audioModel.id)}"${audioModel.id === automationAudioModel?.id ? ' selected' : ''}>${esc(audioModel.name)}</option>`).join('')}</select>
        <span class="hint">Los diálogos usan la voz del personaje asignado (si tiene); si no, la del narrador. ${esc(automationAudioModel?.notes || '')}</span>
      </div>
      <div class="control-row"><label>Conexión HeyGen para bloques</label>
        <select class="select" id="autoHeyGenAuth"><option value="key"${pr.config.heygenAuthMode === 'oauth' ? '' : ' selected'}>API key</option><option value="oauth"${pr.config.heygenAuthMode === 'oauth' ? ' selected' : ''}>OAuth · plan web</option></select>
        <span class="hint">${pr.config.heygenAuthMode === 'oauth' ? (state.heygenOAuth.connected ? 'OAuth conectado.' : 'OAuth no conectado; hacelo desde Configuración.') : (state.config?.keys?.heygen ? 'API key configurada.' : 'Falta la API key de HeyGen en Configuración.')}</span>
      </div>
      <div class="automation-music-panel${music.enabled ? ' enabled' : ''}" id="autoMusicPanel">
        <div class="automation-music-head">
          <div><h4>Música de fondo</h4><span class="hint">Opcional · una pista se repite en bucle durante todo el video final.</span></div>
          <label class="poser-toggle"><input type="checkbox" id="autoMusicEnabled"${music.enabled ? ' checked' : ''}> usar música</label>
        </div>
        <div class="automation-music-grid">
          <label class="automation-music-source"><span>Origen</span><select class="select" id="autoMusicSource">
            <option value="asset"${music.source === 'asset' ? ' selected' : ''}>Elegir de Assets / subida</option>
            <option value="auto"${music.source === 'auto' ? ' selected' : ''}>Elegir automáticamente por etiquetas</option>
            <option value="suno"${music.source === 'suno' ? ' selected' : ''}>Generar con Suno</option>
          </select></label>
          <label class="automation-music-track"><span>Pista</span><select class="select" id="autoMusicTrack"><option value="">— ninguna —</option>${musicAssets.map((asset) => `<option value="${esc(asset.key)}"${asset.key === music.assetKey ? ' selected' : ''}>${esc(asset.name)}</option>`).join('')}</select></label>
          <label class="automation-music-gain"><span>Nivel musical · dB</span><input type="number" id="autoMusicGain" min="-60" max="0" step="1" value="${Number(music.gainDb).toFixed(1)}"></label>
          <label class="automation-music-model"><span>Modelo Suno</span><select class="select" id="autoMusicModel">${(state.musicModel?.versions || [music.sunoModel]).map((version) => `<option value="${esc(version)}"${version === music.sunoModel ? ' selected' : ''}>${esc(version)}</option>`).join('')}</select></label>
          <label class="automation-music-toggle"><span>Final musical</span><span><input type="checkbox" id="autoMusicFadeOut"${music.fadeOut ? ' checked' : ''}> Fade out</span></label>
          <label class="automation-music-fade"><span>Duración del fade · segundos</span><input type="number" id="autoMusicFadeSeconds" min="0.25" max="30" step="0.25" value="${music.fadeOutSeconds}"${music.fadeOut ? '' : ' disabled'}></label>
          <label class="automation-music-genres"><span>Género</span><input type="text" id="autoMusicGenres" value="${esc((music.genres || []).join(', '))}" placeholder="ambient, orchestral"></label>
          <label class="automation-music-instruments"><span>Instrumentos</span><input type="text" id="autoMusicInstruments" value="${esc((music.instruments || []).join(', '))}" placeholder="piano, strings"></label>
          <label class="automation-music-moods"><span>Sentimientos</span><input type="text" id="autoMusicMoods" value="${esc((music.moods || []).join(', '))}" placeholder="mysterious, tense"></label>
        </div>
        <div class="automation-music-actions">
          <button type="button" class="mini-btn" id="autoMusicAuto">${IC('spark')} Elegir automáticamente</button>
          <button type="button" class="mini-btn" id="autoMusicGenerate">${IC('music')} Generar con Suno</button>
          <button type="button" class="mini-btn" id="autoMusicUpload">${IC('upload')} Subir música</button>
          <button type="button" class="mini-btn" id="autoMusicTest"${selectedMusic ? '' : ' disabled'}>${IC('play')} ${musicTestVoiceKey ? 'Probar con voz' : 'Probar música'}</button>
          <span class="hint" id="autoMusicStatus">${selectedMusic ? `Seleccionada: ${esc(selectedMusic.name)}` : music.assetKey ? 'La pista seleccionada ya no está disponible.' : 'Todavía no hay una pista seleccionada.'}</span>
        </div>
        ${selectedMusic ? `<audio class="automation-music-preview" id="autoMusicPreview" src="${fileUrl(selectedMusic.key)}" controls preload="metadata"></audio>${musicTestVoiceKey ? `<audio id="autoMusicVoicePreview" src="${fileUrl(musicTestVoiceKey)}" preload="metadata" hidden></audio>` : ''}<span class="hint automation-music-test-hint">La reproducción respeta ${Number(music.gainDb).toFixed(1)} dB${musicTestVoiceKey ? ' y puede compararse con una voz ya generada del proyecto.' : '. Generá al menos una voz para probar el balance conjunto.'}</span>` : ''}
      </div>
      <div class="automation-transition-panel${transitionSound.enabled ? ' enabled' : ''}" id="autoTransitionPanel">
        <div class="automation-transition-head">
          <div><h4>Transición sonora entre tomas</h4><span class="hint">Opcional · se reproduce en cada corte interno, nunca al inicio ni después de la última toma.</span></div>
          <label class="poser-toggle"><input type="checkbox" id="autoTransitionEnabled"${transitionSound.enabled ? ' checked' : ''}> activar</label>
        </div>
        <div class="automation-transition-controls">
          <label><span>Sonido por categoría</span><select class="select" id="autoTransitionSound">${automationTransitionSoundOptions(transitionSound.soundId)}</select></label>
          <button type="button" class="mini-btn" id="autoTransitionTest"${selectedTransitionSound ? '' : ' disabled'}>${IC('play')} Probar una vez</button>
          <span class="hint" id="autoTransitionStatus">${selectedTransitionSound ? `${esc(selectedTransitionSound.category)} · ${esc(selectedTransitionSound.name)}` : (state.transitionSounds || []).length ? 'Elegí un sonido; se reproducirá automáticamente una vez.' : 'No hay sonidos instalados.'}</span>
        </div>
      </div>
      <div class="overlay-preset-bar">
        <div><h4>Estilos de títulos y textos</h4><span class="hint">Guarda tipografía, resaltado, posiciones y animaciones como un preset reutilizable.</span></div>
        <select class="select" id="overlayPresetSelect">${overlayPresetOptions()}</select>
        <button type="button" class="mini-btn" id="overlayPresetApply"${(state.overlayPresets || []).length ? '' : ' disabled'}>${IC('check')} Aplicar</button>
        <button type="button" class="mini-btn accent" id="overlayPresetSave">${IC('save')} Guardar estilo actual</button>
        <button type="button" class="mini-btn danger" id="overlayPresetDelete" disabled>${IC('trash')}</button>
      </div>
      <div class="automation-dynamic-text-panel${dynamicText.enabled ? ' enabled' : ''}" id="autoDynamicTextPanel">
        <div class="automation-dynamic-text-head">
          <div>
            <h4>Texto dinámico · Remotion</h4>
            <span class="hint">Genera una capa transparente animada, sincronizada palabra por palabra con la voz, y la integra tanto en imágenes como en HeyGen.</span>
          </div>
          <label class="poser-toggle"><input type="checkbox" id="autoDynamicTextEnabled"${dynamicText.enabled ? ' checked' : ''}> activar</label>
        </div>
        <div class="automation-dynamic-text-grid">
          <label><span>Animación del título</span><select class="select" id="autoTitleAnimation">
            <option value="rise"${dynamicText.titleAnimation === 'rise' ? ' selected' : ''}>Ascenso suave</option>
            <option value="slam"${dynamicText.titleAnimation === 'slam' ? ' selected' : ''}>Impacto</option>
            <option value="typewriter"${dynamicText.titleAnimation === 'typewriter' ? ' selected' : ''}>Máquina de escribir</option>
          </select></label>
          <label><span>Animación de subtítulos</span><select class="select" id="autoCaptionAnimation">
            <option value="word-pop"${dynamicText.captionAnimation === 'word-pop' ? ' selected' : ''}>Palabra con impacto</option>
            <option value="karaoke"${dynamicText.captionAnimation === 'karaoke' ? ' selected' : ''}>Resaltado karaoke</option>
            <option value="bounce"${dynamicText.captionAnimation === 'bounce' ? ' selected' : ''}>Rebote</option>
          </select></label>
          <label><span>Palabras visibles por grupo</span><input type="number" id="autoWordsPerPage" min="1" max="12" step="1" value="${dynamicText.wordsPerPage}"></label>
        </div>
        <span class="hint automation-dynamic-text-note">Los audios nuevos de ElevenLabs usan sus marcas temporales exactas. Los audios antiguos se sincronizan por estimación hasta que vuelvan a generarse.</span>
      </div>
      <h4>Texto sobreimpreso</h4>
      <div class="overlay-typography-grid">
        <div class="overlay-type-card">
          <h5>Texto normal</h5>
          <label><span>Fuente</span><span class="overlay-font-line"><select class="select" id="ovFont">${overlayFontOptions(pr.config.overlay.font)}</select><button type="button" class="mini-btn" data-import-font="font">Importar</button></span></label>
          <label><span>Tamaño · px @ 1080</span><input type="number" id="ovSize" min="8" max="300" step="1" value="${pr.config.overlay.fontSizePx}"></label>
          <label><span>Peso</span><select class="select" id="ovWeight">${[400, 500, 600, 700, 800, 900].map((weight) => `<option value="${weight}"${weight === pr.config.overlay.fontWeight ? ' selected' : ''}>${weight}</option>`).join('')}</select></label>
          <label><span>Mayúsculas y minúsculas</span><select class="select" id="ovTransform">${[['none', 'Como fue escrito'], ['uppercase', 'MAYÚSCULAS'], ['lowercase', 'minúsculas'], ['capitalize', 'Iniciales En Mayúscula']].map(([value, label]) => `<option value="${value}"${value === (pr.config.overlay.textTransform || 'none') ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <div class="overlay-format-options" aria-label="Formato del texto normal">
            <label><input type="checkbox" id="ovItalic"${pr.config.overlay.fontItalic ? ' checked' : ''}> <em>Cursiva</em></label>
            <label><input type="checkbox" id="ovUnderline"${pr.config.overlay.fontUnderline ? ' checked' : ''}> <u>Subrayado</u></label>
            <label><input type="checkbox" id="ovStrike"${pr.config.overlay.fontStrikeThrough ? ' checked' : ''}> <s>Tachado</s></label>
          </div>
          <label><span>Color</span><input type="color" id="ovColor" value="${pr.config.overlay.color}"></label>
          <label><span>Color del borde</span><input type="color" id="ovStroke" value="${pr.config.overlay.strokeColor}"></label>
          <label><span>Borde · px @ 1080</span><input type="number" id="ovStrokeW" min="0" max="30" step="0.5" value="${pr.config.overlay.strokeWidthPx}"></label>
        </div>
        <div class="overlay-type-card highlight">
          <h5>Texto resaltado</h5>
          <label><span>Fuente</span><span class="overlay-font-line"><select class="select" id="ovHlFont">${overlayFontOptions(pr.config.overlay.highlightFont || '', { inherit: true })}</select><button type="button" class="mini-btn" data-import-font="highlightFont">Importar</button></span></label>
          <label><span>Tamaño · px @ 1080</span><input type="number" id="ovHlSize" min="8" max="300" step="1" value="${pr.config.overlay.highlightFontSizePx}"></label>
          <label><span>Peso</span><select class="select" id="ovHlWeight">${[400, 500, 600, 700, 800, 900].map((weight) => `<option value="${weight}"${weight === pr.config.overlay.highlightFontWeight ? ' selected' : ''}>${weight}</option>`).join('')}</select></label>
          <label><span>Mayúsculas y minúsculas</span><select class="select" id="ovHlTransform">${[['none', 'Como fue escrito'], ['uppercase', 'MAYÚSCULAS'], ['lowercase', 'minúsculas'], ['capitalize', 'Iniciales En Mayúscula']].map(([value, label]) => `<option value="${value}"${value === (pr.config.overlay.highlightTextTransform || 'none') ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <div class="overlay-format-options" aria-label="Formato del texto resaltado">
            <label><input type="checkbox" id="ovHlItalic"${pr.config.overlay.highlightFontItalic ? ' checked' : ''}> <em>Cursiva</em></label>
            <label><input type="checkbox" id="ovHlUnderline"${pr.config.overlay.highlightFontUnderline ? ' checked' : ''}> <u>Subrayado</u></label>
            <label><input type="checkbox" id="ovHlStrike"${pr.config.overlay.highlightFontStrikeThrough ? ' checked' : ''}> <s>Tachado</s></label>
          </div>
          <label><span>Color</span><input type="color" id="ovHl" value="${pr.config.overlay.highlightColor || '#fbbf24'}"></label>
          <label><span>Color del borde</span><input type="color" id="ovHlStroke" value="${pr.config.overlay.highlightStrokeColor || '#000000'}"></label>
          <label><span>Borde · px @ 1080</span><input type="number" id="ovHlStrokeW" min="0" max="30" step="0.5" value="${pr.config.overlay.highlightStrokeWidthPx}"></label>
        </div>
      </div>
      <input type="file" id="ovFontFile" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden>
      <span class="hint">Las fuentes importadas (TTF, OTF, WOFF o WOFF2) quedan guardadas en Manifestador y disponibles para todos los proyectos. Los valores tipográficos son píxeles sobre una referencia de 1080 px de alto y se escalan proporcionalmente.</span>
      <div class="overlay-layout-controls">
        <label><span>Posición vertical</span><select class="select" id="ovPos">${[['top', 'Arriba'], ['center', 'Centro'], ['bottom', 'Abajo']].map(([v, l]) => `<option value="${v}"${v === pr.config.overlay.position ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label><span>Alineación horizontal</span><select class="select" id="ovAlign">${[['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']].map(([v, l]) => `<option value="${v}"${v === (pr.config.overlay.align || 'center') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label><span>Ancho máximo · %</span><input type="number" id="ovMaxWidth" min="20" max="100" step="1" value="${pr.config.overlay.maxWidthPct || 88}"></label>
        <button type="button" class="mini-btn" id="ovCenterX">Centrar horizontalmente</button>
        <label class="poser-toggle"><input type="checkbox" id="ovBg" ${pr.config.overlay.bg ? 'checked' : ''}> caja de fondo</label>
      </div>
      <div class="title-overlay-panel${titleOverlay.enabled ? ' enabled' : ''}" id="autoTitlePanel">
        <div class="title-overlay-heading">
          <div><h4>Títulos</h4><span class="hint">Opcional · puede mostrar el título propio de cada bloque, sin anteponer “Bloque X”, o un título general en una toma elegida. No se agrega a la voz.</span></div>
          <label class="poser-toggle"><input type="checkbox" id="autoTitleEnabled"${titleOverlay.enabled ? ' checked' : ''}> incluir título</label>
        </div>
        <div class="title-overlay-targets">
          <label><span>Qué título mostrar</span><select class="select" id="autoTitleMode"><option value="block"${titleOverlay.mode === 'block' ? ' selected' : ''}>Título propio de cada bloque</option><option value="project"${titleOverlay.mode === 'project' ? ' selected' : ''}>Título general del proyecto</option></select></label>
          <label id="autoTitleTextField"><span>Texto del título general</span><input type="text" id="autoTitleText" maxlength="300" value="${esc(titleOverlay.text || pr.integration?.scriptTitle || pr.name)}"></label>
          <label><span id="autoTitleBlockLabel">${titleOverlay.mode === 'block' ? 'Bloque para la previsualización' : 'Mostrar el título general en'}</span><select class="select" id="autoTitleBlock">${pr.blocks.map((block, index) => `<option value="${esc(block.id)}"${block.id === titleOverlay.blockId ? ' selected' : ''}>Bloque ${index + 1}${block.title ? ` · ${esc(block.title)}` : ''}</option>`).join('')}</select></label>
        </div>
        <div class="overlay-type-card title">
          <h5>Estilo independiente del título</h5>
          <label><span>Fuente</span><span class="overlay-font-line"><select class="select" id="titleFont">${overlayFontOptions(titleOverlay.font)}</select><button type="button" class="mini-btn" data-import-font="titleFont">Importar</button></span></label>
          <label><span>Tamaño · px @ 1080</span><input type="number" id="titleSize" min="8" max="300" step="1" value="${titleOverlay.fontSizePx}"></label>
          <label><span>Peso</span><select class="select" id="titleWeight">${[400, 500, 600, 700, 800, 900].map((weight) => `<option value="${weight}"${weight === titleOverlay.fontWeight ? ' selected' : ''}>${weight}</option>`).join('')}</select></label>
          <label><span>Mayúsculas y minúsculas</span><select class="select" id="titleTransform">${[['none', 'Como fue escrito'], ['uppercase', 'MAYÚSCULAS'], ['lowercase', 'minúsculas'], ['capitalize', 'Iniciales En Mayúscula']].map(([value, label]) => `<option value="${value}"${value === titleOverlay.textTransform ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <div class="overlay-format-options" aria-label="Formato del título">
            <label><input type="checkbox" id="titleItalic"${titleOverlay.fontItalic ? ' checked' : ''}> <em>Cursiva</em></label>
            <label><input type="checkbox" id="titleUnderline"${titleOverlay.fontUnderline ? ' checked' : ''}> <u>Subrayado</u></label>
            <label><input type="checkbox" id="titleStrike"${titleOverlay.fontStrikeThrough ? ' checked' : ''}> <s>Tachado</s></label>
          </div>
          <label><span>Color</span><input type="color" id="titleColor" value="${titleOverlay.color}"></label>
          <label><span>Color del borde</span><input type="color" id="titleStroke" value="${titleOverlay.strokeColor}"></label>
          <label><span>Borde · px @ 1080</span><input type="number" id="titleStrokeW" min="0" max="30" step="0.5" value="${titleOverlay.strokeWidthPx}"></label>
        </div>
        <div class="overlay-layout-controls title-layout-controls">
          <label><span>Posición vertical</span><select class="select" id="titlePos">${[['top', 'Arriba'], ['center', 'Centro'], ['bottom', 'Abajo']].map(([value, label]) => `<option value="${value}"${value === titleOverlay.position ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label><span>Alineación horizontal</span><select class="select" id="titleAlign">${[['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']].map(([value, label]) => `<option value="${value}"${value === titleOverlay.align ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label><span>Ancho máximo · %</span><input type="number" id="titleMaxWidth" min="20" max="100" step="1" value="${titleOverlay.maxWidthPct}"></label>
          <button type="button" class="mini-btn" id="titleCenterX">Centrar horizontalmente</button>
          <label class="poser-toggle"><input type="checkbox" id="titleBg"${titleOverlay.bg ? ' checked' : ''}> caja de fondo</label>
        </div>
      </div>
      <div class="ov-preview-tools">
        <button type="button" class="mini-btn" id="ovPickBg">${IC('image')} Fondo de referencia</button>
        ${pr.config.overlay.previewBg ? `<button type="button" class="mini-btn" id="ovClearBg">Quitar fondo</button>` : ''}
        <span class="hint">Arrastrá el texto en la vista para ubicarlo</span>
      </div>
      <div class="ov-preview" id="ovPreview" style="aspect-ratio:${(pr.config.aspectRatio || '9:16').replace(':', '/')}">
        ${pr.config.overlay.previewBg ? `<img class="ov-preview-bg" src="${fileUrl(pr.config.overlay.previewBg)}" alt="">` : ''}
        <div class="ov-title" id="ovTitle"${titleOverlay.enabled ? '' : ' hidden'}>${esc(titleOverlay.text || pr.integration?.scriptTitle || pr.name)}</div>
        <div class="ov-text" id="ovText"><span class="ov-normal">Un texto de </span><span class="ov-hl">ejemplo</span><span class="ov-normal"> dramático acá</span></div>
      </div>
    </div>

    <div class="automation-panel">
      <div class="automation-panel-heading automation-script-heading">
        <div><h3>Guion (${pr.blocks.length} bloques)</h3><span class="hint">Los bloques manuales se integran en la misma secuencia que los importados.</span></div>
        <button type="button" class="mini-btn accent" id="autoAddBlock">${IC('plus')} Añadir bloque</button>
      </div>
      <form class="auto-block-create" id="autoNewBlockForm" hidden>
        <div class="auto-block-create-head"><div><strong>Nuevo bloque manual</strong><span class="hint">Guardar el bloque no genera contenido.</span></div><button type="button" class="mini-btn" id="autoNewBlockCancel">Cancelar</button></div>
        <div class="auto-block-create-grid">
          <label><span>Título interno</span><input type="text" id="autoNewBlockTitle" maxlength="160" placeholder="Ej: La revelación"></label>
          <label><span>Ubicación en el guion</span><select class="select" id="autoNewBlockPosition"><option value="end">Al final</option><option value="start">Al principio</option>${pr.blocks.map((block, index) => `<option value="after:${esc(block.id)}">Después del bloque ${index + 1}${block.title ? ` · ${esc(block.title)}` : ''}</option>`).join('')}</select></label>
          <label class="auto-block-create-wide"><span>Prompt visual · inglés</span><textarea id="autoNewBlockPrompt" maxlength="4000" rows="4" required placeholder="Describe la imagen de esta toma…"></textarea></label>
          <label><span>Tipo de texto inicial</span><select class="select" id="autoNewBlockKind"><option value="narration">Narración</option><option value="dialogue"${pr.requirements.characters.length ? '' : ' disabled'}>Diálogo</option></select></label>
          <label id="autoNewBlockCharacterField" hidden><span>Personaje del diálogo</span><select class="select" id="autoNewBlockCharacter">${pr.requirements.characters.map((role) => `<option value="${esc(role.role)}">${esc(automationRoleName(role.role))} · @${esc(role.role)}</option>`).join('')}</select></label>
          <label class="auto-block-create-wide"><span id="autoNewBlockTextLabel">Narración inicial</span><textarea id="autoNewBlockText" maxlength="2000" rows="3" required placeholder="Texto que se convertirá en audio…"></textarea></label>
        </div>
        <div class="auto-block-create-actions"><span class="hint">Después podrás configurar generador, prompt negativo, HeyGen y el resto de opciones desde el bloque.</span><button type="submit" class="mini-btn accent" id="autoNewBlockSave">${IC('save')} Crear bloque</button></div>
      </form>
      ${pr.blocks.length ? pr.blocks.map((b, i) => {
        const out = pr.outputs?.[b.id] || null;
        const done = Boolean(out?.videoKey);
        const partial = !done && Boolean(out?.imageKey || out?.textImageKey || out?.textLayerKey || out?.motionOverlayKey || out?.audioKeys?.length || out?.h3SegmentVideoKeys?.length);
        const reusableAudioReady = Array.isArray(out?.audioKeys) && out.audioKeys.length >= (b.items || []).length;
        const heygenCharacters = automationHeyGenCharacters();
        const selectedHeyGenCharacter = automationBlockHeyGenCharacter(pr, b);
        const blockGenerator = ['heygen', 'assets', 'h3', 'seedance25', 'omni'].includes(b.generator) ? b.generator : 'image';
        return `
        <div class="auto-block${done ? ' is-done' : ''}" data-block="${b.id}">
          <div class="auto-block-head">
            <strong>Bloque ${i + 1}${b.title ? ` · ${esc(b.title)}` : ''}</strong> <span class="hint">${esc([b.characters.join(', '), b.location, b.prop].filter(Boolean).join(' · '))}</span>
            <span class="auto-block-btns">
              <button class="mini-btn" data-genblock="${b.id}" data-force="${done ? '1' : '0'}"${missing.length ? ' disabled' : ''}>${IC('spark')} ${done ? 'Regenerar' : partial ? 'Continuar' : 'Generar / continuar'}</button>
              ${(out?.imageKey || blockGenerator === 'assets') && reusableAudioReady ? `<button class="mini-btn" data-regen-downstream="${b.id}"${missing.length ? ' disabled' : ''} title="Conserva los visuales y audios existentes; sólo rehace el texto y ensambla el video">${IC('film')} Rehacer texto + video</button>` : ''}
              ${partial ? `<button class="mini-btn danger" data-regenblock="${b.id}"${missing.length ? ' disabled' : ''}>Regenerar desde cero</button>` : ''}
            </span>
          </div>
          <div class="auto-block-editor">
            <div class="auto-block-generator">
              <label><span>Generador de la toma</span><select class="select" data-block-generator><option value="image"${blockGenerator === 'image' ? ' selected' : ''}>Imagen + audio</option><option value="seedance25"${blockGenerator === 'seedance25' ? ' selected' : ''}>Seedance 2.5 · video multimodal</option><option value="h3"${blockGenerator === 'h3' ? ' selected' : ''}>MiniMax H3 · video multimodal</option><option value="omni"${blockGenerator === 'omni' ? ' selected' : ''}>Gemini Omni 1.1 Flash · video</option><option value="heygen"${blockGenerator === 'heygen' ? ' selected' : ''}>HeyGen + audio de ElevenLabs</option><option value="assets"${blockGenerator === 'assets' ? ' selected' : ''}>Assets · imágenes y videos</option></select></label>
              <div class="auto-block-heygen-settings" data-block-heygen-settings${blockGenerator === 'heygen' ? '' : ' hidden'}>
                <label><span>Personaje · variante HeyGen</span><select class="select" data-block-heygen-character>${heygenCharacters.length ? heygenCharacters.map((character) => `<option value="${character.id}"${character.id === selectedHeyGenCharacter?.id ? ' selected' : ''}>${esc(character.name)} · HeyGen · ${character.heygen?.closeAvatarId ? '2 planos' : '1 plano'}</option>`).join('') : '<option value="">— no hay personajes HeyGen listos —</option>'}</select></label>
                <label><span>Encuadre</span><select class="select" data-block-heygen-framing><option value="wide"${b.heygenFraming === 'wide' || !b.heygenFraming ? ' selected' : ''}>Plano general</option><option value="close"${b.heygenFraming === 'close' ? ' selected' : ''}>Primer plano</option><option value="split"${b.heygenFraming === 'split' ? ' selected' : ''}>Alternar general → primer plano</option></select></label>
                <span class="hint" data-block-heygen-hint>${selectedHeyGenCharacter?.heygen?.closeAvatarId ? 'La alternancia corta el texto cerca del punto medio y une ambos videos.' : 'Este personaje solo tiene código de plano general.'}</span>
              </div>
              <div class="auto-block-assets-settings auto-block-h3-settings" data-block-h3-settings${blockGenerator === 'h3' ? '' : ' hidden'} data-h3-reference-keys="${esc(JSON.stringify(b.h3ReferenceKeys || []))}">
                <div class="auto-block-assets-head">
                  <div><strong>MiniMax H3</strong><span class="hint">Video generativo multimodal por cada tramo de narración, luego ensamblado con el texto del proyecto.</span></div>
                  <button type="button" class="mini-btn" data-pick-block-h3>${IC('image')} Referencias adicionales</button>
                </div>
                <div class="auto-block-assets-list" data-block-h3-list>${automationBlockAssetSelectionMarkup(b.h3ReferenceKeys || [])}</div>
                <div class="auto-block-create-grid">
                  <label><span>Modo</span><select class="select" data-block-h3-mode><option value="reference"${b.h3Mode !== 'frames' ? ' selected' : ''}>Referencias multimodales</option><option value="frames"${b.h3Mode === 'frames' ? ' selected' : ''}>Fotograma de entrada → salida</option></select></label>
                  <label><span>Resolución H3</span><select class="select" data-block-h3-resolution><option value="768P"${b.h3Resolution !== '2K' ? ' selected' : ''}>768P</option><option value="2K"${b.h3Resolution === '2K' ? ' selected' : ''}>2K</option></select></label>
                </div>
                <label class="poser-toggle"><input type="checkbox" data-block-h3-context${b.h3ContextIr ? ' checked' : ''}> enriquecer instrucciones con Context-IR</label>
                <label class="poser-toggle"><input type="checkbox" data-block-h3-narration${b.h3UseNarrationReference !== false ? ' checked' : ''}> enviar la narración a H3 como referencia de audio</label>
                <label class="poser-toggle"><input type="checkbox" data-block-h3-native-audio${b.h3KeepGeneratedAudio ? ' checked' : ''}> conservar el audio generado por H3 en lugar del archivo original de ElevenLabs</label>
                <span class="hint" data-block-h3-hint>En Referencias, la imagen base del bloque y la voz se envían a H3. En Inicio → Fin debés elegir exactamente dos imágenes; la voz se añade durante el ensamblado.</span>
              </div>
              <div class="auto-block-assets-settings auto-block-h3-settings" data-block-seedance25-settings${blockGenerator === 'seedance25' ? '' : ' hidden'} data-seedance25-reference-keys="${esc(JSON.stringify(b.seedance25ReferenceKeys || []))}">
                <div class="auto-block-assets-head">
                  <div><strong>Seedance 2.5</strong><span class="hint">Video generativo de hasta 30 segundos por tramo, con referencias multimodales y audio nativo.</span></div>
                  <button type="button" class="mini-btn" data-pick-block-seedance25>${IC('image')} Referencias adicionales</button>
                </div>
                <div class="auto-block-assets-list" data-block-seedance25-list>${automationBlockAssetSelectionMarkup(b.seedance25ReferenceKeys || [])}</div>
                <div class="auto-block-create-grid">
                  <label><span>Modo</span><select class="select" data-block-seedance25-mode><option value="reference"${b.seedance25Mode !== 'frames' ? ' selected' : ''}>Referencias multimodales</option><option value="frames"${b.seedance25Mode === 'frames' ? ' selected' : ''}>Fotograma de entrada → salida</option></select></label>
                  <label><span>Resolución</span><select class="select" data-block-seedance25-resolution><option value="480p"${b.seedance25Resolution === '480p' ? ' selected' : ''}>480p</option><option value="720p"${b.seedance25Resolution !== '480p' ? ' selected' : ''}>720p</option></select></label>
                </div>
                <label class="poser-toggle"><input type="checkbox" data-block-seedance25-narration${b.seedance25UseNarrationReference !== false ? ' checked' : ''}> enviar la narración como @Audio de referencia</label>
                <label class="poser-toggle"><input type="checkbox" data-block-seedance25-native-audio${b.seedance25KeepGeneratedAudio ? ' checked' : ''}> conservar el audio generado por Seedance en lugar del archivo original de ElevenLabs</label>
                <span class="hint">En Referencias, la imagen base y la voz se envían a Seedance. Podés citar cada tipo por separado como @Image1, @Video1 o @Audio1. En Inicio → Fin elegí exactamente dos imágenes; la voz se añade durante el ensamblado.</span>
              </div>
              <div class="auto-block-assets-settings auto-block-h3-settings" data-block-omni-settings${blockGenerator === 'omni' ? '' : ' hidden'} data-omni-reference-keys="${esc(JSON.stringify(b.omniReferenceKeys || []))}">
                <div class="auto-block-assets-head">
                  <div><strong>Gemini Omni 1.1 Flash</strong><span class="hint">Tomas de hasta 10 segundos; el montaje conserva la narración exacta de ElevenLabs.</span></div>
                  <button type="button" class="mini-btn" data-pick-block-omni>${IC('image')} Referencias adicionales</button>
                </div>
                <div class="auto-block-assets-list" data-block-omni-list>${automationBlockAssetSelectionMarkup(b.omniReferenceKeys || [])}</div>
                <div class="auto-block-create-grid">
                  <label><span>Modo</span><select class="select" data-block-omni-mode><option value="reference"${b.omniMode !== 'frames' ? ' selected' : ''}>Referencias</option><option value="frames"${b.omniMode === 'frames' ? ' selected' : ''}>Fotograma de entrada → salida</option></select></label>
                  <label><span>Resolución</span><select class="select" data-block-omni-resolution>${['360p', '720p', '1080p', '4K'].map((value) => `<option value="${value}"${value === (b.omniResolution || '720p') ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
                </div>
                <span class="hint">En Referencias usa la imagen base del bloque y hasta 6 imágenes / 3 clips de 3s. Omni no acepta la narración como audio de referencia; se reemplaza por el audio de ElevenLabs al ensamblar.</span>
              </div>
              <div class="auto-block-assets-settings" data-block-assets-settings${blockGenerator === 'assets' ? '' : ' hidden'} data-asset-keys="${esc(JSON.stringify(b.assetKeys || []))}">
                <div class="auto-block-assets-head">
                  <div><strong>Secuencia de Assets</strong><span class="hint">Cada archivo recibe la misma parte de la duración total del audio.</span></div>
                  <button type="button" class="mini-btn" data-pick-block-assets>${IC('image')} Elegir y ordenar</button>
                </div>
                <div class="auto-block-assets-list" data-block-assets-list>${automationBlockAssetSelectionMarkup(b.assetKeys || [])}</div>
                <label class="poser-toggle auto-block-assets-mute"><input type="checkbox" data-block-assets-mute${b.assetMuteOriginal !== false ? ' checked' : ''}> silenciar el sonido original de los videos</label>
                <span class="hint">Si un video es más corto que su tramo, se repite automáticamente hasta completarlo.</span>
              </div>
            </div>
            <label><span>Título interno del bloque</span><input type="text" data-block-title maxlength="160" value="${esc(b.title || '')}"></label>
            <label data-block-prompt-field><span>Prompt visual · inglés</span><textarea data-block-prompt maxlength="4000" rows="5">${esc(automationPromptForEditor(pr, b.imagePrompt))}</textarea></label>
            <label data-block-prompt-field><span>Prompt negativo · inglés</span><textarea data-block-negative maxlength="2000" rows="2">${esc(b.negativePrompt || '')}</textarea></label>
            <div class="auto-block-script-items">
              ${(b.items || []).map((it, itemIndex) => `<label><span>${it.kind === 'dialogue' ? `Diálogo · ${esc(it.character || 'sin personaje')}` : 'Narración'}</span><textarea data-block-item="${itemIndex}" maxlength="2000" rows="3">${esc(it.text)}</textarea></label>`).join('')}
            </div>
            <div class="auto-block-edit-actions"><span class="hint">Guardar no genera nada. Si ya había material, se conservarán las etapas que sigan siendo válidas.</span><button type="button" class="mini-btn accent" data-save-block="${esc(b.id)}">${IC('save')} Guardar cambios del bloque</button></div>
          </div>
          <div class="auto-block-out" data-out="${b.id}">${automationBlockOutHtml(out, b)}</div>
        </div>`;
      }).join('') : '<p class="hint">Sin bloques. Añadí uno manualmente o importá un guion.</p>'}
    </div>

    <div class="automation-actions">
      ${missing.length ? `<span class="hint warn">No se puede automatizar: faltan ${missing.map(esc).join(', ')}.</span>` : `<span class="hint">Todo asignado · ${Object.values(pr.outputs || {}).filter((o) => o?.videoKey).length}/${pr.blocks.length} bloques generados.</span>`}
      <select class="select" id="autoMode"${missing.length ? ' disabled' : ''}>
        <option value="missing">Generar sólo los faltantes</option>
        <option value="all">Regenerar todos</option>
      </select>
      <button class="generate-btn" id="autoStart"${missing.length ? ' disabled' : ''}>${IC('spark')} Automatizar</button>
    </div>

      <div class="automation-panel final-assembly-panel">
        <div class="final-assembly-copy">
          <h3>Video final</h3>
          <label class="final-logo-toggle">
            <input type="checkbox" id="autoIncludeLogos"${includeLogos ? ' checked' : ''}>
            <span><strong>Incluir logos</strong><small>Agrega el cierre de Controversy Tracker con su audio. El video funde a negro y la música termina antes del logo.</small></span>
          </label>
          <span class="hint" id="autoAssembleStatus">${
          allVideosReady
            ? `${completedVideos}/${pr.blocks.length} videos listos para unir en el orden del guion.`
            : `Faltan ${pr.blocks.length - completedVideos} de ${pr.blocks.length} videos de bloque.`
        }</span>
        ${finalOutput ? `<span class="automation-stage-status">Último ensamble · ${finalOutput.blockCount || pr.blocks.length} bloques${finalOutput.width && finalOutput.height ? ` · ${finalOutput.width}×${finalOutput.height}` : ''}${finalOutput.musicKey ? ` · música en bucle${finalOutput.musicFadeOutSeconds ? ` · fade out ${finalOutput.musicFadeOutSeconds}s` : ''}` : ''}${finalOutput.transitionCount ? ` · ${finalOutput.transitionCount} transiciones (${esc(finalOutput.transitionSoundName || 'sonido')})` : ''}${finalOutput.includeLogos ? ` · logo ${finalOutput.logoVariant === 'vertical' ? 'vertical' : 'horizontal'}` : ''} · ${fmtDate(finalOutput.assembledAt)}</span>` : ''}
        <button type="button" class="generate-btn" id="autoAssemble"${allVideosReady ? '' : ' disabled'}>
          ${IC('film')} ${finalOutput ? 'Reensamblar video final' : 'Ensamblar video final'}
        </button>
      </div>
      ${finalOutput ? `<div class="final-assembly-preview">
        <video src="${fileUrl(finalOutput.videoKey)}" controls preload="metadata"></video>
        <button type="button" class="mini-btn" data-open-asset="${esc(finalOutput.videoKey)}">Abrir asset y acciones</button>
      </div>` : ''}
    </div>

    <div class="automation-panel post-effect-panel${videoEffect.enabled ? ' enabled' : ''}" id="autoEffectPanel">
      <div class="post-effect-copy">
        <div class="post-effect-heading">
          <div><h3>Efectos finales</h3><span class="hint">Posproducción opcional: imagen o video HeyGen → efecto → máscara de color → subtítulos. No vuelve a llamar a modelos generativos.</span></div>
          <label class="poser-toggle"><input type="checkbox" id="autoEffectEnabled"${videoEffect.enabled ? ' checked' : ''}> activar</label>
        </div>
        <div class="post-effect-controls">
          <label><span>Efecto</span><select class="select" id="autoEffectPreset">
            <option value="wiggle"${videoEffect.preset === 'wiggle' ? ' selected' : ''}>Wiggle suave</option>
            <option value="oldFilm"${videoEffect.preset === 'oldFilm' ? ' selected' : ''}>Cinta vieja</option>
            <option value="vhs"${videoEffect.preset === 'vhs' ? ' selected' : ''}>VHS</option>
          </select></label>
          <label class="post-effect-intensity"><span>Presencia / intensidad</span><span class="post-effect-range"><input type="range" id="autoEffectIntensity" min="0" max="100" step="1" value="${videoEffect.intensity}"><output id="autoEffectIntensityValue">${videoEffect.intensity}%</output></span></label>
        </div>
        <div class="post-effect-mask${videoEffect.maskEnabled ? ' enabled' : ''}" id="autoEffectMaskPanel">
          <label class="post-effect-mask-toggle"><input type="checkbox" id="autoEffectMaskEnabled"${videoEffect.maskEnabled ? ' checked' : ''}><span>Máscara de color</span></label>
          <label><span>Color</span><input type="color" id="autoEffectMaskColor" value="${esc(videoEffect.maskColor)}"${videoEffect.maskEnabled ? '' : ' disabled'}></label>
          <label class="post-effect-mask-opacity"><span>Opacidad</span><span class="post-effect-range"><input type="range" id="autoEffectMaskOpacity" min="0" max="100" step="1" value="${videoEffect.maskOpacity}"${videoEffect.maskEnabled ? '' : ' disabled'}><output id="autoEffectMaskOpacityValue">${videoEffect.maskOpacity}%</output></span></label>
          <span class="hint">Se coloca sobre la imagen o el video y debajo de títulos, texto y resaltado.</span>
        </div>
        <span class="hint" id="autoEffectStatus">${finalOutput ? 'El video limpio se conserva. Si hay logo, el efecto termina antes del cierre.' : 'Primero ensamblá el video final limpio.'}</span>
        ${effectOutput ? `<span class="automation-stage-status">Última versión · ${esc(effectOutput.presetName || effectOutput.preset)} · intensidad ${effectOutput.intensity}%${effectOutput.maskEnabled ? ` · máscara ${esc(effectOutput.maskColor)} al ${effectOutput.maskOpacity}%` : ''}${effectOutput.subtitlesPreserved ? ' · subtítulos nítidos' : ''}${effectOutput.logoPreserved ? ' · logo preservado' : ''} · ${fmtDate(effectOutput.processedAt)}</span>` : ''}
        <button type="button" class="generate-btn" id="autoApplyEffect"${finalOutput && videoEffect.enabled ? '' : ' disabled'}>${IC('spark')} ${effectOutput ? 'Crear otra versión con efecto' : 'Aplicar efecto al video final'}</button>
      </div>
      ${effectOutput ? `<div class="final-assembly-preview post-effect-preview">
        <video src="${fileUrl(effectOutput.videoKey)}" controls preload="metadata"></video>
        <button type="button" class="mini-btn" data-open-asset="${esc(effectOutput.videoKey)}">Abrir versión y acciones</button>
      </div>` : ''}
    </div>

    <div class="automation-panel automation-text-refresh-panel${textRefreshPending ? ' is-pending' : ''}">
      <div>
        <h3>Actualizar todos los textos del video</h3>
        <p id="autoRefreshTextStatus">${finalOutput
          ? `${textRefreshPending ? 'Hay cambios de texto o diseño pendientes. ' : ''}Regenera títulos, subtítulos y resaltados y reemplaza únicamente ${textRefreshTargetLabel}. No vuelve a generar imágenes, voces, Assets ni planos HeyGen.`
          : 'Esta opción estará disponible después de ensamblar el video final.'}</p>
        ${textRefreshOutput?.textRefreshedAt ? `<span class="automation-stage-status">Última actualización de textos · ${fmtDate(textRefreshOutput.textRefreshedAt)}</span>` : ''}
      </div>
      <button type="button" class="mini-btn accent automation-text-refresh-button" id="autoRefreshAllText"${finalOutput ? '' : ' disabled'}>${IC('refresh')} ${textRefreshPending ? 'Aplicar cambios a todos los textos' : 'Regenerar todos los textos'}</button>
    </div>

    <div class="automation-panel automation-finalize-panel">
      <div>
        <h3>Finalizar proyecto</h3>
        <p>Elimina del disco las regeneraciones y parciales descartados que pertenecen a este proyecto. Conserva los resultados vigentes de cada bloque, audios, capas, planos HeyGen, música y videos finales, además de cualquier material reutilizado en otra sección.</p>
        ${finalization?.finalizedAt ? `<span class="automation-stage-status">Última limpieza · ${finalization.deletedCount || 0} archivo${finalization.deletedCount === 1 ? '' : 's'} · ${formatAutomationBytes(finalization.deletedBytes || 0)} liberados · ${fmtDate(finalization.finalizedAt)}${finalization.failedCount ? ` · ${finalization.failedCount} pendientes` : ''}</span>` : '<span class="hint">Antes de borrar se mostrará la cantidad exacta de archivos y espacio recuperable.</span>'}
      </div>
      <button type="button" class="mini-btn danger automation-finalize-button" id="autoFinalize">${IC('trash')} Finalizar proyecto</button>
    </div>`;

  $('#automationRoot').querySelectorAll('[data-assign]').forEach((sel) => sel.addEventListener('change', async () => {
    const [kind, role] = sel.dataset.assign.split(':');
    const a = { characters: { ...pr.assignments.characters }, locations: { ...pr.assignments.locations }, objects: { ...pr.assignments.objects } };
    if (sel.value) a[kind][role] = sel.value; else delete a[kind][role];
    await saveAutomation({ assignments: a });
    renderAutomationProject();
  }));
  $('#automationRoot').querySelectorAll('[data-generate-resource]').forEach((btn) => btn.addEventListener('click', () => {
    const card = btn.closest('[data-role-card]');
    const [kind, role] = card.dataset.roleCard.split(':');
    generateAutomationResource(pr.id, kind, role, card);
  }));
  $('#autoGenerateAllResources')?.addEventListener('click', () => generateAllAutomationResources(pr.id));
  $('#automationRoot').querySelectorAll('[data-save-role-voice]').forEach((btn) => btn.addEventListener('click', () => {
    const card = btn.closest('[data-role-card]');
    const [, role] = card.dataset.roleCard.split(':');
    assignAutomationCharacterVoice(pr.id, role, card);
  }));
  bindAutomationAssetOpeners($('#automationRoot'));
  bindAutomationHeyGenSegmentActions($('#automationRoot'), pr);

  const newBlockForm = $('#autoNewBlockForm');
  const newBlockKind = $('#autoNewBlockKind');
  const newBlockCharacterField = $('#autoNewBlockCharacterField');
  const syncNewBlockKind = () => {
    const isDialogue = newBlockKind.value === 'dialogue';
    newBlockCharacterField.hidden = !isDialogue;
    $('#autoNewBlockTextLabel').textContent = isDialogue ? 'Diálogo inicial' : 'Narración inicial';
    $('#autoNewBlockText').placeholder = isDialogue ? 'Texto que dirá el personaje…' : 'Texto que se convertirá en audio…';
  };
  $('#autoAddBlock').addEventListener('click', () => {
    newBlockForm.hidden = false;
    $('#autoAddBlock').disabled = true;
    syncNewBlockKind();
    requestAnimationFrame(() => $('#autoNewBlockTitle').focus());
  });
  $('#autoNewBlockCancel').addEventListener('click', () => {
    newBlockForm.reset();
    newBlockForm.hidden = true;
    $('#autoAddBlock').disabled = false;
    syncNewBlockKind();
  });
  newBlockKind.addEventListener('change', syncNewBlockKind);
  newBlockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const imagePrompt = automationPromptFromEditor(pr, $('#autoNewBlockPrompt').value.trim());
    const text = $('#autoNewBlockText').value.trim();
    const kind = newBlockKind.value === 'dialogue' ? 'dialogue' : 'narration';
    const character = kind === 'dialogue' ? $('#autoNewBlockCharacter').value : '';
    if (!imagePrompt) return toast('Escribí el prompt visual del nuevo bloque.', 'err');
    if (!text) return toast('Escribí la narración o diálogo inicial.', 'err');
    if (kind === 'dialogue' && !character) return toast('Elegí el personaje que dirá el diálogo.', 'err');

    const newBlock = {
      id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: $('#autoNewBlockTitle').value.trim() || `Bloque ${pr.blocks.length + 1}`,
      imagePrompt,
      negativePrompt: '',
      items: [{ kind, character, text }],
      characters: character ? [character] : [],
      location: '',
      prop: '',
      sourceReferences: [],
      sourceQuote: '',
      quoteReference: '',
      estimatedDuration: 0,
      generator: 'image',
      heygenCharacterId: '',
      heygenFraming: 'wide',
      assetKeys: [],
      assetMuteOriginal: true
    };
    const position = $('#autoNewBlockPosition').value;
    const blocks = [...pr.blocks];
    if (position === 'start') {
      blocks.unshift(newBlock);
    } else if (position.startsWith('after:')) {
      const targetId = position.slice('after:'.length);
      const targetIndex = blocks.findIndex((block) => block.id === targetId);
      blocks.splice(targetIndex >= 0 ? targetIndex + 1 : blocks.length, 0, newBlock);
    } else {
      blocks.push(newBlock);
    }

    const submitButton = $('#autoNewBlockSave');
    submitButton.disabled = true;
    const updated = await saveAutomation({ blocks });
    if (!updated) {
      submitButton.disabled = false;
      return;
    }
    renderAutomationProject();
    const createdElement = $('#automationRoot').querySelector(`[data-block="${newBlock.id}"]`);
    createdElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`Bloque “${newBlock.title}” añadido al guion.`);
  });
  syncNewBlockKind();

  // El overlay vive en un objeto de trabajo local; los controles y el arrastre lo
  // mutan y actualizan el preview en vivo, y se persiste con saveAll().
  const ov = { ...pr.config.overlay };
  const titleOv = { ...titleOverlay };
  let artStylePromptId = pr.config.artStylePromptId || '';
  let artStyleImageKey = pr.config.artStyleImageKey || '';
  const saveAll = () => saveAutomation({ name: $('#autoProjectName').value, config: {
    imageModelId: $('#autoModel').value,
    fallbackImageModelId: $('#autoFallbackModel').value === $('#autoModel').value ? '' : $('#autoFallbackModel').value,
    artStyle: $('#autoArtStyle').value.trim() || DEFAULT_AUTOMATION_ART_STYLE,
    artStylePromptId,
    artStyleImageKey,
    aspectRatio: $('#autoAr').value,
    resolution: $('#autoRes').value,
    narratorVoiceId: $('#autoVoice').value,
    narratorVoiceName: (state.voices || []).find((v) => v.id === $('#autoVoice').value)?.name || '',
    audioModelId: $('#autoAudioModel').value,
    heygenAuthMode: $('#autoHeyGenAuth').value,
    includeLogos: $('#autoIncludeLogos').checked,
    videoEffect,
    dynamicText,
    transitionSound,
    music,
    overlay: ov,
    titleOverlay: titleOv
  } });
  $('#overlayPresetSelect').addEventListener('change', () => {
    const hasSelection = Boolean($('#overlayPresetSelect').value);
    $('#overlayPresetApply').disabled = !hasSelection;
    $('#overlayPresetDelete').disabled = !hasSelection;
  });
  $('#overlayPresetApply').addEventListener('click', async () => {
    const preset = (state.overlayPresets || []).find((item) => item.id === $('#overlayPresetSelect').value);
    if (!preset) return toast('Elegí un estilo guardado.', 'err');
    Object.assign(ov, preset.overlay || {});
    const titleBehavior = {
      enabled: titleOv.enabled,
      mode: titleOv.mode,
      blockId: titleOv.blockId,
      text: titleOv.text
    };
    Object.assign(titleOv, preset.titleOverlay || {}, titleBehavior);
    Object.assign(dynamicText, preset.dynamicText || {});
    await saveAutomation({ config: { overlay: ov, titleOverlay: titleOv, dynamicText } });
    renderAutomationProject();
    toast(`Estilo “${preset.name}” aplicado.`);
  });
  $('#overlayPresetSave').addEventListener('click', async () => {
    const name = window.prompt('Nombre para este estilo de títulos y textos:');
    if (!name?.trim()) return;
    try {
      const item = await api('/api/overlay-presets', {
        method: 'POST',
        body: { name: name.trim(), overlay: ov, titleOverlay: titleOv, dynamicText }
      });
      state.overlayPresets.unshift(item);
      renderAutomationProject();
      toast(`Estilo “${item.name}” guardado.`);
    } catch (error) { toast(error.message, 'err'); }
  });
  $('#overlayPresetDelete').addEventListener('click', async () => {
    const preset = (state.overlayPresets || []).find((item) => item.id === $('#overlayPresetSelect').value);
    if (!preset || !confirm(`¿Borrar el estilo “${preset.name}”?`)) return;
    try {
      await api(`/api/overlay-presets/${preset.id}`, { method: 'DELETE' });
      state.overlayPresets = state.overlayPresets.filter((item) => item.id !== preset.id);
      renderAutomationProject();
      toast('Estilo eliminado.');
    } catch (error) { toast(error.message, 'err'); }
  });
  $('#autoModel').addEventListener('change', async () => { await saveAll(); renderAutomationProject(); });
  $('#autoAr').addEventListener('change', async () => { await saveAll(); renderAutomationProject(); });
  ['autoRes', 'autoVoice', 'autoAudioModel', 'autoHeyGenAuth', 'autoFallbackModel', 'autoArtStyle'].forEach((id) => $('#' + id).addEventListener('change', async () => {
    await saveAll();
    if (id === 'autoAudioModel') renderAutomationProject();
  }));
  $('#autoIncludeLogos').addEventListener('change', async () => {
    await saveAll();
    renderAutomationProject();
  });
  $('#autoApplyArtPrompt')?.addEventListener('click', async () => {
    const savedPrompt = state.prompts.find((prompt) => prompt.id === $('#autoArtPrompt').value);
    if (!savedPrompt) return toast('Elegí un prompt guardado.', 'err');
    $('#autoArtStyle').value = savedPrompt.text.slice(0, 1200);
    artStylePromptId = savedPrompt.id;
    artStyleImageKey = isStylePrompt(savedPrompt) ? (savedPrompt.styleImageKey || '') : '';
    await saveAll();
    renderAutomationProject();
    toast(savedPrompt.text.length > 1200
      ? `“${savedPrompt.title}” aplicado; se usaron los primeros 1200 caracteres.`
      : `“${savedPrompt.title}” aplicado al estilo artístico global.`);
  });

  const readMusicControls = () => {
    music.enabled = $('#autoMusicEnabled').checked;
    music.source = $('#autoMusicSource').value;
    music.assetKey = $('#autoMusicTrack').value;
    const gainDb = Number($('#autoMusicGain').value);
    music.gainDb = Number.isFinite(gainDb) ? Math.max(-60, Math.min(0, gainDb)) : -15;
    music.fadeOut = $('#autoMusicFadeOut').checked;
    music.fadeOutSeconds = Number($('#autoMusicFadeSeconds').value) || 5;
    music.sunoModel = $('#autoMusicModel').value;
    music.genres = splitMusicTags($('#autoMusicGenres').value);
    music.instruments = splitMusicTags($('#autoMusicInstruments').value);
    music.moods = splitMusicTags($('#autoMusicMoods').value);
    $('#autoMusicPanel').classList.toggle('enabled', music.enabled);
    $('#autoMusicFadeSeconds').disabled = !music.fadeOut;
    return music;
  };
  const readTransitionControls = () => {
    transitionSound.enabled = $('#autoTransitionEnabled').checked;
    transitionSound.soundId = $('#autoTransitionSound').value;
    const selected = (state.transitionSounds || []).find((sound) => sound.id === transitionSound.soundId);
    $('#autoTransitionPanel').classList.toggle('enabled', transitionSound.enabled);
    $('#autoTransitionTest').disabled = !transitionSound.soundId;
    $('#autoTransitionStatus').textContent = selected
      ? `${selected.category} · ${selected.name}`
      : (state.transitionSounds || []).length ? 'Elegí un sonido; se reproducirá automáticamente una vez.' : 'No hay sonidos instalados.';
    return transitionSound;
  };
  const readEffectControls = () => {
    videoEffect.enabled = $('#autoEffectEnabled').checked;
    videoEffect.preset = $('#autoEffectPreset').value;
    const enteredIntensity = Number($('#autoEffectIntensity').value);
    videoEffect.intensity = Number.isFinite(enteredIntensity) ? Math.max(0, Math.min(100, Math.round(enteredIntensity))) : 35;
    videoEffect.maskEnabled = $('#autoEffectMaskEnabled').checked;
    videoEffect.maskColor = $('#autoEffectMaskColor').value;
    const enteredMaskOpacity = Number($('#autoEffectMaskOpacity').value);
    videoEffect.maskOpacity = Number.isFinite(enteredMaskOpacity) ? Math.max(0, Math.min(100, Math.round(enteredMaskOpacity))) : 10;
    $('#autoEffectPanel').classList.toggle('enabled', videoEffect.enabled);
    $('#autoEffectMaskPanel').classList.toggle('enabled', videoEffect.maskEnabled);
    $('#autoEffectIntensityValue').textContent = `${videoEffect.intensity}%`;
    $('#autoEffectMaskOpacityValue').textContent = `${videoEffect.maskOpacity}%`;
    $('#autoEffectMaskColor').disabled = !videoEffect.maskEnabled;
    $('#autoEffectMaskOpacity').disabled = !videoEffect.maskEnabled;
    $('#autoApplyEffect').disabled = !finalOutput || !videoEffect.enabled;
    return videoEffect;
  };
  const readDynamicTextControls = () => {
    dynamicText.enabled = $('#autoDynamicTextEnabled').checked;
    dynamicText.titleAnimation = $('#autoTitleAnimation').value;
    dynamicText.captionAnimation = $('#autoCaptionAnimation').value;
    const wordsPerPage = Number($('#autoWordsPerPage').value);
    dynamicText.wordsPerPage = Number.isFinite(wordsPerPage) ? Math.max(1, Math.min(12, Math.round(wordsPerPage))) : 5;
    $('#autoWordsPerPage').value = dynamicText.wordsPerPage;
    $('#autoDynamicTextPanel').classList.toggle('enabled', dynamicText.enabled);
    return dynamicText;
  };
  ['autoDynamicTextEnabled', 'autoTitleAnimation', 'autoCaptionAnimation', 'autoWordsPerPage'].forEach((id) => {
    $('#' + id).addEventListener('change', async () => {
      readDynamicTextControls();
      await saveAll();
      renderAutomationProject();
    });
  });
  $('#autoEffectEnabled').addEventListener('change', async () => {
    readEffectControls();
    await saveAll();
  });
  $('#autoEffectPreset').addEventListener('change', async () => {
    readEffectControls();
    await saveAll();
  });
  $('#autoEffectIntensity').addEventListener('input', readEffectControls);
  $('#autoEffectIntensity').addEventListener('change', async () => {
    readEffectControls();
    await saveAll();
  });
  $('#autoEffectMaskEnabled').addEventListener('change', async () => {
    readEffectControls();
    await saveAll();
  });
  $('#autoEffectMaskColor').addEventListener('input', readEffectControls);
  $('#autoEffectMaskColor').addEventListener('change', async () => {
    readEffectControls();
    await saveAll();
  });
  $('#autoEffectMaskOpacity').addEventListener('input', readEffectControls);
  $('#autoEffectMaskOpacity').addEventListener('change', async () => {
    readEffectControls();
    await saveAll();
  });
  $('#autoTransitionEnabled').addEventListener('change', async () => {
    if ($('#autoTransitionEnabled').checked && !$('#autoTransitionSound').value && (state.transitionSounds || []).length) {
      $('#autoTransitionSound').value = state.transitionSounds[0].id;
      previewAutomationTransitionSound(state.transitionSounds[0].id);
    }
    readTransitionControls();
    await saveAll();
  });
  $('#autoTransitionSound').addEventListener('change', async () => {
    const soundId = $('#autoTransitionSound').value;
    if (soundId) $('#autoTransitionEnabled').checked = true;
    readTransitionControls();
    previewAutomationTransitionSound(soundId);
    await saveAll();
  });
  $('#autoTransitionTest').addEventListener('click', () => previewAutomationTransitionSound($('#autoTransitionSound').value));
  ['autoMusicEnabled', 'autoMusicSource', 'autoMusicGain', 'autoMusicModel', 'autoMusicFadeOut', 'autoMusicFadeSeconds', 'autoMusicGenres', 'autoMusicInstruments', 'autoMusicMoods']
    .forEach((id) => $('#' + id).addEventListener('change', () => { readMusicControls(); saveAll(); }));
  const musicPreview = $('#autoMusicPreview');
  const voicePreview = $('#autoMusicVoicePreview');
  const musicTestButton = $('#autoMusicTest');
  const applyPreviewGain = () => {
    if (!musicPreview) return;
    const enteredDb = Number($('#autoMusicGain').value);
    const db = Number.isFinite(enteredDb) ? Math.max(-60, Math.min(0, enteredDb)) : -15;
    musicPreview.volume = Math.max(0, Math.min(1, 10 ** (db / 20)));
    const hint = $('#autoMusicPanel .automation-music-test-hint');
    if (hint) hint.textContent = `La reproducción respeta ${db.toFixed(1)} dB${voicePreview ? ' y puede compararse con una voz ya generada del proyecto.' : '. Generá al menos una voz para probar el balance conjunto.'}`;
  };
  applyPreviewGain();
  $('#autoMusicGain').addEventListener('input', applyPreviewGain);
  musicTestButton?.addEventListener('click', async () => {
    if (!musicPreview) return;
    const status = $('#autoMusicStatus');
    const isTesting = voicePreview ? !voicePreview.paused : !musicPreview.paused;
    if (isTesting) {
      musicPreview.pause();
      if (voicePreview) voicePreview.pause();
      musicPreview.loop = false;
      musicTestButton.innerHTML = `${IC('play')} ${voicePreview ? 'Probar con voz' : 'Probar música'}`;
      status.textContent = 'Prueba detenida.';
      return;
    }
    try {
      applyPreviewGain();
      musicPreview.currentTime = 0;
      musicPreview.loop = Boolean(voicePreview);
      if (voicePreview) {
        voicePreview.currentTime = 0;
        voicePreview.volume = 1;
        await Promise.all([musicPreview.play(), voicePreview.play()]);
        status.textContent = `Probando voz con música a ${Number($('#autoMusicGain').value).toFixed(1)} dB…`;
      } else {
        await musicPreview.play();
        status.textContent = `Reproduciendo música a ${Number($('#autoMusicGain').value).toFixed(1)} dB…`;
      }
      musicTestButton.textContent = 'Detener prueba';
    } catch (error) {
      musicPreview.pause();
      if (voicePreview) voicePreview.pause();
      status.textContent = `No se pudo reproducir la prueba: ${error.message}`;
    }
  });
  voicePreview?.addEventListener('ended', () => {
    musicPreview.pause();
    musicPreview.loop = false;
    musicTestButton.innerHTML = `${IC('play')} Probar con voz`;
    $('#autoMusicStatus').textContent = 'Prueba de balance terminada.';
  });
  $('#autoMusicTrack').addEventListener('change', async () => {
    readMusicControls();
    if (music.assetKey) {
      music.enabled = true;
      music.source = 'asset';
    }
    await saveAll();
    renderAutomationProject();
  });
  $('#autoMusicAuto').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const status = $('#autoMusicStatus');
    readMusicControls();
    music.enabled = true;
    music.source = 'auto';
    button.disabled = true;
    status.textContent = 'Buscando la música con mayor coincidencia…';
    try {
      const result = await api(`/api/automations/${pr.id}/music/auto-select`, { method: 'POST', body: music });
      state.automations[state.automations.findIndex((item) => item.id === pr.id)] = result.project;
      renderAutomationProject();
      toast(result.selected.score > 0
        ? `Música elegida automáticamente (${result.selected.score} puntos de coincidencia).`
        : 'Música elegida automáticamente; no había coincidencias exactas y se usó la más reciente.', 'ok');
    } catch (error) {
      button.disabled = false;
      status.textContent = error.message;
      toast(error.message, 'err');
    }
  });
  $('#autoMusicGenerate').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const status = $('#autoMusicStatus');
    readMusicControls();
    music.enabled = true;
    music.source = 'suno';
    if (!confirm('Suno generará dos variantes y consumirá créditos. La primera quedará asignada al proyecto y ambas se guardarán en Assets. ¿Continuar?')) return;
    button.disabled = true;
    status.textContent = 'Suno está componiendo la música; esto puede tardar varios minutos…';
    try {
      const result = await api(`/api/automations/${pr.id}/music/generate`, { method: 'POST', body: music });
      state.automations[state.automations.findIndex((item) => item.id === pr.id)] = result.project;
      await refreshAssets();
      renderAutomationProject();
      toast('Suno generó dos variantes; la primera quedó asignada al proyecto.', 'ok');
    } catch (error) {
      button.disabled = false;
      status.textContent = error.message;
      toast(error.message, 'err');
    }
  });
  $('#autoMusicUpload').addEventListener('click', () => {
    readMusicControls();
    openAudioUpload({ automationId: pr.id, kind: 'music', musicTags: music });
  });

  // --- visualizador del texto sobreimpreso ---
  const preview = $('#ovPreview'), text = $('#ovText'), titleText = $('#ovTitle');
  const styleText = () => {
    const previewBlock = pr.blocks.find((block) => block.id === titleOv.blockId) || pr.blocks[0];
    const visibleTitle = titleOv.mode === 'block'
      ? (previewBlock?.title || '')
      : (titleOv.text || pr.integration?.scriptTitle || pr.name);
    applySubtitlePreviewStyles({ preview, text, titleText, overlay: ov, titleOverlay: titleOv, visibleTitle });
    $('#autoTitlePanel')?.classList.toggle('enabled', !!titleOv.enabled);
    $('#autoTitleText').disabled = titleOv.mode === 'block';
    $('#autoTitleTextField')?.classList.toggle('is-unused', titleOv.mode === 'block');
    $('#autoTitleBlockLabel').textContent = titleOv.mode === 'block' ? 'Bloque para la previsualización' : 'Mostrar el título general en';
  };
  const bindOv = (id, prop, transform = (v) => v) => {
    const el = $('#' + id);
    el.addEventListener('input', () => { ov[prop] = transform(el.type === 'checkbox' ? el.checked : el.value); styleText(); });
    el.addEventListener('change', saveAll);
  };
  bindOv('ovFont', 'font'); bindOv('ovSize', 'fontSizePx', Number); bindOv('ovWeight', 'fontWeight', Number); bindOv('ovColor', 'color');
  bindOv('ovTransform', 'textTransform'); bindOv('ovItalic', 'fontItalic'); bindOv('ovUnderline', 'fontUnderline'); bindOv('ovStrike', 'fontStrikeThrough');
  bindOv('ovStroke', 'strokeColor'); bindOv('ovStrokeW', 'strokeWidthPx', Number);
  bindOv('ovHlFont', 'highlightFont'); bindOv('ovHlSize', 'highlightFontSizePx', Number); bindOv('ovHlWeight', 'highlightFontWeight', Number);
  bindOv('ovHlTransform', 'highlightTextTransform'); bindOv('ovHlItalic', 'highlightFontItalic'); bindOv('ovHlUnderline', 'highlightFontUnderline'); bindOv('ovHlStrike', 'highlightFontStrikeThrough');
  bindOv('ovHl', 'highlightColor'); bindOv('ovHlStroke', 'highlightStrokeColor'); bindOv('ovHlStrokeW', 'highlightStrokeWidthPx', Number);
  bindOv('ovAlign', 'align'); bindOv('ovMaxWidth', 'maxWidthPct', Number); bindOv('ovBg', 'bg');
  const bindTitle = (id, prop, transform = (value) => value) => {
    const el = $('#' + id);
    el.addEventListener('input', () => {
      titleOv[prop] = transform(el.type === 'checkbox' ? el.checked : el.value);
      styleText();
    });
    el.addEventListener('change', saveAll);
  };
  bindTitle('autoTitleEnabled', 'enabled'); bindTitle('autoTitleMode', 'mode'); bindTitle('autoTitleBlock', 'blockId'); bindTitle('autoTitleText', 'text');
  bindTitle('titleFont', 'font'); bindTitle('titleSize', 'fontSizePx', Number); bindTitle('titleWeight', 'fontWeight', Number);
  bindTitle('titleTransform', 'textTransform'); bindTitle('titleItalic', 'fontItalic'); bindTitle('titleUnderline', 'fontUnderline'); bindTitle('titleStrike', 'fontStrikeThrough');
  bindTitle('titleColor', 'color'); bindTitle('titleStroke', 'strokeColor'); bindTitle('titleStrokeW', 'strokeWidthPx', Number);
  bindTitle('titleAlign', 'align'); bindTitle('titleMaxWidth', 'maxWidthPct', Number); bindTitle('titleBg', 'bg');
  $('#ovPos').addEventListener('change', () => {
    ov.position = $('#ovPos').value;
    ov.y = ov.position === 'top' ? 12 : ov.position === 'center' ? 50 : 88;
    ov.x = 50;
    styleText(); saveAll();
  });
  $('#ovCenterX').addEventListener('click', () => {
    ov.x = 50;
    styleText();
    saveAll();
  });
  $('#titlePos').addEventListener('change', () => {
    titleOv.position = $('#titlePos').value;
    titleOv.y = titleOv.position === 'top' ? 14 : titleOv.position === 'center' ? 50 : 86;
    titleOv.x = 50;
    styleText(); saveAll();
  });
  $('#titleCenterX').addEventListener('click', () => {
    titleOv.x = 50;
    styleText(); saveAll();
  });

  let fontImportTarget = 'font';
  $('#automationRoot').querySelectorAll('[data-import-font]').forEach((button) => {
    button.addEventListener('click', async () => {
      fontImportTarget = ['highlightFont', 'titleFont'].includes(button.dataset.importFont) ? button.dataset.importFont : 'font';
      await saveAll();
      $('#ovFontFile').value = '';
      $('#ovFontFile').click();
    });
  });
  $('#ovFontFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const font = await api('/api/fonts', {
        method: 'POST',
        body: { fileName: file.name, name: file.name.replace(/\.[^.]+$/, ''), dataUrl }
      });
      state.fonts.unshift(font);
      await registerCustomFont(font);
      if (fontImportTarget === 'titleFont') titleOv.font = font.family;
      else ov[fontImportTarget] = font.family;
      await saveAutomation({ config: { overlay: ov, titleOverlay: titleOv } });
      renderAutomationProject();
      toast(`Fuente “${font.name}” importada y guardada.`);
    } catch (error) {
      toast(error.message, 'err');
    }
  });

  // arrastrar el texto para ubicarlo libremente (setea x/y en %)
  let dragging = false;
  text.addEventListener('pointerdown', (e) => { dragging = true; text.setPointerCapture(e.pointerId); text.classList.add('dragging'); e.preventDefault(); });
  text.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = preview.getBoundingClientRect();
    ov.x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    ov.y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    styleText();
  });
  const endDrag = () => { if (!dragging) return; dragging = false; text.classList.remove('dragging'); saveAll(); };
  text.addEventListener('pointerup', endDrag);
  text.addEventListener('pointercancel', endDrag);
  let titleDragging = false;
  titleText.addEventListener('pointerdown', (event) => {
    if (!titleOv.enabled) return;
    titleDragging = true;
    titleText.setPointerCapture(event.pointerId);
    titleText.classList.add('dragging');
    event.preventDefault();
  });
  titleText.addEventListener('pointermove', (event) => {
    if (!titleDragging) return;
    const rect = preview.getBoundingClientRect();
    titleOv.x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    titleOv.y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    styleText();
  });
  const endTitleDrag = () => {
    if (!titleDragging) return;
    titleDragging = false;
    titleText.classList.remove('dragging');
    saveAll();
  };
  titleText.addEventListener('pointerup', endTitleDrag);
  titleText.addEventListener('pointercancel', endTitleDrag);
  requestAnimationFrame(styleText);
  if (window.ResizeObserver) new ResizeObserver(styleText).observe(preview);

  // fondo de referencia (solo para previsualizar; no se usa al generar)
  $('#ovPickBg').addEventListener('click', () => { state.overlayBgPick = true; openPicker(); $('#pickerTitle').textContent = 'Elegir fondo de referencia'; });
  $('#ovClearBg')?.addEventListener('click', () => { ov.previewBg = ''; saveAll().then(() => renderAutomationProject()); });

  $('#automationRoot').querySelectorAll('[data-block-generator]').forEach((select) => {
    const blockElement = select.closest('.auto-block');
    const settings = blockElement.querySelector('[data-block-heygen-settings]');
    const assetSettings = blockElement.querySelector('[data-block-assets-settings]');
    const h3Settings = blockElement.querySelector('[data-block-h3-settings]');
    const seedance25Settings = blockElement.querySelector('[data-block-seedance25-settings]');
    const omniSettings = blockElement.querySelector('[data-block-omni-settings]');
    const characterSelect = blockElement.querySelector('[data-block-heygen-character]');
    const framingSelect = blockElement.querySelector('[data-block-heygen-framing]');
    const hint = blockElement.querySelector('[data-block-heygen-hint]');
    const sync = () => {
      settings.hidden = select.value !== 'heygen';
      assetSettings.hidden = select.value !== 'assets';
      h3Settings.hidden = select.value !== 'h3';
      seedance25Settings.hidden = select.value !== 'seedance25';
      omniSettings.hidden = select.value !== 'omni';
      blockElement.querySelectorAll('[data-block-prompt-field]').forEach((field) => { field.hidden = select.value === 'assets'; });
      const character = state.characters.find((item) => item.id === characterSelect?.value);
      if (hint) hint.textContent = character?.heygen?.closeAvatarId
        ? 'La alternancia corta el texto cerca del punto medio y une ambos videos.'
        : 'Este personaje solo tiene código de plano general.';
      if (character && !character.heygen?.closeAvatarId && ['close', 'split'].includes(framingSelect?.value)) framingSelect.value = 'wide';
    };
    select.addEventListener('change', sync);
    characterSelect?.addEventListener('change', sync);
    sync();
  });

  $('#automationRoot').querySelectorAll('[data-pick-block-assets]').forEach((button) => button.addEventListener('click', () => {
    const blockElement = button.closest('.auto-block');
    const block = pr.blocks.find((item) => item.id === blockElement?.dataset.block);
    if (blockElement && block) openAutomationAssetsPicker(blockElement, block);
  }));
  $('#automationRoot').querySelectorAll('[data-pick-block-h3]').forEach((button) => button.addEventListener('click', () => {
    const blockElement = button.closest('.auto-block');
    const block = pr.blocks.find((item) => item.id === blockElement?.dataset.block);
    if (blockElement && block) openGenerativeVideoBlockAssetsPicker(blockElement, block, 'minimax-h3');
  }));
  $('#automationRoot').querySelectorAll('[data-pick-block-seedance25]').forEach((button) => button.addEventListener('click', () => {
    const blockElement = button.closest('.auto-block');
    const block = pr.blocks.find((item) => item.id === blockElement?.dataset.block);
    if (blockElement && block) openGenerativeVideoBlockAssetsPicker(blockElement, block, 'seedance-2-5');
  }));
  $('#automationRoot').querySelectorAll('[data-pick-block-omni]').forEach((button) => button.addEventListener('click', () => {
    const blockElement = button.closest('.auto-block');
    const block = pr.blocks.find((item) => item.id === blockElement?.dataset.block);
    if (blockElement && block) openGenerativeVideoBlockAssetsPicker(blockElement, block, 'gemini-omni-1-1-flash');
  }));

  $('#automationRoot').querySelectorAll('[data-save-block]').forEach((button) => button.addEventListener('click', async () => {
    const blockElement = button.closest('.auto-block');
    const blockId = button.dataset.saveBlock;
    const currentBlock = pr.blocks.find((block) => block.id === blockId);
    if (!blockElement || !currentBlock) return;
    const imagePrompt = automationPromptFromEditor(pr, blockElement.querySelector('[data-block-prompt]').value.trim());
    const negativePrompt = blockElement.querySelector('[data-block-negative]').value.trim();
    const title = blockElement.querySelector('[data-block-title]').value.trim() || currentBlock.title || 'Bloque';
    const selectedGenerator = blockElement.querySelector('[data-block-generator]').value;
    const generator = ['image', 'heygen', 'assets', 'h3', 'seedance25', 'omni'].includes(selectedGenerator) ? selectedGenerator : 'image';
    const heygenCharacterId = generator === 'heygen' ? (blockElement.querySelector('[data-block-heygen-character]').value || '') : '';
    const heygenFraming = generator === 'heygen' ? blockElement.querySelector('[data-block-heygen-framing]').value : 'wide';
    const heygenCharacter = state.characters.find((character) => character.id === heygenCharacterId);
    const assetSettings = blockElement.querySelector('[data-block-assets-settings]');
    let assetKeys = [];
    try { assetKeys = JSON.parse(assetSettings?.dataset.assetKeys || '[]'); } catch { assetKeys = []; }
    const assetMuteOriginal = assetSettings?.querySelector('[data-block-assets-mute]')?.checked !== false;
    const h3Settings = blockElement.querySelector('[data-block-h3-settings]');
    let h3ReferenceKeys = [];
    try { h3ReferenceKeys = JSON.parse(h3Settings?.dataset.h3ReferenceKeys || '[]'); } catch { h3ReferenceKeys = []; }
    const h3Mode = h3Settings?.querySelector('[data-block-h3-mode]')?.value === 'frames' ? 'frames' : 'reference';
    const h3Resolution = h3Settings?.querySelector('[data-block-h3-resolution]')?.value === '2K' ? '2K' : '768P';
    const h3ContextIr = h3Settings?.querySelector('[data-block-h3-context]')?.checked === true;
    const h3UseNarrationReference = h3Settings?.querySelector('[data-block-h3-narration]')?.checked !== false;
    const h3KeepGeneratedAudio = h3Settings?.querySelector('[data-block-h3-native-audio]')?.checked === true;
    const seedance25Settings = blockElement.querySelector('[data-block-seedance25-settings]');
    let seedance25ReferenceKeys = [];
    try { seedance25ReferenceKeys = JSON.parse(seedance25Settings?.dataset.seedance25ReferenceKeys || '[]'); } catch { seedance25ReferenceKeys = []; }
    const seedance25Mode = seedance25Settings?.querySelector('[data-block-seedance25-mode]')?.value === 'frames' ? 'frames' : 'reference';
    const seedance25Resolution = seedance25Settings?.querySelector('[data-block-seedance25-resolution]')?.value === '480p' ? '480p' : '720p';
    const seedance25UseNarrationReference = seedance25Settings?.querySelector('[data-block-seedance25-narration]')?.checked !== false;
    const seedance25KeepGeneratedAudio = seedance25Settings?.querySelector('[data-block-seedance25-native-audio]')?.checked === true;
    const omniSettings = blockElement.querySelector('[data-block-omni-settings]');
    let omniReferenceKeys = [];
    try { omniReferenceKeys = JSON.parse(omniSettings?.dataset.omniReferenceKeys || '[]'); } catch { omniReferenceKeys = []; }
    const omniMode = omniSettings?.querySelector('[data-block-omni-mode]')?.value === 'frames' ? 'frames' : 'reference';
    const omniResolutionValue = omniSettings?.querySelector('[data-block-omni-resolution]')?.value;
    const omniResolution = ['360p', '720p', '1080p', '4K'].includes(omniResolutionValue) ? omniResolutionValue : '720p';
    const items = currentBlock.items.map((item, index) => ({
      ...item,
      text: blockElement.querySelector(`[data-block-item="${index}"]`)?.value.trim() || ''
    })).filter((item) => item.text);
    if (generator !== 'assets' && !imagePrompt) return toast('El bloque debe conservar un prompt visual.', 'err');
    if (!items.length) return toast('El bloque debe conservar al menos un texto de narración o diálogo.', 'err');
    if (generator === 'heygen' && !heygenCharacterReady(heygenCharacter)) return toast('Elegí un personaje con variante HeyGen completa.', 'err');
    if (generator === 'heygen' && ['close', 'split'].includes(heygenFraming) && !heygenCharacter.heygen?.closeAvatarId) return toast('Ese personaje no tiene código de primer plano.', 'err');
    if (generator === 'assets' && !assetKeys.length) return toast('Elegí al menos una imagen o video para este bloque.', 'err');
    if (generator === 'h3' && h3Mode === 'frames') {
      const frameItems = h3ReferenceKeys.map(automationVisualAsset);
      if (frameItems.length !== 2 || frameItems.some((item) => ['video', 'audio'].includes(item.zone))) {
        return toast('Inicio → Fin de H3 necesita exactamente dos imágenes, en orden: entrada y salida.', 'err');
      }
    }
    if (generator === 'seedance25' && seedance25Mode === 'frames') {
      if (seedance25ReferenceKeys.length !== 2 || seedance25ReferenceKeys.some((key) => /^(video|audio)\//.test(key))) {
        return toast('Inicio → Fin de Seedance 2.5 necesita exactamente dos imágenes.', 'err');
      }
    }
    if (generator === 'omni' && omniMode === 'frames') {
      if (omniReferenceKeys.length !== 2 || omniReferenceKeys.some((key) => /^(video|audio)\//.test(key))) {
        return toast('Inicio → Fin de Gemini Omni necesita exactamente dos imágenes.', 'err');
      }
    }
    if (generator === 'omni' && omniReferenceKeys.some((key) => /^audio\//.test(key))) {
      return toast('Gemini Omni todavía no admite audio subido como referencia.', 'err');
    }
    button.disabled = true;
    const updated = await saveAutomation({
      blocks: pr.blocks.map((block) => block.id === blockId
        ? { ...block, title, imagePrompt, negativePrompt, items, generator, heygenCharacterId, heygenFraming, assetKeys, assetMuteOriginal,
          h3Mode, h3Resolution, h3ContextIr, h3UseNarrationReference, h3KeepGeneratedAudio, h3ReferenceKeys,
          seedance25Mode, seedance25Resolution, seedance25UseNarrationReference, seedance25KeepGeneratedAudio, seedance25ReferenceKeys,
          omniMode, omniResolution, omniReferenceKeys }
        : block)
    });
    if (updated) {
      renderAutomationProject();
      toast(`Cambios guardados en “${title}”. Las imágenes o audios válidos se reutilizarán.`);
    } else {
      button.disabled = false;
    }
  }));

  $('#automationRoot').querySelectorAll('[data-genblock]').forEach((btn) => btn.addEventListener('click', async () => {
    const block = pr.blocks.find((b) => b.id === btn.dataset.genblock);
    const force = btn.dataset.force === '1';
    const newMaterials = block?.generator === 'heygen'
      ? 'audios y videos HeyGen nuevos'
      : block?.generator === 'h3' ? 'audios y videos MiniMax H3 nuevos'
      : block?.generator === 'seedance25' ? 'audios y videos Seedance 2.5 nuevos'
      : block?.generator === 'omni' ? 'audios y videos Gemini Omni nuevos'
      : block?.generator === 'assets' ? 'audios nuevos y un montaje local de los Assets elegidos' : 'una imagen y audios nuevos';
    if (force && !confirm(`¿Regenerar “${block?.title || 'este bloque'}” desde cero? Se crearán ${newMaterials}.`)) return;
    if (block) await runAutomationBlock(pr.id, block, btn.closest('.auto-block'), { regenerate: force });
  }));
  $('#automationRoot').querySelectorAll('[data-regen-downstream]').forEach((button) => button.addEventListener('click', async () => {
    const block = pr.blocks.find((item) => item.id === button.dataset.regenDownstream);
    const output = block && pr.outputs?.[block.id];
    if (!block || (block.generator !== 'assets' && !output?.imageKey)) return toast('Este bloque todavía no tiene visuales limpios para reutilizar.', 'err');
    if (block.generator === 'assets' && !(block.assetKeys || []).length) return toast('Este bloque ya no tiene Assets seleccionados.', 'err');
    const existingAudioKeys = Array.isArray(output.audioKeys) ? output.audioKeys.slice(0, block.items.length) : [];
    if (existingAudioKeys.length !== block.items.length) return toast('Este bloque no tiene todos sus audios guardados para reensamblar.', 'err');
    const visualDescription = block.generator === 'assets' ? `los ${(block.assetKeys || []).length} Assets seleccionados`
      : ['h3', 'seedance25', 'omni'].includes(block.generator)
        ? `los ${(output.h3SegmentVideoKeys || []).length} tramos ${block.generator === 'seedance25' ? 'Seedance 2.5' : block.generator === 'omni' ? 'Gemini Omni' : 'H3'} y la imagen base`
        : 'la imagen limpia';
    if (!confirm(`¿Rehacer el texto y el video de “${block.title || 'este bloque'}”? Se conservarán exactamente ${visualDescription} y los ${existingAudioKeys.length} audio${existingAudioKeys.length === 1 ? '' : 's'} existentes; no se llamará a ElevenLabs.`)) return;
    const preservedOutput = {
      ...(block.generator === 'assets' ? {
        generator: 'assets', assetKeys: [...block.assetKeys], assetMuteOriginal: block.assetMuteOriginal !== false
      } : ['h3', 'seedance25', 'omni'].includes(block.generator) ? {
        generator: block.generator, imageKey: output.imageKey,
        imageModelId: output.imageModelId || '', imageModelName: output.imageModelName || '',
        h3SegmentVideoKeys: [...(output.h3SegmentVideoKeys || [])],
        h3SegmentDurations: [...(output.h3SegmentDurations || [])],
        h3Resolution: output.h3Resolution || (block.generator === 'seedance25' ? block.seedance25Resolution : block.generator === 'omni' ? block.omniResolution : block.h3Resolution) || (block.generator === 'h3' ? '768P' : '720p')
      } : {
        imageKey: output.imageKey,
        imageModelId: output.imageModelId || '',
        imageModelName: output.imageModelName || '',
        fallbackUsed: output.fallbackUsed === true,
        recoveredImage: output.recoveredImage === true
      }),
      audioKeys: existingAudioKeys,
      audioCountExpected: block.items.length
    };
    try {
      button.disabled = true;
      await persistAutomationBlockOutput(pr.id, block.id, preservedOutput, { replace: true });
      await runAutomationBlock(pr.id, block, button.closest('.auto-block'), { requireExistingAudio: true });
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'err');
    }
  }));
  $('#automationRoot').querySelectorAll('[data-regenblock]').forEach((btn) => btn.addEventListener('click', async () => {
    const block = pr.blocks.find((b) => b.id === btn.dataset.regenblock);
    const materials = block?.generator === 'heygen'
      ? 'audios y videos HeyGen'
      : block?.generator === 'seedance25'
        ? 'audios y videos Seedance 2.5'
      : block?.generator === 'h3'
          ? 'audios y videos MiniMax H3'
          : block?.generator === 'omni'
            ? 'audios y videos Gemini Omni'
          : block?.generator === 'assets' ? 'audios y montaje local' : 'imagen y audios';
    if (!block || !confirm(`¿Descartar los parciales de “${block.title || 'este bloque'}” y regenerar ${materials}?`)) return;
    await runAutomationBlock(pr.id, block, btn.closest('.auto-block'), { regenerate: true });
  }));
  $('#autoStart').addEventListener('click', () => runAutomationAll(pr.id, $('#autoMode').value));
  $('#autoAssemble')?.addEventListener('click', () => assembleAutomationProject(pr.id));
  $('#autoApplyEffect')?.addEventListener('click', async () => {
    readEffectControls();
    const saved = await saveAll();
    if (saved) applyAutomationVideoEffect(pr.id, videoEffect);
  });
  $('#autoRefreshAllText')?.addEventListener('click', async () => {
    const saved = await saveAll();
    if (saved) refreshAutomationProjectText(pr.id);
  });
  $('#autoFinalize')?.addEventListener('click', () => finalizeAutomationProject(pr.id));
  if (state.voices === null) loadVoices(false).then(() => { if (currentAutomation()) renderAutomationProject(); });
}

// ---------------------------------------------------------------------------
// Automatizador · pipeline por bloque: imagen (con fichas) → texto quemado por
// canvas (WYSIWYG con el visualizador) → audio (narrador/personaje con tags de
// emoción que yo genero) → mp4 con ffmpeg. Todo se guarda categorizado.
// ---------------------------------------------------------------------------

// palabras dramáticas que reciben el estilo highlight en el texto sobreimpreso.
const DRAMATIC_WORDS = /^(nunca|jamás|jamas|siempre|todo|nada|nadie|muerte|morir|matar|sangre|traición|traicion|mentira|mentís|mentira|verdad|secreto|amor|odio|miedo|terror|adiós|adios|basta|ahora|nunca más|peligro|final|fin|último|ultimo|solo|sola|imposible|destruir|guerra|víctima|victima|culpa|perdón|perdon)$/i;

// elige los índices de palabras a resaltar: las del léxico dramático y las que
// están en MAYÚSCULAS o cerradas con signo de exclamación.
function pickHighlightWords(text) {
  const words = text.split(/\s+/);
  const idx = new Set();
  words.forEach((w, i) => {
    const clean = w.replace(/[^\p{L}]/gu, '');
    if (!clean) return;
    if (DRAMATIC_WORDS.test(clean)) idx.add(i);
    else if (clean.length > 2 && clean === clean.toUpperCase() && /\p{Lu}/u.test(clean)) idx.add(i);
    else if (/[!¡]/.test(w)) idx.add(i);
  });
  return idx;
}

function transformOverlayWord(word, transform = 'none') {
  if (transform === 'uppercase') return word.toLocaleUpperCase('es');
  if (transform === 'lowercase') return word.toLocaleLowerCase('es');
  if (transform === 'capitalize') {
    return word.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('es'));
  }
  return word;
}

// tags de emoción de ElevenLabs (invisibles en la imagen; sólo van al audio),
// elegidos por heurística simple sobre el texto para darle dinamismo.
function emotionTagFor(text) {
  const t = text.trim();
  if (/[!¡]/.test(t) && t === t.toUpperCase()) return '[shouting]';
  if (/[!¡]/.test(t)) return '[excited]';
  if (/\?/.test(t)) return '[curious]';
  if (/\.\.\.$|…$/.test(t)) return '[sighs]';
  if (/(triste|llor|adiós|adios|perdón|perdon|muerte)/i.test(t)) return '[sad]';
  if (/(nunca|jamás|jamas|odio|basta|traición|traicion)/i.test(t)) return '[angry]';
  return '';
}

function fichaKeyForEntity(entity) {
  if (!entity) return null;
  return entity.sheet || (entity.photos && entity.photos[0]) || null;
}

// Resuelve refs y mantiene una correspondencia literal entre la etiqueta
// estampada y su mención: @ROL se convierte en @Nombre, nunca en una palabra
// suelta sin @.
async function automationRefsAndPrompt(pr, block) {
  // La referencia de estilo va primero para que se conserve aun si el modelo
  // limita la cantidad total de imagenes adjuntas.
  const refItems = automationStyleRefItems(pr);
  const addChar = (role) => {
    const c = automationAssignedEntity(pr, 'characters', role);
    const key = fichaKeyForEntity(c);
    if (key) refItems.push({ key, label: c?.name || role });
  };
  const addEl = (kind, role) => {
    if (!role) return;
    const e = automationAssignedEntity(pr, kind, role);
    const key = fichaKeyForEntity(e);
    if (key) refItems.push({ key, label: e?.name || role });
  };
  block.characters.forEach(addChar);
  addEl('locations', block.location);
  addEl('objects', block.prop);
  // dedup por key conservando el primer label
  const seen = new Set();
  const refs = refItems.filter((r) => !seen.has(r.key) && seen.add(r.key));
  const labeledRefs = await buildLabeledRefs(refs);
  let prompt = automationPromptForEditor(pr, block.imagePrompt);
  if (block.negativePrompt) prompt += `\n\nAvoid in the generated image: ${block.negativePrompt}`;
  return { refs: refs.map((r) => r.key), labeledRefs, prompt: automationStyledPrompt(pr, prompt) };
}

function automationTitleForBlock(pr, block) {
  const title = { ...DEFAULT_AUTOMATION_TITLE_OVERLAY, ...(pr.config?.titleOverlay || {}) };
  if (!title.enabled) return null;
  if (title.mode === 'block') {
    const text = String(block.title || '').trim();
    return text ? { ...title, text } : null;
  }
  if (title.blockId !== block.id || !String(title.text || '').trim()) return null;
  return title;
}

function drawAutomationTitle(ctx, width, height, titleText, title) {
  const scale = height / 1080;
  const fontPx = Math.max(4, (title.fontSizePx || 96) * scale);
  const fontFamily = canvasFontFamily(title.font || 'sans-serif');
  const transformed = String(titleText || '').split(/\s+/).filter(Boolean)
    .map((word) => transformOverlayWord(word, title.textTransform || 'none'));
  if (!transformed.length) return;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.font = `${title.fontItalic ? 'italic ' : ''}${title.fontWeight || 900} ${fontPx}px ${fontFamily}`;
  const maxWidth = width * ((title.maxWidthPct || 88) / 100);
  const lines = [];
  let line = '';
  for (const word of transformed) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  const lineHeight = fontPx * 1.15;
  const blockHeight = lines.length * lineHeight;
  const anchorX = width * ((title.x ?? 50) / 100);
  const anchorY = height * ((title.y ?? 14) / 100);
  const align = ['left', 'right'].includes(title.align) ? title.align : 'center';
  const layouts = lines.map((text, index) => {
    const lineWidth = ctx.measureText(text).width;
    return {
      text,
      width: lineWidth,
      x: align === 'left' ? anchorX : align === 'right' ? anchorX - lineWidth : anchorX - lineWidth / 2,
      y: anchorY - blockHeight / 2 + lineHeight * (index + 0.5)
    };
  });
  if (title.bg && layouts.length) {
    const padding = fontPx * 0.4;
    const minX = Math.min(...layouts.map((item) => item.x));
    const maxX = Math.max(...layouts.map((item) => item.x + item.width));
    ctx.globalAlpha = title.bgOpacity ?? 0.45;
    ctx.fillStyle = title.bgColor || '#000000';
    ctx.fillRect(minX - padding, anchorY - blockHeight / 2 - padding, maxX - minX + padding * 2, blockHeight + padding * 2);
    ctx.globalAlpha = 1;
  }
  for (const layout of layouts) {
    const strokeWidth = Math.max(0, (title.strokeWidthPx || 0) * scale);
    if (strokeWidth > 0) {
      ctx.lineWidth = strokeWidth * 2;
      ctx.strokeStyle = title.strokeColor || '#000000';
      ctx.strokeText(layout.text, layout.x, layout.y);
    }
    ctx.fillStyle = title.color || '#ffffff';
    ctx.fillText(layout.text, layout.x, layout.y);
    if (title.fontUnderline || title.fontStrikeThrough) {
      ctx.beginPath();
      ctx.strokeStyle = title.color || '#ffffff';
      ctx.lineWidth = Math.max(1, fontPx * 0.055);
      ctx.lineCap = 'round';
      if (title.fontUnderline) {
        const underlineY = layout.y + fontPx * 0.38;
        ctx.moveTo(layout.x, underlineY);
        ctx.lineTo(layout.x + layout.width, underlineY);
      }
      if (title.fontStrikeThrough) {
        const strikeY = layout.y - fontPx * 0.04;
        ctx.moveTo(layout.x, strikeY);
        ctx.lineTo(layout.x + layout.width, strikeY);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Renderiza el texto del bloque replicando el visualizador. La variante normal
// crea la previsualización ya fusionada; transparent=true guarda sólo una capa
// PNG alfa, que FFmpeg coloca DESPUÉS de los efectos para mantenerla legible.
function burnOverlayText(imageKey, caption, ov, { transparent = false, title = null, aspectRatio = '9:16' } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!transparent) ctx.drawImage(img, 0, 0);
        const H = canvas.height, W = canvas.width;
        await ensureOverlayFonts(ov, title);
        const scale = H / 1080;
        if (title) drawAutomationTitle(ctx, W, H, title.text, title);
        const maxW = W * ((ov.maxWidthPct || 88) / 100);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.lineJoin = 'round';
        const words = caption.split(/\s+/).filter(Boolean);
        const hi = pickHighlightWords(caption);
        const runStyle = (highlighted) => ({
          fontPx: Math.max(4, (highlighted ? (ov.highlightFontSizePx || ov.fontSizePx || 64) : (ov.fontSizePx || 64)) * scale),
          fontWeight: highlighted ? (ov.highlightFontWeight || 800) : (ov.fontWeight || 700),
          fontFamily: highlighted ? (ov.highlightFont || ov.font || 'sans-serif') : (ov.font || 'sans-serif'),
          italic: highlighted ? !!ov.highlightFontItalic : !!ov.fontItalic,
          underline: highlighted ? !!ov.highlightFontUnderline : !!ov.fontUnderline,
          strikeThrough: highlighted ? !!ov.highlightFontStrikeThrough : !!ov.fontStrikeThrough,
          textTransform: highlighted ? (ov.highlightTextTransform || 'none') : (ov.textTransform || 'none'),
          color: highlighted ? (ov.highlightColor || '#fbbf24') : (ov.color || '#ffffff'),
          strokeColor: highlighted ? (ov.highlightStrokeColor || '#000000') : (ov.strokeColor || '#000000'),
          strokePx: Math.max(0, (highlighted ? (ov.highlightStrokeWidthPx || 0) : (ov.strokeWidthPx || 0)) * scale)
        });
        const makeRun = (word, index, leadingSpace) => {
          const style = runStyle(hi.has(index));
          const transformedWord = transformOverlayWord(word, style.textTransform);
          const text = `${leadingSpace ? ' ' : ''}${transformedWord}`;
          ctx.font = `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontPx}px ${canvasFontFamily(style.fontFamily)}`;
          const width = ctx.measureText(text).width;
          const leadingWidth = leadingSpace ? ctx.measureText(' ').width : 0;
          return { text, width, leadingWidth, style };
        };
        const lines = [];
        let line = { runs: [], width: 0, height: 0 };
        words.forEach((word, index) => {
          let run = makeRun(word, index, line.runs.length > 0);
          if (line.runs.length && line.width + run.width > maxW) {
            lines.push(line);
            line = { runs: [], width: 0, height: 0 };
            run = makeRun(word, index, false);
          }
          line.runs.push(run);
          line.width += run.width;
          line.height = Math.max(line.height, run.style.fontPx * 1.2);
        });
        if (line.runs.length) lines.push(line);
        const blockH = lines.reduce((sum, currentLine) => sum + currentLine.height, 0);
        const anchorY = H * ((ov.y ?? 88) / 100);
        const anchorX = W * ((ov.x ?? 50) / 100);
        const align = ['left', 'right'].includes(ov.align) ? ov.align : 'center';
        let top = anchorY - blockH / 2;
        for (const currentLine of lines) {
          currentLine.x = align === 'left' ? anchorX : align === 'right' ? anchorX - currentLine.width : anchorX - currentLine.width / 2;
          currentLine.y = top + currentLine.height / 2;
          top += currentLine.height;
        }
        // caja de fondo opcional
        if (ov.bg && lines.length) {
          const normalFontPx = Math.max(4, (ov.fontSizePx || 64) * scale);
          const pad = normalFontPx * 0.4;
          const minX = Math.min(...lines.map((currentLine) => currentLine.x));
          const maxX = Math.max(...lines.map((currentLine) => currentLine.x + currentLine.width));
          ctx.globalAlpha = ov.bgOpacity ?? 0.45; ctx.fillStyle = ov.bgColor || '#000';
          ctx.fillRect(minX - pad, anchorY - blockH / 2 - pad, maxX - minX + pad * 2, blockH + pad * 2);
          ctx.globalAlpha = 1;
        }
        for (const currentLine of lines) {
          let x = currentLine.x;
          for (const run of currentLine.runs) {
            const style = run.style;
            ctx.font = `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontPx}px ${canvasFontFamily(style.fontFamily)}`;
            if (style.strokePx > 0) {
              ctx.lineWidth = style.strokePx * 2;
              ctx.strokeStyle = style.strokeColor;
              ctx.strokeText(run.text, x, currentLine.y);
            }
            ctx.fillStyle = style.color;
            ctx.fillText(run.text, x, currentLine.y);
            const decorationStart = x + run.leadingWidth;
            const decorationWidth = Math.max(0, run.width - run.leadingWidth);
            if (decorationWidth && (style.underline || style.strikeThrough)) {
              ctx.beginPath();
              ctx.strokeStyle = style.color;
              ctx.lineWidth = Math.max(1, style.fontPx * 0.055);
              ctx.lineCap = 'round';
              if (style.underline) {
                const underlineY = currentLine.y + style.fontPx * 0.38;
                ctx.moveTo(decorationStart, underlineY);
                ctx.lineTo(decorationStart + decorationWidth, underlineY);
              }
              if (style.strikeThrough) {
                const strikeY = currentLine.y - style.fontPx * 0.04;
                ctx.moveTo(decorationStart, strikeY);
                ctx.lineTo(decorationStart + decorationWidth, strikeY);
              }
              ctx.stroke();
              ctx.lineCap = 'butt';
            }
            x += run.width;
          }
        }
        const dataUrl = transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
        const up = await api('/api/upload', {
          method: 'POST',
          body: { dataUrl, name: transparent ? 'auto-capa-subtitulos' : 'auto-texto' }
        });
        resolve(up.key);
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen para sobreimprimir el texto'));
    if (imageKey) {
      img.src = fileUrl(imageKey);
    } else {
      const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspectRatio || '9:16'));
      const ratioWidth = Number(match?.[1]) || 9;
      const ratioHeight = Number(match?.[2]) || 16;
      const blank = document.createElement('canvas');
      if (ratioWidth >= ratioHeight) {
        blank.height = 1080;
        blank.width = Math.max(2, Math.round((1080 * ratioWidth / ratioHeight) / 2) * 2);
      } else {
        blank.width = 1080;
        blank.height = Math.max(2, Math.round((1080 * ratioHeight / ratioWidth) / 2) * 2);
      }
      img.src = blank.toDataURL('image/png');
    }
  });
}

function automationBlockOutHtml(out, block = null) {
  if (!out || (!out.imageKey && !out.textImageKey && !out.textLayerKey && !out.motionOverlayKey && !out.audioKeys?.length && !out.h3SegmentVideoKeys?.length && !out.videoKey)) return '';
  const audioKeys = Array.isArray(out.audioKeys) ? out.audioKeys : [];
  const segmentVideoKeys = Array.isArray(out.heygenSegmentVideoKeys) ? out.heygenSegmentVideoKeys : [];
  const h3SegmentVideoKeys = Array.isArray(out.h3SegmentVideoKeys) ? out.h3SegmentVideoKeys : [];
  const expected = Number(out.audioCountExpected) || audioKeys.length;
  const isHeyGen = out.generator === 'heygen';
  const isAssets = out.generator === 'assets';
  const isH3 = out.generator === 'h3';
  const isSeedance25 = out.generator === 'seedance25';
  const isOmni = out.generator === 'omni';
  const canRegenerateHeyGenPlanes = isHeyGen && out.heygenFraming === 'split' && segmentVideoKeys.length === 2 && block?.id;
  const sourceStatus = isHeyGen
    ? `HeyGen · ${out.heygenFraming === 'split' ? '2 planos' : '1 plano'}`
    : isH3
      ? `MiniMax H3 · ${out.h3Resolution || '768P'} · ${h3SegmentVideoKeys.length} tramo${h3SegmentVideoKeys.length === 1 ? '' : 's'}`
    : isSeedance25
      ? `Seedance 2.5 · ${out.h3Resolution || '720p'} · ${h3SegmentVideoKeys.length} tramo${h3SegmentVideoKeys.length === 1 ? '' : 's'}`
    : isOmni
      ? `Gemini Omni · ${out.h3Resolution || '720p'} · ${h3SegmentVideoKeys.length} tramo${h3SegmentVideoKeys.length === 1 ? '' : 's'}`
    : isAssets
      ? `Assets · ${(out.assetKeys || []).length} visuales · ${out.assetMuteOriginal !== false ? 'audio original silenciado' : 'audio original mezclado'} · ${out.motionOverlayKey ? 'texto dinámico ✓' : `capa ${out.textLayerKey ? '✓' : '—'}`}`
      : `Imagen ${out.imageKey ? '✓' : '—'} · ${out.motionOverlayKey ? 'Texto dinámico ✓' : `Texto ${out.textImageKey ? '✓' : '—'} · Capa ${out.textLayerKey ? '✓' : '—'}`}`;
  return `
    <span class="automation-stage-status">
      ${sourceStatus} · Audio ${audioKeys.length}/${expected || '—'} · Video ${out.videoKey ? '✓' : '—'}
    </span>
    ${out.fallbackUsed ? `<span class="hint warn">Imagen generada con respaldo: ${esc(out.imageModelName || out.imageModelId || '')}</span>` : ''}
    ${out.imageKey ? `<button type="button" class="auto-output-asset" data-open-asset="${esc(out.imageKey)}" title="Abrir asset y acciones"><img src="${fileUrl(out.imageKey)}" alt="imagen"></button>` : ''}
    ${out.textImageKey ? `<button type="button" class="auto-output-asset" data-open-asset="${esc(out.textImageKey)}" title="Abrir asset y acciones"><img src="${fileUrl(out.textImageKey)}" alt="con texto"></button>` : ''}
    ${out.textLayerKey ? `<button type="button" class="mini-btn" data-open-asset="${esc(out.textLayerKey)}">Capa de subtítulos</button>` : ''}
    ${out.motionOverlayKey ? `<button type="button" class="mini-btn accent" data-open-asset="${esc(out.motionOverlayKey)}">Capa animada Remotion</button>` : ''}
    ${audioKeys.map((key, index) => `<span class="auto-output-audio"><small>Audio ${index + 1}</small><audio src="${fileUrl(key)}" controls preload="metadata"></audio></span>`).join('')}
    ${segmentVideoKeys.length ? `<span class="heygen-segment-list"><small>Segmentos HeyGen</small>${segmentVideoKeys.map((key, index) => {
      const label = out.heygenFraming === 'split' ? (index === 0 ? 'Plano general' : 'Primer plano') : 'Toma HeyGen';
      return `<span class="heygen-segment-row"><button type="button" class="mini-btn" data-open-asset="${esc(key)}">${label}</button>${canRegenerateHeyGenPlanes ? `<button type="button" class="mini-btn accent" data-regenerate-heygen-segment data-block-id="${esc(block.id)}" data-segment-index="${index}">${IC('refresh')} Regenerar</button>` : ''}</span>`;
    }).join('')}</span>` : ''}
    ${h3SegmentVideoKeys.length ? `<span class="heygen-segment-list"><small>Tramos ${isSeedance25 ? 'Seedance 2.5' : isOmni ? 'Gemini Omni' : 'MiniMax H3'}</small>${h3SegmentVideoKeys.map((key, index) => `<span class="heygen-segment-row"><button type="button" class="mini-btn" data-open-asset="${esc(key)}">Tramo ${index + 1}</button></span>`).join('')}</span>` : ''}
    ${out.videoKey ? `<span class="auto-output-video"><video src="${fileUrl(out.videoKey)}" controls preload="metadata"></video><button type="button" class="mini-btn" data-open-asset="${esc(out.videoKey)}">Acciones del video</button></span>` : ''}`;
}

function automationImageSettings(model, config) {
  const aspectRatio = model.aspectRatios.includes(config.aspectRatio)
    ? config.aspectRatio
    : (model.aspectRatios.includes('9:16') ? '9:16' : model.aspectRatios[0]);
  const resolution = model.resolutions.includes(config.resolution)
    ? config.resolution
    : (model.resolutions.includes('2K') ? '2K' : model.resolutions[0]);
  return { aspectRatio, resolution };
}

async function generateAutomationImage(pr, request, setStatus) {
  const primary = state.models.find((model) => model.id === pr.config.imageModelId) || state.models[0];
  if (!primary) throw new Error('No hay un modelo de imagen disponible.');
  const attempt = (model) => api('/api/generate/image', {
    method: 'POST',
    body: {
      ...request,
      modelId: model.id,
      ...automationImageSettings(model, pr.config),
      batch: 1
    }
  });

  try {
    const result = await attempt(primary);
    return { result, model: primary, fallbackUsed: false };
  } catch (primaryError) {
    const fallback = state.models.find((model) =>
      model.id === pr.config.fallbackImageModelId && model.id !== primary.id);
    if (!fallback) throw primaryError;
    const referenceCount = Array.isArray(request.refs) ? request.refs.length : 0;
    if (referenceCount < (fallback.minRefs || 0)) {
      throw new Error(`${primary.name} falló: ${primaryError.message}. ${fallback.name} no puede usarse como respaldo en esta toma porque necesita al menos ${fallback.minRefs} referencia(s).`);
    }
    setStatus(`${primary.name} falló. Reintentando con ${fallback.name}…`);
    try {
      const result = await attempt(fallback);
      return { result, model: fallback, fallbackUsed: true };
    } catch (fallbackError) {
      throw new Error(
        `${primary.name} falló: ${primaryError.message}. ${fallback.name} también falló: ${fallbackError.message}`
      );
    }
  }
}

async function persistAutomationBlockOutput(projectId, blockId, patch, { replace = false } = {}) {
  const pr = state.automations.find((item) => item.id === projectId);
  if (!pr) throw new Error('El proyecto ya no está disponible.');
  const current = pr.outputs?.[blockId] || {};
  const nextOutput = replace
    ? { ...patch, ts: Date.now() }
    : { ...current, ...patch, ts: Date.now() };
  const updated = await api(`/api/automations/${projectId}`, {
    method: 'PUT',
    body: { outputs: { [blockId]: nextOutput } }
  });
  state.automations[state.automations.findIndex((item) => item.id === projectId)] = updated;
  return updated.outputs?.[blockId] || nextOutput;
}

async function tagAutomationStage(pr, block, keys) {
  const valid = keys.filter(Boolean);
  if (!valid.length) return;
  await api('/api/assets/tag', {
    method: 'POST',
    body: {
      keys: valid,
      category: `Auto: ${pr.name}`,
      automationId: pr.id,
      automationName: pr.name,
      blockId: block.id
    }
  });
}

function automationAudioSpec(pr, item) {
  const isDialog = item.kind === 'dialogue';
  const character = isDialog
    ? automationAssignedEntity(pr, 'characters', item.character)
    : null;
  const voiceId = character?.voiceId || pr.config.narratorVoiceId;
  const voiceName = character?.voiceName || pr.config.narratorVoiceName;
  if (!voiceId) throw new Error('Falta la voz del narrador (o del personaje del diálogo).');
  const audioModel = (state.audioModels || []).find((model) => model.id === pr.config?.audioModelId) || state.audioModels?.[0];
  const tag = audioModel?.supportsAudioTags === false ? '' : emotionTagFor(item.text);
  return {
    text: tag ? `${tag} ${item.text}` : item.text,
    audioModelId: audioModel?.id || 'eleven-v3',
    voiceId,
    voiceName
  };
}

function splitTextNearMiddle(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((part) => part.trim()).filter(Boolean) || [];
  if (sentences.length > 1) {
    const total = sentences.reduce((sum, part) => sum + part.length, 0);
    let running = 0;
    let bestIndex = 1;
    let bestDistance = Infinity;
    for (let index = 1; index < sentences.length; index++) {
      running += sentences[index - 1].length;
      const distance = Math.abs((total / 2) - running);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    }
    return [sentences.slice(0, bestIndex).join(' '), sentences.slice(bestIndex).join(' ')];
  }
  const spaces = [...clean.matchAll(/\s+/g)].map((match) => match.index).filter((index) => index > 0 && index < clean.length - 1);
  if (!spaces.length) return [clean];
  const middle = clean.length / 2;
  const cut = spaces.reduce((best, index) => Math.abs(index - middle) < Math.abs(best - middle) ? index : best, spaces[0]);
  return [clean.slice(0, cut).trim(), clean.slice(cut).trim()].filter(Boolean);
}

function automationAudioPlan(block) {
  const original = (block.items || []).map((item) => ({ ...item, text: String(item.text || '').trim() })).filter((item) => item.text);
  if (block.generator !== 'heygen' || block.heygenFraming !== 'split') {
    return { segments: original, groups: [original.map((_, index) => index)] };
  }
  if (original.length === 1) {
    const parts = splitTextNearMiddle(original[0].text);
    if (parts.length < 2) return { segments: original, groups: [[0]] };
    return { segments: parts.map((text) => ({ ...original[0], text })), groups: [[0], [1]] };
  }
  const total = original.reduce((sum, item) => sum + item.text.length, 0);
  let running = 0;
  let boundary = 1;
  let distance = Infinity;
  for (let index = 1; index < original.length; index++) {
    running += original[index - 1].text.length;
    const nextDistance = Math.abs((total / 2) - running);
    if (nextDistance < distance) { distance = nextDistance; boundary = index; }
  }
  return {
    segments: original,
    groups: [
      original.slice(0, boundary).map((_, index) => index),
      original.slice(boundary).map((_, index) => boundary + index)
    ]
  };
}

async function refreshAutomationHistory() {
  const snapshot = await api('/api/state');
  state.history = snapshot.history || [];
  return state.history;
}

function recoverHistoryOutput(type, prompt, { voiceId = '', audioModelId = '', usedKeys = new Set() } = {}) {
  const entry = state.history.find((candidate) =>
    candidate.type === type
    && candidate.prompt === prompt
    && (!voiceId || candidate.voiceId === voiceId)
    && (!audioModelId || candidate.modelId === audioModelId)
    && (candidate.outputs || []).some((key) => !usedKeys.has(key)));
  if (!entry) return null;
  const key = (entry.outputs || []).find((candidate) => !usedKeys.has(candidate));
  return key ? { entry, key } : null;
}

async function runAutomationAssetBlock(pr, block, output, { regenerate = false, regenerateAudio = false, requireExistingAudio = false, setStatus }) {
  const assetKeys = Array.isArray(block.assetKeys) ? block.assetKeys.filter((key) => /^(generated|uploads|video)\//.test(key)) : [];
  if (!assetKeys.length) throw new Error('Elegí al menos una imagen o video para este bloque.');
  const audioKeys = Array.isArray(output.audioKeys) ? output.audioKeys.slice(0, block.items.length) : [];
  if (requireExistingAudio && audioKeys.length !== block.items.length) {
    throw new Error('Faltan audios guardados; este reensamble no generará reemplazos con ElevenLabs.');
  }
  const usedAudioKeys = new Set(audioKeys);
  let historyLoaded = false;
  for (let index = audioKeys.length; index < block.items.length; index++) {
    const spec = automationAudioSpec(pr, block.items[index]);
    let recovered = null;
    if (!regenerate && !regenerateAudio) {
      if (!historyLoaded) {
        setStatus('Buscando audios ya generados para este bloque…');
        await refreshAutomationHistory();
        historyLoaded = true;
      }
      recovered = recoverHistoryOutput('audio', spec.text, {
        voiceId: spec.voiceId, audioModelId: spec.audioModelId, usedKeys: usedAudioKeys
      });
    }
    if (recovered) {
      audioKeys.push(recovered.key);
      usedAudioKeys.add(recovered.key);
      setStatus(`Reutilizando audio ${audioKeys.length}/${block.items.length}…`);
    } else {
      setStatus(`Generando audio ${index + 1}/${block.items.length}…`);
      const generatedAudio = await api('/api/generate/audio', { method: 'POST', body: spec });
      const audioKey = generatedAudio.outputs?.[0];
      if (!audioKey) throw new Error(`No se generó el audio ${index + 1}.`);
      state.history.unshift(generatedAudio);
      audioKeys.push(audioKey);
      usedAudioKeys.add(audioKey);
    }
    output = await persistAutomationBlockOutput(pr.id, block.id, {
      audioKeys: [...audioKeys], audioCountExpected: block.items.length, generator: 'assets',
      assetKeys, assetMuteOriginal: block.assetMuteOriginal !== false
    });
    await tagAutomationStage(pr, block, [audioKeys[audioKeys.length - 1]]);
  }

  const dynamicTextEnabled = pr.config?.dynamicText?.enabled === true;
  let textLayerKey = dynamicTextEnabled ? '' : output.textLayerKey;
  if (!dynamicTextEnabled && !textLayerKey) {
    setStatus('Preparando la capa nítida de títulos y subtítulos…');
    const caption = block.items.map((item) => item.text).join(' ');
    const title = automationTitleForBlock(pr, block);
    textLayerKey = await burnOverlayText('', caption, pr.config.overlay, {
      transparent: true, title, aspectRatio: pr.config.aspectRatio || '9:16'
    });
    output = await persistAutomationBlockOutput(pr.id, block.id, { textLayerKey });
    await tagAutomationStage(pr, block, [textLayerKey]);
  }

  setStatus(dynamicTextEnabled
    ? `Distribuyendo ${assetKeys.length} Assets y animando el texto con Remotion…`
    : `Distribuyendo ${assetKeys.length} Assets a lo largo del audio…`);
  const result = await api(`/api/automations/${pr.id}/asset-block`, {
    method: 'POST', body: { blockId: block.id, audioKeys, textLayerKey }
  });
  output = await persistAutomationBlockOutput(pr.id, block.id, {
    videoKey: result.videoKey,
    motionOverlayKey: result.motionOverlayKey || null,
    assetKeys: result.assetKeys || assetKeys,
    assetMuteOriginal: result.assetMuteOriginal !== false,
    assetSegmentDuration: result.segmentDuration,
    generator: 'assets',
    completedAt: Date.now()
  });
  await tagAutomationStage(pr, block, [textLayerKey, result.motionOverlayKey, ...audioKeys, result.videoKey]);
  return output;
}

async function runAutomationHeyGenBlock(pr, block, output, { regenerate = false, regenerateAudio = false, requireExistingAudio = false, regenerateSegmentIndex = -1, setStatus }) {
  const character = state.characters.find((item) => item.id === block.heygenCharacterId);
  if (!heygenCharacterReady(character)) throw new Error('El bloque necesita un personaje con variante HeyGen completa.');
  if (['close', 'split'].includes(block.heygenFraming) && !character.heygen?.closeAvatarId) {
    throw new Error('El personaje HeyGen elegido no tiene código de primer plano.');
  }
  if (pr.config?.heygenAuthMode === 'oauth' && !state.heygenOAuth.connected) throw new Error('Conectá HeyGen OAuth desde Configuración.');
  if (pr.config?.heygenAuthMode !== 'oauth' && !state.config?.keys?.heygen) throw new Error('Guardá la API key de HeyGen en Configuración.');

  const plan = automationAudioPlan(block);
  const audioKeys = Array.isArray(output.audioKeys) ? output.audioKeys.slice(0, plan.segments.length) : [];
  if ((requireExistingAudio || regenerateSegmentIndex >= 0) && audioKeys.length !== plan.segments.length) {
    throw new Error('Faltan audios guardados; regenerar un plano HeyGen no creará reemplazos con ElevenLabs.');
  }
  const usedAudioKeys = new Set(audioKeys);
  let historyLoaded = false;
  for (let index = audioKeys.length; index < plan.segments.length; index++) {
    const spec = automationAudioSpec(pr, plan.segments[index]);
    let recovered = null;
    if (!regenerate && !regenerateAudio) {
      if (!historyLoaded) {
        setStatus('Buscando audios ya generados para este bloque…');
        await refreshAutomationHistory();
        historyLoaded = true;
      }
      recovered = recoverHistoryOutput('audio', spec.text, { voiceId: spec.voiceId, audioModelId: spec.audioModelId, usedKeys: usedAudioKeys });
    }
    if (recovered) {
      audioKeys.push(recovered.key);
      usedAudioKeys.add(recovered.key);
      setStatus(`Reutilizando audio ${audioKeys.length}/${plan.segments.length}…`);
    } else {
      setStatus(`Generando audio ${index + 1}/${plan.segments.length} con ElevenLabs…`);
      const generatedAudio = await api('/api/generate/audio', { method: 'POST', body: spec });
      const audioKey = generatedAudio.outputs?.[0];
      if (!audioKey) throw new Error(`No se generó el audio ${index + 1}.`);
      state.history.unshift(generatedAudio);
      audioKeys.push(audioKey);
      usedAudioKeys.add(audioKey);
    }
    output = await persistAutomationBlockOutput(pr.id, block.id, {
      audioKeys: [...audioKeys],
      audioCountExpected: plan.segments.length,
      generator: 'heygen',
      heygenFraming: block.heygenFraming
    });
    await tagAutomationStage(pr, block, [audioKeys[audioKeys.length - 1]]);
  }

  const dynamicTextEnabled = pr.config?.dynamicText?.enabled === true;
  let textLayerKey = dynamicTextEnabled ? '' : output.textLayerKey;
  if (!dynamicTextEnabled && !textLayerKey) {
    setStatus('Preparando título, texto y resaltado para el video HeyGen…');
    const caption = block.items.map((item) => item.text).join(' ');
    const title = automationTitleForBlock(pr, block);
    textLayerKey = await burnOverlayText('', caption, pr.config.overlay, {
      transparent: true,
      title,
      aspectRatio: pr.config.aspectRatio || '9:16'
    });
    output = await persistAutomationBlockOutput(pr.id, block.id, { textLayerKey });
    await tagAutomationStage(pr, block, [textLayerKey]);
  }

  const audioGroups = plan.groups.map((indexes) => indexes.map((index) => audioKeys[index]).filter(Boolean)).filter((group) => group.length);
  if (block.heygenFraming === 'split' && audioGroups.length !== 2) throw new Error('No pude dividir el texto en dos fragmentos utilizables.');
  if (regenerateSegmentIndex >= 0) {
    output = await persistAutomationBlockOutput(pr.id, block.id, { videoKey: null, completedAt: null });
  }
  setStatus(regenerateSegmentIndex >= 0
    ? `Regenerando ${regenerateSegmentIndex === 0 ? 'el plano general' : 'el primer plano'} y conservando el otro…`
    : block.heygenFraming === 'split'
      ? 'Enviando dos audios a HeyGen y preparando ambos encuadres…'
      : 'Enviando el audio de ElevenLabs a HeyGen…');
  const result = await api(`/api/automations/${pr.id}/heygen-block`, {
    method: 'POST',
    body: {
      blockId: block.id,
      characterId: character.id,
      framing: block.heygenFraming,
      audioGroups,
      textLayerKey,
      ...(regenerateSegmentIndex >= 0 ? { regenerateSegmentIndex } : {})
    }
  });
  output = await persistAutomationBlockOutput(pr.id, block.id, {
    videoKey: result.videoKey,
    motionOverlayKey: result.motionOverlayKey || null,
    heygenSegmentVideoKeys: result.segmentVideoKeys || [],
    generator: 'heygen',
    heygenFraming: block.heygenFraming,
    completedAt: Date.now()
  });
  await tagAutomationStage(pr, block, [textLayerKey, result.motionOverlayKey, ...audioKeys, ...(result.segmentVideoKeys || []), result.videoKey]);
  return output;
}

async function runAutomationBlock(projectId, block, blockEl, {
  regenerate = false, regenerateAudio = false, requireExistingAudio = false, regenerateHeyGenSegment = -1, monitorTaskId = '', monitorIndex = 0, monitorTotal = 0
} = {}) {
  let pr = state.automations.find((x) => x.id === projectId);
  if (!pr) return false;
  const ownsMonitorTask = !monitorTaskId;
  const activeMonitorTaskId = monitorTaskId || startUiTask({
    title: `Generando ${block.title || 'toma'}`,
    detail: 'Preparando materiales…'
  });
  const outEl = blockEl?.querySelector('[data-out]');
  const setStatus = (msg) => {
    if (outEl) outEl.innerHTML = `<span class="hint">${esc(msg)}</span>`;
    updateUiTask(activeMonitorTaskId, {
      current: monitorIndex + 1,
      total: monitorTotal,
      detail: `${monitorTotal ? `${monitorIndex + 1}/${monitorTotal} · ` : ''}${block.title || block.id} · ${msg}`
    });
  };
  let output = pr.outputs?.[block.id] || {};
  try {
    if (blockEl) blockEl.classList.add('is-working');
    if (regenerate) {
      output = await persistAutomationBlockOutput(projectId, block.id, {}, { replace: true });
      pr = state.automations.find((item) => item.id === projectId) || pr;
    }

    if (block.generator === 'assets') {
      await runAutomationAssetBlock(pr, block, output, {
        regenerate, regenerateAudio, requireExistingAudio, setStatus
      });
      if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { detail: 'Montaje con Assets terminado.' });
      renderAutomationProject();
      return true;
    }

    if (block.generator === 'heygen') {
      await runAutomationHeyGenBlock(pr, block, output, {
        regenerate,
        regenerateAudio,
        requireExistingAudio,
        regenerateSegmentIndex: regenerateHeyGenSegment,
        setStatus
      });
      if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { detail: 'Toma HeyGen terminada.' });
      renderAutomationProject();
      return true;
    }

    const { refs, labeledRefs, prompt } = await automationRefsAndPrompt(pr, block);
    let historyLoaded = false;
    let imageKey = output.imageKey;
    const isGenerativeVideo = ['h3', 'seedance25', 'omni'].includes(block.generator);
    const generativeVideoMode = block.generator === 'omni' ? block.omniMode : block.generator === 'seedance25' ? block.seedance25Mode : block.h3Mode;
    const generativeReferenceKeys = block.generator === 'omni' ? block.omniReferenceKeys : block.generator === 'seedance25' ? block.seedance25ReferenceKeys : block.h3ReferenceKeys;
    if (!imageKey && isGenerativeVideo && generativeVideoMode === 'frames') {
      imageKey = (generativeReferenceKeys || [])[0] || '';
      if (imageKey) output = await persistAutomationBlockOutput(projectId, block.id, {
        imageKey, imageModelId: `${block.generator}-frame`, imageModelName: `Fotograma de entrada ${block.generator === 'seedance25' ? 'Seedance 2.5' : block.generator === 'omni' ? 'Gemini Omni' : 'H3'}`,
        fallbackUsed: false, recoveredImage: true, audioCountExpected: block.items.length
      });
    }
    if (!imageKey && !regenerate) {
      setStatus('Buscando una imagen ya generada para este bloque…');
      await refreshAutomationHistory();
      historyLoaded = true;
      const recovered = recoverHistoryOutput('image', prompt);
      if (recovered) {
        imageKey = recovered.key;
        output = await persistAutomationBlockOutput(projectId, block.id, {
          imageKey,
          imageModelId: recovered.entry.modelId || '',
          imageModelName: recovered.entry.modelName || '',
          fallbackUsed: false,
          recoveredImage: true,
          audioCountExpected: block.items.length
        });
        await tagAutomationStage(pr, block, [imageKey]);
      }
    }
    if (!imageKey) {
      setStatus('Generando imagen…');
      const generatedImage = await generateAutomationImage(
        pr,
        { prompt, refs, labeledRefs },
        setStatus
      );
      imageKey = generatedImage.result.outputs[0];
      state.history.unshift(generatedImage.result);
      output = await persistAutomationBlockOutput(projectId, block.id, {
        imageKey,
        imageModelId: generatedImage.model.id,
        imageModelName: generatedImage.model.name,
        fallbackUsed: generatedImage.fallbackUsed,
        recoveredImage: false,
        audioCountExpected: block.items.length
      });
      await tagAutomationStage(pr, block, [imageKey]);
    } else {
      setStatus('Reutilizando la imagen guardada…');
    }

    const caption = block.items.map((it) => it.text).join(' ');
    const title = automationTitleForBlock(pr, block);
    const dynamicTextEnabled = pr.config?.dynamicText?.enabled === true;
    let textImageKey = dynamicTextEnabled ? '' : output.textImageKey;
    if (!dynamicTextEnabled && !textImageKey) {
      setStatus('Sobreimprimiendo el texto…');
      textImageKey = await burnOverlayText(imageKey, caption, pr.config.overlay, { title });
      output = await persistAutomationBlockOutput(projectId, block.id, { textImageKey });
      await tagAutomationStage(pr, block, [textImageKey]);
    } else if (!dynamicTextEnabled) {
      setStatus('Reutilizando la imagen con texto guardada…');
    }

    let textLayerKey = dynamicTextEnabled ? '' : output.textLayerKey;
    if (!dynamicTextEnabled && !textLayerKey) {
      setStatus('Preparando la capa nítida de subtítulos…');
      textLayerKey = await burnOverlayText(imageKey, caption, pr.config.overlay, { transparent: true, title });
      output = await persistAutomationBlockOutput(projectId, block.id, { textLayerKey });
      await tagAutomationStage(pr, block, [textLayerKey]);
    }

    const audioKeys = Array.isArray(output.audioKeys)
      ? output.audioKeys.slice(0, block.items.length)
      : [];
    if (requireExistingAudio && audioKeys.length !== block.items.length) {
      throw new Error('Faltan audios guardados; este reensamble no generará reemplazos con ElevenLabs.');
    }
    const usedAudioKeys = new Set(audioKeys);
    for (let index = audioKeys.length; index < block.items.length; index++) {
      const spec = automationAudioSpec(pr, block.items[index]);
      let recovered = null;
      if (!regenerate && !regenerateAudio) {
        if (!historyLoaded) {
          setStatus('Buscando audios ya generados para este bloque…');
          await refreshAutomationHistory();
          historyLoaded = true;
        }
        recovered = recoverHistoryOutput('audio', spec.text, { voiceId: spec.voiceId, audioModelId: spec.audioModelId, usedKeys: usedAudioKeys });
      }
      if (recovered) {
        audioKeys.push(recovered.key);
        usedAudioKeys.add(recovered.key);
        setStatus(`Reutilizando audio ${audioKeys.length}/${block.items.length}…`);
      } else {
        setStatus(`Generando audio ${index + 1}/${block.items.length}…`);
        const generatedAudio = await api('/api/generate/audio', { method: 'POST', body: spec });
        const audioKey = generatedAudio.outputs?.[0];
        if (!audioKey) throw new Error(`No se generó el audio ${index + 1}.`);
        state.history.unshift(generatedAudio);
        audioKeys.push(audioKey);
        usedAudioKeys.add(audioKey);
      }
      output = await persistAutomationBlockOutput(projectId, block.id, {
        audioKeys: [...audioKeys],
        audioCountExpected: block.items.length
      });
      await tagAutomationStage(pr, block, [audioKeys[audioKeys.length - 1]]);
    }

    setStatus(isGenerativeVideo
      ? `Generando y ensamblando los tramos ${block.generator === 'seedance25' ? 'Seedance 2.5' : block.generator === 'omni' ? 'Gemini Omni' : 'MiniMax H3'}…`
      : dynamicTextEnabled ? 'Animando títulos y subtítulos con Remotion…' : 'Armando el video…');
    const category = `Auto: ${pr.name}`;
    const v = isGenerativeVideo
      ? await api(`/api/automations/${pr.id}/h3-block`, { method: 'POST', body: {
        blockId: block.id, imageKey, audioKeys, textLayerKey,
        reuseSegmentKeys: !regenerate ? (output.h3SegmentVideoKeys || []) : []
      } })
      : await api(`/api/automations/${pr.id}/video`, { method: 'POST', body: {
        blockId: block.id, imageKey: dynamicTextEnabled ? imageKey : textImageKey, audioKeys, category
      } });
    output = await persistAutomationBlockOutput(projectId, block.id, {
      videoKey: v.videoKey,
      motionOverlayKey: v.motionOverlayKey || null,
      ...(isGenerativeVideo ? {
        h3SegmentVideoKeys: v.segmentVideoKeys || [], generator: block.generator,
        h3SegmentDurations: v.segmentDurations || [],
        h3Resolution: block.generator === 'seedance25' ? (block.seedance25Resolution || '720p') : block.generator === 'omni' ? (block.omniResolution || '720p') : (block.h3Resolution || '768P')
      } : {}),
      completedAt: Date.now()
    });
    await tagAutomationStage(pr, block, [imageKey, textImageKey, textLayerKey, v.motionOverlayKey, ...(v.segmentVideoKeys || []), ...audioKeys, v.videoKey]);
    if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { detail: isGenerativeVideo ? `Toma ${block.generator === 'seedance25' ? 'Seedance 2.5' : block.generator === 'omni' ? 'Gemini Omni' : 'MiniMax H3'} terminada.` : 'Toma terminada.' });
    renderAutomationProject();
    return true;
  } catch (err) {
    if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { error: err.message });
    toast(err.message, 'err');
    if (block.generator === 'heygen' || ['h3', 'seedance25', 'omni'].includes(block.generator)) {
      try {
        const snapshot = await api('/api/state');
        state.automations = snapshot.automations || state.automations;
      } catch { /* mantenemos el estado local si tampoco se puede refrescar */ }
    }
    const latest = state.automations.find((item) => item.id === projectId)?.outputs?.[block.id] || output;
    if (outEl) {
      outEl.innerHTML = `${automationBlockOutHtml(latest, block)}<span class="hint warn">Falló: ${esc(err.message)}. Los parciales guardados se reutilizarán al continuar.</span>`;
      bindAutomationAssetOpeners(outEl);
      bindAutomationHeyGenSegmentActions(outEl, state.automations.find((item) => item.id === projectId) || pr);
    }
    return false;
  } finally {
    if (blockEl) blockEl.classList.remove('is-working');
  }
}

async function runAutomationAll(projectId, mode) {
  const pr = state.automations.find((x) => x.id === projectId);
  if (!pr) return;
  const targets = pr.blocks.filter((b) => mode === 'all' || !(pr.outputs?.[b.id]?.videoKey));
  if (!targets.length) return toast('No hay bloques para generar con esa opción', 'ok');
  if (mode === 'all' && !confirm(`¿Regenerar los ${targets.length} bloques? Se crean assets nuevos.`)) return;
  const monitorTaskId = startUiTask({
    title: `Automatizando ${pr.name}`,
    detail: `Preparando el bloque 1 de ${targets.length}…`,
    total: targets.length,
    current: 1
  });
  const btn = $('#autoStart');
  if (btn) { btn.disabled = true; }
  let ok = 0;
  for (const block of targets) {
    const index = targets.indexOf(block);
    const blockEl = $('#automationRoot')?.querySelector(`.auto-block[data-block="${block.id}"]`);
    const r = await runAutomationBlock(projectId, block, blockEl, {
      regenerate: mode === 'all', monitorTaskId, monitorIndex: index, monitorTotal: targets.length
    });
    if (r) {
      ok++;
      updateUiTask(monitorTaskId, { current: ok, detail: `${ok}/${targets.length} bloques terminados.` });
    } else break; // si uno falla, freno para no encadenar errores
  }
  if (ok === targets.length) finishUiTask(monitorTaskId, { detail: `${ok}/${targets.length} bloques terminados.` });
  else finishUiTask(monitorTaskId, { error: `La automatización se detuvo en ${ok}/${targets.length}.` });
  toast(`Automatización: ${ok}/${targets.length} bloques generados`, ok === targets.length ? 'ok' : 'err');
}

async function assembleAutomationProject(projectId) {
  const pr = state.automations.find((item) => item.id === projectId);
  if (!pr) return;
  if (pr.finalOutput?.videoKey && !confirm('¿Crear un nuevo ensamble final? El video final anterior seguirá disponible en Assets.')) return;
  const button = $('#autoAssemble');
  const status = $('#autoAssembleStatus');
  if (button) button.disabled = true;
  const hasTransitions = pr.config?.transitionSound?.enabled && pr.blocks.length > 1;
  if (status) status.textContent = `Uniendo ${pr.blocks.length} videos${hasTransitions ? ` y agregando ${pr.blocks.length - 1} transiciones sonoras` : ''}${pr.config?.music?.enabled ? ' y mezclando la música en bucle' : ''}${pr.config?.includeLogos ? ', fundiendo a negro y agregando el logo' : ''} con FFmpeg…`;
  try {
    const result = await api(`/api/automations/${projectId}/assemble`, { method: 'POST' });
    const index = state.automations.findIndex((item) => item.id === projectId);
    if (index !== -1) state.automations[index] = result.project;
    try {
      await refreshAssets();
    } catch {
      // El ensamble ya quedó guardado aunque la vista de Assets no pueda refrescarse.
    }
    renderAutomationProject();
    toast(`Video final ensamblado: ${result.finalOutput.blockCount} bloques${result.finalOutput.transitionCount ? `, ${result.finalOutput.transitionCount} transiciones sonoras` : ''}${result.finalOutput.musicKey ? ' con música' : ''}${result.finalOutput.includeLogos ? ' y logo final' : ''}`, 'ok');
  } catch (error) {
    if (button) button.disabled = false;
    if (status) status.textContent = `Falló el ensamble: ${error.message}`;
    toast(error.message, 'err');
  }
}

async function ensureAutomationSubtitleLayers(projectId, taskId = '', { force = false } = {}) {
  let pr = state.automations.find((item) => item.id === projectId);
  if (!pr) throw new Error('El proyecto ya no está disponible.');
  const dynamicTextEnabled = pr.config?.dynamicText?.enabled === true;
  for (let index = 0; index < pr.blocks.length; index++) {
    const block = pr.blocks[index];
    let output = pr.outputs?.[block.id] || {};
    updateUiTask(taskId, {
      current: index + 1,
      detail: force
        ? `Regenerando textos ${index + 1}/${pr.blocks.length}…`
        : (dynamicTextEnabled ? output.motionOverlayKey : output.textLayerKey)
        ? `Verificando subtítulos ${index + 1}/${pr.blocks.length}…`
        : `Creando capa de subtítulos ${index + 1}/${pr.blocks.length}…`
    });
    if (dynamicTextEnabled && force) {
      const result = await api(`/api/automations/${projectId}/text-layer`, {
        method: 'POST',
        body: { blockId: block.id }
      });
      const projectIndex = state.automations.findIndex((item) => item.id === projectId);
      if (projectIndex !== -1) state.automations[projectIndex] = result.project;
      pr = result.project;
      output = pr.outputs?.[block.id] || output;
    } else if (dynamicTextEnabled && !output.motionOverlayKey) {
      throw new Error(`Falta la capa animada de “${block.title || block.id}”. Usá “Rehacer texto + video” en esa toma antes de aplicar el efecto.`);
    }
    if (!dynamicTextEnabled && (force || !output.textLayerKey)) {
      const caption = (block.items || []).map((item) => item.text).join(' ');
      const title = automationTitleForBlock(pr, block);
      const textLayerKey = await burnOverlayText(output.imageKey || '', caption, pr.config.overlay, {
        transparent: true,
        title,
        aspectRatio: pr.config.aspectRatio || '9:16'
      });
      output = await persistAutomationBlockOutput(projectId, block.id, { textLayerKey });
      await tagAutomationStage(pr, block, [textLayerKey]);
      pr = state.automations.find((item) => item.id === projectId) || pr;
    }
    updateUiTask(taskId, { current: index + 1 });
  }
  return state.automations.find((item) => item.id === projectId) || pr;
}

async function refreshAutomationProjectText(projectId) {
  let pr = state.automations.find((item) => item.id === projectId);
  if (!pr?.finalOutput?.videoKey) return toast('Primero ensamblá el video final.', 'err');
  const target = pr.effectOutput?.videoKey ? 'effect' : 'final';
  const targetLabel = target === 'effect' ? 'la versión con efectos' : 'el video final limpio';
  if (!confirm(`¿Regenerar todos los títulos, subtítulos y resaltados de ${targetLabel}?\n\nSe reemplazará solamente ese video. Se conservarán exactamente las imágenes, planos HeyGen, Assets, voces, música y duración actuales.`)) return;
  const button = $('#autoRefreshAllText');
  const status = $('#autoRefreshTextStatus');
  const taskId = startUiTask({
    title: 'Regenerando todos los textos',
    detail: `Preparando el bloque 1 de ${pr.blocks.length}…`,
    total: pr.blocks.length + 1,
    current: 1
  });
  if (button) button.disabled = true;
  if (status) status.textContent = `Regenerando capas de texto para ${targetLabel}; el resto del material no se modifica…`;
  try {
    pr = await ensureAutomationSubtitleLayers(projectId, taskId, { force: true });
    updateUiTask(taskId, {
      current: pr.blocks.length + 1,
      detail: `Recomponiendo ${targetLabel} con las nuevas capas…`
    });
    const result = await api(`/api/automations/${projectId}/effect`, {
      method: 'POST',
      body: { textRefreshTarget: target }
    });
    const index = state.automations.findIndex((item) => item.id === projectId);
    if (index !== -1) state.automations[index] = result.project;
    try {
      await refreshAssets();
    } catch {
      // El master actualizado ya quedó persistido aunque Assets no refresque.
    }
    finishUiTask(taskId, { detail: `Textos actualizados únicamente en ${targetLabel}.` });
    renderAutomationProject();
    toast(`Todos los textos fueron regenerados en ${targetLabel}. No se regeneraron imágenes, audios ni videos de origen.`, 'ok');
  } catch (error) {
    finishUiTask(taskId, { error: error.message });
    if (button) button.disabled = false;
    if (status) status.textContent = `Falló la actualización de textos: ${error.message}`;
    toast(error.message, 'err');
  }
}

async function applyAutomationVideoEffect(projectId, requestedEffect) {
  let pr = state.automations.find((item) => item.id === projectId);
  if (!pr?.finalOutput?.videoKey) return toast('Primero ensamblá el video final limpio.', 'err');
  if (pr.effectOutput?.videoKey && !confirm('¿Crear otra versión con efecto? La versión anterior seguirá disponible en Assets.')) return;
  const button = $('#autoApplyEffect');
  const status = $('#autoEffectStatus');
  const taskId = startUiTask({
    title: 'Preparando versión con efecto',
    detail: 'Verificando las capas de subtítulos…',
    total: pr.blocks.length + 1,
    current: 1
  });
  if (button) button.disabled = true;
  if (status) status.textContent = 'Preparando capas de subtítulos nítidas. No se regenerará ninguna imagen ni voz…';
  try {
    const refreshPendingText = Boolean(pr.textRefreshRequiredAt);
    pr = await ensureAutomationSubtitleLayers(projectId, taskId, { force: refreshPendingText });
    updateUiTask(taskId, {
      current: pr.blocks.length + 1,
      detail: 'Aplicando el efecto debajo del texto con FFmpeg…'
    });
    if (status) status.textContent = 'Aplicando el efecto sobre imágenes y tomas HeyGen, luego la máscara y el texto…';
    const result = await api(`/api/automations/${projectId}/effect`, {
      method: 'POST',
      body: { videoEffect: requestedEffect || pr.config?.videoEffect, textLayersRefreshed: refreshPendingText }
    });
    const index = state.automations.findIndex((item) => item.id === projectId);
    if (index !== -1) state.automations[index] = result.project;
    try {
      await refreshAssets();
    } catch {
      // La versión procesada ya está guardada aunque Assets no pueda refrescarse.
    }
    finishUiTask(taskId, { detail: 'Efecto aplicado; subtítulos preservados.' });
    renderAutomationProject();
    const maskSummary = result.effectOutput.maskEnabled
      ? ` Máscara ${result.effectOutput.maskColor} al ${result.effectOutput.maskOpacity}%.`
      : '';
    toast(`${result.effectOutput.presetName} aplicado al ${result.effectOutput.intensity}%.${maskSummary} El ensamble limpio se conservó.`, 'ok');
  } catch (error) {
    finishUiTask(taskId, { error: error.message });
    if (button) button.disabled = false;
    if (status) status.textContent = `Falló la posproducción: ${error.message}`;
    toast(error.message, 'err');
  }
}

// ---------------------------------------------------------------------------
// Subtitulador · Scribe v2 + editor de líneas + motor Remotion compartido
// ---------------------------------------------------------------------------

function subtitlerTypeCard(kind, cfg) {
  const isHighlight = kind === 'highlight';
  const isTitle = kind === 'title';
  const id = isTitle ? 'subTitle' : isHighlight ? 'subOvHl' : 'subOv';
  const font = isHighlight ? (cfg.highlightFont || '') : cfg.font;
  const size = isHighlight ? cfg.highlightFontSizePx : cfg.fontSizePx;
  const weight = isHighlight ? cfg.highlightFontWeight : cfg.fontWeight;
  const transform = isHighlight ? cfg.highlightTextTransform : cfg.textTransform;
  const italic = isHighlight ? cfg.highlightFontItalic : cfg.fontItalic;
  const underline = isHighlight ? cfg.highlightFontUnderline : cfg.fontUnderline;
  const strike = isHighlight ? cfg.highlightFontStrikeThrough : cfg.fontStrikeThrough;
  const color = isHighlight ? cfg.highlightColor : cfg.color;
  const stroke = isHighlight ? cfg.highlightStrokeColor : cfg.strokeColor;
  const strokeWidth = isHighlight ? cfg.highlightStrokeWidthPx : cfg.strokeWidthPx;
  return `<div class="overlay-type-card${isHighlight ? ' highlight' : isTitle ? ' title' : ''}">
    <h5>${isHighlight ? 'Texto resaltado' : isTitle ? 'Título' : 'Texto normal'}</h5>
    <label><span>Fuente</span><span class="overlay-font-line"><select class="select" id="${id}Font">${overlayFontOptions(font, { inherit: isHighlight })}</select><button type="button" class="mini-btn" data-sub-import-font="${kind}">Importar</button></span></label>
    <label><span>Tamaño · px @ 1080</span><input type="number" id="${id}Size" min="8" max="300" step="1" value="${size}"></label>
    <label><span>Peso</span><select class="select" id="${id}Weight">${[400, 500, 600, 700, 800, 900].map((value) => `<option value="${value}"${value === weight ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
    <label><span>Mayúsculas y minúsculas</span><select class="select" id="${id}Transform">${[['none', 'Como fue escrito'], ['uppercase', 'MAYÚSCULAS'], ['lowercase', 'minúsculas'], ['capitalize', 'Iniciales En Mayúscula']].map(([value, label]) => `<option value="${value}"${value === (transform || 'none') ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    <div class="overlay-format-options"><label><input type="checkbox" id="${id}Italic"${italic ? ' checked' : ''}> <em>Cursiva</em></label><label><input type="checkbox" id="${id}Underline"${underline ? ' checked' : ''}> <u>Subrayado</u></label><label><input type="checkbox" id="${id}Strike"${strike ? ' checked' : ''}> <s>Tachado</s></label></div>
    <label><span>Color</span><input type="color" id="${id}Color" value="${esc(color || '#ffffff')}"></label>
    <label><span>Color del borde</span><input type="color" id="${id}Stroke" value="${esc(stroke || '#000000')}"></label>
    <label><span>Borde · px @ 1080</span><input type="number" id="${id}StrokeW" min="0" max="30" step="0.5" value="${strokeWidth || 0}"></label>
  </div>`;
}

function subtitlerLineMarkup(line, index) {
  return `<div class="subtitler-line" data-sub-line="${esc(line.id)}">
    <b class="subtitler-line-index">${index + 1}</b>
    <label><span>Inicio</span><input type="number" data-sub-start min="0" step="0.01" value="${Number(line.start).toFixed(2)}"></label>
    <label><span>Fin</span><input type="number" data-sub-end min="0" step="0.01" value="${Number(line.end).toFixed(2)}"></label>
    <label class="subtitler-line-text"><span>${line.speakerId ? `${esc(line.speakerId)} · ` : ''}Texto interpretado</span><textarea data-sub-text rows="2" maxlength="2000">${esc(line.text)}</textarea></label>
    <button type="button" class="icon-btn" data-sub-remove-line title="Quitar línea">${IC('trash')}</button>
  </div>`;
}

function readSubtitlerLines(root, originalLines) {
  return [...root.querySelectorAll('[data-sub-line]')].map((row, index) => {
    const previous = originalLines.find((line) => line.id === row.dataset.subLine) || {};
    const start = Math.max(0, Number(row.querySelector('[data-sub-start]').value) || 0);
    const end = Math.max(start + .04, Number(row.querySelector('[data-sub-end]').value) || start + .04);
    return { ...previous, id: previous.id || `line-${index + 1}`, start, end, text: row.querySelector('[data-sub-text]').value.trim() };
  }).filter((line) => line.text);
}

function subtitleSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function downloadSubtitleFile({ name, extension, content, mime }) {
  const safeName = String(name || 'subtitulos')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim()
    .slice(0, 120) || 'subtitulos';
  const blob = new Blob([`\uFEFF${content}`], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeName}.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function saveSubtitler(patch = {}, { rerender = false } = {}) {
  const previous = state.subtitler || {};
  state.subtitler = await api('/api/subtitler', {
    method: 'PUT', task: false,
    body: {
      projectId: previous.activeProjectId || previous.id,
      ...patch,
      config: patch.config ? { ...(previous.config || {}), ...patch.config } : undefined
    }
  });
  if (rerender) renderSubtitler();
  return state.subtitler;
}

function renderSubtitler() {
  const root = $('#subtitlerRoot');
  const studio = state.subtitler;
  if (!root || !studio) return;
  const ov = { ...(studio.config?.overlay || {}) };
  const titleOv = { ...DEFAULT_AUTOMATION_TITLE_OVERLAY, mode: 'project', ...(studio.config?.titleOverlay || {}) };
  const dynamicText = { enabled: true, titleAnimation: 'rise', captionAnimation: 'word-pop', wordsPerPage: 5, ...(studio.config?.dynamicText || {}) };
  const videos = state.assets.video || [];
  const source = videos.find((video) => video.key === studio.sourceVideoKey);
  const latest = studio.outputs?.[0];
  const projects = studio.projects || [];
  const transcriptStatus = studio.transcript
    ? `${studio.lines.length} líneas · ${studio.transcript.languageCode || 'idioma detectado'}${studio.transcript.languageProbability ? ` · ${Math.round(studio.transcript.languageProbability * 100)}%` : ''} · Scribe v2 · ${fmtDate(studio.transcript.transcribedAt)}`
    : 'Todavía no se transcribió este video.';
  root.innerHTML = `<section class="automation-panel subtitler-project-panel">
    <div class="subtitler-project-copy"><h3>Proyecto de subtitulado</h3><span class="hint">Cada proyecto conserva su video, transcripción corregida, animaciones, estilos y renders.</span></div>
    <label><span>Proyecto guardado</span><select class="select" id="subProjectSelect">${projects.map((project) => `<option value="${esc(project.id)}"${project.id === studio.activeProjectId ? ' selected' : ''}>${esc(project.name)}${project.lineCount ? ` · ${project.lineCount} líneas` : ''}</option>`).join('')}</select></label>
    <label><span>Nombre</span><input type="text" id="subProjectName" maxlength="160" value="${esc(studio.name || '')}" placeholder="Nombre del proyecto"></label>
    <div class="subtitler-project-actions"><button type="button" class="mini-btn" id="subProjectNew">${IC('plus')} Nuevo</button><button type="button" class="mini-btn accent" id="subProjectSave">${IC('save')} Guardar proyecto</button><button type="button" class="mini-btn danger" id="subProjectDelete"${projects.length <= 1 ? ' disabled' : ''}>${IC('trash')} Borrar</button></div>
    <span class="subtitler-motion-badge${dynamicText.enabled ? ' active' : ''}">${IC('spark')} ${dynamicText.enabled ? 'Animaciones dinámicas activas' : 'Animaciones desactivadas'}</span>
  </section>
  <div class="subtitler-source-grid">
    <section class="automation-panel subtitler-source-panel">
      <div class="automation-panel-heading"><div><h3>1 · Video de origen</h3><span class="hint">Subí un video o elegí uno existente en Assets. El audio extraído será temporal.</span></div></div>
      <label><span>Video</span><select class="select" id="subSourceVideo"><option value="">— elegí un video —</option>${videos.map((video) => `<option value="${esc(video.key)}"${video.key === studio.sourceVideoKey ? ' selected' : ''}>${esc(video.name)}</option>`).join('')}</select></label>
      ${source ? `<video src="${fileUrl(source.key)}" controls preload="metadata"></video><span class="hint">${esc(source.name)}</span>` : '<div class="empty-note">Subí o elegí el video que querés subtitular.</div>'}
    </section>
    <section class="automation-panel subtitler-transcribe-panel">
      <div class="automation-panel-heading"><div><h3>2 · Interpretar audio</h3><span class="hint">ElevenLabs Scribe v2 detecta texto, idioma, hablantes y tiempos por palabra.</span></div></div>
      <div class="subtitler-transcribe-controls">
        <label><span>Idioma</span><select class="select" id="subLanguage"><option value=""${studio.languageCode ? '' : ' selected'}>Detectar automáticamente</option><option value="spa"${studio.languageCode === 'spa' ? ' selected' : ''}>Español</option><option value="eng"${studio.languageCode === 'eng' ? ' selected' : ''}>Inglés</option><option value="por"${studio.languageCode === 'por' ? ' selected' : ''}>Portugués</option></select></label>
        <label class="poser-toggle"><input type="checkbox" id="subNoVerbatim"${studio.noVerbatim !== false ? ' checked' : ''}> limpiar muletillas y falsos comienzos</label>
        <button type="button" class="generate-btn small" id="subTranscribe"${source ? '' : ' disabled'}>${IC('mic')} ${studio.transcript ? 'Volver a transcribir' : 'Extraer audio y transcribir'}</button>
      </div>
      <span class="automation-stage-status" id="subTranscriptStatus">${esc(transcriptStatus)}</span>
    </section>
  </div>
  <section class="automation-panel subtitler-lines-panel">
    <div class="automation-panel-heading"><div><h3>3 · Revisar líneas</h3><span class="hint">Corregí palabras, nombres y signos. También podés ajustar los tiempos de cada línea.</span></div><div class="subtitler-line-actions"><button type="button" class="mini-btn" id="subExportTxt"${studio.lines.length ? '' : ' disabled'}>${IC('download')} TXT</button><button type="button" class="mini-btn" id="subExportSrt"${studio.lines.length ? '' : ' disabled'}>${IC('download')} SRT</button><button type="button" class="mini-btn" id="subAddLine">${IC('plus')} Línea</button><button type="button" class="mini-btn accent" id="subSaveLines"${studio.lines.length ? '' : ' disabled'}>${IC('save')} Guardar correcciones</button></div></div>
    <div class="subtitler-lines">${studio.lines.length ? studio.lines.map(subtitlerLineMarkup).join('') : '<div class="empty-note">La transcripción construirá aquí todas las líneas editables.</div>'}</div>
  </section>
  <section class="automation-panel subtitler-style-panel">
    <div class="overlay-preset-bar"><div><h4>4 · Estilo de títulos y textos</h4><span class="hint">Los mismos presets y propiedades que usa el Automatizador.</span></div><select class="select" id="subPreset">${overlayPresetOptions()}</select><button type="button" class="mini-btn" id="subPresetApply" disabled>${IC('check')} Aplicar</button><button type="button" class="mini-btn accent" id="subPresetSave">${IC('save')} Guardar estilo actual</button><button type="button" class="mini-btn danger" id="subPresetDelete" disabled>${IC('trash')}</button></div>
    <div class="automation-dynamic-text-panel${dynamicText.enabled ? ' enabled' : ''}" id="subDynamicPanel"><div class="automation-dynamic-text-head"><div><h4>Texto dinámico · Remotion</h4><span class="hint">El mismo motor del Automatizador: título animado, avance palabra por palabra y resaltado sincronizado con el audio.</span></div><label class="poser-toggle"><input type="checkbox" id="subDynamicEnabled"${dynamicText.enabled ? ' checked' : ''}> activar animaciones</label></div><div class="automation-dynamic-text-grid">
      <label><span>Animación del título</span><select class="select" id="subTitleAnimation"><option value="rise"${dynamicText.titleAnimation === 'rise' ? ' selected' : ''}>Ascenso suave</option><option value="slam"${dynamicText.titleAnimation === 'slam' ? ' selected' : ''}>Impacto</option><option value="typewriter"${dynamicText.titleAnimation === 'typewriter' ? ' selected' : ''}>Máquina de escribir</option></select></label>
      <label><span>Animación de subtítulos</span><select class="select" id="subCaptionAnimation"><option value="word-pop"${dynamicText.captionAnimation === 'word-pop' ? ' selected' : ''}>Palabra con impacto</option><option value="karaoke"${dynamicText.captionAnimation === 'karaoke' ? ' selected' : ''}>Resaltado karaoke</option><option value="bounce"${dynamicText.captionAnimation === 'bounce' ? ' selected' : ''}>Rebote</option></select></label>
      <label><span>Palabras visibles por grupo</span><input type="number" id="subWordsPerPage" min="1" max="12" value="${dynamicText.wordsPerPage}"></label>
    </div></div>
    <h4>Texto sobreimpreso</h4><div class="overlay-typography-grid">${subtitlerTypeCard('normal', ov)}${subtitlerTypeCard('highlight', ov)}</div>
    <div class="overlay-layout-controls"><label><span>Posición vertical</span><select class="select" id="subOvPos">${[['top', 'Arriba'], ['center', 'Centro'], ['bottom', 'Abajo']].map(([value, label]) => `<option value="${value}"${value === ov.position ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Alineación</span><select class="select" id="subOvAlign">${[['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']].map(([value, label]) => `<option value="${value}"${value === ov.align ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Ancho máximo · %</span><input type="number" id="subOvMaxWidth" min="20" max="100" value="${ov.maxWidthPct || 88}"></label><button type="button" class="mini-btn" id="subOvCenter">Centrar horizontalmente</button><label class="poser-toggle"><input type="checkbox" id="subOvBg"${ov.bg ? ' checked' : ''}> caja de fondo</label></div>
    <div class="title-overlay-panel${titleOv.enabled ? ' enabled' : ''}" id="subTitlePanel"><div class="title-overlay-heading"><div><h4>Título</h4><span class="hint">Opcional; no altera la transcripción.</span></div><label class="poser-toggle"><input type="checkbox" id="subTitleEnabled"${titleOv.enabled ? ' checked' : ''}> incluir título</label></div><label><span>Texto del título</span><input type="text" id="subTitleText" maxlength="300" value="${esc(titleOv.text || '')}" placeholder="Título del video"></label><div class="overlay-typography-grid single">${subtitlerTypeCard('title', titleOv)}</div><div class="overlay-layout-controls"><label><span>Posición vertical</span><select class="select" id="subTitlePos">${[['top', 'Arriba'], ['center', 'Centro'], ['bottom', 'Abajo']].map(([value, label]) => `<option value="${value}"${value === titleOv.position ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Alineación</span><select class="select" id="subTitleAlign">${[['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']].map(([value, label]) => `<option value="${value}"${value === titleOv.align ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Ancho máximo · %</span><input type="number" id="subTitleMaxWidth" min="20" max="100" value="${titleOv.maxWidthPct || 88}"></label><button type="button" class="mini-btn" id="subTitleCenter">Centrar horizontalmente</button><label class="poser-toggle"><input type="checkbox" id="subTitleBg"${titleOv.bg ? ' checked' : ''}> caja de fondo</label></div></div>
    <input type="file" id="subFontFile" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden>
    <div class="ov-preview subtitler-preview" id="subPreview" style="aspect-ratio:${source ? '9/16' : '9/16'}">${source ? `<video class="ov-preview-bg" src="${fileUrl(source.key)}" muted loop autoplay playsinline></video>` : ''}<div class="ov-title" id="subPreviewTitle">${esc(titleOv.text || '')}</div><div class="ov-text" id="subPreviewText"><span class="ov-normal">Un texto de </span><span class="ov-hl">ejemplo</span><span class="ov-normal"> dinámico acá</span></div></div>
  </section>
  <section class="automation-panel subtitler-render-panel"><div><h3>5 · Generar video subtitulado</h3><p>Conserva el video y su audio; sólo añade la capa de título y subtítulos. Las correcciones actuales se usan en el render.</p><span class="hint" id="subRenderStatus">${latest ? `Último render · ${latest.wordCount} palabras · ${fmtDate(latest.renderedAt)}` : 'Todavía no hay una versión renderizada.'}</span></div><button type="button" class="generate-btn" id="subRender"${source && studio.lines.length ? '' : ' disabled'}>${IC('film')} Renderizar subtítulos</button>${latest ? `<div class="final-assembly-preview"><video src="${fileUrl(latest.videoKey)}" controls preload="metadata"></video><button type="button" class="mini-btn" data-open-asset="${esc(latest.videoKey)}">Abrir resultado</button></div>` : ''}</section>`;

  const preview = $('#subPreview'), previewText = $('#subPreviewText'), previewTitle = $('#subPreviewTitle');
  const updatePreview = () => {
    applySubtitlePreviewStyles({ preview, text: previewText, titleText: previewTitle, overlay: ov, titleOverlay: titleOv, visibleTitle: titleOv.text || 'Título del video' });
    $('#subDynamicPanel').classList.toggle('enabled', dynamicText.enabled);
    $('#subTitlePanel').classList.toggle('enabled', titleOv.enabled);
    const motionBadge = root.querySelector('.subtitler-motion-badge');
    motionBadge?.classList.toggle('active', dynamicText.enabled);
    if (motionBadge) motionBadge.innerHTML = `${IC('spark')} ${dynamicText.enabled ? 'Animaciones dinámicas activas' : 'Animaciones desactivadas'}`;
  };
  const config = () => ({ overlay: ov, titleOverlay: titleOv, dynamicText });
  const persistConfig = () => saveSubtitler({ config: config() });
  const projectSnapshot = () => ({
    name: $('#subProjectName').value.trim() || studio.name || 'Proyecto de subtítulos',
    lines: readSubtitlerLines(root, studio.lines),
    config: config()
  });
  $('#subProjectSelect').addEventListener('change', async (event) => {
    const nextId = event.target.value;
    try {
      await saveSubtitler(projectSnapshot());
      state.subtitler = await api(`/api/subtitler/projects/${nextId}/open`, { method: 'POST', task: false });
      renderSubtitler();
    } catch (error) { toast(error.message, 'err'); }
  });
  $('#subProjectName').addEventListener('change', async () => {
    try { await saveSubtitler({ name: $('#subProjectName').value.trim() || studio.name }, { rerender: true }); }
    catch (error) { toast(error.message, 'err'); }
  });
  $('#subProjectSave').addEventListener('click', async () => {
    try { await saveSubtitler(projectSnapshot()); toast('Proyecto de subtitulado guardado.', 'ok'); }
    catch (error) { toast(error.message, 'err'); }
  });
  $('#subProjectNew').addEventListener('click', async () => {
    const name = window.prompt('Nombre del nuevo proyecto de subtitulado:', 'Nuevo proyecto');
    if (!name?.trim()) return;
    try {
      await saveSubtitler(projectSnapshot());
      state.subtitler = await api('/api/subtitler/projects', { method: 'POST', body: { name: name.trim() }, task: false });
      renderSubtitler();
      toast('Nuevo proyecto de subtitulado creado.', 'ok');
    } catch (error) { toast(error.message, 'err'); }
  });
  $('#subProjectDelete').addEventListener('click', async () => {
    if (!confirm(`¿Borrar el proyecto “${studio.name}”? Los videos de Assets no se eliminarán.`)) return;
    try {
      state.subtitler = await api(`/api/subtitler/projects/${studio.activeProjectId}`, { method: 'DELETE', task: false });
      renderSubtitler();
      toast('Proyecto de subtitulado eliminado.');
    } catch (error) { toast(error.message, 'err'); }
  });
  const bind = (id, target, prop, transform = (value) => value) => {
    const element = $('#' + id);
    element.addEventListener('input', () => { target[prop] = transform(element.type === 'checkbox' ? element.checked : element.value); updatePreview(); });
    element.addEventListener('change', persistConfig);
  };
  bind('subDynamicEnabled', dynamicText, 'enabled'); bind('subTitleAnimation', dynamicText, 'titleAnimation'); bind('subCaptionAnimation', dynamicText, 'captionAnimation'); bind('subWordsPerPage', dynamicText, 'wordsPerPage', (value) => Math.max(1, Math.min(12, Number(value) || 5)));
  [['subOvFont', 'font'], ['subOvSize', 'fontSizePx', Number], ['subOvWeight', 'fontWeight', Number], ['subOvTransform', 'textTransform'], ['subOvItalic', 'fontItalic'], ['subOvUnderline', 'fontUnderline'], ['subOvStrike', 'fontStrikeThrough'], ['subOvColor', 'color'], ['subOvStroke', 'strokeColor'], ['subOvStrokeW', 'strokeWidthPx', Number], ['subOvHlFont', 'highlightFont'], ['subOvHlSize', 'highlightFontSizePx', Number], ['subOvHlWeight', 'highlightFontWeight', Number], ['subOvHlTransform', 'highlightTextTransform'], ['subOvHlItalic', 'highlightFontItalic'], ['subOvHlUnderline', 'highlightFontUnderline'], ['subOvHlStrike', 'highlightFontStrikeThrough'], ['subOvHlColor', 'highlightColor'], ['subOvHlStroke', 'highlightStrokeColor'], ['subOvHlStrokeW', 'highlightStrokeWidthPx', Number], ['subOvAlign', 'align'], ['subOvMaxWidth', 'maxWidthPct', Number], ['subOvBg', 'bg']].forEach(([id, prop, transform]) => bind(id, ov, prop, transform));
  [['subTitleEnabled', 'enabled'], ['subTitleText', 'text'], ['subTitleFont', 'font'], ['subTitleSize', 'fontSizePx', Number], ['subTitleWeight', 'fontWeight', Number], ['subTitleTransform', 'textTransform'], ['subTitleItalic', 'fontItalic'], ['subTitleUnderline', 'fontUnderline'], ['subTitleStrike', 'fontStrikeThrough'], ['subTitleColor', 'color'], ['subTitleStroke', 'strokeColor'], ['subTitleStrokeW', 'strokeWidthPx', Number], ['subTitleAlign', 'align'], ['subTitleMaxWidth', 'maxWidthPct', Number], ['subTitleBg', 'bg']].forEach(([id, prop, transform]) => bind(id, titleOv, prop, transform));
  const setPosition = (selectId, target, top, bottom) => { target.position = $('#' + selectId).value; target.y = target.position === 'top' ? top : target.position === 'center' ? 50 : bottom; target.x = 50; updatePreview(); persistConfig(); };
  $('#subOvPos').addEventListener('change', () => setPosition('subOvPos', ov, 12, 88));
  $('#subTitlePos').addEventListener('change', () => setPosition('subTitlePos', titleOv, 14, 86));
  $('#subOvCenter').addEventListener('click', () => { ov.x = 50; updatePreview(); persistConfig(); });
  $('#subTitleCenter').addEventListener('click', () => { titleOv.x = 50; updatePreview(); persistConfig(); });

  $('#subSourceVideo').addEventListener('change', async (event) => {
    const picked = videos.find((video) => video.key === event.target.value);
    await saveSubtitler({ sourceVideoKey: picked?.key || '', sourceName: picked?.name || '', transcript: null, lines: [] }, { rerender: true });
  });
  $('#subTranscribe').addEventListener('click', async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try {
      state.subtitler = await api('/api/subtitler/transcribe', { method: 'POST', body: { projectId: studio.activeProjectId, sourceVideoKey: studio.sourceVideoKey, languageCode: $('#subLanguage').value, noVerbatim: $('#subNoVerbatim').checked } });
      renderSubtitler(); toast('Transcripción terminada. Revisá las líneas antes de renderizar.', 'ok');
    } catch (error) { button.disabled = false; toast(error.message, 'err'); }
  });
  const saveLines = async () => { studio.lines = readSubtitlerLines(root, studio.lines); await saveSubtitler({ lines: studio.lines }); toast('Correcciones guardadas.'); };
  $('#subSaveLines').addEventListener('click', saveLines);
  $('#subExportTxt').addEventListener('click', () => {
    const lines = readSubtitlerLines(root, studio.lines);
    if (!lines.length) return toast('No hay líneas para exportar.', 'err');
    downloadSubtitleFile({
      name: $('#subProjectName').value.trim() || studio.name,
      extension: 'txt',
      mime: 'text/plain',
      content: lines.map((line) => line.text).join('\r\n')
    });
    toast('Subtítulos exportados en TXT.', 'ok');
  });
  $('#subExportSrt').addEventListener('click', () => {
    const lines = readSubtitlerLines(root, studio.lines);
    if (!lines.length) return toast('No hay líneas para exportar.', 'err');
    downloadSubtitleFile({
      name: $('#subProjectName').value.trim() || studio.name,
      extension: 'srt',
      mime: 'application/x-subrip',
      content: lines.map((line, index) => `${index + 1}\r\n${subtitleSrtTime(line.start)} --> ${subtitleSrtTime(line.end)}\r\n${line.text}`).join('\r\n\r\n') + '\r\n'
    });
    toast('Subtítulos exportados en SRT.', 'ok');
  });
  root.querySelectorAll('[data-sub-remove-line]').forEach((button) => button.addEventListener('click', async () => { button.closest('[data-sub-line]').remove(); await saveLines(); renderSubtitler(); }));
  $('#subAddLine').addEventListener('click', async () => { const last = studio.lines.at(-1); studio.lines.push({ id: `line-${Date.now()}`, start: last?.end || 0, end: (last?.end || 0) + 2, text: 'Nueva línea', sourceText: '', sourceWords: [] }); await saveSubtitler({ lines: studio.lines }, { rerender: true }); });
  $('#subRender').addEventListener('click', async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const lines = readSubtitlerLines(root, studio.lines);
      state.subtitler = await api('/api/subtitler/render', { method: 'POST', body: { projectId: studio.activeProjectId, sourceVideoKey: studio.sourceVideoKey, lines, config: config() } });
      await refreshAssets(); renderSubtitler(); toast('Video subtitulado terminado.', 'ok');
    } catch (error) { button.disabled = false; toast(error.message, 'err'); }
  });
  $('#subPreset').addEventListener('change', (event) => { const enabled = Boolean(event.target.value); $('#subPresetApply').disabled = !enabled; $('#subPresetDelete').disabled = !enabled; });
  $('#subPresetApply').addEventListener('click', async () => { const preset = state.overlayPresets.find((item) => item.id === $('#subPreset').value); if (!preset) return; Object.assign(ov, preset.overlay || {}); Object.assign(titleOv, preset.titleOverlay || {}); Object.assign(dynamicText, preset.dynamicText || {}); await saveSubtitler({ config: config() }, { rerender: true }); });
  $('#subPresetSave').addEventListener('click', async () => { const name = window.prompt('Nombre para este estilo de títulos y textos:'); if (!name?.trim()) return; const item = await api('/api/overlay-presets', { method: 'POST', body: { name: name.trim(), overlay: ov, titleOverlay: titleOv, dynamicText } }); state.overlayPresets.unshift(item); renderSubtitler(); toast(`Estilo “${item.name}” guardado.`); });
  $('#subPresetDelete').addEventListener('click', async () => { const preset = state.overlayPresets.find((item) => item.id === $('#subPreset').value); if (!preset || !confirm(`¿Borrar el estilo “${preset.name}”?`)) return; await api(`/api/overlay-presets/${preset.id}`, { method: 'DELETE' }); state.overlayPresets = state.overlayPresets.filter((item) => item.id !== preset.id); renderSubtitler(); });
  let fontTarget = 'normal';
  root.querySelectorAll('[data-sub-import-font]').forEach((button) => button.addEventListener('click', () => { fontTarget = button.dataset.subImportFont; $('#subFontFile').value = ''; $('#subFontFile').click(); }));
  $('#subFontFile').addEventListener('change', async (event) => { const file = event.target.files?.[0]; if (!file) return; const font = await api('/api/fonts', { method: 'POST', body: { fileName: file.name, name: file.name.replace(/\.[^.]+$/, ''), dataUrl: await readFileAsDataUrl(file) } }); state.fonts.unshift(font); await registerCustomFont(font); if (fontTarget === 'title') titleOv.font = font.family; else if (fontTarget === 'highlight') ov.highlightFont = font.family; else ov.font = font.family; await saveSubtitler({ config: config() }, { rerender: true }); });
  const makeDraggable = (element, target) => { let dragging = false; element.addEventListener('pointerdown', (event) => { dragging = true; element.setPointerCapture(event.pointerId); event.preventDefault(); }); element.addEventListener('pointermove', (event) => { if (!dragging) return; const rect = preview.getBoundingClientRect(); target.x = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)); target.y = Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)); updatePreview(); }); const end = () => { if (!dragging) return; dragging = false; persistConfig(); }; element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end); };
  makeDraggable(previewText, ov); makeDraggable(previewTitle, titleOv);
  const previewVideo = preview.querySelector('video');
  previewVideo?.addEventListener('loadedmetadata', () => {
    if (previewVideo.videoWidth && previewVideo.videoHeight) {
      preview.style.aspectRatio = `${previewVideo.videoWidth}/${previewVideo.videoHeight}`;
      updatePreview();
    }
  });
  bindAutomationAssetOpeners(root);
  requestAnimationFrame(updatePreview);
  if (window.ResizeObserver) new ResizeObserver(updatePreview).observe(preview);
}

$('#subtitlerUpload').addEventListener('click', () => { $('#subtitlerVideoInput').value = ''; $('#subtitlerVideoInput').click(); });
$('#subtitlerVideoInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) return toast('El video supera el límite de 100 MB.', 'err');
  try {
    const uploaded = await api('/api/assets/visual', { method: 'POST', body: { name: file.name, dataUrl: await readFileAsDataUrl(file), category: 'Subtitulador', tags: ['subtitulado'] } });
    await refreshAssets();
    await saveSubtitler({ sourceVideoKey: uploaded.key, sourceName: uploaded.name, transcript: null, lines: [] }, { rerender: true });
    toast('Video cargado. Ya podés extraer el audio y transcribirlo.', 'ok');
  } catch (error) { toast(error.message, 'err'); }
});

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
    const model = currentVideoModel();
    if (model?.provider === 'heygen') {
      if (state.video.heygenAuthMode === 'oauth') {
        el.textContent = 'incluido según tu plan HeyGen';
      } else {
        const seconds = Math.max(1, Math.ceil(promptBox.value.trim().length / 14));
        const amount = seconds * Number(model.apiPricePerSecond || 0);
        el.textContent = `≈ $${amount.toFixed(3)} (~${seconds}s)`;
      }
      return;
    }
    const t = state.pricing.video?.[state.video.modelId] || {};
    const perSec = t[state.video.resolution] ?? Object.values(t)[0] ?? 0;
    const p = perSec * state.video.duration;
    el.textContent = p ? `≈ $${p.toFixed(3)} (${state.video.duration}s)` : '';
  } else if (state.mode === 'music') {
    const perTrack = state.pricing.music?.perTrack ?? 0;
    el.textContent = perTrack ? `≈ $${(perTrack * 2).toFixed(3)} (2 variantes)` : '';
  } else if (state.mode === 'comfyui') {
    el.textContent = 'Gratis (tu ComfyUI local)';
  } else {
    const per1k = state.pricing.audio?.[state.audioModelId]?.per1kChars
      ?? state.pricing.audio?.['eleven-v3']?.per1kChars
      ?? 0;
    const chars = promptBox.value.length;
    el.textContent = chars
      ? `≈ $${((chars / 1000) * per1k).toFixed(3)} (${chars} car.)`
      : `$${per1k.toFixed(2)} / 1k caracteres`;
  }
}

const fmtUsd = (n) => `$${(n || 0).toFixed(n >= 10 ? 2 : 3)}`;

function renderProjectCostEstimate(projects) {
  const root = $('#costProjectEstimate');
  if (!root) return;
  if (!projects?.length) {
    root.innerHTML = '<h3>Estimación por proyecto</h3><div class="empty-note" style="padding:8px 0">Todavía no hay proyectos del Automatizador.</div>';
    return;
  }
  const selected = projects.find((project) => project.id === state.costProjectId) || projects[0];
  state.costProjectId = selected.id;
  const detail = selected.breakdown;
  const extraSpent = selected.spent > selected.estimatedTotal + 0.000001;
  root.innerHTML = `
    <div class="cost-project-head">
      <div>
        <h3>Coste estimado por proyecto</h3>
        <span class="hint">Se muestra el proyecto más reciente por defecto. Elegí otro para consultar su estimación.</span>
      </div>
      <label>Proyecto
        <select class="select" id="costProjectSelect">
          ${projects.map((project, index) => `<option value="${esc(project.id)}"${project.id === selected.id ? ' selected' : ''}>${index === 0 ? 'Último · ' : ''}${esc(project.name)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="project-cost-title">
      <strong>${esc(selected.name)}</strong>
      <span class="hint">${esc(selected.modelName)} · ${esc(selected.resolution)} · ${esc(selected.aspectRatio || 'proporción automática')} · actualizado ${fmtDate(selected.updatedAt || selected.ts)}</span>
    </div>
    <div class="project-cost-summary">
      <div class="project-cost-stat">
        <span>Producción completa estimada</span>
        <strong>${fmtUsd(selected.estimatedTotal)}</strong>
      </div>
      <div class="project-cost-stat">
        <span>Consumo ya vinculado</span>
        <strong>${fmtUsd(selected.spent)}</strong>
      </div>
      <div class="project-cost-stat">
        <span>Material previsto</span>
        <strong>${detail.resourceImages + detail.blockImages} imágenes · ${detail.audioItems} voces${detail.h3Blocks ? ` · ${detail.h3Blocks} toma${detail.h3Blocks === 1 ? '' : 's'} H3` : ''}${detail.seedance25Blocks ? ` · ${detail.seedance25Blocks} toma${detail.seedance25Blocks === 1 ? '' : 's'} Seedance 2.5` : ''}${detail.omniBlocks ? ` · ${detail.omniBlocks} toma${detail.omniBlocks === 1 ? '' : 's'} Omni` : ''}${detail.musicEnabled ? ' · 1 música' : ''}</strong>
      </div>
    </div>
    <div class="project-cost-breakdown">
      <div class="cost-row">
        <span class="cr-label">Fichas de personajes, fondos y objetos<span class="cr-sub">${detail.resourceImages} × ${esc(selected.modelName)} ${esc(detail.resourceResolution)}</span></span>
        <span class="cr-value">${fmtUsd(detail.resourceImageCost)}</span>
      </div>
      <div class="cost-row">
        <span class="cr-label">Imágenes de los bloques<span class="cr-sub">${detail.blockImages} × ${esc(selected.modelName)} ${esc(detail.blockResolution)}</span></span>
        <span class="cr-value">${fmtUsd(detail.blockImageCost)}</span>
      </div>
      <div class="cost-row">
        <span class="cr-label">Voces de narración y diálogo<span class="cr-sub">${detail.audioItems} audios · ${detail.audioCharacters.toLocaleString('es-AR')} caracteres · ${esc(detail.audioModelName || 'ElevenLabs')}</span></span>
        <span class="cr-value">${fmtUsd(detail.audioCost)}</span>
      </div>
      ${detail.h3Blocks ? `<div class="cost-row">
        <span class="cr-label">Video generativo MiniMax H3<span class="cr-sub">${detail.h3Blocks} bloque${detail.h3Blocks === 1 ? '' : 's'} · ~${Math.round(detail.h3EstimatedSeconds || 0)} segundos facturables · resolución según cada bloque</span></span>
        <span class="cr-value">${fmtUsd(detail.h3VideoCost)}</span>
      </div>` : ''}
      ${detail.seedance25Blocks ? `<div class="cost-row">
        <span class="cr-label">Video generativo Seedance 2.5<span class="cr-sub">${detail.seedance25Blocks} bloque${detail.seedance25Blocks === 1 ? '' : 's'} · ~${Math.round(detail.seedance25EstimatedSeconds || 0)} segundos facturables · resolución según cada bloque</span></span>
        <span class="cr-value">${fmtUsd(detail.seedance25VideoCost)}</span>
      </div>` : ''}
      ${detail.omniBlocks ? `<div class="cost-row">
        <span class="cr-label">Video generativo Gemini Omni<span class="cr-sub">${detail.omniBlocks} bloque${detail.omniBlocks === 1 ? '' : 's'} · ~${Math.round(detail.omniEstimatedSeconds || 0)} segundos facturables · resolución según cada bloque</span></span>
        <span class="cr-value">${fmtUsd(detail.omniVideoCost)}</span>
      </div>` : ''}
      ${detail.musicEnabled ? `<div class="cost-row">
        <span class="cr-label">Música de fondo<span class="cr-sub">${detail.musicSource === 'suno' ? `${detail.generatedMusicTracks} variantes generadas con Suno` : detail.musicSource === 'auto' ? 'Selección automática desde Assets' : 'Pista existente de Assets'}</span></span>
        <span class="cr-value">${fmtUsd(detail.musicCost)}</span>
      </div>` : ''}
      <div class="cost-row">
        <span class="cr-label">Ensamble, subtítulos y posproducción<span class="cr-sub">Procesamiento local con FFmpeg y Remotion</span></span>
        <span class="cr-value">${fmtUsd(detail.localVideoCost)}</span>
      </div>
    </div>
    <p class="hint project-cost-note">${extraSpent
      ? 'El consumo vinculado supera la estimación base porque incluye regeneraciones, reintentos o modelos alternativos.'
      : 'Estimación calculada con el modelo principal y las tarifas vigentes. Regeneraciones, reintentos y el modelo de respaldo pueden aumentarla.'}</p>`;
  $('#costProjectSelect')?.addEventListener('change', (event) => {
    state.costProjectId = event.target.value;
    renderProjectCostEstimate(projects);
  });
}

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

  renderProjectCostEstimate(data.projects || []);

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
  for (const [modelId, table] of Object.entries(data.pricing.audio || {})) {
    const name = (state.audioModels || []).find((model) => model.id === modelId)?.name || modelId;
    rows += `<div class="pricing-row"><span class="pr-name">${esc(name)}</span>
      <label class="pr-unit">1k car. <input type="number" step="0.001" min="0" data-audio-model="${esc(modelId)}" value="${table.per1kChars}"></label>
      <span class="pr-unit">USD/1000 caracteres</span></div>`;
  }
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
  const audio = {};
  $$('#pricingTable input[data-audio-model]').forEach((input) => {
    audio[input.dataset.audioModel] = { per1kChars: Number(input.value) || 0 };
  });
  try {
    state.pricing = await api('/api/pricing', {
      method: 'PUT',
      body: { image, video, audio }
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
  f.key_wavespeed.value = c.keys.wavespeed || '';
  f.key_elevenlabs.value = c.keys.elevenlabs || '';
  f.key_openai.value = c.keys.openai || '';
  f.key_minimax.value = c.keys.minimax || '';
  f.key_suno.value = c.keys.suno || '';
  f.key_heygen.value = c.keys.heygen || '';
  f.openaiModel.value = c.openaiModel || 'gpt-5-mini';
  f.path_generated.value = c.paths.generated || '';
  f.path_uploads.value = c.paths.uploads || '';
  f.path_audio.value = c.paths.audio || '';
  f.path_video.value = c.paths.video || '';
  f.seedreamModelId.value = c.seedreamModelId || '';
  f.seedreamProModelId.value = c.seedreamProModelId || '';
  f.fireRedModelId.value = c.fireRedModelId || '';
  f.seedance25ModelId.value = c.seedance25ModelId || '';
  f.seedanceModelId.value = c.seedanceModelId || '';
  f.seedanceMiniModelId.value = c.seedanceMiniModelId || '';
  f.sunoModelId.value = c.sunoModelId || 'V5_5';
  f.endpoint_ark.value = c.endpoints.ark || '';
  f.endpoint_wavespeed.value = c.endpoints.wavespeed || '';
  f.endpoint_suno.value = c.endpoints.suno || '';
  f.endpoint_minimax.value = c.endpoints.minimax || '';
  f.poserPrompt.value = c.poserPrompt || '';
  f.photoshopPath.value = c.photoshopPath || '';
  f.ffmpegPath.value = c.ffmpegPath || '';
  f.nsfwEnabled.checked = Boolean(c.nsfwEnabled);
  f.nsfwAdminPassword.value = '';
  f.nsfwUploadDefault.checked = Boolean(c.nsfwUploadDefault);
  f.comfyui_host.value = c.comfyui?.host || '127.0.0.1';
  f.comfyui_port.value = c.comfyui?.port || 8188;
  renderComfyWorkflowsList();
  renderConfigAudioTags();
  $('#accessStatus').textContent = c.accessProtected
    ? 'La aplicación está protegida. Escribí una nueva clave solo si querés cambiarla.'
    : 'Todavía no hay clave: establecé una de al menos 6 caracteres.';
}

async function loadHeyGenOAuthStatus(showError = false) {
  try {
    state.heygenOAuth = await api('/api/heygen/oauth/status');
  } catch (error) {
    state.heygenOAuth = { connected: false, localhostSupported: true, error: error.message };
    if (showError) toast(error.message, 'err');
  }
  const title = $('#heygenOauthTitle');
  const status = $('#heygenOauthStatus');
  if (title) title.textContent = state.heygenOAuth.connected ? 'HeyGen conectado' : 'HeyGen sin conectar';
  if (status) status.textContent = state.heygenOAuth.connected
    ? [state.heygenOAuth.account?.email || state.heygenOAuth.account?.name, state.heygenOAuth.account?.billingType].filter(Boolean).join(' · ') || 'Sesión OAuth activa'
    : state.heygenOAuth.error || 'Usa tu plan web de HeyGen. El retorno OAuth funciona en localhost.';
  if ($('#heygenOauthConnect')) $('#heygenOauthConnect').textContent = state.heygenOAuth.connected ? 'Reconectar' : 'Conectar HeyGen';
  if ($('#heygenOauthDisconnect')) $('#heygenOauthDisconnect').hidden = !state.heygenOAuth.connected;
  if (state.mode === 'video' && currentVideoModel()?.provider === 'heygen') renderVideoControls();
}

$('#heygenOauthConnect').addEventListener('click', async () => {
  const popup = window.open('about:blank', 'manifestador-heygen-oauth', 'width=720,height=780');
  try {
    const result = await api('/api/heygen/oauth/start', { method: 'POST' });
    if (!popup) throw new Error('El navegador bloqueó la ventana OAuth. Habilitá popups para localhost.');
    popup.location = result.url;
  } catch (error) {
    popup?.close(); toast(error.message, 'err');
  }
});
$('#heygenOauthDisconnect').addEventListener('click', async () => {
  try { await api('/api/heygen/oauth/disconnect', { method: 'POST' }); await loadHeyGenOAuthStatus(); }
  catch (error) { toast(error.message, 'err'); }
});
window.addEventListener('message', async (event) => {
  if (event.origin !== location.origin || event.data?.type !== 'manifestador-heygen-oauth') return;
  if (event.data.ok) { await loadHeyGenOAuthStatus(); toast('HeyGen conectado con OAuth'); }
  else toast(event.data.detail || 'No se pudo conectar HeyGen', 'err');
});

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
      const body = service === 'comfyui'
        ? { service, comfyui: { host: f.comfyui_host.value.trim(), port: Number(f.comfyui_port.value) || undefined } }
        : { service, key: f[`key_${service}`].value.trim() };
      if (service === 'ark') {
        body.endpoint = f.endpoint_ark.value.trim();
        body.seedreamModelId = f.seedreamModelId.value.trim();
      }
      if (service === 'wavespeed') body.endpoint = f.endpoint_wavespeed.value.trim();
      if (service === 'suno') body.endpoint = f.endpoint_suno.value.trim();
      if (service === 'minimax') body.endpoint = f.endpoint_minimax.value.trim();
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
    const previousNsfwEnabled = Boolean(state.config?.nsfwEnabled);
    if (previousNsfwEnabled !== f.nsfwEnabled.checked && !f.nsfwAdminPassword.value) {
      return toast('Ingresá la contraseña administrativa para cambiar el acceso NSFW.', 'err');
    }
    state.config = await api('/api/config', {
      method: 'PUT',
      body: {
        keys: {
          gemini: f.key_gemini.value.trim(),
          googleTranslate: f.key_googleTranslate.value.trim(),
          ark: f.key_ark.value.trim(),
          wavespeed: f.key_wavespeed.value.trim(),
          elevenlabs: f.key_elevenlabs.value.trim(),
          openai: f.key_openai.value.trim(),
          minimax: f.key_minimax.value.trim(),
          suno: f.key_suno.value.trim(),
          heygen: f.key_heygen.value.trim()
        },
        openaiModel: f.openaiModel.value.trim() || 'gpt-5-mini',
        paths: {
          generated: f.path_generated.value.trim(),
          uploads: f.path_uploads.value.trim(),
          audio: f.path_audio.value.trim(),
          video: f.path_video.value.trim()
        },
        endpoints: {
          ark: f.endpoint_ark.value.trim(),
          wavespeed: f.endpoint_wavespeed.value.trim(),
          suno: f.endpoint_suno.value.trim(),
          minimax: f.endpoint_minimax.value.trim()
        },
        seedreamModelId: f.seedreamModelId.value.trim(),
        seedreamProModelId: f.seedreamProModelId.value.trim(),
        fireRedModelId: f.fireRedModelId.value.trim(),
        seedance25ModelId: f.seedance25ModelId.value.trim(),
        seedanceModelId: f.seedanceModelId.value.trim(),
        seedanceMiniModelId: f.seedanceMiniModelId.value.trim(),
        sunoModelId: f.sunoModelId.value.trim() || 'V5_5',
        poserPrompt: f.poserPrompt.value.trim(),
        photoshopPath: f.photoshopPath.value.trim(),
        ffmpegPath: f.ffmpegPath.value.trim(),
        nsfwEnabled: f.nsfwEnabled.checked,
        nsfwAdminPassword: f.nsfwAdminPassword.value,
        nsfwUploadDefault: f.nsfwUploadDefault.checked,
        comfyui: {
          host: f.comfyui_host.value.trim(),
          port: Number(f.comfyui_port.value) || 8188
        },
        accessPassword: f.accessPassword.value
      }
    });
    renderTagPalette();
    f.accessPassword.value = '';
    f.accessPasswordConfirm.value = '';
    fillConfigForm();
    if (previousNsfwEnabled !== Boolean(state.config.nsfwEnabled)) location.reload();
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
    state.audioModels = s.audioModels || (s.audioModel ? [s.audioModel] : []);
    state.audioModelId = state.audioModels.some((model) => model.id === s.config?.audioModelId)
      ? s.config.audioModelId
      : (state.audioModels[0]?.id || 'eleven-v3');
    state.musicModel = s.musicModel || null;
    state.transitionSounds = s.transitionSounds || [];
    if (s.musicModel?.defaultVersion) state.music.version = s.config?.sunoModelId || s.musicModel.defaultVersion;
    state.characters = s.characters;
    state.prompts = s.prompts;
    state.vocabulary = s.vocabulary || [];
    state.vocabularyCategoriesExtra = s.vocabularyCategories || [];
    state.fonts = s.fonts || [];
    state.overlayPresets = s.overlayPresets || [];
    state.comfyuiWorkflows = s.comfyWorkflows || [];
    await registerCustomFonts(state.fonts);
    state.promptCategoriesExtra = s.promptCategories || {};
    state.snippets = s.snippets || [];
    state.snippetCategoriesExtra = s.snippetCategories || [];
    state.assetLinks = s.assetLinks || [];
    state.series = s.series || [];
    state.scripts = s.scripts || [];
    state.elements = s.elements || [];
    state.elementLinks = s.elementLinks || [];
    state.automations = s.automations || [];
    state.subtitler = s.subtitler || null;
    state.history = s.history;
    state.pricing = s.pricing;
    state.modelId = s.models[0]?.id;
    await loadHeyGenOAuthStatus(false);
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
  startAutomationSync();

  // deep-links: #audio, #assets, #characters, #series, #subtitler, #prompts, #vocabulary, #costs, #config
  const h = location.hash.slice(1);
  if (h === 'audio') setMode('audio');
  else if (['assets', 'characters', 'series', 'subtitler', 'prompts', 'vocabulary', 'snippets', 'costs', 'config'].includes(h)) {
    $(`.nav-btn[data-view="${h}"]`)?.click();
  }
}

init();

// ---------------------------------------------------------------------------
// puente para el módulo Poser (poser.js, ES module)
// ---------------------------------------------------------------------------

window.manifestadorBridge = {
  api, toast, esc, fileUrl, addRef, IC, readFileAsDataUrl, goToCreate,
  getState: () => state,
  setComfyPoseRef: (slot, key) => {
    state.comfyui.refs[slot] = key;
    setMode('comfyui');
  }
};
