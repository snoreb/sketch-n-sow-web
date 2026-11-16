import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SketchViewer } from '../public/viewer.js';

test('rapid input draws once per frame using the latest camera, then stays idle', context => {
  const callbacks = new Map();
  let nextId = 0;
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => {
    const frameId = nextId++;
    callbacks.set(frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = frameId => callbacks.delete(frameId);
  context.after(() => {
    if (originalRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequest;
    if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancel;
  });
  const draws = [];
  let clears = 0;
  let disposals = 0;
  const viewer = Object.assign(Object.create(SketchViewer.prototype), {
    pendingFrame: null,
    scene: { traverse: visit => visit({ geometry: { dispose: () => disposals++ } }) },
    camera: { position: 0 },
    renderer: {
      render: (scene, camera) => draws.push(camera.position),
      clear: () => clears++
    }
  });
  for (let input = 0; input < 100; input++) {
    viewer.camera.position = input;
    viewer.render();
  }
  assert.equal(callbacks.size, 1);
  assert.equal(draws.length, 0);
  const callback = callbacks.get(viewer.pendingFrame);
  callbacks.delete(viewer.pendingFrame);
  callback();
  assert.deepEqual(draws, [99]);
  assert.equal(callbacks.size, 0);
  assert.equal(viewer.pendingFrame, null);
  viewer.render();
  assert.equal(callbacks.size, 1);
  viewer.clear();
  assert.equal(callbacks.size, 0);
  assert.equal(viewer.pendingFrame, null);
  assert.equal(disposals, 1);
  assert.equal(clears, 1);
  viewer.render();
  assert.equal(callbacks.size, 0);
});
