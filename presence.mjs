export function createPresence({ now = Date.now, offlineAfterMs = 20000 } = {}) {
  const devices = new Map();
  return {
    receive(payload, address) {
      if (!payload || payload.schemaVersion !== 1) throw new Error('Heartbeat schemaVersion must be 1');
      if (typeof payload.clientId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.clientId)) throw new Error('Heartbeat needs a valid clientId');
      if (typeof payload.label !== 'string' || !payload.label.trim() || payload.label.length > 80) throw new Error('Heartbeat label must be 1–80 characters');
      if (!['headset', 'editor'].includes(payload.deviceKind)) throw new Error('Heartbeat deviceKind must be headset or editor');
      const timestamp = now();
      if (!devices.has(payload.clientId) && devices.size >= 100) {
        const oldestOffline = [...devices.values()].filter(device => timestamp - device.lastSeenMs >= offlineAfterMs).sort((left, right) => left.lastSeenMs - right.lastSeenMs)[0];
        if (!oldestOffline) throw new Error('Heartbeat session is full (100 active devices)');
        devices.delete(oldestOffline.clientId);
      }
      const previous = devices.get(payload.clientId);
      const device = {
        clientId: payload.clientId, label: payload.label.trim(), deviceKind: payload.deviceKind,
        address, firstSeen: previous?.firstSeen ?? new Date(timestamp).toISOString(),
        lastSeen: new Date(timestamp).toISOString(), lastSeenMs: timestamp,
        heartbeatCount: (previous?.heartbeatCount ?? 0) + 1
      };
      devices.set(device.clientId, device);
      return { clientId: device.clientId, offlineAfterMs };
    },
    snapshot() {
      const timestamp = now();
      return {
        offlineAfterMs,
        devices: [...devices.values()].map(({ lastSeenMs, ...device }) => ({
          ...device, secondsAgo: Math.max(0, Math.floor((timestamp - lastSeenMs) / 1000)),
          online: timestamp - lastSeenMs < offlineAfterMs
        }))
      };
    }
  };
}
