"use client";

import { useMemo, useState } from "react";
import { BarChart } from "@/components/charts/BarChart";
import { C, TooltipRow } from "@/components/charts/core";
import { LineChart } from "@/components/charts/LineChart";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Gap, PageHeader, Panel, PanelHeader, TokenMark } from "@/components/ui/primitives";
import { drawdownSeries, sliceDaily, tradeStats } from "@/lib/derive";
import { cx, fmtCompactUsd, fmtDate, fmtFullDate, fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { RangeControl, useSnap } from "./common";

interface Attribution {
  symbol: string;
  trades: number;
  wins: number;
  pnl: number;
  volume: number;
}

export function Analytics() {
  const s = useSnap();
  return s.daily.length >= 2 ? <FullAnalytics /> : <SparseAnalytics />;
}

/** Until two nights are recorded there are no curves to draw; show trade-level facts only. */
function SparseAnalytics() {
  const s = useSnap();
  const closed = s.trades.filter((t) => t.pnl !== null);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) <= 0);
  const sum = (xs: typeof closed) => xs.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const kpis = [
    { l: "Closed trades", v: String(closed.length) },
    { l: "Realised P&L", v: <span className={sum(closed) >= 0 ? "text-pos" : "text-neg"}>{fmtUsd(sum(closed), { sign: true })}</span> },
    { l: "Win rate", v: closed.length ? fmtPct(wins.length / closed.length, { decimals: 0 }) : "—" },
    { l: "Avg win / loss", v: <>{wins.length ? fmtUsd(sum(wins) / wins.length) : "—"}<span className="text-fg-4"> / </span>{losses.length ? fmtUsd(sum(losses) / losses.length) : "—"}</> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Trading Analytics" description="Returns, drawdowns and distributions build up night by night from vault Daily/ notes and trade records." />
      <Panel className="grid grid-cols-2 sm:grid-cols-4">
        {kpis.map((k, i) => (
          <div key={k.l} className={cx("border-line p-5", i > 0 && "sm:border-l", i % 2 === 1 && "max-sm:border-l", i >= 2 && "max-sm:border-t")}>
            <div className="label">{k.l}</div>
            <div className="num mt-2 text-[17px] font-medium leading-6">{k.v}</div>
          </div>
        ))}
      </Panel>
      <Panel>
        <PanelHeader index="01" title="Equity, drawdown, distribution, Sharpe" />
        <div className="p-5">
          <Gap
            title={`${s.daily.length} night${s.daily.length === 1 ? "" : "s"} recorded`}
            detail="These need at least two nightly balances. They appear automatically as morning reports are written; nothing is estimated in the meantime."
          />
        </div>
      </Panel>
    </div>
  );
}

