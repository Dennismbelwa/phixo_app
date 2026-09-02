<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Phixo Companion Platform (POC)

Demo web app for the Phixo bedside stroke-rehab device (MBA Healthcare Innovation practicum).
The simulator in `src/lib/simulator/engine.ts` generates all IMU/range/AAN data
and is shared by the seed script (`src/db/seed.ts`) and the live browser session player.

- Data: SQLite (`phixo.db`, gitignored) via Drizzle + better-sqlite3; schema/DDL in `src/db/`.
  DB auto-seeds on first launch; `npm run seed` regenerates the demo ward (delete `phixo.db*` first
  and restart the dev server, which holds an open handle).
- Routes: `/patient/[id]` + `/patient/[id]/session` (bedside, tablet-first) and `/dashboard[/...]`
  (therapist). Server actions in `src/lib/actions.ts`; read queries in `src/lib/data.ts` (server-only).
- Chart colors are dataviz-validated palettes defined as `--chart-*` in `src/app/globals.css` —
  don't swap them for arbitrary hues.
- All patient data is simulated; keep the "demo / not for clinical use" disclaimers.

## Physical POC (real IMU device)

A motorised elbow brace with an MPU-9250/6500 on an Arduino UNO R4 WiFi, plugged in
over USB. Firmware in `hardware/` (see `hardware/README.md` for wiring, protocol and
the presentation checklist).

- Transport is the **Web Serial API** — Chromium only, no network, no API routes.
  `src/lib/device/serial.ts` is the only place that touches `navigator.serial`.
- `src/lib/device/rep-detector.ts` and `metrics.ts` are **pure**; keep them that way
  so `npm run device:mock` can verify repetition detection with no browser or hardware.
- Sources implement `AngleSource` (`serial`, `mock`, and a stored-session replay), so
  the UI never binds to a transport. Build and test against `mock-source.ts`.
- Route `/patient/[id]/live` is real-sensor mode; `/patient/[id]/session` remains the
  untouched simulator. Do not merge them — the simulator is the presentation fallback.
- Live plotting is **canvas** (50 Hz); post-session review is Recharts.
- The device senses movement with an IMU — there is no EMG or force sensing anywhere in
  the product. Effort is expressed as `patientRangePct` (share of the range covered
  unaided) and `initiationVelDegS`, never as torque.
- The rig is patient-led: the firmware engages the motor only once the patient stops
  moving, and reports that as `motorActive` on the `D,` line. `assistPct` is therefore
  **measured** — the share of a rep the motor drove — not estimated. `initiationVelDegS`
  stays 0; an IMU cannot sense intent.
- Firmware without `motorActive` leaves assist unmeasured. The rep columns are NOT NULL
  so such sessions still store 0, and `sessions.assistMeasured` is what distinguishes
  "unmeasured" from "needed no help". Never render an unmeasured session as 0%.
- The board is zeroed at the extension end-stop via `Z` on connect, so device angles are
  clinical: 0° = full extension. Absolute metrics (MAX FLEXION/EXTENSION, EXTENSION
  DEFICIT) depend on that zero; ROM, cadence and consistency are differences and do not.
