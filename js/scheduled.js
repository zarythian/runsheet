// Scheduled (future) deliveries: logged ahead of time for a date other than
// today, with an optional company/client tag and a downloadable calendar
// reminder (.ics) for the evening before — no backend, so a real device alarm
// has to come from the phone's own calendar app rather than a push from here.

function pad2(n){ return String(n).padStart(2,'0'); }
function todayISO(){
  const d = new Date();
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
}
function tomorrowISO(){
  const d = new Date();
  d.setDate(d.getDate()+1);
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
}
function formatSchedDate(iso){
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
}

function scheduledById(id){ return state.scheduled.find(s => s.id === id); }

// ---------- ICS calendar export ----------
function toICSDate(date){
  return date.getUTCFullYear()+pad2(date.getUTCMonth()+1)+pad2(date.getUTCDate())
    +'T'+pad2(date.getUTCHours())+pad2(date.getUTCMinutes())+pad2(date.getUTCSeconds())+'Z';
}
function escapeICS(text){
  return String(text||'').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}

function buildICS(item){
  const [h,m] = (state.settings.reminderTime || '20:00').split(':').map(Number);
  const deliveryDate = new Date(item.date+'T00:00:00');
  const reminderStart = new Date(deliveryDate);
  reminderStart.setDate(reminderStart.getDate()-1);
  reminderStart.setHours(h, m, 0, 0);
  const reminderEnd = new Date(reminderStart.getTime() + 15*60000);

  const summary = 'Delivery reminder'+(item.company ? ': '+item.company : '')+' — '+item.name;
  const descParts = ['Deliver on '+item.date];
  if(item.notes) descParts.push(item.notes);
  if(item.phone) descParts.push('Phone: '+item.phone);
  if(item.cod) descParts.push('COD: ₪'+item.cod);
  descParts.push(item.lat.toFixed(5)+', '+item.lng.toFixed(5));

  const lines = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Runsheet//EN','CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:'+item.id+'@runsheet',
    'DTSTAMP:'+toICSDate(new Date()),
    'DTSTART:'+toICSDate(reminderStart),
    'DTEND:'+toICSDate(reminderEnd),
    'SUMMARY:'+escapeICS(summary),
    'DESCRIPTION:'+escapeICS(descParts.join('\n')),
    'BEGIN:VALARM','TRIGGER:-PT0M','ACTION:DISPLAY','DESCRIPTION:'+escapeICS(summary),'END:VALARM',
    'END:VEVENT','END:VCALENDAR'
  ];
  return lines.join('\r\n');
}

