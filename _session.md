# GPRTool-Demo — Session Status

> **Update this file at the end of every session.**
> Keep it short — just enough for Claude or Boon to resume without re-reading the whole journal.

---

## Session 6 — 2026-03-28 ✅ COMPLETE

### Summary
Site alignment fix, map tile overlay, axes overhaul, north point compass, deploy.bat polling.

### What was done
- **Site boundary alignment** — fixed `shapeGeom.rotateX(-π/2)` → `+π/2` (fill was mirrored from outline)
- **Map tile overlay** — CARTO Light tiles load on GeoJSON import; Mercator Y projection fix applied so tiles align with site boundary; "Map Overlay" toggle in right panel
- **Axes overhaul** — replaced custom 2-line helper with 3-axis system: X (red), Z (blue), Y green vertical; Y hidden in 2D plan, shown in 3D; Toggle Axes (Ctrl+T) and View menu item wired
- **North Point** — floating SVG compass inside `#viewport` (position:absolute); needle design iterated with Boon to final shape (points: 32,20 32,40 42,43 / 32,60 32,40 22,37); draggable within viewport; position saved to localStorage (key: gprtool-north-pos-v3); right-click context menu (Reset / Hide); View menu toggle + reset wired; rotates dynamically each animation frame to track true north in both 2D and 3D; size 77×86px
- **deploy.bat** — rewritten with Vercel polling (poll_vercel.ps1); captures baseline UID before push, waits for READY/ERROR with live timer; deploy.env created with correct GPRTool credentials; deploy.env added to .gitignore

### App state at end of session
**Works:**
- ✅ All Session 5 features still working
- ✅ GeoJSON site boundary: fill and outline now aligned
- ✅ Map tile overlay (CARTO Light, zoom 18, Mercator-correct placement)
- ✅ Map Overlay toggle in right panel
- ✅ Axes: X/Z in 2D plan, X/Y/Z in 3D, Toggle Axes wired (Ctrl+T)
- ✅ North Point: correct position (bottom-right of viewport), correct icon, draggable, rotates with camera
- ✅ deploy.bat polls Vercel and reports READY with elapsed time

**Stubbed (not yet built):**
- ❌ IFC import
- ❌ DXF import
- ❌ Image underlay + scale calibration
- ❌ All Building panel drawing tools
- ❌ Landscape panel tools
- ❌ GPR Report PDF export
- ❌ Terrain layer
- ❌ Landgate SLIP address lookup
- ❌ .gpr session save/load
- ❌ Module split (index.html ~130KB monolith)

---

## Next Session — Where to Start

1. **Verify** north point rotates correctly on import of 30 Beaufort Street GeoJSON
2. **Pending issues from this session:**
   - Map tile / site boundary alignment still needs visual verification — tiles may still be slightly off
   - Axes in 2D surface canvas mode (when a surface is selected) — check Y is hidden
3. **Next feature** — DXF import (was the priority before this session)

---

## Key Reference

| Item | Value |
|---|---|
| Live URL | https://gprtool-demo.vercel.app |
| Local dev | `start.bat` → http://localhost:8000 |
| Demo site | 30 Beaufort Street, Perth WA 6000 |
| Site GeoJSON | `test-data/30_beaufort_street_parcel.geojson` |
| Landgate land_id | 1818174 |
| GitHub | https://github.com/lotr2929/GPRTool-Demo.git |
| Three.js | r160 (local copy in `frontend/js/`) |
| Deploy | run `deploy.bat` from project root |
| Vercel project ID | prj_oioZB5jSKFHb99IZcSxZutIcjufi |
| North Point key | gprtool-north-pos-v3 |
