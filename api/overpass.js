/*
 * api/overpass.js — Server-side Overpass API proxy
 *
 * Proxies Overpass queries from the browser through Vercel's server,
 * avoiding per-user browser IP rate limits (HTTP 403).
 * Adds a simple in-memory cache keyed on query hash to avoid
 * redundant fetches for the same bounding box.
 *
 * POST /api/overpass   body: { query: string }
 */

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// In-memory cache: query_hash → { data, expires }
// Survives within a single Vercel function instance (warm lambda).
const _cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashQuery(q) {
  let h = 0;
  for (let i = 0; i < q.length; i++) {
    h = (Math.imul(31, h) + q.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { query } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing query' });
  }

  // Check cache
  const key = hashQuery(query);
  const cached = _cache.get(key);
  if (cached && cached.expires > Date.now()) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  // Try each endpoint in turn
  let lastErr = null;
  for (const url of ENDPOINTS) {
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(55000), // Vercel max 60s; leave margin
      });
      if (!upstream.ok) {
        lastErr = new Error(`Overpass ${url} returned ${upstream.status}`);
        continue;
      }
      const data = await upstream.json();
      _cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
      res.setHeader('X-Cache', 'MISS');
      return res.status(200).json(data);
    } catch (err) {
      lastErr = err;
    }
  }

  return res.status(502).json({ error: 'All Overpass endpoints failed', detail: lastErr?.message });
}
