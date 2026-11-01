"use client";

import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { AgentId, Experiment, Hypothesis, InvestigationState } from "@/lib/types";
import { cn, fmtDelta, fmtDuration, fmtFeature, fmtOutput, fmtP, fmtPct, featureOf, labelOf } from "@/lib/format";
import { AGENT_META, EXP_KIND, H_KIND, H_STATUS } from "@/components/meta";
import { Chip, Dot, Empty, Label, Meter, PanelHeader, Ring, toneVar } from "@/components/ui";
import { CIBar, Histogram, useObsMap } from "@/components/viz/core";
import { ExperimentViz } from "@/components/viz/experiment";
import { useSelection, type Selection } from "./context";

export function Inspector({ inv }: { inv: InvestigationState }) {
  const selection = useSelection((s) => s.selection);
  const select = useSelection((s) => s.select);
  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        index="03"
        title={selection ? `Inspector · ${selection.kind}` : "Live findings"}
        right={
          selection && (
            <button type="button" onClick={() => select(null)} aria-label="Clear selection" className="rounded p-1 text-fg-3 hover:bg-white/[0.05] hover:text-fg">
              <X size={13} />
            </button>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selection ? `${selection.kind}:${selection.id}` : "feed"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {selection ? <Detail inv={inv} sel={selection} /> : <FindingsFeed inv={inv} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Detail({ inv, sel }: { inv: InvestigationState; sel: NonNullable<Selection> }) {
  switch (sel.kind) {
    case "hypothesis": {
      const h = inv.hypotheses.find((x) => x.id === sel.id);
      return h ? <HypothesisDossier inv={inv} h={h} /> : <Missing />;
    }
    case "experiment": {
      const e = inv.experiments.find((x) => x.id === sel.id);
      return e ? <ExperimentDossier inv={inv} e={e} /> : <Missing />;
    }
    case "feature":
      return <FeatureDossier inv={inv} featureKey={sel.id} />;
    case "agent":
      return <AgentDossier inv={inv} agent={sel.id as AgentId} />;
    case "target":
      return <TargetDossier inv={inv} />;
    case "surrogate":
      return <SurrogateBrief inv={inv} />;
    case "report":
      return <ReportBrief inv={inv} />;
    default:
      return <Missing />;
  }
}

function Missing() {
  return <Empty title="Nothing to inspect" hint="The selected item no longer exists in this investigation." />;
}

export function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-b border-line px-4 py-3.5", className)}>
      <Label className="mb-2">{title}</Label>
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="text-fg-3">{k}</span>
      <span className="text-right font-mono text-fg-2">{v}</span>
    </div>
  );
}

export function SelectLink({ sel, children, className }: { sel: NonNullable<Selection>; children: React.ReactNode; className?: string }) {
  const select = useSelection((s) => s.select);
  return (
    <button type="button" onClick={() => select(sel)} className={cn("text-left transition-colors hover:text-fg", className)}>
      {children}
    </button>
  );
}

function ExpRow({ inv, id, tone }: { inv: InvestigationState; id: string; tone?: "conflict" }) {
  const e = inv.experiments.find((x) => x.id === id);
  if (!e) return null;
  return (
    <SelectLink sel={{ kind: "experiment", id }} className="flex w-full items-center gap-2 rounded px-1.5 py-1 hover:bg-white/[0.03]">
      <Dot tone={tone === "conflict" ? "alert" : EXP_KIND[e.kind].tone} />
      <span className="font-mono text-[10px] text-fg-3">{e.id}</span>
      <span className="truncate text-xs text-fg-2">{e.title}</span>
      <span className="ml-auto font-mono text-[10px] text-fg-4">{e.observationIds.length}q</span>
    </SelectLink>
  );
}

export function HypothesisDossier({ inv, h, showViz = true }: { inv: InvestigationState; h: Hypothesis; showViz?: boolean }) {
  const st = H_STATUS[h.status];
  const o = inv.target.output;
  const obs = useObsMap(inv);
  const firstExp = inv.experiments.find((e) => e.id === h.evidence.supporting.at(-1));
  const span = h.effect ? Math.max(Math.abs(h.effect.ci[0]), Math.abs(h.effect.ci[1]), Math.abs(h.effect.estimate)) * 1.25 || 1 : 1;
  return (
    <div>
      <div className="border-b border-line px-4 pb-4 pt-3.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-fg-3">{h.id}</span>
          <Chip tone={st.tone}>{st.label}</Chip>
          <Chip>{H_KIND[h.kind].label}</Chip>
          <span className="ml-auto" title="Evidence score (0-100): a heuristic, not a calibrated probability that the hypothesis is correct." aria-label={`Evidence score ${Math.round(h.confidence * 100)} out of 100`}>
            <Ring value={h.confidence} tone={st.tone === "neutral" ? "model" : st.tone} size={30}>
              {Math.round(h.confidence * 100)}
            </Ring>
          </span>
        </div>
        <p className="mt-2.5 text-[14px] leading-snug text-fg">{h.statement}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {h.features.map((k) => (
            <SelectLink key={k} sel={{ kind: "feature", id: k }}>
              <Chip tone="signal">{k}</Chip>
            </SelectLink>
          ))}
        </div>
      </div>
      {h.effect && (
        <Section title="Estimated effect · 95% CI">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="font-mono text-lg text-fg">{fmtDelta(o, h.effect.estimate)}</span>
            {h.effect.rel !== undefined && <span className="font-mono text-xs text-fg-3">{fmtPct(h.effect.rel)}</span>}
          </div>
          <CIBar estimate={h.effect.estimate} ci={h.effect.ci} domain={[-span, span]} tone={toneVar[st.tone === "neutral" ? "model" : st.tone]} />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-fg-4">
            <span>{fmtDelta(o, h.effect.ci[0])}</span>
            <span>0</span>
            <span>{fmtDelta(o, h.effect.ci[1])}</span>
          </div>
        </Section>
      )}
      {h.threshold && (
        <Section title="Localized threshold">
          <KV k="estimate" v={fmtFeature(featureOf(inv.target, h.features[0]), h.threshold.value)} />
          <KV
            k="bracket"
            v={`${fmtFeature(featureOf(inv.target, h.features[0]), h.threshold.lo)} – ${fmtFeature(featureOf(inv.target, h.features[0]), h.threshold.end ?? h.threshold.hi)}`}
          />
          <KV k="shape" v={h.threshold.direction === "window" ? "window" : h.threshold.direction === "up" ? "step up" : "step down"} />
        </Section>
      )}
      {h.test && (
        <Section title="Test">
          <KV k="procedure" v={h.test.name} />
          <KV k="p-value" v={fmtP(h.test.p)} />
          <KV k="n" v={h.test.n} />
        </Section>
      )}
      {showViz && firstExp && (
        <Section title={`Evidence · ${firstExp.id}`}>
          <ExperimentViz exp={firstExp} obs={obs} spec={inv.target} hypotheses={inv.hypotheses} compact />
        </Section>
      )}
      <Section title={`Supporting experiments (${h.evidence.supporting.length})`}>
        {h.evidence.supporting.length ? h.evidence.supporting.map((id) => <ExpRow key={id} inv={inv} id={id} />) : <div className="text-xs text-fg-4">None yet</div>}
      </Section>
      {h.evidence.conflicting.length > 0 && (
        <Section title={`Conflicting evidence (${h.evidence.conflicting.length})`}>
          {h.evidence.conflicting.map((id) => (
            <ExpRow key={id} inv={inv} id={id} tone="conflict" />
          ))}
        </Section>
      )}
      {(h.competes.length > 0 || h.related.length > 0) && (
        <Section title="Linked hypotheses">
          {[...h.competes.map((id) => ({ id, rel: "competes" })), ...h.related.map((id) => ({ id, rel: "related" }))].map(({ id, rel }) => {
            const o2 = inv.hypotheses.find((x) => x.id === id);
            if (!o2) return null;
            return (
              <SelectLink key={id + rel} sel={{ kind: "hypothesis", id }} className="flex w-full items-start gap-2 rounded px-1.5 py-1 hover:bg-white/[0.03]">
                <Dot tone={H_STATUS[o2.status].tone} className="mt-1.5" />
                <span className="min-w-0 flex-1 text-xs leading-snug text-fg-2">
                  <span className="mr-1.5 font-mono text-[9.5px] uppercase text-fg-4">{rel === "competes" ? "vs" : "↔"}</span>
                  {o2.statement}
                </span>
              </SelectLink>
            );
          })}
        </Section>
      )}
      <Section title="Status history" className="border-b-0">
        <ol className="relative ml-1 space-y-2 border-l border-line-2 pl-3">
          {h.history.map((ev, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[16.5px] top-1.5 h-2 w-2 rounded-full border border-ink-950" style={{ background: toneVar[H_STATUS[ev.status].tone] }} />
              <div className="flex items-center gap-2 font-mono text-[10px] text-fg-4">
                <span>{H_STATUS[ev.status].label}</span>
                <span>{new Date(ev.t).toLocaleTimeString()}</span>
              </div>
              {ev.note && <div className="text-xs text-fg-2">{ev.note}</div>}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

export function ExperimentDossier({ inv, e }: { inv: InvestigationState; e: Experiment }) {
  const obs = useObsMap(inv);
  const k = EXP_KIND[e.kind];
  return (
    <div>
      <div className="border-b border-line px-4 pb-4 pt-3.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-fg-3">{e.id}</span>
          <Chip tone={k.tone}>{k.label}</Chip>
          <Chip tone={e.status === "running" ? "signal" : e.status === "cancelled" ? "amber" : "neutral"}>{e.status}</Chip>
        </div>
        <div className="mt-2 text-[14px] font-medium text-fg">{e.title}</div>
        <p className="mt-1 text-xs leading-relaxed text-fg-2">{e.design}</p>
      </div>
      <Section title="Response view">
        <ExperimentViz exp={e} obs={obs} spec={inv.target} hypotheses={inv.hypotheses} compact />
      </Section>
      {e.result && (
        <Section title="Result">
          <p className="font-mono text-[11px] leading-relaxed text-fg-2">{e.result.summary}</p>
        </Section>
      )}
      <Section title="Tests hypotheses">
        {e.hypothesisIds.length ? (
          e.hypothesisIds.map((id) => {
            const h = inv.hypotheses.find((x) => x.id === id);
            return h ? (
              <SelectLink key={id} sel={{ kind: "hypothesis", id }} className="flex w-full items-start gap-2 rounded px-1.5 py-1 hover:bg-white/[0.03]">
                <Dot tone={H_STATUS[h.status].tone} className="mt-1.5" />
                <span className="text-xs text-fg-2">
                  <span className="mr-1 font-mono text-fg-4">{h.id}</span>
                  {h.statement}
                </span>
              </SelectLink>
            ) : null;
          })
        ) : (
          <div className="text-xs text-fg-4">Exploratory — not tied to a hypothesis</div>
        )}
      </Section>
      <Section title="Execution" className="border-b-0">
        <KV k="queries" v={e.observationIds.length} />
        <KV k="phase" v={e.phase} />
        {e.completedAt && <KV k="duration" v={fmtDuration(e.completedAt - e.createdAt)} />}
        <Link href={`/lab/${inv.id}/experiments?e=${e.id}`} className="mt-2 inline-flex items-center gap-1 text-xs text-signal hover:underline">
          Open in Experiment Explorer <ArrowUpRight size={12} />
        </Link>
      </Section>
    </div>
  );
}

function FeatureDossier({ inv, featureKey }: { inv: InvestigationState; featureKey: string }) {
  const f = featureOf(inv.target, featureKey);
  if (!f) return <Missing />;
  const hs = inv.hypotheses.filter((h) => h.features.includes(featureKey));
  const exps = inv.experiments.filter((e) => e.features.length <= 2 && e.features.includes(featureKey));
  const imp = inv.surrogate?.importance[featureKey] ?? 0;
  return (
    <div>
      <div className="border-b border-line px-4 pb-4 pt-3.5">
        <div className="flex items-center gap-2">
          <Chip tone="signal">input</Chip>
          <span className="font-mono text-[11px] text-fg-3">{f.key}</span>
        </div>
        <div className="mt-2 text-[15px] font-medium">{f.label}</div>
        <p className="mt-1 text-xs leading-relaxed text-fg-2">{f.description}</p>
      </div>
      <Section title="Schema">
        <KV k="type" v={f.kind} />
        {f.kind === "numeric" ? <KV k="range" v={`${fmtFeature(f, f.min)} – ${fmtFeature(f, f.max)}`} /> : <KV k="levels" v={f.levels.join(", ")} />}
      </Section>
      <Section title="Surrogate importance">
        <div className="flex items-center gap-3">
          <Meter value={imp} tone="model" className="flex-1" />
          <span className="font-mono text-xs text-fg-2">{(imp * 100).toFixed(1)}%</span>
        </div>
      </Section>
      <Section title={`Hypotheses (${hs.length})`}>
        {hs.length ? (
          hs.map((h) => (
            <SelectLink key={h.id} sel={{ kind: "hypothesis", id: h.id }} className="flex w-full items-start gap-2 rounded px-1.5 py-1 hover:bg-white/[0.03]">
              <Dot tone={H_STATUS[h.status].tone} className="mt-1.5" />
              <span className="text-xs leading-snug text-fg-2">{h.statement}</span>
            </SelectLink>
          ))
        ) : (
          <div className="text-xs text-fg-4">Not yet examined</div>
        )}
      </Section>
      <Section title={`Experiments (${exps.length})`} className="border-b-0">
        {exps.map((e) => (
          <ExpRow key={e.id} inv={inv} id={e.id} />
        ))}
        {!exps.length && <div className="text-xs text-fg-4">None yet</div>}
      </Section>
    </div>
  );
}

function AgentDossier({ inv, agent }: { inv: InvestigationState; agent: AgentId }) {
  const m = AGENT_META[agent];
  const rt = inv.agents[agent];
  const tasks = inv.tasks.filter((t) => t.agent === agent).slice(-8).reverse();
  const Icon = m.icon;
  return (
    <div>
      <div className="border-b border-line px-4 pb-4 pt-3.5" style={{ color: m.color }}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-current/30 bg-current/10">
            <Icon size={17} />
          </span>
          <div>
            <div className="text-[15px] font-medium text-fg">{m.name} agent</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-fg-3">{rt.status}</div>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-fg-2">{m.blurb}</p>
      </div>
      <Section title="Counters">
        <KV k="tasks completed" v={rt.completed} />
        {agent === "experimenter" && <KV k="queries issued" v={rt.queries} />}
      </Section>
      <Section title="Recent tasks" className="border-b-0">
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-md border border-line bg-ink-950/50 p-2">
              <div className="flex items-center gap-2">
                <Dot tone={t.status === "running" ? "signal" : t.status === "done" ? "truth" : "amber"} pulse={t.status === "running"} />
                <span className="font-mono text-[10px] text-fg-4">{t.id}</span>
                <span className="ml-auto font-mono text-[10px] text-fg-4">{t.endedAt ? fmtDuration(t.endedAt - t.startedAt) : "…"}</span>
              </div>
              <div className="mt-1 text-xs text-fg">{t.title}</div>
              {t.decision && <div className="mt-1 text-[11px] text-fg-3">→ {t.decision}</div>}
            </div>
          ))}
          {!tasks.length && <div className="text-xs text-fg-4">No tasks yet</div>}
        </div>
        <Link href={`/lab/${inv.id}/agents?a=${agent}`} className="mt-3 inline-flex items-center gap-1 text-xs text-signal hover:underline">
          Open in Agent Command <ArrowUpRight size={12} />
        </Link>
      </Section>
    </div>
  );
}

function TargetDossier({ inv }: { inv: InvestigationState }) {
  const o = inv.target.output;
  const ys = inv.observations.map((x) => x.output);
  return (
    <div>
      <div className="border-b border-line px-4 pb-4 pt-3.5">
        <Chip>black box</Chip>
        <div className="mt-2 text-[15px] font-medium">{inv.target.name}</div>
        <div className="font-mono text-[10px] text-fg-3">
          {inv.target.vendor} · {inv.target.version}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-fg-2">{inv.target.description}</p>
      </div>
      <Section title="Contract">
        <KV k="endpoint" v={`POST ${inv.target.endpoint}`} />
        <KV k="output" v={`${o.label} (${o.unit})`} />
        <KV k="fields" v={inv.target.features.length} />
        <KV k="stochastic" v={inv.report ? (inv.report.noiseSd > 0 ? `yes · σ≈${fmtOutput(o, inv.report.noiseSd)}` : "no") : "unknown"} />
      </Section>
      <Section title={`Observed responses (${ys.length})`} className="border-b-0">
        {ys.length ? <Histogram values={ys} format={(v) => fmtOutput(o, v)} color="var(--color-signal)" /> : <div className="text-xs text-fg-4">No queries issued yet</div>}
      </Section>
    </div>
  );
}

function SurrogateBrief({ inv }: { inv: InvestigationState }) {
  const s = inv.surrogate;
  if (!s) return <Empty title="No surrogate yet" hint="The statistician fits the first surrogate after reconnaissance." />;
  const imp = Object.entries(s.importance).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <Section title={`Surrogate v${s.version}`}>
        <KV k="holdout R²" v={s.fidelity.r2.toFixed(3)} />
        <KV k="MAE" v={fmtOutput(inv.target.output, s.fidelity.mae)} />
        <KV k="leaves / depth" v={`${s.leaves} / ${s.depth}`} />
        <KV k="trained on" v={`${s.trainedOn} observations`} />
      </Section>
      <Section title="Importance" className="border-b-0">
        <div className="space-y-1.5">
          {imp.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate text-fg-2">{labelOf(inv.target, k)}</span>
              <Meter value={v} tone="model" className="flex-1" />
              <span className="w-10 text-right font-mono text-[10px] text-fg-3">{(v * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
        <Link href={`/lab/${inv.id}/surrogate`} className="mt-3 inline-flex items-center gap-1 text-xs text-signal hover:underline">
          Open Surrogate Explorer <ArrowUpRight size={12} />
        </Link>
      </Section>
    </div>
  );
}

function ReportBrief({ inv }: { inv: InvestigationState }) {
  if (!inv.report) return <Empty title="Rulebook not yet compiled" hint="The reporter publishes the rulebook during synthesis." />;
  return (
    <Section title="Rulebook" className="border-b-0">
      <p className="text-xs leading-relaxed text-fg-2">{inv.report.summary}</p>
      <Link href={`/lab/${inv.id}/rulebook`} className="mt-3 inline-flex items-center gap-1 text-xs text-truth hover:underline">
        Read the Hidden Rulebook <ArrowUpRight size={12} />
      </Link>
    </Section>
  );
}

function FindingsFeed({ inv }: { inv: InvestigationState }) {
  const hs = [...inv.hypotheses].sort((a, b) => b.createdAt - a.createdAt);
  if (!hs.length)
    return (
      <Empty
        title={inv.status === "idle" ? "No investigation running" : "Collecting baseline evidence…"}
        hint={inv.status === "idle" ? "Launch the investigation to watch hypotheses emerge here in real time." : "Hypotheses appear once the statistician has profiled the target's responses."}
      />
    );
  const counts = (["supported", "testing", "rejected", "inconclusive"] as const).map((s) => [s, inv.hypotheses.filter((h) => h.status === s).length] as const);
  return (
    <div>
      <div className="grid grid-cols-4 border-b border-line">
        {counts.map(([s, n]) => (
          <div key={s} className="border-r border-line px-3 py-2.5 last:border-r-0">
            <div className="font-mono text-base" style={{ color: toneVar[H_STATUS[s].tone] }}>
              {n}
            </div>
            <div className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-fg-4">{H_STATUS[s].label}</div>
          </div>
        ))}
      </div>
      <ul>
        <AnimatePresence initial={false}>
          {hs.map((h) => (
            <motion.li key={h.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <SelectLink sel={{ kind: "hypothesis", id: h.id }} className="flex w-full items-start gap-2.5 border-b border-line px-4 py-2.5 hover:bg-white/[0.02]">
                <Ring value={h.confidence} tone={H_STATUS[h.status].tone === "neutral" ? "model" : H_STATUS[h.status].tone} size={20} stroke={2} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-fg-4">{h.id}</span>
                    <span className="font-mono text-[9.5px] uppercase tracking-wider" style={{ color: toneVar[H_STATUS[h.status].tone] }}>
                      {H_STATUS[h.status].label}
                    </span>
                  </span>
                  <span className={cn("mt-0.5 block text-xs leading-snug", h.status === "rejected" ? "text-fg-3" : "text-fg-2")}>{h.statement}</span>
                </span>
              </SelectLink>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
