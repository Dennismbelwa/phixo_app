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
      avg_patient_range_pct REAL NOT NULL DEFAULT 0,
      avg_assist_pct REAL NOT NULL DEFAULT 0,
      avg_quality REAL NOT NULL DEFAULT 0,
      avg_rom_pct REAL NOT NULL DEFAULT 0,
      operator TEXT NOT NULL DEFAULT 'patient'
    );
    CREATE TABLE IF NOT EXISTS reps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      t_ms INTEGER NOT NULL,
      initiation_vel_deg_s REAL NOT NULL,
      patient_range_pct REAL NOT NULL,
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
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      t_ms INTEGER NOT NULL,
      angle_deg REAL NOT NULL,
      velocity_deg_s REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_patient ON sessions(patient_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_samples_session ON samples(session_id, t_ms);
    CREATE INDEX IF NOT EXISTS idx_reps_session ON reps(session_id);
    CREATE INDEX IF NOT EXISTS idx_safety_patient ON safety_events(patient_id, acknowledged);
  `);
  // The device measures movement, not muscle activity or force, so the original
  // EMG/force columns were renamed. RENAME COLUMN preserves the rows — dropping
  // and reseeding instead would destroy any real POC run already recorded, which
  // is the presentation's fallback.
  if (renameColumn(sqlite, "reps", "emg_peak", "initiation_vel_deg_s")) {
    // Old values were 0..1 amplitudes; the new column is deg/s.
    sqlite.exec("UPDATE reps SET initiation_vel_deg_s = initiation_vel_deg_s * 130");
  }
  renameColumn(sqlite, "reps", "patient_force_pct", "patient_range_pct");
  renameColumn(sqlite, "sessions", "avg_patient_force_pct", "avg_patient_range_pct");

  // The DDL above uses CREATE TABLE IF NOT EXISTS, so columns added after a
  // database already exists would silently never appear. Add them explicitly —
  // SQLite throws "duplicate column name" when they are already there, which is
  // the idempotency check. This preserves an already-seeded demo ward.
  ensureColumn(sqlite, "sessions", "source", "TEXT NOT NULL DEFAULT 'simulator'");
  ensureColumn(sqlite, "sessions", "limb", "TEXT");
  ensureColumn(sqlite, "sessions", "zero_offset_deg", "REAL");
  ensureColumn(sqlite, "sessions", "sample_rate_hz", "INTEGER");
  // Whether the assist columns on this session's reps hold a measured value.
  // Device firmware without motor telemetry writes 0, which is indistinguishable
  // from "the patient needed no help" unless the session says which it was.
  ensureColumn(sqlite, "sessions", "assist_measured", "INTEGER");
  ensureColumn(sqlite, "reps", "max_flexion_deg", "REAL");
  ensureColumn(sqlite, "reps", "max_extension_deg", "REAL");
  ensureColumn(sqlite, "reps", "rom_deg", "REAL");
  ensureColumn(sqlite, "reps", "peak_velocity_deg_s", "REAL");
  ensureColumn(sqlite, "reps", "smoothness", "REAL");

  return drizzle(sqlite, { schema });
}

/**
 * Rename a column if, and only if, the old name is still present and the new one
 * is not. Returns true when a rename actually happened, so callers can run a
 * one-off data fix-up exactly once.
 */
function renameColumn(
  sqlite: Database.Database,
  table: string,
  from: string,
  to: string,
): boolean {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has(from) || names.has(to)) return false;
  sqlite.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  return true;
}

function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("duplicate column name")) throw err;
  }
}

export const db = globalForDb.__phixoDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__phixoDb = db;

// Auto-seed the demo ward on first launch so the app is compelling immediately.
import { seedIfEmpty } from "./seed";
seedIfEmpty(db);

export * from "./schema";
