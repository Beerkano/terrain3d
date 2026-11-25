/* Dependency-free orthographic scene renderer; world units are metres. */
(() => {
  const TAU = Math.PI * 2;
  const rad = n => n * Math.PI / 180;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function rgb(value) {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = value || 'CanvasText';
    c.fillRect(0, 0, 1, 1);
    return Array.from(c.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }
  const blend = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const rgba = (a, alpha = 1) => `rgba(${a.join(',')},${alpha})`;
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
  function hull(points) {
    const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (a, b, c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const lower = [], upper = [];
    for (const v of p) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), v) <= 0) lower.pop(); lower.push(v); }
    for (const v of p.slice().reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), v) <= 0) upper.pop(); upper.push(v); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  function inside(x, y, p) {
    let hit = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i].y > y) !== (p[j].y > y) && x < (p[j].x-p[i].x)*(y-p[i].y)/(p[j].y-p[i].y)+p[i].x) hit = !hit;
    }
    return hit;
  }

  // Coordinates are fractions of the editable building footprint. Rectangles
  // share exact edges so a doorway between two rooms cuts a single wall.
  const roomPlans = {
    studio: [[0,0,1,1]],
    annexe: [[0,0,.59,1], [.59,.49,1,1]],
    longere: [[0,0,.68,1], [.68,0,1,1]],
    atelier: [[0,.55,.63,1], [.63,.55,1,1], [.25,0,.63,.55]],
    patio: [[0,.65,1,1], [0,0,.29,.65], [.68,0,1,.65]],
    halles: [[0,0,.62,1], [.62,0,1,.65], [.62,.65,1,1]]
  };

  function buildWallPlan(rooms) {
    const edges = new Map();
    function edge(axis, fixed, start, end, room) {
      const key = axis + ':' + fixed;
      if (!edges.has(key)) edges.set(key, {axis, fixed, spans: []});
      edges.get(key).spans.push({start,end,room});
    }
    rooms.forEach(([left,front,right,back], number) => {
      edge('x', front, left, right, number);
      edge('x', back, left, right, number);
      edge('z', left, front, back, number);
      edge('z', right, front, back, number);
    });
    const walls = [];
    for (const {axis,fixed,spans} of edges.values()) {
      const cuts = [...new Set(spans.flatMap(span => [span.start,span.end]))].sort((a,b) => a-b);
      for (let i=1; i<cuts.length; i++) {
        const start=cuts[i-1], end=cuts[i];
        const owners=spans.filter(span => span.start<=start && span.end>=end);
        if (!owners.length) continue;
        walls.push({axis,fixed,start,end,interior:owners.length>1,door:owners.length>1});
      }
    }
    // Give the front-most room a visible entrance. In the U plan, use the
    // recessed gallery entrance so the open court leads into the building.
    const entry = walls.filter(wall => !wall.interior && wall.axis==='x' &&
      wall.fixed===(rooms===roomPlans.patio ? .65 : 0))
      .sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0];
    if (entry) entry.door=true;
    return walls;
  }
  const wallPlans = Object.fromEntries(Object.entries(roomPlans).map(([name,rooms])=>[name,buildWallPlan(rooms)]));
  function planName(item) {
    return Object.hasOwn(roomPlans,item.shape) ? item.shape : 'studio';
  }
  function freeCorners(item){
    return item.outline.map(([x,z])=>[(x/100-.5)*item.w,(z/100-.5)*item.d]);
  }
  function doorWalls(item){
    if(item.type==='building'&&item.outline){
      const corners=freeCorners(item);
      return corners.map((a,i)=>({a,b:corners[(i+1)%corners.length]}));
    }
    if(item.type==='building')return wallPlans[planName(item)];
    return ['wall','pallet'].includes(item.type)?[{door:false}]:[];
  }
  window.airsoftDoorWalls=doorWalls;
  function roomFootprints(item) {
    if(item.type==='building'&&item.outline)return [freeCorners(item)];
    const rooms=item.type==='building' ? roomPlans[planName(item)] : roomPlans.studio;
    return rooms.map(([x0,z0,x1,z1]) => [
      [(x0-.5)*item.w,(z0-.5)*item.d], [(x1-.5)*item.w,(z0-.5)*item.d],
      [(x1-.5)*item.w,(z1-.5)*item.d], [(x0-.5)*item.w,(z1-.5)*item.d]
    ]);
  }

  window.AirsoftRenderer = class AirsoftRenderer {
    constructor(canvas, callbacks = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.callbacks = callbacks;
      this.scene = {items: [], width: 100, depth: 160, safeDepth: 30, selectedId: null, theme: {}};
      this.view = {yaw: -35, pitch: 52, zoom: 1};
      this.hitAreas = [];
      this.listeners = [];
      this.frame = null;
      this.pointer = null;
      this.setPalette({});
      this.canvas.style.touchAction = 'none';
      this.canvas.style.cursor = 'grab';
      this.listen('pointerdown', e => this.down(e));
      this.listen('pointermove', e => this.move(e));
      this.listen('pointerup', e => this.up(e));
      this.listen('pointercancel', e => this.up(e));
      this.listen('wheel', e => {
        e.preventDefault();
        this.view.zoom = clamp(this.view.zoom * Math.exp(-e.deltaY * .001), .6, 7);
        this.schedule();
        clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(() => this.callbacks.onViewChange?.(this.getView()), 180);
      }, {passive: false});
      this.listen('contextmenu', e => e.preventDefault());
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
    }
    listen(type, fn, opts) { this.canvas.addEventListener(type, fn, opts); this.listeners.push([type, fn, opts]); }
    setPalette(theme) {
      const signature=JSON.stringify(['background','foreground','muted','border','series1','series2','series3','series4','series5','series6'].map(key=>theme[key]||''));
      if(this.paletteSignature===signature)return;
      this.paletteSignature=signature;
      const bg = rgb(theme.background || 'Canvas');
      const fg = rgb(theme.foreground || 'CanvasText');
      const muted = rgb(theme.muted || theme.foreground || 'GrayText');
      const border = rgb(theme.border || theme.muted || 'GrayText');
      const series = [1,2,3,4,5,6].map(n => rgb(theme['series'+n] || theme.foreground || 'CanvasText'));
      this.p = {
        bg, fg, muted, border, series,
        grass: blend(bg, series[1], .30),
        grassAlt: blend(bg, series[1], .23),
        soil: blend(blend(bg, series[3], .35), fg, .2),
        safe: blend(bg, series[2], .15),
        wood: blend(blend(bg, series[3], .47), fg, .11),
        tarp: blend(bg, series[1], .57),
        foliage: blend(series[1], fg, .17),
        trunk: blend(series[3], fg, .4),
        selection: series[0],
        shadow: fg
      };
    }
    setScene(scene) {
      this.scene = {...this.scene, ...scene};
      if (scene.theme) this.setPalette(scene.theme);
      this.schedule();
    }
    setView(view) {
      if (Number.isFinite(view.yaw)) this.view.yaw = view.yaw;
      if (Number.isFinite(view.pitch)) this.view.pitch = clamp(view.pitch, 20, 90);
      if (Number.isFinite(view.zoom)) this.view.zoom = clamp(view.zoom, .6, 7);
      if (Number.isFinite(view.centerX)) this.view.centerX = clamp(view.centerX,0,this.scene.width);
      if (Number.isFinite(view.centerZ)) this.view.centerZ = clamp(view.centerZ,0,this.scene.depth);
      this.schedule();
    }
    getView() { return {...this.view}; }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, r.width); this.height = Math.max(1, r.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      if (this.canvas.width !== Math.round(r.width*dpr) || this.canvas.height !== Math.round(r.height*dpr)) {
        this.canvas.width = Math.max(1, Math.round(r.width*dpr));
        this.canvas.height = Math.max(1, Math.round(r.height*dpr));
      }
      this.dpr = dpr;
      this.schedule();
    }
    schedule() { if (this.frame === null) this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); }); }
    camera() {
      this.c = Math.cos(rad(this.view.yaw)); this.s = Math.sin(rad(this.view.yaw));
      this.sp = Math.sin(rad(this.view.pitch)); this.cp = Math.cos(rad(this.view.pitch));
      const W = this.scene.width, D = this.scene.depth;
      const points = [[0,0],[W,0],[W,D],[0,D]].map(([x,z]) => this.raw(x, 0, z));
      const xs = points.map(p=>p.x), ys=points.map(p=>p.y);
      const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      const margin = this.width < 550 ? 22 : 29;
      this.scale = Math.max(.1, Math.min((this.width-margin*2)/(x1-x0), (this.height-margin*2-18)/(y1-y0))) * this.view.zoom;
      const target=this.raw(this.view.centerX??W/2,0,this.view.centerZ??D/2);
      this.cx = this.width/2 - target.x*this.scale;
      this.cy = this.height/2 + 8 - target.y*this.scale;
    }
    raw(x,y,z) {
      const dx=x-this.scene.width/2, dz=z-this.scene.depth/2;
      const u=dx*this.c+dz*this.s, v=-dx*this.s+dz*this.c;
      return {x:u,y:-v*this.sp-y*this.cp,depth:v*this.cp-y*this.sp};
    }
    project(x,y,z) { if (!this.scale) this.camera(); const p=this.raw(x,y,z); return {x:this.cx+p.x*this.scale,y:this.cy+p.y*this.scale}; }
    groundAt(x,y) {
      if (!this.scale) this.camera();
      const u=(x-this.cx)/this.scale, v=-(y-this.cy)/(this.scale*this.sp);
      return {x:this.scene.width/2+u*this.c-v*this.s,z:this.scene.depth/2+u*this.s+v*this.c};
    }
    path(points) {
      const c=this.ctx; c.beginPath(); points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y)); c.closePath();
    }
    polygon(points, fill, stroke, width=.65) {
      this.path(points); const c=this.ctx;
      if(fill) {c.fillStyle=fill; c.fill();}
      if(stroke) {c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
    }
    worldLine(a,b,color,width=1,dash=[]) {
      const c=this.ctx, p=this.project(...a), q=this.project(...b);
      c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.stroke();c.setLineDash([]);
    }
    local(item,x,y,z) {
      const angle=item.r||0;
      if(this.lastObjectAngle!==angle){
        this.lastObjectAngle=angle;
        this.objectCos=Math.cos(rad(angle));
        this.objectSin=Math.sin(rad(angle));
      }
      const c=this.objectCos,s=this.objectSin;
      return [item.x+x*c+z*s,y,item.z-x*s+z*c];
    }
    face(vertices,color,stroke,extra=0) {
      let sum=0;
      for(const [x,y,z] of vertices)sum+=(-(x-this.scene.width/2)*this.s+(z-this.scene.depth/2)*this.c)*this.cp-y*this.sp;
      this.faces.push({vertices,color,stroke,depth:sum/vertices.length+extra});
    }
    box(item,x,y,z,w,h,d,color,roof=true) {
      const p=(a,b,c)=>this.local(item,a,b,c);
      const x0=x-w/2,x1=x+w/2,z0=z-d/2,z1=z+d/2,y1=y+h;
      const P=this.p;
      const edge=rgba(blend(color,P.fg,.22),.65);
      this.face([p(x0,y,z0),p(x1,y,z0),p(x1,y1,z0),p(x0,y1,z0)],blend(color,P.fg,.11),edge);
      this.face([p(x1,y,z0),p(x1,y,z1),p(x1,y1,z1),p(x1,y1,z0)],blend(color,P.fg,.21),edge);
      this.face([p(x1,y,z1),p(x0,y,z1),p(x0,y1,z1),p(x1,y1,z1)],color,edge);
      this.face([p(x0,y,z1),p(x0,y,z0),p(x0,y1,z0),p(x0,y1,z1)],blend(color,P.bg,.12),edge);
      if(roof) this.face([p(x0,y1,z0),p(x1,y1,z0),p(x1,y1,z1),p(x0,y1,z1)],blend(color,P.bg,.19),edge);
    }
    addTree(item) {
      const h=item.h||6,w=item.w||4,d=item.d||w, P=this.p;
      this.box(item,0,0,0,.38,h*.6,.38,P.trunk);
      const count=7, rings=[];
      for (const [yy,rr] of [[h*.36,.40],[h*.68,.50],[h,.06]]) {
        rings.push(Array.from({length:count},(_,i)=>this.local(item,Math.cos(i/count*TAU)*w*rr,yy,Math.sin(i/count*TAU)*d*rr)));
      }
      for(let k=0;k<2;k++) for(let i=0;i<count;i++) {
        const j=(i+1)%count;
        this.face([rings[k][i],rings[k][j],rings[k+1][j],rings[k+1][i]],blend(P.foliage,i%2?P.bg:P.fg,i%2?.10:.08),null);
      }
      this.face(rings[2],blend(P.foliage,P.bg,.16),null);
    }
    addBuilding(item) {
      if(item.outline){
        for(const [index,{a,b}] of doorWalls(item).entries()){
          const [x,,z]=this.local(item,(a[0]+b[0])/2,0,(a[1]+b[1])/2);
          const dx=b[0]-a[0],dz=b[1]-a[1];
          const segment={...item,x,z,type:'wall',w:Math.hypot(dx,dz),d:Math.min(.22,item.w*.065,item.d*.065),
            r:item.r-Math.atan2(dz,dx)*180/Math.PI,doors:item.doors?.includes(index)?[0]:[],apertures:{0:item.apertures?.[index]}};
          this.addObject(segment);
        }
        return;
      }
      const thickness = Math.min(.22, item.w*.065, item.d*.065);
      const insetX = item.w-thickness, insetZ = item.d-thickness;
      for (const [index,wall] of wallPlans[planName(item)].entries()) {
        const across=wall.axis==='x';
        const span=across ? insetX : insetZ;
        const start=(wall.start-.5)*span, end=(wall.end-.5)*span;
        const fixed=(wall.fixed-.5)*(across ? insetZ : insetX);
        const color=wall.interior ? blend(this.p.wood,this.p.bg,.17) : this.p.wood;
        const width=end-start;
        const hasDoor=item.doors?.includes(index);
        const entry=item.apertures?.[index];
        const opening=wall.door||hasDoor ? Math.min(entry?.width||1.55,width*(entry ? .96 : .53)) : 0;
        const mid=start+clamp((entry?.at??.5)*width,opening/2,width-opening/2);
        const segments=opening ? [[start,mid-opening/2],[mid+opening/2,end]] : [[start,end]];
        if(hasDoor&&item.h>2){
          this.box(item,across?mid:fixed,2,across?fixed:mid,across?opening:thickness,item.h-2,across?thickness:opening,color);
        }
        for (const [a,b] of segments) {
          const center=(a+b)/2, length=b-a+thickness*.35;
          const x=across ? center : fixed, z=across ? fixed : center;
          const w=across ? length : thickness, d=across ? thickness : length;
          this.box(item,x,0,z,w,item.h,d,color);
          // At close zoom, shallow horizontal boards give each wall its grain.
          if (this.scale>6) {
            const trim=blend(color,this.p.fg,.19);
            const boardCourses=Math.min(8,Math.floor(item.h/.52));
            for (let row=1; row<=boardCourses; row++) {
              this.box(item,x,item.h*row/(boardCourses+1),z,w+.012,.025,d+.012,trim);
            }
          }
        }
      }
    }
    footprints(item) {return roomFootprints(item);}
    drawRoomFloors(item) {
      roomFootprints(item).forEach((corners,index) => {
        const floor=blend(this.p.wood,this.p.bg,.56+(index%2)*.10);
        this.polygon(corners.map(([x,z])=>this.project(...this.local(item,x,.02,z))),rgba(floor));
        if(item.outline)return;
        const [left,front]=corners[0], [right,back]=corners[2];
        const spacing=this.scale>6 ? .5 : 1.25;
        const plankDirection=index%2===0;
        const low=plankDirection ? front : left, high=plankDirection ? back : right;
        for(let seam=low+spacing;seam<high-.1;seam+=spacing) {
          const a=plankDirection ? [left,.025,seam] : [seam,.025,front];
          const b=plankDirection ? [right,.025,seam] : [seam,.025,back];
          this.worldLine(this.local(item,...a),this.local(item,...b),rgba(this.p.fg,.12),.48);
        }
      });
    }
    addObject(item,index) {
      const w=item.w||3,d=item.d||3,h=item.h||2.3,P=this.p;
      if(item.type==='zone'||item.type==='parking')return;
      if(['round','triangle','custom'].includes(item.type)){
        const outline=item.outline||window.desktopDesign?.defaultOutline;
        const count=item.type==='custom'?outline.length:item.type==='round'?32:3;
        const corners=item.type==='custom'?outline.map(([x,z])=>[(x/100-.5)*w,(z/100-.5)*d]):Array.from({length:count},(_,i)=>{
          const angle=i*TAU/count;
          return item.type==='round'?[Math.cos(angle)*w/2,Math.sin(angle)*d/2]:[[-w/2,-d/2],[w/2,-d/2],[0,d/2]][i];
        });
        const top=corners.map(([x,z])=>this.local(item,x,h,z));
        for(let i=0;i<count;i++){
          const j=(i+1)%count;
          this.face([this.local(item,corners[i][0],0,corners[i][1]),this.local(item,corners[j][0],0,corners[j][1]),top[j],top[i]],blend(P.wood,P.fg,.08+.15*(1+Math.sin(i*TAU/count))),null);
        }
        this.face(top,blend(P.wood,P.bg,.12),rgba(P.fg,.3));return;
      }
      if(item.type==='tree') { this.addTree(item); return; }
      if(item.type==='container') {
        const color=blend(P.series[0],P.bg,.24);
        this.box(item,0,0,0,w,h,d,color,false);
        // Split the roof into bands so every rib belongs to its own roof panel.
        const ribs=Math.ceil(w/.7);
        for(let i=0;i<ribs;i++){
          const left=w*(i/ribs-.5), right=w*((i+1)/ribs-.5);
          const band=[[left,h,-d/2],[right,h,-d/2],[right,h,d/2],[left,h,d/2]];
          this.face(band.map(v=>this.local(item,...v)),blend(color,P.bg,i%2?.21:.17),rgba(blend(color,P.fg,.18),.65));
        }
        // Corrugated ribs are shallow strips sharing the container face colours.
        const count=Math.max(5,Math.floor(w/.55));
        for(let i=1;i<count;i++) {
          const x=-w/2+i*w/count;
          this.box(item,x,.10,-d/2-.022,.045,h-.2,.045,blend(color,P.fg,.15));
          this.box(item,x,.10,d/2+.022,.045,h-.2,.045,blend(color,P.bg,.1));
        }
        this.box(item,-w/2-.022,.12,0,.05,h-.24,.055,blend(color,P.fg,.2));
      } else if(item.type==='building') {
        this.addBuilding(item);
      } else if(['wall','pallet'].includes(item.type)&&item.doors?.includes(0)){
        const entry=item.apertures?.[0],gap=Math.min(entry?.width||1.55,w*(entry ? .96 : .53));
        const mid=clamp((entry?.at??.5)*w,gap/2,w-gap/2)-w/2;
        for(const [a,b] of [[-w/2,mid-gap/2],[mid+gap/2,w/2]]){
          const x=(a+b)/2,panel=b-a;if(panel<=0)continue;
          if(item.type==='wall')this.box(item,x,0,0,panel,h,d,P.wood);
          else{
            this.box(item,x,0,0,Math.min(.13,panel),h,d,P.wood);
            for(let y=.12;y<h;y+=.27)this.box(item,x,y,0,panel,.18,d*.7,P.wood);
          }
        }
        if(h>2)this.box(item,mid,2,0,gap,h-2,d,P.wood);
      } else if(item.type==='pallet') {
        const post=.13;
        this.box(item,-w/2+.1,0,0,post,h,Math.max(.15,d),P.wood);
        this.box(item,w/2-.1,0,0,post,h,Math.max(.15,d),P.wood);
        for(let y=.12;y<h;y+=.27) this.box(item,0,y,0,w,.18,Math.max(.12,d*.7),P.wood);
      } else if(item.type==='tarp') {
        if(item.landmark==='cour') {
          const corners=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
          const tone=blend(P.series[2],P.bg,.29);
          const halfHeight=h*.82;
          for(let i=0;i<4;i++){
            const [x,z]=corners[i], [nx,nz]=corners[(i+1)%4];
            const anchor=this.local(item,x,h,z);
            const next=this.local(item,nx,h,nz);
            const mid=this.local(item,(x+nx)/2,halfHeight,(z+nz)/2);
            const crown=this.local(item,0,h*1.0,0);
            this.box(item,x,0,z,.13,h,.13,P.wood);
            this.face([anchor,mid,crown],blend(tone,P.bg,.07+i*.035),rgba(tone,.75));
            this.face([mid,next,crown],blend(tone,P.fg,.02+i*.025),rgba(tone,.75));
          }
          return;
        }
        for(const x of [-w/2,w/2]) for(const z of [-d/2,d/2]) this.box(item,x,0,z,.12,h,.12,P.wood);
        const p=(x,y,z)=>this.local(item,x,y,z);
        this.face([p(-w/2,h,-d/2),p(0,h-.22,-d/2),p(0,h-.22,d/2),p(-w/2,h,d/2)],P.tarp,rgba(P.fg,.32));
        this.face([p(0,h-.22,-d/2),p(w/2,h,-d/2),p(w/2,h,d/2),p(0,h-.22,d/2)],blend(P.tarp,P.bg,.13),rgba(P.fg,.32));
      } else if(item.type==='gate') {
        for(const x of [-w/2,w/2]) this.box(item,x,0,0,.28,h,.28,P.wood);
        this.box(item,0,h-.23,0,w,.23,.22,P.wood);
        this.box(item,0,h*.43,0,w*.94,.14,.13,P.wood);
      } else if(item.type==='table') {
        this.box(item,0,h-.15,0,w,.15,d,P.wood);
        for(const x of [-w*.39,w*.39]) for(const z of [-d*.32,d*.32]) this.box(item,x,0,z,.1,h-.15,.1,P.wood);
      } else this.box(item,0,0,0,w,h,d,P.wood);
    }
    shadow(item) {
      const h=item.h||2.3;
      for (const corners of roomFootprints(item)) {
        const outline=corners.map(([x,z])=>{
          const v=this.local(item,x,0,z);
          return this.project(v[0]+h*.3,.015,v[2]+h*.18);
        });
        this.polygon(outline,rgba(this.p.shadow,item.type==='tree'?.11:.10));
      }
    }
    label(text,x,z,options={}) {
      const c=this.ctx,p=this.project(x,options.y||.03,z);
      const size=options.size||12;
      c.font=`500 ${size}px system-ui, sans-serif`;
      c.textAlign=options.align||'center';c.textBaseline='middle';
      const width=c.measureText(text).width;
      if(options.badge) {
        c.fillStyle=rgba(this.p.bg,.91);
        c.beginPath();c.roundRect(p.x-width/2-9,p.y-size/2-6,width+18,size+12,6);c.fill();
        c.strokeStyle=rgba(this.p.border,.35);c.lineWidth=.7;c.stroke();
      }
      c.fillStyle=rgba(options.muted?blend(this.p.fg,this.p.bg,.30):this.p.fg,options.alpha??.85);
      c.fillText(text,p.x,p.y);
    }
    render() {
      if(this.destroyed) return;
      const c=this.ctx,P=this.p,W=this.scene.width,D=this.scene.depth,S=this.scene.safeDepth;
      this.camera();
      c.setTransform(this.dpr,0,0,this.dpr,0,0);
      c.clearRect(0,0,this.width,this.height);
      c.fillStyle=rgba(P.bg);c.fillRect(0,0,this.width,this.height);
      // A slight terrain slab gives the map a model-like presentation.
      const ground=this.scene.boundary?this.scene.boundary.map(([x,z])=>[x*W/100,0,z*D/100]):[[0,0,0],[W,0,0],[W,0,D],[0,0,D]];
      const lower=ground.map(([x,y,z])=>this.project(x,-.95,z));
      const upper=ground.map(v=>this.project(...v));
      this.polygon(lower,rgba(P.soil),rgba(P.border,.25));
      for(let i=0;i<ground.length;i++){const j=(i+1)%ground.length;this.polygon([lower[i],lower[j],upper[j],upper[i]],rgba(P.soil));}
      this.polygon(upper,this.scene.editableGround?this.scene.ground:rgba(P.grass),rgba(P.border,.4));
      c.save();this.path(upper);c.clip();this.callbacks.drawPhoto?.();
      if(!this.scene.editableGround)this.polygon([[0,0,0],[W,0,0],[W,0,S],[0,0,S]].map(v=>this.project(...v)),rgba(P.safe));
      // Thin out grid lines at overview scale while preserving the chosen snap step.
      let grid=this.snapStep??10;
      if(grid>0){
        while(grid*this.scale*this.sp<9)grid*=2;
        for(let x=grid;x<W;x+=grid)this.worldLine([x,.015,0],[x,.015,D],rgba(P.fg,.13),.7);
        for(let z=grid;z<D;z+=grid)this.worldLine([0,.015,z],[W,.015,z],rgba(P.fg,.13),.7);
      }
      // Parking is a fixed ground marking, independent of editable objects.
      if(!this.scene.editableGround){
      const parking=blend(P.safe,P.bg,.3);
      this.polygon([[5,.02,5],[48,.02,5],[48,.02,25],[5,.02,25]].map(v=>this.project(...v)),rgba(parking));
      for(let x=6;x<47;x+=3.1) {
        this.worldLine([x,.025,6],[x,.025,11.4],rgba(P.fg,.25),.8);
        this.worldLine([x,.025,19],[x,.025,24.4],rgba(P.fg,.25),.8);
      }
      this.worldLine([6,.025,11.4],[46.3,.025,11.4],rgba(P.fg,.25),.8);
      this.worldLine([6,.025,19],[46.3,.025,19],rgba(P.fg,.25),.8);
      // The safe zone boundary and perimeter are intentionally understated.
      this.worldLine([0,.08,S],[W,.08,S],rgba(P.series[0],.55),1.3,[5,4]);
      }else{
        for(const kind of ['zone','parking'])for(const item of this.scene.items.filter(it=>it.type===kind)){
          const point=(x,z)=>this.local(item,x*item.w,0,z*item.d);
          this.polygon([point(-.5,-.5),point(.5,-.5),point(.5,.5),point(-.5,.5)].map(v=>this.project(...v)),item.color||rgba(P.safe),rgba(P.fg,.35));
          if(kind==='parking')for(let x=-.48;x<.5;x+=3/item.w){
            for(const sign of [-1,1])this.worldLine(point(x,.46*sign),point(x,.2*sign),rgba(P.fg,.45),1);
          }
        }
      }
      c.restore();this.faces=[]; this.hitAreas=[];
      const items=this.scene.items||[];
      for(const item of items) if(!['parking','zone'].includes(item.type))this.shadow(item);
      for(const item of items){
        if(item.color){
          const col=[1,3,5].map(i=>parseInt(item.color.slice(i,i+2),16));
          this.p={...P,wood:col,foliage:col,tarp:col,series:[col,col,col,...P.series.slice(3)]};
        }
        if(item.type==='building')this.drawRoomFloors(item);
        this.addObject(item);
        this.p=P;
      }
      this.faces.sort((a,b)=>b.depth-a.depth);
      for(const face of this.faces) this.polygon(face.vertices.map(v=>this.project(...v)),rgba(face.color),face.stroke,.55);
      for(const item of items) {
        const w=item.w||3,d=item.d||3,h=item.h||2.3;
        for(const corners of roomFootprints(item)) {
          if(item.type==='building'&&item.outline){
            const base=corners.map(([x,z])=>this.project(...this.local(item,x,0,z)));
            this.hitAreas.push({id:item.id,polygon:base,depth:this.raw(item.x,0,item.z).depth});
            corners.forEach(([x,z],i)=>{
              const [ex,ez]=corners[(i+1)%corners.length];
              this.hitAreas.push({id:item.id,polygon:[base[i],base[(i+1)%base.length],this.project(...this.local(item,ex,h,ez)),this.project(...this.local(item,x,h,z))],depth:this.raw(...this.local(item,(x+ex)/2,h/2,(z+ez)/2)).depth});
            });
            continue;
          }
          const points=corners.flatMap(([x,z])=>[0,h].map(y=>this.project(...this.local(item,x,y,z))));
          const center=this.local(item,(corners[0][0]+corners[2][0])/2,h/2,(corners[0][1]+corners[2][1])/2);
          const layer=item.type==='zone'?2:item.type==='parking'?1:0;
          this.hitAreas.push({id:item.id,polygon:hull(points),depth:this.raw(...center).depth+10000*layer});
        }
        if(item.id===this.scene.selectedId || this.scene.selectedId && this.scene.extraSelection?.has(item.id)) {
          if(item.type==='building') {
            if(item.outline){
              for(const {a,b} of doorWalls(item))this.worldLine(this.local(item,a[0],.04,a[1]),this.local(item,b[0],.04,b[1]),rgba(P.selection,.95),2);
              continue;
            }
            for(const wall of wallPlans[planName(item)].filter(wall=>!wall.interior)) {
              const wallPoint=t=>wall.axis==='x' ?
                this.local(item,(t-.5)*w,.04,(wall.fixed-.5)*d) :
                this.local(item,(wall.fixed-.5)*w,.04,(t-.5)*d);
              this.worldLine(wallPoint(wall.start),wallPoint(wall.end),rgba(P.selection,.95),2);
            }
            continue;
          }
          const outline=[[-w/2-.4,-d/2-.4],[w/2+.4,-d/2-.4],[w/2+.4,d/2+.4],[-w/2-.4,d/2+.4]].map(([x,z])=>this.project(...this.local(item,x,.04,z)));
          this.polygon(outline,rgba(P.selection,.10),rgba(P.selection,.95),2);
          for(const point of outline) {c.beginPath();c.arc(point.x,point.y,3.2,0,TAU);c.fillStyle=rgba(P.selection);c.fill();c.strokeStyle=rgba(P.bg);c.lineWidth=1.2;c.stroke();}
        }
      }
      this.hitAreas.sort((a,b)=>a.depth-b.depth);
      // Only high-level annotations: the geometry remains the focus.
      if(this.width>420 && this.view.zoom<1.5) {
        const zone=items.find(it=>it.type==='zone');
        if(zone)this.label(zone.name,zone.x,zone.z,{badge:true,size:11});
        else if(!this.scene.editableGround)this.label('Zone safe',W*.50,S-4,{badge:true,size:11});
        const captions={atelier:'Atelier',marche:'Marché',cour:'Cour'};
        for(const item of items.filter(object=>!this.scene.editableGround&&captions[object.landmark])) {
          const point=this.project(item.x,item.h,item.z);
          const direction=item.landmark==='marche'?-1:1;
          const polarity=item.landmark==='atelier'?-1:1;
          const x=point.x+polarity*(item.landmark==='cour'?46:37), y=point.y+direction*30;
          c.beginPath();c.moveTo(point.x,point.y);c.lineTo(x,y);
          c.strokeStyle=rgba(P.fg,.42);c.lineWidth=.8;c.stroke();
          const world=this.groundAt(x,y);
          this.label(captions[item.landmark],world.x,world.z,{badge:true,size:11});
        }
      }
      const named=new Map();
      for(const item of items){
        if(!item.group||!item.groupName)continue;
        const group=named.get(item.group)||{name:item.groupName,x:0,z:0,h:0,n:0};
        group.x+=item.x;group.z+=item.z;group.h=Math.max(group.h,item.h);group.n++;named.set(item.group,group);
      }
      for(const group of named.values())this.label(group.name,group.x/group.n,group.z/group.n,{y:group.h+.8,badge:true,size:12});
      const a=this.project(0,0,-5),b=this.project(W,0,-5),m={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      if(this.width>520) {
        c.font='500 11px system-ui, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle=rgba(blend(P.fg,P.bg,.30),.85);c.fillText(`${W} m`,m.x,m.y+10);
        const q=this.project(W+5,0,D/2);c.fillText(`${D} m`,q.x+10,q.y);
      }
      if(this.width>420 && this.height>300) {
        const length=20*this.scale, x=24, y=this.height-25;
        if(length < this.width*.35) {
          c.strokeStyle=rgba(P.fg,.65);c.lineWidth=1.4;c.beginPath();c.moveTo(x,y-4);c.lineTo(x,y);c.lineTo(x+length,y);c.lineTo(x+length,y-4);c.stroke();
          c.font='500 11px system-ui, sans-serif';c.textAlign='left';c.fillStyle=rgba(blend(P.fg,P.bg,.30));c.fillText('20 m',x,y-13);
        }
      }
      if(!this.measuring)this.drawRotationHandle();
      if(this.measuring&&this.measurePoints?.length){
        const points=this.measurePoints;
        if(points.length===2){
          const [a,b]=points;
          this.worldLine([a.x,.1,a.z],[b.x,.1,b.z],rgba(P.fg),2,[6,3]);
          this.label(this.distanceText(),(a.x+b.x)/2,(a.z+b.z)/2,{badge:true,size:13});
        }
        for(const pt of points){
          const pos=this.project(pt.x,.1,pt.z);
          c.beginPath();c.arc(pos.x,pos.y,4,0,TAU);c.fillStyle=rgba(P.fg);c.fill();
        }
      }
      this.callbacks.drawOverlay?.();
    }
    distanceText(){
      const [a,b]=this.measurePoints;
      return Math.hypot(b.x-a.x,b.z-a.z).toLocaleString('fr-FR',{maximumFractionDigits:2})+' m';
    }
    rotationHandleGeometry() {
      const item=this.scene.items.find(candidate=>candidate.id===this.scene.selectedId);
      if(!item || !this.scale || this.scene.protectedSelection || this.multi || this.mode && !['move','turn'].includes(this.mode)) return null;
      const offset=25/(this.scale*Math.max(.3,this.sp));
      const sides=[[1,0],[-1,0],[0,1],[0,-1]];
      const options=this.pointer?.rotating ? [this.pointer.handleSide] : sides;
      let best=null;
      for(const side of options) {
        const edgeX=side[0]*item.w/2, edgeZ=side[1]*item.d/2;
        const edge=this.project(...this.local(item,edgeX,0,edgeZ));
        const handle=this.project(...this.local(item,edgeX+side[0]*offset,0,edgeZ+side[1]*offset));
        const clearance=Math.min(handle.x,handle.y,this.width-handle.x,this.height-handle.y);
        const candidate={...handle,edge,side,clearance,id:item.id};
        if(clearance>=19) return candidate;
        if(!best || clearance>best.clearance) best=candidate;
      }
      return best;
    }
    getRotationHandle() {
      const handle=this.rotationHandleGeometry();
      return handle ? {x:handle.x,y:handle.y} : null;
    }
    drawRotationHandle() {
      const handle=this.rotationHandleGeometry();
      if(!handle) return;
      const {x,y,edge}=handle, c=this.ctx, p=this.p;
      c.save();
      if(this.mode==='turn'){
        const item=this.scene.items.find(it=>it.id===handle.id);
        const center=this.project(item.x,0,item.z);
        const radius=Math.hypot(x-center.x,y-center.y);
        c.beginPath();c.arc(center.x,center.y,radius,0,TAU);c.strokeStyle=rgba(p.selection,.6);c.lineWidth=1.3;c.stroke();
        c.font='500 14px Segoe UI, sans-serif';c.textAlign='center';c.fillStyle=rgba(p.fg);c.fillText(Math.round(item.r)+'°',x,y-19);
      }
      c.strokeStyle=rgba(p.selection);
      c.lineWidth=2;
      c.beginPath();
      c.moveTo(edge.x,edge.y);
      c.lineTo(x,y);
      c.stroke();
      c.fillStyle=rgba(p.bg);
      c.beginPath();
      c.arc(x,y,14,0,TAU);
      c.fill();
      c.stroke();
      c.strokeStyle=rgba(p.fg);
      c.lineCap='round';
      c.lineJoin='round';
      c.beginPath();
      c.arc(x,y,6,Math.PI*.15,Math.PI*1.9);
      c.stroke();
      c.beginPath();
      c.moveTo(x+5.6,y-6.8);
      c.lineTo(x+6.1,y-.9);
      c.lineTo(x+.8,y-3.2);
      c.stroke();
      c.restore();
    }
    rotationHit(point) {
      const handle=this.rotationHandleGeometry();
      if(!handle)return null;
      if(Math.hypot(point.x-handle.x,point.y-handle.y)<=20)return handle;
      if(this.mode==='turn'){
        const item=this.scene.items.find(i=>i.id===handle.id);
        const center=this.project(item.x,0,item.z);
        if(Math.abs(Math.hypot(point.x-center.x,point.y-center.y)-Math.hypot(handle.x-center.x,handle.y-center.y))<7)return handle;
      }
      return null;
    }
    point(e) {const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
    hit(point) {
      for(const area of this.hitAreas) {
        // An additional small screen tolerance makes thin panels selectable.
        if(inside(point.x,point.y,area.polygon)) return area.id;
        const minX=Math.min(...area.polygon.map(p=>p.x)),maxX=Math.max(...area.polygon.map(p=>p.x));
        const minY=Math.min(...area.polygon.map(p=>p.y)),maxY=Math.max(...area.polygon.map(p=>p.y));
        if(maxX-minX<7 && point.x>=minX-3&&point.x<=maxX+3&&point.y>=minY-2&&point.y<=maxY+2) return area.id;
      }
      return null;
    }
    down(e) {
      if(this.pointer) return;
      e.preventDefault();
      const point=this.point(e);
      if(e.button===0&&this.callbacks.drawingDown?.(point,e))return;
      if(this.measuring && e.button===0){
        const p=this.groundAt(point.x,point.y);
        if(p.x<0||p.z<0||p.x>this.scene.width||p.z>this.scene.depth)return;
        if(this.measurePoints.length===2)this.measurePoints=[];
        this.measurePoints.push(p);this.callbacks.onMeasure?.();this.schedule();return;
      }
      const handle=e.button===2 ? null : this.rotationHit(point);
      if(handle) {
        const item=this.scene.items.find(candidate=>candidate.id===handle.id);
        const start=this.groundAt(point.x,point.y);
        this.pointer={pointerId:e.pointerId,id:item.id,start:point,moved:false,rotating:true,
          handleSide:handle.side,center:{x:item.x,z:item.z},initialAngle:item.r,
          initialBearing:Math.atan2(item.z-start.z,start.x-item.x),lastAngle:item.r};
        this.canvas.setPointerCapture(e.pointerId);
        this.canvas.style.cursor='grabbing';
        return;
      }
      const id=this.hit(point), item=this.scene.items.find(i=>i.id===id);
      const orbit=e.button===2||e.shiftKey||!item||this.mode==='explore'||this.mode==='turn'||this.multi||item.locked;
      const ground=this.groundAt(point.x,point.y);
      this.pointer={pointerId:e.pointerId,start:point,last:point,id,item:item?{...item}:null,orbit,view:this.getView(),ground,moved:false};
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor=orbit?'grabbing':'move';
      if(!orbit) this.callbacks.onSelect?.(id);
    }
    move(e) {
      const point=this.point(e), p=this.pointer;
      if(this.callbacks.drawingMove?.(point,e))return;
      if(!p) {this.canvas.style.cursor=this.rotationHit(point)?'grab':this.hit(point)?'move':'grab';return;}
      if(e.pointerId!==p.pointerId) return;
      const dx=point.x-p.start.x,dy=point.y-p.start.y;
      if(Math.hypot(dx,dy)>3) p.moved=true;
      if(!p.moved) return;
      if(p.rotating) {
        const current=this.groundAt(point.x,point.y);
        const centerScreen=this.project(p.center.x,0,p.center.z);
        if(Math.hypot(point.x-centerScreen.x,point.y-centerScreen.y)<5) return;
        // Local +X turns toward world -Z as the object's angle increases.
        const bearing=Math.atan2(p.center.z-current.z,current.x-p.center.x);
        const degrees=p.initialAngle+(bearing-p.initialBearing)*180/Math.PI;
        const step=e.shiftKey?15:1;
        const angle=((Math.round(degrees/step)*step)%360+360)%360;
        if(angle!==p.lastAngle) {
          p.lastAngle=angle;
          this.callbacks.onRotate?.(p.id,angle);
        }
      } else if(p.orbit) {
        this.view.yaw=p.view.yaw+dx*.32;
        this.view.pitch=clamp(p.view.pitch-dy*.25,20,90);
        this.schedule();
      } else {
        const g=this.groundAt(point.x,point.y), item=p.item;
        const angle=rad(item.r||0),w=item.w||3,d=item.d||3;
        const ex=(Math.abs(Math.cos(angle))*w+Math.abs(Math.sin(angle))*d)/2;
        const ez=(Math.abs(Math.sin(angle))*w+Math.abs(Math.cos(angle))*d)/2;
        const step=this.snapStep??.5;
        const snap=v=>step?Math.round(v/step)*step:v;
        const x=clamp(snap(item.x+g.x-p.ground.x),ex,this.scene.width-ex);
        const z=clamp(snap(item.z+g.z-p.ground.z),ez,this.scene.depth-ez);
        const target=!e.altKey&&this.callbacks.magnet?.(item,x,z);
        this.callbacks.onDrag?.(p.id,target?target.x:x,target?target.z:z);
      }
      p.last=point;
    }
    up(e) {
      if(this.callbacks.drawingUp?.(e))return;
      const p=this.pointer;if(!p||e.pointerId!==p.pointerId)return;
      this.pointer=null;
      try {this.canvas.releasePointerCapture(e.pointerId);} catch(_) {}
      this.canvas.style.cursor='grab';
      if(p.orbit) {
        if(p.moved)this.callbacks.onViewChange?.(this.getView());
        else if(e.button!==2)this.callbacks.onSelect?.(p.id||null);
      } else if(p.moved) this.callbacks.onCommit?.(p.id);
    }
    destroy() {
      this.destroyed=true;
      if(this.frame!==null)cancelAnimationFrame(this.frame);
      clearTimeout(this.wheelTimer);
      this.resizeObserver.disconnect();
      for(const [type,fn,opts] of this.listeners)this.canvas.removeEventListener(type,fn,opts);
      this.listeners=[];
    }
  };
})();
