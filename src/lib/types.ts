// Shared types between the server (black-box targets), the investigation
// engine (web worker) and the UI. Nothing in here may reveal target internals.

export type NumericFeature = {
  key: string;
  label: string;
  kind: "numeric";
  min: number;
  max: number;
  integer?: boolean;
  unit?: string;
  format?: "currency" | "percent" | "number";
  description: string;
};

export type CategoricalFeature = {
  key: string;
  label: string;
  kind: "categorical";
  levels: string[];
  description: string;
};

export type Feature = NumericFeature | CategoricalFeature;

export type OutputSpec = {
  key: string;
  label: string;
  unit: string;
  format: "currency" | "score" | "number";
  min: number;
  max: number;
};

/**
 * How AUTOPSY reaches an external target. Contains no secrets: a credential,
 * when needed, is supplied per session and only ever held in memory.
 */
export type Connection = {
  /** HTTPS endpoint that implements the AUTOPSY query contract */
  url: string;
  /** "batch": POST {inputs:[...]} once per chunk; "single": POST {input:{...}} per input */
  mode: "batch" | "single";
  /** where the numeric output lives in the response, e.g. "outputs", "outputs[*].score", "result.score" */
  outputPath: string;
  /** optional request header that carries the session credential, e.g. "x-api-key" */
  authHeader?: string;
  /** inputs per upstream request in batch mode (1-64) */
  maxBatch?: number;
};

/** builtin: in-browser synthetic; external: user-connected API; python: multi-agent Python engine (backend/) */
export type TargetOrigin = "builtin" | "external" | "python";

/** Public contract of a black-box target: what an investigator would see in API docs. */
export type TargetSpec = {
  id: string;
  name: string;
  vendor: string;
  version: string;
  domain: string;
  endpoint: string;
  description: string;
  output: OutputSpec;
  features: Feature[];
  defaultBudget: number;
  stochastic: boolean;
  /** built-in synthetic target (default) or an independently hosted API */
  origin?: TargetOrigin;
  connection?: Connection;
  /** id of the bundled synthetic blind challenge, when loaded from its example */
  challengeId?: string;
};

export type InputValue = number | string;
export type Input = Record<string, InputValue>;

export type QueryResponse = {
  outputs: number[];
  receipt: { id: string; served: number; latencyMs: number; at: number };
};

// ---------------------------------------------------------------------------
// Investigation state
// ---------------------------------------------------------------------------

export type AgentId = "persona" | "experimenter" | "statistician" | "reporter";
export const AGENTS: AgentId[] = ["persona", "experimenter", "statistician", "reporter"];

export type QuerySource =
  | "baseline"
  | "replicate"
  | "holdout"
  | "pair"
  | "sweep"
  | "bisect"
  | "confirm"
  | "factorial"
  | "active"
  | "manual"
  | "validation"
  | "verify";

export type Observation = {
  id: number;
  input: Input;
  output: number;
  t: number;
  source: QuerySource;
  experimentId?: string;
  personaId?: string;
};

export type AgentStatus = "idle" | "working" | "waiting" | "done" | "error";

export type AgentRuntime = {
  status: AgentStatus;
  currentTaskId?: string;
  completed: number;
  queries: number;
};

export type AgentTask = {
  id: string;
  agent: AgentId;
  title: string;
  phase: PhaseId;
  status: "running" | "done" | "cancelled" | "error";
  startedAt: number;
  endedAt?: number;
  inputs: string;
  outputs?: string;
  decision?: string;
  queries: number;
  experimentIds?: string[];
  hypothesisIds?: string[];
};

export type Handoff = {
  id: string;
  from: AgentId | "target";
  to: AgentId | "target";
  t: number;
  payload: string;
  count?: number;
};

export type ExperimentKind =
  | "baseline"
  | "replicate"
  | "holdout"
  | "counterfactual"
  | "sweep"
  | "bisection"
  | "confirmation"
  | "factorial"
  | "active"
  | "manual"
  | "validation"
  | "verification";

export type PairRecord = { a: number; b: number; changed: string[]; delta: number };

export type SeriesPoint = { x: number; y: number; persona: string; obsId: number };

export type FactorialCell = { a: string; b: string; mean: number; n: number };

