// A separate perspective viewport keeps navigation independent of the editable plan.
const walkDialog=document.getElementById('visit-dialog'),walkCanvas=document.getElementById('visit-canvas');
let visitReturnView=null,visitor=null,walkFrame=0,walkDrag=null,walkSurfaces=[],walkEdge=[];
const walkKeys=new Set();
function insideParcel(p){
  let inside=false;
  for(let i=0,j=walkEdge.length-1;i<walkEdge.length;j=i++){
    const [ax,az]=walkEdge[i],[bx,bz]=walkEdge[j];
    if((az>p.z)!==(bz>p.z)&&p.x<(bx-ax)*(p.z-az)/(bz-az)+ax)inside=!inside;
  }
  return inside;
}
function collectSurfaces(){
  // Reuse the editor's geometry, including its door openings and custom outlines.
  const mesh=Object.create(renderer),base=renderer.p;
  const surfaces=[];
  mesh.scale=4;
  mesh.face=(vertices,color)=>surfaces.push({vertices,color:'rgb('+color.join(',')+')',layer:3});
  const flat=(vertices,color,layer)=>surfaces.push({vertices,color,layer});
  flat(walkEdge.map(([x,z])=>[x,0,z]),land.ground,0);
  for(const item of renderer.scene.items){
    const col=item.color&&[1,3,5].map(i=>parseInt(item.color.slice(i,i+2),16));
    mesh.p=col?{...base,wood:col,foliage:col,tarp:col,series:[col,col,col,...base.series.slice(3)]}:base;
    if(['zone','parking','building'].includes(item.type)){
      const footprints=mesh.footprints(item);
      for(const poly of footprints)flat(poly.map(([x,z])=>mesh.local(item,x,.015,z)),
        item.type==='building'?'#b8aa92':item.color||'#c7c8b8',item.type==='zone'?1:2);
      if(item.type==='parking'){
        for(let x=-item.w*.48;x<item.w*.5;x+=3)for(const sign of [-1,1]){
          const stripe=[[x,.2],[x+.08,.2],[x+.08,.46],[x,.46]];
          flat(stripe.map(([px,pz])=>mesh.local(item,px,.025,pz*sign*item.d)),'#eeeece',2.5);
        }
      }
    }
    mesh.addObject(item);
  }
  return surfaces;
}
function launchVisit(point){
  walkEdge=(land.boundary||[[0,0],[100,0],[100,100],[0,100]]).map(([x,z])=>[x*land.width/100,z*land.depth/100]);
  if(!insideParcel(point)){tip('Choisis un point à l’intérieur du contour.');return;}
  visitor={...point,yaw:Math.atan2(land.width/2-point.x,land.depth/2-point.z),pitch:0};
  walkSurfaces=collectSurfaces();walkDialog.showModal();walkCanvas.focus();renderVisit();
}
function renderVisit(){
  if(!visitor)return;
  const c=walkCanvas.getContext('2d'),w=Math.max(1,walkCanvas.clientWidth),h=Math.max(1,walkCanvas.clientHeight);
  const dpr=Math.min(1.5,window.devicePixelRatio||1);
  if(walkCanvas.width!==Math.round(w*dpr)||walkCanvas.height!==Math.round(h*dpr)){
    walkCanvas.width=Math.round(w*dpr);walkCanvas.height=Math.round(h*dpr);
  }
  c.setTransform(dpr,0,0,dpr,0,0);
  const f=Math.min(w*.86,h*.95),cy=Math.cos(visitor.yaw),sy=Math.sin(visitor.yaw),cp=Math.cos(visitor.pitch),sp=Math.sin(visitor.pitch);
  const horizon=h/2+f*Math.tan(visitor.pitch);
  const sky=c.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#81b6cd');sky.addColorStop(1,'#ebf2e4');
  c.fillStyle=sky;c.fillRect(0,0,w,h);c.fillStyle='#a0aa8d';c.fillRect(0,horizon,w,h-horizon);
  const visible=[];
  for(const face of walkSurfaces){
    const points=face.vertices.map(([x,y,z])=>{
      const dx=x-visitor.x,dz=z-visitor.z,dy=y-1.65,forward=dx*sy+dz*cy;
      return [dx*cy-dz*sy,dy*cp-forward*sp,forward*cp+dy*sp];
    });
    const clipped=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      if(a[2]>=.08)clipped.push(a);
      if((a[2]>=.08)!==(b[2]>=.08)){
        const t=(.08-a[2])/(b[2]-a[2]);clipped.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.08]);
      }
    }
    if(clipped.length<3)continue;
    const screen=clipped.map(([x,y,z])=>[w/2+f*x/z,h/2-f*y/z]);
    if(screen.every(p=>p[0]<0)||screen.every(p=>p[0]>w)||screen.every(p=>p[1]<0)||screen.every(p=>p[1]>h))continue;
    visible.push({face,screen,depth:clipped.reduce((a,p)=>a+p[2],0)/clipped.length});
  }
  visible.sort((a,b)=>a.face.layer-b.face.layer||b.depth-a.depth);
  for(const {face,screen} of visible){
    c.beginPath();screen.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=face.color;c.fill();
  }
  document.getElementById('visit-position').textContent='Hauteur 1,65 m · X '+visitor.x.toFixed(1)+' m · Z '+visitor.z.toFixed(1)+' m';
}
let walkTime=0;
function walkTick(time){
  walkFrame=0;if(!visitor||!walkKeys.size)return;
  const dt=Math.min(.06,(time-walkTime)/1000);walkTime=time;
  const key=(...keys)=>Number(keys.some(k=>walkKeys.has(k)));
  visitor.yaw+=(key('arrowright')-key('arrowleft'))*dt*1.6;
  const along=key('z','w','arrowup')-key('s','arrowdown'),across=key('d')-key('q','a');
  const step=4*dt/Math.max(1,Math.hypot(along,across)),cy=Math.cos(visitor.yaw),sy=Math.sin(visitor.yaw);
  const x=visitor.x+step*(along*sy+across*cy),z=visitor.z+step*(along*cy-across*sy);
  if(insideParcel({x,z:visitor.z}))visitor.x=x;
  if(insideParcel({x:visitor.x,z}))visitor.z=z;
  renderVisit();walkFrame=requestAnimationFrame(walkTick);
}
walkDialog.addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();if(!['z','w','s','q','a','d','arrowleft','arrowright','arrowup','arrowdown'].includes(k))return;
  e.preventDefault();walkKeys.add(k);if(!walkFrame){walkTime=performance.now();walkFrame=requestAnimationFrame(walkTick);}
});
walkDialog.addEventListener('keyup',e=>walkKeys.delete(e.key.toLowerCase()));
window.addEventListener('blur',()=>{walkKeys.clear();walkDrag=null;});
window.addEventListener('resize',()=>{if(visitor)renderVisit();});
walkCanvas.addEventListener('pointerdown',e=>{walkDrag={id:e.pointerId,x:e.clientX,y:e.clientY};walkCanvas.setPointerCapture(e.pointerId);});
walkCanvas.addEventListener('pointermove',e=>{
  if(!visitor||walkDrag?.id!==e.pointerId)return;
  visitor.yaw+=(e.clientX-walkDrag.x)*.005;visitor.pitch=Math.max(-1,Math.min(1,visitor.pitch-(e.clientY-walkDrag.y)*.004));
  walkDrag.x=e.clientX;walkDrag.y=e.clientY;renderVisit();
});
walkCanvas.addEventListener('lostpointercapture',()=>{walkDrag=null;});
walkDialog.addEventListener('close',()=>{
  walkKeys.clear();cancelAnimationFrame(walkFrame);walkFrame=0;walkDrag=null;visitor=null;walkSurfaces=[];
  setMode('explore');if(visitReturnView)showView(visitReturnView);visitReturnView=null;
});
document.getElementById('visit-close').addEventListener('click',()=>walkDialog.close());
