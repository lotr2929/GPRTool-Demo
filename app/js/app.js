
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
    import { initProjects, showProjectsModal, saveProject, loadProject, showSaveProjectDialog } from './projects.js';
    // ── DESIGN WORLD (grids, north angle) — never mixes with Real World ────────
    import { initSiteSelection }    from './site-selection.js';
    import { initCADMapperImport, buildLayerPanel, parseCadmapperDXF } from './cadmapper-import.js';
    import { initOSMImport } from './osm-import.js';
    import { buildSiteTerrain, clearSiteTerrain, getSiteTerrainElevation, projectGroupOntoTerrain, initTerrainBVH } from './terrain.js';
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
    import { drawSiteBoundary, buildBoundaryPanel, clearLotBoundary, renderLotBoundary, buildLotBoundaryLayerRow, showSitePin, updateSitePinDOM,
         startBoundaryDraw, handleBoundaryClick, handleBoundaryDblClick, confirmBoundaryDraw, cancelBoundaryDraw,
         handleBoundaryMouseMove } from './site.js';
    import { syncViewportBackground, update2DCamera, fit2DCamera, fit3DCamera, drawSurfaceCanvasOutline, clearSurfaceCanvasOutline, fitSurfaceCamera, switchMode, resizeToContainer, toggleAxes, updateGridVisibility, setGridVisible } from './viewport.js';
    import { recalcGPR, updateClearBtn, addPlantInstance, removePlantInstance, updateInstanceCanopyArea, updateSurfaceListTag, renderSurfacePlantSchedule, renderPlantList, refreshModalStatus, openPlantModal, closePlantModal, placementTypeForCategory, substrateCapRadius, substrateCapLabel, radiusLimits, getSurfaceCentre, raycastSurface, worldToSurfaceUV, surfaceUVToWorld, canvasNDC, startPlacement, cancelPlacement, clearPreview, showCirclePreview, showPolygonPreview, commitCirclePlacement, commitPolygonPlacement, polygonArea, proxyMatForCategory, buildCircleProxy, buildPolygonProxy, removeProxyForInstance, clearAllProxies } from './plants.js';
    import { detectSurfaces, populateSurfacePanel, selectSurface, deselectSurface,
             hoverSurface, unhoverSurface, allSurfaceMeshes, getPointerNDC,
             classifyNormal, computeMeshArea, initSurfaces } from './surfaces.js';
    import { loadOBJ, loadGLTF, loadIFC, addEdgeOverlay, detectAndApplyUnitScale } from './model.js';
    import { updateSceneHelpers, showGridSpacingPopup, majorCellSize } from './grid.js';
    import { initGeo, latlonToMetres, extractCoordinates, computeBBox, computePolygonArea, computePolygonPerimeter, loadMapTiles, clearMapTiles } from './geo.js';
    import { initUI, showFeedback, setPipelineStatus, setStage } from './ui.js';
    import { initCesiumViewer, getCesiumViewer, flyToSite, showLotBoundary, clearLotBoundary as cesiumClearLotBoundary, isCesiumReady, showCesiumView, showThreeJSView, startBoundaryPick, stopLocationPick, setCesium2D, setCesium3D, setCesiumViewMode, isCesiumActive, setCesiumStreetLevel, getCameraPosition, resetCesiumView } from './cesium-viewer.js';

    /* ============================================================
       LOAD HEADER + BODY
    ============================================================ */
    const header = await fetch('header.html').then(r => r.text());
    document.getElementById('header-container').innerHTML = header;

    const bodyHTML = await fetch('body.html').then(r => r.text());
    document.getElementById('body-container').innerHTML = bodyHTML;
    initUI();
    initGeo({ onMapCleared: () => setGridVisible(state.currentMode === '2d') });

    // ── Cesium viewer — globe on load, no auto-fly, no permissions ────────
    // User navigates manually or via Locate Site → Set Location modal.
    initCesiumViewer('cesium-container').then(() => {
      showCesiumView();
    }).catch(err => console.warn('[Cesium init]', err));

    // ── Advanced section toggle (footer, expands upward) ──────────────────
    document.getElementById('advanced-toggle')?.addEventListener('click', () => {
      const body  = document.getElementById('advanced-body');
      const arrow = document.getElementById('advanced-arrow');
      const open  = body.style.display === 'none';
      body.style.display    = open ? 'block' : 'none';
      arrow.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
    });
    // Uses the current Cesium camera position as the site anchor.
    // Fetches OSM data for that location, saves .gpr with source:'cesium'.
    document.getElementById('importCesiumBtn')?.addEventListener('click', _importFromCesium);

    // ── Extract Site Segment — Stage 2 ────────────────────────────────────
    document.getElementById('extractSiteBtn')?.addEventListener('click', () => {
      setCesium2D();                        // switch Cesium to top-down view
      showThreeJSView();                    // raise Three.js canvas for rectangle picker
      switchMode('2d');                     // switch Three.js to 2D orthographic
      setStage('extract', 'active', 'Draw a rectangle to extract the site');
      setPipelineStatus('Draw site rectangle\u2026', 'busy');
      showFeedback('Drag to draw site rectangle \u2014 release to confirm', 0);
      // TODO: Rectangle picker implementation — next session
    });

    async function _importFromCesium() {
      const pos = getCameraPosition();
      if (!pos) { showFeedback('Cesium not ready yet', 2000); return; }
      // Use camera lat/lng as the site centre
      const lat = pos.lat, lng = pos.lng;
      showFeedback('Using Cesium view as site — fetching OSM context\u2026', 0);
      // Populate the OSM modal coords and trigger import
      // (reuses the existing Overpass pipeline for OSM data + .gpr creation)
      document.getElementById('osm-overlay').style.display = 'block';
      document.getElementById('osm-lat').value = lat.toFixed(7);
      document.getElementById('osm-lng').value = lng.toFixed(7);
      document.getElementById('osm-address').value = `Cesium view (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      // Auto-trigger import after brief pause so user can see what's happening
      setTimeout(() => document.getElementById('osm-import-btn')?.click(), 600);
    }
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
      if (e.key === 'Escape') {
        if (state.boundaryDrawMode) { cancelBoundaryDraw(); showFeedback('Boundary draw cancelled'); return; }
        if (state.zoomRectMode) { state.zoomRectMode = false; state.canvas.style.cursor = ''; showFeedback('Ready'); return; }
        deselectSurface(); showFeedback('Ready');
      }
      if (e.key === 'Enter' && state.boundaryDrawMode) { e.preventDefault(); confirmBoundaryDraw(); }
      // N = orient view to north (state.rotate2D = 0)
      if ((e.key === 'n' || e.key === 'N') && !ctrl && state.currentMode === '2d') {
        state.rotate2D = 0;
        update2DCamera();
        showFeedback('View oriented to North');
      }
      // Z key = rectangular zoom mode toggle (keyboard shortcut)
      if ((e.key === 'z' || e.key === 'Z') && !ctrl && state.currentMode === '2d') {
        state.zoomRectMode = !state.zoomRectMode;
        state.canvas.style.cursor = state.zoomRectMode ? 'crosshair' : '';
        showFeedback(state.zoomRectMode ? 'Zoom rect active \u2014 drag to zoom, Z or Escape to cancel' : 'Ready');
      }
    });

    /* ============================================================
       SCENE GLOBALS
    ============================================================ */
    const canvas    = document.getElementById('three-canvas');
    const container = canvas.parentElement;

    // ── CAD Universe grid (REAL WORLD — True North fixed, never rotates) ─────
    // CAD Grid spacing — auto-calculated from site span unless overridden
    let manualGridSpacing    = null;
    let manualMinorDivisions = null;
    let _lastSiteSpan        = 1000;
    let designGridManager    = null;
    let feedbackTimer        = null;
    // placementMode declared early to avoid temporal dead zone in event handlers
    let placementMode        = 'idle';
    // ── Lot boundary (REAL WORLD — WGS84 GeoJSON → Three.js line) ────────────

    // Surface registry — populated after model load
    // Each entry: { id, mesh, type, area, elevation, normalAngle, originalMaterial }

    // 2D canvas mode: 'ortho' = top-down/elevation, 'surface' = normal-aligned

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

    // ── Bridge immediately so all subsequent code and modules can use state.* ──
    state.scene     = scene;
    state.renderer  = renderer;
    state.canvas    = canvas;
    state.container = container;

    syncViewportBackground();
    new MutationObserver(syncViewportBackground)
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    /* ============================================================
       CAMERAS
    ============================================================ */
    const camera3D = new THREE.PerspectiveCamera(45, 2, 0.1, 10000);
    camera3D.position.set(100, 100, 100);
    state.camera3D = camera3D;

    const camera2D = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 20000);
    camera2D.position.set(0, 10000, 0);
    camera2D.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    state.camera2D = camera2D;
    state.camera   = camera2D;

    /* ============================================================
       CONTROLS
    ============================================================ */
    const controls3D = new OrbitControls(camera3D, state.renderer.domElement);
    state.controls3D = controls3D; // bridge
    state.controls3D.enableDamping      = true;
    state.controls3D.dampingFactor      = 0.08;
    state.controls3D.rotateSpeed        = 0.6;
    state.controls3D.zoomSpeed          = 0.8;
    state.controls3D.panSpeed           = 1.0;
    state.controls3D.screenSpacePanning = true;
    state.controls3D.minDistance        = 1;
    state.controls3D.maxDistance        = 5000;
    state.controls3D.minPolarAngle      = 0.01;
    state.controls3D.maxPolarAngle      = Math.PI * 0.85;
    state.controls3D.mouseButtons       = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

    state.controls3D.touches            = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    const controls2D = { update: () => {}, saveState: () => {}, target: new THREE.Vector3() };
    state.controls2D = controls2D;
    state.controls   = controls2D; // starts in 2D mode



    state.renderer.domElement.addEventListener('pointerdown', e => {
      if (state.currentMode !== '2d') return;
      if ((e.button === 0 && state.zoomRectMode) || e.button === 2) {
        // Zoom rect: activated by right-click drag OR when Z mode is active with left-click
        state.zoomRectStart = { x: e.clientX, y: e.clientY };
        state.zoomRectEl = document.createElement('div');
        state.zoomRectEl.style.cssText = 'position:absolute;border:2px dashed #4a8a4a;background:rgba(74,138,74,0.08);pointer-events:none;z-index:50;';
        document.getElementById('viewport').appendChild(state.zoomRectEl);
        state.renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 1) {
        // Middle mouse — rotate the 2D view (not in surface canvas mode)
        if (state.selectedSurface) return;
        e.preventDefault();
        state.rotate2DActive = true;
        state.rotate2DLast   = { x: e.clientX, y: e.clientY };
        state.renderer.domElement.setPointerCapture(e.pointerId);
      } else if (e.button === 0) {
        // Left mouse — pan
        state.pan2DActive = true;
        state.pan2DLast   = { x: e.clientX, y: e.clientY };
        state.renderer.domElement.setPointerCapture(e.pointerId);
      }
    });

    state.renderer.domElement.addEventListener('pointermove', e => {
      if (state.currentMode !== '2d') return;
      if (state.boundaryDrawMode) handleBoundaryMouseMove(e.clientX, e.clientY);
      if (state.zoomRectMode && state.zoomRectStart && state.zoomRectEl) {
        const rect  = state.canvas.getBoundingClientRect();
        const x1    = Math.min(state.zoomRectStart.x, e.clientX) - rect.left;
        const y1    = Math.min(state.zoomRectStart.y, e.clientY) - rect.top;
        const w     = Math.abs(e.clientX - state.zoomRectStart.x);
        const h     = Math.abs(e.clientY - state.zoomRectStart.y);
        state.zoomRectEl.style.left   = x1 + 'px';
        state.zoomRectEl.style.top    = y1 + 'px';
        state.zoomRectEl.style.width  = w  + 'px';
        state.zoomRectEl.style.height = h  + 'px';
        return;
      }

      if (state.rotate2DActive) {
        const dx = e.clientX - state.rotate2DLast.x;
        state.rotate2DLast = { x: e.clientX, y: e.clientY };
        // Dragging full viewport width = PI radians of rotation
        state.rotate2D += dx * (Math.PI / container.clientWidth);
        update2DCamera();
        return;
      }

      if (!state.pan2DActive) return;
      const dx = e.clientX - state.pan2DLast.x;
      const dy = e.clientY - state.pan2DLast.y;
      state.pan2DLast = { x: e.clientX, y: e.clientY };

      if (state.selectedSurface && state.camera2D.userData.surfaceCentre) {
        // Surface canvas mode: pan along surface U/V axes (no state.rotate2D here)
        const frustumW = (state.camera2D.right - state.camera2D.left) / state.camera2D.zoom;
        const frustumH = (state.camera2D.top - state.camera2D.bottom) / state.camera2D.zoom;
        const scaleX   = frustumW / container.clientWidth;
        const scaleY   = frustumH / container.clientHeight;

        const n    = state.camera2D.userData.surfaceNormal.clone();
        const up   = state.camera2D.userData.surfaceUp.clone();
        const right = new THREE.Vector3().crossVectors(up, n).normalize();

        state.camera2D.position.addScaledVector(right,  dx * scaleX);
        state.camera2D.position.addScaledVector(up,     -dy * scaleY);
        state.camera2D.lookAt(
          state.camera2D.position.clone().addScaledVector(n, -state.camera2D.far * 0.5)
        );
        state.camera2D.updateProjectionMatrix();
      } else {
        // Top-down plan mode — pan is rotation-aware
        // Screen right in world = (cos(r), 0, sin(r))
        // Screen down in world  = (sin(r), 0, -cos(r)) reversed for pan direction
        const frustumW = (state.camera2D.right - state.camera2D.left) / state.camera2D.zoom;
        const frustumH = (state.camera2D.top - state.camera2D.bottom) / state.camera2D.zoom;
        const r   = state.rotate2D;
        const scX = frustumW / container.clientWidth;
        const scZ = frustumH / container.clientHeight;
        state.pan2D.x -= dx * scX * Math.cos(r) - dy * scZ * Math.sin(r);
        state.pan2D.z -= dx * scX * Math.sin(r) + dy * scZ * Math.cos(r);
        update2DCamera();
      }
    });

    state.renderer.domElement.addEventListener('pointerup', e => {
      if (state.currentMode !== '2d') return;
      // Zoom rect confirm
      if (state.zoomRectMode && state.zoomRectStart && state.zoomRectEl) {
        const rect  = state.canvas.getBoundingClientRect();
        const ndcX1 = ((Math.min(state.zoomRectStart.x, e.clientX) - rect.left) / rect.width)  * 2 - 1;
        const ndcX2 = ((Math.max(state.zoomRectStart.x, e.clientX) - rect.left) / rect.width)  * 2 - 1;
        const ndcY1 = 1 - ((Math.min(state.zoomRectStart.y, e.clientY) - rect.top) / rect.height) * 2;
        const ndcY2 = 1 - ((Math.max(state.zoomRectStart.y, e.clientY) - rect.top) / rect.height) * 2;
        if (Math.abs(ndcX2 - ndcX1) > 0.02 && Math.abs(ndcY1 - ndcY2) > 0.02) {
          // Convert NDC corners to world space and fit camera
          const frustumW = (state.camera2D.right - state.camera2D.left) / state.camera2D.zoom;
          const frustumH = (state.camera2D.top - state.camera2D.bottom) / state.camera2D.zoom;
          const wx1 = state.pan2D.x + (ndcX1 * 0.5) * frustumW;
          const wx2 = state.pan2D.x + (ndcX2 * 0.5) * frustumW;
          const wz1 = state.pan2D.z + (-ndcY1 * 0.5) * frustumH;
          const wz2 = state.pan2D.z + (-ndcY2 * 0.5) * frustumH;
          const spanX = Math.abs(wx2 - wx1), spanZ = Math.abs(wz2 - wz1);
          state.pan2D.x = (wx1 + wx2) / 2;
          state.pan2D.z = (wz1 + wz2) / 2;
          const aspect  = rect.width / rect.height;
          const newHalfH = Math.max(spanX / aspect, spanZ) / 2;
          state.camera2D.left   = -newHalfH * aspect;
          state.camera2D.right  =  newHalfH * aspect;
          state.camera2D.top    =  newHalfH;
          state.camera2D.bottom = -newHalfH;
          state.zoom2D = 1;
          update2DCamera();
        }
        state.zoomRectEl.remove();
        state.zoomRectEl    = null;
        state.zoomRectStart = null;
        state.zoomRectMode  = false;
        state.canvas.style.cursor = '';
        state.renderer.domElement.releasePointerCapture(e.pointerId);
        return;
      }
      state.pan2DActive    = false;
      state.rotate2DActive = false;
      state.renderer.domElement.releasePointerCapture(e.pointerId);
    });

    state.renderer.domElement.addEventListener('dblclick', e => {
      e.preventDefault();
      handleBoundaryDblClick();
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
    state.renderer.domElement.addEventListener('contextmenu', e => {
      e.preventDefault();
      _vpCtxX = e.clientX; _vpCtxY = e.clientY;
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

    state.renderer.domElement.addEventListener('wheel', e => {
      if (state.currentMode !== '2d') return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      if (state.selectedSurface) {
        // Surface canvas zoom: scale the orthographic frustum
        state.camera2D.left   *= factor;
        state.camera2D.right  *= factor;
        state.camera2D.top    *= factor;
        state.camera2D.bottom *= factor;
        state.camera2D.updateProjectionMatrix();
      } else {
        state.zoom2D = Math.max(0.002, Math.min(50, state.zoom2D * factor));
        update2DCamera();
      }
    }, { passive: false });


    // active controls now managed via state.controls (set by switchMode)

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

    state.renderer.domElement.addEventListener('pointermove', e => {
      if (state.currentMode !== '3d' || !state.importedModel || state.pan2DActive) return;
      getPointerNDC(e);
      raycaster.setFromCamera(pointerNDC, camera3D);
      const meshMap = allSurfaceMeshes();
      const hits    = raycaster.intersectObjects([...meshMap.keys()], false);
      if (hits.length) {
        const hit = meshMap.get(hits[0].object);
        if (hit && hit !== state.hoveredSurface && hit !== state.selectedSurface) hoverSurface(hit);
      } else {
        if (state.hoveredSurface && state.hoveredSurface !== state.selectedSurface) unhoverSurface(state.hoveredSurface);
      }
    });

    state.renderer.domElement.addEventListener('click', e => {
      // Boundary drawing mode — intercept before anything else
      if (state.boundaryDrawMode && state.currentMode === '2d') {
        const rect = state.canvas.getBoundingClientRect();
        const ndcX = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
        const ndcY = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), state.camera2D);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const worldPt = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, worldPt);
        handleBoundaryClick(worldPt.x, worldPt.z);
        return;
      }
      if (placementMode && placementMode !== 'idle') return; // placement engine handles this
      if (state.currentMode !== '3d' || !state.importedModel) return;
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
      if (state.importedModel) {
        scene.remove(state.importedModel);
        scene.remove(edgeGroup);
        state.importedModel = null;
        state.surfaces = [];
      }

      state.importedModel = group;

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
      if (unitNote) unitNote.style.display = 'none';

      showFeedback(`${format} model loaded \u2014 ${state.surfaces.length} surfaces detected`);
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
       CAMERA FIT HELPERS
    ============================================================ */


    /* ============================================================
       SURFACE CANVAS OUTLINE
    ============================================================ */
    let surfaceCanvasOutline = null;



    /* ============================================================
       SURFACE CAMERA
    ============================================================ */

    /* ============================================================
       MODE SWITCHING
    ============================================================ */
    // Wire surfaces.js callbacks now that the functions are defined
    initSurfaces({
      fitSurfaceCamera,
      drawSurfaceCanvasOutline,
      clearSurfaceCanvasOutline,
    });


    document.querySelectorAll('.mode-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;

        // ── Cesium dispatch ───────────────────────────────────────────────
        // When Cesium is the active render surface, the same toggle controls
        // Cesium's 2D/3D camera (top-down vs perspective), not Three.js mode.
        // setCesiumViewMode also updates .active on the buttons.
        if (isCesiumActive()) {
          setCesiumViewMode(mode);
          showFeedback(`Cesium ${mode.toUpperCase()} view`);
          return;
        }

        // ── Three.js path (unchanged) ─────────────────────────────────────
        if (mode === state.currentMode) {
          // Reset current view to default
          if (mode === '2d') {
            state.rotate2D = 0;
            state.pan2D.x  = 0;
            state.pan2D.z  = 0;
            state.zoom2D   = 1;
            const target = state.siteBoundaryLine || state.importedModel;
            if (target) {
              fit2DCamera(new THREE.Box3().setFromObject(target));
            } else {
              // No site loaded — reset frustum to default 100-unit view
              const aspect = container.clientWidth / (container.clientHeight || 1);
              const halfH  = 50;
              state.camera2D.left   = -halfH * aspect;
              state.camera2D.right  =  halfH * aspect;
              state.camera2D.top    =  halfH;
              state.camera2D.bottom = -halfH;
              state.base2DhalfH     =  halfH;
              state.camera2D.updateProjectionMatrix();
            }
            update2DCamera();
            showFeedback('2D view reset');
          } else {
            const target = state.importedModel || state.siteBoundaryLine;
            if (target) fit3DCamera(new THREE.Box3().setFromObject(target));
            else { state.camera3D.position.set(100, 100, 100); state.controls3D.target.set(0,0,0); state.controls3D.update(); }
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
        state.canvasMode = item.dataset.canvas;
        document.querySelectorAll('.mode-context-item').forEach(i =>
          i.classList.toggle('active', i.dataset.canvas === state.canvasMode));
        menu2D.style.display = 'none';
        if (state.currentMode === '2d' && state.selectedSurface) switchMode('2d');
        showFeedback(`2D mode: ${state.canvasMode === 'ortho' ? 'Ortho (standard viewpoints)' : 'Surface (normal-aligned)'}`);
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

    new ResizeObserver(resizeToContainer).observe(container);
    requestAnimationFrame(() => requestAnimationFrame(resizeToContainer));

    /* renderCompassGizmo — defined in js/north-point-3d.js, imported above */

    /* ============================================================
       ANIMATION LOOP
    ============================================================ */
    (function animate() {
      state.controls.update();
      updateNorthRotation();

      // ── CAD Universe orientation ──────────────────────────────────────────
      // The CAD grid (state.gridHelper) is FIXED at True North. It never rotates.
      // The axes helper rotates with Design North as a visual orientation aid.
      // The DXF model, site boundary, and all imported geometry never rotate.
      //
      // dnDeg +ve = clockwise from True North (e.g. Design North is East of True North)
      // Three.js rotation.y +ve = CCW, so we negate.
      const _dn    = getDesignNorthAngle();
      const _dnRad = (_dn ?? 0) * Math.PI / 180;

      // Axes: rotate with Design North (shows the design coordinate system)
      if (state.axesHelper) state.axesHelper.rotation.y = -_dnRad;

      // Design Grid: rotate group to match Design North (cheap matrix op, no geometry rebuild)
      if (designGridManager) state.designGridManager.setHorizontalRotation(-_dnRad);

      // Switch between CAD grid and Design Grid based on whether Design North is set
      updateGridVisibility();

      state.renderer.render(scene, state.camera);
      updateSitePinDOM();
      if (state.currentMode === '3d' && isGizmo3DVisible()) {
        state.renderer._compassMainScene = scene; // expose for renderCompassGizmo
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



    /* ============================================================
       CLEAR SITE
    ============================================================ */
    document.getElementById('clearSiteBtn').addEventListener('click', () => {
      if (state.siteBoundaryLine) {
        scene.remove(state.siteBoundaryLine);
        state.siteBoundaryLine.geometry.dispose();
        state.siteBoundaryLine = null;
      }
      if (state.siteSurface) {
        scene.remove(state.siteSurface);
        state.siteSurface.geometry.dispose();
        state.siteSurface = null;
      }
      if (state.sitePinGroup) {
        scene.remove(state.sitePinGroup);
        state.sitePinGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        state.sitePinGroup = null;
      }
      document.getElementById('site-pin-dom')?.remove();
      state.sitePinDom = null;
      state.sitePinWorldPos = null;
      if (state.importedModel) {
        scene.remove(state.importedModel);
        scene.remove(edgeGroup);
        while (edgeGroup.children.length) {
          const c = edgeGroup.children[0];
          c.geometry.dispose();
          edgeGroup.remove(c);
        }
        state.importedModel = null;
      }
      if (state.terrainMesh) {
        scene.remove(state.terrainMesh);
        state.terrainMesh.geometry.dispose();
        state.terrainMesh = null;
      }
      if (state.cadmapperGroup) {
        scene.remove(state.cadmapperGroup);
        state.cadmapperGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        state.cadmapperGroup = null;
        document.getElementById('cadmapper-layer-section')?.remove();
      }
      clearMapTiles();
      clearSiteTerrain();
      cancelBoundaryDraw();
      state.surfaces        = [];
      state.hoveredSurface  = null;
      state.selectedSurface = null;
      state.siteAreaM2      = 0;
      siteAreaM2            = 0;
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
      resetCesiumView();
      showCesiumView();        // return to globe after clearing
      setPipelineStatus('', 'idle');
      setStage('locate',  'pending', 'Set a location to begin');
      setStage('extract', 'locked',  'Complete stage 1 first');
      showFeedback('Site cleared');
    });

    /* ============================================================
       LOT BOUNDARY — REAL WORLD scene rendering
       Converts WGS84 GeoJSON polygon → Three.js line in scene space
    ============================================================ */



    /* ============================================================
       OPEN PROJECT — File menu → Open Project…
    ============================================================ */
    // openGPRBtn removed from left panel — access via File menu only
    // openGPRFile() is a named function used by the modal callback below

    // ── Named function so both the modal callback and any future callers can use it ──
    async function openGPRFile(file) {
      const { manifest, reference, design, boundary, terrain, hasDXF, zip } = await openGPR(file);

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
          if (state.cadmapperGroup) {
            scene.remove(state.cadmapperGroup);
            state.cadmapperGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
            state.cadmapperGroup = null;
          }
          state.cadmapperGroup = new THREE.Group();
          state.cadmapperGroup.name = 'cadmapper-context';
          Object.values(layerGroups).forEach(g => state.cadmapperGroup.add(g));
          const offX = reference.scene_offset_x ?? 0;
          const offZ = reference.scene_offset_z ?? 0;
          state.cadmapperGroup.children.forEach(child => {
            child.position.x -= offX;
            child.position.z -= offZ;
          });
          const floorBox = new THREE.Box3().setFromObject(state.cadmapperGroup);
          state.cadmapperGroup.children.forEach(child => { child.position.y -= floorBox.min.y; });
          scene.add(state.cadmapperGroup);
          const size = new THREE.Vector3();
          new THREE.Box3().setFromObject(state.cadmapperGroup).getSize(size);
          updateSceneHelpers(Math.max(size.x, size.z));
          state.designGridManager.initHorizontal(
            design?.grid_spacing_m ?? 100, design?.minor_divisions ?? 0,
            5000, new THREE.Vector3(0, 0, 0)
          );
          fit3DCamera(new THREE.Box3().setFromObject(state.cadmapperGroup));
          switchMode('3d');
          document.getElementById('empty-props').style.display  = 'none';
          document.getElementById('clearSiteBtn').style.display = 'block';
          document.getElementById('left-panel').classList.add('site-imported');
          buildLayerPanel(layerGroups);
        }
      }
      if (boundary) renderLotBoundary(boundary);

      // ── Restore terrain from saved payload (if present) ─────────────
      if (terrain && state.cadmapperGroup) {
        const { rebuildTerrainFromPayload } = await import('./osm-import.js');
        rebuildTerrainFromPayload(terrain);
      }

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
      // For OSM imports: prefer the buildings layer (clipped to radius)
      // over the full cadmapperGroup (which can include km-long highways/railways).
      const buildings = state.cadmapperGroup?.children.find(c => c.name === 'buildings');
      const target = state.importedModel || state.siteBoundaryLine || buildings || state.cadmapperGroup;
      if (!target) { showFeedback('No model or site loaded'); return; }
      const box = new THREE.Box3().setFromObject(target);
      if (state.currentMode === '2d') fit2DCamera(box); else fit3DCamera(box);
      showFeedback('Fitted to model');
    });

    document.getElementById('resetCameraBtn').addEventListener('click', () => {
      if (state.currentMode === '2d') {
        state.pan2D.x = 0; state.pan2D.z = 0; state.zoom2D = 1;
        update2DCamera();
      } else {
        state.camera3D.position.set(100, 100, 100);
        state.camera3D.lookAt(0, 0, 0);
        state.controls3D.target.set(0, 0, 0);
        state.controls3D.update();
      }
      showFeedback('Camera reset');
    });

    document.getElementById('toggleGridBtn').addEventListener('click', () => {
      if (state.gridHelper) {
        const next = !state.gridHelper.visible;
        setGridVisible(next);
        showFeedback('Grid ' + (next ? 'on' : 'off'));
      }
    });

    /* ============================================================
       PLACEHOLDER BUTTONS
    ============================================================ */
    document.getElementById('mapOverlayToggle')?.addEventListener('change', e => {
      if (state.mapTileGroup) state.mapTileGroup.visible = e.target.checked;
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


    // ── Add / remove plant instances ───────────────────────────



    // ── Surface list badge: shows plant count ────────────────────

    // ── Plant schedule table in right panel ────────────────────

    // ── Build plant list in modal ──────────────────────────────


    // ── Open / close modal ─────────────────────────────────────


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
      if (!state.selectedSurface) return;
      const v = parseInt(e.target.value);
      state.selectedSurface.substrate_mm = (!v || isNaN(v)) ? null : v;

      // Show cap label
      const capEl = document.getElementById('surf-substrate-cap');
      if (capEl) {
        const label = substrateCapLabel(state.selectedSurface.substrate_mm);
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

    // ── Substrate cap lookup ───────────────────────────────────
    // Returns max canopy radius allowed for a given substrate depth (mm)
    // Uses the substrate_caps table from plants_free.json
    let _substrateCapTable = null;

    // ── Radius limits: species data + substrate cap ────────────
    // Returns { min, max, def } in metres

    // ── State ──────────────────────────────────────────────────
    //  mode: 'idle' | 'placing_circle' | 'placing_polygon' | 'editing'
    // placementMode declared near top of module to avoid TDZ
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

    // Raycast screen NDC onto surface mesh → world point

    // World point → surface-local UV (metres from centre)

    // Surface UV → world point (on surface plane)

    // ── NDC from mouse event ────────────────────────────────────

    // ── Start placement after modal ─────────────────────────────


    // ── Preview mesh helpers ────────────────────────────────────



    // ── 2D canvas mouse handlers for placement ─────────────────
    let circlePhase = 'none'; // 'none' | 'centre_set'
    let circleCentre = null; // { u, v } surface-local

    state.renderer.domElement.addEventListener('click', e => {
      if (state.currentMode !== '2d' || !state.selectedSurface) return;
      if (placementMode === 'idle') return;

      const ndc  = canvasNDC(e);
      const wPt  = raycastSurface(ndc, state.selectedSurface);
      if (!wPt) return;
      const uv   = worldToSurfaceUV(wPt, state.selectedSurface);

      if (placementMode === 'placing_circle') {
        if (circlePhase === 'none') {
          // First click: set centre
          circleCentre = { u: uv.u, v: uv.v };
          circlePhase  = 'centre_set';
          showFeedback('Centre set — click again to set canopy radius', 0);
        } else {
          // Second click: set radius and place
          const limits = radiusLimits(placingSpecies, state.selectedSurface);
          const raw    = Math.hypot(uv.u - circleCentre.u, uv.v - circleCentre.v);
          const radius = Math.min(limits.max, Math.max(limits.min, raw));
          const area   = Math.round(Math.PI * radius * radius * 10) / 10;
          const inst   = commitCirclePlacement(state.selectedSurface, placingSpecies, circleCentre, radius, area);
          circleCentre = null;
          circlePhase  = 'none';
          placingSpecies = null;
          placementMode  = 'idle';
          clearPreview();
          state.renderer.domElement.style.cursor = '';
          showFeedback(`${inst.placement ? 'Placed' : 'Added'} plant — canopy ${area} m²`);
        }
        return;
      }

      if (placementMode === 'placing_polygon') {
        placingPoly.push({ u: uv.u, v: uv.v });
        showPolygonPreview(placingPoly, null, state.selectedSurface);
        showFeedback(`${placingPoly.length} vertices — double-click or Enter to close`, 0);
      }
    });

    state.renderer.domElement.addEventListener('dblclick', e => {
      if (state.currentMode !== '2d' || placementMode !== 'placing_polygon') return;
      if (placingPoly.length < 3) {
        showFeedback('Need at least 3 points to close a polygon'); return;
      }
      commitPolygonPlacement(state.selectedSurface, placingSpecies, [...placingPoly]);
      placingPoly    = [];
      placingSpecies = null;
      placementMode  = 'idle';
      clearPreview();
      state.renderer.domElement.style.cursor = '';
    });

    state.renderer.domElement.addEventListener('mousemove', e => {
      if (state.currentMode !== '2d' || !state.selectedSurface) return;
      const ndc = canvasNDC(e);
      const wPt = raycastSurface(ndc, state.selectedSurface);
      if (!wPt) return;
      const uv  = worldToSurfaceUV(wPt, state.selectedSurface);

      if (placementMode === 'placing_circle' && circlePhase === 'centre_set') {
        const limits = radiusLimits(placingSpecies, state.selectedSurface);
        const raw    = Math.hypot(uv.u - circleCentre.u, uv.v - circleCentre.v);
        const radius = Math.min(limits.max, Math.max(limits.min, raw || limits.def));
        showCirclePreview(circleCentre.u, circleCentre.v, radius, state.selectedSurface);
      }

      if (placementMode === 'placing_polygon' && placingPoly.length >= 1) {
        showPolygonPreview(placingPoly, uv, state.selectedSurface);
      }
    });

    // Enter key to close polygon
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && placementMode === 'placing_polygon') {
        if (placingPoly.length >= 3) {
          commitPolygonPlacement(state.selectedSurface, placingSpecies, [...placingPoly]);
          placingPoly    = [];
          placingSpecies = null;
          placementMode  = 'idle';
          clearPreview();
          state.renderer.domElement.style.cursor = '';
        } else {
          showFeedback('Need at least 3 points');
        }
      }
      if (e.key === 'Escape' && placementMode !== 'idle') {
        cancelPlacement();
      }
    });

    // ── Commit placements ───────────────────────────────────────


    // ── Polygon area (Shoelace, surface-local coords) ───────────

    // ── 3D proxy builders ────────────────────────────────────────



    // ── Remove proxy meshes when clearing plants ────────────────


    // ── Patch clearPlantsBtn to also clear proxies ──────────────
    // (re-bind — original bind is above, this overrides it)
    document.getElementById('clearPlantsBtn')?.addEventListener('click', () => {
      const total = state.surfaces.reduce((acc, s) => acc + (s.plants || []).length, 0);
      if (!total) { showFeedback('No plants assigned'); return; }
      state.surfaces.forEach(s => {
        (s.plants || []).forEach(inst => removeProxyForInstance(inst));
        s.plants = [];
        updateSurfaceListTag(s);
      });
      if (state.selectedSurface) renderSurfacePlantSchedule(state.selectedSurface);
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
      if (!state.selectedSurface || !selectedPlant) return;
      const sp = selectedPlant; // capture before modal close
      closePlantModal();
      startPlacement(sp);
    });

    // ── Patch addPlantBtn — also triggers modal (existing) ──────
    // (no change needed — it opens the modal, modal now starts placement)

    // ── Schedule row placement patch ─────────────────────────
    // (placeholder — plants.js will handle this properly in a later sprint)

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
        else if (action === 'open-project')        showProjectsModal(async (file) => { try { await openGPRFile(file); } catch(e) { showFeedback('Failed to open: ' + e.message); } });
        else if (action === 'new-project')         _newProject();
        else if (action === 'save')                _saveCurrentProject();
        else if (action === 'save-as')             _saveAsProject();
        else if (action === 'import-osm')          document.getElementById('importOSMBtn')?.click();
        else if (action === 'import-cesium')       document.getElementById('importCesiumBtn')?.click();
        else if (action === 'import-cadmapper')    document.getElementById('importCADMapperBtn')?.click();
        else if (action === 'import-model')        document.getElementById('import3DModelBtn')?.click();
        else if (action === 'download-report')     showFeedback('Download GPR Report \u2014 coming soon');
        else    showFeedback(`${action} \u2014 coming soon`);
      }));

    /* ============================================================
       TOGGLE AXES
    ============================================================ */

    /* ============================================================
       NORTH POINT 2D + 3D — initialise modules
    ============================================================ */
    initNorthPoint2D(() => ({ currentMode: state.currentMode, camera2D: state.camera2D, camera3D: state.camera3D, controls3D: state.controls3D, pan2D: state.pan2D, rotate2D: state.rotate2D }));
    initNorthPoint3D(() => ({ renderer: state.renderer, camera3D: state.camera3D, container: state.container, currentMode: state.currentMode, showFeedback }));

    // Site selection + CADMapper import modules
    // showSitePin: hides orange boundary, adds a Google-style DOM teardrop pin
    // lat/lng = Nominatim geocoded point — placed precisely regardless of polygon centroid


    // Initialise the Design Grid Manager (see js/design-grid.js for full docs)
    designGridManager = new DesignGridManager(THREE, scene);
    state.designGridManager = designGridManager; // bridge to state for grid.js

    // Helper: enforce the one-grid-visible rule.
    // CAD grid shows when Design North = 0 (no design rotation set).
    // Design Grid shows when Design North ≠ 0 (user has defined a design orientation).
    // Only one is visible at any time; the other is hidden.
    // Pass forceMode = '2d' or '3d' to override the current mode check.
    // Legacy alias — any existing call to setGridVisible(false) now hides both;
    // setGridVisible(true) defers to updateGridVisibility.

    initSiteSelection({ drawSiteBoundary, onSiteSelected: (lat, lng) => showSitePin(lat, lng) });
    initProjects();

    // ── Cesium boundary draw ───────────────────────────────────────────────
    // Called when "Draw Lot Boundary" is clicked in Cesium (OSM) mode.
    // Uses cesium-viewer.js startBoundaryPick() — user clicks on 3D tile surface.
    async function _startCesiumBoundaryDraw() {
      showFeedback('Click the 3D scene to place boundary vertices \u2014 double-click to finish', 0);
      startBoundaryPick(
        pt => showFeedback(
          `Point placed (${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}) \u2014 continue or double-click to finish`, 0
        ),
        async pts => {
          if (pts.length < 3) { showFeedback('Need at least 3 points to close boundary'); return; }
          const coords = pts.map(p => [p.lng, p.lat]);
          coords.push(coords[0]); // close GeoJSON ring
          const geojson = {
            type: 'Feature',
            properties: { source: 'gprtool_cesium', drawn_at: new Date().toISOString() },
            geometry: { type: 'Polygon', coordinates: [coords] },
          };
          showLotBoundary(geojson); // orange polyline on 3D tiles
          showFeedback('Lot boundary drawn \u2014 saving\u2026', 0);
          try {
            await addBoundaryToGPR(geojson);
            const anchor = getRealWorldAnchor();
            const blob   = await getActiveGPRBlob();
            if (blob && anchor) {
              saveProject(blob, {
                site_name: state._activeProjectName ?? 'GPR Project',
                has_boundary: true,
                wgs84_lat: anchor.lat,
                wgs84_lng: anchor.lng,
              }).catch(e => console.warn('[GPR] boundary save:', e));
            }
            const btn = document.getElementById('draw-boundary-btn');
            if (btn) {
              btn.textContent = '\u2713 Lot Boundary \u2014 Re-draw\u2026';
              btn.style.background = 'var(--accent-dark,#2d6b2d)';
            }
            showFeedback('Lot boundary saved');
          } catch (err) {
            showFeedback('Boundary drawn but save failed: ' + err.message);
          }
        }
      );
    }

    // Shared onLayersLoaded callback — used by both OSM and CADMapper importers
    const onLayersLoaded = async (layerGroups, dxfFile, osmAddress = null, osmGeoJSON = null) => {
        // Clear existing context geometry and reset .gpr state
        if (state.cadmapperGroup) {
          scene.remove(state.cadmapperGroup);
          state.cadmapperGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
          state.cadmapperGroup = null;
        }
        clearLotBoundary();
        clearSiteTerrain();
        cancelBoundaryDraw();

        // Build group, centre it in scene
        state.cadmapperGroup = new THREE.Group();
        state.cadmapperGroup.name = 'cadmapper-context';
        Object.values(layerGroups).forEach(g => state.cadmapperGroup.add(g));

        const box    = new THREE.Box3().setFromObject(state.cadmapperGroup);
        const centre = new THREE.Vector3();
        box.getCenter(centre);

        // CADMapper DXF: geometry is in DXF-local space — must centre.
        // OSM import: geometry already in scene space via wgs84ToScene — skip shift.
        if (dxfFile) {
          state.cadmapperGroup.children.forEach(child => {
            child.position.x -= centre.x;
            child.position.z -= centre.z;
          });
          const box2 = new THREE.Box3().setFromObject(state.cadmapperGroup);
          state.cadmapperGroup.children.forEach(child => { child.position.y -= box2.min.y; });
          setSceneOffset(centre.x, centre.z);
        } else {
          // OSM: geometry already in scene space, centre is effectively zero
          centre.set(0, 0, 0);
          setSceneOffset(0, 0);
        }

        scene.add(state.cadmapperGroup);

        // ── REAL WORLD: compute WGS84 bounding box after group is in scene
        const finalBox = new THREE.Box3().setFromObject(state.cadmapperGroup);
        const wgs84Bounds = hasRealWorldAnchor() ? {
          sw: sceneToWGS84(finalBox.min.x, finalBox.min.z),
          ne: sceneToWGS84(finalBox.max.x, finalBox.max.z),
        } : null;

        const size = new THREE.Vector3();
        new THREE.Box3().setFromObject(state.cadmapperGroup).getSize(size);
        const siteSpan = Math.max(size.x, size.z);
        updateSceneHelpers(siteSpan);

        const rawCell  = siteSpan / 10;
        const cellSize = manualGridSpacing
          ? manualGridSpacing
          : (rawCell < 50 ? 50 : rawCell < 100 ? 100 : rawCell < 250 ? 250 : 500);
        if (state.dgSpacing === null) state.dgSpacing = cellSize;
        if (state.dgMinorDivisions === null) state.dgMinorDivisions = 10; // 10 subdivisions

        state.designGridManager.initHorizontal(
          state.dgSpacing, state.dgMinorDivisions, 5000, new THREE.Vector3(0, 0, 0)
        );

        fit3DCamera(new THREE.Box3().setFromObject(state.cadmapperGroup));

        // ── Switch viewport FIRST — canvas must be visible before switchMode ─
        showThreeJSView();
        switchMode('3d');

        document.getElementById('empty-props').style.display       = 'none';
        document.getElementById('clearSiteBtn').style.display      = 'block';
        document.getElementById('left-panel').classList.add('site-imported');

        buildLayerPanel(layerGroups);

        // ── Terrain conforming: roads + buildings ─────────────────────────
        if (dxfFile) {
          setTimeout(() => {
            const topoGroup = state.cadmapperGroup?.children.find(c => c.name === 'topography');
            if (topoGroup) {
              let topoMesh = null;
              topoGroup.traverse(c => { if (c.isMesh && !topoMesh) topoMesh = c; });
              if (topoMesh) {
                // Build BVH for fast raycasting — critical for performance with 500+ buildings
                initTerrainBVH(topoMesh);
                showFeedback('Conforming layers to terrain\u2026', 0);
                const layers = ['buildings','highways','major_roads','minor_roads',
                                'paths','railways','parks','water'];
                // Note: contours excluded — already carry correct elevation from DXF
                state.cadmapperGroup.children.forEach(child => {
                  if (layers.includes(child.name)) projectGroupOntoTerrain(child);
                });
                showFeedback('Ready');
              }
            }
          }, 500);
        }

        // ── Create .gpr eagerly in background (non-blocking) ─────────────
        if (hasRealWorldAnchor()) {
          const anchor   = getRealWorldAnchor();
          const siteName = dxfFile
            ? dxfFile.name.replace(/\.dxf$/i, '')
            : osmAddress
              ? `OSM — ${osmAddress}`
              : 'Untitled Site';
          state._activeProjectName = siteName;
          setPipelineStatus('Ready to save', 'idle');

          // ── Show save dialog immediately — ZIP is created lazily on Save ──────
          // blobGetter is called ONLY when the user clicks Save, not before.
          // This means the dialog appears instantly after import with no waiting.
          showSaveProjectDialog({
            blobGetter: async () => {
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
                  minor_divisions:    10,
                },
                dxfFile,
                osmGeoJSON,
              });
              return getActiveGPRBlob();
            },
            defaultName: siteName,
            lat: anchor.lat,
            lng: anchor.lng,
            dxfFilename: dxfFile?.name ?? null,
          }).then(saved => {
            // Dialog now manages its own pipeline-status during background save.
            // Only handle the "skipped/cancelled" case here.
            if (!saved) setPipelineStatus('Ready', 'idle');
          }).catch(() => {});

          buildBoundaryPanel(wgs84Bounds, false, !dxfFile ? _startCesiumBoundaryDraw : null);

          // ── Stage indicators ──────────────────────────────────────────
          setStage('locate', 'done', `\u2713 ${siteName}`);
          setStage('extract', 'pending', 'Switch to 2D and extract site');
          showFeedback('Site loaded \u2014 Extract Segment when ready');
        } else {
          showFeedback(`Context loaded \u2014 ${Object.keys(layerGroups ?? {}).length} layers`);
        }
    };  // end onLayersLoaded

    // ── Project actions wired from File menu ──────────────────────────────
    async function _newProject() {
      if (state.cadmapperGroup || state.importedModel) {
        if (!confirm('Save current project before starting a new one?')) {
          document.getElementById('clearSiteBtn')?.click();
          return;
        }
        await _saveCurrentProject();
      }
      document.getElementById('clearSiteBtn')?.click();
    }

    async function _saveCurrentProject() {
      const blob = await getActiveGPRBlob().catch(() => null);
      if (!blob) { showFeedback('Nothing to save — import a site first.'); return; }
      const anchor = getRealWorldAnchor();
      try {
        await saveProject(blob, {
          id:           state._activeProjectId ?? undefined,
          site_name:    state._activeProjectName ?? 'Untitled Site',
          has_boundary: !!state.siteBoundaryLine,
          wgs84_lat:    anchor?.lat,
          wgs84_lng:    anchor?.lng,
        });
        showFeedback('Project saved.');
      } catch (e) { showFeedback('Save failed: ' + e.message); }
    }

    async function _saveAsProject() {
      const blob = await getActiveGPRBlob().catch(() => null);
      if (!blob) { showFeedback('Nothing to save — import a site first.'); return; }
      const anchor = getRealWorldAnchor();
      await showSaveProjectDialog({
        blob,
        defaultName: state._activeProjectName ?? 'Untitled Site',
        lat: anchor?.lat,
        lng: anchor?.lng,
        dxfFilename: null,
      });
    }

    initCADMapperImport({ THREE, onLayersLoaded });
    initOSMImport({ THREE, onLayersLoaded, getRealWorldAnchor });

    showFeedback('GPRTool ready', 2000);
  