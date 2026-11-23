"use client";

import { ArrowRight, OctagonX, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BarChart } from "@/components/charts/BarChart";
import { C, TooltipRow } from "@/components/charts/core";
import { LineChart } from "@/components/charts/LineChart";
import { CalendarHeatmap, Sparkline } from "@/components/charts/Small";
import { Delta, Gap, KeyValue, Meter, PageHeader, Panel, PanelHeader, Tabs, TokenMark } from "@/components/ui/primitives";
import { has, liveLimits, nightSession, overview, positionPct, positionPnl, positionValue, sliceDaily } from "@/lib/derive";
import { cx, fmtCompactUsd, fmtDate, fmtFullDate, fmtHM, fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { useNow } from "@/lib/store";
import type { RiskLimit } from "@/lib/types";
import { ActivityFeed, AgentPipeline, RangeControl, useSnap } from "./common";

export function fmtLimit(l: RiskLimit, v: number) {
  if (l.unit === "usd") return fmtUsd(v, { decimals: 0 });
  if (l.unit === "pct") return fmtPct(v, { decimals: 1 });
  if (l.unit === "bps") return `${Math.round(v)} bps`;
  return fmtNum(v);
}

function PerformanceBand() {
  const s = useSnap();
  const o = overview(s);
  const intraday = s.intraday.map((p) => p.equity);
  const sign = (v: number | null) => (v === null ? "text-fg-4" : v >= 0 ? "text-pos" : "text-neg");
  const real = !!s.book;
  const lastDay = s.daily.at(-1);
  const cells: { label: string; value: React.ReactNode; sub: React.ReactNode }[] = [
    { label: "Realised P&L", value: <span className={sign(o.realized)}>{fmtUsd(o.realized, { sign: true })}</span>, sub: real ? `Night ${s.book!.nightId ?? "—"}` : "All time, closed trades" },
    { label: "Unrealised P&L", value: <span className={sign(o.unrealized)}>{fmtUsd(o.unrealized, { sign: true })}</span>, sub: o.unrealized === null && o.activePositions ? "No live mark for an open position" : `${o.activePositions} open positions` },
    { label: real ? "Night P&L" : "Daily P&L", value: <Delta value={o.dayPct} format={(v) => fmtPct(v, { sign: true })} />, sub: real ? `${fmtUsd(o.dayPnl, { sign: true })} vs start ${fmtUsd(o.startCash)}` : fmtUsd(o.dayPnl, { sign: true }) + " today" },
    { label: "Active positions", value: o.activePositions, sub: o.exposure === null ? "Exposure needs live marks" : `${fmtPct(o.exposure, { decimals: 1 })} of equity deployed` },
    { label: "Total trades", value: fmtNum(o.totalTrades), sub: real ? "desk.db + vault trade notes" : `${lastDay?.trades ?? 0} today` },
    { label: "Win rate", value: fmtPct(o.winRate, { decimals: 1 }), sub: o.winRate === null ? "No closed trades yet" : <Meter value={o.winRate} tone="pos" className="mt-1.5 max-w-[120px]" marks={[0.5]} /> },
  ];
  return (
    <Panel className="overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(340px,1.05fr)_2fr]">
        <div className="grid-paper relative flex flex-col justify-between gap-5 border-b border-line p-6 xl:border-b-0 xl:border-r">
          <div>
            <div className="label">{s.meta.bookLabel}</div>
            <div className="num mt-2 text-[38px] font-medium leading-[44px] tracking-[-0.03em] text-fg">
              {fmtUsd(o.equity).replace(/\.\d+$/, "")}
              <span className="text-[22px] text-fg-3">{fmtUsd(o.equity).match(/\.\d+$/)?.[0]}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <Delta value={o.dayPnl} format={(v) => fmtUsd(v, { sign: true })} />
              <span className="text-fg-4">·</span>
              {real ? (
                <span className="text-fg-3">
                  Wallet on-chain <span className="num text-fg-2">{s.chain?.error ? "unavailable" : fmtUsd(s.chain?.totalUsd ?? null)}</span>
                </span>
              ) : (
                <span className="text-fg-3">
                  Since inception <span className={cx("num", (o.equity ?? 0) >= s.startingCapital ? "text-pos" : "text-neg")}>{fmtPct(o.equity === null ? null : o.equity / s.startingCapital - 1, { sign: true })}</span>
                </span>
              )}
            </div>
          </div>
          {intraday.length >= 2 ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-2xs text-fg-4">
                <span>24h equity</span>
                <span className="num">{fmtHM(s.intraday[0].t)} → {fmtHM(s.intraday.at(-1)!.t)} CT</span>
              </div>
              <Sparkline data={intraday} width={420} height={54} color={C.accent} stretch />
            </div>
          ) : (
            <Gap compact title="Equity series building" detail="deskview samples equity once a minute; the line appears after two samples." />
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3">
          {cells.map((c, i) => (
            <div key={c.label} className={cx("flex flex-col justify-center border-line p-5", i % 2 === 1 && "border-l sm:border-l-0", i % 3 !== 0 && "sm:border-l", i >= 2 && "border-t sm:border-t-0", i >= 3 && "sm:border-t")}>
              <div className="label">{c.label}</div>
              <div className="num mt-2 text-[21px] font-medium leading-7 text-fg">{c.value}</div>
              <div className="mt-1 text-xs text-fg-3">{c.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

type ChartTab = "equity" | "pnl" | "volume";

function MainAnalytics({ range }: { range: string }) {
  const s = useSnap();
  const [tab, setTab] = useState<ChartTab>("equity");
  const daily = useMemo(() => sliceDaily(s.daily, range), [s.daily, range]);
  const base = s.daily[s.daily.length - daily.length - 1]?.equity ?? s.startingCapital;
  const cum = useMemo(() => {
    const out: { t: number; v: number }[] = [];
    for (const d of daily) out.push({ t: d.t, v: (out.at(-1)?.v ?? 0) + d.pnl });
    return out;
  }, [daily]);
  if (daily.length < 2) {
    return (
      <Panel className="flex min-w-0 flex-col">
        <PanelHeader index="02" title="Portfolio performance" />
        <div className="flex flex-1 items-center p-5">
          <Gap
            className="w-full"
            title={`${s.daily.length} night${s.daily.length === 1 ? "" : "s"} of history`}
            detail="Nightly balances come from vault Daily/ notes. The equity and P&L charts appear once two nights are recorded."
          />
        </div>
      </Panel>
    );
  }
  const periodRet = daily.at(-1)!.equity / base - 1;
  const best = daily.reduce((a, b) => (b.pnl > a.pnl ? b : a));
  const worst = daily.reduce((a, b) => (b.pnl < a.pnl ? b : a));
  const vol = daily.reduce((a, b) => a + b.volume, 0);
  const trades = daily.reduce((a, b) => a + b.trades, 0);
  const every = Math.max(1, Math.ceil(daily.length / 7));

  return (
    <Panel className="flex min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-5 px-5 hairline-b">
        <div className="flex items-baseline gap-2.5 py-3">
          <span className="num text-2xs text-fg-4">02</span>
          <h2 className="text-[13px] font-medium">Portfolio performance</h2>
        </div>
        <Tabs
          className="ml-auto"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "equity", label: "Equity" },
            { value: "pnl", label: "Cumulative P&L" },
            ...(has(s, "volume") ? [{ value: "volume" as const, label: "Volume" }] : []),
          ]}
        />
      </header>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 pb-1 pt-5 sm:grid-cols-4">
        <div>
          <div className="label">Period return</div>
          <Delta value={periodRet} format={(v) => fmtPct(v, { sign: true })} className="mt-1 text-[15px]" />
        </div>
        <div>
          <div className="label">Best day</div>
          <div className="num mt-1 text-[15px] text-pos">{fmtUsd(best.pnl, { sign: true, decimals: 0 })}</div>
          <div className="text-2xs text-fg-4">{fmtDate(best.t)}</div>
        </div>
        <div>
          <div className="label">Worst day</div>
          <div className="num mt-1 text-[15px] text-neg">{fmtUsd(worst.pnl, { sign: true, decimals: 0 })}</div>
          <div className="text-2xs text-fg-4">{fmtDate(worst.t)}</div>
        </div>
        <div>
          <div className="label">{tab === "volume" ? "Period volume" : "Trades"}</div>
          <div className="num mt-1 text-[15px] text-fg">{tab === "volume" ? fmtCompactUsd(vol) : fmtNum(trades)}</div>
          <div className="text-2xs text-fg-4">{(trades / daily.length).toFixed(1)} / day</div>
        </div>
      </div>
      <div className="px-5 pb-4 pt-3">
        {tab === "equity" && (
          <LineChart
            data={daily.map((d) => ({ t: d.t, v: d.equity }))}
            label="Equity"
            height={300}
            format={(v) => fmtCompactUsd(v)}
            xFormat={fmtDate}
            tooltipTitle={fmtFullDate}
            baseline={{ value: s.startingCapital, label: `Starting capital ${fmtCompactUsd(s.startingCapital)}` }}
            extraTooltip={(i) => <TooltipRow label="Day P&L" value={<span className={daily[i].pnl >= 0 ? "text-pos" : "text-neg"}>{fmtUsd(daily[i].pnl, { sign: true })}</span>} />}
          />
        )}
        {tab === "pnl" && (
          <LineChart
            data={cum}
            label="Cumulative P&L"
            color={C.cyan}
            height={300}
            areaTo="zero"
            format={(v) => fmtCompactUsd(v, true)}
            xFormat={fmtDate}
            tooltipTitle={fmtFullDate}
          />
        )}
        {tab === "volume" && (
          <BarChart
            data={daily.map((d) => ({ key: d.t, v: d.volume, label: fmtDate(d.t) }))}
            height={300}
            color={C.accent}
            format={(v) => fmtCompactUsd(v)}
            xLabelEvery={every}
            highlightLast
            tooltip={(b, i) => (
              <>
                <div className="mb-1 text-2xs text-fg-3">{fmtFullDate(daily[i].t)}</div>
                <TooltipRow color={C.accent} label="Volume" value={fmtUsd(b.v, { decimals: 0 })} />
                <TooltipRow label="Trades" value={daily[i].trades} />
              </>
            )}
          />
        )}
      </div>
    </Panel>
  );
}

function DailyPerformance({ range }: { range: string }) {
  const s = useSnap();
  const daily = sliceDaily(s.daily, range);
  const pos = daily.filter((d) => d.pnl > 0).length;
  if (daily.length < 2) {
    return (
      <Panel className="flex min-w-0 flex-col">
        <PanelHeader index="03" title="Nightly performance" />
        <div className="flex flex-1 flex-col gap-4 p-5">
          {s.daily.length === 1 && (
            <KeyValue cols={1} items={[{ k: "Night", v: fmtFullDate(s.daily[0].t) }, { k: "Balance", v: fmtUsd(s.daily[0].equity) }, { k: "P&L", v: fmtUsd(s.daily[0].pnl, { sign: true }) }, { k: "Trades", v: String(s.daily[0].trades) }]} />
          )}
          <Gap className="flex-1" title="Builds night by night" detail="Bars and the calendar fill in as morning reports are written to vault Daily/." />
        </div>
      </Panel>
    );
  }
  return (
    <Panel className="flex min-w-0 flex-col">
      <PanelHeader index="03" title="Daily performance" right={<span className="num text-xs text-fg-3">{pos}/{daily.length} green days</span>} />
      <div className="px-5 pt-4">
        <BarChart
          data={daily.map((d) => ({ key: d.t, v: d.pnl, label: fmtDate(d.t) }))}
          signed
          height={150}
          format={(v) => fmtCompactUsd(v, true)}
          tooltip={(b, i) => (
            <>
              <div className="mb-1 text-2xs text-fg-3">{fmtFullDate(daily[i].t)}</div>
              <TooltipRow label="P&L" value={<span className={b.v >= 0 ? "text-pos" : "text-neg"}>{fmtUsd(b.v, { sign: true })}</span>} />
              <TooltipRow label="Win rate" value={fmtPct(daily[i].wins / Math.max(1, daily[i].trades), { decimals: 0 })} />
            </>
          )}
        />
      </div>
      <div className="mt-auto border-t border-line px-5 py-4">
        <div className="label mb-3">Calendar · 26 weeks</div>
        <CalendarHeatmap daily={s.daily} weeks={26} />
      </div>
    </Panel>
  );
}

function RiskSnapshot() {
  const s = useSnap();
  const limits = liveLimits(s).filter((l) => ["daily_loss", "gross_exposure", "token_exposure", "open_positions"].includes(l.key));
  const engaged = s.emergencyStop.engaged;
  const top = [...s.positions].sort((a, b) => (positionValue(b) ?? 0) - (positionValue(a) ?? 0)).slice(0, 5);
  const m = s.meta.deskMode;
  return (
    <Panel className="flex min-w-0 flex-col">
      <PanelHeader index="06" title="Risk & book" right={<Link href="/risk" className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg">Risk <ArrowRight className="size-3" /></Link>} />
      <Link href="/risk" className={cx("mx-5 mt-4 flex items-center gap-3 rounded-md border px-3.5 py-3 transition-colors", engaged ? "border-neg/40 bg-neg/10" : "border-line bg-bg-2/60 hover:border-line-2")}>
        {engaged ? <OctagonX className="size-5 text-neg" /> : <ShieldCheck className="size-5 text-pos" />}
        <div>
          <div className="text-[12.5px] font-medium text-fg">{engaged ? (m ? "Desk paused" : "Emergency stop engaged") : m ? "Desk not paused" : "Kill switch armed"}</div>
          <div className="text-xs text-fg-3">{engaged ? `Halted · ${s.emergencyStop.reason ?? "no reason recorded"}` : m ? `${m.botsPaused.length ? `Paused bots: ${m.botsPaused.join(", ")}` : "No bots paused"}` : "All automated controls active"}</div>
        </div>
      </Link>
      {s.riskSettings && (
        <div className="px-5 pt-2">
          {s.riskSettings.length ? (
            <KeyValue cols={1} items={s.riskSettings.slice(0, 6).map((r) => ({ k: <span className="num">{r.key}</span>, v: r.value }))} />
          ) : (
            <Gap compact className="mt-2" title="No risk settings" detail="Settings.md has no risk: section." />
          )}
        </div>
      )}
      <ul className="space-y-3.5 px-5 py-4">
        {limits.map((l) => (
          <li key={l.key}>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-fg-2">{l.label}</span>
              <span className="num text-fg-3">
                <span className="text-fg">{fmtLimit(l, l.used)}</span> / {fmtLimit(l, l.limit)}
              </span>
            </div>
            <Meter value={l.used} max={l.limit} />
          </li>
        ))}
      </ul>
      <div className="mt-auto border-t border-line">
        <div className="flex items-center justify-between px-5 pb-1 pt-3">
          <span className="label">Largest positions</span>
          <Link href="/positions" className="text-xs text-fg-3 hover:text-fg">All {s.positions.length}</Link>
        </div>
        <ul>
          {top.map((p) => (
            <li key={p.id}>
              <Link href={`/positions?focus=${p.id}`} className="flex items-center gap-3 px-5 py-2 transition-colors hover:bg-elevated/45">
                <TokenMark symbol={p.symbol} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-fg">{p.symbol}</span>
                  <span className="num block text-2xs text-fg-4">{fmtUsd(positionValue(p), { decimals: 0 })}</span>
                </span>
                <span className="text-right">
                  <span className={cx("num block text-[12.5px]", (positionPnl(p) ?? 0) >= 0 ? "text-pos" : "text-neg")}>{fmtUsd(positionPnl(p), { sign: true })}</span>
                  <span className="num block text-2xs text-fg-4">{fmtPct(positionPct(p), { sign: true })}</span>
                </span>
              </Link>
            </li>
          ))}
          {top.length === 0 && <li className="px-5 py-6 text-center text-xs text-fg-3">No open positions.</li>}
        </ul>
      </div>
    </Panel>
  );
}

export function CommandCenter() {
  const s = useSnap();
  const now = useNow(60_000);
  const [range, setRange] = useState("30D");
  const session = now ? nightSession(now) : null;
  const running = s.agents.filter((a) => a.status === "running").length;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={now ? `${fmtFullDate(now)}${session ? ` · ${session.detail}` : ""}` : " "}
        title="Command Center"
        description={`${running} of ${s.agents.length} agents running · ${s.positions.length} open positions · ${s.tokens.filter((t) => t.verdict === "pending").length} tokens awaiting evaluation`}
        right={<RangeControl value={range} onChange={setRange} />}
      />

      <section aria-labelledby="perf">
        <div className="mb-3 flex items-baseline gap-2.5">
          <span className="num text-2xs text-fg-4">01</span>
          <h2 id="perf" className="label text-fg-2">Performance overview</h2>
        </div>
        <PerformanceBand />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <MainAnalytics range={range} />
        <DailyPerformance range={range} />
      </div>

      <Panel>
        <PanelHeader
          index="04"
          title="Agent monitor"
          subtitle="Scanner → Analyst → Brain → Executor, supervised by Risk"
          right={<Link href="/agents" className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg">Agent detail <ArrowRight className="size-3" /></Link>}
        />
        <AgentPipeline agents={s.agents} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Panel className="min-w-0">
          <PanelHeader index="05" title="Live activity" subtitle="Discoveries, evaluations, decisions, executions, alerts" />
          <ActivityFeed events={s.activity} maxHeight={560} />
        </Panel>
        <RiskSnapshot />
      </div>
    </div>
  );
}
