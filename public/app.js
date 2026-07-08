/* Manifestador — frontend */

const $ = (s) => document.querySelector(s);
const IC = (n, cls = 'ic') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  config: null,
  models: [],
  characters: [],
  prompts: [],
  history: [],
  voices: null,          // null = aún no cargadas
  assets: { generated: [], uploads: [], audio: [] },
  mode: 'image',
  modelId: null,
  aspectRatio: '1:1',
  resolution: '1K',
  batch: 1,
  refs: [],              // [{ key, fromChar }]
  voiceId: '',
  currentEntry: null,
  currentOutput: 0,
  assetsZone: 'generated',
  selectedAssets: new Set(),
  assetRange: { from: null, to: null },
  pickerTab: 'upload',
  editingCharId: null,
  pendingCharacterAsset: null,
  pinnedId: localStorage.getItem('pinnedCharacterId') || ''
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
  $('#modeImage').classList.toggle('active', mode === 'image');
  $('#modeAudio').classList.toggle('active', mode === 'audio');
  $('#imageControls').hidden = mode !== 'image';
  $('#audioControls').hidden = mode !== 'audio';
  $('#tagPalette').hidden = mode !== 'audio';
  $('.editor-wrap').classList.toggle('tags-on', mode === 'audio');
  $('#promptBox').placeholder = mode === 'audio'
    ? 'Escribí el texto a locutar… usá [risas] o [whispers] para expresiones'
    : 'Escribí lo que querés manifestar…';
  $('#btnGenerate').innerHTML = mode === 'audio' ? `${IC('mic')} Dar voz` : `${IC('spark')} Manifestar`;
  if (mode === 'audio' && state.voices === null) loadVoices(false);
  renderHighlight();
  renderPinnedHint();
  updateEstimate();
}

$('#modeImage').addEventListener('click', () => setMode('image'));
$('#modeAudio').addEventListener('click', () => setMode('audio'));

// ---------------------------------------------------------------------------
// resaltado de corchetes (modo audio)
// ---------------------------------------------------------------------------

const promptBox = $('#promptBox');
const highlighter = $('#highlighter');

function renderHighlight() {
  if (state.mode !== 'audio') return;
  const text = promptBox.value;
  const html = esc(text).replace(/\[([^\]\n]{1,60})\]/g, '<span class="tag">[$1]</span>');
  highlighter.innerHTML = html + '\n';
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
  updateEstimate();
}

function renderRefs() {
  const m = currentModel();
  const strip = $('#refsStrip');
  strip.innerHTML = '';
  $('#refsCount').textContent = `${state.refs.length}/${m.maxRefs}`;
  state.refs.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'ref-thumb' + (r.fromChar ? ' from-char' : '');
    d.innerHTML = `<img src="${fileUrl(r.key)}" alt=""><button class="rm" title="Quitar">×</button>`;
    d.querySelector('.rm').addEventListener('click', () => {
      state.refs.splice(i, 1);
      renderRefs();
    });
    d.querySelector('img').addEventListener('click', () => openLightbox(r.key));
    strip.appendChild(d);
  });
  if (state.refs.length < m.maxRefs) {
    const add = document.createElement('button');
    add.className = 'ref-add';
    add.textContent = '+';
    add.title = 'Agregar imagen de referencia';
    add.addEventListener('click', () => openPicker());
    strip.appendChild(add);
  }
}

function addRef(key, fromChar = false) {
  const m = currentModel();
  if (state.refs.some((r) => r.key === key)) return;
  if (state.refs.length >= m.maxRefs) {
    return toast(`${m.name} admite hasta ${m.maxRefs} referencia(s)`, 'err');
  }
  state.refs.push({ key, fromChar });
  renderRefs();
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
  localStorage.setItem('pinnedCharacterId', state.pinnedId);
  const pc = pinnedChar();
  if (pc) {
    const m = currentModel();
    for (const photo of pc.photos.slice(0, Math.max(0, m.maxRefs - state.refs.length))) {
      state.refs.push({ key: photo, fromChar: true });
    }
    if (pc.voiceId) state.voiceId = pc.voiceId;
    toast(`${pc.name} anclado`);
  }
  renderPinned();
  renderPinnedHint();
  renderRefs();
  renderVoiceSelect();
  renderCharacters();
}

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
  hint.textContent = state.mode === 'image'
    ? `${pc.name}: sus fotos van como referencia`
    : `${pc.name}: ${pc.voiceName ? 'habla con su voz (' + pc.voiceName + ')' : 'no tiene voz asignada'}`;
}

