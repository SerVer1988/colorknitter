// Генератор ColorKnitter: подготовка фото, кисти, расчёт в фоновом потоке, превью,
// выгрузка схемы. Сам алгоритм — в js/stringart-core.js.

const PADDING = 5, NAIL_RADIUS = 1, NAIL_COLOR = '#000';
const GRID_BW = 400, GRID_COLOR = 300;   // размер рабочей сетки
const ALGO = {
  minGap: 15,        // минимальный пропуск между гвоздями (для 260 гвоздей; масштабируется)
  negWeight: 0.7,    // насколько «прощать» нити, которые немного затемняют светлое
  gamma: 1.5,        // средние тона темнее — нитей в них больше
  sharpen: 1.0,      // лёгкое повышение резкости
  importance: 2,     // «Главное» важнее остального в 1+2 = 3 раза
  stopFrac: 0.01     // стоп, когда линия даёт меньше 1 % пользы первой
};
const SECONDS_PER_STEP = 4.5;            // темп вязалки на скорости 1x
const SETTINGS_KEY = 'ck_gen_settings';

const COLORS=[
  {id:'Y',name:'Жёлтый', short:'Жёл.',rgb:[255,220,  0],hex:'#ffdc00',textHex:'#b8870a'},
  {id:'C',name:'Голубой',short:'Гол.',rgb:[  0,183,235],hex:'#00b7eb',textHex:'#0077aa'},
  {id:'M',name:'Розовый',short:'Роз.',rgb:[255,  0,144],hex:'#ff0090',textHex:'#cc0070'},
  {id:'K',name:'Чёрный', short:'Чёр.',rgb:[  0,  0,  0],hex:'#000000',textHex:'#888888'},
  {id:'W',name:'Белый',  short:'Бел.',rgb:[255,255,255],hex:'#ffffff',textHex:'#999999'},
];
const K_INDEX = 3, W_INDEX = 4;
const BOARDS={
  white:{name:'белая', rgb:[255,255,255]},
  grey: {name:'серая', rgb:[140,140,140]},
  black:{name:'чёрная',rgb:[ 25, 25, 25]}
};
const MODE_NAMES={bw:'чёрная нить', bw2:'чёрная + белая нить', color:'цветные нити'};

const CK = CKCore();
let canvas=document.getElementById('canvas'), ctx=canvas.getContext('2d');
let image=null, sequence=[], isGenerating=false, worker=null, lastResult=null;
let mode='bw', currentFilter='normal', board='white';
let imgX=0, imgY=0, imgScale=1, imgNatW=0, imgNatH=0;
let fakeCanvas=document.createElement('canvas'), fakeCtx=fakeCanvas.getContext('2d', { willReadFrequently: true });
let width, height, x0, y0, radius, dpr=window.devicePixelRatio||1;
let contrastTable=[], brightnessTable=[];
let touches=[], isDragging=false, lastX=0, lastY=0;
let activeColors=COLORS.map(()=>true);

const FILTERS={
  normal:    l=>l,
  hard:      l=>Math.max(0,Math.min(255,Math.round((l-128)*2.5+128))),
  soft:      l=>Math.round(l*0.6+50),
  silhouette:l=>l<128?0:255
};

// ── Настройки (запоминаются) ──────────────────────────────────────────────────
const $=id=>document.getElementById(id);
function loadSettings(){
  try{
    const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
    if(s.frame) $('frame-box').value=s.frame;
    if(s.thread) $('thread-box').value=s.thread;
    if(s.lines) $('lines-count-box').value=s.lines;
    if(s.interval) $('color-interval-box').value=s.interval;
    if(s.nails) $('nails-box').value=s.nails;
    if(BOARDS[s.board]) board=s.board;
    if(Array.isArray(s.colors)&&s.colors.length===COLORS.length&&s.colors.some(Boolean)) activeColors=s.colors.map(Boolean);
  }catch(_){}
}
function saveSettings(){
  try{
    localStorage.setItem(SETTINGS_KEY,JSON.stringify({
      frame:+$('frame-box').value, thread:+$('thread-box').value,
      lines:+$('lines-count-box').value, interval:+$('color-interval-box').value,
      nails:nailsCount(), board, colors:activeColors
    }));
  }catch(_){}
}
function physical(){
  const frame=Math.min(300,Math.max(10,+$('frame-box').value||50));     // см
  const thread=Math.min(3,Math.max(0.05,+$('thread-box').value||0.25));  // мм
  return { frameMm: frame*10, threadMm: thread, frameCm: frame };
}
// Число гвоздей: кратно 4 (четыре равных сектора A, B, C, D)
function nailsCount(){
  const v=+$('nails-box').value||260;
  return Math.min(400,Math.max(100,Math.round(v/4)*4));
}
function fixNailsBox(){
  const n=nailsCount(); if(+$('nails-box').value!==n) $('nails-box').value=n;
  $('nails-hint').textContent=`по ${n/4} в секторе`;
  if(!isGenerating&&!lastResult) { if(image) drawPhoto(); else drawEmpty(); }
}

