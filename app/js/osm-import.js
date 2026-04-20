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
const MODAL_HTML = `
<div id="osm-overlay" style="
  display:none; position:fixed; inset:0; z-index:1100;
  background:var(--chrome-panel); flex-direction:column;">

  <!-- Header bar -->
  <div style="padding:10px 16px; border-bottom:1px solid var(--chrome-border);
              display:flex; align-items:center; gap:10px; flex-shrink:0;
              background:var(--chrome-dark,#1e3d1e);">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.4">
      <circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-3 4-3 6s1 4 3 6M8 2c2 2 3 4 3 6s-1 4-3 6"/>
    </svg>
    <h3 style="margin:0; font-size:13px; font-weight:600; color:#fff;">Import from OpenStreetMap</h3>
    <span style="font-size:10px;color:rgba(255,255,255,0.5);">Click map to set site location</span>

    <!-- Address search -->
    <div style="display:flex;gap:6px;margin-left:16px;flex:1;max-width:400px;">
      <input id="osm-address" type="text" placeholder="Search address\u2026"
        style="flex:1;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);
        border-radius:4px;color:#fff;font-size:12px;padding:5px 10px;outline:none;"
        onkeydown="if(event.key==='Enter') document.getElementById('osm-search-btn').click()">
      <button id="osm-search-btn" style="background:var(--accent-mid,#4a8a4a);color:#fff;border:none;
        border-radius:4px;font-size:12px;padding:5px 12px;cursor:pointer;">Search</button>
    </div>

    <!-- Controls row -->
    <div style="display:flex;align-items:center;gap:10px;margin-left:8px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:10px;color:rgba(255,255,255,0.6);">Lat</span>
        <input id="osm-lat" type="number" step="any" placeholder="\u2014"
          style="width:100px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);
          border-radius:4px;color:#fff;font-size:11px;padding:4px 8px;outline:none;">
        <span style="font-size:10px;color:rgba(255,255,255,0.6);">Lng</span>
        <input id="osm-lng" type="number" step="any" placeholder="\u2014"
          style="width:110px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);
          border-radius:4px;color:#fff;font-size:11px;padding:4px 8px;outline:none;">
      </div>
      <select id="osm-radius" style="font-size:11px;background:var(--chrome-input,#fff);
        border:1px solid var(--chrome-border);border-radius:4px;padding:4px 8px;
        color:var(--text-primary,#222);outline:none;">
        <option value="250">250 m</option>
        <option value="500" selected>500 m</option>
        <option value="750">750 m</option>
        <option value="1000">1 km</option>
      </select>
      <span id="osm-status" style="font-size:11px;color:#90c890;min-width:140px;"></span>
      <button id="osm-import-btn" style="
        background:var(--accent-mid,#4a8a4a);color:#fff;border:none;
        border-radius:4px;font-size:12px;padding:6px 18px;cursor:pointer;white-space:nowrap;">
        Import
      </button>
      <button id="osm-close" style="background:none;border:none;color:rgba(255,255,255,0.6);
        cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;">&#x2715;</button>
    </div>
  </div>

  <!-- Map fills all remaining space -->
  <div id="osm-map" style="flex:1;min-height:0;background:#1a1a1a;position:relative;">
    <div id="osm-map-loading" style="position:absolute;inset:0;display:flex;align-items:center;
      justify-content:center;color:#aaa;font-size:13px;">Loading map\u2026</div>
  </div>
</div>`;


// ── Init ──────────────────────────────────────────────────────────────────
export function initOSMImport(callbacks) {
  _callbacks = callbacks;
  THREE = callbacks.THREE;
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
  document.getElementById('importOSMBtn').addEventListener('click', openModal);
  document.getElementById('osm-close').addEventListener('click', closeModal);
  document.getElementById('osm-import-btn').addEventListener('click', runImport);
  document.getElementById('osm-search-btn').addEventListener('click', searchAddress);
}

function openModal() {
  setStatus('Click the map to set your site location.');
  document.getElementById('osm-overlay').style.display = 'flex';
  _initPickerMap();
}
function closeModal() {
  document.getElementById('osm-overlay').style.display = 'none';
}