function FullAnalytics() {
  const s = useSnap();
  const [range, setRange] = useState("90D");
  const daily = useMemo(() => sliceDaily(s.daily, range), [s.daily, range]);
  const st = useMemo(() => tradeStats(s, daily), [s, daily]);
  const dd = useMemo(() => drawdownSeries(daily), [daily]);
  const since = daily[0].t;
  const sells = useMemo(() => s.trades.filter((t) => t.pnl !== null && t.at >= since), [s.trades, since]);

  const hist = useMemo(() => {
    const vals = daily.map((d) => d.pnl);
    const max = Math.max(...vals.map(Math.abs));
    const n = 13;
    const w = (2 * max) / n || 1;
    const buckets = Array.from({ length: n }, (_, i) => ({ lo: -max + i * w, hi: -max + (i + 1) * w, count: 0 }));
    for (const v of vals) buckets[Math.min(n - 1, Math.floor((v + max) / w))].count++;
    return buckets;
  }, [daily]);

  const byHour = useMemo(() => {
    const h = Array.from({ length: 24 }, () => ({ pnl: 0, n: 0 }));
    for (const t of sells) {
      const hr = +new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Chicago" }).format(t.at) % 24;
      h[hr].pnl += t.pnl!;
      h[hr].n++;
    }
    return h;
  }, [sells]);

  const attribution = useMemo(() => {
    const m = new Map<string, Attribution>();
    for (const t of s.trades) {
      if (t.at < since || t.status !== "filled") continue;
      const a = m.get(t.symbol) ?? { symbol: t.symbol, trades: 0, wins: 0, pnl: 0, volume: 0 };
      a.trades++;
      a.volume += t.notional ?? 0;
      if (t.pnl !== null) {
        a.pnl += t.pnl;
        if (t.pnl > 0) a.wins++;
      }
      m.set(t.symbol, a);
    }
    return [...m.values()];
  }, [s.trades, since]);
  const maxAbsAttr = Math.max(1, ...attribution.map((a) => Math.abs(a.pnl)));

  const kpis = [
    { l: "Sharpe (ann.)", v: st.sharpe.toFixed(2), sub: "Daily returns, 365d" },
    { l: "Sortino (ann.)", v: st.sortino.toFixed(2), sub: "Downside deviation" },
    { l: "Profit factor", v: st.profitFactor.toFixed(2), sub: "Gross win / gross loss" },
    { l: "Expectancy", v: <span className={st.expectancy >= 0 ? "text-pos" : "text-neg"}>{fmtUsd(st.expectancy, { sign: true })}</span>, sub: "Per closing trade" },
    { l: "Max drawdown", v: <span className="text-neg">{fmtPct(st.maxDrawdown, { decimals: 1 })}</span>, sub: "Peak to trough" },
    { l: "Positive days", v: fmtPct(st.positiveDays, { decimals: 0 }), sub: `${daily.length} days` },
    { l: "Avg win / loss", v: <><span className="text-pos">${Math.round(st.avgWin)}</span><span className="text-fg-4">/</span><span className="text-neg">${Math.round(Math.abs(st.avgLoss))}</span></>, sub: st.avgLoss ? `Ratio ${(st.avgWin / Math.abs(st.avgLoss)).toFixed(2)}` : "—" },
  ];

  const attrCols: Column<Attribution>[] = [
    { key: "symbol", header: "Token", sort: (a) => a.symbol, cell: (a) => <span className="flex items-center gap-2.5"><TokenMark symbol={a.symbol} size={22} /><span className="font-medium">{a.symbol}</span></span> },
    { key: "trades", header: "Fills", align: "right", sort: (a) => a.trades, cell: (a) => <span className="num text-fg-2">{a.trades}</span> },
    { key: "wr", header: "Win rate", align: "right", sort: (a) => a.wins / Math.max(1, a.trades), cell: (a) => <span className="num text-fg-2">{fmtPct(a.wins / Math.max(1, a.trades), { decimals: 0 })}</span>, hideBelow: "sm" },
    { key: "vol", header: "Volume", align: "right", sort: (a) => a.volume, cell: (a) => <span className="num text-fg-2">{fmtCompactUsd(a.volume)}</span>, hideBelow: "md" },
    {
      key: "pnl",
      header: "Realised P&L",
      align: "right",
      sort: (a) => a.pnl,
      cell: (a) => (
        <div className="flex items-center justify-end gap-3">
          <div className="relative hidden h-1.5 w-28 sm:block">
            <span className="absolute inset-y-0 left-1/2 w-px bg-line-3" />
            <span className={cx("absolute inset-y-0 rounded-sm", a.pnl >= 0 ? "left-1/2 bg-pos" : "right-1/2 bg-neg")} style={{ width: `${(Math.abs(a.pnl) / maxAbsAttr) * 50}%` }} />
          </div>
          <span className={cx("num w-20 text-right", a.pnl >= 0 ? "text-pos" : "text-neg")}>{fmtUsd(a.pnl, { sign: true, decimals: 0 })}</span>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Trading Analytics" description="Risk-adjusted returns, drawdowns, distribution and attribution. Every panel follows the selected range." right={<RangeControl value={range} onChange={setRange} />} />

      <Panel className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
        {kpis.map((k, i) => (
          <div key={k.l} className={cx("border-line p-5", i > 0 && "xl:border-l", i % 2 === 1 && "max-sm:border-l", i % 4 !== 0 && "sm:max-xl:border-l", i >= 2 && "max-sm:border-t", i >= 4 && "sm:max-xl:border-t")}>
            <div className="label">{k.l}</div>
            <div className="num mt-2 whitespace-nowrap text-[17px] font-medium leading-6">{k.v}</div>
            <div className="mt-1 text-xs text-fg-3">{k.sub}</div>
          </div>
        ))}
      </Panel>

      <Panel>
        <PanelHeader index="01" title="Equity & drawdown" subtitle="Shared time axis, separate scales" />
        <div className="px-5 pt-4">
          <LineChart data={daily.map((d) => ({ t: d.t, v: d.equity }))} label="Equity" height={260} format={(v) => fmtCompactUsd(v)} xFormat={fmtDate} tooltipTitle={fmtFullDate} showXAxis={false} />
        </div>
        <div className="px-5 pb-4">
          <div className="label mb-1 mt-2">Drawdown from peak</div>
          <LineChart data={dd} label="Drawdown" color={C.neg} height={130} areaTo="zero" yTicks={2} format={(v) => fmtPct(v, { decimals: 0 })} xFormat={fmtDate} tooltipTitle={fmtFullDate} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader index="02" title="Daily P&L distribution" subtitle={`μ ${fmtUsd(st.meanDay, { sign: true, decimals: 0 })} · σ ${fmtUsd(st.sdDay, { decimals: 0 })}`} />
          <div className="p-5">
            <BarChart
              data={hist.map((b, i) => ({ key: i, v: b.count, label: fmtCompactUsd((b.lo + b.hi) / 2, true) }))}
              height={220}
              format={(v) => fmtNum(v)}
              xLabelEvery={3}
              color={C.accent}
              tooltip={(b, i) => (
                <>
                  <div className="num mb-1 text-2xs text-fg-3">{fmtCompactUsd(hist[i].lo, true)} to {fmtCompactUsd(hist[i].hi, true)}</div>
                  <TooltipRow color={C.accent} label="Days" value={b.v} />
                </>
              )}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHeader index="03" title="Performance by hour" subtitle="Realised P&L of closing trades, CT" />
          <div className="p-5">
            <BarChart
              data={byHour.map((h, i) => ({ key: i, v: h.pnl, label: String(i).padStart(2, "0") }))}
              height={220}
              signed
              format={(v) => fmtCompactUsd(v, true)}
              xLabelEvery={3}
              tooltip={(b, i) => (
                <>
                  <div className="num mb-1 text-2xs text-fg-3">{b.label}:00–{b.label}:59 CT</div>
                  <TooltipRow label="Realised" value={<span className={b.v >= 0 ? "text-pos" : "text-neg"}>{fmtUsd(b.v, { sign: true })}</span>} />
                  <TooltipRow label="Trades" value={byHour[i].n} />
                </>
              )}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader index="04" title="Attribution by token" subtitle="Filled orders in range" />
        <DataTable rows={attribution} columns={attrCols} rowKey={(a) => a.symbol} initialSort={{ key: "pnl", dir: "desc" }} pageSize={15} />
      </Panel>
    </div>
  );
}
