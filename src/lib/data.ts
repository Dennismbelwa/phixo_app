import "server-only";
import { db, patients, protocols, sessions, reps, safetyEvents } from "@/db";
import type { Patient, Protocol, Session, SafetyEvent } from "@/db";
import { eq, and, desc, sql } from "drizzle-orm";

export function acuteDay(admissionDate: string): number {
  const admitted = new Date(admissionDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((today.getTime() - admitted.getTime()) / 86400000) + 1);
}

export function todayIso(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/** local ISO date for a Date */
function localDate(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export interface RosterEntry {
  patient: Patient;
  protocol: Protocol;
  day: number;
  repsToday: number;
  targetReps: number;
  avgQualityToday: number | null;
  avgAssistToday: number | null;
  openAlerts: number;
  lastSessionAt: string | null;
}

export function getRoster(): RosterEntry[] {
  const allPatients = db.select().from(patients).all();
  const allProtocols = db.select().from(protocols).all();
  const today = todayIso();

  return allPatients
    .map((p) => {
      const protocol = allProtocols.find((pr) => pr.patientId === p.id)!;
      const patientSessions = db
        .select()
        .from(sessions)
        .where(eq(sessions.patientId, p.id))
        .orderBy(desc(sessions.startedAt))
        .all();
      const todays = patientSessions.filter((s) => localDate(s.startedAt) === today);
      const repsToday = todays.reduce((sum, s) => sum + s.repCount, 0);
      const wavg = (f: (s: Session) => number) => {
        const tot = todays.reduce((sum, s) => sum + s.repCount, 0);
        if (tot === 0) return null;
        return (
          Math.round(
            (todays.reduce((sum, s) => sum + f(s) * s.repCount, 0) / tot) * 10
          ) / 10
        );
      };
      const openAlerts = db
        .select({ n: sql<number>`count(*)` })
        .from(safetyEvents)
        .where(and(eq(safetyEvents.patientId, p.id), eq(safetyEvents.acknowledged, 0)))
        .all()[0].n;

      return {
        patient: p,
        protocol,
        day: acuteDay(p.admissionDate),
        repsToday,
        targetReps: protocol.targetRepsPerDay,
        avgQualityToday: wavg((s) => s.avgQuality),
        avgAssistToday: wavg((s) => s.avgAssistPct),
        openAlerts,
        lastSessionAt: patientSessions[0]?.startedAt ?? null,
      };
    })
    .sort((a, b) => a.repsToday / a.targetReps - b.repsToday / b.targetReps);
}

export interface DailyAggregate {
  date: string;
  day: number;
  reps: number;
  avgAssistPct: number | null;
  avgPatientForcePct: number | null;
  avgQuality: number | null;
}

export interface PatientDetail {
  patient: Patient;
  protocol: Protocol;
  day: number;
  daily: DailyAggregate[];
  sessions: Session[];
  alerts: SafetyEvent[];
  repsToday: number;
  totalReps: number;
}

export function getPatientDetail(id: string): PatientDetail | null {
  const patient = db.select().from(patients).where(eq(patients.id, id)).all()[0];
  if (!patient) return null;
  const protocol = db.select().from(protocols).where(eq(protocols.patientId, id)).all()[0];
  const patientSessions = db
    .select()
    .from(sessions)
    .where(eq(sessions.patientId, id))
    .orderBy(desc(sessions.startedAt))
    .all();
  const alerts = db
    .select()
    .from(safetyEvents)
    .where(eq(safetyEvents.patientId, id))
    .orderBy(desc(safetyEvents.atIso))
    .all();

  // Aggregate per acute day
  const byDate = new Map<string, Session[]>();
  for (const s of patientSessions) {
    const d = localDate(s.startedAt);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(s);
  }
  const admitted = new Date(patient.admissionDate + "T00:00:00");
  const daily: DailyAggregate[] = [...byDate.entries()]
    .map(([date, list]) => {
      const repsN = list.reduce((sum, s) => sum + s.repCount, 0);
      const wavg = (f: (s: Session) => number) =>
        repsN === 0
          ? null
          : Math.round((list.reduce((sum, s) => sum + f(s) * s.repCount, 0) / repsN) * 10) / 10;
      const dayN =
        Math.round((new Date(date + "T00:00:00").getTime() - admitted.getTime()) / 86400000) + 1;
      return {
        date,
        day: dayN,
        reps: repsN,
        avgAssistPct: wavg((s) => s.avgAssistPct),
        avgPatientForcePct: wavg((s) => s.avgPatientForcePct),
        avgQuality: wavg((s) => s.avgQuality),
      };
    })
    .sort((a, b) => a.day - b.day);

  const today = todayIso();
  const repsToday = daily.find((d) => d.date === today)?.reps ?? 0;
  const totalReps = daily.reduce((sum, d) => sum + d.reps, 0);

  return {
    patient,
    protocol,
    day: acuteDay(patient.admissionDate),
    daily,
    sessions: patientSessions,
    alerts,
    repsToday,
    totalReps,
  };
}

export interface SessionDetail {
  session: Session;
  repRows: { tMs: number; patientForcePct: number; assistPct: number; quality: number }[];
}

export function getSessionReps(sessionId: string) {
  return db.select().from(reps).where(eq(reps.sessionId, sessionId)).orderBy(reps.tMs).all();
}

export interface WardAnalytics {
  totalReps: number;
  totalSessions: number;
  totalPatients: number;
  dataPoints: number;
  therapistSessionsEquivalent: number;
  safetyEvents: number;
  wardDaily: { date: string; label: string; reps: number }[];
  assistByAcuteDay: { day: number; avgAssistPct: number; patients: number }[];
}

/** Ward-level aggregates for the data-warehouse view. */
export function getWardAnalytics(): WardAnalytics {
  const allPatients = db.select().from(patients).all();
  const allSessions = db.select().from(sessions).all();
  const totalReps = allSessions.reduce((s, x) => s + x.repCount, 0);
  const safetyCount = db
    .select({ n: sql<number>`count(*)` })
    .from(safetyEvents)
    .all()[0].n;

  // Reps per calendar day across the ward
  const byDate = new Map<string, number>();
  for (const s of allSessions) {
    const d = localDate(s.startedAt);
    byDate.set(d, (byDate.get(d) ?? 0) + s.repCount);
  }
  const wardDaily = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, reps]) => ({
      date,
      label: new Date(date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      reps,
    }));

  // Average assistance by acute day, pooled across patients (the ward-level
  // version of the falling-assistance recovery curve).
  const byAcuteDay = new Map<number, { assistWeighted: number; reps: number; ids: Set<string> }>();
  for (const s of allSessions) {
    if (s.repCount === 0) continue;
    const p = allPatients.find((x) => x.id === s.patientId);
    if (!p) continue;
    const admitted = new Date(p.admissionDate + "T00:00:00");
    const dayN =
      Math.round(
        (new Date(localDate(s.startedAt) + "T00:00:00").getTime() - admitted.getTime()) / 86400000
      ) + 1;
    if (dayN < 1 || dayN > 7) continue;
    const cur = byAcuteDay.get(dayN) ?? { assistWeighted: 0, reps: 0, ids: new Set<string>() };
    cur.assistWeighted += s.avgAssistPct * s.repCount;
    cur.reps += s.repCount;
    cur.ids.add(s.patientId);
    byAcuteDay.set(dayN, cur);
  }
  const assistByAcuteDay = [...byAcuteDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, v]) => ({
      day,
      avgAssistPct: Math.round((v.assistWeighted / v.reps) * 10) / 10,
      patients: v.ids.size,
    }));

  return {
    totalReps,
    totalSessions: allSessions.length,
    totalPatients: allPatients.length,
    // rep row: EMG, force, assist, quality, ROM, duration + timestamp ≈ 7 signals
    dataPoints: totalReps * 7,
    therapistSessionsEquivalent: Math.round(totalReps / 15),
    safetyEvents: safetyCount,
    wardDaily,
    assistByAcuteDay,
  };
}

