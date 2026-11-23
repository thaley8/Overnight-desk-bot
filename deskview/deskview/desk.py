"""Domain view of the desk built only from read-only sources (db, allow-listed files, vault, /proc)."""

from __future__ import annotations

import importlib.util
import os
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable

from . import timeutil as tu
from .config import BOTS, Config
from .db import DeskDB
from .files import Files
from .redact import redact_text

ALERT_TOPICS = {
    "risk.block": "warn",
    "risk.unverified": "crit",
    "executor.unverified": "crit",
    "risk.error": "crit",
    "executor.error": "crit",
    "fomo.logged_out": "crit",
}
DISCOVERY = {"scanner.new_token", "scanner.migration", "scanner.pass", "scanner.kill", "scanner.curve_complete"}
DECISION = {"analyst.pass", "analyst.reject", "brain.sized", "brain.skip", "risk.ok", "risk.block"}
TRADE = {"executor.bought", "risk.sold"}

# What each bot consumes / passes / rejects, by bus topic (doc §1).
AGENT_COUNTS: dict[str, dict[str, tuple[str, ...]]] = {
    "scanner": {"in": ("scanner.new_token", "scanner.migration"), "pass": ("scanner.pass",), "reject": ("scanner.kill",)},
    "analyst": {"in": ("scanner.pass",), "pass": ("analyst.pass",), "reject": ("analyst.reject",)},
    "brain": {"in": ("analyst.pass",), "pass": ("brain.sized",), "reject": ("brain.skip",)},
    "executor": {"in": ("brain.sized",), "pass": ("executor.bought",), "reject": ("executor.skip", "executor.error", "executor.unverified")},
    "risk": {"in": ("brain.sized", "executor.bought"), "pass": ("risk.ok", "risk.sold"), "reject": ("risk.block",)},
}


def classify(topic: str) -> str:
    if topic in ALERT_TOPICS:
        return "alert"
    if topic in TRADE:
        return "trade"
    if topic in DISCOVERY:
        return "discovery"
    if topic in DECISION:
        return "decision"
    return "event"


def money(v: Any) -> float | None:
    """'$1.20', '-$0.40', '−$3', 1.2 → float."""
    if isinstance(v, (int, float)):
        return float(v)
    if not isinstance(v, str):
        return None
    s = v.replace("−", "-").replace(",", "").replace("$", "").strip()
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def first(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


class EventCache:
    """Tails desk.db.events by id into memory (last N), so agents/alerts/counts cost no extra db reads."""

    def __init__(self, db: DeskDB, size: int = 5000):
        self.db = db
        self.events: deque[dict[str, Any]] = deque(maxlen=size)
        self.last_id = 0
        self._lock = threading.Lock()
        self._last_refresh = 0.0
        self._primed = False
        self._loaded = False

    def refresh(self, min_interval: float = 1.0) -> list[dict[str, Any]]:
        with self._lock:
            if time.monotonic() - self._last_refresh < min_interval:
                return []
            self._last_refresh = time.monotonic()
            if not self._primed:
                top = self.db.max_event_id()
                self.last_id = max(0, top - self.events.maxlen)  # type: ignore[operator]
                self._primed = True
            new: list[dict[str, Any]] = []
            priming = not self._loaded
            self._loaded = True
            while True:
                rows = self.db.events_after(self.last_id, 500)
                for r in rows:
                    r["at"] = tu.iso(r.get("created_at"))
                    self.events.append(r)
                    self.last_id = r["id"]
                new.extend(rows)
                if len(rows) < 500:
                    break
            # The backlog loaded on the first pass is history, not live deltas.
            return [] if priming else new

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self.events)


def _load_links(desk_root: Path) -> Callable[[str], str] | None:
    """links.coin_url is the only sanctioned way to build FOMO links (ref=savipew, never shortened)."""
    p = desk_root / "links.py"
    if not p.is_file():
        return None
    try:
        spec = importlib.util.spec_from_file_location("_desk_links_ro", p)
        if not spec or not spec.loader:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        fn = getattr(mod, "coin_url", None)
        return fn if callable(fn) else None
    except Exception:  # noqa: BLE001 - a broken links.py must not take the service down
        return None


