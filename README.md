# Overnight Desk — dashboard

A read-only operator dashboard for the Overnight Desk (the five-bot desk running on the Grok Bot box).

```
 desk.py (5 bot threads) ─writes─► desk.db · data/*.json · logs/*.log · vault/
                                         │ read-only
                                         ▼
                      deskview  (Python, 127.0.0.1:8787, bearer token)
                                         │ loopback
                                         ▼
           web  (Next.js, 127.0.0.1:3000)  ── token stays here, server-side
             /api/desk/*      GET-only allow-listed proxy
             /api/desk/stream SSE bridge from deskview's WebSocket
                                         │ tailnet / SSH tunnel only
                                         ▼
                                 your browser / iPhone
```

| Folder | What it is |
| --- | --- |
| [`deskview/`](deskview/README.md) | Read-only FastAPI + WebSocket service over the desk's db, files, logs and vault. Phases 0–5 of [`docs/dashboard_integration.md`](docs/dashboard_integration.md). |
| [`web/`](web/README.md) | The dashboard. Uses deskview when `DESKVIEW_URL` is set; otherwise a clearly labelled demo simulator. |
| [`docs/`](docs) | Integration design (`dashboard_integration.md`) and visual design plan (`DESIGN.md`). |

## Guarantees

- **Read-only, end to end.** deskview exposes only GET routes. The dashboard's proxy only forwards GET requests to
  an allow-list of paths. In deskview mode, every control (close, pause, limits, agent toggles, acknowledge) is
  hidden or disabled, and the data source refuses actions as well. Pause, sell and mode changes stay on Telegram.
  §8 controls are **not** built.
- **The badge never decides the mode.** It shows `effective_mode` from the desk: LIVE only if `Settings.md`
  says `live` **and** `acceptance_step14.json.passed` is true. If deskview is down, the dashboard says so in red;
  it never falls back to demo figures.
- **No invented numbers.** Anything the desk doesn't record (equity history before deskview starts sampling, per-provider
  latency, transfers, price changes) is shown as a labelled gap, not estimated.
- **Secrets never reach a browser.** The bearer token lives only on the server. A browser test checks every
  response for the token, the Telegram chat ID, API keys and the FOMO JWT.
- **Never touches CDP 9222.** deskview checks that the port is listening by reading `/proc/net/tcp`, without connecting.

## Run on the box

```bash
# 1. deskview  (see deskview/README.md for every variable)
cd /workspace/desk-dash/deskview
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
mkdir -p ~/.config/deskview && (umask 077; python3 -c "import secrets;print(secrets.token_urlsafe(32))" > ~/.config/deskview/token)
DESKVIEW_FOMO_ADDRESS=<public address> .venv/bin/python -m deskview --port 8787

# 2. dashboard
cd /workspace/desk-dash/web
npm ci && npm run build
DESKVIEW_URL=http://127.0.0.1:8787 npx next start -H 127.0.0.1 -p 3000
```

The dashboard reads the same token file (`DESKVIEW_TOKEN_FILE`, default `~/.config/deskview/token`, must be
`chmod 600`) or `DESKVIEW_TOKEN`.

**Remote / iPhone:** `tailscale serve --bg --https=443 http://127.0.0.1:3000` (tailnet only) or
`ssh -L 3000:127.0.0.1:3000 <box>`. Never use a public tunnel or Funnel, and never forward 9222. The dashboard has
no login of its own, so anyone who can reach port 3000 can read the desk. Keep it behind the tailnet or SSH.

## Tests

- `deskview/`: `.venv/bin/python -m pytest -q`. 80 tests against a fixture desk seeded with fake secrets: auth on
  every route, no secret in any response, desk files unchanged, path traversal refused, WebSocket ordering, resume.
- `web/`: `npm run lint`, `npx tsc --noEmit`, `npm run build`. Browser end-to-end checks were run in development
  for both modes (57 demo checks, 20 deskview checks). They aren't committed yet.

## What to check on the real box (I could only test against a fixture)

1. Frontmatter key names in `vault/Trades/*.md` and `Daily/*.md` (deskview reads common variants; see its README).
2. The shape of `acceptance_step14.json.tests[]` items (`name`/`passed`/`status` assumed).
3. Whether `paper_state.json.positions` is keyed by mint.
4. Desk write latency with deskview running. Watch `bus.log` cadence, as Phase 5 describes.
5. `ss -tp` shows no deskview connection to `:9222` or `prod-api.fomo.family`.
