"use client";

import { OctagonX, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";
import { NAV, navFor, SETTINGS_ITEM, type NavItem } from "@/lib/nav";
import { useDesk } from "@/lib/store";
import { LogoMark, Wordmark } from "./Logo";

function useBadges(): Record<string, { n: number; tone: "neutral" | "warn" | "neg" } | undefined> {
  const { snap } = useDesk();
  if (!snap) return {};
  const unackCritical = snap.alerts.filter((a) => !a.acknowledged && (a.severity === "critical" || a.severity === "warning")).length;
  const pending = snap.tokens.filter((t) => t.verdict === "pending").length;
  const degraded = snap.services.filter((s) => s.status === "down" || s.status === "degraded").length;
  const apiDegraded = snap.providers.filter((p) => p.status !== "operational").length;
  return {
    "/scanner": pending ? { n: pending, tone: "neutral" } : undefined,
    "/positions": { n: snap.positions.length, tone: "neutral" },
    "/risk": unackCritical ? { n: unackCritical, tone: "neg" } : undefined,
    "/system": degraded ? { n: degraded, tone: "warn" } : undefined,
    "/api-monitor": apiDegraded ? { n: apiDegraded, tone: "warn" } : undefined,
  };
}

function Item({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = navFor(pathname)?.href === item.href;
  const badge = useBadges()[item.href];
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group relative flex h-8 items-center gap-2.5 rounded-md text-[12.5px] font-medium transition-colors",
        collapsed ? "justify-center px-0" : "px-2.5",
        active ? "bg-elevated text-fg" : "text-fg-2 hover:bg-elevated/60 hover:text-fg",
      )}
    >
      {active && <span className="absolute -left-3 top-1.5 h-5 w-[2px] rounded-r bg-accent" />}
      <Icon className={cx("size-[15px] shrink-0", active ? "text-accent-2" : "text-fg-3 group-hover:text-fg-2")} strokeWidth={1.75} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {badge && !collapsed && (
        <span className={cx("num ml-auto rounded px-1.5 text-2xs leading-[18px]", badge.tone === "neg" ? "bg-neg/15 text-neg" : badge.tone === "warn" ? "bg-warn/12 text-warn" : "bg-fg-3/10 text-fg-3")}>{badge.n}</span>
      )}
      {badge && collapsed && badge.tone !== "neutral" && <span className={cx("absolute right-1.5 top-1.5 size-1.5 rounded-full", badge.tone === "neg" ? "bg-neg" : "bg-warn")} />}
    </Link>
  );
}

export function SidebarContent({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const { snap } = useDesk();
  const engaged = snap?.emergencyStop.engaged;
  const real = snap?.meta.source === "deskview";
  return (
    <div className="flex h-full flex-col">
      <div className={cx("flex h-14 shrink-0 items-center gap-2.5", collapsed ? "justify-center px-0" : "px-4")}>
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5" aria-label="Overnight Desk home">
          <LogoMark />
          {!collapsed && <Wordmark />}
        </Link>
      </div>
      <nav className={cx("min-h-0 flex-1 overflow-y-auto pb-4 pt-2", collapsed ? "px-3" : "px-3")} aria-label="Primary">
        {NAV.map((g) => (
          <div key={g.group} className="mb-5">
            {!collapsed ? <div className="label mb-1.5 px-2.5 text-fg-4">{g.group}</div> : <div className="mx-auto mb-2 h-px w-5 bg-line-2" />}
            <div className="flex flex-col gap-0.5">
              {g.items.map((it) => (
                <Item key={it.href} item={it} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-0.5 border-t border-line pt-3">
          <Item item={SETTINGS_ITEM} collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      </nav>
      <div className={cx("shrink-0 border-t border-line p-3", collapsed && "flex flex-col items-center gap-2")}>
        <Link
          href="/risk"
          onClick={onNavigate}
          title={engaged ? "Emergency stop engaged" : "Emergency stop armed"}
          className={cx(
            "flex items-center gap-2.5 rounded-md border transition-colors",
            collapsed ? "size-8 justify-center" : "px-2.5 py-2",
            engaged ? "border-neg/40 bg-neg/10 hover:bg-neg/15" : "border-line hover:border-line-2 hover:bg-elevated/50",
          )}
        >
          {engaged ? <OctagonX className="size-4 shrink-0 text-neg" /> : <ShieldCheck className="size-4 shrink-0 text-pos" />}
          {!collapsed && (
            <div className="min-w-0">
              <div className="label text-fg-4">{real ? "Desk pause" : "Emergency stop"}</div>
              <div className={cx("text-xs font-medium", engaged ? "text-neg" : "text-fg-2")}>
                {real ? (engaged ? "Paused" : "Not paused") : engaged ? "Engaged · trading halted" : "Armed · trading active"}
              </div>
            </div>
          )}
        </Link>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cx("flex items-center gap-2 rounded-md text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg-2", collapsed ? "size-8 justify-center" : "mt-2 h-7 w-full px-2.5")}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && "Collapse"}
          </button>
        )}
      </div>
    </div>
  );
}
