# Session Log -- GPRTool
_Written by Mobius_Coder. Read by Claude Desktop via MCP._
_Entries are newest-last. Vote results not recorded here -- see Ask: Scores._

---

## Mon, 6 Apr 2026, 4:15 pm
**Q:** You are a patient coding teacher. Explain clearly in plain English. Walk through what each part does and why. British English.

File: app/js/north-point-2d.js

```
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

let designNorthAngle = 0;  // grid orientation — changed by "Set Design North"
let globalNorthAngle = 0;  // TN offset from world -Z — changed by "Rotate N Point"
let dnGroupEl  = null;  // green DN arrow (injected)
let dnLabelEl  = null;  // angle label
let tnNeedleEl = null;  // TN needle group (from SVG)

let isDragging      = false;
let dragPending     = false;
let dragStartClient = { x: 0, y: 0 };
let dragOffset      = { x: 0, y: 0 };

let rotateMode      = false;
let isRotating      = false;
let rotateStartAngle = 0;
let rotateStartDN    = 0;

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
      dn: designNorthAngle,
      tn: globalNorthAngle,
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
      // Both DN and TN reset to 0 on load — N points up, grid vertical/horizontal
      // Will be restored from .gpr session file when session save is implemented
      applyDesignNorth(0);
      applyGlobalNorth(0);
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
  designNorthAngle = deg;

  if (dnGroupEl && dnLabelEl) {
    // Label shows tilt of DN from TN = designNorthAngle
    dnLabelEl.textContent = formatNorthAngle(designNorthAngle);
  }

  // Show / hide "Clear Design North" menu item
  const clearItem = document.getElementById('np-ctx-clear-dn');
  if (clearItem) clearItem.style.display = deg !== null && designNorthAngle !== 0 ? '' : 'none';

  saveState();
}

function applyGlobalNorth(deg) {
  globalNorthAngle = deg ?? 0;
  // Label shows tilt of DN from TN = designNorthAngle
  if (dnLabelEl) dnLabelEl.textContent = formatNorthAngle(designNorthAngle);
  saveState();
}

// ── Design North input field ──────────────────────────────────

function angleFromNPCenter(clientX, clientY) {
  const rect = npEl.getBoundingClientRect();
  const cx   = rect.left + rect.width  * 0.5;
  const cy   = rect.top  + rect.height * 0.555;
  return Math.atan2(clientX - cx, cy - clientY) * 180 / Math.PI;
}

function enterRotateMode() {
  rotateMode = true;
  npEl.style.cursor = 'crosshair';
  npEl.classList.add('np-rotating');
}

function exitRotateMode() {
  rotateMode = false;
  isRotating = false;
  npEl.style.cursor = 'grab';
  npEl.classList.remove('np-rotating');
}

function showDNInput(autoFocus = true) {
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
  field.value = designNorthAngle !== 0 ? formatNorthAngle(designNorthAngle) : '';
  field.classList.remove('np-dn-invalid');
  if (autoFocus) requestAnimationFrame(() => field.focus());

  // Intercept Escape + Enter at capture phase so global handlers don't fire
  document.removeEventListener('keydown', onDNKeyCapture, true);
  document.addEventListener('keydown', onDNKeyCapture, true);

  // Close on outside click — remove first to prevent duplicate listeners
  document.removeEventListener('click', onClickOutsideDNInput);
  setTimeout(() => {
    document.addEventListener('click', onClickOutsideDNInput);
  }, 50);
}

function hideDNInput() {
  const inp = document.getElementById('np-dn-input');
  if (inp) inp.style.display = 'none';
  document.removeEventListener('click', onClickOutsideDNInput);
  document.removeEventListener('keydown', onDNKeyCapture, true);
  exitRotateMode();
}

function onDNKeyCapture(e) {
  const inp = document.getElementById('np-dn-input');
  if (!inp || inp.style.display === 'none') return;

  if (e.key === 'Escape') {
    e.stopPropagation();
    e.preventDefault();
    hideDNInput();
  }

  if (e.key === 'Enter') {
    e.stopPropagation();
    e.preventDefault();
    const field = document.getElementById('np-dn-field');
    if (!field) return;
    const val = field.value.trim();
    const deg = parseNorthAngle(val);
    if (deg !== null) {
      applyDesignNorth(deg);
      hideDNInput();
    } else {
      field.classList.add('np-dn-invalid');
      setTimeout(() => field.classList.remove('np-dn-invalid'), 600);
    }
  }
}

function onClickOutsideDNInput(e) {
  const inp = document.getElementById('np-dn-input');
  if (inp && !inp.contains(e.target) && !npEl.contains(e.target)) hideDNInput();
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

  // Shaft — full diameter, top circle edge (y=18) to bottom circle edge (y=62)
  const shaft = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  shaft.setAttribute('x1', SVG_CX);
  shaft.setAttribute('y1', '18');
  shaft.setAttribute('x2', SVG_CX);
  shaft.setAttribute('y2', '62');
  shaft.setAttribute('stroke', '#4a8a4a');
  shaft.setAttribute('stroke-width', '0.75');

  // Dot — slightly before the top edge (cy=22)
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('cx', SVG_CX);
  head.setAttribute('cy', '24');
  head.setAttribute('r', '3');
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

  let camDeg;
  if (currentMode === '3d') {
    // Horizontal azimuth only — ignore camera elevation
    // Vector from camera to target, flattened to XZ plane
    const dx = controls3D.target.x - camera3D.position.x;
    const dz = controls3D.target.z - camera3D.position.z;
    // atan2(-dx, dz): camera looking north (dz<0) → 0°, looking east (dx>0) → -90°
    camDeg = Math.atan2(-dx, dz) * 180 / Math.PI;
  } else {
    const cam    = camera2D;
    const target = new THREE.Vector3(pan2D.x, 0, pan2D.z);
    _npO.copy(target).project(cam);
    _npN.copy(target).add(new THREE.Vector3(0, 0, -500)).project(cam);
    camDeg = Math.atan2(_npN.x - _npO.x, _npN.y - _npO.y) * 180 / Math.PI;
  }

  // Compass housing matches grid rotation — same angle as gridHelper.rotation.y
  // No camera involved — compass is fixed to design world, not camera view
  const iconRot = designNorthAngle;
  npRotEl.style.transform = `rotate(${iconRot}deg)`;

  // TN needle points True North within housing
  // needleLocal = globalNorthAngle - designNorthAngle
  if (tnNeedleEl) {
    const needleLocal = globalNorthAngle - designNorthAngle;
    tnNeedleEl.setAttribute('transform', `rotate(${needleLocal}, ${SVG_CX}, ${SVG_CY})`);
  }

  // Green DN arrow stays fixed at housing top (no extra rotation needed)
  // Show only when DN ≠ TN
  if (dnGroupEl && dnLabelEl) {
    dnGroupEl.setAttribute('transform', `rotate(0, ${SVG_CX}, ${SVG_CY})`);
    dnGroupEl.style.display = designNorthAngle !== globalNorthAngle ? '' : 'none';

    // Shift label sideways if TN arrow is near compass top (where D label sits)
    const LABEL_Y   = 14;
    const CLASH_DEG = 65;
    const SIDE_X    = 10;

    // Clash is between TN needle and DN label (at top) — use needle local angle
    const needleLocalForClash = globalNorthAngle - designNorthAngle;
    let normTN = ((needleLocalForClash % 360) + 360) % 360;
    if (normTN > 180) normTN -= 360;

    if (Math.abs(normTN) < CLASH_DEG) {
      if (normTN >= 0) {
        dnLabelEl.setAttribute('x', SVG_CX - SIDE_X);
        dnLabelEl.setAttribute('text-anchor', 'end');
      } else {
        dnLabelEl.setAttribute('x', SVG_CX + SIDE_X);
        dnLabelEl.setAttribute('text-anchor', 'start');
      }
    } else {
      dnLabelEl.setAttribute('x', SVG_CX);
      dnLabelEl.setAttribute('text-anchor', 'middle');
    }
    dnLabelEl.setAttribute('y', LABEL_Y);
  }
}

export function getDesignNorthAngle() { return designNorthAngle; }
export function resetDesignNorth() { applyDesignNorth(0); }

export function setNorthPointMode(mode) {
  // '3d': hide DOM widget — gizmo takes over; '2d': restore per saved preference
  if (!npEl) return;
  if (mode === '3d') {
    npEl.style.display = 'none';
  } else {
    try {
      const saved = JSON.parse(localStorage.getItem(NP_KEY));
      if (saved && saved.visible === false) return; // user explicitly hid it
    } catch {}
    npEl.style.display = '';
  }
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

  // Grab TN needle group and inject DN arrow group
  const svg = npRotEl.querySelector('svg');
  tnNeedleEl = svg ? svg.getElementById('np-tn-needle') : null;
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
  document.getElementById('np-ctx-rotate-np')?.addEventListener('click', () => {
    if (npCtxEl) npCtxEl.style.display = 'none';
    enterRotateMode();
    showDNInput(true);
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

  if (rotateMode) {
    // In rotate mode: drag rotates the icon instead of moving it
    isRotating       = true;
    rotateStartAngle = angleFromNPCenter(e.clientX, e.clientY);
    rotateStartDN    = designNorthAngle;
    npEl.setPointerCapture(e.pointerId);
    e.stopPropagation();
    return;
  }

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
  if (isRotating) {
    const cur   = angleFromNPCenter(e.clientX, e.clientY);
    // Negate: dragging clockwise (E) sets DN east of TN, displayed as positive E
    const newDN = rotateStartDN - (cur - rotateStartAngle);
    applyDesignNorth(newDN);
    const field = document.getElementById('np-dn-field');
    if (field) field.value = formatNorthAngle(newDN);
    return;
  }
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
  if (isRotating) {
    isRotating = false;
    return;
  }
  dragPending = false;
  if (!isDragging) return;
  isDragging        = false;
  npEl.style.cursor = rotateMode ? 'crosshair' : 'grab';
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

```

