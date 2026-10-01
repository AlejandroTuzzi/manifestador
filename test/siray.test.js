import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { IMAGE_MODELS, VIDEO_MODELS } from '../lib/models.js';
import { SIRAY_IMAGE_MODELS, SIRAY_VIDEO_MODELS, sirayAutomationModel } from '../lib/siray-models.js';
import { buildSirayRequest, generateSiray, sirayFetch } from '../lib/siray.js';
import { testService } from '../lib/providers.js';
const image = 'data:image/png;base64,aGVsbG8=';
const ref = kind => ({ kind, path: kind === 'image' ? image : `data:${kind}/${kind === 'audio' ? 'wav' : 'mp4'};base64,aGVsbG8=` });
const video = SIRAY_VIDEO_MODELS[0];
const request = (model = video, extra = {}) => ({ model, prompt: 'A quiet landscape', resolution: model.resolutions[0], aspectRatio: model.aspectRatios[0], duration: model.durations?.[0], ...extra });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('Seedream sends two distinct references in order using its i2i schema and completes the async flow', async () => {
  const model = SIRAY_IMAGE_MODELS.find(item => item.id.includes('seedream'));
  const refs = ['data:image/png;base64,b2JqZWN0', 'data:image/png;base64,YmFja2dyb3VuZA=='];
  let posts = 0, persisted = false;
  const output = await generateSiray({ model, apiKey:'test-key', prompt:'Place the object from image one on the background from image two.', resolution:'2K', aspectRatio:'9:16', options:{ output_format:'jpg' },
    mediaRefs:refs.map(path => ({ kind:'image', path })), onTask:() => { persisted = true; },
    fetchImpl:async (url, options) => {
      if (options.method === 'POST') {
        posts++;
        assert.equal(url, 'https://api.siray.ai/v1/images/generations/async');
        const body = JSON.parse(options.body);
        assert.equal(body.model,'bytedance/seedream-5.0-pro-i2i-spicy');
        assert.deepEqual(body.images,refs);
        assert.equal(body.size,'1584x2816');
        assert.equal(body.output_format,'jpg');
        assert.equal(body.image,undefined);
        assert.equal(body.end_image,undefined);
        return json({ code:'success', data:{ task_id:'neutral-two-images' } });
      }
      assert.ok(persisted);
      if (url.includes('/generations/async/')) return json({ code:'success', data:{ status:'SUCCESS', outputs:['https://media.example/neutral.jpg'] } });
      return new Response('fixture', { headers:{ 'Content-Type':'image/jpeg' } });
    }
  });
  assert.equal(posts,1);
  assert.equal(output.taskId,'neutral-two-images');
});

