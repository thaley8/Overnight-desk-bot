import { deskviewConfig, deskviewFetch } from "@/lib/server/deskview";
import type { SystemStatus } from "@/lib/types";

// Single source of truth for the mode badge. The browser never decides its own trading mode:
// with deskview configured, the mode is what the desk reports (settings mode gated by acceptance).
export async function GET() {
  const status: SystemStatus = {
    dataSource: "demo",
    tradingMode: null,
    engine: { configured: false, reachable: false, latencyMs: null, error: null },
    database: { configured: false, reachable: false, latencyMs: null, error: null },
    checkedAt: new Date().toISOString(),
  };
  let cfg = null;
  try {
    cfg = deskviewConfig();
  } catch (e) {
    status.dataSource = "deskview";
    status.engine = { configured: true, reachable: false, latencyMs: null, error: e instanceof Error ? e.message : "config error" };
  }
  if (cfg) {
    status.dataSource = "deskview";
    status.engine.configured = true;
    const t0 = Date.now();
    try {
      const res = await deskviewFetch("/api/v1/mode", 4000);
      status.engine.latencyMs = Date.now() - t0;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = (await res.json()) as { effective_mode?: string };
      status.engine.reachable = true;
      status.tradingMode = m.effective_mode === "live" ? "live" : m.effective_mode === "paper" ? "paper" : null;
    } catch (e) {
      status.engine.error = e instanceof Error ? e.message : "unreachable";
    }
  }
  return Response.json(status, { headers: { "cache-control": "no-store" } });
}
