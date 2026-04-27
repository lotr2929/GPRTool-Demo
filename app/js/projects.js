/*
 * projects.js — GPRTool project repository client
 *
 * Manages saving and loading .gpr projects from the server-side Supabase store.
 * The user never handles .gpr files directly — GPRTool keeps all projects server-side.
 * Downloading a .gpr is subscription-gated (future).
 *
 * API:
 *   saveProject(gprBlob, meta)  → saves to server, returns project record
 *   listProjects()              → returns array of project summaries
 *   loadProject(id)             → returns { manifest, reference, design, boundary, hasDXF, zip }
 *   deleteProject(id)           → deletes from server
 *   showProjectsModal()         → opens Recent Projects UI
 */

import { setPipelineStatus, showFeedback } from './ui.js';
import { isLocalFolderSupported, pickLocalSaveFile, writeBlobToHandle } from './local-folder.js';
import { state } from './state.js';

const API = '/api/projects';

// ── Blob ↔ base64 helpers ─────────────────────────────────────────────────

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type = 'application/octet-stream') {
  const bytes = atob(b64);
  const arr   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type });
}

// ── Save ──────────────────────────────────────────────────────────────────

/**
 * Save the active .gpr project to the server.
 * Called automatically after CADMapper import and after boundary is drawn.
 *
 * @param {Blob}   gprBlob  - The .gpr zip blob
 * @param {Object} meta     - { id?, site_name, dxf_filename, has_boundary, wgs84_lat, wgs84_lng }
 * @returns {Promise<{id, site_name, ...}>} saved project record
 */
export async function saveProject(gprBlob, meta) {
  const gpr_data = await blobToBase64(gprBlob);
  const res = await fetch(`${API}?action=save`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      ...meta,
      gpr_data,
      file_size_bytes: gprBlob.size,
    }),
  });
  if (!res.ok) throw new Error('Failed to save project: ' + (await res.text()));
  const { project } = await res.json();
  return project;
}

// ── List ──────────────────────────────────────────────────────────────────

export async function listProjects() {
  const res = await fetch(`${API}?action=list`);
  if (!res.ok) throw new Error('Failed to list projects');
  const { projects } = await res.json();
  return projects ?? [];
}

// ── Load ──────────────────────────────────────────────────────────────────

/**
 * Load a project from the server and parse it as a .gpr file.
 * @param {string} id - UUID of the project
 * @returns parsed .gpr contents (same as gpr-file.js openGPR)
 */
export async function loadProject(id) {
  const res = await fetch(`${API}?action=load&id=${id}`);
  if (!res.ok) throw new Error('Project not found');
  const { project } = await res.json();

  const blob = base64ToBlob(project.gpr_data);
  const file = new File([blob], project.dxf_filename ?? 'project.gpr');
  return file;
}

// ── Delete ────────────────────────────────────────────────────────────────

