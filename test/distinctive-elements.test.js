import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeDistinctiveElements } from '../lib/distinctive-elements.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const detail = { id: 'ring', text: 'Wears a gold ring on the left index finger.', imageKey: 'uploads/ring.png', nsfw: false };

test('distinctive elements require image and text, preserve IDs and reject unsafe paths and duplicates', () => {
  assert.deepEqual(normalizeDistinctiveElements([detail]), [detail]);
  const created = normalizeDistinctiveElements([{ ...detail, id: '', text: ' ring ' }])[0];
  assert.ok(created.id);
  assert.equal(created.text, 'ring');
  for (const imageKey of ['../ring.png', 'uploads/../ring.png', 'uploads\\ring.png', 'https://example.org/ring.png', 'uploads/ring.mp4', 'uploads/ring.svg', 'uploads/ring.png\0']) {
    assert.throws(() => normalizeDistinctiveElements([{ ...detail, imageKey }]));
  }
  for (const value of [null, {}, [null], [{ ...detail, text: '' }], [{ ...detail, text: 'a'.repeat(4001) }], [detail, detail], Array(41).fill(detail)]) {
    assert.throws(() => normalizeDistinctiveElements(value));
  }
  assert.deepEqual(normalizeDistinctiveElements([]), []);
});

function setupClient() {
  const nodes = new Map(), messages = [], requests = [];
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: true, listeners: {}, options: [],
      addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {}, removeAttribute() {},
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    });
    return nodes.get(id);
  };
  const state = { mode: 'image', config: {}, refs: [], characters: [{ id: 'char1', name: 'Observer', variants: [{ id: 'var1', name: 'Suit', distinctiveElements: [structuredClone(detail)] }] }] };
  const context = vm.createContext({ state, $: node, $$: () => [], tr: (key) => key, contentIsVisible: (item) => state.config.nsfwEnabled || !item?.nsfw,
    activeRefLimit: () => 3, addRef: (key) => { if (state.refs.length >= 3) return false; state.refs.push({ key }); return true; },
    insertAtCursor: (text) => { const box = node('#promptBox'); box.value = box.value.slice(0, box.selectionStart) + text + box.value.slice(box.selectionEnd); },
    toast: (message) => messages.push(message), api: async (url, options) => { requests.push({ url, options }); return state.characters[0]; },
    esc: (text) => text, fileUrl: (key) => key, nsfwBadgeHtml: () => '', document: {}, crypto: { randomUUID: () => 'newid' }
  });
  vm.runInContext(read('public/distinctive-elements.js'), context);
  return { context, node, state, messages, requests, choice: () => context.distinctiveChoices()[0] };
}

test('invocation attaches the image and inserts text at the stored cursor without replacing the prompt', () => {
  const { context, node, state, choice } = setupClient();
  node('#promptBox').value = 'Portrait. Background.';
  vm.runInContext('distinctiveCursor = {start: 9, end: 9}', context);
  context.insertDistinctiveElement(choice());
  assert.equal(node('#promptBox').value, `Portrait. ${detail.text} Background.`);
  assert.equal(state.refs[0].key, detail.imageKey);
  assert.equal(state.characters[0].variants[0].distinctiveElements[0].text, detail.text);
});

test('reference limits block text insertion; an already attached image is reused', () => {
  const { context, node, state, choice } = setupClient();
  node('#promptBox').value = 'Keep this';
  state.refs = [{ key: '1' }, { key: '2' }, { key: '3' }];
  context.insertDistinctiveElement(choice());
  assert.equal(node('#promptBox').value, 'Keep this');
  state.refs[0].key = detail.imageKey;
  context.insertDistinctiveElement(choice());
  assert.equal(state.refs.length, 3);
  assert.ok(node('#promptBox').value.includes(detail.text));
  state.mode = 'audio';
  const before = node('#promptBox').value;
  context.insertDistinctiveElement(choice());
  assert.equal(node('#promptBox').value, before);
});

test('NSFW filtering applies to character, wardrobe and individual details', () => {
  const { context, state } = setupClient();
  const character = state.characters[0], variant = character.variants[0], item = variant.distinctiveElements[0];
  for (const target of [character, variant, item]) {
    target.nsfw = true;
    assert.equal(context.distinctiveChoices().length, 0);
    state.config.nsfwEnabled = true;
    assert.equal(context.distinctiveChoices().length, 1);
    state.config.nsfwEnabled = false;
    target.nsfw = false;
  }
});

test('saving details updates the existing wardrobe route without resubmitting character fields', async () => {
  const { context, requests } = setupClient();
  await context.saveDistinctiveList('char1', 'var1', [detail]);
  assert.equal(requests[0].url, '/api/characters/char1/variants/var1');
  assert.equal(requests[0].options.method, 'PUT');
  assert.deepEqual(Object.keys(requests[0].options.body), ['distinctiveElements']);
});

test('HeyGen is collapsed without removing its fields and ZIP export/import includes distinctive images', () => {
  const app = read('public/app.js'), html = read('public/index.html'), server = read('server.js');
  assert.match(app, /<details class="heygen-character-card">/);
  assert.match(app, /<summary>.*characters.editor.heygenVariant/);
  assert.match(app, /heygenWideMotionPrompt: \$\('#chHeyGenWideMotionPrompt'\).value.trim\(\)/);
  assert.match(app, /data-distinctive-variant/);
  assert.ok(html.indexOf('src="distinctive-elements.js"') < html.indexOf('src="app.js"'));
  assert.match(server, /v.distinctiveElements = distinctiveElements/);
  assert.match(server, /variant.distinctiveElements.push\(detail\)/);
  assert.match(server, /photos: variantPhotos, distinctiveElements/);
  assert.match(server, /fs.access\(await resolveAssetKey\(element.imageKey\)\)/);
});

test('real variant update persists details, preserves them on ordinary edits and rejects missing images', async () => {
  const source = read('server.js');
  const data = [{ id: 'char1', name: 'Observer', variants: [{ id: 'var1', name: 'Suit', photos: [] }] }];
  let body = { distinctiveElements: [detail] }, response;
  const context = vm.createContext({ normalizeDistinctiveElements,
    readJsonBody: async () => body,
    resolveAssetKey: async (key) => key,
    fs: { access: async () => {} },
    updateJson: async (_file, _fallback, update) => update(data),
    send: (_res, status, value) => { response = { status, value }; }
  });
  vm.runInContext(source.slice(source.indexOf('async function serveEntityRoutes('), source.indexOf('const server = http.createServer(')), context);
  const call = () => context.serveEntityRoutes({ base: 'characters', file: 'characters.json', notFound: 'Personaje no encontrado' },
    { p: '/api/characters/char1/variants/var1', req: { method: 'PUT' }, res: {}, url: new URL('http://localhost/') });
  await call();
  assert.equal(response.status, 200);
  assert.deepEqual(data[0].variants[0].distinctiveElements, [detail]);
  body = { name: 'Gala' };
  await call();
  assert.equal(data[0].variants[0].name, 'Gala');
  assert.deepEqual(data[0].variants[0].distinctiveElements, [detail]);
  body = { distinctiveElements: [{ ...detail, imageKey: 'uploads/missing.png' }] };
  context.fs.access = async () => { throw new Error('ENOENT'); };
  await assert.rejects(call, /elemento distintivo/);
  assert.deepEqual(data[0].variants[0].distinctiveElements, [detail]);
  body = { distinctiveElements: [] };
  await call();
  assert.equal(data[0].variants[0].distinctiveElements.length, 0);
});
