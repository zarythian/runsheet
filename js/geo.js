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
function extractLatLng(text){
  if(!text) return null;
  text = text.trim();
  let m;
  m = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(m) return {lat: parseFloat(m[1]), lng: parseFloat(m[2])};
  m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if(m) return {lat: parseFloat(m[1]), lng: parseFloat(m[2])};
  m = text.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if(m) return {lat: parseFloat(m[1]), lng: parseFloat(m[2])};
  m = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if(m) return {lat: parseFloat(m[1]), lng: parseFloat(m[2])};
  return null;
}

const ORS_PROFILE = {bicycling:'cycling-regular', driving:'driving-car', walking:'foot-walking'};

function orsKey(){ return (state.settings.orsKey || '').trim(); }

// Geocode a free-text address via ORS Pelias search. Returns {lat,lng,label} or null.
async function geocodeAddress(text){
  const key = orsKey();
  if(!key) throw new Error('no-api-key');
  const url = 'https://api.openrouteservice.org/geocode/search?api_key='+encodeURIComponent(key)
    +'&text='+encodeURIComponent(text)+'&size=1';
  const res = await fetch(url);
  if(!res.ok) throw new Error('geocode-http-'+res.status);
  const data = await res.json();
  const f = data.features && data.features[0];
  if(!f) return null;
  return {lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: f.properties.label};
}

// Resolve any raw input (gmaps link, lat,lng, or free-text address) into {lat,lng,label|null}.
// Throws 'no-api-key' only when geocoding was actually required and no key is set.
async function resolveStopText(text){
  text = text.trim();
  const coord = extractLatLng(text);
  if(coord) return {lat: coord.lat, lng: coord.lng, label: extractPlaceName(text)};
  if(isShortLink(text)) throw new Error('short-link');
  return await geocodeAddress(text);
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
