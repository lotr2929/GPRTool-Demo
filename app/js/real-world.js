/*
 * real-world.js — Real World coordinate anchor for GPRTool
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE RULE — CAST IN STONE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * All geographic data (CADMapper DXF, OSM, lot boundary, Landgate SLIP,
 * Google Maps lot lines) is anchored to the Real World through THIS MODULE.
 *
 * REAL WORLD data is ALWAYS stored in WGS84 (lat/lng) or UTM with an
 * explicit zone. It NEVER moves, rotates, or gets reinterpreted.
 *
 * The Three.js scene space is LOCAL. The anchor bridges the two:
 *
 *   scene(0, 0, 0)  ==  UTM(anchor.easting + sceneOffset.x,
 *                            anchor.northing + sceneOffset.z)
 *
 * DESIGN WORLD data (designNorthAngle, Design Grids) is managed by
 * design-grid.js and north-point-2d.js. It is an OVERLAY applied in scene
 * space. It has NO interaction with this module.
 *
 * ── BOUNDARY RULE ──────────────────────────────────────────────────────────
 *  ✓  Real World modules  →  may import from real-world.js
 *  ✗  Design World modules →  must NOT import from real-world.js
 *  ✗  real-world.js        →  must NOT import from design-grid.js or
 *                              north-point-2d.js
 *
 * ════════════════════════════════════════════════════════════════════════════
 * AXIS MAPPING (DXF → Three.js)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * CADMapper exports DXF in UTM local metres (origin = user-entered UTM point):
 *   DXF X  =  Easting  offset (metres, East positive)
 *   DXF Y  =  Northing offset (metres, North positive in UTM)
 *   DXF Z  =  Elevation (metres above datum)
 *
 * parseMeshBlock maps them to Three.js (Y-up):
 *   Three.X  =  DXF X   (East)
 *   Three.Y  =  DXF Z   (Up)
 *   Three.Z  =  DXF Y   (North — note: Three +Z = CADMapper North direction)
 *
 * ⚠ This differs from the abstract CAD Universe convention (-Z = True North).
 * The import code is authoritative. Do not swap signs without testing imports.
 *
 * Scene–UTM conversion therefore:
 *   UTM easting  = anchor.easting  + sceneOffset.x + scene.x
 *   UTM northing = anchor.northing + sceneOffset.z + scene.z
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

// ── Real World anchor ──────────────────────────────────────────────────────
// Set once when a site is loaded (CADMapper, OSM, or .gpr open).
// { zone:number, easting:number, northing:number, hemisphere:'N'|'S', lat:number, lng:number }
let _anchor = null;

// ── Scene centering offset ─────────────────────────────────────────────────
// When DXF geometry is centred in the Three.js scene, children are shifted by
// (-centroid.x, -centroid.z). This offset is stored here so that any scene
// coordinate can be converted back to UTM / WGS84 accurately.
// Units: metres (same as scene units).
let _sceneOffset = { x: 0, z: 0 };

// ── Anchor API ─────────────────────────────────────────────────────────────

/**
 * Set the Real World anchor from a UTM origin.
 * Called by cadmapper-import.js after the user enters UTM values.
 * Also called by the OSM select-map command and .gpr file loader.
 *
 * @param {number} zone       - UTM zone number (1–60)
 * @param {number} easting    - UTM easting in metres
 * @param {number} northing   - UTM northing in metres (negative for southern hemisphere)
 */
export function setRealWorldAnchor(zone, easting, northing) {
  const hemisphere = northing < 0 ? 'S' : 'N';
  const { lat, lng } = utmToWGS84(easting, northing, zone, hemisphere);
  _anchor = { zone, easting, northing, hemisphere, lat, lng };
}

/** @returns {{ zone, easting, northing, hemisphere, lat, lng } | null} */
export function getRealWorldAnchor() {
  return _anchor ? { ..._anchor } : null;
}

/** True if a Real World anchor has been set. */
export function hasRealWorldAnchor() {
  return _anchor !== null;
}

/** Clear the anchor (e.g. when loading a new project). */
export function clearRealWorldAnchor() {
  _anchor = null;
  _sceneOffset = { x: 0, z: 0 };
}

// ── Scene offset API ───────────────────────────────────────────────────────

/**
 * Record the centering correction applied to imported DXF geometry.
 * Call this immediately after centring the cadmapperGroup in onLayersLoaded.
 *
 * @param {number} x - centre.x subtracted from child positions (metres)
 * @param {number} z - centre.z subtracted from child positions (metres)
 */
export function setSceneOffset(x, z) {
  _sceneOffset = { x, z };
}

/** @returns {{ x:number, z:number }} */
export function getSceneOffset() {
  return { ..._sceneOffset };
}

// ── Coordinate conversions ─────────────────────────────────────────────────

