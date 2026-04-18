/*
 * surfaces.js — Surface detection, selection and panel for GPRTool
 *
 * Covers: coplanar patch detection, hover/select, surface panel population.
 * Depends on state.js for shared surface state, ui.js for feedback.
 *
 * Cross-module callbacks injected via initSurfaces():
 *   fitSurfaceCamera(surface)        — called on select (viewport.js)
 *   drawSurfaceCanvasOutline(surface) — called on select (viewport.js)
 *   clearSurfaceCanvasOutline()       — called on deselect (viewport.js)
 */

import * as THREE from 'three';
import { state } from './state.js';
import { showFeedback } from './ui.js';

// ── Cross-module callbacks ─────────────────────────────────────────────────
let _fitSurfaceCamera         = null;
let _drawSurfaceCanvasOutline = null;
let _clearSurfaceCanvasOutline = null;

export function initSurfaces({ fitSurfaceCamera, drawSurfaceCanvasOutline, clearSurfaceCanvasOutline }) {
  _fitSurfaceCamera          = fitSurfaceCamera;
  _drawSurfaceCanvasOutline  = drawSurfaceCanvasOutline;
  _clearSurfaceCanvasOutline = clearSurfaceCanvasOutline;
}

// ── Surface classification ─────────────────────────────────────────────────

export function classifyNormal(normal) {
  if (normal.y < -0.5) return 'underside';
  if (normal.y >  0.7) return 'horizontal';
  if (Math.abs(normal.y) < 0.3) return 'wall';
  return 'sloped';
}

// ── Mesh area ─────────────────────────────────────────────────────────────

export function computeMeshArea(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const mat = mesh.matrixWorld;
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
  let area = 0;
  const n = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < n; i++) {
    const [iA, iB, iC] = idx
      ? [idx.getX(i*3), idx.getX(i*3+1), idx.getX(i*3+2)]
      : [i*3, i*3+1, i*3+2];
    pA.fromBufferAttribute(pos, iA).applyMatrix4(mat);
    pB.fromBufferAttribute(pos, iB).applyMatrix4(mat);
    pC.fromBufferAttribute(pos, iC).applyMatrix4(mat);
    e1.subVectors(pB, pA); e2.subVectors(pC, pA);
    cr.crossVectors(e1, e2);
    area += cr.length() * 0.5;
  }
  return area;
}

// ── Dominant normal ───────────────────────────────────────────────────────

export function computeDominantNormal(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const mat = mesh.matrixWorld;
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const n = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < n; i++) {
    const [iA, iB, iC] = idx
      ? [idx.getX(i*3), idx.getX(i*3+1), idx.getX(i*3+2)]
      : [i*3, i*3+1, i*3+2];
    pA.fromBufferAttribute(pos, iA).applyMatrix4(mat);
    pB.fromBufferAttribute(pos, iB).applyMatrix4(mat);
    pC.fromBufferAttribute(pos, iC).applyMatrix4(mat);
    e1.subVectors(pB, pA); e2.subVectors(pC, pA);
    cr.crossVectors(e1, e2);
    acc.add(cr);
  }
  return acc.length() < 1e-10 ? new THREE.Vector3(0,1,0) : acc.normalize();
}

// ── Coplanar patch detection ──────────────────────────────────────────────

const SNAP = 1e-3;
function vKey(v) {
  const s = 1/SNAP;
  return `${Math.round(v.x*s)},${Math.round(v.y*s)},${Math.round(v.z*s)}`;
}

