import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Binary, GitBranch, Lock, Sparkles, Wallet } from "lucide-react";
import { SiteShell } from "@/components/platform";
import { DotCube, DotGraph, DotSurface } from "@/components/site/fx";
import { Hero } from "@/components/site/hero";
import { Reveal } from "@/components/site/reveal";
import { SensitivityMatrix } from "@/components/site/sensitivity";

function LiveCard({ tag, title, children, hint }: { tag: string; title: string; children: ReactNode; hint?: string }) {
  return (
    <div className="s-card s-live-card">
      {children}
      {hint && <div className="s-card-hint">{hint}</div>}
      <div className="s-card-caption">
        <div>
          <div className="s-label-accent">[ {tag} ]</div>
          <h3>{title}</h3>
        </div>
        <span className="s-live">LIVE</span>
      </div>
    </div>
  );
}

function StoryHead({ n, label }: { n: number; label: string }) {
  return (
    <div className="s-story-head">
      <span className="s-tag">{`[ 0${n} // ${label} ]`}</span>
      <span className="s-count">0{n} / 03</span>
    </div>
  );
}

export function Landing() {
  return (
    <SiteShell>
      <main>
        <Hero />

        <div className="s-wrap">
          <section className="s-story">
            <Reveal>
              <StoryHead n={1} label="black-box probing" />
              <h2 className="s-h2">
                Interrogate opaque algorithms with <span className="pk">controlled queries.</span>
              </h2>
              <p className="s-body">
                AUTOPSY never sees source code. It sees what any outside auditor sees: a documented input schema and a query endpoint. Every finding has to be earned through experiments that change one thing at a time.
              </p>
              <div className="s-chips">
                <span className="s-chip">
                  <Binary size={15} /> Counterfactual pairs
                </span>
                <span className="s-chip">
                  <Lock size={15} /> Rules hidden server-side
                </span>
                <span className="s-chip">
                  <Wallet size={15} /> Budget-aware probing
                </span>
              </div>
              <Link href="/targets" className="s-btn s-btn-dark mt-9">
                Browse the black boxes <ArrowRight size={15} />
              </Link>
            </Reveal>
            <Reveal delay={120}>
              <LiveCard tag="black-box interrogation" title="Counterfactual Query Engine" hint="drag the cursor across the box">
                <DotCube />
              </LiveCard>
            </Reveal>
          </section>

          <section className="s-story">
            <Reveal>
              <StoryHead n={2} label="evidence pipeline" />
              <h2 className="s-h2">
                Turn raw responses into <span className="pk">tested hypotheses.</span>
              </h2>
              <p className="s-body">Four agents share one investigation record. Responses become effect estimates, estimates become hypotheses, and every hypothesis has to survive a rival explanation and fresh subjects.</p>
              <div className="s-substeps">
                {[
                  ["01. sensitivity screening", "Three-level counterfactual pairs", "Each field is swept at its extremes and centre on matched subjects; sign-flip permutation tests decide if it matters."],
                  ["02. structure probing", "Sweeps, bisection & model comparison", "Smooth trends, thresholds and windows compete under BIC; discontinuities are localized to a single unit."],
                  ["03. adversarial verification", "Fresh subjects & randomized null audits", "Findings are re-tested on new personas, and every “no effect” claim must survive randomized probing."],
                ].map(([k, t, d]) => (
                  <div key={k}>
                    <div className="s-label-accent">[ {k} ]</div>
                    <h4>{t}</h4>
                    <p>{d}</p>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={120}>
              <LiveCard tag="hypothesis network" title="Evidence Propagation Graph" hint="hover a node to trace its evidence">
                <DotGraph />
              </LiveCard>
            </Reveal>
          </section>

          <section className="s-story">
            <Reveal>
              <StoryHead n={3} label="hidden rulebook" />
              <h2 className="s-h2">
                Map the decision surface, <span className="pk">one threshold at a time.</span>
              </h2>
              <p className="s-body">Active learning aims the remaining budget wherever the surrogate is least certain. The Reporter publishes only what survived: rules with intervals, evidence and caveats.</p>
              <div className="s-term" aria-label="Query API">
                <code>
                  <span className="pk">$</span>GET /api/targets
                </code>
                <code>
                  <span className="pk">$</span>POST /api/targets/meridian-credit/query
                </code>
                <code className="s-term-out">
                  <span className="pk">→</span>4 agents · 6 phases · validation + sealed test split
                </code>
                <code className="s-term-out">
                  <span className="pk">→</span>rulebook.md · rulebook.json · surrogate R²
                </code>
              </div>
              <Link href="/method" className="s-btn s-btn-dark mt-8">
                Read the six-phase method <ArrowRight size={15} />
              </Link>
            </Reveal>
            <Reveal delay={120}>
              <LiveCard tag="decision surface" title="Threshold Localization Sweep" hint="the amber ridge is the hidden threshold">
                <DotSurface />
              </LiveCard>
            </Reveal>
          </section>

          <section className="pt-24">
            <Reveal className="s-center">
              <span className="s-tag">
                <Sparkles size={14} /> statistical investigation engine
              </span>
              <h2 className="s-h3 mt-6">
                Counterfactual sensitivity,
                <br />
                <span className="pk">measured live on a real black box.</span>
              </h2>
              <p className="s-body mx-auto mt-5 max-w-3xl">
                The matrix below is not a mock-up. Opening this page sent one batch of queries to a synthetic decision system whose rules live only on the server. Switch targets to probe a different one.
              </p>
            </Reveal>
            <Reveal className="mt-12">
              <SensitivityMatrix />
            </Reveal>
          </section>

          <Reveal className="mt-32">
            <div className="s-cta">
              <span className="s-tag">
                <GitBranch size={14} /> interactive investigation lab
              </span>
              <h2 className="s-h2 mt-7 max-w-4xl">
                Ready to open a black box? <span className="pk">Audit its behavior.</span>
              </h2>
              <p className="s-body mt-5 max-w-2xl">Launch a full investigation with four agents, a resizable workspace, a live hypothesis map, a surrogate model explorer and an exportable Hidden Rulebook.</p>
              <div className="relative z-10 mt-9 flex flex-wrap gap-3">
                <Link href="/lab" className="s-btn s-btn-accent">
                  Launch the Lab <ArrowRight size={15} />
                </Link>
                <Link href="/benchmarks" className="s-btn s-btn-dark">
                  See the benchmark suite
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </main>
    </SiteShell>
  );
}
