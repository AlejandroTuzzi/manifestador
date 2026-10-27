import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VIDEO_MODELS, getVideoModel } from '../lib/models.js';
import { NEZHAGATE_VIDEO_MODELS, buildNezhaGateRequest, generateNezhaGate, nezhagateClipPrice, nezhagateFetch } from '../lib/nezhagate.js';
import { DEFAULT_PRICING, mergePricing } from '../lib/pricing.js';

const model = NEZHAGATE_VIDEO_MODELS[0];
const image = 'data:image/png;base64,aGVsbG8=';
const request = extra => ({ model, prompt: 'The woman from @Image1 turns to the camera.', aspectRatio: '9:16', duration: 30, mediaRefs: [{ kind: 'image', path: image }], ...extra });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('NezhaGate Special is a Seedance model with its own provider, fixed per-clip price and reference-only limits', () => {
  assert.equal(getVideoModel('nezhagate-seedance-2-5-special'), model);
  assert.ok(VIDEO_MODELS.includes(model));
  assert.equal(model.family, 'Seedance');
  assert.equal(model.apiModel, 'seedance-2.5-30s');
  assert.deepEqual(model.modes, ['reference']);
  assert.equal(model.mediaLimits.video, 0);
  assert.equal(model.mediaLimits.audio, 10);
  assert.equal(nezhagateClipPrice(DEFAULT_PRICING, model.id, false), 2);
  assert.equal(nezhagateClipPrice(DEFAULT_PRICING, model.id, true), 3);
  assert.equal(nezhagateClipPrice(mergePricing({ video: { [model.id]: { clip: 1.5 } } }), model.id, false), 1.5);
});

test('request uses the documented fields and keeps reference order', async () => {
  const body = await buildNezhaGateRequest(request({ mediaRefs: [{ kind: 'image', path: image }, { kind: 'image', path: 'https://example.com/b.png' }] }));
  assert.deepEqual(body, { model: 'seedance-2.5-30s', prompt: 'The woman from @Image1 turns to the camera.', duration: 30, resolution: '720P', size: '9:16',
    images: [image, 'https://example.com/b.png'] });
  assert.equal('audio_reference' in body, false);
  assert.equal('audio' in body, false);
});

test('local reference audio is published as an HTTPS link; without a publisher it is refused', async () => {
  const published = [];
  const body = await buildNezhaGateRequest(request({
    mediaRefs: [{ kind: 'image', path: image }, { kind: 'audio', path: 'C:/tmp/voice.wav' }, { kind: 'audio', path: 'https://cdn.example/a.mp3' }],
    publishAudio: async file => { published.push(file); return 'https://bucket.example/signed.wav'; }
  }));
  assert.deepEqual(published, ['C:/tmp/voice.wav']);
  assert.deepEqual(body.audio_reference, ['https://bucket.example/signed.wav', 'https://cdn.example/a.mp3']);
  await assert.rejects(buildNezhaGateRequest(request({ mediaRefs: [{ kind: 'image', path: image }, { kind: 'audio', path: 'C:/tmp/voice.wav' }] })),
    { localizationCode: 'nezhagateAudioHosting' });
});

test('unsupported references, modes and durations are refused before any request', async () => {
  for (const extra of [
    { mediaRefs: [{ kind: 'video', path: 'data:video/mp4;base64,aGVsbG8=' }] },
    { mediaRefs: [{ kind: 'audio', path: 'https://cdn.example/a.mp3' }] },
    { mediaRefs: [{ kind: 'image', path: 'asset://private-face' }] },
    { mediaRefs: Array.from({ length: 31 }, () => ({ kind: 'image', path: image })) }
  ]) await assert.rejects(buildNezhaGateRequest(request(extra)), { localizationCode: 'nezhagateReferences' });
  await assert.rejects(buildNezhaGateRequest(request({ mode: 'frames' })), { localizationCode: 'nezhagateParameters' });
  await assert.rejects(buildNezhaGateRequest(request({ duration: 31 })), { localizationCode: 'nezhagateParameters' });
});

