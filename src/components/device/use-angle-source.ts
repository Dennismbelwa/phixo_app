"use client";

/**
 * Binds an AngleSource (real USB port, mock generator or stored replay) to the
 * repetition detector, the live canvas and the database.
 *
 * Rendering strategy: samples arrive at 50 Hz, which is far too fast to drive
 * React state. The canvas reads a ring buffer through a ref at its own frame
 * rate, and only the coarse readouts are re-rendered, throttled to ~10 Hz.
 * Repetitions are rare enough (~0.5 Hz) to be plain state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  startDeviceSession,
  appendDeviceReps,
  appendSamples,
  endDeviceSession,
} from "@/lib/actions";
import { createRepDetector, type DetectorState, type RepDetector } from "@/lib/device/rep-detector";
import { summarizeReps, EMPTY_METRICS, type SessionMetrics } from "@/lib/device/metrics";
import {
  IDLE_STATUS,
  type AngleSource,
  type DetectedRep,
  type DeviceCommand,
  type DeviceSample,
  type DeviceStatus,
} from "@/lib/device/types";

/** 30 s of history at 50 Hz — the width of the live trace. */
const TRACE_CAPACITY = 1500;
/** Write reps through after this many, matching the existing bedside player. */
const REP_FLUSH_SIZE = 5;
/** Write raw telemetry through in ~5 s blocks. */
const SAMPLE_FLUSH_SIZE = 250;
const READOUT_INTERVAL_MS = 100;

export interface UseAngleSource {
  status: DeviceStatus;
  /** most recent angle, throttled for display, degrees */
  angle: number;
  reps: DetectedRep[];
  metrics: SessionMetrics;
  detector: DetectorState;
  /** live ring buffer for the canvas — read, never mutate */
  traceRef: React.RefObject<DeviceSample[]>;
  /** live angle for the canvas, updated every sample */
  angleRef: React.RefObject<number>;
  recording: boolean;
  sessionId: string | null;
  connect: (source: AngleSource) => Promise<void>;
  disconnect: () => Promise<void>;
  send: (cmd: DeviceCommand) => Promise<void>;
  beginRecording: () => Promise<void>;
  endRecording: () => Promise<string | null>;
}

export interface UseAngleSourceOptions {
  patientId: string;
  exerciseId: string;
  limb: "affected" | "unaffected";
  /** stop automatically once this many reps are recorded */
  targetReps?: number;
  onFinished?: (sessionId: string) => void;
}

