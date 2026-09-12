export const RATING_FIELDS = ['rating', 'consistency', 'quality', 'continuity', 'narrative', 'sound'];

export function inspirationError(code, status = 400) {
  return Object.assign(new Error(code), { status, localizationCode: code });
}

export function inspirationUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw 0;
    return url.href;
  } catch { throw inspirationError('inspirationUrl'); }
}

export function visibleInspiration(store, enabled, metadata = {}) {
  const producers = (store.producers || []).filter(item => enabled || !item.nsfw);
  const hidden = new Set((store.producers || []).filter(item => !enabled && item.nsfw).map(item => item.id));
  const entries = (store.entries || []).filter(item => enabled || (!item.nsfw && !metadata[item.imageKey]?.nsfw && !hidden.has(item.producerId)));
  return { entries, producers };
}

// Both collections share one locked JSON write, including producer unlinking.
export function changeInspiration(store, kind, method, id, body, { now = Date.now(), nsfwEnabled = false } = {}) {
  if (!['entries', 'producers'].includes(kind) || !['POST', 'PUT', 'DELETE'].includes(method)) throw inspirationError('inspirationNotFound', 404);
  const next = { entries: [...(store.entries || [])], producers: [...(store.producers || [])] };
  const previous = next[kind].find(item => item.id === id);
  const visible = visibleInspiration(next, nsfwEnabled)[kind].some(item => item.id === id);
  if (method !== 'POST' && (!previous || !visible)) throw inspirationError('inspirationNotFound', 404);
  if (method === 'POST' && previous) throw inspirationError('inspirationDuplicate');
  if (method === 'DELETE') {
    next[kind] = next[kind].filter(item => item.id !== id);
    if (kind === 'producers') next.entries = next.entries.map(item => item.producerId === id ? { ...item, producerId: '', updatedAt: now } : item);
    return next;
  }
  const input = { ...previous, ...body };
  const text = (field, max = 10000) => String(input[field] ?? '').trim().slice(0, max);
  const item = { id, ...(previous?.importIds ? { importIds: previous.importIds } : {}), description: text('description'), url: inspirationUrl(input.url), nsfw: input.nsfw === true, ts: previous?.ts ?? now, updatedAt: now };
  if (item.nsfw && !nsfwEnabled) throw inspirationError('inspirationNsfw', 403);
  if (kind === 'producers') {
    item.name = text('name', 160);
    if (!item.name) throw inspirationError('inspirationName');
    if (next.producers.some(p => p.id !== id && p.name.toLowerCase() === item.name.toLowerCase())) throw inspirationError('inspirationDuplicate');
  } else {
    item.title = text('title', 200);
    if (!item.title) throw inspirationError('inspirationTitle');
    item.genre = text('genre', 100);
    for (const field of ['episodeCount', 'episodeDurationMinutes']) {
      const value = input[field];
      if (value === undefined || value === null || value === '') { item[field] = null; continue; }
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (field === 'episodeCount' && !Number.isSafeInteger(value))) throw inspirationError('inspirationEpisodes');
      item[field] = value;
    }
    item.appreciation = text('appreciation');
    item.producerId = text('producerId', 100);
    if (item.producerId && !visibleInspiration(next, nsfwEnabled).producers.some(p => p.id === item.producerId)) throw inspirationError('inspirationProducer');
    item.imageKey = text('imageKey', 500);
    if (item.imageKey && (!/^(uploads|generated)\/[\w .\/-]+\.(png|jpe?g|webp)$/i.test(item.imageKey) || item.imageKey.includes('..'))) throw inspirationError('inspirationImage');
    item.tags = [];
    const seen = new Set();
    for (const tag of Array.isArray(input.tags) ? input.tags : []) {
      const value = String(tag).trim().slice(0, 100);
      if (value && !seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); item.tags.push(value); }
      if (item.tags.length === 50) break;
    }
    for (const field of RATING_FIELDS) {
      const value = input[field] ?? 3;
      if (!Number.isInteger(value) || value < 1 || value > 5) throw inspirationError('inspirationRating');
      item[field] = value;
    }
  }
  next[kind] = method === 'POST' ? [item, ...next[kind]] : next[kind].map(old => old.id === id ? item : old);
  return next;
}
