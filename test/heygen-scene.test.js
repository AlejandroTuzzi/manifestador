import test from 'node:test';
import assert from 'node:assert/strict';
import { heygenScenePayload, generateHeygenScene } from '../lib/heygen-scene.js';
import { generationSettings } from '../lib/generation-settings.js';
import { VIDEO_MODELS } from '../lib/models.js';
const basic={prompt:'Image 1 and <Audio 1>',duration:10,resolution:'768p',aspectRatio:'16:9'};
test('scene modes, references, labels and options are strict and distinct from avatars',()=>{
  assert.equal(heygenScenePayload(basic).mode,'text_to_video');
  const p=heygenScenePayload({...basic,mediaRefs:[{kind:'image'},{kind:'audio'}],options:{seed:0}});
  assert.equal(p.mode,'reference_to_video');assert.equal(p.seed,0);
  assert.equal(p.prompt,'<Picture 1> and <Audio 1>');
  assert.equal(heygenScenePayload({...basic,mode:'first',mediaRefs:[{kind:'image'}]}).mode,'image_to_video');
  for(const change of [{duration:4},{duration:16},{duration:5.5},{mode:'frames'},{mediaRefs:[{kind:'audio'}]},{mediaRefs:Array(10).fill({kind:'image'})},{resolution:'2k',aspectRatio:'1:1'},{options:{seed:-1}},{options:{promptEnhancement:'bogus'}}])assert.throws(()=>heygenScenePayload({...basic,...change}));
  assert.equal(VIDEO_MODELS.find(m=>m.id==='heygen-video-1').family,'HeyGen');
  assert.deepEqual(generationSettings('video',{heygenSceneOptions:{seed:0},apiKey:'secret'}).request,{heygenSceneOptions:{seed:0}});
});
test('uploads each reference, submits once with idempotency and persists remote ID before polling',async()=>{
  let persisted=false,post=0;const uploads=[];
  const result=await generateHeygenScene({...basic,apiKey:'test',idempotencyKey:'request',mediaRefs:[{kind:'image',path:'a.png'},{kind:'image',path:'b.png'}],onTask:async id=>{assert.equal(id,'task');persisted=true;}},{
    readFile:async()=>Buffer.from('image'),upload:async data=>{uploads.push(data);return {asset_id:'asset'+uploads.length};},
    fetch:async(url,opts)=>{
      if(opts.method==='POST'){post++;const p=JSON.parse(opts.body);assert.equal(p.reference_images.length,2);assert.equal(opts.headers['Idempotency-Key'],'request');return {ok:true,json:async()=>({data:{video_id:'task'}})};}
      assert.ok(persisted);return {ok:true,json:async()=>({data:{status:'completed',video_url:'https://example.com/v.mp4',duration:10,seed:7}})};
    },download:async()=>Buffer.from('video')});
  assert.equal(post,1);assert.equal(uploads.length,2);assert.equal(result.seed,7);assert.equal(result.taskId,'task');
});
test('recovery only polls; failures and malformed success envelopes do not fabricate results',async()=>{
  const base={...basic,apiKey:'test',taskId:'saved'};
  const result=await generateHeygenScene(base,{fetch:async(_,opts)=>{assert.equal(opts.method,'GET');return {ok:true,json:async()=>({data:{status:'completed',video_url:'https://example.com/v'}})};},download:async()=>Buffer.from('ok')});
  assert.equal(result.taskId,'saved');
  let failed=false;
  await assert.rejects(generateHeygenScene({...base,onFailed:async()=>{failed=true;}},{fetch:async()=>({ok:true,json:async()=>({data:{status:'cancelled'}})})}),{localizationCode:'heygenSceneFailed'});
  assert.ok(failed);
  await assert.rejects(generateHeygenScene(base,{fetch:async()=>({ok:true,status:200,json:async()=>({})})}),{localizationCode:'heygenSceneResponse'});
});
