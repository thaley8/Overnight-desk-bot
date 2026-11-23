# deskview — read-only view of the Overnight Desk

A small FastAPI + WebSocket service that lets the dashboard **read** the desk. It implements Phases 0–5 of
[`../docs/dashboard_integration.md`](../docs/dashboard_integration.md). Controls (§8) are **not** built.

## The never-list

deskview must never:

- write anything under `/workspace/desk` (its only file is `DESKVIEW_STATE_DIR/series.sqlite`)
- connect to, proxy or tunnel the desk Chrome CDP on `127.0.0.1:9222` (it checks the port is listening by reading `/proc/net/tcp`, without connecting)
- import `fomo_api` or `browser`, or call `prod-api.fomo.family`
- serve `logs/raw/*`, `telegram_chat.json`, `owner_hold.json`, `chrome/`, `~/.config/gmgn/*` or env vars
- bind anything except loopback, or accept the bearer token in a query string
- import desk modules that write (`desk_db.DeskDB`, `desk_common.log`, `desk_mode.effective_mode`, `ensure_paper_night(write=True)`)

The only desk module it loads is `links.py`, and only for `coin_url(mint)`.

## Install (Phase 0)

```bash
mkdir -p /workspace/desk-dash && cd /workspace/desk-dash
# copy this deskview/ folder here
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # NOT into /workspace/desk/.venv
mkdir -p ~/.config/deskview && umask 077 && python3 -c "import secrets;print(secrets.token_urlsafe(32))" > ~/.config/deskview/token
```

## Run

```bash
export DESKVIEW_FOMO_ADDRESS=<public FOMO address from scripts/save_raw_sources.py>
export DESKVIEW_ALLOWED_ORIGINS=http://127.0.0.1:3000   # the dashboard origin, comma separated
.venv/bin/python -m deskview --port 8787                # refuses any non-loopback --host
```

| Variable | Default | |
| --- | --- | --- |
| `DESKVIEW_DESK_ROOT` | `/workspace/desk` | read-only |
| `DESKVIEW_VAULT` | `$DESK_ROOT/vault/Overnight Desk` | read-only |
| `DESKVIEW_STATE_DIR` | `/workspace/desk-dash/state` | must be outside the desk root (enforced) |
| `DESKVIEW_TOKEN` / `DESKVIEW_TOKEN_FILE` | `~/.config/deskview/token` | ≥ 24 chars; the file must be `chmod 600` (enforced) |
| `DESKVIEW_FOMO_ADDRESS` | unset → chain balance off | public address, not a secret |
| `DESKVIEW_ALLOWED_ORIGINS` | empty → no browser origins | CORS + WebSocket `Origin` allow-list |
| `DESKVIEW_RPC_URLS` | publicnode, mainnet-beta | public Solana RPC, cached 30s |
| `DESKVIEW_CHAIN_ENABLED` | `1` | `0` turns off RPC/DexScreener |
| `DESKVIEW_NIGHT_START` / `DESKVIEW_LOCK_TIME` | `22:00` / `06:30` | America/Chicago |

To keep a secret out of every response, run deskview with that secret's variable in its environment. Values of
variables whose name looks secret (`*_KEY`, `*_TOKEN`, `*SECRET*`…) are stripped from every string it returns.
The Telegram owner chat id is read from `telegram_chat.json` only so that it can be stripped. That file is never served.

## API

`GET /api/v1/...` with `Authorization: Bearer <token>`. Routes: `health`, `mode`, `settings`, `balance`,
`positions`, `pnl?night=`, `trades?since_id=&limit=`, `discoveries?status=`, `coins/{mint}`,
`events?after_id=&topic=`, `agents`, `alerts`, `pushes`, `logs/{bot}?tail=`, `history/nights`, `wallets`,
`lessons`, `frames/latest`, `snapshot`, plus `series?since=` (deskview's own equity samples, one a minute).

`/ws`: send `{"type":"auth","token":"…"}` within 5s. You then receive `snapshot` followed by
`event`/`discovery`/`decision`/`trade`/`position`/`balance`/`agent`/`alert`/`health`/`mode`/`heartbeat` frames.
Inbound messages may only be `{"type":"resume","after_id":N}` and `{"subscribe":["log:risk"]}`; anything else
closes the socket.

## How it reads desk.db safely

`desk.db` uses a rollback journal, so a reader briefly blocks the desk's writes. deskview opens
`file:desk.db?mode=ro` with `PRAGMA query_only=1` and `timeout=1`, runs one small id/PK query, and closes the
connection. It tails `events` once a second into an in-memory cache, so agents, alerts and counts cost no extra
queries. Measured on a fixture with a desk-like writer (50 inserts/s) while REST was being hammered: write p50
2.5 → 2.4 ms, p99 8 → 11 ms, no busy timeouts. Re-measure on the box (Phase 5).

## How deskview reads the desk (assumptions to check on the box)

- **Effective mode** is shown as `live` only if `Settings.md` says `mode: live` **and**
  `acceptance_step14.json.passed` is `true`. This mirrors the desk's gate; it never decides anything.
- **Night id** is the date of the evening the night started; before noon Chicago time it is still last
  night. A `paper_state.json` from another night is reported as a fresh night at `start_cash`, and nothing is written.
- **Agent state** comes from the heartbeat files when present. Until heartbeats ship, it falls back to each bot's
  log mtime (`status_source` says which).
- **Trades** merge `desk.db.trades` with `vault/Trades/*.md` frontmatter, de-duplicated by `notes_path`.
  Frontmatter keys are read loosely (`side`, `symbol`, `mint`, `size_usd|size`, `price`, `pnl`, `at|date`).
- **Degraded layers** are matched from `desk.log` lines containing `missing API key`, `llm off`, `402`,
  `disabled` or `public example key`.

## Remote access (iPhone)

Never expose deskview publicly: no port-forward, public tunnel or Tailscale Funnel. Use either:

- `tailscale serve --bg --https=443 http://127.0.0.1:3000` (tailnet only) to reach the **dashboard**, which
  talks to deskview over loopback and keeps the token on the server, or
- `ssh -L 3000:127.0.0.1:3000 <box>`.

Never forward 9222.

## Tests

```bash
.venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q
```

The fixture desk in `tests/conftest.py` follows the documented schema and is seeded with fake secrets (an
OpenAI-style key, a Telegram bot token, a FOMO JWT, the owner chat id). The tests check that:

- every route needs the bearer token and never returns any seeded secret
- no file under the desk root changes mtime or size
- path traversal into `data/` and `logs/raw` is refused
- the WebSocket snapshot always arrives first, and live deltas still arrive while REST calls run
- resume works, and unknown commands close the socket
