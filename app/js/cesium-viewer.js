/*
 * cesium-viewer.js — CesiumJS + Google Photorealistic 3D Tiles for GPRTool
 *
 * Replaces the Three.js scene for the main 3D context viewport.
 * The real-world context (terrain + buildings) is provided by Google 3D Tiles.
 * Design overlays (lot boundary, plants, GPR results) are Cesium entities.
 *
 * ── COORDINATE RULE ───────────────────────────────────────────────────────
 * All positions passed in/out of this module are WGS84 { lat, lng }.
 * Conversion to/from scene/UTM stays in real-world.js.
 * Cesium.Cartesian3.fromDegrees(lng, lat, alt) is the only coordinate bridge.
 *
 * Exports:
 *   initCesiumViewer(containerId)  → Promise<Viewer>
 *   getCesiumViewer()              → Viewer | null
 *   isCesiumReady()                → bool
 *   flyToSite(lat, lng, alt?)      → void
 *   showLotBoundary(geojson)       → void   GeoJSON Polygon feature (WGS84)
 *   clearLotBoundary()             → void
 *   startBoundaryPick(onPoint, onDone) → start interactive boundary drawing
 *   cancelBoundaryPick()           → void
 *   pickSurface(windowPos)         → { lat, lng, alt } | null
 */

// Cesium loaded via CDN <script> tag → window.Cesium
// Ion token: suppresses the default ion warning; we don't use ion data services
const ION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMDA1LTQyMjctODc4OS1lMTY4NWY4YWY3MDIiLCJpZCI6MjYxMzMsInNjb3BlcyI6WyJhc3IiXSwiaWF0IjoxNTg2NDI3NDQ0fQ.bFb2CiDXLMlxJFgRkjX8NOvXCHYLBi5oEdqSEH4gUTY';

let _viewer   = null;
let _tileset  = null;
let _ready    = false;

// Design entities
let _lotBoundaryEntity = null;
let _boundaryPoints    = [];  // [Cesium.Cartesian3]
let _boundaryPolyline  = null;
let _boundaryPickActive = false;
let _onBoundaryPoint   = null;
let _onBoundaryDone    = null;
let _pickHandler       = null;

// Site / view-mode state — used to show/hide the viewport 2D/3D toggle pill.
// _siteLocated flips true on first successful flyToSite or click-pick;
// reset by resetCesiumView (Clear Site / New Project).
let _siteLocated = false;
let _viewMode    = '3D';   // '2D' | '3D'

// ── Init ──────────────────────────────────────────────────────────────────

