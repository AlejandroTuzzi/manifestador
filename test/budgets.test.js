import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { BUDGET_GROUPS, defaultBudgetSettings, budgetSettings, newBudgetDraft, saveBudget,refreshBudgetPrices, setBudgetStatus, budgetEarnings, budgetError, calculateBudget } from '../public/budget-model.js';
import { safeBudgetFooter, budgetHtml, budgetCatalog, budgetPdfFilename } from '../lib/budget-pdf.js';

test('PDF filenames include creation date, client and drama with safe underscores',()=>{
  const quote={createdAt:Date.UTC(2026,8,14),client:'Eduardo Px G',title:'La última promesa'};
  assert.equal(budgetPdfFilename(quote),'budget_2026-09-14_Eduardo_Px_G_La_última_promesa.pdf');
  assert.equal(budgetPdfFilename({...quote,client:' ACME / Studio ',title:'Drama: "Uno"\nDos?'}),'budget_2026-09-14_ACME_Studio_Drama_Uno_Dos.pdf');
});

function fixture(currency = 'USD') {
  const settings=defaultBudgetSettings(); settings.usdPerEuro=1.25;
  settings.rates.episodes={pilot:100,regular:50,revisions:2};
  settings.rates.characters={provided:20,create:80,revisions:3};
  settings.rates.locations.price=30;settings.rates.objects.price=10;
  settings.rates.script.create=100;settings.rates.voices={provided:2,create:5,unit:'minute',revisions:1};settings.rates.music={provided:10,create:20,unit:'episode',revisions:2};
  const body={...newBudgetDraft(),client:'Client',title:'Drama',currency,pilotMinutes:3,episodeMinutes:2,episodes:[{},{},{}],characters:[{name:'A',source:'provided'},{name:'B',source:'create'}],locations:[{name:'Palace'}],objects:[{name:'Sword'}],script:'create',voices:'create',music:'create'};
  body.discounts.characters=10;
  return {settings,body,quote:saveBudget(body,settings,null,{id:'q1',now:1})};
}
test('quote calculation includes pilot and finale, provided versus created materials, billing units and group discounts',()=>{
  const {quote}=fixture();
  assert.equal(quote.episodes.length,3);assert.equal(quote.episodes[0].pilot,true);assert.equal(quote.episodes[2].final,true);
  assert.equal(quote.totals.minutes,7);
  assert.equal(quote.totals.groups.find(row=>row.group==='episodes').totalCents,50000);
  assert.equal(quote.totals.groups.find(row=>row.group==='characters').totalCents,9000);
  assert.equal(quote.totals.groups.find(row=>row.group==='voices').totalCents,1000);
  assert.equal(quote.totals.groups.find(row=>row.group==='music').totalCents,6000);
  assert.equal(quote.totals.totalUsdCents,80000);
  assert.equal(quote.totals.totalCents,80000);
});
test('voices charge once per character, independent of runtime, with discounts and legacy snapshots preserved',()=>{
  const {quote}=fixture();
  const cost=q=>calculateBudget(q).groups.find(row=>row.group==='voices').totalUsdCents;
  assert.equal(cost(quote),1000);
  assert.equal(cost({...quote,episodes:Array(50).fill({}),episodeMinutes:30}),1000);
  assert.equal(cost({...quote,characters:[]}),0);
  assert.equal(cost({...quote,characters:[...quote.characters,{name:'C',source:'create'}]}),1500);
  assert.equal(cost({...quote,voices:'provided'}),400);
  assert.equal(cost({...quote,discounts:{...quote.discounts,voices:20}}),800);
  const legacy=structuredClone(quote);legacy.snapshot.rates.voices.unit='minute';
  assert.equal(cost(legacy),3500);
});

