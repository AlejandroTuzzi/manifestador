import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateChatFile, createLlmFiles } from '../lib/llm-files.js';
const upload = (name, text) => ({ name, dataUrl: `data:application/octet-stream;base64,${Buffer.from(text).toString('base64')}` });
test('file validation rejects unsupported formats, oversized files and forged images', () => {
  assert.equal(validateChatFile(upload('../notes.txt','hello')).name,'notes.txt');
  assert.throws(()=>validateChatFile(upload('bad.exe','hello')),/llmFileInvalid/);
  assert.throws(()=>validateChatFile(upload('bad.png','hello')),/llmFileInvalid/);
  assert.throws(()=>validateChatFile(upload('big.txt','x'.repeat(10*1024*1024+1))),/llmFileInvalid/);
});
test('documents persist, are sent as file blocks in history and respect visibility/capabilities', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),'manifestador-files-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  const records = {}; let id = 0;
  const service = createLlmFiles({dataDir,readJson:async(k,d)=>records[k]||d,
    updateJson:async(k,d,fn)=>records[k]=fn(records[k]||d),getConfig:async()=>({nsfwEnabled:false}),
    readJsonBody:async req=>req.body,newId:()=>`file${++id}`,
    send:(res,status,data)=>Object.assign(res,{status,data}),sendError:(res,status,code)=>Object.assign(res,{status,code})});
  const res={}; await service.route('/api/chat-files',{method:'POST',body:upload('notes.txt','Read this')},res);
  assert.equal(res.status,200);
  const files=await service.resolve([res.data.id],{documents:true},{});
  const history=[{role:'user',content:'Summarize',attachments:files},{role:'assistant',content:'Summary'}];
  const messages=await service.messages(history,{documents:true},{});
  assert.equal(messages[0].content[1].file.filename,'notes.txt');
  assert.match(messages[0].content[1].file.file_data,/^data:text\/plain;base64,/);
  assert.equal(messages[1].content,'Summary');
  await assert.rejects(service.messages(history,{documents:false},{}),/llmFileUnsupported/);
  await assert.rejects(service.resolve(Array(5).fill(res.data.id),{documents:true},{}),/llmFileInvalid/);
  records['chat-files.json'][0].nsfw=true;
  await assert.rejects(service.resolve([res.data.id],{documents:true},{}),/llmFileUnsupported/);
  const listing={}; await service.route('/api/chat-files',{method:'GET'},listing);
  assert.equal(listing.data.files.length,0);
});
