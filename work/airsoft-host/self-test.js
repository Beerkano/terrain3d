(async()=>{
  const id=s=>document.getElementById(s);
  const api=id('airsoft-terrain-editor').airsoft;
  const plan=()=>api.getPlan(), sel=()=>plan().items.find(i=>i.id===api.getSelection());
  const tested=new Set();
  let last='démarrage';
  const check=(ok,msg)=>{if(!ok)throw Error(last+' / '+msg);};
  function click(key){
    last=key;
    const b=id(key);
    check(b&&!b.matches(':disabled')&&b.getClientRects().length,'inaccessible');
    b.click();tested.add(key);
  }
  const act=key=>click('ate-'+key);
  function change(key,value){
    const e=id('ate-'+key);e.value=value;e.dispatchEvent(new Event('change'));
  }
  const pause=()=>new Promise(r=>setTimeout(r,20));
  async function until(test){for(let i=0;i<100;i++){if(test())return;await pause();}check(false,'délai dépassé');}
  const errors=[];
  window.addEventListener('error',e=>errors.push(e.message));
  check(plan().items.length===0,'démarrage vierge même après une session');
  act('top');check(JSON.parse(localStorage.getItem('terrain-airsoft.desktop.plan.v1')).modelContent.plan.items.length===62,'session préservée');
  act('resume');check(plan().items.length===62,'reprise volontaire');
  const sampleFile=new DataTransfer();sampleFile.items.add(new File([JSON.stringify(window.samplePlan)],'La cour couverte.airsoft.json'));
  id('ate-file-input').files=sampleFile.files;id('ate-file-input').dispatchEvent(new Event('change'));
  await until(()=>id('ate-file-note').textContent.includes('La cour couverte.airsoft.json'));
  check(plan().title==='La cour couverte'&&plan().items.length===62,'ouverture de la carte fournie');
  change('object','');
  const search=id('ate-search');
  search.value='BATIMENT';search.dispatchEvent(new Event('input'));
  check(id('ate-object').options.length>1&&id('ate-object').options.length<63,'recherche sans accents');
  search.value='introuvable123';search.dispatchEvent(new Event('input'));
  check(id('ate-object').options.length===1,'recherche vide');
  search.value='';search.dispatchEvent(new Event('input'));
  check(id('ate-object').options.length===63,'réinitialisation recherche');
  check(id('ate-canvas').clientWidth>300&&id('ate-canvas').clientHeight>200,'surface du plan');
  check(document.documentElement.scrollWidth<=innerWidth+1,'largeur de la fenêtre');
  act('top');check(api.getView().pitch===90,'vue dessus');
  act('3d');check(api.getView().pitch<90,'perspective');
  check(!document.querySelector('[id^=ate-focus-]'),'absence des anciens raccourcis');
  act('overview');check(api.getView().zoom===1,'vue globale');
  act('square');check(plan().items.find(i=>i.id==='o4').x===41.75,'cour');
  act('undo');check(plan().items.find(i=>i.id==='o4').x===42,'annulation');
  act('redo');check(plan().items.find(i=>i.id==='o4').x===41.75,'rétablissement');
  for(const key of ['explore','measure','move','turn']){
    act(key);check(id('ate-'+key).getAttribute('aria-pressed')==='true','mode actif');
  }
  change('object','o1');act('part');check(!id('ate-fields').disabled,'membre éditable');act('part');
  change('object','o6');act('lock');check(sel().locked&&id('ate-fields').disabled,'verrouillage');
  act('lock');check(!sel().locked,'déverrouillage');
  act('multi');change('object','o7');act('group');check(sel().group&&sel().group===plan().items.find(i=>i.id==='o6').group,'groupe');
  change('group-name','La Galerie');check(plan().items.filter(i=>i.groupName==='La Galerie').length===2,'nom du groupe');
  act('ungroup');check(!sel().group,'dissociation');
  act('file-new');check(id('map-dialog').open,'dialogue carte');
  click('map-cancel');check(!id('map-dialog').open&&plan().items.length===62,'annulation carte');
  act('file-new');click('map-create');check(!id('map-dialog').open&&plan().items.length===0,'carte vide');
  const types=id('ate-add-type').options;
  check(types.length===14,'catalogue');
  for(const option of types){
    const count=plan().items.length;
    change('add-type',option.value);act('add');await pause();
    check(plan().items.length===count+1&&sel().type===option.value&&!id('ate-fields').disabled,option.value);
    if(option.value==='custom'){
      id('ate-outline').value='0,0 ; 100,0 ; 0,100';act('outline-apply');check(sel().outline.length===3,'contour');
    }
  }
  change('object',plan().items[0].id);
  for(const [key,angle] of [['plus',15],['minus',0],['rotate',90]]){
    act(key);check(sel().r===angle,'rotation');
  }
  act('duplicate');check(plan().items.length===15&&sel().name.includes('copie'),'copie');
  act('delete');check(plan().items.length===14,'suppression');
  for(const [shiftKey,count] of [[false,15],[true,14]]){
    document.body.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'z',ctrlKey:true,shiftKey}));
    check(plan().items.length===count,'historique au clavier');
  }
  act('design');click('shape-cancel');check(!id('shape-dialog').open,'annulation objet');
  for(const type of ['box','round','custom']){
    act('design');
    id('shape-type').value=type;id('shape-type').dispatchEvent(new Event('change'));
    id('shape-name').value='Création test';
    if(type==='custom'){
      const pad=id('shape-pad'),rect=pad.getBoundingClientRect();
      for(const [x,y] of [[.1,.1],[.9,.1],[.9,.9],[.1,.9]])
        pad.dispatchEvent(new MouseEvent('click',{clientX:rect.left+x*rect.width,clientY:rect.top+y*rect.height}));
      click('shape-back');
    }
    click('shape-create');check(!id('shape-dialog').open&&sel().type===type&&sel().name==='Création test','création '+type);
    if(type==='custom')check(sel().outline.length===3,'dessin libre');
    act('undo');
  }
  for(const type of ['building','wall','pallet']){
    change('object',plan().items.find(i=>i.type===type).id);
    act('door');check(sel().doors.length===1,'ajout porte');
    act('door');check(!sel().doors.length,'retrait porte');
    act('undo');check(sel().doors.length===1,'annulation retrait');
    act('rotate');check(sel().doors.length===1,'rotation avec porte');
  }
  let saved,closed=false,requested=false,png;
  window.showSaveFilePicker=async()=>({name:'test.json',createWritable:async()=>({write:async v=>{saved=v;},close:async()=>{closed=true;}})});
  act('file-save');await until(()=>closed);check(JSON.parse(saved).items.length===14,'export JSON');
  const input=id('ate-file-input');input.click=()=>{requested=true;};
  act('file-open');check(requested,'sélection du fichier');
  const data=JSON.parse(saved);data.title='Carte importée';
  const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(data)],'test.json'));
  input.files=transfer.files;input.dispatchEvent(new Event('change'));await until(()=>plan().title===data.title);check(plan().items.filter(i=>i.doors?.length).length===3,'portes rechargées');
  HTMLAnchorElement.prototype.click=function(){png=this.href;};
  act('png');await until(()=>png);check(png.startsWith('blob:'),'export PNG');
  document.querySelectorAll('.ate-bottom details').forEach(d=>d.open=true);
  const canvas=id('ate-canvas');
  canvas.setPointerCapture=()=>{};canvas.releasePointerCapture=()=>{};
  function pointer(event,x,z,mods={}){
    const q=api.project(x,0,z),rect=canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(event,{pointerId:1,button:0,clientX:rect.left+q.x,clientY:rect.top+q.y,...mods}));
  }
  act('trace');await pause();pointer('pointerdown',20,30);pointer('pointerdown',38,30);
  check(sel().type==='wall'&&Math.abs(sel().w-18)<.5,'tracé mur');
  const wallId=sel().id;
  act('place-door');await pause();pointer('pointerdown',24,30);
  check(sel().id===wallId&&sel().apertures[0].at<.4,'porte décentrée');
  act('resize');await pause();
  const initial=sel();pointer('pointerdown',initial.x+initial.w/2,initial.z+initial.d/2);
  pointer('pointermove',initial.x+initial.w/2+4,initial.z+2);pointer('pointerup',initial.x+initial.w/2+4,initial.z+2);
  check(sel().w>initial.w+3,'poignée de taille');act('explore');
  id('ate-template-name').value='Mur percé';act('template-save');const n=plan().items.length;
  act('template-use');check(plan().items.length===n+1&&sel().apertures[0].at<.4,'modèle avec porte');
  change('layer','wall');act('visible');check(plan().hiddenLayers.includes('wall'),'calque masqué');
  act('visible');act('layer-lock');check(plan().items.filter(i=>i.type==='wall').every(i=>i.locked),'verrou du calque');act('layer-lock');
  const source=document.createElement('canvas');source.width=120;source.height=80;
  const blob=await new Promise(r=>source.toBlob(r));const files=new DataTransfer();files.items.add(new File([blob],'croquis.png',{type:'image/png'}));
  id('ate-underlay').files=files.files;id('ate-underlay').dispatchEvent(new Event('change'));await until(()=>plan().photo);
  const oldWidth=plan().photo.w;act('calibrate');await pause();pointer('pointerdown',40,75);pointer('pointerdown',60,75);
  check(Math.abs(plan().photo.w-oldWidth/2)<1,'échelle du fond');
  act('file-save');await until(()=>JSON.parse(saved).photo);
  const roundTrip=JSON.parse(saved);roundTrip.title='Carte de travail';const again=new DataTransfer();again.items.add(new File([JSON.stringify(roundTrip)],'atelier.json'));
  input.files=again.files;input.dispatchEvent(new Event('change'));await until(()=>plan().title===roundTrip.title);
  check(plan().photo.w===roundTrip.photo.w&&plan().items.find(i=>i.id===wallId).apertures[0].at<.4,'réouverture fond et porte');
  act('clear-photo');check(!plan().photo,'retrait fond');act('undo');check(!!plan().photo,'reprise du fond');
  let printed=false;window.print=()=>{printed=true;};act('print');await until(()=>printed);
  check(id('print-plan').querySelectorAll('tr').length===plan().items.length+1,'cotes imprimables');
  act('file-new');click('map-create');act('template-use');
  check(plan().items.length===1&&sel().apertures[0].width===1,'modèle sur une nouvelle carte');
  change('add-type','box');act('add');change('x',40);change('z',40);
  act('add');change('x',52);change('z',40);
  id('ate-magnet').checked=true;act('move');act('top');await pause();
  pointer('pointerdown',52,40);pointer('pointermove',44.5,40);pointer('pointerup',44.5,40);
  check(Math.abs(sel().x-44)<.1,'alignement magnétique des bords');
  check(errors.length===0,errors.join(', '));
  const missing=[...document.querySelectorAll('button')].filter(b=>!tested.has(b.id));
  check(!missing.length,missing.map(b=>b.id).join(', '));
  window.testOutcome='ok '+tested.size;
})().catch(e=>window.testOutcome=String(e));
