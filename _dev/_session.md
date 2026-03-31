# GPRTool — Session Status

**Last updated:** 2026-03-30 (Session 7)
**Live:** https://gprtool-demo.vercel.app

---

## What was done this session

### North Point 2D — aesthetic refinements
- DN line extended full diameter (y=18 to y=62) — replaces arrowhead
- Arrowhead replaced with dot (cy=24, r=3)
- Circle fill removed (transparent)
- South triangle fill restored to solid white
- All stroke widths halved (circle, dashes, triangle outline, DN shaft → 0.75/0.6)
- N label given `id="np-n-label"` for targeting

### DN label repositioning (per-frame)
- Label now centred above circle top (y=14) by default
- When N is within ±40° of top: label shifts left or right away from N
- Positioning handled every frame in `updateNorthRotation` — no static positioning in `applyDesignNorth`

### Rotate N Point — right-click context menu command
- New context menu item: "Rotate N Point…"
- Opens DN input panel + enters `rotateMode`
- In rotate mode: dragging anywhere on the icon rotates it (changes `designNorthDeg`)
- Icon gets green outline + crosshair cursor while in rotate mode
- `rotateMode` flag hijacks drag handler — `onDragDown` routes to rotate logic instead of move
- Angle field updates live during drag
- All N-drag code removed after repeated failures — right-click command is the reliable entry point
- **Exit:** click outside both the DN panel and the NP icon green rectangle

### Key handling
- Capture-phase `keydown` listener (`onDNKeyCapture`) intercepts Enter + Escape before global handlers
- Enter commits value, Escape exits — both work when field has focus
- Exit also works by clicking outside the NP icon + panel zone

### deploy.bat
- Commit message date format changed to `30MAR26 14:32` (ddMMMyy HH:mm, uppercase)
- Commit message line prints in cyan via PowerShell `Write-Host`
- Duplicate Write-Host above removed — single cyan line only

### Render cleanup
- Identified old GPRToolDemo service on Render still auto-deploying on every GitHub push
- Fix: Render dashboard → GPRToolDemo workspace → My project → GPRToolDemo service → Settings → disable Auto-Deploy or delete service

### DevTools debugging protocol (agreed)
- For all future UI/interaction bugs: get browser console output BEFORE proposing code changes
- Never guess at event sequences — observe first, fix once

---

## Current state

- All changes deployed to Vercel
- Rotate N Point: rotation works, enter/escape works, click-outside exits correctly
- DN label repositioning per-frame: working
- Render auto-deploy: pending manual fix in Render dashboard

---

## Pending — next session

### True North architecture (agreed design, not yet coded)
Three angles:
1. `trueNorthAngle` — geographic north vs world -Z. Auto = 0 for GeoJSON. User-set for OBJ/GLB.
2. `designNorthAngle` — site orientation reference (already implemented as DN arrow)
3. `rotate2D` — viewport rotation, independent of both

NP icon shows: `trueNorthAngle - rotate2D` (currently assumes trueNorthAngle = 0)

### 2D viewport rotation (coded, deployed)
- Middle mouse drag = rotate 2D view
- N key = snap back to north-up
- `rotate2D` passed to `initNorthPoint2D` via getState callback

### lib/ subfolder
- `frontend/js/lib/` subfolder for Three.js files not yet created

### localStorage key cleanup
- Old keys `gprtool-north-pos-v3` and `gprtool-north-scale-v1` no longer used

### Local AI stack (discussed, not yet implemented)
- Download `qwen3.5:35b-a3b` (MoE model, ~3.5b active params, fits hardware)
- Pipeline: `qwen3.5:35b-a3b` for reasoning/planning → `qwen2.5-coder:7b` for code generation
- Wire into Mobius as `Ask: Plan` + `Ask: Build` commands
- Use local models for fast iteration; Claude for architecture and cross-file reasoning
