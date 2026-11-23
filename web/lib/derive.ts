import type { DailyPoint, DeskSnapshot, Position, RiskLimit } from "./types";

/** Market value, or null when there is no live mark (never priced at entry). */
export function positionValue(p: Position): number | null {
  return p.mark === null ? null : p.mark * p.qty;
}
export function positionPnl(p: Position): number | null {
  return p.mark === null ? null : (p.mark - p.entry) * p.qty;
}
export function positionPct(p: Position): number | null {
  return p.mark === null || !p.entry ? null : p.mark / p.entry - 1;
}

export interface Overview {
  equity: number | null;
  realized: number | null;
  unrealized: number | null;
  dayPnl: number | null;
  dayPct: number | null;
  activePositions: number;
  totalTrades: number;
  winRate: number | null;
  exposure: number | null;
  maxDrawdown: number | null;
  startCash: number | null;
}

export function overview(s: DeskSnapshot): Overview {
  const mvKnown = s.positions.every((p) => p.mark !== null);
  const mv = s.positions.reduce((a, p) => a + (positionValue(p) ?? 0), 0);
  const unrealizedDemo = s.positions.reduce((a, p) => a + (positionPnl(p) ?? 0), 0);
  if (s.book) {
    const b = s.book;
    return {
      equity: b.equity,
      realized: b.realized,
      unrealized: b.unrealized,
      dayPnl: b.dayPnl,
      dayPct: b.dayPct,
      activePositions: s.positions.length,
      totalTrades: b.totalTrades,
      winRate: b.winRate,
      exposure: b.equity && mvKnown ? mv / b.equity : null,
      maxDrawdown: s.daily.length > 1 ? maxDrawdown(s.daily) : null,
      startCash: b.startCash,
    };
  }
  const equity = s.cash + mv;
  const prev = s.daily[s.daily.length - 2]?.equity ?? s.startingCapital;
  const dayPnl = equity - prev;
  const totalTrades = s.daily.reduce((a, d) => a + d.trades, 0);
  const wins = s.daily.reduce((a, d) => a + d.wins, 0);
  return {
    equity,
    realized: s.realizedTotal,
    unrealized: unrealizedDemo,
    dayPnl,
    dayPct: dayPnl / prev,
    activePositions: s.positions.length,
    totalTrades,
    winRate: totalTrades ? wins / totalTrades : null,
    exposure: equity ? mv / equity : null,
    maxDrawdown: maxDrawdown(s.daily),
    startCash: s.startingCapital,
  };
}

export const has = (s: DeskSnapshot, section: string) => !s.meta.unavailable.includes(section);

export function maxDrawdown(daily: DailyPoint[]) {
  let peak = -Infinity;
  let mdd = 0;
  for (const d of daily) {
    peak = Math.max(peak, d.equity);
    mdd = Math.min(mdd, d.equity / peak - 1);
  }
  return mdd;
}

export function drawdownSeries(daily: DailyPoint[]) {
  let peak = -Infinity;
  return daily.map((d) => {
    peak = Math.max(peak, d.equity);
    return { t: d.t, v: d.equity / peak - 1 };
  });
}

/** Limits with live utilisation computed from positions where possible. */
export function liveLimits(s: DeskSnapshot): RiskLimit[] {
  const o = overview(s);
  const largest = s.positions.reduce((a, p) => Math.max(a, positionValue(p) ?? 0), 0);
  return s.limits.map((l) => {
    switch (l.key) {
      case "max_position":
        return { ...l, used: largest };
      case "open_positions":
        return { ...l, used: s.positions.length };
      case "token_exposure":
        return { ...l, used: o.equity ? largest / o.equity : 0 };
      case "gross_exposure":
        return { ...l, used: o.exposure ?? 0 };
      case "daily_loss":
        return { ...l, used: Math.max(0, -(o.dayPnl ?? 0)) };
      default:
        return l;
    }
  });
}

export function rangeDays(range: string) {
  return { "7D": 7, "30D": 30, "90D": 90, "180D": 180, ALL: 100000 }[range] ?? 30;
}

export function sliceDaily(daily: DailyPoint[], range: string) {
  const n = rangeDays(range);
  return daily.slice(-Math.min(n, daily.length));
}

export function tradeStats(s: DeskSnapshot, daily: DailyPoint[]) {
  const pnls = daily.map((d) => d.pnl);
  const mean = pnls.reduce((a, b) => a + b, 0) / Math.max(1, pnls.length);
  const sd = Math.sqrt(pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, pnls.length - 1));
  const rets = daily.map((d, i) => (i === 0 ? 0 : d.pnl / daily[i - 1].equity)).slice(1);
  const rm = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const rsd = Math.sqrt(rets.reduce((a, b) => a + (b - rm) ** 2, 0) / Math.max(1, rets.length - 1));
  const downside = Math.sqrt(rets.filter((x) => x < 0).reduce((a, b) => a + b * b, 0) / Math.max(1, rets.length));
  const sells = s.trades.filter((t) => t.pnl !== null);
  const grossWin = sells.filter((t) => (t.pnl ?? 0) > 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
  const grossLoss = -sells.filter((t) => (t.pnl ?? 0) < 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
  const wins = sells.filter((t) => (t.pnl ?? 0) > 0);
  const losses = sells.filter((t) => (t.pnl ?? 0) <= 0);
  return {
    sharpe: rsd ? (rm / rsd) * Math.sqrt(365) : 0,
    sortino: downside ? (rm / downside) * Math.sqrt(365) : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : 0,
    expectancy: sells.length ? (grossWin - grossLoss) / sells.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    bestDay: Math.max(...pnls),
    worstDay: Math.min(...pnls),
    meanDay: mean,
    sdDay: sd,
    positiveDays: pnls.filter((p) => p > 0).length / Math.max(1, pnls.length),
    maxDrawdown: maxDrawdown(daily),
  };
}

/** The desk trades a night window in Chicago time (22:00 → 06:30 lock). */
export function nightSession(now: number, start = "22:00", lock = "06:30") {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Chicago" }).format(now);
  const [h, m] = parts.split(":").map(Number);
  const mins = h * 60 + m;
  const toM = (x: string) => +x.split(":")[0] * 60 + +x.split(":")[1];
  const inNight = mins >= toM(start) || mins < toM(lock);
  return inNight ? { name: "Night", detail: `Desk trading window · locks ${lock} CT`, active: true } : { name: "Day", detail: `Desk idle · night opens ${start} CT`, active: false };
}