test('Seedream empty, HTML and truncated responses are diagnosed without resubmission or leaking bodies', async () => {
  const model = SIRAY_IMAGE_MODELS.find(item => item.id.includes('seedream'));
  for (const [body, kind] of [['', 'empty'], ['<html>secret private prompt</html>', 'html'], ['{"private":"secret"', 'invalid-json-envelope'], ['null', 'json-null']]) {
    let calls = 0;
    await assert.rejects(generateSiray({ ...request(model), apiKey:'secret', onTask:() => assert.fail('No known task'), fetchImpl:async (_url, options) => {
      calls++; assert.equal(options.method, 'POST');
      return new Response(body, { headers:{ 'Content-Type':'text/html', 'x-request-id':'support-123' } });
    } }), error => {
      assert.equal(error.localizationCode,'sirayInvalidResponse');
      const diagnostic = JSON.parse(error.localizationDetails.detail);
      assert.equal(diagnostic.kind, kind);
      assert.equal(diagnostic.requestId, 'support-123');
      assert.equal(diagnostic.method, 'POST');
      assert.doesNotMatch(error.message, /secret|private prompt/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('invalid polling response preserves the submitted Seedream task for recovery', async () => {
  const model = SIRAY_IMAGE_MODELS.find(item => item.id.includes('seedream'));
  let persisted, posts = 0;
  await assert.rejects(generateSiray({ ...request(model), apiKey:'secret', onTask:id => { persisted = id; }, fetchImpl:async (_url, options) => {
    if (options.method === 'POST') { posts++; return json({ code:'success', data:{ task_id:'original-task' } }); }
    return new Response('');
  } }), { localizationCode:'sirayInvalidResponse' });
  assert.equal(persisted,'original-task'); assert.equal(posts,1);
});

test('Siray balance accepts documented numeric 200 but rejects real errors', async () => {
  const balance = { available_balance: 0 };
  assert.deepEqual(await sirayFetch('secret', '/v1/account/balance', { fetchImpl: async () => json({ code: 200, message: 'OK', data: balance }) }), balance);
  for (const body of [{ code: 401, message: 'Unauthorized' }, { code: 200, success: false }, { code: 200, error: 'Denied' }, { code: 0 }]) {
    await assert.rejects(sirayFetch('secret', '/v1/account/balance', { fetchImpl: async () => json(body) }), { localizationCode: 'sirayRequest' });
  }
});

test('Siray connection test reports API errors rather than network errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ code: 200, message: 'OK', data: { available_balance: 0 } }));
  assert.equal((await testService({ service: 'siray', key: 'secret' })).ok, true);
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ code: 401, message: 'Invalid secret' }), { status: 401 }));
  const result = await testService({ service: 'siray', key: 'secret' });
  assert.equal(result.ok, false);
  assert.equal(result.detailCode, 'errors.sirayRequest');
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('Siray normalizes success codes and empty failure markers without accepting actual errors', async () => {
  for (const code of ['success', 'Success', 'SUCCESS', ' success ', 200, '200']) {
    for (const fail_code of [undefined, '', 0, '0']) {
      assert.deepEqual(await sirayFetch('secret', '/test', { fetchImpl: async () => json({ code, fail_code, message: 'Success', data: { task_id: 'task1' } }) }), { task_id: 'task1' });
    }
  }
  for (const body of [{ code: 403 }, { code: 'Success', fail_code: 'REJECTED' }, { code: 'Success', success: false }, { code: 'Success', error: 'Denied' }]) {
    await assert.rejects(sirayFetch('secret', '/test', { fetchImpl: async () => json({ ...body, message: 'Success' }) }), { localizationCode: 'sirayRequest' });
  }
  await assert.rejects(sirayFetch('secret', '/test', { fetchImpl: async () => new Response(JSON.stringify({ code: 'Success', message: 'Success' }), { status: 500 }) }), /HTTP 500/);
});

test('zero code is accepted only with a task ID on task endpoints, never on message alone', async () => {
  for (const route of ['/v1/images/generations/async', '/v1/video/generations', '/v1/images/generations/async/task1']) {
    for (const code of [0, '0']) {
      for (const payload of [{ data: { task_id: 'task1' } }, { task_id: 'task1' }]) {
        const result = await sirayFetch('secret', route, { envelope: true, fetchImpl: async () => json({ code, message: 'Success', ...payload }) });
        assert.equal(result.code, code);
      }
    }
  }
  for (const extra of [{}, { task_id: ' ' }, { task_id: 123 }, { request_uuid: 'support-only' }, { task_id: 'task1', success: false }, { task_id: 'task1', fail_code: 'REJECTED' }, { task_id: 'task1', error: 'Denied' }]) {
    await assert.rejects(sirayFetch('secret', '/v1/images/generations/async', { fetchImpl: async () => json({ code: 0, message: 'Success', ...extra }) }), { localizationCode: 'sirayRequest' });
  }
  await assert.rejects(sirayFetch('secret', '/v1/account/balance', { fetchImpl: async () => json({ code: 0, task_id: 'task1' }) }), { localizationCode: 'sirayRequest' });
  await assert.rejects(sirayFetch('secret', '/v1/video/generations', { fetchImpl: async () => new Response(JSON.stringify({ code: 0, task_id: 'task1' }), { status: 500 }) }), /HTTP 500/);
});

test('zero-code task submission persists before GET and never repeats the POST', async () => {
  const events = [];
  const model = SIRAY_IMAGE_MODELS.find(item => item.family === 'Qwen');
  const result = await generateSiray({ ...request(model), apiKey: 'secret', onTask: id => events.push('persist:' + id), fetchImpl: async (url, options) => {
    if (options.method === 'POST') { events.push('post'); return json({ code: 0, message: 'Success', data: { task_id: 'task1' } }); }
    if (url.includes('/generations/async/')) { events.push('get'); return json({ code: 'success', data: { task_id: 'task1', status: 'SUCCESS', outputs: ['https://media.example/image.png'] } }); }
    return new Response('image');
  } });
  assert.equal(result.taskId, 'task1');
  assert.deepEqual(events, ['post', 'persist:task1', 'get']);
});

test('unrecognized submission keeps structural diagnostics without logging payloads or retrying', async () => {
  let posts = 0;
  await assert.rejects(generateSiray({ ...request(), apiKey: 'secret', fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'POST'); posts++;
    return json({ code: 0, message: 'Success secret', request_uuid: 'support-only', data: { prompt: 'private prompt', images: ['private media'] } });
  } }), error => {
    assert.equal(error.localizationCode, 'sirayRequest');
    assert.match(error.message, /code=0/);
    assert.match(error.message, /dataFields/);
    assert.match(error.message, /support-only/);
    assert.doesNotMatch(error.message, /secret|private prompt|private media/);
    return true;
  });
  assert.equal(posts, 1);
});

test('Qwen and Wan image jobs persist and finish with mixed-case success responses', async () => {
  for (const model of SIRAY_IMAGE_MODELS.filter(model => ['Qwen', 'Wan'].includes(model.family))) {
    let persisted = false;
    const result = await generateSiray({ ...request(model), apiKey: 'secret', onTask: () => { persisted = true; }, fetchImpl: async (url, options) => {
      if (url.endsWith('/v1/models')) return json({ code: 'Success', data: [{ id: model.apiModel, status: 'active' }] });
      if (options.method === 'POST') return json({ code: 'Success', fail_code: '0', data: { task_id: 'image_123' } });
      assert.ok(persisted);
      if (url.includes('/generations/async/')) return json({ code: 'Success', data: { status: 'Success', outputs: ['https://media.example/image.png'] } });
      return new Response('image', { headers: { 'Content-Type': 'image/png' } });
    } });
    assert.equal(result.taskId, 'image_123');
    assert.equal(result.outputs[0].mime, 'image/png');
  }
});

test('Siray uses existing families and preserves defaults, with latest video versions and both Wan tiers', () => {
  assert.equal(IMAGE_MODELS[0].id, 'nano-banana-pro');
  assert.equal(SIRAY_VIDEO_MODELS.length, 4);
  assert.ok(SIRAY_VIDEO_MODELS.every(model => !/2-0|wan-2/.test(model.id)));
  assert.equal(sirayAutomationModel('wan-prime').id, 'siray-wan-3-prime-spicy');
  const context = {};
  vm.runInNewContext(fs.readFileSync(new URL('../public/model-families.js', import.meta.url), 'utf8'), context);
  const groups = context.ManifestadorModelFamilies([...IMAGE_MODELS, ...VIDEO_MODELS]);
  assert.ok(!groups.some(group => /siray/i.test(group.name)));
  for (const model of [...SIRAY_IMAGE_MODELS, ...SIRAY_VIDEO_MODELS]) {
    assert.ok(groups.find(group => group.name === model.family).models.some(item => item.id === model.id));
  }
});

test('every video route uses the verified Siray schema for text, first image and multimodal references', async () => {
  for (const model of SIRAY_VIDEO_MODELS) {
    const text = await buildSirayRequest(request(model));
    assert.equal(text.path, '/v1/video/generations');
    assert.match(text.body.model, /t2v/);
    const first = await buildSirayRequest(request(model, { mode: 'first', mediaRefs: [ref('image')] }));
    assert.equal(first.body.image, image);
    assert.match(first.body.model, /i2v/);
    const multi = await buildSirayRequest(request(model, { mediaRefs: [ref('image'), ref('video'), ref('audio')] }));
    assert.match(multi.body.model, /ref2v/);
    assert.equal(multi.body.audios.length, 1);
    assert.equal(multi.body.videos.length, 1);
    assert.equal(multi.body.images.length, 1);
  }
});

test('Seedance 2.5 first-frame routes require adaptive ratio without changing other modes or models', async () => {
  const model = sirayAutomationModel('seedance25');
  for (const mode of ['first', 'frames']) {
    for (const aspectRatio of ['9:16', '16:9', '1:1', 'adaptive']) {
      const refs = Array.from({ length: mode === 'frames' ? 2 : 1 }, () => ref('image'));
      const built = await buildSirayRequest(request(model, { mode, aspectRatio, mediaRefs: refs, resolution: '720p', duration: 5 }));
      assert.equal(built.body.aspect_ratio, 'adaptive');
      assert.equal(built.body.model, 'bytedance/seedance-2.5-i2v-spicy');
      assert.equal(built.body.image, image);
      assert.equal(built.body.end_image, mode === 'frames' ? image : undefined);
      assert.equal(built.body.size, '720p');
      assert.equal(built.body.duration, 5);
    }
  }
  for (const mediaRefs of [[], [ref('image')]]) {
    const built = await buildSirayRequest(request(model, { mode: 'reference', mediaRefs, aspectRatio: '9:16' }));
    assert.equal(built.body.aspect_ratio, '9:16');
  }
  for (const generator of ['wan', 'wan-prime']) {
    for (const mode of ['first', 'frames']) {
      const built = await buildSirayRequest(request(sirayAutomationModel(generator), { mode, aspectRatio: '9:16', mediaRefs: Array.from({ length: mode === 'frames' ? 2 : 1 }, () => ref('image')) }));
      assert.equal(built.body.aspect_ratio, '9:16');
    }
  }
});

test('Seedance frame submission sends adaptive on its first POST, without retrying', async () => {
  let posts = 0;
  await generateSiray({ ...request(sirayAutomationModel('seedance25'), { mode: 'first', aspectRatio: '9:16', mediaRefs: [ref('image')] }), apiKey: 'secret', fetchImpl: async (url, options) => {
    if (options.method === 'POST') {
      posts++;
      assert.equal(JSON.parse(options.body).aspect_ratio, 'adaptive');
      return json({ code: 'success', data: { task_id: 'landscape-test' } });
    }
    if (url.includes('/v1/video/')) return json({ code: 'success', data: { status: 'SUCCESS', outputs: ['https://media.example/landscape.mp4'] } });
    return new Response('mock video');
  } });
  assert.equal(posts, 1);
});

test('end frame is sent separately, and unsupported MiniMax end frames fail before a paid request', async () => {
  const end = 'data:image/png;base64,ZW5k';
  const built = await buildSirayRequest(request(video, { mode: 'frames', mediaRefs: [ref('image'), { kind: 'image', path: end }] }));
  assert.equal(built.body.image, image);
  assert.equal(built.body.end_image, end);
  await assert.rejects(buildSirayRequest(request(sirayAutomationModel('h3'), { mode: 'frames', mediaRefs: [ref('image'), ref('image')] })), { localizationCode: 'sirayParameters' });
});

test('image references select edit APIs; Seedream sizes preserve aspect and Z-Image is text only', async () => {
  for (const model of SIRAY_IMAGE_MODELS) {
    const text = await buildSirayRequest(request(model));
    assert.equal(text.path, '/v1/images/generations/async');
    if (model.routes.edit) {
      const edit = await buildSirayRequest(request(model, { mediaRefs: [ref('image')] }));
      assert.equal(edit.body.images.length, 1);
      assert.notEqual(edit.body.model, text.body.model);
    } else await assert.rejects(buildSirayRequest(request(model, { mediaRefs: [ref('image')] })), { localizationCode: 'sirayReferences' });
  }
  const seedream = SIRAY_IMAGE_MODELS.find(model => model.id.includes('seedream'));
  assert.equal((await buildSirayRequest(request(seedream, { aspectRatio: '9:16', resolution: '2K' }))).body.size, '1584x2816');
});

test('invalid resolutions, reference overflow, Ark assets and fractional seeds are rejected', async () => {
  await assert.rejects(buildSirayRequest(request(video, { resolution: '4K' })), { localizationCode: 'sirayParameters' });
  await assert.rejects(buildSirayRequest(request(video, { mediaRefs: Array.from({ length: 31 }, () => ref('image')) })), { localizationCode: 'sirayReferences' });
  await assert.rejects(buildSirayRequest(request(video, { mediaRefs: [{ kind: 'image', path: 'asset://private' }] })), { localizationCode: 'sirayReferences' });
  await assert.rejects(buildSirayRequest(request(sirayAutomationModel('wan'), { options: { seed: 1.5 } })), { localizationCode: 'sirayParameters' });
});

test('seed zero, audio off and prompt expansion off are preserved, unsupported flags are not sent', async () => {
  const built = await buildSirayRequest(request(sirayAutomationModel('wan'), { audio: false, options: { seed: 0, prompt_expansion_enable: false } }));
  assert.equal(built.body.seed, 0);
  assert.equal(built.body.audio_enable, false);
  assert.equal(built.body.prompt_expansion_enable, false);
  const h3 = await buildSirayRequest(request(sirayAutomationModel('h3'), { options: { seed: 0 } }));
  assert.ok(!('seed' in h3.body));
  assert.ok(!('audio_enable' in h3.body));
});

test('async submission persists ID before polling and never sends credentials to output storage', async () => {
  const events = [];
  const output = await generateSiray({ ...request(), apiKey: 'secret', onTask: id => events.push('persist:' + id), sleep: async () => {},
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') { events.push('post'); return json({ code: 'success', data: { task_id: 'task1' } }); }
      if (url.includes('/v1/video/')) { events.push('poll'); return json({ code: 'success', data: { status: 'SUCCESS', outputs: ['https://media.example/video.mp4'] } }); }
      assert.equal(options.headers, undefined);
      return new Response('bytes', { headers: { 'Content-Type': 'video/mp4' } });
    } });
  assert.deepEqual(events, ['post', 'persist:task1', 'poll']);
  assert.equal(output.taskId, 'task1');
  assert.equal(output.outputs[0].mime, 'video/mp4');
});

