/* Browser speech recognition only. No provider key, paid API or background capture. */
let promptDictation = null;
let dictationStatusKey = 'dictation.ready';

function updateDictationControls() {
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  $('#dictationStart').disabled = Boolean(promptDictation) || !supported || !window.isSecureContext;
  $('#dictationStop').disabled = !promptDictation;
  $('#dictationLanguage').disabled = Boolean(promptDictation);
  $('#btnDictation').classList.toggle('listening', Boolean(promptDictation));
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
      const field = $('#promptBox');
      const insertion = dictationInsertion(text, field.value, field.selectionStart, field.selectionEnd);
      if (insertion) { insertAtCursor(insertion); field.dispatchEvent(new Event('input', { bubbles: true })); }
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
