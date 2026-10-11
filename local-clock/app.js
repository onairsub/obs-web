/* Browser camera/ROI input; only cropped frames are sent to the local Python process. */
const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="local-token"]').content;
const video = $('video'), display = $('display'), selection = $('selection'), crop = $('crop');
let media = null, active = false, enabled = false, connected = false, modelReady = false;
let generation = 0, clockOffset = null, inference = null, age = null, sourceEpoch = 0;
const clockKeys=['OBS_BASKETBALL_SHOT_CLOCK','OBS_BASKETBALL_GAME_CLOCK'];
const suffix=key=>key.includes('SHOT')?'Shot':'Game';
const label=key=>key.includes('SHOT')?'샷클락':'게임클락';
function clockText(clock,reading) {
  if(!clock) return '—';
  const tenths=reading?.resolution_ms===100,units=Math.ceil(Math.max(0,clock.seconds)*(tenths?10:1));
  const seconds=tenths?Math.floor(units/10):units,end=tenths?`.${units%10}`:'';
  return reading?.text.includes(':')?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}${end}`:`${seconds}${end}`;
}
let rois={},roi=null,dragging=null,lastVideoTime=-1,sourceCaptured=0;
let busy=false,cameraCaptured=null,cameraFrame=0,lastCameraFrame=-1;
const cameraCanvas=document.createElement('canvas'),snapshotCanvas=document.createElement('canvas'),inputCanvas=document.createElement('canvas');
const validRoi=r=>r && ['x','y','w','h'].every(k=>Number.isFinite(r[k])) && r.w>0 && r.h>0 && r.x>=0 && r.y>=0 && r.x+r.w<=1 && r.y+r.h<=1;
try {
  rois=JSON.parse(localStorage.getItem('clock-reader-rois'))||{};
  const legacy=JSON.parse(localStorage.getItem('clock-reader-roi'));
  if(!rois[clockKeys[0]] && validRoi(legacy)) rois[clockKeys[0]]=legacy;
} catch {rois={};}
for(const key of clockKeys) if(!validRoi(rois[key])) delete rois[key];
roi=rois[$('target').value]||null;
function clearReadouts() {
  for(const key of clockKeys) { $('reading'+suffix(key)).textContent='—';$('confidence'+suffix(key)).textContent='확정값 확인 중'; }
}
const error = (message = '') => { $('error').textContent = message; $('error').hidden = !message; };
async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, {...options, headers: {'X-Local-Token': token, ...options.headers}}); }
  catch { throw new Error('로컬 프로그램 연결이 끊겼습니다. 터미널에서 pnpm clock:reader를 실행한 뒤 이 화면을 새로고침하세요.'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(typeof result.detail==='string'?result.detail:`입력값을 확인하세요 (${response.status})`);
  }
  return response;
}
async function post(path, body) {
  return (await api(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})).json();
}
function options(arm = enabled) {
  return {enabled:arm, key:$('target').value, keys:clockKeys.filter(key=>rois[key]).length?clockKeys.filter(key=>rois[key]):[$('target').value], mode:$('mode').value, shot_maximum:Number($('shotMaximum').value),game_maximum:Number($('gameMaximum').value),
    compensation_seconds:Number($('compensation').value),
    minimum_confidence:Number($('threshold').value),  preprocessing:$('preprocessing').value, reader:$('reader').value};
}
function syncUI() {
  $('toggle').textContent = enabled ? '동기화 중지' : '동기화 시작';
  $('toggle').classList.toggle('running', enabled);
  $('toggle').disabled = busy || !active || !clockKeys.some(key=>rois[key]) || !connected || !modelReady;
  if (enabled) $('toggle').disabled = busy;
  $('syncBadge').textContent = enabled ? '동기화 켜짐' : '미리보기';
  $('reacquire').disabled = busy || !active || !roi || !modelReady;
}
async function configure(arm = false) {
  const result = await post('/api/settings', options(arm));
  generation = result.generation; enabled = arm; syncUI();
  clearReadouts();
}
function saveRoi() {
  if (!roi) return;
  rois[$('target').value]=roi;localStorage.setItem('clock-reader-rois',JSON.stringify(rois));
  ['X','Y','W','H'].forEach(k => $('roi'+k).value = (roi[k.toLowerCase()] * 100).toFixed(1));
}
function drawRoi() {
  const rect=selection.getBoundingClientRect();
  selection.width=rect.width*devicePixelRatio;selection.height=rect.height*devicePixelRatio;
  const ctx=selection.getContext('2d'),w=selection.width,h=selection.height;
  const visible={...rois,[$('target').value]:roi};
  ctx.fillStyle='#050b1580';ctx.fillRect(0,0,w,h);
  for(const key of clockKeys) {
    const r=visible[key];if(!r) continue;
    ctx.clearRect(r.x*w,r.y*h,r.w*w,r.h*h);
    ctx.strokeStyle=key.includes('SHOT')?'#68efb8':'#70baff';ctx.lineWidth=2*devicePixelRatio;
    ctx.strokeRect(r.x*w,r.y*h,r.w*w,r.h*h);
    ctx.fillStyle=ctx.strokeStyle;ctx.font=`${13*devicePixelRatio}px sans-serif`;
    ctx.fillText(label(key),r.x*w+5*devicePixelRatio,Math.max(16*devicePixelRatio,r.y*h-6*devicePixelRatio));
  }
}
$('target').onchange=()=>{
  roi=rois[$('target').value]||null;
  if(roi) saveRoi();
  drawRoi();syncUI();$('rawReading').textContent=label($('target').value)+' 영역을 선택하거나 드래그하세요.';
};
$('clearRoi').onclick=async()=>{
  try {await configure(false);delete rois[$('target').value];roi=null;localStorage.setItem('clock-reader-rois',JSON.stringify(rois));drawRoi();syncUI();}catch(e){error(e.message);}
};
function point(event) {
  const rect = selection.getBoundingClientRect();
  return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
}
selection.addEventListener('pointerdown', async (event) => {
  if (!active || busy) return;
  dragging = point(event); selection.setPointerCapture(event.pointerId);
  enabled = false; syncUI();
  try { await configure(false); } catch (e) { error(e.message); }
});
selection.addEventListener('pointermove', event => {
  if (!dragging) return;
  const p = point(event);
  roi = {x:Math.min(p.x,dragging.x),y:Math.min(p.y,dragging.y),w:Math.abs(p.x-dragging.x),h:Math.abs(p.y-dragging.y)};
  drawRoi();
});
function finishSelection() {
  if (!dragging) return;
  dragging = null;
  if (roi && (roi.w < .02 || roi.h < .02)) roi = null;
  if(!roi) {delete rois[$('target').value];localStorage.setItem('clock-reader-rois',JSON.stringify(rois));}
  saveRoi(); drawRoi(); syncUI();
}
selection.addEventListener('pointerup', finishSelection);
selection.addEventListener('pointercancel', finishSelection);
new ResizeObserver(drawRoi).observe($('stage'));
$('applyRoi').onclick = async () => {
  const values = ['X','Y','W','H'].map(k => Number($('roi'+k).value)/100);
  const [x,y,w,h] = values;
  if (!values.every(Number.isFinite) || x<0 || y<0 || w<=0 || h<=0 || x+w>1 || y+h>1) return error('영역이 영상 범위를 벗어났습니다.');
  try { await configure(false); roi={x,y,w,h}; saveRoi(); drawRoi(); syncUI(); error(); } catch (e) { error(e.message); }
};
async function cameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind==='videoinput');
  const current = $('device').value;
  $('device').replaceChildren(new Option('기본 카메라',''), ...devices.map((d,i)=>new Option(d.label || `카메라 ${i+1}`,d.deviceId)));
  $('device').value=current;
}
async function stopSource() {
  sourceEpoch++; active=false; enabled=false; lastVideoTime=-1;sourceCaptured=0;cameraCaptured=null;cameraFrame=0;lastCameraFrame=-1;
  if (media) media.getTracks().forEach(t=>t.stop());
  media=null; video.srcObject=null; $('cameraStop').disabled=true; $('cameraStart').disabled=false;
  $('empty').hidden=false; $('sourceState').textContent='카메라 꺼짐'; syncUI();
  await configure(false);
  await post('/api/source', {url:''}).then(r=>generation=r.generation);
}
$('cameraStop').onclick = () => stopSource().catch(e=>error(e.message));
$('source').onchange = async () => {
  try { await stopSource(); } catch(e) { error(e.message); }
  $('deviceField').hidden=$('source').value!=='camera';
  $('streamField').hidden=$('source').value!=='stream';
  $('demoField').hidden=$('source').value!=='demo';
  $('cameraStart').textContent=$('source').value==='camera'?'카메라 켜기':'영상 열기';
};
$('device').onchange = () => stopSource().catch(e=>error(e.message));
$('cameraStart').onclick = async () => {
  if (busy) return;
  busy=true; syncUI(); $('cameraStart').disabled=true; $('source').disabled=true; $('device').disabled=true; error();
  try {
    await stopSource();
    const epoch=sourceEpoch, source=$('source').value;
    if (source==='camera') {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('localhost에서 최신 Chrome/Safari로 열어주세요.');
      const deviceId=$('device').value;
      media=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280},height:{ideal:720},...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:'environment'})}});
      video.srcObject=media; await video.play();
      $('stage').style.aspectRatio=`${video.videoWidth}/${video.videoHeight}`;
      video.style.display='block'; display.style.display='none';
      media.getVideoTracks()[0].addEventListener('ended',()=>stopSource().catch(e=>error(e.message)));
      await cameras();
      if(video.requestVideoFrameCallback) {
        const capture=(now,metadata)=>{
          if(epoch!==sourceEpoch || !media) return;
          cameraCanvas.width=video.videoWidth;cameraCanvas.height=video.videoHeight;
          cameraCanvas.getContext('2d').drawImage(video,0,0);
          const timestamp=metadata.captureTime;
          cameraCaptured=Number.isFinite(timestamp)&&timestamp<=now&&now-timestamp<2000?timestamp:(metadata.presentationTime||now);
          cameraFrame++;
          video.requestVideoFrameCallback(capture);
        };
        video.requestVideoFrameCallback(capture);
      }
    } else {
      video.style.display='none'; display.style.display='block';
      display.width=1280;display.height=720;$('stage').style.aspectRatio='16/9';
      if (source==='stream') generation=(await post('/api/source',{url:$('streamUrl').value})).generation;
    }
    active=true;$('empty').hidden=true;$('cameraStop').disabled=false;$('sourceState').textContent='드래그하여 인식 영역 선택';
    void preview(epoch); // One source preview loop per input generation.
  } catch(e) {
    if(media) media.getTracks().forEach(track=>track.stop());
    media=null;video.srcObject=null;active=false;
    error(e.name==='NotAllowedError'?'브라우저의 카메라 권한을 허용한 뒤 다시 켜주세요.':e.message);
  }
  finally {busy=false;$('cameraStart').disabled=false;$('source').disabled=false;$('device').disabled=false;syncUI();}
};
async function preview(epoch) {
  while(active && epoch===sourceEpoch) {
    try {
      if ($('source').value==='stream') {
        const response=await api('/api/stream-frame'), frame=await createImageBitmap(await response.blob());
        if (epoch!==sourceEpoch) {frame.close();return;}
        display.width=frame.width;display.height=frame.height;$('stage').style.aspectRatio=`${frame.width}/${frame.height}`;
        display.getContext('2d').drawImage(frame,0,0);frame.close();sourceCaptured=Number(response.headers.get('X-Captured-Ms'));
      } else if ($('source').value==='demo') {
        const ctx=display.getContext('2d');ctx.fillStyle='#090909';ctx.fillRect(0,0,1280,720);
        if (!$('demoBlank').checked) {ctx.font='bold 180px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ff603c';ctx.fillText($('demoText').value,340,360);ctx.fillStyle='#70baff';ctx.fillText($('demoGame').value,970,360);}
        sourceCaptured=performance.now()+clockOffset;
      }
    } catch(e) {$('sourceState').textContent=e.message;}
    await new Promise(r=>setTimeout(r,$('source').value==='stream'?70:40));
  }
}
$('connect').onclick=async()=>{
  try {error();generation=(await post('/api/connect',{link:$('session').value,origin:$('origin').value})).generation;enabled=false;syncUI();}
  catch(e){error(e.message);}
};
$('toggle').onclick=async()=>{busy=true;syncUI();try{await configure(!enabled);error();}catch(e){error(e.message);}finally{busy=false;syncUI();}};
$('reacquire').onclick=async()=>{
  busy=true;syncUI();
  try {
    generation=(await post('/api/reacquire',{key:$('target').value})).generation;
    $('reading'+suffix($('target').value)).textContent='—';$('confidence'+suffix($('target').value)).textContent='새 기준값 확인 중';
    $('result').textContent='최근 여러 프레임으로 현재 값을 다시 확인합니다.';error();
  } catch(e) {error(e.message);}
  finally {busy=false;syncUI();}
};
for(const id of ['mode','compensation','shotMaximum','gameMaximum','threshold','preprocessing','reader']) $(id).onchange=async()=>{
  $('modeHint').textContent=$('mode').value==='auto'?'정수는 가려져도 1초씩 흐릅니다. 같은 값이 1.2초 이상 보이면 정지하고, 2초 이상 뒤처진 관찰값과 14·24 리셋을 보정합니다. 소수는 인식값만 표시합니다.':'확정된 카메라 값만 표시합니다. 가림·오인식 중에는 마지막 값을 유지합니다.';
  try{await configure(false);}catch(e){error(e.message);}
};
async function recognizeLoop() {
  while(true) {
    const began=performance.now();
    if(active && clockKeys.some(key=>rois[key]) && !dragging && !busy && modelReady && clockOffset!==null && !document.hidden) {
      try {
        const source=$('source').value;
        let image=display,captured=sourceCaptured;
        if(source==='camera') {
          if(video.requestVideoFrameCallback) {
            if(cameraCaptured===null || cameraFrame===lastCameraFrame) throw new Error('새 카메라 프레임 대기');
            image=cameraCanvas;captured=cameraCaptured+clockOffset;lastCameraFrame=cameraFrame;
          } else {
            if(video.readyState<2 || video.currentTime===lastVideoTime) throw new Error('새 카메라 프레임 대기');
            lastVideoTime=video.currentTime;image=video;captured=performance.now()+clockOffset;
          }
        }
        const w=image===video?video.videoWidth:image.width,h=image===video?video.videoHeight:image.height;
        // Both clock crops come from this exact frame and capture timestamp.
        snapshotCanvas.width=w;snapshotCanvas.height=h;snapshotCanvas.getContext('2d').drawImage(image,0,0,w,h);
        const epoch=sourceEpoch,frameGeneration=generation;
        for(const key of clockKeys) {
          const r=rois[key];if(!r) continue;
          const sw=Math.round(r.w*w),sh=Math.round(r.h*h),scale=Math.min(1,960/sw,480/sh);
          if(sw<12 || sh<12) { $('result'+suffix(key)).textContent='영역을 더 크게 선택하세요.';continue; }
          inputCanvas.width=Math.round(sw*scale);inputCanvas.height=Math.round(sh*scale);
          inputCanvas.getContext('2d').drawImage(snapshotCanvas,r.x*w,r.y*h,sw,sh,0,0,inputCanvas.width,inputCanvas.height);
          if(key===$('target').value) {crop.width=inputCanvas.width;crop.height=inputCanvas.height;crop.getContext('2d').drawImage(inputCanvas,0,0);}
          const blob=await new Promise(resolve=>inputCanvas.toBlob(resolve,'image/jpeg',.94));
          if(frameGeneration!==generation || epoch!==sourceEpoch) break;
          if(!blob) throw new Error('카메라 프레임 생성 실패');
          const data=await(await api('/api/frame',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Captured-Ms':String(captured),'X-Generation':String(frameGeneration),'X-Clock-Key':key},body:blob})).json();
          if(frameGeneration!==generation || epoch!==sourceEpoch) break;
          if('confirmed' in data) $('reading'+suffix(key)).textContent=data.confirmed?.text||'—';
          $('confidence'+suffix(key)).textContent=data.confirmed?(data.accepted?'확인됨':'마지막 확정값'):'여러 프레임 확인 중';
          $('result'+suffix(key)).textContent=data.reason;
          if(key===$('target').value) {
            $('rawReading').textContent=data.raw_text?`${label(key)} 후보: ${data.raw_text}${data.method?' · '+data.method:''}`:'읽은 후보 없음';
            $('result').textContent=data.reason;
          }
          inference=data.inference_ms??null;age=data.age_ms??null;
        }
      } catch(e) {$('result').textContent=e.message;}
    }
    await new Promise(resolve=>setTimeout(resolve,Math.max(20,180-(performance.now()-began))));
  }
}
async function statusLoop() {
  while(true) {
    try {
      const start=performance.now(),data=await(await api('/api/status')).json(),end=performance.now();
      clockOffset=data.now_ms-(start+end)/2;connected=data.connected;modelReady=data.model_ready;
      $('modelState').textContent=data.model;$('relayState').textContent=data.relay;$('connectionDot').classList.toggle('active',connected);
      for(const key of clockKeys) {
        const state=data.clocks?.[key],current=state?.current||state?.preview,timing=state?.timing;
        $('webClock'+suffix(key)).textContent=clockText(current,state?.confirmed);
        $('webRunning'+suffix(key)).textContent=current?(current.running?'재생 중':'정지'):'대기';
        $('timing'+suffix(key)).textContent=timing?.samples?`초 경계 ${timing.phase_ms}ms · 추정 범위 ±${timing.uncertainty_ms}ms`:'숫자 전환 시각 측정 중';
      }
      $('metrics').textContent=`추론 ${inference??'—'} ms · 프레임 ${age??'—'} ms · 왕복 ${data.rtt_ms??'—'} ms`;
      syncUI();
    } catch(e) {
      connected=false;modelReady=false;syncUI();
      $('relayState').textContent=e.message;$('modelState').textContent='로컬 프로그램 연결 끊김';
      clearReadouts();
      $('result').textContent=e.message;$('rawReading').textContent='연결이 복구되면 다시 인식합니다.';
    }
    await new Promise(r=>setTimeout(r,500));
  }
}
// A new page always starts disarmed, even after a reload of an armed session.
(async()=>{try{await configure(false);saveRoi();await cameras();}catch(e){error(e.message);}void statusLoop();void recognizeLoop();})();
