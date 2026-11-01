import { getChallenge } from "@/server/challenges";

/**
 * Ground truth for the SYNTHETIC sample challenge. The investigation engine
 * never calls this; the UI requests it only when the operator chooses to
 * reveal answers after an investigation has stopped.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/challenge/[id]/reveal">) {
  const { id } = await ctx.params;
  const ch = getChallenge(id);
  if (!ch) return Response.json({ error: `unknown challenge "${id}"` }, { status: 404 });
  return Response.json({ challenge: id, synthetic: true, rules: ch.truth }, { headers: { "cache-control": "no-store" } });
}
