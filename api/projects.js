/*
 * api/projects.js — GPRTool project repository
 *
 * Routes:
 *   POST /api/projects?action=save   — save or update a .gpr project
 *   GET  /api/projects?action=list   — list all projects (name, date, size, has_boundary)
 *   GET  /api/projects?action=load&id=UUID — load full .gpr data for a project
 *   POST /api/projects?action=delete — delete a project by id
 *
 * Storage: Supabase table `gpr_projects`
 * Env vars: GPRTOOL_SUPABASE_URL, GPRTOOL_SUPABASE_KEY
 */

const SB_URL = process.env.GPRTOOL_SUPABASE_URL;
const SB_KEY = process.env.GPRTOOL_SUPABASE_KEY;

function sbHeaders() {
  return {
    'apikey':        SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...sbHeaders(), ...(opts.headers || {}) },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

// ── Extract file list from base64 .gpr (ZIP) ─────────────────────────────
// Returns array of { name, size_bytes } for each file in the zip.
// Uses the ZIP local file header format — no full decompression needed.
async function extractGPRContents(gpr_data_b64) {
  try {
    const binary = Buffer.from(gpr_data_b64, 'base64');
    const contents = [];
    let offset = 0;
    while (offset < binary.length - 4) {
      const sig = binary.readUInt32LE(offset);
      if (sig !== 0x04034b50) break; // local file header signature
      const compSize   = binary.readUInt32LE(offset + 18);
      const uncompSize = binary.readUInt32LE(offset + 22);
      const nameLen    = binary.readUInt16LE(offset + 26);
      const extraLen   = binary.readUInt16LE(offset + 28);
      const name       = binary.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
      if (!name.endsWith('/')) contents.push({ name, size_bytes: uncompSize });
      offset += 30 + nameLen + extraLen + compSize;
    }
    return contents;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const action = req.query.action;

  // ── LIST ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    const { ok, data, status } = await sbFetch(
      'gpr_projects?select=id,folder,site_name,dxf_filename,file_size_bytes,has_boundary,wgs84_lat,wgs84_lng,gpr_contents,created_at,updated_at&order=updated_at.desc'
    );
    if (!ok) return res.status(status).json({ error: 'Failed to list projects', detail: data });
    return res.status(200).json({ projects: data });
  }

  // ── LOAD ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'load') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { ok, data, status } = await sbFetch(`gpr_projects?id=eq.${id}&select=*`);
    if (!ok || !data?.length) return res.status(404).json({ error: 'Project not found' });
    return res.status(200).json({ project: data[0] });
  }

  // ── SAVE ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'save') {
    const { id, site_name, dxf_filename, gpr_data, file_size_bytes,
            has_boundary, wgs84_lat, wgs84_lng } = req.body;

    if (!site_name || !gpr_data) return res.status(400).json({ error: 'site_name and gpr_data required' });

    const gpr_contents = await extractGPRContents(gpr_data);

    const payload = {
      folder:       body.folder ?? 'GPR Projects',
      site_name, dxf_filename, gpr_data, file_size_bytes,
      has_boundary: !!has_boundary, wgs84_lat, wgs84_lng,
      gpr_contents,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (id) {
      // Update existing
      result = await sbFetch(`gpr_projects?id=eq.${id}`, {
        method: 'PATCH', body: JSON.stringify(payload),
      });
    } else {
      // Insert new
      result = await sbFetch('gpr_projects', {
        method: 'POST', body: JSON.stringify(payload),
      });
    }
    if (!result.ok) return res.status(result.status).json({ error: 'Save failed', detail: result.data });
    const saved = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(200).json({ project: saved });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'delete') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { ok, status } = await sbFetch(`gpr_projects?id=eq.${id}`, { method: 'DELETE' });
    if (!ok) return res.status(status).json({ error: 'Delete failed' });
    return res.status(200).json({ deleted: id });
  }

  // ── DELETE UNTITLED ──────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'delete-untitled') {
    const { ok, status, data } = await sbFetch(
      `gpr_projects?site_name=eq.Untitled Site`, { method: 'DELETE' }
    );
    if (!ok) return res.status(status).json({ error: 'Delete failed', detail: data });
    return res.status(200).json({ deleted: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