// ── Address search using Nominatim ───────────────────────────────────────
async function searchAddress() {
  const q = document.getElementById('osm-address').value.trim();
  if (!q || !_pickerMap) return;
  setStatus('Searching\u2026');
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`);
    const data = await res.json();
    if (!data.length) { setStatus('Address not found.'); return; }
    const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
    _pickerMap.setCenter({ lat, lng });
    _pickerMap.setZoom(17);
    setStatus('Navigate and click your exact site.');
  } catch (err) {
    setStatus('Search failed: ' + err.message);
  }
}

// ── Google Maps click-to-locate picker ───────────────────────────────────
let _pickerMap    = null;
let _pickerMarker = null;
let _mapsReady    = false;

async function _initPickerMap() {
  if (_pickerMap) {
    setTimeout(() => google.maps.event.trigger(_pickerMap, 'resize'), 50);
    return;
  }
  const loading = document.getElementById('osm-map-loading');
  try {
    const res = await fetch('/api/maps-key');
    if (!res.ok) throw new Error('maps-key ' + res.status);
    const { key } = await res.json();
    if (!_mapsReady) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=__osmMapsReady`;
        s.onerror = () => reject(new Error('Maps script failed'));
        window.__osmMapsReady = () => { _mapsReady = true; resolve(); };
        document.head.appendChild(s);
      });
    }
    if (loading) loading.style.display = 'none';
    _pickerMap = new google.maps.Map(document.getElementById('osm-map'), {
      center: { lat: -31.9505, lng: 115.8605 }, zoom: 14,
      mapTypeId: google.maps.MapTypeId.HYBRID,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    });
    _pickerMap.addListener('click', e => {
      const lat = e.latLng.lat(), lng = e.latLng.lng();
      document.getElementById('osm-lat').value = lat.toFixed(7);
      document.getElementById('osm-lng').value = lng.toFixed(7);
      if (_pickerMarker) _pickerMarker.setMap(null);
      _pickerMarker = new google.maps.Marker({
        position: e.latLng, map: _pickerMap,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8,
          fillColor: '#4a8a4a', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      });
      setStatus('Location set \u2014 select radius and click Import.');
    });
  } catch (err) {
    if (loading) loading.textContent = 'Map unavailable \u2014 enter coordinates manually.';
    console.warn('[OSM picker]', err);
  }
}
function setStatus(msg, isError = false) {
  const el = document.getElementById('osm-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#e06060' : '#90c890';
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
    const bbox = latLngToBbox(lat, lng, radius);

    // Fetch OSM data
    setStatus('Fetching OSM data\u2026');
    const osmData = await fetchOverpass(buildOverpassQuery(bbox));
    setStatus('Building geometry\u2026');
    const layerGroups = buildLayerGroups(osmData, THREE);

    if (!Object.keys(layerGroups).length) {
      throw new Error('No data returned — check coordinates or try a larger radius');
    }

    closeModal();
    _callbacks.onLayersLoaded(layerGroups, null);

    // Terrain + contours: disabled pending optimisation (causes main thread freeze)
    // TODO: move to Web Worker or add a separate "Load Terrain" button
    /*
    fetchTerrainMesh(bbox, THREE).then(terrainResult => {
      if (!terrainResult?.mesh || !state.cadmapperGroup) return;
      const { mesh: terrainGeom, points: terrainPts } = terrainResult;
      const terrainGroup = new THREE.Group();
      terrainGroup.name = 'topography';
      terrainGroup.add(new THREE.Mesh(terrainGeom,
        new THREE.MeshBasicMaterial({
          color: LAYER_CONFIG.topography.color, transparent: false,
          side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 1,
        })));
      terrainGroup.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(terrainGeom, 10),
        new THREE.LineBasicMaterial({ color: 0xa09070, opacity: 0.4, transparent: true })));
      state.cadmapperGroup.add(terrainGroup);
      buildLayerPanel({ topography: terrainGroup });

      setTimeout(() => {
        const contourGroup = buildContourLines(terrainPts, 4, THREE);
        if (contourGroup && state.cadmapperGroup) {
          state.cadmapperGroup.add(contourGroup);
          buildLayerPanel({ contours: contourGroup });
        }
      }, 200);
    }).catch(err => console.warn('[terrain background]', err));
    */

  } catch (err) {
    setStatus('Import failed: ' + err.message, true);
    console.error('[OSM import]', err);
  } finally {
    btn.disabled = false; btn.style.opacity = '1';
  }
}