export async function deleteProject(id) {
  const res = await fetch(`${API}?action=delete`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Failed to delete project');
}

// ── Save Project Dialog ───────────────────────────────────────────────────
// OS-convention Save As: name field at top, existing projects as a file list below.
// Clicking an existing project fills the name field. Saving with a matching name
// triggers a confirmation before overwriting.

export function showSaveProjectDialog({ blob, blobGetter, defaultName, lat, lng, dxfFilename }) {
  // blobGetter: optional function returning Promise<Blob> — used when blob isn't ready yet
  // blob:       direct Blob — legacy path, still supported
  return new Promise(async (resolve) => {
    // Show dialog shell immediately — don't block on listProjects()
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:1400;
      background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;`;

    // existing[] is populated async after dialog is shown
    let existing = [];

    overlay.innerHTML = `
      <div style="background:var(--chrome-panel);border:1px solid var(--chrome-border);
        border-radius:6px;width:460px;max-width:95vw;max-height:80vh;
        display:flex;flex-direction:column;
        box-shadow:0 8px 32px rgba(0,0,0,0.25);
        font-family:var(--font,'Outfit',sans-serif);color:var(--text-primary);overflow:hidden;">

        <div style="padding:11px 16px;background:var(--chrome-dark,#1e3d1e);
          display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.4">
            <path d="M2 3.5h4l1.5 2H14V13H2V3.5z"/>
          </svg>
          <span style="font-size:13px;font-weight:600;color:#fff;flex:1;">Save Project</span>
          <button id="spd-skip" style="background:none;border:none;color:rgba(255,255,255,0.5);
            cursor:pointer;font-size:18px;line-height:1;padding:2px 6px;">&#x2715;</button>
        </div>

        <!-- File list (existing projects) — populated async after dialog shows -->
        <div id="spd-list" style="flex:1;overflow-y:auto;border-bottom:1px solid var(--chrome-border);
          min-height:120px;max-height:260px;">
          <div id="spd-list-loading" style="padding:20px;text-align:center;font-size:12px;color:var(--text-secondary);">
            Loading\u2026</div>
        </div>

        <!-- Name field + buttons -->
        <div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">
              File name:</label>
            <input id="spd-name" type="text" value="${defaultName}"
              style="flex:1;background:var(--chrome-input);border:1px solid var(--chrome-border);
              border-radius:4px;color:var(--text-primary);font-size:12px;
              padding:5px 8px;outline:none;"/>
          </div>
          <div id="spd-terrain-status" style="font-size:11px;color:var(--text-secondary);min-height:14px;display:none;margin-bottom:6px;"></div>
          <div id="spd-error" style="font-size:11px;color:#e06060;min-height:14px;display:none;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="spd-cancel" style="background:none;border:1px solid var(--chrome-border);
              border-radius:4px;color:var(--text-secondary);font-size:12px;
              padding:5px 16px;cursor:pointer;">Cancel</button>
            <button id="spd-save" style="background:var(--accent-mid,#4a8a4a);color:#fff;
              border:none;border-radius:4px;font-size:12px;padding:5px 20px;cursor:pointer;">
              Save</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#spd-name');
    const errEl     = overlay.querySelector('#spd-error');
    let selectedId  = null;

    // Fetch projects list async — populate the list when it arrives
    listProjects().then(rows => {
      existing = rows;
      const listEl = overlay.querySelector('#spd-list');
      if (!listEl) return;
      listEl.innerHTML = rows.length
        ? rows.map(p => `
          <div class="spd-row" data-id="${p.id}" data-name="${p.site_name.replace(/"/g,'&quot;')}"
            style="display:flex;align-items:center;gap:10px;padding:8px 14px;
            cursor:pointer;border-bottom:1px solid var(--chrome-border);">
            <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${p.site_name}</span>
            <span style="font-size:10px;color:var(--text-secondary);">
              ${new Date(p.updated_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
          </div>`).join('')
        : `<div style="padding:20px;text-align:center;font-size:12px;color:var(--text-secondary);">
            No existing projects</div>`;
            // Re-wire row clicks
      listEl.querySelectorAll('.spd-row').forEach(row => {
        row.addEventListener('click', () => {
          listEl.querySelectorAll('.spd-row').forEach(r => r.style.background = '');
          selectedId = row.dataset.id;
          nameInput.value = row.dataset.name;
          row.style.background = 'rgba(74,138,74,0.18)'; // light green highlight
        });
      });
    }).catch(() => {
      const listEl = overlay.querySelector('#spd-list');
      if (listEl) listEl.innerHTML = `<div style="padding:20px;text-align:center;font-size:12px;color:var(--text-secondary);">No existing projects</div>`;
    });

    const close = (saved) => {
      window.removeEventListener('terrain:status', _onTerrainStatus);
      document.body.removeChild(overlay);
      resolve(saved);
    };

    // ── Terrain status (informational only — Save is always enabled) ─
    // Header pipeline-status pill shows live %; this just labels the case
    // where terrain is still loading so the user knows what to expect.
    const saveBtn   = overlay.querySelector('#spd-save');
    const tStatusEl = overlay.querySelector('#spd-terrain-status');

    const _applyTerrainStatus = (status) => {
      if (status === 'fetching' || status === 'idle') {
        tStatusEl.style.display = '';
        tStatusEl.style.color   = 'var(--text-secondary)';
        tStatusEl.textContent   = 'Terrain still loading \u2014 will attach in background after save';
      } else if (status === 'ready') {
        tStatusEl.style.display = '';
        tStatusEl.style.color   = '#4a8a4a';
        tStatusEl.textContent   = '\u2713 Terrain ready';
      } else if (status === 'error' || status === 'unavailable') {
        tStatusEl.style.display = '';
        tStatusEl.style.color   = '#c08040';
        tStatusEl.textContent   = 'Terrain unavailable \u2014 saving without terrain';
      } else {
        // No terrain pipeline ran (e.g. DXF-only project)
        tStatusEl.style.display = 'none';
      }
    };
    const _onTerrainStatus = (e) => _applyTerrainStatus(e.detail.status);
    window.addEventListener('terrain:status', _onTerrainStatus);
    // Apply current state on open (state.terrainStatus may be undefined on DXF-only)
    _applyTerrainStatus(state?.terrainStatus);

    overlay.querySelector('#spd-skip').addEventListener('click',   () => close(false));
    overlay.querySelector('#spd-cancel').addEventListener('click', () => close(false));

    overlay.querySelector('#spd-save').addEventListener('click', async () => {
      const name = nameInput.value.trim() || defaultName;

      // Check if name matches an existing project (case-insensitive)
      const match = existing.find(p => p.site_name.toLowerCase() === name.toLowerCase());
      const overId = selectedId ?? match?.id ?? null;

      // Confirmation only when overwriting an existing Supabase project
      if (overId && !confirm(`Overwrite "${name}" in cloud?`)) return;

      // STEP 1 (must run in user-gesture): open Save-As for local copy.
      // If unsupported (non-Chromium browser), fileHandle stays null and we
      // skip local write but still save to Supabase.
      let fileHandle = null;
      if (isLocalFolderSupported()) {
        try {
          fileHandle = await pickLocalSaveFile(name);
        } catch (e) {
          console.warn('[GPR] local file picker error:', e);
          showFeedback('Local file picker error: ' + e.message, 4000);
          return; // abort — per spec, cancel/fail aborts entire save
        }
        // User cancelled the Save-As dialog → abort entire save
        if (!fileHandle) return;
      }

      // STEP 2: close dialog, run Supabase + local write in parallel
      close(true);
      // Stash file handle so a still-running terrain worker can re-write
      // the saved file when it completes (background terrain attach).
      state.activeFileHandle = fileHandle;
      setPipelineStatus('Saving\u2026', 'busy');
      (async () => {
        try {
          const resolvedBlob = blob ?? (blobGetter ? await blobGetter() : null);
          if (!resolvedBlob) throw new Error('No project data to save');

          const supabaseTask = saveProject(resolvedBlob, {
            id:           overId ?? undefined,
            site_name:    name,
            folder:       'GPR Projects',
            dxf_filename: dxfFilename,
            has_boundary: false,
            wgs84_lat:    lat,
            wgs84_lng:    lng,
          });

          const localTask = fileHandle
            ? writeBlobToHandle(fileHandle, resolvedBlob)
            : Promise.resolve(null);

          const [supabase, local] = await Promise.allSettled([supabaseTask, localTask]);

          if (supabase.status === 'rejected') throw supabase.reason;

          if (fileHandle && local.status === 'rejected') {
            console.warn('[GPR] local write failed:', local.reason);
            setPipelineStatus('\u2713 Saved (cloud only)', 'done');
            showFeedback('Saved to cloud \u2014 local write failed: ' + local.reason.message, 6000);
          } else {
            setPipelineStatus('\u2713 Saved', 'done');
          }
        } catch (e) {
          console.warn('[GPR] save failed:', e);
          setPipelineStatus('\u2717 Save failed', 'error');
          showFeedback('Save failed: ' + e.message, 6000);
        }
      })();
    });

    nameInput.focus(); nameInput.select();
  });
}


const MODAL_ID = 'recent-projects-overlay';

export function initProjects() {
  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.style.cssText = `
    display:none; position:fixed; inset:0; z-index:1300;
    background:rgba(0,0,0,0.4);
    align-items:center; justify-content:center;`;

  overlay.innerHTML = `
    <div style="
      background:var(--chrome-panel); border:1px solid var(--chrome-border);
      border-radius:6px; width:720px; max-width:95vw; max-height:80vh;
      box-shadow:0 8px 32px rgba(0,0,0,0.22); display:flex; flex-direction:column;
      font-family:var(--font,'Outfit',sans-serif); color:var(--text-primary); overflow:hidden;">

      <div style="padding:12px 16px; border-bottom:1px solid var(--chrome-border);
                  display:flex; align-items:center; gap:10px;
                  background:var(--chrome-dark,#1e3d1e); flex-shrink:0;">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
             stroke="#fff" stroke-width="1.4">
          <path d="M2 3.5h4l1.5 2H14V13H2V3.5z"/>
        </svg>
        <h3 style="margin:0;font-size:13px;font-weight:600;flex:1;color:#fff;">
          GPR Projects</h3>
        <button id="rp-close" style="background:none;border:none;color:rgba(255,255,255,0.6);
          cursor:pointer;font-size:18px;line-height:1;padding:2px 6px;">&#x2715;</button>
      </div>

      <div style="display:flex;flex:1;min-height:0;overflow:hidden;">
        <!-- Folder pane -->
        <div id="rp-folders" style="width:160px;flex-shrink:0;border-right:1px solid var(--chrome-border);
          overflow-y:auto;padding:6px 0;background:var(--chrome-panel-alt,#f5f5f0);">
        </div>
        <!-- Project list pane -->
        <div id="rp-list" style="flex:1;overflow-y:auto;padding:8px 0;min-height:100px;">
          <div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:12px;">
            Loading projects\u2026</div>
        </div>
      </div>

      <div style="padding:10px 16px;border-top:1px solid var(--chrome-border);
                  display:flex;justify-content:space-between;align-items:center;
                  flex-shrink:0;font-size:11px;color:var(--text-secondary);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span id="rp-count"></span>
          <button id="rp-delete-selected" style="display:none;background:#c04040;color:#fff;
            border:none;border-radius:4px;font-size:11px;padding:4px 10px;cursor:pointer;">
            Delete selected</button>
        </div>
        <div style="display:flex;gap:6px;">
          <button id="rp-clean" style="background:none;border:1px solid var(--chrome-border);
            border-radius:4px;color:var(--text-secondary);font-size:11px;
            padding:4px 10px;cursor:pointer;">Clean up Untitled</button>
          <button id="rp-refresh" style="background:none;border:1px solid var(--chrome-border);
            border-radius:4px;color:var(--text-secondary);font-size:11px;
            padding:4px 10px;cursor:pointer;">&#8635; Refresh</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) hideProjectsModal();
  });
  document.getElementById('rp-close').addEventListener('click', hideProjectsModal);
  document.getElementById('rp-refresh').addEventListener('click', () => loadProjectList());
  document.getElementById('rp-clean').addEventListener('click', async () => {
    if (!confirm('Delete all "Untitled Site" entries? This cannot be undone.')) return;
    await fetch(`${API}?action=delete-untitled`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    loadProjectList();
  });
  document.getElementById('rp-delete-selected').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('.rp-check:checked')].map(cb => cb.dataset.id);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} project${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    await Promise.all(ids.map(id => deleteProject(id)));
    loadProjectList();
  });
}

export function showProjectsModal(onOpen) {
  _onOpenCallback = onOpen;
  document.getElementById(MODAL_ID).style.display = 'flex';
  loadProjectList();
}

function hideProjectsModal() {
  document.getElementById(MODAL_ID).style.display = 'none';
}

let _onOpenCallback = null;

let _selectedFolder = 'GPR Projects';

async function loadProjectList() {
  const listEl   = document.getElementById('rp-list');
  const countEl  = document.getElementById('rp-count');
  const foldersEl = document.getElementById('rp-folders');
  listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:12px;">
    Loading\u2026</div>`;

  try {
    const projects = await listProjects();

    // Build folder list from unique folder values
    const folders = [...new Set(projects.map(p => p.folder || 'GPR Projects'))].sort();
    if (!folders.includes('GPR Projects')) folders.unshift('GPR Projects');

    foldersEl.innerHTML = '';
    folders.forEach(f => {
      const btn = document.createElement('div');
      const count = projects.filter(p => (p.folder || 'GPR Projects') === f).length;
      btn.style.cssText = `padding:8px 12px;font-size:12px;cursor:pointer;
        display:flex;justify-content:space-between;align-items:center;
        ${f === _selectedFolder ? 'background:var(--accent-dark,#1e3d1e);color:var(--accent-light,#7fc47f);font-weight:600;' : 'color:var(--text-primary);'}`;
      btn.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f}</span>
        <span style="font-size:10px;opacity:0.6;flex-shrink:0;margin-left:4px;">${count}</span>`;
      btn.addEventListener('click', () => { _selectedFolder = f; loadProjectList(); });
      foldersEl.appendChild(btn);
    });

    // Filter to selected folder
    const filtered = projects.filter(p => (p.folder || 'GPR Projects') === _selectedFolder);
    countEl.textContent = `${filtered.length} project${filtered.length !== 1 ? 's' : ''}`;

    const delBtn = document.getElementById('rp-delete-selected');

    if (!filtered.length) {
      listEl.innerHTML = `<div style="padding:24px;text-align:center;
        color:var(--text-secondary);font-size:12px;">No projects in this folder.</div>`;
      delBtn.style.display = 'none';
      return;
    }

    listEl.innerHTML = '';

    // Select-all header row
    const selAll = document.createElement('div');
    selAll.style.cssText = `display:flex;align-items:center;gap:10px;padding:6px 16px;
      border-bottom:2px solid var(--chrome-border);font-size:11px;color:var(--text-secondary);`;
    selAll.innerHTML = `<input type="checkbox" id="rp-select-all"
      style="accent-color:var(--accent-mid,#4a8a4a);width:14px;height:14px;cursor:pointer;">
      <span>Select all</span>`;
    listEl.appendChild(selAll);

    for (const p of filtered) {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:12px;padding:10px 16px;
        border-bottom:1px solid var(--chrome-border);`;
      row.addEventListener('mouseover', () => row.style.background = 'var(--chrome-hover)');
      row.addEventListener('mouseout',  () => row.style.background = '');

      const date = new Date(p.updated_at).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
      const size = p.file_size_bytes
        ? (p.file_size_bytes < 1024*1024
            ? `${(p.file_size_bytes/1024).toFixed(0)} KB`
            : `${(p.file_size_bytes/1024/1024).toFixed(1)} MB`) : '';
      const boundary = p.has_boundary
        ? `<span style="font-size:10px;background:var(--accent-dark,#1e3d1e);
             color:var(--accent-light,#7fc47f);border-radius:3px;padding:1px 5px;
             margin-left:4px;">Boundary</span>` : '';

      row.innerHTML = `
        <input type="checkbox" class="rp-check" data-id="${p.id}"
          style="accent-color:var(--accent-mid,#4a8a4a);flex-shrink:0;cursor:pointer;width:14px;height:14px;">
        <svg width="24" height="24" viewBox="0 0 28 28" fill="none"
          stroke="var(--accent-mid,#4a8a4a)" stroke-width="1.4" style="flex-shrink:0;opacity:0.7;">
          <path d="M4 6h8l3 4h9v14H4V6z"/>
        </svg>
        <div style="flex:1;min-width:0;cursor:pointer;" class="rp-open-row">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;
            overflow:hidden;text-overflow:ellipsis;">${p.site_name}${boundary}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
            ${date}${size ? ` &middot; ${size}` : ''}</div>
        </div>
        <button class="rp-inspect-btn" title="Show contents"
          style="background:none;border:none;color:var(--text-secondary);
          cursor:pointer;font-size:12px;padding:4px 6px;flex-shrink:0;">&#9660;</button>`;

      // Contents panel (hidden by default)
      const contentsPanel = document.createElement('div');
      contentsPanel.style.cssText = `display:none;padding:6px 16px 8px 52px;
        font-size:11px;color:var(--text-secondary);border-bottom:1px solid var(--chrome-border);
        background:var(--chrome-panel-alt,#f5f5f0);`;
      contentsPanel.innerHTML = `<span style="opacity:0.5;">Loading contents…</span>`;

      row.querySelector('.rp-open-row').addEventListener('click', async () => {
        hideProjectsModal();
        if (_onOpenCallback) {
          const file = await loadProject(p.id);
          _onOpenCallback(file);
        }
      });

      // Inspect button — expand/collapse contents
      row.querySelector('.rp-inspect-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const isOpen = contentsPanel.style.display !== 'none';
        contentsPanel.style.display = isOpen ? 'none' : 'block';
        btn.innerHTML = isOpen ? '&#9660;' : '&#9650;';
        if (!isOpen && contentsPanel.dataset.loaded !== 'true') {
          const files = p.gpr_contents;
          if (files && files.length) {
            contentsPanel.innerHTML = files.map(f =>
              `<div style="display:flex;justify-content:space-between;padding:2px 0;">
                <span style="color:var(--text-primary);">&#128196; ${f.name}</span>
                <span>${(f.size_bytes/1024).toFixed(1)} KB</span>
              </div>`
            ).join('');
          } else {
            contentsPanel.innerHTML = `<span style="opacity:0.5;">Contents not available — re-save to populate.</span>`;
          }
          contentsPanel.dataset.loaded = 'true';
        }
      });

      listEl.appendChild(row);
      listEl.appendChild(contentsPanel);
    }

    // Select-all toggle
    document.getElementById('rp-select-all').addEventListener('change', e => {
      listEl.querySelectorAll('.rp-check').forEach(cb => cb.checked = e.target.checked);
      updateDeleteBtn();
    });
    listEl.querySelectorAll('.rp-check').forEach(cb =>
      cb.addEventListener('change', updateDeleteBtn));

    function updateDeleteBtn() {
      const checked = [...listEl.querySelectorAll('.rp-check:checked')];
      delBtn.style.display = checked.length ? 'inline-block' : 'none';
      delBtn.textContent   = `Delete selected (${checked.length})`;
    }
    updateDeleteBtn();

  } catch (err) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;
      color:#e06060;font-size:12px;">Failed to load: ${err.message}</div>`;
  }
}
