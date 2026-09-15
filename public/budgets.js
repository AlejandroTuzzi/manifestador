import { BUDGET_GROUPS, defaultBudgetSettings, newBudgetDraft, calculateBudget } from './budget-model.js';

let library = { settings:defaultBudgetSettings(), quotes:[], earnings:{} };
let tab = 'new', draft = null, configDraft = null, configGroup = 'episodes', busy = false, dirty = false, earningsActive = false;
let requestNumber = 0;
const panel = $('#budgetPanel');
const bt = (key, args = {}) => tr(`budget.${key}`, args);
const h = key => esc(bt(key));
const money = (cents, currency = 'USD') => i18n.formatNumber(cents / 100, { style:'currency', currency });
const button = (action, key, extra = '') => `<button type="button" class="tool-btn" data-budget-action="${action}" ${extra}>${h(key)}</button>`;
const field = (key, bind, value, type = 'text', extra = '') => `<label><span>${h(key)}</span><input type="${type}" data-bind="${bind}" value="${esc(value ?? '')}" ${type === 'number' ? `data-number min="${bind === 'episodeCount' ? 1 : ['pilotMinutes','episodeMinutes','usdPerEuro'].includes(bind) ? 0.000001 : 0}" step="${bind === 'episodeCount' || bind.endsWith('.revisions') ? 1 : 'any'}"` : ''} ${extra}></label>`;
const area = (key, bind, value, max = 10000) => `<label><span>${h(key)}</span><textarea data-bind="${bind}" maxlength="${max}">${esc(value || '')}</textarea></label>`;
const select = (key, bind, value, choices, extra = '') => `<label><span>${h(key)}</span><select class="select" data-bind="${bind}" ${extra}>${choices.map(choice => `<option value="${choice}"${value === choice ? ' selected' : ''}>${esc(['USD','EUR'].includes(choice) ? choice : bt(choice))}</option>`).join('')}</select></label>`;
const readonly = () => ['paid','cancelled'].includes(draft?.status);

