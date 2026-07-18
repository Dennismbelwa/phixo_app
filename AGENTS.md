<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Phixo Companion Platform (POC)

Demo web app for the Phixo bedside stroke-rehab device (MBA Healthcare Innovation practicum).
No physical device exists — `src/lib/simulator/engine.ts` generates all EMG/force/AAN data
and is shared by the seed script (`src/db/seed.ts`) and the live browser session player.

- Data: SQLite (`phixo.db`, gitignored) via Drizzle + better-sqlite3; schema/DDL in `src/db/`.
  DB auto-seeds on first launch; `npm run seed` regenerates the demo ward (delete `phixo.db*` first
  and restart the dev server, which holds an open handle).
- Routes: `/patient/[id]` + `/patient/[id]/session` (bedside, tablet-first) and `/dashboard[/...]`
  (therapist). Server actions in `src/lib/actions.ts`; read queries in `src/lib/data.ts` (server-only).
- Chart colors are dataviz-validated palettes defined as `--chart-*` in `src/app/globals.css` —
  don't swap them for arbitrary hues.
- All patient data is simulated; keep the "demo / not for clinical use" disclaimers.
