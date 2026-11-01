"use client";

import { scaleLinear } from "d3-scale";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { ArrowLeft, ChevronDown, Download, FileJson, Info, Loader2, ShieldAlert } from "lucide-react";
import type { InvestigationState, Rule } from "@/lib/types";
import { cn, fmtDelta, fmtOutput, fmtP, labelOf } from "@/lib/format";
import { buildBrief, toJson, toMarkdown } from "@/lib/report";
import { H_KIND, H_STATUS } from "@/components/meta";
import { Button, ButtonLink, Chip, Label, Meter, Ring, Ticker, Tip, toneVar } from "@/components/ui";
import { OriginChip } from "@/components/target-bits";
import { TestFindingButton } from "./verify";
import { GroundTruthPanel } from "./ground-truth";
import { AxisLabel, Chart, useObsMap } from "@/components/viz/core";
import { ExperimentViz } from "@/components/viz/experiment";
import { FidelityScatter } from "@/components/viz/model";
import { DecisionTree } from "@/components/viz/tree";

const STRENGTH_TONE = { strong: "truth", moderate: "model", weak: "amber" } as const;

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportMarkdown(inv: InvestigationState) {
  download(`autopsy-${inv.target.id}-${inv.id.slice(-6)}.md`, toMarkdown(inv), "text/markdown");
}

/** Rule the guided demo wants expanded and scrolled into view. */
export const useFocusRule = create<{ id: string | null; focus: (id: string | null) => void }>((set) => ({ id: null, focus: (id) => set({ id }) }));

export const EVIDENCE_SCORE_HELP =
  "Evidence score (0-100) is a heuristic that combines the test's p-value, the width of the effect interval and whether the finding was confirmed on fresh subjects. It is not a calibrated probability that the rule is correct.";

