
    import * as THREE from 'three';
    import { OrbitControls } from './OrbitControls.js';
    import { OBJLoader }  from 'three/addons/loaders/OBJLoader.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    // ── REAL WORLD (coordinates, geography) — import only from real-world.js ──
    import {
      setRealWorldAnchor, getRealWorldAnchor, hasRealWorldAnchor,
      setSceneOffset, sceneToWGS84, wgs84ToScene,
    } from './real-world.js';
    import {
      createInitialGPR, addBoundaryToGPR, openGPR, downloadGPR, getActiveGPRBlob,
    } from './gpr-file.js';
    import { initSiteBoundary, openBoundaryPicker } from './site-boundary.js';
    import { initProjects, showProjectsModal, saveProject, loadProject } from './projects.js';
    // ── DESIGN WORLD (grids, north angle) — never mixes with Real World ────────
    import { initSiteSelection }    from './site-selection.js';
    import { initCADMapperImport, buildLayerPanel, parseCadmapperDXF } from './cadmapper-import.js';
    import { DesignGridManager }    from './design-grid.js';
    import {
      initNorthPoint2D,
      updateNorthRotation,
      toggleNorthPoint,
      resetNorthPos,
      getDesignNorthAngle,
      resetDesignNorth,
      setNorthPointMode,
    } from './north-point-2d.js';
    import {
      initNorthPoint3D,
      updateGizmoOverlay,
      renderCompassGizmo,
      toggleGizmo3D,
      isGizmo3DVisible,
    } from './north-point-3d.js';
    import { state } from './state.js';
    import { detectSurfaces, populateSurfacePanel, selectSurface, deselectSurface,
             hoverSurface, unhoverSurface, allSurfaceMeshes, getPointerNDC,
             classifyNormal, computeMeshArea, initSurfaces } from './surfaces.js';
    import { loadOBJ, loadGLTF, loadIFC, addEdgeOverlay, detectAndApplyUnitScale } from './model.js';
    import { updateSceneHelpers, showGridSpacingPopup, majorCellSize } from './grid.js';
    import { initGeo, latlonToMetres, extractCoordinates, computeBBox, computePolygonArea, computePolygonPerimeter, loadMapTiles, clearMapTiles } from './geo.js';
    import { initUI, showFeedback } from './ui.js';

    /* ============================================================
       LOAD HEADER + BODY
    ============================================================ */
    const header = await fetch('header.html').then(r => r.text());
    document.getElementById('header-container').innerHTML = header;

    const bodyHTML = await fetch('body.html').then(r => r.text());
    document.getElementById('body-container').innerHTML = bodyHTML;
    initUI();
    initGeo({ onMapCleared: () => setGridVisible(state.currentMode === '2d') });
    // initSurfaces wired after fitSurfaceCamera etc. are defined (below)

    /* ── ui.js handles: clock, alarm, showFeedback, section collapse ─── */




    /* ============================================================
       COLLAPSIBLE SECTIONS + KEYBOARD SHORTCUTS
    ============================================================ */
    /* section collapse -- moved to ui.js */

    document.addEventListener('keydown', e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key === 'f') { e.preventDefault(); document.getElementById('fitSiteBtn')?.click(); }
      if (ctrl && !e.shiftKey && e.key === 'g') { e.preventDefault(); document.getElementById('toggleGridBtn')?.click(); }
      if (ctrl && !e.shiftKey && e.key === 't') { e.preventDefault(); toggleAxes(); }
      if (ctrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); showFeedback('Undo — coming soon'); }
      if (ctrl &&  e.shiftKey && e.key === 'Z') { e.preventDefault(); showFeedback('Redo — coming soon'); }
      if (e.key === 'Escape') { deselectSurface(); showFeedback('Ready'); }
      // N = orient view to north (rotate2D = 0)
      if ((e.key === 'n' || e.key === 'N') && !ctrl && currentMode === '2d') {
        rotate2D = 0;
        update2DCamera();
        showFeedback('View oriented to North');
      }
    });

    /* ============================================================
       SCENE GLOBALS
    ============================================================ */
    const canvas    = document.getElementById('three-canvas');
    const container = canvas.parentElement;

    let currentMode      = '2d';
    let siteBoundaryLine = null;
    let siteSurface      = null;
    let sitePinGroup     = null;
    let sitePinDom       = null;
    let sitePinWorldPos  = null;
    let siteOriginLon    = 0;   // map origin set by drawSiteBoundary — used for pin projection
    let siteOriginLat    = 0;
    let terrainMesh      = null;
    let cadmapperGroup   = null;   // THREE.Group — CADMapper site context layers (REAL WORLD geometry)
    let mapTileGroup     = null;
    let importedModel    = null;   // THREE.Group — the loaded 3D model
    // ── CAD Universe grid (REAL WORLD — True North fixed, never rotates) ─────
    let gridHelper           = null;
    let gridHelperMinor      = null;
    // CAD Grid spacing — auto-calculated from site span unless overridden
    let manualGridSpacing    = null;   // major (m); null = auto
    let manualMinorDivisions = null;   // sub-divisions; null = none
    let _lastSiteSpan        = 1000;
    let axesHelper           = null;
    // ── Design World state (overlays only — never stores geographic data) ─────
    let designGridManager    = null;   // Design Grid system (see js/design-grid.js)
    // Design Grid spacing — starts equal to CAD values at import, user-controlled thereafter
    let dgSpacing            = null;   // major (m); null = inherit from CAD
    let dgMinorDivisions     = null;   // sub-divisions; null = none
    let axesYLine        = null;  // Y (green) — shown in 3D only
    let feedbackTimer    = null;
    // ── Lot boundary (REAL WORLD — WGS84 GeoJSON → Three.js line) ────────────
    let lotBoundaryGroup = null;   // THREE.Group of boundary lines in scene

    // Surface registry — populated after model load
    // Each entry: { id, mesh, type, area, elevation, normalAngle, originalMaterial }
    let surfaces         = [];
    let hoveredSurface   = null;
    let selectedSurface  = null;

    // 2D canvas mode: 'ortho' = top-down/elevation, 'surface' = normal-aligned
    let canvasMode = 'ortho';

    /* ============================================================
       MATERIALS
    ============================================================ */
    const MAT = {
      model:    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      ground:   new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      roof:     new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      wall:     new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      sloped:   new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      hover:    new THREE.MeshBasicMaterial({ color: 0xd8d8d8, side: THREE.DoubleSide }),
      selected: new THREE.MeshBasicMaterial({ color: 0xc8e8c8, side: THREE.DoubleSide }),
    };
    state.MAT = MAT; // bridge for surfaces.js

    // ── Bridge MAT to state for surfaces.js ─────────────────────────────
    // (MAT is assigned below after it is created)
    /* ============================================================
       RENDERER
    ============================================================ */
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();

    // ── Bridge local vars to state so modules (grid.js, geo.js etc.) can read them ──
    state.scene    = scene;
    state.renderer = renderer;
    state.canvas   = canvas;
    state.container = container;

    function syncViewportBackground() {
      const css = getComputedStyle(document.documentElement)
        .getPropertyValue('--vp-bgcolor').trim() || '#ffffff';
      renderer.setClearColor(new THREE.Color(css), 1.0);
    }
    syncViewportBackground();
    new MutationObserver(syncViewportBackground)
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    /* ============================================================
       CAMERAS
    ============================================================ */
    const camera3D = new THREE.PerspectiveCamera(45, 2, 0.1, 10000);
    camera3D.position.set(100, 100, 100);

    const camera2D = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 20000);
    camera2D.position.set(0, 10000, 0);
    camera2D.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

    let camera = camera2D;

    // Bridge cameras to state
    state.camera3D = camera3D;
    state.camera2D = camera2D;
    state.camera   = camera;

    /* ============================================================
       CONTROLS
    ============================================================ */
    const controls3D = new OrbitControls(camera3D, renderer.domElement);
    controls3D.enableDamping      = true;
    controls3D.dampingFactor      = 0.08;
    controls3D.rotateSpeed        = 0.6;
    controls3D.zoomSpeed          = 0.8;
    controls3D.panSpeed           = 1.0;
    controls3D.screenSpacePanning = true;
    controls3D.minDistance        = 1;
    controls3D.maxDistance        = 5000;
    controls3D.minPolarAngle      = 0.01;
    controls3D.maxPolarAngle      = Math.PI * 0.85;
    controls3D.mouseButtons       = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls3D.touches            = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    const pan2D = { x: 0, z: 0 };
    let zoom2D = 1;
    let base2DhalfH = 50;
    const controls2D = { update: () => {}, saveState: () => {}, target: new THREE.Vector3() };

    let pan2DActive = false;
    let pan2DLast   = { x: 0, y: 0 };

    let rotate2D       = 0;           // radians — 2D view rotation around world Y axis
    let rotate2DActive = false;
    let rotate2DLast   = { x: 0, y: 0 };

    renderer.domElement.addEventListener('pointerdown', e => {
      if (currentMode !== '2d') return;
      if (e.button === 1) {
        // Middle mouse — rotate the 2D view (not in surface canvas mode)
        if (selectedSurface) return;
        e.preventDefault();
        rotate2DActive = true;
        rotate2DLast   = { x: e.clientX, y: e.clientY };
        renderer.domElement.setPointerCapture(e.pointerId);
      } else if (e.button === 0) {
        // Left mouse — pan
        pan2DActive = true;
        pan2DLast   = { x: e.clientX, y: e.clientY };
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    });

    renderer.domElement.addEventListener('pointermove', e => {
      if (currentMode !== '2d') return;

      if (rotate2DActive) {
        const dx = e.clientX - rotate2DLast.x;
        rotate2DLast = { x: e.clientX, y: e.clientY };
        // Dragging full viewport width = PI radians of rotation
        rotate2D += dx * (Math.PI / container.clientWidth);
        update2DCamera();
        return;
      }

      if (!pan2DActive) return;
      const dx = e.clientX - pan2DLast.x;
      const dy = e.clientY - pan2DLast.y;
      pan2DLast = { x: e.clientX, y: e.clientY };

      if (selectedSurface && camera2D.userData.surfaceCentre) {
        // Surface canvas mode: pan along surface U/V axes (no rotate2D here)
        const frustumW = (camera2D.right - camera2D.left) / camera2D.zoom;
        const frustumH = (camera2D.top - camera2D.bottom) / camera2D.zoom;
        const scaleX   = frustumW / container.clientWidth;
        const scaleY   = frustumH / container.clientHeight;

        const n    = camera2D.userData.surfaceNormal.clone();
        const up   = camera2D.userData.surfaceUp.clone();
        const right = new THREE.Vector3().crossVectors(up, n).normalize();

        camera2D.position.addScaledVector(right,  dx * scaleX);
        camera2D.position.addScaledVector(up,     -dy * scaleY);
        camera2D.lookAt(
          camera2D.position.clone().addScaledVector(n, -camera2D.far * 0.5)
        );
        camera2D.updateProjectionMatrix();
      } else {
        // Top-down plan mode — pan is rotation-aware
        // Screen right in world = (cos(r), 0, sin(r))
        // Screen down in world  = (sin(r), 0, -cos(r)) reversed for pan direction
        const frustumW = (camera2D.right - camera2D.left) / camera2D.zoom;
        const frustumH = (camera2D.top - camera2D.bottom) / camera2D.zoom;
        const r   = rotate2D;
        const scX = frustumW / container.clientWidth;
        const scZ = frustumH / container.clientHeight;
        pan2D.x -= dx * scX * Math.cos(r) - dy * scZ * Math.sin(r);
        pan2D.z -= dx * scX * Math.sin(r) + dy * scZ * Math.cos(r);
        update2DCamera();
      }
    });

    renderer.domElement.addEventListener('pointerup', e => {
      if (currentMode !== '2d') return;
      pan2DActive    = false;
      rotate2DActive = false;
      renderer.domElement.releasePointerCapture(e.pointerId);
    });

    /* ============================================================
       VIEWPORT RIGHT-CLICK CONTEXT MENU
    ============================================================ */
    const _vpCtx = document.createElement('div');
    _vpCtx.id = 'vp-ctx-menu';
    _vpCtx.style.cssText = `
      display:none; position:fixed; z-index:900;
      background:var(--chrome-panel); border:1px solid var(--chrome-border);
      border-radius:4px; box-shadow:0 4px 16px rgba(0,0,0,0.18);
      padding:3px 0; min-width:170px;
      font-family:var(--font,'Outfit',sans-serif); font-size:12px;`;

    const _ctxItem = (id, label) => {
      const d = document.createElement('div');
      d.id = id;
      d.textContent = label;
      d.style.cssText = `padding:6px 14px; cursor:pointer; color:var(--text-primary);
        white-space:nowrap;`;
      d.addEventListener('mouseover', () => d.style.background = 'var(--chrome-hover)');
      d.addEventListener('mouseout',  () => d.style.background = '');
      return d;
    };
    _vpCtx.appendChild(_ctxItem('vp-ctx-grid',    'Grid Spacing\u2026'));
    _vpCtx.appendChild(_ctxItem('vp-ctx-fit',     'Fit to Site'));
    _vpCtx.appendChild(_ctxItem('vp-ctx-reset',   'Reset Camera'));
    _vpCtx.appendChild(_ctxItem('vp-ctx-grid-toggle', 'Toggle Grid'));
    document.body.appendChild(_vpCtx);

    let _vpCtxX = 0, _vpCtxY = 0;
    renderer.domElement.addEventListener('contextmenu', e => {
      e.preventDefault();
      _vpCtxX = e.clientX; _vpCtxY = e.clientY;
      // Clamp to viewport edges
      const w = 178, h = 120;
      _vpCtx.style.left    = Math.min(e.clientX, window.innerWidth  - w - 4) + 'px';
      _vpCtx.style.top     = Math.min(e.clientY, window.innerHeight - h - 4) + 'px';
      _vpCtx.style.display = 'block';
    });
    document.addEventListener('pointerdown', e => {
      if (!_vpCtx.contains(e.target)) _vpCtx.style.display = 'none';
    });

    document.getElementById('vp-ctx-grid').addEventListener('click', () => {
      _vpCtx.style.display = 'none';
      showGridSpacingPopup(_vpCtxX, _vpCtxY);
    });
    document.getElementById('vp-ctx-fit').addEventListener('click', () => {
      _vpCtx.style.display = 'none';
      document.getElementById('fitSiteBtn')?.click();
    });
    document.getElementById('vp-ctx-reset').addEventListener('click', () => {
      _vpCtx.style.display = 'none';
      document.getElementById('resetCameraBtn')?.click();
    });
    document.getElementById('vp-ctx-grid-toggle').addEventListener('click', () => {
      _vpCtx.style.display = 'none';
      document.getElementById('toggleGridBtn')?.click();
    });

    // ── Helper: current auto major cell size ──────────────────────────────

    // ── Combined Grid Spacing popup ───────────────────────────────────────

    /* ============================================================
       PANEL RESIZE (drag handle between panel and viewport)
    ============================================================ */
    document.querySelectorAll('.panel-resize').forEach(handle => {
      handle.addEventListener('pointerdown', e => {
        e.preventDefault();
        const panel  = document.getElementById(handle.dataset.target);
        if (!panel || panel.classList.contains('collapsed')) return;
        const isWest = handle.dataset.dir === 'w';   // right-panel handle
        const startX = e.clientX;
        const startW = panel.offsetWidth;
        panel.style.transition = 'none';
        handle.classList.add('active');
        handle.setPointerCapture(e.pointerId);

        const onMove = ev => {
          const dx   = ev.clientX - startX;
          const newW = isWest ? startW - dx : startW + dx;
          panel.style.width = Math.max(160, Math.min(460, newW)) + 'px';
        };
        const onUp = () => {
          panel.style.transition = '';
          handle.classList.remove('active');
          handle.releasePointerCapture(e.pointerId);
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup',   onUp);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup',   onUp);
      });
    });

    renderer.domElement.addEventListener('wheel', e => {
      if (currentMode !== '2d') return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      if (selectedSurface) {
        // Surface canvas zoom: scale the orthographic frustum
        camera2D.left   *= factor;
        camera2D.right  *= factor;
        camera2D.top    *= factor;
        camera2D.bottom *= factor;
        camera2D.updateProjectionMatrix();
      } else {
        zoom2D = Math.max(0.002, Math.min(50, zoom2D * factor));
        update2DCamera();
      }
    }, { passive: false });

    function update2DCamera() {
      // If in surface canvas mode, the camera is managed by fitSurfaceCamera -- don't override it
      if (currentMode === '2d' && selectedSurface) return;
      camera2D.zoom = zoom2D;
      camera2D.position.set(pan2D.x, 10000, pan2D.z);
      // up vector encodes the view rotation: rotate2D=0 → north (-Z) points up on screen
      camera2D.up.set(Math.sin(rotate2D), 0, -Math.cos(rotate2D));
      camera2D.lookAt(pan2D.x, 0, pan2D.z);
      camera2D.updateProjectionMatrix();
    }

    let controls = controls2D;

    /* ============================================================
       LIGHTS
    ============================================================ */
    const keyLight    = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2, 4, 3);
    const fillLight   = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-3, 2, -2);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(keyLight, fillLight, ambientLight);

    updateSceneHelpers(100);

    /* ============================================================
       COMPASS GIZMO -- extracted to js/north-point-3d.js
    ============================================================ */












    /* ============================================================
       SURFACE DETECTION
    ============================================================ */

    // ── True mesh area: sum of all triangle areas via cross product ──

    // ── Dominant normal from all triangles (area-weighted average) ──

    // ── Coplanar polygon reconstruction ────────────────────────────
    // Extracts all triangles from the entire model group in world space,
    // groups them by plane (normal + distance), then by adjacency within
    // each plane group. Each connected coplanar patch becomes one surface.
    //
    // Plane key: quantise normal (2dp) + plane distance d = dot(pt, normal) (2dp)
    // Adjacency: two triangles are adjacent if they share a world-space edge
    //            (vertex coordinates rounded to SNAP_MM precision)







    /* ============================================================
       SURFACE PANEL
    ============================================================ */

    /* ============================================================
       SURFACE HOVER + SELECTION
    ============================================================ */






    /* ============================================================
       RAYCASTER
    ============================================================ */
    const raycaster  = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();


    // Build flat list of all meshes mapped back to their surface

    renderer.domElement.addEventListener('pointermove', e => {
      if (currentMode !== '3d' || !importedModel || pan2DActive) return;
      getPointerNDC(e);
      raycaster.setFromCamera(pointerNDC, camera3D);
      const meshMap = allSurfaceMeshes();
      const hits    = raycaster.intersectObjects([...meshMap.keys()], false);
      if (hits.length) {
        const hit = meshMap.get(hits[0].object);
        if (hit && hit !== hoveredSurface && hit !== selectedSurface) hoverSurface(hit);
      } else {
        if (hoveredSurface && hoveredSurface !== selectedSurface) unhoverSurface(hoveredSurface);
      }
    });

    renderer.domElement.addEventListener('click', e => {
      if (placementMode && placementMode !== 'idle') return; // placement engine handles this
      if (currentMode !== '3d' || !importedModel) return;
      getPointerNDC(e);
      raycaster.setFromCamera(pointerNDC, camera3D);
      const meshMap = allSurfaceMeshes();
      const hits    = raycaster.intersectObjects([...meshMap.keys()], false);
      if (hits.length) {
        const hit = meshMap.get(hits[0].object);
        if (hit) selectSurface(hit);
      } else {
        deselectSurface();
      }
    });




    /* ============================================================
       EDGE OVERLAY
    ============================================================ */
    const edgeMat   = new THREE.LineBasicMaterial({ color: 0x444444, linewidth: 1 });
    const edgeGroup = new THREE.Group();
    let   edgeLines = null;


    /* ============================================================
       UNIT AUTO-DETECTION + SCALE
       SketchUp's internal unit is inches. The SKP→GLB online
       converter exports in those raw units. A building modelled
       at "3000mm" in SketchUp arrives as 3000 scene units.
       GPRTool treats scene units as metres, so we must rescale.

       Detection heuristic (bounding box of raw model):
         maxDim > 500  → assume mm  → scale × 0.001
         maxDim > 50   → assume cm  → scale × 0.01
         otherwise     → assume m   → no scale

       A 10-storey building site in mm is ~100,000 units tall.
       In metres it would be ~100 units. The 500-unit threshold
       cleanly separates these two worlds.
    ============================================================ */

    /* ============================================================
       ON MODEL LOADED
    ============================================================ */
    function onModelLoaded(group, filename, format) {
      if (importedModel) {
        scene.remove(importedModel);
        scene.remove(edgeGroup);
        importedModel = null;
        surfaces = [];
      }

      importedModel = group;

      // Auto-detect and apply unit scale BEFORE centring
      const { scale } = detectAndApplyUnitScale(group);

      const box    = new THREE.Box3().setFromObject(group);
      const centre = new THREE.Vector3();
      box.getCenter(centre);
      group.position.sub(centre);
      box.setFromObject(group);
      group.position.y -= box.min.y;

      scene.add(group);

      detectSurfaces(group);
      addEdgeOverlay(group);

      const finalBox  = new THREE.Box3().setFromObject(group);
      const finalSize = new THREE.Vector3();
      finalBox.getSize(finalSize);
      const span = Math.max(finalSize.x, finalSize.z);

      updateSceneHelpers(span);
      fit3DCamera(finalBox);
      switchMode('3d');

      populateSurfacePanel();
      recalcGPR();

      document.getElementById('empty-props').style.display        = 'none';
      document.getElementById('model-info-section').style.display = 'block';
      document.getElementById('gpr-section').style.display        = 'block';
      document.getElementById('model-filename').textContent        = filename;
      document.getElementById('model-format').textContent          = format;
      document.getElementById('clearSiteBtn').style.display        = 'block';
      document.getElementById('left-panel').classList.add('site-imported');

      // Show unit conversion note if rescaled
      const unitNote = document.getElementById('model-unit-note');
      if (unitNote) {
        if (unit !== 'm') {
          unitNote.textContent = `\u26a0 Detected as ${unit} \u2014 scaled to metres automatically`;
          unitNote.style.display = '';
        } else {
          unitNote.style.display = 'none';
        }
      }

      showFeedback(`${format} model loaded \u2014 ${surfaces.length} surfaces detected`
        + (unit !== 'm' ? ` (converted from ${unit})` : ''));
    }

    /* ============================================================
       FILE PICKER
    ============================================================ */
    document.getElementById('import3DModelBtn').addEventListener('click', () =>
      document.getElementById('modelFileInput').click());

    document.getElementById('modelFileInput').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const ext = file.name.split('.').pop().toLowerCase();
      if      (ext === 'obj')                    loadOBJ(file,  onModelLoaded);
      else if (ext === 'gltf' || ext === 'glb')  loadGLTF(file, onModelLoaded);
      else if (ext === 'ifc')                    loadIFC(file,  onModelLoaded);
      else showFeedback('Unsupported format. Use OBJ, glTF, GLB, or IFC.');
      e.target.value = '';
    });

    /* ============================================================
       SITE BOUNDARY DRAWING (GeoJSON)
    ============================================================ */
    function drawSiteBoundary(coords, opts = {}) {
      suppressResize = true;
      if (siteBoundaryLine) {
        scene.remove(siteBoundaryLine);
        siteBoundaryLine.geometry.dispose();
        siteBoundaryLine = null;
      }

      const bbox = computeBBox(coords);

      // If a geocoded origin is supplied (from Select Site), use it as the
      // world origin so the address point is always at (0,0,0) = screen centre.
      // Otherwise fall back to the parcel centroid (manual GeoJSON import).
      const originLon = (opts.originLng != null) ? opts.originLng : bbox.cLon;
      const originLat = (opts.originLat != null) ? opts.originLat : bbox.cLat;

      window._siteBBoxCenter = { cLon: originLon, cLat: originLat };
      siteOriginLon = originLon;
      siteOriginLat = originLat;
      const points = coords.map(c => {
        const [x, z] = latlonToMetres(c[0], c[1], originLon, originLat);
        return new THREE.Vector3(x, 0, z);
      });

      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat  = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 });
      siteBoundaryLine = new THREE.LineLoop(geom, mat);
      scene.add(siteBoundaryLine);

      const box    = new THREE.Box3().setFromObject(siteBoundaryLine);
      const size   = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const siteSpan = Math.max(size.x, size.z);

      updateSceneHelpers(siteSpan);

      // Centre camera on geocoded origin (0,0,0) when opts.originLng is set,
      // so the address point is always in the middle of the view.
      if (opts.originLng != null) {
        const aspect = container.clientWidth / (container.clientHeight || 1);
        const halfH  = Math.max(siteSpan * 0.8, 100);
        base2DhalfH  = halfH;
        camera2D.left   = -halfH * aspect;
        camera2D.right  =  halfH * aspect;
        camera2D.top    =  halfH;
        camera2D.bottom = -halfH;
        pan2D.x = 0;
        pan2D.z = 0;
        zoom2D  = 1;
        update2DCamera();
      } else {
        fit2DCamera(box);
      }
      loadMapTiles(bbox);
      switchMode('2d');

      const area      = computePolygonArea(coords);
      const perimeter = computePolygonPerimeter(coords);

      // Capture site area for GPR denominator
      siteAreaM2 = area;

      document.getElementById('empty-props').style.display        = 'none';
      document.getElementById('site-info-section').style.display  = 'block';
      document.getElementById('gpr-section').style.display        = 'block';
      document.getElementById('site-area').textContent            = area.toFixed(0) + ' m\u00b2';
      document.getElementById('site-perimeter').textContent       = perimeter.toFixed(0) + ' m';
      document.getElementById('site-points').textContent          = coords.length - 1;
      document.getElementById('clearSiteBtn').style.display       = 'block';
      document.getElementById('left-panel').classList.add('site-imported');

      recalcGPR();

      suppressResize = false;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const w = container.clientWidth  || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera3D.aspect = w / h;
        camera3D.updateProjectionMatrix();
        if (siteBoundaryLine && opts.originLng == null) {
          fit2DCamera(new THREE.Box3().setFromObject(siteBoundaryLine));
        }
      }));
      showFeedback(`Site loaded \u2014 ${coords.length - 1} points, ${area.toFixed(0)} m\u00b2`);
    }

    /* ============================================================
       CAMERA FIT HELPERS
    ============================================================ */
    function fit2DCamera(box) {
      const size   = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const aspect = container.clientWidth / (container.clientHeight || 1);
      const siteW  = size.x * 1.3;
      const siteH  = size.z * 1.3;
      const halfH  = Math.max(siteW / (2 * aspect), siteH / 2, 100); // min 200m view

      base2DhalfH     = halfH;
      camera2D.left   = -halfH * aspect;
      camera2D.right  =  halfH * aspect;
      camera2D.top    =  halfH;
      camera2D.bottom = -halfH;

      pan2D.x = center.x;
      pan2D.z = center.z;
      zoom2D  = 1;

      update2DCamera();
    }

    function fit3DCamera(box) {
      const size   = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const dist = Math.max(size.x, size.y, size.z) * 1.5;
      camera3D.position.set(center.x + dist * 0.7, dist, center.z + dist * 0.7);
      camera3D.near = Math.max(0.1, dist * 0.01);
      camera3D.far  = dist * 20;
      camera3D.updateProjectionMatrix();
      controls3D.target.copy(center);
      controls3D.update();
    }

    /* ============================================================
       SURFACE CANVAS OUTLINE
    ============================================================ */
    let surfaceCanvasOutline = null;

    function drawSurfaceCanvasOutline(surface) {
      if (surfaceCanvasOutline) {
        scene.remove(surfaceCanvasOutline);
        surfaceCanvasOutline.geometry.dispose();
        surfaceCanvasOutline = null;
      }

      surface.mesh.geometry.computeBoundingBox();
      const box = new THREE.Box3()
        .copy(surface.mesh.geometry.boundingBox)
        .applyMatrix4(surface.mesh.matrixWorld);

      const min = box.min;
      const max = box.max;

      let pts;
      const n = surface.worldNormal;
      const isHorizontal = Math.abs(n.y) > 0.7;

      if (isHorizontal) {
        const y = (min.y + max.y) / 2 + 0.05;
        pts = [
          new THREE.Vector3(min.x, y, min.z),
          new THREE.Vector3(max.x, y, min.z),
          new THREE.Vector3(max.x, y, max.z),
          new THREE.Vector3(min.x, y, max.z),
          new THREE.Vector3(min.x, y, min.z),
        ];
      } else {
        const facingX = Math.abs(n.x) > Math.abs(n.z);
        const offset  = 0.05;
        if (facingX) {
          const x = n.x > 0 ? max.x + offset : min.x - offset;
          pts = [
            new THREE.Vector3(x, min.y, min.z),
            new THREE.Vector3(x, min.y, max.z),
            new THREE.Vector3(x, max.y, max.z),
            new THREE.Vector3(x, max.y, min.z),
            new THREE.Vector3(x, min.y, min.z),
          ];
        } else {
          const z = n.z > 0 ? max.z + offset : min.z - offset;
          pts = [
            new THREE.Vector3(min.x, min.y, z),
            new THREE.Vector3(max.x, min.y, z),
            new THREE.Vector3(max.x, max.y, z),
            new THREE.Vector3(min.x, max.y, z),
            new THREE.Vector3(min.x, min.y, z),
          ];
        }
      }

      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      surfaceCanvasOutline = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color: 0x2a7a2a, linewidth: 2, depthTest: false })
      );
      surfaceCanvasOutline.renderOrder = 999;
      scene.add(surfaceCanvasOutline);
    }

    function clearSurfaceCanvasOutline() {
      if (surfaceCanvasOutline) {
        scene.remove(surfaceCanvasOutline);
        surfaceCanvasOutline.geometry.dispose();
        surfaceCanvasOutline = null;
      }
    }

    /* ============================================================
       SURFACE CAMERA
    ============================================================ */
    function fitSurfaceCamera(surface) {
      surface.mesh.geometry.computeBoundingBox();
      const box = new THREE.Box3()
        .copy(surface.mesh.geometry.boundingBox)
        .applyMatrix4(surface.mesh.matrixWorld);

      const centre = new THREE.Vector3();
      box.getCenter(centre);

      const size = new THREE.Vector3();
      box.getSize(size);

      const n = surface.worldNormal.clone().normalize();
      const isHorizontal = Math.abs(n.y) > 0.7;

      const aspect = container.clientWidth / (container.clientHeight || 1);
      let halfW, halfH, camPos, up, camNormal;

      if (canvasMode === 'surface') {
        const camDist = Math.max(size.x, size.y, size.z) * 3;
        camPos    = centre.clone().addScaledVector(n, camDist);
        up        = isHorizontal ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
        camNormal = n.clone();
        halfW = isHorizontal ? (size.x / 2) * 1.3 : (Math.abs(n.x) > Math.abs(n.z) ? size.z : size.x) / 2 * 1.3;
        halfH = isHorizontal ? (size.z / 2) * 1.3 : size.y / 2 * 1.3;
      } else {
        if (isHorizontal) {
          const camDist = Math.max(size.x, size.z) * 3;
          camPos    = new THREE.Vector3(centre.x, centre.y + camDist, centre.z);
          up        = new THREE.Vector3(0, 0, -1);
          camNormal = new THREE.Vector3(0, -1, 0);
          halfW = (size.x / 2) * 1.3;
          halfH = (size.z / 2) * 1.3;
        } else {
          const camDist = Math.max(size.x, size.y, size.z) * 3;
          const facingX = Math.abs(n.x) > Math.abs(n.z);
          const snapped = facingX
            ? new THREE.Vector3(Math.sign(n.x), 0, 0)
            : new THREE.Vector3(0, 0, Math.sign(n.z));
          camPos    = centre.clone().addScaledVector(snapped, camDist);
          up        = new THREE.Vector3(0, 1, 0);
          camNormal = snapped.clone();
          halfW = (facingX ? size.z : size.x) / 2 * 1.3;
          halfH = size.y / 2 * 1.3;
        }
      }

      if (halfW / halfH < aspect) halfW = halfH * aspect;
      else halfH = halfW / aspect;

      camera2D.left   = -halfW;
      camera2D.right  =  halfW;
      camera2D.top    =  halfH;
      camera2D.bottom = -halfH;
      camera2D.near   = 0.1;
      camera2D.far    = Math.max(size.x, size.y, size.z) * 12;
      camera2D.zoom   = 1;

      camera2D.position.copy(camPos);
      camera2D.up.copy(up);
      camera2D.lookAt(centre);
      camera2D.updateProjectionMatrix();

      pan2D.x = 0; pan2D.z = 0; zoom2D = 1;
      base2DhalfH = halfH;

      camera2D.userData.surfaceCentre = centre.clone();
      camera2D.userData.surfaceNormal = camNormal.clone();
      camera2D.userData.surfaceUp     = up.clone();
    }

    /* ============================================================
       MODE SWITCHING
    ============================================================ */
    // Wire surfaces.js callbacks now that the functions are defined
    initSurfaces({
      fitSurfaceCamera,
      drawSurfaceCanvasOutline,
      clearSurfaceCanvasOutline,
    });

    function switchMode(mode) {
      currentMode = mode;
      setNorthPointMode(mode);

      document.querySelectorAll('.mode-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.mode === mode));

      if (mode === '2d') {
        camera   = camera2D;
        controls = controls2D;

        if (selectedSurface) {
          fitSurfaceCamera(selectedSurface);
          drawSurfaceCanvasOutline(selectedSurface);
          setGridVisible(false);
          if (axesHelper)  axesHelper.visible = false;          const typeLabels = { ground: 'Ground plane', roof: 'Roof plane', wall: 'Wall plane', sloped: 'Sloped surface' };
          document.getElementById('status-mode').textContent = '2D';
          const modeLabel = canvasMode === 'ortho' ? 'Ortho' : 'Surface';
          showFeedback(`2D canvas [${modeLabel}] \u2014 ${typeLabels[selectedSurface.type] || selectedSurface.type} \u2014 ${selectedSurface.area} m\u00b2`, 0);
        } else {
          clearSurfaceCanvasOutline();
          // Only show grid if no map tiles are active
          setGridVisible(!mapTileGroup);
          if (axesHelper) axesHelper.visible = true;
          if (axesYLine)  axesYLine.visible  = false;
          if (siteBoundaryLine) fit2DCamera(new THREE.Box3().setFromObject(siteBoundaryLine));
          else if (importedModel) fit2DCamera(new THREE.Box3().setFromObject(importedModel));
          document.getElementById('status-mode').textContent = '2D';
          showFeedback('2D Plan View');
        }
      } else {
        camera   = camera3D;
        controls = controls3D;
        clearSurfaceCanvasOutline();
        setGridVisible(false);  // grid hidden in 3D (Design Grid also hidden)
        if (axesHelper) axesHelper.visible = true;
        if (axesYLine)  axesYLine.visible  = true;
        const target = importedModel
          ? new THREE.Box3().setFromObject(importedModel)
          : (siteBoundaryLine ? new THREE.Box3().setFromObject(siteBoundaryLine) : null);
        if (target) fit3DCamera(target);
        document.getElementById('status-mode').textContent = '3D';
        showFeedback('3D View \u2014 click a surface to select it');
      }
      updateGizmoOverlay();
    }

    document.querySelectorAll('.mode-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === currentMode) {
          // Reset current view to default
          if (mode === '2d') {
            rotate2D = 0;
            pan2D.x  = 0;
            pan2D.z  = 0;
            zoom2D   = 1;
            const target = siteBoundaryLine || importedModel;
            if (target) {
              fit2DCamera(new THREE.Box3().setFromObject(target));
            } else {
              // No site loaded — reset frustum to default 100-unit view
              const aspect = container.clientWidth / (container.clientHeight || 1);
              const halfH  = 50;
              camera2D.left   = -halfH * aspect;
              camera2D.right  =  halfH * aspect;
              camera2D.top    =  halfH;
              camera2D.bottom = -halfH;
              base2DhalfH     =  halfH;
              camera2D.updateProjectionMatrix();
            }
            update2DCamera();
            showFeedback('2D view reset');
          } else {
            const target = importedModel || siteBoundaryLine;
            if (target) fit3DCamera(new THREE.Box3().setFromObject(target));
            else { camera3D.position.set(100, 100, 100); controls3D.target.set(0,0,0); controls3D.update(); }
            showFeedback('3D view reset');
          }
        } else {
          switchMode(mode);
        }
      }));

    const menu2D   = document.getElementById('mode-2d-menu');
    const btn2D    = document.querySelector('.mode-btn[data-mode="2d"]');

    btn2D.addEventListener('contextmenu', e => {
      e.preventDefault();
      menu2D.style.display = menu2D.style.display === 'none' ? 'block' : 'none';
    });

    document.querySelectorAll('.mode-context-item').forEach(item => {
      item.addEventListener('click', () => {
        canvasMode = item.dataset.canvas;
        document.querySelectorAll('.mode-context-item').forEach(i =>
          i.classList.toggle('active', i.dataset.canvas === canvasMode));
        menu2D.style.display = 'none';
        if (currentMode === '2d' && selectedSurface) switchMode('2d');
        showFeedback(`2D mode: ${canvasMode === 'ortho' ? 'Ortho (standard viewpoints)' : 'Surface (normal-aligned)'}`);
      });
    });

    document.addEventListener('click', e => {
      if (!btn2D.contains(e.target) && !menu2D.contains(e.target)) {
        menu2D.style.display = 'none';
      }
    });

    switchMode('2d');
    update2DCamera();

    /* ============================================================
       RESIZE
    ============================================================ */
    let suppressResize = false;
    let resizeRAF = null;

    function resizeToContainer() {
      if (suppressResize) return;
      if (resizeRAF) cancelAnimationFrame(resizeRAF);
      resizeRAF = requestAnimationFrame(() => {
        resizeRAF = null;
        const w = container.clientWidth  || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera3D.aspect = w / h;
        camera3D.updateProjectionMatrix();
        if (siteBoundaryLine) {
          fit2DCamera(new THREE.Box3().setFromObject(siteBoundaryLine));
        } else {
          const aspect = w / h;
          const halfH  = base2DhalfH || 50;
          camera2D.left   = -halfH * aspect;
          camera2D.right  =  halfH * aspect;
          camera2D.updateProjectionMatrix();
          update2DCamera();
        }
      });
    }
    new ResizeObserver(resizeToContainer).observe(container);
    requestAnimationFrame(() => requestAnimationFrame(resizeToContainer));

    /* renderCompassGizmo — defined in js/north-point-3d.js, imported above */

    /* ============================================================
       ANIMATION LOOP
    ============================================================ */
    (function animate() {
      controls.update();
      updateNorthRotation();

      // ── CAD Universe orientation ──────────────────────────────────────────
      // The CAD grid (gridHelper) is FIXED at True North. It never rotates.
      // The axes helper rotates with Design North as a visual orientation aid.
      // The DXF model, site boundary, and all imported geometry never rotate.
      //
      // dnDeg +ve = clockwise from True North (e.g. Design North is East of True North)
      // Three.js rotation.y +ve = CCW, so we negate.
      const _dn    = getDesignNorthAngle();
      const _dnRad = (_dn ?? 0) * Math.PI / 180;

      // Axes: rotate with Design North (shows the design coordinate system)
      if (axesHelper) axesHelper.rotation.y = -_dnRad;

      // Design Grid: rotate group to match Design North (cheap matrix op, no geometry rebuild)
      if (designGridManager) designGridManager.setHorizontalRotation(-_dnRad);

      // Switch between CAD grid and Design Grid based on whether Design North is set
      updateGridVisibility();

      renderer.render(scene, camera);
      updateSitePinDOM();
      if (currentMode === '3d' && isGizmo3DVisible()) {
        renderer._compassMainScene = scene; // expose for renderCompassGizmo
        renderCompassGizmo();
      }
      requestAnimationFrame(animate);
    })();

    /* ============================================================
       PANEL COLLAPSE
    ============================================================ */
    document.querySelectorAll('.collapse-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;
        const panel   = document.getElementById(`${panelId}-panel`);
        panel.classList.toggle('collapsed');
        btn.textContent = panel.classList.contains('collapsed')
          ? (panelId === 'left' ? '\u25ba' : '\u25c4')
          : (panelId === 'left' ? '\u25c4' : '\u25ba');
      });
    });

    /* ============================================================
       FEEDBACK / STATUS BAR
    ============================================================ */

    /* ============================================================
       LOT BOUNDARY PANEL — appears in right panel after DXF import
    ============================================================ */
    function buildBoundaryPanel(wgs84Bounds, hasExisting = false) {
      const existing = document.getElementById('boundary-section');
      if (existing) existing.remove();

      const section = document.createElement('div');
      section.id        = 'boundary-section';
      section.className = 'property-section';
      section.innerHTML = '<h4>Lot Boundary</h4>';

      const row = document.createElement('div');
      row.className = 'info-row';

      if (wgs84Bounds) {
        const info = document.createElement('div');
        info.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:8px;';
        info.textContent = `Site centred at ${wgs84Bounds.sw.lat.toFixed(5)}\u00b0, `
          + `${wgs84Bounds.sw.lng.toFixed(5)}\u00b0`;
        row.appendChild(info);
      }

      const btn = document.createElement('button');
      btn.id = 'draw-boundary-btn';
      btn.textContent = hasExisting ? '\u2713 Lot Boundary \u2014 Re-draw\u2026' : 'Draw Lot Boundary\u2026';
      btn.style.cssText = `
        width:100%; padding:7px 12px; font-size:12px; cursor:pointer;
        background:${hasExisting ? 'var(--accent-dark,#2d6b2d)' : 'var(--accent-mid,#4a8a4a)'}; color:#fff; border:none;
        border-radius:4px; text-align:left;`;
      btn.addEventListener('click', () => {
        if (!wgs84Bounds) {
          showFeedback('No UTM coordinates \u2014 re-import with UTM values to use boundary picker');
          return;
        }
        openBoundaryPicker(wgs84Bounds, async (geojson) => {
          try {
            await addBoundaryToGPR(geojson);
            renderLotBoundary(geojson);
            btn.textContent = '\u2713 Lot Boundary saved \u2014 Re-draw\u2026';
            btn.style.background = 'var(--accent-dark,#2d6b2d)';
            showFeedback('Lot boundary saved to project');
            // ── Update Supabase repository with boundary ───────────────
            const anchor = getRealWorldAnchor();
            const blob   = await getActiveGPRBlob();
            if (blob && anchor) {
              saveProject(blob, {
                site_name:    document.title || 'GPR Project',
                has_boundary: true,
                wgs84_lat:    anchor.lat,
                wgs84_lng:    anchor.lng,
              }).catch(e => console.warn('[GPR] Supabase boundary update failed:', e));
            }
          } catch (err) {
            console.error('[GPR] boundary save failed:', err);
            showFeedback('Failed to save boundary: ' + err.message);
          }
        });
      });

      row.appendChild(btn);

      // Download button
      const dlBtn = document.createElement('button');
      dlBtn.textContent = '\u2913 Download .gpr';
      dlBtn.style.cssText = `
        width:100%; margin-top:6px; padding:5px 12px; font-size:11px; cursor:pointer;
        background:none; color:var(--text-secondary); border:1px solid var(--chrome-border);
        border-radius:4px; text-align:left;`;
      dlBtn.addEventListener('click', async () => {
        try {
          const siteName = document.title || 'project';
          await downloadGPR(siteName);
        } catch (err) {
          showFeedback('Download failed: ' + err.message);
        }
      });
      row.appendChild(dlBtn);

      section.appendChild(row);

      const layerSection = document.getElementById('cadmapper-layer-section');
      const panelContent = document.querySelector('#right-panel .panel-content');
      if (layerSection && panelContent) {
        panelContent.insertBefore(section, layerSection.nextSibling);
      } else if (panelContent) {
        panelContent.appendChild(section);
      }
    }



    /* ============================================================
       CLEAR SITE
    ============================================================ */
    document.getElementById('clearSiteBtn').addEventListener('click', () => {
      if (siteBoundaryLine) {
        scene.remove(siteBoundaryLine);
        siteBoundaryLine.geometry.dispose();
        siteBoundaryLine = null;
      }
      if (siteSurface) {
        scene.remove(siteSurface);
        siteSurface.geometry.dispose();
        siteSurface = null;
      }
      if (sitePinGroup) {
        scene.remove(sitePinGroup);
        sitePinGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        sitePinGroup = null;
      }
      document.getElementById('site-pin-dom')?.remove();
      sitePinDom = null;
      sitePinWorldPos = null;
      if (importedModel) {
        scene.remove(importedModel);
        scene.remove(edgeGroup);
        while (edgeGroup.children.length) {
          const c = edgeGroup.children[0];
          c.geometry.dispose();
          edgeGroup.remove(c);
        }
        importedModel = null;
      }
      if (terrainMesh) {
        scene.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        terrainMesh = null;
      }
      if (cadmapperGroup) {
        scene.remove(cadmapperGroup);
        cadmapperGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        cadmapperGroup = null;
        document.getElementById('cadmapper-layer-section')?.remove();
      }
      clearMapTiles();
      surfaces        = [];
      hoveredSurface  = null;
      selectedSurface = null;
      siteAreaM2      = 0;
      clearSurfaceCanvasOutline();

      document.getElementById('left-panel').classList.remove('site-imported');
      document.getElementById('clearSiteBtn').style.display          = 'none';
      document.getElementById('site-info-section').style.display     = 'none';
      document.getElementById('model-info-section').style.display    = 'none';
      document.getElementById('surface-section').style.display       = 'none';
      document.getElementById('gpr-section').style.display              = 'none';
      document.getElementById('plant-schedule-section').style.display   = 'none';
      document.getElementById('empty-props').style.display              = 'block';
      document.getElementById('section-surfaces').style.display      = 'none';
      document.getElementById('surfaces-list').innerHTML              = '';
      document.getElementById('gpr-value').textContent               = '\u2014';
      document.getElementById('boundary-section')?.remove();
      clearLotBoundary();
      showFeedback('Site cleared');
    });

    /* ============================================================
       LOT BOUNDARY — REAL WORLD scene rendering
       Converts WGS84 GeoJSON polygon → Three.js line in scene space
    ============================================================ */
    function clearLotBoundary() {
      if (lotBoundaryGroup) {
        scene.remove(lotBoundaryGroup);
        lotBoundaryGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        lotBoundaryGroup = null;
      }
      document.getElementById('lot-boundary-layer-row')?.remove();
    }

    function renderLotBoundary(boundaryGeojson) {
      clearLotBoundary();
      if (!boundaryGeojson?.geometry?.coordinates?.[0]) return;

      const ring   = boundaryGeojson.geometry.coordinates[0];
      const pts    = ring.map(([lng, lat]) => {
        const sc = wgs84ToScene(lat, lng);
        return sc ? new THREE.Vector3(sc.x, 0.15, sc.z) : null;
      }).filter(Boolean);

      if (pts.length < 3) return;
      pts.push(pts[0]);   // close the ring

      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat  = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 });
      lotBoundaryGroup = new THREE.Group();
      lotBoundaryGroup.name = 'lot-boundary';
      lotBoundaryGroup.add(new THREE.Line(geom, mat));
      scene.add(lotBoundaryGroup);

      // Add to Properties panel under Site Context
      buildLotBoundaryLayerRow();
    }

    function buildLotBoundaryLayerRow() {
      const existing = document.getElementById('lot-boundary-layer-row');
      if (existing) existing.remove();

      const section = document.getElementById('cadmapper-layer-section');
      if (!section) return;

      const row = document.createElement('div');
      row.id        = 'lot-boundary-layer-row';
      row.className = 'info-row';
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;width:100%;';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true;
      cb.style.cssText = 'accent-color:var(--accent-mid,#4a8a4a);';
      cb.addEventListener('change', () => { if (lotBoundaryGroup) lotBoundaryGroup.visible = cb.checked; });
      const dot = document.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#ff6600;';
      const name = document.createElement('span');
      name.style.cssText = 'flex:1;font-size:12px;'; name.textContent = 'Google Lot Boundary';
      label.append(cb, dot, name);
      row.appendChild(label);
      section.appendChild(row);
    }

    /* ============================================================
       OPEN GPR FILE — Recent Projects modal
    ============================================================ */
    document.getElementById('openGPRBtn').addEventListener('click', () => {
      showProjectsModal(async (file) => {
        showFeedback('Opening project\u2026', 0);
        try {
          await openGPRFile(file);
        } catch (err) {
          console.error('[GPR open]', err);
          showFeedback('Failed to open project: ' + err.message);
        }
      });
    });

    // ── Named function so both the modal callback and any future callers can use it ──
    async function openGPRFile(file) {
      const { manifest, reference, design, boundary, hasDXF, zip } = await openGPR(file);

      // ── REAL WORLD: restore anchor and scene offset from reference.json ──
      setRealWorldAnchor(reference.utm_zone, reference.utm_easting, reference.utm_northing);
      setSceneOffset(reference.scene_offset_x ?? 0, reference.scene_offset_z ?? 0);

      // ── Re-parse embedded DXF if present ──────────────────────────────
      if (hasDXF) {
        const dxfEntry = zip.file('context/cadmapper.dxf');
        const dxfBytes = await dxfEntry.async('arraybuffer');
        const dxfText  = await new File([dxfBytes], 'cadmapper.dxf').text();
        const allLayers = new Set([
          'topography','buildings','highways','major_roads',
          'minor_roads','paths','parks','water','railways','contours'
        ]);
        const layerGroups = parseCadmapperDXF(dxfText, allLayers, THREE);
        if (layerGroups && Object.keys(layerGroups).length) {
          if (cadmapperGroup) {
            scene.remove(cadmapperGroup);
            cadmapperGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
            cadmapperGroup = null;
          }
          cadmapperGroup = new THREE.Group();
          cadmapperGroup.name = 'cadmapper-context';
          Object.values(layerGroups).forEach(g => cadmapperGroup.add(g));
          const offX = reference.scene_offset_x ?? 0;
          const offZ = reference.scene_offset_z ?? 0;
          cadmapperGroup.children.forEach(child => {
            child.position.x -= offX;
            child.position.z -= offZ;
          });
          const floorBox = new THREE.Box3().setFromObject(cadmapperGroup);
          cadmapperGroup.children.forEach(child => { child.position.y -= floorBox.min.y; });
          scene.add(cadmapperGroup);
          const size = new THREE.Vector3();
          new THREE.Box3().setFromObject(cadmapperGroup).getSize(size);
          updateSceneHelpers(Math.max(size.x, size.z));
          designGridManager.initHorizontal(
            design?.grid_spacing_m ?? 100, design?.minor_divisions ?? 0,
            5000, new THREE.Vector3(0, 0, 0)
          );
          fit3DCamera(new THREE.Box3().setFromObject(cadmapperGroup));
          switchMode('3d');
          document.getElementById('empty-props').style.display  = 'none';
          document.getElementById('clearSiteBtn').style.display = 'block';
          document.getElementById('left-panel').classList.add('site-imported');
          buildLayerPanel(layerGroups);
        }
      }
      if (boundary) renderLotBoundary(boundary);
      const wgs84Bounds = hasRealWorldAnchor() ? {
        sw: sceneToWGS84(-reference.site_span_m / 2, -reference.site_span_m / 2),
        ne: sceneToWGS84( reference.site_span_m / 2,  reference.site_span_m / 2),
      } : null;
      buildBoundaryPanel(wgs84Bounds, !!boundary);
      showFeedback(`Opened: ${manifest.site_name ?? file.name}`);
    }

    /* ============================================================
       VIEW CONTROLS
    ============================================================ */
    document.getElementById('fitSiteBtn').addEventListener('click', () => {
      const target = importedModel || siteBoundaryLine;
      if (!target) { showFeedback('No model or site loaded'); return; }
      const box = new THREE.Box3().setFromObject(target);
      if (currentMode === '2d') fit2DCamera(box); else fit3DCamera(box);
      showFeedback('Fitted to model');
    });

    document.getElementById('resetCameraBtn').addEventListener('click', () => {
      if (currentMode === '2d') {
        pan2D.x = 0; pan2D.z = 0; zoom2D = 1;
        update2DCamera();
      } else {
        camera3D.position.set(100, 100, 100);
        camera3D.lookAt(0, 0, 0);
        controls3D.target.set(0, 0, 0);
        controls3D.update();
      }
      showFeedback('Camera reset');
    });

    document.getElementById('toggleGridBtn').addEventListener('click', () => {
      if (gridHelper) {
        const next = !gridHelper.visible;
        setGridVisible(next);
        showFeedback('Grid ' + (next ? 'on' : 'off'));
      }
    });

    /* ============================================================
       PLACEHOLDER BUTTONS
    ============================================================ */
    document.getElementById('mapOverlayToggle')?.addEventListener('change', e => {
      if (mapTileGroup) mapTileGroup.visible = e.target.checked;
    });

    document.getElementById('componentLibraryBtn')?.addEventListener('click', () => showFeedback('Component Library \u2014 coming soon'));
    document.getElementById('generateReportBtn')?.addEventListener('click',   () => showFeedback('GPR Report \u2014 coming soon'));

    document.querySelectorAll('.tool-btn').forEach(btn =>
      btn.addEventListener('click', () => showFeedback(`Tool: ${btn.dataset.action} \u2014 coming soon`)));

    /* ============================================================
       PLANT LIBRARY + GPR ENGINE  (v2 — multi-instance per surface)
    ============================================================ */

    // ── State ──────────────────────────────────────────────────
    // Each surface has: surface.plants = [{ instanceId, speciesId, canopyArea }]
    // GPR = Σ(instance.canopyArea × species.lai) / site_area

    let plantDb          = [];  // loaded from plants_free.json
    let plantModalOpen   = false;
    let selectedPlant    = null;  // species highlighted in modal
    let siteAreaM2       = 0;
    let _instanceCounter = 0;     // monotonically increasing instance ID

    // ── Load plant database ────────────────────────────────────
    fetch('./plants_free.json')
      .then(r => r.json())
      .then(db => {
        plantDb            = db.species || [];
        _substrateCapTable = db.substrate_caps || null;
        console.log(`GPRTool: loaded ${plantDb.length} species, ${_substrateCapTable?.length || 0} substrate caps`);
      })
      .catch(err => console.warn('Plant library not loaded:', err));

    // ── GPR: Σ(canopyArea × LAI) / site_area ────────────────────
    function recalcGPR() {
      const gprEl     = document.getElementById('gpr-value');
      const numEl     = document.getElementById('gpr-numerator');
      const breakRow  = document.getElementById('gpr-breakdown-row');
      const targetEl  = document.getElementById('gpr-target');
      const resultRow = document.querySelector('.gpr-result');
      if (!gprEl) return;

      let numerator = 0;
      surfaces.forEach(s => {
        (s.plants || []).forEach(inst => {
          const sp = plantDb.find(p => p.id === inst.speciesId);
          if (sp && inst.canopyArea > 0) numerator += inst.canopyArea * sp.lai;
        });
      });

      let denom = siteAreaM2;
      if (!denom) {
        denom = surfaces.filter(s => s.type === 'ground').reduce((acc, s) => acc + s.area, 0);
      }

      if (denom <= 0 || numerator === 0) {
        gprEl.textContent = '\u2014';
        if (numEl)    numEl.textContent = '\u2014';
        if (breakRow) breakRow.style.display = 'none';
        if (resultRow) resultRow.classList.remove('over-target', 'under-target');
        updateClearBtn();
        return;
      }

      const gpr = numerator / denom;
      gprEl.textContent = gpr.toFixed(2);
      if (numEl)    numEl.textContent = numerator.toFixed(1) + ' m\u00b2';
      if (breakRow) breakRow.style.display = '';

      const target = parseFloat(targetEl?.value);
      if (!isNaN(target) && target > 0 && resultRow) {
        resultRow.classList.toggle('over-target',  gpr >= target);
        resultRow.classList.toggle('under-target', gpr < target);
      }
      updateClearBtn();
    }

    function updateClearBtn() {
      const anyPlanted = surfaces.some(s => (s.plants || []).length > 0);
      const clearBtn = document.getElementById('clearPlantsBtn');
      if (clearBtn) clearBtn.disabled = !anyPlanted;
    }

    // ── Add / remove plant instances ───────────────────────────
    function addPlantInstance(surface, species, canopyArea) {
      if (!surface.plants) surface.plants = [];
      const inst = { instanceId: ++_instanceCounter, speciesId: species.id, canopyArea };
      surface.plants.push(inst);
      updateSurfaceListTag(surface);
      renderSurfacePlantSchedule(surface);
      recalcGPR();
      showFeedback(`Added ${species.common} \u2014 ${canopyArea} m\u00b2, LAI ${species.lai}`);
    }

    function removePlantInstance(surface, instanceId) {
      if (!surface.plants) return;
      surface.plants = surface.plants.filter(i => i.instanceId !== instanceId);
      updateSurfaceListTag(surface);
      renderSurfacePlantSchedule(surface);
      recalcGPR();
      showFeedback('Plant instance removed');
    }

    function updateInstanceCanopyArea(surface, instanceId, newArea) {
      const inst = (surface.plants || []).find(i => i.instanceId === instanceId);
      if (inst) { inst.canopyArea = newArea; recalcGPR(); }
    }

    // ── Surface list badge: shows plant count ────────────────────
    function updateSurfaceListTag(surface) {
      const item = document.querySelector(`.surface-item[data-surface-id="${surface.id}"]`);
      if (!item) return;
      item.querySelector('.surface-plant-tag')?.remove();
      const count = (surface.plants || []).length;
      if (count > 0) {
        const tag = document.createElement('span');
        tag.className   = 'surface-plant-tag';
        tag.textContent = count + (count === 1 ? ' plant' : ' plants');
        item.appendChild(tag);
      }
    }

    // ── Plant schedule table in right panel ────────────────────
    function renderSurfacePlantSchedule(surface) {
      const schedSection = document.getElementById('plant-schedule-section');
      const listEl       = document.getElementById('surf-plant-list');
      const countEl      = document.getElementById('surf-plant-count');
      if (!schedSection || !listEl) return;

      if (!surface) { schedSection.style.display = 'none'; return; }

      schedSection.style.display = 'block';
      const plants = surface.plants || [];
      if (countEl) countEl.textContent = plants.length ? `(${plants.length})` : '';

      listEl.innerHTML = '';

      if (!plants.length) {
        listEl.innerHTML = '<p style="font-size:11px;color:var(--text-secondary,#888);padding:4px 0">No plants on this surface. Click \u201cAdd Plant\u2026\u201d below.</p>';
        return;
      }

      plants.forEach(inst => {
        const sp = plantDb.find(p => p.id === inst.speciesId);
        if (!sp) return;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--chrome-border,#3a3a3a)';

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'flex:1;min-width:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        nameSpan.title = sp.scientific;
        nameSpan.textContent = sp.common;

        const laiSpan = document.createElement('span');
        laiSpan.style.cssText = 'font-size:10px;color:var(--accent-light,#7fc47f);flex-shrink:0';
        laiSpan.textContent = `LAI ${sp.lai}`;

        const areaInput = document.createElement('input');
        areaInput.type  = 'number';
        areaInput.value = inst.canopyArea;
        areaInput.min   = '0';
        areaInput.step  = '0.1';
        areaInput.title = 'Canopy area (m\u00b2)';
        areaInput.style.cssText = 'width:52px;font-size:11px;background:var(--chrome-input,#1a1a1a);border:1px solid var(--chrome-border,#444);border-radius:3px;color:var(--text-primary,#e8e8e8);padding:2px 4px;text-align:right';
        areaInput.addEventListener('change', () => {
          const v = parseFloat(areaInput.value);
          if (!isNaN(v) && v >= 0) updateInstanceCanopyArea(surface, inst.instanceId, v);
        });

        const m2Label = document.createElement('span');
        m2Label.style.cssText = 'font-size:10px;color:var(--text-secondary,#888);flex-shrink:0';
        m2Label.textContent = 'm\u00b2';

        const removeBtn = document.createElement('button');
        removeBtn.title = 'Remove';
        removeBtn.style.cssText = 'background:none;border:none;color:var(--text-secondary,#888);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;flex-shrink:0';
        removeBtn.textContent = '\u00d7';
        removeBtn.addEventListener('click', () => removePlantInstance(surface, inst.instanceId));
        removeBtn.addEventListener('mouseenter', () => removeBtn.style.color = '#cc4444');
        removeBtn.addEventListener('mouseleave', () => removeBtn.style.color = '');

        row.append(nameSpan, laiSpan, areaInput, m2Label, removeBtn);
        listEl.appendChild(row);
      });
    }

    // ── Build plant list in modal ──────────────────────────────
    function renderPlantList() {
      const listEl   = document.getElementById('plant-list');
      const query    = (document.getElementById('plant-search')?.value || '').toLowerCase();
      const filter   = document.getElementById('plant-filter')?.value || 'all';
      const surfType = selectedSurface?.type || null;

      const matches = plantDb.filter(p => {
        const typeOk = filter === 'all'    ? true
                     : filter === 'bamboo' ? p.category === 'Bamboo'
                     : p.surface_types.includes(filter);
        const searchOk = !query
          || p.common.toLowerCase().includes(query)
          || p.scientific.toLowerCase().includes(query)
          || p.category.toLowerCase().includes(query);
        return typeOk && searchOk;
      });

      if (surfType) {
        matches.sort((a, b) => {
          const aOk = a.surface_types.includes(surfType) ? 0 : 1;
          const bOk = b.surface_types.includes(surfType) ? 0 : 1;
          if (aOk !== bOk) return aOk - bOk;
          return b.lai - a.lai;
        });
      } else {
        matches.sort((a, b) => b.lai - a.lai);
      }

      listEl.innerHTML = '';

      if (!matches.length) {
        listEl.innerHTML = '<p style="text-align:center;color:var(--text-secondary,#888);padding:20px;font-size:12px">No species found</p>';
        refreshModalStatus();
        return;
      }

      matches.forEach(p => {
        const compatible = surfType ? p.surface_types.includes(surfType) : true;
        const srcClass   = p.source.includes('Singapore') ? 'field'
                         : p.source.includes('ORNL')      ? 'ornl' : 'lit';
        const srcLabel   = p.source.includes('Singapore') ? 'Field'
                         : p.source.includes('ORNL')      ? 'ORNL' : 'Lit';
        const isSelected = selectedPlant && selectedPlant.id === p.id;

        const div = document.createElement('div');
        div.className = 'plant-item' + (isSelected ? ' selected-plant' : '');
        div.style.opacity = (!surfType || compatible) ? '1' : '0.4';
        div.innerHTML = `
          <span class="plant-lai-badge">${p.lai.toFixed(1)}</span>
          <span class="plant-names">
            <div class="plant-common">${p.common}</div>
            <div class="plant-sci">${p.scientific}</div>
            <div class="plant-cat">${p.category}</div>
          </span>
          <span class="plant-src-badge ${srcClass}">${srcLabel}</span>`;

        div.addEventListener('click', () => {
          selectedPlant = p;
          document.querySelectorAll('.plant-item').forEach(el => el.classList.remove('selected-plant'));
          div.classList.add('selected-plant');
          refreshModalStatus();
        });
        listEl.appendChild(div);
      });

      refreshModalStatus();
    }

    function refreshModalStatus() {
      const statusEl  = document.getElementById('plant-modal-status');
      const assignBtn = document.getElementById('plant-assign-btn');
      if (!statusEl) return;

      if (!selectedSurface) {
        statusEl.textContent = 'Select a surface first.';
        if (assignBtn) assignBtn.disabled = true;
        return;
      }

      const surfType   = selectedSurface.type;
      const compatible = selectedPlant ? selectedPlant.surface_types.includes(surfType) : false;

      if (selectedPlant) {
        // Check substrate compatibility
        const subMm    = selectedSurface.substrate_mm;
        const minSub   = selectedPlant.size?.min_substrate_mm;
        const subWarn  = subMm && minSub && subMm < minSub
          ? ` ⚠ Needs ≥${minSub}mm substrate (surface has ${subMm}mm)`
          : '';
        const limits   = radiusLimits(selectedPlant, selectedSurface);
        const capWarn  = limits.capLabel && !subWarn ? ` — capped at ${limits.max}m radius` : '';

        statusEl.textContent = compatible
          ? `Add ${selectedPlant.common} (LAI ${selectedPlant.lai}) to ${surfType}${subWarn || capWarn}`
          : `${selectedPlant.common} is not rated for ${surfType} surfaces`;
        statusEl.style.color = subWarn ? '#e8a040' : '';
        if (assignBtn) assignBtn.disabled = !compatible;
      } else {
        statusEl.textContent = `${surfType} surface — select a species above`;
        statusEl.style.color = '';
        if (assignBtn) assignBtn.disabled = true;
      }
    }

    // ── Open / close modal ─────────────────────────────────────
    function openPlantModal() {
      if (!plantDb.length) {
        showFeedback('Plant library not loaded \u2014 check browser console');
        return;
      }
      if (!selectedSurface) {
        showFeedback('Select a surface first, then click Add Plant');
        return;
      }
      plantModalOpen = true;
      selectedPlant  = null;
      document.getElementById('plant-modal-overlay').classList.add('open');
      document.getElementById('plant-search').value = '';
      const filterEl = document.getElementById('plant-filter');
      if (filterEl) filterEl.value = selectedSurface.type;
      renderPlantList();
      document.getElementById('plant-search').focus();
      showFeedback('Plant Library \u2014 select a species to add', 0);
    }

    function closePlantModal() {
      plantModalOpen = false;
      selectedPlant  = null;
      document.getElementById('plant-modal-overlay').classList.remove('open');
    }

    // ── Modal bindings ─────────────────────────────────────────
    document.getElementById('plant-modal-close').addEventListener('click', closePlantModal);
    document.getElementById('plant-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('plant-modal-overlay')) closePlantModal();
    });
    document.getElementById('plant-search').addEventListener('input', renderPlantList);
    document.getElementById('plant-filter').addEventListener('change', renderPlantList);

    // plant-assign-btn is wired in the PLACEMENT ENGINE section below
    // (starts placement flow instead of directly adding)

    // Escape closes modal (capture phase)
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && plantModalOpen) { e.stopPropagation(); closePlantModal(); }
    }, true);

    // ── Wire buttons ───────────────────────────────────────────
    document.getElementById('plantLibraryBtn')?.addEventListener('click', openPlantModal);
    document.getElementById('addPlantBtn')?.addEventListener('click', openPlantModal);

    document.getElementById('gpr-target')?.addEventListener('input', recalcGPR);

    // ── Substrate depth input ─────────────────────────────────
    document.getElementById('surf-substrate')?.addEventListener('change', e => {
      if (!selectedSurface) return;
      const v = parseInt(e.target.value);
      selectedSurface.substrate_mm = (!v || isNaN(v)) ? null : v;

      // Show cap label
      const capEl = document.getElementById('surf-substrate-cap');
      if (capEl) {
        const label = substrateCapLabel(selectedSurface.substrate_mm);
        if (label) {
          capEl.textContent = label;
          capEl.style.display = '';
        } else {
          capEl.style.display = 'none';
        }
      }

      // Refresh modal if open (species compatibility may have changed)
      if (plantModalOpen) renderPlantList();
    });

    /* ============================================================
       PLANT PLACEMENT ENGINE
       Handles 2D canvas placement of plant symbols:
         circle  — trees, shrubs, bamboo (click centre, drag radius)
         polygon — groundcover, turf, climbers, green roof
       Also manages 3D proxy meshes for placed symbols.
    ============================================================ */

    // ── Placement type by category ─────────────────────────────
    function placementTypeForCategory(cat) {
      if (!cat) return 'circle';
      const c = cat.toLowerCase();
      if (c.includes('tree') || c.includes('shrub') || c.includes('bamboo') || c.includes('palm')) return 'circle';
      return 'polygon';
    }

    // ── Substrate cap lookup ───────────────────────────────────
    // Returns max canopy radius allowed for a given substrate depth (mm)
    // Uses the substrate_caps table from plants_free.json
    let _substrateCapTable = null;
    function substrateCapRadius(depth_mm) {
      if (!depth_mm || depth_mm <= 0) return Infinity;
      const table = _substrateCapTable;
      if (!table) return Infinity;
      // Find first entry where depth_mm <= cap threshold
      for (const cap of table) {
        if (depth_mm <= cap.depth_mm) return cap.max_radius_m;
      }
      return Infinity;
    }
    function substrateCapLabel(depth_mm) {
      if (!depth_mm || depth_mm <= 0) return null;
      const table = _substrateCapTable;
      if (!table) return null;
      for (const cap of table) {
        if (depth_mm <= cap.depth_mm) return cap.label;
      }
      return null;
    }

    // ── Radius limits: species data + substrate cap ────────────
    // Returns { min, max, def } in metres
    function radiusLimits(species, surface) {
      // 1. Species size data (from JSON)
      const sz = species?.size;
      const spMin = sz?.canopy_radius_min_m  ?? 0.5;
      const spMax = sz?.canopy_radius_max_m  ?? 15;
      const spDef = sz?.canopy_radius_typical_m ?? 3;

      // 2. Substrate cap from surface (if set)
      const subMm   = surface?.substrate_mm;
      const capMax  = substrateCapRadius(subMm);

      // 3. Final max = min of species max and installation cap
      const finalMax = Math.min(spMax === 999 ? 50 : spMax, capMax === Infinity ? 50 : capMax);
      const finalDef = Math.min(spDef === 999 ? 3 : spDef, finalMax);

      return {
        min: spMin,
        max: finalMax,
        def: finalDef,
        capLabel: subMm ? substrateCapLabel(subMm) : null,
        substrateOk: !sz?.min_substrate_mm || !subMm || subMm >= sz.min_substrate_mm
      };
    }

    // ── State ──────────────────────────────────────────────────
    //  mode: 'idle' | 'placing_circle' | 'placing_polygon' | 'editing'
    let placementMode    = 'idle';
    let placingSpecies   = null;   // species object being placed
    let placingCircle    = null;   // { cx, cz, radius } — preview
    let placingPoly      = [];     // [{x,z}] — polygon vertices in progress
    let previewMesh      = null;   // THREE.Mesh — live preview in scene
    let editingInstance  = null;   // { surface, inst } — selected for edit

    // ── Proxy mesh group ───────────────────────────────────────
    const plantProxyGroup = new THREE.Group();
    plantProxyGroup.renderOrder = 2;
    scene.add(plantProxyGroup);

    // ── Materials ──────────────────────────────────────────────
    const PROXY_MAT = {
      tree:       new THREE.MeshBasicMaterial({ color: 0x2d7a2d, side: THREE.DoubleSide }),
      shrub:      new THREE.MeshBasicMaterial({ color: 0x3a9a3a, side: THREE.DoubleSide }),
      bamboo:     new THREE.MeshBasicMaterial({ color: 0x4ab040, side: THREE.DoubleSide }),
      groundcover:new THREE.MeshBasicMaterial({ color: 0x7ac050, opacity: 0.75, transparent: true, side: THREE.DoubleSide }),
      polygon:    new THREE.MeshBasicMaterial({ color: 0x5ab848, opacity: 0.65, transparent: true, side: THREE.DoubleSide }),
      preview:    new THREE.MeshBasicMaterial({ color: 0x44cc44, opacity: 0.45, transparent: true, side: THREE.DoubleSide }),
      previewLine:new THREE.LineBasicMaterial({ color: 0x44cc44 }),
      trunk:      new THREE.MeshBasicMaterial({ color: 0x8b6040 }),
    };

    // ── Coordinate helpers ─────────────────────────────────────
    // Get surface bounding box centre (world space)
    function getSurfaceCentre(surface) {
      surface.mesh.geometry.computeBoundingBox();
      const box = new THREE.Box3().copy(surface.mesh.geometry.boundingBox).applyMatrix4(surface.mesh.matrixWorld);
      const c = new THREE.Vector3();
      box.getCenter(c);
      return c;
    }

    // Raycast screen NDC onto surface mesh → world point
    function raycastSurface(ndc, surface) {
      const r = new THREE.Raycaster();
      r.setFromCamera(ndc, camera2D);
      const hits = r.intersectObject(surface.mesh, false);
      return hits.length ? hits[0].point : null;
    }

    // World point → surface-local UV (metres from centre)
    function worldToSurfaceUV(worldPt, surface) {
      const n   = surface.worldNormal.clone().normalize();
      const isH = Math.abs(n.y) > 0.7;
      const c   = getSurfaceCentre(surface);
      if (isH) {
        return { u: worldPt.x - c.x, v: worldPt.z - c.z };
      } else {
        // Wall — use surface tangent axes
        const up    = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, n).normalize();
        return {
          u: worldPt.clone().sub(c).dot(right),
          v: worldPt.y - c.y
        };
      }
    }

    // Surface UV → world point (on surface plane)
    function surfaceUVToWorld(u, v, surface) {
      const n   = surface.worldNormal.clone().normalize();
      const isH = Math.abs(n.y) > 0.7;
      const c   = getSurfaceCentre(surface);
      if (isH) {
        return new THREE.Vector3(c.x + u, c.y + 0.05, c.z + v);
      } else {
        const up    = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, n).normalize();
        return c.clone()
          .addScaledVector(right, u)
          .addScaledVector(up, v)
          .addScaledVector(n, 0.05);
      }
    }

    // ── NDC from mouse event ────────────────────────────────────
    function canvasNDC(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
         ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1
      );
    }

    // ── Start placement after modal ─────────────────────────────
    function startPlacement(species) {
      placingSpecies = species;
      const pType    = placementTypeForCategory(species.category);
      placementMode  = pType === 'circle' ? 'placing_circle' : 'placing_polygon';
      placingCircle  = null;
      placingPoly    = [];
      clearPreview();

      // Switch to 2D canvas of selected surface
      switchMode('2d');

      const hint = pType === 'circle'
        ? 'Click to set centre, drag or click again to set radius'
        : 'Click to add vertices, double-click or Enter to close polygon';
      showFeedback(`Placing ${species.common} — ${hint}`, 0);
      renderer.domElement.style.cursor = 'crosshair';
    }

    function cancelPlacement() {
      placementMode   = 'idle';
      placingSpecies  = null;
      placingCircle   = null;
      placingPoly     = [];
      editingInstance = null;
      clearPreview();
      renderer.domElement.style.cursor = '';
      showFeedback('Ready');
    }

    // ── Preview mesh helpers ────────────────────────────────────
    function clearPreview() {
      if (previewMesh) {
        if (Array.isArray(previewMesh)) {
          previewMesh.forEach(m => { scene.remove(m); m.geometry?.dispose(); });
        } else {
          scene.remove(previewMesh); previewMesh.geometry?.dispose();
        }
        previewMesh = null;
      }
    }

    function showCirclePreview(cx, cz, radius, surface) {
      clearPreview();
      const segs = 48;
      const pts  = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const u = cx + Math.cos(a) * radius;
        const v = cz + Math.sin(a) * radius;
        pts.push(surfaceUVToWorld(u, v, surface));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      previewMesh = new THREE.Line(geom, PROXY_MAT.previewLine);
      previewMesh.renderOrder = 10;
      scene.add(previewMesh);
    }

    function showPolygonPreview(pts, mouseUV, surface) {
      clearPreview();
      const lines = [];
      if (pts.length >= 2) {
        const worldPts = pts.map(p => surfaceUVToWorld(p.u, p.v, surface));
        const geom = new THREE.BufferGeometry().setFromPoints(worldPts);
        lines.push(new THREE.Line(geom, PROXY_MAT.previewLine));
      }
      if (pts.length >= 1 && mouseUV) {
        const lastW = surfaceUVToWorld(pts[pts.length - 1].u, pts[pts.length - 1].v, surface);
        const curW  = surfaceUVToWorld(mouseUV.u, mouseUV.v, surface);
        const g2 = new THREE.BufferGeometry().setFromPoints([lastW, curW]);
        lines.push(new THREE.Line(g2, PROXY_MAT.previewLine));
      }
      lines.forEach(l => { l.renderOrder = 10; scene.add(l); });
      previewMesh = lines;
    }

    // ── 2D canvas mouse handlers for placement ─────────────────
    let circlePhase = 'none'; // 'none' | 'centre_set'
    let circleCentre = null; // { u, v } surface-local

    renderer.domElement.addEventListener('click', e => {
      if (currentMode !== '2d' || !selectedSurface) return;
      if (placementMode === 'idle') return;

      const ndc  = canvasNDC(e);
      const wPt  = raycastSurface(ndc, selectedSurface);
      if (!wPt) return;
      const uv   = worldToSurfaceUV(wPt, selectedSurface);

      if (placementMode === 'placing_circle') {
        if (circlePhase === 'none') {
          // First click: set centre
          circleCentre = { u: uv.u, v: uv.v };
          circlePhase  = 'centre_set';
          showFeedback('Centre set — click again to set canopy radius', 0);
        } else {
          // Second click: set radius and place
          const limits = radiusLimits(placingSpecies, selectedSurface);
          const raw    = Math.hypot(uv.u - circleCentre.u, uv.v - circleCentre.v);
          const radius = Math.min(limits.max, Math.max(limits.min, raw));
          const area   = Math.round(Math.PI * radius * radius * 10) / 10;
          const inst   = commitCirclePlacement(selectedSurface, placingSpecies, circleCentre, radius, area);
          circleCentre = null;
          circlePhase  = 'none';
          placingSpecies = null;
          placementMode  = 'idle';
          clearPreview();
          renderer.domElement.style.cursor = '';
          showFeedback(`${inst.placement ? 'Placed' : 'Added'} plant — canopy ${area} m²`);
        }
        return;
      }

      if (placementMode === 'placing_polygon') {
        placingPoly.push({ u: uv.u, v: uv.v });
        showPolygonPreview(placingPoly, null, selectedSurface);
        showFeedback(`${placingPoly.length} vertices — double-click or Enter to close`, 0);
      }
    });

    renderer.domElement.addEventListener('dblclick', e => {
      if (currentMode !== '2d' || placementMode !== 'placing_polygon') return;
      if (placingPoly.length < 3) {
        showFeedback('Need at least 3 points to close a polygon'); return;
      }
      commitPolygonPlacement(selectedSurface, placingSpecies, [...placingPoly]);
      placingPoly    = [];
      placingSpecies = null;
      placementMode  = 'idle';
      clearPreview();
      renderer.domElement.style.cursor = '';
    });

    renderer.domElement.addEventListener('mousemove', e => {
      if (currentMode !== '2d' || !selectedSurface) return;
      const ndc = canvasNDC(e);
      const wPt = raycastSurface(ndc, selectedSurface);
      if (!wPt) return;
      const uv  = worldToSurfaceUV(wPt, selectedSurface);

      if (placementMode === 'placing_circle' && circlePhase === 'centre_set') {
        const limits = radiusLimits(placingSpecies, selectedSurface);
        const raw    = Math.hypot(uv.u - circleCentre.u, uv.v - circleCentre.v);
        const radius = Math.min(limits.max, Math.max(limits.min, raw || limits.def));
        showCirclePreview(circleCentre.u, circleCentre.v, radius, selectedSurface);
      }

      if (placementMode === 'placing_polygon' && placingPoly.length >= 1) {
        showPolygonPreview(placingPoly, uv, selectedSurface);
      }
    });

    // Enter key to close polygon
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && placementMode === 'placing_polygon') {
        if (placingPoly.length >= 3) {
          commitPolygonPlacement(selectedSurface, placingSpecies, [...placingPoly]);
          placingPoly    = [];
          placingSpecies = null;
          placementMode  = 'idle';
          clearPreview();
          renderer.domElement.style.cursor = '';
        } else {
          showFeedback('Need at least 3 points');
        }
      }
      if (e.key === 'Escape' && placementMode !== 'idle') {
        cancelPlacement();
      }
    });

    // ── Commit placements ───────────────────────────────────────
    function commitCirclePlacement(surface, species, centre, radius, area) {
      if (!surface.plants) surface.plants = [];
      const inst = {
        instanceId:  ++_instanceCounter,
        speciesId:   species.id,
        canopyArea:  area,
        placement: {
          type:    'circle',
          cx:      centre.u,
          cz:      centre.v,
          radius,
          mesh:    null
        }
      };
      surface.plants.push(inst);

      // Build 3D proxy
      inst.placement.mesh = buildCircleProxy(inst, surface, species);

      updateSurfaceListTag(surface);
      renderSurfacePlantSchedule(surface);
      recalcGPR();
      return inst;
    }

    function commitPolygonPlacement(surface, species, polyPts) {
      const area = polygonArea(polyPts);
      if (!surface.plants) surface.plants = [];
      const inst = {
        instanceId: ++_instanceCounter,
        speciesId:  species.id,
        canopyArea: Math.round(area * 10) / 10,
        placement: {
          type:   'polygon',
          points: polyPts,
          mesh:   null
        }
      };
      surface.plants.push(inst);

      // Build 3D proxy
      inst.placement.mesh = buildPolygonProxy(inst, surface, species);

      updateSurfaceListTag(surface);
      renderSurfacePlantSchedule(surface);
      recalcGPR();
      showFeedback(`Placed ${species.common} — canopy ${inst.canopyArea} m²`);
      return inst;
    }

    // ── Polygon area (Shoelace, surface-local coords) ───────────
    function polygonArea(pts) {
      let area = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        area += (pts[j].u + pts[i].u) * (pts[j].v - pts[i].v);
      }
      return Math.abs(area / 2);
    }

    // ── 3D proxy builders ────────────────────────────────────────
    function proxyMatForCategory(cat) {
      if (!cat) return PROXY_MAT.tree;
      const c = cat.toLowerCase();
      if (c.includes('tree'))  return PROXY_MAT.tree;
      if (c.includes('shrub')) return PROXY_MAT.shrub;
      if (c.includes('bamboo') || c.includes('palm')) return PROXY_MAT.bamboo;
      return PROXY_MAT.polygon;
    }

    function buildCircleProxy(inst, surface, species) {
      const { cx, cz, radius } = inst.placement;
      const worldCentre = surfaceUVToWorld(cx, cz, surface);
      const cat  = (species.category || '').toLowerCase();
      const isTree  = cat.includes('tree') || cat.includes('palm');
      const isShrub = cat.includes('shrub');
      const group = new THREE.Group();

      if (isTree) {
        // Canopy sphere
        const cSphere = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 0.8, 10, 8),
          PROXY_MAT.tree.clone()
        );
        cSphere.position.set(0, radius * 0.8 + radius * 0.5, 0);
        group.add(cSphere);
        // Trunk
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(radius * 0.07, radius * 0.1, radius * 1.2, 6),
          PROXY_MAT.trunk.clone()
        );
        trunk.position.set(0, radius * 0.6, 0);
        group.add(trunk);
      } else if (isShrub) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 8, 6),
          PROXY_MAT.shrub.clone()
        );
        sphere.position.set(0, radius * 0.6, 0);
        group.add(sphere);
      } else {
        // Bamboo / palm — cylinder clump
        const cyl = new THREE.Mesh(
          new THREE.CylinderGeometry(radius * 0.5, radius * 0.7, radius * 3, 6),
          PROXY_MAT.bamboo.clone()
        );
        cyl.position.set(0, radius * 1.5, 0);
        group.add(cyl);
      }

      // Also draw a flat circle on the surface to show canopy footprint
      const circlePts = [];
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        circlePts.push(surfaceUVToWorld(cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, surface));
      }
      const lineGeom = new THREE.BufferGeometry().setFromPoints(circlePts);
      const lineLoop  = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x2d7a2d }));
      lineLoop.renderOrder = 3;
      scene.add(lineLoop);
      inst.placement._footprintLine = lineLoop;

      group.position.copy(worldCentre);
      group.renderOrder = 3;
      plantProxyGroup.add(group);
      return group;
    }

    function buildPolygonProxy(inst, surface, species) {
      const { points } = inst.placement;
      if (points.length < 3) return null;

      // Build Three.js ShapeGeometry in surface-local UV space,
      // then transform each vertex to world space
      const worldPts = points.map(p => surfaceUVToWorld(p.u, p.v, surface));
      // Determine a local 2D basis to feed THREE.Shape
      // For simplicity: use XZ world coords (works for horizontal surfaces)
      // For walls: project onto the surface tangent plane
      const n   = surface.worldNormal.clone().normalize();
      const isH = Math.abs(n.y) > 0.7;

      let shapePts;
      if (isH) {
        shapePts = worldPts.map(p => new THREE.Vector2(p.x, p.z));
      } else {
        const up    = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, n).normalize();
        const c     = getSurfaceCentre(surface);
        shapePts = worldPts.map(p => {
          const d = p.clone().sub(c);
          return new THREE.Vector2(d.dot(right), p.y - c.y);
        });
      }

      const shape = new THREE.Shape(shapePts);
      const geom  = new THREE.ShapeGeometry(shape);

      if (isH) {
        geom.rotateX(-Math.PI / 2);
      } else {
        // Orient in wall plane — translate back to world position
        const c     = getSurfaceCentre(surface);
        const up    = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, n).normalize();
        const pos   = geom.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const u2 = pos.getX(i);
          const v2 = pos.getY(i);
          const wp  = c.clone().addScaledVector(right, u2).addScaledVector(up, v2).addScaledVector(n, 0.05);
          pos.setXYZ(i, wp.x, wp.y, wp.z);
        }
        pos.needsUpdate = true;
      }

      const mat  = proxyMatForCategory(species.category);
      const mesh = new THREE.Mesh(geom, mat.clone());

      if (isH) {
        // Translate to world Y
        const c = getSurfaceCentre(surface);
        mesh.position.y = c.y + 0.06;
      }

      mesh.renderOrder = 3;
      plantProxyGroup.add(mesh);

      // Also draw outline
      const outlineGeom = new THREE.BufferGeometry().setFromPoints([...worldPts, worldPts[0]]);
      const outline = new THREE.Line(outlineGeom, new THREE.LineBasicMaterial({ color: 0x2d7a2d }));
      outline.renderOrder = 4;
      scene.add(outline);
      inst.placement._outlineLine = outline;

      return mesh;
    }

    // ── Remove proxy meshes when clearing plants ────────────────
    function removeProxyForInstance(inst) {
      if (!inst.placement) return;
      if (inst.placement.mesh) {
        plantProxyGroup.remove(inst.placement.mesh);
        inst.placement.mesh.traverse(c => c.geometry?.dispose());
      }
      if (inst.placement._footprintLine) {
        scene.remove(inst.placement._footprintLine);
        inst.placement._footprintLine.geometry?.dispose();
      }
      if (inst.placement._outlineLine) {
        scene.remove(inst.placement._outlineLine);
        inst.placement._outlineLine.geometry?.dispose();
      }
    }

    function clearAllProxies() {
      surfaces.forEach(s => {
        (s.plants || []).forEach(inst => removeProxyForInstance(inst));
      });
      while (plantProxyGroup.children.length) {
        const c = plantProxyGroup.children[0];
        c.geometry?.dispose();
        plantProxyGroup.remove(c);
      }
    }

    // ── Patch clearPlantsBtn to also clear proxies ──────────────
    // (re-bind — original bind is above, this overrides it)
    document.getElementById('clearPlantsBtn')?.addEventListener('click', () => {
      const total = surfaces.reduce((acc, s) => acc + (s.plants || []).length, 0);
      if (!total) { showFeedback('No plants assigned'); return; }
      surfaces.forEach(s => {
        (s.plants || []).forEach(inst => removeProxyForInstance(inst));
        s.plants = [];
        updateSurfaceListTag(s);
      });
      if (selectedSurface) renderSurfacePlantSchedule(selectedSurface);
      recalcGPR();
      showFeedback(`Cleared ${total} plant instance${total > 1 ? 's' : ''}`);
    });

    // ── Also clear proxies when site is cleared ─────────────────
    // Hook into clearSiteBtn — proxies must go with the model
    const _origClearSite = document.getElementById('clearSiteBtn');
    if (_origClearSite) {
      _origClearSite.addEventListener('click', () => {
        clearAllProxies();
        cancelPlacement();
      });
    }

    // ── Patch modal to trigger placement instead of direct add ──
    // Override the assign button to start placement flow
    document.getElementById('plant-assign-btn')?.addEventListener('click', () => {
      if (!selectedSurface || !selectedPlant) return;
      const sp = selectedPlant; // capture before modal close
      closePlantModal();
      startPlacement(sp);
    });

    // ── Patch addPlantBtn — also triggers modal (existing) ──────
    // (no change needed — it opens the modal, modal now starts placement)

    // ── Schedule row: show placement status ─────────────────────
    // Patch renderSurfacePlantSchedule to add placement indicator
    const _origRenderSchedule = renderSurfacePlantSchedule;
    renderSurfacePlantSchedule = function(surface) {
      _origRenderSchedule(surface);
      // Add placement badges to each row
      const listEl = document.getElementById('surf-plant-list');
      if (!listEl || !surface) return;
      const plants = surface.plants || [];
      const rows   = listEl.querySelectorAll('div');
      plants.forEach((inst, idx) => {
        const row = rows[idx];
        if (!row) return;
        // Find or create placement badge
        let badge = row.querySelector('.placement-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'placement-badge';
          badge.style.cssText = 'font-size:10px;padding:1px 5px;border-radius:3px;flex-shrink:0;cursor:pointer;';
          // Insert before the × button (last child)
          row.insertBefore(badge, row.lastChild);
        }
        if (inst.placement) {
          const typeLabel = inst.placement.type === 'circle' ? '●' : '■';
          badge.textContent = typeLabel + ' placed';
          badge.style.background = '#1a3d1a';
          badge.style.color      = '#7fc47f';
          badge.style.border     = '1px solid #2e6b2e';
          badge.title = 'Plant is placed on canvas. Click to re-place.';
          badge.onclick = () => {
            // Remove old proxy and start re-placement
            removeProxyForInstance(inst);
            inst.placement = null;
            inst.canopyArea = surface.area;
            renderSurfacePlantSchedule(surface);
            const sp = plantDb.find(p => p.id === inst.speciesId);
            if (sp) startPlacement(sp);
          };
        } else {
          badge.textContent = 'unplaced';
          badge.style.background = '#2a2a1a';
          badge.style.color      = '#c4b47f';
          badge.style.border     = '1px solid #5a5010';
          badge.title = 'Not yet placed on canvas. Click to place.';
          badge.onclick = () => {
            const sp = plantDb.find(p => p.id === inst.speciesId);
            if (sp) startPlacement(sp);
          };
        }
      });
    };

    /* ============================================================
       MENU BAR
    ============================================================ */
    document.querySelectorAll('.dropdown-menu a').forEach(a =>
      a.addEventListener('click', e => {
        e.preventDefault();
        const action = a.dataset.action;
        if      (action === 'fit-site')           document.getElementById('fitSiteBtn')?.click();
        else if (action === 'toggle-grid')         document.getElementById('toggleGridBtn')?.click();
        else if (action === 'toggle-axes')         toggleAxes();
        else if (action === 'north-pointer')       { toggleNorthPoint(); toggleGizmo3D(); }
        else if (action === 'north-reset')         resetNorthPos();
        // Note: toggleNorthPoint / resetNorthPos imported from north-point-2d.js
        else if (action === 'import-model')        document.getElementById('import3DModelBtn')?.click();
        else    showFeedback(`${action} \u2014 coming soon`);
      }));

    /* ============================================================
       TOGGLE AXES
    ============================================================ */
    function toggleAxes() {
      if (!axesHelper) return;
      axesHelper.visible = !axesHelper.visible;
      showFeedback('Axes ' + (axesHelper.visible ? 'on' : 'off'));
    }

    /* ============================================================
       NORTH POINT 2D + 3D — initialise modules
    ============================================================ */
    initNorthPoint2D(() => ({ currentMode, camera2D, camera3D, controls3D, pan2D, rotate2D }));
    initNorthPoint3D(() => ({ renderer, camera3D, container, currentMode, showFeedback }));

    // Site selection + CADMapper import modules
    // showSitePin: hides orange boundary, adds a Google-style DOM teardrop pin
    // lat/lng = Nominatim geocoded point — placed precisely regardless of polygon centroid
    function showSitePin(lat, lng) {
      if (siteBoundaryLine) siteBoundaryLine.visible = false;

      // Clear any previous mesh pin
      if (sitePinGroup) {
        scene.remove(sitePinGroup);
        sitePinGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        sitePinGroup = null;
      }

      // Remove any existing DOM pin
      document.getElementById('site-pin-dom')?.remove();

      // Create DOM teardrop pin
      sitePinDom = document.createElement('div');
      sitePinDom.id = 'site-pin-dom';
      sitePinDom.style.cssText = `
        position:absolute; pointer-events:none; z-index:10;
        transform:translate(-50%, -100%);`;
      sitePinDom.innerHTML = `
        <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="15" cy="41" rx="6" ry="2" fill="rgba(0,0,0,0.20)"/>
          <path d="M15 1 C7.268 1 1 7.268 1 15 C1 24.5 15 41 15 41 C15 41 29 24.5 29 15 C29 7.268 22.732 1 15 1 Z"
                fill="#1e3d1e" stroke="white" stroke-width="1.2"/>
          <circle cx="15" cy="15" r="7" fill="white"/>
          <circle cx="15" cy="15" r="4" fill="#4a7c3f"/>
        </svg>`;
      document.getElementById('viewport').appendChild(sitePinDom);

      // Convert Nominatim lat/lng to world coords using the same bbox centre that
      // drawSiteBoundary used — this places pin at the geocoded address, not polygon centroid
      if (lat != null && lng != null && window._siteBBoxCenter) {
        const bc  = window._siteBBoxCenter;
        const wx  =  (lng - bc.cLon) * Math.cos(bc.cLat * Math.PI / 180) * 111320;
        const wz  = -(lat - bc.cLat) * 111320;
        sitePinWorldPos = new THREE.Vector3(wx, 0, wz);
      } else {
        sitePinWorldPos = new THREE.Vector3(0, 0, 0);
      }

      updateSitePinDOM();
    }

    function updateSitePinDOM() {
      if (!sitePinDom || !sitePinWorldPos) return;
      const vec  = sitePinWorldPos.clone().project(camera);
      const rect = canvas.getBoundingClientRect();
      const x    = (vec.x *  0.5 + 0.5) * rect.width;
      const y    = (vec.y * -0.5 + 0.5) * rect.height;
      sitePinDom.style.left = x + 'px';
      sitePinDom.style.top  = y + 'px';
    }

    // Initialise the Design Grid Manager (see js/design-grid.js for full docs)
    designGridManager = new DesignGridManager(THREE, scene);
    state.designGridManager = designGridManager; // bridge to state for grid.js

    // Helper: enforce the one-grid-visible rule.
    // CAD grid shows when Design North = 0 (no design rotation set).
    // Design Grid shows when Design North ≠ 0 (user has defined a design orientation).
    // Only one is visible at any time; the other is hidden.
    // Pass forceMode = '2d' or '3d' to override the current mode check.
    function updateGridVisibility(forceMode) {
      const mode      = forceMode ?? currentMode;
      const inView    = (mode === '2d') && !mapTileGroup;
      const hasDN     = (getDesignNorthAngle() ?? 0) !== 0;
      const showDG    = inView && hasDN  && !!designGridManager?.grids?.size;
      const showCAD   = inView && !showDG;
      if (gridHelper) gridHelper.visible = showCAD;
      if (designGridManager) designGridManager.setVisible(showDG);
    }
    // Legacy alias — any existing call to setGridVisible(false) now hides both;
    // setGridVisible(true) defers to updateGridVisibility.
    function setGridVisible(v) {
      if (!v) {
        if (gridHelper) gridHelper.visible = false;
        if (designGridManager) designGridManager.setVisible(false);
      } else {
        updateGridVisibility();
      }
    }

    initSiteSelection({ drawSiteBoundary, onSiteSelected: (lat, lng) => showSitePin(lat, lng) });
    initSiteBoundary();
    initProjects();
    initCADMapperImport({
      THREE,
      onLayersLoaded: async (layerGroups, dxfFile) => {
        // Clear existing CADMapper geometry
        if (cadmapperGroup) {
          scene.remove(cadmapperGroup);
          cadmapperGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
          cadmapperGroup = null;
        }

        // Build group, centre it in scene
        cadmapperGroup = new THREE.Group();
        cadmapperGroup.name = 'cadmapper-context';
        Object.values(layerGroups).forEach(g => cadmapperGroup.add(g));

        const box    = new THREE.Box3().setFromObject(cadmapperGroup);
        const centre = new THREE.Vector3();
        box.getCenter(centre);

        // Centre by moving children (not the group) so cadmapperGroup stays at
        // world (0,0,0). Rotation in the animation loop then pivots correctly
        // around the scene centre — the DXF's visual centre.
        cadmapperGroup.children.forEach(child => {
          child.position.x -= centre.x;
          child.position.z -= centre.z;
        });
        const box2 = new THREE.Box3().setFromObject(cadmapperGroup);
        cadmapperGroup.children.forEach(child => { child.position.y -= box2.min.y; });

        // ── REAL WORLD: record scene offset so any scene coord can be
        // converted back to UTM / WGS84 via real-world.js.
        setSceneOffset(centre.x, centre.z);

        // ── REAL WORLD: compute WGS84 bounding box of the DXF for Google Maps picker.
        // finalBox is computed after centering — min/max are scene-space metres.
        const finalBox = new THREE.Box3().setFromObject(cadmapperGroup);
        const wgs84Bounds = hasRealWorldAnchor() ? {
          sw: sceneToWGS84(finalBox.min.x, finalBox.min.z),
          ne: sceneToWGS84(finalBox.max.x, finalBox.max.z),
        } : null;

        scene.add(cadmapperGroup);

        const size = new THREE.Vector3();
        new THREE.Box3().setFromObject(cadmapperGroup).getSize(size);
        const siteSpan = Math.max(size.x, size.z);
        updateSceneHelpers(siteSpan);

        const rawCell  = siteSpan / 10;
        const cellSize = manualGridSpacing
          ? manualGridSpacing
          : (rawCell < 50 ? 50 : rawCell < 100 ? 100 : rawCell < 250 ? 250 : 500);
        if (dgSpacing === null) dgSpacing = cellSize;
        if (dgMinorDivisions === null) dgMinorDivisions = 0;

        designGridManager.initHorizontal(
          dgSpacing, dgMinorDivisions, 5000, new THREE.Vector3(0, 0, 0)
        );

        fit3DCamera(new THREE.Box3().setFromObject(cadmapperGroup));
        switchMode('3d');

        document.getElementById('empty-props').style.display       = 'none';
        document.getElementById('clearSiteBtn').style.display      = 'block';
        document.getElementById('left-panel').classList.add('site-imported');

        buildLayerPanel(layerGroups);

        // ── Create initial .gpr file ───────────────────────────────────────
        if (hasRealWorldAnchor()) {
          const anchor   = getRealWorldAnchor();
          const siteName = dxfFile ? dxfFile.name.replace(/\.dxf$/i, '') : 'Untitled Site';
          try {
            await createInitialGPR({
              siteName,
              reference: {
                utm_zone:       anchor.zone,
                utm_easting:    anchor.easting,
                utm_northing:   anchor.northing,
                utm_hemisphere: anchor.hemisphere,
                wgs84_lat:      anchor.lat,
                wgs84_lng:      anchor.lng,
                scene_offset_x: centre.x,
                scene_offset_z: centre.z,
                site_span_m:    siteSpan,
              },
              design: {
                design_north_angle: 0,
                grid_spacing_m:     cellSize,
                minor_divisions:    0,
              },
              dxfFile,
            });
            // ── Auto-save to Supabase project repository ───────────────
            try {
              const blob = await getActiveGPRBlob();
              if (blob) {
                saveProject(blob, {
                  site_name:      siteName,
                  dxf_filename:   dxfFile?.name ?? null,
                  has_boundary:   false,
                  wgs84_lat:      anchor.lat,
                  wgs84_lng:      anchor.lng,
                }).catch(e => console.warn('[GPR] Supabase save failed:', e));
              }
            } catch (_) { /* non-critical */ }
            buildBoundaryPanel(wgs84Bounds, false);
            showFeedback('Project saved \u2014 draw lot boundary to complete site setup');
          } catch (err) {
            console.warn('[GPR] .gpr creation failed:', err);
            showFeedback(`CADMapper context loaded \u2014 ${Object.keys(layerGroups).length} layers`);
          }
        } else {
          const layerNames = Object.keys(layerGroups).join(', ');
          showFeedback(`CADMapper context loaded \u2014 ${Object.keys(layerGroups).length} layers: ${layerNames}`);
        }
      }
    });

    showFeedback('GPRTool ready', 2000);
  