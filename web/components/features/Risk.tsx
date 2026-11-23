"use client";

import { AlertTriangle, Check, Info, OctagonX, Pencil, ShieldCheck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { C } from "@/components/charts/core";
import { LineChart } from "@/components/charts/LineChart";
import { Dialog } from "@/components/ui/Overlay";
import { Badge, Button, Gap, IconButton, KeyValue, Meter, PageHeader, Panel, PanelHeader, Segmented } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { LIMIT_CEILINGS } from "@/lib/data/source";
import { drawdownSeries, liveLimits, overview, positionValue } from "@/lib/derive";
import { cx, fmtAgo, fmtDate, fmtDateTime, fmtFullDate, fmtPct } from "@/lib/format";
import { useDesk, useNow } from "@/lib/store";
import type { RiskAlert, RiskLimit } from "@/lib/types";
import { fmtLimit } from "./CommandCenter";
import { useSnap } from "./common";

const REASONS = ["Abnormal market conditions", "Suspected agent malfunction", "Infrastructure incident", "Manual review", "Other"];

function EmergencyStop() {
  const s = useSnap();
  const { actions, mode } = useDesk();
  const toast = useToast();
  const now = useNow(10_000);
  const [engageOpen, setEngageOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [typed, setTyped] = useState("");
  const es = s.emergencyStop;

  const engage = async () => {
    setEngageOpen(false);
    const r = await actions.setEmergencyStop(true, reason);
    toast({ tone: "critical", title: r.message });
  };
  const release = async () => {
    setReleaseOpen(false);
    setTyped("");
    const r = await actions.setEmergencyStop(false, "");
    toast({ tone: "success", title: r.message });
  };

  return (
    <Panel className={cx("relative overflow-hidden", es.engaged && "border-neg/40")}>
      {es.engaged && <div className="absolute inset-x-0 top-0 h-[2px] bg-neg" />}
      <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center">
        <div className={cx("flex size-12 shrink-0 items-center justify-center rounded-lg border", es.engaged ? "border-neg/40 bg-neg/12 text-neg" : "border-pos/25 bg-pos/8 text-pos")}>
          {es.engaged ? <OctagonX className="size-6" /> : <ShieldCheck className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="label">Emergency stop</div>
          <div className={cx("mt-1 text-[17px] font-semibold", es.engaged ? "text-neg" : "text-fg")}>{es.engaged ? "Engaged — all new orders halted" : "Armed — trading active"}</div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-3">
            {es.engaged
              ? `Engaged by ${es.by} ${es.at && now ? fmtAgo(es.at, now) : ""} · ${es.reason}. Brain and Executor are halted; Risk continues monitoring. Manual closes remain available.`
              : "Engaging halts Brain and Executor immediately. No new entries or automated exits are routed until an operator releases it. Releasing requires typed confirmation."}
          </p>
        </div>
        {es.engaged ? (
          <Button size="lg" variant="secondary" onClick={() => setReleaseOpen(true)}>
            Release emergency stop
          </Button>
        ) : (
          <Button size="lg" variant="danger-solid" onClick={() => setEngageOpen(true)}>
            <OctagonX className="size-4" /> Engage emergency stop
          </Button>
        )}
      </div>

      <Dialog
        open={engageOpen}
        onClose={() => setEngageOpen(false)}
        tone="danger"
        title="Engage emergency stop?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEngageOpen(false)}>Cancel</Button>
            <Button variant="danger-solid" onClick={engage} data-autofocus>Engage now</Button>
          </>
        }
      >
        <p>All new orders stop immediately, including automated stop-loss and take-profit exits. Open positions are not closed.</p>
        <label className="mt-4 block">
          <span className="label">Reason (recorded in the audit log)</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-line-2 bg-elevated px-2.5 text-[13px] text-fg focus:border-accent/60 focus:outline-none">
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        {mode === "demo" && <p className="mt-3 text-xs text-warn">Demo mode: affects the simulator only.</p>}
      </Dialog>

      <Dialog
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        title="Release emergency stop?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReleaseOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={typed !== "RESUME"} onClick={release}>Resume trading</Button>
          </>
        }
      >
        <p>Brain and Executor resume on release. Confirm current limits and open alerts before continuing.</p>
        <label className="mt-4 block">
          <span className="label">Type RESUME to confirm</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} data-autofocus className="num mt-1.5 h-9 w-full rounded-md border border-line-2 bg-elevated px-2.5 text-[13px] tracking-widest text-fg focus:border-accent/60 focus:outline-none" />
        </label>
      </Dialog>
    </Panel>
  );
}