---

File: app/js/north-point-3d.js

```
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
import { getDesignNorthAngle } from './north-point-2d.js';

// ── Module state ──────────────────────────────────────────────
let getState = null;

const gizmoScene  = new THREE.Scene();
const gizmoCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);

let gizmoCompassMesh = null;
let _gizmoCanvasTex  = null;
let _gizmoCtx        = null;
let _lastDrawnDnDeg  = undefined; // sentinel — forces draw on first frame

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
// Sets #np-dn-group transform to rotate(dnDeg, 32, 40) so the dot
// points Design North — SVG clockwise = world-space clockwise.
function updateGizmoTexture(dnDeg) {
  const svgEl = document.querySelector('#np-rotator svg');
  if (!svgEl) return;

  const clone   = svgEl.cloneNode(true);
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
  requestAnimationFrame(() => updateGizmoTexture(getDesignNorthAngle()));
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

  // Mirror camera3D orientation so icon tilts with camera
  gizmoCamera.quaternion.copy(camera3D.quaternion);
  const bwd = new THREE.Vector3(0, 0, 1).applyQuaternion(gizmoCamera.quaternion);
  gizmoCamera.position.copy(bwd).multiplyScalar(5);

  // Redraw SVG texture only when DN value changes
  const dnDeg = getDesignNorthAngle();
  if (dnDeg !== _lastDrawnDnDeg) {
    updateGizmoTexture(dnDeg);
    _lastDrawnDnDeg = dnDeg;
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

```

I want to work on the NPoint compass.

### GPT-4o
[Error: HTTP 500]

### Mistral Codestral (fallback from Groq Llama 3.3 70B)
# North Point Compass System Analysis

You've shared two files that implement a compass system with two different interfaces:

1. `north-point-2d.js` - A 2D DOM-based compass widget
2. `north-point-3d.js` - A 3D HUD compass gizmo

## Key Components

### 2D Compass Widget (north-point-2d.js)

This creates a draggable, resizable compass widget in the 2D view:

- **Visual Elements**:
  - A compass housing that rotates with the grid
  - A True North needle that points to the world's -Z axis
  - A Design North arrow that shows the offset from True North

- **Features**:
  - Draggable to reposition
  - Resizable with corner handles
  - Context menu for options
  - Design North input field with angle parsing
  - Persistence using localStorage

