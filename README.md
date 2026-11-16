# Sketch-n-Sow · live idea garden

A local companion for the Unity co-located drawing app. Use [Hosted database setup](HOSTED-DATABASE.md) to save drawings to Supabase Postgres and restore the garden after restart. The headset sends the same snapshots to the same computer. No Unity changes are required. Temporary demo mode is still available; the footer identifies the active mode. If drawings are currently in RAM, follow the transfer steps **before stopping the old server**.

## Run the website

Install Node.js 20 or newer. In this folder run:

```powershell
npm install
npm start
```

Open http://localhost:8787 on the computer. The terminal prints network addresses; choose the Wi-Fi/Ethernet address on the headset network. Temporary mode works without internet after installation; hosted database mode needs internet and restores the selected garden on startup. Click **Plant a sample idea** to try a drawing. Select a card to orbit, pan, and zoom. Escape closes the viewer.

The “Live session connected” indicator reports the browser-to-server connection. Headset presence is shown separately in diagnostics. Reconnection refreshes the full collection, including drawings received while the browser was disconnected.

## Unity integration prepared for your project

The source project inspected was `C:\Users\PC\Desktop\speciale-test`, Unity 6000.3.8f1. It has not been modified: this chat has read access but cannot write to that folder. The full replacement `unity/IdeaManager.cs` and its patch now use the newer source pasted into the chat, preserving stylus hold/release placement, seed-holder assignment, NoteSync, and bee movement. Only the website field and capture call are added. The earlier disk-based replacement is superseded.

1. Copy `unity/SketchWebsiteBridge.cs` into the Unity project's `Assets/Scripts/`.
2. Apply `unity/IdeaManager.patch` from the Unity project root (`git apply --check PATH-TO-PATCH`, then `git apply PATH-TO-PATCH`), or make these two edits manually:
   - Add `[SerializeField] private SketchWebsiteBridge websiteBridge;` alongside the fields in `IdeaManager`.
   - Inside `RequestSpawnCubeServerRpc`, immediately after `if (totalPoints > 0) groupCenter /= totalPoints;`, insert:

```csharp
        if (websiteBridge != null)
            websiteBridge.Capture(netObj.NetworkObjectId, lineScripts);
```

3. Add **Sketch Website Bridge** to an active scene GameObject. Assign that component to the new **Website Bridge** reference on the scene's `IdeaManager`. Set **Server Url** to `http://COMPUTER-LAN-IP:8787` (not localhost on a headset). If the manager is instantiated from a prefab, ensure the bridge and reference exist in the instantiated hierarchy.
4. For a development Android build using local HTTP, enable **Allow downloads over HTTP → Development Only** in Player settings and make a Development Build. For non-development builds, the HTTP policy must also allow your endpoint or you must configure HTTPS. The inspected project has `insecureHttpOption: 0`, so this setting currently needs attention. Internet permission is already enabled in the inspected project.
5. Start the local server, open the website, join the normal host/headset session, finish a stroke, and spawn a seed package. Confirm exactly one card appears, including when a remote participant creates the package. Compare its colors, varying widths, and relative stroke positions with the headset. Disconnect the website and reconnect to check that the session remains available.

The capture runs on the Netcode host once, before line reparenting, ownership changes, or package animations. It reads `LineRenderer` positions, resolves local/world transforms, subtracts a common bounding-box center, samples the width curve × width multiplier, and combines the color gradient with `NetworkLine.NetColor`. The browser flips Z for the explicitly tagged Unity convention. Neither the original points nor their transforms are changed. IDs combine a run GUID and the package network ID, so HTTP retries update one card instead of duplicating it.

This targets the current host-client architecture: `NetworkLine` populates its point lists via a ClientRpc, so a dedicated server without a host client is not supported by this integration. Only finished strokes selected by the existing seed-package code are captured. An active stroke is excluded just as it is in the current package logic. Changes made by reopening a package later do not update its original website snapshot. Notes-only packages produce a card with an empty viewer. Notes, ranking, textures, shader effects, and live manipulation are outside this MVP.

