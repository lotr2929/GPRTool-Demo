/**
 * north-point-3d.js — 3D HUD compass gizmo
 *
 * Needs (via getState callback):
 *   renderer     WebGLRenderer
 *   camera3D     PerspectiveCamera
 *   container    HTMLElement  (the viewport wrapper div)
 *   currentMode  string       '2d' | '3d'
 *   showFeedback function(msg, duration?)
 *
 * Needs (imported):
 *   getDesignNorthDeg  from ./north-point-2d.js
 *
 * Exposes:
 *   initNorthPoint3D(getState)   call once after DOM + NP2D are ready
 *   updateGizmoOverlay()         call from switchMode
 *   renderCompassGizmo()         call every frame in 3D mode
 *   toggleGizmo3D()              call from View menu
 */

import * as THREE from 'three';
import { getDesignNorthAngle, getGlobalNorthAngle } from './north-point-2d.js';

// ── Module state ──────────────────────────────────────────────
let getState = null;

// Compass mesh lives in the MAIN scene -- no separate gizmo scene or camera needed.
let _mainScene  = null;  // set at init from getState
let _camera3D   = null;  // set at init from getState
const _raycaster = new THREE.Raycaster();
const _groundNormal = new THREE.Vector3(0, 1, 0);
const _groundPlane  = new THREE.Plane(_groundNormal, 0); // Y=0 plane
const _compassScene  = new THREE.Scene();                   // isolated scene for scissor rendering

let gizmoCompassMesh = null;
let _gizmoCanvasTex  = null;
let _gizmoCtx        = null;
let _lastDrawnDnDeg  = undefined; // sentinel — forces draw on first frame
let _lastDrawnGnDeg  = undefined;

// Frame state — pixel size drives everything, frustum NEVER changes
let gizmo3DSize    = 200;
let gizmo3DRight   = 0;
let gizmo3DBottom  = 0;
let gizmo3DVisible = true;

// Drag / resize state
let _gzDragging     = false;
let _gzDragPending  = false;
let _gzDragStart    = { x: 0, y: 0, r: 0, b: 0 };
let _gzSelected     = false;
let _gzResizing     = false;
let _gzResizeHandle = '';
let _gzResizeStart  = { x: 0, y: 0, size: 0, r: 0, b: 0 };

let gizmoOverlay = null;
const _gzHandles = {};

// ── Compass mesh ──────────────────────────────────────────────

