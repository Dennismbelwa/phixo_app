import { cn } from "@/lib/utils";

interface GoalRingProps {
  value: number;
  target: number;
  size?: number;
  label?: string;
  sublabel?: string;
  className?: string;
}

/** Circular daily-goal progress ring (SVG, server-safe). */
export function GoalRing({ value, target, size = 200, label, sublabel, className }: GoalRingProps) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const stroke = size * 0.075;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const done = pct >= 1;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${value} of ${target} repetitions today`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out",
            done ? "stroke-chart-2" : "stroke-primary"
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-semibold tabular-nums leading-none" style={{ fontSize: size * 0.2 }}>
          {value}
        </span>
        <span className="text-muted-foreground mt-1" style={{ fontSize: size * 0.07 }}>
          {label ?? `of ${target} reps`}
        </span>
        {sublabel ? (
          <span className="text-muted-foreground/70" style={{ fontSize: size * 0.06 }}>
            {sublabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
