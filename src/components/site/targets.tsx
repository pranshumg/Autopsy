"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Code2, Loader2, Search, Zap } from "lucide-react";
import type { Input, QueryResponse, TargetSpec } from "@/lib/types";
import { useLab } from "@/lib/store";
import { describeInput, fmtFeature, fmtOutput } from "@/lib/format";
import { randomInput } from "@/lib/engine/design";
import { mulberry32 } from "@/lib/engine/stats";

export function TargetCatalog() {
  const targets = useLab((s) => s.targets);
  const error = useLab((s) => s.targetsError);
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState("All");
  const domains = useMemo(() => ["All", ...new Set((targets ?? []).map((t) => t.domain))], [targets]);
  const list = (targets ?? []).filter((t) => (domain === "All" || t.domain === domain) && (!q.trim() || JSON.stringify([t.name, t.description, t.domain, t.features.map((f) => [f.key, f.label])]).toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <div>
      <div className="s-bar">
        <label className="s-search">
          <Search size={15} className="text-[var(--s-fg-3)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search targets by name, field, or domain…" aria-label="Search targets" />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by domain">
          {domains.map((d) => (
            <button key={d} type="button" className="s-fchip" aria-pressed={d === domain} onClick={() => setDomain(d)}>
              {d}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="s-bad mt-6">Could not load the target registry: {error}</p>}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {!targets && !error && [0, 1].map((i) => <div key={i} className="s-card h-[560px] animate-pulse" />)}
        {list.map((t) => (
          <TargetCard key={t.id} t={t} />
        ))}
        {targets && !list.length && <p className="s-small">No target matches “{q}”.</p>}
      </div>
    </div>
  );
}

function TargetCard({ t }: { t: TargetSpec }) {
  const [probe, setProbe] = useState<{ x: Input; y: number; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(1);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const x = randomInput(t, mulberry32(Date.now() % 2 ** 31));
      const started = performance.now();
      const res = await fetch(`/api/targets/${t.id}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: [x] }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as QueryResponse;
      setProbe({ x, y: data.outputs[0], ms: Math.round(performance.now() - started) });
      setN((v) => v + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Query failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="s-card p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="s-label-accent">[ {t.domain} ]</div>
          <h2 className="mt-2 text-[24px] text-white">{t.name}</h2>
        </div>
        <span className="s-pill-val">{t.version}</span>
      </div>
      <p className="s-body mt-4 !text-[14.5px]">{t.description}</p>

      <div className="mt-5 rounded-2xl border border-white/10 bg-[#080708] p-4">
        <div className="s-label">Documented input schema · {t.features.length} fields</div>
        <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {t.features.map((f) => (
            <div key={f.key} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-[var(--s-fg-2)]">{f.label}</span>
              <span className="s-mono truncate text-[11.5px] text-[var(--s-fg-3)]">{f.kind === "numeric" ? `${fmtFeature(f, f.min)}–${fmtFeature(f, f.max)}` : `${f.levels.length} levels`}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-[#080708] p-4">
        <div className="s-label">Observable output</div>
        <div className="mt-2 text-[13.5px] pk">
          {t.output.label} · {t.output.key} ({t.output.unit}) · range {fmtOutput(t.output, t.output.min)}–{fmtOutput(t.output, t.output.max)}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-[12.5px] text-[var(--s-fg-3)]">
        <Code2 size={14} className="pk" /> Endpoint: <span className="s-mono text-[var(--s-fg-2)]">POST {t.endpoint}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[t.stochastic ? "stochastic" : "deterministic", "rules hidden", "≤64 inputs / call", t.vendor.replace(" (synthetic)", "")].map((c) => (
          <span key={c} className="s-mono rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-[var(--s-fg-3)]">
            {c}
          </span>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-4" aria-live="polite">
        {probe ? (
          <>
            <div className="flex items-center justify-between text-[12px] text-[var(--s-fg-3)]">
              <span>Probe #{n - 1} · random valid input · {probe.ms}ms</span>
              <span className="text-[20px] text-white">{fmtOutput(t.output, probe.y, false)}</span>
            </div>
            <div className="s-mono mt-2 text-[11px] leading-relaxed text-[var(--s-fg-4)]">{describeInput(t, probe.x)}</div>
          </>
        ) : (
          <div className="text-[12.5px] text-[var(--s-fg-3)]">{err ? <span className="s-bad">Probe failed: {err}</span> : "Send one random, schema-valid input to the live endpoint and read its answer."}</div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link href={`/lab?target=${t.id}`} className="s-btn s-btn-accent s-btn-sm">
          Investigate <ArrowRight size={13} />
        </Link>
        <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={run} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Probe once
        </button>
      </div>
    </article>
  );
}
