"use client";

import * as Slider from "@radix-ui/react-slider";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, ViewTransition } from "react";
import { ArrowLeft, ArrowRight, Compass, FileSearch, Pencil, Play, PlugZap, Trash2, TriangleAlert, Zap } from "lucide-react";
import type { Pace, TargetSpec } from "@/lib/types";
import { allTargets, needsCredential, useLab } from "@/lib/store";
import { cn, fmtFeature } from "@/lib/format";
import { INV_STATUS } from "@/components/meta";
import { Chip, Dot, Empty, Label, Skeleton } from "@/components/ui";
import { CredentialField, OriginChip } from "@/components/target-bits";

export function Registry() {
  const builtins = useLab((s) => s.targets);
  const externals = useLab((s) => s.externalTargets);
  const targets = useMemo(() => (builtins ? allTargets({ targets: builtins, externalTargets: externals }) : null), [builtins, externals]);
  const error = useLab((s) => s.targetsError);
  const loadTargets = useLab((s) => s.loadTargets);
  const index = useLab((s) => s.index);
  const [chosen, setChosen] = useState<string | null>(null);
  const active = chosen ?? targets?.[0]?.id ?? null;

  // the Targets page links here with ?target=<id> to preselect a specimen
  useEffect(() => {
    const t = setTimeout(() => {
      const want = new URLSearchParams(window.location.search).get("target");
      if (want) {
        setChosen(want);
        document.getElementById(`specimen-${want}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [targets]);

  return (
    <main className="s-page">
      <div className="s-wrap">
        <div className="s-page-head s-rise">
          <div>
            <div className="s-crumbs">
              <Link href="/" className="inline-flex items-center gap-1.5">
                <ArrowLeft size={13} /> Home
              </Link>
              <span>/</span>
              <b>Investigation Lab</b>
              <span className="inline-flex items-center gap-1.5 s-good">
                <span className="s-dot" /> Engine online
              </span>
            </div>
            <h1 className="s-h1">
              Black-box investigation
              <br />
              <span className="pk">laboratory.</span>
            </h1>
            <p className="s-lede">Pick a built-in synthetic target or connect your own scoring API, set a query budget, and launch four agents. AUTOPSY sees only the input schema and the responses; everything it reports must be earned through controlled queries.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/demo" className="s-btn s-btn-accent s-btn-sm">
                <Compass size={13} /> Start guided demo
              </Link>
              <Link href="/connect" className="s-btn s-btn-dark s-btn-sm">
                <PlugZap size={13} /> Connect a black box
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            {[
              [targets ? String(targets.length) : "—", "targets"],
              ["4", "agents"],
              ["6", "phases"],
              [String(index.length), "case files"],
            ].map(([v, k]) => (
              <div key={k} className="s-kpi-mini">
                <b>{v}</b>
                <span>{k}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="s-bar mt-12">
          <span className="s-label inline-flex items-center gap-2">
            <Zap size={13} className="pk" /> Try a target:
          </span>
          {(targets ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              className="s-fchip inline-flex items-center gap-2"
              aria-pressed={active === t.id}
              onClick={() => {
                setChosen(t.id);
                document.getElementById(`specimen-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              <Play size={10} fill="currentColor" /> {t.name}
              {t.origin === "external" && <span className="text-[10px] uppercase tracking-wider opacity-70">ext</span>}
              {t.origin === "python" && <span className="text-[10px] uppercase tracking-wider opacity-70">agents</span>}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {error && (
            <Empty
              icon={<TriangleAlert size={20} />}
              title="Could not reach the target registry"
              hint={error}
              action={
                <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={() => loadTargets()}>
                  Retry
                </button>
              }
            />
          )}
          {!targets && !error && (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 !rounded-[28px]" />
              ))}
            </div>
          )}
          <div className="space-y-4">
            {targets?.map((t, i) => (
              <Specimen key={t.id} t={t} index={i} open={active === t.id} onOpen={() => setChosen(t.id)} />
            ))}
          </div>
        </div>

        <CaseFiles />
      </div>
    </main>
  );
}

function Specimen({ t, index, open, onOpen }: { t: TargetSpec; index: number; open: boolean; onOpen: () => void }) {
  const router = useRouter();
  const create = useLab((s) => s.create);
  const start = useLab((s) => s.start);
  const [budget, setBudget] = useState(t.defaultBudget);
  const [pace, setPace] = useState<Pace>("standard");
  const [busy, setBusy] = useState(false);
  const external = t.origin === "external";
  const missingKey = useLab((s) => needsCredential(t, s.credentials));

  const launch = (autostart: boolean) => {
    setBusy(true);
    const id = create({ target: t, budget, pace });
    if (autostart) start(id);
    router.push(`/lab/${id}`, { transitionTypes: ["nav-forward"] });
  };

  return (
    <motion.div id={`specimen-${t.id}`} layout transition={{ type: "spring", stiffness: 400, damping: 40 }} className={cn("s-card transition-colors", open ? "!border-[var(--s-accent)]/60" : "hover:!border-white/30")}>
      <button type="button" onClick={onOpen} aria-expanded={open} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-5 text-left sm:gap-6 sm:px-7">
        <span className="font-mono text-xs text-fg-4">{String(index + 1).padStart(2, "0")}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[22px] text-fg">{t.name}</span>
            {t.version && <Chip>{t.version}</Chip>}
            <OriginChip target={t} />
            {!external && <Chip tone="model">{t.domain}</Chip>}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-fg-3">
            POST {external ? t.connection?.url : t.endpoint} → {external ? t.connection?.outputPath : t.output.key} ({t.output.unit})
          </div>
        </div>
        <div className="hidden items-center gap-1 md:flex" aria-hidden>
          {t.features.map((f) => (
            <span key={f.key} className={cn("h-6 w-1.5 rounded-full", f.kind === "numeric" ? "bg-signal/60" : "bg-model/60")} title={f.label} />
          ))}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
            <div className="grid gap-6 border-t border-line px-5 py-6 sm:px-7 lg:grid-cols-[1fr_360px]">
              <div>
                <p className="max-w-2xl text-sm leading-relaxed text-fg-2">{t.description}</p>
                <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
                  {t.features.map((f) => (
                    <div key={f.key} className="flex items-start gap-3 bg-ink-900 px-3 py-2.5">
                      <span className={cn("mt-0.5 font-mono text-[9px] uppercase", f.kind === "numeric" ? "text-signal" : "text-model")}>{f.kind === "numeric" ? "num" : "cat"}</span>
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] text-fg">{f.label}</span>
                          <span className="font-mono text-[10px] text-fg-4">{f.key}</span>
                        </div>
                        <div className="truncate font-mono text-[10.5px] text-fg-3">
                          {f.kind === "numeric" ? `${fmtFeature(f, f.min)} – ${fmtFeature(f, f.max)}` : f.levels.join(" · ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 font-mono text-[10.5px] text-fg-4">
                  {external
                    ? `External API · ${t.connection?.mode === "single" ? "one input per request" : `batched (up to ${t.connection?.maxBatch ?? 64} per request)`} · implementation unknown to AUTOPSY`
                    : `${t.vendor} · rules hidden server-side · ${t.stochastic ? "responses may vary between identical requests" : "deterministic"}`}
                </div>
                {external && (
                  <Link href={`/connect#${t.id}`} className="mt-3 inline-flex items-center gap-1.5 text-xs text-signal hover:underline">
                    <Pencil size={11} /> Edit connection
                  </Link>
                )}
              </div>
              <div className="rounded-[22px] border border-line bg-[#080708] p-5">
                <Label>Investigation configuration</Label>
                <div className="mt-4">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor={`budget-${t.id}`} className="text-[13px] text-fg-2">
                      Query budget
                    </label>
                    <span className="font-mono text-sm text-fg">{budget.toLocaleString()}</span>
                  </div>
                  <Slider.Root
                    id={`budget-${t.id}`}
                    className="relative mt-3 flex h-4 w-full touch-none select-none items-center"
                    min={400}
                    max={2000}
                    step={50}
                    value={[budget]}
                    onValueChange={([v]) => setBudget(v)}
                    aria-label="Query budget"
                  >
                    <Slider.Track className="relative h-[3px] grow rounded-full bg-white/[0.08]">
                      <Slider.Range className="absolute h-full rounded-full bg-signal" />
                    </Slider.Track>
                    <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-signal bg-ink-950 shadow-[0_0_0_4px_rgb(78_225_240/0.15)]" />
                  </Slider.Root>
                  <div className="mt-1.5 flex justify-between font-mono text-[9.5px] text-fg-4">
                    <span>400 · quick</span>
                    <span>2,000 · thorough</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[13px] text-fg-2">Pace</span>
                  <div className="flex gap-1.5" role="radiogroup" aria-label="Pace">
                    {(
                      [
                        ["cinematic", "Cinematic", "Slowed down so every step is visible"],
                        ["standard", "Standard", "Balanced speed and visibility"],
                        ["instant", "Max", "As fast as the target responds"],
                      ] as const
                    ).map(([v, l, tip]) => (
                      <button key={v} type="button" role="radio" aria-checked={pace === v} title={tip} className="s-fchip !h-8 !px-3 !text-[12px]" onClick={() => setPace(v)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <CredentialField target={t} />
                {external && <p className="mt-3 text-[11px] leading-snug text-fg-4">Every evaluated input is a real request to this API. Requests, retries included, are counted separately in the workspace.</p>}
                <div className="mt-5 flex gap-2">
                  <button type="button" className="s-btn s-btn-accent s-btn-sm flex-1" onClick={() => launch(true)} disabled={busy || missingKey} title={missingKey ? "Enter the credential first" : undefined}>
                    <Play size={12} fill="currentColor" /> Launch investigation
                  </button>
                  <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={() => launch(false)} disabled={busy} title="Open the workspace without starting">
                    Stage
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CaseFiles() {
  const index = useLab((s) => s.index);
  const hydrated = useLab((s) => s.hydrated);
  const remove = useLab((s) => s.remove);
  const [confirm, setConfirm] = useState<string | null>(null);
  const rows = useMemo(() => [...index].sort((a, b) => b.createdAt - a.createdAt), [index]);
  return (
    <section className="mt-20" aria-labelledby="case-files">
      <div className="mb-3 flex items-center gap-3">
        <h2 id="case-files" className="label-mono">
          Case files
        </h2>
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[10px] text-fg-4">stored in this browser</span>
      </div>
      {!hydrated ? (
        <Skeleton className="h-20 !rounded-[28px]" />
      ) : !rows.length ? (
        <div className="s-card">
          <Empty icon={<FileSearch size={20} />} title="No investigations yet" hint="Launch one above. Completed investigations and their rulebooks are kept here." />
        </div>
      ) : (
        <div className="s-table-wrap">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-fg-4">
                <th className="px-4 py-2.5 font-normal">Investigation</th>
                <th className="px-3 py-2.5 font-normal">Status</th>
                <th className="px-3 py-2.5 text-right font-normal">Queries</th>
                <th className="px-3 py-2.5 text-right font-normal">Rules</th>
                <th className="px-3 py-2.5 text-right font-normal">Held-out R²</th>
                <th className="px-3 py-2.5 font-normal">Opened</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = INV_STATUS[r.status];
                return (
                  <tr key={r.id} className="group border-b border-line last:border-b-0 hover:bg-white/[0.015]">
                    <td className="px-4 py-3">
                      <Link href={`/lab/${r.id}`} className="flex items-baseline gap-2 hover:text-signal">
                        <ViewTransition name={`inv-title-${r.id}`} share="morph" default="none">
                          <span className="font-medium text-fg">{r.targetName}</span>
                        </ViewTransition>
                        <span className="font-mono text-[11px] text-fg-4">#{r.id.slice(-4).toUpperCase()}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-fg-2">
                        <Dot tone={st.tone} /> {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-fg-2">
                      {r.used.toLocaleString()} <span className="text-fg-4">/ {r.limit.toLocaleString()}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-fg-2">{r.rules || "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-fg-2">{r.r2 !== undefined ? r.r2.toFixed(3) : "—"}</td>
                    <td className="px-3 py-3 font-mono text-[11px] text-fg-3">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {confirm === r.id ? (
                          <>
                            <button type="button" className="s-btn s-btn-sm !min-h-[30px] !px-3 !text-[12px] border border-[rgb(255_122_138/0.45)] text-[var(--s-bad)] hover:!bg-[rgb(255_122_138/0.1)]" onClick={() => (remove(r.id), setConfirm(null))}>
                              Delete
                            </button>
                            <button type="button" className="s-btn s-btn-dark s-btn-sm !min-h-[30px] !px-3 !text-[12px]" onClick={() => setConfirm(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" aria-label={`Delete investigation ${r.id}`} onClick={() => setConfirm(r.id)} className="rounded p-1.5 text-fg-4 opacity-0 transition hover:bg-alert/10 hover:text-alert focus-visible:opacity-100 group-hover:opacity-100">
                              <Trash2 size={13} />
                            </button>
                            <Link href={`/lab/${r.id}`} className="inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-fg-2 hover:text-fg">
                              Open <ArrowRight size={12} />
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
