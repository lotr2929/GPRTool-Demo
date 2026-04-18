/*
 * cadmapper-import.js — Import from CADMapper command
 *
 * Needs: callbacks.THREE, callbacks.onLayersLoaded(groups)
 * Exposes: initCADMapperImport(callbacks)
 *
 * Flow:
 *   1. User clicks "Import from CADMapper…"
 *   2. Step 1 modal: instructions (sign up, note Spatial Reference System, extract zip)
 *   3. Step 2 modal: file picker + Spatial Reference System fields + layer checkboxes
 *   4. parseCadmapperDXF() builds Three.js geometry per layer
 *   5. callbacks.onLayersLoaded(layerGroups) → index.html adds to scene
 *
 * DXF structure (CADMapper AutoCAD format, all in metres):
 *   MESH entities   → topography (1), buildings (many), roads/paths (many)
 *   LWPOLYLINE      → contours (many)
 *   POLYLINE+VERTEX → parks, water, railways
 *
 * Axis mapping: DXF X → Three X,  DXF Y → Three Z,  DXF Z → Three Y
 *
 * UTM conversion utility exported for OSM/site-pin alignment in calling code.
 */

import { setRealWorldAnchor } from './real-world.js';

// ── Layer display config ───────────────────────────────────────────────────
const LAYER_CONFIG = {
  topography:  { label: 'Terrain',     color: 0xc8b890, opacity: 1.0,  wire: false },
  buildings:   { label: 'Buildings',   color: 0xd4d0c8, opacity: 0.85, wire: false },
  highways:    { label: 'Highways',    color: 0x808078, opacity: 1.0,  wire: false },
  major_roads: { label: 'Major Roads', color: 0x989890, opacity: 1.0,  wire: false },
  minor_roads: { label: 'Minor Roads', color: 0xa8a8a0, opacity: 1.0,  wire: false },
  paths:       { label: 'Paths',       color: 0xb8b8a8, opacity: 1.0,  wire: false },
  parks:       { label: 'Parks',       color: 0x70b850, opacity: 1.0,  line: true  },
  water:       { label: 'Water',       color: 0x5888c0, opacity: 1.0,  line: true  },
  railways:    { label: 'Railways',    color: 0x585048, opacity: 1.0,  line: true  },
  contours:    { label: 'Contours',    color: 0xa08860, opacity: 0.7,  line: true  },
};

