"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  Legend,
} from "recharts";
import type { DailyAggregate } from "@/lib/data";

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" };
const GRID = "color-mix(in oklab, var(--border) 70%, transparent)";

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">Day {label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block size-2 rounded-[2px]"
            style={{ background: p.color }}
            aria-hidden
          />
          {p.name}: <span className="font-medium tabular-nums text-foreground">{Math.round(p.value)}{unit}</span>
        </p>
      ))}
    </div>
  );
}

/** Daily repetitions vs. the NICE 300-400 guideline band. */
export function DailyRepsChart({
  daily,
  target,
  height = 240,
}: {
  daily: DailyAggregate[];
  target: number;
  height?: number;
}) {
  const data = daily.map((d) => ({ day: d.day, Repetitions: d.reps }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={AXIS}
          tickFormatter={(d) => `Day ${d}`} />
        <YAxis tickLine={false} axisLine={false} tick={AXIS} />
        <ReferenceArea
          y1={300}
          y2={400}
          fill="var(--chart-2)"
          fillOpacity={0.08}
          stroke="none"
          label={{ value: "NICE guideline 300–400", position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <ReferenceLine
          y={target}
          stroke="var(--chart-2)"
          strokeDasharray="4 4"
          label={{ value: "target", position: "insideBottomRight", fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <Tooltip content={<ChartTooltip unit=" reps" />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
        <Bar dataKey="Repetitions" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * The key clinical signal: motor assistance falling while the patient's own
 * patient-driven range rises day over day.
 */
export function EffortChart({
  daily,
  height = 240,
}: {
  daily: DailyAggregate[];
  height?: number;
}) {
  const data = daily.map((d) => ({
    day: d.day,
    "Patient-driven range": d.avgPatientRangePct ?? 0,
    "Device assistance": d.avgAssistPct ?? 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={AXIS}
          tickFormatter={(d) => `Day ${d}`} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={AXIS} unit="%" />
        <Tooltip content={<ChartTooltip unit="%" />} cursor={{ stroke: "var(--border)" }} />
        <Legend
          iconType="plainline"
          wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
        />
        <Line
          type="monotone"
          dataKey="Patient-driven range"
          stroke="var(--chart-2)"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-2)" }}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="Device assistance"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-1)" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Movement quality trend (single series — no legend needed, title names it). */
export function QualityChart({
  daily,
  height = 200,
}: {
  daily: DailyAggregate[];
  height?: number;
}) {
  const data = daily.map((d) => ({ day: d.day, Quality: d.avgQuality ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={AXIS}
          tickFormatter={(d) => `Day ${d}`} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={AXIS} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
        <Line
          type="monotone"
          dataKey="Quality"
          stroke="var(--chart-4)"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-4)" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
