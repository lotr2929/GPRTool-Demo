/**
 * north-point-2d.js — 2D DOM compass widget
 *
 * Needs (via getState callback):
 *   currentMode  string       '2d' | '3d'
 *   camera2D     OrthographicCamera
 *   camera3D     PerspectiveCamera
 *   controls3D   OrbitControls   (for .target)
 *   pan2D        { x, z }        2D camera pan offset
 *
 * Exposes:
 *   initNorthPoint2D(getState)   call once after body HTML is in the DOM
 *   updateNorthRotation()        call every animation frame
 *   toggleNorthPoint()           show / hide
 *   resetNorthPos()              move to default corner position
 *   setNorthPoint2DVisible(bool) show or hide without toggling
 */

import * as THREE from 'three';

// ── Constants ────────────────────────────────────────────────
const NP_KEY        = 'gprtool-np2d-state'; // { right, bottom, w, visible }
const NP_BASE_W     = 77;
const NP_BASE_H     = 86;
const NP_MARGIN     = 16;
const DRAG_THRESHOLD = 5;
const MIN_W         = 38;   // 50% of base
const MAX_W         = 231;  // 300% of base

// ── Module state ─────────────────────────────────────────────
let npEl, npRotEl, npCtxEl, npVP;
let npW = NP_BASE_W;  // current width in px; height derived from aspect ratio
let getState;         // () => { currentMode, camera2D, camera3D, controls3D, pan2D }

let isDragging      = false;
let dragPending     = false;
let dragStartClient = { x: 0, y: 0 };
let dragOffset      = { x: 0, y: 0 };

let isResizing   = false;
let resizeHandle = null;
let resizeStart  = { w: NP_BASE_W, anchor: { x: 0, y: 0 } };

const _npO = new THREE.Vector3();
const _npN = new THREE.Vector3();

// ── Helpers ──────────────────────────────────────────────────

function heightFromWidth(w) {
  return Math.round(w * (NP_BASE_H / NP_BASE_W));
}

function applySize(w) {
  npW = Math.max(MIN_W, Math.min(MAX_W, w));
  npEl.style.width  = npW + 'px';
  npEl.style.height = heightFromWidth(npW) + 'px';
}

function applyPos(right, bottom) {
  const vw = npVP.clientWidth;
  const vh = npVP.clientHeight;
  right  = Math.max(0, Math.min(vw - npW,              right));
  bottom = Math.max(0, Math.min(vh - heightFromWidth(npW), bottom));
  npEl.style.right  = right  + 'px';
  npEl.style.bottom = bottom + 'px';
  npEl.style.left   = '';
  npEl.style.top    = '';
  saveState();
}

function saveState() {
  try {
    const right   = parseFloat(npEl.style.right)  || NP_MARGIN;
    const bottom  = parseFloat(npEl.style.bottom) || NP_MARGIN;
    const visible = npEl.style.display !== 'none';
    localStorage.setItem(NP_KEY, JSON.stringify({ right, bottom, w: npW, visible }));
  } catch {}
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(NP_KEY));
    if (saved) {
      if (saved.w)                      applySize(saved.w);
      if (saved.visible === false)      npEl.style.display = 'none';
      if (saved.right !== undefined)    applyPos(saved.right, saved.bottom);
      else                              resetPosInternal();
    } else {
      resetPosInternal();
    }
  } catch {
    resetPosInternal();
  }
}

function resetPosInternal() {
  npEl.style.right  = NP_MARGIN + 'px';
  npEl.style.bottom = NP_MARGIN + 'px';
  npEl.style.left   = '';
  npEl.style.top    = '';
  saveState();
}

// ── Public API ───────────────────────────────────────────────

export function toggleNorthPoint() {
  if (!npEl) return;
  const hidden = npEl.style.display === 'none';
  npEl.style.display = hidden ? '' : 'none';
  saveState();
}

export function setNorthPoint2DVisible(visible) {
  if (!npEl) return;
  npEl.style.display = visible ? '' : 'none';
}

export function resetNorthPos() {
  if (!npEl) return;
  resetPosInternal();
}

export function updateNorthRotation() {
  if (!npRotEl || !npEl || npEl.style.display === 'none') return;
  const { currentMode, camera2D, camera3D, controls3D, pan2D } = getState();
  const cam    = currentMode === '3d' ? camera3D : camera2D;
  const target = currentMode === '3d'
    ? controls3D.target
    : new THREE.Vector3(pan2D.x, 0, pan2D.z);
  _npO.copy(target).project(cam);
  _npN.copy(target).add(new THREE.Vector3(0, 0, -500)).project(cam);
  const deg = Math.atan2(_npN.x - _npO.x, _npN.y - _npO.y) * 180 / Math.PI;
  npRotEl.style.transform = `rotate(${deg}deg)`;
}

export function initNorthPoint2D(getStateCallback) {
  getState = getStateCallback;
  npEl    = document.getElementById('np-container');
  npRotEl = document.getElementById('np-rotator');
  npCtxEl = document.getElementById('np-ctx-menu');
  npVP    = document.getElementById('viewport');

  if (!npEl || !npRotEl || !npVP) {
    console.warn('north-point-2d: required DOM elements not found');
    return;
  }

  applySize(NP_BASE_W);
  restoreState();

  // Click to select / deselect (shows resize handles)
  npEl.addEventListener('click', e => {
    if (e.target.classList.contains('resize-handle')) return;
    npEl.classList.toggle('np-selected');
  });
  document.addEventListener('click', e => {
    if (!npEl.contains(e.target)) npEl.classList.remove('np-selected');
  });

  // Resize handles
  npEl.querySelectorAll('.resize-handle').forEach(h =>
    h.addEventListener('pointerdown', onResizeDown));

  // Drag
  npEl.addEventListener('pointerdown', onDragDown);

  // Global move / up
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup',   onPointerUp);

  // Context menu
  npEl.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    if (npCtxEl) {
      npCtxEl.style.left    = e.clientX + 'px';
      npCtxEl.style.top     = e.clientY + 'px';
      npCtxEl.style.display = 'block';
    }
  });
  document.addEventListener('click', e => {
    if (npCtxEl && !npCtxEl.contains(e.target)) npCtxEl.style.display = 'none';
  });
  document.getElementById('np-ctx-reset')?.addEventListener('click', () => {
    resetNorthPos();
    if (npCtxEl) npCtxEl.style.display = 'none';
  });
  document.getElementById('np-ctx-hide')?.addEventListener('click', () => {
    toggleNorthPoint();
    if (npCtxEl) npCtxEl.style.display = 'none';
  });
}

