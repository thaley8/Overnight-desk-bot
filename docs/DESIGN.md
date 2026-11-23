# Overnight Desk — Interface Design Plan

## 0. Data and safety model

The desk itself (five bot threads in `desk.py` on the Grok Bot box) exposes no API. The dashboard reads it
through **deskview**, a read-only service described in [`dashboard_integration.md`](dashboard_integration.md)
and implemented in [`../deskview`](../deskview).

1. The UI talks to a typed **data-source layer** (`web/lib/data/source.ts`). `DeskviewSource` maps the desk's
   real data. `DemoSource` is a clearly labelled simulator, used only when no deskview is configured.
2. The mode badge never claims PAPER or LIVE on its own. It shows the desk's `effective_mode`, which is LIVE
   only when the settings say live **and** the acceptance gate passed. Without deskview it reads `DEMO`.
3. The browser holds no keys and signs nothing. Against the real desk every control is hidden or disabled;
   pausing, selling and mode changes stay on Telegram until the §8 command path is approved.
4. Missing data is shown as a labelled gap, never estimated.

## 1. Identity

*Overnight Desk* — an institutional desk that runs while you sleep. The identity leans on the night sky and on
print-finance rigor rather than on neon "crypto" tropes.

- **Mark**: a crescent cut from a rounded square, with a single candlestick standing in the cut — night + market.
- **Voice**: calm, precise, factual. Labels are short; numbers carry the page.
- **Motifs**: hairline rules instead of boxes; numbered section headers (`01 · Performance`); monospace
  tabular figures for every number; a small Chicago-time (CT) clock with the desk's night-window state; a cyan "live" pulse used only where data is live.

## 2. Colour system

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#080F1C` | App background (deep midnight navy) |
| `--bg-2` | `#0D1726` | Sidebar, header, table headers |
| `--panel` | `#111E30` | Panels |
| `--elevated` | `#17263B` | Menus, drawers, hover rows, inputs |
| `--accent` | `#398BFF` | Primary actions, selection, focus, primary series |
| `--cyan` | `#35D5E8` | Live data, secondary series |
| `--pos` | `#3DBE8B` | Gains (desaturated jade, not neon) |
| `--neg` | `#E0636E` | Losses (muted coral red) |
| `--warn` | `#E3AA4A` | Warnings, DEMO badge |
| Lines | `rgba(148,178,220,.08 / .14 / .22)` | Hairline, divider, strong border |
| Text | `#E6EDF7 / #A3B2C8 / #6B7C96 / #4A5A73` | Primary → disabled |

No purple, no large gradients, no glass blur. Glow is limited to the 6px live-dot halo.

## 3. Typography

- **IBM Plex Sans** (400/500/600) for interface text — engineered, institutional, distinct from default SaaS fonts.
- **IBM Plex Mono** (400/500) for all figures, tickers, hashes and timestamps, always `tabular-nums`.
- Scale: 11 (labels, uppercase +0.08em) · 12 · 13 (body/table) · 15 · 20 (page title) · 28/36 (hero figures).

## 4. Layout system

- 4px base grid; panel padding 20px; section gap 24px; table rows 40px (compact 34px).
- App shell: **left rail** (232px, collapsible to 64px, off-canvas drawer < 1024px) + **header** (56px).
- Panels are reserved for groups. Inside a panel, information is separated with hairlines and columns,
  not with nested cards.
- Breakpoints: < 640 single column · 640–1024 two columns, drawer nav · ≥ 1280 full terminal grid.

## 5. Shell

**Header**: logo/breadcrumb · mode badge (DEMO / PAPER / LIVE from `/api/status`) · system health pill ·
session clock (desk night window 22:00 → 06:30 CT) · global search (⌘K) · notifications ·
live/pause toggle · user menu (settings, shortcuts).

**Sidebar** groups: *Desk* (Command Center, Token Scanner, AI Agents) · *Book* (Open Positions, Trade History,
Analytics) · *Control* (Risk, Wallet) · *Infrastructure* (System Health, API Monitor) · Settings.
Footer shows the emergency-stop state.

## 6. Pages

1. **Command Center** — Performance band (wallet balance hero + sparkline, realised, unrealised, daily %,
   active positions, total trades, win rate) · main chart with Equity / Cumulative P&L / Volume tabs, crosshair
   tooltip and date range · daily P&L bars + calendar heatmap · agent pipeline (Scanner → Analyst → Brain →
   Executor, Risk supervising) · live activity feed with type filters · risk snapshot.
2. **Token Scanner** — discovery funnel stats · search, chain/verdict/score filters · sortable table with
   sparklines and risk flags · detail drawer (price chart, liquidity, holders, analyst notes, decision trail).
3. **AI Agents** — pipeline diagram + agent roster; **/agents/[id]** detail with throughput/latency charts,
   task log, error log, configuration summary.
4. **Open Positions** — exposure summary + allocation bar · sortable table with progress to stop/target ·
   expandable rows · close-position flow with confirmation.
5. **Trade History** — search, side/status filters, date range, sortable, paginated, expandable tx details,
   CSV export.
6. **Trading Analytics** — KPIs (Sharpe, profit factor, expectancy, max drawdown) · equity vs drawdown ·
   P&L distribution histogram · hour-of-day performance · per-token attribution.
7. **Risk Management** — emergency stop (guarded) · limit utilisation meters · drawdown chart · exposure by
   token · alert log with acknowledge.
8. **Wallet Overview** — balance hero · asset table with allocation · address list with copy · transfer ledger.
9. **System Health** — service grid with uptime bars (90 checks) · resource charts · incidents timeline ·
   live checks of real dependencies (Supabase reachability through `/api/status`).
10. **API Monitoring** — provider table (req/min, p50/p95, error rate, rate-limit usage) · latency chart ·
    error log with filters.
11. **Settings** — trading mode (read-only, engine-reported) · risk limits (confirm before apply) · agent
    toggles · notifications · display preferences · data-source diagnostics.

## 7. Interaction

Global ⌘K search (pages, tokens, positions, trades) · sortable + filterable tables · expandable rows · drawers ·
interactive SVG charts with crosshair and range selection · live updates (pausable) · notifications with
unread state and toasts · keyboard focus states · reduced-motion support.

## 8. Architecture

```
app/                 routes (thin) + /api/status route handler
components/shell     Sidebar, Header, CommandPalette, Notifications, ModeBadge, Logo
components/ui        Panel, Section, Stat, Badge, Button, Segmented, DataTable, Drawer, Dialog, Toast…
components/charts    Hand-built SVG charts (no chart library): Line/Area, Bars, Sparkline, Heatmap, Histogram, Meter
components/features  Page-level compositions
lib/types.ts         Domain model
lib/data/source.ts   DataSource interface + demo implementation selection
lib/demo/*           Seeded demo generator + live simulator (labelled DEMO everywhere)
lib/store.tsx        DeskProvider (client context, polling /api/status, live ticks)
```