export type Experiment = {
  id: string;
  kind: ExperimentKind;
  phase: PhaseId;
  title: string;
  design: string;
  features: string[];
  status: "planned" | "running" | "done" | "cancelled";
  observationIds: number[];
  pairs?: PairRecord[];
  series?: SeriesPoint[];
  cells?: FactorialCell[];
  result?: {
    summary: string;
    effect?: number;
    relEffect?: number;
    ci?: [number, number];
    p?: number;
    n?: number;
    zeroShare?: number;
  };
  hypothesisIds: string[];
  createdAt: number;
  completedAt?: number;
  agent: AgentId;
  /** rule re-tested by an analyst verification */
  ruleId?: string;
  /** controlled verification of a finding with repeated fresh queries */
  verification?: Verification;
};

export type Verification = {
  baseline: Input;
  variant: Input;
  changed: string[];
  reps: number;
  baselineOutputs: number[];
  variantOutputs: number[];
  meanDiff: number;
  ci: [number, number];
  p: number;
  method: string;
  warnings: string[];
};

export type HypothesisKind = "effect" | "null" | "level" | "linear" | "threshold" | "interaction";
export type HypothesisStatus = "proposed" | "testing" | "supported" | "rejected" | "inconclusive";

export type Hypothesis = {
  id: string;
  kind: HypothesisKind;
  statement: string;
  features: string[];
  level?: string;
  status: HypothesisStatus;
  confidence: number;
  effect?: { estimate: number; ci: [number, number]; rel?: number; unit: string };
  threshold?: { value: number; lo: number; hi: number; direction: "up" | "down" | "window"; end?: number };
  test?: { name: string; statistic: number; p: number; n: number };
  evidence: { supporting: string[]; conflicting: string[] };
  related: string[];
  competes: string[];
  history: { t: number; status: HypothesisStatus; note: string }[];
  origin: AgentId;
  createdAt: number;
  updatedAt: number;
};

export type TreeNode = {
  id: number;
  n: number;
  value: number;
  sd: number;
  depth: number;
  feature?: string;
  threshold?: number;
  /** categorical split: levels routed to the left child */
  levels?: string[];
  left?: TreeNode;
  right?: TreeNode;
  gain?: number;
};

export type Fidelity = { r2: number; mae: number; rmse: number; n: number };

/**
 * "validation": monitoring set, scored repeatedly during the run.
 * "test": sealed set, scored once by the final model only.
 */
export type EvalSet = "validation" | "test";

export type SurrogateModel = {
  version: number;
  tree: TreeNode;
  fidelity: Fidelity;
  importance: Record<string, number>;
  residuals: { obsId: number; actual: number; predicted: number }[];
  trainedOn: number;
  evaluatedOn?: EvalSet;
  leaves: number;
  depth: number;
  at: number;
};

export type ALCandidate = { u: number; v: number; mean: number; sd: number; selected: boolean };

export type ALRound = {
  round: number;
  axes: [string, string];
  candidates: ALCandidate[];
  explored: { u: number; v: number; output: number }[];
  selectedObsIds: number[];
  /** selected probes, aligned index-for-index with selectedObsIds */
  probes: ALCandidate[];
  meanSd: number;
  maxSd: number;
  holdoutRmse: number;
  queriesSoFar: number;
  at: number;
};

export type BenchmarkCurve = { n: number; rmse: number; lo: number; hi: number }[];

export type Benchmark = {
  status: "running" | "done" | "cancelled" | "error";
  seeds: number;
  holdoutSize: number;
  queriesUsed: number;
  adaptive: BenchmarkCurve;
  random: BenchmarkCurve;
  startedAt: number;
  completedAt?: number;
  error?: string;
  progress: number;
  /** training queries given to each strategy per run (equal by design) */
  perStrategyBudget?: number;
  /** final held-out RMSE of every run, index-aligned across strategies */
  finals?: { adaptive: number[]; random: number[] };
  /** HTTP requests sent for the benchmark, including retries */
  requests?: number;
  /** Python engine: true rules recovered vs queries, scored after each run */
  rules?: {
    total: number;
    adaptive: { n: number; found: number; lo: number; hi: number }[];
    random: { n: number; found: number; lo: number; hi: number }[];
    falsePositives?: { adaptive: number[]; random: number[] };
  };
};

