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

let gizmoCompassMesh = null;
let _gizmoCanvasTex  = null;
let _gizmoCtx        = null;
let _lastDrawnDnDeg  = undefined; // sentinel — forces draw on first frame
let _lastDrawnGnDeg  = undefined;

// Frame state — pixel size drives everything, frustum NEVER changes
let gizmo3DSize    = 200;
let gizmo3DRight   = 15;
let gizmo3DBottom  = 60;
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
      side: THREE.DoubleSide,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  gizmoCompassMesh = mesh;
  if (_mainScene) _mainScene.add(mesh);
}

// Serialise #np-rotator svg into canvas texture.
// dnDeg: Design North decimal degrees (+ve = E/clockwise), or null.
// gnDeg: Global (True) North decimal degrees.
function updateGizmoTexture(dnDeg, gnDeg) {
  const svgEl = document.querySelector('#np-rotator svg');
  if (!svgEl) return;

  const clone   = svgEl.cloneNode(true);

  // Rotate housing (ticks) to match Design North
  const housingGroup = clone.querySelector('#np-housing-group');
  if (housingGroup) {
    housingGroup.setAttribute('transform', `rotate(${dnDeg}, 32, 40)`);
  }

  // Rotate TN needle to match True North
  const tnNeedle = clone.querySelector('#np-tn-needle');
  if (tnNeedle) {
    tnNeedle.setAttribute('transform', `rotate(${gnDeg}, 32, 40)`);
  }

  // DN arrow dot stays at top relative to housing (0 degrees relative to housing)
  // or we rotate it by dnDeg if it's in the SVG root.
  const dnGroup = clone.querySelector('#np-dn-group');
  if (dnGroup) {
    if (dnDeg !== null && dnDeg !== undefined) {
      dnGroup.style.display = '';
      dnGroup.setAttribute('transform', `rotate(${dnDeg}, 32, 40)`);
    } else {
      dnGroup.style.display = 'none';
    }
  }

  const svgStr = new XMLSerializer().serializeToString(clone);
  const blob   = new Blob([svgStr], { type: 'image/svg+xml' });
  const url    = URL.createObjectURL(blob);
  const img    = new Image();
  img.onload = () => {
    const scale = Math.min(512 / 64, 512 / 72);
    const dw    = 64 * scale;
    const dh    = 72 * scale;
    const dx    = (256 - dw) / 2;
    _gizmoCtx.clearRect(0, 0, 512, 512);
    _gizmoCtx.drawImage(img, dx, 0, dw, dh);
    _gizmoCanvasTex.needsUpdate = true;
    URL.revokeObjectURL(url);
  };
  img.src = url;
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
  requestAnimationFrame(() => updateGizmoTexture(getDesignNorthAngle(), getGlobalNorthAngle()));
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

  // Add mesh to main scene on first call (scene not available at init time)
  if (!gizmoCompassMesh.parent) {
    // Walk up from renderer to find scene via the animate loop's scene variable
    // We inject it here: main.js calls renderCompassGizmo() after renderer.render(scene,camera)
    // so we can't get scene directly. We use a workaround: expose it on the renderer.
    if (!renderer._compassMainScene) return; // not yet set
    renderer._compassMainScene.add(gizmoCompassMesh);
  }

  const cw = container.clientWidth;
  const ch = container.clientHeight;

  // Dynamic NDC from overlay position (keeps mesh synced with draggable overlay)
  const cx   = cw - gizmo3DRight  - gizmo3DSize / 2;
  const cy   = ch - gizmo3DBottom - gizmo3DSize / 2;
  const ndcX = (cx / cw) * 2 - 1;
  const ndcY = 1 - (cy / ch) * 2;

  // Cast ray from that screen position through camera3D into world
  _raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera3D);
  const target = new THREE.Vector3();
  const hit = _raycaster.ray.intersectPlane(_groundPlane, target);
  if (!hit) return; // ray parallel to ground (shouldn't happen for normal angles)

  // Move compass to that world position (on the ground)
  gizmoCompassMesh.position.copy(target);
  gizmoCompassMesh.rotation.y = 0; // N label always points True North (-Z)

  // Scale: keep apparent screen size constant regardless of zoom/distance.
  // At distance D from camera with fov F, a world unit = screenHeight / (2 * D * tan(F/2)) pixels.
  // We want the compass to always be ~compassScreenSize pixels.
  const compassScreenSize = gizmo3DSize; // match overlay size exactly
  const dist = camera3D.position.distanceTo(target);
  const fovRad = camera3D.fov * Math.PI / 180;
  const pixelsPerUnit = ch / (2 * dist * Math.tan(fovRad / 2));
  const worldScale = compassScreenSize / (pixelsPerUnit * 3.0); // PlaneGeometry is 3x3 units
  gizmoCompassMesh.scale.set(worldScale, worldScale, worldScale);

  // Redraw SVG texture only when DN or GN value changes
  const dnDeg = getDesignNorthAngle();
  const gnDeg = getGlobalNorthAngle();
  if (dnDeg !== _lastDrawnDnDeg || gnDeg !== _lastDrawnGnDeg) {
    updateGizmoTexture(dnDeg, gnDeg);
    _lastDrawnDnDeg = dnDeg;
    _lastDrawnGnDeg = gnDeg;
  }
}
