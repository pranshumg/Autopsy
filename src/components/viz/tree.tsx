"use client";

import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { useMemo, useState } from "react";
import type { TargetSpec, TreeNode } from "@/lib/types";
import { fmtFeature, fmtOutput, featureOf } from "@/lib/format";
import { useSize } from "./core";

type Datum = TreeNode & { side?: "L" | "R" };

/** Interactive surrogate decision tree. Click a split to collapse/expand; the
 * optional `path` highlights the route an input takes from root to leaf. */
export function DecisionTree({ root, spec, path, height = 420, maxDepth = 6 }: { root: TreeNode; spec: TargetSpec; path?: number[]; height?: number; maxDepth?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const onPath = useMemo(() => new Set(path ?? []), [path]);

  const layout = useMemo(() => {
    const h = hierarchy<Datum>(root, (d) => (d.left && d.right && !collapsed.has(d.id) && d.depth < maxDepth ? [{ ...d.left, side: "L" }, { ...d.right, side: "R" }] : null));
    const leaves = h.leaves().length;
    const w = Math.max(width, leaves * 62);
    const laid = d3tree<Datum>().size([w - 40, height - 70])(h);
    return { nodes: laid.descendants(), links: laid.links(), w };
  }, [root, collapsed, width, height, maxDepth]);

  const vmin = root.value - 2 * root.sd;
  const vmax = root.value + 2 * root.sd;
  const color = (v: number) => {
    const t = Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin || 1)));
    return `color-mix(in oklab, var(--color-model) ${Math.round((1 - t) * 100)}%, var(--color-truth))`;
  };

  const condition = (parent: HierarchyPointNode<Datum>, side: "L" | "R") => {
    const f = featureOf(spec, parent.data.feature!);
    if (parent.data.levels) {
      const lv = side === "L" ? parent.data.levels : f?.kind === "categorical" ? f.levels.filter((l) => !parent.data.levels!.includes(l)) : [];
      return lv.map((l) => l.replace(/_/g, " ")).join(" | ");
    }
    return `${side === "L" ? "≤" : ">"} ${fmtFeature(f, parent.data.threshold)}`;
  };

  return (
    <div ref={ref} className="relative w-full overflow-x-auto" style={{ height }}>
      {width > 0 && (
        <svg width={layout.w} height={height} role="img" aria-label="Surrogate decision tree">
          <g transform="translate(20,24)">
            {layout.links.map((l) => {
              const hot = onPath.has(l.source.data.id) && onPath.has(l.target.data.id);
              const my = (l.source.y + l.target.y) / 2;
              return (
                <g key={`${l.source.data.id}-${l.target.data.id}`}>
                  <path
                    d={`M${l.source.x},${l.source.y + 14} C${l.source.x},${my} ${l.target.x},${my} ${l.target.x},${l.target.y - 14}`}
                    fill="none"
                    stroke={hot ? "var(--color-signal)" : "var(--color-line-3)"}
                    strokeWidth={hot ? 2 : 1}
                    strokeDasharray={hot ? "4 3" : undefined}
                    className={hot ? "animate-dash" : undefined}
                  />
                  <text x={(l.source.x + l.target.x) / 2} y={my - 2} textAnchor="middle" className="font-mono" fontSize={8.5} fill={hot ? "var(--color-signal)" : "var(--color-fg-3)"}>
                    {condition(l.source, l.target.data.side!)}
                  </text>
                </g>
              );
            })}
            {layout.nodes.map((n) => {
              const isLeaf = !n.data.left || !n.data.right;
              const isCollapsed = collapsed.has(n.data.id) || (!isLeaf && n.depth >= maxDepth);
              const hot = onPath.has(n.data.id);
              const f = n.data.feature ? featureOf(spec, n.data.feature) : undefined;
              return (
                <g
                  key={n.data.id}
                  transform={`translate(${n.x},${n.y})`}
                  onMouseEnter={() => setHover(n.data.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    if (isLeaf) return;
                    setCollapsed((s) => {
                      const next = new Set(s);
                      if (next.has(n.data.id)) next.delete(n.data.id);
                      else next.add(n.data.id);
                      return next;
                    });
                  }}
                  style={{ cursor: isLeaf ? "default" : "pointer" }}
                  role={isLeaf ? undefined : "button"}
                  aria-label={isLeaf ? undefined : `${isCollapsed ? "Expand" : "Collapse"} split on ${f?.label}`}
                  tabIndex={isLeaf ? undefined : 0}
                  onKeyDown={(e) => {
                    if (!isLeaf && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setCollapsed((s) => {
                        const next = new Set(s);
                        if (next.has(n.data.id)) next.delete(n.data.id);
                        else next.add(n.data.id);
                        return next;
                      });
                    }
                  }}
                >
                  {isLeaf || isCollapsed ? (
                    <>
                      <rect x={-27} y={-13} width={54} height={26} rx={5} fill="var(--color-ink-850)" stroke={hot ? "var(--color-signal)" : color(n.data.value)} strokeWidth={hot ? 1.6 : 1} />
                      <text textAnchor="middle" y={-1} className="font-mono" fontSize={9.5} fill="var(--color-fg)">
                        {fmtOutput(spec.output, n.data.value)}
                      </text>
                      <text textAnchor="middle" y={9} className="font-mono" fontSize={7.5} fill="var(--color-fg-4)">
                        n={n.data.n}
                        {isCollapsed && !isLeaf ? " ⊕" : ""}
                      </text>
                    </>
                  ) : (
                    <>
                      <rect
                        x={-36}
                        y={-13}
                        width={72}
                        height={26}
                        rx={13}
                        fill={hot ? "rgb(78 225 240 / 0.12)" : "var(--color-ink-800)"}
                        stroke={hot ? "var(--color-signal)" : hover === n.data.id ? "var(--color-line-3)" : "var(--color-line-2)"}
                      />
                      <text textAnchor="middle" y={3.5} fontSize={10} fill="var(--color-fg)" className="font-mono">
                        {(f?.key ?? "").slice(0, 11)}
                      </text>
                    </>
                  )}
                  {hover === n.data.id && (
                    <g transform="translate(0,-24)" pointerEvents="none">
                      <rect x={-70} y={-16} width={140} height={18} rx={4} fill="var(--color-ink-700)" stroke="var(--color-line-2)" />
                      <text textAnchor="middle" y={-4} fontSize={9} fill="var(--color-fg-2)" className="font-mono">
                        μ {fmtOutput(spec.output, n.data.value)} · σ {fmtOutput(spec.output, n.data.sd)} · n {n.data.n}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
