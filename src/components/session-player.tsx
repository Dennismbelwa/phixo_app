"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createRepStream,
  emgSample,
  SimulatedRep,
  ImpairmentProfile,
  SAFETY_EVENT_LABELS,
  SafetyEventType,
} from "@/lib/simulator/engine";
import { startSession, appendReps, endSession, logSafetyEvent } from "@/lib/actions";
import { GoalRing } from "@/components/goal-ring";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SessionPlayerProps {
  patientId: string;
  patientName: string;
  affectedSide: string;
  dayIndex: number;
  profile: ImpairmentProfile;
  maxAssistPct: number;
  targetRepsPerDay: number;
  repsTodayInitial: number;
  exercises: { id: string; name: string }[];
}

type Phase = "setup" | "running" | "safety_pause" | "resting" | "ended";

interface LiveState {
  repPhase: number; // 0..1 through the current rep
  currentRep: SimulatedRep | null;
  completed: number;
  lastCompleted: SimulatedRep | null;
  safety: SafetyEventType | null;
}

const ENCOURAGEMENTS = [
  "Great effort — keep going!",
  "Your brain is rewiring with every rep.",
  "Strong signal detected — well done!",
  "Beautiful, controlled movement.",
  "Every repetition counts this week.",
];

export function SessionPlayer(props: SessionPlayerProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("setup");
  const [exerciseId, setExerciseId] = useState(props.exercises[0]?.id ?? "elbow_flex");
  const [operator, setOperator] = useState<"patient" | "family">("patient");
  const [speed, setSpeed] = useState(1);
  // Frozen at mount: router.refresh() after the session would otherwise update
  // the prop to include this session's reps and double-count "today".
  const [repsTodayStart] = useState(props.repsTodayInitial);
  const [live, setLive] = useState<LiveState>({
    repPhase: 0,
    currentRep: null,
    completed: 0,
    lastCompleted: null,
    safety: null,
  });

  const streamRef = useRef<ReturnType<typeof createRepStream> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingRef = useRef<SimulatedRep[]>([]);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef<Phase>("setup");
  const speedRef = useRef(1);
  const repStartRef = useRef(0);
  const restUntilRef = useRef(0);
  const currentRepRef = useRef<SimulatedRep | null>(null);
  const completedRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<number[]>([]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const flush = useCallback(async () => {
    const batch = pendingRef.current;
    if (batch.length === 0 || !sessionIdRef.current) return;
    pendingRef.current = [];
    try {
      await appendReps(sessionIdRef.current, props.patientId, batch);
    } catch {
      // demo resilience: re-queue on transient failure
      pendingRef.current = batch.concat(pendingRef.current);
    }
  }, [props.patientId]);

  const begin = useCallback(async () => {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    streamRef.current = createRepStream({
      profile: props.profile,
      dayIndex: props.dayIndex,
      seed,
      maxAssistPct: props.maxAssistPct,
    });
    sessionIdRef.current = await startSession(props.patientId, exerciseId, operator);
    const first = streamRef.current.next();
    currentRepRef.current = first;
    repStartRef.current = performance.now();
    completedRef.current = 0;
    setLive({ repPhase: 0, currentRep: first, completed: 0, lastCompleted: null, safety: null });
    setPhase("running");
  }, [exerciseId, operator, props]);

  const endedRef = useRef(false);

  const finish = useCallback(async () => {
    cancelAnimationFrame(rafRef.current);
    setPhase("ended");
    endedRef.current = true;
    await flush();
    if (sessionIdRef.current) await endSession(sessionIdRef.current);
    router.refresh();
  }, [flush, router]);

  // If the user navigates away mid-session (SPA navigation skips pagehide),
  // persist pending reps and close the session so it isn't orphaned.
  useEffect(() => {
    const patientId = props.patientId;
    return () => {
      if (endedRef.current || !sessionIdRef.current) return;
      const sessionId = sessionIdRef.current;
      const batch = pendingRef.current;
      pendingRef.current = [];
      (batch.length > 0
        ? appendReps(sessionId, patientId, batch)
        : Promise.resolve()
      ).finally(() => endSession(sessionId));
    };
  }, [props.patientId]);

  // Main animation / simulation loop
  useEffect(() => {
    if (phase !== "running" && phase !== "resting") return;

    const loop = (now: number) => {
      const p = phaseRef.current;
      const rep = currentRepRef.current;
      if (!rep) return;

      if (p === "resting") {
        if (now >= restUntilRef.current) {
          const nextRep = streamRef.current!.next();
          currentRepRef.current = nextRep;
          repStartRef.current = now;
          setLive((s) => ({ ...s, currentRep: nextRep, repPhase: 0 }));
          setPhase("running");
        }
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const elapsed = (now - repStartRef.current) * speedRef.current;
      const repPhase = Math.min(1, elapsed / rep.durationMs);

      // Safety guardrail fires mid-assist. The interrupted rep is never stored,
      // but the event itself must reach the therapist's alert queue.
      if (rep.safetyEvent && repPhase > 0.55) {
        setLive((s) => ({ ...s, repPhase, safety: rep.safetyEvent }));
        setPhase("safety_pause");
        if (sessionIdRef.current) {
          logSafetyEvent(sessionIdRef.current, props.patientId, rep.safetyEvent);
        }
        flush();
        return;
      }

      if (repPhase >= 1) {
        completedRef.current += 1;
        pendingRef.current.push(rep);
        if (pendingRef.current.length >= 10) flush();
        setLive((s) => ({
          ...s,
          repPhase: 1,
          completed: completedRef.current,
          lastCompleted: rep,
        }));
        restUntilRef.current = now + 700 / speedRef.current;
        setPhase("resting");
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      setLive((s) => ({ ...s, repPhase }));
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, flush, props.patientId]);

  // EMG waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;

    const draw = (now: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
      }
      const rep = currentRepRef.current;
      const running = phaseRef.current === "running";
      const repPhase = rep && running
        ? Math.min(1, ((now - repStartRef.current) * speedRef.current) / rep.durationMs)
        : 0;
      const intent = rep ? rep.emgPeak : 0;
      const sample = running ? emgSample(repPhase, intent, now / 1000) : (Math.sin(now / 180) * 0.02);
      const samples = samplesRef.current;
      samples.push(sample);
      if (samples.length > 220) samples.shift();

      ctx.clearRect(0, 0, w, h);
      // midline
      ctx.strokeStyle = "color-mix(in oklab, currentColor 15%, transparent)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      // waveform
      const styles = getComputedStyle(canvas);
      ctx.strokeStyle = styles.getPropertyValue("--chart-2").trim() || "#3f9e5f";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      samples.forEach((v, i) => {
        const x = (i / 219) * w;
        const y = h / 2 - v * (h / 2 - 6);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Flush pending reps if the tab closes mid-session
  useEffect(() => {
    const onHide = () => {
      flush();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  const totalToday = repsTodayStart + live.completed;
  const rep = live.currentRep;
  const inAssist = live.repPhase > 0.4;
  const stepLabel =
    phase === "resting"
      ? "Rest…"
      : live.repPhase < 0.15
        ? "Try to move your " + (props.affectedSide === "left" ? "left" : "right") + " side"
        : live.repPhase < 0.4
          ? "Intent detected — keep pushing!"
          : live.repPhase < 0.9
            ? "Phixo is assisting the movement"
            : "Rep complete!";

  /* ------------------------------- setup ------------------------------- */
  if (phase === "setup") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-6 p-6">
          <div>
            <h2 className="text-lg font-semibold">Start a session</h2>
            <p className="text-sm text-muted-foreground">
              Attach the Phixo cuff to the {props.affectedSide} limb, then choose an exercise.
            </p>
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium">Exercise</p>
            <div className="flex flex-wrap gap-2">
              {props.exercises.map((e) => (
                <Button
                  key={e.id}
                  variant={exerciseId === e.id ? "default" : "outline"}
                  size="lg"
                  onClick={() => setExerciseId(e.id)}
                >
                  {e.name}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium">Who is operating?</p>
            <div className="flex gap-2">
              <Button
                variant={operator === "patient" ? "default" : "outline"}
                size="lg"
                onClick={() => setOperator("patient")}
              >
                I am the patient
              </Button>
              <Button
                variant={operator === "family" ? "default" : "outline"}
                size="lg"
                onClick={() => setOperator("family")}
              >
                Family member / staff
              </Button>
            </div>
          </div>
          <Button size="lg" className="h-14 text-lg" onClick={begin}>
            Begin exercises
          </Button>
        </CardContent>
      </Card>
    );
  }

  /* ------------------------------- ended ------------------------------- */
  if (phase === "ended") {
    const last = live.lastCompleted;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
          <span className="text-5xl" aria-hidden>🎉</span>
          <h2 className="text-2xl font-semibold">Session complete</h2>
          <p className="text-muted-foreground">
            {live.completed} repetitions this session — {totalToday} today.
          </p>
          {last ? (
            <p className="text-sm text-muted-foreground">
              Your own force on the final rep: {Math.round(last.patientForcePct)}%
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button size="lg" onClick={() => location.reload()}>
              Start another session
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href={`/patient/${props.patientId}`}>Back to my day</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  /* --------------------------- live session ---------------------------- */
  return (
    <div className="grid gap-4">
      {/* Safety pause overlay */}
      {phase === "safety_pause" && live.safety ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <Card className="max-w-md border-destructive">
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <span className="text-4xl" aria-hidden>⚠️</span>
              <h2 className="text-xl font-semibold text-destructive">
                {SAFETY_EVENT_LABELS[live.safety]}
              </h2>
              <p className="text-sm text-muted-foreground">
                The device has paused automatically and released tension. This has been
                logged for your care team. Rest for a moment before continuing.
              </p>
              <div className="flex gap-3">
                <Button
                  size="lg"
                  onClick={() => {
                    // skip the flagged rep, continue with a fresh one
                    const nextRep = streamRef.current!.next();
                    currentRepRef.current = nextRep;
                    repStartRef.current = performance.now();
                    setLive((s) => ({ ...s, safety: null, currentRep: nextRep, repPhase: 0 }));
                    setPhase("running");
                  }}
                >
                  I&apos;m okay — continue
                </Button>
                <Button size="lg" variant="outline" onClick={finish}>
                  End session
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <Card>
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {props.exercises.find((e) => e.id === exerciseId)?.name}
                </p>
                <p className="text-lg font-medium">{stepLabel}</p>
              </div>
              <Badge variant="secondary" className="text-xs">
                {operator === "family" ? "Operated by family" : "Self-operated"}
              </Badge>
            </div>

            {/* Rep counter */}
            <div className="flex items-end justify-center gap-3 py-2">
              <span className="text-7xl font-semibold tabular-nums leading-none">
                {live.completed}
              </span>
              <span className="pb-2 text-muted-foreground">reps this session</span>
            </div>

            {/* EMG strip */}
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-chart-2" aria-hidden />
                  Muscle signal (EMG) — your intent
                </span>
                <span className={cn("transition-opacity", live.repPhase > 0.1 && live.repPhase < 0.9 ? "opacity-100" : "opacity-0")}>
                  ● live
                </span>
              </div>
              <canvas ref={canvasRef} className="h-24 w-full rounded-md border bg-card" />
            </div>

            {/* Effort split for current rep */}
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Your force</span>
                <span>Phixo assistance</span>
              </div>
              <div
                className="flex h-6 w-full overflow-hidden rounded-md"
                role="img"
                aria-label={
                  rep
                    ? `You ${Math.round(rep.patientForcePct)}%, device ${Math.round(rep.assistPct)}%`
                    : "waiting"
                }
              >
                <div
                  className="bg-chart-2 transition-all duration-300"
                  style={{ width: `${rep && inAssist ? rep.patientForcePct : rep ? Math.min(rep.patientForcePct, live.repPhase * 250) : 0}%` }}
                />
                <div className="w-0.5 bg-background" aria-hidden />
                <div
                  className="bg-chart-1 transition-all duration-300"
                  style={{ width: `${rep && inAssist ? rep.assistPct : 0}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-sm font-medium tabular-nums">
                <span className="text-chart-2">{rep && inAssist ? `${Math.round(rep.patientForcePct)}%` : "—"}</span>
                <span className="text-chart-1">{rep && inAssist ? `${Math.round(rep.assistPct)}%` : "—"}</span>
              </div>
            </div>

            {live.completed > 0 && live.completed % 25 === 0 ? (
              <p className="text-center text-sm font-medium text-chart-2">
                {ENCOURAGEMENTS[(live.completed / 25 - 1) % ENCOURAGEMENTS.length]}
              </p>
            ) : null}

            <div className="flex items-center justify-between border-t pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Demo speed</span>
                {[1, 4, 10].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={speed === s ? "secondary" : "ghost"}
                    onClick={() => setSpeed(s)}
                  >
                    {s}×
                  </Button>
                ))}
              </div>
              <Button variant="outline" onClick={finish}>
                End session
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-5">
              <p className="text-sm font-medium">Today&apos;s goal</p>
              <GoalRing value={totalToday} target={props.targetRepsPerDay} size={160} />
            </CardContent>
          </Card>
          {live.lastCompleted ? (
            <Card>
              <CardContent className="grid gap-2 p-5 text-sm">
                <p className="font-medium">Last rep</p>
                <div className="flex justify-between text-muted-foreground">
                  <span>Quality</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {Math.round(live.lastCompleted.quality)}/100
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Range of motion</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {Math.round(live.lastCompleted.romPct)}%
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Your force</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {Math.round(live.lastCompleted.patientForcePct)}%
                  </span>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
