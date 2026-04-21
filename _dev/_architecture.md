# GPRTool Architecture — Session Reference
_Written: 21 Apr 2026. Update this when architecture changes._

---

## The Two Viewports — Exclusive, Never Concurrent

GPRTool has exactly two rendering states. One active at a time. The switch
functions in `cesium-viewer.js` are the ONLY correct way to change state.

### Viewport 1 — Cesium (globe / location finding)
- What it is: CesiumJS + Google Photorealistic 3D Tiles. Real-world context.
- When active: `#cesium-container` display:block. `#three-canvas` display:none.
  `#np-container` hidden. `#gizmo3d-overlay` hidden. `.mode-toggle-container` hidden.
- Purpose: Navigate to site. Fly to address. Visual context only.
- No design tools. No GPR calculation. No NPoint.
- Switch on: `showCesiumView()` in cesium-viewer.js

### Viewport 2 — Three.js (design workspace)
- What it is: Three.js WebGL canvas with OSM or CADMapper geometry.
- When active: `#three-canvas` display:block. `#cesium-container` display:none.
  `.mode-toggle-container` display:flex. NPoint managed by their own modules.
- Purpose: Design, plant placement, GPR calculation.
- Switch on: `showThreeJSView()` in cesium-viewer.js

### Viewport switch sequence (user workflow)
```
App opens → Cesium globe (rotating)
   ↓ user clicks "① Locate Site…"
OSM modal → address search → Overpass fetch → Three.js geometry builds
   ↓ showThreeJSView() called from onLayersLoaded in app.js
Three.js design workspace visible
   ↓ user clicks "② Extract Segment…"
2D mode → rectangle picker (TODO) → site.dxf + site_context.geojson extracted
```

---

## Viewport DOM Structure (`body.html → #viewport`)

```
#viewport  (position:relative, overflow:hidden, isolation:isolate)
  ├── #cesium-container    position:absolute, inset:0  ← Cesium globe
  ├── #three-canvas        position:absolute, inset:0  ← Three.js WebGL
  ├── #np-container        bottom-right SVG compass    ← north-point-2d.js
  ├── #np-ctx-menu         context menu for NPoint
  ├── .mode-toggle-container  top-right, z-index:1000  ← 2D/3D buttons
  └── #gizmo3d-overlay     injected by north-point-3d.js at init
```

**Z-index rule**: Cesium widget creates its own internal stacking context that
can override z-index values. Solution: hide `.mode-toggle-container` when
Cesium is active — do NOT fight it with z-index.

---

## North Point — DO NOT MODIFY THESE MODULES

Two separate compass systems. Both live in Three.js viewport only.

### NPoint 2D — `north-point-2d.js` + `#np-container` SVG in body.html
- SVG arrow compass, draggable/resizable
- Shows in both 2D and 3D Three.js modes
- Rotates to show True North vs Design North angle
- Managed entirely by north-point-2d.js

### NPoint 3D — `north-point-3d.js` + `#gizmo3d-overlay` div
- Canvas-drawn compass, scissor-rendered into Three.js _compassScene
- `#gizmo3d-overlay` is a transparent drag/resize target div (no visual content)
- Visible in Three.js 3D mode ONLY (`currentMode === '3d'`)
- `updateGizmoOverlay()` called from switchMode() in viewport.js
- `renderCompassGizmo()` called every frame in 3D mode from app.js

**Rule**: Never modify north-point-2d.js or north-point-3d.js.
`showCesiumView()` explicitly hides both `#np-container` and `#gizmo3d-overlay`.
`showThreeJSView()` does NOT touch either — their own modules restore visibility.

---

## Coordinate System — LOCKED, NEVER CHANGES

### Scene space axes
- **East  = +X**
- **Up    = +Y**
- **North = -Z** (ALWAYS negative Z. Forever.)

### WGS84 ↔ Scene conversion (real-world.js only)
- `wgs84ToScene(lat, lng)` → `{x, z}` where z < 0 for north of anchor
- `buildFlatPolygon / buildBuilding`: shape uses Y = -sc.z so after
  `rotateX(-PI/2)` the result lands at sc.z (north = -Z) ✓
- `buildLine`: `new THREE.Vector3(sc.x, 0, sc.z)` ✓

### Real World vs Design World
| | Real World | Design World |
|---|---|---|
| Module | real-world.js | design-grid.js, north-point-2d.js |
| Data | WGS84, UTM | designNorthAngle, grid spacing |
| Coords | Geographic | None — overlay only |
| Cross-import | Never import Design | Never import real-world.js |

---

## Data Formats

### What each format carries and when GPRTool uses it

