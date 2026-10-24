/* Shared editor/reader for an idea's episode outline. Durations are minutes. */
window.IdeaOutline = (() => {
  const t = key => esc(tr(key));
  const action = (name, label) => `<button type="button" class="mini-btn" data-outline-action="${name}">${t(label)}</button>`;
  function ensure(idea) { return idea.outline ||= {episodes:[],ranges:[]}; }
  function capture(root, idea) {
    const section = root.querySelector('[data-outline-editor]');
    if (!section) return;
    idea.outline = {
      episodes:[...section.querySelectorAll('[data-outline-episode]')].map(card => ({
        name:card.querySelector('[data-ep-name]').value,
        description:card.querySelector('[data-ep-description]').value,
        duration:card.querySelector('[data-ep-duration]').value === '' ? null : Number(card.querySelector('[data-ep-duration]').value)
      })),
      ranges:[...section.querySelectorAll('[data-outline-range]')].map(card => ({name:card.querySelector('[data-range-name]').value,start:Number(card.querySelector('[data-range-start]').value),end:Number(card.querySelector('[data-range-end]').value)}))
    };
  }
  function graph(outline) {
    const {episodes=[],ranges=[]} = outline;
    if (!episodes.length) return `<p class="hint">${t('outline.empty')}</p>`;
    return `<div class="outline-scroll" tabindex="0" role="region" aria-label="${t('outline.title')}"><div class="outline-timeline" style="--episode-count:${episodes.length}">
      ${ranges.map((range,index)=>`<div class="outline-band tone-${index%6}" style="grid-column:${Math.max(1,Math.min(episodes.length,range.start||1))} / ${Math.max(1,Math.min(episodes.length,range.end||1))+1};grid-row:${index+1}">${esc(range.name)} · ${esc(tr('outline.rangeNumbers',{start:range.start,end:range.end}))}</div>`).join('')}
      ${episodes.map((episode,index)=>`<article class="outline-tile${index===0?' pilot':''}${index===episodes.length-1?' finale':''}" style="grid-column:${index+1};grid-row:${ranges.length+1}"><strong>${esc(tr('outline.episodeNumber',{number:index+1}))}</strong><div class="outline-markers">${index===0?`<span>${t('outline.pilot')}</span>`:''}${index===episodes.length-1?`<span>${t('outline.finale')}</span>`:''}</div><h4>${esc(episode.name)}</h4><p>${esc(episode.description)}</p><small>${episode.duration ? esc(tr('outline.minutes',{value:i18n.formatNumber(episode.duration)})) : t('outline.unspecified')}</small></article>`).join('')}
    </div></div>`;
  }
  function render(idea, editing = false) {
    const outline = idea.outline || {episodes:[],ranges:[]};
    return `<section class="idea-outline"${editing?' data-outline-editor':''}><h3>${t('outline.title')}</h3><p class="hint">${t('outline.help')}</p><div data-outline-preview>${graph(outline)}</div>${editing ? `
      <h4>${t('outline.episodes')}</h4><div class="outline-edit-grid">${outline.episodes.map((episode,index)=>`<fieldset data-outline-episode><legend>${esc(tr('outline.episodeNumber',{number:index+1}))}</legend>
      <label>${t('common.name')}<input data-ep-name required maxlength="200" value="${esc(episode.name)}"></label>
      <label>${t('outline.description')}<textarea data-ep-description rows="4" maxlength="20000">${esc(episode.description)}</textarea></label>
      <label>${t('outline.duration')}<input data-ep-duration type="number" min="0.01" max="1440" step="any" value="${episode.duration??''}"></label>${action(`episode-remove:${index}`,'common.delete')}</fieldset>`).join('')}</div>
      ${action('episode-add','outline.addEpisode')}<h4>${t('outline.ranges')}</h4>
      <div class="outline-edit-grid">${outline.ranges.map((range,index)=>`<fieldset class="tone-${index%6}" data-outline-range><legend>${esc(tr('outline.rangeNumber',{number:index+1}))}</legend><label>${t('common.name')}<input data-range-name required maxlength="200" value="${esc(range.name)}"></label><label>${t('outline.from')}<input data-range-start required type="number" min="1" max="${outline.episodes.length}" step="1" value="${range.start}"></label><label>${t('outline.to')}<input data-range-end required type="number" min="1" max="${outline.episodes.length}" step="1" value="${range.end}"></label>${action(`range-remove:${index}`,'common.delete')}</fieldset>`).join('')}</div>
      ${outline.episodes.length?action('range-add','outline.addRange'):''}<p class="hint">${t('outline.saveHint')}</p>`:''}</section>`;
  }
  function removeEpisode(outline, index) {
    const number=index+1;
    outline.episodes.splice(index,1);
    outline.ranges=outline.ranges.filter(range=>!(range.start===number && range.end===number)).map(range=>({...range,start:range.start>number?range.start-1:range.start,end:range.end>=number?range.end-1:range.end}));
  }
  function change(idea, value) {
    const outline=ensure(idea), [kind,raw]=value.split(':'), index=Number(raw);
    if(kind==='episode-add' && outline.episodes.length<200) outline.episodes.push({name:tr('outline.episodeNumber',{number:outline.episodes.length+1}),description:'',duration:null});
    if(kind==='range-add' && outline.episodes.length && outline.ranges.length<100) outline.ranges.push({name:tr('outline.rangeNumber',{number:outline.ranges.length+1}),start:1,end:outline.episodes.length});
    if(kind==='episode-remove' && Number.isInteger(index) && index>=0 && index<outline.episodes.length) removeEpisode(outline,index);
    if(kind==='range-remove' && Number.isInteger(index) && index>=0 && index<outline.ranges.length) outline.ranges.splice(index,1);
  }
  return {render,capture,graph,change,removeEpisode};
})();