/**
 * Convert UTM coordinates to WGS84 (lat/lng).
 * Accurate to ~1 mm within the UTM zone.
 *
 * @param {number} easting     - UTM easting (metres)
 * @param {number} northing    - UTM northing (metres)
 * @param {number} zone        - UTM zone (1–60)
 * @param {string} hemisphere  - 'N' or 'S'
 * @returns {{ lat:number, lng:number }}
 */
export function utmToWGS84(easting, northing, zone, hemisphere = 'N') {
  const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = 2 * f - f * f;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const n2 = e2 / (1 - e2);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;

  const x = easting - 500000;
  // CADMapper convention: southern hemisphere northing is given as a negative offset
  // from the equator (e.g. -3535933 for Perth). Standard UTM stores this as a positive
  // value with 10,000,000 false northing added (e.g. 6464067). Both forms are handled:
  //   CADMapper-style (northing < 0):  use directly — already the signed meridional arc
  //   Standard UTM S  (northing > 0):  subtract 10,000,000 to get signed meridional arc
  const y = (northing < 0) ? northing : (hemisphere === 'S' ? northing - 10000000 : northing);

  const M   = y / k0;
  const mu  = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64));

  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const sinP1 = Math.sin(phi1), cosP1 = Math.cos(phi1), tanP1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinP1 * sinP1);
  const T1 = tanP1 * tanP1;
  const C1 = n2 * cosP1 * cosP1;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinP1 * sinP1, 1.5);
  const D  = x / (N1 * k0);

  const lat = phi1 - (N1 * tanP1 / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * n2) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * n2 - 3 * C1 * C1)
      * D * D * D * D * D * D / 720
  );
  const lng = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * n2 + 24 * T1 * T1)
      * D * D * D * D * D / 120
  ) / cosP1;

  return { lat: lat * 180 / Math.PI, lng: lng * 180 / Math.PI };
}

/**
 * Convert WGS84 (lat/lng) to UTM coordinates.
 * Accurate to ~1 mm within the UTM zone.
 * (Moved here from cadmapper-import.js — single source of truth.)
 *
 * @param {number} lat  - Latitude in decimal degrees
 * @param {number} lng  - Longitude in decimal degrees
 * @param {number} zone - UTM zone (1–60)
 * @returns {{ easting:number, northing:number }}
 */
export function wgs84ToUTM(lat, lng, zone) {
  const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = 2 * f - f * f, n2 = e2 / (1 - e2);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;

  const phi = lat * Math.PI / 180, lam = lng * Math.PI / 180 - lon0;
  const sinP = Math.sin(phi), cosP = Math.cos(phi), tanP = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinP * sinP);
  const T = tanP * tanP, C = n2 * cosP * cosP, A = cosP * lam;
  const M = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256) * Math.sin(4 * phi)
  );
  const easting  = k0 * N * (A + (1 - T + C) * A * A * A / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * n2) * A * A * A * A * A / 120) + 500000;
  const northing = k0 * (M + N * tanP * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * n2) * A * A * A * A * A * A / 720))
    + (lat < 0 ? 10000000 : 0);
  return { easting, northing };
}

// ── Scene ↔ Real World conversions ────────────────────────────────────────

/**
 * Convert a Three.js scene point to UTM coordinates.
 * Requires setRealWorldAnchor() and setSceneOffset() to have been called.
 *
 * @param {number} sceneX
 * @param {number} sceneZ
 * @returns {{ easting:number, northing:number, zone:number, hemisphere:string } | null}
 */
export function sceneToUTM(sceneX, sceneZ) {
  if (!_anchor) return null;
  return {
    easting:    _anchor.easting    + _sceneOffset.x + sceneX,
    northing:   _anchor.northing   - _sceneOffset.z - sceneZ,
    zone:       _anchor.zone,
    hemisphere: _anchor.hemisphere,
  };
}

/**
 * Convert UTM coordinates to a Three.js scene point.
 * Inverse of sceneToUTM.
 *
 * @returns {{ x:number, z:number } | null}
 */
export function utmToScene(easting, northing) {
  if (!_anchor) return null;
  return {
    x: easting  - _anchor.easting  - _sceneOffset.x,
    z: -(northing - _anchor.northing) - _sceneOffset.z,
  };
}

/**
 * Convert a Three.js scene point to WGS84 (lat/lng).
 * Requires anchor and scene offset to be set.
 *
 * @returns {{ lat:number, lng:number } | null}
 */
export function sceneToWGS84(sceneX, sceneZ) {
  const utm = sceneToUTM(sceneX, sceneZ);
  if (!utm) return null;
  return utmToWGS84(utm.easting, utm.northing, utm.zone, utm.hemisphere);
}

/**
 * Convert WGS84 (lat/lng) to a Three.js scene point.
 * Requires anchor and scene offset to be set.
 *
 * @returns {{ x:number, z:number } | null}
 */
export function wgs84ToScene(lat, lng) {
  if (!_anchor) return null;
  const utm = wgs84ToUTM(lat, lng, _anchor.zone);
  return utmToScene(utm.easting, utm.northing);
}