function downloadICS(item){
  const blob = new Blob([buildICS(item)], {type:'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'delivery-reminder-'+item.date+'.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- rendering ----------
function renderScheduled(){
  const list = document.getElementById('scheduledList');
  const items = state.scheduled.slice().sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if(items.length === 0){
    list.innerHTML = '<div class="empty">No upcoming deliveries logged yet.</div>';
    return;
  }
  const today = todayISO();
  list.innerHTML = items.map(item => {
    const overdue = item.date < today;
    const dueToday = item.date === today;
    return '<li class="sched-item'+(dueToday?' due-today':'')+(overdue?' overdue':'')+'" data-id="'+item.id+'">'
      + '<div class="sched-meta">'
        + '<div class="sched-date">'+formatSchedDate(item.date)+(dueToday?' <span class="flag-cod">due today</span>':overdue?' <span class="flag-cod">overdue</span>':'')+'</div>'
        + '<div class="stop-name">'+(item.company?'<b>'+escapeHtml(item.company)+'</b> — ':'')+escapeHtml(item.name)+'</div>'
        + '<div class="stop-coord">'+item.lat.toFixed(5)+', '+item.lng.toFixed(5)+stopFlags(item)+'</div>'
      + '</div>'
      + '<div class="stop-actions">'
        + '<button class="icon-mini-btn" data-ics="'+item.id+'" title="Add to calendar">\u{1F4C5}</button>'
        + '<button class="icon-mini-btn" data-promote="'+item.id+'" title="Add to today\'s route">→</button>'
        + '<button class="icon-mini-btn" data-del-sched="'+item.id+'" title="Remove">✕</button>'
      + '</div>'
      + '</li>';
  }).join('');

  list.querySelectorAll('[data-ics]').forEach(btn => {
    btn.onclick = () => downloadICS(scheduledById(btn.getAttribute('data-ics')));
  });
  list.querySelectorAll('[data-promote]').forEach(btn => {
    btn.onclick = () => promoteScheduled(btn.getAttribute('data-promote'));
  });
  list.querySelectorAll('[data-del-sched]').forEach(btn => {
    btn.onclick = () => {
      state.scheduled = state.scheduled.filter(s => s.id !== btn.getAttribute('data-del-sched'));
      saveState();
      renderScheduled();
    };
  });
}

function promoteScheduled(id){
  const item = scheduledById(id);
  if(!item) return;
  const notes = (item.company ? '['+item.company+'] ' : '') + (item.notes || '');

  const dup = findDuplicateStop(item.lat, item.lng);
  const shouldMerge = !!dup && confirm('This looks like the same address as "'+dup.name+'", already in today\'s route. Combine into that stop instead of adding a new one?');

  state.scheduled = state.scheduled.filter(s => s.id !== id);
  if(shouldMerge){
    mergeIntoStop(dup, {notes: notes.trim(), phone: item.phone, cod: item.cod});
  } else {
    state.stops.push({
      id: genId(), name: item.name, lat: item.lat, lng: item.lng,
      notes: notes.trim(), phone: item.phone, cod: item.cod,
      status: 'pending', skipReason: null
    });
    if(state.order) state.order.push(state.stops[state.stops.length-1].id);
  }
  saveState();
  if(state.order){ recomputeLegs().then(() => { saveState(); renderSetup(); renderScheduled(); }); }
  else { renderSetup(); renderScheduled(); }
}

// ---------- add form ----------
function setupScheduledHandlers(){
  const addrInput = document.getElementById('schedAddressInput');
  const status = document.getElementById('schedDetectStatus');
  const extraWrap = document.getElementById('schedExtraWrap');
  const nameInput = document.getElementById('schedNameInput');
  const addBtn = document.getElementById('schedAddBtn');
  const dateInput = document.getElementById('schedDateInput');

  dateInput.value = tomorrowISO();
  dateInput.min = todayISO();

  let pendingSchedCoord = null;
  const schedAC = createAddressAutocomplete(addrInput, document.getElementById('schedAutocompleteList'), (it) => {
    pendingSchedCoord = {lat: it.lat, lng: it.lng, approx: it.approx};
    status.innerHTML = '<div class="ok-text">✓ Ready — '+it.lat.toFixed(5)+', '+it.lng.toFixed(5)+'</div>';
    extraWrap.style.display = 'block';
    addBtn.disabled = false;
    if(!nameInput.value) nameInput.value = it.label;
  });

  addrInput.addEventListener('input', () => {
    const val = addrInput.value.trim();
    pendingSchedCoord = null;
    if(!val){
      status.innerHTML = ''; extraWrap.style.display = 'none'; addBtn.disabled = true;
      schedAC.hide();
      return;
    }
    if(isShortLink(val) && !extractLatLng(val)){
      addBtn.disabled = true;
      status.innerHTML = '<div class="warn-text">Short links (goo.gl) don\'t contain coordinates. Paste the full link or "lat,lng" instead.</div>';
      schedAC.hide();
      return;
    }
    const coord = extractLatLng(val);
    extraWrap.style.display = 'block';
    addBtn.disabled = false;
    if(coord){
      pendingSchedCoord = coord;
      status.innerHTML = '<div class="ok-text">✓ Ready — '+coord.lat.toFixed(5)+', '+coord.lng.toFixed(5)+'</div>';
      if(!nameInput.value){
        const nm = extractPlaceName(val);
        if(nm) nameInput.value = nm;
      }
      schedAC.hide();
    } else if(/^https?:\/\//i.test(val)){
      status.innerHTML = '<div class="hint">Looks like a link — it\'ll be looked up when you tap Add.</div>';
      schedAC.hide();
    } else {
      status.innerHTML = '<div class="hint">Looks like an address — it\'ll be looked up when you tap Add.</div>';
      if(val.length >= 3) schedAC.schedule(val);
      else schedAC.hide();
    }
  });

  addBtn.onclick = async () => {
    const val = addrInput.value.trim();
    if(!val || !dateInput.value) return;
    let coord = pendingSchedCoord;
    if(!coord){
      addBtn.disabled = true;
      status.innerHTML = '<div class="hint">Looking up address…</div>';
      try{
        const r = await resolveStopText(val);
        if(r) coord = r;
        else status.innerHTML = '<div class="err-text">Couldn\'t pinpoint that address. Search it in Google Maps/Waze and paste the link instead, or paste lat,lng directly.</div>';
      }catch(e){
        status.innerHTML = '<div class="err-text">Lookup failed. Check your connection and try again.</div>';
      }
      addBtn.disabled = false;
      if(!coord) return;
    }
    const name = nameInput.value.trim() || defaultStopName(val, coord) || 'Delivery';
    const company = document.getElementById('schedCompanyInput').value.trim() || null;
    const notes = document.getElementById('schedNotesInput').value.trim();
    const phone = document.getElementById('schedPhoneInput').value.trim() || null;
    const codRaw = document.getElementById('schedCodInput').value.trim();
    const cod = codRaw ? parseFloat(codRaw) : null;

    state.scheduled.push({
      id: genId(), name, lat: coord.lat, lng: coord.lng,
      notes, phone, cod, company, date: dateInput.value
    });
    saveState();

    addrInput.value = ''; nameInput.value = '';
    document.getElementById('schedCompanyInput').value = '';
    document.getElementById('schedNotesInput').value = '';
    document.getElementById('schedPhoneInput').value = '';
    document.getElementById('schedCodInput').value = '';
    dateInput.value = tomorrowISO();
    status.innerHTML = ''; extraWrap.style.display = 'none'; addBtn.disabled = true;
    pendingSchedCoord = null;
    renderScheduled();
  };
}

function initScheduled(){
  setupScheduledHandlers();
  renderScheduled();
}
