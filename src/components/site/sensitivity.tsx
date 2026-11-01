"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Grid3x3, RefreshCw } from "lucide-react";
import type { Feature, Input, TargetSpec } from "@/lib/types";
import { useLab } from "@/lib/store";
import { createAdapter } from "@/lib/adapter";
import { fmtDelta, fmtFeature, fmtOutput } from "@/lib/format";
import { valueAt } from "@/lib/engine/design";

const COLS = 8;

type Cell = { f: Feature; x: Input; level: string; y: number } | null;
type Result = { cells: Cell[][]; base: number; latency: number; at: number };

/** A neutral applicant near the middle of every documented range. */
function baseInput(spec: TargetSpec): Input {
  return Object.fromEntries(spec.features.map((f) => [f.key, f.kind === "numeric" ? valueAt(f, f.key === "dti" ? 0.45 : 0.5) : f.levels[0]]));
}

/** One live batch: every field swept across eight levels while the rest stay at the base. */
function design(spec: TargetSpec) {
  const base = baseInput(spec);
  const rows = spec.features.map((f) => {
    const levels = f.kind === "numeric" ? Array.from({ length: COLS }, (_, i) => valueAt(f, i / (COLS - 1))) : f.levels;
    return levels.map((v) => ({ f, x: { ...base, [f.key]: v } as Input, level: fmtFeature(f, v) }));
  });
  return { base, rows };
}

