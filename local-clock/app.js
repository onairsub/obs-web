/* Browser camera/ROI input; only cropped frames are sent to the local Python process. */
const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="local-token"]').content;
const video = $('video'), display = $('display'), selection = $('selection'), crop = $('crop');
let media = null, active = false, enabled = false, connected = false, modelReady = false;
let generation = 0, clockOffset = null, inference = null, age = null, sourceEpoch = 0;
let roi = null, dragging = null, lastVideoTime = -1, sourceCaptured = 0;
let busy = false;
try { roi = JSON.parse(localStorage.getItem('clock-reader-roi')); } catch { /* optional saved ROI */ }
if (roi && (!['x','y','w','h'].every(k => Number.isFinite(roi[k])) || roi.w <= 0 || roi.h <= 0 || roi.x < 0 || roi.y < 0 || roi.x + roi.w > 1 || roi.y + roi.h > 1)) roi = null;
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
  return {enabled:arm, key:$('target').value, mode:$('mode').value,
    minimum_confidence:Number($('threshold').value), maximum:Number($('maximum').value), preprocessing:$('preprocessing').value, reader:$('reader').value};
}
function syncUI() {
  $('toggle').textContent = enabled ? '동기화 중지' : '동기화 시작';
  $('toggle').classList.toggle('running', enabled);
  $('toggle').disabled = busy || !active || !roi || !connected || !modelReady;
  if (enabled) $('toggle').disabled = busy;
  $('syncBadge').textContent = enabled ? '동기화 켜짐' : '미리보기';
}
async function configure(arm = false) {
  const result = await post('/api/settings', options(arm));
  generation = result.generation; enabled = arm; syncUI();
}
function saveRoi() {
  if (!roi) return;
  localStorage.setItem('clock-reader-roi', JSON.stringify(roi));
  ['X','Y','W','H'].forEach(k => $('roi'+k).value = (roi[k.toLowerCase()] * 100).toFixed(1));
}
function drawRoi() {
  const rect = selection.getBoundingClientRect();
  selection.width = rect.width * devicePixelRatio; selection.height = rect.height * devicePixelRatio;
  const ctx = selection.getContext('2d'), w = selection.width, h = selection.height;
  if (!roi) return;
  ctx.fillStyle = '#050b1580'; ctx.fillRect(0,0,w,h);
  ctx.clearRect(roi.x*w,roi.y*h,roi.w*w,roi.h*h);
  ctx.strokeStyle = '#68efb8'; ctx.lineWidth = 2*devicePixelRatio;
  ctx.strokeRect(roi.x*w,roi.y*h,roi.w*w,roi.h*h);
}
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
  sourceEpoch++; active=false; enabled=false; lastVideoTime=-1; sourceCaptured=0;
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
        if (!$('demoBlank').checked) {ctx.font='bold 180px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ff603c';ctx.fillText($('demoText').value,640,360);}
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
for(const id of ['target','mode','maximum','threshold','preprocessing','reader']) $(id).onchange=async()=>{
  if(id==='target') $('maximum').value=$('target').value.includes('GAME')?'1200':'60';
  $('modeHint').textContent=$('mode').value==='hold'?'웹 시계를 정지하고 관측값으로 갱신합니다. 가려지면 마지막 숫자를 유지합니다.':'웹 시계의 시작/정지를 유지하며 값만 보정합니다. 가려져도 실행 중인 시계는 계속 흐릅니다.';
  try{await configure(false);}catch(e){error(e.message);}
};
async function recognizeLoop() {
  while(true) {
    const began=performance.now();
    if(active && roi && !dragging && !busy && modelReady && clockOffset!==null && !document.hidden) {
      try {
        const source=$('source').value, image=source==='camera'?video:display;
        let captured=sourceCaptured;
        if(source==='camera') {
          if(video.readyState<2 || video.currentTime===lastVideoTime) throw new Error('새 카메라 프레임 대기');
          lastVideoTime=video.currentTime;captured=performance.now()+clockOffset;
        }
        const w=source==='camera'?video.videoWidth:display.width,h=source==='camera'?video.videoHeight:display.height;
        const sw=Math.round(roi.w*w),sh=Math.round(roi.h*h),scale=Math.min(1,960/sw,480/sh);
        if(sw<12 || sh<12) throw new Error('숫자 영역을 더 크게 선택하세요.');
        crop.width=Math.round(sw*scale);crop.height=Math.round(sh*scale);
        crop.getContext('2d').drawImage(image,roi.x*w,roi.y*h,sw,sh,0,0,crop.width,crop.height);
        const frameGeneration=generation,epoch=sourceEpoch;
        const blob=await new Promise(r=>crop.toBlob(r,'image/jpeg',.94));
        if(!blob) throw new Error('카메라 프레임 생성 실패');
        const data=await (await api('/api/frame',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Captured-Ms':String(captured),'X-Generation':String(frameGeneration)},body:blob})).json();
        if(frameGeneration!==generation || epoch!==sourceEpoch) continue;
        $('reading').textContent=data.reading?.text || '—';
        $('confidence').textContent=data.reading?`신뢰도 ${(data.reading.confidence*100).toFixed(1)}%`:'숫자 인식 대기';
        $('rawReading').textContent=data.raw_text?`읽은 후보: ${data.raw_text}${data.method?' · '+data.method:''}`:'읽은 후보 없음';
        $('result').textContent=data.reason;inference=data.inference_ms??null;age=data.age_ms??null;
      } catch(e) {$('result').textContent=e.message;}
    }
    await new Promise(r=>setTimeout(r,Math.max(20,180-(performance.now()-began))));
  }
}
async function statusLoop() {
  while(true) {
    try {
      const start=performance.now(),data=await(await api('/api/status')).json(),end=performance.now();
      clockOffset=data.now_ms-(start+end)/2;connected=data.connected;modelReady=data.model_ready;
      $('modelState').textContent=data.model;$('relayState').textContent=data.relay;$('connectionDot').classList.toggle('active',connected);
      $('webClock').textContent=data.current?data.current.seconds.toFixed(1):'—';
      $('webRunning').textContent=data.current?(data.current.running?'실행 중':'정지'):'호스트 연결 대기';
      $('metrics').textContent=`추론 ${inference??'—'} ms · 프레임 ${age??'—'} ms · 왕복 ${data.rtt_ms??'—'} ms`;
      syncUI();
    } catch(e) {
      connected=false;modelReady=false;syncUI();
      $('relayState').textContent=e.message;$('modelState').textContent='로컬 프로그램 연결 끊김';
      $('reading').textContent='—';$('confidence').textContent='서버 응답 대기';
      $('result').textContent=e.message;$('rawReading').textContent='연결이 복구되면 다시 인식합니다.';
    }
    await new Promise(r=>setTimeout(r,500));
  }
}
// A new page always starts disarmed, even after a reload of an armed session.
(async()=>{try{await configure(false);saveRoi();await cameras();}catch(e){error(e.message);}void statusLoop();void recognizeLoop();})();
