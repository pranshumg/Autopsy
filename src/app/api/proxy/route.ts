import { callTarget, defaultPolicy, guardedPost, ProxyError } from "@/server/proxy";
import { MAX_INPUTS_PER_CALL } from "@/lib/connection";
import type { Connection, Input } from "@/lib/types";

export const maxDuration = 60;

const MAX_BODY_BYTES = 256_000;

function bad(code: string, error: string, status = 400, requests = 0) {
  return Response.json({ error, code, requests }, { status, headers: { "cache-control": "no-store" } });
}

function isInput(x: unknown): x is Input {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const entries = Object.entries(x);
  return entries.length > 0 && entries.length <= 32 && entries.every(([k, v]) => k.length <= 64 && ((typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 128)));
}

/**
 * Relays one batch of inputs to an external target that implements the
 * AUTOPSY contract. Body: { connection, inputs, credential? }.
 * The credential is attached as a request header upstream and is never
 * logged, echoed or stored.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return bad("too_large", "Request body too large.", 413);
  let body: { connection?: Connection; inputs?: unknown; credential?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return bad("invalid_json", "Body must be JSON.");
  }
  const { connection, inputs, credential } = body;
  if (!connection || typeof connection !== "object" || typeof connection.url !== "string" || typeof connection.outputPath !== "string") {
    return bad("invalid_connection", "Body must include connection { url, mode, outputPath }.");
  }
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_INPUTS_PER_CALL) {
    return bad("bad_inputs", `inputs must be an array of 1-${MAX_INPUTS_PER_CALL} objects.`);
  }
  if (!inputs.every(isInput)) return bad("bad_inputs", "Each input must be a flat object of numbers and short strings.");
  if (credential !== undefined && typeof credential !== "string") return bad("bad_credential", "credential must be a string.");

  const policy = defaultPolicy();
  try {
    const res = await callTarget({
      connection: {
        url: connection.url,
        mode: connection.mode,
        outputPath: connection.outputPath,
        authHeader: connection.authHeader || undefined,
        maxBatch: connection.maxBatch,
      },
      inputs,
      credential: credential || undefined,
      signal: req.signal,
      post: guardedPost(policy),
      allowHttp: policy.allowPrivate,
    });
    return Response.json(
      { outputs: res.outputs, receipt: { id: `px_${Date.now().toString(36)}`, requests: res.requests, retries: res.retries, latencyMs: res.latencyMs, at: Date.now() } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const pe = e instanceof ProxyError ? e : new ProxyError("internal", "Unexpected relay failure.");
    return bad(pe.code, pe.message, pe.status, pe.requests);
  }
}
