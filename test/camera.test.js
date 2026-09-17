import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CAMERA_GROUPS, buildCameraPrompt, prependCameraPrompt } from '../public/camera-model.js';

test('camera phrases separate shot, viewing angle, focal length and depth of field', () => {
  const text=buildCameraPrompt({shot:'close',angle:'low',lens:'portrait',depth:'veryShallow'});
  assert.match(text,/close-up/);assert.match(text,/low-angle/);assert.match(text,/85mm/);assert.match(text,/very shallow depth of field/);
  assert.doesNotMatch(text,/deep focus|wide-angle/);
  assert.match(buildCameraPrompt({depth:'deep'}),/foreground and background remain sharp/);
  assert.equal(buildCameraPrompt({shot:'unknown',angle:'<script>'}), '');
});
test('camera prepends without changing spaces, reference tags, selection text or line breaks', () => {
  for(const original of ['', '  @Image1, un personaje\ncon un anillo  ', '<b>hello</b>']) {
    assert.equal(prependCameraPrompt(original,{}),original);
    assert.equal(prependCameraPrompt(original,{shot:'detail'}),buildCameraPrompt({shot:'detail'})+', '+original);
  }
  assert.equal(buildCameraPrompt({motion:'orbit'},'image'),'');
  assert.equal(buildCameraPrompt({motion:'orbit'},'comfyui'),'');
  assert.match(buildCameraPrompt({motion:'orbit'},'video'),/orbit/);
});
test('all camera options and groups have Spanish and English labels', () => {
  for(const locale of ['es','en']) {
    let catalog;
    vm.runInNewContext(fs.readFileSync(new URL(`../public/locales/${locale}.js`,import.meta.url),'utf8'),{window:{ManifestadorI18n:{register:(_,value)=>catalog=value}}});
    for(const group of CAMERA_GROUPS) {
      assert.ok(catalog[`camera.group.${group.id}`]);
      for(const option of group.options)assert.ok(catalog[`camera.option.${group.id}.${option.id}`]);
    }
  }
});
test('camera dialog previews, inserts at start, updates prompt input and keeps video-only controls out of images', () => {
  const nodes=new Map();
  function node(id='') {
    if(id && nodes.has(id))return nodes.get(id);
    const n={id,value:'',children:[],dataset:{},events:{},open:false,disabled:false,
      append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},
      addEventListener(type,fn){this.events[type]=fn;},showModal(){this.open=true;},close(){this.open=false;},focus(){},
      setRangeText(text,start,end){assert.equal(start,0);assert.equal(end,0);this.value=text+this.value;},
      dispatchEvent(event){this.dispatched=event.type;}};
    if(id)nodes.set(id,n);return n;
  }
  const context={CAMERA_GROUPS,buildCameraPrompt,state:{mode:'image'},tr:key=>key,Event:class{constructor(type){this.type=type;}},
    document:{getElementById:node,createElement:()=>node(),querySelector:()=>null},window:{addEventListener(){}}};
  const code=fs.readFileSync(new URL('../public/camera.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'');
  vm.runInNewContext(code,context);
  node('btnCamera').events.click();assert.equal(node('cameraDialog').open,true);assert.equal(node('cameraInsert').disabled,true);
  assert.equal(node('cameraFields').children.length,CAMERA_GROUPS.length-1);
  const select=node('cameraFields').children[0].children[1];select.value='close';select.events.change();
  assert.equal(node('cameraInsert').disabled,false);
  const original='@Image1\nEl personaje original';node('promptBox').value=original;
  node('cameraForm').events.submit({preventDefault(){}});
  assert.equal(node('promptBox').value,buildCameraPrompt({shot:'close'})+', '+original);
  assert.equal(node('promptBox').dispatched,'input');assert.equal(node('cameraDialog').open,false);
  context.state.mode='video';node('btnCamera').events.click();assert.equal(node('cameraFields').children.length,CAMERA_GROUPS.length);
  node('cameraReset').events.click();assert.equal(node('cameraPreview').value,'');assert.equal(node('cameraInsert').disabled,true);
});
