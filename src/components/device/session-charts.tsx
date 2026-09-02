"use client";

/**
 * Post-session charts. Recharts is fine here — the data is static and already
 * thinned. The live view uses canvas instead, because a React chart library
 * cannot keep up with 50 Hz telemetry.
 */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { DetectedRep, DeviceSample } from "@/lib/device/types";

interface TooltipEntry {
  value?: number | string;
  name?: string;
  color?: string;
}

function ChartTooltip({
  active, payload, label, labelPrefix, unit,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelPrefix: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{labelPrefix} {label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-mono">{Number(p.value).toFixed(1)}{unit}</span>
        </p>
      ))}
    </div>
  );
}

/** The full elbow-angle trace for the session. */
export function AngleTraceChart({
  trace,
  height = 240,
}: {
  trace: DeviceSample[];
  height?: number;
}) {
  const data = trace.map((s) => ({ t: s.t / 1000, angle: s.angle }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="angleFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
        <XAxis
          dataKey="t" type="number" domain={["dataMin", "dataMax"]}
          tickFormatter={(v) => `${Math.round(v)}s`}
          tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
        />
        <YAxis
          domain={[0, 150]} ticks={[0, 30, 60, 90, 120, 150]}
          tickFormatter={(v) => `${v}°`}
          tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
        />
        <Tooltip content={<ChartTooltip labelPrefix="At" unit="°" />} />
        <Area
          type="monotone" dataKey="angle" name="Elbow angle"
          stroke="var(--chart-2)" strokeWidth={1.5} fill="url(#angleFill)" isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** ROM achieved on each repetition, with the session mean for reference. */
export function RomPerRepChart({
  reps,
  meanRomDeg,
  height = 240,
}: {
  reps: DetectedRep[];
  meanRomDeg: number;
  height?: number;
}) {
  const data = reps.map((r) => ({ rep: r.index, rom: r.romDeg }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
        <XAxis dataKey="rep" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis
          domain={[0, 150]} tickFormatter={(v) => `${v}°`}
          tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
        />
        <Tooltip content={<ChartTooltip labelPrefix="Rep" unit="°" />} />
        <ReferenceLine
          y={meanRomDeg} stroke="var(--chart-1)" strokeDasharray="4 4"
          label={{ value: `mean ${meanRomDeg.toFixed(0)}°`, position: "right", fontSize: 10, fill: "var(--chart-1)" }}
        />
        <Bar dataKey="rom" name="ROM" fill="var(--chart-2)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Peak angular velocity per repetition — a slowing trend indicates fatigue. */
export function VelocityPerRepChart({
  reps,
  height = 200,
}: {
  reps: DetectedRep[];
  height?: number;
}) {
  const data = reps.map((r) => ({ rep: r.index, vel: r.peakFlexionVelDegS }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
        <XAxis dataKey="rep" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickFormatter={(v) => `${v}`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip labelPrefix="Rep" unit="°/s" />} />
        <Line type="monotone" dataKey="vel" name="Peak velocity" stroke="var(--chart-4)" dot={false} isAnimationActive={false} />
        <Bar dataKey="vel" name="Peak velocity" fill="var(--chart-4)" fillOpacity={0.55} radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
