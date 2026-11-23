"""A fixture desk shaped like docs/dashboard_integration.md §2, seeded with secrets that must never leak."""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TOKEN = "test-deskview-token-0123456789abcdef"
SECRETS = {
    "OPENAI_API_KEY": "sk-live-SECRETVALUE1234567890abcd",
    "TELEGRAM_BOT_TOKEN": "bot123456789:AAHsecretTelegramValue_abcdefghij",
    "FINANCIAL_DATASETS_API_KEY": "fd-SECRET-ffffffffffffffff",
}
CHAT_ID = "998877665544"
FOMO_BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb21vIn0.c2lnbmF0dXJlc2VjcmV0"

SCHEMA = """
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, payload TEXT, created_at TEXT, consumed INTEGER DEFAULT 0);
CREATE TABLE coins (mint TEXT PRIMARY KEY, symbol TEXT, name TEXT, creator TEXT, pool TEXT, status TEXT, first_seen TEXT, migrated_at TEXT,
  liquidity REAL, top10 REAL, holders INTEGER, price REAL, kill_rule TEXT, layers TEXT, score REAL, bull TEXT, bear TEXT, size_usd REAL,
  cap_usd REAL, notes_path TEXT, updated_at TEXT);
CREATE TABLE waiting (mint TEXT PRIMARY KEY, symbol TEXT, creator TEXT, creator_balance REAL, pool TEXT, arrived_at TEXT, last_holders INTEGER, last_check TEXT, raw TEXT);
CREATE TABLE wallets (address TEXT PRIMARY KEY, short TEXT, wins INTEGER, losses INTEGER, last_move TEXT, notes_path TEXT, updated_at TEXT);
CREATE TABLE rugs (mint TEXT PRIMARY KEY, reason TEXT, seen_at TEXT);
CREATE TABLE positions (mint TEXT PRIMARY KEY, symbol TEXT, source TEXT, qty REAL, avg_price REAL, usd_in REAL, opened_at TEXT, stop_pct REAL,
  trail_pct REAL, peak_price REAL, status TEXT);
CREATE TABLE trades (id INTEGER PRIMARY KEY, mint TEXT, symbol TEXT, side TEXT, size TEXT, price REAL, pnl TEXT, notes_path TEXT, created_at TEXT);
CREATE TABLE holder_samples (id INTEGER PRIMARY KEY, mint TEXT, holders INTEGER, sampled_at TEXT);
"""


