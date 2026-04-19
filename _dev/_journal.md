
# GPRTool Session Log — Sat 18 Apr 2026

## Session #25 — Full Modularisation Sprint

### What was done
Full extraction of app.js (3,647 lines) into 9 separate modules. Final app.js: ~1,400 lines.

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

**N-51: Brace-counter must skip strings and template literals**
The `src.index('{', m.start())` approach finds the FIRST `{` — which for `function f(opts = {}) {` 
is inside the default parameter, not the function body. Template literal `${...}` also 
fools brace counters. Fix: use a proper tokeniser or start counting from the LAST `{` 
on the function signature line.

**N-52: State bridge order matters**
`state.renderer = renderer` must come BEFORE any `state.renderer.X` calls.
Pattern: create local const → immediately bridge to state → then use state.*.

**N-53: Property access fixer (`.X` patterns) must also handle `const/let/var X =` declarations**
The fixer regex `(?<!state\.)varname\.prop` correctly replaces `varname.prop → state.varname.prop`
but must NOT match `const varname = new Thing()`. Add a negative lookbehind for declaration keywords.

**N-54: Word-boundary replacement can corrupt `let varname =` declarations**
`re.sub(r'\bvarname\b', 'state.varname', src)` will transform `let varname = null` 
into `let state.varname = null` (syntax error). Add negative lookbehind for `let|const|var\s+`.

**N-55: ES module imports are read-only bindings**
Cannot do `importedFn = function() {}` to monkey-patch an imported function.
Options: (a) export a mutable ref, (b) pass a callback, (c) handle in the source module.

**N-56: `let` TDZ in ES modules**
`let placementMode = 'idle'` declared at line 1213 causes TDZ error if an event fires
before that line runs. Declare module-level mutable state vars near the TOP of the module.

### Current file sizes (post-modularisation)
- app.js: ~1,400 lines (was 3,647) — still the coordinator/orchestrator
- site.js: 273 lines
- viewport.js: ~310 lines  
- plants.js: ~690 lines
- surfaces.js: ~300 lines
- grid.js: 162 lines
- geo.js: 158 lines
- model.js: 88 lines
- ui.js: 112 lines
- state.js: 88 lines

### Status
App loads and all SITE tools work. Plants/surfaces are placeholder code to be 
rewritten properly in future sprints. The Supabase project repo is live and working.

### Next session priorities
1. Test full flow: DXF import → project saves to Supabase → reload → Recent Projects → open
2. Fix scene.js extraction (renderer, animation loop — step 9, deferred)
3. Revisit plants.js — rewrite placement engine properly (state.placementMode in state.js)
4. North Point "Set Design North" wire-up (still pending from vision.md)
