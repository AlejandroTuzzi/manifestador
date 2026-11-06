import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { IMAGE_MODELS } from '../lib/models.js';
import { generateOpenAIImage } from '../lib/providers.js';
import { normalizeOpenAIEdit, openAIEditInstruction, openAIGifFrameSize, openAIImageOptions } from '../lib/openai-image-options.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(width, height, colorType = 6) {
  const buffer = Buffer.alloc(40);
  PNG.copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[25] = colorType;
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
const usage = { input_tokens_details: { image_tokens: 0, text_tokens: 100 }, output_tokens: 1000 };
async function capture(options, b64 = 'iVBORw0KGgo=') {
  const saved = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, request) => { seen = { url, request }; return new Response(JSON.stringify({ data: [{ b64_json: b64 }], usage }), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    const result = await generateOpenAIImage({ apiKey: 'test-only', apiModel: 'gpt-image-2.6-flare', prompt: 'test', refPaths: [], aspectRatio: '16:9', resolution: '1K', ...options });
    return { result, url: seen.url, body: seen.request.body instanceof FormData ? Object.fromEntries(seen.request.body) : JSON.parse(seen.request.body) };
  } finally { globalThis.fetch = saved; }
}

test('GPT Image 2.6 joins the family above 2.5 and only 2.6 offers the new options', () => {
  for (const variant of ['sunburst', 'flare']) {
    const latest = IMAGE_MODELS.find((model) => model.id === `gpt-image-2.6-${variant}`);
    assert.equal(latest.apiModel, `gpt-image-2.6-${variant}`);
    assert.equal(latest.maxRefs, 16);
    assert.equal(latest.openaiLatest, true);
    assert.equal(IMAGE_MODELS.find((model) => model.id === `gpt-image-2.5-${variant}`).openaiLatest, false);
  }
  const context = {};
  vm.runInNewContext(read('public/model-families.js'), context);
  const family = context.ManifestadorModelFamilies(IMAGE_MODELS).find((item) => item.name === 'GPT Image');
  assert.deepEqual([...family.models].slice(0, 4).map((model) => model.id), ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);
});

test('complexity, formats and GIF timing are validated and never reach older models', () => {
  assert.equal(openAIImageOptions({ complexity: 'low' }, 'gpt-image-2.6-flare').complexity, 'low');
  assert.equal(openAIImageOptions({ complexity: 'extreme' }, 'gpt-image-2.6-flare').complexity, undefined);
  const older = openAIImageOptions({ complexity: 'low', format: 'gif' }, 'gpt-image-2.5-flare');
  assert.equal(older.complexity, undefined);
  assert.equal(older.output_format, 'png');
  const gif = openAIImageOptions({ format: 'gif', frameCount: 99, frameDurationMs: 7 }, 'gpt-image-2.6-flare');
  assert.deepEqual([gif.output_format, gif.frame_count, gif.frame_duration_ms, gif.background], ['gif', 16, 20, undefined]);
  assert.equal(openAIImageOptions({ format: 'gif', frameDurationMs: 123 }, 'gpt-image-2.6-flare').frame_duration_ms, 120);
  assert.equal(openAIImageOptions({ format: 'svg' }, 'gpt-image-2.6-flare').background, undefined);
});

test('GIF frames stay within the sheet limits observed on the real API', () => {
  assert.equal(openAIGifFrameSize('9:16', 9, '1K'), '720x1280');
  assert.equal(openAIGifFrameSize('9:16', 16, '1K'), '528x960');
  assert.equal(openAIGifFrameSize('16:9', 5, '1K'), '1280x720');
  for (const ratio of ['1:1', '9:16', '16:9', '21:9']) for (const frames of [2, 3, 4, 5, 9, 12, 16]) for (const resolution of ['1K', '2K', '4K']) {
    const [width, height] = openAIGifFrameSize(ratio, frames, resolution).split('x').map(Number);
    const tiles = Math.ceil(Math.sqrt(frames));
    assert.ok(width % 16 === 0 && height % 16 === 0, `${ratio} ${frames}`);
    assert.ok(width * height * tiles * tiles <= 8294400, `${ratio} ${frames} ${resolution}`);
    assert.ok(Math.max(width, height) * tiles <= 3840, `${ratio} ${frames} ${resolution}`);
  }
});

