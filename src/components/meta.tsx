import {
  Activity,
  BookOpenText,
  Boxes,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Network,
  Radar,
  Sigma,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { AgentId, ExperimentKind, HypothesisKind, HypothesisStatus, InvestigationStatus, QuerySource } from "@/lib/types";
import type { Tone } from "./ui";

export const AGENT_META: Record<AgentId, { name: string; role: string; tone: Tone; icon: LucideIcon; color: string; blurb: string }> = {
  persona: {
    name: "Persona",
    role: "Designs synthetic subjects",
    tone: "signal",
    icon: UsersRound,
    color: "var(--color-signal)",
    blurb: "Builds stratified synthetic inputs and selects which subjects each experiment runs on.",
  },
  experimenter: {
    name: "Experimenter",
    role: "Designs & executes probes",
    tone: "coral",
    icon: FlaskConical,
    color: "var(--color-coral)",
    blurb: "Turns hypotheses into controlled designs — counterfactual pairs, sweeps, bisections, factorials — and is the only agent that queries the target.",
  },
  statistician: {
    name: "Statistician",
    role: "Tests & models evidence",
    tone: "model",
    icon: Sigma,
    color: "var(--color-model)",
    blurb: "Proposes hypotheses, runs permutation tests and model comparisons, and fits the surrogate model.",
  },
  reporter: {
    name: "Reporter",
    role: "Synthesizes the rulebook",
    tone: "truth",
    icon: BookOpenText,
    color: "var(--color-truth)",
    blurb: "Folds supported hypotheses into plain-language rules with their evidence, uncertainty and caveats.",
  },
};

export const H_STATUS: Record<HypothesisStatus, { tone: Tone; label: string }> = {
  proposed: { tone: "neutral", label: "Proposed" },
  testing: { tone: "model", label: "Testing" },
  supported: { tone: "truth", label: "Supported" },
  rejected: { tone: "alert", label: "Rejected" },
  inconclusive: { tone: "amber", label: "Inconclusive" },
};

export const H_KIND: Record<HypothesisKind, { label: string; glyph: string }> = {
  effect: { label: "Main effect", glyph: "Δ" },
  null: { label: "Null effect", glyph: "∅" },
  level: { label: "Level effect", glyph: "≠" },
  linear: { label: "Smooth response", glyph: "∕" },
  threshold: { label: "Threshold", glyph: "⌐" },
  interaction: { label: "Interaction", glyph: "×" },
};

export const INV_STATUS: Record<InvestigationStatus, { tone: Tone; label: string }> = {
  idle: { tone: "neutral", label: "Ready" },
  running: { tone: "signal", label: "Running" },
  paused: { tone: "amber", label: "Paused" },
  completed: { tone: "truth", label: "Complete" },
  cancelled: { tone: "amber", label: "Cancelled" },
  error: { tone: "alert", label: "Error" },
  interrupted: { tone: "amber", label: "Interrupted" },
};

export const EXP_KIND: Record<ExperimentKind, { label: string; tone: Tone }> = {
  baseline: { label: "Baseline", tone: "signal" },
  replicate: { label: "Replicate", tone: "neutral" },
  holdout: { label: "Test set", tone: "neutral" },
  validation: { label: "Validation", tone: "neutral" },
  counterfactual: { label: "Counterfactual", tone: "signal" },
  sweep: { label: "Sweep", tone: "model" },
  bisection: { label: "Bisection", tone: "model" },
  confirmation: { label: "Confirm", tone: "truth" },
  factorial: { label: "Factorial", tone: "coral" },
  active: { label: "Active", tone: "amber" },
  manual: { label: "Analyst", tone: "coral" },
  verification: { label: "Verify", tone: "truth" },
};

export const SOURCE_COLOR: Record<QuerySource, string> = {
  baseline: "#4ee1f0",
  replicate: "#6e7785",
  holdout: "#3a4250",
  pair: "#2fb3c4",
  sweep: "#a28dff",
  bisect: "#7d68e0",
  confirm: "#c8f04a",
  factorial: "#ff8d6b",
  active: "#ffb84d",
  manual: "#ff5d78",
  validation: "#4a5363",
  verify: "#e9ff8a",
};

export const LAB_VIEWS = [
  { slug: "", label: "Laboratory", short: "Lab", icon: LayoutDashboard, key: "1" },
  { slug: "agents", label: "Agent command", short: "Agents", icon: Network, key: "2" },
  { slug: "experiments", label: "Experiments", short: "Exps", icon: FlaskConical, key: "3" },
  { slug: "hypotheses", label: "Hypothesis map", short: "Hyps", icon: GitBranch, key: "4" },
  { slug: "learning", label: "Active learning", short: "Learn", icon: Radar, key: "5" },
  { slug: "surrogate", label: "Surrogate model", short: "Model", icon: Boxes, key: "6" },
  { slug: "rulebook", label: "Hidden rulebook", short: "Rules", icon: BookOpenText, key: "7" },
] as const;

export { Activity };