| Format | Contains | GPRTool role |
|---|---|---|
| **GeoJSON** | 2D/3D geometry + properties, WGS84 | Primary internal format. OSM saves as `context.geojson` in .gpr. Site extraction clips this to `site_context.geojson`. |
| **DXF** | 2D/3D geometry, named layers, no semantics | In: CADMapper site context (cadmapper-import.js). Out: site.dxf generated at Extract Segment — identical to CADMapper download. TODO. |
| **IFC** | 3D geometry + BIM semantics (wall/roof/floor/door) | In only: architect's proposed building model. loadIFC() stub in model.js. Used for GPR surface detection (roof, wall, ground by type not just normal). |
| **OBJ / GLTF** | Pure 3D mesh, no semantics | In only: generic model import. Working via model.js. Surface type guessed from face normals. |
| **DWG** | AutoCAD native binary | Not supported (binary format, no browser parser). |
| **3DM (Rhino)** | 3D geometry, layers | Not supported yet. Priority for landscape architects. |

### OSM data is NOT a 3D model
OSM gives 2D footprints + height number. GPRTool constructs 3D geometry
by extruding footprints. OSM translates cleanly to DXF and partially to IFC.

### IFC is an INPUT, not an output
IFC comes FROM the architect (Revit/ArchiCAD model of the proposed building).
GPRTool reads it to identify surfaces for GPR calculation.
Site extraction does NOT generate IFC.

---

## The .gpr File Format (ZIP renamed to .gpr)

### Currently saved
```
manifest.json        identity, version, which sections exist
reference.json       UTM anchor — where the project is in the world (IMMUTABLE)
design.json          designNorthAngle, grid spacing
context.geojson      OSM or CADMapper geometry as WGS84 GeoJSON
boundary.geojson     lot boundary polygon (added after Draw Lot Boundary)
```

### To be added at Extract Segment (TODO)
```
site_context.geojson context.geojson clipped to rectangle
site.dxf             layered DXF of site segment — equivalent to CADMapper output
```

### Future (Building stage)
```
model/buildings.json proposed building volumes
model/landscape.json planting areas, substrates
model/plants.json    individual plant placements, species, LAI
results/gpr_score.json GPR calculation output
results/gpr_report.html self-contained HTML report
```

---

## Module Responsibilities

| Module | Owns | Status |
|---|---|---|
| `app.js` | Orchestrator, render loop, event wiring | ~1650 lines — extract further |
| `real-world.js` | All coordinate conversions | Stable |
| `cesium-viewer.js` | Cesium globe, flyTo, viewport switching | Apr 2026 |
| `gpr-file.js` | .gpr ZIP read/write, IndexedDB | Stable |
| `osm-import.js` | Overpass fetch, Three.js OSM geometry, terrain worker | Active |
| `cadmapper-import.js` | DXF parse, Three.js geometry | Stable |
| `terrain-worker.js` | Web Worker: AWS Terrarium + contours | Apr 2026 |
| `projects.js` | Supabase save/load/list/dialog | Active |
| `north-point-2d.js` | SVG NPoint, drag, rotate | DO NOT TOUCH |
| `north-point-3d.js` | Gizmo compass, scissor render | DO NOT TOUCH |
| `viewport.js` | switchMode, cameras, fit functions | Calls updateGizmoOverlay |
| `site.js` | Lot boundary draw, renderLotBoundary | Stable |
| `design-grid.js` | Design grid overlay | Stable |
| `grid.js` | CAD grid, updateSceneHelpers | Stable |
| `plants.js` | Plant placement, GPR calculation | Large |
| `surfaces.js` | Surface detection/selection | Stable |
| `ui.js` | Clock, feedback, setPipelineStatus, setStage | Active |
| `state.js` | Shared mutable state object | No logic |

---

## Render Loop (app.js, every frame)

```
requestAnimationFrame(animate)
  controls.update()
  if 3D mode: renderCompassGizmo()    ← north-point-3d.js
  if 3D mode: updateGizmoOverlay()    ← north-point-3d.js
  renderer.render(scene, camera)      ← Three.js
```

Cesium has its own internal render loop (Cesium.Viewer). Never runs
simultaneously with Three.js — one container is always display:none.

---

## Rules for New Code

1. **New features = new files.** Wire in app.js with import + one event listener.
2. **Never modify north-point-2d.js or north-point-3d.js.**
3. **Never add coordinate math outside real-world.js.**
4. **Viewport switching = showCesiumView() / showThreeJSView() only.**
5. **Check DevTools console FIRST for blank screen** — always a JS syntax error.
6. **North = -Z in Three.js. Always. Forever.**
7. **Before deploying: verify no orphaned code outside functions.**
