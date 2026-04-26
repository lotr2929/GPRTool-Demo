# GPRTool Session Log — Sat 18 Apr 2026

## Session #25 — Full Modularisation Sprint

### What was done

Full extraction of app.js (3,647 lines) into 9 separate modules. Final app.js: \~1,400 lines.

**Modules created:**

- `state.js` — Shared mutable state (scene, camera, pan2D, surfaces, MAT, controls, etc.)
- `ui.js` — Clock, alarm, feedback bar, section collapse
- `geo.js` — lat/lon utilities, map tile overlay (OpenStreetMap/CartoCDN)
- `grid.js` — CAD grid, axes helpers, grid spacing popup
- `model.js` — OBJ/GLTF/IFC loading, unit detection, edge overlay
- `surfaces.js` — Coplanar patch detection, hover/select, surface panel
- `site.js` — drawSiteBoundary, buildBoundaryPanel, lot boundary, site pin
- `viewport.js` — switchMode, fit2D/3D, surface canvas, resize, grid visibility
- `plants.js` — Plant library, GPR calc, placement engine (placeholder bodies)

**Also completed earlier in session:**

- Supabase GPRTool project created (`sfvwhbzxkzlscfsnyrwq.supabase.co`)
- `gpr_projects` table created with public RLS policy
- `api/projects.js` + `app/js/projects.js` — project repository (save/list/load/delete)
- `getActiveGPRBlob()` exported from gpr-file.js
- "Open GPR File…" button now opens Recent Projects modal (Supabase-backed)
- Auto-save to Supabase after DXF import and after boundary draw

### Key lessons learned (for extraction scripts)

**N-51: Brace-counter must skip strings and template literals**The `src.index('{', m.start())` approach finds the FIRST `{` — which for `function f(opts = {}) {`is inside the default parameter, not the function body. Template literal `${...}` also fools brace counters. Fix: use a proper tokeniser or start counting from the LAST `{`on the function signature line.

**N-52: State bridge order matters**`state.renderer = renderer` must come BEFORE any `state.renderer.X` calls. Pattern: create local const → immediately bridge to state → then use state.\*.

**N-53: Property access fixer (**`.X` **patterns) must also handle** `const/let/var X =` **declarations**The fixer regex `(?<!state\.)varname\.prop` correctly replaces `varname.prop → state.varname.prop`but must NOT match `const varname = new Thing()`. Add a negative lookbehind for declaration keywords.

**N-54: Word-boundary replacement can corrupt** `let varname =` **declarations**`re.sub(r'\bvarname\b', 'state.varname', src)` will transform `let varname = null`into `let state.varname = null` (syntax error). Add negative lookbehind for `let|const|var\s+`.

**N-55: ES module imports are read-only bindings**Cannot do `importedFn = function() {}` to monkey-patch an imported function. Options: (a) export a mutable ref, (b) pass a callback, (c) handle in the source module.

**N-56:** `let` **TDZ in ES modules**`let placementMode = 'idle'` declared at line 1213 causes TDZ error if an event fires before that line runs. Declare module-level mutable state vars near the TOP of the module.

### Current file sizes (post-modularisation)

- app.js: \~1,400 lines (was 3,647) — still the coordinator/orchestrator
- site.js: 273 lines
- viewport.js: \~310 lines
- plants.js: \~690 lines
- surfaces.js: \~300 lines
- grid.js: 162 lines
- geo.js: 158 lines
- model.js: 88 lines
- ui.js: 112 lines
- state.js: 88 lines

### Status

App loads and all SITE tools work. Plants/surfaces are placeholder code to be rewritten properly in future sprints. The Supabase project repo is live and working.

### Next session priorities

