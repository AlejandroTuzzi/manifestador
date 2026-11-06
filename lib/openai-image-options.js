// Limits published in OpenAI's image generation guide (checked 2026-11-05).
const REQUEST_PIXEL_BUDGET = 8294400;
const MAX_EDGE = 3840;
const EDIT_MAX_PIXELS = 16777216;
const EDIT_MAX_BYTES = 50 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isModernOpenAIImage(apiModel = '') {
  return /^gpt-image-2\.[56]-/.test(apiModel);
}

export function openAIImageError(code, detail = '') {
  const error = new Error(`OpenAI: ${detail || code}`);
  error.localizationCode = code;
  error.localizationDetails = { detail };
  return error;
}

export function openAIImageOptions(value = {}, apiModel = '', resolution = '1K') {
  const modern = isModernOpenAIImage(apiModel);
  const latest = apiModel.startsWith('gpt-image-2.6-');
  const qualities = modern ? ['auto','low','medium','high','xhigh','max'] : ['auto','low','medium','high'];
  const format = latest && ['svg', 'gif'].includes(value?.format) ? value.format : 'png';
  const options = {
    quality: qualities.includes(value?.quality) ? value.quality : resolution === '1K' ? 'medium' : 'high',
    output_format: format
  };
  if (format === 'png') options.background = modern && value?.background === 'transparent' ? 'transparent' : 'opaque';
  if (latest && ['low', 'medium', 'high'].includes(value?.complexity)) options.complexity = value.complexity;
  if (format === 'gif') {
    const frames = Math.round(Number(value?.frameCount));
    const duration = Math.round(Number(value?.frameDurationMs) / 10) * 10;
    options.frame_count = Math.max(2, Math.min(16, frames || 9));
    options.frame_duration_ms = Math.max(20, Math.min(2000, duration || 200));
  }
  return options;
}

// The API renders GIF frames on a square grid of tiles, and that whole sheet must fit
// the per-request limits: 9 frames of 720x1280 fit, 9 of 976x976 are refused.
export function openAIGifFrameSize(aspectRatio, frames, resolution) {
  const [a, b] = (aspectRatio && aspectRatio !== 'auto' ? aspectRatio : '1:1').split(':').map(Number);
  const tiles = Math.ceil(Math.sqrt(frames));
  const requested = resolution === '4K' ? REQUEST_PIXEL_BUDGET : resolution === '2K' ? 4194304 : 1048576;
  const area = Math.min(requested, REQUEST_PIXEL_BUDGET / (tiles * tiles));
  const edgeScale = Math.min(1, (MAX_EDGE / tiles) / Math.max(Math.sqrt((area * a) / b), Math.sqrt((area * b) / a)));
  const snap = (value) => Math.max(16, Math.floor((value + 1e-6) / 16) * 16);
  return `${snap(Math.sqrt((area * a) / b) * edgeScale)}x${snap(Math.sqrt((area * b) / a) * edgeScale)}`;
}

// A region edit carries a PNG layer with the same dimensions as the first input image.
export function normalizeOpenAIEdit(value, apiModel, refCount) {
  if (!value) return null;
  const prefix = 'data:image/png;base64,';
  const dataUrl = String(value.layer || '');
  if (!isModernOpenAIImage(apiModel) || !refCount || !['markup', 'mask'].includes(value.mode) || !dataUrl.startsWith(prefix)) {
    throw openAIImageError('openaiEditInvalid');
  }
  const layer = Buffer.from(dataUrl.slice(prefix.length), 'base64');
  if (layer.length < 33 || !layer.subarray(0, 8).equals(PNG_SIGNATURE) || ![4, 6].includes(layer[25])) throw openAIImageError('openaiEditInvalid');
  if (layer.length > EDIT_MAX_BYTES || layer.readUInt32BE(16) * layer.readUInt32BE(20) > EDIT_MAX_PIXELS) throw openAIImageError('openaiEditTooLarge');
  return { mode: value.mode, layer };
}

// Appended to the prompt the same way the Poser instruction is: invisible in the prompt box.
export function openAIEditInstruction(mode) {
  return mode === 'markup'
    ? 'The overlay annotations only show where to apply this change. Do not reproduce them in the finished image, and keep everything else unchanged.'
    : 'Apply this change only inside the masked area and keep everything else unchanged.';
}

export function openAIImageUsageCost(usage) {
  if (!usage || !Number.isFinite(usage.output_tokens)) return null;
  const details = usage.input_tokens_details || {};
  if (!Number.isFinite(details.image_tokens) || !Number.isFinite(details.text_tokens)) return null;
  // Uncached rates give a conservative estimate when cached breakdown is absent.
  return (details.image_tokens * 8 + details.text_tokens * 5 + usage.output_tokens * 30) / 1e6;
}
