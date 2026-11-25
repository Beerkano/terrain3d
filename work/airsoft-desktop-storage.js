(() => {
  'use strict';
  const storageKey = 'terrain-airsoft.desktop.plan.v1';
  let currentState = null;
  let readWarning = '';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) currentState = JSON.parse(saved);
  } catch {
    readWarning = 'La reprise automatique est indisponible. Tu peux ouvrir un fichier de plan.';
  }
  const byId = suffix => document.getElementById('ate-file-' + suffix);
  function status(message) {
    const note = byId('note');
    if (note) note.textContent = message;
  }
  function setWidgetState(state) {
    currentState = state;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      status('Session enregistrée sur ce PC');
    } catch {
      status('Reprise automatique indisponible. Utilise « Enregistrer le plan ».');
    }
  }
  function connect({getPlan, loadPlan}) {
    const input = byId('input');
    async function save() {
      const plan=getPlan();
      const filename=(plan.title||'Mon terrain').replace(/[<>:"/\\|?*]/g,'_')+'.airsoft.json';
      const contents = JSON.stringify(plan, null, 2);
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{description:'Plan de terrain', accept:{'application/json':['.json']}}]
          });
          const file = await handle.createWritable();
          await file.write(contents);
          await file.close();
          status('Plan enregistré dans « ' + handle.name + ' »');
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (!['SecurityError','NotAllowedError','NotSupportedError'].includes(error.name)) {
            status('Écriture impossible. Vérifie le dossier choisi et réessaie.');
            return;
          }
        }
      }
      const url = URL.createObjectURL(new Blob([contents], {type:'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 30000);
      status('Export du fichier « ' + filename + ' » demandé.');
    }
    async function open() {
      const file = input.files[0];
      if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('Ce fichier dépasse 2 Mo.');
        const data = JSON.parse(await file.text());
        loadPlan(data);
        status('Plan ouvert depuis « ' + file.name + ' »');
      } catch (error) {
        status(error instanceof SyntaxError ? 'Fichier illisible. Choisis un plan au format JSON.' : error.message);
      } finally {
        input.value = '';
      }
    }
    byId('sample').addEventListener('click',()=>{
      loadPlan(/* EMBEDDED_PLAN */ null);
      status('La cour couverte · carte de référence ouverte');
    });
    window.chrome?.webview?.addEventListener('message',event=>{
      try{
        const plan=JSON.parse(event.data);
        loadPlan(plan);
        status('Plan ouvert · '+(plan.title||'Mon terrain'));
        window.chrome.webview.postMessage('plan-opened');
      }catch(error){status('Ouverture impossible · '+error.message);}
    });
    byId('save').addEventListener('click', save);
    byId('open').addEventListener('click', ()=>input.click());
    input.addEventListener('change', open);
    window.addEventListener('keydown', event=>{
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's' || key === 'o') {
        event.preventDefault();
        if (!event.repeat) key === 's' ? save() : input.click();
      }
    });
    status(readWarning || (currentState ? 'Terrain vierge · dernier projet disponible dans Terrain et export' : 'Terrain vierge'));
  }
  window.terrainDesktop = {get widgetState(){return currentState;}, setWidgetState, connect};
})();