export type Rule = {
  id: string;
  index: number;
  kind: HypothesisKind;
  title: string;
  statement: string;
  features: string[];
  conditions: string[];
  effect: string;
  confidence: number;
  strength: "strong" | "moderate" | "weak";
  ci?: [number, number];
  estimate?: number;
  unit?: string;
  support: number;
  hypothesisIds: string[];
  experimentIds: string[];
  alternatives: string[];
  /** re-tested on fresh subjects by a dedicated confirmation experiment */
  confirmed?: boolean;
  test?: { name: string; p: number; n: number; statistic?: number };
  /** Python engine: confidence badge, BH-adjusted q and DoWhy refuters */
  badge?: "high" | "medium" | "suspected";
  q?: number;
  refuters?: { name: string; passed: boolean | null; detail: string }[];
};

export type Report = {
  summary: string;
  rules: Rule[];
  caveats: string[];
  noiseSd: number;
  generatedAt: number;
};

export type LogLine = {
  id: number;
  t: number;
  source: AgentId | "system" | "target";
  level: "info" | "ok" | "warn" | "error" | "query";
  text: string;
};

export type PhaseId =
  | "recon"
  | "screening"
  | "structure"
  | "interactions"
  | "active"
  | "synthesis";

export const PHASES: { id: PhaseId; label: string; short: string }[] = [
  { id: "recon", label: "Reconnaissance", short: "RECON" },
  { id: "screening", label: "Sensitivity screening", short: "SCREEN" },
  { id: "structure", label: "Structure probing", short: "STRUCT" },
  { id: "interactions", label: "Interaction testing", short: "INTERACT" },
  { id: "active", label: "Active learning", short: "ACTIVE" },
  { id: "synthesis", label: "Synthesis", short: "SYNTH" },
];

export type Pace = "cinematic" | "standard" | "instant";

export type InvestigationStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "error"
  | "interrupted";

export type InvestigationState = {
  id: string;
  name: string;
  target: TargetSpec;
  status: InvestigationStatus;
  phase: PhaseId | null;
  phaseProgress: Record<PhaseId, number>;
  /** used = inputs evaluated; requests = HTTP requests sent to the target, retries included */
  budget: { limit: number; used: number; requests?: number };
  pace: Pace;
  seed: number;
  createdAt: number;
  updatedAt: number;
  observations: Observation[];
  experiments: Experiment[];
  hypotheses: Hypothesis[];
  agents: Record<AgentId, AgentRuntime>;
  tasks: AgentTask[];
  handoffs: Handoff[];
  logs: LogLine[];
  surrogate?: SurrogateModel;
  alRounds: ALRound[];
  report?: Report;
  benchmark?: Benchmark;
  error?: string;
  /** opened from the guided demo */
  guided?: boolean;
  /** a recorded run loaded for display; never presented as live */
  saved?: { recordedAt: number; note: string };
  groundTruth?: GroundTruth;
};

export type GroundTruthRule = { id: string; text: string; features: string[]; verdict?: "recovered" | "partial" | "missed" };

/** Operator-revealed true rules, attached only after an investigation has stopped. */
export type GroundTruth = {
  source: string;
  revealedAt: number;
  rules: GroundTruthRule[];
  /** automatic scorecard from the Python engine */
  scorecard?: { found: number; partial: number; total: number; falsePositives: string[]; decoysFooled: string[]; queries: number };
};

// ---------------------------------------------------------------------------
// Engine event protocol (worker -> UI). Applied by a single shared reducer.
// ---------------------------------------------------------------------------

export type EngineEvent =
  | { type: "status"; status: InvestigationStatus; error?: string }
  | { type: "phase"; phase: PhaseId | null }
  | { type: "phaseProgress"; phase: PhaseId; progress: number }
  | { type: "agent"; agent: AgentId; patch: Partial<AgentRuntime> }
  | { type: "task"; task: AgentTask }
  | { type: "handoff"; handoff: Handoff }
  | { type: "observations"; observations: Observation[] }
  | { type: "experiment"; experiment: Experiment }
  | { type: "hypothesis"; hypothesis: Hypothesis }
  | { type: "log"; line: LogLine }
  | { type: "surrogate"; model: SurrogateModel }
  | { type: "alRound"; round: ALRound }
  | { type: "report"; report: Report }
  | { type: "requests"; count: number }
  | { type: "benchmark"; benchmark: Benchmark };

export type WorkerCommand =
  | { cmd: "start"; state: InvestigationState; origin: string; credential?: string }
  | { cmd: "pause" }
  | { cmd: "resume" }
  | { cmd: "cancel" }
  | { cmd: "pace"; pace: Pace }
  | { cmd: "benchmark"; state: InvestigationState; origin: string; seeds: number; credential?: string };

export type WorkerMessage = { id: string; events: EngineEvent[] };
