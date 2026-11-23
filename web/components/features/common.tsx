"use client";

import { ArrowLeftRight, BrainCircuit, ChevronRight, Pause, Play, PlugZap, Radar, ScanSearch, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Sparkline } from "@/components/charts/Small";
import { Badge, Segmented, StatusDot, type Tone } from "@/components/ui/primitives";
import { cx, fmtAgo, fmtCompact, fmtMs, fmtPct, fmtTime } from "@/lib/format";
import { useDesk, useNow } from "@/lib/store";
import type { ActivityEvent, ActivityKind, Agent, AgentId, AgentStatus, DeskSnapshot, Verdict } from "@/lib/types";

export function useSnap(): DeskSnapshot {
  const { snap } = useDesk();
  // AppShell renders pages only once a snapshot exists.
  return snap as DeskSnapshot;
}

export const AGENT_ICON: Record<AgentId, LucideIcon> = {
  scanner: Radar,
  analyst: ScanSearch,
  brain: BrainCircuit,
  executor: ArrowLeftRight,
  risk: ShieldCheck,
};

export const STATUS_META: Record<AgentStatus, { tone: Tone; label: string }> = {
  running: { tone: "pos", label: "Running" },
  idle: { tone: "neutral", label: "Idle" },
  degraded: { tone: "warn", label: "Degraded" },
  error: { tone: "neg", label: "Error" },
  paused: { tone: "neutral", label: "Paused" },
  stopped: { tone: "neutral", label: "Stopped" },
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

export const KIND_META: Record<ActivityKind, { label: string; icon: LucideIcon; color: string }> = {
  discovery: { label: "Discoveries", icon: Radar, color: "text-cyan" },
  evaluation: { label: "Evaluations", icon: ScanSearch, color: "text-accent-2" },
  decision: { label: "Decisions", icon: BrainCircuit, color: "text-accent-2" },
  execution: { label: "Executions", icon: ArrowLeftRight, color: "text-pos" },
  risk: { label: "Risk", icon: ShieldAlert, color: "text-warn" },
  api_error: { label: "API errors", icon: PlugZap, color: "text-neg" },
};

export function VerdictBadge({ v }: { v: Verdict }) {
  const { snap } = useDesk();
  // The real desk calls a scanner reject a "kill"; the demo keeps the generic wording.
  const real = snap?.meta.source === "deskview";
  const m: Record<Verdict, [Tone, string]> = {
    pending: ["neutral", "Pending"], buy: ["pos", "Buy"], watch: ["accent", "Watch"], reject: ["neg", real ? "Killed" : "Reject"],
    pass: ["accent", "Passed"], bought: ["pos", "Bought"], skipped: ["neutral", "Skipped"], waiting: ["cyan", "Waiting"],
  };
  return <Badge tone={m[v][0]}>{m[v][1]}</Badge>;
}

/* ─────────────── Activity feed ─────────────── */

function eventHref(e: ActivityEvent) {
  if (!e.ref) return undefined;
  if (e.ref.type === "token") return `/scanner?token=${encodeURIComponent(e.ref.id)}`;
  if (e.ref.type === "trade") return `/trades?q=${encodeURIComponent(e.ref.id)}`;
  if (e.ref.type === "position") return "/positions";
  if (e.ref.type === "api") return "/api-monitor";
  return undefined;
}

export function ActivityFeed({ events, maxHeight = 520, showFilters = true, initialKind = "all" }: { events: ActivityEvent[]; maxHeight?: number; showFilters?: boolean; initialKind?: ActivityKind | "all" }) {
  const now = useNow(5000);
  const [kind, setKind] = useState<ActivityKind | "all">(initialKind);
  const [frozen, setFrozen] = useState<ActivityEvent[] | null>(null);
  const shown = frozen ?? events;
  const filtered = useMemo(() => shown.filter((e) => kind === "all" || e.kind === kind).slice(0, 80), [shown, kind]);
  // Events newer than first render get a brief highlight when they arrive.
  const [mountedAt] = useState(() => Date.now());
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of shown) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [shown]);

  return (
    <div>
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 hairline-b">
          <div className="flex flex-wrap gap-1">
            {(["all", ...Object.keys(KIND_META)] as (ActivityKind | "all")[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cx("flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors", kind === k ? "border-accent/50 bg-accent/12 text-fg" : "border-line text-fg-3 hover:border-line-2 hover:text-fg-2")}
              >
                {k === "all" ? "All" : KIND_META[k].label}
                <span className="num text-2xs text-fg-4">{k === "all" ? shown.length : counts[k] ?? 0}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setFrozen(frozen ? null : events)} className="ml-auto flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-fg-3 hover:bg-elevated hover:text-fg-2">
            {frozen ? <Play className="size-3" /> : <Pause className="size-3" />}
            {frozen ? `Resume${events.length - frozen.length > 0 ? ` · ${events.length - frozen.length} new` : ""}` : "Pause feed"}
          </button>
        </div>
      )}
      <ol className="overflow-y-auto" style={{ maxHeight }} aria-live="polite" aria-relevant="additions">
        {filtered.length === 0 && <li className="px-5 py-12 text-center text-xs text-fg-3">No events of this type yet.</li>}
        {filtered.map((e) => {
          const m = KIND_META[e.kind];
          const Icon = m.icon;
          const href = eventHref(e);
          const body = (
            <>
              <span className="num w-[58px] shrink-0 pt-px text-2xs text-fg-4">{fmtTime(e.at)}</span>
              <span className={cx("mt-px flex size-5 shrink-0 items-center justify-center rounded border border-line bg-bg-2", m.color)}>
                <Icon className="size-3" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cx("truncate text-[12.5px]", e.severity === "critical" ? "text-neg" : "text-fg")}>{e.title}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-fg-3">{e.detail}</span>
              </span>
              <span className="hidden shrink-0 text-right sm:block">
                <span className="block text-2xs capitalize text-fg-3">{e.agent}</span>
                <span className="num block text-2xs text-fg-4">{now ? fmtAgo(e.at, now) : ""}</span>
              </span>
            </>
          );
          return (
            <li key={e.id} className={cx("border-b border-line last:border-b-0", e.at > mountedAt && "animate-flash")}>
              {href ? (
                <Link href={href} className="flex items-start gap-3 px-5 py-2.5 transition-colors hover:bg-elevated/45">
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3 px-5 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ─────────────── Agent pipeline ─────────────── */

function AgentColumn({ a, now, last }: { a: Agent; now: number; last?: boolean }) {
  const Icon = AGENT_ICON[a.id];
  const m = STATUS_META[a.status];
  const isRisk = a.id === "risk";
  return (
    <Link
      href={`/agents/${a.id}`}
      className={cx("group relative flex min-w-0 flex-col gap-4 p-5 transition-colors hover:bg-elevated/40", isRisk && "bg-bg-2/40")}
    >
      {!last && !isRisk && (
        <span className="absolute -right-2.5 top-[30px] z-[1] hidden size-5 items-center justify-center rounded-full border border-line-2 bg-panel text-fg-3 lg:flex" aria-hidden>
          <ChevronRight className="size-3" />
        </span>
      )}
      <div className="flex items-center gap-2.5">
        <span className={cx("flex size-8 items-center justify-center rounded-md border", a.status === "degraded" ? "border-warn/30 bg-warn/8 text-warn" : a.status === "paused" ? "border-line bg-bg-2 text-fg-3" : "border-accent/25 bg-accent/10 text-accent-2")}>
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
            {a.name}
            {isRisk && <span className="label text-[9.5px] text-fg-4">supervisor</span>}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-fg-3">
            <StatusDot tone={m.tone} pulse={a.status === "running"} />
            {m.label}
          </div>
        </div>
      </div>
      <div className="min-h-[34px] text-xs leading-[17px] text-fg-2">
        <span className={cx(a.status === "running" ? "text-cyan" : "text-fg-3")}>●</span> {a.activity}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="label">Ops today</div>
          <div className="num mt-1 text-[18px] font-medium leading-6 text-fg">{a.opsToday.toLocaleString("en-US")}</div>
        </div>
        <Sparkline data={a.throughput.slice(-48)} width={84} height={26} color={a.status === "degraded" ? "#E3AA4A" : "#35D5E8"} />
      </div>
      <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
        <div>
          <dt className="text-2xs text-fg-4">Errors 24h</dt>
          <dd className={cx("num mt-0.5", a.errors24h ? "text-warn" : "text-fg-2")}>{a.errors24h}</dd>
        </div>
        <div>
          <dt className="text-2xs text-fg-4">p50</dt>
          <dd className="num mt-0.5 text-fg-2">{fmtMs(a.latencyP50)}</dd>
        </div>
        <div>
          <dt className="text-2xs text-fg-4">Success</dt>
          <dd className="num mt-0.5 text-fg-2">{fmtPct(a.successRate, { decimals: 1 })}</dd>
        </div>
      </dl>
      <div className="truncate text-2xs text-fg-4" title={a.lastTask.label}>
        Last: <span className="text-fg-3">{a.lastTask.label}</span> · <span className="num">{now ? fmtAgo(a.lastTask.at, now) : ""}</span>
      </div>
    </Link>
  );
}

export function AgentPipeline({ agents }: { agents: Agent[] }) {
  const now = useNow(5000);
  return (
    <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x [&>*]:border-line max-lg:[&>*]:border-b sm:max-lg:[&>*:nth-child(odd)]:border-r">
      {agents.map((a, i) => (
        <AgentColumn key={a.id} a={a} now={now} last={i === agents.length - 2} />
      ))}
    </div>
  );
}

export function RangeControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Segmented label="Date range" value={value} onChange={onChange} options={["7D", "30D", "90D", "180D"]} />;
}

export { fmtCompact };
