"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { C, ChartTooltip, niceTicks, TooltipRow, useSize } from "./core";

export interface Pt {
  t: number;
  v: number;
}

export interface LineSeries {
  label: string;
  data: Pt[];
  color: string;
  dashed?: boolean;
}

/**
 * Area/line chart with a snapping crosshair, keyboard navigation and a right-hand value axis.
 * Primary series is filled; optional overlay series are drawn as lines on the same scale.
 */
export function LineChart({
  data,
  label,
  color = C.accent,
  height = 260,
  format,
  xFormat,
  tooltipTitle,
  baseline,
  areaTo = "bottom",
  overlays = [],
  yTicks = 4,
  extraTooltip,
  fill = true,
  showXAxis = true,
}: {
  data: Pt[];
  label: string;
  color?: string;
  height?: number;
  format: (v: number) => string;
  xFormat: (t: number) => string;
  tooltipTitle: (t: number) => string;
  baseline?: { value: number; label: string };
  areaTo?: "bottom" | "zero";
  overlays?: LineSeries[];
  yTicks?: number;
  extraTooltip?: (i: number) => ReactNode;
  fill?: boolean;
  showXAxis?: boolean;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  // Value axis is as wide as its longest label (token prices can be long).
  const padR = useMemo(() => {
    const vals = data.map((d) => d.v);
    if (!vals.length) return 64;
    const longest = Math.max(format(Math.min(...vals)).length, format(Math.max(...vals)).length, baseline ? format(baseline.value).length : 0);
    return Math.max(56, Math.ceil(longest * 6.6) + 18);
  }, [data, format, baseline]);
  const padT = 10;
  const padB = showXAxis ? 26 : 6;
  const w = Math.max(0, width - padR);
  const h = height - padT - padB;

  const geo = useMemo(() => {
    if (data.length < 2 || w <= 0) return null;
    const all = [...data, ...overlays.flatMap((o) => o.data)].map((d) => d.v);
    if (baseline) all.push(baseline.value);
    if (areaTo === "zero") all.push(0);
    let min = Math.min(...all);
    let max = Math.max(...all);
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.05 || 1;
    const rawMax = max;
    const rawMin = min;
    min -= pad;
    max += pad;
    // A series that never rises above zero (e.g. drawdown) keeps zero as its ceiling.
    if (areaTo === "zero" && rawMax <= 0) max = 0;
    // Non-negative quantities never get a negative axis.
    if (rawMin >= 0 && min < 0) min = 0;
    const { ticks, lo, hi } = niceTicks(min, max, yTicks);
    const t0 = data[0].t;
    const t1 = data[data.length - 1].t;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w;
    const y = (v: number) => padT + h - ((v - lo) / (hi - lo || 1)) * h;
    const path = (pts: Pt[]) => pts.map((d, i) => `${i ? "L" : "M"}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join("");
    const line = path(data);
    const baseY = areaTo === "zero" ? y(0) : padT + h;
    const area = `${line}L${x(t1).toFixed(1)},${baseY}L0,${baseY}Z`;
    const nx = Math.max(2, Math.min(7, Math.floor(w / 110)));
    const xTicks = Array.from({ length: nx }, (_, i) => data[Math.round((i / (nx - 1)) * (data.length - 1))]);
    return { ticks, x, y, line, area, xTicks, overlayPaths: overlays.map((o) => path(o.data)) };
  }, [data, overlays, w, h, baseline, areaTo, yTicks, padT]);

  const onMove = (clientX: number, rect: DOMRect) => {
    if (!geo) return;
    const px = clientX - rect.left;
    const t0 = data[0].t;
    const t1 = data[data.length - 1].t;
    const tt = t0 + (px / w) * (t1 - t0);
    let lo = 0;
    let hi = data.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (data[mid].t < tt) lo = mid;
      else hi = mid;
    }
    setHover(Math.abs(data[lo].t - tt) < Math.abs(data[hi].t - tt) ? lo : hi);
  };

  const hp = hover !== null && geo ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {geo && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label} chart. Use arrow keys to inspect values.`}
          tabIndex={0}
          className="block focus:outline-none focus-visible:outline-none"
          onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((i) => Math.max(0, (i ?? data.length) - 1));
            if (e.key === "ArrowRight") setHover((i) => Math.min(data.length - 1, (i ?? -1) + 1));
            if (e.key === "Escape") setHover(null);
          }}
          onBlur={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {geo.ticks.map((tv) => (
            <g key={tv}>
              <line x1={0} x2={w} y1={geo.y(tv)} y2={geo.y(tv)} stroke={C.grid} />
              <text x={w + 10} y={geo.y(tv)} dy="0.32em" className="num" fontSize={10.5} fill={C.axis}>
                {format(tv)}
              </text>
            </g>
          ))}
          {areaTo === "zero" && <line x1={0} x2={w} y1={geo.y(0)} y2={geo.y(0)} stroke="rgba(148,178,220,0.25)" />}
          {baseline && (
            <g>
              <line x1={0} x2={w} y1={geo.y(baseline.value)} y2={geo.y(baseline.value)} stroke="rgba(148,178,220,0.35)" strokeDasharray="2 4" />
              <text x={6} y={geo.y(baseline.value) - 6} fontSize={10.5} fill={C.axis}>
                {baseline.label}
              </text>
            </g>
          )}
          {fill && <path d={geo.area} fill={`url(#g${gid})`} />}
          {geo.overlayPaths.map((p, i) => (
            <path key={i} d={p} fill="none" stroke={overlays[i].color} strokeWidth={1.5} strokeDasharray={overlays[i].dashed ? "4 4" : undefined} strokeLinejoin="round" opacity={0.9} />
          ))}
          <path d={geo.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* last value marker */}
          <circle cx={geo.x(data[data.length - 1].t)} cy={geo.y(data[data.length - 1].v)} r={3.5} fill={color} stroke={C.surface} strokeWidth={2} />
          {showXAxis &&
            geo.xTicks.map((d, i) => (
              <text key={i} x={geo.x(d.t)} y={height - 8} fontSize={10.5} fill={C.axis} className="num" textAnchor={i === 0 ? "start" : i === geo.xTicks.length - 1 ? "end" : "middle"}>
                {xFormat(d.t)}
              </text>
            ))}
          {hp && (
            <g pointerEvents="none">
              <line x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={padT} y2={padT + h} stroke="rgba(230,237,247,0.28)" />
              <line x1={0} x2={w} y1={geo.y(hp.v)} y2={geo.y(hp.v)} stroke="rgba(230,237,247,0.12)" strokeDasharray="2 3" />
              <rect x={w + 2} y={geo.y(hp.v) - 9} width={padR - 4} height={18} rx={3} fill={color} />
              <text x={w + 8} y={geo.y(hp.v)} dy="0.32em" fontSize={10.5} fill="#fff" className="num" fontWeight={500}>
                {format(hp.v)}
              </text>
              {overlays.map((o, i) => {
                const op = o.data[hover!];
                return op ? <circle key={i} cx={geo.x(op.t)} cy={geo.y(op.v)} r={3.5} fill={o.color} stroke={C.surface} strokeWidth={2} /> : null;
              })}
              <circle cx={geo.x(hp.t)} cy={geo.y(hp.v)} r={4.5} fill={color} stroke={C.surface} strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {geo && hp && (
        <ChartTooltip x={geo.x(hp.t)} y={geo.y(hp.v)} width={width} visible>
          <div className="mb-1 text-2xs text-fg-3">{tooltipTitle(hp.t)}</div>
          <TooltipRow color={color} label={label} value={format(hp.v)} />
          {overlays.map((o) => (o.data[hover!] ? <TooltipRow key={o.label} color={o.color} dash={o.dashed} label={o.label} value={format(o.data[hover!].v)} /> : null))}
          {extraTooltip?.(hover!)}
        </ChartTooltip>
      )}
    </div>
  );
}
