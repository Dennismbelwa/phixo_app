/**
 * Web Serial transport for the physical POC.
 *
 * The Arduino is plugged into the presentation laptop over USB and prints
 * newline-delimited CSV; this reads it straight from the port. No network, no
 * server, no dependencies — which is precisely why it was chosen over WiFi for a
 * live presentation.
 *
 * Wire format (see hardware/phixo_poc/phixo_poc.ino):
 *   D,<tMs>,<angleDeg>,<velDegPerSec>      telemetry, 50 Hz
 *   S,<calibrated>,<gyroBias>,<zeroDeg>,<rateHz>   status / calibration result
 *   E,<message>                            device-side error
 */
import type {
  AngleSource,
  AngleSourceHandlers,
  DeviceCommand,
  DeviceProtocol,
} from "./types";

/**
 * Matches whatever board is actually on the bench right now, which is running
 * the experimental servo-assist sketch (9600) — not the documented
 * phixo_poc.ino (115200, see hardware/phixo_poc/phixo_poc.ino). If that
 * sketch gets reflashed, this needs to flip back to 115200.
 */
export const BAUD_RATE = 9600;

/** `D,` state words used by the bench (servo-assist) sketch's 5th field, in
 * place of phixo_poc.ino's numeric `motorActive`. */
const BENCH_STATES = new Set(["IDLE", "MOVING", "ASSIST", "TARGET"]);

/* Minimal ambient declarations for the Web Serial API. Declared here rather than
 * pulling in @types/w3c-web-serial to keep the project dependency-free. */
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

function serialApi(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? null;
}

export function isSerialSupported(): boolean {
  return serialApi() !== null;
}

/* ------------------------------------------------------------------ logging */

/**
 * Console tracing for the physical POC.
 *
 * Debugging a serial link through a UI is guesswork: "no reps appeared" could be
 * a port that never opened, a board that is not streaming, a wire format that
 * does not parse, or a detector that rejected every cycle. These logs separate
 * those cases at the point where each could fail.
 *
 * On by default in development. Toggle at runtime from the console without a
 * rebuild:  localStorage.phixoDebug = "1"  /  "0"
 */
function debugSetting(): string | null {
  try {
    return localStorage.getItem("phixoDebug");
  } catch {
    // Storage can be blocked; fall through to the build-time default.
    return null;
  }
}

function debugEnabled(): boolean {
  const override = debugSetting();
  if (override !== null) return override !== "0";
  return process.env.NODE_ENV !== "production";
}

/**
 * Log every telemetry line instead of a rate summary. 50 Hz of console output is
 * unreadable as a running commentary, but it is the only way to inspect the wire
 * format itself — so it is opt-in:  localStorage.phixoDebug = "verbose"
 */
function verboseEnabled(): boolean {
  return debugSetting() === "verbose";
}

const TAG = "[phixo:serial]";

function log(...args: unknown[]): void {
  if (debugEnabled()) console.log(TAG, ...args);
}
function warn(...args: unknown[]): void {
  if (debugEnabled()) console.warn(TAG, ...args);
}
function logErr(...args: unknown[]): void {
  if (debugEnabled()) console.error(TAG, ...args);
}

