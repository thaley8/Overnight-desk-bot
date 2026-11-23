// Server-only. Holds the deskview bearer token; never import this from a client component.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";

export interface DeskviewConfig {
  url: string;
  token: string;
}

let cached: DeskviewConfig | null | undefined;

export function deskviewConfig(): DeskviewConfig | null {
  if (cached !== undefined) return cached;
  const url = process.env.DESKVIEW_URL?.replace(/\/+$/, "");
  if (!url) return (cached = null);
  const u = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) {
    // deskview is loopback-only by design; refusing here keeps the token off the network.
    throw new Error("DESKVIEW_URL must point at loopback (127.0.0.1)");
  }
  let token = process.env.DESKVIEW_TOKEN ?? "";
  if (!token) {
    const file = (process.env.DESKVIEW_TOKEN_FILE ?? "~/.config/deskview/token").replace(/^~/, homedir());
    try {
      if ((statSync(file).mode & 0o077) !== 0) throw new Error("token file must be chmod 600");
      token = readFileSync(file, "utf8").trim();
    } catch (e) {
      throw new Error(`deskview token unavailable: ${e instanceof Error ? e.message : "unreadable"}`);
    }
  }
  return (cached = { url, token });
}

export async function deskviewFetch(path: string, timeoutMs = 6000): Promise<Response> {
  const cfg = deskviewConfig();
  if (!cfg) throw new Error("DESKVIEW_URL not configured");
  return fetch(cfg.url + path, { headers: { Authorization: `Bearer ${cfg.token}` }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
}

/** The exact deskview routes the dashboard may read. Anything else is refused before leaving this server. */
export const ALLOWED_PATH =
  /^(health|mode|settings|balance|positions|pnl|trades|discoveries|coins\/[A-Za-z0-9]{1,64}|events|agents|alerts|pushes|logs\/[a-z_]{1,20}|history\/nights|wallets|lessons|frames\/latest|snapshot|series)$/;
export const ALLOWED_QUERY = new Set(["night", "since_id", "limit", "status", "after_id", "topic", "tail", "since"]);
