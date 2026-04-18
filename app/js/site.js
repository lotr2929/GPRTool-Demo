/*
 * site.js — Site geometry: boundaries, lot boundary, site pin
 */
import * as THREE from 'three';
import { state } from './state.js';
import { showFeedback } from './ui.js';
import { latlonToMetres, computeBBox, computePolygonArea, computePolygonPerimeter } from './geo.js';
import { openBoundaryPicker } from './site-boundary.js';
import { getRealWorldAnchor, sceneToWGS84, wgs84ToScene } from './real-world.js';
import { addBoundaryToGPR, getActiveGPRBlob } from './gpr-file.js';
import { saveProject } from './projects.js';

export function drawSiteBoundary(coords, opts = {}

export function buildBoundaryPanel(wgs84Bounds, hasExisting = false) {
  const existing = document.getElementById('boundary-section');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id        = 'boundary-section';
  section.className = 'property-section';
  section.innerHTML = '<h4>Lot Boundary</h4>';

  const row = document.createElement('div');
  row.className = 'info-row';

  if (wgs84Bounds) {
    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:8px;';
    info.textContent = `Site centred at ${wgs84Bounds.sw.lat.toFixed(5)}\u00b0, `
      + `${wgs84Bounds.sw.lng.toFixed(5)}\u00b0`;
    row.appendChild(info);
  }

  const btn = document.createElement('button');
  btn.id = 'draw-boundary-btn';
  btn.textContent = hasExisting ? '\u2713 Lot Boundary \u2014 Re-draw\u2026' : 'Draw Lot Boundary\u2026';
  btn.style.cssText = `
    width:100%; padding:7px 12px; font-size:12px; cursor:pointer;
    background:${hasExisting ? 'var(--accent-dark,#2d6b2d)' : 'var(--accent-mid,#4a8a4a)'}; color:#fff; border:none;
    border-radius:4px; text-align:left;`;
  btn.addEventListener('click', () => {
    if (!wgs84Bounds) {
      showFeedback('No UTM coordinates \u2014 re-import with UTM values to use boundary picker');
      return;
    }
    openBoundaryPicker(wgs84Bounds, async (geojson) => {
      try {
        await addBoundaryToGPR(geojson);
        renderLotBoundary(geojson);
        btn.textContent = '\u2713 Lot Boundary saved \u2014 Re-draw\u2026';
        btn.style.background = 'var(--accent-dark,#2d6b2d)';
        showFeedback('Lot boundary saved to project');
        // ── Update Supabase repository with boundary ───────────────
        const anchor = getRealWorldAnchor();
        const blob   = await getActiveGPRBlob();
        if (blob && anchor) {
          saveProject(blob, {
            site_name:    document.title || 'GPR Project',
            has_boundary: true,
            wgs84_lat:    anchor.lat,
            wgs84_lng:    anchor.lng,
          }).catch(e => console.warn('[GPR] Supabase boundary update failed:', e));
        }
      } catch (err) {
        console.error('[GPR] boundary save failed:', err);
        showFeedback('Failed to save boundary: ' + err.message);
      }
    });
  });

  row.appendChild(btn);

  // Download button
  const dlBtn = document.createElement('button');
  dlBtn.textContent = '\u2913 Download .gpr';
  dlBtn.style.cssText = `
    width:100%; margin-top:6px; padding:5px 12px; font-size:11px; cursor:pointer;
    background:none; color:var(--text-secondary); border:1px solid var(--chrome-border);
    border-radius:4px; text-align:left;`;
  dlBtn.addEventListener('click', async () => {
    try {
      const siteName = document.title || 'project';
      await downloadGPR(siteName);
    } catch (err) {
      showFeedback('Download failed: ' + err.message);
    }
  });
  row.appendChild(dlBtn);

  section.appendChild(row);

  const layerSection = document.getElementById('cadmapper-layer-section');
  const panelContent = document.querySelector('#right-panel .panel-content');
  if (layerSection && panelContent) {
    panelContent.insertBefore(section, layerSection.nextSibling);
  } else if (panelContent) {
    panelContent.appendChild(section);
  }
}

export function clearLotBoundary() {
  if (lotBoundaryGroup) {
    scene.remove(lotBoundaryGroup);
    lotBoundaryGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    lotBoundaryGroup = null;
  }
  document.getElementById('lot-boundary-layer-row')?.remove();
}

export function renderLotBoundary(boundaryGeojson) {
  clearLotBoundary();
  if (!boundaryGeojson?.geometry?.coordinates?.[0]) return;

  const ring   = boundaryGeojson.geometry.coordinates[0];
  const pts    = ring.map(([lng, lat]) => {
    const sc = wgs84ToScene(lat, lng);
    return sc ? new THREE.Vector3(sc.x, 0.15, sc.z) : null;
  }).filter(Boolean);

  if (pts.length < 3) return;
  pts.push(pts[0]);   // close the ring

  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat  = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 });
  lotBoundaryGroup = new THREE.Group();
  lotBoundaryGroup.name = 'lot-boundary';
  lotBoundaryGroup.add(new THREE.Line(geom, mat));
  scene.add(lotBoundaryGroup);

  // Add to Properties panel under Site Context
  buildLotBoundaryLayerRow();
}

