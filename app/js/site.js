/*
 * site.js — Site geometry: boundaries, lot boundary, site pin
 */
import * as THREE from 'three';
import { state } from './state.js';
import { showFeedback } from './ui.js';
import { latlonToMetres, computeBBox, computePolygonArea, computePolygonPerimeter, loadMapTiles } from './geo.js';
import { getRealWorldAnchor, sceneToWGS84, wgs84ToScene } from './real-world.js';
import { addBoundaryToGPR, getActiveGPRBlob } from './gpr-file.js';
import { saveProject } from './projects.js';
import { buildSiteTerrain } from './terrain.js';
import { updateSceneHelpers } from './grid.js';
import { fit2DCamera, update2DCamera, switchMode } from './viewport.js';

export function drawSiteBoundary(coords, opts = {}) {
  if (state.siteBoundaryLine) {
    state.scene.remove(state.siteBoundaryLine);
    state.siteBoundaryLine.geometry.dispose();
    state.siteBoundaryLine = null;
  }

  const bbox = computeBBox(coords);
  const originLon = (opts.originLng != null) ? opts.originLng : bbox.cLon;
  const originLat = (opts.originLat != null) ? opts.originLat : bbox.cLat;

  window._siteBBoxCenter = { cLon: originLon, cLat: originLat };
  state.siteOriginLon = originLon;
  state.siteOriginLat = originLat;

  const points = coords.map(c => {
    const [x, z] = latlonToMetres(c[0], c[1], originLon, originLat);
    return new THREE.Vector3(x, 0, z);
  });

  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat  = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 });
  state.siteBoundaryLine = new THREE.LineLoop(geom, mat);
  state.scene.add(state.siteBoundaryLine);

  const box    = new THREE.Box3().setFromObject(state.siteBoundaryLine);
  const size   = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const siteSpan = Math.max(size.x, size.z);
  updateSceneHelpers(siteSpan);

  if (opts.originLng != null) {
    const aspect = state.container.clientWidth / (state.container.clientHeight || 1);
    const halfH  = Math.max(siteSpan * 0.8, 100);
    state.base2DhalfH     = halfH;
    state.camera2D.left   = -halfH * aspect;
    state.camera2D.right  =  halfH * aspect;
    state.camera2D.top    =  halfH;
    state.camera2D.bottom = -halfH;
    state.pan2D.x = 0; state.pan2D.z = 0; state.zoom2D = 1;
    update2DCamera();
  } else {
    fit2DCamera(box);
  }

  loadMapTiles(bbox);
  switchMode('2d');

  const area      = computePolygonArea(coords);
  const perimeter = computePolygonPerimeter(coords);
  state.siteAreaM2 = area;

  document.getElementById('empty-props').style.display        = 'none';
  document.getElementById('site-info-section').style.display  = 'block';
  document.getElementById('gpr-section').style.display        = 'block';
  document.getElementById('site-area').textContent            = area.toFixed(0) + ' m\u00b2';
  document.getElementById('site-perimeter').textContent       = perimeter.toFixed(0) + ' m';
  document.getElementById('site-points').textContent          = coords.length - 1;
  document.getElementById('clearSiteBtn').style.display       = 'block';
  document.getElementById('left-panel').classList.add('site-imported');
  showFeedback(`Site loaded \u2014 ${coords.length - 1} points, ${area.toFixed(0)} m\u00b2`);
}

// ── In-viewport lot boundary drawing ─────────────────────────────────────
let _bdVerts      = [];
let _bdPreviewGrp = null;
let _bdSnapClose  = false;   // true when cursor is near first vertex

export function startBoundaryDraw() {
  cancelBoundaryDraw();
  state.boundaryDrawMode = true;
  _bdVerts = [];
  _bdSnapClose = false;
  _bdPreviewGrp = new THREE.Group();
  _bdPreviewGrp.name = 'boundary-draw-preview';
  state.scene.add(_bdPreviewGrp);
  state.canvas.style.cursor = 'crosshair';
  showFeedback('Click to place boundary vertices \u2014 click near the start point to close, Escape to cancel', 0);
}

export function handleBoundaryClick(sceneX, sceneZ) {
  if (!state.boundaryDrawMode) return;
  // If snapping to first vertex — close the polygon
  if (_bdSnapClose && _bdVerts.length >= 3) {
    confirmBoundaryDraw();
    return;
  }
  _bdVerts.push({ x: sceneX, z: sceneZ });
  _updateBdPreview();
}

