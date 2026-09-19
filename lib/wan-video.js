// Alibaba Model Studio, direct asynchronous Wan 3 API (no intermediary).
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { qwenEndpoint } from './qwen-image.js';

export function wanError(code, detail = '') {
  return Object.assign(new Error(`Wan: ${detail || code}`), { localizationCode: code, localizationDetails: { detail } });
}

export function wanParameters({ resolution = '720P', aspectRatio = '16:9', duration = 5, audio = true, options = {} } = {}) {
  const seed = options.seed === '' || options.seed == null ? -1 : Number(options.seed);
  if (!['480P', '720P', '1080P'].includes(resolution)
    || !['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(aspectRatio)
    || !Number.isInteger(duration) || (duration !== -1 && (duration < 2 || duration > 30))
    || !Number.isInteger(seed) || seed < -1 || seed > 2147483647) throw wanError('wanParameters');
  return { resolution, ratio: aspectRatio, duration, audio: Boolean(audio), seed,
    prompt_extend: options.promptExtend !== false, watermark: options.watermark === true };
}

const FORMATS = { image: ['.jpg', '.jpeg', '.png', '.webp', '.bmp'], video: ['.mp4', '.mov'], audio: ['.mp3', '.wav'] };
const MAX_MB = { image: 20, video: 100, audio: 15 };

export async function validateWanMedia(refs, { mode = 'reference', duration = 5, probeDuration, probeDimensions } = {}) {
  const counts = { image: 0, video: 0, audio: 0 }, totals = { video: 0, audio: 0 };
  for (const ref of refs) {
    if (!(ref.kind in counts)) throw wanError('wanReferences');
    counts[ref.kind]++;
    if (String(ref.path).startsWith('data:')) {
      if (ref.kind !== 'image' || !/^data:image\/(jpeg|png|webp|bmp);base64,/.test(ref.path)
        || Buffer.from(ref.path.split(',')[1] || '', 'base64').length > 20 * 1024 * 1024) throw wanError('wanReferences');
      continue;
    }
    if (!FORMATS[ref.kind].includes(path.extname(ref.path).toLowerCase())) throw wanError('wanFormat');
    const info = await stat(ref.path);
    if (!info.isFile() || !info.size || info.size > MAX_MB[ref.kind] * 1024 * 1024) throw wanError('wanSize');
    if (ref.kind !== 'image') {
      const seconds = await probeDuration?.(ref.path);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 15.01) throw wanError('wanDuration');
      totals[ref.kind] += seconds;
    }
    if (ref.kind === 'video') {
      const dims = await probeDimensions?.(ref.path);
      if (!dims || dims.width < 240 || dims.height < 240 || dims.width > 4096 || dims.height > 4096
        || dims.width / dims.height < 1 / 8 || dims.width / dims.height > 8 || !dims.fps || dims.fps < 16) throw wanError('wanVideoDimensions');
    }
  }
  if (counts.image > 10 || counts.video > 5 || counts.audio > 5) throw wanError('wanReferences');
  if (!['reference', 'frames', 'first'].includes(mode)) throw wanError('wanReferences');
  if (mode !== 'reference' && (counts.video || counts.audio || counts.image !== (mode === 'first' ? 1 : 2))) throw wanError('wanFrames');
  if (totals.video > 15.01 || totals.audio > 15.01 || (duration !== -1 && totals.video + duration > 30.01)) throw wanError('wanDuration');
  return totals;
}