// ── Resize ───────────────────────────────────────────────────

function onResizeDown(e) {
  e.preventDefault();
  e.stopPropagation();
  isResizing   = true;
  resizeHandle = e.target.dataset.handle;
  resizeStart.w = npW;

  // offsetLeft/offsetTop: layout coordinates, unaffected by child rotation
  const L = npEl.offsetLeft;
  const T = npEl.offsetTop;
  const R = L + npW;
  const B = T + heightFromWidth(npW);

  switch (resizeHandle) {
    case 'se': resizeStart.anchor = { x: L, y: T }; break; // drag se → anchor nw
    case 'nw': resizeStart.anchor = { x: R, y: B }; break; // drag nw → anchor se
    case 'ne': resizeStart.anchor = { x: L, y: B }; break; // drag ne → anchor sw
    case 'sw': resizeStart.anchor = { x: R, y: T }; break; // drag sw → anchor ne
  }

  npEl.classList.add('np-resizing');
  npEl.setPointerCapture(e.pointerId);
}

function handleResize(e) {
  if (!isResizing) return;

  // Mouse in viewport layout coords
  const vpRect = npVP.getBoundingClientRect();
  const mouseX = e.clientX - vpRect.left;
  const mouseY = e.clientY - vpRect.top;
  const { x: ax, y: ay } = resizeStart.anchor;

  let dW, dH;
  switch (resizeHandle) {
    case 'se': dW = mouseX - ax; dH = mouseY - ay; break;
    case 'nw': dW = ax - mouseX; dH = ay - mouseY; break;
    case 'ne': dW = mouseX - ax; dH = ay - mouseY; break;
    case 'sw': dW = ax - mouseX; dH = mouseY - ay; break;
  }

  // Derive width from average of both axes (preserves aspect ratio)
  const newW = Math.round((dW + dH * (NP_BASE_W / NP_BASE_H)) / 2);
  applySize(newW);

  // Reposition so anchor corner stays fixed
  const newH = heightFromWidth(npW);
  let newLeft, newTop;
  switch (resizeHandle) {
    case 'se': newLeft = ax;        newTop = ay;        break;
    case 'nw': newLeft = ax - npW;  newTop = ay - newH; break;
    case 'ne': newLeft = ax;        newTop = ay - newH; break;
    case 'sw': newLeft = ax - npW;  newTop = ay;        break;
  }
  npEl.style.left   = newLeft + 'px';
  npEl.style.top    = newTop  + 'px';
  npEl.style.right  = '';
  npEl.style.bottom = '';
}

function stopResize() {
  if (!isResizing) return;
  isResizing   = false;
  resizeHandle = null;
  npEl.classList.remove('np-resizing');
  // Convert left/top back to right/bottom and persist
  const vw     = npVP.clientWidth;
  const vh     = npVP.clientHeight;
  const right  = vw - npEl.offsetLeft - npW;
  const bottom = vh - npEl.offsetTop  - heightFromWidth(npW);
  applyPos(right, bottom);
}

// ── Drag ─────────────────────────────────────────────────────

function onDragDown(e) {
  if (e.target.classList.contains('resize-handle') || isResizing) return;
  if (e.button !== 0) return;

  dragPending     = true;
  dragStartClient = { x: e.clientX, y: e.clientY };

  // Offset = distance from mouse to element's right/bottom edge (layout coords)
  const vr     = npVP.getBoundingClientRect();
  const mouseX = e.clientX - vr.left;
  const mouseY = e.clientY - vr.top;
  dragOffset = {
    x: (npEl.offsetLeft + npW)                  - mouseX,
    y: (npEl.offsetTop  + heightFromWidth(npW)) - mouseY,
  };

  npEl.setPointerCapture(e.pointerId);
  e.stopPropagation();
}

function handleDrag(e) {
  if (!dragPending && !isDragging) return;
  if (!isDragging) {
    const dist = Math.hypot(e.clientX - dragStartClient.x, e.clientY - dragStartClient.y);
    if (dist < DRAG_THRESHOLD) return;
    isDragging        = true;
    npEl.style.cursor = 'grabbing';
  }
  const vr     = npVP.getBoundingClientRect();
  const vw     = npVP.clientWidth;
  const vh     = npVP.clientHeight;
  const mouseX = e.clientX - vr.left;
  const mouseY = e.clientY - vr.top;
  applyPos(vw - (mouseX + dragOffset.x), vh - (mouseY + dragOffset.y));
}

function stopDrag() {
  dragPending = false;
  if (!isDragging) return;
  isDragging        = false;
  npEl.style.cursor = 'grab';
}

// ── Combined pointer handlers ─────────────────────────────────

function onPointerMove(e) {
  handleResize(e);
  handleDrag(e);
}

function onPointerUp() {
  stopResize();
  stopDrag();
}
