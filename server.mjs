import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { normalizeSketch } from './schema.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { createPresence } from './presence.mjs';
import { createArchive } from './database/archive.mjs';

const files = new Map([
  ['/', ['public/index.html', 'text/html']],
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/diagnostics.js', ['public/diagnostics.js', 'text/javascript']],
  ['/diagnostics.css', ['public/diagnostics.css', 'text/css']],
  ['/viewer.js', ['public/viewer.js', 'text/javascript']],
  ['/samples.js', ['public/samples.js', 'text/javascript']],
  ['/style.css', ['public/style.css', 'text/css']],
  ['/vendor/three.module.js', ['node_modules/three/build/three.module.js', 'text/javascript']],
  ['/vendor/OrbitControls.js', ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'text/javascript']]
]);

export function createApp({ allowedOrigins = [], archive = null, initialSketches = [] } = {}) {
  const sketches = new Map(initialSketches.map(sketch => [sketch.id, sketch]));
  let writes = Promise.resolve();
  const clients = new Set();
  const diagnostics = createDiagnostics();
  const presence = createPresence();
  const send = (response, status, body) => {
    if (response.diagnosticEntry && body.error) response.diagnosticEntry.message = String(body.error).slice(0, 300);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const event = (response, kind, body) => response.write(`event: ${kind}\ndata: ${JSON.stringify(body)}\n\n`);
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const entry = diagnostics.track(request, response, path);
    response.diagnosticEntry = entry;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}` && !allowedOrigins.includes(origin)) {
      return send(response, 403, { error: 'Origin not allowed. Serve the website from this server or configure ALLOWED_ORIGINS.' });
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return response.end();
    }
    if (request.method === 'GET' && path === '/api/diagnostics') {
      return send(response, 200, { ...diagnostics.snapshot(server.address().port), presence: presence.snapshot(),
        storage: archive ? { mode: 'hosted', garden: archive.garden } : { mode: 'memory' } });
    }
    if (request.method === 'GET' && path === '/api/health') {
      entry.message = 'Reachability check arrived. This confirms this device can reach the server; it does not confirm Unity is sending sketches.';
      return send(response, 200, { ok: true, message: 'Sketch-n-Sow is reachable. The website diagnostics log shows this check.' });
    }
    if (request.method === 'POST' && path === '/api/diagnostics/probe') {
      request.resume();
      entry.source = 'browser-test';
      entry.message = 'Website connection test received. This is not a headset sketch.';
      return send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && path === '/api/heartbeat') {
      entry.source = 'heartbeat';
      if (!request.headers['content-type']?.startsWith('application/json')) return send(response, 415, { error: 'Use application/json' });
      try {
        const chunks = [];
        for await (const chunk of request) {
          entry.bytes += chunk.length;
          if (entry.bytes > 4096) return send(response, 413, { error: 'Heartbeat exceeds 4 KiB' });
          chunks.push(chunk);
        }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new Error('Invalid heartbeat JSON'); }
        const result = presence.receive(payload, request.socket.remoteAddress ?? 'unknown');
        entry.message = `Heartbeat received from ${payload.label} (${payload.deviceKind}). App can reach this server; sketch delivery is checked separately.`;
        return send(response, 200, { ok: true, ...result });
      } catch (error) {
        if (!response.headersSent) send(response, 400, { error: error.message });
        return;
      }
    }
    if (request.method === 'GET' && path === '/api/sketches') return send(response, 200, [...sketches.values()]);
    if (request.method === 'GET' && path === '/api/events') {
      if (clients.size >= 32) return send(response, 503, { error: 'Too many viewers' });
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      event(response, 'snapshot', [...sketches.values()]);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (request.method === 'POST' && path === '/api/sketches') {
      if (!request.headers['content-type']?.startsWith('application/json')) return send(response, 415, { error: 'Use application/json' });
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          entry.bytes = size;
          if (size > 4 * 1024 * 1024) { send(response, 413, { error: 'Payload exceeds 4 MiB' }); return; }
          chunks.push(chunk);
        }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new Error('Invalid JSON. Send JsonUtility.ToJson(snapshot) as an application/json request body.'); }
        entry.source = ['sample', 'headset'].includes(payload?.source) ? payload.source : 'unknown';
        const sketch = normalizeSketch(payload);
        const commit = async () => {
          const existing = sketches.get(sketch.id);
          if (!existing && sketches.size >= 100) return send(response, 507, { error: 'Garden full (100 ideas). Start a new garden.' });
          const total = [...sketches.values()].reduce((sum, item) => sum + item.pointCount, 0) - (existing?.pointCount ?? 0) + sketch.pointCount;
          if (total > 150000) return send(response, 507, { error: 'Garden point budget reached. Start a new garden.' });
          sketch.receivedAt = existing?.receivedAt ?? new Date().toISOString();
          if (archive) {
            try { await archive.save(sketch); }
            catch (error) { return send(response, 503, { error: 'Drawing save not confirmed. ' + error.message }); }
          }
          sketches.set(sketch.id, sketch);
          entry.accepted = true;
          entry.ideaId = sketch.id;
          entry.strokes = sketch.strokes.length;
          entry.points = sketch.pointCount;
          entry.message = `${existing ? 'Updated' : 'Accepted'} idea: ${sketch.strokes.length} strokes, ${sketch.pointCount} points.${sketch.pointCount === 0 ? ' The request arrived, but contains no drawing points. Check which finished lines Unity captures.' : ''}`;
          for (const client of clients) {
            if (client.writableLength > 8 * 1024 * 1024) { client.destroy(); clients.delete(client); }
            else event(client, 'upsert', sketch);
          }
          return send(response, existing ? 200 : 201, { id: sketch.id });
        };
        const committed = writes.then(commit);
        writes = committed.catch(() => {});
        return await committed;
      } catch (error) {
        if (!response.headersSent) send(response, 400, { error: error.message });
        return;
      }
    }
    if (request.method === 'GET' && files.has(path)) {
      const [file, type] = files.get(path);
      try {
        const contents = await readFile(new URL(file, import.meta.url));
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return response.end(contents);
      } catch { return send(response, 500, { error: 'Missing app dependency. Run npm install first.' }); }
    }
    send(response, 404, { error: 'Not found' });
  });
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();
  server.on('close', () => { clearInterval(heartbeat); for (const client of clients) client.end(); });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  const cloud = process.argv.includes('--cloud') || process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY;
  const archive = cloud ? createArchive() : null;
  const initialSketches = archive ? await archive.load() : [];
  const server = createApp({ archive, initialSketches, allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean) });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Sketch-n-Sow: http://localhost:${port}`);
    for (const addresses of Object.values(networkInterfaces())) for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) console.log(`Network: http://${address.address}:${port}`);
    }
    console.log(archive ? `Hosted database: ${archive.garden} · ${initialSketches.length} drawings restored.` : 'Temporary mode: restarting clears drawings. Use npm run start:cloud for hosted storage.');
  });
}
