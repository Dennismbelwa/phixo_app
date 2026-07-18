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
} from "recharts";

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" };
const GRID = "color-mix(in oklab, var(--border) 70%, transparent)";

function WardTooltip({
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
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block size-2 rounded-[2px]"
            style={{ background: p.color }}
            aria-hidden
          />
          {p.name}:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {Math.round(p.value).toLocaleString()}
            {unit}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Total repetitions delivered across the ward per calendar day. */
export function WardRepsChart({
  data,
  height = 240,
}: {
  data: { label: string; reps: number }[];
  height?: number;
}) {
  const rows = data.map((d) => ({ label: d.label, Repetitions: d.reps }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 12, right: 8, left: -8, bottom: 0 }} barCategoryGap="26%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} />
        <YAxis tickLine={false} axisLine={false} tick={AXIS} />
        <Tooltip content={<WardTooltip unit=" reps" />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
        <Bar dataKey="Repetitions" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Pooled ward recovery curve: average device assistance by acute day.
 * Single series — the title names it, no legend needed.
 */
export function AssistDistributionChart({
  data,
  height = 240,
}: {
  data: { day: number; avgAssistPct: number }[];
  height?: number;
}) {
  const rows = data.map((d) => ({ day: `Day ${d.day}`, "Avg assistance": d.avgAssistPct }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={AXIS} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={AXIS} unit="%" />
        <Tooltip content={<WardTooltip unit="%" />} cursor={{ stroke: "var(--border)" }} />
        <Line
          type="monotone"
          dataKey="Avg assistance"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-1)" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
