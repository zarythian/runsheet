// HUD screen — mascot, animations and interaction patterns ported verbatim from
// runsheet-hud-demo-v4.html, wired to real state (stops/legs/route progress) instead of demo data.

function vibrate(pattern){ if(navigator.vibrate) navigator.vibrate(pattern); }

function routeStops(){ return (state.order || []).map(id => stopById(id)).filter(Boolean); }

const R_RING = 44, CIRC_RING = 2*Math.PI*R_RING;

function initHud(){
  document.getElementById('ringFill').setAttribute('stroke-dasharray', CIRC_RING.toFixed(1));
  document.getElementById('doneBtn').onclick = () => { vibrate(15); handleDone(); };
  document.getElementById('failBtn').onclick = () => { vibrate(15); openReasonSheet(); };
  document.getElementById('undoBtn').onclick = doUndo;
  document.getElementById('undoIconBtn').onclick = doUndo;
  document.getElementById('sunToggle').onclick = () => {
    document.body.classList.toggle('sun');
    document.getElementById('sunToggle').classList.toggle('active');
    state.settings.sunMode = document.body.classList.contains('sun');
    saveState();
  };
  document.getElementById('backToSetupBtn').onclick = () => { state.view='setup'; saveState(); showView('setup'); };
  document.getElementById('newRouteBtn').onclick = () => {
    if(confirm('Start a new route? This clears today\'s stops and stats.')){
      resetForNewRoute();
      clearAllPhotos();
      showView('setup');
    }
  };

  document.getElementById('photoBtn').onclick = () => document.getElementById('photoInput').click();
  document.getElementById('photoInput').onchange = async (e) => {
    if(e.target.files && e.target.files[0]){
      const s = routeStops()[state.route.currentIndex];
      if(!s) return;
      await savePhoto(s.id, e.target.files[0]);
      s.hasPhoto = true;
      saveState();
      document.getElementById('photoLabel').textContent = 'Photo attached ✓';
      document.getElementById('photoBtn').classList.add('attached');
      vibrate(10);
    }
  };

  document.getElementById('earningsToggle').onclick = () => {
    earningsVisible = true;
    refreshEarningsDisplay();
    document.getElementById('earningsToggle').style.textDecoration = 'none';
    clearTimeout(earningsTimer);
    earningsTimer = setTimeout(() => {
      earningsVisible = false;
      document.getElementById('earningsToggle').textContent = '💰 tap for earnings';
      document.getElementById('earningsToggle').style.textDecoration = 'underline';
    }, 30000);
  };

  document.getElementById('priceChip').onclick = () => {
    document.getElementById('priceInputField').value = state.route.currentPrice || 0;
    openSheet('priceSheet');
  };
  document.getElementById('priceCancel').onclick = () => closeSheet('priceSheet');
  document.getElementById('priceSave').onclick = () => {
    const v = parseFloat(document.getElementById('priceInputField').value);
    if(!isNaN(v) && v >= 0){ state.route.currentPrice = v; document.getElementById('priceVal').textContent = v; saveState(); }
    closeSheet('priceSheet');
  };

  document.getElementById('sheetCancel').onclick = () => closeSheet('reasonSheet');

  document.getElementById('contactCancel').onclick = () => closeSheet('contactSheet');
  document.getElementById('contactCall').addEventListener('click', () => closeSheet('contactSheet'));
  document.getElementById('contactWhatsapp').onclick = () => {
    if(!activeContact) return;
    const msg = encodeURIComponent('Hi, this is your courier — following up on your delivery ('+activeContact.skipReason.toLowerCase()+').');
    const phonePart = activeContact.phone ? activeContact.phone.replace(/^0/,'972') : '';
    window.open('https://wa.me/'+phonePart+'?text='+msg, '_blank');
    closeSheet('contactSheet');
  };

  setupSwipeGestures();

  if(state.settings.sunMode){
    document.body.classList.add('sun');
    document.getElementById('sunToggle').classList.add('active');
  }

  renderHud();
}

function startRoute(){
  if(!state.order || state.order.length === 0) return;
  if(!state.route.startedAt){
    state.route.startedAt = Date.now();
    state.route.currentIndex = 0;
    state.route.kmTotal = 0;
    state.route.doneCount = 0;
    state.route.codCollected = 0;
    state.route.runEarnings = 0;
    state.route.currentPrice = state.route.currentPrice || 0;
    state.route.lastAction = null;
    state.stops.forEach(s => { s.status = 'pending'; s.skipReason = null; });
  }
  state.view = 'hud';
  saveState();
  showView('hud');
}

