/*
 * terrain-worker.js — Web Worker for AWS Terrarium terrain tile fetch + contour generation
 *
 * Runs off the main thread so the UI never freezes.
 * Receives:  { bbox: {south,west,north,east}, zoom: number, intervalM: number }
 * Sends back:
 *   { type:'progress', msg }
 *   { type:'done',     terrainPoints, contourSegments }
 *   { type:'error',    message }
 */

// ── Tile helpers ─────────────────────────────────────────────────────────
function lonToTileX(lon, z) { return Math.floor((lon + 180) / 360 * (1 << z)); }
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z));
}
function tileXToLon(tx, z) { return tx / (1 << z) * 360 - 180; }
function tileYToLat(ty, z) {
  const n = Math.PI - 2 * Math.PI * ty / (1 << z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// ── UTM helpers (lightweight, no imports) ────────────────────────────────
function wgs84ToUTM(lat, lng, zone) {
  const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = 2 * f - f * f, n2 = e2 / (1 - e2);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat * Math.PI / 180, lam = lng * Math.PI / 180 - lon0;
  const sinP = Math.sin(phi), cosP = Math.cos(phi), tanP = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinP * sinP);
  const T = tanP * tanP, C = n2 * cosP * cosP, A = cosP * lam;
  const M = a * ((1 - e2/4 - 3*e2*e2/64)*phi - (3*e2/8+3*e2*e2/32)*Math.sin(2*phi) + (15*e2*e2/256)*Math.sin(4*phi));
  const x = k0*N*(A+(1-T+C)*A*A*A/6+(5-18*T+T*T+72*C-58*n2)*A*A*A*A*A/120)+500000;
  const y = k0*(M+N*tanP*(A*A/2+(5-T+9*C+4*C*C)*A*A*A*A/24+(61-58*T+T*T+600*C-330*n2)*A*A*A*A*A*A/720))+(lat<0?10000000:0);
  return { x, y };
}

// ── Fetch a single Terrarium tile, return { points: [{lat,lng,ele,x,y}] } ─
async function fetchTile(tx, ty, z, anchorX, anchorY) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob   = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const tileW = tileXToLon(tx+1, z) - tileXToLon(tx, z);
    const tileH = tileYToLat(ty, z)   - tileYToLat(ty+1, z);
    const west  = tileXToLon(tx, z);
    const north = tileYToLat(ty, z);
    const step  = 4; // ~32m spacing
    const points = [];

    for (let py = 0; py < canvas.height; py += step) {
      for (let px = 0; px < canvas.width; px += step) {
        const i = (py * canvas.width + px) * 4;
        const ele = (data[i] * 256 + data[i+1] + data[i+2] / 256) - 32768;
        const lat = north - (py / canvas.height) * tileH;
        const lng = west  + (px / canvas.width)  * tileW;
        // Scene coords: anchor is tile centre from caller
        const utm = wgs84ToUTM(lat, lng, _zone);
        points.push({ lat, lng, ele, x: utm.x - anchorX, y: utm.y - anchorY });
      }
    }
    return { points };
  } catch { return null; }
}