export function LimitEditor({ limit, onClose }: { limit: RiskLimit; onClose: () => void }) {
  const { actions } = useDesk();
  const toast = useToast();
  const isPct = limit.unit === "pct";
  const [val, setVal] = useState(String(isPct ? +(limit.limit * 100).toFixed(2) : limit.limit));
  const ceiling = LIMIT_CEILINGS[limit.key];
  const parsed = isPct ? +val / 100 : +val;
  const invalid = !Number.isFinite(parsed) || parsed <= 0;
  const over = ceiling !== undefined && parsed > ceiling;
  const loosening = parsed > limit.limit;
  const [ack, setAck] = useState(false);
  const save = async () => {
    const r = await actions.updateLimit(limit.key, parsed);
    toast({ tone: r.ok ? "success" : "warning", title: r.message });
    if (r.ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit · ${limit.label}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={invalid || over || (loosening && !ack)} onClick={save}>Apply limit</Button>
        </>
      }
    >
      <p className="text-xs">{limit.description}</p>
      <label className="mt-4 block">
        <span className="label">New value {isPct ? "(%)" : limit.unit === "usd" ? "(USD)" : limit.unit === "bps" ? "(bps)" : ""}</span>
        <input type="number" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} data-autofocus className="num mt-1.5 h-9 w-full rounded-md border border-line-2 bg-elevated px-2.5 text-[13px] text-fg focus:border-accent/60 focus:outline-none" />
      </label>
      <div className="mt-2 flex justify-between text-2xs text-fg-3">
        <span>Current {fmtLimit(limit, limit.limit)}</span>
        {ceiling !== undefined && <span>Hard ceiling {fmtLimit(limit, ceiling)}</span>}
      </div>
      {over && <p className="mt-3 flex items-center gap-1.5 text-xs text-neg"><XCircle className="size-3.5" /> Above the hard ceiling. Ceilings can only be changed in engine configuration.</p>}
      {loosening && !over && !invalid && (
        <label className="mt-3 flex items-start gap-2 rounded-md border border-warn/25 bg-warn/[0.06] p-3 text-xs text-warn">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#E3AA4A]" />
          This loosens a risk limit. I confirm the change is intended.
        </label>
      )}
    </Dialog>
  );
}

function AlertIcon({ sev }: { sev: RiskAlert["severity"] }) {
  if (sev === "critical") return <XCircle className="size-4 text-neg" />;
  if (sev === "warning") return <AlertTriangle className="size-4 text-warn" />;
  return <Info className="size-4 text-accent-2" />;
}