- **Angle Handling**:
  - Parses angles in various formats (7, 7W, 7.4, 7°22', etc.)
  - Formats angles for display
  - Handles both True North and Design North angles

### 3D Compass Gizmo (north-point-3d.js)

This creates a 3D HUD compass that appears in the 3D view:

- **Visual Elements**:
  - A compass that tilts with the camera view
  - A True North needle that points to the world's -Z axis
  - A Design North arrow that shows the offset from True North

- **Features**:
  - Renders as a 3D overlay using a canvas texture
  - Draggable and resizable
  - Toggles visibility
  - Updates when the Design North angle changes

## How They Work Together

1. The 2D widget provides the interface for setting the Design North angle
2. The 3D gizmo displays the compass in 3D space, showing both True North and Design North
3. Both components share the Design North angle value

## What You Could Work On

1. **Improving Angle Parsing**: Add more angle formats or improve error handling
2. **Visual Enhancements**: Improve the compass appearance or add animations
3. **Feature Expansion**: Add more configuration options or additional compass features
4. **Bug Fixes**: Check for edge cases in dragging/resizing or angle calculations

Would you like to focus on any particular aspect of the compass system?

### Mistral Codestral
# North Point Compass Analysis

I'll explain the 2D and 3D compass systems in this application.

## 2D Compass (north-point-2d.js)

This creates a draggable, resizable compass widget in the bottom-right corner of the viewport.

### Key Features:

1. **Visual Elements**:
   - A compass housing that rotates with the grid orientation
   - A True North needle that points to world -Z axis
   - A Design North arrow that shows the offset from True North

2. **Functionality**:
   - **Dragging**: Click and drag to reposition the compass
   - **Resizing**: Corner handles to resize the compass
   - **Rotation Mode**: Right-click to enter rotation mode where dragging sets the Design North angle
   - **Design North Input**: Text field to enter angle values in various formats

3. **Angle Handling**:
   - Parses angles in formats like: `7`, `-7`, `7W`, `7.4`, `7°22'`, `7°22'W`
   - Formats angles for display as: `7° E`, `7°22' W`, `0°`

4. **Persistence**:
   - Saves position, size, visibility, and angle settings to localStorage
   - Restores these settings on page load

## 3D Compass (north-point-3d.js)

This creates a heads-up display (HUD) compass that appears in 3D mode.

### Key Features:

1. **Visual Elements**:
   - A 3D-rendered compass that mirrors the 2D compass
   - The compass tilts with the camera view
   - The True North needle always points to world -Z axis

2. **Functionality**:
   - **Draggable**: Click and drag to reposition the compass
   - **Resizable**: Corner handles to resize the compass
   - **Toggle Visibility**: Can be shown/hidden via the View menu
   - **Automatic Updates**: Redraws the compass texture when Design North changes

3. **Rendering**:
   - Uses a canvas texture to render the SVG compass
   - Renders in a scissor region to appear as a HUD element
   - Maintains proper orientation relative to the camera

## Integration Points

1. **State Sharing**:
   - Both modules use a `getState` callback to access shared state
   - They communicate through the Design North angle value

2. **Mode Switching**:
   - The 2D compass is hidden in 3D mode
   - The 3D compass is shown in 3D mode

3. **Angle Synchronization**:
   - Changes to Design North in either compass update both
   - The 3D compass automatically redraws when the angle changes

Would you like me to focus on any specific aspect of the compass functionality?

### Mistral Codestral (fallback from Groq Llama 3.3 70B) (fallback from Gemini Lite)
# North Point Compass System Analysis

The North Point compass system consists of two complementary components:

## 1. 2D DOM Compass (north-point-2d.js)
- A draggable, resizable SVG compass widget that appears in 2D mode
- Shows True North (TN) needle and Design North (DN) arrow
- Allows setting design north angle via text input
- Can be dragged, resized, and positioned anywhere on screen
- Persists position and visibility state in localStorage

## 2. 3D HUD Gizmo (north-point-3d.js)
- A 3D compass that appears in the viewport when in 3D mode
- Renders as a 3D plane with the same SVG content as the 2D version
- Tilts with the camera to maintain orientation
- Can be dragged and resized within the viewport
- Shows only when explicitly enabled

## Key Features

1. **Design North vs True North**:
   - True North (TN) points to the world's -Z axis
   - Design North (DN) is an offset from TN that can be set via text input
   - The compass housing rotates with the grid (design north)
   - The TN needle rotates within the housing to show the offset

2. **Angle Parsing and Formatting**:
   - Accepts various angle formats (7, 7W, 7.4, 7°22', etc.)
   - Formats angles for display (e.g., "7°22' W")

3. **Interactive Elements**:
   - Drag to move the compass
   - Resize handles in all four corners
   - Context menu with options
   - Rotate mode for setting design north by dragging

4. **State Management**:
   - Persists position, size, and visibility in localStorage
   - Maintains separate angles for design north and true north

## Technical Implementation

Both components use:
- SVG for compass graphics
- Three.js for 3D rendering
- Canvas for texture generation
- Event listeners for user interaction

The 3D version uses a scissor test to render the compass in a specific viewport area while maintaining the camera's orientation.

Would you like to focus on any particular aspect of the compass system?

### Gemini 2.5 Flash
Right, the NPoint compass it is! We've got two files here:

1.  `app/js/north-point-2d.js`: This handles the traditional 2D compass widget you can drag, resize, and rotate to set the "Design North" angle.
2.  `app/js/north-point-3d.js`: This displays a 3D overlay compass gizmo using Three.js, mirroring the Design North set by the 2D widget.

What specifically would you like to do with the NPoint compass? Are you looking to:

*   **Add a new feature?** (e.g., display True North/Global North in 3D, allow direct manipulation of the 3D gizmo, add more customisation options)
*   **Fix a bug or unexpected behaviour?** (e.g., a dragging issue, a display glitch)
*   **Refactor or improve existing code?** (e.g., make it more performant, readable, or maintainable)
*   **Understand a specific part of the code?** (e.g., how dragging works, how the angles are calculated)

Let me know what you have in mind, and we'll dive in!

---

## Mon, 6 Apr 2026, 4:34 pm
**Q:** You are a patient coding teacher. Explain clearly in plain English. Walk through what each part does and why. British English.

File: app/js/north-point-2d.js

```
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

let designNorthAngle = 0;  // grid orientation — changed by "Set Design North"
let globalNorthAngle = 0;  // TN offset from world -Z — changed by "Rotate N Point"
let dnGroupEl  = null;  // green DN arrow (injected)
let dnLabelEl  = null;  // angle label
let tnNeedleEl = null;  // TN needle group (from SVG)

let isDragging      = false;
let dragPending     = false;
let dragStartClient = { x: 0, y: 0 };
let dragOffset      = { x: 0, y: 0 };

let rotateMode      = false;
let isRotating      = false;
let rotateStartAngle = 0;
let rotateStartDN    = 0;

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
      dn: designNorthAngle,
      tn: globalNorthAngle,
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
      // Both DN and TN reset to 0 on load — N points up, grid vertical/horizontal
      // Will be restored from .gpr session file when session save is implemented
      applyDesignNorth(0);
      applyGlobalNorth(0);
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
  designNorthAngle = deg;

  if (dnGroupEl && dnLabelEl) {
    // Label shows tilt of DN from TN = designNorthAngle
    dnLabelEl.textContent = formatNorthAngle(designNorthAngle);
  }

  // Show / hide "Clear Design North" menu item
  const clearItem = document.getElementById('np-ctx-clear-dn');
  if (clearItem) clearItem.style.display = deg !== null && designNorthAngle !== 0 ? '' : 'none';

  saveState();
}

function applyGlobalNorth(deg) {
  globalNorthAngle = deg ?? 0;
  // Label shows tilt of DN from TN = designNorthAngle
  if (dnLabelEl) dnLabelEl.textContent = formatNorthAngle(designNorthAngle);
  saveState();
}

// ── Design North input field ──────────────────────────────────

function angleFromNPCenter(clientX, clientY) {
  const rect = npEl.getBoundingClientRect();
  const cx   = rect.left + rect.width  * 0.5;
  const cy   = rect.top  + rect.height * 0.555;
  return Math.atan2(clientX - cx, cy - clientY) * 180 / Math.PI;
}

function enterRotateMode() {
  rotateMode = true;
  npEl.style.cursor = 'crosshair';
  npEl.classList.add('np-rotating');
}

function exitRotateMode() {
  rotateMode = false;
  isRotating = false;
  npEl.style.cursor = 'grab';
  npEl.classList.remove('np-rotating');
}

function showDNInput(autoFocus = true) {
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
  field.value = designNorthAngle !== 0 ? formatNorthAngle(designNorthAngle) : '';
  field.classList.remove('np-dn-invalid');
  if (autoFocus) requestAnimationFrame(() => field.focus());

  // Intercept Escape + Enter at capture phase so global handlers don't fire
  document.removeEventListener('keydown', onDNKeyCapture, true);
  document.addEventListener('keydown', onDNKeyCapture, true);

  // Close on outside click — remove first to prevent duplicate listeners
  document.removeEventListener('click', onClickOutsideDNInput);
  setTimeout(() => {
    document.addEventListener('click', onClickOutsideDNInput);
  }, 50);
}

function hideDNInput() {
  const inp = document.getElementById('np-dn-input');
  if (inp) inp.style.display = 'none';
  document.removeEventListener('click', onClickOutsideDNInput);
  document.removeEventListener('keydown', onDNKeyCapture, true);
  exitRotateMode();
}

function onDNKeyCapture(e) {
  const inp = document.getElementById('np-dn-input');
  if (!inp || inp.style.display === 'none') return;

  if (e.key === 'Escape') {
    e.stopPropagation();
    e.preventDefault();
    hideDNInput();
  }

  if (e.key === 'Enter') {
    e.stopPropagation();
    e.preventDefault();
    const field = document.getElementById('np-dn-field');
    if (!field) return;
    const val = field.value.trim();
    const deg = parseNorthAngle(val);
    if (deg !== null) {
      applyDesignNorth(deg);
      hideDNInput();
    } else {
      field.classList.add('np-dn-invalid');
      setTimeout(() => field.classList.remove('np-dn-invalid'), 600);
    }
  }
}

function onClickOutsideDNInput(e) {
  const inp = document.getElementById('np-dn-input');
  if (inp && !inp.contains(e.target) && !npEl.contains(e.target)) hideDNInput();
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

  // Shaft — full diameter, top circle edge (y=18) to bottom circle edge (y=62)
  const shaft = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  shaft.setAttribute('x1', SVG_CX);
  shaft.setAttribute('y1', '18');
  shaft.setAttribute('x2', SVG_CX);
  shaft.setAttribute('y2', '62');
  shaft.setAttribute('stroke', '#4a8a4a');
  shaft.setAttribute('stroke-width', '0.75');

  // Dot — slightly before the top edge (cy=22)
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('cx', SVG_CX);
  head.setAttribute('cy', '24');
  head.setAttribute('r', '3');
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

  let camDeg;
  if (currentMode === '3d') {
    // Horizontal azimuth only — ignore camera elevation
    // Vector from camera to target, flattened to XZ plane
    const dx = controls3D.target.x - camera3D.position.x;
    const dz = controls3D.target.z - camera3D.position.z;
    // atan2(-dx, dz): camera looking north (dz<0) → 0°, looking east (dx>0) → -90°
    camDeg = Math.atan2(-dx, dz) * 180 / Math.PI;
  } else {
    const cam    = camera2D;
    const target = new THREE.Vector3(pan2D.x, 0, pan2D.z);
    _npO.copy(target).project(cam);
    _npN.copy(target).add(new THREE.Vector3(0, 0, -500)).project(cam);
    camDeg = Math.atan2(_npN.x - _npO.x, _npN.y - _npO.y) * 180 / Math.PI;
  }

  // Compass housing matches grid rotation — same angle as gridHelper.rotation.y
  // No camera involved — compass is fixed to design world, not camera view
  const iconRot = designNorthAngle;
  npRotEl.style.transform = `rotate(${iconRot}deg)`;

  // TN needle points True North within housing
  // needleLocal = globalNorthAngle - designNorthAngle
  if (tnNeedleEl) {
    const needleLocal = globalNorthAngle - designNorthAngle;
    tnNeedleEl.setAttribute('transform', `rotate(${needleLocal}, ${SVG_CX}, ${SVG_CY})`);
  }

  // Green DN arrow stays fixed at housing top (no extra rotation needed)
  // Show only when DN ≠ TN
  if (dnGroupEl && dnLabelEl) {
    dnGroupEl.setAttribute('transform', `rotate(0, ${SVG_CX}, ${SVG_CY})`);
    dnGroupEl.style.display = designNorthAngle !== globalNorthAngle ? '' : 'none';

    // Shift label sideways if TN arrow is near compass top (where D label sits)
    const LABEL_Y   = 14;
    const CLASH_DEG = 65;
    const SIDE_X    = 10;

    // Clash is between TN needle and DN label (at top) — use needle local angle
    const needleLocalForClash = globalNorthAngle - designNorthAngle;
    let normTN = ((needleLocalForClash % 360) + 360) % 360;
    if (normTN > 180) normTN -= 360;

    if (Math.abs(normTN) < CLASH_DEG) {
      if (normTN >= 0) {
        dnLabelEl.setAttribute('x', SVG_CX - SIDE_X);
        dnLabelEl.setAttribute('text-anchor', 'end');
      } else {
        dnLabelEl.setAttribute('x', SVG_CX + SIDE_X);
        dnLabelEl.setAttribute('text-anchor', 'start');
      }
    } else {
      dnLabelEl.setAttribute('x', SVG_CX);
      dnLabelEl.setAttribute('text-anchor', 'middle');
    }
    dnLabelEl.setAttribute('y', LABEL_Y);
  }
}

export function getDesignNorthAngle() { return designNorthAngle; }
export function resetDesignNorth() { applyDesignNorth(0); }

export function setNorthPointMode(mode) {
  // '3d': hide DOM widget — gizmo takes over; '2d': restore per saved preference
  if (!npEl) return;
  if (mode === '3d') {
    npEl.style.display = 'none';
  } else {
    try {
      const saved = JSON.parse(localStorage.getItem(NP_KEY));
      if (saved && saved.visible === false) return; // user explicitly hid it
    } catch {}
    npEl.style.display = '';
  }
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

  // Grab TN needle group and inject DN arrow group
  const svg = npRotEl.querySelector('svg');
  tnNeedleEl = svg ? svg.getElementById('np-tn-needle') : null;
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
  document.getElementById('np-ctx-rotate-np')?.addEventListener('click', () => {
    if (npCtxEl) npCtxEl.style.display = 'none';
    enterRotateMode();
    showDNInput(true);
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

  if (rotateMode) {
    // In rotate mode: drag rotates the icon instead of moving it
    isRotating       = true;
    rotateStartAngle = angleFromNPCenter(e.clientX, e.clientY);
    rotateStartDN    = designNorthAngle;
    npEl.setPointerCapture(e.pointerId);
    e.stopPropagation();
    return;
  }

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
  if (isRotating) {
    const cur   = angleFromNPCenter(e.clientX, e.clientY);
    // Negate: dragging clockwise (E) sets DN east of TN, displayed as positive E
    const newDN = rotateStartDN - (cur - rotateStartAngle);
    applyDesignNorth(newDN);
    const field = document.getElementById('np-dn-field');
    if (field) field.value = formatNorthAngle(newDN);
    return;
  }
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
  if (isRotating) {
    isRotating = false;
    return;
  }
  dragPending = false;
  if (!isDragging) return;
  isDragging        = false;
  npEl.style.cursor = rotateMode ? 'crosshair' : 'grab';
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

```

---

File: app/js/OrbitControls.js

```
// Simplified, stable OrbitControls
// Boon Ong edition — prevents clipping, flipping, and wild rotations

import {
    EventDispatcher,
    MOUSE,
    Quaternion,
    Spherical,
    TOUCH,
    Vector2,
    Vector3,
} from "three";

class OrbitControls extends EventDispatcher {
    constructor(object, domElement) {
        super();

        this.object = object;
        this.domElement = domElement;
        this.domElement.style.touchAction = "none";

        this.enabled = true;
        this.target = new Vector3(0, 0, 0);

        // Stable distance limits
        this.minDistance = 3;
        this.maxDistance = 20;

        // Vertical orbit limits (prevents flipping)
        this.minPolarAngle = Math.PI * 0.1;
        this.maxPolarAngle = Math.PI * 0.9;

        // Horizontal orbit limits
        this.minAzimuthAngle = -Math.PI * 0.85;
        this.maxAzimuthAngle =  Math.PI * 0.85;

        // Smooth damping
        this.enableDamping = true;
        this.dampingFactor = 0.07;

        // Interaction speeds
        this.enableZoom = true;
        this.enableRotate = true;
        this.enablePan = true;

        this.rotateSpeed = 0.7;
        this.zoomSpeed = 1.0;
        this.panSpeed = 0.6;

        // Internal state
        this.spherical = new Spherical();
        this.sphericalDelta = new Spherical();
        this.scale = 1;
        this.panOffset = new Vector3();

        this.tempVec3 = new Vector3();
        this.tempQuat = new Quaternion().setFromUnitVectors(
            object.up,
            new Vector3(0, 1, 0)
        );
        this.tempQuatInverse = this.tempQuat.clone().invert();

        this.state = "none";
        this.rotateStart = new Vector2();
        this.rotateEnd = new Vector2();
        this.rotateDelta = new Vector2();

        // Event bindings
        this.domElement.addEventListener("pointerdown", (e) =>
            this.onPointerDown(e)
        );
        this.domElement.addEventListener(
            "wheel",
            (e) => this.onMouseWheel(e),
            { passive: false }
        );

        this.update();
    }

    update() {
        const offset = this.tempVec3;

        offset.copy(this.object.position).sub(this.target);
        offset.applyQuaternion(this.tempQuat);

        this.spherical.setFromVector3(offset);
        this.spherical.theta += this.sphericalDelta.theta;
        this.spherical.phi += this.sphericalDelta.phi;

        // Clamp angles
        this.spherical.theta = Math.max(
            this.minAzimuthAngle,
            Math.min(this.maxAzimuthAngle, this.spherical.theta)
        );
        this.spherical.phi = Math.max(
            this.minPolarAngle,
            Math.min(this.maxPolarAngle, this.spherical.phi)
        );

        this.spherical.makeSafe();

        // Clamp zoom
        this.spherical.radius = Math.max(
            this.minDistance,
            Math.min(this.maxDistance, this.spherical.radius * this.scale)
        );

        offset.setFromSpherical(this.spherical);
        offset.applyQuaternion(this.tempQuatInverse);

        this.object.position.copy(this.target).add(offset);
        this.object.lookAt(this.target);

        if (this.enableDamping) {
            this.sphericalDelta.theta *= 0.9;
            this.sphericalDelta.phi *= 0.9;
            this.panOffset.multiplyScalar(0.9);
        } else {
            this.sphericalDelta.set(0, 0, 0);
            this.panOffset.set(0, 0, 0);
        }

        this.scale = 1;
    }

    onPointerDown(event) {
        event.preventDefault();

        if (event.button === 0) {
            this.state = "rotate";
            this.rotateStart.set(event.clientX, event.clientY);
        }

        this.domElement.addEventListener("pointermove", (e) =>
            this.onPointerMove(e)
        );
        this.domElement.addEventListener("pointerup", (e) =>
            this.onPointerUp(e)
        );
    }

    onPointerMove(event) {
        if (this.state === "rotate") {
            this.rotateEnd.set(event.clientX, event.clientY);
            this.rotateDelta
                .subVectors(this.rotateEnd, this.rotateStart)
                .multiplyScalar(this.rotateSpeed * 0.005);

            this.sphericalDelta.theta -= this.rotateDelta.x;
            this.sphericalDelta.phi -= this.rotateDelta.y;

            this.rotateStart.copy(this.rotateEnd);
        }
        this.update();
    }

    onPointerUp() {
        this.state = "none";
        this.domElement.removeEventListener("pointermove", (e) =>
            this.onPointerMove(e)
        );
        this.domElement.removeEventListener("pointerup", (e) =>
            this.onPointerUp(e)
        );
    }

    onMouseWheel(event) {
        event.preventDefault();

        if (event.deltaY > 0) {
            this.scale = 1.1;
        } else if (event.deltaY < 0) {
            this.scale = 1 / 1.1;
        }

        this.update();
    }
}

export { OrbitControls };

```

I'm looking to debug this, Focusing on the 2D compass for the time being, it needs to be:
a)  aligned with the design grid (shown)
b) rotating the NPoint does not rotate the grid nor Design North. Instead DNorth appears when True North is rotated away from the vertical. DNorth will continue to point vertically upwards and the grid continues to be mathematically normal (vertical/horizontal to the screen)

