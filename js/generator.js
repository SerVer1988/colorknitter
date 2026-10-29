// Генератор ColorKnitter: подготовка фото, расчёт в фоновом потоке, превью.
// Сам алгоритм — в js/stringart-core.js.

const NAILS_COUNT = 260, PADDING = 5, NAIL_RADIUS = 1, NAIL_COLOR = '#000';
const GRID_BW = 400, GRID_COLOR = 300;      // размер рабочей сетки
const ALGO = { minGap: 15, negWeight: 0.7, gamma: 1.5, sharpen: 1.0 };
const BW_COLOR_INDEX = 3;                    // чёрный в COLORS
const SETTINGS_KEY = 'ck_gen_settings';

const COLORS=[
  {id:'Y',name:'Жёлтый', short:'Жёл.',rgb:[255,220,  0],hex:'#ffdc00',textHex:'#b8870a'},
  {id:'C',name:'Голубой',short:'Гол.',rgb:[  0,183,235],hex:'#00b7eb',textHex:'#0077aa'},
  {id:'M',name:'Розовый',short:'Роз.',rgb:[255,  0,144],hex:'#ff0090',textHex:'#cc0070'},
  {id:'K',name:'Чёрный', short:'Чёр.',rgb:[  0,  0,  0],hex:'#000000',textHex:'#888888'},
  {id:'W',name:'Белый',  short:'Бел.',rgb:[255,255,255],hex:'#ffffff',textHex:'#999999'},
];

const CK = CKCore();
let canvas=document.getElementById('canvas'), ctx=canvas.getContext('2d');
let image=null, sequence=[], isGenerating=false, worker=null, lastResult=null;
let mode='bw', currentFilter='normal';
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
function loadSettings(){
  try{
    const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
    if(s.frame) document.getElementById('frame-box').value=s.frame;
    if(s.thread) document.getElementById('thread-box').value=s.thread;
    if(s.lines) document.getElementById('lines-count-box').value=s.lines;
    if(s.interval) document.getElementById('color-interval-box').value=s.interval;
    if(Array.isArray(s.colors)&&s.colors.length===COLORS.length&&s.colors.some(Boolean)) activeColors=s.colors.map(Boolean);
  }catch(_){}
}
function saveSettings(){
  try{
    localStorage.setItem(SETTINGS_KEY,JSON.stringify({
      frame:+document.getElementById('frame-box').value,
      thread:+document.getElementById('thread-box').value,
      lines:+document.getElementById('lines-count-box').value,
      interval:+document.getElementById('color-interval-box').value,
      colors:activeColors
    }));
  }catch(_){}
}
function physical(){
  const frame=Math.min(300,Math.max(10,+document.getElementById('frame-box').value||50));   // см
  const thread=Math.min(3,Math.max(0.05,+document.getElementById('thread-box').value||0.25)); // мм
  return { frameMm: frame*10, threadMm: thread };
}

// ── Холст ─────────────────────────────────────────────────────────────────────
function initCanvas(){
  const wrap=document.getElementById('canvas-wrap');
  const size=Math.min(wrap.clientWidth,400);
  width=size; height=size; x0=width/2; y0=height/2;
  radius=Math.min(width,height)/2-PADDING;
  canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
  canvas.style.width=width+'px'; canvas.style.height=height+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  fakeCanvas.width=canvas.width; fakeCanvas.height=canvas.height;
  drawEmpty();
}
function drawEmpty(){
  ctx.clearRect(0,0,width,height);
  ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill();
  ctx.strokeStyle='#ccc'; ctx.lineWidth=1; ctx.stroke();
}
function drawNails(){
  ctx.fillStyle=NAIL_COLOR;
  for(let i=0;i<NAILS_COUNT;i++){
    const t=i*2*Math.PI/NAILS_COUNT;
    ctx.beginPath(); ctx.arc(x0+radius*Math.cos(t),y0+radius*Math.sin(t),NAIL_RADIUS,0,Math.PI*2); ctx.fill();
  }
}

function limitPixel(v){return Math.max(0,Math.min(255,Math.round(v)));}
function updateContrast(){
  let val=+document.getElementById('contrast-box').value;
  document.getElementById('contrast-val').textContent=val>0?'+'+val:val;
  let c=1+val/100;
  contrastTable=Array.from({length:256},(_,i)=>limitPixel((i-128)*c+128));
}
function updateBrightness(){
  let val=+document.getElementById('brightness-box').value;
  document.getElementById('brightness-val').textContent=val>0?'+'+val:val;
  let b=1+val/100;
  brightnessTable=Array.from({length:256},(_,i)=>limitPixel(i*b));
}

