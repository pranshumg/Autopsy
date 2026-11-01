"use client";

import * as Slider from "@radix-ui/react-slider";
import { scaleLinear } from "d3-scale";
import { area as d3area, stack as d3stack } from "d3-shape";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { ArrowRight, FlaskConical, Loader2, Search, Shuffle, TriangleAlert } from "lucide-react";
import type { Experiment, ExperimentKind, Input, InvestigationState, Observation, QuerySource } from "@/lib/types";
import { analystAllowance, useLab } from "@/lib/store";
import { cn, fmtDelta, fmtFeature, fmtOutput, fmtP, fmtPct, fmtTime, featureOf, labelOf } from "@/lib/format";
import { EXP_KIND, H_STATUS, SOURCE_COLOR } from "@/components/meta";
import { Button, Chip, Dot, Empty, Label, PanelHeader, Segmented, Tip } from "@/components/ui";
import { AxisLabel, CIBar, Chart, Histogram, useObsMap } from "@/components/viz/core";
import { ExperimentViz } from "@/components/viz/experiment";
import { useSelection } from "./context";

export function ExperimentExplorer({ inv }: { inv: InvestigationState }) {
  const obs = useObsMap(inv);
  // lab views mount only on the client (after the shell loads local state), so reading the URL here is safe
  const [selId, setSelId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("e"));
  const compare = useSelection((s) => s.compare);
  const setCompare = useSelection((s) => s.setCompare);
  const [kind, setKind] = useState<"all" | ExperimentKind>("all");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...inv.experiments]
      .reverse()
      .filter((e) => (kind === "all" ? true : e.kind === kind))
      .filter((e) => !needle || e.title.toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle) || e.features.some((f) => f.includes(needle)));
  }, [inv.experiments, kind, q]);

  const sel = inv.experiments.find((e) => e.id === selId) ?? list.find((e) => e.status !== "planned") ?? null;
  const kinds = useMemo(() => [...new Set(inv.experiments.map((e) => e.kind))], [inv.experiments]);

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_340px]">
      {/* list */}
      <aside className="flex min-h-0 flex-col border-line max-lg:max-h-[45vh] max-lg:border-b lg:border-r" aria-label="Experiments">
        <PanelHeader index="01" title={`Experiments · ${inv.experiments.length}`} />
        <div className="space-y-2 border-b border-line p-2.5">
          <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-ink-900 px-2 focus-within:border-signal/50">
            <Search size={13} className="text-fg-4" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by id, title or field" className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-4" aria-label="Filter experiments" />
          </label>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Experiment kind">
            {(["all", ...kinds] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn("rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider transition-colors", kind === k ? "bg-white/[0.08] text-fg" : "text-fg-3 hover:text-fg-2")}
              >
                {k === "all" ? "all" : EXP_KIND[k].label}
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {!list.length && <Empty title={inv.experiments.length ? "No experiments match" : "No experiments yet"} hint={inv.experiments.length ? undefined : "Launch the investigation from the Laboratory view."} />}
          {list.map((e) => {
            const on = sel?.id === e.id;
            const k = EXP_KIND[e.kind];
            return (
              <li key={e.id}>
                <button type="button" onClick={() => setSelId(e.id)} aria-current={on} className={cn("relative w-full border-b border-line px-3 py-2.5 text-left transition-colors", on ? "bg-white/[0.04]" : "hover:bg-white/[0.02]")}>
                  {on && <motion.span layoutId="exp-active" className="absolute inset-y-0 left-0 w-[2px] bg-signal" />}
                  <div className="flex items-center gap-2">
                    <Dot tone={e.status === "running" ? "signal" : k.tone} pulse={e.status === "running"} size={5} />
                    <span className="font-mono text-[10px] text-fg-4">{e.id}</span>
                    <Chip tone={k.tone}>{k.label}</Chip>
                    <span className="ml-auto font-mono text-[10px] text-fg-4">{e.observationIds.length}q</span>
                  </div>
                  <div className="mt-1 truncate text-[12.5px] text-fg">{e.title}</div>
                  {e.result?.p !== undefined && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-fg-3">
                      {e.result.effect !== undefined ? fmtDelta(inv.target.output, e.result.effect) : ""} · {fmtP(e.result.p)}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* detail */}
      <section className="min-h-0 overflow-y-auto" aria-label="Experiment detail">
        {sel ? (
          <ExperimentDetail key={sel.id} inv={inv} e={sel} obs={obs} compare={compare} setCompare={setCompare} />
        ) : (
          <Empty icon={<FlaskConical size={22} />} title="Select an experiment" hint="Every controlled design the Experimenter runs appears on the left." />
        )}
        <div className="border-t border-line">
          <DiffPanel inv={inv} obs={obs} compare={compare} setCompare={setCompare} />
        </div>
        <div className="border-t border-line">
          <Composer inv={inv} onRan={(id) => setSelId(id)} />
        </div>
      </section>

      {/* telemetry */}
      <aside className="hidden min-h-0 flex-col border-l border-line xl:flex" aria-label="Query telemetry">
        <PanelHeader index="03" title="Query telemetry" right={inv.status === "running" && <Dot tone="signal" pulse />} />
        <div className="border-b border-line p-3">
          <BudgetChart inv={inv} />
        </div>
        <div className="border-b border-line p-3">
          <Label className="mb-2">Response distribution · all queries</Label>
          {inv.observations.length ? <Histogram values={inv.observations.map((o) => o.output)} format={(v) => fmtOutput(inv.target.output, v)} height={90} /> : <div className="h-[90px]" />}
        </div>
        <LiveStream inv={inv} onPick={(o) => setCompare(compare[0] === null || compare[1] !== null ? [o.id, null] : [compare[0], o.id])} />
      </aside>
    </div>
  );
}

function ExperimentDetail({
  inv,
  e,
  obs,
  compare,
  setCompare,
}: {
  inv: InvestigationState;
  e: Experiment;
  obs: Map<number, Observation>;
  compare: [number | null, number | null];
  setCompare: (c: [number | null, number | null]) => void;
}) {
  const k = EXP_KIND[e.kind];
  const o = inv.target.output;
  const hyps = e.hypothesisIds.map((id) => inv.hypotheses.find((h) => h.id === id)).filter(Boolean);
  const r = e.result;
  const span = r?.ci ? Math.max(Math.abs(r.ci[0]), Math.abs(r.ci[1])) * 1.3 || 1 : 1;
  const rows = e.observationIds.map((id) => obs.get(id)).filter((x): x is Observation => !!x);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-fg-3">{e.id}</span>
          <Chip tone={k.tone}>{k.label}</Chip>
          <Chip tone={e.status === "running" ? "signal" : "neutral"}>{e.status}</Chip>
          <span className="font-mono text-[10px] text-fg-4">phase · {e.phase}</span>
          <div className="ml-auto flex flex-wrap gap-1">
            {e.features.slice(0, 4).map((f) => (
              <Chip key={f} tone="signal">
                {f}
              </Chip>
            ))}
            {e.features.length > 4 && <Chip>+{e.features.length - 4}</Chip>}
          </div>
        </div>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">{e.title}</h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-fg-2">{e.design}</p>
      </div>
      <div className="grid gap-px bg-line md:grid-cols-[1fr_260px]">
        <div className="bg-ink-950 p-5">
          <Label className="mb-3">{e.pairs?.length ? "Controlled pairs · click a row to diff it" : e.kind === "sweep" ? "Dose-response by subject" : e.kind === "factorial" ? "Interaction plot" : "Responses"}</Label>
          <ExperimentViz exp={e} obs={obs} spec={inv.target} hypotheses={inv.hypotheses} onPickPair={(p) => setCompare([p.a, p.b])} activePair={compare} />
        </div>
        <div className="space-y-4 bg-ink-950 p-5">
          <div>
            <Label className="mb-1.5">Result</Label>
            {r ? <p className="font-mono text-[11px] leading-relaxed text-fg-2">{r.summary}</p> : <p className="text-xs text-fg-4">{e.status === "running" ? "Collecting responses…" : "No summary"}</p>}
          </div>
          {r?.ci && r.effect !== undefined && (
            <div>
              <Label className="mb-1.5">Effect · 95% bootstrap CI</Label>
              <div className="font-mono text-lg">{fmtDelta(o, r.effect)}</div>
              {r.relEffect !== undefined && <div className="font-mono text-[11px] text-fg-3">{fmtPct(r.relEffect)} median relative change</div>}
              <CIBar estimate={r.effect} ci={r.ci} domain={[-span, span]} className="mt-2" />
              <div className="mt-1 flex justify-between font-mono text-[9.5px] text-fg-4">
                <span>{fmtDelta(o, r.ci[0])}</span>
                <span>{fmtDelta(o, r.ci[1])}</span>
              </div>
            </div>
          )}
          {r?.p !== undefined && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-line p-2">
                <div className="font-mono text-sm">{fmtP(r.p)}</div>
                <div className="label-mono">sign-flip test</div>
              </div>
              <div className="rounded-md border border-line p-2">
                <div className="font-mono text-sm">{r.n}</div>
                <div className="label-mono">paired n</div>
              </div>
            </div>
          )}
          {r?.zeroShare !== undefined && r.zeroShare > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber/25 bg-amber/[0.05] p-2 text-[11.5px] text-amber">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" /> {(r.zeroShare * 100).toFixed(0)}% of pairs were pinned at the output floor in both arms (gated) and excluded from the effect estimate.
            </div>
          )}
          <div>
            <Label className="mb-1.5">Hypotheses under test</Label>
            {hyps.length ? (
              hyps.map((h) => (
                <a key={h!.id} href={`/lab/${inv.id}/hypotheses?h=${h!.id}`} className="flex items-start gap-2 py-1 text-xs text-fg-2 hover:text-fg">
                  <Dot tone={H_STATUS[h!.status].tone} className="mt-1.5" />
                  <span>
                    <span className="mr-1 font-mono text-fg-4">{h!.id}</span>
                    {h!.statement}
                  </span>
                </a>
              ))
            ) : (
              <div className="text-xs text-fg-4">Exploratory</div>
            )}
          </div>
        </div>
      </div>
      {rows.length > 0 && <ObservationTable inv={inv} rows={rows} compare={compare} setCompare={setCompare} />}
    </motion.div>
  );
}

