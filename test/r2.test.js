import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presignUrl, r2Settings, r2SignedGetUrl, r2Put, r2Check } from '../lib/r2.js';

const cfg = { r2: { accountId: 'a'.repeat(32), bucket: 'manifestador-audio' }, keys: { r2AccessKeyId: 'access', r2SecretAccessKey: 'secret-key' } };

test('SigV4 presigned URLs match the example published by AWS', () => {
  const url = presignUrl({ host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', expires: 86400, date: new Date('2013-05-24T00:00:00Z') });
  assert.equal(url.split('X-Amz-Signature=')[1], 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('R2 links are path-style, expire as requested and never contain the secret', () => {
  const settings = r2Settings(cfg);
  assert.equal(settings.configured, true);
  const url = new URL(r2SignedGetUrl(settings, 'nezhagate/voice.wav', { expires: 7200 }));
  assert.equal(url.host, `${'a'.repeat(32)}.r2.cloudflarestorage.com`);
  assert.equal(url.pathname, '/manifestador-audio/nezhagate/voice.wav');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '7200');
  assert.match(url.searchParams.get('X-Amz-Credential'), /^access\/\d{8}\/auto\/s3\/aws4_request$/);
  assert.doesNotMatch(url.href, /secret-key/);
});

test('incomplete or malformed settings are refused before any request', async () => {
  const fetchImpl = () => assert.fail('No request expected');
  await assert.rejects(r2Put(r2Settings({ r2: {}, keys: {} }), 'k', Buffer.from('x'), 'text/plain', { fetchImpl }), { localizationCode: 'r2NotConfigured' });
  await assert.rejects(r2Put(r2Settings({ ...cfg, r2: { ...cfg.r2, accountId: 'short' } }), 'k', Buffer.from('x'), 'text/plain', { fetchImpl }), { localizationCode: 'r2Settings' });
});

test('the connection check uploads, reads back through a signed link and deletes; errors keep only the S3 code', async () => {
  const methods = [];
  let stored = null;
  await r2Check(r2Settings(cfg), { fetchImpl: async (url, options = {}) => {
    const method = options.method || 'GET';
    methods.push(method);
    assert.ok(new URL(url).searchParams.get('X-Amz-Signature'));
    if (method === 'PUT') { stored = options.body.toString(); return new Response(''); }
    if (method === 'GET') return new Response(stored);
    return new Response('', { status: 204 });
  } });
  assert.deepEqual(methods, ['PUT', 'GET', 'DELETE']);
  await assert.rejects(r2Put(r2Settings(cfg), 'k', Buffer.from('x'), 'text/plain', {
    fetchImpl: async () => new Response('<Error><Code>AccessDenied</Code><Message>secret-key</Message></Error>', { status: 403 })
  }), error => {
    assert.equal(error.localizationCode, 'r2Denied');
    assert.match(error.message, /AccessDenied/);
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
});
