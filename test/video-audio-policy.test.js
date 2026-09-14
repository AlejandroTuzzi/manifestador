import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { videoAudioPolicy } from '../lib/video-audio-policy.js';

test('music avoidance defaults on and explicitly permits opting out', () => {
  assert.equal(videoAudioPolicy(false), '');
  assert.equal(videoAudioPolicy(), videoAudioPolicy(true));
  assert.match(videoAudioPolicy(), /suspense riser/);
  assert.match(videoAudioPolicy(), /Only natural environmental ambience/);
  assert.match(videoAudioPolicy(), /voices or dialogue only when explicitly requested/);
  assert.match(videoAudioPolicy(), /Do not reproduce music from reference media/);
});
test('video request appends policy to sent prompt without replacing the user prompt', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /\[preface, prompt, suffix, videoAudioPolicy\(req.avoidMusic\)\]/);
  const client = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(client, /avoidMusic: state.video.avoidMusic !== false/);
  assert.match(client, /state.video.avoidMusic = entry.avoidMusic !== false/);
});
