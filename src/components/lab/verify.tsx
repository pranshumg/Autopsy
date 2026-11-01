"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useMemo, useState } from "react";
import { create } from "zustand";
import { FlaskConical, Info, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";
import type { Experiment, Feature, Input, InvestigationState, Rule, Verification } from "@/lib/types";
import { analystAllowance, useLab } from "@/lib/store";
import { CredentialField, useCredentialPrompt } from "@/components/target-bits";
import { comparisonWarnings, changedFields, defaultComparison } from "@/lib/finding-test";
import { compareArms } from "@/lib/verify-stats";
import { cn, fmtDelta, fmtFeature, fmtOutput, fmtP } from "@/lib/format";
import { Button, Chip, Label, Segmented } from "@/components/ui";

/** Which finding's verification panel is open (one per page). */
export const useVerify = create<{ ruleId: string | null; open: (ruleId: string) => void; close: () => void }>((set) => ({
  ruleId: null,
  open: (ruleId) => set({ ruleId }),
  close: () => set({ ruleId: null }),
}));

/** Verifications already run for a rule, newest first. */
export function verificationsFor(inv: InvestigationState, ruleId: string): Experiment[] {
  return inv.experiments.filter((e) => e.kind === "verification" && e.ruleId === ruleId && e.verification).reverse();
}

export function TestFindingButton({ inv, rule, size = "sm" }: { inv: InvestigationState; rule: Rule; size?: "xs" | "sm" }) {
  const open = useVerify((s) => s.open);
  const n = verificationsFor(inv, rule.id).length;
  return (
    <Button variant="signal" size={size} onClick={() => open(rule.id)} aria-haspopup="dialog" disabled={!!inv.saved} title={inv.saved ? "Saved recordings cannot query the target" : undefined}>
      <FlaskConical size={12} /> Test this finding{n ? ` · ${n} run${n === 1 ? "" : "s"}` : ""}
    </Button>
  );
}

export function FindingTestHost({ inv }: { inv: InvestigationState }) {
  const ruleId = useVerify((s) => s.ruleId);
  const close = useVerify((s) => s.close);
  const rule = inv.report?.rules.find((r) => r.id === ruleId);
  return (
    <Dialog.Root open={!!rule} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex max-h-[92dvh] w-[min(980px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-2 bg-ink-900 shadow-2xl focus:outline-none">
          {rule && <Panel key={rule.id} inv={inv} rule={rule} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ValueControl({ f, value, onChange, label, highlight }: { f: Feature; value: Input[string]; onChange: (v: Input[string]) => void; label: string; highlight: boolean }) {
  const cls = cn("h-8 w-full rounded-md border bg-ink-950 px-2 font-mono text-[12px] text-fg outline-none focus:border-signal/60", highlight ? "border-amber/60 bg-amber/[0.06]" : "border-line-2");
  if (f.kind === "categorical")
    return (
      <select aria-label={label} className={cls} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {f.levels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    );
  return (
    <NumField f={f} value={Number(value)} onChange={onChange} label={label} className={cls} />
  );
}

function NumField({ f, value, onChange, label, className }: { f: Extract<Feature, { kind: "numeric" }>; value: number; onChange: (v: number) => void; label: string; className: string }) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(String(value));
  }
  const commit = () => {
    let v = Number(text);
    if (!Number.isFinite(v)) v = value;
    v = Math.min(f.max, Math.max(f.min, f.integer ? Math.round(v) : v));
    setText(String(v));
    onChange(v);
  };
  return (
    <input
      aria-label={`${label} (${fmtFeature(f, f.min)} to ${fmtFeature(f, f.max)})`}
      inputMode="decimal"
      className={className}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function Panel({ inv, rule }: { inv: InvestigationState; rule: Rule }) {
  const spec = inv.target;
  const o = spec.output;
  const manualQuery = useLab((s) => s.manualQuery);
  const { show: askKey, missing: missingKey } = useCredentialPrompt(inv.target);
  const initial = useMemo(() => defaultComparison(inv, rule), [inv, rule]);
  const [baseline, setBaseline] = useState<Input>(initial.baseline);
  const [variant, setVariant] = useState<Input>(initial.variant);
  const [reps, setReps] = useState<"3" | "5" | "10">("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);

  const editedBaseline = spec.features.some((f) => baseline[f.key] !== initial.baseline[f.key]);
  const changed = changedFields(spec.features, baseline, variant);
  const warnings = comparisonWarnings(spec.features, { baseline, variant }, { editedBaseline });
  const n = Number(reps);
  const cost = 2 * n;
  const allowance = analystAllowance(inv);
  const running = inv.status === "running" || inv.status === "paused";
  const history = verificationsFor(inv, rule.id);
  const shown = (lastId ? history.find((e) => e.id === lastId) : undefined) ?? history[0];

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      // interleave arms so drift over time affects both equally
      const inputs = Array.from({ length: n }, () => [baseline, variant]).flat();
      const obs = await manualQuery(inv.id, inputs, {
        title: `Test of ${rule.id} · ${changed.map((k) => spec.features.find((f) => f.key === k)?.label ?? k).join(", ") || "no change"}`,
        design: `${n} baseline vs ${n} variant queries, interleaved. ${initial.rationale}`,
        features: changed,
        source: "verify",
        ruleId: rule.id,
        finalize: (outs) => {
          const b = outs.filter((_, i) => i % 2 === 0);
          const v = outs.filter((_, i) => i % 2 === 1);
          const r = compareArms(b, v, inv.seed ^ outs.length);
          const verification: Verification = {
            baseline,
            variant,
            changed,
            reps: n,
            baselineOutputs: b,
            variantOutputs: v,
            meanDiff: r.meanDiff,
            ci: r.ci,
            p: r.p,
            method: r.method,
            warnings,
          };
          return {
            verification,
            result: { summary: `Δ ${fmtDelta(o, r.meanDiff)} [${fmtDelta(o, r.ci[0])}, ${fmtDelta(o, r.ci[1])}] · ${fmtP(r.p)} · n = ${n}+${n}`, effect: r.meanDiff, ci: r.ci, p: r.p, n: 2 * n },
          };
        },
      });
      setLastId(obs[0]?.experimentId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setBaseline(initial.baseline);
    setVariant(initial.variant);
  };

  return (
    <>
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="label-mono text-signal">test this finding · {rule.id}</div>
          <Dialog.Title className="mt-1 text-lg font-semibold leading-snug text-fg">{rule.statement}</Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
            Send fresh, repeated queries to the {spec.origin === "external" ? "external API" : "built-in target"} with one field changed, and compare the outputs. Base: {initial.subject}.
          </Dialog.Description>
        </div>
        <Dialog.Close className="rounded-md p-1.5 text-fg-3 hover:bg-white/5 hover:text-fg" aria-label="Close">
          <X size={16} />
        </Dialog.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <div className="flex items-center justify-between">
              <Label>Controlled comparison</Label>
              <button type="button" onClick={reset} className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-fg-3 hover:text-fg">
                <RotateCcw size={10} /> reset
              </button>
            </div>
            <p className="mt-1 text-[12px] text-fg-3">{initial.rationale}</p>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-wider text-fg-4">
                  <th className="pb-1.5 font-normal">Field</th>
                  <th className="pb-1.5 font-normal">Baseline</th>
                  <th className="pb-1.5 font-normal">Variant</th>
                </tr>
              </thead>
              <tbody>
                {spec.features.map((f) => {
                  const diff = changed.includes(f.key);
                  return (
                    <tr key={f.key} className={cn("border-t border-line", diff && "bg-amber/[0.04]")}>
                      <td className="py-1.5 pr-2 align-middle text-[12.5px]">
                        <span className={diff ? "text-amber" : "text-fg-2"}>{f.label}</span>
                        {diff && <span className="sr-only"> (changed)</span>}
                      </td>
                      <td className="w-[34%] py-1.5 pr-2">
                        <ValueControl f={f} value={baseline[f.key]} label={`${f.label} baseline`} highlight={diff} onChange={(v) => setBaseline({ ...baseline, [f.key]: v })} />
                      </td>
                      <td className="w-[34%] py-1.5">
                        <ValueControl f={f} value={variant[f.key]} label={`${f.label} variant`} highlight={diff} onChange={(v) => setVariant({ ...variant, [f.key]: v })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-ink-950/60 p-3">
              <Label>Repeats per arm</Label>
              <div className="mt-2 flex items-center gap-3">
                <Segmented<"3" | "5" | "10">
                  label="Repeats per arm"
                  value={reps}
                  onChange={setReps}
                  options={[
                    { value: "3", label: "3" },
                    { value: "5", label: "5" },
                    { value: "10", label: "10" },
                  ]}
                />
                <span className="font-mono text-[11px] text-fg-2">
                  costs {cost} queries · {allowance} available
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-fg-4">
                Verification queries are real requests, counted in the investigation budget and shown as experiments.
                {running ? " While agents run, only the 4% analyst reserve is available." : ""}
              </p>
              {cost > allowance && (
                <p className="mt-2 flex gap-1.5 text-[12px] text-amber" role="alert">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                  {allowance === 0 ? "No budget left for verification." : `Only ${allowance} queries left. Choose fewer repeats.`}
                </p>
              )}
              {askKey && (
                <div className="mt-3">
                  <CredentialField target={inv.target} compact />
                </div>
              )}
              <Button variant="primary" size="md" className="mt-3 w-full" onClick={run} disabled={busy || cost > allowance || changed.length === 0 || !!inv.saved || missingKey}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Query the target · {cost} fresh queries
              </Button>
              {error && (
                <p className="mt-2 text-[12px] text-alert" role="alert">
                  {error}
                </p>
              )}
            </div>

            {warnings.length > 0 && (
              <ul className="space-y-1.5">
                {warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-[12px] leading-snug text-amber">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            )}

            <div aria-live="polite">{shown?.verification && <Result inv={inv} rule={rule} exp={shown} />}</div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
          <div>
            <Label>Original supporting experiments</Label>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {rule.experimentIds.map((id) => (
                <li key={id}>
                  <Link href={`/lab/${inv.id}/experiments?e=${id}`} className="inline-flex rounded border border-line-2 px-1.5 py-0.5 font-mono text-[11px] text-signal hover:border-signal/50">
                    {id}
                  </Link>
                </li>
              ))}
            </ul>
            {rule.estimate !== undefined && rule.ci && (
              <p className="mt-2 font-mono text-[11px] text-fg-3">
                Original estimate {fmtDelta(o, rule.estimate)} [{fmtDelta(o, rule.ci[0])}, {fmtDelta(o, rule.ci[1])}]
                {rule.test ? ` · ${rule.test.name} · n = ${rule.test.n}` : ""}
              </p>
            )}
            {history.length > 1 && (
              <div className="mt-3">
                <Label>Earlier re-tests</Label>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-fg-3">
                  {history.map((e) => (
                    <li key={e.id}>
                      <button type="button" className={cn("hover:text-fg", shown?.id === e.id && "text-fg")} onClick={() => setLastId(e.id)}>
                        {e.id} · {e.result?.summary}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex gap-2 rounded-lg border border-line bg-ink-950/60 p-3 text-[12px] leading-relaxed text-fg-3">
            <Info size={13} className="mt-0.5 shrink-0 text-fg-4" />
            <span>
              This measures how the target&rsquo;s output responds when this input changes and the others are held fixed. Observed sensitivity to an input is not by itself evidence of unfairness or unlawful discrimination; that judgement depends on context, legitimate justification, causal pathways and law.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function Result({ inv, rule, exp }: { inv: InvestigationState; rule: Rule; exp: Experiment }) {
  const v = exp.verification!;
  const o = inv.target.output;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const excludesZero = v.ci[0] > 0 || v.ci[1] < 0;
  const isNull = rule.kind === "null";
  const agrees =
    rule.estimate !== undefined && rule.ci && !isNull
      ? Math.sign(v.meanDiff) === Math.sign(rule.estimate) && excludesZero
      : undefined;
  const verdict = isNull
    ? excludesZero
      ? { tone: "amber" as const, text: "A difference was detected; this re-test does not agree with the null finding." }
      : { tone: "truth" as const, text: "No difference detected in this re-test, consistent with the null finding (not proof of zero effect)." }
    : agrees
      ? { tone: "truth" as const, text: "Same direction as the original finding, interval excludes zero." }
      : excludesZero
        ? { tone: "amber" as const, text: "A difference was detected, but in the opposite direction to the original estimate." }
        : { tone: "amber" as const, text: "This re-test did not detect a difference. Try more repeats or check the comparison." };
  return (
    <div className="rounded-lg border border-line-2 p-3">
      <div className="flex items-center gap-2">
        <Label>Result · {exp.id}</Label>
        <Chip tone={verdict.tone}>{verdict.tone === "truth" ? "consistent" : "check"}</Chip>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11.5px]">
        <div className="rounded border border-line bg-ink-950/60 p-2">
          <div className="text-fg-4">baseline mean</div>
          <div className="text-[15px] text-fg">{fmtOutput(o, mean(v.baselineOutputs), false)}</div>
          <div className="text-fg-4">n = {v.baselineOutputs.length}</div>
        </div>
        <div className="rounded border border-line bg-ink-950/60 p-2">
          <div className="text-fg-4">variant mean</div>
          <div className="text-[15px] text-fg">{fmtOutput(o, mean(v.variantOutputs), false)}</div>
          <div className="text-fg-4">n = {v.variantOutputs.length}</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="font-mono text-[11px] text-fg-4">mean difference (variant − baseline)</div>
        <div className="font-mono text-2xl text-fg">{fmtDelta(o, v.meanDiff)}</div>
        <div className="font-mono text-[11px] text-fg-3">
          95% CI [{fmtDelta(o, v.ci[0])}, {fmtDelta(o, v.ci[1])}] · {fmtP(v.p)}
        </div>
      </div>
      <p className="mt-2 text-[12px] text-fg-2">{verdict.text}</p>
      <p className="mt-1 text-[11px] leading-snug text-fg-4">{v.method}</p>
      <details className="mt-2 text-[11px] text-fg-4">
        <summary className="cursor-pointer hover:text-fg-2">Raw outputs</summary>
        <div className="mt-1 font-mono">baseline: {v.baselineOutputs.map((x) => fmtOutput(o, x, false)).join(", ")}</div>
        <div className="font-mono">variant: {v.variantOutputs.map((x) => fmtOutput(o, x, false)).join(", ")}</div>
      </details>
    </div>
  );
}