1. Test full flow: DXF import → project saves to Supabase → reload → Recent Projects → open
2. Fix scene.js extraction (renderer, animation loop — step 9, deferred)
3. Revisit plants.js — rewrite placement engine properly (state.placementMode in state.js)
4. North Point "Set Design North" wire-up (still pending from [vision.md](http://vision.md))

---

# GPRTool Session Log — Tue 21 Apr 2026

## Session #26 — Cesium Integration + Architecture Cleanup

### What was done

**Major architectural change: Cesium + Two-Viewport Model**

Integrated CesiumJS + Google Photorealistic 3D Tiles as a new rendering layer. GPRTool now has two exclusive viewport states:

- **Cesium viewport** (`#cesium-container`): globe, location finding, photorealistic context
- **Three.js viewport** (`#three-canvas`): OSM/CADMapper site model, design tools

Switch functions: `showCesiumView()` / `showThreeJSView()` in `cesium-viewer.js`. Neither can be active simultaneously — the inactive one is always `display:none`.

**New module:** `cesium-viewer.js`

- Cesium viewer init, Google 3D Tiles from `/api/maps-key`
- `flyToSite(lat, lng, alt)` — flies to WGS84 location
- `showCesiumView()` / `showThreeJSView()` — exclusive viewport switching
- `startLocationPick(cb)` — click-to-pick on 3D tiles
- `startBoundaryPick(onPoint, onDone)` — interactive lot boundary on tiles
- `setCesium2D()` — top-down view
- `setCesiumStreetLevel()` — click-to-pick street level descent
- Auto-rotate globe on startup; stops on first user interaction
- `resetCesiumView()` — `camera.flyHome()` + restart rotation

**Viewport DOM changes (body.html)**

- `#cesium-container` added before `#three-canvas`
- `#three-canvas` starts `display:none`
- `#np-container` starts `display:none` (managed by north-point-2d.js)
- `.mode-toggle-container` starts `display:none` (shown by showThreeJSView)

**Left panel pipeline UI**Replaced command list with numbered pipeline stages:

- Stage ① Locate Site — button opens OSM modal
- Stage ② Extract Segment — locked until stage 1 complete (TODO: rectangle picker)
- Advanced section (collapsible) — Import from Cesium, Import from CADMapper

**OSM import improvements**

- Nominatim replaced with Google Geocoding API (`/api/geocode` proxy, already existed)
- Address search flies Cesium to result, user confirms by clicking 3D tiles
- `context.geojson` saved in `.gpr` (OSM GeoJSON, WGS84)
- After successful import: `showThreeJSView()` — Cesium hides, Three.js shows

**Save dialog improvements**

- `.gpr` ZIP created eagerly in background after import
- Dialog appears as soon as ZIP is ready (no blocking on Supabase list)
- `listProjects()` fetches async, populates list after dialog is already visible
- Save is non-blocking: dialog closes immediately, Supabase upload continues background

**Browser-side Overpass cache**

- IndexedDB cache keyed by bounding box + radius, 24hr TTL
- First import fetches Overpass; subsequent same-area imports served from cache
- Fixes rate limit issue (Vercel serverless has no persistent memory)

**Terrain + contours via Web Worker**

- `terrain-worker.js` created — AWS Terrarium tiles + marching-squares contours
- Runs off main thread (was disabled due to main thread freeze)
- Non-blocking: terrain appears 3–8s after OSM import, added to layer panel

**API**

- Google Geocoding API (`/api/geocode.js`) already existed, now used for address search
- Google Map Tiles API enabled in Google Cloud Console for this project

**Clear Site**

- Now calls `showCesiumView()` — returns to globe
- Resets stage indicators to pending/locked
- Restarts globe auto-rotation via `resetCesiumView()`

### Architecture document created

`_dev/_architecture.md` — full structural reference:

- Two viewport model
- DOM structure
- NPoint rules (do not touch)
- Coordinate law (North = -Z)
- Data format map (GeoJSON, DXF, IFC)
- .gpr file format
- Module responsibilities
- Render loop
- Rules for new code

### Key lessons (N-57 onwards)

**N-57: Cesium widget creates its own stacking context**Cesium injects a full-viewport `div.cesium-widget` with internal z-index layers. Elements in the same parent with z-index 500+ may still be hidden behind it. Solution: don't fight with z-index. Hide/show elements explicitly in showCesiumView/showThreeJSView.

**N-58: display:none removes from layout AND event chain**`visibility:hidden` is NOT sufficient — event listeners still fire. Always use `display:none` to fully remove elements from interaction when hiding.

**N-59: Never touch NPoint visibility from showThreeJSView**`setNorthPointMode()` in north-point-2d.js manages #np-container visibility. `updateGizmoOverlay()` in north-point-3d.js manages #gizmo3d-overlay. `showThreeJSView()` must NOT set np-container visibility — it causes double compass. Only `showCesiumView()` explicitly hides both (to clear the Cesium viewport).

**N-60: Orphaned code outside functions = blank screen**When editing cesium-viewer.js, old function body fragments were left outside any function after replacement. These cause `SyntaxError: Unexpected token '}'`. Always verify no orphaned lines exist after any function replacement.

**N-61: Vercel serverless in-memory cache is a no-op**`const _cache = new Map()` inside a serverless function resets on every cold start. For Overpass caching, use browser IndexedDB (persists across page loads). Server-side cache only works if the lambda stays warm (rarely the case on free tier).

**N-62: OSM data = 2D footprints + height number, not a 3D model**OSM gives polygon outlines + building:levels tag. Three.js extrudes these to boxes. Cesium Google 3D Tiles provides photogrammetric mesh (real roof shapes). Neither replaces the other: Cesium = context/rendering, OSM = structured design data.

**N-63: Format roles in GPRTool**

- GeoJSON: internal format, always WGS84, saved in .gpr
- DXF: import (CADMapper, surveyors), export (TODO at Extract Segment)
- IFC: input from architect (proposed building), used for GPR surface detection
- OBJ/GLTF: generic mesh import, surface type guessed from normals

### Status

- Cesium globe with rotating earth on startup ✓
- OSM import → Three.js model switch ✓
- Save dialog non-blocking ✓
- Clear Site → returns to globe ✓
- NPoint compass: one compass, correct mode ✓ (fixed N-59)
- 2D/3D toggle: hidden in Cesium, shown in Three.js ✓

### Next session priorities

1. Extract Segment — rectangle picker with drag handles (stage 2)
2. Extract Segment → site.dxf output (DXF writer)
3. Extract Segment → site_context.geojson clipped to rectangle
4. IFC import proper surface detection (model.js loadIFC stub)
5. Update [vision.md](http://vision.md) to reflect Cesium as rendering layer