test('submits once, persists the job before polling and downloads without the API key', async () => {
  let posts = 0, persisted = '', polls = 0;
  const result = await generateNezhaGate({ ...request(), apiKey: 'secret', sleep: async () => {}, onTask: id => { persisted = id; },
    fetchImpl: async (url, options = {}) => {
      if (options.method === 'POST') {
        posts++;
        assert.equal(url, 'https://nezhagate.com/v1/videos/generations');
        assert.equal(options.headers.Authorization, 'Bearer secret');
        return json({ id: 'img_job', status: 'queued' }, 202);
      }
      if (url.includes('/videos/jobs/')) {
        assert.equal(persisted, 'img_job');
        polls++;
        return json(polls < 2 ? { id: 'img_job', status: 'processing' } : { id: 'img_job', status: 'succeeded', data: [{ url: 'https://img.nezhagate.com/i/clip.mp4' }], usage: { clips: 1 } });
      }
      assert.equal(url, 'https://img.nezhagate.com/i/clip.mp4');
      assert.equal(options.headers, undefined);
      return new Response('mp4');
    } });
  assert.equal(posts, 1);
  assert.equal(result.taskId, 'img_job');
  assert.equal(result.buffer.toString(), 'mp4');
});

test('a saved job is only polled, never submitted again', async () => {
  const result = await generateNezhaGate({ model, apiKey: 'secret', taskId: 'img_saved', sleep: async () => {},
    fetchImpl: async (url, options = {}) => {
      assert.notEqual(options.method, 'POST');
      return url.includes('/videos/jobs/img_saved') ? json({ status: 'succeeded', data: [{ url: 'https://img.nezhagate.com/i/x.mp4' }] }) : new Response('ok');
    } });
  assert.equal(result.taskId, 'img_saved');
});

test('failed jobs map to stable codes and mark the task failed', async () => {
  for (const [failure, code] of [['content_policy', 'nezhagateContentPolicy'], ['invalid_material', 'nezhagateInvalidMaterial'], ['upstream_unstable', 'nezhagateRetryable'], ['other', 'nezhagateRequest']]) {
    let failed = false;
    await assert.rejects(generateNezhaGate({ model, apiKey: 'secret', taskId: 'img_x', sleep: async () => {}, onFailed: () => { failed = true; },
      fetchImpl: async () => json({ status: 'failed', error: { code: failure, message: 'refused secret' } }) }), error => {
      assert.equal(error.localizationCode, code);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
    assert.ok(failed);
  }
});

test('HTTP errors are classified and transient polling errors keep the job', async () => {
  for (const [status, code] of [[401, 'nezhagateKey'], [402, 'nezhagateBalance'], [429, 'nezhagateRateLimit'], [400, 'nezhagateRequest'], [502, 'nezhagateNetwork']]) {
    await assert.rejects(nezhagateFetch('secret', '/videos/generations', { method: 'POST', fetchImpl: async () => json({ error: { message: 'bad secret' } }, status) }), error => {
      assert.equal(error.localizationCode, code);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
  let calls = 0;
  const result = await generateNezhaGate({ model, apiKey: 'secret', taskId: 'img_retry', sleep: async () => {},
    fetchImpl: async url => {
      if (!url.includes('/videos/jobs/')) return new Response('ok');
      return ++calls < 3 ? json({}, 503) : json({ status: 'succeeded', data: [{ url: 'https://img.nezhagate.com/i/y.mp4' }] });
    } });
  assert.equal(result.taskId, 'img_retry');
});

test('NezhaGate strings exist in both languages and the key field is in Settings', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /name="key_nezhagate"/);
  assert.match(html, /data-service="nezhagate"/);
  for (const locale of ['es', 'en']) {
    const source = fs.readFileSync(new URL(`../public/locales/${locale}.js`, import.meta.url), 'utf8');
    for (const key of ['nezhagate.notes', 'nezhagate.testOk', 'models.officialProvider', 'errors.nezhagateKey', 'errors.nezhagateContentPolicy', 'errors.nezhagateRetryable', 'errors.nezhagateFrames']) {
      assert.match(source, new RegExp(`"${key.replace('.', '\\.')}"`), `${locale}: ${key}`);
    }
  }
});
