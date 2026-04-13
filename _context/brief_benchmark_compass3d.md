# Brief Benchmark — NPoint Compass 3D Back-Face Bug
# Created: 12 Apr 2026
# Purpose: Gold-standard reference for evaluating Brief Protocol output quality.
#
# CORRECTION (12 Apr 26): "inverted" means the compass image is seen from BEHIND
# (back face of the DoubleSide mesh is visible, or E/W axes are swapped due to
# oblique viewing angle). NOT upside-down.
#
# VISUAL EVIDENCE: Two screenshots were provided.
# Image 1 (2D): DOM compass widget correct -- N pointing up, "32deg17'W" label,
#   green Design North dot visible. Compass appears as expected flat circle.
# Image 2 (3D): Compass gizmo appears darker/distorted. N arrow points toward
#   bottom-right of compass widget. Compass appears as if viewed from an oblique
#   angle or from the back -- E and W axes may be transposed relative to 2D view.

---

## Section 1 -- Raw User Query

"As you can see from the images, the NPoint compass is inverted when I toggle from
2D to 3D view. I need the NPoint compass to be reset correctly. In particular, the
NPoint compass needs to align with the grid so that the Design North is always
pointing in the same direction as the grid. Make sure that this alignment remains
as I zoom in and out of the viewport."

Clarification: "inverted" means the compass is seen from behind (back face visible
or E/W swapped), NOT upside-down.

---

## Section 2 -- Root Cause

File: js/north-point-3d.js, renderCompassGizmo(), approx lines 285-291.

The compass mesh (PlaneGeometry, rotation.x = -PI/2, DoubleSide, scale.x = -1)
lies flat at world origin. gizmoCamera should always view it from ABOVE (front face).

BUG: gizmoCamera copies camera3D's full quaternion (including pitch) and positions
itself in camera3D's backward direction. For oblique 3D camera angles, this puts
gizmoCamera at an angle where it views the flat compass plane from the side or below,
causing the back face to show (E/W swapped, compass appears "seen from behind").

```js
// BUGGY lines:
gizmoCamera.quaternion.copy(camera3D.quaternion);  // copies pitch -- WRONG
const bwd = new THREE.Vector3(0, 0, 1).applyQuaternion(gizmoCamera.quaternion);
gizmoCamera.position.copy(bwd).multiplyScalar(5);  // positions at oblique angle
```

FIX: Extract only the Y-axis (yaw) from camera3D.quaternion. Position gizmoCamera
directly above the compass plane, looking straight down. Apply the yaw so the
compass rotates as the user orbits horizontally. Result: compass always appears as
a flat top-down circle, never distorted or back-face.

```js
// FIXED lines:
const _euler = new THREE.Euler().setFromQuaternion(camera3D.quaternion, 'YXZ');
const _downYaw = new THREE.Euler(Math.PI / 2, _euler.y, 0, 'YXZ');
gizmoCamera.quaternion.setFromEuler(_downYaw);
gizmoCamera.position.set(0, 5, 0);
```

Why Euler(PI/2, euler.y, 0, 'YXZ'):
- 'YXZ' order: apply yaw (euler.y around Y) THEN pitch (PI/2 around X).
- Three.js camera default look = -Z. Rotating X by +PI/2 swings look to -Y (down).
- Applying yaw first rotates the compass as the user orbits.
- position.set(0, 5, 0) = directly above, looking straight down.
- gizmoCompassMesh.rotation.y = 0 unchanged: N label stays pointing True North (-Z).
- Zoom invariance already handled by pixel scissors. No change needed.

---

## Section 3 -- Ideal Coder Brief (what Brief Protocol should produce)

### System prompt (from .brief TEMPLATE):
You are a coding assistant for GPRTool (browser PWA, vanilla JS, Three.js, Vercel).
Source truth: treat injected [Relevant code] chunks as ground truth.
Never invent function or variable names not shown there.
Answer format: exact file path and function name. For fixes, show exact changed lines.
Runtime check: require(), TypeScript syntax, or npm imports = wrong for this project.

### Visual context (from Step A image analysis):
Image 1 (2D mode): Compass widget displays correctly as a flat circle. N points up,
"32deg17'W" label visible, green Design North indicator present.
Image 2 (3D mode): Compass gizmo appears viewed from an oblique angle. N arrow
direction has changed significantly vs 2D view. Compass appears distorted/mirrored.
User confirms: "seen from behind" (back face visible, not rotated upside-down).

