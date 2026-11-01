// Same-origin relay to the Python AUTOPSY engine (backend/). Streams Server-Sent
// Events through unchanged. The engine URL is fixed by server configuration, so
// this route cannot be pointed at arbitrary hosts.

const ENGINE = (process.env.AUTOPSY_ENGINE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const SAFE = /^[A-Za-z0-9_.\-]+$/;

export const maxDuration = 300;

async function relay(req: Request, ctx: RouteContext<"/api/engine/[...path]">) {
  const { path } = await ctx.params;
  if (!path.length || !path.every((p) => SAFE.test(p))) return Response.json({ error: "bad path" }, { status: 400 });
  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE}/${path.join("/")}`, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        accept: req.headers.get("accept") ?? "application/json",
        // lets a reconnecting EventSource resume a run's event stream where it left off
        ...(req.headers.get("last-event-id") ? { "last-event-id": req.headers.get("last-event-id")! } : {}),
      },
      body: req.method === "GET" ? undefined : await req.text(),
      signal: req.signal,
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: `The Python engine is not running at ${ENGINE}. Start it with: cd backend && uv run python run.py`, code: "engine_offline" },
      { status: 503 },
    );
  }
  const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-cache, no-transform" });
  return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = relay;
export const POST = relay;
