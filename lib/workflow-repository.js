export function workflowRepositoryItem(body, previous = {}, id) {
  const error = () => { throw Object.assign(new Error('workflowRepositoryInvalid'), { localizationCode:'workflowRepositoryInvalid', status:400 }); };
  const title = String(body.title ?? previous.title ?? '').trim().slice(0,120);
  const description = String(body.description ?? previous.description ?? '').trim().slice(0,10000);
  const content = body.content ?? previous.content;
  if (!title || typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) error();
  let parsed;
  try { parsed = JSON.parse(content.replace(/^\uFEFF/,'')); } catch { error(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) error();
  const apiNodes = Object.values(parsed);
  if (!Array.isArray(parsed.nodes) && (!apiNodes.length || !apiNodes.every(node => node && typeof node.class_type === 'string' && typeof node.inputs === 'object'))) error();
  const filename = String(body.filename ?? previous.filename ?? 'workflow.json').split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g,'_').slice(0,180);
  if (!/\.json$/i.test(filename)) error();
  return { id:previous.id || id, title, description, filename, content, ts:previous.ts || Date.now(), updatedAt:Date.now() };
}
export const workflowRepositorySummary = ({ content, ...item }) => item;
