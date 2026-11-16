import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { normalizeSketch } from '../schema.mjs';
import { sampleSketch } from '../public/samples.js';

test('Unity vector/color payload preserves per-point widths and coordinate convention', () => {
  const sketch = normalizeSketch({ schemaVersion: 1, id: 'unity-1', title: 'My seed', coordinates: 'unity-left-handed-y-up', strokes: [{ points: [{ x: 1, y: 2, z: 3 }, { x: 2, y: 4, z: 6 }], widths: [0.001, 0.03], color: { r: 1, g: 0.5, b: 0, a: 1 }, colors: [{ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 1, b: 0, a: 1 }] }] });
  assert.deepEqual(sketch.strokes[0].points, [[1, 2, 3], [2, 4, 6]]);
  assert.deepEqual(sketch.strokes[0].widths, [0.001, 0.03]);
  assert.equal(sketch.coordinates, 'unity-left-handed-y-up');
  assert.equal(sketch.pointCount, 2);
});

test('all generated samples validate; malformed geometry and versions are rejected', () => {
  for (let index = 0; index < 3; index++) assert.ok(normalizeSketch(sampleSketch(index)).pointCount > 0);
  assert.throws(() => normalizeSketch({ ...sampleSketch(0), schemaVersion: 2 }));
  assert.throws(() => normalizeSketch({ ...sampleSketch(0), strokes: [{ points: [[0, 0, Infinity]] }] }));
  assert.throws(() => normalizeSketch({ ...sampleSketch(0), strokes: [{ points: [[0, 0, 0]], widths: [] }] }));
  assert.throws(() => normalizeSketch({ ...sampleSketch(0), strokes: [{ points: [[0, 0, 0]], width: -1 }] }));
});

test('POST broadcasts immediately, retries upsert, reconnects receive state, CORS and restart isolation', async () => {
  const server = createApp({ allowedOrigins: ['http://localhost:5173'] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const abort = new AbortController();
  try {
    const events = await fetch(base + '/api/events', { signal: abort.signal });
    const reader = events.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: snapshot\ndata: \[\]/);
    const sketch = sampleSketch(0);
    const post = body => fetch(base + '/api/sketches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(sketch)).status, 201);
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: upsert/);
    assert.equal((await post({ ...sketch, title: 'Updated' })).status, 200);
    const list = await (await fetch(base + '/api/sketches')).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, 'Updated');
    const reconnect = await fetch(base + '/api/events', { signal: abort.signal });
    assert.match(new TextDecoder().decode((await reconnect.body.getReader().read()).value), /Updated/);
    assert.equal((await post({ ...sketch, schemaVersion: 99 })).status, 400);
    assert.equal((await post({ ...sketch, title: 'x'.repeat(4 * 1024 * 1024) })).status, 413);
    assert.equal((await (await fetch(base + '/api/sketches')).json()).length, 1);
    assert.equal((await fetch(base + '/api/sketches', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
    const preflight = await fetch(base + '/api/sketches', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal((await fetch(base + '/')).status, 200);
  } finally {
    abort.abort();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  const fresh = createApp();
  await new Promise(resolve => fresh.listen(0, '127.0.0.1', resolve));
  try { assert.deepEqual(await (await fetch(`http://127.0.0.1:${fresh.address().port}/api/sketches`)).json(), []); }
  finally { fresh.closeAllConnections(); await new Promise(resolve => fresh.close(resolve)); }
});
