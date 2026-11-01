"use client";

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Maximize2, Minus, Plus, Scale } from "lucide-react";
import type { Hypothesis, HypothesisStatus, InvestigationState } from "@/lib/types";
import { cn, fmtP, labelOf } from "@/lib/format";
import { EXP_KIND, H_KIND, H_STATUS } from "@/components/meta";
import { Chip, Dot, Empty, Label, PanelHeader, Ring, toneVar } from "@/components/ui";
import { useSize } from "@/components/viz/core";
import { useSelection } from "./context";
import { HypothesisDossier } from "./inspector";

type GNode = SimulationNodeDatum & { id: string; type: "hyp" | "feature" | "exp"; r: number; ref: string };
type GLink = SimulationLinkDatum<GNode> & { kind: "about" | "support" | "conflict" | "related" | "competes" };

const LINK_STYLE: Record<GLink["kind"], { color: string; dash?: string; width: number; label: string }> = {
  about: { color: "var(--color-signal)", width: 0.8, label: "concerns input" },
  support: { color: "var(--color-truth)", width: 0.9, label: "supporting evidence" },
  conflict: { color: "var(--color-alert)", dash: "4 3", width: 1.2, label: "conflicting evidence" },
  related: { color: "var(--color-model)", width: 1, label: "related" },
  competes: { color: "var(--color-amber)", dash: "6 4", width: 1.4, label: "competing explanation" },
};

const ALL_STATUS: HypothesisStatus[] = ["supported", "testing", "proposed", "inconclusive", "rejected"];

