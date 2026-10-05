export function assertClosedAssociations(previous, next) {
  if (!previous?.archived) return;
  for (const field of ['assetKeys', 'characterIds', 'elementIds', 'objectIds']) {
    const existing = new Set(previous[field] || []);
    if ((next[field] || []).some(id => !existing.has(id))) throw Object.assign(new Error('closedAssociations'), { localizationCode:'closedAssociations', status:409 });
  }
}