export function useAngleSource(options: UseAngleSourceOptions): UseAngleSource {
  const [status, setStatus] = useState<DeviceStatus>(IDLE_STATUS);
  const [angle, setAngle] = useState(0);
  const [reps, setReps] = useState<DetectedRep[]>([]);
  const [metrics, setMetrics] = useState<SessionMetrics>(EMPTY_METRICS);
  const [detector, setDetector] = useState<DetectorState>({
    armed: false, amplitudeDeg: 0, loDeg: 0, hiDeg: 0, count: 0, rejected: 0,
  });
  const [recording, setRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const sourceRef = useRef<AngleSource | null>(null);
  const detectorRef = useRef<RepDetector | null>(null);
  const traceRef = useRef<DeviceSample[]>([]);
  const angleRef = useRef(0);
  const statusRef = useRef<DeviceStatus>(IDLE_STATUS);
  const recordingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const pendingRepsRef = useRef<DetectedRep[]>([]);
  const pendingSamplesRef = useRef<DeviceSample[]>([]);
  const allRepsRef = useRef<DetectedRep[]>([]);
  const rateWindowRef = useRef<number[]>([]);
  // Mirrored into a ref so the sample handler stays referentially stable while
  // still seeing the latest exercise, limb and target.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const patchStatus = useCallback((patch: Partial<DeviceStatus>) => {
    statusRef.current = { ...statusRef.current, ...patch };
    setStatus(statusRef.current);
  }, []);

  /** Push queued reps and telemetry to the database. Safe to call at any time. */
  const flush = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    const repBatch = pendingRepsRef.current;
    const sampleBatch = pendingSamplesRef.current;
    pendingRepsRef.current = [];
    pendingSamplesRef.current = [];
    if (repBatch.length) await appendDeviceReps(id, repBatch);
    if (sampleBatch.length) await appendSamples(id, sampleBatch);
  }, []);

  const endRecording = useCallback(async (): Promise<string | null> => {
    const id = sessionIdRef.current;
    if (!id) return null;

    // The rising-to-rising rep boundary leaves the final cycle buffered, so a
    // manual stop must flush it — otherwise a 130-cycle run reports 129. But if
    // the target has already been reached the buffered cycle is the *next* one
    // starting, and flushing it would overshoot to 131.
    const target = optionsRef.current.targetReps;
    const alreadyComplete = target != null && allRepsRef.current.length >= target;
    const last = alreadyComplete ? null : detectorRef.current?.flush();
    if (last) {
      allRepsRef.current = [...allRepsRef.current, last];
      pendingRepsRef.current.push(last);
      setReps(allRepsRef.current);
      setMetrics(summarizeReps(allRepsRef.current));
    }

    recordingRef.current = false;
    setRecording(false);
    await flush();
    await endDeviceSession(id);
    sessionIdRef.current = null;
    setSessionId(null);
    return id;
  }, [flush]);

  const handleSample = useCallback(
    (s: DeviceSample) => {
      angleRef.current = s.angle;

      const trace = traceRef.current;
      trace.push(s);
      if (trace.length > TRACE_CAPACITY) trace.splice(0, trace.length - TRACE_CAPACITY);

      // Arrival rate over a rolling one-second window — shown in the status chip
      // as evidence that telemetry is genuinely streaming.
      const now = Date.now();
      const win = rateWindowRef.current;
      win.push(now);
      while (win.length && now - win[0] > 1000) win.shift();

      statusRef.current = {
        ...statusRef.current,
        lastSampleAt: now,
        samples: statusRef.current.samples + 1,
        rateHz: win.length,
        signal: "stable",
        connected: true,
      };

      // Detect always, record conditionally. The detector's envelope is what
      // drives the live range readouts, so gating the push on `recording` left
      // five of the six tiles dead while the angle beside them moved.
      const rep = detectorRef.current?.push(s) ?? null;

      if (!recordingRef.current) return;

      pendingSamplesRef.current.push(s);
      if (rep) {
        allRepsRef.current = [...allRepsRef.current, rep];
        pendingRepsRef.current.push(rep);
        setReps(allRepsRef.current);
        setMetrics(summarizeReps(allRepsRef.current));

        const target = optionsRef.current.targetReps;
        if (target && allRepsRef.current.length >= target) {
          void endRecording().then((id) => {
            if (id) optionsRef.current.onFinished?.(id);
          });
          return;
        }
      }

      if (
        pendingRepsRef.current.length >= REP_FLUSH_SIZE ||
        pendingSamplesRef.current.length >= SAMPLE_FLUSH_SIZE
      ) {
        void flush();
      }
    },
    [flush, endRecording],
  );

  const connect = useCallback(
    async (source: AngleSource) => {
      await sourceRef.current?.stop();
      traceRef.current = [];
      rateWindowRef.current = [];
      sourceRef.current = source;
      detectorRef.current = createRepDetector();
      statusRef.current = { ...IDLE_STATUS, mode: source.mode };
      setStatus(statusRef.current);
      await source.start({ onSample: handleSample, onStatus: patchStatus });
    },
    [handleSample, patchStatus],
  );

  const disconnect = useCallback(async () => {
    if (recordingRef.current) await endRecording();
    await sourceRef.current?.stop();
    sourceRef.current = null;
    patchStatus({ connected: false, signal: "lost", rateHz: 0 });
  }, [endRecording, patchStatus]);

  const send = useCallback(async (cmd: DeviceCommand) => {
    await sourceRef.current?.send(cmd);
  }, []);

  const beginRecording = useCallback(async () => {
    if (recordingRef.current) return;
    const o = optionsRef.current;
    detectorRef.current = createRepDetector();
    allRepsRef.current = [];
    pendingRepsRef.current = [];
    pendingSamplesRef.current = [];
    setReps([]);
    setMetrics(EMPTY_METRICS);

    const id = await startDeviceSession(
      o.patientId,
      o.exerciseId,
      o.limb,
      statusRef.current.rateHz || 50,
    );
    sessionIdRef.current = id;
    setSessionId(id);
    recordingRef.current = true;
    setRecording(true);
  }, []);

  // Coarse readouts and the connection watchdog, both at 10 Hz. Doing this on a
  // timer rather than per sample is what keeps 50 Hz telemetry off the React
  // render path entirely.
  useEffect(() => {
    const timer = setInterval(() => {
      setAngle(angleRef.current);
      const ds = detectorRef.current?.state;
      setDetector(
        ds
          ? { ...ds }
          : { armed: false, amplitudeDeg: 0, loDeg: 0, hiDeg: 0, count: 0, rejected: 0 },
      );

      // The status chip renders status.rejected, but nothing was ever writing
      // it — the counter lives on the detector. Mirror it across so the chip
      // stops silently under-reporting discarded cycles.
      if (ds && ds.rejected !== statusRef.current.rejected) {
        statusRef.current = { ...statusRef.current, rejected: ds.rejected };
        setStatus(statusRef.current);
      }

      const since = Date.now() - statusRef.current.lastSampleAt;
      if (statusRef.current.connected && statusRef.current.lastSampleAt > 0) {
        const signal = since < 1000 ? "stable" : since < 3000 ? "weak" : "lost";
        if (signal !== statusRef.current.signal || statusRef.current.rateHz > 0) {
          statusRef.current = {
            ...statusRef.current,
            signal,
            rateHz: since > 1000 ? 0 : statusRef.current.rateHz,
          };
          setStatus(statusRef.current);
        }
      }
    }, READOUT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Don't lose the tail of a session if the tab is closed mid-run.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
      void sourceRef.current?.stop();
    };
  }, [flush]);

  return {
    status, angle, reps, metrics, detector, traceRef, angleRef,
    recording, sessionId, connect, disconnect, send, beginRecording, endRecording,
  };
}
