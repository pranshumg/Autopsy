// Target adapter: the single path every query takes, whether it comes from the
// investigation engine, an analyst probe, a finding verification, a surrogate
// check or the benchmark. Built-in targets are queried on their own endpoint;
// external targets go through the server relay (/api/proxy), which attaches the
// session credential and enforces the SSRF policy.

import { MAX_INPUTS_PER_CALL } from "@/lib/connection";
import type { Input, TargetSpec } from "@/lib/types";

export type AdapterResult = { outputs: number[]; requests: number; latencyMs: number; receiptId: string };

export class TargetError extends Error {
  constructor(
    public code: string,
    message: string,
    /** HTTP requests that reached (or were attempted against) the target before failing */
    public requests = 0,
  ) {
    super(message);
    this.name = "TargetError";
  }
}

export interface TargetAdapter {
  /** "builtin" or "external" */
  readonly kind: "builtin" | "external";
  query(inputs: Input[], signal?: AbortSignal): Promise<AdapterResult>;
}

type Opts = { origin: string; credential?: string; fetchImpl?: typeof fetch; timeoutMs?: number; retryDelayMs?: number };

const BUILTIN_TIMEOUT_MS = 15_000;
// the relay may fan a chunk out to many single-input requests, each with retries
const EXTERNAL_TIMEOUT_MS = 55_000;

function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; timedOut: () => boolean } {
  const t = AbortSignal.timeout(ms);
  return { signal: signal ? AbortSignal.any([signal, t]) : t, timedOut: () => t.aborted && !signal?.aborted };
}

/** Checks a target's outputs against the number of inputs sent. */
export function checkOutputs(outputs: unknown, expected: number): number[] {
  if (!Array.isArray(outputs)) throw new TargetError("missing_output", "Target response did not include an outputs array.");
  if (outputs.length !== expected) throw new TargetError("count_mismatch", `Sent ${expected} inputs but received ${outputs.length} outputs.`);
  outputs.forEach((v, i) => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new TargetError("non_numeric", `Output ${i + 1} is not a finite number.`);
  });
  return outputs as number[];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new TargetError("cancelled", "Query cancelled."));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new TargetError("cancelled", "Query cancelled."))), { once: true });
  });

export function createAdapter(spec: TargetSpec, opts: Opts): TargetAdapter {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const external = spec.origin === "external";
  const python = spec.origin === "python";
  if (external && !spec.connection) throw new TargetError("invalid_connection", "External target has no connection settings.");
  const timeoutMs = opts.timeoutMs ?? (external ? EXTERNAL_TIMEOUT_MS : BUILTIN_TIMEOUT_MS);
  const retryDelay = opts.retryDelayMs ?? 300;

  async function chunk(inputs: Input[], signal?: AbortSignal): Promise<AdapterResult> {
    let requests = 0;
    let last: TargetError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw new TargetError("cancelled", "Query cancelled.", requests);
      const t = withTimeout(signal, timeoutMs);
      const started = Date.now();
      let res: Response;
      try {
        res = external
          ? await doFetch(`${opts.origin}/api/proxy`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ connection: spec.connection, inputs, credential: opts.credential || undefined }),
              signal: t.signal,
            })
          : await doFetch(python ? `${opts.origin}/api/engine/targets/${spec.id}/query` : `${opts.origin}/api/targets/${spec.id}/query`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ inputs }),
              signal: t.signal,
            });
      } catch {
        if (signal?.aborted) throw new TargetError("cancelled", "Query cancelled.", requests);
        // for built-ins the request may have reached the target; for external targets the relay was not reached
        if (!external) requests++;
        last = t.timedOut() ? new TargetError("timeout", `No response within ${Math.round(timeoutMs / 1000)}s.`, requests) : new TargetError("network", "Network error reaching the query service.", requests);
        await sleep(retryDelay * (attempt + 1), signal);
        continue;
      }
      const data = (await res.json().catch(() => null)) as { outputs?: unknown; error?: string; code?: string; requests?: number; receipt?: { id?: string; requests?: number } } | null;
      if (external) requests += data?.receipt?.requests ?? data?.requests ?? 0;
      else requests += python ? inputs.length : 1;
      if (res.ok && data) {
        try {
          const outputs = checkOutputs(data.outputs, inputs.length);
          return { outputs, requests, latencyMs: Date.now() - started, receiptId: data.receipt?.id ?? `r_${started.toString(36)}` };
        } catch (e) {
          throw Object.assign(e as TargetError, { requests });
        }
      }
      const msg = data?.error ?? `HTTP ${res.status}`;
      const code = data?.code ?? (res.status === 429 ? "rate_limited" : "http_error");
      if (code === "cancelled") throw new TargetError("cancelled", "Query cancelled.", requests);
      // the relay already retried the upstream; only built-in transport failures are retried here
      const retryable = !external && (res.status >= 500 || res.status === 429);
      last = new TargetError(code, external ? msg : `Target rejected query: ${msg}`, requests);
      if (!retryable) throw last;
      await sleep(retryDelay * (attempt + 1), signal);
    }
    throw last ?? new TargetError("network", "Query failed.", requests);
  }

  return {
    kind: external ? "external" : "builtin",
    async query(inputs, signal) {
      const outputs: number[] = [];
      let requests = 0;
      let latencyMs = 0;
      let receiptId = "";
      for (let i = 0; i < inputs.length; i += MAX_INPUTS_PER_CALL) {
        try {
          const r = await chunk(inputs.slice(i, i + MAX_INPUTS_PER_CALL), signal);
          outputs.push(...r.outputs);
          requests += r.requests;
          latencyMs += r.latencyMs;
          receiptId = r.receiptId;
        } catch (e) {
          const te = e instanceof TargetError ? e : new TargetError("network", (e as Error).message);
          te.requests += requests;
          throw te;
        }
      }
      return { outputs, requests, latencyMs, receiptId };
    },
  };
}
