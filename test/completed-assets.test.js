import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('completed series and projects hide assets unless their completed owner is explicitly selected', () => {
  const source = fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const state = { series:[{ id:'s',archived:true,assetKeys:['video/shared.mp4'] },{ id:'active',assetKeys:['video/shared.mp4'] }], workspaceProjects:[{ id:'p',archived:true,assetKeys:['video/project.mp4'] }], assetsZone:'video', assets:{ video:['free','shared','project'].map(name=>({ key:`video/${name}.mp4` })) },assetRange:{} };
  const ctx = vm.createContext({ state, normalizedAssetFilterText:v=>String(v||''),splitVisualTags:()=>[],
    assetMatchesCharacter:()=>true,assetMatchesSeries:(a,id)=>!id||state.series.find(s=>s.id===id).assetKeys.includes(a.key),
    assetMatchesProject:(a,id)=>!id||state.workspaceProjects.find(p=>p.id===id).assetKeys.includes(a.key) });
  vm.runInContext(source.slice(source.indexOf('function visibleAssets()'),source.indexOf('function toggleAssetSelection(')),ctx);
  const keys = () => Array.from(ctx.visibleAssets(),a=>a.key);
  assert.deepEqual(keys(),['video/free.mp4']);
  state.assetFilterSeriesId='active'; assert.deepEqual(keys(),[]);
  state.assetFilterSeriesId='s'; assert.deepEqual(keys(),['video/shared.mp4']);
  state.assetFilterSeriesId=''; state.assetFilterProjectId='p'; assert.deepEqual(keys(),['video/project.mp4']);
  state.assetFilterProjectId=''; state.series[0].archived=false; state.workspaceProjects[0].archived=false;
  assert.equal(keys().length,3);
});