test('recovery only polls; terminal failure is localized and never resubmitted', async () => {
  let failed = false;
  await assert.rejects(generateSiray({ ...request(), apiKey: 'secret', taskId: 'task1', onFailed: () => { failed = true; },
    fetchImpl: async (url, options) => {
      assert.notEqual(options.method, 'POST');
      return json({ code: 'success', data: { status: 'FAILURE', fail_reason: 'secret expired' } });
    } }), error => error.localizationCode === 'sirayRequest' && !error.message.includes('secret'));
  assert.equal(failed, true);
});

test('video accepts top-level task responses as well as wrapped responses for Wan and Seedance', async () => {
  for (const model of SIRAY_VIDEO_MODELS.filter(model => ['Wan', 'Seedance'].includes(model.family))) {
    let persisted = false;
    const result = await generateSiray({ ...request(model), apiKey: 'secret', onTask: id => { assert.equal(id, 'video_123'); persisted = true; }, fetchImpl: async (url, options) => {
      if (options.method === 'POST') return json({ code: 'success', task_id: 'video_123' });
      assert.ok(persisted);
      if (url.includes('/v1/video/')) return json({ status: 'SUCCESS', task_id: 'video_123', outputs: ['https://media.example/result.mp4'] });
      return new Response('video');
    } });
    assert.equal(result.taskId, 'video_123');
  }
});

