"""Read-only access to desk.db.

desk.db uses a rollback journal, so a reader's SHARED lock briefly blocks the desk's writes. Every call
opens a fresh read-only connection, runs one small query, fetches everything and closes. No transaction is
ever held open. Never use immutable=1.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any
from urllib.parse import quote


class DeskDB:
    def __init__(self, path: Path):
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(f"file:{quote(str(self.path))}?mode=ro", uri=True, timeout=1, isolation_level=None)
        con.execute("PRAGMA query_only=1")
        con.row_factory = sqlite3.Row
        return con

    def query(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            with closing(self._connect()) as con:
                return [dict(r) for r in con.execute(sql, params).fetchall()]
        except sqlite3.OperationalError as e:
            # Missing table (older desk) or a busy desk: degrade to empty rather than retrying in a loop.
            if "no such table" in str(e) or "locked" in str(e) or "busy" in str(e):
                return []
            raise

    def scalar(self, sql: str, params: tuple = ()) -> Any:
        rows = self.query(sql, params)
        return next(iter(rows[0].values())) if rows else None

    # ── tiny queries, all by primary key / id ─────────────────────────────
    def events_after(self, after_id: int, limit: int = 500) -> list[dict[str, Any]]:
        rows = self.query("SELECT id, topic, payload, created_at FROM events WHERE id > ? ORDER BY id LIMIT ?", (after_id, limit))
        for r in rows:
            r["payload"] = _json(r.get("payload"))
        return rows

    def max_event_id(self) -> int:
        return int(self.scalar("SELECT MAX(id) FROM events") or 0)

    def coins(self, limit: int = 500) -> list[dict[str, Any]]:
        return self.query("SELECT * FROM coins ORDER BY updated_at DESC LIMIT ?", (limit,))

    def coin(self, mint: str) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM coins WHERE mint = ?", (mint,))
        return rows[0] if rows else None

    def waiting(self) -> list[dict[str, Any]]:
        return self.query("SELECT mint, symbol, creator, creator_balance, pool, arrived_at, last_holders, last_check FROM waiting LIMIT 500")

    def positions(self) -> list[dict[str, Any]]:
        return self.query("SELECT * FROM positions LIMIT 500")

    def trades(self, since_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
        return self.query("SELECT * FROM trades WHERE id > ? ORDER BY id DESC LIMIT ?", (since_id, limit))

    def holder_series(self, mint: str, limit: int = 300) -> list[dict[str, Any]]:
        return self.query("SELECT holders, sampled_at FROM holder_samples WHERE mint = ? ORDER BY id DESC LIMIT ?", (mint, limit))

    def latest_holders(self) -> dict[str, int]:
        rows = self.query(
            "SELECT h.mint, h.holders FROM holder_samples h JOIN (SELECT mint, MAX(id) AS id FROM holder_samples GROUP BY mint) m ON h.id = m.id"
        )
        return {r["mint"]: r["holders"] for r in rows}

    def wallets(self) -> list[dict[str, Any]]:
        return self.query("SELECT * FROM wallets ORDER BY updated_at DESC LIMIT 500")

    def change_marker(self) -> tuple:
        """Cheap fingerprint of positions/coins so the watcher can push deltas."""
        return (
            self.scalar("SELECT MAX(updated_at) FROM coins"),
            self.scalar("SELECT COUNT(*) FROM coins"),
            self.scalar("SELECT COUNT(*) || ':' || IFNULL(SUM(peak_price), 0) || ':' || IFNULL(GROUP_CONCAT(status), '') FROM positions"),
        )


def _json(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v
