// Domain model for Overnight Desk. Every data source (demo simulator today,
// trading engine adapter later) produces these shapes.

export type AgentId = "scanner" | "analyst" | "brain" | "executor" | "risk";
export type AgentStatus = "running" | "idle" | "degraded" | "error" | "paused" | "stopped";

export type DataSourceKind = "demo" | "deskview";
export type TradingMode = "paper" | "live";

/** What the server says about the system. Drives the PAPER / LIVE / DEMO badge. */
export interface SystemStatus {
  dataSource: DataSourceKind;
  /** Reported by the engine itself. null when no engine is connected. */
  tradingMode: TradingMode | null;
  engine: { configured: boolean; reachable: boolean; latencyMs: number | null; error: string | null };
  database: { configured: boolean; reachable: boolean; latencyMs: number | null; error: string | null };
  checkedAt: string;
}

export interface AgentMetric {
  label: string;
  value: string;
  hint?: string;
}

export interface AgentTask {
  id: string;
  label: string;
  at: number;
  durationMs: number | null;
  ok: boolean;
}

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  status: AgentStatus;
  enabled: boolean;
  activity: string;
  lastTask: AgentTask;
  opsToday: number;
  opsTotal: number;
  errors24h: number;
  lastError: { at: number; message: string } | null;
  latencyP50: number | null;
  latencyP95: number | null;
  successRate: number | null;
  uptimePct: number | null;
  metrics: AgentMetric[];
  /** ops per 5-minute bucket, last 24h (288 points) */
  throughput: number[];
  /** p50 latency per bucket (ms) */
  latency: number[];
  tasks: AgentTask[];
  config: { key: string; value: string }[];
}

export type Verdict = "pending" | "buy" | "watch" | "reject" | "pass" | "bought" | "skipped" | "waiting";

export interface Token {
  id: string;
  symbol: string;
  name: string;
  chain: string;
  address: string;
  discoveredAt: number;
  price: number | null;
  change5m: number | null;
  change1h: number | null;
  change24h: number | null;
  liquidity: number | null;
  volume24h: number | null;
  marketCap: number | null;
  holders: number | null;
  topHolderPct: number | null;
  score: number | null; // scanner score 0–100
  killRule?: string | null;
  fomoUrl?: string | null;
  notesPath?: string | null;
  verdict: Verdict;
  confidence: number | null; // analyst confidence 0–1
  flags: string[];
  notes: string | null;
  spark: number[];
}

export interface Position {
  id: string;
  tokenId: string;
  symbol: string;
  name: string;
  openedAt: number;
  entry: number;
  /** null when no live mark is available (never substituted with entry) */
  mark: number | null;
  qty: number;
  stop: number | null;
  target: number | null;
  confidence: number | null;
  source?: string | null;
  fomoUrl?: string | null;
  thesis: string;
  txHash: string | null;
  spark: number[];
  /** set while a close request is awaiting settlement verification */
  closing?: boolean;
}

export type TradeSide = "buy" | "sell";
export type TradeStatus = "filled" | "failed" | "rejected" | "pending";

export interface Trade {
  id: string;
  at: number;
  symbol: string;
  side: TradeSide;
  status: TradeStatus;
  price: number | null;
  qty: number | null;
  notional: number | null;
  fee: number | null;
  slippageBps: number | null;
  latencyMs: number | null;
  pnl: number | null; // realised P&L on sells
  txHash: string | null;
  verified: boolean | null;
  notesPath?: string | null;
  reason: string;
  decisionId: string;
}

export type ActivityKind = "discovery" | "evaluation" | "decision" | "execution" | "risk" | "api_error";
export type Severity = "info" | "success" | "warning" | "critical";

export interface ActivityEvent {
  id: string;
  at: number;
  kind: ActivityKind;
  agent: AgentId | "system";
  title: string;
  detail: string;
  severity: Severity;
  ref?: { type: "token" | "trade" | "position" | "agent" | "api"; id: string };
}

export interface DailyPoint {
  /** start of day, ms */
  t: number;
  equity: number;
  pnl: number;
  volume: number;
  trades: number;
  wins: number;
}

export interface IntradayPoint {
  t: number;
  equity: number;
}

export interface RiskLimit {
  key: string;
  label: string;
  unit: "usd" | "pct" | "count" | "bps";
  limit: number;
  used: number;
  description: string;
}

