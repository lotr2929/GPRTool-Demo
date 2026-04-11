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
let rotateStartGlobalNorth = 0;  // TN captured at drag-start — changed by "Rotate N Point"

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
    // Label shows tilt of DN relative to TN
    dnLabelEl.textContent = formatNorthAngle(designNorthAngle - globalNorthAngle);
  }

  // Show / hide "Clear Design North" menu item
  const clearItem = document.getElementById('np-ctx-clear-dn');
  if (clearItem) clearItem.style.display = deg !== null && designNorthAngle !== 0 ? '' : 'none';

  saveState();
}

function applyGlobalNorth(deg) {
  globalNorthAngle = deg ?? 0;
  // Label shows tilt of DN relative to TN
  if (dnLabelEl) dnLabelEl.textContent = formatNorthAngle(designNorthAngle - globalNorthAngle);
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

// ── True North input field (mirrors showDNInput but targets globalNorthAngle) ────────

function showTNInput(autoFocus = true) {
  let inp = document.getElementById('np-tn-input');
  if (!inp) {
    inp = document.createElement('div');
    inp.id = 'np-tn-input';
    inp.innerHTML = `
      <div class="np-dn-title">True North Offset</div>
      <input type="text" id="np-tn-field" placeholder="e.g. 7, 7.4, 7\u00b022', 7W" autocomplete="off" spellcheck="false">
      <div class="np-dn-hint">+ or E = east &nbsp;|&nbsp; - or W = west</div>
    `;
    document.body.appendChild(inp);

    document.getElementById('np-tn-field').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const val = e.target.value.trim();
        const deg = parseNorthAngle(val);
        if (deg !== null) {
          applyGlobalNorth(deg);
          hideTNInput();
        } else {
          e.target.classList.add('np-dn-invalid');
          setTimeout(() => e.target.classList.remove('np-dn-invalid'), 600);
        }
        e.preventDefault();
      }
      if (e.key === 'Escape') { hideTNInput(); e.stopPropagation(); }
    });

    document.getElementById('np-tn-field').addEventListener('input', e => {
      e.target.classList.remove('np-dn-invalid');
    });
  }

  const rect = npEl.getBoundingClientRect();
  inp.style.display = 'block';
  inp.style.right   = (window.innerWidth  - rect.left + 8) + 'px';
  inp.style.bottom  = (window.innerHeight - rect.bottom)   + 'px';

  const field = document.getElementById('np-tn-field');
  field.value = globalNorthAngle !== 0 ? formatNorthAngle(globalNorthAngle) : '';
  field.classList.remove('np-dn-invalid');
  if (autoFocus) requestAnimationFrame(() => field.focus());

  document.removeEventListener('keydown', onTNKeyCapture, true);
  document.addEventListener('keydown', onTNKeyCapture, true);
  document.removeEventListener('click', onClickOutsideTNInput);
  setTimeout(() => { document.addEventListener('click', onClickOutsideTNInput); }, 50);
}

function hideTNInput() {
  const inp = document.getElementById('np-tn-input');
  if (inp) inp.style.display = 'none';
  document.removeEventListener('click', onClickOutsideTNInput);
  document.removeEventListener('keydown', onTNKeyCapture, true);
  exitRotateMode();
}

function onTNKeyCapture(e) {
  const inp = document.getElementById('np-tn-input');
  if (!inp || inp.style.display === 'none') return;
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); hideTNInput(); }
  if (e.key === 'Enter') {
    e.stopPropagation(); e.preventDefault();
    const field = document.getElementById('np-tn-field');
    if (!field) return;
    const deg = parseNorthAngle(field.value.trim());
    if (deg !== null) { applyGlobalNorth(deg); hideTNInput(); }
    else {
      field.classList.add('np-dn-invalid');
      setTimeout(() => field.classList.remove('np-dn-invalid'), 600);
    }
  }
}

function onClickOutsideTNInput(e) {
  const inp = document.getElementById('np-tn-input');
  if (inp && !inp.contains(e.target) && !npEl.contains(e.target)) hideTNInput();
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

  // Dot — centred on circumference (cy=18: circumference line crosses dot middle)
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('cx', SVG_CX);
  head.setAttribute('cy', '18');
  head.setAttribute('r', '3');
  head.setAttribute('fill', '#4a8a4a');

  // Label — outside circle at arrow tip; position/anchor set in applyDesignNorth()
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.id = 'np-dn-label';
  label.setAttribute('font-size', '6');
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
  const { currentMode, camera2D, camera3D, controls3D, pan2D, rotate2D } = getState();

  // Bug 2 fix: in 2D mode, counter-rotate housing by viewport rotation so it
  // stays visually aligned with the grid as the user pans/rotates the plan view.
  // In 3D mode the gizmo (north-point-3d.js) tracks the camera; housing stays fixed to DN.
  const iconRot = currentMode === '2d'
    ? designNorthAngle - (rotate2D * 180 / Math.PI)
    : designNorthAngle;
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
    const LABEL_Y   = 16;  // baseline at dot (cy=18, top y=15) — label sits on DN arrow tip
    const CLASH_DEG = 65;
    const SIDE_X    = 5;   // small offset keeps text inside compass bounds at font-size 6

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
    showTNInput(true);  // Bug 1 fix: set TN, not DN
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
    // In rotate mode: drag rotates TN (globalNorthAngle) instead of moving compass
    isRotating       = true;
    rotateStartAngle = angleFromNPCenter(e.clientX, e.clientY);
    rotateStartGlobalNorth = globalNorthAngle;  // Bug 1 fix: capture TN, not DN
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
    // Bug 1 fix: drag sets TN (globalNorthAngle), not DN
    const newGN = rotateStartGlobalNorth + (cur - rotateStartAngle);  // + so needle follows drag direction
    applyGlobalNorth(newGN);
    const field = document.getElementById('np-tn-field');
    if (field) field.value = formatNorthAngle(newGN);
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
