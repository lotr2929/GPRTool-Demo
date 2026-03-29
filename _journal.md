# GPRTool Development Journal

**Project**: GPRTool-Demo
**Collaborators**: Boon (domain expert) + Claude (development partner)
**Live URL**: https://gprtool-demo.vercel.app
**Repository**: https://github.com/lotr2929/GPRTool-Demo.git
**Local path**: `C:\Users\263350F\_myProjects\GPRTool-Demo`

---

## How to use this journal

- **Planned** — decisions made, not yet started
- **In Progress** — actively being worked on
- **Done** — completed and deployed or committed
- Each entry dated. Most recent at top.

---

## Session Log

---

### 2026-03-28 (Session 6 — Site alignment, map tiles, axes, north point, deploy polling)

#### What was done

**Site boundary alignment**
- `shapeGeom.rotateX(-Math.PI/2)` → `+Math.PI/2` — the filled site polygon was mirrored from the outline due to the negative rotation

**Map tile overlay**
- CARTO Light basemap tiles load automatically on GeoJSON import at zoom 18
- Tile placement corrected from equirectangular to Mercator Y projection (Perth latitude ~32°S causes ~18% stretch without correction)
- `mercatorY()` helper added; `loadOneTile()` uses Mercator Z coordinates
- "Map Overlay" toggle added to Site Boundary section in right panel
- `clearMapTiles()` called on site clear

**Axes overhaul**
- `axesYLine` (green, vertical Y) added separately from X/Z
- Y hidden in 2D plan mode, shown in 3D mode
- `toggleAxes()` wired to Ctrl+T keyboard shortcut and View > Toggle Axes menu item

**North Point compass**
- SVG compass needle designed iteratively with Boon over ~15 preview rounds
- Final needle points: north `32,20 32,40 42,43` (black fill), south `32,60 32,40 22,37` (open outline)
- Circle cx=32 cy=40 r=22, crosshair ticks at cardinal points, N label above
- Size: 77×86px (64×72 base ×1.2)
- Placed inside `#viewport` as `position:absolute` — eliminates `position:fixed` ancestor-transform bug
- Default position: `right:16px; bottom:16px` set in HTML inline style (no JS needed at load)
- Drag: pointer events calculate offset relative to viewport `getBoundingClientRect()`
- Position clamped to viewport dimensions; saved to localStorage key `gprtool-north-pos-v3`
- Reset restores `right/bottom` CSS and removes localStorage entry
- Right-click context menu: Reset to Default Position / Hide North Point
- View menu: North Pointer toggle + Reset North Point Position
- `updateNorthRotation()` called every animation frame; projects world north direction (0,0,-500) through camera to get screen bearing

**deploy.bat overhaul**
- `deploy.env` created with GPRTool credentials (project ID `prj_oioZB5jSKFHb99IZcSxZutIcjufi`, team ID `team_HOoYAXfWxiVyXa3jQ6ieKaGE`)
- `poll_vercel.ps1` copied from Mobius pattern — captures baseline UID before push, polls for new deployment, reports READY/ERROR with elapsed timer
- `deploy.env` added to `.gitignore`

#### Known issues / pending verification
- Map tile alignment needs visual check — Mercator fix applied but not yet confirmed in browser
- North point rotation accuracy not yet verified with loaded site
- Axes in 2D surface canvas mode not explicitly tested

---

### 2026-03-26 (Session 5 — Repo cleanup, site research, import format decisions)

#### What was done

**Repo cleanup**
- Audited all files across root, `frontend/js/`, `backend/`, `test-data/`
- Created `_archive/` and moved all dead/obsolete files there
- Dead JS: `frontend/js/main.js`, `frontend/js/camera.js` — never imported by `index.html`; app logic is inline in `index.html`
- Dead backend: `backend/app.py`, `backend/exporters.py`, `backend/geometry.py` — Render-era FastAPI, replaced by Vercel browser-only in Session 2
- Completed scripts: `accdb_export.py` (Session 1 job done), `lai_count.py` (superseded by `lai_explorer.py`)
- Wrong repo: `Modelfile` — Ollama config, belongs in Mobius not GPRTool
- Superseded: `requirements.txt`, `GPRTool_Development_Plan.docx`, `SketchUp layout.png`, `close.bat`, old `start.bat`
- Credentials: `Linux Login.txt` → `_archive/` ⚠️ **scrub from git history if repo ever goes public**
- Scratch: `test-data/test_site_scratch.geojson`
- Rewrote `start.bat` — now just starts `python server.py` on port 8000, no backend
- Created `_map.md` — full repo structure, data flow, key files reference, architecture overview
- Created `_session.md` — current status snapshot, updated each session
- Created `_archive/README.md` — documents every archived file and reason