// ── Modal HTML (two-step: Step 1 = instructions, Step 2 = file + coords) ──
const MODAL_HTML = `
<div id="cadmapper-overlay" style="
  display:none; position:fixed; inset:0;
  background:rgba(0,0,0,0.35); z-index:1100;
  align-items:center; justify-content:center;">
  <div id="cadmapper-modal" style="
    background:var(--chrome-panel);
    border:1px solid var(--chrome-border);
    border-radius:6px; width:460px; max-width:95vw;
    box-shadow:0 8px 32px rgba(0,0,0,0.22);
    color:var(--text-primary);
    font-family:var(--font,'Outfit',sans-serif);
    overflow:hidden;">

    <!-- Shared header -->
    <div style="padding:12px 16px; border-bottom:1px solid var(--chrome-border);
                display:flex; align-items:center; gap:10px;
                background:var(--chrome-dark,#1e3d1e);">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
           stroke="#fff" stroke-width="1.4">
        <path d="M3 12h10M8 3v7M5 7l3 3 3-3"/>
        <rect x="1.5" y="11" width="13" height="2.5" rx="0.5"/>
      </svg>
      <h3 style="margin:0; font-size:13px; font-weight:600; flex:1; color:#fff;">Import from CADMapper</h3>
      <span id="cadmapper-step-label" style="font-size:10px; color:rgba(255,255,255,0.5); margin-right:4px;">Step 1 of 2</span>
      <button id="cadmapper-close" style="
        background:none; border:none; color:rgba(255,255,255,0.6);
        cursor:pointer; font-size:18px; line-height:1; padding:2px 6px;">&#x2715;</button>
    </div>

    <!-- STEP 1: Instructions -->
    <div id="cadmapper-step1">
      <div style="padding:16px 18px 14px; border-bottom:1px solid var(--chrome-border);">
        <p style="margin:0 0 10px; font-size:12px; line-height:1.6; color:var(--text-secondary,#aaa);">
          <strong style="color:var(--text-primary);">CADMapper</strong> converts
          OpenStreetMap and NASA terrain data into layered DXF files — buildings, roads,
          terrain and more — ready to import into GPRTool.
          Download is <strong style="color:var(--accent-light,#90c890);">free up to 1 km&sup2;</strong>
          but requires a free account.
        </p>
        <a href="https://cadmapper.com" target="_blank" rel="noopener" style="
          display:inline-flex; align-items:center; gap:6px;
          background:var(--accent-mid,#4a8a4a); color:#fff; text-decoration:none;
          border-radius:4px; font-size:11px; font-weight:600; padding:5px 12px;">
          &#8599;&nbsp;Sign up at cadmapper.com
        </a>
      </div>
      <div style="padding:14px 18px 16px; font-size:12px; line-height:1.75;">
        <div style="margin-bottom:11px; display:flex; gap:11px; align-items:flex-start;">
          <span style="min-width:20px; height:20px; border-radius:50%; flex-shrink:0; margin-top:1px;
                       background:var(--accent-mid,#4a8a4a); color:#fff;
                       display:flex; align-items:center; justify-content:center;
                       font-size:10px; font-weight:700;">1</span>
          <span>Sign up at cadmapper.com (free account required).</span>
        </div>
        <div style="margin-bottom:11px; display:flex; gap:11px; align-items:flex-start;">
          <span style="min-width:20px; height:20px; border-radius:50%; flex-shrink:0; margin-top:1px;
                       background:var(--accent-mid,#4a8a4a); color:#fff;
                       display:flex; align-items:center; justify-content:center;
                       font-size:10px; font-weight:700;">2</span>
          <span>Select your site area, choose <strong>AutoCAD DXF</strong> format, and click Download.</span>
        </div>
        <div style="margin-bottom:11px; display:flex; gap:11px; align-items:flex-start;">
          <span style="min-width:20px; height:20px; border-radius:50%; flex-shrink:0; margin-top:1px;
                       background:var(--accent-mid,#4a8a4a); color:#fff;
                       display:flex; align-items:center; justify-content:center;
                       font-size:10px; font-weight:700;">3</span>
          <span>On the download confirmation page, note your
            <strong style="color:var(--text-primary);">Spatial Reference System</strong>:
            copy the <strong>UTM Zone</strong>, <strong>Easting</strong>, and
            <strong>Northing</strong> values in that order — GPRTool needs these to geolocate your model.
            <span style="color:var(--text-muted);">Zip files stay on the CADMapper site for
            1&nbsp;month, so you can return to the download page to retrieve these values later.</span></span>
        </div>
        <div style="display:flex; gap:11px; align-items:flex-start;">
          <span style="min-width:20px; height:20px; border-radius:50%; flex-shrink:0; margin-top:1px;
                       background:var(--accent-mid,#4a8a4a); color:#fff;
                       display:flex; align-items:center; justify-content:center;
                       font-size:10px; font-weight:700;">4</span>
          <span>Extract the downloaded <strong>.zip</strong> to get your <strong>.dxf</strong> file.</span>
        </div>
      </div>
      <div style="padding:8px 18px 14px; border-top:1px solid var(--chrome-border); margin-top:2px;
                  background:var(--accent-subtle,#eef4eb); font-size:10px; line-height:1.6;
                  color:var(--text-secondary);">
        <strong style="color:var(--text-primary); font-size:10px;">Road widths (Austroads)</strong><br>
        Highways &amp; freeways: 3.5 m/lane (dual carriageway, ~20–30 m total) &nbsp;&middot;&nbsp;
        Major roads: 3.5 m/lane (~14–20 m) &nbsp;&middot;&nbsp;
        Minor roads: 3.0–3.5 m/lane (~10–14 m) &nbsp;&middot;&nbsp;
        Paths: footpath 1.5–2.0 m, shared 2.5–3.5 m.
        Road layers in the DXF show the road <em>surface</em> mesh only — actual road reserve widths
        include shoulders and verges beyond the carriageway.
      </div>
      <div style="padding:10px 16px 14px; display:flex; justify-content:flex-end;
                  border-top:1px solid var(--chrome-border);">
        <button id="cadmapper-proceed-btn" style="
          background:var(--accent-mid,#4a8a4a); color:#fff; border:none;
          border-radius:4px; font-size:12px; padding:7px 18px;
          cursor:pointer; white-space:nowrap;">Proceed &#8594;</button>
      </div>
    </div>

    <!-- STEP 2: File + Spatial Reference System + layers -->
    <div id="cadmapper-step2" style="display:none;">

      <div style="padding:14px 16px; border-bottom:1px solid var(--chrome-border);">
        <label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:6px;">
          DXF File (from cadmapper.com)
        </label>
        <div style="display:flex; gap:8px; align-items:center;">
          <span id="cadmapper-filename" style="
            flex:1; font-size:12px; color:var(--text-secondary);
            background:var(--chrome-input); border:1px solid var(--chrome-border);
            border-radius:4px; padding:6px 10px;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            No file selected
          </span>
          <button id="cadmapper-file-btn" style="
            background:var(--chrome-panel-alt); color:var(--text-primary);
            border:1px solid var(--chrome-border); border-radius:4px; font-size:12px;
            padding:6px 12px; cursor:pointer; white-space:nowrap;">Browse&#8230;</button>
          <input type="file" id="cadmapper-file-input" accept=".dxf" style="display:none">
        </div>
      </div>

      <div style="padding:14px 16px; border-bottom:1px solid var(--chrome-border);">
        <label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:2px;">
          Spatial Reference System
        </label>
        <div style="font-size:10px; color:var(--text-muted); margin-bottom:8px;">
          From your CADMapper download page &mdash; required to geolocate your model
        </div>
        <div style="display:flex; gap:8px;">
          <div style="width:80px;">
            <div style="font-size:10px; color:var(--text-secondary); margin-bottom:3px;">UTM Zone</div>
            <input id="cadmapper-zone" type="number" placeholder="e.g. 50"
              style="width:100%; box-sizing:border-box; background:var(--chrome-input);
                     border:1px solid var(--chrome-border); border-radius:4px;
                     color:var(--text-primary); font-size:12px; padding:5px 8px; outline:none;">
          </div>
          <div style="flex:1;">
            <div style="font-size:10px; color:var(--text-secondary); margin-bottom:3px;">Easting (m)</div>
            <input id="cadmapper-easting" type="number" placeholder="e.g. 388500"
              style="width:100%; box-sizing:border-box; background:var(--chrome-input);
                     border:1px solid var(--chrome-border); border-radius:4px;
                     color:var(--text-primary); font-size:12px; padding:5px 8px; outline:none;">
          </div>
          <div style="flex:1;">
            <div style="font-size:10px; color:var(--text-secondary); margin-bottom:3px;">Northing (m)</div>
            <input id="cadmapper-northing" type="number" placeholder="e.g. -3535933"
              style="width:100%; box-sizing:border-box; background:var(--chrome-input);
                     border:1px solid var(--chrome-border); border-radius:4px;
                     color:var(--text-primary); font-size:12px; padding:5px 8px; outline:none;">
          </div>
        </div>
      </div>

      <div style="padding:12px 16px; border-bottom:1px solid var(--chrome-border);">
        <div style="font-size:11px; color:var(--text-secondary); margin-bottom:8px;">Layers to import</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px 14px;">
          ${Object.entries(LAYER_CONFIG).map(([k, v]) =>
            `<label style="font-size:11px;display:flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="checkbox" class="cadmapper-layer-cb" data-layer="${k}" checked
                style="accent-color:var(--accent-mid,#4a8a4a);">${v.label}
            </label>`).join('')}
        </div>
      </div>

      <div style="padding:10px 16px; display:flex; align-items:center; gap:8px;">
        <button id="cadmapper-back-btn" style="
          background:none; color:var(--text-secondary);
          border:1px solid var(--chrome-border); border-radius:4px;
          font-size:12px; padding:6px 12px; cursor:pointer; white-space:nowrap;">
          &#8592; Back
        </button>
        <span id="cadmapper-status" style="flex:1; font-size:11px; color:var(--text-secondary);">
          Select a DXF file to import.
        </span>
        <button id="cadmapper-import-btn" disabled style="
          background:var(--accent-mid,#4a8a4a); color:#fff;
          border:none; border-radius:4px; font-size:12px;
          padding:6px 14px; cursor:pointer; opacity:0.5; white-space:nowrap;">
          Import
        </button>
      </div>

    </div>
  </div>
</div>`;

