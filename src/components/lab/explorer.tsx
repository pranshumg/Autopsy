"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PHASES, type InvestigationState, type QuerySource } from "@/lib/types";
import { cn, fmtFeature } from "@/lib/format";
import { EXP_KIND, SOURCE_COLOR } from "@/components/meta";
import { Dot, Label, Meter, PanelHeader, Tip } from "@/components/ui";
import { useSelection } from "./context";

export function Explorer({ inv }: { inv: InvestigationState }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader index="01" title="Specimen & experiments" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Specimen inv={inv} />
        <BudgetLedger inv={inv} />
        <ExperimentTree inv={inv} />
      </div>
    </div>
  );
}

function Specimen({ inv }: { inv: InvestigationState }) {
  const select = useSelection((s) => s.select);
  const sel = useSelection((s) => s.selection);
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-line px-3 py-3">
      <button type="button" onClick={() => select({ kind: "target", id: inv.target.id })} className="w-full rounded-md border border-line bg-ink-900 p-2.5 text-left transition-colors hover:border-line-2">
        <div className="flex items-center gap-2">
          <Label>Target</Label>
          <span className="ml-auto font-mono text-[10px] text-fg-4">{inv.target.version}</span>
        </div>
        <div className="mt-1 text-[13px] font-medium text-fg">{inv.target.name}</div>
        <div className="mt-0.5 font-mono text-[10px] text-fg-3">{inv.target.domain}</div>
      </button>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-3 flex w-full items-center gap-2">
        <Label>Input schema · {inv.target.features.length} fields</Label>
        <ChevronDown size={12} className={cn("ml-auto text-fg-4 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-px">
          {inv.target.features.map((f) => {
            const on = sel?.kind === "feature" && sel.id === f.key;
            return (
              <li key={f.key}>
                <button
                  type="button"
                  onClick={() => select({ kind: "feature", id: f.key })}
                  className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left", on ? "bg-signal/10 text-fg" : "text-fg-2 hover:bg-white/[0.03]")}
                >
                  <span className={cn("font-mono text-[9px] uppercase", f.kind === "numeric" ? "text-signal" : "text-model")}>{f.kind === "numeric" ? "num" : "cat"}</span>
                  <span className="truncate text-xs">{f.label}</span>
                  <span className="ml-auto truncate font-mono text-[9.5px] text-fg-4">
                    {f.kind === "numeric" ? `${fmtFeature(f, f.min)}–${fmtFeature(f, f.max)}` : `${f.levels.length} lv`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BudgetLedger({ inv }: { inv: InvestigationState }) {
  const bySource = useMemo(() => {
    const m = new Map<QuerySource, number>();
    for (const o of inv.observations) m.set(o.source, (m.get(o.source) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inv.observations]);
  const L = inv.budget.limit;
  return (
    <section className="border-b border-line px-3 py-3">
      <div className="flex items-baseline">
        <Label>Query budget</Label>
        <span className="ml-auto font-mono text-[11px] text-fg-2">
          {inv.budget.used}
          <span className="text-fg-4"> / {L}</span>
        </span>
      </div>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-sm bg-white/[0.05]" role="img" aria-label="Query budget by source">
        {bySource.map(([s, n]) => (
          <Tip key={s} content={`${s}: ${n} queries`}>
            <span className="h-full transition-[width] duration-700" style={{ width: `${(n / L) * 100}%`, background: SOURCE_COLOR[s] }} />
          </Tip>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        {bySource.map(([s, n]) => (
          <div key={s} className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="h-1.5 w-1.5 rounded-sm" style={{ background: SOURCE_COLOR[s] }} />
            <span className="text-fg-3">{s}</span>
            <span className="ml-auto text-fg-2">{n}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExperimentTree({ inv }: { inv: InvestigationState }) {
  const sel = useSelection((s) => s.selection);
  const select = useSelection((s) => s.select);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const groups = PHASES.map((p) => ({ phase: p, exps: inv.experiments.filter((e) => e.phase === p.id && e.kind !== "manual") }));
  const manual = inv.experiments.filter((e) => e.kind === "manual");
  return (
    <section className="px-1.5 py-2">
      <div className="px-1.5 pb-1.5">
        <Label>Experiment explorer</Label>
      </div>
      {groups.map(({ phase, exps }) => {
        const prog = inv.phaseProgress[phase.id] ?? 0;
        const active = inv.phase === phase.id;
        const isClosed = closed.has(phase.id);
        return (
          <div key={phase.id} className="mb-0.5">
            <button
              type="button"
              aria-expanded={!isClosed}
              onClick={() =>
                setClosed((s) => {
                  const n = new Set(s);
                  if (n.has(phase.id)) n.delete(phase.id);
                  else n.add(phase.id);
                  return n;
                })
              }
              className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 hover:bg-white/[0.03]"
            >
              <ChevronDown size={11} className={cn("text-fg-4 transition-transform", isClosed && "-rotate-90")} />
              <span className={cn("text-xs", active ? "text-signal" : exps.length ? "text-fg" : "text-fg-4")}>{phase.label}</span>
              {active && <Dot tone="signal" pulse size={5} />}
              <span className="ml-auto font-mono text-[10px] text-fg-4">{exps.length}</span>
            </button>
            {!isClosed && (
              <div className="ml-[13px] border-l border-line pl-1.5">
                {prog > 0 && prog < 1 && <Meter value={prog} className="mb-1 ml-1.5 w-[calc(100%-12px)]" height={2} />}
                {exps.map((e) => {
                  const on = sel?.kind === "experiment" && sel.id === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => select({ kind: "experiment", id: e.id })}
                      className={cn("flex w-full items-center gap-2 rounded px-1.5 py-[3px] text-left", on ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")}
                    >
                      <Dot tone={e.status === "running" ? "signal" : e.status === "cancelled" ? "amber" : EXP_KIND[e.kind].tone} pulse={e.status === "running"} size={5} />
                      <span className="shrink-0 font-mono text-[10px] text-fg-4">{e.id}</span>
                      <span className={cn("truncate text-[11.5px]", on ? "text-fg" : "text-fg-2")}>{e.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {manual.length > 0 && (
        <div className="mt-1 px-1.5">
          <Label className="mb-1">Analyst probes</Label>
          {manual.map((e) => (
            <button key={e.id} type="button" onClick={() => select({ kind: "experiment", id: e.id })} className="flex w-full items-center gap-2 rounded px-1.5 py-[3px] text-left hover:bg-white/[0.03]">
              <Dot tone="coral" size={5} />
              <span className="shrink-0 font-mono text-[10px] text-fg-4">{e.id}</span>
              <span className="truncate text-[11.5px] text-fg-2">{e.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
