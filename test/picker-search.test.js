import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('reference search filters existing cards instantly without changing selection or rebuilding media', () => {
  const source = fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const cards = ['Ángela','Diana','Alberta'].map(name => ({ hidden:false, dataset:{}, querySelector:() => ({ textContent:name }) }));
  const empty = { hidden:true }, input = { value:'ANGELA' };
  const body = { querySelectorAll:() => cards, querySelector:() => empty };
  const ctx = vm.createContext({ $:key => key === '#pickerBody' ? body : input,
    normalizedAssetFilterText:value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(), tr:key => key });
  vm.runInContext(source.slice(source.indexOf('function filterPickerCards()'),source.indexOf('function renderEntityPicker(')),ctx);
  ctx.filterPickerCards(); assert.deepEqual(cards.map(c => c.hidden),[false,true,true]);
  input.value = 'missing'; ctx.filterPickerCards(); assert.equal(empty.hidden,false);
  input.value = ''; ctx.filterPickerCards(); assert.ok(cards.every(c => !c.hidden)); assert.equal(empty.hidden,true);
});
