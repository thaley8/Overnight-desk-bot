// DEMO DATA GENERATOR — every value produced here is simulated.
// It exists only so the interface can be designed and exercised without a trading engine.
// It is never used when an engine data source is configured.

import type {
  ActivityEvent, Agent, AgentId, AgentTask, ApiError, ApiProvider, DailyPoint, DeskSnapshot, Incident,
  IntradayPoint, Notification, Position, ResourcePoint, RiskAlert, RiskLimit, Service, Token, Trade,
  Transfer, Verdict, WalletAddress, WalletAsset,
} from "../types";
import { b58, chance, gauss, hash, int, mulberry32, pick, range, type Rng, walk } from "./random";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const TOKEN_NAMES: [string, string][] = [
  ["NOCT", "Nocturne"], ["VELA", "Vela Protocol"], ["LUMN", "Lumen Labs"], ["KSTR", "Kestrel"], ["TIDE", "Tidewater"],
  ["ORBT", "Orbital"], ["MOTH", "Moth Finance"], ["SABL", "Sable"], ["QRTZ", "Quartz"], ["DRFT", "Drift Line"],
  ["EMBR", "Ember"], ["HALC", "Halcyon"], ["NIMB", "Nimbus"], ["PYRA", "Pyra"], ["ZEPH", "Zephyr"],
  ["CRUX", "Crux"], ["ONYX", "Onyx Net"], ["FERN", "Fernwood"], ["GLYF", "Glyph"], ["RIFT", "Rift"],
  ["SOLC", "Solace"], ["TALN", "Talon"], ["UMBR", "Umbra"], ["VANT", "Vantage"], ["WISP", "Wisp"],
  ["AXLE", "Axle"], ["BRIO", "Brio"], ["CALX", "Calyx"], ["DUNE", "Dune Fi"], ["ECHO", "Echo Pool"],
  ["FJRD", "Fjord"], ["GRIT", "Grit"], ["HELM", "Helm"], ["IRIS", "Iris"], ["JADE", "Jade Mint"],
  ["KOI", "Koi"], ["LYNX", "Lynx"], ["MIRA", "Mira"], ["NOVA", "Nova Arc"], ["OPAL", "Opal"],
  ["PIKE", "Pike"], ["QUIL", "Quill"], ["ROOK", "Rook"], ["SKIF", "Skiff"], ["TERN", "Tern"],
];

const CHAINS = ["Solana", "Solana", "Solana", "Base", "Ethereum"] as const;

const FLAG_POOL = [
  "Mint authority active", "Top-10 hold > 40%", "LP not locked", "Low liquidity", "New deployer",
  "Honeypot pattern", "High sell tax", "Wash-trade signal", "Social spike",
];

export const AGENT_META: Record<AgentId, { name: string; role: string }> = {
  scanner: { name: "Scanner", role: "Discovers new pairs across DEX venues and filters noise" },
  analyst: { name: "Analyst", role: "Scores liquidity, holder distribution and contract risk" },
  brain: { name: "Brain", role: "Sizes positions and approves or declines trade decisions" },
  executor: { name: "Executor", role: "Routes orders and verifies settlement on-chain" },
  risk: { name: "Risk", role: "Enforces limits, stops and the emergency kill switch" },
};

export const AGENT_ORDER: AgentId[] = ["scanner", "analyst", "brain", "executor", "risk"];

