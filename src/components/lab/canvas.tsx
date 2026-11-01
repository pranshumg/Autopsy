"use client";

import {
  BaseEdge,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Boxes, Crosshair, Maximize2, Minus, Plus } from "lucide-react";
import { AGENTS, type AgentId, type AgentRuntime, type AgentTask, type Feature, type Hypothesis, type InvestigationState } from "@/lib/types";
import { cn, fmtFeature } from "@/lib/format";
import { AGENT_META, H_KIND, H_STATUS } from "@/components/meta";
import { Chip, Dot, Ring, toneVar } from "@/components/ui";
import { useSelection, type Selection } from "./context";

// ── node data ───────────────────────────────────────────────────────────────

type FeatureStatus = "untested" | "testing" | "effect" | "null" | "inconclusive";
type FeatureData = { f: Feature; status: FeatureStatus; magnitude: number; importance: number; active: boolean; dim: boolean; selected: boolean };
type TargetData = { inv: InvestigationState; active: boolean; dim: boolean; selected: boolean; activity: string | null };
type AgentData = { id: AgentId; rt: AgentRuntime; task?: AgentTask; dim: boolean; selected: boolean };
type HypData = { h: Hypothesis; dim: boolean; selected: boolean; fresh: boolean };
type SinkData = { kind: "surrogate" | "report"; inv: InvestigationState; dim: boolean; selected: boolean };

const card = "rounded-lg border bg-ink-900/95 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.8)] transition-[opacity,border-color,box-shadow] duration-300";

