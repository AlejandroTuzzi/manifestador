import crypto from 'node:crypto';
import path from 'node:path';

const API_BASE = 'https://api.heygen.com';
const MCP_URL = 'https://mcp.heygen.com/mcp/v1/';
const OAUTH_ISSUER = 'https://api2.heygen.com';

function errorText(json, fallback) {
  return json?.error?.message || json?.error_description || json?.message || fallback;
}

async function jsonResponse(res, label) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label}: ${errorText(json, `HTTP ${res.status}`)}`);
  return json;
}

export async function registerHeyGenOAuthClient(redirectUri) {
  const res = await fetch(`${OAUTH_ISSUER}/v1/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Manifestador Local',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid profile email'
    }),
    signal: AbortSignal.timeout(20000)
  });
  return jsonResponse(res, 'Registro OAuth de HeyGen');
}

export function heyGenAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL(`${OAUTH_ISSUER}/v1/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', 'https://mcp.heygen.com/mcp/v1');
  return url.toString();
}

async function oauthToken(body) {
  const res = await fetch(`${OAUTH_ISSUER}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30000)
  });
  return jsonResponse(res, 'OAuth de HeyGen');
}

export function exchangeHeyGenOAuthCode({ clientId, redirectUri, code, codeVerifier }) {
  return oauthToken({
    grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri,
    code, code_verifier: codeVerifier, resource: 'https://mcp.heygen.com/mcp/v1'
  });
}

export function refreshHeyGenOAuthToken({ clientId, refreshToken }) {
  return oauthToken({
    grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken,
    resource: 'https://mcp.heygen.com/mcp/v1'
  });
}

function parseMcpPayload(text, contentType) {
  if (!text) return {};
  if (!String(contentType).includes('text/event-stream')) return JSON.parse(text);
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try { events.push(JSON.parse(raw)); } catch { /* keep reading events */ }
  }
  return events.at(-1) || {};
}

async function mcpPost(accessToken, payload, sessionId = '') {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-03-26'
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(MCP_URL, {
    method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000)
  });
  const text = await res.text();
  const parsed = parseMcpPayload(text, res.headers.get('content-type'));
  if (!res.ok || parsed?.error) throw new Error(`HeyGen OAuth/MCP: ${parsed?.error?.message || errorText(parsed, `HTTP ${res.status}`)}`);
  return { payload: parsed, sessionId: res.headers.get('mcp-session-id') || sessionId };
}

async function openMcpSession(accessToken) {
  const init = await mcpPost(accessToken, {
    jsonrpc: '2.0', id: crypto.randomUUID(), method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Manifestador', version: '0.1.0' } }
  });
  await mcpPost(accessToken, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, init.sessionId);
  return init.sessionId;
}

function unpackMcpToolResult(response) {
  const result = response?.result || {};
  if (result.isError) {
    const detail = (result.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
    throw new Error(detail || 'HeyGen devolvió un error.');
  }
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content || []).find((item) => item.type === 'text')?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { text }; }
}

export async function callHeyGenMcp(accessToken, name, args = {}) {
  const sessionId = await openMcpSession(accessToken);
  const response = await mcpPost(accessToken, {
    jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: args }
  }, sessionId);
  return unpackMcpToolResult(response.payload);
}

export async function getHeyGenMcpUser(accessToken) {
  return callHeyGenMcp(accessToken, 'get_current_user', {});
}

export async function getHeyGenApiUser(apiKey) {
  if (!apiKey) throw new Error('Falta la API key de HeyGen.');
  const res = await fetch(`${API_BASE}/v3/users/me`, {
    headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(20000)
  });
  return jsonResponse(res, 'HeyGen API');
}

function directHeaders(apiKey, json = true, idempotencyKey = '') {
  const headers = { 'x-api-key': apiKey };
  if (json) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return headers;
}

function nestedData(value) {
  return value?.data || value;
}

async function directJson(apiKey, route, { method = 'GET', body, idempotencyKey = '' } = {}) {
  const res = await fetch(`${API_BASE}${route}`, {
    method,
    headers: directHeaders(apiKey, true, idempotencyKey),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  return jsonResponse(res, 'HeyGen API');
}

function assetInfo(buffer, filename, mime) {
  if (buffer.length > 32 * 1024 * 1024) throw new Error('HeyGen admite assets de hasta 32 MB.');
  return {
    filename: path.basename(filename || `asset-${Date.now()}`),
    content_type: mime || 'application/octet-stream',
    size_bytes: buffer.length
  };
}

async function putPresigned(upload, buffer, mime) {
  const headers = { ...(upload.upload_headers || {}) };
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['Content-Type'] = mime;
  const res = await fetch(upload.upload_url, {
    method: 'PUT', headers, body: buffer, signal: AbortSignal.timeout(300000)
  });
  if (!res.ok) throw new Error(`HeyGen: falló la subida del asset (HTTP ${res.status}).`);
}

export async function uploadHeyGenAssetWithKey({ apiKey, buffer, filename, mime, idempotencyKey }) {
  const info = assetInfo(buffer, filename, mime);
  const created = nestedData(await directJson(apiKey, '/v3/assets/direct-uploads', {
    method: 'POST', body: info, idempotencyKey
  }));
  await putPresigned(created, buffer, info.content_type);
  const completed = nestedData(await directJson(apiKey, `/v3/assets/${created.asset_id}/complete`, {
    method: 'POST', body: {}, idempotencyKey: `${idempotencyKey || created.asset_id}-complete`
  }));
  return { ...created, ...completed, asset_id: completed.asset_id || completed.id || created.asset_id };
}

export async function uploadHeyGenAssetWithMcp({ accessToken, buffer, filename, mime }) {
  const info = assetInfo(buffer, filename, mime);
  const created = nestedData(await callHeyGenMcp(accessToken, 'create_asset_upload', info));
  await putPresigned(created, buffer, info.content_type);
  const completed = nestedData(await callHeyGenMcp(accessToken, 'complete_asset_upload', { asset_id: created.asset_id }));
  return { ...created, ...completed, asset_id: completed.asset_id || completed.id || created.asset_id };
}

export async function createHeyGenVideoWithKey({ apiKey, payload, idempotencyKey }) {
  return nestedData(await directJson(apiKey, '/v3/videos', {
    method: 'POST', body: payload, idempotencyKey
  }));
}

export async function getHeyGenVideoWithKey({ apiKey, videoId }) {
  return nestedData(await directJson(apiKey, `/v3/videos/${encodeURIComponent(videoId)}`));
}

export async function createHeyGenVideoWithMcp({ accessToken, payload }) {
  return nestedData(await callHeyGenMcp(accessToken, 'create_video', payload));
}

export async function getHeyGenVideoWithMcp({ accessToken, videoId }) {
  return nestedData(await callHeyGenMcp(accessToken, 'get_video', { video_id: videoId }));
}

export async function waitForHeyGenVideo(getStatus, { timeoutMs = 20 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await getStatus();
    const status = String(item?.status || '').toLowerCase();
    if (status === 'completed' && item.video_url) return item;
    if (status === 'failed') throw new Error(item.failure_message || item.error?.message || 'HeyGen no pudo generar el video.');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('HeyGen sigue procesando después de 20 minutos. El video_id quedó guardado en HeyGen.');
}

export async function downloadHeyGenVideo(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`No se pudo descargar el video de HeyGen (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