// ── Холст ─────────────────────────────────────────────────────────────────────
function initCanvas(){
  const wrap=$('canvas-wrap');
  const size=Math.min(wrap.clientWidth,400);
  width=size; height=size; x0=width/2; y0=height/2;
  radius=Math.min(width,height)/2-PADDING;
  canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
  canvas.style.width=width+'px'; canvas.style.height=height+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  fakeCanvas.width=canvas.width; fakeCanvas.height=canvas.height;
  drawEmpty();
}
function boardCss(){ const c=BOARDS[board].rgb; return `rgb(${c[0]},${c[1]},${c[2]})`; }
function drawEmpty(){
  ctx.clearRect(0,0,width,height);
  ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2);
  ctx.fillStyle=boardCss(); ctx.fill();
  ctx.strokeStyle='#ccc'; ctx.lineWidth=1; ctx.stroke();
}
function drawNails(){
  const n=nailsCount();
  ctx.fillStyle=board==='black'?'#888':NAIL_COLOR;
  for(let i=0;i<n;i++){
    const t=i*2*Math.PI/n;
    ctx.beginPath(); ctx.arc(x0+radius*Math.cos(t),y0+radius*Math.sin(t),NAIL_RADIUS,0,Math.PI*2); ctx.fill();
  }
}

function limitPixel(v){return Math.max(0,Math.min(255,Math.round(v)));}
function updateContrast(){
  let val=+$('contrast-box').value;
  $('contrast-val').textContent=val>0?'+'+val:val;
  let c=1+val/100;
  contrastTable=Array.from({length:256},(_,i)=>limitPixel((i-128)*c+128));
}
function updateBrightness(){
  let val=+$('brightness-box').value;
  $('brightness-val').textContent=val>0?'+'+val:val;
  let b=1+val/100;
  brightnessTable=Array.from({length:256},(_,i)=>limitPixel(i*b));
}

// ── Тон: светлота L*, автоуровни, настройки пользователя, гамма ───────────────
const SRGB_LIN=new Float32Array(256).map((_,i)=>CK.srgb2lin(i/255));
// Таблицы для скорости: вклад каналов в яркость и яркость → светлота L* (0..255)
const WR=SRGB_LIN.map(v=>0.2126*v), WG=SRGB_LIN.map(v=>0.7152*v), WB=SRGB_LIN.map(v=>0.0722*v);
const Y2L=new Float32Array(4097).map((_,i)=>255*CK.lin2L(i/4096));
function lightness255(r,g,b){ return Y2L[((WR[r]+WG[g]+WB[b])*4096)|0]; }
function bwTable(lv){ return new Uint8ClampedArray(256).map((_,l)=>Math.round(255*Math.pow(toneBW(l,lv),ALGO.gamma))); }
function colorTable(lv){ return new Uint8ClampedArray(256).map((_,v)=>Math.round(255*toneColor(v,lv))); }
// Чёрная и белая точки по 1-му и 99-му процентилю (внутри круга)
function levels(values){
  const h=new Uint32Array(256); let n=0;
  for(const v of values){ h[v|0]++; n++; }
  if(!n) return {lo:0,hi:255};
  let acc=0, lo=0, hi=255;
  for(let i=0;i<256;i++){ acc+=h[i]; if(acc>=n*0.01){lo=i;break;} }
  acc=0; for(let i=255;i>=0;i--){ acc+=h[i]; if(acc>=n*0.01){hi=i;break;} }
  if(hi-lo<10){ lo=Math.max(0,lo-5); hi=Math.min(255,hi+5); }
  return {lo,hi};
}
function toneBW(l,lv){
  let v=limitPixel((l-lv.lo)*255/(lv.hi-lv.lo));
  v=brightnessTable[v]; v=contrastTable[v]; v=FILTERS[currentFilter](v);
  return v/255;
}
function toneColor(v,lv){
  v=limitPixel((v-lv.lo)*255/(lv.hi-lv.lo));
  v=brightnessTable[v]; v=contrastTable[v];
  return v/255;
}
// Нарисовать картинку (фото или маску) в круг на квадратной сетке size×size
function drawToGrid(src, size, margin, fill){
  const c=document.createElement('canvas'); c.width=size; c.height=size;
  const g=c.getContext('2d',{willReadFrequently:true});
  const s=(size/2-margin)/radius;
  g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
  if(fill){ g.fillStyle=fill; g.fillRect(0,0,size,size); }
  g.setTransform(s,0,0,s,size/2-x0*s,size/2-y0*s);
  g.drawImage(src,imgX,imgY,imgNatW*imgScale,imgNatH*imgScale);
  return g.getImageData(0,0,size,size).data;
}
function sampleCircle(size, margin){ return drawToGrid(image,size,margin,'#fff'); }
function insideMask(size, margin){
  const m=new Uint8Array(size*size), c=size/2, R=size/2-margin;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){ const dx=x+0.5-c, dy=y+0.5-c; if(dx*dx+dy*dy<=R*R) m[y*size+x]=1; }
  return m;
}
function collectLevels(data, mask, color){
  const vals=[];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]) continue; const o=i*4;
    if(color){ vals.push(data[o],data[o+1],data[o+2]); }
    else vals.push(lightness255(data[o],data[o+1],data[o+2]));
  }
  return levels(vals);
}
// Размытие (три прохода «коробкой» ≈ гаусс) — для повышения резкости
function blur(src, n, r){
  let a=Float32Array.from(src), b=new Float32Array(src.length);
  for(let pass=0;pass<3;pass++){
    for(let y=0;y<n;y++){ let acc=0; const row=y*n;
      for(let x=-r;x<=r;x++) acc+=a[row+Math.min(n-1,Math.max(0,x))];
      for(let x=0;x<n;x++){ b[row+x]=acc/(2*r+1); acc+=a[row+Math.min(n-1,x+r+1)]-a[row+Math.max(0,x-r)]; } }
    for(let x=0;x<n;x++){ let acc=0;
      for(let y=-r;y<=r;y++) acc+=b[Math.min(n-1,Math.max(0,y))*n+x];
      for(let y=0;y<n;y++){ a[y*n+x]=acc/(2*r+1); acc+=b[Math.min(n-1,y+r+1)*n+x]-b[Math.max(0,y-r)*n+x]; } }
  }
  return a;
}

