# Overnight Desk — web dashboard

Next.js 16 (App Router), React 19, Tailwind CSS v4, hand-built SVG charts. Design plan: [`../docs/DESIGN.md`](../docs/DESIGN.md).

## Data sources

The server's `GET /api/status` picks the source once per page load:

| `DESKVIEW_URL` | Source | Badge | Controls |
| --- | --- | --- | --- |
| set | `DeskviewSource` (`lib/data/deskview.ts`) | the desk's `effective_mode` (PAPER / LIVE) | none, read-only |
| unset | `DemoSource` (`lib/demo/*`), simulated | DEMO, with a banner on every page | simulator only |

If `DESKVIEW_URL` is set but deskview is down, the page shows a red "deskview unreachable" banner. It never
falls back to demo data.

## Server-side bridge (token never reaches the browser)

- `lib/server/deskview.ts` reads `DESKVIEW_URL` (must be loopback) and the token from `DESKVIEW_TOKEN` or
  `DESKVIEW_TOKEN_FILE` (default `~/.config/deskview/token`; it must be `chmod 600`).
- `app/api/desk/[...path]`: GET only. It forwards an allow-listed set of deskview paths and query keys.
- `app/api/desk/stream`: Server-Sent Events. The server opens deskview's WebSocket, sends the auth message and
  relays frames. The browser can pass only a resume cursor.

## Run

```bash
npm ci
npm run dev                                   # demo simulator
DESKVIEW_URL=http://127.0.0.1:8787 npm run build && DESKVIEW_URL=http://127.0.0.1:8787 npx next start -H 127.0.0.1
```

Times are shown in Chicago time (CT), the desk's zone. The header "Session" shows the desk's night window
(22:00 → 06:30 CT).

## Layout

```
app/                  thin routes + api/status, api/desk/[...path], api/desk/stream
components/shell      sidebar, header, mode badge, banners, notifications, ⌘K search
components/ui         primitives (incl. Gap for missing data), DataTable, Drawer/Dialog, toasts
components/charts     SVG line/area, bars, sparkline, calendar heatmap, allocation, uptime
components/features   one module per page; each handles demo and deskview data
lib/data              DataSource interface + DeskviewSource
lib/demo              seeded demo generator + simulator
lib/server            server-only deskview config/fetch
```
