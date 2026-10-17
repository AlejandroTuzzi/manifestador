(() => {
  const documentAccept = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json';
  async function upload(file, nsfw = false) {
    if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(tr('errors.llmFileInvalid'));
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(tr('errors.llmFileInvalid'))); reader.readAsDataURL(file);
    });
    return api('/api/chat-files', {method:'POST',body:{name:file.name,dataUrl,nsfw},task:false});
  }
  window.ManifestadorFiles = {upload,documentAccept};
  const panel = $('#documentsAssetsPanel'), tab = $('#documentsTab');
  let files = [], query = '';
  function render() {
    panel.innerHTML = `<div class="llm-file-tools"><button class="tool-btn" id="uploadDocument">${esc(tr('documents.upload'))}</button><label class="check-row"><input id="documentNsfw" type="checkbox"${state.config?.nsfwEnabled ? '' : ' disabled'}>${esc(tr('common.nsfwContent'))}</label><input class="select" type="search" id="documentSearch" aria-label="${esc(tr('common.search'))}" placeholder="${esc(tr('common.search'))}" value="${esc(query)}"></div><p class="hint">${esc(tr('documents.hint'))}</p><div id="documentList" class="document-list"></div>`;
    const list = () => {
      $('#documentList').innerHTML = files.filter(f=>f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(f=>`<article class="document-card"><strong>${esc(f.name)}</strong><p class="hint">${esc(f.ext.toUpperCase())} · ${Math.ceil(f.size/1024).toLocaleString()} KB ${f.nsfw ? ' · NSFW' : ''}</p><a class="mini-btn" href="/api/chat-files/${encodeURIComponent(f.id)}" download>${esc(tr('common.download'))}</a></article>`).join('') || `<p class="hint">${esc(tr('documents.empty'))}</p>`;
    };
    list(); $('#documentSearch').oninput = e => {query=e.target.value;list();};
    $('#uploadDocument').onclick = () => {
      const input = document.createElement('input'); input.type='file';input.multiple=true;input.accept=documentAccept;
      const nsfw = $('#documentNsfw').checked;
      input.onchange = async () => {
        $('#uploadDocument').disabled=true;
        try {for (const file of input.files) await upload(file,nsfw);}
        catch(error){toast(error.message,'err');}
        finally {await load();}
      }; input.click();
    };
  }
  async function load() {
    try {files=(await api('/api/chat-files',{task:false})).files.filter(f=>f.kind==='document');render();}
    catch(error){toast(error.message,'err');}
  }
  tab.onclick = () => {
    $('#mediaAssetsPanel').hidden=true;panel.hidden=false;
    $('#view-assets').querySelectorAll('[data-zone]').forEach(b=>b.classList.remove('active'));
    tab.classList.add('active');load();
  };
  $('#view-assets').querySelectorAll('[data-zone]').forEach(b=>b.addEventListener('click',()=>{
    $('#mediaAssetsPanel').hidden=false;panel.hidden=true;tab.classList.remove('active');
  }));
  $('.nav-btn[data-view="assets"]').addEventListener('click',()=>{if(!panel.hidden)load();});
  window.addEventListener('manifestador:localechange',()=>{if(!panel.hidden)render();});
})();
