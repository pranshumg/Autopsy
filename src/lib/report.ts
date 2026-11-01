// Audit summary and exports derived from an investigation's recorded evidence.
// Everything here is computed from observations, experiments and the report;
// nothing is invented. Exports never contain credentials (they are not part of
// investigation state) and connection URLs are reduced to their origin + path.

import type { Feature, InvestigationState, Rule } from "@/lib/types";
import { fmtDelta, fmtFeature, fmtOutput, fmtP } from "@/lib/format";

const SENSITIVE: [RegExp, string][] = [
  [/\b(age|dob|birth|grad(uation)?_?year)\b|age$/i, "age or an age proxy"],
  [/gender|\bsex\b/i, "sex/gender"],
  [/race|ethnic/i, "race/ethnicity"],
  [/religio/i, "religion"],
  [/nation|citizen|immigra/i, "national origin"],
  [/disab/i, "disability"],
  [/marital|married/i, "marital status"],
  [/zip|postal|postcode|region|territory|neighbo|district|area/i, "location (possible proxy for protected characteristics)"],
  [/language/i, "language (possible proxy for national origin)"],
  [/poverty|voucher|benefit|income_source|medicaid/i, "economic status or source of income"],
];

/** Why a field may warrant fairness review, or null. Name-based heuristic only. */
export function sensitiveReason(f: Feature): string | null {
  const hay = `${f.key} ${f.label}`;
  for (const [re, why] of SENSITIVE) if (re.test(hay)) return why;
  return null;
}

export type Brief = {
  identity: string;
  origin: string;
  endpoint: string;
  queries: { evaluated: number; limit: number; requests?: number; verification: number };
  findings: {
    rule: Rule;
    effect?: string;
    ci?: string;
    test?: string;
    range: string;
    support: number;
    confirmed: boolean;
    retests: { id: string; summary: string }[];
  }[];
  nulls: Rule[];
  inconclusive: { id: string; statement: string; note: string }[];
  heldOut?: { r2: number; mae: number; rmse: number; n: number; set: string };
  sensitive: { feature: string; why: string; finding?: string }[];
  limitations: string[];
  followUps: string[];
};