const FeatureNode = memo(function FeatureNode({ data }: NodeProps<Node<FeatureData>>) {
  const { f, status } = data;
  const tone = status === "effect" ? "truth" : status === "testing" ? "signal" : status === "inconclusive" ? "amber" : "neutral";
  return (
    <div
      className={cn(card, "w-[210px] px-3 py-2.5", data.selected ? "border-signal shadow-[0_0_0_3px_rgb(78_225_240/0.12)]" : data.active ? "border-signal/60" : "border-line-2", data.dim && "opacity-30")}
    >
      <div className="flex items-center gap-2">
        <Dot tone={tone} pulse={data.active} />
        <span className={cn("truncate text-[12.5px] font-medium", status === "null" ? "text-fg-3 line-through decoration-fg-4" : "text-fg")}>{f.label}</span>
        <span className="ml-auto font-mono text-[9px] uppercase text-fg-4">{f.kind === "numeric" ? "num" : `${f.levels.length} lv`}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="truncate font-mono text-[10px] text-fg-3">
          {f.kind === "numeric" ? `${fmtFeature(f, f.min)} – ${fmtFeature(f, f.max)}` : f.levels.join(" · ").replace(/_/g, " ")}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.06]" title="Share of surrogate model importance">
          <div className="h-full rounded-full bg-model transition-[width] duration-700" style={{ width: `${Math.round(data.importance * 100)}%` }} />
        </div>
        <span className="w-[54px] text-right font-mono text-[9px] uppercase tracking-wide" style={{ color: toneVar[tone] }}>
          {status === "null" ? "ignored" : status}
        </span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

const TargetNode = memo(function TargetNode({ data }: NodeProps<Node<TargetData>>) {
  const { inv } = data;
  const recent = inv.observations.slice(-96);
  const ys = recent.map((o) => o.output);
  const lo = Math.min(...ys, inv.target.output.min);
  const hi = Math.max(...ys, lo + 1);
  const lastId = recent.at(-1)?.id;
  return (
    <div
      className={cn(
        "relative w-[300px] overflow-hidden rounded-xl border bg-[radial-gradient(120%_80%_at_50%_0%,#12161d_0%,#06070a_70%)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.04)] transition-[border-color,opacity] duration-300",
        data.selected ? "border-signal" : data.active ? "border-signal/50" : "border-line-3",
        data.dim && "opacity-40",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="target" id="top" position={Position.Top} isConnectable={false} />
      <Handle type="source" id="out" position={Position.Right} isConnectable={false} />
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-fg-3">Black box</span>
        <span className="ml-auto font-mono text-[9px] text-fg-4">{inv.target.version}</span>
      </div>
      <div className="px-3 pt-3">
        <div className="text-[15px] font-semibold tracking-tight text-fg">{inv.target.name}</div>
        <div className="mt-0.5 font-mono text-[10px] text-fg-3">POST {inv.target.endpoint.replace("/api", "")}</div>
      </div>
      <div className="relative mx-3 mt-3 grid grid-cols-16 gap-[3px] rounded-md border border-line bg-ink-950/80 p-2" aria-label="Most recent responses">
        {Array.from({ length: 96 }).map((_, i) => {
          const o = recent[i];
          const t = o ? (o.output - lo) / (hi - lo || 1) : 0;
          return (
            <span
              key={i}
              className={cn("aspect-square rounded-[2px] transition-colors duration-500", o?.id === lastId && "ring-1 ring-truth")}
              style={{ background: o ? `color-mix(in oklab, var(--color-signal) ${Math.round(18 + t * 82)}%, #0b0d11)` : "rgb(255 255 255 / 0.03)" }}
            />
          );
        })}
        {data.active && <div className="pointer-events-none absolute inset-x-0 top-0 h-6 animate-scan bg-gradient-to-b from-transparent via-signal/15 to-transparent" />}
      </div>
      <div className="grid grid-cols-3 gap-px px-3 pb-3 pt-2.5">
        {[
          ["queries", inv.budget.used.toLocaleString()],
          ["experiments", String(inv.experiments.length)],
          ["output", inv.target.output.unit],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="font-mono text-[13px] text-fg">{v}</div>
            <div className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-fg-4">{k}</div>
          </div>
        ))}
      </div>
      {data.activity && (
        <div className="border-t border-line bg-signal/[0.04] px-3 py-1.5 font-mono text-[10px] text-signal">
          <span className="animate-blink">▍</span> {data.activity}
        </div>
      )}
    </div>
  );
});

const AgentNode = memo(function AgentNode({ data }: NodeProps<Node<AgentData>>) {
  const m = AGENT_META[data.id];
  const Icon = m.icon;
  const working = data.rt.status === "working";
  return (
    <div
      className={cn(card, "w-[220px] px-3 py-2.5", data.selected ? "border-current" : working ? "border-current/50" : "border-line-2", data.dim && "opacity-35")}
      style={{ color: m.color }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <Handle type="source" id="bottom" position={Position.Bottom} isConnectable={false} />
      <Handle type="target" id="bottom-in" position={Position.Bottom} isConnectable={false} style={{ left: "70%" }} />
      <div className="flex items-center gap-2.5">
        <span className={cn("relative flex h-8 w-8 items-center justify-center rounded-md border border-current/30 bg-current/10")}>
          <Icon size={15} strokeWidth={1.7} />
          {working && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse-dot rounded-full bg-current" />}
        </span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-fg">{m.name}</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-fg-3">{data.rt.status}</div>
        </div>
        <span className="ml-auto font-mono text-[10px] text-fg-3">{data.rt.completed} tasks</span>
      </div>
      <div className="mt-2 h-[30px] overflow-hidden text-[11px] leading-[15px] text-fg-2">
        {data.task && data.task.status === "running" ? data.task.title : <span className="text-fg-4">{data.rt.status === "done" ? "All tasks complete" : "Awaiting handoff"}</span>}
      </div>
    </div>
  );
});

const HypNode = memo(function HypNode({ data }: NodeProps<Node<HypData>>) {
  const { h } = data;
  const st = H_STATUS[h.status];
  return (
    <div
      className={cn(
        card,
        "w-[300px] px-3 py-2",
        data.selected ? "border-model shadow-[0_0_0_3px_rgb(162_141_255/0.14)]" : h.status === "supported" ? "border-truth/35" : h.status === "rejected" ? "border-alert/25" : "border-line-2",
        data.dim && "opacity-25",
        data.fresh && "animate-rise",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded border border-line-2 font-mono text-[11px] text-fg-2" title={H_KIND[h.kind].label}>
          {H_KIND[h.kind].glyph}
        </span>
        <span className="font-mono text-[10px] text-fg-3">{h.id}</span>
        <Chip tone={st.tone}>{st.label}</Chip>
        <span className="ml-auto">
          <Ring value={h.confidence} tone={st.tone === "neutral" ? "model" : st.tone} size={22} stroke={2} />
        </span>
      </div>
      <div className={cn("mt-1.5 line-clamp-2 text-[11.5px] leading-[15px]", h.status === "rejected" ? "text-fg-3" : "text-fg")}>{h.statement}</div>
    </div>
  );
});

const SinkNode = memo(function SinkNode({ data }: NodeProps<Node<SinkData>>) {
  const { inv } = data;
  const isS = data.kind === "surrogate";
  const s = inv.surrogate;
  return (
    <div className={cn(card, "w-[230px] px-3 py-3", data.selected ? "border-truth" : "border-line-3", data.dim && "opacity-35")}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flex items-center gap-2">
        {isS ? <Boxes size={14} className="text-model" /> : <BookOpenText size={14} className="text-truth" />}
        <span className="text-[12.5px] font-semibold">{isS ? "Surrogate model" : "Hidden rulebook"}</span>
      </div>
      {isS ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            ["R²", s ? s.fidelity.r2.toFixed(3) : "—"],
            ["leaves", s ? String(s.leaves) : "—"],
            ["ver", s ? `v${s.version}` : "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="font-mono text-[13px] text-fg">{v}</div>
              <div className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-fg-4">{k}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2">
          <div className="font-mono text-[13px] text-fg">{inv.report ? `${inv.report.rules.length} rules` : "compiling…"}</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-fg-4">{inv.report ? "published" : `${inv.hypotheses.filter((h) => h.status === "supported").length} supported so far`}</div>
        </div>
      )}
    </div>
  );
});

const nodeTypes = { feature: FeatureNode, target: TargetNode, agent: AgentNode, hyp: HypNode, sink: SinkNode };

// ── edges ───────────────────────────────────────────────────────────────────

type FlowEdgeData = { color: string; active?: boolean; reverse?: boolean; dashed?: boolean; dim?: boolean; width?: number };

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const reduce = useReducedMotion();
  const [d] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const color = data?.color ?? "var(--color-ink-500)";
  return (
    <>
      <BaseEdge
        id={id}
        path={d}
        style={{
          stroke: color,
          strokeWidth: data?.width ?? 1.2,
          strokeOpacity: data?.dim ? 0.12 : data?.active ? 0.9 : 0.45,
          strokeDasharray: data?.dashed ? "4 4" : undefined,
          transition: "stroke-opacity 300ms",
        }}
      />
      {data?.active && !reduce && (
        <>
          {[0, 0.33, 0.66].map((delay) => (
            <circle key={delay} r={2.4} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
              <animateMotion dur="1.1s" begin={`${delay}s`} repeatCount="indefinite" path={d} keyPoints={data.reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
            </circle>
          ))}
        </>
      )}
    </>
  );
}

const edgeTypes = { flow: FlowEdge };

// ── graph construction ─────────────────────────────────────────────────────

const AGENT_X: Record<AgentId, number> = { persona: 0, experimenter: 290, statistician: 580, reporter: 870 };
const HYP_X = 650;
const HYP_COL = 322;
const HYP_ROWS = 9;

function useNow(active: boolean, ms = 400) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

function featureStatus(inv: InvestigationState, key: string): FeatureStatus {
  const hs = inv.hypotheses.filter((h) => h.features.length === 1 && h.features[0] === key);
  if (hs.some((h) => h.kind === "null" && h.status === "supported")) return "null";
  if (hs.some((h) => h.kind === "effect" && h.status === "supported")) return "effect";
  if (hs.some((h) => h.status === "testing")) return "testing";
  if (hs.some((h) => h.kind === "effect" && h.status === "inconclusive")) return "inconclusive";
  return "untested";
}

function buildGraph(inv: InvestigationState, sel: Selection, now: number) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const feats = inv.target.features;
  const running = inv.status === "running";
  const runningExp = [...inv.experiments].reverse().find((e) => e.status === "running");
  const activeFeatures = new Set(running && runningExp ? runningExp.features : []);
  const recent = running ? inv.handoffs.filter((h) => now - h.t < 1500) : [];
  const isHot = (from: string, to: string) => recent.some((h) => h.from === from && h.to === to);

  // what is related to the selection (for contextual highlighting)
  let focus: Set<string> | null = null;
  if (sel) {
    focus = new Set([`${sel.kind}:${sel.id}`]);
    if (sel.kind === "hypothesis") {
      const h = inv.hypotheses.find((x) => x.id === sel.id);
      h?.features.forEach((k) => focus!.add(`feature:${k}`));
      h?.related.concat(h.competes).forEach((r) => focus!.add(`hypothesis:${r}`));
      focus.add("target:target");
    } else if (sel.kind === "feature") {
      inv.hypotheses.filter((h) => h.features.includes(sel.id)).forEach((h) => focus!.add(`hypothesis:${h.id}`));
      focus.add("target:target");
    } else if (sel.kind === "agent") {
      focus.add("target:target");
    } else {
      focus = null;
    }
  }
  const dimOf = (key: string) => (focus ? !focus.has(key) : false);

  const fy0 = -((feats.length - 1) * 76) / 2;
  feats.forEach((f, i) => {
    const key = `feature:${f.key}`;
    nodes.push({
      id: key,
      type: "feature",
      position: { x: 0, y: fy0 + i * 76 - 34 },
      data: {
        f,
        status: featureStatus(inv, f.key),
        magnitude: 0,
        importance: inv.surrogate?.importance[f.key] ?? 0,
        active: activeFeatures.has(f.key),
        dim: dimOf(key),
        selected: sel?.kind === "feature" && sel.id === f.key,
      } satisfies FeatureData,
    });
    edges.push({
      id: `e-${f.key}`,
      source: key,
      target: "target:target",
      type: "flow",
      data: {
        color: activeFeatures.has(f.key) ? "var(--color-signal)" : featureStatus(inv, f.key) === "effect" ? "var(--color-fg-3)" : "var(--color-ink-500)",
        active: activeFeatures.has(f.key),
        dashed: featureStatus(inv, f.key) === "null",
        dim: focus ? !focus.has(key) : false,
      } satisfies FlowEdgeData,
    });
  });

  const runningTask = (a: AgentId) => inv.tasks.find((t) => t.id === inv.agents[a].currentTaskId);
  const activity = (() => {
    if (!running) return null;
    const t = [...inv.tasks].reverse().find((x) => x.status === "running");
    return t ? `${AGENT_META[t.agent].name} · ${t.title}` : null;
  })();

  nodes.push({
    id: "target:target",
    type: "target",
    position: { x: 290, y: -140 },
    data: { inv, active: running && isHot("experimenter", "target"), dim: dimOf("target:target"), selected: sel?.kind === "target", activity } satisfies TargetData,
  });

  AGENTS.forEach((a) => {
    const key = `agent:${a}`;
    nodes.push({
      id: key,
      type: "agent",
      position: { x: AGENT_X[a], y: -430 },
      data: { id: a, rt: inv.agents[a], task: runningTask(a), dim: dimOf(key), selected: sel?.kind === "agent" && sel.id === a } satisfies AgentData,
    });
  });
  const chain: [AgentId, AgentId][] = [
    ["persona", "experimenter"],
    ["experimenter", "statistician"],
    ["statistician", "reporter"],
  ];
  for (const [a, b] of chain) {
    edges.push({
      id: `a-${a}-${b}`,
      source: `agent:${a}`,
      target: `agent:${b}`,
      type: "flow",
      data: { color: AGENT_META[a].color, active: isHot(a, b) || isHot(b, a), reverse: isHot(b, a) && !isHot(a, b), dim: !!focus && !focus.has(`agent:${a}`) && !focus.has(`agent:${b}`) } satisfies FlowEdgeData,
    });
  }
  edges.push({
    id: "q-out",
    source: "agent:experimenter",
    sourceHandle: "bottom",
    target: "target:target",
    targetHandle: "top",
    type: "flow",
    data: { color: "var(--color-signal)", active: isHot("experimenter", "target"), width: 1.6, dim: !!focus && !focus.has("target:target") } satisfies FlowEdgeData,
  });
  edges.push({
    id: "q-in",
    source: "target:target",
    sourceHandle: "out",
    target: "agent:statistician",
    targetHandle: "bottom-in",
    type: "flow",
    data: { color: "var(--color-model)", active: isHot("target", "experimenter") || isHot("experimenter", "statistician"), width: 1.4, dim: !!focus && !focus.has("target:target") } satisfies FlowEdgeData,
  });

  // hypotheses, newest-last, laid out in columns
  const hyps = inv.hypotheses;
  const perCol = HYP_ROWS;
  const cols = Math.max(1, Math.ceil(hyps.length / perCol));
  hyps.forEach((h, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const inCol = Math.min(perCol, hyps.length - col * perCol);
    const key = `hypothesis:${h.id}`;
    nodes.push({
      id: key,
      type: "hyp",
      position: { x: HYP_X + col * HYP_COL, y: -((inCol - 1) * 80) / 2 + row * 80 - 34 },
      data: { h, dim: dimOf(key), selected: sel?.kind === "hypothesis" && sel.id === h.id, fresh: running && now - h.createdAt < 1200 } satisfies HypData,
    });
    edges.push({
      id: `h-${h.id}`,
      source: "target:target",
      sourceHandle: "out",
      target: key,
      type: "flow",
      data: {
        color: toneVar[H_STATUS[h.status].tone],
        active: running && h.status === "testing",
        dashed: h.status === "rejected" || h.status === "proposed",
        dim: focus ? !focus.has(key) : false,
        width: h.status === "supported" ? 1.4 : 1,
      } satisfies FlowEdgeData,
    });
  });

  const sinkX = HYP_X + cols * HYP_COL + 40;
  nodes.push({
    id: "surrogate:surrogate",
    type: "sink",
    position: { x: sinkX, y: -140 },
    data: { kind: "surrogate", inv, dim: !!focus && !focus.has("surrogate:surrogate"), selected: sel?.kind === "surrogate" } satisfies SinkData,
  });
  nodes.push({
    id: "report:report",
    type: "sink",
    position: { x: sinkX, y: 40 },
    data: { kind: "report", inv, dim: !!focus && !focus.has("report:report"), selected: sel?.kind === "report" } satisfies SinkData,
  });
  edges.push({
    id: "s-fit",
    source: "agent:statistician",
    target: "surrogate:surrogate",
    type: "flow",
    data: { color: "var(--color-model)", dashed: true, active: running && inv.phase === "active", dim: !!focus } satisfies FlowEdgeData,
  });
  edges.push({
    id: "r-pub",
    source: "agent:reporter",
    target: "report:report",
    type: "flow",
    data: { color: "var(--color-truth)", dashed: !inv.report, active: running && inv.phase === "synthesis", dim: !!focus } satisfies FlowEdgeData,
  });

  return { nodes, edges };
}

// ── component ───────────────────────────────────────────────────────────────

function CanvasInner({ inv }: { inv: InvestigationState }) {
  const selection = useSelection((s) => s.selection);
  const select = useSelection((s) => s.select);
  const running = inv.status === "running";
  const now = useNow(running);
  const graph = useMemo(() => buildGraph(inv, selection, now), [inv, selection, now]);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const dragged = useRef(new Set<string>());
  const onNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChangeBase>[0]) => {
      for (const c of changes) if (c.type === "position" && c.dragging) dragged.current.add(c.id);
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase],
  );
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n) => {
        const p = byId.get(n.id);
        if (!p) return n;
        return { ...p, data: n.data, position: dragged.current.has(n.id) ? p.position : n.position };
      });
    });
  }, [graph.nodes, setNodes]);

  const rf = useReactFlow();
  const interacted = useRef(false);
  const count = graph.nodes.length;
  // Frame the core of the investigation (agents, inputs, target, first hypothesis column)
  // so labels stay legible; the full graph is one "fit" click away.
  const fitCore = useCallback(
    (duration = 600) => {
      const core = graph.nodes.filter((n) => n.type !== "sink" && !(n.type === "hyp" && n.position.x > HYP_X + 1)).map((n) => ({ id: n.id }));
      void rf.fitView({ duration, padding: 0.08, nodes: core, maxZoom: 1 });
    },
    [graph.nodes, rf],
  );
  const fitCoreRef = useRef(fitCore);
  useEffect(() => {
    fitCoreRef.current = fitCore;
  }, [fitCore]);
  const measured = useNodesInitialized();
  useEffect(() => {
    if (interacted.current || !measured) return;
    const t = setTimeout(() => fitCoreRef.current(), 60);
    return () => clearTimeout(t);
  }, [count, measured]);

  const onNodeClick = useCallback(
    (_: unknown, n: Node) => {
      const [kind, id] = n.id.split(":");
      select({ kind: kind as NonNullable<Selection>["kind"], id: kind === "target" ? inv.target.id : id });
    },
    [select, inv.target.id],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={graph.edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => select(null)}
      onMoveStart={(e) => {
        if (e) interacted.current = true;
      }}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.2}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
      aria-label="Investigation canvas"
    >
      <MiniMap
        pannable
        zoomable
        className="!hidden lg:!block"
        maskColor="rgb(6 7 10 / 0.75)"
        nodeColor={(n) => (n.type === "hyp" ? toneVar[H_STATUS[(n.data as HypData).h.status].tone] : n.type === "feature" ? "var(--color-signal)" : n.type === "agent" ? AGENT_META[(n.data as AgentData).id].color : "var(--color-fg-3)")}
        nodeStrokeWidth={0}
        style={{ width: 150, height: 100 }}
      />
      <ZoomControls onFit={() => rf.fitView({ duration: 500, padding: 0.08 })} onCore={() => fitCore(500)} />
    </ReactFlow>
  );
}

