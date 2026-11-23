"""deskview HTTP + WebSocket service. Read-only by construction: every route is GET, every response is
redacted, and the only file it writes lives in DESKVIEW_STATE_DIR (its own equity series)."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, time as dtime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from . import timeutil as tu
from .chain import Chain
from .config import BOTS, Config
from .desk import Desk, classify
from .files import LOG_ALLOW
from .redact import redact, register_secret
from .series import Series

log = logging.getLogger("deskview")


class RedactedJSONResponse(JSONResponse):
    """Every JSON body passes through the single redaction function."""

    def render(self, content: Any) -> bytes:
        return json.dumps(redact(content), ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")


class RateLimit(BaseHTTPMiddleware):
    def __init__(self, app, per_s: float):
        super().__init__(app)
        self.per_s = per_s
        self.buckets: dict[str, tuple[float, float]] = {}

    async def dispatch(self, request: Request, call_next):
        key = request.client.host if request.client else "?"
        tokens, last = self.buckets.get(key, (self.per_s * 2, time.monotonic()))
        now = time.monotonic()
        tokens = min(self.per_s * 2, tokens + (now - last) * self.per_s)
        if tokens < 1:
            return RedactedJSONResponse({"detail": "rate limited"}, status_code=429)
        self.buckets[key] = (tokens - 1, now)
        resp = await call_next(request)
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        return resp


def _token_ok(cfg: Config, presented: str | None) -> bool:
    return bool(presented) and hmac.compare_digest(presented.encode(), cfg.token.encode())


# ─────────────────────────────── live hub ───────────────────────────────


class Client:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=500)
        self.logs: dict[str, int] = {}
        self.overflow = False


class Hub:
    def __init__(self):
        self.clients: set[Client] = set()

    def send(self, c: Client, frame: dict[str, Any], droppable: bool = False) -> None:
        try:
            c.queue.put_nowait(frame)
        except asyncio.QueueFull:
            if not droppable:
                c.overflow = True  # the client reconnects and resumes from its last event id

    def broadcast(self, type_: str, data: Any, droppable: bool = False) -> None:
        frame = {"type": type_, "ts": tu.now().isoformat(), "data": data}
        for c in list(self.clients):
            self.send(c, frame, droppable)


def frame(type_: str, data: Any) -> dict[str, Any]:
    return {"type": type_, "ts": tu.now().isoformat(), "data": data}


# ─────────────────────────────── app ───────────────────────────────


def create_app(cfg: Config) -> FastAPI:
    register_secret(cfg.token)
    desk = Desk(cfg)
    chain = Chain(cfg.fomo_public_address, cfg.rpc_urls, cfg.chain_enabled)
    series = Series(cfg.state_dir)
    hub = Hub()

    def refresh_private() -> None:
        for v in desk.files.private_values():
            register_secret(v)

    refresh_private()

    async def marks_for(mints: list[str]) -> dict[str, float]:
        mints = [m for m in mints if m]
        return await chain.prices(mints) if (cfg.chain_enabled and mints) else {}

    async def balance_view() -> dict[str, Any]:
        open_mints = await asyncio.to_thread(desk.open_mints)
        marks = await marks_for(open_mints)
        paper = await asyncio.to_thread(desk.paper, marks)
        return {"paper": paper, "chain": await chain.balance(), "desk_fomo_last": await asyncio.to_thread(desk.desk_fomo_last)}

    # ── background loops ──────────────────────────────────────────────
    async def tail_events():
        # Own cursor: REST handlers also refresh the shared cache, so "what refresh returned" is not
        # "what has been broadcast". Clients dedupe by id, so an overlap after a snapshot is harmless.
        await asyncio.to_thread(desk.cache.refresh, 0)
        sent = desk.cache.last_id
        while True:
            try:
                await asyncio.to_thread(desk.cache.refresh, 0)
                new = [e for e in desk.cache.snapshot() if e["id"] > sent]
                if new:
                    sent = new[-1]["id"]
                for e in new:
                    data = {"id": e["id"], "topic": e["topic"], "at": e.get("at"), "payload": e.get("payload")}
                    hub.broadcast("event", data)
                    kind = classify(e["topic"])
                    if kind != "event":
                        hub.broadcast(kind, data)
            except Exception:  # noqa: BLE001
                log.exception("event tail failed")
            await asyncio.sleep(cfg.poll_s)

    async def watch():
        files = desk.files
        watched = {
            "paper": [files.data / "paper_state.json"],
            "mode": [files.data / "acceptance_step14.json", cfg.vault / "Desk" / "Settings.md", files.data / "desk_paused.flag", *[files.data / f"paused_{b}.flag" for b in BOTS]],
            "health": [files.logs / "health.json"],
        }
        last: dict[str, Any] = {}
        tick = 0
        while True:
            try:
                for key, paths in watched.items():
                    sig = tuple(files.mtime(p) for p in paths)
                    if key in last and last[key] != sig:
                        if key == "paper":
                            hub.broadcast("balance", await balance_view())
                            hub.broadcast("position", await asyncio.to_thread(desk.positions, {}))
                        elif key == "mode":
                            hub.broadcast("mode", await asyncio.to_thread(desk.mode))
                        else:
                            hub.broadcast("health", await asyncio.to_thread(desk.health))
                    last[key] = sig
                if tick % 2 == 0:
                    marker = await asyncio.to_thread(desk.db.change_marker)
                    if "db" in last and last["db"] != marker:
                        hub.broadcast("position", await asyncio.to_thread(desk.positions, {}))
                    last["db"] = marker
                if tick % 5 == 0:
                    agents = await asyncio.to_thread(desk.agents)
                    states = [(a["name"], a["state"]) for a in agents]
                    if "agents" in last and last["agents"] != states:
                        hub.broadcast("agent", agents)
                    last["agents"] = states
                if tick % 15 == 0:
                    hub.broadcast("health", await asyncio.to_thread(desk.health))
                    hub.broadcast("heartbeat", {"clients": len(hub.clients), "last_event_id": desk.cache.last_id})
                if tick % 30 == 0 and cfg.chain_enabled:
                    hub.broadcast("balance", await balance_view())
                if tick % 60 == 0:
                    await asyncio.to_thread(refresh_private)
                    b = await balance_view()
                    await asyncio.to_thread(series.record, b["paper"]["night_id"], b["paper"]["equity"], b["paper"]["cash"], (b.get("chain") or {}).get("total_usd"))
            except Exception:  # noqa: BLE001
                log.exception("watcher failed")
            tick += 1
            await asyncio.sleep(1)

    async def tail_logs():
        while True:
            for c in list(hub.clients):
                for name, off in list(c.logs.items()):
                    lines, new_off = await asyncio.to_thread(desk.files.read_from, desk.files.log_path(name), off)
                    c.logs[name] = new_off
                    if lines:
                        hub.send(c, frame("log", {"bot": name, "lines": lines}), droppable=True)
            await asyncio.sleep(1)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks = [asyncio.create_task(f()) for f in (tail_events, watch, tail_logs)]
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()
            await chain.close()

    app = FastAPI(title="deskview", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None, default_response_class=RedactedJSONResponse, lifespan=lifespan)
    app.add_middleware(RateLimit, per_s=cfg.rate_limit_per_s)
    app.add_middleware(CORSMiddleware, allow_origins=list(cfg.allowed_origins), allow_methods=["GET"], allow_headers=["Authorization"], allow_credentials=False)

    @app.exception_handler(Exception)
    async def _err(request: Request, exc: Exception):  # never leak paths or stack traces
        log.exception("unhandled error on %s", request.url.path)
        return RedactedJSONResponse({"detail": "internal error"}, status_code=500)

    def require_auth(request: Request) -> None:
        h = request.headers.get("authorization", "")
        if not (h[:7].lower() == "bearer " and _token_ok(cfg, h[7:].strip())):
            raise HTTPException(status_code=401, detail="unauthorized", headers={"WWW-Authenticate": "Bearer"})

    api = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    @api.get("/health")
    def health():
        return desk.health()

    @api.get("/mode")
    def mode():
        return desk.mode()

    @api.get("/settings")
    def settings():
        return desk.files.settings()

    @api.get("/balance")
    async def balance():
        return await balance_view()

    @api.get("/positions")
    async def positions():
        marks = await marks_for(await asyncio.to_thread(desk.open_mints))
        return await asyncio.to_thread(desk.positions, marks)

    @api.get("/pnl")
    async def pnl(night: str | None = None):
        tonight = tu.current_night_id(lock_time=cfg.lock_time)
        night = night or tonight
        try:
            start = datetime.combine(date.fromisoformat(night), dtime(12, 0), tu.CHICAGO)
        except ValueError:
            raise HTTPException(400, "night must be YYYY-MM-DD")
        end = start + timedelta(days=1)
        trades = [t for t in await asyncio.to_thread(desk.trades, 0, 1000) if t["at"] and start.isoformat() <= t["at"] < end.isoformat()]
        if night == tonight:
            b = await balance_view()
            pos = await positions()
            unreal = sum(p["pnl_usd"] or 0 for p in pos if p.get("status") in (None, "open"))
            p = b["paper"]
            return {"night_id": night, "realized": p["realized_pnl"], "unrealized": unreal, "equity": p["equity"], "start": p["start_cash"], "pct": -p["loss_pct"], "by_trade": trades}
        hist = next((n for n in await asyncio.to_thread(desk.nights) if n["night_id"] == night), None)
        return {"night_id": night, "realized": hist["pnl"] if hist else None, "unrealized": None, "equity": hist["balance"] if hist else None, "start": None, "pct": None, "by_trade": trades}

    @api.get("/trades")
    def trades(since_id: int = 0, limit: int = Query(200, ge=1, le=1000)):
        return desk.trades(since_id, limit)

    @api.get("/discoveries")
    def discoveries(status: str | None = None, limit: int = Query(300, ge=1, le=1000)):
        return desk.discoveries(status, limit)

    @api.get("/coins/{mint}")
    def coin(mint: str):
        if not mint.isalnum() or len(mint) > 64:
            raise HTTPException(400, "bad mint")
        c = desk.coin(mint)
        if not c:
            raise HTTPException(404, "not found")
        return c

    @api.get("/events")
    def events(after_id: int = 0, topic: str | None = None, limit: int = Query(200, ge=1, le=500)):
        if after_id == 0:
            after_id = max(0, desk.db.max_event_id() - limit)
        rows = desk.db.events_after(after_id, limit)
        if topic:
            rows = [r for r in rows if r["topic"] == topic or r["topic"].startswith(topic + ".")]
        return [{"id": r["id"], "topic": r["topic"], "at": tu.iso(r.get("created_at")), "payload": r.get("payload")} for r in rows]

    @api.get("/agents")
    def agents():
        return desk.agents()

    @api.get("/alerts")
    def alerts(limit: int = Query(100, ge=1, le=500)):
        return desk.alerts(limit)

    @api.get("/pushes")
    def pushes(limit: int = Query(100, ge=1, le=500)):
        return desk.files.pushes(limit)

    @api.get("/logs/{bot}")
    def logs(bot: str, tail: int = Query(200, ge=1, le=2000)):
        if bot not in LOG_ALLOW:
            raise HTTPException(404, "not found")
        return desk.files.log_tail(bot, tail)

    @api.get("/history/nights")
    def nights():
        return desk.nights()

    @api.get("/wallets")
    def wallets():
        return desk.wallets()

    @api.get("/lessons")
    def lessons():
        return desk.lessons()

    @api.get("/frames/latest")
    def frame_latest():
        p = desk.files.latest_frame()
        if not p:
            raise HTTPException(404, "no frames")
        return FileResponse(p, media_type="image/png", headers={"Cache-Control": "no-store"})

    @api.get("/snapshot")
    def snapshot():
        return desk.files.dashboard() or {}

    @api.get("/series")
    def get_series(since: int = 0):
        return series.read(since)

    app.include_router(api)

    @app.get("/")
    def root():  # unauthenticated liveness only; no data
        return {"service": "deskview", "ok": True}

    # ── WebSocket ─────────────────────────────────────────────────────
    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        origin = socket.headers.get("origin")
        if origin is not None and origin not in cfg.allowed_origins:
            await socket.close(code=1008)
            return
        await socket.accept()
        try:
            first = await asyncio.wait_for(socket.receive_json(), timeout=5)
        except (asyncio.TimeoutError, ValueError, WebSocketDisconnect):
            with contextlib.suppress(Exception):
                await socket.close(code=1008)
            return
        if not (isinstance(first, dict) and first.get("type") == "auth" and _token_ok(cfg, str(first.get("token") or ""))):
            await socket.close(code=1008)
            return
        client = Client(socket)
        await asyncio.to_thread(desk.cache.refresh, 0)
        # Snapshot is queued before the client joins the hub, so it is always the first frame.
        hub.send(client, frame("snapshot", {
            "dashboard": desk.files.dashboard() or {},
            "mode": await asyncio.to_thread(desk.mode),
            "balance": await balance_view(),
            "agents": await asyncio.to_thread(desk.agents),
            "health": await asyncio.to_thread(desk.health),
            "last_event_id": desk.cache.last_id,
        }))
        hub.clients.add(client)

        async def sender():
            while True:
                if client.overflow:
                    await socket.close(code=1013)
                    return
                f = await client.queue.get()
                await socket.send_text(json.dumps(redact(f), default=str))

        send_task = asyncio.create_task(sender())
        try:
            while True:
                msg = await socket.receive_json()
                if not isinstance(msg, dict):
                    break
                if msg.get("type") == "resume" or "after_id" in msg:
                    after = int(msg.get("after_id") or 0)
                    for _ in range(4):
                        rows = await asyncio.to_thread(desk.db.events_after, after, 500)
                        for r in rows:
                            hub.send(client, frame("event", {"id": r["id"], "topic": r["topic"], "at": tu.iso(r.get("created_at")), "payload": r.get("payload")}))
                            after = r["id"]
                        if len(rows) < 500:
                            break
                elif "subscribe" in msg:
                    for item in msg.get("subscribe") or []:
                        name = str(item).removeprefix("log:")
                        if name in LOG_ALLOW and len(client.logs) < 6:
                            p = desk.files.log_path(name)
                            client.logs[name] = desk.files.mtime(p) and p.stat().st_size or 0
                elif msg.get("type") == "auth":
                    continue
                else:
                    break  # anything outside auth/subscribe/resume closes the socket
        except (WebSocketDisconnect, ValueError):
            pass
        finally:
            hub.clients.discard(client)
            send_task.cancel()
            with contextlib.suppress(Exception):
                await socket.close(code=1008)

    app.state.desk = desk
    app.state.hub = hub
    return app


def app_from_env() -> FastAPI:
    return create_app(Config.from_env())
