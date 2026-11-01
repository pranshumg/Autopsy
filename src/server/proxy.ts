// Server-side relay to external black-box targets.
//
// Requests are server-mediated (not browser-direct) so that target APIs need no
// CORS configuration and a session credential is attached on the server only.
// Because the server makes requests to user-supplied URLs, it is hardened
// against SSRF: https only, every resolved address is checked at connect time
// (so DNS rebinding cannot swap in a private address after validation),
// redirects are never followed, and responses are size- and time-limited.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { ContractError, extractOutputs, MAX_INPUTS_PER_CALL, requestBody, validateConnection, validateCredential } from "@/lib/connection";
import type { Connection, Input } from "@/lib/types";

export const UPSTREAM_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 1_000_000;
export const SINGLE_MODE_CONCURRENCY = 4;
export const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 4_000;

/** Private, loopback, link-local, CGNAT, multicast, documentation and other non-public ranges. */
const blocked = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["100::", 64], ["2001::", 23],
] as const) blocked.addSubnet(a, p, "ipv6");

/** Extracts an embedded IPv4 address from IPv4-mapped/compatible or NAT64 IPv6 forms. */
function embeddedV4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return m[1];
  const h = ip.toLowerCase().match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (h) {
    const hi = parseInt(h[1], 16);
    const lo = parseInt(h[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isBlockedAddress(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return blocked.check(ip, "ipv4");
  if (fam === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true;
}

export class ProxyError extends Error {
  constructor(
    public code: string,
    message: string,
    public requests = 0,
    public status = 502,
  ) {
    super(message);
    this.name = "ProxyError";
  }
}

export type Policy = { allowPrivate: boolean };

/** Private destinations are only reachable in local development or when explicitly enabled. */
export function defaultPolicy(): Policy {
  return { allowPrivate: process.env.AUTOPSY_ALLOW_PRIVATE_TARGETS === "1" || process.env.NODE_ENV === "development" };
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup replacement that refuses to connect to blocked addresses. */
export function guardedLookup(policy: Policy) {
  return (hostname: string, options: { all?: boolean }, cb: LookupCb) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err, options.all ? [] : "");
      if (!addrs.length) return cb(Object.assign(new Error(`Could not resolve ${hostname}`), { code: "ENOTFOUND" }), options.all ? [] : "");
      if (!policy.allowPrivate) {
        const bad = addrs.find((a) => isBlockedAddress(a.address));
        if (bad) return cb(Object.assign(new Error(`blocked destination ${bad.address}`), { code: "EBLOCKED" }), options.all ? [] : "");
      }
      if (options.all) cb(null, addrs);
      else cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

export type UpstreamResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
export type PostFn = (url: URL, body: string, headers: Record<string, string>, signal: AbortSignal) => Promise<UpstreamResponse>;

/** POST with SSRF-guarded DNS, no redirects, a hard timeout and a response size cap. */
export function guardedPost(policy: Policy): PostFn {
  return (url, body, headers, signal) =>
    new Promise((resolve, reject) => {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (net.isIP(host) && !policy.allowPrivate && isBlockedAddress(host)) {
        reject(new ProxyError("blocked_destination", `Requests to ${host} are not allowed: it is a private, loopback or reserved address.`, 0, 400));
        return;
      }
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(
        url,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", accept: "application/json", "user-agent": "AUTOPSY-auditor/1.0", "content-length": Buffer.byteLength(body) },
          lookup: guardedLookup(policy) as unknown as typeof dnsLookup,
          signal,
          timeout: UPSTREAM_TIMEOUT_MS,
        },
        (res) => {
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_RESPONSE_BYTES) {
              req.destroy(new ProxyError("too_large", `Target response exceeded ${MAX_RESPONSE_BYTES / 1_000_000} MB.`));
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new ProxyError("timeout", `Target did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s.`)));
      req.on("error", (e: NodeJS.ErrnoException) => {
        if (e instanceof ProxyError) return reject(e);
        if (e.name === "AbortError") return reject(new ProxyError("cancelled", "Request cancelled.", 0, 499));
        if (e.code === "EBLOCKED") return reject(new ProxyError("blocked_destination", `Requests to ${url.hostname} are not allowed: it resolves to a private, loopback or reserved address.`, 0, 400));
        if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") return reject(new ProxyError("dns", `Could not resolve ${url.hostname}.`));
        if (e.code === "ECONNREFUSED") return reject(new ProxyError("unreachable", `Connection to ${url.host} was refused.`));
        if (e.code === "CERT_HAS_EXPIRED" || e.code?.startsWith("ERR_TLS") || e.code?.includes("CERT")) return reject(new ProxyError("tls", `TLS error connecting to ${url.host} (${e.code}).`));
        reject(new ProxyError("network", `Network error contacting ${url.host}${e.code ? ` (${e.code})` : ""}.`));
      });
      req.end(body);
    });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new ProxyError("cancelled", "Request cancelled.", 0, 499));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new ProxyError("cancelled", "Request cancelled.", 0, 499))), { once: true });
  });

