import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = read('public/app.js');

function catalogs() {
  const messages = {};
  for (const locale of ['es', 'en']) vm.runInNewContext(read(`public/locales/${locale}.js`), { window: { ManifestadorI18n: { register: (lang, values) => { messages[lang] = values; } } } });
  return messages;
}

test('generated images can become a location or object from Create and from the asset viewer', () => {
  assert.match(app, /data-act="element">\$\{IC\('globe'\)\} \$\{esc\(tr\('common\.convertElement'\)\)\}/);
  assert.match(app, /if \(act === 'element'\) openElementModal\(null, entry\.outputs\[state\.currentOutput\]\);/);
  assert.match(app, /id="lbElement"/);
  assert.match(app, /\$\('#lbElement'\)\?\.addEventListener\('click', \(\) => \{\s*closeLightbox\(\);\s*openElementModal\(null, key\);/);
});

test('a new location or object copies the chosen image as its first photo', () => {
  assert.match(app, /function openElementModal\(id, assetKey = null\) \{[\s\S]*?state\.pendingElementAsset = id \? null : assetKey;/);
  const save = app.slice(app.indexOf("let created = await api('/api/elements'"), app.indexOf("toast(created.photos.length ? tr('elements.createdWithPhoto'"));
  assert.match(save, /api\(`\/api\/elements\/\$\{created\.id\}\/photos`, \{ method: 'POST', body: \{ assetKey: state\.pendingElementAsset \} \}\)/);
  assert.match(save, /state\.pendingElementAsset = null;/);
  assert.match(app, /function closeElementModal\(\) \{[\s\S]*?state\.pendingElementAsset = null;/);
});

test('characters can be associated with a series without losing existing cast members', () => {
  assert.match(app, /data-act="series">\$\{IC\('layers'\)\} \$\{esc\(tr\('common\.associateSeries'\)\)\}/);
  assert.match(app, /if \(act === 'series'\) openCharacterSeriesAssign\(c\.id\);/);
  const open = app.slice(app.indexOf('function openCharacterSeriesAssign('), app.indexOf('function openSeriesAssign('));
  assert.match(open, /!item\.archived/);
  assert.match(open, /state\.pendingSeriesAssetKey = null;/);
  const submit = app.slice(app.indexOf("$('#seriesAssignForm').addEventListener('submit'"), app.indexOf('// guiones de series'));
  assert.match(submit, /characterIds: \[\.\.\.new Set\(\[\.\.\.\(target\?\.characterIds \|\| \[\]\), characterId\]\)\]/);
  assert.match(submit, /method: 'PUT'/);
});

test('new strings exist in both languages', () => {
  const messages = catalogs();
  for (const key of ['common.convertElement', 'elements.createdWithPhoto', 'elements.initialPhotoHint', 'series.characterLinkHint', 'series.characterAssociated']) {
    assert.ok(messages.es[key] && messages.en[key], key);
  }
});

test('the removed Automator and external script integrations stay removed', () => {
  const server = read('server.js');
  const html = read('public/index.html');
  for (const route of ['/api/automations', '/api/integrations/controversy-tracker', '/api/scripts/import', '/api/assets/tag']) {
    assert.ok(!server.includes(`'${route}'`) && !server.includes(route.replace(/\//g, '\\/')), route);
  }
  assert.doesNotMatch(html, /view-automat|automationAssetsModal|data-view="automatizador"/);
  assert.doesNotMatch(app, /automation/i);
  const messages = catalogs();
  for (const locale of ['es', 'en']) {
    assert.ok(!Object.keys(messages[locale]).some((key) => key.startsWith('automation.')), locale);
  }
  assert.ok(!fs.existsSync(new URL('../public/logos', import.meta.url)));
  assert.ok(!fs.existsSync(new URL('../public/sounds', import.meta.url)));
});
