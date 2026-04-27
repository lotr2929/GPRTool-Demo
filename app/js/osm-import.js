/*
 * osm-import.js — Import site context from OpenStreetMap via Overpass API
 *
 * Free, global, no account required. Replaces "Select Site" command.
 * Produces identical layerGroups output to cadmapper-import.js so the
 * rest of GPRTool (boundary drawing, terrain, building stage) is format-agnostic.
 *
 * Data sources:
 *   Buildings, roads, parks, water, railways → Overpass API (OSM)
 *   Terrain mesh → AWS Terrain Tiles (Terrarium RGB encoding, free, no key)
 *
 * Axis convention: DXF/OSM North (Y) → Three.js -Z  (same as cadmapper-import.js)
 * All real-world coordinates enter via real-world.js wgs84ToScene().
 *
 * Exposes: initOSMImport(callbacks)
 * Callbacks: { THREE, onLayersLoaded(layerGroups, null) }
 */

import { setRealWorldAnchor, utmToWGS84, wgs84ToScene, wgs84ToUTM } from './real-world.js';
import { state } from './state.js';
import { buildLayerPanel } from './cadmapper-import.js';
import { startLocationPick, stopLocationPick } from './cesium-viewer.js';
import { addTerrainToGPR, getActiveGPRBlob } from './gpr-file.js';
import { writeBlobToHandle } from './local-folder.js';
import { setPipelineStatus } from './ui.js';

// ── Layer config — mirrors cadmapper-import.js LAYER_CONFIG ──────────────
const LAYER_CONFIG = {
  topography:  { label: 'Terrain',     color: 0xc8b890, opacity: 1.0,  yOffset: 0.000 },
  buildings:   { label: 'Buildings',   color: 0xd4d0c8, opacity: 0.85, yOffset: 0.000 },
  highways:    { label: 'Highways',    color: 0x808078, opacity: 1.0,  yOffset: 0.040 },
  major_roads: { label: 'Major Roads', color: 0x989890, opacity: 1.0,  yOffset: 0.030 },
  minor_roads: { label: 'Minor Roads', color: 0xa8a8a0, opacity: 1.0,  yOffset: 0.020 },
  paths:       { label: 'Paths',       color: 0xb8b8a8, opacity: 1.0,  yOffset: 0.010 },
  parks:       { label: 'Parks',       color: 0x70b850, opacity: 1.0,  yOffset: 0.005 },
  water:       { label: 'Water',       color: 0x5888c0, opacity: 0.85, yOffset: 0.005 },
  railways:    { label: 'Railways',    color: 0x585048, opacity: 1.0,  yOffset: 0.010 },
  contours:    { label: 'Contours',    color: 0xa08860, opacity: 0.7,  yOffset: 0.015 },
};

// Road widths (metres, Austroads) by OSM highway tag
const ROAD_WIDTHS = {
  motorway: 22, trunk: 18, primary: 14, secondary: 12,
  tertiary: 10, residential: 8, service: 5, living_street: 6,
  footway: 2, cycleway: 2, path: 2, steps: 2,
};

// ── Module state ──────────────────────────────────────────────────────────
let _callbacks = null;
let THREE      = null;  // set from callbacks at init, used by all geometry builders