### Groq Llama 3.3 70B
To achieve the desired behavior, you need to modify the `updateNorthRotation` function in `north-point-2d.js` to correctly align the 2D compass with the design grid and to keep the Design North (DNorth) aligned with the vertical when True North (NPoint) is rotated.

Here's the updated `updateNorthRotation` function:

```javascript
export function updateNorthRotation() {
  if (!npRotEl || !npEl || npEl.style.display === 'none') return;
  const { currentMode, camera2D, camera3D, controls3D, pan2D } = getState();

  // Get the rotation of the design grid (i.e., the camera's rotation)
  let gridRotation = 0;
  if (currentMode === '2d') {
    const vector = new THREE.Vector3(0, 0, -1).applyQuaternion(camera2D.quaternion);
    gridRotation = Math.atan2(vector.x, -vector.z) * 180 / Math.PI;
  } else {
    // Calculate the grid rotation based on the 3D camera's rotation
    const dx = controls3D.target.x - camera3D.position.x;
    const dz = controls3D.target.z - camera3D.position.z;
    gridRotation = Math.atan2(-dx, dz) * 180 / Math.PI;
  }

  // Keep the DNorth symbol aligned with the vertical
  npRotEl.style.transform = `rotate(${gridRotation - globalNorthAngle}deg)`;

  // TN needle points True North within housing
  // needleLocal = globalNorthAngle - designNorthAngle
  if (tnNeedleEl) {
    const needleLocal = designNorthAngle;
    tnNeedleEl.setAttribute('transform', `rotate(${needleLocal}, ${SVG_CX}, ${SVG_CY})`);
  }

  // Green DN arrow stays fixed at housing top (no extra rotation needed)
  // Show only when DN ≠ TN
  if (dnGroupEl && dnLabelEl) {
    dnGroupEl.setAttribute('transform', `rotate(0, ${SVG_CX}, ${SVG_CY})`);
    dnGroupEl.style.display = designNorthAngle !== 0 ? '' : 'none';

    // Shift label sideways if TN arrow is near compass top (where D label sits)
    const LABEL_Y   = 14;
    const CLASH_DEG = 65;
    const SIDE_X    = 10;

    // Clash is between TN needle and DN label (at top) — use needle local angle
    const needleLocalForClash = designNorthAngle;
    let normTN = ((needleLocalForClash % 360) + 360) % 360;
    if (normTN > 180) normTN -= 360;

    if (Math.abs(normTN) < CLASH_DEG) {
      if (normTN >= 0) {
        dnLabelEl.setAttribute('x', SVG_CX - SIDE_X);
        dnLabelEl.setAttribute('text-anchor', 'end');
      } else {
        dnLabelEl.setAttribute('x', SVG_CX + SIDE_X);
        dnLabelEl.setAttribute('text-anchor', 'start');
      }
    } else {
      dnLabelEl.setAttribute('x', SVG_CX);
      dnLabelEl.setAttribute('text-anchor', 'middle');
    }
    dnLabelEl.setAttribute('y', LABEL_Y);
  }
}
```

In this updated version, the `updateNorthRotation` function calculates the rotation of the design grid and keeps the DNorth symbol aligned with the vertical by applying the correct rotation to the `npRotEl` element. The TN needle points True North within the housing by applying the rotation based on the `designNorthAngle`. The green DN arrow stays fixed at the housing top and is shown only when DN ≠ TN. The label is shifted sideways if the TN arrow is near the compass top to prevent overlap.

### Mistral Codestral
# Debugging the 2D Compass Widget

Let's focus on the 2D compass widget to ensure it meets these requirements:

## Key Requirements

1. **Alignment with Design Grid**: The compass should align with the design grid (vertical/horizontal)
2. **Independent Rotation**: Rotating the True North (TN) needle should not rotate the grid or Design North (DN)
3. **Design North Indicator**: When TN is rotated away from vertical, DN should appear as a green arrow pointing vertically up

## Current Implementation Analysis

Looking at `north-point-2d.js`, the key functions are:

1. `updateNorthRotation()` - Updates compass rotation based on camera position
2. `applyDesignNorth(deg)` - Sets the design north angle
3. `applyGlobalNorth(deg)` - Sets the true north angle

## Issues Identified

1. **Grid Rotation**: The compass housing rotates with `designNorthAngle`, but this should remain fixed to the grid orientation.

2. **TN Needle Rotation**: The TN needle rotates with `globalNorthAngle - designNorthAngle`, which is correct for showing the offset.

3. **DN Arrow Display**: The DN arrow appears when `designNorthAngle !== globalNorthAngle`, which is correct for showing when TN is offset.

## Required Changes

1. **Fix Grid Alignment**:
   - Remove the rotation of the compass housing (`npRotEl.style.transform`)
   - Keep the housing fixed to the grid orientation

2. **Ensure TN Needle Shows Offset**:
   - The current implementation already shows the offset correctly
   - No changes needed here

3. **DN Arrow Behavior**:
   - The DN arrow should always point vertically up
   - The current implementation already does this

## Implementation Changes

```javascript
// In updateNorthRotation():
export function updateNorthRotation() {
  if (!npRotEl || !npEl || npEl.style.display === 'none') return;
  const { currentMode, camera2D, camera3D, controls3D, pan2D } = getState();

  // Remove housing rotation — keep fixed to grid orientation
  // npRotEl.style.transform = `rotate(${designNorthAngle}deg)`;

  // TN needle points True North within housing
  if (tnNeedleEl) {
    const needleLocal = globalNorthAngle - designNorthAngle;
    tnNeedleEl.setAttribute('transform', `rotate(${needleLocal}, ${SVG_CX}, ${SVG_CY})`);
  }

  // Green DN arrow stays fixed at housing top (no extra rotation needed)
  if (dnGroupEl && dnLabelEl) {
    dnGroupEl.setAttribute('transform', `rotate(0, ${SVG_CX}, ${SVG_CY})`);
    dnGroupEl.style.display = designNorthAngle !== globalNorthAngle ? '' : 'none';
    // ... rest of DN label positioning code ...
  }
}
```

## Testing

1. **Initial State**:
   - TN should point straight up (0°)
   - DN should be hidden
   - Grid should be aligned vertically/horizontally

2. **Rotate TN**:
   - When you rotate TN, it should show the offset from vertical
   - DN should appear as a green arrow pointing straight up
   - Grid should remain fixed to the screen orientation

