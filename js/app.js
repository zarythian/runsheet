// App shell: view switching, shared sheet helpers, settings, boot.

function closeAllSheets(){
  document.querySelectorAll('.sheet.show').forEach(s => s.classList.remove('show'));
  document.getElementById('sheetOverlay').classList.remove('show');
}
function openSheet(id){
  closeAllSheets();
  document.getElementById('sheetOverlay').classList.add('show');
  document.getElementById(id).classList.add('show');
}
function closeSheet(id){
  document.getElementById(id).classList.remove('show');
  document.getElementById('sheetOverlay').classList.remove('show');
}

function showView(view){
  document.getElementById('setupView').style.display = view === 'setup' ? 'block' : 'none';
  document.getElementById('hudView').style.display = view === 'hud' ? 'block' : 'none';
  if(view === 'setup') renderSetup();
  else renderHud();
}

function initSettingsSheet(){
  document.getElementById('settingsBtn').onclick = () => {
    document.getElementById('orsKeyInput').value = state.settings.orsKey;
    document.getElementById('navAppInput').value = state.settings.navApp;
    document.getElementById('reasonsInput').value = state.settings.reasons.join(', ');
    openSheet('settingsSheet');
  };
  document.getElementById('settingsSaveBtn').onclick = () => {
    state.settings.orsKey = document.getElementById('orsKeyInput').value.trim();
    state.settings.navApp = document.getElementById('navAppInput').value;
    const reasons = document.getElementById('reasonsInput').value.split(',').map(r => r.trim()).filter(Boolean);
    if(reasons.length) state.settings.reasons = reasons;
    saveState();
    closeSheet('settingsSheet');
    renderSetup();
  };
  document.getElementById('settingsCancelBtn').onclick = () => closeSheet('settingsSheet');
  document.getElementById('clearAllBtn').onclick = () => {
    if(confirm('Clear all stops and route data? This can\'t be undone.')){
      resetForNewRoute();
      closeSheet('settingsSheet');
      showView('setup');
    }
  };
}

document.getElementById('sheetOverlay').addEventListener('click', closeAllSheets);

function init(){
  loadState();
  if(state.settings.sunMode) document.body.classList.add('sun');
  initSettingsSheet();
  initSetup();
  initHud();
  showView(state.view);

  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(()=>{ /* offline shell is best-effort */ });
    });
  }
}

init();
