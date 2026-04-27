<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ColorKnitter</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f3f4f6; font-family: Arial, sans-serif; display: flex; justify-content: center; padding: 12px; }
    #root { width: 100%; max-width: 440px; }

    .card { background: white; border-radius: 16px; padding: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
    .status { text-align: center; font-size: 13px; font-weight: 500; margin-bottom: 8px; color: #374151; }

    canvas { border: 1px solid #d1d5db; border-radius: 12px; display: block; }

    .steps-row { display: flex; justify-content: center; align-items: center; gap: 8px; margin: 10px 0; }
    .step-item { text-align: center; font-weight: bold; transition: font-size 0.15s; }

    .nav-row { display: flex; justify-content: center; align-items: center; gap: 16px; margin: 4px 0; }
    .btn { cursor: pointer; border: none; border-radius: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s; }
    .btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .btn:active:not(:disabled) { opacity: 0.7; }
    .btn-nav { width: 64px; height: 64px; background: white; border: 1.5px solid #d1d5db; font-size: 28px; color: #374151; }
    .btn-nav:hover:not(:disabled) { background: #f9fafb; }
    .btn-play { width: 112px; height: 64px; font-size: 20px; background: #2563eb; color: white; }
    .btn-play.pause { background: #dc2626; }
    .btn-play:hover:not(:disabled) { filter: brightness(1.1); }

    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 10px 0; }

    .btn-toggle { width: 100%; background: none; border: none; cursor: pointer; font-size: 12px; color: #6b7280; display: flex; justify-content: space-between; align-items: center; padding: 4px 2px; }
    .btn-toggle:hover { color: #374151; }

    .settings { display: flex; flex-direction: column; gap: 14px; margin-top: 4px; }

    .setting-row { display: flex; flex-direction: column; gap: 4px; }
    .setting-label { font-size: 13px; color: #374151; display: flex; justify-content: space-between; }
    input[type=range] { width: 100%; accent-color: #2563eb; }

    .toggle-switch-row { display: flex; justify-content: space-between; align-items: center; }
    .toggle-switch { position: relative; width: 40px; height: 24px; }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .toggle-slider { position: absolute; inset: 0; background: #d1d5db; border-radius: 999px; cursor: pointer; transition: background 0.2s; }
    .toggle-slider:before { content: ''; position: absolute; width: 16px; height: 16px; left: 4px; top: 4px; background: white; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: transform 0.2s; }
    input:checked + .toggle-slider { background: #3b82f6; }
    input:checked + .toggle-slider:before { transform: translateX(16px); }

    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .input-label { font-size: 13px; color: #374151; margin-bottom: 4px; display: block; }
    input[type=number] { width: 100%; border: 1.5px solid #d1d5db; border-radius: 8px; padding: 6px; text-align: center; font-size: 15px; outline: none; }
    input[type=number]:focus { border-color: #2563eb; }

    .btn-full { width: 100%; padding: 10px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; }
    .btn-outline { background: white; border: 1.5px solid #d1d5db; color: #374151; }
    .btn-outline:hover { background: #f9fafb; }
    .btn-primary { background: #2563eb; color: white; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-secondary { background: #f3f4f6; color: #374151; }
    .btn-secondary:hover { background: #e5e7eb; }
    .btn-row { display: flex; gap: 8px; }
    .btn-row .btn-full { flex: 1; }

    .saved-list { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
    .saved-item { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; font-size: 12px; }
    .saved-item-top { display: flex; justify-content: space-between; color: #6b7280; margin-bottom: 6px; }
    .saved-item-btns { display: flex; justify-content: flex-end; gap: 8px; }
    .btn-sm { padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; }
    .btn-sm-outline { background: white; border: 1px solid #d1d5db; color: #374151; }
    .btn-sm-danger { background: #dc2626; color: white; }

    .opacity-row { display: flex; align-items: center; gap: 10px; }
    .opacity-label { font-size: 12px; color: #6b7280; white-space: nowrap; }
    .opacity-val { font-size: 12px; color: #6b7280; width: 32px; text-align: right; }
  </style>
</head>
<body>
<div id="root"></div>

<script type="text/babel">
const { useState, useEffect, useRef } = React;

function ColorKnitter() {
  const [sequence, setSequence] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(2.5);
  const [targetSteps, setTargetSteps] = useState(0);
  const [findStep, setFindStep] = useState(1);
  const [savedStates, setSavedStates] = useState([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [remainingSteps, setRemainingSteps] = useState(0);
  const [showNextLine, setShowNextLine] = useState(false);
  const [circleImage, setCircleImage] = useState(null);
  const [imageOpacity, setImageOpacity] = useState(0.55);
  const [showSaved, setShowSaved] = useState(false);

  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const canvasRef = useRef(null);
  const playIntervalRef = useRef(null);
  const stepCountRef = useRef(0);
  const timerRef = useRef(null);
  const goalReachedRef = useRef(false);
  const loadedImgRef = useRef(null);
  const sequenceRef = useRef(sequence);
  const currentIndexRef = useRef(currentIndex);
  sequenceRef.current = sequence;
  currentIndexRef.current = currentIndex;

  const fmt = (s) => {
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sc = s%60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
  };

  useEffect(() => {
    try { const s = localStorage.getItem('colorKnitterStates'); if (s) setSavedStates(JSON.parse(s)); } catch(_) {}
  }, []);

  useEffect(() => {
    if (isPlaying) { timerRef.current = setInterval(() => setElapsedTime(p => p+1), 1000); }
    else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [isPlaying]);

  const moveSteps = (steps) => {
    setCurrentIndex(prev => {
      const next = Math.max(0, Math.min(sequenceRef.current.length-1, prev+steps));
      speak(sequenceRef.current[next]);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!sequenceRef.current.length) return;
      if (e.key==='ArrowRight'&&!e.ctrlKey){e.preventDefault();moveSteps(1);}
      else if(e.key==='ArrowLeft'&&!e.ctrlKey){e.preventDefault();moveSteps(-1);}
      else if(e.key==='ArrowRight'&&e.ctrlKey){e.preventDefault();moveSteps(3);}
      else if(e.key==='ArrowLeft'&&e.ctrlKey){e.preventDefault();moveSteps(-3);}
      else if(e.key===' '){e.preventDefault();setIsPlaying(p=>!p);}
      else if(e.key==='ArrowUp'){e.preventDefault();setSpeedMultiplier(p=>Math.min(5,p+0.5));}
      else if(e.key==='ArrowDown'){e.preventDefault();setSpeedMultiplier(p=>Math.max(1,p-0.5));}
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const getSector = (n) => { if(!n)return''; if(n<=65)return'D'; if(n<=130)return'C'; if(n<=195)return'A'; return'B'; };
  const getPos = (n) => { if(!n)return 0; const b={D:1,C:66,A:131,B:196}; return n-b[getSector(n)]+1; };
  const getAngle = (sec,pos) => { const b={A:Math.PI,B:Math.PI*1.5,C:Math.PI*0.5,D:0}; return b[sec]+(pos-1)*(Math.PI*0.5/65); };
  const colorName = ([r,g,b]) => {
    if(r===0&&g===0&&b===0)return'чёрный';
    if(r===255&&g===255&&b===255)return'белый';
    if(r===0&&g===0&&b===255)return'синий';
    if(r===255&&g===255&&b===0)return'жёлтый';
    if(r===0&&g===255&&b===255)return'голубой';
    return'розовый';
  };
  const speak = (item) => {
    if(!item)return;
    const t = item.isColorChange ? `${colorName(item.color)}, ${getSector(item.value)}${getPos(item.value)}` : `${getSector(item.value)}${getPos(item.value)}`;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); u.lang='ru-RU';
    window.speechSynthesis.speak(u);
  };

  const parseFile = (text) => {
    const lines = text.split('\n'); const temp=[]; let color=[0,0,0],hasZero=false;
    lines.forEach(line => {
      line=line.trim(); if(!line)return;
      if(line.startsWith('Thread:')){const m=line.match(/\[(\d+),\s*(\d+),\s*(\d+)\]/);if(m)color=[+m[1],+m[2],+m[3]];}
      else{
        const nums=line.split(/[\s,]+/).map(Number).filter(n=>!isNaN(n));
        if(nums.some(n=>n===0))hasZero=true;
        nums.forEach(n=>temp.push({value:hasZero?n+1:n,color:[...color],isColorChange:temp.length>0&&!temp[temp.length-1].color.every((c,i)=>c===color[i])}));
      }
    });
    return temp;
  };

  const handleFileUpload = async (e) => {
    const file=e.target.files[0]; if(!file)return;
    const text=await file.text(); const seq=parseFile(text);
    setSequence(seq); setCurrentIndex(0); setIsPlaying(false);
    setRemainingSteps(targetSteps); setElapsedTime(0);
    stepCountRef.current=0; goalReachedRef.current=false;
    if(seq.length>0)speak(seq[0]);
  };

  const handleImageUpload = (e) => {
    const file=e.target.files[0]; if(!file)return;
    const r=new FileReader();
    r.onload=(ev)=>{const img=new Image();img.onload=()=>{loadedImgRef.current=img;setCircleImage(ev.target.result);};img.src=ev.target.result;};
    r.readAsDataURL(file);
  };

  const saveProgress = () => {
    const s={id:Date.now(),currentIndex,findStep,targetSteps,remainingSteps,elapsedTime,sequenceLength:sequence.length,timestamp:new Date().toISOString()};
    const updated=[s,...savedStates].slice(0,20);
    setSavedStates(updated);
    try{localStorage.setItem('colorKnitterStates',JSON.stringify(updated));}catch(_){}
  };

  const loadProgress = (s) => {
    setCurrentIndex(s.currentIndex); setFindStep(s.findStep||1);
    setTargetSteps(s.targetSteps); setRemainingSteps(s.remainingSteps);
    setElapsedTime(s.elapsedTime||0); setIsPlaying(false);
    stepCountRef.current=s.targetSteps-s.remainingSteps; goalReachedRef.current=false;
  };

  const deleteSaved = (id) => {
    const updated=savedStates.filter(s=>s.id!==id);
    setSavedStates(updated);
    try{localStorage.setItem('colorKnitterStates',JSON.stringify(updated));}catch(_){}
  };

  const stopAutoPlay = () => { if(playIntervalRef.current){clearInterval(playIntervalRef.current);playIntervalRef.current=null;} };

  const checkGoal = () => {
    if(targetSteps>0){
      stepCountRef.current+=1;
      setRemainingSteps(targetSteps-stepCountRef.current);
      if(stepCountRef.current>=targetSteps){
        setIsPlaying(false);stopAutoPlay();goalReachedRef.current=true;
        window.speechSynthesis.speak(new SpeechSynthesisUtterance("Цель выполнена!"));
      }
    }
  };

  const startAutoPlay = () => {
    if(playIntervalRef.current)return;
    if(goalReachedRef.current&&targetSteps>0){stepCountRef.current=0;setRemainingSteps(targetSteps);goalReachedRef.current=false;}
    const delay=(6-speedMultiplier)/1.1*1000;
    playIntervalRef.current=setInterval(()=>{
      setCurrentIndex(prev=>{
        const next=prev+1;
        if(next>=sequenceRef.current.length){setIsPlaying(false);stopAutoPlay();return prev;}
        if(sequenceRef.current[next].isColorChange){setIsPlaying(false);stopAutoPlay();}
        checkGoal(); speak(sequenceRef.current[next]);
        return next;
      });
    },delay);
  };

  useEffect(()=>{
    if(isPlaying){if(sequence[currentIndex])speak(sequence[currentIndex]);startAutoPlay();}
    else stopAutoPlay();
    return stopAutoPlay;
  },[isPlaying,speedMultiplier]);

  const rgbHex = (c) => '#'+c.map(v=>v.toString(16).padStart(2,'0')).join('');
  const dimColor = (c,f=0.7) => c.map(v=>Math.floor(v+(255-v)*(1-f)));
  const strokeFor = ([r,g,b]) => (r===0&&g===0&&b===0)?'white':'black';
  const stepLabel = (item) => item?`${getSector(item.value)}${getPos(item.value)}`:'';

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return;
    const vw=Math.min(window.innerWidth,420);
    canvas.width=vw-24; canvas.height=canvas.width;
    const ctx=canvas.getContext('2d');
    const w=canvas.width,h=canvas.height,cx=w/2,cy=h/2;
    const radius=Math.min(w,h)/2-10;

    ctx.fillStyle='#f5f5f5'; ctx.fillRect(0,0,w,h);
    ctx.beginPath(); ctx.arc(cx,cy,radius+5,0,2*Math.PI); ctx.fillStyle='white'; ctx.fill();

    // Lines (background)
    if(sequence.length>0){
      ctx.globalAlpha=0.7;
      for(let i=0;i<currentIndex;i++){
        if(i>=sequence.length-1)break;
        const a1=getAngle(getSector(sequence[i].value),getPos(sequence[i].value));
        const a2=getAngle(getSector(sequence[i+1].value),getPos(sequence[i+1].value));
        ctx.beginPath(); ctx.strokeStyle=rgbHex(dimColor(sequence[i+1].color,0.6)); ctx.lineWidth=0.2;
        ctx.moveTo(cx+radius*Math.cos(a1),cy+radius*Math.sin(a1));
        ctx.lineTo(cx+radius*Math.cos(a2),cy+radius*Math.sin(a2)); ctx.stroke();
      }
      ctx.globalAlpha=1;

      if(currentIndex>0){
        const a1=getAngle(getSector(sequence[currentIndex-1].value),getPos(sequence[currentIndex-1].value));
        const a2=getAngle(getSector(sequence[currentIndex].value),getPos(sequence[currentIndex].value));
        const x1=cx+radius*Math.cos(a1),y1=cy+radius*Math.sin(a1);
        const x2=cx+radius*Math.cos(a2),y2=cy+radius*Math.sin(a2);
        ctx.beginPath(); ctx.strokeStyle='black'; ctx.lineWidth=2;
        ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        const ang=Math.atan2(y2-y1,x2-x1),al=10,aw=Math.PI/7;
        ctx.beginPath();
        ctx.moveTo(x2,y2);
        ctx.lineTo(x2-al*Math.cos(ang-aw),y2-al*Math.sin(ang-aw));
        ctx.lineTo(x2-al*Math.cos(ang+aw),y2-al*Math.sin(ang+aw));
        ctx.closePath(); ctx.fillStyle='black'; ctx.fill();
      }

      if(showNextLine&&currentIndex<sequence.length-1){
        const a1=getAngle(getSector(sequence[currentIndex].value),getPos(sequence[currentIndex].value));
        const a2=getAngle(getSector(sequence[currentIndex+1].value),getPos(sequence[currentIndex+1].value));
        ctx.beginPath(); ctx.strokeStyle='#3b82f6'; ctx.lineWidth=2; ctx.setLineDash([6,4]);
        ctx.moveTo(cx+radius*Math.cos(a1),cy+radius*Math.sin(a1));
        ctx.lineTo(cx+radius*Math.cos(a2),cy+radius*Math.sin(a2)); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // Photo (foreground)
    if(circleImage&&imageOpacity>0&&loadedImgRef.current){
      const img=loadedImgRef.current;
      const scale=(radius*2)/Math.min(img.width,img.height);
      const dw=img.width*scale,dh=img.height*scale;
      ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,radius,0,2*Math.PI); ctx.clip();
      ctx.globalAlpha=imageOpacity; ctx.drawImage(img,cx-dw/2,cy-dh/2,dw,dh);
      ctx.globalAlpha=1; ctx.restore();
    }

    ctx.beginPath(); ctx.arc(cx,cy,radius,0,2*Math.PI); ctx.strokeStyle='#808080'; ctx.lineWidth=1; ctx.stroke();

    const fs=Math.floor(w/10);
    ctx.font=`bold ${fs}px Arial`; ctx.textAlign='center'; ctx.textBaseline='middle';
    const lo=Math.min(w,h)/2.2;
    [{l:'A',x:cx-lo,y:cy-lo},{l:'B',x:cx+lo,y:cy-lo},{l:'C',x:cx-lo,y:cy+lo},{l:'D',x:cx+lo,y:cy+lo}]
      .forEach(({l,x,y})=>{ ctx.strokeStyle='white';ctx.lineWidth=3;ctx.strokeText(l,x,y); ctx.fillStyle='black';ctx.fillText(l,x,y); });

    if(sequence[currentIndex]){
      const a=getAngle(getSector(sequence[currentIndex].value),getPos(sequence[currentIndex].value));
      ctx.beginPath();
      ctx.moveTo(cx+radius*Math.cos(a),cy+radius*Math.sin(a));
      ctx.lineTo(cx+(radius+10)*Math.cos(a),cy+(radius+10)*Math.sin(a));
      ctx.strokeStyle='#ff0000'; ctx.lineWidth=2; ctx.stroke();
    }
  },[currentIndex,sequence,showNextLine,circleImage,imageOpacity]);

  const renderSteps = () => {
    if(!sequence.length)return null;
    const total=5,prev=2;
    let start=Math.max(0,currentIndex-prev);
    let end=Math.min(sequence.length-1,start+total-1);
    if(end-start<total-1)start=Math.max(0,end-total+1);
    const steps=[];
    for(let i=start;i<=end;i++)steps.push({i,item:sequence[i],cur:i===currentIndex});
    return(
      <div className="steps-row">
        {steps.map(({i,item,cur})=>(
          <div key={i} className="step-item"
            style={{color:rgbHex(item.color),WebkitTextStroke:`0.5px ${strokeFor(item.color)}`,fontSize:cur?'2.4rem':'1.4rem',minWidth:cur?64:44}}>
            {stepLabel(item)}
          </div>
        ))}
      </div>
    );
  };

  const statusText = () => {
    if(!sequence.length)return'';
    let t=`${currentIndex+1}/${sequence.length} (${Math.round((currentIndex+1)/sequence.length*100)}%)`;
    if(targetSteps>0)t+=` | Цель: ${remainingSteps}`;
    t+=` | ${fmt(elapsedTime)}`;
    return t;
  };

  return(
    <div className="card">
      <div className="status">{statusText()}</div>

      <div style={{display:'flex',justifyContent:'center'}}>
        <canvas ref={canvasRef} />
      </div>

      {renderSteps()}

      <div className="nav-row">
        <button className="btn btn-nav" onClick={()=>moveSteps(-1)} disabled={currentIndex<=0}>&#8592;</button>
        <button className={`btn btn-play${isPlaying?' pause':''}`} onClick={()=>setIsPlaying(p=>!p)} disabled={!sequence.length}>
          {isPlaying?'Пауза':'Старт'}
        </button>
        <button className="btn btn-nav" onClick={()=>moveSteps(1)} disabled={currentIndex>=sequence.length-1}>&#8594;</button>
      </div>

      <hr className="divider" />

      <button className="btn-toggle" onClick={()=>setIsMenuOpen(v=>!v)}>
        <span>Дополнительные настройки</span>
        <span>{isMenuOpen?'▲':'▼'}</span>
      </button>

      {isMenuOpen&&(
        <div className="settings">

          <div className="setting-row">
            <span className="setting-label"><span>Скорость:</span><span>{speedMultiplier}x</span></span>
            <input type="range" min="1" max="5" step="0.5" value={speedMultiplier} onChange={e=>setSpeedMultiplier(Number(e.target.value))} />
          </div>

          <div className="toggle-switch-row">
            <span style={{fontSize:13}}>Линия следующего хода:</span>
            <label className="toggle-switch">
              <input type="checkbox" checked={showNextLine} onChange={e=>setShowNextLine(e.target.checked)} />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="setting-row">
            <input ref={imageInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleImageUpload} />
            <button className="btn-full btn-outline" onClick={()=>imageInputRef.current.click()}>🖼️ Загрузить фото</button>
            {circleImage&&(
              <div className="opacity-row" style={{marginTop:6}}>
                <span className="opacity-label">Прозрачность:</span>
                <input type="range" min="0" max="1" step="0.05" value={imageOpacity} onChange={e=>setImageOpacity(Number(e.target.value))} style={{flex:1}} />
                <span className="opacity-val">{Math.round(imageOpacity*100)}%</span>
              </div>
            )}
          </div>

          <div className="grid2">
            <div>
              <span className="input-label">Цель (шагов):</span>
              <input type="number" value={targetSteps} min={0} onChange={e=>{const v=Number(e.target.value);setTargetSteps(v);stepCountRef.current=0;setRemainingSteps(v);goalReachedRef.current=false;}} />
            </div>
            <div>
              <span className="input-label">Перейти к шагу:</span>
              <input type="number" value={findStep} min={1} max={sequence.length||1} onChange={e=>{const v=Number(e.target.value);if(v>=1&&v<=sequence.length){setFindStep(v);setCurrentIndex(v-1);speak(sequence[v-1]);}}} />
            </div>
          </div>

          <div className="btn-row">
            <input ref={fileInputRef} type="file" accept=".txt" style={{display:'none'}} onChange={handleFileUpload} />
            <button className="btn-full btn-primary" onClick={()=>fileInputRef.current.click()}>📂 Загрузить файл</button>
            <button className="btn-full btn-outline" onClick={saveProgress} disabled={!sequence.length}>💾 Сохранить</button>
          </div>

          <button className="btn-full btn-secondary" onClick={()=>setShowSaved(v=>!v)}>
            {showSaved?'Скрыть сохранённые':'Показать сохранённые'} ({savedStates.length})
          </button>

          {showSaved&&(
            <div className="saved-list">
              {savedStates.length===0&&<div style={{fontSize:13,color:'#6b7280',textAlign:'center'}}>Нет сохранений</div>}
              {savedStates.map(s=>(
                <div key={s.id} className="saved-item">
                  <div className="saved-item-top">
                    <span>{new Date(s.timestamp).toLocaleString()}</span>
                    <span>Шаг {s.currentIndex+1}/{s.sequenceLength||'?'}{s.autoSaved&&' ✅'}</span>
                  </div>
                  <div className="saved-item-btns">
                    <button className="btn-sm btn-sm-outline" onClick={()=>loadProgress(s)}>Загрузить</button>
                    <button className="btn-sm btn-sm-danger" onClick={()=>deleteSaved(s.id)}>Удалить</button>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ColorKnitter />);
</script>
</body>
</html>
