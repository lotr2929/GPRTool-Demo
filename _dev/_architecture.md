# GPRTool Architecture — Session Reference
_Written: 21 Apr 2026. Update this when architecture changes._

---

## Module Map

### Entry point
- `index.html` — loads CDN scripts (CesiumJS, JSZip, BVH), then `app.js` as ES module
- `app.js` — monolithic orchestrator (~1650 lines). Imports all modules, wires events, owns the render loop

### Two rendering states (NEVER concurrent)
GPRTool has exactly two viewport states. One at a time, no overlap.

| State | Active when | Controls |
|---|---|---|
| **Cesium** | App loads; before OSM import | `cesium-viewer.js` |
| **Three.js** | After OSM/CADMapper import | `app.js` render loop |

Switch functions in `cesium-viewer.js`:
- `showCesiumView()` — shows `#cesium-container`, hides `#three-canvas`, `#np-container`, `.mode-toggle-container`, gizmoOverlay
- `showThreeJSView()` — shows `#three-canvas`, hides `#cesium-container`. Does NOT touch NPoint — let NP modules manage themselves.

### Viewport DOM (`body.html` → `#viewport`)
```
#viewport (position:relative, overflow:hidden, isolation:isolate)
  #cesium-container   (position:absolute, inset:0) ← Cesium globe
  #three-canvas       (position:absolute, inset:0) ← Three.js WebGL canvas
  #np-container       (SVG NPoint 2D, bottom-right) ← north-point-2d.js
  #np-ctx-menu        (context menu for NPoint)
  .mode-toggle-container  (top-right, z-index:1000) ← 2D/3D buttons
  gizmoOverlay div    (injected by north-point-3d.js into #viewport)
```

**Key z-index rule**: Cesium widget creates its own stacking context. `.mode-toggle-container` must be hidden when Cesium is active — NOT fought with z-index.

---

## North Point — DO NOT CORRUPT

Two separate systems, both in `#viewport`:

### NPoint 2D (`north-point-2d.js` + `#np-container` SVG in body.html)
- SVG compass — housing ring + TN needle
- Draggable/resizable via mouse events
- Visible: Two.js mode only
- Shows in BOTH 2D and 3D Three.js modes
- Rotates based on `designNorthAngle` and `globalNorthAngle`
- `initNorthPoint2D(getState)` wired in `app.js`

### Gizmo 3D (`north-point-3d.js` + `gizmoOverlay` div injected at init)
- Canvas texture rendered via scissor into Three.js `_compassScene`
- `gizmoOverlay` div = click/drag target only (no visual content in div itself)
- Visible: Three.js 3D mode ONLY (`currentMode === '3d'`)
- `updateGizmoOverlay()` must be called from `switchMode()` in `viewport.js`
- `renderCompassGizmo()` must be called every frame in 3D mode

**Rule**: Never modify either NP module. Only control visibility via showCesiumView/showThreeJSView.

---

## Coordinate Systems — LOCKED

### Real World (real-world.js)
- All geographic data in WGS84 or UTM with explicit zone
- Single anchor: `setRealWorldAnchor(zone, easting, northing)`
- Conversions: `wgs84ToScene`, `sceneToWGS84`, `wgs84ToUTM`, `utmToWGS84`
- Never imports from design-world modules

### Three.js Scene Space
- **North = NEGATIVE Z** (always, forever)
- `wgs84ToScene()` → `sc.z < 0` for points north of anchor
- `buildFlatPolygon/buildBuilding`: shape Y = `-sc.z` → after `rotateX(-PI/2)` → world.z = sc.z ✓
- `buildLine`: `new THREE.Vector3(sc.x, 0, sc.z)` ✓

### Design World (design-grid.js, north-point-2d.js)
- Overlay only: designNorthAngle, grid spacing
- Never stores geographic coordinates
- Never imports real-world.js

---

## Module Responsibilities

| Module | Owns | Notes |
|---|---|---|
| `real-world.js` | UTM↔WGS84, scene↔UTM | Single source of truth for coords |
| `cesium-viewer.js` | Cesium globe, flyTo, pickPosition | New module, Apr 2026 |
| `gpr-file.js` | .gpr ZIP read/write, IndexedDB | JSZip dependency |
| `osm-import.js` | Overpass fetch, Three.js OSM geometry, terrain worker | Calls `buildLayerGroups` |
| `cadmapper-import.js` | DXF parse, Three.js CADMapper geometry | Shares `buildLayerPanel` |
| `terrain-worker.js` | Web Worker: AWS Terrarium tiles + contours | Off main thread |
| `projects.js` | Supabase save/load/list | Non-blocking: dialog shows immediately |
| `north-point-2d.js` | SVG NPoint, drag, rotate | DO NOT TOUCH |
| `north-point-3d.js` | Gizmo compass, scissor render | DO NOT TOUCH |
| `viewport.js` | switchMode, cameras, fit functions | Calls updateGizmoOverlay |
| `site.js` | Lot boundary draw, renderLotBoundary | Uses real-world.js |
| `design-grid.js` | Design grid overlay | Design world only |
| `grid.js` | CAD grid helpers | updateSceneHelpers |
| `plants.js` | Plant placement, GPR calc | Large module |
| `surfaces.js` | Surface detection/selection | |
| `ui.js` | Clock, feedback, setPipelineStatus, setStage | |
| `state.js` | Shared mutable state object | No logic |
| `app.js` | Everything else | Orchestrator only — extract further over time |

---

## Render Loop (app.js)

```
requestAnimationFrame(animate)
  → state.controls.update()
  → if 3D: renderCompassGizmo()   ← north-point-3d.js
  → if 3D: updateGizmoOverlay()   ← north-point-3d.js
  → renderer.render(scene, camera)
```

Cesium has its own render loop inside `cesium-viewer.js` (Cesium.Viewer handles it).
The Two renderers are never both active — one is `display:none`.

---

## Pipeline (user workflow)

```
1. App opens → Cesium globe (rotating)
2. User clicks "① Locate Site…" → OSM modal
3. User searches address / clicks Cesium → lat/lng set
4. User clicks Import → Overpass fetch → Three.js geometry built
5. showThreeJSView() → Cesium hidden, Three.js visible
6. .gpr created in background → Save dialog appears
7. User clicks "② Extract Segment…" → 2D mode → rectangle picker (TODO)
```

---

## Known Issues / TODO

- [ ] Rectangle picker for Extract Site Segment (stage 2) not yet implemented
- [ ] Double NPoint in 3D mode: np-container (2D) + gizmoOverlay (3D) both visible in 3D. Fix: switchMode should hide #np-container when mode='3d'. Already handled correctly by north-point-2d.js if initNorthPoint2D is called — don't touch.
- [ ] Save dialog still slow when .gpr creation is large
- [ ] Overpass browser cache implemented but server-side cache in api/overpass.js is still no-op (Vercel serverless)
- [ ] Terrain/contours via Web Worker: implemented but not wired to show in layer panel on first load

---

## Rules for New Code

1. **New features = new files.** Add to existing files only for wiring (event listeners, imports).
2. **Never modify north-point-2d.js or north-point-3d.js.**
3. **Never add coordinate math outside real-world.js.**
4. **Cesium and Three.js are mutually exclusive.** showCesiumView/showThreeJSView are the only correct switches.
5. **Test syntax before deploy.** Blank screen = JS syntax error. Check DevTools console first.
6. **North = -Z in Three.js.** Always. Forever.