3. **Set Design North**:
   - When you set DN to a different angle, it should show the offset from TN
   - Grid should remain fixed to the screen orientation

This implementation ensures the compass widget meets all the specified requirements while maintaining the correct visual representation of north offsets.

### Mistral Codestral (fallback from Groq Llama 3.3 70B) (fallback from Gemini Lite)
# Debugging the 2D Compass Widget

Let me analyze the 2D compass functionality and identify the issues with alignment and rotation behavior.

## Key Issues Identified

1. **Grid Alignment Problem**: The compass should align with the design grid, but it's not doing so properly.

2. **Rotation Behavior**: Rotating the True North (TN) needle should not rotate the grid or Design North (DN). Instead, DN should appear when TN is rotated away from vertical.

## Root Causes

1. **Grid Alignment**:
   - The compass rotation is tied to `designNorthAngle` which should represent the grid orientation
   - The `updateNorthRotation()` function applies `designNorthAngle` to the compass housing rotation

2. **Rotation Behavior**:
   - The `globalNorthAngle` represents the rotation of TN relative to the vertical
   - When TN is rotated, the DN arrow should appear to show the offset from TN
   - The current implementation needs to properly calculate and display this offset

## Solution Code

Here are the key fixes needed:

```javascript
// In updateNorthRotation() function:
export function updateNorthRotation() {
  if (!npRotEl || !npEl || npEl.style.display === 'none') return;
  const { currentMode, camera2D, camera3D, controls3D, pan2D } = getState();

  // Compass housing matches grid rotation — same angle as gridHelper.rotation.y
  // No camera involved — compass is fixed to design world, not camera view
  const iconRot = designNorthAngle;
  npRotEl.style.transform = `rotate(${iconRot}deg)`;

  // TN needle points True North within housing
  // needleLocal = globalNorthAngle - designNorthAngle
  if (tnNeedleEl) {
    const needleLocal = globalNorthAngle - designNorthAngle;
    tnNeedleEl.setAttribute('transform', `rotate(${needleLocal}, ${SVG_CX}, ${SVG_CY})`);
  }

  // Green DN arrow stays fixed at housing top (no extra rotation needed)
  // Show only when DN ≠ TN
  if (dnGroupEl && dnLabelEl) {
    // DN arrow should always point up (0 rotation)
    dnGroupEl.setAttribute('transform', `rotate(0, ${SVG_CX}, ${SVG_CY})`);
    dnGroupEl.style.display = designNorthAngle !== globalNorthAngle ? '' : 'none';

    // Label shows the angle between TN and DN
    dnLabelEl.textContent = formatNorthAngle(designNorthAngle - globalNorthAngle);

    // Shift label sideways if TN arrow is near compass top (where D label sits)
    const LABEL_Y   = 14;
    const CLASH_DEG = 65;
    const SIDE_X    = 10;

    // Calculate angle between TN and DN
    const angleDiff = designNorthAngle - globalNorthAngle;
    let normDiff = ((angleDiff % 360) + 360) % 360;
    if (normDiff > 180) normDiff -= 360;

    if (Math.abs(normDiff) < CLASH_DEG) {
      if (normDiff >= 0) {
        dnLabelEl.setAttribute('x', SVG_CX - SIDE_X);
        dnLabelEl.setAttribute('text-anchor', 'end');
      } else {
        dnLabelEl.setAttribute('x', SVG_CX + SIDE_X);
        dnLabelEl.setAttribute('text-anchor', 'start');
      }
    } else {
      dnLabelEl.setAttribute('x', SVG_CX);
      dnLabelEl.setAttribute('text-anchor', 'middle');
    }
    dnLabelEl.setAttribute('y', LABEL_Y);
  }
}
```

## Key Changes Made

1. **Grid Alignment**:
   - The compass housing rotation is now properly tied to `designNorthAngle` which should represent the grid orientation
   - This ensures the compass aligns with the grid as intended

2. **Rotation Behavior**:
   - The TN needle now correctly shows the rotation of True North relative to the compass housing
   - The DN arrow appears when TN is rotated away from vertical
   - The DN label now shows the angle between TN and DN (designNorthAngle - globalNorthAngle)
   - The DN arrow always points up (0 rotation) to maintain its vertical orientation

3. **Visual Clarity**:
   - Improved the label positioning to avoid overlap with the TN needle
   - The DN arrow only appears when there's a meaningful offset between TN and DN

These changes ensure the compass behaves as expected:
- The grid remains mathematically normal (vertical/horizontal to screen)
- The compass housing aligns with the grid
- Design North appears when True North is rotated away from vertical
- The DN arrow maintains its vertical orientation while showing the offset from TN

### GitHub GPT-4o
To address the issues you've raised regarding the 2D Compass and its alignment with the design grid:

### Key Problems
1. **Alignment with the Design Grid:**
   - The 2D compass needs to mirror the grid's rotation, but it appears the alignment with the grid may not be accurate.
2. **Independent Rotation of North Point:**
   - Rotating True North (global north) should not affect the orientation of the design grid (design north), but show a separation (angle difference) between Design North (DN) and True North (TN).

---

### Debug Process

#### Step 1: Familiarise with key variables
- `designNorthAngle`: This is the orientation of the grid in terms of the design north. It represents the structure's alignment relative to True North (TN).
- `globalNorthAngle`: Represents the offset of True North from the world coordinate system.
- `npRotEl.style.transform`: A CSS rotation that represents where the compass widget should align with the grid design (a visual alignment of the compass with the design grid).
- `tnNeedleEl.setAttribute('transform')`: This rotates the True North needle within the compass relative to the compass itself.
- `dnGroupEl`: Represents the "Design North" overlay arrow, which should only appear when `designNorthAngle` differs from `globalNorthAngle`.

### Step 2: Breakdown of `updateNorthRotation`

The `updateNorthRotation()` function ties together the cameras, the Design North/True North angles, and the compass widget itself.
Let’s dissect what it currently aims to achieve and check its logic:

1. **Camera Mode Differences**
   - The function adapts based on the `currentMode` (`2d` or `3d`) to calculate the camera's azimuth or azimuth-like angle:
     ```javascript
     if (currentMode === '3d') {
       const dx = controls3D.target.x - camera3D.position.x;
       const dz = controls3D.target.z - camera3D.position.z;
       camDeg = Math.atan2(-dx, dz) * 180 / Math.PI;
     } else {
       const cam    = camera2D;
       const target = new THREE.Vector3(pan2D.x, 0, pan2D.z);
       _npO.copy(target).project(cam);
       _npN.copy(target).add(new THREE.Vector3(0, 0, -500)).project(cam);
       camDeg = Math.atan2(_npN.x - _npO.x, _npN.y - _npO.y) * 180 / Math.PI;
     }
     ```
   - Issue: The inputs used for `camDeg` may need review for the 2D case:
     - In `3D` mode, the logic is fine because it computes rotation about the Y-axis.
     - In `2D`, `pan2D` is being used to manually simulate the 2D panning offset of the camera. However, the values `camera2D` and `pan2D` may need verification during debugging to ensure they correctly represent the 2D projection.
   - To debug this, add console logs or debugger statements to check the computed values of:
     - `camera2D`, `camera3D`
     - `pan2D`
     - Resulting `camDeg`

2. **Design North Angle for Compass Housing Rotation**
   - Regardless of the camera orientation, the compass should always rotate to show the rotation of the grid:
     ```javascript
     const iconRot = designNorthAngle;
     npRotEl.style.transform = `rotate(${iconRot}deg)`;
     ```
   - The logic here appears sound, but ensure that the `designNorthAngle` is being updated correctly in scenarios where the grid rotation changes. Check the methods that call `updateNorthRotation()` and `applyDesignNorth()`.

3. **True North Needle**
   - True North is indicated by the needle's relative orientation to the design grid rotation:
     ```javascript
     const needleLocal = globalNorthAngle - designNorthAngle;
     tnNeedleEl.setAttribute('transform', `rotate(${needleLocal}, ${SVG_CX}, ${SVG_CY})`);
     ```
   - **Expected Behaviour**: Rotating **True North** should shift the `needleLocal` angle but keep the `designNorthAngle` and grid layout intact.

4. **Design North Indicator**
   - `applyDesignNorth()` ensures that any new `designNorthAngle` value is reflected on the compass:
     ```javascript
     dnLabelEl.textContent = formatNorthAngle(designNorthAngle);
     dnGroupEl.style.display = designNorthAngle !== globalNorthAngle ? '' : 'none';
     ```
   - The Design North arrow is only displayed when Design North no longer matches True North.

---

### Recommendations

#### Debugging `updateNorthRotation()`:
1. Ensure the `pan2D` offset is being updated correctly in the 2D case. Log its values in `updateNorthRotation()`:
   ```javascript
   const { currentMode, camera2D, camera3D, controls3D, pan2D } = getState();
   console.log('currentMode:', currentMode);
   console.log('pan2D:', pan2D);
   ```

2. Verify the design grid’s rotation in 2D mode is actually tied to `designNorthAngle`. You may need to add additional code to your grid rendering module to allow rotation to follow this angle if it currently does not.

---

#### Fixing True North rotation effect on the compass:
1. Ensure the `globalNorthAngle` is updated only when the True North arrow rotates. Verify this only changes by logging the relevant attributes and calculations.
2. Remove any cases where the compass/widget itself visually rotates on True North updates.
3. Update the value of `tnNeedleEl` rotation **alone** to reflect the True North rotation. 

---

#### Verification Checklist:
- **Grid Aligns with Compass Housing**: Check if setting a new `Design North (DN)` correctly rotates both the compass widget and the grid to align. The camera and compass rotations should match the same rotation angle visually.
- **Rotating True North Only Moves the Needle**:
    - Confirm that no other part of the compass widget rotates apart from the needle indicating the new True North direction.
    - Double-check that this needle rotation uses the `needleLocal` value (which depends on `globalNorthAngle` and `designNorthAngle`).

