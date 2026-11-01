"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpenText, Boxes, Database, FlaskConical, Gauge, Layers, Play, RotateCcw, ScrollText, ShieldCheck, Zap } from "lucide-react";
import { PHASES, type InvestigationState } from "@/lib/types";
import { useLab } from "@/lib/store";
import { fmtFeature, fmtOutput, fmtTime, featureOf } from "@/lib/format";
import { AGENT_META, H_STATUS } from "@/components/meta";
import { Ticker } from "@/components/ui";

type Tab = "terminal" | "queries" | "hypotheses" | "phases";

const SRC_COLOR: Record<string, string> = {
  system: "#8f8a92",
  target: "#ffb55e",
  persona: "#9fd8ff",
  experimenter: "#ffb59a",
  statistician: "#c8b6ff",
  reporter: "#9ff0c4",
};

export function LiveConsole() {
  const targets = useLab((s) => s.targets);
  const [id, setId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("meridian-credit");
  const [budget, setBudget] = useState(800);
  const [tab, setTab] = useState<Tab>("terminal");
  const inv = useLab((s) => (id ? s.investigations[id] : undefined));
  const router = useRouter();
  const started = useRef(false);

  const launch = (tid = targetId, b = budget) => {
    const st = useLab.getState();
    const t = st.targets?.find((x) => x.id === tid);
    if (!t) return;
    if (id && st.investigations[id]?.status === "running") st.cancel(id);
    const next = st.create({ target: t, budget: b, pace: "standard", ephemeral: true });
    st.start(next);
    setTargetId(tid);
    setId(next);
  };

  useEffect(() => {
    if (!targets || started.current) return;
    started.current = true;
    const t = setTimeout(() => launch("meridian-credit"), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets]);

  const open = (view = "") => {
    if (!inv) return;
    useLab.getState().adopt(inv.id);
    router.push(`/lab/${inv.id}${view ? `/${view}` : ""}`);
  };

  const supported = inv?.hypotheses.filter((h) => h.status === "supported").length ?? 0;
  const spec = inv?.target ?? targets?.find((t) => t.id === targetId);

  return (
    <>
      <div className="s-page-head s-rise">
        <div>
          <div className="s-crumbs">
            <Link href="/" className="inline-flex items-center gap-1.5">
              <ArrowLeft size={13} /> Home
            </Link>
            <span>/</span>
            <b>Live Investigation</b>
            <span className="inline-flex items-center gap-1.5 s-good">
              <span className="s-dot" /> Engine online
            </span>
          </div>
          <h1 className="s-h1">
            Live black-box
            <br />
            <span className="pk">investigation console.</span>
          </h1>
          <p className="s-lede">Four agents query a synthetic decision system from a web worker in this tab. Watch screening, threshold hunting and hypothesis testing happen, then open the run in the full laboratory.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          {[
            ["queries", inv ? <Ticker key="q" value={inv.budget.used} /> : "—"],
            ["experiments", inv ? <Ticker key="e" value={inv.experiments.length} /> : "—"],
            ["supported", inv ? <Ticker key="s" value={supported} /> : "—"],
            ["fidelity R²", inv?.surrogate ? <Ticker key="r" value={inv.surrogate.fidelity.r2} format={(v) => v.toFixed(3)} /> : "—"],
          ].map(([k, v]) => (
            <div key={k as string} className="s-kpi-mini">
              <b>{v}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="s-bar mt-12">
        <span className="s-label inline-flex items-center gap-2">
          <Zap size={13} className="pk" /> Run a target:
        </span>
        {(targets ?? []).map((t) => (
          <button key={t.id} type="button" className="s-fchip inline-flex items-center gap-2" aria-pressed={t.id === targetId} onClick={() => launch(t.id)}>
            <Play size={11} fill="currentColor" /> {t.name}
          </button>
        ))}
        <span className="ml-auto s-label">Budget</span>
        {[500, 800, 1200].map((b) => (
          <button key={b} type="button" className="s-fchip" aria-pressed={b === budget} onClick={() => setBudget(b)}>
            {b}
          </button>
        ))}
      </div>

      <div className="s-card mt-6 !rounded-[28px]">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-4">
          {(targets ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => launch(t.id)}
              className={`rounded-full px-4 py-1.5 text-[12.5px] transition-colors ${t.id === targetId ? "bg-white text-black" : "text-[var(--s-fg-3)] hover:text-white"}`}
            >
              <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${t.id === targetId ? "bg-[var(--s-accent)]" : "bg-[var(--s-fg-4)]"}`} />
              {t.id}.endpoint
            </button>
          ))}
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={() => open("rulebook")} disabled={!inv?.report}>
              <BookOpenText size={13} /> Rulebook
            </button>
            <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={() => launch()} disabled={!targets}>
              <RotateCcw size={13} /> Restart
            </button>
            <button type="button" className="s-btn s-btn-accent s-btn-sm" onClick={() => open()} disabled={!inv}>
              Open in Lab <ArrowRight size={13} />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-white/10 px-5 py-3 text-[12px] text-[var(--s-fg-3)]">
          {[
            [Database, "TARGET", spec ? `${spec.name} ${spec.version}` : "—"],
            [Layers, "DOMAIN", spec?.domain ?? "—"],
            [Gauge, "OUTPUT", spec ? `${spec.output.key} (${spec.output.unit})` : "—"],
            [FlaskConical, "PHASE", inv?.phase ? PHASES.find((p) => p.id === inv.phase)?.label : inv?.status ?? "—"],
            [ShieldCheck, "BUDGET", inv ? `${inv.budget.used} / ${inv.budget.limit}` : "—"],
          ].map(([Icon, k, v]) => {
            const I = Icon as typeof Database;
            return (
              <span key={k as string} className="inline-flex items-center gap-2">
                <I size={13} /> {k as string} <span className="text-white">{v as string}</span>
              </span>
            );
          })}
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 border-white/10 lg:border-r">
            <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-3" role="tablist" aria-label="Console view">
              {(
                [
                  ["terminal", ScrollText, "Agent terminal"],
                  ["queries", Database, "Query stream"],
                  ["hypotheses", FlaskConical, "Hypotheses"],
                  ["phases", Layers, "Phases"],
                ] as const
              ).map(([k, I, l]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-[13px] transition-colors ${tab === k ? "border-[var(--s-accent)] text-white" : "border-transparent text-[var(--s-fg-3)] hover:text-white"}`}
                >
                  <I size={14} /> {l}
                </button>
              ))}
            </div>
            <div className="h-[520px] overflow-hidden p-5">
              {!inv ? <div className="s-small">Starting the engine…</div> : tab === "terminal" ? <Terminal inv={inv} /> : tab === "queries" ? <Queries inv={inv} /> : tab === "hypotheses" ? <Hyps inv={inv} /> : <Phases inv={inv} />}
            </div>
          </div>
          <aside className="p-5" aria-label="Recovered rules">
            <Recovered inv={inv} />
          </aside>
        </div>
        <div className="flex flex-wrap justify-between gap-3 border-t border-white/10 px-5 py-3 text-[12px] text-[var(--s-fg-4)]">
          <span>{spec ? `${spec.vendor} · decision logic hidden server-side` : ""}</span>
          <span className="inline-flex items-center gap-2" role="status">
            <span className="s-dot" style={inv?.status === "running" ? undefined : { background: "var(--s-accent)", boxShadow: "0 0 8px var(--s-accent)" }} />
            {inv ? (inv.status === "running" ? `Running · ${inv.phase ?? "starting"}` : inv.status === "completed" ? "Investigation complete" : inv.status) : "Idle"}
          </span>
        </div>
      </div>
    </>
  );
}

function useFollow(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

function Terminal({ inv }: { inv: InvestigationState }) {
  const lines = inv.logs.slice(-160);
  const ref = useFollow(lines.length);
  return (
    <div ref={ref} className="s-mono h-full overflow-y-auto text-[12.5px] leading-[22px]" role="log" aria-label="Agent terminal">
      {lines.map((l) => (
        <div key={l.id} className="flex gap-4">
          <span className="shrink-0 text-[var(--s-fg-4)]">{fmtTime(l.t).slice(0, 8)}</span>
          <span className="w-[100px] shrink-0 uppercase" style={{ color: SRC_COLOR[l.source] }}>
            {l.source}
          </span>
          <span className={l.level === "ok" ? "text-[#9ff0c4]" : l.level === "warn" ? "text-[var(--s-warn)]" : l.level === "error" ? "text-[var(--s-bad)]" : "text-[var(--s-fg-2)]"}>{l.text}</span>
        </div>
      ))}
      {inv.status === "running" && <div className="pk animate-pulse">▍</div>}
    </div>
  );
}

function Queries({ inv }: { inv: InvestigationState }) {
  const rows = inv.observations.slice(-60);
  const ref = useFollow(rows.length);
  const keys = inv.target.features.slice(0, 5).map((f) => f.key);
  return (
    <div ref={ref} className="h-full overflow-auto">
      <table className="s-mono w-full min-w-[640px] text-[12px]">
        <thead className="sticky top-0 bg-[#050505] text-left text-[var(--s-fg-4)]">
          <tr>
            <th className="py-2 pr-3 font-normal">#</th>
            <th className="py-2 pr-3 font-normal">source</th>
            {keys.map((k) => (
              <th key={k} className="py-2 pr-3 font-normal">
                {k}
              </th>
            ))}
            <th className="py-2 text-right font-normal pk">{inv.target.output.key}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-t border-white/[0.06] text-[var(--s-fg-2)]">
              <td className="py-1.5 pr-3 text-[var(--s-fg-4)]">{o.id}</td>
              <td className="py-1.5 pr-3">{o.source}</td>
              {keys.map((k) => (
                <td key={k} className="py-1.5 pr-3 text-[var(--s-fg-3)]">
                  {fmtFeature(featureOf(inv.target, k), o.input[k])}
                </td>
              ))}
              <td className="py-1.5 text-right text-white">{fmtOutput(inv.target.output, o.output)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Hyps({ inv }: { inv: InvestigationState }) {
  const hs = [...inv.hypotheses].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  if (!hs.length) return <div className="s-small">Hypotheses appear once reconnaissance has profiled the target.</div>;
  return (
    <div className="h-full overflow-y-auto">
      {hs.map((h) => (
        <div key={h.id} className="flex items-start gap-3 border-b border-white/[0.06] py-2.5">
          <span className="s-mono w-12 shrink-0 text-[12px] text-[var(--s-fg-4)]">{h.id}</span>
          <span className="w-24 shrink-0 text-[11px] uppercase tracking-wider" style={{ color: h.status === "supported" ? "var(--s-accent)" : h.status === "rejected" ? "var(--s-bad)" : h.status === "inconclusive" ? "var(--s-warn)" : "var(--s-fg-3)" }}>
            {H_STATUS[h.status].label}
          </span>
          <span className={`text-[13.5px] leading-snug ${h.status === "rejected" ? "text-[var(--s-fg-4)] line-through" : "text-[var(--s-fg-2)]"}`}>{h.statement}</span>
        </div>
      ))}
    </div>
  );
}

function Phases({ inv }: { inv: InvestigationState }) {
  return (
    <div className="grid gap-3">
      {PHASES.map((p, i) => {
        const v = inv.phaseProgress[p.id] ?? 0;
        const on = inv.phase === p.id;
        return (
          <div key={p.id} className={`rounded-2xl border px-4 py-3 ${on ? "border-[var(--s-accent)] bg-[#0d0a0c]" : "border-white/10"}`}>
            <div className="flex items-center justify-between text-[13px]">
              <span className={on ? "text-white" : "text-[var(--s-fg-2)]"}>
                <span className="pk mr-3">0{i + 1}</span>
                {p.label}
              </span>
              <span className="s-mono text-[12px] text-[var(--s-fg-3)]">{Math.round(v * 100)}%</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-[var(--s-accent)] transition-[width] duration-700" style={{ width: `${v * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Recovered({ inv }: { inv: InvestigationState | undefined }) {
  const items = useMemo(() => {
    if (!inv) return [];
    if (inv.report) return inv.report.rules.slice(0, 5).map((r) => ({ id: r.id, title: r.title, sub: r.statement, conf: r.confidence, tags: r.conditions }));
    return inv.hypotheses
      .filter((h) => h.status === "supported" && h.kind !== "effect")
      .slice(-5)
      .reverse()
      .map((h) => ({ id: h.id, title: h.kind.toUpperCase(), sub: h.statement, conf: h.confidence, tags: h.features }));
  }, [inv]);
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[14px] text-white">
          <ShieldCheck size={15} className="pk" /> {inv?.report ? "Recovered rules" : "Emerging findings"}
        </span>
        <span className="rounded-full border border-[var(--s-line-2)] px-2.5 py-0.5 text-[12px] pk">{inv?.report ? `${inv.report.rules.length} found` : `${items.length} so far`}</span>
      </div>
      <div className="mt-4 grid gap-3">
        {items.map((r) => (
          <div key={r.id} className="rounded-2xl border border-white/10 bg-[#080708] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] text-white">{r.title}</div>
                <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-[var(--s-fg-3)]">{r.sub}</div>
              </div>
              <span className="shrink-0 rounded-full border border-[rgb(255_181_94/0.4)] bg-[rgb(255_181_94/0.08)] px-2 py-0.5 text-[12px] pk">{Math.round(r.conf * 100)}%</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-[var(--s-accent)]" style={{ width: `${r.conf * 100}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {r.tags.slice(0, 3).map((t) => (
                <span key={t} className="s-mono rounded-md border border-white/10 px-1.5 py-0.5 text-[10.5px] text-[var(--s-fg-3)]">
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
        {!items.length && <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-[13px] text-[var(--s-fg-3)]">Supported findings appear here as soon as the statistician confirms them.</div>}
      </div>
      <div className="mt-5 rounded-2xl border border-white/10 p-4">
        <div className="s-label-accent flex items-center gap-2">
          <Boxes size={13} /> Agent activity
        </div>
        <div className="mt-3 grid gap-2">
          {(["persona", "experimenter", "statistician", "reporter"] as const).map((a, i) => {
            const rt = inv?.agents[a];
            const working = rt?.status === "working";
            return (
              <div key={a} className={`s-agent-row${working ? " is-working" : ""}`}>
                <span className="s-agent-n">0{i + 1}</span>
                <div className="min-w-0">
                  <div className={`text-[13px] ${working ? "text-white" : "text-[var(--s-fg-2)]"}`}>{AGENT_META[a].name}</div>
                  <div className={`truncate text-[11px] ${working ? "pk" : "text-[var(--s-fg-4)]"}`}>{rt ? `${rt.status} · ${rt.completed} ops` : "idle"}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

