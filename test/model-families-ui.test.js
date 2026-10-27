import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS } from '../lib/models.js';

test('family dropdowns preserve expansion and model clicks, leaving non-model chips untouched', () => {
  function node(tag='div',id='') {
    return {tag,id,children:[],dataset:{},open:false,events:{},textContent:'',className:'',classList:{add(){},toggle(){}},
      set innerHTML(value){this.children=[];},
      append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
      querySelectorAll(){return this.children.filter(child=>child.tag==='details');},
      addEventListener(event,fn){this.events[event]=fn;}};
  }
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const context={state:{models:IMAGE_MODELS,videoModels:VIDEO_MODELS,audioModels:AUDIO_MODELS},document:{createElement:node},tr:(key,vars)=>key==='models.officialProvider'?`${vars.vendor} (oficial)`:key};
  vm.runInNewContext(fs.readFileSync(new URL('../public/model-families.js',import.meta.url),'utf8'),context);
  vm.runInNewContext(source.slice(source.indexOf('function chipRow('),source.indexOf('function localizedModelNote(')),context);
  for(const [id,models] of [['modelChips',IMAGE_MODELS],['videoModelChips',VIDEO_MODELS],['audioModelChips',AUDIO_MODELS]]) {
    const container=node('div',id);let selected='';
    const render=()=>context.chipRow(container,models.map(m=>m.id),models[0].id,value=>selected=value,value=>models.find(m=>m.id===value).name);
    render(); assert.ok(container.children.every(child=>child.tag==='details'));
    assert.equal(container.children.flatMap(child=>child.children[1].children).length,models.length);
    const first=container.children[0];first.open=false;
    first.children[1].children[0].events.click();assert.ok(selected);
    render();assert.equal(container.children[0].open,false);
  }
  const ratios=node('div','arChips');context.chipRow(ratios,['1:1','16:9'],'1:1',()=>{});
  assert.ok(ratios.children.every(child=>child.tag==='button'));

  // Seedance lists the same model from three providers: every choice names its provider.
  const video=node('div','videoModelChips');
  context.chipRow(video,VIDEO_MODELS.map(m=>m.id),'nezhagate-seedance-2-5-special',()=>{},value=>VIDEO_MODELS.find(m=>m.id===value).name);
  const seedance=video.children.find(child=>child.dataset.family==='Seedance');
  const labels=seedance.children[1].children.map(chip=>chip.textContent);
  assert.ok(labels.includes('Seedance 2.5 · BytePlus (oficial)'));
  assert.ok(labels.includes('Seedance 2.5 Spicy · Siray'));
  assert.ok(labels.includes('Seedance 2.5 Special · NezhaGate'));
  assert.equal(seedance.children[0].textContent,'Seedance · Seedance 2.5 Special · NezhaGate');
  // Families served by a single vendor keep their plain names.
  const heygen=video.children.find(child=>child.dataset.family==='HeyGen');
  assert.ok(heygen.children[1].children.every(chip=>!chip.textContent.includes('(oficial)')));
});
