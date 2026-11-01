"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardPaste, FlaskConical, Loader2, Pencil, Play, Plus, Save, Shuffle, Trash2, TriangleAlert, X } from "lucide-react";
import type { Connection, Feature, Input, TargetSpec } from "@/lib/types";
import { ContractError, inputProblem, MAX_INPUTS_PER_CALL, parsePath, requestBody, sampleInput, schemaProblems, validateConnection } from "@/lib/connection";
import { minimalDraft, sampleChallengeDraft, SAMPLE_CHALLENGE_KEY, type TargetDraft } from "@/lib/examples";
import { mulberry32 } from "@/lib/engine/stats";
import { randomInput } from "@/lib/engine/design";
import { useLab } from "@/lib/store";
import { cn } from "@/lib/format";
import { Chip, Label } from "@/components/ui";

const inputCls = "h-8 w-full rounded-md border border-line-2 bg-ink-950 px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-4 focus:border-signal/60";

const HINTS: Record<string, string> = {
  blocked_destination: "The relay refuses private, loopback and cloud-metadata addresses. Deploy the API on a public HTTPS URL, or run AUTOPSY locally (development mode allows localhost).",
  invalid_url: "Use a full https:// URL. Plain http:// is accepted only when AUTOPSY runs in local development.",
  credential_in_url: "Move the credential into the header fields below; it is then kept in memory only.",
  unauthorized: "Check the credential value and the header name your API expects.",
  missing_credential: "Enter the credential in the field below.",
  invalid_json: "The endpoint must answer with a JSON body (Content-Type: application/json).",
  missing_output: "Check the output path against the response shown by your API.",
  non_numeric: "Outputs must be JSON numbers (e.g. 12.5), not strings like \"12.5\".",
  count_mismatch: "In batch mode the response must contain exactly one output per input, in order.",
  rate_limited: "The API is throttling requests. AUTOPSY retries twice with backoff; slow the pace or raise the API's limit.",
  timeout: "The API took longer than 10 seconds to answer one request.",
  redirect_blocked: "Use the final URL directly; redirects are never followed.",
  dns: "Check the hostname.",
  unreachable: "Nothing is listening at that address.",
  http_error: "The API answered with an error status. Check its logs.",
  bad_output_path: "Use dot keys plus [n] or [*], e.g. outputs, outputs[*].score, result.score.",
};

function outputKey(path: string): string {
  try {
    const st = parsePath(path);
    for (let i = st.length - 1; i >= 0; i--) {
      const s = st[i];
      if ("key" in s) return s.key;
    }
  } catch {
    /* fall through */
  }
  return "output";
}

/** Builds an example response for the configured output path. */
function exampleResponse(path: string, mode: Connection["mode"], values: number[]): unknown {
  let steps;
  try {
    steps = parsePath(path);
  } catch {
    return { error: "invalid output path" };
  }
  const build = (i: number, v: unknown): unknown => {
    if (i < 0) return v;
    const s = steps[i];
    if ("key" in s) return build(i - 1, { [s.key]: v });
    if ("index" in s) return build(i - 1, [...Array(s.index).fill(null), v]);
    return v;
  };
  const star = steps.findIndex((s) => "each" in s);
  if (mode === "single") return build(steps.length - 1, values[0]);
  if (star === -1) return build(steps.length - 1, values);
  const tail = (v: number) => {
    let out: unknown = v;
    for (let i = steps.length - 1; i > star; i--) {
      const s = steps[i];
      out = "key" in s ? { [s.key]: out } : [out];
    }
    return out;
  };
  return build(star - 1, values.map(tail));
}

function NumInput({ value, onChange, label, className }: { value: number; onChange: (v: number) => void; label: string; className?: string }) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      className={cn(inputCls, "font-mono", className)}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.value.trim() === "" ? NaN : Number(e.target.value);
        onChange(v);
      }}
    />
  );
}

function LevelsInput({ levels, onChange, label }: { levels: string[]; onChange: (v: string[]) => void; label: string }) {
  const [text, setText] = useState(levels.join(", "));
  return (
    <input
      aria-label={label}
      className={cn(inputCls, "font-mono")}
      placeholder="option_a, option_b, option_c"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean));
      }}
    />
  );
}

