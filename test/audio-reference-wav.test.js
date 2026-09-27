import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { withWavAudioReferences } from '../lib/audio-reference-wav.js';

test('disabled conversion, WAV inputs and resumed tasks are passed through unchanged', async () => {
  for (const [options, enabled] of [
    [{ mediaRefs: [{ kind: 'audio', path: 'voice.mp3' }] }, false],
    [{ mediaRefs: [{ kind: 'audio', path: 'voice.wav' }] }, true],
    [{ taskId: 'existing', mediaRefs: [{ kind: 'audio', path: 'voice.mp3' }] }, true]
  ]) {
    await withWavAudioReferences(options, { enabled, convert: () => assert.fail('Unexpected conversion') }, prepared => assert.equal(prepared, options));
  }
});

test('conversion preserves references/order, deduplicates paths and cleans up after a provider error', async () => {
  const options = { mediaRefs: [{ kind: 'image', path: 'image.png' }, { key: 'audio/original.mp3', kind: 'audio', path: 'original.MP3' }, { kind: 'audio', path: 'original.MP3' }] };
  let wav, count = 0;
  await assert.rejects(withWavAudioReferences(options, { convert: async (source, target) => {
    count++; wav = target; await writeFile(target, 'wav fixture');
  } }, async prepared => {
    assert.equal(prepared.mediaRefs[0].path, 'image.png');
    assert.equal(prepared.mediaRefs[1].key, 'audio/original.mp3');
    assert.equal(prepared.mediaRefs[1].path, prepared.mediaRefs[2].path);
    await access(wav);
    throw new Error('Provider failed');
  }), /Provider failed/);
  assert.equal(count, 1);
  assert.equal(options.mediaRefs[1].path, 'original.MP3');
  await assert.rejects(access(wav));
});

test('conversion errors never submit a request and leave no temporary file', async () => {
  let target;
  await assert.rejects(withWavAudioReferences({ mediaRefs: [{ kind: 'audio', path: 'broken.mp3' }] }, {
    convert: async (_, file) => { target = file; await writeFile(file, 'partial'); throw new Error('Conversion failed'); }
  }, () => assert.fail('Must not submit')), /Conversion failed/);
  await assert.rejects(access(target));
});

const ffmpeg = process.env.TEST_FFMPEG || 'C:/ffmpeg/bin/ffmpeg.exe';
test('FFmpeg creates genuine PCM WAV bytes and leaves original MP3 intact', { skip: !existsSync(ffmpeg) }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'manifestador-wav-test-'));
  try {
    const original = path.join(directory, 'original.mp3');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.1', '-c:a', 'libmp3lame', original], { windowsHide: true });
    const before = await readFile(original);
    let converted;
    await withWavAudioReferences({ mediaRefs: [{ kind: 'audio', path: original }] }, {
      convert: async (source, target) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', source, '-vn', '-map', '0:a:0', '-c:a', 'pcm_s16le', '-ar', '44100', target], { windowsHide: true })
    }, async prepared => {
      converted = prepared.mediaRefs[0].path;
      const wav = await readFile(converted);
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
      assert.match(converted, /\.wav$/);
    });
    assert.deepEqual(await readFile(original), before);
    await assert.rejects(access(converted));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