// ── Module state ───────────────────────────────────────────────────────────
let _callbacks = null;
let _dxfFile   = null;

// ── Init ───────────────────────────────────────────────────────────────────
export function initCADMapperImport(callbacks) {
  _callbacks = callbacks;
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

  document.getElementById('importCADMapperBtn').addEventListener('click', openModal);
  document.getElementById('cadmapper-close').addEventListener('click', closeModal);
  document.getElementById('cadmapper-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('cadmapper-overlay')) closeModal();
  });
  document.getElementById('cadmapper-proceed-btn').addEventListener('click', showStep2);
  document.getElementById('cadmapper-back-btn').addEventListener('click', showStep1);
  document.getElementById('cadmapper-file-btn').addEventListener('click', () =>
    document.getElementById('cadmapper-file-input').click());
  document.getElementById('cadmapper-file-input').addEventListener('change', onFileSelected);
  document.getElementById('cadmapper-import-btn').addEventListener('click', runImport);
}

function openModal() {
  showStep1();
  document.getElementById('cadmapper-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('cadmapper-overlay').style.display = 'none';
}

function showStep1() {
  document.getElementById('cadmapper-step1').style.display = 'block';
  document.getElementById('cadmapper-step2').style.display = 'none';
  document.getElementById('cadmapper-step-label').textContent = 'Step 1 of 2';
}

function showStep2() {
  document.getElementById('cadmapper-step1').style.display = 'none';
  document.getElementById('cadmapper-step2').style.display = 'block';
  document.getElementById('cadmapper-step-label').textContent = 'Step 2 of 2';
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('cadmapper-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#e06060' : 'var(--text-secondary)';
}

function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  _dxfFile = file;
  document.getElementById('cadmapper-filename').textContent = file.name;
  document.getElementById('cadmapper-filename').style.color = 'var(--text-primary)';
  document.getElementById('cadmapper-import-btn').disabled = false;
  document.getElementById('cadmapper-import-btn').style.opacity = '1';
  setStatus(`Ready: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
  e.target.value = '';
}

async function runImport() {
  if (!_dxfFile) return;

  const easting  = parseFloat(document.getElementById('cadmapper-easting').value);
  const northing = parseFloat(document.getElementById('cadmapper-northing').value);
  const zoneNum  = parseInt(document.getElementById('cadmapper-zone').value.trim(), 10);
  // Set the Real World anchor — single source of truth in real-world.js.
  // This is the ONLY place UTM coordinates enter the system from the UI.
  if (!isNaN(easting) && !isNaN(northing) && zoneNum > 0) {
    setRealWorldAnchor(zoneNum, easting, northing);
  }

  const selectedLayers = new Set(
    [...document.querySelectorAll('.cadmapper-layer-cb:checked')].map(cb => cb.dataset.layer)
  );

  setStatus('Reading DXF\u2026');
  document.getElementById('cadmapper-import-btn').disabled = true;
  document.getElementById('cadmapper-import-btn').style.opacity = '0.5';

  try {
    const text = await _dxfFile.text();
    const layerGroups = parseCadmapperDXF(text, selectedLayers, _callbacks.THREE);
    if (!layerGroups || !Object.keys(layerGroups).length) {
      throw new Error('No geometry found in selected layers');
    }
    closeModal();
    _callbacks.onLayersLoaded(layerGroups, _dxfFile);
  } catch (err) {
    setStatus('Import failed: ' + err.message, true);
    document.getElementById('cadmapper-import-btn').disabled = false;
    document.getElementById('cadmapper-import-btn').style.opacity = '1';
    console.error('GPRTool cadmapper-import:', err);
  }
}

// ── DXF parser ─────────────────────────────────────────────────────────────
function parseCadmapperDXF(text, selectedLayers, THREE) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const val  = lines[i + 1].trim();
    if (!isNaN(code)) pairs.push({ code, val });
  }

  let start = 0;
  for (; start < pairs.length; start++) {
    if (pairs[start].code === 2 && pairs[start].val === 'ENTITIES') break;
  }
  let end = start;
  for (; end < pairs.length; end++) {
    if (pairs[end].code === 0 && pairs[end].val === 'ENDSEC' && end > start) break;
  }
  if (start >= pairs.length) throw new Error('No ENTITIES section found — not a valid DXF');

  const blocks = [];
  let i = start + 1;
  let currentBlock = null;
  while (i < end) {
    const p = pairs[i];
    if (p.code === 0) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: p.val, layer: null, pairs: [] };
    } else if (currentBlock) {
      if (p.code === 8 && currentBlock.layer === null) currentBlock.layer = p.val;
      currentBlock.pairs.push(p);
    }
    i++;
  }
  if (currentBlock) blocks.push(currentBlock);

  const merged = [];
  let bi = 0;
  while (bi < blocks.length) {
    const b = blocks[bi];
    if (b.type === 'POLYLINE') {
      const vertices = [];
      bi++;
      while (bi < blocks.length && blocks[bi].type !== 'SEQEND') {
        if (blocks[bi].type === 'VERTEX') {
          const vp = blocks[bi].pairs;
          let vx = 0, vy = 0, vz = 0;
          for (const p of vp) {
            if (p.code === 10) vx = parseFloat(p.val);
            else if (p.code === 20) vy = parseFloat(p.val);
            else if (p.code === 30) vz = parseFloat(p.val);
          }
          vertices.push({ x: vx, y: vy, z: vz });
        }
        bi++;
      }
      bi++;
      merged.push({ type: 'POLYLINE', layer: b.layer, vertices, pairs: b.pairs });
    } else if (b.type === 'VERTEX' || b.type === 'SEQEND') {
      bi++;
    } else {
      merged.push(b);
      bi++;
    }
  }

  const layerData = {};
  for (const block of merged) {
    const layer = block.layer;
    if (!layer || !selectedLayers.has(layer)) continue;
    if (!layerData[layer]) layerData[layer] = { meshParts: [], lineParts: [] };
    if (block.type === 'MESH') {
      const geom = parseMeshBlock(block.pairs, THREE);
      if (geom) layerData[layer].meshParts.push(geom);
    } else if (block.type === 'LWPOLYLINE') {
      const pts = parseLWPolylineBlock(block.pairs);
      if (pts && pts.length >= 2) layerData[layer].lineParts.push(pts);
    } else if (block.type === 'POLYLINE') {
      if (block.vertices && block.vertices.length >= 2)
        layerData[layer].lineParts.push(block.vertices);
    }
  }

  const layerGroups = {};
  for (const [layer, data] of Object.entries(layerData)) {
    const cfg   = LAYER_CONFIG[layer] || { color: 0xaaaaaa, opacity: 1.0 };
    const group = new THREE.Group();
    group.name  = layer;

    for (const geom of data.meshParts) {
      const mat = new THREE.MeshBasicMaterial({
        color: cfg.color, opacity: cfg.opacity, transparent: cfg.opacity < 1.0,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      group.add(new THREE.Mesh(geom, mat));
      if (layer === 'buildings' || layer === 'topography') {
        const edges   = new THREE.EdgesGeometry(geom, 15);
        const edgeMat = new THREE.LineBasicMaterial({
          color: layer === 'buildings' ? 0x888888 : 0xa09070, opacity: 0.4, transparent: true,
        });
        const edgeMesh = new THREE.LineSegments(edges, edgeMat);
        edgeMesh.renderOrder = 1;
        group.add(edgeMesh);
      }
    }

    for (const pts of data.lineParts) {
      const closed   = pts.length > 2 && isClosed(pts);
      const threePts = pts.map(p => new THREE.Vector3(p.x, p.z, p.y));
      const geom     = new THREE.BufferGeometry().setFromPoints(
        closed ? [...threePts, threePts[0]] : threePts
      );
      group.add(new THREE.Line(geom,
        new THREE.LineBasicMaterial({ color: cfg.color, opacity: cfg.opacity, transparent: cfg.opacity < 1.0 })
      ));
    }

    if (group.children.length) layerGroups[layer] = group;
  }
  return layerGroups;
}

// ── Parse a MESH entity block into BufferGeometry ─────────────────────────
function parseMeshBlock(pairs, THREE) {
  let pi = 0;
  while (pi < pairs.length && pairs[pi].code !== 92) pi++;
  if (pi >= pairs.length) return null;
  const vertCount = parseInt(pairs[pi].val, 10);
  pi++;

  const vx = new Float32Array(vertCount);
  const vy = new Float32Array(vertCount);
  const vz = new Float32Array(vertCount);
  let vi = 0, tmpX = 0, tmpY = 0;

  while (pi < pairs.length && vi < vertCount) {
    const { code, val } = pairs[pi];
    if      (code === 10) { tmpX = parseFloat(val); }
    else if (code === 20) { tmpY = parseFloat(val); }
    else if (code === 30) { vx[vi] = tmpX; vy[vi] = tmpY; vz[vi] = parseFloat(val); vi++; }
    else if (code === 93) break;
    pi++;
  }
  if (vi < vertCount) return null;

  while (pi < pairs.length && pairs[pi].code !== 93) pi++;
  if (pi >= pairs.length) return null;
  const faceListCount = parseInt(pairs[pi].val, 10);
  pi++;

  const faceList = new Int32Array(faceListCount);
  let fi = 0;
  while (pi < pairs.length && fi < faceListCount) {
    if (pairs[pi].code === 90) faceList[fi++] = parseInt(pairs[pi].val, 10);
    pi++;
  }

  // Axis map: DXF X→Three X, DXF Y→Three Z, DXF Z→Three Y
  const positions = new Float32Array(vertCount * 3);
  for (let j = 0; j < vertCount; j++) {
    positions[j * 3] = vx[j]; positions[j * 3 + 1] = vz[j]; positions[j * 3 + 2] = vy[j];
  }

  const indices = [];
  let fli = 0;
  while (fli < faceListCount) {
    const n = faceList[fli++];
    if      (n === 3) { indices.push(faceList[fli], faceList[fli+1], faceList[fli+2]); fli += 3; }
    else if (n === 4) {
      indices.push(faceList[fli], faceList[fli+1], faceList[fli+2]);
      indices.push(faceList[fli], faceList[fli+2], faceList[fli+3]);
      fli += 4;
    } else { fli += n; }
  }
  if (!indices.length) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// ── Parse a LWPOLYLINE entity block into vertex list ──────────────────────
function parseLWPolylineBlock(pairs) {
  let elevation = 0;
  const pts = [];
  let tmpX = null;
  for (const { code, val } of pairs) {
    if      (code === 38) elevation = parseFloat(val);
    else if (code === 10) tmpX = parseFloat(val);
    else if (code === 20 && tmpX !== null) {
      pts.push({ x: tmpX, y: parseFloat(val), z: elevation });
      tmpX = null;
    }
  }
  return pts;
}

// ── Check if a polyline is closed (first ≈ last vertex) ───────────────────
function isClosed(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

// ── Layer visibility panel (injected into right panel after load) ──────────
export function buildLayerPanel(layerGroups, container) {
  const existing = document.getElementById('cadmapper-layer-section');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id        = 'cadmapper-layer-section';
  section.className = 'property-section';
  section.innerHTML = '<h4>Site Context</h4>';

  for (const [layer, group] of Object.entries(layerGroups)) {
    const cfg   = LAYER_CONFIG[layer] || { label: layer };
    const count = group.children.length;
    const row   = document.createElement('div');
    row.className    = 'info-row';
    row.style.cursor = 'pointer';
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;width:100%;';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true;
    cb.style.cssText = 'accent-color:var(--accent-mid,#4a8a4a);';
    cb.addEventListener('change', () => { group.visible = cb.checked; });
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;
      background:#${(LAYER_CONFIG[layer]?.color ?? 0xaaaaaa).toString(16).padStart(6,'0')};`;
    const name = document.createElement('span');
    name.style.cssText = 'flex:1;font-size:12px;'; name.textContent = cfg.label;
    const cnt = document.createElement('span');
    cnt.style.cssText = 'font-size:10px;color:var(--text-secondary);'; cnt.textContent = count;
    label.append(cb, dot, name, cnt);
    row.appendChild(label);
    section.appendChild(row);
  }

  const viewActions  = document.getElementById('view-actions-section');
  const panelContent = container || document.querySelector('#right-panel .panel-content');
  if (viewActions && panelContent) panelContent.insertBefore(section, viewActions);
  else if (panelContent) panelContent.appendChild(section);
  return section;
}

// wgs84ToUTM has moved to real-world.js — import it from there.