test('missing task ID preserves safe diagnostics, never uses request UUID, never resubmits', async () => {
  let posts = 0;
  await assert.rejects(generateSiray({ ...request(), apiKey: 'secret', onTask: () => assert.fail('No task to persist'), fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'POST'); posts++;
    return json({ code: 'success', message: 'secret diagnostic', request_uuid: 'support-only', data: { prompt: 'private prompt', images: ['private media'] } });
  } }), error => {
    assert.equal(error.localizationCode, 'sirayMissingTask');
    assert.match(error.localizationDetails.detail, /support-only/);
    assert.doesNotMatch(error.message, /secret|private prompt|private media/);
    return true;
  });
  assert.equal(posts, 1);
});

test('submission fail_code is not mistaken for a missing task ID', async () => {
  await assert.rejects(sirayFetch('secret', '/v1/video/generations', { fetchImpl: async () => json({ code: 'success', fail_code: 'REJECTED' }) }), { localizationCode: 'sirayRequest' });
});

test('unconfirmed models require active account availability before any paid POST', async () => {
  const model = SIRAY_IMAGE_MODELS.find(item => item.availabilityUnverified);
  await assert.rejects(generateSiray({ ...request(model), apiKey: 'secret', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.siray.ai/v1/models');
    assert.notEqual(options.method, 'POST');
    return json({ success: true, data: [] });
  } }), { localizationCode: 'sirayUnavailable' });
});

test('connection requests reject auth failures and redact the key', async () => {
  await assert.rejects(sirayFetch('secret', '/v1/account/balance', { fetchImpl: async () => new Response(JSON.stringify({ message: 'bad secret' }), { status: 401 }) }), error => !error.message.includes('secret') && error.localizationCode === 'sirayRequest');
});

test('integration retains configuration, bilingual controls, separate keys and persistent tasks', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /siray-tasks\.json/);
  assert.match(server, /siray-block-tasks\.json/);
  assert.match(server, /videoProvider: b\.videoProvider === 'siray'/);
  assert.match(app, /data-block-provider/);
  assert.match(app, /syncSirayGenerationJobs/);
  assert.match(server, /model\.durations \? '\.mp4'/);
});
