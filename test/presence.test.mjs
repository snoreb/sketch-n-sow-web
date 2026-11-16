import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresence } from '../presence.mjs';
import { createApp } from '../server.mjs';

const heartbeat = (clientId = 'session-a') => ({ schemaVersion: 1, clientId, label: 'Quest A', deviceKind: 'headset' });

test('presence expires after 20 seconds, reconnects in place, and distinguishes multiple apps', () => {
  let time = 100000;
  const presence = createPresence({ now: () => time });
  assert.deepEqual(presence.snapshot().devices, []);
  presence.receive(heartbeat(), '192.168.1.2');
  presence.receive({ ...heartbeat('editor-a'), deviceKind: 'editor' }, '127.0.0.1');
  time += 19999;
  assert.equal(presence.snapshot().devices[0].online, true);
  time++;
  assert.equal(presence.snapshot().devices[0].online, false);
  assert.equal(presence.snapshot().devices[0].secondsAgo, 20);
  presence.receive(heartbeat(), '192.168.1.3');
  const devices = presence.snapshot().devices;
  assert.equal(devices.length, 2);
  assert.equal(devices[0].online, true);
  assert.equal(devices[0].heartbeatCount, 2);
  assert.equal(devices[0].address, '192.168.1.3');
  assert.equal(devices[0].firstSeen, new Date(100000).toISOString());
  assert.equal(devices[1].deviceKind, 'editor');
  assert.equal(devices[1].online, false);
  assert.deepEqual(createPresence().snapshot().devices, []);
});

test('invalid heartbeats cannot create or refresh online status and memory stays bounded', () => {
  let time = 0;
  const presence = createPresence({ now: () => time });
  for (const invalid of [null, {}, { ...heartbeat(), schemaVersion: 2 }, { ...heartbeat(), clientId: '' }, { ...heartbeat(), label: ' ' }, { ...heartbeat(), deviceKind: 'sample' }]) {
    assert.throws(() => presence.receive(invalid, 'test'));
  }
  assert.equal(presence.snapshot().devices.length, 0);
  for (let index = 0; index < 100; index++) presence.receive(heartbeat(`session-${index}`), 'test');
  assert.throws(() => presence.receive(heartbeat('overflow'), 'test'), /full/);
  time = 20000;
  presence.receive(heartbeat('new-session'), 'test');
  assert.equal(presence.snapshot().devices.length, 100);
  assert.equal(presence.snapshot().devices.filter(device => device.online).length, 1);
});

test('heartbeat endpoint reports presence without increasing sketch counts or accepting invalid bodies', async context => {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, type = 'application/json', origin) => fetch(base + '/api/heartbeat', {
    method: 'POST', headers: { 'Content-Type': type, ...(origin ? { Origin: origin } : {}) }, body
  });
  assert.equal((await post(JSON.stringify(heartbeat()))).status, 200);
  assert.equal((await post(JSON.stringify(heartbeat()))).status, 200);
  assert.equal((await post('{broken')).status, 400);
  assert.equal((await post(JSON.stringify({ ...heartbeat(), schemaVersion: 5 }))).status, 400);
  assert.equal((await post('bad', 'text/plain')).status, 415);
  assert.equal((await post('x'.repeat(4097))).status, 413);
  assert.equal((await post(JSON.stringify(heartbeat('blocked')), 'application/json', 'https://other.example')).status, 403);
  const data = await (await fetch(base + '/api/diagnostics')).json();
  assert.equal(data.presence.devices.length, 1);
  assert.equal(data.presence.devices[0].online, true);
  assert.equal(data.presence.devices[0].heartbeatCount, 2);
  assert.equal(data.counts.attempts, 0);
  assert.equal(data.counts.acceptedHeadset, 0);
  assert.equal(data.counts.rejected, 0);
  assert.deepEqual(await (await fetch(base + '/api/sketches')).json(), []);
});
