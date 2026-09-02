"use client";

/**
 * Connection state for the physical POC. Deliberately shows the live sample rate
 * and counts: during the presentation these are the evidence that telemetry is
 * genuinely arriving rather than being replayed from a fixture.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/lib/device/types";

const MODE_LABEL: Record<DeviceStatus["mode"], string> = {
  device: "Real sensor mode",
  simulation: "Simulation mode",
  replay: "Replay mode",
};

const SIGNAL_LABEL: Record<DeviceStatus["signal"], string> = {
  stable: "Sensor signal: stable",
  weak: "Sensor signal: weak",
  lost: "Sensor signal: lost",
};

export function DeviceStatusChip({ status }: { status: DeviceStatus }) {
  const live = status.connected && status.signal !== "lost";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
          live
            ? "border-[var(--chart-2)]/40 bg-[var(--chart-2)]/10 text-[var(--chart-2)]"
            : "border-border bg-muted text-muted-foreground",
        )}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            live ? "bg-[var(--chart-2)] animate-pulse" : "bg-muted-foreground/50",
          )}
        />
        {live ? "POC connected" : status.connected ? "POC signal lost" : "POC not connected"}
      </div>

      {status.calibrating ? (
        // Telemetry genuinely stops while the board averages its zero, so say so
        // — otherwise the pause reads as the link dropping.
        <span className="text-sm font-medium text-[var(--chart-3)]">
          Zeroing at full extension — hold the brace at the end-stop…
        </span>
      ) : (
        live && (
          <span className="text-sm text-muted-foreground">
            Receiving live sensor data · {SIGNAL_LABEL[status.signal]}
          </span>
        )
      )}

      <Badge
        variant="outline"
        className={cn(
          "font-medium",
          status.mode === "device" && live && "border-[var(--chart-2)]/40 text-[var(--chart-2)]",
          status.mode === "simulation" && "border-[var(--chart-3)]/40 text-[var(--chart-3)]",
          status.mode === "replay" && "border-[var(--chart-1)]/40 text-[var(--chart-1)]",
        )}
      >
        {MODE_LABEL[status.mode]}
      </Badge>

      {status.mode === "device" && status.calibrated && (
        <Badge variant="outline" className="border-[var(--chart-2)]/40 font-medium text-[var(--chart-2)]">
          Zeroed · 0° = full extension
        </Badge>
      )}

      {live && (
        <span className="font-mono text-xs text-muted-foreground">
          {status.rateHz} Hz · {status.samples.toLocaleString()} samples
          {status.rejected > 0 && ` · ${status.rejected} rejected`}
        </span>
      )}
    </div>
  );
}
