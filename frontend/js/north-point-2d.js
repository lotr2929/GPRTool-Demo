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
const NP_KEY         = 'gprtool-np2d-state'; // { right, bottom, w, visible, dn }
const NP_BASE_W      = 77;
const NP_BASE_H      = 86;
const NP_MARGIN      = 16;
const DRAG_THRESHOLD = 5;
const MIN_W          = 38;   // 50% of base
const MAX_W          = 231;  // 300% of base

// SVG geometry constants (viewBox 0 0 64 72)
const SVG_CX = 32;  // circle centre X
const SVG_CY = 40;  // circle centre Y

// ── Module state ─────────────────────────────────────────────
let npEl, npRotEl, npCtxEl, npVP;
let npW = NP_BASE_W;
let getState;

let designNorthDeg = null;  // null = not set; decimal degrees otherwise (+ve = E/clockwise)
let dnGroupEl = null;
let dnLabelEl = null;

let isDragging      = false;
let dragPending     = false;
let dragStartClient = { x: 0, y: 0 };
let dragOffset      = { x: 0, y: 0 };

let isResizing   = false;
let resizeHandle = null;
let resizeStart  = { w: NP_BASE_W, anchor: { x: 0, y: 0 } };

const _npO = new THREE.Vector3();
const _npN = new THREE.Vector3();

// ── Angle parsing ─────────────────────────────────────────────
// Accepts: 7  -7  +7  7W  7E  7.4  7.4W  7°22'  7°22'W  7d22'E
// Returns decimal degrees (+ve = east/clockwise) or null on error

function parseNorthAngle(str) {
  if (!str) return null;
  str = str.trim();

  // Determine directional sign from suffix or prefix
  let sign = 1;
  let s    = str.toUpperCase();

  if (s.endsWith('W'))      { sign = -1; s = s.slice(0, -1).trim(); }
  else if (s.endsWith('E')) { sign =  1; s = s.slice(0, -1).trim(); }

  if (s.startsWith('-'))      { sign = -1; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) { sign =  1; s = s.slice(1).trim(); }

  // deg°min' or deg d min — e.g. "7°22'" or "7d22"
  const dmMatch = s.match(/^(\d+(?:\.\d+)?)[°d]\s*(\d+(?:\.\d+)?)'?\s*$/);
  if (dmMatch) {
    const d = parseFloat(dmMatch[1]);
    const m = parseFloat(dmMatch[2]);
    if (!isNaN(d) && !isNaN(m) && m < 60) return sign * (d + m / 60);
    return null;
  }

  // Plain number (integer or decimal)
  const num = parseFloat(s);
  if (!isNaN(num) && s.match(/^[\d.]+$/)) return sign * num;

  return null;
}

// ── Angle formatting ──────────────────────────────────────────
// Returns a compact display string, e.g. "7°22' W" or "7° E" or "0°"

function formatNorthAngle(deg) {
  if (deg === 0 || deg === null) return '0°';
  const abs     = Math.abs(deg);
  const dir     = deg > 0 ? 'E' : 'W';
  const wholeDeg = Math.floor(abs);
  const minFrac  = (abs - wholeDeg) * 60;
  const wholeMin = Math.round(minFrac);

  if (wholeMin === 0)  return `${wholeDeg}° ${dir}`;
  if (wholeMin === 60) return `${wholeDeg + 1}° ${dir}`;
  return `${wholeDeg}°${wholeMin}' ${dir}`;
}

// ── Size / position helpers ───────────────────────────────────

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
  right  = Math.max(0, Math.min(vw - npW,               right));
  bottom = Math.max(0, Math.min(vh - heightFromWidth(npW), bottom));
  npEl.style.right  = right  + 'px';
  npEl.style.bottom = bottom + 'px';
  npEl.style.left   = '';
  npEl.style.top    = '';
  saveState();
}

// ── Persistence ───────────────────────────────────────────────

