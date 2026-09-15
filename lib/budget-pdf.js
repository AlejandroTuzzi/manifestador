import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { openBrowser } from '@remotion/renderer';
import { BUDGET_GROUPS } from '../public/budget-model.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function budgetPdfFilename(quote) {
  const part = value => String(value ?? '').normalize('NFC').trim()
    .replace(/[\s<>:"/\\|?*\u0000-\u001f\u007f]+/g, '_')
    .replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 70);
  const date = new Date(quote.createdAt);
  const day = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'undated';
  return `budget_${day}_${part(quote.client) || 'client'}_${part(quote.title) || 'drama'}.pdf`;
}
export function safeBudgetFooter(html) {
  const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a']);
  return String(html || '').replace(/<(script|style|iframe|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').split(/(<[^>]*>)/g).map(token => {
    if (!token.startsWith('<')) return escape(token);
    const match = token.match(/^<(\/?)\s*([a-z]+)\b([^>]*)>$/i);
    if (!match || !allowed.has(match[2].toLowerCase())) return '';
    const tag = match[2].toLowerCase();
    if (match[1]) return tag === 'br' ? '' : `</${tag}>`;
    if (tag === 'a') {
      const href = match[3].match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] || '';
      return /^(https?:\/\/|mailto:|tel:)[^\s<>]*$/i.test(href) ? `<a href="${escape(href)}">` : '<a>';
    }
    return `<${tag}>`;
  }).join('');
}

