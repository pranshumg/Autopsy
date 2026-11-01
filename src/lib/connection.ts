// The AUTOPSY query contract for external targets, plus the pure validation and
// output-extraction logic shared by the browser, the engine worker, the server
// proxy and the tests. Nothing in here performs I/O.

import type { Connection, Feature, Input, TargetSpec } from "@/lib/types";

/** Inputs AUTOPSY sends per proxied call (and the most a batch endpoint will ever receive at once). */
export const MAX_INPUTS_PER_CALL = 64;

export class ContractError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContractError";
  }
}

// ---------------------------------------------------------------- outputs

type PathStep = { key: string } | { index: number } | { each: true };

/** Parses "outputs", "outputs[*].score", "result.score", "data[0].value". */
export function parsePath(path: string): PathStep[] {
  const src = path.trim();
  if (!src) throw new ContractError("bad_output_path", "Output path is empty.");
  const steps: PathStep[] = [];
  const re = /([A-Za-z_$][\w$-]*)|\[(\*|\d+)\]|(\.)/gy;
  let m: RegExpExecArray | null;
  let expectKey = true;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    m = re.exec(src);
    if (!m || m.index !== at) throw new ContractError("bad_output_path", `Output path "${path}" is not valid near character ${at + 1}. Use dot keys and [n] or [*], e.g. "outputs[*].score".`);
    if (m[1]) {
      if (!expectKey) throw new ContractError("bad_output_path", `Output path "${path}" needs a "." before "${m[1]}".`);
      steps.push({ key: m[1] });
      expectKey = false;
    } else if (m[2]) {
      steps.push(m[2] === "*" ? { each: true } : { index: Number(m[2]) });
      expectKey = false;
    } else {
      if (expectKey) throw new ContractError("bad_output_path", `Output path "${path}" has an empty segment.`);
      expectKey = true;
    }
  }
  if (expectKey) throw new ContractError("bad_output_path", `Output path "${path}" cannot end with ".".`);
  if (steps.filter((s) => "each" in s).length > 1) throw new ContractError("bad_output_path", `Output path "${path}" may contain at most one [*].`);
  return steps;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === "string") return `the string ${JSON.stringify(v.length > 24 ? `${v.slice(0, 24)}…` : v)}`;
  return typeof v === "object" ? "an object" : `${typeof v} ${String(v)}`;
}

function walk(value: unknown, steps: PathStep[], path: string): unknown {
  let cur = value;
  for (const st of steps) {
    if ("key" in st) {
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) throw new ContractError("missing_output", `Response has no "${st.key}" at "${path}" (found ${describe(cur)}).`);
      if (!(st.key in (cur as Record<string, unknown>))) throw new ContractError("missing_output", `Response is missing "${st.key}" (output path "${path}").`);
      cur = (cur as Record<string, unknown>)[st.key];
    } else if ("index" in st) {
      if (!Array.isArray(cur) || st.index >= cur.length) throw new ContractError("missing_output", `Response has no element [${st.index}] at "${path}" (found ${describe(cur)}).`);
      cur = cur[st.index];
    }
  }
  return cur;
}

function toNumber(v: unknown, where: string): number {
  if (typeof v !== "number") throw new ContractError("non_numeric", `${where} must be a JSON number, but the target returned ${describe(v)}.`);
  if (!Number.isFinite(v)) throw new ContractError("non_numeric", `${where} is not a finite number.`);
  return v;
}

/**
 * Extracts exactly `expected` numeric outputs from a parsed response.
 * Batch responses must resolve to an array (directly or via [*]);
 * single responses must resolve to one number.
 */
