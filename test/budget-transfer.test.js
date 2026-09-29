import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportBudgetSettings, importBudgetSettings } from '../lib/budget-transfer.js';
import { defaultBudgetSettings } from '../public/budget-model.js';

test('budget settings round-trip includes rates, revisions, currency and footer, not secrets', () => {
  const settings = defaultBudgetSettings();
  settings.usdPerEuro = 1.17;
  settings.rates.voices.create = 42;
  settings.rates.soundMix.revisions = 5;
  settings.footerHtml = '<p>Contact</p>';
  const archive = exportBudgetSettings({ ...settings, keys: { api: 'private' }, quotes: ['private'] });
  assert.doesNotMatch(JSON.stringify(archive), /private/);
  assert.deepEqual(importBudgetSettings(JSON.parse(JSON.stringify(archive))).settings, settings);
});

test('header travels embedded, without the source PC path', () => {
  const header = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=', 'base64');
  const archive = exportBudgetSettings({ ...defaultBudgetSettings(), headerImage: 'uploads/original.png' }, header);
  assert.equal(archive.settings.headerImage, '');
  const imported = importBudgetSettings(archive);
  assert.deepEqual(imported.header, header);
  assert.equal(imported.extension, 'png');
});

test('rejects foreign files, future versions, bad prices, paths and non-images', () => {
  const valid = exportBudgetSettings(defaultBudgetSettings());
  for (const bad of [null, {}, { ...valid, version: 99 }, { ...valid, settings: [] }, { ...valid, settings: { ...valid.settings, headerImage: '../../secret.png' } }]) {
    assert.throws(() => importBudgetSettings(bad), { localizationCode: 'budgetTransfer' });
  }
  assert.throws(() => importBudgetSettings({ ...valid, settings: { ...valid.settings, usdPerEuro: -1 } }), { localizationCode: 'budgetNumber' });
  assert.throws(() => importBudgetSettings({ ...valid, header: { extension: 'png', base64: Buffer.from('<script>bad</script>').toString('base64') } }), { localizationCode: 'budgetImage' });
  assert.throws(() => exportBudgetSettings({ ...valid.settings, headerImage: 'uploads/missing.png' }), { localizationCode: 'budgetImage' });
});