// ── Тон: светлота L*, автоуровни, настройки пользователя, гамма ───────────────
const SRGB_LIN=new Float32Array(256).map((_,i)=>CK.srgb2lin(i/255));
// Таблицы для скорости: вклад каналов в яркость и яркость → светлота L* (0..255)
const WR=SRGB_LIN.map(v=>0.2126*v), WG=SRGB_LIN.map(v=>0.7152*v), WB=SRGB_LIN.map(v=>0.0722*v);
const Y2L=new Float32Array(4097).map((_,i)=>255*CK.lin2L(i/4096));
function lightness255(r,g,b){ // воспринимаемая светлота 0..255
  return Y2L[((WR[r]+WG[g]+WB[b])*4096)|0];
}
// Вся точечная обработка одной таблицей: светлота (0..255) → итоговое значение 0..255
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
// Точечная обработка (то же самое видно в превью фото)
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
// Пиксели фото в круге на квадратной сетке size×size (круг гвоздей = круг на экране)
function sampleCircle(size, margin){
  const c=document.createElement('canvas'); c.width=size; c.height=size;
  const g=c.getContext('2d',{willReadFrequently:true});
  const s=(size/2-margin)/radius;
  g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
  g.fillStyle='#fff'; g.fillRect(0,0,size,size);
  g.setTransform(s,0,0,s,size/2-x0*s,size/2-y0*s);
  g.drawImage(image,imgX,imgY,imgNatW*imgScale,imgNatH*imgScale);
  return g.getImageData(0,0,size,size).data;
}
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
// Цель и важность пикселей для ядра
function buildTarget(){
  const color=mode==='color', N=color?GRID_COLOR:GRID_BW, margin=1.5;
  const data=sampleCircle(N,margin), mask=insideMask(N,margin);
  const lv=collectLevels(data,mask,color);
  const W=new Float32Array(N*N), c=N/2, R=N/2-margin;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const i=y*N+x; if(!mask[i]) continue;
    const r2=((x+0.5-c)**2+(y+0.5-c)**2)/(R*R);
    W[i]=1-0.5*r2; // центр важнее края
  }
  let T;
  if(!color){
    let L=new Float32Array(N*N);
    const tb=new Float32Array(256).map((_,l)=>toneBW(l,lv));
    for(let i=0;i<N*N;i++){ const o=i*4; L[i]=mask[i]?tb[lightness255(data[o],data[o+1],data[o+2])|0]:1; }
    if(ALGO.sharpen>0){ // лёгкое повышение резкости: проявляет глаза и черты лица
      const bl=blur(L,N,Math.max(1,Math.round(N/100)));
      for(let i=0;i<N*N;i++) L[i]=Math.min(1,Math.max(0,L[i]+ALGO.sharpen*(L[i]-bl[i])));
    }
    for(let i=0;i<N*N;i++) L[i]=Math.pow(L[i],ALGO.gamma); // средние тона темнее — нитей в них больше
    T=L;
  }else{
    T=new Float32Array(N*N*3);
    const tc=new Float32Array(256).map((_,v)=>toneColor(v,lv));
    for(let i=0;i<N*N;i++){ const o=i*4;
      for(let k=0;k<3;k++) T[i*3+k]=mask[i]?tc[data[o+k]]:1; }
  }
  return {N,T,W,margin};
}

// ── Превью фото (то, к чему стремится генератор) ─────────────────────────────
const PREVIEW_MASK=insideMask(160,1.5);
// Перерисовка не чаще одного раза за кадр экрана — перетаскивание фото плавнее
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
  // уровни считаем по уменьшенной копии круга — быстро и так же, как для расчёта
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
  ctx.restore();
  ctx.strokeStyle='#ccc'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2); ctx.stroke();
}