export function buildLotBoundaryLayerRow() {
  const existing = document.getElementById('lot-boundary-layer-row');
  if (existing) existing.remove();

  const section = document.getElementById('cadmapper-layer-section');
  if (!section) return;

  const row = document.createElement('div');
  row.id        = 'lot-boundary-layer-row';
  row.className = 'info-row';
  const label = document.createElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;width:100%;';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = true;
  cb.style.cssText = 'accent-color:var(--accent-mid,#4a8a4a);';
  cb.addEventListener('change', () => { if (lotBoundaryGroup) lotBoundaryGroup.visible = cb.checked; });
  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#ff6600;';
  const name = document.createElement('span');
  name.style.cssText = 'flex:1;font-size:12px;'; name.textContent = 'Google Lot Boundary';
  label.append(cb, dot, name);
  row.appendChild(label);
  section.appendChild(row);
}

export function showSitePin(lat, lng) {
  if (state.siteBoundaryLine) state.siteBoundaryLine.visible = false;

  // Clear any previous mesh pin
  if (state.sitePinGroup) {
    scene.remove(state.sitePinGroup);
    state.sitePinGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    state.sitePinGroup = null;
  }

  // Remove any existing DOM pin
  document.getElementById('site-pin-dom')?.remove();

  // Create DOM teardrop pin
  state.sitePinDom = document.createElement('div');
  state.sitePinDom.id = 'site-pin-dom';
  state.sitePinDom.style.cssText = `
    position:absolute; pointer-events:none; z-index:10;
    transform:translate(-50%, -100%);`;
  state.sitePinDom.innerHTML = `
    <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="15" cy="41" rx="6" ry="2" fill="rgba(0,0,0,0.20)"/>
      <path d="M15 1 C7.268 1 1 7.268 1 15 C1 24.5 15 41 15 41 C15 41 29 24.5 29 15 C29 7.268 22.732 1 15 1 Z"
            fill="#1e3d1e" stroke="white" stroke-width="1.2"/>
      <circle cx="15" cy="15" r="7" fill="white"/>
      <circle cx="15" cy="15" r="4" fill="#4a7c3f"/>
    </svg>`;
  document.getElementById('viewport').appendChild(state.sitePinDom);

  // Convert Nominatim lat/lng to world coords using the same bbox centre that
  // drawSiteBoundary used — this places pin at the geocoded address, not polygon centroid
  if (lat != null && lng != null && window._siteBBoxCenter) {
    const bc  = window._siteBBoxCenter;
    const wx  =  (lng - bc.cLon) * Math.cos(bc.cLat * Math.PI / 180) * 111320;
    const wz  = -(lat - bc.cLat) * 111320;
    state.sitePinWorldPos = new THREE.Vector3(wx, 0, wz);
  } else {
    state.sitePinWorldPos = new THREE.Vector3(0, 0, 0);
  }

  updateSitePinDOM();
}

export function updateSitePinDOM() {
  if (!state.sitePinDom || !state.sitePinWorldPos) return;
  const vec  = state.sitePinWorldPos.clone().project(camera);
  const rect = canvas.getBoundingClientRect();
  const x    = (vec.x *  0.5 + 0.5) * rect.width;
  const y    = (vec.y * -0.5 + 0.5) * rect.height;
  state.sitePinDom.style.left = x + 'px';
  state.sitePinDom.style.top  = y + 'px';
}
