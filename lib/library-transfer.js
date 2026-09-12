// Conservative identities for portable libraries. Never fuzzy-match or overwrite
// a local record just because a remote description or rating has changed.
export function importName(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function importIds(item) {
  return [...new Set([item?.id, ...(Array.isArray(item?.importIds) ? item.importIds : [])]
    .filter(value => typeof value === 'string' && /^[a-z0-9-]{1,100}$/i.test(value)))].slice(0, 100);
}

export function importMatch(items, source, kind) {
  const ids = new Set(importIds(source));
  const identity = items.find(item => importIds(item).some(id => ids.has(id)));
  if (identity) return identity;
  const named = ['characters', 'producers', 'automations'].includes(kind);
  const title = importName(named ? source.name : source.title);
  if (!title) return undefined;
  return items.find(item => {
    if (importName(named ? item.name : item.title) !== title) return false;
    if (kind === 'vocabulary') return importName(item.category) === importName(source.category);
    if (kind === 'entries') return String(item.producerId || '') === String(source.producerId || '');
    return true;
  });
}

export function rememberImport(item, source) {
  return { ...item, importIds: importIds({ id: item.id, importIds: [...importIds(item), ...importIds(source)] }) };
}
