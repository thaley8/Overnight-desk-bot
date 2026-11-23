from __future__ import annotations

import json
import sqlite3

import pytest

from deskview.config import Config, ConfigError
from deskview.redact import redact, redact_text

from .conftest import AUTH, CHAT_ID, FOMO_BEARER, SECRETS, TOKEN, tree_fingerprint

GET_ROUTES = [
    "/api/v1/health", "/api/v1/mode", "/api/v1/settings", "/api/v1/balance", "/api/v1/positions", "/api/v1/pnl",
    "/api/v1/pnl?night=2026-11-21", "/api/v1/trades", "/api/v1/discoveries", "/api/v1/coins/MINTaaa111", "/api/v1/coins/MINTbbb222",
    "/api/v1/events", "/api/v1/events?topic=scanner", "/api/v1/agents", "/api/v1/alerts", "/api/v1/pushes", "/api/v1/logs/desk",
    "/api/v1/logs/telegram", "/api/v1/history/nights", "/api/v1/wallets", "/api/v1/lessons", "/api/v1/frames/latest", "/api/v1/snapshot",
    "/api/v1/series",
]
NEVER = [TOKEN, CHAT_ID, FOMO_BEARER, *SECRETS.values(), "SHOULD_BE_DROPPED"]


@pytest.mark.parametrize("route", GET_ROUTES)
def test_requires_bearer(client, route):
    assert client.get(route).status_code == 401
    assert client.get(route, headers={"Authorization": "Bearer wrong-token-wrong-token-xx"}).status_code == 401
    assert client.get(route.split("?")[0] + "?token=" + TOKEN).status_code == 401  # never via query string


@pytest.mark.parametrize("route", GET_ROUTES)
def test_routes_ok_and_leak_nothing(client, route):
    r = client.get(route, headers=AUTH)
    assert r.status_code == 200, (route, r.text)
    body = r.content.decode("latin-1")
    for secret in NEVER:
        assert secret not in body, (route, secret[:8])
    assert r.headers["cache-control"] == "no-store"


def test_read_only_desk_untouched(client, desk_root):
    before = tree_fingerprint(desk_root)
    for route in GET_ROUTES:
        client.get(route, headers=AUTH)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": TOKEN})
        assert ws.receive_json()["type"] == "snapshot"
    assert tree_fingerprint(desk_root) == before
    assert not (desk_root / "desk.db-journal").exists()


def test_mode_and_live_gate(client):
    m = client.get("/api/v1/mode", headers=AUTH).json()
    assert m["settings_mode"] == "paper" and m["effective_mode"] == "paper"
    assert m["live_gate"]["passed"] is False
    assert m["live_gate"]["failed"] == ["withdraw_refusal"] and m["live_gate"]["blocked"] == ["live_click"]


def test_live_requires_gate(client, desk_root):
    s = desk_root / "vault/Overnight Desk/Desk/Settings.md"
    s.write_text(s.read_text().replace("mode: paper", "mode: live"))
    m = client.get("/api/v1/mode", headers=AUTH).json()
    assert m["settings_mode"] == "live" and m["effective_mode"] == "paper"  # gate not passed → never LIVE


def test_stale_paper_state_reports_fresh_night(client):
    p = client.get("/api/v1/balance", headers=AUTH).json()["paper"]
    assert p["stale_file"] is True and p["file_night_id"] == "2026-11-21"
    assert p["cash"] == 100 and p["equity"] == 100 and p["trades_night"] == 0


def test_current_paper_state(client, desk_root):
    from deskview.timeutil import current_night_id

    st = desk_root / "data/paper_state.json"
    d = json.loads(st.read_text())
    d["night_id"] = current_night_id()
    st.write_text(json.dumps(d))
    p = client.get("/api/v1/balance", headers=AUTH).json()["paper"]
    assert p["stale_file"] is False and p["cash"] == 61.5 and p["equity"] == pytest.approx(100.0) and p["trades_night"] == 2
    pos = client.get("/api/v1/positions", headers=AUTH).json()
    assert any(x["mint"] == "MINTzzz" and x["source"] == "paper" for x in pos)


