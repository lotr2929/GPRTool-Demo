/*
 * terrain.js — Terrain conforming for GPRTool
 *
 * Research-backed implementation:
 *   - Buildings: translate whole mesh so base sits at terrain Y_min under footprint
 *     (OSM-3D.org method — base height interpolated from DEM, building stays rigid)
 *   - Roads/paths/railways: per-vertex projection in world space (draped)
 *   - BVH acceleration via three-mesh-bvh (CDN) — 500 rays at 60fps
 *   - updateWorldMatrix called before all raycasting (confirmed critical by Three.js docs)
 *
 * Axis: Three.js X=East, Y=Up, Z=-North
 *
 * Exposes:
 *   initTerrainBVH(mesh)              — build BVH on terrain mesh, call once
 *   projectGroupOntoTerrain(group)    — drape roads OR snap buildings to terrain
 *   buildSiteTerrain(geojson, THREE)  — clip terrain to lot boundary
 *   clearSiteTerrain()
 *   getSiteTerrainElevation(x, z)
 */

import * as THREE from 'three';
import { state } from './state.js';
import { wgs84ToScene } from './real-world.js';
import { showFeedback } from './ui.js';

// ── Raycaster ─────────────────────────────────────────────────────────────
const _raycaster = new THREE.Raycaster();
_raycaster.ray.direction.set(0, -1, 0);

let _terrainMesh = null;

// ── BVH init — call once after terrain mesh is available ──────────────────
export function initTerrainBVH(mesh) {
  if (!mesh) return;
  _terrainMesh = mesh;
  mesh.updateWorldMatrix(true, false);

  // Apply three-mesh-bvh patch to this geometry if available
  if (window._bvhPatch) {
    const { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } = window._bvhPatch;
    mesh.geometry.computeBoundsTree   = computeBoundsTree;
    mesh.geometry.disposeBoundsTree   = disposeBoundsTree;
    mesh.raycast                      = acceleratedRaycast;
    mesh.geometry.computeBoundsTree();
    console.log('[terrain] BVH built — raycasting accelerated');
  }
}

// ── Core raycast — returns world-space Y at (worldX, worldZ) or null ─────
function _raycastY(worldX, worldZ) {
  const mesh = _terrainMesh || state.terrainMeshRef || null;
  if (!mesh) return null;
  _raycaster.ray.origin.set(worldX, 10000, worldZ);
  const hits = _raycaster.intersectObject(mesh, false);
  return hits.length ? hits[0].point.y : null;
}

// ── Public elevation query ────────────────────────────────────────────────
export function getSiteTerrainElevation(x, z, fallback = 0) {
  const y = _raycastY(x, z);
  return y !== null ? y : fallback;
}

// ── Building snap: translate whole mesh so base sits at terrain Y_min ────
// Per OSM-3D.org: "base height is interpolated from the DEM"
// Building stays rigid — only its world-space Y offset changes.
function _snapBuildingToTerrain(buildingMesh) {
  const pos = buildingMesh.geometry?.getAttribute('position');
  if (!pos) return;

  buildingMesh.updateWorldMatrix(true, false);

  // Sample footprint vertices in world space, find terrain Y_min
  const _v = new THREE.Vector3();
  let terrainYmin = Infinity;
  let geomYmin    = Infinity;

  // Sample every 3rd vertex for speed — buildings rarely have >100 base verts
  const step = Math.max(1, Math.floor(pos.count / 30));
  for (let i = 0; i < pos.count; i += step) {
    _v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    buildingMesh.localToWorld(_v);
    const ty = _raycastY(_v.x, _v.z);
    if (ty !== null && ty < terrainYmin) terrainYmin = ty;
    if (pos.getY(i) < geomYmin) geomYmin = pos.getY(i);
  }

  if (terrainYmin === Infinity || geomYmin === Infinity) return;

  // Convert geomYmin to world space to compute correct shift
  _v.set(0, geomYmin, 0);
  buildingMesh.localToWorld(_v);
  const worldGeomYmin = _v.y;

  // Shift the mesh so its base aligns with terrain minimum
  buildingMesh.position.y += (terrainYmin - worldGeomYmin);

  // Sync edge overlays — siblings in the same parent group
  const parent = buildingMesh.parent;
  if (parent) {
    parent.children.forEach(sibling => {
      if (sibling !== buildingMesh && sibling.isLineSegments) {
        sibling.position.y = buildingMesh.position.y;
      }
    });
  }
}

// ── Road/path drape: project each vertex onto terrain in world space ──────
function _drapeGroupOnTerrain(group, yOffset) {
  const _v = new THREE.Vector3();
  group.traverse(child => {
    if (!child.isMesh && !child.isLine) return;
    const pos = child.geometry?.getAttribute('position');
    if (!pos) return;
    child.updateWorldMatrix(true, false);
    let changed = false;
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      child.localToWorld(_v);
      const ty = _raycastY(_v.x, _v.z);
      if (ty !== null) {
        _v.y = ty + yOffset;
        child.worldToLocal(_v);
        pos.setY(i, _v.y);
        changed = true;
      }
    }
    if (changed) pos.needsUpdate = true;
  });
}