export async function generateWanVideo({ apiKey, endpoint, apiModel = 'wan3.0-video', prompt,
  mediaRefs = [], mode = 'reference', aspectRatio, resolution, duration, audio, options = {},
  taskId: existingTaskId, onTask, onFailed, fetchImpl = fetch, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), maxPolls = 240 }) {
  if (!apiKey) throw wanError('qwenKey');
  if (!['wan3.0-video', 'wan3.0-video-prime'].includes(apiModel)) throw wanError('wanParameters');
  const base = qwenEndpoint(endpoint);
  const parameters = wanParameters({ aspectRatio, resolution, duration, audio, options });
  if (!String(prompt || '').trim() || prompt.length > 20000) throw wanError('wanPrompt');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const request = async (url, init = {}) => {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(120000), ...init });
    let body;
    try { body = await response.json(); } catch { throw wanError('wanRequest', `HTTP ${response.status}`); }
    if (!response.ok || body.code) throw Object.assign(wanError('wanRequest', String(body.message || body.code || response.status).replaceAll(apiKey, '[redacted]').slice(0, 500)), { httpStatus: response.status });
    return body;
  };
  let taskId = existingTaskId;
  if (taskId && !/^[a-zA-Z0-9_-]+$/.test(taskId)) throw wanError('wanParameters');
  if (!taskId) {
    const media = [];
    let usesOss = false;
    for (const [index, ref] of mediaRefs.entries()) {
      let url = ref.path;
      if (ref.kind === 'image' && !url.startsWith('data:')) {
        const mime = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.bmp': 'bmp' }[path.extname(url).toLowerCase()];
        url = `data:image/${mime};base64,${(await readFile(url)).toString('base64')}`;
      } else if (ref.kind !== 'image') {
        // Private, model-bound temporary OSS upload. Never send the API key to OSS.
        const policy = (await request(`${base}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(apiModel)}`, { headers })).data;
        let host;
        try { host = new URL(policy?.upload_host); } catch { throw wanError('wanUpload'); }
        if (host.protocol !== 'https:' || !host.hostname.endsWith('.aliyuncs.com') || host.username || host.password || host.port) throw wanError('wanUpload');
        const key = `${policy.upload_dir}/${randomUUID()}${path.extname(ref.path).toLowerCase()}`;
        const form = new FormData();
        for (const [k, v] of Object.entries({ OSSAccessKeyId: policy.oss_access_key_id, Signature: policy.signature,
          policy: policy.policy, 'x-oss-object-acl': policy.x_oss_object_acl, 'x-oss-forbid-overwrite': policy.x_oss_forbid_overwrite,
          key, success_action_status: '200' })) {
          if (v == null) throw wanError('wanUpload');
          form.append(k, v);
        }
        form.append('file', new Blob([await readFile(ref.path)]), path.basename(key));
        const uploaded = await fetchImpl(host.href, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(300000) });
        if (!uploaded.ok) throw wanError('wanUpload');
        url = `oss://${key}`;
        usesOss = true;
      }
      media.push({ type: mode === 'reference' ? `reference_${ref.kind}` : index === 0 ? 'first_frame' : 'last_frame', url });
    }
    const context = String(options.contextUrl || '').trim();
    if (context) {
      let url;
      try { url = new URL(context); } catch { throw wanError('wanContext'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || mode !== 'reference') throw wanError('wanContext');
      media.push({ type: options.contextType === 'file' ? 'file' : 'link', url: url.href });
      parameters.prompt_extend = true;
    }
    const created = await request(`${base}/api/v1/services/aigc/video-generation/video-synthesis`, {
      method: 'POST', headers: { ...headers, 'X-DashScope-Async': 'enable', ...(usesOss ? { 'X-DashScope-OssResourceResolve': 'enable' } : {}) },
      body: JSON.stringify({ model: apiModel, input: { prompt, ...(media.length ? { media } : {}) }, parameters })
    });
    taskId = created.output?.task_id;
    if (!taskId) throw wanError('wanRequest', 'Missing task_id');
    await onTask?.(taskId);
  }
  for (let poll = 0; poll < maxPolls; poll++) {
    let result;
    try { result = await request(`${base}/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers }); }
    catch (error) { if ([400, 401, 403, 404].includes(error.httpStatus) || poll === maxPolls - 1) throw error; await sleep(15000); continue; }
    const status = result.output?.task_status;
    if (status === 'SUCCEEDED') {
      const rawUrl = result.output.video_url;
      let url;
      try { url = new URL(rawUrl); } catch { throw wanError('wanRequest', 'Missing video_url'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw wanError('wanRequest', 'Invalid video_url');
      const downloaded = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(300000) });
      if (!downloaded.ok) throw wanError('wanRequest', `Download HTTP ${downloaded.status}`);
      return { buffer: Buffer.from(await downloaded.arrayBuffer()), taskId, usage: result.usage || {}, finalPrompt: prompt };
    }
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status)) {
      await onFailed?.(taskId);
      throw wanError('wanFailed', String(result.output?.message || status).replaceAll(apiKey, '[redacted]').slice(0, 500));
    }
    await sleep(15000);
  }
  throw wanError('wanPending', taskId);
}
