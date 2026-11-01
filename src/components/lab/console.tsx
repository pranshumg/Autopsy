"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import type { InvestigationState, LogLine } from "@/lib/types";
import { cn, fmtDuration, fmtOutput, fmtTime, featureOf, fmtFeature } from "@/lib/format";
import { AGENT_META, SOURCE_COLOR } from "@/components/meta";
import { Dot, Empty, Segmented } from "@/components/ui";
import { useSelection } from "./context";

type Tab = "terminal" | "queries" | "tasks";

const SRC_COLOR: Record<LogLine["source"], string> = {
  system: "var(--color-fg-3)",
  target: "var(--color-signal)",
  persona: AGENT_META.persona.color,
  experimenter: AGENT_META.experimenter.color,
  statistician: AGENT_META.statistician.color,
  reporter: AGENT_META.reporter.color,
};

const LVL_COLOR: Record<LogLine["level"], string> = {
  info: "text-fg-2",
  ok: "text-truth",
  warn: "text-amber",
  error: "text-alert",
  query: "text-fg-3",
};

export function Console({ inv, onCollapse }: { inv: InvestigationState; onCollapse?: () => void }) {
  const [tab, setTab] = useState<Tab>("terminal");
  return (
    <div className="flex h-full flex-col bg-ink-950">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-t border-line px-3">
        <span className="font-mono text-[10px] text-fg-4">04</span>
        <Segmented<Tab>
          label="Console view"
          size="xs"
          value={tab}
          onChange={setTab}
          options={[
            { value: "terminal", label: "Agent terminal" },
            { value: "queries", label: "Query stream" },
            { value: "tasks", label: "Task ledger" },
          ]}
        />
        <span className="ml-auto hidden font-mono text-[10px] text-fg-4 sm:inline">
          {inv.logs.length} events · {inv.observations.length} queries · {inv.tasks.length} tasks
        </span>
        {onCollapse && (
          <button type="button" onClick={onCollapse} className="font-mono text-[10px] uppercase tracking-wider text-fg-3 hover:text-fg" aria-label="Collapse console">
            hide
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "terminal" && <Terminal inv={inv} />}
        {tab === "queries" && <QueryStream inv={inv} />}
        {tab === "tasks" && <TaskLedger inv={inv} />}
      </div>
    </div>
  );
}

function useStickyScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [dep, stuck]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };
  const jump = () => {
    setStuck(true);
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  return { ref, stuck, onScroll, jump };
}

function Terminal({ inv }: { inv: InvestigationState }) {
  const [filter, setFilter] = useState<"all" | LogLine["source"]>("all");
  const lines = useMemo(() => {
    const ls = filter === "all" ? inv.logs : inv.logs.filter((l) => l.source === filter);
    return ls.slice(-400);
  }, [inv.logs, filter]);
  const { ref, stuck, onScroll, jump } = useStickyScroll(lines.length);
  const sources: ("all" | LogLine["source"])[] = ["all", "persona", "experimenter", "statistician", "reporter", "target", "system"];
  return (
    <div className="relative flex h-full">
      <div className="hidden w-[132px] shrink-0 flex-col gap-0.5 border-r border-line p-2 sm:flex" role="radiogroup" aria-label="Filter terminal by source">
        {sources.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={filter === s}
            onClick={() => setFilter(s)}
            className={cn("flex items-center gap-2 rounded px-2 py-1 text-left font-mono text-[10px] uppercase tracking-wider", filter === s ? "bg-white/[0.05] text-fg" : "text-fg-3 hover:text-fg-2")}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s === "all" ? "var(--color-fg-2)" : SRC_COLOR[s] }} />
            {s}
          </button>
        ))}
      </div>
      <div ref={ref} onScroll={onScroll} className="min-w-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[18px]" role="log" aria-live="off" aria-label="Agent terminal">
        {!lines.length && <div className="text-fg-4">$ awaiting investigation start…</div>}
        {lines.map((l) => (
          <div key={l.id} className="flex gap-3 whitespace-pre-wrap hover:bg-white/[0.02]">
            <span className="shrink-0 text-fg-4">{fmtTime(l.t)}</span>
            <span className="w-[86px] shrink-0 uppercase" style={{ color: SRC_COLOR[l.source] }}>
              {l.source}
            </span>
            <span className={cn("min-w-0 break-words", LVL_COLOR[l.level])}>{l.text}</span>
          </div>
        ))}
        {inv.status === "running" && (
          <div className="text-signal">
            <span className="animate-blink">▍</span>
          </div>
        )}
      </div>
      {!stuck && (
        <button type="button" onClick={jump} className="glass absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] text-fg-2 hover:text-fg">
          <ArrowDownToLine size={11} /> follow
        </button>
      )}
    </div>
  );
}

