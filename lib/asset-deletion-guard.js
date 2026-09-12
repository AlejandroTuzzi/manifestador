import path from 'node:path';

// Normalize equivalent spellings accepted by the asset resolver. Never filter
// references by NSFW visibility: hidden entities also protect their files.
const identity = key => path.posix.normalize(String(key || '').replace(/\\/g, '/')).toLowerCase();

export function protectedAssetAssociations(keys, { characters = [], elements = [], characterLinks = [], elementLinks = [], nsfwEnabled = false } = {}) {
  const protectedKeys = new Map();
  const add = (key, entity, kind, variant) => {
    if (!key) return;
    const hidden = !nsfwEnabled && Boolean(entity?.nsfw || variant?.nsfw);
    const info = { kind, name: hidden ? '' : String(entity?.name || ''), variantName: hidden ? '' : String(variant?.name || ''), hidden };
    const list = protectedKeys.get(identity(key)) || [];
    if (!list.some(item => JSON.stringify(item) === JSON.stringify(info))) list.push(info);
    protectedKeys.set(identity(key), list);
  };
  for (const link of characterLinks) {
    const entity = characters.find(item => item.id === link.characterId);
    add(link.key, entity, 'character', entity?.variants?.find(item => item.id === link.variantId));
  }
  const objects = new Set(elements.filter(item => item.kind === 'object').map(item => item.id));
  for (const link of elementLinks) if (!objects.has(link.elementId)) {
    const entity = elements.find(item => item.id === link.elementId);
    add(link.key, entity, 'location', entity?.variants?.find(item => item.id === link.variantId));
  }
  for (const entity of [...characters, ...elements.filter(item => item.kind !== 'object')]) {
    const kind = characters.includes(entity) ? 'character' : 'location';
    for (const record of [entity, ...(entity.variants || [])]) {
      const protect = key => add(key, entity, kind, record === entity ? undefined : record);
      for (const key of record.photos || []) protect(key);
      for (const key of record.assetKeys || []) protect(key);
      protect(record.sheet);
      protect(record.heygen?.imageKey);
      for (const detail of record.distinctiveElements || []) protect(detail.imageKey);
    }
  }
  return [...new Set(keys)].filter(key => protectedKeys.has(identity(key))).map(key => ({ key, associations: protectedKeys.get(identity(key)) }));
}

export function protectedAssetKeys(keys, data = {}) {
  return protectedAssetAssociations(keys, data).map(item => item.key);
}
