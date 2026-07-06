// Straight-line TSP fallback (ported from courier-route-optimizer.html): nearest-neighbor + 2-opt,
// open path with the start fixed at index 0.

function haversine(a,b){
  const R = 6371;
  const dLat = (b.lat-a.lat)*Math.PI/180;
  const dLng = (b.lng-a.lng)*Math.PI/180;
  const s1 = Math.sin(dLat/2), s2 = Math.sin(dLng/2);
  const h = s1*s1 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
  return 2*R*Math.asin(Math.sqrt(h));
}

function pathDistance(order, pts){
  let d = 0;
  for(let i=0;i<order.length-1;i++) d += haversine(pts[order[i]], pts[order[i+1]]);
  return d;
}

function nearestNeighborOrder(pts){
  const n = pts.length;
  const visited = new Array(n).fill(false);
  visited[0] = true;
  const order = [0];
  for(let step=1; step<n; step++){
    const last = order[order.length-1];
    let best=-1, bestD=Infinity;
    for(let j=0;j<n;j++){
      if(visited[j]) continue;
      const d = haversine(pts[last], pts[j]);
      if(d<bestD){bestD=d;best=j;}
    }
    visited[best]=true;
    order.push(best);
  }
  return order;
}

function twoOpt(order, pts){
  let improved = true;
  let best = order.slice();
  while(improved){
    improved = false;
    for(let i=1;i<best.length-1;i++){
      for(let j=i+1;j<best.length;j++){
        const candidate = best.slice(0,i).concat(best.slice(i,j+1).reverse(), best.slice(j+1));
        if(pathDistance(candidate, pts) < pathDistance(best, pts) - 1e-9){
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

// pts[0] = start point, pts[1..] = stops. Returns order as indices into pts.
function heuristicOrder(pts){
  if(pts.length < 2) return pts.map((_,i)=>i);
  let order = nearestNeighborOrder(pts);
  order = twoOpt(order, pts);
  return order;
}
