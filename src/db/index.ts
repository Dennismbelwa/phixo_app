import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "./schema";

// On Vercel the deployment bundle is read-only, so the demo database lives in
// /tmp — ephemeral (re-seeded on each cold start), which is fine for this POC.
const DB_PATH = process.env.VERCEL
  ? "/tmp/phixo.db"
  : path.join(process.cwd(), "phixo.db");

const globalForDb = globalThis as unknown as { __phixoDb?: ReturnType<typeof createDb> };

function createDb() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      sex TEXT NOT NULL,
      bed TEXT NOT NULL,
      stroke_type TEXT NOT NULL,
      affected_side TEXT NOT NULL,
      admission_date TEXT NOT NULL,
      severity TEXT NOT NULL,
      notes TEXT,
      baseline_capacity REAL NOT NULL,
      recovery_rate REAL NOT NULL,
      fatigue_rate REAL NOT NULL,
      spasticity_risk REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS protocols (
      patient_id TEXT PRIMARY KEY REFERENCES patients(id),
      exercises TEXT NOT NULL,
      target_reps_per_day INTEGER NOT NULL,
      max_assist_pct INTEGER NOT NULL,
      session_minutes INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id),
      exercise_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      rep_count INTEGER NOT NULL DEFAULT 0,
      avg_patient_force_pct REAL NOT NULL DEFAULT 0,
      avg_assist_pct REAL NOT NULL DEFAULT 0,
      avg_quality REAL NOT NULL DEFAULT 0,
      avg_rom_pct REAL NOT NULL DEFAULT 0,
      operator TEXT NOT NULL DEFAULT 'patient'
    );
    CREATE TABLE IF NOT EXISTS reps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      t_ms INTEGER NOT NULL,
      emg_peak REAL NOT NULL,
      patient_force_pct REAL NOT NULL,
      assist_pct REAL NOT NULL,
      quality REAL NOT NULL,
      rom_pct REAL NOT NULL,
      duration_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS safety_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      patient_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at_iso TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_patient ON sessions(patient_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_reps_session ON reps(session_id);
    CREATE INDEX IF NOT EXISTS idx_safety_patient ON safety_events(patient_id, acknowledged);
  `);
  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__phixoDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__phixoDb = db;

// Auto-seed the demo ward on first launch so the app is compelling immediately.
import { seedIfEmpty } from "./seed";
seedIfEmpty(db);

export * from "./schema";
