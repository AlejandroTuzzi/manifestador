// Adds or removes a character from series or projects. Only the ids listed in
// `changes` ({ id: true|false }) are touched, and completed (archived) items
// keep their closed associations.
export function applyCharacterMemberships(items, characterId, changes, { touchedAt = null } = {}) {
  const wanted = changes && typeof changes === 'object' && !Array.isArray(changes) ? changes : {};
  const changed = [];
  const next = (Array.isArray(items) ? items : []).map((item) => {
    if (item.archived || !Object.prototype.hasOwnProperty.call(wanted, item.id)) return item;
    const ids = Array.isArray(item.characterIds) ? item.characterIds : [];
    const include = wanted[item.id] === true;
    if (ids.includes(characterId) === include) return item;
    const updated = {
      ...item,
      characterIds: include ? [...ids, characterId] : ids.filter((id) => id !== characterId),
      ...(touchedAt ? { updatedAt: touchedAt } : {})
    };
    changed.push(updated);
    return updated;
  });
  return { items: next, changed };
}