export async function initCesiumViewer(containerId) {
  if (typeof Cesium === 'undefined') {
    throw new Error('CesiumJS not loaded — check index.html CDN script tag');
  }

  Cesium.Ion.defaultAccessToken = ION_TOKEN;

  _viewer = new Cesium.Viewer(containerId, {
    imageryProvider:      false,
    baseLayerPicker:      false,
    geocoder:             false,
    homeButton:           false,
    sceneModePicker:      false,
    navigationHelpButton: false,
    animation:            false,
    timeline:             false,
    fullscreenButton:     false,
    vrButton:             false,
    infoBox:              false,
    selectionIndicator:   false,
    terrainProvider:      new Cesium.EllipsoidTerrainProvider(),
  });

  // Hide globe — Google tiles handle terrain + surface entirely
  _viewer.scene.globe.show         = false;
  _viewer.scene.skyAtmosphere.show = false;
  _viewer.scene.skyBox.show        = false;
  _viewer.scene.backgroundColor    = new Cesium.Color(0.06, 0.06, 0.06, 1.0);

  // Load Google Photorealistic 3D Tiles
  try {
    const res = await fetch('/api/maps-key');
    if (!res.ok) throw new Error('maps-key ' + res.status);
    const { key } = await res.json();
    const url = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`;
    _tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: 8,
    });
    _viewer.scene.primitives.add(_tileset);
    _ready = true;
    console.log('[CesiumViewer] Google 3D Tiles loaded');
  } catch (err) {
    console.error('[CesiumViewer] Google 3D Tiles failed:', err);
    // Viewer still usable — just no tiles
  }

  // Resize Cesium canvas when window resizes
  window.addEventListener('resize', () => _viewer?.resize());

  // Altitude readout only — no HUD buttons
  _viewer.scene.postRender.addEventListener(_updateAltitude);

  // Auto-rotate globe on startup
  _startAutoRotate();

  // Inject minimal HUD (altitude only)
  _injectHUD();

  // Stop auto-rotate on any user interaction
  _viewer.scene.canvas.addEventListener('mousedown', () => { _autoRotating = false; }, { once: false });
  _viewer.scene.canvas.addEventListener('wheel',     () => { _autoRotating = false; }, { once: false });

  return _viewer;
}

// ── Auto-rotate ───────────────────────────────────────────────────────────
let _autoRotating = true;

function _startAutoRotate() {
  if (!_viewer) return;
  _viewer.clock.shouldAnimate = true;
  _viewer.scene.postRender.addEventListener(() => {
    if (!_autoRotating) return;
    _viewer.camera.rotateRight(0.0008);
  });
}

/** Stop auto-rotate (called when user interacts with the globe). */
export function stopAutoRotate() {
  _autoRotating = false;
}

function _updateAltitude() {
  const el = document.getElementById('cesium-alt');
  if (!el || !_viewer) return;
  const pos = _viewer.camera.positionCartographic;
  if (!pos) return;
  const alt = pos.height;
  el.textContent = alt < 1000
    ? `Alt ${alt.toFixed(0)} m`
    : `Alt ${(alt / 1000).toFixed(2)} km`;
}

function _injectHUD() {
  if (document.getElementById('cesium-hud')) return;
  const hud = document.createElement('div');
  hud.id = 'cesium-hud';
  hud.style.cssText = `
    position:absolute; bottom:12px; right:16px; z-index:10;
    display:flex; gap:8px; align-items:center;
    font:11px/1.4 'Segoe UI',sans-serif; color:rgba(255,255,255,0.6);
  `;
  hud.innerHTML = `<span id="cesium-alt" style="pointer-events:none;"></span>`;
  document.getElementById('cesium-container')?.appendChild(hud);
  _injectViewToggle();
}

// 2D/3D toggle pill — overlaid on the Cesium viewport, sibling of the altitude
// readout inside #cesium-hud. Hidden until the user has located a site
// (_siteLocated). Stays visible until Clear Site (resetCesiumView).
// Label shows the TARGET mode: in 3D the button reads "2D" (= click to go 2D).
function _injectViewToggle() {
  if (document.getElementById('cesium-view-toggle')) return;
  const btn = document.createElement('button');
  btn.id    = 'cesium-view-toggle';
  btn.type  = 'button';
  btn.title = 'Toggle 2D / 3D view';
  btn.textContent = '2D';
  btn.style.cssText = `
    display:none; pointer-events:auto;
    background: var(--chrome-panel, rgba(40,40,40,0.85));
    color: var(--text-primary, #fff);
    border: 1px solid var(--chrome-border, rgba(255,255,255,0.25));
    border-radius: 14px;
    font: 600 11px/1 'Segoe UI', sans-serif;
    padding: 5px 12px;
    cursor: pointer;
  `;
  btn.addEventListener('click', () => {
    if (_viewMode === '3D') {
      setCesium2D();
      _viewMode      = '2D';
      btn.textContent = '3D';
    } else {
      setCesium3D();
      _viewMode      = '3D';
      btn.textContent = '2D';
    }
  });
  document.getElementById('cesium-hud')?.appendChild(btn);
}

function _showViewToggle() {
  const btn = document.getElementById('cesium-view-toggle');
  if (btn) btn.style.display = 'inline-block';
}

function _hideViewToggle() {
  const btn = document.getElementById('cesium-view-toggle');
  if (btn) btn.style.display = 'none';
  _viewMode = '3D';
  if (btn) btn.textContent = '2D';
}

export const getCesiumViewer = () => _viewer;
export const isCesiumReady   = () => _ready;

// ── Exclusive render state switching ──────────────────────────────────────
// Cesium and Three.js are two separate rendering states — never both visible.

/** Activate Cesium — hide all Three.js overlays. */
export function showCesiumView() {
  const cesiumEl = document.getElementById('cesium-container');
  const canvas   = document.getElementById('three-canvas');
  const np       = document.getElementById('np-container');
  const toggle   = document.querySelector('.mode-toggle-container');
  // Also hide the 3D gizmo overlay (injected by north-point-3d.js)
  const gizmo    = document.getElementById('gizmo3d-overlay');
  if (cesiumEl) cesiumEl.style.display = 'block';
  if (canvas)   canvas.style.display   = 'none';
  if (np)       np.style.display       = 'none';
  if (toggle)   toggle.style.display   = 'none';
  if (gizmo)    gizmo.style.display    = 'none';
}

/** Activate Three.js — hide Cesium only. NPoint modules manage their own visibility. */
export function showThreeJSView() {
  const cesiumEl = document.getElementById('cesium-container');
  const canvas   = document.getElementById('three-canvas');
  const toggle   = document.querySelector('.mode-toggle-container');
  if (cesiumEl) cesiumEl.style.display = 'none';
  if (canvas) {
    canvas.style.display = 'block';
    window.dispatchEvent(new Event('resize'));
  }
  if (toggle) toggle.style.display = 'flex';
  // NPoint 2D (#np-container) and NPoint 3D (gizmoOverlay) are managed
  // by north-point-2d.js and north-point-3d.js respectively via switchMode().
  // Do NOT touch them here.
}

// ── Camera view presets ───────────────────────────────────────────────────

/** Switch to top-down 2D-style view at current lat/lng. */
export function setCesium2D() {
  if (!_viewer) return;
  const pos = _viewer.camera.positionCartographic;
  _viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(pos.longitude, pos.latitude, 800),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.2,
  });
}

/** Switch to 3D perspective view at current lat/lng. Mirror of setCesium2D
 *  but with pitch=-35° instead of -90°. Used by the viewport 2D/3D toggle. */
export function setCesium3D() {
  if (!_viewer) return;
  const pos = _viewer.camera.positionCartographic;
  _viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(pos.longitude, pos.latitude, 800),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
    duration: 1.2,
  });
}

/**
 * Activate street-level mode: user clicks a point on the 3D scene,
 * camera descends to 1.7m above that point facing horizontally.
 * Shows a crosshair cursor and status hint until the user clicks.
 */
export function setCesiumStreetLevel() {
  if (!_viewer) return;
  // Show hint in HUD
  const alt = document.getElementById('cesium-alt');
  if (alt) alt.textContent = 'Click to set street viewpoint\u2026';
  _viewer.container.style.cursor = 'crosshair';

  const handler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
  handler.setInputAction(e => {
    handler.destroy();
    _viewer.container.style.cursor = '';
    const pos = _pickCartesian(e.position);
    if (!pos) return;
    const carto = Cesium.Cartographic.fromCartesian(pos);
    // Descend to 1.7m above the picked surface point (eye height)
    _viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        carto.longitude, carto.latitude, carto.height + 1.7
      ),
      orientation: {
        heading: _viewer.camera.heading,
        pitch:   Cesium.Math.toRadians(-5),
        roll:    0,
      },
      duration: 1.5,
    });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/**
 * Get current camera position as WGS84.
 * @returns {{ lat: number, lng: number, alt: number }}
 */
export function getCameraPosition() {
  if (!_viewer) return null;
  const pos = _viewer.camera.positionCartographic;
  return {
    lat: Cesium.Math.toDegrees(pos.latitude),
    lng: Cesium.Math.toDegrees(pos.longitude),
    alt: pos.height,
  };
}

/**
 * Reset Cesium to the default Perth overview.
 * Called by Clear Site / New Project.
 */
export function resetCesiumView() {
  stopLocationPick();
  cesiumClearLotBoundary_internal();
  _autoRotating = true; // restart globe rotation
  _siteLocated  = false;
  _hideViewToggle();
  if (_viewer) {
    // Zoom out to globe view
    _viewer.camera.flyHome(1.5);
  }
}

function cesiumClearLotBoundary_internal() {
  if (_viewer && _lotBoundaryEntity) {
    _viewer.entities.remove(_lotBoundaryEntity);
    _lotBoundaryEntity = null;
  }
}

// ── Camera ────────────────────────────────────────────────────────────────

/**
 * Fly to a WGS84 site location.
 *
 * BUG FIX (Session #29): Cesium.Cartesian3.fromDegrees(_, _, alt) is
 * ELLIPSOID-relative. In dense urban areas (Sydney CBD towers > 200m above
 * ellipsoid) flying to alt=200-400m places the camera INSIDE photogrammetric
 * building meshes — user sees abstract texture, "wrong location". Fix: sample
 * the topmost surface at the destination via scene.sampleHeightMostDetailed
 * (which considers the loaded Google 3D tileset, not just the ellipsoid
 * terrain provider) and place the camera at groundHeight + safeAlt above it.
 *
 * Also marks site located + reveals the viewport 2D/3D toggle pill, and
 * stops the globe auto-rotate.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} [alt=800]  Camera altitude in metres ABOVE GROUND
 */
export async function flyToSite(lat, lng, alt = 800) {
  if (!_viewer) return;
  _autoRotating = false;
  _siteLocated  = true;
  _showViewToggle();

  const carto = Cesium.Cartographic.fromDegrees(lng, lat);
  let groundHeight = 0;
  try {
    const sampled = await _viewer.scene.sampleHeightMostDetailed([carto]);
    if (sampled && sampled[0] && Number.isFinite(sampled[0].height)) {
      groundHeight = sampled[0].height;
    }
  } catch (err) {
    console.warn('[CesiumViewer] sampleHeightMostDetailed failed; using ellipsoid', err);
  }

  _viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, groundHeight + alt),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch:   Cesium.Math.toRadians(-35),
      roll:    0,
    },
    duration: 2.0,
  });
}

// ── Lot Boundary ──────────────────────────────────────────────────────────

/**
 * Display a lot boundary polygon on the Cesium scene.
 * @param {Object} geojson  GeoJSON Feature with Polygon geometry (WGS84)
 */
export function showLotBoundary(geojson) {
  if (!_viewer) return;
  clearLotBoundary();

  const coords = geojson?.geometry?.coordinates?.[0] ?? geojson?.coordinates?.[0];
  if (!coords || coords.length < 3) return;

  // Flatten [lng, lat] pairs → [lng, lat, lng, lat, …] for Cesium
  const flat = coords.flatMap(([lng, lat]) => [lng, lat]);

  _lotBoundaryEntity = _viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flat),
      width: 3,
      material: new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString('#ff8c00')
      ),
      clampToGround: true,
    },
  });
}

export function clearLotBoundary() {
  if (_viewer && _lotBoundaryEntity) {
    _viewer.entities.remove(_lotBoundaryEntity);
    _lotBoundaryEntity = null;
  }
}

// ── Interactive Boundary Pick ─────────────────────────────────────────────
// User clicks on the Cesium 3D tile surface to define the lot boundary.

/**
 * Start interactive lot boundary drawing on the Cesium scene.
 * @param {Function} onPoint  Called with { lat, lng } on each click
 * @param {Function} onDone   Called with array of { lat, lng } on double-click
 */
export function startBoundaryPick(onPoint, onDone) {
  if (!_viewer) return;
  cancelBoundaryPick();

  _boundaryPickActive = true;
  _onBoundaryPoint    = onPoint;
  _onBoundaryDone     = onDone;
  _boundaryPoints     = [];
  _viewer.container.style.cursor = 'crosshair';

  _pickHandler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);

  _pickHandler.setInputAction(e => {
    const pos = _pickCartesian(e.position);
    if (!pos) return;
    const carto = Cesium.Cartographic.fromCartesian(pos);
    const pt = {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lng: Cesium.Math.toDegrees(carto.longitude),
    };
    _boundaryPoints.push(pos);
    if (_onBoundaryPoint) _onBoundaryPoint(pt);
    _updateBoundaryPreview();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  _pickHandler.setInputAction(() => {
    const pts = _boundaryPoints.map(c => {
      const carto = Cesium.Cartographic.fromCartesian(c);
      return {
        lat: Cesium.Math.toDegrees(carto.latitude),
        lng: Cesium.Math.toDegrees(carto.longitude),
      };
    });
    cancelBoundaryPick();
    if (_onBoundaryDone) _onBoundaryDone(pts);
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}

export function cancelBoundaryPick() {
  _boundaryPickActive = false;
  _boundaryPoints     = [];
  if (_pickHandler) { _pickHandler.destroy(); _pickHandler = null; }
  if (_viewer)      { _viewer.container.style.cursor = ''; }
  if (_boundaryPolyline) {
    _viewer.entities.remove(_boundaryPolyline);
    _boundaryPolyline = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _pickCartesian(windowPos) {
  if (!_viewer) return null;
  // Try picking against 3D tiles first, fall back to ellipsoid
  const pickedPos = _viewer.scene.pickPosition(windowPos);
  if (pickedPos && Cesium.defined(pickedPos)) return pickedPos;
  const ray = _viewer.camera.getPickRay(windowPos);
  return _viewer.scene.globe.pick(ray, _viewer.scene) ?? null;
}

function _updateBoundaryPreview() {
  if (!_viewer || _boundaryPoints.length < 2) return;
  if (_boundaryPolyline) _viewer.entities.remove(_boundaryPolyline);
  _boundaryPolyline = _viewer.entities.add({
    polyline: {
      positions: [..._boundaryPoints, _boundaryPoints[0]],
      width: 2,
      material: new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString('#ff8c00').withAlpha(0.7)
      ),
      clampToGround: true,
    },
  });
}

/**
 * Pick a 3D position from the Cesium scene at a screen-space position.
 * Returns WGS84 { lat, lng, alt } or null.
 * Used for plant placement raycasting.
 *
 * @param {{ x: number, y: number }} windowPos
 * @returns {{ lat: number, lng: number, alt: number } | null}
 */
export function pickSurface(windowPos) {
  if (!_viewer) return null;
  const pos = _pickCartesian(windowPos);
  if (!pos) return null;
  const carto = Cesium.Cartographic.fromCartesian(pos);
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lng: Cesium.Math.toDegrees(carto.longitude),
    alt: carto.height,
  };
}

/**
 * Get current camera heading in degrees (0 = North, 90 = East).
 * Used to sync the north-point compass overlay.
 */
export function getCameraHeading() {
  if (!_viewer) return 0;
  return Cesium.Math.toDegrees(_viewer.camera.heading);
}

/**
 * Subscribe to camera change events (for north-point sync).
 * @param {Function} callback  called with heading in degrees
 */
export function onCameraChange(callback) {
  if (!_viewer) return;
  _viewer.scene.postRender.addEventListener(() => {
    callback(getCameraHeading());
  });
}

// ── Location pick (OSM import modal) ─────────────────────────────────────
// When the OSM import modal is open, a single click on the Cesium scene
// fires the callback with { lat, lng } and places a marker.

let _locationPickHandler = null;
let _locationMarker      = null;

/**
 * Activate one-shot location pick — next click on the Cesium scene
 * fires callback({ lat, lng }) and places a green marker.
 * Remains active (not one-shot) until stopLocationPick() is called.
 */
export function startLocationPick(callback) {
  if (!_viewer) return;
  stopLocationPick();
  _viewer.container.style.cursor = 'crosshair';
  _locationPickHandler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
  _locationPickHandler.setInputAction(e => {
    const pos = _pickCartesian(e.position);
    if (!pos) return;
    const carto = Cesium.Cartographic.fromCartesian(pos);
    const lat   = Cesium.Math.toDegrees(carto.latitude);
    const lng   = Cesium.Math.toDegrees(carto.longitude);
    // Place / move marker
    if (_locationMarker) _viewer.entities.remove(_locationMarker);
    _locationMarker = _viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString('#4a8a4a'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    _autoRotating = false;
    _siteLocated  = true;
    _showViewToggle();
    callback({ lat, lng });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

export function stopLocationPick() {
  if (_locationPickHandler) { _locationPickHandler.destroy(); _locationPickHandler = null; }
  if (_viewer) _viewer.container.style.cursor = '';
  if (_locationMarker) { _viewer.entities.remove(_locationMarker); _locationMarker = null; }
}
