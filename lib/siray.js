import fs from 'node:fs/promises';
import path from 'node:path';
import { SIRAY_SCHEMAS } from './siray-models.js';

export function sirayError(code, detail = '') {
  const error = new Error(`Siray: ${detail || code}`);
  error.localizationCode = code;
  error.localizationDetails = { detail };
  return error;
}
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
async function mediaUrl(value) {
  if (/^data:(image|video|audio)\//.test(value)) return value;
  if (/^https:\/\//.test(value)) return value;
  if (String(value).startsWith('asset://')) throw sirayError('sirayReferences');
  const mime = mimeTypes[path.extname(value).toLowerCase()];
  if (!mime) throw sirayError('sirayReferences');
  return `data:${mime};base64,${(await fs.readFile(value)).toString('base64')}`;
}

export async function buildSirayRequest({ model, prompt, mediaRefs = [], mode = 'reference', resolution, aspectRatio, duration, audio, options = {} }) {
  if (!model || model.provider !== 'siray') throw sirayError('sirayParameters');
  if (!String(prompt || '').trim()) throw sirayError('sirayParameters');
  const video = Boolean(model.durations);
  if (video && !model.modes.includes(mode)) throw sirayError('sirayParameters');
  const route = !video ? (mediaRefs.length ? model.routes.edit : model.routes.text)
    : ['first', 'frames'].includes(mode) ? model.routes.first : mediaRefs.length ? model.routes.reference : model.routes.text;
  const schema = SIRAY_SCHEMAS[route];
  if (!schema) throw sirayError('sirayReferences');
  const p = schema.properties;
  const body = { model: p.model.enum[0], prompt: String(prompt).trim() };
  if (p.aspect_ratio) body.aspect_ratio = aspectRatio || model.aspectRatios[0];
  body.size = resolution || model.resolutions[0];
  if (model.id.includes('seedream')) {
    const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
    const index = ratios.indexOf(aspectRatio || '1:1');
    if (index < 0 || !['1K', '2K'].includes(body.size)) throw sirayError('sirayParameters');
    body.size = p.size.enum[index + (body.size === '2K' ? 8 : 0)];
  }
  if (model.id.includes('z-image')) {
    body.size = ({ '4:3': '1024x768', '3:4': '768x1024', '1:1': '1024x1024', '2:3': '1024x1536', '3:2': '1536x1024', '16:9': '2560x1440', '9:16': '1440x2560' })[aspectRatio || '1:1'];
  }
  if (video) body.duration = Number(duration ?? model.durations[0]);
  if (p.audio_enable) body.audio_enable = audio !== false;
  for (const key of ['seed', 'prompt_expansion_enable', 'output_format', 'task_type']) {
    if (options[key] !== undefined && p[key]) body[key] = options[key];
  }
  const counts = { image: 0, video: 0, audio: 0 };
  for (const ref of mediaRefs) {
    if (!(ref.kind in counts)) throw sirayError('sirayReferences');
    counts[ref.kind]++;
  }
  if (['first', 'frames'].includes(mode) && video) {
    if (counts.image !== (mode === 'frames' ? 2 : 1) || counts.video || counts.audio) throw sirayError('sirayReferences');
    body.image = await mediaUrl(mediaRefs[0].path);
    if (mode === 'frames') {
      if (!p.end_image) throw sirayError('sirayReferences');
      body.end_image = await mediaUrl(mediaRefs[1].path);
    }
  } else {
    for (const kind of ['image', 'video', 'audio']) {
      const key = `${kind}s`;
      if (counts[kind] && (!p[key] || counts[kind] > p[key].maxItems)) throw sirayError('sirayReferences');
      if (counts[kind]) body[key] = await Promise.all(mediaRefs.filter(ref => ref.kind === kind).map(ref => mediaUrl(ref.path)));
    }
  }
  for (const [key, value] of Object.entries(body)) {
    const spec = p[key];
    if (!spec || (spec.enum && !spec.enum.includes(value))
      || (spec.type === 'integer' && (!Number.isInteger(value) || (spec.minimum != null && value < spec.minimum) || (spec.maximum != null && value > spec.maximum)))
      || (spec.type === 'boolean' && typeof value !== 'boolean')) throw sirayError('sirayParameters', key);
  }
  for (const key of schema.required) if (body[key] == null) throw sirayError('sirayParameters', key);
  return { path: schema.path, body };
}

export async function sirayFetch(apiKey, route, { fetchImpl = fetch, envelope = false, ...options } = {}) {
  if (!apiKey) throw sirayError('sirayKey');
  const response = await fetchImpl(`https://api.siray.ai${route}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  });
  const data = await response.json().catch(() => null);
  // Normalize status markers, not message text: "Success" is not proof of
  // acceptance when an HTTP error or an explicit failure is also present.
  const code = data?.code == null ? null : String(data.code).trim().toLowerCase();
  const successfulCode = code == null || code === 'success' || code === '200';
  const failCode = data?.fail_code == null ? '' : String(data.fail_code).trim();
  const hasFailureCode = failCode !== '' && failCode !== '0';
  if (!response.ok || !data || data.error || data.success === false || !successfulCode || hasFailureCode) {
    const detail = [`HTTP ${response.status}`, data?.code != null ? `code=${String(data.code)}` : '', hasFailureCode ? `fail_code=${failCode}` : '', data?.message || ''].filter(Boolean).join(' · ').replaceAll(apiKey, '[redacted]').slice(0, 500);
    throw sirayError('sirayRequest', detail);
  }
  return envelope ? data : (data.data ?? data);
}

export async function generateSiray({ apiKey, taskId, onTask, onFailed, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), ...options }) {
  const request = taskId ? null : await buildSirayRequest(options);
  const route = options.model.durations ? '/v1/video/generations' : '/v1/images/generations/async';
  if (!taskId) {
    if (options.model.availabilityUnverified) {
      const models = await sirayFetch(apiKey, '/v1/models', { fetchImpl });
      if (!Array.isArray(models) || !models.some(item => item.id === request.body.model && item.status === 'active')) {
        throw sirayError('sirayUnavailable', request.body.model);
      }
    }
    const created = await sirayFetch(apiKey, route, { fetchImpl, envelope: true, method: 'POST', body: JSON.stringify(request.body) });
    // Do not mistake a request_uuid (support ID) for a generation task ID.
    taskId = [created?.data?.task_id, created?.task_id].find(id => typeof id === 'string' && id.trim());
    if (!taskId) {
      // Keep diagnostics useful without logging prompts, media, credentials or account data.
      const diagnostic = JSON.stringify({
        fields: Object.keys(created || {}),
        dataFields: created?.data && typeof created.data === 'object' ? Object.keys(created.data) : [],
        code: created?.code,
        message: String(created?.message || '').slice(0, 300),
        request_uuid: created?.request_uuid
      }).replaceAll(apiKey, '[redacted]').slice(0, 1000);
      throw sirayError('sirayMissingTask', diagnostic);
    }
    // Persist before polling. Never resubmit an uncertain or timed-out POST.
    await onTask?.(taskId);
  }
  const deadline = Date.now() + 45 * 60 * 1000;
  while (Date.now() < deadline) {
    const task = await sirayFetch(apiKey, `${route}/${encodeURIComponent(taskId)}`, { fetchImpl });
    const status = String(task?.status || '').trim().toUpperCase();
    if (status === 'FAILURE') {
      await onFailed?.(taskId);
      throw sirayError('sirayRequest', String(task.fail_reason || task.fail_code || 'FAILURE').replaceAll(apiKey, '[redacted]').slice(0, 500));
    }
    if (status === 'SUCCESS') {
      if (!task.outputs?.length) throw sirayError('sirayRequest', 'Missing outputs');
      const outputs = [];
      for (const url of task.outputs) {
        if (typeof url !== 'string' || !url.startsWith('https://')) throw sirayError('sirayRequest', 'Invalid output URL');
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(600000) });
        if (!response.ok) throw sirayError('sirayRequest', `Download HTTP ${response.status}`);
        outputs.push({ buffer: Buffer.from(await response.arrayBuffer()), mime: response.headers.get('content-type')?.split(';')[0] || (options.model.durations ? 'video/mp4' : 'image/png') });
      }
      return { outputs, taskId, usage: task.usage || null };
    }
    await sleep(5000);
  }
  throw sirayError('sirayPending', taskId);
}
