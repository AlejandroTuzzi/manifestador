// Direct Alibaba Model Studio integration. No third-party relay or SDK required.
// https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const QWEN_ENDPOINT = 'https://dashscope-intl.aliyuncs.com';
const TIMEOUT = 600_000;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.gif': 'image/gif' };

function fail(code, detail = '') {
  return Object.assign(new Error(`Qwen: ${detail || code}`), {
    localizationCode: code, localizationDetails: { detail }
  });
}

export function qwenEndpoint(value = QWEN_ENDPOINT) {
  let url;
  try { url = new URL(value || QWEN_ENDPOINT); } catch { throw fail('qwenEndpoint'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.aliyuncs.com') || url.username || url.password || url.port) throw fail('qwenEndpoint');
  return url.origin;
}

export function qwenImageSize(aspectRatio = '1:1', resolution = '1K') {
  const match = /^(\d+):(\d+)$/.exec(aspectRatio);
  const ratio = match ? Number(match[1]) / Number(match[2]) : 0;
  if (!Number.isFinite(ratio) || ratio < 1 / 8 || ratio > 8 || !['1K', '2K'].includes(resolution)) throw fail('qwenSize');
  const area = (resolution === '2K' ? 2048 : 1024) ** 2;
  // Round down to multiples of 16 to stay inside the pixel-area limit.
  let width = Math.floor(Math.sqrt(area * ratio) / 16) * 16;
  let height = Math.floor(Math.sqrt(area / ratio) / 16) * 16;
  width = Math.min(width, height * 8);
  height = Math.min(height, width * 8);
  return `${width}*${height}`;
}

export function normalizeQwenOptions(value = {}) {
  const rawSeed = value?.seed;
  const seed = rawSeed === '' || rawSeed === null || rawSeed === undefined ? null : Number(rawSeed);
  if (seed !== null && (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)) throw fail('qwenSeed');
  const promptExtend = value?.promptExtend !== false;
  return {
    negativePrompt: String(value?.negativePrompt || '').trim(), seed,
    promptExtend, promptExtendMode: value?.promptExtendMode === 'agent' ? 'agent' : 'direct',
    thinking: promptExtend && value?.thinking !== false
  };
}

async function imageData(ref) {
  let mime, buffer;
  if (String(ref).startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(ref);
    if (!match) throw fail('qwenReference');
    mime = match[1]; buffer = Buffer.from(match[2], 'base64');
  } else {
    mime = MIME[path.extname(ref).toLowerCase()];
    if (!mime) throw fail('qwenReference');
    buffer = await readFile(ref);
  }
  if (!Object.values(MIME).includes(mime) || !buffer.length || buffer.length > 10 * 1024 * 1024) throw fail('qwenReference');
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export async function generateQwenImage({ apiKey, endpoint, prompt, preface = '', refPaths = [], aspectRatio = '1:1', resolution = '1K', count = 1, options = {} }) {
  if (!apiKey) throw fail('qwenKey');
  if (!String(prompt || '').trim()) throw fail('qwenPrompt');
  if (refPaths.length > 3) throw fail('qwenReferences');
  if (!Number.isInteger(count) || count < 1 || count > 6) throw fail('qwenCount');
  const base = qwenEndpoint(endpoint);
  const opts = normalizeQwenOptions(options);
  if (opts.promptExtend && opts.promptExtendMode === 'agent' && refPaths.length) throw fail('qwenAgentReferences');
  const content = await Promise.all(refPaths.map(async (ref) => ({ image: await imageData(ref) })));
  content.push({ text: [preface, prompt].filter(Boolean).join('\n\n') });
  const parameters = {
    size: qwenImageSize(aspectRatio, resolution), n: count, watermark: false,
    prompt_extend: opts.promptExtend, prompt_extend_mode: opts.promptExtend ? opts.promptExtendMode : 'direct',
    enable_thinking: opts.thinking,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    ...(opts.seed !== null ? { seed: opts.seed } : {})
  };
  const redact = (value) => String(value || '').replaceAll(apiKey, '[redacted]').slice(0, 600);
  try {
    const response = await fetch(`${base}/api/v1/services/aigc/multimodal-generation/generation`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen-image-3.0-pro', input: { messages: [{ role: 'user', content }] }, parameters })
    });
    const raw = await response.text();
    let body;
    try { body = JSON.parse(raw); } catch { throw fail('qwenRequest', `HTTP ${response.status}: ${redact(raw)}`); }
    if (!response.ok || body.code || body.error) {
      const code = body.code || body.error?.code || '';
      const detail = redact(`${code} ${body.message || body.error?.message || `HTTP ${response.status}`}`);
      if (/DataInspection|Forbidden|Inappropriate/i.test(code)) throw fail('qwenModeration', detail);
      throw fail('qwenRequest', detail);
    }
    const urls = (body.output?.choices || []).flatMap((choice) => choice.message?.content || []).map((item) => item.image).filter(Boolean);
    if (!urls.length) throw fail('qwenEmpty');
    const outputs = [];
    for (const url of urls) {
      // Never forward the API key to an output storage URL.
      if (!/^https:\/\//.test(url)) throw fail('qwenRequest', 'Invalid output URL');
      const download = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
      if (!download.ok) throw fail('qwenRequest', `Download HTTP ${download.status}`);
      const buffer = Buffer.from(await download.arrayBuffer());
      if (!buffer.length) throw fail('qwenEmpty');
      outputs.push({ buffer, mime: 'image/png' });
    }
    return outputs;
  } catch (error) {
    if (error.localizationCode) throw error;
    throw fail(error.name === 'TimeoutError' ? 'qwenTimeout' : 'qwenRequest', redact(error.message));
  }
}
