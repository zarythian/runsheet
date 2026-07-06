// Text/link parsing (ported from courier-route-optimizer.html) + OpenRouteService calls.

function isShortLink(text){
  return /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(text);
}
function extractPlaceName(text){
  let m = text.match(/\/place\/([^\/@]+)/);
  if(m){
    try{ return decodeURIComponent(m[1].replace(/\+/g,' ')); }
    catch(e){ return m[1].replace(/\+/g,' '); }
  }
  return null;
}

// Strip bidi/invisible control characters and normalize odd whitespace that mobile
// keyboards (especially RTL/Hebrew ones) can silently insert around pasted text.
// Built from plain decimal char codes (not escape literals) to avoid any editor/
// encoding ambiguity around invisible characters in the source itself.
const INVISIBLE_CODES = [8203,8204,8205,8206,8207,8234,8235,8236,8237,8238,8294,8295,8296,8297,65279];
const ODD_SPACE_CODES = [160,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,12288];
function sanitizeText(text){
  let out = '';
  for(let i=0;i<text.length;i++){
    const code = text.charCodeAt(i);
    if(INVISIBLE_CODES.indexOf(code) !== -1) continue;
    out += ODD_SPACE_CODES.indexOf(code) !== -1 ? ' ' : text[i];
  }
  return out.trim();
}

function extractLatLng(text){
  if(!text) return null;
  text = sanitizeText(text);
  let m;
  // plain "lat, lng" or "lat lng" (comma optional — some apps/keyboards drop it)
  m = text.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if(m) return {lat: parseFloat(m[1]), lng: parseFloat(m[2])};
  // .../@lat,lng,17z
  m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if(m) return {lat: parseFloat(m[1]), lng: parseFloat(m[2])};
  // ?q=lat,lng  or &q=lat,lng
  m = text.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if(m) return {lat: parseFloat(m[1]), lng: parseFloat(m[2])};
  // place url !3dLAT!4dLNG
  m = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if(m) return {lat: parseFloat(m[1]), lng: parseFloat(m[2])};
  return null;
}

// Pelias "layer" values coarser than these (city/region/country-level) mean the
// geocoder couldn't find the actual address/street — reject rather than silently
// handing back a city-center pin as if it were precise.
const ACCEPTABLE_GEOCODE_LAYERS = ['address','street','venue'];

const ORS_PROFILE = {bicycling:'cycling-regular', driving:'driving-car', walking:'foot-walking'};

function orsKey(){ return (state.settings.orsKey || '').trim(); }

// Geocode a free-text address via ORS Pelias search, biased to Israel (this app's
// service area) so queries don't match similarly-named places in other countries.
// Returns {lat,lng,label} or null if nothing precise enough was found.
async function geocodeAddress(text){
  const key = orsKey();
  if(!key) throw new Error('no-api-key');
  const url = 'https://api.openrouteservice.org/geocode/search?api_key='+encodeURIComponent(key)
    +'&text='+encodeURIComponent(text)+'&size=3'
    +'&boundary.country=ISR&focus.point.lat=32.18&focus.point.lon=34.91';
  const res = await fetch(url);
  if(!res.ok) throw new Error('geocode-http-'+res.status);
  const data = await res.json();
  const features = data.features || [];
  const f = features.find(feat => ACCEPTABLE_GEOCODE_LAYERS.includes(feat.properties.layer));
  if(!f) return null;
  return {lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: f.properties.label};
}

// Resolve any raw input (gmaps link, lat,lng, or free-text address) into {lat,lng,label|null}.
// Throws 'no-api-key' only when geocoding was actually required and no key is set.
async function resolveStopText(text){
  text = sanitizeText(text);
  const coord = extractLatLng(text);
  if(coord) return {lat: coord.lat, lng: coord.lng, label: extractPlaceName(text)};
  if(isShortLink(text)) throw new Error('short-link');
  // A maps link with no embedded coordinates: geocode the readable place name
  // (if any) instead of the raw URL, which the geocoder can't parse usefully.
  const placeName = extractPlaceName(text);
  return await geocodeAddress(placeName || text);
}

// Ask ORS Optimization API (VROOM) for the best open-path visiting order.
// stops: [{id,lat,lng}], start: {lat,lng}. Returns ordered array of stop ids, or null on failure.
async function orsOptimizeOrder(stops, start, travelMode){
  const key = orsKey();
  if(!key || stops.length === 0) return null;
  const profile = ORS_PROFILE[travelMode] || 'cycling-regular';
  const body = {
    jobs: stops.map((s,idx) => ({id: idx+1, location: [s.lng, s.lat]})),
    vehicles: [{id: 1, profile, start: [start.lng, start.lat]}]
  };
  try{
    const res = await fetch('https://api.openrouteservice.org/optimization', {
      method: 'POST',
      headers: {Authorization: key, 'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if(!res.ok) return null;
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if(!route) return null;
    const ids = route.steps.filter(st => st.type === 'job').map(st => stops[st.job-1].id);
    return ids;
  }catch(e){ return null; }
}

// Get real per-leg distance(km)/duration(min) for an ordered list of {lat,lng} points via ORS Directions.
// Returns array of {km,min} with length points.length-1, or null on failure.
async function orsLegDistances(points, travelMode){
  const key = orsKey();
  if(!key || points.length < 2) return null;
  const profile = ORS_PROFILE[travelMode] || 'cycling-regular';
  const body = {
    coordinates: points.map(p => [p.lng, p.lat]),
    instructions: false
  };
  try{
    const res = await fetch('https://api.openrouteservice.org/v2/directions/'+profile, {
      method: 'POST',
      headers: {Authorization: key, 'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if(!res.ok) return null;
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if(!route || !route.segments) return null;
    return route.segments.map(seg => ({km: seg.distance/1000, min: seg.duration/60}));
  }catch(e){ return null; }
}