// Called on every mousemove in 2D boundary-draw mode
export function handleBoundaryMouseMove(screenX, screenY) {
  if (!state.boundaryDrawMode || _bdVerts.length < 3) return;

  // Project first vertex to screen space
  const first = new THREE.Vector3(_bdVerts[0].x, 0, _bdVerts[0].z);
  const proj  = first.clone().project(state.camera2D);
  const rect  = state.canvas.getBoundingClientRect();
  const sx    = (proj.x *  0.5 + 0.5) * rect.width;
  const sy    = (proj.y * -0.5 + 0.5) * rect.height;

  const dist = Math.hypot(screenX - rect.left - sx, screenY - rect.top - sy);
  _bdSnapClose = dist < 15;
  state.canvas.style.cursor = _bdSnapClose ? 'pointer' : 'crosshair';
}

export function handleBoundaryDblClick() {
  if (!state.boundaryDrawMode || _bdVerts.length < 3) return;
  _bdVerts.pop(); // dblclick fires a click first — remove duplicate
  confirmBoundaryDraw();
}

export async function confirmBoundaryDraw() {
  if (!state.boundaryDrawMode || _bdVerts.length < 3) {
    showFeedback('Need at least 3 points to close boundary');
    return;
  }
  state.boundaryDrawMode = false;
  state.canvas.style.cursor = '';

  const coords = _bdVerts.map(v => {
    const w = sceneToWGS84(v.x, v.z);
    return w ? [w.lng, w.lat] : null;
  }).filter(Boolean);

  if (coords.length < 3) {
    showFeedback('Boundary conversion failed \u2014 UTM anchor not set?');
    _clearBdPreview(); return;
  }
  coords.push(coords[0]); // close GeoJSON ring

  const geojson = {
    type: 'Feature',
    properties: { source: 'gprtool_draw', drawn_at: new Date().toISOString() },
    geometry: { type: 'Polygon', coordinates: [coords] },
  };

  _clearBdPreview();
  renderLotBoundary(geojson);
  // Build terrain mesh clipped to boundary, project flat layers onto it
  buildSiteTerrain(geojson, THREE).catch(err => console.warn('[terrain]', err));
  showFeedback('Lot boundary drawn \u2014 saving\u2026', 0);

  try {
    await addBoundaryToGPR(geojson);
    const anchor = getRealWorldAnchor();
    const blob   = await getActiveGPRBlob();
    if (blob && anchor) {
      saveProject(blob, { site_name: document.title || 'GPR Project',
        has_boundary: true, wgs84_lat: anchor.lat, wgs84_lng: anchor.lng })
        .catch(e => console.warn('[GPR] Supabase boundary update failed:', e));
    }
    const btn = document.getElementById('draw-boundary-btn');
    if (btn) { btn.textContent = '\u2713 Lot Boundary \u2014 Re-draw\u2026'; btn.style.background = 'var(--accent-dark,#2d6b2d)'; }
    showFeedback('Lot boundary saved');
  } catch (err) {
    console.error('[GPR] boundary save failed:', err);
    showFeedback('Boundary drawn but save failed: ' + err.message);
  }
}

export function cancelBoundaryDraw() {
  state.boundaryDrawMode = false;
  if (state.canvas) state.canvas.style.cursor = '';
  _clearBdPreview();
  _bdVerts = [];
}

function _updateBdPreview() {
  if (!_bdPreviewGrp) return;
  while (_bdPreviewGrp.children.length) {
    const c = _bdPreviewGrp.children[0];
    c.geometry?.dispose(); c.material?.dispose();
    _bdPreviewGrp.remove(c);
  }

  _bdVerts.forEach(v => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff6600 }));
    dot.position.set(v.x, 0.3, v.z);
    _bdPreviewGrp.add(dot);
  });
  if (_bdVerts.length >= 2) {
    const pts  = _bdVerts.map(v => new THREE.Vector3(v.x, 0.3, v.z));
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    _bdPreviewGrp.add(new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xff6600 })));
  }
}

function _clearBdPreview() {
  if (!_bdPreviewGrp) return;
  _bdPreviewGrp.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
  state.scene.remove(_bdPreviewGrp);
  _bdPreviewGrp = null;
}

// ── Lot boundary panel (right panel, after DXF import) ────────────────────
export function buildBoundaryPanel(wgs84Bounds, hasExisting = false) {
  document.getElementById('lot-boundary-section')?.remove();

  const section = document.createElement('div');
  section.id        = 'lot-boundary-section';
  section.className = 'command-section';
  section.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--chrome-border);';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-secondary);margin-bottom:6px;';
  title.textContent = 'Lot Boundary';
  section.appendChild(title);
  row.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  const btn = document.createElement('button');
  btn.id = 'draw-boundary-btn';
  btn.textContent = hasExisting ? '\u2713 Lot Boundary \u2014 Re-draw\u2026' : 'Draw Lot Boundary\u2026';
  btn.style.cssText = `width:100%;padding:7px 12px;font-size:12px;cursor:pointer;
    background:${hasExisting ? 'var(--accent-dark,#2d6b2d)' : 'var(--accent-mid,#4a8a4a)'};
    color:#fff;border:none;border-radius:4px;text-align:left;`;
  btn.addEventListener('click', () => startBoundaryDraw());
  row.appendChild(btn);
  section.appendChild(row);

  const layerSection = document.getElementById('cadmapper-layer-section');
  const panelContent = document.querySelector('#right-panel .panel-content');
  if (layerSection && panelContent) panelContent.insertBefore(section, layerSection.nextSibling);
  else if (panelContent) panelContent.appendChild(section);
}

