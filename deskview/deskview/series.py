"""The desk does not persist an equity series, so deskview samples its own into state/series.sqlite.

This file lives in DESKVIEW_STATE_DIR, outside the desk root (single-writer rule).
"""

from __future__ import annotations

import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any


class Series:
    def __init__(self, state_dir: Path):
        state_dir.mkdir(parents=True, exist_ok=True)
        self.path = state_dir / "series.sqlite"
        with closing(self._con()) as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.execute(
                "CREATE TABLE IF NOT EXISTS samples (t INTEGER PRIMARY KEY, night_id TEXT, paper_equity REAL, paper_cash REAL, chain_usd REAL)"
            )

    def _con(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=2, isolation_level=None)

    def record(self, night_id: str, paper_equity: float | None, paper_cash: float | None, chain_usd: float | None) -> None:
        with closing(self._con()) as con:
            con.execute(
                "INSERT OR REPLACE INTO samples VALUES (?, ?, ?, ?, ?)",
                (int(time.time()), night_id, paper_equity, paper_cash, chain_usd),
            )

    def read(self, since: int = 0, limit: int = 5000) -> list[dict[str, Any]]:
        with closing(self._con()) as con:
            con.row_factory = sqlite3.Row
            rows = con.execute("SELECT * FROM samples WHERE t >= ? ORDER BY t DESC LIMIT ?", (since, limit)).fetchall()
        return [dict(r) for r in reversed(rows)]
