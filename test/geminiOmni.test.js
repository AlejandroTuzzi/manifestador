import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { VIDEO_MODELS } from '../lib/models.js';
import { DEFAULT_PRICING } from '../lib/pricing.js';
import { buildGeminiOmniPrompt } from '../lib/providers.js';

describe('Gemini Omni 1.1 Flash', () => {
  test('expone todas las capacidades soportadas por la interfaz', () => {
    const model = VIDEO_MODELS.find((item) => item.id === 'gemini-omni-1-1-flash');
    assert.ok(model);
    assert.deepEqual(model.aspectRatios, ['16:9', '9:16']);
    assert.deepEqual(model.resolutions, ['360p', '720p', '1080p', '4K']);
    assert.deepEqual(model.durations, [3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(model.mediaLimits.audio, 0);
    assert.equal(model.supportsStatefulEditing, true);
    assert.equal(model.inputPricePerMillionTokens, 1.50);
    assert.equal(DEFAULT_PRICING.video[model.id]['720p'], 0.10);
  });

  test('declara referencias con índices base cero y fija duración y silencio', () => {
    const prompt = buildGeminiOmniPrompt({
      prompt: 'A woman enters the room.',
      mediaRefs: [
        { kind: 'image', path: 'subject.png' },
        { kind: 'video', path: 'motion.mp4' }
      ],
      mode: 'reference',
      duration: 7,
      audio: false
    });
    assert.match(prompt, /<IMAGE_REF_0>@Image1/);
    assert.match(prompt, /<VIDEO_REF_0>@Video1/);
    assert.match(prompt, /Exact output duration: 7 seconds/);
    assert.match(prompt, /Produce silent video/);
  });

  test('distingue fotogramas y edición conversacional', () => {
    const frames = buildGeminiOmniPrompt({
      prompt: 'Smooth transition.',
      mediaRefs: [{ kind: 'image' }, { kind: 'image' }],
      mode: 'frames',
      duration: 5
    });
    assert.match(frames, /<FIRST_FRAME>@Image1 <LAST_FRAME>@Image2/);

    const edit = buildGeminiOmniPrompt({
      prompt: 'Change the sky to sunset.',
      mode: 'edit',
      duration: 5,
      previousInteractionId: 'v1_previous'
    });
    assert.match(edit, /Keep everything else the same/);
    assert.doesNotMatch(edit, /VIDEO_0/);
  });

  test('declara un video subido como fuente de extensión y conserva refs nuevas', () => {
    const prompt = buildGeminiOmniPrompt({
      prompt: 'The character enters.',
      mediaRefs: [{ kind: 'video' }, { kind: 'image' }],
      mode: 'extend',
      duration: 10
    });
    assert.match(prompt, /<PREVIOUS_VIDEO>@Video1/);
    assert.match(prompt, /<IMAGE_REF_0>@Image1/);
    assert.match(prompt, /Extend this video seamlessly/);
  });
});
