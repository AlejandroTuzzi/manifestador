import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { VIDEO_MODELS, getVideoModel } from '../lib/models.js';
import { DEFAULT_PRICING, omniTokenCost, videoPrice } from '../lib/pricing.js';
import { buildGeminiOmniPrompt } from '../lib/providers.js';

const model = VIDEO_MODELS.find((item) => item.id === 'gemini-omni-1-2-flash');

describe('Gemini Omni 1.2 Flash', () => {
  test('expone los límites publicados por Google', () => {
    assert.ok(model);
    assert.equal(model.apiModel, 'gemini-omni-1.2-flash');
    assert.deepEqual(model.aspectRatios, ['16:9', '9:16']);
    assert.deepEqual(model.resolutions, ['360p', '720p', '1080p', '4K']);
    assert.equal(model.durations[0], 3);
    assert.equal(model.durations.at(-1), 15);
    assert.equal(model.durations.length, 13);
    assert.deepEqual(model.modeMaxDuration, { frames: 10, extend: 10 });
    assert.equal(model.mediaLimits.image, 6);
    assert.equal(model.mediaLimits.audio, 0);
    assert.equal(model.omniLimits.editSeconds, 15);
    assert.equal(model.omniLimits.extendTotalSeconds, 30);
    assert.equal(model.omniLimits.longClipVideoRefs, 1);
    assert.equal(model.supportsStatefulEditing, true);
  });

  test('1.1 deja de ofrecerse y sus pedidos resuelven a 1.2', () => {
    assert.equal(VIDEO_MODELS.some((item) => item.id === 'gemini-omni-1-1-flash'), false);
    assert.equal(getVideoModel('gemini-omni-1-1-flash'), model);
    assert.equal(getVideoModel('modelo-inexistente'), null);
  });

  test('cobra los segundos de video más los tokens de entrada y razonamiento', () => {
    assert.equal(DEFAULT_PRICING.video[model.id]['720p'], 0.0695);
    assert.equal(videoPrice(DEFAULT_PRICING, model.id, '360p'), 0.02317);
    assert.equal(videoPrice(DEFAULT_PRICING, model.id, '4K'), 0.20851);
    // Uso real devuelto por una extensión de 3 s a 360p.
    const tokens = omniTokenCost(model, { total_input_tokens: 5842, total_thought_tokens: 1094 });
    assert.ok(Math.abs(tokens - (5842 * 1.5 + 1094 * 9) / 1_000_000) < 1e-9);
    assert.equal(omniTokenCost(model, null), 0);
  });

  test('nombra las referencias en lenguaje natural y respeta su orden', () => {
    const prompt = buildGeminiOmniPrompt({
      prompt: 'Image 1 walks in, moving like Video 1.',
      mediaRefs: [{ kind: 'video' }, { kind: 'image' }, { kind: 'image' }],
      audio: false
    });
    assert.match(prompt, /Attached media, in order: Video 1, Image 1, Image 2\./);
    assert.match(prompt, /Produce silent video/);
    assert.doesNotMatch(prompt, /\[#|<[A-Z_0-9]+>|Exact output duration/);
  });

  test('reescribe las etiquetas obsoletas de prompts guardados', () => {
    const prompt = buildGeminiOmniPrompt({
      prompt: '<IMAGE_REF_0> greets <IMAGE_REF_1> beside <VIDEO_REF_0>, from <FIRST_FRAME> to <LAST_FRAME> in <VIDEO_0>.',
      mediaRefs: [{ kind: 'image' }]
    });
    assert.match(prompt, /Image 1 greets Image 2 beside Video 1, from the first image to the second image in the video\./);
    assert.doesNotMatch(prompt, /</);
  });

  test('distingue fotogramas, edición y extensión', () => {
    const frames = buildGeminiOmniPrompt({ prompt: 'Smooth transition.', mediaRefs: [{ kind: 'image' }, { kind: 'image' }], mode: 'frames' });
    assert.match(frames, /first attached image as the exact first frame/);
    assert.match(frames, /second attached image as the exact last frame/);

    const linkedEdit = buildGeminiOmniPrompt({ prompt: 'Change the sky to sunset.', mode: 'edit' });
    assert.match(linkedEdit, /Keep everything else the same/);
    assert.doesNotMatch(linkedEdit, /Attached media|source video/);

    const uploaded = buildGeminiOmniPrompt({ prompt: 'The character enters.', mediaRefs: [{ kind: 'video' }, { kind: 'image' }], mode: 'extend' });
    assert.match(uploaded, /Attached media, in order: Video 1, Image 1\. Video 1 is the source video to extend\./);
    assert.match(uploaded, /continue it seamlessly at its end/);
  });

  test('no envía task ni referencias con el tipo anterior', async () => {
    const source = await readFile(new URL('../lib/providers.js', import.meta.url), 'utf8');
    const start = source.indexOf('export async function generateGeminiOmniVideo');
    const body = source.slice(start, source.indexOf('Seedance 2.5 — integración', start));
    assert.doesNotMatch(body, /video_config:|generation_config:|type: 'document'/);
    assert.match(body, /type: 'video', uri: file\.uri/);
  });

  test('la app sólo ofrece Reescalar sobre resultados vinculados y resoluciones de borrador', async () => {
    const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
    assert.match(app, /canUpscale = canEdit && canContinueOmni\(entry, model\) && \['360p', '720p'\]\.includes\(entry\.resolution\)/);
    assert.doesNotMatch(app, /gemini-omni-1-1-flash|(?:IMAGE|VIDEO)_REF_/);
  });

  test('los textos nuevos existen en ambos idiomas y no citan los límites anteriores', async () => {
    for (const locale of ['es', 'en']) {
      const text = await readFile(new URL(`../public/locales/${locale}.js`, import.meta.url), 'utf8');
      for (const key of ['models.gemini-omni-1-2-flash.notes', 'create.history.omniUpscale', 'create.history.omniUpscaleReady', 'errors.omniEditTooLong', 'errors.omniExtendSourceTooLong', 'errors.omniConversationVideo', 'errors.omniLongClipVideos', 'errors.omniModeDuration', 'create.validation.omniConversationVideo', 'create.validation.omniLongClipVideos']) {
        assert.ok(text.includes(`'${key}'`), `${locale}: falta ${key}`);
      }
      assert.doesNotMatch(text, /gemini-omni-1-1|_REF_0|Omni 1\.1/);
    }
  });
});