function retryAfterMs(h: UpstreamResponse["headers"], attempt: number): number {
  const raw = h["retry-after"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const secs = v !== undefined ? Number(v) : NaN;
  const ms = Number.isFinite(secs) ? secs * 1000 : 400 * 2 ** attempt;
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(100, ms));
}

export type CallResult = { outputs: number[]; requests: number; retries: number; latencyMs: number };
export type CallOptions = { connection: Connection; inputs: Input[]; credential?: string; signal: AbortSignal; post: PostFn; allowHttp?: boolean };

/** Sends inputs to an external target under the AUTOPSY contract and returns validated numeric outputs. */
export async function callTarget(opts: CallOptions): Promise<CallResult> {
  const { connection, inputs, credential, post } = opts;
  try {
    validateConnection(connection, { allowHttp: opts.allowHttp });
    if (credential) validateCredential(credential);
  } catch (e) {
    throw new ProxyError(e instanceof ContractError ? e.code : "invalid_connection", (e as Error).message, 0, 400);
  }
  if (!inputs.length || inputs.length > MAX_INPUTS_PER_CALL) throw new ProxyError("bad_inputs", `Send between 1 and ${MAX_INPUTS_PER_CALL} inputs per call.`, 0, 400);
  if (connection.authHeader && !credential) throw new ProxyError("missing_credential", `This target expects a credential in the "${connection.authHeader}" header. Enter it in the connection settings (it is kept in memory only).`, 0, 400);

  // one failing lane stops the others so no requests outlive the call
  const inner = new AbortController();
  const onAbort = () => inner.abort();
  if (opts.signal.aborted) inner.abort();
  else opts.signal.addEventListener("abort", onAbort, { once: true });
  const signal = inner.signal;
  const url = new URL(connection.url);
  const headers: Record<string, string> = connection.authHeader && credential ? { [connection.authHeader]: credential } : {};
  const started = Date.now();
  let requests = 0;
  let retries = 0;

  const one = async (chunk: Input[]): Promise<number[]> => {
    const payload = JSON.stringify(requestBody(connection.mode, chunk));
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new ProxyError("cancelled", "Request cancelled.", requests, 499);
      requests++;
      let res: UpstreamResponse;
      try {
        res = await post(url, payload, headers, signal);
      } catch (e) {
        const pe = e instanceof ProxyError ? e : new ProxyError("network", (e as Error).message);
        // refused before any connection was made: nothing reached the target
        if (pe.code === "blocked_destination" || pe.code === "dns") requests--;
        const transient = pe.code === "timeout" || pe.code === "network" || pe.code === "unreachable";
        if (transient && attempt < MAX_RETRIES) {
          retries++;
          await sleep(300 * 2 ** attempt, signal);
          continue;
        }
        throw pe;
      }
      if (res.status >= 300 && res.status < 400) {
        throw new ProxyError("redirect_blocked", `Target answered with a redirect (HTTP ${res.status}). Redirects are not followed for security; use the final URL directly.`);
      }
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        if (attempt < MAX_RETRIES) {
          retries++;
          await sleep(retryAfterMs(res.headers, attempt), signal);
          continue;
        }
        throw new ProxyError(res.status === 429 ? "rate_limited" : "http_error", res.status === 429 ? `Target is rate limiting requests (HTTP 429) and still refused after ${MAX_RETRIES} retries. Lower the pace or try again shortly.` : `Target returned HTTP ${res.status} after ${MAX_RETRIES} retries.`);
      }
      if (res.status === 401 || res.status === 403) throw new ProxyError("unauthorized", `Target refused the request (HTTP ${res.status}). Check the credential and header name.`);
      if (res.status < 200 || res.status >= 300) {
        throw new ProxyError("http_error", `Target returned HTTP ${res.status}${res.body ? `: ${res.body.slice(0, 160).replace(/\s+/g, " ")}` : ""}.`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        throw new ProxyError("invalid_json", `Target response is not valid JSON${res.body ? ` (starts with ${JSON.stringify(res.body.slice(0, 40))})` : " (empty body)"}.`);
      }
      try {
        return extractOutputs(parsed, connection.outputPath, chunk.length, connection.mode);
      } catch (e) {
        throw new ProxyError(e instanceof ContractError ? e.code : "invalid_response", (e as Error).message);
      }
    }
  };

  try {
    let outputs: number[];
    if (connection.mode === "single") {
      outputs = new Array(inputs.length);
      let next = 0;
      const lanes = Array.from({ length: Math.min(SINGLE_MODE_CONCURRENCY, inputs.length) }, async () => {
        while (next < inputs.length) {
          const i = next++;
          outputs[i] = (await one([inputs[i]]))[0];
        }
      });
      await Promise.all(lanes);
    } else {
      const size = connection.maxBatch ?? MAX_INPUTS_PER_CALL;
      outputs = [];
      for (let i = 0; i < inputs.length; i += size) outputs.push(...(await one(inputs.slice(i, i + size))));
    }
    return { outputs, requests, retries, latencyMs: Date.now() - started };
  } catch (e) {
    inner.abort();
    const pe = e instanceof ProxyError ? e : new ProxyError("internal", "Unexpected relay failure.");
    if (opts.signal.aborted) pe.code = "cancelled";
    pe.requests = requests;
    throw pe;
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }
}