Sending is asynchronous, with at most ten queued snapshots and three attempts per snapshot. A failed upload logs a warning and never prevents the seed package from spawning. Snapshots are dropped after retries; there is no durable offline queue. Restarting clears drawings in temporary mode. In cloud mode, accepted drawings remain in the database.

## Adaptable JSON contract

`POST /api/sketches`, `Content-Type: application/json`:

```json
{
  "schemaVersion": 1,
  "id": "session-a-idea-42",
  "title": "Shared garden",
  "coordinates": "unity-left-handed-y-up",
  "strokes": [
    {
      "points": [{"x": 0, "y": 0, "z": 0}, {"x": 0.1, "y": 0.2, "z": 0.05}],
      "color": {"r": 0.2, "g": 0.6, "b": 0.3, "a": 1},
      "widths": [0.005, 0.012],
      "loop": false
    }
  ]
}
```

- Points accept `{x,y,z}` or `[x,y,z]`; use one common coordinate frame for every stroke. The viewer recenters and fits the collection without changing its relative proportions.
- `coordinates` accepts `unity-left-handed-y-up` or `right-handed-y-up` (default). Y is up; width and point distances use the same unit, normally meters in Unity.
- Colors accept `{r,g,b,a}`, RGB/RGBA arrays in 0–1, or `#RRGGBB`. Optional `colors` has one color per point. Values are interpreted as sRGB. Custom HDR/shader color behavior requires an adapter.
- Supply per-point `widths`, or constant `width` (default 0.01). Width means full diameter, not radius. Colors and widths interpolate across mesh segments; Unity curve tangents and shaders are not serialized.
- Strokes are rendered as thin 3D tubes, approximating Unity's camera-facing ribbons. Per-point RGB is supported; alpha is averaged per stroke in this MVP. This is a geometric copy, not a pixel-identical recreation of Unity rendering.
- `id` and `title` are required (1–160 characters); reusing an ID replaces that idea. Empty `strokes` is allowed. Maximum 4 MiB/request, 1,000 strokes/idea, 30,000 points/idea. Larger sessions return an explicit error rather than silently dropping older ideas.
- `GET /api/sketches` returns the in-memory collection. `GET /api/events` streams an initial snapshot and subsequent upserts using Server-Sent Events. No polling or manual refresh is required.

Keep future geometry conversion in the Unity bridge and `schema.mjs`; the website does not depend on the Meta XR or Unity serialization format.

## Network and CORS

### Live diagnostics

**App presence:** replace the Unity `SketchWebsiteBridge.cs` with the current version in `unity/`, then rebuild/install the headset app (or restart Play Mode). `IdeaManager.cs` does not change. Each enabled bridge sends `POST /api/heartbeat` automatically, about every five seconds when requests complete promptly. The bridge must be active on each device; do not restrict the heartbeat component to the Netcode host. Only sketch capture remains host-triggered. Set **Headset Label** to a short name if desired; a temporary session ID distinguishes devices with the same label. IDs are not persisted, so restarting the app creates a new session row.

The panel shows Online, Offline, and last-seen time for each sender. Unity Editor sessions are labelled separately. Twenty seconds without a valid heartbeat marks a sender offline; the page reflects it at the next two-second refresh. Sleep, network interruption, disabling the component, or stopping the app all cause expiry. Contact resumes automatically on subsequent successful heartbeats. If the browser cannot reach the server, presence is shown as Unknown, not falsely live. **Send Heartbeat** controls presence independently of **Send To Website**, which controls drawing uploads.

The bridge logs the first heartbeat success/failure and later status changes in Unity's console. Heartbeats confirm app-to-server reachability, not Netcode membership, device identity, bridge assignment in IdeaManager, or sketch delivery. They do not increment sketch-upload counters. Presence and the last 60 request logs are stored only in RAM. At most 100 app sessions are retained; new sessions replace the oldest offline row if the collection is full.