function ZoomControls({ onFit, onCore }: { onFit: () => void; onCore: () => void }) {
  const rf = useReactFlow();
  const btn = "flex h-7 w-7 items-center justify-center text-fg-2 hover:bg-white/[0.06] hover:text-fg";
  return (
    <div className="glass absolute bottom-3 left-3 z-10 flex flex-col overflow-hidden rounded-md">
      <button type="button" aria-label="Zoom in" className={btn} onClick={() => rf.zoomIn({ duration: 200 })}>
        <Plus size={13} />
      </button>
      <button type="button" aria-label="Zoom out" className={cn(btn, "border-y border-line")} onClick={() => rf.zoomOut({ duration: 200 })}>
        <Minus size={13} />
      </button>
      <button type="button" aria-label="Fit whole graph to view" title="Fit whole graph" className={cn(btn, "border-b border-line")} onClick={onFit}>
        <Maximize2 size={12} />
      </button>
      <button type="button" aria-label="Focus on the core of the investigation" title="Focus core" className={btn} onClick={onCore}>
        <Crosshair size={12} />
      </button>
    </div>
  );
}

export function InvestigationCanvas({ inv }: { inv: InvestigationState }) {
  return (
    <div className="relative h-full w-full bg-ink-950 bg-dots">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_45%_45%,rgb(78_225_240/0.05),transparent_70%)]" />
      <ReactFlowProvider>
        <CanvasInner inv={inv} />
      </ReactFlowProvider>
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-fg-3">
        <span className="flex items-center gap-1.5">
          <Dot tone="signal" /> inputs
        </span>
        <span className="flex items-center gap-1.5">
          <Dot tone="model" /> testing
        </span>
        <span className="flex items-center gap-1.5">
          <Dot tone="truth" /> supported
        </span>
        <span className="flex items-center gap-1.5">
          <Dot tone="alert" /> rejected
        </span>
      </div>
    </div>
  );
}
