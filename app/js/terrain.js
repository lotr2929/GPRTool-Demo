/*
 * terrain.js — Site terrain mesh: clip topography to lot boundary,
 *              project flat layers onto terrain surface, store in .gpr
 *
 * Called after lot boundary is confirmed.
 *
 * Axis convention: Three.js X=East, Y=Up(elevation), Z=-North
 * All scene coordinates follow real-world.js convention.
 *
 * Exposes:
 *   buildSiteTerrain(boundaryGeojson)  → clips topo mesh, projects layers, saves to .gpr
 *   getSiteTerrainElevation(x, z)      → returns Y elevation at scene XZ point (raycasting)
 *   projectGroupOntoTerrain(group)     → moves all vertices of a Three.js group to terrain Y
 */

import * as THREE from 'three';
import { state } from './state.js';
import { wgs84ToScene } from './real-world.js';
import { showFeedback } from './ui.js';

// ── Terrain raycaster — shared instance ──────────────────────────────────
const _raycaster = new THREE.Raycaster();
_raycaster.ray.direction.set(0, -1, 0); // cast downward

let _terrainMesh = null;   // the clipped site terrain mesh (THREE.Mesh)
let _bvh         = null;   // Three.js built-in BVH (via computeBoundsTree if available)

// ── Public: get elevation at scene XZ ────────────────────────────────────
export function getSiteTerrainElevation(x, z, fallback = 0) {
  const mesh = _terrainMesh || state.terrainMeshRef || null;
  if (!mesh) return fallback;
  mesh.updateWorldMatrix(true, false); // ensure world matrix is current
  _raycaster.ray.origin.set(x, 1000, z);
  const hits = _raycaster.intersectObject(mesh, false);
  return hits.length ? hits[0].point.y : fallback;
}

// ── Point-in-polygon test (2D, XZ plane) ─────────────────────────────────
function pointInPolygon(px, pz, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z;
    const xj = ring[j].x, zj = ring[j].z;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

// ── Convert GeoJSON boundary ring to scene-space XZ ring ─────────────────
function boundaryToSceneRing(boundaryGeojson) {
  const coords = boundaryGeojson?.geometry?.coordinates?.[0];
  if (!coords) return null;
  return coords.map(([lng, lat]) => {
    const sc = wgs84ToScene(lat, lng);
    return sc ? { x: sc.x, z: sc.z } : null;
  }).filter(Boolean);
}

// ── Clip topography BufferGeometry to boundary ring ───────────────────────
function clipTopoMesh(topoMesh, ring, THREE) {
  const srcGeom = topoMesh.geometry;
  const pos     = srcGeom.getAttribute('position');
  const idx     = srcGeom.index;
  if (!pos || !idx) return null;

  // Classify each vertex: inside boundary?
  const inside = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    inside[i] = pointInPolygon(pos.getX(i), pos.getZ(i), ring) ? 1 : 0;
  }

  // Keep triangles where all 3 vertices are inside
  const newIdx = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i+1), c = idx.getX(i+2);
    if (inside[a] && inside[b] && inside[c]) newIdx.push(a, b, c);
  }
  if (!newIdx.length) return null;

  // Build new compact geometry with only used vertices
  const usedVerts = new Set(newIdx);
  const oldToNew  = new Map();
  const newPos    = [];
  let ni = 0;
  for (const vi of [...usedVerts].sort((a,b) => a-b)) {
    newPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    oldToNew.set(vi, ni++);
  }
  const remapped = newIdx.map(v => oldToNew.get(v));

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
  geom.setIndex(remapped);
  geom.computeVertexNormals();
  return geom;
}


// ── Project flat layer group vertices onto terrain ────────────────────────
export function projectGroupOntoTerrain(group) {
  const mesh = _terrainMesh || state.terrainMeshRef || null;
  if (!mesh) return;

  mesh.updateWorldMatrix(true, false);

  if (group.name === 'buildings') {
    // Buildings: find Y_min under footprint, translate whole mesh down
    group.traverse(child => {
      if (!child.isMesh) return;
      const pos = child.geometry?.getAttribute('position');
      if (!pos) return;

      // Find XZ extent and minimum terrain Y under this building
      let yMin = Infinity;
      const step = Math.max(1, Math.floor(pos.count / 20)); // sample up to 20 points
      for (let i = 0; i < pos.count; i += step) {
        const x = pos.getX(i), z = pos.getZ(i);
        const y = _raycastTerrain(mesh, x, z);
        if (y !== null && y < yMin) yMin = y;
      }
      if (yMin === Infinity) return;

      // Find current base Y of this mesh (min Y of geometry)
      let geomMinY = Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < geomMinY) geomMinY = pos.getY(i);
      }

      // Translate the mesh so its base sits at yMin
      const shift = yMin - geomMinY;
      child.position.y += shift;
    });
  } else {
    // Roads, paths, parks, water, railways: vertex-by-vertex projection
    group.traverse(child => {
      if (!child.isMesh && !child.isLine) return;
      const pos = child.geometry?.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const y = _raycastTerrain(mesh, x, z);
        if (y !== null) pos.setY(i, y + 0.15); // 15cm above terrain — clears Z-fighting
      }
      pos.needsUpdate = true;
    });
  }
}