Open **Headset connection diagnostics** below the idea grid. It refreshes every two seconds and works independently of the 3D viewer. Restarting clears temporary sketches and diagnostic logs but does not clear database-backed drawings.

- **Test website → server** creates a clearly labelled browser test. It confirms only that the website can reach the server.
- Spawn a seed package and look for a new `POST /api/sketches` entry. The log includes time, sender IP, sender-reported source, bytes received, HTTP status, and acceptance details or the actual validation error. Requests are listed on arrival, even before their body is complete. Wrong POST URLs and CORS failures are logged too.
- **Headset-labelled accepted** counts accepted requests containing `source: "headset"`, as sent by the provided Unity bridge. It is not headset presence detection or identity verification. Samples and browser probes do not increment this count. Retries count as separate requests even though they update the same idea.
- **Accepted with 0 points** means Unity reached the server but supplied no drawing geometry. Check finished-line selection in Unity. If there are points but no preview, consult the browser-rendering message in the panel.
- No new upload entry means no HTTP upload reached this server. Check the host's assigned bridge component, its Server Url, HTTP permission in the Android build, and network/firewall settings. The server cannot diagnose traffic blocked before it reaches the process.
- The panel lists candidate LAN addresses for Unity's Server Url. Visiting `http://COMPUTER-LAN-IP:8787/api/health` in the headset browser creates a separate reachability entry. This is an optional troubleshooting step, not a normal connection requirement.

`GET /api/diagnostics` also exposes presence, counters, and the last 60 requests as JSON. Diagnostic history stays in RAM; raw sketch payloads are not copied into the logs. Upload diagnostics work with the earlier Unity bridge; app presence requires the updated bridge described above.

The server binds to `0.0.0.0:8787`. Allow Node/inbound TCP 8787 through Windows Firewall on your private network if prompted. Headsets and the computer must be able to reach one another; guest Wi-Fi, access-point isolation, VPN routing, or different VLANs can block this even when the Wi-Fi names match. Check the network URL in a headset browser before debugging Unity. Do not forward this port publicly: this is an unauthenticated LAN prototype.

Serve the website from this same server so browser requests are same-origin. Native Quest `UnityWebRequest` calls do not use browser CORS. If you later run a browser frontend from another origin, explicitly allow it before starting:

```powershell
$env:ALLOWED_ORIGINS = 'http://localhost:5173,http://192.168.1.20:5173'
npm start
```

Origins include scheme and port; wildcard access is not enabled. Unity WebGL builds are subject to browser CORS and mixed-content rules. An HTTPS webpage cannot simply use an HTTP API; keep this MVP on the local HTTP origin or add HTTPS to both.

## Validation and limits

`npm test` checks the Unity-shaped payload, variable widths, invalid inputs, sample generation, HTTP posting, live SSE delivery, duplicate updates, reconnect snapshots, CORS, and a fresh empty session after restart. Unity compilation and actual headset/network behavior must be checked in the Unity Editor and on your devices after applying the integration.

Delivery verification: the automated receiver tests pass. The updated full IdeaManager replacement was compared with the newly pasted source: removing the website field and capture call reproduces that source, apart from line endings and trailing whitespace at the end of the file. The original patch check against the older on-disk source does not validate this newer version. Unity compilation and headset testing are still pending. Run `npm install` before attempting the website; the 3D dependency is not bundled in this delivery.

Implementation references: [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls), [Unity LineRenderer useWorldSpace](https://docs.unity.com/en-us/engine/6000.3/script-reference/unityengine/linerenderer/useworldspace), [Unity LineRenderer widthMultiplier](https://docs.unity.com/en-us/engine/6000.3/script-reference/unityengine/linerenderer/widthmultiplier).