function makeToken(r: Rng, now: number, i: number, ageMax = 36 * HOUR): Token {
  const [symbol, name] = TOKEN_NAMES[i % TOKEN_NAMES.length];
  const price = Math.pow(10, range(r, -6, 0.6));
  const liquidity = Math.pow(10, range(r, 4, 6.6));
  const spark = walk(r, 32, price, 0.035, range(r, -0.01, 0.015));
  const last = spark[spark.length - 1];
  const verdictRoll = r();
  const verdict: Verdict = verdictRoll < 0.18 ? "pending" : verdictRoll < 0.38 ? "buy" : verdictRoll < 0.65 ? "watch" : "reject";
  const topHolderPct = range(r, 0.08, 0.62);
  // Data-derived flags first, then random behavioural ones, so flags never contradict the figures.
  const flags = [
    ...(topHolderPct > 0.4 ? ["Top-10 hold > 40%"] : []),
    ...(liquidity < 50_000 ? ["Low liquidity"] : []),
    ...FLAG_POOL.filter((f) => f !== "Top-10 hold > 40%" && f !== "Low liquidity" && chance(r, verdict === "reject" ? 0.22 : 0.05)),
  ].slice(0, 3);
  const score = Math.round(verdict === "reject" ? range(r, 18, 58) : verdict === "buy" ? range(r, 72, 97) : range(r, 45, 85));
  return {
    id: `tok_${symbol.toLowerCase()}_${i}`,
    symbol,
    name,
    chain: pick(r, CHAINS),
    address: b58(r),
    discoveredAt: now - range(r, 2 * MIN, ageMax),
    price: last,
    change5m: gauss(r) * 0.02,
    change1h: gauss(r) * 0.06,
    change24h: last / spark[0] - 1,
    liquidity,
    volume24h: liquidity * range(r, 0.4, 6),
    marketCap: liquidity * range(r, 4, 30),
    holders: int(r, 180, 24000),
    topHolderPct,
    score,
    verdict,
    confidence: verdict === "pending" ? null : range(r, 0.42, 0.96),
    flags,
    notes: verdict === "pending" ? null : analystNote(r, verdict),
    spark,
  };
}

function analystNote(r: Rng, v: Verdict) {
  const buy = [
    "Liquidity deepened 3× over 2h with balanced buy/sell flow. Holder base broadening; no contract red flags.",
    "Locked LP, renounced mint, organic volume growth. Momentum confirmed on 5m and 1h.",
    "Strong holder dispersion and consistent liquidity adds. Entry favourable after pullback to VWAP.",
  ];
  const watch = [
    "Fundamentals acceptable but volume is concentrated in few wallets. Re-evaluate in 30m.",
    "Clean contract; liquidity still thin for target size. Monitoring for depth.",
    "Momentum present, but spread widening. Wait for confirmation.",
  ];
  const reject = [
    "Top holders control majority of supply; distribution risk too high.",
    "Mint authority still active and LP unlocked. Fails contract safety checks.",
    "Volume pattern consistent with wash trading. Declined.",
  ];
  return pick(r, v === "buy" ? buy : v === "watch" ? watch : reject);
}

function makeTasks(r: Rng, id: AgentId, now: number, n: number): AgentTask[] {
  const labels: Record<AgentId, string[]> = {
    scanner: ["Scanned new pair batch", "Refreshed venue pair index", "Filtered candidate set", "Pulled liquidity snapshot"],
    analyst: ["Evaluated token", "Re-scored watchlist token", "Ran contract safety check", "Holder distribution analysis"],
    brain: ["Approved entry decision", "Declined entry decision", "Resized position", "Exit decision"],
    executor: ["Filled buy order", "Filled sell order", "Verified settlement", "Re-quoted route"],
    risk: ["Pre-trade limit check", "Stop-loss sweep", "Exposure recalculation", "Drawdown check"],
  };
  const tasks: AgentTask[] = [];
  let t = now - range(r, 2_000, 40_000);
  for (let i = 0; i < n; i++) {
    tasks.push({
      id: `task_${id}_${i}`,
      label: pick(r, labels[id]) + (id === "analyst" || id === "executor" ? ` · ${pick(r, TOKEN_NAMES)[0]}` : ""),
      at: t,
      durationMs: Math.max(40, range(r, 0.3, 1.8) * baseLatency(id)),
      ok: chance(r, 0.95),
    });
    t -= range(r, 20_000, 6 * MIN);
  }
  return tasks;
}

function baseLatency(id: AgentId) {
  return { scanner: 420, analyst: 2600, brain: 1800, executor: 950, risk: 85 }[id];
}

