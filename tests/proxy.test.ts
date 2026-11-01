import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTarget, guardedPost, isBlockedAddress, ProxyError, type PostFn, type UpstreamResponse } from "@/server/proxy";
import type { Connection } from "@/lib/types";

const conn = (p: Partial<Connection> = {}): Connection => ({ url: "https://api.example.com/score", mode: "batch", outputPath: "outputs", ...p });
const ok = (body: unknown, status = 200, headers: UpstreamResponse["headers"] = {}): UpstreamResponse => ({ status, headers, body: JSON.stringify(body) });
const inputs = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i }));

async function fails(p: Promise<unknown>): Promise<ProxyError> {
  try {
    await p;
  } catch (e) {
    return e as ProxyError;
  }
  throw new Error("expected failure");
}

describe("SSRF address policy", () => {
  it("blocks private, loopback, link-local, metadata and mapped addresses", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::10.0.0.1", "::ffff:a9fe:a9fe",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "76.76.21.21", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it("treats non-IPs as blocked", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("guarded HTTP client against a real local server", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest" });
        return res.end();
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const n = (JSON.parse(body) as { inputs: unknown[] }).inputs.length;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ outputs: Array.from({ length: n }, (_, i) => i * 2), echoKey: req.headers["x-api-key"] ?? null }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("refuses loopback IP literals when private targets are not allowed", async () => {
    const e = await fails(callTarget({ connection: conn({ url: `http://127.0.0.1:${port}/` }), inputs: inputs(1), signal: new AbortController().signal, post: guardedPost({ allowPrivate: false }), allowHttp: true }));
    expect(e.code).toBe("blocked_destination");
    expect(e.requests).toBe(0);
  });
  it("refuses hostnames that resolve to loopback (checked at connect time)", async () => {
    const e = await fails(callTarget({ connection: conn({ url: `http://localhost:${port}/` }), inputs: inputs(1), signal: new AbortController().signal, post: guardedPost({ allowPrivate: false }), allowHttp: true }));
    expect(e.code).toBe("blocked_destination");
  });
  it("works when private targets are explicitly allowed (local development)", async () => {
    const r = await callTarget({ connection: conn({ url: `http://127.0.0.1:${port}/` }), inputs: inputs(3), signal: new AbortController().signal, post: guardedPost({ allowPrivate: true }), allowHttp: true });
    expect(r.outputs).toEqual([0, 2, 4]);
    expect(r.requests).toBe(1);
  });
  it("never follows redirects", async () => {
    const e = await fails(callTarget({ connection: conn({ url: `http://127.0.0.1:${port}/redirect` }), inputs: inputs(1), signal: new AbortController().signal, post: guardedPost({ allowPrivate: true }), allowHttp: true }));
    expect(e.code).toBe("redirect_blocked");
  });
  it("rejects plain http when http is not allowed", async () => {
    const e = await fails(callTarget({ connection: conn({ url: `http://127.0.0.1:${port}/` }), inputs: inputs(1), signal: new AbortController().signal, post: guardedPost({ allowPrivate: true }) }));
    expect(e.code).toBe("invalid_url");
    expect(e.requests).toBe(0);
  });
});

describe("relay behavior with a scripted upstream", () => {
  const run = (post: PostFn, p: Partial<Connection> = {}, n = 4, extra: { credential?: string; signal?: AbortSignal } = {}) =>
    callTarget({ connection: conn(p), inputs: inputs(n), post, signal: extra.signal ?? new AbortController().signal, credential: extra.credential });

  it("fans single-mode inputs out with bounded concurrency and keeps order", async () => {
    let live = 0;
    let peak = 0;
    const post: PostFn = async (_u, body) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return ok({ result: { v: (JSON.parse(body) as { input: { x: number } }).input.x * 10 } });
    };
    const r = await run(post, { mode: "single", outputPath: "result.v" }, 12);
    expect(r.outputs).toEqual(inputs(12).map((x) => x.x * 10));
    expect(r.requests).toBe(12);
    expect(peak).toBeLessThanOrEqual(4);
  });
  it("retries 429 with Retry-After and counts every request", async () => {
    let calls = 0;
    const post: PostFn = async () => (++calls === 1 ? ok({ error: "slow down" }, 429, { "retry-after": "0.05" }) : ok({ outputs: [1, 2, 3, 4] }));
    const r = await run(post);
    expect(r.outputs).toHaveLength(4);
    expect(r.requests).toBe(2);
    expect(r.retries).toBe(1);
  });
  it("gives up after bounded retries with an actionable error", async () => {
    const post: PostFn = async () => ok({}, 429, { "retry-after": "0.01" });
    const e = await fails(run(post));
    expect(e.code).toBe("rate_limited");
    expect(e.requests).toBe(3);
  });
  it("splits batches by maxBatch", async () => {
    const sizes: number[] = [];
    const post: PostFn = async (_u, body) => {
      const n = (JSON.parse(body) as { inputs: unknown[] }).inputs.length;
      sizes.push(n);
      return ok({ outputs: Array(n).fill(1) });
    };
    const r = await run(post, { maxBatch: 3 }, 7);
    expect(sizes).toEqual([3, 3, 1]);
    expect(r.requests).toBe(3);
  });
  it("reports invalid JSON, wrong counts and auth failures clearly", async () => {
    expect((await fails(run(async () => ({ status: 200, headers: {}, body: "<html>" })))).code).toBe("invalid_json");
    expect((await fails(run(async () => ok({ outputs: [1] }))))).toMatchObject({ code: "count_mismatch" });
    expect((await fails(run(async () => ok({ error: "no" }, 401))))).toMatchObject({ code: "unauthorized" });
    expect((await fails(run(async () => ok({ outputs: ["1", "2", "3", "4"] }))))).toMatchObject({ code: "non_numeric" });
  });
  it("attaches the credential header and requires it when configured", async () => {
    let seen: Record<string, string> = {};
    const post: PostFn = async (_u, _b, headers) => ((seen = headers), ok({ outputs: [0, 0, 0, 0] }));
    await run(post, { authHeader: "x-api-key" }, 4, { credential: "s3cret" });
    expect(seen["x-api-key"]).toBe("s3cret");
    const e = await fails(run(post, { authHeader: "x-api-key" }));
    expect(e.code).toBe("missing_credential");
    expect(e.message).not.toContain("s3cret");
  });
  it("stops promptly on cancellation and reports requests already sent", async () => {
    const ac = new AbortController();
    const post: PostFn = (_u, _b, _h, signal) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(ok({ result: { v: 1 } })), 200);
        signal.addEventListener("abort", () => (clearTimeout(t), reject(new ProxyError("cancelled", "Request cancelled.", 0, 499))));
      });
    const p = run(post, { mode: "single", outputPath: "result.v" }, 8, { signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    const e = await fails(p);
    expect(e.code).toBe("cancelled");
    expect(e.requests).toBe(4);
  });
});
