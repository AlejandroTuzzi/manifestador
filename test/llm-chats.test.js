import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatRoutes, LLM_MODELS, llmCost, buildChatContext } from '../lib/llm-chats.js';

function harness(overrides = {}) {
  const files = { 'llm-chats.json': [], 'series.json': [{id:'series', title:'Test'}], 'projects.json': [{id:'closed', archived:true}] };
  const costs = [], requests = [];
  let count = 0, release;
  const deps = {
    readJson: async (file, fallback) => structuredClone(files[file] ?? fallback),
    updateJson: async (file, fallback, fn) => { files[file] = await fn(structuredClone(files[file] ?? fallback)); return files[file]; },
    getConfig: async () => ({ keys:{venice:'test-key'}, nsfwEnabled:false }),
    readJsonBody: async req => req.body,
    send: (res, status, data) => Object.assign(res, { status, data }),
    sendError: (res, status, code) => Object.assign(res, { status, code }),
    newId: () => `id${++count}`, recordCost: async entry => costs.push(entry),
    fetchImpl: async (url, options) => { requests.push(JSON.parse(options.body)); await new Promise(resolve => release = resolve); return {ok:true, json:async()=>({choices:[{message:{content:'Reply'}}],usage:{prompt_tokens:1000,completion_tokens:1000}})}; }
  };
  const route = createChatRoutes({...deps,...overrides});
  return { files, costs, requests, deps, finish: () => release(), call: async (path, method='GET', body={}) => {const res={}; await route(path,{method,body},res); return res;} };
}
test('deleted messages and their attachments never reach subsequent requests; pending chats are protected', async () => {
  const h = harness();
  h.files['llm-chats.json'] = [{id:'chat', modelId:LLM_MODELS[0].id, messages:[
    {id:'one',role:'user',content:'Remove this',attachments:[{id:'file1'}]},
    {id:'two',role:'assistant',content:'Keep this'}]}];
  assert.equal((await h.call('/api/llm-chats/chat/messages/missing','DELETE')).status,404);
  assert.equal((await h.call('/api/llm-chats/chat/messages/one','DELETE')).status,200);
  assert.deepEqual(h.files['llm-chats.json'][0].messages.map(m=>m.id),['two']);
  await h.call('/api/llm-chats/chat/messages','POST',{content:'Continue'});
  assert.equal(JSON.stringify(h.requests).includes('Remove this'),false);
  assert.equal(JSON.stringify(h.requests).includes('file1'),false);
  assert.equal((await h.call('/api/llm-chats/chat/messages/two','DELETE')).status,409);
  h.finish(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await h.call('/api/llm-chats/chat/messages/two','DELETE')).status,200);
});

test('removing chat images preserves documents, texts, other chats and asset files', async () => {
  const h = harness({ attachments: {
    resolve: async () => [],
    messages: async history => history
  } });
  const image = {id:'image',kind:'image'}, doc = {id:'pdf',kind:'document'};
  h.files['chat-files.json'] = [image, doc];
  h.files['llm-chats.json'] = [
    {id:'chat',modelId:LLM_MODELS[0].id,messages:[
      {id:'one',role:'user',content:'Keep text',attachments:[image,doc]},
      {id:'two',role:'user',content:'',attachments:[image]},
      {id:'three',role:'assistant',content:'Existing description'}]},
    {id:'other',messages:[{content:'Other',attachments:[image]}]},
    {id:'hidden',nsfw:true,messages:[]}
  ];
  assert.equal((await h.call('/api/llm-chats/hidden/images','DELETE')).status,404);
  assert.equal((await h.call('/api/llm-chats/missing/images','DELETE')).status,404);
  assert.equal((await h.call('/api/llm-chats/chat/images','DELETE')).status,200);
  assert.deepEqual(h.files['llm-chats.json'][0].messages[0].attachments,[doc]);
  assert.equal(h.files['llm-chats.json'][0].messages.length,3);
  assert.deepEqual(h.files['llm-chats.json'][1].messages[0].attachments,[image]);
  assert.deepEqual(h.files['chat-files.json'],[image,doc]);
  assert.equal((await h.call('/api/llm-chats/chat/images','DELETE')).status,200);
  await h.call('/api/llm-chats/chat/messages','POST',{content:'Continue'});
  const outgoing = h.requests[0].messages;
  assert.equal(outgoing.some(m => m.attachments?.some(f => f.kind === 'image')),false);
  assert.equal(outgoing.some(m => m.id === 'two'),false);
  assert.equal(outgoing[0].content,'Keep text');
  assert.deepEqual(outgoing[0].attachments,[doc]);
  assert.equal((await h.call('/api/llm-chats/chat/images','DELETE')).status,409);
  h.finish(); await new Promise(resolve=>setImmediate(resolve));
});

