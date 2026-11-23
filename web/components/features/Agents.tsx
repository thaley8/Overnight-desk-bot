"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BarChart } from "@/components/charts/BarChart";
import { C, TooltipRow } from "@/components/charts/core";
import { LineChart } from "@/components/charts/LineChart";
import { Sparkline } from "@/components/charts/Small";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Overlay";
import { Button, Empty, Gap, KeyValue, PageHeader, Panel, PanelHeader, Segmented, Toggle } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { cx, fmtAgo, fmtCompact, fmtHM, fmtMs, fmtNum, fmtPct, fmtTime } from "@/lib/format";
import { useDesk, useNow } from "@/lib/store";
import type { Agent, AgentId, AgentTask } from "@/lib/types";
import { ActivityFeed, AGENT_ICON, AgentPipeline, AgentStatusBadge, useSnap } from "./common";

export function useAgentToggle() {
  const { actions } = useDesk();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Agent | null>(null);
  const apply = async (a: Agent, enabled: boolean) => {
    const r = await actions.setAgentEnabled(a.id, enabled);
    toast({ tone: r.ok ? "success" : "warning", title: r.message });
  };
  const request = (a: Agent, enabled: boolean) => {
    if (!enabled) setConfirm(a);
    else apply(a, true);
  };
  const dialog = (
    <Dialog
      open={!!confirm}
      onClose={() => setConfirm(null)}
      title={`Disable ${confirm?.name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm) apply(confirm, false);
              setConfirm(null);
            }}
          >
            Disable agent
          </Button>
        </>
      }
    >
      {confirm?.id === "executor"
        ? "The Executor will stop routing orders, including protective exits. Open positions will only close manually."
        : confirm?.id === "brain"
          ? "No new trade decisions will be made. Existing positions remain protected by Risk."
          : "The pipeline downstream of this agent will receive no new work until it is re-enabled."}
    </Dialog>
  );
  return { request, dialog };
}

export function AgentsOverview() {
  const s = useSnap();
  const router = useRouter();
  const { request, dialog } = useAgentToggle();
  const { readOnly } = useDesk();
  const cols: Column<Agent>[] = [
    {
      key: "agent",
      header: "Agent",
      sort: (a) => a.name,
      cell: (a) => {
        const Icon = AGENT_ICON[a.id];
        return (
          <div className="flex items-center gap-2.5">
            <Icon className="size-4 text-fg-3" strokeWidth={1.75} />
            <div>
              <div className="font-medium">{a.name}</div>
              <div className="max-w-[260px] truncate text-2xs text-fg-3">{a.role}</div>
            </div>
          </div>
        );
      },
    },
    { key: "status", header: "Status", sort: (a) => a.status, cell: (a) => <AgentStatusBadge status={a.status} /> },
    { key: "ops", header: "Ops today", align: "right", sort: (a) => a.opsToday, cell: (a) => <span className="num">{fmtNum(a.opsToday)}</span> },
    { key: "total", header: "Ops total", align: "right", sort: (a) => a.opsTotal, cell: (a) => <span className="num text-fg-2">{fmtCompact(a.opsTotal)}</span>, hideBelow: "lg" },
    { key: "tp", header: "24h throughput", align: "right", cell: (a) => <Sparkline data={a.throughput.filter((_, i) => i % 6 === 0)} width={110} height={22} color={C.cyan} className="ml-auto" />, hideBelow: "md" },
    { key: "err", header: "Errors 24h", align: "right", sort: (a) => a.errors24h, cell: (a) => <span className={cx("num", a.errors24h ? "text-warn" : "text-fg-3")}>{a.errors24h}</span> },
    { key: "p50", header: "p50 / p95", align: "right", sort: (a) => a.latencyP50, cell: (a) => <span className="num text-fg-2">{fmtMs(a.latencyP50)} <span className="text-fg-4">/ {fmtMs(a.latencyP95)}</span></span>, hideBelow: "sm" },
    { key: "succ", header: "Success", align: "right", sort: (a) => a.successRate, cell: (a) => <span className="num">{fmtPct(a.successRate, { decimals: 2 })}</span>, hideBelow: "lg" },
    { key: "up", header: "Uptime", align: "right", sort: (a) => a.uptimePct, cell: (a) => <span className="num text-fg-2">{fmtPct(a.uptimePct, { decimals: 2 })}</span>, hideBelow: "xl" },
    {
      key: "enabled",
      header: "Enabled",
      align: "center",
      cell: (a) => (
        <span onClick={(e) => e.stopPropagation()} className="inline-flex" title={a.id === "risk" ? "Risk supervision cannot be disabled from the interface" : undefined}>
          <Toggle size="sm" checked={s.settings.agentsEnabled[a.id]} disabled={a.id === "risk" || readOnly} label={`Enable ${a.name}`} onChange={(v) => request(a, v)} />
        </span>
      ),
    },
  ];
  const totalOps = s.agents.reduce((a, b) => a + b.opsToday, 0);
  const totalErr = s.agents.reduce((a, b) => a + b.errors24h, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Agents"
        description="Five agents form the trading pipeline. Work flows left to right; Risk supervises every stage and can block any order."
        right={
          <div className="flex gap-8 text-right">
            <div>
              <div className="label">Ops today</div>
              <div className="num mt-1 text-[17px]">{fmtNum(totalOps)}</div>
            </div>
            <div>
              <div className="label">Errors 24h</div>
              <div className={cx("num mt-1 text-[17px]", totalErr > 0 && "text-warn")}>{totalErr}</div>
            </div>
          </div>
        }
      />
      <Panel>
        <PanelHeader index="01" title="Pipeline" subtitle="Click an agent for detail" />
        <AgentPipeline agents={s.agents} />
      </Panel>
      <Panel>
        <PanelHeader index="02" title="Roster" subtitle={readOnly ? "Sortable · pause/resume bots over Telegram" : "Sortable · toggle to pause an agent"} />
        <DataTable rows={s.agents} columns={cols} rowKey={(a) => a.id} onRowClick={(a) => router.push(`/agents/${a.id}`)} />
      </Panel>
      {dialog}
    </div>
  );
}

export function AgentDetail({ id }: { id: AgentId }) {
  const s = useSnap();
  const now = useNow(5000);
  const found = s.agents.find((x) => x.id === id);
  const { request, dialog } = useAgentToggle();
  const { readOnly } = useDesk();
  const [window_, setWindow] = useState<"6H" | "24H">("24H");
  const real = s.meta.source !== "demo";
  // Demo throughput is 288 × 5-minute buckets; deskview's is 48 × 30-minute buckets built from bus events.
  const stepMin = real ? 30 : 5;
  const pts = (window_ === "6H" ? 360 : 1440) / stepMin;
  const base = now || s.generatedAt;
  const throughput = found?.throughput;
  // Cheap (≤ 288 numbers); no memo needed.
  const src = (throughput ?? []).slice(-pts);
  const bucket = (window_ === "6H" ? 30 : 60) / stepMin;
  const hourly: number[] = [];
  for (let i = 0; i < src.length; i += bucket) hourly.push(src.slice(i, i + bucket).reduce((x, y) => x + y, 0));
  if (!found) {
    return <Empty title="Agent not reported" detail="deskview has not reported this agent yet. Check System Health for the connection state." />;
  }
  const a = found;
  const Icon = AGENT_ICON[a.id];
  const bucketMs = (window_ === "6H" ? 30 : 60) * 60_000;
  const latency = a.latency.slice(-pts).map((v, i, arr) => ({ t: base - (arr.length - 1 - i) * 5 * 60_000, v }));
  const failed = a.tasks.filter((t) => !t.ok).length;

  const taskCols: Column<AgentTask>[] = [
    { key: "at", header: "Time", sort: (t) => t.at, cell: (t) => <span className="num text-fg-2">{fmtTime(t.at)}</span> },
    { key: "label", header: "Task", cell: (t) => <span className="text-fg">{t.label}</span> },
    { key: "dur", header: "Duration", align: "right", sort: (t) => t.durationMs, cell: (t) => <span className={cx("num", t.durationMs !== null && a.latencyP95 !== null && t.durationMs > a.latencyP95 ? "text-warn" : "text-fg-2")}>{fmtMs(t.durationMs)}</span> },
    {
      key: "ok",
      header: "Result",
      align: "right",
      sort: (t) => (t.ok ? 1 : 0),
      cell: (t) => (t.ok ? <span className="inline-flex items-center gap-1 text-xs text-pos"><CheckCircle2 className="size-3.5" />OK</span> : <span className="inline-flex items-center gap-1 text-xs text-neg"><XCircle className="size-3.5" />Failed</span>),
    },
  ];

  return (
    <div className="space-y-6">
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-xs text-fg-3 hover:text-fg">
        <ArrowLeft className="size-3.5" /> All agents
      </Link>
      <PageHeader
        title={a.name}
        eyebrow={<span className="flex items-center gap-2"><Icon className="size-3.5" /> Agent · {a.id}</span>}
        description={a.role}
        right={
          <div className="flex items-center gap-4">
            <AgentStatusBadge status={a.status} />
            <label className="flex items-center gap-2 text-xs text-fg-2" title={a.id === "risk" ? "Risk supervision cannot be disabled from the interface" : undefined}>
              Enabled
              <Toggle checked={s.settings.agentsEnabled[a.id]} disabled={a.id === "risk" || readOnly} label={`Enable ${a.name}`} onChange={(v) => request(a, v)} />
            </label>
          </div>
        }
      />
      <Panel className="grid grid-cols-2 divide-line sm:grid-cols-4 xl:grid-cols-7 [&>div]:border-line">
        {[
          { l: "Current activity", v: <span className="text-[13px] font-normal text-cyan">{a.activity}</span>, wide: true },
          { l: "Ops today", v: fmtNum(a.opsToday) },
          { l: "Ops total", v: fmtCompact(a.opsTotal) },
          { l: "Errors 24h", v: <span className={a.errors24h ? "text-warn" : ""}>{a.errors24h}</span> },
          { l: "p50 / p95", v: <>{fmtMs(a.latencyP50)}<span className="text-fg-4"> / {fmtMs(a.latencyP95)}</span></> },
          { l: "Success · uptime", v: <>{fmtPct(a.successRate, { decimals: 1 })}<span className="text-fg-4"> · {fmtPct(a.uptimePct, { decimals: 2 })}</span></> },
        ].map((c, i) => (
          <div key={c.l} className={cx("p-5", c.wide && "col-span-2", i > 0 && "border-l max-sm:[&:nth-child(4)]:border-l-0", i >= 1 && "max-xl:border-t")}>
            <div className="label">{c.l}</div>
            <div className="num mt-2 whitespace-nowrap text-[15px] font-medium leading-6">{c.v}</div>
          </div>
        ))}
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader index="01" title="Throughput" subtitle={window_ === "6H" ? "Ops per 30 minutes" : "Ops per hour"} right={<Segmented size="sm" label="Window" value={window_} onChange={setWindow} options={["6H", "24H"]} />} />
          <div className="p-5">
            <BarChart
              data={hourly.map((v, i) => ({ key: i, v, label: fmtHM(base - (hourly.length - 1 - i) * bucketMs) }))}
              height={200}
              color={C.cyan}
              format={(v) => fmtCompact(v)}
              xLabelEvery={Math.ceil(hourly.length / 6)}
              highlightLast
              tooltip={(b) => (
                <>
                  <div className="mb-1 text-2xs text-fg-3">{b.label} CT</div>
                  <TooltipRow color={C.cyan} label="Ops" value={fmtNum(b.v)} />
                </>
              )}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHeader index="02" title="Latency" subtitle="p50 per 5-minute window" />
          <div className="p-5">
            {latency.length >= 2 ? (
              <LineChart data={latency} label="p50 latency" height={200} color={a.status === "degraded" ? C.warn : C.accent} format={fmtMs} xFormat={fmtHM} tooltipTitle={(t) => fmtTime(t) + " CT"} baseline={a.latencyP95 === null ? undefined : { value: a.latencyP95, label: `p95 ${fmtMs(a.latencyP95)}` }} />
            ) : (
              <Gap className="h-[200px]" title="Not measured" detail="The desk does not record per-task latency yet. The bus log has timestamps only." />
            )}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader index="03" title="Task log" subtitle={`${a.tasks.length} most recent · ${failed} failed`} />
          <DataTable rows={a.tasks} columns={taskCols} rowKey={(t) => t.id} initialSort={{ key: "at", dir: "desc" }} pageSize={12} />
        </Panel>
        <div className="space-y-6">
          <Panel>
            <PanelHeader index="04" title="Errors" />
            <div className="p-5">
              {a.lastError ? (
                <div className="flex gap-3 rounded-md border border-warn/25 bg-warn/[0.06] p-4">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                  <div>
                    <div className="text-[12.5px] text-fg">{a.lastError.message}</div>
                    <div className="num mt-1 text-2xs text-fg-3">Last seen {now ? fmtAgo(a.lastError.at, now) : ""} · {a.errors24h} in 24h</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-pos"><CheckCircle2 className="size-4" /> No errors in the last 24 hours.</div>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader index="05" title="Configuration" subtitle="Read-only · managed by the engine" />
            <div className="px-5 pb-3">
              <KeyValue cols={1} items={a.config.map((c) => ({ k: <span className="num">{c.key}</span>, v: c.value }))} />
              <KeyValue cols={1} items={a.metrics.map((m) => ({ k: m.label, v: m.value }))} />
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader index="06" title="Recent activity" subtitle={`Events emitted by ${a.name}`} />
        <ActivityFeed events={s.activity.filter((e) => e.agent === a.id)} showFilters={false} maxHeight={420} />
      </Panel>
      {dialog}
    </div>
  );
}