/** Badges computed from history — gamification for the patient view. */
export interface BadgeInfo {
  id: string;
  label: string;
  emoji: string;
  earned: boolean;
  description: string;
}

export function computeBadges(detail: PatientDetail): BadgeInfo[] {
  const { daily, totalReps, repsToday, protocol } = detail;
  const daysAtTarget = daily.filter((d) => d.reps >= protocol.targetRepsPerDay).length;
  const forceTrend =
    daily.length >= 2 &&
    (daily.at(-1)!.avgPatientForcePct ?? 0) > (daily[0].avgPatientForcePct ?? 0);
  return [
    {
      id: "first-session",
      label: "First steps",
      emoji: "🌱",
      earned: totalReps > 0,
      description: "Completed your first Phixo session",
    },
    {
      id: "first-100",
      label: "First 100",
      emoji: "💯",
      earned: totalReps >= 100,
      description: "100 total repetitions",
    },
    {
      id: "target-day",
      label: "Goal getter",
      emoji: "🎯",
      earned: daysAtTarget >= 1,
      description: "Hit your full daily target",
    },
    {
      id: "streak-3",
      label: "3-day streak",
      emoji: "🔥",
      earned: daily.filter((d) => d.reps > 0).length >= 3,
      description: "Trained 3 days in a row",
    },
    {
      id: "getting-stronger",
      label: "Getting stronger",
      emoji: "💪",
      earned: forceTrend,
      description: "Your own force is trending up",
    },
    {
      id: "today-200",
      label: "Daily double",
      emoji: "⚡",
      earned: repsToday >= 200,
      description: "200+ reps in a single day",
    },
  ];
}