class Proc:
    """Process and port checks from /proc only. Never connects to anything (in particular not to CDP)."""

    @staticmethod
    def find(pattern: str) -> list[dict[str, Any]]:
        out = []
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
                started = os.stat(f"/proc/{pid}").st_ctime
            except OSError:
                continue
            if pattern in cmd and "deskview" not in cmd:
                out.append({"pid": int(pid), "started_at": tu.from_epoch(started)})
        return out

    @staticmethod
    def port_listening(port: int) -> bool:
        hexport = f"{port:04X}"
        for f in ("/proc/net/tcp", "/proc/net/tcp6"):
            try:
                for line in Path(f).read_text().splitlines()[1:]:
                    parts = line.split()
                    if len(parts) > 3 and parts[1].endswith(":" + hexport) and parts[3] == "0A":
                        return True
            except OSError:
                continue
        return False


class Desk:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.db = DeskDB(cfg.desk_root / "desk.db")
        self.files = Files(cfg)
        self.cache = EventCache(self.db)
        self._coin_url = _load_links(cfg.desk_root)

    def fomo_url(self, mint: str | None) -> str | None:
        if not mint or not self._coin_url:
            return None
        try:
            return str(self._coin_url(mint))
        except Exception:  # noqa: BLE001
            return None

    # ── mode & live gate ─────────────────────────────────────────────────
    def mode(self) -> dict[str, Any]:
        settings = self.files.settings()
        acc = self.files.acceptance() or {}
        settings_mode = str(settings.get("mode", "paper")).lower()
        passed = acc.get("passed") is True
        tests = acc.get("tests") if isinstance(acc.get("tests"), list) else []
        failed, blocked = [], []
        for t in tests:
            if not isinstance(t, dict):
                continue
            name = str(first(t, "name", "id", "test", "title") or "?")
            status = str(first(t, "status", "result") or "").lower()
            ok = t.get("passed", t.get("ok"))
            if status in ("blocked", "skipped", "skip"):
                blocked.append(name)
            elif ok is False or status in ("fail", "failed", "error"):
                failed.append(name)
        paused = self.files.flag("desk_paused")
        bots_paused = [b for b in BOTS if self.files.flag(f"paused_{b}")]
        return {
            "settings_mode": settings_mode,
            # The desk refuses LIVE unless the acceptance gate passed; the view mirrors that rule.
            "effective_mode": "live" if settings_mode == "live" and passed else "paper",
            "live_gate": {"passed": passed, "reason": acc.get("reason"), "at": tu.iso(acc.get("at")) or acc.get("at"), "tests": len(tests), "failed": failed, "blocked": blocked},
            "paused": paused is not None,
            "paused_reason": paused["reason"] if paused else None,
            "bots_paused": bots_paused,
        }

    # ── paper book ───────────────────────────────────────────────────────
    def paper(self, marks: dict[str, float] | None = None) -> dict[str, Any]:
        marks = marks or {}
        st = self.files.paper_state() or {}
        settings = self.files.settings()
        night = tu.current_night_id(lock_time=self.cfg.lock_time)
        start_cash = money(first(st, "start_cash")) or money(settings.get("paper_start_cash")) or 0.0
        stale = st.get("night_id") != night
        if stale:
            # The running desk may predate the paper-night roll; report a fresh night, write nothing.
            cash, positions, realized, trades_night = start_cash, {}, 0.0, 0
        else:
            cash = money(st.get("cash")) or 0.0
            positions = st.get("positions") if isinstance(st.get("positions"), dict) else {}
            realized = money(st.get("realized_pnl")) or 0.0
            trades_night = int(st.get("trades_night") or 0)
        value = 0.0
        unmarked = 0
        for key, p in positions.items():
            if not isinstance(p, dict):
                continue
            mint = str(first(p, "mint") or key)
            qty = money(first(p, "qty", "amount")) or 0.0
            usd_in = money(first(p, "usd_in", "cost")) or 0.0
            if mint in marks and qty:
                value += qty * marks[mint]
            else:
                # Same basis as the desk's paper snapshot: cost when no live price. Reported, never hidden.
                value += usd_in
                unmarked += 1
        equity = cash + value
        paused = self.files.flag("desk_paused")
        return {
            "night_id": night,
            "file_night_id": st.get("night_id"),
            "stale_file": stale,
            "start_cash": start_cash,
            "cash": cash,
            "equity": equity,
            "realized_pnl": realized,
            "loss_pct": ((start_cash - equity) / start_cash) if start_cash else 0.0,
            "trades_night": trades_night,
            "positions_at_cost": unmarked,
            "block": bool(paused and paused.get("reason") and "night_limit" in paused["reason"]),
        }

    def paper_positions(self) -> dict[str, dict[str, Any]]:
        st = self.files.paper_state() or {}
        if st.get("night_id") != tu.current_night_id(lock_time=self.cfg.lock_time):
            return {}
        ps = st.get("positions")
        return ps if isinstance(ps, dict) else {}

    def positions(self, marks: dict[str, float] | None = None) -> list[dict[str, Any]]:
        marks = marks or {}
        out: dict[str, dict[str, Any]] = {}
        for r in self.db.positions():
            mint = r.get("mint")
            qty, avg, usd_in = money(r.get("qty")), money(r.get("avg_price")), money(r.get("usd_in"))
            mark = marks.get(mint or "")
            value = (qty or 0) * mark if mark is not None and qty else None
            pnl = (value - usd_in) if value is not None and usd_in is not None else None
            out[mint] = {
                "mint": mint, "symbol": r.get("symbol"), "source": r.get("source"), "qty": qty, "avg_price": avg, "usd_in": usd_in,
                "mark": mark, "value": value, "pnl_usd": pnl, "pnl_pct": (pnl / usd_in) if pnl is not None and usd_in else None,
                "stop_pct": money(r.get("stop_pct")), "trail_pct": money(r.get("trail_pct")), "peak_price": money(r.get("peak_price")),
                "opened_at": tu.iso(r.get("opened_at")), "status": r.get("status"), "fomo_url": self.fomo_url(mint),
            }
        for key, p in self.paper_positions().items():
            if not isinstance(p, dict):
                continue
            mint = str(first(p, "mint") or key)
            if mint in out:
                continue
            qty, avg, usd_in = money(first(p, "qty", "amount")), money(first(p, "avg_price", "price", "entry")), money(first(p, "usd_in", "cost"))
            mark = marks.get(mint)
            value = (qty or 0) * mark if mark is not None and qty else None
            pnl = (value - usd_in) if value is not None and usd_in is not None else None
            out[mint] = {
                "mint": mint, "symbol": first(p, "symbol"), "source": "paper", "qty": qty, "avg_price": avg, "usd_in": usd_in,
                "mark": mark, "value": value, "pnl_usd": pnl, "pnl_pct": (pnl / usd_in) if pnl is not None and usd_in else None,
                "stop_pct": money(p.get("stop_pct")), "trail_pct": money(p.get("trail_pct")), "peak_price": money(p.get("peak_price")),
                "opened_at": tu.iso(p.get("opened_at")), "status": "open", "fomo_url": self.fomo_url(mint),
            }
        return list(out.values())

    def open_mints(self) -> list[str]:
        return [p["mint"] for p in self.positions() if p.get("mint") and p.get("status") in (None, "open")]

    # ── agents ───────────────────────────────────────────────────────────
    def agents(self) -> list[dict[str, Any]]:
        self.cache.refresh()
        events = self.cache.snapshot()
        since = tu.night_started_at(night_start=self.cfg.night_start)
        desk_running = bool(Proc.find("desk.py"))
        desk_paused = self.files.flag("desk_paused")
        tonight = [e for e in events if (tu.parse_local(e.get("created_at")) or since) >= since]
        out = []
        for bot in BOTS:
            last = next((e for e in reversed(events) if str(e.get("topic", "")).startswith(bot + ".")), None)
            hb = self.files.heartbeat(bot)
            log_m = self.files.mtime(self.files.log_path(bot))
            spec = AGENT_COUNTS[bot]
            counts = {k: sum(1 for e in tonight if e.get("topic") in topics) for k, topics in spec.items()}
            fresh = [t for t in (hb, log_m) if t]
            age = time.time() - max(fresh) if fresh else None
            if not desk_running:
                state = "stopped"
            elif desk_paused or self.files.flag(f"paused_{bot}"):
                state = "paused"
            elif age is not None and age < (60 if hb else 600):
                state = "running"
            else:
                state = "stale"
            out.append({
                "name": bot,
                "state": state,
                "last_event": {"topic": last["topic"], "at": last.get("at")} if last else None,
                "last_log_at": tu.from_epoch(log_m) if log_m else None,
                "heartbeat_at": tu.from_epoch(hb) if hb else None,
                "status_source": "heartbeat" if hb else "log_mtime",
                "counts": counts,
            })
        return out

    # ── alerts ───────────────────────────────────────────────────────────
    def alerts(self, limit: int = 100) -> list[dict[str, Any]]:
        self.cache.refresh()
        out: list[dict[str, Any]] = []
        for e in reversed(self.cache.snapshot()):
            lvl = ALERT_TOPICS.get(e.get("topic", ""))
            if not lvl:
                continue
            p = e.get("payload") if isinstance(e.get("payload"), dict) else {}
            out.append({
                "id": f"evt-{e['id']}", "at": e.get("at"), "level": lvl, "kind": e["topic"],
                "symbol": first(p, "symbol"), "mint": first(p, "mint"),
                "message": redact_text(str(first(p, "reason", "message", "error", "detail") or e["topic"])),
            })
            if len(out) >= limit:
                break
        paused = self.files.flag("desk_paused")
        if paused:
            out.insert(0, {"id": "flag-desk_paused", "at": tu.from_epoch(paused["since"]), "level": "crit", "kind": "desk.paused", "symbol": None, "mint": None, "message": paused["reason"] or "Desk paused"})
        for i, prob in enumerate((self.files.health_json() or {}).get("problems") or []):
            out.append({"id": f"health-{i}", "at": None, "level": "warn", "kind": "health.problem", "symbol": None, "mint": None, "message": redact_text(str(prob))})
        return out[:limit]

    # ── health ───────────────────────────────────────────────────────────
    def health(self) -> dict[str, Any]:
        hj = self.files.health_json() or {}
        desk = Proc.find("desk.py")
        poller = Proc.find("telegram_bot.py")
        log_age = self.files.log_age_s("desk")
        window = tu.in_night_window(night_start=self.cfg.night_start, lock_time=self.cfg.lock_time)
        problems = [redact_text(str(p)) for p in (hj.get("problems") or [])]
        if window and not desk:
            problems.append("desk.py is not running inside the night window")
        if desk and log_age is not None and log_age > 300:
            problems.append(f"desk.log has not been written for {int(log_age)}s")
        layers = self.degraded_layers()
        return {
            "ok": not problems,
            "as_of": tu.now().isoformat(),
            "desk": {"running": bool(desk), "pids": [d["pid"] for d in desk], "started_at": desk[0]["started_at"] if desk else None, "log_age_s": log_age},
            "telegram_poller": {"running": bool(poller), "pids": [p["pid"] for p in poller]},
            "chrome": hj.get("chrome"),
            "cdp_listening": Proc.port_listening(9222),
            "in_night_window": window,
            "night_id": tu.current_night_id(lock_time=self.cfg.lock_time),
            "heartbeats": {b: (tu.from_epoch(h) if (h := self.files.heartbeat(b)) else None) for b in BOTS},
            "degraded_layers": layers,
            "problems": problems,
            "last_health_check": tu.from_epoch(m) if (m := self.files.mtime(self.files.logs / "health.json")) else None,
        }

    def degraded_layers(self) -> list[dict[str, str]]:
        pat = re.compile(r"(?i)missing api keys?|llm off|\b402\b|disabled|public example key")
        seen: dict[str, dict[str, str]] = {}
        for line in self.files.tail_lines(self.files.log_path("desk"), 1500):
            if pat.search(line):
                msg = redact_text(re.sub(r"^\S+ \S+ \S+ ", "", line))[:240]
                seen[msg] = {"message": msg, "at": tu.iso(line) or ""}
        return list(seen.values())[-12:]

    # ── discoveries & coins ──────────────────────────────────────────────
    def discoveries(self, status: str | None = None, limit: int = 300) -> list[dict[str, Any]]:
        holders = self.db.latest_holders()
        rows = []
        for c in self.db.coins(limit):
            rows.append(self._coin_view(c, holders))
        for w in self.db.waiting():
            rows.append({
                "mint": w.get("mint"), "symbol": w.get("symbol"), "name": None, "status": "waiting", "kill_rule": None, "score": None,
                "liquidity": None, "top10": None, "holders": holders.get(w.get("mint") or "", w.get("last_holders")), "price": None,
                "first_seen": tu.iso(w.get("arrived_at")), "migrated_at": tu.iso(w.get("arrived_at")), "updated_at": tu.iso(w.get("last_check")),
                "notes_path": None, "fomo_url": self.fomo_url(w.get("mint")), "bull": None, "bear": None, "layers": None,
            })
        if status:
            rows = [r for r in rows if r["status"] == status]
        return rows[:limit]

    def _coin_view(self, c: dict[str, Any], holders: dict[str, int]) -> dict[str, Any]:
        mint = c.get("mint")
        return {
            "mint": mint, "symbol": c.get("symbol"), "name": c.get("name"), "status": c.get("status"), "kill_rule": c.get("kill_rule"),
            "score": money(c.get("score")), "liquidity": money(c.get("liquidity")), "top10": money(c.get("top10")),
            "holders": holders.get(mint or "", c.get("holders")), "price": money(c.get("price")),
            "first_seen": tu.iso(c.get("first_seen")), "migrated_at": tu.iso(c.get("migrated_at")), "updated_at": tu.iso(c.get("updated_at")),
            "notes_path": c.get("notes_path"), "fomo_url": self.fomo_url(mint),
            "bull": c.get("bull"), "bear": c.get("bear"), "layers": c.get("layers"),
            "size_usd": money(c.get("size_usd")), "cap_usd": money(c.get("cap_usd")),
        }

    def coin(self, mint: str) -> dict[str, Any] | None:
        c = self.db.coin(mint)
        if not c:
            return None
        self.cache.refresh()
        events = [e for e in self.cache.snapshot() if mint in str(e.get("payload"))][-100:]
        note = self.files.vault_note(c["notes_path"]) if c.get("notes_path") else None
        return {
            "coin": self._coin_view(c, self.db.latest_holders()),
            "holders_series": [{"holders": h["holders"], "at": tu.iso(h["sampled_at"])} for h in reversed(self.db.holder_series(mint))],
            "events": [{"id": e["id"], "topic": e["topic"], "at": e.get("at"), "payload": e.get("payload")} for e in events],
            "note_md": note[1] if note else None,
        }

    # ── trades & history ─────────────────────────────────────────────────
    def trades(self, since_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        seen_notes: set[str] = set()
        for t in self.db.trades(since_id, limit):
            notes = t.get("notes_path")
            if notes:
                seen_notes.add(str(notes))
            out.append({
                "id": f"db-{t['id']}", "at": tu.iso(t.get("created_at")), "side": t.get("side"), "symbol": t.get("symbol"), "mint": t.get("mint"),
                "size_usd": money(t.get("size")), "price": money(t.get("price")), "pnl": money(t.get("pnl")), "reason": None,
                "notes_path": notes, "frame": None, "source": "db",
            })
        if since_id == 0:
            for path, fm, body in self.files.vault_folder("Trades"):
                if path in seen_notes or any(str(n).endswith(path) for n in seen_notes):
                    continue
                if not fm.get("side") and not fm.get("symbol"):
                    continue
                at = first(fm, "at", "time", "created", "date")
                out.append({
                    "id": f"vault-{path}", "at": tu.iso(str(at)) if at else None, "side": first(fm, "side"), "symbol": first(fm, "symbol", "coin"),
                    "mint": first(fm, "mint"), "size_usd": money(first(fm, "size_usd", "size")), "price": money(first(fm, "price", "entry", "exit")),
                    "pnl": money(first(fm, "pnl")), "reason": first(fm, "reason"), "notes_path": path, "frame": first(fm, "frame"), "source": "vault",
                })
        out.sort(key=lambda r: r.get("at") or "", reverse=True)
        return out[:limit]

    def nights(self) -> list[dict[str, Any]]:
        out = []
        for path, fm, body in self.files.vault_folder("Daily"):
            note = next((ln.strip() for ln in body.splitlines() if ln.strip() and not ln.lstrip().startswith(("#", "!", "|", "-"))), None)
            out.append({
                "night_id": str(first(fm, "night_id", "night", "date") or Path(path).stem),
                "balance": money(first(fm, "balance", "equity")), "pnl": money(first(fm, "pnl", "night_pnl")),
                "trades": first(fm, "trades"), "wins": first(fm, "wins"), "losses": first(fm, "losses"),
                "note": note, "path": path,
            })
        out.sort(key=lambda r: r["night_id"])
        return out

    def wallets(self) -> list[dict[str, Any]]:
        vault = {fm.get("address") or Path(p).stem: fm for p, fm, _ in self.files.vault_folder("Wallets")}
        out = []
        for w in self.db.wallets():
            fm = vault.get(w.get("address"), {}) or vault.get(w.get("short"), {})
            out.append({"address": w.get("address"), "short": w.get("short"), "wins": w.get("wins"), "losses": w.get("losses"), "cold": bool(fm.get("cold")), "last_move": tu.iso(w.get("last_move")) or w.get("last_move")})
        return out

    def lessons(self) -> list[dict[str, Any]]:
        return [{"tag": first(fm, "tag") or Path(p).stem, "hits": first(fm, "hits"), "archived": bool(fm.get("archived")), "body": body[:4000]} for p, fm, body in self.files.vault_folder("Lessons")]

    def desk_fomo_last(self) -> dict[str, Any] | None:
        pat = re.compile(r"balances cash=([\d.\-]+)\s+holdings=([\d.\-]+)")
        for line in reversed(self.files.tail_lines(self.files.log_path("fomo"), 3000)):
            m = pat.search(line)
            if m:
                return {"cash": float(m.group(1)), "holdings": float(m.group(2)), "at": tu.iso(line)}
        return None