function _raycastTerrain(mesh, x, z) {
  _raycaster.ray.origin.set(x, 1000, z);
  const hits = _raycaster.intersectObject(mesh, false);
  return hits.length ? hits[0].point.y : null;
}

// ── Build site terrain — main entry point ────────────────────────────────
export async function buildSiteTerrain(boundaryGeojson, THREE) {
  const ring = boundaryToSceneRing(boundaryGeojson);
  if (!ring) { console.warn('[terrain] No boundary ring'); return; }

  // Find topography mesh in the scene context group
  const ctxGroup = state.cadmapperGroup;
  if (!ctxGroup) { console.warn('[terrain] No context group'); return; }

  let topoGroup = null;
  ctxGroup.children.forEach(child => {
    if (child.name === 'topography') topoGroup = child;
  });

  if (!topoGroup) { showFeedback('No terrain data in site context'); return; }

  // Find the first mesh in the topography group
  let topoMesh = null;
  topoGroup.traverse(child => { if (child.isMesh && !topoMesh) topoMesh = child; });
  if (!topoMesh) { showFeedback('No terrain mesh found'); return; }

  showFeedback('Clipping terrain to lot boundary\u2026', 0);

  // Clip mesh
  const clippedGeom = clipTopoMesh(topoMesh, ring, THREE);
  if (!clippedGeom) { showFeedback('Terrain clip produced no geometry — check boundary covers terrain'); return; }

  // Remove any existing site terrain
  clearSiteTerrain();

  // Create terrain mesh
  _terrainMesh = new THREE.Mesh(clippedGeom,
    new THREE.MeshBasicMaterial({
      color: 0xd4c8a8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })
  );
  _terrainMesh.name = 'site-terrain';

  // Edge overlay
  const edges    = new THREE.EdgesGeometry(clippedGeom, 10);
  const edgeMesh = new THREE.LineSegments(edges,
    new THREE.LineBasicMaterial({ color: 0xa09070, opacity: 0.5, transparent: true }));

  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'site-terrain-group';
  terrainGroup.add(_terrainMesh);
  terrainGroup.add(edgeMesh);
  state.scene.add(terrainGroup);
  state.siteTerrainGroup = terrainGroup;

  // Add to layer panel
  _buildTerrainLayerRow(terrainGroup);

  // Project flat layers onto terrain
  showFeedback('Projecting layers onto terrain\u2026', 0);
  ctxGroup.children.forEach(child => {
    const name = child.name;
    if (name === 'topography') return; // skip source
    if (['highways','major_roads','minor_roads','paths','railways','parks','water','contours'].includes(name)) {
      projectGroupOntoTerrain(child);
    }
  });

  showFeedback('Site terrain ready \u2014 draw lot boundary complete');
}

export function clearSiteTerrain() {
  if (state.siteTerrainGroup) {
    state.scene.remove(state.siteTerrainGroup);
    state.siteTerrainGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    state.siteTerrainGroup = null;
  }
  _terrainMesh = null;
}

// ── Terrain layer row in right panel ─────────────────────────────────────
function _buildTerrainLayerRow(terrainGroup) {
  document.getElementById('site-terrain-layer-row')?.remove();
  const section = document.getElementById('cadmapper-layer-section');
  if (!section) return;

  const row = document.createElement('div');
  row.id = 'site-terrain-layer-row'; row.className = 'info-row';
  const label = document.createElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;width:100%;';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = true;
  cb.style.cssText = 'accent-color:var(--accent-mid,#4a8a4a);';
  cb.addEventListener('change', () => { terrainGroup.visible = cb.checked; });
  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#d4c8a8;border:1px solid #a09070;';
  const name = document.createElement('span');
  name.style.cssText = 'flex:1;font-size:12px;'; name.textContent = 'Site Terrain';
  label.append(cb, dot, name);
  row.appendChild(label);
  section.appendChild(row);
}
