// Desktop drafting tools run inside the editor and use its normal undo and save paths.
const tools=renderer.callbacks, canvas=el('canvas');
const libraryKey='terrain-airsoft.templates.v1';
let drawing=null, anchor=null, hover=null, sizing=null, photoImage=null, photoSource=null;
const tips={visit:'Clique sur le terrain pour y commencer la visite. Échap pour annuler.',trace:'Clique pour commencer le mur, puis sur chaque angle. Échap pour terminer.',
  'place-door':'Clique sur le mur à l’endroit voulu. Échap pour terminer.',
  resize:'Fais glisser un coin en vue du dessus. Échap pour terminer.',
  calibrate:'Clique sur les deux repères de distance connue dans la photo.'};
const tip=t=>{el('hint').textContent=t;};
/* WALKTHROUGH */
function cancelDrawing(){
  drawing=null;anchor=null;hover=null;
  if(sizing){renderer.callbacks.onCommit();sizing=null;}
}
tools.cancelDrawing=cancelDrawing;
function startDrawing(key){
  if(drawing===key){setMode('explore');return;}
  if(key==='visit')visitReturnView={...view};
  setMode('explore');showView({...view,pitch:90,yaw:0});drawing=key;refresh();
}
for(const key of Object.keys(tips))el(key).addEventListener('click',()=>startDrawing(key));
window.addEventListener('keydown',event=>{if(drawing&&event.key==='Escape')setMode('explore');});
tools.syncDrawing=()=>{
  const single=selected(),category=el('layer').value;
  el('resize').disabled=!single||single.locked||members().length!==1||land.hiddenLayers?.includes(single.type);
  el('calibrate').disabled=el('clear-photo').disabled=!land.photo;
  el('visible').textContent=land.hiddenLayers?.includes(category)?'Afficher le calque':'Masquer le calque';
  const layer=items.filter(i=>i.type===category);
  el('layer-lock').disabled=!layer.length;
  el('layer-lock').textContent=layer.length&&layer.every(i=>i.locked)?'Déverrouiller les objets':'Verrouiller les objets';
  for(const key of Object.keys(tips))el(key).setAttribute('aria-pressed',String(key===drawing));
  if(drawing)tip(tips[drawing]);
};
const radians=a=>a*Math.PI/180;
function corners(item){
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>{
    const [x,,z]=renderer.local(item,a*item.w/2,0,b*item.d/2);
    return {x,z,a,b};
  });
}
tools.magnet=(item,x,z)=>{
  if(!el('magnet').checked)return null;
  const pts=corners({...item,x,z}),limit=Math.min(2,8/renderer.scale);
  let dx=Infinity,dz=Infinity;
  const bounds=(points,k)=>[Math.min(...points.map(p=>p[k])),Math.max(...points.map(p=>p[k]))];
  const bx=bounds(pts,'x'),bz=bounds(pts,'z');
  for(const other of renderer.scene.items){
    if(other.id===item.id||(item.group&&item.group===other.group))continue;
    const pts2=corners(other),ox=bounds(pts2,'x'),oz=bounds(pts2,'z');
    if(bz[0]<=oz[1]+limit&&bz[1]>=oz[0]-limit)
      for(const a of bx)for(const b of ox)if(Math.abs(b-a)<Math.abs(dx))dx=b-a;
    if(bx[0]<=ox[1]+limit&&bx[1]>=ox[0]-limit)
      for(const a of bz)for(const b of oz)if(Math.abs(b-a)<Math.abs(dz))dz=b-a;
  }
  return {x:x+(Math.abs(dx)<=limit?dx:0),z:z+(Math.abs(dz)<=limit?dz:0)};
};
function attachDoor(p){
  const distance=Math.min(3,Math.max(.6,10/renderer.scale));
  let closest=null;
  for(const item of renderer.scene.items){
    if(item.locked||items.some(i=>item.group&&i.group===item.group&&i.locked))continue;
    window.airsoftDoorWalls(item).forEach((wall,index)=>{
      if(wall.door)return;
      const across=wall.axis!=='z',building=item.type==='building',inset=building?Math.min(.22,item.w*.065,item.d*.065):0;
      const w=item.w-inset,d=item.d-inset;
      const point=t=>renderer.local(item,(across?t:(wall.fixed??.5)-.5)*w,0,(across?(wall.fixed??.5)-.5:t)*d);
      const [ax,,az]=wall.a?renderer.local(item,wall.a[0],0,wall.a[1]):point((wall.start??0)-.5);
      const [bx,,bz]=wall.b?renderer.local(item,wall.b[0],0,wall.b[1]):point((wall.end??1)-.5);
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);
      const at=Math.max(0,Math.min(1,((p.x-ax)*dx+(p.z-az)*dz)/(len*len)));
      const error=Math.hypot(ax+at*dx-p.x,az+at*dz-p.z);
      if(error<=distance&&(!closest||error<closest.error))closest={item,index,at,error,len};
    });
  }
  const width=Number(el('door-size').value);
  if(!closest||width<.3||width>8||!Number.isFinite(width)||width>closest.len*.96){tip('Choisis un mur libre assez long et une largeur entre 0,3 et 8 m.');return;}
  const {item,index,at}=closest;
  commitMutation(()=>{item.doors=[...new Set([...(item.doors||[]),index])];item.apertures={...item.apertures,[index]:{at,width}};selectedId=item.id;});
  tip('Porte placée. Clique sur un autre mur ou termine avec Échap.');
}
tools.drawingDown=(point,e)=>{
  if(!drawing)return false;
  const p=renderer.groundAt(point.x,point.y);
  if(p.x<0||p.z<0||p.x>land.width||p.z>land.depth)return true;
  if(drawing==='visit'){launchVisit(p);return true;}
  if(drawing==='place-door'){attachDoor(p);return true;}
  if(drawing==='resize'){
    const item=selected();
    if(!item||el('resize').disabled)return true;
    const corner=corners(item).find(c=>{const q=renderer.project(c.x,0,c.z);return Math.hypot(point.x-q.x,point.y-q.y)<=13;});
    if(corner){sizing={item,original:{...item},corner,pointerId:e.pointerId};dragStart=snapshot();canvas.setPointerCapture(e.pointerId);}
    return true;
  }
  if(!anchor){anchor=p;hover=p;tip('Clique sur le point suivant.');renderer.schedule();return true;}
  const length=Math.hypot(p.x-anchor.x,p.z-anchor.z);
  if(length<.3)return true;
  if(drawing==='calibrate'){
    const m=Number(el('reference').value),photo=land.photo;
    if(!photo||!(m>=.1&&m<=10000)){tip('Saisis une distance comprise entre 0,1 et 10 000 m.');return true;}
    const ratio=m/length;
    commitMutation(()=>{land.photo={...photo,x:anchor.x+(photo.x-anchor.x)*ratio,z:anchor.z+(photo.z-anchor.z)*ratio,w:photo.w*ratio,d:photo.d*ratio};});
    setMode('explore');return true;
  }
  if(length>500||!checkLimit())return true;
  const wall={type:'wall',name:'Mur '+(items.filter(i=>i.type==='wall').length+1),id:newId(),x:(anchor.x+p.x)/2,z:(anchor.z+p.z)/2,w:length,d:.3,h:2.2,r:normAngle(Math.atan2(anchor.z-p.z,p.x-anchor.x)*180/Math.PI)};
  commitMutation(()=>{items.push(wall);selectedId=wall.id;});anchor=p;hover=p;return true;
};
tools.drawingMove=(point,e)=>{
  if(!drawing)return false;
  hover=renderer.groundAt(point.x,point.y);
  if(sizing&&sizing.pointerId===e.pointerId){
    const {item,original,corner}=sizing;
    const fixed=corners(original).find(c=>c.a===-corner.a&&c.b===-corner.b);
    const dx=hover.x-fixed.x,dz=hover.z-fixed.z,c=Math.cos(radians(item.r)),s=Math.sin(radians(item.r));
    const w=Math.max(.3,Math.min(land.width,corner.a*(dx*c-dz*s))),d=Math.max(.3,Math.min(land.depth,corner.b*(dx*s+dz*c)));
    Object.assign(item,clampItem({...item,w,d,x:fixed.x+(corner.a*w*c+corner.b*d*s)/2,z:fixed.z+(-corner.a*w*s+corner.b*d*c)/2}));
    refresh();
  }
  renderer.schedule();return true;
};
tools.drawingUp=e=>{
  if(!sizing||sizing.pointerId!==e.pointerId)return false;
  sizing=null;tools.onCommit();return true;
};
tools.drawOverlay=()=>{
  const item=selected(),c=renderer.ctx;
  if(drawing==='resize'&&item&&!el('resize').disabled){
    for(const pt of corners(item)){const q=renderer.project(pt.x,0,pt.z);c.fillStyle='#fff';c.fillRect(q.x-5,q.y-5,10,10);c.strokeStyle='#165b43';c.strokeRect(q.x-5,q.y-5,10,10);}
    renderer.label(round(item.w)+' × '+round(item.d)+' m',item.x,item.z,{badge:true});
  }
  if(anchor&&hover){
    renderer.worldLine([anchor.x,0,anchor.z],[hover.x,0,hover.z],'#195b40',2,[5,3]);
    renderer.label(round(Math.hypot(hover.x-anchor.x,hover.z-anchor.z))+' m',(anchor.x+hover.x)/2,(anchor.z+hover.z)/2,{badge:true});
  }
};
el('layer').addEventListener('change',()=>tools.syncDrawing());
el('visible').addEventListener('click',()=>commitMutation(()=>{
  const key=el('layer').value,list=new Set(land.hiddenLayers||[]);
  if(list.has(key))list.delete(key);else list.add(key);
  land.hiddenLayers=[...list];if(list.has(selected()?.type))selectedId=null;
}));
el('layer-lock').addEventListener('click',()=>commitMutation(()=>{
  const list=items.filter(i=>i.type===el('layer').value),lock=!list.every(i=>i.locked);
  list.forEach(i=>{if(lock)i.locked=true;else delete i.locked;});
}));
function templates(){try{return JSON.parse(localStorage.getItem(libraryKey)||'[]');}catch{return [];}}
function listTemplates(){
  const list=templates();
  el('templates').replaceChildren(...list.map((t,i)=>new Option(t.name,String(i))));
  el('template-use').disabled=!list.length;
}
listTemplates();
el('template-save').addEventListener('click',()=>{
  const chosen=members(),name=el('template-name').value.trim()||selected()?.name;
  if(!chosen.length||!name){tip('Sélectionne un objet ou un groupe à mémoriser.');return;}
  const list=templates();list.push({name,items:clone(chosen)});
  try{localStorage.setItem(libraryKey,JSON.stringify(list));listTemplates();el('templates').value=String(list.length-1);tip('Modèle mémorisé sur ce PC.');}catch{tip('Bibliothèque pleine ou stockage indisponible.');}
});
el('template-use').addEventListener('click',()=>{
  const entry=templates()[Number(el('templates').value)];if(!entry)return;
  let list;
  try{list=validatePlan({version:4,width:500,depth:500,items:entry.items});}catch{tip('Modèle illisible.');return;}
  if(!list.length||items.length+list.length>1000)return;
  const pts=list.flatMap(corners),xs=pts.map(p=>p.x),zs=pts.map(p=>p.z);
  const left=Math.min(...xs),top=Math.min(...zs),w=Math.max(...xs)-left,d=Math.max(...zs)-top;
  const pos=findPlacement(w,d);if(!pos){tip('Le modèle dépasse les dimensions disponibles.');return;}
  const group=list.length>1?newId():null;
  commitMutation(()=>{for(const i of list){i.id=newId();i.x+=pos.x-left-w/2;i.z+=pos.z-top-d/2;delete i.group;delete i.landmark;delete i.locked;if(group){i.group=group;i.groupName=entry.name;}else delete i.groupName;items.push(i);}selectedId=list[0].id;});
  setMode('move');showView({...view,centerX:pos.x,centerZ:pos.z});
});
el('underlay').addEventListener('change',async()=>{
  const input=el('underlay'),file=input.files[0];if(!file)return;
  const url=URL.createObjectURL(file),originalLand=land;
  try{
    const image=new Image();image.src=url;await image.decode();if(land!==originalLand)return;
    const scale=Math.min(1,1300/Math.max(image.width,image.height));
    const buffer=document.createElement('canvas');buffer.width=Math.max(1,Math.round(image.width*scale));buffer.height=Math.max(1,Math.round(image.height*scale));
    const c=buffer.getContext('2d');c.fillStyle='white';c.fillRect(0,0,buffer.width,buffer.height);c.drawImage(image,0,0,buffer.width,buffer.height);
    const data=buffer.toDataURL('image/jpeg',.65),fit=Math.min(land.width/image.width,land.depth/image.height);
    if(data.length>1400000)throw Error('Image trop détaillée.');
    const w=image.width*fit,d=image.height*fit;
    commitMutation(()=>{land.photo={url:data,w,d,x:(land.width-w)/2,z:(land.depth+d)/2};});
    showView({...view,yaw:0,pitch:90});tip('Fond importé. Indique une distance puis pointe les deux repères.');
  }catch{tip('Impossible de lire cette image. Choisis un fichier JPEG, PNG ou WebP.');}
  finally{input.value='';URL.revokeObjectURL(url);}
});
el('clear-photo').addEventListener('click',()=>{setMode('explore');commitMutation(()=>{delete land.photo;});});
tools.drawPhoto=()=>{
  const photo=land.photo;if(!photo)return;
  if(photoSource!==photo.url){photoSource=photo.url;photoImage=new Image();photoImage.onload=()=>renderer.schedule();photoImage.src=photoSource;}
  if(!photoImage.complete||!photoImage.naturalWidth)return;
  const a=renderer.project(photo.x,0,photo.z),b=renderer.project(photo.x+photo.w,0,photo.z),d=renderer.project(photo.x,0,photo.z-photo.d),c=renderer.ctx;
  c.save();c.globalAlpha=.78;c.transform(b.x-a.x,b.y-a.y,d.x-a.x,d.y-a.y,a.x,a.y);c.drawImage(photoImage,0,0,1,1);c.restore();
};
el('print').addEventListener('click',()=>{
  const scene=renderer.scene,previous=renderer.getView(),old=renderer.callbacks.drawOverlay;
  const sheet=document.createElement('section');sheet.id='print-plan';
  try{
    renderer.callbacks.drawOverlay=()=>{};
    renderer.scene={...scene,selectedId:null,extraSelection:new Set()};
    renderer.setView({yaw:0,pitch:90,centerX:land.width/2,centerZ:land.depth/2,zoom:1});renderer.render();
    const c=renderer.ctx,len=land.width>=100?10:5;c.fillStyle='#213e30';c.fillRect(12,renderer.height-12,len*renderer.scale,3);c.textAlign='left';c.fillText(len+' m',12,renderer.height-22);
    const title=document.createElement('h1');title.textContent=land.title||'Plan du terrain';
    const info=document.createElement('p');info.textContent=land.width+' × '+land.depth+' m · '+round(land.width*land.depth*areaRatio(land.boundary))+' m²';
    const img=document.createElement('img');img.src=canvas.toDataURL('image/png');sheet.append(title,info,img);
    const table=document.createElement('table');
    for(const row of [['Objet','Centre X / Z (m)','Largeur × profondeur (m)','Rotation'],...scene.items.map(i=>[i.name,round(i.x)+' / '+round(i.z),round(i.w)+' × '+round(i.d),round(i.r)+'°'])]){
      const tr=table.insertRow();for(const value of row)tr.insertCell().textContent=value;
    }
    sheet.append(table);document.getElementById('print-plan')?.remove();document.body.append(sheet);
    img.decode().then(()=>window.print()).catch(()=>tip('Aperçu d’impression indisponible.'));
  }finally{renderer.callbacks.drawOverlay=old;renderer.scene=scene;renderer.setView(previous);renderer.schedule();}
});
tools.syncDrawing();