export interface RiskAlert {
  id: string;
  at: number;
  severity: Severity;
  title: string;
  detail: string;
  acknowledged: boolean;
}

export interface WalletAsset {
  symbol: string;
  name: string;
  balance: number;
  price: number;
  change24h: number;
  kind: "native" | "stable" | "token";
}

export interface WalletAddress {
  label: string;
  address: string;
  role: "trading" | "treasury" | "fees";
  balanceUsd: number;
}

export interface Transfer {
  id: string;
  at: number;
  direction: "in" | "out";
  asset: string;
  amount: number;
  usd: number;
  counterparty: string;
  txHash: string;
  status: "confirmed" | "pending";
}

export interface Service {
  id: string;
  name: string;
  kind: string;
  status: "operational" | "degraded" | "down" | "idle";
  uptimePct: number | null;
  latencyMs: number | null;
  detail?: string;
  /** last 90 checks: 0 ok, 1 degraded, 2 down */
  checks: number[];
  region: string;
}

export interface Incident {
  id: string;
  at: number;
  resolvedAt: number | null;
  title: string;
  service: string;
  severity: Severity;
  summary: string;
}

export interface ApiProvider {
  id: string;
  name: string;
  purpose: string;
  status: "operational" | "degraded" | "down";
  rpm: number;
  p50: number;
  p95: number;
  errorRate: number;
  quotaUsed: number;
  quotaLimit: number;
  latency: number[]; // last 60 minutes
  requests24h: number;
}

export interface ApiError {
  id: string;
  at: number;
  provider: string;
  code: number | string;
  endpoint: string;
  message: string;
  retried: boolean;
}

export interface ResourcePoint {
  t: number;
  cpu: number;
  mem: number;
  queue: number;
}

export interface Notification {
  id: string;
  at: number;
  severity: Severity;
  title: string;
  detail: string;
  read: boolean;
  href?: string;
}

export interface DeskSettings {
  agentsEnabled: Record<AgentId, boolean>;
  notify: { executions: boolean; riskAlerts: boolean; apiErrors: boolean; discoveries: boolean; sound: boolean };
  display: { compactTables: boolean; reduceMotion: boolean; currency: "USD" };
}

/** What the desk itself reports about mode (deskview /mode). */
export interface DeskMode {
  settingsMode: string;
  effectiveMode: TradingMode;
  liveGate: { passed: boolean; reason: string | null; at: string | null; tests: number; failed: string[]; blocked: string[] };
  paused: boolean;
  pausedReason: string | null;
  botsPaused: string[];
}

export interface SourceMeta {
  source: DataSourceKind;
  /** No action can be sent from the interface. */
  readOnly: boolean;
  /** Sections the source cannot provide; pages show a labelled gap instead of figures. */
  unavailable: string[];
  timezone: string;
  connection: { ok: boolean; error: string | null; lastFrameAt: number | null };
  deskMode: DeskMode | null;
  bookLabel: string;
  notes: string[];
}

/** Book figures supplied directly by a source (instead of derived from demo cash + positions). */
export interface BookOverride {
  equity: number | null;
  realized: number | null;
  unrealized: number | null;
  dayPnl: number | null;
  dayPct: number | null;
  startCash: number | null;
  totalTrades: number;
  winRate: number | null;
  staleFile: boolean;
  nightId: string | null;
}

export interface DeskSnapshot {
  meta: SourceMeta;
  book?: BookOverride;
  riskSettings?: { key: string; value: string }[];
  degradedLayers?: { message: string; at: string }[];
  chain?: { address: string | null; totalUsd: number | null; asOf: string | null; error: string | null } | null;
  generatedAt: number;
  startingCapital: number;
  cash: number;
  realizedTotal: number;
  agents: Agent[];
  tokens: Token[];
  positions: Position[];
  trades: Trade[];
  activity: ActivityEvent[];
  daily: DailyPoint[];
  intraday: IntradayPoint[];
  limits: RiskLimit[];
  alerts: RiskAlert[];
  emergencyStop: { engaged: boolean; at: number | null; by: string | null; reason: string | null };
  assets: WalletAsset[];
  addresses: WalletAddress[];
  transfers: Transfer[];
  services: Service[];
  incidents: Incident[];
  resources: ResourcePoint[];
  providers: ApiProvider[];
  apiErrors: ApiError[];
  notifications: Notification[];
  settings: DeskSettings;
}
