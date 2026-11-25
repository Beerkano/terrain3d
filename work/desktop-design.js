(() => {
  const patches={
    o4:{x:42,z:102},o10:{x:83,z:106},o13:{x:87,z:152,r:309,w:4.2},
    o20:{x:83,z:87.5,r:123},o24:{x:81,z:147.5,r:356,w:4.3},o26:{x:59,z:72},
    o39:{x:86.5,z:138},'etal-lin':{x:77,z:154},'etal-toile':{x:26,z:33}
  };
  const additions=[
    ['omwv6gs6v4322','container','Conteneur 5',40.5,94.5,6,2.5,2.6,0],
    ['omwv6hegrumuo','tarp','Abri en bâche 6',83,103.5,6,5,2.8,12],
    ['omwv6i076qdqx','tree','Arbre 9',28.5,72,5,5,7,0],
    ['omwv6i2qmhia3','tree','Arbre 10',67.5,66.5,5,5,7,0],
    ['omwv6i4gxkfnv','tree','Arbre 11',63.5,80,5,5,7,0],
    ['omwv6idb89cdw','building','Bâtiment en palettes 9',53.5,56,6,5,2.2,74],
    ['omwv6inhwm58t','building','Bâtiment en palettes 10',15.5,51,6,5,2.2,10],
    ['omwv6j4tk6sv5','pallet','Obstacle en palettes 17',26,39,6,.7,1.8,0],
    ['omwv6jn3tdhf8','pallet','Obstacle en palettes 18',32.5,42,3.6,.7,1.8,329],
    ['omwv6k92me06x','pallet','Obstacle en palettes 19',20.5,36,3.6,.7,1.8,312],
    ['omwv6khu63bu6','pallet','Obstacle en palettes 20',37.5,37,6,.7,1.8,47],
    ['omwv6l4z3s5gx','pallet','Obstacle en palettes 21',74.5,146,5,.7,1.8,0],
    ['omwv6ls31a990','pallet','Obstacle en palettes 22',64.5,155,3.6,.7,1.8,59],
    ['omwv6o60akvo9','building','Bâtiment en palettes 11',4.61,68,7,6,4,274]
  ];
  const zones=()=>[
    {id:'zone-safe',type:'zone',name:'Zone safe',x:50,z:15,w:100,d:30,h:.3,r:0,color:'#e7d8b5'},
    {id:'parking',type:'parking',name:'Parking',x:26.5,z:15,w:43,d:20,h:.3,r:0,color:'#c9c7bc'}
  ];
  function outline(raw){
    if(!Array.isArray(raw)||raw.length<3||raw.length>40)throw Error('Utilise de 3 à 40 sommets.');
    const points=raw.map(p=>{
      if(!Array.isArray(p)||p.length!==2||!p.every(n=>Number.isFinite(n)&&n>=0&&n<=100))throw Error('Chaque sommet doit contenir deux nombres entre 0 et 100.');
      return [...p];
    });
    const orientation=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const spans=(a,b,c,d)=>Math.max(Math.min(a,b),Math.min(c,d))<=Math.min(Math.max(a,b),Math.max(c,d));
    let area=0;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      if(a[0]===b[0]&&a[1]===b[1])throw Error('Deux sommets successifs sont identiques.');
      area+=a[0]*b[1]-a[1]*b[0];
      for(let j=i+2;j<points.length;j++){
        if(i===0&&j===points.length-1)continue;
        const c=points[j],d=points[(j+1)%points.length];
        if(spans(a[0],b[0],c[0],d[0])&&spans(a[1],b[1],c[1],d[1])&&orientation(a,b,c)*orientation(a,b,d)<=0&&orientation(c,d,a)*orientation(c,d,b)<=0)throw Error('Le contour se croise. Ordonne les sommets autour de la forme.');
      }
    }
    if(Math.abs(area)<1)throw Error('Le contour doit entourer une surface.');
    return points;
  }
  window.desktopDesign={zones,outline,defaultOutline:[[0,0],[100,0],[100,45],[55,45],[55,100],[0,100]],seed(items){
    for(const item of items)Object.assign(item,patches[item.id]||{});
    return items.concat(additions.map(([id,type,name,x,z,w,d,h,r])=>({id,type,name,x,z,w,d,h,r})),zones());
  }};
})();
