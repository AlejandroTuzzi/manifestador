// Precios estimados por generación (USD). Son valores de referencia:
// se pueden editar a mano en la sección Consumo o actualizar con OpenAI,
// que rastrea la web buscando cambios de precio.

export const DEFAULT_PRICING = {
  updatedAt: null,
  note: 'Valores iniciales estimados — actualizalos con el botón de OpenAI o a mano.',
  image: {
    // modelId → precio por imagen según resolución
    'nano-banana-pro':    { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
    'nano-banana-2':      { '1K': 0.067, '2K': 0.067, '4K': 0.134 },
    'nano-banana-2-lite': { '1K': 0.02 },
    'seedream-5-lite':    { '2K': 0.025, '4K': 0.05 },
    // 1K va con calidad media; 2K/4K con alta (el precio escala con los píxeles) — estimados
    'gpt-image-2':        { '1K': 0.055, '2K': 0.42, '4K': 0.85 }
  },
  video: {
    // modelId → USD por segundo de video según resolución (BytePlus ModelArk).
    // Estimados: verificá el precio real en la consola de BytePlus y ajustá acá.
    'seedance-2':      { '480p': 0.031, '720p': 0.07, '1080p': 0.157 },
    'seedance-2-mini': { '480p': 0.01, '720p': 0.023 }
  },
  audio: {
    // USD por cada 1000 caracteres
    'eleven-v3': { per1kChars: 0.15 }
  },
  translate: {
    // USD por cada 1000 caracteres traducidos (Gemini Flash Lite, casi gratis)
    per1kChars: 0.02
  },
  script: {
    // USD por cada 1000 tokens del guionista IA (OpenAI, estimado mezclando input/output)
    per1kTokens: 0.001
  }
};

export function mergePricing(saved) {
  const base = structuredClone(DEFAULT_PRICING);
  if (!saved) return base;
  const out = { ...base, ...saved };
  out.image = { ...base.image };
  for (const [k, v] of Object.entries(saved.image || {})) {
    if (base.image[k]) out.image[k] = { ...base.image[k], ...v };
  }
  out.video = { ...base.video };
  for (const [k, v] of Object.entries(saved.video || {})) {
    if (base.video[k]) out.video[k] = { ...base.video[k], ...v };
  }
  out.audio = { 'eleven-v3': { ...base.audio['eleven-v3'], ...(saved.audio?.['eleven-v3'] || {}) } };
  out.translate = { ...base.translate, ...(saved.translate || {}) };
  out.script = { ...base.script, ...(saved.script || {}) };
  return out;
}

export function videoPrice(pricing, modelId, resolution) {
  const table = pricing.video?.[modelId] || {};
  return table[resolution] ?? Object.values(table)[0] ?? 0;
}

export function imagePrice(pricing, modelId, resolution) {
  const table = pricing.image[modelId] || {};
  return table[resolution] ?? table.auto ?? table['1K'] ?? Object.values(table)[0] ?? 0;
}

export function audioPrice(pricing, chars) {
  const per1k = pricing.audio['eleven-v3']?.per1kChars ?? 0;
  return (chars / 1000) * per1k;
}

export function translatePrice(pricing, chars) {
  return (chars / 1000) * (pricing.translate?.per1kChars ?? 0);
}

export function scriptPrice(pricing, tokens) {
  return (tokens / 1000) * (pricing.script?.per1kTokens ?? 0);
}
