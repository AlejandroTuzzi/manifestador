import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS, MUSIC_MODEL } from '../lib/models.js';
import { openAIImageOptions, openAIImageUsageCost } from '../lib/openai-image-options.js';
import { generateOpenAIImage } from '../lib/providers.js';

test('new image models support existing reference/resolution flow and extended quality', () => {
  for (const variant of ['sunburst','flare']) {
    const model = IMAGE_MODELS.find(m => m.id === `gpt-image-2.5-${variant}`);
    assert.equal(model.provider, 'openai'); assert.equal(model.maxRefs, 16);
    for (const quality of ['auto','low','medium','high','xhigh','max']) {
      assert.deepEqual(openAIImageOptions({quality,background:'transparent'},model.id),{quality,background:'transparent',output_format:'png'});
    }
  }
  assert.equal(openAIImageOptions({quality:'max',background:'transparent'},'gpt-image-2').quality,'medium');
  assert.equal(openAIImageOptions({background:'transparent'},'gpt-image-2').background,'opaque');
});
test('image usage uses official token rates and does not invent missing consumption', () => {
  assert.equal(openAIImageUsageCost({input_tokens_details:{image_tokens:1000,text_tokens:100},output_tokens:2000}),0.0685);
  assert.equal(openAIImageUsageCost({}),null);
});
test('families are stable, newest-first and never drop or mutate models', () => {
  const context={};vm.runInNewContext(fs.readFileSync(new URL('../public/model-families.js',import.meta.url),'utf8'),context);
  const group=context.ManifestadorModelFamilies;
  const all=[...IMAGE_MODELS,...VIDEO_MODELS,...AUDIO_MODELS,...MUSIC_MODEL.versions.map(id=>({id,name:id.replaceAll('_','.'),provider:'suno'}))];
  const before=JSON.stringify(all);const families=group(all);
  assert.equal(families.flatMap(f=>f.models).length,all.length);
  assert.equal(JSON.stringify(all),before);
  for(const [family,id] of [['GPT Image','gpt-image-2.5-sunburst'],['Nano Banana','nano-banana-2'],['Seedance','seedance-2-5'],['ElevenLabs','eleven-v3'],['Suno','V5_5']])assert.equal(families.find(f=>f.name===family).models[0].id,id);
  assert.match(families.find(f=>f.name==='HeyGen').models[0].name,/Avatar V$/);
});
test('OpenAI generation and reference editing send extended settings directly, without network costs',async()=>{
  const saved=globalThis.fetch;
  try {
    for(const variant of ['sunburst','flare'])for(const refs of [[],['data:image/png;base64,iVBORw0KGgo=']]) {
      let seen;
      globalThis.fetch=async(url,options)=>{seen={url,options};return new Response(JSON.stringify({data:[{b64_json:'iVBORw0KGgo='}],usage:{input_tokens_details:{image_tokens:0,text_tokens:100},output_tokens:1000}}),{status:200});};
      const result=await generateOpenAIImage({apiKey:'test-only',apiModel:`gpt-image-2.5-${variant}`,prompt:'test',refPaths:refs,aspectRatio:'16:9',resolution:'2K',options:{quality:'max',background:'transparent'}});
      assert.equal(result.length,1);assert.equal(result.usageCost,0.0305);
      const body=refs.length?Object.fromEntries(seen.options.body):JSON.parse(seen.options.body);
      assert.equal(body.quality,'max');assert.equal(body.background,'transparent');assert.equal(body.output_format,'png');
      assert.match(seen.url,refs.length?/\/edits$/:/\/generations$/);
    }
  } finally {globalThis.fetch=saved;}
});
