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
      ? tr('create.placeholder.audioStable', {}, 'Escribí el texto a locutar… Multilingual v2 prioriza una narración estable')
      : tr('create.placeholder.audio', {}, 'Escribí el texto a locutar… usá [risas] o [whispers] para expresiones'))
    : mode === 'video'
    ? tr('create.placeholder.video', {}, 'Describí la escena en movimiento: acción, cámara, ambiente…')
    : mode === 'music'
    ? (state.music.customMode
      ? tr('create.placeholder.musicLyrics', {}, 'Escribí la LETRA de la canción (versos, estribillo)…')
      : tr('create.placeholder.musicSimple', {}, 'Describí la canción: género, ánimo, instrumentos, tema…'))
    : mode === 'comfyui'
    ? tr('create.placeholder.comfyui', {}, 'Escribí el prompt que va a recibir tu workflow de ComfyUI…')
    : tr('create.placeholder.image', {}, 'Escribí lo que querés manifestar…');
  const generateAction = mode === 'audio'
    ? [IC('mic'), tr('create.generate.audio', {}, 'Dar voz')]
    : mode === 'video'
      ? [IC('film'), tr('create.generate.video', {}, 'Manifestar video')]
      : mode === 'music'
        ? [IC('music'), tr('create.generate.music', {}, 'Componer')]
        : mode === 'comfyui'
          ? [IC('layers'), tr('create.generate.comfyui', {}, 'Manifestar (ComfyUI)')]
          : [IC('spark'), tr('create.generate.image', {}, 'Manifestar')];
  $('#btnGenerate').innerHTML = `${generateAction[0]} ${esc(generateAction[1])}`;
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
    ? (state.music.instrumental ? tr('create.music.hintInstrumental') : tr('create.music.hintCustom'))
    : tr('create.music.hintSimple');
  $('#promptBox').placeholder = state.music.customMode
    ? tr('create.placeholder.musicLyrics')
    : tr('create.placeholder.musicSimple');
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
  reference: { strip: '#comfyRefReference', titleKey: 'create.comfy.chooseReference' },
  poseControlNet: { strip: '#comfyRefPoseControlNet', titleKey: 'create.comfy.choosePose' },
  poseIpAdapter: { strip: '#comfyRefPoseIpAdapter', titleKey: 'create.comfy.chooseFace' }
};
const COMFY_SLOT_LABEL_KEYS = {
  prompt: 'create.comfy.slot.prompt', reference: 'create.comfy.slot.reference', poseControlNet: 'create.comfy.slot.pose', poseIpAdapter: 'create.comfy.slot.face',
  resolution: 'create.comfy.slot.resolution', outputImage: 'create.comfy.slot.imageOutput', outputVideo: 'create.comfy.slot.videoOutput', outputAudio: 'create.comfy.slot.audioOutput',
  customValues: 'create.comfy.slot.customValues'
};
const comfySlotLabel = (slot) => COMFY_SLOT_LABEL_KEYS[slot] ? tr(COMFY_SLOT_LABEL_KEYS[slot]) : slot;

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
  return Object.entries(wf?.requiredRefs || {})
    .filter(([slot, required]) => required && !state.comfyui.refs[slot])
    .map(([slot]) => comfySlotLabel(slot));
}

const COMFY_CV_MODES = [['fixed', 'create.comfy.mode.fixed'], ['increment', 'create.comfy.mode.increment'], ['random', 'create.comfy.mode.random']];

