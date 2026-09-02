/**
 * Repetition detector for the physical POC.
 *
 * The presentation requirement is that Phixo *recognises* each flexion-extension
 * cycle from the angle signal rather than assuming 130 happened. This is a pure,
 * stateful-by-closure function so it can be unit-tested headlessly and re-run
 * over stored samples without touching the device.
 *
 * Approach: an adaptive Schmitt trigger over the elbow angle.
 *
 *   - A decaying min/max envelope tracks the movement range, so nothing is
 *     hard-coded to one rig's amplitude and the detector survives drift.
 *   - A repetition is bounded by consecutive *rising* threshold crossings. That
 *     boundary needs no lookahead, and each segment provably contains exactly
 *     one flexion peak and one extension trough — so peak and trough are found
 *     with a plain max/min over the buffered segment.
 *   - Three independent gates reject anything that is not a real repetition:
 *     amplitude arming (noise, tremor, an idle rig), hysteresis (chatter around
 *     a single threshold) and a duration window (double-counts, stalled cycles).
 */
import type { DetectedRep, DeviceSample, RejectReason } from "./types";

export interface RepDetectorOptions {
  /** a cycle smaller than this is not a repetition, degrees */
  minRomDeg?: number;
  /** faster than this is noise or a double-count, ms */
  minRepMs?: number;
  /** slower than this is a stall or an abandoned cycle, ms */
  maxRepMs?: number;
  /** ROM that scores 100 on the quality metric, degrees */
  targetRomDeg?: number;
  /** Schmitt threshold as a fraction of the current amplitude */
  hysteresis?: number;
  /** how fast the envelope forgets, deg/s */
  envelopeDecayDegPerS?: number;
  /** velocity below this magnitude does not count as a direction, deg/s */
  velocityDeadbandDegS?: number;
}

export interface Rejection {
  tMs: number;
  reason: RejectReason;
  durationMs: number;
  romDeg: number;
}

export interface DetectorState {
  /** true once the movement range is large enough to be a real exercise */
  armed: boolean;
  amplitudeDeg: number;
  loDeg: number;
  hiDeg: number;
  count: number;
  rejected: number;
}

export interface RepDetector {
  /** Feed one sample. Returns a rep at the moment one is completed, else null. */
  push(s: DeviceSample): DetectedRep | null;
  /**
   * Emit the final buffered cycle. The rising-to-rising boundary means the last
   * cycle of a run is still pending when the movement stops — call this when the
   * session ends so a 130-cycle run reports 130 reps, not 129.
   */
  flush(): DetectedRep | null;
  readonly state: DetectorState;
  readonly rejections: Rejection[];
}

