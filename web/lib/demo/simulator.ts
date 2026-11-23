// DEMO SIMULATOR — produces simulated live updates for the demo data source.
// No network calls, no keys, no real orders. Replace with an engine adapter for PAPER/LIVE.

import type { ActionResult, DataSource, DeskActions } from "../data/source";
import { LIMIT_CEILINGS } from "../data/source";
import type { ActivityEvent, AgentId, DeskSnapshot, Notification, Position, Trade } from "../types";
import { AGENT_ORDER, generateSnapshot, makeToken, randomEvent, TOKEN_NAMES } from "./generate";
import { b58, chance, gauss, int, mulberry32, pick, range, type Rng } from "./random";

const TICK_MS = 2500;
const FIVE_MIN = 5 * 60_000;

const ACTIVITY_TEXT: Record<AgentId, (s: DeskSnapshot, r: Rng) => string> = {
  scanner: (_s, r) => `Scanning ${int(r, 3, 4)} venues · ${int(r, 1180, 1420).toLocaleString("en-US")} pairs/hr`,
  analyst: (s, r) => `Evaluating ${pick(r, s.tokens.slice(0, 8)).symbol} — ${pick(r, ["holder distribution", "contract safety", "liquidity depth", "volume quality"])}`,
  brain: (s, r) => (chance(r, 0.5) ? "Awaiting next candidate" : `Sizing ${pick(r, s.tokens.slice(0, 6)).symbol} · Kelly × 0.25`),
  executor: (s, r) => (s.positions.length && chance(r, 0.6) ? `Verifying settlement for ${pick(r, s.positions).symbol}` : "Idle · route cache warm"),
  risk: (s) => `Monitoring ${s.positions.length} positions · ${s.limits.filter((l) => l.used / l.limit >= 1).length} breaches`,
};

export class DemoSource implements DataSource {
  readonly kind = "demo" as const;
  readonly label = "Demo simulator";
  readonly readOnly = false;
  private snap: DeskSnapshot | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private r: Rng = mulberry32(Date.now() % 100000);

