/**
 * Headless verification of the repetition detector.
 *
 * Proves the core presentation claim — that Phixo detects cycles from the signal
 * rather than assuming a count — with no browser, no server and no hardware.
 *
 *   npm run device:mock
 */
import { generateAngleTrace } from "@/lib/device/mock-source";
import { createRepDetector } from "@/lib/device/rep-detector";
import { summarizeReps } from "@/lib/device/metrics";
import type { DetectedRep } from "@/lib/device/types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

function run(trace: ReturnType<typeof generateAngleTrace>) {
  const detector = createRepDetector();
  const reps: DetectedRep[] = [];
  for (const s of trace) {
    const rep = detector.push(s);
    if (rep) reps.push(rep);
  }
  const last = detector.flush();
  if (last) reps.push(last);
  return { reps, detector };
}

console.log("\nPhixo rep detector — headless verification\n");

// 1. The presentation run: 130 clean motor cycles must count as exactly 130.
console.log("130 clean cycles @ 125 deg, 2.0 s period");
{
  const { reps, detector } = run(generateAngleTrace({ reps: 130 }));
  check("repetitions detected", reps.length, 130);
  check("rejected", detector.state.rejected, 0);
  const m = summarizeReps(reps);
  console.log(
    `        ROM ${m.meanRomDeg} deg (SD ${m.sdRomDeg}) | consistency ${m.consistency}% | ` +
      `quality ${m.meanQuality} | max flexion ${m.maxFlexionDeg} deg | extension deficit ${m.extensionDeficitDeg} deg`,
  );
}

// 2. Two stalled cycles must be rejected, and must not be miscounted as reps.
console.log("\n130 cycles with 2 stalled cycles (held brace)");
{
  const { reps, detector } = run(generateAngleTrace({ reps: 130, stallAt: [40, 90] }));
  check("repetitions detected", reps.length, 128);
  check("rejected", detector.state.rejected, 2);
  check("rejection reason", detector.rejections[0]?.reason, "too_long");
}

// 3. Noise and small movements on an idle rig must not create phantom reps.
console.log("\nIdle rig: noise and 5 deg tremor only");
{
  const { reps, detector } = run(
    generateAngleTrace({ reps: 60, romDeg: 5, periodMs: 900, noiseDeg: 0.8, dwellMs: 0 }),
  );
  check("repetitions detected", reps.length, 0);
  check("detector armed", detector.state.armed, false);
}

// 4. A slower, shallower run still counts — nothing is hard-coded to one rig.
console.log("\n40 cycles @ 70 deg, 3.5 s period");
{
  const { reps } = run(generateAngleTrace({ reps: 40, romDeg: 70, periodMs: 3500 }));
  check("repetitions detected", reps.length, 40);
}

// 5. Session-boundary handling, mirroring useAngleSource.endRecording(): a rep is
//    bounded by consecutive rising crossings, so the final cycle is still buffered
//    when the movement stops. Flushing it is right on a manual stop and wrong once
//    the target is already met — get this wrong and a 130-rep run reports 129 or 131.
console.log("\nSession boundary against a 130-rep target");
{
  const finish = (cycles: number, target: number) => {
    const detector = createRepDetector();
    const reps: DetectedRep[] = [];
    for (const s of generateAngleTrace({ reps: cycles })) {
      const rep = detector.push(s);
      if (rep) reps.push(rep);
      if (reps.length >= target) break;
    }
    if (reps.length < target) {
      const last = detector.flush();
      if (last) reps.push(last);
    }
    return reps.length;
  };
  check("motor runs exactly 130 cycles", finish(130, 130), 130);
  check("motor overruns to 133 cycles", finish(133, 130), 130);
  check("stopped early at 45 cycles", finish(45, 130), 45);
}

// 6. Ending a session mid-flexion must not count the half-cycle. The trailing
//    segment is only a repetition if the arm came back down; stopping on the way
//    up leaves a stub whose ROM is a fraction of a real one, which drags
//    consistency to near zero and invents a fatigue trend that never happened.
console.log("\nEnding a session part-way through a cycle");
{
  /** Feed whole cycles, then `extra` samples into the next one, then flush. */
  const stopAfter = (cycles: number, extra: number) => {
    const trace = generateAngleTrace({ reps: cycles });
    const detector = createRepDetector();
    const reps: DetectedRep[] = [];
    let seen = 0;
    for (const s of trace) {
      const rep = detector.push(s);
      if (rep) {
        reps.push(rep);
        seen = 0;
      } else if (reps.length > 0) {
        seen++;
        // 50 Hz, so 30 samples is 0.6 s into the rising stroke — mid-flexion.
        if (reps.length === cycles - 2 && seen >= extra) break;
      }
    }
    const last = detector.flush();
    if (last) reps.push(last);
    return { reps, detector };
  };

  const mid = stopAfter(20, 30);
  check("mid-flexion stop is not counted", mid.reps.length, 18);
  check("it is recorded as a rejection", mid.detector.rejections.at(-1)?.reason, "incomplete");
  const m = summarizeReps(mid.reps);
  const consistent = m.consistency > 90;
  if (!consistent) failures++;
  console.log(
    `${consistent ? "  PASS" : "  FAIL"}  consistency survives the stop: ${m.consistency}%` +
      ` (SD ${m.sdRomDeg} deg)${consistent ? "" : " (expected > 90)"}`,
  );

  // The complete-cycle case this flush exists for must still work.
  const { reps } = run(generateAngleTrace({ reps: 30 }));
  check("a run that ends at rest still reports every cycle", reps.length, 30);
}

// 7. Assistance is measured from motor state, not estimated from the angle. A
//    trace with no motor field must report null — unmeasured — rather than 0%,
//    which would read as "the patient needed no help".
console.log("\nAssistance from motor telemetry");
{
  const { reps } = run(generateAngleTrace({ reps: 30, assistPct: 40 }));
  const m = summarizeReps(reps);
  const near = m.meanAssistPct !== null && Math.abs(m.meanAssistPct - 40) < 6;
  if (!near) failures++;
  console.log(
    `${near ? "  PASS" : "  FAIL"}  40% assist trace reports ${m.meanAssistPct}%` +
      `${near ? "" : " (expected within 6 of 40)"}`,
  );
  check(
    "patient range is the complement",
    m.meanPatientRangePct === null ? null : Math.round(m.meanPatientRangePct + (m.meanAssistPct ?? 0)),
    100,
  );

  const silent = run(generateAngleTrace({ reps: 30 }));
  const sm = summarizeReps(silent.reps);
  check("firmware without motor state reports unmeasured", sm.meanAssistPct, null);
  check("and not zero", sm.meanAssistPct === 0, false);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