**Site research: 30 Beaufort Street, Northbridge**
- Confirmed as primary GPRTool demo site: ~9,579 m², entire city block (Beaufort/James/Stirling/Roe Sts)
- Planning framework: CPS2 Precinct 1 Northbridge; draft LPS3 (16+ storeys, ~100,000 m² GFA STCA); Amendment 41 (Northbridge Special Entertainment Precinct, gazetted Feb 2026 — restricts residential in Core area)
- R-code: none applicable (City Centre zone, not residential)
- Sustainability obligations: NCC Section J, NatHERS 7-star (apartments, WA from May 2025), NABERS Energy (5-star office target, mandatory disclosure ≥1,000 m²), Green Star Buildings v1
- NCC 2025 note: WA adoption date unconfirmed; mandatory rooftop PV (J9D5) changes Green Star energy credit strategy
- Produced two documents in `test-data/`:
  - `30_Beaufort_Street_Site_Analysis.docx` — 12-page planning/sustainability/GPR report
  - `30_Beaufort_Street_GPR_Recommendations.docx` — GPR targets with Kings Park baseline; corrects Gemini AI attribution error

**GPR recommendations — key conclusions**
- GPR metric: Ong, B.L. (2003) Landscape and Urban Planning 63(4) 197–211. NOT Wong et al. 2003.
- Kings Park (Banksia/Jarrah woodland, Swan Coastal Plain): average LAI ~2.0 → Ecological Parity threshold = GPR 2.0
- UHI penalty in Northbridge requires surplus above parity → GPR 4.0 recommended as primary target
- Three tiers: Minimum 1.5 (sub-parity), Optimum 3.5–4.5 (regenerative), Maximum 6.0+ (biophilic)
- Perth native LAI coefficients documented: large canopy trees 2.5, heath shrubs 1.8, intensive roof garden 2.5–3.0

**Import format research and decisions**
- Workflow 1 (full model import): OBJ first, IFC later
- Workflow 2 (site boundary): GeoJSON already done; DXF next priority
- Third-party services: CADmapper, TopoExport, Equator Studios — all paid, output DXF/OBJ
- OSM and Overture Maps: NOT suitable for survey-accurate GPR boundaries
- Landgate SLIP: best WA source — survey-accurate cadastral, free for personal use
- Downloaded 30 Beaufort Street parcel → `test-data/30_beaufort_street_parcel.geojson`
  - land_id: 1818174, locality: PERTH, 19 vertices

#### Session 5 status
- ✅ Repo cleaned and archived
- ✅ `_map.md` created
- ✅ `_session.md` created
- ✅ `_archive/README.md` created
- ✅ `start.bat` rewritten
- ✅ Site documents created
- ✅ Parcel GeoJSON downloaded and saved
- ⏳ GeoJSON import not yet tested with the new parcel (session ended before testing)
- ⏳ No deploy this session

#### Pending from Session 5
- [ ] Test GeoJSON import with `30_beaufort_street_parcel.geojson` — confirm area ~9,579 m², perimeter ~390 m
- [ ] Agree on GeoJSON visual style (Boon was previously unhappy with the appearance)
- [ ] Implement DXF import
- [ ] Singapore LAI CSV merge into `LAI_categorised.csv`
- [ ] Landgate SLIP address lookup (WA convenience feature)
- [ ] Deploy to Vercel

---

### 2026-03-20 (Session 4 — Phase 2a: Plant Library + GPR Calculation Engine)

#### What was done

**`plants_free.json` — created** (`frontend/plants_free.json`)
- 56 species free-tier plant library, bundled as static JSON (no backend required)
- 24 species from Singapore field measurements (Boon & Tan 2009) — primary source, urban-measured
- 12 species from ORNL/TRY with explicit urban calibration warning in source field
- 14 common urban species from literature (turf, sedum, ivy, buxus, bamboos etc.)
- Each entry: `{ id, common, scientific, lai, category, surface_types[], source }`
- `surface_types[]` field controls which surface types the species is compatible with
- **Bamboo group**: 6 species — *B. multiplex*, *B. vulgaris*, *B. oldhamii*, *B. textilis var. gracilis*, *Phyllostachys aurea*, *P. edulis* (Moso) — LAI range 5.50–8.10

**Plant Library modal — built** (in `index.html`)
- Triggered by "Plant Library…" button (left panel) or "Add Plant…" button (surface schedule)
- Search by common name, scientific name, or category
- Surface type filter: All / Ground / Roof / Wall / Sloped / **Bamboo** (category filter)
- Species sorted: compatible species first (by LAI desc), then incompatible (dimmed to 40%)
- Source badges: Field (green) / ORNL (amber) / Lit (blue) — provenance visible at a glance
- LAI badge displayed prominently for every species
- "Add to Surface" button — adds species instance to selected surface's plant schedule

**Data model refactored — multi-instance per surface**
- Old model: `surface.plantId` — one species per surface
- New model: `surface.plants = [{ instanceId, speciesId, canopyArea }]`
- Each surface can have any number of plant instances of any species
- Each instance has its own canopy area (m²), editable in the schedule
- `_instanceCounter` — monotonically increasing ID, no collisions on remove/re-add