test('refresh prices recalculates drafts without changing FX, discounts, terms or original data',()=>{
  const {quote,settings}=fixture('EUR');const original=JSON.stringify(quote);
  settings.rates.characters.create=180;settings.rates.characters.revisions=99;settings.usdPerEuro=9;
  const updated=refreshBudgetPrices(quote,settings,quote.revision,20);
  assert.equal(JSON.stringify(quote),original);
  assert.equal(updated.totals.totalUsdCents,quote.totals.totalUsdCents+9000);
  assert.equal(updated.totals.totalCents,quote.totals.totalCents+7200);
  assert.equal(updated.snapshot.usdPerEuro,1.25);
  assert.equal(updated.snapshot.rates.characters.revisions,3);
  assert.deepEqual(updated.discounts,quote.discounts);
  assert.equal(updated.revision,quote.revision+1);
  assert.throws(()=>refreshBudgetPrices(updated,settings,quote.revision),{localizationCode:'budgetConflict'});
  for(const status of ['sent','paid','cancelled'])assert.throws(()=>refreshBudgetPrices({...quote,status},settings,quote.revision),{localizationCode:'budgetRefreshDraftOnly'});
});

test('EUR conversion snapshots the manually configured rate and prices, ignoring subsequent settings and client totals',()=>{
  const {quote,body,settings}=fixture('EUR');
  assert.equal(quote.totals.totalCents,64000);
  settings.usdPerEuro=2;settings.rates.episodes.pilot=999;
  const next=saveBudget({...body,revision:quote.revision,title:'Edited',snapshot:settings,totals:{totalCents:1},currency:'USD'},settings,quote,{now:2});
  assert.equal(next.currency,'EUR');assert.equal(next.snapshot.usdPerEuro,1.25);assert.equal(next.totals.totalCents,64000);
  const createdLater=saveBudget(body,settings,null,{id:'q2'});
  assert.equal(createdLater.snapshot.usdPerEuro,2);assert.notEqual(createdLater.totals.totalCents,quote.totals.totalCents);
});
test('settings and quote validation reject missing rates, invalid numbers, dates and unnamed elements',()=>{
  const {body,settings}=fixture();
  assert.throws(()=>saveBudget({...body,currency:'EUR'},defaultBudgetSettings(),null,{id:'q'}),{localizationCode:'budgetEuroRate'});
  for(const patch of [{pilotMinutes:0},{episodeMinutes:-1},{discounts:{episodes:101}},{discounts:{music:NaN}},{episodes:[]},{episodes:Array(501).fill({})},{characters:[{name:''}]},{deadline:'2026-02-30'},{deadline:'2026-99-99'},{currency:'GBP'},{client:''}])assert.throws(()=>saveBudget({...body,...patch},settings,null,{id:'q'}));
  assert.throws(()=>budgetSettings({...settings,usdPerEuro:0}));
  assert.throws(()=>budgetSettings({...settings,headerImage:'uploads/../../secret.png'}));
  const single=saveBudget({...body,episodes:[{}]},settings,null,{id:'q'});assert.equal(single.episodes[0].pilot,true);assert.equal(single.episodes[0].final,true);assert.equal(single.totals.minutes,3);
});
test('paid and cancelled states archive quotes, reject further edits, and earnings exclude cancellations',()=>{
  const {quote,body,settings}=fixture();
  const sent=setBudgetStatus(quote,'sent',1,2), paid=setBudgetStatus(sent,'paid',2,3);
  assert.equal(paid.paidAt,3);assert.equal(paid.revision,3);
  const cancelled=setBudgetStatus({...sent,id:'q2'},'cancelled',sent.revision,4);
  const summary=budgetEarnings([quote,{...sent,id:'q3'},paid,cancelled]);
  assert.deepEqual(summary,{active:{count:1,usdCents:80000},potential:{count:1,usdCents:80000},earned:{count:1,usdCents:80000}});
  assert.throws(()=>setBudgetStatus(paid,'paid',paid.revision),{localizationCode:'budgetStatus'});
  assert.throws(()=>saveBudget({...body,revision:paid.revision},settings,paid),{localizationCode:'budgetArchived'});
  assert.throws(()=>saveBudget({...body,revision:0},settings,quote),{localizationCode:'budgetConflict'});
});
test('footer HTML keeps safe formatting and links but strips executable content and attributes',()=>{
  const html=safeBudgetFooter('<p onclick="evil()">Contact <strong>Studio</strong><script>alert(1)</script><a href="javascript:alert(2)">bad</a><a href="https://example.com" onclick="evil()">good</a><img src="https://tracker"></p>');
  assert.match(html,/<strong>Studio<\/strong>/);assert.match(html,/<a href="https:\/\/example.com">good<\/a>/);
  assert.doesNotMatch(html,/script|onclick|javascript:|<img|alert/);
});
test('PDF HTML uses escaped user text, the saved prices, both languages and all visual groups',async()=>{
  const {quote}=fixture('EUR');quote.title='<img src=x onerror=alert(1)>';
  for(const locale of ['es','en']){
    const html=budgetHtml(quote,await budgetCatalog(locale),locale);
    assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/episode-grid/);
    assert.doesNotMatch(html,/>budget\.[a-zA-Z]/);assert.match(html,/Content-Security-Policy/);
    assert.match(html,/1 EUR = 1[.,]25 USD/);
    const average=new Intl.NumberFormat(locale,{style:'currency',currency:quote.currency}).format(quote.totals.totalCents/100/quote.episodes.length);
    assert.ok(html.includes(average));
    assert.match(html,/class="per-episode"/);
    assert.match(html,/@page\s*\{[^}]*background:\s*#100a19;/);
  }
});
test('PDF uses current footer for older quotes with no footer and preserves saved footers',async()=>{
  const {quote}=fixture();
  const original=JSON.stringify(quote);
  const t=await budgetCatalog('en');
  const settings={footerHtml:'<p>Current contact</p><script>evil()</script>'};
  assert.match(budgetHtml(quote,t,'en','',settings),/<footer><p>Current contact<\/p><\/footer>/);
  assert.equal(JSON.stringify(quote),original);
  quote.snapshot.footerHtml='<p>Saved conditions</p>';
  assert.match(budgetHtml(quote,t,'en','',settings),/<footer><p>Saved conditions<\/p><\/footer>/);
});

