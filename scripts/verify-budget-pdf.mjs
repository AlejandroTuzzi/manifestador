import { mkdir, writeFile } from 'node:fs/promises';
import { defaultBudgetSettings, newBudgetDraft, saveBudget } from '../public/budget-model.js';
import { budgetHtml, budgetCatalog, renderBudgetPdf } from '../lib/budget-pdf.js';

const settings = defaultBudgetSettings();
settings.usdPerEuro = 1.2; // Synthetic test rate, not a market quote.
settings.rates.episodes = { pilot:120, regular:80, revisions:2 };
settings.rates.characters = { provided:40, create:120, revisions:3 };
settings.rates.locations.price = 70; settings.rates.objects.price = 40;
settings.rates.script.create = 400; settings.rates.voices.create = 20; settings.rates.voices.unit='episode'; settings.rates.music.create=150;
settings.footerHtml = '<p><strong>Manifestador - Production studio</strong></p><p>Contact: <a href="mailto:studio@example.com">studio@example.com</a></p><p>Two revision rounds per stage unless otherwise specified.</p>';
const draft = { ...newBudgetDraft(), client:'Example Client / Cliente de prueba', title:'The Last Promise / La última promesa', description:'A vertical drama about a family secret.\nPresupuesto de prueba: todas las tarifas son ficticias.', deadline:'2026-12-15', currency:'EUR', episodes:Array.from({length:24},()=>({})), pilotMinutes:3.5, episodeMinutes:1.5,
  characters:[{name:'Elena',sex:'Femenino / Female',species:'Humana / Human',age:'28',source:'create'},{name:'Mateo',sex:'Masculino / Male',species:'Humano / Human',age:'35',source:'provided'},{name:'Abuela / Grandmother',sex:'Femenino / Female',species:'Humana / Human',age:'72',source:'create'}],
  locations:[{name:'Palacio / Palace',type:'Interior',lighting:'Día cálido y noche azul / Warm daylight and blue night'},{name:'Bosque / Forest',type:'Exterior',lighting:'Atardecer / Sunset'}],objects:[{name:'Espada sagrada / Sacred sword',characteristics:'Gold hilt with a family crest, recurring in the pilot and finale.'}],script:'create',voices:'create',music:'create' };
draft.discounts.episodes=10; draft.discounts.characters=5;
const quote=saveBudget(draft,settings,null,{id:'pdf-review',now:0});
await mkdir(new URL('../tmp/pdfs/',import.meta.url),{recursive:true});
for(const locale of ['es','en']) {
  const header = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="550"><rect width="1920" height="550" fill="#2b193e"/><rect x="80" y="90" width="12" height="370" fill="#ec4899"/><text x="140" y="305" fill="#efe8fa" font-family="Arial" font-size="90">VERTICAL DRAMA / PDF HEADER</text></svg>').toString('base64');
  const html=budgetHtml(quote,await budgetCatalog(locale),locale,header);
  await writeFile(new URL(`../tmp/pdfs/budget-${locale}.html`,import.meta.url),html);
  await writeFile(new URL(`../tmp/pdfs/budget-${locale}.pdf`,import.meta.url),await renderBudgetPdf(html));
  process.stdout.write(`Generated budget-${locale}.pdf\n`);
}
