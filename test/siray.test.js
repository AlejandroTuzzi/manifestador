import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { IMAGE_MODELS, VIDEO_MODELS } from '../lib/models.js';
import { SIRAY_IMAGE_MODELS, SIRAY_VIDEO_MODELS, sirayAutomationModel } from '../lib/siray-models.js';
import { buildSirayRequest, generateSiray, sirayFetch } from '../lib/siray.js';
const image = 'data:image/png;base64,aGVsbG8=';
const ref = kind => ({ kind, path: kind === 'image' ? image : `data:${kind}/${kind === 'audio' ? 'wav' : 'mp4'};base64,aGVsbG8=` });
const video = SIRAY_VIDEO_MODELS[0];
const request = (model = video, extra = {}) => ({ model, prompt: 'A quiet landscape', resolution: model.resolutions[0], aspectRatio: model.aspectRatios[0], duration: model.durations?.[0], ...extra });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

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