test('all budget UI, PDF and validation translation keys exist in both catalogs',async()=>{
  const sources=['public/budgets.js','lib/budget-pdf.js','public/budget-model.js'].map(file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')).join('\n');
  const keys=[...sources.matchAll(/\b(?:bt|h|label|field|area|select)\('([a-zA-Z]+)'/g)].map(match=>'budget.'+match[1]);
  keys.push(...[...sources.matchAll(/budgetError\('([^']+)'/g)].map(match=>'errors.'+match[1]),...BUDGET_GROUPS.map(group=>'budget.'+group));
  for(const locale of ['es','en']){const t=await budgetCatalog(locale);for(const key of keys)assert.notEqual(t(key),key,key);}
});
test('budget routes persist quotes and status changes atomically without creating tasks or modifying other stores',async()=>{
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const source=server.slice(server.indexOf("    if (p === '/api/budgets'"),server.indexOf("    if (p === '/api/series-inspiration/export'"));
  const {body,settings}=fixture();let data={settings,quotes:[]};let serial=0;
  const run=(p,method,payload={})=>vm.runInNewContext(`(async()=>{${source}})()`,{p,req:{method},res:{},readJsonBody:async()=>payload,readJson:async(file)=>{assert.equal(file,'budgets.json');return structuredClone(data);},updateJson:async(file,fallback,fn)=>{assert.equal(file,'budgets.json');data=await fn(structuredClone(data));return data;},send:(_,status,value)=>value,newId:()=>`q${++serial}`,budgetSettings,defaultBudgetSettings,saveBudget,refreshBudgetPrices,setBudgetStatus,budgetEarnings,budgetError});
  const saved=await run('/api/budgets','POST',body);assert.equal(saved.totals.totalCents,80000);
  const sent=await run('/api/budgets/'+saved.id,'PUT',{action:'status',status:'sent',revision:1});
  await run('/api/budgets/'+saved.id,'PUT',{action:'status',status:'paid',revision:sent.revision});
  const result=await run('/api/budgets','GET');assert.equal(result.quotes.length,1);assert.equal(result.earnings.earned.usdCents,80000);
  await assert.rejects(run('/api/budgets/missing','PUT',body),{localizationCode:'budgetNotFound'});
});
