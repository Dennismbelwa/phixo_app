"use client";

/**
 * Real-sensor bedside session, driven by the physical POC.
 *
 * This is a sibling of the simulated SessionPlayer, not a replacement: the
 * simulator route is untouched and stays available. What differs here is that
 * every number on screen is derived from measured elbow angle rather than
 * generated, and repetitions are detected from the signal rather than counted
 * off a timer.
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity, Cable, CircleStop, Play, RotateCcw, Ruler } from "lucide-react";

import { useAngleSource } from "./use-angle-source";
import { DeviceStatusChip } from "./device-status-chip";
import { AngleTrace } from "@/components/angle-trace";
import { ArmFigure } from "./arm-figure";
import { LiveMetricTiles } from "./live-metric-tiles";
import { BenchMetricTiles } from "./bench-metric-tiles";
import { RepTable } from "./rep-table";
import { requestSerialSource, isSerialSupported, SerialConnectionError } from "@/lib/device/serial";
import { createMockSource } from "@/lib/device/mock-source";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface LiveSessionProps {
  patientId: string;
  patientName: string;
  affectedSide: string;
  /** Repetitions the rig will drive before the session stops itself. */
  targetReps: number;
  /** Clinical reference the count is shown against; display only. */
  guidelineReps: number;
  exercises: { id: string; name: string }[];
}

/**
 * A requestPort() rejection faster than this did not come from a person — no
 * human dismisses a file-picker-style dialog in a quarter second.
 */
const NO_PICKER_MS = 250;

