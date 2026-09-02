/**
 * Phixo device simulator.
 *
 * Models the five-step Phixo loop from the Solution Description:
 *   1. Motion detection    — the IMU senses movement onset, direction and speed
 *   2. Intent estimation   — how far and how fast the patient moves unaided
 *   3. Deficit calculation — the share of the range the patient could not cover
 *   4. Assist-as-needed    — the motor completes exactly the missing range
 *   5. Logging & adaptation — every rep logged; thresholds adapt to recovery/fatigue
 *
 * Everything modelled here is derivable from a single IMU on the limb. The device
 * has no EMG or force sensing, so effort is expressed as movement — how much of
 * the range the patient covers on their own — rather than as torque.
 *
 * Pure TypeScript, isomorphic: the seed script uses it to generate history on the
 * server, and the live bedside session runs the same engine in the browser.
 */
import { Rng, mulberry32, hashSeed, gaussian, clamp } from "./rng";

export interface ImpairmentProfile {
  /** 0 = flaccid/no voluntary movement, 1 = near-normal strength */
  baselineCapacity: number;
  /** capacity gained per acute day of high-repetition therapy (linear-ish) */
  recoveryRate: number;
  /** how quickly movement output degrades within a session (0..1, higher = tires faster) */
  fatigueRate: number;
  /** probability of a spasticity / abnormal-resistance event per rep */
  spasticityRisk: number;
}

export interface SimulatedRep {
  /** milliseconds since session start */
  tMs: number;
  /** peak angular velocity the patient generated before assistance engaged, deg/s */
  initiationVelDegS: number;
  /** share of the range the patient covered unaided, 0..100 */
  patientRangePct: number;
  /** share of the range completed by the motor, 0..100 (= 100 - patientRangePct + smoothing) */
  assistPct: number;
  /** movement quality score 0..100 (smoothness, trajectory, controlled speed) */
  quality: number;
  /** achieved range of motion as % of the exercise's full ROM */
  romPct: number;
  /** duration of this repetition in ms */
  durationMs: number;
  /** safety event triggered during this rep, if any */
  safetyEvent: SafetyEventType | null;
}

export type SafetyEventType = "spasticity" | "abnormal_resistance" | "pain_reflex";

export const SAFETY_EVENT_LABELS: Record<SafetyEventType, string> = {
  spasticity: "Spasticity detected",
  abnormal_resistance: "Abnormal resistance",
  pain_reflex: "Pain reflex response",
};

export const EXERCISES = [
  { id: "elbow_flex", name: "Elbow flexion / extension", limb: "Upper limb" },
  { id: "shoulder_abd", name: "Shoulder abduction", limb: "Upper limb" },
  { id: "wrist_ext", name: "Wrist extension", limb: "Upper limb" },
  { id: "knee_flex", name: "Knee flexion / extension", limb: "Lower limb" },
  { id: "ankle_dorsi", name: "Ankle dorsiflexion", limb: "Lower limb" },
] as const;

export type ExerciseId = (typeof EXERCISES)[number]["id"];

export function exerciseName(id: string): string {
  return EXERCISES.find((e) => e.id === id)?.name ?? id;
}

/**
 * Effective capacity for a given acute day, before within-session fatigue.
 * Recovery compounds day over day — this produces the falling assistance
 * curve that is Phixo's key clinical signal.
 */
export function capacityOnDay(profile: ImpairmentProfile, dayIndex: number): number {
  return clamp(profile.baselineCapacity + profile.recoveryRate * dayIndex, 0.02, 0.95);
}

export interface RepStreamOptions {
  profile: ImpairmentProfile;
  /** 0-based acute day index (day 1 post-stroke = 0) */
  dayIndex: number;
  seed: number;
  /** AAN ceiling set by the therapist protocol, 0..100 */
  maxAssistPct?: number;
}

