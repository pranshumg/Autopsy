"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { PhaseScene } from "./fx";

const PHASES = [
  {
    k: "Reconnaissance",
    sub: "Map the response surface",
    share: "≈ 13% of budget",
    desc: "The Persona agent generates a Latin-hypercube population. Each persona is queried once, a handful are re-queried to measure noise, and two random held-out sets are set aside: a validation set that monitors progress and a sealed test set scored once by the final surrogate.",
    proc: ["personas ← latin_hypercube(schema, n = 5% · budget)", "σ_noise ← pooled_sd(replicates × 2)", "validation, test ← uniform_random(8% · budget), never trained on", "δ ← max(3% · spread, 1.5 · σ_noise)"],
    out: [
      ["Baseline survey", "response distribution & output floor"],
      ["Noise floor", "within-input SD of the target"],
      ["Equivalence margin δ", "what counts as “no effect”"],
    ],
  },
  {
    k: "Screening",
    sub: "Change one thing at a time",
    share: "≈ 27% of budget",
    desc: "Every field is swept to near-minimum, centre and near-maximum on 8–12 matched subjects. Paired differences are tested; ambiguous fields are replicated; every “no effect” verdict must survive a randomized null audit.",
    proc: ["Δ_lo→mid, Δ_mid→hi, Δ_lo→hi per subject", "p ← sign_flip_permutation(Δ), α = 0.01", "CI ← bootstrap(Δ, 800)", "null ⇔ CI ⊂ [−δ, δ] ∧ audit(random pairs) clean"],
    out: [
      ["Effect hypotheses", "supported · rejected · inconclusive"],
      ["Level effects", "for categorical fields"],
      ["Null claims", "fields the target ignores"],
    ],
  },
  {
    k: "Structure",
    sub: "Find where behavior breaks",
    share: "≈ 24% of budget",
    desc: "Influential numeric fields get dose-response sweeps on the strongest responders. Smooth, step and window models compete under BIC; jumps are localized by bisection and confirmed on fresh subjects.",
    proc: ["sweep(f, 11 levels | every integer ≤ 24)", "argmin BIC{ smooth, step, window }", "bisect(lo, hi) until width ≤ 1 unit", "confirm(t ± δ) on 10 fresh subjects"],
    out: [
      ["Thresholds", "e.g. limit → $0 once DTI > 43%"],
      ["Windows", "e.g. surcharge 17h–19h"],
      ["Rejected rivals", "kept on the record"],
    ],
  },
  {
    k: "Interactions",
    sub: "Test conditional rules",
    share: "≈ 17% of budget",
    desc: "The most influential fields are paired in 2×2 factorials. A difference-in-differences only counts as a conditional rule if it survives the log scale, or the relative-effect test under a gate.",
    proc: ["cells ← {A₀,A₁} × {B₀,B₁} on 8 subjects", "ΔΔ ← (y₁₁ − y₁₀) − (y₀₁ − y₀₀)", "reject if ΔΔ vanishes on log scale", "gate ⇔ one arm pinned at the floor"],
    out: [
      ["Gates", "one field overrides another"],
      ["Conditional effects", "an effect that depends on context"],
      ["Proportional composition", "explicitly ruled out"],
    ],
  },
  {
    k: "Active learning",
    sub: "Query where we're unsure",
    share: "remaining budget",
    desc: "A 12-tree bootstrap ensemble scores 400 random candidates per round. The 16 most disputed, mutually diverse inputs are queried next, and validation error is tracked every round for display only; it never steers selection or stopping.",
    proc: ["ensemble ← bootstrap_cart(12, depth 7)", "score(x) ← σ_ensemble(x) × diversity(x)", "batch ← greedy_top(16 of 400)", "report RMSE_validation per round (monitoring only)"],
    out: [
      ["Uncertainty map", "explored vs unexplored regions"],
      ["Predicted vs observed", "for every probe"],
      ["Learning curve", "benchmarked against random"],
    ],
  },
  {
    k: "Synthesis",
    sub: "Write down what survived",
    share: "0 queries",
    desc: "A CART surrogate is fitted on every non-holdout query and scored on the sealed holdout. The Reporter folds supported hypotheses into ranked rules with intervals, evidence and caveats.",
    proc: ["surrogate ← cart(depth 6, min_leaf 4)", "fidelity ← R², MAE on sealed holdout", "rules ← fold(supported, most-specific first)", "caveats ← noise, budget, coverage, fidelity"],
    out: [
      ["Hidden Rulebook", "Markdown & JSON export"],
      ["Surrogate model", "interactive decision tree"],
      ["Caveats", "the limits of the evidence"],
    ],
  },
];

export function MethodStepper() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => setI((v) => (v + 1) % PHASES.length), 7000);
    return () => clearTimeout(t);
  }, [auto, i]);
  const p = PHASES[i];
  return (
    <div>
      <div className="s-steps sm:grid-cols-3 xl:grid-cols-6" role="tablist" aria-label="Investigation phases">
        {PHASES.map((ph, j) => (
          <button
            key={ph.k}
            type="button"
            role="tab"
            aria-selected={i === j}
            className="s-step"
            onClick={() => {
              setAuto(false);
              setI(j);
            }}
          >
            <small>PHASE 0{j + 1}</small>
            <h3>{ph.k}</h3>
            <p>{ph.sub}</p>
            {auto && i === j && (
              <span className="s-step-progress">
                <span key={i} style={{ animationDuration: "7s" }} />
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="s-panel" role="tabpanel" aria-label={p.k}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="s-label-accent">{`PHASE 0${i + 1} // ${p.k.toUpperCase()}`}</div>
              <h2 className="mt-3 text-[26px] text-white">{p.sub}</h2>
            </div>
            <span className="s-ok-badge">
              <Wallet size={14} /> {p.share}
            </span>
          </div>
          <p className="s-body mt-4 !text-[14.5px]">{p.desc}</p>
          <div className="mt-6 grid gap-5 border-t border-white/10 pt-6 md:grid-cols-2">
            <div>
              <div className="s-label">Statistical procedure</div>
              <div className="s-codebox mt-3">
                {p.proc.map((l) => (
                  <div key={l}>
                    <span className="c">› </span>
                    {l}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="s-label">Outputs</div>
              <div className="mt-3 grid gap-2">
                {p.out.map(([k, v]) => (
                  <div key={k} className="s-match">
                    <span className="text-[13.5px] text-white">{k}</span>
                    <span className="s-small text-right">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="s-card s-live-card min-h-[440px]" style={{ aspectRatio: "auto" }}>
          <PhaseScene phase={i} />
          <div className="s-card-caption">
            <div>
              <div className="s-label-accent">[ phase 0{i + 1} · illustration ]</div>
              <h3>{p.k} in motion</h3>
            </div>
            <span className="s-live">LIVE</span>
          </div>
        </div>
      </div>
      <div className="mt-6 rounded-[22px] border border-white/10 bg-[#080708] p-6 text-[13.5px] leading-relaxed text-[var(--s-fg-3)]">
        <span className="pk mr-2">Limits of evidence ·</span>
        Findings describe the target&rsquo;s observed behavior inside its documented input ranges. Statistical support is not proof of mechanism, and anything outside the sampled space is untested.
      </div>
    </div>
  );
}
