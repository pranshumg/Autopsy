"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, Download, FlaskConical, Search, X } from "lucide-react";
import type { InvestigationState, Rule } from "@/lib/types";
import { useLab } from "@/lib/store";
import { cn, fmtDuration, fmtOutput } from "@/lib/format";
import { OriginChip } from "@/components/target-bits";
import { exportMarkdown, useFocusRule } from "./rulebook";
import { useVerify, verificationsFor } from "./verify";

/** The finding the demo walks through: strongest supported, non-null rule. */
export function strongestFinding(inv: InvestigationState): Rule | undefined {
  const rank = { strong: 2, moderate: 1, weak: 0 } as const;
  return inv.report?.rules
    .filter((r) => r.kind !== "null")
    .slice()
    .sort((a, b) => rank[b.strength] - rank[a.strength] || Number(!!b.confirmed) - Number(!!a.confirmed) || b.confidence - a.confidence)[0];
}

function useElapsed(inv: InvestigationState): number | null {
  const live = inv.status === "running" || inv.status === "paused";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const start = inv.tasks[0]?.startedAt ?? inv.logs[0]?.t;
  if (!start) return null;
  const end = live ? now : (inv.tasks.at(-1)?.endedAt ?? inv.logs.at(-1)?.t ?? start);
  return Math.max(0, end - start);
}

export function DemoBar({ inv }: { inv: InvestigationState }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [inspected, setInspected] = useState(false);
  const [exported, setExported] = useState(false);
  const focus = useFocusRule((s) => s.focus);
  const openTest = useVerify((s) => s.open);
  const create = useLab((s) => s.create);
  const start = useLab((s) => s.start);
  const elapsed = useElapsed(inv);
  const top = useMemo(() => strongestFinding(inv), [inv]);
  const supported = inv.hypotheses.filter((h) => h.status === "supported");
  const latest = supported.at(-1);
  const done = !!inv.report;
  const tested = top ? verificationsFor(inv, top.id).length > 0 : false;
  const running = inv.status === "running" || inv.status === "paused";
  if (hidden) return null;

  const inspect = () => {
    if (!top) return;
    setInspected(true);
    focus(top.id);
    router.push(`/lab/${inv.id}/rulebook`);
  };
  const test = () => {
    if (!top) return;
    focus(top.id);
    router.push(`/lab/${inv.id}/rulebook`);
    openTest(top.id);
  };
  const liveRun = () => {
    const id = create({ target: inv.target, budget: inv.budget.limit, pace: "standard", guided: true });
    start(id);
    router.push(`/lab/${id}`);
  };

  const steps = [
    { label: "Choose target", done: true },
    { label: running ? `Investigating · ${inv.phase ?? "starting"}` : inv.status === "idle" ? "Investigate" : done ? "Investigated" : `Stopped (${inv.status})`, done, active: running || inv.status === "idle" },
    { label: "Inspect strongest finding", done: inspected, active: done && !inspected, action: done && top ? inspect : undefined, icon: Search },
    { label: "Test it live", done: tested, active: done && inspected && !tested, action: done && top && !inv.saved ? test : undefined, icon: FlaskConical },
    { label: "Export evidence", done: exported, active: done && tested && !exported, action: done ? () => (exportMarkdown(inv), setExported(true)) : undefined, icon: Download },
  ];
  const fid = inv.surrogate?.fidelity;

  return (
    <div className="relative z-20 shrink-0 border-b border-line bg-ink-900/80 px-3 py-2 backdrop-blur md:px-4" role="region" aria-label="Guided demo">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal">Guided demo</span>
        <ol className="flex flex-wrap items-center gap-1.5">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const body = (
              <>
                <span className={cn("flex h-4 w-4 items-center justify-center rounded-full font-mono text-[9px]", s.done ? "bg-truth text-ink-950" : s.active ? "bg-signal text-ink-950" : "bg-ink-700 text-fg-3")}>{s.done ? <Check size={10} /> : i + 1}</span>
                {Icon && !s.done && <Icon size={11} />}
                {s.label}
              </>
            );
            return (
              <li key={s.label}>
                {s.action ? (
                  <button type="button" onClick={s.action} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors", s.active ? "border-signal/50 bg-signal/10 text-fg" : "border-line-2 text-fg-2 hover:border-line-3 hover:text-fg")}>
                    {body}
                  </button>
                ) : (
                  <span className={cn("inline-flex h-7 items-center gap-1.5 px-1 text-[12px]", s.done ? "text-fg-2" : s.active ? "text-fg" : "text-fg-4")}>{body}</span>
                )}
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={() => setHidden(true)} className="ml-auto rounded p-1 text-fg-4 hover:text-fg" aria-label="Hide guided demo bar">
          <X size={13} />
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-fg-3">
        <OriginChip target={inv.target} inv={inv} />
        <span>
          queries <b className="font-medium text-fg">{inv.budget.used}</b>/{inv.budget.limit}
          {inv.budget.requests !== undefined && <span className="text-fg-4"> · {inv.budget.requests} HTTP requests</span>}
        </span>
        <span>elapsed {elapsed === null ? "—" : <b className="font-medium text-fg">{fmtDuration(elapsed)}</b>}{inv.saved && " (when recorded)"}</span>
        <span>
          supported findings <b className="font-medium text-fg">{supported.length}</b>
        </span>
        <span>
          held-out error{" "}
          {fid ? (
            <b className="font-medium text-fg">
              RMSE {fmtOutput(inv.target.output, fid.rmse)} · R² {fid.r2.toFixed(2)}
            </b>
          ) : (
            "—"
          )}
          {fid && <span className="text-fg-4"> ({inv.surrogate?.evaluatedOn === "test" ? "sealed test" : "validation, interim"})</span>}
        </span>
        {inv.saved && (
          <button type="button" onClick={liveRun} className="text-signal hover:underline">
            Start a live run of this target →
          </button>
        )}
      </div>
      {running && latest && (
        <div className="mt-1 truncate text-[12px] text-fg-2" aria-live="polite">
          <span className="font-mono text-[10px] text-truth">{latest.id} supported</span> {latest.statement}
        </div>
      )}
    </div>
  );
}
