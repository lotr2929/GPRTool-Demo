/*
 * state.js — Shared mutable application state for GPRTool
 *
 * Every module that needs to read or write shared application state imports
 * from here. Mutate properties directly: state.currentMode = '3d'
 *
 * ── REAL WORLD fields (real-world.js manages coordinate conversions) ──────
 * cadmapperGroup, lotBoundaryGroup, siteBoundaryLine, mapTileGroup:
 *   THREE.Group objects for scene geometry. Coordinate data stays in
 *   real-world.js; these are render-only handles.
 *
 * ── DESIGN WORLD fields ───────────────────────────────────────────────────
 * designGridManager, dgSpacing, dgMinorDivisions:
 *   Design overlays only — never store geographic coordinates here.
 */

export const state = {
  // ── THREE.js core (set once during scene init) ──────────────────────────
  THREE:      null,
  scene:      null,
  renderer:   null,
  camera3D:   null,
  camera2D:   null,
  camera:     null,      // active camera (camera2D or camera3D)
  canvas:     null,
  container:  null,
  controls3D: null,
  controls2D: null,      // stub { update:()=>{} }
  controls:   null,      // active controls (controls2D or controls3D)

  // ── Viewport ────────────────────────────────────────────────────────────
  currentMode:    '2d',    // '2d' | '3d'
  canvasMode:     'ortho', // 'ortho' | 'surface'
  pan2D:          { x: 0, z: 0 },
  zoom2D:         1,
  base2DhalfH:    50,
  rotate2D:       0,
  rotate2DActive: false,
  rotate2DLast:   { x: 0, y: 0 },
  pan2DActive:    false,
  pan2DLast:      { x: 0, y: 0 },

  // ── Site geometry — REAL WORLD render handles ────────────────────────────
  cadmapperGroup:  null,   // CADMapper context layers
  lotBoundaryGroup:null,   // Lot boundary polygon
  mapTileGroup:    null,   // Map tile overlay
  siteBoundaryLine:null,   // Site boundary line
  siteSurface:     null,   // Site surface mesh
  sitePinGroup:    null,
  // ── Terrain (AWS Terrarium / DXF topography) ──────────────────────────────
  terrainStatus:   null,   // null | 'idle' | 'fetching' | 'ready' | 'error' | 'unavailable'
  terrainPayload:  null,   // last successful terrain payload (for save/reload)
  activeFileHandle: null,  // FileSystemFileHandle from last local Save — used to re-write when background terrain attaches
  sitePinDom:      null,
  sitePinWorldPos: null,
  siteOriginLon:   0,
  siteOriginLat:   0,
  siteAreaM2:      0,   // site area in m² — GPR denominator
  terrainMesh:     null,

  // ── 3D model ─────────────────────────────────────────────────────────────
  importedModel: null,

  // ── Surfaces ─────────────────────────────────────────────────────────────
  surfaces:        [],
  hoveredSurface:  null,
  selectedSurface: null,

  // ── CAD Universe grid — REAL WORLD, never rotates ───────────────────────
  gridHelper:           null,
  gridHelperMinor:      null,
  axesHelper:           null,
  axesYLine:            null,
  manualGridSpacing:    null,
  manualMinorDivisions: null,
  _lastSiteSpan:        1000,

  // ── Design World grid ────────────────────────────────────────────────────
  designGridManager: null,
  dgSpacing:         null,
  dgMinorDivisions:  null,

  // ── Site location (Stage 1 output, consumed by Stage 2) ─────────────────
  siteCenter: null,     // {lat, lng, label} — set when Locate Site confirms

  // ── UI ───────────────────────────────────────────────────────────────────
  feedbackTimer: null,
  alarmTime:     null,
  alarmInterval: null,
  isRinging:     false,
};