export function HypothesisMap({ inv }: { inv: InvestigationState }) {
  const reduce = useReducedMotion();
  const sel = useSelection((s) => s.selection);
  const select = useSelection((s) => s.select);
  const selected = sel?.kind === "hypothesis" ? inv.hypotheses.find((h) => h.id === sel.id) : undefined;
  const [statuses, setStatuses] = useState<Set<HypothesisStatus>>(new Set(ALL_STATUS));
  const [showExps, setShowExps] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [view, setView] = useState({ k: 0.85, x: 0, y: 0 });
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [settled, setSettled] = useState(0);
  const sim = useRef<Simulation<GNode, GLink> | null>(null);
  const simNodes = useRef(new Map<string, GNode>());

  useEffect(() => {
    const h = new URLSearchParams(window.location.search).get("h");
    if (h) select({ kind: "hypothesis", id: h });
  }, [select]);

  const hyps = useMemo(() => inv.hypotheses.filter((h) => statuses.has(h.status)), [inv.hypotheses, statuses]);

  // pure graph structure; the d3 simulation owns positions and publishes snapshots
  const graph = useMemo(() => {
    const nodes: GNode[] = [];
    const links: { source: string; target: string; kind: GLink["kind"] }[] = [];
    const keep = (n: GNode) => n;
    const hypIds = new Set(hyps.map((h) => h.id));
    const usedFeatures = new Set<string>();
    const usedExps = new Set<string>();
    for (const h of hyps) {
      nodes.push(keep({ id: `h:${h.id}`, type: "hyp", r: 9 + h.confidence * 13, ref: h.id }));
      h.features.forEach((f) => {
        usedFeatures.add(f);
        links.push({ source: `h:${h.id}`, target: `f:${f}`, kind: "about" });
      });
      if (showExps) {
        h.evidence.supporting.forEach((e) => {
          usedExps.add(e);
          links.push({ source: `h:${h.id}`, target: `e:${e}`, kind: "support" });
        });
        h.evidence.conflicting.forEach((e) => {
          usedExps.add(e);
          links.push({ source: `h:${h.id}`, target: `e:${e}`, kind: "conflict" });
        });
      }
      h.related.forEach((r) => {
        if (hypIds.has(r) && h.id < r) links.push({ source: `h:${h.id}`, target: `h:${r}`, kind: "related" });
      });
      h.competes.forEach((r) => {
        if (hypIds.has(r) && h.id < r) links.push({ source: `h:${h.id}`, target: `h:${r}`, kind: "competes" });
      });
    }
    for (const f of usedFeatures) nodes.push(keep({ id: `f:${f}`, type: "feature", r: 16, ref: f }));
    for (const e of usedExps) nodes.push(keep({ id: `e:${e}`, type: "exp", r: 5, ref: e }));
    return { nodes, links };
  }, [hyps, showExps]);

  useEffect(() => {
    const s =
      sim.current ??
      forceSimulation<GNode, GLink>()
        .force("charge", forceManyBody<GNode>().strength((n) => (n.type === "exp" ? -50 : -320)))
        .force("collide", forceCollide<GNode>().radius((n) => n.r + (n.type === "feature" ? 40 : n.type === "hyp" ? 22 : 8)))
        .force("x", forceX<GNode>((n) => (n.type === "feature" ? -280 : n.type === "exp" ? 300 : 0)).strength((n) => (n.type === "hyp" ? 0.03 : 0.12)))
        .force("y", forceY<GNode>(0).strength(0.05));
    sim.current = s;
    // reuse simulation objects so existing nodes keep their positions; seed new ones by type
    const prev = simNodes.current;
    const nodes = graph.nodes.map((n) => {
      const p = prev.get(n.id);
      if (p) return Object.assign(p, { r: n.r, ref: n.ref });
      return { ...n, x: (n.type === "feature" ? -260 : n.type === "exp" ? 260 : 0) + (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 300 };
    });
    simNodes.current = new Map(nodes.map((n) => [n.id, n]));
    const publish = () => setPos(Object.fromEntries(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
    s.nodes(nodes);
    s.force(
      "link",
      forceLink<GNode, GLink>(graph.links.map((l) => ({ ...l })))
        .id((n) => n.id)
        .distance((l) => (l.kind === "about" ? 120 : l.kind === "competes" ? 90 : l.kind === "related" ? 70 : 60))
        .strength((l) => (l.kind === "support" ? 0.25 : 0.5)),
    );
    let raf = 0;
    s.on("tick", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), publish()));
    });
    s.on("end", () => requestAnimationFrame(() => setSettled((v) => v + 1)));
    if (reduce) {
      s.stop();
      for (let i = 0; i < 200; i++) s.tick();
      raf = requestAnimationFrame(() => ((raf = 0), publish(), setSettled((v) => v + 1)));
    } else s.alpha(0.6).restart();
    return () => {
      cancelAnimationFrame(raf);
      s.on("tick", null);
      s.on("end", null);
      s.stop();
    };
  }, [graph, reduce]);

  const fit = useCallback(() => {
    const ns = Object.values(pos);
    if (!ns.length || !width) return;
    const xs = ns.map((n) => n.x);
    const ys = ns.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 80, Math.max(...xs) + 140, Math.min(...ys) - 60, Math.max(...ys) + 60];
    const k = Math.min(1.4, Math.max(0.3, Math.min(width / (x1 - x0), height / (y1 - y0))));
    setView({ k, x: width / 2 - ((x0 + x1) / 2) * k, y: height / 2 - ((y0 + y1) / 2) * k });
  }, [pos, width, height]);

  // auto-frame shortly after layout starts and again once it settles, until the analyst takes over
  const interacted = useRef(false);
  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);
  const hasPos = Object.keys(pos).length > 0;
  useEffect(() => {
    if (!hasPos || !width || interacted.current) return;
    const t = setTimeout(() => fitRef.current(), settled ? 0 : 700);
    return () => clearTimeout(t);
  }, [hasPos, settled, width]);

  // neighborhood for highlighting
  const focusId = hover ?? (selected ? `h:${selected.id}` : null);
  const neighbors = useMemo(() => {
    if (!focusId) return null;
    const s = new Set([focusId]);
    for (const l of graph.links) {
      if (l.source === focusId) s.add(l.target);
      if (l.target === focusId) s.add(l.source);
    }
    return s;
  }, [focusId, graph.links]);

  // pan / zoom
  const moved = useRef(false);
  const drag = useRef<{ kind: "pan"; sx: number; sy: number; vx: number; vy: number } | { kind: "node"; id: string } | null>(null);
  function zoomBy(factor: number) {
    interacted.current = true;
    setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.25, v.k * factor)) }));
  }
  const onWheel = (e: React.WheelEvent) => {
    interacted.current = true;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const k = Math.min(2.5, Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
  };
  const toWorld = (cx: number, cy: number, el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };

  const counts = ALL_STATUS.map((s) => [s, inv.hypotheses.filter((h) => h.status === s).length] as const);

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_400px]">
      <div className="relative flex min-h-[60vh] min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="mr-2">
            <div className="label-mono">
              <span className="text-signal">[ 04 ]</span> hypothesis intelligence map
            </div>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
            {counts.map(([s, n]) => {
              const on = statuses.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setStatuses((cur) => {
                      const next = new Set(cur);
                      if (next.has(s)) next.delete(s);
                      else next.add(s);
                      return next;
                    })
                  }
                  className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors", on ? "border-line-2 text-fg-2" : "border-transparent text-fg-4 line-through")}
                >
                  <Dot tone={H_STATUS[s].tone} size={5} />
                  {H_STATUS[s].label} {n}
                </button>
              );
            })}
          </div>
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-3">
            <input type="checkbox" checked={showExps} onChange={(e) => setShowExps(e.target.checked)} className="accent-[var(--color-signal)]" />
            experiments
          </label>
        </div>
        <div
          ref={ref}
          className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-ink-950 bg-dots active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            moved.current = false;
            drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (Math.abs(e.clientX - (d.kind === "pan" ? d.sx : e.clientX)) + Math.abs(e.clientY - (d.kind === "pan" ? d.sy : e.clientY)) > 3) moved.current = true;
            if (d.kind === "pan" && moved.current) interacted.current = true;
            if (d.kind === "pan") setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
            else {
              const w = toWorld(e.clientX, e.clientY, e.currentTarget);
              const n = simNodes.current.get(d.id);
              if (n) {
                n.fx = w.x;
                n.fy = w.y;
              }
              sim.current?.alphaTarget(0.2).restart();
            }
          }}
          onPointerUp={() => {
            const d = drag.current;
            if (d?.kind === "node") {
              const n = simNodes.current.get(d.id);
              if (n) {
                n.fx = null;
                n.fy = null;
              }
              sim.current?.alphaTarget(0);
            }
            drag.current = null;
          }}
          onClick={(e) => {
            if (!moved.current && (e.target === e.currentTarget || (e.target as Element).tagName === "svg")) select(null);
          }}
        >
          {!inv.hypotheses.length ? (
            <Empty icon={<GitBranch size={22} />} title="No hypotheses yet" hint="The statistician proposes hypotheses after reconnaissance. They will appear here as a live knowledge graph." className="h-full" />
          ) : (
            <svg width={width} height={height} className="block" role="img" aria-label="Hypothesis knowledge graph">
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {graph.links.map((l, i) => {
                  const a = { id: l.source, ...pos[l.source] };
                  const b = { id: l.target, ...pos[l.target] };
                  if (!pos[l.source] || !pos[l.target]) return null;
                  const st = LINK_STYLE[l.kind];
                  const dim = neighbors && !(neighbors.has(a.id) && neighbors.has(b.id));
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={st.color}
                      strokeWidth={st.width / Math.sqrt(view.k)}
                      strokeDasharray={st.dash}
                      strokeOpacity={dim ? 0.05 : neighbors ? 0.85 : l.kind === "support" ? 0.18 : 0.4}
                    />
                  );
                })}
                {graph.nodes.map((gn) => {
                  if (!pos[gn.id]) return null;
                  const n = { ...gn, ...pos[gn.id] };
                  const dim = neighbors && !neighbors.has(n.id);
                  const common = {
                    onPointerEnter: () => setHover(n.id),
                    onPointerLeave: () => setHover(null),
                    onPointerDown: (e: React.PointerEvent) => {
                      e.stopPropagation();
                      ((e.currentTarget as SVGGraphicsElement).ownerSVGElement?.parentElement as HTMLElement | null)?.setPointerCapture(e.pointerId);
                      drag.current = { kind: "node", id: n.id };
                    },
                    style: { opacity: dim ? 0.15 : 1, transition: "opacity 200ms", cursor: "pointer" },
                  };
                  if (n.type === "feature")
                    return (
                      <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
                        <rect x={-48} y={-12} width={96} height={24} rx={12} fill="var(--color-ink-900)" stroke="var(--color-signal)" strokeOpacity={0.55} />
                        <text textAnchor="middle" y={4} fontSize={10.5} fill="var(--color-signal)">
                          {labelOf(inv.target, n.ref).slice(0, 15)}
                        </text>
                      </g>
                    );
                  if (n.type === "exp") {
                    const e = inv.experiments.find((x) => x.id === n.ref);
                    return (
                      <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
                        <rect x={-4} y={-4} width={8} height={8} transform="rotate(45)" fill={e ? toneVar[EXP_KIND[e.kind].tone] : "var(--color-fg-4)"} fillOpacity={0.8} />
                        {(hover === n.id || view.k > 1.3) && (
                          <text x={9} y={3} fontSize={9} className="font-mono" fill="var(--color-fg-3)">
                            {n.ref} {e?.title.slice(0, 28)}
                          </text>
                        )}
                      </g>
                    );
                  }
                  const h = inv.hypotheses.find((x) => x.id === n.ref)!;
                  const tone = toneVar[H_STATUS[h.status].tone];
                  const isSel = selected?.id === h.id;
                  const full = isSel || hover === n.id || view.k > 1.45;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      {...common}
                      onClick={(e) => {
                        e.stopPropagation();
                        select({ kind: "hypothesis", id: h.id });
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${h.id}: ${h.statement}. ${H_STATUS[h.status].label}`}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select({ kind: "hypothesis", id: h.id }))}
                    >
                      {h.status === "testing" && !reduce && <circle r={n.r + 6} fill="none" stroke={tone} strokeOpacity={0.4} className="animate-pulse" />}
                      {isSel && <circle r={n.r + 5} fill="none" stroke={tone} strokeWidth={1.5} />}
                      <circle r={n.r} fill="var(--color-ink-900)" stroke={tone} strokeWidth={h.status === "supported" ? 2 : 1.2} strokeDasharray={h.status === "proposed" ? "2 2" : undefined} />
                      <circle r={n.r} fill={tone} fillOpacity={h.status === "supported" ? 0.16 : 0.06} />
                      <text textAnchor="middle" y={4} fontSize={11} fill={tone}>
                        {H_KIND[h.kind].glyph}
                      </text>
                      <g transform={`translate(${n.r + 5},0)`} pointerEvents="none">
                        <text y={full ? -2 : 3.5} fontSize={9} className="font-mono" fill={full ? "var(--color-fg-3)" : "var(--color-fg-4)"}>
                          {h.id}
                        </text>
                        {full && (
                          <>
                            <rect x={-3} y={2} width={Math.min(h.statement.length, 52) * 5.6 + 6} height={14} rx={3} fill="var(--color-ink-950)" fillOpacity={0.85} />
                            <text y={12.5} fontSize={10.5} fill={h.status === "rejected" ? "var(--color-fg-3)" : "var(--color-fg)"}>
                              {h.statement.length > 52 ? `${h.statement.slice(0, 50)}…` : h.statement}
                            </text>
                          </>
                        )}
                      </g>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          <div className="glass absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-md">
            {(
              [
                ["Zoom in", <Plus key="i" size={13} />, 1.25],
                ["Zoom out", <Minus key="o" size={13} />, 0.8],
              ] as const
            ).map(([l, icon, factor]) => (
              <button key={l} type="button" aria-label={l} onClick={() => zoomBy(factor)} className="flex h-7 w-7 items-center justify-center border-b border-line text-fg-2 hover:bg-white/[0.06] hover:text-fg">
                {icon}
              </button>
            ))}
            <button type="button" aria-label="Fit map" onClick={fit} className="flex h-7 w-7 items-center justify-center text-fg-2 hover:bg-white/[0.06] hover:text-fg">
              <Maximize2 size={12} />
            </button>
          </div>
          <div className="glass absolute bottom-3 right-3 hidden rounded-md p-2.5 sm:block">
            {(Object.keys(LINK_STYLE) as GLink["kind"][]).map((k) => (
              <div key={k} className="flex items-center gap-2 py-0.5 font-mono text-[9.5px] text-fg-3">
                <svg width={22} height={4}>
                  <line x1={0} x2={22} y1={2} y2={2} stroke={LINK_STYLE[k].color} strokeDasharray={LINK_STYLE[k].dash} strokeWidth={1.5} />
                </svg>
                {LINK_STYLE[k].label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <aside className="flex min-h-0 flex-col border-line max-lg:border-t lg:border-l" aria-label="Hypothesis dossier">
        <PanelHeader index="05" title={selected ? `Dossier · ${selected.id}` : "Dossier"} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected ? (
            <>
              {selected.competes.length > 0 && <Competition inv={inv} h={selected} />}
              <HypothesisDossier inv={inv} h={selected} />
            </>
          ) : (
            <Leaderboard inv={inv} />
          )}
        </div>
      </aside>
    </div>
  );
}

function Competition({ inv, h }: { inv: InvestigationState; h: Hypothesis }) {
  const select = useSelection((s) => s.select);
  const rivals = [h, ...h.competes.map((id) => inv.hypotheses.find((x) => x.id === id)).filter((x): x is Hypothesis => !!x)];
  const winner = rivals.find((r) => r.status === "supported");
  return (
    <div className="border-b border-line bg-amber/[0.03] px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <Scale size={13} className="text-amber" />
        <Label className="!text-amber">Competing explanations</Label>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(rivals.length, 2)}, minmax(0, 1fr))` }}>
        {rivals.slice(0, 2).map((r) => {
          const st = H_STATUS[r.status];
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => select({ kind: "hypothesis", id: r.id })}
              className={cn("rounded-md border p-2.5 text-left transition-colors hover:bg-white/[0.02]", r.id === h.id ? "border-line-3" : "border-line")}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-fg-4">{r.id}</span>
                <Chip tone={st.tone}>{st.label}</Chip>
                <span className="ml-auto">
                  <Ring value={r.confidence} tone={st.tone === "neutral" ? "model" : st.tone} size={20} stroke={2} />
                </span>
              </div>
              <div className="mt-1.5 line-clamp-3 text-[11.5px] leading-snug text-fg-2">{r.statement}</div>
              <div className="mt-1.5 font-mono text-[9.5px] text-fg-4">
                {r.test ? `${r.test.name.split(" ")[0]} · ${r.test.name.includes("BIC") ? `ΔBIC ${r.test.statistic.toFixed(1)}` : fmtP(r.test.p)}` : "untested"} · {r.evidence.supporting.length} exp
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-[11.5px] text-fg-3">{winner ? <>Evidence favors <span className="text-truth">{winner.id}</span>; its rival was rejected by the same data.</> : "Neither explanation is settled yet."}</div>
    </div>
  );
}

function Leaderboard({ inv }: { inv: InvestigationState }) {
  const select = useSelection((s) => s.select);
  const hs = [...inv.hypotheses].sort((a, b) => (a.status === "supported" ? 0 : 1) - (b.status === "supported" ? 0 : 1) || b.confidence - a.confidence);
  if (!hs.length) return <Empty title="Nothing to rank yet" />;
  return (
    <div>
      <div className="px-4 py-3 text-xs text-fg-3">Select a node to open its dossier. Ranked by status, then confidence.</div>
      {hs.map((h) => (
        <button key={h.id} type="button" onClick={() => select({ kind: "hypothesis", id: h.id })} className="flex w-full items-start gap-2.5 border-t border-line px-4 py-2.5 text-left hover:bg-white/[0.02]">
          <Ring value={h.confidence} tone={H_STATUS[h.status].tone === "neutral" ? "model" : H_STATUS[h.status].tone} size={22} stroke={2} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-mono text-[10px]">
              <span className="text-fg-4">{h.id}</span>
              <span style={{ color: toneVar[H_STATUS[h.status].tone] }}>{H_STATUS[h.status].label.toUpperCase()}</span>
              <span className="text-fg-4">· {H_KIND[h.kind].label}</span>
            </span>
            <span className={cn("mt-0.5 block text-xs leading-snug", h.status === "rejected" ? "text-fg-3" : "text-fg-2")}>{h.statement}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
