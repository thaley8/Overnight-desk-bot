// Read-only data source backed by deskview (via this app's server-side proxy and SSE bridge).
// Nothing is invented: any figure deskview cannot supply is null or listed in meta.unavailable.

import type { ActionResult, CoinDetail, DataSource, DeskActions } from "./source";
import type {
  ActivityEvent, ActivityKind, Agent, AgentId, AgentStatus, DailyPoint, DeskMode, DeskSettings, DeskSnapshot, Incident, IntradayPoint,
  Notification, Position, RiskAlert, Service, Severity, Token, Trade, Verdict, WalletAsset,
} from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const BOTS: AgentId[] = ["scanner", "analyst", "brain", "executor", "risk"];
const READ_ONLY: ActionResult = {
  ok: false,
  message: "Read-only. Controls are not wired to the desk yet; use the Telegram commands.",
};
export const UNAVAILABLE = ["volume", "latency", "uptimeChecks", "resources", "providers", "apiErrors", "transfers", "limits", "priceChange", "agentConfig", "slippage"];

const t = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const frac = (v: unknown) => {
  const n = num(v);
  return n === null ? null : n > 1 ? n / 100 : n;
};

function eventKind(topic: string): { kind: ActivityKind; severity: Severity } {
  if (/\.(error)$|^fomo\.logged_out$/.test(topic)) return { kind: "api_error", severity: "critical" };
  if (/unverified$/.test(topic)) return { kind: "risk", severity: "critical" };
  if (topic === "risk.block") return { kind: "risk", severity: "warning" };
  if (topic === "executor.bought" || topic === "risk.sold") return { kind: "execution", severity: "success" };
  if (topic.startsWith("brain.") || topic === "risk.ok") return { kind: "decision", severity: "info" };
  if (topic.startsWith("analyst.") || topic === "scanner.pass" || topic === "scanner.kill") return { kind: "evaluation", severity: topic.endsWith("kill") || topic.endsWith("reject") ? "warning" : "info" };
  return { kind: "discovery", severity: "info" };
}

function describe(topic: string, p: Raw): { title: string; detail: string } {
  const sym = p?.symbol ?? (p?.mint ? String(p.mint).slice(0, 6) + "…" : "");
  const label: Record<string, string> = {
    "scanner.new_token": "New token", "scanner.migration": "Migration", "scanner.curve_complete": "Curve complete", "scanner.pass": "Scanner pass",
    "scanner.kill": "Killed by scanner", "scanner.wallet": "Smart wallet move", "analyst.pass": "Analyst pass", "analyst.reject": "Analyst reject",
    "brain.sized": "Sized by Brain", "brain.skip": "Skipped by Brain", "risk.ok": "Risk approved", "risk.block": "Blocked by Risk",
    "executor.bought": "Bought", "executor.skip": "Executor skipped", "executor.error": "Executor error", "executor.unverified": "Unverified fill",
    "risk.sold": "Sold by Risk", "risk.error": "Risk error", "risk.unverified": "Unverified sell", "fomo.logged_out": "FOMO logged out",
  };
  const title = `${label[topic] ?? topic}${sym ? ` · ${sym}` : ""}`;
  const bits = ["reason", "kill_rule", "rule", "score", "size_usd", "message", "error", "pnl", "price"]
    .filter((k) => p && p[k] !== undefined && p[k] !== null)
    .map((k) => `${k.replace("_", " ")} ${typeof p[k] === "number" ? +p[k].toFixed(6) : String(p[k])}`);
  return { title, detail: bits.join(" · ").slice(0, 240) || topic };
}

function verdictOf(status: string | null | undefined): Verdict {
  return ({ killed: "reject", passed: "pass", bought: "bought", skipped: "skipped", waiting: "waiting" } as Record<string, Verdict>)[status ?? ""] ?? "pending";
}

function flatten(obj: Raw | undefined, prefix = ""): { key: string; value: string }[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [{ key: prefix + k, value: Array.isArray(v) ? v.join(", ") : String(v) }],
  );
}

