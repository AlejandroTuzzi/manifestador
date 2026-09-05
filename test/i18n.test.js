import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (relativePath) => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

function loadCatalog(relativePath) {
  let result;
  const context = {
    window: {
      ManifestadorI18n: {
        register(locale, messages) { result = { locale, messages }; }
      }
    }
  };
  vm.runInNewContext(read(relativePath), context, { filename: relativePath });
  return result;
}

describe('infraestructura multilenguaje', () => {
  const es = loadCatalog('public/locales/es.js');
  const en = loadCatalog('public/locales/en.js');

  test('los catálogos español e inglés mantienen paridad exacta', () => {
    assert.equal(es.locale, 'es');
    assert.equal(en.locale, 'en');
    assert.deepEqual(Object.keys(es.messages).sort(), Object.keys(en.messages).sort());
    for (const [key, value] of Object.entries(es.messages)) {
      assert.ok(String(value).trim(), `La clave ${key} está vacía en español`);
      assert.ok(String(en.messages[key]).trim(), `La clave ${key} está vacía en inglés`);
    }
  });

  test('todas las claves declaradas en el HTML existen en ambos catálogos', () => {
    const html = read('public/index.html');
    const used = [...html.matchAll(/data-i18n(?:-(?:title|placeholder|aria-label))?="([^"]+)"/g)]
      .map((match) => match[1]);
    assert.ok(used.length > 0);
    for (const key of used) {
      assert.ok(key in es.messages, `Falta ${key} en español`);
      assert.ok(key in en.messages, `Falta ${key} en inglés`);
    }
  });

  test('los textos estáticos españoles del HTML están conectados al catálogo', () => {
    const html = read('public/index.html').replace(/<!--[\s\S]*?-->/g, '');
    const spanishMarker = /[áéíóúñÁÉÍÓÚÑ¿¡]/u;
    for (const match of html.matchAll(/<([a-z][a-z0-9-]*)([^>]*)>([^<>]+)<\/[a-z][a-z0-9-]*>/gi)) {
      const [, tag, attributes, text] = match;
      if (!spanishMarker.test(text) || tag.toLowerCase() === 'script' || text.trim() === 'Español') continue;
      assert.match(attributes, /\bdata-i18n=/, `Texto sin data-i18n: ${text.trim()}`);
    }
    for (const match of html.matchAll(/<[^>]+\bplaceholder="([^"]*)"[^>]*>/g)) {
      if (!spanishMarker.test(match[1])) continue;
      assert.match(match[0], /\bdata-i18n-placeholder=/, `Placeholder sin i18n: ${match[1]}`);
    }
  });

  test('todas las claves literales usadas desde JavaScript existen en ambos catálogos', () => {
    const source = `${read('public/app-core.js')}\n${read('public/app.js')}\n${read('public/poser.js')}`;
    const used = [...source.matchAll(/\btr\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(used.length > 0);
    for (const key of used) {
      assert.ok(key in es.messages, `Falta ${key} en español`);
      assert.ok(key in en.messages, `Falta ${key} en inglés`);
    }
    const pluralKeys = [...source.matchAll(/\btrn\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const key of pluralKeys) {
      for (const suffix of ['one', 'other']) {
        assert.ok(`${key}.${suffix}` in es.messages, `Falta ${key}.${suffix} en español`);
        assert.ok(`${key}.${suffix}` in en.messages, `Falta ${key}.${suffix} en inglés`);
      }
    }
  });

  test('cada código de error localizado del servidor existe en ambos catálogos', () => {
    const server = read('server.js');
    const sendErrorCodes = [...server.matchAll(/\bsendError\(\s*res\s*,\s*\d+\s*,\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1]);
    const thrownErrorCodes = [...server.matchAll(/\blocalizedServerError\(\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1]);
    const registryStart = server.indexOf('// LOCALIZED_SERVER_ERRORS_START');
    const registryEnd = server.indexOf('// LOCALIZED_SERVER_ERRORS_END');
    assert.ok(registryStart >= 0 && registryEnd > registryStart, 'Falta el registro de errores localizados');
    const registry = server.slice(registryStart, registryEnd);
    const registryCodes = [...registry.matchAll(/\[\s*'[^']*'\s*,\s*'([^']+)'\s*\]/g)]
      .map((match) => match[1]);
    const codes = [...new Set([...sendErrorCodes, ...thrownErrorCodes, ...registryCodes])].map((code) => `errors.${code}`);
    assert.ok(codes.length > 0);
    for (const key of codes) {
      assert.ok(key in es.messages, `Falta ${key} en español`);
      assert.ok(key in en.messages, `Falta ${key} en inglés`);
    }
  });

  test('cada error literal enviado por rutas antiguas tiene un código estable', () => {
    const server = read('server.js');
    const registryStart = server.indexOf('// LOCALIZED_SERVER_ERRORS_START');
    const registryEnd = server.indexOf('// LOCALIZED_SERVER_ERRORS_END');
    const registry = server.slice(registryStart, registryEnd);
    const registeredMessages = new Set(
      [...registry.matchAll(/\[\s*'([^']*)'\s*,\s*'[^']+'\s*\]/g)].map((match) => match[1])
    );
    const literals = [...server.matchAll(/\bsend\(\s*res\s*,\s*\d+\s*,\s*\{\s*error:\s*'([^']+)'/g)]
      .map((match) => match[1]);
    for (const message of literals) {
      assert.ok(registeredMessages.has(message), `Error del servidor sin código estable: ${message}`);
    }
  });

  test('cada resultado localizado de pruebas de conexión existe en ambos catálogos', () => {
    const source = `${read('lib/providers.js')}\n${read('server.js')}`;
    const keys = [...source.matchAll(/detailCode:\s*['"]([^'"]+)['"]|result\(\s*(?:true|false)\s*,\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1] || match[2]);
    assert.ok(keys.length > 0);
    for (const key of keys) {
      assert.ok(key in es.messages, `Falta ${key} en español`);
      assert.ok(key in en.messages, `Falta ${key} en inglés`);
    }
  });

  test('los archivos visibles permanecen en UTF-8 sin mojibake', () => {
    const files = [
      'public/index.html', 'public/app-core.js', 'public/app.js', 'public/poser.js',
      'public/locales/es.js', 'public/locales/en.js', 'I18N_TASKS.md'
    ];
    const mojibake = /(?:Ã[\x80-\xBF]|Â[\x80-\xBF]|â(?:€|†|€¦)|ï¿½|\uFFFD)/u;
    for (const file of files) assert.doesNotMatch(read(file), mojibake, `Mojibake detectado en ${file}`);
  });

  test('los formatos del cliente no fijan el locale español', () => {
    const source = `${read('public/app-core.js')}\n${read('public/app.js')}\n${read('public/poser.js')}`;
    assert.doesNotMatch(source, /toLocale(?:String|LowerCase|UpperCase)\(\s*['"]es(?:-AR)?['"]/);
    for (const line of source.split(/\r?\n/).filter((item) => item.includes('.localeCompare('))) {
      assert.match(line, /(?:localeTag|getLocale)/, `localeCompare sin locale activo: ${line.trim()}`);
    }
  });

  test('los plurales tienen formas singulares y plurales naturales', () => {
    assert.equal(es.messages['assets.fileCount.one'], '1 archivo');
    assert.equal(es.messages['assets.fileCount.other'], '{count} archivos');
    assert.equal(en.messages['assets.fileCount.one'], '1 file');
    assert.equal(en.messages['assets.fileCount.other'], '{count} files');
  });

  test('carga el motor y los catálogos antes del núcleo de la aplicación', () => {
    const html = read('public/index.html');
    const positions = ['i18n.js', 'locales/es.js', 'locales/en.js', 'app-core.js'].map((name) => html.indexOf(`src="${name}"`));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });

  test('el idioma forma parte de la configuración persistida', () => {
    const html = read('public/index.html');
    const app = read('public/app.js');
    const server = read('server.js');
    assert.match(html, /name="language"/);
    assert.match(app, /language:\s*f\.language\.value/);
    assert.match(server, /language:\s*'es'/);
    assert.match(server, /normalizeInterfaceLanguage\(body\.language\)/);
  });
});
