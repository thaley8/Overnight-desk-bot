# Overnight Desk: Premium Dashboard Integration (READ-ONLY design)

Inspected: Mon Nov 23 2026, ~01:35 CST. Inspect-only. No desk code, settings, db, routines, processes,
or the desk Chrome were touched. desk.db was opened with `file:desk.db?mode=ro`. No secret values were read
or printed. Only env var names appear here.

---------------------------------------------------------------------------------------------------
## 0. TL;DR

* All five bots are **threads in one Python process**: `desk.py --until-lock` (pid 107861, started
  00:25:04 CST, runs until the 06:30 CST lock). The Telegram poller is a **separate process**
  (`telegram_bot.py --start`, pid 148053). Everything else is a script that the Grok Bot routines start.
* **No REST API or WebSocket server exists in the desk.** No desk process listens on any port. The only
  desk-related listener is the desk Chrome's **unauthenticated** CDP on 127.0.0.1:9222. The dashboard
  must never touch, proxy or tunnel it.
* State lives in 4 places: **desk.db** (SQLite, append-only `events` bus log plus coins, positions,
  trades and the rest), **data/*.json / *.jsonl / *.flag**, **logs/*.log** (per-bot text logs), and the
  **Obsidian vault** (Markdown notes with YAML frontmatter).
* Minimal addition: a **separate read-only FastAPI + WebSocket service** (own folder and own venv) bound to
  **127.0.0.1:8787** with a bearer token. It opens SQLite read-only, tails the `events` table by id,
  stat-polls the JSON files, tails the logs through a redaction layer, and gets the live wallet balance from
  **public Solana RPC by the public FOMO address**. It never uses the FOMO token.
* The db and vault give good **discovery, kill and wallet history** and full **trade-note history**. The
  db `trades` table is empty so far. Equity curves and FOMO cash history are **not persisted** anywhere
  except a few log lines (gaps are listed in §7).

---------------------------------------------------------------------------------------------------
## 1. Where each bot runs

`desk.py main()` builds a single `DeskDB` (one sqlite3 connection, `check_same_thread=False`, RLock), one
in-process `Bus`, one `FomoDesk` (FOMO API client; Bearer token captured from the desk Chrome via CDP at
warmup and held **in memory only**), and one `LaneHolder` (the shared `browser.DeskLane` CDP click lane).
It then starts five daemon threads named after the classes:

| Bot | Code | Thread | How it runs / cadence | Consumes | Publishes (bus topics) |
|---|---|---|---|---|---|
| Scanner | bots/scanner.py | `Scanner` + sub-threads `scanner-ws` (PumpPortal `wss://pumpportal.fun/api/data`, subscribeMigration + subscribeNewToken, run_forever ping 20s, backoff 2→60s) and `scanner-wallets` (gmgn-cli smart money every 600s) | batch over the waiting room every `scanner.batch_s` (60s), first batch 8s after start; 1s loop | PumpPortal WS, FOMO filterTokens/tokenDetails, DexScreener, RugCheck, Solana RPC, gmgn-cli | `scanner.new_token`, `scanner.curve_complete`, `scanner.migration`, `scanner.kill`, `scanner.pass`, `scanner.wallet` |
| Analyst | bots/analyst.py | `Analyst` | event-driven (`scanner.pass`), 1s loop | scanner.pass | `analyst.pass`, `analyst.reject` |
| Brain | bots/brain.py | `Brain` | event-driven (`analyst.pass`), 1s loop; sizes from paper cash | analyst.pass | `brain.sized`, `brain.skip` |
| Executor | bots/executor.py | `Executor` | event-driven (`brain.sized`, `risk.ok`, `risk.block`); dip-wait loop 5s; uses the click lane | brain.sized, risk.ok/block | `executor.bought`, `executor.skip`, `executor.error`, `executor.unverified` |
| Risk | bots/risk.py | `Risk` | poll every `risk.poll_s` (5s): night limits → Telegram request queue → guard open positions → heartbeat; holds FOMO API priority | brain.sized, executor.bought, data/requests.jsonl | `risk.ok`, `risk.block`, `risk.sold`, `risk.error`, `risk.unverified` (also re-publishes `scanner.pass`/`brain.sized` for manual `buy X`) |

* Bus listeners are called **synchronously in the publishing thread** (bus.py). Each publish is also
  INSERTed into `desk.db.events` and a line is written to `logs/bus.log`.
* desk.py's main thread rewrites `vault/.../Desk/Live.md` every 10s and handles SIGINT/SIGTERM. At stop it
  sends the "night over" push and writes `logs/paper_run_report.md`.
* The process has 10 threads (NLWP=10).
* Other processes:
  * `telegram_bot.py --start` (pid 148053): long-polls Telegram `getUpdates`, has an owner lock, and
    writes request and confirmation files that Risk consumes.
  * Desk Chrome pid 30947 (`--user-data-dir=/workspace/desk/chrome`, CDP 127.0.0.1:9222).
  * Obsidian (pid 10476) on DISPLAY :2.
* Scheduled work is run by **Grok Bot routines** (there is no system crontab on the box), all America/Chicago:
  * `night-start` 22:00 runs `scripts/night_start.sh` (preflight, then `exec desk.py --until-lock`).
  * `desk-health` :30 every hour 22–06 runs `scripts/desk_health.py`. It can restart the Telegram poller
    and has `restart_desk()`, which SIGTERMs desk.py and re-runs night_start.sh.
  * `night-report` 07:00.
  * `weekly-review` daily 08:00 (writes only every 7 nights).
  * One-off `step14-chrome-tests` Nov 23 06:45.
  * The hourly dashboard Page refresh (`scripts/dashboard_data.py` → `data/dashboard.json`).
* **Important:** the running desk.py was started at 00:25 CST. Code edited after that (heartbeats,
  paper-night roll, pause rolls, the newer pushes) is **not loaded** until the 22:00 start. See §7.

---------------------------------------------------------------------------------------------------
## 2. Where state and activity are stored

### 2a. desk.db (SQLite, /workspace/desk/desk.db, 528 KB)
`journal_mode=delete` (rollback journal, **not WAL**). Writer: desk.py, which holds a single shared
connection, autocommit (`isolation_level=None`). Timestamps are local strings `YYYY-MM-DD HH:MM:SS CST|CDT`.

| Table | Columns | Rows now | What / who writes / cadence |
|---|---|---|---|
| `events` | id INTEGER PK AUTOINCREMENT, topic, payload (JSON text), created_at, consumed (always 0) | 476 | **The bus log. Append-only.** Every publish from every bot. `id` is a perfect monotonic cursor for live tailing. Now: scanner.new_token 396, scanner.wallet 33, scanner.migration 24, scanner.kill 23 |
| `coins` | mint PK, symbol, name, creator, pool, status, first_seen, migrated_at, liquidity, top10, holders, price, kill_rule, layers, score, bull, bear, size_usd, cap_usd, notes_path, updated_at | 23 | One row per evaluated coin. Upserted by Scanner/Analyst/Brain/Executor. status = killed/passed/skipped/bought…, plus kill_rule, score and links to the vault note |
| `waiting` | mint PK, symbol, creator, creator_balance, pool, arrived_at, last_holders, last_check, raw (JSON) | 1 | Scanner's waiting room (migrated, not yet judged). Rows are deleted on pass or kill |
| `wallets` | address PK, short, wins, losses, last_move, notes_path, updated_at | 31 | Smart wallets (gmgn), about every 10 min |
| `rugs` | mint PK, reason, seen_at | 0 | Known rugs |
| `positions` | mint PK, symbol, source (paper/fomo), qty, avg_price, usd_in, opened_at, stop_pct, trail_pct, peak_price, status (open/closed) | 0 | Open and closed positions. Executor inserts, Risk updates the peak and closes. `sync_fomo_balances` adopts FOMO holdings at warmup |
| `trades` | id PK, mint, symbol, side, size (TEXT), price, pnl (TEXT, e.g. "$1.20"), notes_path, created_at | 0 | Trade ledger rows (buy/sell). **Empty so far.** The 2 CATE test trades from Nov 21 exist only in the vault and paper_state |
| `holder_samples` | id PK, mint, holders, sampled_at | 23 | Holder-count time series per mint |
| `sqlite_sequence` | | 2 | internal |

### 2b. data/ (JSON state, written by desk/Telegram/scripts)
| File | Content | Writer / cadence |
|---|---|---|
| `paper_state.json` | night_id, start_cash, cash, positions{}, trades_night, realized_pnl | browser.py PAPER fills; ensure_paper_night at start. **Now stale: night_id 2026-11-21** (see §7) |
| `acceptance_step14.json` | passed (bool), reason, at, mode, effective_mode, tests[48] | scripts/step14_acceptance.py. It is the LIVE gate input (`passed: false`) |
| `dashboard.json` | asOf, asOfShort, timezone, night, status, balance, bots, extras, position, log, killsByRule, skipped, waiting | scripts/dashboard_data.py (hourly routine). It is an already-shaped snapshot and good as a bootstrap payload |
| `pushes.jsonl` | {text, button (links.py URL with ref=savipew), dry_run} per push | pushes.py, on each push. Contains dry-run test rows |
| `click_lane.json` | {holder, what, at} | browser.py, whoever holds the Chrome click lane |
| `telegram_chat.json` | {chat_id} | Telegram owner lock. **Private: do not expose** |
| `frames/*.png` | Chrome screenshots of each PAPER/LIVE click (`paper-buy-CATE` …) | browser.py |
| Created on demand (absent now): `desk_paused.flag`, `paused_{bot}.flag`, `heartbeats/{bot}` (pid + time), `requests.jsonl`, `requests_done.json`, `requests_heartbeat`, `telegram_pending.json`, `manual_buys.json`, `confirmed_buys.json`, `owner_hold.json` | | desk_mode.py, requests_queue.py, telegram_bot.py, browser.py |

### 2c. logs/
* Text logs: `desk.log` (all bots, ~190 KB), `{scanner,analyst,brain,executor,risk,bus,fomo,browser,market,mode,llm,lessons,telegram,health,daily,report,weekly,night_start}.log`.
  Line format: `YYYY-MM-DD HH:MM:SS CST [bot] message`.
* `health.json` / `health.md`: the desk-health snapshot (chrome, cdp, desk_pids, mode_settings/effective,
  paused, bots_paused, stale_bots, telegram_poller, desk_log_age_s, problems, ok, in_night_window,
  night_id), written hourly.
* `desk.pid`.
* `paper_run_report.md`.
* `raw/*.json`: one saved raw response per source (FOMO bodies, with the token redacted). **Do not serve.**
* `fail/` (fail and unverified screenshots), `api_fields.md`, `audit_values.md`, `fomo_web/`, `repo_examples/`.

### 2d. Obsidian vault: /workspace/desk/vault/Overnight Desk (syncs to the iPhone)
| Folder | Count | Content |
|---|---|---|
| Coins/ | 25 notes + Skipped.base | One note per evaluated coin (frontmatter: mint, status, kill_rule, layers, score, links) |
| Wallets/ | 31 | Smart-wallet notes (wins, losses, coins, cold flag) |
| Trades/ | 2 notes + Night.base | One note per fill (buy/sell, Risk exit section, pnl, fees, reason, frame) |
| Daily/ | 2026-11-22.md + frames/ | Morning report per night (07:00) |
| Lessons/ | 1 (smoke-test) | Lesson notes after losses; archived after 7 nights without hits |
| Desk/ | Settings.md (YAML frontmatter = all settings incl. mode), Live.md (10s board), Change log.md, Weekly 2026-11-22.md, frames/newest.png | |
| Templates/ | 5 | |

### 2e. Bus
In-process only (`bus.Bus`). Every message is persisted to `desk.db.events` **and** `logs/bus.log`.
Outside the desk process there is no socket or pub/sub. The `events` table **is** the cross-process feed.

---------------------------------------------------------------------------------------------------
## 3/4. Existing servers, ports, auth (checked with `ss -ltnp`, not assumed)

**No desk REST API, no desk WebSocket server, no auth layer.** desk.py and telegram_bot.py hold no
listening sockets. Telegram is outbound long-polling only.

The listeners on the box belong to the box or desktop infrastructure, not the desk:
* x11vnc 127.0.0.1:5900/5902
* noVNC websockify 0.0.0.0:6080/6081
* node 1337–1340, 13602, 14002
* unlabelled 8790 (0.0.0.0), 8791 (127.0.0.1), 2375, 26500 and 50052 (0.0.0.0)
* Agent browser CDP 127.0.0.1:9224

Desk-relevant: **desk Chrome CDP 127.0.0.1:9222.** It has no authentication, and anything that can reach it
fully controls the logged-in FOMO session. Rules for the dashboard:
* Never connect to it, proxy it, or forward it.
* Never run the API on a port reachable from outside the box.
* Bind 127.0.0.1 only, because several 0.0.0.0 listeners already exist on this box.

---------------------------------------------------------------------------------------------------
## 5. Minimal backend to add: `deskview` (read-only)

### 5a. Shape
* **New folder `/workspace/desk-dash/`** (outside /workspace/desk, so no desk file changes) with its own
  venv: `fastapi`, `uvicorn[standard]`, `watchfiles` (optional), `httpx`, `pyyaml`. **Do not pip-install into
  `/workspace/desk/.venv`.**
* One process: `uvicorn deskview.app:app --host 127.0.0.1 --port 8787 --workers 1` (8787 is free).
  Started by hand or by a routine. Not started by desk.py.
* **Do not import desk modules that write.** Mirror the few pure read helpers instead:
  * `desk_db.DeskDB()` runs `CREATE TABLE IF NOT EXISTS`, which is a write.
  * `desk_common.log()` appends to logs.
  * `desk_mode.effective_mode()` can log.
  * `ensure_paper_night(write=True)` writes paper_state.

  Safe to import or copy: `load_settings`, `read_paper_state`, `current_night_id`,
  `paper_night_snapshot(write=False)`, `links.coin_url`, `desk_common.redact_secrets`, and the
  `acceptance_passed` logic (read the JSON file).
* Single-writer rule: the service **never writes** inside /workspace/desk. Its own state (cursor, cache)
  lives in `/workspace/desk-dash/state/`.

### 5b. Data access
* SQLite:
  * Open per request or per poll with
    `sqlite3.connect("file:/workspace/desk/desk.db?mode=ro", uri=True, timeout=1)` and `PRAGMA query_only=1`.
  * Because the db is in rollback-journal mode, a reader holds a SHARED lock that briefly blocks the desk's
    writes (the desk uses Python's default 5s busy timeout). Keep every query tiny and indexed by PK/id.
  * Poll at most once per second, never hold a read transaction open, and never use `immutable=1`
    (it would return stale or corrupt data while the desk writes).
  * Switching to WAL would help but **changes the db**. Propose it separately, only while the desk is
    stopped, and only with the owner's ok.
* Live feed: a background task runs `SELECT id,topic,payload,created_at FROM events WHERE id>? ORDER BY id LIMIT 500`
  every 1s and fans new rows out over the WS. The same task watches the `positions` and `coins`
  `updated_at` values and the mtime and size of the data/*.json files and logs/health.json.
* Logs: tail `logs/desk.log` (and per-bot logs) by byte offset. Handle truncation. Redact every line.
* Vault: read Markdown and frontmatter (`yaml.safe_load`) on demand, with an mtime cache. Never write.

### 5c. Security
* Auth:
  * Bearer token from env var **`DESKVIEW_TOKEN`**, loaded from `~/.config/deskview/token` (mode 0600).
    It is never kept in the vault, /workspace/desk, a Page, or git.
  * Compare with `hmac.compare_digest`.
  * REST uses `Authorization: Bearer …`. The WS authenticates with a first `{"type":"auth","token":…}`
    message within 5s, or with `Sec-WebSocket-Protocol`. **Never a query string**, because those end up in
    access logs.
  * Optional second token later for control scopes (§8).
* Network:
  * Bind 127.0.0.1 only.
  * CORS allow-list limited to the dashboard origin.
  * Check `Origin` on the WS.
  * Rate-limit (e.g. 20 req/s).
  * Turn off uvicorn access-log headers.
* Redaction layer on every outbound payload (one function, used by all responses):
  * Drop keys matching `(?i)token|authorization|bearer|cookie|secret|password|seed|private|api[_-]?key|session|jwt`.
  * Run `desk_common.redact_secrets` on all strings (env values for OPENAI/FINANCIAL_DATASETS/TELEGRAM_BOT/…;
    `sk-…`; `Bearer …`; `bot\d+:…`).
  * Strip any value that equals an env secret.
  * Never return `logs/raw/*`, `telegram_chat.json`, `owner_hold.json`, chrome/, `~/.config/gmgn/*`, or
    env vars.
  * Allow-list the files the service may read. Do not take arbitrary paths from the client.
* Links: any FOMO link is built **only** with `links.coin_url(mint)` / `links.profile_url(handle)`
  (ref=savipew, never shortened).
* The service never imports `fomo_api`/`browser`, never opens CDP, and never calls prod-api.fomo.family.

### 5d. Live wallet balance without the FOMO token
1. **PAPER book (current mode):** `paper_night_snapshot()` semantics on `data/paper_state.json` give cash,
   start_cash, equity, loss_pct, trades_night, block. If the file's night_id is stale, report a fresh night
   with start_cash and do not write anything.
2. **Real FOMO wallet:** query **public Solana RPC** by the account's **public** address.
   * The address is the one Verify already uses, hard-coded in `scripts/save_raw_sources.py`
     (`5eZ8p7tF…STjDx4tat`, from FOMO userHandle `responseObject.address`). Put it in the service config.
     It is public, not a secret.
   * Calls: `getBalance` (SOL) plus `getTokenAccountsByOwner(addr, {mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v})`
     for USDC cash, and `getTokenAccountsByOwner(addr, {programId: Tokenkeg…})` for token holdings.
   * Price the holdings with DexScreener `tokens/v1/solana/{mints}`.
   * RPCs: `https://solana-rpc.publicnode.com`, `https://api.mainnet-beta.solana.com` (same as market.py).
   * Cache for 15–30s. That is **separate from the desk's FOMO 1.2s queue**, so it never steals the desk's
     FOMO budget.
   * Caveat: FOMO's UI cash is derived from the USDC row of FOMO's own balances endpoint. On-chain USDC
     should match it, but mark the figure `source:"chain"`. The Nov 23 00:17 warmup logged `balances cash=0.0 holdings=0`.
3. **Desk's own FOMO view:** the last `[fomo] balances cash=… holdings=…` line in logs/fomo.log (written at
   warmup only). Recommended later (needs owner ok, desk change): the desk writes
   `data/balances_snapshot.json` each Risk poll.

### 5e. REST endpoints (all GET, all `Authorization: Bearer`, prefix /api/v1)
| Endpoint | Backed by | Shape (abridged) |
|---|---|---|
| `/health` | logs/health.json + live checks: pgrep desk.py/telegram_bot.py, CDP port open (TCP connect only, **no HTTP**), desk.log age, heartbeats/ | `{ok, as_of, desk:{running, pids, started_at, log_age_s}, telegram_poller, chrome, cdp, in_night_window, night_id, problems[], last_health_check}` |
| `/mode` | Settings.md frontmatter + acceptance_step14.json + flags | `{settings_mode, effective_mode, live_gate:{passed, reason, at, blocked[], failed[]}, paused, paused_reason, bots_paused[]}` |
| `/settings` | Settings.md frontmatter (no secrets in it) | `{fomo_handle, paper_start_cash, night_start, lock_time, report_time, scanner{}, analyst{}, brain{}, executor{}, risk{}}` |
| `/balance` | §5d | `{paper:{night_id, cash, start_cash, equity, realized_pnl, loss_pct, trades_night, block}, chain:{address, sol, usdc, holdings:[{mint, symbol, qty, price_usd, value_usd}], as_of, source:"solana_rpc"}, desk_fomo_last:{cash, holdings, at}}` |
| `/positions` | desk.db positions + paper_state.positions + DexScreener mark price | `[{mint, symbol, source, qty, avg_price, usd_in, mark, value, pnl_usd, pnl_pct, stop_pct, trail_pct, peak_price, opened_at, status, fomo_url}]` |
| `/pnl?night=` | paper_state (tonight); trades table + vault Trades frontmatter (history) | `{night_id, realized, unrealized, equity, start, pct, by_trade:[…]}` |
| `/trades?since_id=&limit=` | desk.db trades ∪ vault Trades/*.md (dedupe by notes_path) | `[{id, at, side, symbol, mint, size_usd, price, pnl, reason, notes_path, frame}]` |
| `/discoveries?status=&limit=` | coins + waiting + latest holder_samples | `[{mint, symbol, status, kill_rule, score, liquidity, top10, holders, price, first_seen, migrated_at, notes_path, fomo_url}]` |
| `/coins/{mint}` | coins row + holder_samples series + events for mint + vault note body | `{coin, holders_series, events[], note_md}` |
| `/events?after_id=&topic=&limit=` | desk.db events | `[{id, topic, at, payload(redacted)}]` |
| `/agents` | events (last per bot prefix), heartbeats/, paused_*.flag, per-bot log age, counters | `[{name, state:"running|paused|stale|stopped", last_event:{topic, at}, last_log_at, heartbeat_at, counts:{in, pass, reject}}]` |
| `/alerts?limit=` | events topics risk.block, risk.unverified, executor.unverified, risk.error, executor.error, fomo.logged_out; desk_paused.flag (night_limit); health problems; mode.log LIVE refusals; logs/fail/* | `[{id, at, level:"info|warn|crit", kind, symbol, mint, message, frame}]` |
| `/pushes?limit=` | data/pushes.jsonl | `[{text, button, dry_run}]` |
| `/logs/{bot}?tail=200` | logs/{allow-listed}.log, redacted | `{lines:[…], offset}` |
| `/history/nights` | vault Daily/*.md frontmatter + Desk/Weekly*.md | `[{night_id, balance, pnl, trades, wins, losses, note}]` |
| `/wallets` | desk.db wallets + vault Wallets/ | `[{address, short, wins, losses, cold, last_move}]` |
| `/lessons` | vault Lessons/ | `[{tag, hits, archived, body}]` |
| `/frames/latest` | newest data/frames/*.png (served as image, allow-listed dir) | image |
| `/snapshot` | data/dashboard.json (bootstrap) | as is |

### 5f. WebSocket `/ws` (server → client only)
Envelope: `{"type": …, "ts": …, "data": …}`. After auth the server sends `snapshot` (/snapshot +
/mode + /balance), then deltas:
* `event` (each new events row: `{id, topic, at, payload}`) — the core live feed
* `discovery` (scanner.new_token/migration/pass/kill)
* `decision` (analyst.pass/reject, brain.sized/skip, risk.ok/block)
* `trade` (executor.bought, risk.sold)
* `position` (positions row or paper_state change)
* `balance` (paper_state change; chain refresh every 30s)
* `agent` (state change)
* `alert`
* `health` (health.json change or a 15s live probe)
* `mode` (Settings.md, flags or acceptance change)
* `log` (opt-in `{"subscribe":["log:risk"]}`, redacted)
* `heartbeat` every 15s.

The client resumes with `{"type":"resume","after_id":N}`. Inbound messages are limited to
auth/subscribe/resume; anything else closes the socket.

### 5g. Remote / iPhone access
Never expose it publicly (no port-forward, no public tunnel, no Tailscale Funnel). Options:
* **Tailscale `tailscale serve`** (tailnet-only HTTPS → 127.0.0.1:8787). Tailscale is not installed on the
  box yet.
* **SSH local forward** (`ssh -L 8787:127.0.0.1:8787 …`).

Either way, keep the bearer token and never forward 9222. The UI itself (Claude Code app) can run on the
Mac or phone browser and point at the tunnel.

---------------------------------------------------------------------------------------------------
## 6. Can the vault and db provide history?
**Yes:**
* Every bus event since the desk began (events.id 1…, timestamps).
* Every evaluated coin with its kill rule, score and layers (coins + Coins/ notes + Skipped.base).
* The waiting room.
* Holder-count series (holder_samples).
* Smart wallets with wins and losses (wallets + Wallets/).
* Per-trade notes with entry/exit, pnl, fees, reason and frames (Trades/ + Night.base).
* Per-night morning reports (Daily/), weekly reviews, lessons, the settings change log
  (Desk/Change log.md), push history (pushes.jsonl), and Chrome frames.

**No / partial:**
* `trades` table is empty. Trade history must merge vault Trades/*.md, and the 2 CATE test trades
  (Nov 21) exist only there.
* **No equity/balance time series.** paper_state.json is overwritten in place each night, and FOMO cash is
  only in warmup log lines. A balance chart needs the service to sample and store its own series (in
  /workspace/desk-dash/state/, not the desk db), or a future desk-side snapshot file.
* `positions` rows don't keep the exit price or pnl. Use risk.sold events or the trade notes.
* No per-bot uptime history before heartbeats ship (22:00 tonight).
* Older logs are not rotated or archived by night. Parsing works but it's text.
* Daily notes exist only from 2026-11-22.

---------------------------------------------------------------------------------------------------
## 7. Gaps and risks found
1. **The running desk predates recent code** (started 00:25 CST). As a result:
   * `data/heartbeats/` doesn't exist (health shows "running desk predates heartbeats").
   * `paper_state.json` still says night `2026-11-21`, so treat stale as a fresh night when reading.
   * Agent status must fall back to the last event or log time per bot until the 22:00 start.
2. desk.db is in **rollback-journal mode**, so readers can briefly block desk writes. Mitigations are in
   §5b; WAL is a separate, owner-approved change.
3. **CDP 9222 is unauthenticated.** It's the single most dangerous surface. Never proxy or tunnel it.
   Several unrelated 0.0.0.0 listeners also exist on the box.
4. Importing desk modules has write side effects (DeskDB schema, log(), effective_mode logging). Use
   copies of the pure functions.
5. `logs/raw/*` hold FOMO response bodies (token redacted), and `telegram_chat.json` holds the owner chat
   id. Never serve either.
6. `pushes.jsonl` mixes dry-run test pushes. Use the `dry_run` flag.
7. Timestamps carry CST/CDT abbreviations, not offsets. Parse with America/Chicago.
8. The FOMO public address is hard-coded only in a script. Copy it into the service config. The on-chain
   balance may differ in timing from the FOMO UI.
9. `requests.jsonl` / `requests_done.json` / `telegram_pending.json` are plain files with no locking, and
   only one pending question is allowed at a time. That matters for future controls (§8).
10. GMGN runs on a public example key (no GMGN_API_KEY). FINANCIAL_DATASETS returns 402. TimesFM and
    tradingview-mcp are off. The dashboard should show these as "degraded layers" from desk.log
    "missing API keys" and "llm off" lines.

---------------------------------------------------------------------------------------------------
## 8. Future controls: one command path, no bypass (design only, NOT to build now)
Principle: **the dashboard is just another front-end to the existing Telegram command handler.** It gets no
new powers. Each control is executed by the same functions Telegram calls, and the running desk enforces
it the same way.

```
Dashboard UI ──HTTPS(tunnel)──► deskview  POST /api/v1/commands  (scope "control" token + per-action re-auth)
                                    │  allow-list of verbs, rate limit, audit row FIRST
                                    ▼
                    telegram_bot.handle_command(text, chat_id=<owner>)   ← same parser/rules as Telegram
                                    │
         ┌──────────────────────────┼───────────────────────────────────────────┐
  desk_mode.set_paused /       requests_queue.add_request(source="dashboard")   desk_mode.set_mode / set_setting
  set_bot_paused (Risk can't   → Risk polls → sells jump lane / buys go          (RANGES refuse; LIVE only if
  pause with open position)      Analyst→Brain→Risk→Executor, 5/5 yes            acceptance passed AND typed LIVE)
                                 → Executor/Risk 3-way verify (screen+API+chain)
                                 → PAPER: last click never pressed
```

Rules:
* Allowed verbs mirror Telegram: `pause`/`resume` (all or one bot, except Risk with open positions),
  `sell X 25|50|100`, `buy X`, `yes`/`no` to the current `telegram_pending.json` question,
  `set key value` (RANGES), `paper`, `live LIVE`, `withdraw $N`.
  * `deposit` is always refused.
  * `withdraw` only opens Withdraw, types $N, stops at Review and sets the owner hold. It can never confirm.
* **Confirmations stay two-step.** `buy`/`sell`/`withdraw` create a pending question; the dashboard shows
  it and sends `yes` as a separate request. A yes from either Telegram or the dashboard answers the
  same single pending question. Add a nonce so a stale yes can't approve a newer question. That's a small
  future change to requests_queue and needs owner approval.
* **Never bypassed:** the desk_mode LIVE gate, Risk prechecks and night-loss/night-limit pause
  (`desk_paused.flag` with `night_limit`), Executor verify and unverified handling, the click lane and owner
  hold, browser refusal of Deposit/Withdraw-confirm/Send/Pay. The dashboard never writes flag or queue files
  directly. It only calls the handler.
* "Restart services": only (a) the Telegram poller via the desk_health logic, and (b) the desk via
  `desk_health.restart_desk()` semantics (SIGTERM → night_start.sh). Both run in the night window only,
  never during an open click lane, and are refused while a position is open, unless the owner types RESTART.
* Audit: an append-only `/workspace/desk-dash/state/audit.jsonl`
  (`{at, actor:"dashboard", ip, verb, args, result, pending_id}`). The service also posts a Telegram
  notice for every control ("Dashboard: paused Scanner"), so the owner sees all actions in one place.
* The Telegram owner lock remains the identity root. Dashboard control tokens are separate and revocable,
  and are disabled by default until the owner enables them.

---------------------------------------------------------------------------------------------------
## 9. Phased plan for Claude Code
**Phase 0: setup (no desk changes)**
* `/workspace/desk-dash/` with its own venv and config (`desk_root`, `fomo_public_address`, `bind=127.0.0.1:8787`).
* Generate the token into `~/.config/deskview/token` (0600).
* A `README` with the never-list: no CDP, no FOMO API, no writes under /workspace/desk, no secrets.

**Phase 1: read core**
* `db.py` (ro URI, query_only, timeout 1s, tiny queries), `files.py` (allow-listed readers for
  paper_state, acceptance, Settings frontmatter, flags, health.json, pushes, click_lane), `redact.py`
  (key and value redaction + `redact_secrets`), `links.py` passthrough.
* Unit tests use a **copy** of desk.db in a temp dir and a fixture vault.

**Phase 2: REST**
* The §5e endpoints with pydantic response models.
* Auth dependency with constant-time compare. CORS allow-list. Health endpoint uses a TCP-connect check
  only for 9222.

**Phase 3: live WS**
* An events-id tailer (1s), a file mtime watcher (1–2s), a log tailer with redaction, and a resume cursor.
* Backpressure: drop log frames before event frames.

**Phase 4: balances and history**
* Solana RPC balance by public address (cached 30s), DexScreener marks (cached 15s).
* The service records its own equity series to `desk-dash/state/series.sqlite`.
* Night history from Daily/ frontmatter and Trades/ notes.

**Phase 5: hardening and remote**
* Rate limits, log hygiene test (grep responses and logs for env secret values; must be 0).
* A load test that proves the desk's write latency is unaffected (measure `bus.log` cadence during polling).
* Tailscale serve or SSH tunnel docs.

**Phase 6 (later, separate approval): controls per §8**
* Desk-side changes that need the owner's explicit ok:
  * a pending-question nonce
  * a `source` field shown in pushes
  * an optional `data/balances_snapshot.json` writer
  * optional WAL (only while the desk is stopped)

Acceptance for read-only:
* No file under /workspace/desk changes mtime because of deskview (except files the desk writes itself).
* No connection to :9222 or prod-api.fomo.family from the deskview pid (check with `ss -tp`).
* Zero secret values in any response or log.
