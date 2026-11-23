"use client";

import { AlertTriangle, Copy } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { C } from "@/components/charts/core";
import { LineChart } from "@/components/charts/LineChart";
import { Sparkline } from "@/components/charts/Small";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Overlay";
import { Badge, Button, Delta, Gap, KeyValue, Meter, PageHeader, Panel, SearchInput, Segmented, Select, TokenMark } from "@/components/ui/primitives";
import { cx, fmtAgo, fmtCompact, fmtCompactUsd, fmtDuration, fmtHM, fmtNum, fmtPct, fmtPrice, fmtTime, shortHash } from "@/lib/format";
import type { CoinDetail } from "@/lib/data/source";
import { useDesk, useNow } from "@/lib/store";
import type { Token, Verdict } from "@/lib/types";
import { KIND_META, useSnap, VerdictBadge } from "./common";
import { useCopy } from "./useCopy";

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="num text-fg-4">—</span>;
  const tone = score >= 75 ? "bg-pos" : score >= 50 ? "bg-accent" : "bg-neg/80";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1 w-12 overflow-hidden rounded-full bg-fg-4/25">
        <div className={cx("h-full rounded-full", tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="num w-6 text-right text-fg">{score}</span>
    </div>
  );
}

function Funnel({ tokens }: { tokens: Token[] }) {
  const s = useSnap();
  const count = (id: string, key: string) => Number(s.agents.find((a) => a.id === id)?.metrics.find((m) => m.label === key)?.value ?? 0);
  const steps =
    s.meta.source !== "demo"
      ? [
          { label: "Tokens in tonight", v: count("scanner", "In tonight") },
          { label: "Scanner pass", v: count("scanner", "Passed") },
          { label: "Analyst pass", v: count("analyst", "Passed") },
          { label: "Sized by Brain", v: count("brain", "Passed") },
          { label: "Bought", v: count("executor", "Passed") },
        ]
      : [
          { label: "Pairs scanned today", v: s.agents.find((a) => a.id === "scanner")?.opsToday ?? 0 },
          { label: "Passed filters", v: tokens.length },
          { label: "Evaluated", v: tokens.filter((t) => t.verdict !== "pending").length },
          { label: "Buy verdicts", v: tokens.filter((t) => t.verdict === "buy").length },
          { label: "Positions held", v: s.positions.length },
        ];
  return (
    <Panel className="grid grid-cols-2 sm:grid-cols-5">
      {steps.map((st, i) => (
        <div key={st.label} className={cx("relative border-line p-5", i > 0 && "sm:border-l", i % 2 === 1 && "max-sm:border-l", i >= 2 && "max-sm:border-t")}>
          <div className="label">{st.label}</div>
          <div className="num mt-2 text-[22px] font-medium leading-7 text-fg">{fmtNum(st.v)}</div>
          <div className="num mt-1 text-xs text-fg-3">{i === 0 ? (s.meta.source !== "demo" ? "bus events since 22:00" : "discovery input") : steps[i - 1].v ? `${fmtPct(st.v / steps[i - 1].v, { decimals: i === 1 ? 2 : 0 })} of previous` : "—"}</div>
          <div className="absolute inset-x-5 bottom-0 h-[2px] rounded-full bg-accent" style={{ opacity: 1 - i * 0.17, width: `calc((100% - 40px) * ${i === 0 ? 1 : Math.max(0.06, Math.log10(st.v + 1) / Math.log10(Math.max(2, steps[0].v + 1)))})` }} />
        </div>
      ))}
    </Panel>
  );
}

