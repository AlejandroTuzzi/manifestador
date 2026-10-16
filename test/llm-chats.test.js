import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatRoutes, LLM_MODELS, llmCost } from '../lib/llm-chats.js';

function harness() {
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
  const route = createChatRoutes(deps);
  return { files, costs, requests, deps, finish: () => release(), call: async (path, method='GET', body={}) => {const res={}; await route(path,{method,body},res); return res;} };
}
test('chat persistence, history, background generation and costs', async () => {
  const h = harness();
  const created = await h.call('/api/llm-chats','POST',{title:'Hello',modelId:LLM_MODELS[0].id,association:{type:'series',id:'series'}});
  assert.equal(created.status,200);
  const id = created.data.id;
  assert.equal((await h.call(`/api/llm-chats/${id}/messages`,'POST',{content:'First'})).status,202);
  assert.equal((await h.call('/api/llm-chats')).data.chats[0].status,'pending');
  assert.equal((await h.call(`/api/llm-chats/${id}/messages`,'POST',{content:'Duplicate'})).status,409);
  assert.equal((await h.call(`/api/llm-chats/${id}`,'DELETE')).status,409);
  assert.deepEqual(h.requests[0].messages,[{role:'user',content:'First'}]);
  h.finish(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.files['llm-chats.json'][0].messages[1].content,'Reply');
  assert.equal(h.costs.length,1);
  assert.equal(llmCost(LLM_MODELS[0],{prompt_tokens:1000,completion_tokens:1000}),0.0011);
  await h.call(`/api/llm-chats/${id}/messages`,'POST',{content:'Second'});
  assert.equal(h.requests[1].messages.length,3);
  h.finish(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await h.call(`/api/llm-chats/${id}`,'DELETE')).status,200);
  assert.equal(h.files['llm-chats.json'].length,0);
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