function makeAgents(r: Rng, now: number): Agent[] {
  const activity: Record<AgentId, string> = {
    scanner: "Scanning 4 venues · 1,284 pairs/hr",
    analyst: "Evaluating QRTZ — holder distribution",
    brain: "Awaiting next candidate",
    executor: "Verifying settlement for NOCT sell",
    risk: "Monitoring 6 positions · 0 breaches",
  };
  return AGENT_ORDER.map((id) => {
    const base = baseLatency(id);
    const tasks = makeTasks(r, id, now, 40);
    const opsToday = { scanner: 28_410, analyst: 1_164, brain: 212, executor: 38, risk: 9_860 }[id] + int(r, 0, 200);
    const errors24h = { scanner: 3, analyst: 7, brain: 0, executor: 2, risk: 0 }[id];
    const status = id === "analyst" ? "degraded" : id === "brain" ? "idle" : "running";
    const throughput = Array.from({ length: 288 }, (_, i) => {
      const hour = new Date(now - (287 - i) * 5 * MIN).getUTCHours();
      const diurnal = 0.7 + 0.3 * Math.sin(((hour - 6) / 24) * Math.PI * 2);
      return Math.max(0, Math.round((opsToday / 288) * diurnal * (1 + gauss(r) * 0.18)));
    });
    const latency = Array.from({ length: 288 }, (_, i) => Math.max(10, base * (1 + gauss(r) * 0.12) * (id === "analyst" && i > 270 ? 1.7 : 1)));
    const metrics = {
      scanner: [
        { label: "Pairs / hour", value: "1,284" },
        { label: "Candidates", value: "62", hint: "passed filters today" },
        { label: "Pass rate", value: "4.8%" },
      ],
      analyst: [
        { label: "Evaluations", value: "1,164" },
        { label: "Avg confidence", value: "0.71" },
        { label: "Reject rate", value: "61%" },
      ],
      brain: [
        { label: "Decisions", value: "212" },
        { label: "Approved", value: "19" },
        { label: "Avg size", value: "$1,240" },
      ],
      executor: [
        { label: "Fill rate", value: "97.4%" },
        { label: "Avg slippage", value: "38 bps" },
        { label: "Confirm time", value: "1.9s" },
      ],
      risk: [
        { label: "Checks", value: "9,860" },
        { label: "Blocks", value: "4", hint: "orders blocked by limits" },
        { label: "Exposure", value: "34%" },
      ],
    }[id];
    const config = {
      scanner: [{ key: "venues", value: "4 DEX venues" }, { key: "min_liquidity", value: "$15,000" }, { key: "max_age", value: "36h" }, { key: "poll_interval", value: "4s" }],
      analyst: [{ key: "model", value: "LLM evaluator v3" }, { key: "min_confidence", value: "0.65" }, { key: "contract_checks", value: "enabled" }, { key: "timeout", value: "12s" }],
      brain: [{ key: "sizing", value: "Kelly × 0.25" }, { key: "max_size", value: "$2,500" }, { key: "cooldown", value: "90s" }, { key: "min_score", value: "70" }],
      executor: [{ key: "router", value: "Aggregator route" }, { key: "max_slippage", value: "150 bps" }, { key: "verify_settlement", value: "required" }, { key: "retries", value: "2" }],
      risk: [{ key: "stop_sweep", value: "every 5s" }, { key: "daily_loss_limit", value: "$1,500" }, { key: "kill_switch", value: "armed" }, { key: "max_positions", value: "8" }],
    }[id];
    return {
      id,
      name: AGENT_META[id].name,
      role: AGENT_META[id].role,
      status,
      enabled: true,
      activity: activity[id],
      lastTask: tasks[0],
      opsToday,
      opsTotal: opsToday * int(r, 60, 140),
      errors24h,
      lastError: errors24h ? { at: now - range(r, 4 * MIN, 9 * HOUR), message: id === "analyst" ? "LLM inference timeout after 12s (retried, succeeded)" : id === "scanner" ? "Venue websocket dropped; reconnected in 1.2s" : "Route quote expired before signing; re-quoted" } : null,
      latencyP50: base,
      latencyP95: base * 2.3,
      successRate: 1 - errors24h / Math.max(1, opsToday) - (id === "analyst" ? 0.012 : 0),
      uptimePct: id === "analyst" ? 0.9962 : 0.9998,
      metrics,
      throughput,
      latency,
      tasks,
      config,
    } satisfies Agent;
  });
}