async function refresh() {
  const version = ++requestNumber;
  const result = await api('/api/budgets');
  if (version !== requestNumber) return;
  library = result; library.settings.rates.voices.unit = 'character';
}
function drawTabs() {
  $('#budgetTabs').innerHTML = ['new','sentQuotes','archived','settings'].map(key => `<button type="button" class="tool-btn${tab === key ? ' active' : ''}" data-tab="${key}" aria-pressed="${tab === key}">${h(key)}</button>`).join('');
}
async function changeTab(next) {
  if (busy || (dirty && !confirm(bt('discard')))) return;
  tab = next; draft = null; configDraft = null; dirty = false; drawTabs();
  panel.innerHTML = `<p class="hint">${h('loading')}</p>`;
  try { await refresh(); draw(); } catch (error) { panel.innerHTML = `<p class="hint">${esc(error.message)}</p>${button('retry','retry')}`; }
}
function draftTotals() {
  return calculateBudget({ ...draft, snapshot:draft.snapshot || library.settings });
}
function budgetDurationClock(minutes) {
  const seconds = Math.round(minutes * 60);
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
    .map(value => i18n.formatNumber(value, {minimumIntegerDigits:2, maximumFractionDigits:0, useGrouping:false})).join(':');
}
function discount(group) { return field('discountPercent', 'discounts.' + group, draft.discounts[group], 'number', 'max="100"'); }
function groupSection(group, body) {
  return `<section class="budget-section ${group}"><h3>${h(group)}</h3>${body}<div class="budget-group-foot">${discount(group)}<span class="hint" data-group-price="${group}"></span></div></section>`;
}
function episodeTiles(frozen = readonly()) { return draft.episodes.map((episode,index) => `<article class="budget-tile ${index === 0 ? 'pilot' : index === draft.episodes.length - 1 ? 'final' : ''}"><strong>${i18n.formatNumber(index + 1)}</strong><span>${index === 0 ? h('pilot') : ''}${index === draft.episodes.length - 1 ? ' ' + h('final') : ''}</span><small>${i18n.formatNumber(index === 0 ? draft.pilotMinutes : draft.episodeMinutes)} min</small>${!frozen && draft.episodes.length > 1 ? button('remove-episode','remove',`data-index="${index}"`) : ''}</article>`).join(''); }
function drawEditor() {
  draft ||= newBudgetDraft();
  const frozen = readonly();
  const entities = ['characters','locations','objects'].map(group => groupSection(group,
    `<div class="budget-tiles">${draft[group].map((item,index) => `<article class="budget-tile ${group}"><div class="budget-tile-head"><strong>${h(group)} ${i18n.formatNumber(index + 1)}</strong>${frozen ? '' : button('remove-item','remove', `data-group="${group}" data-index="${index}"`)}</div>${field('name',`${group}.${index}.name`,item.name,'text','required maxlength="200"')}
    ${group === 'characters' ? field('sex',`${group}.${index}.sex`,item.sex,'text','maxlength="100"') + field('species',`${group}.${index}.species`,item.species,'text','maxlength="100"') + field('age',`${group}.${index}.age`,item.age,'text','maxlength="100"') + select('source',`${group}.${index}.source`,item.source,['provided','create'])
    : group === 'locations' ? field('locationType',`${group}.${index}.type`,item.type,'text','maxlength="200"') + area('lighting',`${group}.${index}.lighting`,item.lighting,1000)
    : area('characteristics',`${group}.${index}.characteristics`,item.characteristics,1000)}</article>`).join('')}</div>${frozen ? '' : button('add-item','add',`data-group="${group}"`)}`)).join('');
  panel.innerHTML = `<form id="budgetForm"><div class="budget-heading"><div><h2>${h('verticalDrama')}</h2><span class="hint">${h(draft.status || 'draft')}</span></div>${draft.id ? button('pdf','pdf',`data-id="${draft.id}"`) : ''}</div>
    <fieldset ${frozen ? 'disabled' : ''}><div class="budget-fields">
    ${field('client','client',draft.client,'text','required maxlength="200"')}${field('dramaName','title',draft.title,'text','required maxlength="200"')}
    ${select('currency','currency',draft.currency,['USD','EUR'],draft.id ? 'disabled' : '')}${field('deadline','deadline',draft.deadline,'date')}
    </div>${area('description','description',draft.description)}<p class="hint">${h('snapshotHint')}</p>
    ${groupSection('episodes',`<div class="budget-fields">${field('episodeCount','episodeCount',draft.episodes.length,'number','max="500" required')}${field('pilotMinutes','pilotMinutes',draft.pilotMinutes,'number','max="1440" required')}${field('episodeMinutes','episodeMinutes',draft.episodeMinutes,'number','max="1440" required')}</div>
      <div class="budget-episodes">${episodeTiles(frozen)}</div><p id="budgetDurationTotal" aria-live="polite"></p>${!frozen ? button('add-episode','addEpisode') : ''}<p class="hint">${h('episodeHint')}</p>`)}
    ${entities}${['script','voices','music'].map(group => groupSection(group, select('source',group,draft[group],['provided','create']) + (group === 'voices' && (draft.snapshot || library.settings).rates.voices.unit === 'character' ? `<p class="hint">${h('voicePerCharacter')}</p>` : ''))).join('')}
    </fieldset><div id="budgetTotals" class="budget-section"></div><p class="hint">${h('taxHint')}</p><div class="budget-actions">${!frozen ? '<button type="submit" class="generate-btn small">' + h('save') + '</button>' : ''}${draft.id && draft.status === 'draft' ? button('status','markSent',`data-id="${draft.id}" data-status="sent"`) : ''}${draft.id && draft.status === 'sent' ? button('status','markPaid',`data-id="${draft.id}" data-status="paid"`) : ''}${draft.id && !frozen ? button('status','cancelQuote',`data-id="${draft.id}" data-status="cancelled"`) : ''}</div></form>`;
  $('#budgetForm').onsubmit = saveCurrent;
  drawTotals();
}
function drawTotals() {
  try {
    const totals = draftTotals();
    if (!Number.isFinite(totals.totalCents)) throw 0;
    $('#budgetDurationTotal').textContent = bt('totalDuration', {minutes:i18n.formatNumber(totals.minutes, {maximumFractionDigits:3}), clock:budgetDurationClock(totals.minutes)});
    $('#budgetTotals').innerHTML = `<h3>${h('breakdown')}</h3><div class="budget-table-wrap"><table><thead><tr>${['group','base','discount','subtotal','revisions'].map(key => `<th>${h(key)}</th>`).join('')}</tr></thead><tbody>${totals.groups.map(row => `<tr><td>${h(row.group)}</td><td>${money(row.baseCents,draft.currency)}</td><td>${money(row.discountCents,draft.currency)}</td><td>${money(row.totalCents,draft.currency)}</td><td>${i18n.formatNumber((draft.snapshot || library.settings).rates[row.group].revisions)}</td></tr>`).join('')}</tbody></table></div><h2>${h('total')}: ${money(totals.totalCents,draft.currency)}</h2><p class="budget-per-episode">${h('perEpisode')}: <strong>${money(totals.totalCents / draft.episodes.length,draft.currency)}</strong></p>${draft.currency === 'EUR' ? `<p>1 EUR = ${i18n.formatNumber((draft.snapshot || library.settings).usdPerEuro)} USD</p>` : ''}${totals.groups.some(row => row.baseUsdCents === 0) ? `<p class="hint">${h('zeroHint')}</p>` : ''}`;
    for (const row of totals.groups) panel.querySelector(`[data-group-price="${row.group}"]`).textContent = money(row.totalCents,draft.currency);
    panel.querySelectorAll('.budget-episodes small').forEach((node,index) => { node.textContent = i18n.formatNumber(index === 0 ? draft.pilotMinutes : draft.episodeMinutes) + ' min'; });
  } catch { $('#budgetTotals').innerHTML = `<p class="hint">${h('checkValues')}</p>`; }
}
function drawList() {
  const archived = tab === 'archived';
  panel.innerHTML = `${field('search','search','','search')}<div id="budgetQuoteList" class="budget-tiles"></div>`;
  const render = query => {
    const quotes = library.quotes.filter(quote => (archived ? ['paid','cancelled'] : ['draft','sent']).includes(quote.status) && `${quote.client} ${quote.title}`.toLocaleLowerCase(i18n.localeTag()).includes(query.toLocaleLowerCase(i18n.localeTag())));
    $('#budgetQuoteList').innerHTML = quotes.map(quote => `<article class="budget-tile"><h3>${esc(quote.title)}</h3><p>${esc(quote.client)}</p><span class="budget-status ${quote.status}">${h(quote.status)}</span><h3>${money(quote.totals.totalCents,quote.currency)}</h3><p class="hint">${h('deadline')}: ${quote.deadline ? esc(i18n.formatDate(new Date(quote.deadline + 'T12:00:00'),{dateStyle:'medium'})) : h('notSet')}</p><div class="budget-actions">${button('edit',archived?'view':'edit',`data-id="${quote.id}"`)}${button('pdf','pdf',`data-id="${quote.id}"`)}${quote.status === 'draft' ? button('refresh-prices','refreshPrices',`data-id="${quote.id}"`) : ''}${quote.status === 'draft' ? button('status','markSent',`data-id="${quote.id}" data-status="sent"`) : ''}${quote.status === 'sent' ? button('status','markPaid',`data-id="${quote.id}" data-status="paid"`) : ''}${!archived ? button('status','cancelQuote',`data-id="${quote.id}" data-status="cancelled"`) : ''}</div></article>`).join('') || `<p class="hint">${h('empty')}</p>`;
  };
  panel.querySelector('[data-bind="search"]').oninput = event => render(event.target.value);
  render('');
}
function drawSettings() {
  configDraft ||= structuredClone(library.settings);
  const rate = configDraft.rates[configGroup];
  panel.innerHTML = `<form id="budgetSettingsForm"><h2>${h('settings')}</h2><p class="hint">${h('ratesHint')}</p><div class="budget-fields">${field('euroRate','usdPerEuro',configDraft.usdPerEuro,'number','max="10000"')}
    <label><span>${h('headerImage')}</span><input id="budgetHeaderUpload" type="file" accept="image/png,image/jpeg,image/webp"></label></div><p class="hint">${h('headerHint')}</p>${configDraft.headerImage ? `<img class="budget-banner" src="${fileUrl(configDraft.headerImage)}" alt="">${button('remove-header','remove')}` : ''}
    <div class="budget-tabs">${BUDGET_GROUPS.map(group => `<button type="button" class="tool-btn${configGroup===group?' active':''}" data-budget-action="rate-group" data-group="${group}">${h(group)}</button>`).join('')}</div>
    <section class="budget-section ${configGroup}"><h3>${h(configGroup)} · USD</h3><div class="budget-fields">${Object.entries(rate).map(([key,value]) => key === 'unit' ? select('billingUnit',`rates.${configGroup}.${key}`,configGroup === 'voices' ? 'character' : value,configGroup === 'voices' ? ['character'] : ['fixed','minute','episode']) : field(key === 'revisions' ? 'revisions' : configGroup === 'episodes' ? key + 'Rate' : key === 'price' ? 'unitPrice' : key + 'Price',`rates.${configGroup}.${key}`,value,'number',key === 'revisions' ? 'max="100"' : '')).join('')}</div></section>
    ${area('footerHtml','footerHtml',configDraft.footerHtml,12000)}<p class="hint">${h('footerHint')}</p><button type="submit" class="generate-btn small">${h('saveSettings')}</button></form>`;
  $('#budgetSettingsForm').onsubmit = saveSettings;
  $('#budgetHeaderUpload').onchange = async event => {
    const file = event.target.files[0]; if (!file || busy) return;
    if (file.size > 10 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) { toast(bt('imageError'),'err'); return; }
    setBusy(true);
    try {
      const result = await api('/api/assets/visual',{method:'POST',body:{name:file.name,dataUrl:await readFileAsDataUrl(file),nsfw:false}});
      configDraft.headerImage = result.key; dirty=true; drawSettings();
    } catch(error) { toast(error.message,'err'); } finally { setBusy(false); }
  };
}
function draw() { drawTabs(); if (tab === 'settings') drawSettings(); else if (tab === 'new') drawEditor(); else drawList(); }
function setBusy(value) {
  busy = value;
  panel.querySelectorAll('button,input,select,textarea').forEach(node => { node.disabled = value || (readonly() && !!node.closest('fieldset')) || (!!draft?.id && node.dataset.bind === 'currency'); });
}
async function saveCurrent(event) {
  event.preventDefault(); if (busy || readonly()) return;
  setBusy(true);
  try {
    const quote = await api('/api/budgets' + (draft.id ? '/' + draft.id : ''),{method:draft.id?'PUT':'POST',body:draft});
    library.quotes = [quote,...library.quotes.filter(item=>item.id!==quote.id)]; draft=structuredClone(quote); dirty=false; drawEditor(); toast(bt('saved'));
  } catch(error) { toast(error.message,'err'); } finally { setBusy(false); }
}
async function saveSettings(event) {
  event.preventDefault(); if (busy) return; setBusy(true);
  try { const result=await api('/api/budgets/settings',{method:'PUT',body:configDraft}); library.settings=result.settings; configDraft=structuredClone(result.settings); dirty=false; toast(bt('saved')); }
  catch(error) { toast(error.message,'err'); } finally { setBusy(false); }
}
async function downloadPdf(id) {
  const response = await fetch(`/api/budgets/${id}/pdf?lang=${i18n.getLocale()}`);
  if (!response.ok) throw new Error(i18n.errorMessage(await response.json()));
  const disposition = response.headers.get('Content-Disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : disposition.match(/filename="([^"]+)"/i)?.[1] || `budget_${id}.pdf`;
  const url=URL.createObjectURL(await response.blob()), anchor=document.createElement('a'); anchor.href=url; anchor.download=filename; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
panel.addEventListener('input',event=>{
  const bind=event.target.dataset.bind; if (!bind || bind==='search' || busy) return;
  const object=tab==='settings'?configDraft:draft; if(!object)return;
  if(bind==='episodeCount') {
    const count=Number(event.target.value); if(!Number.isInteger(count)||count<1||count>500)return;
    draft.episodes=Array.from({length:count},()=>({})); dirty=true;
    panel.querySelector('.budget-episodes').innerHTML=episodeTiles(); drawTotals(); return;
  }
  const path=bind.split('.'), key=path.pop(); let target=object; for(const part of path)target=target[part];
  target[key]=event.target.hasAttribute('data-number') ? (bind==='usdPerEuro' && event.target.value===''?null:Number(event.target.value)) : event.target.value;
  dirty=true; if(draft && tab==='new')drawTotals();
});
panel.addEventListener('click',async event=>{
  const target=event.target.closest('[data-budget-action]'); if(!target||busy)return;
  const action=target.dataset.budgetAction;
  try {
    if(action==='retry'){await changeTab(tab);return;}
    if(action==='add-episode'){if(draft.episodes.length<500){draft.episodes.push({});dirty=true;drawEditor();}return;}
    if(action==='remove-episode'){if(draft.episodes.length>1){draft.episodes.splice(Number(target.dataset.index),1);dirty=true;drawEditor();}return;}
    if(action==='add-item'){const group=target.dataset.group;if(draft[group].length<200){draft[group].push(group==='characters'?{name:'',sex:'',species:'',age:'',source:'create'}:group==='locations'?{name:'',type:'',lighting:''}:{name:'',characteristics:''});dirty=true;drawEditor();}return;}
    if(action==='remove-item'){draft[target.dataset.group].splice(Number(target.dataset.index),1);dirty=true;drawEditor();return;}
    if(action==='rate-group'){configGroup=target.dataset.group;drawSettings();return;}
    if(action==='remove-header'){configDraft.headerImage='';dirty=true;drawSettings();return;}
    if(action==='edit'){draft=structuredClone(library.quotes.find(quote=>quote.id===target.dataset.id));tab='new';dirty=false;draw();return;}
    if(action==='pdf'){if(dirty && !confirm(bt('pdfSavedHint')))return;setBusy(true);await downloadPdf(target.dataset.id);return;}
    if(action==='refresh-prices') {
      if(dirty){toast(bt('saveFirst'),'err');return;}
      const quote=library.quotes.find(item=>item.id===target.dataset.id);
      if(!quote || quote.status!=='draft')return;
      if(!confirm(bt('confirmRefreshPrices',{title:quote.title})))return;
      setBusy(true);
      const result=await api('/api/budgets/'+quote.id,{method:'PUT',body:{action:'refresh-prices',revision:quote.revision}});
      await refresh();if(draft?.id===result.id)draft=structuredClone(result);draw();toast(bt('saved'));return;
    }
    if(action==='status') {
      if(dirty){toast(bt('saveFirst'),'err');return;}
      const quote=library.quotes.find(item=>item.id===target.dataset.id);
      if(!confirm(bt('confirmStatus',{status:bt(target.dataset.status),title:quote.title})))return;
      setBusy(true);
      const result=await api('/api/budgets/'+quote.id,{method:'PUT',body:{action:'status',status:target.dataset.status,revision:quote.revision}});
      await refresh(); if(draft?.id===result.id)draft=structuredClone(result); draw();toast(bt('saved'));
    }
  } catch(error) {toast(error.message,'err');} finally {setBusy(false);}
});
$('#budgetTabs').onclick=event=>{const target=event.target.closest('[data-tab]');if(target)changeTab(target.dataset.tab);};
$('.nav-btn[data-view="budgets"]').addEventListener('click',()=>{if(!draft&&!configDraft)changeTab(tab);else draw();});
async function drawEarnings() {
  const root=$('#earningsPanel'); root.innerHTML=`<p class="hint">${h('loading')}</p>`;
  try {
    await refresh();
    root.innerHTML=`<div class="budget-heading"><h2>${h('earnings')}</h2>${button('refresh-earnings','retry')}</div><p class="hint">${h('earningsHint')}</p><div class="budget-tiles">${['active','potential','earned'].map(group=>`<article class="budget-tile ${group}"><h3>${h(group)}</h3><strong class="budget-amount">${money(library.earnings[group].usdCents)}</strong><p>${i18n.formatNumber(library.earnings[group].count)} ${h('quotes')}</p></article>`).join('')}</div>`;
    root.querySelector('button').onclick=drawEarnings;
  } catch(error) {root.innerHTML=`<p class="hint">${esc(error.message)}</p>${button('refresh-earnings','retry')}`;root.querySelector('button').onclick=drawEarnings;}
}
function earningsTab(active) {earningsActive=active;$('#usagePanel').hidden=active;$('#earningsPanel').hidden=!active;$('#usageTab').classList.toggle('active',!active);$('#earningsTab').classList.toggle('active',active);if(active)drawEarnings();}
$('#usageTab').onclick=()=>earningsTab(false); $('#earningsTab').onclick=()=>earningsTab(true);
$('.nav-btn[data-view="costs"]').addEventListener('click',()=>{if(earningsActive)drawEarnings();});
window.addEventListener('manifestador:localechange',()=>{if(draft||configDraft||library.quotes.length)draw();else drawTabs();if(earningsActive)drawEarnings();});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
drawTabs();
