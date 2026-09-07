import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function loadI18n(locale = 'en') {
  const context = vm.createContext({ window: {} });
  for (const file of ['public/i18n.js', 'public/locales/es.js', 'public/locales/en.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const i18n = context.window.ManifestadorI18n;
  i18n.setLocale(locale, { persist: false, applyNow: false });
  return i18n;
}

test('coded and historical FFmpeg errors preserve paths and diagnostics in English', () => {
  const i18n = loadI18n();
  const file = "C:\\Vídeos [test]\\cliente's {error}\\ffmpeg.exe";
  const expected = `FFmpeg could not be found at “${file}”. Choose the bin folder or the FFmpeg executable (ffmpeg.exe on Windows).`;
  assert.equal(i18n.errorMessage({ code: 'ffmpegPathMissing', details: { path: file } }), expected);
  assert.equal(i18n.errorMessage(`No encuentro ffmpeg en “${file}”. Elegí la carpeta bin o el archivo ffmpeg.exe.`), expected);
  const diagnostic = `Invalid input: ${file}\n[mov @ 0x1234] Unknown encoder`;
  assert.equal(i18n.errorMessage(`ffmpeg falló (código 1): ${diagnostic}`), `FFmpeg failed (exit code 1): ${diagnostic}`);
  assert.equal(i18n.errorMessage(`No se pudo ejecutar ffmpeg: ${diagnostic}`), `Could not run FFmpeg: ${diagnostic}`);
});

test('errors follow locale switches and retain unknown provider messages verbatim', () => {
  const i18n = loadI18n();
  assert.equal(i18n.errorMessage('Categoría de vocabulario no encontrada.'), 'Vocabulary category not found.');
  assert.equal(i18n.errorMessage({ code: 'futureCode', error: 'Categoría de vocabulario no encontrada.' }), 'Vocabulary category not found.');
  assert.equal(i18n.errorMessage('La categoría “Mis imágenes” ya existe.'), 'The category “Mis imágenes” already exists.');
  i18n.setLocale('es', { persist: false, applyNow: false });
  assert.equal(i18n.errorMessage('Could not run FFmpeg: ENOENT'), 'No se pudo ejecutar ffmpeg: ENOENT');
  const diagnostic = 'Provider X: request #124 failed\n{"reason":"custom diagnostic"}';
  assert.equal(i18n.errorMessage(new Error(diagnostic)), diagnostic);
  assert.equal(i18n.errorMessage({}, 'HTTP 502'), 'HTTP 502');
});

test('all error translations preserve the same interpolation variables', () => {
  const catalogs = {};
  for (const locale of ['es', 'en']) {
    vm.runInNewContext(read(`public/locales/${locale}.js`), {
      window: { ManifestadorI18n: { register: (language, messages) => { catalogs[language] = messages; } } }
    });
  }
  const variables = (text) => [...new Set([...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]))].sort();
  for (const [key, message] of Object.entries(catalogs.es)) {
    if (key.startsWith('errors.')) assert.deepEqual(variables(message), variables(catalogs.en[key]), key);
  }
});

function loadFfmpeg(spawn) {
  const source = read('server.js');
  const context = vm.createContext({
    path, spawn,
    fs: { stat: async () => { throw new Error('ENOENT'); } }
  });
  vm.runInContext(source.slice(source.indexOf('function localizedServerError('), source.indexOf('function readBody(')), context);
  vm.runInContext(source.slice(source.indexOf('async function resolveFfmpegExecutable('), source.indexOf('async function probeVideoDimensions(')), context);
  return context;
}

test('literal backend validation errors have stable translation codes', () => {
  const server = read('server.js');
  const registry = server.slice(server.indexOf('// LOCALIZED_SERVER_ERRORS_START'), server.indexOf('// LOCALIZED_SERVER_ERRORS_END'));
  const registered = new Set([...registry.matchAll(/\[\s*'([^']*)'\s*,\s*'[^']+'\s*\]/g)].map((match) => match[1]));
  for (const file of ['server.js', 'lib/providers.js', 'lib/comfyBridge.js', 'lib/heygen.js', 'lib/vocabulary.js']) {
    for (const match of read(file).matchAll(/(?:new Error|badRequest)\(\s*'([^']+)'/g)) {
      assert.ok(registered.has(match[1]), `${file}: missing error code for ${match[1]}`);
    }
  }
});

test('real FFmpeg path validation emits stable codes and untouched path details', async () => {
  const server = loadFfmpeg();
  const i18n = loadI18n();
  await assert.rejects(server.resolveFfmpegExecutable(''), (error) => {
    assert.equal(error.localizationCode, 'ffmpegPathRequired');
    assert.equal(i18n.errorMessage(error), 'Set the FFmpeg path in Settings to assemble the video.');
    return true;
  });
  const file = '/Users/cliente/Vídeos/ffmpeg';
  await assert.rejects(server.resolveFfmpegExecutable(file), (error) => {
    assert.equal(error.localizationCode, 'ffmpegPathMissing');
    assert.equal(error.localizationDetails.path, file);
    assert.ok(i18n.errorMessage(error).startsWith(`FFmpeg could not be found at “${file}”.`));
    return true;
  });
});

test('real FFmpeg process failures emit translated errors with original stderr', async () => {
  const i18n = loadI18n();
  for (const event of ['error', 'close']) {
    const server = loadFfmpeg(() => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('Invalid input\nError opening file'));
        child.emit(event, event === 'error' ? new Error('spawn EACCES') : 1);
      });
      return child;
    });
    await assert.rejects(server.runFfmpeg('ffmpeg', []), (error) => {
      assert.equal(i18n.errorMessage(error), event === 'error'
        ? 'Could not run FFmpeg: spawn EACCES'
        : 'FFmpeg failed (exit code 1): Invalid input\nError opening file');
      return true;
    });
  }
});

test('shared API client translates uncoded errors without changing successful data', async () => {
  const source = read('public/app-core.js');
  const context = vm.createContext({ i18n: loadI18n() });
  vm.runInContext(source.slice(source.indexOf('async function api('), source.indexOf('function fmtDate(')), context);
  context.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'No se pudo ejecutar ffmpeg: ENOENT' }) });
  await assert.rejects(context.api('/api/test', { task: false }), { message: 'Could not run FFmpeg: ENOENT' });
  const data = { prompt: 'No se pudo ejecutar ffmpeg: ENOENT', name: 'Mis imágenes' };
  context.fetch = async () => ({ ok: true, status: 200, json: async () => data });
  assert.equal(await context.api('/api/test', { task: false }), data);
});
