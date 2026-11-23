"use client";

import { Copy, Loader2, OctagonX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { C } from "@/components/charts/core";
import { LineChart } from "@/components/charts/LineChart";
import { AllocationBar, Sparkline } from "@/components/charts/Small";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Overlay";
import { Badge, Button, Delta, Empty, Gap, KeyValue, PageHeader, Panel, PanelHeader, SearchInput, Segmented, TokenMark } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { overview, positionPct, positionPnl, positionValue } from "@/lib/derive";
import { cx, fmtDuration, fmtHM, fmtPct, fmtPrice, fmtQty, fmtTime, fmtUsd, shortHash } from "@/lib/format";
import { useDesk, useNow } from "@/lib/store";
import type { Position } from "@/lib/types";
import { useSnap } from "./common";
import { useCopy } from "./useCopy";

/** Stop ─── entry ─── target range with the current mark. */
function StopTargetBar({ p }: { p: Position }) {
  if (p.stop === null || p.target === null || p.mark === null) {
    return <span className="text-xs text-fg-4">{p.stop !== null ? `SL ${fmtPrice(p.stop)}` : "—"}</span>;
  }
  const stop = p.stop;
  const mark = p.mark;
  const span = p.target - stop;
  const at = (v: number) => Math.max(0, Math.min(1, (v - stop) / span)) * 100;
  const up = mark >= p.entry;
  return (
    <div className="w-36">
      <div className="relative h-1.5 rounded-full bg-fg-4/25">
        <div className={cx("absolute inset-y-0 rounded-full", up ? "bg-pos/60" : "bg-neg/60")} style={{ left: `${Math.min(at(p.entry), at(mark))}%`, width: `${Math.abs(at(mark) - at(p.entry))}%` }} />
        <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-fg-3" style={{ left: `${at(p.entry)}%` }} title="Entry" />
        <span className={cx("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel", up ? "bg-pos" : "bg-neg")} style={{ left: `${at(mark)}%` }} title="Mark" />
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-fg-4">
        <span>SL</span>
        <span>TP</span>
      </div>
    </div>
  );
}

export function Positions() {
  const s = useSnap();
  const now = useNow(10_000);
  const { actions, mode, readOnly } = useDesk();
  const toast = useToast();
  const copy = useCopy();
  const params = useSearchParams();
  const focus = params.get("focus");
  const [q, setQ] = useState("");
  const [side, setSide] = useState<"all" | "win" | "lose">("all");
  const [closing, setClosing] = useState<Position | null>(null);
  const o = overview(s);

  const rows = useMemo(
    () =>
      s.positions.filter((p) => {
        const pnl = positionPnl(p);
        return (side === "all" || (pnl !== null && (side === "win" ? pnl >= 0 : pnl < 0))) && (!q || p.symbol.toLowerCase().includes(q.toLowerCase()) || p.name.toLowerCase().includes(q.toLowerCase()));
      }),
    [s.positions, q, side],
  );

  const marksKnown = s.positions.every((p) => p.mark !== null);
  const mv = marksKnown ? s.positions.reduce((a, p) => a + (positionValue(p) ?? 0), 0) : null;
  const cost = s.positions.reduce((a, p) => a + p.entry * p.qty, 0);
  const avgHold = s.positions.length && now ? s.positions.reduce((a, p) => a + (now - p.openedAt), 0) / s.positions.length : 0;

  const confirmClose = async () => {
    const p = closing;
    setClosing(null);
    if (!p) return;
    toast({ tone: "info", title: `Close requested · ${p.symbol}`, detail: "Routed to Executor. Awaiting settlement verification." });
    const r = await actions.closePosition(p.id);
    toast({ tone: r.ok ? "success" : "warning", title: r.message });
  };

  const cols: Column<Position>[] = [
    {
      key: "token",
      header: "Position",
      sort: (p) => p.symbol,
      cell: (p) => (
        <div className="flex items-center gap-2.5">
          <TokenMark symbol={p.symbol} />
          <div>
            <div className="flex items-center gap-2 font-medium">
              {p.symbol}
              {p.closing && <Badge tone="accent"><Loader2 className="size-3 animate-spin" /> Closing</Badge>}
            </div>
            <div className="text-2xs text-fg-3">{p.name}</div>
          </div>
        </div>
      ),
    },
    { key: "held", header: "Held", align: "right", sort: (p) => -p.openedAt, cell: (p) => <span className="num text-fg-2">{now ? fmtDuration(now - p.openedAt) : "—"}</span>, hideBelow: "md" },
    { key: "qty", header: "Quantity", align: "right", sort: (p) => p.qty, cell: (p) => <span className="num text-fg-2">{fmtQty(p.qty)}</span>, hideBelow: "xl" },
    { key: "entry", header: "Entry", align: "right", sort: (p) => p.entry, cell: (p) => <span className="num text-fg-2">{fmtPrice(p.entry)}</span>, hideBelow: "lg" },
    { key: "mark", header: "Mark", align: "right", sort: (p) => p.mark, cell: (p) => <span className="num">{fmtPrice(p.mark)}</span> },
    { key: "value", header: "Value", align: "right", sort: positionValue, cell: (p) => <span className="num">{fmtUsd(positionValue(p))}</span> },
    {
      key: "pnl",
      header: "Unrealised",
      align: "right",
      sort: positionPnl,
      cell: (p) => (
        <div className="leading-4">
          <div className={cx("num", positionPnl(p) === null ? "text-fg-4" : positionPnl(p)! >= 0 ? "text-pos" : "text-neg")}>{fmtUsd(positionPnl(p), { sign: true })}</div>
          <div className="num text-2xs text-fg-3">{fmtPct(positionPct(p), { sign: true })}</div>
        </div>
      ),
    },
    { key: "range", header: "Stop → Target", cell: (p) => <StopTargetBar p={p} />, hideBelow: "lg" },
    { key: "trend", header: "Trend", align: "right", cell: (p) => <Sparkline data={p.spark} width={72} height={22} className="ml-auto" />, hideBelow: "xl" },
    ...(readOnly
      ? [
          {
            key: "fomo",
            header: <span className="sr-only">Links</span>,
            align: "right" as const,
            cell: (p: Position) =>
              p.fomoUrl ? (
                <a href={p.fomoUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-accent-2 hover:text-fg">
                  FOMO ↗
                </a>
              ) : null,
          },
        ]
      : [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            align: "right" as const,
            cell: (p: Position) => (
              <Button size="sm" variant="danger" disabled={p.closing} onClick={(e) => { e.stopPropagation(); setClosing(p); }}>
                Close
              </Button>
            ),
          },
        ]),
  ];

  const expand = (p: Position) => (
    <div className="grid grid-cols-1 gap-6 px-5 py-5 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="label mb-2">Price since entry</div>
        {p.spark.length < 2 ? (
          <Gap title="No price history" detail="deskview reports the current mark only; per-position price history is not recorded by the desk." />
        ) : (
        <LineChart
          data={p.spark.map((v, i) => ({ t: (now || s.generatedAt) - (p.spark.length - 1 - i) * 5 * 60_000, v }))}
          label="Mark"
          height={170}
          color={(positionPnl(p) ?? 0) >= 0 ? C.pos : C.neg}
          format={fmtPrice}
          xFormat={fmtHM}
          tooltipTitle={(t) => fmtTime(t) + " CT"}
          baseline={{ value: p.entry, label: `Entry ${fmtPrice(p.entry)}` }}
        />
        )}
      </div>
      <div>
        <div className="label mb-2">Thesis</div>
        <p className="text-[12.5px] leading-5 text-fg-2">{p.thesis || "—"}</p>
        <KeyValue
          cols={1}
          className="mt-3"
          items={[
            { k: "Stop-loss", v: p.stop === null ? "—" : <span className="text-neg">{fmtPrice(p.stop)} ({fmtPct(p.stop / p.entry - 1, { sign: true, decimals: 1 })})</span> },
            { k: "Take-profit", v: p.target === null ? "— (trailing exit)" : <span className="text-pos">{fmtPrice(p.target)} ({fmtPct(p.target / p.entry - 1, { sign: true, decimals: 1 })})</span> },
            { k: "Cost basis", v: fmtUsd(p.entry * p.qty) },
            ...(p.source ? [{ k: "Book", v: p.source }] : []),
            { k: "Brain confidence", v: p.confidence === null ? "—" : p.confidence.toFixed(2) },
            {
              k: "Entry transaction",
              v: p.txHash ? (
                <button type="button" onClick={() => copy(p.txHash!, "Transaction hash")} className="inline-flex items-center gap-1 hover:text-accent-2">{shortHash(p.txHash, 6)} <Copy className="size-3" /></button>
              ) : (
                "—"
              ),
            },
          ]}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Open Positions"
        description={
          readOnly
            ? "Positions from desk.db and the paper book, marked with DexScreener prices. Read-only: sell with the Telegram `sell X 25|50|100` command."
            : "Marks update live. Stops and targets are enforced by Risk and Executor; manual closes are routed through the same verification path."
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel className="grid grid-cols-2 sm:grid-cols-3">
          {[
            { l: "Market value", v: fmtUsd(mv), sub: `${s.positions.length} positions` },
            { l: "Cost basis", v: fmtUsd(cost), sub: "At entry" },
            { l: "Unrealised P&L", v: <Delta value={o.unrealized} format={(v) => fmtUsd(v, { sign: true })} />, sub: cost && o.unrealized !== null ? fmtPct(o.unrealized / cost, { sign: true }) + " on cost" : marksKnown ? "—" : "Missing live marks" },
            { l: "Equity deployed", v: fmtPct(o.exposure, { decimals: 1 }), sub: `of ${fmtUsd(o.equity, { decimals: 0 })}` },
            { l: "Cash available", v: fmtUsd(s.cash, { decimals: 0 }), sub: s.book ? "Paper cash, tonight" : "USDC + SOL" },
            { l: "Average hold", v: avgHold ? fmtDuration(avgHold) : "—", sub: "Open positions" },
          ].map((c, i) => (
            <div key={c.l} className={cx("border-line p-5", i % 2 === 1 && "border-l sm:border-l-0", i % 3 !== 0 && "sm:border-l", i >= 2 && "max-sm:border-t", i >= 3 && "sm:border-t")}>
              <div className="label">{c.l}</div>
              <div className="num mt-2 text-[19px] font-medium leading-6">{c.v}</div>
              <div className="mt-1 text-xs text-fg-3">{c.sub}</div>
            </div>
          ))}
        </Panel>
        <Panel>
          <PanelHeader title="Allocation" subtitle="Market value incl. cash" />
          <div className="p-5">
            {marksKnown ? (
              <AllocationBar items={[...s.positions.map((p) => ({ label: p.symbol, value: positionValue(p) ?? 0 })), { label: "Cash", value: s.cash }]} />
            ) : (
              <Gap compact title="Needs live marks" detail="Allocation is shown once every open position has a DexScreener price." />
            )}
          </div>
        </Panel>
      </div>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 hairline-b">
          <SearchInput value={q} onChange={setQ} placeholder="Filter positions" className="w-full sm:w-60" />
          <Segmented label="P&L filter" value={side} onChange={setSide} options={[{ value: "all", label: "All" }, { value: "win", label: "In profit" }, { value: "lose", label: "Under water" }]} />
          <span className="num ml-auto text-xs text-fg-3">Click a row for detail</span>
        </div>
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(p) => p.id}
          expand={expand}
          defaultOpen={focus ? [focus] : undefined}
          initialSort={{ key: "value", dir: "desc" }}
          rowClassName={(p) => (p.id === focus ? "shadow-[inset_2px_0_0_var(--color-accent)]" : undefined)}
          empty={<Empty title="No open positions" detail={s.emergencyStop.engaged ? "Emergency stop is engaged; no new positions will open." : "New positions appear here once Brain approves and Executor verifies settlement."} />}
        />
      </Panel>
      <Dialog
        open={!!closing}
        onClose={() => setClosing(null)}
        tone="danger"
        title={`Close ${closing?.symbol} position?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClosing(null)}>Cancel</Button>
            <Button variant="danger-solid" onClick={confirmClose} data-autofocus>
              <OctagonX className="size-3.5" /> Request close
            </Button>
          </>
        }
      >
        {closing && (
          <>
            <p>A market sell for the full position is sent to the Executor. It settles only after on-chain verification; Risk slippage limits still apply.</p>
            <KeyValue
              cols={1}
              className="mt-4"
              items={[
                { k: "Quantity", v: fmtQty(closing.qty) },
                { k: "Est. proceeds", v: fmtUsd(positionValue(closing)) },
                { k: "Est. realised P&L", v: <span className={(positionPnl(closing) ?? 0) >= 0 ? "text-pos" : "text-neg"}>{fmtUsd(positionPnl(closing), { sign: true })}</span> },
                { k: "Max slippage", v: `${s.limits.find((l) => l.key === "max_slippage")?.limit ?? "—"} bps` },
              ]}
            />
            {mode === "demo" && <p className="mt-3 text-xs text-warn">Demo mode: the close is simulated; no order reaches a market.</p>}
            {mode === "live" && <p className="mt-3 text-xs font-medium text-neg">LIVE mode: this sends a real order.</p>}
          </>
        )}
      </Dialog>
      <div className="text-center text-xs text-fg-4">
        Closed positions move to <Link href="/trades" className="text-fg-3 underline-offset-2 hover:underline">Trade History</Link>.
      </div>
    </div>
  );
}