function makeDaily(r: Rng, now: number, start: number, days: number): DailyPoint[] {
  const today = Math.floor(now / DAY) * DAY;
  const out: DailyPoint[] = [];
  let eq = start;
  for (let i = days - 1; i >= 0; i--) {
    const t = today - i * DAY;
    const trades = int(r, 4, 26);
    const winRate = Math.min(0.85, Math.max(0.25, 0.56 + gauss(r) * 0.14));
    const wins = Math.round(trades * winRate);
    const pnl = eq * (0.0032 + gauss(r) * 0.016) * (i === 0 ? 0.6 : 1);
    eq += pnl;
    out.push({ t, equity: eq, pnl, volume: trades * range(r, 700, 1500), trades, wins });
  }
  return out;
}

function makeTrades(r: Rng, now: number, n: number): Trade[] {
  const out: Trade[] = [];
  let t = now - range(r, 30_000, 4 * MIN);
  const reasons = {
    buy: ["Brain approved · score 84 · conf 0.78", "Momentum entry after liquidity add", "Breakout above 1h range"],
    sell: ["Take-profit target reached", "Stop-loss triggered by Risk", "Brain exit: momentum faded", "Trailing stop hit"],
  };
  for (let i = 0; i < n; i++) {
    const side = chance(r, 0.5) ? "buy" : "sell";
    const statusRoll = r();
    const status = statusRoll < 0.92 ? "filled" : statusRoll < 0.96 ? "rejected" : "failed";
    const price = Math.pow(10, range(r, -5, 0.4));
    const notional = range(r, 300, 2500);
    const qty = notional / price;
    const pnl = side === "sell" && status === "filled" ? notional * (gauss(r) * 0.12 + 0.025) : null;
    out.push({
      id: `trd_${(n - i).toString().padStart(5, "0")}`,
      at: t,
      symbol: pick(r, TOKEN_NAMES)[0],
      side,
      status,
      price,
      qty,
      notional,
      fee: notional * 0.0025,
      slippageBps: Math.round(Math.abs(gauss(r)) * 40 + 8),
      latencyMs: range(r, 600, 3200),
      pnl,
      txHash: status === "filled" ? b58(r, 88) : null,
      verified: status === "filled",
      reason: status === "rejected" ? "Blocked by Risk: per-token exposure limit" : status === "failed" ? "Route expired before settlement; funds not moved" : pick(r, reasons[side]),
      decisionId: `dec_${hash(r, 8).slice(2)}`,
    });
    t -= range(r, 3 * MIN, 5 * HOUR);
  }
  return out;
}

function makePositions(r: Rng, now: number, tokens: Token[]): Position[] {
  const held = tokens.filter((t) => t.verdict === "buy").slice(0, 6);
  return held.map((tok, i) => {
    const entry = tok.price! * range(r, 0.78, 1.12);
    const qty = range(r, 600, 2200) / entry;
    return {
      id: `pos_${i + 1}`,
      tokenId: tok.id,
      symbol: tok.symbol,
      name: tok.name,
      openedAt: now - range(r, 20 * MIN, 30 * HOUR),
      entry,
      mark: tok.price,
      qty,
      stop: entry * range(r, 0.8, 0.9),
      target: entry * range(r, 1.3, 1.8),
      confidence: tok.confidence ?? 0.7,
      thesis: tok.notes ?? "",
      txHash: b58(r, 88),
      spark: tok.spark,
    };
  });
}

