"""Run: python -m deskview [--port 8787]. Binds loopback only and disables access logs."""

from __future__ import annotations

import argparse
import sys

import uvicorn

from .config import LOOPBACK_HOSTS, Config, ConfigError


def main() -> None:
    ap = argparse.ArgumentParser(prog="deskview")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()
    if args.host not in LOOPBACK_HOSTS:
        sys.exit("deskview binds loopback only (127.0.0.1). Use tailscale serve or an SSH tunnel for remote access.")
    try:
        cfg = Config.from_env()
    except ConfigError as e:
        sys.exit(f"config error: {e}")
    from .app import create_app

    uvicorn.run(create_app(cfg), host=args.host, port=args.port, workers=1, access_log=False, server_header=False, proxy_headers=False, log_level="warning")


if __name__ == "__main__":
    main()
