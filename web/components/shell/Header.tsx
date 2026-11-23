"use client";

import { Bell, Keyboard, Menu, Pause, Play, Search, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar, Button, IconButton, Kbd, StatusDot, Segmented } from "@/components/ui/primitives";
import { Popover } from "@/components/ui/Overlay";
import { nightSession } from "@/lib/derive";
import { cx, fmtAgo, fmtTime } from "@/lib/format";
import { navFor } from "@/lib/nav";
import { useDesk, useNow } from "@/lib/store";
import type { Severity } from "@/lib/types";

/** PAPER / LIVE / DEMO. Driven only by the active data source and the server-reported engine mode. */
export function ModeBadge() {
  const { mode, status, sourceLabel, snap } = useDesk();
  const dm = snap?.meta.deskMode;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const cfg = {
    demo: { text: "Demo", cls: "border-warn/40 bg-warn/10 text-warn", dot: "bg-warn" },
    paper: { text: "Paper", cls: "border-accent/45 bg-accent/12 text-accent-2", dot: "bg-accent" },
    live: { text: "Live", cls: "border-neg/60 bg-neg text-white", dot: "bg-white animate-pulse-dot" },
    unknown: { text: "Mode unknown", cls: "border-line-2 bg-elevated text-fg-2", dot: "bg-fg-3" },
  }[mode];
  return (
    <div className="relative">
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Trading mode: ${cfg.text}`}
        className={cx("num flex h-7 items-center gap-2 rounded-md border px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors", cfg.cls)}
      >
        <span className={cx("size-1.5 rounded-full", cfg.dot)} />
        {cfg.text}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} className="w-[320px] p-4">
        <div className="label mb-2">Trading mode</div>
        {mode === "demo" ? (
          <p className="text-xs leading-5 text-fg-2">
            No trading engine is connected. Every figure on screen comes from the <span className="text-fg">{sourceLabel.toLowerCase()}</span> and no orders reach any market.
          </p>
        ) : (
          <p className="text-xs leading-5 text-fg-2">Reported by the desk via deskview. Mode is set in Settings.md and LIVE is refused until the acceptance gate passes. It is never changed from this interface.</p>
        )}
        {dm && (
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
            <div className="flex justify-between">
              <dt className="text-fg-3">Settings.md mode</dt>
              <dd className="num uppercase text-fg">{dm.settingsMode}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-fg-3">LIVE gate</dt>
              <dd className={dm.liveGate.passed ? "text-pos" : "text-warn"}>{dm.liveGate.passed ? "Passed" : `Not passed · ${dm.liveGate.failed.length} failing`}</dd>
            </div>
            {dm.paused && (
              <div className="flex justify-between gap-4">
                <dt className="text-fg-3">Desk</dt>
                <dd className="text-neg">Paused{dm.pausedReason ? ` · ${dm.pausedReason}` : ""}</dd>
              </div>
            )}
          </dl>
        )}
        <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
          <div className="flex justify-between">
            <dt className="text-fg-3">Data source</dt>
            <dd className="text-fg">{sourceLabel}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-fg-3">deskview</dt>
            <dd className="text-fg">{!status ? "Checking…" : !status.engine.configured ? "Not configured" : status.engine.reachable ? "Reachable" : "Unreachable"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-fg-3">Effective mode</dt>
            <dd className="num uppercase text-fg">{status?.tradingMode ?? "—"}</dd>
          </div>
        </dl>
      </Popover>
    </div>
  );
}

function HealthPill() {
  const { snap, status } = useDesk();
  if (!snap) return null;
  const degraded = snap.services.filter((s) => s.status === "degraded").length;
  const down = snap.services.filter((s) => s.status === "down").length;
  const tone = down ? "neg" : degraded ? "warn" : "pos";
  const text = down ? `${down} down` : degraded ? `${degraded} degraded` : "All systems normal";
  return (
    <Link href="/system" className="hidden h-7 items-center gap-2 rounded-md px-2 text-xs text-fg-2 transition-colors hover:bg-elevated hover:text-fg lg:flex" title={status?.database.configured ? `Database ${status.database.reachable ? "reachable" : "unreachable"}` : undefined}>
      <StatusDot tone={tone} pulse={tone !== "pos"} />
      {text}
    </Link>
  );
}

function SessionClock() {
  const now = useNow(1000);
  if (!now) return <div className="hidden h-7 w-[170px] xl:block" />;
  const s = nightSession(now);
  return (
    <div className="hidden items-center gap-2.5 border-l border-line pl-4 xl:flex" title={s.detail}>
      <div className="text-right leading-none">
        <div className="label text-[9.5px] text-fg-4">Session</div>
        <div className={cx("mt-1 text-xs font-medium", s.active ? "text-cyan" : "text-fg-2")}>{s.name}</div>
      </div>
      <div className="num text-[13px] text-fg">
        {fmtTime(now)} <span className="text-2xs text-fg-3">CT</span>
      </div>
    </div>
  );
}

const sevTone: Record<Severity, "accent" | "pos" | "warn" | "neg"> = { info: "accent", success: "pos", warning: "warn", critical: "neg" };

function Notifications() {
  const { snap, actions } = useDesk();
  const router = useRouter();
  const now = useNow(15000);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const ref = useRef<HTMLButtonElement>(null);
  if (!snap) return null;
  const unread = snap.notifications.filter((n) => !n.read).length;
  const list = snap.notifications.filter((n) => filter === "all" || !n.read).slice(0, 30);
  return (
    <div className="relative">
      <IconButton ref={ref} label={`Notifications${unread ? `, ${unread} unread` : ""}`} active={open} onClick={() => setOpen((o) => !o)}>
        <Bell className="size-4" strokeWidth={1.75} />
        {unread > 0 && <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-semibold text-white ring-2 ring-bg-2">{unread > 9 ? "9+" : unread}</span>}
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} className="w-[min(380px,calc(100vw-24px))] max-sm:fixed max-sm:right-3 max-sm:top-14">
        <div className="flex items-center gap-3 px-4 py-3 hairline-b">
          <div className="text-[13px] font-medium">Notifications</div>
          <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "unread", label: `Unread ${unread}` }]} label="Filter notifications" />
          <button type="button" className="ml-auto text-xs text-accent-2 hover:text-fg disabled:text-fg-4" disabled={!unread} onClick={() => actions.markNotificationsRead()}>
            Mark all read
          </button>
        </div>
        <ul className="max-h-[420px] overflow-y-auto">
          {list.length === 0 && <li className="px-4 py-10 text-center text-xs text-fg-3">You&apos;re all caught up.</li>}
          {list.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => {
                  actions.markNotificationsRead([n.id]);
                  setOpen(false);
                  if (n.href) router.push(n.href);
                }}
                className="flex w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-hover/60"
              >
                <StatusDot tone={sevTone[n.severity]} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className={cx("truncate text-[12.5px]", n.read ? "text-fg-2" : "font-medium text-fg")}>{n.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-fg-3">{n.detail}</div>
                </div>
                <div className="num shrink-0 text-2xs text-fg-4">{now ? fmtAgo(n.at, now) : ""}</div>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2.5 text-right">
          <Link href="/settings#notifications" onClick={() => setOpen(false)} className="text-xs text-fg-3 hover:text-fg-2">
            Notification settings
          </Link>
        </div>
      </Popover>
    </div>
  );
}

function UserMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { live, setLive, mode } = useDesk();
  return (
    <div className="relative">
      <button ref={ref} type="button" aria-label="User menu" onClick={() => setOpen((o) => !o)} className="flex items-center rounded-full transition-shadow hover:ring-2 hover:ring-line-2">
        <Avatar initials="OP" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} className="w-60 p-1.5">
        <div className="px-2.5 py-2">
          <div className="text-[12.5px] font-medium text-fg">Operator</div>
          <div className="text-xs text-fg-3">Local session · {mode === "demo" ? "demo" : mode} mode</div>
        </div>
        <div className="my-1 h-px bg-line" />
        <Link href="/settings" onClick={() => setOpen(false)} className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg">
          <Settings2 className="size-4 text-fg-3" /> Settings
        </Link>
        <button type="button" onClick={() => { setOpen(false); onShortcuts(); }} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg">
          <Keyboard className="size-4 text-fg-3" /> Keyboard shortcuts <span className="ml-auto"><Kbd>?</Kbd></span>
        </button>
        <button type="button" onClick={() => setLive(!live)} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg">
          {live ? <Pause className="size-4 text-fg-3" /> : <Play className="size-4 text-fg-3" />} {live ? "Pause live updates" : "Resume live updates"}
        </button>
      </Popover>
    </div>
  );
}

export function Header({ onMenu, onSearch, onShortcuts }: { onMenu: () => void; onSearch: () => void; onShortcuts: () => void }) {
  const pathname = usePathname();
  const item = navFor(pathname);
  const { live, setLive } = useDesk();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md sm:px-6">
      <IconButton label="Open navigation" onClick={onMenu} className="lg:hidden">
        <Menu className="size-4" />
      </IconButton>
      <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <span className="hidden text-fg-3 sm:inline">Overnight Desk</span>
        <span className="hidden text-fg-4 sm:inline">/</span>
        <span className="truncate font-medium text-fg">{item?.label ?? "Agent detail"}</span>
      </div>
      <button
        type="button"
        onClick={onSearch}
        className="ml-2 hidden h-8 w-full max-w-[300px] items-center gap-2 rounded-md border border-line bg-bg-2 px-2.5 text-[12.5px] text-fg-4 transition-colors hover:border-line-2 hover:text-fg-3 md:flex"
      >
        <Search className="size-3.5" />
        Search tokens, trades, pages…
        <span className="ml-auto flex gap-0.5">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <IconButton label="Search" onClick={onSearch} className="md:hidden">
          <Search className="size-4" />
        </IconButton>
        <ModeBadge />
        <HealthPill />
        <SessionClock />
        <div className="mx-1 hidden h-5 w-px bg-line-2 sm:block" />
        <Button size="sm" variant="ghost" onClick={() => setLive(!live)} aria-pressed={live} className="hidden sm:inline-flex" title={live ? "Pause live updates" : "Resume live updates"}>
          {live ? <StatusDot tone="cyan" pulse /> : <Pause className="size-3.5" />}
          <span className={live ? "text-cyan" : "text-fg-3"}>{live ? "Live" : "Paused"}</span>
        </Button>
        <Notifications />
        <UserMenu onShortcuts={onShortcuts} />
      </div>
    </header>
  );
}

