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
  avgPatientRangePct: real("avg_patient_range_pct").notNull().default(0),
  avgAssistPct: real("avg_assist_pct").notNull().default(0),
  avgQuality: real("avg_quality").notNull().default(0),
  avgRomPct: real("avg_rom_pct").notNull().default(0),
  operator: text("operator").notNull().default("patient"), // patient | family | staff
  // --- Physical POC (real IMU device) ---
  /** simulator | device — where the reps in this session came from */
  source: text("source").notNull().default("simulator"),
  /** affected | unaffected — which limb was instrumented (for symmetry comparison) */
  limb: text("limb"),
  /**
   * The sensor-frame reading the board took as full extension when it zeroed,
   * degrees. Null on sessions recorded before the zeroing handshake existed —
   * their absolute angles carry an unknown mounting offset.
   */
  zeroOffsetDeg: real("zero_offset_deg"),
  /** telemetry rate actually received from the device, Hz */
  sampleRateHz: integer("sample_rate_hz"),
  /**
   * 1 when the firmware reported motor state, so assistPct on this session's
   * reps is measured. 0 or null means it is a placeholder and must be shown as
   * not reported — never as 0% assistance.
   */
  assistMeasured: integer("assist_measured"),
});

export const reps = sqliteTable("reps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  tMs: integer("t_ms").notNull(),
  /** peak angular velocity at movement onset, deg/s (0 on the motor-driven rig) */
  initiationVelDegS: real("initiation_vel_deg_s").notNull(),
  /** share of the range the patient covered unaided, 0..100 */
  patientRangePct: real("patient_range_pct").notNull(),
  assistPct: real("assist_pct").notNull(),
  quality: real("quality").notNull(),
  romPct: real("rom_pct").notNull(),
  durationMs: integer("duration_ms").notNull(),
  // --- Measured kinematics (device sessions only; null for simulated reps) ---
  /** peak flexion angle reached in this rep, degrees */
  maxFlexionDeg: real("max_flexion_deg"),
  /** best extension angle reached in this rep, degrees (lower = closer to straight) */
  maxExtensionDeg: real("max_extension_deg"),
  /** maxFlexionDeg - maxExtensionDeg, degrees */
  romDeg: real("rom_deg"),
  /** peak angular velocity during the flexion phase, deg/s */
  peakVelocityDegS: real("peak_velocity_deg_s"),
  /** velocity-profile regularity, 0..100 */
  smoothness: real("smoothness"),
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

/**
 * Raw angle telemetry from the physical POC, 50 Hz. Only written for device
 * sessions — a 130-rep run is roughly 13k rows, which SQLite handles trivially.
 */
export const samples = sqliteTable("samples", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  tMs: integer("t_ms").notNull(),
  angleDeg: real("angle_deg").notNull(),
  velocityDegS: real("velocity_deg_s").notNull(),
});

export type Patient = typeof patients.$inferSelect;
export type Protocol = typeof protocols.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Rep = typeof reps.$inferSelect;
export type SafetyEvent = typeof safetyEvents.$inferSelect;
export type Sample = typeof samples.$inferSelect;
