"use client";

import { CheckCircle2, Copy, Download, ShieldCheck, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge, Button, KeyValue, PageHeader, Panel, SearchInput, Segmented, Select, type Tone } from "@/components/ui/primitives";
import { cx, fmtCompactUsd, fmtDateTime, fmtMs, fmtNum, fmtPct, fmtPrice, fmtQty, fmtUsd, shortHash } from "@/lib/format";
import { useNow } from "@/lib/store";
import type { Trade, TradeStatus } from "@/lib/types";
import { useSnap } from "./common";
import { downloadCsv, useCopy } from "./useCopy";

const STATUS: Record<TradeStatus, [Tone, string]> = { filled: ["pos", "Filled"], pending: ["accent", "Pending"], rejected: ["warn", "Rejected"], failed: ["neg", "Failed"] };

const RANGES = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "all", label: "All loaded" },
];

export function Trades() {
  const s = useSnap();
  const now = useNow(60_000);
  const copy = useCopy();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [status, setStatus] = useState<TradeStatus | "all">("all");
  const [range, setRange] = useState(params.get("q") ? "all" : "30");

  const since = range === "all" ? 0 : (now || s.generatedAt) - +range * 86_400_000;
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    return s.trades.filter(
      (t) =>
        (side === "all" || t.side === side) &&
        (status === "all" || t.status === status) &&
        (!term || t.symbol.toLowerCase().includes(term) || t.id.toLowerCase().includes(term) || (t.txHash ?? "").toLowerCase().includes(term) || t.decisionId.toLowerCase().includes(term)),
    );
  }, [s.trades, q, side, status]);
  const rows = useMemo(() => matches.filter((t) => t.at >= since), [matches, since]);
  const hiddenByRange = matches.length - rows.length;

  const filled = rows.filter((t) => t.status === "filled");
  const realized = filled.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const sells = filled.filter((t) => t.pnl !== null);
  const winRate = sells.length ? sells.filter((t) => (t.pnl ?? 0) > 0).length / sells.length : 0;
  const volume = filled.reduce((a, t) => a + (t.notional ?? 0), 0);
  const feeKnown = filled.some((t) => t.fee !== null);
  const fees = feeKnown ? filled.reduce((a, t) => a + (t.fee ?? 0), 0) : null;
  const slipRows = filled.filter((t) => t.slippageBps !== null);
  const avgSlip = slipRows.length ? slipRows.reduce((a, t) => a + (t.slippageBps ?? 0), 0) / slipRows.length : null;

  const cols: Column<Trade>[] = [
    { key: "at", header: "Time (CT)", sort: (t) => t.at, cell: (t) => <span className="num text-fg-2">{fmtDateTime(t.at).replace(" CT", "")}</span> },
    { key: "id", header: "Trade", sort: (t) => t.id, cell: (t) => <span className="num text-fg-3">{t.id}</span>, hideBelow: "lg" },
    { key: "symbol", header: "Token", sort: (t) => t.symbol, cell: (t) => <span className="font-medium">{t.symbol}</span> },
    { key: "side", header: "Side", sort: (t) => t.side, cell: (t) => <span className={cx("num text-xs font-medium uppercase tracking-wide", t.side === "buy" ? "text-accent-2" : "text-cyan")}>{t.side}</span> },
    { key: "price", header: "Price", align: "right", sort: (t) => t.price, cell: (t) => <span className="num">{fmtPrice(t.price)}</span>, hideBelow: "md" },
    { key: "notional", header: "Notional", align: "right", sort: (t) => t.notional, cell: (t) => <span className="num">{fmtUsd(t.notional)}</span> },
    { key: "slip", header: "Slippage", align: "right", sort: (t) => t.slippageBps, cell: (t) => <span className={cx("num", (t.slippageBps ?? 0) > 100 ? "text-warn" : "text-fg-2")}>{t.slippageBps === null ? "—" : `${t.slippageBps} bps`}</span>, hideBelow: "xl" },
    {
      key: "pnl",
      header: "Realised",
      align: "right",
      sort: (t) => t.pnl ?? -Infinity,
      cell: (t) => (t.pnl === null ? <span className="text-fg-4">—</span> : <span className={cx("num", t.pnl >= 0 ? "text-pos" : "text-neg")}>{fmtUsd(t.pnl, { sign: true })}</span>),
    },
    { key: "status", header: "Status", sort: (t) => t.status, cell: (t) => <Badge tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</Badge> },
    {
      key: "verified",
      header: "Verified",
      align: "center",
      sort: (t) => (t.verified ? 1 : 0),
      cell: (t) => (t.verified ? <ShieldCheck className="mx-auto size-4 text-pos" aria-label="Settlement verified" /> : <span className="text-fg-4">—</span>),
      hideBelow: "sm",
    },
  ];

  const expand = (t: Trade) => (
    <div className="grid grid-cols-1 gap-x-10 px-5 py-4 lg:grid-cols-2">
      <KeyValue
        cols={1}
        items={[
          { k: "Quantity", v: fmtQty(t.qty) },
          { k: "Fee", v: fmtUsd(t.fee) },
          { k: "Slippage", v: `${t.slippageBps} bps` },
          { k: "Execution latency", v: fmtMs(t.latencyMs) },
        ]}
      />
      <KeyValue
        cols={1}
        items={[
          { k: "Reason", v: <span className="font-sans">{t.reason}</span> },
          { k: "Decision", v: t.decisionId },
          {
            k: "Transaction",
            v: t.txHash ? (
              <button type="button" onClick={() => copy(t.txHash!, "Transaction hash")} className="inline-flex items-center gap-1 hover:text-accent-2">
                {shortHash(t.txHash, 8)} <Copy className="size-3" />
              </button>
            ) : (
              "Not submitted"
            ),
          },
          {
            k: "Settlement",
            v: t.verified ? (
              <span className="inline-flex items-center gap-1 text-pos"><CheckCircle2 className="size-3.5" /> Verified on-chain</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-fg-3"><XCircle className="size-3.5" /> No funds moved</span>
            ),
          },
        ]}
      />
    </div>
  );

  const exportCsv = () =>
    downloadCsv(`overnight-desk-trades-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["id", "time_iso", "symbol", "side", "status", "price", "qty", "notional_usd", "fee_usd", "slippage_bps", "realised_pnl_usd", "verified", "tx_hash", "reason"],
      ...rows.map((t) => [t.id, new Date(t.at).toISOString(), t.symbol, t.side, t.status, t.price, t.qty, t.notional?.toFixed(2) ?? null, t.fee?.toFixed(2) ?? null, t.slippageBps, t.pnl === null ? null : t.pnl.toFixed(2), t.verified === null ? "unknown" : t.verified ? "yes" : "no", t.txHash, t.reason]),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade History"
        description="Every order the desk attempted — filled, rejected by Risk, or failed before settlement. Expand a row for its verification record."
        right={
          <Button onClick={exportCsv} disabled={!rows.length}>
            <Download className="size-3.5" /> Export CSV
          </Button>
        }
      />
      <Panel className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { l: "Orders", v: fmtNum(rows.length), sub: `${filled.length} filled` },
          { l: "Realised P&L", v: <span className={realized >= 0 ? "text-pos" : "text-neg"}>{fmtUsd(realized, { sign: true, decimals: 0 })}</span>, sub: `${sells.length} closing trades` },
          { l: "Win rate", v: fmtPct(winRate, { decimals: 1 }), sub: "Closing trades" },
          { l: "Volume", v: fmtCompactUsd(volume), sub: "Filled notional" },
          { l: "Fees", v: fmtUsd(fees, { decimals: 0 }), sub: fees === null ? "Not in trade records" : volume ? `${((fees / volume) * 10000).toFixed(0)} bps of volume` : "—" },
          { l: "Avg slippage", v: avgSlip === null ? "—" : `${avgSlip.toFixed(0)} bps`, sub: avgSlip === null ? "Not in trade records" : `${rows.filter((t) => t.status === "rejected").length} blocked by Risk` },
        ].map((c, i) => (
          <div key={c.l} className={cx("border-line p-5", i > 0 && "xl:border-l", i % 2 === 1 && "max-sm:border-l", i % 3 !== 0 && "sm:max-xl:border-l", i >= 2 && "max-sm:border-t", i >= 3 && "sm:max-xl:border-t")}>
            <div className="label">{c.l}</div>
            <div className="num mt-2 text-[19px] font-medium leading-6">{c.v}</div>
            <div className="mt-1 text-xs text-fg-3">{c.sub}</div>
          </div>
        ))}
      </Panel>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 hairline-b">
          <SearchInput value={q} onChange={setQ} placeholder="Token, trade id, tx hash, decision" className="w-full sm:w-72" />
          <Select label="Range" value={range} onChange={setRange} options={RANGES} />
          <Segmented label="Side" value={side} onChange={setSide} options={[{ value: "all", label: "All" }, { value: "buy", label: "Buys" }, { value: "sell", label: "Sells" }]} />
          <Select label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "filled", label: "Filled" }, { value: "rejected", label: "Rejected" }, { value: "failed", label: "Failed" }, { value: "pending", label: "Pending" }]} />
          {q && hiddenByRange > 0 && (
            <button type="button" onClick={() => setRange("all")} className="text-xs text-accent-2 hover:text-fg">
              {hiddenByRange} more outside range · search all dates
            </button>
          )}
          <span className="num ml-auto text-xs text-fg-3">{rows.length} trades</span>
        </div>
        <DataTable rows={rows} columns={cols} rowKey={(t) => t.id} expand={expand} initialSort={{ key: "at", dir: "desc" }} pageSize={20} defaultOpen={params.get("q") ? [params.get("q")!] : undefined} />
      </Panel>
    </div>
  );
}
