/*
 * viewport.js — Camera, mode switching, grid visibility, panel resize
 */
import * as THREE from 'three';
import { state } from './state.js';
import { showFeedback } from './ui.js';
import { updateSceneHelpers } from './grid.js';
import { getDesignNorthAngle, updateNorthRotation } from './north-point-2d.js';
import { renderCompassGizmo, updateGizmoOverlay } from './north-point-3d.js';

export function syncViewportBackground() {
  const css = getComputedStyle(document.documentElement)
    .getPropertyValue('--vp-bgcolor').trim() || '#ffffff';
  state.renderer.setClearColor(new THREE.Color(css), 1.0);
}

export function update2DCamera() {
  // If in surface canvas mode, the state.camera is managed by fitSurfaceCamera -- don't override it
  if (state.currentMode === '2d' && state.selectedSurface) return;
  state.camera2D.zoom = state.zoom2D;
  state.camera2D.position.set(state.pan2D.x, 10000, state.pan2D.z);
  // up vector encodes the view rotation: state.rotate2D=0 → north (-Z) points up on screen
  state.camera2D.up.set(Math.sin(state.rotate2D), 0, -Math.cos(state.rotate2D));
  state.camera2D.lookAt(state.pan2D.x, 0, state.pan2D.z);
  state.camera2D.updateProjectionMatrix();
}

export function fit2DCamera(box) {
  const size   = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const aspect = state.container.clientWidth / (state.container.clientHeight || 1);
  const siteW  = size.x * 1.3;
  const siteH  = size.z * 1.3;
  const halfH  = Math.max(siteW / (2 * aspect), siteH / 2, 100); // min 200m view

  state.base2DhalfH     = halfH;
  state.camera2D.left   = -halfH * aspect;
  state.camera2D.right  =  halfH * aspect;
  state.camera2D.top    =  halfH;
  state.camera2D.bottom = -halfH;

  state.pan2D.x = center.x;
  state.pan2D.z = center.z;
  state.zoom2D  = 1;

  update2DCamera();
}

export function fit3DCamera(box) {
  const size   = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const dist = Math.max(size.x, size.y, size.z) * 1.5;
  state.camera3D.position.set(center.x + dist * 0.7, dist, center.z + dist * 0.7);
  state.camera3D.near = Math.max(0.1, dist * 0.01);
  state.camera3D.far  = dist * 20;
  state.camera3D.updateProjectionMatrix();
  state.controls3D.target.copy(center);
  state.controls3D.update();
}