export function extractOutputs(body: unknown, outputPath: string, expected: number, mode: Connection["mode"]): number[] {
  const steps = parsePath(outputPath);
  const star = steps.findIndex((s) => "each" in s);
  if (mode === "single") {
    if (star !== -1) throw new ContractError("bad_output_path", `Single-input mode expects one number; remove [*] from "${outputPath}".`);
    return [toNumber(walk(body, steps, outputPath), `Output "${outputPath}"`)];
  }
  let values: unknown[];
  if (star === -1) {
    const v = walk(body, steps, outputPath);
    if (!Array.isArray(v)) throw new ContractError("missing_output", `Output "${outputPath}" must be an array of numbers in batch mode (found ${describe(v)}).`);
    values = v;
  } else {
    const arr = walk(body, steps.slice(0, star), outputPath);
    if (!Array.isArray(arr)) throw new ContractError("missing_output", `"${outputPath}" expects an array before [*] (found ${describe(arr)}).`);
    values = arr.map((item, i) => walk(item, steps.slice(star + 1), `${outputPath} (item ${i})`));
  }
  if (values.length !== expected) {
    throw new ContractError("count_mismatch", `Sent ${expected} input${expected === 1 ? "" : "s"} but the response contained ${values.length} output${values.length === 1 ? "" : "s"}.`);
  }
  return values.map((v, i) => toNumber(v, `Output ${i + 1} of ${expected}`));
}

/** Request body for one upstream call under the contract. */
export function requestBody(mode: Connection["mode"], inputs: Input[]): unknown {
  return mode === "single" ? { input: inputs[0] } : { inputs };
}

// ------------------------------------------------------------- connection

const HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const FORBIDDEN_HEADERS = new Set([
  "host", "content-length", "content-type", "connection", "transfer-encoding", "cookie", "keep-alive",
  "proxy-authorization", "te", "trailer", "upgrade", "expect", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip",
]);
const SECRET_PARAM_RE = /(key|token|secret|password|passwd|auth|signature|sig|credential)/i;

/** Syntactic checks on an endpoint URL. Network-level checks happen on the server. */
export function validateEndpointUrl(raw: string, opts: { allowHttp?: boolean } = {}): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ContractError("invalid_url", "Endpoint must be a full URL, e.g. https://api.example.com/score.");
  }
  if (u.protocol !== "https:" && !(opts.allowHttp && u.protocol === "http:")) {
    throw new ContractError("invalid_url", opts.allowHttp ? "Endpoint must use https:// (or http:// for local development)." : "Endpoint must use https://.");
  }
  if (u.username || u.password) throw new ContractError("credential_in_url", "Remove the username/password from the URL. Put a credential in the API key field instead; it is kept in memory only.");
  for (const [k] of u.searchParams) {
    if (SECRET_PARAM_RE.test(k)) throw new ContractError("credential_in_url", `The URL contains a "${k}" parameter. Put credentials in the API key field instead, so they are never saved or exported.`);
  }
  if (u.hash) throw new ContractError("invalid_url", "Remove the #fragment from the endpoint URL.");
  return u;
}

export function validateHeaderName(name: string): string {
  const n = name.trim();
  if (!HEADER_RE.test(n)) throw new ContractError("bad_header", `"${name}" is not a valid HTTP header name.`);
  if (FORBIDDEN_HEADERS.has(n.toLowerCase())) throw new ContractError("bad_header", `The "${n}" header cannot be used for credentials.`);
  return n;
}

export function validateCredential(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new ContractError("bad_credential", "The credential contains line breaks or control characters.");
  if (value.length > 4096) throw new ContractError("bad_credential", "The credential is longer than 4096 characters.");
  return value;
}

export function validateConnection(c: Connection, opts: { allowHttp?: boolean } = {}): Connection {
  validateEndpointUrl(c.url, opts);
  if (c.mode !== "batch" && c.mode !== "single") throw new ContractError("bad_mode", 'Mode must be "batch" or "single".');
  parsePath(c.outputPath);
  if (c.mode === "single" && c.outputPath.includes("[*]")) throw new ContractError("bad_output_path", "Single-input mode expects one number; remove [*] from the output path.");
  if (c.authHeader) validateHeaderName(c.authHeader);
  if (c.maxBatch !== undefined && (!Number.isInteger(c.maxBatch) || c.maxBatch < 1 || c.maxBatch > MAX_INPUTS_PER_CALL)) {
    throw new ContractError("bad_batch", `Batch size must be an integer from 1 to ${MAX_INPUTS_PER_CALL}.`);
  }
  return c;
}

