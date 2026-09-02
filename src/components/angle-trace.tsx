"use client";

/**
 * Live elbow-angle trace, shared by both session modes: the physical POC feeds it
 * measured IMU samples and the simulated bedside session feeds it generated ones,
 * so the two screens speak the same visual language.
 *
 * Canvas rather than Recharts: samples arrive at 50 Hz and a React chart library
 * will not keep up. The buffer is read through a ref, so no sample ever triggers
 * a render.
 */
import { useEffect, useRef } from "react";
import type { DeviceSample } from "@/lib/device/types";

const WINDOW_MS = 30_000;
const Y_MAX = 150;
const PAD_LEFT = 34;
const PAD_BOTTOM = 18;
const PAD_TOP = 8;

export function AngleTrace({
  traceRef,
  live,
  className,
}: {
  traceRef: React.RefObject<DeviceSample[]>;
  live: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef(live);
  // Mirrored into a ref so the draw loop can read it without re-subscribing.
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, w, h);

      const styles = getComputedStyle(canvas);
      const accent = styles.getPropertyValue("--chart-2").trim() || "#3f9e5f";
      const band = styles.getPropertyValue("--chart-1").trim() || "#0e87a8";
      const plotW = w - PAD_LEFT;
      const plotH = h - PAD_BOTTOM - PAD_TOP;
      const yOf = (deg: number) => PAD_TOP + plotH * (1 - deg / Y_MAX);

      // Functional-range band: the 30-130 deg arc that matters clinically.
      ctx.fillStyle = band;
      ctx.globalAlpha = 0.06;
      ctx.fillRect(PAD_LEFT, yOf(130), plotW, yOf(30) - yOf(130));
      ctx.globalAlpha = 1;

      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const deg of [0, 30, 60, 90, 120, 150]) {
        const y = yOf(deg);
        ctx.strokeStyle = "color-mix(in oklab, currentColor 12%, transparent)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillStyle = "color-mix(in oklab, currentColor 55%, transparent)";
        ctx.fillText(`${deg}°`, PAD_LEFT - 6, y);
      }

      const samples = traceRef.current ?? [];
      if (samples.length > 1) {
        const endT = samples[samples.length - 1].t;
        const startT = endT - WINDOW_MS;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = liveRef.current ? 1 : 0.35;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        let started = false;
        for (const s of samples) {
          if (s.t < startT) continue;
          const x = PAD_LEFT + ((s.t - startT) / WINDOW_MS) * plotW;
          const y = yOf(s.angle);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Leading dot at the current angle.
        const last = samples[samples.length - 1];
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(PAD_LEFT + plotW, yOf(last.angle), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.textAlign = "left";
      ctx.fillStyle = "color-mix(in oklab, currentColor 45%, transparent)";
      ctx.fillText("30 s window · 50 Hz", PAD_LEFT + 2, h - 8);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [traceRef]);

  return <canvas ref={canvasRef} className={className} />;
}
