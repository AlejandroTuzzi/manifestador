import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { changeInspiration } from '../lib/series-inspiration.js';

// Small DOM harness: exercise actual event handlers without starting the live server.
function harness() {
  const nodes = new Map(), events = {}, calls = [], notices = [];
  let store = { entries: [], producers: [] }, nextId = 0, failSave = false, locale = 'en';
  const catalogs = {};
  for (const language of ['es', 'en']) vm.runInNewContext(fs.readFileSync(new URL(`../public/locales/${language}.js`, import.meta.url), 'utf8'), { window: { ManifestadorI18n: { register: (key, messages) => { catalogs[key] = messages; } } } });
  function node(key) {
    if (nodes.has(key)) return nodes.get(key);
    const children = new Map();
    const value = {
      value: '', checked: false, hidden: true, disabled: false, dataset: {}, attributes: {}, markup: '',
      get innerHTML() { return this.markup; },
      set innerHTML(html) { this.markup = html; if (html.startsWith('<option')) this.value = html.match(/<option value="([^"]*)" selected/)?.[1] || ''; },
      setAttribute(name, val) { this.attributes[name] = val; }, removeAttribute(name) { delete this[name]; },
      classList: { toggle() {} }, focus() {}, getClientRects: () => [1],
      addEventListener(name, callback) { this['on' + name] = callback; },
      querySelector(selector) { return node(key + ' ' + selector); }, querySelectorAll: () => [],
      reset() { for (const child of children.values()) { child.value = ''; child.checked = false; } },
      elements: { namedItem(name) { if (!children.has(name)) children.set(name, node(key + '/' + name)); return children.get(name); } }
    };
    nodes.set(key, value); return value;
  }
  const tr = (key, variables = {}) => String(catalogs[locale][key] || key).replace(/\{(\w+)\}/g, (_, name) => variables[name]);
  const context = {
    document: { body: { insertAdjacentHTML: (_, html) => { node('modals').innerHTML = html; } }, addEventListener: (type, fn) => { events[type] = fn; } },
    window: { addEventListener: (type, fn) => { events[type] = fn; } },
    $: node, IC: () => '<svg></svg>', state: { config: { nsfwEnabled: false } },
    tr, i18n: { apply() {}, localeTag: () => locale, formatNumber: value => String(value) },
    esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    nsfwBadgeHtml: () => '', contentIsVisible: item => !item.nsfw,
    fileUrl: key => '/files/' + key, readFileAsDataUrl: async () => 'data:image/png;base64,AAAA',
    openLightbox() {}, confirm: () => true, toast: message => notices.push(message),
    api: async (path, opts = {}) => {
      calls.push({ path, ...opts });
      if (path === '/api/assets/visual') return { key: 'uploads/cover.png' };
      if (path === '/api/series-inspiration/import') {
        if (failSave) throw new Error('Import failed');
        return { ...structuredClone(store), imported: 0, skipped: 2, hidden: 0 };
      }
      if (!opts.method) return structuredClone(store);
      if (failSave) throw new Error('Save failed');
      const [, kind, id] = path.match(/series-inspiration\/(entries|producers)(?:\/(\w+))?/);
      const identity = id || 'id' + ++nextId;
      store = changeInspiration(store, kind, opts.method, identity, opts.body || {});
      return { ...structuredClone(store), id: identity };
    }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/series-inspiration.js', import.meta.url), 'utf8'), context);
  const form = node('#inspirationForm');
  const field = name => form.elements.namedItem(name);
  const click = async (root, data, entryId = '') => {
    const target = { dataset: data, closest: selector => selector === '[data-entry]' ? { dataset: { entry: entryId } } : selector === '[data-producer]' ? { dataset: { producer: entryId } } : target };
    return node(root).onclick({ target });
  };
  const submit = root => node(root).onsubmit({ preventDefault() {} });
  return { node, field, form, calls, notices, click, submit, events, get store() { return store; }, set fail(value) { failSave = value; }, set locale(value) { locale = value; } };
}

test('inspiration UI: opens editor, changes each star row independently, saves and filters escaped cards', async () => {
  const h = harness();
  await h.click('#seriesInspirationPanel', { action: 'new' });
  assert.equal(h.node('#inspirationEditor').hidden, false);
  assert.equal((h.node('#inspirationRatings').innerHTML.match(/role="radio"/g) || []).length, 30);
  h.field('title').value = '<script>Drama</script>';
  h.field('episodeCount').value = '80';
  h.field('episodeDurationMinutes').value = '1.5';
  for (const [index, field] of ['rating', 'consistency', 'quality', 'continuity', 'narrative', 'sound'].entries()) await h.click('#inspirationForm', { rating: field, value: String(index % 5 + 1) });
  h.field('tagInput').value = 'Romance, Romance, Drama';
  await h.submit('#inspirationForm');
  assert.deepEqual(h.store.entries[0].tags, ['Romance', 'Drama']);
  assert.deepEqual(['rating', 'consistency', 'quality', 'continuity', 'narrative', 'sound'].map(field => h.store.entries[0][field]), [1, 2, 3, 4, 5, 1]);
  assert.equal(h.node('#inspirationEditor').hidden, true);
  assert.equal(h.store.entries[0].episodeCount, 80);
  assert.equal(h.store.entries[0].episodeDurationMinutes, 1.5);
  assert.match(h.node('#inspirationCards').innerHTML, /1.5 min per episode/);
  assert.match(h.node('#inspirationCards').innerHTML, /&lt;script&gt;Drama&lt;\/script&gt;/);
  assert.doesNotMatch(h.node('#inspirationCards').innerHTML, /<script>/);
  h.node('#inspirationSearch').oninput({ target: { value: 'no match' } });
  assert.doesNotMatch(h.node('#inspirationCards').innerHTML, /data-entry/);
  h.node('#inspirationSearch').oninput({ target: { value: 'romance' } });
  assert.match(h.node('#inspirationCards').innerHTML, /data-entry/);
});

test('inspiration UI: creates a producer inline and selects it without losing the entry draft', async () => {
  const h = harness();
  await h.click('#seriesInspirationPanel', { action: 'new' });
  h.field('title').value = 'My drama';
  await h.click('#inspirationForm', { action: 'producers' });
  const producerForm = h.node('#inspirationProducerForm');
  producerForm.elements.namedItem('name').value = 'Reusable Studio';
  producerForm.elements.namedItem('description').value = 'Excellent production';
  producerForm.elements.namedItem('url').value = 'https://example.com';
  await h.submit('#inspirationProducerForm');
  assert.equal(h.field('title').value, 'My drama');
  assert.equal(h.field('producerId').value, h.store.producers[0].id);
  await h.submit('#inspirationForm');
  assert.equal(h.store.entries[0].producerId, h.store.producers[0].id);
  assert.equal(h.store.producers.length, 1);
});

test('inspiration UI: failed save retains edits and reuses the uploaded cover on retry', async () => {
  const h = harness();
  await h.click('#seriesInspirationPanel', { action: 'new' });
  h.field('title').value = 'Retry';
  h.field('cover').files = [{ name: 'cover.png', type: 'image/png', size: 120 }];
  await h.field('cover').onchange();
  assert.equal(h.calls.length, 0, 'Selecting a cover does not upload before saving');
  h.fail = true;
  await h.submit('#inspirationForm');
  assert.equal(h.node('#inspirationEditor').hidden, false);
  assert.equal(h.field('title').value, 'Retry');
  assert.equal(h.notices.at(-1), 'Save failed');
  h.fail = false;
  await h.submit('#inspirationForm');
  assert.equal(h.calls.filter(call => call.path === '/api/assets/visual').length, 1);
  assert.equal(h.store.entries[0].imageKey, 'uploads/cover.png');
});

test('inspiration UI: language changes redraw rating labels and retain the current draft', async () => {
  const h = harness();
  await h.click('#seriesInspirationPanel', { action: 'new' });
  h.field('title').value = 'Original title';
  assert.match(h.node('#inspirationRatings').innerHTML, /Sound design/);
  h.locale = 'es'; h.events['manifestador:localechange']();
  assert.match(h.node('#inspirationRatings').innerHTML, /Sonorización/);
  assert.equal(h.field('title').value, 'Original title');
  assert.match(h.node('modals').innerHTML, /data-i18n="inspiration.addTag"/);
});

test('inspiration UI: ZIP import submits the file, reports duplicates and keeps the existing cards', async () => {
  const h = harness();
  await h.click('#seriesInspirationPanel', { action: 'new' });
  h.field('title').value = 'Existing'; await h.submit('#inspirationForm');
  const input = h.node('#inspirationImportFile'); input.files = [{ name: 'inspiration.zip', size: 120 }];
  await input.onchange({ target: input });
  assert.equal(h.calls.at(-1).path, '/api/series-inspiration/import');
  assert.equal(h.calls.at(-1).body.zipBase64, 'AAAA');
  assert.match(h.notices.at(-1), /Already present: 2/);
  assert.match(h.node('#inspirationCards').innerHTML, /Existing/);
  h.fail = true; await input.onchange({ target: input });
  assert.equal(h.notices.at(-1), 'Import failed');
  assert.match(h.node('#inspirationCards').innerHTML, /Existing/);
});

test('inspiration UI: saved tags can be filtered and reused without duplication', async () => {
  const h = harness();
  await h.click('#seriesInspirationPanel', { action: 'new' });
  h.field('title').value = 'First'; h.field('tagInput').value = 'Romance, Mystery';
  await h.submit('#inspirationForm');
  await h.click('#seriesInspirationPanel', { action: 'new' });
  h.field('title').value = 'Second';
  assert.match(h.node('#inspirationTagSuggestions').innerHTML, /data-existing-tag="Romance"/);
  h.field('tagInput').value = 'ROM'; h.field('tagInput').oninput();
  assert.match(h.node('#inspirationTagSuggestions').innerHTML, /Romance/);
  assert.doesNotMatch(h.node('#inspirationTagSuggestions').innerHTML, /Mystery/);
  await h.click('#inspirationForm', { existingTag: 'Romance' });
  assert.match(h.node('#inspirationTags').innerHTML, /Romance/);
  assert.doesNotMatch(h.node('#inspirationTagSuggestions').innerHTML, /data-existing-tag="Romance"/);
  h.field('tagInput').value = 'romance'; await h.submit('#inspirationForm');
  assert.deepEqual(h.store.entries[0].tags, ['Romance']);
});