/** Stateful generator producing one rep at a time, with fatigue accumulation. */
export function createRepStream(opts: RepStreamOptions) {
  const { profile, dayIndex } = opts;
  const rng: Rng = mulberry32(opts.seed);
  const maxAssist = opts.maxAssistPct ?? 100;
  const dayCapacity = capacityOnDay(profile, dayIndex);
  let repIndex = 0;
  let tMs = 0;

  function next(): SimulatedRep {
    // Within-session fatigue: capacity decays with rep count, floors at 45% of fresh.
    const fatigue = Math.max(0.45, 1 - profile.fatigueRate * (repIndex / 100));
    const effCapacity = dayCapacity * fatigue;

    // 1-2. Intent: how briskly the patient starts the movement. A flaccid limb
    // initiates at a few deg/s, a near-normal one at well over 100.
    const initiationVelDegS = clamp(effCapacity * 130 * (0.9 + gaussian(rng) * 0.18) + 4, 2, 140);

    // 3. Deficit: how much of the range the patient covers before the motor helps.
    const patientRangePct = clamp(effCapacity * 100 * (0.85 + gaussian(rng) * 0.2), 1, 95);

    // 4. AAN: complete exactly the missing range, capped by the protocol.
    const assistPct = clamp(100 - patientRangePct, 5, maxAssist);

    // Quality improves with capacity and good assist coverage; noisy.
    const coverage = clamp((patientRangePct + assistPct) / 100, 0, 1.05);
    const quality = clamp(
      55 + effCapacity * 35 + coverage * 12 + gaussian(rng) * 6,
      30,
      99
    );
    const romPct = clamp(70 + coverage * 25 + gaussian(rng) * 5, 40, 100);

    // Reps get slightly quicker as capacity rises (less struggle per rep).
    const durationMs = Math.round(clamp(5200 - effCapacity * 2200 + gaussian(rng) * 400, 2400, 7000));

    // Safety guardrails: risk rises with fatigue.
    let safetyEvent: SafetyEventType | null = null;
    const risk = profile.spasticityRisk * (fatigue < 0.7 ? 1.8 : 1);
    if (rng() < risk) {
      const roll = rng();
      safetyEvent = roll < 0.5 ? "spasticity" : roll < 0.8 ? "abnormal_resistance" : "pain_reflex";
    }

    tMs += durationMs + Math.round(800 + rng() * 900); // rest between reps
    repIndex += 1;

    return {
      tMs,
      initiationVelDegS: round1(initiationVelDegS),
      patientRangePct: round1(patientRangePct),
      assistPct: round1(assistPct),
      quality: round1(quality),
      romPct: round1(romPct),
      durationMs,
      safetyEvent,
    };
  }

  return { next };
}

export interface SessionSummary {
  repCount: number;
  avgPatientRangePct: number;
  avgAssistPct: number;
  avgQuality: number;
  avgRomPct: number;
  safetyEvents: { type: SafetyEventType; atMs: number }[];
  durationMs: number;
  reps: SimulatedRep[];
}

/** Generate a whole historical session at once (used by the seed script). */
export function simulateSession(
  opts: RepStreamOptions & { targetReps: number }
): SessionSummary {
  const stream = createRepStream(opts);
  const reps: SimulatedRep[] = [];
  const safetyEvents: { type: SafetyEventType; atMs: number }[] = [];
  for (let i = 0; i < opts.targetReps; i++) {
    const rep = stream.next();
    reps.push(rep);
    if (rep.safetyEvent) {
      safetyEvents.push({ type: rep.safetyEvent, atMs: rep.tMs });
      // Guardrail auto-pause: a safety event ends the block early sometimes.
      if (safetyEvents.length >= 3) break;
    }
  }
  const n = reps.length;
  const avg = (f: (r: SimulatedRep) => number) =>
    n === 0 ? 0 : round1(reps.reduce((s, r) => s + f(r), 0) / n);
  return {
    repCount: n,
    avgPatientRangePct: avg((r) => r.patientRangePct),
    avgAssistPct: avg((r) => r.assistPct),
    avgQuality: avg((r) => r.quality),
    avgRomPct: avg((r) => r.romPct),
    safetyEvents,
    durationMs: n > 0 ? reps[n - 1].tMs : 0,
    reps,
  };
}

/** Normative elbow range, used to turn a ROM percentage into degrees. */
export const NORMATIVE_ELBOW_ROM_DEG = 145;

/**
 * Simulated elbow angle for the live session visual, in degrees.
 *
 * A raised cosine over the rep: 0 deg at rest, peak flexion at mid-rep, back to
 * rest — the same shape a real crank-driven hinge produces, so the simulated
 * bedside trace and the physical POC trace look alike.
 *
 * phase: 0..1 through the current rep cycle. romPct: 0..100 of full range.
 */
export function angleSample(phase: number, romPct: number, t: number): number {
  const peak = (romPct / 100) * NORMATIVE_ELBOW_ROM_DEG;
  const angle = (peak / 2) * (1 - Math.cos(2 * Math.PI * clamp(phase, 0, 1)));
  // A little tremor so the trace reads as a live measurement, not a drawn curve.
  const tremor = Math.sin(t * 37.1) * 0.5 + Math.sin(t * 91.7 + 1.3) * 0.3;
  return Math.max(0, angle + tremor);
}

/** Angular velocity matching angleSample, deg/s — the analytic derivative. */
export function angleVelocity(phase: number, romPct: number, durationMs: number): number {
  const peak = (romPct / 100) * NORMATIVE_ELBOW_ROM_DEG;
  const periodS = Math.max(0.1, durationMs / 1000);
  return (peak / 2) * ((2 * Math.PI) / periodS) * Math.sin(2 * Math.PI * clamp(phase, 0, 1));
}

export function seedForSession(patientId: string, dayIndex: number, sessionOfDay: number): number {
  return hashSeed("phixo", patientId, dayIndex, sessionOfDay);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