// ── Modal HTML ────────────────────────────────────────────────────────────
// Two-phase top-bar overlay. Cesium 3D scene remains fully visible and
// clickable underneath. Single #osm-overlay host, two child blocks:
//   #osm-phase-a — Locate Site: address + Search + lat/lng inputs.
//   #osm-phase-b — Import OSM Context: radius + Import + Back, with
//                   read-only coords in the header bar.
// Promotion A→B fires when Search succeeds OR user clicks the globe.
// Per project colour rule: header bar uses --chrome-dark, body is light
// (--chrome-panel + --chrome-input + --text-primary).
const MODAL_HTML = `
<div id="osm-overlay" style="
  display:none; position:fixed; top:52px; left:0; right:0; z-index:1100;
  pointer-events:none;">

  <!-- ── Phase A: Locate Site ─────────────────────────────────────────── -->
  <div id="osm-phase-a" style="
    pointer-events:all;
    margin:0 auto; max-width:720px;
    background:var(--chrome-panel,#f0f0f0);
    border:1px solid var(--chrome-border,rgba(0,0,0,0.2));
    border-top:none; border-radius:0 0 8px 8px;
    box-shadow:0 6px 24px rgba(0,0,0,0.5);
    overflow:hidden;">

    <!-- Header bar (dark) -->
    <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;
                background:var(--chrome-dark,#1e3d1e);color:#fff;">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#90c890" stroke-width="1.4">
        <circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-3 4-3 6s1 4 3 6M8 2c2 2 3 4 3 6s-1 4-3 6"/>
      </svg>
      <span style="font-size:12px;font-weight:600;">Locate Site</span>
      <span id="osm-pick-hint-a" style="font-size:11px;color:#90c890;flex:1;">
        &#8595; Or click anywhere on the 3D map
      </span>
      <button id="osm-close-a" type="button" style="background:none;border:none;color:rgba(255,255,255,0.7);
        cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">&#x2715;</button>
    </div>

    <!-- Body (light) -->
    <div style="padding:12px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input id="osm-address" type="text" placeholder="Search address\u2026"
        style="flex:2;min-width:160px;background:var(--chrome-input,#fff);
        border:1px solid var(--chrome-border,#ccc);border-radius:4px;
        color:var(--text-primary,#222);font-size:12px;padding:5px 10px;outline:none;"
        onkeydown="if(event.key==='Enter') document.getElementById('osm-search-btn').click()">
      <button id="osm-search-btn" type="button" style="background:var(--accent-mid,#4a8a4a);color:#fff;border:none;
        border-radius:4px;font-size:11px;padding:5px 12px;cursor:pointer;white-space:nowrap;">
        Search
      </button>

      <div style="display:flex;align-items:center;gap:5px;">
        <span style="font-size:10px;color:var(--text-secondary,#666);">Lat</span>
        <input id="osm-lat" type="number" step="any" placeholder="\u2014"
          style="width:100px;background:var(--chrome-input,#fff);border:1px solid var(--chrome-border,#ccc);
          border-radius:4px;color:var(--text-primary,#222);font-size:11px;padding:4px 8px;outline:none;">
        <span style="font-size:10px;color:var(--text-secondary,#666);">Lng</span>
        <input id="osm-lng" type="number" step="any" placeholder="\u2014"
          style="width:110px;background:var(--chrome-input,#fff);border:1px solid var(--chrome-border,#ccc);
          border-radius:4px;color:var(--text-primary,#222);font-size:11px;padding:4px 8px;outline:none;">
      </div>

      <span id="osm-status-a" style="font-size:11px;color:var(--accent-mid,#4a8a4a);min-width:120px;"></span>
    </div>
  </div>

  <!-- ── Phase B: Import OSM Context ──────────────────────────────────── -->
  <div id="osm-phase-b" style="
    display:none;
    pointer-events:all;
    margin:0 auto; max-width:720px;
    background:var(--chrome-panel,#f0f0f0);
    border:1px solid var(--chrome-border,rgba(0,0,0,0.2));
    border-top:none; border-radius:0 0 8px 8px;
    box-shadow:0 6px 24px rgba(0,0,0,0.5);
    overflow:hidden;">

    <!-- Header bar (dark) -->
    <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;
                background:var(--chrome-dark,#1e3d1e);color:#fff;">
      <button id="osm-back-btn" type="button" style="background:rgba(255,255,255,0.12);
        border:1px solid rgba(255,255,255,0.3);color:#fff;cursor:pointer;
        font-size:11px;padding:3px 10px;border-radius:3px;">
        &larr; Back
      </button>
      <span style="font-size:12px;font-weight:600;">Import OSM Context</span>
      <span id="osm-coords-display" style="font-size:11px;color:#90c890;flex:1;font-family:monospace;"></span>
      <button id="osm-close-b" type="button" style="background:none;border:none;color:rgba(255,255,255,0.7);
        cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">&#x2715;</button>
    </div>

    <!-- Body (light) -->
    <div style="padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text-secondary,#666);">Radius:</span>
      <select id="osm-radius" style="font-size:11px;background:var(--chrome-input,#fff);
        border:1px solid var(--chrome-border,#ccc);border-radius:4px;padding:4px 8px;
        color:var(--text-primary,#222);outline:none;">
        <option value="250">250 m</option>
        <option value="500" selected>500 m</option>
        <option value="750">750 m</option>
        <option value="1000">1 km</option>
      </select>

      <span id="osm-pick-hint-b" style="font-size:11px;color:var(--text-secondary,#666);flex:1;">
        Click the map to reposition, then Import
      </span>

      <span id="osm-status-b" style="font-size:11px;color:var(--accent-mid,#4a8a4a);min-width:120px;"></span>

      <button id="osm-import-btn" type="button" style="
        background:var(--accent-mid,#4a8a4a);color:#fff;border:none;
        border-radius:4px;font-size:12px;padding:6px 18px;cursor:pointer;white-space:nowrap;">
        Import
      </button>
    </div>
  </div>
</div>`;


// ── Init ──────────────────────────────────────────────────────────────────
export function initOSMImport(callbacks) {
  _callbacks = callbacks;
  THREE = callbacks.THREE;
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
  document.getElementById('importOSMBtn').addEventListener('click', openModal);
  document.getElementById('osm-close-a').addEventListener('click', closeModal);
  document.getElementById('osm-close-b').addEventListener('click', closeModal);
  document.getElementById('osm-back-btn').addEventListener('click', _backToPhaseA);
  document.getElementById('osm-import-btn').addEventListener('click', runImport);
  document.getElementById('osm-search-btn').addEventListener('click', searchAddress);
}

function openModal() {
  document.getElementById('osm-overlay').style.display = 'block';
  _showPhaseA();
  // Activate Cesium click-to-pick — clicking on the 3D scene sets lat/lng
  // and promotes A → B (a confirmed location is the trigger to enter Phase B).
  startLocationPick(({ lat, lng }) => {
    document.getElementById('osm-lat').value = lat.toFixed(7);
    document.getElementById('osm-lng').value = lng.toFixed(7);
    setStatus('Location set \u2014 select radius and click Import.');
    const hint = document.getElementById('osm-pick-hint-a');
    if (hint) hint.textContent = `\u2713 ${lat.toFixed(5)}, ${lng.toFixed(5)} \u2014 click again to reposition`;
    _showPhaseB();
  });
}
function closeModal() {
  document.getElementById('osm-overlay').style.display = 'none';
  stopLocationPick();
}

// ── Phase transitions ─────────────────────────────────────────────────────
// Phase A's lat/lng inputs (#osm-lat, #osm-lng) remain the canonical source —
// Phase B's #osm-coords-display is a read-only mirror, refreshed on every
// transition and on every click-to-reposition.
function _showPhaseA() {
  document.getElementById('osm-phase-a').style.display = 'block';
  document.getElementById('osm-phase-b').style.display = 'none';
}

function _showPhaseB() {
  document.getElementById('osm-phase-a').style.display = 'none';
  document.getElementById('osm-phase-b').style.display = 'block';
  _updateCoordsDisplay();
}

