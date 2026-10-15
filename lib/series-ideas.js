const text = (value, max = 20000) => String(value ?? '').trim().slice(0, max);
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
    characters: (Array.isArray(body.characters) ? body.characters : []).slice(0, 100).map(character =>
      Object.fromEntries(['name', 'sex', 'physical', 'profession', 'relationships', 'role', 'description', 'emotionalLever'].map(field => [field, text(character?.[field], 5000)])))
  };
  data[kind] = method === 'POST' ? [...data[kind], item] : data[kind].map(old => old.id === id ? item : old);
  return data;
}
