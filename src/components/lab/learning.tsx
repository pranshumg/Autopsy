"use client";

import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line, curveMonotoneX } from "d3-shape";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play, Radar, SkipBack, SkipForward, Square } from "lucide-react";
import type { ALRound, BenchmarkCurve, InvestigationState } from "@/lib/types";
import { useLab } from "@/lib/store";
import { benchmarkVerdict } from "@/lib/bench";
import { cn, fmtOutput, featureOf, fmtFeature } from "@/lib/format";
import { valueAt } from "@/lib/engine/design";
import { Button, Chip, Empty, Label, Meter, Tip } from "@/components/ui";
import { AxisLabel, Chart, useObsMap, useSize } from "@/components/viz/core";

function heatColor(t: number): [number, number, number] {
  // ink → violet → amber, perceptually ordered
  const stops: [number, number, number][] = [
    [10, 12, 16],
    [60, 44, 120],
    [162, 141, 255],
    [255, 184, 77],
  ];
  const x = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)) as [number, number, number];
}

function Field({ inv, round, maxSd }: { inv: InvestigationState; round: ALRound; maxSd: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null);
  const H = Math.max(280, Math.min(460, width * 0.62));
  const pad = { l: 52, r: 14, t: 14, b: 36 };
  const fu = featureOf(inv.target, round.axes[0]);
  const fv = featureOf(inv.target, round.axes[1]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, H);
    const iw = width - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    // inverse-distance-weighted uncertainty field from scored candidates
    const gx = 64;
    const gy = 40;
    const cw = iw / gx;
    const ch = ih / gy;
    const cands = round.candidates;
    for (let i = 0; i < gx; i++) {
      for (let j = 0; j < gy; j++) {
        const u = (i + 0.5) / gx;
        const v = 1 - (j + 0.5) / gy;
        let num = 0;
        let den = 0;
        for (const cd of cands) {
          const d2 = (cd.u - u) ** 2 + (cd.v - v) ** 2 + 0.0008;
          const w = 1 / (d2 * d2);
          num += w * cd.sd;
          den += w;
        }
        const [r, g, b] = heatColor(Math.sqrt((num / den) / (maxSd || 1)));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        const x0 = Math.floor(pad.l + i * cw);
        const y0 = Math.floor(pad.t + j * ch);
        ctx.fillRect(x0, y0, Math.floor(pad.l + (i + 1) * cw) - x0, Math.floor(pad.t + (j + 1) * ch) - y0);
      }
    }
    // explored observations
    for (const p of round.explored) {
      ctx.fillStyle = "rgba(78,225,240,0.55)";
      ctx.beginPath();
      ctx.arc(pad.l + p.u * iw, pad.t + (1 - p.v) * ih, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // candidate pool
    for (const cd of cands) {
      if (cd.selected) continue;
      ctx.strokeStyle = "rgba(233,237,242,0.35)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(pad.l + cd.u * iw, pad.t + (1 - cd.v) * ih, 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, width, H, maxSd]);

  const iw = width - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const obs = useObsMap(inv);

  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <canvas ref={canvas} style={{ width, height: H }} className="absolute inset-0" aria-hidden />
      {width > 0 && (
        <svg width={width} height={H} className="absolute inset-0" role="img" aria-label={`Uncertainty field for round ${round.round} over ${fu?.label} and ${fv?.label}`}>
          <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="none" stroke="var(--color-line-2)" />
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <AxisLabel x={pad.l + t * iw} y={H - 20} anchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}>
                {fu && fu.kind === "numeric" ? fmtFeature(fu, valueAt(fu, t)) : ""}
              </AxisLabel>
              <AxisLabel x={pad.l - 6} y={pad.t + (1 - t) * ih + 3} anchor="end">
                {fv && fv.kind === "numeric" ? fmtFeature(fv, valueAt(fv, t)) : ""}
              </AxisLabel>
            </g>
          ))}
          <AxisLabel x={pad.l + iw / 2} y={H - 4} anchor="middle">
            {fu?.label.toUpperCase()} →
          </AxisLabel>
          <text x={12} y={pad.t + ih / 2} transform={`rotate(-90 12 ${pad.t + ih / 2})`} textAnchor="middle" className="fill-fg-4 font-mono" fontSize={9}>
            {fv?.label.toUpperCase()} →
          </text>
          {round.probes.map((p, i) => {
            const cx = pad.l + p.u * iw;
            const cy = pad.t + (1 - p.v) * ih;
            return (
              <g key={i} onMouseEnter={() => setHover({ x: cx, y: cy, i })} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
                {!reduce && (
                  <circle cx={cx} cy={cy} r={6} fill="none" stroke="var(--color-truth)" strokeOpacity={0.6}>
                    <animate attributeName="r" from="5" to="14" dur="1.6s" begin={`${(i % 8) * 0.15}s`} repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" from="0.7" to="0" dur="1.6s" begin={`${(i % 8) * 0.15}s`} repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={cx} cy={cy} r={4.5} fill="var(--color-truth)" stroke="var(--color-ink-950)" strokeWidth={1.5} />
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <div className="glass pointer-events-none absolute z-10 rounded-md px-2.5 py-1.5 font-mono text-[10.5px]" style={{ left: Math.min(hover.x + 12, width - 190), top: Math.max(4, hover.y - 64) }}>
          <div className="text-truth">probe {hover.i + 1} · round {round.round}</div>
          <div className="text-fg-3">
            predicted <span className="text-fg">{fmtOutput(inv.target.output, round.probes[hover.i].mean)}</span> ± {fmtOutput(inv.target.output, round.probes[hover.i].sd)}
          </div>
          {obs.get(round.selectedObsIds[hover.i]) && (
            <div className="text-fg-3">
              observed <span className="text-signal">{fmtOutput(inv.target.output, obs.get(round.selectedObsIds[hover.i])!.output)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoundCurves({ rounds, active, onPick, inv }: { rounds: ALRound[]; active: number; onPick: (i: number) => void; inv: InvestigationState }) {
  const o = inv.target.output;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          { key: "holdoutRmse", label: "Validation RMSE (ensemble · monitoring only)", color: "var(--color-signal)" },
          { key: "meanSd", label: "Mean predictive σ across pool", color: "var(--color-model)" },
        ] as const
      ).map((m) => (
        <div key={m.key}>
          <Label className="mb-1.5">{m.label}</Label>
          <Chart height={110} label={m.label}>
            {(w, h) => {
              const vals = rounds.map((r) => r[m.key]);
              const x = scaleLinear().domain([1, Math.max(2, rounds.length)]).range([8, w - 8]);
              const y = scaleLinear().domain([0, Math.max(...vals) * 1.1 || 1]).range([h - 16, 6]);
              const d = d3line<number>().x((_, i) => x(i + 1)).y((v) => y(v)).curve(curveMonotoneX)(vals) ?? "";
              return (
                <g>
                  <path d={d} fill="none" stroke={m.color} strokeWidth={1.6} />
                  {vals.map((v, i) => (
                    <circle key={i} cx={x(i + 1)} cy={y(v)} r={i === active ? 4.5 : 2.5} fill={i === active ? m.color : "var(--color-ink-950)"} stroke={m.color} onClick={() => onPick(i)} style={{ cursor: "pointer" }}>
                      <title>{`round ${i + 1}: ${fmtOutput(o, v)}`}</title>
                    </circle>
                  ))}
                  <AxisLabel x={8} y={h - 2}>
                    R1
                  </AxisLabel>
                  <AxisLabel x={w - 8} y={h - 2} anchor="end">
                    R{rounds.length}
                  </AxisLabel>
                  <AxisLabel x={w - 8} y={14} anchor="end">
                    {fmtOutput(o, vals[active] ?? 0)}
                  </AxisLabel>
                </g>
              );
            }}
          </Chart>
        </div>
      ))}
    </div>
  );
}

function BenchmarkPanel({ inv }: { inv: InvestigationState }) {
  const run = useLab((s) => s.runBenchmark);
  const cancel = useLab((s) => s.cancelBenchmark);
  const b = inv.benchmark;
  const running = b?.status === "running";
  const o = inv.target.output;
  const seeds = 3;
  const py = inv.target.origin === "python";
  const est = py ? 60 + seeds * 2 * inv.budget.limit : 120 + seeds * (20 + 2 * 16 * 10);
  const verdict = useMemo(() => (b ? benchmarkVerdict(b) : null), [b]);
  const perStrategy = b?.perStrategyBudget ?? 20 + 16 * 10;
  return (
    <section className="border-t border-line px-5 py-6" aria-labelledby="bench-h">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="label-mono">benchmark</div>
          <h2 id="bench-h" className="mt-1 text-xl font-semibold tracking-tight">
            Adaptive vs random sampling <span className="font-serif font-normal italic text-fg-2">on the live target</span>
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-3">
            {py ? (
              <>The full multi-agent investigation (active learning) and a random-probing baseline each get {inv.budget.limit} queries on the same seeds. After each run, every checkpoint is replayed and scored against the target&rsquo;s hidden rules (evaluation only; the agents never see them), and a surrogate is scored on 60 shared held-out queries. Lines are means over {seeds} runs; bands show the min–max range.</>
            ) : (
              <>Equal training budgets: in each run both strategies start from the same 20 random queries and add 16 per round, {perStrategy} training queries each. Both are scored on one shared set of 120 random held-out queries that neither strategy trains on. Lines are means over {seeds} independent runs; bands show the min–max range across runs, not a confidence interval.</>
            )}
          </p>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-fg-4">
            Cost: about {est.toLocaleString()} benchmark queries, counted separately and not deducted from this investigation&rsquo;s budget{inv.target.origin === "external" ? ". These are real requests to the external API." : "."}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button variant="danger" size="md" onClick={() => cancel(inv.id)}>
              <Square size={11} fill="currentColor" /> Stop
            </Button>
          ) : (
            <Button variant="signal" size="md" onClick={() => run(inv.id, seeds)}>
              <Play size={12} fill="currentColor" /> {b ? "Re-run" : "Run"} benchmark · ~{est.toLocaleString()} queries
            </Button>
          )}
        </div>
      </div>
      {b && (
        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="surface rounded-xl p-4">
            {running && (
              <div className="mb-3 flex items-center gap-3">
                <Loader2 size={13} className="animate-spin text-signal" />
                <Meter value={b.progress} className="flex-1" />
                <span className="font-mono text-[10px] text-fg-3">{b.queriesUsed.toLocaleString()} queries</span>
              </div>
            )}
            {b.adaptive.length ? <Curves adaptive={b.adaptive} random={b.random} inv={inv} /> : <div className="flex h-[240px] items-center justify-center font-mono text-[11px] text-fg-4">first seed in progress…</div>}
          </div>
          <div className="space-y-4">
            {b.status === "error" && <div className="rounded-md border border-alert/30 bg-alert/[0.06] p-3 text-xs text-alert">Benchmark failed: {b.error}</div>}
            {b.status === "cancelled" && <div className="rounded-md border border-amber/30 bg-amber/[0.06] p-3 text-xs text-amber">Benchmark stopped early — partial results shown.</div>}
            {b.rules && b.rules.adaptive.length > 0 && (
              <div className="rounded-lg border border-line p-3">
                <div className="label-mono">true rules recovered</div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 font-mono text-[12px]">
                  <div>
                    <div className="text-fg-4">active</div>
                    <div className="text-[18px] text-truth">
                      {b.rules.adaptive[b.rules.adaptive.length - 1].found.toFixed(1)}
                      <span className="text-[11px] text-fg-4"> / {b.rules.total}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-4">random</div>
                    <div className="text-[18px] text-fg-2">
                      {b.rules.random.length ? b.rules.random[b.rules.random.length - 1].found.toFixed(1) : "—"}
                      <span className="text-[11px] text-fg-4"> / {b.rules.total}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[11px] leading-relaxed text-fg-3">
                  By query: {b.rules.adaptive.map((p) => `${p.n}→${p.found.toFixed(1)}`).join(", ")} (active) vs {b.rules.random.map((p) => `${p.n}→${p.found.toFixed(1)}`).join(", ")} (random). Partial matches count ½.
                  {b.rules.falsePositives && ` False positives per run: active ${b.rules.falsePositives.adaptive.join(", ")}; random ${b.rules.falsePositives.random.join(", ") || "—"}.`}
                </div>
              </div>
            )}
            {verdict && (
              <>
                <div>
                  <div className={cn("text-[15px] font-medium", verdict.label === "adaptive lower" ? "text-truth" : "text-amber")}>{verdict.label === "inconclusive" ? "Inconclusive" : verdict.label === "adaptive lower" ? "Adaptive lower in every run" : "Random lower in every run"}</div>
                  <div className="mt-1 text-xs leading-relaxed text-fg-3">{verdict.text}</div>
                </div>
                <table className="w-full font-mono text-[11px]">
                  <thead>
                    <tr className="text-fg-4">
                      <th className="pb-1 text-left font-normal">run</th>
                      <th className="pb-1 text-right font-normal">adaptive</th>
                      <th className="pb-1 text-right font-normal">random</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.finals!.adaptive.map((a, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="py-1 text-fg-3">{i + 1}</td>
                        <td className={cn("py-1 text-right", a < b.finals!.random[i] ? "text-truth" : "text-fg-2")}>{fmtOutput(o, a)}</td>
                        <td className={cn("py-1 text-right", b.finals!.random[i] < a ? "text-truth" : "text-fg-2")}>{b.finals!.random[i] !== undefined ? fmtOutput(o, b.finals!.random[i]) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[11px] text-fg-3">
                  Final held-out RMSE after {py ? inv.budget.limit : perStrategy} queries each. Mean relative difference {(verdict.meanRelDiff * 100).toFixed(1)}% (range {(verdict.minRelDiff * 100).toFixed(1)}% to {(verdict.maxRelDiff * 100).toFixed(1)}% across runs; positive favours adaptive).
                </div>
                <div className="font-mono text-[10px] text-fg-4">
                  {verdict.runs} of {b.seeds} runs finished · {b.queriesUsed.toLocaleString()} benchmark queries{b.requests !== undefined ? ` · ${b.requests} HTTP requests` : ""} · {b.status}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Curves({ adaptive, random, inv }: { adaptive: BenchmarkCurve; random: BenchmarkCurve; inv: InvestigationState }) {
  const o = inv.target.output;
  return (
    <div>
      <Chart height={260} label="Held-out RMSE versus training queries for adaptive and random sampling">
        {(w, h) => {
          const pad = { l: 50, r: 12, t: 10, b: 24 };
          const all = [...adaptive, ...random];
          const x = scaleLinear().domain([Math.min(...all.map((d) => d.n)), Math.max(...all.map((d) => d.n))]).range([pad.l, w - pad.r]);
          const y = scaleLinear().domain([0, Math.max(...all.map((d) => d.hi)) * 1.08]).range([h - pad.b, pad.t]).nice();
          const band = d3area<BenchmarkCurve[number]>().x((d) => x(d.n)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(curveMonotoneX);
          const ln = d3line<BenchmarkCurve[number]>().x((d) => x(d.n)).y((d) => y(d.rmse)).curve(curveMonotoneX);
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
              {x.ticks(6).map((t) => (
                <AxisLabel key={t} x={x(t)} y={h - 6} anchor="middle">
                  {t}
                </AxisLabel>
              ))}
              <path d={band(random) ?? ""} fill="var(--color-fg-3)" fillOpacity={0.12} />
              <path d={band(adaptive) ?? ""} fill="var(--color-truth)" fillOpacity={0.12} />
              <path d={ln(random) ?? ""} fill="none" stroke="var(--color-fg-2)" strokeWidth={1.6} strokeDasharray="5 4" />
              <path d={ln(adaptive) ?? ""} fill="none" stroke="var(--color-truth)" strokeWidth={2} />
              {adaptive.map((d) => (
                <circle key={`a${d.n}`} cx={x(d.n)} cy={y(d.rmse)} r={2.5} fill="var(--color-truth)">
                  <title>{`adaptive · ${d.n} queries · mean RMSE ${fmtOutput(o, d.rmse)} (min–max across runs ${fmtOutput(o, d.lo)}–${fmtOutput(o, d.hi)})`}</title>
                </circle>
              ))}
              {random.map((d) => (
                <circle key={`r${d.n}`} cx={x(d.n)} cy={y(d.rmse)} r={2.5} fill="var(--color-fg-2)">
                  <title>{`random · ${d.n} queries · mean RMSE ${fmtOutput(o, d.rmse)} (min–max across runs ${fmtOutput(o, d.lo)}–${fmtOutput(o, d.hi)})`}</title>
                </circle>
              ))}
            </g>
          );
        }}
      </Chart>
      <div className="mt-2 flex gap-4 font-mono text-[10px] text-fg-3">
        <span>
          <span className="text-truth">━</span> adaptive (uncertainty × diversity)
        </span>
        <span>
          <span className="text-fg-2">┅</span> random
        </span>
        <span className="ml-auto">x: training queries per strategy · y: held-out RMSE · band: min–max across runs</span>
      </div>
    </div>
  );
}

export function ActiveLearning({ inv }: { inv: InvestigationState }) {
  const rounds = inv.alRounds;
  const [picked, setIdx] = useState(Math.max(0, rounds.length - 1));
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const obs = useObsMap(inv);
  const maxSd = useMemo(() => Math.max(...rounds.map((r) => r.maxSd), 0.0001), [rounds]);

  const idx = follow ? Math.max(0, rounds.length - 1) : Math.min(picked, Math.max(0, rounds.length - 1));

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIdx((i) => {
        if (i >= rounds.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1100);
    return () => clearInterval(t);
  }, [playing, rounds.length]);

  const round = rounds[idx];

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-wrap items-end gap-4 px-5 pb-4 pt-5">
        <div>
          <div className="label-mono">
            <span className="text-signal">[ 05 ]</span> active learning
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
            Where to look next, <span className="font-serif font-normal italic text-fg-2">chosen by disagreement.</span>
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] text-fg-3">
            Each round, a 12-tree bootstrap ensemble scores 400 random candidate inputs. Where the trees disagree most, the surrogate is least certain, so those inputs are the most informative to query next. Selections are spread out to avoid redundant probes.
          </p>
        </div>
      </div>
      {!round ? (
        <div className="px-5 pb-6">
          <div className="surface rounded-xl">
            <Empty
              icon={<Radar size={22} />}
              title={inv.phase === "active" ? "Scoring the first round…" : "Active learning has not started"}
              hint="This phase begins after reconnaissance, screening, structure probing and interaction tests. You can still run the benchmark below at any time."
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-px border-y border-line bg-line lg:grid-cols-[1fr_340px]">
          <div className="bg-ink-950 p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Chip tone="model">round {round.round}</Chip>
              <span className="font-mono text-[10px] text-fg-3">
                {round.queriesSoFar} queries before this round · projection on top-2 surrogate inputs
              </span>
              <div className="ml-auto flex items-center gap-3 font-mono text-[9.5px] text-fg-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-6 rounded-sm bg-[linear-gradient(90deg,#0a0c10,#3c2c78,#a28dff,#ffb84d)]" /> predictive σ
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal" /> explored
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full border border-fg-3" /> candidate
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-truth" /> selected
                </span>
              </div>
            </div>
            <Field inv={inv} round={round} maxSd={Math.max(round.maxSd, maxSd * 0.5)} />
            <div className="mt-4 flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Tip content="First round">
                  <button type="button" aria-label="First round" onClick={() => (setFollow(false), setIdx(0))} className="rounded p-1.5 text-fg-3 hover:bg-white/[0.05] hover:text-fg">
                    <SkipBack size={13} />
                  </button>
                </Tip>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFollow(false);
                    if (!playing && idx >= rounds.length - 1) setIdx(0);
                    setPlaying(!playing);
                  }}
                  aria-label={playing ? "Pause replay" : "Replay rounds"}
                >
                  {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />} {playing ? "Pause" : "Replay"}
                </Button>
                <Tip content="Latest round (follow live)">
                  <button type="button" aria-label="Latest round" onClick={() => (setFollow(true), setIdx(rounds.length - 1))} className={cn("rounded p-1.5 hover:bg-white/[0.05]", follow ? "text-signal" : "text-fg-3 hover:text-fg")}>
                    <SkipForward size={13} />
                  </button>
                </Tip>
              </div>
              <div className="flex flex-1 items-center gap-1" role="tablist" aria-label="Active learning rounds">
                {rounds.map((r, i) => (
                  <button
                    key={r.round}
                    type="button"
                    role="tab"
                    aria-selected={i === idx}
                    aria-label={`Round ${r.round}`}
                    onClick={() => (setFollow(false), setPlaying(false), setIdx(i))}
                    className={cn("h-6 flex-1 rounded-sm transition-colors", i === idx ? "bg-truth" : i < idx ? "bg-model/50 hover:bg-model/70" : "bg-white/[0.07] hover:bg-white/[0.12]")}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="bg-ink-950 p-5">
            <Label className="mb-3">Selected probes · predicted vs observed</Label>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 font-mono text-[10.5px]">
              <span className="text-fg-4">probe · informativeness</span>
              <span className="text-right text-fg-4">pred</span>
              <span className="text-right text-fg-4">obs</span>
              {round.probes.map((p, i) => {
                const ob = obs.get(round.selectedObsIds[i]);
                const err = ob ? Math.abs(ob.output - p.mean) : null;
                return (
                  <div key={i} className="contents">
                    <span className="flex items-center gap-2">
                      <span className="w-5 text-fg-4">{i + 1}</span>
                      <Meter value={p.sd / round.maxSd} tone="amber" className="flex-1" height={3} label={`Informativeness of probe ${i + 1}`} />
                    </span>
                    <span className="text-right text-fg-2">{fmtOutput(inv.target.output, p.mean)}</span>
                    <span className={cn("text-right", err !== null && err > 2 * p.sd ? "text-amber" : "text-signal")}>{ob ? fmtOutput(inv.target.output, ob.output) : "…"}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-md border border-line p-3 text-[11.5px] leading-relaxed text-fg-3">
              Selected σ averages <span className="text-fg">{(round.probes.reduce((s, p) => s + p.sd, 0) / round.probes.length / round.meanSd).toFixed(1)}×</span> the pool mean. Amber outcomes landed more than 2σ from the prediction: the surrogate was most wrong exactly where it
              said it was unsure.
            </div>
          </div>
        </div>
      )}
      {rounds.length > 1 && (
        <div className="px-5 py-6">
          <RoundCurves rounds={rounds} active={idx} onPick={(i) => (setFollow(false), setIdx(i))} inv={inv} />
        </div>
      )}
      <BenchmarkPanel inv={inv} />
    </div>
  );
}