function TokenDrawer({ token, onClose }: { token: Token | null; onClose: () => void }) {
  const s = useSnap();
  const now = useNow(5000);
  const copy = useCopy();
  const { source } = useDesk();
  const [detail, setDetail] = useState<{ mint: string; d: CoinDetail | null } | null>(null);
  const mint = token?.id;
  useEffect(() => {
    if (!mint || !source.fetchCoin) return;
    let live = true;
    source.fetchCoin(mint).then((d) => live && setDetail({ mint, d }));
    return () => {
      live = false;
    };
  }, [mint, source]);
  if (!token) return null;
  const coin = detail?.mint === token.id ? detail.d : null;
  const real = s.meta.source !== "demo";
  const holderPts = (coin?.holders ?? []).map((h) => ({ t: h.at, v: h.holders }));
  const pts = token.spark.map((v, i) => ({ t: (now || s.generatedAt) - (token.spark.length - 1 - i) * 5 * 60_000, v }));
  const trailReal = (coin?.events ?? []).slice(-10).reverse();
  const trail = s.activity.filter((e) => e.ref?.type === "token" && (e.ref.id === token.id || e.title.includes(token.symbol))).slice(0, 8);
  const position = s.positions.find((p) => p.tokenId === token.id);
  return (
    <Drawer
      open
      onClose={onClose}
      width={620}
      title={
        <span className="flex items-center gap-3">
          <TokenMark symbol={token.symbol} size={30} />
          <span>
            <span className="block">{token.symbol} <span className="font-normal text-fg-3">· {token.name}</span></span>
            <span className="mt-0.5 flex items-center gap-2 text-xs font-normal text-fg-3">
              {token.chain} · discovered {now ? fmtAgo(token.discoveredAt, now) : ""} <VerdictBadge v={token.verdict} />
            </span>
          </span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => copy(token.address, real ? "Mint" : "Contract address")}>
            <Copy className="size-3.5" /> {real ? "Copy mint" : "Copy address"}
          </Button>
          {token.fomoUrl && (
            <a href={token.fomoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium text-accent-2 hover:bg-elevated">
              Open on FOMO ↗
            </a>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="label">{real ? "Price at evaluation" : "Price"}</div>
            <div className="num mt-1 text-[26px] font-medium leading-8">{fmtPrice(token.price)}</div>
          </div>
          {token.killRule && (
            <div>
              <div className="label">Kill rule</div>
              <div className="mt-1"><Badge tone="neg">{token.killRule}</Badge></div>
            </div>
          )}
          {!real && (["change5m", "change1h", "change24h"] as const).map((k) => (
            <div key={k}>
              <div className="label">{k.replace("change", "")}</div>
              <Delta value={token[k]} format={(v) => fmtPct(v, { sign: true })} className="mt-1 text-[14px]" />
            </div>
          ))}
        </div>
        <div className="-mx-1">
          {real ? (
            holderPts.length >= 2 ? (
              <>
                <div className="label mb-1 px-1">Holder count</div>
                <LineChart data={holderPts} label="Holders" height={180} color={C.cyan} format={(v) => fmtNum(v)} xFormat={fmtHM} tooltipTitle={(t) => fmtTime(t) + " CT"} />
              </>
            ) : (
              <Gap title={coin ? "Not enough holder samples" : "Loading coin detail…"} detail="Holder counts come from desk.db holder_samples." />
            )
          ) : (
            <LineChart data={pts} label="Price" height={200} color={(token.change24h ?? 0) >= 0 ? C.pos : C.neg} format={fmtPrice} xFormat={fmtHM} tooltipTitle={(t) => fmtTime(t) + " CT"} />
          )}
        </div>
        <KeyValue
          items={[
            { k: "Liquidity", v: fmtCompactUsd(token.liquidity) },
            ...(real ? [] : [{ k: "24h volume", v: fmtCompactUsd(token.volume24h) }]),
            { k: real ? "Cap (size limit)" : "Market cap", v: fmtCompactUsd(token.marketCap) },
            { k: "Holders", v: fmtNum(token.holders) },
            { k: "Score", v: token.score === null ? "—" : `${token.score}` },
            { k: "Analyst confidence", v: token.confidence === null ? "—" : token.confidence.toFixed(2) },
            { k: "Age", v: now ? fmtDuration(now - token.discoveredAt) : "—" },
            { k: real ? "Mint" : "Contract", v: <button type="button" onClick={() => copy(token.address, "Contract address")} className="hover:text-accent-2">{shortHash(token.address, 6)}</button> },
          ]}
        />
        {token.topHolderPct !== null && (
        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="label">Top-10 holder concentration</span>
            <span className="num text-fg">{fmtPct(token.topHolderPct, { decimals: 1 })}</span>
          </div>
          <Meter value={token.topHolderPct} max={1} tone={token.topHolderPct > 0.4 ? "neg" : token.topHolderPct > 0.25 ? "warn" : "pos"} height={6} marks={[0.25, 0.4]} />
          <div className="mt-1.5 flex justify-between text-2xs text-fg-4">
            <span>Dispersed</span>
            <span>Threshold 40%</span>
          </div>
        </div>
        )}
        <div>
          <div className="label mb-2">{real ? "Analyst case" : "Analyst assessment"}</div>
          <p className="whitespace-pre-line rounded-md border border-line bg-panel px-4 py-3 text-[12.5px] leading-5 text-fg-2">{token.notes ?? (real ? "No bull/bear case recorded." : "Awaiting evaluation. The Analyst processes candidates in score order.")}</p>
          {coin?.noteMd && (
            <details className="mt-3 rounded-md border border-line bg-panel">
              <summary className="cursor-pointer px-4 py-2.5 text-xs text-fg-2 hover:text-fg">Vault note · {token.notesPath}</summary>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 pb-4 font-sans text-[12.5px] leading-5 text-fg-2">{coin.noteMd}</pre>
            </details>
          )}
          {token.flags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {token.flags.map((f) => (
                <li key={f}>
                  <Badge tone="warn">
                    <AlertTriangle className="size-3" /> {f}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {position && <div className="mt-3 text-xs text-fg-3">Held as position <span className="num text-fg">{position.id}</span>. Manage it on Open Positions.</div>}
        </div>
        <div>
          <div className="label mb-2">Decision trail</div>
          {real && trailReal.length > 0 ? (
            <ol className="relative ml-2 border-l border-line-2">
              {trailReal.map((e) => (
                <li key={e.id} className="relative pb-4 pl-5 last:pb-0">
                  <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-line-2 bg-accent/60" />
                  <div className="num text-[12.5px] text-fg">{e.topic}</div>
                  <div className="num text-2xs text-fg-4">{Number.isNaN(e.at) ? "—" : `${fmtTime(e.at)} CT`} · event #{e.id}</div>
                </li>
              ))}
            </ol>
          ) : trail.length === 0 ? (
            <div className="text-xs text-fg-3">No agent activity recorded for this token yet.</div>
          ) : (
            <ol className="relative ml-2 border-l border-line-2">
              {trail.map((e) => {
                const Icon = KIND_META[e.kind].icon;
                return (
                  <li key={e.id} className="relative pb-4 pl-5 last:pb-0">
                    <span className={cx("absolute -left-[9px] top-0 flex size-[18px] items-center justify-center rounded-full border border-line-2 bg-bg-2", KIND_META[e.kind].color)}>
                      <Icon className="size-2.5" />
                    </span>
                    <div className="text-[12.5px] text-fg">{e.title}</div>
                    <div className="num text-2xs text-fg-4">{fmtTime(e.at)} CT · {e.agent}</div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </Drawer>
  );
}

const AGE_OPTS = [
  { value: "all", label: "Any" },
  { value: "1", label: "< 1h" },
  { value: "6", label: "< 6h" },
  { value: "24", label: "< 24h" },
];

export function Scanner() {
  const s = useSnap();
  const now = useNow(10_000);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [verdict, setVerdict] = useState<Verdict | "all">("all");
  const [chain, setChain] = useState("all");
  const [minScore, setMinScore] = useState("0");
  const [age, setAge] = useState("all");
  const [hideFlagged, setHideFlagged] = useState(false);

  const selectedId = params.get("token");
  const selected = s.tokens.find((t) => t.id === selectedId) ?? null;
  const open = (t: Token) => router.replace(`${pathname}?token=${encodeURIComponent(t.id)}`, { scroll: false });
  const close = () => router.replace(pathname, { scroll: false });

  const chains = useMemo(() => [...new Set(s.tokens.map((t) => t.chain))], [s.tokens]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return s.tokens.filter(
      (t) =>
        (verdict === "all" || t.verdict === verdict) &&
        (chain === "all" || t.chain === chain) &&
        (+minScore === 0 || (t.score ?? -1) >= +minScore) &&
        (age === "all" || (now || s.generatedAt) - t.discoveredAt < +age * 3_600_000) &&
        (!hideFlagged || t.flags.length === 0) &&
        (!term || t.symbol.toLowerCase().includes(term) || t.name.toLowerCase().includes(term) || t.address.toLowerCase().includes(term)),
    );
  }, [s.tokens, q, verdict, chain, minScore, age, hideFlagged, now, s.generatedAt]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: s.tokens.length };
    for (const t of s.tokens) c[t.verdict] = (c[t.verdict] ?? 0) + 1;
    return c;
  }, [s.tokens]);

  const real = s.meta.source !== "demo";
  const allCols: Column<Token>[] = [
    {
      key: "token",
      header: "Token",
      sort: (t) => t.symbol,
      cell: (t) => (
        <div className="flex items-center gap-2.5">
          <TokenMark symbol={t.symbol} />
          <div className="min-w-0">
            <div className="font-medium text-fg">{t.symbol}</div>
            <div className="truncate text-2xs text-fg-3">{[t.name, t.chain].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      ),
    },
    { key: "age", header: "Age", align: "right", sort: (t) => -t.discoveredAt, cell: (t) => <span className="num text-fg-2">{now ? fmtDuration(now - t.discoveredAt) : "—"}</span>, hideBelow: "md" },
    { key: "price", header: "Price", align: "right", sort: (t) => t.price, cell: (t) => <span className="num">{fmtPrice(t.price)}</span> },
    { key: "c5", header: "5m", align: "right", sort: (t) => t.change5m, cell: (t) => <Delta value={t.change5m} icon={false} format={(v) => fmtPct(v, { sign: true, decimals: 1 })} />, hideBelow: "xl" },
    { key: "c1", header: "1h", align: "right", sort: (t) => t.change1h, cell: (t) => <Delta value={t.change1h} icon={false} format={(v) => fmtPct(v, { sign: true, decimals: 1 })} />, hideBelow: "md" },
    { key: "c24", header: "24h", align: "right", sort: (t) => t.change24h, cell: (t) => <Delta value={t.change24h} icon={false} format={(v) => fmtPct(v, { sign: true, decimals: 1 })} /> },
    { key: "liq", header: "Liquidity", align: "right", sort: (t) => t.liquidity, cell: (t) => <span className="num">{fmtCompactUsd(t.liquidity)}</span>, hideBelow: "sm" },
    { key: "vol", header: "Volume 24h", align: "right", sort: (t) => t.volume24h, cell: (t) => <span className="num text-fg-2">{fmtCompactUsd(t.volume24h)}</span>, hideBelow: "2xl" },
    { key: "holders", header: "Holders", align: "right", sort: (t) => t.holders, cell: (t) => <span className="num text-fg-2">{fmtCompact(t.holders)}</span>, hideBelow: "2xl" },
    { key: "trend", header: "Trend", align: "right", cell: (t) => <Sparkline data={t.spark} width={72} height={22} className="ml-auto" />, hideBelow: "xl" },
    { key: "top10", header: "Top 10", align: "right", sort: (t) => t.topHolderPct, cell: (t) => <span className={cx("num", (t.topHolderPct ?? 0) > 0.4 ? "text-neg" : "text-fg-2")}>{fmtPct(t.topHolderPct, { decimals: 0 })}</span>, hideBelow: "md" },
    { key: "holders2", header: "Holders", align: "right", sort: (t) => t.holders, cell: (t) => <span className="num text-fg-2">{fmtCompact(t.holders)}</span>, hideBelow: "lg" },
    { key: "score", header: "Score", align: "right", sort: (t) => t.score, cell: (t) => <ScoreBar score={t.score} /> },
    {
      key: "verdict",
      header: "Verdict",
      sort: (t) => t.verdict,
      cell: (t) => (
        <div className="flex items-center gap-1.5">
          <VerdictBadge v={t.verdict} />
          {t.flags.length > 0 && (
            <span title={t.flags.join(", ")} className="num flex items-center gap-0.5 text-2xs text-warn">
              <AlertTriangle className="size-3" />
              {t.flags.length}
            </span>
          )}
        </div>
      ),
    },
  ];
  const REAL_HIDE = new Set(["c5", "c1", "c24", "vol", "holders", "trend"]);
  const cols = real ? allCols.filter((c) => !REAL_HIDE.has(c.key)) : allCols.filter((c) => c.key !== "top10" && c.key !== "holders2");
  const verdictOpts = (real ? (["all", "waiting", "pass", "bought", "skipped", "reject"] as const) : (["all", "pending", "buy", "watch", "reject"] as const)) as readonly (Verdict | "all")[];
  const verdictLabel = (v: string) => (real && v === "reject" ? "killed" : v);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Token Scanner"
        description={
          real
            ? "Every coin the desk evaluated (desk.db coins) plus the Scanner's waiting room. Click a row for holder history, the bus events for that mint and its vault note."
            : "Every pair the Scanner surfaced, with the Analyst's verdict. Click a row for the full assessment and decision trail."
        }
      />
      <Funnel tokens={s.tokens} />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 hairline-b">
          <SearchInput value={q} onChange={setQ} placeholder="Symbol, name or address" className="w-full sm:w-64" />
          <Segmented
            label="Verdict"
            value={verdict}
            onChange={setVerdict}
            options={verdictOpts.map((v) => ({ value: v, label: <span className="capitalize">{verdictLabel(v)} <span className="text-fg-4">{counts[v] ?? 0}</span></span> }))}
          />
          {chains.length > 1 && <Select label="Chain" value={chain} onChange={setChain} options={[{ value: "all", label: "All" }, ...chains.map((c) => ({ value: c, label: c }))]} />}
          <Select label="Score ≥" value={minScore} onChange={setMinScore} options={["0", "50", "70", "85"].map((v) => ({ value: v, label: v }))} />
          <Select label="Age" value={age} onChange={setAge} options={AGE_OPTS} />
          <label className="flex h-8 cursor-pointer items-center gap-2 px-1 text-xs text-fg-2">
            <input type="checkbox" checked={hideFlagged} onChange={(e) => setHideFlagged(e.target.checked)} className="accent-[#398BFF]" />
            Hide flagged
          </label>
          <span className="num ml-auto text-xs text-fg-3">{rows.length} of {s.tokens.length}</span>
        </div>
        <DataTable rows={rows} columns={cols} rowKey={(t) => t.id} onRowClick={open} initialSort={{ key: "age", dir: "asc" }} pageSize={25} rowClassName={(t) => (t.id === selectedId ? "bg-elevated/60" : undefined)} />
      </Panel>
      <TokenDrawer token={selected} onClose={close} />
    </div>
  );
}