---

By logging and verifying each of these key components in the `updateNorthRotation()` method, you'll be able to debug and fix issues related to the 2D compass. Let me know if you'd like help working through specific parts of the code!

### Gemini 2.5 Flash
Right, let's get this compass widget behaving as intended.

You've highlighted a critical area for debugging: how the 'NPoint' (the 2D compass widget) rotation interacts with `designNorthAngle` and `globalNorthAngle`, especially with regard to the design grid.

Here's a breakdown of your requirements and how the current code behaves, leading to the necessary changes:

### Requirement Analysis and Current Code Assessment

1.  **Aligned with the design grid (shown):**
    *   **Code:** `npRotEl.style.transform = `rotate(${iconRot}deg)`;` where `iconRot = designNorthAngle;`
    *   **Assessment:** This part is correct. The entire compass housing (`npRotEl`) rotates to align with `designNorthAngle`, which conceptually represents your design grid's orientation.

2.  **Rotating the NPoint does not rotate the grid nor Design North:**
    *   **Code:** In `handleDrag()`, when `isRotating` (triggered by the "Rotate N Point" context menu item), the code calculates `newDN = rotateStartDN - (cur - rotateStartAngle);` and then calls `applyDesignNorth(newDN);`.
    *   **Assessment:** **This is the core issue and violates your requirement.** The `rotateMode` drag interaction *directly modifies* `designNorthAngle`. If `designNorthAngle` represents the grid's orientation, then this interaction *is* rotating the "Design North" and, by implication, the grid.
    *   **Proposed Fix:** The `rotateMode` drag should instead modify `globalNorthAngle` (True North), leaving `designNorthAngle` and thus the grid's orientation untouched by this specific user interaction.

3.  **DNorth appears when True North is rotated away from the vertical.**
    *   **Code:** `dnGroupEl.style.display = designNorthAngle !== globalNorthAngle ? '' : 'none';`
    *   **Assessment:** This is correct. The Design North arrow appears when `designNorthAngle` (the grid's orientation) is different from `globalNorthAngle` (True North's orientation).

4.  **DNorth will continue to point vertically upwards:**
    *   **Code:** `dnGroupEl.setAttribute('transform', `rotate(0, ${SVG_CX}, ${SVG_CY})`);`
    *   **Assessment:** This is correct. The Design North arrow is always oriented straight up *within the compass housing's local coordinate system*. Since the housing itself rotates with `designNorthAngle`, the green arrow effectively points to the "Design North" direction.

5.  **The grid continues to be mathematically normal (vertical/horizontal to the screen):**
    *   **Assessment:** This is dependent on requirement 2. If `designNorthAngle` is not changed by the 'NPoint' rotation, then the grid's mathematical orientation remains constant. Our proposed fix for requirement 2 will ensure this.

### Debugging Steps and Code Changes

The primary issue is the `handleDrag` function incorrectly modifying `designNorthAngle` during the `rotateMode` interaction. We need to redirect this interaction to `globalNorthAngle`. Additionally, the user interface for "Rotate N Point" is currently confusing, as it opens an input for "Design North".

#### 1. Add a New Module State Variable

We need a variable to store the `globalNorthAngle` at the start of the rotation, similar to how `rotateStartDN` (which currently holds `designNorthAngle`) is used.

**File: app/js/north-point-2d.js**

```javascript
// ── Module state ─────────────────────────────────────────────
let npEl, npRotEl, npCtxEl, npVP;
let npW = NP_BASE_W;
let getState;

let designNorthAngle = 0;  // grid orientation — changed by "Set Design North"
let globalNorthAngle = 0;  // TN offset from world -Z — changed by "Rotate N Point"
let dnGroupEl  = null;  // green DN arrow (injected)
let dnLabelEl  = null;  // angle label
let tnNeedleEl = null;  // TN needle group (from SVG)

let isDragging      = false;
let dragPending     = false;
let dragStartClient = { x: 0, y: 0 };
let dragOffset      = { x: 0, y: 0 };

let rotateMode      = false;
let isRotating      = false;
let rotateStartAngle = 0;
// 1. New: Store globalNorthAngle at the start of rotation
let rotateStartGlobalNorth = 0; // MODIFIED LINE - NEW VARIABLE
// let rotateStartDN    = 0; // OLD LINE - This variable will no longer be used for rotation calculation.

let isResizing   = false;
let resizeHandle = null;
let resizeStart  = { w: NP_BASE_W, anchor: { x: 0, y: 0 } };

const _npO = new THREE.Vector3();
const _npN = new THREE.Vector3();
```

**Reasoning:** `rotateStartDN` was intended to capture the `designNorthAngle` before rotation. Since we now want to rotate `globalNorthAngle`, we need a similar reference for it.

#### 2. Update `onDragDown` to Reference `globalNorthAngle`

When the rotation drag starts, capture the current `globalNorthAngle`.

**File: app/js/north-point-2d.js**

```javascript
// ── Drag ──────────────────────────────────────────────────────

function onDragDown(e) {
  if (e.target.classList.contains('resize-handle') || isResizing) return;
  if (e.button !== 0) return;

  if (rotateMode) {
    // In rotate mode: drag rotates the icon instead of moving it
    isRotating       = true;
    rotateStartAngle = angleFromNPCenter(e.clientX, e.clientY);
    // 2. Change: Store globalNorthAngle as the starting point for rotation
    rotateStartGlobalNorth = globalNorthAngle; // MODIFIED LINE
    npEl.setPointerCapture(e.pointerId);
    e.stopPropagation();
    return;
  }
  // ... rest of drag code
}
```

**Reasoning:** This ensures that when the user enters `rotateMode`, the initial `globalNorthAngle` is correctly stored as the baseline for calculating the new True North direction.

#### 3. Update `handleDrag` to Modify `globalNorthAngle`

This is the most critical change to address requirement 2. We'll calculate the new `globalNorthAngle` based on the mouse movement. We also remove the confusing update to the "Design North" input field, as this action should not be tied to `designNorthAngle`.

**File: app/js/north-point-2d.js**

```javascript
// ── Drag ──────────────────────────────────────────────────────

// ... (onDragDown and other functions) ...

function handleDrag(e) {
  if (isRotating) {
    const cur   = angleFromNPCenter(e.clientX, e.clientY);
    // Calculate the change in angle from the start of the drag
    const angleDelta = cur - rotateStartAngle;

    // 3. Change: Apply this angular change to the globalNorthAngle
    // If dragging clockwise (positive angleDelta), globalNorthAngle increases (East).
    const newGlobalNorth = rotateStartGlobalNorth + angleDelta;
    applyGlobalNorth(newGlobalNorth); // MODIFIED LINE

    // 3. Change: Remove the input field update. The 'np-dn-field' is for Design North,
    // and this interaction is changing Global North. Updating it here would be misleading.
    // const field = document.getElementById('np-dn-field');
    // if (field) field.value = formatNorthAngle(newDN);
    return;
  }
  if (!dragPending && !isDragging) return;
  // ... rest of drag code
}
```

**Reasoning:** This directly implements requirement 2. The `rotateMode` drag now precisely adjusts `globalNorthAngle`, ensuring that `designNorthAngle` (and thus the grid) remains unaffected by this user interaction. The removal of the `field.value` update prevents conflicting information from being displayed in the "Design North" input field.

#### 4. Correct Context Menu Behaviour for "Rotate N Point"

The "Rotate N Point" context menu item currently calls `showDNInput(true)`. This function is specifically for managing the "Design North" input field. Since the "Rotate N Point" action (via drag) is now intended to modify `globalNorthAngle`, it should not be showing an input field related to `designNorthAngle`. For clarity and correctness, we remove this call.

**File: app/js/north-point-2d.js**

```javascript
export function initNorthPoint2D(getStateCallback) {
  // ... (existing code) ...

  document.getElementById('np-ctx-rotate-np')?.addEventListener('click', () => {
    if (npCtxEl) npCtxEl.style.display = 'none';
    enterRotateMode();
    // 4. Change: Remove the call to showDNInput, as this action now changes globalNorthAngle,
    // not designNorthAngle. Showing a 'Design North' input would be confusing.
    // showDNInput(true); // OLD LINE - REMOVED
  });
}
```

**Reasoning:** This clarifies the user interface. The "Rotate N Point" action now exclusively enables the drag-to-rotate functionality for `globalNorthAngle` without displaying a potentially misleading "Design North" input field. If a separate input for True North were desired, a new UI element and logic would be needed.

### Summary of How Requirements Are Met

*   **a) Aligned with the design grid (shown):** The compass housing (`npRotEl`) still rotates by `designNorthAngle`, reflecting the grid's orientation.
*   **b) Rotating the NPoint does not rotate the grid nor Design North:** The `handleDrag` function in `rotateMode` now modifies `globalNorthAngle` instead of `designNorthAngle`. Thus, the `designNorthAngle` variable remains fixed, ensuring the grid's orientation is unchanged by this interaction.
*   **c) DNorth appears when True North is rotated away from the vertical:** The logic `designNorthAngle !== globalNorthAngle` remains, correctly showing the DN arrow when there's a difference between grid north and true north.
*   **d) DNorth will continue to point vertically upwards:** `dnGroupEl`'s `transform` remains `rotate(0, ...)`, meaning it always points straight up relative to the compass housing.
*   **e) The grid continues to be mathematically normal (vertical/horizontal to the screen):** Since `designNorthAngle` is no longer changed by the 'NPoint' rotation, the underlying grid definition remains stable.

These changes ensure the 2D compass adheres to your specified behavioural requirements, particularly regarding the separation and interaction of 'Design North' and 'True North'.

---

## Mon, 6 Apr 2026, 4:43 pm
**Q:** I want to work on the NPoint compass.

### GPT-4o
[Error: HTTP 500]

### Groq Llama 3.3 70B
To create an N-Point compass, you'll need to determine the angle between each point. A standard compass has 360 degrees, so for an N-Point compass, you can divide 360 by N to get the angle between each point. 

