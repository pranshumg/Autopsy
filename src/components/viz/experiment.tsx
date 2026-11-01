"use client";

import { scaleLinear, scalePoint } from "d3-scale";
import { line as d3line } from "d3-shape";
import { useMemo, useState } from "react";
import type { Experiment, Hypothesis, Observation, PairRecord, TargetSpec } from "@/lib/types";
import { fmtDelta, fmtFeature, fmtOutput, featureOf } from "@/lib/format";
import { isLogScale, positionOf } from "@/lib/engine/design";
import { AxisLabel, Chart, Histogram, outputDomain } from "./core";

const PERSONA_COLORS = ["#4ee1f0", "#a28dff", "#ff8d6b", "#c8f04a", "#ffb84d", "#ff5d78"];

export function ExperimentViz({
  exp,
  obs,
  spec,
  hypotheses = [],
  compact,
  onPickPair,
  activePair,
}: {
  exp: Experiment;
  obs: Map<number, Observation>;
  spec: TargetSpec;
  hypotheses?: Hypothesis[];
  compact?: boolean;
  onPickPair?: (p: PairRecord) => void;
  activePair?: [number | null, number | null];
}) {
  if (exp.kind === "sweep" || exp.kind === "bisection") return <SweepViz exp={exp} spec={spec} hypotheses={hypotheses} compact={compact} />;
  if (exp.kind === "factorial" && exp.cells?.length === 4) return <FactorialViz exp={exp} spec={spec} compact={compact} />;
  if (exp.pairs?.length) return <PairsViz exp={exp} obs={obs} spec={spec} compact={compact} onPick={onPickPair} active={activePair} />;
  const values = exp.observationIds.map((id) => obs.get(id)?.output).filter((v): v is number => v !== undefined);
  if (!values.length) return <div className="flex h-24 items-center justify-center font-mono text-[11px] text-fg-4">awaiting responses…</div>;
  return (
    <div>
      <Histogram values={values} height={compact ? 70 : 120} format={(v) => fmtOutput(spec.output, v)} label={`Response distribution for ${exp.id}`} />
      <div className="mt-1 font-mono text-[10px] text-fg-4">{values.length} responses · {spec.output.label}</div>
    </div>
  );
}

