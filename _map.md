# GPRTool-Demo — Repository Map

**Last updated:** 2026-03-26 (Session 5)
**Live URL:** https://gprtool-demo.vercel.app
**Local path:** `C:\Users\263350F\_myProjects\GPRTool-Demo`
**GitHub:** https://github.com/lotr2929/GPRTool-Demo.git

> Update this file at the start of every session after any structural changes.

---

## Architecture Overview

GPRTool is a **browser-only PWA** — no backend, no server-side logic.
All application code runs in the browser via a single HTML file served statically.
Deployed on Vercel as a static site with the root set to `frontend/`.

```
User browser
    └── frontend/index.html      ← entire app (HTML + inline <script type="module">)
            ├── fetches header.html, body.html at runtime
            ├── imports three.module.js, OrbitControls.js (local)
            ├── imports OBJLoader, GLTFLoader from CDN (jsdelivr)
            └── fetches plants_free.json at runtime
```

---

## Directory Structure

```
GPRTool-Demo/
│
├── frontend/                   ← ROOT FOR VERCEL DEPLOYMENT
│   ├── index.html              ← MAIN APP FILE (115 KB) — all logic is here
│   ├── body.html               ← Left panel, viewport, right panel markup
│   ├── header.html             ← Top bar, menus, clock
│   ├── styles.css              ← All styles
│   ├── plants_free.json        ← 56-species plant library (runtime fetch)
│   ├── favicon.ico
│   ├── server.py               ← Local dev server (Python http.server, port 8000)
│   ├── js/
│   │   ├── three.module.js     ← Three.js r160 (local copy, 1.2 MB)
│   │   ├── OrbitControls.js    ← Three.js orbit controls (local copy)
│   │   └── north-point-2d.js  ← 2D DOM compass widget (extracted 2026-03-29)
│   ├── textures/
│   │   └── plywood.webp        ← Texture used by placeholder cube (unused in prod)
│   └── images/
│       ├── gpr-logo.png        ← GPR logo (829 KB — consider optimising)
│       └── Backup Images/      ← Legacy backup images
│
├── test-data/                  ← Test files for development; NOT deployed
│   ├── README.md               ← Test data index
│   ├── 30_beaufort_street_parcel.geojson     ← PRIMARY DEMO SITE (Landgate SLIP)
│   ├── test_site_contours.geojson            ← Contour test file
│   ├── test_cube.obj                         ← Minimal OBJ (cube)
│   ├── test_cube.dxf                         ← Minimal DXF (cube)
│   ├── test-tower.obj                        ← Tower massing with OBJ l-lines
│   ├── test-tower-clean.obj                  ← Tower without extra lines
│   ├── test_8storey_site.obj                 ← 8-storey site model
│   ├── test_building_import.dxf              ← DXF building import test
│   ├── 30_Beaufort_Street_Site_Analysis.docx ← Site analysis report (demo)
│   └── 30_Beaufort_Street_GPR_Recommendations.docx ← GPR targets report (demo)
│
├── GPR - LAI Values/           ← LAI RESEARCH DATA — not deployed
│   ├── GreenPlotRatio_LAI Values.csv         ← FIELD DATA (37 species, Ong & Tan 2009) — PRIMARY SOURCE
│   ├── LAI_categorised.csv                   ← Processed LAI database (760 species)
│   ├── LAI_combined_clean.csv                ← Cleaned combined dataset
│   ├── LAI_tropical_subset.csv               ← Tropical species subset
│   ├── LAI_DATABASE_STRATEGY.md              ← Database strategy notes
│   ├── LAI_category_report.txt               ← Category summary
│   ├── LAI_explorer_report.txt               ← Explorer output
│   ├── LAI.csv / LAI Values.csv              ← Earlier export versions
│   ├── LAI Database1.accdb                   ← Original MS Access DB (15 MB)
│   ├── LAI (ORNL DAAC_...).csv/.xlsx         ← ORNL source data (raw, uncalibrated)
│   ├── LAI (TRY Database)*.xlsx              ← TRY source data (raw, uncalibrated)
│   ├── LAI Database - ONRL.csv               ← ORNL processed
│   ├── LAI Database - TRY.csv                ← TRY processed
│   ├── LAI Database (Combined).xlsx          ← Combined workbook
│   ├── LAI_Woody_Plants_1231.zip             ← ORNL archive
│   ├── merge_singapore_lai.py                ← Script to merge Singapore CSV into LAI_categorised.csv
│   ├── Journal Papers - LAI and GPP for GPR.zip ← Reference papers archive
│   ├── Tan, Sia - 2009 - LAI of tropical plants... .pdf ← KEY REFERENCE (5 MB)
│   ├── Material Library.csv                  ← Placeholder (25 bytes — likely empty)
│   ├── accdb_export/                         ← Output from accdb_export.py (Session 1)
│   ├── ORNL DAAC-Global Database.../         ← Raw ORNL data folder
│   └── TRY Database/                         ← Raw TRY data folder
│
├── _map.md                     ← THIS FILE — repo structure reference
├── _journal.md                 ← Development journal (all sessions)
├── _session.md                 ← Last session status (updated each session)
├── _design.md                  ← Design decisions, architecture, UI spec (40 KB)
├── _archive/                   ← Dead files retained for reference (see _archive/README.md)
│
├── lai_categorise.py           ← Processes raw ORNL/TRY CSVs → LAI_categorised.csv
├── lai_explorer.py             ← Explores and reports on LAI database
│
├── deploy.bat                  ← Git commit + push → triggers Vercel auto-deploy
├── github-publish.bat          ← GitHub publish helper
├── start.bat                   ← Start local dev server + open browser
│
├── .env.local                  ← Local environment variables (not committed)
├── .gitignore                  ← Git ignore rules
├── .vercel/                    ← Vercel project config
├── .git/                       ← Git repository
├── .venv/                      ← Python virtual environment (local only)
├── .obsidian/                  ← Obsidian vault config (if used for notes)
└── .run/                       ← IDE run configurations
```