function ObservationTable({ inv, rows, compare, setCompare }: { inv: InvestigationState; rows: Observation[]; compare: [number | null, number | null]; setCompare: (c: [number | null, number | null]) => void }) {
  const keys = inv.target.features.map((f) => f.key);
  const pick = (id: number) => {
    if (compare[0] === id) return setCompare([compare[1], null]);
    if (compare[1] === id) return setCompare([compare[0], null]);
    if (compare[0] === null) return setCompare([id, compare[1]]);
    if (compare[1] === null) return setCompare([compare[0], id]);
    setCompare([compare[1], id]);
  };
  return (
    <div className="border-t border-line">
      <div className="flex items-center gap-2 px-5 py-2.5">
        <Label>Observations · {rows.length}</Label>
        <span className="font-mono text-[10px] text-fg-4">select any two to compare</span>
      </div>
      <div className="max-h-[300px] overflow-auto">
        <table className="w-full min-w-[860px] font-mono text-[10.5px]">
          <thead className="sticky top-0 bg-ink-950 text-left text-fg-4">
            <tr>
              <th className="w-8 px-3 py-1.5" />
              <th className="px-2 py-1.5 font-normal">#</th>
              <th className="px-2 py-1.5 font-normal">subject</th>
              {keys.map((k) => (
                <th key={k} className="px-2 py-1.5 font-normal">
                  {k}
                </th>
              ))}
              <th className="px-3 py-1.5 text-right font-normal text-signal">{inv.target.output.key}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((o) => {
              const slot = compare[0] === o.id ? "A" : compare[1] === o.id ? "B" : null;
              return (
                <tr key={o.id} className={cn("border-t border-line", slot ? "bg-signal/[0.06]" : "hover:bg-white/[0.02]")}>
                  <td className="px-3 py-1">
                    <button
                      type="button"
                      onClick={() => pick(o.id)}
                      aria-label={slot ? `Remove observation ${o.id} from comparison` : `Add observation ${o.id} to comparison`}
                      aria-pressed={!!slot}
                      className={cn("flex h-4 w-4 items-center justify-center rounded-[3px] border text-[9px]", slot ? "border-signal bg-signal text-ink-950" : "border-line-3 text-transparent hover:border-fg-3")}
                    >
                      {slot ?? "·"}
                    </button>
                  </td>
                  <td className="px-2 py-1 text-fg-4">{o.id}</td>
                  <td className="px-2 py-1 text-fg-3">{o.personaId ?? "—"}</td>
                  {keys.map((k) => (
                    <td key={k} className="px-2 py-1 text-fg-3">
                      {fmtFeature(featureOf(inv.target, k), o.input[k])}
                    </td>
                  ))}
                  <td className="px-3 py-1 text-right text-fg">{fmtOutput(inv.target.output, o.output)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffPanel({ inv, obs, compare, setCompare }: { inv: InvestigationState; obs: Map<number, Observation>; compare: [number | null, number | null]; setCompare: (c: [number | null, number | null]) => void }) {
  const a = compare[0] !== null ? obs.get(compare[0]) : undefined;
  const b = compare[1] !== null ? obs.get(compare[1]) : undefined;
  const o = inv.target.output;
  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Label>Input diff</Label>
        <span className="font-mono text-[10px] text-fg-4">A → B · changed fields highlighted</span>
        {(a || b) && (
          <button type="button" onClick={() => setCompare([null, null])} className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fg-3 hover:text-fg">
            clear
          </button>
        )}
      </div>
      {!a || !b ? (
        <div className="rounded-lg border border-dashed border-line-2 px-4 py-6 text-center text-xs text-fg-3">
          {a ? `A = #${a.id}. Pick a second observation to compare.` : "Click a pair in the chart, or tick two observations in the table, to diff their inputs and outputs."}
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={`${a.id}-${b.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-[minmax(110px,1fr)_1fr_24px_1fr] items-center gap-x-3 border-b border-line bg-ink-900 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-4">
              <span>field</span>
              <span>A · #{a.id}</span>
              <span />
              <span>B · #{b.id}</span>
            </div>
            {inv.target.features.map((f) => {
              const changed = a.input[f.key] !== b.input[f.key];
              return (
                <div key={f.key} className={cn("grid grid-cols-[minmax(110px,1fr)_1fr_24px_1fr] items-center gap-x-3 border-b border-line px-3 py-1.5 text-xs", changed && "bg-signal/[0.07]")}>
                  <span className={cn("truncate", changed ? "text-signal" : "text-fg-3")}>{f.label}</span>
                  <span className={cn("font-mono", changed ? "text-fg-2 line-through decoration-fg-4" : "text-fg-3")}>{fmtFeature(f, a.input[f.key])}</span>
                  <span className={cn("text-center", changed ? "text-signal" : "text-fg-4")}>{changed ? <ArrowRight size={12} /> : "="}</span>
                  <span className={cn("font-mono", changed ? "font-medium text-signal" : "text-fg-3")}>{fmtFeature(f, b.input[f.key])}</span>
                </div>
              );
            })}
            <div className="grid grid-cols-[minmax(110px,1fr)_1fr_24px_1fr] items-center gap-x-3 bg-ink-900 px-3 py-2.5">
              <span className="text-xs font-medium text-fg">{o.label}</span>
              <span className="font-mono text-sm text-fg-2">{fmtOutput(o, a.output)}</span>
              <ArrowRight size={12} className="text-fg-3" />
              <span className="flex items-baseline gap-2 font-mono text-sm">
                <span className="text-fg">{fmtOutput(o, b.output)}</span>
                <span className={cn("text-xs", b.output - a.output > 0 ? "text-truth" : b.output - a.output < 0 ? "text-alert" : "text-fg-3")}>{fmtDelta(o, b.output - a.output)}</span>
              </span>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function Composer({ inv, onRan }: { inv: InvestigationState; onRan: (expId: string) => void }) {
  const manualQuery = useLab((s) => s.manualQuery);
  const personas = useMemo(() => {
    const m = new Map<string, Input>();
    for (const o of inv.observations) if (o.personaId && o.source === "baseline") m.set(o.personaId, o.input);
    return [...m.entries()];
  }, [inv.observations]);
  const [baseId, setBaseId] = useState<string>("");
  const base = personas.find(([id]) => id === baseId)?.[1] ?? personas[0]?.[1];
  const baseKey = baseId || personas[0]?.[0] || "";
  const [edit, setEdit] = useState<{ base: string; x: Input } | null>(null);
  const variant = edit && edit.base === baseKey ? edit.x : base ? { ...base } : null;
  const setVariant = (x: Input) => setEdit({ base: baseKey, x });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<{ a: number; b: number } | null>(null);
  const allowance = analystAllowance(inv);

  if (!base || !variant)
    return (
      <div className="px-5 py-4">
        <Label className="mb-2">Probe composer</Label>
        <div className="text-xs text-fg-4">Available once the Persona agent has generated baseline subjects.</div>
      </div>
    );

  const changed = inv.target.features.filter((f) => base[f.key] !== variant[f.key]).map((f) => f.key);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const out = await manualQuery(inv.id, [base, variant], {
        title: `Analyst pair · ${changed.map((k) => labelOf(inv.target, k)).join(", ")}`,
        design: `Controlled pair from ${baseId || personas[0][0]}: changed ${changed.map((k) => `${k} ${fmtFeature(featureOf(inv.target, k), base[k])} → ${fmtFeature(featureOf(inv.target, k), variant[k])}`).join("; ")}.`,
        features: changed,
        pair: true,
      });
      setLast({ a: out[0].output, b: out[1].output });
      const exp = useLab.getState().investigations[inv.id]?.experiments.at(-1);
      if (exp) onRan(exp.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Query failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Label>Probe composer · controlled pair</Label>
        <Tip content={inv.status === "running" ? "While agents are running you may only spend the 4% analyst reserve." : "Remaining investigation budget"}>
          <span className="font-mono text-[10px] text-fg-4">{allowance} queries available</span>
        </Tip>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="composer-base" className="font-mono text-[10px] uppercase tracking-wider text-fg-4">
            base
          </label>
          <select id="composer-base" value={baseId || personas[0][0]} onChange={(e) => setBaseId(e.target.value)} className="h-7 rounded-md border border-line bg-ink-900 px-2 font-mono text-[11px] text-fg outline-none focus:border-signal/50">
            {personas.map(([id]) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <Button size="xs" variant="ghost" onClick={() => setBaseId(personas[Math.floor(Math.random() * personas.length)][0])} aria-label="Random base subject">
            <Shuffle size={11} />
          </Button>
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        {inv.target.features.map((f) => {
          const isChanged = changed.includes(f.key);
          return (
            <div key={f.key} className={cn("rounded-md border px-3 py-2 transition-colors", isChanged ? "border-signal/40 bg-signal/[0.05]" : "border-line")}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("text-xs", isChanged ? "text-signal" : "text-fg-2")}>{f.label}</span>
                <span className="font-mono text-[11px] text-fg">
                  {isChanged && <span className="mr-1.5 text-fg-4 line-through">{fmtFeature(f, base[f.key])}</span>}
                  {fmtFeature(f, variant[f.key])}
                </span>
              </div>
              {f.kind === "numeric" ? (
                <Slider.Root
                  className="relative mt-2 flex h-4 w-full touch-none select-none items-center"
                  min={f.min}
                  max={f.max}
                  step={f.integer ? 1 : (f.max - f.min) / 200}
                  value={[Number(variant[f.key])]}
                  onValueChange={([v]) => setVariant({ ...variant, [f.key]: f.integer ? Math.round(v) : Math.round(v * 1e4) / 1e4 })}
                  aria-label={f.label}
                >
                  <Slider.Track className="relative h-[3px] grow rounded-full bg-white/[0.08]">
                    <Slider.Range className={cn("absolute h-full rounded-full", isChanged ? "bg-signal" : "bg-fg-4")} />
                  </Slider.Track>
                  <Slider.Thumb className={cn("block h-3 w-3 rounded-full border-2 bg-ink-950", isChanged ? "border-signal" : "border-fg-3")} />
                </Slider.Root>
              ) : (
                <div className="mt-1.5">
                  <Segmented label={f.label} size="xs" value={String(variant[f.key])} onChange={(v) => setVariant({ ...variant, [f.key]: v })} options={f.levels.map((l) => ({ value: l, label: l.replace(/_/g, " ") }))} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="signal" size="md" disabled={busy || !changed.length || allowance < 2} onClick={run}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
          Run controlled pair · 2 queries
        </Button>
        <Button variant="ghost" size="md" disabled={!changed.length} onClick={() => setVariant({ ...base })}>
          Reset
        </Button>
        <span className="text-xs text-fg-3">{changed.length ? `${changed.length} field${changed.length > 1 ? "s" : ""} changed — ${changed.length === 1 ? "a clean one-factor test" : "effects will be confounded"}` : "Change at least one field"}</span>
        {last && (
          <span className="ml-auto font-mono text-sm">
            {fmtOutput(inv.target.output, last.a)} → {fmtOutput(inv.target.output, last.b)}{" "}
            <span className={last.b - last.a > 0 ? "text-truth" : last.b - last.a < 0 ? "text-alert" : "text-fg-3"}>{fmtDelta(inv.target.output, last.b - last.a)}</span>
          </span>
        )}
      </div>
      {allowance < 2 && <div className="mt-2 text-xs text-amber">Query budget exhausted — no analyst probes remaining.</div>}
      {err && <div className="mt-2 text-xs text-alert">Query failed: {err}</div>}
    </div>
  );
}

const SOURCES: QuerySource[] = ["baseline", "replicate", "validation", "holdout", "pair", "sweep", "bisect", "confirm", "factorial", "active", "manual", "verify"];

function BudgetChart({ inv }: { inv: InvestigationState }) {
  const data = useMemo(() => {
    const obs = inv.observations;
    if (!obs.length) return null;
    const t0 = obs[0].t;
    const t1 = Math.max(obs.at(-1)!.t, t0 + 1);
    const bins = 48;
    const rows = Array.from({ length: bins + 1 }, (_, i) => {
      const r: Record<string, number> = { t: t0 + ((t1 - t0) * i) / bins };
      for (const s of SOURCES) r[s] = 0;
      return r;
    });
    for (const o of obs) {
      const i = Math.ceil(((o.t - t0) / (t1 - t0)) * bins);
      for (let j = i; j <= bins; j++) rows[j][o.source]++;
    }
    return { rows, t0, t1 };
  }, [inv.observations]);
  return (
    <div>
      <div className="mb-2 flex items-baseline">
        <Label>Budget burn · cumulative by source</Label>
        <span className="ml-auto font-mono text-[10px] text-fg-3">
          {inv.budget.used}/{inv.budget.limit}
        </span>
      </div>
      {!data ? (
        <div className="flex h-[120px] items-center justify-center rounded border border-dashed border-line font-mono text-[10px] text-fg-4">no queries yet</div>
      ) : (
        <Chart height={120} label="Cumulative queries by source over time">
          {(w, h) => {
            const x = scaleLinear().domain([data.t0, data.t1]).range([0, w]);
            const y = scaleLinear().domain([0, inv.budget.limit]).range([h - 12, 0]);
            const series = d3stack<Record<string, number>>().keys(SOURCES)(data.rows);
            const ar = d3area<[number, number] & { data: Record<string, number> }>()
              .x((d) => x(d.data.t))
              .y0((d) => y(d[0]))
              .y1((d) => y(d[1]));
            return (
              <g>
                <line x1={0} x2={w} y1={y(inv.budget.limit)} y2={y(inv.budget.limit)} stroke="var(--color-alert)" strokeOpacity={0.4} strokeDasharray="3 3" />
                {series.map((s) => (
                  <path key={s.key} d={ar(s as never) ?? ""} fill={SOURCE_COLOR[s.key as QuerySource]} fillOpacity={0.75} />
                ))}
                <AxisLabel x={0} y={h - 1}>
                  {fmtTime(data.t0).slice(0, 8)}
                </AxisLabel>
                <AxisLabel x={w} y={h - 1} anchor="end">
                  {fmtTime(data.t1).slice(0, 8)}
                </AxisLabel>
              </g>
            );
          }}
        </Chart>
      )}
    </div>
  );
}

function LiveStream({ inv, onPick }: { inv: InvestigationState; onPick: (o: Observation) => void }) {
  const rows = inv.observations.slice(-40).reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <Label>Live query stream</Label>
        <span className="ml-auto font-mono text-[10px] text-fg-4">click to diff</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto font-mono text-[10.5px]">
        <AnimatePresence initial={false}>
          {rows.map((o) => (
            <motion.li key={o.id} initial={{ opacity: 0, backgroundColor: "rgb(78 225 240 / 0.12)" }} animate={{ opacity: 1, backgroundColor: "rgb(78 225 240 / 0)" }} transition={{ duration: 0.8 }}>
              <button type="button" onClick={() => onPick(o)} className="flex w-full items-center gap-2 border-t border-line px-3 py-1 text-left hover:bg-white/[0.03]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SOURCE_COLOR[o.source] }} />
                <span className="w-10 text-fg-4">#{o.id > 999999 ? `M${o.id - 1000000}` : o.id}</span>
                <span className="w-16 truncate text-fg-3">{o.source}</span>
                <span className="text-fg-4">{o.experimentId}</span>
                <span className="ml-auto text-fg">{fmtOutput(inv.target.output, o.output)}</span>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
