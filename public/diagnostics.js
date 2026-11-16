const status = document.querySelector('#debug-status');
const entries = document.querySelector('#debug-entries');
const refreshButton = document.querySelector('#debug-refresh');
const testButton = document.querySelector('#debug-test');
const feedback = document.querySelector('#debug-feedback');
const addresses = document.querySelector('#debug-addresses');
let loading = false;
let addressKey = '';

function render(data) {
  document.querySelector('#storage-mode').textContent = data.storage?.mode === 'hosted'
    ? `Hosted database · ${data.storage.garden} · accepted drawings survive restarts`
    : 'Temporary memory · restarting the server clears drawings';
  const presenceList = document.querySelector('#presence-devices');
  const presenceSummary = document.querySelector('#presence-summary');
  presenceList.replaceChildren();
  if (!data.presence) {
    presenceSummary.textContent = 'Restart npm start to enable the heartbeat endpoint.';
  } else {
    const devices = data.presence.devices;
    const onlineHeadsets = devices.filter(device => device.online && device.deviceKind === 'headset').length;
    const onlineEditors = devices.filter(device => device.online && device.deviceKind === 'editor').length;
    presenceSummary.textContent = devices.length ? `${onlineHeadsets} headset app(s) online · ${onlineEditors} Unity Editor(s) online` : 'No app heartbeat received yet. Start the app with the updated, enabled Sketch Website Bridge.';
    for (const device of devices) {
      const item = document.createElement('li');
      item.dataset.state = device.online ? 'online' : 'offline';
      const title = document.createElement('strong');
      title.textContent = `${device.label} · ${device.deviceKind === 'editor' ? 'Unity Editor' : 'Headset'} · ${device.online ? 'Online' : 'Offline'}`;
      const detail = document.createElement('small');
      detail.textContent = `Last seen ${device.secondsAgo}s ago (${new Date(device.lastSeen).toLocaleTimeString()}) · ${device.address} · session ${device.clientId.slice(0, 8)} · ${device.heartbeatCount} heartbeats`;
      item.append(title, detail);
      presenceList.append(item);
    }
  }
  document.querySelector('#debug-attempts').textContent = data.counts.attempts;
  document.querySelector('#debug-headset').textContent = data.counts.acceptedHeadset;
  document.querySelector('#debug-samples').textContent = data.counts.acceptedSample;
  document.querySelector('#debug-rejected').textContent = data.counts.rejected;
  status.textContent = `Server reachable · checked ${new Date().toLocaleTimeString()} · ${data.counts.pending} requests waiting for completion`;
  status.dataset.state = 'online';
  document.querySelector('#debug-session').textContent = `Server started ${new Date(data.startedAt).toLocaleString()}. Last 60 requests shown; counts include retries. Logs are in memory only.`;
  const nextAddressKey = JSON.stringify(data.networkUrls);
  if (nextAddressKey !== addressKey) {
    addresses.replaceChildren();
    for (const url of data.networkUrls) {
      const item = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = url;
      item.append(code);
      addresses.append(item);
    }
    if (!data.networkUrls.length) addresses.textContent = 'No LAN address detected. Check the computer’s Wi-Fi connection.';
    addressKey = nextAddressKey;
  }
  entries.replaceChildren();
  if (!data.entries.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No incoming upload or connection-test requests since this server started.';
    entries.append(empty);
  }
  for (const entry of data.entries) {
    const item = document.createElement('li');
    item.dataset.state = entry.status === null ? 'pending' : entry.status >= 400 ? 'error' : 'success';
    const heading = document.createElement('strong');
    heading.textContent = `${new Date(entry.time).toLocaleTimeString()} · ${entry.method} ${entry.path} · ${entry.status === null ? 'Receiving…' : `HTTP ${entry.status}`}`;
    const description = document.createElement('p');
    description.textContent = entry.message;
    const details = document.createElement('small');
    details.textContent = `From ${entry.address} · source: ${entry.source} · ${entry.bytes.toLocaleString()} bytes${entry.durationMs == null ? '' : ` · ${entry.durationMs} ms`}${entry.ideaId ? ` · idea ${entry.ideaId}` : ''}${entry.userAgent ? ` · ${entry.userAgent}` : ''}`;
    item.append(heading, description, details);
    entries.append(item);
  }
}

async function refresh() {
  if (loading) return;
  loading = true;
  refreshButton.disabled = true;
  try {
    const response = await fetch('/api/diagnostics', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(response.status === 404 ? 'Restart npm start to load the new diagnostics endpoint.' : `HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    status.textContent = `Cannot read server diagnostics: ${error.message}. Displayed counts may be out of date.`;
    status.dataset.state = 'offline';
    document.querySelector('#presence-summary').textContent = 'Headset status unknown: this browser cannot read the server. Last-seen details may be stale.';
    for (const item of document.querySelectorAll('#presence-devices li')) {
      item.dataset.state = 'unknown';
      const title = item.querySelector('strong');
      title.textContent = title.textContent.replace(/ · (Online|Offline|Unknown)$/, ' · Unknown');
    }
  } finally {
    loading = false;
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', refresh);
testButton.addEventListener('click', async () => {
  testButton.disabled = true;
  try {
    const response = await fetch('/api/diagnostics/probe', { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    feedback.textContent = 'Website test reached the server. Now spawn a seed package and watch for a separate POST /api/sketches entry.';
    await refresh();
  } catch (error) { feedback.textContent = `Website test failed: ${error.message}`; }
  finally { testButton.disabled = false; }
});
window.addEventListener('error', event => {
  document.querySelector('#debug-viewer').textContent = `Browser error: ${event.message || 'A page resource could not load.'}`;
}, true);
window.addEventListener('unhandledrejection', event => {
  document.querySelector('#debug-viewer').textContent = `Browser error: ${event.reason?.message ?? String(event.reason)}`;
});
window.addEventListener('sketch-viewer-status', event => {
  document.querySelector('#debug-viewer').textContent = event.detail;
});
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
