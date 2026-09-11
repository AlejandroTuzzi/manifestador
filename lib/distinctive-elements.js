import { randomUUID } from 'node:crypto';

export function normalizeDistinctiveElements(items) {
  const invalid = () => { throw new Error('Cada elemento distintivo requiere una imagen válida y un texto.'); };
  if (!Array.isArray(items) || items.length > 40) return invalid();
  const ids = new Set();
  return items.map((item) => {
    if (!item || typeof item !== 'object') return invalid();
    const text = String(item.text || '').trim();
    const imageKey = String(item.imageKey || '').trim();
    if (!text || text.length > 4000 || imageKey.length > 500 || imageKey.includes('..') || imageKey.includes('\\')
      || /[\x00-\x1f]/.test(imageKey) || !/^(generated|uploads|characters|elements)\/.+\.(png|jpe?g|webp)$/i.test(imageKey)) return invalid();
    const id = String(item.id || randomUUID());
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) return invalid();
    ids.add(id);
    return { id, imageKey, text, nsfw: Boolean(item.nsfw) };
  });
}