// ── Main export: project a layer group onto terrain ───────────────────────
export function projectGroupOntoTerrain(group) {
  const mesh = _terrainMesh || state.terrainMeshRef || null;
  if (!mesh) return;
  mesh.updateWorldMatrix(true, false);

  if (group.name === 'buildings') {
    // Buildings: rigid snap — translate whole mesh, don't distort geometry
    group.traverse(child => {
      if (child.isMesh) _snapBuildingToTerrain(child);
    });
  } else {
    // Roads, paths, railways: per-vertex drape 15cm above terrain
    _drapeGroupOnTerrain(group, 0.15);
  }
}

// ── Point-in-polygon (XZ plane) ───────────────────────────────────────────
function _pip(px, pz, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z, xj = ring[j].x, zj = ring[j].z;
    if ((zi > pz) !== (zj > pz) && px < ((xj-xi)*(pz-zi))/(zj-zi)+xi) inside = !inside;
  }
  return inside;
}

function _boundaryToRing(geojson) {
  const coords = geojson?.geometry?.coordinates?.[0];
  if (!coords) return null;
  return coords.map(([lng, lat]) => {
    const sc = wgs84ToScene(lat, lng);
    return sc ? { x: sc.x, z: sc.z } : null;
  }).filter(Boolean);
}

function _clipTopoMesh(topoMesh, ring, THREE) {
  const src = topoMesh.geometry;
  const pos = src.getAttribute('position');
  const idx = src.index;
  if (!pos || !idx) return null;

  const inside = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++)
    inside[i] = _pip(pos.getX(i), pos.getZ(i), ring) ? 1 : 0;

  const newIdx = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i+1), c = idx.getX(i+2);
    if (inside[a] && inside[b] && inside[c]) newIdx.push(a, b, c);
  }
  if (!newIdx.length) return null;

  const used = new Set(newIdx);
  const map  = new Map();
  const verts = [];
  let ni = 0;
  for (const vi of [...used].sort((a,b)=>a-b)) {
    verts.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    map.set(vi, ni++);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geom.setIndex(newIdx.map(v => map.get(v)));
  geom.computeVertexNormals();
  return geom;
}

// ── buildSiteTerrain — triggered after lot boundary is confirmed ──────────
export async function buildSiteTerrain(boundaryGeojson, THREE) {
  const ring = _boundaryToRing(boundaryGeojson);
  if (!ring) { console.warn('[terrain] No boundary ring'); return; }

  const ctxGroup = state.cadmapperGroup;
  if (!ctxGroup) { console.warn('[terrain] No context group'); return; }

  let topoMesh = null;
  ctxGroup.traverse(c => { if (c.isMesh && c.parent?.name === 'topography' && !topoMesh) topoMesh = c; });
  if (!topoMesh) { showFeedback('No terrain data in site context'); return; }

  showFeedback('Clipping terrain to lot boundary\u2026', 0);
  const clippedGeom = _clipTopoMesh(topoMesh, ring, THREE);
  if (!clippedGeom) { showFeedback('Terrain clip failed — does boundary cover terrain area?'); return; }

  clearSiteTerrain();

  _terrainMesh = new THREE.Mesh(clippedGeom,
    new THREE.MeshBasicMaterial({
      color: 0xd4c8a8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
  _terrainMesh.name = 'site-terrain';

  // Build BVH on clipped mesh for fast raycasting
  if (clippedGeom.computeBoundsTree) clippedGeom.computeBoundsTree();

  const edges = new THREE.EdgesGeometry(clippedGeom, 10);
  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'site-terrain-group';
  terrainGroup.add(_terrainMesh);
  terrainGroup.add(new THREE.LineSegments(edges,
    new THREE.LineBasicMaterial({ color: 0xa09070, opacity: 0.5, transparent: true })));
  state.scene.add(terrainGroup);
  state.siteTerrainGroup = terrainGroup;
  _buildTerrainLayerRow(terrainGroup);

  showFeedback('Site terrain ready');
}

export function clearSiteTerrain() {
  if (state.siteTerrainGroup) {
    state.scene.remove(state.siteTerrainGroup);
    state.siteTerrainGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    state.siteTerrainGroup = null;
  }
  _terrainMesh = null;
}

function _buildTerrainLayerRow(group) {
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
  cb.addEventListener('change', () => { group.visible = cb.checked; });
  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#d4c8a8;border:1px solid #a09070;';
  const name = document.createElement('span');
  name.style.cssText = 'flex:1;font-size:12px;'; name.textContent = 'Site Terrain';
  label.append(cb, dot, name);
  row.appendChild(label);
  section.appendChild(row);
}
