"use client";

import { ArrowDownLeft, ArrowUpRight, Copy, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { AllocationBar } from "@/components/charts/Small";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge, Delta, Gap, PageHeader, Panel, PanelHeader, Segmented, TokenMark } from "@/components/ui/primitives";
import { cx, fmtDateTime, fmtPct, fmtPrice, fmtQty, fmtUsd, shortHash } from "@/lib/format";
import type { Transfer, WalletAsset } from "@/lib/types";
import { useSnap } from "./common";
import { useCopy } from "./useCopy";

export function Wallet() {
  const s = useSnap();
  const copy = useCopy();
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  // Token balances follow live position marks.
  const assets: WalletAsset[] = useMemo(
    () => s.assets.map((a) => {
      const p = s.positions.find((x) => x.symbol === a.symbol);
      return a.kind === "token" ? (p ? { ...a, price: p.mark, balance: p.qty } : null) : a;
    }).filter((a): a is WalletAsset => a !== null),
    [s.assets, s.positions],
  );
  const total = assets.reduce((a, b) => a + b.balance * b.price, 0);
  const change = assets.reduce((a, b) => a + b.balance * b.price * (b.change24h / (1 + b.change24h)), 0);
  const stable = assets.filter((a) => a.kind === "stable").reduce((x, a) => x + a.balance * a.price, 0);
  const real = s.meta.source !== "demo";
  const transfers = s.transfers.filter((t) => dir === "all" || t.direction === dir);

  const assetCols: Column<WalletAsset>[] = [
    { key: "asset", header: "Asset", sort: (a) => a.symbol, cell: (a) => <span className="flex items-center gap-2.5"><TokenMark symbol={a.symbol} /><span><span className="block font-medium">{a.symbol}</span><span className="block text-2xs text-fg-3">{a.name}</span></span></span> },
    { key: "kind", header: "Type", sort: (a) => a.kind, cell: (a) => <Badge tone={a.kind === "stable" ? "cyan" : a.kind === "native" ? "accent" : "neutral"}>{a.kind}</Badge>, hideBelow: "sm" },
    { key: "bal", header: "Balance", align: "right", sort: (a) => a.balance, cell: (a) => <span className="num text-fg-2">{fmtQty(a.balance)}</span> },
    { key: "price", header: "Price", align: "right", sort: (a) => a.price, cell: (a) => <span className="num text-fg-2">{fmtPrice(a.price)}</span>, hideBelow: "md" },
    { key: "value", header: "Value", align: "right", sort: (a) => a.balance * a.price, cell: (a) => <span className="num">{fmtUsd(a.balance * a.price)}</span> },
    { key: "chg", header: "24h", align: "right", sort: (a) => a.change24h, cell: (a) => <Delta value={a.change24h} icon={false} format={(v) => fmtPct(v, { sign: true })} />, hideBelow: "md" },
    { key: "alloc", header: "Allocation", align: "right", sort: (a) => a.balance * a.price, cell: (a) => <span className="num text-fg-2">{fmtPct((a.balance * a.price) / total, { decimals: 1 })}</span>, hideBelow: "lg" },
  ];

  const txCols: Column<Transfer>[] = [
    { key: "at", header: "Time (CT)", sort: (t) => t.at, cell: (t) => <span className="num text-fg-2">{fmtDateTime(t.at).replace(" CT", "")}</span> },
    {
      key: "dir",
      header: "Direction",
      sort: (t) => t.direction,
      cell: (t) => (
        <span className={cx("inline-flex items-center gap-1 text-xs", t.direction === "in" ? "text-pos" : "text-fg-2")}>
          {t.direction === "in" ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
          {t.direction === "in" ? "Received" : "Sent"}
        </span>
      ),
    },
    { key: "asset", header: "Asset", sort: (t) => t.asset, cell: (t) => <span className="font-medium">{t.asset}</span> },
    { key: "amount", header: "Amount", align: "right", sort: (t) => t.usd, cell: (t) => <span className="num">{fmtQty(t.amount)} <span className="text-fg-3">· {fmtUsd(t.usd, { decimals: 0 })}</span></span> },
    { key: "cp", header: "Counterparty", sort: (t) => t.counterparty, cell: (t) => <span className="text-fg-2">{t.counterparty}</span>, hideBelow: "md" },
    { key: "tx", header: "Transaction", cell: (t) => <button type="button" onClick={(e) => { e.stopPropagation(); copy(t.txHash, "Transaction hash"); }} className="num inline-flex items-center gap-1 text-fg-3 hover:text-accent-2">{shortHash(t.txHash, 5)} <Copy className="size-3" /></button>, hideBelow: "lg" },
    { key: "status", header: "Status", sort: (t) => t.status, cell: (t) => <Badge tone={t.status === "confirmed" ? "pos" : "accent"}>{t.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet Overview"
        description={
          real
            ? "The FOMO wallet read from public Solana RPC by its public address and priced on DexScreener. No FOMO session or token is used. Deposits and withdrawals happen only on the desk."
            : "Balances across trading, fee and treasury addresses. Funds movement is initiated from treasury tooling, not from this interface."
        }
      />
      {real && s.chain?.error && <Gap compact title="On-chain balance unavailable" detail={s.chain.error} />}
      <Panel className="grid grid-cols-1 lg:grid-cols-[minmax(320px,1fr)_2fr]">
        <div className="grid-paper border-b border-line p-6 lg:border-b-0 lg:border-r">
          <div className="label">Total balance</div>
          <div className="num mt-2 text-[34px] font-medium leading-10 tracking-[-0.025em]">{fmtUsd(total)}</div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Delta value={change} format={(v) => fmtUsd(v, { sign: true })} />
            <span className="text-fg-3">24h</span>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-4">
            <div>
              <div className="label">Stable</div>
              <div className="num mt-1 text-[15px]">{fmtUsd(stable, { decimals: 0 })}</div>
            </div>
            <div>
              <div className="label">At risk</div>
              <div className="num mt-1 text-[15px]">{fmtUsd(total - stable, { decimals: 0 })}</div>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="label mb-4">Allocation</div>
          <AllocationBar items={assets.map((a) => ({ label: a.symbol, value: a.balance * a.price }))} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader index="01" title="Assets" subtitle={`${assets.length} holdings`} />
          <DataTable rows={assets} columns={assetCols} rowKey={(a) => a.symbol} initialSort={{ key: "value", dir: "desc" }} />
        </Panel>
        <Panel>
          <PanelHeader index="02" title="Addresses" />
          <ul>
            {s.addresses.map((a) => (
              <li key={a.address} className="border-b border-line px-5 py-4 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    {a.role === "treasury" && <Lock className="size-3.5 text-fg-3" />}
                    {a.label}
                  </div>
                  <span className="num text-[13px]">{fmtUsd(a.balanceUsd, { decimals: 0 })}</span>
                </div>
                <button type="button" onClick={() => copy(a.address, "Address")} className="num mt-1.5 flex items-center gap-1.5 text-xs text-fg-3 hover:text-accent-2">
                  {shortHash(a.address, 8)} <Copy className="size-3" />
                </button>
                <div className="mt-2.5 h-1 rounded-full bg-fg-4/25">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(a.balanceUsd / total) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel>
        <PanelHeader index="03" title="Transfers" right={real ? undefined : <Segmented size="sm" label="Direction" value={dir} onChange={setDir} options={[{ value: "all", label: "All" }, { value: "in", label: "Received" }, { value: "out", label: "Sent" }]} />} />
        {real ? (
          <div className="p-5"><Gap title="Not tracked yet" detail="deskview reads current balances only. A transfer history would need the desk or deskview to index the wallet's transactions." /></div>
        ) : (
          <DataTable rows={transfers} columns={txCols} rowKey={(t) => t.id} initialSort={{ key: "at", dir: "desc" }} pageSize={12} />
        )}
      </Panel>
    </div>
  );
}
