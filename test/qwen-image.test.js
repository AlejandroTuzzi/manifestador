import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { generateQwenImage, normalizeQwenOptions, qwenImageSize, qwenEndpoint } from '../lib/qwen-image.js';
import { IMAGE_MODELS, getImageModel } from '../lib/models.js';
import { mergePricing, imagePrice } from '../lib/pricing.js';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const ref = 'data:image/png;base64,aW1hZ2U=';
const baseArgs = { apiKey: 'secret-test-key', prompt: 'Portrait', refPaths: [] };

test('Qwen catalog preserves the existing default and obeys pixel area and ratio limits', () => {
  assert.equal(IMAGE_MODELS[0].id, 'nano-banana-pro');
  const model = getImageModel('qwen-image-3.0-pro');
  assert.equal(model.maxRefs, 3);
  assert.equal(model.maxBatch, 6);
  assert.equal(model.keyName, 'qwen');
  for (const resolution of model.resolutions) for (const ratio of model.aspectRatios) {
    const [w, h] = qwenImageSize(ratio, resolution).split('*').map(Number);
    const [rw, rh] = ratio.split(':').map(Number);
    assert.ok(w * h >= 512 ** 2 && w * h <= (resolution === '2K' ? 2048 : 1024) ** 2);
    assert.ok(w / h >= 1 / 8 && w / h <= 8);
    assert.ok(Math.abs(w / h / (rw / rh) - 1) < .03);
    assert.equal(w % 16, 0);
    assert.equal(h % 16, 0);
  }
  assert.throws(() => qwenImageSize('1:0'), { localizationCode: 'qwenSize' });
  assert.throws(() => qwenImageSize('1:1', '4K'), { localizationCode: 'qwenSize' });
});

test('Qwen sends a single native batch with ordered references, labels and all options', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') return json({ output: { choices: [{ message: { content: [{ image: 'https://output.example/1.png' }, { image: 'https://output.example/2.png' }] } }] } });
    assert.equal(options.headers?.Authorization, undefined);
    return new Response('png');
  };
  const output = await generateQwenImage({ ...baseArgs, endpoint: 'https://workspace.ap-southeast-1.maas.aliyuncs.com', refPaths: [ref, ref, ref], preface: 'Ignore reference labels.', resolution: '2K', aspectRatio: '9:16', count: 6,
    options: { negativePrompt: 'blur', seed: 0, promptExtend: true, thinking: true, promptExtendMode: 'direct' } });
  assert.equal(output.length, 2);
  assert.equal(calls.length, 3);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(body.model, 'qwen-image-3.0-pro');
  assert.deepEqual(body.input.messages[0].content.slice(0, 3), [{ image: ref }, { image: ref }, { image: ref }]);
  assert.match(body.input.messages[0].content[3].text, /^Ignore reference labels\.\n\nPortrait$/);
  assert.equal(body.parameters.n, 6);
  assert.equal(body.parameters.seed, 0);
  assert.equal(body.parameters.negative_prompt, 'blur');
  assert.equal(body.parameters.enable_thinking, true);
  assert.equal(body.parameters.watermark, false);
});

test('Qwen text-to-image omits images and permits Agent reasoning', async () => {
  global.fetch = async (url, options = {}) => {
    if (!options.body) return new Response('png');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.input.messages[0].content, [{ text: 'Portrait' }]);
    assert.equal(body.parameters.prompt_extend_mode, 'agent');
    assert.equal(body.parameters.enable_thinking, true);
    assert.equal('seed' in body.parameters, false);
    return json({ output: { choices: [{ message: { content: [{ image: 'https://output.example/1.png' }] } }] } });
  };
  await generateQwenImage({ ...baseArgs, options: { promptExtendMode: 'agent' } });
});

test('validation rejects invalid refs, seeds and hosts before any network request', async () => {
  global.fetch = async () => assert.fail('No API requests expected');
  for (const [args, code] of [
    [{ apiKey: '' }, 'qwenKey'], [{ refPaths: [ref, ref, ref, ref] }, 'qwenReferences'],
    [{ refPaths: [ref], options: { promptExtendMode: 'agent' } }, 'qwenAgentReferences'],
    [{ refPaths: ['data:audio/wav;base64,aW1hZ2U='] }, 'qwenReference'],
    [{ count: 7 }, 'qwenCount'], [{ options: { seed: -1 } }, 'qwenSeed'],
    [{ options: { seed: 1.1 } }, 'qwenSeed'], [{ options: { seed: 2147483648 } }, 'qwenSeed'],
    [{ endpoint: 'https://aliyuncs.com.evil.example' }, 'qwenEndpoint']
  ]) await assert.rejects(generateQwenImage({ ...baseArgs, ...args }), { localizationCode: code });
  assert.equal(normalizeQwenOptions({ thinking: true, promptExtend: false }).thinking, false);
  assert.equal(normalizeQwenOptions({ seed: '' }).seed, null);
  assert.equal(qwenEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'https://dashscope.aliyuncs.com');
});

test('Qwen localizes moderation, HTTP failures, empty output and timeout without leaking keys', async () => {
  global.fetch = async () => json({ code: 'DataInspectionFailed', message: 'Blocked secret-test-key' }, 400);
  await assert.rejects(generateQwenImage(baseArgs), (error) => {
    assert.equal(error.localizationCode, 'qwenModeration');
    assert.ok(!error.message.includes(baseArgs.apiKey));
    return true;
  });
  global.fetch = async () => json({ code: 'InvalidApiKey', message: 'Invalid key' }, 401);
  await assert.rejects(generateQwenImage(baseArgs), { localizationCode: 'qwenRequest' });
  global.fetch = async () => json({ output: { choices: [] } });
  await assert.rejects(generateQwenImage(baseArgs), { localizationCode: 'qwenEmpty' });
  global.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  await assert.rejects(generateQwenImage(baseArgs), { localizationCode: 'qwenTimeout' });
});

