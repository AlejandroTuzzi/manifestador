// Only generation inputs belong in the archive, never API credentials or retry IDs.
const FIELDS = ['modelId', 'prompt', 'text', 'aspectRatio', 'resolution', 'batch', 'refs', 'refKinds',
  'labeledRefs', 'mode', 'duration', 'audio', 'avoidMusic', 'h3ContextIr', 'wanOptions', 'qwenImage', 'openaiImage',
  'omniPreviousInteractionId', 'omniSourceHistoryId', 'heygenAuthMode', 'heygenCharacterId', 'heygenVoiceId',
  'heygenMotionPrompt', 'heygenExpressiveness', 'audioModelId', 'voiceId', 'voiceName',
  'model', 'style', 'title', 'instrumental', 'customMode', 'workflowId', 'customValues', 'referenceTagsEnabled', 'referenceLabels'];
export function generationSettings(kind, body = {}) {
  const request = {};
  for (const field of FIELDS) if (body[field] !== undefined) request[field] = structuredClone(body[field]);
  return { version: 1, kind, request };
}