**GPR formula corrected**
- Old (wrong): `Σ(surface.area × LAI) / site_area`
- New (correct): `Σ(instance.canopyArea × species.LAI) / site_area`
- Canopy area is the plan area of each individual plant's canopy, not the whole surface
- Default canopy area on add = full surface area (user trims down in schedule)
- Numerator `Σ(canopy×LAI)` shown as a breakdown row below GPR value

**Plant schedule panel — built** (right panel, surface section)
- Appears below surface properties when a surface is selected
- Lists all plant instances on the surface: species name | LAI badge | canopy area input | m² | × remove
- Canopy area is an editable number input — changing it triggers immediate GPR recalc
- × remove button removes that instance only
- Empty state message prompts user to click "Add Plant…"
- "Add Plant…" button at bottom of schedule opens modal pre-filtered to surface type

**Surface list badges**
- Left panel surface list items now show a green badge: "1 plant" / "N plants" per surface

**`body.html` updated**
- Removed old `selection-section` (`sel-plant`, `sel-lai` fields)
- Added `plant-schedule-section` with `surf-plant-list` div and `addPlantBtn`
- Added `gpr-breakdown-row` to GPR panel (shows numerator)
- Removed `Plant Schedule` toggle (replaced by always-visible schedule panel)

#### Architecture note — module split deferred to Phase 3
- `index.html` is ~80KB and growing
- Recommended split at Phase 3 start: `js/state.js`, `js/plants.js`, `js/gpr.js`, `js/scene.js`, `js/surfaces.js`, `js/geo.js`
- Rationale: mid-build refactor carries risk; shared state wiring is a half-day job
- Do this before terrain/Phase 3 work begins — not during Phase 2

#### Phase 2a status: ✅ Complete

#### Pending — Phase 2b onwards
- [ ] Deploy to Vercel
- [ ] LAI database merge — Singapore CSV → `LAI_categorised.csv` (duplicates unresolved)
- [ ] Terrain layer — OpenTopography SRTM or Mapbox elevation mesh
- [ ] Image underlay with scale calibration
- [ ] DXF import per surface canvas
- [ ] GPR report (PDF export)
- [ ] Module split (`js/state.js` etc.) — do before Phase 3

---

### 2026-03-19 (Session 3 — Design paradigm + MVP Phase 1 build)

#### What was done

**Design paradigm finalised**
- Defined GPRTool as a landscape design and GPR calculation tool
- The 3D model (imported or built) is a surface host — it defines where landscape can be placed
- Building tools are surface-creation tools only, not architectural CAD
- Defined the two entry paths: import from architect (Path A) or build massing in GPRTool (Path B)
- Defined per-surface DXF import workflow — equivalent to attaching a floor plan or elevation
- Established GPRTool's interoperability role: not a standalone tool
- Consolidated all documentation into `_design.md` and `_journal.md`
- Retired: `_devguide.md`, `_devguide-summary.md`, `_devstartup.md`, `GPR_Documentation.md`, `Next Steps.md`

**MVP Phase 1 — built** (in `index.html`)
- OBJLoader + GLTFLoader from CDN
- `onModelLoaded()` — centres model, sits on Y=0, surface detection, fits camera, populates UI
- `detectSurfaces()` — coplanar patch extraction, normal classification, area calculation
- Surface hover + selection (raycaster + panel list)
- `body.html`, `header.html`, `styles.css` — full UI built
- Edge overlay, surface canvas outline, pan/zoom in 2D canvas mode

#### Phase 1 status: ✅ Complete

---

### 2026-03-18 (Session 2 — UI redesign + Vercel migration)

#### What was done

**Vercel migration** — Render → Vercel. Project renamed GPRToolDemo → GPRTool-Demo.
Live at https://gprtool-demo.vercel.app ✅

**GeoJSON site import** — working. Orange boundary, area/perimeter, 2D camera fit.

**Full UI redesign** — SketchUp + PD:Site Designer reference. Outfit font, forest green header,
warm grey panels, SVG icons, 2D/3D toggle, status bar.

#### Decisions
- No Vite/bundler — importmap
- `.gpr` = native session format
- Keyboard shortcuts: Ctrl+F, Ctrl+G, Ctrl+Z, Ctrl+Shift+Z, Esc

---

### 2026-03-17 (Session 1 — ~90 mins before surgery)

- Joint codebase review
- LAI processing pipeline built; 760 species processed and categorised
- Core vision clarified: GPR is the point, database is the IP, CAD is scaffolding
- Boon entered surgery — development paused

#### LAI Database — Category Counts
| Category | Count |
|---|---|
| Tree | 248 |
| Multi-Species | 323 |
| REVIEW | 55 |
| Generic-Benchmark | 38 |
| Shrub | 29 |
| Groundcover | 25 |
| Grass | 22 |
| Mangrove | 10 |
| Bamboo | 9 |
| Palm | 1 |
| **TOTAL** | **760** |