function generationHarness() {
  const calls = [], costs = [], history = [];
  const source = read('server.js');
  let id = 0;
  const context = vm.createContext({
    getConfig: async () => ({ keys: { qwen: 'test' }, endpoints: {} }), getImageModel,
    normalizeQwenOptions, imagePrice, getPricing: async () => mergePricing(),
    resolveAssetKey: async (key) => `/local/${key}`, LABELED_REFS_PROMPT: 'Labels preface',
    generateQwenImage: async (args) => { calls.push(args); return [{ mime: 'image/png', buffer: Buffer.from('a') }, { mime: 'image/png', buffer: Buffer.from('b') }]; },
    ts: () => 'stamp', newId: () => String(++id), extForMime: () => '.png',
    saveBuffer: async (kind, name) => `${kind}/${name}`, recordCost: async (entry) => costs.push(entry),
    updateJson: async (file, fallback, update) => { if (file === 'history.json') history.push(...update([])); },
    recordAssetMetadata: async () => {},
    localizedServerError: (code, message) => Object.assign(new Error(message), { localizationCode: code })
  });
  vm.runInContext(source.slice(source.indexOf('async function runImageGeneration('), source.indexOf('// El key de un asset ya guardado')), context);
  return { context, calls, costs, history };
}

test('shared server pipeline bills output plus input once, saves history and does not truncate Qwen refs', async () => {
  const { context, calls, costs, history } = generationHarness();
  const entry = await context.runImageGeneration({ modelId: 'qwen-image-3.0-pro', prompt: 'Portrait', batch: 6, resolution: '2K', refs: ['uploads/a', 'uploads/b', 'uploads/c'], labeledRefs: { 'uploads/a': ref }, qwenImage: { seed: 24 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].count, 6);
  assert.equal(calls[0].refPaths[0], ref);
  assert.equal(calls[0].preface, 'Labels preface');
  assert.ok(Math.abs(costs[0].cost - .159) < 1e-9);
  assert.equal(entry.qwenImage.seed, 24);
  assert.equal(history[0].qwenImage.seed, 24);
  assert.equal(entry.outputs.length, 2);
  await assert.rejects(context.runImageGeneration({ modelId: 'qwen-image-3.0-pro', prompt: 'Portrait', refs: ['a', 'b', 'c', 'd'] }), { localizationCode: 'qwenReferences' });
  context.generateQwenImage = async () => { throw Object.assign(new Error('Qwen blocked'), { localizationCode: 'qwenModeration' }); };
  await assert.rejects(context.runImageGeneration({ modelId: 'qwen-image-3.0-pro', prompt: 'Portrait' }), { localizationCode: 'qwenModeration' });
});

test('Automation passes its saved Qwen options through the same generation endpoint', async () => {
  const source = read('public/app.js');
  let request;
  const context = vm.createContext({ state: { models: IMAGE_MODELS },
    api: async (url, spec) => { request = { url, body: spec.body }; return { outputs: ['generated/qwen.png'] }; },
    automationImageSettings: () => ({ resolution: '2K', aspectRatio: '9:16' })
  });
  vm.runInContext(source.slice(source.indexOf('async function generateAutomationImage('), source.indexOf('async function persistAutomationBlockOutput(')), context);
  await context.generateAutomationImage({ config: { imageModelId: 'qwen-image-3.0-pro', qwenImage: { seed: 0, negativePrompt: 'blur' } } }, { prompt: 'Portrait', refs: ['uploads/a'] }, () => {});
  assert.equal(request.url, '/api/generate/image');
  assert.equal(request.body.qwenImage.seed, 0);
  assert.equal(request.body.qwenImage.negativePrompt, 'blur');
  assert.equal(request.body.refs.length, 1);
});

test('all provider errors and shared options are translated in both languages', () => {
  const catalogs = {};
  for (const locale of ['es', 'en']) vm.runInNewContext(read(`public/locales/${locale}.js`), {
    window: { ManifestadorI18n: { register: (lang, values) => { catalogs[lang] = values; } } }
  });
  const codes = [...read('lib/qwen-image.js').matchAll(/(?:fail\(|\? |: )'(qwen\w+)'/g)].map((m) => m[1]);
  for (const code of codes) for (const locale of ['es', 'en']) assert.ok(catalogs[locale][`errors.${code}`], code);
  const context = vm.createContext({ tr: (key) => catalogs.en[key], esc: (text) => String(text).replaceAll('<', '&lt;') });
  const source = read('public/app.js');
  vm.runInContext(source.slice(source.indexOf('function qwenOptionsMarkup('), source.indexOf('function renderImageControls(')), context);
  const markup = context.qwenOptionsMarkup({ seed: 0, negativePrompt: '<script>', promptExtend: false });
  assert.match(markup, /Negative prompt/);
  assert.match(markup, /value="0"/);
  assert.match(markup, /&lt;script>/);
  assert.doesNotMatch(markup, /data-qwen="promptExtend" type="checkbox" checked/);
  assert.equal((source.match(/state.qwenImage = entry.qwenImage/g) || []).length, 2);
  assert.match(read('public/index.html'), /type="password" name="key_qwen"/);
  assert.match(read('public/style.css'), /\.qwen-options textarea[^}]+background: var\(--bg\)/);
});
