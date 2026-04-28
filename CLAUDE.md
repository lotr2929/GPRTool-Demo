# CLAUDE.md -- GPRTool
_First read: C:\_myProjects\CLAUDE.md (master standing instructions)._

## Coordinate law (non-negotiable)
North = NEGATIVE Z in Three.js. Always.
- wgs84ToScene(): sc.z < 0 for points north of anchor
- buildFlatPolygon()/buildBuilding(): shape Y = -sc.z after rotateX(-PI/2)
- CADMapper: new THREE.Vector3(p.x, p.z, -p.y)
- Any comment saying "+Z = north" is WRONG -- delete it

## Before you do anything

Read both files in `_dev/` before starting any work:
- `_dev_guide.md` -- coding standards and architecture rules
- `_map.md` -- current file structure and what everything does

Everything you need is in `_dev/`.

## Rules

1. Do not write, edit, or move any file without explicit permission.
2. Format every response as a numbered list. Number each distinct
   statement or point so Boon can reference them by number.
   Use sub-lists (1a, 1b...) for related points under one item.
   Reset numbering to 1 at the start of each new response.
3. Use MCP filesystem tools for all file operations. Do not use bash --
   it runs on Linux and cannot reach this Windows filesystem.
4. Find the simplest solution that fits the existing logic and structure
   of the code. Fewer files, fewer dependencies, fewer moving parts.

## Before implementing anything

State your plan in this format and wait for approval:

I am going to:
- [write / edit] [function / section]
- in [filename and path]

It will [describe plainly what it does -- what it draws, calculates,
or changes. State the format: SVG, JS function, CSS rule, etc.]

This will also affect:
- [other file] -- [what changes there]

## Coding standards

- App code: HTML, CSS, JS only. No Python in `app/`.
- LAI pipeline: Python only. Lives in `lai/`. Never ships to browser.
- Icons: always inline SVG. Never `<img>` with PNG.
- Photos and rasters: `app/assets/images/` only.
- Third-party libraries: `app/js/lib/` -- never edit these files.
- The north point SVG is defined once and used by both viewports.
- **Data sources: free + global only** (OSM, AWS Terrarium, equivalents).
  No paid or jurisdiction-specific sources (Landgate SLIP LiDAR, ELVIS,
  etc.) in the core app -- app is for educational use. Commercial-grade
  precision is added per-instance later, not in core.

## Debugging

Before proposing any fix, check every possible source of the error:
- Console output (ask Boon to open DevTools F12 and report exactly
  what it shows)
- Network tab if a file might not be loading
- The relevant section of `_map.md` to confirm file paths are correct
- The relevant rule in `_dev_guide.md`

Never guess. Only propose a fix once the cause is confirmed.