/** Render getInfo() as the USB ids you would recognise on the board. */
function describePort(port: SerialPortLike): string {
  const info = port.getInfo?.();
  if (!info?.usbVendorId) return "port (no USB id reported)";
  const hex = (n: number) => "0x" + n.toString(16).padStart(4, "0");
  const vendor = info.usbVendorId === 0x2341 ? " (Arduino)" : "";
  return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId ?? 0)}${vendor}`;
}

/** Raised when the port cannot be opened, carrying a message fit for a user. */
export class SerialConnectionError extends Error {
  constructor(message: string, readonly cancelled = false) {
    super(message);
    this.name = "SerialConnectionError";
  }
}

/**
 * Turn a raw DOMException into something a presenter can act on. The two that
 * actually happen on the day are a cancelled picker and a port still held by the
 * Arduino IDE Serial Monitor.
 */
function describe(err: unknown): SerialConnectionError {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);

  if (name === "NotFoundError") {
    return new SerialConnectionError("No device selected.", true);
  }
  if (name === "InvalidStateError" || /already open/i.test(message)) {
    return new SerialConnectionError(
      "That port is already in use — close the Arduino IDE Serial Monitor and try again.",
    );
  }
  if (name === "NetworkError") {
    return new SerialConnectionError(
      "Could not open the port. Unplug and replug the USB cable, then try again.",
    );
  }
  if (name === "SecurityError") {
    return new SerialConnectionError("Serial access was blocked by the browser.");
  }
  return new SerialConnectionError(message || "Could not connect to the device.");
}

/**
 * Prompt for a port and return a source bound to it.
 * Must be called from a user gesture — the browser requires it.
 */
export async function requestSerialSource(): Promise<AngleSource> {
  const serial = serialApi();
  if (!serial) {
    logErr("navigator.serial is undefined — this browser has no Web Serial.");
    throw new SerialConnectionError(
      "This browser does not support Web Serial. Use Chrome or Edge, or switch to simulation mode.",
    );
  }
  log("navigator.serial present; opening the port picker…");

  // Ports already permitted for this origin. Useful to see: a board that is
  // listed here but not offered by the picker is a different problem from one
  // the browser has never been granted at all.
  try {
    const known = await serial.getPorts();
    log(`${known.length} port(s) already permitted for this origin`,
        known.map(describePort));
  } catch {
    // Not fatal — this is diagnostics, not the connect path.
  }

  let port: SerialPortLike;
  const askedAt = performance.now();
  try {
    port = await serial.requestPort();
    log(`picker returned ${describePort(port)} after ${Math.round(performance.now() - askedAt)} ms`);
    await port.open({ baudRate: BAUD_RATE });
    log(`port open at ${BAUD_RATE} baud`);
  } catch (err) {
    const name = err instanceof Error ? err.name : "(not an Error)";
    const message = err instanceof Error ? err.message : String(err);
    logErr(`failed after ${Math.round(performance.now() - askedAt)} ms —`,
           `${name}: ${message}`);
    throw describe(err);
  }

  return createSerialSource(port);
}

/** Counters behind the throttled read-loop logging. */
interface TraceStats {
  bytes: number;
  lines: number;
  samples: number;
  malformed: number;
  openedAt: number;
  firstByteAt: number;
  lastSummaryAt: number;
  lastSummarySamples: number;
}

/** Log every line verbatim until this many samples have arrived, then summarise. */
const VERBATIM_SAMPLES = 5;
/** Interval of the throttled "still streaming" summary. */
const SUMMARY_MS = 2000;
/** How long to wait after `S` before concluding the board is not streaming. */
const SILENCE_MS = 2000;
/** Gap between `S` retries while waiting for the board to finish booting. */
const START_RETRY_MS = 500;
/** Give up re-arming after this long; past here it is not a boot race. */
const START_RETRY_LIMIT_MS = 6000;
/**
 * How long to allow for `Z`. The firmware averages CAL_SAMPLES=200 readings at
 * 100 Hz with a 10 ms delay each, so ~2 s of work; this leaves generous slack
 * before we conclude the board never answered.
 */
const CALIBRATION_TIMEOUT_MS = 6000;

function createSerialSource(port: SerialPortLike): AngleSource {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;
  /** true between sending `Z` and the board's answering status line */
  let calibrating = false;
  /** true once the board has zeroed, so the same connection does not redo it */
  let calibrated = false;
  /** learned from the first `D,` line; the bench sketch never answers `Z`/`S` */
  let protocol: DeviceProtocol | null = null;
  /** Returns true the first time a given protocol is learned, false on repeats. */
  function onProtocolDetected(p: DeviceProtocol): boolean {
    if (protocol) return false;
    protocol = p;
    if (p === "bench") {
      log("bench protocol detected (state-word D lines) — this is the",
          "experimental servo-assist sketch, not phixo_poc.ino. Skipping the",
          "Z zero handshake: this firmware has no extension reference.");
    }
    return true;
  }
  const encoder = new TextEncoder();
  const stats: TraceStats = {
    bytes: 0, lines: 0, samples: 0, malformed: 0,
    openedAt: 0, firstByteAt: 0, lastSummaryAt: 0, lastSummarySamples: 0,
  };

  /** Closes the `Z` handshake, whichever way the board answered. */
  function onCalibrationResult(ok: boolean) {
    calibrating = false;
    if (ok) calibrated = true;
  }

  /**
   * Zero the board at the extension end-stop.
   *
   * Without this the streamed angle is forearm tilt in the sensor's own frame,
   * carrying the mounting offset. ROM, cadence and consistency are differences
   * and survive that, but MAX FLEXION, MAX EXTENSION and EXTENSION DEFICIT are
   * absolute — a mounted offset reports a contracture that is not there — and
   * the charts draw against a fixed 0-150 deg scale the raw signal does not sit
   * on.
   *
   * The board stops streaming while it averages, so the telemetry gap here is
   * expected rather than a fault.
   */
  async function zeroAtExtension(handlers: AngleSourceHandlers) {
    if (closed || calibrated || calibrating) return;
    calibrating = true;
    handlers.onStatus({ calibrating: true, error: null });
    log("→ Z: zeroing at full extension — hold the brace at the extension end-stop",
        "(~2 s, telemetry pauses while the board averages)");
    await write("Z\n");

    setTimeout(() => {
      if (closed || !calibrating) return;
      calibrating = false;
      handlers.onStatus({ calibrating: false });
      logErr(`no calibration result ${CALIBRATION_TIMEOUT_MS} ms after Z.`,
             "Angles will carry the mounting offset — treat MAX FLEXION,",
             "MAX EXTENSION and EXTENSION DEFICIT as unreferenced.");
    }, CALIBRATION_TIMEOUT_MS);
  }

  async function write(text: string) {
    if (!port.writable || closed) {
      warn(`cannot send ${JSON.stringify(text)} —`,
           closed ? "source is stopped" : "port is not writable");
      return;
    }
    log(`→ device: ${JSON.stringify(text)}`);
    const writer = port.writable.getWriter();
    try {
      await writer.write(encoder.encode(text));
    } finally {
      writer.releaseLock();
    }
  }

  return {
    mode: "device",

    async start(handlers: AngleSourceHandlers) {
      if (!port.readable) {
        logErr("port.readable is null — opened, but nothing to read from.");
        throw new SerialConnectionError("The port opened but is not readable.");
      }
      handlers.onStatus({ connected: true, mode: "device", error: null });

      reader = port.readable.getReader();
      stats.openedAt = performance.now();
      log(`reading ${describePort(port)} — waiting for data…`);
      const decoder = new TextDecoder();
      let buffer = "";

      const reportProtocol = (p: DeviceProtocol) => {
        if (onProtocolDetected(p)) handlers.onStatus({ protocol: p });
      };

      // Read loop runs detached; it ends when the reader is cancelled by stop()
      // or when the cable is pulled, which surfaces as a stream error.
      void (async () => {
        try {
          while (!closed) {
            const { value, done } = await reader!.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            buffer += text;

            if (stats.bytes === 0) {
              stats.firstByteAt = performance.now();
              // The raw bytes, before any parsing. If the board is streaming but
              // the app shows nothing, the answer is visible right here: readable
              // CSV means a parse problem, mojibake means a baud mismatch.
              log(`first data after ${Math.round(stats.firstByteAt - stats.openedAt)} ms,`,
                  `${value.byteLength} bytes:`, JSON.stringify(text.slice(0, 120)));
            }
            stats.bytes += value.byteLength;

            let nl: number;
            while ((nl = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (line) parseLine(line, handlers, stats, onCalibrationResult, reportProtocol);
            }
            // A device that never sends a newline must not grow the buffer forever.
            if (buffer.length > 4096) {
              warn("4 kB without a newline — dropping the buffer.",
                   "Wrong baud rate, or the board is not running phixo_poc.ino.");
              buffer = "";
            }
          }
          log(`read loop ended — ${stats.samples} samples, ${stats.bytes} bytes total`);
        } catch (err) {
          if (!closed) {
            logErr("read loop failed:", err);
            handlers.onStatus({
              connected: false,
              signal: "lost",
              error: "The device disconnected. Check the USB cable.",
            });
          }
        }
      })();

      // Opening the port toggles DTR, which resets the board. A single `S` sent
      // now would land in the middle of setup() and be dropped, leaving the
      // firmware with streaming = false and the app waiting forever on a link
      // that is demonstrably working. So re-arm until telemetry actually starts.
      await write("S\n");
      const armedAt = performance.now();
      const rearm = setInterval(() => {
        const waited = performance.now() - armedAt;
        if (closed) {
          clearInterval(rearm);
          return;
        }
        // Telemetry proves the link and the firmware. Only now is it worth
        // spending two seconds zeroing — and zeroing after `S` rather than
        // before it matters, because calibrate() restores whatever streaming
        // state it found. Zero first and streaming would stay off.
        if (stats.samples > 0) {
          clearInterval(rearm);
          if (protocol === "clinical") void zeroAtExtension(handlers);
          return;
        }
        if (waited > START_RETRY_LIMIT_MS) {
          clearInterval(rearm);
          logErr(`no telemetry ${Math.round(waited)} ms after ${
            Math.round(START_RETRY_LIMIT_MS / START_RETRY_MS)} attempts at S.`,
            stats.bytes > 0
              ? "The board is talking but not streaming — is the IMU still wired? Check for an E, line."
              : "Nothing has arrived at all — check that the right sketch is flashed, and",
                "if it's the bench servo-assist sketch, that its physical start button has been pressed.");
          return;
        }
        log(`no telemetry yet after ${Math.round(waited)} ms — resending S`,
            "(the board resets when the port opens, so the first one can be lost)");
        void write("S\n");
      }, START_RETRY_MS);

      // The board should answer `S` immediately. Silence means it is not running
      // our firmware — the failure that looks identical to a broken UI.
      setTimeout(() => {
        if (!closed && stats.bytes === 0) {
          logErr(`no bytes ${SILENCE_MS} ms after sending S.`,
                 "The port is open but the board is not streaming — check that",
                 "phixo_poc.ino is flashed and that nothing else holds the port.");
        }
      }, SILENCE_MS);
    },

    async send(cmd: DeviceCommand) {
      await write(`${cmd}\n`);
    },

    async stop() {
      closed = true;
      log(`closing — ${stats.samples} samples, ${stats.lines} lines,`,
          `${stats.malformed} unparseable, ${stats.bytes} bytes`);
      try {
        await reader?.cancel();
        reader?.releaseLock();
      } catch {
        // Already gone — nothing to release.
      }
      try {
        await port.close();
      } catch {
        // Port may already be closed by an unplug.
      }
    },
  };
}

/** Parse one CSV line. Malformed lines are dropped rather than thrown. */
function parseLine(
  line: string,
  handlers: AngleSourceHandlers,
  stats: TraceStats,
  onCalibrationResult: (ok: boolean) => void,
  onProtocolDetected: (p: DeviceProtocol) => void,
): void {
  const parts = line.split(",");
  stats.lines += 1;

  if (parts[0] === "D" && parts.length >= 4) {
    const t = Number(parts[1]);
    const field2 = Number(parts[2]);
    const field3 = Number(parts[3]);
    const field5 = parts.length >= 5 ? parts[4].trim() : "";

    // The bench (servo-assist) sketch's 5th field is a state word, not the
    // documented protocol's numeric motor flag — that's how a board's actual
    // firmware is told apart from the one AGENTS.md describes.
    if (BENCH_STATES.has(field5)) {
      if (Number.isFinite(t) && Number.isFinite(field2) && Number.isFinite(field3)) {
        stats.samples += 1;
        onProtocolDetected("bench");
        if (stats.samples <= VERBATIM_SAMPLES || verboseEnabled()) {
          log(`← D sample #${stats.samples} [bench]: t=${t} ms  servoPos=${field2}  pathDeg=${field3}  state=${field5}`);
          if (stats.samples === VERBATIM_SAMPLES && !verboseEnabled()) {
            log(`…further samples summarised every ${SUMMARY_MS / 1000} s.`,
                'For every line: localStorage.phixoDebug = "verbose", then reconnect.');
          }
        } else {
          summarise(stats, field2, field3);
        }
        handlers.onSample({
          t, angle: field2, vel: 0,
          bench: { servoPos: field2, pathDeg: field3, state: field5 as "IDLE" | "MOVING" | "ASSIST" | "TARGET" },
        });
      } else {
        stats.malformed += 1;
        warn(`D line with non-numeric fields (dropped): ${JSON.stringify(line)}`);
      }
      return;
    }

    const angle = field2;
    const vel = field3;
    // Fifth field is motor state, added when the rig became patient-driven.
    // Absent on older firmware, and absence must stay distinct from "0": one
    // means assistance was not measured, the other that none was given.
    const motorActive = parts.length >= 5 ? field5 === "1" : undefined;
    if (Number.isFinite(t) && Number.isFinite(angle) && Number.isFinite(vel)) {
      stats.samples += 1;
      onProtocolDetected("clinical");
      // 50 Hz would drown the console, so: every line while you are still
      // checking that it works, then a rate summary once it plainly does.
      if (stats.samples <= VERBATIM_SAMPLES || verboseEnabled()) {
        log(`← D sample #${stats.samples}: t=${t} ms  angle=${angle}°  vel=${vel}°/s` +
            (motorActive === undefined ? "" : `  motor=${motorActive ? "on" : "off"}`));
        if (stats.samples === VERBATIM_SAMPLES && !verboseEnabled()) {
          log(`…further samples summarised every ${SUMMARY_MS / 1000} s.`,
              'For every line: localStorage.phixoDebug = "verbose", then reconnect.');
        }
      } else {
        summarise(stats, angle, vel);
      }
      handlers.onSample({ t, angle, vel, ...(motorActive === undefined ? {} : { motorActive }) });
    } else {
      stats.malformed += 1;
      warn(`D line with non-numeric fields (dropped): ${JSON.stringify(line)}`);
    }
    return;
  }

  if (parts[0] === "S" && parts.length >= 5) {
    const rateHz = Number(parts[4]);
    const isCalibrated = parts[1] === "1";
    const zeroDeg = Number(parts[3]);
    // This line doubles as the completion handshake for `Z`: calibrate() ends by
    // sending it, so calibrated=1 here is how the app learns the zero took.
    log(`← S status: calibrated=${isCalibrated} gyroBias=${parts[2]}`,
        `zeroDeg=${parts[3]} rateHz=${parts[4]}`);
    if (isCalibrated) {
      log(`zeroed at ${zeroDeg.toFixed(1)}° in the sensor frame —`,
          "streamed angles are now clinical: 0° = full extension.");
      onCalibrationResult(true);
    }
    handlers.onStatus({
      rateHz: Number.isFinite(rateHz) ? rateHz : 50,
      calibrated: isCalibrated,
      zeroDeg: Number.isFinite(zeroDeg) ? zeroDeg : null,
      ...(isCalibrated ? { calibrating: false } : {}),
      error: null,
    });
    return;
  }

  if (parts[0] === "E") {
    const detail = parts.slice(1).join(",");
    logErr(`← E device error: ${detail}`);
    // A failed zero is not a dead link — the board carries on streaming, just
    // without a reference. Release the calibrating state so the UI stops waiting
    // and the run can continue with absolute angles flagged as unreferenced.
    if (detail === "calibration_failed") {
      logErr("zeroing failed — the board could not read the IMU steadily enough.",
             "Angles will carry the mounting offset.");
      onCalibrationResult(false);
      handlers.onStatus({
        calibrating: false,
        error: "Zeroing failed — angles are unreferenced. Re-seat the sensor and reconnect.",
      });
      return;
    }
    handlers.onStatus({ error: detail || "Device reported an error." });
    return;
  }

  // `R` diagnostic dumps start with '#', and are worth seeing while checking the
  // axis mapping. Anything else is a wire-format mismatch.
  stats.malformed += 1;
  if (line.startsWith("#")) {
    log(`← raw axes: ${line}`);
  } else if (stats.malformed <= 5) {
    warn(`unrecognised line (dropped): ${JSON.stringify(line)}`);
  }
}

/** Throttled "still streaming" line: measured rate is the number that matters. */
function summarise(stats: TraceStats, angle: number, vel: number): void {
  const now = performance.now();
  if (stats.lastSummaryAt === 0) {
    stats.lastSummaryAt = now;
    stats.lastSummarySamples = stats.samples;
    return;
  }
  const elapsed = now - stats.lastSummaryAt;
  if (elapsed < SUMMARY_MS) return;

  const hz = ((stats.samples - stats.lastSummarySamples) * 1000) / elapsed;
  log(`streaming ${hz.toFixed(1)} Hz — ${stats.samples} samples,`,
      `angle=${angle.toFixed(1)}° vel=${vel.toFixed(1)}°/s`,
      stats.malformed ? `(${stats.malformed} unparseable)` : "");
  stats.lastSummaryAt = now;
  stats.lastSummarySamples = stats.samples;
}