function extractAllTriangles(modelGroup) {
  const tris = [];
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  modelGroup.traverse(child => {
    if (!child.isMesh) return;
    child.updateMatrixWorld(true);
    const pos = child.geometry.attributes.position;
    const idx = child.geometry.index;
    if (!pos) return;
    const n = idx ? idx.count/3 : pos.count/3;
    for (let i = 0; i < n; i++) {
      const [iA,iB,iC] = idx
        ? [idx.getX(i*3), idx.getX(i*3+1), idx.getX(i*3+2)]
        : [i*3, i*3+1, i*3+2];
      pA.fromBufferAttribute(pos, iA).applyMatrix4(child.matrixWorld);
      pB.fromBufferAttribute(pos, iB).applyMatrix4(child.matrixWorld);
      pC.fromBufferAttribute(pos, iC).applyMatrix4(child.matrixWorld);
      e1.subVectors(pB, pA); e2.subVectors(pC, pA);
      const cr = new THREE.Vector3().crossVectors(e1, e2);
      if (cr.length() < 1e-12) continue;
      const nv = cr.clone().normalize();
      if (nv.y < -0.1) nv.negate();
      if (nv.y < -0.5) continue;
      tris.push({ normal: nv, d: nv.dot(pA), va: pA.clone(), vb: pB.clone(), vc: pC.clone() });
    }
  });
  return tris;
}

function buildCoplanarPatches(tris) {
  const buckets = new Map();
  for (const t of tris) {
    const key = `${t.normal.x.toFixed(2)},${t.normal.y.toFixed(2)},${t.normal.z.toFixed(2)},${t.d.toFixed(2)}`;
    if (!buckets.has(key)) buckets.set(key, { normal: t.normal.clone(), d: t.d, tris: [] });
    buckets.get(key).tris.push(t);
  }
  const patches = [];
  for (const { normal, d, tris: planeTris } of buckets.values()) {
    const edgeMap = new Map();
    for (let i = 0; i < planeTris.length; i++) {
      const t = planeTris[i];
      for (const [va, vb] of [[t.va,t.vb],[t.vb,t.vc],[t.vc,t.va]]) {
        const ka = vKey(va), kb = vKey(vb);
        const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (!edgeMap.has(ek)) edgeMap.set(ek, []);
        edgeMap.get(ek).push(i);
      }
    }
    const visited = new Uint8Array(planeTris.length);
    for (let start = 0; start < planeTris.length; start++) {
      if (visited[start]) continue;
      const group = [], queue = [start];
      visited[start] = 1;
      while (queue.length) {
        const cur = queue.shift();
        group.push(planeTris[cur]);
        const t = planeTris[cur];
        for (const [va, vb] of [[t.va,t.vb],[t.vb,t.vc],[t.vc,t.va]]) {
          const ka = vKey(va), kb = vKey(vb);
          const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          for (const nb of (edgeMap.get(ek) || [])) {
            if (!visited[nb]) { visited[nb] = 1; queue.push(nb); }
          }
        }
      }
      patches.push({ normal: normal.clone(), d, tris: group });
    }
  }
  return patches;
}

function patchArea(tris) {
  let area = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
  for (const t of tris) {
    e1.subVectors(t.vb, t.va); e2.subVectors(t.vc, t.va);
    cr.crossVectors(e1, e2);
    area += cr.length() * 0.5;
  }
  return area;
}

// ── detectSurfaces ────────────────────────────────────────────────────────

