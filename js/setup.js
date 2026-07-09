// Setup screen: add stops, start point, optimize, drag-reorder, edit sheet.

function genId(){ return Date.now()+'-'+Math.random().toString(36).slice(2,7); }

let pendingCoord = null;   // resolved {lat,lng} for the single-add field, if locally parseable
let editingStopId = null;

function fmtKm(km){ return km.toFixed(1)+' km'; }
function fmtMin(min){
  if(min < 60) return Math.round(min)+' min';
  const h = Math.floor(min/60), m = Math.round(min%60);
  return h+'h '+(m<10?'0':'')+m+'m';
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function stopById(id){ return state.stops.find(s => s.id === id); }

// Prefer the courier's own typed text as the stop name — it's usually more
// meaningful than a geocoder's formatted label. Only fall back to the resolved
// label when the input itself wasn't human-readable (raw coordinates or a link).
function defaultStopName(inputText, resolved){
  if(extractLatLng(inputText)) return resolved.label || null;
  if(/^https?:\/\//i.test(inputText.trim())) return resolved.label || null;
  return inputText.trim();
}

// ---------- leg recomputation ----------
async function recomputeLegs(){
  const orderedStops = state.order.map(id => stopById(id)).filter(Boolean);
  const hasDepot = !!state.depot;
  const points = hasDepot ? [state.depot, ...orderedStops] : orderedStops;
  let raw = points.length >= 2 ? await orsLegDistances(points, state.settings.travelMode) : [];
  let source = points.length >= 2 ? 'ors' : 'haversine';
  if(!raw){
    raw = [];
    for(let i=0;i<points.length-1;i++){
      const km = haversine(points[i], points[i+1]);
      const min = (km/state.settings.speed)*60 + state.settings.dwell;
      raw.push({km, min});
    }
    source = 'haversine';
  }
  state.legs = hasDepot ? raw : [{km:0,min:0}].concat(raw);
  state.legSource = source;
}

async function optimizeRoute(){
  const stops = state.stops;
  if(stops.length < 1) return;
  const optimizeBtn = document.getElementById('optimizeBtn');
  const status = document.getElementById('optimizeStatus');
  optimizeBtn.disabled = true;
  status.textContent = 'Optimizing…';
  const start = state.depot || {lat: stops[0].lat, lng: stops[0].lng};
  let orderIds = null;
  try{ orderIds = await orsOptimizeOrder(stops, start, state.settings.travelMode); }catch(e){ orderIds = null; }
  if(!orderIds){
    const pts = [start].concat(stops);
    const idxOrder = heuristicOrder(pts);
    orderIds = idxOrder.slice(1).map(i => stops[i-1].id);
    status.textContent = orsKey() ? 'Optimized with straight-line fallback (route API unavailable).' : 'Optimized with straight-line estimate (add an API key in Settings for road-accurate routing).';
  } else {
    status.textContent = 'Optimized using OpenRouteService.';
  }
  state.order = orderIds;
  await recomputeLegs();
  saveState();
  renderSetup();
}

// ---------- rendering ----------
function renderSetup(){
  renderDepot();
  renderStopList();
  renderResults();
  document.getElementById('stopCountLabel').textContent = state.stops.length;
  document.getElementById('optimizeBtn').disabled = state.stops.length < 1;
  document.getElementById('startRouteBtn').style.display = state.order ? 'block' : 'none';
  document.getElementById('speedInput').value = state.settings.speed;
  document.getElementById('dwellInput').value = state.settings.dwell;
  document.getElementById('modeInput').value = state.settings.travelMode;
}

function renderDepot(){
  const el = document.getElementById('depotGpsStatus');
  if(state.depot && state.depot.mode === 'gps'){
    el.innerHTML = '<div class="ok-text">✓ Using GPS location — '+state.depot.lat.toFixed(5)+', '+state.depot.lng.toFixed(5)+'</div>';
  } else {
    el.innerHTML = '';
  }
  const depotInput = document.getElementById('depotInput');
  if(state.depot && state.depot.mode === 'manual' && document.activeElement !== depotInput){
    depotInput.value = state.depot.lat.toFixed(5)+', '+state.depot.lng.toFixed(5);
  }
}

function stopFlags(s){
  let f = '';
  if(s.notes) f += ' · '+escapeHtml(s.notes);
  if(s.phone) f += ' · 📞';
  if(s.cod) f += ' · <span class="flag-cod">₪'+s.cod+'</span>';
  return f;
}

const ROW_H = 72;

function renderStopList(){
  const list = document.getElementById('stopList');
  if(state.stops.length === 0){
    list.style.height = '';
    list.innerHTML = '<div class="empty">No stops added yet.</div>';
    return;
  }
  const draggable = !!state.order;
  const ids = draggable ? state.order.filter(id => stopById(id)) : state.stops.map(s => s.id);

  if(draggable){
    list.style.height = (ids.length*ROW_H - 8)+'px';
    list.innerHTML = ids.map((id,i) => stopItemHtml(id, i, true)).join('');
    attachDragHandles();
  } else {
    list.style.height = '';
    list.innerHTML = ids.map((id,i) => stopItemHtml(id, i, false)).join('');
  }
  attachStopItemHandlers();
}

function stopItemHtml(id, index, absolute){
  const s = stopById(id);
  if(!s) return '';
  const style = absolute ? ' style="position:absolute; left:0; right:0; top:'+(index*ROW_H)+'px;"' : '';
  return '<li class="stop-item" id="stopitem-'+id+'"'+style+' data-id="'+id+'">'
    + '<div class="badge" id="badge-'+id+'">'+(index+1)+'</div>'
    + '<div class="stop-meta">'
      + '<div class="stop-name">'+escapeHtml(s.name)+'</div>'
      + '<div class="stop-coord">'+s.lat.toFixed(5)+', '+s.lng.toFixed(5)+stopFlags(s)+'</div>'
    + '</div>'
    + '<div class="stop-actions">'
      + '<button class="icon-mini-btn" data-edit="'+id+'" title="Edit">✎</button>'
      + '<button class="icon-mini-btn" data-del="'+id+'" title="Remove">✕</button>'
      + (absolute ? '<div class="handle" data-handle="'+id+'"><svg viewBox="0 0 24 24" fill="none"><circle cx="8" cy="6" r="1.6" fill="currentColor"/><circle cx="16" cy="6" r="1.6" fill="currentColor"/><circle cx="8" cy="12" r="1.6" fill="currentColor"/><circle cx="16" cy="12" r="1.6" fill="currentColor"/><circle cx="8" cy="18" r="1.6" fill="currentColor"/><circle cx="16" cy="18" r="1.6" fill="currentColor"/></svg></div>' : '')
    + '</div>'
    + '</li>';
}

function attachStopItemHandlers(){
  document.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-del');
      state.stops = state.stops.filter(s => s.id !== id);
      if(state.order){ state.order = state.order.filter(oid => oid !== id); state.legs = null; }
      saveState();
      deletePhoto(id);
      if(state.order){ recomputeLegs().then(()=>{ saveState(); renderSetup(); }); }
      else renderSetup();
    };
  });
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => openStopEditSheet(btn.getAttribute('data-edit'));
  });
}

