"use client";

import { FlaskConical, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Overlay";
import { Button, Kbd, Skeleton } from "@/components/ui/primitives";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/format";
import { useDesk } from "@/lib/store";
import { CommandPalette } from "./CommandPalette";
import { Header } from "./Header";
import { SidebarContent } from "./Sidebar";

const COLLAPSE_KEY = "od.sidebar.collapsed";
const collapseSubs = new Set<() => void>();
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeCollapsed(cb: () => void) {
  collapseSubs.add(cb);
  return () => {
    collapseSubs.delete(cb);
  };
}
function toggleCollapsed() {
  try {
    localStorage.setItem(COLLAPSE_KEY, readCollapsed() ? "0" : "1");
  } catch {}
  collapseSubs.forEach((f) => f());
}

function DemoBanner() {
  const { mode } = useDesk();
  if (mode !== "demo") return null;
  return (
    <div className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-warn/20 bg-warn/[0.07] px-4 text-xs text-warn">
      <FlaskConical className="size-3.5 shrink-0" />
      <span className="truncate">
        <span className="font-medium">Demo data.</span>
        <span className="text-warn/80"> No trading engine is connected — every figure is simulated and no orders reach a market.</span>
      </span>
    </div>
  );
}

/** deskview mode: always say it is read-only, and say loudly when the feed is down or a file is stale. */
function DeskviewBanner() {
  const { snap, mode } = useDesk();
  if (!snap || snap.meta.source !== "deskview") return null;
  const c = snap.meta.connection;
  const notes = snap.meta.notes;
  if (!c.ok) {
    return (
      <div role="alert" className="flex min-h-8 shrink-0 items-center justify-center gap-2 border-b border-neg/30 bg-neg/10 px-4 py-1.5 text-xs text-neg">
        <span className="font-medium">deskview unreachable.</span>
        <span className="text-neg/80">{c.error ?? "No data"} · figures below may be stale or missing.</span>
      </div>
    );
  }
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 border-b border-line bg-bg-2 px-4 py-1.5 text-xs text-fg-3">
      <span>
        <span className={mode === "live" ? "font-medium text-neg" : "font-medium text-fg-2"}>{mode === "live" ? "LIVE desk" : "Paper desk"}</span> · read-only view via deskview
      </span>
      {notes.map((n) => (
        <span key={n} className="text-warn/90">· {n}</span>
      ))}
    </div>
  );
}

/** Raises toasts for new warning/critical notifications. */
function NotificationToaster() {
  const { snap } = useDesk();
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!snap) return;
    if (!seen.current) {
      seen.current = new Set(snap.notifications.map((n) => n.id));
      return;
    }
    for (const n of snap.notifications) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (!n.read && (n.severity === "critical" || n.severity === "warning")) toast({ tone: n.severity, title: n.title, detail: n.detail });
    }
  }, [snap, toast]);
  return null;
}

function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="mt-4 h-[340px]" />
    </div>
  );
}

const SHORTCUTS: [string[], string][] = [
  [["⌘", "K"], "Open search"],
  [["/"], "Open search"],
  [["?"], "Show shortcuts"],
  [["Esc"], "Close dialogs, drawers and menus"],
  [["←", "→"], "Move chart crosshair (when chart focused)"],
];

export function AppShell({ children }: { children: ReactNode }) {
  const { snap } = useDesk();
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  // The drawer is tied to the path it was opened on, so navigating closes it.
  const [mobilePath, setMobilePath] = useState<string | null>(null);
  const mobileOpen = mobilePath === pathname;
  const setMobileOpen = (open: boolean) => setMobilePath(open ? pathname : null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (!typing && e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (!typing && e.key === "?") {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const reduceMotion = snap?.settings.display.reduceMotion;

  return (
    <ToastProvider>
      <div className={cx("flex min-h-screen", reduceMotion && "reduce-motion")}>
        <aside className={cx("sticky top-0 hidden h-screen shrink-0 border-r border-line bg-bg-2 transition-[width] duration-200 lg:block", collapsed ? "w-16" : "w-[232px]")}>
          <SidebarContent collapsed={collapsed} onToggle={toggleCollapsed} />
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-[#03070f]/70" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[264px] animate-fade-in border-r border-line-2 bg-bg-2 shadow-pop">
              <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute right-3 top-3.5 rounded-md p-1.5 text-fg-3 hover:bg-elevated hover:text-fg">
                <X className="size-4" />
              </button>
              <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <DemoBanner />
          <DeskviewBanner />
          <Header onMenu={() => setMobileOpen(true)} onSearch={() => setPaletteOpen(true)} onShortcuts={() => setShortcutsOpen(true)} />
          <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 pb-16 pt-7 sm:px-6 xl:px-8">{snap ? children : <PageSkeleton />}</main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" footer={<Button onClick={() => setShortcutsOpen(false)}>Done</Button>}>
        <ul className="divide-y divide-line">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={label + keys.join()} className="flex items-center justify-between py-2.5">
              <span>{label}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
      <NotificationToaster />
    </ToastProvider>
  );
}
