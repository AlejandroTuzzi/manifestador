import test from 'node:test';
import assert from 'node:assert/strict';
import {ideaPdfHtml,ideaPdfFilename} from '../lib/idea-pdf.js';
import {budgetCatalog} from '../lib/budget-pdf.js';
test('idea PDF includes complete text, character fields, episodes and ranges in both languages', async()=>{
  const idea={name:'La última oportunidad',development:'FULL STORY '.repeat(1000)+'STORY END',characters:[{name:'Ana',sex:'Female',physical:'Tall',profession:'Doctor',relationships:'Sister',role:'Lead',description:'History',emotionalLever:'Family'}],outline:{episodes:[{name:'Opening',description:'EPISODE FULL '.repeat(400)+'EPISODE END',duration:1.5},{name:'Ending',description:'Resolution',duration:null}],ranges:[{name:'Power shift',start:1,end:2}]}};
  for(const locale of ['es','en']) {
    const html=ideaPdfHtml(idea,'Drama',await budgetCatalog(locale),locale);
    for(const text of ['STORY END','EPISODE END',...Object.values(idea.characters[0]),'Power shift','Resolution'])assert.ok(html.includes(text));
    assert.ok(html.includes(locale==='en'?'Pilot':'Piloto'));
    assert.ok(html.includes(locale==='en'?'Finale':'Final'));
    assert.doesNotMatch(html,/<canvas|<img|outline-tile/);
  }
});
test('PDF escapes user markup, supports old ideas and safe Unicode filenames',async()=>{
  const html=ideaPdfHtml({name:'<script>bad</script>',development:'<img src=x>'},'',await budgetCatalog('en'),'en');
  assert.doesNotMatch(html,/<script>|<img /);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/No items recorded/);
  assert.equal(ideaPdfFilename({name:'Una / idea: final'}),'idea_Una_idea_final.pdf');
});
