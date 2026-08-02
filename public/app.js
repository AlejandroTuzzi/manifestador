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
    if (view === 'elements') renderElements();
    if (view === 'poser') window.poserEnter?.();
    if (view === 'prompts') renderPromptLibrary();
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
  $('#imageControls').hidden = mode !== 'image';
  $('#videoControls').hidden = mode !== 'video';
  $('#audioControls').hidden = mode !== 'audio';
  $('#musicControls').hidden = mode !== 'music';
  const audioModel = (state.audioModels || []).find((model) => model.id === state.audioModelId);
  $('#tagPalette').hidden = mode !== 'audio' || audioModel?.supportsAudioTags === false;
  // el armador de tomas es propio del video
  $('#btnShotList').hidden = mode !== 'video';
  if (mode !== 'video') $('#shotListPanel').hidden = true;
  $('.editor-wrap').classList.toggle('tags-on', (mode === 'audio' && audioModel?.supportsAudioTags !== false) || mode === 'video');
  $('#promptBox').placeholder = mode === 'audio'
    ? (audioModel?.supportsAudioTags === false
      ? 'Escribí el texto a locutar… Multilingual v2 prioriza una narración estable'
      : 'Escribí el texto a locutar… usá [risas] o [whispers] para expresiones')
    : mode === 'video'
    ? 'Describí la escena en movimiento: acción, cámara, ambiente…'
    : mode === 'music'
    ? (state.music.customMode ? 'Escribí la LETRA de la canción (versos, estribillo)…' : 'Describí la canción: género, ánimo, instrumentos, tema…')
    : 'Escribí lo que querés manifestar…';
  $('#btnGenerate').innerHTML = mode === 'audio' ? `${IC('mic')} Dar voz` : mode === 'video' ? `${IC('film')} Manifestar video` : mode === 'music' ? `${IC('music')} Componer` : `${IC('spark')} Manifestar`;
  if (mode === 'audio' && state.voices === null) loadVoices(false);
  if (mode === 'audio') renderAudioModelSelect();
  if (mode === 'video') renderVideoControls();
  if (mode === 'music') renderMusicControls();
  if (mode === 'image') renderRefs();
  renderHighlight();
  renderPinnedHint();
  updateEstimate();
}

$('#modeImage').addEventListener('click', () => setMode('image'));
$('#modeVideo').addEventListener('click', () => setMode('video'));
$('#modeAudio').addEventListener('click', () => setMode('audio'));
$('#modeMusic').addEventListener('click', () => setMode('music'));

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
  const isHeyGen = m.provider === 'heygen';
  state.video.modelId = m.id;
  if (!m.aspectRatios.includes(state.video.aspectRatio)) state.video.aspectRatio = m.aspectRatios[0];
  if (!m.resolutions.includes(state.video.resolution)) state.video.resolution = m.resolutions[0];
  if (!m.durations.includes(state.video.duration)) state.video.duration = m.durations[0];
  if (state.refs.length > activeRefLimit()) state.refs = state.refs.slice(0, activeRefLimit());

  chipRow($('#videoModelChips'), state.videoModels.map((x) => x.id), m.id,
    (id) => { state.video.modelId = id; applyPinnedCharacterPhotos(); renderVideoControls(); },
    (id) => state.videoModels.find((x) => x.id === id).name);
  chipRow($('#videoModeChips'), ['reference', 'frames'], state.video.mode,
    (v) => { state.video.mode = v; renderVideoControls(); },
    (v) => (v === 'reference' ? 'Referencias (@)' : 'Inicio → Fin'));
  $('#videoRefsHint').textContent = isHeyGen
    ? 'Usá una imagen JPG o PNG: puede venir de cualquier asset o personaje.'
    : state.video.mode === 'reference'
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
  $('#videoDurationRow').hidden = isHeyGen;
  $('#videoModeRow').hidden = isHeyGen;
  $('#videoAudioRow').hidden = isHeyGen || !m.audio;
  $('#heygenVideoControls').hidden = !isHeyGen;
  $('#videoRefsStrip').closest('.control-row').hidden = isHeyGen && m.requiresRegisteredCharacter;
  $('#btnShotList').hidden = isHeyGen;
  if (isHeyGen) {
    state.video.mode = 'reference';
    const eligible = state.characters.filter((character) => character.heygen?.avatarId && character.heygen?.imageKey);
    if (!eligible.some((character) => character.id === state.video.heygenCharacterId)) {
      state.video.heygenCharacterId = eligible[0]?.id || '';
    }
    $('#heygenCharacterRow').hidden = !m.requiresRegisteredCharacter;
    $('#heygenCharacterSelect').innerHTML = eligible.length
      ? eligible.map((character) => `<option value="${character.id}">${esc(character.name)} · ${esc(character.heygen.avatarId)}</option>`).join('')
      : '<option value="">— no hay personajes HeyGen completos —</option>';
    $('#heygenCharacterSelect').value = state.video.heygenCharacterId;
    $('#heygenCharacterHint').textContent = eligible.length
      ? 'Sólo aparecen personajes con imagen espejo y código de avatar.'
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
$('#heygenAuthMode').addEventListener('change', (e) => { state.video.heygenAuthMode = e.target.value; renderVideoControls(); });
$('#heygenCharacterSelect').addEventListener('change', (e) => { state.video.heygenCharacterId = e.target.value; });
$('#heygenVoiceId').addEventListener('input', (e) => { state.video.heygenVoiceId = e.target.value.trim(); });
$('#heygenMotionPrompt').addEventListener('input', (e) => { state.video.heygenMotionPrompt = e.target.value; });
$('#heygenExpressiveness').addEventListener('change', (e) => { state.video.heygenExpressiveness = e.target.value; });

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
      : `<img src="${fileUrl(r.key)}" alt="">${r.label ? `<span class="ref-label-tag" title="La IA verá este texto sobre la imagen">${esc(r.label)}</span>` : ''}${badge}<button class="rm" title="Quitar">×</button><button class="ref-replace" title="Reemplazar imagen (conserva su posición y cita)">${IC('refresh')}</button><button class="ref-label-btn${r.label ? ' on' : ''}" title="${r.label ? `Etiqueta: ${esc(r.label)}` : 'Etiquetar para la IA (quién es quién)'}">T</button>`;
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
      if (pc.heygen?.avatarId && pc.heygen?.imageKey) state.video.heygenCharacterId = pc.id;
      return;
    }
    const key = pc.heygen?.imageKey || pc.photos?.[0];
    if (key && state.refs.length < activeRefLimit()) state.refs.push({ key, fromChar: true, label: pc.name });
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
  const pc = pinnedChar();
  const voiceId = state.voiceId || pc?.voiceId;
  const voice = (state.voices || []).find((v) => v.id === voiceId);
  const audioModel = (state.audioModels || []).find((candidate) => candidate.id === state.audioModelId) || state.audioModels?.[0];
  const model = isVideo ? currentVideoModel() : currentModel();
  const isHeyGen = isVideo && model?.provider === 'heygen';
  if (isHeyGen && model.requiresRegisteredCharacter) {
    const character = state.characters.find((item) => item.id === state.video.heygenCharacterId);
    if (!character?.heygen?.avatarId || !character?.heygen?.imageKey) {
      return toast('Este modelo necesita un personaje con variante HeyGen completa', 'err');
    }
  }
  if (isHeyGen && !model.requiresRegisteredCharacter) {
    if (state.refs.length !== 1 || state.refs[0].key.startsWith('asset://')) return toast('Elegí exactamente una imagen', 'err');
    if (!state.video.heygenVoiceId.trim()) return toast('Pegá el código de una voz de HeyGen', 'err');
  }
  if (isHeyGen && state.video.heygenAuthMode === 'oauth' && !state.heygenOAuth.connected) return toast('Conectá HeyGen OAuth desde Configuración', 'err');
  if (isHeyGen && state.video.heygenAuthMode === 'key' && !state.config?.keys?.heygen) return toast('Guardá la API key de HeyGen en Configuración', 'err');
  // las etiquetas se estampan acá, sobre copias: el asset guardado queda limpio
  const refsUsed = isImage ? state.refs : isVideo ? state.refs.slice(0, activeRefLimit()) : [];
  const labeledRefs = refsUsed.some((r) => r.label) ? await buildLabeledRefs(refsUsed) : {};
  const job = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: 'queued', prompt, createdAt: Date.now(),
    label: isImage ? `${model.name} · ${state.resolution} · ×${state.batch}`
      : isVideo ? `${model.name} · ${state.video.resolution}${isHeyGen ? '' : ` · ${state.video.duration}s`}`
      : isMusic ? `Suno ${state.music.version}${state.music.instrumental ? ' · instrumental' : ''}`
      : `${audioModel?.name || 'ElevenLabs'} · ${voice?.name || pc?.voiceName || 'voz'}`,
    path: isImage ? '/api/generate/image' : isVideo ? '/api/generate/video' : isMusic ? '/api/generate/music' : '/api/generate/audio',
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
    } : {
      text: prompt,
      audioModelId: audioModel?.id || state.audioModelId,
      voiceId,
      voiceName: voice?.name || pc?.voiceName || '',
      characterId: state.pinnedId || null
    }
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
      <div class="bv-meta">${esc(entry.voiceName || 'voz')} · ${esc(entry.modelName || 'ElevenLabs')} · ${fmtDate(entry.ts)}</div>
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

