import { deskviewConfig } from "@/lib/server/deskview";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events bridge to deskview's WebSocket. The server authenticates with the bearer token;
 * the browser only ever sees frames. The browser cannot send anything upstream except a resume cursor.
 */
export async function GET(req: Request) {
  let cfg;
  try {
    cfg = deskviewConfig();
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : "config error" }, { status: 500 });
  }
  if (!cfg) return Response.json({ detail: "deskview not configured" }, { status: 503 });
  const after = Number(new URL(req.url).searchParams.get("after_id") ?? 0) || 0;
  const wsUrl = cfg.url.replace(/^http/, "ws") + "/ws";
  const token = cfg.token;
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      const ws = new WebSocket(wsUrl);
      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      const finish = () => {
        if (closed) return;
        send("event: closed\ndata: {}\n\n");
        closed = true;
        clearInterval(ping);
        try {
          ws.close();
        } catch {}
        controller.close();
      };
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", token }));
        if (after > 0) ws.send(JSON.stringify({ type: "resume", after_id: after }));
      };
      ws.onmessage = (e) => send(`data: ${typeof e.data === "string" ? e.data : ""}\n\n`);
      ws.onerror = () => finish();
      ws.onclose = () => finish();
      req.signal.addEventListener("abort", finish);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
