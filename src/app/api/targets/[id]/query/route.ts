import { evaluate, getSpec, MAX_BATCH, validateInput } from "@/server/targets";
import type { QueryResponse } from "@/lib/types";

let served = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Query a black-box target. Body: { inputs: Input[] } (max 64 per call).
 * Responses carry a small simulated network latency so investigations
 * behave like they would against a remote production API.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/targets/[id]/query">) {
  const { id } = await ctx.params;
  const spec = getSpec(id);
  if (!spec) return Response.json({ error: `unknown target "${id}"` }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const inputs = (body as { inputs?: unknown })?.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return Response.json({ error: "body.inputs must be a non-empty array" }, { status: 400 });
  }
  if (inputs.length > MAX_BATCH) {
    return Response.json({ error: `batch too large (max ${MAX_BATCH})` }, { status: 413 });
  }
  for (let i = 0; i < inputs.length; i++) {
    const err = validateInput(spec, inputs[i]);
    if (err) return Response.json({ error: `inputs[${i}]: ${err}` }, { status: 422 });
  }

  const started = Date.now();
  await sleep(25 + Math.random() * 45 + inputs.length * 0.6);
  const outputs = evaluate(id, inputs);
  served += inputs.length;
  const res: QueryResponse = {
    outputs,
    receipt: {
      id: `q_${started.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      served,
      latencyMs: Date.now() - started,
      at: Date.now(),
    },
  };
  return Response.json(res, { headers: { "cache-control": "no-store" } });
}
