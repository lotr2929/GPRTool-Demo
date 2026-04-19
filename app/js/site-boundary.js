/*
 * site-boundary.js — Google Maps lot boundary picker for GPRTool
 *
 * Opens a modal with a Google Maps HYBRID view, auto-centred and auto-zoomed
 * on the imported DXF extent (supplied as WGS84 bounds by the caller).
 *
 * The user draws a polygon over visible lot lines, optionally applies an
 * X/Y offset nudge to correct minor misalignment, then confirms.
 *
 * Output: WGS84 GeoJSON Polygon feature → passed to onConfirm callback.
 *
 * ── REAL WORLD RULE ───────────────────────────────────────────────────────
 * All coordinates here are WGS84. The X/Y offset nudge is applied in
 * WGS84 space (using approximate metres-per-degree conversion at site lat).
 * The output is always WGS84 GeoJSON — never scene or UTM coordinates.
 */

const MAPS_KEY_URL = '/api/maps-key';

// ── Module state ──────────────────────────────────────────────────────────
let _onConfirm   = null;
let _map         = null;
let _drawingMgr  = null;
let _polygon     = null;   // the drawn polygon overlay
let _offsetX     = 0;      // nudge in metres (East-West)
let _offsetY     = 0;      // nudge in metres (North-South)
let _siteLat     = 0;      // site centre lat (for metres→degrees conversion)
let _mapsLoaded  = false;

// ── Modal HTML ────────────────────────────────────────────────────────────
const MODAL_HTML = `
<div id="boundary-overlay" style="
  display:none; position:fixed; inset:0;
  background:rgba(0,0,0,0.6); z-index:1200;
  align-items:center; justify-content:center;">
  <div id="boundary-modal" style="
    background:var(--chrome-panel);
    border:1px solid var(--chrome-border);
    border-radius:6px; width:96vw; height:94vh;
    box-shadow:0 8px 32px rgba(0,0,0,0.28);
    color:var(--text-primary);
    font-family:var(--font,'Outfit',sans-serif);
    overflow:hidden; display:flex; flex-direction:column;">

    <!-- Header -->
    <div style="padding:11px 16px; border-bottom:1px solid var(--chrome-border);
                display:flex; align-items:center; gap:10px;
                background:var(--chrome-dark,#1e3d1e); flex-shrink:0;">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
           stroke="#fff" stroke-width="1.4">
        <polygon points="8,2 14,6 14,14 2,14 2,6"/>
        <polyline points="2,6 8,10 14,6"/>
      </svg>
      <h3 style="margin:0; font-size:13px; font-weight:600; flex:1; color:#fff;">
        Draw Lot Boundary</h3>
      <span style="font-size:10px; color:rgba(255,255,255,0.5); margin-right:6px;">
        Google Maps Hybrid</span>
      <button id="boundary-close" style="
        background:none; border:none; color:rgba(255,255,255,0.6);
        cursor:pointer; font-size:18px; line-height:1; padding:2px 6px;">&#x2715;</button>
    </div>

    <!-- Instructions bar -->
    <div style="padding:8px 16px; background:var(--accent-subtle,#eef4eb);
                font-size:11px; color:var(--text-secondary); flex-shrink:0;
                border-bottom:1px solid var(--chrome-border);">
      Zoom in to your site, then click the
      <strong style="color:var(--text-primary);">polygon tool</strong> in the map toolbar
      to draw your lot boundary over the visible parcel lines.
      Use the <strong style="color:var(--text-primary);">offset nudge</strong> below to
      correct any misalignment between the DXF model and the map.
    </div>

    <!-- Map container — flex:1 so it fills all remaining height -->
    <div id="boundary-map" style="width:100%; flex:1; min-height:0;
         background:#1a1a1a; position:relative;">
      <div id="boundary-map-loading" style="
        position:absolute; inset:0; display:flex; align-items:center;
        justify-content:center; color:#aaa; font-size:12px;">
        Loading map…
      </div>
    </div>

    <!-- Offset nudge + buttons -->
    <div style="padding:10px 16px; border-top:1px solid var(--chrome-border);
                display:flex; align-items:center; gap:16px; flex-shrink:0;
                background:var(--chrome-panel);">

      <div style="font-size:11px; color:var(--text-secondary); flex-shrink:0;">
        Offset nudge (m):
      </div>

      <!-- X nudge -->
      <div style="display:flex; align-items:center; gap:5px;">
        <span style="font-size:10px; color:var(--text-secondary);">E/W</span>
        <button class="nudge-btn" data-axis="x" data-dir="-1"
          style="width:22px; height:22px; border:1px solid var(--chrome-border);
                 background:var(--chrome-panel-alt); border-radius:3px; cursor:pointer;
                 font-size:13px; line-height:1; color:var(--text-primary);">&#8592;</button>
        <span id="nudge-x-val" style="font-size:11px; width:36px; text-align:center;
              background:var(--chrome-input); border:1px solid var(--chrome-border);
              border-radius:3px; padding:2px 4px;">0</span>
        <button class="nudge-btn" data-axis="x" data-dir="1"
          style="width:22px; height:22px; border:1px solid var(--chrome-border);
                 background:var(--chrome-panel-alt); border-radius:3px; cursor:pointer;
                 font-size:13px; line-height:1; color:var(--text-primary);">&#8594;</button>
      </div>

      <!-- Y nudge -->
      <div style="display:flex; align-items:center; gap:5px;">
        <span style="font-size:10px; color:var(--text-secondary);">N/S</span>
        <button class="nudge-btn" data-axis="y" data-dir="-1"
          style="width:22px; height:22px; border:1px solid var(--chrome-border);
                 background:var(--chrome-panel-alt); border-radius:3px; cursor:pointer;
                 font-size:13px; line-height:1; color:var(--text-primary);">&#8595;</button>
        <span id="nudge-y-val" style="font-size:11px; width:36px; text-align:center;
              background:var(--chrome-input); border:1px solid var(--chrome-border);
              border-radius:3px; padding:2px 4px;">0</span>
        <button class="nudge-btn" data-axis="y" data-dir="1"
          style="width:22px; height:22px; border:1px solid var(--chrome-border);
                 background:var(--chrome-panel-alt); border-radius:3px; cursor:pointer;
                 font-size:13px; line-height:1; color:var(--text-primary);">&#8593;</button>
      </div>

      <!-- Nudge step -->
      <div style="display:flex; align-items:center; gap:5px; margin-left:4px;">
        <span style="font-size:10px; color:var(--text-secondary);">Step</span>
        <select id="nudge-step" style="font-size:11px; background:var(--chrome-input);
          border:1px solid var(--chrome-border); border-radius:3px; padding:2px 4px;
          color:var(--text-primary); outline:none;">
          <option value="0.5">0.5 m</option>
          <option value="1" selected>1 m</option>
          <option value="5">5 m</option>
          <option value="10">10 m</option>
        </select>
      </div>

      <button id="boundary-clear" style="
        margin-left:auto; background:none; border:1px solid var(--chrome-border);
        border-radius:4px; font-size:11px; padding:5px 10px; cursor:pointer;
        color:var(--text-secondary);">Clear</button>

      <button id="boundary-confirm" disabled style="
        background:var(--accent-mid,#4a8a4a); color:#fff; border:none;
        border-radius:4px; font-size:12px; padding:6px 18px;
        cursor:pointer; opacity:0.5; white-space:nowrap;">
        Confirm Boundary
      </button>
    </div>

  </div>
</div>`;

