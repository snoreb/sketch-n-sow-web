import { createArchive } from './archive.mjs';
import { normalizeSketch } from '../schema.mjs';

try {
  const archive = createArchive();
  const existing = new Map((await archive.load()).map(sketch => [sketch.id, sketch]));
  const local = new URL('/api/sketches', 'http://127.0.0.1');
  local.port = process.env.PORT || '8787';
  const response = await fetch(local, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Cannot read the running local gallery. Leave its terminal open.');
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('The local server did not return a sketch collection.');
  const live = rows.map(row => ({ ...normalizeSketch(row), receivedAt: existing.get(row.id)?.receivedAt ?? row.receivedAt ?? new Date().toISOString() }));
  for (const sketch of live) existing.set(sketch.id, sketch);
  if (existing.size > 100 || [...existing.values()].reduce((sum, sketch) => sum + sketch.pointCount, 0) > 150000) throw new Error('Not enough room in this garden. Choose a new GARDEN_ID.');
  for (const sketch of live) await archive.save(sketch);
  console.log(`Saved ${live.length} live drawings to garden "${archive.garden}". You can now stop the old server if no further sketches have arrived.`);
} catch (error) {
  console.error('Transfer incomplete. Keep the old server running; it is safe to retry.', error.message);
  process.exitCode = 1;
}
