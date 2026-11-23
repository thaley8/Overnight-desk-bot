"""One redaction function for every outbound payload, log line and frame."""

from __future__ import annotations

import os
import re
from typing import Any

SECRET_KEY = re.compile(r"(?i)token|authorization|bearer|cookie|secret|password|seed|private|api[_-]?key|session|jwt")
_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-~+/=]{8,}"),
    re.compile(r"bot\d{5,}:[A-Za-z0-9_\-]{20,}"),
    re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),  # JWT
    re.compile(r"(?i)(api[_-]?key|token|secret|password)=([^\s&\"']{6,})"),
]
MASK = "[redacted]"


def _env_secret_values() -> list[str]:
    vals = []
    for k, v in os.environ.items():
        if v and len(v) >= 8 and (SECRET_KEY.search(k) or k.endswith(("_KEY", "_TOKEN"))):
            vals.append(v)
    return sorted(set(vals), key=len, reverse=True)


_extra: list[str] = []


def register_secret(value: str) -> None:
    """Values the service itself knows (its own bearer token) are always stripped."""
    if value and value not in _extra:
        _extra.append(value)


def redact_text(s: str) -> str:
    for v in _extra + _env_secret_values():
        if v in s:
            s = s.replace(v, MASK)
    for p in _PATTERNS:
        s = p.sub(lambda m: (m.group(1) + "=" + MASK) if m.re.groups == 2 else MASK, s)
    return s


def redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: redact(v) for k, v in obj.items() if not (isinstance(k, str) and SECRET_KEY.search(k))}
    if isinstance(obj, (list, tuple)):
        return [redact(v) for v in obj]
    if isinstance(obj, str):
        return redact_text(obj)
    return obj
