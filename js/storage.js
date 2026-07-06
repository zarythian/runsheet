// Persistence layer — single JSON blob in localStorage, no backend.
const STORE_KEY = 'runsheet-state-v1';

function defaultState(){
  return {
    view: 'setup',            // 'setup' | 'hud'
    depot: null,               // {lat,lng,name,mode:'gps'|'manual'}
    stops: [],                 // {id,name,lat,lng,notes,phone,cod,status:'pending'|'done'|'skipped',skipReason}
    order: null,               // array of stop ids, post-depot visiting order
    legs: null,                // [{fromId,toId,km,min}] aligned to order (fromId null = depot)
    legSource: null,           // 'ors' | 'haversine'
    settings: {
      orsKey: '',
      speed: 18,               // km/h, used for haversine time fallback
      dwell: 3,                // minutes per stop, used in fallback ETA sums
      travelMode: 'bicycling', // bicycling | driving | walking
      navApp: 'google',        // google | waze
      reasons: ['No answer','Wrong address','Refused','Gate locked'],
      sunMode: false
    },
    route: {
      startedAt: null,
      currentIndex: 0,
      kmTotal: 0,
      doneCount: 0,
      codCollected: 0,
      currentPrice: 0,
      runEarnings: 0,
      lastAction: null
    }
  };
}

let state = defaultState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      state = Object.assign(defaultState(), parsed);
      state.settings = Object.assign(defaultState().settings, parsed.settings || {});
      state.route = Object.assign(defaultState().route, parsed.route || {});
    }
  }catch(e){ /* corrupt or absent — start fresh */ }
  return state;
}

function saveState(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch(e){ /* storage full or unavailable — persistence is best-effort */ }
}

function resetForNewRoute(){
  const settings = state.settings;
  state = defaultState();
  state.settings = settings;
  saveState();
}