function QueryStream({ inv }: { inv: InvestigationState }) {
  const rows = inv.observations.slice(-150);
  const { ref, stuck, onScroll, jump } = useStickyScroll(rows.length);
  const select = useSelection((s) => s.select);
  const keys = inv.target.features.map((f) => f.key);
  if (!rows.length) return <Empty title="No queries yet" hint="Every request sent to the black box will stream here." />;
  return (
    <div className="relative h-full">
      <div ref={ref} onScroll={onScroll} className="h-full overflow-auto">
        <table className="w-full min-w-[900px] border-collapse font-mono text-[10.5px]">
          <thead className="sticky top-0 z-10 bg-ink-950">
            <tr className="text-left text-fg-4">
              <th className="px-3 py-1.5 font-normal">#</th>
              <th className="px-2 py-1.5 font-normal">source</th>
              <th className="px-2 py-1.5 font-normal">exp</th>
              {keys.map((k) => (
                <th key={k} className="px-2 py-1.5 font-normal">
                  {k}
                </th>
              ))}
              <th className="px-3 py-1.5 text-right font-normal text-signal">{inv.target.output.key}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-t border-line text-fg-2 hover:bg-white/[0.02]">
                <td className="px-3 py-1 text-fg-4">{o.id}</td>
                <td className="px-2 py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: SOURCE_COLOR[o.source] }} />
                    {o.source}
                  </span>
                </td>
                <td className="px-2 py-1">
                  {o.experimentId && (
                    <button type="button" className="text-fg-3 hover:text-signal" onClick={() => select({ kind: "experiment", id: o.experimentId! })}>
                      {o.experimentId}
                    </button>
                  )}
                </td>
                {keys.map((k) => (
                  <td key={k} className="px-2 py-1 text-fg-3">
                    {fmtFeature(featureOf(inv.target, k), o.input[k])}
                  </td>
                ))}
                <td className="px-3 py-1 text-right text-fg">{fmtOutput(inv.target.output, o.output)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!stuck && (
        <button type="button" onClick={jump} className="glass absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] text-fg-2 hover:text-fg">
          <ArrowDownToLine size={11} /> follow
        </button>
      )}
    </div>
  );
}

function TaskLedger({ inv }: { inv: InvestigationState }) {
  const tasks = [...inv.tasks].reverse().slice(0, 120);
  const select = useSelection((s) => s.select);
  if (!tasks.length) return <Empty title="No agent tasks yet" />;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[820px] border-collapse text-[11px]">
        <thead className="sticky top-0 bg-ink-950 font-mono text-[10px] text-fg-4">
          <tr className="text-left">
            <th className="px-3 py-1.5 font-normal">task</th>
            <th className="px-2 py-1.5 font-normal">agent</th>
            <th className="px-2 py-1.5 font-normal">operation</th>
            <th className="px-2 py-1.5 font-normal">decision</th>
            <th className="px-2 py-1.5 text-right font-normal">queries</th>
            <th className="px-3 py-1.5 text-right font-normal">time</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-t border-line hover:bg-white/[0.02]">
              <td className="px-3 py-1 font-mono text-fg-4">{t.id}</td>
              <td className="px-2 py-1">
                <button type="button" onClick={() => select({ kind: "agent", id: t.agent })} className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase" style={{ color: AGENT_META[t.agent].color }}>
                  <Dot tone={AGENT_META[t.agent].tone} pulse={t.status === "running"} size={5} /> {t.agent}
                </button>
              </td>
              <td className="max-w-[320px] truncate px-2 py-1 text-fg-2">{t.title}</td>
              <td className="max-w-[320px] truncate px-2 py-1 text-fg-3">{t.decision ?? (t.status === "running" ? "…" : "")}</td>
              <td className="px-2 py-1 text-right font-mono text-fg-3">{t.queries || ""}</td>
              <td className="px-3 py-1 text-right font-mono text-fg-4">{t.endedAt ? fmtDuration(t.endedAt - t.startedAt) : "running"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
