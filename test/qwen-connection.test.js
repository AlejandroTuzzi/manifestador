import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { testService } from '../lib/providers.js';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const args = { service: 'qwen', key: 'qwen-secret-test' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Qwen connection check only reads the official catalog, using the configured host and exact model', async () => {
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://workspace.eu-central-1.maas.aliyuncs.com');
    assert.equal(parsed.pathname, '/api/v1/models');
    assert.equal(parsed.searchParams.get('model'), 'qwen-image-3.0-pro');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${args.key}`);
    return response({ success: true, code: null, output: { models: [{ model: 'qwen-image-3.0-pro' }] } });
  };
  const result = await testService({ ...args, endpoint: 'https://workspace.eu-central-1.maas.aliyuncs.com/compatible-mode/v1' });
  assert.equal(result.ok, true);
  assert.equal(result.detailCode, 'config.connection.qwenAvailable');
  assert.equal(calls, 1);
});

test('missing keys and invalid endpoints never cause an external call', async () => {
  global.fetch = async () => assert.fail('Unexpected request');
  assert.equal((await testService({ ...args, key: '' })).detailCode, 'config.connection.noKey');
  assert.equal((await testService({ ...args, endpoint: 'https://example.com' })).detailCode, 'errors.qwenEndpoint');
});

test('successful empty or nonmatching catalogs do not claim Qwen is available', async () => {
  for (const models of [[], [{ model: 'qwen-image-3.0' }]]) {
    global.fetch = async (url) => {
      assert.ok(url.startsWith('https://dashscope-intl.aliyuncs.com/'));
      return response({ output: { models } });
    };
    const result = await testService(args);
    assert.equal(result.ok, false);
    assert.equal(result.detailCode, 'config.connection.qwenNotListed');
  }
});

test('invalid keys and permission failures are distinguished and secrets are redacted', async () => {
  for (const [status, expected] of [[401, 'qwenRejected'], [403, 'qwenForbidden']]) {
    global.fetch = async () => response({ message: `Rejected ${args.key}` }, status);
    const result = await testService(args);
    assert.equal(result.ok, false);
    assert.equal(result.detailCode, `config.connection.${expected}`);
    assert.ok(!JSON.stringify(result).includes(args.key));
  }
});

test('HTTP failures, business errors and malformed responses are never successful tests', async () => {
  for (const [body, status] of [[{}, 404], [{}, 429], [{}, 500], [{}, 200], [{ success: false, output: { models: [] } }, 200], [{ code: 'AccessDenied', output: { models: [] } }, 200]]) {
    global.fetch = async () => response(body, status);
    const result = await testService(args);
    assert.equal(result.ok, false);
    assert.equal(result.detailCode, 'config.connection.qwenInconclusive');
  }
  global.fetch = async () => new Response('<html>Error</html>');
  assert.equal((await testService(args)).ok, false);
});

test('connection timeout and network errors are localized without key leakage', async () => {
  global.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  assert.equal((await testService(args)).detailCode, 'config.connection.timeout');
  global.fetch = async () => { throw new Error(`Network error ${args.key}`); };
  const result = await testService(args);
  assert.equal(result.detailCode, 'config.connection.networkError');
  assert.ok(!JSON.stringify(result).includes(args.key));
});

test('the Settings test button uses unsaved key and host, restores button state and renders translated results', async () => {
  let click, request;
  const button = { dataset: { service: 'qwen' }, addEventListener: (_event, fn) => { click = fn; } };
  const out = {};
  const form = { key_qwen: { value: ' unsaved-key ' }, endpoint_qwen: { value: ' https://workspace.cn-beijing.maas.aliyuncs.com ' } };
  const context = vm.createContext({
    $$: () => [button], $: (selector) => selector === '#configForm' ? form : out,
    tr: (key) => key === 'config.connection.qwenAvailable' ? 'Connection accepted' : key,
    i18n: { has: () => true },
    api: async (url, options) => { request = { url, ...options }; return { ok: true, detailCode: 'config.connection.qwenAvailable' }; }
  });
  const source = read('public/app.js');
  vm.runInContext(source.slice(source.indexOf("$$('.test-btn').forEach"), source.indexOf("$('#psDetectBtn').addEventListener")), context);
  await click();
  assert.equal(request.url, '/api/test');
  assert.equal(request.body.key, 'unsaved-key');
  assert.equal(request.body.endpoint, 'https://workspace.cn-beijing.maas.aliyuncs.com');
  assert.equal(out.textContent, '✓ Connection accepted');
  assert.equal(button.disabled, false);
  context.api = async () => { throw new Error('Test failure'); };
  await click();
  assert.equal(out.textContent, '✗ Test failure');
  assert.equal(button.disabled, false);
  assert.match(read('public/index.html'), /class="tool-btn test-btn" data-service="qwen"/);
  assert.match(read('server.js'), /service === 'qwen' \? cfg.endpoints.qwen/);
});