function _backToPhaseA() {
  _showPhaseA();
}

function _updateCoordsDisplay() {
  const lat = parseFloat(document.getElementById('osm-lat').value);
  const lng = parseFloat(document.getElementById('osm-lng').value);
  const el  = document.getElementById('osm-coords-display');
  if (!el) return;
  if (!isNaN(lat) && !isNaN(lng)) {
    el.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  } else {
    el.textContent = '';
  }
}

// ── Address search via Google Geocoding API (server-side proxy) ───────────
// Replaces Nominatim — Google returns building-level precision for AU addresses.
async function searchAddress() {
  const q = document.getElementById('osm-address').value.trim();
  if (!q) return;
  setStatus('Searching\u2026');
  try {
    const res  = await fetch(`/api/geocode?address=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok || !data.results?.length) {
      setStatus('Address not found' + (data.status ? ` (${data.status})` : '') + '.'); return;
    }
    const { lat, lng, display_name, precise } = data.results[0];
    document.getElementById('osm-lat').value = lat.toFixed(7);
    document.getElementById('osm-lng').value = lng.toFixed(7);
    const { flyToSite } = await import('./cesium-viewer.js');
    // alt=800 (above ground) — flyToSite samples 3D-tile surface, no longer
    // ellipsoid-relative. precise/area distinction kept only in status text.
    await flyToSite(lat, lng, 800);
    setStatus(`${precise ? '\u2713 Building found' : '\u26a0 Area result'} \u2014 ${display_name.slice(0, 55)}\u2026`);
    _showPhaseB();
  } catch (err) {
    setStatus('Search failed: ' + err.message);
  }
}
function setStatus(msg, isError = false) {
  // Write to whichever phase status span is mounted; both ids exist after init.
  const color = isError ? '#e06060' : 'var(--accent-mid,#4a8a4a)';
  for (const id of ['osm-status-a', 'osm-status-b']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = msg;
    el.style.color = color;
  }
}

// ── WGS84 bounding box from lat/lng centre + radius in metres ────────────
function latLngToBbox(lat, lng, radiusM) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

// ── Overpass query builder ────────────────────────────────────────────────
function buildOverpassQuery(bbox) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:60];(
    way["building"](${b});
    relation["building"](${b});
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|service|living_street|pedestrian)$"](${b});
    way["highway"~"^(footway|cycleway|path|steps)$"](${b});
    way["railway"](${b});
    way["natural"~"^(water|coastline)$"](${b});
    way["waterway"](${b});
    way["leisure"~"^(park|garden|pitch|playground|nature_reserve)$"](${b});
    way["landuse"~"^(park|grass|forest|recreation_ground|meadow|village_green)$"](${b});
  );out body geom;`;
}

async function fetchOverpass(query) {
  const res = await fetch('/api/overpass', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Overpass proxy error ${res.status}`);
  }
  return res.json();
}


// ── Terrain from AWS Terrain Tiles (Terrarium RGB, free, no key) ──────────
// Elevation = (R * 256 + G + B/256) - 32768 metres

function lonToTileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
function tileXToLon(tx, z) { return tx / Math.pow(2, z) * 360 - 180; }
function tileYToLat(ty, z) {
  const n = Math.PI - 2 * Math.PI * ty / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

async function fetchTerrainMesh(bbox, THREE) {
  const Z = 14; // zoom 14 ≈ 8m/pixel — comparable to SRTM 30m after step-4 sampling
  const txMin = lonToTileX(bbox.west,  Z);
  const txMax = lonToTileX(bbox.east,  Z);
  const tyMin = latToTileY(bbox.north, Z);
  const tyMax = latToTileY(bbox.south, Z);

  // Fetch all covering tiles and decode elevation grid
  const promises = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      promises.push(fetchTerrainTile(tx, ty, Z));
    }
  }
  const tiles = await Promise.all(promises);

  // Build unified elevation point cloud
  const points = []; // {x, y, z} in scene space (Three.js)
  for (const tile of tiles) {
    if (!tile) continue;
    for (const pt of tile.points) {
      const sc = wgs84ToScene(pt.lat, pt.lng);
      if (sc) points.push({ x: sc.x, y: pt.ele, z: sc.z });
    }
  }
  if (points.length < 4) return null;

  return {
    mesh: buildTerrainGeometry(points, THREE),
    points,  // pass through for contour generation
  };
}

async function fetchTerrainTile(tx, ty, z) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
  try {
    // Use fetch with 8s timeout per tile
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('tile ' + res.status);
    const blob   = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const tileW = tileXToLon(tx + 1, z) - tileXToLon(tx, z);
    const tileH = tileYToLat(ty, z)     - tileYToLat(ty + 1, z);
    const west  = tileXToLon(tx, z);
    const north = tileYToLat(ty, z);
    const step  = 4; // sample every 4th pixel → ~32m spacing, comparable to SRTM 30m
    const points = [];

    for (let py = 0; py < canvas.height; py += step) {
      for (let px = 0; px < canvas.width; px += step) {
        const i = (py * canvas.width + px) * 4;
        const R = data[i], G = data[i+1], B = data[i+2];
        const ele = (R * 256 + G + B / 256) - 32768;
        const lat = north - (py / canvas.height) * tileH;
        const lng = west  + (px / canvas.width)  * tileW;
        points.push({ lat, lng, ele });
      }
    }
    return { points };
  } catch { return null; }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}


function buildTerrainGeometry(points, THREE) {
  // Sort points into a grid and triangulate
  // Points are approximately on a regular grid from tile sampling
  const xs = [...new Set(points.map(p => Math.round(p.x * 10) / 10))].sort((a,b) => a-b);
  const zs = [...new Set(points.map(p => Math.round(p.z * 10) / 10))].sort((a,b) => a-b);
  const grid = new Map();
  for (const p of points) {
    const kx = Math.round(p.x * 10) / 10;
    const kz = Math.round(p.z * 10) / 10;
    grid.set(`${kx},${kz}`, p.y);
  }

  const verts = []; const indices = [];
  const idxMap = new Map();
  let vi = 0;
  for (let iz = 0; iz < zs.length; iz++) {
    for (let ix = 0; ix < xs.length; ix++) {
      const y = grid.get(`${xs[ix]},${zs[iz]}`);
      if (y === undefined) continue;
      verts.push(xs[ix], y, zs[iz]);
      idxMap.set(`${ix},${iz}`, vi++);
    }
  }

  for (let iz = 0; iz < zs.length - 1; iz++) {
    for (let ix = 0; ix < xs.length - 1; ix++) {
      const a = idxMap.get(`${ix},${iz}`);
      const b = idxMap.get(`${ix+1},${iz}`);
      const c = idxMap.get(`${ix},${iz+1}`);
      const d = idxMap.get(`${ix+1},${iz+1}`);
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      indices.push(a, b, c, b, d, c);
    }
  }
  if (!indices.length) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// ── OSM geometry builders ─────────────────────────────────────────────────

// Classify an OSM way into a layer key
function classifyWay(tags) {
  if (tags.building || tags['building:part']) return 'buildings';
  const hw = tags.highway;
  if (hw) {
    if (['motorway','trunk'].includes(hw))                          return 'highways';
    if (['primary','secondary'].includes(hw))                       return 'major_roads';
    if (['tertiary','residential','service','living_street','pedestrian'].includes(hw)) return 'minor_roads';
    if (['footway','cycleway','path','steps'].includes(hw))         return 'paths';
    return 'minor_roads';
  }
  if (tags.railway)  return 'railways';
  const nat = tags.natural; const wu = tags.waterway;
  if (nat === 'water' || nat === 'coastline' || wu)                return 'water';
  const lu = tags.landuse; const ls = tags.leisure;
  if (lu === 'forest' || lu === 'grass' || lu === 'meadow' ||
      lu === 'park'   || lu === 'recreation_ground' ||
      ls === 'park'   || ls === 'garden' || ls === 'pitch' ||
      ls === 'playground' || ls === 'nature_reserve')               return 'parks';
  return null;
}

// Get geometry nodes from Overpass 'out geom' response
function wayToLatLngs(el) {
  if (el.geometry) return el.geometry.map(n => ({ lat: n.lat, lng: n.lon }));
  return [];
}


// ── Generate contour lines from terrain point cloud ───────────────────────
function buildContourLines(points, intervalM, THREE) {
  if (!points?.length) return null;

  // Build XZ grid of elevations
  const xs  = [...new Set(points.map(p => Math.round(p.x * 10) / 10))].sort((a,b) => a-b);
  const zs  = [...new Set(points.map(p => Math.round(p.z * 10) / 10))].sort((a,b) => a-b);
  const grid = new Map();
  for (const p of points) grid.set(`${Math.round(p.x*10)/10},${Math.round(p.z*10)/10}`, p.y);

  const minE = Math.floor(Math.min(...points.map(p => p.y)) / intervalM) * intervalM;
  const maxE = Math.ceil (Math.max(...points.map(p => p.y)) / intervalM) * intervalM;
  const cfg  = LAYER_CONFIG.contours;
  const group = new THREE.Group();
  group.name  = 'contours';
  if (cfg.yOffset) group.position.y = cfg.yOffset;

  for (let elev = minE; elev <= maxE; elev += intervalM) {
    const segments = [];
    for (let iz = 0; iz < zs.length - 1; iz++) {
      for (let ix = 0; ix < xs.length - 1; ix++) {
        const v00 = grid.get(`${xs[ix]},${zs[iz]}`);
        const v10 = grid.get(`${xs[ix+1]},${zs[iz]}`);
        const v01 = grid.get(`${xs[ix]},${zs[iz+1]}`);
        const v11 = grid.get(`${xs[ix+1]},${zs[iz+1]}`);
        if (v00===undefined||v10===undefined||v01===undefined||v11===undefined) continue;
        // Simple linear interpolation along each edge where contour crosses
        const pts = [];
        const lerp = (a, b, va, vb) => a + (b-a) * (elev-va)/(vb-va);
        if ((v00<elev) !== (v10<elev)) pts.push({ x: lerp(xs[ix],xs[ix+1],v00,v10), z: zs[iz] });
        if ((v10<elev) !== (v11<elev)) pts.push({ x: xs[ix+1], z: lerp(zs[iz],zs[iz+1],v10,v11) });
        if ((v01<elev) !== (v11<elev)) pts.push({ x: lerp(xs[ix],xs[ix+1],v01,v11), z: zs[iz+1] });
        if ((v00<elev) !== (v01<elev)) pts.push({ x: xs[ix], z: lerp(zs[iz],zs[iz+1],v00,v01) });
        if (pts.length >= 2) segments.push(pts[0], pts[1]);
      }
    }
    if (!segments.length) continue;
    const verts = new Float32Array(segments.length * 3);
    segments.forEach((p, i) => { verts[i*3]=p.x; verts[i*3+1]=elev; verts[i*3+2]=p.z; });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    group.add(new THREE.LineSegments(geom,
      new THREE.LineBasicMaterial({ color: cfg.color, opacity: cfg.opacity, transparent: true })));
  }
  return group.children.length ? group : null;
}

// ── Build extruded building mesh from footprint ring ──────────────────────
function buildBuilding(ring, height, THREE) {
  if (ring.length < 3) return null;
  const pts2D = ring.map(ll => {
    const sc = wgs84ToScene(ll.lat, ll.lng);
    return sc ? new THREE.Vector2(sc.x, -sc.z) : null; // north=-Z: negate to match cadmapper convention
  }).filter(Boolean);
  if (pts2D.length < 3) return null;

  const shape = new THREE.Shape(pts2D);
  const geom  = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: false,
  });
  // Extruded in XY — rotate so it stands in XZ plane (Y up)
  geom.rotateX(-Math.PI / 2);
  return geom;
}

// Build road polygon by buffering centerline ±halfWidth
function buildRoadPolygon(ring, halfWidth, THREE) {
  if (ring.length < 2) return null;
  const pts = ring.map(ll => {
    const sc = wgs84ToScene(ll.lat, ll.lng);
    return sc ? { x: sc.x, z: sc.z } : null;
  }).filter(Boolean);
  if (pts.length < 2) return null;

  const leftSide = [], rightSide = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i-1)];
    const next = pts[Math.min(pts.length-1, i+1)];
    const dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz/len, nz = dx/len; // perpendicular
    leftSide.push({ x: pts[i].x + nx * halfWidth, z: pts[i].z + nz * halfWidth });
    rightSide.push({ x: pts[i].x - nx * halfWidth, z: pts[i].z - nz * halfWidth });
  }
  const outline = [...leftSide, ...rightSide.reverse()];
  return buildFlatPolygon(outline, THREE);
}

// Build flat filled polygon from XZ points
function buildFlatPolygon(pts, THREE) {
  if (pts.length < 3) return null;
  const pts2D = pts.map(p => new THREE.Vector2(p.x, -p.z)); // north=-Z: negate to match cadmapper convention
  const shape = new THREE.Shape(pts2D);
  const geom  = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2); // XY → XZ ground plane
  return geom;
}

// Build flat line from lat/lng ring
function buildLine(ring, THREE) {
  const pts = ring.map(ll => {
    const sc = wgs84ToScene(ll.lat, ll.lng);
    return sc ? new THREE.Vector3(sc.x, 0, sc.z) : null;
  }).filter(Boolean);
  if (pts.length < 2) return null;
  return new THREE.BufferGeometry().setFromPoints(pts);
}


// ── Main OSM data → layerGroups ───────────────────────────────────────────
function buildLayerGroups(osmData, THREE) {
  const groups = {};
  const getGroup = (key) => {
    if (!groups[key]) {
      const cfg = LAYER_CONFIG[key] || { color: 0xaaaaaa, opacity: 1.0, yOffset: 0 };
      groups[key] = new THREE.Group();
      groups[key].name = key;
      if (cfg.yOffset) groups[key].position.y = cfg.yOffset;
    }
    return groups[key];
  };

  for (const el of osmData.elements) {
    if (el.type !== 'way' && el.type !== 'relation') continue;
    const tags = el.tags || {};
    const layer = classifyWay(tags);
    if (!layer) continue;

    const ring = wayToLatLngs(el);
    if (ring.length < 2) continue;
    const cfg  = LAYER_CONFIG[layer] || {};
    const grp  = getGroup(layer);

    if (layer === 'buildings') {
      const rawH = parseFloat(tags.height) || (parseFloat(tags['building:levels']) * 3.5) || 6;
      const geom = buildBuilding(ring, rawH, THREE);
      if (geom) {
        const mat = new THREE.MeshBasicMaterial({
          color: cfg.color, opacity: cfg.opacity,
          transparent: cfg.opacity < 1, side: THREE.DoubleSide,
        });
        grp.add(new THREE.Mesh(geom, mat));
        const edges = new THREE.EdgesGeometry(geom, 15);
        grp.add(new THREE.LineSegments(edges,
          new THREE.LineBasicMaterial({ color: 0x888888, opacity: 0.4, transparent: true })));
      }
    } else if (['highways','major_roads','minor_roads','paths'].includes(layer)) {
      const hw = tags.highway || 'residential';
      const w  = (ROAD_WIDTHS[hw] || 8) / 2;
      const geom = buildRoadPolygon(ring, w, THREE);
      if (geom) grp.add(new THREE.Mesh(geom,
        new THREE.MeshBasicMaterial({ color: cfg.color, opacity: cfg.opacity,
          transparent: cfg.opacity < 1, side: THREE.DoubleSide,
          depthWrite: false })));
    } else if (['parks','water'].includes(layer)) {
      // Closed polygon — filled
      const closed = ring.length > 2 &&
        Math.abs(ring[0].lat - ring[ring.length-1].lat) < 0.000001;
      if (closed) {
        const pts = ring.map(ll => {
          const sc = wgs84ToScene(ll.lat, ll.lng);
          return sc ? { x: sc.x, z: sc.z } : null;
        }).filter(Boolean);
        const geom = buildFlatPolygon(pts, THREE);
        if (geom) grp.add(new THREE.Mesh(geom,
          new THREE.MeshBasicMaterial({ color: cfg.color, opacity: cfg.opacity,
            transparent: cfg.opacity < 1, side: THREE.DoubleSide, depthWrite: false })));
      } else {
        const geom = buildLine(ring, THREE);
        if (geom) grp.add(new THREE.Line(geom,
          new THREE.LineBasicMaterial({ color: cfg.color })));
      }
    } else {
      // railways, contours — lines
      const geom = buildLine(ring, THREE);
      if (geom) grp.add(new THREE.Line(geom,
        new THREE.LineBasicMaterial({ color: cfg.color, opacity: cfg.opacity, transparent: true })));
    }
  }
  return groups;
}


// ── Build Three.js layer groups from saved GeoJSON FeatureCollection ─────
// Mirror of buildLayerGroups() but reads from saved context.geojson rather
// than fresh Overpass JSON. Used by app.js::openGPRFile when reloading an
// OSM-only .gpr. Each feature carries its OSM tags plus _gprLayer (the
// pre-computed LAYER_CONFIG key from the original import).
//
// Geometry: Polygon = closed (buildings, parks, water); LineString = open
// (roads, paths, contours, railways). All coords are [lng, lat] WGS84.
export function buildLayerGroupsFromGeoJSON(featureCollection, THREE) {
  if (!featureCollection?.features?.length) return {};

  const groups = {};
  const getGroup = (key) => {
    if (!groups[key]) {
      const cfg = LAYER_CONFIG[key] || { color: 0xaaaaaa, opacity: 1.0, yOffset: 0 };
      groups[key] = new THREE.Group();
      groups[key].name = key;
      if (cfg.yOffset) groups[key].position.y = cfg.yOffset;
    }
    return groups[key];
  };

  for (const feat of featureCollection.features) {
    if (!feat?.geometry?.coordinates?.length) continue;
    const tags  = feat.properties || {};
    const layer = tags._gprLayer || classifyWay(tags);
    if (!layer) continue;

    // Extract ring as [{lat,lng},...] from either Polygon or LineString
    const rawCoords = feat.geometry.type === 'Polygon'
      ? feat.geometry.coordinates[0]   // outer ring
      : feat.geometry.coordinates;     // LineString
    if (!rawCoords || rawCoords.length < 2) continue;
    const ring = rawCoords.map(([lng, lat]) => ({ lat, lng }));

    const cfg = LAYER_CONFIG[layer] || {};
    const grp = getGroup(layer);

    if (layer === 'buildings') {
      const rawH = parseFloat(tags.height) || (parseFloat(tags['building:levels']) * 3.5) || 6;
      const geom = buildBuilding(ring, rawH, THREE);
      if (geom) {
        const mat = new THREE.MeshBasicMaterial({
          color: cfg.color, opacity: cfg.opacity,
          transparent: cfg.opacity < 1, side: THREE.DoubleSide,
        });
        grp.add(new THREE.Mesh(geom, mat));
        const edges = new THREE.EdgesGeometry(geom, 15);
        grp.add(new THREE.LineSegments(edges,
          new THREE.LineBasicMaterial({ color: 0x888888, opacity: 0.4, transparent: true })));
      }
    } else if (['highways','major_roads','minor_roads','paths'].includes(layer)) {
      const hw = tags.highway || 'residential';
      const w  = (ROAD_WIDTHS[hw] || 8) / 2;
      const geom = buildRoadPolygon(ring, w, THREE);
      if (geom) grp.add(new THREE.Mesh(geom,
        new THREE.MeshBasicMaterial({ color: cfg.color, opacity: cfg.opacity,
          transparent: cfg.opacity < 1, side: THREE.DoubleSide,
          depthWrite: false })));
    } else if (['parks','water'].includes(layer)) {
      if (feat.geometry.type === 'Polygon') {
        const pts = ring.map(ll => {
          const sc = wgs84ToScene(ll.lat, ll.lng);
          return sc ? { x: sc.x, z: sc.z } : null;
        }).filter(Boolean);
        const geom = buildFlatPolygon(pts, THREE);
        if (geom) grp.add(new THREE.Mesh(geom,
          new THREE.MeshBasicMaterial({ color: cfg.color, opacity: cfg.opacity,
            transparent: cfg.opacity < 1, side: THREE.DoubleSide, depthWrite: false })));
      } else {
        const geom = buildLine(ring, THREE);
        if (geom) grp.add(new THREE.Line(geom,
          new THREE.LineBasicMaterial({ color: cfg.color })));
      }
    } else {
      // railways, contours — lines
      const geom = buildLine(ring, THREE);
      if (geom) grp.add(new THREE.Line(geom,
        new THREE.LineBasicMaterial({ color: cfg.color, opacity: cfg.opacity, transparent: true })));
    }
  }
  return groups;
}


// ── Convert Overpass JSON → WGS84 GeoJSON FeatureCollection ──────────────
// Stored as context.geojson in the .gpr. Coordinates are [lng, lat] per GeoJSON spec.
// All tags preserved as properties. _gprLayer matches LAYER_CONFIG keys.
function osmToGeoJSON(osmData) {
  const features = [];
  for (const el of osmData.elements) {
    if (el.type !== 'way') continue;
    const coords = (el.geometry || []).map(n => [n.lon, n.lat]);
    if (coords.length < 2) continue;

    const tags    = el.tags || {};
    const layer   = classifyWay(tags);
    const isClosed = coords.length >= 4 &&
      Math.abs(coords[0][0] - coords[coords.length-1][0]) < 0.000001 &&
      Math.abs(coords[0][1] - coords[coords.length-1][1]) < 0.000001;

    const geometry = isClosed
      ? { type: 'Polygon',    coordinates: [coords] }
      : { type: 'LineString', coordinates: coords };

    features.push({
      type: 'Feature',
      properties: { ...tags, _osmId: el.id, _osmType: el.type, _gprLayer: layer },
      geometry,
    });
  }
  return { type: 'FeatureCollection', features };
}

// ── Browser-side Overpass cache (IndexedDB) ───────────────────────────────
// Keyed by bbox+radius hash. TTL 24 hours.
// Survives page reloads and Vercel cold starts — unlike the server-side Map.
const _IDB_NAME  = 'gprtool_overpass_cache';
const _IDB_STORE = 'queries';
const _CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function _openCacheDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE, { keyPath: 'key' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function _bboxKey(bbox, radius) {
  return `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)},${radius}`;
}

async function _getCached(key) {
  try {
    const db  = await _openCacheDB();
    const req = db.transaction(_IDB_STORE).objectStore(_IDB_STORE).get(key);
    return await new Promise((res, rej) => {
      req.onsuccess = e => {
        const r = e.target.result;
        if (r && r.expires > Date.now()) res(r.data);
        else res(null);
      };
      req.onerror = e => rej(e.target.error);
    });
  } catch { return null; }
}

async function _setCached(key, data) {
  try {
    const db = await _openCacheDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).put({ key, data, expires: Date.now() + _CACHE_TTL });
      tx.oncomplete = res;
      tx.onerror    = e => rej(e.target.error);
    });
  } catch { /* non-critical */ }
}

// ── Run import ────────────────────────────────────────────────────────────
async function runImport() {
  const lat    = parseFloat(document.getElementById('osm-lat').value);
  const lng    = parseFloat(document.getElementById('osm-lng').value);
  const radius = parseInt(document.getElementById('osm-radius').value, 10);

  if (isNaN(lat) || isNaN(lng)) {
    setStatus('Please enter latitude and longitude.', true); return;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    setStatus('Invalid coordinates — latitude must be -90 to 90, longitude -180 to 180.', true); return;
  }

  // Derive UTM zone from longitude and convert to standard UTM
  const zone = Math.floor((lng + 180) / 6) + 1;
  const { easting, northing } = wgs84ToUTM(lat, lng, zone);
  // Use standard UTM northing (positive for both hemispheres) — real-world.js handles conversion

  const btn = document.getElementById('osm-import-btn');
  btn.disabled = true; btn.style.opacity = '0.5';

  try {
    // Set Real World anchor
    setRealWorldAnchor(zone, easting, northing);

    // Compute WGS84 bounding box directly from lat/lng + radius
    const bbox    = latLngToBbox(lat, lng, radius);
    const cacheKey = _bboxKey(bbox, radius);

    // Check browser cache first — avoids Overpass entirely for known areas
    let osmData = await _getCached(cacheKey);
    if (osmData) {
      setStatus('Loaded from cache \u2014 building geometry\u2026');
    } else {
      setStatus('Fetching OSM data\u2026');
      osmData = await fetchOverpass(buildOverpassQuery(bbox));
      await _setCached(cacheKey, osmData); // save for next time
    }
    setStatus('Building geometry\u2026');
    const layerGroups = buildLayerGroups(osmData, THREE);

    if (!Object.keys(layerGroups).length) {
      throw new Error('No data returned — check coordinates or try a larger radius');
    }

    closeModal();
    const addressVal  = document.getElementById('osm-address')?.value?.trim();
    const osmGeoJSON  = osmToGeoJSON(osmData);
    _callbacks.onLayersLoaded(layerGroups, null, addressVal || null, osmGeoJSON);

    // ── Terrain + contours via Web Worker (non-blocking) ──────────────────
    _runTerrainWorker(bbox, zone);

  } catch (err) {
    setStatus('Import failed: ' + err.message, true);
    console.error('[OSM import]', err);
  } finally {
    btn.disabled = false; btn.style.opacity = '1';
  }
}

// ── Terrain Web Worker launcher ───────────────────────────────────────────
function _runTerrainWorker(bbox, zone) {
  if (typeof Worker === 'undefined') {
    state.terrainStatus = 'unavailable';
    window.dispatchEvent(new CustomEvent('terrain:status', { detail: { status: 'unavailable' } }));
    return;
  }
  const { getRealWorldAnchor } = _callbacks;
  const anchor = typeof getRealWorldAnchor === 'function' ? getRealWorldAnchor() : null;
  const anchorX = anchor?.easting  ?? 0;
  const anchorY = anchor?.northing ?? 0;

  state.terrainStatus = 'fetching';
  window.dispatchEvent(new CustomEvent('terrain:status', { detail: { status: 'fetching' } }));

  const worker = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
  const intervalM = 5;
  worker.postMessage({ bbox, zoom: 14, intervalM, zone, anchorX, anchorY });

  worker.onmessage = async ({ data: msg }) => {
    if (msg.type === 'progress') {
      // Structured per-stage progress: {stage:'tiles'|'contours', done, total}
      if (msg.stage && typeof msg.done === 'number' && typeof msg.total === 'number') {
        const pct = Math.round((msg.done / Math.max(1, msg.total)) * 100);
        const label = msg.stage === 'tiles'
          ? `Terrain: tiles ${msg.done}/${msg.total} (${pct}%)`
          : `Terrain: contours ${pct}%`;
        setPipelineStatus(label, 'busy');
        window.dispatchEvent(new CustomEvent('terrain:progress',
          { detail: { stage: msg.stage, done: msg.done, total: msg.total, pct } }));
      } else {
        // Legacy progress with msg only (kept for safety)
        console.log('[terrain]', msg.msg);
      }
    } else if (msg.type === 'done') {
      const payload = {
        source: 'aws-terrarium',
        zoom: 14,
        intervalM,
        anchorX, anchorY,
        points: msg.terrainPoints,
        contourSegments: Array.from(msg.contourSegments),
      };
      _buildTerrainFromWorker(msg.terrainPoints, msg.contourSegments);
      state.terrainStatus = 'ready';
      state.terrainPayload = payload;
      window.dispatchEvent(new CustomEvent('terrain:status', { detail: { status: 'ready' } }));
      worker.terminate();

      // Persist into the active GPR; if a local file handle exists from a prior
      // Save, also re-write the file on disk so the saved .gpr gains terrain.
      try {
        await addTerrainToGPR(payload);
        if (state.activeFileHandle) {
          try {
            const blob = await getActiveGPRBlob();
            await writeBlobToHandle(state.activeFileHandle, blob);
            setPipelineStatus('\u2713 Terrain attached', 'done');
          } catch (e) {
            console.warn('[terrain] re-write of local file failed:', e);
            setPipelineStatus('Terrain saved (cloud only)', 'done');
          }
        } else {
          setPipelineStatus('\u2713 Terrain ready', 'done');
        }
      } catch (e) {
        console.warn('[terrain] persist skipped:', e.message);
        setPipelineStatus('\u2713 Terrain ready', 'done');
      }
      // Fade the pill back to a neutral state after 3s
      setTimeout(() => setPipelineStatus('Ready', 'idle'), 3000);
    } else if (msg.type === 'error') {
      console.warn('[terrain worker]', msg.message);
      state.terrainStatus = 'error';
      window.dispatchEvent(new CustomEvent('terrain:status', { detail: { status: 'error', message: msg.message } }));
      setPipelineStatus('Terrain unavailable', 'error');
      setTimeout(() => setPipelineStatus('Ready', 'idle'), 3000);
      worker.terminate();
    }
  };
  worker.onerror = e => {
    console.warn('[terrain worker error]', e);
    state.terrainStatus = 'error';
    window.dispatchEvent(new CustomEvent('terrain:status', { detail: { status: 'error', message: e.message } }));
    worker.terminate();
  };
}

function _buildTerrainFromWorker(points, contourSegments) {
  if (!_callbacks?.THREE || !state?.cadmapperGroup) return;
  const T = _callbacks.THREE;
  // ── Terrain mesh ─────────────────────────────────────────────────────
  const xs   = [...new Set(points.map(p => Math.round(p.x*10)/10))].sort((a,b)=>a-b);
  const ys   = [...new Set(points.map(p => Math.round(p.y*10)/10))].sort((a,b)=>a-b);
  const grid = new Map();
  for (const p of points) grid.set(`${Math.round(p.x*10)/10},${Math.round(p.y*10)/10}`, p.ele);

  const verts = [], indices = [], idxMap = new Map();
  let vi = 0;
  for (let iy = 0; iy < ys.length; iy++) {
    for (let ix = 0; ix < xs.length; ix++) {
      const ele = grid.get(`${xs[ix]},${ys[iy]}`);
      if (ele === undefined) continue;
      verts.push(xs[ix], ele, -ys[iy]); // y→z (north=-Z convention)
      idxMap.set(`${ix},${iy}`, vi++);
    }
  }
  for (let iy = 0; iy < ys.length-1; iy++) {
    for (let ix = 0; ix < xs.length-1; ix++) {
      const a=idxMap.get(`${ix},${iy}`), b=idxMap.get(`${ix+1},${iy}`);
      const c=idxMap.get(`${ix},${iy+1}`), d=idxMap.get(`${ix+1},${iy+1}`);
      if (a==null||b==null||c==null||d==null) continue;
      indices.push(a,b,c, b,d,c);
    }
  }

  if (indices.length) {
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.BufferAttribute(new Float32Array(verts), 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const cfg  = { color: 0xc8b890 };
    const mesh = new T.Mesh(geom, new T.MeshBasicMaterial({
      color: cfg.color, side: T.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 1,
    }));
    const terrainGroup = new T.Group();
    terrainGroup.name = 'topography';
    terrainGroup.add(mesh);
    state.cadmapperGroup.add(terrainGroup);
    buildLayerPanel({ topography: terrainGroup });
  }

  // ── Contour lines ─────────────────────────────────────────────────────
  if (contourSegments.length >= 6) {
    const vBuf = new Float32Array(contourSegments.length);
    for (let i = 0; i < contourSegments.length; i += 6) {
      // [x0,y0,ele, x1,y1,ele] → Three.js [x, ele, -y]
      vBuf[i]   = contourSegments[i];   vBuf[i+1] = contourSegments[i+2]; vBuf[i+2] = -contourSegments[i+1];
      vBuf[i+3] = contourSegments[i+3]; vBuf[i+4] = contourSegments[i+5]; vBuf[i+5] = -contourSegments[i+4];
    }
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.BufferAttribute(vBuf, 3));
    const contourGroup = new T.Group();
    contourGroup.name  = 'contours';
    contourGroup.position.y = 0.015;
    contourGroup.add(new T.LineSegments(geom,
      new T.LineBasicMaterial({ color: 0xa08860, opacity: 0.7, transparent: true })));
    state.cadmapperGroup.add(contourGroup);
    buildLayerPanel({ contours: contourGroup });
  }
}

// ── Rebuild terrain from saved payload (used on .gpr reload) ──────────────

/**
 * Rebuild terrain mesh + contour groups from a previously-saved payload.
 * Used by the project loader to restore terrain without re-fetching from AWS.
 *
 * @param {Object} payload - { points, contourSegments, ... }
 */
export function rebuildTerrainFromPayload(payload) {
  if (!payload?.points || !payload?.contourSegments) return;
  _buildTerrainFromWorker(payload.points, payload.contourSegments);
  state.terrainStatus = 'ready';
  state.terrainPayload = payload;
  window.dispatchEvent(new CustomEvent('terrain:status', { detail: { status: 'ready' } }));
  console.log(`[terrain] rebuilt from saved payload (${payload.points.length} pts)`);
}

