import { normalizeSketch } from '../schema.mjs';

export function createArchive(env = process.env, request = fetch) {
  const garden = env.GARDEN_ID;
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(garden ?? '')) throw new Error('Set GARDEN_ID to a short lowercase name, such as thesis-pilot.');
  if (!env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) throw new Error('Set SUPABASE_SECRET_KEY to a server-only Supabase secret key in .env.');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL ?? '')) throw new Error('Set SUPABASE_URL to the HTTPS project URL in .env.');
  const endpoint = new URL('/rest/v1/sketch_n_sow_drawings', env.SUPABASE_URL);
  const key = env.SUPABASE_SECRET_KEY;
  async function query(params, options = {}) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams(params);
    let response;
    try {
      response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { apikey: key, 'Content-Type': 'application/json', ...options.headers } });
    } catch { throw new Error('The hosted database could not be reached. Check the computer’s internet connection and project URL.'); }
    if (!response.ok) throw new Error(`Database returned HTTP ${response.status}. Check the project URL, server secret, Data API and setup.sql.`);
    return response.json();
  }
  return {
    garden,
    async load() {
      const rows = await query({ garden_id: 'eq.' + garden, select: 'sketch,created_at', order: 'created_at.asc,id.asc', limit: '101' });
      if (!Array.isArray(rows) || rows.length > 100) throw new Error('Garden exceeds the 100-idea viewer limit. Use a new GARDEN_ID; existing data is retained.');
      const restored = rows.map(row => ({ ...normalizeSketch(row.sketch), receivedAt: row.sketch.receivedAt ?? row.created_at }));
      if (restored.reduce((count, sketch) => count + sketch.pointCount, 0) > 150000) throw new Error('Garden exceeds the viewer point limit.');
      return restored;
    },
    async save(sketch) {
      const rows = await query({ on_conflict: 'garden_id,id', select: 'id' }, {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ garden_id: garden, id: sketch.id, sketch })
      });
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== sketch.id) throw new Error('The database did not confirm this drawing ID.');
    }
  };
}
