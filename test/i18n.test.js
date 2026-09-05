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
    const codes = [...server.matchAll(/\bsendError\(\s*res\s*,\s*\d+\s*,\s*['"]([^'"]+)['"]/g)]
      .map((match) => `errors.${match[1]}`);
    assert.ok(codes.length > 0);
    for (const key of codes) {
      assert.ok(key in es.messages, `Falta ${key} en español`);
      assert.ok(key in en.messages, `Falta ${key} en inglés`);
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
