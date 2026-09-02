"use client";

/**
 * A schematic arm whose forearm tracks the measured elbow angle.
 *
 * Driven imperatively through a ref rather than a prop: the angle updates 50
 * times a second, and rotating an SVG group directly keeps that off the React
 * render path entirely.
 */
import { useEffect, useRef } from "react";

const ELBOW = { x: 96, y: 58 };
const FOREARM_LENGTH = 74;

export function ArmFigure({
  angleRef,
  className,
}: {
  angleRef: React.RefObject<number>;
  className?: string;
}) {
  const forearmRef = useRef<SVGGElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const g = forearmRef.current;
      if (g) {
        // 0 deg = forearm straight out (full extension); flexion lifts it up.
        g.setAttribute("transform", `rotate(${-(angleRef.current ?? 0)} ${ELBOW.x} ${ELBOW.y})`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [angleRef]);

  return (
    <svg viewBox="0 0 200 140" className={className} role="img" aria-label="Live elbow position">
      {/* range guide: full extension through full flexion */}
      <path
        d={`M ${ELBOW.x + 52} ${ELBOW.y} A 52 52 0 0 0 ${ELBOW.x + 52 * Math.cos((145 * Math.PI) / 180)} ${ELBOW.y - 52 * Math.sin((145 * Math.PI) / 180)}`}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={2}
        strokeDasharray="3 4"
      />
      {/* upper arm — fixed by the rig */}
      <line
        x1={22} y1={ELBOW.y + 34} x2={ELBOW.x} y2={ELBOW.y}
        stroke="currentColor" strokeOpacity={0.35} strokeWidth={11} strokeLinecap="round"
      />
      <g ref={forearmRef}>
        <line
          x1={ELBOW.x} y1={ELBOW.y} x2={ELBOW.x + FOREARM_LENGTH} y2={ELBOW.y}
          stroke="var(--chart-2)" strokeWidth={11} strokeLinecap="round"
        />
        <circle cx={ELBOW.x + FOREARM_LENGTH} cy={ELBOW.y} r={7} fill="var(--chart-2)" />
      </g>
      <circle cx={ELBOW.x} cy={ELBOW.y} r={8} fill="currentColor" fillOpacity={0.5} />
    </svg>
  );
}
