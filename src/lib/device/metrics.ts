/**
 * Clinical metrics derived from detected repetitions.
 *
 * Pure functions over DetectedRep[] — no device, no DB, no React — so the same
 * code serves the live tiles, the post-session summary and any offline analysis
 * of a stored run.
 *
 * Note on what is NOT here: this POC measures kinematics only (an IMU plus a
 * motor). The rig drives the full range itself, so there is no patient
 * contribution or assist-as-needed split to report — those are absent rather
 * than estimated.
 */
import type { DetectedRep } from "./types";

/** Normative elbow range used as the reference for ROM completeness. */
export const NORMATIVE_ELBOW_ROM_DEG = 145;

export interface SessionMetrics {
  repCount: number;
  /** best flexion angle across the whole session, degrees */
  maxFlexionDeg: number;
  /** best (smallest) extension angle across the session, degrees */
  maxExtensionDeg: number;
  /** session envelope: maxFlexion - maxExtension */
  totalRomDeg: number;
  meanRomDeg: number;
  sdRomDeg: number;
  /** coefficient of variation of ROM, % */
  cvRomPct: number;
  /** 100 - CV*5, clamped: how repeatable the movement was, 0..100 */
  consistency: number;
  meanDurationMs: number;
  meanQuality: number;
  meanSmoothness: number;
  meanPeakVelocityDegS: number;
  /** OLS slope of ROM against rep index, deg/rep. Negative = fatiguing. */
  fatigueIndexDegPerRep: number;
  /** change from the first 20 reps to the last 20, % of the first */
  romDecayPct: number;
  /** how far the best extension stayed from straight — contracture risk */
  extensionDeficitDeg: number;
  /** ROM as a share of the normative elbow range, % */
  romCompletenessPct: number;
  /** repetitions per minute of active movement */
  cadenceRepsPerMin: number;
  activeTimeMs: number;
  /**
   * Mean share of each repetition the motor drove, %. Null when the firmware
   * reports no motor state — the assist-as-needed split is unmeasured, which
   * must not be rendered as 0% assistance.
   */
  meanAssistPct: number | null;
  /** Mean share the patient covered unaided, %. Null for the same reason. */
  meanPatientRangePct: number | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export const EMPTY_METRICS: SessionMetrics = {
  repCount: 0,
  maxFlexionDeg: 0,
  maxExtensionDeg: 0,
  totalRomDeg: 0,
  meanRomDeg: 0,
  sdRomDeg: 0,
  cvRomPct: 0,
  consistency: 0,
  meanDurationMs: 0,
  meanQuality: 0,
  meanSmoothness: 0,
  meanPeakVelocityDegS: 0,
  fatigueIndexDegPerRep: 0,
  romDecayPct: 0,
  extensionDeficitDeg: 0,
  romCompletenessPct: 0,
  cadenceRepsPerMin: 0,
  activeTimeMs: 0,
  meanAssistPct: null,
  meanPatientRangePct: null,
};

/** Ordinary least-squares slope of y against its index. */
function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xBar = (n - 1) / 2;
  const yBar = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xBar) * (ys[i] - yBar);
    den += (i - xBar) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function summarizeReps(reps: DetectedRep[]): SessionMetrics {
  if (reps.length === 0) return EMPTY_METRICS;

  const roms = reps.map((r) => r.romDeg);
  const durations = reps.map((r) => r.durationMs);
  const meanRom = mean(roms);
  const sdRom = Math.sqrt(mean(roms.map((r) => (r - meanRom) ** 2)));
  const cv = meanRom > 0 ? (sdRom / meanRom) * 100 : 0;

  const maxFlexion = Math.max(...reps.map((r) => r.maxFlexionDeg));
  const maxExtension = Math.min(...reps.map((r) => r.maxExtensionDeg));

  // Fatigue: compare the opening and closing blocks. Uses up to 20 reps a side,
  // and falls back to thirds on short sessions so it still says something.
  const block = Math.min(20, Math.max(1, Math.floor(reps.length / 3)));
  const firstBlock = mean(roms.slice(0, block));
  const lastBlock = mean(roms.slice(-block));
  const decay = firstBlock > 0 ? ((lastBlock - firstBlock) / firstBlock) * 100 : 0;

  const activeTimeMs = durations.reduce((a, b) => a + b, 0);

  // Averaged over the reps that carry a reading, so a session that only starts
  // reporting motor state partway through still reports the part it measured.
  const assists = reps.map((r) => r.assistPct).filter((a): a is number => a !== null);
  const meanAssistPct = assists.length > 0 ? round1(mean(assists)) : null;

  return {
    repCount: reps.length,
    maxFlexionDeg: round1(maxFlexion),
    maxExtensionDeg: round1(maxExtension),
    totalRomDeg: round1(maxFlexion - maxExtension),
    meanRomDeg: round1(meanRom),
    sdRomDeg: round1(sdRom),
    cvRomPct: round1(cv),
    consistency: round1(clamp(100 - cv * 5, 0, 100)),
    meanDurationMs: Math.round(mean(durations)),
    meanQuality: round1(mean(reps.map((r) => r.quality))),
    meanSmoothness: round1(mean(reps.map((r) => r.smoothness))),
    meanPeakVelocityDegS: round1(mean(reps.map((r) => r.peakFlexionVelDegS))),
    fatigueIndexDegPerRep: Math.round(slope(roms) * 1000) / 1000,
    romDecayPct: round1(decay),
    extensionDeficitDeg: round1(Math.max(0, maxExtension)),
    romCompletenessPct: round1(
      clamp(((maxFlexion - maxExtension) / NORMATIVE_ELBOW_ROM_DEG) * 100, 0, 100),
    ),
    cadenceRepsPerMin: activeTimeMs > 0 ? round1(reps.length / (activeTimeMs / 60000)) : 0,
    activeTimeMs,
    meanAssistPct,
    meanPatientRangePct: meanAssistPct === null ? null : round1(100 - meanAssistPct),
  };
}

export type QualityLabel = "Excellent" | "Good" | "Fair" | "Poor";

export function qualityLabel(quality: number): QualityLabel {
  if (quality >= 85) return "Excellent";
  if (quality >= 70) return "Good";
  if (quality >= 55) return "Fair";
  return "Poor";
}

/**
 * Limb Symmetry Index — affected ROM as a percentage of unaffected ROM.
 * Requires the rig to have been run once tagged each way.
 */
export function limbSymmetryIndex(affectedRomDeg: number, unaffectedRomDeg: number): number {
  if (unaffectedRomDeg <= 0) return 0;
  return round1((affectedRomDeg / unaffectedRomDeg) * 100);
}
