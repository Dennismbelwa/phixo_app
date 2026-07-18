"use server";

import { db, sessions, reps, safetyEvents, protocols } from "@/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { SimulatedRep } from "@/lib/simulator/engine";

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
        emgPeak: r.emgPeak,
        patientForcePct: r.patientForcePct,
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
      avgPatientForcePct: avg((r) => r.patientForcePct),
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