test('attachments are persisted and sent, incompatible history fails before a paid request', async () => {
  const attachments = {
    resolve: async ids => ids.map(id=>({id,name:'picture.png',kind:'image'})),
    messages: async (history,model) => {
      if (!model.vision && history.some(m=>m.attachments?.length)) throw new Error('llmFileUnsupported');
      return history.map(m=>({role:m.role,content:m.attachments?.length ? [{type:'image_url',image_url:{url:'data:image/png;base64,test'}}] : m.content}));
    }
  };
  const h=harness({attachments});
  h.files['llm-chats.json']=[{id:'chat',modelId:LLM_MODELS[0].id,messages:[]}];
  assert.equal((await h.call('/api/llm-chats/chat/messages','POST',{attachments:['image']})).status,202);
  assert.equal(h.files['llm-chats.json'][0].messages[0].attachments[0].name,'picture.png');
  assert.equal(h.requests[0].messages[0].content[0].type,'image_url');
  h.finish(); await new Promise(resolve=>setImmediate(resolve));
  h.files['llm-chats.json'][0].modelId=LLM_MODELS[1].id;
  const failed=await h.call('/api/llm-chats/chat/messages','POST',{content:'Continue'});
  assert.equal(failed.code,'llmFileUnsupported');
  assert.equal(h.requests.length,1);
  assert.equal(h.files['llm-chats.json'][0].messages.length,2);
});
test('chat persistence, history, background generation and costs', async () => {
  const h = harness();
  const created = await h.call('/api/llm-chats','POST',{title:'Hello',modelId:LLM_MODELS[0].id,association:{type:'series',id:'series'}});
  assert.equal(created.status,200);
  const id = created.data.id;
  assert.equal((await h.call(`/api/llm-chats/${id}/messages`,'POST',{content:'First'})).status,202);
  assert.equal((await h.call('/api/llm-chats')).data.chats[0].status,'pending');
  assert.equal((await h.call(`/api/llm-chats/${id}/messages`,'POST',{content:'Duplicate'})).status,409);
  assert.equal((await h.call(`/api/llm-chats/${id}`,'DELETE')).status,409);
  assert.deepEqual(h.requests[0].messages.at(-1),{role:'user',content:'First'});
  const preview = await h.call(`/api/llm-chats/${id}/context`);
  assert.deepEqual(h.requests[0].messages.slice(0,-1),preview.data.messages);
  h.finish(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.files['llm-chats.json'][0].messages[1].content,'Reply');
  assert.equal(h.costs.length,1);
  assert.equal(llmCost(LLM_MODELS[0],{prompt_tokens:1000,completion_tokens:1000}),0.0011);
  await h.call(`/api/llm-chats/${id}/messages`,'POST',{content:'Second'});
  assert.equal(h.requests[1].messages.length,5);
  h.finish(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await h.call(`/api/llm-chats/${id}`,'DELETE')).status,200);
  assert.equal(h.files['llm-chats.json'].length,0);
});
test('context uses current metadata, separates reference data and excludes hidden or deleted owners', async () => {
  const cfg = { llmGlobalContext: 'Global instructions', nsfwEnabled: false };
  let owner = { id: 's', title: 'Story', description: 'Background', secret: 'never sent' };
  const read = async () => owner ? [owner] : [];
  const chat = { association: { type: 'series', id: 's' } };
  let context = await buildChatContext(cfg, chat, read);
  assert.equal(context.messages[0].role, 'system');
  assert.equal(context.messages[0].content, 'Global instructions');
  assert.equal(context.messages.at(-1).role, 'user');
  assert.equal(JSON.stringify(context).includes('never sent'), false);
  owner.description = 'Updated';
  assert.equal((await buildChatContext(cfg, chat, read)).reference.description, 'Updated');
  owner.nsfw = true;
  assert.equal((await buildChatContext(cfg, chat, read)).reference, null);
  owner = null;
  assert.equal((await buildChatContext(cfg, chat, read)).messages.length, 1);
  assert.equal((await buildChatContext({}, {}, read)).messages.length, 0);
});
test('archive and restore preserve messages and deletion removes archived chats', async () => {
  const h = harness();
  h.files['llm-chats.json'] = [{ id: 'chat', title: 'Saved', modelId: LLM_MODELS[0].id, messages: [{role:'user',content:'Keep me'}] }];
  assert.equal((await h.call('/api/llm-chats/chat/archive', 'PUT', {archived:true})).status, 200);
  assert.equal(h.files['llm-chats.json'][0].archived, true);
  assert.equal((await h.call('/api/llm-chats/chat/messages','POST',{content:'No'})).code, 'llmArchived');
  assert.equal(h.requests.length, 0);
  assert.equal((await h.call('/api/llm-chats/chat/archive', 'PUT', {archived:'yes'})).status, 400);
  await h.call('/api/llm-chats/chat/archive', 'PUT', {archived:false});
  assert.equal(h.files['llm-chats.json'][0].archived, false);
  assert.equal(h.files['llm-chats.json'][0].messages[0].content, 'Keep me');
  await h.call('/api/llm-chats/chat/archive', 'PUT', {archived:true});
  await h.call('/api/llm-chats/chat', 'DELETE');
  assert.equal(h.files['llm-chats.json'].length, 0);
});
test('invalid models and closed associations rejected; hidden chats excluded', async () => {
  const h = harness();
  assert.equal((await h.call('/api/llm-chats','POST',{title:'Test',modelId:'unknown'})).status,400);
  assert.equal((await h.call('/api/llm-chats','POST',{title:'Test',modelId:LLM_MODELS[0].id,association:{type:'project',id:'closed'}})).code,'llmAssociation');
  h.files['llm-chats.json']=[{id:'hidden',nsfw:true},{id:'interrupted',status:'pending'}];
  const result = await h.call('/api/llm-chats');
  assert.equal(result.data.chats.length,1);
  assert.equal(result.data.chats[0].status,'interrupted');
});