// ── Кисти: «Главное» и «Фон» ─────────────────────────────────────────────────
// Пометки хранятся в координатах фото, поэтому остаются на месте при сдвиге и масштабе.
let tool='move', brushCss=22, painting=false, lastPaint=null, hasMarks=false;
let impMask=null, bgMask=null, markScale=1, tintCanvas=document.createElement('canvas');
function initMasks(){
  markScale=Math.min(1,1024/Math.max(imgNatW,imgNatH));
  const w=Math.max(1,Math.round(imgNatW*markScale)), h=Math.max(1,Math.round(imgNatH*markScale));
  impMask=document.createElement('canvas'); impMask.width=w; impMask.height=h;
  bgMask=document.createElement('canvas'); bgMask.width=w; bgMask.height=h;
  tintCanvas.width=w; tintCanvas.height=h;
  hasMarks=false;
}
function clearMarks(){
  if(!impMask) return;
  impMask.getContext('2d').clearRect(0,0,impMask.width,impMask.height);
  bgMask.getContext('2d').clearRect(0,0,bgMask.width,bgMask.height);
  hasMarks=false; drawPhoto();
}
function strokeMask(mask, op, a, b, r){
  const g=mask.getContext('2d');
  g.globalCompositeOperation=op; g.strokeStyle='#fff'; g.fillStyle='#fff';
  g.lineWidth=2*r; g.lineCap='round'; g.lineJoin='round';
  g.beginPath(); g.moveTo(a.x,a.y); g.lineTo(b.x,b.y); g.stroke();
  g.beginPath(); g.arc(b.x,b.y,r,0,Math.PI*2); g.fill();
  g.globalCompositeOperation='source-over';
}
function paintTo(p){
  if(!impMask) return;
  const m={x:(p.x-imgX)/imgScale*markScale, y:(p.y-imgY)/imgScale*markScale};
  const r=brushCss/imgScale*markScale, a=lastPaint||m;
  if(tool==='imp'){ strokeMask(impMask,'source-over',a,m,r); strokeMask(bgMask,'destination-out',a,m,r); }
  else if(tool==='bg'){ strokeMask(bgMask,'source-over',a,m,r); strokeMask(impMask,'destination-out',a,m,r); }
  else { strokeMask(impMask,'destination-out',a,m,r); strokeMask(bgMask,'destination-out',a,m,r); }
  if(tool!=='erase') hasMarks=true;
  lastPaint=m; drawPhoto();
}
function drawTint(mask, color, alpha){
  const g=tintCanvas.getContext('2d');
  g.globalCompositeOperation='source-over'; g.clearRect(0,0,tintCanvas.width,tintCanvas.height);
  g.drawImage(mask,0,0); g.globalCompositeOperation='source-in';
  g.fillStyle=color; g.fillRect(0,0,tintCanvas.width,tintCanvas.height);
  g.globalCompositeOperation='source-over';
  ctx.globalAlpha=alpha;
  ctx.drawImage(tintCanvas,imgX,imgY,imgNatW*imgScale,imgNatH*imgScale);
  ctx.globalAlpha=1;
}
function maskToGrid(mask, size, margin){
  const d=drawToGrid(mask,size,margin,null), out=new Float32Array(size*size);
  for(let i=0;i<out.length;i++) out[i]=d[i*4+3]/255;
  return out;
}
function setTool(t){
  tool=t;
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  $('brush-row').style.display=t==='move'?'none':'flex';
}