function attachDragHandles(){
  document.querySelectorAll('[data-handle]').forEach(handle => {
    const id = handle.getAttribute('data-handle');
    let startY = 0, startTop = 0, dragging = false;

    const indexOf = (id) => state.order.indexOf(id);

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startTop = indexOf(id) * ROW_H;
      const el = document.getElementById('stopitem-'+id);
      el.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if(!dragging) return;
      const el = document.getElementById('stopitem-'+id);
      let newTop = startTop + (e.clientY - startY);
      newTop = Math.max(0, Math.min(newTop, (state.order.length-1)*ROW_H));
      el.style.top = newTop + 'px';
      const newIndex = Math.round(newTop / ROW_H);
      const curIndex = indexOf(id);
      if(newIndex !== curIndex){
        state.order.splice(curIndex, 1);
        state.order.splice(newIndex, 0, id);
        state.order.forEach((oid,i) => {
          if(oid === id) return;
          const oel = document.getElementById('stopitem-'+oid);
          if(oel) oel.style.top = (i*ROW_H)+'px';
          const b = document.getElementById('badge-'+oid);
          if(b) b.textContent = i+1;
        });
        const b = document.getElementById('badge-'+id);
        if(b) b.textContent = newIndex+1;
      }
    });

    const end = (e) => {
      if(!dragging) return;
      dragging = false;
      const el = document.getElementById('stopitem-'+id);
      el.classList.remove('dragging');
      el.style.top = (indexOf(id)*ROW_H) + 'px';
      try{ handle.releasePointerCapture(e.pointerId); }catch(err){}
      state.legs = null;
      saveState();
      recomputeLegs().then(()=>{ saveState(); renderResults(); });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

function renderResults(){
  const wrap = document.getElementById('resultsWrap');
  if(!state.order || !state.legs){ wrap.innerHTML = ''; return; }
  const orderedStops = state.order.map(id => stopById(id)).filter(Boolean);
  const totalKm = state.legs.reduce((a,l)=>a+l.km, 0);
  const totalMin = state.legs.reduce((a,l)=>a+l.min, 0);

  let legsHtml = orderedStops.map((s,i) => {
    const from = i===0 ? (state.depot ? 'Start' : s.name) : orderedStops[i-1].name;
    if(i===0 && !state.depot) return '';
    return '<li><span><b>'+escapeHtml(from)+'</b> → '+escapeHtml(s.name)+'</span><span class="km">'+fmtKm(state.legs[i].km)+'</span></li>';
  }).join('');

  const navBase = state.settings.navApp === 'waze' ? null : 'google';
  let linksHtml;
  if(state.settings.navApp === 'waze'){
    linksHtml = orderedStops.map((s,i) =>
      '<a class="gmaps-btn btn btn-ghost" style="margin-bottom:8px; justify-content:space-between; display:flex;" href="https://waze.com/ul?ll='+s.lat+','+s.lng+'&navigate=yes" target="_blank" rel="noopener">'
      + '<span>'+(i+1)+'. Waze to '+escapeHtml(s.name)+'</span><span>→</span></a>'
    ).join('');
  } else {
    const coords = (state.depot ? [state.depot] : []).concat(orderedStops).map(p => p.lat.toFixed(6)+','+p.lng.toFixed(6));
    const CHUNK = 10;
    const links = [];
    let start = 0;
    while(start < coords.length-1){
      const end = Math.min(start+CHUNK-1, coords.length-1);
      const seg = coords.slice(start, end+1);
      const origin = seg[0], destination = seg[seg.length-1], waypoints = seg.slice(1,-1);
      let url = 'https://www.google.com/maps/dir/?api=1&origin='+origin+'&destination='+destination;
      if(waypoints.length) url += '&waypoints='+waypoints.join('|');
      url += '&travelmode='+state.settings.travelMode;
      links.push(url);
      start = end;
    }
    linksHtml = links.map((url,i) =>
      '<a class="gmaps-btn btn btn-ghost" style="margin-bottom:8px; justify-content:space-between; display:flex;" href="'+url+'" target="_blank" rel="noopener">'
      + '<span>Open leg '+(i+1)+' of '+links.length+' in Google Maps</span><span>→</span></a>'
    ).join('');
  }

  wrap.innerHTML = ''
    + '<div class="stats">'
    + '<div class="stat"><div class="num">'+fmtKm(totalKm)+'</div><div class="lbl">Distance</div></div>'
    + '<div class="stat"><div class="num">'+fmtMin(totalMin)+'</div><div class="lbl">Est. time</div></div>'
    + '<div class="stat"><div class="num">'+orderedStops.length+'</div><div class="lbl">Stops</div></div>'
    + '</div>'
    + '<div class="card"><h2>Navigate<span class="h2-note">'+(state.legSource==='ors'?'road distances':'straight-line estimate')+'</span></h2>'+linksHtml+'</div>'
    + '<div class="card"><h2>Stop-by-stop order</h2><ul class="leg-list">'+legsHtml+'</ul></div>';
}

// ---------- stop edit sheet ----------
let editPhotoUrl = null;

async function renderEditPhotoPreview(s){
  const wrap = document.getElementById('editPhotoWrap');
  if(editPhotoUrl){ URL.revokeObjectURL(editPhotoUrl); editPhotoUrl = null; }
  if(!s.hasPhoto){ wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  const blob = await getPhoto(s.id);
  if(!blob){ wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  editPhotoUrl = URL.createObjectURL(blob);
  wrap.style.display = 'block';
  wrap.innerHTML = '<div class="photo-preview"><img src="'+editPhotoUrl+'" alt="Delivery photo">'
    + '<button class="link-btn" id="editPhotoRemoveBtn">Remove photo</button></div>';
  document.getElementById('editPhotoRemoveBtn').onclick = async () => {
    await deletePhoto(s.id);
    s.hasPhoto = false;
    saveState();
    renderEditPhotoPreview(s);
  };
}

function openStopEditSheet(id){
  const s = stopById(id);
  if(!s) return;
  editingStopId = id;
  document.getElementById('editNameInput').value = s.name;
  document.getElementById('editNotesInput').value = s.notes || '';
  document.getElementById('editPhoneInput').value = s.phone || '';
  document.getElementById('editCodInput').value = s.cod != null ? s.cod : '';
  renderEditPhotoPreview(s);
  openSheet('stopEditSheet');
}

// ---------- address autocomplete (reusable — single-add and scheduled-delivery forms) ----------
// Each input gets its own isolated timer/controller/items via closure, so the
// two address fields on screen never interfere with each other. `onSelect(it)`
// fires with the picked {label,lat,lng,approx} — the caller is responsible for
// committing that coordinate (e.g. as pendingCoord) so Add uses the geocoder's
// precise pin instead of re-resolving the label text through a different,
// less accurate geocoder at commit time.
function createAddressAutocomplete(inputEl, listEl, onSelect){
  let timer = null, controller = null, items = [];

  function hide(){
    clearTimeout(timer);
    if(controller){ controller.abort(); controller = null; }
    items = [];
    listEl.innerHTML = '';
    listEl.style.display = 'none';
  }

  function render(newItems){
    items = newItems;
    if(!items.length){ listEl.innerHTML = ''; listEl.style.display = 'none'; return; }
    listEl.innerHTML = items.map((it,i) =>
      '<li class="autocomplete-item" data-idx="'+i+'">'
      + '<span class="autocomplete-badge" title="'+(it.approx ? 'Street match only — house number not confirmed' : 'Predicted — please confirm')+'">!</span>'
      + '<span class="autocomplete-label">'+escapeHtml(it.label)+(it.approx ? ' (street only)' : '')+'</span>'
      + '</li>'
    ).join('');
    listEl.style.display = 'block';
    listEl.querySelectorAll('.autocomplete-item').forEach(el => {
      // Prevent the input from blurring on tap, so selection fires before any blur-hide logic.
      el.addEventListener('mousedown', e => e.preventDefault());
      el.addEventListener('click', () => {
        const it = items[parseInt(el.getAttribute('data-idx'),10)];
        hide();
        // Set the text without dispatching 'input' — that would re-trigger a
        // fresh autocomplete search on the now-filled field (reopening this same
        // dropdown) and, worse, wipe the precise coordinate we just resolved by
        // sending the caller back through resolveStopText() on Add.
        inputEl.value = it.label;
        onSelect(it);
        inputEl.focus();
      });
    });
  }

  function schedule(val){
    clearTimeout(timer);
    if(controller){ controller.abort(); controller = null; }
    timer = setTimeout(async () => {
      controller = new AbortController();
      const result = await liveAutocomplete(val, controller.signal);
      if(result === null) return; // aborted — a newer keystroke superseded this request
      render(result);
    }, 300);
  }

  inputEl.addEventListener('blur', () => setTimeout(hide, 150));
  return {schedule, hide};
}

// ---------- single add ----------
function setupSingleAddHandlers(){
  const stopInput = document.getElementById('stopInput');
  const stopStatus = document.getElementById('stopDetectStatus');
  const nameFieldWrap = document.getElementById('nameFieldWrap');
  const extraFieldsWrap = document.getElementById('extraFieldsWrap');
  const addBtn = document.getElementById('addBtn');
  const stopAC = createAddressAutocomplete(stopInput, document.getElementById('autocompleteList'), (it) => {
    pendingCoord = {lat: it.lat, lng: it.lng, approx: it.approx};
    stopStatus.innerHTML = '<div class="ok-text">✓ Ready — '+it.lat.toFixed(5)+', '+it.lng.toFixed(5)+'</div>';
    nameFieldWrap.style.display = 'block';
    extraFieldsWrap.style.display = 'block';
    addBtn.disabled = false;
    const nameInput = document.getElementById('nameInput');
    if(nameInput && !nameInput.value) nameInput.value = it.label;
  });

  stopInput.addEventListener('input', () => {
    const val = stopInput.value.trim();
    pendingCoord = null;
    if(!val){
      stopStatus.innerHTML = '';
      nameFieldWrap.style.display = 'none';
      extraFieldsWrap.style.display = 'none';
      addBtn.disabled = true;
      stopAC.hide();
      return;
    }
    if(isShortLink(val) && !extractLatLng(val)){
      addBtn.disabled = true;
      stopStatus.innerHTML = '<div class="warn-text">Short links (goo.gl) don\'t contain coordinates. Open it once in Maps, then paste the full link or long-press the pin to copy "lat,lng".</div>';
      stopAC.hide();
      return;
    }
    const coord = extractLatLng(val);
    nameFieldWrap.style.display = 'block';
    extraFieldsWrap.style.display = 'block';
    addBtn.disabled = false;
    if(coord){
      pendingCoord = coord;
      stopStatus.innerHTML = '<div class="ok-text">✓ Ready — '+coord.lat.toFixed(5)+', '+coord.lng.toFixed(5)+'</div>';
      const nameInput = document.getElementById('nameInput');
      if(nameInput && !nameInput.value){
        const nm = extractPlaceName(val);
        if(nm) nameInput.value = nm;
      }
      stopAC.hide();
    } else if(/^https?:\/\//i.test(val)){
      stopStatus.innerHTML = '<div class="hint">Looks like a link — it\'ll be looked up when you tap Add.</div>';
      stopAC.hide();
    } else {
      stopStatus.innerHTML = '<div class="hint">Looks like an address — it\'ll be looked up when you tap Add.</div>';
      if(val.length >= 3) stopAC.schedule(val);
      else stopAC.hide();
    }
  });

  addBtn.onclick = async () => {
    const val = stopInput.value.trim();
    if(!val) return;
    let coord = pendingCoord;
    if(!coord){
      addBtn.disabled = true;
      const stopStatus2 = document.getElementById('stopDetectStatus');
      stopStatus2.innerHTML = '<div class="hint">Looking up address…</div>';
      try{
        const r = await resolveStopText(val);
        if(r) coord = r;
        else stopStatus2.innerHTML = '<div class="err-text">Couldn\'t pinpoint that address at all. Search it in Google Maps or Waze instead and paste the link here (much more reliable), or paste lat,lng directly.</div>';
      }catch(e){
        stopStatus2.innerHTML = '<div class="err-text">Lookup failed. Check your connection and try again.</div>';
      }
      addBtn.disabled = false;
      if(!coord) return;
    }
    const nameInput = document.getElementById('nameInput');
    const name = (nameInput.value.trim()) || defaultStopName(val, coord) || ('Stop '+(state.stops.length+1));
    const notes = document.getElementById('notesInput').value.trim();
    const phone = document.getElementById('phoneInput').value.trim() || null;
    const codRaw = document.getElementById('codInput').value.trim();
    const cod = codRaw ? parseFloat(codRaw) : null;
    state.stops.push({id: genId(), name, lat: coord.lat, lng: coord.lng, notes, phone, cod, status:'pending', skipReason:null});
    if(state.order) state.order.push(state.stops[state.stops.length-1].id);
    pendingCoord = null;
    stopInput.value=''; nameInput.value=''; document.getElementById('notesInput').value='';
    document.getElementById('phoneInput').value=''; document.getElementById('codInput').value='';
    document.getElementById('stopDetectStatus').innerHTML = coord.approx ? '<div class="warn-text">Added — matched the street only, verify the exact house number.</div>' : '';
    nameFieldWrap.style.display='none'; extraFieldsWrap.style.display='none';
    addBtn.disabled = true;
    if(state.order){ await recomputeLegs(); }
    saveState();
    renderSetup();
  };
}

// ---------- bulk add ----------
function setupBulkAddHandlers(){
  document.getElementById('bulkParseBtn').onclick = async () => {
    const bulkInput = document.getElementById('bulkInput');
    const status = document.getElementById('bulkStatus');
    const parseBtn = document.getElementById('bulkParseBtn');
    const lines = bulkInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    if(lines.length === 0) return;
    // Disabled for the whole run: a second tap mid-parse would re-read the same
    // still-uncleared textarea and add every line a second time.
    parseBtn.disabled = true;
    status.textContent = 'Parsing '+lines.length+' line(s)… (one at a time, to stay within the free geocoders\' rate limits)';
    let added = 0, approxCount = 0;
    const failed = [];
    for(const line of lines){
      try{
        const r = await resolveStopText(line);
        if(r){
          const id = genId();
          const name = defaultStopName(line, r) || ('Stop '+(state.stops.length+1));
          state.stops.push({id, name, lat:r.lat, lng:r.lng, notes:'', phone:null, cod:null, status:'pending', skipReason:null});
          if(state.order) state.order.push(id);
          added++;
          if(r.approx) approxCount++;
        } else failed.push(line);
      }catch(e){
        failed.push(line + (e.message==='no-api-key' ? ' (needs API key)' : ''));
      }
      status.textContent = 'Parsed '+(added+failed.length)+' of '+lines.length+'…';
      // Nominatim's usage policy caps free lookups at ~1/sec — pace the loop accordingly.
      await new Promise(r => setTimeout(r, 1100));
    }
    if(state.order){ await recomputeLegs(); }
    saveState();
    renderSetup();
    status.textContent = added+' stop(s) added'
      + (approxCount ? ' ('+approxCount+' matched the street only — check the exact house number on arrival)' : '')
      + '.' + (failed.length ? ' Couldn\'t pinpoint at all (search these in Google Maps/Waze and paste the link instead): '+failed.join(' | ') : '');
    // Always clear — leftover text (even just the failed lines) sitting in the box
    // is exactly what caused duplicate stops when a later paste got run through it.
    bulkInput.value = '';
    parseBtn.disabled = false;
  };
}

// ---------- depot / GPS ----------
function setupDepotHandlers(){
  document.getElementById('gpsBtn').onclick = () => requestGpsDepot();

  const depotInput = document.getElementById('depotInput');
  const depotStatus = document.getElementById('depotDetectStatus');
  depotInput.addEventListener('input', () => {
    const val = depotInput.value.trim();
    if(!val){ depotStatus.innerHTML=''; return; }
    if(isShortLink(val) && !extractLatLng(val)){
      depotStatus.innerHTML = '<div class="warn-text">Short links don\'t contain coordinates — open it once in Maps, then paste the full link or "lat,lng".</div>';
      return;
    }
    const coord = extractLatLng(val);
    depotStatus.innerHTML = coord
      ? '<div class="ok-text">✓ Ready — '+coord.lat.toFixed(5)+', '+coord.lng.toFixed(5)+'</div>'
      : (orsKey() ? '<div class="hint">Looks like an address — it\'ll be looked up when you click away.</div>' : '<div class="warn-text">No coordinates in that yet.</div>');
  });
  depotInput.onblur = async () => {
    const val = depotInput.value.trim();
    if(!val){ state.depot = null; state.order=null; state.legs=null; saveState(); renderSetup(); return; }
    let coord = extractLatLng(val);
    if(!coord){
      try{ coord = await resolveStopText(val); }catch(e){ coord = null; }
    }
    if(coord){
      state.depot = {name: coord.label || 'Start', lat: coord.lat, lng: coord.lng, mode:'manual'};
      state.order = null; state.legs = null;
      saveState();
      renderSetup();
    }
  };
}

function requestGpsDepot(){
  const status = document.getElementById('depotGpsStatus');
  if(!navigator.geolocation){
    status.innerHTML = '<div class="err-text">Geolocation isn\'t available in this browser.</div>';
    return;
  }
  status.innerHTML = '<div class="hint">Locating…</div>';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.depot = {name:'My location', lat: pos.coords.latitude, lng: pos.coords.longitude, mode:'gps'};
      state.order = null; state.legs = null;
      saveState();
      document.getElementById('depotInput').value = '';
      renderSetup();
    },
    (err) => {
      status.innerHTML = '<div class="warn-text">Couldn\'t get your location ('+err.message+'). Paste a start point manually below, or leave it blank to start from your first stop.</div>';
    },
    {enableHighAccuracy:true, timeout:10000, maximumAge:60000}
  );
}

// ---------- misc setup handlers ----------
function setupModeToggleHandlers(){
  document.getElementById('modeSingleBtn').onclick = () => {
    document.getElementById('modeSingleBtn').classList.add('active');
    document.getElementById('modeBulkBtn').classList.remove('active');
    document.getElementById('singleAddWrap').style.display = 'block';
    document.getElementById('bulkAddWrap').style.display = 'none';
  };
  document.getElementById('modeBulkBtn').onclick = () => {
    document.getElementById('modeBulkBtn').classList.add('active');
    document.getElementById('modeSingleBtn').classList.remove('active');
    document.getElementById('bulkAddWrap').style.display = 'block';
    document.getElementById('singleAddWrap').style.display = 'none';
  };
}

function setupRouteSettingsHandlers(){
  document.getElementById('speedInput').onchange = (e) => { state.settings.speed = parseFloat(e.target.value)||18; saveState(); };
  document.getElementById('dwellInput').onchange = (e) => { state.settings.dwell = parseFloat(e.target.value)||0; saveState(); };
  document.getElementById('modeInput').onchange = (e) => { state.settings.travelMode = e.target.value; state.legs=null; saveState(); if(state.order){ recomputeLegs().then(()=>{saveState(); renderResults();}); } };
  document.getElementById('optimizeBtn').onclick = optimizeRoute;
  document.getElementById('startRouteBtn').onclick = startRoute;
}

function setupStopEditSheetHandlers(){
  document.getElementById('editStopSaveBtn').onclick = () => {
    const s = stopById(editingStopId);
    if(!s) return;
    s.name = document.getElementById('editNameInput').value.trim() || s.name;
    s.notes = document.getElementById('editNotesInput').value.trim();
    s.phone = document.getElementById('editPhoneInput').value.trim() || null;
    const codRaw = document.getElementById('editCodInput').value.trim();
    s.cod = codRaw ? parseFloat(codRaw) : null;
    saveState();
    closeSheet('stopEditSheet');
    renderSetup();
  };
  document.getElementById('editStopDeleteBtn').onclick = () => {
    state.stops = state.stops.filter(s => s.id !== editingStopId);
    if(state.order) state.order = state.order.filter(id => id !== editingStopId);
    saveState();
    deletePhoto(editingStopId);
    closeSheet('stopEditSheet');
    if(state.order){ recomputeLegs().then(()=>{ saveState(); renderSetup(); }); }
    else renderSetup();
  };
  document.getElementById('editStopCancelBtn').onclick = () => closeSheet('stopEditSheet');
}

function setupClearStopsHandler(){
  document.getElementById('clearStopsBtn').onclick = () => {
    if(state.stops.length === 0) return;
    if(confirm('Clear all '+state.stops.length+' stop(s) and route data? This can\'t be undone.')){
      resetForNewRoute();
      clearAllPhotos();
      renderSetup();
    }
  };
}

function initSetup(){
  setupModeToggleHandlers();
  setupSingleAddHandlers();
  setupBulkAddHandlers();
  setupDepotHandlers();
  setupRouteSettingsHandlers();
  setupStopEditSheetHandlers();
  setupClearStopsHandler();
  if(!state.depot) requestGpsDepot();
  renderSetup();
}