function makeActivity(r: Rng, now: number, tokens: Token[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  let t = now - 4_000;
  for (let i = 0; i < 60; i++) {
    out.push(randomEvent(r, t, tokens));
    t -= range(r, 15_000, 4 * MIN);
  }
  return out;
}

export function randomEvent(r: Rng, at: number, tokens: Token[]): ActivityEvent {
  const tok = pick(r, tokens);
  const roll = r();
  const id = `evt_${Math.floor(at).toString(36)}_${Math.floor(r() * 1e6).toString(36)}`;
  if (roll < 0.32)
    return { id, at, kind: "discovery", agent: "scanner", severity: "info", title: `New pair discovered · ${tok.symbol}`, detail: `${tok.chain} · liquidity $${Math.round(tok.liquidity! / 1000)}k · score ${tok.score}`, ref: { type: "token", id: tok.id } };
  if (roll < 0.58 && tok.verdict !== "pending")
    return { id, at, kind: "evaluation", agent: "analyst", severity: tok.verdict === "reject" ? "warning" : "info", title: `${tok.symbol} evaluated → ${tok.verdict.toUpperCase()}`, detail: tok.notes ?? "", ref: { type: "token", id: tok.id } };
  if (roll < 0.58)
    return { id, at, kind: "discovery", agent: "scanner", severity: "info", title: `New pair discovered · ${tok.symbol}`, detail: `${tok.chain} · queued for evaluation`, ref: { type: "token", id: tok.id } };
  if (roll < 0.74)
    return { id, at, kind: "decision", agent: "brain", severity: "info", title: chance(r, 0.4) ? `Entry approved · ${tok.symbol}` : `Entry declined · ${tok.symbol}`, detail: `Size $${int(r, 4, 25) * 100} · confidence ${(tok.confidence ?? 0.6).toFixed(2)}`, ref: { type: "token", id: tok.id } };
  if (roll < 0.86)
    return { id, at, kind: "execution", agent: "executor", severity: "success", title: `${chance(r, 0.5) ? "Bought" : "Sold"} ${tok.symbol} · settlement verified`, detail: `${int(r, 12, 90)} bps slippage · confirmed in ${range(r, 0.8, 3.2).toFixed(1)}s`, ref: { type: "token", id: tok.id } };
  if (roll < 0.94)
    return { id, at, kind: "risk", agent: "risk", severity: "warning", title: pick(r, ["Exposure nearing per-token limit", "Stop-loss tightened", "Slippage above soft limit", "Order blocked by daily loss guard"]), detail: `${tok.symbol} · automated control applied`, ref: { type: "token", id: tok.id } };
  return { id, at, kind: "api_error", agent: "system", severity: "critical", title: pick(r, ["Market data feed · 429 Too Many Requests", "RPC primary · timeout after 8s", "LLM inference · 503 upstream"]), detail: "Retried with backoff · recovered", ref: { type: "api", id: "market-data" } };
}

function makeLimits(): RiskLimit[] {
  return [
    { key: "max_position", label: "Max position size", unit: "usd", limit: 2500, used: 2140, description: "Largest single position notional." },
    { key: "daily_loss", label: "Daily loss limit", unit: "usd", limit: 1500, used: 310, description: "Trading halts automatically when realised + unrealised loss for the night reaches this value." },
    { key: "open_positions", label: "Open positions", unit: "count", limit: 8, used: 6, description: "Maximum concurrent open positions." },
    { key: "token_exposure", label: "Per-token exposure", unit: "pct", limit: 0.15, used: 0.11, description: "Largest share of equity in any one token." },
    { key: "gross_exposure", label: "Gross exposure", unit: "pct", limit: 0.6, used: 0.34, description: "Total market value of positions as a share of equity." },
    { key: "max_slippage", label: "Max slippage", unit: "bps", limit: 150, used: 38, description: "Orders quoting worse than this are rejected before routing." },
  ];
}

function makeAlerts(r: Rng, now: number): RiskAlert[] {
  const items: [string, string, RiskAlert["severity"]][] = [
    ["Per-token exposure at 73% of limit", "NOCT position is 11.0% of equity (limit 15%).", "warning"],
    ["Order blocked: slippage above limit", "VELA buy quoted 212 bps > 150 bps limit. No funds moved.", "critical"],
    ["Stop-loss executed", "DRFT closed at stop; realised −$184.20.", "info"],
    ["Daily loss guard armed", "Loss for the day crossed 20% of the daily limit.", "info"],
    ["Liquidity drop on held token", "ORBT pool liquidity fell 38% in 10 minutes.", "warning"],
    ["Order blocked: max open positions", "Brain approved KSTR but 8/8 positions were open.", "warning"],
  ];
  return items.map(([title, detail, severity], i) => ({ id: `alrt_${i}`, at: now - i * range(r, 25 * MIN, 3 * HOUR) - 2 * MIN, title, detail, severity, acknowledged: i > 2 }));
}

function makeWallet(r: Rng, now: number, cash: number, positions: Position[]) {
  const solPrice = 182.4;
  const assets: WalletAsset[] = [
    { symbol: "USDC", name: "USD Coin", balance: cash * 0.72, price: 1, change24h: 0.0001, kind: "stable" },
    { symbol: "SOL", name: "Solana", balance: (cash * 0.28) / solPrice, price: solPrice, change24h: 0.0214, kind: "native" },
    ...positions.map((p) => ({ symbol: p.symbol, name: p.name, balance: p.qty, price: p.mark!, change24h: p.spark[p.spark.length - 1] / p.spark[0] - 1, kind: "token" as const })),
  ];
  const total = assets.reduce((s, a) => s + a.balance * a.price, 0);
  const addresses: WalletAddress[] = [
    { label: "Trading hot wallet", address: b58(r), role: "trading", balanceUsd: total * 0.93 },
    { label: "Fee reserve", address: b58(r), role: "fees", balanceUsd: total * 0.02 },
    { label: "Treasury (cold)", address: b58(r), role: "treasury", balanceUsd: total * 0.05 },
  ];
  const transfers: Transfer[] = Array.from({ length: 24 }, (_, i) => {
    const dir = chance(r, 0.4) ? "in" : "out";
    const asset = pick(r, ["USDC", "USDC", "SOL"]);
    const usd = range(r, 50, dir === "in" ? 5000 : 1200);
    return {
      id: `xfer_${i}`,
      at: now - i * range(r, 3 * HOUR, 30 * HOUR) - HOUR,
      direction: dir,
      asset,
      amount: asset === "SOL" ? usd / solPrice : usd,
      usd,
      counterparty: dir === "in" ? pick(r, ["Treasury (cold)", "Exchange deposit", "Fee reserve"]) : pick(r, ["Fee reserve", "Treasury (cold)", "Network fees"]),
      txHash: b58(r, 88),
      status: i === 0 ? "pending" : "confirmed",
    };
  });
  return { assets, addresses, transfers };
}

function makeServices(r: Rng): Service[] {
  const defs: [string, string, string, string][] = [
    ["engine", "Trading engine", "Core runtime", "us-east"],
    ["queue", "Task queue", "Message broker", "us-east"],
    ["db", "Postgres (Supabase)", "Database", "us-east-1"],
    ["rpc-primary", "RPC primary", "Chain node", "us-east"],
    ["rpc-fallback", "RPC fallback", "Chain node", "eu-west"],
    ["ws", "Market data stream", "WebSocket", "us-east"],
    ["llm", "LLM inference", "Model API", "global"],
    ["scheduler", "Scheduler", "Cron / jobs", "us-east"],
  ];
  return defs.map(([id, name, kind, region]) => {
    const degraded = id === "llm";
    const checks = Array.from({ length: 90 }, (_, i) => (degraded && i > 84 ? 1 : chance(r, 0.015) ? 1 : chance(r, 0.003) ? 2 : 0));
    return {
      id, name, kind, region,
      status: degraded ? "degraded" : "operational",
      uptimePct: 1 - checks.filter((c) => c === 2).length * 0.004 - checks.filter((c) => c === 1).length * 0.0007,
      latencyMs: { engine: 4, queue: 3, db: 21, "rpc-primary": 112, "rpc-fallback": 168, ws: 38, llm: 2840, scheduler: 2 }[id] ?? 20,
      checks,
    };
  });
}

function makeIncidents(now: number): Incident[] {
  return [
    { id: "inc_4", at: now - 26 * MIN, resolvedAt: null, title: "Elevated LLM inference latency", service: "LLM inference", severity: "warning", summary: "p95 latency up 70%. Analyst evaluations slower; retries succeeding. Investigating upstream." },
    { id: "inc_3", at: now - 9 * HOUR, resolvedAt: now - 8.6 * HOUR, title: "Market data rate limiting", service: "Market data stream", severity: "warning", summary: "Burst of 429 responses during scan peak. Backoff tuned from 1s to 2.5s." },
    { id: "inc_2", at: now - 2.3 * DAY, resolvedAt: now - 2.25 * DAY, title: "RPC primary timeout", service: "RPC primary", severity: "critical", summary: "Primary node stalled for 4m. Automatic failover to fallback node; no orders lost." },
    { id: "inc_1", at: now - 6 * DAY, resolvedAt: now - 5.98 * DAY, title: "Scheduler restart", service: "Scheduler", severity: "info", summary: "Planned restart during dependency upgrade." },
  ];
}

function makeResources(r: Rng, now: number): ResourcePoint[] {
  let cpu = 38, mem = 54, queue = 12;
  return Array.from({ length: 120 }, (_, i) => {
    cpu = Math.min(95, Math.max(8, cpu + gauss(r) * 4));
    mem = Math.min(92, Math.max(30, mem + gauss(r) * 1.2));
    queue = Math.max(0, queue + gauss(r) * 3);
    return { t: now - (119 - i) * MIN, cpu, mem, queue: Math.round(queue) };
  });
}

function makeProviders(r: Rng): ApiProvider[] {
  const defs: [string, string, string, number, number, number][] = [
    ["market-data", "Market data API", "Pair discovery & prices", 420, 86, 600],
    ["dex-router", "DEX aggregator", "Quotes & routing", 64, 140, 120],
    ["rpc-primary", "RPC primary", "Chain reads & submits", 910, 112, 1500],
    ["rpc-fallback", "RPC fallback", "Failover node", 38, 168, 600],
    ["llm", "LLM inference", "Analyst evaluations", 22, 2840, 60],
    ["supabase", "Supabase", "Persistence", 140, 21, 1000],
  ];
  return defs.map(([id, name, purpose, rpm, p50, quota]) => {
    const degraded = id === "llm";
    return {
      id, name, purpose,
      status: degraded ? "degraded" : "operational",
      rpm,
      p50,
      p95: p50 * (degraded ? 3.1 : 2.2),
      errorRate: degraded ? 0.034 : id === "market-data" ? 0.006 : range(r, 0.0005, 0.003),
      quotaUsed: rpm,
      quotaLimit: quota,
      latency: Array.from({ length: 60 }, (_, i) => Math.max(1, p50 * (1 + gauss(r) * 0.15) * (degraded && i > 40 ? 1.6 : 1))),
      requests24h: rpm * 60 * 24 * range(r, 0.8, 1.1),
    };
  });
}

function makeApiErrors(r: Rng, now: number): ApiError[] {
  const samples: [string, number | string, string, string][] = [
    ["LLM inference", 503, "POST /v1/messages", "Upstream overloaded"],
    ["LLM inference", "TIMEOUT", "POST /v1/messages", "No response within 12s"],
    ["Market data API", 429, "GET /pairs/new", "Too Many Requests"],
    ["RPC primary", "TIMEOUT", "sendTransaction", "Node did not respond within 8s"],
    ["DEX aggregator", 400, "GET /quote", "Route not found for amount"],
    ["Market data API", 502, "GET /tokens/{addr}", "Bad gateway"],
    ["RPC fallback", 429, "getSignatureStatuses", "Rate limited"],
  ];
  return Array.from({ length: 36 }, (_, i) => {
    const [provider, code, endpoint, message] = pick(r, samples);
    return { id: `apierr_${i}`, at: now - i * range(r, 4 * MIN, 50 * MIN) - MIN, provider, code, endpoint, message, retried: chance(r, 0.85) };
  });
}

function makeNotifications(now: number): Notification[] {
  return [
    { id: "n1", at: now - 2 * MIN, severity: "critical", title: "Order blocked: slippage above limit", detail: "VELA buy quoted 212 bps. No funds moved.", read: false, href: "/risk" },
    { id: "n2", at: now - 14 * MIN, severity: "warning", title: "Analyst degraded", detail: "LLM inference latency elevated. Evaluations slower.", read: false, href: "/agents/analyst" },
    { id: "n3", at: now - 41 * MIN, severity: "success", title: "Take-profit filled · KSTR", detail: "Realised +$312.40 after 3h 12m.", read: false, href: "/trades" },
    { id: "n4", at: now - 3 * HOUR, severity: "info", title: "Daily loss guard armed", detail: "20% of daily limit reached.", read: true, href: "/risk" },
  ];
}

export function generateSnapshot(seed = 7, now = Date.now()): DeskSnapshot {
  const r = mulberry32(seed);
  const startingCapital = 25_000;
  const tokens = Array.from({ length: 44 }, (_, i) => makeToken(r, now, i)).sort((a, b) => b.discoveredAt - a.discoveredAt);
  const positions = makePositions(r, now, tokens);
  const daily = makeDaily(r, now, startingCapital, 180);
  const unrealized = positions.reduce((s, p) => s + (p.mark! - p.entry) * p.qty, 0);
  const cost = positions.reduce((s, p) => s + p.entry * p.qty, 0);
  const equityNow = daily[daily.length - 1].equity;
  const realizedTotal = equityNow - startingCapital - unrealized;
  const cash = equityNow - unrealized - cost;
  const intradayRaw = walk(r, 288, 1, 0.0022, 0);
  const scale = equityNow / intradayRaw[intradayRaw.length - 1];
  const intraday: IntradayPoint[] = intradayRaw.map((v, i) => ({ t: now - (287 - i) * 5 * MIN, equity: v * scale }));
  const { assets, addresses, transfers } = makeWallet(r, now, cash, positions);

  return {
    meta: {
      source: "demo",
      readOnly: false,
      unavailable: [],
      timezone: "America/Chicago",
      connection: { ok: true, error: null, lastFrameAt: now },
      deskMode: null,
      bookLabel: "Total wallet balance",
      notes: [],
    },
    generatedAt: now,
    startingCapital,
    cash,
    realizedTotal,
    agents: makeAgents(r, now),
    tokens,
    positions,
    trades: makeTrades(r, now, 420),
    activity: makeActivity(r, now, tokens),
    daily,
    intraday,
    limits: makeLimits(),
    alerts: makeAlerts(r, now),
    emergencyStop: { engaged: false, at: null, by: null, reason: null },
    assets,
    addresses,
    transfers,
    services: makeServices(r),
    incidents: makeIncidents(now),
    resources: makeResources(r, now),
    providers: makeProviders(r),
    apiErrors: makeApiErrors(r, now),
    notifications: makeNotifications(now),
    settings: {
      agentsEnabled: { scanner: true, analyst: true, brain: true, executor: true, risk: true },
      notify: { executions: true, riskAlerts: true, apiErrors: true, discoveries: false, sound: false },
      display: { compactTables: false, reduceMotion: false, currency: "USD" },
    },
  };
}

export { makeToken };
