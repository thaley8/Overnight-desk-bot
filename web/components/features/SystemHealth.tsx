"use client";

import { CheckCircle2, CircleDashed, RefreshCw, XCircle } from "lucide-react";
import { C } from "@/components/charts/core";
import { LineChart } from "@/components/charts/LineChart";
import { UptimeStrip } from "@/components/charts/Small";
import { Badge, Button, Gap, PageHeader, Panel, PanelHeader, StatusDot } from "@/components/ui/primitives";
import { cx, fmtAgo, fmtDateTime, fmtDuration, fmtHM, fmtMs, fmtNum, fmtPct, fmtTime } from "@/lib/format";
import { useDesk, useNow } from "@/lib/store";
import type { Service } from "@/lib/types";
import { useSnap } from "./common";

const ST: Record<Service["status"], { tone: "pos" | "warn" | "neg" | "neutral"; label: string }> = {
  operational: { tone: "pos", label: "Operational" },
  degraded: { tone: "warn", label: "Degraded" },
  down: { tone: "neg", label: "Down" },
  idle: { tone: "neutral", label: "Idle" },
};

/** Real checks performed by the server (/api/status) — not simulated. */
function LiveChecks() {
  const { status, statusError, refreshStatus, sourceLabel, snap } = useDesk();
  const rows = [
    {
      name: "Interface API",
      detail: "/api/status route handler",
      state: statusError ? "fail" : status ? "ok" : "pending",
      value: statusError ?? (status ? `checked ${fmtTime(Date.parse(status.checkedAt))} CT` : "checking…"),
    },
    {
      name: "deskview",
      detail: "DESKVIEW_URL · GET /api/v1/mode",
      state: !status ? "pending" : !status.engine.configured ? "off" : status.engine.reachable ? "ok" : "fail",
      value: !status ? "checking…" : !status.engine.configured ? "Not configured" : status.engine.reachable ? `Mode ${status.tradingMode?.toUpperCase() ?? "?"} · ${status.engine.latencyMs}ms` : status.engine.error ?? "Unreachable",
    },
    {
      name: "Live stream",
      detail: "deskview WebSocket via /api/desk/stream",
      state: snap?.meta.source !== "deskview" ? "off" : snap.meta.connection.ok ? "ok" : "fail",
      value: snap?.meta.source !== "deskview" ? "Not in use" : snap.meta.connection.ok ? `last frame ${snap.meta.connection.lastFrameAt ? fmtTime(snap.meta.connection.lastFrameAt) + " CT" : "—"}` : snap.meta.connection.error ?? "Disconnected",
    },
    { name: "Data source", detail: "Active in this browser", state: snap?.meta.source === "demo" ? "info" : "ok", value: sourceLabel },
  ];
  const icon = (st: string) =>
    st === "ok" ? <CheckCircle2 className="size-4 text-pos" /> : st === "fail" ? <XCircle className="size-4 text-neg" /> : st === "info" ? <StatusDot tone="warn" className="mx-[5px]" /> : <CircleDashed className="size-4 text-fg-3" />;
  return (
    <Panel>
      <PanelHeader
        index="01"
        title="Live connection checks"
        subtitle="Performed by the server now — not simulated"
        right={
          <Button size="sm" variant="ghost" onClick={refreshStatus}>
            <RefreshCw className="size-3.5" /> Re-check
          </Button>
        }
      />
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((r, i) => (
          <li key={r.name} className={cx("flex items-start gap-3 border-line p-5", i > 0 && "xl:border-l", i % 2 === 1 && "sm:border-l", i >= 1 && "max-sm:border-t", i >= 2 && "sm:max-xl:border-t")}>
            <span className="mt-0.5">{icon(r.state)}</span>
            <div className="min-w-0">
              <div className="text-[13px] text-fg">{r.name}</div>
              <div className="num truncate text-2xs text-fg-4">{r.detail}</div>
              <div className="mt-1.5 truncate text-xs text-fg-2" title={r.value}>{r.value}</div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function SystemHealth() {
  const s = useSnap();
  const now = useNow(10_000);
  const degraded = s.services.filter((x) => x.status !== "operational");
  const r = s.resources;
  const last = r[r.length - 1] ?? { cpu: 0, mem: 0, queue: 0 };
  const real = s.meta.source !== "demo";
  const ups = s.services.map((b) => b.uptimePct).filter((u): u is number => u !== null);
  const overallUptime = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health"
        description="Service status, resource load and incident history for the desk's runtime."
        right={
          degraded.filter((d) => d.status === "down").length ? (
            <Badge tone="neg" dot>{degraded.filter((d) => d.status === "down").length} down</Badge>
          ) : degraded.filter((d) => d.status === "degraded").length ? (
            <Badge tone="warn" dot>{degraded.filter((d) => d.status === "degraded").length} degraded</Badge>
          ) : (
            <Badge tone="pos" dot>No outages</Badge>
          )
        }
      />
      <LiveChecks />

      <Panel>
        <PanelHeader
          index="02"
          title="Services"
          subtitle={real ? "Processes, ports and heartbeats on the desk box" : "Last 90 health checks · 1 per minute"}
          right={overallUptime === null ? undefined : <span className="num text-xs text-fg-3">Fleet uptime {fmtPct(overallUptime, { decimals: 2 })}</span>}
        />
        <ul>
          {s.services.map((sv) => (
            <li key={sv.id} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-b border-line px-5 py-3.5 last:border-b-0 lg:grid-cols-[220px_1fr_90px_80px_110px]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px] text-fg">
                  <StatusDot tone={ST[sv.status].tone} pulse={sv.status !== "operational"} />
                  {sv.name}
                </div>
                <div className="pl-3.5 text-2xs text-fg-4">{sv.kind} · {sv.region}</div>
              </div>
              {sv.checks.length ? (
                <UptimeStrip checks={sv.checks} className="col-span-2 row-start-2 lg:col-span-1 lg:row-start-auto" />
              ) : (
                <span className="col-span-2 row-start-2 truncate text-xs text-fg-3 lg:col-span-1 lg:row-start-auto" title={sv.detail}>{sv.detail ?? "—"}</span>
              )}
              <span className="num hidden text-right text-xs text-fg-2 lg:block">{fmtPct(sv.uptimePct, { decimals: 2 })}</span>
              <span className="num hidden text-right text-xs text-fg-3 lg:block">{fmtMs(sv.latencyMs)}</span>
              <span className="text-right"><Badge tone={ST[sv.status].tone}>{ST[sv.status].label}</Badge></span>
            </li>
          ))}
        </ul>
      </Panel>

      {real && (
        <Panel>
          <PanelHeader index="03" title="Degraded layers" subtitle="From desk.log: missing keys, disabled models, 402s" />
          {s.degradedLayers?.length ? (
            <ul>
              {s.degradedLayers.map((d) => (
                <li key={d.message} className="flex items-start gap-3 border-b border-line px-5 py-3 last:border-b-0">
                  <StatusDot tone="warn" className="mt-1.5" />
                  <span className="num min-w-0 flex-1 text-xs text-fg-2">{d.message}</span>
                  <span className="num shrink-0 text-2xs text-fg-4">{d.at ? fmtTime(Date.parse(d.at)) + " CT" : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5"><Gap compact title="None detected" detail="No degraded-layer lines in the last 1,500 lines of desk.log." /></div>
          )}
        </Panel>
      )}

      {r.length === 0 ? (
        <Panel>
          <PanelHeader index="04" title="Resources" />
          <div className="p-5"><Gap title="Not reported" detail="deskview doesn't sample CPU, memory or queue depth. The desk's bus is in-process, so there is no external queue." /></div>
        </Panel>
      ) : (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {[
          { k: "cpu" as const, label: "CPU", color: C.accent, fmt: (v: number) => `${v.toFixed(0)}%`, cur: `${last.cpu.toFixed(0)}%` },
          { k: "mem" as const, label: "Memory", color: C.cyan, fmt: (v: number) => `${v.toFixed(0)}%`, cur: `${last.mem.toFixed(0)}%` },
          { k: "queue" as const, label: "Task queue depth", color: C.accent, fmt: (v: number) => fmtNum(v), cur: fmtNum(last.queue) },
        ].map((m, i) => (
          <Panel key={m.k}>
            <PanelHeader index={`0${i + 3}`} title={m.label} subtitle="Last 2 hours" right={<span className="num text-[15px] text-fg">{m.cur}</span>} />
            <div className="p-4">
              <LineChart data={r.map((p) => ({ t: p.t, v: p[m.k] }))} label={m.label} color={m.color} height={140} yTicks={2} format={m.fmt} xFormat={fmtHM} tooltipTitle={(t) => fmtTime(t) + " CT"} />
            </div>
          </Panel>
        ))}
      </div>
      )}

      <Panel>
        <PanelHeader index="06" title={real ? "Problems" : "Incidents"} subtitle={real ? "Current problems from desk health checks" : "Most recent first"} />
        {s.incidents.length === 0 && <div className="p-5"><Gap compact title="No problems reported" /></div>}
        <ol className="relative px-5 py-5">
          {s.incidents.map((inc, i) => (
            <li key={inc.id} className="relative flex gap-4 pb-6 last:pb-0">
              {i < s.incidents.length - 1 && <span className="absolute left-[7px] top-5 h-[calc(100%-12px)] w-px bg-line-2" />}
              <span className={cx("relative mt-1 size-[15px] shrink-0 rounded-full border-2 bg-panel", inc.resolvedAt ? "border-fg-4" : inc.severity === "critical" ? "border-neg" : "border-warn")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-fg">{inc.title}</span>
                  <Badge tone={inc.resolvedAt ? "neutral" : inc.severity === "critical" ? "neg" : "warn"}>{inc.resolvedAt ? "Resolved" : real ? "Open" : "Investigating"}</Badge>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-fg-2">{inc.summary}</p>
                <div className="num mt-1.5 text-2xs text-fg-4">
                  {inc.service} · {fmtDateTime(inc.at)} · {inc.resolvedAt ? `lasted ${fmtDuration(inc.resolvedAt - inc.at)}` : now ? `open ${fmtAgo(inc.at, now).replace(" ago", "")}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
