import { describe, expect, it } from "vitest";
import { TargetError, type TargetAdapter } from "@/lib/adapter";
import { InvestigationEngine } from "@/lib/engine/orchestrator";
import { createInvestigation } from "@/lib/engine/reducer";
import type { EngineEvent, Input, TargetSpec } from "@/lib/types";

const spec: TargetSpec = {
  id: "ext_test",
  name: "Fake external",
  vendor: "",
  version: "",
  domain: "",
  endpoint: "",
  description: "",
  origin: "external",
  connection: { url: "https://api.example.com/x", mode: "batch", outputPath: "outputs" },
  output: { key: "y", label: "Score", unit: "pts", format: "score", min: 0, max: 100 },
  features: [
    { key: "a", label: "A", kind: "numeric", min: 0, max: 100, description: "" },
    { key: "b", label: "B", kind: "numeric", min: 0, max: 100, description: "" },
    { key: "c", label: "C", kind: "categorical", levels: ["x", "y"], description: "" },
  ],
  defaultBudget: 400,
  stochastic: false,
};

/** Hidden rule: threshold on a, linear in b, c ignored. Counts requests like a relay with 2 retries per 10 calls. */
function fakeAdapter(opts: { failAfter?: number; delayMs?: number } = {}) {
  const st = { inputs: 0, requests: 0, aborted: false };
  const adapter: TargetAdapter = {
    kind: "external",
    async query(inputs: Input[], signal?: AbortSignal) {
      if (opts.delayMs) {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, opts.delayMs);
          signal?.addEventListener("abort", () => (clearTimeout(t), (st.aborted = true), rej(new TargetError("cancelled", "cancelled", 1))));
        });
      }
      if (opts.failAfter !== undefined && st.inputs >= opts.failAfter) {
        st.requests += 3;
        throw new TargetError("rate_limited", "Target is rate limiting requests", 3);
      }
      const req = 1 + (st.requests % 10 === 9 ? 2 : 0);
      st.requests += req;
      st.inputs += inputs.length;
      return { outputs: inputs.map((x) => (Number(x.a) > 60 ? 30 : 0) + 0.4 * Number(x.b)), requests: req, latencyMs: 1, receiptId: "r" };
    },
  };
  return { adapter, st };
}

function run(adapter: TargetAdapter, budget = 400) {
  const state = createInvestigation({ id: "inv_t", target: spec, budget, pace: "instant", seed: 7, now: 0 });
  const events: EngineEvent[] = [];
  const engine = new InvestigationEngine(state, adapter, (e) => events.push(...e));
  return { engine, events };
}

describe("investigation through a target adapter", () => {
  it("completes, stays within budget and accounts every request", async () => {
    const { adapter, st } = fakeAdapter();
    const { engine, events } = run(adapter);
    await engine.run();
    const s = engine.s;
    expect(s.status).toBe("completed");
    expect(s.budget.used).toBeLessThanOrEqual(s.budget.limit);
    expect(s.budget.used).toBe(st.inputs);
    expect(s.budget.requests).toBe(st.requests);
    const reqEvents = events.filter((e): e is Extract<EngineEvent, { type: "requests" }> => e.type === "requests").reduce((a, e) => a + e.count, 0);
    expect(reqEvents).toBe(st.requests);
    expect(s.report?.rules.length).toBeGreaterThan(0);
  });

  it("scores the sealed test set only with the final model, and never trains on held-out data", async () => {
    const { adapter } = fakeAdapter();
    const { engine, events } = run(adapter);
    await engine.run();
    const s = engine.s;
    const test = s.observations.filter((o) => o.source === "holdout");
    const val = s.observations.filter((o) => o.source === "validation");
    expect(test.length).toBeGreaterThan(0);
    expect(val.length).toBeGreaterThan(0);
    const models = events.filter((e): e is Extract<EngineEvent, { type: "surrogate" }> => e.type === "surrogate").map((e) => e.model);
    expect(models.at(-1)?.evaluatedOn).toBe("test");
    expect(models.slice(0, -1).every((m) => m.evaluatedOn === "validation")).toBe(true);
    expect(models.at(-1)?.fidelity.n).toBe(test.length);
    const training = s.observations.length - test.length - val.length;
    expect(models.at(-1)?.trainedOn).toBe(training);
    const testIds = new Set(test.map((o) => o.id));
    expect(models.slice(0, -1).every((m) => m.residuals.every((r) => !testIds.has(r.obsId)))).toBe(true);
  });

  it("finds the planted threshold and reports the ignored field without claiming zero effect", async () => {
    const { adapter } = fakeAdapter();
    const { engine } = run(adapter, 600);
    await engine.run();
    const rules = engine.s.report!.rules;
    expect(rules.some((r) => r.kind === "threshold" && r.features[0] === "a")).toBe(true);
    const nullRule = rules.find((r) => r.kind === "null" && r.features[0] === "c");
    expect(nullRule?.statement).toMatch(/No detectable effect .* within the tested range and budget/);
  });

  it("cancels promptly and aborts the in-flight request", async () => {
    const { adapter, st } = fakeAdapter({ delayMs: 40 });
    const { engine } = run(adapter);
    const p = engine.run();
    await new Promise((r) => setTimeout(r, 120));
    engine.cancel();
    await p;
    expect(engine.s.status).toBe("cancelled");
    expect(st.aborted).toBe(true);
  });

  it("surfaces a readable error, counts failed requests and keeps a partial report", async () => {
    const { adapter, st } = fakeAdapter({ failAfter: 200 });
    const { engine } = run(adapter);
    await engine.run();
    const s = engine.s;
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/rate limiting/);
    expect(s.budget.requests).toBe(st.requests);
    expect(s.report?.caveats.some((c) => c.startsWith("Partial report"))).toBe(true);
  });
});