In JavaScript, you can calculate the points as follows:

```javascript
function calculateCompassPoints(n) {
    const points = [];
    const angleBetweenPoints = 360 / n;

    for (let i = 0; i < n; i++) {
        const angle = i * angleBetweenPoints;
        const compassPoint = getCompassPoint(angle);
        points.push(compassPoint);
    }

    return points;
}

function getCompassPoint(angle) {
    // Convert angle to a string representation of the compass point
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.floor((angle / 22.5) + 0.5) % 16;
    return directions[index];
}

// Example usage:
const nPointCompass = calculateCompassPoints(16);
console.log(nPointCompass);
```

This code calculates the points for an N-Point compass by dividing 360 degrees by N, then converts the angles to string representations of the compass points.

### Mistral Codestral
The **NPoint compass** is a tool for navigating and visualising data points in a multi-dimensional space. It's often used in machine learning, data science, and visualisation projects.

### Key Features:
- **Multi-dimensional visualisation** – Helps understand relationships between variables.
- **Interactive exploration** – Zoom, rotate, and filter data points.
- **Customisable** – Adjust axes, colours, and labels.

### Implementation Options:
1. **JavaScript (D3.js / Three.js)** – Best for web-based visualisation.
2. **Python (Matplotlib / Plotly)** – Good for quick prototyping.
3. **Node.js (with WebGL)** – If you need a backend-driven solution.

### Example (Python with Plotly):
```python
import plotly.express as px
import numpy as np

# Generate random 3D data
data = np.random.rand(100, 3)

# Create 3D scatter plot
fig = px.scatter_3d(data, x=0, y=1, z=2, title="NPoint Compass")
fig.show()
```

### Next Steps:
- Define your data structure (e.g., CSV, JSON, database).
- Choose a library (D3.js for web, Matplotlib for Python).
- Implement interactivity (zooming, filtering).

Would you like a specific implementation guide?

### Groq Llama 3.3 70B (fallback from Gemini Lite)
The N-Point compass, also known as the rose of the winds, is a directional system with more than the standard 4 or 8 points. To work on this, we can start by defining the number of points (N) and calculating the angle between each point. 

In JavaScript, this can be achieved as follows:
```javascript
class NPointCompass {
  /**
   * Constructor for NPointCompass
   * @param {number} points - The number of points on the compass
   */
  constructor(points) {
    this.points = points;
    this.angleBetweenPoints = 360 / points;
  }

  /**
   * Get the angle for a specific point
   * @param {number} point - The point number (0-indexed)
   * @returns {number} The angle for the given point
   */
  getAngleForPoint(point) {
    return point * this.angleBetweenPoints;
  }

  /**
   * Get the direction for a specific angle
   * @param {number} angle - The angle in degrees
   * @returns {number} The point number (0-indexed) for the given angle
   */
  getPointForAngle(angle) {
    return Math.round(angle / this.angleBetweenPoints) % this.points;
  }
}

// Example usage
const compass = new NPointCompass(16);
console.log(compass.getAngleForPoint(0));  // outputs: 0
console.log(compass.getPointForAngle(45)); // outputs: 2
```
This implementation provides a basic structure for working with an N-Point compass. You can extend this class to add more functionality as needed. How would you like to proceed with your project?

### Gemini 2.5 Flash
Right, an NPoint compass. This typically involves dividing a 360-degree circle into `N` equal segments to determine directional labels based on a given angle.

To assist you effectively, please specify what you'd like to do:
*   Are you looking for an explanation of the concept?
*   Do you need code for calculating the direction for a given angle and `N`? If so, which language (e.g., JavaScript, Python)?
*   Do you have existing code you'd like to debug or refine?
*   Are you working on a specific web or application context?

---

## Tue, 7 Apr 2026, 7:54 am
**Q:** I want to work on the NPoint compass.

### Groq Llama 3.3 70B
The N-Point compass is a circular representation of directions. To implement it, we can use HTML, CSS, and JavaScript. Which aspect would you like to focus on: the front-end visualisation or the back-end logic for calculating directions?

### Gemini 2.5 flash
Understood. To help you with the NPoint compass, could you please elaborate on what you'd like to achieve or what specific tasks you have in mind? For example, are you looking to design its logic, implement it in a particular language/framework, or debug an existing implementation?

### Codestral
The **NPoint compass** is a tool for navigating and visualising data points in a multi-dimensional space. It's often used in machine learning, data science, and visualisation projects.

### Key Features:
- **Multi-dimensional visualisation** – Helps understand relationships between high-dimensional data.
- **Interactive exploration** – Zoom, rotate, and filter data points.
- **Customisable** – Adjust colours, labels, and projections.

### Implementation Options:
1. **JavaScript (D3.js, Three.js, or Plotly)** – Best for web-based visualisation.
2. **Python (Matplotlib, Plotly, or Bokeh)** – Good for data science workflows.
3. **Node.js (with libraries like `d3-node` or `three.js`)** – If you need a backend-driven solution.

### Example (D3.js):
```javascript
// Basic NPoint compass using D3.js
import * as d3 from 'd3';

// Sample data (replace with your dataset)
const data = [
  { x: 1, y: 2, z: 3, label: "Point A" },
  { x: 4, y: 5, z: 6, label: "Point B" },
];

// Create SVG container
const svg = d3.select("body").append("svg")
  .attr("width", 500)
  .attr("height", 500);

// Scales for x, y, z axes
const xScale = d3.scaleLinear().domain([0, 10]).range([50, 450]);
const yScale = d3.scaleLinear().domain([0, 10]).range([450, 50]);

// Draw points
svg.selectAll("circle")
  .data(data)
  .enter()
  .append("circle")
  .attr("cx", d => xScale(d.x))
  .attr("cy", d => yScale(d.y))
  .attr("r", 5)
  .attr("fill", "steelblue");

// Add labels
svg.selectAll("text")
  .data(data)
  .enter()
  .append("text")
  .attr("x", d => xScale(d.x) + 10)
  .attr("y", d => yScale(d.y))
  .text(d => d.label);
```

### Next Steps:
- **Define your dataset** – What dimensions do you need to visualise?
- **Choose a library** – D3.js for web, Matplotlib for Python.
- **Extend functionality** – Add interactivity, clustering, or 3D projections.

Would you like help with a specific implementation?

---

## Tue, 7 Apr 2026, 8:17 am
**Q:** What can you tell me about this project that I have opened?

### Groq Llama 3.3 70B
I don't have any information about the project you've opened, as this conversation has just started. Please provide more context or details about the project, and I'll be happy to assist you. What type of project is it, and what programming languages or frameworks are involved?

### Codestral
I can't see any open project files or context. Please provide details about the project (e.g., code snippets, framework, or specific questions) so I can assist you effectively.

### Gemini 2.5 flash
I'm sorry, but as an AI, I don't have access to your local file system or any projects you might have "opened". I can only process the information you provide to me directly in our conversation.

Please provide details about the project (e.g., its name, language, framework, a description of its purpose, or relevant code snippets) if you'd like me to tell you about it or help you with it.

---

## Tue, 7 Apr 2026, 12:29 pm
**Q:** We need to debug NPoint compass. Find me the relevant files and codes to discuss how we can do this.

### Groq Llama 3.3 70B
To debug the NPoint compass, we'll likely need to examine the JavaScript files responsible for its functionality. 

The key files to review will depend on the framework or library used, but typically, you'll find the relevant code in files named:
- `npoint-compass.js` or `compass.js`
- `npoint-compass.css` for styling
- potentially a configuration file, such as `config.js`

We'll need to look at the JavaScript code that handles the compass's calculations, particularly the functions that update the compass's direction and needle position. 

Look for keywords such as `degrees`, `radians`, `Math.atan2`, or `Math.cos`/`Math.sin`, as these are commonly used for calculating directions and angles in JavaScript. 

If you provide the specific code or repository, I can help you debug it further.

### Groq Llama 3.3 70B (fallback from Cerebras)
To debug the NPoint compass, we need to locate the relevant JavaScript files. The primary file responsible for the compass functionality is likely to be `npoint-compass.js` or a similar file within the project's JavaScript directory.

Assuming a typical web development setup, the relevant code and files may include:
```javascript
// npoint-compass.js
class NPointCompass {
  // Compass-related methods and properties
}

// npoint-compass-view.js
class NPointCompassView {
  // Compass visualisation and rendering methods
}

// npoint-compass-model.js
class NPointCompassModel {
  // Compass data and calculation methods
}
```
Key sections to focus on for debugging may include:
- Initialization of the compass (`constructor` method)
- Calculation methods (e.g., `calculateBearing()` or `updateDirection()`)
- Event listeners and handlers (e.g., `onOrientationChange()`)

To proceed with debugging, I recommend we:
1. Inspect the browser console for error messages related to the compass
2. Review the project's documentation and codebase to understand the compass's intended functionality
3. Use debugging tools to step through the code and identify potential issues

Which specific aspect of the NPoint compass would you like to focus on for debugging?

### Codestral
To debug **NPoint Compass**, we need to examine the following key files and components:

### **1. Core Files**
- **`npoint-compass.js`** (Main entry point)
- **`config.js`** (Configuration settings)
- **`routes.js`** (API/route definitions)
- **`utils/`** (Helper functions, e.g., `logger.js`, `errorHandler.js`)

### **2. Debugging Approach**
- **Check for errors** in the console/logs (`console.error`, `logger`).
- **Validate API responses** (e.g., `fetch`/`axios` calls).
- **Inspect configuration** (`config.js` for environment variables).
- **Review route handlers** (`routes.js`) for incorrect paths or middleware issues.

### **3. Common Issues**
- **Missing dependencies** (`npm install`).
- **Incorrect environment variables** (check `.env`).
- **CORS issues** (if frontend/backend are separate).
- **Database connection errors** (if using MongoDB/PostgreSQL).

