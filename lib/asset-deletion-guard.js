import path from 'node:path';

// Normalize equivalent spellings accepted by the asset resolver. Never filter
// references by NSFW visibility: hidden entities also protect their files.
const identity = key => path.posix.normalize(String(key || '').replace(/\\/g, '/')).toLowerCase();

export function protectedAssetKeys(keys, { characters = [], elements = [], characterLinks = [], elementLinks = [] } = {}) {
  const protectedKeys = new Set();
  const add = key => { if (key) protectedKeys.add(identity(key)); };
  for (const link of characterLinks) add(link.key);
  const objects = new Set(elements.filter(item => item.kind === 'object').map(item => item.id));
  for (const link of elementLinks) if (!objects.has(link.elementId)) add(link.key);
  for (const entity of [...characters, ...elements.filter(item => item.kind !== 'object')]) {
    for (const record of [entity, ...(entity.variants || [])]) {
      for (const key of record.photos || []) add(key);
      for (const key of record.assetKeys || []) add(key);
      add(record.sheet);
      add(record.heygen?.imageKey);
      for (const detail of record.distinctiveElements || []) add(detail.imageKey);
    }
  }
  return [...new Set(keys)].filter(key => protectedKeys.has(identity(key)));
}