// ── Цель и важность пикселей для ядра ────────────────────────────────────────
function boardLinear(){ return BOARDS[board].rgb.map(v=>CK.srgb2lin(v/255)); }
function buildTarget(){
  const color=mode==='color', N=color?GRID_COLOR:GRID_BW, margin=1.5;
  const data=sampleCircle(N,margin), mask=insideMask(N,margin);
  const lv=collectLevels(data,mask,color);
  const imp=hasMarks?maskToGrid(impMask,N,margin):null;
  const bg=hasMarks?maskToGrid(bgMask,N,margin):null;
  const W=new Float32Array(N*N), c=N/2, R=N/2-margin;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const i=y*N+x; if(!mask[i]) continue;
    const r2=((x+0.5-c)**2+(y+0.5-c)**2)/(R*R);
    W[i]=(1-0.5*r2)*(imp?1+ALGO.importance*imp[i]:1); // центр важнее края, «главное» — ещё важнее
  }
  const bl=boardLinear();
  let T;
  if(!color){
    let L=new Float32Array(N*N);
    const tb=new Float32Array(256).map((_,l)=>toneBW(l,lv));
    for(let i=0;i<N*N;i++){ const o=i*4; L[i]=mask[i]?tb[lightness255(data[o],data[o+1],data[o+2])|0]:1; }
    if(ALGO.sharpen>0){
      const b=blur(L,N,Math.max(1,Math.round(N/100)));
      for(let i=0;i<N*N;i++) L[i]=Math.min(1,Math.max(0,L[i]+ALGO.sharpen*(L[i]-b[i])));
    }
    for(let i=0;i<N*N;i++) L[i]=Math.pow(L[i],ALGO.gamma);
    if(bg){ // «Фон» — цвет доски, нити туда не нужны
      const boardL=CK.lin2L(0.2126*bl[0]+0.7152*bl[1]+0.0722*bl[2]);
      for(let i=0;i<N*N;i++) if(bg[i]>0) L[i]=L[i]*(1-bg[i])+boardL*bg[i];
    }
    T=L;
  }else{
    T=new Float32Array(N*N*3);
    const tc=new Float32Array(256).map((_,v)=>toneColor(v,lv));
    const bs=BOARDS[board].rgb.map(v=>v/255);
    for(let i=0;i<N*N;i++){ const o=i*4, b=bg?bg[i]:0;
      for(let k=0;k<3;k++){ const v=mask[i]?tc[data[o+k]]:1; T[i*3+k]=b>0?v*(1-b)+bs[k]*b:v; } }
  }
  return {N,T,W,margin};
}

// ── Превью фото (то, к чему стремится генератор) ─────────────────────────────
const PREVIEW_MASK=insideMask(160,1.5);
let photoPending=false;
function drawPhoto(){
  if(photoPending) return; photoPending=true;
  requestAnimationFrame(()=>{ photoPending=false; renderPhoto(); });
}
function renderPhoto(){
  if(!image)return;
  ctx.clearRect(0,0,width,height);
  ctx.save();
  ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill(); ctx.clip();
  fakeCtx.setTransform(dpr,0,0,dpr,0,0);
  fakeCtx.fillStyle='#fff'; fakeCtx.fillRect(0,0,width,height);
  fakeCtx.drawImage(image,imgX,imgY,imgNatW*imgScale,imgNatH*imgScale);
  const P=fakeCanvas.width;
  const img=fakeCtx.getImageData(0,0,P,P), px=img.data;
  const color=mode==='color';
  const lv=collectLevels(sampleCircle(160,1.5),PREVIEW_MASK,color);
  if(color){
    const t=colorTable(lv);
    for(let i=0;i<px.length;i+=4){ px[i]=t[px[i]]; px[i+1]=t[px[i+1]]; px[i+2]=t[px[i+2]]; }
  }else{
    const t=bwTable(lv);
    for(let i=0;i<px.length;i+=4){ px[i]=px[i+1]=px[i+2]=t[Y2L[((WR[px[i]]+WG[px[i+1]]+WB[px[i+2]])*4096)|0]|0]; }
  }
  fakeCtx.putImageData(img,0,0);
  ctx.setTransform(1,0,0,1,0,0);
  ctx.drawImage(fakeCanvas,0,0);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(hasMarks){ // фон — цветом доски, главное — жёлтым
    drawTint(bgMask,boardCss(),0.8);
    drawTint(impMask,'#EFCA46',0.45);
  }
  ctx.restore();
  ctx.strokeStyle='#ccc'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2); ctx.stroke();
}