  getSnapshot = () => {
    if (!this.snap && typeof window !== "undefined") this.snap = restoreControls(generateSnapshot(7, Date.now()));
    return this.snap;
  };

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  setLive(on: boolean) {
    if (on && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private commit(next: DeskSnapshot) {
    if (!this.snap || next.emergencyStop !== this.snap.emergencyStop || next.limits !== this.snap.limits || next.settings !== this.snap.settings) saveControls(next);
    this.snap = next;
    this.listeners.forEach((l) => l());
  }

  private notify(s: DeskSnapshot, n: Omit<Notification, "id" | "read">) {
    s.notifications = [{ ...n, id: `n_${n.at.toString(36)}_${Math.floor(this.r() * 1e6)}`, read: false }, ...s.notifications].slice(0, 60);
  }

  private pushEvent(s: DeskSnapshot, e: ActivityEvent) {
    s.activity = [e, ...s.activity].slice(0, 300);
    const n = s.settings.notify;
    if (e.kind === "risk" && n.riskAlerts) this.notify(s, { at: e.at, severity: "warning", title: e.title, detail: e.detail, href: "/risk" });
    if (e.kind === "api_error" && n.apiErrors) this.notify(s, { at: e.at, severity: "critical", title: e.title, detail: e.detail, href: "/api-monitor" });
    if (e.kind === "execution" && n.executions) this.notify(s, { at: e.at, severity: "success", title: e.title, detail: e.detail, href: "/trades" });
    if (e.kind === "discovery" && n.discoveries) this.notify(s, { at: e.at, severity: "info", title: e.title, detail: e.detail, href: "/scanner" });
  }

  private agentActive(s: DeskSnapshot, id: AgentId) {
    if (!s.settings.agentsEnabled[id]) return false;
    if (s.emergencyStop.engaged && (id === "brain" || id === "executor")) return false;
    return true;
  }

  private tick() {
    const cur = this.snap;
    if (!cur) return;
    const r = this.r;
    const now = Date.now();
    const s: DeskSnapshot = { ...cur, generatedAt: now };

    // Prices
    s.positions = cur.positions.map((p) => {
      const mark = Math.max(p.entry * 0.2, p.mark! * (1 + gauss(r) * 0.006 + 0.0004));
      return { ...p, mark, spark: [...p.spark.slice(1), mark] };
    });
    const held = new Map(s.positions.map((p) => [p.tokenId, p.mark]));
    s.tokens = cur.tokens.map((t, i) => {
      if (i > 16 && !held.has(t.id)) return t;
      const price = held.get(t.id) ?? t.price! * (1 + gauss(r) * 0.008);
      return { ...t, price, change5m: t.change5m! * 0.9 + (price / t.price! - 1), spark: [...t.spark.slice(1), price] };
    });

    // Equity
    const unreal = s.positions.reduce((a, p) => a + (p.mark! - p.entry) * p.qty, 0);
    const cost = s.positions.reduce((a, p) => a + p.entry * p.qty, 0);
    const equity = s.cash + cost + unreal;
    const lastI = cur.intraday[cur.intraday.length - 1];
    s.intraday = now - lastI.t >= FIVE_MIN ? [...cur.intraday.slice(1), { t: now, equity }] : [...cur.intraday.slice(0, -1), { t: lastI.t, equity }];
    const d = cur.daily;
    const prevEq = d[d.length - 2].equity;
    s.daily = [...d.slice(0, -1), { ...d[d.length - 1], equity, pnl: equity - prevEq }];

    // Agents
    s.agents = cur.agents.map((a) => {
      const active = this.agentActive(s, a.id);
      if (!active) return { ...a, status: "paused", activity: s.settings.agentsEnabled[a.id] ? "Halted by emergency stop" : "Disabled by operator" };
      const inc = { scanner: int(r, 8, 30), analyst: int(r, 0, 3), brain: int(r, 0, 1), executor: chance(r, 0.15) ? 1 : 0, risk: int(r, 4, 12) }[a.id];
      const throughput = [...a.throughput];
      throughput[throughput.length - 1] += inc;
      const latency = [...a.latency.slice(1), Math.max(10, a.latencyP50! * (1 + gauss(r) * 0.12))];
      const status = a.id === "analyst" ? "degraded" : a.id === "brain" && chance(r, 0.4) ? "idle" : "running";
      let lastTask = a.lastTask;
      let tasks = a.tasks;
      if (inc > 0 && chance(r, 0.5)) {
        lastTask = { ...a.tasks[int(r, 0, 5)], id: `task_${a.id}_${now}`, at: now - int(r, 100, 1500), ok: chance(r, 0.97) };
        tasks = [lastTask, ...a.tasks].slice(0, 60);
      }
      return { ...a, status, activity: ACTIVITY_TEXT[a.id](s, r), opsToday: a.opsToday + inc, opsTotal: a.opsTotal + inc, throughput, latency, lastTask, tasks };
    });

    // Events
    if (this.agentActive(s, "scanner") && chance(r, 0.3)) {
      const tok = makeToken(r, now, int(r, 0, TOKEN_NAMES.length - 1), 60_000);
      tok.id = `${tok.id}_${now}`;
      tok.verdict = "pending";
      tok.confidence = null;
      tok.notes = null;
      s.tokens = [tok, ...s.tokens].slice(0, 120);
      this.pushEvent(s, { id: `evt_${now}_d`, at: now, kind: "discovery", agent: "scanner", severity: "info", title: `New pair discovered · ${tok.symbol}`, detail: `${tok.chain} · liquidity $${Math.round(tok.liquidity! / 1000)}k · score ${tok.score}`, ref: { type: "token", id: tok.id } });
    }
    if (this.agentActive(s, "analyst") && chance(r, 0.28)) {
      const idx = s.tokens.findIndex((t) => t.verdict === "pending");
      if (idx >= 0) {
        const t = s.tokens[idx];
        const verdict = t.score! > 75 ? "buy" : t.score! > 50 ? "watch" : "reject";
        const ev = { ...t, verdict, confidence: range(r, 0.45, 0.93), notes: verdict === "buy" ? "Liquidity and holder distribution within thresholds; momentum confirmed." : verdict === "watch" ? "Acceptable contract; liquidity thin for target size. Re-check in 30m." : "Fails holder-concentration threshold." } as const;
        s.tokens = s.tokens.map((x, i) => (i === idx ? { ...ev } : x));
        this.pushEvent(s, { id: `evt_${now}_e`, at: now, kind: "evaluation", agent: "analyst", severity: verdict === "reject" ? "warning" : "info", title: `${t.symbol} evaluated → ${verdict.toUpperCase()}`, detail: ev.notes, ref: { type: "token", id: t.id } });
      }
    }
    if (this.agentActive(s, "brain") && chance(r, 0.1)) {
      const e = randomEvent(r, now, s.tokens.slice(0, 20));
      if (e.kind === "decision") this.pushEvent(s, e);
    }
    if (chance(r, 0.04)) {
      const e = randomEvent(r, now, s.tokens.slice(0, 20));
      if (e.kind === "api_error") {
        this.pushEvent(s, e);
        s.apiErrors = [{ id: `apierr_${now}`, at: now, provider: e.title.split(" · ")[0], code: e.title.includes("429") ? 429 : e.title.includes("503") ? 503 : "TIMEOUT", endpoint: "—", message: e.title.split(" · ")[1] ?? "", retried: true }, ...s.apiErrors].slice(0, 200);
      }
    }

    // Protective exits: stops & targets are handled by Risk + Executor when allowed.
    for (const p of s.positions) {
      if (p.closing) continue;
      const hitStop = p.mark! <= p.stop!;
      const hitTarget = p.mark! >= p.target!;
      if ((hitStop || hitTarget) && this.agentActive(s, "executor") && this.agentActive(s, "risk")) {
        this.settleClose(s, p, hitStop ? "Stop-loss triggered by Risk" : "Take-profit target reached", now);
      }
    }

    // Provider latency drift
    s.providers = cur.providers.map((p) => ({ ...p, latency: [...p.latency.slice(1), Math.max(1, p.p50 * (1 + gauss(r) * 0.15))], rpm: Math.max(1, Math.round(p.rpm * (1 + gauss(r) * 0.03))) }));
    s.resources = [...cur.resources.slice(1), { t: now, cpu: clamp(cur.resources.at(-1)!.cpu + gauss(r) * 3, 8, 95), mem: clamp(cur.resources.at(-1)!.mem + gauss(r), 30, 92), queue: Math.max(0, Math.round(cur.resources.at(-1)!.queue + gauss(r) * 2)) }];

    this.commit(s);
  }

  /** Closes a position and books a verified sell. Mutates `s` (a fresh copy). */
  private settleClose(s: DeskSnapshot, p: Position, reason: string, now: number) {
    const proceeds = p.mark! * p.qty;
    const fee = proceeds * 0.0025;
    const pnl = proceeds - p.entry * p.qty - fee;
    const trade: Trade = {
      id: `trd_${now.toString(36)}`,
      at: now,
      symbol: p.symbol,
      side: "sell",
      status: "filled",
      price: p.mark,
      qty: p.qty,
      notional: proceeds,
      fee,
      slippageBps: int(this.r, 10, 60),
      latencyMs: range(this.r, 700, 2400),
      pnl,
      txHash: b58(this.r, 88),
      verified: true,
      reason,
      decisionId: `dec_${now.toString(16)}`,
    };
    s.trades = [trade, ...s.trades];
    s.positions = s.positions.filter((x) => x.id !== p.id);
    s.cash += proceeds - fee;
    s.realizedTotal += pnl;
    const d = s.daily;
    s.daily = [...d.slice(0, -1), { ...d[d.length - 1], trades: d[d.length - 1].trades + 1, wins: d[d.length - 1].wins + (pnl > 0 ? 1 : 0), volume: d[d.length - 1].volume + proceeds }];
    this.pushEvent(s, { id: `evt_${now}_x_${p.id}`, at: now, kind: "execution", agent: "executor", severity: "success", title: `Sold ${p.symbol} · settlement verified`, detail: `${reason} · realised ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`, ref: { type: "trade", id: trade.id } });
  }

  private update(fn: (s: DeskSnapshot) => void) {
    const cur = this.getSnapshot();
    if (!cur) return;
    const s = { ...cur };
    fn(s);
    this.commit(s);
  }

  actions: DeskActions = {
    closePosition: (id) =>
      new Promise<ActionResult>((resolve) => {
        const cur = this.getSnapshot();
        const p = cur?.positions.find((x) => x.id === id);
        if (!cur || !p) return resolve({ ok: false, message: "Position not found." });
        if (p.closing) return resolve({ ok: false, message: "A close request is already pending." });
        if (!cur.settings.agentsEnabled.executor) return resolve({ ok: false, message: "Executor is disabled. Enable it to route the order." });
        this.update((s) => {
          s.positions = s.positions.map((x) => (x.id === id ? { ...x, closing: true } : x));
          this.pushEvent(s, { id: `evt_${Date.now()}_req`, at: Date.now(), kind: "decision", agent: "brain", severity: "info", title: `Manual close requested · ${p.symbol}`, detail: "Routed to Executor; awaiting settlement verification", ref: { type: "position", id } });
        });
        // Simulated settlement + verification delay.
        setTimeout(() => {
          this.update((s) => {
            const live = s.positions.find((x) => x.id === id);
            if (live) this.settleClose(s, live, "Manual close by operator", Date.now());
          });
          resolve({ ok: true, message: `${p.symbol} closed · settlement verified (demo).` });
        }, 1600);
      }),

    setEmergencyStop: async (engaged, reason) => {
      this.update((s) => {
        const now = Date.now();
        s.emergencyStop = engaged ? { engaged: true, at: now, by: "Operator", reason: reason || "Manual" } : { engaged: false, at: null, by: null, reason: null };
        s.alerts = [{ id: `alrt_${now}`, at: now, severity: engaged ? "critical" : "info", title: engaged ? "Emergency stop engaged" : "Emergency stop released", detail: engaged ? `All new orders halted. Reason: ${reason || "Manual"}` : "Brain and Executor resumed.", acknowledged: false }, ...s.alerts];
        this.pushEvent(s, { id: `evt_${now}_es`, at: now, kind: "risk", agent: "risk", severity: engaged ? "critical" : "info", title: engaged ? "Emergency stop engaged" : "Emergency stop released", detail: engaged ? `Reason: ${reason || "Manual"}` : "Trading resumed" });
      });
      return { ok: true, message: engaged ? "Emergency stop engaged. New orders are halted." : "Emergency stop released." };
    },

    acknowledgeAlert: async (id) => {
      this.update((s) => {
        s.alerts = s.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a));
      });
      return { ok: true, message: "Alert acknowledged." };
    },

    updateLimit: async (key, value) => {
      const ceiling = LIMIT_CEILINGS[key];
      if (!Number.isFinite(value) || value <= 0) return { ok: false, message: "Limit must be a positive number." };
      if (ceiling !== undefined && value > ceiling) return { ok: false, message: `Above the hard ceiling (${ceiling}). Change it in the engine configuration.` };
      this.update((s) => {
        s.limits = s.limits.map((l) => (l.key === key ? { ...l, limit: value } : l));
        this.pushEvent(s, { id: `evt_${Date.now()}_lim`, at: Date.now(), kind: "risk", agent: "risk", severity: "info", title: `Limit updated · ${s.limits.find((l) => l.key === key)?.label}`, detail: `New value ${value}` });
      });
      return { ok: true, message: "Limit updated." };
    },

    setAgentEnabled: async (id, enabled) => {
      if (id === "risk" && !enabled) return { ok: false, message: "Risk supervision cannot be disabled from the interface." };
      this.update((s) => {
        s.settings = { ...s.settings, agentsEnabled: { ...s.settings.agentsEnabled, [id]: enabled } };
        s.agents = s.agents.map((a) => (a.id === id ? { ...a, enabled, status: enabled ? "running" : "paused", activity: enabled ? "Resuming…" : "Disabled by operator" } : a));
      });
      return { ok: true, message: `${id[0].toUpperCase() + id.slice(1)} ${enabled ? "enabled" : "disabled"}.` };
    },

    markNotificationsRead: (ids) => {
      this.update((s) => {
        s.notifications = s.notifications.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n));
      });
    },

    updateSettings: (patch) => {
      this.update((s) => {
        s.settings = { ...s.settings, ...(patch.notify ? { notify: { ...s.settings.notify, ...patch.notify } } : {}), ...(patch.display ? { display: { ...s.settings.display, ...patch.display } } : {}) };
      });
    },
  };
}

