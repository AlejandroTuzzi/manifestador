import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { generateWanVideo, validateWanMedia, wanParameters } from '../lib/wan-video.js';
import { getVideoModel } from '../lib/models.js';
import { mergePricing, videoPrice } from '../lib/pricing.js';
import { testService } from '../lib/providers.js';

const json = body => new Response(JSON.stringify(body));
const image = { kind: 'image', path: 'data:image/png;base64,aW1hZ2U=' };
const base = { apiKey: 'secret-test-key', prompt: 'A scene', duration: 5, resolution: '720P', aspectRatio: '16:9', audio: true, sleep: async () => {} };
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function fakeApi(calls, { pending = false, failed = false } = {}) {
  let polls = 0;
  return async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/video-synthesis')) return json({ output: { task_id: 'wan-task-1', task_status: 'PENDING' } });
    if (url.includes('/tasks/')) {
      if (failed) return json({ output: { task_status: 'FAILED', message: 'Rejected' } });
      if (pending && polls++ === 0) return json({ output: { task_status: 'RUNNING' } });
      return json({ output: { task_status: 'SUCCEEDED', video_url: 'https://output.example/video.mp4' }, usage: { output_video_duration: 5, input_video_duration: 3 } });
    }
    assert.equal(options.headers?.Authorization, undefined);
    return new Response('video bytes');
  };
}

test('Wan catalog: standard and Prime share native capabilities and the existing Alibaba key', () => {
  for (const id of ['wan-3', 'wan-3-prime']) {
    const m = getVideoModel(id);
    assert.equal(m.keyName, 'qwen');
    assert.equal(m.provider, 'wan');
    assert.equal(m.maxRefs, 20);
    assert.deepEqual(m.refLimits, { reference: 20, frames: 2, first: 1 });
    for (const resolution of m.resolutions) for (const aspectRatio of m.aspectRatios) for (const duration of m.durations) {
      assert.doesNotThrow(() => wanParameters({ resolution, aspectRatio, duration }));
    }
  }
  assert.equal(videoPrice(mergePricing(), 'wan-3', '1080P'), .20);
  assert.equal(videoPrice(mergePricing(), 'wan-3-prime', '720P'), .14);
});

test('Wan parameters validate bounds, preserve seed zero and smart duration', () => {
  assert.equal(wanParameters({ options: { seed: 0 } }).seed, 0);
  assert.equal(wanParameters({ duration: -1 }).duration, -1);
  assert.equal(wanParameters({ audio: false }).audio, false);
  for (const args of [{ duration: 31 }, { duration: 1 }, { duration: 2.5 }, { resolution: '4K' }, { options: { seed: 2147483648 } }]) {
    assert.throws(() => wanParameters(args), { localizationCode: 'wanParameters' });
  }
});

test('Wan frame validation enforces one or two images and keeps mode constraints', async () => {
  await validateWanMedia([image], { mode: 'first' });
  await validateWanMedia([image, image], { mode: 'frames' });
  await assert.rejects(validateWanMedia([image], { mode: 'frames' }), { localizationCode: 'wanFrames' });
  await assert.rejects(validateWanMedia(Array(11).fill(image)), { localizationCode: 'wanReferences' });
});

test('Wan submission uses official async endpoint, typed references and explicit audio policy', async () => {
  const calls = [], ids = [];
  const result = await generateWanVideo({ ...base, mediaRefs: [image, image], mode: 'frames', options: { seed: 0, promptExtend: false, watermark: true }, onTask: id => ids.push(id), fetchImpl: fakeApi(calls, { pending: true }) });
  assert.deepEqual(ids, ['wan-task-1']);
  const created = calls[0];
  assert.equal(created.url, 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis');
  assert.equal(created.options.headers['X-DashScope-Async'], 'enable');
  const body = JSON.parse(created.options.body);
  assert.deepEqual(body.input.media.map(item => item.type), ['first_frame', 'last_frame']);
  assert.equal(body.parameters.seed, 0);
  assert.equal(body.parameters.prompt_extend, false);
  assert.equal(body.parameters.watermark, true);
  assert.equal(body.model, 'wan3.0-video');
  assert.equal(result.buffer.toString(), 'video bytes');
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
});

test('Wan first-frame and multimodal image types remain distinct', async () => {
  for (const [mode, expected] of [['first', 'first_frame'], ['reference', 'reference_image']]) {
    const calls = [];
    await generateWanVideo({ ...base, mode, mediaRefs: [image], fetchImpl: fakeApi(calls) });
    assert.equal(JSON.parse(calls[0].options.body).input.media[0].type, expected);
  }
});

test('Wan resumes a saved task using only polling and download, never another paid POST', async () => {
  const calls = [];
  await generateWanVideo({ ...base, taskId: 'saved-task', fetchImpl: fakeApi(calls) });
  assert.ok(calls[0].url.endsWith('/tasks/saved-task'));
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 0);
});

