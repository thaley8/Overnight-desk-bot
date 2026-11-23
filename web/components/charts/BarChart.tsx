"use client";

import { useMemo, useState, type ReactNode } from "react";
import { C, ChartTooltip, niceTicks, useSize } from "./core";

export interface Bar {
  key: string | number;
  v: number;
  label: string;
}

/**
 * Vertical bars anchored to zero. `signed` colours bars by polarity (pos/neg); otherwise a single hue.
 * Each bar is its own hit target (full column height) with a tooltip.
 */
export function BarChart({
  data,
  height = 160,
  color = C.accent,
  signed = false,
  format,
  tooltip,
  xLabelEvery,
  showAxis = true,
  highlightLast = false,
}: {
  data: Bar[];
  height?: number;
  color?: string;
  signed?: boolean;
  format: (v: number) => string;
  tooltip?: (b: Bar, i: number) => ReactNode;
  xLabelEvery?: number;
  showAxis?: boolean;
  highlightLast?: boolean;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padR = showAxis ? 64 : 0;
  const padT = 8;
  const padB = xLabelEvery ? 22 : 4;
  const w = Math.max(0, width - padR);
  const h = height - padT - padB;

  const geo = useMemo(() => {
    if (!data.length || w <= 0) return null;
    const vals = data.map((d) => d.v);
    const { ticks, lo, hi } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 3);
    const y = (v: number) => padT + h - ((v - lo) / (hi - lo || 1)) * h;
    const slot = w / data.length;
    const gap = Math.min(2, slot * 0.3);
    const bw = Math.max(1, slot - gap);
    return { ticks, y, slot, bw };
  }, [data, w, h]);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }} onPointerLeave={() => setHover(null)}>
      {geo && (
        <svg width={width} height={height} role="img" aria-label="Bar chart" className="block">
          {showAxis &&
            geo.ticks.map((tv) => (
              <g key={tv}>
                <line x1={0} x2={w} y1={geo.y(tv)} y2={geo.y(tv)} stroke={tv === 0 ? "rgba(148,178,220,0.22)" : C.grid} />
                <text x={w + 10} y={geo.y(tv)} dy="0.32em" fontSize={10.5} fill={C.axis} className="num">
                  {format(tv)}
                </text>
              </g>
            ))}
          {data.map((d, i) => {
            const y0 = geo.y(0);
            const y1 = geo.y(d.v);
            const top = Math.min(y0, y1);
            const bh = Math.max(1, Math.abs(y1 - y0));
            const fillC = signed ? (d.v >= 0 ? C.pos : C.neg) : color;
            const dim = hover !== null && hover !== i;
            const r = Math.min(2, geo.bw / 2, bh / 2);
            const x = i * geo.slot;
            // rounded data-end, square baseline end
            const path =
              d.v >= 0
                ? `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + geo.bw - r}Q${x + geo.bw},${top} ${x + geo.bw},${top + r}V${y0}Z`
                : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + geo.bw - r}Q${x + geo.bw},${y1} ${x + geo.bw},${y1 - r}V${y0}Z`;
            return (
              <g key={d.key}>
                <path d={path} fill={fillC} opacity={dim ? 0.35 : highlightLast && i !== data.length - 1 && hover === null ? 0.75 : 1} style={{ transition: "opacity 120ms" }} />
                <rect
                  x={x}
                  y={padT}
                  width={geo.slot}
                  height={h}
                  fill="transparent"
                  tabIndex={-1}
                  onPointerEnter={() => setHover(i)}
                />
                {xLabelEvery && i % xLabelEvery === 0 && (
                  <text x={i === 0 ? x : x + geo.bw / 2} y={height - 6} fontSize={10.5} fill={C.axis} textAnchor={i === 0 ? "start" : "middle"} className="num">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {geo && hover !== null && data[hover] && (
        <ChartTooltip x={hover * geo.slot + geo.bw / 2} y={Math.min(geo.y(data[hover].v), geo.y(0))} width={width} visible>
          {tooltip ? (
            tooltip(data[hover], hover)
          ) : (
            <>
              <div className="num text-xs font-medium text-fg">{format(data[hover].v)}</div>
              <div className="text-2xs text-fg-3">{data[hover].label}</div>
            </>
          )}
        </ChartTooltip>
      )}
    </div>
  );
}
