/*
 * grid.js — Scene grid helpers and spacing popup for GPRTool
 *
 * Covers: CAD Universe grid (THREE.GridHelper), axis helpers, grid spacing popup.
 * The CAD grid is REAL WORLD — it aligns to True North and never rotates.
 * The Design Grid is DESIGN WORLD — managed by design-grid.js, updated here.
 *
 * Call initGrid() once after designGridManager is created.
 * Call updateSceneHelpers(siteSpan) whenever the site changes.
 */

import * as THREE from 'three';
import { state } from './state.js';
import { showFeedback } from './ui.js';
import { getDesignNorthAngle } from './north-point-2d.js';

// ── Auto major cell size ──────────────────────────────────────────────────

export function majorCellSize() {
  const rawCell = state._lastSiteSpan / 10;
  return state.manualGridSpacing
    ? state.manualGridSpacing
    : (rawCell < 50 ? 50 : rawCell < 100 ? 100 : rawCell < 250 ? 250 : 500);
}

// ── Scene helpers (grid + axes) ───────────────────────────────────────────

export function updateSceneHelpers(siteSpan) {
  state._lastSiteSpan = siteSpan;

  if (state.gridHelper)      { state.scene.remove(state.gridHelper);      state.gridHelper.geometry?.dispose();      state.gridHelper      = null; }
  if (state.gridHelperMinor) { state.scene.remove(state.gridHelperMinor); state.gridHelperMinor.geometry?.dispose(); state.gridHelperMinor = null; }
  if (state.axesHelper)      { state.scene.remove(state.axesHelper); state.axesHelper = null; }
  state.axesYLine = null;

  const gridSize = 10000;
  const rawCell  = siteSpan / 10;
  const cellSize = state.manualGridSpacing
    ? state.manualGridSpacing
    : (rawCell < 50 ? 50 : rawCell < 100 ? 100 : rawCell < 250 ? 250 : 500);
  const divisions = gridSize / cellSize;

  // CAD Universe grid — ALWAYS True North, NEVER rotates
  state.gridHelper = new THREE.GridHelper(gridSize, divisions, 0xa8b8a0, 0xc0cdb8);
  state.gridHelper.material.opacity     = 0.65;
  state.gridHelper.material.transparent = true;
  state.gridHelper.visible = (state.currentMode === '2d');
  state.scene.add(state.gridHelper);

  if (state.designGridManager) {
    state.designGridManager.setHorizontalExtent(gridSize / 2);
    state.designGridManager.setHorizontalSpacing(
      state.manualGridSpacing    ?? cellSize,
      state.manualMinorDivisions ?? 0
    );
    state.designGridManager.setVisible(state.currentMode === '2d');
  }

  const axisLen = siteSpan * 0.3;
  const makeLine = (end, color) => {
    const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), end]);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color, depthTest: false }));
  };
  state.axesHelper = new THREE.Group();
  state.axesHelper.add(makeLine(new THREE.Vector3(axisLen, 0, 0),   0xff2222));
  state.axesHelper.add(makeLine(new THREE.Vector3(0, 0, -axisLen),  0x22aa44));
  state.axesYLine = makeLine(new THREE.Vector3(0, axisLen, 0),      0x2255ff);
  state.axesHelper.add(state.axesYLine);
  state.axesYLine.visible = (state.currentMode === '3d');
  state.axesHelper.renderOrder = 999;
  state.scene.add(state.axesHelper);
}

// ── Grid spacing popup ────────────────────────────────────────────────────

