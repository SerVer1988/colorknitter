const NAIL_RADIUS=1, NAIL_COLOR='#000', PADDING=5, NAILS_COUNT=260;

// Вес одной линии — сколько яркости она "забирает" из пикселя
// При 3000 линиях и 260 гвоздях нужно ~40-60 чтобы хорошо покрыть тёмные области
const LINE_DARKNESS = 50;

const COLORS=[
  {id:'Y',name:'Жёлтый', short:'Жёл.',rgb:[255,220,  0],hex:'#ffdc00',textHex:'#b8870a'},
  {id:'C',name:'Голубой',short:'Гол.',rgb:[  0,183,235],hex:'#00b7eb',textHex:'#0077aa'},
  {id:'M',name:'Розовый',short:'Роз.',rgb:[255,  0,144],hex:'#ff0090',textHex:'#cc0070'},
  {id:'K',name:'Чёрный', short:'Чёр.',rgb:[  0,  0,  0],hex:'#000000',textHex:'#888888'},
  {id:'W',name:'Белый',  short:'Бел.',rgb:[255,255,255],hex:'#ffffff',textHex:'#999999'},
];

let canvas=document.getElementById('canvas'), ctx=canvas.getContext('2d');
let image=null, nails=[], sequence=[], isGenerating=false;
let mode='bw', currentFilter='normal', animFrame=null;
let imgX=0, imgY=0, imgScale=1, imgNatW=0, imgNatH=0;
let fakeCanvas=document.createElement('canvas'), fakeCtx=fakeCanvas.getContext('2d');
let pixelCanvas=document.createElement('canvas'), pixelCtx=pixelCanvas.getContext('2d');
let width, height, x0, y0, radius, dpr=window.devicePixelRatio||1;
let contrastTable=[], brightnessTable=[];
let touches=[], isDragging=false, lastX=0, lastY=0;
let lineCache=null, cacheBuilt=false;

const FILTERS={
  normal:    l=>l,
  hard:      l=>Math.max(0,Math.min(255,Math.round((l-128)*2.5+128))),
  soft:      l=>Math.round(l*0.6+50),
  silhouette:l=>l<128?0:255
};

function initCanvas(){
  const wrap=document.getElementById('canvas-wrap');
  const size=Math.min(wrap.clientWidth,400);
  width=size; height=size; x0=width/2; y0=height/2;
  radius=Math.min(width,height)/2-PADDING;
  canvas.width=width*dpr; canvas.height=height*dpr;
  canvas.style.width=width+'px'; canvas.style.height=height+'px';
  ctx.scale(dpr,dpr);
  fakeCanvas.width=width*dpr; fakeCanvas.height=height*dpr; fakeCtx.scale(dpr,dpr);
  pixelCanvas.width=width; pixelCanvas.height=height;
  drawEmpty();
}

function drawEmpty(){
  ctx.clearRect(0,0,width,height);
  ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill();
  ctx.strokeStyle='#ccc'; ctx.lineWidth=1; ctx.stroke();
}

function limitPixel(v){return Math.max(0,Math.min(255,Math.round(v)));}
function getLightness(r,g,b){return Math.floor(0.2126*r+0.7152*g+0.0722*b);}

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

// ── Кэш линий ────────────────────────────────────────────────────────────────
function buildLineCache(){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='cache-overlay';
    overlay.innerHTML=`<div class="cache-spinner"></div><div class="cache-text">Подготовка гвоздей…</div>`;
    document.getElementById('canvas-wrap').appendChild(overlay);
    requestAnimationFrame(()=>setTimeout(()=>{
      const N=NAILS_COUNT;
      lineCache=[];
      for(let i=0;i<N;i++) lineCache.push(new Array(N).fill(null));
      for(let i=0;i<N;i++){
        for(let j=i+1;j<N;j++){
          const px=rasterizeLine(nails[i].x,nails[i].y,nails[j].x,nails[j].y);
          lineCache[i][j]=px; lineCache[j][i]=px;
        }
      }
      cacheBuilt=true;
      overlay.remove();
      resolve();
    },50));
  });
}