function renderComfyCustomValues() {
  const box = $('#comfyCustomValuesRow');
  const wf = state.comfyuiWorkflows.find((w) => w.id === state.comfyui.workflowId);
  const enabled = (wf?.customValues || []).map((cv, i) => ({ ...cv, i })).filter((cv) => cv.enabled);
  if (!enabled.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = enabled.map((cv) => {
    const st = state.comfyui.customValues[cv.i] || (state.comfyui.customValues[cv.i] = { mode: 'fixed', value: '' });
    return `<div class="comfy-cv-item">
      <label>${esc(cv.label || tr('create.comfy.value', { number: cv.i + 1 }))}</label>
      <input type="number" class="text-input" step="any" data-cv-value="${cv.i}" value="${esc(st.value)}" placeholder="0">
      <div class="chips comfy-cv-mode" data-cv-mode-group="${cv.i}">
        ${COMFY_CV_MODES.map(([mode, labelKey]) => `<button type="button" class="chip${st.mode === mode ? ' active' : ''}" data-mode="${mode}">${esc(tr(labelKey))}</button>`).join('')}
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
  if (!state.comfyui.loop) toast(tr('create.comfy.disabled'));
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
    add.title = tr('create.comfy.addImage');
    add.addEventListener('click', () => openComfyPicker(slot));
    el.appendChild(add);
  }
}

function openComfyPicker(slot) {
  state.comfyPickerSlot = slot;
  openPicker(null);
  $('#pickerTitle').textContent = tr(COMFY_REF_SLOTS[slot].titleKey);
}

function renderComfySlotsHint() {
  const hint = $('#comfySlotsHint');
  if (!state.comfyui.workflowId) { hint.textContent = tr('create.comfy.chooseWorkflow'); return; }
  const slots = state.comfyui.slots;
  if (!slots) { hint.textContent = tr('create.comfy.readFailed'); return; }
  const found = Object.entries(slots).filter(([, n]) => n > 0).map(([k]) => comfySlotLabel(k));
  hint.textContent = found.length ? tr('create.comfy.nodes', { nodes: found.join(', ') }) : tr('create.comfy.noNodes');
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
    box.innerHTML = `<div class="empty-note">${esc(tr('config.comfy.none'))}</div>`;
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
      <button type="button" class="mini-btn" data-act="scan">${esc(tr('config.comfy.detectNodes'))}</button>
      <button type="button" class="mini-btn" data-act="edit">${esc(tr('common.edit'))}</button>
      <button type="button" class="mini-btn danger" data-act="delete">${esc(tr('common.delete'))}</button>
    </div>
  </div>`).join('');
  box.querySelectorAll('.comfy-wf-item').forEach((row) => {
    const id = row.dataset.id;
    const wf = state.comfyuiWorkflows.find((w) => w.id === id);
    row.querySelector('[data-act="scan"]').addEventListener('click', async () => {
      const slotsEl = row.querySelector('.comfy-wf-slots');
      slotsEl.textContent = tr('config.comfy.scanning');
      try {
        const r = await api(`/api/comfyui/scan?id=${encodeURIComponent(id)}`, { task: false });
        const found = Object.entries(r.slots).filter(([, n]) => n > 0).map(([k]) => comfySlotLabel(k));
        slotsEl.textContent = found.length ? tr('config.comfy.nodesFound', { nodes: found.join(', ') }) : tr('config.comfy.noTuzziNodes');
      } catch (e) {
        slotsEl.textContent = `Error: ${e.message}`;
      }
    });
    row.querySelector('[data-act="edit"]').addEventListener('click', () => openComfyWorkflowForm(wf));
    row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!confirm(tr('config.comfy.deleteConfirm', { name: wf.name }))) return;
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
      <input type="text" class="text-input" data-cv-label="${i}" maxlength="60" placeholder="${esc(tr('config.comfy.customValuePlaceholder'))}" value="${esc(cv.label || '')}" ${cv.enabled ? '' : 'disabled'}>
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
  if (!path) return toast(tr('config.comfy.pathMissing'), 'err');
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
    toast(tr('config.comfy.saved'));
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
  const wanted = new Set(values.map((value) => value.toLocaleLowerCase(i18n.localeTag())));
  return text.split(matcher).map((part) => wanted.has(part.toLocaleLowerCase(i18n.localeTag()))
    ? `<span class="tag">${esc(part)}</span>`
    : esc(part)).join('');
}

function updateCharCount() {
  const el = $('#promptCharCount');
  if (!el) return;
  const n = promptBox.value.length;
  const count = i18n?.formatNumber(n) ?? n.toLocaleString(document.documentElement.lang || 'es-AR');
  el.textContent = tr(n === 1 ? 'create.characters.one' : 'create.characters.many', { count }, `${count} ${n === 1 ? 'carácter' : 'caracteres'}`);
}

function renderHighlight() {
  const text = promptBox.value;
  updateCharCount();
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
      ? `<span class="tag-chip custom"><button data-tag="${esc(t)}" title="${esc(tr('create.audio.insertExpression'))}">[${esc(t)}]</button><button class="tag-remove" data-remove-tag="${esc(t)}" title="${esc(tr('create.audio.deleteExpression'))}">×</button></span>`
      : `<button class="tag-chip" data-tag="${esc(t)}" title="${esc(tr('create.audio.nativeExpression'))}">[${esc(t)}]</button>`)
    .join('') + `<button class="tag-chip" data-tag="__custom">${esc(tr('create.audio.custom'))}</button>`;
  $$('#tagPalette [data-tag]').forEach((b) => {
    b.addEventListener('click', async () => {
      let tag = b.dataset.tag;
      if (tag === '__custom') {
        tag = window.prompt(tr('create.audio.customPrompt'), '');
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
  if (!text) return toast(tr('clipboard.promptMissing', {}, 'Este asset no tiene un prompt guardado'), 'err');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
  }
  toast(tr('clipboard.promptCopied', {}, 'Prompt copiado'));
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
    const localizedError = body.code && i18n?.has(`errors.${body.code}`)
      ? tr(`errors.${body.code}`, body.details || {})
      : body.error;
    if (!res.ok) throw new Error(localizedError || tr('login.failed', {}, 'No se pudo acceder'));
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
    toast(tr('create.audio.added', { tag }));
  } catch (e) {
    toast(tr('create.audio.saveFailed', { error: e.message }), 'err');
  }
}

async function removeCustomAudioTag(tag) {
  const customAudioTags = (state.config.customAudioTags || []).filter((x) => x !== tag);
  try {
    state.config = await api('/api/config', { method: 'PUT', body: { customAudioTags } });
    renderTagPalette();
    renderConfigAudioTags();
    toast(tr('create.audio.removed', { tag }));
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderConfigAudioTags() {
  const box = $('#configAudioTags');
  if (!box || !state.config) return;
  const custom = state.config.customAudioTags || [];
  box.innerHTML = AUDIO_TAGS.map((tag) => `<span class="manager-tag native" title="${esc(tr('config.audioExpressions.native'))}">[${esc(tag)}]</span>`).join('')
    + custom.map((tag) => `<span class="manager-tag custom">[${esc(tag)}]<button type="button" data-config-remove="${esc(tag)}" title="${esc(tr('common.delete'))}">×</button></span>`).join('');
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
  if (!text) return toast(tr('create.translate.empty'), 'err');
  const btn = target === 'en' ? $('#btnToEn') : $('#btnToEs');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '…';
  try {
    const { text: out } = await api('/api/translate', { method: 'POST', body: { text, target } });
    promptBox.value = out;
    renderHighlight();
    toast(tr(target === 'en' ? 'create.translate.englishDone' : 'create.translate.spanishDone'));
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

function localizedModelNote(model) {
  return model ? tr(`models.${model.id}.notes`, {}, model.notes || '') : '';
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

  $('#modelNote').textContent = localizedModelNote(m);
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
    (v) => tr(`create.video.mode.${v}`));
  $('#videoRefsHint').textContent = isHeyGen
    ? tr('create.video.refsHeygen')
    : isH3 && state.video.mode === 'reference'
    ? tr('create.video.refsH3')
    : isSeedance25 && state.video.mode === 'reference'
    ? tr('create.video.refsSeedance25')
    : isOmni && state.video.mode === 'reference'
    ? tr('create.video.refsOmni')
    : isOmni && state.video.mode === 'edit'
    ? (state.video.omniPreviousInteractionId ? tr('create.video.editLinked') : tr('create.video.editNew'))
    : isOmni && state.video.mode === 'extend'
    ? (state.video.omniPreviousInteractionId ? tr('create.video.extendLinked') : tr('create.video.extendNew'))
    : state.video.mode === 'reference'
    ? tr('create.video.refsDefault')
    : tr('create.video.framesHint');
  $('#videoRefsLabel').textContent = multimediaRefs ? tr('create.controls.references') : tr('create.controls.images');
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
      ? tr('create.video.omniLinked', {
        turn: state.video.omniChainDepth + 1,
        duration: state.video.omniCumulativeDuration ? tr('create.video.omniDuration', { seconds: state.video.omniCumulativeDuration }) : ''
      })
      : tr('create.video.omniNew');
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
      ? eligible.map((character) => `<option value="${character.id}">${esc(character.name)} · HeyGen · ${esc(tr(character.heygen?.closeAvatarId ? 'create.video.shots.two' : 'create.video.shots.one'))}</option>`).join('')
      : `<option value="">${esc(tr('create.video.noHeygenCharacters'))}</option>`;
    $('#heygenCharacterSelect').value = state.video.heygenCharacterId;
    $('#heygenCharacterHint').textContent = eligible.length
      ? tr('create.video.heygenCharactersHint')
      : tr('create.video.heygenCharactersEmpty');
    $('#heygenVoiceRow').hidden = false;
    $('#heygenMotionRow').hidden = !m.supportsMotion;
    $('#heygenAuthMode').value = state.video.heygenAuthMode;
    $('#heygenVoiceId').value = state.video.heygenVoiceId;
    $('#heygenMotionPrompt').value = state.video.heygenMotionPrompt;
    $('#heygenExpressiveness').value = state.video.heygenExpressiveness;
    $('#heygenVideoAuthStatus').textContent = state.video.heygenAuthMode === 'oauth'
      ? (state.heygenOAuth.connected ? tr('create.video.oauthConnected') : tr('create.video.oauthMissing'))
      : (state.config?.keys?.heygen ? tr('create.video.apiConfigured') : tr('create.video.apiMissing'));
    $('#promptBox').placeholder = tr('create.video.avatarPlaceholder');
  } else if (state.mode === 'video') {
    $('#promptBox').placeholder = tr('create.video.promptPlaceholder');
  }
  $('#videoModelNote').textContent = localizedModelNote(m);
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
    const badge = typedMultimedia && refMode === 'reference' ? `<button class="ref-at" title="${esc(tr('create.refs.insert', { mention: typedMention }))}">${kind === 'image' ? 'IMG' : kind === 'video' ? 'VID' : 'AUD'} ${typeNumber}</button>`
      : refMode === 'reference' ? `<button class="ref-at" title="${esc(tr('create.refs.insert', { mention: `@image${i + 1}` }))}">@${i + 1}</button>`
      : refMode === 'frames' ? `<span class="ref-badge">${esc(tr(i === 0 ? 'create.refs.start' : 'create.refs.end'))}</span>`
      : !isVideo && !isAsset ? `<button class="ref-at" title="${esc(tr('create.refs.insert', { mention }))}">${esc(mention)}</button>`
      : '';
    d.innerHTML = isAsset
      ? `<div class="asset-face" title="${esc(r.key)}">${IC('user', 'ic ic-lg')}<span>${esc(tr('create.refs.verified'))}</span></div>${badge}<button class="rm" title="${esc(tr('create.refs.remove'))}">×</button>`
      : `${kind === 'video' ? `<video src="${fileUrl(r.key)}" muted preload="metadata"></video>`
        : kind === 'audio' ? `<div class="asset-face" title="${esc(r.key)}">${IC('mic', 'ic ic-lg')}<span>${esc(tr('create.refs.audio'))}</span></div>`
          : `<img src="${fileUrl(r.key)}" alt="">`}${kind === 'image' && r.label ? `<span class="ref-label-tag" title="${esc(tr('create.refs.labelVisible'))}">${esc(r.label)}</span>` : ''}${badge}<button class="rm" title="${esc(tr('create.refs.remove'))}">×</button>${kind === 'image' ? `<button class="ref-replace" title="${esc(tr('create.refs.replace'))}">${IC('refresh')}</button><button class="ref-label-btn${r.label ? ' on' : ''}" title="${esc(r.label ? tr('create.refs.label', { label: r.label }) : tr('create.refs.addLabel'))}">T</button>` : ''}`;
    d.querySelector('.rm').addEventListener('click', () => {
      state.refs.splice(i, 1);
      renderRefs();
      renderHighlight();
    });
    d.querySelector('.ref-replace')?.addEventListener('click', () => openPicker(i));
    d.querySelector('.ref-label-btn')?.addEventListener('click', () => {
      const value = window.prompt(
        tr('create.refs.labelPrompt'),
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
    const allowsVideo = (currentVideoModel()?.mediaLimits?.video || 0) > 0;
    const allowsAudio = (currentVideoModel()?.mediaLimits?.audio || 0) > 0;
    const mediaKey = allowsAudio ? 'create.refs.mediaImageVideoAudio' : allowsVideo ? 'create.refs.mediaImageVideo' : 'create.refs.mediaImage';
    add.title = isVideo && videoModeAllowsMultimedia()
      ? tr('create.refs.addForModel', { media: tr(mediaKey), model: currentVideoModel().name })
      : tr('create.refs.addImage');
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
    toast(tr('create.refs.onlyImages'), 'err');
    return false;
  }
  if (state.refs.length >= maxRefs) {
    toast(tr('create.refs.modelLimit', { model: m.name, count: maxRefs }), 'err');
    return false;
  }
  if (isMultimediaReference) {
    const mediaLimit = m.mediaLimits?.[normalizedKind];
    const kindCount = state.refs.filter((ref) => referenceKind(ref) === normalizedKind).length;
    if (mediaLimit != null && kindCount >= mediaLimit) {
      const label = tr(normalizedKind === 'image' ? 'create.refs.images' : normalizedKind === 'video' ? 'create.refs.videos' : 'create.refs.audios');
      toast(tr('create.refs.mediaLimit', { model: m.name, count: mediaLimit, media: label }), 'err');
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
      toast(tr('create.refs.labelReadFailed'), 'err');
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
    $('#voiceHint').textContent = tr('create.voice.loadFailed');
    if (showErrors) toast(e.message, 'err');
  }
  renderVoiceSelect();
  if (state.editingCharId !== null) renderCharModal();
}

function renderVoiceSelect() {
  const sel = $('#voiceSelect');
  const voices = state.voices || [];
  sel.innerHTML = `<option value="">${esc(tr('create.voice.choose'))}</option>` + voices
    .map((v) => `<option value="${v.id}">${esc(v.name)}${v.category ? ` · ${esc(v.category)}` : ''}</option>`)
    .join('');
  const pc = pinnedChar();
  if (pc?.voiceId && voices.some((v) => v.id === pc.voiceId)) {
    sel.value = pc.voiceId;
    state.voiceId = pc.voiceId;
    $('#voiceHint').textContent = tr('create.voice.pinned', { name: pc.name });
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
  $('#audioModelHint').textContent = localizedModelNote(selected);
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
    toast(tr('create.character.pinned', { name: pc.name }));
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
  select.innerHTML = `<option value="">${esc(tr('create.character.originalPhotos', { count: pc.photos.length }))}</option>`
    + (pc.variants || []).map((v) => `<option value="${v.id}">${esc(tr('create.character.variantPhotos', { name: v.name, count: v.photos.length }))}</option>`).join('');
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
    <div class="pi-voice">${pc.voiceName ? IC('mic') + ' ' + esc(pc.voiceName) : esc(tr('create.character.noVoice'))}</div>
  </div>`;
}

function renderPinnedHint() {
  const pc = pinnedChar();
  const hint = $('#pinnedHint');
  hint.hidden = !pc;
  if (!pc) return;
  const variant = (pc.variants || []).find((v) => v.id === state.characterVariantId);
  hint.textContent = state.mode === 'image'
    ? tr('create.character.imageRefs', { name: pc.name, variant: ` · ${variant ? variant.name : tr('create.character.original')}` })
    : state.mode === 'video' && currentVideoModel()?.provider === 'seedance' && pc.arkAssetId
    ? tr('create.character.verified', { name: pc.name })
    : state.mode === 'video' && supportsMultimediaVideoRefs()
    ? tr('create.character.localRefs', { name: pc.name, model: currentVideoModel().name })
    : state.mode === 'video' && pc.arkAssetId
    ? tr('create.character.verified', { name: pc.name })
    : pc.voiceName ? tr('create.character.speaks', { name: pc.name, voice: pc.voiceName }) : tr('create.character.missingVoice', { name: pc.name });
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
  $('#shotListTotal').textContent = tr('create.shotList.summary', { count: state.shotList.length, used: fmtSec(used), total: fmtSec(total) });
  const warn = $('#shotListWarn');
  warn.textContent = used > total ? tr('create.shotList.over', { duration: fmtSec(Math.round((used - total) * 10) / 10) })
    : used < total ? tr('create.shotList.remaining', { duration: fmtSec(Math.round((total - used) * 10) / 10) }) : '';
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
      <span class="shot-list-range">${fmtSec(start)} → ${fmtSec(at)}${start >= total ? ` · ${esc(tr('create.shotList.outside'))}` : over ? ` · ${esc(tr('create.shotList.cut'))}` : ''}</span>
      <span class="num-field">
        <input type="number" min="0.5" max="${total}" step="0.5" value="${dur}" data-shotdur="${i}">
        <span class="num-steps">
          <button type="button" class="num-step" data-shotstep="${i}:1" title="${esc(tr('create.shotList.more'))}">${IC('right')}</button>
          <button type="button" class="num-step" data-shotstep="${i}:-1" title="${esc(tr('create.shotList.less'))}">${IC('right')}</button>
        </span>
      </span> s
      <button class="mini-btn danger" data-shotdel="${i}" title="${esc(tr('create.refs.remove'))}">×</button>
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
    toast(tr('create.shotList.redistributed'));
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
  toast(tr('create.shotList.inserted', { count: state.shotList.length }));
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
    options.push(`<option value="${si}:${hi}">${esc(tr('create.shotPanel.option', { scene: si + 1, shot: hi + 1, location: (scene.location || tr('create.shotPanel.noLocation')).slice(0, 40) }))}</option>`);
  }));
  $('#shotPanelShot').innerHTML = options.join('');
  restoreSelect($('#shotPanelShot'), loadShotPanel().shot);
  renderShotPanelBody();
}

function renderShotPanelBody() {
  const body = $('#shotPanelBody');
  const current = shotPanelCurrent();
  if (!current) {
    body.innerHTML = `<div class="hint">${esc(tr('create.shotPanel.empty'))}</div>`;
    return;
  }
  const { script, scene, shot, si, hi } = current;
  saveShotPanel(); // recuerda esta serie/guion/toma para la próxima vez
  const serie = state.series.find((s) => s.id === script.seriesId);
  body.innerHTML = `
    <div class="shot-panel-head">
      <strong>${esc(tr('create.shotPanel.heading', { scene: si + 1, shot: hi + 1 }))}</strong>
      <span class="sb-slug">${esc(`${scene.intExt}. ${(scene.location || '').toUpperCase()} — ${scene.timeOfDay}`)}</span>
      <span class="sb-shot-specs">${esc(shot.size)} · ${esc(shot.lens)}${serie ? ` · ${esc(serie.format)}` : ''}</span>
    </div>
    ${shot.camera ? `<div class="sb-camera">${esc(shot.camera)}</div>` : ''}
    ${shot.items.length ? `<div class="sb-items">${shot.items.map(sbItemLine).join('')}</div>` : ''}
    ${sbPromptView(shot)}
    ${(shot.assetKeys || []).length ? `<div class="sb-assets" data-shotpanelstrip="1">${shot.assetKeys.map((k) =>
      `<button class="script-asset-thumb" data-k="${esc(k)}" title="${esc(k)}">${seriesAssetThumb(k)}</button>`).join('')}</div>` : ''}
    <div class="shot-panel-actions">
      ${shot.prompt ? `<button class="mini-btn" id="shotPanelUsePrompt">${IC('copy')} ${esc(tr('create.shotPanel.usePrompt'))}</button>` : ''}
      <button class="mini-btn" id="shotPanelCopyDesc">${IC('copy')} ${esc(tr('create.shotPanel.copyDescription'))}</button>
    </div>`;
  body.querySelectorAll('.script-asset-thumb').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.k;
    if (!key.startsWith('audio/')) openLightbox(key, (shot.assetKeys || []).filter((x) => !x.startsWith('audio/')));
  }));
  $('#shotPanelUsePrompt')?.addEventListener('click', () => {
    promptBox.value = shot.prompt;
    renderHighlight();
    promptBox.focus();
    toast(tr('create.shotPanel.loaded'));
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
    if (mm.customMode && !mm.style.trim()) return toast(tr('create.validation.musicStyle'), 'err');
    if (mm.customMode && !mm.title.trim()) return toast(tr('create.validation.musicTitle'), 'err');
    if (mm.customMode && !mm.instrumental && !prompt) return toast(tr('create.validation.musicLyrics'), 'err');
    if (!mm.customMode && !prompt) return toast(tr('create.validation.musicDescription'), 'err');
  } else if (!prompt) {
    return toast(tr('create.validation.prompt'), 'err');
  }
  if (isComfy && !state.comfyui.workflowId) return toast(tr('create.validation.workflow'), 'err');
  if (isComfy) {
    const missing = missingComfyRequiredRefs();
    if (missing.length) return toast(tr('create.validation.workflowRefs', { refs: missing.join(', ') }), 'err');
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
    return toast(tr('create.validation.minImages', { model: model.name, count: model.minRefs }), 'err');
  }
  if (isHeyGen && model.requiresRegisteredCharacter) {
    const character = state.characters.find((item) => item.id === state.video.heygenCharacterId);
    if (!heygenCharacterReady(character)) {
      return toast(tr('create.validation.heygenCharacter'), 'err');
    }
  }
  if (isHeyGen && !model.requiresRegisteredCharacter) {
    if (state.refs.length !== 1 || state.refs[0].key.startsWith('asset://')) return toast(tr('create.validation.oneImage'), 'err');
    if (!state.video.heygenVoiceId.trim()) return toast(tr('create.validation.heygenVoice'), 'err');
  }
  if (isHeyGen && state.video.heygenAuthMode === 'oauth' && !state.heygenOAuth.connected) return toast(tr('create.validation.heygenOauth'), 'err');
  if (isHeyGen && state.video.heygenAuthMode === 'key' && !state.config?.keys?.heygen) return toast(tr('create.validation.heygenKey'), 'err');
  if (isH3 && !state.config?.keys?.minimax) return toast(tr('create.validation.minimaxKey'), 'err');
  if (isOmni && !state.config?.keys?.gemini) return toast(tr('create.validation.geminiKey'), 'err');
  if (isSeedance25 && !state.config?.keys?.ark) return toast(tr('create.validation.arkKey'), 'err');
  if (isH3) {
    const counts = state.refs.reduce((out, ref) => {
      out[referenceKind(ref)] += 1;
      return out;
    }, { image: 0, video: 0, audio: 0 });
    if (state.video.mode === 'frames' && (counts.video || counts.audio)) return toast(tr('create.validation.framesImages'), 'err');
    if (counts.image > 9 || counts.video > 3 || counts.audio > 3 || state.refs.length > 12) return toast(tr('create.validation.h3Limits'), 'err');
    if (state.video.mode === 'reference' && counts.audio && !counts.image && !counts.video) return toast(tr('create.validation.h3Audio'), 'err');
  }
  if (isSeedance25) {
    const counts = state.refs.reduce((out, ref) => {
      out[referenceKind(ref)] += 1;
      return out;
    }, { image: 0, video: 0, audio: 0 });
    if (state.video.mode === 'frames' && (counts.video || counts.audio)) return toast(tr('create.validation.framesImages'), 'err');
    if (counts.image > 30 || counts.video > 10 || counts.audio > 10 || state.refs.length > 50) return toast(tr('create.validation.seedanceLimits'), 'err');
  }
  if (isOmni) {
    const counts = state.refs.reduce((out, ref) => {
      out[referenceKind(ref)] += 1;
      return out;
    }, { image: 0, video: 0, audio: 0 });
    if (counts.audio) return toast(tr('create.validation.omniAudio'), 'err');
    if (counts.image > 6 || counts.video > 3 || state.refs.length > 9) return toast(tr('create.validation.omniLimits'), 'err');
    if (state.video.mode === 'frames' && (counts.image !== 2 || counts.video)) return toast(tr('create.validation.omniFrames'), 'err');
    if (['edit', 'extend'].includes(state.video.mode) && !state.video.omniPreviousInteractionId && counts.video !== 1) {
      return toast(tr('create.validation.omniSource', { action: tr(state.video.mode === 'edit' ? 'create.validation.edit' : 'create.validation.extend') }), 'err');
    }
    if (state.video.mode === 'extend' && state.video.omniPreviousInteractionId
      && state.video.omniCumulativeDuration + state.video.duration > 40) {
      return toast(tr('create.validation.omniDuration'), 'err');
    }
  }
  if (isVideo && !isHeyGen && state.video.mode === 'frames' && state.refs.length !== 2) {
    return toast(tr('create.validation.framesExact'), 'err');
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
      : isMusic ? `Suno ${state.music.version}${state.music.instrumental ? ` · ${tr('create.queue.instrumental')}` : ''}`
      : isComfy ? comfyJobLabel()
      : `${audioModel?.name || 'ElevenLabs'} · ${voice?.name || pc?.voiceName || tr('create.history.voiceFallback')}`,
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
  toast(tr('create.queue.added'));
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
    if (entry.errors?.length) toast(tr('create.queue.partial', { count: entry.errors.length, error: entry.errors[0] }), 'err');
    else if (job.kind === 'h3-promotion') toast(tr('create.queue.promoted', { cost: costTxt }));
    else toast(tr('create.queue.generated', { cost: costTxt }));
  } catch (e) {
    job.status = 'error'; job.error = e.message; job.finishedAt = Date.now();
    if (job.kind === 'h3-promotion' && state.currentEntry?.id === job.body?.historyId) {
      showEntry(state.currentEntry);
    }
    toast(e.message, 'err');
    if (job.comfyLoop && state.comfyui.loop) {
      state.comfyui.loop = false;
      $('#comfyLoopToggle').checked = false;
      toast(tr('create.queue.loopStopped'), 'err');
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
  box.innerHTML = `<div class="generation-queue-head"><span>${esc(tr('create.queue.title'))}</span><span>${esc(tr('create.queue.summary', { active, queued }))}</span></div>`
    + state.generationJobs.slice(0, 12).map((job) => `<div class="generation-job ${job.status}" data-job="${job.id}">
      <div class="job-status">${job.status === 'queued' ? 'Ⅱ' : job.status === 'running' ? '●' : job.status === 'done' ? '✓' : '!'}</div>
      <div class="job-main">
        <div class="job-title">${esc(job.label)}${job.progress?.total ? ` · ${esc(tr('create.queue.step', { current: job.progress.current, total: job.progress.total }))}` : ''}</div>
        ${job.progress?.total ? `<div class="job-progress-bar"><div style="width:${Math.min(100, Math.round(job.progress.current / job.progress.total * 100))}%"></div></div>` : ''}
        <div class="job-prompt ${job.status === 'error' ? 'job-error' : ''}">${esc(job.error || job.prompt)}</div>
      </div>
      <div class="job-actions">${job.entry ? `<button class="mini-btn" data-job-act="view">${esc(tr('create.queue.view'))}</button>` : ''}${['done','error'].includes(job.status) ? '<button class="icon-btn" data-job-act="dismiss">×</button>' : ''}</div>
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
    return `<button class="mini-btn accent" data-act="h3-2k-view">${IC('spark')} ${esc(tr('create.history.h3View'))}</button>`;
  }
  if (activeH3PromotionJob(entry.id)) {
    return `<button class="mini-btn accent" disabled>${IC('spark')} ${esc(tr('create.history.h3Running'))}</button>`;
  }
  return `<button class="mini-btn accent" data-act="h3-2k">${IC('spark')} ${esc(tr('create.history.h3Promote'))}</button>`;
}

function omniHistoryActions(entry) {
  if (entry.type !== 'video') return '';
  const canUseUploaded = Number(entry.duration) > 0 && Number(entry.duration) <= 10.01;
  const canContinue = entry.modelId === 'gemini-omni-1-1-flash' && Boolean(entry.omniInteractionId);
  if (!canUseUploaded && !canContinue) return '';
  const cumulative = Number(entry.omniCumulativeDuration) || Number(entry.duration) || 0;
  return `<button class="mini-btn accent" data-act="omni-edit">${IC('edit')} ${esc(tr('create.history.omniEdit'))}</button>
    ${canContinue && cumulative >= 40 ? '' : `<button class="mini-btn accent" data-act="omni-extend">${IC('right')} ${esc(tr('create.history.omniExtend'))}</button>`}`;
}

function loadVideoIntoOmni(entry, mode) {
  const canContinue = entry.modelId === 'gemini-omni-1-1-flash' && Boolean(entry.omniInteractionId);
  if (!canContinue && Number(entry.duration) > 10.01) {
    toast(tr('create.history.omniSourceTooLong'), 'err');
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
  toast(tr(mode === 'edit' ? 'create.history.omniEditReady' : 'create.history.omniExtendReady'));
}

function queueH3Promotion(entry) {
  const existing = existingH3Promotion(entry.id);
  if (existing) {
    showEntry(existing);
    toast(tr('create.history.h3Exists'));
    return;
  }
  if (activeH3PromotionJob(entry.id)) {
    toast(tr('create.history.h3Queued'));
    return;
  }
  if (!confirm(tr('create.history.h3Confirm'))) return;
  // La confirmación puede dejar pasar tiempo suficiente para que otra vista o
  // acción haya encolado la misma promoción; comprobamos una vez más.
  if (existingH3Promotion(entry.id) || activeH3PromotionJob(entry.id)) {
    toast(tr('create.history.h3Queued'));
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
  toast(tr('create.history.h3Added'));
}

function showEntry(entry, outputIdx = 0) {
  state.currentEntry = entry;
  state.currentOutput = outputIdx;
  const bv = $('#bigView');
  bv.hidden = false;
  const tookMeta = entry.durationMs ? ` · ${tr('create.history.took', { duration: fmtDuration(entry.durationMs) })}` : '';

  if (entry.type === 'audio') {
    bv.innerHTML = `
      <div class="bv-media"><div style="padding:8px;color:var(--pink)">${IC('mic', 'ic ic-lg')}</div>
        <audio controls autoplay src="${fileUrl(entry.outputs[0])}"></audio>
      </div>
      <div class="bv-meta">${esc(entry.voiceName || tr('create.history.voiceFallback'))} · ${esc(entry.modelName || 'ElevenLabs')} · ${fmtDate(entry.ts)}${esc(tookMeta)}</div>
      <div class="bv-actions">
        <button class="mini-btn" data-act="copy">${IC('copy')} ${esc(tr('create.history.copy'))}</button>
        <button class="mini-btn" data-act="regen">${IC('refresh')} ${esc(tr('create.history.regenerate'))}</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} ${esc(tr('create.history.edit'))}</button>
        <a class="mini-btn" href="${fileUrl(entry.outputs[0])}" download>${IC('download')} ${esc(tr('create.history.download'))}</a>
      </div>`;
  } else if (entry.type === 'video') {
    const key = entry.outputs[0];
    bv.innerHTML = `
      <div class="bv-media"><video controls autoplay loop src="${fileUrl(key)}"></video></div>
      <div class="bv-meta">${esc(entry.modelName)} · ${entry.aspectRatio} · ${entry.resolution} · ${entry.duration}s${entry.audio ? ` · ${esc(tr('create.history.withAudio'))}` : ''} · ${fmtDate(entry.ts)}${esc(tookMeta)}</div>
      <div class="bv-actions">
        <button class="mini-btn" data-act="copy">${IC('copy')} ${esc(tr('create.history.copy'))}</button>
        <button class="mini-btn" data-act="regen">${IC('refresh')} ${esc(tr('create.history.regenerate'))}</button>
        ${h3PromotionAction(entry)}
        ${omniHistoryActions(entry)}
        <button class="mini-btn" data-act="edit">${IC('edit')} ${esc(tr('create.history.edit'))}</button>
        <a class="mini-btn" href="${fileUrl(key)}" download>${IC('download')} ${esc(tr('create.history.download'))}</a>
      </div>`;
  } else {
    const key = entry.outputs[outputIdx] || entry.outputs[0];
    const thumbs = entry.outputs.length > 1
      ? `<div class="bv-thumbs">${entry.outputs.map((o, i) =>
          `<img src="${fileUrl(o)}" class="${i === outputIdx ? 'sel' : ''}" data-i="${i}" alt="">`).join('')}</div>`
      : '';
    bv.innerHTML = `
      <div class="bv-media bv-media-nav">
        ${entry.outputs.length > 1 ? `<button class="bv-nav bv-prev" data-output-nav="-1" title="${esc(tr('common.previous'))}">${IC('left', 'ic ic-lg')}</button>` : ''}
        <img id="bvMain" src="${fileUrl(key)}" alt="">
        ${entry.outputs.length > 1 ? `<button class="bv-nav bv-next" data-output-nav="1" title="${esc(tr('common.next'))}">${IC('right', 'ic ic-lg')}</button>` : ''}
      </div>
      ${entry.outputs.length > 1 ? `<div class="bv-counter">${outputIdx + 1} / ${entry.outputs.length}</div>` : ''}
      ${thumbs}
      <div class="bv-meta">${esc(entry.modelName)} · ${entry.aspectRatio} · ${entry.resolution}${entry.batch > 1 ? ` · ${esc(tr('create.history.batch', { count: entry.batch }))}` : ''} · ${fmtDate(entry.ts)}${esc(tookMeta)}</div>
      <div class="bv-actions">
        <button class="mini-btn" data-act="copy">${IC('copy')} ${esc(tr('create.history.copy'))}</button>
        <button class="mini-btn" data-act="ref">${IC('link')} ${esc(tr('common.useAsReference'))}</button>
        <button class="mini-btn" data-act="character">${IC('user')} ${esc(tr('common.convertCharacter'))}</button>
        <button class="mini-btn" data-act="regen">${IC('refresh')} ${esc(tr('create.history.regenerate'))}</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} ${esc(tr('create.history.edit'))}</button>
        <a class="mini-btn" href="${fileUrl(key)}" download>${IC('download')} ${esc(tr('create.history.download'))}</a>
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
      if (act === 'ref') { addRef(entry.outputs[state.currentOutput]); toast(tr('lightbox.referenceAdded')); }
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
  toast(tr('create.history.loaded'));
}

function renderHistory() {
  const list = $('#historyList');
  if (!state.history.length) {
    list.innerHTML = `<div class="empty-note">${esc(tr('create.history.empty'))}</div>`;
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
        <div class="hist-meta">${esc(entry.modelName)}${entry.type === 'audio' ? ` · ${esc(entry.voiceName || '')}` : entry.type === 'video' ? ` · ${entry.aspectRatio} · ${entry.resolution} · ${entry.duration}s` : ` · ${entry.aspectRatio} · ${entry.resolution}${entry.batch > 1 ? ' · ×' + entry.batch : ''}`} · ${fmtDate(entry.ts)}${entry.durationMs ? ` · ${esc(tr('create.history.took', { duration: fmtDuration(entry.durationMs) }))}` : ''}${entry.errors?.length ? ` · <span class="err">${esc(tr('create.history.batchErrors', { count: entry.errors.length }))}</span>` : ''}</div>
      </div>
      <div class="hist-actions">
        <button class="mini-btn" data-act="view">${IC('eye')} ${esc(tr('create.history.view'))}</button>
        <button class="mini-btn" data-act="regen" title="${esc(tr('create.history.regenerate'))}">${IC('refresh')}</button>
        <button class="mini-btn" data-act="edit" title="${esc(tr('create.history.edit'))}">${IC('edit')}</button>
        ${entry.type === 'image' ? `<button class="mini-btn" data-act="ref" title="${esc(tr('common.useAsReference'))}">${IC('link')}</button>` : ''}
        <button class="mini-btn danger" data-act="del" title="${esc(tr('create.history.delete'))}">${IC('trash')}</button>
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
        if (act === 'ref') { addRef(entry.outputs[0]); toast(tr('lightbox.referenceAdded')); }
        if (act === 'del') {
          await api(`/api/history/${entry.id}`, { method: 'DELETE' });
          state.history = state.history.filter((x) => x.id !== entry.id);
          renderHistory();
          toast(tr('create.history.deleted'));
        }
      });
    });
    list.appendChild(item);
  }
}

$('#btnClearHistory').addEventListener('click', async () => {
  if (!state.history.length) return toast(tr('create.history.alreadyEmpty'));
  if (!confirm(tr('create.history.clearConfirm', { count: state.history.length }))) return;
  const result = await api('/api/history', { method: 'DELETE' });
  state.history = [];
  $('#bigView').hidden = true;
  renderHistory();
  toast(tr('create.history.cleared', { count: result.deleted }));
});

// ---------------------------------------------------------------------------
// prompts archivados
// ---------------------------------------------------------------------------

$('#btnSavePrompt').addEventListener('click', async () => {
  const text = promptBox.value.trim();
  if (!text) return toast(tr('create.prompts.emptyEditor'), 'err');
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
    panel.innerHTML = `<div class="empty-note" style="padding:10px 0">${esc(tr('create.prompts.empty'))}</div>`;
    return;
  }
  panel.innerHTML = '';
  const categories = promptCategories();
  const toolbar = document.createElement('div');
  toolbar.className = 'prompts-quick-tools';
  toolbar.innerHTML = `
    <select class="select" id="quickPromptCategory"><option value="">${esc(tr('create.prompts.allCategories'))}</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
    <input id="quickPromptSearch" type="search" placeholder="${esc(tr('create.prompts.search'))}" value="${esc(state.promptQuickSearch)}">
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
    panel.insertAdjacentHTML('beforeend', `<div class="empty-note" style="padding:14px 0">${esc(tr('create.prompts.noMatch'))}</div>`);
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
      <button class="icon-btn" title="${esc(tr('create.prompts.delete'))}">${IC('x')}</button>`;
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
    ? tr('picker.replaceImage', {}, 'Reemplazar imagen de referencia')
    : loraMedia
      ? tr('picker.loraMedia', {}, 'Elegir imagen o video ilustrativo del LoRA')
      : multimedia
        ? tr('picker.forModel', { model: currentVideoModel().name }, `Elegir referencia para ${currentVideoModel().name}`)
        : tr('picker.referenceImage', {}, 'Elegir imagen de referencia');
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
        ? tr('prompts.lora.mediaReady')
        : tr('prompts.style.requiredImageReady');
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
  if (state.refs.some((r, j) => j !== i && r.key === key)) return toast(tr('picker.duplicateReference'), 'err');
  const prev = state.refs[i];
  // conserva la etiqueta (y por lo tanto la cita @Etiqueta); si no tenía, sugiere una
  state.refs[i] = { key, fromChar: false, label: prev.label || refLabelSuggestion(key) };
  state.replaceRefIndex = null;
  renderRefs();
  renderHighlight();
  toast(tr('picker.replaced'));
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
      ? `${esc(tr('picker.dropMultimedia'))}<br><small>${esc(currentVideoModel()?.name || tr('picker.multimediaFallback'))}: JPG, PNG, WebP, MP4, MOV, MP3 o WAV</small>`
      : loraMedia ? esc(tr('picker.dropLora'))
      : esc(tr('picker.dropImages'))}<br>${esc(tr('picker.clickFiles'))}</div>`;
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
      : `<div class="empty-note">${esc(tr('picker.noPoses'))}</div>`;
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
            : kind === 'audio' ? `<span class="picker-audio">${IC('mic', 'ic ic-lg')}<small>${esc(tr('common.audio'))}</small></span>`
              : `<img src="${fileUrl(a.key)}" loading="lazy" alt="">`}<div class="p-label">${esc(a.name)}</div></div>`
        ).join('')}</div>`
      : `<div class="empty-note">${esc(tr('picker.empty', {}, 'Nada por acá todavía.'))}</div>`;
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
        : `<span class="hint">${esc(tr('picker.imageCount', { count: group.photos.length }))}</span>`}
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
  { id: '', name: tr('picker.original'), photos: e.photos || [] },
  ...(e.variants || []).map((v) => ({ id: v.id, name: v.name, photos: v.photos || [] }))
];
const firstPhoto = (e) => e.photos[0] || (e.variants || []).find((v) => (v.photos || []).length)?.photos[0];
const seriesImages = (s) => (s.assetKeys || []).filter((k) => !/^(audio|video)\//.test(k));

function renderPickerCharacters() {
  renderEntityPicker({
    idKey: 'pickerCharacterId', variantKey: 'pickerVariantId', icon: 'user',
    items: () => state.characters, cover: firstPhoto, groups: entityVariantGroups,
    label: (c) => `${c.name}${(c.variants || []).length ? ` · ${tr('picker.versions', { count: 1 + c.variants.length })}` : ''}`,
    title: (c) => c.name, photoLabel: (c, g) => `${c.name} · ${g.name}`,
    backLabel: tr('picker.characters'), empty: tr('picker.noCharacters'),
    emptyPhotos: tr('picker.noVersionPhotos'), render: renderPickerCharacters
  });
}

function renderPickerElements() {
  renderEntityPicker({
    idKey: 'pickerElementId', variantKey: 'pickerElementVariantId', icon: 'globe',
    items: () => state.elements, cover: firstPhoto, groups: entityVariantGroups,
    label: (el) => `${el.name} · ${ELEMENT_KIND_LABEL[el.kind] || ''}${(el.variants || []).length ? ` · ${tr('picker.versions', { count: 1 + el.variants.length })}` : ''}`,
    title: (el) => el.name, photoLabel: (el, g) => `${el.name} · ${g.name}`,
    backLabel: tr('picker.elements'), empty: tr('picker.noElements'),
    emptyPhotos: tr('picker.noVersionPhotos'), render: renderPickerElements
  });
}

function renderPickerSeries() {
  renderEntityPicker({
    idKey: 'pickerSeriesId', variantKey: null, icon: 'layers',
    items: () => state.series, cover: (s) => seriesImages(s)[0],
    groups: (s) => [{ id: '', name: s.title, photos: seriesImages(s) }],
    label: (s) => `${s.title} · ${tr('picker.imageCount', { count: seriesImages(s).length })}`,
    title: (s) => s.title, photoLabel: (s) => s.title,
    backLabel: tr('picker.series'), empty: tr('picker.noSeries'),
    emptyPhotos: tr('picker.noSeriesImages'), render: renderPickerSeries
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
        toast(tr('picker.unsupported', { file: f.name }), 'err');
        continue;
      }
      if (multimedia) {
        const totalLimit = activeRefLimit();
        if (initialRefTotal + addedCounts.image + addedCounts.video + addedCounts.audio >= totalLimit) {
          toast(tr('picker.totalLimit', { file: f.name, model: currentVideoModel()?.name || tr('picker.modelFallback'), count: totalLimit }), 'err');
          continue;
        }
        const mediaLimit = currentVideoModel()?.mediaLimits?.[kind];
        if (mediaLimit != null && initialRefCounts[kind] + addedCounts[kind] >= mediaLimit) {
          const label = tr(kind === 'image' ? 'create.refs.images' : kind === 'video' ? 'create.refs.videos' : 'create.refs.audios');
          toast(tr('picker.kindLimit', { file: f.name, model: currentVideoModel()?.name || tr('picker.modelFallback'), count: mediaLimit, media: label }), 'err');
          continue;
        }
      }
      // el cuerpo de la petición admite 150 MB y el base64 infla ~33%
      if (f.size > 100 * 1024 * 1024) {
        toast(tr('picker.tooLarge', { file: f.name }), 'err');
        continue;
      }
      if (multimedia) {
        // ModelArk limita a 64 MB el cuerpo completo; reservamos margen para
        // el crecimiento de base64, el prompt y las demás referencias.
        const sizeLimitMb = currentVideoModel()?.id === 'seedance-2-5'
          ? { image: 30, video: 45, audio: 15 }[kind]
          : { image: 30, video: 50, audio: 15 }[kind];
        if (f.size > sizeLimitMb * 1024 * 1024) {
          toast(tr('picker.providerLimit', { file: f.name, size: sizeLimitMb, kind: tr(kind === 'image' ? 'picker.kindImage' : kind === 'video' ? 'picker.kindVideo' : 'picker.kindAudio') }), 'err');
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
    if (!replacing && uploaded) toast(tr('picker.uploadedRefs', { count: uploaded }));
  } else {
    toast(tr('picker.uploadedImages', { count: files.length }));
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
    toast(tr('picker.pastedImages', { count: files.length }));
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------

const AUDIO_KIND_LABELS = {
  voice: tr('assets.audio.voice'),
  music: tr('assets.audio.music'),
  sound: tr('assets.audio.sound')
};
const splitMusicTags = (value) => [...new Set(String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 30);
const musicTagSummary = (tags = {}) => [...(tags.genres || []), ...(tags.instruments || []), ...(tags.moods || [])];
const splitVisualTags = (value) => [...new Set(String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 40);

function visualAssetItems() {
  return ['generated', 'uploads', 'video'].flatMap((zone) => state.assets[zone] || []);
}

function updateVisualTaxonomyOptions() {
  const items = visualAssetItems();
  const categories = [...new Set(items.map((item) => String(item.category || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, i18n.localeTag()));
  const tags = [...new Set(items.flatMap((item) => item.tags || []).map((tag) => String(tag).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, i18n.localeTag()));
  $('#visualCategoryList').innerHTML = categories.map((category) => `<option value="${esc(category)}"></option>`).join('');
  $('#assetTagsList').innerHTML = tags.map((tag) => `<option value="${esc(tag)}"></option>`).join('');
}

function openVisualUpload(kind = 'image') {
  state.visualUploadKind = kind === 'video' ? 'video' : 'image';
  $('#visualUploadForm').reset();
  $('#visualUploadNsfw').checked = Boolean(state.config?.nsfwUploadDefault);
  $('#visualUploadTitle').textContent = state.visualUploadKind === 'video' ? tr('assets.uploadVideos') : tr('assets.uploadImages');
  $('#visualUploadHint').textContent = state.visualUploadKind === 'video'
    ? tr('assets.uploadVideoHint')
    : tr('assets.uploadImageHint');
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
  if (invalidType) return toast(tr('assets.uploadInvalidType', { file: invalidType.name }), 'err');
  const oversized = files.find((file) => file.size > 100 * 1024 * 1024);
  if (oversized) return toast(tr('assets.uploadTooLarge', { file: oversized.name }), 'err');
  const submit = $('#visualUploadSubmit');
  submit.disabled = true;
  const category = $('#visualUploadCategory').value.trim();
  const tags = splitVisualTags($('#visualUploadTags').value);
  let uploaded = 0;
  const failures = [];
  for (const [index, file] of files.entries()) {
    $('#visualUploadStatus').textContent = tr('assets.uploadProgress', { current: index + 1, total: files.length, file: file.name });
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
  if (failures.length) toast(trn('assets.uploadPartial', files.length, { uploaded, total: files.length, error: failures[0] }), 'err');
  else toast(trn(state.visualUploadKind === 'video' ? 'assets.uploadedVideos' : 'assets.uploadedImages', uploaded));
});

$$('[data-password-toggle]').forEach((button) => {
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', tr('common.showPassword', {}, 'Mostrar clave'));
  button.title = tr('common.showPassword', {}, 'Mostrar clave');
  button.addEventListener('click', () => {
    const input = button.closest('.key-row')?.querySelector('input');
    if (!input) return;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.classList.toggle('active', visible);
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? tr('common.hidePassword', {}, 'Ocultar clave') : tr('common.showPassword', {}, 'Mostrar clave'));
    button.title = visible ? tr('common.hidePassword', {}, 'Ocultar clave') : tr('common.showPassword', {}, 'Mostrar clave');
  });
});

function openVisualClassify(keys, { category = '', tags = [], nsfw = false } = {}) {
  state.visualClassifyKeys = [...new Set(keys)].filter((key) => /^(generated|uploads|video)\//.test(key));
  if (!state.visualClassifyKeys.length) return toast(tr('assets.classify.selectFirst'), 'err');
  $('#visualClassifyForm').reset();
  $('#visualClassifyCategory').value = category || '';
  $('#visualClassifyTags').value = (tags || []).join(', ');
  $('#visualClassifyNsfw').checked = Boolean(nsfw);
  $('#visualClassifyHint').textContent = trn('assets.classify.count', state.visualClassifyKeys.length);
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
    toast(trn('assets.classified', count));
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
  if (file.size > 100 * 1024 * 1024) return toast(tr('assets.audio.tooLarge'), 'err');
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
    toast(tr('assets.audio.uploaded', { type: AUDIO_KIND_LABELS[audioKind] }), 'ok');
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
  charSel.innerHTML = `<option value="">${esc(tr('common.allMasculine'))}</option>` + state.characters.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  seriesSel.innerHTML = `<option value="">${esc(tr('common.allFeminine'))}</option>` + state.series.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
  charSel.value = state.characters.some((c) => c.id === state.assetFilterCharacterId) ? state.assetFilterCharacterId : '';
  seriesSel.value = state.series.some((s) => s.id === state.assetFilterSeriesId) ? state.assetFilterSeriesId : '';
  state.assetFilterCharacterId = charSel.value;
  state.assetFilterSeriesId = seriesSel.value;
  const visualItems = state.assetsZone === 'audio' ? [] : (state.assets[state.assetsZone] || []);
  const categories = [...new Set(visualItems.map((item) => String(item.category || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, i18n.localeTag()));
  $('#assetFilterCategory').innerHTML = `<option value="">${esc(tr('common.allFeminine'))}</option>` + categories.map((category) =>
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
      ? `${IC('upload')} ${esc(tr('assets.audio.upload'))}`
      : state.assetsZone === 'video' ? `${IC('upload')} ${esc(tr('assets.uploadVideos'))}` : `${IC('upload')} ${esc(tr('assets.uploadImages'))}`;
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
  return project?.name || asset.automationName || String(asset.category || '').replace(/^Auto:\s*/i, '') || tr('assets.projectFallback');
}

function renderAssetsGrid() {
  const grid = $('#assetsGrid');
  const allItems = state.assets[state.assetsZone] || [];
  const items = visibleAssets();
  $('#assetsSummary').textContent = tr('assets.summary', { visible: items.length, total: allItems.length });
  updateAssetSelection();
  if (!items.length) {
    grid.innerHTML = `<div class="empty-note">${esc(tr('assets.emptyRange'))}</div>`;
    return;
  }
  grid.innerHTML = '';
  for (const group of groupAssetSessions(items)) {
    const section = document.createElement('section');
    section.className = 'asset-session';
    const start = new Date(group[group.length - 1].mtime);
    const end = new Date(group[0].mtime);
    const title = i18n.formatDate(start, { weekday: 'long', day: 'numeric', month: 'long' });
    const time = (date) => i18n.formatDate(date, { hour: '2-digit', minute: '2-digit' });
    section.innerHTML = `<div class="asset-session-head"><div><h3>${esc(title)}</h3><span>${time(start)}–${time(end)} · ${esc(trn('assets.fileCount', group.length))}</span></div><button class="mini-btn session-select">${esc(tr('assets.selectGroup'))}</button></div><div class="asset-session-grid"></div>`;
    const sessionGrid = section.querySelector('.asset-session-grid');
    section.querySelector('.session-select').addEventListener('click', () => {
      const every = group.every((a) => state.selectedAssets.has(a.key));
      group.forEach((a) => every ? state.selectedAssets.delete(a.key) : state.selectedAssets.add(a.key));
      renderAssetsGrid();
    });
    for (const a of group) {
      const card = document.createElement('div');
      card.className = `asset-card${state.selectedAssets.has(a.key) ? ' selected' : ''}`;
      card.innerHTML = `<button class="asset-check" title="${esc(tr('assets.select'))}">${state.selectedAssets.has(a.key) ? '✓' : ''}</button><button class="asset-series" title="${esc(tr('common.associateSeries'))}">${IC('layers')}</button><a class="asset-download" href="${fileUrl(a.key)}" download="${esc(a.name)}" title="${esc(tr('common.download'))}">${IC('download')}</a><button class="asset-info" title="${esc(tr('common.information'))}">${IC('info')}</button>${a.prompt ? `<button class="asset-copy" title="${esc(tr('common.copyPrompt'))}">${IC('copy')}</button>` : ''}<button class="asset-delete" title="${esc(tr('common.delete'))}">${IC('trash')}</button>`;
      const automationProjectLabel = automationAssetProjectLabel(a);
      if (a.nsfw) card.insertAdjacentHTML('beforeend', nsfwBadgeHtml(a, 'overlay'));
      if (automationProjectLabel) card.insertAdjacentHTML('beforeend', `<span class="asset-project-badge" title="${esc(tr('assets.generatedByAutomation', { project: automationProjectLabel }))}">${IC('spark')} ${esc(automationProjectLabel)}</span>`);
      if (state.assetsZone === 'audio') {
        const kind = a.audioKind || 'voice';
        const tags = kind === 'music' ? musicTagSummary(a.musicTags).slice(0, 4) : [];
        card.insertAdjacentHTML('beforeend', `<div class="audio-tile" data-audiokey="${esc(a.key)}" title="${esc(tr('assets.audio.openPlayer'))}"><span class="audio-kind-badge ${kind}">${esc(AUDIO_KIND_LABELS[kind] || tr('common.audio'))}</span><span class="audio-tile-icon">${IC('play', 'ic ic-lg')}</span><span class="audio-dur audio-tile-dur" data-durkey="${esc(a.key)}"></span></div><div class="a-name">${esc(a.name)}</div>${tags.length ? `<div class="audio-card-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}`);
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
    ? `<span class="nsfw-badge${extraClass ? ` ${extraClass}` : ''}" title="${esc(tr('common.nsfwContent'))}" aria-label="${esc(tr('common.nsfwContent'))}">${IC('alert')}<span>NSFW</span></span>`
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
  toast(tr('prompts.lora.triggerAdded', { trigger: word }));
}

function insertLoraUseCase(useCase) {
  const text = String(useCase?.prompt || '').trim();
  if (!text) return;
  prepareLoraPromptTarget();
  promptBox.value = text;
  renderHighlight();
  promptBox.setSelectionRange(promptBox.value.length, promptBox.value.length);
  toast(tr('prompts.lora.useCaseApplied', { name: useCase.name || tr('prompts.lora.unnamed') }));
}

function loraInvocationHtml(pr, prefix = '') {
  const lora = pr?.lora || {};
  return `${(lora.triggerWords || []).length ? `<div class="prompt-lora-triggers">${lora.triggerWords.map((trigger, index) => `<button type="button" class="prompt-lora-trigger" data-${prefix}lora-trigger="${index}" title="${esc(tr('prompts.lora.addWithComma'))}">${esc(trigger)}</button>`).join('')}</div>` : ''}
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
    toast(trn('prompts.style.referenceLimit', maxRefs, { model: model.name }), 'err');
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
  return [...new Set([...builtIn, ...fromPrompts, ...extra])].sort((a, b) => a.localeCompare(b, i18n.localeTag()));
}

function sameCategoryName(left, right) {
  return String(left || '').trim().toLocaleLowerCase(i18n.localeTag()) === String(right || '').trim().toLocaleLowerCase(i18n.localeTag());
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
    ? `${promptMediaPreviewHtml(key, promptEditorIsLora() ? tr('prompts.lora.illustrativeFile') : tr('prompts.style.reference'))}${promptEditorIsLora() ? '' : `<span class="prompt-style-label">${ARTISTIC_STYLE_LABEL}</span>`}`
    : `<div class="prompt-style-placeholder">${esc(promptEditorIsLora() ? tr('prompts.lora.optionalImage') : tr('prompts.style.chooseImage'))}</div>`;
}

function renderPromptLoraTriggers() {
  const words = state.promptEditor?.loraTriggerWords || [];
  $('#promptLoraTriggerChips').innerHTML = words.length
    ? words.map((word, index) => `<span class="prompt-lora-editor-trigger">${esc(word)}<button type="button" data-lora-remove-trigger="${index}" title="${esc(tr('common.remove'))}">×</button></span>`).join('')
    : `<span class="hint">${esc(tr('prompts.lora.noTriggers'))}</span>`;
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
      <input type="text" maxlength="100" value="${esc(item.name || '')}" placeholder="${esc(tr('prompts.lora.caseName'))}">
      <textarea maxlength="4000" placeholder="${esc(tr('prompts.lora.casePrompt'))}">${esc(item.prompt || '')}</textarea>
      <div class="prompt-lora-case-media">${item.mediaKey ? `<div class="prompt-lora-case-preview">${promptMediaPreviewHtml(item.mediaKey, tr('prompts.lora.caseReference', { name: item.name || tr('prompts.lora.useCase').toLocaleLowerCase() }))}</div>` : `<span class="hint">${esc(tr('prompts.lora.noCaseMedia'))}</span>`}
        <button type="button" class="mini-btn" data-lora-case-upload="${index}">${IC('upload')} ${esc(tr('common.upload'))}</button>
        <button type="button" class="mini-btn" data-lora-case-assets="${index}">${IC('image')} Assets</button>
        ${item.mediaKey ? `<button type="button" class="mini-btn danger" data-lora-case-clear="${index}">${esc(tr('common.remove'))}</button>` : ''}
      </div>
      <button type="button" class="icon-btn" data-lora-remove-case="${index}" title="${esc(tr('prompts.lora.removeCase'))}">${IC('trash')}</button>
    </div>`).join('') : `<span class="hint">${esc(tr('prompts.lora.addCasesHint'))}</span>`;
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
    ? tr('prompts.lora.optionalNotReference')
    : tr('prompts.style.requiredAnalysis');
  $('#promptEditorTextField').hidden = isLora;
  $('#promptEditorTextLabel').textContent = isStyle ? tr('prompts.style.promptEnglish') : 'Prompt';
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
  $('#promptEditorTitle').textContent = prompt ? tr('prompts.editor.editTitle') : tr('prompts.editor.newTitle');
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
    $('#promptStyleStatus').textContent = tr('prompts.style.uploading');
    const kind = referenceFileKind(file);
    if (promptEditorIsStyle() && kind !== 'image') throw new Error(tr('prompts.style.imageOnly'));
    if (promptEditorIsLora() && !['image', 'video'].includes(kind)) throw new Error(tr('prompts.lora.mediaOnly'));
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
      ? tr('prompts.lora.mediaReady')
      : tr('prompts.style.imageReady');
  } catch (err) {
    $('#promptStyleStatus').textContent = err.message;
    toast(err.message, 'err');
  }
});
$('#promptStyleAssetsBtn').addEventListener('click', () => {
  state.promptLoraMediaTarget = null;
  state.promptStyleImagePick = true;
  openPicker();
  $('#pickerTitle').textContent = promptEditorIsLora() ? tr('prompts.lora.chooseMedia') : tr('prompts.style.chooseImageTitle');
});
$('#promptStyleAnalyzeBtn').addEventListener('click', async () => {
  const key = state.promptEditor?.styleImageKey;
  if (!key) return toast(tr('prompts.style.chooseBeforeAnalyze'), 'err');
  const button = $('#promptStyleAnalyzeBtn');
  button.disabled = true;
  $('#promptStyleStatus').textContent = tr('prompts.style.analyzing');
  try {
    const result = await api('/api/prompts/analyze-style', { method: 'POST', body: { imageKey: key } });
    $('#promptEditorText').value = result.text || '';
    $('#promptStyleStatus').textContent = tr('prompts.style.written', { model: result.model || tr('prompts.aiFallback') });
    if (!$('#promptEditorName').value.trim()) $('#promptEditorName').value = tr('prompts.style.defaultName');
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
    return toast(tr('prompts.lora.incompleteCase'), 'err');
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
  if (body.kind === 'style' && !body.styleImageKey) return toast(tr('prompts.style.imageRequired'), 'err');
  if (body.kind === 'lora' && !body.lora.fileName) return toast(tr('prompts.lora.fileNameRequired'), 'err');
  if (body.kind === 'lora' && !body.lora.triggerWords.length && !body.lora.useCases.length) {
    return toast(tr('prompts.lora.invocationRequired'), 'err');
  }
  try {
    if (editor.id) {
      const updated = await api(`/api/prompts/${editor.id}`, { method: 'PUT', body });
      if (!contentIsVisible(updated)) state.prompts = state.prompts.filter((p) => p.id !== editor.id);
      else state.prompts[state.prompts.findIndex((p) => p.id === editor.id)] = updated;
      toast(tr('prompts.updated'));
    } else {
      const item = await api('/api/prompts', { method: 'POST', body });
      if (!item.nsfw || state.config?.nsfwEnabled) state.prompts.unshift(item);
      if (editor.source === 'quick') $('#promptsPanel').hidden = false;
      toast(tr('prompts.archived'));
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
  filter.innerHTML = `<option value="">${esc(tr('categories.all'))}</option>` + categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  filter.value = selected;
  updatePromptCategoryActions();
  const query = $('#promptSearch').value.trim().toLowerCase();
  const items = state.prompts.filter((p) => contentIsVisible(p) && (!filter.value || (p.category || 'General') === filter.value)
    && (!query || (isLoraPrompt(p) ? loraSearchText(p) : `${p.title} ${p.text} ${p.category || ''}`).toLowerCase().includes(query)));
  library.innerHTML = items.length ? items.map((pr) => `
    <article class="prompt-library-card" data-prompt="${pr.id}">
      <div class="prompt-library-head"><div><span class="prompt-category">${esc(pr.category || 'General')}</span>${nsfwBadgeHtml(pr)}<h3>${esc(pr.title)}</h3></div><span>${pr.mode === 'audio' ? IC('mic') : pr.mode === 'video' ? IC('film') : IC('image')}</span></div>
      ${isStylePrompt(pr) && pr.styleImageKey ? `<div class="prompt-style-image"><img src="${esc(fileUrl(pr.styleImageKey))}" alt="${esc(tr('prompts.style.referenceOf', { title: pr.title }))}"><span class="prompt-style-label">${ARTISTIC_STYLE_LABEL}</span></div>` : ''}
      ${isLoraPrompt(pr) && (pr.lora?.mediaKey || pr.styleImageKey) ? `<div class="prompt-lora-image">${promptMediaPreviewHtml(pr.lora?.mediaKey || pr.styleImageKey, tr('prompts.lora.illustrativeOf', { title: pr.title }))}</div>` : ''}
      ${isLoraPrompt(pr) ? `${pr.lora?.fileName ? `<div class="prompt-lora-file">${esc(pr.lora.fileName)}</div>` : ''}<div class="prompt-lora-description">${esc(pr.lora?.description || '')}</div>${loraInvocationHtml(pr)}${pr.lora?.usageInfo ? `<div class="prompt-lora-usage"><strong>${esc(tr('prompts.lora.correctUseShort'))}</strong> ${esc(pr.lora.usageInfo)}</div>` : ''}` : `<div class="prompt-library-text">${esc(pr.text)}</div>`}
      <div class="prompt-library-actions">${isLoraPrompt(pr) ? '' : `<button class="mini-btn" data-pact="use">${esc(tr('prompts.use'))}</button>`}<button class="mini-btn" data-pact="edit">${IC('edit')} ${esc(tr('common.edit'))}</button><button class="mini-btn danger" data-pact="delete" title="${esc(tr('common.delete'))}">${IC('trash')}</button></div>
    </article>`).join('') : `<div class="empty-note">${esc(tr('prompts.noMatch'))}</div>`;
  library.querySelectorAll('[data-prompt]').forEach((card) => {
    const pr = state.prompts.find((p) => p.id === card.dataset.prompt);
    card.querySelector('[data-pact="use"]')?.addEventListener('click', () => usePrompt(pr));
    if (isLoraPrompt(pr)) bindLoraInvocation(card, pr);
    card.querySelector('[data-pact="edit"]').addEventListener('click', () => openPromptEditor({ prompt: pr }));
    card.querySelector('[data-pact="delete"]').addEventListener('click', async () => {
      if (!confirm(tr('prompts.deleteConfirm', { title: pr.title }))) return;
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
  $('#newCategorySave').textContent = editing ? tr('categories.saveChanges') : tr('categories.create');
  $('#newCategoryName').focus();
  $('#newCategoryName').select();
}

function closePromptCategoryForm() {
  const row = $('#newCategoryRow');
  row.hidden = true;
  row.dataset.action = '';
  row.dataset.originalName = '';
  $('#newCategoryMode').hidden = false;
  $('#newCategorySave').textContent = tr('categories.create');
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
  if (!confirm(tr('prompts.categories.deleteConfirm', { name }))) return;
  try {
    const { promptCategories: updated, affected = 0 } = await api('/api/prompt-categories', { method: 'DELETE', body: { name } });
    state.promptCategoriesExtra = updated;
    updateOpenPromptCategory(name, 'General');
    $('#promptCategoryFilter').value = '';
    closePromptCategoryForm();
    renderPromptLibrary();
    renderPromptsPanel();
    toast(affected
      ? trn('prompts.categories.deletedMoved', affected, { name })
      : tr('prompts.categories.deleted', { name }));
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
  if (!name) return toast(tr('categories.nameRequired'), 'err');
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
      ? (affected ? trn('prompts.categories.updatedCount', affected) : tr('categories.updated'))
      : tr('categories.created', { name }));
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
    const key = word.toLocaleLowerCase(i18n.localeTag());
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100);
}

function vocabularyCategories() {
  return [...new Set(['General', ...state.vocabularyCategoriesExtra, ...state.vocabulary.map((item) => item.category).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b, i18n.localeTag()));
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
  return `${item.title || ''} ${item.category || ''} ${(item.words || []).join(' ')}`.toLocaleLowerCase(i18n.localeTag());
}

function filteredVocabulary(query = '', category = '') {
  const needle = String(query || '').trim().toLocaleLowerCase(i18n.localeTag());
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
  toast(tr('vocabulary.wordCopied', { word: text }));
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
  toast(tr('vocabulary.wordInserted', { word: text }));
}

function vocabularyWordsMarkup(item, actionLabel = tr('assets.info.copy'), icon = 'copy') {
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
  filter.innerHTML = `<option value="">${esc(tr('categories.all'))}</option>`
    + categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
  filter.value = state.vocabularyCategoryFilter;
  updateVocabularyCategoryActions();
  const items = filteredVocabulary(state.vocabularySearch, state.vocabularyCategoryFilter);
  $('#vocabularyCount').textContent = trn('vocabulary.count', state.vocabulary.length, { visible: items.length, total: state.vocabulary.length });
  library.innerHTML = items.length ? items.map((item) => `
    <article class="vocabulary-card" data-vocabulary-id="${esc(item.id)}">
      <button type="button" class="vocabulary-card-image" data-vocabulary-image aria-label="${esc(tr('vocabulary.enlarge', { title: item.title }))}"><img src="${esc(fileUrl(item.imageKey))}" alt="${esc(tr('vocabulary.visualReference', { title: item.title }))}" loading="lazy"></button>
      <div class="vocabulary-card-head">
        <div><span class="prompt-category">${esc(item.category)}</span><h3>${esc(item.title)}</h3></div>
        ${nsfwBadgeHtml(item)}
      </div>
      ${vocabularyWordsMarkup(item)}
      <div class="vocabulary-card-actions">
        <button type="button" class="mini-btn" data-vocabulary-action="edit">${IC('edit')} ${esc(tr('common.edit'))}</button>
        <button type="button" class="mini-btn danger" data-vocabulary-action="delete">${IC('trash')} ${esc(tr('common.delete'))}</button>
      </div>
    </article>`).join('') : `<div class="empty-note">${esc(tr('vocabulary.noMatch'))}</div>`;
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
  $('#newVocabularyCategorySave').textContent = editing ? tr('categories.saveChanges') : tr('categories.create');
  $('#newVocabularyCategoryName').focus();
  $('#newVocabularyCategoryName').select();
}

function closeVocabularyCategoryForm() {
  const row = $('#newVocabularyCategoryRow');
  row.hidden = true;
  row.dataset.action = '';
  row.dataset.originalName = '';
  $('#newVocabularyCategorySave').textContent = tr('categories.create');
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
      <div><strong>${esc(tr('vocabulary.quick.title'))}</strong><span class="hint">${esc(tr('vocabulary.quick.lead'))}</span></div>
      <button type="button" class="icon-btn" data-vocabulary-quick-close title="${esc(tr('common.close'))}"><svg class="ic"><use href="#i-x"/></svg></button>
    </div>
    <div class="vocabulary-quick-tools">
      <input type="search" data-vocabulary-quick-search placeholder="${esc(tr('vocabulary.quick.search'))}" value="${esc(state.vocabularyQuickSearch)}">
      <select class="select" data-vocabulary-quick-category><option value="">${esc(tr('categories.all'))}</option>${categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('')}</select>
      <span class="hint">${esc(trn('vocabulary.results', items.length))}</span>
    </div>
    <div class="vocabulary-quick-grid">${items.length ? items.map((item) => `
      <article class="vocabulary-quick-card" data-vocabulary-quick-id="${esc(item.id)}">
        <button type="button" class="vocabulary-quick-image" data-vocabulary-quick-image aria-label="${esc(tr('vocabulary.enlarge', { title: item.title }))}"><img src="${esc(fileUrl(item.imageKey))}" alt="${esc(tr('vocabulary.visualReference', { title: item.title }))}" loading="lazy"></button>
        <div class="vocabulary-quick-copy">
          <span class="prompt-category">${esc(item.category)}</span>
          <h4>${esc(item.title)}${nsfwBadgeHtml(item, 'compact')}</h4>
          ${vocabularyWordsMarkup(item, tr('vocabulary.insert'), 'plus')}
        </div>
      </article>`).join('') : `<div class="empty-note">${esc(tr('vocabulary.quick.noMatch'))} <button type="button" class="mini-btn" data-open-vocabulary-section>${IC('plus')} ${esc(tr('vocabulary.quick.manage'))}</button></div>`}</div>`;
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
    <span class="vocabulary-editor-chip">${esc(word)}<button type="button" data-vocabulary-remove-word="${index}" title="${esc(tr('common.remove'))}">×</button></span>`).join('') : `<span class="hint">${esc(tr('vocabulary.editor.noWords'))}</span>`;
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
    preview.innerHTML = `<span>${esc(tr('vocabulary.editor.chooseImage'))}</span>`;
    $('#vocabularyEditorImageStatus').textContent = tr('vocabulary.editor.imageRequired');
    $('#vocabularyEditorAnalyze').disabled = true;
    return;
  }
  const image = document.createElement('img');
  image.src = source;
  image.alt = tr('vocabulary.editor.previewAlt');
  preview.appendChild(image);
  $('#vocabularyEditorAnalyze').disabled = false;
  $('#vocabularyEditorImageStatus').textContent = editor.pendingFileName || tr('vocabulary.editor.savedImage');
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
  $('#vocabularyEditorTitle').textContent = item ? tr('vocabulary.editor.editTitle') : tr('vocabulary.editor.newTitle');
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
  if (!confirm(tr('vocabulary.deleteConfirm', { title: item.title }))) return;
  try {
    await api(`/api/vocabulary/${item.id}`, { method: 'DELETE' });
    state.vocabulary = state.vocabulary.filter((entry) => entry.id !== item.id);
    renderVocabularyLibrary();
    renderVocabularyQuickPanel();
    toast(tr('vocabulary.deleted'));
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
    toast(imported ? trn('vocabulary.imported', imported) : tr('vocabulary.nothingToImport'), imported ? 'ok' : 'err');
  } catch (err) { toast(tr('vocabulary.importFailed', { error: err.message }), 'err'); }
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
  if (!confirm(tr('vocabulary.categories.deleteConfirm', { name }))) return;
  try {
    const { vocabularyCategories: updated, affected = 0 } = await api('/api/vocabulary-categories', { method: 'DELETE', body: { name } });
    state.vocabularyCategoriesExtra = updated;
    updateOpenVocabularyCategory(name, 'General');
    state.vocabularyCategoryFilter = '';
    closeVocabularyCategoryForm();
    renderVocabularyLibrary();
    renderVocabularyQuickPanel();
    toast(affected
      ? trn('vocabulary.categories.deletedMoved', affected, { name })
      : tr('prompts.categories.deleted', { name }));
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
  if (!name) return toast(tr('categories.nameRequired'), 'err');
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
      ? (affected ? trn('vocabulary.categories.updatedCount', affected) : tr('categories.updated'))
      : tr('categories.created', { name }));
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
  if (!editor?.pendingDataUrl && !editor?.imageKey) return toast(tr('vocabulary.editor.uploadBeforeAnalyze'), 'err');
  const button = $('#vocabularyEditorAnalyze');
  button.disabled = true;
  $('#vocabularyEditorImageStatus').textContent = tr('vocabulary.editor.analyzing');
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
    const detected = result.words?.length || 0;
    const addedNote = added !== detected ? trn('vocabulary.editor.newTerms', added) : '';
    const titleNote = result.ignoredTitle ? tr('vocabulary.editor.ignoredTitle', { title: result.ignoredTitle }) : '';
    $('#vocabularyEditorImageStatus').textContent = trn('vocabulary.editor.detected', detected, { addedNote, titleNote });
    toast(trn('vocabulary.editor.addedByAi', added));
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
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast(tr('vocabulary.editor.invalidImage'), 'err');
  if (file.size > 100 * 1024 * 1024) return toast(tr('vocabulary.editor.imageTooLarge'), 'err');
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
  if (!title) return toast(tr('vocabulary.editor.titleRequired'), 'err');
  if (!category) return toast(tr('vocabulary.editor.categoryRequired'), 'err');
  if (!words.length) return toast(tr('vocabulary.editor.wordRequired'), 'err');
  if (!editor.imageKey && !editor.pendingDataUrl) return toast(tr('vocabulary.editor.entryImageRequired'), 'err');
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
    toast(editor.id ? tr('vocabulary.updated') : tr('vocabulary.saved'));
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
  return [...new Set([...fromSnippets, ...state.snippetCategoriesExtra])].sort((a, b) => a.localeCompare(b, i18n.localeTag()));
}

function renderSnippetEditorCategories() {
  chipRow($('#snippetEditorCategoryChips'), snippetCategories(), $('#snippetEditorCategory').value.trim(), (c) => {
    $('#snippetEditorCategory').value = c;
    renderSnippetEditorCategories();
  });
}

function openSnippetEditor(snippet = null) {
  state.snippetEditor = { id: snippet?.id || null };
  $('#snippetEditorTitle').textContent = snippet ? tr('snippets.editor.editTitle') : tr('snippets.editor.saveTitle');
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
  if (!body.title || !body.code.trim()) return toast(tr('snippets.editor.required'), 'err');
  try {
    if (editor.id) {
      const updated = await api(`/api/snippets/${editor.id}`, { method: 'PUT', body });
      state.snippets[state.snippets.findIndex((s) => s.id === editor.id)] = updated;
      toast(tr('snippets.updated'));
    } else {
      const item = await api('/api/snippets', { method: 'POST', body });
      state.snippets.unshift(item);
      toast(tr('snippets.saved'));
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
  filter.innerHTML = `<option value="">${esc(tr('categories.all'))}</option>` + categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
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
      <div class="prompt-library-actions"><button class="mini-btn" data-sact="view">${IC('eye')} ${esc(tr('common.view'))}</button><button class="mini-btn" data-sact="copy">${IC('copy')} ${esc(tr('assets.info.copy'))}</button><button class="mini-btn" data-sact="edit">${IC('edit')} ${esc(tr('common.edit'))}</button><button class="mini-btn danger" data-sact="delete" title="${esc(tr('common.delete'))}">${IC('trash')}</button></div>
    </article>`).join('') : `<div class="empty-note">${esc(tr('snippets.noMatch'))}</div>`;
  library.querySelectorAll('[data-snippet]').forEach((card) => {
    const sn = state.snippets.find((s) => s.id === card.dataset.snippet);
    card.querySelector('[data-sact="view"]').addEventListener('click', () => openSnippetView(sn));
    card.querySelector('[data-sact="copy"]').addEventListener('click', () => copyPrompt(sn.code));
    card.querySelector('[data-sact="edit"]').addEventListener('click', () => openSnippetEditor(sn));
    card.querySelector('[data-sact="delete"]').addEventListener('click', async () => {
      if (!confirm(tr('snippets.deleteConfirm', { title: sn.title }))) return;
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
  $('#newSnippetCategorySave').textContent = editing ? tr('categories.saveChanges') : tr('categories.create');
  $('#newSnippetCategoryName').focus();
  $('#newSnippetCategoryName').select();
}

function closeSnippetCategoryForm() {
  const row = $('#newSnippetCategoryRow');
  row.hidden = true;
  row.dataset.action = '';
  row.dataset.originalName = '';
  $('#newSnippetCategorySave').textContent = tr('categories.create');
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
  if (!confirm(tr('snippets.categories.deleteConfirm', { name }))) return;
  try {
    const { snippetCategories: updated, affected = 0 } = await api('/api/snippet-categories', { method: 'DELETE', body: { name } });
    state.snippetCategoriesExtra = updated;
    updateOpenSnippetCategory(name, '');
    $('#snippetCategoryFilter').value = '';
    closeSnippetCategoryForm();
    renderSnippetLibrary();
    toast(affected
      ? trn('snippets.categories.deletedKept', affected, { name })
      : tr('prompts.categories.deleted', { name }));
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
  if (!name) return toast(tr('categories.nameRequired'), 'err');
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
      ? (affected ? trn('snippets.categories.updatedCount', affected) : tr('categories.updated'))
      : tr('categories.created', { name }));
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
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(i18n.localeTag()).trim();
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
    toast(trn('assets.downloadedZip', keys.length));
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    updateAssetSelection();
  }
}
$('#btnDownloadSelected').addEventListener('click', () => downloadAssets([...state.selectedAssets]));

async function deleteAssets(keys) {
  if (!keys.length) return;
  if (!confirm(trn('assets.deleteConfirm', keys.length))) return;
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
  toast(trn('assets.deleted', result.deleted));
  return true;
}

async function duplicateAssets(keys) {
  if (!keys.length) return;
  try {
    const result = await api('/api/assets/duplicate', { method: 'POST', body: { keys } });
    await refreshAssets();
    toast(trn('assets.duplicated', result.keys.length));
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
  if (autoplay) playingAudio.play().catch(() => toast(tr('player.playFailed', {}, 'No se pudo reproducir este audio'), 'err'));
}

function toggleAudioPlay(card, key) {
  const sameTrack = assetAudioKey === key;
  assetAudioPlayer.hidden = false;
  document.body.classList.add('asset-player-open');
  if (!sameTrack) return openAssetAudioPlayer(key);
  updateAssetAudioPlayer();
  if (playingAudio.paused || playingAudio.ended) playingAudio.play().catch(() => toast(tr('player.playFailed', {}, 'No se pudo reproducir este audio'), 'err'));
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
  if (assetAudioKey) toast(tr('player.openFailed', {}, 'El reproductor no pudo abrir este archivo'), 'err');
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
    ${info ? `<button class="mini-btn" id="lbInfo">${IC('info')} ${esc(tr('common.information'))}</button>` : ''}
    ${info?.prompt ? `<button class="mini-btn" id="lbCopyPrompt">${IC('copy')} ${esc(tr('common.copyPrompt'))}</button>` : ''}
    ${!isVideo ? `<button class="mini-btn" id="lbRef">${IC('link')} ${esc(tr('common.useAsReference'))}</button>` : ''}
    ${!isVideo && isReusableImageKey(key) ? `<button class="mini-btn" id="lbAssociate">${IC('user')} ${esc(tr('common.associateEntity'))}</button>` : ''}
    <button class="mini-btn" id="lbSeries">${IC('layers')} ${esc(tr('common.associateSeries'))}</button>
    ${!isVideo && isReusableImageKey(key) ? `<button class="mini-btn" id="lbCharacter">${IC('user')} ${esc(tr('common.convertCharacter'))}</button>` : ''}
    ${!isVideo ? `<button class="mini-btn" id="lbPhotoshop">${IC('pen')} ${esc(tr('common.openPhotoshop'))}</button>` : ''}
    ${/^(generated|uploads|audio|video)\//.test(key) ? `<button class="mini-btn" id="lbDuplicate">${IC('copy')} ${esc(tr('common.duplicate'))}</button>` : ''}
    <a class="mini-btn" href="${fileUrl(key)}" download>${IC('download')} ${esc(tr('common.download'))}</a>`;
  $('#lbPhotoshop')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/photoshop/open', { method: 'POST', body: { key } });
      watchPhotoshopFile(key, r.mtime);
      toast(tr('lightbox.openingPhotoshop', {}, 'Abriendo en Photoshop… al guardar allá, acá se actualiza sola'));
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#lbRef')?.addEventListener('click', () => {
    addRef(key);
    closeLightbox();
    goToCreate();
    if (state.mode === 'audio') setMode('image');
    toast(tr('lightbox.referenceAdded', {}, 'Agregada como referencia'));
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
    [tr('assets.info.model'), asset.modelName || asset.modelId || tr('assets.info.unavailable')],
    [tr('assets.info.type'), isAudio ? AUDIO_KIND_LABELS[audioKind] || tr('common.audio') : isVideo ? tr('create.mode.video') : asset.type || tr('create.mode.image')],
    ...(automationProjectLabel ? [[tr('assets.info.project'), automationProjectLabel], [tr('assets.info.origin'), tr('assets.info.automationOrigin')]] : []),
    ...(!isAudio ? [[tr('categories.category'), asset.category || '—'], [tr('assets.filters.tags'), (asset.tags || []).join(', ') || '—']] : []),
    ...(isAudio ? [[tr('assets.info.duration'), '__DUR__']] : []),
    [tr('assets.info.aspectRatio'), asset.aspectRatio || '—'], [tr('assets.info.resolution'), asset.resolution || '—'],
    [tr('assets.info.batch'), asset.batch || 1], [tr('assets.info.references'), (asset.refs || []).length],
    [tr('assets.filters.character'), character ? `${character.name} · ${variant?.name || tr('picker.original')}` : '—'],
    [tr('assets.info.date'), asset.ts ? fmtDate(asset.ts) : '—'], [tr('assets.info.estimatedCost'), asset.cost ? `$${Number(asset.cost).toFixed(4)}` : '—']
  ];
  const baseName = decodeURIComponent(asset.key.split('/').pop() || '').replace(/\.[^.]+$/, '');
  const ext = (asset.key.match(/\.[^.]+$/) || [''])[0];
  $('#assetInfoBody').innerHTML = `
    ${asset.key && !isAudio ? (isVideo
      ? `<video class="asset-info-preview" src="${fileUrl(asset.key)}" controls preload="metadata"></video>`
      : `<img class="asset-info-preview" src="${fileUrl(asset.key)}" alt="">`) : ''}
    <div class="asset-info-rename">
      <span>${esc(tr('assets.info.fileName'))}</span>
      <div><input id="assetRenameInput" type="text" maxlength="80" value="${esc(baseName)}"><span class="asset-info-ext">${esc(ext)}</span><button class="mini-btn" id="assetRenameBtn">${esc(tr('assets.info.rename'))}</button></div>
    </div>
    <div class="asset-info-grid">${rows.map(([label, value]) => `<div><span>${label}</span><strong>${value === '__DUR__' ? `<span class="audio-dur" data-durkey="${esc(asset.key)}">…</span>` : esc(value)}</strong></div>`).join('')}</div>
    ${isAudio ? `<div class="asset-info-audio-action"><button type="button" class="generate-btn small" id="assetInfoPlay">${IC('play')} ${esc(tr('assets.audio.openPlayer'))}</button></div><div class="audio-metadata-editor">
      <h4>${esc(tr('assets.audio.classification'))}</h4>
      <label>${esc(tr('assets.info.type'))}<select class="select" id="assetAudioKind">${Object.entries(AUDIO_KIND_LABELS).map(([value, label]) => `<option value="${value}"${audioKind === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
      <div id="assetMusicFields" class="audio-music-fields"${audioKind === 'music' ? '' : ' hidden'}>
        <label>${esc(tr('assets.audio.genre'))}<input id="assetMusicGenres" type="text" value="${esc((musicTags.genres || []).join(', '))}" placeholder="ambient, orchestral"></label>
        <label>${esc(tr('assets.audio.instruments'))}<input id="assetMusicInstruments" type="text" value="${esc((musicTags.instruments || []).join(', '))}" placeholder="piano, strings"></label>
        <label>${esc(tr('assets.audio.moods'))}<input id="assetMusicMoods" type="text" value="${esc((musicTags.moods || []).join(', '))}" placeholder="mysterious, tense"></label>
      </div>
      <label class="check-row"><input id="assetAudioNsfw" type="checkbox"${asset.nsfw ? ' checked' : ''}> ${esc(tr('common.nsfwContent'))}</label>
      <button type="button" class="mini-btn" id="assetAudioMetadataSave">${esc(tr('assets.classify.save'))}</button>
    </div>` : ''}
    ${!isAudio ? `<div class="visual-metadata-editor">
      <h4>${esc(tr('assets.visual.classification'))}</h4>
      <label>${esc(tr('categories.category'))}<input id="assetVisualCategory" type="text" maxlength="80" list="visualCategoryList" value="${esc(asset.category || '')}" placeholder="${esc(tr('assets.categoryExample'))}"></label>
      <label>${esc(tr('assets.filters.tags'))}<input id="assetVisualTags" type="text" maxlength="500" value="${esc((asset.tags || []).join(', '))}" placeholder="${esc(tr('assets.tagsExample'))}"></label>
      <label class="check-row"><input id="assetVisualNsfw" type="checkbox"${asset.nsfw ? ' checked' : ''}> ${esc(tr('common.nsfwContent'))}</label>
      <span class="hint">${esc(tr('assets.visual.tagsHint'))}</span>
      <button type="button" class="mini-btn" id="assetVisualMetadataSave">${esc(tr('assets.classify.save'))}</button>
    </div>` : ''}
    <div class="asset-info-prompt"><div><span>${esc(tr('assets.info.usedPrompt'))}</span>${asset.prompt ? `<button class="mini-btn" id="assetInfoCopy">${IC('copy')} ${esc(tr('assets.info.copy'))}</button>` : ''}</div><pre>${esc(asset.prompt || tr('assets.info.noPrompt'))}</pre></div>`;
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
      toast(tr('assets.audio.classificationSaved'), 'ok');
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
      toast(tr('assets.visual.classificationSaved'));
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
  if (!clean) return toast(tr('assets.info.nameRequired'), 'err');
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
    toast(tr('assets.info.renamed', { name: res.name }));
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
  if (!state.characters.length && !state.elements.length) return toast(tr('assets.associate.createDestinationFirst'), 'err');
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
  $('#associateAssetPreview').innerHTML = `<img src="${fileUrl(key)}" alt=""><div><strong>${esc(existing ? tr('assets.associate.reassign') : tr('assets.series.newLink'))}</strong><div class="hint">${esc(tr('assets.series.noMove'))}</div></div>`;
  $('#associateAssetModal').hidden = false;
}

function renderAssociationOwners(ownerId = '', variantId = '') {
  sortEntities();
  const isElement = associationIsElement();
  $('#associateOwnerLabelText').textContent = isElement ? tr('assets.associate.element') : tr('assets.filters.character');
  const list = isElement ? state.elements : state.characters;
  const select = $('#associateCharacter');
  select.innerHTML = list.map((c) => `<option value="${c.id}">${esc(c.name)}${isElement ? ` (${ELEMENT_KIND_LABEL[c.kind] || ''})` : ''}</option>`).join('');
  if (ownerId && list.some((c) => c.id === ownerId)) select.value = ownerId;
  renderAssociationVariants(variantId);
}

function renderAssociationVariants(selected = '') {
  const list = associationIsElement() ? state.elements : state.characters;
  const owner = list.find((c) => c.id === $('#associateCharacter').value);
  $('#associateVariant').innerHTML = `<option value="">${esc(tr('picker.original'))}</option>`
    + (owner?.variants || []).map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')
    + `<option value="${NEW_ASSOCIATION_VARIANT}">＋ ${esc(tr('assets.associate.createVariant'))}</option>`;
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
        return toast(tr('assets.associate.variantNameRequired'), 'err');
      }
      const owners = isElement ? state.elements : state.characters;
      const ownerBefore = owners.find((item) => item.id === ownerId);
      const previousIds = new Set((ownerBefore?.variants || []).map((variant) => variant.id));
      const base = isElement ? `/api/elements/${ownerId}/variants` : `/api/characters/${ownerId}/variants`;
      const updated = await api(base, { method: 'POST', body: { name, description } });
      const created = (updated.variants || []).find((variant) => !previousIds.has(variant.id));
      if (!created) throw new Error(tr('assets.associate.variantNotFound'));
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
    toast(tr(asPhoto ? 'assets.associate.savedWithPhoto' : 'assets.associate.saved', {
      owner: owner.name,
      variant: variant?.name || tr('picker.original')
    }));
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
  const totalTxt = mins
    ? tr('series.duration.minutes', { minutes: mins, seconds: secs ? ` ${secs} s` : '' })
    : tr('series.duration.seconds', { seconds: secs });
  return tr('series.structure', { chapters: trn('series.chapterCount', s.chapters || 0), seconds: s.chapterSeconds, total: totalTxt });
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
    grid.innerHTML = `<div class="empty-note">${esc(tr('series.empty'))}</div>`;
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
        : `<span class="hint">${esc(tr('series.noCharacters'))}</span>`}</div>
      <div class="char-actions">
        <button class="mini-btn accent" data-act="view">${IC('eye')} ${esc(tr('series.viewScript'))}</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} ${esc(tr('common.edit'))}</button>
        <button class="mini-btn" data-act="scripts">${IC('clapper')} ${esc(tr('series.scripts'))}${state.scripts.filter((sc) => sc.seriesId === s.id).length ? ` (${state.scripts.filter((sc) => sc.seriesId === s.id).length})` : ''}</button>
        <button class="mini-btn" data-act="assets">${IC('image')} Assets${assetCount ? ` (${assetCount})` : ''}</button>
        <button class="mini-btn danger" data-act="del" title="${esc(tr('common.delete'))}">${IC('trash')}</button>
      </div>`;
    card.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'view') {
          const list = state.scripts.filter((sc) => sc.seriesId === s.id);
          if (!list.length) return toast(tr('series.noScripts'), 'err');
          if (list.length === 1) return openScriptView(list[0].id);
          openSeriesScripts(s.id); // varios guiones: se elige desde la lista
        }
        if (act === 'edit') openSeriesModal(s.id);
        if (act === 'scripts') openSeriesScripts(s.id);
        if (act === 'assets') openSeriesAssets(s.id);
        if (act === 'del') {
          if (!confirm(tr('series.deleteConfirm', { title: s.title }))) return;
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
  $('#characterGalleryTitle').textContent = tr('series.assetsTitle', { title: s.title });
  $('#characterGalleryBody').innerHTML = `<section class="character-gallery-group">
    <div class="character-gallery-group-head"><h4>${esc(s.title)}</h4><span>${esc(trn('characters.assetCount', keys.length))}</span></div>
    <div class="character-gallery-grid linked-assets">${keys.length ? keys.map((key) => `
      <div class="linked-asset">${key.startsWith('audio/')
        ? `<div class="series-audio big">${IC('mic', 'ic ic-lg')}</div>`
        : `<button data-gallery-photo="${esc(key)}">${seriesAssetThumb(key)}</button>`}
      <button class="linked-remove" data-unlink="${esc(key)}" title="${esc(tr('series.removeAsset'))}">×</button></div>`).join('') : `<div class="hint">${esc(tr('series.noAssetsHint'))}</div>`}</div>
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
    wrap.innerHTML = `<span class="hint">${esc(tr('series.noCreatedCharacters'))}</span>`;
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
    ? keys.map((key) => `<div class="series-asset">${seriesAssetThumb(key)}<button type="button" class="linked-remove" data-unlink="${esc(key)}" title="${esc(tr('series.removeAsset'))}">×</button></div>`).join('')
    : `<span class="hint">${esc(tr('series.noAssets'))}</span>`;
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
  $('#seriesModalTitle').textContent = s ? tr('series.editTitle') : tr('series.new');
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
      toast(tr('series.updated'));
    } else {
      const created = await api('/api/series', { method: 'POST', body });
      state.series.unshift(created);
      toast(tr('series.created', { title: created.title }));
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
  if (!state.series.length) return toast(tr('assets.series.createFirst'), 'err');
  state.pendingSeriesAssetKey = keys;
  closeLightbox();
  const select = $('#seriesAssignSelect');
  select.innerHTML = state.series.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
  if (keys.length === 1) {
    const current = state.series.filter((s) => (s.assetKeys || []).includes(keys[0]));
    if (current.length) select.value = current[0].id;
    $('#seriesAssignPreview').innerHTML = `${seriesAssetThumb(keys[0])}<div><strong>${current.length ? tr('assets.series.alreadyIn', { series: current.map((s) => `“${esc(s.title)}”`).join(', ') }) : tr('assets.series.newLink')}</strong><div class="hint">${esc(tr('assets.series.multipleHint'))}</div></div>`;
  } else {
    $('#seriesAssignPreview').innerHTML = `<div class="series-assign-batch">${keys.slice(0, 4).map(seriesAssetThumb).join('')}${keys.length > 4 ? `<div class="series-audio">+${keys.length - 4}</div>` : ''}</div><div><strong>${esc(trn('assets.series.selected', keys.length))}</strong><div class="hint">${esc(tr('assets.series.allAssociatedHint'))}</div></div>`;
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
    toast(trn('assets.series.associated', keys.length, { series: updated.title }));
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
  $('#characterGalleryTitle').textContent = tr('scripts.seriesTitle', { title: s.title });
  $('#characterGalleryBody').innerHTML = `
    <div class="script-list-toolbar">
      <button class="generate-btn small" id="scriptListNew">${IC('plus')} ${esc(tr('scripts.new'))}</button>
      <button class="mini-btn" id="scriptListImport">${IC('upload')} ${esc(tr('scripts.importHookcast'))}</button>
    </div>
    ${scripts.length ? scripts.map((sc) => {
      const shots = scriptShotCount(sc);
      const assetCount = (sc.scenes || []).reduce((n, s) => n + (s.shots || []).reduce((m, sh) => m + (sh.assetKeys || []).length + (sh.audioKeys || []).length, 0), 0);
      return `<div class="script-row" data-script="${sc.id}">
        <div>
          <strong>${esc(sc.title)}</strong>
          <div class="hint">${esc(trn('scripts.sceneCount', sc.scenes.length))} · ${esc(trn('scripts.shotCount', shots))} · ${esc(sc.format)}${sc.source === 'hookcast' ? ` · ${esc(tr('scripts.importedHookcast'))}` : ''} · ${fmtDate(sc.updatedAt || sc.ts)}</div>
        </div>
        <div class="script-row-actions">
          <button class="mini-btn accent" data-sact="view">${IC('eye')} ${esc(tr('common.view'))}</button>
          <button class="mini-btn" data-sact="open">${IC('edit')} ${esc(tr('scripts.edit'))}</button>
          <button class="mini-btn" data-sact="assign">${IC('image')} ${esc(tr('storyboard.assignAssets'))}</button>
          ${assetCount ? `<a class="mini-btn" href="/api/scripts/${sc.id}/export" download title="${esc(tr('scripts.exportAssetsTitle', { count: assetCount }))}">${IC('download')} ${esc(tr('scripts.exportAssets', { count: assetCount }))}</a>` : ''}
          <button class="mini-btn danger" data-sact="del" title="${esc(tr('common.delete'))}">${IC('trash')}</button>
        </div>
      </div>`;
    }).join('') : `<div class="hint" style="margin-top:12px">${esc(tr('scripts.empty'))}</div>`}`;
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
        toast(tr('scripts.imported', {
          title: result.script.title,
          scenes: trn('scripts.sceneCount', result.script.scenes.length),
          matched: matched ? trn('scripts.matchedCharacters', matched) : ''
        }));
        renderSeries(); renderCharacters();
        openSeriesScripts(seriesId);
      } catch (err) { toast(tr('scripts.importFailed', { error: err.message }), 'err'); }
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
      if (!confirm(tr('scripts.deleteConfirm', { title: sc.title }))) return;
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
  if (state.scriptDirty && !confirm(tr('scripts.leaveUnsavedConfirm'))) return;
  state.scriptEditor = null;
  clearScriptDirty();
  $('.nav-btn[data-view="series"]').click();
}
$('#scriptBack').addEventListener('click', closeScriptEditor);

function renderScriptEditor() {
  const ed = state.scriptEditor;
  if (!ed) return;
  const serie = state.series.find((s) => s.id === ed.seriesId);
  $('#scriptViewTitle').textContent = ed.title || tr('scripts.title');
  $('#scriptViewSeries').textContent = serie ? tr('scripts.seriesMeta', { title: serie.title, format: serie.format }) : '';
  $('#scriptEditorRoot').innerHTML = `
    <datalist id="scriptCastList"></datalist>
    <section class="script-block">
      <h3>${esc(tr('scripts.editor.dataCast'))}</h3>
      <div class="script-meta-grid">
        <label>${esc(tr('common.title'))}<input id="scMetaTitle" maxlength="140" value="${esc(ed.title)}"></label>
        <label>${esc(tr('series.editor.format'))}<select id="scMetaFormat" class="select">${SCRIPT_FORMATS.map((f) => `<option${f === ed.format ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
      </div>
      <label class="script-label">${esc(tr('scripts.editor.synopsis'))}<textarea id="scMetaSummary" rows="2" maxlength="3000" placeholder="${esc(tr('scripts.editor.synopsisPlaceholder'))}">${esc(ed.summary || '')}</textarea></label>
      <div class="script-cast" id="scriptCastRows"></div>
      <button class="mini-btn" id="scCastAdd">${IC('plus')} ${esc(tr('scripts.editor.addCast'))}</button>
    </section>
    <section class="script-block">
      <h3>${esc(tr('scripts.editor.aiWriter'))}</h3>
      <p class="hint">${esc(tr('scripts.editor.aiWriterHint'))}</p>
      <label class="script-label">${esc(tr('scripts.editor.brief'))}<textarea id="scBrief" rows="4" maxlength="6000" placeholder="${esc(tr('scripts.editor.briefPlaceholder'))}">${esc(state.scriptBriefText || '')}</textarea></label>
      <button class="generate-btn small" id="scGenerate">${esc(ed.scenes.length ? tr('scripts.editor.regenerateAi') : tr('scripts.editor.generateAi'))}</button>
    </section>
    <section class="script-block">
      <h3>${esc(tr('scripts.editor.technicalScript'))}</h3>
      <div id="scriptScenes"></div>
      <button class="mini-btn" id="scAddScene">${IC('plus')} ${esc(tr('scripts.editor.addScene'))}</button>
    </section>`;
  $('#scMetaTitle').addEventListener('input', (e) => { ed.title = e.target.value; $('#scriptViewTitle').textContent = ed.title || tr('scripts.title'); markScriptDirty(); });
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
      <label>${esc(tr('assets.filters.character'))}<select class="select" data-f="characterId">
        <option value="">${esc(tr('scripts.editor.unlinked'))}</option>
        ${state.characters.map((c) => `<option value="${c.id}"${c.id === ch.characterId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select></label>
      <label>${esc(tr('scripts.editor.scriptName'))}<input data-f="name" maxlength="80" value="${esc(ch.name)}" placeholder="VALENTINA"></label>
      <label>${esc(tr('scripts.editor.role'))}<input data-f="role" maxlength="160" value="${esc(ch.role || '')}" placeholder="${esc(tr('scripts.editor.rolePlaceholder'))}"></label>
      <button class="icon-btn script-row-remove" title="${esc(tr('scripts.editor.removeCast'))}">${IC('x')}</button>
    </div>`).join('') : `<p class="hint">${esc(tr('scripts.editor.noCast'))}</p>`;
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
    wrap.innerHTML = `<p class="hint">${esc(tr('scripts.editor.noScenes'))}</p>`;
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
      <strong>${esc(tr('scripts.scene', { number: si + 1 }))}</strong>
      <div class="script-mini-actions">
        <button class="mini-btn" data-a="up"${si === 0 ? ' disabled' : ''} title="${esc(tr('scripts.editor.moveSceneUp'))}">↑</button>
        <button class="mini-btn" data-a="down"${si === ed.scenes.length - 1 ? ' disabled' : ''} title="${esc(tr('scripts.editor.moveSceneDown'))}">↓</button>
        <button class="mini-btn danger" data-a="del">${IC('trash')} ${esc(tr('common.delete'))}</button>
      </div>
    </header>
    <div class="script-slug-row">
      <label>Int / Ext<select class="select" data-f="intExt"><option${scene.intExt !== 'EXT' ? ' selected' : ''}>INT</option><option${scene.intExt === 'EXT' ? ' selected' : ''}>EXT</option></select></label>
      <label>${esc(tr('elements.location'))}<input data-f="location" maxlength="120" value="${esc(scene.location || '')}" placeholder="SUITE DEL HOTEL"></label>
      <label>${esc(tr('scripts.editor.time'))}<select class="select" data-f="timeOfDay">${SCRIPT_TIMES.map((t) => `<option${t === scene.timeOfDay ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <div class="script-shots"></div>
    <button class="mini-btn" data-a="addshot">${IC('plus')} ${esc(tr('scripts.editor.addShot'))}</button>`;
  card.querySelector('[data-a="up"]').addEventListener('click', () => { moveInArray(ed.scenes, si, -1); markScriptDirty(); renderScriptScenes(); });
  card.querySelector('[data-a="down"]').addEventListener('click', () => { moveInArray(ed.scenes, si, 1); markScriptDirty(); renderScriptScenes(); });
  card.querySelector('[data-a="del"]').addEventListener('click', () => {
    if (!confirm(tr('scripts.editor.deleteSceneConfirm', { number: si + 1 }))) return;
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
      <strong>${esc(tr('scripts.shot', { number: `${si + 1}.${hi + 1}` }))}</strong>
      <div class="script-mini-actions">
        <button class="mini-btn" data-a="insert" title="${esc(tr('scripts.editor.insertBelowTitle'))}">${IC('plus')} ${esc(tr('scripts.editor.insertBelow'))}</button>
        <button class="mini-btn" data-a="up"${hi === 0 ? ' disabled' : ''} title="${esc(tr('scripts.editor.moveShotUp'))}">↑</button>
        <button class="mini-btn" data-a="down"${hi === scene.shots.length - 1 ? ' disabled' : ''} title="${esc(tr('scripts.editor.moveShotDown'))}">↓</button>
        <button class="mini-btn danger" data-a="del"${scene.shots.length === 1 ? ' disabled' : ''} title="${esc(tr('scripts.editor.removeShot'))}">${IC('trash')}</button>
      </div>
    </div>
    <div class="script-camera-row">
      <label>${esc(tr('scripts.editor.shotSize'))}<select class="select" data-f="size">${SCRIPT_SIZES.map((x) => `<option${x === shot.size ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>${esc(tr('scripts.editor.lens'))}<select class="select" data-f="lens">${SCRIPT_LENSES.map((x) => `<option${x === shot.lens ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>${esc(tr('scripts.editor.camera'))}<textarea data-f="camera" rows="2" maxlength="600" placeholder="${esc(tr('scripts.editor.cameraPlaceholder'))}">${esc(shot.camera || '')}</textarea></label>
    </div>
    <div class="script-items"></div>
    <div class="script-shot-foot">
      <button class="mini-btn" data-a="addaction">${IC('plus')} ${esc(tr('scripts.editor.action'))}</button>
      <button class="mini-btn" data-a="adddialogue">${IC('plus')} ${esc(tr('scripts.editor.dialogue'))}</button>
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
      <label>${esc(tr('assets.filters.character'))}<input data-f="character" maxlength="80" list="scriptCastList" value="${esc(item.character || '')}" placeholder="VALENTINA"></label>
      <label>${esc(tr('scripts.editor.line'))}<input data-f="text" maxlength="500" value="${esc(item.text || '')}" placeholder="${esc(tr('scripts.editor.linePlaceholder'))}"></label>
      <button class="icon-btn script-row-remove" title="${esc(tr('scripts.editor.removeDialogue'))}">${IC('x')}</button>`;
    row.querySelector('[data-f="character"]').addEventListener('input', (e) => { item.character = e.target.value; markScriptDirty(); });
  } else {
    row.innerHTML = `
      <label>${esc(tr('scripts.editor.action'))}<textarea data-f="text" rows="2" maxlength="1500" placeholder="${esc(tr('scripts.editor.actionPlaceholder'))}">${esc(item.text || '')}</textarea></label>
      <button class="icon-btn script-row-remove" title="${esc(tr('scripts.editor.removeAction'))}">${IC('x')}</button>`;
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
    toast(tr('scripts.saved'));
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
  if (!brief) return toast(tr('scripts.editor.briefRequired'), 'err');
  if (ed.scenes.length && !confirm(tr('scripts.editor.replaceScenesConfirm'))) return;
  const btn = $('#scGenerate');
  btn.disabled = true;
  btn.textContent = tr('scripts.editor.writing');
  try {
    if (state.scriptDirty && !(await saveScript())) throw new Error(tr('scripts.editor.saveBeforeGenerateFailed'));
    const updated = await api(`/api/scripts/${state.scriptEditor.id}/generate`, { method: 'POST', body: { brief } });
    state.scripts[state.scripts.findIndex((x) => x.id === updated.id)] = updated;
    state.scriptEditor = structuredClone(updated);
    clearScriptDirty();
    renderScriptEditor();
    toast(tr('scripts.editor.generated', {
      scenes: trn('scripts.sceneCount', updated.scenes.length),
      shots: trn('scripts.shotCount', scriptShotCount(updated))
    }));
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
    <summary>${esc(tr('storyboard.promptUsed'))}${shot.promptTitle ? `: <strong>${esc(shot.promptTitle)}</strong>` : ''}</summary>
    <pre>${esc(shot.prompt)}</pre>
  </details>`;
}

function renderStoryboard() {
  const sb = state.storyboardScript;
  if (!sb) return;
  const serie = state.series.find((s) => s.id === sb.seriesId);
  $('#storyboardTitle').textContent = tr('storyboard.titleForScript', { title: sb.title });
  $('#storyboardSeries').textContent = serie ? tr('storyboard.seriesMeta', { title: serie.title, format: sb.format }) : '';
  const root = $('#storyboardRoot');
  if (!sb.scenes.length) {
    root.innerHTML = `<p class="hint">${esc(tr('storyboard.noScenes'))}</p>`;
    return;
  }
  root.innerHTML = sb.scenes.map((scene, si) => `
    <article class="sb-scene">
      <div class="sb-scene-head">
        <h4>${esc(tr('scripts.scene', { number: si + 1 }))}</h4>
        <span class="sb-slug">${esc(`${scene.intExt}. ${(scene.location || '').toUpperCase()} — ${scene.timeOfDay}`)}</span>
      </div>
      ${scene.shots.map((shot, hi) => `
        <div class="sb-shot">
          <div class="sb-shot-head">
            <div><strong>${esc(tr('scripts.shot', { number: `${si + 1}.${hi + 1}` }))}</strong> <span class="sb-shot-specs">· ${esc(shot.size)} · ${esc(shot.lens)}</span></div>
            <button class="mini-btn" data-sb="${si}:${hi}">${IC('image')} ${esc(tr('storyboard.assignAssets'))}${(shot.assetKeys || []).length ? ` (${shot.assetKeys.length})` : ''}</button>
          </div>
          ${shot.camera ? `<div class="sb-camera">${esc(shot.camera)}</div>` : ''}
          ${shot.items.length ? `<div class="sb-items">${shot.items.map(sbItemLine).join('')}</div>` : ''}
          <div class="sb-assets" data-sbstrip="${si}:${hi}">${(shot.assetKeys || []).map((k) => `<button class="script-asset-thumb" data-k="${esc(k)}" title="${esc(k)}">${seriesAssetThumb(k)}</button>`).join('')}</div>
          <div class="sb-audio-row">
            <button class="mini-btn" data-sbaudio="${si}:${hi}">${IC('mic')} ${esc(tr('storyboard.assignAudio'))}${(shot.audioKeys || []).length ? ` (${shot.audioKeys.length})` : ''}</button>
            <div class="sb-audios" data-sbaudiostrip="${si}:${hi}">${(shot.audioKeys || []).map(audioChipHtml).join('')}</div>
          </div>
          <div class="sb-prompt">
            <div class="sb-prompt-head"><span>${esc(tr('storyboard.shotPrompt'))}</span><div class="sb-prompt-actions">
              ${shot.prompt ? `<button class="mini-btn" data-sbcopy="${si}:${hi}">${IC('copy')} ${esc(tr('assets.info.copy'))}</button><button class="mini-btn danger" data-sbclearprompt="${si}:${hi}">${esc(tr('common.remove'))}</button>` : ''}
              <button class="mini-btn" data-sbpickprompt="${si}:${hi}">${IC('book')} ${esc(tr('storyboard.chooseFromPrompts'))}</button>
            </div></div>
            ${shot.prompt ? sbPromptView(shot) : `<span class="hint">${esc(tr('storyboard.noPrompt'))}</span>`}
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
    await saveStoryboard(tr('storyboard.promptRemoved'));
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
  $('#scriptViewMeta').textContent = tr('scripts.viewMeta', {
    series: serie ? tr('scripts.viewSeriesPrefix', { title: serie.title }) : '',
    format: sc.format,
    scenes: trn('scripts.sceneCount', sc.scenes.length),
    shots: trn('scripts.shotCount', shots)
  });
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
          <h4>${esc(tr('scripts.scene', { number: si + 1 }))}</h4>
          <span class="sb-slug">${esc(`${scene.intExt}. ${(scene.location || '').toUpperCase()} — ${scene.timeOfDay}`)}</span>
        </div>
        ${scene.shots.map((shot, hi) => `
          <div class="sb-shot">
            <div class="sb-shot-head"><div><strong>${esc(tr('scripts.shot', { number: `${si + 1}.${hi + 1}` }))}</strong> <span class="sb-shot-specs">· ${esc(shot.size)} · ${esc(shot.lens)}</span></div></div>
            ${shot.camera ? `<div class="sb-camera">${esc(shot.camera)}</div>` : ''}
            ${shot.items.length ? `<div class="sb-items">${shot.items.map(sbItemLine).join('')}</div>` : ''}
            ${sbPromptView(shot)}
            ${(shot.assetKeys || []).length ? `<div class="sb-assets" data-vgstrip="${si}:${hi}">${shot.assetKeys.map((k) =>
              `<button class="script-asset-thumb" data-k="${esc(k)}" title="${esc(k)}">${seriesAssetThumb(k)}</button>`).join('')}</div>` : ''}
            ${(shot.audioKeys || []).length ? `<div class="sb-audios">${IC('mic')} ${shot.audioKeys.map(audioChipHtml).join('')}</div>` : ''}
          </div>`).join('')}
      </article>`).join('') : `<p class="hint">${esc(tr('scripts.noScenes'))}</p>`}`;
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
  if (!state.prompts.length) return toast(tr('storyboard.noSavedPrompts'), 'err');
  state.shotPromptTarget = { si, hi };
  $('#shotPromptTitle').textContent = tr('storyboard.promptForShot', { number: `${si + 1}.${hi + 1}` });
  $('#shotPromptSearch').value = '';
  const cats = promptCategories();
  $('#shotPromptCategory').innerHTML = `<option value="">${esc(tr('categories.all'))}</option>`
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
    </button>`).join('') : `<div class="hint">${esc(tr('prompts.noMatch'))}</div>`;
  $('#shotPromptList').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', async () => {
    const pr = state.prompts.find((x) => x.id === b.dataset.p);
    const target = state.shotPromptTarget;
    const shot = state.storyboardScript?.scenes[target?.si]?.shots[target?.hi];
    if (!pr || !shot) return;
    shot.prompt = pr.text;
    shot.promptId = pr.id;
    shot.promptTitle = pr.title;
    closeShotPromptPicker();
    await saveStoryboard(tr('storyboard.promptAssigned', { title: pr.title }));
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
  $('#shotAssetsTitle').textContent = tr(audioMode ? 'storyboard.audioForShot' : 'storyboard.assetsForShot', { number: `${si + 1}.${hi + 1}` });
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
        <button class="shot-audio-play" data-audiokey="${esc(k)}" title="${esc(tr('storyboard.play'))}">${IC('play')}</button>
        <span class="shot-audio-cell-name">${esc(sbAudioName(k))}</span>
        <span class="audio-dur shot-audio-cell-dur" data-durkey="${esc(k)}"></span>
        <span class="shot-audio-cell-check">${selected.includes(k) ? IC('check') : ''}</span>
      </div>`
    : `<button class="shot-asset-cell${selected.includes(k) ? ' selected' : ''}" data-k="${esc(k)}" title="${esc(k)}">
        ${seriesAssetThumb(k)}${selected.includes(k) ? `<span class="shot-asset-check">${IC('check')}</span>` : ''}
      </button>`).join('')
    : `<div class="hint">${state.shotAssetsZone === 'series'
      ? esc(tr(audioMode ? 'storyboard.seriesNoAudio' : 'storyboard.seriesNoAssets'))
      : esc(tr('storyboard.noAudioZone'))}</div>`;
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
  await saveStoryboard(tr('storyboard.assignmentSaved'));
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
    grid.innerHTML = `<div class="empty-note">${esc(tr('characters.empty'))}</div>`;
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
        <div class="char-voice">${c.voiceName ? IC('mic') + ' ' + esc(c.voiceName) : `<span style="color:#6f5f8d">${esc(tr('characters.noVoice'))}</span>`}</div>
      </div></div>
      <div class="char-desc">${esc(c.description || '')}</div>
      ${heygenCharacterReady(c) ? `<div class="heygen-card-badge">HeyGen · ${esc(trn('characters.shots', c.heygen?.closeAvatarId ? 2 : 1))}</div>` : ''}
      ${(c.variants || []).length ? `<div class="hint" style="margin-bottom:8px">${esc(trn('characters.outfitVariants', c.variants.length))}</div>` : ''}
      ${inSeries.length ? `<div class="char-series">${IC('layers')} ${inSeries.map((s) => esc(s.title)).join(' · ')}</div>` : ''}
      <div class="char-photos-mini">${minis}</div>
      <div class="char-actions">
        <button class="mini-btn" data-act="pin">${IC('pin')} ${esc(c.id === state.pinnedId ? tr('characters.pinned') : tr('characters.pin'))}</button>
        <button class="mini-btn" data-act="use">${IC('link')} ${esc(tr('characters.usePhotos'))}</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} ${esc(tr('common.edit'))}</button>
        <button class="mini-btn" data-act="variants">${esc(tr('characters.variants'))}</button>
        <button class="mini-btn" data-act="gallery">${IC('eye')} ${esc(tr('characters.viewPhotos'))}</button>
        <button class="mini-btn" data-act="assets">${IC('image')} Assets${linkedCount ? ` (${linkedCount})` : ''}</button>
        <a class="mini-btn" href="/api/characters/${c.id}/export" download>${IC('download')} ${esc(tr('characters.export'))}</a>
        <button class="mini-btn danger" data-act="del" title="${esc(tr('common.delete'))}">${IC('trash')}</button>
      </div>`;
    card.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'pin') setPinned(c.id === state.pinnedId ? '' : c.id);
        if (act === 'use') {
          setMode('image');
          for (const p of c.photos) addRef(p, false);
          goToCreate();
          toast(tr('characters.photosAdded', { name: c.name }));
        }
        if (act === 'edit') openCharModal(c.id);
        if (act === 'variants') openCharModal(c.id);
        if (act === 'gallery') openCharacterGallery(c.id);
        if (act === 'assets') openCharacterAssets(c.id);
        if (act === 'del') {
          if (!confirm(tr('characters.deleteConfirm', { name: c.name }))) return;
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
  const groups = [{ name: tr('picker.original'), description: c.description || '', photos: c.photos || [] }, ...(c.variants || [])];
  $('#characterGalleryBody').innerHTML = groups.map((group) => `
    <section class="character-gallery-group">
      <div class="character-gallery-group-head"><h4>${esc(group.name)}</h4><span>${esc(trn('characters.photoCount', group.photos.length))}</span></div>
      ${group.description ? `<p>${esc(group.description)}</p>` : ''}
      <div class="character-gallery-grid">${group.photos.length
        ? group.photos.map((photo) => `<button data-gallery-photo="${esc(photo)}"><img src="${fileUrl(photo)}" loading="lazy" alt=""></button>`).join('')
        : `<div class="hint">${esc(tr('characters.noVariantPhotos'))}</div>`}</div>
    </section>`).join('');
  $('#characterGalleryBody').querySelectorAll('[data-gallery-photo]').forEach((button) => {
    button.addEventListener('click', () => openLightbox(button.dataset.galleryPhoto, groups.flatMap((group) => group.photos || [])));
  });
  $('#characterGalleryModal').hidden = false;
}

function openCharacterAssets(id) {
  const c = state.characters.find((x) => x.id === id);
  if (!c) return;
  $('#characterGalleryTitle').textContent = tr('characters.associatedAssetsTitle', { name: c.name });
  const groups = [
    { id: null, name: tr('picker.original') },
    ...(c.variants || []).map((v) => ({ id: v.id, name: v.name }))
  ];
  const links = state.assetLinks.filter((link) => link.characterId === id);
  $('#characterGalleryBody').innerHTML = groups.map((group) => {
    const items = links.filter((link) => (link.variantId || null) === group.id);
    return `<section class="character-gallery-group">
      <div class="character-gallery-group-head"><h4>${esc(group.name)}</h4><span>${esc(trn('characters.assetCount', items.length))}</span></div>
      <div class="character-gallery-grid linked-assets">${items.length ? items.map((link) => `
        <div class="linked-asset"><button data-gallery-photo="${esc(link.key)}"><img src="${fileUrl(link.key)}" loading="lazy" alt=""></button><button class="linked-remove" data-unlink="${esc(link.key)}" title="${esc(tr('characters.removeAssociation'))}">×</button></div>`).join('') : `<div class="hint">${esc(tr('characters.noAssociatedAssets'))}</div>`}</div>
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
    toast(tr('characters.imported', { name: created.name, photos: created.photos.length, variants: created.variants.length }));
  } catch (err) { toast(tr('characters.importFailed', { error: err.message }), 'err'); }
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
  $('#charModalTitle').textContent = id ? tr('characters.editTitle') : tr('characters.new');
  if (state.voices === null) loadVoices(false);
  renderCharModal();
}

function renderCharModal() {
  const id = state.editingCharId;
  const c = state.characters.find((x) => x.id === id) || { name: '', description: '', voiceId: '', photos: [], heygen: { avatarId: '', wideAvatarId: '', closeAvatarId: '', wideMotionPrompt: '', closeMotionPrompt: '', imageKey: '' } };
  const voices = state.voices || [];
  const body = $('#charModalBody');
  body.innerHTML = `
    ${state.pendingCharacterAsset ? `<div class="character-source"><img src="${fileUrl(state.pendingCharacterAsset)}" alt=""><div><strong>${esc(tr('characters.editor.initialPhoto'))}</strong><span>${esc(tr('characters.editor.initialPhotoHint'))}</span></div></div>` : ''}
    <div><label>${esc(tr('assets.associate.name'))}</label><input type="text" id="chName" value="${esc(c.name)}" placeholder="${esc(tr('characters.editor.namePlaceholder'))}"></div>
    <div><label>${esc(tr('common.description'))}</label><textarea id="chDesc" placeholder="${esc(tr('characters.editor.descriptionPlaceholder'))}">${esc(c.description || '')}</textarea></div>
    <label class="check-row"><input type="checkbox" id="chNsfw"${c.nsfw ? ' checked' : ''}> ${esc(tr('common.nsfwContent'))}</label>
    <div><label>${esc(tr('characters.editor.elevenVoice'))}</label>
      <select id="chVoice">
        <option value="">— ${esc(tr('characters.noVoice'))} —</option>
        ${voices.map((v) => `<option value="${v.id}" ${v.id === c.voiceId ? 'selected' : ''}>${esc(v.name)}${v.category ? ' · ' + esc(v.category) : ''}</option>`).join('')}
      </select>
      ${voices.length ? '' : `<div class="hint" style="margin-top:4px">${esc(tr('characters.editor.voiceConfigHint'))}</div>`}
    </div>
    <div><label>${esc(tr('characters.editor.seedanceAsset'))}</label>
      <input type="text" id="chArkAsset" value="${esc(c.arkAssetId || '')}" placeholder="ej: asset-20260222234430-mxpgh">
      <div class="hint" style="margin-top:4px">${esc(tr('characters.editor.seedanceHint'))}</div>
    </div>
    <div class="heygen-character-card">
      <div class="variant-manager-head"><label>${esc(tr('characters.editor.heygenVariant'))}</label>${heygenCharacterReady(c) ? `<span class="heygen-ready">${esc(tr('characters.editor.videoReady'))}</span>` : ''}</div>
      <label class="heygen-character-field"><span>${esc(tr('characters.editor.wideAvatar'))}</span><input type="text" id="chHeyGenWideAvatar" value="${esc(heygenWideAvatarId(c))}" placeholder="91bd75d9e4414cc58043c82bcfc340f4"></label>
      <label class="heygen-character-field"><span>${esc(tr('characters.editor.closeAvatar'))}</span><input type="text" id="chHeyGenCloseAvatar" value="${esc(c.heygen?.closeAvatarId || '')}" placeholder="6f85c7941c594c94ae8594e17337bef0"></label>
      <label class="heygen-character-field"><span>${esc(tr('characters.editor.widePrompt'))}</span><textarea id="chHeyGenWideMotionPrompt" maxlength="1000" rows="3" placeholder="${esc(tr('characters.editor.widePromptPlaceholder'))}">${esc(heygenMotionPromptFor(c, 'wide'))}</textarea></label>
      <label class="heygen-character-field"><span>${esc(tr('characters.editor.closePrompt'))}</span><textarea id="chHeyGenCloseMotionPrompt" maxlength="1000" rows="3" placeholder="${esc(tr('characters.editor.closePromptPlaceholder'))}">${esc(heygenMotionPromptFor(c, 'close'))}</textarea></label>
      <div class="hint" style="margin-top:4px">${esc(tr('characters.editor.heygenHint'))}</div>
      ${id ? `<div class="heygen-mirror">
        ${c.heygen?.imageKey ? `<img src="${fileUrl(c.heygen.imageKey)}" alt="${esc(tr('characters.editor.mirrorAlt'))}">` : `<div class="heygen-mirror-empty">${esc(tr('characters.editor.noMirror'))}</div>`}
        <div><button type="button" class="mini-btn" id="chHeyGenUpload">${IC('upload')} ${esc(tr('characters.editor.uploadMirror'))}</button>
        <input type="file" id="chHeyGenFileInput" accept="image/png,image/jpeg,image/webp" hidden>
        ${c.photos?.[0] ? `<button type="button" class="mini-btn" id="chHeyGenUseCover">${esc(tr('characters.editor.useCover'))}</button>` : ''}
        ${c.heygen?.imageKey ? `<button type="button" class="mini-btn danger" id="chHeyGenRemove">${esc(tr('common.remove'))}</button>` : ''}</div>
      </div>` : `<p class="hint">${esc(tr('characters.editor.createBeforeMirror'))}</p>`}
    </div>
    ${id ? `
    ${c.photos.length ? `<div><label>${esc(tr('characters.editor.cover'))}</label><div id="chCover"></div></div>` : ''}
    <div>
      <div class="variant-manager-head"><label>${esc(tr('characters.editor.photos', { count: c.photos.length }))}</label><div>
        <button type="button" class="mini-btn" id="chAddPhoto">${IC('upload')} ${esc(tr('common.upload'))}</button>
        <button type="button" class="mini-btn" id="chAddPhotoFromAssets">${IC('image')} ${esc(tr('characters.editor.fromAssets'))}</button>
      </div></div>
      ${c.photos.length > 1 ? `<div class="hint" style="margin-bottom:6px">${esc(tr('characters.editor.reorderHint'))}</div>` : ''}
      <div class="char-photos-grid" id="chPhotos">
        ${c.photos.map((p, pi) => `<div class="ref-thumb${pi === 0 ? ' is-profile' : ''}${p === c.sheet ? ' is-sheet' : ''}" draggable="true" data-photo="${esc(p)}"><img src="${fileUrl(p)}" draggable="false" alt=""><button class="ficha-btn" data-ficha="${esc(p)}" title="${esc(p === c.sheet ? tr('characters.editor.removeCharacterSheet') : tr('characters.editor.markCharacterSheet'))}">${IC('star')}</button><button class="rm" data-key="${esc(p)}">×</button></div>`).join('')}
      </div>
    </div>
    <div class="variant-manager">
      <div class="variant-manager-head"><label>${esc(tr('characters.editor.variants', { count: (c.variants || []).length }))}</label><button type="button" class="mini-btn" id="chAddVariant">${IC('plus')} ${esc(tr('assets.associate.newVariant'))}</button></div>
      <div class="variant-list">${(c.variants || []).map((v) => `
        <div class="variant-item" data-variant="${v.id}">
          <div class="variant-item-head"><strong>${esc(v.name)}</strong><div>
            <button type="button" class="mini-btn" data-vact="rename">${esc(tr('common.edit'))}</button>
            <button type="button" class="mini-btn" data-vact="photo">${IC('upload')} ${esc(tr('common.upload'))}</button>
            <button type="button" class="mini-btn" data-vact="fromassets">${IC('image')} ${esc(tr('characters.editor.fromAssets'))}</button>
            <button type="button" class="mini-btn danger" data-vact="delete">${IC('trash')}</button>
          </div></div>
          ${v.description ? `<div class="hint">${esc(v.description)}</div>` : ''}
          <div class="variant-photos">${v.photos.map((p) => `<span class="ref-thumb${p === v.sheet ? ' is-sheet' : ''}"><img src="${fileUrl(p)}" alt=""><button class="ficha-btn" data-vficha="${esc(p)}" title="${esc(p === v.sheet ? tr('characters.editor.removeVariantSheet') : tr('characters.editor.markVariantSheet'))}">${IC('star')}</button><button class="rm" data-vphoto="${esc(p)}">×</button></span>`).join('') || `<span class="hint">${esc(tr('characters.editor.noPhotos'))}</span>`}</div>
        </div>`).join('')}</div>
    </div>` : `<p class="hint">${esc(tr('characters.editor.saveBeforePhotos'))}</p>`}
    <button class="generate-btn small" id="chSave">${esc(id ? tr('categories.saveChanges') : tr('characters.editor.create'))}</button>`;

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
        toast(tr('characters.updated'));
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
        $('#charModalTitle').textContent = tr('characters.editTitle');
        renderCharModal();
        toast(created.photos.length ? tr('characters.createdWithPhoto') : tr('characters.createdAddPhotos'));
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
      toast(tr('characters.editor.mirrorUpdated'));
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
      toast(tr('characters.editor.coverUsedAsMirror'));
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
      toast(tr('characters.editor.mirrorRemoved'));
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
      if (!confirm(tr('characters.editor.deleteVariantConfirm', { name: variant.name }))) return;
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
  $('#charAssetPickerTitle').textContent = tr('characters.assetPicker.photosFor', { name: v?.name || owner?.name || '' });
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
  $('#charAssetPickerHint').textContent = added ? trn('characters.assetPicker.addedBatch', added) : '';
  $('#charAssetPickerGrid').innerHTML = items.length ? items.map((a) => {
    const on = cp.added.has(a.key);
    return `<button class="shot-asset-cell${on ? ' selected' : ''}" data-k="${esc(a.key)}" title="${esc(a.name)}">
      <img src="${fileUrl(a.key)}" loading="lazy" alt="">${on ? `<span class="shot-asset-check">${IC('check')}</span>` : ''}</button>`;
  }).join('') : `<div class="hint">${esc(tr('characters.assetPicker.empty'))}</div>`;
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
        toast(tr('characters.photoRemoved'));
      } else {
        const before = pickerTargetPhotos();
        const updated = await api(endpoint, { method: 'POST', body: { assetKey: key } });
        const newKey = pickerTargetPhotos(updated).find((k) => !before.includes(k));
        if (newKey) cp.added.set(key, newKey);
        refreshPickerEntity(updated);
        toast(tr('characters.photoAdded'));
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
  $('#variantEditorTitle').textContent = variant ? tr('characters.variant.editTitle') : tr('characters.variant.newTitle');
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
    toast(variantId ? tr('characters.variant.updated') : tr('characters.variant.created'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// locaciones y objetos ("elementos")
// ---------------------------------------------------------------------------

const ELEMENT_KIND_LABEL = { location: tr('elements.location'), object: tr('elements.object') };

function elementCategories(kind = '') {
  return [...new Set(state.elements
    .filter((el) => !kind || el.kind === kind)
    .map((el) => (el.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, i18n.localeTag()));
}

function renderElements() {
  sortEntities();
  const catSel = $('#elementCategoryFilter');
  const cats = elementCategories(state.elementKindFilter);
  catSel.innerHTML = `<option value="">${esc(tr('common.allFeminine'))}</option>` + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  catSel.value = cats.includes(state.elementCategoryFilter) ? state.elementCategoryFilter : '';
  state.elementCategoryFilter = catSel.value;
  $$('#elementKindChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.ekind === state.elementKindFilter));

  const grid = $('#elementsGrid');
  const items = state.elements.filter((el) =>
    contentIsVisible(el) && (!state.elementKindFilter || el.kind === state.elementKindFilter)
    && (!state.elementCategoryFilter || (el.category || '') === state.elementCategoryFilter));
  if (!items.length) {
    grid.innerHTML = `<div class="empty-note">${esc(tr('elements.empty'))}</div>`;
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
      ${(el.variants || []).length ? `<div class="hint" style="margin-bottom:8px">${esc(trn('elements.variantCount', el.variants.length))}</div>` : ''}
      <div class="char-photos-mini">${minis}</div>
      <div class="char-actions">
        <button class="mini-btn" data-eact="use">${IC('link')} ${esc(tr('characters.usePhotos'))}</button>
        <button class="mini-btn" data-eact="edit">${IC('edit')} ${esc(tr('common.edit'))}</button>
        <button class="mini-btn" data-eact="gallery">${IC('eye')} ${esc(tr('characters.viewPhotos'))}</button>
        <button class="mini-btn" data-eact="assets">${IC('image')} Assets${linkedCount ? ` (${linkedCount})` : ''}</button>
        <button class="mini-btn danger" data-eact="del" title="${esc(tr('common.delete'))}">${IC('trash')}</button>
      </div>`;
    card.querySelectorAll('[data-eact]').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.eact;
        if (act === 'use') {
          if (!el.photos.length) return toast(tr('elements.noPhotos'), 'err');
          setMode('image');
          for (const p of el.photos) addRef(p, false);
          goToCreate();
          toast(tr('characters.photosAdded', { name: el.name }));
        }
        if (act === 'edit') openElementModal(el.id);
        if (act === 'gallery') openElementGallery(el.id);
        if (act === 'assets') openElementAssets(el.id);
        if (act === 'del') {
          if (!confirm(tr('elements.deleteConfirm', { name: el.name }))) return;
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
  $('#elementModalTitle').textContent = id ? tr('elements.editTitle') : tr('elements.new');
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
  const thumb = (p, attr) => `<span class="ref-thumb"><img src="${fileUrl(p)}" alt=""><button class="rm" ${attr}="${esc(p)}" title="${esc(tr('common.remove'))}">×</button></span>`;
  $('#elementModalBody').innerHTML = `
    <label>${esc(tr('assets.info.type'))}
      <select id="elKind" class="select">
        <option value="location"${(el?.kind || 'location') === 'location' ? ' selected' : ''}>${esc(tr('elements.location'))}</option>
        <option value="object"${el?.kind === 'object' ? ' selected' : ''}>${esc(tr('elements.object'))}</option>
      </select>
    </label>
    <label>${esc(tr('assets.associate.name'))}<input id="elName" type="text" maxlength="120" value="${esc(el?.name || '')}" placeholder="${esc(tr('elements.namePlaceholder'))}"></label>
    <label>${esc(tr('categories.category'))}<input id="elCategory" type="text" maxlength="80" value="${esc(el?.category || '')}" placeholder="${esc(tr('elements.categoryPlaceholder'))}"></label>
    <div id="elCategoryChips" class="chips"></div>
    <label>${esc(tr('common.description'))}<textarea id="elDescription" rows="3">${esc(el?.description || '')}</textarea></label>
    <label class="check-row"><input type="checkbox" id="elNsfw"${el?.nsfw ? ' checked' : ''}> ${esc(tr('common.nsfwContent'))}</label>
    ${el ? `
    ${el.photos.length ? `<div class="variant-manager"><label>${esc(tr('characters.editor.cover'))}</label><div id="elCover"></div></div>` : ''}
    <div class="variant-manager">
      <div class="variant-manager-head"><label>${esc(tr('characters.editor.photos', { count: el.photos.length }))}</label><div>
        <button type="button" class="mini-btn" id="elAddPhoto">${IC('upload')} ${esc(tr('common.upload'))}</button>
        <button type="button" class="mini-btn" id="elAddFromAssets">${IC('image')} ${esc(tr('characters.editor.fromAssets'))}</button>
      </div></div>
      <div class="variant-photos">${el.photos.map((p) => thumb(p, 'data-elphoto')).join('') || `<span class="hint">${esc(tr('characters.editor.noPhotos'))}</span>`}</div>
    </div>
    <div class="variant-manager">
      <div class="variant-manager-head"><label>${esc(tr('elements.variants', { count: (el.variants || []).length }))}</label><button type="button" class="mini-btn" id="elAddVariant">${IC('plus')} ${esc(tr('assets.associate.newVariant'))}</button></div>
      <div class="variant-list">${(el.variants || []).map((v) => `
        <div class="variant-item" data-elvariant="${v.id}">
          <div class="variant-item-head"><strong>${esc(v.name)}</strong><div>
            <button type="button" class="mini-btn" data-evact="rename">${esc(tr('common.edit'))}</button>
            <button type="button" class="mini-btn" data-evact="photo">${IC('upload')} ${esc(tr('common.upload'))}</button>
            <button type="button" class="mini-btn" data-evact="fromassets">${IC('image')} ${esc(tr('characters.editor.fromAssets'))}</button>
            <button type="button" class="mini-btn danger" data-evact="delete">${IC('trash')}</button>
          </div></div>
          ${v.description ? `<div class="hint">${esc(v.description)}</div>` : ''}
          <div class="variant-photos">${v.photos.map((p) => thumb(p, 'data-evphoto')).join('') || `<span class="hint">${esc(tr('characters.editor.noPhotos'))}</span>`}</div>
        </div>`).join('')}</div>
    </div>` : `<p class="hint">${esc(tr('elements.saveBeforePhotos'))}</p>`}
    <button class="generate-btn small" id="elSave">${esc(el ? tr('categories.saveChanges') : tr('categories.create'))}</button>`;

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
    if (!payload.name) return toast(tr('assets.info.nameRequired'), 'err');
    try {
      if (id) {
        refreshElement(await api(`/api/elements/${id}`, { method: 'PUT', body: payload }));
        toast(tr('common.saved'));
      } else {
        const created = await api('/api/elements', { method: 'POST', body: payload });
        state.elements.unshift(created);
        state.editingElementId = created.id;
        $('#elementModalTitle').textContent = tr('elements.editTitle');
        renderElementModal();
        renderElements();
        toast(tr('elements.createdAddPhotos', { name: created.name }));
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
      if (!confirm(tr('characters.editor.deleteVariantConfirm', { name: variant.name }))) return;
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
  const groups = [{ name: tr('picker.original'), description: el.description || '', photos: el.photos || [] }, ...(el.variants || [])];
  $('#characterGalleryBody').innerHTML = groups.map((group) => `
    <section class="character-gallery-group">
      <div class="character-gallery-group-head"><h4>${esc(group.name)}</h4><span>${esc(trn('characters.photoCount', group.photos.length))}</span></div>
      ${group.description ? `<p>${esc(group.description)}</p>` : ''}
      <div class="character-gallery-grid">${group.photos.length
        ? group.photos.map((photo) => `<button data-gallery-photo="${esc(photo)}"><img src="${fileUrl(photo)}" loading="lazy" alt=""></button>`).join('')
        : `<div class="hint">${esc(tr('characters.noVariantPhotos'))}</div>`}</div>
    </section>`).join('');
  $('#characterGalleryBody').querySelectorAll('[data-gallery-photo]').forEach((button) => {
    button.addEventListener('click', () => openLightbox(button.dataset.galleryPhoto, groups.flatMap((group) => group.photos || [])));
  });
  $('#characterGalleryModal').hidden = false;
}

function openElementAssets(id) {
  const el = state.elements.find((x) => x.id === id);
  if (!el) return;
  $('#characterGalleryTitle').textContent = tr('characters.associatedAssetsTitle', { name: el.name });
  const groups = [{ id: null, name: tr('picker.original') }, ...(el.variants || []).map((v) => ({ id: v.id, name: v.name }))];
  const links = state.elementLinks.filter((link) => link.elementId === id);
  $('#characterGalleryBody').innerHTML = groups.map((group) => {
    const items = links.filter((link) => (link.variantId || null) === group.id);
    return `<section class="character-gallery-group">
      <div class="character-gallery-group-head"><h4>${esc(group.name)}</h4><span>${esc(trn('characters.assetCount', items.length))}</span></div>
      <div class="character-gallery-grid linked-assets">${items.length ? items.map((link) => `
        <div class="linked-asset"><button data-gallery-photo="${esc(link.key)}"><img src="${fileUrl(link.key)}" loading="lazy" alt=""></button><button class="linked-remove" data-elunlink="${esc(link.key)}" title="${esc(tr('characters.removeAssociation'))}">×</button></div>`).join('') : `<div class="hint">${esc(tr('characters.noAssociatedAssets'))}</div>`}</div>
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
    if (received) toast(tr('automation.sync.received', { name: received.name }), 'ok');
    else if (updated) toast(tr('automation.sync.updated', { name: updated.name }), 'ok');
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
  for (const r of pr.requirements.characters) if (!automationAssignedEntity(pr, 'characters', r.role)) miss.push(tr('automation.requirements.character', { role: r.role }));
  for (const r of pr.requirements.locations) if (!automationAssignedEntity(pr, 'locations', r.role)) miss.push(tr('automation.requirements.location', { role: r.role }));
  for (const r of pr.requirements.objects) if (!automationAssignedEntity(pr, 'objects', r.role)) miss.push(tr('automation.requirements.object', { role: r.role }));
  return miss;
}

function renderAutomations() {
  const grid = $('#automationsGrid');
  if (!state.automations.length) {
    grid.innerHTML = `<div class="empty-note">${esc(tr('automation.empty'))}</div>`;
    return;
  }
  grid.innerHTML = '';
  for (const pr of state.automations) {
    const missing = automationMissing(pr).length;
    const card = document.createElement('div');
    card.className = 'char-card';
    card.innerHTML = `
      <div class="char-name">${esc(pr.name)}</div>
      <div class="hint" style="margin-bottom:8px">${esc(tr('automation.card.summary', {
        blocks: trn('automation.blockCount', pr.blocks.length),
        characters: trn('automation.characterCount', pr.requirements.characters.length),
        locations: trn('automation.locationCount', pr.requirements.locations.length),
        objects: trn('automation.objectCount', pr.requirements.objects.length)
      }))}</div>
      <div class="automation-status ${missing ? 'pending' : 'ready'}">${esc(missing ? trn('automation.missingRoles', missing) : tr('automation.allAssigned'))}</div>
      <div class="char-actions">
        <button class="mini-btn accent" data-aact="open">${IC('edit')} ${esc(tr('common.open'))}</button>
        <button class="mini-btn danger" data-aact="del" title="${esc(tr('common.delete'))}">${IC('trash')}</button>
      </div>`;
    card.querySelector('[data-aact="open"]').addEventListener('click', () => openAutomation(pr.id));
    card.querySelector('[data-aact="del"]').addEventListener('click', async () => {
      if (!confirm(tr('automation.deleteConfirm', { name: pr.name }))) return;
      await api(`/api/automations/${pr.id}`, { method: 'DELETE' });
      state.automations = state.automations.filter((x) => x.id !== pr.id);
      renderAutomations();
    });
    grid.appendChild(card);
  }
}

$('#btnNewAutomation').addEventListener('click', async () => {
  const name = window.prompt(tr('automation.projectNamePrompt'), tr('automation.defaultProjectName'));
  if (name === null) return;
  try {
    const created = await api('/api/automations', { method: 'POST', body: { name: name.trim() || tr('automation.defaultProjectName') } });
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
    toast(tr('automation.imported', { name: created.name, blocks: trn('automation.blockCount', created.blocks.length) }));
    openAutomation(created.id);
  } catch (err) { toast(tr('automation.importFailed', { error: err.message }), 'err'); }
});

function currentAutomation() {
  return state.automations.find((x) => x.id === state.openAutomationId) || null;
}

function formatAutomationBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${i18n?.formatNumber(bytes) ?? bytes} B`;
  if (bytes < 1024 ** 2) return `${i18n?.formatNumber(bytes / 1024, { maximumFractionDigits: 1 }) ?? (bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${i18n?.formatNumber(bytes / 1024 ** 2, { maximumFractionDigits: 1 }) ?? (bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${i18n?.formatNumber(bytes / 1024 ** 3, { maximumFractionDigits: 2 }) ?? (bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function finalizeAutomationProject(projectId) {
  const project = state.automations.find((item) => item.id === projectId);
  const button = $('#autoFinalize');
  if (!project || !button) return;
  const originalHtml = button.innerHTML;
  try {
    button.disabled = true;
    button.textContent = tr('automation.finalize.calculating');
    const preview = await api(`/api/automations/${projectId}/finalize`);
    if (preview.deleteCount) {
      const detail = [
        trn('automation.finalize.discardedFiles', preview.deleteCount),
        tr('automation.finalize.recoverable', { size: formatAutomationBytes(preview.deleteBytes) }),
        trn('automation.finalize.preservedActive', preview.activeCount),
        preview.sharedCount ? trn('automation.finalize.preservedShared', preview.sharedCount) : ''
      ].filter(Boolean).join('\n');
      if (!confirm(tr('automation.finalize.confirm', { name: project.name, detail }))) {
        button.disabled = false;
        button.innerHTML = originalHtml;
        return;
      }
    }
    button.textContent = tr(preview.deleteCount ? 'automation.finalize.deleting' : 'automation.finalize.checking');
    const result = await api(`/api/automations/${projectId}/finalize`, { method: 'POST' });
    const index = state.automations.findIndex((item) => item.id === projectId);
    if (index !== -1) state.automations[index] = result.project;
    state.history = result.history || state.history;
    renderHistory();
    await refreshAssets();
    if (state.openAutomationId === projectId) renderAutomationProject();
    if (result.failed?.length) {
      toast(tr('automation.finalize.partialFailure', { deleted: result.deleted, failed: result.failed.length }), 'err');
    } else if (result.deleted) {
      toast(trn('automation.finalize.completed', result.deleted, { size: formatAutomationBytes(result.project.finalization?.deletedBytes) }), 'ok');
    } else {
      toast(tr('automation.finalize.nothingToDelete'), 'ok');
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
  if (!pr || !confirm(tr('automation.deleteConfirm', { name: pr.name }))) return;
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
    toast(tr('automation.saved'));
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
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || tr('common.unnamed');
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
  return `<option value="">— ${esc(tr('automation.transition.chooseSound'))} —</option>` + [...groups.entries()].map(([category, sounds]) =>
    `<optgroup label="${esc(category)}">${sounds.map((sound) => `<option value="${esc(sound.id)}"${sound.id === selectedId ? ' selected' : ''}>${esc(sound.name)}</option>`).join('')}</optgroup>`
  ).join('');
}

function previewAutomationTransitionSound(soundId) {
  const sound = (state.transitionSounds || []).find((item) => item.id === soundId);
  if (!sound) return;
  if (automationTransitionPreview) automationTransitionPreview.pause();
  automationTransitionPreview = new Audio(sound.url);
  automationTransitionPreview.loop = false;
  automationTransitionPreview.play().catch(() => toast(tr('automation.transition.playFailed'), 'err'));
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
  if (inherit) options.push({ value: '', label: tr('automation.overlay.sameAsNormalFont') });
  for (const font of SYSTEM_OVERLAY_FONTS) options.push({ value: font, label: font });
  for (const font of state.fonts || []) options.push({ value: font.family, label: tr('automation.overlay.customFont', { name: font.name }) });
  if (selected && !options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: tr('automation.overlay.unavailableFont', { name: selected }) });
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
    .sort((a, b) => Number(isStylePrompt(b)) - Number(isStylePrompt(a)) || String(a.title).localeCompare(String(b.title), i18n.localeTag()));
  if (!prompts.length) return `<option value="">— ${esc(tr('automation.prompts.noneSaved'))} —</option>`;
  return `<option value="">— ${esc(tr('automation.prompts.chooseSaved'))} —</option>` + prompts.map((prompt) =>
    `<option value="${esc(prompt.id)}"${prompt.id === currentAutomation()?.config?.artStylePromptId ? ' selected' : ''}>${esc(tr(isStylePrompt(prompt) ? 'automation.prompts.styleReference' : 'common.image'))} · ${esc(prompt.category || tr('common.general'))} · ${esc(prompt.title)}</option>`
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
  }).join('') : `<span class="hint">${esc(tr('automation.assets.noSequenceItems'))}</span>`;
}

function overlayPresetOptions() {
  const items = state.overlayPresets || [];
  return `<option value="">— ${esc(tr('automation.textStyles.chooseSaved'))} —</option>` + items.map((item) =>
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
    <div class="prompt-style-image"><img src="${esc(fileUrl(key))}" alt="${esc(tr('automation.styleReference.alt'))}"><span class="prompt-style-label">${ARTISTIC_STYLE_LABEL}</span></div>
    <p>${esc(tr('automation.styleReference.hint'))}</p>
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
  if (!pr || !characterId) return toast(tr('automation.resources.assignCharacterFirst'), 'err');
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
      toast(tr(voiceId ? 'automation.resources.voiceAssignedRole' : 'automation.resources.voiceRemovedRole', { voice: voiceName, role }));
      renderAutomationProject();
      return;
    }
    const updated = await api(`/api/characters/${characterId}`, { method: 'PUT', body: { voiceId, voiceName } });
    const index = state.characters.findIndex((item) => item.id === characterId);
    if (index !== -1) state.characters[index] = updated;
    toast(tr(voiceId ? 'automation.resources.voiceAssignedCharacter' : 'automation.resources.voiceRemovedCharacter', { voice: voiceName, character: updated.name }));
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
  if (!pr || !requirement || !model) throw new Error(tr('automation.resources.roleOrModelMissing'));
  if (!prompt) throw new Error(tr('automation.resources.emptySheetPrompt'));

  let created = null;
  try {
    setStatus(tr('automation.pipeline.generatingWith', { model: model.name }));
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
    if (!assetKey) throw new Error(tr('automation.resources.noImageReturned'));

    setStatus(tr('automation.resources.savingAndAssigning'));
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
    toast(tr('automation.resources.generatedAssigned', {
      resource: tr(kind === 'characters' ? 'automation.resources.internalCard' : kind === 'locations' ? 'automation.resources.background' : 'automation.resources.object'),
      role,
      note: kind === 'characters' ? tr('automation.resources.notAddedToCharacters') : ''
    }));
    renderAutomationProject();
  } catch (error) {
    const suffix = error.automationResourceCreated ? ` ${tr('automation.resources.createdForManualAssignment')}` : '';
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

  if (!tasks.length) return toast(tr('automation.resources.allAssigned'), 'ok');
  if (!confirm(trn('automation.resources.generateMissingConfirm', tasks.length))) return;
  const monitorTaskId = startUiTask({
    title: tr('automation.resources.generatingForProject', { name: pr.name }),
    detail: tr('automation.resources.preparingFirst', { count: tasks.length }),
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
    updateUiTask(monitorTaskId, { current: index + 1, detail: tr('automation.resources.preparingRole', { current: index + 1, total: tasks.length, role: task.role }) });
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
      setStatus(tr('automation.resources.generatedCheck'));
      updateUiTask(monitorTaskId, { current: index + 1 });
    } catch (error) {
      const suffix = error.automationResourceCreated ? ` ${tr('automation.resources.createdForManualAssignment')}` : '';
      const message = `${error.message}${suffix}`;
      errors.push(`@${task.role}: ${message}`);
      setStatus(tr('automation.resources.failed', { error: message }), true);
    }
  }

  if (state.openAutomationId === projectId) renderAutomationProject();
  if (errors.length) {
    finishUiTask(monitorTaskId, { error: tr('automation.resources.bulkErrorSummary', { completed, total: tasks.length, errors: errors.length }) });
    toast(tr('automation.resources.bulkPartial', { completed, total: tasks.length, errors: errors.length }), 'err');
  } else {
    finishUiTask(monitorTaskId, { detail: tr('automation.resources.bulkDoneDetail', { completed, total: tasks.length }) });
    toast(tr('automation.resources.bulkDone', { completed, total: tasks.length }), 'ok');
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
        return toast(tr('automation.heygen.noCompleteSplit'), 'err');
      }
      const expectedAudio = Number(output.audioCountExpected) || (block.items || []).length;
      if (!Array.isArray(output.audioKeys) || output.audioKeys.length < expectedAudio) {
        return toast(tr('automation.heygen.missingSavedAudio'), 'err');
      }
      const label = tr(segmentIndex === 0 ? 'automation.heygen.wideShot' : 'automation.heygen.closeUp');
      if (!confirm(tr('automation.heygen.regenerateSegmentConfirm', { shot: label, title: block.title || tr('automation.thisBlock') }))) return;
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
  const locale = i18n?.localeTag() || 'es-AR';
  const search = String(picker.search || '').trim().toLocaleLowerCase(locale);
  const selected = new Set(picker.keys);
  const generativeVideoPicker = picker.purpose === 'generative-video-block';
  const sourceItems = generativeVideoPicker ? automationReferenceAssets() : automationVisualAssets();
  const items = sourceItems.filter((item) =>
    (picker.zone === 'all' || item.zone === picker.zone)
    && (!search || String(item.name || item.key).toLocaleLowerCase(locale).includes(search))
  );
  $$('#automationAssetsTabs [data-auto-assets-zone]').forEach((button) =>
    button.classList.toggle('active', button.dataset.autoAssetsZone === picker.zone));
  $('#automationAssetsSearch').value = picker.search || '';
  $('#automationAssetsPickerGrid').innerHTML = items.length ? items.map((item) => {
    const preview = automationAssetPreview(item);
    return `<button type="button" class="automation-assets-pick${selected.has(item.key) ? ' selected' : ''}" data-auto-asset-key="${esc(item.key)}">${preview}<span>${esc(item.name || item.key)}</span><b>${selected.has(item.key) ? picker.keys.indexOf(item.key) + 1 : '+'}</b></button>`;
  }).join('') : `<div class="empty-note">${esc(tr('automation.assets.noMatch'))}</div>`;
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
        return toast(tr('automation.assets.referenceLimits', {
          model: picker.modelName, total: limits.total, images: limits.image, videos: limits.video, audios: limits.audio
        }), 'err');
      }
      picker.keys.push(item.key);
    }
    renderAutomationAssetsPicker();
  }));

  $('#automationAssetsCount').textContent = trn('automation.assets.selected', picker.keys.length);
  $('#automationAssetsOrder').innerHTML = picker.keys.length ? picker.keys.map((key, index) => {
    const item = automationVisualAsset(key);
    const preview = automationAssetPreview(item, key);
    return `<div class="automation-assets-order-item" data-order-key="${esc(key)}"><b>${index + 1}</b>${preview}<span title="${esc(item.name || key)}">${esc(item.name || key)}</span><button type="button" class="icon-btn" data-order-up${index ? '' : ' disabled'} title="${esc(tr('common.moveUp'))}">↑</button><button type="button" class="icon-btn" data-order-down${index < picker.keys.length - 1 ? '' : ' disabled'} title="${esc(tr('common.moveDown'))}">↓</button><button type="button" class="icon-btn" data-order-remove title="${esc(tr('common.remove'))}">×</button></div>`;
  }).join('') : `<span class="hint">${generativeVideoPicker
    ? esc(tr('automation.assets.noAdditionalReferences', { model: picker.modelName }))
    : esc(tr('automation.assets.chooseVisual'))}</span>`;
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
  $('#automationAssetsTitle').textContent = tr('automation.assets.forBlock', { title: block.title || tr('automation.block') });
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
  $('#automationAssetsTitle').textContent = tr('automation.assets.referencesForBlock', { model: model?.name || '', title: block.title || tr('automation.block') });
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
  if (!state.automationAssetPicker?.keys.length) return toast(tr('automation.assets.chooseFile'), 'err');
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
  $('#automationMeta').textContent = tr('automation.projectMeta', {
    blocks: trn('automation.blockCount', pr.blocks.length),
    status: missing.length ? trn('automation.missingAssignments', missing.length) : tr('automation.readyToRun')
  });
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
  const textRefreshTargetLabel = tr(effectOutput ? 'automation.textRefresh.effectVersion' : 'automation.textRefresh.cleanFinal');
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
    const kindLabel = tr(kind === 'characters' ? 'automation.resources.character' : kind === 'locations' ? 'automation.resources.background' : 'automation.resources.object');
    return `<div class="assign-row resource-role-card" data-role-card="${kind}:${esc(r.role)}">
      <div class="assign-copy">
        <span class="assign-role">@${esc(r.role)}</span>
        <span class="assign-desc hint">${esc(r.description || '')}</span>
        ${r.clothing ? `<span class="assign-detail"><strong>${esc(tr('automation.resources.clothing'))}:</strong> ${esc(r.clothing)}</span>` : ''}
        ${kind === 'characters' && r.voice ? `<span class="assign-detail"><strong>${esc(tr('automation.resources.suggestedVoice'))}:</strong> ${esc(r.voice)}</span>` : ''}
      </div>
        ${cover ? `<button type="button" class="role-sheet-preview" data-open-asset="${esc(cover)}" title="${esc(tr('automation.resources.openProfile', { note: assigned?.automationOnly ? tr('automation.resources.convertManuallyNote') : '' }))}"><img src="${fileUrl(cover)}" alt=""></button>` : ''}
      <div class="role-resource-controls">
        <label>${esc(tr('automation.resources.assigned', { resource: kindLabel }))}</label>
         <select class="select" data-assign="${kind}:${esc(r.role)}">
           <option value="">— ${esc(tr('automation.resources.unassigned'))} —</option>
           ${generated ? `<option value="${esc(generated.id)}"${generated.id === cur ? ' selected' : ''}>${esc(generated.name)} · ${esc(tr('automation.resources.thisProjectOnly'))}</option>` : ''}
           ${options.map((o) => `<option value="${o.id}"${o.id === cur ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}
         </select>
        <label>${esc(tr('automation.resources.modelForProfile'))}</label>
        <div class="role-generate-line">
          <select class="select" data-role-model>
            ${models.map((item) => `<option value="${item.id}"${item.id === model?.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}
          </select>
          <button type="button" class="mini-btn" data-generate-resource>${IC('spark')} ${esc(tr('automation.resources.generate', { resource: kindLabel }))}</button>
        </div>
        ${kind === 'characters' ? `<label>${esc(tr('automation.resources.characterVoice'))}</label>
          <div class="role-generate-line">
            <select class="select" data-role-voice>
              <option value="">— ${esc(tr('automation.resources.noOwnVoice'))} —</option>
              ${(state.voices || []).map((voice) => `<option value="${voice.id}"${voice.id === selectedVoiceId ? ' selected' : ''}>${esc(voice.name)}${voice.category ? ` · ${esc(voice.category)}` : ''}</option>`).join('')}
            </select>
            <button type="button" class="mini-btn" data-save-role-voice${cur ? '' : ' disabled'}>${esc(tr('automation.resources.saveVoice'))}</button>
          </div>
          <span class="hint">${cur ? (assigned?.voiceId ? esc(tr('automation.resources.currentVoice', { voice: assigned.voiceName || assigned.voiceId })) : esc(tr('automation.resources.characterHasNoVoice'))) : esc(tr('automation.resources.voiceStoredInternally'))}${assigned?.automationOnly ? ` ${esc(tr('automation.resources.notInCharacterLibrary'))}` : ''}</span>` : ''}
      </div>
      <label class="role-prompt-label">${esc(tr('automation.resources.profilePrompt'))}
        <textarea data-role-prompt rows="5">${esc(automationResourcePrompt(kind, r))}</textarea>
      </label>
      <span class="hint role-status" data-role-status></span>
    </div>`;
  };

  $('#automationRoot').innerHTML = `
    <div class="automation-panel">
      <div class="automation-panel-heading">
        <div>
          <h3>${esc(tr('automation.roles.title'))}</h3>
          <span class="hint" id="autoResourcesProgress">${esc(missing.length ? trn('automation.roles.assetsMissing', missing.length) : tr('automation.roles.allAssetsAssigned'))}</span>
        </div>
        <button type="button" class="generate-btn" id="autoGenerateAllResources"${missing.length ? '' : ' disabled'}>
          ${IC('spark')} ${esc(tr('automation.roles.generateAllMissing'))}
        </button>
      </div>
      ${pr.requirements.characters.length ? `<div class="assign-group"><h4>${esc(tr('characters.title'))}</h4>${pr.requirements.characters.map((r) => assignRow('characters', r, chars)).join('')}</div>` : ''}
      ${pr.requirements.locations.length ? `<div class="assign-group"><h4>${esc(tr('automation.roles.locations'))}</h4>${pr.requirements.locations.map((r) => assignRow('locations', r, locs)).join('')}</div>` : ''}
      ${pr.requirements.objects.length ? `<div class="assign-group"><h4>${esc(tr('automation.roles.objects'))}</h4>${pr.requirements.objects.map((r) => assignRow('objects', r, objs)).join('')}</div>` : ''}
      ${!pr.requirements.characters.length && !pr.requirements.locations.length && !pr.requirements.objects.length ? `<p class="hint">${esc(tr('automation.roles.noRequirements'))}</p>` : ''}
    </div>

    <div class="automation-panel">
      <h3>${esc(tr('config.title'))}</h3>
      <div class="control-row"><label>${esc(tr('automation.config.projectName'))}</label>
        <input type="text" id="autoProjectName" maxlength="120" value="${esc(pr.name)}">
        <span class="hint">${esc(tr('automation.config.projectNameHint'))}</span>
      </div>
      <div class="control-row auto-style-row"><label>${esc(tr('automation.config.globalArtStyle'))}</label>
        <div class="auto-style-field">
          <textarea id="autoArtStyle" maxlength="1200" rows="3" placeholder="Write the global art direction in English…">${esc(pr.config.artStyle || DEFAULT_AUTOMATION_ART_STYLE)}</textarea>
          <div class="auto-style-prompt-tools">
            <select class="select" id="autoArtPrompt">${automationArtPromptOptions()}</select>
            <button type="button" class="mini-btn" id="autoApplyArtPrompt"${(state.prompts || []).some((prompt) => !['audio', 'video'].includes(prompt.mode)) ? '' : ' disabled'}>${IC('book')} ${esc(tr('automation.config.useSavedPrompt'))}</button>
          </div>
          ${automationStyleReferenceMarkup(pr)}
          <span class="hint">${esc(tr('automation.config.globalArtStyleHint'))}</span>
        </div>
      </div>
      <div class="control-row"><label>${esc(tr('automation.config.imageModel'))}</label>
        <select class="select" id="autoModel">${models.map((m) => `<option value="${m.id}"${m.id === model?.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <label>${esc(tr('automation.config.fallbackModel'))}</label>
        <select class="select" id="autoFallbackModel">
          <option value="">— ${esc(tr('automation.config.noFallback'))} —</option>
          ${models.map((m) => `<option value="${m.id}"${m.id === pr.config.fallbackImageModelId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select>
        <span class="hint">${esc(tr('automation.config.fallbackHint'))}</span>
      </div>
      <div class="control-row"><label>${esc(tr('automation.config.aspectRatio'))}</label>
        <select class="select" id="autoAr">${(model?.aspectRatios || []).map((a) => `<option${a === pr.config.aspectRatio ? ' selected' : ''}>${a}</option>`).join('')}</select>
        <label>${esc(tr('automation.config.resolution'))}</label>
        <select class="select" id="autoRes">${(model?.resolutions || []).map((r) => `<option${r === pr.config.resolution ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="control-row"><label>${esc(tr('automation.config.narratorVoice'))}</label>
        <select class="select" id="autoVoice"><option value="">— ${esc(tr('automation.config.chooseVoice'))} —</option>${(state.voices || []).map((v) => `<option value="${v.id}"${v.id === pr.config.narratorVoiceId ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        <label>${esc(tr('automation.config.elevenLabsModel'))}</label>
        <select class="select" id="autoAudioModel">${(state.audioModels || []).map((audioModel) => `<option value="${esc(audioModel.id)}"${audioModel.id === automationAudioModel?.id ? ' selected' : ''}>${esc(audioModel.name)}</option>`).join('')}</select>
        <span class="hint">${esc(tr('automation.config.dialogueVoiceHint'))} ${esc(automationAudioModel?.notes || '')}</span>
      </div>
      <div class="control-row"><label>${esc(tr('automation.config.heygenConnection'))}</label>
        <select class="select" id="autoHeyGenAuth"><option value="key"${pr.config.heygenAuthMode === 'oauth' ? '' : ' selected'}>API key</option><option value="oauth"${pr.config.heygenAuthMode === 'oauth' ? ' selected' : ''}>OAuth · plan web</option></select>
        <span class="hint">${esc(pr.config.heygenAuthMode === 'oauth' ? (state.heygenOAuth.connected ? tr('automation.config.oauthConnected') : tr('automation.config.oauthNotConnected')) : (state.config?.keys?.heygen ? tr('automation.config.apiKeyConfigured') : tr('automation.config.apiKeyMissing')))}</span>
      </div>
      <div class="automation-music-panel${music.enabled ? ' enabled' : ''}" id="autoMusicPanel">
        <div class="automation-music-head">
          <div><h4>${esc(tr('automation.music.title'))}</h4><span class="hint">${esc(tr('automation.music.hint'))}</span></div>
          <label class="poser-toggle"><input type="checkbox" id="autoMusicEnabled"${music.enabled ? ' checked' : ''}> ${esc(tr('automation.music.use'))}</label>
        </div>
        <div class="automation-music-grid">
          <label class="automation-music-source"><span>${esc(tr('automation.music.source'))}</span><select class="select" id="autoMusicSource">
            <option value="asset"${music.source === 'asset' ? ' selected' : ''}>${esc(tr('automation.music.fromAssets'))}</option>
            <option value="auto"${music.source === 'auto' ? ' selected' : ''}>${esc(tr('automation.music.autoByTags'))}</option>
            <option value="suno"${music.source === 'suno' ? ' selected' : ''}>${esc(tr('automation.music.generateSuno'))}</option>
          </select></label>
          <label class="automation-music-track"><span>${esc(tr('automation.music.track'))}</span><select class="select" id="autoMusicTrack"><option value="">— ${esc(tr('automation.music.none'))} —</option>${musicAssets.map((asset) => `<option value="${esc(asset.key)}"${asset.key === music.assetKey ? ' selected' : ''}>${esc(asset.name)}</option>`).join('')}</select></label>
          <label class="automation-music-gain"><span>${esc(tr('automation.music.level'))}</span><input type="number" id="autoMusicGain" min="-60" max="0" step="1" value="${Number(music.gainDb).toFixed(1)}"></label>
          <label class="automation-music-model"><span>${esc(tr('automation.music.sunoModel'))}</span><select class="select" id="autoMusicModel">${(state.musicModel?.versions || [music.sunoModel]).map((version) => `<option value="${esc(version)}"${version === music.sunoModel ? ' selected' : ''}>${esc(version)}</option>`).join('')}</select></label>
          <label class="automation-music-toggle"><span>${esc(tr('automation.music.ending'))}</span><span><input type="checkbox" id="autoMusicFadeOut"${music.fadeOut ? ' checked' : ''}> Fade out</span></label>
          <label class="automation-music-fade"><span>${esc(tr('automation.music.fadeDuration'))}</span><input type="number" id="autoMusicFadeSeconds" min="0.25" max="30" step="0.25" value="${music.fadeOutSeconds}"${music.fadeOut ? '' : ' disabled'}></label>
          <label class="automation-music-genres"><span>${esc(tr('assets.audio.genre'))}</span><input type="text" id="autoMusicGenres" value="${esc((music.genres || []).join(', '))}" placeholder="ambient, orchestral"></label>
          <label class="automation-music-instruments"><span>${esc(tr('assets.audio.instruments'))}</span><input type="text" id="autoMusicInstruments" value="${esc((music.instruments || []).join(', '))}" placeholder="piano, strings"></label>
          <label class="automation-music-moods"><span>${esc(tr('assets.audio.moods'))}</span><input type="text" id="autoMusicMoods" value="${esc((music.moods || []).join(', '))}" placeholder="mysterious, tense"></label>
        </div>
        <div class="automation-music-actions">
          <button type="button" class="mini-btn" id="autoMusicAuto">${IC('spark')} ${esc(tr('automation.music.chooseAutomatically'))}</button>
          <button type="button" class="mini-btn" id="autoMusicGenerate">${IC('music')} ${esc(tr('automation.music.generateSuno'))}</button>
          <button type="button" class="mini-btn" id="autoMusicUpload">${IC('upload')} ${esc(tr('automation.music.upload'))}</button>
          <button type="button" class="mini-btn" id="autoMusicTest"${selectedMusic ? '' : ' disabled'}>${IC('play')} ${esc(tr(musicTestVoiceKey ? 'automation.music.testWithVoice' : 'automation.music.test'))}</button>
          <span class="hint" id="autoMusicStatus">${selectedMusic ? esc(tr('automation.music.selected', { name: selectedMusic.name })) : music.assetKey ? esc(tr('automation.music.unavailable')) : esc(tr('automation.music.notSelected'))}</span>
        </div>
        ${selectedMusic ? `<audio class="automation-music-preview" id="autoMusicPreview" src="${fileUrl(selectedMusic.key)}" controls preload="metadata"></audio>${musicTestVoiceKey ? `<audio id="autoMusicVoicePreview" src="${fileUrl(musicTestVoiceKey)}" preload="metadata" hidden></audio>` : ''}<span class="hint automation-music-test-hint">${esc(tr(musicTestVoiceKey ? 'automation.music.previewWithVoice' : 'automation.music.previewNeedsVoice', { gain: Number(music.gainDb).toFixed(1) }))}</span>` : ''}
      </div>
      <div class="automation-transition-panel${transitionSound.enabled ? ' enabled' : ''}" id="autoTransitionPanel">
        <div class="automation-transition-head">
          <div><h4>${esc(tr('automation.transition.title'))}</h4><span class="hint">${esc(tr('automation.transition.hint'))}</span></div>
          <label class="poser-toggle"><input type="checkbox" id="autoTransitionEnabled"${transitionSound.enabled ? ' checked' : ''}> ${esc(tr('common.enable'))}</label>
        </div>
        <div class="automation-transition-controls">
          <label><span>${esc(tr('automation.transition.soundByCategory'))}</span><select class="select" id="autoTransitionSound">${automationTransitionSoundOptions(transitionSound.soundId)}</select></label>
          <button type="button" class="mini-btn" id="autoTransitionTest"${selectedTransitionSound ? '' : ' disabled'}>${IC('play')} ${esc(tr('automation.transition.testOnce'))}</button>
          <span class="hint" id="autoTransitionStatus">${selectedTransitionSound ? `${esc(selectedTransitionSound.category)} · ${esc(selectedTransitionSound.name)}` : esc((state.transitionSounds || []).length ? tr('automation.transition.chooseHint') : tr('automation.transition.noneInstalled'))}</span>
        </div>
      </div>
      <div class="overlay-preset-bar">
        <div><h4>${esc(tr('automation.textStyles.title'))}</h4><span class="hint">${esc(tr('automation.textStyles.hint'))}</span></div>
        <select class="select" id="overlayPresetSelect">${overlayPresetOptions()}</select>
        <button type="button" class="mini-btn" id="overlayPresetApply"${(state.overlayPresets || []).length ? '' : ' disabled'}>${IC('check')} ${esc(tr('common.apply'))}</button>
        <button type="button" class="mini-btn accent" id="overlayPresetSave">${IC('save')} ${esc(tr('automation.textStyles.saveCurrent'))}</button>
        <button type="button" class="mini-btn danger" id="overlayPresetDelete" disabled>${IC('trash')}</button>
      </div>
      <div class="automation-dynamic-text-panel${dynamicText.enabled ? ' enabled' : ''}" id="autoDynamicTextPanel">
        <div class="automation-dynamic-text-head">
          <div>
            <h4>${esc(tr('automation.dynamicText.title'))}</h4>
            <span class="hint">${esc(tr('automation.dynamicText.hint'))}</span>
          </div>
          <label class="poser-toggle"><input type="checkbox" id="autoDynamicTextEnabled"${dynamicText.enabled ? ' checked' : ''}> ${esc(tr('common.enable'))}</label>
        </div>
        <div class="automation-dynamic-text-grid">
          <label><span>${esc(tr('automation.dynamicText.titleAnimation'))}</span><select class="select" id="autoTitleAnimation">
            <option value="rise"${dynamicText.titleAnimation === 'rise' ? ' selected' : ''}>${esc(tr('automation.dynamicText.rise'))}</option>
            <option value="slam"${dynamicText.titleAnimation === 'slam' ? ' selected' : ''}>${esc(tr('automation.dynamicText.slam'))}</option>
            <option value="typewriter"${dynamicText.titleAnimation === 'typewriter' ? ' selected' : ''}>${esc(tr('automation.dynamicText.typewriter'))}</option>
          </select></label>
          <label><span>${esc(tr('automation.dynamicText.captionAnimation'))}</span><select class="select" id="autoCaptionAnimation">
            <option value="word-pop"${dynamicText.captionAnimation === 'word-pop' ? ' selected' : ''}>${esc(tr('automation.dynamicText.wordPop'))}</option>
            <option value="karaoke"${dynamicText.captionAnimation === 'karaoke' ? ' selected' : ''}>${esc(tr('automation.dynamicText.karaoke'))}</option>
            <option value="bounce"${dynamicText.captionAnimation === 'bounce' ? ' selected' : ''}>${esc(tr('automation.dynamicText.bounce'))}</option>
          </select></label>
          <label><span>${esc(tr('automation.dynamicText.wordsPerGroup'))}</span><input type="number" id="autoWordsPerPage" min="1" max="12" step="1" value="${dynamicText.wordsPerPage}"></label>
        </div>
        <span class="hint automation-dynamic-text-note">${esc(tr('automation.dynamicText.timingHint'))}</span>
      </div>
      <h4>${esc(tr('automation.overlay.title'))}</h4>
      <div class="overlay-typography-grid">
        <div class="overlay-type-card">
          <h5>${esc(tr('automation.overlay.normalText'))}</h5>
          <label><span>${esc(tr('automation.overlay.font'))}</span><span class="overlay-font-line"><select class="select" id="ovFont">${overlayFontOptions(pr.config.overlay.font)}</select><button type="button" class="mini-btn" data-import-font="font">${esc(tr('common.import'))}</button></span></label>
          <label><span>${esc(tr('automation.overlay.size'))}</span><input type="number" id="ovSize" min="8" max="300" step="1" value="${pr.config.overlay.fontSizePx}"></label>
          <label><span>${esc(tr('automation.overlay.weight'))}</span><select class="select" id="ovWeight">${[400, 500, 600, 700, 800, 900].map((weight) => `<option value="${weight}"${weight === pr.config.overlay.fontWeight ? ' selected' : ''}>${weight}</option>`).join('')}</select></label>
          <label><span>${esc(tr('automation.overlay.letterCase'))}</span><select class="select" id="ovTransform">${[['none', tr('automation.overlay.asWritten')], ['uppercase', tr('automation.overlay.uppercase')], ['lowercase', tr('automation.overlay.lowercase')], ['capitalize', tr('automation.overlay.capitalize')]].map(([value, label]) => `<option value="${value}"${value === (pr.config.overlay.textTransform || 'none') ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
          <div class="overlay-format-options" aria-label="${esc(tr('automation.overlay.normalFormat'))}">
            <label><input type="checkbox" id="ovItalic"${pr.config.overlay.fontItalic ? ' checked' : ''}> <em>${esc(tr('automation.overlay.italic'))}</em></label>
            <label><input type="checkbox" id="ovUnderline"${pr.config.overlay.fontUnderline ? ' checked' : ''}> <u>${esc(tr('automation.overlay.underline'))}</u></label>
            <label><input type="checkbox" id="ovStrike"${pr.config.overlay.fontStrikeThrough ? ' checked' : ''}> <s>${esc(tr('automation.overlay.strike'))}</s></label>
          </div>
          <label><span>${esc(tr('automation.overlay.color'))}</span><input type="color" id="ovColor" value="${pr.config.overlay.color}"></label>
          <label><span>${esc(tr('automation.overlay.strokeColor'))}</span><input type="color" id="ovStroke" value="${pr.config.overlay.strokeColor}"></label>
          <label><span>${esc(tr('automation.overlay.strokeWidth'))}</span><input type="number" id="ovStrokeW" min="0" max="30" step="0.5" value="${pr.config.overlay.strokeWidthPx}"></label>
        </div>
        <div class="overlay-type-card highlight">
          <h5>${esc(tr('automation.overlay.highlightedText'))}</h5>
          <label><span>${esc(tr('automation.overlay.font'))}</span><span class="overlay-font-line"><select class="select" id="ovHlFont">${overlayFontOptions(pr.config.overlay.highlightFont || '', { inherit: true })}</select><button type="button" class="mini-btn" data-import-font="highlightFont">${esc(tr('common.import'))}</button></span></label>
          <label><span>${esc(tr('automation.overlay.size'))}</span><input type="number" id="ovHlSize" min="8" max="300" step="1" value="${pr.config.overlay.highlightFontSizePx}"></label>
          <label><span>${esc(tr('automation.overlay.weight'))}</span><select class="select" id="ovHlWeight">${[400, 500, 600, 700, 800, 900].map((weight) => `<option value="${weight}"${weight === pr.config.overlay.highlightFontWeight ? ' selected' : ''}>${weight}</option>`).join('')}</select></label>
          <label><span>${esc(tr('automation.overlay.letterCase'))}</span><select class="select" id="ovHlTransform">${[['none', tr('automation.overlay.asWritten')], ['uppercase', tr('automation.overlay.uppercase')], ['lowercase', tr('automation.overlay.lowercase')], ['capitalize', tr('automation.overlay.capitalize')]].map(([value, label]) => `<option value="${value}"${value === (pr.config.overlay.highlightTextTransform || 'none') ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
          <div class="overlay-format-options" aria-label="${esc(tr('automation.overlay.highlightFormat'))}">
            <label><input type="checkbox" id="ovHlItalic"${pr.config.overlay.highlightFontItalic ? ' checked' : ''}> <em>${esc(tr('automation.overlay.italic'))}</em></label>
            <label><input type="checkbox" id="ovHlUnderline"${pr.config.overlay.highlightFontUnderline ? ' checked' : ''}> <u>${esc(tr('automation.overlay.underline'))}</u></label>
            <label><input type="checkbox" id="ovHlStrike"${pr.config.overlay.highlightFontStrikeThrough ? ' checked' : ''}> <s>${esc(tr('automation.overlay.strike'))}</s></label>
          </div>
          <label><span>${esc(tr('automation.overlay.color'))}</span><input type="color" id="ovHl" value="${pr.config.overlay.highlightColor || '#fbbf24'}"></label>
          <label><span>${esc(tr('automation.overlay.strokeColor'))}</span><input type="color" id="ovHlStroke" value="${pr.config.overlay.highlightStrokeColor || '#000000'}"></label>
          <label><span>${esc(tr('automation.overlay.strokeWidth'))}</span><input type="number" id="ovHlStrokeW" min="0" max="30" step="0.5" value="${pr.config.overlay.highlightStrokeWidthPx}"></label>
        </div>
      </div>
      <input type="file" id="ovFontFile" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden>
      <span class="hint">${esc(tr('automation.overlay.fontHint'))}</span>
      <div class="overlay-layout-controls">
        <label><span>${esc(tr('automation.overlay.verticalPosition'))}</span><select class="select" id="ovPos">${[['top', tr('automation.overlay.top')], ['center', tr('automation.overlay.center')], ['bottom', tr('automation.overlay.bottom')]].map(([v, l]) => `<option value="${v}"${v === pr.config.overlay.position ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label><span>${esc(tr('automation.overlay.horizontalAlign'))}</span><select class="select" id="ovAlign">${[['left', tr('automation.overlay.left')], ['center', tr('automation.overlay.center')], ['right', tr('automation.overlay.right')]].map(([v, l]) => `<option value="${v}"${v === (pr.config.overlay.align || 'center') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label><span>${esc(tr('automation.overlay.maxWidth'))}</span><input type="number" id="ovMaxWidth" min="20" max="100" step="1" value="${pr.config.overlay.maxWidthPct || 88}"></label>
        <button type="button" class="mini-btn" id="ovCenterX">${esc(tr('automation.overlay.centerHorizontally'))}</button>
        <label class="poser-toggle"><input type="checkbox" id="ovBg" ${pr.config.overlay.bg ? 'checked' : ''}> ${esc(tr('automation.overlay.backgroundBox'))}</label>
      </div>
      <div class="title-overlay-panel${titleOverlay.enabled ? ' enabled' : ''}" id="autoTitlePanel">
        <div class="title-overlay-heading">
          <div><h4>${esc(tr('automation.overlay.titles'))}</h4><span class="hint">${esc(tr('automation.overlay.titlesHint'))}</span></div>
          <label class="poser-toggle"><input type="checkbox" id="autoTitleEnabled"${titleOverlay.enabled ? ' checked' : ''}> ${esc(tr('automation.overlay.includeTitle'))}</label>
        </div>
        <div class="title-overlay-targets">
          <label><span>${esc(tr('automation.overlay.whichTitle'))}</span><select class="select" id="autoTitleMode"><option value="block"${titleOverlay.mode === 'block' ? ' selected' : ''}>${esc(tr('automation.overlay.eachBlockTitle'))}</option><option value="project"${titleOverlay.mode === 'project' ? ' selected' : ''}>${esc(tr('automation.overlay.projectTitle'))}</option></select></label>
          <label id="autoTitleTextField"><span>${esc(tr('automation.overlay.projectTitleText'))}</span><input type="text" id="autoTitleText" maxlength="300" value="${esc(titleOverlay.text || pr.integration?.scriptTitle || pr.name)}"></label>
          <label><span id="autoTitleBlockLabel">${esc(tr(titleOverlay.mode === 'block' ? 'automation.overlay.previewBlock' : 'automation.overlay.showProjectTitleIn'))}</span><select class="select" id="autoTitleBlock">${pr.blocks.map((block, index) => `<option value="${esc(block.id)}"${block.id === titleOverlay.blockId ? ' selected' : ''}>${esc(tr('automation.script.blockNumber', { number: index + 1 }))}${block.title ? ` · ${esc(block.title)}` : ''}</option>`).join('')}</select></label>
        </div>
        <div class="overlay-type-card title">
          <h5>${esc(tr('automation.overlay.independentTitleStyle'))}</h5>
          <label><span>${esc(tr('automation.overlay.font'))}</span><span class="overlay-font-line"><select class="select" id="titleFont">${overlayFontOptions(titleOverlay.font)}</select><button type="button" class="mini-btn" data-import-font="titleFont">${esc(tr('common.import'))}</button></span></label>
          <label><span>${esc(tr('automation.overlay.size'))}</span><input type="number" id="titleSize" min="8" max="300" step="1" value="${titleOverlay.fontSizePx}"></label>
          <label><span>${esc(tr('automation.overlay.weight'))}</span><select class="select" id="titleWeight">${[400, 500, 600, 700, 800, 900].map((weight) => `<option value="${weight}"${weight === titleOverlay.fontWeight ? ' selected' : ''}>${weight}</option>`).join('')}</select></label>
          <label><span>${esc(tr('automation.overlay.letterCase'))}</span><select class="select" id="titleTransform">${[['none', tr('automation.overlay.asWritten')], ['uppercase', tr('automation.overlay.uppercase')], ['lowercase', tr('automation.overlay.lowercase')], ['capitalize', tr('automation.overlay.capitalize')]].map(([value, label]) => `<option value="${value}"${value === titleOverlay.textTransform ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
          <div class="overlay-format-options" aria-label="${esc(tr('automation.overlay.titleFormat'))}">
            <label><input type="checkbox" id="titleItalic"${titleOverlay.fontItalic ? ' checked' : ''}> <em>${esc(tr('automation.overlay.italic'))}</em></label>
            <label><input type="checkbox" id="titleUnderline"${titleOverlay.fontUnderline ? ' checked' : ''}> <u>${esc(tr('automation.overlay.underline'))}</u></label>
            <label><input type="checkbox" id="titleStrike"${titleOverlay.fontStrikeThrough ? ' checked' : ''}> <s>${esc(tr('automation.overlay.strike'))}</s></label>
          </div>
          <label><span>${esc(tr('automation.overlay.color'))}</span><input type="color" id="titleColor" value="${titleOverlay.color}"></label>
          <label><span>${esc(tr('automation.overlay.strokeColor'))}</span><input type="color" id="titleStroke" value="${titleOverlay.strokeColor}"></label>
          <label><span>${esc(tr('automation.overlay.strokeWidth'))}</span><input type="number" id="titleStrokeW" min="0" max="30" step="0.5" value="${titleOverlay.strokeWidthPx}"></label>
        </div>
        <div class="overlay-layout-controls title-layout-controls">
          <label><span>${esc(tr('automation.overlay.verticalPosition'))}</span><select class="select" id="titlePos">${[['top', tr('automation.overlay.top')], ['center', tr('automation.overlay.center')], ['bottom', tr('automation.overlay.bottom')]].map(([value, label]) => `<option value="${value}"${value === titleOverlay.position ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
          <label><span>${esc(tr('automation.overlay.horizontalAlign'))}</span><select class="select" id="titleAlign">${[['left', tr('automation.overlay.left')], ['center', tr('automation.overlay.center')], ['right', tr('automation.overlay.right')]].map(([value, label]) => `<option value="${value}"${value === titleOverlay.align ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
          <label><span>${esc(tr('automation.overlay.maxWidth'))}</span><input type="number" id="titleMaxWidth" min="20" max="100" step="1" value="${titleOverlay.maxWidthPct}"></label>
          <button type="button" class="mini-btn" id="titleCenterX">${esc(tr('automation.overlay.centerHorizontally'))}</button>
          <label class="poser-toggle"><input type="checkbox" id="titleBg"${titleOverlay.bg ? ' checked' : ''}> ${esc(tr('automation.overlay.backgroundBox'))}</label>
        </div>
      </div>
      <div class="ov-preview-tools">
        <button type="button" class="mini-btn" id="ovPickBg">${IC('image')} ${esc(tr('automation.overlay.referenceBackground'))}</button>
        ${pr.config.overlay.previewBg ? `<button type="button" class="mini-btn" id="ovClearBg">${esc(tr('automation.overlay.removeBackground'))}</button>` : ''}
        <span class="hint">${esc(tr('automation.overlay.dragHint'))}</span>
      </div>
      <div class="ov-preview" id="ovPreview" style="aspect-ratio:${(pr.config.aspectRatio || '9:16').replace(':', '/')}">
        ${pr.config.overlay.previewBg ? `<img class="ov-preview-bg" src="${fileUrl(pr.config.overlay.previewBg)}" alt="">` : ''}
        <div class="ov-title" id="ovTitle"${titleOverlay.enabled ? '' : ' hidden'}>${esc(titleOverlay.text || pr.integration?.scriptTitle || pr.name)}</div>
        <div class="ov-text" id="ovText"><span class="ov-normal">${esc(tr('automation.overlay.previewBefore'))}</span><span class="ov-hl">${esc(tr('automation.overlay.previewHighlight'))}</span><span class="ov-normal">${esc(tr('automation.overlay.previewAfter'))}</span></div>
      </div>
    </div>

    <div class="automation-panel">
      <div class="automation-panel-heading automation-script-heading">
        <div><h3>${esc(tr('automation.script.title', { blocks: trn('automation.blockCount', pr.blocks.length) }))}</h3><span class="hint">${esc(tr('automation.script.manualHint'))}</span></div>
        <button type="button" class="mini-btn accent" id="autoAddBlock">${IC('plus')} ${esc(tr('automation.script.addBlock'))}</button>
      </div>
      <form class="auto-block-create" id="autoNewBlockForm" hidden>
        <div class="auto-block-create-head"><div><strong>${esc(tr('automation.script.newManualBlock'))}</strong><span class="hint">${esc(tr('automation.script.saveDoesNotGenerate'))}</span></div><button type="button" class="mini-btn" id="autoNewBlockCancel">${esc(tr('common.cancel'))}</button></div>
        <div class="auto-block-create-grid">
          <label><span>${esc(tr('automation.script.internalTitle'))}</span><input type="text" id="autoNewBlockTitle" maxlength="160" placeholder="${esc(tr('automation.script.titlePlaceholder'))}"></label>
          <label><span>${esc(tr('automation.script.position'))}</span><select class="select" id="autoNewBlockPosition"><option value="end">${esc(tr('automation.script.atEnd'))}</option><option value="start">${esc(tr('automation.script.atStart'))}</option>${pr.blocks.map((block, index) => `<option value="after:${esc(block.id)}">${esc(tr('automation.script.afterBlock', { number: index + 1 }))}${block.title ? ` · ${esc(block.title)}` : ''}</option>`).join('')}</select></label>
          <label class="auto-block-create-wide"><span>${esc(tr('automation.script.visualPrompt'))}</span><textarea id="autoNewBlockPrompt" maxlength="4000" rows="4" required placeholder="${esc(tr('automation.script.visualPromptPlaceholder'))}"></textarea></label>
          <label><span>${esc(tr('automation.script.initialTextType'))}</span><select class="select" id="autoNewBlockKind"><option value="narration">${esc(tr('automation.script.narration'))}</option><option value="dialogue"${pr.requirements.characters.length ? '' : ' disabled'}>${esc(tr('automation.script.dialogue'))}</option></select></label>
          <label id="autoNewBlockCharacterField" hidden><span>${esc(tr('automation.script.dialogueCharacter'))}</span><select class="select" id="autoNewBlockCharacter">${pr.requirements.characters.map((role) => `<option value="${esc(role.role)}">${esc(automationRoleName(role.role))} · @${esc(role.role)}</option>`).join('')}</select></label>
          <label class="auto-block-create-wide"><span id="autoNewBlockTextLabel">${esc(tr('automation.script.initialNarration'))}</span><textarea id="autoNewBlockText" maxlength="2000" rows="3" required placeholder="${esc(tr('automation.script.audioTextPlaceholder'))}"></textarea></label>
        </div>
        <div class="auto-block-create-actions"><span class="hint">${esc(tr('automation.script.configureLaterHint'))}</span><button type="submit" class="mini-btn accent" id="autoNewBlockSave">${IC('save')} ${esc(tr('automation.script.createBlock'))}</button></div>
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
            <strong>${esc(tr('automation.script.blockNumber', { number: i + 1 }))}${b.title ? ` · ${esc(b.title)}` : ''}</strong> <span class="hint">${esc([b.characters.join(', '), b.location, b.prop].filter(Boolean).join(' · '))}</span>
            <span class="auto-block-btns">
              <button class="mini-btn" data-genblock="${b.id}" data-force="${done ? '1' : '0'}"${missing.length ? ' disabled' : ''}>${IC('spark')} ${esc(tr(done ? 'automation.script.regenerate' : partial ? 'automation.script.continue' : 'automation.script.generateContinue'))}</button>
              ${(out?.imageKey || blockGenerator === 'assets') && reusableAudioReady ? `<button class="mini-btn" data-regen-downstream="${b.id}"${missing.length ? ' disabled' : ''} title="${esc(tr('automation.script.redoTextVideoHint'))}">${IC('film')} ${esc(tr('automation.script.redoTextVideo'))}</button>` : ''}
              ${partial ? `<button class="mini-btn danger" data-regenblock="${b.id}"${missing.length ? ' disabled' : ''}>${esc(tr('automation.script.regenerateFromScratch'))}</button>` : ''}
            </span>
          </div>
          <div class="auto-block-editor">
            <div class="auto-block-generator">
              <label><span>${esc(tr('automation.generators.label'))}</span><select class="select" data-block-generator><option value="image"${blockGenerator === 'image' ? ' selected' : ''}>${esc(tr('automation.generators.imageAudio'))}</option><option value="seedance25"${blockGenerator === 'seedance25' ? ' selected' : ''}>Seedance 2.5 · ${esc(tr('automation.generators.multimodalVideo'))}</option><option value="h3"${blockGenerator === 'h3' ? ' selected' : ''}>MiniMax H3 · ${esc(tr('automation.generators.multimodalVideo'))}</option><option value="omni"${blockGenerator === 'omni' ? ' selected' : ''}>Gemini Omni 1.1 Flash · ${esc(tr('common.video'))}</option><option value="heygen"${blockGenerator === 'heygen' ? ' selected' : ''}>HeyGen + ${esc(tr('automation.generators.elevenLabsAudio'))}</option><option value="assets"${blockGenerator === 'assets' ? ' selected' : ''}>Assets · ${esc(tr('automation.generators.imagesVideos'))}</option></select></label>
              <div class="auto-block-heygen-settings" data-block-heygen-settings${blockGenerator === 'heygen' ? '' : ' hidden'}>
                <label><span>${esc(tr('automation.heygen.characterVariant'))}</span><select class="select" data-block-heygen-character>${heygenCharacters.length ? heygenCharacters.map((character) => `<option value="${character.id}"${character.id === selectedHeyGenCharacter?.id ? ' selected' : ''}>${esc(character.name)} · HeyGen · ${esc(trn('characters.shots', character.heygen?.closeAvatarId ? 2 : 1))}</option>`).join('') : `<option value="">— ${esc(tr('automation.heygen.noReadyCharacters'))} —</option>`}</select></label>
                <label><span>${esc(tr('automation.heygen.framing'))}</span><select class="select" data-block-heygen-framing><option value="wide"${b.heygenFraming === 'wide' || !b.heygenFraming ? ' selected' : ''}>${esc(tr('automation.heygen.wideShot'))}</option><option value="close"${b.heygenFraming === 'close' ? ' selected' : ''}>${esc(tr('automation.heygen.closeUp'))}</option><option value="split"${b.heygenFraming === 'split' ? ' selected' : ''}>${esc(tr('automation.heygen.alternate'))}</option></select></label>
                <span class="hint" data-block-heygen-hint>${esc(tr(selectedHeyGenCharacter?.heygen?.closeAvatarId ? 'automation.heygen.splitHint' : 'automation.heygen.wideOnlyHint'))}</span>
              </div>
              <div class="auto-block-assets-settings auto-block-h3-settings" data-block-h3-settings${blockGenerator === 'h3' ? '' : ' hidden'} data-h3-reference-keys="${esc(JSON.stringify(b.h3ReferenceKeys || []))}">
                <div class="auto-block-assets-head">
                  <div><strong>MiniMax H3</strong><span class="hint">${esc(tr('automation.generators.h3Hint'))}</span></div>
                  <button type="button" class="mini-btn" data-pick-block-h3>${IC('image')} ${esc(tr('automation.generators.additionalReferences'))}</button>
                </div>
                <div class="auto-block-assets-list" data-block-h3-list>${automationBlockAssetSelectionMarkup(b.h3ReferenceKeys || [])}</div>
                <div class="auto-block-create-grid">
                  <label><span>${esc(tr('automation.generators.mode'))}</span><select class="select" data-block-h3-mode><option value="reference"${b.h3Mode !== 'frames' ? ' selected' : ''}>${esc(tr('automation.generators.multimodalReferences'))}</option><option value="frames"${b.h3Mode === 'frames' ? ' selected' : ''}>${esc(tr('automation.generators.startEndFrames'))}</option></select></label>
                  <label><span>${esc(tr('automation.generators.h3Resolution'))}</span><select class="select" data-block-h3-resolution><option value="768P"${b.h3Resolution !== '2K' ? ' selected' : ''}>768P</option><option value="2K"${b.h3Resolution === '2K' ? ' selected' : ''}>2K</option></select></label>
                </div>
                <label class="poser-toggle"><input type="checkbox" data-block-h3-context${b.h3ContextIr ? ' checked' : ''}> ${esc(tr('automation.generators.contextIr'))}</label>
                <label class="poser-toggle"><input type="checkbox" data-block-h3-narration${b.h3UseNarrationReference !== false ? ' checked' : ''}> ${esc(tr('automation.generators.h3NarrationReference'))}</label>
                <label class="poser-toggle"><input type="checkbox" data-block-h3-native-audio${b.h3KeepGeneratedAudio ? ' checked' : ''}> ${esc(tr('automation.generators.keepH3Audio'))}</label>
                <span class="hint" data-block-h3-hint>${esc(tr('automation.generators.h3ModeHint'))}</span>
              </div>
              <div class="auto-block-assets-settings auto-block-h3-settings" data-block-seedance25-settings${blockGenerator === 'seedance25' ? '' : ' hidden'} data-seedance25-reference-keys="${esc(JSON.stringify(b.seedance25ReferenceKeys || []))}">
                <div class="auto-block-assets-head">
                  <div><strong>Seedance 2.5</strong><span class="hint">${esc(tr('automation.generators.seedanceHint'))}</span></div>
                  <button type="button" class="mini-btn" data-pick-block-seedance25>${IC('image')} ${esc(tr('automation.generators.additionalReferences'))}</button>
                </div>
                <div class="auto-block-assets-list" data-block-seedance25-list>${automationBlockAssetSelectionMarkup(b.seedance25ReferenceKeys || [])}</div>
                <div class="auto-block-create-grid">
                  <label><span>${esc(tr('automation.generators.mode'))}</span><select class="select" data-block-seedance25-mode><option value="reference"${b.seedance25Mode !== 'frames' ? ' selected' : ''}>${esc(tr('automation.generators.multimodalReferences'))}</option><option value="frames"${b.seedance25Mode === 'frames' ? ' selected' : ''}>${esc(tr('automation.generators.startEndFrames'))}</option></select></label>
                  <label><span>${esc(tr('automation.config.resolution'))}</span><select class="select" data-block-seedance25-resolution><option value="480p"${b.seedance25Resolution === '480p' ? ' selected' : ''}>480p</option><option value="720p"${b.seedance25Resolution !== '480p' ? ' selected' : ''}>720p</option></select></label>
                </div>
                <label class="poser-toggle"><input type="checkbox" data-block-seedance25-narration${b.seedance25UseNarrationReference !== false ? ' checked' : ''}> ${esc(tr('automation.generators.seedanceNarrationReference'))}</label>
                <label class="poser-toggle"><input type="checkbox" data-block-seedance25-native-audio${b.seedance25KeepGeneratedAudio ? ' checked' : ''}> ${esc(tr('automation.generators.keepSeedanceAudio'))}</label>
                <span class="hint">${esc(tr('automation.generators.seedanceModeHint'))}</span>
              </div>
              <div class="auto-block-assets-settings auto-block-h3-settings" data-block-omni-settings${blockGenerator === 'omni' ? '' : ' hidden'} data-omni-reference-keys="${esc(JSON.stringify(b.omniReferenceKeys || []))}">
                <div class="auto-block-assets-head">
                  <div><strong>Gemini Omni 1.1 Flash</strong><span class="hint">${esc(tr('automation.generators.omniHint'))}</span></div>
                  <button type="button" class="mini-btn" data-pick-block-omni>${IC('image')} ${esc(tr('automation.generators.additionalReferences'))}</button>
                </div>
                <div class="auto-block-assets-list" data-block-omni-list>${automationBlockAssetSelectionMarkup(b.omniReferenceKeys || [])}</div>
                <div class="auto-block-create-grid">
                  <label><span>${esc(tr('automation.generators.mode'))}</span><select class="select" data-block-omni-mode><option value="reference"${b.omniMode !== 'frames' ? ' selected' : ''}>${esc(tr('automation.generators.references'))}</option><option value="frames"${b.omniMode === 'frames' ? ' selected' : ''}>${esc(tr('automation.generators.startEndFrames'))}</option></select></label>
                  <label><span>${esc(tr('automation.config.resolution'))}</span><select class="select" data-block-omni-resolution>${['360p', '720p', '1080p', '4K'].map((value) => `<option value="${value}"${value === (b.omniResolution || '720p') ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
                </div>
                <span class="hint">${esc(tr('automation.generators.omniModeHint'))}</span>
              </div>
              <div class="auto-block-assets-settings" data-block-assets-settings${blockGenerator === 'assets' ? '' : ' hidden'} data-asset-keys="${esc(JSON.stringify(b.assetKeys || []))}">
                <div class="auto-block-assets-head">
                  <div><strong>${esc(tr('automation.generators.assetSequence'))}</strong><span class="hint">${esc(tr('automation.generators.assetSequenceHint'))}</span></div>
                  <button type="button" class="mini-btn" data-pick-block-assets>${IC('image')} ${esc(tr('automation.generators.chooseOrder'))}</button>
                </div>
                <div class="auto-block-assets-list" data-block-assets-list>${automationBlockAssetSelectionMarkup(b.assetKeys || [])}</div>
                <label class="poser-toggle auto-block-assets-mute"><input type="checkbox" data-block-assets-mute${b.assetMuteOriginal !== false ? ' checked' : ''}> ${esc(tr('automation.generators.muteAssetAudio'))}</label>
                <span class="hint">${esc(tr('automation.generators.loopShortVideo'))}</span>
              </div>
            </div>
            <label><span>${esc(tr('automation.generators.internalBlockTitle'))}</span><input type="text" data-block-title maxlength="160" value="${esc(b.title || '')}"></label>
            <label data-block-prompt-field><span>${esc(tr('automation.script.visualPrompt'))}</span><textarea data-block-prompt maxlength="4000" rows="5">${esc(automationPromptForEditor(pr, b.imagePrompt))}</textarea></label>
            <label data-block-prompt-field><span>${esc(tr('automation.generators.negativePrompt'))}</span><textarea data-block-negative maxlength="2000" rows="2">${esc(b.negativePrompt || '')}</textarea></label>
            <div class="auto-block-script-items">
              ${(b.items || []).map((it, itemIndex) => `<label><span>${it.kind === 'dialogue' ? `${esc(tr('automation.script.dialogue'))} · ${esc(it.character || tr('automation.generators.noCharacter'))}` : esc(tr('automation.script.narration'))}</span><textarea data-block-item="${itemIndex}" maxlength="2000" rows="3">${esc(it.text)}</textarea></label>`).join('')}
            </div>
            <div class="auto-block-edit-actions"><span class="hint">${esc(tr('automation.generators.saveReuseHint'))}</span><button type="button" class="mini-btn accent" data-save-block="${esc(b.id)}">${IC('save')} ${esc(tr('automation.generators.saveBlockChanges'))}</button></div>
          </div>
          <div class="auto-block-out" data-out="${b.id}">${automationBlockOutHtml(out, b)}</div>
        </div>`;
      }).join('') : `<p class="hint">${esc(tr('automation.script.noBlocks'))}</p>`}
    </div>

    <div class="automation-actions">
      ${missing.length ? `<span class="hint warn">${esc(tr('automation.run.cannotRun', { missing: missing.join(', ') }))}</span>` : `<span class="hint">${esc(tr('automation.run.assignedProgress', { completed: Object.values(pr.outputs || {}).filter((o) => o?.videoKey).length, total: pr.blocks.length }))}</span>`}
      <select class="select" id="autoMode"${missing.length ? ' disabled' : ''}>
        <option value="missing">${esc(tr('automation.run.missingOnly'))}</option>
        <option value="all">${esc(tr('automation.run.regenerateAll'))}</option>
      </select>
      <button class="generate-btn" id="autoStart"${missing.length ? ' disabled' : ''}>${IC('spark')} ${esc(tr('automation.run.start'))}</button>
    </div>

      <div class="automation-panel final-assembly-panel">
        <div class="final-assembly-copy">
          <h3>${esc(tr('automation.finalVideo.title'))}</h3>
          <label class="final-logo-toggle">
            <input type="checkbox" id="autoIncludeLogos"${includeLogos ? ' checked' : ''}>
            <span><strong>${esc(tr('automation.finalVideo.includeLogos'))}</strong><small>${esc(tr('automation.finalVideo.logosHint'))}</small></span>
          </label>
          <span class="hint" id="autoAssembleStatus">${
          allVideosReady
            ? esc(tr('automation.finalVideo.ready', { completed: completedVideos, total: pr.blocks.length }))
            : esc(tr('automation.finalVideo.missing', { missing: pr.blocks.length - completedVideos, total: pr.blocks.length }))
        }</span>
        ${finalOutput ? `<span class="automation-stage-status">${esc(tr('automation.finalVideo.latestAssembly', {
          blocks: trn('automation.blockCount', finalOutput.blockCount || pr.blocks.length),
          resolution: finalOutput.width && finalOutput.height ? ` · ${finalOutput.width}×${finalOutput.height}` : '',
          music: finalOutput.musicKey ? tr('automation.finalVideo.loopMusic', { fade: finalOutput.musicFadeOutSeconds ? tr('automation.finalVideo.fadeOut', { seconds: finalOutput.musicFadeOutSeconds }) : '' }) : '',
          transitions: finalOutput.transitionCount ? tr('automation.finalVideo.transitionsSummary', { transitions: trn('automation.finalVideo.transitionCount', finalOutput.transitionCount), sound: finalOutput.transitionSoundName || tr('automation.finalVideo.sound') }) : '',
          logo: finalOutput.includeLogos ? tr('automation.finalVideo.logoSummary', { orientation: tr(finalOutput.logoVariant === 'vertical' ? 'automation.finalVideo.vertical' : 'automation.finalVideo.horizontal') }) : '',
          date: fmtDate(finalOutput.assembledAt)
        }))}</span>` : ''}
        <button type="button" class="generate-btn" id="autoAssemble"${allVideosReady ? '' : ' disabled'}>
          ${IC('film')} ${esc(tr(finalOutput ? 'automation.finalVideo.reassemble' : 'automation.finalVideo.assemble'))}
        </button>
      </div>
      ${finalOutput ? `<div class="final-assembly-preview">
        <video src="${fileUrl(finalOutput.videoKey)}" controls preload="metadata"></video>
        <button type="button" class="mini-btn" data-open-asset="${esc(finalOutput.videoKey)}">${esc(tr('automation.openAssetActions'))}</button>
      </div>` : ''}
    </div>

    <div class="automation-panel post-effect-panel${videoEffect.enabled ? ' enabled' : ''}" id="autoEffectPanel">
      <div class="post-effect-copy">
        <div class="post-effect-heading">
          <div><h3>${esc(tr('automation.effects.title'))}</h3><span class="hint">${esc(tr('automation.effects.hint'))}</span></div>
          <label class="poser-toggle"><input type="checkbox" id="autoEffectEnabled"${videoEffect.enabled ? ' checked' : ''}> ${esc(tr('common.enable'))}</label>
        </div>
        <div class="post-effect-controls">
          <label><span>${esc(tr('automation.effects.effect'))}</span><select class="select" id="autoEffectPreset">
            <option value="wiggle"${videoEffect.preset === 'wiggle' ? ' selected' : ''}>${esc(tr('automation.effects.softWiggle'))}</option>
            <option value="oldFilm"${videoEffect.preset === 'oldFilm' ? ' selected' : ''}>${esc(tr('automation.effects.oldFilm'))}</option>
            <option value="vhs"${videoEffect.preset === 'vhs' ? ' selected' : ''}>VHS</option>
          </select></label>
          <label class="post-effect-intensity"><span>${esc(tr('automation.effects.intensity'))}</span><span class="post-effect-range"><input type="range" id="autoEffectIntensity" min="0" max="100" step="1" value="${videoEffect.intensity}"><output id="autoEffectIntensityValue">${videoEffect.intensity}%</output></span></label>
        </div>
        <div class="post-effect-mask${videoEffect.maskEnabled ? ' enabled' : ''}" id="autoEffectMaskPanel">
          <label class="post-effect-mask-toggle"><input type="checkbox" id="autoEffectMaskEnabled"${videoEffect.maskEnabled ? ' checked' : ''}><span>${esc(tr('automation.effects.colorMask'))}</span></label>
          <label><span>${esc(tr('automation.effects.color'))}</span><input type="color" id="autoEffectMaskColor" value="${esc(videoEffect.maskColor)}"${videoEffect.maskEnabled ? '' : ' disabled'}></label>
          <label class="post-effect-mask-opacity"><span>${esc(tr('automation.effects.opacity'))}</span><span class="post-effect-range"><input type="range" id="autoEffectMaskOpacity" min="0" max="100" step="1" value="${videoEffect.maskOpacity}"${videoEffect.maskEnabled ? '' : ' disabled'}><output id="autoEffectMaskOpacityValue">${videoEffect.maskOpacity}%</output></span></label>
          <span class="hint">${esc(tr('automation.effects.maskHint'))}</span>
        </div>
        <span class="hint" id="autoEffectStatus">${esc(finalOutput ? tr('automation.effects.cleanPreserved') : tr('automation.effects.assembleFirst'))}</span>
        ${effectOutput ? `<span class="automation-stage-status">${esc(tr('automation.effects.latestVersion', {
          preset: effectOutput.presetName || effectOutput.preset,
          intensity: effectOutput.intensity,
          mask: effectOutput.maskEnabled ? tr('automation.effects.maskDetail', { color: effectOutput.maskColor, opacity: effectOutput.maskOpacity }) : '',
          subtitles: effectOutput.subtitlesPreserved ? tr('automation.effects.crispSubtitles') : '',
          logo: effectOutput.logoPreserved ? tr('automation.effects.logoPreserved') : '',
          date: fmtDate(effectOutput.processedAt)
        }))}</span>` : ''}
        <button type="button" class="generate-btn" id="autoApplyEffect"${finalOutput && videoEffect.enabled ? '' : ' disabled'}>${IC('spark')} ${esc(tr(effectOutput ? 'automation.effects.createAnother' : 'automation.effects.apply'))}</button>
      </div>
      ${effectOutput ? `<div class="final-assembly-preview post-effect-preview">
        <video src="${fileUrl(effectOutput.videoKey)}" controls preload="metadata"></video>
        <button type="button" class="mini-btn" data-open-asset="${esc(effectOutput.videoKey)}">${esc(tr('automation.effects.openVersion'))}</button>
      </div>` : ''}
    </div>

    <div class="automation-panel automation-text-refresh-panel${textRefreshPending ? ' is-pending' : ''}">
      <div>
        <h3>${esc(tr('automation.textRefresh.title'))}</h3>
        <p id="autoRefreshTextStatus">${finalOutput
          ? esc(tr('automation.textRefresh.description', { pending: textRefreshPending ? tr('automation.textRefresh.pendingPrefix') : '', target: textRefreshTargetLabel }))
          : esc(tr('automation.textRefresh.availableAfterAssembly'))}</p>
        ${textRefreshOutput?.textRefreshedAt ? `<span class="automation-stage-status">${esc(tr('automation.textRefresh.lastUpdate', { date: fmtDate(textRefreshOutput.textRefreshedAt) }))}</span>` : ''}
      </div>
      <button type="button" class="mini-btn accent automation-text-refresh-button" id="autoRefreshAllText"${finalOutput ? '' : ' disabled'}>${IC('refresh')} ${esc(tr(textRefreshPending ? 'automation.textRefresh.applyChanges' : 'automation.textRefresh.regenerateAll'))}</button>
    </div>

    <div class="automation-panel automation-finalize-panel">
      <div>
        <h3>${esc(tr('automation.finalize.title'))}</h3>
        <p>${esc(tr('automation.finalize.description'))}</p>
        ${finalization?.finalizedAt ? `<span class="automation-stage-status">${esc(tr('automation.finalize.latestCleanup', {
          files: trn('automation.finalize.discardedFiles', finalization.deletedCount || 0),
          bytes: formatAutomationBytes(finalization.deletedBytes || 0),
          date: fmtDate(finalization.finalizedAt),
          pending: finalization.failedCount ? tr('automation.finalize.pending', { files: trn('automation.finalize.discardedFiles', finalization.failedCount) }) : ''
        }))}</span>` : `<span class="hint">${esc(tr('automation.finalize.previewHint'))}</span>`}
      </div>
      <button type="button" class="mini-btn danger automation-finalize-button" id="autoFinalize">${IC('trash')} ${esc(tr('automation.finalize.title'))}</button>
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
    $('#autoNewBlockTextLabel').textContent = tr(isDialogue ? 'automation.script.initialDialogue' : 'automation.script.initialNarration');
    $('#autoNewBlockText').placeholder = tr(isDialogue ? 'automation.script.dialogueTextPlaceholder' : 'automation.script.audioTextPlaceholder');
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
    if (!imagePrompt) return toast(tr('automation.script.visualPromptRequired'), 'err');
    if (!text) return toast(tr('automation.script.initialTextRequired'), 'err');
    if (kind === 'dialogue' && !character) return toast(tr('automation.script.dialogueCharacterRequired'), 'err');

    const newBlock = {
      id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: $('#autoNewBlockTitle').value.trim() || tr('automation.script.blockNumber', { number: pr.blocks.length + 1 }),
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
    toast(tr('automation.script.added', { title: newBlock.title }));
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
    if (!preset) return toast(tr('automation.textStyles.chooseSaved'), 'err');
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
    toast(tr('automation.textStyles.applied', { name: preset.name }));
  });
  $('#overlayPresetSave').addEventListener('click', async () => {
    const name = window.prompt(tr('automation.textStyles.namePrompt'));
    if (!name?.trim()) return;
    try {
      const item = await api('/api/overlay-presets', {
        method: 'POST',
        body: { name: name.trim(), overlay: ov, titleOverlay: titleOv, dynamicText }
      });
      state.overlayPresets.unshift(item);
      renderAutomationProject();
      toast(tr('automation.textStyles.saved', { name: item.name }));
    } catch (error) { toast(error.message, 'err'); }
  });
  $('#overlayPresetDelete').addEventListener('click', async () => {
    const preset = (state.overlayPresets || []).find((item) => item.id === $('#overlayPresetSelect').value);
    if (!preset || !confirm(tr('automation.textStyles.deleteConfirm', { name: preset.name }))) return;
    try {
      await api(`/api/overlay-presets/${preset.id}`, { method: 'DELETE' });
      state.overlayPresets = state.overlayPresets.filter((item) => item.id !== preset.id);
      renderAutomationProject();
      toast(tr('automation.textStyles.deleted'));
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
    if (!savedPrompt) return toast(tr('automation.config.chooseSavedPrompt'), 'err');
    $('#autoArtStyle').value = savedPrompt.text.slice(0, 1200);
    artStylePromptId = savedPrompt.id;
    artStyleImageKey = isStylePrompt(savedPrompt) ? (savedPrompt.styleImageKey || '') : '';
    await saveAll();
    renderAutomationProject();
    toast(tr(savedPrompt.text.length > 1200 ? 'automation.config.promptAppliedTruncated' : 'automation.config.promptApplied', { title: savedPrompt.title }));
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
      : (state.transitionSounds || []).length ? tr('automation.transition.chooseHint') : tr('automation.transition.noneInstalled');
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
    if (hint) hint.textContent = tr(voicePreview ? 'automation.music.previewWithVoice' : 'automation.music.previewNeedsVoice', { gain: db.toFixed(1) });
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
      musicTestButton.innerHTML = `${IC('play')} ${tr(voicePreview ? 'automation.music.testWithVoice' : 'automation.music.test')}`;
      status.textContent = tr('automation.music.testStopped');
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
        status.textContent = tr('automation.music.testingWithVoice', { gain: Number($('#autoMusicGain').value).toFixed(1) });
      } else {
        await musicPreview.play();
        status.textContent = tr('automation.music.playing', { gain: Number($('#autoMusicGain').value).toFixed(1) });
      }
      musicTestButton.textContent = tr('automation.music.stopTest');
    } catch (error) {
      musicPreview.pause();
      if (voicePreview) voicePreview.pause();
      status.textContent = tr('automation.music.testFailed', { error: error.message });
    }
  });
  voicePreview?.addEventListener('ended', () => {
    musicPreview.pause();
    musicPreview.loop = false;
    musicTestButton.innerHTML = `${IC('play')} ${tr('automation.music.testWithVoice')}`;
    $('#autoMusicStatus').textContent = tr('automation.music.balanceFinished');
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
    status.textContent = tr('automation.music.searchingBestMatch');
    try {
      const result = await api(`/api/automations/${pr.id}/music/auto-select`, { method: 'POST', body: music });
      state.automations[state.automations.findIndex((item) => item.id === pr.id)] = result.project;
      renderAutomationProject();
      toast(tr(result.selected.score > 0 ? 'automation.music.autoSelectedScore' : 'automation.music.autoSelectedRecent', { score: result.selected.score }), 'ok');
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
    if (!confirm(tr('automation.music.sunoConfirm'))) return;
    button.disabled = true;
    status.textContent = tr('automation.music.sunoComposing');
    try {
      const result = await api(`/api/automations/${pr.id}/music/generate`, { method: 'POST', body: music });
      state.automations[state.automations.findIndex((item) => item.id === pr.id)] = result.project;
      await refreshAssets();
      renderAutomationProject();
      toast(tr('automation.music.sunoGenerated'), 'ok');
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
    $('#autoTitleBlockLabel').textContent = tr(titleOv.mode === 'block' ? 'automation.overlay.previewBlock' : 'automation.overlay.showProjectTitleIn');
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
      toast(tr('automation.overlay.fontImported', { name: font.name }));
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
  $('#ovPickBg').addEventListener('click', () => { state.overlayBgPick = true; openPicker(); $('#pickerTitle').textContent = tr('automation.overlay.chooseReferenceBackground'); });
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
      if (hint) hint.textContent = tr(character?.heygen?.closeAvatarId ? 'automation.heygen.splitHint' : 'automation.heygen.wideOnlyHint');
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
    const title = blockElement.querySelector('[data-block-title]').value.trim() || currentBlock.title || tr('automation.block');
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
    if (generator !== 'assets' && !imagePrompt) return toast(tr('automation.blockValidation.visualPromptRequired'), 'err');
    if (!items.length) return toast(tr('automation.blockValidation.textRequired'), 'err');
    if (generator === 'heygen' && !heygenCharacterReady(heygenCharacter)) return toast(tr('automation.blockValidation.heygenCharacterRequired'), 'err');
    if (generator === 'heygen' && ['close', 'split'].includes(heygenFraming) && !heygenCharacter.heygen?.closeAvatarId) return toast(tr('automation.blockValidation.noCloseUpCode'), 'err');
    if (generator === 'assets' && !assetKeys.length) return toast(tr('automation.blockValidation.assetsRequired'), 'err');
    if (generator === 'h3' && h3Mode === 'frames') {
      const frameItems = h3ReferenceKeys.map(automationVisualAsset);
      if (frameItems.length !== 2 || frameItems.some((item) => ['video', 'audio'].includes(item.zone))) {
        return toast(tr('automation.blockValidation.h3Frames'), 'err');
      }
    }
    if (generator === 'seedance25' && seedance25Mode === 'frames') {
      if (seedance25ReferenceKeys.length !== 2 || seedance25ReferenceKeys.some((key) => /^(video|audio)\//.test(key))) {
        return toast(tr('automation.blockValidation.seedanceFrames'), 'err');
      }
    }
    if (generator === 'omni' && omniMode === 'frames') {
      if (omniReferenceKeys.length !== 2 || omniReferenceKeys.some((key) => /^(video|audio)\//.test(key))) {
        return toast(tr('automation.blockValidation.omniFrames'), 'err');
      }
    }
    if (generator === 'omni' && omniReferenceKeys.some((key) => /^audio\//.test(key))) {
      return toast(tr('automation.blockValidation.omniNoAudio'), 'err');
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
      toast(tr('automation.blockValidation.saved', { title }));
    } else {
      button.disabled = false;
    }
  }));

  $('#automationRoot').querySelectorAll('[data-genblock]').forEach((btn) => btn.addEventListener('click', async () => {
    const block = pr.blocks.find((b) => b.id === btn.dataset.genblock);
    const force = btn.dataset.force === '1';
    const newMaterials = tr(block?.generator === 'heygen'
      ? 'automation.regenerate.newHeygen'
      : block?.generator === 'h3' ? 'automation.regenerate.newH3'
      : block?.generator === 'seedance25' ? 'automation.regenerate.newSeedance'
      : block?.generator === 'omni' ? 'automation.regenerate.newOmni'
      : block?.generator === 'assets' ? 'automation.regenerate.newAssets' : 'automation.regenerate.newImageAudio');
    if (force && !confirm(tr('automation.regenerate.fromScratchConfirm', { title: block?.title || tr('automation.thisBlock'), materials: newMaterials }))) return;
    if (block) await runAutomationBlock(pr.id, block, btn.closest('.auto-block'), { regenerate: force });
  }));
  $('#automationRoot').querySelectorAll('[data-regen-downstream]').forEach((button) => button.addEventListener('click', async () => {
    const block = pr.blocks.find((item) => item.id === button.dataset.regenDownstream);
    const output = block && pr.outputs?.[block.id];
    if (!block || (block.generator !== 'assets' && !output?.imageKey)) return toast(tr('automation.regenerate.noCleanVisuals'), 'err');
    if (block.generator === 'assets' && !(block.assetKeys || []).length) return toast(tr('automation.regenerate.noSelectedAssets'), 'err');
    const existingAudioKeys = Array.isArray(output.audioKeys) ? output.audioKeys.slice(0, block.items.length) : [];
    if (existingAudioKeys.length !== block.items.length) return toast(tr('automation.regenerate.missingAudioForAssembly'), 'err');
    const visualDescription = block.generator === 'assets' ? trn('automation.regenerate.selectedAssets', (block.assetKeys || []).length)
      : ['h3', 'seedance25', 'omni'].includes(block.generator)
        ? tr('automation.regenerate.modelSegmentsAndBase', { segments: trn('automation.outputs.segmentCount', (output.h3SegmentVideoKeys || []).length), model: block.generator === 'seedance25' ? 'Seedance 2.5' : block.generator === 'omni' ? 'Gemini Omni' : 'H3' })
        : tr('automation.regenerate.cleanImage');
    if (!confirm(tr('automation.regenerate.textVideoConfirm', { title: block.title || tr('automation.thisBlock'), visuals: visualDescription, audio: trn('automation.regenerate.existingAudio', existingAudioKeys.length) }))) return;
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
    const materials = tr(block?.generator === 'heygen'
      ? 'automation.regenerate.heygen'
      : block?.generator === 'seedance25'
        ? 'automation.regenerate.seedance'
      : block?.generator === 'h3'
          ? 'automation.regenerate.h3'
          : block?.generator === 'omni'
            ? 'automation.regenerate.omni'
          : block?.generator === 'assets' ? 'automation.regenerate.assets' : 'automation.regenerate.imageAudio');
    if (!block || !confirm(tr('automation.regenerate.discardPartialsConfirm', { title: block.title || tr('automation.thisBlock'), materials }))) return;
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
  const locale = i18n?.localeTag() || 'es-AR';
  if (transform === 'uppercase') return word.toLocaleUpperCase(locale);
  if (transform === 'lowercase') return word.toLocaleLowerCase(locale);
  if (transform === 'capitalize') {
    return word.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase(locale));
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
    ? `HeyGen · ${trn('characters.shots', out.heygenFraming === 'split' ? 2 : 1)}`
    : isH3
      ? `MiniMax H3 · ${out.h3Resolution || '768P'} · ${trn('automation.outputs.segmentCount', h3SegmentVideoKeys.length)}`
    : isSeedance25
      ? `Seedance 2.5 · ${out.h3Resolution || '720p'} · ${trn('automation.outputs.segmentCount', h3SegmentVideoKeys.length)}`
    : isOmni
      ? `Gemini Omni · ${out.h3Resolution || '720p'} · ${trn('automation.outputs.segmentCount', h3SegmentVideoKeys.length)}`
    : isAssets
      ? `Assets · ${trn('automation.outputs.visualCount', (out.assetKeys || []).length)} · ${tr(out.assetMuteOriginal !== false ? 'automation.outputs.originalAudioMuted' : 'automation.outputs.originalAudioMixed')} · ${out.motionOverlayKey ? `${tr('automation.outputs.dynamicText')} ✓` : `${tr('automation.outputs.layer')} ${out.textLayerKey ? '✓' : '—'}`}`
      : `${tr('automation.outputs.image')} ${out.imageKey ? '✓' : '—'} · ${out.motionOverlayKey ? `${tr('automation.outputs.dynamicText')} ✓` : `${tr('automation.outputs.text')} ${out.textImageKey ? '✓' : '—'} · ${tr('automation.outputs.layer')} ${out.textLayerKey ? '✓' : '—'}`}`;
  return `
    <span class="automation-stage-status">
      ${sourceStatus} · ${esc(tr('common.audio'))} ${audioKeys.length}/${expected || '—'} · ${esc(tr('common.video'))} ${out.videoKey ? '✓' : '—'}
    </span>
    ${out.fallbackUsed ? `<span class="hint warn">${esc(tr('automation.outputs.fallbackImage', { model: out.imageModelName || out.imageModelId || '' }))}</span>` : ''}
    ${out.imageKey ? `<button type="button" class="auto-output-asset" data-open-asset="${esc(out.imageKey)}" title="${esc(tr('automation.openAssetActions'))}"><img src="${fileUrl(out.imageKey)}" alt="${esc(tr('automation.outputs.image'))}"></button>` : ''}
    ${out.textImageKey ? `<button type="button" class="auto-output-asset" data-open-asset="${esc(out.textImageKey)}" title="${esc(tr('automation.openAssetActions'))}"><img src="${fileUrl(out.textImageKey)}" alt="${esc(tr('automation.outputs.withText'))}"></button>` : ''}
    ${out.textLayerKey ? `<button type="button" class="mini-btn" data-open-asset="${esc(out.textLayerKey)}">${esc(tr('automation.outputs.subtitleLayer'))}</button>` : ''}
    ${out.motionOverlayKey ? `<button type="button" class="mini-btn accent" data-open-asset="${esc(out.motionOverlayKey)}">${esc(tr('automation.outputs.remotionLayer'))}</button>` : ''}
    ${audioKeys.map((key, index) => `<span class="auto-output-audio"><small>${esc(tr('automation.outputs.audioNumber', { number: index + 1 }))}</small><audio src="${fileUrl(key)}" controls preload="metadata"></audio></span>`).join('')}
    ${segmentVideoKeys.length ? `<span class="heygen-segment-list"><small>${esc(tr('automation.outputs.heygenSegments'))}</small>${segmentVideoKeys.map((key, index) => {
      const label = out.heygenFraming === 'split' ? tr(index === 0 ? 'automation.heygen.wideShot' : 'automation.heygen.closeUp') : tr('automation.outputs.heygenTake');
      return `<span class="heygen-segment-row"><button type="button" class="mini-btn" data-open-asset="${esc(key)}">${esc(label)}</button>${canRegenerateHeyGenPlanes ? `<button type="button" class="mini-btn accent" data-regenerate-heygen-segment data-block-id="${esc(block.id)}" data-segment-index="${index}">${IC('refresh')} ${esc(tr('automation.script.regenerate'))}</button>` : ''}</span>`;
    }).join('')}</span>` : ''}
    ${h3SegmentVideoKeys.length ? `<span class="heygen-segment-list"><small>${esc(tr('automation.outputs.modelSegments', { model: isSeedance25 ? 'Seedance 2.5' : isOmni ? 'Gemini Omni' : 'MiniMax H3' }))}</small>${h3SegmentVideoKeys.map((key, index) => `<span class="heygen-segment-row"><button type="button" class="mini-btn" data-open-asset="${esc(key)}">${esc(tr('automation.outputs.segmentNumber', { number: index + 1 }))}</button></span>`).join('')}</span>` : ''}
    ${out.videoKey ? `<span class="auto-output-video"><video src="${fileUrl(out.videoKey)}" controls preload="metadata"></video><button type="button" class="mini-btn" data-open-asset="${esc(out.videoKey)}">${esc(tr('automation.outputs.videoActions'))}</button></span>` : ''}`;
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
  if (!primary) throw new Error(tr('automation.pipeline.noImageModel'));
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
      throw new Error(tr('automation.pipeline.fallbackNeedsReferences', { primary: primary.name, primaryError: primaryError.message, fallback: fallback.name, count: fallback.minRefs }));
    }
    setStatus(tr('automation.pipeline.retryingFallback', { primary: primary.name, fallback: fallback.name }));
    try {
      const result = await attempt(fallback);
      return { result, model: fallback, fallbackUsed: true };
    } catch (fallbackError) {
      throw new Error(
        tr('automation.pipeline.bothModelsFailed', { primary: primary.name, primaryError: primaryError.message, fallback: fallback.name, fallbackError: fallbackError.message })
      );
    }
  }
}

async function persistAutomationBlockOutput(projectId, blockId, patch, { replace = false } = {}) {
  const pr = state.automations.find((item) => item.id === projectId);
  if (!pr) throw new Error(tr('automation.errors.projectUnavailable'));
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
  if (!voiceId) throw new Error(tr('automation.pipeline.voiceMissing'));
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
  if (!assetKeys.length) throw new Error(tr('automation.blockValidation.assetsRequired'));
  const audioKeys = Array.isArray(output.audioKeys) ? output.audioKeys.slice(0, block.items.length) : [];
  if (requireExistingAudio && audioKeys.length !== block.items.length) {
    throw new Error(tr('automation.pipeline.savedAudioRequired'));
  }
  const usedAudioKeys = new Set(audioKeys);
  let historyLoaded = false;
  for (let index = audioKeys.length; index < block.items.length; index++) {
    const spec = automationAudioSpec(pr, block.items[index]);
    let recovered = null;
    if (!regenerate && !regenerateAudio) {
      if (!historyLoaded) {
        setStatus(tr('automation.pipeline.searchingAudio'));
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
      setStatus(tr('automation.pipeline.reusingAudio', { current: audioKeys.length, total: block.items.length }));
    } else {
      setStatus(tr('automation.pipeline.generatingAudio', { current: index + 1, total: block.items.length }));
      const generatedAudio = await api('/api/generate/audio', { method: 'POST', body: spec });
      const audioKey = generatedAudio.outputs?.[0];
      if (!audioKey) throw new Error(tr('automation.pipeline.audioNotGenerated', { number: index + 1 }));
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
    setStatus(tr('automation.pipeline.preparingTitleSubtitleLayer'));
    const caption = block.items.map((item) => item.text).join(' ');
    const title = automationTitleForBlock(pr, block);
    textLayerKey = await burnOverlayText('', caption, pr.config.overlay, {
      transparent: true, title, aspectRatio: pr.config.aspectRatio || '9:16'
    });
    output = await persistAutomationBlockOutput(pr.id, block.id, { textLayerKey });
    await tagAutomationStage(pr, block, [textLayerKey]);
  }

  setStatus(tr(dynamicTextEnabled ? 'automation.pipeline.distributingAssetsRemotion' : 'automation.pipeline.distributingAssets', { count: assetKeys.length }));
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
  if (!heygenCharacterReady(character)) throw new Error(tr('automation.pipeline.heygenCharacterNeeded'));
  if (['close', 'split'].includes(block.heygenFraming) && !character.heygen?.closeAvatarId) {
    throw new Error(tr('automation.pipeline.heygenNoCloseUp'));
  }
  if (pr.config?.heygenAuthMode === 'oauth' && !state.heygenOAuth.connected) throw new Error(tr('automation.pipeline.connectHeygenOauth'));
  if (pr.config?.heygenAuthMode !== 'oauth' && !state.config?.keys?.heygen) throw new Error(tr('automation.pipeline.saveHeygenKey'));

  const plan = automationAudioPlan(block);
  const audioKeys = Array.isArray(output.audioKeys) ? output.audioKeys.slice(0, plan.segments.length) : [];
  if ((requireExistingAudio || regenerateSegmentIndex >= 0) && audioKeys.length !== plan.segments.length) {
    throw new Error(tr('automation.pipeline.heygenSavedAudioRequired'));
  }
  const usedAudioKeys = new Set(audioKeys);
  let historyLoaded = false;
  for (let index = audioKeys.length; index < plan.segments.length; index++) {
    const spec = automationAudioSpec(pr, plan.segments[index]);
    let recovered = null;
    if (!regenerate && !regenerateAudio) {
      if (!historyLoaded) {
        setStatus(tr('automation.pipeline.searchingAudio'));
        await refreshAutomationHistory();
        historyLoaded = true;
      }
      recovered = recoverHistoryOutput('audio', spec.text, { voiceId: spec.voiceId, audioModelId: spec.audioModelId, usedKeys: usedAudioKeys });
    }
    if (recovered) {
      audioKeys.push(recovered.key);
      usedAudioKeys.add(recovered.key);
      setStatus(tr('automation.pipeline.reusingAudio', { current: audioKeys.length, total: plan.segments.length }));
    } else {
      setStatus(tr('automation.pipeline.generatingAudioElevenLabs', { current: index + 1, total: plan.segments.length }));
      const generatedAudio = await api('/api/generate/audio', { method: 'POST', body: spec });
      const audioKey = generatedAudio.outputs?.[0];
      if (!audioKey) throw new Error(tr('automation.pipeline.audioNotGenerated', { number: index + 1 }));
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
    setStatus(tr('automation.pipeline.preparingHeygenText'));
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
  if (block.heygenFraming === 'split' && audioGroups.length !== 2) throw new Error(tr('automation.pipeline.cannotSplitText'));
  if (regenerateSegmentIndex >= 0) {
    output = await persistAutomationBlockOutput(pr.id, block.id, { videoKey: null, completedAt: null });
  }
  setStatus(regenerateSegmentIndex >= 0
    ? tr('automation.pipeline.regeneratingHeygenSegment', { shot: tr(regenerateSegmentIndex === 0 ? 'automation.heygen.wideShot' : 'automation.heygen.closeUp') })
    : block.heygenFraming === 'split'
      ? tr('automation.pipeline.sendingTwoAudiosHeygen')
      : tr('automation.pipeline.sendingAudioHeygen'));
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
    title: tr('automation.pipeline.generatingTake', { title: block.title || tr('automation.pipeline.take') }),
    detail: tr('automation.pipeline.preparingMaterials')
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
      if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { detail: tr('automation.pipeline.assetsAssemblyDone') });
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
      if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { detail: tr('automation.pipeline.heygenTakeDone') });
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
        imageKey, imageModelId: `${block.generator}-frame`, imageModelName: tr('automation.pipeline.startFrameModel', { model: block.generator === 'seedance25' ? 'Seedance 2.5' : block.generator === 'omni' ? 'Gemini Omni' : 'H3' }),
        fallbackUsed: false, recoveredImage: true, audioCountExpected: block.items.length
      });
    }
    if (!imageKey && !regenerate) {
      setStatus(tr('automation.pipeline.searchingImage'));
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
      setStatus(tr('automation.pipeline.generatingImage'));
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
      setStatus(tr('automation.pipeline.reusingImage'));
    }

    const caption = block.items.map((it) => it.text).join(' ');
    const title = automationTitleForBlock(pr, block);
    const dynamicTextEnabled = pr.config?.dynamicText?.enabled === true;
    let textImageKey = dynamicTextEnabled ? '' : output.textImageKey;
    if (!dynamicTextEnabled && !textImageKey) {
      setStatus(tr('automation.pipeline.overlayingText'));
      textImageKey = await burnOverlayText(imageKey, caption, pr.config.overlay, { title });
      output = await persistAutomationBlockOutput(projectId, block.id, { textImageKey });
      await tagAutomationStage(pr, block, [textImageKey]);
    } else if (!dynamicTextEnabled) {
      setStatus(tr('automation.pipeline.reusingTextImage'));
    }

    let textLayerKey = dynamicTextEnabled ? '' : output.textLayerKey;
    if (!dynamicTextEnabled && !textLayerKey) {
      setStatus(tr('automation.pipeline.preparingSubtitleLayer'));
      textLayerKey = await burnOverlayText(imageKey, caption, pr.config.overlay, { transparent: true, title });
      output = await persistAutomationBlockOutput(projectId, block.id, { textLayerKey });
      await tagAutomationStage(pr, block, [textLayerKey]);
    }

    const audioKeys = Array.isArray(output.audioKeys)
      ? output.audioKeys.slice(0, block.items.length)
      : [];
    if (requireExistingAudio && audioKeys.length !== block.items.length) {
      throw new Error(tr('automation.pipeline.savedAudioRequired'));
    }
    const usedAudioKeys = new Set(audioKeys);
    for (let index = audioKeys.length; index < block.items.length; index++) {
      const spec = automationAudioSpec(pr, block.items[index]);
      let recovered = null;
      if (!regenerate && !regenerateAudio) {
        if (!historyLoaded) {
          setStatus(tr('automation.pipeline.searchingAudio'));
          await refreshAutomationHistory();
          historyLoaded = true;
        }
        recovered = recoverHistoryOutput('audio', spec.text, { voiceId: spec.voiceId, audioModelId: spec.audioModelId, usedKeys: usedAudioKeys });
      }
      if (recovered) {
        audioKeys.push(recovered.key);
        usedAudioKeys.add(recovered.key);
        setStatus(tr('automation.pipeline.reusingAudio', { current: audioKeys.length, total: block.items.length }));
      } else {
        setStatus(tr('automation.pipeline.generatingAudio', { current: index + 1, total: block.items.length }));
        const generatedAudio = await api('/api/generate/audio', { method: 'POST', body: spec });
        const audioKey = generatedAudio.outputs?.[0];
        if (!audioKey) throw new Error(tr('automation.pipeline.audioNotGenerated', { number: index + 1 }));
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
      ? tr('automation.pipeline.generatingSegments', { model: block.generator === 'seedance25' ? 'Seedance 2.5' : block.generator === 'omni' ? 'Gemini Omni' : 'MiniMax H3' })
      : dynamicTextEnabled ? tr('automation.pipeline.animatingText') : tr('automation.pipeline.assemblingVideo'));
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
    if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { detail: isGenerativeVideo ? tr('automation.pipeline.modelTakeDone', { model: block.generator === 'seedance25' ? 'Seedance 2.5' : block.generator === 'omni' ? 'Gemini Omni' : 'MiniMax H3' }) : tr('automation.pipeline.takeDone') });
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
      outEl.innerHTML = `${automationBlockOutHtml(latest, block)}<span class="hint warn">${esc(tr('automation.pipeline.failedReusable', { error: err.message }))}</span>`;
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
  if (!targets.length) return toast(tr('automation.run.noBlocksForOption'), 'ok');
  if (mode === 'all' && !confirm(trn('automation.run.regenerateBlocksConfirm', targets.length))) return;
  const monitorTaskId = startUiTask({
    title: tr('automation.run.runningProject', { name: pr.name }),
    detail: tr('automation.run.preparingBlock', { current: 1, total: targets.length }),
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
      updateUiTask(monitorTaskId, { current: ok, detail: tr('automation.run.blocksDone', { completed: ok, total: targets.length }) });
    } else break; // si uno falla, freno para no encadenar errores
  }
  if (ok === targets.length) finishUiTask(monitorTaskId, { detail: tr('automation.run.blocksDone', { completed: ok, total: targets.length }) });
  else finishUiTask(monitorTaskId, { error: tr('automation.run.stopped', { completed: ok, total: targets.length }) });
  toast(tr('automation.run.summary', { completed: ok, total: targets.length }), ok === targets.length ? 'ok' : 'err');
}

async function assembleAutomationProject(projectId) {
  const pr = state.automations.find((item) => item.id === projectId);
  if (!pr) return;
  if (pr.finalOutput?.videoKey && !confirm(tr('automation.finalVideo.newAssemblyConfirm'))) return;
  const button = $('#autoAssemble');
  const status = $('#autoAssembleStatus');
  if (button) button.disabled = true;
  const hasTransitions = pr.config?.transitionSound?.enabled && pr.blocks.length > 1;
  if (status) status.textContent = tr('automation.finalVideo.assemblingStatus', {
    videos: pr.blocks.length,
    transitions: hasTransitions ? tr('automation.finalVideo.addingTransitions', { count: pr.blocks.length - 1 }) : '',
    music: pr.config?.music?.enabled ? tr('automation.finalVideo.mixingMusic') : '',
    logo: pr.config?.includeLogos ? tr('automation.finalVideo.addingLogo') : ''
  });
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
    toast(tr('automation.finalVideo.assembled', {
      blocks: trn('automation.blockCount', result.finalOutput.blockCount),
      transitions: result.finalOutput.transitionCount ? `, ${trn('automation.finalVideo.soundTransitions', result.finalOutput.transitionCount)}` : '',
      music: result.finalOutput.musicKey ? tr('automation.finalVideo.withMusic') : '',
      logo: result.finalOutput.includeLogos ? tr('automation.finalVideo.withLogo') : ''
    }), 'ok');
  } catch (error) {
    if (button) button.disabled = false;
    if (status) status.textContent = tr('automation.finalVideo.assemblyFailed', { error: error.message });
    toast(error.message, 'err');
  }
}

async function ensureAutomationSubtitleLayers(projectId, taskId = '', { force = false } = {}) {
  let pr = state.automations.find((item) => item.id === projectId);
  if (!pr) throw new Error(tr('automation.errors.projectUnavailable'));
  const dynamicTextEnabled = pr.config?.dynamicText?.enabled === true;
  for (let index = 0; index < pr.blocks.length; index++) {
    const block = pr.blocks[index];
    let output = pr.outputs?.[block.id] || {};
    updateUiTask(taskId, {
      current: index + 1,
      detail: force
        ? tr('automation.textRefresh.regeneratingProgress', { current: index + 1, total: pr.blocks.length })
        : (dynamicTextEnabled ? output.motionOverlayKey : output.textLayerKey)
        ? tr('automation.textRefresh.verifyingProgress', { current: index + 1, total: pr.blocks.length })
        : tr('automation.textRefresh.creatingLayerProgress', { current: index + 1, total: pr.blocks.length })
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
      throw new Error(tr('automation.textRefresh.missingAnimatedLayer', { title: block.title || block.id }));
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
  if (!pr?.finalOutput?.videoKey) return toast(tr('automation.textRefresh.assembleFirst'), 'err');
  const target = pr.effectOutput?.videoKey ? 'effect' : 'final';
  const targetLabel = tr(target === 'effect' ? 'automation.textRefresh.effectVersion' : 'automation.textRefresh.cleanFinal');
  if (!confirm(tr('automation.textRefresh.confirm', { target: targetLabel }))) return;
  const button = $('#autoRefreshAllText');
  const status = $('#autoRefreshTextStatus');
  const taskId = startUiTask({
    title: tr('automation.textRefresh.regeneratingAll'),
    detail: tr('automation.run.preparingBlock', { current: 1, total: pr.blocks.length }),
    total: pr.blocks.length + 1,
    current: 1
  });
  if (button) button.disabled = true;
  if (status) status.textContent = tr('automation.textRefresh.regeneratingLayers', { target: targetLabel });
  try {
    pr = await ensureAutomationSubtitleLayers(projectId, taskId, { force: true });
    updateUiTask(taskId, {
      current: pr.blocks.length + 1,
      detail: tr('automation.textRefresh.recomposing', { target: targetLabel })
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
    finishUiTask(taskId, { detail: tr('automation.textRefresh.updatedOnly', { target: targetLabel }) });
    renderAutomationProject();
    toast(tr('automation.textRefresh.completed', { target: targetLabel }), 'ok');
  } catch (error) {
    finishUiTask(taskId, { error: error.message });
    if (button) button.disabled = false;
    if (status) status.textContent = tr('automation.textRefresh.failed', { error: error.message });
    toast(error.message, 'err');
  }
}

async function applyAutomationVideoEffect(projectId, requestedEffect) {
  let pr = state.automations.find((item) => item.id === projectId);
  if (!pr?.finalOutput?.videoKey) return toast(tr('automation.effects.assembleFirst'), 'err');
  if (pr.effectOutput?.videoKey && !confirm(tr('automation.effects.anotherConfirm'))) return;
  const button = $('#autoApplyEffect');
  const status = $('#autoEffectStatus');
  const taskId = startUiTask({
    title: tr('automation.effects.preparingVersion'),
    detail: tr('automation.effects.verifyingLayers'),
    total: pr.blocks.length + 1,
    current: 1
  });
  if (button) button.disabled = true;
  if (status) status.textContent = tr('automation.effects.preparingCleanLayers');
  try {
    const refreshPendingText = Boolean(pr.textRefreshRequiredAt);
    pr = await ensureAutomationSubtitleLayers(projectId, taskId, { force: refreshPendingText });
    updateUiTask(taskId, {
      current: pr.blocks.length + 1,
      detail: tr('automation.effects.applyingBelowText')
    });
    if (status) status.textContent = tr('automation.effects.applyingStages');
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
    finishUiTask(taskId, { detail: tr('automation.effects.appliedPreserved') });
    renderAutomationProject();
    const maskSummary = result.effectOutput.maskEnabled
      ? tr('automation.effects.maskSummary', { color: result.effectOutput.maskColor, opacity: result.effectOutput.maskOpacity })
      : '';
    toast(tr('automation.effects.completed', { preset: result.effectOutput.presetName, intensity: result.effectOutput.intensity, mask: maskSummary }), 'ok');
  } catch (error) {
    finishUiTask(taskId, { error: error.message });
    if (button) button.disabled = false;
    if (status) status.textContent = tr('automation.effects.failed', { error: error.message });
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
    <h5>${esc(tr(isHighlight ? 'automation.overlay.highlightedText' : isTitle ? 'subtitler.videoTitleLabel' : 'automation.overlay.normalText'))}</h5>
    <label><span>${esc(tr('automation.overlay.font'))}</span><span class="overlay-font-line"><select class="select" id="${id}Font">${overlayFontOptions(font, { inherit: isHighlight })}</select><button type="button" class="mini-btn" data-sub-import-font="${kind}">${esc(tr('common.import'))}</button></span></label>
    <label><span>${esc(tr('automation.overlay.size'))}</span><input type="number" id="${id}Size" min="8" max="300" step="1" value="${size}"></label>
    <label><span>${esc(tr('automation.overlay.weight'))}</span><select class="select" id="${id}Weight">${[400, 500, 600, 700, 800, 900].map((value) => `<option value="${value}"${value === weight ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
    <label><span>${esc(tr('automation.overlay.letterCase'))}</span><select class="select" id="${id}Transform">${[['none', tr('automation.overlay.asWritten')], ['uppercase', tr('automation.overlay.uppercase')], ['lowercase', tr('automation.overlay.lowercase')], ['capitalize', tr('automation.overlay.capitalize')]].map(([value, label]) => `<option value="${value}"${value === (transform || 'none') ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
    <div class="overlay-format-options"><label><input type="checkbox" id="${id}Italic"${italic ? ' checked' : ''}> <em>${esc(tr('automation.overlay.italic'))}</em></label><label><input type="checkbox" id="${id}Underline"${underline ? ' checked' : ''}> <u>${esc(tr('automation.overlay.underline'))}</u></label><label><input type="checkbox" id="${id}Strike"${strike ? ' checked' : ''}> <s>${esc(tr('automation.overlay.strike'))}</s></label></div>
    <label><span>${esc(tr('automation.overlay.color'))}</span><input type="color" id="${id}Color" value="${esc(color || '#ffffff')}"></label>
    <label><span>${esc(tr('automation.overlay.strokeColor'))}</span><input type="color" id="${id}Stroke" value="${esc(stroke || '#000000')}"></label>
    <label><span>${esc(tr('automation.overlay.strokeWidth'))}</span><input type="number" id="${id}StrokeW" min="0" max="30" step="0.5" value="${strokeWidth || 0}"></label>
  </div>`;
}

function subtitlerLineMarkup(line, index) {
  return `<div class="subtitler-line" data-sub-line="${esc(line.id)}">
    <b class="subtitler-line-index">${index + 1}</b>
    <label><span>${esc(tr('subtitler.start'))}</span><input type="number" data-sub-start min="0" step="0.01" value="${Number(line.start).toFixed(2)}"></label>
    <label><span>${esc(tr('subtitler.end'))}</span><input type="number" data-sub-end min="0" step="0.01" value="${Number(line.end).toFixed(2)}"></label>
    <label class="subtitler-line-text"><span>${line.speakerId ? `${esc(line.speakerId)} · ` : ''}${esc(tr('subtitler.interpretedText'))}</span><textarea data-sub-text rows="2" maxlength="2000">${esc(line.text)}</textarea></label>
    <button type="button" class="icon-btn" data-sub-remove-line title="${esc(tr('subtitler.removeLine'))}">${IC('trash')}</button>
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
    ? tr('subtitler.transcript.status', {
      lines: trn('subtitler.lineCount', studio.lines.length),
      language: studio.transcript.languageCode || tr('subtitler.transcript.detectedLanguage'),
      probability: studio.transcript.languageProbability ? ` · ${Math.round(studio.transcript.languageProbability * 100)}%` : '',
      date: fmtDate(studio.transcript.transcribedAt)
    })
    : tr('subtitler.transcript.notTranscribed');
  root.innerHTML = `<section class="automation-panel subtitler-project-panel">
    <div class="subtitler-project-copy"><h3>${esc(tr('subtitler.project.title'))}</h3><span class="hint">${esc(tr('subtitler.project.hint'))}</span></div>
    <label><span>${esc(tr('subtitler.project.saved'))}</span><select class="select" id="subProjectSelect">${projects.map((project) => `<option value="${esc(project.id)}"${project.id === studio.activeProjectId ? ' selected' : ''}>${esc(project.name)}${project.lineCount ? ` · ${esc(trn('subtitler.lineCount', project.lineCount))}` : ''}</option>`).join('')}</select></label>
    <label><span>${esc(tr('common.name'))}</span><input type="text" id="subProjectName" maxlength="160" value="${esc(studio.name || '')}" placeholder="${esc(tr('subtitler.project.namePlaceholder'))}"></label>
    <div class="subtitler-project-actions"><button type="button" class="mini-btn" id="subProjectNew">${IC('plus')} ${esc(tr('common.new'))}</button><button type="button" class="mini-btn accent" id="subProjectSave">${IC('save')} ${esc(tr('subtitler.project.save'))}</button><button type="button" class="mini-btn danger" id="subProjectDelete"${projects.length <= 1 ? ' disabled' : ''}>${IC('trash')} ${esc(tr('common.delete'))}</button></div>
    <span class="subtitler-motion-badge${dynamicText.enabled ? ' active' : ''}">${IC('spark')} ${esc(tr(dynamicText.enabled ? 'subtitler.animations.active' : 'subtitler.animations.disabled'))}</span>
  </section>
  <div class="subtitler-source-grid">
    <section class="automation-panel subtitler-source-panel">
      <div class="automation-panel-heading"><div><h3>${esc(tr('subtitler.source.title'))}</h3><span class="hint">${esc(tr('subtitler.source.hint'))}</span></div></div>
      <label><span>${esc(tr('common.video'))}</span><select class="select" id="subSourceVideo"><option value="">— ${esc(tr('subtitler.source.chooseVideo'))} —</option>${videos.map((video) => `<option value="${esc(video.key)}"${video.key === studio.sourceVideoKey ? ' selected' : ''}>${esc(video.name)}</option>`).join('')}</select></label>
      ${source ? `<video src="${fileUrl(source.key)}" controls preload="metadata"></video><span class="hint">${esc(source.name)}</span>` : `<div class="empty-note">${esc(tr('subtitler.source.empty'))}</div>`}
    </section>
    <section class="automation-panel subtitler-transcribe-panel">
      <div class="automation-panel-heading"><div><h3>${esc(tr('subtitler.transcript.title'))}</h3><span class="hint">${esc(tr('subtitler.transcript.hint'))}</span></div></div>
      <div class="subtitler-transcribe-controls">
        <label><span>${esc(tr('subtitler.transcript.language'))}</span><select class="select" id="subLanguage"><option value=""${studio.languageCode ? '' : ' selected'}>${esc(tr('subtitler.transcript.autoDetect'))}</option><option value="spa"${studio.languageCode === 'spa' ? ' selected' : ''}>Español</option><option value="eng"${studio.languageCode === 'eng' ? ' selected' : ''}>English</option><option value="por"${studio.languageCode === 'por' ? ' selected' : ''}>Português</option></select></label>
        <label class="poser-toggle"><input type="checkbox" id="subNoVerbatim"${studio.noVerbatim !== false ? ' checked' : ''}> ${esc(tr('subtitler.transcript.cleanDisfluencies'))}</label>
        <button type="button" class="generate-btn small" id="subTranscribe"${source ? '' : ' disabled'}>${IC('mic')} ${esc(tr(studio.transcript ? 'subtitler.transcript.retranscribe' : 'subtitler.transcript.extractAndTranscribe'))}</button>
      </div>
      <span class="automation-stage-status" id="subTranscriptStatus">${esc(transcriptStatus)}</span>
    </section>
  </div>
  <section class="automation-panel subtitler-lines-panel">
    <div class="automation-panel-heading"><div><h3>${esc(tr('subtitler.lines.title'))}</h3><span class="hint">${esc(tr('subtitler.lines.hint'))}</span></div><div class="subtitler-line-actions"><button type="button" class="mini-btn" id="subExportTxt"${studio.lines.length ? '' : ' disabled'}>${IC('download')} TXT</button><button type="button" class="mini-btn" id="subExportSrt"${studio.lines.length ? '' : ' disabled'}>${IC('download')} SRT</button><button type="button" class="mini-btn" id="subAddLine">${IC('plus')} ${esc(tr('subtitler.line'))}</button><button type="button" class="mini-btn accent" id="subSaveLines"${studio.lines.length ? '' : ' disabled'}>${IC('save')} ${esc(tr('subtitler.lines.saveCorrections'))}</button></div></div>
    <div class="subtitler-lines">${studio.lines.length ? studio.lines.map(subtitlerLineMarkup).join('') : `<div class="empty-note">${esc(tr('subtitler.lines.empty'))}</div>`}</div>
  </section>
  <section class="automation-panel subtitler-style-panel">
    <div class="overlay-preset-bar"><div><h4>${esc(tr('subtitler.style.title'))}</h4><span class="hint">${esc(tr('subtitler.style.hint'))}</span></div><select class="select" id="subPreset">${overlayPresetOptions()}</select><button type="button" class="mini-btn" id="subPresetApply" disabled>${IC('check')} ${esc(tr('common.apply'))}</button><button type="button" class="mini-btn accent" id="subPresetSave">${IC('save')} ${esc(tr('automation.textStyles.saveCurrent'))}</button><button type="button" class="mini-btn danger" id="subPresetDelete" disabled title="${esc(tr('common.delete'))}">${IC('trash')}</button></div>
    <div class="automation-dynamic-text-panel${dynamicText.enabled ? ' enabled' : ''}" id="subDynamicPanel"><div class="automation-dynamic-text-head"><div><h4>${esc(tr('automation.dynamicText.title'))}</h4><span class="hint">${esc(tr('subtitler.animations.hint'))}</span></div><label class="poser-toggle"><input type="checkbox" id="subDynamicEnabled"${dynamicText.enabled ? ' checked' : ''}> ${esc(tr('subtitler.animations.enable'))}</label></div><div class="automation-dynamic-text-grid">
      <label><span>${esc(tr('automation.dynamicText.titleAnimation'))}</span><select class="select" id="subTitleAnimation"><option value="rise"${dynamicText.titleAnimation === 'rise' ? ' selected' : ''}>${esc(tr('automation.dynamicText.rise'))}</option><option value="slam"${dynamicText.titleAnimation === 'slam' ? ' selected' : ''}>${esc(tr('automation.dynamicText.slam'))}</option><option value="typewriter"${dynamicText.titleAnimation === 'typewriter' ? ' selected' : ''}>${esc(tr('automation.dynamicText.typewriter'))}</option></select></label>
      <label><span>${esc(tr('automation.dynamicText.captionAnimation'))}</span><select class="select" id="subCaptionAnimation"><option value="word-pop"${dynamicText.captionAnimation === 'word-pop' ? ' selected' : ''}>${esc(tr('automation.dynamicText.wordPop'))}</option><option value="karaoke"${dynamicText.captionAnimation === 'karaoke' ? ' selected' : ''}>${esc(tr('automation.dynamicText.karaoke'))}</option><option value="bounce"${dynamicText.captionAnimation === 'bounce' ? ' selected' : ''}>${esc(tr('automation.dynamicText.bounce'))}</option></select></label>
      <label><span>${esc(tr('automation.dynamicText.wordsPerGroup'))}</span><input type="number" id="subWordsPerPage" min="1" max="12" value="${dynamicText.wordsPerPage}"></label>
    </div></div>
    <h4>${esc(tr('automation.overlay.title'))}</h4><div class="overlay-typography-grid">${subtitlerTypeCard('normal', ov)}${subtitlerTypeCard('highlight', ov)}</div>
    <div class="overlay-layout-controls"><label><span>${esc(tr('automation.overlay.verticalPosition'))}</span><select class="select" id="subOvPos">${[['top', tr('automation.overlay.top')], ['center', tr('automation.overlay.center')], ['bottom', tr('automation.overlay.bottom')]].map(([value, label]) => `<option value="${value}"${value === ov.position ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label><label><span>${esc(tr('subtitler.alignment'))}</span><select class="select" id="subOvAlign">${[['left', tr('automation.overlay.left')], ['center', tr('automation.overlay.center')], ['right', tr('automation.overlay.right')]].map(([value, label]) => `<option value="${value}"${value === ov.align ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label><label><span>${esc(tr('automation.overlay.maxWidth'))}</span><input type="number" id="subOvMaxWidth" min="20" max="100" value="${ov.maxWidthPct || 88}"></label><button type="button" class="mini-btn" id="subOvCenter">${esc(tr('automation.overlay.centerHorizontally'))}</button><label class="poser-toggle"><input type="checkbox" id="subOvBg"${ov.bg ? ' checked' : ''}> ${esc(tr('automation.overlay.backgroundBox'))}</label></div>
    <div class="title-overlay-panel${titleOv.enabled ? ' enabled' : ''}" id="subTitlePanel"><div class="title-overlay-heading"><div><h4>${esc(tr('subtitler.videoTitleLabel'))}</h4><span class="hint">${esc(tr('subtitler.titleHint'))}</span></div><label class="poser-toggle"><input type="checkbox" id="subTitleEnabled"${titleOv.enabled ? ' checked' : ''}> ${esc(tr('automation.overlay.includeTitle'))}</label></div><label><span>${esc(tr('subtitler.titleText'))}</span><input type="text" id="subTitleText" maxlength="300" value="${esc(titleOv.text || '')}" placeholder="${esc(tr('subtitler.videoTitle'))}"></label><div class="overlay-typography-grid single">${subtitlerTypeCard('title', titleOv)}</div><div class="overlay-layout-controls"><label><span>${esc(tr('automation.overlay.verticalPosition'))}</span><select class="select" id="subTitlePos">${[['top', tr('automation.overlay.top')], ['center', tr('automation.overlay.center')], ['bottom', tr('automation.overlay.bottom')]].map(([value, label]) => `<option value="${value}"${value === titleOv.position ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label><label><span>${esc(tr('subtitler.alignment'))}</span><select class="select" id="subTitleAlign">${[['left', tr('automation.overlay.left')], ['center', tr('automation.overlay.center')], ['right', tr('automation.overlay.right')]].map(([value, label]) => `<option value="${value}"${value === titleOv.align ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label><label><span>${esc(tr('automation.overlay.maxWidth'))}</span><input type="number" id="subTitleMaxWidth" min="20" max="100" value="${titleOv.maxWidthPct || 88}"></label><button type="button" class="mini-btn" id="subTitleCenter">${esc(tr('automation.overlay.centerHorizontally'))}</button><label class="poser-toggle"><input type="checkbox" id="subTitleBg"${titleOv.bg ? ' checked' : ''}> ${esc(tr('automation.overlay.backgroundBox'))}</label></div></div>
    <input type="file" id="subFontFile" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden>
    <div class="ov-preview subtitler-preview" id="subPreview" style="aspect-ratio:${source ? '9/16' : '9/16'}">${source ? `<video class="ov-preview-bg" src="${fileUrl(source.key)}" muted loop autoplay playsinline></video>` : ''}<div class="ov-title" id="subPreviewTitle">${esc(titleOv.text || '')}</div><div class="ov-text" id="subPreviewText"><span class="ov-normal">${esc(tr('automation.overlay.previewBefore'))}</span><span class="ov-hl">${esc(tr('automation.overlay.previewHighlight'))}</span><span class="ov-normal">${esc(tr('subtitler.previewAfter'))}</span></div></div>
  </section>
  <section class="automation-panel subtitler-render-panel"><div><h3>${esc(tr('subtitler.render.title'))}</h3><p>${esc(tr('subtitler.render.hint'))}</p><span class="hint" id="subRenderStatus">${latest ? esc(tr('subtitler.render.latest', { words: trn('subtitler.wordCount', latest.wordCount), date: fmtDate(latest.renderedAt) })) : esc(tr('subtitler.render.none'))}</span></div><button type="button" class="generate-btn" id="subRender"${source && studio.lines.length ? '' : ' disabled'}>${IC('film')} ${esc(tr('subtitler.render.button'))}</button>${latest ? `<div class="final-assembly-preview"><video src="${fileUrl(latest.videoKey)}" controls preload="metadata"></video><button type="button" class="mini-btn" data-open-asset="${esc(latest.videoKey)}">${esc(tr('subtitler.render.openResult'))}</button></div>` : ''}</section>`;

  const preview = $('#subPreview'), previewText = $('#subPreviewText'), previewTitle = $('#subPreviewTitle');
  const updatePreview = () => {
    applySubtitlePreviewStyles({ preview, text: previewText, titleText: previewTitle, overlay: ov, titleOverlay: titleOv, visibleTitle: titleOv.text || tr('subtitler.videoTitle') });
    $('#subDynamicPanel').classList.toggle('enabled', dynamicText.enabled);
    $('#subTitlePanel').classList.toggle('enabled', titleOv.enabled);
    const motionBadge = root.querySelector('.subtitler-motion-badge');
    motionBadge?.classList.toggle('active', dynamicText.enabled);
    if (motionBadge) motionBadge.innerHTML = `${IC('spark')} ${tr(dynamicText.enabled ? 'subtitler.animations.active' : 'subtitler.animations.disabled')}`;
  };
  const config = () => ({ overlay: ov, titleOverlay: titleOv, dynamicText });
  const persistConfig = () => saveSubtitler({ config: config() });
  const projectSnapshot = () => ({
    name: $('#subProjectName').value.trim() || studio.name || tr('subtitler.project.defaultName'),
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
    try { await saveSubtitler(projectSnapshot()); toast(tr('subtitler.project.savedToast'), 'ok'); }
    catch (error) { toast(error.message, 'err'); }
  });
  $('#subProjectNew').addEventListener('click', async () => {
    const name = window.prompt(tr('subtitler.project.newNamePrompt'), tr('automation.defaultProjectName'));
    if (!name?.trim()) return;
    try {
      await saveSubtitler(projectSnapshot());
      state.subtitler = await api('/api/subtitler/projects', { method: 'POST', body: { name: name.trim() }, task: false });
      renderSubtitler();
      toast(tr('subtitler.project.created'), 'ok');
    } catch (error) { toast(error.message, 'err'); }
  });
  $('#subProjectDelete').addEventListener('click', async () => {
    if (!confirm(tr('subtitler.project.deleteConfirm', { name: studio.name }))) return;
    try {
      state.subtitler = await api(`/api/subtitler/projects/${studio.activeProjectId}`, { method: 'DELETE', task: false });
      renderSubtitler();
      toast(tr('subtitler.project.deleted'));
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
      renderSubtitler(); toast(tr('subtitler.transcript.completed'), 'ok');
    } catch (error) { button.disabled = false; toast(error.message, 'err'); }
  });
  const saveLines = async () => { studio.lines = readSubtitlerLines(root, studio.lines); await saveSubtitler({ lines: studio.lines }); toast(tr('subtitler.lines.saved')); };
  $('#subSaveLines').addEventListener('click', saveLines);
  $('#subExportTxt').addEventListener('click', () => {
    const lines = readSubtitlerLines(root, studio.lines);
    if (!lines.length) return toast(tr('subtitler.lines.noneToExport'), 'err');
    downloadSubtitleFile({
      name: $('#subProjectName').value.trim() || studio.name,
      extension: 'txt',
      mime: 'text/plain',
      content: lines.map((line) => line.text).join('\r\n')
    });
    toast(tr('subtitler.lines.exportedTxt'), 'ok');
  });
  $('#subExportSrt').addEventListener('click', () => {
    const lines = readSubtitlerLines(root, studio.lines);
    if (!lines.length) return toast(tr('subtitler.lines.noneToExport'), 'err');
    downloadSubtitleFile({
      name: $('#subProjectName').value.trim() || studio.name,
      extension: 'srt',
      mime: 'application/x-subrip',
      content: lines.map((line, index) => `${index + 1}\r\n${subtitleSrtTime(line.start)} --> ${subtitleSrtTime(line.end)}\r\n${line.text}`).join('\r\n\r\n') + '\r\n'
    });
    toast(tr('subtitler.lines.exportedSrt'), 'ok');
  });
  root.querySelectorAll('[data-sub-remove-line]').forEach((button) => button.addEventListener('click', async () => { button.closest('[data-sub-line]').remove(); await saveLines(); renderSubtitler(); }));
  $('#subAddLine').addEventListener('click', async () => { const last = studio.lines.at(-1); studio.lines.push({ id: `line-${Date.now()}`, start: last?.end || 0, end: (last?.end || 0) + 2, text: tr('subtitler.lines.newLine'), sourceText: '', sourceWords: [] }); await saveSubtitler({ lines: studio.lines }, { rerender: true }); });
  $('#subRender').addEventListener('click', async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const lines = readSubtitlerLines(root, studio.lines);
      state.subtitler = await api('/api/subtitler/render', { method: 'POST', body: { projectId: studio.activeProjectId, sourceVideoKey: studio.sourceVideoKey, lines, config: config() } });
      await refreshAssets(); renderSubtitler(); toast(tr('subtitler.render.completed'), 'ok');
    } catch (error) { button.disabled = false; toast(error.message, 'err'); }
  });
  $('#subPreset').addEventListener('change', (event) => { const enabled = Boolean(event.target.value); $('#subPresetApply').disabled = !enabled; $('#subPresetDelete').disabled = !enabled; });
  $('#subPresetApply').addEventListener('click', async () => { const preset = state.overlayPresets.find((item) => item.id === $('#subPreset').value); if (!preset) return; Object.assign(ov, preset.overlay || {}); Object.assign(titleOv, preset.titleOverlay || {}); Object.assign(dynamicText, preset.dynamicText || {}); await saveSubtitler({ config: config() }, { rerender: true }); });
  $('#subPresetSave').addEventListener('click', async () => { const name = window.prompt(tr('automation.textStyles.namePrompt')); if (!name?.trim()) return; const item = await api('/api/overlay-presets', { method: 'POST', body: { name: name.trim(), overlay: ov, titleOverlay: titleOv, dynamicText } }); state.overlayPresets.unshift(item); renderSubtitler(); toast(tr('automation.textStyles.saved', { name: item.name })); });
  $('#subPresetDelete').addEventListener('click', async () => { const preset = state.overlayPresets.find((item) => item.id === $('#subPreset').value); if (!preset || !confirm(tr('automation.textStyles.deleteConfirm', { name: preset.name }))) return; await api(`/api/overlay-presets/${preset.id}`, { method: 'DELETE' }); state.overlayPresets = state.overlayPresets.filter((item) => item.id !== preset.id); renderSubtitler(); });
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
  if (file.size > 100 * 1024 * 1024) return toast(tr('subtitler.uploadTooLarge'), 'err');
  try {
    const uploaded = await api('/api/assets/visual', { method: 'POST', body: { name: file.name, dataUrl: await readFileAsDataUrl(file), category: 'Subtitulador', tags: ['subtitulado'] } });
    await refreshAssets();
    await saveSubtitler({ sourceVideoKey: uploaded.key, sourceName: uploaded.name, transcript: null, lines: [] }, { rerender: true });
    toast(tr('subtitler.uploaded'), 'ok');
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
        el.textContent = tr('create.estimate.heygenPlan');
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
    el.textContent = perTrack ? `≈ $${(perTrack * 2).toFixed(3)} (${tr('create.estimate.variants')})` : '';
  } else if (state.mode === 'comfyui') {
    el.textContent = tr('create.estimate.localFree');
  } else {
    const per1k = state.pricing.audio?.[state.audioModelId]?.per1kChars
      ?? state.pricing.audio?.['eleven-v3']?.per1kChars
      ?? 0;
    const chars = promptBox.value.length;
    el.textContent = chars
      ? `≈ $${((chars / 1000) * per1k).toFixed(3)} (${tr('create.estimate.charactersShort', { count: i18n?.formatNumber(chars) ?? chars })})`
      : tr('create.estimate.perCharacters', { price: per1k.toFixed(2) });
  }
}

const fmtUsd = (n) => `$${(n || 0).toFixed(n >= 10 ? 2 : 3)}`;

function renderProjectCostEstimate(projects) {
  const root = $('#costProjectEstimate');
  if (!root) return;
  if (!projects?.length) {
    root.innerHTML = `<h3>${esc(tr('costs.projectEstimate'))}</h3><div class="empty-note" style="padding:8px 0">${esc(tr('costs.noAutomationProjects'))}</div>`;
    return;
  }
  const selected = projects.find((project) => project.id === state.costProjectId) || projects[0];
  state.costProjectId = selected.id;
  const detail = selected.breakdown;
  const extraSpent = selected.spent > selected.estimatedTotal + 0.000001;
  root.innerHTML = `
    <div class="cost-project-head">
      <div>
        <h3>${esc(tr('costs.projectEstimateTitle'))}</h3>
        <span class="hint">${esc(tr('costs.projectEstimateHint'))}</span>
      </div>
      <label>${esc(tr('costs.project'))}
        <select class="select" id="costProjectSelect">
          ${projects.map((project, index) => `<option value="${esc(project.id)}"${project.id === selected.id ? ' selected' : ''}>${index === 0 ? `${esc(tr('costs.latest'))} · ` : ''}${esc(project.name)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="project-cost-title">
      <strong>${esc(selected.name)}</strong>
      <span class="hint">${esc(tr('costs.projectMeta', { model: selected.modelName, resolution: selected.resolution, aspect: selected.aspectRatio || tr('costs.automaticAspect'), date: fmtDate(selected.updatedAt || selected.ts) }))}</span>
    </div>
    <div class="project-cost-summary">
      <div class="project-cost-stat">
        <span>${esc(tr('costs.fullProductionEstimate'))}</span>
        <strong>${fmtUsd(selected.estimatedTotal)}</strong>
      </div>
      <div class="project-cost-stat">
        <span>${esc(tr('costs.linkedUsage'))}</span>
        <strong>${fmtUsd(selected.spent)}</strong>
      </div>
      <div class="project-cost-stat">
        <span>${esc(tr('costs.expectedMaterial'))}</span>
        <strong>${esc(tr('costs.materialSummary', {
          images: trn('costs.imageCount', detail.resourceImages + detail.blockImages),
          voices: trn('costs.voiceCount', detail.audioItems),
          h3: detail.h3Blocks ? ` · ${trn('costs.shotCount', detail.h3Blocks)} H3` : '',
          seedance: detail.seedance25Blocks ? ` · ${trn('costs.shotCount', detail.seedance25Blocks)} Seedance 2.5` : '',
          omni: detail.omniBlocks ? ` · ${trn('costs.shotCount', detail.omniBlocks)} Omni` : '',
          music: detail.musicEnabled ? ` · ${tr('costs.oneMusicTrack')}` : ''
        }))}</strong>
      </div>
    </div>
    <div class="project-cost-breakdown">
      <div class="cost-row">
        <span class="cr-label">${esc(tr('costs.resourceSheets'))}<span class="cr-sub">${detail.resourceImages} × ${esc(selected.modelName)} ${esc(detail.resourceResolution)}</span></span>
        <span class="cr-value">${fmtUsd(detail.resourceImageCost)}</span>
      </div>
      <div class="cost-row">
        <span class="cr-label">${esc(tr('costs.blockImages'))}<span class="cr-sub">${detail.blockImages} × ${esc(selected.modelName)} ${esc(detail.blockResolution)}</span></span>
        <span class="cr-value">${fmtUsd(detail.blockImageCost)}</span>
      </div>
      <div class="cost-row">
        <span class="cr-label">${esc(tr('costs.narrationVoices'))}<span class="cr-sub">${esc(tr('costs.audioUsage', { audios: trn('costs.audioCount', detail.audioItems), characters: trn('costs.characterCount', detail.audioCharacters), model: detail.audioModelName || 'ElevenLabs' }))}</span></span>
        <span class="cr-value">${fmtUsd(detail.audioCost)}</span>
      </div>
      ${detail.h3Blocks ? `<div class="cost-row">
        <span class="cr-label">${esc(tr('costs.generativeVideo', { model: 'MiniMax H3' }))}<span class="cr-sub">${esc(tr('costs.billableVideo', { blocks: trn('automation.blockCount', detail.h3Blocks), seconds: Math.round(detail.h3EstimatedSeconds || 0) }))}</span></span>
        <span class="cr-value">${fmtUsd(detail.h3VideoCost)}</span>
      </div>` : ''}
      ${detail.seedance25Blocks ? `<div class="cost-row">
        <span class="cr-label">${esc(tr('costs.generativeVideo', { model: 'Seedance 2.5' }))}<span class="cr-sub">${esc(tr('costs.billableVideo', { blocks: trn('automation.blockCount', detail.seedance25Blocks), seconds: Math.round(detail.seedance25EstimatedSeconds || 0) }))}</span></span>
        <span class="cr-value">${fmtUsd(detail.seedance25VideoCost)}</span>
      </div>` : ''}
      ${detail.omniBlocks ? `<div class="cost-row">
        <span class="cr-label">${esc(tr('costs.generativeVideo', { model: 'Gemini Omni' }))}<span class="cr-sub">${esc(tr('costs.billableVideo', { blocks: trn('automation.blockCount', detail.omniBlocks), seconds: Math.round(detail.omniEstimatedSeconds || 0) }))}</span></span>
        <span class="cr-value">${fmtUsd(detail.omniVideoCost)}</span>
      </div>` : ''}
      ${detail.musicEnabled ? `<div class="cost-row">
        <span class="cr-label">${esc(tr('costs.backgroundMusic'))}<span class="cr-sub">${esc(detail.musicSource === 'suno' ? trn('costs.sunoVariantCount', detail.generatedMusicTracks) : detail.musicSource === 'auto' ? tr('costs.automaticAssetSelection') : tr('costs.existingAssetTrack'))}</span></span>
        <span class="cr-value">${fmtUsd(detail.musicCost)}</span>
      </div>` : ''}
      <div class="cost-row">
        <span class="cr-label">${esc(tr('costs.localPostProduction'))}<span class="cr-sub">${esc(tr('costs.localProcessing'))}</span></span>
        <span class="cr-value">${fmtUsd(detail.localVideoCost)}</span>
      </div>
    </div>
    <p class="hint project-cost-note">${extraSpent
      ? esc(tr('costs.extraSpentNote'))
      : esc(tr('costs.estimateNote'))}</p>`;
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
  const monthName = new Date(Number(y), Number(m) - 1).toLocaleString(i18n.localeTag(), { month: 'long', year: 'numeric' });
  $('#costsSummary').innerHTML = `
    <div class="cost-tile">
      <div class="ct-label">${esc(tr('costs.thisMonth'))}</div>
      <div class="ct-value">${fmtUsd(data.currentMonthTotal)}</div>
      <div class="ct-sub">${esc(monthName)}</div>
    </div>
    <div class="cost-tile">
      <div class="ct-label">${esc(tr('costs.historicalTotal'))}</div>
      <div class="ct-value">${fmtUsd(data.total)}</div>
      <div class="ct-sub">${esc(tr('costs.sinceStarted'))}</div>
    </div>
    <div class="cost-tile">
      <div class="ct-label">${esc(tr('costs.registeredOperations'))}</div>
      <div class="ct-value">${data.recent.length >= 100 ? '100+' : data.recent.length}</div>
      <div class="ct-sub">${esc(tr('costs.estimatesDisclaimer'))}</div>
    </div>`;

  renderProjectCostEstimate(data.projects || []);

  const byModel = Object.entries(data.byModelThisMonth).sort((a, b) => b[1].cost - a[1].cost);
  $('#costsByModel').innerHTML = byModel.length
    ? byModel.map(([k, v]) => `<div class="cost-row">
        <span class="cr-label">${esc(k)}<span class="cr-sub">×${v.count}</span></span>
        <span class="cr-value">${fmtUsd(v.cost)}</span></div>`).join('')
    : `<div class="empty-note" style="padding:8px 0">${esc(tr('costs.noUsageThisMonth'))}</div>`;

  const byMonth = Object.entries(data.byMonth).sort((a, b) => b[0].localeCompare(a[0], i18n.localeTag()));
  $('#costsByMonth').innerHTML = byMonth.length
    ? byMonth.map(([k, v]) => `<div class="cost-row"><span class="cr-label">${esc(k)}</span><span class="cr-value">${fmtUsd(v)}</span></div>`).join('')
    : `<div class="empty-note" style="padding:8px 0">${esc(tr('costs.noRecords'))}</div>`;

  const pricingNote = data.pricing.note === 'Editado a mano'
    ? tr('costs.manuallyEdited')
    : data.pricing.note === 'Actualizado por OpenAI (búsqueda web)'
      ? tr('costs.updatedByOpenAI')
      : data.pricing.note === 'Valores iniciales estimados — actualizalos con el botón de OpenAI o a mano.'
        ? tr('costs.initialValuesNote')
        : data.pricing.note || '';
  $('#pricingUpdated').textContent = data.pricing.updatedAt
    ? `· ${esc(pricingNote)} · ${fmtDate(data.pricing.updatedAt)}`
    : `· ${esc(tr('costs.initialEstimatedValues'))}`;

  let rows = '';
  for (const [modelId, table] of Object.entries(data.pricing.image)) {
    const name = state.models.find((x) => x.id === modelId)?.name || modelId;
    rows += `<div class="pricing-row"><span class="pr-name">${esc(name)}</span>` +
      Object.entries(table).map(([res, val]) =>
        `<label class="pr-unit">${res} <input type="number" step="0.001" min="0" data-model="${esc(modelId)}" data-res="${esc(res)}" value="${val}"></label>`
      ).join('') + `<span class="pr-unit">${esc(tr('costs.usdPerImage'))}</span></div>`;
  }
  for (const [modelId, table] of Object.entries(data.pricing.video || {})) {
    const name = state.videoModels.find((x) => x.id === modelId)?.name || modelId;
    rows += `<div class="pricing-row"><span class="pr-name">${esc(name)}</span>` +
      Object.entries(table).map(([res, val]) =>
        `<label class="pr-unit">${res} <input type="number" step="0.001" min="0" data-vmodel="${esc(modelId)}" data-res="${esc(res)}" value="${val}"></label>`
      ).join('') + `<span class="pr-unit">${esc(tr('costs.usdPerSecond'))}</span></div>`;
  }
  for (const [modelId, table] of Object.entries(data.pricing.audio || {})) {
    const name = (state.audioModels || []).find((model) => model.id === modelId)?.name || modelId;
    rows += `<div class="pricing-row"><span class="pr-name">${esc(name)}</span>
      <label class="pr-unit">${esc(tr('costs.thousandCharactersShort'))} <input type="number" step="0.001" min="0" data-audio-model="${esc(modelId)}" value="${table.per1kChars}"></label>
      <span class="pr-unit">${esc(tr('costs.usdPerThousandCharacters'))}</span></div>`;
  }
  $('#pricingTable').innerHTML = `<div class="pricing-table">${rows}</div>`;

  const costUnit = (entry) => {
    const raw = String(entry.unitLabel || '').toLowerCase();
    const key = entry.type === 'image' || raw.includes('imagen') ? 'image'
      : entry.type === 'music' || raw.includes('pista') ? 'track'
        : entry.type === 'script' || raw.includes('token') ? 'token'
          : raw.includes('caracter') ? 'character'
            : raw === 'video' ? 'video'
              : entry.type === 'video' || raw.includes('segundo') ? 'second'
                : '';
    return key ? trn(`costs.unit.${key}`, Number(entry.units) || 0) : entry.unitLabel || '';
  };
  const costLabel = (entry) => {
    if (entry.type === 'script') return tr('costs.aiScreenwriter');
    return String(entry.label || entry.modelId || '')
      .replace(/\s·\sAutomatizador$/u, ` · ${tr('nav.automation')}`)
      .replace(/\s\(plan web\)$/u, ` (${tr('costs.webPlan')})`)
      .replace(/\s\(plan HeyGen\)$/u, ` (${tr('costs.heygenPlan')})`)
      .replace(/\s\(voz\)$/u, ` (${tr('costs.voice')})`);
  };
  $('#costsLedger').innerHTML = data.recent.length
    ? data.recent.slice(0, 40).map((e) => `<div class="cost-row">
        <span class="cr-label">${e.type === 'image' ? IC('image') : e.type === 'video' ? IC('film') : e.type === 'audio' ? IC('mic') : IC('globe')} ${esc(costLabel(e))}
          <span class="cr-sub">${e.units} ${esc(costUnit(e))} · ${fmtDate(e.ts)}</span></span>
        <span class="cr-value">${fmtUsd(e.cost)}</span></div>`).join('')
    : `<div class="empty-note" style="padding:8px 0">${esc(tr('costs.noGenerations'))}</div>`;
}

$('#btnRefreshPricing').addEventListener('click', async () => {
  const btn = $('#btnRefreshPricing');
  btn.disabled = true;
  const prev = btn.innerHTML;
  btn.innerHTML = esc(tr('costs.checkingWeb'));
  try {
    const { changes } = await api('/api/pricing/refresh', { method: 'POST' });
    await loadCosts();
    if (changes?.length) toast(tr('costs.pricesUpdated', { changes: changes.join(' · ') }));
    else toast(tr('costs.pricesUnchanged'));
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
    toast(tr('costs.ratesSaved'));
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
  f.language.value = c.language === 'en' ? 'en' : 'es';
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
    ? tr('config.access.protected')
    : tr('config.access.unprotected');
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
  if (title) title.textContent = tr(state.heygenOAuth.connected ? 'config.heygenOAuth.connected' : 'config.heygenOAuth.disconnected');
  if (status) status.textContent = state.heygenOAuth.connected
    ? [state.heygenOAuth.account?.email || state.heygenOAuth.account?.name, state.heygenOAuth.account?.billingType].filter(Boolean).join(' · ') || tr('config.heygenOAuth.activeSession')
    : state.heygenOAuth.error || tr('config.heygenOAuth.hint');
  if ($('#heygenOauthConnect')) $('#heygenOauthConnect').textContent = tr(state.heygenOAuth.connected ? 'config.heygenOAuth.reconnect' : 'config.heygenOAuth.connect');
  if ($('#heygenOauthDisconnect')) $('#heygenOauthDisconnect').hidden = !state.heygenOAuth.connected;
  if (state.mode === 'video' && currentVideoModel()?.provider === 'heygen') renderVideoControls();
}

$('#heygenOauthConnect').addEventListener('click', async () => {
  const popup = window.open('about:blank', 'manifestador-heygen-oauth', 'width=720,height=780');
  try {
    const result = await api('/api/heygen/oauth/start', { method: 'POST' });
    if (!popup) throw new Error(tr('config.heygenOAuth.popupBlocked'));
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
  if (event.data.ok) { await loadHeyGenOAuthStatus(); toast(tr('config.heygenOAuth.connectedToast')); }
  else toast(event.data.detail || tr('config.heygenOAuth.failed'), 'err');
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
    out.textContent = tr('config.testing');
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
      const detail = r.detailCode && i18n?.has(r.detailCode)
        ? tr(r.detailCode, r.detailParams || {})
        : r.detail;
      out.textContent = `${r.ok ? '✓' : '✗'} ${detail}`;
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
  btn.textContent = tr('config.photoshop.detecting');
  try {
    const r = await api('/api/photoshop/detect', { method: 'POST' });
    $('#configForm').photoshopPath.value = r.path;
    if (state.config) state.config.photoshopPath = r.path;
    toast(tr('config.photoshop.detected'));
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = tr('config.photoshop.detect');
  }
});

$('#poserPromptDefaultBtn').addEventListener('click', () => {
  $('#configForm').poserPrompt.value = state.config?.poserPromptDefault || '';
});

$('#configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.accessPassword.value && f.accessPassword.value !== f.accessPasswordConfirm.value) {
    return toast(tr('config.access.passwordMismatch'), 'err');
  }
  try {
    const previousNsfwEnabled = Boolean(state.config?.nsfwEnabled);
    const previousLanguage = state.config?.language === 'en' ? 'en' : 'es';
    if (previousNsfwEnabled !== f.nsfwEnabled.checked && !f.nsfwAdminPassword.value) {
      return toast(tr('config.content.adminPasswordRequired'), 'err');
    }
    state.config = await api('/api/config', {
      method: 'PUT',
      body: {
        language: f.language.value,
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
    const languageChanged = previousLanguage !== state.config.language;
    setAppLanguage(state.config.language);
    renderTagPalette();
    f.accessPassword.value = '';
    f.accessPasswordConfirm.value = '';
    fillConfigForm();
    if (previousNsfwEnabled !== Boolean(state.config.nsfwEnabled) || languageChanged) {
      location.reload();
      return;
    }
    toast(tr('config.saved', {}, 'Configuración guardada (queda solo en tu máquina)'));
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
    setAppLanguage(state.config?.language || 'es');
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
    toast(tr('app.loadFailed', { error: e.message }, `No pude cargar el estado: ${e.message}`), 'err');
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
  api, toast, esc, fileUrl, addRef, IC, readFileAsDataUrl, goToCreate, tr, trn,
  localeTag: () => i18n.localeTag(),
  getState: () => state,
  setComfyPoseRef: (slot, key) => {
    state.comfyui.refs[slot] = key;
    setMode('comfyui');
  }
};