def build_desk(root: Path) -> None:
    (root / "data" / "frames").mkdir(parents=True)
    (root / "logs" / "raw").mkdir(parents=True)
    vault = root / "vault" / "Overnight Desk"
    for d in ("Coins", "Wallets", "Trades", "Daily", "Lessons", "Desk", "Templates"):
        (vault / d).mkdir(parents=True)

    con = sqlite3.connect(root / "desk.db")
    con.executescript(SCHEMA)
    ev = [
        ("scanner.new_token", {"mint": "MINTaaa111", "symbol": "AAA"}),
        ("scanner.migration", {"mint": "MINTaaa111", "symbol": "AAA"}),
        ("scanner.kill", {"mint": "MINTbbb222", "symbol": "BBB", "reason": "top10 > 40%", "token": FOMO_BEARER}),
        ("scanner.pass", {"mint": "MINTaaa111", "symbol": "AAA", "note": "Authorization: Bearer " + FOMO_BEARER}),
        ("analyst.pass", {"mint": "MINTaaa111", "symbol": "AAA"}),
        ("brain.sized", {"mint": "MINTaaa111", "symbol": "AAA", "size_usd": 12}),
        ("risk.block", {"mint": "MINTaaa111", "symbol": "AAA", "reason": "night limit"}),
        ("executor.unverified", {"mint": "MINTccc333", "symbol": "CCC", "message": "screen/api/chain mismatch " + SECRETS["OPENAI_API_KEY"]}),
    ]
    con.executemany("INSERT INTO events (topic, payload, created_at) VALUES (?, ?, ?)", [(t, json.dumps(p), "2026-11-23 00:4%d:00 CST" % i) for i, (t, p) in enumerate(ev)])
    con.execute("INSERT INTO coins VALUES ('MINTaaa111','AAA','Alpha','CREATOR','POOL','passed','2026-11-23 00:30:00 CST','2026-11-23 00:31:00 CST',52000,0.21,812,0.00042,NULL,'5/5',82,'bull case','bear case',12,40,'Coins/AAA.md','2026-11-23 00:44:00 CST')")
    con.execute("INSERT INTO coins VALUES ('MINTbbb222','BBB','Beta','C2','P2','killed','2026-11-23 00:32:00 CST',NULL,9000,0.55,120,0.00001,'top10',NULL,21,NULL,NULL,NULL,NULL,'../../data/telegram_chat.json','2026-11-23 00:42:00 CST')")
    con.execute("INSERT INTO waiting VALUES ('MINTddd444','DDD','C4',1.5,'P4','2026-11-23 00:46:00 CST',300,'2026-11-23 00:47:00 CST','{\"apiKey\": \"x\"}')")
    con.execute("INSERT INTO wallets VALUES ('WALLETxyz','Wxyz',5,2,'2026-11-22 23:10:00 CST','Wallets/Wxyz.md','2026-11-23 00:10:00 CST')")
    con.executemany("INSERT INTO holder_samples (mint, holders, sampled_at) VALUES (?, ?, ?)", [("MINTaaa111", 700, "2026-11-23 00:35:00 CST"), ("MINTaaa111", 812, "2026-11-23 00:44:00 CST")])
    con.commit()
    con.close()

    (root / "links.py").write_text("def coin_url(mint):\n    return f'https://fomo.example/coin/{mint}?ref=savipew'\n")
    data = root / "data"
    (data / "paper_state.json").write_text(json.dumps({"night_id": "2026-11-21", "start_cash": 100, "cash": 61.5, "positions": {"MINTzzz": {"symbol": "CATE", "qty": 10, "usd_in": 38.5}}, "trades_night": 2, "realized_pnl": 1.2}))
    (data / "acceptance_step14.json").write_text(json.dumps({"passed": False, "reason": "2 tests failing", "at": "2026-11-23 06:45:00 CST", "mode": "paper", "effective_mode": "paper",
        "tests": [{"name": "verify_chain", "passed": True}, {"name": "withdraw_refusal", "passed": False}, {"name": "live_click", "status": "blocked"}]}))
    (data / "dashboard.json").write_text(json.dumps({"asOf": "2026-11-23 01:00:00 CST", "status": "running", "balance": 100, "session_cookie": "SHOULD_BE_DROPPED"}))
    (data / "pushes.jsonl").write_text("\n".join(json.dumps(x) for x in [{"text": "Night started", "button": "https://fomo.example/?ref=savipew", "dry_run": False}, {"text": "test", "button": None, "dry_run": True}]) + "\n")
    (data / "telegram_chat.json").write_text(json.dumps({"chat_id": CHAT_ID}))
    (data / "owner_hold.json").write_text(json.dumps({"hold": True, "chat": CHAT_ID}))
    (data / "click_lane.json").write_text(json.dumps({"holder": "risk", "what": "sell", "at": "2026-11-23 00:40:00 CST"}))
    (data / "frames" / "paper-buy-CATE.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    logs = root / "logs"
    (logs / "desk.log").write_text(
        "2026-11-23 00:25:04 CST [desk] starting until lock\n"
        "2026-11-23 00:25:05 CST [desk] missing API keys: GMGN_API_KEY (using public example key)\n"
        "2026-11-23 00:25:05 CST [llm] llm off: FINANCIAL_DATASETS 402\n"
        f"2026-11-23 00:25:06 CST [fomo] captured {FOMO_BEARER}\n"
        f"2026-11-23 00:25:07 CST [telegram] token {SECRETS['TELEGRAM_BOT_TOKEN']} chat {CHAT_ID}\n"
    )
    (logs / "fomo.log").write_text("2026-11-23 00:17:00 CST [fomo] balances cash=0.0 holdings=0\n")
    for b in ("scanner", "analyst", "brain", "executor", "risk", "bus"):
        (logs / f"{b}.log").write_text(f"2026-11-23 00:40:00 CST [{b}] alive\n")
    (logs / "health.json").write_text(json.dumps({"ok": False, "chrome": {"pid": 30947}, "problems": ["running desk predates heartbeats"]}))
    (logs / "raw" / "fomo_balances.json").write_text(json.dumps({"auth": FOMO_BEARER}))

    (vault / "Desk" / "Settings.md").write_text("---\nmode: paper\nfomo_handle: savipew\npaper_start_cash: 100\nnight_start: '22:00'\nlock_time: '06:30'\nrisk:\n  poll_s: 5\n  night_loss_pct: 0.15\ntelegram_token: SHOULD_BE_DROPPED\n---\n# Settings\n")
    (vault / "Trades" / "CATE buy.md").write_text("---\nside: buy\nsymbol: CATE\nmint: MINTzzz\nsize_usd: 20\nprice: 0.0021\nat: 2026-11-21 23:10:00 CST\nreason: test trade\n---\nBought.\n")
    (vault / "Trades" / "CATE sell.md").write_text("---\nside: sell\nsymbol: CATE\nmint: MINTzzz\nsize_usd: 21.2\npnl: $1.20\nat: 2026-11-21 23:50:00 CST\n---\nSold.\n")
    (vault / "Daily" / "2026-11-22.md").write_text("---\nnight: 2026-11-22\nbalance: 101.2\npnl: 1.2\ntrades: 2\nwins: 1\nlosses: 0\n---\n# Morning report\nQuiet night, one paper round trip.\n")
    (vault / "Wallets" / "Wxyz.md").write_text("---\naddress: WALLETxyz\ncold: true\n---\n")
    (vault / "Lessons" / "smoke-test.md").write_text("---\ntag: smoke-test\nhits: 0\narchived: false\n---\nCheck slippage before size.\n")
    (vault / "Coins" / "AAA.md").write_text("---\nmint: MINTaaa111\nstatus: passed\n---\nAAA passed 5/5 layers.\n")


def tree_fingerprint(root: Path) -> dict[str, tuple[float, int]]:
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            p = Path(dirpath) / f
            st = p.stat()
            out[str(p.relative_to(root))] = (st.st_mtime_ns, st.st_size)
    return out


@pytest.fixture()
def desk_root(tmp_path: Path) -> Path:
    root = tmp_path / "desk"
    root.mkdir()
    build_desk(root)
    return root


@pytest.fixture()
def env(tmp_path: Path, desk_root: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    e = {
        "DESKVIEW_DESK_ROOT": str(desk_root),
        "DESKVIEW_STATE_DIR": str(tmp_path / "desk-dash" / "state"),
        "DESKVIEW_TOKEN": TOKEN,
        "DESKVIEW_CHAIN_ENABLED": "0",
        "DESKVIEW_ALLOWED_ORIGINS": "http://localhost:3000",
        **SECRETS,
    }
    for k, v in e.items():
        monkeypatch.setenv(k, v)
    return e


@pytest.fixture()
def client(env) -> TestClient:
    from deskview.app import create_app
    from deskview.config import Config

    app = create_app(Config.from_env())
    with TestClient(app) as c:
        yield c


AUTH = {"Authorization": f"Bearer {TOKEN}"}
