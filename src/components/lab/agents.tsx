"use client";

import { scaleLinear } from "d3-scale";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Info, Minus, Plus } from "lucide-react";
import { AGENTS, PHASES, type AgentId, type AgentTask, type Handoff, type InvestigationState } from "@/lib/types";
import { cn, fmtDuration } from "@/lib/format";
import { AGENT_META, H_STATUS } from "@/components/meta";
import { Chip, Dot, Empty, Label, Segmented, Tip } from "@/components/ui";
import { useSize } from "@/components/viz/core";
import { SelectLink } from "./inspector";

type Node = { x: number; y: number };
const POS: Record<AgentId | "target" | "hub", Node> = {
  persona: { x: 150, y: 250 },
  experimenter: { x: 420, y: 110 },
  statistician: { x: 700, y: 250 },
  reporter: { x: 880, y: 440 },
  target: { x: 420, y: 450 },
  hub: { x: 560, y: 300 },
};

const ROUTES: { key: string; from: keyof typeof POS; to: keyof typeof POS; bend: number; label: string }[] = [
  { key: "persona>experimenter", from: "persona", to: "experimenter", bend: -60, label: "subjects" },
  { key: "experimenter>target", from: "experimenter", to: "target", bend: -46, label: "queries" },
  { key: "target>experimenter", from: "target", to: "experimenter", bend: -46, label: "responses" },
  { key: "experimenter>statistician", from: "experimenter", to: "statistician", bend: -60, label: "observations" },
  { key: "statistician>experimenter", from: "statistician", to: "experimenter", bend: -60, label: "designs" },
  { key: "statistician>reporter", from: "statistician", to: "reporter", bend: -50, label: "findings" },
];

function curve(a: Node, b: Node, bend: number) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;
}

type Packet = { id: string; route: string; color: string; count?: number };