### Project context (from memory + .brief):
COORDINATE SYSTEM: Three.js -Z = True North, Z-up. (North-06 in journal)
COMPASS ARCHITECTURE:
  2D mode: DOM widget, north-point-2d.js.
  3D mode: WebGL gizmo, north-point-3d.js. DOM widget hidden.
  Gizmo mesh: PlaneGeometry at origin, rotation.x=-PI/2 (flat), DoubleSide, scale.x=-1.
  gizmoCamera: OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20).
  Scissor/viewport rendering handles zoom invariance -- no changes needed there.
  getDesignNorthAngle() returns designNorthAngle (degrees, +E/clockwise).

### [Relevant code] -- js/north-point-3d.js, renderCompassGizmo():
  (full function body, ~30 lines)

### Task:
Fix the back-face/oblique-view bug in js/north-point-3d.js > renderCompassGizmo().
The gizmo camera must NOT copy camera3D pitch. Always look straight down with yaw only.
Requirements:
1. Extract Y-axis (yaw) from camera3D.quaternion using THREE.Euler('YXZ').
2. Build gizmoCamera quaternion: Euler(PI/2, euler.y, 0, 'YXZ').
3. Position gizmoCamera at (0, 5, 0).
4. Keep gizmoCompassMesh.rotation.y = 0 and all scissor/viewport code unchanged.
Show only changed lines with file path and approximate line numbers.

---

## Section 4 -- Brief Protocol Steps (how Coder generates Section 3)

These are the concrete steps Coder should execute with task AIs, mirroring what
Claude Desktop does manually before answering a complex query.

STEP A | Visual Understanding (AI call -- vision model required, e.g. Gemini)
  Input:  user images + question:
    "Describe what you see in each screenshot. For the compass widget, describe
     its appearance precisely: is it a flat circle, distorted, skewed? Does it
     appear viewed from the front, side, or behind? Are any labels mirrored?"
  Output: textual visual description (replaces the need for task AIs to have images)
  Why:    Task AIs without vision cannot understand "inverted" without this.
          The visual description becomes part of the brief context.

STEP B | File Identification (AI call -- fast model, e.g. Gemini Flash)
  Input:  raw query + visual description from Step A + project file listing
    "Which files and functions are most likely responsible for this visual bug?
     List only file paths and function names."
  Augment: run getCodeContext(query + visual description) via Supabase RAG
  Output: prioritised list of file+function targets
  Why:    Prevents reading entire codebase. Focuses code retrieval.

STEP C | Code Retrieval (Coder action -- filesystem reads, no AI)
  Input:  file+function list from Step B
  Action: read each target function (+-50 lines around each function)
  Output: code snippets as source of truth
  Why:    Grounds subsequent AI calls in actual code, not hallucination.

STEP D | Context Retrieval (Coder action -- no AI)
  Input:  project root
  Action: read _context/.brief (TEMPLATE section), getMemoryContext(query)
  Output: project constraints + coordinate system + known issues
  Why:    Sets runtime constraints before task AI writes code.

STEP E | Root Cause Analysis (AI call -- reasoning model, e.g. DeepSeek R1)
  Input:  visual description (Step A) + code (Step C) + context (Step D)
    "Based on this code and the visual symptom (compass seen from behind in 3D),
     what is the exact root cause? Quote the specific lines responsible."
  Output: root cause statement with specific line references
  Why:    Separates understanding from solution. Better fix quality downstream.
          This is the step most likely to be wrong -- worth a second evaluator.

STEP F | Brief Assembly (Coder action -- deterministic, no AI)
  Input:  TEMPLATE (Step D) + visual context (Step A) + code (Step C) +
          project context (Step D) + root cause (Step E) + output format rules
  Action: concatenate into structured coder_brief string
  Output: the final coder_brief sent to task AIs in All Mode
  Why:    Assembly is mechanical. AI involvement here adds noise, not value.

STEP G | Task AI Response (All Mode -- existing mechanism)
  Input:  coder_brief from Step F
  Output: fix proposals from 5 task models

STEP H | Evaluation (Brief AI -- existing mechanism)
  Input:  task AI responses + coder_brief (source of truth)
  Output: ranked evaluation

---

## Section 5 -- Evaluation Criteria

Category: Fix (generative -- codeCorrectness applies, max 30 pts)

Key accuracy checks:
- Uses THREE.Euler('YXZ') to extract yaw -- Euler order must be 'YXZ' not 'XYZ'
- Uses Math.PI / 2 for downward pitch (not -Math.PI / 2)
- Keeps gizmoCompassMesh.rotation.y = 0 unchanged
- Does NOT change scissor/viewport code
- Correctly notes zoom invariance is already handled

Hallucination red flags:
- Functions not in north-point-3d.js source
- TypeScript type annotations
- require() or Node.js imports

Known eval gap:
- Cannot verify WebGL visual output. Mitigation: require evaluator to state
  "verify Euler order is geometrically correct for Three.js -Z default look direction."
