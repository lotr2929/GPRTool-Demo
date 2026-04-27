/*
 * gpr-file.js — .gpr project file writer and reader for GPRTool
 *
 * A .gpr file is a ZIP archive (renamed to .gpr) containing:
 *   manifest.json       — identity, format version, sections present
 *   reference.json      — UTM anchor + WGS84 + scene offset  [REAL WORLD]
 *   design.json         — designNorthAngle, grid settings     [DESIGN WORLD]
 *   boundary.geojson    — lot boundary polygon (added after picker)
 *   context/
 *     cadmapper.dxf     — original DXF file (embedded for re-import)
 *
 * Storage: IndexedDB ('gprtool_projects' DB, 'projects' store).
 * Requires: window.JSZip (loaded via CDN <script> tag before this module).
 *
 * ── REAL WORLD RULE ───────────────────────────────────────────────────────
 * reference.json and boundary.geojson contain geographic data.
 * design.json contains only design parameters — no coordinates.
 * They are NEVER mixed.
 */

const FORMAT_VERSION = 1;
const TOOL_VERSION   = '0.1.0';
const DB_NAME        = 'gprtool_projects';
const DB_VERSION     = 1;
const STORE          = 'projects';

// ── IndexedDB helpers ─────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = e => reject(e.target.error);
  });
}