function rasterizeLine(x1,y1,x2,y2){
  const pts=[];
  let dx=Math.abs(x2-x1),dy=Math.abs(y2-y1);
  let sx=Math.sign(x2-x1),sy=Math.sign(y2-y1),err=dx-dy;
  let cx=x1,cy=y1;
  while(cx!==x2||cy!==y2){
    if(cx>=0&&cx<width&&cy>=0&&cy<height) pts.push(cy*width+cx);
    let e2=err*2;
    if(e2>-dy){err-=dy;cx+=sx;} if(e2<dx){err+=dx;cy+=sy;}
  }
  if(x2>=0&&x2<width&&y2>=0&&y2<height) pts.push(y2*width+x2);
  return new Int32Array(pts);
}

// ── Пиксели изображения ───────────────────────────────────────────────────────
function getBWPixels(){
  pixelCtx.clearRect(0,0,width,height);
  pixelCtx.fillStyle='#fff'; pixelCtx.fillRect(0,0,width,height);
  pixelCtx.save();
  pixelCtx.beginPath(); pixelCtx.arc(x0,y0,radius,0,Math.PI*2); pixelCtx.clip();
  pixelCtx.drawImage(image,imgX,imgY,imgNatW*imgScale,imgNatH*imgScale);
  pixelCtx.restore();
  let data=pixelCtx.getImageData(0,0,width,height).data;
  let px=new Float32Array(width*height);
  for(let i=0;i<data.length;i+=4){
    let l=getLightness(data[i],data[i+1],data[i+2]);
    l=brightnessTable[l]; l=contrastTable[l]; l=FILTERS[currentFilter](l);
    const pi=i/4, px_x=pi%width, px_y=Math.floor(pi/width);
    // Снаружи круга — белый (255 = не рисовать)
    if((px_x-x0)**2+(px_y-y0)**2>radius**2) l=255;
    px[pi]=l;
  }
  return px;
}

function getColorPixelsRGB(){
  pixelCtx.clearRect(0,0,width,height);
  pixelCtx.fillStyle='#fff'; pixelCtx.fillRect(0,0,width,height);
  pixelCtx.save();
  pixelCtx.beginPath(); pixelCtx.arc(x0,y0,radius,0,Math.PI*2); pixelCtx.clip();
  pixelCtx.drawImage(image,imgX,imgY,imgNatW*imgScale,imgNatH*imgScale);
  pixelCtx.restore();
  const data=pixelCtx.getImageData(0,0,width,height).data;
  const rgb=new Float32Array(width*height*3);
  for(let i=0;i<width*height;i++){
    let r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    r=brightnessTable[r]; r=contrastTable[r];
    g=brightnessTable[g]; g=contrastTable[g];
    b=brightnessTable[b]; b=contrastTable[b];
    const px_x=i%width, px_y=Math.floor(i/width);
    if((px_x-x0)**2+(px_y-y0)**2>radius**2){r=g=b=255;}
    rgb[i*3]=r; rgb[i*3+1]=g; rgb[i*3+2]=b;
  }
  return rgb;
}

// ── Оценка линии: среднее значение пикселей ──────────────────────────────────
// Для ч/б: ищем линию с минимальной яркостью (самые тёмные пиксели)
// Нормализуем по длине чтобы не давать преимущество длинным линиям
function scoreBW(pixels, arr){
  let s=0;
  for(let k=0;k<arr.length;k++) s+=pixels[arr[k]];
  return s/arr.length;
}

// Для цвета: ищем линию где пиксели максимально похожи на нужный цвет
function scoreColor(rgb, arr, cr, cg, cb){
  let s=0;
  for(let k=0;k<arr.length;k++){
    const idx=arr[k]*3;
    const r=rgb[idx], g=rgb[idx+1], b=rgb[idx+2];
    // Инвертируем расстояние: чем ближе к цвету, тем меньше score (лучше)
    const dist=Math.sqrt((r-cr)**2+(g-cg)**2+(b-cb)**2);
    s+=dist;
  }
  return s/arr.length;
}

