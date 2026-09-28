// Siray OpenAPI snapshots checked 2026-09-27. Keep provider separate from UI family.
import schemas from './siray-schemas.json' with { type: 'json' };

const definition = (id, name, family, routes, extra = {}) => {
  const schema = schemas[routes.text];
  const refs = schemas[routes.reference || routes.edit]?.properties || {};
  const limits = { image: refs.images?.maxItems || 0, video: refs.videos?.maxItems || 0, audio: refs.audios?.maxItems || 0 };
  limits.total = limits.image + limits.video + limits.audio;
  const video = Boolean(schema.properties.duration);
  return {
    id: `siray-${id}`, name, family, provider: 'siray', keyName: 'siray', routes,
    apiModel: schema.properties.model.enum[0],
    sirayFields: Object.fromEntries(['seed', 'prompt_expansion_enable', 'output_format', 'task_type'].filter(key => schema.properties[key] || refs[key]).map(key => [key, schema.properties[key] || refs[key]])),
    aspectRatios: schema.properties.aspect_ratio?.enum || ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    resolutions: schema.properties.size.enum, maxRefs: limits.total, minRefs: 0, notes: '',
    ...(video ? {
      durations: schema.properties.duration.enum, mediaLimits: limits,
      refLimits: { reference: limits.total, first: 1, frames: schemas[routes.first]?.properties.end_image ? 2 : 0 },
      modes: ['reference', 'first', ...(schemas[routes.first]?.properties.end_image ? ['frames'] : [])],
      supportsMultimediaReferences: true, audio: true, nativeAudio: true,
      alwaysAudio: !schema.properties.audio_enable
    } : { maxBatch: schema.properties.n?.maximum || 4 }),
    ...extra
  };
};
const videoRoutes = (prefix, suffix = 'spicy') => ({ text: `${prefix}-t2v-${suffix}`, first: `${prefix}-i2v-${suffix}`, reference: `${prefix}-ref2v-${suffix}` });
export const SIRAY_VIDEO_MODELS = [
  definition('seedance-2-5-spicy', 'Seedance 2.5 Spicy', 'Seedance', videoRoutes('seedance-2.5')),
  definition('wan-3-prime-spicy', 'Wan 3.0 Prime Spicy', 'Wan', videoRoutes('wan-3.0', 'prime-spicy')),
  definition('wan-3-spicy', 'Wan 3.0 Spicy', 'Wan', videoRoutes('wan-3.0')),
  definition('minimax-h3-spicy', 'MiniMax H3 Spicy', 'MiniMax', videoRoutes('minimax-h3'))
];
export const SIRAY_IMAGE_MODELS = [
  definition('qwen-image-3-pro-spicy', 'Qwen Image 3 Pro Spicy', 'Qwen', { text: 'qwen-image-3-pro-t2i-spicy', edit: 'qwen-image-3-pro-edit-spicy' }),
  definition('seedream-5-pro-spicy', 'Seedream 5.0 Pro Spicy', 'Seedream', { text: 'seedream-5.0-pro-t2i-spicy', edit: 'seedream-5.0-pro-i2i-spicy' }, { aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], resolutions: ['1K', '2K'] }),
  definition('z-image-pro-spicy', 'Z-Image Pro Spicy', 'Z-Image', { text: 'z-image-spicy-pro-t2i' }, { aspectRatios: ['4:3', '3:4', '1:1', '2:3', '3:2', '16:9', '9:16'], resolutions: ['auto'], availabilityUnverified: true }),
  // Wan Image 2.7 is a distinct image family, not the superseded video model.
  definition('wan-image-2-7-pro-spicy', 'Wan Image 2.7 Pro Spicy', 'Wan', { text: 'wan-2.7-image-pro-t2i-spicy', edit: 'wan-2.7-image-pro-i2i-spicy' }, { availabilityUnverified: true })
];
export { schemas as SIRAY_SCHEMAS };
export function sirayAutomationModel(generator) {
  return SIRAY_VIDEO_MODELS.find(model => model.id === ({ seedance25: 'siray-seedance-2-5-spicy', h3: 'siray-minimax-h3-spicy', wan: 'siray-wan-3-spicy', 'wan-prime': 'siray-wan-3-prime-spicy' })[generator]);
}
