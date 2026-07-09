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

// Nominatim (OpenStreetMap) result types coarser than these are administrative
// areas (city/town/suburb/...) — same rejection logic as the Pelias layer check.
const NOMINATIM_REJECT_TYPES = ['city','town','village','hamlet','suburb','neighbourhood',
  'state','country','county','administrative','municipality','borough','region'];

const ORS_PROFILE = {bicycling:'cycling-regular', driving:'driving-car', walking:'foot-walking'};

function orsKey(){ return (state.settings.orsKey || '').trim(); }

// This app's service area: Kfar Saba / Ra'anana / Hod HaSharon plus the ring of
// neighbouring moshavim around them (Ramot HaShavim, Kfar Malal, Tzofit, Even
// Yehuda, Sde Warburg, etc). Used to bias/filter every geocode call the same way,
// whether it's live autocomplete or a final commit-time lookup (ORS or Nominatim).
const SHARON_BIAS = {lat: 32.19, lng: 34.90};
const SHARON_RADIUS_KM = 15;

// Pelias labels read like "Weizmann Avenue, HM, Israel" — drop the trailing
// region-code/country segments so a label used as a stop name doesn't look like that.
function cleanLabel(label){
  if(!label) return label;
  const parts = label.split(',').map(p => p.trim()).filter(Boolean);
  return (parts.length > 2 ? parts.slice(0, parts.length - 2) : parts).join(', ');
}

// Rough lat/lng bounding box for a given radius (km) around a center point —
// used for Nominatim's viewbox bias, which (unlike Pelias) has no simple radius param.
function bboxFromRadius(lat, lng, radiusKm){
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos(lat * Math.PI/180));
  return {left: lng-dLng, top: lat+dLat, right: lng+dLng, bottom: lat-dLat};
}

// Build a "Street housenumber, City" style label from Photon's structured
// properties instead of its raw `name`, which is often just the street or POI.
function photonLabel(props){
  const parts = [];
  if(props.street) parts.push(props.housenumber ? props.street+' '+props.housenumber : props.street);
  else if(props.name) parts.push(props.name);
  const locality = props.city || props.town || props.village || props.county;
  if(locality) parts.push(locality);
  return parts.join(', ');
}

// Live-typing suggestions via Photon (komoot's free public geocoder, OSM-backed,
// no API key). Unlike ORS's Pelias autocomplete, Photon does real prefix
// matching on structured queries too — house number, comma, second word and
// all — so this alone replaces the old ORS-then-Nominatim hybrid, which broke
// down for anything past a single bare word. `bbox` hard-filters to this app's
// service area since Photon's `lat`/`lon` are only a soft ranking bias. Returns
// [{label,lat,lng}], [] if nothing found, or null if the request was aborted
// (signal) — callers should treat null as "ignore, a newer one is in flight".
async function liveAutocomplete(text, signal){
  const bbox = bboxFromRadius(SHARON_BIAS.lat, SHARON_BIAS.lng, SHARON_RADIUS_KM);
  const url = 'https://photon.komoot.io/api/?q='+encodeURIComponent(text)
    +'&limit=5&lang=en&lat='+SHARON_BIAS.lat+'&lon='+SHARON_BIAS.lng
    +'&bbox='+bbox.left+','+bbox.bottom+','+bbox.right+','+bbox.top;
  try{
    const res = await fetch(url, {signal});
    if(!res.ok) return [];
    const data = await res.json();
    return (data.features || [])
      .map(f => ({label: photonLabel(f.properties), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0]}))
      .filter(it => it.label);
  }catch(e){
    if(e.name === 'AbortError') return null;
    return [];
  }
}

// Try ORS Pelias search first, biased and filtered to this app's service area so
// queries don't match similarly-named places elsewhere. Returns {lat,lng,label}
// or null if nothing at address/street/venue precision was found.
async function geocodeViaORS(text){
  const key = orsKey();
  if(!key) throw new Error('no-api-key');
  const url = 'https://api.openrouteservice.org/geocode/search?api_key='+encodeURIComponent(key)
    +'&text='+encodeURIComponent(text)+'&size=3'
    +'&boundary.country=ISR&focus.point.lat='+SHARON_BIAS.lat+'&focus.point.lon='+SHARON_BIAS.lng
    +'&boundary.circle.lat='+SHARON_BIAS.lat+'&boundary.circle.lon='+SHARON_BIAS.lng+'&boundary.circle.radius='+SHARON_RADIUS_KM;
  const res = await fetch(url);
  if(!res.ok) throw new Error('geocode-http-'+res.status);
  const data = await res.json();
  const features = data.features || [];
  const f = features.find(feat => ACCEPTABLE_GEOCODE_LAYERS.includes(feat.properties.layer));
  if(!f) return null;
  // 'street' layer means it found the right road but not this specific house number.
  return {lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: cleanLabel(f.properties.label), approx: f.properties.layer === 'street'};
}

// Fallback: Nominatim (OpenStreetMap) has meaningfully better street-level
// coverage than ORS's Pelias index for this app's Israel service area — ORS
// often only has a city-center match where Nominatim has the actual street.
// No API key needed; free public endpoint, used sparingly (one lookup at a time).
async function geocodeViaNominatim(text){
  const bbox = bboxFromRadius(SHARON_BIAS.lat, SHARON_BIAS.lng, SHARON_RADIUS_KM);
  const url = 'https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(text)
    +'&format=jsonv2&limit=3&countrycodes=il&addressdetails=1'
    +'&viewbox='+bbox.left+','+bbox.top+','+bbox.right+','+bbox.bottom+'&bounded=1';
  const res = await fetch(url);
  if(!res.ok) return null;
  const results = await res.json();
  const hit = results.find(r => !NOMINATIM_REJECT_TYPES.includes(r.type));
  if(!hit) return null;
  // No house_number match means we only found the street, not this exact address point.
  const approx = !(hit.address && hit.address.house_number);
  // Nominatim's display_name is a full admin hierarchy ("street, city, sub-district,
  // district, country") rather than Pelias's "name, region, country" shape, so this
  // needs its own trim (just street + city) instead of the Pelias-shaped cleanLabel.
  const label = hit.display_name.split(',').slice(0,2).map(s => s.trim()).join(', ');
  return {lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), label, approx};
}

// Geocode free text, trying ORS first, then Nominatim if ORS has nothing precise
// enough (or no ORS key is set — Nominatim needs none). Returns {lat,lng,label}
// or null if neither source found a real match.
async function geocodeAddress(text){
  try{
    const viaOrs = await geocodeViaORS(text);
    if(viaOrs) return viaOrs;
  }catch(e){
    if(e.message !== 'no-api-key') throw e;
  }
  return await geocodeViaNominatim(text);
}

// Resolve any raw input (gmaps link, lat,lng, or free-text address) into {lat,lng,label|null}.
// Throws 'no-api-key' only when geocoding was actually required and no key is set.
async function resolveStopText(text){
  text = sanitizeText(text);
  const coord = extractLatLng(text);
  if(coord) return {lat: coord.lat, lng: coord.lng, label: extractPlaceName(text), approx: false};
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
