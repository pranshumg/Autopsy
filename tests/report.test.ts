import { describe, expect, it } from "vitest";
import type { TargetAdapter } from "@/lib/adapter";
import { InvestigationEngine } from "@/lib/engine/orchestrator";
import { createInvestigation } from "@/lib/engine/reducer";
import { buildBrief, toJson, toMarkdown } from "@/lib/report";
import type { Input, TargetSpec } from "@/lib/types";

const SECRET = "sk-live-DO-NOT-LEAK";

const spec: TargetSpec = {
  id: "ext_r",
  name: "Partner pricing API",
  vendor: "External API",
  version: "",
  domain: "External API",
  endpoint: "https://pricing.example.com/v1/quote?version=2",
  description: "",
  origin: "external",
  connection: { url: "https://pricing.example.com/v1/quote?version=2", mode: "single", outputPath: "result.price", authHeader: "x-api-key" },
  output: { key: "price", label: "Price", unit: "USD", format: "currency", min: 0, max: 500 },
  features: [
    { key: "age", label: "Customer age", kind: "numeric", min: 18, max: 80, integer: true, description: "" },
    { key: "distance", label: "Distance", kind: "numeric", min: 1, max: 50, description: "" },
    { key: "region", label: "Region", kind: "categorical", levels: ["north", "south"], description: "" },
  ],
  defaultBudget: 400,
  stochastic: true,
};

describe("reports and exports", () => {
  it("summarise evidence, flag sensitive inputs for review and never contain credentials", async () => {
    let seenCredential = "";
    // the credential reaches the adapter only; it is not part of investigation state
    const adapter: TargetAdapter = {
      kind: "external",
      async query(xs: Input[]) {
        seenCredential = SECRET;
        return { outputs: xs.map((x) => 20 + 2 * Number(x.distance) + (x.region === "south" ? 15 : 0)), requests: xs.length, latencyMs: 1, receiptId: "r" };
      },
    };
    const engine = new InvestigationEngine(createInvestigation({ id: "inv_r", target: spec, budget: 400, pace: "instant", seed: 3, now: 0 }), adapter, () => {});
    await engine.run();
    const inv = engine.s;
    expect(seenCredential).toBe(SECRET);

    const brief = buildBrief(inv)!;
    expect(brief.origin).toMatch(/external API/);
    expect(brief.endpoint).toBe("https://pricing.example.com/v1/quote");
    expect(brief.queries.requests).toBe(inv.budget.requests);
    expect(brief.sensitive.map((s) => s.feature)).toEqual(expect.arrayContaining(["Customer age", "Region"]));
    expect(brief.findings.length).toBeGreaterThan(0);

    const md = toMarkdown(inv);
    const json = toJson(inv);
    for (const out of [md, json, JSON.stringify(inv)]) expect(out).not.toContain(SECRET);
    expect(md).toMatch(/not by itself evidence of discrimination/);
    expect(md).toMatch(/not the share of rules recovered/);
    expect(json).toContain("(set; value not exported)");
    expect(json).not.toContain("version=2");
  });
});