// ── Init ──────────────────────────────────────────────────────────────────

export function initSiteBoundary() {
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
  document.getElementById('boundary-close').addEventListener('click', closeModal);
  document.getElementById('boundary-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('boundary-overlay')) closeModal();
  });
  document.getElementById('boundary-clear').addEventListener('click', clearPolygon);
  document.getElementById('boundary-confirm').addEventListener('click', confirmBoundary);

  document.querySelectorAll('.nudge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const axis = btn.dataset.axis;
      const dir  = parseFloat(btn.dataset.dir);
      const step = parseFloat(document.getElementById('nudge-step').value);
      if (axis === 'x') _offsetX += dir * step;
      else              _offsetY += dir * step;
      document.getElementById('nudge-x-val').textContent = _offsetX.toFixed(1);
      document.getElementById('nudge-y-val').textContent = _offsetY.toFixed(1);
      applyNudgeToPolygon();
    });
  });
}

// ── Open the picker ───────────────────────────────────────────────────────

/**
 * Open the lot boundary picker.
 *
 * @param {{ sw: {lat,lng}, ne: {lat,lng} }} wgs84Bounds  - DXF extent in WGS84
 * @param {function} onConfirm  - Called with WGS84 GeoJSON Polygon feature on confirm
 */
export async function openBoundaryPicker(wgs84Bounds, onConfirm) {
  _onConfirm  = onConfirm;
  _offsetX    = 0;
  _offsetY    = 0;
  _polygon    = null;
  _siteLat    = (wgs84Bounds.sw.lat + wgs84Bounds.ne.lat) / 2;

  document.getElementById('nudge-x-val').textContent = '0';
  document.getElementById('nudge-y-val').textContent = '0';
  document.getElementById('boundary-confirm').disabled = true;
  document.getElementById('boundary-confirm').style.opacity = '0.5';
  document.getElementById('boundary-overlay').style.display = 'flex';

  try {
    await ensureMapsLoaded();
    initMap(wgs84Bounds);
  } catch (err) {
    document.getElementById('boundary-map-loading').textContent =
      'Failed to load Google Maps: ' + err.message;
    console.error('[SiteBoundary]', err);
  }
}

// ── Load Google Maps JS API ───────────────────────────────────────────────

