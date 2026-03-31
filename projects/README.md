# GPRTool Test Data

Two files for testing the two core import workflows.

---

## Workflow 1 — Starting from scratch in GPRTool

**File:** `test_site_scratch.geojson`

Georeferenced site boundary in WGS84 (lon/lat), imported via **Import GeoJSON**.

- Location: Kalamunda foothills, Perth Hills, WA
- Area: ~12,400 m²
- Elevation range: approx 48–62m AHD
- Tests: GeoJSON import → terrain fetch → site display

---

## Workflow 2 — Importing a building from SketchUp / AutoCAD / Revit

**File:** `test_building_import.dxf`

Local-coordinate DXF (R2010), metres, origin at site centroid.
Represents a typical SketchUp or AutoCAD export.

### Building: Kalamunda Mixed-Use Tower

8-storey mixed-use development with sky gardens and roof garden.
Demonstrates GPR's core value: a building can exceed the green value
of the site it replaced through vertical greenery.

```
Storey breakdown:
  FL 1–2  Z=0.0–8.4     Commercial podium (4.2m/floor)
  FL 3–5  Z=8.4–18.6    Residential — stepped back on north (3.6m/floor)
  FL 6    Z=18.6         Sky garden terrace (open planted deck, north face)
  FL 7–8  Z=18.6–28.2   Penthouse residential — stepped back further (4.8m/floor)
  ROOF    Z=28.2         Roof garden (full penthouse footprint)
```

### Green elements (GPR contributors)

| Element            | Layer            | Z (m) | Area (m²) | Notes                        |
|--------------------|------------------|-------|-----------|------------------------------|
| Ground planting    | GROUND_PLANTING  | 0.0   | ~2,800    | 4 beds around podium         |
| Sky garden terrace | SKY_GARDEN       | 18.6  | 800       | FL6 north stepback deck      |
| Roof garden        | ROOF_GARDEN      | 28.2  | 4,864     | Full penthouse roof          |
| **Total green**    |                  |       | **~8,464**|                              |

Site area: ~12,400 m² → **GPR = 8,464 / 12,400 ≈ 0.68** (before LAI weighting)

### All DXF layers

| Layer                  | Entity type   | Z range (m) | Description                          |
|------------------------|---------------|-------------|--------------------------------------|
| SITE_BOUNDARY          | LWPOLYLINE    | 0           | Site perimeter                       |
| GROUND_PLANTING        | LWPOLYLINE    | 0           | 4 planting beds around podium        |
| PODIUM_FOOTPRINT       | LWPOLYLINE    | 0           | FL1–2 commercial base, 80×96m        |
| PODIUM_MASS            | 3DFACE        | 0–8.4       | Podium walls + roof slab             |
| RESIDENTIAL_FOOTPRINT  | LWPOLYLINE    | 8.4         | FL3–5, 80×86m (north stepback)       |
| RESIDENTIAL_MASS       | 3DFACE        | 8.4–18.6    | Residential walls + slab             |
| SKY_GARDEN             | LWPOLYLINE    | 18.6        | FL6 terrace, 80×10m = 800 m²         |
| PENTHOUSE_FOOTPRINT    | LWPOLYLINE    | 18.6        | FL7–8, 64×76m (further stepback)     |
| PENTHOUSE_MASS         | 3DFACE        | 18.6–28.2   | Penthouse walls + roof slab          |
| ROOF_GARDEN            | LWPOLYLINE    | 28.2        | Roof garden, 64×76m = 4,864 m²       |
| TERRAIN_CONTOURS       | POLYLINE (3D) | 50–62       | 2m contours, Z = elevation AHD       |

### What GPRTool needs to do with this file

1. Parse DXF — read layers, entity types, coordinates
2. Display SITE_BOUNDARY as orange site outline (needs georeferencing step)
3. Render building mass in 3D from 3DFACE entities, colour-coded by layer
4. Build terrain from TERRAIN_CONTOURS (interpolate between contour lines)
5. Identify green elements from SKY_GARDEN, ROOF_GARDEN, GROUND_PLANTING layers
6. Extract footprint areas for GPR calculation

### Georeferencing note

DXF files carry no embedded coordinates. The user must align the import
to the site by one of:
- Specifying a known reference point common to both files
- Manual placement: drag + rotate onto the site boundary in GPRTool

---

## Workflow 3 — Simple geometry test object

**Files:** `test_cube.obj` + `test_cube.dxf`

A 10m × 10m × 10m cube centred at the scene origin (X=0, Z=0), base at Y=0.
Use these to test geometry import, 2D/3D rendering, and measurement tools
before working with complex building models.

| Property       | Value            |
|----------------|------------------|
| Width (X)      | 10m              |
| Depth (Z)      | 10m              |
| Height (Y)     | 10m              |
| Footprint area | 100 m²           |
| Origin         | Centred at 0,0,0 |
| Base           | Y = 0            |

Available in two formats:
- `test_cube.obj` — Wavefront OBJ, ready for Three.js direct import
- `test_cube.dxf` — DXF R2010, layers: `BUILDING_FOOTPRINT` + `BUILDING_MASS`

---

## Site summary (both files)

```
Location:      Kalamunda, Perth Hills, WA
Dimensions:    ~170m × 135m
Site area:     ~12,400 m²
Elevation:     48–62m AHD
Terrain slope: ~8% average, SW → NE
```
