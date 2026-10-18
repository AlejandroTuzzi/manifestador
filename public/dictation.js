/* Browser speech recognition only. No provider key, paid API or background capture. */
let promptDictation = null;
let dictationStatusKey = 'dictation.ready';
let dictationTarget = null;
let dictationTrigger = null;
const dictationPanelHome = $('#dictationPanel').parentNode;
const dictationPanelNext = $('#dictationPanel').nextSibling;

function releaseChatDictation() {
  if (!dictationTarget) return;
  stopPromptDictation();
  const panel = $('#dictationPanel');
  panel.hidden = true;
  dictationTrigger?.setAttribute('aria-expanded', 'false');
  dictationPanelHome.insertBefore(panel, dictationPanelNext);
  dictationTarget = null;
  dictationTrigger = null;
}

function toggleChatDictation(field, container, button) {
  if (dictationTarget === field && !$('#dictationPanel').hidden) { releaseChatDictation(); return; }
  releaseChatDictation();
  stopPromptDictation();
  dictationTarget = field;
  dictationTrigger = button;
  const panel = $('#dictationPanel');
  container.appendChild(panel);
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  $('#btnDictation').setAttribute('aria-expanded', 'false');
  if (!$('#dictationLanguage').dataset.initialized) {
    $('#dictationLanguage').value = i18n.localeTag();
    $('#dictationLanguage').dataset.initialized = '1';
  }
  updateDictationControls();
}

function updateDictationControls() {
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  $('#dictationStart').disabled = Boolean(promptDictation) || !supported || !window.isSecureContext;
  $('#dictationStop').disabled = !promptDictation;
  $('#dictationLanguage').disabled = Boolean(promptDictation);
  $('#btnDictation').classList.toggle('listening', Boolean(promptDictation) && !dictationTarget);
  dictationTrigger?.classList.toggle('listening', Boolean(promptDictation));
  $('#dictationStatus').textContent = tr(!supported ? 'dictation.unsupported' : !window.isSecureContext ? 'dictation.insecure' : dictationStatusKey);
}

function stopPromptDictation() {
  const recognition = promptDictation;
  if (!recognition) return;
  promptDictation = null;
  recognition.abort();
  dictationStatusKey = 'dictation.stopped';
  $('#dictationInterim').textContent = '';
  updateDictationControls();
}

function dictationInsertion(text, value, start, end) {
  const clean = text.trim();
  if (!clean) return '';
  return `${start > 0 && !/\s$/.test(value.slice(0, start)) ? ' ' : ''}${clean}${end < value.length && !/^[\s.,;:!?]/.test(value.slice(end)) ? ' ' : ''}`;
}

$('#btnDictation').addEventListener('click', () => {
  releaseChatDictation();
  const panel = $('#dictationPanel');
  panel.hidden = !panel.hidden;
  $('#btnDictation').setAttribute('aria-expanded', String(!panel.hidden));
  if (panel.hidden) stopPromptDictation();
  else {
    if (!$('#dictationLanguage').dataset.initialized) {
      $('#dictationLanguage').value = i18n.localeTag();
      $('#dictationLanguage').dataset.initialized = '1';
    }
    updateDictationControls();
  }
});

$('#dictationStart').addEventListener('click', () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition || !window.isSecureContext || promptDictation) return updateDictationControls();
  const recognition = new Recognition();
  const delivered = new Set();
  recognition.lang = $('#dictationLanguage').value;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  promptDictation = recognition;
  dictationStatusKey = 'dictation.starting';
  $('#dictationInterim').textContent = '';
  recognition.onstart = () => {
    if (promptDictation !== recognition) return;
    dictationStatusKey = 'dictation.listening'; updateDictationControls();
  };
  recognition.onresult = (event) => {
    if (promptDictation !== recognition) return;
    const interim = [];
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index], text = result[0].transcript;
      if (!result.isFinal) { interim.push(text); continue; }
      if (delivered.has(index)) continue;
      delivered.add(index);
      const field = dictationTarget || $('#promptBox');
      if (dictationTarget && !field.isConnected) { stopPromptDictation(); return; }
      const insertion = dictationInsertion(text, field.value, field.selectionStart, field.selectionEnd);
      if (insertion) {
        if (dictationTarget) {
          const available = field.maxLength > 0 ? Math.max(0, field.maxLength - field.value.length + field.selectionEnd - field.selectionStart) : insertion.length;
          field.setRangeText(insertion.slice(0, available), field.selectionStart, field.selectionEnd, 'end');
        } else insertAtCursor(insertion);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    $('#dictationInterim').textContent = interim.join(' ');
  };
  recognition.onerror = (event) => {
    if (promptDictation !== recognition) return;
    dictationStatusKey = ['not-allowed', 'service-not-allowed'].includes(event.error) ? 'dictation.denied'
      : event.error === 'network' ? 'dictation.network' : event.error === 'no-speech' ? 'dictation.noSpeech'
        : event.error === 'audio-capture' ? 'dictation.noMic' : 'dictation.failed';
    promptDictation = null;
    recognition.abort();
    $('#dictationInterim').textContent = '';
    updateDictationControls();
  };
  recognition.onend = () => {
    if (promptDictation !== recognition) return;
    promptDictation = null; dictationStatusKey = 'dictation.stopped';
    $('#dictationInterim').textContent = ''; updateDictationControls();
  };
  try { recognition.start(); }
  catch { promptDictation = null; dictationStatusKey = 'dictation.failed'; }
  updateDictationControls();
});
$('#dictationStop').addEventListener('click', stopPromptDictation);
$('#btnGenerate').addEventListener('click', stopPromptDictation);
$$('.nav-btn, .mode-btn').forEach((button) => button.addEventListener('click', stopPromptDictation));
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPromptDictation(); });
window.addEventListener('pagehide', stopPromptDictation);
window.addEventListener('manifestador:localechange', updateDictationControls);