test('Wan terminal failures are surfaced and not resubmitted', async () => {
  const calls = [];
  await assert.rejects(generateWanVideo({ ...base, fetchImpl: fakeApi(calls, { failed: true }) }), { localizationCode: 'wanFailed' });
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
});

test('Wan polling timeout preserves provider task ID in the localized error', async () => {
  await assert.rejects(generateWanVideo({ ...base, taskId: 'keep-this-id', maxPolls: 1, fetchImpl: async () => json({ output: { task_status: 'RUNNING' } }) }), error => error.localizationCode === 'wanPending' && error.localizationDetails.detail === 'keep-this-id');
});

test('Wan context URLs are optional, force prompt enhancement and cannot mix with frames', async () => {
  const calls = [];
  await generateWanVideo({ ...base, options: { contextUrl: 'https://example.com/story.pdf', contextType: 'file', promptExtend: false }, fetchImpl: fakeApi(calls) });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.parameters.prompt_extend, true);
  assert.deepEqual(body.input.media, [{ type: 'file', url: 'https://example.com/story.pdf' }]);
  await assert.rejects(generateWanVideo({ ...base, mode: 'frames', options: { contextUrl: 'https://example.com/' } }), { localizationCode: 'wanContext' });
});

test('Wan rejects unsafe endpoints before exposing the key', async () => {
  let calls = 0;
  await assert.rejects(generateWanVideo({ ...base, endpoint: 'https://attacker.example/', fetchImpl: async () => { calls++; } }), { localizationCode: 'qwenEndpoint' });
  assert.equal(calls, 0);
});

