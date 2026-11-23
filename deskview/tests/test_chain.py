from __future__ import annotations

import asyncio

import httpx

from deskview.chain import USDC, WSOL, Chain

ADDR = "PublicAddr1111111111111111111111111111111"
MEME = "MemeMint11111111111111111111111111111111"


def handler(request: httpx.Request) -> httpx.Response:
    if "dexscreener" in str(request.url):
        return httpx.Response(200, json=[
            {"baseToken": {"address": WSOL}, "priceUsd": "180", "liquidity": {"usd": 1e7}},
            {"baseToken": {"address": MEME}, "priceUsd": "0.002", "liquidity": {"usd": 5e4}},
            {"baseToken": {"address": MEME}, "priceUsd": "0.5", "liquidity": {"usd": 10}},
        ])
    body = __import__("json").loads(request.content)
    assert "fomo" not in str(request.url)
    if body["method"] == "getBalance":
        return httpx.Response(200, json={"result": {"value": 2_000_000_000}})
    flt = body["params"][1]
    acct = lambda mint, amt: {"account": {"data": {"parsed": {"info": {"mint": mint, "tokenAmount": {"uiAmount": amt}}}}}}
    if flt.get("mint") == USDC:
        return httpx.Response(200, json={"result": {"value": [acct(USDC, 25.5)]}})
    if flt["programId"].startswith("Tokenkeg"):
        return httpx.Response(200, json={"result": {"value": [acct(USDC, 25.5), acct(MEME, 1000)]}})
    return httpx.Response(200, json={"result": {"value": []}})


def test_chain_balance_priced_by_most_liquid_pair():
    c = Chain(ADDR, ("https://rpc.example",), True, transport=httpx.MockTransport(handler))
    b = asyncio.run(c.balance())
    assert b["sol"] == 2.0 and b["usdc"] == 25.5 and b["error"] is None
    assert b["holdings"] == [{"mint": MEME, "qty": 1000.0, "price_usd": 0.002, "value_usd": 2.0}]
    assert b["total_usd"] == 25.5 + 360 + 2.0


def test_chain_falls_back_and_keeps_last_good():
    calls = {"n": 0}

    def flaky(request):
        calls["n"] += 1
        if "bad" in str(request.url):
            return httpx.Response(503)
        return handler(request)

    c = Chain(ADDR, ("https://bad.example", "https://good.example"), True, transport=httpx.MockTransport(flaky))
    assert asyncio.run(c.balance())["usdc"] == 25.5