// ── Касания и мышь: двигать / рисовать кистью / масштаб двумя пальцами ───────
function getOff(e){let r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
const canEdit=()=>image&&!isGenerating&&!lastResult;
canvas.addEventListener('mousedown',e=>{
  if(!canEdit())return; const p=getOff(e); e.preventDefault();
  if(tool!=='move'){ painting=true; lastPaint=null; paintTo(p); }
  else { isDragging=true; lastX=p.x; lastY=p.y; }
});
canvas.addEventListener('mousemove',e=>{
  if(!canEdit())return; const p=getOff(e);
  if(painting){ paintTo(p); e.preventDefault(); return; }
  if(!isDragging)return;
  imgX+=p.x-lastX; imgY+=p.y-lastY; lastX=p.x; lastY=p.y; drawPhoto(); e.preventDefault();
});
const endPointer=()=>{ isDragging=false; painting=false; lastPaint=null; };
canvas.addEventListener('mouseup',endPointer);
canvas.addEventListener('mouseleave',endPointer);
canvas.addEventListener('wheel',e=>{
  if(!canEdit())return; e.preventDefault();
  let f=e.deltaY<0?1.1:0.9,p=getOff(e);
  let dx=(p.x-imgX)/imgScale,dy=(p.y-imgY)/imgScale;
  imgScale=Math.max(0.1,Math.min(10,imgScale*f));
  imgX=p.x-dx*imgScale; imgY=p.y-dy*imgScale; drawPhoto();
},{passive:false});
canvas.addEventListener('touchstart',e=>{
  if(!canEdit())return; e.preventDefault();
  touches=Array.from(e.targetTouches).map(t=>({x:t.clientX,y:t.clientY}));
  if(e.targetTouches.length===1){
    if(tool!=='move'){ painting=true; lastPaint=null; paintTo(getOff(e.targetTouches[0])); }
    else { isDragging=true; lastX=touches[0].x; lastY=touches[0].y; }
  } else { painting=false; isDragging=false; }
},{passive:false});
canvas.addEventListener('touchmove',e=>{
  if(!canEdit())return; e.preventDefault();
  let cur=Array.from(e.targetTouches).map(t=>({x:t.clientX,y:t.clientY}));
  if(cur.length===1&&painting){ paintTo(getOff(e.targetTouches[0])); }
  else if(cur.length===1&&isDragging){
    imgX+=cur[0].x-lastX; imgY+=cur[0].y-lastY; lastX=cur[0].x; lastY=cur[0].y; drawPhoto();
  }else if(cur.length===2&&touches.length===2){
    let d1=Math.hypot(touches[1].x-touches[0].x,touches[1].y-touches[0].y);
    let d2=Math.hypot(cur[1].x-cur[0].x,cur[1].y-cur[0].y);
    let f=d2/d1,r=canvas.getBoundingClientRect();
    let cx=(cur[0].x+cur[1].x)/2-r.left,cy=(cur[0].y+cur[1].y)/2-r.top;
    let dx=(cx-imgX)/imgScale,dy=(cy-imgY)/imgScale;
    imgScale=Math.max(0.1,Math.min(10,imgScale*f));
    imgX=cx-dx*imgScale; imgY=cy-dy*imgScale;
    imgX+=(cur[0].x+cur[1].x)/2-(touches[0].x+touches[1].x)/2;
    imgY+=(cur[0].y+cur[1].y)/2-(touches[0].y+touches[1].y)/2;
    drawPhoto();
  }
  touches=cur;
},{passive:false});
canvas.addEventListener('touchend',e=>{ e.preventDefault(); endPointer(); touches=[]; },{passive:false});

$('file-input').addEventListener('change',function(){
  if(!this.files[0])return;
  this.style.pointerEvents='none';this.style.zIndex='-1';
  let img=new Image();
  img.onload=()=>{
    image=img;imgNatW=img.width;imgNatH=img.height;
    // фото заполняет круг целиком (можно сдвинуть и уменьшить пальцами)
    let s=(radius*2)/Math.min(img.width,img.height);
    imgScale=s;imgX=x0-img.width*s/2;imgY=y0-img.height*s/2;
    initMasks(); setTool('move');
    $('canvas-hint').style.display='none';
    $('tools-block').style.display='flex';
    drawPhoto();
    $('generate-btn').removeAttribute('disabled');
  };
  img.src=URL.createObjectURL(this.files[0]);
});

function setState(state){
  $('state-ready').style.display  =state==='ready'  ?'block':'none';
  $('state-running').style.display=state==='running'?'block':'none';
  $('state-done').style.display   =state==='done'   ?'flex' :'none';
  $('settings-block').style.display=state==='ready' ?'flex' :'none';
  $('tools-block').style.display=(state==='ready'&&image)?'flex':'none';
  $('progress-block').style.display=state!=='ready'?'flex':'none';
}

// ── Фоновый поток ────────────────────────────────────────────────────────────
// Код потока собирается из функций прямо на странице (Blob), поэтому работает
// и на сайте, и при открытии файла из папки. Если поток недоступен — считаем
// на странице небольшими порциями.
function workerMain(CK, post){
  let run=null, preview=null, counts=null, stopped=false, lastPost=0, P=0, maxLines=0;
  function snapshot(){ const out=new Uint8ClampedArray(P*P*4); preview.toRGBA(out); return out; }
  function frame(){
    const t0=Date.now();
    while(!run.finished && Date.now()-t0<40){
      const lines=run.step(4);
      for(let k=0;k<lines.length;k++){ const l=lines[k]; preview.draw(l[0],l[1],l[2]); counts[l[2]]++; }
    }
    const now=Date.now();
    if(run.finished){
      const img=snapshot();
      post({type:'done', seq:run.seq, lines:run.lines, changes:run.changes, counts,
            reason: stopped?'user':(run.lines>=maxLines?'limit':'auto'), rgba:img.buffer},[img.buffer]);
      return;
    }
    if(now-lastPost>500){
      lastPost=now; const img=snapshot();
      post({type:'progress', lines:run.lines, changes:run.changes, counts, rgba:img.buffer},[img.buffer]);
    }
    setTimeout(frame,0);
  }
  return function(e){
    const m=e.data;
    if(m.cmd==='start'){
      const p=m.params; P=p.preview.size; maxLines=p.maxLines;
      run=CK.createRun(p);
      preview=CK.createPreview(P,p.nails,p.preview.threadPx,p.preview.colors,p.preview.margin,p.preview.board);
      counts=p.colors.map(()=>0); lastPost=Date.now();
      setTimeout(frame,0);
    }else if(m.cmd==='stop'){ stopped=true; if(run) run.finish(); }
  };
}
function createWorker(onMessage){
  try{
    const src=CKCore.toString()+';\nself.onmessage=('+workerMain.toString()+')(CKCore(),(m,t)=>self.postMessage(m,t||[]));';
    const w=new Worker(URL.createObjectURL(new Blob([src],{type:'application/javascript'})));
    w.onmessage=onMessage;
    return w;
  }catch(e){
    const handler=workerMain(CK,m=>setTimeout(()=>onMessage({data:m}),0));
    return { postMessage:m=>setTimeout(()=>handler({data:m}),0), terminate(){ handler({data:{cmd:'stop'}}); } };
  }
}

function showPreview(buf){
  const P=canvas.width;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buf),P,P),0,0);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.strokeStyle='#ccc'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2); ctx.stroke();
  drawNails();
}
function fmtTime(s){ return s<60? s.toFixed(1)+' с' : Math.floor(s/60)+' мин '+Math.round(s%60)+' с'; }
function fmtLen(m){ return m>=1000 ? (m/1000).toFixed(m>=10000?0:1).replace('.',',')+' км' : Math.round(m)+' м'; }
function fmtHours(sec){ const h=sec/3600; return h<1 ? Math.round(sec/60)+' мин' : (h<10?h.toFixed(1).replace('.',','):Math.round(h))+' ч'; }

