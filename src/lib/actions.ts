"use server";

import { db, sessions, reps, safetyEvents, protocols, samples } from "@/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { SimulatedRep } from "@/lib/simulator/engine";
import type { DetectedRep, DeviceSample } from "@/lib/device/types";
import { NORMATIVE_ELBOW_ROM_DEG } from "@/lib/device/metrics";

export async function startSession(
  patientId: string,
  exerciseId: string,
  operator: string
): Promise<string> {
  const id = `live-${patientId}-${Date.now()}`;
  db.insert(sessions)
    .values({
      id,
      patientId,
      exerciseId,
      startedAt: new Date().toISOString(),
      operator,
    })
    .run();
  return id;
}

/** Append a batch of reps from the live bedside session and refresh aggregates. */
export async function appendReps(
  sessionId: string,
  patientId: string,
  batch: SimulatedRep[]
): Promise<void> {
  if (batch.length === 0) return;
  db.insert(reps)
    .values(
      batch.map((r) => ({
        sessionId,
        tMs: r.tMs,
        initiationVelDegS: r.initiationVelDegS,
        patientRangePct: r.patientRangePct,
        assistPct: r.assistPct,
        quality: r.quality,
        romPct: r.romPct,
        durationMs: r.durationMs,
      }))
    )
    .run();

  for (const r of batch) {
    if (r.safetyEvent) {
      db.insert(safetyEvents)
        .values({
          sessionId,
          patientId,
          type: r.safetyEvent,
          atIso: new Date().toISOString(),
          acknowledged: 0,
        })
        .run();
    }
  }

  // Recompute session aggregates from stored reps.
  const all = db.select().from(reps).where(eq(reps.sessionId, sessionId)).all();
  const n = all.length;
  const avg = (f: (r: (typeof all)[number]) => number) =>
    n === 0 ? 0 : Math.round((all.reduce((s, r) => s + f(r), 0) / n) * 10) / 10;
  db.update(sessions)
    .set({
      repCount: n,
      avgPatientRangePct: avg((r) => r.patientRangePct),
      avgAssistPct: avg((r) => r.assistPct),
      avgQuality: avg((r) => r.quality),
      avgRomPct: avg((r) => r.romPct),
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

/**
 * Log a guardrail event from an aborted rep. Safety events must reach the
 * therapist even though the interrupted rep itself is never stored.
 */
export async function logSafetyEvent(
  sessionId: string,
  patientId: string,
  type: string
): Promise<void> {
  db.insert(safetyEvents)
    .values({
      sessionId,
      patientId,
      type,
      atIso: new Date().toISOString(),
      acknowledged: 0,
    })
    .run();
  revalidatePath("/dashboard");
}

export async function endSession(sessionId: string): Promise<void> {
  const existing = db.select().from(sessions).where(eq(sessions.id, sessionId)).all()[0];
  if (!existing) return;
  const events = db
    .select()
    .from(safetyEvents)
    .where(eq(safetyEvents.sessionId, sessionId))
    .all();
  if (existing.repCount === 0 && events.length === 0) {
    // Abandoned before any rep or guardrail event — drop it rather than clutter the record.
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  } else {
    db.update(sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();
  }
  revalidatePath("/dashboard");
}

export async function updateProtocol(
  patientId: string,
  data: {
    exercises: string[];
    targetRepsPerDay: number;
    maxAssistPct: number;
    sessionMinutes: number;
  }
): Promise<void> {
  db.update(protocols)
    .set({
      exercises: JSON.stringify(data.exercises),
      targetRepsPerDay: data.targetRepsPerDay,
      maxAssistPct: data.maxAssistPct,
      sessionMinutes: data.sessionMinutes,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(protocols.patientId, patientId))
    .run();
  revalidatePath(`/dashboard/${patientId}`);
  revalidatePath("/dashboard");
}

export async function acknowledgeAlert(alertId: number): Promise<void> {
  db.update(safetyEvents)
    .set({ acknowledged: 1 })
    .where(eq(safetyEvents.id, alertId))
    .run();
  revalidatePath("/dashboard");
}

/* ------------------------------------------------------------------------- *
 * Physical POC (real IMU device) sessions
 *
 * These mirror startSession/appendReps, but write measured kinematics instead
 * of simulated effort.
 *
 * Assistance is measured, not estimated: the firmware reports when it engaged
 * the motor, and the detector turns that into a per-repetition share. Firmware
 * without motor telemetry leaves it unmeasured, flagged by sessions.assistMeasured
 * — an unmeasured session must never be rendered as 0% assistance.
 *
 * Movement-initiation velocity stays at 0 throughout: an IMU measures how fast
 * the limb moved, not how fast the patient meant to move it.
 * ------------------------------------------------------------------------- */

export async function startDeviceSession(
  patientId: string,
  exerciseId: string,
  limb: "affected" | "unaffected",
  sampleRateHz: number,
): Promise<string> {
  const id = `poc-${patientId}-${Date.now()}`;
  db.insert(sessions)
    .values({
      id,
      patientId,
      exerciseId,
      startedAt: new Date().toISOString(),
      operator: "staff",
      source: "device",
      limb,
      sampleRateHz,
    })
    .run();
  return id;
}

/** Append detected repetitions from the physical device and refresh aggregates. */
export async function appendDeviceReps(
  sessionId: string,
  batch: DetectedRep[],
): Promise<void> {
  if (batch.length === 0) return;
  db.insert(reps)
    .values(
      batch.map((r) => ({
        sessionId,
        tMs: r.tMs,
        // An IMU cannot sense how fast the patient *intended* to move, only how
        // fast the limb went, so initiation velocity stays unavailable.
        initiationVelDegS: 0,
        // Measured from motor state when the firmware reports it. The columns
        // are NOT NULL, so an unmeasured session still writes 0 — which is why
        // sessions.assistMeasured exists to say whether the 0 means anything.
        patientRangePct: r.patientRangePct ?? 0,
        assistPct: r.assistPct ?? 0,
        quality: r.quality,
        // Keep the existing percentage column meaningful for the shared charts,
        // expressed against the normative elbow range.
        romPct: Math.round((r.romDeg / NORMATIVE_ELBOW_ROM_DEG) * 1000) / 10,
        durationMs: r.durationMs,
        maxFlexionDeg: r.maxFlexionDeg,
        maxExtensionDeg: r.maxExtensionDeg,
        romDeg: r.romDeg,
        peakVelocityDegS: r.peakFlexionVelDegS,
        smoothness: r.smoothness,
      })),
    )
    .run();

  const all = db.select().from(reps).where(eq(reps.sessionId, sessionId)).all();
  const n = all.length;
  const avg = (f: (r: (typeof all)[number]) => number) =>
    n === 0 ? 0 : Math.round((all.reduce((s, r) => s + f(r), 0) / n) * 10) / 10;
  // One rep carrying a real reading is enough to mark the session measured: the
  // averages then describe the reps that reported, not a silent mix of real and
  // placeholder zeros.
  const measured = batch.some((r) => r.assistPct !== null);
  db.update(sessions)
    .set({
      repCount: n,
      avgQuality: avg((r) => r.quality),
      avgRomPct: avg((r) => r.romPct),
      avgAssistPct: avg((r) => r.assistPct),
      avgPatientRangePct: avg((r) => r.patientRangePct),
      ...(measured ? { assistMeasured: 1 } : {}),
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

/** Persist raw 50 Hz telemetry so the run can be re-analysed or replayed later. */
export async function appendSamples(
  sessionId: string,
  batch: DeviceSample[],
): Promise<void> {
  if (batch.length === 0) return;
  const rows = batch.map((s) => ({
    sessionId,
    tMs: s.t,
    angleDeg: s.angle,
    velocityDegS: s.vel,
  }));
  // Chunked to stay well inside SQLite's bound-parameter limit, as the seed does.
  for (let i = 0; i < rows.length; i += 200) {
    db.insert(samples).values(rows.slice(i, i + 200)).run();
  }
}

/** Close a device session, keeping it even if empty so the record is auditable. */
export async function endDeviceSession(sessionId: string): Promise<void> {
  const existing = db.select().from(sessions).where(eq(sessions.id, sessionId)).all()[0];
  if (!existing) return;
  if (existing.repCount === 0) {
    db.delete(samples).where(eq(samples.sessionId, sessionId)).run();
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  } else {
    db.update(sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${existing.patientId}`);
}