function PairsViz({
  exp,
  obs,
  spec,
  compact,
  onPick,
  active,
}: {
  exp: Experiment;
  obs: Map<number, Observation>;
  spec: TargetSpec;
  compact?: boolean;
  onPick?: (p: PairRecord) => void;
  active?: [number | null, number | null];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const pairs = (exp.pairs ?? []).filter((p) => obs.has(p.a) && obs.has(p.b));
  const shown = compact ? pairs.slice(0, 14) : pairs.slice(0, 48);
  const values = shown.flatMap((p) => [obs.get(p.a)!.output, obs.get(p.b)!.output]);
  const dom = outputDomain(spec.output, values);
  const f = featureOf(spec, exp.features[0]);
  const rowH = compact ? 9 : 13;
  const h = shown.length * rowH + 26;
  return (
    <div>
      <Chart height={h} label={`Paired responses for ${exp.id}`}>
        {(w) => {
          const left = compact ? 6 : 104;
          const x = scaleLinear().domain(dom).range([left, w - 8]);
          return (
            <g>
              {x.ticks(4).map((t) => (
                <g key={t}>
                  <line x1={x(t)} x2={x(t)} y1={0} y2={h - 18} stroke="var(--color-line)" />
                  <AxisLabel x={x(t)} y={h - 5} anchor="middle">
                    {fmtOutput(spec.output, t)}
                  </AxisLabel>
                </g>
              ))}
              {shown.map((p, i) => {
                const a = obs.get(p.a)!;
                const b = obs.get(p.b)!;
                const y = i * rowH + rowH / 2 + 2;
                const up = p.delta > 0;
                const col = Math.abs(p.delta) < 1e-9 ? "var(--color-fg-4)" : up ? "var(--color-truth)" : "var(--color-alert)";
                const isActive = active && active[0] === p.a && active[1] === p.b;
                return (
                  <g
                    key={`${p.a}-${p.b}`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onPick?.(p)}
                    style={{ cursor: onPick ? "pointer" : undefined }}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  >
                    <rect x={0} y={y - rowH / 2} width={w} height={rowH} fill={isActive ? "rgb(78 225 240 / 0.08)" : hover === i ? "rgb(255 255 255 / 0.03)" : "transparent"} />
                    {!compact && (
                      <text x={0} y={y + 3} className="fill-fg-3 font-mono" fontSize={9}>
                        {a.personaId ?? `#${a.id}`} · {f ? `${fmtFeature(f, a.input[f.key])}→${fmtFeature(f, b.input[f.key])}` : ""}
                      </text>
                    )}
                    <line x1={x(a.output)} x2={x(b.output)} y1={y} y2={y} stroke={col} strokeOpacity={0.55} strokeWidth={1.5} />
                    <circle cx={x(a.output)} cy={y} r={compact ? 2 : 2.6} fill="var(--color-fg-3)" />
                    <circle cx={x(b.output)} cy={y} r={compact ? 2.2 : 3} fill={col} />
                    <title>{`${a.personaId ?? ""} ${fmtOutput(spec.output, a.output)} → ${fmtOutput(spec.output, b.output)} (${fmtDelta(spec.output, p.delta)})`}</title>
                  </g>
                );
              })}
            </g>
          );
        }}
      </Chart>
      {!compact && pairs.length > shown.length && <div className="mt-1 font-mono text-[10px] text-fg-4">showing {shown.length} of {pairs.length} pairs</div>}
    </div>
  );
}

function SweepViz({ exp, spec, hypotheses, compact }: { exp: Experiment; spec: TargetSpec; hypotheses: Hypothesis[]; compact?: boolean }) {
  const f = featureOf(spec, exp.features[0]);
  const series = useMemo(() => exp.series ?? [], [exp.series]);
  const personas = useMemo(() => [...new Set(series.map((p) => p.persona))], [series]);
  const th = hypotheses.find((h) => h.kind === "threshold" && h.features[0] === exp.features[0] && h.threshold && h.status !== "rejected")?.threshold;
  const h = compact ? 110 : 220;
  if (!f || f.kind !== "numeric" || !series.length) return <div className="flex h-24 items-center justify-center font-mono text-[11px] text-fg-4">awaiting responses…</div>;
  const log = isLogScale(f);
  const ys = series.map((p) => p.y);
  const dom = outputDomain(spec.output, ys);
  return (
    <Chart height={h} label={`${f.label} dose-response for ${exp.id}`}>
      {(w) => {
        const pad = { l: compact ? 4 : 44, r: 8, t: 8, b: 18 };
        const x = (v: number) => pad.l + positionOf(f, v) * (w - pad.l - pad.r);
        const y = scaleLinear().domain(dom).range([h - pad.b, pad.t]);
        return (
          <g>
            {!compact &&
              y.ticks(4).map((t) => (
                <g key={t}>
                  <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
                  <AxisLabel x={pad.l - 6} y={y(t) + 3} anchor="end">
                    {fmtOutput(spec.output, t)}
                  </AxisLabel>
                </g>
              ))}
            {th && th.direction !== "window" && (
              <g>
                <rect x={x(th.lo)} y={pad.t} width={Math.max(1.5, x(th.hi) - x(th.lo))} height={h - pad.t - pad.b} fill="var(--color-truth)" fillOpacity={0.12} />
                <line x1={x(th.value)} x2={x(th.value)} y1={pad.t} y2={h - pad.b} stroke="var(--color-truth)" strokeDasharray="3 3" />
                {!compact && (
                  <text x={x(th.value) + 4} y={pad.t + 9} className="fill-truth font-mono" fontSize={9}>
                    t ≈ {fmtFeature(f, th.value)}
                  </text>
                )}
              </g>
            )}
            {th && th.direction === "window" && (
              <rect x={x(th.lo)} y={pad.t} width={Math.max(2, x(th.end ?? th.hi) - x(th.lo))} height={h - pad.t - pad.b} fill="var(--color-truth)" fillOpacity={0.1} />
            )}
            {personas.map((pid, i) => {
              const pts = series.filter((p) => p.persona === pid).sort((a, b) => a.x - b.x);
              const col = PERSONA_COLORS[i % PERSONA_COLORS.length];
              const d = d3line<(typeof pts)[number]>()
                .x((p) => x(p.x))
                .y((p) => y(p.y))(pts);
              return (
                <g key={pid}>
                  {exp.kind === "sweep" && <path d={d ?? ""} fill="none" stroke={col} strokeWidth={1.4} strokeOpacity={0.85} />}
                  {pts.map((p, j) => (
                    <circle key={j} cx={x(p.x)} cy={y(p.y)} r={exp.kind === "bisection" ? 3 : 2} fill={col}>
                      <title>{`${pid} · ${fmtFeature(f, p.x)} → ${fmtOutput(spec.output, p.y)}`}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
            <AxisLabel x={pad.l} y={h - 4}>
              {fmtFeature(f, f.min)}
            </AxisLabel>
            <AxisLabel x={w - pad.r} y={h - 4} anchor="end">
              {fmtFeature(f, f.max)}
              {log ? " · log" : ""}
            </AxisLabel>
            {!compact && (
              <AxisLabel x={(w + pad.l) / 2} y={h - 4} anchor="middle">
                {f.label.toUpperCase()}
              </AxisLabel>
            )}
          </g>
        );
      }}
    </Chart>
  );
}

function FactorialViz({ exp, spec, compact }: { exp: Experiment; spec: TargetSpec; compact?: boolean }) {
  const [fa, fb] = exp.features.map((k) => featureOf(spec, k));
  const cells = exp.cells!;
  const bLevels = [cells[0].b, cells[1].b];
  const h = compact ? 110 : 200;
  const dom = outputDomain(spec.output, cells.map((c) => c.mean));
  const lines = [
    { a: cells[0].a, pts: [cells[0], cells[1]], col: "var(--color-signal)" },
    { a: cells[2].a, pts: [cells[2], cells[3]], col: "var(--color-coral)" },
  ];
  return (
    <div>
      <Chart height={h} label={`Interaction plot for ${exp.id}`}>
        {(w) => {
          const pad = { l: compact ? 6 : 50, r: compact ? 6 : 90, t: 10, b: 20 };
          const x = scalePoint<string>().domain(bLevels).range([pad.l + 20, w - pad.r - 20]);
          const y = scaleLinear().domain(dom).range([h - pad.b, pad.t]);
          return (
            <g>
              {!compact &&
                y.ticks(4).map((t) => (
                  <g key={t}>
                    <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
                    <AxisLabel x={pad.l - 6} y={y(t) + 3} anchor="end">
                      {fmtOutput(spec.output, t)}
                    </AxisLabel>
                  </g>
                ))}
              {lines.map((l) => (
                <g key={l.a}>
                  <line x1={x(l.pts[0].b)!} y1={y(l.pts[0].mean)} x2={x(l.pts[1].b)!} y2={y(l.pts[1].mean)} stroke={l.col} strokeWidth={2} />
                  {l.pts.map((c) => (
                    <circle key={c.b} cx={x(c.b)!} cy={y(c.mean)} r={4} fill={l.col} stroke="var(--color-ink-950)" strokeWidth={1.5}>
                      <title>{`${fa?.label}=${fmtFeature(fa, c.a)}, ${fb?.label}=${fmtFeature(fb, c.b)}: ${fmtOutput(spec.output, c.mean)} (n=${c.n})`}</title>
                    </circle>
                  ))}
                  {!compact && (
                    <text x={x(l.pts[1].b)! + 10} y={y(l.pts[1].mean) + 3} fill={l.col} className="font-mono" fontSize={9.5}>
                      {fa ? fmtFeature(fa, l.a) : l.a}
                    </text>
                  )}
                </g>
              ))}
              {bLevels.map((b) => (
                <AxisLabel key={b} x={x(b)!} y={h - 5} anchor="middle">
                  {fb ? fmtFeature(fb, b) : b}
                </AxisLabel>
              ))}
            </g>
          );
        }}
      </Chart>
      {!compact && (
        <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-fg-3">
          <span>
            lines: <span className="text-fg-2">{fa?.label}</span>
          </span>
          <span>
            x-axis: <span className="text-fg-2">{fb?.label}</span>
          </span>
          <span className="text-fg-4">non-parallel lines ⇒ interaction</span>
        </div>
      )}
    </div>
  );
}
