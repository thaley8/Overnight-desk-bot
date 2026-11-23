"use client";

import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { C } from "@/components/charts/core";
import { LineChart } from "@/components/charts/LineChart";
import { Sparkline } from "@/components/charts/Small";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge, Gap, Meter, PageHeader, Panel, PanelHeader, SearchInput, Select, StatusDot } from "@/components/ui/primitives";
import { cx, fmtCompact, fmtDateTime, fmtHM, fmtMs, fmtNum, fmtPct, fmtTime } from "@/lib/format";
import { useNow } from "@/lib/store";
import type { ApiError, ApiProvider } from "@/lib/types";
import { useSnap } from "./common";

export function ApiMonitor() {
  const s = useSnap();
  return s.providers.length ? <ProviderMonitor /> : <LayerMonitor />;
}

/** deskview does not meter provider calls; show what the desk does report about its external layers. */
function LayerMonitor() {
  const s = useSnap();
  const errors = s.activity.filter((e) => e.kind === "api_error");
  return (
    <div className="space-y-6">
      <PageHeader title="API Monitoring" description="External layers the bots depend on: PumpPortal, FOMO, DexScreener, RugCheck, Solana RPC, gmgn and the LLM." />
      <Panel>
        <PanelHeader index="01" title="Degraded layers" subtitle="Parsed from desk.log by deskview" />
        {s.degradedLayers?.length ? (
          <ul>
            {s.degradedLayers.map((d) => (
              <li key={d.message} className="flex items-start gap-3 border-b border-line px-5 py-3 last:border-b-0">
                <StatusDot tone="warn" className="mt-1.5" />
                <span className="num min-w-0 flex-1 text-xs text-fg-2">{d.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5"><Gap compact title="None detected" /></div>
        )}
      </Panel>
      <Panel>
        <PanelHeader index="02" title="Error events" subtitle="executor.error · risk.error · fomo.logged_out from the bus" />
        {errors.length ? (
          <ul>
            {errors.slice(0, 50).map((e) => (
              <li key={e.id} className="flex items-start gap-3 border-b border-line px-5 py-3 last:border-b-0">
                <span className="num w-[110px] shrink-0 text-2xs text-fg-4">{fmtDateTime(e.at)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-neg">{e.title}</span>
                  <span className="block truncate text-xs text-fg-3">{e.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5"><Gap compact title="No error events in the loaded bus history" /></div>
        )}
      </Panel>
      <Panel>
        <PanelHeader index="03" title="Per-provider latency, request rates, quotas" />
        <div className="p-5">
          <Gap title="Not measured by the desk" detail="The desk doesn't record request counts or latency per provider. Adding that means the desk writing a metrics file, which is a desk-side change that needs your OK." />
        </div>
      </Panel>
    </div>
  );
}

function ProviderMonitor() {
  const s = useSnap();
  const now = useNow(30_000);
  const [selected, setSelected] = useState(s.providers[0].id);
  const [prov, setProv] = useState("all");
  const [q, setQ] = useState("");
  const p = s.providers.find((x) => x.id === selected) ?? s.providers[0];

  const rpm = s.providers.reduce((a, b) => a + b.rpm, 0);
  const req24 = s.providers.reduce((a, b) => a + b.requests24h, 0);
  const errRate = s.providers.reduce((a, b) => a + b.errorRate * b.rpm, 0) / rpm;
  const degraded = s.providers.filter((x) => x.status !== "operational").length;
  const errors = useMemo(
    () => s.apiErrors.filter((e) => (prov === "all" || e.provider === prov) && (!q || `${e.code} ${e.endpoint} ${e.message}`.toLowerCase().includes(q.toLowerCase()))),
    [s.apiErrors, prov, q],
  );

  const cols: Column<ApiProvider>[] = [
    {
      key: "name",
      header: "Provider",
      sort: (x) => x.name,
      cell: (x) => (
        <div className="flex items-center gap-2.5">
          <StatusDot tone={x.status === "operational" ? "pos" : x.status === "degraded" ? "warn" : "neg"} pulse={x.status !== "operational"} />
          <div>
            <div className="font-medium">{x.name}</div>
            <div className="text-2xs text-fg-3">{x.purpose}</div>
          </div>
        </div>
      ),
    },
    { key: "rpm", header: "Req/min", align: "right", sort: (x) => x.rpm, cell: (x) => <span className="num">{fmtNum(x.rpm)}</span> },
    { key: "p50", header: "p50", align: "right", sort: (x) => x.p50, cell: (x) => <span className="num text-fg-2">{fmtMs(x.p50)}</span>, hideBelow: "sm" },
    { key: "p95", header: "p95", align: "right", sort: (x) => x.p95, cell: (x) => <span className="num text-fg-2">{fmtMs(x.p95)}</span>, hideBelow: "md" },
    { key: "err", header: "Errors", align: "right", sort: (x) => x.errorRate, cell: (x) => <span className={cx("num", x.errorRate > 0.02 ? "text-neg" : x.errorRate > 0.005 ? "text-warn" : "text-fg-2")}>{fmtPct(x.errorRate, { decimals: 2 })}</span> },
    {
      key: "quota",
      header: "Rate-limit usage",
      sort: (x) => x.quotaUsed / x.quotaLimit,
      cell: (x) => (
        <div className="w-32">
          <Meter value={x.quotaUsed} max={x.quotaLimit} />
          <div className="num mt-1 text-2xs text-fg-4">{fmtNum(x.quotaUsed)} / {fmtNum(x.quotaLimit)} rpm</div>
        </div>
      ),
      hideBelow: "lg",
    },
    { key: "lat", header: "Latency 60m", align: "right", cell: (x) => <Sparkline data={x.latency} width={96} height={22} color={x.status === "degraded" ? C.warn : C.cyan} className="ml-auto" />, hideBelow: "xl" },
  ];

  const errCols: Column<ApiError>[] = [
    { key: "at", header: "Time (CT)", sort: (e) => e.at, cell: (e) => <span className="num text-fg-2">{fmtDateTime(e.at).replace(" CT", "")}</span> },
    { key: "provider", header: "Provider", sort: (e) => e.provider, cell: (e) => <span className="text-fg">{e.provider}</span> },
    { key: "code", header: "Code", sort: (e) => String(e.code), cell: (e) => <Badge tone={e.code === 429 ? "warn" : "neg"}>{String(e.code)}</Badge> },
    { key: "endpoint", header: "Endpoint", cell: (e) => <span className="num text-xs text-fg-3">{e.endpoint}</span>, hideBelow: "md" },
    { key: "msg", header: "Message", cell: (e) => <span className="text-fg-2">{e.message}</span>, hideBelow: "sm" },
    { key: "retry", header: "Retried", align: "center", sort: (e) => (e.retried ? 1 : 0), cell: (e) => (e.retried ? <RotateCcw className="mx-auto size-3.5 text-pos" aria-label="Retried" /> : <span className="text-fg-4">—</span>), hideBelow: "sm" },
  ];

  const base = now || s.generatedAt;
  return (
    <div className="space-y-6">
      <PageHeader title="API Monitoring" description="External providers the agents depend on: throughput, latency, error rates and rate-limit headroom." />
      <Panel className="grid grid-cols-2 sm:grid-cols-5">
        {[
          { l: "Requests / min", v: fmtNum(rpm) },
          { l: "Requests 24h", v: fmtCompact(req24) },
          { l: "Error rate", v: <span className={errRate > 0.01 ? "text-warn" : ""}>{fmtPct(errRate, { decimals: 2 })}</span> },
          { l: "Errors logged", v: fmtNum(s.apiErrors.length) },
          { l: "Degraded", v: <span className={degraded ? "text-warn" : "text-pos"}>{degraded} of {s.providers.length}</span> },
        ].map((c, i) => (
          <div key={c.l} className={cx("border-line p-5", i > 0 && "sm:border-l", i % 2 === 1 && "max-sm:border-l", i >= 2 && "max-sm:border-t")}>
            <div className="label">{c.l}</div>
            <div className="num mt-2 text-[19px] font-medium leading-6">{c.v}</div>
          </div>
        ))}
      </Panel>
      <Panel>
        <PanelHeader index="01" title="Providers" subtitle="Select a provider to inspect latency" />
        <DataTable rows={s.providers} columns={cols} rowKey={(x) => x.id} onRowClick={(x) => setSelected(x.id)} rowClassName={(x) => (x.id === selected ? "bg-elevated/60 shadow-[inset_2px_0_0_var(--color-accent)]" : undefined)} />
      </Panel>
      <Panel>
        <PanelHeader
          index="02"
          title={`${p.name} · latency`}
          subtitle="Per-minute p50, last 60 minutes"
          right={<Select label="Provider" value={selected} onChange={setSelected} options={s.providers.map((x) => ({ value: x.id, label: x.name }))} />}
        />
        <div className="p-5">
          <LineChart
            data={p.latency.map((v, i) => ({ t: base - (p.latency.length - 1 - i) * 60_000, v }))}
            label="p50"
            color={p.status === "degraded" ? C.warn : C.accent}
            height={220}
            format={fmtMs}
            xFormat={fmtHM}
            tooltipTitle={(t) => fmtTime(t) + " CT"}
            baseline={{ value: p.p95, label: `p95 ${fmtMs(p.p95)}` }}
          />
        </div>
      </Panel>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 hairline-b">
          <div className="mr-2 flex items-baseline gap-2.5">
            <span className="num text-2xs text-fg-4">03</span>
            <h2 className="text-[13px] font-medium">Error log</h2>
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Code, endpoint, message" className="w-full sm:w-60" />
          <Select label="Provider" value={prov} onChange={setProv} options={[{ value: "all", label: "All" }, ...[...new Set(s.apiErrors.map((e) => e.provider))].map((x) => ({ value: x, label: x }))]} />
          <span className="num ml-auto text-xs text-fg-3">{errors.length} errors</span>
        </div>
        <DataTable rows={errors} columns={errCols} rowKey={(e) => e.id} initialSort={{ key: "at", dir: "desc" }} pageSize={15} />
      </Panel>
    </div>
  );
}