// ----------------------------------------------------------------- schema

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/;

/** Returns a list of human-readable problems with a target definition (empty when valid). */
export function schemaProblems(spec: Pick<TargetSpec, "name" | "features" | "output" | "defaultBudget">): string[] {
  const out: string[] = [];
  if (!spec.name.trim()) out.push("Give the target a name.");
  if (spec.features.length < 2) out.push("Define at least two input fields.");
  if (spec.features.length > 16) out.push("At most 16 input fields are supported.");
  const seen = new Set<string>();
  spec.features.forEach((f, i) => {
    const at = `Field ${i + 1}${f.key ? ` (${f.key})` : ""}`;
    if (!KEY_RE.test(f.key)) out.push(`${at}: key must start with a letter and use only letters, digits and underscores.`);
    if (seen.has(f.key)) out.push(`${at}: duplicate key.`);
    seen.add(f.key);
    if (!f.label.trim()) out.push(`${at}: add a label.`);
    if (f.kind === "numeric") {
      if (!Number.isFinite(f.min) || !Number.isFinite(f.max)) out.push(`${at}: min and max must be numbers.`);
      else if (f.min >= f.max) out.push(`${at}: min must be less than max.`);
      else if (f.integer && (!Number.isInteger(f.min) || !Number.isInteger(f.max))) out.push(`${at}: integer fields need whole-number bounds.`);
      else if (f.integer && f.max - f.min < 1) out.push(`${at}: integer range must span at least 1.`);
    } else {
      const lv = f.levels.map((l) => l.trim()).filter(Boolean);
      if (lv.length < 2) out.push(`${at}: categorical fields need at least two options.`);
      if (new Set(lv).size !== lv.length) out.push(`${at}: options must be unique.`);
      if (lv.length > 12) out.push(`${at}: at most 12 options.`);
    }
  });
  if (!spec.output.label.trim()) out.push("Name the output (e.g. Score).");
  if (!Number.isFinite(spec.output.min) || !Number.isFinite(spec.output.max) || spec.output.min >= spec.output.max) out.push("Output range: min must be less than max (used for display only).");
  if (!Number.isInteger(spec.defaultBudget) || spec.defaultBudget < 300 || spec.defaultBudget > 5000) out.push("Query budget must be a whole number from 300 to 5,000.");
  return out;
}

/** Validates one input against a schema (mirrors the built-in target validation). */
export function inputProblem(features: Feature[], x: Input): string | null {
  for (const f of features) {
    const v = x[f.key];
    if (v === undefined) return `missing field "${f.key}"`;
    if (f.kind === "numeric") {
      if (typeof v !== "number" || !Number.isFinite(v)) return `"${f.key}" must be a finite number`;
      if (v < f.min || v > f.max) return `"${f.key}" out of range [${f.min}, ${f.max}]`;
      if (f.integer && !Number.isInteger(v)) return `"${f.key}" must be an integer`;
    } else if (typeof v !== "string" || !f.levels.includes(v)) {
      return `"${f.key}" must be one of ${f.levels.join(", ")}`;
    }
  }
  return null;
}

/** A deterministic, schema-valid example input (field midpoints / first option). */
export function sampleInput(features: Feature[]): Input {
  const x: Input = {};
  for (const f of features) {
    if (f.kind === "numeric") {
      const mid = (f.min + f.max) / 2;
      x[f.key] = f.integer ? Math.round(mid) : Math.round(mid * 1000) / 1000;
    } else x[f.key] = f.levels[0];
  }
  return x;
}
