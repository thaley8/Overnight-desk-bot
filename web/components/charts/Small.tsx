"use client";

import { useMemo, useState } from "react";
import { cx, fmtDate, fmtFullDate, fmtPct, fmtUsd } from "@/lib/format";
import type { DailyPoint } from "@/lib/types";
import { C, CATEGORICAL, diverging, OTHER } from "./core";

/** Inline trend line. Colour reflects direction unless `color` is given. */
export function Sparkline({ data, width = 96, height = 28, color, fill = true, className, stretch }: { data: number[]; width?: number; height?: number; color?: string; fill?: boolean; className?: string; /** scale to container width */ stretch?: boolean }) {
  const d = useMemo(() => {
    if (data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const pts = data.map((v, i) => [(i / (data.length - 1)) * width, 2 + (height - 4) * (1 - (v - min) / span)] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    return { line, area: `${line}L${width},${height}L0,${height}Z`, last: pts[pts.length - 1] };
  }, [data, width, height]);
  if (!d) return <svg width={width} height={height} className={className} />;
  const c = color ?? (data[data.length - 1] >= data[0] ? C.pos : C.neg);
  return (
    <svg width={stretch ? "100%" : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={stretch ? "none" : undefined} className={cx("block shrink-0 overflow-visible", className)} aria-hidden>
      {fill && <path d={d.area} fill={c} opacity={0.08} />}
      <path d={d.line} fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {!stretch && <circle cx={d.last[0]} cy={d.last[1]} r={2} fill={c} />}
    </svg>
  );
}

/** GitHub-style calendar of daily P&L on a diverging scale, weeks as columns. */
export function CalendarHeatmap({ daily, weeks = 26 }: { daily: DailyPoint[]; weeks?: number }) {
  const [hover, setHover] = useState<DailyPoint | null>(null);
  const days = daily.slice(-weeks * 7);
  const maxAbs = Math.max(...days.map((d) => Math.abs(d.pnl)));
  const dow = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Chicago" }).format(days[0].t);
  const firstDow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dow);
  const cells = [...Array(firstDow).fill(null), ...days] as (DailyPoint | null)[];
  const cols: (DailyPoint | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
  return (
    <div className="relative">
      <div className="flex gap-[3px] overflow-x-auto pb-1" onPointerLeave={() => setHover(null)}>
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, ri) => {
              const d = col[ri];
              return (
                <div
                  key={ri}
                  onPointerEnter={() => d && setHover(d)}
                  className={cx("size-[11px] rounded-[2px] transition-[outline] sm:size-3", d && "outline-1 outline-transparent hover:outline-fg-2")}
                  style={{ background: d ? diverging(d.pnl, maxAbs) : "transparent" }}
                  aria-label={d ? `${fmtDate(d.t)}: ${fmtUsd(d.pnl, { sign: true })}` : undefined}
                  role={d ? "img" : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-2xs text-fg-3">
        <div className="num min-h-4">{hover ? <><span className="text-fg-2">{fmtFullDate(hover.t)}</span> · <span className={hover.pnl >= 0 ? "text-pos" : "text-neg"}>{fmtUsd(hover.pnl, { sign: true })}</span> · {hover.trades} trades</> : `Last ${weeks} weeks`}</div>
        <div className="flex items-center gap-1.5">
          <span>Loss</span>
          {[-1, -0.5, -0.15, 0, 0.15, 0.5, 1].map((v) => (
            <span key={v} className="size-2.5 rounded-[2px]" style={{ background: diverging(v, 1) }} />
          ))}
          <span>Gain</span>
        </div>
      </div>
    </div>
  );
}

/** Uptime strip: one tick per check, coloured by status. */
export function UptimeStrip({ checks, className }: { checks: number[]; className?: string }) {
  return (
    <div className={cx("flex h-6 items-stretch gap-[2px]", className)} role="img" aria-label={`${checks.filter((c) => c === 0).length} of ${checks.length} checks healthy`}>
      {checks.map((c, i) => (
        <span key={i} title={c === 0 ? "Healthy" : c === 1 ? "Degraded" : "Down"} className={cx("min-w-[2px] flex-1 rounded-[1px] transition-opacity hover:opacity-70", c === 0 ? "bg-pos/70" : c === 1 ? "bg-warn" : "bg-neg")} />
      ))}
    </div>
  );
}

/** Stacked allocation bar with 2px surface gaps and a legend. Max 5 categorical slots + Other. */
export function AllocationBar({ items, format = (v) => fmtUsd(v, { decimals: 0 }) }: { items: { label: string; value: number }[]; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((a, b) => a + b.value, 0);
  const segs = [...top.map((t, i) => ({ ...t, color: CATEGORICAL[i] })), ...(rest > 0 ? [{ label: "Other", value: rest, color: OTHER }] : [])];
  const total = segs.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" onPointerLeave={() => setHover(null)}>
        {segs.map((s, i) => (
          <div
            key={s.label}
            onPointerEnter={() => setHover(i)}
            className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color, opacity: hover === null || hover === i ? 1 : 0.35 }}
            title={`${s.label}: ${format(s.value)} (${fmtPct(s.value / total, { decimals: 1 })})`}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {segs.map((s, i) => (
          <li key={s.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} className={cx("flex items-center gap-2 text-xs transition-opacity", hover !== null && hover !== i && "opacity-45")}>
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} />
            <span className="truncate text-fg-2">{s.label}</span>
            <span className="num ml-auto text-fg">{fmtPct(s.value / total, { decimals: 1 })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact radial gauge for a single 0–1 value. */
export function Ring({ value, size = 44, stroke = 4, color = C.accent, label }: { value: number; size?: number; stroke?: number; color?: string; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="block -rotate-90" role="img" aria-label={label}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,178,220,0.12)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${c * Math.max(0, Math.min(1, value))} ${c}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 500ms" }} />
    </svg>
  );
}
