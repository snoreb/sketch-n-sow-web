import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { sampleSketch } from '../public/samples.js';

async function start(context) {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const diagnostics = async () => (await fetch(base + '/api/diagnostics')).json();
  const post = (payload, path = '/api/sketches', headers = {}) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload)
  });
  return { server, base, diagnostics, post };
}

test('diagnostics distinguish browser probes, samples, headset uploads and empty geometry', async context => {
  const { base, diagnostics, post } = await start(context);
  assert.equal((await diagnostics()).entries.length, 0);
  await post('', '/api/diagnostics/probe');
  let data = await diagnostics();
  assert.equal(data.counts.attempts, 0);
  assert.equal(data.entries[0].source, 'browser-test');
  await fetch(base + '/api/health');
  assert.match((await diagnostics()).entries[0].message, /does not confirm Unity/);
  await post(sampleSketch(0));
  await post({ ...sampleSketch(1), source: 'headset' });
  await post({ schemaVersion: 1, id: 'empty', title: 'Empty package', source: 'headset', strokes: [] });
  data = await diagnostics();
  assert.equal(data.counts.attempts, 3);
  assert.equal(data.counts.acceptedHeadset, 2);
  assert.equal(data.counts.acceptedSample, 1);
  assert.equal(data.counts.rejected, 0);
  assert.equal(data.counts.pending, 0);
  assert.equal(data.entries[0].points, 0);
  assert.match(data.entries[0].message, /no drawing points/);
  assert.ok(data.entries[0].bytes > 0);
  assert.ok(data.entries[0].address);
  assert.equal(data.entries[0].status, 201);
  assert.ok(!('strokes' in data.entries[1]) || typeof data.entries[1].strokes === 'number');
});

test('rejected requests expose useful errors, including CORS, malformed bodies and wrong URLs', async context => {
  const { diagnostics, post } = await start(context);
  await post('{private-content');
  let latest = (await diagnostics()).entries[0];
  assert.equal(latest.status, 400);
  assert.match(latest.message, /Invalid JSON/);
  assert.ok(!latest.message.includes('private-content'));
  await post({ ...sampleSketch(0), source: 'headset', schemaVersion: 2 });
  latest = (await diagnostics()).entries[0];
  assert.equal(latest.source, 'headset');
  assert.match(latest.message, /schemaVersion/);
  await post(sampleSketch(0), '/api/sketches', { Origin: 'https://wrong.example' });
  latest = (await diagnostics()).entries[0];
  assert.equal(latest.status, 403);
  assert.match(latest.message, /Origin not allowed/);
  await post(sampleSketch(0), '/wrong-address');
  latest = (await diagnostics()).entries[0];
  assert.equal(latest.status, 404);
  assert.equal(latest.path, '/wrong-address');
  await post('hello', '/api/sketches', { 'Content-Type': 'text/plain' });
  latest = (await diagnostics()).entries[0];
  assert.equal(latest.status, 415);
  await post({ ...sampleSketch(0), title: 'x'.repeat(4 * 1024 * 1024) });
  latest = (await diagnostics()).entries[0];
  assert.equal(latest.status, 413);
  assert.match(latest.message, /4 MiB/);
  assert.equal((await diagnostics()).counts.rejected, 6);
});

test('incomplete requests are visible while receiving, before validation finishes', async context => {
  const { server, base, diagnostics } = await start(context);
  const arrived = new Promise(resolve => server.once('request', resolve));
  const request = http.request(base + '/api/sketches', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const completed = new Promise((resolve, reject) => {
    request.on('response', response => { response.resume(); response.on('end', resolve); });
    request.on('error', reject);
  });
  request.flushHeaders();
  await arrived;
  const receiving = await diagnostics();
  assert.equal(receiving.counts.pending, 1);
  assert.equal(receiving.entries[0].status, null);
  request.end(JSON.stringify({ ...sampleSketch(0), source: 'headset' }));
  await completed;
  assert.equal((await diagnostics()).counts.pending, 0);
  assert.equal((await diagnostics()).counts.acceptedHeadset, 1);
});

test('diagnostic history is bounded and remains available independently of 3D assets', async context => {
  const { base, diagnostics, post } = await start(context);
  for (let index = 0; index < 65; index++) await post('', '/api/diagnostics/probe');
  const data = await diagnostics();
  assert.equal(data.entries.length, 60);
  assert.equal(data.entries[0].id, 65);
  assert.equal(data.counts.attempts, 0);
  const script = await fetch(base + '/diagnostics.js');
  assert.equal(script.status, 200);
  assert.ok(!(await script.text()).includes("from 'three'"));
  assert.equal((await fetch(base + '/diagnostics.css')).status, 200);
});
