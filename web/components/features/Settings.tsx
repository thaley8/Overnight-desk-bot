"use client";

import { Lock, Pencil, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Button, Gap, IconButton, PageHeader, Panel, Toggle } from "@/components/ui/primitives";
import { cx, fmtTime } from "@/lib/format";
import { useDesk } from "@/lib/store";
import type { RiskLimit } from "@/lib/types";
import { useAgentToggle } from "./Agents";
import { fmtLimit } from "./CommandCenter";
import { AGENT_ICON, useSnap } from "./common";
import { LimitEditor } from "./Risk";

const SECTIONS = [
  { id: "mode", label: "Trading mode" },
  { id: "limits", label: "Risk limits" },
  { id: "agents", label: "Agents" },
  { id: "notifications", label: "Notifications" },
  { id: "display", label: "Display" },
  { id: "diagnostics", label: "Diagnostics" },
];

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-line py-8 first:pt-0 last:border-b-0">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <div>
          <h2 className="text-[14px] font-medium text-fg">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-fg-3">{description}</p>
        </div>
        <Panel className="min-w-0">{children}</Panel>
      </div>
    </section>
  );
}

function Row({ title, detail, control, last }: { title: ReactNode; detail?: ReactNode; control: ReactNode; last?: boolean }) {
  return (
    <div className={cx("flex items-center gap-4 px-5 py-4", !last && "border-b border-line")}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-fg">{title}</div>
        {detail && <div className="mt-0.5 text-xs text-fg-3">{detail}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function Settings() {
  const s = useSnap();
  const { actions, status, refreshStatus, mode, sourceLabel, readOnly } = useDesk();
  const dm = s.meta.deskMode;
  const { request, dialog } = useAgentToggle();
  const [editing, setEditing] = useState<RiskLimit | null>(null);
  const n = s.settings.notify;
  const d = s.settings.display;

  return (
    <div>
      <PageHeader title="Settings" description="Operator preferences and desk controls. Trading mode and hard limits live in engine configuration and are shown read-only." />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[180px_1fr]">
        <nav className="hidden xl:block" aria-label="Settings sections">
          <ul className="sticky top-24 space-y-0.5">
            {SECTIONS.map((x) => (
              <li key={x.id}>
                <a href={`#${x.id}`} className="block rounded-md px-2.5 py-1.5 text-[12.5px] text-fg-3 transition-colors hover:bg-elevated hover:text-fg">
                  {x.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Section id="mode" title="Trading mode" description="Read from the desk. The interface never changes it, so a browser can never promote the desk to LIVE.">
            <Row
              title="Effective mode"
              detail={mode === "demo" ? "No desk connected — showing simulated data." : "LIVE only when Settings.md says live AND the acceptance gate passed."}
              control={<Badge tone={mode === "live" ? "neg" : mode === "paper" ? "accent" : "warn"} dot>{mode}</Badge>}
            />
            {dm && (
              <>
                <Row title="Settings.md mode" detail="vault · Desk/Settings.md frontmatter" control={<span className="num text-xs uppercase text-fg-2">{dm.settingsMode}</span>} />
                <Row
                  title="LIVE acceptance gate"
                  detail={
                    dm.liveGate.passed
                      ? `Passed${dm.liveGate.at ? ` · ${dm.liveGate.at}` : ""}`
                      : `${dm.liveGate.reason ?? "Not passed"}${dm.liveGate.failed.length ? ` · failing: ${dm.liveGate.failed.join(", ")}` : ""}${dm.liveGate.blocked.length ? ` · blocked: ${dm.liveGate.blocked.join(", ")}` : ""}`
                  }
                  control={<Badge tone={dm.liveGate.passed ? "pos" : "warn"} dot>{dm.liveGate.passed ? "passed" : `${dm.liveGate.failed.length}/${dm.liveGate.tests} failing`}</Badge>}
                />
              </>
            )}
            <Row title="Data source" detail="Where every figure on screen comes from." control={<span className="text-xs text-fg-2">{sourceLabel}</span>} />
            <Row
              last
              title={<span className="flex items-center gap-1.5"><Lock className="size-3.5 text-fg-3" /> Change mode</span>}
              detail={<>Only on the desk: <code className="num rounded bg-bg-2 px-1 text-fg-2">paper</code> / <code className="num rounded bg-bg-2 px-1 text-fg-2">live LIVE</code> over Telegram, and LIVE stays refused until the acceptance tests pass.</>}
              control={<span className="text-xs text-fg-4">Desk-managed</span>}
            />
          </Section>

          <Section id="limits" title="Risk limits" description={readOnly ? "Read from Settings.md. Change them on the desk (`set key value` over Telegram); the desk refuses values outside its ranges." : "Tightening applies immediately. Loosening requires explicit confirmation, and nothing can exceed the engine's hard ceilings."}>
            {!s.limits.length && (s.riskSettings?.length ? s.riskSettings.map((r, i) => <Row key={r.key} last={i === s.riskSettings!.length - 1} title={<span className="num">{r.key}</span>} control={<span className="num text-[13px] text-fg">{r.value}</span>} />) : <div className="p-5"><Gap title="No risk settings reported" /></div>)}
            {s.limits.map((l, i) => (
              <Row
                key={l.key}
                last={i === s.limits.length - 1}
                title={l.label}
                detail={l.description}
                control={
                  <div className="flex items-center gap-2">
                    <span className="num text-[13px] text-fg">{fmtLimit(l, l.limit)}</span>
                    <IconButton label={`Edit ${l.label}`} onClick={() => setEditing(l)}>
                      <Pencil className="size-3.5" />
                    </IconButton>
                  </div>
                }
              />
            ))}
          </Section>

          <Section id="agents" title="Agents" description={readOnly ? "Shows which bots the desk has paused. Pause or resume a bot with the Telegram `pause`/`resume` commands." : "Pause individual agents. Risk supervision is always on and cannot be disabled from here."}>
            {s.agents.map((a, i) => {
              const Icon = AGENT_ICON[a.id];
              return (
                <Row
                  key={a.id}
                  last={i === s.agents.length - 1}
                  title={<span className="flex items-center gap-2"><Icon className="size-3.5 text-fg-3" /> {a.name}</span>}
                  detail={a.role}
                  control={<Toggle checked={s.settings.agentsEnabled[a.id]} disabled={a.id === "risk" || readOnly} label={`Enable ${a.name}`} onChange={(v) => request(a, v)} />}
                />
              );
            })}
          </Section>

          <Section id="notifications" title="Notifications" description="Choose which events raise notifications. Warnings and critical events also show as toasts.">
            {(
              [
                ["executions", "Executions", "Fills and settlement verifications"],
                ["riskAlerts", "Risk alerts", "Limit warnings, blocked orders, emergency stop"],
                ["apiErrors", "API errors", "Provider failures and rate limiting"],
                ["discoveries", "Discoveries", "Every new pair from the Scanner (high volume)"],
              ] as const
            ).map(([k, t, dsc]) => (
              <Row key={k} title={t} detail={dsc} control={<Toggle checked={n[k]} label={t} onChange={(v) => actions.updateSettings({ notify: { ...n, [k]: v } })} />} />
            ))}
            <Row last title="Sound" detail="Play a tone for critical alerts" control={<Toggle checked={n.sound} label="Sound" onChange={(v) => actions.updateSettings({ notify: { ...n, sound: v } })} />} />
          </Section>

          <Section id="display" title="Display" description="Preferences for this browser session.">
            <Row title="Compact tables" detail="Tighter row height for dense monitoring" control={<Toggle checked={d.compactTables} label="Compact tables" onChange={(v) => actions.updateSettings({ display: { ...d, compactTables: v } })} />} />
            <Row last title="Reduce motion" detail="Disable transitions and live highlights" control={<Toggle checked={d.reduceMotion} label="Reduce motion" onChange={(v) => actions.updateSettings({ display: { ...d, reduceMotion: v } })} />} />
          </Section>

          <Section id="diagnostics" title="Diagnostics" description="What the server reported on its last status check.">
            <div className="flex items-center justify-between px-5 py-3 hairline-b">
              <span className="text-xs text-fg-3">{status ? `Checked ${fmtTime(Date.parse(status.checkedAt))} CT` : "Checking…"}</span>
              <Button size="sm" variant="ghost" onClick={refreshStatus}>
                <RefreshCw className="size-3.5" /> Refresh
              </Button>
            </div>
            <pre className="num max-h-72 overflow-auto px-5 py-4 text-xs leading-5 text-fg-2">{status ? JSON.stringify(status, null, 2) : "—"}</pre>
          </Section>
        </div>
      </div>
      {editing && <LimitEditor limit={editing} onClose={() => setEditing(null)} />}
      {dialog}
    </div>
  );
}
