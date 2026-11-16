import { networkInterfaces } from 'node:os';

export function createDiagnostics() {
  const startedAt = new Date().toISOString();
  const entries = [];
  const counts = { attempts: 0, acceptedHeadset: 0, acceptedSample: 0, acceptedOther: 0, rejected: 0, pending: 0 };
  let nextId = 1;
  return {
    track(request, response, path) {
      if (!['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method) && path !== '/api/health') return null;
      const sketchAttempt = request.method === 'POST' && !['/api/diagnostics/probe', '/api/heartbeat'].includes(path);
      const entry = {
        id: nextId++, time: new Date().toISOString(), method: request.method,
        path: path.slice(0, 180), address: request.socket.remoteAddress ?? 'unknown',
        source: 'unknown', bytes: 0, status: null, message: 'Request arrived; waiting for the body.',
        userAgent: String(request.headers['user-agent'] ?? '').slice(0, 180)
      };
      entries.unshift(entry);
      if (entries.length > 60) entries.pop();
      if (sketchAttempt) { counts.attempts++; counts.pending++; }
      const started = Date.now();
      let finished = false;
      const finish = disconnected => {
        if (finished) return;
        finished = true;
        entry.status = disconnected ? 499 : response.statusCode;
        entry.durationMs = Date.now() - started;
        if (disconnected) entry.message = 'Sender disconnected before a response completed.';
        if (sketchAttempt) {
          counts.pending--;
          if (entry.accepted && !disconnected) {
            if (entry.source === 'headset') counts.acceptedHeadset++;
            else if (entry.source === 'sample') counts.acceptedSample++;
            else counts.acceptedOther++;
          } else counts.rejected++;
        }
      };
      response.once('finish', () => finish(false));
      response.once('close', () => finish(!response.writableFinished));
      return entry;
    },
    snapshot(port) {
      const networkUrls = [];
      for (const addresses of Object.values(networkInterfaces())) for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) networkUrls.push(`http://${address.address}:${port}`);
      }
      return { startedAt, counts: { ...counts }, entries: entries.map(entry => ({ ...entry })), networkUrls: [...new Set(networkUrls)] };
    }
  };
}
