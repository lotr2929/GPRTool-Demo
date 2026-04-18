/*
 * plants.js — Plant library, GPR calculation, placement engine
 */
import * as THREE from 'three';
import { state } from './state.js';
import { showFeedback } from './ui.js';
import { updateSceneHelpers } from './grid.js';

export function recalcGPR() {
  const gprEl     = document.getElementById('gpr-value');
  const numEl     = document.getElementById('gpr-numerator');
  const breakRow  = document.getElementById('gpr-breakdown-row');
  const targetEl  = document.getElementById('gpr-target');
  const resultRow = document.querySelector('.gpr-result');
  if (!gprEl) return;

  let numerator = 0;
  state.surfaces.forEach(s => {
    (s.plants || []).forEach(inst => {
      const sp = plantDb.find(p => p.id === inst.speciesId);
      if (sp && inst.canopyArea > 0) numerator += inst.canopyArea * sp.lai;
    });
  });

  let denom = siteAreaM2;
  if (!denom) {
    denom = state.surfaces.filter(s => s.type === 'ground').reduce((acc, s) => acc + s.area, 0);
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

export function updateClearBtn() {
  const anyPlanted = state.surfaces.some(s => (s.plants || []).length > 0);
  const clearBtn = document.getElementById('clearPlantsBtn');
  if (clearBtn) clearBtn.disabled = !anyPlanted;
}

export function addPlantInstance(surface, species, canopyArea) {
  if (!surface.plants) surface.plants = [];
  const inst = { instanceId: ++_instanceCounter, speciesId: species.id, canopyArea };
  surface.plants.push(inst);
  updateSurfaceListTag(surface);
  renderSurfacePlantSchedule(surface);
  recalcGPR();
  showFeedback(`Added ${species.common} \u2014 ${canopyArea} m\u00b2, LAI ${species.lai}`);
}

export function removePlantInstance(surface, instanceId) {
  if (!surface.plants) return;
  surface.plants = surface.plants.filter(i => i.instanceId !== instanceId);
  updateSurfaceListTag(surface);
  renderSurfacePlantSchedule(surface);
  recalcGPR();
  showFeedback('Plant instance removed');
}

export function updateInstanceCanopyArea(surface, instanceId, newArea) {
  const inst = (surface.plants || []).find(i => i.instanceId === instanceId);
  if (inst) { inst.canopyArea = newArea; recalcGPR(); }
}

export function updateSurfaceListTag(surface) {
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

export function renderSurfacePlantSchedule(surface) {
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

export function renderPlantList() {
  const listEl   = document.getElementById('plant-list');
  const query    = (document.getElementById('plant-search')?.value || '').toLowerCase();
  const filter   = document.getElementById('plant-filter')?.value || 'all';
  const surfType = state.selectedSurface?.type || null;

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

export function refreshModalStatus() {
  const statusEl  = document.getElementById('plant-modal-status');
  const assignBtn = document.getElementById('plant-assign-btn');
  if (!statusEl) return;

  if (!state.selectedSurface) {
    statusEl.textContent = 'Select a surface first.';
    if (assignBtn) assignBtn.disabled = true;
    return;
  }

  const surfType   = state.selectedSurface.type;
  const compatible = selectedPlant ? selectedPlant.surface_types.includes(surfType) : false;

  if (selectedPlant) {
    // Check substrate compatibility
    const subMm    = state.selectedSurface.substrate_mm;
    const minSub   = selectedPlant.size?.min_substrate_mm;
    const subWarn  = subMm && minSub && subMm < minSub
      ? ` ⚠ Needs ≥${minSub}mm substrate (surface has ${subMm}mm)`
      : '';
    const limits   = radiusLimits(selectedPlant, state.selectedSurface);
    const capWarn  = limits.capLabel && !subWarn ? ` — capped at ${limits.max}m radius` : '';

    statusEl.textContent = compatible
      ? `Add ${selectedPlant.common} (LAI ${selectedPlant.lai}) to ${surfType}${subWarn || capWarn}`
      : `${selectedPlant.common} is not rated for ${surfType} state.surfaces`;
    statusEl.style.color = subWarn ? '#e8a040' : '';
    if (assignBtn) assignBtn.disabled = !compatible;
  } else {
    statusEl.textContent = `${surfType} surface — select a species above`;
    statusEl.style.color = '';
    if (assignBtn) assignBtn.disabled = true;
  }
}

export function openPlantModal() {
  if (!plantDb.length) {
    showFeedback('Plant library not loaded \u2014 check browser console');
    return;
  }
  if (!state.selectedSurface) {
    showFeedback('Select a surface first, then click Add Plant');
    return;
  }
  plantModalOpen = true;
  selectedPlant  = null;
  document.getElementById('plant-modal-overlay').classList.add('open');
  document.getElementById('plant-search').value = '';
  const filterEl = document.getElementById('plant-filter');
  if (filterEl) filterEl.value = state.selectedSurface.type;
  renderPlantList();
  document.getElementById('plant-search').focus();
  showFeedback('Plant Library \u2014 select a species to add', 0);
}

export function closePlantModal() {
  plantModalOpen = false;
  selectedPlant  = null;
  document.getElementById('plant-modal-overlay').classList.remove('open');
}

export function placementTypeForCategory(cat) {
  if (!cat) return 'circle';
  const c = cat.toLowerCase();
  if (c.includes('tree') || c.includes('shrub') || c.includes('bamboo') || c.includes('palm')) return 'circle';
  return 'polygon';
}

export function substrateCapRadius(depth_mm) {
  if (!depth_mm || depth_mm <= 0) return Infinity;
  const table = _substrateCapTable;
  if (!table) return Infinity;
  // Find first entry where depth_mm <= cap threshold
  for (const cap of table) {
    if (depth_mm <= cap.depth_mm) return cap.max_radius_m;
  }
  return Infinity;
}

export function substrateCapLabel(depth_mm) {
  if (!depth_mm || depth_mm <= 0) return null;
  const table = _substrateCapTable;
  if (!table) return null;
  for (const cap of table) {
    if (depth_mm <= cap.depth_mm) return cap.label;
  }
  return null;
}

export function radiusLimits(species, surface) {
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

export function getSurfaceCentre(surface) {
  surface.mesh.geometry.computeBoundingBox();
  const box = new THREE.Box3().copy(surface.mesh.geometry.boundingBox).applyMatrix4(surface.mesh.matrixWorld);
  const c = new THREE.Vector3();
  box.getCenter(c);
  return c;
}

export function raycastSurface(ndc, surface) {
  const r = new THREE.Raycaster();
  r.setFromCamera(ndc, camera2D);
  const hits = r.intersectObject(surface.mesh, false);
  return hits.length ? hits[0].point : null;
}

export function worldToSurfaceUV(worldPt, surface) {
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

export function surfaceUVToWorld(u, v, surface) {
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

export function canvasNDC(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
     ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1
  );
}

export function startPlacement(species) {
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

export function cancelPlacement() {
  placementMode   = 'idle';
  placingSpecies  = null;
  placingCircle   = null;
  placingPoly     = [];
  editingInstance = null;
  clearPreview();
  renderer.domElement.style.cursor = '';
  showFeedback('Ready');
}

export function clearPreview() {
  if (previewMesh) {
    if (Array.isArray(previewMesh)) {
      previewMesh.forEach(m => { scene.remove(m); m.geometry?.dispose(); });
    } else {
      scene.remove(previewMesh); previewMesh.geometry?.dispose();
    }
    previewMesh = null;
  }
}

export function showCirclePreview(cx, cz, radius, surface) {
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

export function showPolygonPreview(pts, mouseUV, surface) {
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

export function commitCirclePlacement(surface, species, centre, radius, area) {
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

export function commitPolygonPlacement(surface, species, polyPts) {
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

export function polygonArea(pts) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].u + pts[i].u) * (pts[j].v - pts[i].v);
  }
  return Math.abs(area / 2);
}

export function proxyMatForCategory(cat) {
  if (!cat) return PROXY_MAT.tree;
  const c = cat.toLowerCase();
  if (c.includes('tree'))  return PROXY_MAT.tree;
  if (c.includes('shrub')) return PROXY_MAT.shrub;
  if (c.includes('bamboo') || c.includes('palm')) return PROXY_MAT.bamboo;
  return PROXY_MAT.polygon;
}

export function buildCircleProxy(inst, surface, species) {
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

export function buildPolygonProxy(inst, surface, species) {
  const { points } = inst.placement;
  if (points.length < 3) return null;

  // Build Three.js ShapeGeometry in surface-local UV space,
  // then transform each vertex to world space
  const worldPts = points.map(p => surfaceUVToWorld(p.u, p.v, surface));
  // Determine a local 2D basis to feed THREE.Shape
  // For simplicity: use XZ world coords (works for horizontal state.surfaces)
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

export function removeProxyForInstance(inst) {
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

export function clearAllProxies() {
  state.surfaces.forEach(s => {
    (s.plants || []).forEach(inst => removeProxyForInstance(inst));
  });
  while (plantProxyGroup.children.length) {
    const c = plantProxyGroup.children[0];
    c.geometry?.dispose();
    plantProxyGroup.remove(c);
  }
}