const DEFAULTS: Required<RepDetectorOptions> = {
  minRomDeg: 20,
  minRepMs: 600,
  maxRepMs: 8000,
  targetRomDeg: 120,
  hysteresis: 0.25,
  envelopeDecayDegPerS: 2,
  velocityDeadbandDegS: 10,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function createRepDetector(options: RepDetectorOptions = {}): RepDetector {
  const opt = { ...DEFAULTS, ...options };

  let hi = Number.NaN;
  let lo = Number.NaN;
  let lastT = Number.NaN;
  /** Schmitt state: are we currently above the upper threshold? */
  let above = false;
  let started = false;

  /** samples since the last rising crossing — the pending repetition */
  let segment: DeviceSample[] = [];
  let segmentOpen = false;

  let count = 0;
  const durations: number[] = [];
  const rejections: Rejection[] = [];

  const state: DetectorState = {
    armed: false,
    amplitudeDeg: 0,
    loDeg: 0,
    hiDeg: 0,
    count: 0,
    rejected: 0,
  };

  function medianDuration(): number {
    if (durations.length === 0) return 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** Count direction reversals, ignoring anything inside the velocity deadband. */
  function directionChanges(seg: DeviceSample[]): number {
    let dir = 0;
    let changes = 0;
    for (const s of seg) {
      if (Math.abs(s.vel) < opt.velocityDeadbandDegS) continue;
      const d = s.vel > 0 ? 1 : -1;
      if (dir !== 0 && d !== dir) changes++;
      dir = d;
    }
    return changes;
  }

  /** Validate the buffered segment and turn it into a rep, or record a rejection. */
  function commit(seg: DeviceSample[]): DetectedRep | null {
    if (seg.length < 3) return null;

    const durationMs = seg[seg.length - 1].t - seg[0].t;
    let maxFlexionDeg = -Infinity;
    let maxExtensionDeg = Infinity;
    let peakFlexionVelDegS = 0;
    let peakExtensionVelDegS = 0;

    for (const s of seg) {
      if (s.angle > maxFlexionDeg) maxFlexionDeg = s.angle;
      if (s.angle < maxExtensionDeg) maxExtensionDeg = s.angle;
      if (s.vel > peakFlexionVelDegS) peakFlexionVelDegS = s.vel;
      if (s.vel < peakExtensionVelDegS) peakExtensionVelDegS = s.vel;
    }
    const romDeg = maxFlexionDeg - maxExtensionDeg;

    const reason: RejectReason | null =
      durationMs < opt.minRepMs
        ? "too_short"
        : durationMs > opt.maxRepMs
          ? "too_long"
          : romDeg < opt.minRomDeg
            ? "rom_too_small"
            : null;

    if (reason) {
      rejections.push({
        tMs: seg[seg.length - 1].t,
        reason,
        durationMs,
        romDeg: round1(romDeg),
      });
      state.rejected = rejections.length;
      return null;
    }

    // Assistance is the share of the cycle the motor drove. The firmware knows
    // this directly — it is the one that engaged the motor — so it is measured,
    // not inferred from the angle trace. Firmware that does not report motor
    // state leaves it null: unmeasured, which is not the same as zero.
    const reported = seg.filter((s) => s.motorActive !== undefined);
    const assistPct =
      reported.length > 0
        ? round1((reported.filter((s) => s.motorActive).length / reported.length) * 100)
        : null;

    durations.push(durationMs);
    const median = medianDuration();
    const smoothness = clamp(100 - 20 * (directionChanges(seg) - 2), 0, 100);
    const romScore = clamp((romDeg / opt.targetRomDeg) * 100, 0, 100);
    const tempoScore =
      median > 0
        ? 100 - Math.min(100, (Math.abs(durationMs - median) / median) * 100)
        : 100;

    count++;
    state.count = count;

    return {
      index: count,
      tMs: seg[seg.length - 1].t,
      durationMs,
      maxFlexionDeg: round1(maxFlexionDeg),
      maxExtensionDeg: round1(maxExtensionDeg),
      romDeg: round1(romDeg),
      peakFlexionVelDegS: round1(peakFlexionVelDegS),
      peakExtensionVelDegS: round1(Math.abs(peakExtensionVelDegS)),
      smoothness: round1(smoothness),
      quality: round1(0.5 * romScore + 0.2 * tempoScore + 0.3 * smoothness),
      assistPct,
      patientRangePct: assistPct === null ? null : round1(100 - assistPct),
    };
  }

  return {
    state,
    rejections,

    push(s: DeviceSample): DetectedRep | null {
      if (!started) {
        hi = s.angle;
        lo = s.angle;
        lastT = s.t;
        started = true;
        return null;
      }

      // Envelope: expands instantly to new extremes, forgets slowly. The decay is
      // what lets an idle rig fall below the arming threshold instead of holding
      // a stale range from ten minutes ago.
      const dt = (s.t - lastT) / 1000;
      lastT = s.t;
      if (dt > 0) {
        const decay = opt.envelopeDecayDegPerS * dt;
        hi = Math.max(s.angle, hi - decay);
        lo = Math.min(s.angle, lo + decay);
      } else {
        hi = Math.max(s.angle, hi);
        lo = Math.min(s.angle, lo);
      }

      const amp = hi - lo;
      const mid = (hi + lo) / 2;
      const armed = amp >= opt.minRomDeg;

      state.armed = armed;
      state.amplitudeDeg = round1(amp);
      state.loDeg = round1(lo);
      state.hiDeg = round1(hi);

      if (segmentOpen) segment.push(s);

      if (!armed) return null;

      const hiThresh = mid + opt.hysteresis * amp;
      const loThresh = mid - opt.hysteresis * amp;

      if (!above && s.angle > hiThresh) {
        above = true;
        // Rising crossing: closes the pending repetition and opens the next one.
        const pending = segment;
        segment = [s];
        segmentOpen = true;
        if (pending.length > 0) return commit(pending);
        return null;
      }

      if (above && s.angle < loThresh) above = false;
      return null;
    },

    flush(): DetectedRep | null {
      if (!segmentOpen) return null;
      const pending = segment;
      segment = [];
      segmentOpen = false;

      // `above` is set at the rising crossing that opened this segment and only
      // cleared once the angle falls back past loThresh. So if it is still set,
      // the arm never came back down and this is half a cycle — the shape you
      // get when a therapist ends the session mid-flexion. Counting it reports a
      // rep that did not happen and, because its ROM is a fraction of a real
      // one, wrecks consistency and invents a fatigue trend.
      //
      // Cleared means the cycle completed and is merely waiting for the next
      // rise to close it, which is the case this flush exists to catch: a
      // 130-cycle run must report 130, not 129.
      if (above) {
        const durationMs =
          pending.length > 0 ? pending[pending.length - 1].t - pending[0].t : 0;
        let hiDeg = -Infinity;
        let loDeg = Infinity;
        for (const s of pending) {
          if (s.angle > hiDeg) hiDeg = s.angle;
          if (s.angle < loDeg) loDeg = s.angle;
        }
        rejections.push({
          tMs: pending.length > 0 ? pending[pending.length - 1].t : 0,
          reason: "incomplete",
          durationMs,
          romDeg: pending.length > 0 ? round1(hiDeg - loDeg) : 0,
        });
        state.rejected = rejections.length;
        return null;
      }

      return commit(pending);
    },
  };
}