// ── Применение линии — убираем вклад из пиксельного буфера ───────────────────
function removeBW(pixels, arr){
  for(let k=0;k<arr.length;k++){
    pixels[arr[k]]=Math.min(255, pixels[arr[k]]+LINE_DARKNESS);
  }
}

function removeColor(rgb, arr, cr, cg, cb){
  // Сдвигаем пиксели от цвета нити к белому
  const shift=LINE_DARKNESS/255;
  for(let k=0;k<arr.length;k++){
    const idx=arr[k]*3;
    rgb[idx]  =Math.min(255, rgb[idx]  +(255-cr)*shift);
    rgb[idx+1]=Math.min(255, rgb[idx+1]+(255-cg)*shift);
    rgb[idx+2]=Math.min(255, rgb[idx+2]+(255-cb)*shift);
  }
}

// ── Touch/Mouse ───────────────────────────────────────────────────────────────
function drawPhoto(){
  if(!image)return;
  ctx.clearRect(0,0,width,height);
  ctx.save();
  ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill(); ctx.clip();
  let iw=imgNatW*imgScale, ih=imgNatH*imgScale;
  fakeCtx.clearRect(0,0,width,height);
  fakeCtx.drawImage(image,imgX,imgY,iw,ih);
  let data=fakeCtx.getImageData(0,0,width*dpr,height*dpr), px=data.data;
  let isColor=mode==='color';
  for(let i=0;i<px.length;i+=4){
    if(isColor){for(let c=0;c<3;c++){let v=px[i+c];v=brightnessTable[v];v=contrastTable[v];px[i+c]=v;}}
    else{let l=getLightness(px[i],px[i+1],px[i+2]);l=brightnessTable[l];l=contrastTable[l];l=FILTERS[currentFilter](l);px[i]=px[i+1]=px[i+2]=l;}
  }
  fakeCtx.putImageData(data,0,0);
  ctx.drawImage(fakeCanvas,0,0,width,height);
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
    let s=(radius*2)/Math.max(img.width,img.height);
    imgScale=s;imgX=x0-img.width*s/2;imgY=y0-img.height*s/2;
    document.getElementById('canvas-hint').style.display='none';
    drawPhoto();initNails();
    cacheBuilt=false;lineCache=null;
    document.getElementById('generate-btn').removeAttribute('disabled');
  };
  img.src=URL.createObjectURL(this.files[0]);
});

function initNails(){
  nails=[];
  for(let i=0;i<NAILS_COUNT;i++){
    let t=i*2*Math.PI/NAILS_COUNT;
    nails.push({x:Math.round(x0+radius*Math.cos(t)),y:Math.round(y0+radius*Math.sin(t))});
  }
}

function setState(state){
  document.getElementById('state-ready').style.display  =state==='ready'  ?'block':'none';
  document.getElementById('state-running').style.display=state==='running'?'block':'none';
  document.getElementById('state-done').style.display   =state==='done'   ?'flex' :'none';
  document.getElementById('settings-block').style.display=state==='ready' ?'flex' :'none';
  document.getElementById('progress-block').style.display=state==='running'?'flex':'none';
}
function updateProgress(done,total,t0){
  document.getElementById('progress-bar').style.width=Math.round(done/total*100)+'%';
  const el=((performance.now()-t0)/1000).toFixed(1);
  const rem=done>0?((performance.now()-t0)/done*(total-done)/1000).toFixed(1):'...';
  document.getElementById('status-text').textContent=`${done} / ${total} · ${el}с · ~${rem}с`;
}
function finishGenerate(t0){
  isGenerating=false;
  const el=((performance.now()-t0)/1000).toFixed(1);
  document.getElementById('status-text').textContent=`✅ Готово! ${sequence.length} линий за ${el}с`;
  setState('done');
}

