"use client";

/**
 * The headline rehabilitation metrics, all derived from the live angle stream.
 * Nothing here is pre-computed or hard-coded: every value traces back to a
 * detected repetition or the current sensor reading.
 */
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SessionMetrics } from "@/lib/device/metrics";
import type { DetectorState } from "@/lib/device/rep-detector";

/** Whole degrees, with negative zero normalised. */
const deg = (v: number) => `${Math.round(v) || 0}°`;

export function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={cn("mt-1 font-mono text-3xl font-semibold tabular-nums")}
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function LiveMetricTiles({
  angle,
  metrics,
  detector,
  recording,
  guidelineReps,
}: {
  angle: number;
  metrics: SessionMetrics;
  detector: DetectorState;
  recording: boolean;
  /** Denominator shown beside the count — the guideline, not the session target. */
  guidelineReps: number;
}) {
  const hasReps = metrics.repCount > 0;
  // Before the first repetition completes there is still a measured range: the
  // detector's running envelope. Showing it keeps the tiles honest company to
  // the live angle instead of six dashes, but it is provisional, so it is
  // labelled as the live range rather than as a rep metric.
  const live = !hasReps && detector.amplitudeDeg > 0;

  // Repetitions are counted from the moment the device connects, exactly like
  // the range readouts above. Only the *session* starts at Start session, so
  // before then the count is shown but flagged as not being recorded.
  const repCount = recording ? metrics.repCount : detector.count;

  const repHint = recording
    ? "Detected from signal"
    : repCount > 0
      ? "Counting live — not recorded yet"
      : detector.armed
        ? "Range armed — completing first cycle"
        : "Move through a wider range to start counting";

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        label="Live elbow angle"
        value={deg(angle)}
        sub="Measured by IMU"
        accent="var(--chart-2)"
      />
      <Tile
        label="Current ROM"
        value={
          hasReps
            ? `${deg(metrics.maxExtensionDeg)}–${deg(metrics.maxFlexionDeg)}`
            : live
              ? `${deg(detector.loDeg)}–${deg(detector.hiDeg)}`
              : "—"
        }
        sub={
          hasReps
            ? `${deg(metrics.totalRomDeg)} total`
            : live
              ? `${deg(detector.amplitudeDeg)} live range`
              : "Awaiting movement"
        }
      />
      <Tile
        label="Repetitions"
        value={`${repCount} / ${guidelineReps}`}
        sub={repHint}
        accent="var(--chart-1)"
      />
      <Tile
        label="Max flexion"
        value={hasReps ? deg(metrics.maxFlexionDeg) : live ? deg(detector.hiDeg) : "—"}
        sub={
          hasReps
            ? `${metrics.romCompletenessPct.toFixed(0)}% of normal range`
            : live
              ? "Live peak"
              : undefined
        }
      />
      <Tile
        label="Max extension"
        value={hasReps ? deg(metrics.maxExtensionDeg) : live ? deg(detector.loDeg) : "—"}
        sub={
          hasReps
            ? `${deg(metrics.extensionDeficitDeg)} from straight`
            : live
              ? "Live best"
              : undefined
        }
      />
      <Tile
        label="Session quality"
        value={hasReps ? `${metrics.meanQuality.toFixed(0)}%` : "—"}
        sub={hasReps ? `${metrics.consistency.toFixed(0)}% consistency` : "Needs one full repetition"}
        accent="var(--chart-4)"
      />
    </div>
  );
}
