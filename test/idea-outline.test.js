import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {changeIdeas,normalizeIdeaOutline} from '../lib/series-ideas.js';
const episode = name => ({name,description:'Story',duration:2.5});
test('outlines persist with ideas, accept overlapping ranges, and preserve existing data on legacy edits',()=>{
  const outline={episodes:[episode('Pilot'),episode('Final')],ranges:[{name:'Conflict',start:1,end:2},{name:'Paywall',start:2,end:2}]};
  let data=changeIdeas({},'entries','POST','idea',{name:'Story',outline,characters:[{name:'Ana'}]});
  assert.deepEqual(data.entries[0].outline,outline);
  data=changeIdeas(data,'entries','PUT','idea',{name:'Updated',characters:data.entries[0].characters});
  assert.deepEqual(data.entries[0].outline,outline);
  assert.equal(data.entries[0].characters[0].name,'Ana');
  assert.deepEqual(normalizeIdeaOutline(),{episodes:[],ranges:[]});
  assert.equal(normalizeIdeaOutline({episodes:[{name:'Untimed'}]}).episodes[0].duration,null);
});
test('outline validation rejects missing names, bad duration and ranges outside the story',()=>{
  for(const duration of [-1,0,Infinity,'bad',1441]) assert.throws(()=>normalizeIdeaOutline({episodes:[{name:'Test',duration}]}),/Invalid outline/);
  for(const range of [{name:'',start:1,end:1},{name:'Test',start:0,end:1},{name:'Test',start:2,end:1},{name:'Test',start:1,end:3},{name:'Test',start:1.5,end:2}]) {
    assert.throws(()=>normalizeIdeaOutline({episodes:[episode('A'),episode('B')],ranges:[range]}),/Invalid outline/);
  }
  assert.throws(()=>normalizeIdeaOutline({episodes:[{name:''}]}));
  assert.throws(()=>normalizeIdeaOutline({episodes:Array(201).fill(episode('A'))}));
});
test('removing an episode adjusts ranges; reader distinguishes pilot and finale and escapes content',()=>{
  const context=vm.createContext({window:{},tr:(key,p)=>p?`${key}:${Object.values(p).join('-')}`:key,esc:value=>String(value??'').replaceAll('<','&lt;'),i18n:{formatNumber:String}});
  vm.runInContext(fs.readFileSync(new URL('../public/idea-outline.js',import.meta.url),'utf8'),context);
  const ui=context.window.IdeaOutline;
  const outline={episodes:[episode('A'),episode('B'),episode('C')],ranges:[{name:'one',start:2,end:2},{name:'two',start:2,end:3},{name:'all',start:1,end:3}]};
  ui.removeEpisode(outline,1);
  assert.equal(outline.episodes.length,2);
  assert.deepEqual(Array.from(outline.ranges,r=>[r.name,r.start,r.end]),[['two',2,2],['all',1,2]]);
  const html=ui.graph({episodes:[episode('<script>')],ranges:[]});
  assert.match(html,/pilot finale/);
  assert.match(html,/&lt;script>/);
  assert.doesNotMatch(html,/<script>/);
  ui.removeEpisode(outline,1);ui.removeEpisode(outline,0);
  assert.equal(outline.ranges.length,0);
});
