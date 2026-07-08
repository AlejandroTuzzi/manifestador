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
    'seedream-5-lite':    { '2K': 0.025, '4K': 0.05 }
  },
  audio: {
    // USD por cada 1000 caracteres
    'eleven-v3': { per1kChars: 0.15 }
  },
  translate: {
    // USD por cada 1000 caracteres traducidos (Gemini Flash Lite, casi gratis)
    per1kChars: 0.0002
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
  out.audio = { 'eleven-v3': { ...base.audio['eleven-v3'], ...(saved.audio?.['eleven-v3'] || {}) } };
  out.translate = { ...base.translate, ...(saved.translate || {}) };
  return out;
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