### **Next Steps**
- Share the **error logs** or **specific issue** for targeted debugging.
- Provide **code snippets** from the files above if needed.

Would you like to focus on a specific part?

### Groq Llama 3.3 70B (fallback from OpenRouter)
To debug the NPoint compass, we'll need to review the JavaScript files responsible for its functionality. Typically, these would be:

1. `npoint-compass.js` or `compass.js` (the main compass script)
2. `npoint-compass.css` (styles that may affect layout or visual cues)
3. Any associated HTML files (e.g., `index.html` or `compass.html`) that include the compass

Assuming an NPoint compass library or framework, the relevant code snippets would likely involve:

- Compass initialisation and configuration
- Event listeners for user interactions (e.g., mouse movements or touch events)
- Calculations for determining the compass direction (using trigonometry, geolocation, or sensor APIs)

Example code might look like this:
```javascript
// npoint-compass.js (simplified example)
class NPointCompass {
  constructor(element, options) {
    this.element = element;
    this.options = options;
    this.init();
  }

  init() {
    // Set up event listeners, calculate initial direction, etc.
    this.element.addEventListener('mousemove', (event) => {
      this.calculateDirection(event.clientX, event.clientY);
    });
  }

  calculateDirection(x, y) {
    // Apply trigonometric calculations to determine direction
    const angle = Math.atan2(y, x);
    const direction = (angle * 180 / Math.PI) + 90; // convert to degrees
    // Update the compass UI with the new direction
    this.updateCompass(direction);
  }

  updateCompass(direction) {
    // Rotate the compass needle, update the display, etc.
    this.element.style.transform = `rotate(${direction}deg)`;
  }
}
```
To proceed with debugging, I'd like to know more about the specific issues you're experiencing with the NPoint compass. What symptoms are you observing?

### Gemini 2.5 flash
Debugging an "NPoint compass" component typically involves examining its implementation across various web development assets. Assuming "NPoint compass" refers to a custom or third-party JavaScript-based UI component, here are the relevant files and code sections for discussion:

### Relevant Files

1.  **`NPointCompass.js` (or `.ts`, `.jsx`, `.vue`)**:
    *   This is the primary file defining the component's logic, state, and rendering.
    *   It might be part of a larger framework like React, Vue, or Angular, or a plain JavaScript module.
2.  **`index.html` (or equivalent template file)**:
    *   The HTML file where the `NPointCompass` component is instantiated or embedded.
    *   This shows how the component is initialised and what properties or data it receives.
3.  **`NPointCompass.css` (or part of a global stylesheet, e.g., `style.css`)**:
    *   Contains the styling rules for the compass, including its size, appearance, and crucially, any rotation or transformation properties.
4.  **Data Source File (e.g., `dataService.js`, `locationTracker.js`)**:
    *   If the compass receives its directional data from an external service or module, this file would be relevant to verify the accuracy and format of the input.

### Relevant Code Sections for Discussion

**1. `NPointCompass.js` (Component Logic)**

*   **Component Initialisation and State Management:**
    ```javascript
    // Example: React Component
    class NPointCompass extends React.Component {
        constructor(props) {
            super(props);
            this.state = {
                direction: props.initialDirection || 0 // The angle the compass should point to (0-359)
            };
        }

        componentDidUpdate(prevProps) {
            // Check if 'direction' prop has changed
            if (this.props.direction !== prevProps.direction) {
                this.setState({ direction: this.props.direction });
            }
        }

        // Method to update direction, often called by parent component or internal logic
        updateDirection(newDirection) {
            this.setState({ direction: newDirection });
        }
        // ...
    }
    ```
    *   **Reasoning:** Debugging starts by ensuring the component correctly receives and stores the intended direction value. Incorrect initialisation or state updates can lead to a stagnant or wrong display.

*   **Rendering Logic (DOM Manipulation/JSX/Template):**
    ```javascript
    // Example: React render method
    render() {
        const { direction } = this.state;
        // Calculate the rotation angle for the compass needle
        const needleRotation = `rotate(${direction}deg)`;

        return (
            <div className="npoint-compass-container">
                <div className="npoint-compass-dial">
                    {/* Cardinal points, markings, etc. */}
                </div>
                <div
                    className="npoint-compass-needle"
                    style={{ transform: needleRotation }} // Apply rotation here
                >
                    {/* Needle SVG or HTML */}
                </div>
            </div>
        );
    }
    ```
    *   **Reasoning:** This section is crucial for verifying how the calculated direction is translated into a visual transformation (typically a CSS `transform: rotate()`). Errors here can mean the visual element doesn't move or moves incorrectly.

**2. `index.html` (Component Usage)**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>NPoint Compass Debug</title>
    <link rel="stylesheet" href="NPointCompass.css">
</head>
<body>
    <div id="app">
        <!-- The component is instantiated here -->
        <div id="compass-wrapper"></div>
    </div>

    <script src="NPointCompass.js"></script>
    <script>
        // Example: Initialising the component (e.g., simple JS, or framework mount)
        // For a simple JS component:
        const compass = new NPointCompass(document.getElementById('compass-wrapper'), { initialDirection: 45 });
        // Later update:
        // compass.updateDirection(90);

        // For a framework:
        // ReactDOM.render(<NPointCompass direction={45} />, document.getElementById('compass-wrapper'));
    </script>
</body>
</html>
```
*   **Reasoning:** This shows how the component is integrated and what initial `props` or `options` it receives. Incorrect mounting or missing initial data can prevent it from working.

**3. `NPointCompass.css` (Styling and Animation)**

```css
.npoint-compass-container {
    width: 200px;
    height: 200px;
    position: relative;
    border-radius: 50%;
    background-color: #f0f0f0;
    overflow: hidden;
}

.npoint-compass-needle {
    position: absolute;
    top: 0; bottom: 0; left: 0; right: 0;
    margin: auto;
    width: 10px; /* Example size */
    height: 90px; /* Example size */
    background-color: red;
    transform-origin: center bottom; /* Important: point of rotation */
    transition: transform 0.2s ease-out; /* Smooth movement */
    z-index: 10;
}

/* Ensure the needle starts pointing north or at its default */
.npoint-compass-needle {
    transform: rotate(0deg);
}
```
*   **Reasoning:** CSS properties are critical. Specifically, `transform-origin` dictates the pivot point for rotation, and `transition` can smooth movements but might mask issues if set too slow. `position` and `z-index` ensure the needle is visible and correctly layered.

---

## Tue, 7 Apr 2026, 1:05 pm
**Q:** We need to debug NPoint compass. Find me the relevant files and codes to discuss how we can do this.

### Groq Llama 3.3 70B
To debug the NPoint compass, we'll need to review the relevant JavaScript files. The key files are:

1. `app/js/north-point-2d.js`
2. `app/js/north-point-3d.js`

These files likely contain the logic for rendering and updating the North Point compass in both 2D and 3D viewports.

Additionally, we should also examine the `app/js/three.module.js` file, as it may contain relevant code for setting up the Three.js scene and camera, which could be related to the North Point compass.

The `app/js/OrbitControls.js` file might also be relevant, as it could be used to control the camera and potentially affect the compass.

Let's review the code in these files to identify any potential issues with the NPoint compass.

### OpenRouter
[Error: HTTP 500]

### Cerebras Llama 3.1 8B
To debug and enhance the North Point (NPoint) compass functionality, I recommend analyzing the following files:

1. `app/js/north-point-2d.js`: This script handles the 2D plan view of the NPoint compass.
2. `app/js/north-point-3d.js`: This script handles the 3D perspective view of the NPoint compass.
3. `app/js/three.module.js`: Although not directly related to NPoint compass, this script provides the Three.js functionality required for both 2D and 3D views.

In particular, I suggest examining the following components in these files:

- `north-point-2d.js`:
  - The `createNorthPoint()` function, which initializes and positions the NPoint compass in the 2D plan view.
  - The `updateNorthPoint()` function, which updates the NPoint compass's position based on user interactions (e.g., rotation, scaling).

- `north-point-3d.js`:
  - The `createNorthPoint3D()` function, which initializes and positions the NPoint compass in the 3D perspective view.
  - The `updateNorthPoint3D()` function, which updates the NPoint compass's position based on user interactions.

Once we have identified the potential issues in these files, we can discuss possible enhancements to improve the NPoint compass behavior and synchronize its display between the 2D plan and 3D perspective views.

### Codestral
# North Point Compass Debugging Files

The relevant files for debugging the north point compass functionality are:

1. **app/js/north-point-2d.js** - Handles 2D viewport compass
2. **app/js/north-point-3d.js** - Handles 3D viewport compass
3. **_archive/backend/camera.js** - Contains stable perspective camera implementation
4. **app/js/OrbitControls.js** - Simplified orbit controls for camera movement

The compass is shared between both viewports and uses the designNorthAngle parameter to align with the user's coordinate system. The issue likely involves coordinate system transformation between the global (Three.js) and design coordinate systems.

Would you like me to:
1. Review the current implementation of these files?
2. Propose specific changes to fix the compass alignment?
3. Explain the coordinate transformation logic?

### Gemini 2.5 flash
The relevant files for debugging the NPoint compass are:

1.  **`app/js/north-point-2d.js`**: This file likely handles the rendering and rotation logic for the north point compass in the 2D plan viewport.
2.  **`app/js/north-point-3d.js`**: This file likely handles the rendering and rotation logic for the north point compass in the 3D perspective viewport.

To discuss debugging, we would need to examine the code within these files, particularly how they:
*   Read the `designNorthAngle` (which defines the user-set North).
*   Transform this angle into a visual rotation for the compass.
*   Interact with the Three.js scene, camera, or controls to ensure correct orientation relative to both Global (Three.js, -Z=True North) and Design coordinate systems.
*   Are updated when the camera moves or the designNorthAngle changes.

We should also consider how these scripts are initialised and updated, potentially within `_archive/backend/main.js` or `app/textures/index.html`.

