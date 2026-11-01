"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, History, Loader2, Play } from "lucide-react";
import type { Pace, TargetSpec } from "@/lib/types";
import { allTargets, needsCredential, useLab } from "@/lib/store";
import { sampleChallengeDraft, SAMPLE_CHALLENGE_KEY } from "@/lib/examples";
import { cn } from "@/lib/format";
import { Chip } from "@/components/ui";
import { CredentialField, OriginChip } from "@/components/target-bits";

const STEPS = ["Choose target", "Investigate", "Inspect strongest finding", "Test it live", "Export evidence"];
const SAVED_RUN_URL = "/demo/saved-run.json";

export function GuidedDemo() {
  const router = useRouter();
  const builtins = useLab((s) => s.targets);
  const externals = useLab((s) => s.externalTargets);
  const credentials = useLab((s) => s.credentials);
  const { create, start, saveExternal, setCredential, loadSavedRun } = useLab.getState();
  const targets = useMemo(() => allTargets({ targets: builtins, externalTargets: externals }), [builtins, externals]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [pace, setPace] = useState<Pace>("standard");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((t) => t.id === (chosen ?? targets[0]?.id));

  const launch = (t: TargetSpec) => {
    setBusy("launch");
    const id = create({ target: t, budget: t.defaultBudget, pace, guided: true });
    start(id);
    router.push(`/lab/${id}`, { transitionTypes: ["nav-forward"] });
  };

  const sampleChallenge = () => {
    const d = sampleChallengeDraft(window.location.origin);
    const existing = externals.find((t) => t.challengeId === d.challengeId && t.connection?.url === d.connection.url);
    const t: TargetSpec = existing ?? {
      id: `ext_loan-apr_${Date.now().toString(36)}`,
      name: d.name,
      vendor: "External API",
      version: "",
      domain: "External API",
      endpoint: d.connection.url,
      description: d.description,
      output: d.output,
      features: d.features,
      defaultBudget: d.defaultBudget,
      stochastic: true,
      origin: "external",
      connection: d.connection,
      challengeId: d.challengeId,
    };
    if (!existing) saveExternal(t);
    setCredential(t.id, SAMPLE_CHALLENGE_KEY);
    setChosen(t.id);
  };

  const openSaved = async () => {
    setBusy("saved");
    setError(null);
    try {
      const id = await loadSavedRun(SAVED_RUN_URL);
      router.push(`/lab/${id}/rulebook`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const missing = target ? needsCredential(target, credentials) : false;

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
              <b>Guided demo</b>
            </div>
            <h1 className="s-h1">
              Guided
              <br />
              <span className="pk">demo.</span>
            </h1>
            <p className="s-lede">One live investigation, five steps. The demo runs in the normal workspace with a step bar on top, so everything you see is the real engine querying the real target.</p>
          </div>
        </div>

        <ol className="mt-10 grid gap-2 sm:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("rounded-2xl border px-4 py-3", i === 0 ? "border-[var(--s-accent)]/60 bg-[rgb(255_181_94/0.06)]" : "border-white/10")}>
              <div className="s-label-accent">STEP 0{i + 1}</div>
              <div className="mt-1 text-[14px] text-white">{s}</div>
            </li>
          ))}
        </ol>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section aria-labelledby="demo-targets">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="demo-targets" className="label-mono">
                Step 1 · choose a target
              </h2>
              <button type="button" className="s-btn s-btn-dark s-btn-sm" onClick={sampleChallenge}>
                <FlaskConical size={13} /> Use the sample external API
              </button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={target?.id === t.id}
                  onClick={() => setChosen(t.id)}
                  className={cn("rounded-2xl border p-4 text-left transition-colors", target?.id === t.id ? "border-[var(--s-accent)]/70 bg-[rgb(255_181_94/0.05)]" : "border-white/10 hover:border-white/25")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] text-white">{t.name}</span>
                    <OriginChip target={t} />
                    {t.challengeId && <Chip tone="amber">synthetic</Chip>}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[12.5px] text-[var(--s-fg-3)]">{t.description}</div>
                  <div className="mt-2 font-mono text-[10.5px] text-fg-4">
                    {t.features.length} inputs → {t.output.label} · budget {t.defaultBudget}
                  </div>
                </button>
              ))}
              {!builtins && <div className="text-[13px] text-[var(--s-fg-3)]">Loading targets…</div>}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="s-card p-5">
              <div className="label-mono">Selected</div>
              {target ? (
                <>
                  <div className="mt-2 text-[18px] text-white">{target.name}</div>
                  <div className="mt-1.5">
                    <OriginChip target={target} />
                  </div>
                  <CredentialField target={target} />
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[13px] text-fg-2">Pace</span>
                    <div className="flex gap-1.5" role="radiogroup" aria-label="Pace">
                      {(
                        [
                          ["standard", "Standard"],
                          ["instant", "Max"],
                        ] as const
                      ).map(([v, l]) => (
                        <button key={v} type="button" role="radio" aria-checked={pace === v} className="s-fchip !h-8 !px-3 !text-[12px]" onClick={() => setPace(v)}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-3 text-[11.5px] leading-snug text-fg-4">
                    Duration depends on the target&rsquo;s response time and the pace; elapsed time is measured and shown during the run. Findings appear as soon as they are supported.
                  </p>
                  <button type="button" className="s-btn s-btn-accent s-btn-sm mt-4 w-full" disabled={!!busy || missing} onClick={() => launch(target)}>
                    {busy === "launch" ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />} Start live investigation
                  </button>
                </>
              ) : (
                <p className="mt-2 text-[13px] text-fg-3">Pick a target.</p>
              )}
            </div>
            <div className="rounded-2xl border border-[rgb(255_181_94/0.3)] p-5">
              <div className="flex items-center gap-2 text-[13px] text-white">
                <History size={14} className="pk" /> Offline fallback
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--s-fg-3)]">
                If the network is unreliable, open a recorded investigation of the Credit Limit target. It is labelled as a saved run everywhere and cannot query the target; it is never presented as live.
              </p>
              <button type="button" className="s-btn s-btn-dark s-btn-sm mt-3" onClick={openSaved} disabled={!!busy}>
                {busy === "saved" ? <Loader2 size={13} className="animate-spin" /> : <History size={13} />} Open saved run
              </button>
              {error && <p className="mt-2 text-[12px] text-[var(--s-bad)]">{error}</p>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
