"use client";

import { scaleLinear } from "d3-scale";
import { area as d3area, curveMonotoneX, line as d3line } from "d3-shape";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Filter, Loader2, Play } from "lucide-react";
import type { BenchmarkCurve, InvestigationState } from "@/lib/types";
import { useLab } from "@/lib/store";
import { benchmarkVerdict, type BenchVerdict } from "@/lib/bench";
import { fmtOutput } from "@/lib/format";
import { useSize } from "@/components/viz/core";

const KEY = "autopsy:bench-suite:v1";

type Row = {
  targetId: string;
  name: string;
  domain: string;
  status: "queued" | "investigating" | "benchmarking" | "done" | "error";
  used: number;
  limit: number;
  rules: number;
  ignored: number;
  rejected: number;
  r2?: number;
  mae?: string;
  adaptive: BenchmarkCurve;
  random: BenchmarkCurve;
  finals?: { adaptive: number[]; random: number[] };
  benchQueries?: number;
  seconds?: number;
  error?: string;
};
type Saved = { budget: number; at: number; rows: Row[] };

function readSaved(): Saved | null {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Saved | null;
  } catch {
    return null;
  }
}

function rowFrom(inv: InvestigationState, started: number): Row {
  const b = inv.benchmark;
  const rules = inv.report?.rules ?? [];
  const status: Row["status"] = inv.status === "error" ? "error" : inv.status !== "completed" ? "investigating" : !b || b.status === "running" ? "benchmarking" : b.status === "done" ? "done" : "error";
  return {
    targetId: inv.target.id,
    name: inv.target.name,
    domain: inv.target.domain,
    status,
    used: inv.budget.used,
    limit: inv.budget.limit,
    rules: rules.filter((r) => r.kind !== "null").length,
    ignored: rules.filter((r) => r.kind === "null").length,
    rejected: inv.hypotheses.filter((h) => h.status === "rejected").length,
    r2: inv.surrogate?.fidelity.r2,
    mae: inv.surrogate ? fmtOutput(inv.target.output, inv.surrogate.fidelity.mae) : undefined,
    adaptive: b?.adaptive ?? [],
    random: b?.random ?? [],
    finals: b?.finals,
    benchQueries: b?.queriesUsed,
    seconds: status === "done" ? Math.round((Date.now() - started) / 100) / 10 : undefined,
    error: inv.error ?? b?.error,
  };
}

const RUNS = 3;

function verdictOf(r: Row): BenchVerdict | null {
  return r.status === "done" && r.finals ? benchmarkVerdict({ finals: r.finals }) : null;
}

function VerdictCell({ v }: { v: BenchVerdict | null }) {
  if (!v) return <>—</>;
  const tone = v.label === "adaptive lower" ? "s-good" : v.label === "random lower" ? "s-bad" : "s-warn";
  const text = v.label === "inconclusive" ? `mixed · adaptive lower in ${v.adaptiveWins}/${v.runs}` : `${v.label} · ${v.adaptiveWins}/${v.runs} runs`;
  return <span className={tone}>{text}</span>;
}

