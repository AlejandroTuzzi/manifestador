const text = (value, max = 20000) => String(value ?? '').trim().slice(0, max);
export function normalizeIdeaOutline(value = {}) {
  if (!value || typeof value !== 'object') throw new Error('Invalid outline');
  const episodes = value.episodes ?? [], ranges = value.ranges ?? [];
  if (!Array.isArray(episodes) || episodes.length > 200 || !Array.isArray(ranges) || ranges.length > 100) throw new Error('Invalid outline');
  return {
    episodes: episodes.map(episode => {
      const duration = episode?.duration === '' || episode?.duration == null ? null : Number(episode.duration);
      if (!episode || !text(episode.name, 200) || (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > 1440))) throw new Error('Invalid outline');
      return {name:text(episode.name,200),description:text(episode.description),duration};
    }),
    ranges: ranges.map(range => {
      const start = Number(range?.start), end = Number(range?.end);
      if (!text(range?.name,200) || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > episodes.length) throw new Error('Invalid outline');
      return {name:text(range.name,200),start,end};
    })
  };
}
export function changeIdeas(current, kind, method, id, body) {
  const data = { entries: current.entries || [], categories: current.categories || [] };
  if (!['entries', 'categories'].includes(kind)) throw new Error('Invalid collection');
  if (method !== 'POST' && !data[kind].some(item => item.id === id)) throw new Error('Not found');
  if (method === 'DELETE') {
    data[kind] = data[kind].filter(item => item.id !== id);
    if (kind === 'categories') data.entries = data.entries.map(item => item.categoryId === id ? { ...item, categoryId: '' } : item);
    return data;
  }
  const name = text(body.name, 200);
  if (!name) throw new Error('Name required');
  if (kind === 'categories' && data.categories.some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) throw new Error('Duplicate category');
  const item = kind === 'categories' ? { id, name } : {
    id, name, categoryId: data.categories.some(c => c.id === body.categoryId) ? body.categoryId : '',
    development: text(body.development), nsfw: body.nsfw === true,
    outline: normalizeIdeaOutline(body.outline ?? data.entries.find(entry => entry.id === id)?.outline ?? {}),
    characters: (Array.isArray(body.characters) ? body.characters : []).slice(0, 100).map(character =>
      Object.fromEntries(['name', 'sex', 'physical', 'profession', 'relationships', 'role', 'description', 'emotionalLever'].map(field => [field, text(character?.[field], 5000)])))
  };
  data[kind] = method === 'POST' ? [...data[kind], item] : data[kind].map(old => old.id === id ? item : old);
  return data;
}
