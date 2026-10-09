import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const route=source.slice(source.indexOf('    const retireCharacterMatch ='),source.indexOf('    if (await serveEntityRoutes(ENTITY_META.characters'));
test('retirement persists, restores and blocks all series/project associations including closed ones',async()=>{
  let characters=[{id:'abc',name:'Test',photos:[]}],series=[],projects=[];
  const run=body=>vm.runInNewContext(`(async()=>{${route}})()`,{p:'/api/characters/abc/retirement',req:{method:'PUT'},res:{},
    readJsonBody:async()=>body,readJson:async file=>file==='series.json'?series:projects,
    updateJson:async(file,initial,fn)=>{assert.equal(file,'characters.json');characters=fn(characters);},
    send:(_,status,data)=>({status,data}),sendError:(_,status,code,message,details)=>({status,code,details})});
  assert.equal((await run({retired:true})).data.retired,true);
  assert.equal((await run({retired:false})).data.retired,false);
  for(const archived of [false,true]){
    series=[{title:'Series A',characterIds:['abc'],archived}];
    const result=await run({retired:true});assert.equal(result.status,409);assert.equal(result.details.names,'Series A');assert.equal(characters[0].retired,false);
    series=[];projects=[{name:'Project B',characterIds:['abc'],archived}];
    assert.equal((await run({retired:true})).details.names,'Project B');projects=[];
  }
  assert.equal((await run({retired:'yes'})).status,400);
  assert.equal(characters[0].name,'Test');
});
