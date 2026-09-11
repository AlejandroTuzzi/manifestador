import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

// Hash only on demand; reopening the gallery doesn't reread unchanged files.
// Stream files instead of decoding images or generating thumbnails.
export function createPhotoIdentityCache(resolveKey, { maxEntries = 1024 } = {}) {
  const cache = new Map();
  return async (key) => {
    try {
      const filename = await resolveKey(key);
      const info = await stat(filename);
      const signature = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      const previous = cache.get(filename);
      if (previous?.signature === signature) return await previous.digest;
      const digest = (async () => {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(filename)) hash.update(chunk);
        return `sha256:${hash.digest('hex')}`;
      })();
      const entry = { signature, digest };
      cache.set(filename, entry);
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      try { return await digest; }
      catch (error) { if (cache.get(filename) === entry) cache.delete(filename); throw error; }
    } catch {
      // An unavailable photo must not hide a different photo or break the gallery.
      return `key:${key}`;
    }
  };
}

export async function uniqueCharacterGallery(character, identify, { nsfwEnabled = false } = {}) {
  const sources = [{ id: null, name: '', description: character.description || '', photos: character.photos || [] },
    ...(character.variants || []).filter((variant) => nsfwEnabled || !variant.nsfw)];
  const seen = new Map(), keys = new Map(), groups = [];
  for (const source of sources) {
    const group = { id: source.id, name: source.name, description: source.description || '', photos: [] };
    for (const key of source.photos || []) {
      if (typeof key !== 'string' || !key) continue;
      const identity = keys.get(key) || await identify(key);
      keys.set(key, identity);
      let photo = seen.get(identity);
      if (!photo) {
        photo = { key, groups: [] };
        seen.set(identity, photo);
        group.photos.push(photo);
      }
      if (!photo.groups.some((item) => item.id === source.id)) photo.groups.push({ id: source.id, name: source.name });
    }
    // Don't show a misleading "no photos" section for a fully duplicated outfit.
    if (group.photos.length || !(source.photos || []).length) groups.push(group);
  }
  return groups;
}
