export function openAIImageOptions(value = {}, apiModel = '', resolution = '1K') {
  const modern = apiModel.startsWith('gpt-image-2.5-');
  const qualities = modern ? ['auto','low','medium','high','xhigh','max'] : ['auto','low','medium','high'];
  return {
    quality: qualities.includes(value?.quality) ? value.quality : resolution === '1K' ? 'medium' : 'high',
    background: modern && value?.background === 'transparent' ? 'transparent' : 'opaque',
    output_format: 'png'
  };
}
export function openAIImageUsageCost(usage) {
  if (!usage || !Number.isFinite(usage.output_tokens)) return null;
  const details = usage.input_tokens_details || {};
  if (!Number.isFinite(details.image_tokens) || !Number.isFinite(details.text_tokens)) return null;
  // Uncached rates give a conservative estimate when cached breakdown is absent.
  return (details.image_tokens * 8 + details.text_tokens * 5 + usage.output_tokens * 30) / 1e6;
}
