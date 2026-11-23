import { ALLOWED_PATH, ALLOWED_QUERY, deskviewConfig, deskviewFetch } from "@/lib/server/deskview";

// Read-only proxy to deskview. GET only (no other method is exported), allow-listed paths and query keys.
export async function GET(req: Request, ctx: RouteContext<"/api/desk/[...path]">) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!ALLOWED_PATH.test(joined)) return Response.json({ detail: "not found" }, { status: 404 });
  try {
    if (!deskviewConfig()) return Response.json({ detail: "deskview not configured" }, { status: 503 });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : "config error" }, { status: 500 });
  }
  const incoming = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  incoming.forEach((v, k) => ALLOWED_QUERY.has(k) && qs.set(k, v.slice(0, 64)));
  try {
    const res = await deskviewFetch(`/api/v1/${joined}${qs.size ? `?${qs}` : ""}`);
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ detail: "deskview unreachable" }, { status: 502 });
  }
}