export function SensitivityMatrix() {
  const targets = useLab((s) => s.targets);
  const [targetId, setTargetId] = useState("meridian-credit");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const spec = targets?.find((t) => t.id === targetId);

  const run = useCallback(async (s: TargetSpec) => {
    setBusy(true);
    setError(null);
    try {
      const { base, rows } = design(s);
      const flat = [base, ...rows.flat().map((c) => c.x)].slice(0, 64);
      const started = performance.now();
      // same query path as the lab: built-in, Python-engine and external targets each have their own route
      const data = await createAdapter(s, { origin: window.location.origin, credential: useLab.getState().credentials[s.id] }).query(flat);
      let k = 1;
      const cells: Cell[][] = rows.map((row) => Array.from({ length: COLS }, (_, i) => (row[i] && k < data.outputs.length ? { ...row[i], y: data.outputs[k++] } : null)));
      setResults((r) => ({ ...r, [s.id]: { cells, base: data.outputs[0], latency: Math.round(performance.now() - started), at: Date.now() } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const current = spec ? results[spec.id] : undefined;
  // probe each target once, the first time it is shown
  useEffect(() => {
    if (!spec || results[spec.id] || busy) return;
    const t = setTimeout(() => void run(spec), 0);
    return () => clearTimeout(t);
  }, [spec, results, busy, run]);

  const stats = useMemo(() => {
    if (!current || !spec) return null;
    const all = current.cells.flat().filter((c): c is NonNullable<Cell> => !!c);
    const max = Math.max(...all.map((c) => c.y), 1e-9);
    const floor = spec.output.min;
    const levers = current.cells
      .map((row, i) => {
        const ys = row.filter((c): c is NonNullable<Cell> => !!c).map((c) => c.y);
        return { f: spec.features[i], range: Math.max(...ys) - Math.min(...ys), floors: ys.filter((y) => y <= floor + 1e-9).length };
      })
      .sort((a, b) => b.range - a.range);
    return { max, floor, levers, floors: all.filter((c) => c.y <= floor + 1e-9).length };
  }, [current, spec]);

  const hovered = hover && current ? current.cells[hover.r]?.[hover.c] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="s-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 text-[15px] text-white">
              <Grid3x3 size={16} className="pk" /> SENSITIVITY MATRIX — {spec?.name.toUpperCase() ?? "…"}
            </div>
            <p className="s-small mt-1">Each row sweeps one field across its documented range · all other fields held at a neutral base</p>
          </div>
          <span className={`s-live ${busy ? "" : "is-idle"}`}>{busy ? "querying" : current ? `${current.cells.flat().filter(Boolean).length + 1} live queries · ${current.latency}ms` : "idle"}</span>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="s-tabs" role="tablist" aria-label="Black-box target">
            {(targets ?? []).map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={t.id === targetId} onClick={() => setTargetId(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
          <button type="button" className="s-fchip inline-flex items-center gap-2" onClick={() => spec && run(spec)} disabled={busy || !spec}>
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Re-sample
          </button>
        </div>
        <div className="mt-6 border-t border-white/10 pt-6">
          {error && <div className="s-bad text-sm">Live query failed: {error}</div>}
          {!current && !error && (
            <div className="s-matrix" style={{ gridTemplateColumns: `120px repeat(${COLS}, minmax(0, 1fr))` }}>
              {Array.from({ length: 8 * (COLS + 1) }).map((_, i) => (
                <div key={i} className="s-cell animate-pulse" />
              ))}
            </div>
          )}
          {current && spec && stats && (
            <div className="s-matrix" style={{ gridTemplateColumns: `minmax(92px, 120px) repeat(${COLS}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
              {current.cells.map((row, r) => (
                <div key={spec.features[r].key} className="contents">
                  <div className="flex items-center truncate pr-2 text-[12.5px] text-[var(--s-fg-2)]" title={spec.features[r].label}>
                    {spec.features[r].label}
                  </div>
                  {row.map((c, i) => {
                    if (!c) return <div key={i} className="s-cell opacity-30">·</div>;
                    const v = c.y / stats.max;
                    const isFloor = c.y <= stats.floor + 1e-9;
                    const cls = isFloor ? "is-floor" : v >= 0.68 ? "is-hot" : v >= 0.4 ? "is-warm" : "";
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`s-cell ${cls}`}
                        onMouseEnter={() => setHover({ r, c: i })}
                        onFocus={() => setHover({ r, c: i })}
                        aria-label={`${c.f.label} ${c.level}: ${fmtOutput(spec.output, c.y)}`}
                      >
                        {isFloor ? "0" : v.toFixed(2).replace(/^0/, "")}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-between text-[11px] text-[var(--s-fg-4)]">
            <span>MIN OF RANGE</span>
            <span>values = response ÷ matrix max · 0 = floor</span>
            <span>MAX OF RANGE</span>
          </div>
        </div>
        <div className="s-readout">
          {hovered && spec && current ? (
            <>
              <span>
                {hovered.f.label} = <span className="text-white">{hovered.level}</span>
              </span>
              <span className="pk">
                {fmtOutput(spec.output, hovered.y)} · {fmtDelta(spec.output, hovered.y - current.base)} vs base
              </span>
            </>
          ) : (
            <>
              <span>Hover any cell to read the black box&rsquo;s actual response</span>
              <span className="pk">{spec ? `base ${current ? fmtOutput(spec.output, current.base) : "…"}` : ""}</span>
            </>
          )}
        </div>
      </div>

      <div className="grid content-start gap-5">
        <div className="s-panel-sm">
          <div className="flex items-center justify-between">
            <span className="s-label-accent">Strongest lever</span>
            {stats && <span className="rounded-full border border-[rgb(82_224_161/0.35)] px-2.5 py-0.5 text-[12px] s-good">live</span>}
          </div>
          <div className="mt-3 text-[24px] text-white">{stats ? stats.levers[0].f.label : "Measuring…"}</div>
          <p className="s-small mt-1">{stats && spec ? `Swinging it across its range moves ${spec.output.label.toLowerCase()} by ${fmtOutput(spec.output, stats.levers[0].range)}${stats.levers[0].floors ? `, and ${stats.levers[0].floors} of its levels hit the floor` : ""}.` : "Reading the first batch of responses."}</p>
        </div>
        <div className="s-panel-sm">
          <span className="s-label">Probe formulation</span>
          <div className="s-formula">Δⱼ(v) = f(x₀ | xⱼ = v) − f(x₀)   for v ∈ range(xⱼ)</div>
          <p className="s-small mt-3">This is a one-shot screen. Inside the lab, agents repeat it on many subjects, test each difference with sign-flip permutation tests, and localize thresholds by bisection.</p>
        </div>
        <div className="s-panel-sm">
          <div className="flex items-center justify-between">
            <span className="s-label">Ranked sensitivities</span>
            <span className="s-small">{stats ? `${stats.floors} floor events` : ""}</span>
          </div>
          <div className="mt-3">
            {(stats?.levers.slice(0, 3) ?? []).map((l, i) => (
              <div key={l.f.key} className="s-match">
                <div>
                  <div className="text-[14px] text-white">
                    <span className="pk mr-2">0{i + 1}</span>
                    {l.f.label}
                  </div>
                  <div className="s-small">{l.f.kind === "numeric" ? "numeric" : `${l.f.levels.length} levels`}</div>
                </div>
                <span className="s-good text-[14px]">{spec ? fmtOutput(spec.output, l.range) : ""}</span>
              </div>
            ))}
            {!stats && <div className="s-small">Waiting for responses…</div>}
          </div>
        </div>
        <Link href="/lab" className="s-btn s-btn-dark w-full">
          Run a full investigation in the lab <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
