# AUTOPSY external target contract

AUTOPSY investigates systems that take **structured numeric or categorical inputs** and return **one numeric output** per input (credit limits, prices, premiums, candidate/fraud/ranking scores). Text generation, images, stateful systems and classification labels are not supported yet.

## Request formats

Pick one when you connect the target.

### Batch (preferred)

```http
POST https://your-api.example.com/score
Content-Type: application/json
x-api-key: <optional credential>

{ "inputs": [ { "income": 52000, "segment": "b" }, { "income": 18000, "segment": "a" } ] }
```

Respond with one number per input, in the same order:

```json
{ "outputs": [61.5, 22.0] }
```

- AUTOPSY sends at most 64 inputs per request (configurable down to 1).
- Output path examples: `outputs`, `data[*].score` for `{ "data": [{ "score": 61.5 }, …] }`.

### Single input

```json
{ "input": { "income": 52000, "segment": "b" } }
```

Respond with one number, e.g. `{ "result": { "score": 61.5 } }` (output path `result.score`). AUTOPSY sends up to 4 requests in parallel.

## Rules for responses

| Situation | Requirement | What AUTOPSY does otherwise |
| --- | --- | --- |
| Output type | JSON number (not `"61.5"`, not `null`) | Stops with `non_numeric` |
| Batch count | exactly one output per input | Stops with `count_mismatch` |
| Body | valid JSON | Stops with `invalid_json` |
| Rate limiting | HTTP 429, ideally with `Retry-After` (seconds) | Retries twice with backoff, then `rate_limited` |
| Transient failure | HTTP 502/503/504 | Retries twice, then `http_error` |
| Auth failure | HTTP 401/403 | Stops with `unauthorized` |
| Redirects | not used | Refused (`redirect_blocked`) |
| Latency | under 10 s per request | `timeout` |
| Size | under 1 MB per response | `too_large` |

Inputs always respect the schema you define: numeric `min`/`max`, `integer` fields, and categorical `levels`.

## Credentials

Name a request header (for example `x-api-key` or `authorization`) and enter the value in AUTOPSY. The value:

- is held only in the browser tab's memory and sent over HTTPS to AUTOPSY's relay, which adds the header to the upstream request;
- is never written to local storage, case files, logs or exports;
- must be re-entered after a page reload.

URLs containing `user:password@` or query parameters such as `key`, `token` or `secret` are rejected.

## How requests are sent (server-mediated relay)

The browser never calls your API directly. AUTOPSY's `/api/proxy` route does, so **no CORS configuration is needed**. Because that server calls user-supplied URLs, it:

- accepts `https://` only (plain `http://` and private addresses are allowed only in local development, or with `AUTOPSY_ALLOW_PRIVATE_TARGETS=1`);
- resolves the hostname and checks **every** resolved address at connection time, refusing private, loopback, link-local, carrier-grade NAT, multicast, documentation and cloud-metadata ranges (including IPv4-mapped IPv6), which also defeats DNS rebinding;
- never follows redirects;
- enforces a 10 s timeout, a 1 MB response cap and at most 64 inputs per relay call.

## Budget accounting

- **Budget** = inputs evaluated. Analyst probes and "Test this finding" verifications spend it too.
- **HTTP requests** (including retries and failed attempts) are counted separately and shown in the workspace and reports.
- **Benchmarks** spend their own queries, reported separately from the investigation budget.

## Target definition (paste into "Paste schema JSON")

```json
{
  "name": "My scoring API",
  "description": "What the system decides.",
  "connection": { "url": "https://your-api.example.com/score", "mode": "batch", "outputPath": "outputs", "authHeader": "x-api-key" },
  "features": [
    { "key": "income", "label": "Annual income", "kind": "numeric", "min": 10000, "max": 200000, "integer": true },
    { "key": "segment", "label": "Segment", "kind": "categorical", "levels": ["a", "b", "c"] }
  ],
  "output": { "key": "score", "label": "Score", "unit": "pts", "format": "score", "min": 0, "max": 100 },
  "defaultBudget": 800
}
```
