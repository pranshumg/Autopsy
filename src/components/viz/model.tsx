"use client";

import { scaleLinear } from "d3-scale";
import { useState } from "react";
import type { InvestigationState } from "@/lib/types";
import { fmtOutput, labelOf } from "@/lib/format";
import { AxisLabel, Chart } from "./core";

/** Actual (black box) vs predicted (surrogate) on held-out queries (validation while running, sealed test at the end). */
export function FidelityScatter({ inv, height = 280 }: { inv: InvestigationState; height?: number }) {
  const s = inv.surrogate;
  const [hover, setHover] = useState<number | null>(null);
  if (!s) return null;
  const o = inv.target.output;
  const vals = s.residuals.flatMap((r) => [r.actual, r.predicted]);
  const lo = Math.min(...vals, o.min);
  const hi = Math.max(...vals);
  const h = s.residuals.find((r) => r.obsId === hover);
  return (
    <div className="relative">
      <Chart height={height} label={`Actual versus predicted for ${s.residuals.length} ${s.evaluatedOn === "validation" ? "validation" : "sealed test"} queries`}>
        {(w, hh) => {
          const pad = { l: 46, r: 10, t: 10, b: 26 };
          const x = scaleLinear().domain([lo, hi]).range([pad.l, w - pad.r]).nice();
          const y = scaleLinear().domain([lo, hi]).range([hh - pad.b, pad.t]).nice();
          return (
            <g>
              {y.ticks(4).map((t) => (
                <g key={t}>
                  <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
                  <AxisLabel x={pad.l - 6} y={y(t) + 3} anchor="end">
                    {fmtOutput(o, t)}
                  </AxisLabel>
                </g>
              ))}
              {x.ticks(4).map((t) => (
                <AxisLabel key={t} x={x(t)} y={hh - 10} anchor="middle">
                  {fmtOutput(o, t)}
                </AxisLabel>
              ))}
              <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="var(--color-truth)" strokeOpacity={0.5} strokeDasharray="4 4" />
              {s.residuals.map((r) => {
                const err = Math.abs(r.actual - r.predicted) / (hi - lo || 1);
                return (
                  <circle
                    key={r.obsId}
                    cx={x(r.actual)}
                    cy={y(r.predicted)}
                    r={hover === r.obsId ? 5.5 : 3.5}
                    fill={err > 0.12 ? "var(--color-alert)" : err > 0.05 ? "var(--color-amber)" : "var(--color-signal)"}
                    fillOpacity={0.8}
                    stroke="var(--color-ink-950)"
                    onMouseEnter={() => setHover(r.obsId)}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
              <AxisLabel x={w - pad.r} y={hh} anchor="end">
                ACTUAL (BLACK BOX) →
              </AxisLabel>
              <text x={12} y={pad.t} transform={`rotate(-90 12 ${pad.t})`} textAnchor="end" className="fill-fg-4 font-mono" fontSize={9}>
                PREDICTED (SURROGATE) →
              </text>
            </g>
          );
        }}
      </Chart>
      {h && (
        <div className="glass pointer-events-none absolute right-2 top-2 rounded-md px-2.5 py-1.5 font-mono text-[10.5px]">
          <div className="text-fg-3">query #{h.obsId}</div>
          <div>
            actual <span className="text-fg">{fmtOutput(o, h.actual)}</span>
          </div>
          <div>
            predicted <span className="text-signal">{fmtOutput(o, h.predicted)}</span>
          </div>
          <div className="text-fg-3">error {fmtOutput(o, Math.abs(h.actual - h.predicted))}</div>
        </div>
      )}
    </div>
  );
}

export function ImportanceBars({ inv }: { inv: InvestigationState }) {
  const s = inv.surrogate;
  if (!s) return null;
  const rows = Object.entries(s.importance).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map((r) => r[1]), 0.0001);
  return (
    <div className="space-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[130px_1fr_44px] items-center gap-3 text-xs">
          <span className="truncate text-fg-2">{labelOf(inv.target, k)}</span>
          <div className="relative h-4 rounded-sm bg-white/[0.03]">
            <div className="absolute inset-y-0 left-0 rounded-sm bg-gradient-to-r from-model/50 to-model transition-[width] duration-700" style={{ width: `${(v / max) * 100}%` }} />
          </div>
          <span className="text-right font-mono text-[10.5px] text-fg-3">{(v * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}