def test_trades_merge_vault(client):
    t = client.get("/api/v1/trades", headers=AUTH).json()
    assert [x["side"] for x in t] == ["sell", "buy"]
    assert t[0]["pnl"] == 1.2 and t[0]["source"] == "vault" and t[0]["at"].endswith("-06:00")


def test_discoveries_and_links(client):
    rows = client.get("/api/v1/discoveries", headers=AUTH).json()
    by = {r["mint"]: r for r in rows}
    assert by["MINTddd444"]["status"] == "waiting"
    assert by["MINTaaa111"]["holders"] == 812
    assert by["MINTaaa111"]["fomo_url"] == "https://fomo.example/coin/MINTaaa111?ref=savipew"
    assert "raw" not in by["MINTddd444"]


def test_vault_path_escape_blocked(client):
    c = client.get("/api/v1/coins/MINTbbb222", headers=AUTH).json()
    assert c["note_md"] is None
    a = client.get("/api/v1/coins/MINTaaa111", headers=AUTH).json()
    assert "5/5" in a["note_md"] and [h["holders"] for h in a["holders_series"]] == [700, 812]


@pytest.mark.parametrize("path", ["/api/v1/logs/..%2Fdata%2Ftelegram_chat", "/api/v1/logs/raw", "/api/v1/logs/..", "/api/v1/coins/..%2F..%2Fx"])
def test_path_traversal(client, path):
    assert client.get(path, headers=AUTH).status_code in (400, 404)


def test_agents_and_alerts(client):
    agents = {a["name"]: a for a in client.get("/api/v1/agents", headers=AUTH).json()}
    assert set(agents) == {"scanner", "analyst", "brain", "executor", "risk"}
    assert agents["scanner"]["state"] == "stopped"  # no desk.py process in the test container
    assert agents["risk"]["last_event"]["topic"] == "risk.block"
    alerts = client.get("/api/v1/alerts", headers=AUTH).json()
    kinds = {a["kind"] for a in alerts}
    assert {"risk.block", "executor.unverified", "health.problem"} <= kinds
    crit = next(a for a in alerts if a["kind"] == "executor.unverified")
    assert crit["level"] == "crit" and SECRETS["OPENAI_API_KEY"] not in crit["message"]


def test_health_degraded_layers(client):
    h = client.get("/api/v1/health", headers=AUTH).json()
    msgs = " ".join(x["message"] for x in h["degraded_layers"])
    assert "GMGN_API_KEY" in msgs and "402" in msgs
    assert h["desk"]["running"] is False and "running desk predates heartbeats" in h["problems"]


def test_balance_desk_fomo_last(client):
    b = client.get("/api/v1/balance", headers=AUTH).json()
    assert b["desk_fomo_last"]["cash"] == 0.0 and b["chain"]["error"].startswith("disabled")


def test_logs_redacted(client):
    lines = client.get("/api/v1/logs/desk", headers=AUTH).json()["lines"]
    assert any("[redacted]" in ln for ln in lines)


def test_settings_drop_secret_keys(client):
    s = client.get("/api/v1/settings", headers=AUTH).json()
    assert s["mode"] == "paper" and "telegram_token" not in s and s["risk"]["poll_s"] == 5


def test_pushes_keep_dry_run_flag(client):
    p = client.get("/api/v1/pushes", headers=AUTH).json()
    assert [x["dry_run"] for x in p] == [True, False]


def test_nights_history(client):
    n = client.get("/api/v1/history/nights", headers=AUTH).json()
    assert n == [{"night_id": "2026-11-22", "balance": 101.2, "pnl": 1.2, "trades": 2, "wins": 1, "losses": 0, "note": "Quiet night, one paper round trip.", "path": "Daily/2026-11-22.md"}]


def test_frame_served(client):
    r = client.get("/api/v1/frames/latest", headers=AUTH)
    assert r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")