async function idbPut(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, blob, updated: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function idbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = e => resolve(e.target.result?.blob ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Active project state ──────────────────────────────────────────────────
// The current open project — kept in memory so we can update it incrementally
// without re-reading the IndexedDB blob each time.

let _activeProjectId  = null;
let _activeZip        = null;   // JSZip instance of the open project

export function getActiveProjectId() { return _activeProjectId; }

/**
 * Get the current active .gpr as a Blob (for uploading to project repository).
 * Returns null if no active project.
 */
export async function getActiveGPRBlob() {
  if (!_activeZip) return null;
  return _activeZip.generateAsync({ type: 'blob', compression: 'DEFLATE',
    compressionOptions: { level: 6 } });
}

// ── Create a new .gpr from a CADMapper import ─────────────────────────────

/**
 * Create an initial .gpr file from a CADMapper import.
 * Saves to IndexedDB. Sets the active project.
 *
 * @param {Object} params
 * @param {string}       params.siteName     - Display name (from DXF filename)
 * @param {Object}       params.reference    - { utm_zone, utm_easting, utm_northing,
 *                                              utm_hemisphere, wgs84_lat, wgs84_lng,
 *                                              scene_offset_x, scene_offset_z, site_span_m }
 * @param {Object}       params.design       - { design_north_angle, grid_spacing_m, minor_divisions }
 * @param {File|null}    params.dxfFile      - Original DXF File object (embedded for re-import)
 * @returns {Promise<string>} projectId
 */
export async function createInitialGPR({ siteName, reference, design, dxfFile = null, osmGeoJSON = null }) {
  if (!window.JSZip) throw new Error('JSZip not loaded');

  const now    = new Date().toISOString();
  const id     = 'gpr-' + Date.now();
  const source = dxfFile ? 'cadmapper' : osmGeoJSON ? 'osm' : 'unknown';

  const sections = ['manifest', 'reference', 'design'];
  if (dxfFile)    sections.push('context/cadmapper.dxf');
  if (osmGeoJSON) sections.push('context.geojson');

  const manifest = {
    format_version: FORMAT_VERSION,
    tool_version:   TOOL_VERSION,
    created:        now,
    modified:       now,
    site_name:      siteName,
    source,
    sections,
  };

  const zip = new window.JSZip();
  zip.file('manifest.json',  JSON.stringify(manifest,  null, 2));
  zip.file('reference.json', JSON.stringify(reference, null, 2));
  zip.file('design.json',    JSON.stringify(design,    null, 2));

  if (dxfFile) {
    const dxfBytes = await dxfFile.arrayBuffer();
    zip.folder('context').file('cadmapper.dxf', dxfBytes);
  }
  if (osmGeoJSON) {
    zip.file('context.geojson', JSON.stringify(osmGeoJSON, null, 2));
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE',
    compressionOptions: { level: 6 } });

  await idbPut(id, blob);

  _activeProjectId = id;
  _activeZip       = zip;

  console.log(`[GPR] Project created: ${id} (${(blob.size / 1024).toFixed(0)} KB)`);
  return id;
}

// ── Add or replace boundary.geojson in the active project ─────────────────

/**
 * Add or update the lot boundary in the active project.
 * @param {Object} geojson - GeoJSON Polygon feature (WGS84)
 */
export async function addBoundaryToGPR(geojson) {
  if (!_activeZip || !_activeProjectId) throw new Error('No active project');

  _activeZip.file('boundary.geojson', JSON.stringify(geojson, null, 2));

  // Update manifest sections list
  const manifestStr = await _activeZip.file('manifest.json').async('string');
  const manifest = JSON.parse(manifestStr);
  if (!manifest.sections.includes('boundary')) manifest.sections.push('boundary');
  manifest.modified = new Date().toISOString();
  _activeZip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await _activeZip.generateAsync({ type: 'blob', compression: 'DEFLATE',
    compressionOptions: { level: 6 } });
  await idbPut(_activeProjectId, blob);

  console.log(`[GPR] Boundary added to ${_activeProjectId}`);
}

// ── Add or replace terrain.json in the active project ─────────────────────

/**
 * Add or update the terrain payload in the active project.
 * @param {Object} payload - { source, zoom, intervalM, anchorX, anchorY, points, contourSegments }
 */
export async function addTerrainToGPR(payload) {
  if (!_activeZip || !_activeProjectId) throw new Error('No active project');

  _activeZip.file('terrain.json', JSON.stringify(payload));

  const manifestStr = await _activeZip.file('manifest.json').async('string');
  const manifest = JSON.parse(manifestStr);
  if (!manifest.sections.includes('terrain')) manifest.sections.push('terrain');
  manifest.modified = new Date().toISOString();
  _activeZip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await _activeZip.generateAsync({ type: 'blob', compression: 'DEFLATE',
    compressionOptions: { level: 6 } });
  await idbPut(_activeProjectId, blob);

  const ptCount  = payload.points?.length ?? 0;
  const segCount = (payload.contourSegments?.length ?? 0) / 6;
  console.log(`[GPR] Terrain added to ${_activeProjectId} (${ptCount} pts, ${segCount} contour segs)`);
}

/**
 * Read terrain.json from the active project, returns parsed payload or null.
 */
export async function getTerrainFromGPR() {
  if (!_activeZip) return null;
  const entry = _activeZip.file('terrain.json');
  if (!entry) return null;
  try {
    return JSON.parse(await entry.async('string'));
  } catch (e) {
    console.warn('[GPR] terrain.json parse failed:', e);
    return null;
  }
}

// ── Open a .gpr file ──────────────────────────────────────────────────────

/**
 * Open a .gpr File object. Returns parsed contents.
 * Sets the active project.
 *
 * @param {File} file
 * @returns {Promise<{ manifest, reference, design, boundary|null, hasDXF }>}
 */
export async function openGPR(file) {
  if (!window.JSZip) throw new Error('JSZip not loaded');

  const zip = await window.JSZip.loadAsync(file);

  const manifest  = JSON.parse(await zip.file('manifest.json').async('string'));
  const reference = JSON.parse(await zip.file('reference.json').async('string'));
  const design    = JSON.parse(await zip.file('design.json').async('string'));

  const boundaryFile = zip.file('boundary.geojson');
  const boundary = boundaryFile
    ? JSON.parse(await boundaryFile.async('string'))
    : null;

  const terrainFile = zip.file('terrain.json');
  const terrain = terrainFile
    ? JSON.parse(await terrainFile.async('string'))
    : null;

  const hasDXF = !!zip.file('context/cadmapper.dxf');

  // Store as active project
  const id = 'gpr-opened-' + Date.now();
  const blob = await zip.generateAsync({ type: 'blob' });
  await idbPut(id, blob);
  _activeProjectId = id;
  _activeZip       = zip;

  return { manifest, reference, design, boundary, terrain, hasDXF, zip };
}

// ── Get DXF bytes from active project (for re-import) ────────────────────

export async function getDXFFromGPR() {
  if (!_activeZip) return null;
  const entry = _activeZip.file('context/cadmapper.dxf');
  if (!entry) return null;
  const bytes = await entry.async('arraybuffer');
  return new File([bytes], 'cadmapper.dxf', { type: 'application/octet-stream' });
}

// ── Download the active .gpr ──────────────────────────────────────────────

export async function downloadGPR(filename) {
  if (!_activeZip) throw new Error('No active project');

  const blob = await _activeZip.generateAsync({ type: 'blob', compression: 'DEFLATE',
    compressionOptions: { level: 6 } });

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = (filename ?? 'project') + '.gpr';
  a.click();
  URL.revokeObjectURL(url);
}