type TestState = { status: "idle" } | { status: "busy" } | { status: "ok"; inputs: Input[]; outputs: number[]; requests: number; latencyMs: number } | { status: "error"; code: string; message: string; requests: number };

let draftSeq = 0;

export function ConnectBlackBox() {
  const router = useRouter();
  const externals = useLab((s) => s.externalTargets);
  const saveExternal = useLab((s) => s.saveExternal);
  const removeExternal = useLab((s) => s.removeExternal);
  const setCredential = useLab((s) => s.setCredential);
  const credentials = useLab((s) => s.credentials);
  const create = useLab((s) => s.create);
  const start = useLab((s) => s.start);

  const [draft, setDraft] = useState<TargetDraft>(() => minimalDraft());
  const [formKey, setFormKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [credential, setCred] = useState("");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [seed, setSeed] = useState(0);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = (d: TargetDraft, id: string | null = null, cred = "") => {
    setDraft(d);
    setEditingId(id);
    setCred(cred);
    setTest({ status: "idle" });
    setNotice(null);
    setFormKey((k) => k + 1);
  };

  // /connect#<target id> opens a saved target for editing
  useEffect(() => {
    const id = window.location.hash.slice(1);
    const t = id ? externals.find((x) => x.id === id) : undefined;
    if (!t || editingId === id) return;
    const timer = setTimeout(
      () =>
        load(
          { name: t.name, description: t.description, connection: t.connection!, features: t.features, output: t.output, defaultBudget: t.defaultBudget, challengeId: t.challengeId },
          t.id,
          credentials[t.id] ?? "",
        ),
      0,
    );
    return () => clearTimeout(timer);
    // only when saved targets first become available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externals]);

  const set = (p: Partial<TargetDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setTest({ status: "idle" });
  };
  const setConn = (p: Partial<Connection>) => set({ connection: { ...draft.connection, ...p } });
  const setFeature = (i: number, f: Feature) => set({ features: draft.features.map((x, j) => (j === i ? f : x)) });

  const allowHttp = useMemo(() => {
    if (typeof window === "undefined") return false;
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  }, []);

  const connProblem = useMemo(() => {
    try {
      validateConnection(draft.connection, { allowHttp });
      return null;
    } catch (e) {
      return e instanceof ContractError ? e.message : String(e);
    }
  }, [draft.connection, allowHttp]);
  const problems = useMemo(() => {
    const p = schemaProblems(draft);
    if (connProblem) p.unshift(connProblem);
    if (draft.connection.authHeader && !credential) p.push(`Enter the credential for the "${draft.connection.authHeader}" header (kept in memory only).`);
    return p;
  }, [draft, connProblem, credential]);

  const featureProblems = useMemo(() => schemaProblems({ ...draft, features: draft.features }).length > 0, [draft]);
  const preview = useMemo(() => {
    if (featureProblems) return null;
    const xs = [sampleInput(draft.features)];
    if (draft.connection.mode === "batch") xs.push(randomInput({ features: draft.features } as TargetSpec, mulberry32(seed + 1)));
    return xs;
  }, [draft.features, draft.connection.mode, featureProblems, seed]);

  const runTest = async () => {
    if (!preview) return;
    const bad = preview.map((x) => inputProblem(draft.features, x)).find(Boolean);
    if (bad) return setTest({ status: "error", code: "bad_inputs", message: bad, requests: 0 });
    setTest({ status: "busy" });
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection: { ...draft.connection, authHeader: draft.connection.authHeader || undefined }, inputs: preview, credential: credential || undefined }),
      });
      const data = (await res.json().catch(() => null)) as { outputs?: number[]; error?: string; code?: string; requests?: number; receipt?: { requests: number; latencyMs: number } } | null;
      if (res.ok && data?.outputs) setTest({ status: "ok", inputs: preview, outputs: data.outputs, requests: data.receipt?.requests ?? 1, latencyMs: data.receipt?.latencyMs ?? 0 });
      else setTest({ status: "error", code: data?.code ?? `http_${res.status}`, message: data?.error ?? `Relay returned HTTP ${res.status}`, requests: data?.requests ?? 0 });
    } catch {
      setTest({ status: "error", code: "network", message: "Could not reach the AUTOPSY relay.", requests: 0 });
    }
  };

  const toSpec = (): TargetSpec => {
    // re-saving an API that is already saved (same name + URL) keeps its id, so it updates in place
    const existing = editingId ? undefined : externals.find((t) => t.name.trim().toLowerCase() === draft.name.trim().toLowerCase() && (t.connection?.url ?? "").trim() === draft.connection.url.trim());
    const id = editingId ?? existing?.id ?? `ext_${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "target"}_${Date.now().toString(36)}${++draftSeq}`;
    const c = draft.connection;
    return {
      id,
      name: draft.name.trim(),
      vendor: "External API",
      version: "",
      domain: "External API",
      endpoint: c.url.trim(),
      description: draft.description.trim(),
      output: { ...draft.output, key: outputKey(c.outputPath) },
      features: draft.features.map((f) =>
        f.kind === "numeric" ? { ...f, key: f.key.trim(), label: f.label.trim() } : { ...f, key: f.key.trim(), label: f.label.trim(), levels: f.levels.map((l) => l.trim()).filter(Boolean) },
      ),
      defaultBudget: draft.defaultBudget,
      stochastic: true,
      origin: "external",
      connection: { url: c.url.trim(), mode: c.mode, outputPath: c.outputPath.trim(), authHeader: c.authHeader?.trim() || undefined, maxBatch: c.mode === "batch" ? c.maxBatch : undefined },
      challengeId: draft.challengeId,
    };
  };

  const save = (investigate: boolean) => {
    if (problems.length) return;
    const spec = toSpec();
    saveExternal(spec);
    if (credential) setCredential(spec.id, credential);
    setEditingId(spec.id);
    if (investigate) {
      const id = create({ target: spec, budget: spec.defaultBudget, pace: "standard" });
      start(id);
      router.push(`/lab/${id}`, { transitionTypes: ["nav-forward"] });
    } else {
      setNotice(`Saved "${spec.name}". It now appears in the Lab next to the built-in targets.`);
    }
  };

  const importJson = () => {
    try {
      const raw = JSON.parse(jsonText) as Partial<TargetDraft> & { inputs?: Feature[] };
      const features = raw.features ?? raw.inputs;
      if (!Array.isArray(features)) throw new Error('Expected a "features" array.');
      const base = minimalDraft();
      load({
        name: raw.name ?? base.name,
        description: raw.description ?? "",
        connection: { ...base.connection, ...(raw.connection ?? {}) },
        features: features.map((f) => (f.kind === "categorical" ? { ...f, description: f.description ?? "", levels: f.levels ?? [] } : { ...f, kind: "numeric", description: f.description ?? "" })) as Feature[],
        output: { ...base.output, ...(raw.output ?? {}) },
        defaultBudget: raw.defaultBudget ?? base.defaultBudget,
      });
      setJsonOpen(false);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const exportJson = JSON.stringify({ name: draft.name, description: draft.description, connection: { ...draft.connection, authHeader: draft.connection.authHeader || undefined }, features: draft.features, output: draft.output, defaultBudget: draft.defaultBudget }, null, 2);

  return (
    <main className="s-page">
      <div className="s-wrap">
        <div className="s-page-head s-rise">
          <div>
            <div className="s-crumbs">
              <Link href="/lab" className="inline-flex items-center gap-1.5">
                <ArrowLeft size={13} /> Lab
              </Link>
              <span>/</span>
              <b>Connect a black box</b>
            </div>
            <h1 className="s-h1">
              Connect a<br />
              <span className="pk">black box.</span>
            </h1>
            <p className="s-lede">
              Point AUTOPSY at any HTTPS scoring API that takes structured numeric or categorical inputs and returns one numeric output: credit limits, prices, premiums, candidate or fraud scores, ranking scores. Text generation, images, stateful systems and classification labels are not supported yet.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:min-w-[260px]">
            <button type="button" className="s-btn s-btn-accent s-btn-sm" onClick={() => load(sampleChallengeDraft(window.location.origin), null, SAMPLE_CHALLENGE_KEY)}>
              <FlaskConical size={13} /> Load sample challenge
            </button>
            <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={() => load(minimalDraft())}>
              Load minimal example
            </button>
            <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={() => setJsonOpen(!jsonOpen)} aria-expanded={jsonOpen}>
              <ClipboardPaste size={13} /> Paste schema JSON
            </button>
            <Link href="/docs#connect" className="text-center text-[12px] text-[var(--s-fg-3)] underline-offset-4 hover:text-white hover:underline">
              Read the API contract →
            </Link>
          </div>
        </div>

        {jsonOpen && (
          <div className="s-card mt-8 p-5">
            <Label>Paste a target definition (name, connection, features, output, defaultBudget)</Label>
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={8} spellCheck={false} className="mt-3 w-full rounded-lg border border-line-2 bg-ink-950 p-3 font-mono text-[12px] text-fg outline-none focus:border-signal/60" placeholder={exportJson} aria-label="Target definition JSON" />
            {jsonError && <p className="mt-2 text-[12px] text-alert">{jsonError}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" className="s-btn s-btn-white s-btn-sm" onClick={importJson}>
                Load definition
              </button>
              <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={() => setJsonText(exportJson)}>
                Copy current form here
              </button>
            </div>
          </div>
        )}

        {draft.challengeId && (
          <div className="mt-8 rounded-2xl border border-[rgb(255_181_94/0.35)] bg-[rgb(255_181_94/0.06)] px-5 py-4 text-[13px] leading-relaxed text-[var(--s-fg-2)]">
            <b className="text-white">Synthetic sample challenge.</b> This service ships with AUTOPSY, so it demonstrates the blind workflow but is not independent validation. Its rules stay on the server; after the investigation you can reveal them and compare. The demo credential is <code className="font-mono">{SAMPLE_CHALLENGE_KEY}</code>.
          </div>
        )}

        <div key={formKey} className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
          <div className="space-y-6">
            <section className="s-card p-5" aria-labelledby="c-ident">
              <h2 id="c-ident" className="label-mono">
                1 · Target
              </h2>
              <label className="mt-4 block text-[13px] text-fg-2">
                Name
                <input className={cn(inputCls, "mt-1.5")} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="mt-3 block text-[13px] text-fg-2">
                Description
                <textarea className={cn(inputCls, "mt-1.5 h-20 py-2")} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
              </label>
            </section>

            <section className="s-card p-5" aria-labelledby="c-endpoint">
              <h2 id="c-endpoint" className="label-mono">
                2 · Endpoint
              </h2>
              <label className="mt-4 block text-[13px] text-fg-2">
                HTTPS endpoint
                <input className={cn(inputCls, "mt-1.5 font-mono")} value={draft.connection.url} onChange={(e) => setConn({ url: e.target.value })} placeholder="https://api.example.com/score" spellCheck={false} />
              </label>
              <div className="mt-3">
                <div className="text-[13px] text-fg-2">Request format</div>
                <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Request format">
                  {(
                    [
                      ["batch", "Batch", "POST { inputs: [ … ] }, answers an array"],
                      ["single", "Single input", "POST { input: { … } }, answers one number"],
                    ] as const
                  ).map(([v, l, d]) => (
                    <button key={v} type="button" role="radio" aria-checked={draft.connection.mode === v} onClick={() => setConn({ mode: v, outputPath: v === "single" ? (draft.connection.outputPath === "outputs" ? "output" : draft.connection.outputPath.replace("[*]", "")) : draft.connection.outputPath === "output" ? "outputs" : draft.connection.outputPath })} className={cn("rounded-lg border px-3 py-2 text-left", draft.connection.mode === v ? "border-signal/60 bg-signal/[0.06]" : "border-line-2 hover:border-line-3")}>
                      <div className="text-[13px] text-fg">{l}</div>
                      <div className="font-mono text-[10.5px] text-fg-3">{d}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-[13px] text-fg-2">
                  Output path
                  <input className={cn(inputCls, "mt-1.5 font-mono")} value={draft.connection.outputPath} onChange={(e) => setConn({ outputPath: e.target.value })} spellCheck={false} placeholder={draft.connection.mode === "batch" ? "outputs  or  data[*].score" : "result.score"} />
                </label>
                {draft.connection.mode === "batch" && (
                  <label className="block text-[13px] text-fg-2">
                    Max inputs per request
                    <NumInput label="Max inputs per request" className="mt-1.5" value={draft.connection.maxBatch ?? MAX_INPUTS_PER_CALL} onChange={(v) => setConn({ maxBatch: Number.isFinite(v) ? v : undefined })} />
                  </label>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-[13px] text-fg-2">
                  Credential header <span className="text-fg-4">(optional)</span>
                  <input className={cn(inputCls, "mt-1.5 font-mono")} value={draft.connection.authHeader ?? ""} onChange={(e) => setConn({ authHeader: e.target.value || undefined })} placeholder="x-api-key" spellCheck={false} />
                </label>
                {draft.connection.authHeader && (
                  <label className="block text-[13px] text-fg-2">
                    Credential value
                    <input type="password" autoComplete="off" className={cn(inputCls, "mt-1.5 font-mono")} value={credential} onChange={(e) => (setCred(e.target.value), setTest({ status: "idle" }))} placeholder="memory only" />
                  </label>
                )}
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-fg-4">Requests are relayed by the AUTOPSY server, so your API needs no CORS setup. The credential is held in this tab&rsquo;s memory and attached as a header by the relay; it is never saved, logged or exported.</p>
            </section>

            <section className="s-card p-5" aria-labelledby="c-output">
              <h2 id="c-output" className="label-mono">
                3 · Output &amp; budget
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="col-span-2 block text-[13px] text-fg-2">
                  Output label
                  <input className={cn(inputCls, "mt-1.5")} value={draft.output.label} onChange={(e) => set({ output: { ...draft.output, label: e.target.value } })} />
                </label>
                <label className="block text-[13px] text-fg-2">
                  Unit
                  <input className={cn(inputCls, "mt-1.5")} value={draft.output.unit} onChange={(e) => set({ output: { ...draft.output, unit: e.target.value } })} placeholder="pts" />
                </label>
                <label className="block text-[13px] text-fg-2">
                  Format
                  <select className={cn(inputCls, "mt-1.5")} value={draft.output.format} onChange={(e) => set({ output: { ...draft.output, format: e.target.value as TargetDraft["output"]["format"] } })}>
                    <option value="number">number</option>
                    <option value="score">score</option>
                    <option value="currency">currency</option>
                  </select>
                </label>
                <label className="block text-[13px] text-fg-2">
                  Display min
                  <NumInput label="Output display minimum" className="mt-1.5" value={draft.output.min} onChange={(v) => set({ output: { ...draft.output, min: v } })} />
                </label>
                <label className="block text-[13px] text-fg-2">
                  Display max
                  <NumInput label="Output display maximum" className="mt-1.5" value={draft.output.max} onChange={(v) => set({ output: { ...draft.output, max: v } })} />
                </label>
                <label className="col-span-2 block text-[13px] text-fg-2">
                  Query budget (inputs evaluated)
                  <NumInput label="Query budget" className="mt-1.5" value={draft.defaultBudget} onChange={(v) => set({ defaultBudget: v })} />
                </label>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="s-card p-5" aria-labelledby="c-fields">
              <div className="flex items-center justify-between">
                <h2 id="c-fields" className="label-mono">
                  4 · Input fields ({draft.features.length})
                </h2>
                <button
                  type="button"
                  className="s-btn s-btn-dark s-btn-sm"
                  disabled={draft.features.length >= 16}
                  onClick={() => set({ features: [...draft.features, { key: `field_${draft.features.length + 1}`, label: `Field ${draft.features.length + 1}`, kind: "numeric", min: 0, max: 100, description: "" }] })}
                >
                  <Plus size={13} /> Add field
                </button>
              </div>
              <div className="mt-4 space-y-2.5">
                {draft.features.map((f, i) => (
                  <div key={`${formKey}-${i}`} className="rounded-xl border border-line bg-ink-950/50 p-3">
                    <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                      <input aria-label={`Field ${i + 1} key`} className={cn(inputCls, "font-mono")} value={f.key} onChange={(e) => setFeature(i, { ...f, key: e.target.value })} placeholder="key" spellCheck={false} />
                      <input aria-label={`Field ${i + 1} label`} className={inputCls} value={f.label} onChange={(e) => setFeature(i, { ...f, label: e.target.value })} placeholder="Label" />
                      <div className="inline-flex rounded-md border border-line bg-ink-950 p-0.5" role="radiogroup" aria-label={`Field ${i + 1} type`}>
                        {(["numeric", "categorical"] as const).map((k) => (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={f.kind === k}
                            onClick={() => setFeature(i, k === "numeric" ? { key: f.key, label: f.label, kind: "numeric", min: 0, max: 100, description: f.description } : { key: f.key, label: f.label, kind: "categorical", levels: ["a", "b"], description: f.description })}
                            className={cn("h-6 rounded px-2 font-mono text-[10px] uppercase", f.kind === k ? "bg-ink-700 text-fg" : "text-fg-3")}
                          >
                            {k === "numeric" ? "num" : "cat"}
                          </button>
                        ))}
                      </div>
                      <button type="button" aria-label={`Remove field ${i + 1}`} className="h-7 rounded-md px-1.5 text-fg-4 hover:text-alert" onClick={() => set({ features: draft.features.filter((_, j) => j !== i) })}>
                        <X size={14} />
                      </button>
                    </div>
                    <div key={f.kind} className="mt-2">
                      {f.kind === "numeric" ? (
                        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                          <NumInput label={`Field ${i + 1} minimum`} value={f.min} onChange={(v) => setFeature(i, { ...f, min: v })} />
                          <NumInput label={`Field ${i + 1} maximum`} value={f.max} onChange={(v) => setFeature(i, { ...f, max: v })} />
                          <label className="flex items-center gap-1.5 text-[12px] text-fg-2">
                            <input type="checkbox" checked={!!f.integer} onChange={(e) => setFeature(i, { ...f, integer: e.target.checked })} /> integer
                          </label>
                        </div>
                      ) : (
                        <LevelsInput label={`Field ${i + 1} options`} levels={f.levels} onChange={(levels) => setFeature(i, { ...f, levels })} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="s-card p-5" aria-labelledby="c-test">
              <div className="flex items-center justify-between gap-3">
                <h2 id="c-test" className="label-mono">
                  5 · Preview &amp; test
                </h2>
                <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={() => setSeed((x) => x + 1)} disabled={!preview || draft.connection.mode !== "batch"} title="Randomize the second sample input">
                  <Shuffle size={12} /> New sample
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-4">Request AUTOPSY will send</div>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-fg-2">{preview ? JSON.stringify(requestBody(draft.connection.mode, draft.connection.mode === "single" ? preview.slice(0, 1) : preview), null, 2) : "Fix the input fields to preview a request."}</pre>
                </div>
                <div>
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-4">Response shape expected</div>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-fg-2">{JSON.stringify(exampleResponse(draft.connection.outputPath, draft.connection.mode, draft.connection.mode === "single" ? [42.5] : [42.5, 17.25]), null, 2)}</pre>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" className="s-btn s-btn-white s-btn-sm" onClick={runTest} disabled={!preview || !!connProblem || test.status === "busy" || (!!draft.connection.authHeader && !credential)}>
                  {test.status === "busy" ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />} Test connection
                </button>
                <span className="text-[12px] text-fg-4">Sends {draft.connection.mode === "batch" ? "2 real inputs in 1 request" : "1 real input"} through the relay.</span>
              </div>
              <div aria-live="polite">
                {test.status === "ok" && (
                  <div className="mt-4 rounded-xl border border-truth/30 bg-truth/[0.05] p-3">
                    <div className="flex items-center gap-2 text-[13px] text-truth">
                      <CheckCircle2 size={14} /> Connected · {test.outputs.length} numeric output{test.outputs.length === 1 ? "" : "s"} validated
                    </div>
                    <div className="mt-2 font-mono text-[12px] text-fg-2">
                      {test.outputs.map((v, i) => (
                        <div key={i}>
                          input {i + 1} → {draft.output.label || "output"} = <b className="text-fg">{v}</b>
                          {draft.output.unit ? ` ${draft.output.unit}` : ""}
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-fg-4">
                      {test.requests} HTTP request{test.requests === 1 ? "" : "s"} · {test.latencyMs}ms
                    </div>
                  </div>
                )}
                {test.status === "error" && (
                  <div className="mt-4 rounded-xl border border-alert/30 bg-alert/[0.05] p-3" role="alert">
                    <div className="flex items-center gap-2 text-[13px] text-alert">
                      <TriangleAlert size={14} /> {test.message}
                    </div>
                    {HINTS[test.code] && <p className="mt-1.5 text-[12px] leading-snug text-fg-2">{HINTS[test.code]}</p>}
                    <div className="mt-1 font-mono text-[10.5px] text-fg-4">
                      code {test.code}
                      {test.requests ? ` · ${test.requests} request${test.requests === 1 ? "" : "s"} reached the target` : ""}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="s-card p-5" aria-labelledby="c-save">
              <h2 id="c-save" className="label-mono">
                6 · Save
              </h2>
              {problems.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {problems.map((p) => (
                    <li key={p} className="flex gap-2 text-[12.5px] text-amber">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {p}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[12.5px] text-fg-2">{test.status === "ok" ? "Definition valid and connection verified." : "Definition valid. Testing the connection first is recommended."}</p>
              )}
              {notice && <p className="mt-3 text-[12.5px] text-truth">{notice}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="s-btn s-btn-accent s-btn-sm" disabled={problems.length > 0} onClick={() => save(true)}>
                  <Play size={12} fill="currentColor" /> Save &amp; investigate
                </button>
                <button type="button" className="s-btn s-btn-dark s-btn-sm" disabled={problems.length > 0} onClick={() => save(false)}>
                  <Save size={13} /> {editingId ? "Save changes" : "Save target"}
                </button>
              </div>
              <p className="mt-3 text-[11.5px] text-fg-4">Target definitions are stored in this browser only (no credentials).</p>
            </section>
          </div>
        </div>

        <section className="mt-16" aria-labelledby="c-saved">
          <h2 id="c-saved" className="label-mono mb-3">
            Your external targets
          </h2>
          {externals.length === 0 ? (
            <p className="text-[13px] text-[var(--s-fg-3)]">None yet. Load the sample challenge above to try the full workflow.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              {externals.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] text-white">{t.name}</span>
                      {t.challengeId && <Chip tone="amber">synthetic challenge</Chip>}
                      {t.connection?.authHeader && <Chip tone={credentials[t.id] ? "truth" : "neutral"}>{credentials[t.id] ? "credential set" : "credential needed"}</Chip>}
                    </div>
                    <div className="truncate font-mono text-[11px] text-fg-4">
                      {t.connection?.mode} · {t.connection?.url} → {t.connection?.outputPath}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="s-btn s-btn-dark s-btn-sm"
                    onClick={() => {
                      window.history.replaceState(null, "", `#${t.id}`);
                      load({ name: t.name, description: t.description, connection: t.connection!, features: t.features, output: t.output, defaultBudget: t.defaultBudget, challengeId: t.challengeId }, t.id, credentials[t.id] ?? "");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <Link href={`/lab?target=${t.id}`} className="s-btn s-btn-dark s-btn-sm">
                    Investigate
                  </Link>
                  {confirmDel === t.id ? (
                    <button type="button" className="s-btn s-btn-sm border border-[rgb(255_122_138/0.45)] text-[var(--s-bad)]" onClick={() => (removeExternal(t.id), setConfirmDel(null), editingId === t.id && load(minimalDraft()))}>
                      Confirm delete
                    </button>
                  ) : (
                    <button type="button" className="s-btn s-btn-dark s-btn-sm" aria-label={`Delete ${t.name}`} onClick={() => setConfirmDel(t.id)}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
