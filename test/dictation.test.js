import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/dictation.js', import.meta.url), 'utf8');
function setup({ supported = true, secure = true } = {}) {
  const nodes = new Map(), sessions = [], pageEvents = {};
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, { value: '', hidden: true, dataset: {}, listeners: {}, selectionStart: 0, selectionEnd: 0,
      classList: { toggle() {} }, addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute(name, value) { this[name] = value; }, dispatchEvent() {} });
    return nodes.get(key);
  };
  class Recognition {
    constructor() { sessions.push(this); }
    start() { this.onstart?.(); }
    abort() { this.aborted = true; this.onend?.(); }
  }
  const context = vm.createContext({
    window: { SpeechRecognition: supported ? Recognition : null, isSecureContext: secure, addEventListener: (type, fn) => { pageEvents[type] = fn; } },
    document: { addEventListener: (type, fn) => { pageEvents[type] = fn; } },
    $: node, $$: () => [], Event: class {}, i18n: { localeTag: () => 'es-AR' }, tr: (key) => key,
    insertAtCursor: (text) => { const field = node('#promptBox'); field.value = field.value.slice(0, field.selectionStart) + text + field.value.slice(field.selectionEnd); field.selectionStart += text.length; field.selectionEnd = field.selectionStart; }
  });
  vm.runInContext(source, context);
  return { context, node, sessions, pageEvents, result(text, final = true) { return Object.assign([{ transcript: text }], { isFinal: final }); } };
}

test('dictation is opt-in, inserts final text only once and displays interim text separately', () => {
  const { node, sessions, result } = setup();
  assert.equal(sessions.length, 0);
  node('#btnDictation').listeners.click();
  assert.equal(sessions.length, 0, 'opening the panel must not activate the microphone');
  const field = node('#promptBox'); field.value = 'A portrait'; field.selectionStart = field.selectionEnd = field.value.length;
  node('#dictationStart').listeners.click();
  const recognition = sessions[0];
  assert.equal(recognition.lang, 'es-AR');
  recognition.onresult({ resultIndex: 0, results: [result('in sunlight', false)] });
  assert.equal(field.value, 'A portrait');
  recognition.onresult({ resultIndex: 0, results: [result('in sunlight')] });
  recognition.onresult({ resultIndex: 0, results: [result('in sunlight')] });
  assert.equal(field.value, 'A portrait in sunlight');
  assert.equal(node('#dictationStop').disabled, false);
});

test('stopping, hiding the page and permission errors prevent later results from being inserted', () => {
  for (const action of ['stop', 'pagehide', 'denied']) {
    const { node, sessions, pageEvents, result } = setup();
    node('#dictationStart').listeners.click();
    const recognition = sessions[0];
    if (action === 'stop') node('#dictationStop').listeners.click();
    else if (action === 'pagehide') pageEvents.pagehide();
    else recognition.onerror({ error: 'not-allowed' });
    recognition.onresult({ resultIndex: 0, results: [result('unexpected')] });
    assert.equal(node('#promptBox').value, '');
    assert.equal(recognition.aborted, true);
    assert.equal(node('#dictationStop').disabled, true);
    assert.equal(node('#dictationStatus').textContent, action === 'denied' ? 'dictation.denied' : 'dictation.stopped');
  }
});

test('unsupported and insecure browsers explain the limitation without recording', () => {
  for (const [options, key] of [[{ supported: false }, 'dictation.unsupported'], [{ secure: false }, 'dictation.insecure']]) {
    const { node, sessions } = setup(options);
    node('#btnDictation').listeners.click(); node('#dictationStart').listeners.click();
    assert.equal(sessions.length, 0);
    assert.equal(node('#dictationStatus').textContent, key);
    assert.equal(node('#dictationStart').disabled, true);
  }
});

test('inserted speech adds word spacing without adding a space before punctuation', () => {
  const { context } = setup();
  assert.equal(context.dictationInsertion('blue', 'A sky', 2, 2), 'blue ');
  assert.equal(context.dictationInsertion('blue', 'A,', 1, 1), ' blue');
  assert.equal(context.dictationInsertion('  ', 'A', 1, 1), '');
});
