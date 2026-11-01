import { describe, expect, it } from "vitest";
import { createAdapter, TargetError } from "@/lib/adapter";
import type { TargetSpec } from "@/lib/types";

const spec = (p: Partial<TargetSpec> = {}): TargetSpec => ({
  id: "t1",
  name: "T",
  vendor: "",
  version: "",
  domain: "",
  endpoint: "",
  description: "",
  output: { key: "y", label: "Y", unit: "", format: "number", min: 0, max: 1 },
  features: [
    { key: "a", label: "A", kind: "numeric", min: 0, max: 1, description: "" },
    { key: "b", label: "B", kind: "numeric", min: 0, max: 1, description: "" },
  ],
  defaultBudget: 500,
  stochastic: false,
  ...p,
});
const external = spec({ origin: "external", connection: { url: "https://api.example.com/x", mode: "batch", outputPath: "outputs" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const xs = (n: number) => Array.from({ length: n }, (_, i) => ({ a: i / 100, b: 0 }));

async function fails(p: Promise<unknown>): Promise<TargetError> {
  try {
    await p;
  } catch (e) {
    return e as TargetError;
  }
  throw new Error("expected failure");
}

describe("built-in adapter", () => {
  it("chunks at 64 inputs and counts one request per chunk", async () => {
    const urls: string[] = [];
    const a = createAdapter(spec(), {
      origin: "http://o",
      fetchImpl: async (u, init) => {
        urls.push(String(u));
        const n = (JSON.parse(String(init!.body)) as { inputs: unknown[] }).inputs.length;
        return json({ outputs: Array(n).fill(1), receipt: { id: "r" } });
      },
    });
    const r = await a.query(xs(130));
    expect(r.outputs).toHaveLength(130);
    expect(r.requests).toBe(3);
    expect(urls[0]).toBe("http://o/api/targets/t1/query");
  });
  it("retries server errors and counts every attempt", async () => {
    let n = 0;
    const a = createAdapter(spec(), { origin: "http://o", retryDelayMs: 1, fetchImpl: async () => (++n < 3 ? json({ error: "boom" }, 503) : json({ outputs: [5] })) });
    const r = await a.query(xs(1));
    expect(r.requests).toBe(3);
  });
  it("does not retry client errors", async () => {
    let n = 0;
    const a = createAdapter(spec(), { origin: "http://o", retryDelayMs: 1, fetchImpl: async () => (n++, json({ error: "bad input" }, 422)) });
    const e = await fails(a.query(xs(1)));
    expect(n).toBe(1);
    expect(e.message).toMatch(/bad input/);
    expect(e.requests).toBe(1);
  });
  it("rejects responses with the wrong number of outputs", async () => {
    const a = createAdapter(spec(), { origin: "http://o", fetchImpl: async () => json({ outputs: [1, 2] }) });
    expect((await fails(a.query(xs(3)))).code).toBe("count_mismatch");
  });
});

describe("external adapter", () => {
  it("goes through the relay with the connection and session credential", async () => {
    let sent: { connection?: unknown; credential?: string } = {};
    let url = "";
    const a = createAdapter(external, {
      origin: "http://o",
      credential: "k",
      fetchImpl: async (u, init) => {
        url = String(u);
        sent = JSON.parse(String(init!.body));
        return json({ outputs: [1, 2], receipt: { id: "px", requests: 5 } });
      },
    });
    const r = await a.query(xs(2));
    expect(url).toBe("http://o/api/proxy");
    expect(sent.credential).toBe("k");
    expect(sent.connection).toEqual(external.connection);
    expect(r.requests).toBe(5);
  });
  it("propagates relay errors with their request counts, without client retries", async () => {
    let n = 0;
    const a = createAdapter(external, { origin: "http://o", fetchImpl: async () => (n++, json({ error: "Target is rate limiting", code: "rate_limited", requests: 3 }, 502)) });
    const e = await fails(a.query(xs(2)));
    expect(n).toBe(1);
    expect(e.code).toBe("rate_limited");
    expect(e.requests).toBe(3);
  });
  it("aggregates requests across chunks when a later chunk fails", async () => {
    let n = 0;
    const a = createAdapter(external, {
      origin: "http://o",
      fetchImpl: async (_u, init) => {
        const k = (JSON.parse(String(init!.body)) as { inputs: unknown[] }).inputs.length;
        return ++n === 1 ? json({ outputs: Array(k).fill(0), receipt: { requests: 2 } }) : json({ error: "bad json", code: "invalid_json", requests: 1 }, 502);
      },
    });
    const e = await fails(a.query(xs(100)));
    expect(e.code).toBe("invalid_json");
    expect(e.requests).toBe(3);
  });
  it("cancels in-flight requests", async () => {
    const ac = new AbortController();
    const a = createAdapter(external, {
      origin: "http://o",
      fetchImpl: (_u, init) =>
        new Promise((_res, rej) => {
          init!.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        }),
    });
    const p = a.query(xs(2), ac.signal);
    setTimeout(() => ac.abort(), 10);
    expect((await fails(p)).code).toBe("cancelled");
  });
  it("times out a stuck relay", async () => {
    const a = createAdapter(external, {
      origin: "http://o",
      timeoutMs: 30,
      retryDelayMs: 1,
      fetchImpl: (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener("abort", () => rej(new DOMException("t", "TimeoutError")))),
    });
    expect((await fails(a.query(xs(1)))).code).toBe("timeout");
  });
});