export function drawSurfaceCanvasOutline(surface) {
  if (surfaceCanvasOutline) {
    state.scene.remove(surfaceCanvasOutline);
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
  state.scene.add(surfaceCanvasOutline);
}

export function clearSurfaceCanvasOutline() {
  if (surfaceCanvasOutline) {
    state.scene.remove(surfaceCanvasOutline);
    surfaceCanvasOutline.geometry.dispose();
    surfaceCanvasOutline = null;
  }
}

export function fitSurfaceCamera(surface) {
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

  const aspect = state.container.clientWidth / (state.container.clientHeight || 1);
  let halfW, halfH, camPos, up, camNormal;

  if (state.canvasMode === 'surface') {
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

  state.camera2D.left   = -halfW;
  state.camera2D.right  =  halfW;
  state.camera2D.top    =  halfH;
  state.camera2D.bottom = -halfH;
  state.camera2D.near   = 0.1;
  state.camera2D.far    = Math.max(size.x, size.y, size.z) * 12;
  state.camera2D.zoom   = 1;

  state.camera2D.position.copy(camPos);
  state.camera2D.up.copy(up);
  state.camera2D.lookAt(centre);
  state.camera2D.updateProjectionMatrix();

  state.pan2D.x = 0; state.pan2D.z = 0; state.zoom2D = 1;
  state.base2DhalfH = halfH;

  state.camera2D.userData.surfaceCentre = centre.clone();
  state.camera2D.userData.surfaceNormal = camNormal.clone();
  state.camera2D.userData.surfaceUp     = up.clone();
}

export function switchMode(mode) {
  state.currentMode = mode;
  setNorthPointMode(mode);

  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode));

  if (mode === '2d') {
    state.camera = state.camera2D;
    controls = controls2D;

    if (state.selectedSurface) {
      fitSurfaceCamera(state.selectedSurface);
      drawSurfaceCanvasOutline(state.selectedSurface);
      setGridVisible(false);
      if (state.axesHelper)  state.axesHelper.visible = false;          const typeLabels = { ground: 'Ground plane', roof: 'Roof plane', wall: 'Wall plane', sloped: 'Sloped surface' };
      document.getElementById('status-mode').textContent = '2D';
      const modeLabel = state.canvasMode === 'ortho' ? 'Ortho' : 'Surface';
      showFeedback(`2D canvas [${modeLabel}] \u2014 ${typeLabels[state.selectedSurface.type] || state.selectedSurface.type} \u2014 ${state.selectedSurface.area} m\u00b2`, 0);
    } else {
      clearSurfaceCanvasOutline();
      // Only show grid if no map tiles are active
      setGridVisible(!state.mapTileGroup);
      if (state.axesHelper) state.axesHelper.visible = true;
      if (state.axesYLine)  state.axesYLine.visible  = false;
      if (state.siteBoundaryLine) fit2DCamera(new THREE.Box3().setFromObject(state.siteBoundaryLine));
      else if (state.importedModel) fit2DCamera(new THREE.Box3().setFromObject(state.importedModel));
      document.getElementById('status-mode').textContent = '2D';
      showFeedback('2D Plan View');
    }
  } else {
    state.camera = state.camera3D;
    controls = state.controls3D;
    clearSurfaceCanvasOutline();
    setGridVisible(false);  // grid hidden in 3D (Design Grid also hidden)
    if (state.axesHelper) state.axesHelper.visible = true;
    if (state.axesYLine)  state.axesYLine.visible  = true;
    const target = state.importedModel
      ? new THREE.Box3().setFromObject(state.importedModel)
      : (state.siteBoundaryLine ? new THREE.Box3().setFromObject(state.siteBoundaryLine) : null);
    if (target) fit3DCamera(target);
    document.getElementById('status-mode').textContent = '3D';
    showFeedback('3D View \u2014 click a surface to select it');
  }
  updateGizmoOverlay();
}

export function resizeToContainer() {
  if (suppressResize) return;
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => {
    resizeRAF = null;
    const w = state.container.clientWidth  || 1;
    const h = state.container.clientHeight || 1;
    state.renderer.setSize(w, h, false);
    state.camera3D.aspect = w / h;
    state.camera3D.updateProjectionMatrix();
    if (state.siteBoundaryLine) {
      fit2DCamera(new THREE.Box3().setFromObject(state.siteBoundaryLine));
    } else {
      const aspect = w / h;
      const halfH  = state.base2DhalfH || 50;
      state.camera2D.left   = -halfH * aspect;
      state.camera2D.right  =  halfH * aspect;
      state.camera2D.updateProjectionMatrix();
      update2DCamera();
    }
  });
}

export function toggleAxes() {
  if (!state.axesHelper) return;
  state.axesHelper.visible = !state.axesHelper.visible;
  showFeedback('Axes ' + (state.axesHelper.visible ? 'on' : 'off'));
}

export function updateGridVisibility(forceMode) {
  const mode      = forceMode ?? state.currentMode;
  const inView    = (mode === '2d') && !state.mapTileGroup;
  const hasDN     = (getDesignNorthAngle() ?? 0) !== 0;
  const showDG    = inView && hasDN  && !!state.designGridManager?.grids?.size;
  const showCAD   = inView && !showDG;
  if (state.gridHelper) state.gridHelper.visible = showCAD;
  if (state.designGridManager) state.designGridManager.setVisible(showDG);
}

export function setGridVisible(v) {
  if (!v) {
    if (state.gridHelper) state.gridHelper.visible = false;
    if (state.designGridManager) state.designGridManager.setVisible(false);
  } else {
    updateGridVisibility();
  }
}