// Палитра режима: индексы в COLORS
function modePalette(){
  if(mode==='color') return COLORS.map((_,i)=>i);
  if(mode==='bw2') return [K_INDEX,W_INDEX];
  return [K_INDEX];
}

function startGenerate(){
  if(isGenerating||!image)return;
  if(mode==='bw'&&board==='black'){
    $('progress-block').style.display='flex';
    $('status-text').textContent='Чёрная нить не видна на чёрной доске — выберите режим «Ч+Б» или другую доску.';
    return;
  }
  saveSettings();
  isGenerating=true; sequence=[]; lastResult=null;
  setState('running');
  const color=mode==='color', multi=mode!=='bw';
  const n=nailsCount();
  const maxLines=Math.max(100,Math.min(20000,+$('lines-count-box').value||3000));
  const interval=Math.max(10,+$('color-interval-box').value||100);
  const {frameMm,threadMm}=physical();
  const tg=buildTarget();
  const P=canvas.width, pMargin=PADDING*dpr;
  // доля пикселя, которую закрывает одна нить: толщина нити / размер пикселя
  const alpha=Math.min(0.95, threadMm*(tg.N-2*tg.margin)/frameMm);
  const threadPx=threadMm*(P-2*pMargin)/frameMm;
  const palIdx=modePalette();
  const colorsLin=palIdx.map(i=>COLORS[i].rgb.map(v=>CK.srgb2lin(v/255)));
  const allowed=color?activeColors.slice():palIdx.map(()=>true);
  const bl=boardLinear(), boardGray=0.2126*bl[0]+0.7152*bl[1]+0.0722*bl[2];
  // для ч/б режимов ядро работает в оттенках серого
  const coreColors=color?colorsLin:colorsLin.map(c=>[0.2126*c[0]+0.7152*c[1]+0.0722*c[2]]);

  const row=$('color-progress-row'); row.innerHTML='';
  const countEls=palIdx.map((ci,i)=>{
    if(!multi||!allowed[i]) return null;
    const c=COLORS[ci];
    const chip=document.createElement('div');
    chip.className='color-progress-chip';
    chip.style.background=c.hex+'22';
    chip.style.color=c.id==='W'?'#999':(c.id==='K'?'#aaa':c.hex);
    chip.style.border=`1px solid ${c.hex}44`;
    chip.innerHTML=`<div style="width:8px;height:8px;border-radius:50%;background:${c.hex};border:1px solid #444"></div><span>0</span>`;
    row.appendChild(chip);
    return chip.querySelector('span');
  });

  const t0=performance.now();
  $('progress-bar').style.width='0%';
  $('status-text').textContent='Подготовка…';

  worker=createWorker(e=>{
    const m=e.data; if(!isGenerating&&m.type!=='done') return;
    const el=(performance.now()-t0)/1000;
    if(m.rgba) showPreview(m.rgba);
    m.counts.forEach((c,i)=>{ if(countEls[i]) countEls[i].textContent=c; });
    if(m.type==='progress'){
      $('progress-bar').style.width=Math.min(100,m.lines/maxLines*100)+'%';
      $('status-text').textContent=`${m.lines} линий · ${fmtTime(el)}`+(multi?` · смен нити: ${m.changes}`:'');
    }else if(m.type==='done'){
      finishGenerate(m,el,palIdx,{n,frameMm,threadMm});
    }
  });
  worker.postMessage({cmd:'start',params:{
    size:tg.N, nails:n, channels:color?3:1, target:tg.T, weight:tg.W, margin:tg.margin,
    alpha, colors:coreColors, allowed, blockSize:multi?interval:1e9, maxLines,
    minGap:Math.max(4,Math.round(ALGO.minGap*n/260)), negWeight:ALGO.negWeight, stopFrac:ALGO.stopFrac,
    board:color?bl:[boardGray],
    preview:{size:P, threadPx, margin:pMargin, colors:colorsLin, board:bl}
  }});
}
function stopGenerate(){
  if(!isGenerating||!worker) return;
  $('status-text').textContent='Останавливаю…';
  worker.postMessage({cmd:'stop'});
}