test('region edits accept only an RGBA PNG within limits, on models that support them', () => {
  const layer = png(1200, 900);
  assert.equal(normalizeOpenAIEdit(null, 'gpt-image-2.6-flare', 1), null);
  assert.equal(normalizeOpenAIEdit({ mode: 'mask', layer }, 'gpt-image-2.5-flare', 1).mode, 'mask');
  for (const [value, model, refs] of [
    [{ mode: 'markup', layer }, 'gpt-image-2', 1],
    [{ mode: 'markup', layer }, 'gpt-image-2.6-flare', 0],
    [{ mode: 'paint', layer }, 'gpt-image-2.6-flare', 1],
    [{ mode: 'markup', layer: 'data:image/jpeg;base64,AAAA' }, 'gpt-image-2.6-flare', 1],
    [{ mode: 'markup', layer: 'data:image/png;base64,AAAA' }, 'gpt-image-2.6-flare', 1],
    [{ mode: 'markup', layer: png(1200, 900, 2) }, 'gpt-image-2.6-flare', 1]
  ]) assert.throws(() => normalizeOpenAIEdit(value, model, refs), { localizationCode: 'openaiEditInvalid' });
  assert.throws(() => normalizeOpenAIEdit({ mode: 'markup', layer: png(4097, 4097) }, 'gpt-image-2.6-flare', 1), { localizationCode: 'openaiEditTooLarge' });
  assert.match(openAIEditInstruction('markup'), /Do not reproduce them/);
  assert.match(openAIEditInstruction('mask'), /only inside the masked area/);
});

test('marks and masks travel as their own multipart file with the requested complexity', async () => {
  for (const mode of ['markup', 'mask']) {
    const edit = normalizeOpenAIEdit({ mode, layer: png(1200, 900) }, 'gpt-image-2.6-flare', 1);
    const { url, body } = await capture({ edit, refPaths: ['data:image/png;base64,iVBORw0KGgo='], aspectRatio: '4:3', options: { complexity: 'low', quality: 'low' } });
    assert.match(url, /\/images\/edits$/);
    assert.equal(body.complexity, 'low');
    assert.equal(body.size, '1184x896');
    assert.equal(body[mode].type, 'image/png');
    assert.equal(body[mode === 'mask' ? 'markup' : 'mask'], undefined);
  }
});

test('SVG names its author model, GIF sends its frames, and neither accepts references', async () => {
  const svg = await capture({ svgAuthorModel: 'gpt-5-mini', options: { format: 'svg' } }, Buffer.from('<svg viewBox="0 0 1 1"></svg>').toString('base64'));
  assert.match(svg.url, /\/images\/generations$/);
  assert.deepEqual(svg.body.svg, { model: 'gpt-5-mini' });
  assert.equal(svg.result[0].mime, 'image/svg+xml');
  const gif = await capture({ options: { format: 'gif', frameCount: 4, frameDurationMs: 150 } }, Buffer.from('GIF89a').toString('base64'));
  assert.deepEqual([gif.body.frame_count, gif.body.frame_duration_ms, gif.body.svg], [4, 150, undefined]);
  assert.equal(gif.result[0].mime, 'image/gif');
  await assert.rejects(generateOpenAIImage({ apiKey: 'test-only', apiModel: 'gpt-image-2.6-flare', prompt: 'x', refPaths: ['data:image/png;base64,AAAA'], options: { format: 'gif' } }), { localizationCode: 'openaiFormatNoReferences' });
});