function getOff(e){let r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
canvas.addEventListener('mousedown',e=>{if(!image||isGenerating)return;isDragging=true;let p=getOff(e);lastX=p.x;lastY=p.y;e.preventDefault();});
canvas.addEventListener('mousemove',e=>{if(!isDragging||!image||isGenerating)return;let p=getOff(e);imgX+=p.x-lastX;imgY+=p.y-lastY;lastX=p.x;lastY=p.y;drawPhoto();e.preventDefault();});
canvas.addEventListener('mouseup',()=>isDragging=false);
canvas.addEventListener('mouseleave',()=>isDragging=false);
canvas.addEventListener('wheel',e=>{
  if(!image||isGenerating)return;e.preventDefault();
  let f=e.deltaY<0?1.1:0.9,p=getOff(e);
  let dx=(p.x-imgX)/imgScale,dy=(p.y-imgY)/imgScale;
  imgScale=Math.max(0.1,Math.min(10,imgScale*f));
  imgX=p.x-dx*imgScale;imgY=p.y-dy*imgScale;drawPhoto();
},{passive:false});
canvas.addEventListener('touchstart',e=>{
  if(!image||isGenerating)return;e.preventDefault();
  touches=Array.from(e.targetTouches).map(t=>({x:t.clientX,y:t.clientY}));
  if(e.targetTouches.length===1){isDragging=true;lastX=touches[0].x;lastY=touches[0].y;}
},{passive:false});
canvas.addEventListener('touchmove',e=>{
  if(!image||isGenerating)return;e.preventDefault();
  let cur=Array.from(e.targetTouches).map(t=>({x:t.clientX,y:t.clientY}));
  if(cur.length===1&&isDragging){
    imgX+=cur[0].x-lastX;imgY+=cur[0].y-lastY;lastX=cur[0].x;lastY=cur[0].y;drawPhoto();
  }else if(cur.length===2&&touches.length===2){
    let d1=Math.hypot(touches[1].x-touches[0].x,touches[1].y-touches[0].y);
    let d2=Math.hypot(cur[1].x-cur[0].x,cur[1].y-cur[0].y);
    let f=d2/d1,r=canvas.getBoundingClientRect();
    let cx=(cur[0].x+cur[1].x)/2-r.left,cy=(cur[0].y+cur[1].y)/2-r.top;
    let dx=(cx-imgX)/imgScale,dy=(cy-imgY)/imgScale;
    imgScale=Math.max(0.1,Math.min(10,imgScale*f));
    imgX=cx-dx*imgScale;imgY=cy-dy*imgScale;
    imgX+=(cur[0].x+cur[1].x)/2-(touches[0].x+touches[1].x)/2;
    imgY+=(cur[0].y+cur[1].y)/2-(touches[0].y+touches[1].y)/2;
    drawPhoto();
  }
  touches=cur;
},{passive:false});
canvas.addEventListener('touchend',e=>{e.preventDefault();isDragging=false;touches=[];},{passive:false});


document.getElementById('file-input').addEventListener('change',function(){
  if(!this.files[0])return;
  this.style.pointerEvents='none';this.style.zIndex='-1';
  let img=new Image();
  img.onload=()=>{
    image=img;imgNatW=img.width;imgNatH=img.height;
    // фото заполняет круг целиком (можно сдвинуть и уменьшить пальцами)
    let s=(radius*2)/Math.min(img.width,img.height);
    imgScale=s;imgX=x0-img.width*s/2;imgY=y0-img.height*s/2;
    document.getElementById('canvas-hint').style.display='none';
    drawPhoto();
    document.getElementById('generate-btn').removeAttribute('disabled');
  };
  img.src=URL.createObjectURL(this.files[0]);
});

function setState(state){
  document.getElementById('state-ready').style.display  =state==='ready'  ?'block':'none';
  document.getElementById('state-running').style.display=state==='running'?'block':'none';
  document.getElementById('state-done').style.display   =state==='done'   ?'flex' :'none';
  document.getElementById('settings-block').style.display=state==='ready' ?'flex' :'none';
  document.getElementById('progress-block').style.display=state!=='ready'?'flex':'none';
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
      preview=CK.createPreview(P,p.nails,p.preview.threadPx,p.colors,p.preview.margin);
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
    // запасной вариант: считаем на странице
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

function startGenerate(){
  if(isGenerating||!image)return;
  saveSettings();
  isGenerating=true; sequence=[]; lastResult=null;
  setState('running');
  const color=mode==='color';
  const maxLines=Math.max(100,Math.min(20000,+document.getElementById('lines-count-box').value||3000));
  const interval=Math.max(10,+document.getElementById('color-interval-box').value||100);
  const {frameMm,threadMm}=physical();
  const tg=buildTarget();
  const P=canvas.width, pMargin=PADDING*dpr;
  // доля пикселя, которую закрывает одна нить: толщина нити / размер пикселя
  const alpha=Math.min(0.95, threadMm*(tg.N-2*tg.margin)/frameMm);
  const threadPx=threadMm*(P-2*pMargin)/frameMm;
  const palette=color?COLORS:[COLORS[BW_COLOR_INDEX]];
  const colorsLin=palette.map(c=>c.rgb.map(v=>CK.srgb2lin(v/255)));
  const allowed=color?activeColors.slice():[true];

  // счётчики по цветам
  const row=document.getElementById('color-progress-row');
  row.innerHTML='';
  const countEls=palette.map((c,i)=>{
    if(!allowed[i]) return null;
    const chip=document.createElement('div');
    chip.className='color-progress-chip';
    chip.style.background=c.hex+'22';
    chip.style.color=c.id==='W'?'#999':(c.id==='K'?'#aaa':c.hex);
    chip.style.border=`1px solid ${c.hex}44`;
    chip.innerHTML=`<div style="width:8px;height:8px;border-radius:50%;background:${c.hex};border:1px solid #444"></div><span>0</span>`;
    row.appendChild(chip);
    return chip.querySelector('span');
  });
  if(!color) row.innerHTML='';

  const t0=performance.now();
  document.getElementById('progress-bar').style.width='0%';
  document.getElementById('status-text').textContent='Подготовка…';

  worker=createWorker(e=>{
    const m=e.data; if(!isGenerating&&m.type!=='done') return;
    const el=(performance.now()-t0)/1000;
    if(m.rgba) showPreview(m.rgba);
    m.counts.forEach((n,i)=>{ if(countEls[i]) countEls[i].textContent=n; });
    if(m.type==='progress'){
      document.getElementById('progress-bar').style.width=Math.min(100,m.lines/maxLines*100)+'%';
      document.getElementById('status-text').textContent=`${m.lines} линий · ${fmtTime(el)}`+(color?` · смен нити: ${m.changes}`:'');
    }else if(m.type==='done'){
      finishGenerate(m,el,palette,color);
    }
  });
  worker.postMessage({cmd:'start',params:{
    size:tg.N, nails:NAILS_COUNT, channels:color?3:1, target:tg.T, weight:tg.W, margin:tg.margin,
    alpha, colors:colorsLin, allowed, blockSize:color?interval:1e9, maxLines,
    minGap:ALGO.minGap, negWeight:ALGO.negWeight,
    preview:{size:P, threadPx, margin:pMargin}
  }});
}
function stopGenerate(){
  if(!isGenerating||!worker) return;
  document.getElementById('status-text').textContent='Останавливаю…';
  worker.postMessage({cmd:'stop'});
}
function finishGenerate(m,el,palette,color){
  isGenerating=false;
  if(worker){ worker.terminate(); worker=null; }
  sequence=m.seq.map(([nail,ci])=>({nail, colorIndex: color?ci:BW_COLOR_INDEX}));
  lastResult=m;
  document.getElementById('progress-bar').style.width='100%';
  const why={auto:'картинка готова', limit:'достигнут лимит линий — можно увеличить', user:'остановлено'}[m.reason];
  document.getElementById('status-text').textContent=
    `✅ ${m.lines} линий за ${fmtTime(el)} · ${why}`+(color?` · смен нити: ${m.changes}`:'');
  setState(m.lines>0?'done':'ready');
}

function resetAll(){
  if(worker){ worker.terminate(); worker=null; }
  isGenerating=false; sequence=[]; lastResult=null;
  if(image)drawPhoto();else drawEmpty();
  document.getElementById('progress-bar').style.width='0%';
  document.getElementById('color-progress-row').innerHTML='';
  document.getElementById('status-text').textContent='';
  setState('ready');
}
function saveImage(){
  let a=document.createElement('a');
  a.href=canvas.toDataURL('image/png');
  a.download='stringart.png';a.click();
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
    localStorage.setItem('ck_from_generator',JSON.stringify({
      sequence,colors:COLORS,mode,
      image:pc.toDataURL('image/jpeg',0.7)
    }));
    window.location.href='index.html';
  }catch(e){alert('Ошибка: '+e.message);}
}
function setMode(m){
  mode=m;
  document.getElementById('btn-bw').classList.toggle('active',m==='bw');
  document.getElementById('btn-color').classList.toggle('active',m==='color');
  document.getElementById('filter-block').style.display=m==='bw'?'block':'none';
  document.getElementById('color-select-block').style.display=m==='color'?'block':'none';
  document.getElementById('interval-col').style.display=m==='color'?'block':'none';
  if(image)drawPhoto();
}
function setFilter(f){
  currentFilter=f;
  document.querySelectorAll('.filter-btn').forEach((b,i)=>{
    b.classList.toggle('active',['normal','hard','soft','silhouette'][i]===f);
  });
  if(image)drawPhoto();
}
function initColorChips(){
  const container=document.getElementById('color-chips');
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
document.getElementById('contrast-box').addEventListener('input',()=>{updateContrast();if(image)drawPhoto();});
document.getElementById('brightness-box').addEventListener('input',()=>{updateBrightness();if(image)drawPhoto();});
['frame-box','thread-box','lines-count-box','color-interval-box'].forEach(id=>
  document.getElementById(id).addEventListener('change',saveSettings));
requestAnimationFrame(()=>{
  loadSettings();
  initCanvas();updateContrast();updateBrightness();initColorChips();setState('ready');
});