/** Read-only view of the desk's own pause state. Changing it goes through Telegram, never this page. */
function DeskPause() {
  const s = useSnap();
  const m = s.meta.deskMode;
  const paused = !!m?.paused;
  return (
    <Panel className={cx("relative overflow-hidden", paused && "border-neg/40")}>
      {paused && <div className="absolute inset-x-0 top-0 h-[2px] bg-neg" />}
      <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center">
        <div className={cx("flex size-12 shrink-0 items-center justify-center rounded-lg border", paused ? "border-neg/40 bg-neg/12 text-neg" : "border-pos/25 bg-pos/8 text-pos")}>
          {paused ? <OctagonX className="size-6" /> : <ShieldCheck className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="label">Desk pause · data/desk_paused.flag</div>
          <div className={cx("mt-1 text-[17px] font-semibold", paused ? "text-neg" : "text-fg")}>{!m ? "Unknown — deskview not reporting" : paused ? `Paused${m.pausedReason ? ` — ${m.pausedReason}` : ""}` : "Not paused"}</div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-3">
            {m?.botsPaused.length ? `Bots paused individually: ${m.botsPaused.join(", ")}. ` : ""}
            Pause, resume and sells go through the Telegram commands (<code className="num text-fg-2">pause</code>, <code className="num text-fg-2">resume</code>, <code className="num text-fg-2">sell X 25|50|100</code>). Night-loss limits are enforced by Risk inside the desk.
          </p>
        </div>
        <span className="inline-flex h-8 items-center rounded-md border border-line-2 px-3 text-xs text-fg-3">Read-only</span>
      </div>
    </Panel>
  );
}

export function Risk() {
  const s = useSnap();
  const { actions, readOnly } = useDesk();
  const now = useNow(15_000);
  const [editing, setEditing] = useState<RiskLimit | null>(null);
  const [alertFilter, setAlertFilter] = useState<"open" | "all">("open");
  const limits = liveLimits(s);
  const o = overview(s);
  const dd = useMemo(() => drawdownSeries(s.daily.slice(-60)), [s.daily]);
  const tokenLimitRaw = s.limits.find((l) => l.key === "token_exposure")?.limit ?? null;
  const tokenLimit = tokenLimitRaw ?? 0.15; // scale only; no limit line is drawn when the source has none
  const exposures = [...s.positions].map((p) => ({ p, share: o.equity ? (positionValue(p) ?? 0) / o.equity : 0, known: p.mark !== null })).sort((a, b) => b.share - a.share);
  const alerts = s.alerts.filter((a) => alertFilter === "all" || !a.acknowledged);
  const breaches = limits.filter((l) => l.used / l.limit >= 0.9).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Management"
        description={
          readOnly
            ? "What the desk's Risk bot is enforcing, read live from deskview. Nothing on this page can change a limit or pause trading."
            : "Limits are enforced by the Risk agent before any order is routed. This page shows utilisation and lets an operator tighten controls or halt trading."
        }
      />
      {readOnly ? <DeskPause /> : <EmergencyStop />}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            index="01"
            title={limits.length ? "Limits & utilisation" : "Risk settings"}
            subtitle={limits.length ? undefined : "Settings.md · risk section · enforced by the desk"}
            right={limits.length ? (breaches ? <Badge tone="neg" dot>{breaches} near limit</Badge> : <Badge tone="pos" dot>Within limits</Badge>) : <Badge>Read-only</Badge>}
          />
          {!limits.length && (
            <div className="px-5 pb-4">
              {s.riskSettings?.length ? (
                <KeyValue cols={2} items={s.riskSettings.map((r) => ({ k: <span className="num">{r.key}</span>, v: r.value }))} />
              ) : (
                <Gap className="mt-4" title="No risk settings reported" detail="Settings.md frontmatter has no risk: section." />
              )}
            </div>
          )}
          <ul>
            {limits.map((l) => {
              const u = l.used / l.limit;
              return (
                <li key={l.key} className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="text-[13px] text-fg">{l.label}</div>
                    <div className="truncate text-xs text-fg-3" title={l.description}>{l.description}</div>
                  </div>
                  <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                    <div className="num mb-1.5 flex justify-between text-xs">
                      <span className={cx(u >= 0.9 ? "text-neg" : u >= 0.7 ? "text-warn" : "text-fg")}>{fmtLimit(l, l.used)}</span>
                      <span className="text-fg-3">{fmtPct(Math.min(9.99, u), { decimals: 0 })} of {fmtLimit(l, l.limit)}</span>
                    </div>
                    <Meter value={l.used} max={l.limit} height={5} marks={[0.7, 0.9]} />
                  </div>
                  <IconButton label={`Edit ${l.label}`} onClick={() => setEditing(l)} disabled={readOnly} className="row-start-1 sm:row-start-auto">
                    <Pencil className="size-3.5" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader index="02" title="Exposure by token" subtitle={tokenLimitRaw === null ? "Share of equity" : `Limit ${fmtPct(tokenLimitRaw, { decimals: 0 })} of equity`} />
            <ul className="space-y-3 p-5">
              {exposures.length === 0 && <li className="text-xs text-fg-3">No open exposure.</li>}
              {exposures.map(({ p, share, known }) => (
                <li key={p.id} className="grid grid-cols-[52px_1fr_52px] items-center gap-3 text-xs">
                  <span className="font-medium text-fg">{p.symbol}</span>
                  <div className="relative h-2 rounded-full bg-fg-4/25">
                    <div className={cx("h-full rounded-full", share / tokenLimit >= 0.9 ? "bg-neg" : share / tokenLimit >= 0.7 ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, (share / (tokenLimit * 1.25)) * 100)}%` }} />
                    {tokenLimitRaw !== null && <span className="absolute -top-1 h-4 w-px bg-neg/70" style={{ left: `${100 / 1.25}%` }} title="Per-token limit" />}
                  </div>
                  <span className="num text-right text-fg-2">{known ? fmtPct(share, { decimals: 1 }) : "no mark"}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader index="03" title="Drawdown" subtitle="Last 60 days" />
            <div className="p-5">
              {dd.length >= 2 ? (
                <LineChart data={dd} label="Drawdown" color={C.neg} height={150} areaTo="zero" yTicks={2} format={(v) => fmtPct(v, { decimals: 0 })} xFormat={fmtDate} tooltipTitle={fmtFullDate} />
              ) : (
                <Gap className="h-[150px]" title="Needs two nights" detail="Drawdown is computed from nightly balances in vault Daily/ notes." />
              )}
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          index="04"
          title="Alert log"
          right={<Segmented size="sm" label="Alert filter" value={alertFilter} onChange={setAlertFilter} options={[{ value: "open", label: `Open ${s.alerts.filter((a) => !a.acknowledged).length}` }, { value: "all", label: "All" }]} />}
        />
        <ul>
          {alerts.length === 0 && <li className="px-5 py-10 text-center text-xs text-fg-3">No open alerts.</li>}
          {alerts.map((a) => (
            <li key={a.id} className={cx("flex items-start gap-3 border-b border-line px-5 py-3.5 last:border-b-0", a.acknowledged && "opacity-60")}>
              <span className="mt-0.5"><AlertIcon sev={a.severity} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-fg">{a.title}</div>
                <div className="text-xs text-fg-3">{a.detail}</div>
              </div>
              <div className="hidden text-right sm:block">
                <div className="num text-2xs text-fg-3">{fmtDateTime(a.at)}</div>
                <div className="num text-2xs text-fg-4">{now ? fmtAgo(a.at, now) : ""}</div>
              </div>
              {readOnly ? null : a.acknowledged ? (
                <span className="flex h-7 items-center gap-1 px-2 text-xs text-fg-3"><Check className="size-3.5" /> Acked</span>
              ) : (
                <Button size="sm" onClick={() => actions.acknowledgeAlert(a.id)}>Acknowledge</Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      {editing && <LimitEditor limit={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