async function get(path: string): Promise<any> {
  const r = await fetch(`/api/desk/${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

export class DeskviewSource implements DataSource {
  readonly kind = "deskview" as const;
  readonly label = "deskview (read-only)";
  readonly readOnly = true;
  private raw: Raw = {};
  private events: Raw[] = [];
  private lastEventId = 0;
  private snap: DeskSnapshot | null = null;
  private listeners = new Set<() => void>();
  private es: EventSource | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRefetch = new Set<string>();
  private conn = { ok: false, error: null as string | null, lastFrameAt: null as number | null };
  private readIds = new Set<string>();
  private prefs: Pick<DeskSettings, "notify" | "display"> = {
    notify: { executions: true, riskAlerts: true, apiErrors: true, discoveries: false, sound: false },
    display: { compactTables: false, reduceMotion: false, currency: "USD" },
  };
  private started = false;

  getSnapshot = () => {
    if (!this.started && typeof window !== "undefined") {
      this.started = true;
      void this.loadAll();
    }
    return this.snap;
  };

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  setLive(on: boolean) {
    if (on && !this.es) {
      this.openStream();
      this.poll = setInterval(() => void this.loadAll(), 30_000);
    } else if (!on) {
      this.es?.close();
      this.es = null;
      if (this.poll) clearInterval(this.poll);
      this.poll = null;
    }
  }

  private openStream() {
    const es = new EventSource(`/api/desk/stream${this.lastEventId ? `?after_id=${this.lastEventId}` : ""}`);
    this.es = es;
    es.onmessage = (m) => {
      this.conn = { ok: true, error: null, lastFrameAt: Date.now() };
      try {
        this.onFrame(JSON.parse(m.data));
      } catch {}
    };
    const reconnect = () => {
      if (this.es !== es) return;
      es.close();
      this.es = null;
      this.conn = { ...this.conn, ok: false, error: "Live stream disconnected — retrying" };
      this.scheduleRebuild();
      setTimeout(() => {
        if (!this.es && this.poll) this.openStream();
      }, 3000);
    };
    es.addEventListener("closed", reconnect);
    es.onerror = reconnect;
  }

  private onFrame(f: { type: string; data: any }) {
    switch (f.type) {
      case "snapshot":
        Object.assign(this.raw, { mode: f.data.mode, balance: f.data.balance, agents: f.data.agents, health: f.data.health });
        break;
      case "event":
        this.addEvents([f.data]);
        break;
      case "trade":
        this.queue("trades", "positions", "balance");
        break;
      case "discovery":
        this.queue("discoveries");
        break;
      case "position":
        this.queue("positions");
        break;
      case "alert":
        this.queue("alerts");
        break;
      case "balance":
        this.raw.balance = f.data;
        break;
      case "mode":
        this.raw.mode = f.data;
        break;
      case "agent":
        this.raw.agents = f.data;
        break;
      case "health":
        this.raw.health = f.data;
        break;
      default:
        return;
    }
    this.scheduleRebuild();
  }

  private addEvents(rows: Raw[]) {
    const seen = new Set(this.events.map((e) => e.id));
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      this.events.push(r);
      this.lastEventId = Math.max(this.lastEventId, r.id);
    }
    this.events.sort((a, b) => a.id - b.id);
    if (this.events.length > 2000) this.events = this.events.slice(-2000);
  }

  private queue(...paths: string[]) {
    paths.forEach((p) => this.pendingRefetch.add(p));
    if (this.refetchTimer) return;
    this.refetchTimer = setTimeout(async () => {
      this.refetchTimer = null;
      const ps = [...this.pendingRefetch];
      this.pendingRefetch.clear();
      await Promise.all(ps.map(async (p) => {
        try {
          this.raw[p] = await get(p);
        } catch {}
      }));
      this.scheduleRebuild();
    }, 800);
  }

  private async loadAll() {
    const paths = ["mode", "balance", "positions", "trades?limit=500", "discoveries", "agents", "alerts", "health", "history/nights", "settings", "series", "pushes", "wallets"];
    const results = await Promise.allSettled([...paths.map(get), get(`events?limit=500${this.lastEventId ? `&after_id=${this.lastEventId}` : ""}`)]);
    let failures = 0;
    paths.forEach((p, i) => {
      const r = results[i];
      if (r.status === "fulfilled") this.raw[p.split("?")[0]] = r.value;
      else failures++;
    });
    const ev = results[paths.length];
    if (ev.status === "fulfilled") this.addEvents(ev.value);
    if (failures === paths.length) this.conn = { ok: false, error: "deskview unreachable", lastFrameAt: this.conn.lastFrameAt };
    else if (!this.es) this.conn = { ...this.conn, ok: true, error: failures ? `${failures} endpoint(s) failed` : null };
    this.rebuild();
  }

  private scheduleRebuild() {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, 250);
  }

  private rebuild() {
    this.snap = this.build();
    this.listeners.forEach((l) => l());
  }

  async fetchCoin(mint: string): Promise<CoinDetail | null> {
    try {
      const c = await get(`coins/${encodeURIComponent(mint)}`);
      return {
        noteMd: c.note_md ?? null,
        holders: (c.holders_series ?? []).map((h: Raw) => ({ at: t(h.at), holders: h.holders })).filter((h: { at: number }) => !Number.isNaN(h.at)),
        events: (c.events ?? []).map((e: Raw) => ({ id: e.id, topic: e.topic, at: t(e.at) })),
      };
    } catch {
      return null;
    }
  }

  actions: DeskActions = {
    closePosition: async () => READ_ONLY,
    setEmergencyStop: async () => READ_ONLY,
    acknowledgeAlert: async () => READ_ONLY,
    updateLimit: async () => READ_ONLY,
    setAgentEnabled: async () => READ_ONLY,
    markNotificationsRead: (ids) => {
      for (const n of this.snap?.notifications ?? []) if (!ids || ids.includes(n.id)) this.readIds.add(n.id);
      this.rebuild();
    },
    updateSettings: (patch) => {
      this.prefs = { notify: { ...this.prefs.notify, ...patch.notify }, display: { ...this.prefs.display, ...patch.display } };
      this.rebuild();
    },
  };

  // ── mapping ──────────────────────────────────────────────────────────
  private build(): DeskSnapshot {
    const r = this.raw;
    const now = Date.now();
    const mode: DeskMode | null = r.mode
      ? {
          settingsMode: r.mode.settings_mode,
          effectiveMode: r.mode.effective_mode === "live" ? "live" : "paper",
          liveGate: { passed: !!r.mode.live_gate?.passed, reason: r.mode.live_gate?.reason ?? null, at: r.mode.live_gate?.at ?? null, tests: r.mode.live_gate?.tests ?? 0, failed: r.mode.live_gate?.failed ?? [], blocked: r.mode.live_gate?.blocked ?? [] },
          paused: !!r.mode.paused,
          pausedReason: r.mode.paused_reason ?? null,
          botsPaused: r.mode.bots_paused ?? [],
        }
      : null;
    const paper = r.balance?.paper ?? {};
    const chain = r.balance?.chain ?? null;

    const activity: ActivityEvent[] = this.events
      .slice()
      .reverse()
      .map((e): ActivityEvent => {
        const { kind, severity } = eventKind(e.topic);
        const { title, detail } = describe(e.topic, e.payload ?? {});
        const bot = e.topic.split(".")[0];
        const mint = e.payload?.mint;
        return {
          id: `evt_${e.id}`, at: t(e.at), kind, severity, title, detail,
          agent: (BOTS as string[]).includes(bot) ? (bot as AgentId) : "system",
          ref: mint ? { type: "token" as const, id: String(mint) } : undefined,
        };
      })
      .filter((e) => !Number.isNaN(e.at));

    const positions: Position[] = (r.positions ?? [])
      .filter((p: Raw) => p.status == null || p.status === "open")
      .map((p: Raw) => {
        const qty = num(p.qty) ?? 0;
        const entry = num(p.avg_price) ?? (qty && num(p.usd_in) ? p.usd_in / qty : 0);
        const stopPct = frac(p.stop_pct);
        return {
          id: p.mint, tokenId: p.mint, symbol: p.symbol ?? String(p.mint).slice(0, 6), name: p.source === "paper" ? "Paper position" : "FOMO position",
          openedAt: t(p.opened_at) || now, entry, mark: num(p.mark), qty, stop: stopPct !== null && entry ? entry * (1 - stopPct) : null, target: null,
          confidence: null, thesis: p.trail_pct != null ? `Trailing stop ${(frac(p.trail_pct)! * 100).toFixed(0)}% from peak ${p.peak_price ?? "—"}` : "",
          txHash: null, spark: [], source: p.source, fomoUrl: p.fomo_url ?? null,
        };
      });

    const trades: Trade[] = (r.trades ?? []).map((x: Raw) => ({
      id: x.id, at: t(x.at) || 0, symbol: x.symbol ?? "—", side: x.side === "sell" ? "sell" : "buy", status: "filled", price: num(x.price), qty: null,
      notional: num(x.size_usd), fee: null, slippageBps: null, latencyMs: null, pnl: num(x.pnl), txHash: null, verified: null,
      reason: x.reason ?? (x.source === "vault" ? "From vault trade note" : "From desk.db"), decisionId: x.notes_path ?? "—", notesPath: x.notes_path ?? null,
    }));
    const sells = trades.filter((x) => x.pnl !== null);

    const tokens: Token[] = (r.discoveries ?? []).map((c: Raw) => ({
      id: c.mint, symbol: c.symbol ?? String(c.mint).slice(0, 6), name: c.name ?? "", chain: "Solana", address: c.mint,
      discoveredAt: t(c.first_seen) || t(c.updated_at) || now, price: num(c.price), change5m: null, change1h: null, change24h: null,
      liquidity: num(c.liquidity), volume24h: null, marketCap: num(c.cap_usd), holders: num(c.holders), topHolderPct: frac(c.top10), score: num(c.score),
      verdict: verdictOf(c.status), confidence: null, flags: c.kill_rule ? [String(c.kill_rule)] : [],
      notes: [c.bull && `Bull: ${c.bull}`, c.bear && `Bear: ${c.bear}`, c.layers && `Layers: ${c.layers}`].filter(Boolean).join("\n") || null,
      spark: [], killRule: c.kill_rule ?? null, fomoUrl: c.fomo_url ?? null, notesPath: c.notes_path ?? null,
    }));

    const nightStart = Date.parse(`${paper.night_id ?? ""}T22:00:00-06:00`) || now - 12 * 3600_000;
    const agents: Agent[] = (r.agents ?? []).map((a: Raw) => {
      const id = a.name as AgentId;
      const evs = activity.filter((e) => e.agent === id);
      const status: AgentStatus = ({ running: "running", paused: "paused", stale: "degraded", stopped: "stopped" } as Record<string, AgentStatus>)[a.state] ?? "idle";
      const tasks = evs.slice(0, 60).map((e) => ({ id: e.id, label: e.title, at: e.at, durationMs: null, ok: e.severity !== "critical" }));
      const buckets = Array.from({ length: 48 }, () => 0);
      for (const e of evs) {
        const i = 47 - Math.floor((now - e.at) / 1_800_000);
        if (i >= 0 && i < 48) buckets[i]++;
      }
      const c = a.counts ?? {};
      const errs = evs.filter((e) => e.severity === "critical" && e.at >= nightStart).length;
      const last = a.last_event;
      return {
        id, name: id[0].toUpperCase() + id.slice(1), role: ROLES[id], status, enabled: !(mode?.botsPaused ?? []).includes(id),
        activity: status === "stopped" ? "Desk not running" : last ? `Last: ${last.topic}` : "No events yet",
        lastTask: tasks[0] ?? { id: `${id}_none`, label: last?.topic ?? "—", at: t(last?.at) || 0, durationMs: null, ok: true },
        opsToday: c.in ?? 0, opsTotal: evs.length, errors24h: errs, lastError: evs.find((e) => e.severity === "critical") ? { at: evs.find((e) => e.severity === "critical")!.at, message: evs.find((e) => e.severity === "critical")!.title } : null,
        latencyP50: null, latencyP95: null, successRate: (c.pass ?? 0) + (c.reject ?? 0) ? (c.pass ?? 0) / ((c.pass ?? 0) + (c.reject ?? 0)) : null, uptimePct: null,
        metrics: [{ label: "In tonight", value: String(c.in ?? 0) }, { label: "Passed", value: String(c.pass ?? 0) }, { label: "Rejected", value: String(c.reject ?? 0) }],
        throughput: buckets, latency: [], tasks,
        config: flatten(r.settings?.[id]).map((x) => ({ key: x.key, value: x.value })),
      };
    });

    const alerts: RiskAlert[] = (r.alerts ?? []).map((a: Raw) => ({
      id: a.id, at: t(a.at) || now, severity: a.level === "crit" ? "critical" : a.level === "warn" ? "warning" : "info",
      title: `${a.kind}${a.symbol ? ` · ${a.symbol}` : ""}`, detail: a.message ?? "", acknowledged: false,
    }));

    const daily: DailyPoint[] = (r["history/nights"] ?? [])
      .map((n: Raw) => ({ t: Date.parse(`${n.night_id}T22:00:00-06:00`), equity: num(n.balance) ?? NaN, pnl: num(n.pnl) ?? 0, volume: 0, trades: Number(n.trades) || 0, wins: Number(n.wins) || 0 }))
      .filter((d: DailyPoint) => !Number.isNaN(d.t) && !Number.isNaN(d.equity));
    const intraday: IntradayPoint[] = (r.series ?? [])
      .filter((p: Raw) => num(p.paper_equity) !== null && p.t * 1000 > now - 86_400_000)
      .map((p: Raw) => ({ t: p.t * 1000, equity: p.paper_equity }));

    const assets: WalletAsset[] = chain && !chain.error?.startsWith("disabled")
      ? [
          ...(num(chain.sol) !== null ? [{ symbol: "SOL", name: "Solana", balance: chain.sol, price: num(chain.sol_usd) ?? 0, change24h: NaN, kind: "native" as const }] : []),
          ...(num(chain.usdc) !== null ? [{ symbol: "USDC", name: "USD Coin", balance: chain.usdc, price: 1, change24h: NaN, kind: "stable" as const }] : []),
          ...(chain.holdings ?? []).map((h: Raw) => ({ symbol: tokens.find((x) => x.address === h.mint)?.symbol ?? String(h.mint).slice(0, 6), name: h.mint, balance: h.qty, price: num(h.price_usd) ?? 0, change24h: NaN, kind: "token" as const })),
        ]
      : [];

    const h = r.health ?? {};
    const inNight = !!h.in_night_window;
    const services: Service[] = r.health
      ? [
          { id: "desk", name: "desk.py · 5 bot threads", kind: "Process", region: "local", status: h.desk?.running ? "operational" : inNight ? "down" : "idle", uptimePct: null, latencyMs: null, checks: [], detail: h.desk?.running ? `pid ${h.desk.pids.join(", ")} · log ${Math.round(h.desk.log_age_s ?? 0)}s old` : inNight ? "Not running inside the night window" : "Idle outside the night window" },
          { id: "telegram", name: "Telegram poller", kind: "Process", region: "local", status: h.telegram_poller?.running ? "operational" : "down", uptimePct: null, latencyMs: null, checks: [], detail: h.telegram_poller?.running ? `pid ${h.telegram_poller.pids.join(", ")}` : "Not running" },
          { id: "cdp", name: "Desk Chrome (CDP port)", kind: "Browser", region: "127.0.0.1:9222", status: h.cdp_listening ? "operational" : inNight ? "down" : "idle", uptimePct: null, latencyMs: null, checks: [], detail: "Port checked without connecting" },
          ...BOTS.map((b) => ({ id: `hb_${b}`, name: `${b[0].toUpperCase() + b.slice(1)} heartbeat`, kind: "Heartbeat", region: "data/heartbeats", status: (h.heartbeats?.[b] ? "operational" : "idle") as Service["status"], uptimePct: null, latencyMs: null, checks: [], detail: h.heartbeats?.[b] ? `Last ${new Date(h.heartbeats[b]).toLocaleTimeString("en-GB", { timeZone: "America/Chicago" })} CT` : "No heartbeat file (desk predates heartbeats?)" })),
        ]
      : [];
    const incidents: Incident[] = (h.problems ?? []).map((p: string, i: number) => ({ id: `prob_${i}`, at: t(h.as_of) || now, resolvedAt: null, title: p, service: "Desk health", severity: "warning", summary: "Reported by desk health checks / deskview." }));

    const notifications: Notification[] = [
      ...alerts.filter((a) => a.severity !== "info").map((a) => ({ id: `n_${a.id}`, at: a.at, severity: a.severity, title: a.title, detail: a.detail, read: false, href: "/risk" })),
      ...(r.pushes ?? []).filter((p: Raw) => !p.dry_run).slice(0, 20).map((p: Raw, i: number) => ({ id: `push_${i}_${String(p.text).slice(0, 20)}`, at: now, severity: "info" as const, title: "Telegram push", detail: String(p.text ?? ""), read: false })),
    ].map((n) => ({ ...n, read: this.readIds.has(n.id) }));

    const equity = num(paper.equity);
    const unrealKnown = positions.every((p) => p.mark !== null);
    return {
      meta: {
        source: "deskview",
        readOnly: true,
        unavailable: UNAVAILABLE,
        timezone: "America/Chicago",
        connection: this.conn,
        deskMode: mode,
        bookLabel: mode?.effectiveMode === "live" ? "Book equity (live)" : "Paper equity · tonight",
        notes: [
          ...(paper.stale_file ? [`paper_state.json is from night ${paper.file_night_id}; showing a fresh night at start cash.`] : []),
          ...(daily.length < 2 ? [`${daily.length} night${daily.length === 1 ? "" : "s"} of history recorded so far.`] : []),
          ...(paper.positions_at_cost ? [`Paper equity values ${paper.positions_at_cost} position${paper.positions_at_cost === 1 ? "" : "s"} at cost (no live mark).`] : []),
        ],
      },
      book: {
        equity, realized: num(paper.realized_pnl), unrealized: unrealKnown ? positions.reduce((a, p) => a + (p.mark! - p.entry) * p.qty, 0) : null,
        dayPnl: equity !== null && num(paper.start_cash) !== null ? equity - paper.start_cash : null, dayPct: num(paper.loss_pct) !== null ? -paper.loss_pct : null,
        startCash: num(paper.start_cash), totalTrades: trades.length, winRate: sells.length ? sells.filter((x) => (x.pnl ?? 0) > 0).length / sells.length : null,
        staleFile: !!paper.stale_file, nightId: paper.night_id ?? null,
      },
      riskSettings: flatten(r.settings?.risk),
      degradedLayers: h.degraded_layers ?? [],
      chain: chain ? { address: chain.address ?? null, totalUsd: num(chain.total_usd), asOf: chain.as_of ?? null, error: chain.error ?? null } : null,
      generatedAt: now,
      startingCapital: num(paper.start_cash) ?? 0,
      cash: num(paper.cash) ?? 0,
      realizedTotal: num(paper.realized_pnl) ?? 0,
      agents, tokens, positions, trades, activity, daily, intraday,
      limits: [],
      alerts,
      emergencyStop: { engaged: !!mode?.paused, at: null, by: mode?.paused ? "desk" : null, reason: mode?.pausedReason ?? null },
      assets,
      addresses: chain?.address ? [{ label: "FOMO wallet (public address)", address: chain.address, role: "trading", balanceUsd: num(chain.total_usd) ?? 0 }] : [],
      transfers: [], services, incidents, resources: [], providers: [], apiErrors: [], notifications,
      settings: { agentsEnabled: Object.fromEntries(BOTS.map((b) => [b, !(mode?.botsPaused ?? []).includes(b)])) as Record<AgentId, boolean>, ...this.prefs },
    };
  }
}

const ROLES: Record<AgentId, string> = {
  scanner: "PumpPortal migrations + new tokens, FOMO/DexScreener/RugCheck filters, smart wallets",
  analyst: "Judges scanner passes (layers, bull/bear case)",
  brain: "Sizes from paper cash or skips",
  executor: "Buys through the click lane with 3-way verify",
  risk: "Night limits, Telegram requests, guards open positions",
};
