"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DataSource, DeskActions } from "./data/source";
import { DeskviewSource } from "./data/deskview";
import { DemoSource } from "./demo/simulator";
import type { DeskSnapshot, SystemStatus } from "./types";

export type DisplayMode = "demo" | "paper" | "live" | "unknown";

interface DeskContextValue {
  snap: DeskSnapshot | null;
  actions: DeskActions;
  status: SystemStatus | null;
  statusError: string | null;
  refreshStatus: () => void;
  mode: DisplayMode;
  sourceLabel: string;
  live: boolean;
  setLive: (on: boolean) => void;
  readOnly: boolean;
  source: DataSource;
}

const DeskContext = createContext<DeskContextValue | null>(null);

let demo: DataSource | null = null;
let deskview: DataSource | null = null;
function sourceFor(status: SystemStatus | null): DataSource | null {
  // The source follows what the SERVER says is configured. If deskview is configured but down, we stay on
  // deskview (showing the outage) rather than silently falling back to demo figures.
  if (!status) return null;
  if (status.dataSource === "deskview") return (deskview ??= new DeskviewSource());
  return (demo ??= new DemoSource());
}

const noopSubscribe = () => () => {};

const NULL_SOURCE: DataSource = {
  kind: "demo",
  label: "Connecting…",
  readOnly: true,
  getSnapshot: () => null,
  subscribe: noopSubscribe,
  setLive: () => {},
  actions: {
    closePosition: async () => ({ ok: false, message: "Not connected." }),
    setEmergencyStop: async () => ({ ok: false, message: "Not connected." }),
    acknowledgeAlert: async () => ({ ok: false, message: "Not connected." }),
    updateLimit: async () => ({ ok: false, message: "Not connected." }),
    setAgentEnabled: async () => ({ ok: false, message: "Not connected." }),
    markNotificationsRead: () => {},
    updateSettings: () => {},
  },
};

export function DeskProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [live, setLiveState] = useState(true);
  const [kind, setKind] = useState<SystemStatus["dataSource"] | null>(null);
  const source = (kind ? sourceFor({ dataSource: kind } as SystemStatus) : null) ?? NULL_SOURCE;
  const snap = useSyncExternalStore(source.subscribe, source.getSnapshot, () => null);

  const refreshStatus = useCallback(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((s: SystemStatus) => {
        setStatus(s);
        setKind((k) => k ?? s.dataSource); // the source is chosen once per page load
        setStatusError(null);
      })
      .catch((e: Error) => setStatusError(e.message));
  }, []);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 30_000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    source.setLive(live);
    return () => source.setLive(false);
  }, [live, source]);

  // DEMO for the simulator; otherwise whatever the desk itself reports. Never decided client-side.
  const mode: DisplayMode = source === NULL_SOURCE ? "unknown" : source.kind === "demo" ? "demo" : snap?.meta.deskMode?.effectiveMode ?? status?.tradingMode ?? "unknown";

  const value = useMemo<DeskContextValue>(
    () => ({ snap, actions: source.actions, status, statusError, refreshStatus, mode, sourceLabel: source.label, live, setLive: setLiveState, readOnly: source.readOnly, source }),
    [snap, source, status, statusError, refreshStatus, mode, live],
  );

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk() {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk must be used inside DeskProvider");
  return ctx;
}

/** Re-renders on an interval; used for relative timestamps and clocks. */
export function useNow(intervalMs = 1000) {
  // 0 on the server and during hydration, so server and client markup match.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
