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

const gizmoScene  = new THREE.Scene();
const gizmoCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);

let gizmoCompassMesh = null;
let _gizmoCanvasTex  = null;
let _gizmoCtx        = null;
let _lastDrawnDnDeg  = undefined; // sentinel — forces draw on first frame
let _lastDrawnGnDeg  = undefined;

// Frame state — pixel size drives everything, frustum NEVER changes
let gizmo3DSize    = 160;
let gizmo3DRight   = 16;
let gizmo3DBottom  = 16;
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
  cv.width = cv.height = 256;
  _gizmoCtx       = cv.getContext('2d');
  _gizmoCanvasTex = new THREE.CanvasTexture(cv);

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
  gizmoCompassMesh.scale.x = -1; // un-mirror: canvas texture renders flipped horizontally
  gizmoScene.add(mesh);
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
    const scale = Math.min(256 / 64, 256 / 72);
    const dw    = 64 * scale;
    const dh    = 72 * scale;
    const dx    = (256 - dw) / 2;
    _gizmoCtx.clearRect(0, 0, 256, 256);
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
}

// ── Public API ────────────────────────────────────────────────

export function initNorthPoint3D(getStateCallback) {
  getState = getStateCallback;
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

  const size = gizmo3DSize;
  const cw   = container.clientWidth;
  const ch   = container.clientHeight;
  const x    = Math.round(cw - gizmo3DRight - size);
  const y    = Math.round(gizmo3DBottom);

  // Fix: always view compass from directly above -- extract yaw only from camera3D
  const _euler = new THREE.Euler().setFromQuaternion(camera3D.quaternion, 'YXZ');
  gizmoCamera.position.set(0, 5, 0);
  gizmoCamera.up.set(Math.sin(_euler.y), 0, -Math.cos(_euler.y)); // yaw rotates "up" vector
  gizmoCamera.lookAt(0, 0, 0);

  // Redraw SVG texture only when DN or GN value changes
  const dnDeg = getDesignNorthAngle();
  const gnDeg = getGlobalNorthAngle();
  if (dnDeg !== _lastDrawnDnDeg || gnDeg !== _lastDrawnGnDeg) {
    updateGizmoTexture(dnDeg, gnDeg);
    _lastDrawnDnDeg = dnDeg;
    _lastDrawnGnDeg = gnDeg;
  }
  // N label always points True North (world -Z) — mesh never rotates
  gizmoCompassMesh.rotation.y = 0;

  renderer.setScissorTest(true);
  renderer.setScissor(x, y, size, size);
  renderer.setViewport(x, y, size, size);

  // No colour clear — main scene shows through (transparent frame)
  const savedAutoClear  = renderer.autoClear;
  renderer.autoClear    = false;
  renderer.clear(false, true, false); // depth-only clear
  renderer.render(gizmoScene, gizmoCamera);
  renderer.autoClear    = savedAutoClear;

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, cw, ch);
}
