"""Service configuration, read once from the environment.

Only public values live here. The bearer token is read from DESKVIEW_TOKEN or from a 0600 file and is
never logged or returned.
"""

from __future__ import annotations

import os
import stat
from dataclasses import dataclass, field
from pathlib import Path

LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
BOTS = ("scanner", "analyst", "brain", "executor", "risk")
DEFAULT_RPCS = ("https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com")


class ConfigError(RuntimeError):
    pass


def _read_token(path: Path) -> str | None:
    if not path.exists():
        return None
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise ConfigError(f"{path} must not be readable by group/others (chmod 600)")
    return path.read_text().strip() or None


@dataclass(frozen=True)
class Config:
    desk_root: Path
    vault: Path
    state_dir: Path
    token: str = field(repr=False)
    fomo_public_address: str | None
    allowed_origins: tuple[str, ...]
    rpc_urls: tuple[str, ...]
    chain_enabled: bool
    timezone: str = "America/Chicago"
    night_start: str = "22:00"
    lock_time: str = "06:30"
    rate_limit_per_s: float = 20.0
    poll_s: float = 1.0

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Config":
        env = dict(os.environ if env is None else env)
        desk_root = Path(env.get("DESKVIEW_DESK_ROOT", "/workspace/desk")).resolve()
        token = env.get("DESKVIEW_TOKEN") or _read_token(
            Path(env.get("DESKVIEW_TOKEN_FILE", "~/.config/deskview/token")).expanduser()
        )
        if not token or len(token) < 24:
            raise ConfigError("Set DESKVIEW_TOKEN or ~/.config/deskview/token (at least 24 chars)")
        state_dir = Path(env.get("DESKVIEW_STATE_DIR", "/workspace/desk-dash/state")).resolve()
        if state_dir == desk_root or desk_root in state_dir.parents:
            raise ConfigError("DESKVIEW_STATE_DIR must be outside the desk root (single-writer rule)")
        origins = tuple(o.strip() for o in env.get("DESKVIEW_ALLOWED_ORIGINS", "").split(",") if o.strip())
        rpcs = tuple(u.strip() for u in env.get("DESKVIEW_RPC_URLS", ",".join(DEFAULT_RPCS)).split(",") if u.strip())
        return cls(
            desk_root=desk_root,
            vault=Path(env.get("DESKVIEW_VAULT", str(desk_root / "vault" / "Overnight Desk"))).resolve(),
            state_dir=state_dir,
            token=token,
            fomo_public_address=env.get("DESKVIEW_FOMO_ADDRESS") or None,
            allowed_origins=origins,
            rpc_urls=rpcs,
            chain_enabled=env.get("DESKVIEW_CHAIN_ENABLED", "1") not in ("0", "false", "no"),
            night_start=env.get("DESKVIEW_NIGHT_START", "22:00"),
            lock_time=env.get("DESKVIEW_LOCK_TIME", "06:30"),
        )
