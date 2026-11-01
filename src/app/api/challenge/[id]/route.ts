import { gauss, getChallenge, takeToken, validateChallengeInput } from "@/server/challenges";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * SYNTHETIC blind-challenge endpoint implementing the single-input AUTOPSY
 * contract: POST { input: {...} } with an x-api-key header, answers
 * { result: { apr } }. Rate-limited like a real API (429 + Retry-After).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/challenge/[id]">) {
  const { id } = await ctx.params;
  const ch = getChallenge(id);
  if (!ch) return Response.json({ error: `unknown challenge "${id}"` }, { status: 404 });
  if (req.headers.get("x-api-key") !== ch.key) return Response.json({ error: "missing or invalid x-api-key" }, { status: 401 });
  if (!takeToken()) return Response.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": "1" } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const input = (body as { input?: unknown })?.input;
  const err = validateChallengeInput(input);
  if (err) return Response.json({ error: err }, { status: 422 });
  await sleep(10 + Math.random() * 25);
  return Response.json({ result: { apr: ch.evaluate(input as Record<string, number | string>, gauss) } }, { headers: { "cache-control": "no-store" } });
}