export function showGridSpacingPopup(cx, cy) {
  let pop = document.getElementById('grid-spacing-popup');
  if (pop) { pop.remove(); return; }
  pop = document.createElement('div');
  pop.id = 'grid-spacing-popup';
  pop.style.cssText = `
    position:fixed; z-index:1000;
    background:var(--chrome-panel); border:1px solid var(--chrome-border);
    border-radius:6px; box-shadow:0 4px 20px rgba(0,0,0,0.18);
    padding:12px 14px; width:214px;
    font-family:var(--font-ui,'Outfit',sans-serif); font-size:12px;
    color:var(--text-primary);`;
  pop.innerHTML = `
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;
                color:var(--text-secondary);margin-bottom:10px;">Grid Spacing</div>
    <div style="display:grid;grid-template-columns:44px 1fr auto;
                gap:7px 8px;align-items:center;margin-bottom:6px;">
      <span style="font-size:11px;color:var(--text-secondary);">Major Grid</span>
      <input type="number" id="gs-major" min="1" max="10000" step="1" placeholder="auto"
        style="background:var(--chrome-input);border:1px solid var(--chrome-border);
               border-radius:4px;color:var(--text-primary);font-size:12px;
               padding:4px 6px;outline:none;text-align:right;width:100%;box-sizing:border-box;">
      <span style="font-size:11px;color:var(--text-secondary);">m</span>
      <span style="font-size:11px;color:var(--text-secondary);">Minor Grid</span>
      <input type="number" id="gs-minor" min="2" max="100" step="1" placeholder="off"
        style="background:var(--chrome-input);border:1px solid var(--chrome-border);
               border-radius:4px;color:var(--text-primary);font-size:12px;
               padding:4px 6px;outline:none;text-align:right;width:100%;box-sizing:border-box;">
      <span style="font-size:11px;color:var(--text-secondary);">lines</span>
    </div>
    <div id="gs-hint" style="font-size:10px;color:var(--text-muted);margin-bottom:10px;min-height:13px;"></div>
    <div style="display:flex;gap:6px;">
      <button id="gs-ok" style="flex:1;background:var(--accent-mid);color:#fff;border:none;border-radius:4px;font-size:12px;padding:5px 0;cursor:pointer;">OK</button>
      <button id="gs-cancel" style="flex:1;background:var(--chrome-panel-alt);color:var(--text-primary);border:1px solid var(--chrome-border);border-radius:4px;font-size:12px;padding:5px 0;cursor:pointer;">Cancel</button>
      <button id="gs-reset" style="flex:1;background:none;color:var(--text-secondary);border:1px solid var(--chrome-border);border-radius:4px;font-size:12px;padding:5px 0;cursor:pointer;" title="Reset both to auto">Reset</button>
    </div>`;
  document.body.appendChild(pop);
  pop.style.left = Math.min(cx + 4, window.innerWidth  - 222 - 8) + 'px';
  pop.style.top  = Math.min(cy + 4, window.innerHeight - 158 - 8) + 'px';

  const majInp = document.getElementById('gs-major');
  const minInp = document.getElementById('gs-minor');
  const hint   = document.getElementById('gs-hint');
  majInp.value = state.manualGridSpacing    ?? '';
  minInp.value = state.manualMinorDivisions ?? '';

  const updateHint = () => {
    const n    = parseInt(minInp.value, 10);
    const cell = parseInt(majInp.value, 10) > 0 ? parseInt(majInp.value, 10) : majorCellSize();
    hint.textContent = (n >= 2)
      ? `Sub-cell: ${(cell / n) % 1 === 0 ? (cell / n) : (cell / n).toFixed(1)} m` : '';
  };
  updateHint();
  majInp.addEventListener('input', updateHint);
  minInp.addEventListener('input', updateHint);
  majInp.focus(); majInp.select();

  const applyAll = (maj, min) => {
    const hasDN = (getDesignNorthAngle() ?? 0) !== 0;
    if (hasDN && state.designGridManager?.grids?.size) {
      state.dgSpacing          = (maj > 0)  ? maj : null;
      state.dgMinorDivisions   = (min >= 2) ? min : null;
      const cell = state.dgSpacing ?? majorCellSize();
      state.designGridManager.setHorizontalSpacing(cell, state.dgMinorDivisions ?? 0);
      const sub = state.dgMinorDivisions ? cell / state.dgMinorDivisions : null;
      showFeedback(`Design Grid \u2014 ${cell} m${sub ? ` \u00b7 sub ${sub % 1 === 0 ? sub : sub.toFixed(1)} m` : ''}`);
    } else {
      state.manualGridSpacing    = (maj > 0)  ? maj : null;
      state.manualMinorDivisions = (min >= 2) ? min : null;
      updateSceneHelpers(state._lastSiteSpan);
      const cell = majorCellSize();
      const sub  = state.manualMinorDivisions ? cell / state.manualMinorDivisions : null;
      showFeedback(`CAD Grid \u2014 ${state.manualGridSpacing ?? cell} m${sub ? ` \u00b7 sub ${sub % 1 === 0 ? sub : sub.toFixed(1)} m` : ''}`);
    }
    pop.remove();
  };
  const onKey = e => {
    if (e.key === 'Enter')  applyAll(parseInt(majInp.value, 10), parseInt(minInp.value, 10));
    if (e.key === 'Escape') pop.remove();
  };
  majInp.addEventListener('keydown', onKey);
  minInp.addEventListener('keydown', onKey);
  document.getElementById('gs-ok').addEventListener('click',     () => applyAll(parseInt(majInp.value, 10), parseInt(minInp.value, 10)));
  document.getElementById('gs-cancel').addEventListener('click', () => pop.remove());
  document.getElementById('gs-reset').addEventListener('click',  () => applyAll(0, 0));
}