// Расход нити по цветам: сумма длин хорд (мм) по пути каждого цвета
function threadUsage(seq, n, frameMm){
  const last=new Map(), mm=new Map();
  for(const {nail,colorIndex} of seq){
    if(last.has(colorIndex)){
      const d=Math.abs(nail-last.get(colorIndex));
      mm.set(colorIndex,(mm.get(colorIndex)||0)+frameMm*Math.sin(Math.PI*Math.min(d,n-d)/n));
    }
    last.set(colorIndex,nail);
  }
  return mm;
}
function finishGenerate(m,el,palIdx,phys){
  isGenerating=false;
  if(worker){ worker.terminate(); worker=null; }
  sequence=m.seq.map(([nail,ci])=>({nail, colorIndex: palIdx[ci]}));
  const usage=threadUsage(sequence,phys.n,phys.frameMm);
  const totalM=[...usage.values()].reduce((a,b)=>a+b,0)/1000*1.1; // +10 % запас
  lastResult={...m, mode, board, nails:phys.n, frameMm:phys.frameMm, threadMm:phys.threadMm, usage, totalM,
              date:new Date(), elapsed:el};
  $('progress-bar').style.width='100%';
  const why={auto:'картинка готова', limit:'достигнут лимит линий — можно увеличить', user:'остановлено'}[m.reason];
  const multi=mode!=='bw';
  $('status-text').innerHTML=
    `✅ ${m.lines} линий за ${fmtTime(el)} · ${why}`+(multi?` · смен нити: ${m.changes}`:'')+
    `<br>🧵 Нить ≈ ${fmtLen(totalM)} (с запасом 10 %) · ⏱ плетение ≈ ${fmtHours(sequence.length*SECONDS_PER_STEP)}`;
  setState(m.lines>0?'done':'ready');
}

