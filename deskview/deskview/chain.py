"""Live wallet balance from public Solana RPC by the PUBLIC FOMO address, priced with DexScreener.

Never uses the FOMO token or API. Cached (30s balances, 15s prices) so it never competes with the desk.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from . import timeutil as tu

USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
WSOL = "So11111111111111111111111111111111111111112"
TOKEN_PROGRAMS = ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
DEXSCREENER = "https://api.dexscreener.com/tokens/v1/solana/"


class Chain:
    def __init__(self, address: str | None, rpc_urls: tuple[str, ...], enabled: bool = True, transport: httpx.AsyncBaseTransport | None = None):
        self.address = address
        self.rpc_urls = rpc_urls
        self.enabled = enabled and bool(address)
        self._bal: dict[str, Any] | None = None
        self._bal_at = 0.0
        self._prices: dict[str, float] = {}
        self._prices_at: dict[str, float] = {}
        self._client = httpx.AsyncClient(timeout=6.0, headers={"user-agent": "deskview/0.1"}, transport=transport)

    async def close(self) -> None:
        await self._client.aclose()

    async def _rpc(self, method: str, params: list[Any]) -> Any:
        last: Exception | None = None
        for url in self.rpc_urls:
            try:
                r = await self._client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
                r.raise_for_status()
                body = r.json()
                if "error" in body:
                    raise RuntimeError(str(body["error"].get("message", "rpc error")))
                return body["result"]
            except Exception as e:  # noqa: BLE001 - try the next public RPC
                last = e
        raise RuntimeError(f"all RPCs failed: {type(last).__name__}")

    async def prices(self, mints: list[str]) -> dict[str, float]:
        """USD price per mint from the most liquid DexScreener pair. 15s cache."""
        now = time.monotonic()
        need = [m for m in set(mints) if now - self._prices_at.get(m, 0) > 15]
        for i in range(0, len(need), 30):
            chunk = need[i : i + 30]
            try:
                r = await self._client.get(DEXSCREENER + ",".join(chunk))
                r.raise_for_status()
                best: dict[str, tuple[float, float]] = {}
                for pair in r.json() or []:
                    addr = (pair.get("baseToken") or {}).get("address")
                    price = pair.get("priceUsd")
                    liq = float((pair.get("liquidity") or {}).get("usd") or 0)
                    if addr in chunk and price and (addr not in best or liq > best[addr][1]):
                        best[addr] = (float(price), liq)
                for m in chunk:
                    self._prices_at[m] = now
                    if m in best:
                        self._prices[m] = best[m][0]
            except Exception:  # noqa: BLE001 - keep the last good marks
                pass
        return {m: self._prices[m] for m in mints if m in self._prices}

    async def balance(self, force: bool = False) -> dict[str, Any]:
        if not self.enabled:
            return {"address": self.address, "source": "solana_rpc", "error": "disabled (set DESKVIEW_FOMO_ADDRESS)", "as_of": None}
        if self._bal and not force and time.monotonic() - self._bal_at < 30:
            return self._bal
        try:
            lamports = (await self._rpc("getBalance", [self.address]))["value"]
            usdc = 0.0
            res = await self._rpc("getTokenAccountsByOwner", [self.address, {"mint": USDC}, {"encoding": "jsonParsed"}])
            for acc in res["value"]:
                usdc += float(acc["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmount"] or 0)
            held: dict[str, float] = {}
            for prog in TOKEN_PROGRAMS:
                res = await self._rpc("getTokenAccountsByOwner", [self.address, {"programId": prog}, {"encoding": "jsonParsed"}])
                for acc in res["value"]:
                    info = acc["account"]["data"]["parsed"]["info"]
                    amt = float(info["tokenAmount"]["uiAmount"] or 0)
                    if info["mint"] != USDC and amt > 0:
                        held[info["mint"]] = held.get(info["mint"], 0) + amt
            px = await self.prices([WSOL, *held.keys()])
            sol = lamports / 1e9
            holdings = [{"mint": m, "qty": q, "price_usd": px.get(m), "value_usd": (q * px[m]) if m in px else None} for m, q in held.items()]
            total = usdc + (sol * px[WSOL] if WSOL in px else 0) + sum(h["value_usd"] or 0 for h in holdings)
            self._bal = {
                "address": self.address, "sol": sol, "sol_usd": px.get(WSOL), "usdc": usdc, "holdings": holdings,
                "total_usd": total, "as_of": tu.now().isoformat(), "source": "solana_rpc", "error": None,
            }
        except Exception as e:  # noqa: BLE001
            stale = dict(self._bal or {"address": self.address, "source": "solana_rpc"})
            stale["error"] = f"refresh failed: {e}"[:200]
            return stale
        self._bal_at = time.monotonic()
        return self._bal