function saveState() {
  try {
    const right   = parseFloat(npEl.style.right)  || NP_MARGIN;
    const bottom  = parseFloat(npEl.style.bottom) || NP_MARGIN;
    const visible = npEl.style.display !== 'none';
    localStorage.setItem(NP_KEY, JSON.stringify({
      right, bottom, w: npW, visible,
      dn: designNorthDeg,
    }));
  } catch {}
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(NP_KEY));
    if (saved) {
      if (saved.w)               applySize(saved.w);
      if (saved.visible === false) npEl.style.display = 'none';
      if (saved.right !== undefined) applyPos(saved.right, saved.bottom);
      else                           resetPosInternal();
      if (saved.dn !== undefined && saved.dn !== null) applyDesignNorth(saved.dn);
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

// ── Design North ──────────────────────────────────────────────

function applyDesignNorth(deg) {
  designNorthDeg = deg;

  if (dnGroupEl && dnLabelEl) {
    if (deg !== null) {
      dnGroupEl.style.display = '';
      dnGroupEl.setAttribute('transform', `rotate(${deg}, ${SVG_CX}, ${SVG_CY})`);
      dnLabelEl.textContent = formatNorthAngle(deg);
      // Label sits just outside the circle at the arrow tip (y=15, circle edge y=18)
      // W (negative) → right-aligned, anchor left of centre  → text flows left  (away from N)
      // E (positive) → left-aligned,  anchor right of centre → text flows right (away from N)
      const isWest = deg < 0;
      const lx = isWest ? SVG_CX - 2 : SVG_CX + 2;
      const ly = SVG_CY - 26;  // just outside circle edge
      dnLabelEl.setAttribute('x', lx);
      dnLabelEl.setAttribute('y', ly);
      dnLabelEl.setAttribute('text-anchor', isWest ? 'end' : 'start');
      // Counter-rotate around label anchor so it stays horizontal on screen
      dnLabelEl.setAttribute('transform', `rotate(${-deg}, ${lx}, ${ly})`);
    } else {
      dnGroupEl.style.display = 'none';
    }
  }

  // Show / hide "Clear Design North" menu item
  const clearItem = document.getElementById('np-ctx-clear-dn');
  if (clearItem) clearItem.style.display = deg !== null ? '' : 'none';

  saveState();
}

// ── Design North input field ──────────────────────────────────

function showDNInput() {
  // Create on first use
  let inp = document.getElementById('np-dn-input');
  if (!inp) {
    inp = document.createElement('div');
    inp.id = 'np-dn-input';
    inp.innerHTML = `
      <div class="np-dn-title">Design North</div>
      <input type="text" id="np-dn-field" placeholder="e.g. 7, 7.4, 7°22', 7W" autocomplete="off" spellcheck="false">
      <div class="np-dn-hint">+ or E = east &nbsp;|&nbsp; - or W = west</div>
    `;
    document.body.appendChild(inp);

    document.getElementById('np-dn-field').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const val = e.target.value.trim();
        const deg = parseNorthAngle(val);
        if (deg !== null) {
          applyDesignNorth(deg);
          hideDNInput();
        } else {
          // Flash invalid state
          e.target.classList.add('np-dn-invalid');
          setTimeout(() => e.target.classList.remove('np-dn-invalid'), 600);
        }
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        hideDNInput();
        e.stopPropagation();
      }
    });

    document.getElementById('np-dn-field').addEventListener('input', e => {
      e.target.classList.remove('np-dn-invalid');
    });
  }

  // Position to the left of the NP container
  const rect = npEl.getBoundingClientRect();
  inp.style.display = 'block';
  inp.style.right   = (window.innerWidth  - rect.left + 8) + 'px';
  inp.style.bottom  = (window.innerHeight - rect.bottom)   + 'px';

  // Pre-fill with current value if already set
  const field = document.getElementById('np-dn-field');
  field.value = designNorthDeg !== null ? formatNorthAngle(designNorthDeg) : '';
  field.classList.remove('np-dn-invalid');
  requestAnimationFrame(() => field.focus());

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', onClickOutsideDNInput);
  }, 50);
}

