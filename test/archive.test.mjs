import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchive } from '../database/archive.mjs';
import { createApp } from '../server.mjs';
import { sampleSketch } from '../public/samples.js';

const settings = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', GARDEN_ID: 'pilot' };

test('cloud configuration rejects missing or browser credentials and insecure destinations', () => {
  for (const invalid of [{}, { ...settings, SUPABASE_SECRET_KEY: 'sb_publishable_key' }, { ...settings, SUPABASE_URL: 'http://localhost' }, { ...settings, GARDEN_ID: 'bad.name' }]) {
    assert.throws(() => createArchive(invalid));
  }
});

test('cloud uploads require acknowledgement, retry by ID, restore complete geometry and isolate gardens', async () => {
  const rows = new Map();
  let failure = false;
  const adapter = garden => createArchive({ ...settings, GARDEN_ID: garden }, async (url, options) => {
    assert.equal(url.pathname, '/rest/v1/sketch_n_sow_drawings');
    assert.equal(options.headers.apikey, settings.SUPABASE_SECRET_KEY);
    assert.equal(options.redirect, 'error');
    if (failure) return Response.json({ error: 'private provider details' }, { status: 503 });
    if (options.method === 'POST') {
      assert.equal(url.searchParams.get('on_conflict'), 'garden_id,id');
      assert.ok(options.headers.Prefer.includes('resolution=merge-duplicates'));
      const row = JSON.parse(options.body);
      rows.set(row.garden_id + ':' + row.id, row);
      return Response.json([{ id: row.id }], { status: 201 });
    }
    assert.equal(url.searchParams.get('garden_id'), 'eq.' + garden);
    return Response.json([...rows.values()].filter(row => row.garden_id === garden));
  });
  const start = async () => {
    const archive = adapter('pilot');
    const server = createApp({ archive, initialSketches: await archive.load() });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    return {
      post: sketch => fetch(base + '/api/sketches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sketch) }),
      list: async () => (await fetch(base + '/api/sketches')).json(),
      stop: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    };
  };
  let app = await start();
  try {
    const original = { ...sampleSketch(2), source: 'headset', coordinates: 'unity-left-handed-y-up' };
    assert.equal((await app.post(original)).status, 201);
    const first = (await app.list())[0];
    assert.equal((await app.post({ ...original, title: 'Saved garden' })).status, 200);
    assert.equal(rows.size, 1);
    failure = true;
    const failed = await app.post({ ...original, id: 'unsaved' });
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('private provider details'));
    assert.equal((await app.list()).length, 1);
    await assert.rejects(adapter('pilot').load());
    failure = false;
    await app.stop();
    app = await start();
    const restored = await app.list();
    assert.equal(restored.length, 1);
    assert.deepEqual(restored[0], { ...first, title: 'Saved garden' });
    assert.deepEqual(await adapter('different-garden').load(), []);
  } finally { await app.stop(); }
});