def test_cors_allow_list(client):
    ok = client.options("/api/v1/mode", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = client.options("/api/v1/mode", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


def test_no_write_methods(client):
    for m in ("post", "put", "delete", "patch"):
        assert getattr(client, m)("/api/v1/mode", headers=AUTH).status_code == 405


def test_rate_limit(env):
    from fastapi.testclient import TestClient

    from deskview.app import create_app

    app = create_app(Config.from_env())
    with TestClient(app) as c:
        codes = [c.get("/api/v1/mode", headers=AUTH).status_code for _ in range(80)]
    assert 429 in codes


# ── WebSocket ────────────────────────────────────────────────────────────


def test_ws_rejects_bad_origin(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_ws_requires_auth_message(client):
    from starlette.websockets import WebSocketDisconnect

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": "nope-nope-nope-nope-nope"})
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_ws_snapshot_live_event_and_resume(client, desk_root):
    with client.websocket_connect("/ws", headers={"origin": "http://localhost:3000"}) as ws:
        ws.send_json({"type": "auth", "token": TOKEN})
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and snap["data"]["mode"]["effective_mode"] == "paper"
        last = snap["data"]["last_event_id"]
        client.get("/api/v1/agents", headers=AUTH)  # REST refreshes the shared cache; must not swallow the delta
        # The desk (not deskview) appends a bus event.
        con = sqlite3.connect(desk_root / "desk.db")
        con.execute("INSERT INTO events (topic, payload, created_at) VALUES ('executor.bought', ?, '2026-11-23 01:10:00 CST')", (json.dumps({"mint": "MINTaaa111", "symbol": "AAA", "cookie": "x"}),))
        con.commit()
        con.close()
        client.get("/api/v1/alerts", headers=AUTH)
        got = set()
        for _ in range(40):
            f = ws.receive_json()
            if f["type"] in ("event", "trade") and f["data"]["id"] == last + 1:
                assert "cookie" not in f["data"]["payload"]
                got.add(f["type"])
            if got == {"event", "trade"}:
                break
        assert got == {"event", "trade"}
        ws.send_json({"type": "resume", "after_id": 0})
        ids = []
        while len(ids) < last + 1:
            f = ws.receive_json()
            if f["type"] == "event":
                ids.append(f["data"]["id"])
        assert ids[:3] == [1, 2, 3]


def test_ws_unknown_message_closes(client):
    from starlette.websockets import WebSocketDisconnect

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": TOKEN})
        ws.receive_json()
        ws.send_json({"type": "command", "verb": "sell"})
        with pytest.raises(WebSocketDisconnect):
            for _ in range(50):
                ws.receive_json()


# ── config & redaction units ─────────────────────────────────────────────


def test_config_guards(tmp_path):
    base = {"DESKVIEW_DESK_ROOT": str(tmp_path), "DESKVIEW_TOKEN": TOKEN}
    with pytest.raises(ConfigError):
        Config.from_env({**base, "DESKVIEW_STATE_DIR": str(tmp_path / "state")})
    with pytest.raises(ConfigError):
        Config.from_env({**base, "DESKVIEW_TOKEN": "short", "DESKVIEW_STATE_DIR": "/tmp/x"})
    tok = tmp_path / "token"
    tok.write_text(TOKEN)
    tok.chmod(0o644)
    with pytest.raises(ConfigError):
        Config.from_env({"DESKVIEW_DESK_ROOT": str(tmp_path / "d"), "DESKVIEW_TOKEN_FILE": str(tok), "DESKVIEW_STATE_DIR": str(tmp_path / "s")})


def test_redaction_units(env):
    assert redact({"apiKey": 1, "Authorization": "x", "session_id": 2, "symbol": "AAA"}) == {"symbol": "AAA"}
    assert "[redacted]" in redact_text("Bearer abcdefghijklmnop")
    assert SECRETS["FINANCIAL_DATASETS_API_KEY"] not in redact_text("key=" + SECRETS["FINANCIAL_DATASETS_API_KEY"])
    assert redact_text("price=0.0042 symbol=AAA") == "price=0.0042 symbol=AAA"


def test_cli_refuses_public_bind(monkeypatch):
    import sys

    from deskview.__main__ import main

    monkeypatch.setattr(sys, "argv", ["deskview", "--host", "0.0.0.0"])
    with pytest.raises(SystemExit) as e:
        main()
    assert "loopback" in str(e.value)