export function BenchmarkSuite() {
  const targets = useLab((s) => s.targets);
  const investigations = useLab((s) => s.investigations);
  const [budget, setBudget] = useState(1000);
  const [runIds, setRunIds] = useState<Record<string, string>>({});
  const [started, setStarted] = useState(0);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [focus, setFocus] = useState<string>("meridian-credit");
  // opt-in only: connected external APIs get thousands of real requests, and the Python
  // engine's benchmark replays full multi-agent runs (several minutes per target)
  const [includeExternal, setIncludeExternal] = useState(false);
  const [includePython, setIncludePython] = useState(false);
  const externalCount = (targets ?? []).filter((t) => t.origin === "external").length;
  const pythonCount = (targets ?? []).filter((t) => t.origin === "python").length;
  const benchStarted = useRef(new Set<string>());
  const auto = useRef(false);

  const running = Object.keys(runIds).length > 0;
  const liveRows = useMemo(() => Object.values(runIds).map((id) => investigations[id]).filter((x): x is InvestigationState => !!x).map((inv) => rowFrom(inv, started)), [runIds, investigations, started]);
  const rows: Row[] = running ? liveRows : saved?.rows ?? [];

  const run = () => {
    const st = useLab.getState();
    if (!st.targets) return;
    benchStarted.current.clear();
    const ids: Record<string, string> = {};
    for (const t of st.targets) {
      if (t.origin === "external" && !includeExternal) continue;
      if (t.origin === "python" && !includePython) continue;
      const id = st.create({ target: t, budget, pace: "instant", ephemeral: true });
      st.start(id);
      ids[t.id] = id;
    }
    setStarted(Date.now());
    setRunIds(ids);
  };

  // once an investigation completes, measure adaptive vs random sampling on the same target
  useEffect(() => {
    for (const id of Object.values(runIds)) {
      const inv = investigations[id];
      if (inv?.status === "completed" && !benchStarted.current.has(id)) {
        benchStarted.current.add(id);
        useLab.getState().runBenchmark(id, RUNS);
      }
    }
    if (running && liveRows.length && liveRows.every((r) => r.status === "done" || r.status === "error")) {
      const result: Saved = { budget, at: Date.now(), rows: liveRows };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(result));
      } catch {
        /* storage is best effort */
      }
      const t = setTimeout(() => {
        setSaved(result);
        setRunIds({});
      }, 0);
      return () => clearTimeout(t);
    }
  }, [investigations, runIds, running, liveRows, budget]);

  // show cached results if this browser has run the suite before; otherwise run it now
  useEffect(() => {
    if (auto.current || !targets) return;
    // mark as started only when the timer fires: React (Strict Mode) runs this effect twice
    // and cancels the first timer, so setting the flag up front meant the suite never started
    const t = setTimeout(() => {
      if (auto.current) return;
      auto.current = true;
      const cached = readSaved();
      if (cached) {
        setSaved(cached);
        setBudget(cached.budget);
      } else run();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets]);

  const done = rows.filter((r) => r.status === "done");
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const kpis = {
    r2: mean(done.map((r) => r.r2 ?? 0)),
    rules: done.length ? done.reduce((s, r) => s + r.rules, 0) : undefined,
    queries: mean(done.map((r) => r.used)),
    verdicts: done.map(verdictOf).filter((v): v is BenchVerdict => !!v),
    benchQueries: done.reduce((s, r) => s + (r.benchQueries ?? 0), 0),
  };
  const focusRow = rows.find((r) => r.targetId === focus) ?? rows[0];

  return (
    <div>
      <div className="s-kpis">
        {[
          ["Held-out R² (mean)", kpis.r2 !== undefined ? kpis.r2.toFixed(3) : null, "Predictive fit on each target's sealed test set; not accuracy or rules recovered", "pk"],
          ["Supported patterns", kpis.rules !== undefined ? String(kpis.rules) : null, "All synthetic targets; demonstration, not real-world validation", ""],
          ["Investigation queries", kpis.queries !== undefined ? Math.round(kpis.queries).toLocaleString() : null, `Mean per target, of a ${(saved?.budget ?? budget).toLocaleString()} budget`, "s-good"],
          [
            "Adaptive lower in all runs",
            kpis.verdicts.length ? `${kpis.verdicts.filter((v) => v.label === "adaptive lower").length} / ${kpis.verdicts.length}` : null,
            kpis.verdicts.length
              ? `targets · ${kpis.verdicts.filter((v) => v.label === "inconclusive").length} mixed, ${kpis.verdicts.filter((v) => v.label === "random lower").length} favour random · ${kpis.benchQueries.toLocaleString()} separate benchmark queries`
              : "Equal training budgets, shared held-out set, per-run comparison",
            "",
          ],
        ].map(([k, v, d, tone]) => (
          <div key={k as string} className="s-kpi">
            <span className="s-label">{k}</span>
            <b className={tone as string}>{v ?? <span className="inline-block h-9 w-28 animate-pulse rounded-lg bg-white/[0.06] align-middle" />}</b>
            <p>{d}</p>
          </div>
        ))}
      </div>

      <div className="s-bar mt-8">
        <span className="s-label inline-flex items-center gap-2">
          <Filter size={13} /> Curve target:
        </span>
        {rows.map((r) => (
          <button key={r.targetId} type="button" className="s-fchip" aria-pressed={r.targetId === focusRow?.targetId} onClick={() => setFocus(r.targetId)}>
            {r.name}
          </button>
        ))}
        {(pythonCount > 0 || externalCount > 0) && (
          <span className="ml-auto inline-flex flex-wrap items-center gap-4 text-[12px] text-[var(--s-fg-3)]">
            {pythonCount > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-2" title="Runs the Python engine's own benchmark: full multi-agent replays, several minutes per target.">
                <input type="checkbox" checked={includePython} onChange={(e) => setIncludePython(e.target.checked)} disabled={running} />
                Include Python agent targets ({pythonCount}) · slow, ~15 min
              </label>
            )}
            {externalCount > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-2" title="Each connected API receives thousands of real requests (investigation plus benchmark).">
                <input type="checkbox" checked={includeExternal} onChange={(e) => setIncludeExternal(e.target.checked)} disabled={running} />
                Include my connected APIs ({externalCount}) · sends real requests
              </label>
            )}
          </span>
        )}
        <span className={pythonCount > 0 || externalCount > 0 ? "s-label" : "ml-auto s-label"}>Budget:</span>
        {[600, 1000, 1500].map((b) => (
          <button key={b} type="button" className="s-fchip" aria-pressed={b === budget} onClick={() => setBudget(b)} disabled={running}>
            {b}
          </button>
        ))}
        <button type="button" className="s-btn s-btn-accent s-btn-sm" onClick={run} disabled={running || !targets}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />} {running ? "Running suite…" : saved ? "Re-run suite" : "Run suite"}
        </button>
      </div>

      <div className="s-table-wrap mt-6">
        <table className="s-table">
          <thead>
            <tr>
              <th>Black-box target</th>
              <th>Status</th>
              <th>Queries</th>
              <th>Patterns</th>
              <th>No detectable effect</th>
              <th>Rejected</th>
              <th>Held-out R²</th>
              <th>MAE</th>
              <th>Adaptive vs random (final RMSE)</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={9} className="text-center">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Preparing the suite…
                  </span>
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const v = verdictOf(r);
              return (
                <tr key={r.targetId} className={r.targetId === focusRow?.targetId ? "is-lead" : undefined}>
                  <td>
                    <span className="inline-flex items-center gap-2.5">
                      {r.status === "done" ? <CheckCircle2 size={15} className="pk" /> : <span className="s-dot" style={{ background: "var(--s-fg-4)", boxShadow: "none" }} />}
                      {r.name}
                    </span>
                    <div className="s-small mt-1">{r.domain}</div>
                  </td>
                  <td>
                    {r.status === "done" ? (
                      <span className="s-good">complete{r.seconds ? ` · ${r.seconds}s` : ""}</span>
                    ) : r.status === "error" ? (
                      <span className="s-bad" title={r.error}>
                        error{r.error ? <span className="mt-1 block max-w-[260px] text-[11px] leading-snug opacity-80">{r.error}</span> : null}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 pk">
                        <Loader2 size={12} className="animate-spin" /> {r.status}
                      </span>
                    )}
                  </td>
                  <td>
                    {r.used.toLocaleString()} <span className="text-[var(--s-fg-4)]">/ {r.limit.toLocaleString()}</span>
                  </td>
                  <td>{r.status === "done" ? <span className="s-pill-val is-accent">{r.rules}</span> : "—"}</td>
                  <td>{r.status === "done" ? r.ignored : "—"}</td>
                  <td>{r.status === "done" ? r.rejected : "—"}</td>
                  <td className={r.r2 !== undefined && r.r2 >= 0.9 ? "s-good" : r.r2 !== undefined ? "s-warn" : ""}>{r.r2 !== undefined ? r.r2.toFixed(3) : "—"}</td>
                  <td>{r.mae ?? "—"}</td>
                  <td>{v ? <VerdictCell v={v} /> : r.status === "done" && !r.finals ? <span className="text-[var(--s-fg-4)]">re-run for per-run results</span> : r.adaptive.length ? "measuring…" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="s-panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[15px] text-white">LEARNING CURVES — {focusRow?.name.toUpperCase() ?? "…"}</div>
              <p className="s-small mt-1">Held-out RMSE vs training queries per strategy · lines are means over {RUNS} runs · bands are min–max across runs, not confidence intervals</p>
            </div>
            <span className={`s-live ${running ? "" : "is-idle"}`}>{running ? "measuring" : saved ? `measured ${new Date(saved.at).toLocaleDateString()}` : "pending"}</span>
          </div>
          <div className="mt-6">{focusRow && focusRow.adaptive.length > 1 ? <Curves row={focusRow} /> : <div className="grid h-[280px] place-items-center s-small">Curves appear when this target&rsquo;s benchmark finishes.</div>}</div>
          <div className="mt-3 flex gap-5 text-[12px] text-[var(--s-fg-3)]">
            <span>
              <span className="pk">━</span> adaptive (uncertainty × diversity)
            </span>
            <span>┅ random sampling</span>
          </div>
        </div>
        <div className="s-panel-sm">
          <span className="s-label-accent">How this suite works</span>
          <ol className="mt-4 grid gap-4 text-[13.5px] leading-relaxed text-[var(--s-fg-2)]">
            <li>
              <span className="pk mr-2">01</span>A full investigation runs on every target at maximum pace, in parallel web workers.
            </li>
            <li>
              <span className="pk mr-2">02</span>Held-out R² is the final surrogate&rsquo;s predictive fit on a sealed test set, scored once. It is not accuracy and not the share of rules recovered.
            </li>
            <li>
              <span className="pk mr-2">03</span>Adaptive and random sampling get equal training budgets: the same 20 seed queries plus 16 per round for 10 rounds, in each of {RUNS} runs. Both are scored on one shared held-out set of 120 random queries. A target counts as &ldquo;adaptive lower&rdquo; only if that holds in every run; otherwise it is reported as mixed.
            </li>
            <li>
              <span className="pk mr-2">04</span>Benchmark queries are counted separately from investigation budgets. Results are cached in this browser; responses are noisy, so numbers vary between runs.
            </li>
            <li>
              <span className="pk mr-2">05</span>Only the built-in synthetic targets are included, so this suite demonstrates the method; it is not real-world validation.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function Curves({ row }: { row: Row }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const H = 280;
  const all = [...row.adaptive, ...row.random];
  const pad = { l: 56, r: 12, t: 10, b: 28 };
  const x = scaleLinear().domain([Math.min(...all.map((d) => d.n)), Math.max(...all.map((d) => d.n))]).range([pad.l, Math.max(pad.l + 10, width - pad.r)]);
  const y = scaleLinear().domain([0, Math.max(...all.map((d) => d.hi)) * 1.08]).range([H - pad.b, pad.t]).nice();
  const band = d3area<BenchmarkCurve[number]>().x((d) => x(d.n)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(curveMonotoneX);
  const ln = d3line<BenchmarkCurve[number]>().x((d) => x(d.n)).y((d) => y(d.rmse)).curve(curveMonotoneX);
  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`Learning curves for ${row.name}`}>
          {y.ticks(4).map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.07)" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#6c6870">
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          {x.ticks(6).map((t) => (
            <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize={11} fill="#6c6870">
              {t}
            </text>
          ))}
          <path d={band(row.random) ?? ""} fill="#ffffff" fillOpacity={0.06} />
          <path d={band(row.adaptive) ?? ""} fill="#ffb55e" fillOpacity={0.14} />
          <path d={ln(row.random) ?? ""} fill="none" stroke="#b9b4b8" strokeWidth={1.6} strokeDasharray="5 5" />
          <path d={ln(row.adaptive) ?? ""} fill="none" stroke="#ffb55e" strokeWidth={2.2} style={{ filter: "drop-shadow(0 0 6px rgb(255 181 94 / 0.6))" }} />
          {row.adaptive.map((d) => (
            <rect key={d.n} x={x(d.n) - 3} y={y(d.rmse) - 3} width={6} height={6} fill="#ffb55e">
              <title>{`adaptive · ${d.n} queries · RMSE ${d.rmse.toFixed(2)}`}</title>
            </rect>
          ))}
          {row.random.map((d) => (
            <rect key={d.n} x={x(d.n) - 2.5} y={y(d.rmse) - 2.5} width={5} height={5} fill="#b9b4b8">
              <title>{`random · ${d.n} queries · RMSE ${d.rmse.toFixed(2)}`}</title>
            </rect>
          ))}
        </svg>
      )}
    </div>
  );
}