function renderHud(){
  const stops = routeStops();
  const i = state.route.currentIndex;

  updateStats();

  if(i >= stops.length){
    document.getElementById('stopCard').style.display = 'none';
    document.querySelector('#hudView .actions').style.display = 'none';
    document.getElementById('doneScreen').style.display = 'flex';
    document.getElementById('upnextWrap').style.display = 'none';
    document.getElementById('attentionWrap').style.display = 'none';
    const pending = state.stops.filter(s => s.status === 'skipped').length;
    const elapsedMs = state.route.startedAt ? (Date.now() - state.route.startedAt) : 0;
    const elapsedMin = Math.round(elapsedMs/60000);
    const h = Math.floor(elapsedMin/60), m = elapsedMin%60;
    const timeStr = h>0 ? h+'h '+m+'m' : m+' min';
    document.getElementById('doneSub').innerHTML =
      state.route.doneCount+' delivered · '+state.route.kmTotal.toFixed(1)+' km · '+timeStr
      + (pending ? '<br>'+pending+' stop(s) still pending — see Needs attention below before you clear the route.' : '')
      + '<br>Cash collected: ₪'+state.route.codCollected
      + (state.route.runEarnings ? ' · Earnings: ₪'+state.route.runEarnings : '');
    document.getElementById('ringFill').setAttribute('stroke-dashoffset', 0);
    document.getElementById('mascotHpFill').style.width = '100%';
    renderAttention();
    updateUndoUi();
    return;
  }

  document.getElementById('stopCard').style.display = 'block';
  document.querySelector('#hudView .actions').style.display = 'flex';
  document.getElementById('doneScreen').style.display = 'none';
  document.getElementById('upnextWrap').style.display = 'block';

  const s = stops[i];
  const leg = (state.legs && state.legs[i]) || {km:0, min:0};

  document.getElementById('ringNum').textContent = i+1;
  document.getElementById('ringSub').textContent = 'of '+stops.length;
  document.getElementById('ringFill').setAttribute('stroke-dashoffset', (CIRC_RING*(1-i/stops.length)).toFixed(1));
  document.getElementById('mascotLevel').textContent = 'lv-'+(i+1);
  document.getElementById('mascotHpFill').style.width = Math.round((i/stops.length)*100)+'%';

  document.getElementById('stopEyebrow').textContent = i===0 ? 'FIRST STOP' : 'NEXT STOP';
  document.getElementById('stopName').textContent = s.name;
  document.getElementById('stopNotes').textContent = s.notes || '';
  document.getElementById('chipDist').textContent = leg.km.toFixed(1)+' km';
  document.getElementById('chipEta').textContent = leg.min < 60 ? Math.round(leg.min)+' min' : fmtMin(leg.min);

  document.getElementById('navBtn').onclick = () => {
    const url = state.settings.navApp === 'waze'
      ? 'https://waze.com/ul?ll='+s.lat+','+s.lng+'&navigate=yes'
      : 'https://www.google.com/maps/dir/?api=1&destination='+s.lat+','+s.lng+'&travelmode='+state.settings.travelMode;
    window.open(url, '_blank');
  };

  document.getElementById('codBadgeWrap').innerHTML = s.cod
    ? '<div class="cod-badge">💰 COD — collect ₪'+s.cod+'</div>' : '';
  document.getElementById('priceVal').textContent = state.route.currentPrice || 0;

  const mini = [];
  mini.push(s.phone
    ? '<a class="mini-btn" href="tel:'+s.phone+'"><span class="ic">📞</span>Call</a>'
    : '<div class="mini-btn disabled"><span class="ic">📞</span>No number</div>');
  mini.push('<button class="mini-btn" id="etaBtn"><span class="ic">💬</span>Share ETA</button>');
  document.getElementById('miniActions').innerHTML = mini.join('');
  const etaBtn = document.getElementById('etaBtn');
  if(etaBtn) etaBtn.onclick = () => {
    const etaTxt = leg.min < 60 ? Math.round(leg.min)+' min' : fmtMin(leg.min);
    const msg = encodeURIComponent('On my way, ETA ~'+etaTxt+' 🛵');
    const url = s.phone ? 'https://wa.me/'+s.phone.replace(/^0/,'972')+'?text='+msg : 'https://wa.me/?text='+msg;
    window.open(url, '_blank');
  };

  document.getElementById('photoLabel').textContent = s.hasPhoto ? 'Photo attached ✓' : 'Add delivery photo';
  document.getElementById('photoBtn').classList.toggle('attached', !!s.hasPhoto);

  renderUpnext();
  renderAttention();
  updateUndoUi();
}

function renderUpnext(){
  const stops = routeStops();
  const i = state.route.currentIndex;
  const upnext = stops.slice(i+1, i+4);
  document.getElementById('upnextList').innerHTML = upnext.map((u,idx) =>
    '<div class="upnext-item"><b>'+(i+2+idx)+'. '+escapeHtml(u.name)+'</b>'+(u.notes?escapeHtml(u.notes):'')
    + (u.status==='skipped' ? '<span class="pending-flag">⚑ pending</span>' : '')
    + '</div>'
  ).join('') || '<div class="upnext-item">Last stop</div>';
}

