import { getSpec } from "@/server/targets";

export async function GET(_req: Request, ctx: RouteContext<"/api/targets/[id]">) {
  const { id } = await ctx.params;
  const spec = getSpec(id);
  if (!spec) return Response.json({ error: `unknown target "${id}"` }, { status: 404 });
  return Response.json(spec);
}