// Operator controls survive a reload, so refreshing the page can never silently release the
// emergency stop or loosen a limit. (With an engine, this state lives server-side.)
const CONTROLS_KEY = "od.demo.controls";
function saveControls(s: DeskSnapshot) {
  try {
    sessionStorage.setItem(CONTROLS_KEY, JSON.stringify({ emergencyStop: s.emergencyStop, limits: s.limits.map((l) => ({ key: l.key, limit: l.limit })), settings: s.settings }));
  } catch {}
}
function restoreControls(s: DeskSnapshot): DeskSnapshot {
  try {
    const raw = sessionStorage.getItem(CONTROLS_KEY);
    if (!raw) return s;
    const c = JSON.parse(raw) as Pick<DeskSnapshot, "emergencyStop" | "settings"> & { limits: { key: string; limit: number }[] };
    const limits = s.limits.map((l) => ({ ...l, limit: c.limits.find((x) => x.key === l.key)?.limit ?? l.limit }));
    const settings = { ...s.settings, ...c.settings, agentsEnabled: { ...c.settings.agentsEnabled, risk: true } };
    const agents = s.agents.map((a) => (settings.agentsEnabled[a.id] ? a : { ...a, enabled: false, status: "paused" as const, activity: "Disabled by operator" }));
    return { ...s, emergencyStop: c.emergencyStop, limits, settings, agents };
  } catch {
    return s;
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

export const AGENT_IDS = AGENT_ORDER;