function endpointLabel(inv: InvestigationState): string {
  const t = inv.target;
  if (t.origin !== "external" || !t.connection) return `${t.endpoint} (built-in)`;
  try {
    const u = new URL(t.connection.url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "external endpoint";
  }
}

/** Observed min-max of a field across the engine's own (non-held-out) queries. */
function testedRange(inv: InvestigationState, key: string): string {
  const f = inv.target.features.find((x) => x.key === key);
  if (!f) return "";
  const vals = inv.observations.filter((o) => o.source !== "holdout" && o.source !== "validation").map((o) => o.input[key]);
  if (!vals.length) return "not tested";
  if (f.kind === "categorical") return [...new Set(vals.map(String))].join(", ");
  const nums = vals.map(Number);
  return `${fmtFeature(f, Math.min(...nums))} – ${fmtFeature(f, Math.max(...nums))}`;
}

export function buildBrief(inv: InvestigationState): Brief | null {
  const r = inv.report;
  if (!r) return null;
  const t = inv.target;
  const o = t.output;
  const main = r.rules.filter((x) => x.kind !== "null").sort((a, b) => (b.strength === "strong" ? 1 : 0) - (a.strength === "strong" ? 1 : 0) || b.confidence - a.confidence);
  const retestsFor = (id: string) => inv.experiments.filter((e) => e.kind === "verification" && e.ruleId === id).map((e) => ({ id: e.id, summary: e.result?.summary ?? "" }));
  const findings = main.map((rule) => ({
    rule,
    effect: rule.estimate !== undefined ? fmtDelta(o, rule.estimate) : rule.effect || undefined,
    ci: rule.ci ? `[${fmtDelta(o, rule.ci[0])}, ${fmtDelta(o, rule.ci[1])}]` : undefined,
    test: rule.test ? `${rule.test.name}${rule.test.name.includes("BIC") ? "" : `, ${fmtP(rule.test.p)}`}, n = ${rule.test.n}` : undefined,
    range: rule.features.map((k) => `${t.features.find((f) => f.key === k)?.label ?? k}: ${testedRange(inv, k)}`).join("; "),
    support: rule.support,
    confirmed: !!rule.confirmed,
    retests: retestsFor(rule.id),
  }));
  const nulls = r.rules.filter((x) => x.kind === "null");
  const inconclusive = inv.hypotheses.filter((h) => h.status === "inconclusive").map((h) => ({ id: h.id, statement: h.statement, note: h.history.at(-1)?.note ?? "" }));
  const fid = inv.surrogate?.fidelity;
  const heldOut = fid ? { ...fid, set: inv.surrogate?.evaluatedOn === "validation" ? "validation set (final test not reached)" : "sealed test set, scored once" } : undefined;

  const sensitive: Brief["sensitive"] = [];
  for (const f of t.features) {
    const why = sensitiveReason(f);
    if (!why) continue;
    const hit = main.find((x) => x.features.includes(f.key));
    const nul = nulls.find((x) => x.features.includes(f.key));
    sensitive.push({ feature: f.label, why, finding: hit ? `${hit.id}: output is sensitive to this input` : nul ? `${nul.id}: no detectable effect within the tested range and budget` : "no finding" });
  }

  const followUps: string[] = [];
  const unconfirmed = findings.filter((f) => !f.confirmed && !f.retests.length);
  if (unconfirmed.length) followUps.push(`Re-test ${unconfirmed.map((f) => f.rule.id).join(", ")} on fresh queries with "Test this finding"; they were not confirmed on fresh subjects.`);
  for (const s of sensitive.filter((x) => x.finding?.includes("sensitive"))) {
    followUps.push(`Review whether ${s.feature} (${s.why}) is a legitimate factor. Sensitivity alone does not establish unfair or unlawful treatment; consult domain and legal experts.`);
  }
  if (inconclusive.length) followUps.push(`Resolve ${inconclusive.length} inconclusive hypothes${inconclusive.length === 1 ? "is" : "es"} with a larger budget.`);
  if (fid && fid.r2 < 0.85) followUps.push(`Held-out fit is moderate (R² ${fid.r2.toFixed(2)}): probe interactions or raise the budget to explain more of the output.`);
  if (t.origin === "external") followUps.push("Repeat the investigation later to check that the API's behaviour is stable over time.");
  if (!followUps.length) followUps.push("Re-run with a different seed or budget to check that the findings replicate.");

  const verification = inv.observations.filter((x) => x.source === "verify" || x.source === "manual").length;
  return {
    identity: `${t.name}${t.version ? ` ${t.version}` : ""}`,
    origin: inv.saved ? `saved recording (${new Date(inv.saved.recordedAt).toISOString().slice(0, 10)}), not a live run` : t.origin === "external" ? "external API (independently hosted)" : "built-in synthetic target (demonstration, not real-world validation)",
    endpoint: endpointLabel(inv),
    queries: { evaluated: inv.budget.used, limit: inv.budget.limit, requests: inv.budget.requests, verification },
    findings,
    nulls,
    inconclusive,
    heldOut,
    sensitive,
    limitations: r.caveats,
    followUps,
  };
}

export function toMarkdown(inv: InvestigationState): string {
  const r = inv.report!;
  const b = buildBrief(inv)!;
  const o = inv.target.output;
  const lines = [
    `# AUTOPSY audit report — ${b.identity}`,
    "",
    `- **Target:** ${b.identity} · ${b.origin}`,
    `- **Endpoint:** ${b.endpoint}`,
    `- **Investigation:** \`${inv.id}\` · generated ${new Date(r.generatedAt).toISOString()}`,
    `- **Queries:** ${b.queries.evaluated} of ${b.queries.limit} inputs evaluated${b.queries.requests !== undefined ? ` · ${b.queries.requests} HTTP requests incl. retries` : ""}${b.queries.verification ? ` · ${b.queries.verification} analyst/verification queries` : ""}`,
    b.heldOut ? `- **Held-out predictive fit:** R² ${b.heldOut.r2.toFixed(3)}, MAE ${fmtOutput(o, b.heldOut.mae)}, RMSE ${fmtOutput(o, b.heldOut.rmse)} on ${b.heldOut.n} queries (${b.heldOut.set}). R² describes prediction of new responses, not the share of rules recovered.` : "- **Held-out predictive fit:** not available",
    "",
    r.summary,
    "",
    "## Main supported findings",
    "",
    "Findings are supported behavioral patterns observed through controlled queries, not a recovery of source code. The evidence score is a heuristic, not a calibrated probability.",
    "",
    ...b.findings.flatMap((f) => [
      `### ${f.rule.id}. ${f.rule.title} — ${f.rule.strength} evidence, evidence score ${(f.rule.confidence * 100).toFixed(0)}/100`,
      "",
      f.rule.statement,
      "",
      `- Effect: ${f.effect ?? f.rule.effect}${f.ci ? ` (95% CI ${f.ci})` : ""}`,
      ...(f.test ? [`- Test: ${f.test}`] : []),
      `- Tested range: ${f.range}`,
      `- Evidence: ${f.rule.experimentIds.join(", ")} (${f.support} observations)`,
      `- Confirmed on fresh subjects: ${f.confirmed ? "yes" : "no"}`,
      ...f.retests.map((x) => `- Analyst re-test ${x.id}: ${x.summary}`),
      ...(f.rule.alternatives.length ? [`- Rejected alternatives: ${f.rule.alternatives.join(", ")}`] : []),
      "",
    ]),
    "## No detectable effect (within the tested range and budget)",
    "",
    ...(b.nulls.length ? b.nulls.map((x) => `- ${x.id}. ${x.statement}`) : ["- none"]),
    "",
    "## Inconclusive",
    "",
    ...(b.inconclusive.length ? b.inconclusive.map((x) => `- ${x.id}. ${x.statement}${x.note ? ` — ${x.note}` : ""}`) : ["- none"]),
    "",
    "## Inputs flagged for review",
    "",
    "Flagged by field name only. Sensitivity to an input is an observed behavior, not by itself evidence of discrimination or a legal violation.",
    "",
    ...(b.sensitive.length ? b.sensitive.map((s) => `- ${s.feature} — ${s.why}; ${s.finding}`) : ["- none"]),
    "",
    "## Limitations",
    "",
    ...b.limitations.map((c) => `- ${c}`),
    "",
    "## Suggested follow-up",
    "",
    ...b.followUps.map((c) => `- ${c}`),
    "",
  ];
  if (inv.groundTruth) {
    lines.push("## Comparison with revealed ground truth", "", `Source: ${inv.groundTruth.source}. Verdicts are the operator's judgement.`, "");
    for (const g of inv.groundTruth.rules) lines.push(`- [${g.verdict ?? "unscored"}] ${g.text}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Machine-readable export. Contains no credentials; the connection keeps only non-secret settings. */
export function toJson(inv: InvestigationState): string {
  const t = inv.target;
  const target = {
    id: t.id,
    name: t.name,
    version: t.version,
    origin: t.origin ?? "builtin",
    endpoint: buildBrief(inv)?.endpoint,
    connection: t.connection ? { mode: t.connection.mode, outputPath: t.connection.outputPath, credentialHeader: t.connection.authHeader ? "(set; value not exported)" : undefined } : undefined,
    features: t.features,
    output: t.output,
  };
  return JSON.stringify(
    {
      generator: "AUTOPSY",
      investigation: inv.id,
      saved: inv.saved,
      target,
      budget: inv.budget,
      summary: buildBrief(inv),
      report: inv.report,
      hypotheses: inv.hypotheses,
      verifications: inv.experiments.filter((e) => e.kind === "verification").map((e) => ({ id: e.id, ruleId: e.ruleId, ...e.verification })),
      surrogate: inv.surrogate ? { fidelity: inv.surrogate.fidelity, evaluatedOn: inv.surrogate.evaluatedOn, trainedOn: inv.surrogate.trainedOn, leaves: inv.surrogate.leaves } : undefined,
      groundTruth: inv.groundTruth,
    },
    null,
    2,
  );
}