function Constellation({ inv, selected, onSelect }: { inv: InvestigationState; selected: AgentId; onSelect: (a: AgentId) => void }) {
  const reduce = useReducedMotion();
  const [packets, setPackets] = useState<Packet[]>([]);
  const seen = useRef<number>(inv.handoffs.length);
  const [ref, { width }] = useSize<HTMLDivElement>();

  useEffect(() => {
    const fresh = inv.handoffs.slice(seen.current);
    seen.current = inv.handoffs.length;
    if (reduce || !fresh.length || inv.status !== "running") return;
    const next: Packet[] = fresh.slice(-10).map((h: Handoff) => ({
      id: h.id,
      route: `${h.from}>${h.to}`,
      color: h.from === "target" ? "var(--color-signal)" : AGENT_META[h.from].color,
      count: h.count,
    }));
    setPackets((p) => [...p, ...next].slice(-24));
    const ids = new Set(next.map((p) => p.id));
    const t = setTimeout(() => setPackets((p) => p.filter((x) => !ids.has(x.id))), 1300);
    return () => clearTimeout(t);
  }, [inv.handoffs, inv.status, reduce]);

  const recentRoutes = useMemo(() => {
    const now = inv.handoffs.at(-1)?.t ?? 0;
    return new Set(inv.handoffs.filter((h) => now - h.t < 2500).map((h) => `${h.from}>${h.to}`));
  }, [inv.handoffs]);

  const hypCounts = (["supported", "testing", "rejected"] as const).map((s) => inv.hypotheses.filter((h) => h.status === s).length);
  const scale = width ? Math.min(1, width / 1000) : 1;

  return (
    <div ref={ref} className="relative w-full" style={{ height: 560 * scale }}>
      <svg viewBox="0 0 1000 560" width="100%" height="100%" role="img" aria-label="Agent system diagram">
        <defs>
          <radialGradient id="hubGlow">
            <stop offset="0%" stopColor="rgb(162 141 255 / 0.25)" />
            <stop offset="100%" stopColor="rgb(162 141 255 / 0)" />
          </radialGradient>
          <pattern id="boxHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(160 178 205 / 0.08)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* blackboard links: every agent reads/writes shared investigation state */}
        {AGENTS.map((a) => (
          <line key={a} x1={POS[a].x} y1={POS[a].y} x2={POS.hub.x} y2={POS.hub.y} stroke="var(--color-line-2)" strokeDasharray="2 5" />
        ))}

        {ROUTES.map((r) => {
          const hot = inv.status === "running" && recentRoutes.has(r.key);
          const d = curve(POS[r.from], POS[r.to], r.bend);
          const col = r.from === "target" ? "var(--color-signal)" : AGENT_META[r.from as AgentId].color;
          return (
            <g key={r.key}>
              <path id={`route-${r.key}`} d={d} fill="none" stroke={col} strokeOpacity={hot ? 0.75 : 0.2} strokeWidth={hot ? 1.6 : 1} style={{ transition: "stroke-opacity 400ms" }} />
              <text dy={-4} className="font-mono" fontSize={9.5} fill={hot ? col : "var(--color-fg-4)"} letterSpacing="0.08em">
                <textPath href={`#route-${r.key}`} startOffset="50%" textAnchor="middle">
                  {r.label.toUpperCase()}
                </textPath>
              </text>
            </g>
          );
        })}

        {packets.map((p) => {
          const r = ROUTES.find((x) => x.key === p.route);
          if (!r) return null;
          return <PacketDot key={p.id} d={curve(POS[r.from], POS[r.to], r.bend)} color={p.color} big={(p.count ?? 0) > 12} />;
        })}

        {/* shared state hub */}
        <circle cx={POS.hub.x} cy={POS.hub.y} r={70} fill="url(#hubGlow)" />
        <circle cx={POS.hub.x} cy={POS.hub.y} r={34} fill="var(--color-ink-900)" stroke="var(--color-line-3)" />
        <text x={POS.hub.x} y={POS.hub.y - 6} textAnchor="middle" className="font-mono" fontSize={8} fill="var(--color-fg-4)" letterSpacing="0.14em">
          STATE
        </text>
        <text x={POS.hub.x} y={POS.hub.y + 9} textAnchor="middle" className="font-mono" fontSize={11} fill="var(--color-fg-2)">
          {inv.observations.length}·{inv.experiments.length}·{inv.hypotheses.length}
        </text>
        <text x={POS.hub.x} y={POS.hub.y + 52} textAnchor="middle" className="font-mono" fontSize={8.5} fill="var(--color-fg-4)">
          obs · exps · hyps
        </text>

        {/* target */}
        <g transform={`translate(${POS.target.x - 70},${POS.target.y - 42})`}>
          <rect width={140} height={84} rx={8} fill="var(--color-ink-950)" stroke="var(--color-line-3)" />
          <rect width={140} height={84} rx={8} fill="url(#boxHatch)" />
          <text x={70} y={28} textAnchor="middle" className="font-mono" fontSize={8.5} fill="var(--color-fg-3)" letterSpacing="0.16em">
            BLACK BOX
          </text>
          <text x={70} y={48} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--color-fg)">
            {inv.target.name.split(" ").slice(0, 2).join(" ")}
          </text>
          <text x={70} y={66} textAnchor="middle" className="font-mono" fontSize={10} fill="var(--color-signal)">
            {inv.budget.used} queries
          </text>
        </g>

        {AGENTS.map((a) => {
          const m = AGENT_META[a];
          const rt = inv.agents[a];
          const task = inv.tasks.find((t) => t.id === rt.currentTaskId);
          const on = selected === a;
          const working = rt.status === "working";
          const Icon = m.icon;
          return (
            <g
              key={a}
              transform={`translate(${POS[a].x},${POS[a].y})`}
              onClick={() => onSelect(a)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(a))}
              role="button"
              tabIndex={0}
              aria-label={`${m.name} agent, ${rt.status}`}
              aria-pressed={on}
              style={{ cursor: "pointer", color: m.color }}
              className="outline-none [&:focus-visible>circle:first-child]:stroke-signal"
            >
              <circle r={on ? 58 : 52} fill="none" stroke={m.color} strokeOpacity={on ? 0.5 : 0.12} strokeDasharray={working ? "3 6" : undefined} className={working && !reduce ? "origin-center animate-[spin_6s_linear_infinite]" : undefined} style={{ transformBox: "fill-box" }} />
              <circle r={42} fill="var(--color-ink-900)" stroke={m.color} strokeOpacity={on ? 0.9 : 0.4} strokeWidth={on ? 1.6 : 1} />
              {working && <circle r={42} fill={m.color} fillOpacity={0.08} />}
              <Icon x={-11} y={-20} width={22} height={22} strokeWidth={1.6} />
              <text y={18} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--color-fg)">
                {m.name}
              </text>
              <text y={70} textAnchor="middle" className="font-mono" fontSize={9} fill={working ? m.color : "var(--color-fg-4)"} letterSpacing="0.12em">
                {rt.status.toUpperCase()} · {rt.completed}
              </text>
              {task && (
                <foreignObject x={-110} y={78} width={220} height={34}>
                  <div className="line-clamp-2 text-center text-[10.5px] leading-[14px] text-fg-2">{task.title}</div>
                </foreignObject>
              )}
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute left-4 top-3 font-mono text-[10px] text-fg-4">
        <span className="text-truth">{hypCounts[0]}</span> supported · <span className="text-model">{hypCounts[1]}</span> testing · <span className="text-alert">{hypCounts[2]}</span> rejected
      </div>
    </div>
  );
}

function PacketDot({ d, color, big }: { d: string; color: string; big: boolean }) {
  const ref = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => {
    ref.current?.beginElement();
  }, []);
  return (
    <circle r={big ? 4.5 : 3.2} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      <animateMotion ref={ref} dur="1.1s" begin="indefinite" fill="freeze" path={d} calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" keyPoints="0;1" />
    </circle>
  );
}

