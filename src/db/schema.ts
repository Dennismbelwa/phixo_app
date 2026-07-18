import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const patients = sqliteTable("patients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age").notNull(),
  sex: text("sex").notNull(),
  bed: text("bed").notNull(),
  strokeType: text("stroke_type").notNull(), // ischemic | hemorrhagic
  affectedSide: text("affected_side").notNull(), // left | right
  admissionDate: text("admission_date").notNull(), // ISO date (stroke event / admission)
  severity: text("severity").notNull(), // severe | moderate | mild
  notes: text("notes"),
  // Impairment profile driving the simulator
  baselineCapacity: real("baseline_capacity").notNull(),
  recoveryRate: real("recovery_rate").notNull(),
  fatigueRate: real("fatigue_rate").notNull(),
  spasticityRisk: real("spasticity_risk").notNull(),
});

export const protocols = sqliteTable("protocols", {
  patientId: text("patient_id")
    .primaryKey()
    .references(() => patients.id),
  exercises: text("exercises").notNull(), // JSON array of exercise ids
  targetRepsPerDay: integer("target_reps_per_day").notNull(),
  maxAssistPct: integer("max_assist_pct").notNull(),
  sessionMinutes: integer("session_minutes").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id),
  exerciseId: text("exercise_id").notNull(),
  startedAt: text("started_at").notNull(), // ISO datetime
  endedAt: text("ended_at"),
  repCount: integer("rep_count").notNull().default(0),
  avgPatientForcePct: real("avg_patient_force_pct").notNull().default(0),
  avgAssistPct: real("avg_assist_pct").notNull().default(0),
  avgQuality: real("avg_quality").notNull().default(0),
  avgRomPct: real("avg_rom_pct").notNull().default(0),
  operator: text("operator").notNull().default("patient"), // patient | family | staff
});

export const reps = sqliteTable("reps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  tMs: integer("t_ms").notNull(),
  emgPeak: real("emg_peak").notNull(),
  patientForcePct: real("patient_force_pct").notNull(),
  assistPct: real("assist_pct").notNull(),
  quality: real("quality").notNull(),
  romPct: real("rom_pct").notNull(),
  durationMs: integer("duration_ms").notNull(),
});

export const safetyEvents = sqliteTable("safety_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  patientId: text("patient_id").notNull(),
  type: text("type").notNull(), // spasticity | abnormal_resistance | pain_reflex
  atIso: text("at_iso").notNull(),
  acknowledged: integer("acknowledged").notNull().default(0),
});

export type Patient = typeof patients.$inferSelect;
export type Protocol = typeof protocols.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Rep = typeof reps.$inferSelect;
export type SafetyEvent = typeof safetyEvents.$inferSelect;
