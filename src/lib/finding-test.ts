// Builds the default controlled comparison used to re-test a finding against
// the live target: one base subject, one field changed. Pure functions.

import type { Feature, Input, InvestigationState, NumericFeature, Rule } from "@/lib/types";
import { sampleInput } from "@/lib/connection";
import { valueAt } from "@/lib/engine/design";
import { fmtFeature } from "@/lib/format";

export type Comparison = { baseline: Input; variant: Input; changed: string[]; rationale: string; subject: string };

function clampNum(f: NumericFeature, v: number): number {
  const c = Math.min(f.max, Math.max(f.min, v));
  return f.integer ? Math.round(c) : Math.round(c * 1e4) / 1e4;
}

/** Fields whose values differ between two inputs. */
export function changedFields(features: Feature[], a: Input, b: Input): string[] {
  return features.filter((f) => a[f.key] !== b[f.key]).map((f) => f.key);
}

/** A realistic starting subject: an input the engine itself queried for this finding. */
function baseSubject(inv: InvestigationState, rule: Rule): { x: Input; label: string } {
  const byId = new Map(inv.observations.map((o) => [o.id, o]));
  for (const id of rule.experimentIds) {
    const e = inv.experiments.find((x) => x.id === id);
    const pair = e?.pairs?.[0];
    const o = pair ? byId.get(pair.a) : e?.observationIds.length ? byId.get(e.observationIds[0]) : undefined;
    if (o) return { x: { ...o.input }, label: `subject from ${e!.id}${o.personaId ? ` (${o.personaId})` : ""}` };
  }
  const o = inv.observations.find((x) => x.source === "baseline");
  if (o) return { x: { ...o.input }, label: `baseline subject${o.personaId ? ` ${o.personaId}` : ""}` };
  return { x: sampleInput(inv.target.features), label: "schema midpoint" };
}

function refLevel(statement: string, levels: string[], level?: string): string {
  const m = statement.match(/vs ([\w ]+?)\s*$/);
  const want = m?.[1].trim().replace(/ /g, "_");
  if (want && levels.includes(want) && want !== level) return want;
  return levels.find((l) => l !== level) ?? levels[0];
}

export function defaultComparison(inv: InvestigationState, rule: Rule): Comparison {
  const spec = inv.target;
  const h = inv.hypotheses.find((x) => x.id === rule.hypothesisIds[0]);
  const f = spec.features.find((x) => x.key === rule.features[0]);
  const { x, label } = baseSubject(inv, rule);
  const baseline = { ...x };
  const variant = { ...x };
  let rationale = "";
  if (!f) return { baseline, variant, changed: [], rationale: "This finding has no single input to vary.", subject: label };

  if (f.kind === "numeric") {
    const range = f.max - f.min;
    const gap = Math.max(f.integer ? 1 : range * 0.01, range * 0.08);
    if (rule.kind === "threshold" && h?.threshold) {
      const th = h.threshold;
      if (th.direction === "window") {
        const lo = th.lo;
        const hi = th.end ?? th.hi;
        const inside = clampNum(f, (lo + hi) / 2);
        const outside = lo - f.min > f.max - hi ? clampNum(f, lo - gap) : clampNum(f, hi + gap);
        baseline[f.key] = outside;
        variant[f.key] = inside;
        rationale = `Moves ${f.label} from outside the detected window (${fmtFeature(f, outside)}) to inside it (${fmtFeature(f, inside)}).`;
      } else {
        const below = clampNum(f, th.value - gap);
        const above = clampNum(f, th.value + gap);
        baseline[f.key] = below;
        variant[f.key] = above;
        rationale = `Crosses the detected threshold near ${fmtFeature(f, th.value)}: ${fmtFeature(f, below)} → ${fmtFeature(f, above)}.`;
      }
    } else if (rule.kind === "null") {
      baseline[f.key] = clampNum(f, valueAt(f, 0.05));
      variant[f.key] = clampNum(f, valueAt(f, 0.95));
      rationale = `Sweeps ${f.label} across most of its documented range; a supported null finding predicts little or no change.`;
    } else {
      baseline[f.key] = clampNum(f, valueAt(f, 0.2));
      variant[f.key] = clampNum(f, valueAt(f, 0.8));
      rationale = `Moves ${f.label} from its 20th to its 80th percentile position, the contrast the engine used to estimate the effect.`;
    }
  } else {
    if (rule.kind === "null") {
      baseline[f.key] = f.levels[0];
      variant[f.key] = f.levels[f.levels.length - 1];
      rationale = `Switches ${f.label} between two options; a supported null finding predicts little or no change.`;
    } else {
      const level = h?.level ?? f.levels[1];
      baseline[f.key] = refLevel(h?.statement ?? rule.statement, f.levels, level);
      variant[f.key] = level;
      rationale = `Switches ${f.label} from "${baseline[f.key]}" to "${level}".`;
    }
  }
  if (rule.kind === "interaction" && rule.features[1]) {
    const g = spec.features.find((x) => x.key === rule.features[1]);
    rationale += ` This finding is an interaction: the effect depends on ${g?.label ?? rule.features[1]}. Re-run with that field set differently to see the dependence.`;
  }
  return { baseline, variant, changed: changedFields(spec.features, baseline, variant), rationale, subject: label };
}

/** Plain-language caveats about a proposed comparison. */
export function comparisonWarnings(features: Feature[], c: { baseline: Input; variant: Input }, opts: { editedBaseline: boolean }): string[] {
  const out: string[] = [];
  const changed = changedFields(features, c.baseline, c.variant);
  if (changed.length === 0) out.push("Baseline and variant are identical, so any difference is noise.");
  if (changed.length > 1) out.push(`${changed.length} fields differ. The measured difference cannot be attributed to any single one of them.`);
  for (const k of changed) {
    const f = features.find((x) => x.key === k);
    if (f?.kind !== "numeric") continue;
    for (const v of [c.baseline[k], c.variant[k]]) {
      if (v === f.min || v === f.max) {
        out.push(`${f.label} is tested at the edge of its documented range (${fmtFeature(f, v)}); behaviour there may not be typical.`);
        break;
      }
    }
  }
  if (opts.editedBaseline) out.push("The base subject was edited. AUTOPSY only checks the schema, not real-world plausibility, so the profile may combine values that rarely occur together.");
  return out;
}