// ── Marching squares contour generation (pixel-index grid) ───────────────
// Uses the same tile-column-major index mapping as _buildTerrainFromWorker
// so no floating-point coordinate matching is needed.
async function buildContours(points, gridWidth, gridHeight, tilesX, tilesY, intervalM) {
  if (!points.length) return [];
  const TILE_GRID = Math.round(gridWidth / tilesX);

  // Build elevation + xy grids using pixel indices
  const N     = gridWidth * gridHeight;
  const elevs = new Float32Array(N);
  const pxs   = new Float32Array(N); // scene x (easting offset)
  const pys   = new Float32Array(N); // scene y (northing offset)
  const has   = new Uint8Array(N);
  let minE = Infinity, maxE = -Infinity;

  for (let giy = 0; giy < gridHeight; giy++) {
    for (let gix = 0; gix < gridWidth; gix++) {
      const tileIy  = Math.floor(giy / TILE_GRID);
      const tileIx  = Math.floor(gix / TILE_GRID);
      const tileIdx = tileIx * tilesY + tileIy;
      const ptIdx   = tileIdx * TILE_GRID * TILE_GRID + (giy % TILE_GRID) * TILE_GRID + (gix % TILE_GRID);
      const pt = ptIdx < points.length ? points[ptIdx] : null;
      if (!pt) continue;
      const k = giy * gridWidth + gix;
      elevs[k] = pt.ele; pxs[k] = pt.x; pys[k] = pt.y; has[k] = 1;
      if (pt.ele < minE) minE = pt.ele;
      if (pt.ele > maxE) maxE = pt.ele;
    }
  }
  if (!isFinite(minE)) return [];

  minE = Math.floor(minE / intervalM) * intervalM;
  maxE = Math.ceil (maxE / intervalM) * intervalM;
  const segments = []; // flat: [x0,y0,ele, x1,y1,ele, ...]

  const totalLevels = Math.max(1, Math.round((maxE - minE) / intervalM) + 1);
  let levelIdx = 0;
  self.postMessage({ type: 'progress', stage: 'contours', done: 0, total: totalLevels });

  for (let elev = minE; elev <= maxE; elev += intervalM) {
    for (let giy = 0; giy < gridHeight - 1; giy++) {
      const rowA = giy * gridWidth, rowB = (giy + 1) * gridWidth;
      for (let gix = 0; gix < gridWidth - 1; gix++) {
        const kA = rowA + gix, kB = rowB + gix;
        if (!has[kA] || !has[kA+1] || !has[kB] || !has[kB+1]) continue;
        const v00 = elevs[kA], v10 = elevs[kA+1], v01 = elevs[kB], v11 = elevs[kB+1];
        if ((v00<elev)===(v10<elev) && (v10<elev)===(v01<elev) && (v01<elev)===(v11<elev)) continue;
        const lerp = (a,b,va,vb) => a + (b-a)*(elev-va)/(vb-va);
        const pts = [];
        if ((v00<elev)!==(v10<elev)) pts.push([lerp(pxs[kA],pxs[kA+1],v00,v10), lerp(pys[kA],pys[kA+1],v00,v10)]);
        if ((v10<elev)!==(v11<elev)) pts.push([lerp(pxs[kA+1],pxs[kB+1],v10,v11), lerp(pys[kA+1],pys[kB+1],v10,v11)]);
        if ((v01<elev)!==(v11<elev)) pts.push([lerp(pxs[kB],pxs[kB+1],v01,v11), lerp(pys[kB],pys[kB+1],v01,v11)]);
        if ((v00<elev)!==(v01<elev)) pts.push([lerp(pxs[kA],pxs[kB],v00,v01), lerp(pys[kA],pys[kB],v00,v01)]);
        if (pts.length >= 2) segments.push(pts[0][0], pts[0][1], elev, pts[1][0], pts[1][1], elev);
      }
    }
    levelIdx++;
    self.postMessage({ type: 'progress', stage: 'contours', done: levelIdx, total: totalLevels });
    await new Promise(r => setTimeout(r, 0));
  }
  return segments;
}

// ── Main message handler ──────────────────────────────────────────────────
let _zone = 50; // default UTM zone, overwritten per message

self.onmessage = async ({ data }) => {
  const { bbox, zoom = 14, intervalM = 5, zone = 50, anchorX = 0, anchorY = 0 } = data;
  _zone = zone;

  try {
    const txMin = lonToTileX(bbox.west,  zoom);
    const txMax = lonToTileX(bbox.east,  zoom);
    const tyMin = latToTileY(bbox.north, zoom);
    const tyMax = latToTileY(bbox.south, zoom);
    const txCount = txMax - txMin + 1;
    const tyCount = tyMax - tyMin + 1;
    const totalTiles = txCount * tyCount;

    self.postMessage({ type: 'progress', stage: 'tiles', done: 0, total: totalTiles });

    // Fetch in parallel BUT count completions as they resolve so the main
    // thread sees real-time progress instead of a 30s silent wait.
    let doneTiles = 0;
    const tilePromises = [];
    for (let tx = txMin; tx <= txMax; tx++) {
      for (let ty = tyMin; ty <= tyMax; ty++) {
        tilePromises.push(
          fetchTile(tx, ty, zoom, anchorX, anchorY).then(result => {
            doneTiles++;
            self.postMessage({ type: 'progress', stage: 'tiles', done: doneTiles, total: totalTiles });
            return result;
          })
        );
      }
    }
    const tiles  = await Promise.all(tilePromises);
    const points = tiles.flatMap(t => t?.points ?? []);

    if (points.length < 4) {
      self.postMessage({ type: 'error', message: 'Insufficient elevation data for this area' });
      return;
    }

    // Grid dimensions: fetchTile uses step=4 on 256×256 tiles → 64 grid pts per tile side.
    const TILE_GRID  = 64; // 256 / step(4)
    const gridWidth  = txCount * TILE_GRID;
    const gridHeight = tyCount * TILE_GRID;

    const contourSegments = await buildContours(points, gridWidth, gridHeight, txCount, tyCount, intervalM);

    self.postMessage({ type: 'done', terrainPoints: points, contourSegments,
                       gridWidth, gridHeight, tilesX: txCount, tilesY: tyCount });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message ?? String(err) });
  }
};
