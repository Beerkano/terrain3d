(() => {
  'use strict';
  const root = document.getElementById('airsoft-terrain-editor');
  if (!root) return;
  const el = id => root.querySelector('#ate-' + id);
  const desktop = window.terrainDesktop;
  const stateProvider = desktop || window.openai;
  const labels = {container:'Conteneur',building:'Bâtiment en palettes',pallet:'Obstacle en palettes',tarp:'Abri en bâche',tree:'Arbre',gate:'Portail',table:'Table'};
  const defaults = {container:[6,2.5,2.6],building:[6,5,2.2],pallet:[3.6,.7,1.8],tarp:[6,5,2.8],tree:[5,5,7],gate:[7,.5,2.5],table:[3,1.2,.8]};
  const base = [];
  let count=0;
  function addBase(type,x,z,r=0,w=null,d=null,h=null,name=null) {
    const dim=defaults[type];
    base.push({id:'o'+(++count),type,name:name || labels[type]+' '+base.filter(t=>t.type===type).length,x,z,r,w:w??dim[0],d:d??dim[1],h:h??dim[2]});
  }
  addBase('container',24,64,15,null,null,null,'Conteneur 1');
  addBase('container',69,82,95,null,null,null,'Conteneur 2');
  addBase('container',42,112,-10,null,null,null,'Conteneur 3');
  addBase('container',76,132,25,null,null,null,'Conteneur 4');
  [[16,46,10],[51,50,-15],[82,57,15],[36,83,5],[15,103,-20],[61,109,10],[29,140,-10],[55,145,20]].forEach((p,i)=>addBase('building',...p,6+(i%2)*2,5+(i%3),2.2,'Bâtiment '+(i+1)));
  [[38,43,20],[68,43,-15],[17,72,80],[47,68,-10],[83,72,90],[27,92,0],[58,91,30],[83,99,90],[34,120,25],[63,127,-20],[12,131,85],[81,145,15],[47,134,0],[57,65,90],[9,88,-10],[69,148,35]].forEach((p,i)=>addBase('pallet',...p,null,null,null,'Palettes '+(i+1)));
  addBase('tarp',72,16,0,12,8,3,'Préparation / zone safe');
  addBase('tarp',90,13,0,7,6,2.8,'Accueil');
  addBase('tarp',54,102,25,5,4,2.4,'Abri de jeu');
  [[8,53],[92,43],[90,88],[7,117],[92,123],[11,150],[44,154],[86,153]].forEach((p,i)=>addBase('tree',...p,0,4+(i%3),4+(i%3),6+(i%4),'Arbre '+(i+1)));
  addBase('table',69,16,0,null,null,null,'Table safe 1');
  addBase('table',75,16,0,null,null,null,'Table safe 2');
  addBase('gate',54,1.5,0,8,.5,2.5,'Portail d’entrée');
  base.forEach(item=>{item.r=((item.r%360)+360)%360;});

  let items=desktop?[]:window.AirsoftLayoutV2.seed(base), selectedId=null;
  let land={width:100,depth:160,ground:'#d2dcc5'};
  if(desktop) {
    land.title="Terrain vierge";
    labels.custom='Volume sur mesure';
    defaults.custom=[6,6,2];
    for(const id of ['type','add-type'])el(id).add(new Option(labels.custom,'custom'));
    Object.assign(labels,{wall:'Mur libre',box:'Bloc',round:'Cylindre',triangle:'Prisme triangulaire',zone:'Zone au sol',parking:'Parking'});
    Object.assign(defaults,{wall:[5,.3,2.2],box:[4,4,2],round:[4,4,2],triangle:[4,4,2],zone:[15,12,.3],parking:[20,12,.3]});
    for(const key of ['wall','box','round','triangle','zone','parking'])for(const select of ['type','add-type'])el(select).add(new Option(labels[key],key));
  }
  const overview={yaw:-49,pitch:37,zoom:1,centerX:50,centerZ:80};
  let view={...overview};
  const shapes=new Set(['studio','annexe','longere','atelier','patio','halles']);
  const landmarks=['cour','atelier','marche'];
  let undo=[],redo=[],dragStart=null,last3D={...view},applyingState=false;
  let renderer;
  let mode='explore',multi=false,partGroup=null;
  const picked=new Set();
  function defaultCourt(list){
    for(const item of list)if(['o1','o2','o3','o4','o31'].includes(item.id))item.group='cour';
  }
  if(desktop)defaultCourt(items);
  function members(item=selected()){
    if(multi)return items.filter(i=>picked.has(i.id));
    if(!item)return [];
    return item.group && partGroup!==item.group ? items.filter(i=>i.group===item.group):[item];
  }
  function choose(id){
    if(multi&&id){
      const item=items.find(i=>i.id===id);
      const ids=item?.group?items.filter(i=>i.group===item.group).map(i=>i.id):[id];
      const remove=ids.every(key=>picked.has(key));
      for(const key of ids)if(remove)picked.delete(key);else picked.add(key);
      selectedId=remove?Array.from(picked).at(-1)||null:id;
    }else{selectedId=id;if(selected()?.group!==partGroup)partGroup=null;}
    refresh();saveState();
  }
  function transform(item,x,z,angle){
    const list=members(item);
    if(!list.length||list.some(i=>i.locked))return false;
    const delta=(angle-item.r)*Math.PI/180,c=Math.cos(delta),s=Math.sin(delta);
    const proposed=list.map(i=>{
      const dx=i.x-item.x,dz=i.z-item.z;
      return {...i,x:round(x+dx*c+dz*s),z:round(z-dx*s+dz*c),r:normAngle(i.r+angle-item.r)};
    });
    for(const p of proposed){
      const bounded=clampItem({...p});
      if(Math.abs(bounded.x-p.x)>.015||Math.abs(bounded.z-p.z)>.015||p.w-bounded.w>.001)return false;
    }
    proposed.forEach((p,index)=>Object.assign(list[index],p));return true;
  }
  const sentStates=new Set();
  const clone=value=>structuredClone(value);
  const selected=()=>items.find(t=>t.id===selectedId);
  const plan=()=>({version:desktop?4:2,...land,safeDepth:30,items:clone(items)});
  const snapshot=()=>({items:clone(items),selectedId,land:{...land}});
  const round=value=>Math.round(value*100)/100;
  const normAngle=value=>((value%360)+360)%360;
  function clampItem(item, size=land) {
    const r=item.r*Math.PI/180;
    let halfX=(Math.abs(Math.cos(r))*item.w+Math.abs(Math.sin(r))*item.d)/2;
    let halfZ=(Math.abs(Math.sin(r))*item.w+Math.abs(Math.cos(r))*item.d)/2;
    const scale=Math.min(1,size.width/(2*halfX),size.depth/(2*halfZ));
    if(scale<1){item.w*=scale;item.d*=scale;halfX*=scale;halfZ*=scale;}
    item.x=round(Math.max(halfX,Math.min(size.width-halfX,item.x)));
    item.z=round(Math.max(halfZ,Math.min(size.depth-halfZ,item.z)));
    return item;
  }
  function validatePlan(raw) {
    if (!raw || ![1,2,3,4].includes(raw.version) || ![raw.width,raw.depth].every(v=>Number.isFinite(v)&&v>=40&&v<=500) || !Array.isArray(raw.items) || raw.items.length>1000) throw new Error('Dimensions ou nombre d’éléments incompatibles.');
    const ids=new Set();
    return raw.items.map(rawItem=>{
      if (!rawItem || !Object.hasOwn(labels,rawItem.type) || typeof rawItem.id!=='string' || !rawItem.id || rawItem.id.length>64 || ids.has(rawItem.id)) throw new Error('Un élément du plan est invalide.');
      ids.add(rawItem.id);
      if (!['x','z','w','d','h','r'].every(key=>typeof rawItem[key]==='number' && Number.isFinite(rawItem[key])) || rawItem.w<.3 || rawItem.w>500 || rawItem.d<.3 || rawItem.d>500 || rawItem.h<.3 || rawItem.h>50) throw new Error('Dimensions ou positions invalides.');
      const item={id:rawItem.id,type:rawItem.type,name:String(rawItem.name||labels[rawItem.type]).slice(0,45),x:rawItem.x,z:rawItem.z,w:rawItem.w,d:rawItem.d,h:rawItem.h,r:normAngle(rawItem.r)};
      if(item.type==='building' && shapes.has(rawItem.shape))item.shape=rawItem.shape;
      if(item.type==='custom'&&rawItem.outline)item.outline=window.desktopDesign.outline(rawItem.outline);
      if(rawItem.doors!==undefined){
        const walls=window.airsoftDoorWalls(item);
        if(!Array.isArray(rawItem.doors)||rawItem.doors.length>walls.length||!rawItem.doors.every(i=>Number.isInteger(i)&&walls[i]&&!walls[i].door))throw Error('Porte incompatible avec le mur.');
        item.doors=[...new Set(rawItem.doors)];
      }
      if(rawItem.apertures&&item.doors){
        item.apertures={};
        for(const index of item.doors){
          const door=rawItem.apertures[index];
          if(door&&Number.isFinite(door.at)&&door.at>=0&&door.at<=1&&Number.isFinite(door.width)&&door.width>=.3&&door.width<=8)item.apertures[index]={at:door.at,width:door.width};
        }
      }
      if(landmarks.includes(rawItem.landmark))item.landmark=rawItem.landmark;
      if(/^#[0-9a-f]{6}$/i.test(rawItem.color))item.color=rawItem.color;
      if(rawItem.locked===true)item.locked=true;
      if(typeof rawItem.group==='string'&&rawItem.group.length<=64&&rawItem.group)item.group=rawItem.group;
      if(item.group&&typeof rawItem.groupName==='string')item.groupName=rawItem.groupName.trim().slice(0,45);
      if(desktop&&raw.version<4)defaultCourt([item]);
      return clampItem(item,raw);
    });
  }
  function applyStored(state) {
    if (!state || applyingState) return false;
    try {
      const content=state.modelContent;
      if (!content?.plan) return false;
      items=validatePlan(content.plan);
      land=landFrom(content.plan);
      if(desktop && content.plan.version<3)items.push(...window.desktopDesign.zones());
      if(content.plan.version===1)items=window.AirsoftLayoutV2.revise(items);
      selectedId=content.selectedId===null?null:items.some(i=>i.id===content.selectedId)?content.selectedId:(items[0]?.id||null);
      const v=state.privateContent?.view;
      if (content.plan.version>=2 && v && ['yaw','pitch','zoom'].every(k=>Number.isFinite(v[k]))) view={yaw:v.yaw,pitch:Math.max(20,Math.min(90,v.pitch)),zoom:Math.max(.6,Math.min(7,v.zoom)),centerX:Number.isFinite(v.centerX)?v.centerX:50,centerZ:Number.isFinite(v.centerZ)?v.centerZ:80};
      if(view.pitch<89) last3D={...view};
      return true;
    } catch {return false;}
  }
  if(!desktop)applyStored(stateProvider?.widgetState);
  let projectStarted=!desktop;
  function saveState() {
    if (applyingState||!projectStarted) return;
    const state={modelContent:{plan:plan(),selectedId},privateContent:{view}};
    if(desktop) {
      desktop.setWidgetState(state);
      return;
    }
    // Oversized custom names remain available through the explicit plan export.
    if (new TextEncoder().encode(JSON.stringify(state)).byteLength>16000) return;
    sentStates.add(JSON.stringify(state));
    if(sentStates.size>60)sentStates.delete(sentStates.values().next().value);
    try { const result=stateProvider?.setWidgetState?.(state); result?.catch?.(()=>{}); } catch {}
  }
  let theme;
  function getTheme() {
    const probe=document.createElement('span');
    root.appendChild(probe);
    function resolve(name,fallback) {
      probe.style.color=`var(${name},var(${fallback}))`;
      return getComputedStyle(probe).color;
    }
    const colors={background:resolve('--background','--card'),foreground:resolve('--foreground','--card-foreground'),muted:resolve('--muted','--background'),border:resolve('--border','--muted-foreground')};
    for (let n=1;n<=6;n++) colors['series'+n]=resolve('--viz-series-'+n,'--foreground');
    probe.remove();
    return colors;
  }
  function landFrom(raw){
    const result={width:raw.width,depth:raw.depth,ground:/^#[0-9a-f]{6}$/i.test(raw.ground)?raw.ground:'#d2dcc5'};
    if(typeof raw.title==='string')result.title=raw.title.slice(0,60);
    if(Array.isArray(raw.hiddenLayers))result.hiddenLayers=raw.hiddenLayers.filter(k=>Object.hasOwn(labels,k));
    const photo=raw.photo;
    if(photo){
      if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo.url)||photo.url.length>1400000||![photo.x,photo.z,photo.w,photo.d].every(Number.isFinite)||photo.w<=0||photo.d<=0)throw Error('Fond de plan invalide.');
      result.photo={url:photo.url,x:photo.x,z:photo.z,w:photo.w,d:photo.d};
    }
    if(raw.boundary)result.boundary=window.desktopDesign.outline(raw.boundary);
    return result;
  }
  function areaRatio(points){
    if(!points)return 1;
    return Math.abs(points.reduce((sum,[x,z],i)=>{const next=points[(i+1)%points.length];return sum+x*next[1]-z*next[0];},0))/20000;
  }
  function draw() { const list=members();renderer?.setScene({items:items.filter(i=>!land.hiddenLayers?.includes(i.type)),selectedId,extraSelection:new Set(list.map(i=>i.id)),protectedSelection:list.some(i=>i.locked),boundary:null,...land,safeDepth:30,editableGround:!!desktop,theme}); }
  function zoneName(item){
    if(!desktop)return item.z<30?'Zone safe / parking':'Zone de jeu';
    const zones=items.filter(i=>i.type==='zone'||i.type==='parking').reverse();
    const found=zones.find(i=>{const a=i.r*Math.PI/180,dx=item.x-i.x,dz=item.z-i.z;return Math.abs(dx*Math.cos(a)-dz*Math.sin(a))<=i.w/2 && Math.abs(dx*Math.sin(a)+dz*Math.cos(a))<=i.d/2;});
    return found?.name||'Zone de jeu';
  }
  const foldSearch=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function updateObjectList(){
    const choice=el('object'),query=desktop?foldSearch(el('search').value.trim()):'';
    const matches=query?items.filter(i=>foldSearch(i.name+' '+labels[i.type]+' '+(i.groupName||'')).includes(query)):items;
    const options=matches.map(i=>new Option((i.locked?'🔒 ':'')+(multi&&picked.has(i.id)?'✓ ':'')+i.name+(i.groupName?' · '+i.groupName:''),i.id));
    const current=selected();
    if(current&&query&&!matches.includes(current))options.unshift(new Option(current.name+' (sélection actuelle)',current.id));
    choice.replaceChildren(new Option(query&&!matches.length?'Aucun résultat':'Aucun élément',''),...options);
    choice.value=selectedId||'';
    if(desktop&&query)el('selection-status').textContent=matches.length+' résultat'+(matches.length===1?'':'s');
  }
  if(desktop)el('search').addEventListener('input',()=>{updateObjectList();if(!el('search').value.trim())syncControls();});
  function syncControls() {
    updateObjectList();
    const item=selected();
    el('fields').hidden=!item;
    el('fields').disabled=!item;
    el('turn-tools').hidden=!item;
    if(desktop){
      const walls=item?window.airsoftDoorWalls(item):[];
      el('door-tools').hidden=!walls.length;
      const menu=el('door-wall'),previous=menu.value;
      menu.replaceChildren();
      walls.forEach((wall,index)=>{
        if(wall.door)return;
        const axis=wall.axis?(wall.axis==='x'?' · parallèle à la largeur':' · parallèle à la profondeur'):'';
        menu.add(new Option('Mur '+(index+1)+axis+(item.doors?.includes(index)?' · avec porte':''),String(index)));
      });
      menu.value=[...menu.options].some(o=>o.value===previous)?previous:(menu.options[0]?.value??'');
      el('door').textContent=item?.doors?.includes(Number(menu.value))?'Retirer la porte':'Ajouter une porte';
      el('outline-wrap').hidden=item?.type!=='custom';
      if(item?.type==='custom')el('outline').value=(item.outline||window.desktopDesign.defaultOutline).map(p=>p.join(',')).join(' ; ');
      for(const key of ['width','depth','ground'])el('land-'+key).value=land[key];
      el('x').max=land.width;el('z').max=land.depth;el('w').max=land.width;el('d').max=land.depth;el('h').max=50;
      if(item)el('color').value=item.color||({tree:'#789859',container:'#367287',tarp:'#789859',parking:'#c9c7bc',zone:'#e7d8b5'})[item.type]||'#9f6940';
      el('land-info').textContent=(land.title?land.title+' · ':'')+land.width+' × '+land.depth+' m · '+(land.width*land.depth*areaRatio(land.boundary)/10000).toLocaleString('fr-FR',{maximumFractionDigits:3})+' ha';
    }
    el('turn-name').textContent=item?.name||'';
    el('hint').textContent=item?'Fais glisser la poignée ronde pour tourner la sélection.':'Clique sur un bâtiment pour le déplacer ou le tourner.';
    el('shape-wrap').hidden=item?.type!=='building';
    if(item?.type==='building')el('shape').value=item.shape||'studio';
    if(!desktop)for(const key of landmarks){
      const button=el('focus-'+key);
      button.disabled=!items.some(object=>object.landmark===key);
      if(desktop)button.hidden=button.disabled;
    }
    if(desktop)el('square').hidden=!items.some(i=>i.landmark==='cour'||i.group==='cour');
    if(!desktop||!el('search').value.trim())el('selection-status').textContent=item?zoneName(item):`${items.length} éléments`;
    if (item) for(const key of ['name','type','x','z','w','d','h','r']) el(key).value=item[key];
    el('undo').disabled=!undo.length;
    el('redo').disabled=!redo.length;
    if(desktop){
      const list=members(), protectedSet=list.some(i=>i.locked), grouped=list.length>1;
      el('fields').disabled=!item||protectedSet||grouped||multi;
      for(const key of ['plus','minus','r'])el(key).disabled=!item||protectedSet||multi;
      el('lock').hidden=!list.length;el('lock').disabled=!list.length;el('lock').textContent=protectedSet?'🔓 Déverrouiller':'🔒 Verrouiller';
      el('part').hidden=!item?.group||multi;el('part').textContent=partGroup?'Revenir au groupe':'Modifier un membre';
      el('ungroup').hidden=!item?.group||multi;el('ungroup').disabled=items.some(i=>i.group===item?.group&&i.locked);
      el('group-field').hidden=!item?.group||multi;
      el('group-name').disabled=items.some(i=>item?.group&&i.group===item.group&&i.locked);
      if(item?.group&&document.activeElement!==el('group-name'))el('group-name').value=item.groupName||'';
      el('group').hidden=!multi;el('group').disabled=!grouped||protectedSet;
      el('scope').textContent=multi?list.length+' éléments cochés':item?.group?(partGroup?'Membre · '+item.name:(item.groupName||'Groupe')+' · '+list.length+' éléments'):(item?.name||'');
      el('hint').textContent=multi?'Clique sur les éléments à réunir ou choisis-les dans la liste.':({explore:'Glisse pour explorer. Clique sur un objet pour l’inspecter.',move:'Glisse l’objet pour le déplacer ou sa poignée ronde pour le tourner.',turn:'Sélectionne un objet puis fais glisser la poignée de l’anneau.',measure:'Choisis deux points au sol.'})[mode];
      for(const key of ['explore','move','turn','measure'])el(key).setAttribute('aria-pressed',String(mode===key));
      el('multi').setAttribute('aria-pressed',String(multi));
    }
    el('3d').setAttribute('aria-pressed',view.pitch<89?'true':'false');
    el('top').setAttribute('aria-pressed',view.pitch>=89?'true':'false');
  }
  function refresh() {syncControls();draw();renderer?.callbacks.syncDrawing?.();}
  function pushUndo(previous=snapshot()) {projectStarted=true;undo.push(previous); if(undo.length>30)undo.shift();redo=[];}
  function commitMutation(mutate) {
    const before=snapshot();
    mutate();
    if(JSON.stringify(before)!==JSON.stringify(snapshot())) {pushUndo(before);saveState();}
    el('error').textContent='';
    refresh();
  }
  renderer=new window.AirsoftRenderer(el('canvas'),{
    onSelect(id){
      if(desktop&&id&&!multi&&mode==='explore'&&!items.find(i=>i.id===id)?.locked)setMode('move');
      choose(id);
    },
    onDrag(id,x,z) {const item=items.find(i=>i.id===id);if(!item||multi)return;if(!dragStart)dragStart=snapshot();transform(item,x,z,item.r);draw();el('x').value=item.x;el('z').value=item.z;el('selection-status').textContent=zoneName(item);},
    onRotate(id,degrees) {
      const item=items.find(object=>object.id===id);
      if(!item)return;
      if(!dragStart)dragStart=snapshot();
      transform(item,item.x,item.z,normAngle(Math.round(degrees)));
      el('r').value=item.r;
      el('x').value=item.x;
      el('z').value=item.z;
      draw();
    },
    onCommit() {if(dragStart){if(JSON.stringify(dragStart.items)!==JSON.stringify(items))pushUndo(dragStart);dragStart=null;refresh();saveState();}},
    onViewChange(v) {view={...view,...v};if(view.pitch<89)last3D={...view};syncControls();saveState();}
  });
  theme=getTheme();
  renderer.setView(view);
  refresh();
  el('object').addEventListener('change',()=>choose(el('object').value||null));
  ['name','type','x','z','w','d','h','r'].forEach(key=>el(key).addEventListener('change',()=>{
    const item=selected();if(!item||members().some(i=>i.locked)||multi)return;
    if(key==='r' && el(key).value!=='' && Number.isFinite(Number(el(key).value))){commitMutation(()=>transform(item,item.x,item.z,Number(el(key).value)));return;}
    if(key==='name') {commitMutation(()=>{item.name=el('name').value.trim()||labels[item.type];});return;}
    if(key==='type') {commitMutation(()=>{item.type=el('type').value;delete item.doors;delete item.shape;delete item.landmark;clampItem(item);});return;}
    const value=Number(el(key).value);
    if(!Number.isFinite(value)||el(key).value==='') {el('error').textContent='Saisis une valeur numérique.';syncControls();return;}
    const min={x:0,z:0,w:.3,d:.3,h:.3,r:0}[key], max={x:land.width,z:land.depth,w:land.width,d:land.depth,h:50,r:359}[key];
    commitMutation(()=>{item[key]=key==='r'?normAngle(value):round(Math.max(min,Math.min(max,value)));clampItem(item);});
  }));
  for(const [key,degrees] of [['minus',-15],['plus',15],['rotate',90]]) {
    el(key).addEventListener('click',()=>{
      const item=selected();
      if(item)commitMutation(()=>transform(item,item.x,item.z,item.r+degrees));
    });
  }
  el('shape').addEventListener('change',()=>{
    const item=selected(), shape=el('shape').value;
    if(item?.type==='building' && shapes.has(shape))commitMutation(()=>{if(item.shape!==shape)delete item.doors;item.shape=shape;});
  });
  function showView(next) {
    view={...next};
    if(view.pitch<89)last3D={...view};
    renderer.setView(view);
    refresh();
    saveState();
  }
  if(!desktop)for(const key of landmarks) {
    el('focus-'+key).addEventListener('click',()=>{
      const item=items.find(object=>object.landmark===key);
      if(!item)return;
      selectedId=item.id;
      showView({...overview,centerX:item.x,centerZ:item.z,pitch:48,zoom:3.5});
    });
  }
  el('overview').addEventListener('click',()=>showView({...overview,centerX:land.width/2,centerZ:land.depth/2}));
  function newId() {let id;do{id='o'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}while(items.some(i=>i.id===id));return id;}
  function checkLimit() {if(items.length>=1000){el('error').textContent='Le plan contient déjà 1 000 éléments.';return false;}return true;}
    function distanceNote(){
      const points=renderer.measurePoints;
      if(!points?.length)return 'Clique sur le premier point au sol.';
      if(points.length===1)return 'Clique sur le deuxième point au sol.';
      return renderer.distanceText()+' au sol. Clique pour recommencer.';
    }
    function setMode(key){
      renderer.callbacks.cancelDrawing?.();mode=key;renderer.mode=mode;renderer.measuring=mode==='measure';renderer.measurePoints=[];
      multi=false;renderer.multi=false;picked.clear();
      el('measure-note').textContent=renderer.measuring?distanceNote():'';
      refresh();
    }
  // Search horizontal slices of the actual parcel, starting near the current view.
  function findPlacement(w,d){
    const polygon=(land.boundary||[[0,0],[100,0],[100,100],[0,100]])
      .map(([x,z])=>[x*land.width/100,z*land.depth/100]);
    const occupied=items.map(i=>{
      const angle=i.r*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
      return {x:i.x,z:i.z,dx:(w+c*i.w+s*i.d)/2+1,dz:(d+s*i.w+c*i.d)/2+1};
    });
    let best=null,bestScore=Infinity;
    const levels=[...new Set(polygon.map(p=>p[1]))].sort((a,b)=>a-b);
    for(let k=1;k<levels.length;k++){
      const low=levels[k-1],high=levels[k],rows=Math.max(1,Math.ceil((high-low)/Math.max(2,d/2)));
      for(let row=0;row<rows;row++){
        const z=low+(row+.5)*(high-low)/rows,cuts=[];
        polygon.forEach(([ax,az],i)=>{
          const [bx,bz]=polygon[(i+1)%polygon.length];
          if((az>z)!==(bz>z))cuts.push(ax+(bx-ax)*(z-az)/(bz-az));
        });
        cuts.sort((a,b)=>a-b);
        for(let j=0;j+1<cuts.length;j+=2){
          const left=cuts[j],right=cuts[j+1],cols=Math.max(1,Math.ceil((right-left)/Math.max(2,w/2)));
          for(let col=0;col<cols;col++){
            const x=left+(col+.5)*(right-left)/cols;
            if(x<w/2||x>land.width-w/2||z<d/2||z>land.depth-d/2)continue;
            let score=(x-view.centerX)**2+(z-view.centerZ)**2;
            if(score>=bestScore)continue;
            for(const i of occupied)if(Math.abs(x-i.x)<i.dx&&Math.abs(z-i.z)<i.dz)score+=1000000;
            if(score<bestScore){bestScore=score;best={x:round(x),z:round(z)};}
          }
        }
      }
    }
    return best;
  }
  el('add').addEventListener('click',()=>{
    if(!checkLimit())return;
    const type=el('add-type').value,[w,d,h]=defaults[type];
    const n=items.filter(i=>i.type===type).length+1;
    const item={id:newId(),type,name:labels[type]+' '+n,w,d,h,r:0};
    placeObject(item);
  });
  function placeObject(item){
    const position=findPlacement(item.w,item.d);
    if(!position){el('error').textContent='Le terrain est trop étroit pour placer cet objet.';return;}
    Object.assign(item,position);
    if(desktop)setMode('move');
    commitMutation(()=>{if(land.hiddenLayers?.includes(item.type))land.hiddenLayers=land.hiddenLayers.filter(k=>k!==item.type);items.push(item);selectedId=item.id;});
    showView({...view,centerX:item.x,centerZ:item.z});
    return true;
  }
  el('duplicate').addEventListener('click',()=>{
    const item=selected();if(!item||!checkLimit())return;
    commitMutation(()=>{const copy=clampItem({...item,id:newId(),name:(item.name+' (copie)').slice(0,45),x:item.x+item.w+3,z:item.z+2});delete copy.landmark;items.push(copy);selectedId=copy.id;});
  });
  el('delete').addEventListener('click',()=>{if(selected())commitMutation(()=>{const index=items.findIndex(i=>i.id===selectedId);items.splice(index,1);selectedId=items[Math.min(index,items.length-1)]?.id||null;});});
  el('undo').addEventListener('click',()=>{if(!undo.length)return;redo.push(snapshot());const state=undo.pop();items=state.items;land=state.land;selectedId=state.selectedId;refresh();saveState();});
  el('redo').addEventListener('click',()=>{if(!redo.length)return;undo.push(snapshot());const state=redo.pop();items=state.items;land=state.land;selectedId=state.selectedId;refresh();saveState();});
  el('top').addEventListener('click',()=>{if(view.pitch<89)last3D={...view};showView({...view,yaw:0,pitch:90});});
  el('3d').addEventListener('click',()=>{view={...last3D};renderer.setView(view);syncControls();saveState();});
  function updatePlanText() {el('plan-text').value=JSON.stringify(plan(),null,2);el('load-status').textContent='';}
  function loadPlan(raw) {
    const loaded=validatePlan(raw),ground=landFrom(raw);
    if(desktop)setMode("explore");
    commitMutation(()=>{land=ground;items=desktop&&raw.version<3?loaded.concat(window.desktopDesign.zones()):loaded;selectedId=items[0]?.id||null;});
    showView({...overview,centerX:land.width/2,centerZ:land.depth/2});
  }
  el('save')?.addEventListener('click',()=>{const show=el('plan-panel').hidden;el('plan-panel').hidden=!show;el('save').setAttribute('aria-expanded',String(show));if(show){updatePlanText();el('plan-text').focus();el('plan-text').select();}});
  el('refresh-plan')?.addEventListener('click',()=>{updatePlanText();el('plan-text').focus();el('plan-text').select();});
  el('load-plan')?.addEventListener('click',()=>{
    try {loadPlan(JSON.parse(el('plan-text').value));el('load-status').textContent='Plan chargé.';}
    catch(e){el('load-status').textContent=e instanceof SyntaxError?'Texte invalide : colle un plan JSON complet.':e.message;}
  });
  if(desktop) {
    el('door-wall').addEventListener('change',()=>syncControls());
    el('door').addEventListener('click',()=>{
      const item=selected(),index=Number(el('door-wall').value);
      if(!item||item.locked||!window.airsoftDoorWalls(item)[index]||window.airsoftDoorWalls(item)[index].door)return;
      commitMutation(()=>{
        const doors=new Set(item.doors||[]);
        if(doors.has(index))doors.delete(index);else doors.add(index);
        item.doors=[...doors];
      });
    });
    const shape=id=>document.getElementById('shape-'+id);
    let points=[];
    function previewShape(){
      const type=shape('type').value;
      shape('drawing').hidden=type!=='custom';shape('depth-label').hidden=type==='round';
      shape('width-label').textContent=type==='round'?'Diamètre (m)':'Largeur (m)';
      shape('polygon').setAttribute('points',points.map(p=>p.join(',')).join(' '));
      shape('vertices').replaceChildren(...points.map(([x,y])=>{
        const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');
        dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',1.6);dot.setAttribute('fill','#244e38');return dot;
      }));
      shape('note').textContent=type==='custom'?points.length+' sommets · 3 minimum':'';
    }
    el('design').addEventListener('click',()=>{
      points=[];shape('name').value='';shape('type').value='box';previewShape();shape('dialog').showModal();
    });
    shape('type').addEventListener('change',()=>{
      const [w,d,h]=defaults[shape('type').value];shape('w').value=w;shape('d').value=d;shape('h').value=h;previewShape();
    });
    shape('pad').addEventListener('click',e=>{
      if(points.length>=40)return;
      const rect=shape('pad').getBoundingClientRect();
      points.push([e.clientX-rect.left,e.clientY-rect.top].map((n,i)=>Math.max(0,Math.min(100,Math.round(n*100/(i?rect.height:rect.width))))));
      previewShape();
    });
    shape('back').addEventListener('click',()=>{points.pop();previewShape();});
    shape('cancel').addEventListener('click',()=>shape('dialog').close());
    shape('create').addEventListener('click',()=>{
      try{
        const type=shape('type').value,w=Number(shape('w').value),d=type==='round'?w:Number(shape('d').value),h=Number(shape('h').value);
        if(![w,d,h].every(n=>Number.isFinite(n)&&n>=.3)||w>land.width||d>land.depth||h>50)throw Error('Vérifie les dimensions du terrain et la hauteur (0,3 à 50 m).');
        const item={id:newId(),type,w,d,h,r:0,color:shape('color').value,name:shape('name').value.trim()||labels[type]};
        if(type==='custom'){
          const outline=window.desktopDesign.outline(points);
          const xs=outline.map(p=>p[0]),zs=outline.map(p=>p[1]);
          const left=Math.min(...xs),top=Math.min(...zs);
          item.outline=outline.map(([x,z])=>[(x-left)*100/(Math.max(...xs)-left),(z-top)*100/(Math.max(...zs)-top)]);
        }
        if(!checkLimit()||!placeObject(item))throw Error(el('error').textContent);
        shape('dialog').close();
      }catch(error){shape('note').textContent=error.message;}
    });
    window.addEventListener('keydown',event=>{
      if(!(event.ctrlKey||event.metaKey)||event.altKey||event.repeat||event.defaultPrevented)return;
      if(event.target?.closest?.('input,textarea,select,[contenteditable="true"],dialog')||document.querySelector('dialog[open]'))return;
      const key=event.key.toLowerCase();
      const action=key==='z'?(event.shiftKey?'redo':'undo'):key==='y'?'redo':null;
      if(action&&!el(action).disabled){event.preventDefault();el(action).click();}
    });
    /* DESKTOP DRAWING */
    const previous=desktop.widgetState;
    el('resume').hidden=!previous?.modelContent?.plan;
    el('resume').addEventListener('click',()=>{
      try{loadPlan(previous.modelContent.plan);el('resume').hidden=true;}
      catch(error){el('error').textContent=error.message;}
    });
    desktop.connect({getPlan:plan,loadPlan});
    const map=id=>document.getElementById('map-'+id);
    function draftMap(){
      const width=Number(map('width').value),depth=Number(map('depth').value);
      if(![width,depth].every(n=>Number.isFinite(n)&&n>=40&&n<=500))throw Error('Choisis deux dimensions entre 40 et 500 m.');
      const presets={rect:[[0,0],[100,0],[100,100],[0,100]],ell:[[0,0],[100,0],[100,50],[55,50],[55,100],[0,100]],trapeze:[[0,0],[100,0],[80,100],[20,100]]};
      const free=map('shape').value==='libre';
      const coords=free?map('points').value.split(';').map(pair=>pair.split(',').map((v,i)=>v.trim()?Number(v)*100/(i===0?width:depth):NaN)):presets[map('shape').value];
      return {width,depth,title:map('name').value.trim()||'Mon terrain',ground:'#d2dcc5',boundary:window.desktopDesign.outline(coords)};
    }
    function previewMap(){
      map('custom').hidden=map('shape').value!=='libre';
      try{
        const draft=draftMap(),scale=100/Math.max(draft.width,draft.depth);
        map('polygon').setAttribute('points',draft.boundary.map(([x,z])=>[x*draft.width*scale/100,z*draft.depth*scale/100].join(',')).join(' '));
        map('status').textContent=Math.round(draft.width*draft.depth*areaRatio(draft.boundary)).toLocaleString('fr-FR')+' m²';map('create').disabled=false;
      }catch(error){map('polygon').setAttribute('points','');map('status').textContent=error.message;map('create').disabled=true;}
    }
    document.getElementById('ate-file-new').addEventListener('click',()=>{previewMap();map('dialog').showModal();});
    for(const key of ['width','depth','shape','points'])map(key).addEventListener('input',previewMap);
    map('cancel').addEventListener('click',()=>map('dialog').close());
    map('create').addEventListener('click',()=>{
      let draft;try{draft=draftMap();}catch{previewMap();return;}
      commitMutation(()=>{land=draft;items=[];selectedId=null;partGroup=null;picked.clear();});
      setMode('explore');showView({...overview,centerX:land.width/2,centerZ:land.depth/2});map('dialog').close();
    });
    renderer.mode=mode;
    for(const key of ['explore','move','turn','measure'])el(key).addEventListener('click',()=>setMode(key));
    el('multi').addEventListener('click',()=>{
      const enabling=!multi;setMode('explore');multi=enabling;renderer.multi=multi;partGroup=null;
      if(multi)for(const i of (selected()?.group?items.filter(i=>i.group===selected().group):[selected()]))if(i)picked.add(i.id);
      refresh();
    });
    el('lock').addEventListener('click',()=>{const list=members();const unlock=list.some(i=>i.locked);commitMutation(()=>list.forEach(i=>{if(unlock)delete i.locked;else i.locked=true;}));});
    el('part').addEventListener('click',()=>{partGroup=partGroup?null:selected()?.group;refresh();});
    el('group-name').addEventListener('change',()=>{
      const group=selected()?.group,name=el('group-name').value.trim().slice(0,45);
      if(!group||items.some(i=>i.group===group&&i.locked))return;
      commitMutation(()=>items.filter(i=>i.group===group).forEach(i=>i.groupName=name));
    });
    el('ungroup').addEventListener('click',()=>{const group=selected()?.group;if(!group||items.some(i=>i.group===group&&i.locked))return;commitMutation(()=>{items.filter(i=>i.group===group).forEach(i=>{delete i.group;delete i.groupName;});partGroup=null;});});
    el('group').addEventListener('click',()=>{const list=members();if(list.length<2||list.some(i=>i.locked))return;commitMutation(()=>{const id=newId();list.forEach(i=>{i.group=id;delete i.groupName;});multi=false;renderer.multi=false;partGroup=null;picked.clear();});el('group-name').focus();});
    el('snap').addEventListener('change',()=>{
      renderer.snapStep=Number(el('snap').value);
      renderer.schedule();
    });
    renderer.callbacks.onMeasure=()=>{el('measure-note').textContent=distanceNote();};
    el('png').addEventListener('click',()=>{
      const canvas=el('canvas');
      const selection=renderer.scene.selectedId;
      renderer.scene.selectedId=null;
      try{
        renderer.render();
        canvas.toBlob(blob=>{
          if(!blob){el('error').textContent='Impossible de créer l’image.';return;}
          const url=URL.createObjectURL(blob);
          const link=document.createElement('a');
          link.download='Vue du terrain.png';link.href=url;document.body.appendChild(link);
          link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
        },'image/png');
      }finally{renderer.scene.selectedId=selection;renderer.schedule();}
    });
    el('outline-apply').addEventListener('click',()=>{
      const item=selected();if(item?.type!=='custom')return;
      try{
        const points=el('outline').value.split(';').map(pair=>pair.trim().split(',').map(value=>value.trim()===''?NaN:Number(value)));
        const validated=window.desktopDesign.outline(points);
        commitMutation(()=>{item.outline=validated;});
      }catch(error){el('error').textContent=error.message;}
    });
    el('color').addEventListener('change',()=>{const item=selected();if(item)commitMutation(()=>{item.color=el('color').value;});});
    for(const key of ['width','depth','ground'])el('land-'+key).addEventListener('change',()=>{
      const value=key==='ground'?el('land-ground').value:Number(el('land-'+key).value);
      if(key!=='ground'&&(!Number.isFinite(value)||value<40||value>500)){refresh();return;}
      if(key!=='ground' && items.some(i=>i.locked && JSON.stringify(i)!==JSON.stringify(clampItem({...i},{...land,[key]:value})))){refresh();el('error').textContent='Déverrouille les objets qui dépasseraient du terrain.';return;}
      commitMutation(()=>{land[key]=value;items.forEach(item=>clampItem(item));});
    });
    el('square').addEventListener('click',()=>{
      const square=window.AirsoftLayoutV2.seed(base).filter(item=>['o1','o2','o3','o4','o31'].includes(item.id));
      if(square.some(p=>items.find(i=>i.id===p.id)?.locked)){el('error').textContent='Déverrouille la cour avant de la reformer.';return;}
      if(items.length+square.filter(part=>!items.some(item=>item.id===part.id)).length>1000){
        el('error').textContent='Il manque de la place pour reformer la cour. Le plan peut contenir 1 000 éléments.';
        return;
      }
      commitMutation(()=>{
        for(const part of square){
          const index=items.findIndex(item=>item.id===part.id);
          if(index===-1)items.push(part);
          else items[index]={...items[index],...part};
          clampItem(items.find(item=>item.id===part.id));
        }
        selectedId='o31';
      });
    });
  }
  window.addEventListener('openai:set_globals',event=>{
    const state=event.detail?.globals?.widgetState;
    if(!state)return;
    if(sentStates.has(JSON.stringify({modelContent:state.modelContent,privateContent:state.privateContent})))return;
    // Host state notifications may echo our own optimistic save. Keep the
    // existing undo stack and in-progress interactions for an identical state.
    if (JSON.stringify(state.modelContent)===JSON.stringify({plan:plan(),selectedId}) && JSON.stringify(state.privateContent?.view)===JSON.stringify(view)) return;
    applyingState=true;
    if(applyStoredWithGuard(state)){undo=[];redo=[];renderer.setView(view);refresh();}
    applyingState=false;
  });
  function applyStoredWithGuard(state){applyingState=false;const result=applyStored(state);applyingState=true;return result;}
  let colorTimer;
  const themeWatcher=new MutationObserver(()=>{clearTimeout(colorTimer);colorTimer=setTimeout(()=>{theme=getTheme();draw();},60);});
  themeWatcher.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
  if(document.body)themeWatcher.observe(document.body,{attributes:true,attributeFilter:['class','style','data-theme']});
  window.addEventListener('resize',()=>renderer.resize());
  // Small, read-only diagnostic surface for interaction checks and accessible exports.
  root.airsoft={getPlan:plan,getSelection:()=>selectedId,getView:()=>({...view}),project:(x,y,z)=>renderer.project(x,y,z),getRotationHandle:()=>renderer.getRotationHandle()};
})();