export async function budgetCatalog(locale) {
  let messages;
  vm.runInNewContext(await readFile(new URL(`../public/locales/${locale === 'en' ? 'en' : 'es'}.js`, import.meta.url), 'utf8'), { window: { ManifestadorI18n: { register: (_, data) => { messages = data; } } } });
  return (key, args = {}) => String(messages[key] || key).replace(/\{(\w+)\}/g, (_, name) => args[name] ?? '');
}
export function budgetHtml(quote, t, locale = 'es', headerData = '', settings = {}) {
  const footerHtml = quote.snapshot.footerHtml?.trim() ? quote.snapshot.footerHtml : settings.footerHtml;
  const money = cents => new Intl.NumberFormat(locale, { style: 'currency', currency: quote.currency }).format(cents / 100);
  const usd = value => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
  const n = value => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
  const label = key => escape(t('budget.' + key));
  const card = (group, content) => `<div class="tile ${group}">${content}</div>`;
  const row = (key, value) => `<div><span class="muted">${label(key)}:</span> ${escape(value)}</div>`;
  const episodeCards = quote.episodes.map((episode, index) => card(index === 0 ? 'pilot' : index === quote.episodes.length - 1 ? 'final' : 'episodes', `<strong>${index + 1}</strong><span>${index === 0 ? label('pilot') : ''}${index === quote.episodes.length - 1 ? ' ' + label('final') : ''}</span><small>${n(index === 0 ? quote.pilotMinutes : quote.episodeMinutes)} min</small>`)).join('');
  const entitySections = ['characters', 'locations', 'objects'].map(group => `<h2>${label(group)} (${n(quote[group].length)})</h2><div class="tiles">${quote[group].map(item => card(group, `<strong>${escape(item.name)}</strong>${group === 'characters' ? row('sex', item.sex) + row('species', item.species) + row('age', item.age) + row('source', t('budget.' + item.source)) : group === 'locations' ? row('locationType', item.type) + row('lighting', item.lighting) : row('characteristics', item.characteristics)}`)).join('') || `<p class="muted">${label('none')}</p>`}</div>`).join('');
  const rules = BUDGET_GROUPS.map(group => {
    const rate = quote.snapshot.rates[group];
    let text = group === 'episodes' ? `${t('budget.pilot')}: ${usd(rate.pilot)} / min; ${t('budget.regular')}: ${usd(rate.regular)} / min`
      : group === 'characters' ? `${t('budget.provided')}: ${usd(rate.provided)}; ${t('budget.create')}: ${usd(rate.create)}`
      : ['locations', 'objects'].includes(group) ? `${usd(rate.price)} / ${t('budget.item')}`
      : `${t('budget.' + quote[group])}: ${usd(rate[quote[group]])} / ${t('budget.' + rate.unit)}`;
    return `<p><b>${label(group)}:</b> ${escape(text)}</p>`;
  }).join('');
  return `<!doctype html><html lang="${locale === 'en' ? 'en' : 'es'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>
    @page { size: A4; margin: 14mm 13mm; background: #100a19; } * { box-sizing: border-box; } html { background:#100a19; color:#efe8fa; font-family:Arial,sans-serif; font-size:11px; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    body { margin:0; padding:0 10px; } h1 { font-size:27px; margin:15px 0 5px; } h2 { font-size:16px; margin:16px 0 8px; break-after:avoid; color:#f497c7; } h3,p { margin:8px 0; } .banner { width:100%; aspect-ratio:1920/550; object-fit:cover; border-radius:8px; } .muted,small { color:#b5a6c9; } .description { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.5; } .tiles { display:flex; flex-wrap:wrap; gap:8px; } .tile { border:1px solid #574174; background:#20142f; border-radius:8px; padding:11px; width:calc((100% - 16px)/3); break-inside:avoid; overflow-wrap:anywhere; line-height:1.5; } .tile strong { display:block; margin-bottom:5px; } .characters { border-top:3px solid #e873b4; } .locations { border-top:3px solid #54c9c0; } .objects { border-top:3px solid #d5ac65; } .episode-grid .tile { width:calc((100% - 56px)/8); text-align:center; padding:7px 2px; } .episode-grid strong { font-size:18px; } .episode-grid span,.episode-grid small { display:block; } .pilot { border-color:#e873b4; background:#392039; } .final { border-color:#54c9c0; background:#153735; } .services { margin-top:15px; } table { width:100%; border-collapse:collapse; margin:14px 0; } thead { display:table-header-group; } th,td { padding:7px 6px; text-align:right; border-bottom:1px solid #483459; } th:first-child,td:first-child { text-align:left; } tr { break-inside:avoid; } .total { text-align:right; font-size:23px; color:#f497c7; padding:12px; border:1px solid #805176; break-inside:avoid; } .per-episode { font-size:13px; color:#efe8fa; margin-top:8px; } .rules { columns:2; line-height:1.5; } .rules p { break-inside:avoid; } footer { margin-top:16px; border-top:1px solid #574174; padding-top:12px; break-inside:avoid; overflow-wrap:anywhere; } a { color:#9edbda; } .meta { display:flex; flex-wrap:wrap; gap:12px; } .meta p { flex:1 1 40%; } .quote-status { color:#f497c7; } </style></head><body>
    ${headerData ? `<img class="banner" src="${headerData}" alt="">` : ''}<h1>${label('verticalDrama')}</h1><p class="quote-status">${label('quote')} ${escape(quote.id)} · ${label(quote.status)}</p>
    <h2>${escape(quote.title)}</h2><div class="meta"><p>${label('client')}: <b>${escape(quote.client)}</b></p><p>${label('deadline')}: ${quote.deadline ? new Intl.DateTimeFormat(locale, { dateStyle:'medium' }).format(new Date(quote.deadline + 'T12:00:00')) : label('notSet')}</p></div>
    <p class="description">${escape(quote.description)}</p><p>${label('currency')}: ${quote.currency}${quote.currency === 'EUR' ? ` · 1 EUR = ${n(quote.snapshot.usdPerEuro)} USD` : ''}</p>
    <h2>${label('episodes')} (${n(quote.episodes.length)}) · ${n(quote.totals.minutes)} min</h2><div class="tiles episode-grid">${episodeCards}</div>
    ${entitySections}<div class="tiles services">${['script','voices','music'].map(group => card(group, `<strong>${label(group)}</strong>${label(quote[group])}`)).join('')}</div>
    <h2>${label('breakdown')}</h2><table><thead><tr>${['group','base','discount','subtotal','revisions'].map(key => `<th>${label(key)}</th>`).join('')}</tr></thead><tbody>${quote.totals.groups.map(group => `<tr><td>${label(group.group)}</td><td>${money(group.baseCents)}</td><td>${n(quote.discounts[group.group])}%<br><small>-${money(group.discountCents)}</small></td><td>${money(group.totalCents)}</td><td>${n(quote.snapshot.rates[group.group].revisions)}</td></tr>`).join('')}</tbody></table>
    <div class="total">${label('total')}: ${money(quote.totals.totalCents)}<div class="per-episode">${label('perEpisode')}: ${money(quote.totals.totalCents / quote.episodes.length)}</div></div><p class="muted">${label('taxHint')}</p><h2>${label('ratesUsd')}</h2><div class="rules">${rules}</div><footer>${safeBudgetFooter(footerHtml)}</footer>
    </body></html>`;
}
let rendering = Promise.resolve();
export function renderBudgetPdf(html) {
  const job = rendering.then(async () => {
    let browser;
    try {
      browser = await openBrowser('chrome', { logLevel: 'error' });
      const page = await browser.newPage({ context: () => null, logLevel:'error', indent:false, pageIndex:0, onBrowserLog:null, onLog:() => {} });
      await page.goto({ url:'data:text/html;base64,' + Buffer.from(html).toString('base64'), timeout:30000 });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
      const result = await page._client().send('Page.printToPDF', { printBackground:true, preferCSSPageSize:true, displayHeaderFooter:true, headerTemplate:'<span></span>', footerTemplate:'<div style="font-size:8px;color:#aaa;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
      return Buffer.from(result.value.data, 'base64');
    } finally { await browser?.close({ silent:true }); }
  });
  rendering = job.catch(() => {});
  return job;
}