function AgentPanel({ inv, agent, task, onTask }: { inv: InvestigationState; agent: AgentId; task: string | null; onTask: (id: string | null) => void }) {
  const m = AGENT_META[agent];
  const rt = inv.agents[agent];
  const tasks = useMemo(() => inv.tasks.filter((t) => t.agent === agent).reverse(), [inv.tasks, agent]);
  const sent = inv.handoffs.filter((h) => h.from === agent).length;
  const recv = inv.handoffs.filter((h) => h.to === agent).length;
  const busy = tasks.reduce((s, t) => s + ((t.endedAt ?? inv.updatedAt) - t.startedAt), 0);
  const [tab, setTab] = useState<"tasks" | "outputs">("tasks");
  const Icon = m.icon;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4" style={{ color: m.color }}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-current/30 bg-current/10">
            <Icon size={19} strokeWidth={1.6} />
          </span>
          <div>
            <div className="text-lg font-semibold text-fg">{m.name} agent</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3">{m.role}</div>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
            <Dot tone={rt.status === "working" ? m.tone : rt.status === "error" ? "alert" : "neutral"} pulse={rt.status === "working"} />
            {rt.status}
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-fg-2">{m.blurb}</p>
        <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-md border border-line bg-line text-fg">
          {[
            ["tasks", rt.completed],
            ["busy", fmtDuration(busy)],
            ["sent", sent],
            ["received", recv],
          ].map(([k, v]) => (
            <div key={k} className="bg-ink-900 px-2.5 py-2">
              <div className="font-mono text-sm">{v}</div>
              <div className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-fg-4">{k}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <Segmented
          label="Agent detail view"
          size="xs"
          value={tab}
          onChange={setTab}
          options={[
            { value: "tasks", label: `Operations (${tasks.length})` },
            { value: "outputs", label: "Artifacts" },
          ]}
        />
        <Tip content="Agents are deterministic statistical procedures. This log records the operations they executed — their inputs, outputs and the rule-based decision taken — not free-form reasoning.">
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-wider text-fg-4">
            <Info size={11} /> observable ops only
          </span>
        </Tip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "tasks" ? (
          tasks.length ? (
            <ul>
              {tasks.map((t) => (
                <TaskRow key={t.id} t={t} inv={inv} open={task === t.id} onToggle={() => onTask(task === t.id ? null : t.id)} />
              ))}
            </ul>
          ) : (
            <Empty title="No operations yet" hint="This agent has not been handed any work." />
          )
        ) : (
          <Artifacts inv={inv} agent={agent} />
        )}
      </div>
    </div>
  );
}

function TaskRow({ t, inv, open, onToggle }: { t: AgentTask; inv: InvestigationState; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  return (
    <li ref={ref} className={cn("border-b border-line", open && "bg-white/[0.02]")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-white/[0.02]">
        <ChevronRight size={12} className={cn("mt-1 shrink-0 text-fg-4 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-fg-4">{t.id}</span>
            <Chip tone={t.status === "running" ? "signal" : t.status === "done" ? "neutral" : "amber"}>{t.status}</Chip>
            <span className="ml-auto font-mono text-[10px] text-fg-4">{t.endedAt ? fmtDuration(t.endedAt - t.startedAt) : "…"}</span>
          </span>
          <span className="mt-1 block text-[12.5px] text-fg">{t.title}</span>
          {t.decision && !open && <span className="mt-0.5 block truncate text-[11.5px] text-fg-3">→ {t.decision}</span>}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-1.5 px-4 pb-3 pl-[38px] text-[11.5px]">
              <dt className="label-mono pt-0.5">phase</dt>
              <dd className="text-fg-2">{PHASES.find((p) => p.id === t.phase)?.label}</dd>
              <dt className="label-mono pt-0.5">input</dt>
              <dd className="text-fg-2">{t.inputs}</dd>
              {t.outputs && (
                <>
                  <dt className="label-mono pt-0.5">output</dt>
                  <dd className="font-mono text-[11px] text-fg-2">{t.outputs}</dd>
                </>
              )}
              {t.decision && (
                <>
                  <dt className="label-mono pt-0.5">decision</dt>
                  <dd className="text-fg">{t.decision}</dd>
                </>
              )}
              {t.queries > 0 && (
                <>
                  <dt className="label-mono pt-0.5">queries</dt>
                  <dd className="font-mono text-signal">{t.queries}</dd>
                </>
              )}
              {!!t.experimentIds?.length && (
                <>
                  <dt className="label-mono pt-0.5">experiments</dt>
                  <dd className="flex flex-wrap gap-1">
                    {t.experimentIds.map((id) => (
                      <a key={id} href={`/lab/${inv.id}/experiments?e=${id}`} className="font-mono text-[11px] text-signal hover:underline">
                        {id}
                      </a>
                    ))}
                  </dd>
                </>
              )}
              {!!t.hypothesisIds?.length && (
                <>
                  <dt className="label-mono pt-0.5">hypotheses</dt>
                  <dd className="flex flex-wrap gap-1">
                    {t.hypothesisIds.slice(0, 12).map((id) => (
                      <a key={id} href={`/lab/${inv.id}/hypotheses?h=${id}`} className="font-mono text-[11px] text-model hover:underline">
                        {id}
                      </a>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function Artifacts({ inv, agent }: { inv: InvestigationState; agent: AgentId }) {
  if (agent === "persona") {
    const ids = [...new Set(inv.observations.map((o) => o.personaId).filter(Boolean))] as string[];
    return (
      <div className="p-4">
        <Label className="mb-2">{ids.length} synthetic personas in use</Label>
        <div className="flex flex-wrap gap-1">
          {ids.map((id) => (
            <span key={id} className="rounded border border-signal/20 bg-signal/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-signal">
              {id}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (agent === "experimenter")
    return (
      <ul>
        {inv.experiments.map((e) => (
          <li key={e.id} className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs">
            <span className="font-mono text-[10px] text-fg-4">{e.id}</span>
            <span className="truncate text-fg-2">{e.title}</span>
            <span className="ml-auto font-mono text-[10px] text-signal">{e.observationIds.length}q</span>
          </li>
        ))}
      </ul>
    );
  if (agent === "statistician")
    return (
      <ul>
        {inv.hypotheses.map((h) => (
          <li key={h.id} className="border-b border-line px-4 py-2">
            <SelectLink sel={{ kind: "hypothesis", id: h.id }} className="flex w-full items-start gap-2 text-xs">
              <Dot tone={H_STATUS[h.status].tone} className="mt-1.5" />
              <span className="text-fg-2">
                <span className="mr-1 font-mono text-fg-4">{h.id}</span>
                {h.statement}
              </span>
            </SelectLink>
          </li>
        ))}
      </ul>
    );
  return inv.report ? (
    <ul>
      {inv.report.rules.map((r) => (
        <li key={r.id} className="border-b border-line px-4 py-2 text-xs">
          <span className="mr-2 font-mono text-[10px] text-truth">{r.id}</span>
          <span className="text-fg-2">{r.statement}</span>
        </li>
      ))}
    </ul>
  ) : (
    <Empty title="Rulebook not yet compiled" hint="The reporter works during synthesis, after the statistician hands over supported findings." />
  );
}

function Timeline({ inv, selectedTask, onTask }: { inv: InvestigationState; selectedTask: string | null; onTask: (t: AgentTask) => void }) {
  const [zoom, setZoom] = useState(1);
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<AgentTask | null>(null);
  const tasks = inv.tasks;
  const t0 = tasks[0]?.startedAt ?? inv.createdAt;
  const live = inv.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [live]);
  const t1 = live ? now : Math.max(t0 + 1000, ...tasks.map((t) => t.endedAt ?? t.startedAt));
  const W = Math.max(width, 300) * zoom;
  const laneH = 34;
  const top = 22;
  const H = top + AGENTS.length * laneH + 8;
  const x = scaleLinear().domain([t0, t1]).range([110, W - 12]);
  const phaseStarts = PHASES.map((p) => ({ p, t: tasks.find((t) => t.phase === p.id)?.startedAt })).filter((p) => p.t !== undefined) as { p: (typeof PHASES)[number]; t: number }[];
  const handoffs = inv.handoffs.filter((h) => h.from !== "target" && h.to !== "target");

  useEffect(() => {
    if (live && ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [live, now, ref]);

  if (!tasks.length) return <Empty title="Timeline is empty" hint="Agent operations appear here as soon as the investigation starts." />;

  return (
    <div className="relative">
      <div className="absolute right-3 top-0 z-10 flex items-center gap-1">
        <button type="button" aria-label="Zoom timeline out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 2))} className="rounded p-1 text-fg-3 hover:bg-white/[0.05] hover:text-fg disabled:opacity-30">
          <Minus size={12} />
        </button>
        <span className="w-8 text-center font-mono text-[10px] text-fg-3">{zoom}×</span>
        <button type="button" aria-label="Zoom timeline in" disabled={zoom >= 16} onClick={() => setZoom((z) => Math.min(16, z * 2))} className="rounded p-1 text-fg-3 hover:bg-white/[0.05] hover:text-fg disabled:opacity-30">
          <Plus size={12} />
        </button>
      </div>
      <div ref={ref} className="overflow-x-auto">
        <svg width={W} height={H} role="img" aria-label="Agent execution timeline" className="block">
          {phaseStarts.map(({ p, t }, i) => {
            const end = phaseStarts[i + 1]?.t ?? t1;
            return (
              <g key={p.id}>
                <rect x={x(t)} y={top - 4} width={Math.max(0, x(end) - x(t))} height={H - top} fill={i % 2 ? "rgb(255 255 255 / 0.012)" : "transparent"} />
                <line x1={x(t)} x2={x(t)} y1={top - 6} y2={H} stroke="var(--color-line-2)" />
                <text x={x(t) + 4} y={12} className="font-mono" fontSize={9} fill="var(--color-fg-4)" letterSpacing="0.1em">
                  {p.short}
                </text>
              </g>
            );
          })}
          {AGENTS.map((a, i) => (
            <g key={a}>
              <line x1={0} x2={W} y1={top + i * laneH + laneH} y2={top + i * laneH + laneH} stroke="var(--color-line)" />
              <text x={10} y={top + i * laneH + laneH / 2 + 3} fontSize={11} fill={AGENT_META[a].color}>
                {AGENT_META[a].name}
              </text>
            </g>
          ))}
          {handoffs.slice(-300).map((h) => {
            const ya = top + AGENTS.indexOf(h.from as AgentId) * laneH + laneH / 2;
            const yb = top + AGENTS.indexOf(h.to as AgentId) * laneH + laneH / 2;
            return <line key={h.id} x1={x(h.t)} x2={x(h.t)} y1={ya} y2={yb} stroke={AGENT_META[h.from as AgentId].color} strokeOpacity={0.35} strokeDasharray="1 2" />;
          })}
          {tasks.map((t) => {
            const lane = AGENTS.indexOf(t.agent);
            const x0 = x(t.startedAt);
            const x1 = x(t.endedAt ?? t1);
            const sel = selectedTask === t.id;
            return (
              <rect
                key={t.id}
                x={x0}
                y={top + lane * laneH + 8}
                width={Math.max(2, x1 - x0)}
                height={laneH - 16}
                rx={3}
                fill={AGENT_META[t.agent].color}
                fillOpacity={t.status === "running" ? 0.9 : sel ? 0.95 : 0.45}
                stroke={sel ? "var(--color-fg)" : "none"}
                onMouseEnter={() => setHover(t)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onTask(t)}
                style={{ cursor: "pointer" }}
              >
                <title>{`${t.id} · ${t.title}`}</title>
              </rect>
            );
          })}
          {live && <line x1={x(now)} x2={x(now)} y1={top - 6} y2={H} stroke="var(--color-signal)" strokeOpacity={0.7} />}
        </svg>
      </div>
      <div className="mt-2 h-5 font-mono text-[10.5px] text-fg-3">
        {hover ? (
          <>
            <span style={{ color: AGENT_META[hover.agent].color }}>{hover.id}</span> · {hover.title} · {hover.endedAt ? fmtDuration(hover.endedAt - hover.startedAt) : "running"}
            {hover.queries ? ` · ${hover.queries} queries` : ""}
          </>
        ) : (
          <span className="text-fg-4">Hover a bar to inspect an operation; click to open it. Dotted ticks are handoffs between agents.</span>
        )}
      </div>
    </div>
  );
}

export function AgentCommand({ inv }: { inv: InvestigationState }) {
  // lab views mount only on the client, so the URL can seed the initial selection
  const [agent, setAgent] = useState<AgentId>(() => {
    const a = new URLSearchParams(window.location.search).get("a");
    return a && (AGENTS as string[]).includes(a) ? (a as AgentId) : "experimenter";
  });
  const [task, setTask] = useState<string | null>(null);
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid min-h-full lg:grid-cols-[1fr_420px]">
        <div className="flex min-w-0 flex-col border-line lg:border-r">
          <div className="flex items-end gap-4 px-5 pb-2 pt-5">
            <div>
              <div className="label-mono">
                <span className="text-signal">[ 02 ]</span> multi-agent command
              </div>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
                Four agents, one <span className="font-serif font-normal italic text-fg-2">shared notebook.</span>
              </h1>
            </div>
          </div>
          <div className="relative border-b border-line bg-dots">
            <Constellation inv={inv} selected={agent} onSelect={(a) => (setAgent(a), setTask(null))} />
          </div>
          <div className="px-5 py-4">
            <Label className="mb-3">Execution history</Label>
            <Timeline
              inv={inv}
              selectedTask={task}
              onTask={(t) => {
                setAgent(t.agent);
                setTask(t.id);
              }}
            />
          </div>
        </div>
        <div className="min-h-[520px] lg:sticky lg:top-0 lg:h-[calc(100dvh-48px)]">
          <AgentPanel inv={inv} agent={agent} task={task} onTask={setTask} />
        </div>
      </div>
    </div>
  );
}