let activeContact = null;
function renderAttention(){
  const wrap = document.getElementById('attentionWrap');
  const skipped = state.stops.filter(s => s.status === 'skipped');
  if(skipped.length === 0){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  document.getElementById('attentionList').innerHTML = skipped.map(s =>
    '<div class="attention-item" data-id="'+s.id+'"><span>'+escapeHtml(s.name)+'</span><span class="r">'+escapeHtml(s.skipReason||'')+'</span></div>'
  ).join('');
  document.querySelectorAll('.attention-item').forEach(el => {
    el.onclick = () => openContactSheet(stopById(el.getAttribute('data-id')));
  });
}

function openContactSheet(s){
  activeContact = s;
  document.getElementById('contactSheetTitle').textContent = s.name;
  const callBtn = document.getElementById('contactCall');
  if(s.phone){
    callBtn.classList.remove('disabled');
    callBtn.setAttribute('href', 'tel:'+s.phone);
    callBtn.innerHTML = '<span>📞</span> Call';
  } else {
    callBtn.classList.add('disabled');
    callBtn.setAttribute('href', 'tel:');
    callBtn.innerHTML = '<span>📞</span> No number on file';
  }
  openSheet('contactSheet');
}

function updateStats(){
  document.getElementById('statKm').textContent = state.route.kmTotal.toFixed(1)+' km';
  document.getElementById('statDone').textContent = state.route.doneCount;
  refreshEarningsDisplay();
}

let earningsTimer = null, earningsVisible = false;
function refreshEarningsDisplay(){
  if(!earningsVisible) return;
  const el = document.getElementById('earningsToggle');
  if(el) el.innerHTML = 'This run: <b>₪'+(state.route.runEarnings||0)+'</b> · COD collected: <b>₪'+state.route.codCollected+'</b>';
}

function handleDone(){
  const stops = routeStops();
  const i = state.route.currentIndex;
  const s = stops[i];
  const leg = (state.legs && state.legs[i]) || {km:0, min:0};
  const isLast = (i === stops.length - 1);

  state.route.lastAction = {
    type:'done', index:i,
    prevKm: state.route.kmTotal, prevDone: state.route.doneCount,
    prevRunEarnings: state.route.runEarnings, prevCod: state.route.codCollected,
    prevStatus: s.status, prevReason: s.skipReason
  };
  s.status = 'done';
  state.route.kmTotal += leg.km;
  state.route.doneCount++;
  state.route.runEarnings = (state.route.runEarnings||0) + (state.route.currentPrice||0);
  if(s.cod) state.route.codCollected += s.cod;

  updateStats();
  mascotReact('happy', isLast);
  showUndo();
  saveState();
  setTimeout(() => { state.route.currentIndex++; saveState(); renderHud(); }, 500);
}

function openReasonSheet(){
  const wrap = document.getElementById('reasonOptsWrap');
  wrap.innerHTML = state.settings.reasons.map(r =>
    '<button class="reason-opt" data-reason="'+escapeHtml(r)+'">'+escapeHtml(r)+'</button>'
  ).join('');
  wrap.querySelectorAll('.reason-opt').forEach(btn => {
    btn.onclick = () => {
      const reason = btn.getAttribute('data-reason');
      const stops = routeStops();
      const i = state.route.currentIndex;
      const s = stops[i];
      state.route.lastAction = {
        type:'fail', index:i, reason,
        prevKm: state.route.kmTotal, prevDone: state.route.doneCount,
        prevRunEarnings: state.route.runEarnings, prevCod: state.route.codCollected,
        prevStatus: s.status, prevReason: s.skipReason
      };
      s.status = 'skipped';
      s.skipReason = reason;
      closeSheet('reasonSheet');
      vibrate([10,40,10]);
      mascotReact('sad');
      showUndo();
      saveState();
      setTimeout(() => { state.route.currentIndex++; saveState(); renderHud(); }, 500);
    };
  });
  openSheet('reasonSheet');
}

function showUndo(){
  document.getElementById('undoBtn').classList.add('show');
  document.getElementById('undoIconBtn').style.opacity = '1';
  document.getElementById('undoIconBtn').disabled = false;
}
function updateUndoUi(){
  const has = !!state.route.lastAction;
  document.getElementById('undoBtn').classList.toggle('show', has);
  document.getElementById('undoIconBtn').style.opacity = has ? '1' : '0.35';
  document.getElementById('undoIconBtn').disabled = !has;
}
function doUndo(){
  const a = state.route.lastAction;
  if(!a) return;
  vibrate(10);
  const s = routeStops()[a.index];
  s.status = a.prevStatus;
  s.skipReason = a.prevReason;
  state.route.kmTotal = a.prevKm;
  state.route.doneCount = a.prevDone;
  state.route.runEarnings = a.prevRunEarnings;
  state.route.codCollected = a.prevCod;
  state.route.currentIndex = a.index;
  state.route.lastAction = null;
  updateStats();
  document.getElementById('undoBtn').classList.remove('show');
  document.getElementById('undoIconBtn').style.opacity = '0.35';
  document.getElementById('undoIconBtn').disabled = true;
  saveState();
  renderHud();
}

// ---------- mascot (verbatim from runsheet-hud-demo-v4.html) ----------
const happyLines = ["Nice one! 🎉","Boom, delivered.","One down, rolling on."];
const sadLines = ["Logged — moving on.","Tough one, next!","Noted, keep rolling."];

function spark(){
  const wrap = document.getElementById('mascotCharWrap');
  for(let k=0;k<6;k++){
    const s = document.createElement('span'); s.className='spark'; s.textContent=['✨','🎉','⚡'][k%3];
    s.style.left=(36+Math.random()*36)+'px'; s.style.top=(10+Math.random()*10)+'px';
    s.style.setProperty('--dx', ((Math.random()-0.5)*50)+'px');
    wrap.appendChild(s); setTimeout(()=>s.remove(),750);
  }
}
function spawnFloatText(text, color){
  const wrap = document.getElementById('mascotCharWrap');
  const d = document.createElement('div');
  d.className='dmg-num'; d.style.color = color;
  d.textContent = text;
  d.style.left='96px'; d.style.top='18px';
  wrap.appendChild(d);
  setTimeout(()=>d.remove(), 800);
}
function killEnemy(){
  const enemy = document.getElementById('enemyGroup');
  enemy.classList.add('dead');
  document.getElementById('enemyEye1').style.opacity = 0;
  document.getElementById('enemyEye2').style.opacity = 0;
  document.getElementById('enemyMouth').style.opacity = 0;
  document.getElementById('enemyXEyes').style.opacity = 1;
}
function mascotReact(kind, isLast){
  const body=document.getElementById('mascotBody'), mouth=document.getElementById('mascotMouth'), msg=document.getElementById('mascotMsg');
  body.classList.remove('idle','happy','sad'); void body.offsetWidth;
  if(kind==='happy'){
    body.classList.add('happy'); mouth.setAttribute('d','M52 30 Q60 38 68 30');
    msg.textContent = isLast ? "Finisher! 🏁" : happyLines[Math.floor(Math.random()*happyLines.length)];
    msg.className='mascot-msg show happy-text'; spark();
    const scythe=document.getElementById('scytheGroup'), enemy=document.getElementById('enemyGroup');
    scythe.classList.remove('swing'); void scythe.offsetWidth; scythe.classList.add('swing');
    setTimeout(()=>{
      enemy.classList.remove('hit'); void enemy.offsetWidth; enemy.classList.add('hit');
      if(isLast){
        spawnFloatText('99', '#FF3B3B');
        setTimeout(()=>killEnemy(), 320);
      } else {
        spawnFloatText('69', '#FF3B3B');
        setTimeout(()=>spawnFloatText('+70', '#3DE0C8'), 550);
      }
    },180);
  } else {
    body.classList.add('sad'); mouth.setAttribute('d','M52 34 Q60 29 68 34');
    msg.textContent = sadLines[Math.floor(Math.random()*sadLines.length)];
    msg.className='mascot-msg show sad-text';
  }
  setTimeout(()=>{
    body.classList.remove('happy','sad'); body.classList.add('idle');
    mouth.setAttribute('d','M53 31 Q60 35 67 31'); msg.classList.remove('show');
  },1400);
}

// ---------- swipe gestures (verbatim behavior from demo) ----------
function setupSwipeGestures(){
  const card = document.getElementById('stopCard');
  let startX=0, dx=0, dragging=false;
  card.addEventListener('touchstart', e=>{ startX=e.touches[0].clientX; dragging=true; }, {passive:true});
  card.addEventListener('touchmove', e=>{
    if(!dragging) return;
    dx = e.touches[0].clientX - startX;
    card.style.transform = 'translateX('+(dx*0.4)+'px) rotate('+(dx*0.01)+'deg)';
    document.getElementById('swipeRight').style.opacity = dx>30 ? Math.min(1,dx/120) : 0;
    document.getElementById('swipeLeft').style.opacity = dx<-30 ? Math.min(1,-dx/120) : 0;
  }, {passive:true});
  card.addEventListener('touchend', ()=>{
    dragging=false;
    card.style.transform='';
    document.getElementById('swipeRight').style.opacity=0;
    document.getElementById('swipeLeft').style.opacity=0;
    if(dx > 90){ vibrate(15); handleDone(); }
    else if(dx < -90){ vibrate(15); openReasonSheet(); }
    dx=0;
  });
}