test('Wan temporary upload is private, model-bound and sends no bearer token to OSS', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'manifestador-wan-test-'));
  try {
    const file = path.join(dir, 'voice.mp3');
    await writeFile(file, 'audio bytes');
    const calls = [], fallback = fakeApi(calls);
    const fetchImpl = async (url, options = {}) => {
      if (url.includes('getPolicy')) {
        assert.ok(url.includes('model=wan3.0-video-prime'));
        return json({ data: { upload_host: 'https://upload.oss-ap-southeast-1.aliyuncs.com', upload_dir: 'private-prefix', oss_access_key_id: 'temporary-id', signature: 'temporary-signature', policy: 'policy', x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true' } });
      }
      if (url.includes('upload.oss-')) {
        assert.equal(options.headers?.Authorization, undefined);
        assert.equal(options.body.get('x-oss-object-acl'), 'private');
        assert.ok(options.body.get('file') instanceof Blob);
        return new Response('');
      }
      return fallback(url, options);
    };
    await generateWanVideo({ ...base, apiModel: 'wan3.0-video-prime', mediaRefs: [{ kind: 'audio', path: file }], fetchImpl });
    const create = calls[0];
    assert.equal(create.options.headers['X-DashScope-OssResourceResolve'], 'enable');
    assert.match(JSON.parse(create.options.body).input.media[0].url, /^oss:\/\/private-prefix\//);
    assert.equal(JSON.parse(create.options.body).input.media[0].type, 'reference_audio');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Wan validates combined durations and video dimensions before generation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'manifestador-wan-validation-'));
  try {
    const file = path.join(dir, 'ref.mp4');
    await writeFile(file, 'video fixture');
    const refs = [{ kind: 'video', path: file }];
    const opts = { duration: 15, probeDuration: async () => 15, probeDimensions: async () => ({ width: 1280, height: 720, fps: 25 }) };
    assert.equal((await validateWanMedia(refs, opts)).video, 15);
    await assert.rejects(validateWanMedia(refs, { ...opts, duration: 16 }), { localizationCode: 'wanDuration' });
    await assert.rejects(validateWanMedia([...refs, ...refs], opts), { localizationCode: 'wanDuration' });
    await assert.rejects(validateWanMedia(refs, { ...opts, probeDimensions: async () => ({ width: 1280, height: 720, fps: 10 }) }), { localizationCode: 'wanVideoDimensions' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Wan model family, UI and error catalogs are available in both languages', () => {
  const messages = {};
  for (const lang of ['es', 'en']) vm.runInNewContext(read(`public/locales/${lang}.js`), { window: { ManifestadorI18n: { register: (locale, values) => { messages[locale] = values; } } } });
  for (const match of read('lib/wan-video.js').matchAll(/wanError\('([^']+)'/g)) {
    for (const lang of ['es', 'en']) assert.ok(messages[lang][`errors.${match[1]}`], match[1]);
  }
  const context = {};
  vm.runInNewContext(read('public/model-families.js'), context);
  assert.equal(context.ManifestadorModelFamilies([getVideoModel('wan-3'), getVideoModel('wan-3-prime')])[0].name, 'Wan');
  assert.match(read('public/index.html'), /id="wanVideoControls" class="heygen-video-controls"/);
  assert.match(read('public/app.js'), /wanOptions: \{ seed:/);
  assert.match(read('server.js'), /wan-block-tasks\.json/);
});

test('Wan connection check is GET-only and accurately reports its limited scope', async () => {
  const original = global.fetch;
  try {
    global.fetch = async (url, opts) => {
      assert.equal(opts.method, 'GET');
      assert.match(url, /getPolicy&model=wan3\.0-video$/);
      return json({ data: { upload_host: 'https://oss.aliyuncs.com', policy: 'private' } });
    };
    const result = await testService({ service: 'wan', key: 'test-key' });
    assert.equal(result.ok, true);
    assert.equal(result.detailCode, 'wan.testAvailable');
  } finally { global.fetch = original; }
});

test('Wan server flow persists the ID before polling, bills input plus output, and saves history/options', async () => {
  const store = {}, costs = [];
  const context = vm.createContext({
    getConfig: async () => ({ keys: { qwen: 'test-key' }, endpoints: {}, poserPrompt: '' }), getVideoModel,
    resolveAssetKey: async key => key, resolveFfmpegExecutable: async () => 'ffmpeg',
    probeMediaDuration: async () => 3, probeVideoDimensions: async () => ({ width: 1280, height: 720, fps: 25 }),
    validateWanMedia: async () => ({ video: 3 }),
    generateWanVideo: async args => {
      assert.match(args.prompt, /NO MUSIC/);
      assert.equal(args.options.seed, 0);
      await args.onTask('server-task');
      assert.equal(store['wan-tasks.json'][0].taskId, 'server-task');
      return { buffer: Buffer.from('video'), taskId: 'server-task', finalPrompt: args.prompt, usage: { output_video_duration: 5, input_video_duration: 3 } };
    },
    readJson: async (key, fallback) => store[key] || fallback,
    updateJson: async (key, fallback, update) => { store[key] = update(store[key] || fallback); },
    videoAudioPolicy: () => 'NO MUSIC', newId: () => 'id', ts: () => 'date',
    saveBuffer: async () => 'video/wan.mp4', getPricing: async () => mergePricing(), videoPrice,
    recordCost: async entry => costs.push(entry), recordAssetMetadata: async () => {}, wanError: () => new Error('wan'), LABELED_REFS_PROMPT: ''
  });
  const server = read('server.js');
  vm.runInContext(server.slice(server.indexOf('async function runVideoGeneration('), server.indexOf('async function promoteMiniMaxH3To2K(')), context);
  const entry = await context.runVideoGeneration({ modelId: 'wan-3', prompt: 'A scene', refs: [], resolution: '720P', duration: 5, wanOptions: { seed: 0 } });
  assert.equal(entry.cost, .8);
  assert.equal(costs[0].units, 8);
  assert.equal(store['history.json'][0].wanTaskId, 'server-task');
  assert.equal(store['history.json'][0].wanOptions.seed, 0);
  assert.equal(store['wan-tasks.json'].length, 0);
});

test('Wan polling stops immediately on authentication failure instead of waiting an hour', async () => {
  let calls = 0;
  await assert.rejects(generateWanVideo({ ...base, taskId: 'saved-task', fetchImpl: async () => { calls++; return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }); } }), { localizationCode: 'wanRequest' });
  assert.equal(calls, 1);
});
