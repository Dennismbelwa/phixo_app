"use client";

/**
 * Repetition-by-repetition breakdown. Every row is one detected flexion-extension
 * cycle, with the values measured from that cycle's own segment of the signal.
 */
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { qualityLabel } from "@/lib/device/metrics";
import { cn } from "@/lib/utils";
import type { DetectedRep } from "@/lib/device/types";

/** Whole degrees, with negative zero normalised — a rep that just reaches full
 *  extension should read 0°, not -0°. */
const deg = (v: number) => `${Math.round(v) || 0}°`;

const QUALITY_STYLE: Record<string, string> = {
  Excellent: "border-[var(--chart-2)]/40 text-[var(--chart-2)]",
  Good: "border-[var(--chart-2)]/40 text-[var(--chart-2)]",
  Fair: "border-[var(--chart-3)]/40 text-[var(--chart-3)]",
  Poor: "border-[var(--chart-5)]/40 text-[var(--chart-5)]",
};

export function RepTable({
  reps,
  limit,
  className,
}: {
  reps: DetectedRep[];
  /** show only the most recent N (newest first); omit for the full run */
  limit?: number;
  className?: string;
}) {
  const rows = limit ? [...reps].slice(-limit).reverse() : reps;

  if (rows.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        No repetitions detected yet — start the device and the table will fill in.
      </p>
    );
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">Rep</TableHead>
            <TableHead className="text-right">Max flexion</TableHead>
            <TableHead className="text-right">Max extension</TableHead>
            <TableHead className="text-right">ROM</TableHead>
            <TableHead className="text-right">Peak velocity</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="text-right">Quality</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const label = qualityLabel(r.quality);
            return (
              <TableRow key={r.index}>
                <TableCell className="font-mono text-muted-foreground">{r.index}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {deg(r.maxFlexionDeg)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {deg(r.maxExtensionDeg)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums font-medium">
                  {deg(r.romDeg)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {Math.round(r.peakFlexionVelDegS)}°/s
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {(r.durationMs / 1000).toFixed(1)}s
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className={QUALITY_STYLE[label]}>
                    {label}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
