"use client";

/**
 * Same tile grid as LiveMetricTiles, but for a board running the bench
 * servo-assist sketch instead of the documented phixo_poc.ino. Every value
 * here is a raw firmware field — there is no clinical angle or ROM to show,
 * which is why this is a separate grid rather than more LiveMetricTiles rows.
 */
import { Tile } from "./live-metric-tiles";
import type { DeviceSample } from "@/lib/device/types";

export function BenchMetricTiles({
  bench,
  benchReps,
}: {
  bench: DeviceSample["bench"] | null;
  benchReps: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile
        label="Servo position"
        value={bench ? bench.servoPos.toFixed(0) : "—"}
        sub="Raw pulse position, 30–160"
        accent="var(--chart-2)"
      />
      <Tile
        label="Gyro path"
        value={bench ? `${bench.pathDeg.toFixed(0)}°` : "—"}
        sub="Unsigned, resets outside MOVING/ASSIST"
      />
      <Tile
        label="Firmware state"
        value={bench?.state ?? "—"}
        sub="IDLE / MOVING / ASSIST / TARGET"
      />
      <Tile
        label="Reps"
        value={`${benchReps}`}
        sub="MOVING episodes this connection"
        accent="var(--chart-1)"
      />
    </div>
  );
}