async function startGenerate(){
  if(isGenerating||!image)return;
  isGenerating=true; sequence=[];
  setState('running');

  if(!cacheBuilt){
    document.getElementById('status-text').textContent='Подготовка…';
    await buildLineCache();
  }

  // Очищаем canvas
  ctx.clearRect(0,0,width,height);
  ctx.beginPath();ctx.arc(x0,y0,radius,0,Math.PI*2);
  ctx.fillStyle='#fff';ctx.fill();
  ctx.strokeStyle='#ccc';ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle=NAIL_COLOR;
  for(let n of nails){ctx.beginPath();ctx.arc(n.x,n.y,NAIL_RADIUS,0,Math.PI*2);ctx.fill();}

  const total=+document.getElementById('lines-count-box').value;
  const t0=performance.now();
  // Прозрачность линии на canvas — подбираем под LINE_DARKNESS
  // Чем меньше LINE_DARKNESS тем тоньше/прозрачнее линии
  const lineAlpha=Math.min(0.9, LINE_DARKNESS/255*2);

  if(mode==='bw'){
    document.getElementById('color-progress-row').innerHTML='';
    const pixels=getBWPixels();
    let nail=0;
    // Минимальная длина хорды — не рисуем соседние гвозди (меньше 5 позиций)
    const MIN_DIST=5;

    function runBW(){
      for(let b=0;b<25;b++){
        if(sequence.length>=total){finishGenerate(t0);return;}
        sequence.push({nail,colorIndex:3});

        let bestNail=-1, bestScore=Infinity;
        for(let i=0;i<NAILS_COUNT;i++){
          if(i===nail)continue;
          // Пропускаем слишком близкие гвозди
          const dist=Math.min(Math.abs(i-nail),NAILS_COUNT-Math.abs(i-nail));
          if(dist<MIN_DIST)continue;
          const sc=scoreBW(pixels,lineCache[nail][i]);
          if(sc<bestScore){bestScore=sc;bestNail=i;}
        }
        if(bestNail===-1)bestNail=(nail+NAILS_COUNT/2)%NAILS_COUNT;

        removeBW(pixels,lineCache[nail][bestNail]);

        ctx.lineWidth=0.3;
        ctx.strokeStyle=`rgba(0,0,0,${lineAlpha})`;
        ctx.beginPath();ctx.moveTo(nails[nail].x,nails[nail].y);
        ctx.lineTo(nails[bestNail].x,nails[bestNail].y);ctx.stroke();

        nail=bestNail;
      }
      updateProgress(sequence.length,total,t0);
      animFrame=requestAnimationFrame(runBW);
    }
    animFrame=requestAnimationFrame(runBW);

  }else{
    const interval=Math.max(10,+document.getElementById('color-interval-box').value||100);
    const rgb=getColorPixelsRGB();
    const colorTotals=COLORS.map((_,ci)=>{
      let s=0; const[cr,cg,cb]=COLORS[ci].rgb;
      const isK=cr===0&&cg===0&&cb===0;
      for(let i=0;i<width*height;i++){
        const r=rgb[i*3],g=rgb[i*3+1],b=rgb[i*3+2];
        if(isK) s+=1-getLightness(r,g,b)/255;
        else{ const dist=Math.sqrt((r-cr)**2+(g-cg)**2+(b-cb)**2); s+=1-dist/(255*Math.sqrt(3)); }
      }
      return s;
    });
    const grandTotal=colorTotals.reduce((a,b)=>a+b,0);
    const colorQuotas=colorTotals.map(t=>Math.round(t/grandTotal*total));
    let diff=total-colorQuotas.reduce((a,b)=>a+b,0); colorQuotas[0]+=diff;
    const colorOrder=[0,1,2,3,4].sort((a,b)=>colorTotals[b]-colorTotals[a]);
    const nailPos=new Array(5).fill(0);
    const colorCounts=new Array(5).fill(0);
    let currentColorOrderIdx=0,stepsInCurrentColor=0,currentCi=colorOrder[0];
    const MIN_DIST=5;

    const colorProgressRow=document.getElementById('color-progress-row');
    colorProgressRow.innerHTML='';
    const countEls=COLORS.map((c,i)=>{
      const chip=document.createElement('div');
      chip.className='color-progress-chip';
      chip.style.background=c.hex+'22';
      chip.style.color=c.id==='W'?'#999':(c.id==='K'?'#aaa':c.hex);
      chip.style.border=`1px solid ${c.hex}44`;
      chip.innerHTML=`<div style="width:8px;height:8px;border-radius:50%;background:${c.hex};border:1px solid #444"></div><span id="cnt-${c.id}">0/${colorQuotas[i]}</span>`;
      colorProgressRow.appendChild(chip);
      return document.getElementById('cnt-'+c.id);
    });

    function runColor(){
      for(let b=0;b<12;b++){
        if(sequence.length>=total){finishGenerate(t0);return;}
        if(stepsInCurrentColor>=interval){
          stepsInCurrentColor=0;
          currentColorOrderIdx=(currentColorOrderIdx+1)%colorOrder.length;
          currentCi=colorOrder[currentColorOrderIdx];
        }
        const ci=currentCi;
        const nail=nailPos[ci];
        const[cr,cg,cb]=COLORS[ci].rgb;

        let bestNail=-1, bestScore=Infinity;
        for(let i=0;i<NAILS_COUNT;i++){
          if(i===nail)continue;
          const dist=Math.min(Math.abs(i-nail),NAILS_COUNT-Math.abs(i-nail));
          if(dist<MIN_DIST)continue;
          const sc=scoreColor(rgb,lineCache[nail][i],cr,cg,cb);
          if(sc<bestScore){bestScore=sc;bestNail=i;}
        }
        if(bestNail===-1)bestNail=(nail+NAILS_COUNT/2)%NAILS_COUNT;

        removeColor(rgb,lineCache[nail][bestNail],cr,cg,cb);

        ctx.lineWidth=0.3;
        ctx.strokeStyle=`rgba(${cr},${cg},${cb},${lineAlpha})`;
        ctx.beginPath();ctx.moveTo(nails[nail].x,nails[nail].y);
        ctx.lineTo(nails[bestNail].x,nails[bestNail].y);ctx.stroke();

        sequence.push({nail,colorIndex:ci});
        nailPos[ci]=bestNail; colorCounts[ci]++; stepsInCurrentColor++;
        countEls[ci].textContent=`${colorCounts[ci]}/${colorQuotas[ci]}`;
      }
      updateProgress(sequence.length,total,t0);
      animFrame=requestAnimationFrame(runColor);
    }
    animFrame=requestAnimationFrame(runColor);
  }
}

function resetAll(){
  if(animFrame)cancelAnimationFrame(animFrame);
  isGenerating=false;sequence=[];
  if(image)drawPhoto();else drawEmpty();
  document.getElementById('progress-bar').style.width='0%';
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
    pc.width=width;pc.height=height;
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
  COLORS.forEach(c=>{
    const chip=document.createElement('div');
    chip.className='color-chip active';
    chip.style.color=c.textHex;chip.style.borderColor=c.hex;
    chip.innerHTML=`<div class="color-dot" style="background:${c.hex};border:1px solid #333"></div>${c.short}`;
    container.appendChild(chip);
  });
}
document.getElementById('contrast-box').addEventListener('input',()=>{updateContrast();if(image)drawPhoto();});
document.getElementById('brightness-box').addEventListener('input',()=>{updateBrightness();if(image)drawPhoto();});
requestAnimationFrame(()=>{
  initCanvas();updateContrast();updateBrightness();initNails();initColorChips();setState('ready');
});
