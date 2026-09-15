import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { BUDGET_GROUPS, defaultBudgetSettings, budgetSettings, newBudgetDraft, calculateBudget, saveBudget, setBudgetStatus, budgetEarnings } from '../public/budget-model.js';

function harness() {
  const nodes=new Map(), notices=[],calls=[];let seq=0;
  const settings=defaultBudgetSettings(); settings.usdPerEuro=1.25; settings.rates.episodes.pilot=100;settings.rates.episodes.regular=50;
  let data={settings,quotes:[]};
  const node=key=>{
    if(nodes.has(key))return nodes.get(key);
    const item={innerHTML:'',hidden:false,dataset:{},listeners:{},classList:{toggle(){}},querySelector:selector=>node(key+' '+selector),querySelectorAll:()=>[],addEventListener(type,callback){this.listeners[type]=callback;}};
    nodes.set(key,item);return item;
  };
  const context={BUDGET_GROUPS,defaultBudgetSettings,newBudgetDraft,calculateBudget,structuredClone,console,
    $:node,esc:value=>String(value??'').replaceAll('<','&lt;'),tr:(key,args={})=>key+JSON.stringify(args),toast:text=>notices.push(text),confirm:()=>true,
    i18n:{formatNumber:(value,options={})=>new Intl.NumberFormat('en',options).format(value),formatDate:()=>'',localeTag:()=> 'en',getLocale:()=> 'en'},
    window:{addEventListener(){}},fileUrl:key=>key,
    api:async(path,options={})=>{
      calls.push({path,...options});
      if(!options.method)return {...structuredClone(data),earnings:budgetEarnings(data.quotes)};
      if(path.endsWith('/settings')){data.settings=budgetSettings(options.body);return {settings:data.settings};}
      const id=path.split('/')[3];const old=data.quotes.find(quote=>quote.id===id);
      const quote=options.body.action==='status'?setBudgetStatus(old,options.body.status,options.body.revision):saveBudget(options.body,data.settings,old,{id:'q'+ ++seq});
      data.quotes=[quote,...data.quotes.filter(item=>item.id!==quote.id)];return structuredClone(quote);
    }};
  const source=fs.readFileSync(new URL('../public/budgets.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
  vm.runInNewContext(source+'\nglobalThis.testing={changeTab,saveCurrent,saveSettings,drawEarnings,getDraft:()=>draft,getSettings:()=>configDraft};',context);
  const input=(bind,value,numeric=false)=>node('#budgetPanel').listeners.input({target:{dataset:{bind},value,hasAttribute:()=>numeric}});
  const click=(action,extra={})=>{const target={dataset:{budgetAction:action,...extra},closest:()=>target};return node('#budgetPanel').listeners.click({target});};
  return {node,input,click,notices,calls,testing:context.testing,get data(){return data;}};
}
test('quote editor adds/removes episode and entity tiles and persists their fields',async()=>{
  const h=harness();await h.testing.changeTab('new');
  h.input('client','Client');h.input('title','Vertical drama');h.input('episodeCount','4',true);
  assert.equal(h.testing.getDraft().episodes.length,4);
  await h.click('remove-episode',{index:'1'});assert.equal(h.testing.getDraft().episodes.length,3);
  await h.click('add-item',{group:'characters'});h.input('characters.0.name','Elena');h.input('characters.0.species','Human');
  await h.testing.saveCurrent({preventDefault(){}});
  assert.equal(h.data.quotes.length,1);assert.equal(h.data.quotes[0].characters[0].name,'Elena');
  assert.equal(h.data.quotes[0].episodes.length,3);
  assert.match(h.node('#budgetPanel').innerHTML,/budget-tile pilot/);assert.match(h.node('#budgetPanel').innerHTML,/budget-tile final/);
});
test('duration summary updates for episode counts, pilot duration and fractional minutes',async()=>{
  const h=harness();await h.testing.changeTab('new');
  h.input('pilotMinutes','3',true);h.input('episodeMinutes','1.5',true);h.input('episodeCount','41',true);
  assert.match(h.node('#budgetDurationTotal').textContent,/"minutes":"63"/);
  assert.match(h.node('#budgetDurationTotal').textContent,/01:03:00/);
  await h.click('remove-episode',{index:'40'});
  assert.match(h.node('#budgetDurationTotal').textContent,/01:01:30/);
  h.input('episodeCount','1',true);
  assert.match(h.node('#budgetDurationTotal').textContent,/00:03:00/);
});

test('quote editor status transitions feed earnings without double-counting',async()=>{
  const h=harness();await h.testing.changeTab('new');h.input('client','Client');h.input('title','Drama');
  await h.testing.saveCurrent({preventDefault(){}});const id=h.data.quotes[0].id;
  await h.click('status',{id,status:'sent'});await h.click('status',{id,status:'paid'});
  assert.equal(h.data.quotes[0].status,'paid');assert.match(h.node('#budgetPanel').innerHTML,/<fieldset disabled>/);
  await h.testing.drawEarnings();assert.match(h.node('#earningsPanel').innerHTML,/budget.earned/);
  assert.equal(budgetEarnings(h.data.quotes).earned.count,1);
});
test('settings save the USD-per-euro value and a new EUR quote takes that rate',async()=>{
  const h=harness();await h.testing.changeTab('settings');h.input('usdPerEuro','1.5',true);h.input('rates.episodes.pilot','120',true);
  await h.testing.saveSettings({preventDefault(){}});
  await h.testing.changeTab('new');h.input('client','Client');h.input('title','Drama');h.input('currency','EUR');
  await h.testing.saveCurrent({preventDefault(){}});
  assert.equal(h.data.quotes[0].snapshot.usdPerEuro,1.5);assert.equal(h.data.quotes[0].currency,'EUR');
  assert.equal(h.data.quotes[0].totals.totalCents,22667);
});
