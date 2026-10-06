import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBudgetSettings, budgetSettings, newBudgetDraft, saveBudget, calculateBudget, refreshBudgetPrices } from '../public/budget-model.js';
import { budgetHtml, budgetCatalog } from '../lib/budget-pdf.js';
import { exportBudgetSettings, importBudgetSettings } from '../lib/budget-transfer.js';

test('single video charges first minute once, prorates extra time, and shares services', async () => {
  const settings = defaultBudgetSettings();
  settings.rates.singleVideo = {firstMinute:100, additionalMinute:40};
  settings.rates.soundMix.price = 20;
  settings.rates.music = {provided:10,create:20,unit:'episode',revisions:2};
  const draft = {...newBudgetDraft(),product:'single-video',client:'Client',title:'Promo',durationMinutes:10,soundMix:'professional'};
  const quote = saveBudget(draft, settings, null, {id:'single'});
  assert.equal(quote.episodes.length,1);
  assert.equal(quote.totals.minutes,10);
  assert.equal(quote.totals.totalCents,49000);
  assert.equal(calculateBudget({...draft,snapshot:settings}).totalCents,49000);
  for(const [duration,cost] of [[0.5,10000],[1,10000],[1.5,12000],[10,46000]]) {
    const saved=saveBudget({...draft,durationMinutes:duration},settings,null,{id:'test'});
    assert.equal(saved.totals.groups[0].baseUsdCents,cost);
  }
  for(const durationMinutes of [0,-1,NaN,1441]) assert.throws(()=>saveBudget({...draft,durationMinutes},settings));
  assert.throws(()=>saveBudget({...draft,product:'unknown'},settings));
  const changed=structuredClone(settings);changed.rates.singleVideo.firstMinute=200;
  assert.equal(saveBudget({...quote},changed,quote).totals.totalCents,49000);
  assert.equal(refreshBudgetPrices(quote,changed,quote.revision).totals.totalCents,59000);
  assert.throws(()=>saveBudget({...quote,product:'vertical-drama'},settings,quote));
  for(const locale of ['en','es']) {
    const t=await budgetCatalog(locale), html=budgetHtml(quote,t,locale);
    assert.ok(html.includes(t('budget.singleVideo')));
    assert.ok(html.includes(t('budget.firstMinute')));
    assert.ok(!html.includes(t('budget.perEpisode')));
    assert.ok(!html.includes('NaN'));
  }
});

test('individual rates migrate safely and travel in settings exports', () => {
  const settings=defaultBudgetSettings();
  settings.rates.singleVideo={firstMinute:90,additionalMinute:30};
  assert.deepEqual(importBudgetSettings(exportBudgetSettings(settings)).settings.rates.singleVideo,settings.rates.singleVideo);
  delete settings.rates.singleVideo;
  assert.deepEqual(budgetSettings(settings).rates.singleVideo,{firstMinute:0,additionalMinute:0});
});