$('#unpinBtn').addEventListener('click', () => setPinned(''));

// ---------------------------------------------------------------------------
// generación
// ---------------------------------------------------------------------------

async function generate() {
  const prompt = promptBox.value.trim();
  if (!prompt) return toast('Escribí un prompt primero', 'err');
  const btn = $('#btnGenerate');
  btn.disabled = true;

  const bv = $('#bigView');
  bv.hidden = false;
  bv.innerHTML = `<div class="spinner"></div><div class="gen-status">Manifestando${state.mode === 'image' && state.batch > 1 ? ` ×${state.batch}` : ''}… puede tardar un rato largo en 2K/4K</div>`;
  bv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    let entry;
    if (state.mode === 'image') {
      entry = await api('/api/generate/image', {
        method: 'POST',
        body: {
          modelId: state.modelId,
          prompt,
          aspectRatio: state.aspectRatio,
          resolution: state.resolution,
          batch: state.batch,
          refs: state.refs.map((r) => r.key),
          characterId: state.pinnedId || null
        }
      });
    } else {
      const pc = pinnedChar();
      const voiceId = state.voiceId || pc?.voiceId;
      const voice = (state.voices || []).find((v) => v.id === voiceId);
      entry = await api('/api/generate/audio', {
        method: 'POST',
        body: {
          text: prompt,
          voiceId,
          voiceName: voice?.name || pc?.voiceName || '',
          characterId: state.pinnedId || null
        }
      });
    }
    state.history.unshift(entry);
    showEntry(entry);
    renderHistory();
    const costTxt = entry.cost ? ` — $${entry.cost.toFixed(3)}` : '';
    if (entry.errors?.length) toast(`Listo, pero ${entry.errors.length} del lote fallaron: ${entry.errors[0]}`, 'err');
    else toast(`Manifestado${costTxt}`);
  } catch (e) {
    bv.innerHTML = `<div class="gen-status" style="color:#fda4af;padding:18px 6px">${esc(e.message)}</div>`;
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
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
        <button class="mini-btn" data-act="regen">${IC('refresh')} Regenerar</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} Editar envío</button>
        <a class="mini-btn" href="${fileUrl(entry.outputs[0])}" download>${IC('download')} Descargar</a>
      </div>`;
  } else {
    const key = entry.outputs[outputIdx] || entry.outputs[0];
    const thumbs = entry.outputs.length > 1
      ? `<div class="bv-thumbs">${entry.outputs.map((o, i) =>
          `<img src="${fileUrl(o)}" class="${i === outputIdx ? 'sel' : ''}" data-i="${i}" alt="">`).join('')}</div>`
      : '';
    bv.innerHTML = `
      <div class="bv-media"><img id="bvMain" src="${fileUrl(key)}" alt=""></div>
      ${thumbs}
      <div class="bv-meta">${esc(entry.modelName)} · ${entry.aspectRatio} · ${entry.resolution}${entry.batch > 1 ? ` · lote ×${entry.batch}` : ''} · ${fmtDate(entry.ts)}</div>
      <div class="bv-actions">
        <button class="mini-btn" data-act="ref">${IC('link')} Usar como referencia</button>
        <button class="mini-btn" data-act="character">${IC('user')} Convertir en personaje</button>
        <button class="mini-btn" data-act="regen">${IC('refresh')} Regenerar</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} Editar envío</button>
        <a class="mini-btn" href="${fileUrl(key)}" download>${IC('download')} Descargar</a>
      </div>`;
    $('#bvMain').addEventListener('click', () => openLightbox(key));
    $$('#bigView .bv-thumbs img').forEach((im) => {
      im.addEventListener('click', () => showEntry(entry, Number(im.dataset.i)));
    });
  }
  $$('#bigView [data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'regen') regenerate(entry);
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
      : entry.outputs.slice(0, 4).map((o, i) => `<img src="${fileUrl(o)}" data-i="${i}" alt="" loading="lazy">`).join('');
    item.innerHTML = `
      <div class="hist-thumbs">${thumbs}</div>
      <div class="hist-body">
        <div class="hist-prompt">${esc(entry.prompt)}</div>
        <div class="hist-meta">${esc(entry.modelName)}${entry.type === 'audio' ? ` · ${esc(entry.voiceName || '')}` : ` · ${entry.aspectRatio} · ${entry.resolution}${entry.batch > 1 ? ' · ×' + entry.batch : ''}`} · ${fmtDate(entry.ts)}${entry.errors?.length ? ` · <span class="err">${entry.errors.length} error(es) en el lote</span>` : ''}</div>
      </div>
      <div class="hist-actions">
        <button class="mini-btn" data-act="view">${IC('eye')} Ver</button>
        <button class="mini-btn" data-act="regen" title="Regenerar">${IC('refresh')}</button>
        <button class="mini-btn" data-act="edit" title="Editar envío">${IC('edit')}</button>
        ${entry.type === 'image' ? `<button class="mini-btn" data-act="ref" title="Usar como referencia">${IC('link')}</button>` : ''}
        <button class="mini-btn danger" data-act="del" title="Borrar">${IC('trash')}</button>
      </div>`;
    item.querySelectorAll('.hist-thumbs img').forEach((im) => {
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
  const title = window.prompt('Nombre para este prompt:', text.slice(0, 40));
  if (title === null) return;
  const item = await api('/api/prompts', { method: 'POST', body: { title, text, mode: state.mode } });
  state.prompts.unshift(item);
  renderPromptsPanel();
  $('#promptsPanel').hidden = false;
  toast('Prompt archivado');
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
  for (const pr of state.prompts) {
    const d = document.createElement('div');
    d.className = 'prompt-item';
    d.innerHTML = `<span class="p-mode">${pr.mode === 'audio' ? IC('mic') : IC('image')}</span>
      <span class="p-title">${esc(pr.title)}</span>
      <span class="p-text">${esc(pr.text)}</span>
      <button class="icon-btn" title="Eliminar">${IC('x')}</button>`;
    d.addEventListener('click', (e) => {
      if (e.target.closest('.icon-btn')) return;
      promptBox.value = pr.text;
      setMode(pr.mode === 'audio' ? 'audio' : 'image');
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

  if (src === 'characters') {
    let html = '';
    for (const c of state.characters) {
      if (!c.photos.length) continue;
      html += c.photos.map((ph) =>
        `<div class="pick" data-key="${esc(ph)}"><img src="${fileUrl(ph)}" loading="lazy" alt=""><div class="p-label">${esc(c.name)}</div></div>`
      ).join('');
    }
    body.innerHTML = html
      ? `<div class="picker-grid">${html}</div>`
      : '<div class="empty-note">Ningún personaje tiene fotos todavía.</div>';
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

async function uploadFiles(files, asRefs) {
  if (!files.length) return;
  for (const f of files) {
    try {
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

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------

async function refreshAssets() {
  state.assets = await api('/api/assets');
  renderAssetsGrid();
}

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
      card.innerHTML = `<button class="asset-check" title="Seleccionar">${state.selectedAssets.has(a.key) ? '✓' : ''}</button><button class="asset-delete" title="Borrar">${IC('trash')}</button>`;
      if (state.assetsZone === 'audio') {
        card.insertAdjacentHTML('beforeend', `<div class="audio-tile">${IC('play', 'ic ic-lg')}</div><div class="a-name">${esc(a.name)}</div>`);
        card.querySelector('.audio-tile').addEventListener('click', () => toggleAudioPlay(card, a.key));
      } else {
        card.insertAdjacentHTML('beforeend', `<img src="${fileUrl(a.key)}" loading="lazy" alt=""><div class="a-name">${esc(a.name)}</div>`);
        card.querySelector('img').addEventListener('click', () => openLightbox(a.key));
      }
      card.querySelector('.asset-check').addEventListener('click', () => toggleAssetSelection(a.key));
      card.querySelector('.asset-delete').addEventListener('click', () => deleteAssets([a.key]));
      sessionGrid.appendChild(card);
    }
    grid.appendChild(section);
  }
}

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

function visibleAssets() {
  return (state.assets[state.assetsZone] || []).filter((a) =>
    (!state.assetRange.from || a.mtime >= state.assetRange.from)
    && (!state.assetRange.to || a.mtime <= state.assetRange.to));
}

function toggleAssetSelection(key) {
  state.selectedAssets.has(key) ? state.selectedAssets.delete(key) : state.selectedAssets.add(key);
  renderAssetsGrid();
}

function updateAssetSelection() {
  $('#selectedCount').textContent = state.selectedAssets.size;
  $('#btnDeleteSelected').disabled = !state.selectedAssets.size;
}

async function deleteAssets(keys) {
  if (!keys.length) return;
  if (!confirm(`¿Borrar definitivamente ${keys.length} archivo${keys.length === 1 ? '' : 's'} del disco?\n\nEsta acción no se puede deshacer.`)) return;
  const result = await api('/api/assets/delete', { method: 'POST', body: { keys } });
  keys.forEach((key) => state.selectedAssets.delete(key));
  state.history = result.history;
  renderHistory();
  await refreshAssets();
  toast(`${result.deleted} asset${result.deleted === 1 ? '' : 's'} eliminado${result.deleted === 1 ? '' : 's'}`);
}

$('#btnDeleteSelected').addEventListener('click', () => deleteAssets([...state.selectedAssets]));
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
// lightbox
// ---------------------------------------------------------------------------

function openLightbox(key) {
  $('#lightbox').hidden = false;
  $('#lbImg').src = fileUrl(key);
  $('#lbActions').innerHTML = `
    <button class="mini-btn" id="lbRef">${IC('link')} Usar como referencia</button>
    ${key.startsWith('generated/') ? `<button class="mini-btn" id="lbCharacter">${IC('user')} Convertir en personaje</button>` : ''}
    <a class="mini-btn" href="${fileUrl(key)}" download>${IC('download')} Descargar</a>`;
  $('#lbRef').addEventListener('click', () => {
    addRef(key);
    $('#lightbox').hidden = true;
    goToCreate();
    setMode('image');
    toast('Agregada como referencia');
  });
  $('#lbCharacter')?.addEventListener('click', () => {
    $('#lightbox').hidden = true;
    openCharModal(null, key);
  });
}
$('#lbClose').addEventListener('click', () => { $('#lightbox').hidden = true; });
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('#lightbox').hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#lightbox').hidden = true; $('#pickerModal').hidden = true; $('#charModal').hidden = true; }
});

// ---------------------------------------------------------------------------
// personajes
// ---------------------------------------------------------------------------

function renderCharacters() {
  const grid = $('#charsGrid');
  if (!state.characters.length) {
    grid.innerHTML = '<div class="empty-note">Creá tu primer personaje: nombre, descripción, fotos y una voz de ElevenLabs.</div>';
    return;
  }
  grid.innerHTML = '';
  for (const c of state.characters) {
    const card = document.createElement('div');
    card.className = 'char-card' + (c.id === state.pinnedId ? ' pinned' : '');
    const avatar = c.photos[0]
      ? `<img class="char-avatar" src="${fileUrl(c.photos[0])}" alt="">`
      : `<div class="char-avatar ph">${IC('user', 'ic ic-lg')}</div>`;
    const minis = c.photos.slice(1, 5).map((p) => `<img src="${fileUrl(p)}" alt="">`).join('')
      + (c.photos.length > 5 ? `<div class="more">+${c.photos.length - 5}</div>` : '');
    card.innerHTML = `
      <div class="char-top">${avatar}<div>
        <div class="char-name">${esc(c.name)}</div>
        <div class="char-voice">${c.voiceName ? IC('mic') + ' ' + esc(c.voiceName) : '<span style="color:#6f5f8d">sin voz</span>'}</div>
      </div></div>
      <div class="char-desc">${esc(c.description || '')}</div>
      <div class="char-photos-mini">${minis}</div>
      <div class="char-actions">
        <button class="mini-btn" data-act="pin">${IC('pin')} ${c.id === state.pinnedId ? 'Anclado' : 'Anclar'}</button>
        <button class="mini-btn" data-act="use">${IC('link')} Usar fotos</button>
        <button class="mini-btn" data-act="edit">${IC('edit')} Editar</button>
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
        if (act === 'del') {
          if (!confirm(`¿Eliminar a ${c.name} y sus fotos?`)) return;
          await api(`/api/characters/${c.id}`, { method: 'DELETE' });
          state.characters = state.characters.filter((x) => x.id !== c.id);
          if (state.pinnedId === c.id) setPinned('');
          renderCharacters();
        }
      });
    });
    grid.appendChild(card);
  }
}

