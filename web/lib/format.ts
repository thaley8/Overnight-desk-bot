const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Every formatter renders a missing value as an em dash; nothing is ever substituted. */
export const DASH = "—";

export function fmtUsd(v: number | null | undefined, opts: { decimals?: 0 | 2; sign?: boolean } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  const f = opts.decimals === 0 ? usd0 : usd2;
  const s = f.format(Math.abs(v));
  if (opts.sign) return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
  return v < 0 ? "−" + s : s;
}

export function fmtCompactUsd(v: number | null | undefined, sign = false) {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  const s = "$" + compact.format(Math.abs(v));
  if (sign) return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
  return v < 0 ? "−" + s : s;
}

export function fmtCompact(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  return compact.format(v);
}

export function fmtNum(v: number | null | undefined, decimals: 0 | 2 = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  return (decimals === 0 ? num0 : num2).format(v);
}

/** Token prices span many orders of magnitude. */
export function fmtPrice(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  if (v === 0) return "$0";
  if (v >= 1000) return usd0.format(v);
  if (v >= 1) return "$" + v.toFixed(2);
  if (v >= 0.01) return "$" + v.toFixed(4);
  const exp = Math.floor(Math.log10(v));
  const digits = Math.min(10, -exp + 3);
  return "$" + v.toFixed(digits);
}

export function fmtPct(v: number | null | undefined, opts: { sign?: boolean; decimals?: number } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  const d = opts.decimals ?? 2;
  const s = Math.abs(v * 100).toFixed(d) + "%";
  if (opts.sign) return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
  return v < 0 ? "−" + s : s;
}

export function fmtQty(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  if (v >= 1e6) return compact.format(v);
  if (v >= 100) return num0.format(v);
  return num2.format(v);
}

export function fmtMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

export function fmtAgo(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtDuration(ms: number) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const TZ = "America/Chicago";
export const TZ_LABEL = "CT";

const timeF = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: TZ });
const hmF = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const dateF = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TZ });
const dateTimeF = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const fullDateF = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: TZ });

export const fmtTime = (t: number) => timeF.format(t);
export const fmtHM = (t: number) => hmF.format(t);
export const fmtDate = (t: number) => dateF.format(t);
export const fmtDateTime = (t: number) => dateTimeF.format(t) + " CT";
export const fmtFullDate = (t: number) => fullDateF.format(t);

export function shortHash(h: string, n = 4) {
  if (h.length <= n * 2 + 2) return h;
  return `${h.slice(0, n + 2)}…${h.slice(-n)}`;
}

export function toneOf(v: number | null): "pos" | "neg" | "flat" {
  return v === null ? "flat" : v > 0 ? "pos" : v < 0 ? "neg" : "flat";
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
