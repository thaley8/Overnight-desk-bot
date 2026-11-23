"use client";

import { ArrowRight, BrainCircuit, CornerDownLeft, History, Layers, Radar, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "@/components/ui/primitives";
import { cx, fmtPrice, fmtUsd } from "@/lib/format";
import { ALL_NAV } from "@/lib/nav";
import { useDesk } from "@/lib/store";

interface Result {
  id: string;
  group: string;
  title: string;
  hint?: string;
  icon: ReactNode;
  href: string;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open || typeof document === "undefined") return null;
  // Mounted fresh on every open, so query and selection start clean.
  return createPortal(<PaletteBody onClose={onClose} />, document.body);
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const { snap } = useDesk();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    const rank = (label: string) => (label.toLowerCase().startsWith(term) ? 0 : label.toLowerCase().includes(term) ? 1 : 2);
    const pages: Result[] = ALL_NAV.filter((n) => !term || n.label.toLowerCase().includes(term) || n.description.toLowerCase().includes(term))
      .sort((a, b) => (term ? rank(a.label) - rank(b.label) : 0))
      .map((n) => {
      const Icon = n.icon;
      return { id: `p_${n.href}`, group: "Pages", title: n.label, hint: n.description, icon: <Icon className="size-4" strokeWidth={1.75} />, href: n.href };
    });
    if (!snap || !term) return pages;
    const agents: Result[] = snap.agents
      .filter((a) => a.name.toLowerCase().includes(term))
      .map((a) => ({ id: `a_${a.id}`, group: "Agents", title: a.name, hint: a.activity, icon: <BrainCircuit className="size-4" strokeWidth={1.75} />, href: `/agents/${a.id}` }));
    const positions: Result[] = snap.positions
      .filter((p) => p.symbol.toLowerCase().includes(term) || p.name.toLowerCase().includes(term))
      .map((p) => ({ id: `pos_${p.id}`, group: "Open positions", title: `${p.symbol} · ${p.name}`, hint: p.mark === null ? "No live mark" : `${fmtUsd(p.mark * p.qty, { decimals: 0 })} market value`, icon: <Layers className="size-4" strokeWidth={1.75} />, href: `/positions?focus=${p.id}` }));
    const seen = new Set<string>();
    const tokens: Result[] = snap.tokens
      .filter((t) => (t.symbol.toLowerCase().includes(term) || t.name.toLowerCase().includes(term) || t.address.toLowerCase() === term) && !seen.has(t.symbol) && seen.add(t.symbol))
      .slice(0, 6)
      .map((t) => ({ id: `t_${t.id}`, group: "Tokens", title: `${t.symbol} · ${t.name}`, hint: `${fmtPrice(t.price)} · score ${t.score} · ${t.verdict}`, icon: <Radar className="size-4" strokeWidth={1.75} />, href: `/scanner?token=${encodeURIComponent(t.id)}` }));
    const trades: Result[] = snap.trades
      .filter((t) => t.id.toLowerCase().includes(term) || t.symbol.toLowerCase() === term || (t.txHash ?? "").toLowerCase().startsWith(term))
      .slice(0, 5)
      .map((t) => ({ id: `tr_${t.id}`, group: "Trades", title: `${t.side === "buy" ? "Buy" : "Sell"} ${t.symbol} · ${t.id}`, hint: `${fmtUsd(t.notional)} · ${t.status}`, icon: <History className="size-4" strokeWidth={1.75} />, href: `/trades?q=${encodeURIComponent(t.id)}` }));
    return [...pages, ...agents, ...positions, ...tokens, ...trades];
  }, [q, snap]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const go = (r: Result) => {
    onClose();
    router.push(r.href);
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 animate-fade-in bg-[#03070f]/70" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Search" className="relative w-full max-w-[600px] animate-fade-in overflow-hidden rounded-xl border border-line-2 bg-bg-2 shadow-pop">
        <div className="flex items-center gap-3 px-4 hairline-b">
          <Search className="size-4 text-fg-3" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter" && results[sel]) {
                go(results[sel]);
              } else if (e.key === "Escape") onClose();
            }}
            placeholder="Search pages, tokens, positions, trades, tx hashes…"
            aria-label="Search"
            className="h-13 flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-4 focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && <div className="px-3 py-10 text-center text-xs text-fg-3">No matches for “{q}”.</div>}
          {results.map((r, i) => {
            const header = i === 0 || results[i - 1].group !== r.group;
            return (
              <div key={r.id}>
                {header && <div className="label px-3 pb-1.5 pt-3 first:pt-1">{r.group}</div>}
                <button
                  type="button"
                  data-idx={i}
                  onMouseMove={() => setSel(i)}
                  onClick={() => go(r)}
                  className={cx("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors", i === sel ? "bg-elevated" : "")}
                >
                  <span className={cx("text-fg-3", i === sel && "text-accent-2")}>{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{r.title}</span>
                    {r.hint && <span className="block truncate text-xs text-fg-3">{r.hint}</span>}
                  </span>
                  {i === sel ? <CornerDownLeft className="size-3.5 text-fg-3" /> : <ArrowRight className="size-3.5 text-fg-4 opacity-0" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-2xs text-fg-3">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
          <span className="ml-auto">{results.length} results</span>
        </div>
      </div>
    </div>
  );
}