$('#btnNewChar').addEventListener('click', () => openCharModal(null));
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
    ${id ? `
    <div><label>Fotos (${c.photos.length})</label>
      <div class="char-photos-grid" id="chPhotos">
        ${c.photos.map((p) => `<div class="ref-thumb"><img src="${fileUrl(p)}" alt=""><button class="rm" data-key="${esc(p)}">×</button></div>`).join('')}
        <button class="ref-add" id="chAddPhoto">+</button>
      </div>
    </div>` : '<p class="hint">Guardá el personaje primero y después subile fotos.</p>'}
    <button class="generate-btn small" id="chSave">${id ? 'Guardar cambios' : 'Crear personaje'}</button>`;

  $('#chSave').addEventListener('click', async () => {
    const voices2 = state.voices || [];
    const voiceId = $('#chVoice').value;
    const payload = {
      name: $('#chName').value,
      description: $('#chDesc').value,
      voiceId,
      voiceName: voices2.find((v) => v.id === voiceId)?.name || ''
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
  rows += `<div class="pricing-row"><span class="pr-name">Eleven v3</span>
    <label class="pr-unit">1k car. <input type="number" step="0.001" min="0" data-audio="per1kChars" value="${data.pricing.audio['eleven-v3'].per1kChars}"></label>
    <span class="pr-unit">USD/1000 caracteres</span></div>`;
  $('#pricingTable').innerHTML = `<div class="pricing-table">${rows}</div>`;

  $('#costsLedger').innerHTML = data.recent.length
    ? data.recent.slice(0, 40).map((e) => `<div class="cost-row">
        <span class="cr-label">${e.type === 'image' ? IC('image') : e.type === 'audio' ? IC('mic') : IC('globe')} ${esc(e.label || e.modelId)}
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
  const per1k = Number($('#pricingTable input[data-audio]')?.value) || 0;
  try {
    state.pricing = await api('/api/pricing', {
      method: 'PUT',
      body: { image, audio: { 'eleven-v3': { per1kChars: per1k } } }
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
  f.key_ark.value = c.keys.ark || '';
  f.key_fal.value = c.keys.fal || '';
  f.key_elevenlabs.value = c.keys.elevenlabs || '';
  f.key_openai.value = c.keys.openai || '';
  f.openaiModel.value = c.openaiModel || 'gpt-5-mini';
  f.path_generated.value = c.paths.generated || '';
  f.path_uploads.value = c.paths.uploads || '';
  f.path_audio.value = c.paths.audio || '';
  f.seedreamModelId.value = c.seedreamModelId || '';
  f.endpoint_ark.value = c.endpoints.ark || '';
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
          ark: f.key_ark.value.trim(),
          fal: f.key_fal.value.trim(),
          elevenlabs: f.key_elevenlabs.value.trim(),
          openai: f.key_openai.value.trim()
        },
        openaiModel: f.openaiModel.value.trim() || 'gpt-5-mini',
        paths: {
          generated: f.path_generated.value.trim(),
          uploads: f.path_uploads.value.trim(),
          audio: f.path_audio.value.trim()
        },
        endpoints: {
          ark: f.endpoint_ark.value.trim()
        },
        seedreamModelId: f.seedreamModelId.value.trim(),
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
    state.characters = s.characters;
    state.prompts = s.prompts;
    state.history = s.history;
    state.pricing = s.pricing;
    state.modelId = s.models[0]?.id;
  } catch (e) {
    toast('No pude cargar el estado: ' + e.message, 'err');
    return;
  }
  renderImageControls();
  renderTagPalette();
  renderHistory();
  renderCharacters();
  renderPinned();
  renderPinnedHint();
  fillConfigForm();
  setMode('image');
  if (state.pinnedId && !pinnedChar()) setPinned('');

  // deep-links: #audio, #assets, #characters, #costs, #config
  const h = location.hash.slice(1);
  if (h === 'audio') setMode('audio');
  else if (['assets', 'characters', 'costs', 'config'].includes(h)) {
    $(`.nav-btn[data-view="${h}"]`)?.click();
  }
}

init();