async function ensureMapsLoaded() {
  if (_mapsLoaded && window.google?.maps) return;

  const res = await fetch(MAPS_KEY_URL);
  if (!res.ok) throw new Error('Could not fetch Maps API key');
  const { key } = await res.json();

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=drawing&callback=__gmapsReady`;
    script.onerror = () => reject(new Error('Google Maps script failed to load'));
    window.__gmapsReady = () => { _mapsLoaded = true; resolve(); };
    document.head.appendChild(script);
  });
}

// ── Init Google Map ───────────────────────────────────────────────────────

function initMap(wgs84Bounds) {
  const loading = document.getElementById('boundary-map-loading');
  if (loading) loading.style.display = 'none';

  const centre = {
    lat: (wgs84Bounds.sw.lat + wgs84Bounds.ne.lat) / 2,
    lng: (wgs84Bounds.sw.lng + wgs84Bounds.ne.lng) / 2,
  };

  _map = new google.maps.Map(document.getElementById('boundary-map'), {
    center:    centre,
    mapTypeId: google.maps.MapTypeId.HYBRID,
    tilt:      0,   // top-down view for parcel line visibility
    mapTypeControl:    false,
    streetViewControl: false,
    fullscreenControl: false,
    rotateControl:     false,
  });

  // Auto-fit to DXF extent + 20% padding
  const bounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(wgs84Bounds.sw.lat, wgs84Bounds.sw.lng),
    new google.maps.LatLng(wgs84Bounds.ne.lat, wgs84Bounds.ne.lng)
  );
  _map.fitBounds(bounds);
  // Ensure minimum zoom 19 so parcel boundary lines are visible
  google.maps.event.addListenerOnce(_map, 'bounds_changed', () => {
    if (_map.getZoom() < 19) _map.setZoom(19);
  });

  // Drawing manager — polygon tool only
  _drawingMgr = new google.maps.drawing.DrawingManager({
    drawingMode:    google.maps.drawing.OverlayType.POLYGON,
    drawingControl: true,
    drawingControlOptions: {
      position:    google.maps.ControlPosition.TOP_CENTER,
      drawingModes: [google.maps.drawing.OverlayType.POLYGON],
    },
    polygonOptions: {
      strokeColor:   '#4a8a4a',
      strokeWeight:  2.5,
      fillColor:     '#4a8a4a',
      fillOpacity:   0.15,
      editable:      true,
      draggable:     false,
    },
  });

  _drawingMgr.setMap(_map);

  google.maps.event.addListener(_drawingMgr, 'polygoncomplete', poly => {
    // Only one polygon at a time
    if (_polygon) _polygon.setMap(null);
    _polygon = poly;
    _drawingMgr.setDrawingMode(null);  // back to hand mode
    document.getElementById('boundary-confirm').disabled = false;
    document.getElementById('boundary-confirm').style.opacity = '1';
  });
}

// ── Nudge helpers ─────────────────────────────────────────────────────────

function applyNudgeToPolygon() {
  if (!_polygon) return;
  // metres per degree approximations at site latitude
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(_siteLat * Math.PI / 180);
  const dLat = _offsetY / mPerDegLat;
  const dLng = _offsetX / mPerDegLng;
  // Rebuild the polygon path with nudge applied to raw (un-nudged) coordinates
  // We track raw coords on the polygon object
  if (!_polygon._rawPath) {
    // First nudge — snapshot current path as raw
    _polygon._rawPath = _polygon.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
  }
  const nudged = _polygon._rawPath.map(p =>
    new google.maps.LatLng(p.lat + dLat, p.lng + dLng));
  _polygon.setPath(nudged);
}

function clearPolygon() {
  if (_polygon) { _polygon.setMap(null); _polygon = null; }
  if (_drawingMgr) _drawingMgr.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
  document.getElementById('boundary-confirm').disabled = true;
  document.getElementById('boundary-confirm').style.opacity = '0.5';
  _offsetX = _offsetY = 0;
  document.getElementById('nudge-x-val').textContent = '0';
  document.getElementById('nudge-y-val').textContent = '0';
}

// ── Confirm ───────────────────────────────────────────────────────────────

function confirmBoundary() {
  if (!_polygon) return;

  const path   = _polygon.getPath().getArray();
  const coords = path.map(p => [p.lng(), p.lat()]);
  if (coords.length < 3) return;
  coords.push(coords[0]);   // GeoJSON rings must close

  const geojson = {
    type: 'Feature',
    properties: {
      source:   'google_maps_hybrid',
      offset_x: _offsetX,
      offset_y: _offsetY,
      drawn_at: new Date().toISOString(),
    },
    geometry: {
      type:        'Polygon',
      coordinates: [coords],
    },
  };

  closeModal();
  if (_onConfirm) _onConfirm(geojson);
}

function closeModal() {
  document.getElementById('boundary-overlay').style.display = 'none';
}
