// NezhaGate: Seedance 2.5 Special through an OpenAI-style async video API.
// Docs checked 2026-10-27: https://nezhagate.com/en/docs/seedance-2.5-30s/md
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://nezhagate.com/v1';

export const NEZHAGATE_VIDEO_MODELS = [{
  id: 'nezhagate-seedance-2-5-special', name: 'Seedance 2.5 Special', family: 'Seedance',
  provider: 'nezhagate', keyName: 'nezhagate', apiModel: 'seedance-2.5-30s',
  aspectRatios: ['9:16', '16:9'], resolutions: ['720p'],
  durations: Array.from({ length: 27 }, (_, index) => index + 4),
  // Reference audio must be a public HTTPS URL (no upload API): local audio is published through publishAudio.
  maxRefs: 40, refLimits: { reference: 40 }, modes: ['reference'],
  mediaLimits: { image: 30, video: 0, audio: 10, total: 40 },
  supportsMultimediaReferences: true, audio: true, nativeAudio: true, alwaysAudio: true,
  pricedPerClip: true, notes: ''
}];

export function nezhagateError(code, detail = '') {
  const error = new Error(`NezhaGate: ${detail || code}`);
  error.localizationCode = code;
  error.localizationDetails = { detail };
  return error;
}

// Failures the provider documents as unrelated to the input: refunded and safe to resubmit.
const RETRYABLE = new Set(['render_timeout', 'upstream_unstable', 'wait_timeout', 'result_fetch_failed']);
const FAILURE_CODES = { content_policy: 'nezhagateContentPolicy', invalid_material: 'nezhagateInvalidMaterial' };
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

async function mediaUrl(value, kind) {
  if (new RegExp(`^data:${kind}/`).test(value) || /^https:\/\//.test(value)) return value;
  const mime = mimeTypes[path.extname(String(value)).toLowerCase()];
  if (!mime?.startsWith(`${kind}/`)) throw nezhagateError('nezhagateReferences');
  return `data:${mime};base64,${(await fs.readFile(value)).toString('base64')}`;
}

export function nezhagateClipPrice(pricing, modelId, hasAudioReference) {
  const table = pricing.video?.[modelId] || {};
  return Number(hasAudioReference ? table.clipWithAudio : table.clip) || 0;
}

export async function buildNezhaGateRequest({ model, prompt, mediaRefs = [], mode = 'reference', aspectRatio, duration, publishAudio }) {
  if (model?.provider !== 'nezhagate' || !String(prompt || '').trim() || mode !== 'reference') throw nezhagateError('nezhagateParameters');
  const seconds = Number(duration ?? 30);
  if (!model.durations.includes(seconds)) throw nezhagateError('nezhagateParameters', 'duration');
  const counts = { image: 0, video: 0, audio: 0 };
  for (const ref of mediaRefs) {
    if (!(ref.kind in counts) || String(ref.path).startsWith('asset://')) throw nezhagateError('nezhagateReferences');
    counts[ref.kind]++;
  }
  const limits = model.mediaLimits;
  if (counts.video > limits.video || counts.image > limits.image || counts.audio > limits.audio
    || (counts.audio && !counts.image)) throw nezhagateError('nezhagateReferences');
  const localAudio = mediaRefs.filter(ref => ref.kind === 'audio' && !/^https:\/\//.test(ref.path));
  if (localAudio.length && !publishAudio) throw nezhagateError('nezhagateAudioHosting');
  const body = {
    model: model.apiModel, prompt: String(prompt).trim(), duration: seconds, resolution: '720P',
    size: model.aspectRatios.includes(aspectRatio) ? aspectRatio : model.aspectRatios[0]
  };
  if (counts.image) body.images = await Promise.all(mediaRefs.filter(ref => ref.kind === 'image').map(ref => mediaUrl(ref.path, 'image')));
  if (counts.audio) body.audio_reference = await Promise.all(mediaRefs.filter(ref => ref.kind === 'audio')
    .map(ref => /^https:\/\//.test(ref.path) ? ref.path : publishAudio(ref.path)));
  return body;
}

export async function nezhagateFetch(apiKey, route, { fetchImpl = fetch, ...options } = {}) {
  if (!apiKey) throw nezhagateError('nezhagateKey');
  let response;
  try {
    response = await fetchImpl(`${BASE}${route}`, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }
    });
  } catch (error) {
    throw nezhagateError('nezhagateNetwork', String(error?.name || 'network').slice(0, 80));
  }
  const raw = await response.text().catch(() => '');
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = null; }
  if (response.ok && data && typeof data === 'object') return data;
  // Never log raw bodies: they may echo prompts or media.
  const message = String(data?.error?.message || data?.detail || '').replaceAll(apiKey, '[redacted]').slice(0, 300);
  const detail = [`HTTP ${response.status}`, data?.error?.code || '', message].filter(Boolean).join(' · ');
  const code = response.status === 401 || response.status === 403 ? 'nezhagateKey'
    : response.status === 402 ? 'nezhagateBalance'
      : response.status === 429 ? 'nezhagateRateLimit'
        : response.status >= 500 || !data ? 'nezhagateNetwork' : 'nezhagateRequest';
  const error = nezhagateError(code, detail);
  error.status = response.status;
  throw error;
}

export async function generateNezhaGate({
  apiKey, taskId, onTask, onFailed, fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 3 * 60 * 60 * 1000, ...options
}) {
  if (!taskId) {
    const body = await buildNezhaGateRequest(options);
    const created = await nezhagateFetch(apiKey, '/videos/generations', { fetchImpl, method: 'POST', body: JSON.stringify(body) });
    taskId = typeof created.id === 'string' ? created.id.trim() : '';
    if (!taskId) throw nezhagateError('nezhagateMissingTask', JSON.stringify({ fields: Object.keys(created || {}), status: created?.status }).slice(0, 300));
    // Persist before polling. A known job is only ever polled again, never resubmitted.
    await onTask?.(taskId);
  }
  const deadline = Date.now() + timeoutMs;
  let misses = 0;
  while (Date.now() < deadline) {
    let job;
    try {
      job = await nezhagateFetch(apiKey, `/videos/jobs/${encodeURIComponent(taskId)}`, { fetchImpl });
      misses = 0;
    } catch (error) {
      if (['nezhagateKey', 'nezhagateBalance'].includes(error.localizationCode) || error.status === 404 || ++misses >= 10) throw error;
      await sleep(Math.min(60000, 10000 * misses));
      continue;
    }
    if (job.status === 'failed') {
      await onFailed?.(taskId);
      const failure = String(job.error?.code || '');
      const code = FAILURE_CODES[failure] || (RETRYABLE.has(failure) ? 'nezhagateRetryable' : 'nezhagateRequest');
      throw nezhagateError(code, [failure, String(job.error?.message || '')].filter(Boolean).join(' · ').replaceAll(apiKey, '[redacted]').slice(0, 300));
    }
    if (job.status === 'succeeded') {
      const url = job.data?.[0]?.url;
      if (typeof url !== 'string' || !url.startsWith('https://')) throw nezhagateError('nezhagateRequest', 'Invalid output URL');
      // The result host serves public links: never forward the API key to it.
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw nezhagateError('nezhagateDownload', `${taskId} · HTTP ${response.status}`);
      return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'video/mp4', taskId, usage: job.usage || null };
    }
    await sleep(10000);
  }
  throw nezhagateError('nezhagatePending', taskId);
}