---

## Key Files — Quick Reference

| File | What it does | Edit when |
|---|---|---|
| `frontend/index.html` | App shell — Three.js scene, UI logic, GPR engine, plant library, GeoJSON import, OBJ/glTF import (NP extracted) | Every feature build |
| `frontend/js/north-point-2d.js` | 2D DOM north point compass — drag, resize, rotation, persist | North point changes only |
| `frontend/body.html` | Left panel buttons, viewport canvas, right panel sections | Adding new UI panels or buttons |
| `frontend/header.html` | Top bar, File/Edit menus, clock | Adding menu items |
| `frontend/styles.css` | All CSS variables, component styles | Visual changes |
| `frontend/plants_free.json` | Plant species library (56 species, LAI values, surface compatibility) | Adding/editing species |
| `test-data/30_beaufort_street_parcel.geojson` | Primary demo site boundary (Landgate SLIP, survey-accurate) | Rarely |
| `_journal.md` | Session log — what was built, decisions made, what's pending | Every session |
| `_session.md` | Current status snapshot — where we are, what's next | Every session |
| `_design.md` | Architecture decisions, UI spec, workflow definitions | Major design changes |
| `_dev_guide.md` | Developer rules for AI and human contributors — module structure, tool architecture, CSS/DOM/Three.js conventions | When new patterns are established |
| `deploy.bat` | Commit and push to GitHub (triggers Vercel deploy) | Every deploy |

---

## Data Flow

```
GeoJSON file (Landgate / local)
    → importGeoJSONBtn click
    → FileReader → JSON.parse
    → extractCoordinates()
    → drawSiteBoundary()          ← orange LineLoop + cream ShapeGeometry in Three.js scene
    → computePolygonArea()        ← Shoelace formula on projected coords
    → siteAreaM2                  ← GPR denominator

OBJ / glTF file
    → import3DModelBtn click
    → OBJLoader / GLTFLoader (CDN)
    → detectAndApplyUnitScale()   ← auto mm/cm/m detection
    → onModelLoaded()
    → detectSurfaces()            ← coplanar patch extraction, normal classification
    → surfaces[]                  ← ground / roof / wall / sloped registry

Plant assignment
    → Plant Library modal
    → addPlantInstance(surface, species, canopyArea)
    → surface.plants[]            ← [{instanceId, speciesId, canopyArea}]
    → recalcGPR()                 ← Σ(canopyArea × LAI) / siteAreaM2

Deploy
    → deploy.bat
    → git commit + push to GitHub
    → Vercel auto-builds from frontend/
    → https://gprtool-demo.vercel.app
```

---

## LAI Database Hierarchy

```
PRIMARY (field-measured, urban-calibrated):
    GreenPlotRatio_LAI Values.csv   ← 37 species, Ong & Tan 2009, Singapore
    ↓ merge_singapore_lai.py (TODO)
    LAI_categorised.csv             ← 760 species total (primary + ORNL/TRY)

SECONDARY (global databases, NOT urban-calibrated):
    LAI (ORNL DAAC...).csv          ← open-field/forest measurements
    LAI (TRY Database).csv          ← plant trait database

CAUTION: ORNL/TRY values overestimate urban GPR by 30-60%.
Use only field-measured values for formal GPR calculations.
The 37 Singapore species in GreenPlotRatio_LAI Values.csv are the gold standard.
```

---

## Environment

| Item | Detail |
|---|---|
| Local dev server | `python frontend/server.py` → http://localhost:8000 |
| Deployment | Vercel (auto-deploy from GitHub main) |
| Three.js version | r160 (local copy in `frontend/js/`) |
| CDN loaders | OBJLoader, GLTFLoader from jsdelivr (three@0.160) |
| Python | `_myProjects` level `.venv` or system Python for LAI scripts |
| Node.js | Not required (no bundler — importmap used instead) |
