# Save Sketch-n-Sow drawings in a hosted database

The headset still sends to the same computer on the same LAN. The computer writes each validated drawing to your Supabase Postgres project before confirming the upload and broadcasting an idea card. No Unity changes, headset rebuild, or new npm packages are required. The hosting PC needs internet access in this mode.

**If a session is still running with drawings you want to keep, leave its terminal open until step 4.** Stopping the old memory-only server first loses those drawings.

1. Create a dedicated project at [Supabase](https://supabase.com/dashboard). Choose a region appropriate for your research data. Use an organization on the Free plan if its [quotas](https://supabase.com/docs/guides/platform/billing-on-supabase) fit. No database or account is provisioned by this code.
2. In the project's **SQL Editor**, paste and run the entire contents of [database/setup.sql](database/setup.sql). It creates the drawings table and restricts direct access to the server role. Leave row-level security enabled. The project's Data API must be enabled with the public schema exposed.
3. In a **second PowerShell window**, open the website folder (the one containing package.json). Copy the example only if you do not already have a configuration:

   ```powershell
   if (!(Test-Path .env)) { Copy-Item .env.example .env }
   notepad .env
   ```

   Enter your **Project URL** from Supabase's Connect dialog, and a **server secret key** from Project Settings → API Keys (starts with `sb_secret_`). Use a simple garden name such as `thesis-pilot`. Save the file as exactly `.env`, not `.env.txt`. Do not share or commit this file; do not put its key in Unity, browser JavaScript, a screenshot or chat. Use a dedicated Supabase project because this key has elevated privileges.

4. **Only if you want to transfer the old session:** pause drawing, leave the old server running, and run `npm run save:live` in the second window. Wait for “Saved N live drawings”, and verify the rows in Supabase's Table Editor. Retrying does not duplicate IDs. If the transfer fails, keep the old server running. It cannot recover a session that was already stopped.
5. Stop the old server with **Ctrl+C**. From the website folder run **`npm run start:cloud`** (Node 20.6+). The startup message shows the garden name and restored drawing count. Open the same website as before; its footer should say **Hosted database**. Plain `npm start` without database settings in the environment still runs the temporary demo.
6. **Check it for real:** plant a sample, confirm its row in Supabase's Table Editor, stop the server, and start it again with the same cloud command and garden name. The card should still open with the same shapes, widths and colors. Then save one headset drawing. Samples are stored too, identified by `source: sample`.

## What is stored

One row per garden and idea ID. The JSON contains the complete normalized drawing, its title, source, original coordinate convention, widths, colors and geometry. Creation time is retained on retry. The same ID updates the existing row. The on-screen garden is restored from the database on startup; it is not a backup of sketches that never reached the server. Heartbeats, device IPs, browser diagnostics and logs are not archived.

Keep **one running writer per garden**. For a new research session, stop the server, change GARDEN_ID, and restart with the cloud command. The old garden remains in the database; switching back restores it. Each displayed garden retains the existing 100-idea / 150,000-point limits. The database can hold multiple gardens.

If the database is unavailable at startup, cloud mode does not start an empty temporary session. If a save cannot be confirmed, the upload returns 503 and the website does not announce success. The existing Unity bridge retries briefly, but is not an offline recorder. Don't start collecting if the cloud save test fails.

## Vercel later

The LAN site works with the hosted database as soon as configured. No website has been published. Vercel [Hobby](https://vercel.com/docs/plans/hobby) offers free hosting for eligible personal, non-commercial projects; its quotas and the database provider's quotas are separate.

A useful next deployment is a **read-only, access-controlled gallery** on Vercel reading the same garden through server-side functions. The headset and diagnostics can stay on the LAN. Choose who may see participant drawings before publishing. If the entire receiver moves online instead, add authenticated writes, move presence and cross-instance updates out of process memory, and paginate large sketch responses to respect [function limits](https://vercel.com/docs/functions/limitations). Do not deploy the current unauthenticated LAN receiver unchanged or expose its secret to the frontend.
