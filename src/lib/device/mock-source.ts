/**
 * Synthetic angle source — a stand-in for the physical POC.
 *
 * This exists so the entire pipeline (detection, metrics, live UI, persistence,
 * session summary) can be built, tested and rehearsed before the hardware is
 * assembled. It satisfies the same AngleSource contract as the real USB port, so
 * swapping the rig in later changes one line and nothing else.
 *
 * It is NOT the Phixo device simulator (src/lib/simulator/engine.ts) — that
 * models a patient's recovery. This models a motor turning a hinge.
 */
import { mulberry32, gaussian, type Rng } from "@/lib/simulator/rng";
import type { AngleSource, AngleSourceHandlers, DeviceSample } from "./types";

export interface TraceOptions {
  /** number of flexion-extension cycles to generate */
  reps?: number;
  /** peak flexion angle, degrees */
  romDeg?: number;
  /** duration of one full cycle, ms */
  periodMs?: number;
  /** pause at full extension between cycles, ms */
  dwellMs?: number;
  /** telemetry rate, Hz */
  rateHz?: number;
  /** angle noise standard deviation, degrees */
  noiseDeg?: number;
  /** ROM lost from first cycle to last, % (mimics mechanical settling) */
  fatiguePct?: number;
  /** 0-based cycle indices where the movement is held at peak flexion */
  stallAt?: number[];
  /** how long a stalled cycle is held at peak, ms */
  stallHoldMs?: number;
  /**
   * Target share of each cycle the motor drives, %. The synthetic patient
   * initiates the movement and stalls partway, at which point the motor takes
   * over — which is what the real rig does.
   *
   * Null (the default) emits no motor field at all, standing in for firmware
   * that predates the 5-field `D,` line so the unmeasured path stays testable.
   */
  assistPct?: number | null;
  seed?: number;
}

const TRACE_DEFAULTS: Required<TraceOptions> = {
  reps: 130,
  romDeg: 125,
  periodMs: 2000,
  dwellMs: 250,
  rateHz: 50,
  noiseDeg: 0.25,
  fatiguePct: 3,
  stallAt: [],
  stallHoldMs: 10000,
  assistPct: null,
  seed: 20260830,
};

/**
 * Build a complete angle trace offline.
 *
 * Each cycle is a raised cosine: 0 -> romDeg -> 0, which is what a crank-driven
 * hinge actually produces. Velocity is emitted as the analytic derivative rather
 * than a numeric difference, matching the real firmware, which reports the gyro
 * reading directly instead of differentiating the angle.
 */
export function generateAngleTrace(options: TraceOptions = {}): DeviceSample[] {
  const opt = { ...TRACE_DEFAULTS, ...options };
  const rng: Rng = mulberry32(opt.seed);
  const dtMs = 1000 / opt.rateHz;
  const stalls = new Set(opt.stallAt);
  const samples: DeviceSample[] = [];
  let t = 0;

  // Where in each cycle the synthetic patient runs out of movement and the motor
  // picks it up. Left off entirely when assistPct is null, so the trace stands in
  // for firmware that does not report motor state.
  const reportsMotor = opt.assistPct !== null;
  const patientShare = reportsMotor
    ? Math.min(1, Math.max(0, 1 - (opt.assistPct as number) / 100))
    : 1;
  const motor = (active: boolean) => (reportsMotor ? { motorActive: active } : {});

  // A second of rest before the motor starts, so the detector has to arm itself
  // from a genuinely idle signal rather than being handed a moving one.
  for (let i = 0; i < opt.rateHz; i++) {
    samples.push({
      t: Math.round(t),
      angle: round2(gaussian(rng) * opt.noiseDeg),
      vel: round2(gaussian(rng) * 1.5),
      ...motor(false),
    });
    t += dtMs;
  }

  for (let rep = 0; rep < opt.reps; rep++) {
    const fatigue = 1 - (opt.fatiguePct / 100) * (rep / Math.max(1, opt.reps - 1));
    const amp = opt.romDeg * fatigue;
    const period = opt.periodMs * (1 + gaussian(rng) * 0.015);
    const steps = Math.round(period / dtMs);
    // A stalled cycle is held at peak flexion partway through — this is the
    // "grab the brace" moment in the demo. It must be rejected, not counted.
    const holdAt = stalls.has(rep) ? Math.round(steps / 2) : -1;

    for (let i = 0; i < steps; i++) {
      const phase = i / steps;
      const angle = (amp / 2) * (1 - Math.cos(2 * Math.PI * phase));
      const vel = (amp / 2) * (2 * Math.PI / (period / 1000)) * Math.sin(2 * Math.PI * phase);
      samples.push({
        t: Math.round(t),
        angle: round2(angle + gaussian(rng) * opt.noiseDeg),
        vel: round2(vel + gaussian(rng) * 2),
        ...motor(phase >= patientShare),
      });
      t += dtMs;

      if (i === holdAt) {
        const holdSteps = Math.round(opt.stallHoldMs / dtMs);
        for (let k = 0; k < holdSteps; k++) {
          samples.push({
            t: Math.round(t),
            angle: round2(angle + gaussian(rng) * opt.noiseDeg),
            vel: round2(gaussian(rng) * 1.5),
            // The brace is being held: the motor is engaged and stalled against
            // the obstruction, which is exactly when assistance is being given.
            ...motor(true),
          });
          t += dtMs;
        }
      }
    }

    const dwellSteps = Math.round(opt.dwellMs / dtMs);
    for (let i = 0; i < dwellSteps; i++) {
      samples.push({
        t: Math.round(t),
        angle: round2(gaussian(rng) * opt.noiseDeg),
        vel: round2(gaussian(rng) * 1.5),
        ...motor(false),
      });
      t += dtMs;
    }
  }

  return samples;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Plays a generated trace back in real time through the AngleSource contract,
 * so the live UI behaves exactly as it will with the rig attached.
 */
export function createMockSource(options: TraceOptions = {}): AngleSource {
  const rateHz = options.rateHz ?? TRACE_DEFAULTS.rateHz;
  let timer: ReturnType<typeof setInterval> | null = null;
  let cursor = 0;
  let trace: DeviceSample[] = [];
  let handlers: AngleSourceHandlers | null = null;

  const stop = async () => {
    if (timer) clearInterval(timer);
    timer = null;
    handlers?.onStatus({ connected: false, signal: "lost" });
  };

  return {
    mode: "simulation",

    async start(h: AngleSourceHandlers) {
      handlers = h;
      trace = generateAngleTrace(options);
      cursor = 0;
      h.onStatus({
        connected: true,
        signal: "stable",
        mode: "simulation",
        rateHz,
        error: null,
      });

      // Deliver in 100 ms slices — one setInterval tick per slice rather than
      // one per sample, which keeps the timer honest at 50 Hz.
      const perTick = Math.max(1, Math.round(rateHz / 10));
      timer = setInterval(() => {
        if (cursor >= trace.length) {
          void stop();
          return;
        }
        for (let i = 0; i < perTick && cursor < trace.length; i++, cursor++) {
          h.onSample(trace[cursor]);
        }
      }, 100);
    },

    async send() {
      // Nothing to do: the mock generates an already-zeroed trace, and the
      // remaining commands only start and stop a stream it drives itself.
    },

    stop,
  };
}