function resetAll(){
  if(worker){ worker.terminate(); worker=null; }
  isGenerating=false; sequence=[]; lastResult=null;
  if(image)drawPhoto();else drawEmpty();
  $('progress-bar').style.width='0%';
  $('color-progress-row').innerHTML='';
  $('status-text').textContent='';
  setState('ready');
}
function download(name, blob){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
function saveImage(){
  canvas.toBlob(b=>download('stringart.png',b),'image/png');
}

// ── Схема ходами (.txt) ──────────────────────────────────────────────────────
// Формат читается обратно вязалкой (кнопка загрузки файла).
function nailLabel(v,n){ // v — номер гвоздя с 1
  const q=n/4, sec=v<=q?'D':v<=2*q?'C':v<=3*q?'A':'B';
  const base={D:1,C:q+1,A:2*q+1,B:3*q+1}[sec];
  return sec+(v-base+1);
}
function downloadTxt(){
  if(!lastResult||!sequence.length) return;
  const r=lastResult, n=r.nails, L=[];
  const d=r.date, pad=x=>String(x).padStart(2,'0');
  L.push('ColorKnitter — схема плетения');
  L.push(`Создано: ${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
  L.push(`Гвоздей: ${n} (сектора A, B, C, D по ${n/4})`);
  L.push(`Рама: ${r.frameMm/10} см · нить: ${String(r.threadMm).replace('.',',')} мм · доска: ${BOARDS[r.board].name}`);
  L.push(`Режим: ${MODE_NAMES[r.mode]}`);
  L.push(`Линий: ${r.lines}`+(r.mode!=='bw'?` · смен нити: ${r.changes}`:''));
  L.push(`Нить: ≈ ${fmtLen(r.totalM)} с запасом 10 %`+(r.usage.size>1?': '+[...r.usage].map(([ci,mm])=>`${COLORS[ci].name.toLowerCase()} ≈ ${fmtLen(mm/1000*1.1)}`).join(', '):''));
  L.push(`Время: ≈ ${fmtHours(sequence.length*SECONDS_PER_STEP)} в темпе вязалки 1x`);
  L.push('');
  L.push('Шаги (номер шага. гвоздь):');
  const at=new Map(); let prev=-1;
  sequence.forEach((s,i)=>{
    if(s.colorIndex!==prev){
      const c=COLORS[s.colorIndex];
      const hint=at.has(s.colorIndex)?`нить висит на ${nailLabel(at.get(s.colorIndex)+1,n)}`:'привяжите нить к первому гвоздю';
      L.push(`=== ${c.name} [${c.rgb.join(', ')}] — ${hint} ===`);
      prev=s.colorIndex;
    }
    L.push(`${i+1}. ${nailLabel(s.nail+1,n)}`);
    at.set(s.colorIndex,s.nail);
  });
  download(`colorknitter_${n}_${sequence.length}.txt`, new Blob([L.join('\r\n')],{type:'text/plain;charset=utf-8'}));
}

// ── Шаблон рамы для печати (SVG в натуральную величину) ─────────────────────
function downloadTemplate(){
  const n=nailsCount(), {frameMm}=physical(), q=n/4;
  const pad=25, S=frameMm+2*pad, c=S/2, R=frameMm/2;
  const step=Math.PI*frameMm/n;                       // расстояние между гвоздями, мм
  const fs=Math.max(1.6,Math.min(3.2,step*0.55));     // размер подписи
  const out=[];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}mm" height="${S}mm" viewBox="0 0 ${S} ${S}" font-family="Arial, sans-serif">`);
  out.push(`<rect width="${S}" height="${S}" fill="#fff"/>`);
  out.push(`<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="#bbb" stroke-width="0.3"/>`);
  out.push(`<line x1="${c-6}" y1="${c}" x2="${c+6}" y2="${c}" stroke="#000" stroke-width="0.3"/><line x1="${c}" y1="${c-6}" x2="${c}" y2="${c+6}" stroke="#000" stroke-width="0.3"/>`);
  // границы секторов и крупные буквы
  [['D',0],['C',0.5],['A',1],['B',1.5]].forEach(([s,a0])=>{
    const a=a0*Math.PI, am=a+Math.PI/4;
    out.push(`<line x1="${c}" y1="${c}" x2="${(c+(R-8)*Math.cos(a)).toFixed(2)}" y2="${(c+(R-8)*Math.sin(a)).toFixed(2)}" stroke="#ddd" stroke-width="0.3" stroke-dasharray="3 3"/>`);
    out.push(`<text x="${(c+R*0.55*Math.cos(am)).toFixed(2)}" y="${(c+R*0.55*Math.sin(am)).toFixed(2)}" font-size="${Math.min(40,R/5).toFixed(1)}" fill="#e5e5e5" text-anchor="middle" dominant-baseline="central" font-weight="700">${s}</text>`);
  });
  for(let i=0;i<n;i++){
    const a=i*2*Math.PI/n, x=c+R*Math.cos(a), y=c+R*Math.sin(a);
    out.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.9" fill="#000"/>`);
    const lx=c+(R+3)*Math.cos(a), ly=c+(R+3)*Math.sin(a), deg=a*180/Math.PI, flip=Math.cos(a)<0;
    out.push(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-size="${fs.toFixed(2)}" text-anchor="${flip?'end':'start'}" dominant-baseline="central" transform="rotate(${(flip?deg+180:deg).toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)})">${nailLabel(i+1,n)}</text>`);
  }
  out.push(`<text x="${pad/2}" y="${pad/2}" font-size="4" fill="#666">ColorKnitter · ${n} гвоздей · Ø ${frameMm/10} см · печатать в масштабе 100 %</text>`);
  out.push(`<line x1="${pad/2}" y1="${S-pad/2}" x2="${pad/2+100}" y2="${S-pad/2}" stroke="#000" stroke-width="0.5"/><text x="${pad/2}" y="${S-pad/2-2}" font-size="3.5">100 мм — проверка масштаба</text>`);
  out.push('</svg>');
  download(`шаблон_рамы_${n}_${frameMm/10}см.svg`, new Blob([out.join('\n')],{type:'image/svg+xml'}));
}

function openInKnitter(){
  try{
    let pc=document.createElement('canvas');
    pc.width=Math.round(width);pc.height=Math.round(height);
    let pCtx=pc.getContext('2d');
    pCtx.save();
    pCtx.beginPath();pCtx.arc(x0,y0,radius,0,Math.PI*2);pCtx.clip();
    pCtx.drawImage(image,imgX,imgY,imgNatW*imgScale,imgNatH*imgScale);
    pCtx.restore();
    const r=lastResult||{};
    localStorage.setItem('ck_from_generator',JSON.stringify({
      sequence,colors:COLORS,mode,
      nails:r.nails||nailsCount(), board:BOARDS[r.board||board].rgb,
      image:pc.toDataURL('image/jpeg',0.7)
    }));
    window.location.href='index.html';
  }catch(e){alert('Ошибка: '+e.message);}
}
function setMode(m){
  mode=m;
  ['bw','bw2','color'].forEach(k=>$('btn-'+k).classList.toggle('active',m===k));
  $('filter-block').style.display=m!=='color'?'block':'none';
  $('color-select-block').style.display=m==='color'?'block':'none';
  $('interval-col').style.display=m!=='bw'?'block':'none';
  if(image)drawPhoto();
}
function setFilter(f){
  currentFilter=f;
  document.querySelectorAll('#filter-block .filter-btn').forEach((b,i)=>{
    b.classList.toggle('active',['normal','hard','soft','silhouette'][i]===f);
  });
  if(image)drawPhoto();
}
function setBoard(b){
  board=b; saveSettings();
  document.querySelectorAll('.board-btn').forEach(x=>x.classList.toggle('active',x.dataset.board===b));
  if(image)drawPhoto(); else drawEmpty();
}
function initColorChips(){
  const container=$('color-chips');
  container.innerHTML='';
  COLORS.forEach((c,i)=>{
    const chip=document.createElement('div');
    chip.className='color-chip'+(activeColors[i]?' active':'');
    chip.style.color=c.textHex;chip.style.borderColor=activeColors[i]?c.hex:'';
    chip.innerHTML=`<div class="color-dot" style="background:${c.hex};border:1px solid #333"></div>${c.short}`;
    // нажатие включает/выключает нить; хотя бы одна должна остаться
    chip.onclick=()=>{
      if(activeColors[i]&&activeColors.filter(Boolean).length===1) return;
      activeColors[i]=!activeColors[i]; saveSettings(); initColorChips();
    };
    container.appendChild(chip);
  });
}
$('contrast-box').addEventListener('input',()=>{updateContrast();if(image)drawPhoto();});
$('brightness-box').addEventListener('input',()=>{updateBrightness();if(image)drawPhoto();});
$('brush-size').addEventListener('input',e=>{ brushCss=+e.target.value; });
$('nails-box').addEventListener('change',()=>{ fixNailsBox(); saveSettings(); });
['frame-box','thread-box','lines-count-box','color-interval-box'].forEach(id=>$(id).addEventListener('change',saveSettings));
requestAnimationFrame(()=>{
  loadSettings();
  initCanvas();updateContrast();updateBrightness();initColorChips();
  setBoard(board); fixNailsBox(); setState('ready');
});
