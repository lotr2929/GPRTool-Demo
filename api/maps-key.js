/*
 * api/maps-key.js — serve Google Maps API key to the browser
 *
 * GET /api/maps-key
 * Returns: { key: string }
 *
 * The key is never in source code or the git repo.
 * Env var: GOOGLE_MAPS_API_KEY (set in Vercel project settings — already present)
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
  return res.status(200).json({ key });
}