/** Web Serial support cannot change during a session, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

export function LiveSession(props: LiveSessionProps) {
  const router = useRouter();
  const [exerciseId, setExerciseId] = useState(props.exercises[0]?.id ?? "elbow_flex");
  const [limb, setLimb] = useState<"affected" | "unaffected">("affected");
  const [connecting, setConnecting] = useState(false);
  // navigator.serial does not exist on the server, so the server snapshot is a
  // flat false and the real value arrives after hydration — reading it during
  // render instead would be a hydration mismatch.
  const serialSupported = useSyncExternalStore(
    subscribeNever,
    isSerialSupported,
    () => false,
  );

  const device = useAngleSource({
    patientId: props.patientId,
    exerciseId,
    limb,
    targetReps: props.targetReps,
    onFinished: (sessionId) => {
      toast.success(`Session complete — ${props.targetReps} repetitions recorded.`);
      router.push(`/dashboard/${props.patientId}/session/${sessionId}`);
    },
  });

  const { status, metrics, recording } = device;
  const live = status.connected && status.signal !== "lost";
  // Protocol is learned from the first `D,` line and resets to unknown on
  // every connect() — and the bench sketch only sends that line once its
  // physical button is pressed, which can be well after the port opens.
  // For this demo period the board on the bench is the bench sketch, so
  // default to its layout (rep counter included) for the whole time a real
  // port is connected, rather than dropping to a "waiting" placeholder or
  // the clinical layout until data proves it. Only a confirmed clinical `D,`
  // line switches this back.
  const bench = status.mode === "device" && status.protocol !== "clinical";

  const connectDevice = useCallback(async () => {
    setConnecting(true);
    const startedAt = performance.now();
    try {
      await device.connect(await requestSerialSource());
      toast.success("POC connected — receiving live sensor data.");
    } catch (err) {
      if (err instanceof SerialConnectionError) {
        if (!err.cancelled) {
          toast.error(err.message);
        } else if (performance.now() - startedAt < NO_PICKER_MS) {
          // A cancel this fast was not a human dismissing a dialog — the port
          // picker never opened. Embedded browsers (in-app previews, Electron
          // shells) expose navigator.serial but cannot show Chrome's picker, so
          // requestPort rejects instantly and would otherwise fail silently.
          toast.error(
            "No port picker appeared — open this page in Chrome or Edge directly, not an in-app browser.",
          );
        } else {
          toast.info("No device selected.");
        }
      } else {
        toast.error("Could not connect to the device.");
      }
    } finally {
      setConnecting(false);
    }
  }, [device]);

  const connectMock = useCallback(async () => {
    // A synthetic patient who initiates each cycle and stalls partway, so the
    // assist-as-needed split is exercised rather than left unmeasured.
    await device.connect(createMockSource({ reps: props.targetReps, assistPct: 45 }));
    toast.info("Simulation mode — synthetic movement, no hardware attached.");
  }, [device, props.targetReps]);

  const finish = useCallback(async () => {
    const id = await device.endRecording();
    if (id) router.push(`/dashboard/${props.patientId}/session/${id}`);
  }, [device, router, props.patientId]);

  return (
    <div className="flex flex-col gap-5">
      {/* ---- connection bar ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DeviceStatusChip status={status} />
        <div className="flex flex-wrap items-center gap-2">
          {!status.connected ? (
            <>
              <Button onClick={connectDevice} disabled={connecting || !serialSupported}>
                <Cable className="size-4" />
                {connecting ? "Connecting…" : "Connect POC"}
              </Button>
              <Button variant="outline" onClick={connectMock}>
                Simulation mode
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => device.disconnect()} disabled={recording}>
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {!serialSupported && !status.connected && (
        <p className="rounded-lg border border-[var(--chart-3)]/40 bg-[var(--chart-3)]/10 px-4 py-3 text-sm">
          This browser cannot talk to USB devices. Open Phixo in Chrome or Edge to connect the
          physical POC, or continue in simulation mode.
        </p>
      )}

      {status.connected && status.signal === "lost" && (
        <p className="rounded-lg border border-[var(--chart-5)]/40 bg-[var(--chart-5)]/10 px-4 py-3 text-sm">
          Signal lost — check the USB cable and that the rig is powered. The session stays open and
          will resume automatically when data returns.
        </p>
      )}

      {status.error && (
        <p className="rounded-lg border border-[var(--chart-5)]/40 bg-[var(--chart-5)]/10 px-4 py-3 text-sm">
          {status.error}
        </p>
      )}

      {bench && (
        <p className="rounded-lg border border-[var(--chart-3)]/40 bg-[var(--chart-3)]/10 px-4 py-3 text-sm">
          This board is running the bench servo-assist sketch, not the documented phixo_poc.ino —
          the numbers below are raw servo position and gyro path, not a clinical elbow angle.
          Session recording is disabled while connected to it.
        </p>
      )}

      {/* ---- setup / run controls ---- */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Exercise</label>
            <Select value={exerciseId} onValueChange={setExerciseId} disabled={recording}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {props.exercises.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Limb</label>
            <Select
              value={limb}
              onValueChange={(v) => setLimb(v as "affected" | "unaffected")}
              disabled={recording}
            >
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="affected">
                  Affected ({props.affectedSide})
                </SelectItem>
                <SelectItem value="unaffected">Unaffected (reference)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!recording ? (
              <Button size="lg" onClick={() => device.beginRecording()} disabled={!live || bench}>
                <Play className="size-4" />
                Start session
              </Button>
            ) : (
              <Button size="lg" variant="destructive" onClick={finish}>
                <CircleStop className="size-4" />
                Finish session
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- live readout ---- */}
      {bench ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <p className="font-mono text-6xl font-semibold tabular-nums text-[var(--chart-2)]">
              {device.bench?.servoPos.toFixed(0) ?? "—"}
            </p>
            <p className="text-sm text-muted-foreground">Servo position (raw)</p>
            <Badge variant="outline" className="mt-1 font-mono">
              {device.bench?.state ?? "—"}
            </Badge>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
            <ArmFigure angleRef={device.angleRef} className="h-32 w-48 text-foreground" />
            <div className="text-center">
              <p className="font-mono text-6xl font-semibold tabular-nums text-[var(--chart-2)]">
                {device.angle.toFixed(0)}°
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Live elbow angle</p>
              {recording && (
                <Badge variant="outline" className="mt-2 border-[var(--chart-2)]/40 text-[var(--chart-2)]">
                  <Activity className="size-3" /> Recording
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {bench ? (
        <BenchMetricTiles bench={device.bench} benchReps={device.benchReps} />
      ) : (
        <LiveMetricTiles
          angle={device.angle}
          metrics={metrics}
          detector={device.detector}
          recording={recording}
          guidelineReps={props.guidelineReps}
        />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="size-4 text-muted-foreground" />
            {bench ? "Servo position over time (raw)" : "Elbow angle over time"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AngleTrace traceRef={device.traceRef} live={live} className="h-56 w-full" />
        </CardContent>
      </Card>

      {!bench && (
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Repetition analysis</CardTitle>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {device.detector.rejected > 0 && (
                <span className="flex items-center gap-1">
                  <RotateCcw className="size-3" />
                  {device.detector.rejected} cycle
                  {device.detector.rejected === 1 ? "" : "s"} rejected
                </span>
              )}
              <span>Last 10 of {metrics.repCount}</span>
            </div>
          </CardHeader>
          <CardContent>
            <RepTable reps={device.reps} limit={10} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
