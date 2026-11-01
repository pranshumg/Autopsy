"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { AgentFlow } from "./fx";

const AGENTS = [
  {
    k: "Persona",
    sub: "Synthetic subject design",
    title: "Persona agent: who gets asked",
    desc: "Builds the population every experiment draws from, and chooses which subjects each experiment runs on. It never queries the target itself.",
    ops: [
      ["latin_hypercube(schema, n)", "stratified personas across every numeric field"],
      ["rotate_levels(categorical)", "balanced coverage of each category"],
      ["select_subjects(k, responsive=75%)", "favour subjects not pinned at the output floor"],
      ["strongest_responders(feature)", "reuse screening outliers for sweeps"],
    ],
    out: [
      ["Produces", "personas · subject sets"],
      ["Hands off to", "Experimenter"],
      ["Phases", "recon · screening · structure"],
    ],
  },
  {
    k: "Experimenter",
    sub: "Design & execution",
    title: "Experimenter agent: what gets asked",
    desc: "Turns open questions into controlled designs and is the only agent that talks to the black box. Every query it sends is charged to the budget.",
    ops: [
      ["counterfactual_pairs(f, lo|mid|hi)", "one field changes, everything else held"],
      ["dose_response_sweep(f, grid)", "map the shape of an effect"],
      ["bisect(lo, hi)", "localize a discontinuity to one unit"],
      ["factorial_2x2(A, B)", "difference-in-differences for interactions"],
      ["uncertainty_probes(ensemble, 16)", "active-learning batches"],
    ],
    out: [
      ["Produces", "experiments · observations"],
      ["Hands off to", "Statistician"],
      ["Budget", "the only agent that spends queries"],
    ],
  },
  {
    k: "Statistician",
    sub: "Tests & models",
    title: "Statistician agent: what is true",
    desc: "Proposes hypotheses, tests them, and makes rival explanations compete. Ambiguous results are sent back for replication rather than guessed.",
    ops: [
      ["sign_flip_test(Δ) · bootstrap_ci(Δ)", "paired effect, exact or Monte-Carlo p"],
      ["bic(smooth | step | window)", "model comparison on sweeps"],
      ["randomized_null_audit(f)", "no “ignored” claim without it"],
      ["did(log-scale) · relative_gate_test", "reject proportional pseudo-interactions"],
      ["fit_cart · fit_bootstrap_ensemble", "surrogate model & uncertainty"],
    ],
    out: [
      ["Produces", "hypotheses · surrogate · AL rounds"],
      ["Hands off to", "Experimenter (replicate) · Reporter"],
      ["Decides", "supported · rejected · inconclusive"],
    ],
  },
  {
    k: "Reporter",
    sub: "Rulebook synthesis",
    title: "Reporter agent: what gets published",
    desc: "Folds supported hypotheses into plain-language rules with effect sizes, intervals, evidence trails, rejected alternatives and caveats.",
    ops: [
      ["fold(effect → threshold | level)", "keep the most specific supported rule"],
      ["rank(threshold, interaction, level, null)", "order by structure, then confidence"],
      ["attach(evidence, CI, alternatives)", "every rule is auditable"],
      ["caveats(noise, budget, fidelity)", "state the limits honestly"],
    ],
    out: [
      ["Produces", "Hidden Rulebook · Markdown · JSON"],
      ["Receives from", "Statistician"],
      ["Phase", "synthesis"],
    ],
  },
];

export function AgentRoster() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => setI((v) => (v + 1) % AGENTS.length), 6000);
    return () => clearTimeout(t);
  }, [auto, i]);
  const a = AGENTS[i];
  return (
    <div>
      <div className="s-steps sm:grid-cols-2 lg:grid-cols-4" role="tablist" aria-label="Agents">
        {AGENTS.map((g, j) => (
          <button
            key={g.k}
            type="button"
            role="tab"
            aria-selected={i === j}
            className="s-step"
            onClick={() => {
              setAuto(false);
              setI(j);
            }}
          >
            <small>AGENT 0{j + 1}</small>
            <h3>{g.k}</h3>
            <p>{g.sub}</p>
            {auto && i === j && (
              <span className="s-step-progress">
                <span key={i} style={{ animationDuration: "6s" }} />
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="s-panel" role="tabpanel" aria-label={a.k}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="s-label-accent">{`AGENT 0${i + 1} // ${a.k.toUpperCase()}`}</div>
              <h2 className="mt-3 text-[26px] text-white">{a.title}</h2>
              <p className="s-body mt-3 max-w-xl !text-[14.5px]">{a.desc}</p>
            </div>
            <span className="s-ok-badge">
              <CheckCircle2 size={14} /> Deterministic procedure
            </span>
          </div>
          <div className="mt-6 grid gap-5 border-t border-white/10 pt-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div>
              <div className="s-label">Recorded operations</div>
              <div className="s-codebox mt-3">
                {a.ops.map(([fn, note]) => (
                  <div key={fn}>
                    <span className="pk">{fn}</span>
                    <div className="c">{`// ${note}`}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="s-label">Produces & hands off</div>
              <div className="mt-3 grid gap-2">
                {a.out.map(([k, v]) => (
                  <div key={k} className="s-match">
                    <span className="s-small">{k}</span>
                    <span className="text-right text-[13px] text-white">{v}</span>
                  </div>
                ))}
              </div>
              <p className="s-small mt-4">The workspace&rsquo;s Agent Command view shows each of these operations as it executes, with its inputs, outputs and the decision taken.</p>
            </div>
          </div>
        </div>
        <div className="s-card s-live-card min-h-[440px]" style={{ aspectRatio: "auto" }}>
          <AgentFlow active={i} />
          <div className="s-card-caption">
            <div>
              <div className="s-label-accent">[ shared investigation state ]</div>
              <h3>Handoff Protocol</h3>
            </div>
            <span className="s-live">LIVE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