// replaceIndex null = agregar una referencia nueva; un índice = reemplazar esa
// referencia in-place (conserva posición, cita y etiqueta)
function openPicker(replaceIndex = null) {
  state.replaceRefIndex = replaceIndex;
  $('#pickerTitle').textContent = replaceIndex != null ? 'Reemplazar imagen de referencia' : 'Elegir imagen de referencia';
  $('#pickerModal').hidden = false;
  setPickerTab(state.pickerTab || 'upload');
}

// una selección del picker: reemplaza si estamos en ese modo, o agrega
function pickRef(key) {
  if (state.overlayBgPick) {
    state.overlayBgPick = false;
    $('#pickerModal').hidden = true;
    const pr = currentAutomation();
    if (pr) saveAutomation({ config: { overlay: { previewBg: key } } }).then(() => renderAutomationProject());
    return;
  }
  if (state.replaceRefIndex != null) return replaceRef(state.replaceRefIndex, key);
  addRef(key);
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

$('#pickerClose').addEventListener('click', () => { $('#pickerModal').hidden = true; state.replaceRefIndex = null; state.overlayBgPick = false; });
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
      pickRef(p.dataset.key);
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
          return `<div class="pick" data-id="${it.id}">${cover
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

async function uploadFiles(files, asRefs) {
  if (!files.length) return;
  // en modo reemplazo solo tiene sentido una imagen: se usa la primera
  const replacing = asRefs && state.replaceRefIndex != null;
  const list = replacing ? files.slice(0, 1) : files;
  for (const f of list) {
    try {
      // el cuerpo de la petición admite 150 MB y el base64 infla ~33%
      if (f.size > 100 * 1024 * 1024) {
        toast(`${f.name}: pesa más de 100 MB, achicalo antes de subirlo`, 'err');
        continue;
      }
      const dataUrl = await readFileAsDataUrl(f);
      const { key } = await api('/api/upload', { method: 'POST', body: { name: f.name, dataUrl } });
      if (asRefs) pickRef(key);
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 'err');
    }
  }
  if (asRefs) {
    $('#pickerModal').hidden = true;
    if (!replacing) toast(`${list.length} imagen(es) subida(s) y agregada(s) como referencia`);
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

function openAudioUpload({ automationId = null, kind = 'voice', musicTags = {} } = {}) {
  state.audioUploadAutomationId = automationId;
  $('#audioUploadForm').reset();
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
    $('#audioKindTabs').hidden = state.assetsZone !== 'audio';
    $('#btnUploadAsset').innerHTML = state.assetsZone === 'audio'
      ? `${IC('upload')} Subir audio`
      : `${IC('upload')} Subir imagen`;
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
  $('#fileInput').accept = 'image/*';
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
      card.innerHTML = `<button class="asset-check" title="Seleccionar">${state.selectedAssets.has(a.key) ? '✓' : ''}</button><button class="asset-series" title="Asociar a serie">${IC('layers')}</button><a class="asset-download" href="${fileUrl(a.key)}" download="${esc(a.name)}" title="Descargar">${IC('download')}</a><button class="asset-info" title="Información">${IC('info')}</button>${a.prompt ? `<button class="asset-copy" title="Copiar prompt">${IC('copy')}</button>` : ''}<button class="asset-delete" title="Borrar">${IC('trash')}</button>`;
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
    && (state.assetsZone !== 'audio' || state.assetAudioKind === 'all' || (a.audioKind || 'voice') === state.assetAudioKind)
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
    Object.values(project.outputs || {}).forEach((output) => {
      if (keys.includes(output.imageKey)) output.imageKey = null;
      if (keys.includes(output.textImageKey)) output.textImageKey = null;
      if (keys.includes(output.textLayerKey)) output.textLayerKey = null;
      if (keys.includes(output.videoKey)) output.videoKey = null;
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
    ${!isVideo && isReusableImageKey(key) ? `<button class="mini-btn" id="lbAssociate">${IC('user')} Asociar a personaje/elemento</button>` : ''}
    <button class="mini-btn" id="lbSeries">${IC('layers')} Asociar a serie</button>
    ${!isVideo && isReusableImageKey(key) ? `<button class="mini-btn" id="lbCharacter">${IC('user')} Convertir en personaje</button>` : ''}
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
  const isAudio = asset.key?.startsWith('audio/');
  const audioKind = asset.audioKind || 'voice';
  const musicTags = asset.musicTags || { genres: [], instruments: [], moods: [] };
  const character = state.characters.find((c) => c.id === asset.characterId);
  const variant = (character?.variants || []).find((v) => v.id === asset.characterVariantId);
  const rows = [
    ['Modelo', asset.modelName || asset.modelId || 'Sin información'],
    ['Tipo', isAudio ? AUDIO_KIND_LABELS[audioKind] || 'Audio' : asset.type || 'imagen'],
    ...(isAudio ? [['Duración', '__DUR__']] : []),
    ['Proporción', asset.aspectRatio || '—'], ['Resolución', asset.resolution || '—'],
    ['Lote', asset.batch || 1], ['Referencias', (asset.refs || []).length],
    ['Personaje', character ? `${character.name} · ${variant?.name || 'Original'}` : '—'],
    ['Fecha', asset.ts ? fmtDate(asset.ts) : '—'], ['Costo estimado', asset.cost ? `$${Number(asset.cost).toFixed(4)}` : '—']
  ];
  const baseName = decodeURIComponent(asset.key.split('/').pop() || '').replace(/\.[^.]+$/, '');
  const ext = (asset.key.match(/\.[^.]+$/) || [''])[0];
  $('#assetInfoBody').innerHTML = `
    ${asset.key && !asset.key.startsWith('audio/') ? `<img class="asset-info-preview" src="${fileUrl(asset.key)}" alt="">` : ''}
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
      <button type="button" class="mini-btn" id="assetAudioMetadataSave">Guardar clasificación</button>
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
    closeAudioUpload();
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
        <div class="char-name">${esc(c.name)}</div>
        <div class="char-voice">${c.voiceName ? IC('mic') + ' ' + esc(c.voiceName) : '<span style="color:#6f5f8d">sin voz</span>'}</div>
      </div></div>
      <div class="char-desc">${esc(c.description || '')}</div>
      ${c.heygen?.avatarId && c.heygen?.imageKey ? `<div class="heygen-card-badge">HeyGen · ${esc(c.heygen.avatarId)}</div>` : ''}
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
  const c = state.characters.find((x) => x.id === id) || { name: '', description: '', voiceId: '', photos: [], heygen: { avatarId: '', imageKey: '' } };
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
    <div class="heygen-character-card">
      <div class="variant-manager-head"><label>Variante especial · HeyGen</label>${c.heygen?.avatarId && c.heygen?.imageKey ? '<span class="heygen-ready">Lista para video</span>' : ''}</div>
      <input type="text" id="chHeyGenAvatar" value="${esc(c.heygen?.avatarId || '')}" placeholder="Código del avatar registrado en HeyGen">
      <div class="hint" style="margin-top:4px">Pegá el avatar_id remoto y guardá una imagen espejo de la misma identidad. Manifestador no registra ni sube este personaje automáticamente.</div>
      ${id ? `<div class="heygen-mirror">
        ${c.heygen?.imageKey ? `<img src="${fileUrl(c.heygen.imageKey)}" alt="Imagen espejo de HeyGen">` : '<div class="heygen-mirror-empty">Sin imagen espejo</div>'}
        <div><button type="button" class="mini-btn" id="chHeyGenUpload">${IC('upload')} Subir imagen espejo</button>
        ${c.photos?.[0] ? `<button type="button" class="mini-btn" id="chHeyGenUseCover">Usar portada</button>` : ''}
        ${c.heygen?.imageKey ? `<button type="button" class="mini-btn danger" id="chHeyGenRemove">Quitar</button>` : ''}</div>
      </div>` : '<p class="hint">Creá el personaje primero para subir su imagen espejo.</p>'}
    </div>
    ${id ? `
    ${c.photos.length ? '<div><label>Portada</label><div id="chCover"></div></div>' : ''}
    <div><label>Fotos (${c.photos.length})</label>
      ${c.photos.length > 1 ? '<div class="hint" style="margin-bottom:6px">Arrastrá para ordenar — la primera es la foto de perfil</div>' : ''}
      <div class="char-photos-grid" id="chPhotos">
        ${c.photos.map((p, pi) => `<div class="ref-thumb${pi === 0 ? ' is-profile' : ''}${p === c.sheet ? ' is-sheet' : ''}" draggable="true" data-photo="${esc(p)}"><img src="${fileUrl(p)}" draggable="false" alt=""><button class="ficha-btn" data-ficha="${esc(p)}" title="${p === c.sheet ? 'Ficha del personaje (clic para quitar)' : 'Marcar como ficha de personaje'}">${IC('star')}</button><button class="rm" data-key="${esc(p)}">×</button></div>`).join('')}
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
      voiceId,
      voiceName: voices2.find((v) => v.id === voiceId)?.name || '',
      arkAssetId: $('#chArkAsset').value.trim(),
      heygenAvatarId: $('#chHeyGenAvatar').value.trim()
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
// Automatizador: proyectos con guion de bloques (prompt+texto), asignación de
// roles a personajes/locaciones/objetos y config de imagen/voz/texto.
// ---------------------------------------------------------------------------

// roles sin asignar (personajes y locaciones obligatorios; objetos también si se declararon)
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
  const prompts = state.prompts || [];
  if (!prompts.length) return '<option value="">— no hay prompts guardados —</option>';
  return '<option value="">— elegí un prompt guardado —</option>' + prompts.map((prompt) =>
    `<option value="${esc(prompt.id)}">${prompt.mode === 'audio' ? 'Audio' : prompt.mode === 'video' ? 'Video' : 'Imagen'} · ${esc(prompt.category || 'General')} · ${esc(prompt.title)}</option>`
  ).join('');
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
    const generated = await api('/api/generate/image', {
      method: 'POST',
      body: {
        modelId: model.id,
        prompt: automationStyledPrompt(pr, prompt),
        refs: [],
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
  if (isHeyGen) job.body.idempotencyKey = job.id;
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

  $('#chHeyGenUpload')?.addEventListener('click', () => {
    $('#fileInput').accept = 'image/png,image/jpeg,image/webp';
    $('#fileInput').multiple = false;
    $('#fileInput').onchange = async (event) => {
      const file = event.target.files[0]; event.target.value = ''; event.target.multiple = true; event.target.accept = 'image/*';
      if (!file) return;
      try {
        const updated = await api(`/api/characters/${id}/heygen-image`, { method: 'POST', body: { name: file.name, dataUrl: await readFileAsDataUrl(file) } });
        state.characters[state.characters.findIndex((item) => item.id === id)] = updated;
        renderCharModal(); renderCharacters(); renderVideoControls();
      } catch (error) { toast(error.message, 'err'); }
    };
    $('#fileInput').click();
  });
  $('#chHeyGenUseCover')?.addEventListener('click', async () => {
    try {
      const updated = await api(`/api/characters/${id}/heygen-image`, { method: 'POST', body: { assetKey: c.photos[0] } });
      state.characters[state.characters.findIndex((item) => item.id === id)] = updated;
      renderCharModal(); renderCharacters(); renderVideoControls();
    } catch (error) { toast(error.message, 'err'); }
  });
  $('#chHeyGenRemove')?.addEventListener('click', async () => {
    try {
      const updated = await api(`/api/characters/${id}/heygen-image`, { method: 'DELETE' });
      state.characters[state.characters.findIndex((item) => item.id === id)] = updated;
      renderCharModal(); renderCharacters(); renderVideoControls();
    } catch (error) { toast(error.message, 'err'); }
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
  const includeLogos = pr.config?.includeLogos === true;
  const videoEffect = { enabled: false, preset: 'wiggle', intensity: 35, ...(pr.config?.videoEffect || {}) };
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
            <button type="button" class="mini-btn" id="autoApplyArtPrompt"${(state.prompts || []).length ? '' : ' disabled'}>${IC('book')} Usar prompt guardado</button>
          </div>
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
      <h3>Guion (${pr.blocks.length} bloques)</h3>
      ${pr.blocks.length ? pr.blocks.map((b, i) => {
        const out = pr.outputs?.[b.id] || null;
        const done = Boolean(out?.videoKey);
        const partial = !done && Boolean(out?.imageKey || out?.textImageKey || out?.textLayerKey || out?.audioKeys?.length);
        return `
        <div class="auto-block${done ? ' is-done' : ''}" data-block="${b.id}">
          <div class="auto-block-head">
            <strong>Bloque ${i + 1}${b.title ? ` · ${esc(b.title)}` : ''}</strong> <span class="hint">${esc([b.characters.join(', '), b.location, b.prop].filter(Boolean).join(' · '))}</span>
            <span class="auto-block-btns">
              <button class="mini-btn" data-genblock="${b.id}" data-force="${done ? '1' : '0'}"${missing.length ? ' disabled' : ''}>${IC('spark')} ${done ? 'Regenerar' : partial ? 'Continuar' : 'Generar / continuar'}</button>
              ${out?.imageKey ? `<button class="mini-btn" data-regen-downstream="${b.id}"${missing.length ? ' disabled' : ''} title="Conserva la imagen limpia y rehace texto, audio y video">${IC('mic')} Rehacer texto + audio + video</button>` : ''}
              ${partial ? `<button class="mini-btn danger" data-regenblock="${b.id}"${missing.length ? ' disabled' : ''}>Regenerar desde cero</button>` : ''}
            </span>
          </div>
          <div class="auto-block-editor">
            <label><span>Título interno del bloque</span><input type="text" data-block-title maxlength="160" value="${esc(b.title || '')}"></label>
            <label><span>Prompt visual · inglés</span><textarea data-block-prompt maxlength="4000" rows="5">${esc(b.imagePrompt)}</textarea></label>
            <label><span>Prompt negativo · inglés</span><textarea data-block-negative maxlength="2000" rows="2">${esc(b.negativePrompt || '')}</textarea></label>
            <div class="auto-block-script-items">
              ${(b.items || []).map((it, itemIndex) => `<label><span>${it.kind === 'dialogue' ? `Diálogo · ${esc(it.character || 'sin personaje')}` : 'Narración'}</span><textarea data-block-item="${itemIndex}" maxlength="2000" rows="3">${esc(it.text)}</textarea></label>`).join('')}
            </div>
            <div class="auto-block-edit-actions"><span class="hint">Guardar no genera nada. Si ya había material, se conservarán las etapas que sigan siendo válidas.</span><button type="button" class="mini-btn accent" data-save-block="${esc(b.id)}">${IC('save')} Guardar cambios del bloque</button></div>
          </div>
          <div class="auto-block-out" data-out="${b.id}">${automationBlockOutHtml(out)}</div>
        </div>`;
      }).join('') : '<p class="hint">Sin bloques. Importá un guion.</p>'}
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
          <div><h3>Efectos finales</h3><span class="hint">Posproducción opcional: imagen limpia → efecto → subtítulos. No vuelve a llamar a modelos generativos.</span></div>
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
        <span class="hint" id="autoEffectStatus">${finalOutput ? 'El video limpio se conserva. Si hay logo, el efecto termina antes del cierre.' : 'Primero ensamblá el video final limpio.'}</span>
        ${effectOutput ? `<span class="automation-stage-status">Última versión · ${esc(effectOutput.presetName || effectOutput.preset)} · intensidad ${effectOutput.intensity}%${effectOutput.subtitlesPreserved ? ' · subtítulos nítidos' : ''}${effectOutput.logoPreserved ? ' · logo preservado' : ''} · ${fmtDate(effectOutput.processedAt)}</span>` : ''}
        <button type="button" class="generate-btn" id="autoApplyEffect"${finalOutput && videoEffect.enabled ? '' : ' disabled'}>${IC('spark')} ${effectOutput ? 'Crear otra versión con efecto' : 'Aplicar efecto al video final'}</button>
      </div>
      ${effectOutput ? `<div class="final-assembly-preview post-effect-preview">
        <video src="${fileUrl(effectOutput.videoKey)}" controls preload="metadata"></video>
        <button type="button" class="mini-btn" data-open-asset="${esc(effectOutput.videoKey)}">Abrir versión y acciones</button>
      </div>` : ''}
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

  // El overlay vive en un objeto de trabajo local; los controles y el arrastre lo
  // mutan y actualizan el preview en vivo, y se persiste con saveAll().
  const ov = { ...pr.config.overlay };
  const titleOv = { ...titleOverlay };
  const saveAll = () => saveAutomation({ name: $('#autoProjectName').value, config: {
    imageModelId: $('#autoModel').value,
    fallbackImageModelId: $('#autoFallbackModel').value === $('#autoModel').value ? '' : $('#autoFallbackModel').value,
    artStyle: $('#autoArtStyle').value.trim() || DEFAULT_AUTOMATION_ART_STYLE,
    aspectRatio: $('#autoAr').value,
    resolution: $('#autoRes').value,
    narratorVoiceId: $('#autoVoice').value,
    narratorVoiceName: (state.voices || []).find((v) => v.id === $('#autoVoice').value)?.name || '',
    audioModelId: $('#autoAudioModel').value,
    includeLogos: $('#autoIncludeLogos').checked,
    videoEffect,
    transitionSound,
    music,
    overlay: ov,
    titleOverlay: titleOv
  } });
  $('#autoModel').addEventListener('change', async () => { await saveAll(); renderAutomationProject(); });
  $('#autoAr').addEventListener('change', async () => { await saveAll(); renderAutomationProject(); });
  ['autoRes', 'autoVoice', 'autoAudioModel', 'autoFallbackModel', 'autoArtStyle'].forEach((id) => $('#' + id).addEventListener('change', async () => {
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
    await saveAll();
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
    $('#autoEffectPanel').classList.toggle('enabled', videoEffect.enabled);
    $('#autoEffectIntensityValue').textContent = `${videoEffect.intensity}%`;
    $('#autoApplyEffect').disabled = !finalOutput || !videoEffect.enabled;
    return videoEffect;
  };
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
    const h = preview.clientHeight || 320;
    const scale = h / 1080;
    const normalSize = Math.max(4, (ov.fontSizePx || 64) * scale);
    const highlightSize = Math.max(4, (ov.highlightFontSizePx || ov.fontSizePx || 64) * scale);
    Object.assign(text.style, {
      lineHeight: `${Math.max(normalSize, highlightSize) * 1.2}px`,
      left: (ov.x ?? 50) + '%',
      top: (ov.y ?? 88) + '%',
      maxWidth: (ov.maxWidthPct || 88) + '%',
      textAlign: ov.align || 'center',
      transform: `translate(${ov.align === 'left' ? '0' : ov.align === 'right' ? '-100%' : '-50%'}, -50%)`
    });
    text.querySelectorAll('.ov-normal').forEach((normal) => Object.assign(normal.style, {
      fontFamily: ov.font,
      fontSize: normalSize + 'px',
      fontWeight: ov.fontWeight || 700,
      fontStyle: ov.fontItalic ? 'italic' : 'normal',
      textTransform: ov.textTransform || 'none',
      textDecorationLine: [ov.fontUnderline && 'underline', ov.fontStrikeThrough && 'line-through'].filter(Boolean).join(' ') || 'none',
      color: ov.color,
      webkitTextStroke: `${Math.max(0, (ov.strokeWidthPx || 0) * scale)}px ${ov.strokeColor}`
    }));
    Object.assign(text.querySelector('.ov-hl').style, {
      fontFamily: ov.highlightFont || ov.font,
      fontSize: highlightSize + 'px',
      fontWeight: ov.highlightFontWeight || 800,
      fontStyle: ov.highlightFontItalic ? 'italic' : 'normal',
      textTransform: ov.highlightTextTransform || 'none',
      textDecorationLine: [ov.highlightFontUnderline && 'underline', ov.highlightFontStrikeThrough && 'line-through'].filter(Boolean).join(' ') || 'none',
      color: ov.highlightColor || '#fbbf24',
      webkitTextStroke: `${Math.max(0, (ov.highlightStrokeWidthPx || 0) * scale)}px ${ov.highlightStrokeColor || '#000000'}`
    });
    text.classList.toggle('has-bg', !!ov.bg);

    const titleSize = Math.max(4, (titleOv.fontSizePx || 96) * scale);
    const previewBlock = pr.blocks.find((block) => block.id === titleOv.blockId) || pr.blocks[0];
    const visibleTitle = titleOv.mode === 'block'
      ? (previewBlock?.title || '')
      : (titleOv.text || pr.integration?.scriptTitle || pr.name);
    titleText.hidden = !titleOv.enabled || !visibleTitle;
    titleText.textContent = visibleTitle;
    Object.assign(titleText.style, {
      fontFamily: titleOv.font || 'sans-serif',
      fontSize: titleSize + 'px',
      fontWeight: titleOv.fontWeight || 900,
      fontStyle: titleOv.fontItalic ? 'italic' : 'normal',
      textTransform: titleOv.textTransform || 'none',
      textDecorationLine: [titleOv.fontUnderline && 'underline', titleOv.fontStrikeThrough && 'line-through'].filter(Boolean).join(' ') || 'none',
      color: titleOv.color || '#ffffff',
      webkitTextStroke: `${Math.max(0, (titleOv.strokeWidthPx || 0) * scale)}px ${titleOv.strokeColor || '#000000'}`,
      left: (titleOv.x ?? 50) + '%',
      top: (titleOv.y ?? 14) + '%',
      maxWidth: (titleOv.maxWidthPct || 88) + '%',
      textAlign: titleOv.align || 'center',
      lineHeight: `${titleSize * 1.15}px`,
      transform: `translate(${titleOv.align === 'left' ? '0' : titleOv.align === 'right' ? '-100%' : '-50%'}, -50%)`
    });
    titleText.classList.toggle('has-bg', !!titleOv.bg);
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

  $('#automationRoot').querySelectorAll('[data-save-block]').forEach((button) => button.addEventListener('click', async () => {
    const blockElement = button.closest('.auto-block');
    const blockId = button.dataset.saveBlock;
    const currentBlock = pr.blocks.find((block) => block.id === blockId);
    if (!blockElement || !currentBlock) return;
    const imagePrompt = blockElement.querySelector('[data-block-prompt]').value.trim();
    const negativePrompt = blockElement.querySelector('[data-block-negative]').value.trim();
    const title = blockElement.querySelector('[data-block-title]').value.trim() || currentBlock.title || 'Bloque';
    const items = currentBlock.items.map((item, index) => ({
      ...item,
      text: blockElement.querySelector(`[data-block-item="${index}"]`)?.value.trim() || ''
    })).filter((item) => item.text);
    if (!imagePrompt) return toast('El bloque debe conservar un prompt visual.', 'err');
    if (!items.length) return toast('El bloque debe conservar al menos un texto de narración o diálogo.', 'err');
    button.disabled = true;
    const updated = await saveAutomation({
      blocks: pr.blocks.map((block) => block.id === blockId
        ? { ...block, title, imagePrompt, negativePrompt, items }
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
    if (force && !confirm(`¿Regenerar “${block?.title || 'este bloque'}” desde cero? Se crearán una imagen y audios nuevos.`)) return;
    if (block) await runAutomationBlock(pr.id, block, btn.closest('.auto-block'), { regenerate: force });
  }));
  $('#automationRoot').querySelectorAll('[data-regen-downstream]').forEach((button) => button.addEventListener('click', async () => {
    const block = pr.blocks.find((item) => item.id === button.dataset.regenDownstream);
    const output = block && pr.outputs?.[block.id];
    if (!block || !output?.imageKey) return toast('Este bloque todavía no tiene una imagen limpia para reutilizar.', 'err');
    if (!confirm(`¿Rehacer texto, audios y video de “${block.title || 'este bloque'}”? Se conservará exactamente la imagen limpia actual y se consumirán créditos sólo para los audios nuevos.`)) return;
    const preservedOutput = {
      imageKey: output.imageKey,
      imageModelId: output.imageModelId || '',
      imageModelName: output.imageModelName || '',
      fallbackUsed: output.fallbackUsed === true,
      recoveredImage: output.recoveredImage === true,
      audioCountExpected: block.items.length
    };
    try {
      button.disabled = true;
      await persistAutomationBlockOutput(pr.id, block.id, preservedOutput, { replace: true });
      await runAutomationBlock(pr.id, block, button.closest('.auto-block'), { regenerateAudio: true });
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'err');
    }
  }));
  $('#automationRoot').querySelectorAll('[data-regenblock]').forEach((btn) => btn.addEventListener('click', async () => {
    const block = pr.blocks.find((b) => b.id === btn.dataset.regenblock);
    if (!block || !confirm(`¿Descartar los parciales de “${block.title || 'este bloque'}” y regenerar imagen y audios?`)) return;
    await runAutomationBlock(pr.id, block, btn.closest('.auto-block'), { regenerate: true });
  }));
  $('#autoStart').addEventListener('click', () => runAutomationAll(pr.id, $('#autoMode').value));
  $('#autoAssemble')?.addEventListener('click', () => assembleAutomationProject(pr.id));
  $('#autoApplyEffect')?.addEventListener('click', async () => {
    readEffectControls();
    const saved = await saveAll();
    if (saved) applyAutomationVideoEffect(pr.id, videoEffect);
  });
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

// resuelve refs (fichas etiquetadas) y expande @ROL → nombre en el prompt.
async function automationRefsAndPrompt(pr, block) {
  const refItems = [];
  const names = {};
  const addChar = (role) => {
    const c = automationAssignedEntity(pr, 'characters', role);
    const key = fichaKeyForEntity(c);
    if (c) names[role] = c.name;
    if (key) refItems.push({ key, label: c?.name || role });
  };
  const addEl = (kind, role) => {
    if (!role) return;
    const e = automationAssignedEntity(pr, kind, role);
    const key = fichaKeyForEntity(e);
    if (e) names[role] = e.name;
    if (key) refItems.push({ key, label: e?.name || role });
  };
  block.characters.forEach(addChar);
  addEl('locations', block.location);
  addEl('objects', block.prop);
  // dedup por key conservando el primer label
  const seen = new Set();
  const refs = refItems.filter((r) => !seen.has(r.key) && seen.add(r.key));
  const labeledRefs = await buildLabeledRefs(refs);
  let prompt = block.imagePrompt.replace(/@([A-Z0-9_]+)/g, (m, r) => names[r] || m.replace('@', ''));
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
function burnOverlayText(imageKey, caption, ov, { transparent = false, title = null } = {}) {
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
    img.src = fileUrl(imageKey);
  });
}

function automationBlockOutHtml(out) {
  if (!out || (!out.imageKey && !out.textImageKey && !out.textLayerKey && !out.audioKeys?.length && !out.videoKey)) return '';
  const audioKeys = Array.isArray(out.audioKeys) ? out.audioKeys : [];
  const expected = Number(out.audioCountExpected) || audioKeys.length;
  return `
    <span class="automation-stage-status">
      Imagen ${out.imageKey ? '✓' : '—'} · Texto ${out.textImageKey ? '✓' : '—'} · Capa ${out.textLayerKey ? '✓' : '—'} · Audio ${audioKeys.length}/${expected || '—'} · Video ${out.videoKey ? '✓' : '—'}
    </span>
    ${out.fallbackUsed ? `<span class="hint warn">Imagen generada con respaldo: ${esc(out.imageModelName || out.imageModelId || '')}</span>` : ''}
    ${out.imageKey ? `<button type="button" class="auto-output-asset" data-open-asset="${esc(out.imageKey)}" title="Abrir asset y acciones"><img src="${fileUrl(out.imageKey)}" alt="imagen"></button>` : ''}
    ${out.textImageKey ? `<button type="button" class="auto-output-asset" data-open-asset="${esc(out.textImageKey)}" title="Abrir asset y acciones"><img src="${fileUrl(out.textImageKey)}" alt="con texto"></button>` : ''}
    ${out.textLayerKey ? `<button type="button" class="mini-btn" data-open-asset="${esc(out.textLayerKey)}">Capa de subtítulos</button>` : ''}
    ${audioKeys.map((key, index) => `<span class="auto-output-audio"><small>Audio ${index + 1}</small><audio src="${fileUrl(key)}" controls preload="metadata"></audio></span>`).join('')}
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

async function runAutomationBlock(projectId, block, blockEl, {
  regenerate = false, regenerateAudio = false, monitorTaskId = '', monitorIndex = 0, monitorTotal = 0
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

    const { refs, labeledRefs, prompt } = await automationRefsAndPrompt(pr, block);
    let historyLoaded = false;
    let imageKey = output.imageKey;
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
    let textImageKey = output.textImageKey;
    if (!textImageKey) {
      setStatus('Sobreimprimiendo el texto…');
      textImageKey = await burnOverlayText(imageKey, caption, pr.config.overlay, { title });
      output = await persistAutomationBlockOutput(projectId, block.id, { textImageKey });
      await tagAutomationStage(pr, block, [textImageKey]);
    } else {
      setStatus('Reutilizando la imagen con texto guardada…');
    }

    let textLayerKey = output.textLayerKey;
    if (!textLayerKey) {
      setStatus('Preparando la capa nítida de subtítulos…');
      textLayerKey = await burnOverlayText(imageKey, caption, pr.config.overlay, { transparent: true, title });
      output = await persistAutomationBlockOutput(projectId, block.id, { textLayerKey });
      await tagAutomationStage(pr, block, [textLayerKey]);
    }

    const audioKeys = Array.isArray(output.audioKeys)
      ? output.audioKeys.slice(0, block.items.length)
      : [];
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

    setStatus('Armando el video…');
    const category = `Auto: ${pr.name}`;
    const v = await api(`/api/automations/${pr.id}/video`, { method: 'POST', body: {
      blockId: block.id, imageKey: textImageKey, audioKeys, category
    } });
    output = await persistAutomationBlockOutput(projectId, block.id, {
      videoKey: v.videoKey,
      completedAt: Date.now()
    });
    await tagAutomationStage(pr, block, [imageKey, textImageKey, textLayerKey, ...audioKeys, v.videoKey]);
    if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { detail: 'Toma terminada.' });
    renderAutomationProject();
    return true;
  } catch (err) {
    if (ownsMonitorTask) finishUiTask(activeMonitorTaskId, { error: err.message });
    toast(err.message, 'err');
    const latest = state.automations.find((item) => item.id === projectId)?.outputs?.[block.id] || output;
    if (outEl) {
      outEl.innerHTML = `${automationBlockOutHtml(latest)}<span class="hint warn">Falló: ${esc(err.message)}. Los parciales guardados se reutilizarán al continuar.</span>`;
      bindAutomationAssetOpeners(outEl);
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

async function ensureAutomationSubtitleLayers(projectId, taskId = '') {
  let pr = state.automations.find((item) => item.id === projectId);
  if (!pr) throw new Error('El proyecto ya no está disponible.');
  for (let index = 0; index < pr.blocks.length; index++) {
    const block = pr.blocks[index];
    let output = pr.outputs?.[block.id] || {};
    updateUiTask(taskId, {
      current: index + 1,
      detail: output.textLayerKey
        ? `Verificando subtítulos ${index + 1}/${pr.blocks.length}…`
        : `Creando capa de subtítulos ${index + 1}/${pr.blocks.length}…`
    });
    if (!output.imageKey) throw new Error(`Falta la imagen limpia de “${block.title || block.id}”.`);
    if (!output.textLayerKey) {
      const caption = (block.items || []).map((item) => item.text).join(' ');
      const title = automationTitleForBlock(pr, block);
      const textLayerKey = await burnOverlayText(output.imageKey, caption, pr.config.overlay, { transparent: true, title });
      output = await persistAutomationBlockOutput(projectId, block.id, { textLayerKey });
      await tagAutomationStage(pr, block, [textLayerKey]);
      pr = state.automations.find((item) => item.id === projectId) || pr;
    }
    updateUiTask(taskId, { current: index + 1 });
  }
  return state.automations.find((item) => item.id === projectId) || pr;
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
    pr = await ensureAutomationSubtitleLayers(projectId, taskId);
    updateUiTask(taskId, {
      current: pr.blocks.length + 1,
      detail: 'Aplicando el efecto debajo del texto con FFmpeg…'
    });
    if (status) status.textContent = 'Aplicando el efecto sobre las imágenes limpias y colocando el texto al final…';
    const result = await api(`/api/automations/${projectId}/effect`, {
      method: 'POST',
      body: { videoEffect: requestedEffect || pr.config?.videoEffect }
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
    toast(`${result.effectOutput.presetName} aplicado al ${result.effectOutput.intensity}%. El ensamble limpio se conservó.`, 'ok');
  } catch (error) {
    finishUiTask(taskId, { error: error.message });
    if (button) button.disabled = false;
    if (status) status.textContent = `Falló la posproducción: ${error.message}`;
    toast(error.message, 'err');
  }
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
        <strong>${detail.resourceImages + detail.blockImages} imágenes · ${detail.audioItems} voces${detail.musicEnabled ? ' · 1 música' : ''}</strong>
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
      ${detail.musicEnabled ? `<div class="cost-row">
        <span class="cr-label">Música de fondo<span class="cr-sub">${detail.musicSource === 'suno' ? `${detail.generatedMusicTracks} variantes generadas con Suno` : detail.musicSource === 'auto' ? 'Selección automática desde Assets' : 'Pista existente de Assets'}</span></span>
        <span class="cr-value">${fmtUsd(detail.musicCost)}</span>
      </div>` : ''}
      <div class="cost-row">
        <span class="cr-label">Videos de bloque y ensamble final<span class="cr-sub">Procesamiento local con FFmpeg</span></span>
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
  f.key_elevenlabs.value = c.keys.elevenlabs || '';
  f.key_openai.value = c.keys.openai || '';
  f.key_suno.value = c.keys.suno || '';
  f.key_heygen.value = c.keys.heygen || '';
  f.openaiModel.value = c.openaiModel || 'gpt-5-mini';
  f.path_generated.value = c.paths.generated || '';
  f.path_uploads.value = c.paths.uploads || '';
  f.path_audio.value = c.paths.audio || '';
  f.path_video.value = c.paths.video || '';
  f.seedreamModelId.value = c.seedreamModelId || '';
  f.seedanceModelId.value = c.seedanceModelId || '';
  f.seedanceMiniModelId.value = c.seedanceMiniModelId || '';
  f.sunoModelId.value = c.sunoModelId || 'V5_5';
  f.endpoint_ark.value = c.endpoints.ark || '';
  f.endpoint_suno.value = c.endpoints.suno || '';
  f.poserPrompt.value = c.poserPrompt || '';
  f.photoshopPath.value = c.photoshopPath || '';
  f.ffmpegPath.value = c.ffmpegPath || '';
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
      const body = { service, key: f[`key_${service}`].value.trim() };
      if (service === 'ark') {
        body.endpoint = f.endpoint_ark.value.trim();
        body.seedreamModelId = f.seedreamModelId.value.trim();
      }
      if (service === 'suno') body.endpoint = f.endpoint_suno.value.trim();
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
          openai: f.key_openai.value.trim(),
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
          suno: f.endpoint_suno.value.trim()
        },
        seedreamModelId: f.seedreamModelId.value.trim(),
        seedanceModelId: f.seedanceModelId.value.trim(),
        seedanceMiniModelId: f.seedanceMiniModelId.value.trim(),
        sunoModelId: f.sunoModelId.value.trim() || 'V5_5',
        poserPrompt: f.poserPrompt.value.trim(),
        photoshopPath: f.photoshopPath.value.trim(),
        ffmpegPath: f.ffmpegPath.value.trim(),
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
    state.audioModels = s.audioModels || (s.audioModel ? [s.audioModel] : []);
    state.audioModelId = state.audioModels.some((model) => model.id === s.config?.audioModelId)
      ? s.config.audioModelId
      : (state.audioModels[0]?.id || 'eleven-v3');
    state.musicModel = s.musicModel || null;
    state.transitionSounds = s.transitionSounds || [];
    if (s.musicModel?.defaultVersion) state.music.version = s.config?.sunoModelId || s.musicModel.defaultVersion;
    state.characters = s.characters;
    state.prompts = s.prompts;
    state.fonts = s.fonts || [];
    await registerCustomFonts(state.fonts);
    state.promptCategoriesExtra = s.promptCategories || {};
    state.assetLinks = s.assetLinks || [];
    state.series = s.series || [];
    state.scripts = s.scripts || [];
    state.elements = s.elements || [];
    state.elementLinks = s.elementLinks || [];
    state.automations = s.automations || [];
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
