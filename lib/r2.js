// Cloudflare R2 through its S3 API, signed with AWS Signature V4 (no SDK).
// Used only to publish short-lived private links that providers can download.
import crypto from 'node:crypto';

export function r2Error(code, detail = '') {
  const error = new Error(`R2: ${detail || code}`);
  error.localizationCode = code;
  error.localizationDetails = { detail };
  return error;
}

const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
// RFC 3986 encoding required by SigV4; slashes in object keys stay literal.
const encode = (value, keepSlash = false) => encodeURIComponent(value)
  .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  .replace(keepSlash ? /%2F/g : /$^/, '/');
const amzDate = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function signingKey(secret, day, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), 'aws4_request');
}

// Generic SigV4 presigned URL; exported so it can be checked against AWS's published example.
export function presignUrl({ method = 'GET', host, path, accessKeyId, secretAccessKey, region, service = 's3', expires, date = new Date() }) {
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const query = Object.entries({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': stamp,
    'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host'
  }).map(([key, value]) => `${encode(key)}=${encode(value)}`).sort().join('&');
  const canonicalPath = encode(path, true);
  const request = [method, canonicalPath, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(request)].join('\n');
  const signature = hmac(signingKey(secretAccessKey, day, region, service), toSign).toString('hex');
  return `https://${host}${canonicalPath}?${query}&X-Amz-Signature=${signature}`;
}

export function r2Settings(cfg) {
  const settings = {
    accountId: String(cfg.r2?.accountId || '').trim().toLowerCase(),
    bucket: String(cfg.r2?.bucket || '').trim(),
    accessKeyId: String(cfg.keys?.r2AccessKeyId || '').trim(),
    secretAccessKey: String(cfg.keys?.r2SecretAccessKey || '').trim()
  };
  settings.configured = Object.values(settings).every(Boolean);
  return settings;
}

function target(settings, key) {
  if (!settings.configured) throw r2Error('r2NotConfigured');
  if (!/^[a-f0-9]{32}$/.test(settings.accountId)) throw r2Error('r2Settings', 'Account ID');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(settings.bucket)) throw r2Error('r2Settings', 'Bucket');
  return { host: `${settings.accountId}.r2.cloudflarestorage.com`, path: `/${settings.bucket}/${key}` };
}

async function r2Request(settings, method, key, { body, contentType, fetchImpl = fetch } = {}) {
  const url = presignUrl({ method, ...target(settings, key), ...settings, region: 'auto', expires: 900 });
  let response;
  try {
    response = await fetchImpl(url, { method, body, headers: contentType ? { 'Content-Type': contentType } : undefined, signal: AbortSignal.timeout(120000) });
  } catch (error) {
    throw r2Error('r2Request', String(error?.name || 'network').slice(0, 80));
  }
  if (!response.ok) {
    // S3 errors are XML: keep only the code, never the signed URL or credentials.
    const code = /<Code>([^<]{1,80})<\/Code>/.exec(await response.text().catch(() => ''))?.[1] || '';
    throw r2Error(response.status === 401 || response.status === 403 ? 'r2Denied' : 'r2Request', [`HTTP ${response.status}`, code].filter(Boolean).join(' · '));
  }
  return response;
}

export async function r2Put(settings, key, buffer, contentType, options = {}) {
  await r2Request(settings, 'PUT', key, { ...options, body: buffer, contentType });
}

export async function r2Delete(settings, key, options = {}) {
  await r2Request(settings, 'DELETE', key, options);
}

export function r2SignedGetUrl(settings, key, { expires = 7200, date } = {}) {
  return presignUrl({ method: 'GET', ...target(settings, key), ...settings, region: 'auto', expires, date });
}

// Uploads a file, reads it back through the same kind of link a provider receives, then deletes it.
export async function r2Check(settings, { fetchImpl = fetch } = {}) {
  const key = `manifestador-check/${crypto.randomBytes(12).toString('hex')}.txt`;
  await r2Put(settings, key, Buffer.from('manifestador'), 'text/plain', { fetchImpl });
  try {
    const response = await fetchImpl(r2SignedGetUrl(settings, key, { expires: 300 }), { signal: AbortSignal.timeout(60000) });
    if (!response.ok || await response.text() !== 'manifestador') throw r2Error('r2Request', `GET HTTP ${response.status}`);
  } finally {
    await r2Delete(settings, key, { fetchImpl }).catch(() => {});
  }
}
