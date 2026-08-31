import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { generateFireRed, generateSeedream } from '../lib/providers.js';

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('proveedores de edición de imagen', () => {
  test('Seedream 5 Pro usa resolución nativa y conserva la proporción en el prompt', async () => {
    let requestBody;
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse({ data: [{ b64_json: Buffer.from('seedream-pro').toString('base64') }] });
    };

    const outputs = await generateSeedream({
      apiKey: 'ark-test',
      apiModel: 'dola-seedream-5-0-pro-260628',
      endpoint: 'https://ark.example/api/v3',
      prompt: 'A cinematic portrait',
      preface: '',
      refPaths: [],
      aspectRatio: '9:16',
      resolution: '2K',
      nativeResolutionLevels: true
    });

    assert.equal(requestBody.size, '2K');
    assert.match(requestBody.prompt, /9:16 aspect ratio/);
    assert.equal(requestBody.output_format, 'png');
    assert.equal(outputs[0].buffer.toString(), 'seedream-pro');
  });

  test('FireRed sube referencias, desactiva el filtro adicional y descarga el resultado', async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/media/uploads')) {
        return jsonResponse({ data: {
          download_url: 'https://media.example/reference.png',
          upload: { method: 'PUT', url: 'https://storage.example/upload', headers: { 'Content-Type': 'image/png' } }
        } });
      }
      if (String(url) === 'https://storage.example/upload') return new Response('', { status: 200 });
      if (String(url).endsWith('/wavespeed-ai/firered-image-v1.1/edit')) {
        return jsonResponse({ data: { id: 'prediction-1', status: 'created' } });
      }
      if (String(url).endsWith('/predictions/prediction-1/result')) {
        return jsonResponse({ data: { id: 'prediction-1', status: 'completed', outputs: ['https://media.example/output.png'] } });
      }
      if (String(url) === 'https://media.example/output.png') {
        return new Response(Buffer.from('firered-result'), { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      throw new Error(`URL inesperada: ${url}`);
    };

    const outputs = await generateFireRed({
      apiKey: 'wavespeed-test',
      apiModel: 'wavespeed-ai/firered-image-v1.1/edit',
      endpoint: 'https://api.wavespeed.ai/api/v3',
      prompt: 'Keep the same character and change the background',
      preface: 'Clean reference images',
      refPaths: ['data:image/png;base64,aW1hZ2U='],
      aspectRatio: '9:16'
    });

    const submit = calls.find((call) => call.url.endsWith('/wavespeed-ai/firered-image-v1.1/edit'));
    const body = JSON.parse(submit.options.body);
    assert.deepEqual(body.images, ['https://media.example/reference.png']);
    assert.equal(body.size, '864*1536');
    assert.equal(body.enable_safety_checker, false);
    assert.match(body.prompt, /Clean reference images/);
    const upload = calls.find((call) => call.url === 'https://storage.example/upload');
    assert.equal(upload.options.headers.Authorization, undefined);
    assert.equal(outputs[0].buffer.toString(), 'firered-result');
  });
});
