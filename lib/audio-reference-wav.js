import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Convert bytes, not just the MIME/extension. Originals and asset keys stay intact.
export async function withWavAudioReferences(options, { enabled = true, convert }, send) {
  const refs = options.mediaRefs || [];
  if (!enabled || options.taskId || !refs.some(ref => ref.kind === 'audio' && /\.mp3$/i.test(ref.path || ''))) return send(options);
  const directory = await mkdtemp(path.join(tmpdir(), 'manifestador-audio-ref-'));
  try {
    const mediaRefs = [];
    const converted = new Map();
    for (const ref of refs) {
      if (ref.kind !== 'audio' || !/\.mp3$/i.test(ref.path || '')) { mediaRefs.push(ref); continue; }
      let target = converted.get(ref.path);
      if (!target) {
        target = path.join(directory, `${converted.size}.wav`);
        await convert(ref.path, target);
        converted.set(ref.path, target);
      }
      mediaRefs.push({ ...ref, path: target });
    }
    return await send({ ...options, mediaRefs });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
