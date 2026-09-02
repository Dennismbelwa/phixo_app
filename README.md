# Phixo Companion Platform — Proof of Concept

Software companion for **Phixo**, a bedside, sensor-triggered assist-as-needed (AAN)
rehabilitation device for acute stroke patients in the Day 1–7 neuroplastic window
(MBA in Healthcare Innovation practicum, Group 7).

**The unmet need:** acute-ward stroke patients receive ~15 assisted repetitions per day,
against the NICE 2023 guideline of 300–400. This app demonstrates how Phixo's companion
software closes that gap. A built-in simulator generates realistic IMU / range / AAN
data, and a physical proof-of-concept rig streams real measured elbow angle over USB
(see `hardware/`).

## What's inside

- **Patient bedside mode** (`/patient`) — tablet-friendly guided sessions with a live
  elbow-angle trace, patient-driven range vs. device-assistance split, rep counter,
  daily goal ring, milestones, and safety-guardrail auto-pause. Demo speed controls
  (1×/4×/10×).
- **Real-sensor mode** (`/patient/[id]/live`) — the same session driven by the physical
  POC: an MPU-9250/6500 on an Arduino UNO R4 WiFi, read directly over USB via the Web
  Serial API. Repetitions are detected from the angle signal, not assumed.
- **Therapist dashboard** (`/dashboard`) — triage-ordered ward roster (1 therapist :
  many patients), per-patient recovery charts (assistance falling as the patient covers
  more of the range unaided), protocol editor, safety-alert review, and a print-ready
  summary report.
- **Ward data warehouse** (`/dashboard/analytics`) — the compounding-data story:
  repetitions and sensor data points captured, therapist time multiplied, ward-level
  recovery curve, and the roadmap (AI Companion, Research Open API).
- **Device simulator** (`src/lib/simulator/`) — models the five-step Phixo loop
  (intent detection → processing → deficit calculation → assist-as-needed → log &
  adapt) with per-patient impairment profiles, day-over-day recovery, in-session
  fatigue, and spasticity guardrail events. The same engine seeds the demo ward and
  powers live sessions in the browser.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

A SQLite database (`phixo.db`) is created and seeded automatically on first launch with
six simulated patients across Days 1–7. To regenerate the demo ward:

```bash
rm -f phixo.db* && npm run seed
```

**Suggested demo flow:** open the dashboard to show the ward → open *Avi Goldman*
(Day 1, fresh admission) in bedside mode → run a live session at 10× → return to the
dashboard to show his reps and recovery data flowing in → open a summary report.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS + shadcn/ui · Recharts ·
Drizzle ORM + better-sqlite3.

> Proof of concept — all patient data is simulated. Not for clinical use.
