/**
 * Phixo physical POC — shared types.
 *
 * The POC is a motorised elbow brace instrumented with an MPU-9250/6500 on an
 * Arduino UNO R4 WiFi, plugged into the presentation laptop over USB. The board
 * fuses accelerometer + gyroscope into an elbow angle and streams it as CSV
 * lines; everything downstream of the port lives in this folder.
 *
 * Deliberately dependency-free and isomorphic so the detector and metrics can be
 * exercised headlessly (npm run device:mock) with no browser and no hardware.
 */

/** One telemetry sample as received from the device, 50 Hz. */
export interface DeviceSample {
  /** milliseconds since the device booted */
  t: number;
  /**
   * elbow angle in degrees; 0 = full extension, positive = flexion.
   * True clinical angle only once the board has been zeroed at the extension
   * end-stop — see the 'Z' handshake in serial.ts. Without it the reading
   * carries the mounting offset and 0 means nothing in particular.
   */
  angle: number;
  /** angular velocity in deg/s, straight from the bias-corrected gyro */
  vel: number;
  /**
   * True while the motor was driving this sample, false while the patient moved
   * unaided. Optional: firmware predating the 5-field `D,` line omits it, and
   * assistance is then reported as unmeasured rather than as zero.
   */
  motorActive?: boolean;
}

/** A repetition segmented out of the angle stream by the detector. */
export interface DetectedRep {
  /** 1-based position in the session */
  index: number;
  /** device timestamp at the end of the rep */
  tMs: number;
  durationMs: number;
  /** peak flexion angle reached, degrees */
  maxFlexionDeg: number;
  /** best extension angle reached, degrees (lower = closer to straight) */
  maxExtensionDeg: number;
  /** maxFlexionDeg - maxExtensionDeg */
  romDeg: number;
  peakFlexionVelDegS: number;
  peakExtensionVelDegS: number;
  /** velocity-profile regularity, 0..100 */
  smoothness: number;
  /** composite movement quality, 0..100 */
  quality: number;
  /**
   * Share of the repetition the motor drove, 0..100. Null when the firmware
   * does not report motor state — assistance is unmeasured, which is not the
   * same as zero assistance.
   */
  assistPct: number | null;
  /** Share the patient covered unaided, 0..100. Null for the same reason. */
  patientRangePct: number | null;
}

/**
 * Why a candidate cycle was not counted as a repetition. "incomplete" is the
 * trailing half-cycle left when a session is ended mid-flexion.
 */
export type RejectReason = "too_short" | "too_long" | "rom_too_small" | "incomplete";

export type SignalQuality = "stable" | "weak" | "lost";

/** Where the angle stream is coming from. */
export type DeviceMode = "device" | "simulation" | "replay";

export interface DeviceStatus {
  connected: boolean;
  /** Date.now() of the most recent sample, 0 if none yet */
  lastSampleAt: number;
  /** measured arrival rate, Hz */
  rateHz: number;
  /** total samples received this connection */
  samples: number;
  /** candidate cycles rejected by the detector gates */
  rejected: number;
  signal: SignalQuality;
  mode: DeviceMode;
  /** true while the board is averaging its zero reference — no telemetry flows */
  calibrating: boolean;
  /** true once the board has zeroed, so angles are true clinical angles */
  calibrated: boolean;
  /** the sensor-frame reading the board took as full extension, degrees */
  zeroDeg: number | null;
  /** human-readable problem, e.g. a port that is already open elsewhere */
  error: string | null;
}

export const IDLE_STATUS: DeviceStatus = {
  connected: false,
  lastSampleAt: 0,
  rateHz: 0,
  samples: 0,
  rejected: 0,
  signal: "lost",
  mode: "device",
  calibrating: false,
  calibrated: false,
  zeroDeg: null,
  error: null,
};

/**
 * Single-character commands understood by the firmware.
 *
 * 'Z' zeroes at full extension and captures the gyro bias. The app sends it once
 * per connection: rep count, ROM and cadence are differences and survive a
 * constant offset, but the absolute readings — MAX FLEXION, MAX EXTENSION and
 * above all EXTENSION DEFICIT — do not, and neither do the fixed 0-150 deg
 * chart scales the UI draws against.
 */
export type DeviceCommand = "S" | "X" | "P" | "Z";

/**
 * A source of elbow-angle samples. Implemented three ways — the real USB port
 * (serial.ts), a synthetic generator (mock-source.ts) and a stored real session
 * played back (replay-source.ts) — so the UI never binds to Web Serial directly
 * and the whole presentation is rehearsable before the hardware exists.
 */
export interface AngleSource {
  readonly mode: DeviceMode;
  start(handlers: AngleSourceHandlers): Promise<void>;
  send(cmd: DeviceCommand): Promise<void>;
  stop(): Promise<void>;
}

export interface AngleSourceHandlers {
  onSample: (s: DeviceSample) => void;
  onStatus: (patch: Partial<DeviceStatus>) => void;
}
