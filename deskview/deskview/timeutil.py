"""Desk timestamps are local strings like '2026-11-23 00:25:04 CST'. Parse them as America/Chicago."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

CHICAGO = ZoneInfo("America/Chicago")
_TS = re.compile(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})")


def parse_local(value: object) -> datetime | None:
    """Parse a desk timestamp (abbreviation ignored; zone is always America/Chicago)."""
    if not isinstance(value, str):
        return None
    m = _TS.search(value)
    if not m:
        return None
    try:
        naive = datetime.fromisoformat(f"{m.group(1)} {m.group(2)}")
    except ValueError:
        return None
    # fold=0 picks the first occurrence on the ambiguous DST fall-back hour; 'CDT' means first, 'CST' second.
    fold = 1 if value.strip().endswith("CST") else 0
    return naive.replace(tzinfo=CHICAGO, fold=fold)


def iso(value: object) -> str | None:
    dt = parse_local(value)
    return dt.isoformat() if dt else None


def now() -> datetime:
    return datetime.now(CHICAGO)


def from_epoch(ts: float) -> str:
    return datetime.fromtimestamp(ts, CHICAGO).isoformat()


def _hm(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


def current_night_id(at: datetime | None = None, lock_time: str = "06:30") -> str:
    """A night is named after the evening it starts. Before noon we are still in last evening's night."""
    at = at or now()
    d: date = at.date()
    if at.time() < time(12, 0):
        d = d - timedelta(days=1)
    return d.isoformat()


def in_night_window(at: datetime | None = None, night_start: str = "22:00", lock_time: str = "06:30") -> bool:
    t = (at or now()).time()
    start, lock = _hm(night_start), _hm(lock_time)
    return t >= start or t < lock


def night_started_at(at: datetime | None = None, night_start: str = "22:00") -> datetime:
    at = at or now()
    start = _hm(night_start)
    d = date.fromisoformat(current_night_id(at))
    return datetime.combine(d, start, CHICAGO)
