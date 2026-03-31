# GPRTool — Developer Guide

**Version**: 1.1
**Last updated**: 2026-03-31
**Applies to**: All AI and human contributors
**Read alongside**: `_map.md` (file structure), `_design.md` (design decisions)

---

## 1. THE ONE RULE

> **Touch it, extract it.**

When you open a section of `index.html` to develop or fix a feature, extract that section into its own JS file in `app/js/` as part of that same piece of work. Do not add new code to `index.html`. Do not refactor code you are not currently working on.

`index.html` should eventually be ~50 lines: a shell that imports modules and nothing else.

---

## 2. DIRECTORY STRUCTURE

> **Current state**: see `_map.md` — it is the authoritative record of what files exist now.
> This section defines the **target structure** we are building toward incrementally.

The target for `app/js/` when fully extracted:

```
app/js/
  lib/                    ← third-party libraries — NEVER edit
    three.module.js
    OrbitControls.js
  scene.js                ← renderer, cameras, lights, animation loop
  controls.js             ← orbit controls, 2D pan/zoom handlers
  surfaces.js             ← surface detection, classification, hover/select
  import.js               ← OBJ/glTF/GeoJSON loaders, unit scale detection
  map-tiles.js            ← map tile overlay
  plants.js               ← plant library, GPR engine
  placement.js            ← 2D placement engine, 3D proxies
  north-point-2d.js       ← 2D DOM compass widget (self-contained)
  north-point-3d.js       ← 3D HUD compass (separate render pass)
  ui.js                   ← panels, menus, feedback bar, keyboard shortcuts
  tools/                  ← one file per tool (see Section 4)
    tool-registry.js
    tool-select.js
    tool-site.js
    tool-building.js
    tool-landscape.js
    tool-plants.js
```

**Subfolder rule**: only `tools/` exists as a subfolder. Do not create others unless a feature has 3+ files of its own.

**When a file is extracted** from `index.html`, update `_map.md` to reflect the new state. `_dev_guide.md` does not need updating unless the target structure itself changes.

---

## 3. MODULE RULES

Every JS file in `app/js/` (except `lib/`) must follow these rules:

### 3.1 Declare dependencies at the top
```js
// Needs: scene, camera, renderer (from scene.js)
// Needs: showFeedback (from ui.js)
// Exposes: initNorthPoint2D, toggleNorthPoint
```

### 3.2 Expose only what other modules need
Do not use global variables. Use ES module exports:
```js
export function initNorthPoint2D() { ... }
export function toggleNorthPoint() { ... }
```

### 3.3 Import only what you use
```js
import { scene, camera2D } from './scene.js';
import { showFeedback } from './ui.js';
```

### 3.4 One responsibility per file
A file does one thing. `north-point-2d.js` handles the 2D compass only.
It does not know about plants, surfaces, or GeoJSON.

---

## 4. TOOL ARCHITECTURE

GPRTool uses a **single active tool** model. One tool owns viewport input at a time. The properties panel is always editable regardless of which tool is active.

### 4.1 Tool interface

Every tool in `tools/` must export this interface:

```js
export const ToolName = {
  id: 'tool-name',            // unique string
  label: 'Tool Name',         // display name

  // Called when tool becomes active
  activate(context) { },

  // Called when tool is deactivated (user switches tool)
  deactivate() { },

  // Viewport event handlers — only called when this tool is active
  onPointerDown(e, hit) { },
  onPointerMove(e, hit) { },
  onPointerUp(e, hit) { },
  onKeyDown(e) { },
  onDblClick(e, hit) { },

  // Renders this tool's section in the right-hand Properties panel
  // Returns an HTML string or a DOM element
  renderProperties(selection) { },

  // Called when user presses Escape
  cancel() { },
};
```

`context` passed to `activate()` contains:
```js
{
  scene,          // Three.js scene
  camera,         // active camera
  renderer,       // WebGL renderer
  showFeedback,   // status bar message fn
  setStatus,      // status bar coords/dim fn
  selection,      // current selection state
}
```

### 4.2 Tool registry

`tool-registry.js` manages the active tool:

```js
let activeTool = null;

export function setActiveTool(tool, context) {
  activeTool?.deactivate();
  activeTool = tool;
  activeTool.activate(context);
  renderPropertiesPanel(activeTool.renderProperties(context.selection));
}

export function getActiveTool() { return activeTool; }

// Called by the viewport event listeners
export function dispatchPointerDown(e, hit) { activeTool?.onPointerDown(e, hit); }
export function dispatchPointerMove(e, hit) { activeTool?.onPointerMove(e, hit); }
// etc.
```

### 4.3 Properties panel

