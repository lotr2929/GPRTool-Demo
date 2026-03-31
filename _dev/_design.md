# GPRTool — Design & Development Guide

**Last Updated**: 2026-03-19
**Project**: Browser-based GPR Calculation Tool with 2D/3D CAD Interface
**Architecture**: Static PWA (Vercel) + Supabase (protected LAI database) + Three.js frontend
**Status**: ✅ Live on Vercel | ✅ UI Redesign Complete | ⏳ 3D model import next

---

## TABLE OF CONTENTS

1. [Quick Start](#quick-start)
2. [What GPR Is](#what-gpr-is)
3. [Project Vision](#project-vision)
4. [Design Paradigm](#design-paradigm)
5. [GPR Formula](#gpr-formula)
6. [LAI Reference Values](#lai-reference-values)
7. [Architecture](#architecture)
8. [UI Architecture](#ui-architecture)
9. [Deployment](#deployment)
10. [LAI Database Strategy](#lai-database-strategy)
11. [Feature Roadmap](#feature-roadmap)
12. [File Registry](#file-registry)
13. [Development Workflows](#development-workflows)
14. [Debugging Guide](#debugging-guide)
15. [References](#references)

---

## 1. QUICK START

- **Local Dev**: `http://localhost:8080/index.html`
- **Production**: `https://gprtool-demo.vercel.app` ✅ Live
- **Repository**: `https://github.com/lotr2929/GPRTool-Demo.git`
- **Local Path**: `C:\Users\263350F\_myProjects\GPRTool-Demo`

### Essential Commands (run from project root)
```batch
start.bat            # Start local dev (frontend + browser)
close.bat            # Stop local dev servers
github-publish.bat   # Push to GitHub → triggers Vercel auto-deploy
```

### Local Dev Stack
- **Frontend**: Three.js, served by `frontend/server.py` on port 8080
- **Backend**: FastAPI retired — architecture is now fully client-side static
- **Deployment**: Vercel (static site, root directory = `frontend/`)

---

## 2. WHAT GPR IS

**Green Plot Ratio (GPR)** measures how much green leaf area a development provides relative to the site area it occupies. It answers one question: *how much nature did this building give back?*

Urban development replaces permeable, biodiverse land with hard surfaces. GPR is the mechanism for quantifying and requiring compensation — not just ground coverage, but the full three-dimensional green volume a site generates. A building with a green roof, vertical gardens, and a landscaped podium can exceed the green value of the undeveloped site it replaced. That is the ambition.

### What GPR quantifies

All the following ecological functions are directly proportional to leaf area:

**Urban heat island mitigation** — Leaves drive evapotranspiration which cools surrounding air. Shading from canopy reduces surface temperatures. Both effects scale with leaf area.

**Biodiversity support** — Canopy structure, species diversity, and leaf area determine habitat value. GPR provides a minimum quantitative threshold for planning compliance.

**Stormwater management** — Leaves intercept rainfall before it reaches impervious surfaces. Root systems absorb water and slow runoff.

**Carbon sequestration** — Carbon uptake through photosynthesis is directly tied to leaf area and biomass accumulation.

**Air quality** — Leaf surfaces capture particulate matter, absorb gaseous pollutants, and produce oxygen. All three effects scale with leaf area.

**Human wellbeing** — A substantial evidence base links exposure to green vegetation to reduced stress, improved mental health, faster recovery from illness, and increased physical activity.

### Why the calculation is hard

Most green metrics count area — square metres of grass, number of trees. GPR counts **leaf area**, which is a proxy for all the ecological functions above.

A mature *Ficus benjamina* and a lawn patch of the same footprint are not ecologically equivalent. The *Ficus* may have 50× the leaf area. GPR captures that difference — but only if the LAI values feeding the calculation are valid for actual urban conditions.

**Leaf Area Index (LAI)** is defined as the total one-sided area of leaf tissue per unit ground surface area (m²/m², dimensionless). LAI varies from 0.5 for sparse groundcovers to 8+ for dense tropical trees, and varies significantly within a species depending on growing conditions.

All existing LAI databases (ORNL Global LAI, TRY Plant Trait Database) were compiled for ecological and forestry research in natural or plantation settings. Urban greenery operates under fundamentally different constraints:

| Factor | Open Ground | Urban Condition |
|--------|-------------|-----------------|
| Root volume | Unlimited | Restricted by planter, soil depth |
| Substrate depth | Natural soil profile | 200–1500mm typical for podiums/roofs |
| Light | Full sun | Variable — atrium, north wall, overshadowed |
| Wind | Normal | Elevated on rooftops, channelled in streets |
| Pruning | None | Regular, reduces canopy density |
| Installation type | Ground planting | Rooftop, vertical, atrium, street tree pit |

Urban trees in street tree pits typically show 30–50% lower LAI than the same species in open ground. **This means every LAI value in current databases carries a hidden assumption: natural or near-natural conditions.** Using these values without adjustment systematically overstates GPR.

The field measurements conducted by Boon Lay Ong and Dr Tan (Singapore, 2009) are among the very few published LAI values measured directly in urban conditions. They form the primary source for GPRTool's plant library.

---

## 3. PROJECT VISION

### What GPRTool Is

GPRTool is a **landscape design and GPR calculation tool**. It is invented by Boon Lay Ong, who is also its domain authority and developer.

**The 3D model is the base. The landscape design is the work. The LAI database is the product.**

The 3D model — whether imported from an architect or built simply within GPRTool — defines the surfaces available for landscape design. The real work happens on those surfaces: the landscape architect designs in 2D on each surface, GPRTool assembles the result into a 3D model with plants correctly placed, and calculates GPR across all surfaces.

GPRTool does not need to be a full architectural CAD tool because architectural accuracy is not its purpose. A building in GPRTool only needs to be accurate enough to define the ground plane, roof areas, and wall faces correctly. It is a geometry host, not a BIM model.

### What GPRTool Is Not
- Not a BIM tool — buildings are surface hosts, not data-rich models
- Not a full architectural CAD tool — building tools exist only to create surface geometry
- Not a landscape design visualisation tool — geometry and plants serve GPR calculation
- Not a standalone tool — designed to interoperate with the architect's CAD program

### The Two Entry Points

**Path A — Import from architect (typical professional workflow)**
The architect delivers a 3D model (OBJ, IFC, or glTF). The LA imports it into GPRTool, which identifies all available surfaces. The LA selects the surfaces they need to work on and designs the landscape on each one.

**Path B — Build in GPRTool (quick studies, early stage, no model available)**
The LA uses GPRTool's simple massing tools (rectangle, extrude, push/pull) to define the building volumes and site. These tools are not for architectural design — they are for creating surface geometry to work on. Once surfaces exist, the landscape design workflow is identical to Path A.

In both cases the 3D model serves one purpose: **a host for surfaces**.

### The Core Scientific Problem

All existing LAI databases (ORNL, TRY) were compiled for ecological/forestry research — natural forests and plantations, not urban conditions. GPRTool aims to be the first open, auditable **urban-context LAI database** with a transparent calculation framework. That is publishable IP.

### Commercial Model (Planned)

**Free tier**
- Public lite plant library (~50 common species, public-source LAI)
- Full landscape design and GPR calculation functionality
- No registration required

**Registered/subscribed tier**
- Full curated plant library (700+ species with urban adjustment factors)
- Encrypted species bundles for offline/field use
- API key authentication (Google Maps-style long key)
- Subscription revenue unlocked once urban-context LAI layer is scientifically defensible

### GPR Targets and Benchmarks

**Singapore** (where GPR was developed):

| Development Type | GPR Target |
|-----------------|------------|
| Residential (landed) | 2.0–3.0 |
| Residential (high-rise) | 4.0–5.0 |
| Commercial | 3.0–4.0 |
| Mixed-use | 3.5–4.5 |
| Industrial | 1.5–2.5 |

**Australian context**: No mandatory GPR targets exist in Australia as of 2026. GPRTool is positioned as the calculation tool for when such policies are adopted, and as a voluntary optimisation tool in the interim.

**Interpreting the result**:

| GPR Value | Interpretation |
|-----------|----------------|
| < 0.5 | Minimal green — hardscape dominant |
| 0.5–1.0 | Low green — some ground planting |
| 1.0–2.0 | Moderate — ground planting + some elevated green |
| 2.0–3.0 | Good — deliberate multi-layer greening |
| 3.0–5.0 | High — rooftop, vertical, and ground planting combined |
| > 5.0 | Exceptional — intensive three-dimensional greening |

---

## 4. DESIGN PARADIGM

### The Core Workflow

```
3D model established (imported or built in GPRTool)
        ↓
GPRTool identifies all surfaces:
  — Ground plane(s)
  — Roof plane(s) at each level
  — Wall faces (vertical, slanted, curved)
        ↓
LA selects surfaces to work on
        ↓
For each selected surface, GPRTool generates
a flat 2D canvas at real-world scale:
  — Ground/roof → top-down plan
  — Wall → unfolded elevation
        ↓
LA designs on the 2D canvas — either:
  A) Imports a DXF drawn in AutoCAD/Vectorworks
  B) Draws directly in GPRTool using 2D tools
  C) Both — imports a base plan and amends it
        ↓
GPRTool reads plant symbols and areas from
the 2D design and maps them onto the 3D surface
        ↓
Repeat for each surface
        ↓
Toggle to 3D → full model with plants on all surfaces
        ↓
GPR calculated automatically across all surfaces
        ↓
Export GPR Report (PDF) + annotation layer (DXF)
```

The DXF import is **per surface** — each surface canvas can receive its own DXF design, equivalent to a floor plan or facade elevation from the architect's drawing set.

### 2D-First, 3D-Aware

Within GPRTool, the user always designs in **2D symbolic plan** on a surface canvas. The program maintains 3D geometric accuracy behind the scenes. Toggling to 3D view reveals the assembled model.

This mirrors the workflow of Vectorworks Landmark and ArchiCAD:
- The **designer's intent** is expressed through 2D symbols and conventions
- The **geometric truth** is maintained by the program in 3D

The user designs using **symbols** — the same symbolic language used in professional landscape CAD:
- Tree symbols (circle + cross, or species-specific symbol)
- Planting bed outlines (closed polylines)
- Green wall coverage areas (filled regions)
- Lawn/turf areas

Symbols carry **design intent and data** (species, LAI value, coverage), not 3D projections.

### Surfaces as Design Hosts

Everything in GPRTool is placed on a **surface**. A surface is the fundamental design host — green elements are children of a surface, and their 3D position and orientation are derived from it.

| Surface Type | Description | 2D Canvas | 3D Anchor |
|---|---|---|---|
| **Ground plane** | Lawn, paving, planting beds, trees | Top-down plan view | Terrain/DEM surface |
| **Roof plane** | Green roofs, podium planting | Top-down plan view | Top face of building at its height |
| **Wall plane** | Green walls, climbing plants, hedges | Unfolded elevation (UV space) | Vertical, slanted, or curved face |

### Surface Geometry

Surfaces may be:
- **Flat and horizontal** — standard ground plane or flat roof
- **Slanted** — raked roof, battered wall, sloped embankment
- **Curved** — curved building facade, organic landform

GPRTool recognises the geometry of each surface and generates the appropriate 2D canvas automatically. For curved and slanted surfaces, GPRTool unwraps the surface (**UV projection**) so the user draws on a flat canvas, then re-projects placements back onto the 3D geometry. Each element receives a 3D position and a **surface normal** (the direction it grows from). The user never needs to account for curvature or slope.

### The 3D Model — Purpose and Limits

The 3D model in GPRTool is a **surface host**, not an architectural model. It needs to be geometrically accurate in terms of:
- Site boundary and ground level
- Building footprints and storey heights
- Roof geometry (pitch, curvature, level)
- Wall faces (orientation, area)

It does not need: doors, windows, structural detail, material data, MEP, or any BIM information. A simple extruded massing model is sufficient and preferred.

**Building the model in GPRTool** uses simple tools — rectangle, polygon, extrude, push/pull — that create massing volumes, not architectural models. This is intentional and sufficient for the tool's purpose.

### Why This Matters for GPR Accuracy

Because GPRTool maintains accurate 3D geometry, its GPR calculations are more accurate than any flat-plan tool:

- **Ground plane greenery**: LAI × plan area
- **Roof plane greenery**: LAI × roof area at the correct elevation, not projected to ground
- **Wall plane greenery**: LAI contribution derived from projected sky-facing area, varies with surface orientation angle
- **Curved surfaces**: integration of projected area across the full surface geometry

A vertical wall contributes differently to GPR than a 45° slanted surface or a convex curve. GPRTool resolves this automatically — a significant differentiator from any flat-plan calculator.

### CAD Interoperability

| Direction | Format | Content |
|---|---|---|
| **Into GPRTool** | OBJ / IFC / glTF | 3D site + building geometry from architect |
| **Into GPRTool** | DXF (per surface) | 2D landscape design drawn in AutoCAD/Vectorworks |
| **Into GPRTool** | GeoJSON | Site boundary only (cadastral/GIS workflow) |
| **Out of GPRTool** | DXF | GPR annotation layer — planting zones + values |
| **Out of GPRTool** | PDF | GPR Report for planning submission |
| **Session** | `.gpr` | Save/resume GPRTool session (JSON) |

---

## 5. GPR FORMULA

### Basic Calculation

```
GPR = Σ (Aᵢ × LAIᵢ) / A_site
```

Where:
- `Aᵢ` = plan area of planted element i (m²)
- `LAIᵢ` = Leaf Area Index assigned to element i
- `A_site` = total site area (m²)

### Vertical Greenery

For green walls, the planted area is the **vertical surface area**, not the plan footprint:

```
A_wall = width × height (m²)
```

A 10m × 3m green wall has 30m² of planted area regardless of plan footprint. This is what makes vertical greenery powerful in GPR terms — it generates leaf area without consuming site area.

### Slope Correction (V2)

On sloped terrain, the actual planted surface area exceeds the plan area:

```
A_slope = A_plan / cos(θ)
```

A 30° slope increases effective planted area by ~15%. GPRTool implements slope-aware calculation in V2 when terrain is integrated.

### Stacking

GPR stacks vertically. Ground planting + podium garden + green walls + green roof all contribute. The total GPR is the sum of all contributions divided by site area. There is no penalty for stacking — this rewards three-dimensional green design.

### Urban Adjustment Factors (Research in Progress)

Proposed schema for future implementation:

| Installation Type | Adjustment Factor |
|---|---|
| Ground planting, deep soil (>1m) | 1.0 |
| Podium garden, medium substrate (400–1000mm) | 0.7–0.9 |
| Rooftop, shallow substrate (150–400mm) | 0.4–0.7 |
| Rooftop, extensive (<150mm) | 0.3–0.5 |
| Street tree, standard pit | 0.5–0.7 |
| Street tree, structural soil | 0.7–0.9 |
| Vertical greenery, soil-based | 0.7–0.9 |
| Vertical greenery, hydroponic | 0.8–1.0 |
| Atrium planting | 0.6–0.8 |

**Important caveat:** These ranges are indicative estimates based on expert judgement, not measured data. They are not currently applied in GPRTool calculations. Until a peer-reviewed urban LAI calibration study exists, GPRTool uses the best-available measured LAI directly (Singapore field data where available; ORNL/TRY otherwise) and discloses the source provenance to the user.

### LAI Context Variability — Research Programme

LAI is not a fixed species property. It varies substantially with climate zone, urban vs natural context, installation type, light availability, and measurement method. The same species can yield values differing by 2–10× across these contexts. This is the central scientific limitation of all current GPR implementations.

**Current database confidence tiers:**
- **Tier 1 (urban field-measured):** 35 species — Singapore field data, Boon & Tan 2009. These are the only defensible urban LAI values currently available.
- **Tier 2 (open-ground measured):** ~725 species — ORNL/TRY databases. Valid measurements but in natural/plantation contexts. Urban LAI will typically be 30–60% lower.
- **Tier 3 (estimated):** Not yet added to database.

**The research programme required to resolve this** involves systematic field measurement campaigns across climate zones (tropical, subtropical, temperate Mediterranean), controlled installation-type experiments, and peer-reviewed publication of an urban LAI adjustment framework. Estimated scope: AUD 500K–2M. This is a separate research project, not a development task.

**GPRTool's role in the meantime:**
- Always display the source and confidence tier alongside every LAI value
- Never silently apply adjustment factors without measured backing
- Make the uncertainty visible to the user, not hidden in the calculation
- Position the tool as the delivery mechanism for the research output once it exists

Full context variability analysis is documented in `GPR - LAI Values/LAI_DATABASE_STRATEGY.md`.

---

## 6. LAI REFERENCE VALUES

### Field-Measured Urban Values (Ong & Tan, Singapore 2009)

Primary source measurements in urban conditions — take precedence over all other sources.

| Species | LAI | Notes |
|---------|-----|-------|
| Agrostis capillaris | 8.40 | Grass |
| Arrhenatherum elatius | 7.66 | Grass |
| Alopecurus pratensis | 7.65 | Grass |
| Anthoxanthum odoratum | 7.34 | Grass |
| Clinopodium vulgare | 6.93 | Herb |
| Acer spicatum | 6.91 | Tree |
| Anthyllis vulneraria | 5.52 | Shrub |
| Digitalis purpurea | 5.42 | Herb |
| Arctium lappa | 4.72 | Herb |
| Aextoxicon punctatum | 4.60 | Tree |
| Dacryodes rostrata | 1.06 | Tree |
| Canarium denticulatum | 1.05 | Tree |
| Cleistanthus paxii | 0.98 | Tree |
| Dacryodes laxa | 0.96 | Tree |
| Cleistanthus baramicus | 0.89 | Shrub |
| Aporusa lucida | 0.86 | Tree |
| Canarium pilosum | 0.71 | Tree |
| Cornus stolonifera | 0.23 | Shrub |

*Full list in `GPR - LAI Values/GreenPlotRatio_LAI Values.csv`*

### General LAI Ranges by Plant Type

Indicative ranges from open-ground measurements. Apply urban adjustment factors for constrained conditions.

| Plant Type | LAI Range | Typical Urban Value |
|---|---|---|
| Mature canopy tree (tropical) | 3.0–8.0 | 2.0–5.0 |
| Mature canopy tree (temperate) | 2.0–6.0 | 1.5–4.0 |
| Street tree (pit-planted) | 1.0–4.0 | 0.8–2.5 |
| Dense shrub | 2.0–5.0 | 1.5–3.5 |
| Groundcover | 1.0–4.0 | 0.8–3.0 |
| Lawn / turf grass | 1.5–5.0 | 1.5–4.0 |
| Green roof — extensive | 0.5–2.0 | 0.5–1.5 |
| Green roof — intensive | 1.5–5.0 | 1.0–4.0 |
| Vertical greenery | 1.5–4.0 | 1.0–3.0 |
| Bamboo | 2.0–6.0 | 1.5–4.5 |
| Palm | 1.0–3.0 | 0.8–2.5 |

### GPR Overlay Scale
- Range: 0–10 LAI units
- Display: graduated green shading per zone
- Maximum field-measured: 8.40 (Agrostis capillaris, Singapore)
- Urban maximum practical: ~10

---

## 7. ARCHITECTURE

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    USER BROWSER                         │
│    Three.js CAD | GPR Engine | GIS Viewer               │
│         (all calculation client-side)                   │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
               │ Static assets            │ LAI lookup (API key, future)
               ▼                          ▼
┌──────────────────────┐    ┌─────────────────────────────┐
│   Vercel (free)      │    │   Supabase (future)         │
│   Static PWA host    │    │   Protected LAI database    │
│   Edge Functions     │    │   Row Level Security        │
└──────────────────────┘    └─────────────────────────────┘
               │
               │ Terrain + elevation (future)
               ▼
┌────────────────────────────────────────────────────────┐
│   OpenTopography SRTM / Mapbox Terrain                 │
│   Site elevation mesh                                  │
└────────────────────────────────────────────────────────┘
```

### Key Technology Decisions
- **No backend** — fully static, all logic in the browser
- **Three.js** — 3D scene, geometry, rendering
- **No build step** — vanilla JS with importmap resolving `"three"` to local file
- **Outfit font** — loaded from Google Fonts
- **`.gpr` format** — planned native session format (JSON schema, TBD)

### 3D Model Import Formats

GPRTool accepts three formats, covering all major CAD tools:

| Format | Source tools | Three.js loader | Notes |
|---|---|---|---|
| **OBJ** | SketchUp, Revit, ArchiCAD, Vectorworks, AutoCAD | `OBJLoader` (CDN) | Simplest, universal, geometry only |
| **IFC** | Revit, ArchiCAD, Vectorworks | `web-ifc` WASM (CDN) | Semantic data — surfaces know their type |
| **glTF/GLB** | Blender, newer BIM tools, converters | Native Three.js | Modern, efficient, web-native |

All loaders run entirely in the browser — no server upload required.

**Surface type detection:**
- **OBJ/glTF**: inferred from face normal direction — horizontal up = ground/roof, vertical = wall. User can override in properties panel.
- **IFC**: inferred from semantic element type — IfcSlab = ground/roof, IfcWall = wall. More reliable, no user input needed.

---

## 8. UI ARCHITECTURE

### Layout

```
┌─────────────────────────────────────────────────────┐
│  HEADER: [↩↪] [File][Edit][Navigation][View][Help]  │
│                    GPRTool Logo                      │
├──────────┬──────────────────────────┬───────────────┤
│  TOOLS   │                          │  PROPERTIES   │
│          │       VIEWPORT           │               │
│  Site    │    (Three.js canvas)     │  Site info    │
│  Building│                          │  Selection    │
│  Landscape    [2D|3D toggle]        │  GPR summary  │
│  Plants  │                          │               │
├──────────┴──────────────────────────┴───────────────┤
│  STATUS BAR: [2D] | message                         │
└─────────────────────────────────────────────────────┘
```

### Menu Structure

**FILE**
```
New                    Ctrl+N
Open…                  Ctrl+O    (.gpr session)
Save                   Ctrl+S
Save As…               Ctrl+Shift+S
─────
Import 3D Model…       (OBJ, IFC, glTF/GLB — from architect)
Import Site Boundary…  (GeoJSON — cadastral workflow)
Import Site Image…     (JPG, PNG — underlay reference)
Import Landscape…      (DXF — per surface, from AutoCAD/Vectorworks)
─────
Export GPR Annotations… (DXF — return to architect's CAD)
Export GPR Report…      (PDF — planning submission)
─────
Preferences…
```

**EDIT**
```
Undo                   Ctrl+Z
Redo                   Ctrl+Shift+Z
─────
Select / Move          V
Select All             Ctrl+A
Deselect All           Esc
Delete                 Del
─────
Construction Line
Construction Point
Offset Guide
Dimension
─────
Clear Guides
```

**NAVIGATION**
```
Fit to Site            Ctrl+F
Zoom
Pan
Orbit                  (3D only)
```

**VIEW**
```
Toggle Grid            Ctrl+G
Toggle Axes            Ctrl+T
North Pointer
─────
Isometric              Ctrl+I
Top
Front
─────
Show Hidden…
```

**HELP**
```
About Green Plot Ratio
About GPRTool
─────
Documentation
```

### Left Panel — Four Collapsible Sections

**SITE**
- Import 3D Model… (OBJ / IFC / glTF — from architect)
- Import Site Boundary… (GeoJSON)
- Import Site Image… (underlay)
- Set Scale
- Set North
- Clear Site

**BUILDING** *(surface creation tools — not full architectural CAD)*
- Rectangle (Shift = square)
- Ellipse (Shift = circle)
- Polygon
- Line
- 3-Point Arc
- Tangent Arc
- Offset
- Edit Points
- Extrude (Push/Pull)
- Subtract (boolean cut)

**LANDSCAPE** *(per-surface design tools)*
- Select Surface (activates 2D canvas for selected surface)
- Import Landscape DXF… (attach DXF to selected surface)
- Planting Bed
- Wall
- Component Library… (V2)

**PLANTS**
- Plant Library…
- Clear All Plants

### Right Panel — Properties
- Empty state until model loaded
- Model info: Surface count, total site area
- Selected surface: Type (ground/roof/wall), Area, Level/elevation, Normal angle
- Selected plant element: Species, LAI, Coverage area, GPR contribution
- GPR section: Overlay toggle, Plant Schedule toggle, Target GPR input, Current GPR result
- Generate GPR Report button (only here)

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z |
| Select All | Ctrl+A |
| Select / Move | V |
| Delete | Del |
| Fit to Site | Ctrl+F |
| Toggle Grid | Ctrl+G |
| Toggle Axes | Ctrl+T |
| Isometric | Ctrl+I |
| Cancel / Deselect | Esc |
| Save As | Ctrl+Shift+S |

### 2D/3D Toggle
- Square icon = 2D canvas for selected surface
- Cube icon = full 3D model view
- Located top-right of viewport, always visible
- Active mode shown in status bar

### Touchpad Navigation

| Gesture | Action |
|---------|--------|
| 1-finger drag | Rotate (3D) / Pan (2D) |
| 2-finger drag | Pan (3D) |
| Pinch | Zoom |
| Scroll | Zoom |

---

## 9. DEPLOYMENT

### Production
- **URL**: https://gprtool-demo.vercel.app
- **Platform**: Vercel Hobby (free)
- **Root directory**: `frontend/`
- **Build command**: none (static site)
- **Auto-deploy**: every push to `main`

### GitHub
```
origin: https://github.com/lotr2929/GPRTool-Demo.git
branch: main
```

### Deploy Sequence
```batch
github-publish.bat
# Enter commit message when prompted
# Vercel auto-deploys within ~30 seconds
```

---

## 10. LAI DATABASE STRATEGY

*Full strategy: `GPR - LAI Values/LAI_DATABASE_STRATEGY.md`*

### Primary Source — Field Measurements
`GreenPlotRatio_LAI Values.csv` — 37 species measured by Boon Lay Ong and Dr Tan in Singapore. **Primary source urban-context measurements** — take precedence over all other sources.

### Secondary Sources — ORNL / TRY
760 species from ORNL Global LAI and TRY Database. **Important caveat**: measured in open/ideal conditions, not urban. Urban LAI calibration is a future research priority.

### Current Processed Data

| File | Contents |
|------|----------|
| `GreenPlotRatio_LAI Values.csv` | 37 species, field-measured Singapore (primary) |
| `LAI_combined_clean.csv` | All unique species from ORNL + TRY |
| `LAI_tropical_subset.csv` | Tropical/subtropical flagged species |
| `LAI_categorised.csv` | 760 species with category assignments |
| `Material Library.csv` | Working GPRTool species library |

### Category Counts

| Category | Count |
|----------|-------|
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

### Pending Database Work
- [ ] Merge Singapore field measurements into `LAI_categorised.csv`
- [ ] Resolve duplicate species in `GreenPlotRatio_LAI Values.csv` (Anthoxanthum odoratum × 2, Calamagrostis epigejos × 2)
- [ ] Manually categorise 55 REVIEW species
- [ ] Extract Tan & Sia 2009 PDF species list and urban LAI values
- [ ] Assess AusTraits for Australian species coverage
- [ ] Define urban adjustment factor schema (installation type × substrate × light)
- [ ] Build curated 50–100 species free-tier library

### Mobius Factory Integration (Planned)

A **Urban Greenery & LAI Knowledge Layer** is a natural Mobius Factory module. The Factory crawls peer-reviewed urban LAI measurements, Singapore NParks/BCA guidelines, Hong Kong BEAM Plus studies, living wall manufacturer data, and papers citing Tan & Sia 2009. Output stored in Supabase; `lai_data.py` periodically updated from Factory output. Every LAI value traceable to source, methodology, and urban context — self-improving and citable.

---

## 11. FEATURE ROADMAP

### MVP Phase 1 — 3D Model Import + Surface Selection
- [x] Vercel deployment live
- [x] GeoJSON site boundary import → 2D/3D view
- [x] Site area and perimeter calculation
- [x] Dynamic grid and axes
- [x] Professional UI redesign
- [x] Menu architecture, keyboard shortcuts, touchpad navigation
- [ ] Push current state to GitHub
- [ ] **OBJ import** — Three.js OBJLoader via CDN importmap
- [ ] **glTF/GLB import** — Three.js native GLTFLoader
- [ ] **IFC import** — web-ifc WASM via CDN
- [ ] Surface detection from face normals (OBJ/glTF) and element type (IFC)
- [ ] Surface selection — click face in 3D → highlight + properties panel shows type/area/level
- [ ] Surface list panel — all detected surfaces listed, selectable

### MVP Phase 2 — Landscape Design per Surface
- [ ] Select surface → enter 2D canvas mode (UV-unwrapped, real-world scale)
- [ ] **Import Landscape DXF** onto selected surface canvas
- [ ] DXF registration — align DXF origin/scale to surface
- [ ] Read plant symbols and planting areas from DXF
- [ ] Draw directly on surface canvas using landscape tools (planting bed, tree symbol)
- [ ] Green elements projected back onto 3D surface geometry
- [ ] Toggle 3D → see all surfaces with plants assembled

### MVP Phase 3 — GPR Calculation + Export
- [ ] Free-tier plant library (50 species, bundled JSON)
- [ ] Assign species + LAI to plant elements
- [ ] GPR calculation engine — sum across all surfaces, divide by site area
- [ ] GPR overlay — graduated green shading per zone
- [ ] **DXF export** — GPR annotation layer for return to architect's CAD
- [ ] **PDF export** — GPR Report for planning submission

### V2 — Terrain + Advanced Surfaces
- [ ] Terrain layer — OpenTopography SRTM elevation mesh
- [ ] Slope-aware GPR calculation
- [ ] Curved surface UV unwrapping
- [ ] North Pointer, image underlay with scale calibration
- [ ] Supabase LAI lookup (registered tier), API key authentication

### V3 — Building Tools
- [ ] Rectangle, Ellipse, Polygon drawing
- [ ] 3-Point Arc, Tangent Arc, Offset, Edit Points, Dimension
- [ ] Construction lines and guides
- [ ] Extrude (Push/Pull), Subtract (boolean)
- [ ] For users building massing geometry from scratch in GPRTool

### V4 — Data & Session
- [ ] `.gpr` session format (save/open)
- [ ] Encrypted species bundle download
- [ ] Subscription management

### V5 — Commercial
- [ ] Mobius Factory Urban Greenery Knowledge Layer
- [ ] Urban adjustment factor schema
- [ ] Component library (pergola, seat, water feature)

---

## 12. FILE REGISTRY

### Project Root

| File | Purpose |
|------|---------|
| `start.bat` | Start local dev |
| `close.bat` | Stop local dev servers |
| `github-publish.bat` | Push to GitHub → Vercel auto-deploy |
| `_design.md` | This file — design and development guide |
| `_journal.md` | Session log |

### Frontend (`frontend/`)

| File | Purpose |
|------|---------|
| `index.html` | Main entry point — all JS lives here |
| `header.html` | Header bar (menu, undo/redo, logo, clock) |
| `body.html` | Left panel, viewport, right panel, status bar |
| `styles.css` | Complete design system |
| `server.py` | Local dev HTTP server (port 8080, no-cache) |
| `js/three.module.js` | Three.js library |
| `js/OrbitControls.js` | Camera orbit/pan/zoom controls |
| `images/gpr-logo.png` | App logo |

### LAI Data (`GPR - LAI Values/`)

| File | Purpose |
|------|---------|
| `GreenPlotRatio_LAI Values.csv` | Primary — field-measured Singapore |
| `LAI_categorised.csv` | 760 species, categorised |
| `LAI_combined_clean.csv` | ORNL + TRY combined |
| `LAI_tropical_subset.csv` | Tropical/subtropical subset |
| `LAI_DATABASE_STRATEGY.md` | Full database strategy |
| `Tan, Sia - 2009...pdf` | Foundational GPR/LAI reference |

### Python Scripts (Root)

| File | Purpose |
|------|---------|
| `lai_explorer.py` | ORNL + TRY → combined clean CSV |
| `lai_categorise.py` | Genus-based auto-categoriser |
| `lai_count.py` | Species type counter |
| `accdb_export.py` | Access DB export (DB confirmed empty) |

---

## 13. DEVELOPMENT WORKFLOWS

### Deploying
```batch
github-publish.bat
# Enter commit message
# Vercel deploys automatically from main branch
```

### Local Dev
```batch
start.bat
# Opens http://localhost:8080/index.html
```

### Adding a Three.js Loader (CDN pattern)
```javascript
// In index.html importmap, add:
"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160/examples/jsm/"

// Then import:
import { OBJLoader }  from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
```

### Updating the LAI Database
1. Edit `GPR - LAI Values/LAI_categorised.csv`
2. Run `lai_categorise.py` to regenerate
3. When ready for Supabase: upload via dashboard → Table Editor

---

## 14. DEBUGGING GUIDE

**Frontend not updating after edit**
Hard refresh: `Ctrl+Shift+R`

**Port 8080 in use**
```batch
netstat -ano | findstr :8080
taskkill /PID <pid> /F
```

**GeoJSON not loading**
- Check browser console (F12) for errors
- Verify valid GeoJSON with Polygon or MultiPolygon geometry
- Test at https://geojson.io

**2D/3D toggle not appearing**
- Toggle is hardcoded in `body.html` — not JS-created
- Check `#viewport` has `position: relative` and `isolation: isolate`

**OBJ not loading**
- Check browser console for CORS or parse errors
- MTL material references: optional — GPRTool loads geometry only
- Units: OBJ has no inherent unit — GPRTool assumes metres

**IFC not loading**
- web-ifc requires WASM — check network tab for wasm fetch errors
- Large IFC files (>50MB) may be slow — export a simplified massing model

---

## 15. REFERENCES

**Primary**
- Ong, B.L. (2003). Green plot ratio: an ecological measure for architecture and urban planning. *Landscape and Urban Planning*, 63(4), 197–211.
- Tan, P.Y. & Sia, A. (2009). *LAI of tropical plants: a guidebook on its use in the calculation of Green Plot Ratio*. National Parks Board, Singapore.

**LAI Databases**
- ORNL DAAC (2011). *Global database of LAI for woody plants 1932–2011*. Oak Ridge National Laboratory.
- TRY Plant Trait Database. https://www.try-db.org/

**Urban Greening Policy**
- Urban Redevelopment Authority, Singapore. *Landscaping for Urban Spaces and High-Rises (LUSH)* guidelines.
- Building and Construction Authority, Singapore. *Green Mark* scheme technical guidelines.

## Phase 2 — Plant Placement and GPR Calculation

### Core workflow
1. User selects a surface → enters 2D canvas
2. Picks a plant category from the toolbar (Tree / Shrub / Ground cover / Climber / Green roof)
3. Places symbol on canvas using the appropriate tool
4. Optionally assigns a species from the LAI database (or uses category default LAI)
5. GPR calculated and updated automatically

### Plant categories and symbols

| Category | Symbol | Tool | LAI source |
|---|---|---|---|
| Tree | Circle (canopy radius) | Click to place | Species LAI × canopy area |
| Shrub | Small filled circle | Click to place | Species LAI × canopy area |
| Ground cover / Grass | Hatch polygon | Draw closed polygon | Category default LAI × bed area |
| Climber | Vertical line pattern | Surface fill toggle | Species LAI × surface area |
| Green roof / Lawn | Flat hatch | Surface fill toggle | Category default LAI × surface area |

### Database linkage philosophy
- User selects species from the LAI database — LAI is already known, never entered manually
- Plant symbol type (category) determines how area is calculated for GPR
- Species assignment is optional — category default LAI used if no species selected
- Database is an ongoing enrichment task, separate from the tool
- Singapore field CSV (37 species, Boon + Dr Tan) is the primary source and highest priority for merge
- ORNL/TRY values require urban calibration before use — flagged as future research

### GPR calculation per element
- **Tree**: LAI × projected canopy area (circle area from radius)
- **Shrub**: LAI × projected canopy area
- **Ground cover**: LAI × bed polygon area
- **Climber / Vertical green**: LAI × wall surface area (user-defined coverage %)
- **Green roof**: LAI × surface area
- **Total GPR** = sum of all green element LAI×area / site area

### Phase 2 build order
1. Plant toolbar in left panel (category buttons)
2. Tree placement tool — click on canvas, draw canopy circle
3. Ground cover tool — draw closed polygon on canvas
4. Surface fill tool — assign LAI to entire surface
5. GPR live calculation and display in right panel
6. Species picker — dropdown linked to LAI database CSV
7. Plant schedule — list of all placed elements with species, area, LAI, contribution

---

## SketchUp Interoperability

SketchUp `.skp` files cannot be opened directly in a browser — the format is proprietary binary (Trimble) with no open-source JavaScript parser. GPRTool will never support direct SKP import.

**SketchUp licensing reality:**
- **SketchUp Free (web)** — no 3D export at all. Saves SKP only.
- **SketchUp Go** (~AUD $170/yr) — still no 3D export.
- **SketchUp Pro** (~AUD $500/yr) — OBJ, FBX, DAE, STL, and glTF/GLB (native since 2025).

So OBJ and glTF export both require a paid Pro licence. There is no free SketchUp export path.

**Practical free alternatives:**

**Option A — SKP online converter (if you already have a SKP file)**
- Upload to https://imagetostl.com/convert/file/skp/to/gltf
- Download as GLB, import into GPRTool
- Limitation: curved surfaces and textures are dropped; plain massing geometry works fine

**Option B — Blender (free, recommended for new models)**
- Free, open source, excellent OBJ and glTF export
- For simple building massing: Add → Mesh → Cube, scale and extrude faces
- File → Export → glTF 2.0 (.glb) — works perfectly with GPRTool

**Option C — SketchUp Pro (if licence available)**
- File → Export → 3D Model → glTF Binary (.glb)
- Built-in since SketchUp 2025, no plugins needed

**Modelling tips for GPRTool compatibility (any tool):**
- Model in metres
- Keep it as a simple massing — no doors, windows, or interior detail
- Give each surface type its own object/group (site, podium, tower, roof)
- Building base at Y=0 (ground plane)
- Avoid interior faces — reversed normals confuse surface classification
- Avoid curved geometry for now (imports correctly but surface detection is per-bounding-box)

---

## Curved and Complex Building Geometry

**Status**: Deferred — V2+

GPRTool receives geometry from architects, it does not model it. Complex curved buildings are imported as glTF/OBJ triangulated meshes.

**Works today**: import, surface detection, edge overlay, junction detection, GPR area calculation.

**V2 work needed**: UV unwrapping for curved surface 2D canvas. For V1, curved surfaces use Surface mode (camera looks along each panel's normal), user works panel by panel. Area calculation should use actual triangle areas not bounding box estimates — flag for Phase 3.

---

**Tools**
- Three.js: https://threejs.org/docs/
- web-ifc: https://github.com/ThatOpen/engine_web-ifc
- OpenTopography SRTM: https://opentopography.org/
- geojson.io: https://geojson.io
- AusTraits: https://austraits.org/
- NParks Flora & Fauna Web: https://www.nparks.gov.sg/florafaunaweb
- FloraBase WA: https://florabase.dpaw.wa.gov.au/