export function clearLotBoundary() {
  if (state.lotBoundaryGroup) {
    state.scene.remove(state.lotBoundaryGroup);
    state.lotBoundaryGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    state.lotBoundaryGroup = null;
  }
  document.getElementById('lot-boundary-layer-row')?.remove();
}

export function renderLotBoundary(boundaryGeojson) {
  clearLotBoundary();
  if (!boundaryGeojson?.geometry?.coordinates?.[0]) return;

  const ring = boundaryGeojson.geometry.coordinates[0];
  const pts  = ring.map(([lng, lat]) => {
    const sc = wgs84ToScene(lat, lng);
    return sc ? new THREE.Vector3(sc.x, 0.15, sc.z) : null;
  }).filter(Boolean);

  if (pts.length < 3) return;
  pts.push(pts[0]);

  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat  = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 });
  state.lotBoundaryGroup = new THREE.Group();
  state.lotBoundaryGroup.name = 'lot-boundary';
  state.lotBoundaryGroup.add(new THREE.Line(geom, mat));
  state.scene.add(state.lotBoundaryGroup);
  buildLotBoundaryLayerRow();
}

export function buildLotBoundaryLayerRow() {
  document.getElementById('lot-boundary-layer-row')?.remove();
  const section = document.getElementById('cadmapper-layer-section');
  if (!section) return;

  const row = document.createElement('div');
  row.id = 'lot-boundary-layer-row'; row.className = 'info-row';
  const label = document.createElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;width:100%;';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = true;
  cb.style.cssText = 'accent-color:var(--accent-mid,#4a8a4a);';
  cb.addEventListener('change', () => { if (state.lotBoundaryGroup) state.lotBoundaryGroup.visible = cb.checked; });

  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#ff6600;';
  const name = document.createElement('span');
  name.style.cssText = 'flex:1;font-size:12px;'; name.textContent = 'Lot Boundary';
  label.append(cb, dot, name);
  row.appendChild(label);
  section.appendChild(row);
}

export function showSitePin(lat, lng) {
  if (state.siteBoundaryLine) state.siteBoundaryLine.visible = false;
  if (state.sitePinGroup) {
    state.scene.remove(state.sitePinGroup);
    state.sitePinGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    state.sitePinGroup = null;
  }
  document.getElementById('site-pin-dom')?.remove();

  state.sitePinDom = document.createElement('div');
  state.sitePinDom.id = 'site-pin-dom';
  state.sitePinDom.style.cssText = 'position:absolute;pointer-events:none;z-index:10;transform:translate(-50%,-100%);';
  state.sitePinDom.innerHTML = `
    <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="15" cy="41" rx="6" ry="2" fill="rgba(0,0,0,0.20)"/>
      <path d="M15 1 C7.268 1 1 7.268 1 15 C1 24.5 15 41 15 41 C15 41 29 24.5 29 15 C29 7.268 22.732 1 15 1 Z"
            fill="#1e3d1e" stroke="white" stroke-width="1.2"/>
      <circle cx="15" cy="15" r="7" fill="white"/>
      <circle cx="15" cy="15" r="4" fill="#4a7c3f"/>
    </svg>`;
  document.getElementById('viewport').appendChild(state.sitePinDom);

  if (lat != null && lng != null && window._siteBBoxCenter) {
    const bc = window._siteBBoxCenter;
    const wx =  (lng - bc.cLon) * Math.cos(bc.cLat * Math.PI / 180) * 111320;
    const wz = -(lat - bc.cLat) * 111320;
    state.sitePinWorldPos = new THREE.Vector3(wx, 0, wz);
  } else {
    state.sitePinWorldPos = new THREE.Vector3(0, 0, 0);
  }
  updateSitePinDOM();
}

export function updateSitePinDOM() {
  if (!state.sitePinDom || !state.sitePinWorldPos) return;
  const vec  = state.sitePinWorldPos.clone().project(state.camera);
  const rect = state.canvas.getBoundingClientRect();
  const x    = (vec.x *  0.5 + 0.5) * rect.width;
  const y    = (vec.y * -0.5 + 0.5) * rect.height;
  state.sitePinDom.style.left = x + 'px';
  state.sitePinDom.style.top  = y + 'px';
}