export function detectSurfaces(modelGroup) {
  state.surfaces = [];
  const tris    = extractAllTriangles(modelGroup);
  const patches = buildCoplanarPatches(tris);
  const MIN_AREA = 0.1;
  let id = 0;
  for (const patch of patches) {
    const area = patchArea(patch.tris);
    if (area < MIN_AREA) continue;
    const normal = patch.normal.clone();
    const type   = classifyNormal(normal);
    if (type === 'underside') continue;
    const pts = patch.tris.flatMap(t => [t.va, t.vb, t.vc]);
    const box = new THREE.Box3();
    pts.forEach(p => box.expandByPoint(p));
    const centre = new THREE.Vector3();
    box.getCenter(centre);
    const normalAngle = Math.round(Math.acos(Math.min(1, Math.abs(normal.y))) * 180 / Math.PI);
    const geom = new THREE.BufferGeometry();
    const verts = new Float32Array(patch.tris.length * 9);
    let vi = 0;
    for (const t of patch.tris) {
      verts[vi++]=t.va.x; verts[vi++]=t.va.y; verts[vi++]=t.va.z;
      verts[vi++]=t.vb.x; verts[vi++]=t.vb.y; verts[vi++]=t.vb.z;
      verts[vi++]=t.vc.x; verts[vi++]=t.vc.y; verts[vi++]=t.vc.z;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geom.computeVertexNormals();
    const mat  = state.MAT?.[type] ?? new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.surfaceId = id;
    state.scene.add(mesh);
    state.surfaces.push({
      id, mesh, type, area,
      elevation:   parseFloat(centre.y.toFixed(2)),
      normalAngle,
      normal:      normal.clone(),
      centre:      centre.clone(),
      originalMaterial: mat,
      plants: [],
    });
    id++;
  }
  console.log(`[Surfaces] Detected ${state.surfaces.length} surfaces`);
}

// ── Surface materials ─────────────────────────────────────────────────────

export function typeMat(s) { return state.MAT?.[s.type] ?? state.MAT?.model; }

export function applyMatToSurface(s, mat) {
  if (s?.mesh) s.mesh.material = mat;
}

// ── Hover / select ────────────────────────────────────────────────────────

export function hoverSurface(s) {
  if (!s || s === state.hoveredSurface || s === state.selectedSurface) return;
  if (state.hoveredSurface && state.hoveredSurface !== state.selectedSurface) {
    applyMatToSurface(state.hoveredSurface, typeMat(state.hoveredSurface));
  }
  state.hoveredSurface = s;
  if (s !== state.selectedSurface) applyMatToSurface(s, state.MAT?.hover);
}

export function unhoverSurface(s) {
  if (!s || s !== state.hoveredSurface) return;
  state.hoveredSurface = null;
  if (s !== state.selectedSurface) applyMatToSurface(s, typeMat(s));
}

export function selectSurface(s) {
  if (state.selectedSurface && state.selectedSurface !== s) {
    applyMatToSurface(state.selectedSurface, typeMat(state.selectedSurface));
  }
  state.selectedSurface = s;
  applyMatToSurface(s, state.MAT?.selected);
  populateSurfacePanel(s);
  if (_fitSurfaceCamera)         _fitSurfaceCamera(s);
  if (_drawSurfaceCanvasOutline) _drawSurfaceCanvasOutline(s);
  showFeedback(`Selected: ${s.type} surface ${s.id} (${s.area.toFixed(1)} m\u00b2)`);
}

export function deselectSurface() {
  if (!state.selectedSurface) return;
  applyMatToSurface(state.selectedSurface, typeMat(state.selectedSurface));
  state.selectedSurface = null;
  if (_clearSurfaceCanvasOutline) _clearSurfaceCanvasOutline();
}

// ── Raycasting helper ─────────────────────────────────────────────────────

export function allSurfaceMeshes() {
  return state.surfaces.map(s => s.mesh).filter(Boolean);
}

export function getPointerNDC(e) {
  const rect = state.canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1
  );
}

// ── Surface panel ─────────────────────────────────────────────────────────

export function populateSurfacePanel(surface) {
  const panel = document.getElementById('right-panel');
  if (!panel) return;
  const el = document.getElementById('surface-detail');
  if (!el) return;

  const typeLabel = { horizontal:'Roof / Ground', wall:'Wall', sloped:'Sloped' };
  el.innerHTML = `
    <div class="surface-info">
      <div class="surface-stat"><span>Type</span><strong>${typeLabel[surface.type] ?? surface.type}</strong></div>
      <div class="surface-stat"><span>Area</span><strong>${surface.area.toFixed(1)} m\u00b2</strong></div>
      <div class="surface-stat"><span>Elevation</span><strong>${surface.elevation} m</strong></div>
      <div class="surface-stat"><span>Tilt</span><strong>${surface.normalAngle}\u00b0</strong></div>
    </div>`;
}
