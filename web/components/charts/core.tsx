"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/format";

/** Validated categorical order (dark panel surface #111E30; all six checks pass). Never cycled. */
export const CATEGORICAL = ["#398BFF", "#B87A22", "#14A3B5", "#C25A78", "#5E6FD0"] as const;
export const OTHER = "#4A5A73";

export const C = {
  accent: "#398BFF",
  cyan: "#35D5E8",
  pos: "#3DBE8B",
  neg: "#E0636E",
  warn: "#E3AA4A",
  grid: "rgba(148,178,220,0.07)",
  axis: "#6B7C96",
  surface: "#111E30",
};

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.width - width) > 0.5 || Math.abs(s.height - height) > 0.5 ? { width, height } : s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function niceTicks(min: number, max: number, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { ticks, lo, hi };
}

/** Floating tooltip, positioned within a relative container. Values lead, labels follow. */
export function ChartTooltip({ x, y, width, children, visible }: { x: number; y: number; width: number; children: ReactNode; visible: boolean }) {
  if (!visible) return null;
  const flip = x > width - 180;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[140px] rounded-md border border-line-2 bg-elevated/95 px-3 py-2 shadow-pop backdrop-blur-sm"
      style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(0, y - 12) }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({ color, label, value, dash }: { color?: string; label: ReactNode; value: ReactNode; dash?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-2xs text-fg-3">
        {color && <span className={cx("inline-block h-0.5 w-2.5 rounded-full", dash && "opacity-60")} style={{ background: color }} />}
        {label}
      </span>
      <span className="num text-xs font-medium text-fg">{value}</span>
    </div>
  );
}

/** Linear interpolation between two hex colours. */
export function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Diverging scale: muted red ← neutral slate → green. */
export function diverging(v: number, maxAbs: number) {
  const NEUTRAL = "#1B2A40";
  if (!maxAbs) return NEUTRAL;
  const t = Math.min(1, Math.abs(v) / maxAbs);
  const eased = 0.18 + 0.82 * Math.sqrt(t);
  return v >= 0 ? mix(NEUTRAL, C.pos, eased) : mix(NEUTRAL, C.neg, eased);
}
