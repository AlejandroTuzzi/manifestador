const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function ideaPdfFilename(idea) {
  const name=String(idea.name || 'idea').normalize('NFC').replace(/[\s<>:"/\\|?*\u0000-\u001f\u007f]+/g,'_').replace(/^[._]+|[._]+$/g,'').slice(0,100);
  return `idea_${name || 'outline'}.pdf`;
}
export function ideaPdfHtml(idea, category, t, locale='es') {
  const label=key=>esc(t(key));
  const value=v=>esc(v || t('outline.pdfUnspecified'));
  const paragraph=(key,v)=>`<h3>${label(key)}</h3><p>${value(v)}</p>`;
  const episodes=idea.outline?.episodes || [], ranges=idea.outline?.ranges || [];
  const number=n=>new Intl.NumberFormat(locale === 'en'?'en':'es',{maximumFractionDigits:4}).format(n);
  return `<!doctype html><html lang="${locale==='en'?'en':'es'}"><head><meta charset="utf-8"><title>${esc(idea.name)}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
    @page {size:A4;margin:18mm 17mm;background:#100a19;}
    * {box-sizing:border-box;} html {background:#100a19;color:#efe8fa;font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
    body {margin:0;} h1 {font-size:23pt;margin:0 0 18pt;overflow-wrap:anywhere;}
    h2 {font-size:16pt;color:#f497c7;margin:24pt 0 10pt;break-after:avoid;}
    h3 {font-size:12pt;color:#c5b3f5;margin:14pt 0 5pt;break-after:avoid;}
    p {margin:0 0 10pt;white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3;}
  </style></head><body><h1>${esc(idea.name)}</h1>
    ${paragraph('ideas.category',category)}
    <h2>${label('outline.pdfDevelopment')}</h2><p>${value(idea.development)}</p>
    <h2>${label('ideas.characters')}</h2>
    ${(idea.characters || []).map((character,index)=>`<h3>${label('ideas.character')} ${number(index+1)}: ${value(character.name)}</h3>${['sex','physical','profession','relationships','role','description','emotionalLever'].map(key=>paragraph(`ideas.${key}`,character[key])).join('')}`).join('') || `<p>${label('outline.pdfNone')}</p>`}
    <h2>${label('outline.episodes')}</h2>
    ${episodes.map((episode,index)=>`<h3>${esc(t('outline.episodeNumber',{number:number(index+1)}))}: ${esc(episode.name)}</h3>${index===0 || index===episodes.length-1 ? `<p>${[index===0?t('outline.pilot'):'',index===episodes.length-1?t('outline.finale'):''].filter(Boolean).map(esc).join(' / ')}</p>` : ''}<p>${label('outline.duration')}: ${episode.duration == null?label('outline.unspecified'):esc(t('outline.minutes',{value:number(episode.duration)}))}</p>${paragraph('outline.description',episode.description)}`).join('') || `<p>${label('outline.pdfNone')}</p>`}
    <h2>${label('outline.ranges')}</h2>
    ${ranges.map(range=>`<h3>${esc(range.name)}</h3><p>${esc(t('outline.rangeNumbers',{start:number(range.start),end:number(range.end)}))}</p>`).join('') || `<p>${label('outline.pdfNone')}</p>`}
  </body></html>`;
}
