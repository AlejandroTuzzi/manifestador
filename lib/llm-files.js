import fs from 'node:fs/promises';
import path from 'node:path';
export const FILE_TYPES = {
  pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt:'text/plain', md:'text/markdown', csv:'text/csv', json:'application/json',
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp'
};
export function validateChatFile(body) {
  const name = String(body.name || '').split(/[\\/]/).pop().replace(/[\x00-\x1f]/g, '').slice(0, 180);
  const ext = name.split('.').pop().toLowerCase(), mime = FILE_TYPES[ext];
  const match = /^data:[^;,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(String(body.dataUrl || ''));
  if (!mime || !match) throw new Error('llmFileInvalid');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('llmFileInvalid');
  const hex = buffer.subarray(0, 12).toString('hex');
  if ((ext === 'pdf' && !buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
    || (ext === 'png' && !hex.startsWith('89504e470d0a1a0a'))
    || (['jpg','jpeg'].includes(ext) && !hex.startsWith('ffd8ff'))
    || (ext === 'webp' && !(buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP'))
    || (['docx','pptx','xlsx'].includes(ext) && !hex.startsWith('504b0304'))) throw new Error('llmFileInvalid');
  return {name, ext, mime, buffer, kind: mime.startsWith('image/') ? 'image' : 'document'};
}
export function createLlmFiles({ dataDir, readJson, updateJson, readJsonBody, getConfig, newId, send, sendError }) {
  const folder = path.join(dataDir, 'chat-files'), index = 'chat-files.json';
  const visible = (file, cfg) => cfg.nsfwEnabled || !file.nsfw;
  async function resolve(ids, model, cfg) {
    if (!Array.isArray(ids) || ids.length > 4 || ids.some(id => typeof id !== 'string')) throw new Error('llmFileInvalid');
    const all = await readJson(index, []), out = [];
    for (const id of [...new Set(ids)]) {
      const file = all.find(item => item.id === id && visible(item, cfg));
      if (!file || (file.kind === 'image' ? !model.vision : !model.documents)) throw new Error('llmFileUnsupported');
      out.push(file);
    }
    return out;
  }
  async function messages(history, model, cfg) {
    let bytes = 0;
    const result = [];
    for (const message of history) {
      const attachments = await resolve((message.attachments || []).map(a => a.id), model, cfg);
      if (!attachments.length) { result.push({role:message.role,content:message.content}); continue; }
      const content = message.content ? [{type:'text',text:message.content}] : [];
      for (const file of attachments) {
        if (!/^[a-z0-9]+$/i.test(file.id) || !FILE_TYPES[file.ext]) throw new Error('llmFileInvalid');
        const buffer = await fs.readFile(path.join(folder, `${file.id}.${file.ext}`)).catch(() => { throw new Error('llmFileInvalid'); });
        bytes += buffer.length;
        if (bytes > 25 * 1024 * 1024) throw new Error('llmFileLimit');
        const data = `data:${file.mime};base64,${buffer.toString('base64')}`;
        content.push(file.kind === 'image' ? {type:'image_url',image_url:{url:data}} : {type:'file',file:{filename:file.name,file_data:data}});
      }
      result.push({role:message.role,content});
    }
    return result;
  }
  async function route(p, req, res) {
    if (!p.startsWith('/api/chat-files')) return false;
    const cfg = await getConfig();
    if (p === '/api/chat-files' && req.method === 'GET') {
      send(res,200,{files:(await readJson(index,[])).filter(f=>visible(f,cfg))}); return true;
    }
    if (p === '/api/chat-files' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 15 * 1024 * 1024);
        if (body.nsfw && !cfg.nsfwEnabled) throw new Error('llmFileInvalid');
        const {buffer,...metadata} = validateChatFile(body);
        const item = {...metadata,id:newId(),size:buffer.length,nsfw:Boolean(body.nsfw),createdAt:Date.now()};
        await fs.mkdir(folder,{recursive:true});
        await fs.writeFile(path.join(folder,`${item.id}.${item.ext}`),buffer);
        await updateJson(index,[],items=>[item,...items]);
        send(res,200,item);
      } catch(error) {
        if (error.message !== 'llmFileInvalid') throw error;
        sendError(res,400,'llmFileInvalid','Invalid attachment.');
      }
      return true;
    }
    const match = /^\/api\/chat-files\/([a-z0-9]+)$/.exec(p);
    const file = match && (await readJson(index,[])).find(f=>f.id===match[1] && visible(f,cfg));
    if (file && req.method === 'GET') {
      const buffer = await fs.readFile(path.join(folder,`${file.id}.${file.ext}`));
      send(res,200,buffer,{mime:file.mime,extra:{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,'%27')}`,'X-Content-Type-Options':'nosniff'}});
    } else sendError(res,404,'llmFileInvalid','Invalid attachment.');
    return true;
  }
  return { route, resolve, messages };
}
