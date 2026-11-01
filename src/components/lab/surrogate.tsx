"use client";

import * as Slider from "@radix-ui/react-slider";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Crosshair, Loader2, ShieldCheck } from "lucide-react";
import type { Input, InvestigationState, NumericFeature } from "@/lib/types";
import { analystAllowance, useLab } from "@/lib/store";
import { cn, fmtDelta, fmtFeature, fmtOutput, labelOf } from "@/lib/format";
import { decisionPath, predict } from "@/lib/engine/tree";
import { positionOf, valueAt } from "@/lib/engine/design";
import { Button, Empty, Label, Segmented, Ticker, Tip } from "@/components/ui";
import { AxisLabel, Histogram, useSize } from "@/components/viz/core";
import { FidelityScatter, ImportanceBars } from "@/components/viz/model";
import { DecisionTree } from "@/components/viz/tree";

type Verification = { id: number; input: Input; predicted: number; actual: number };

function surfaceColor(t: number) {
  // sequential: dark ink (low) → violet → lime (high); brighter means larger output
  const stops = [
    [14, 16, 22],
    [62, 50, 130],
    [128, 112, 230],
    [200, 240, 74],
  ];
  const x = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return `rgb(${stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)).join(",")})`;
}

export function SurrogateExplorer({ inv }: { inv: InvestigationState }) {
  const s = inv.surrogate;
  const spec = inv.target;
  const numeric = spec.features.filter((f): f is NumericFeature => f.kind === "numeric");
  const defaultInput = useMemo<Input>(() => Object.fromEntries(spec.features.map((f) => [f.key, f.kind === "numeric" ? valueAt(f, 0.5) : f.levels[0]])), [spec]);
  const [x, setX] = useState<Input>(defaultInput);
  const topTwo = useMemo(() => {
    const imp = s?.importance ?? {};
    return [...numeric].sort((a, b) => (imp[b.key] ?? 0) - (imp[a.key] ?? 0)).slice(0, 2).map((f) => f.key);
  }, [s?.importance, numeric]);
  const [axes, setAxes] = useState<[string, string] | null>(null);
  const ax = axes ?? ([topTwo[0] ?? numeric[0]?.key, topTwo[1] ?? numeric[1]?.key] as [string, string]);
  const [history, setHistory] = useState<Verification[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const manualQuery = useLab((st) => st.manualQuery);
  const allowance = analystAllowance(inv);

  if (!s)
    return (
      <div className="flex h-full items-center justify-center">
        <Empty icon={<Boxes size={22} />} title="No surrogate model yet" hint="The statistician fits its first surrogate once reconnaissance has collected baseline and validation responses." />
      </div>
    );

  const pred = predict(s.tree, x);
  const path = decisionPath(s.tree, x);

  const verify = async () => {
    setBusy(true);
    setErr(null);
    try {
      const [o] = await manualQuery(inv.id, [x], { title: "What-if verification", design: `Surrogate v${s.version} predicted ${fmtOutput(spec.output, pred)}; queried the black box to verify.`, features: spec.features.map((f) => f.key) });
      setHistory((h) => [{ id: o.id, input: x, predicted: pred, actual: o.output }, ...h].slice(0, 12));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Query failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-wrap items-end gap-6 px-5 pb-4 pt-5">
        <div>
          <div className="label-mono">
            <span className="text-signal">[ 06 ]</span> surrogate model explorer
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
            A glass box that <span className="font-serif font-normal italic text-fg-2">behaves like the black one.</span>
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap gap-6">
          {[
            ["version", `v${s.version}`],
            ["holdout R²", s.fidelity.r2.toFixed(3)],
            ["MAE", fmtOutput(spec.output, s.fidelity.mae)],
            ["leaves", String(s.leaves)],
            ["trained on", `${s.trainedOn} q`],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="font-mono text-lg text-fg">{v}</div>
              <div className="label-mono">{k}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-px border-y border-line bg-line xl:grid-cols-[360px_1fr]">
        {/* what-if */}
        <div className="bg-ink-950 p-5">
          <div className="flex items-center gap-2">
            <Label>What-if console</Label>
            <button type="button" onClick={() => setX(defaultInput)} className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fg-3 hover:text-fg">
              reset
            </button>
          </div>
          <div className="mt-4 rounded-lg border border-line bg-ink-900 p-4">
            <div className="label-mono">surrogate prediction</div>
            <div className="mt-1 font-mono text-3xl text-truth">
              <Ticker value={pred} format={(v) => fmtOutput(spec.output, v, false)} />
            </div>
            <div className="mt-1 font-mono text-[10px] text-fg-4">{spec.output.label} · leaf reached in {path.length - 1} decisions</div>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="signal" size="sm" onClick={verify} disabled={busy || allowance < 1}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Verify against black box
              </Button>
              <Tip content={inv.status === "running" ? "While agents run, only the 4% analyst reserve is available." : "Remaining investigation budget"}>
                <span className="font-mono text-[10px] text-fg-4">1 query · {allowance} left</span>
              </Tip>
            </div>
            {err && <div className="mt-2 text-xs text-alert">{err}</div>}
          </div>
          <div className="mt-4 space-y-3">
            {spec.features.map((f) => {
              const onPath = path.some((id) => findFeature(s.tree, id) === f.key);
              return (
                <div key={f.key}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className={cn(onPath ? "text-fg" : "text-fg-3")}>
                      {f.label}
                      {onPath && <span className="ml-1.5 font-mono text-[9px] text-signal">on path</span>}
                    </span>
                    <span className="font-mono text-[11px] text-fg-2">{fmtFeature(f, x[f.key])}</span>
                  </div>
                  {f.kind === "numeric" ? (
                    <Slider.Root
                      className="relative mt-1.5 flex h-4 w-full touch-none select-none items-center"
                      min={0}
                      max={1000}
                      step={1}
                      value={[Math.round(positionOf(f, x[f.key]) * 1000)]}
                      onValueChange={([v]) => setX({ ...x, [f.key]: valueAt(f, v / 1000) })}
                      aria-label={f.label}
                    >
                      <Slider.Track className="relative h-[3px] grow rounded-full bg-white/[0.08]">
                        <Slider.Range className={cn("absolute h-full rounded-full", onPath ? "bg-signal" : "bg-fg-4")} />
                      </Slider.Track>
                      <Slider.Thumb className={cn("block h-3 w-3 rounded-full border-2 bg-ink-950", onPath ? "border-signal" : "border-fg-3")} />
                    </Slider.Root>
                  ) : (
                    <div className="mt-1.5">
                      <Segmented label={f.label} size="xs" value={String(x[f.key])} onChange={(v) => setX({ ...x, [f.key]: v })} options={f.levels.map((l) => ({ value: l, label: l.replace(/_/g, " ") }))} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-6">
            <Label className="mb-2">Verification log</Label>
            {!history.length ? (
              <div className="text-xs text-fg-4">Verify a prediction to compare the surrogate with the real API.</div>
            ) : (
              <ul className="space-y-1">
                <AnimatePresence initial={false}>
                  {history.map((h) => {
                    const e = h.actual - h.predicted;
                    const rel = Math.abs(e) / (Math.abs(h.actual) || 1);
                    return (
                      <motion.li key={h.id} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-[1fr_auto_auto] gap-3 rounded border border-line px-2.5 py-1.5 font-mono text-[10.5px]">
                        <span className="text-fg-3">
                          pred <span className="text-fg-2">{fmtOutput(spec.output, h.predicted)}</span>
                        </span>
                        <span className="text-fg-3">
                          actual <span className="text-signal">{fmtOutput(spec.output, h.actual)}</span>
                        </span>
                        <span className={rel < 0.05 ? "text-truth" : rel < 0.15 ? "text-amber" : "text-alert"}>{fmtDelta(spec.output, e)}</span>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </div>

        {/* decision surface */}
        <div className="bg-ink-950 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Label>Decision surface</Label>
            <span className="font-mono text-[10px] text-fg-4">other inputs held at the what-if values · click to move the probe</span>
            <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-fg-3">
              <label htmlFor="ax-x">x</label>
              <select id="ax-x" value={ax[0]} onChange={(e) => setAxes([e.target.value, ax[1]])} className="h-7 rounded border border-line bg-ink-900 px-1.5 text-fg">
                {numeric.map((f) => (
                  <option key={f.key} value={f.key} disabled={f.key === ax[1]}>
                    {f.label}
                  </option>
                ))}
              </select>
              <label htmlFor="ax-y">y</label>
              <select id="ax-y" value={ax[1]} onChange={(e) => setAxes([ax[0], e.target.value])} className="h-7 rounded border border-line bg-ink-900 px-1.5 text-fg">
                {numeric.map((f) => (
                  <option key={f.key} value={f.key} disabled={f.key === ax[0]}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {ax[0] && ax[1] ? <Surface inv={inv} x={x} setX={setX} axes={ax} /> : <Empty title="Needs two numeric inputs" />}
        </div>
      </div>

      <div className="grid gap-px border-b border-line bg-line lg:grid-cols-3">
        <div className="bg-ink-950 p-5">
          <Label className="mb-3">Actual vs predicted · {s.evaluatedOn === "validation" ? "validation set (interim)" : "sealed test set, scored once"}</Label>
          <FidelityScatter inv={inv} height={250} />
        </div>
        <div className="bg-ink-950 p-5">
          <Label className="mb-3">Error distribution · actual − predicted</Label>
          <Histogram values={s.residuals.map((r) => r.actual - r.predicted)} format={(v) => fmtDelta(spec.output, v)} color="var(--color-model)" height={170} highlight={0} label="Residual distribution" />
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10.5px]">
            <div>
              <div className="text-fg">{fmtOutput(spec.output, s.fidelity.mae)}</div>
              <div className="text-fg-4">MAE</div>
            </div>
            <div>
              <div className="text-fg">{fmtOutput(spec.output, s.fidelity.rmse)}</div>
              <div className="text-fg-4">RMSE</div>
            </div>
            <div>
              <div className="text-fg">{s.fidelity.n}</div>
              <div className="text-fg-4">{s.evaluatedOn === "validation" ? "validation n" : "test n"}</div>
            </div>
          </div>
        </div>
        <div className="bg-ink-950 p-5">
          <Label className="mb-3">Feature importance · impurity reduction</Label>
          <ImportanceBars inv={inv} />
        </div>
      </div>

      <div className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Label>Interactive decision tree</Label>
          <span className="font-mono text-[10px] text-fg-4">highlighted: the path your what-if input takes · click a split to fold it</span>
        </div>
        <div className="surface rounded-xl p-3">
          <DecisionTree root={s.tree} spec={spec} path={path} height={460} />
        </div>
      </div>
    </div>
  );
}

function findFeature(node: import("@/lib/types").TreeNode, id: number): string | undefined {
  if (node.id === id) return node.feature;
  return (node.left && findFeature(node.left, id)) || (node.right && findFeature(node.right, id)) || undefined;
}

function Surface({ inv, x, setX, axes }: { inv: InvestigationState; x: Input; setX: (x: Input) => void; axes: [string, string] }) {
  const s = inv.surrogate!;
  const spec = inv.target;
  const fu = spec.features.find((f) => f.key === axes[0]) as NumericFeature;
  const fv = spec.features.find((f) => f.key === axes[1]) as NumericFeature;
  const [ref, { width }] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const H = Math.max(300, Math.min(440, width * 0.55));
  const pad = { l: 56, r: 12, t: 12, b: 34 };
  const iw = width - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const ys = inv.observations.map((o) => o.output);
  const lo = Math.min(...ys, spec.output.min);
  const hi = Math.max(...ys, lo + 1);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const gx = 90;
    const gy = 56;
    const cw = iw / gx;
    const ch = ih / gy;
    for (let i = 0; i < gx; i++) {
      for (let j = 0; j < gy; j++) {
        const inp = { ...x, [fu.key]: valueAt(fu, (i + 0.5) / gx), [fv.key]: valueAt(fv, 1 - (j + 0.5) / gy) };
        ctx.fillStyle = surfaceColor((predict(s.tree, inp) - lo) / (hi - lo));
        const x0 = Math.floor(pad.l + i * cw);
        const y0 = Math.floor(pad.t + j * ch);
        ctx.fillRect(x0, y0, Math.floor(pad.l + (i + 1) * cw) - x0, Math.floor(pad.t + (j + 1) * ch) - y0);
      }
    }
    // contours: draw boundaries where adjacent predictions differ
    ctx.strokeStyle = "rgba(233,237,242,0.35)";
    ctx.lineWidth = 1;
    for (let i = 1; i < gx; i++) {
      for (let j = 0; j < gy; j++) {
        const a = predict(s.tree, { ...x, [fu.key]: valueAt(fu, (i - 0.5) / gx), [fv.key]: valueAt(fv, 1 - (j + 0.5) / gy) });
        const b = predict(s.tree, { ...x, [fu.key]: valueAt(fu, (i + 0.5) / gx), [fv.key]: valueAt(fv, 1 - (j + 0.5) / gy) });
        if (a !== b) {
          ctx.beginPath();
          ctx.moveTo(pad.l + i * cw, pad.t + j * ch);
          ctx.lineTo(pad.l + i * cw, pad.t + (j + 1) * ch);
          ctx.stroke();
        }
      }
    }
    for (let j = 1; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const a = predict(s.tree, { ...x, [fu.key]: valueAt(fu, (i + 0.5) / gx), [fv.key]: valueAt(fv, 1 - (j - 0.5) / gy) });
        const b = predict(s.tree, { ...x, [fu.key]: valueAt(fu, (i + 0.5) / gx), [fv.key]: valueAt(fv, 1 - (j + 0.5) / gy) });
        if (a !== b) {
          ctx.beginPath();
          ctx.moveTo(pad.l + i * cw, pad.t + j * ch);
          ctx.lineTo(pad.l + (i + 1) * cw, pad.t + j * ch);
          ctx.stroke();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tree, x, fu, fv, width, H, lo, hi]);

  const px = pad.l + positionOf(fu, x[fu.key]) * iw;
  const py = pad.t + (1 - positionOf(fv, x[fv.key])) * ih;

  return (
    <div ref={ref} className="relative mt-3 w-full" style={{ height: H }}>
      <canvas ref={canvas} style={{ width, height: H }} className="absolute inset-0 rounded" aria-hidden />
      {width > 0 && (
        <svg
          width={width}
          height={H}
          className="absolute inset-0 cursor-crosshair"
          role="img"
          aria-label={`Surrogate prediction over ${fu.label} and ${fv.label}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const u = (e.clientX - r.left - pad.l) / iw;
            const v = 1 - (e.clientY - r.top - pad.t) / ih;
            if (u < 0 || u > 1 || v < 0 || v > 1) return;
            setX({ ...x, [fu.key]: valueAt(fu, u), [fv.key]: valueAt(fv, v) });
          }}
        >
          <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="none" stroke="var(--color-line-2)" />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <AxisLabel x={pad.l + t * iw} y={H - 18} anchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}>
                {fmtFeature(fu, valueAt(fu, t))}
              </AxisLabel>
              <AxisLabel x={pad.l - 6} y={pad.t + (1 - t) * ih + 3} anchor="end">
                {fmtFeature(fv, valueAt(fv, t))}
              </AxisLabel>
            </g>
          ))}
          <AxisLabel x={pad.l + iw / 2} y={H - 3} anchor="middle">
            {labelOf(spec, fu.key).toUpperCase()} →
          </AxisLabel>
          <line x1={px} x2={px} y1={pad.t} y2={pad.t + ih} stroke="var(--color-fg)" strokeOpacity={0.5} strokeDasharray="3 3" />
          <line x1={pad.l} x2={pad.l + iw} y1={py} y2={py} stroke="var(--color-fg)" strokeOpacity={0.5} strokeDasharray="3 3" />
          <circle cx={px} cy={py} r={6} fill="none" stroke="var(--color-fg)" strokeWidth={2} />
          <circle cx={px} cy={py} r={2} fill="var(--color-fg)" />
        </svg>
      )}
      <div className="glass pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-[10px] text-fg-2">
        <Crosshair size={11} />
        <span className="h-2 w-16 rounded-sm" style={{ background: `linear-gradient(90deg, ${surfaceColor(0)}, ${surfaceColor(0.5)}, ${surfaceColor(1)})` }} />
        {fmtOutput(spec.output, lo)} → {fmtOutput(spec.output, hi)}
      </div>
    </div>
  );
}