The right panel has two zones:
- **Selection info** (top) — populated by surface/model detection, always visible when something is selected
- **Tool properties** (bottom) — populated by `tool.renderProperties()`, changes with active tool

`ui.js` owns the panel container. Each tool renders its own content into it.

### 4.4 Status bar

The status bar shows:
- Left: current mode (2D / 3D)
- Centre: cursor coordinates (X, Y in metres from site origin)
- Right: active tool hint OR dimension input

`ui.js` exports:
```js
export function setStatusMode(label) { }    // '2D' / '3D'
export function setStatusCoords(x, y) { }  // live cursor position
export function setStatusHint(text) { }    // tool instruction
export function setStatusInput(text) { }   // dimension value being typed
```

---

## 5. CSS RULES

- **All styles go in `styles.css`** — no inline `<style>` blocks in `index.html`, `body.html`, or `header.html`
- **No inline `style=` attributes in HTML** except for initial `display:none` on elements that start hidden
- **CSS variables** are defined in `:root` in `styles.css` — use them, do not hardcode colours or dimensions
- **No CSS variables for runtime JS values** — if JS needs to store a number (e.g. north point scale), use a JS variable, not a CSS variable
- **Naming convention**: BEM-lite — `#component-name`, `.component__element`, `.component--modifier`

---

## 6. DOM ELEMENT RULES

### 6.1 Rotating elements — the container/rotator pattern

**Never apply both `transform: rotate()` and `position`/`size` to the same element.**

If an element rotates AND needs drag/resize:
```html
<div id="np-container">   ← position, size, drag handles — NEVER rotated
  <div id="np-rotator">   ← rotation only — NEVER positioned
    <svg>...</svg>
  </div>
</div>
```

- `getBoundingClientRect()` on a rotated element returns the visual (inflated) bounding box — **do not use it for layout math on rotating elements**
- `offsetLeft` / `offsetTop` / `offsetWidth` / `offsetHeight` are layout coordinates, unaffected by CSS transforms — **always use these for drag/resize math**

### 6.2 Drag threshold

Never set `isDragging = true` on `pointerdown`. Wait for 5px of movement first:
```js
const DRAG_THRESHOLD = 5;
// on pointermove: if (Math.hypot(dx, dy) > DRAG_THRESHOLD) isDragging = true;
```
This prevents clicks from being misread as drags.

---

## 7. LOCALSTORAGE KEYS

All localStorage keys are prefixed `gprtool-`. Registered keys:

| Key | Type | Description |
|-----|------|-------------|
| `gprtool-np2d-state` | `{right, bottom, w, visible}` | 2D north point position, width, visibility |
| `gprtool-np3d-state` | `{corner, size, visible}` | 3D compass corner, size, visibility |

When adding a new persisted value, add it to this table and use the `gprtool-` prefix.
**Do not create new keys for values that belong in an existing key's object.**

---

## 8. THREE.JS CONVENTIONS

- **Scene units = metres** always. Auto-scale on model import if needed.
- **World north = -Z axis** (i.e. the negative Z direction is geographic north)
- **Y axis = up**
- `depthTest: false` + high `renderOrder` for any overlay geometry that must always be visible
- Dispose geometries and materials when removing objects from the scene
- Do not call `getBoundingClientRect()` on the canvas for Three.js coordinate math — use `renderer.domElement.getBoundingClientRect()` only for converting screen to NDC

---

## 9. EXTRACTION PROCEDURE

When extracting a section from `index.html` into its own module:

1. Read the section in full before touching anything
2. Identify all variables and functions it uses from other sections — these become imports
3. Identify what it exposes to other sections — these become exports
4. Write the new file with explicit imports and exports
5. Replace the original section in `index.html` with a `<script type="module" src="js/filename.js"></script>` tag
6. Test locally before committing
7. Update `_map.md` to reflect the new file
8. Add the file's exports to the imports table at the top of any file that uses them

---

## 10. WHAT NOT TO DO

- Do not add code to `index.html` — extract instead
- Do not duplicate CSS between `styles.css` and inline style blocks
- Do not use CSS variables to pass runtime values between JS and CSS
- Do not call `getBoundingClientRect()` on elements that have CSS `transform` applied
- Do not set `isDragging = true` on `pointerdown`
- Do not create localStorage keys without adding them to the table in Section 7
- Do not import Three.js from CDN — use the local copy in `app/js/lib/`
- Do not subdivide `js/` with new folders unless a feature has 3+ files of its own

---

## 11. REPOMIX

`repomix-output.xml` is a snapshot of the repo for feeding to AI tools that don't have filesystem access. Regenerate it before each session with an external AI tool:

```
repomix --output _dev/repomix-output.xml
```

It is generated, not maintained. Never edit it by hand.