export function Rulebook({ inv }: { inv: InvestigationState }) {
  const r = inv.report;
  if (!r) return <Pending inv={inv} />;
  const o = inv.target.output;
  const nulls = r.rules.filter((x) => x.kind === "null").length;
  const rejected = inv.hypotheses.filter((h) => h.status === "rejected").length;
  return (
    <div className="h-full overflow-y-auto">
      <div className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-truth/[0.05] blur-3xl" />
        <div className="relative mx-auto max-w-[1180px] px-5 pb-10 pt-10 sm:px-8">
          <div className="label-mono flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-truth">[ 07 ] hidden rulebook</span>
            <OriginChip target={inv.target} inv={inv} />
            <span>investigation {inv.id.slice(-6)}</span>
            <span>published {new Date(r.generatedAt).toLocaleString()}</span>
          </div>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
            {inv.target.name}
            {inv.target.version ? <span className="font-serif font-normal italic text-fg-2"> {inv.target.version},</span> : ","}
            <br />
            <span className="font-serif font-normal italic text-truth">audited from the outside.</span>
          </h1>
          <p className="mt-6 max-w-3xl text-[15.5px] leading-relaxed text-fg-2">{r.summary}</p>
          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5">
            {[
              { k: "Supported patterns", v: <Ticker value={r.rules.length - nulls} />, tone: "text-truth" },
              { k: "No detectable effect", v: <Ticker value={nulls} />, tone: "text-fg" },
              { k: "Rejected explanations", v: <Ticker value={rejected} />, tone: "text-alert" },
              { k: "Held-out R²", v: inv.surrogate ? <Ticker value={inv.surrogate.fidelity.r2} format={(v) => v.toFixed(3)} /> : "—", tone: "text-model" },
              { k: "Noise σ", v: fmtOutput(o, r.noiseSd), tone: "text-fg" },
            ].map((s) => (
              <div key={s.k} className="bg-ink-900 px-4 py-4">
                <div className={cn("font-mono text-2xl", s.tone)}>{s.v}</div>
                <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-fg-4">{s.k}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => exportMarkdown(inv)}>
              <Download size={12} /> Export Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={() => download(`autopsy-${inv.target.id}-${inv.id.slice(-6)}.json`, toJson(inv), "application/json")}>
              <FileJson size={12} /> Export JSON
            </Button>
            <span className="self-center text-[11px] text-fg-4">Exports contain evidence only, never credentials.</span>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-10 sm:px-8 xl:grid-cols-[180px_1fr]">
        <nav aria-label="Rulebook sections" className="hidden xl:block">
          <ol className="sticky top-6 space-y-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3">
            {["Summary", "Rules", "Effect sizes", "Dependencies", "Decision structure", "Held-out fit", "Alternatives & caveats", ...(inv.target.origin === "external" || inv.target.origin === "python" ? ["Ground truth"] : [])].map((s, i) => (
              <li key={s}>
                <a href={`#rb-${i}`} className="flex gap-2 hover:text-fg">
                  <span className="text-fg-4">§{i}</span> {s}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 space-y-16">
          <section id="rb-0" aria-labelledby="rb-0-h">
            <SectionHead n={0} id="rb-0-h" title="Audit summary" sub="What was tested, what is supported, how uncertain it is, and what to check next. Every figure links back to recorded queries." />
            <Summary inv={inv} />
          </section>
          <section id="rb-1" aria-labelledby="rb-1-h">
            <SectionHead n={1} id="rb-1-h" title="Supported behavioral patterns" sub="Each rule is the simplest statement consistent with the controlled evidence: an observed input→output pattern, not recovered source code. Expand a rule to audit it or re-test it live." />
            <ol className="space-y-3">
              {r.rules.map((rule) => (
                <RuleArticle key={rule.id} inv={inv} rule={rule} />
              ))}
            </ol>
          </section>
          <section id="rb-2" aria-labelledby="rb-2-h">
            <SectionHead n={2} id="rb-2-h" title="Effect sizes with uncertainty" sub={`Estimated change in ${o.label.toLowerCase()} with 95% bootstrap intervals. The shaded band is the practical-equivalence margin.`} />
            <Forest inv={inv} />
          </section>
          <section id="rb-3" aria-labelledby="rb-3-h">
            <SectionHead n={3} id="rb-3-h" title="Conditional dependencies" sub="Which inputs each rule reads. Rules that join two inputs are conditional: one input changes how the other acts." />
            <Dependencies inv={inv} />
          </section>
          <section id="rb-4" aria-labelledby="rb-4-h">
            <SectionHead n={4} id="rb-4-h" title="Decision structure" sub="The surrogate tree learned from the engine's own queries (validation and test sets excluded). It approximates the target; it is not its source code. Click a split to fold it." />
            {inv.surrogate ? (
              <div className="surface rounded-xl p-3">
                <DecisionTree root={inv.surrogate.tree} spec={inv.target} height={430} maxDepth={4} />
              </div>
            ) : (
              <p className="text-sm text-fg-3">No surrogate model was fitted.</p>
            )}
          </section>
          <section id="rb-5" aria-labelledby="rb-5-h">
            <SectionHead
              n={5}
              id="rb-5-h"
              title="Held-out predictive fit"
              sub={`How well the surrogate predicts the target's responses to ${inv.surrogate?.evaluatedOn === "validation" ? "validation queries (the run stopped before the sealed test)" : "sealed test queries it never trained on, scored once by the final model"}. R² is predictive fit, not percentage accuracy and not the share of rules recovered.`}
            />
            {inv.surrogate && (
              <div className="grid gap-6 md:grid-cols-[1fr_240px]">
                <div className="surface rounded-xl p-4">
                  <FidelityScatter inv={inv} />
                </div>
                <div className="space-y-3">
                  {[
                    ["R²", inv.surrogate.fidelity.r2.toFixed(3)],
                    ["MAE", fmtOutput(o, inv.surrogate.fidelity.mae)],
                    ["RMSE", fmtOutput(o, inv.surrogate.fidelity.rmse)],
                    [inv.surrogate.evaluatedOn === "validation" ? "validation n" : "test n", String(inv.surrogate.fidelity.n)],
                  ].map(([k, v]) => (
                    <div key={k} className="border-b border-line pb-2">
                      <div className="font-mono text-xl">{v}</div>
                      <div className="label-mono">{k}</div>
                    </div>
                  ))}
                  <Link href={`/lab/${inv.id}/surrogate`} className="inline-block text-xs text-signal hover:underline">
                    Explore the surrogate →
                  </Link>
                </div>
              </div>
            )}
          </section>
          <section id="rb-6" aria-labelledby="rb-6-h">
            <SectionHead n={6} id="rb-6-h" title="Alternatives & caveats" sub="What was considered and ruled out, and the limits of these conclusions." />
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label className="mb-3">Rejected explanations</Label>
                <ul className="space-y-2">
                  {inv.hypotheses
                    .filter((h) => h.status === "rejected")
                    .map((h) => (
                      <li key={h.id} className="rounded-lg border border-line p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-fg-4">{h.id}</span>
                          <Chip tone="alert">rejected</Chip>
                        </div>
                        <div className="mt-1 text-[13px] text-fg-2 line-through decoration-fg-4/60">{h.statement}</div>
                        <div className="mt-1 text-xs text-fg-3">{h.history.at(-1)?.note}</div>
                      </li>
                    ))}
                </ul>
              </div>
              <div>
                <Label className="mb-3">Caveats</Label>
                <ul className="space-y-3">
                  {r.caveats.map((c, i) => (
                    <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-fg-2">
                      <span className="mt-0.5 font-mono text-[10px] text-amber">{String(i + 1).padStart(2, "0")}</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
          {(inv.target.origin === "external" || inv.target.origin === "python") && (
            <section id="rb-7" aria-labelledby="rb-7-h">
              <SectionHead n={7} id="rb-7-h" title="Reveal ground truth" sub="For blind challenges: after the run, reveal the true rules and compare them with what AUTOPSY found from responses alone." />
              <GroundTruthPanel inv={inv} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({ inv }: { inv: InvestigationState }) {
  const b = useMemo(() => buildBrief(inv), [inv]);
  if (!b) return null;
  const o = inv.target.output;
  return (
    <div className="space-y-5">
      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
        {[
          ["Target", `${b.identity} · ${b.origin}`],
          ["Endpoint", b.endpoint],
          ["Queries", `${b.queries.evaluated} of ${b.queries.limit} inputs evaluated${b.queries.requests !== undefined ? ` · ${b.queries.requests} HTTP requests incl. retries` : ""}${b.queries.verification ? ` · ${b.queries.verification} analyst/verification` : ""}`],
          ["Held-out fit", b.heldOut ? `R² ${b.heldOut.r2.toFixed(3)} · MAE ${fmtOutput(o, b.heldOut.mae)} · n = ${b.heldOut.n} (${b.heldOut.set})` : "not available"],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink-900 px-4 py-3">
            <div className="label-mono">{k}</div>
            <div className="mt-1 break-words text-[13px] text-fg-2">{v}</div>
          </div>
        ))}
      </div>
      <div className="surface overflow-x-auto rounded-xl">
        <table className="w-full min-w-[720px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line font-mono text-[10px] uppercase tracking-wider text-fg-4">
              <th className="px-3 py-2 font-normal">Finding</th>
              <th className="px-3 py-2 font-normal">Effect · 95% CI</th>
              <th className="px-3 py-2 font-normal">Test · n</th>
              <th className="px-3 py-2 font-normal">Tested range</th>
              <th className="px-3 py-2 font-normal">Fresh confirmation</th>
              <th className="px-3 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {b.findings.slice(0, 8).map((f) => (
              <tr key={f.rule.id} className="border-b border-line/60 align-top last:border-0">
                <td className="px-3 py-2.5">
                  <span className="font-mono text-[10px] text-fg-4">{f.rule.id}</span> <span className="text-fg">{f.rule.title}</span>
                </td>
                <td className="px-3 py-2.5 font-mono text-[11.5px] text-fg-2">
                  {f.effect ?? "—"}
                  {f.ci && <div className="text-fg-4">{f.ci}</div>}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-fg-3">{f.test ?? "—"}</td>
                <td className="px-3 py-2.5 text-[11.5px] text-fg-3">{f.range}</td>
                <td className="px-3 py-2.5 text-[11.5px]">
                  {f.confirmed ? <span className="text-truth">confirmation experiment</span> : <span className="text-amber">not confirmed</span>}
                  {f.retests.length > 0 && <div className="text-fg-3">{f.retests.length} analyst re-test{f.retests.length === 1 ? "" : "s"}</div>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <TestFindingButton inv={inv} rule={f.rule} size="xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <Label className="mb-2">Inconclusive ({b.inconclusive.length})</Label>
          {b.inconclusive.length ? (
            <ul className="space-y-1 text-[12.5px] text-fg-2">
              {b.inconclusive.slice(0, 6).map((x) => (
                <li key={x.id}>
                  <span className="font-mono text-[10px] text-fg-4">{x.id}</span> {x.statement} <span className="text-fg-4">— {x.note}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-fg-3">None.</p>
          )}
          <Label className="mb-2 mt-5">Inputs flagged for review</Label>
          {b.sensitive.length ? (
            <ul className="space-y-1.5 text-[12.5px] text-fg-2">
              {b.sensitive.map((x) => (
                <li key={x.feature} className="flex gap-2">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amber" />
                  <span>
                    <b className="font-medium text-fg">{x.feature}</b> — {x.why}. <span className="text-fg-3">{x.finding}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-fg-3">No field names matched the review list.</p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-fg-4">Flagged by field name only. Sensitivity to an input is an observed behavior, not by itself evidence of discrimination or a legal violation.</p>
        </div>
        <div>
          <Label className="mb-2">Suggested follow-up</Label>
          <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-fg-2">
            {b.followUps.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="text-signal">→</span> {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ n, id, title, sub }: { n: number; id: string; title: string; sub: string }) {
  return (
    <div className="mb-6 flex items-end gap-4 border-b border-line pb-4">
      <span className="font-serif text-5xl italic leading-none text-fg-4">§{n}</span>
      <div>
        <h2 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-[13px] text-fg-3">{sub}</p>
      </div>
    </div>
  );
}

function RuleArticle({ inv, rule }: { inv: InvestigationState; rule: Rule }) {
  const focused = useFocusRule((s) => s.id === rule.id);
  const [openLocal, setOpen] = useState(false);
  const open = openLocal || focused;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focused]);
  const obs = useObsMap(inv);
  const o = inv.target.output;
  const tone = rule.kind === "null" ? "neutral" : STRENGTH_TONE[rule.strength];
  const hyp = inv.hypotheses.find((h) => h.id === rule.hypothesisIds[0]);
  const exps = rule.experimentIds.map((id) => inv.experiments.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => !!e);
  return (
    <li ref={ref} className={cn("surface scroll-mt-6 overflow-hidden rounded-xl transition-colors", open ? "border-line-3" : "hover:border-line-2", focused && "ring-1 ring-signal/50")}>
      <button
        type="button"
        onClick={() => {
          if (focused) useFocusRule.getState().focus(null);
          setOpen(!open);
        }}
        aria-expanded={open} className="grid w-full grid-cols-[48px_1fr_auto] gap-4 p-5 text-left sm:grid-cols-[64px_1fr_auto]">
        <span className={cn("font-serif text-4xl italic leading-none sm:text-5xl", rule.kind === "null" ? "text-fg-4" : "text-fg-3")}>{String(rule.index).padStart(2, "0")}</span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">{rule.title}</span>
            <Chip tone={tone}>{rule.kind === "null" ? "no detectable effect" : `${rule.strength} evidence`}</Chip>
            <Chip>{H_KIND[rule.kind].label}</Chip>
            {rule.kind !== "null" && <Chip tone={rule.confirmed ? "truth" : "neutral"}>{rule.confirmed ? "confirmed on fresh subjects" : "not independently confirmed"}</Chip>}
          </span>
          <span className={cn("mt-2 block text-[17px] leading-snug sm:text-lg", rule.kind === "null" ? "text-fg-2" : "text-fg")}>{rule.statement}</span>
          <span className="mt-3 flex flex-wrap items-center gap-2">
            {rule.conditions.map((c) => (
              <code key={c} className="rounded border border-signal/25 bg-signal/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-signal">
                {c}
              </code>
            ))}
            <span className="font-mono text-[11px] text-fg-4">⇒</span>
            <code className="rounded border border-line-2 px-1.5 py-0.5 font-mono text-[11px] text-fg">{rule.effect}</code>
          </span>
        </span>
        <span className="flex flex-col items-end gap-2">
          <span aria-label={`Evidence score ${Math.round(rule.confidence * 100)} out of 100`} title={EVIDENCE_SCORE_HELP}>
            <Ring value={rule.confidence} tone={tone === "neutral" ? "model" : tone} size={40} stroke={3}>
              {Math.round(rule.confidence * 100)}
            </Ring>
          </span>
          <ChevronDown size={14} className={cn("text-fg-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
            <div className="grid gap-6 border-t border-line p-5 lg:grid-cols-[1fr_300px]">
              <div className="space-y-5">
                <Label>Evidence · {rule.support} observations across {exps.length} experiments</Label>
                {exps.slice(0, 3).map((e) => (
                  <div key={e.id} className="rounded-lg border border-line bg-ink-950/50 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-mono text-[10px] text-fg-4">{e.id}</span>
                      <span className="text-xs text-fg-2">{e.title}</span>
                      <Link href={`/lab/${inv.id}/experiments?e=${e.id}`} className="ml-auto font-mono text-[10px] text-signal hover:underline">
                        open →
                      </Link>
                    </div>
                    <ExperimentViz exp={e} obs={obs} spec={inv.target} hypotheses={inv.hypotheses} compact />
                    {e.result && <div className="mt-2 font-mono text-[10.5px] text-fg-3">{e.result.summary}</div>}
                  </div>
                ))}
              </div>
              <div className="space-y-5">
                <TestFindingButton inv={inv} rule={rule} />
                {rule.ci && rule.estimate !== undefined && (
                  <div>
                    <Label className="mb-2">Estimate · 95% CI</Label>
                    <div className="font-mono text-2xl">{fmtDelta(o, rule.estimate)}</div>
                    <div className="font-mono text-[11px] text-fg-3">
                      [{fmtDelta(o, rule.ci[0])}, {fmtDelta(o, rule.ci[1])}]
                    </div>
                  </div>
                )}
                {(hyp?.test ?? rule.test) && (
                  <div>
                    <Label className="mb-2">Test</Label>
                    <div className="text-xs text-fg-2">{(hyp?.test ?? rule.test)!.name}</div>
                    <div className="font-mono text-xs text-fg-3">
                      {(hyp?.test ?? rule.test)!.name.includes("BIC") ? `ΔBIC ${((hyp?.test ?? rule.test)!.statistic ?? 0).toFixed(1)}` : fmtP((hyp?.test ?? rule.test)!.p)} · n = {(hyp?.test ?? rule.test)!.n}
                    </div>
                    <div className="mt-1 text-[11px] text-fg-4">Tested at α = 0.02 without multiple-comparison correction.</div>
                  </div>
                )}
                {rule.kind === "null" && <div className="text-[12px] leading-snug text-fg-3">No detectable effect within the tested range and budget. This does not show that the effect is exactly zero.</div>}
                <div>
                  <Label className="mb-2 flex items-center gap-1.5">
                    Evidence score · {Math.round(rule.confidence * 100)}/100
                    <Tip content={EVIDENCE_SCORE_HELP}>
                      <button type="button" aria-label="What is the evidence score?" className="text-fg-4 hover:text-fg-2">
                        <Info size={11} />
                      </button>
                    </Tip>
                  </Label>
                  <Meter value={rule.confidence} tone={tone === "neutral" ? "model" : tone} height={4} label="Evidence score" />
                  <p className="mt-1.5 text-[11px] leading-snug text-fg-4">Heuristic, not a calibrated probability that the rule is correct.</p>
                </div>
                {rule.alternatives.length > 0 && (
                  <div>
                    <Label className="mb-2">Alternatives ruled out</Label>
                    {rule.alternatives.map((id) => {
                      const a = inv.hypotheses.find((h) => h.id === id);
                      return a ? (
                        <div key={id} className="mb-2 text-xs">
                          <div className="text-fg-3 line-through">{a.statement}</div>
                          <div className="text-fg-4">{a.history.at(-1)?.note}</div>
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
                {hyp && (
                  <div>
                    <Label className="mb-2">Audit trail</Label>
                    <ol className="space-y-1.5 border-l border-line-2 pl-3">
                      {hyp.history.map((ev, i) => (
                        <li key={i} className="text-[11.5px]">
                          <span style={{ color: toneVar[H_STATUS[ev.status].tone] }} className="font-mono text-[10px] uppercase">
                            {ev.status}
                          </span>{" "}
                          <span className="text-fg-3">{ev.note}</span>
                        </li>
                      ))}
                    </ol>
                    <Link href={`/lab/${inv.id}/hypotheses?h=${hyp.id}`} className="mt-2 inline-block text-xs text-model hover:underline">
                      View {hyp.id} on the hypothesis map →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function Forest({ inv }: { inv: InvestigationState }) {
  const rows = inv.report!.rules.filter((r) => r.ci && r.estimate !== undefined);
  const o = inv.target.output;
  const ext = Math.max(...rows.flatMap((r) => [Math.abs(r.ci![0]), Math.abs(r.ci![1])]), 1) * 1.08;
  const margin = (inv.report!.noiseSd || 0) * 1.5;
  const rowH = 30;
  if (!rows.length) return <p className="text-sm text-fg-3">No rule carries an effect estimate.</p>;
  return (
    <div className="surface rounded-xl p-4">
      <Chart height={rows.length * rowH + 30} label="Forest plot of rule effect sizes">
        {(w, h) => {
          const left = Math.min(260, w * 0.42);
          const x = scaleLinear().domain([-ext, ext]).range([left + 10, w - 10]);
          return (
            <g>
              <rect x={x(-margin)} y={0} width={Math.max(0, x(margin) - x(-margin))} height={h - 22} fill="rgb(255 255 255 / 0.03)" />
              <line x1={x(0)} x2={x(0)} y1={0} y2={h - 22} stroke="var(--color-line-3)" />
              {x.ticks(5).map((t) => (
                <AxisLabel key={t} x={x(t)} y={h - 6} anchor="middle">
                  {fmtDelta(o, t)}
                </AxisLabel>
              ))}
              {rows.map((r, i) => {
                const y = i * rowH + rowH / 2;
                const tone = r.kind === "null" ? "var(--color-fg-3)" : toneVar[STRENGTH_TONE[r.strength]];
                return (
                  <g key={r.id}>
                    <text x={0} y={y + 4} fontSize={12} fill="var(--color-fg-2)">
                      <tspan className="font-mono" fill="var(--color-fg-4)" fontSize={10}>
                        {r.id}{" "}
                      </tspan>
                      {r.title.length > 30 ? `${r.title.slice(0, 29)}…` : r.title}
                    </text>
                    <line x1={x(r.ci![0])} x2={x(r.ci![1])} y1={y} y2={y} stroke={tone} strokeWidth={2} strokeOpacity={0.7} />
                    <rect x={x(r.estimate!) - 4} y={y - 4} width={8} height={8} fill={tone} transform={`rotate(45 ${x(r.estimate!)} ${y})`} />
                    <title>{`${r.title}: ${fmtDelta(o, r.estimate!)} [${fmtDelta(o, r.ci![0])}, ${fmtDelta(o, r.ci![1])}]`}</title>
                  </g>
                );
              })}
            </g>
          );
        }}
      </Chart>
    </div>
  );
}

function Dependencies({ inv }: { inv: InvestigationState }) {
  const rules = inv.report!.rules;
  const feats = inv.target.features;
  const [hover, setHover] = useState<string | null>(null);
  const used = useMemo(() => new Set(rules.filter((r) => r.kind !== "null").flatMap((r) => r.features)), [rules]);
  const rowF = 40;
  const rowR = Math.max(28, (feats.length * rowF) / Math.max(1, rules.length));
  const H = Math.max(feats.length * rowF, rules.length * rowR) + 10;
  return (
    <div className="surface rounded-xl p-4">
      <Chart height={H} label="Bipartite graph linking inputs to rules">
        {(w) => {
          const fx = 150;
          const rx = w - 290;
          const fy = (i: number) => 20 + i * ((H - 30) / Math.max(1, feats.length - 1));
          const ry = (i: number) => 20 + i * ((H - 30) / Math.max(1, rules.length - 1));
          return (
            <g>
              {rules.map((r, j) =>
                r.features.map((k) => {
                  const i = feats.findIndex((f) => f.key === k);
                  const hot = hover === r.id || hover === k;
                  const col = r.kind === "null" ? "var(--color-fg-4)" : r.kind === "interaction" ? "var(--color-coral)" : toneVar[STRENGTH_TONE[r.strength]];
                  return (
                    <path
                      key={`${r.id}-${k}`}
                      d={`M${fx},${fy(i)} C${(fx + rx) / 2},${fy(i)} ${(fx + rx) / 2},${ry(j)} ${rx},${ry(j)}`}
                      fill="none"
                      stroke={col}
                      strokeOpacity={hover ? (hot ? 0.9 : 0.06) : 0.4}
                      strokeWidth={hot ? 2 : 1.2}
                      strokeDasharray={r.kind === "null" ? "3 4" : undefined}
                    />
                  );
                }),
              )}
              {feats.map((f, i) => (
                <g key={f.key} transform={`translate(${fx},${fy(i)})`} onMouseEnter={() => setHover(f.key)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
                  <circle r={5} fill={used.has(f.key) ? "var(--color-signal)" : "var(--color-ink-600)"} />
                  <text x={-12} y={4} textAnchor="end" fontSize={12} fill={used.has(f.key) ? "var(--color-fg)" : "var(--color-fg-4)"}>
                    {f.label}
                  </text>
                </g>
              ))}
              {rules.map((r, j) => (
                <g key={r.id} transform={`translate(${rx},${ry(j)})`} onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
                  <rect x={-4} y={-4} width={8} height={8} fill={r.kind === "null" ? "var(--color-fg-4)" : r.kind === "interaction" ? "var(--color-coral)" : toneVar[STRENGTH_TONE[r.strength]]} />
                  <text x={12} y={4} fontSize={11.5} fill={r.kind === "null" ? "var(--color-fg-3)" : "var(--color-fg-2)"}>
                    <tspan className="font-mono" fontSize={10} fill="var(--color-fg-4)">
                      {r.id}{" "}
                    </tspan>
                    {r.title.length > 32 ? `${r.title.slice(0, 31)}…` : r.title}
                  </text>
                </g>
              ))}
            </g>
          );
        }}
      </Chart>
      <div className="mt-2 flex flex-wrap gap-4 font-mono text-[10px] text-fg-3">
        <span>
          <span className="text-coral">━</span> conditional (two-input) rule
        </span>
        <span>
          <span className="text-fg-4">┅</span> no detectable effect within the tested range
        </span>
        <span className="text-fg-4">{feats.filter((f) => !used.has(f.key)).length ? `Unused: ${feats.filter((f) => !used.has(f.key)).map((f) => labelOf(inv.target, f.key)).join(", ")}` : ""}</span>
      </div>
    </div>
  );
}

function Pending({ inv }: { inv: InvestigationState }) {
  const supported = inv.hypotheses.filter((h) => h.status === "supported");
  const running = inv.status === "running" || inv.status === "paused";
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-grid p-6">
      <div className="glass corner-ticks w-full max-w-xl rounded-xl p-7">
        <div className="label-mono text-truth">[ 07 ] hidden rulebook</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {running ? (
            <>
              Compiling <span className="font-serif font-normal italic text-fg-2">under observation.</span>
            </>
          ) : (
            <>
              No rulebook <span className="font-serif font-normal italic text-fg-2">was published.</span>
            </>
          )}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-2">
          {running
            ? "The Reporter publishes the rulebook during synthesis, once every hypothesis has been tested. Findings so far:"
            : inv.status === "idle"
              ? "This investigation has not been launched yet."
              : "This investigation stopped before synthesis could run."}
        </p>
        {running && (
          <>
            <div className="mt-5 flex items-center gap-3">
              <Loader2 size={14} className="animate-spin text-signal" />
              <span className="font-mono text-xs text-fg-2">
                {supported.length} supported · {inv.hypotheses.length} hypotheses · phase {inv.phase ?? "—"}
              </span>
            </div>
            <ul className="mt-4 max-h-60 space-y-1.5 overflow-y-auto">
              {supported.slice(-8).map((h) => (
                <li key={h.id} className="flex gap-2 text-xs text-fg-2">
                  <span className="font-mono text-truth">{h.id}</span>
                  {h.statement}
                </li>
              ))}
            </ul>
          </>
        )}
        <ButtonLink href={`/lab/${inv.id}`} variant="outline" className="mt-6">
          <ArrowLeft size={12} /> Back to the laboratory
        </ButtonLink>
      </div>
    </div>
  );
}