function hideDNInput() {
  const inp = document.getElementById('np-dn-input');
  if (inp) inp.style.display = 'none';
  document.removeEventListener('click', onClickOutsideDNInput);
}

function onClickOutsideDNInput(e) {
  const inp = document.getElementById('np-dn-input');
  if (inp && !inp.contains(e.target)) hideDNInput();
}

// ── SVG injection ─────────────────────────────────────────────
// Arrow geometry (local coords, pointing straight up before group rotation):
//   Circle centre: (32, 40), radius 22 — edge at y=18
//   Arrowhead tip:    y = 21  (just inside circle edge)
//   Arrowhead base:   y = 28
//   Shaft:            y = 28 → y = 37 (stops before centre clutter)

function injectDNGroup(svg) {
  svg.setAttribute('overflow', 'visible');

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'np-dn-group';
  g.style.display = 'none';

  // Arrow shaft
  const shaft = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  shaft.setAttribute('x1', SVG_CX);
  shaft.setAttribute('y1', '28');
  shaft.setAttribute('x2', SVG_CX);
  shaft.setAttribute('y2', '37');
  shaft.setAttribute('stroke', '#4a8a4a');
  shaft.setAttribute('stroke-width', '1.5');

  // Arrowhead — small filled triangle
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  head.setAttribute('points', '32,21 29,28 35,28');
  head.setAttribute('fill', '#4a8a4a');

  // Label — outside circle at arrow tip; position/anchor set in applyDesignNorth()
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.id = 'np-dn-label';
  label.setAttribute('font-size', '8');
  label.setAttribute('font-family', 'Outfit, sans-serif');
  label.setAttribute('fill', '#4a8a4a');

  g.appendChild(shaft);
  g.appendChild(head);
  g.appendChild(label);
  svg.appendChild(g);

  dnGroupEl = g;
  dnLabelEl = label;
}

// ── Public API ────────────────────────────────────────────────

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

  // Inject design north SVG group
  const svg = npRotEl.querySelector('svg');
  if (svg) injectDNGroup(svg);

  applySize(NP_BASE_W);
  restoreState();

  // Selection (shows resize handles)
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

  // Global pointer handlers
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
  document.getElementById('np-ctx-set-dn')?.addEventListener('click', () => {
    if (npCtxEl) npCtxEl.style.display = 'none';
    showDNInput();
  });
  document.getElementById('np-ctx-clear-dn')?.addEventListener('click', () => {
    applyDesignNorth(null);
    if (npCtxEl) npCtxEl.style.display = 'none';
  });
}

// ── Resize ────────────────────────────────────────────────────

function onResizeDown(e) {
  e.preventDefault();
  e.stopPropagation();
  isResizing   = true;
  resizeHandle = e.target.dataset.handle;
  resizeStart.w = npW;

  const L = npEl.offsetLeft;
  const T = npEl.offsetTop;
  const R = L + npW;
  const B = T + heightFromWidth(npW);

  switch (resizeHandle) {
    case 'se': resizeStart.anchor = { x: L, y: T }; break;
    case 'nw': resizeStart.anchor = { x: R, y: B }; break;
    case 'ne': resizeStart.anchor = { x: L, y: B }; break;
    case 'sw': resizeStart.anchor = { x: R, y: T }; break;
  }

  npEl.classList.add('np-resizing');
  npEl.setPointerCapture(e.pointerId);
}

function handleResize(e) {
  if (!isResizing) return;

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

  const newW = Math.round((dW + dH * (NP_BASE_W / NP_BASE_H)) / 2);
  applySize(newW);

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
  const vw     = npVP.clientWidth;
  const vh     = npVP.clientHeight;
  const right  = vw - npEl.offsetLeft - npW;
  const bottom = vh - npEl.offsetTop  - heightFromWidth(npW);
  applyPos(right, bottom);
}

// ── Drag ──────────────────────────────────────────────────────

function onDragDown(e) {
  if (e.target.classList.contains('resize-handle') || isResizing) return;
  if (e.button !== 0) return;

  dragPending     = true;
  dragStartClient = { x: e.clientX, y: e.clientY };

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
