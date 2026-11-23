"""Allow-listed readers for desk files and the Obsidian vault.

Nothing here takes a path from a client. Every path is built from a fixed allow-list, and vault paths that
come from the db (notes_path) are resolved and must stay inside the vault. Nothing here ever writes.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import yaml

from .config import BOTS, Config
from .redact import redact_text

# Never served, whatever the caller asks for.
FORBIDDEN_NAMES = {"telegram_chat.json", "owner_hold.json", ".env", "token"}
LOG_ALLOW = {"desk", *BOTS, "bus", "fomo", "browser", "market", "mode", "llm", "lessons", "telegram", "health", "daily", "report", "weekly", "night_start"}
_FRAME_NAME = re.compile(r"^[A-Za-z0-9._\-]+\.png$")


class Files:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.root = cfg.desk_root
        self.data = cfg.desk_root / "data"
        self.logs = cfg.desk_root / "logs"
        self._md_cache: dict[Path, tuple[float, dict[str, Any], str]] = {}

    # ── generic ───────────────────────────────────────────────────────────
    @staticmethod
    def _read_json(p: Path) -> Any:
        try:
            with p.open("r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    @staticmethod
    def mtime(p: Path) -> float | None:
        try:
            return p.stat().st_mtime
        except OSError:
            return None

    # ── data/ ─────────────────────────────────────────────────────────────
    def paper_state(self) -> dict[str, Any] | None:
        return self._read_json(self.data / "paper_state.json")

    def acceptance(self) -> dict[str, Any] | None:
        return self._read_json(self.data / "acceptance_step14.json")

    def dashboard(self) -> dict[str, Any] | None:
        return self._read_json(self.data / "dashboard.json")

    def private_values(self) -> list[str]:
        """Values that must be stripped from every response (e.g. the Telegram owner chat id).

        telegram_chat.json is read ONLY to learn what to redact; it is never served.
        """
        chat = self._read_json(self.data / "telegram_chat.json") or {}
        out = []
        for k in ("chat_id", "owner_id", "user_id"):
            v = chat.get(k) if isinstance(chat, dict) else None
            if v is not None and len(str(v)) >= 5:
                out.append(str(v))
        return out

    def click_lane(self) -> dict[str, Any] | None:
        return self._read_json(self.data / "click_lane.json")

    def pushes(self, limit: int = 100) -> list[dict[str, Any]]:
        out = []
        for line in self.tail_lines(self.data / "pushes.jsonl", limit):
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
        return list(reversed(out))

    def flag(self, name: str) -> dict[str, Any] | None:
        """desk_paused.flag / paused_{bot}.flag. Returns presence, mtime and a short redacted reason."""
        if name != "desk_paused" and not (name.startswith("paused_") and name[7:] in BOTS):
            raise ValueError("flag not allow-listed")
        p = self.data / f"{name}.flag"
        if not p.exists():
            return None
        try:
            text = p.read_text(encoding="utf-8", errors="replace")[:300].strip()
        except OSError:
            text = ""
        return {"reason": redact_text(text) or None, "since": self.mtime(p)}

    def heartbeat(self, bot: str) -> float | None:
        if bot not in BOTS:
            raise ValueError("bot not allow-listed")
        return self.mtime(self.data / "heartbeats" / bot)

    def health_json(self) -> dict[str, Any] | None:
        return self._read_json(self.logs / "health.json")

    def latest_frame(self) -> Path | None:
        d = self.data / "frames"
        try:
            pngs = [p for p in d.iterdir() if p.is_file() and _FRAME_NAME.match(p.name) and not p.is_symlink()]
        except OSError:
            return None
        return max(pngs, key=lambda p: p.stat().st_mtime) if pngs else None

    # ── logs/ ─────────────────────────────────────────────────────────────
    def log_path(self, name: str) -> Path:
        if name not in LOG_ALLOW:
            raise ValueError("log not allow-listed")
        return self.logs / f"{name}.log"

    @staticmethod
    def tail_lines(p: Path, n: int, chunk: int = 65536) -> list[str]:
        try:
            with p.open("rb") as f:
                f.seek(0, os.SEEK_END)
                size = f.tell()
                buf = b""
                pos = size
                while pos > 0 and buf.count(b"\n") <= n:
                    step = min(chunk, pos)
                    pos -= step
                    f.seek(pos)
                    buf = f.read(step) + buf
        except OSError:
            return []
        lines = buf.decode("utf-8", errors="replace").splitlines()
        return lines[-n:]

    def log_tail(self, name: str, n: int = 200) -> dict[str, Any]:
        p = self.log_path(name)
        lines = [redact_text(line) for line in self.tail_lines(p, max(1, min(n, 2000)))]
        try:
            offset = p.stat().st_size
        except OSError:
            offset = 0
        return {"lines": lines, "offset": offset}

    @staticmethod
    def read_from(p: Path, offset: int, max_bytes: int = 262144) -> tuple[list[str], int]:
        """Read complete new lines after `offset`. Handles truncation/rotation by restarting at 0."""
        try:
            size = p.stat().st_size
            if size < offset:
                offset = 0
            if size == offset:
                return [], offset
            with p.open("rb") as f:
                f.seek(offset)
                data = f.read(min(max_bytes, size - offset))
        except OSError:
            return [], offset
        end = data.rfind(b"\n")
        if end < 0:
            return [], offset
        return [redact_text(x) for x in data[: end + 1].decode("utf-8", errors="replace").splitlines()], offset + end + 1

    def log_age_s(self, name: str = "desk") -> float | None:
        m = self.mtime(self.log_path(name))
        return None if m is None else max(0.0, time.time() - m)

    # ── vault ─────────────────────────────────────────────────────────────
    def vault_note(self, rel: str | Path) -> tuple[dict[str, Any], str] | None:
        """Frontmatter + body of a note inside the vault. Returns None for anything outside it."""
        vault = self.cfg.vault
        p = Path(rel)
        if not p.is_absolute():
            p = vault / p
        try:
            p = p.resolve(strict=True)
        except OSError:
            return None
        if vault not in p.parents or p.suffix != ".md" or p.name in FORBIDDEN_NAMES:
            return None
        m = p.stat().st_mtime
        hit = self._md_cache.get(p)
        if hit and hit[0] == m:
            return hit[1], hit[2]
        text = p.read_text(encoding="utf-8", errors="replace")
        fm, body = split_frontmatter(text)
        self._md_cache[p] = (m, fm, body)
        return fm, body

    def vault_folder(self, folder: str) -> list[tuple[str, dict[str, Any], str]]:
        if folder not in {"Coins", "Wallets", "Trades", "Daily", "Lessons", "Desk"}:
            raise ValueError("folder not allow-listed")
        d = self.cfg.vault / folder
        out = []
        try:
            files = sorted(x for x in d.glob("*.md") if x.is_file())
        except OSError:
            return []
        for f in files:
            note = self.vault_note(f)
            if note:
                out.append((f"{folder}/{f.name}", note[0], note[1]))
        return out

    def settings(self) -> dict[str, Any]:
        note = self.vault_note("Desk/Settings.md")
        return note[0] if note else {}


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("\n---", 1)
    if len(parts) < 2:
        return {}, text
    try:
        fm = yaml.safe_load(parts[0][3:]) or {}
    except yaml.YAMLError:
        fm = {}
    body = parts[1].split("\n", 1)[1] if "\n" in parts[1] else ""
    return (fm if isinstance(fm, dict) else {}), body.lstrip("\n")