function _buildCompassMesh() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  _gizmoCtx       = cv.getContext('2d');
  _gizmoCanvasTex = new THREE.CanvasTexture(cv);
  _gizmoCanvasTex.generateMipmaps = false;
  _gizmoCanvasTex.minFilter = THREE.LinearFilter;;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 3.0),
    new THREE.MeshBasicMaterial({
      map: _gizmoCanvasTex,
      transparent: true,
      depthWrite: false,
      depthTest:  false,
      side: THREE.DoubleSide,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  gizmoCompassMesh = mesh;
  _compassScene.add(mesh); // dedicated scene -- rendered with scissor, not added to main scene
}

// ── Direct canvas compass drawing ───────────────────────────
// Draws the compass directly via Canvas 2D API — no SVG serialisation,
// no Blob, no Image roundtrip. Renders at full 512×512 resolution.

function _fmtAngleCompact(deg) {
  if (!deg) return '0°';
  const abs = Math.abs(deg), dir = deg > 0 ? 'E' : 'W';
  const d = Math.floor(abs), m = Math.round((abs - d) * 60);
  if (m === 0)  return `${d}°${dir}`;
  if (m === 60) return `${d + 1}°${dir}`;
  return `${d}°${m}'${dir}`;
}

function _drawCompass(dnDeg, gnDeg) {
  const cv  = _gizmoCtx.canvas;
  const W   = cv.width;   // 512
  const H   = cv.height;  // 512
  const ctx = _gizmoCtx;
  ctx.clearRect(0, 0, W, H);

  // Map SVG viewBox (64×72) into canvas (512×512)
  const sc = H / 72;               // ~7.111 px per SVG unit
  const ox = (W - 64 * sc) / 2;   // horizontal offset to centre
  ctx.save();
  ctx.translate(ox, 0);
  ctx.scale(sc, sc);               // now drawing in SVG coord space

  const CX = 32, CY = 40;
  const toRad = d => (d || 0) * Math.PI / 180;

  // ── Housing (rotates with dnDeg) ──
  ctx.save();
  ctx.translate(CX, CY); ctx.rotate(toRad(dnDeg)); ctx.translate(-CX, -CY);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 0.75;
  ctx.beginPath(); ctx.arc(CX, CY, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(32, 15); ctx.lineTo(32, 20);
  ctx.moveTo(32, 60); ctx.lineTo(32, 65);
  ctx.moveTo(7,  40); ctx.lineTo(12, 40);
  ctx.moveTo(52, 40); ctx.lineTo(57, 40);
  ctx.stroke();
  ctx.restore();

  // ── TN needle (rotates with gnDeg) ──
  ctx.save();
  ctx.translate(CX, CY); ctx.rotate(toRad(gnDeg)); ctx.translate(-CX, -CY);
  ctx.font = 'bold 13px Outfit, Georgia, serif';
  ctx.fillStyle = '#1a1a1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('N', 32, 14);
  ctx.beginPath(); ctx.moveTo(32, 18); ctx.lineTo(32, 40); ctx.lineTo(42, 43);
  ctx.closePath(); ctx.fillStyle = '#1a1a1a'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(32, 62); ctx.lineTo(32, 40); ctx.lineTo(22, 37);
  ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#555';
  ctx.lineWidth = 0.6; ctx.fill(); ctx.stroke();
  ctx.restore();

  // ── DN group (only when DN ≠ TN) ──
  if (dnDeg !== gnDeg) {
    ctx.save();
    ctx.translate(CX, CY); ctx.rotate(toRad(dnDeg)); ctx.translate(-CX, -CY);
    ctx.strokeStyle = '#4a8a4a'; ctx.lineWidth = 0.75;
    ctx.beginPath(); ctx.moveTo(32, 18); ctx.lineTo(32, 62); ctx.stroke();
    ctx.beginPath(); ctx.arc(32, 18, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#4a8a4a'; ctx.fill();
    ctx.font = '7px Outfit, sans-serif';
    ctx.fillStyle = '#4a8a4a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(_fmtAngleCompact(dnDeg - gnDeg), 32, 13);
    ctx.restore();
  }

  ctx.restore(); // undo scale + translate
  _gizmoCanvasTex.needsUpdate = true;
}

// ── Overlay div ───────────────────────────────────────────────

function _buildOverlay() {
  const { container } = getState();
  container.style.position = 'relative';

  gizmoOverlay    = document.createElement('div');
  gizmoOverlay.id = 'gizmo3d-overlay';
  gizmoOverlay.style.cssText = [
    'position:absolute', 'cursor:grab', 'display:none',
    'z-index:10', 'box-sizing:border-box', 'border-radius:4px',
  ].join(';');
  container.appendChild(gizmoOverlay);

  // 4 corner resize handles — [id, top, right, bottom, left]
  [
    ['nw', '-5', '',   '',   '-5'],
    ['ne', '-5', '-5', '',   ''  ],
    ['sw', '',   '',   '-5', '-5'],
    ['se', '',   '-5', '-5', ''  ],
  ].forEach(([id, t, r, b, l]) => {
    const h      = document.createElement('div');
    h.dataset.handle = id;
    const cursor = (id === 'nw' || id === 'se') ? 'nwse-resize' : 'nesw-resize';
    h.style.cssText = [
      'position:absolute', 'width:10px', 'height:10px',
      'background:#4a8a4a', 'border:1.5px solid #fff', 'border-radius:2px',
      'display:none', 'z-index:12', `cursor:${cursor}`,
      t ? `top:${t}px`    : '', r ? `right:${r}px`   : '',
      b ? `bottom:${b}px` : '', l ? `left:${l}px`    : '',
    ].filter(Boolean).join(';');
    gizmoOverlay.appendChild(h);
    _gzHandles[id] = h;
  });

  gizmoOverlay.addEventListener('pointerdown', _onPointerDown);
  gizmoOverlay.addEventListener('pointermove', _onPointerMove);
  gizmoOverlay.addEventListener('pointerup',   _onPointerUp);

  document.addEventListener('click', e => {
    if (_gzSelected && !gizmoOverlay.contains(e.target)) _setSelected(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _gzSelected) _setSelected(false);
  });
}

function _setSelected(sel) {
  _gzSelected = sel;
  const show  = sel ? 'block' : 'none';
  Object.values(_gzHandles).forEach(h => h.style.display = show);
  gizmoOverlay.style.outline = sel ? '1.5px solid #4a8a4a' : 'none';
}

function _onPointerDown(e) {
  if (e.button !== 0) return;
  const handle = e.target.dataset?.handle;
  if (handle) {
    _gzResizing     = true;
    _gzResizeHandle = handle;
    _gzResizeStart  = { x: e.clientX, y: e.clientY, size: gizmo3DSize, r: gizmo3DRight, b: gizmo3DBottom };
    gizmoOverlay.setPointerCapture(e.pointerId);
    e.stopPropagation();
    return;
  }
  _gzDragPending = true;
  _gzDragging    = false;
  _gzDragStart   = { x: e.clientX, y: e.clientY, r: gizmo3DRight, b: gizmo3DBottom };
  gizmoOverlay.setPointerCapture(e.pointerId);
  e.stopPropagation();
}

function _onPointerMove(e) {
  const { container } = getState();
  const cw = container.clientWidth;
  const ch = container.clientHeight;

  if (_gzResizing) {
    const dx = e.clientX - _gzResizeStart.x;
    const dy = e.clientY - _gzResizeStart.y;
    const h  = _gzResizeHandle;
    let delta;
    if      (h === 'se') delta = ( dx + dy) / 2;
    else if (h === 'nw') delta = (-dx - dy) / 2;
    else if (h === 'ne') delta = ( dx - dy) / 2;
    else                 delta = (-dx + dy) / 2;

    const newSize   = Math.round(Math.max(80, Math.min(300, _gzResizeStart.size + delta)));
    const sizeDelta = newSize - _gzResizeStart.size;
    gizmo3DSize = newSize;

    if (h === 'se') {
      gizmo3DRight  = Math.max(0, _gzResizeStart.r - sizeDelta);
      gizmo3DBottom = Math.max(0, _gzResizeStart.b - sizeDelta);
    } else if (h === 'nw') {
      gizmo3DRight  = Math.min(cw - newSize, _gzResizeStart.r + sizeDelta);
      gizmo3DBottom = Math.min(ch - newSize, _gzResizeStart.b + sizeDelta);
    } else if (h === 'ne') {
      gizmo3DRight  = Math.max(0, _gzResizeStart.r - sizeDelta);
      gizmo3DBottom = Math.min(ch - newSize, _gzResizeStart.b + sizeDelta);
    } else {
      gizmo3DRight  = Math.min(cw - newSize, _gzResizeStart.r + sizeDelta);
      gizmo3DBottom = Math.max(0, _gzResizeStart.b - sizeDelta);
    }
    updateGizmoOverlay();
    return;
  }

  if (!_gzDragPending) return;
  const dx = e.clientX - _gzDragStart.x;
  const dy = e.clientY - _gzDragStart.y;
  if (!_gzDragging && Math.hypot(dx, dy) > 4) _gzDragging = true;
  if (_gzDragging) {
    gizmo3DRight  = Math.max(0, Math.min(cw - gizmo3DSize, _gzDragStart.r - dx));
    gizmo3DBottom = Math.max(0, Math.min(ch - gizmo3DSize, _gzDragStart.b - dy));
    updateGizmoOverlay();
  }
}

function _onPointerUp(e) {
  const wasDrag   = _gzDragging;
  const wasResize = _gzResizing;
  _gzDragPending  = false;
  _gzDragging     = false;
  _gzResizing     = false;
  _gzResizeHandle = '';
  gizmoOverlay.style.cursor = 'grab';
  if (!wasDrag && !wasResize && !e.target.dataset?.handle) {
    _setSelected(!_gzSelected);
  }
  _saveGizmo3DState();
}

// ── Persistence ───────────────────────────────────────────────

const _GIZMO3D_KEY = 'gprtool-gizmo3d';

function _saveGizmo3DState() {
  try {
    localStorage.setItem(_GIZMO3D_KEY, JSON.stringify({
      size: gizmo3DSize, right: gizmo3DRight, bottom: gizmo3DBottom, visible: gizmo3DVisible
    }));
  } catch(e) {}
}

function _loadGizmo3DState() {
  try {
    const s = JSON.parse(localStorage.getItem(_GIZMO3D_KEY) || '{}');
    if (s.size)                gizmo3DSize    = s.size;
    if (s.right  !== undefined) gizmo3DRight  = s.right;
    if (s.bottom !== undefined) gizmo3DBottom = s.bottom;
    if (s.visible !== undefined) gizmo3DVisible = s.visible;
  } catch(e) {}
}

// ── Public API ────────────────────────────────────────────────

export function initNorthPoint3D(getStateCallback) {
  getState = getStateCallback;
  const { renderer: _r, camera3D: _c, container: _cont } = getStateCallback();
  _mainScene = _r.__compassScene || (() => {
    // We need the main scene -- passed via getState callback at render time
    return null;
  })();
  _camera3D  = _c;
  _loadGizmo3DState();
  _buildCompassMesh();
  _buildOverlay();
  // Draw texture one frame after NP2D has injected #np-dn-group into the SVG
  requestAnimationFrame(() => _drawCompass(getDesignNorthAngle(), getGlobalNorthAngle()));
}

export function updateGizmoOverlay() {
  if (!gizmoOverlay) return;
  const { currentMode } = getState();
  const show = gizmo3DVisible && currentMode === '3d';
  gizmoOverlay.style.display  = show ? 'block' : 'none';
  gizmoOverlay.style.width    = gizmo3DSize + 'px';
  gizmoOverlay.style.height   = gizmo3DSize + 'px';
  gizmoOverlay.style.right    = gizmo3DRight  + 'px';
  gizmoOverlay.style.bottom   = gizmo3DBottom + 'px';
}

export function isGizmo3DVisible() { return gizmo3DVisible; }

export function toggleGizmo3D() {
  gizmo3DVisible = !gizmo3DVisible;
  updateGizmoOverlay();
  const { showFeedback } = getState();
  showFeedback('North Point ' + (gizmo3DVisible ? 'visible' : 'hidden'));
}

export function renderCompassGizmo() {
  const { renderer, camera3D, container } = getState();
  if (!gizmoCompassMesh) return;

  const cw = container.clientWidth;
  const ch = container.clientHeight;

  // Dynamic NDC from overlay centre position
  const cx   = cw - gizmo3DRight  - gizmo3DSize / 2;
  const cy   = ch - gizmo3DBottom - gizmo3DSize / 2;
  const ndcX = (cx / cw) * 2 - 1;
  const ndcY = 1 - (cy / ch) * 2;

  // Cast ray from overlay centre through camera to ground plane
  _raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera3D);
  const target = new THREE.Vector3();
  const hit = _raycaster.ray.intersectPlane(_groundPlane, target);
  if (!hit) return;

  // Position and scale compass mesh
  gizmoCompassMesh.position.copy(target);
  gizmoCompassMesh.rotation.y = 0;

  const dist = camera3D.position.distanceTo(target);
  const fovRad = camera3D.fov * Math.PI / 180;
  const pixelsPerUnit = ch / (2 * dist * Math.tan(fovRad / 2));
  const worldScale = gizmo3DSize / (pixelsPerUnit * 3.0);
  gizmoCompassMesh.scale.set(worldScale, worldScale, worldScale);

  // Project all 4 corners of the compass plane to get the exact screen bounding box.
  // This handles overflow in all directions regardless of camera orientation.
  const camToTargetXZ = new THREE.Vector2(
    target.x - camera3D.position.x,
    target.z - camera3D.position.z
  ).normalize();
  const perpXZ = new THREE.Vector2(-camToTargetXZ.y, camToTargetXZ.x);
  const hs     = worldScale * 1.5;
  const corners = [[-1,-1],[-1,1],[1,-1],[1,1]].map(([s,p]) =>
    new THREE.Vector3(
      target.x + s * camToTargetXZ.x * hs + p * perpXZ.x * hs,
      0,
      target.z + s * camToTargetXZ.y * hs + p * perpXZ.y * hs
    )
  );
  let minSX = Infinity, maxSX = -Infinity, minSY = Infinity, maxSY = -Infinity;
  corners.forEach(c => {
    const n  = c.clone().project(camera3D);
    const px = (n.x + 1) / 2 * cw;    // CSS X
    const py = (1 - n.y) / 2 * ch;    // CSS Y (0 = top)
    if (px < minSX) minSX = px;  if (px > maxSX) maxSX = px;
    if (py < minSY) minSY = py;  if (py > maxSY) maxSY = py;
  });
  const PAD = 4;
  // Convert bounding box to WebGL scissor coords (Y from canvas bottom)
  const scX = Math.max(0, Math.floor(minSX) - PAD);
  const scY = Math.max(0, Math.floor(ch - maxSY) - PAD);
  const scW = Math.ceil(maxSX - minSX) + PAD * 2;
  const scH = Math.ceil(maxSY - minSY) + PAD * 2;
  renderer.setScissorTest(true);
  renderer.setScissor(scX, scY, scW, scH);

  // Disable auto-clear so the main scene shows through transparent areas
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.render(_compassScene, camera3D);
  renderer.autoClear = prevAutoClear;

  renderer.setScissorTest(false);

  // Redraw texture only when north angles change
  const dnDeg = getDesignNorthAngle();
  const gnDeg = getGlobalNorthAngle();
  if (dnDeg !== _lastDrawnDnDeg || gnDeg !== _lastDrawnGnDeg) {
    _drawCompass(dnDeg, gnDeg);
    _lastDrawnDnDeg = dnDeg;
    _lastDrawnGnDeg = gnDeg;
  }
}