test('the server wires edits through the normal history, serves GIF and contains SVG', () => {
  const server = read('server.js');
  assert.match(server, /normalizeOpenAIEdit\(req\.openaiEdit, apiModel, refs\.length\)/);
  assert.match(server, /openaiEdit \? \{ openaiEdit: \{ mode: openaiEdit\.mode \} \}/);
  assert.match(server, /'\.gif': 'image\/gif'/);
  assert.match(server, /mime === 'image\/svg\+xml' \? \{ 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" \}/);
  assert.doesNotMatch(read('lib/generation-settings.js'), /openaiEdit/, 'The drawn layer is not archived with each request');
});

test('editor sizes keep the source proportions and respect the model limits', () => {
  const source = read('public/asset-editor-ai.js');
  const context = vm.createContext({});
  vm.runInContext(source.slice(0, source.indexOf('function drawAssetAiStroke(')), context);
  assert.equal(context.assetAiAspectRatio(1200, 900), '4:3');
  assert.equal(context.assetAiAspectRatio(1023, 767), '1023:767');
  assert.equal(context.assetAiSizeProblem(1200, 900, true), '');
  assert.equal(context.assetAiSizeProblem(3100, 1000, false), 'assetEditor.ai.ratioLimit');
  assert.equal(context.assetAiSizeProblem(4100, 4100, true), 'assetEditor.ai.tooLarge');
  assert.equal(context.assetAiSizeProblem(4100, 4100, false), '');
});

test('strokes draw at the requested scale; masks fill shapes and the eraser removes paint', () => {
  const source = read('public/asset-editor-ai.js');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function drawAssetAiStroke('), source.indexOf('const assetAi = {')), context);
  const calls = [];
  const ctx = new Proxy({}, { get: (target, name) => name in target ? target[name] : (...args) => calls.push([name, ...args]), set: (target, name, value) => { target[name] = value; return true; } });
  const rect = { tool: 'rect', color: '#f00', size: 10, points: [{ x: 10, y: 20 }, { x: 110, y: 220 }] };
  context.drawAssetAiStroke(ctx, rect, 0.5, true);
  assert.deepEqual(calls.find((call) => call[0] === 'rect'), ['rect', 5, 10, 50, 100]);
  assert.equal(ctx.lineWidth, 5);
  assert.ok(calls.some((call) => call[0] === 'fill'));
  calls.length = 0;
  context.drawAssetAiStroke(ctx, rect, 1, false);
  assert.ok(!calls.some((call) => call[0] === 'fill'));
  let composite = '';
  const eraser = new Proxy({}, { get: (target, name) => name in target ? target[name] : () => {}, set: (target, name, value) => { if (name === 'globalCompositeOperation' && !composite) composite = value; target[name] = value; return true; } });
  context.drawAssetAiStroke(eraser, { tool: 'eraser', color: '#000', size: 4, points: [{ x: 1, y: 1 }] }, 1, true);
  assert.equal(composite, 'destination-out');
  assert.equal(eraser.globalCompositeOperation, 'source-over');
});

test('the editor is connected: controls exist, history reopens it, and SVG/GIF are not reused', () => {
  const html = read('public/index.html');
  const app = read('public/app.js');
  const ai = read('public/asset-editor-ai.js');
  for (const id of new Set([...ai.matchAll(/\$\('#([A-Za-z]+)'\)/g)].map((match) => match[1]))) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.ok(html.indexOf('src="app.js"') < html.indexOf('src="asset-editor-ai.js"'));
  assert.match(app, /async function regenerate\(entry\) \{\n  if \(entry\.openaiEdit\) return assetEditorAi\.open\(entry\);/);
  assert.match(app, /async function restoreEntrySettings\(entry\) \{\n  if \(entry\.openaiEdit\) return assetEditorAi\.open\(entry\);/);
  assert.match(app, /function isReusableImageKey\(key\) \{\n[^\n]*!\/\\\.\(svg\|gif\)\$\/i/);
  assert.match(app, /if \(state\.assetEditorRefPick\) \{[\s\S]*?assetEditorAi\.addReference\(key\);/);
});

test('new strings exist in both languages', () => {
  const messages = {};
  for (const locale of ['es', 'en']) vm.runInNewContext(read(`public/locales/${locale}.js`), { window: { ManifestadorI18n: { register: (lang, values) => { messages[lang] = values; } } } });
  const used = new Set([...read('public/asset-editor-ai.js').matchAll(/'(assetEditor\.ai\.[A-Za-z]+)'/g)].map((match) => match[1]));
  for (const key of [...used, 'assetEditor.modeCrop', 'assetEditor.modeAi', 'openaiImage.complexity', 'openaiImage.formatGif', 'errors.openaiEditInvalid', 'errors.openaiEditTooLarge', 'errors.openaiFormatNoReferences', 'errors.openaiNotRaster', 'models.gpt-image-2.6-sunburst.notes']) {
    assert.ok(messages.es[key] && messages.en[key], key);
  }
});
