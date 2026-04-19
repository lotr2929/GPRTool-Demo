/*
 * geo.js — Geographic utilities and map tile overlay for GPRTool
 *
 * Covers: lat/lon ↔ metres conversion, GeoJSON helpers, OpenStreetMap tile overlay.
 * No THREE.js geometry — tile meshes are built here but use THREE imported directly.
 *
 * Call initGeo({ onMapCleared }) once after the scene is ready.
 * onMapCleared() is called when clearMapTiles removes the tile group so the
 * caller (app.js) can restore grid visibility without a circular import.
 */

import * as THREE from 'three';
import { state } from './state.js';

// ── Map tile constants ────────────────────────────────────────────────────
const MAP_ZOOM    = 18;
const TILE_SERVER = 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

let _onMapCleared = null;

export function initGeo({ onMapCleared } = {}) {
  _onMapCleared = onMapCleared ?? null;
}

// ── Lat/lon ↔ metres ──────────────────────────────────────────────────────

export function latlonToMetres(lon, lat, cLon, cLat) {
  const x =  (lon - cLon) * Math.cos(cLat * Math.PI / 180) * 111320;
  const z = -(lat - cLat) * 111320;
  return [x, z];
}

// ── GeoJSON helpers ───────────────────────────────────────────────────────

export function extractCoordinates(geojson) {
  const features = geojson.features || [geojson];
  for (const f of features) {
    const g = f.geometry || f;
    if (g.type === 'Polygon')      return g.coordinates[0];
    if (g.type === 'MultiPolygon') return g.coordinates[0][0];
  }
  return null;
}

export function computeBBox(coords) {
  const lons = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return {
    west:  Math.min(...lons), east:  Math.max(...lons),
    south: Math.min(...lats), north: Math.max(...lats),
    cLon: (Math.min(...lons) + Math.max(...lons)) / 2,
    cLat: (Math.min(...lats) + Math.max(...lats)) / 2,
  };
}

export function computePolygonArea(coords) {
  const bbox = computeBBox(coords);
  const pts  = coords.map(c => latlonToMetres(c[0], c[1], bbox.cLon, bbox.cLat));
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(area / 2);
}

export function computePolygonPerimeter(coords) {
  const bbox = computeBBox(coords);
  let perim = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, z1] = latlonToMetres(coords[i][0],   coords[i][1],   bbox.cLon, bbox.cLat);
    const [x2, z2] = latlonToMetres(coords[i+1][0], coords[i+1][1], bbox.cLon, bbox.cLat);
    perim += Math.hypot(x2 - x1, z2 - z1);
  }
  return perim;
}

// ── Map tile overlay ──────────────────────────────────────────────────────

function lonToTileX(lon, z) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, z));
}
function latToTileY(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
}
function tileXToLon(tx, z) { return tx / Math.pow(2, z) * 360 - 180; }
function tileYToLat(ty, z) {
  const n = Math.PI - 2 * Math.PI * ty / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function mercatorY(lat) {
  const rad = lat * Math.PI / 180;
  return 6378137 * Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

export function loadMapTiles(bbox) {
  clearMapTiles();
  state.mapTileGroup = new THREE.Group();
  state.mapTileGroup.name = 'map-tiles';
  state.scene.add(state.mapTileGroup);

  const z    = MAP_ZOOM;
  const txMn = lonToTileX(bbox.west,  z) - 1;
  const txMx = lonToTileX(bbox.east,  z) + 1;
  const tyMn = latToTileY(bbox.north, z) - 1;
  const tyMx = latToTileY(bbox.south, z) + 1;

  for (let tx = txMn; tx <= txMx; tx++) {
    for (let ty = tyMn; ty <= tyMx; ty++) {
      loadOneTile(tx, ty, z, bbox);
    }
  }

  const toggle = document.getElementById('mapOverlayToggle');
  if (toggle) state.mapTileGroup.visible = toggle.checked;
}

function loadOneTile(tx, ty, z, bbox) {
  const url = TILE_SERVER.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
  const west  = tileXToLon(tx,     z);
  const east  = tileXToLon(tx + 1, z);
  const north = tileYToLat(ty,     z);
  const south = tileYToLat(ty + 1, z);
  const cosLat = Math.cos(bbox.cLat * Math.PI / 180) * 111320;
  const mYc    = mercatorY(bbox.cLat);
  const x0 =  (west  - bbox.cLon) * cosLat;
  const x1 =  (east  - bbox.cLon) * cosLat;
  const z0 = -(mercatorY(north) - mYc) * Math.cos(bbox.cLat * Math.PI / 180);
  const z1 = -(mercatorY(south) - mYc) * Math.cos(bbox.cLat * Math.PI / 180);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w  = Math.abs(x1 - x0);
  const h  = Math.abs(z1 - z0);
  new THREE.TextureLoader().load(url, texture => {
    if (!state.mapTileGroup) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    const geom = new THREE.PlaneGeometry(w, h);
    const mat  = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, -0.15, cz);
    mesh.renderOrder = -2;
    state.mapTileGroup.add(mesh);
  }, undefined, () => {});
}

export function clearMapTiles() {
  if (!state.mapTileGroup) return;
  state.mapTileGroup.children.forEach(c => {
    c.geometry?.dispose();
    c.material?.map?.dispose();
    c.material?.dispose();
  });
  state.scene.remove(state.mapTileGroup);
  state.mapTileGroup = null;
  if (_onMapCleared) _onMapCleared();
}
