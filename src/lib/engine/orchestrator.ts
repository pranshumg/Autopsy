// The investigation orchestrator. Four cooperating agents probe a black-box
// target purely through its HTTP query endpoint:
//
//   Persona       designs synthetic inputs (personas) and selects test subjects
//   Experimenter  designs controlled experiments and executes queries
//   Statistician  tests hypotheses, estimates effects and fits surrogates
//   Reporter      synthesizes supported findings into the Hidden Rulebook
//
// Agents are deterministic statistical procedures. Every task they record is
// an observable operation with concrete inputs and outputs, not a narrative.
//
// Every query goes through a TargetAdapter, so built-in synthetic targets and
// independently hosted APIs share this exact pipeline.

import type {
  AgentId,
  AgentTask,
  CategoricalFeature,
  EngineEvent,
  Experiment,
  FactorialCell,
  Feature,
  Hypothesis,
  HypothesisStatus,
  Input,
  InvestigationState,
  LogLine,
  NumericFeature,
  Observation,
  PairRecord,
  Pace,
  PhaseId,
  QuerySource,
  Report,
  Rule,
  SeriesPoint,
  SurrogateModel,
  TreeNode,
} from "@/lib/types";
import { applyEvents } from "./reducer";
import { TargetError, type TargetAdapter } from "@/lib/adapter";
import { fmtDelta, fmtFeature, fmtOutput, fmtP, fmtPct, labelOf } from "@/lib/format";
import {
  bic,
  bootstrapCI,
  confidenceFrom,
  linearSSE,
  mae,
  mean,
  median,
  mulberry32,
  quantile,
  r2,
  rmse,
  sd,
  signFlipP,
  stepSSE,
  type Rng,
} from "./stats";
import { distance, isLogScale, latinHypercube, positionOf, randomInput, shuffle, valueAt } from "./design";
import { fitEnsemble, fitTree, importance, predict, predictEnsemble, treeStats } from "./tree";

export class Cancelled extends Error {}
export class BudgetExhausted extends Error {}

const PACE_MS: Record<Pace, number> = { cinematic: 520, standard: 160, instant: 0 };
const pad = (n: number, w: number) => String(n).padStart(w, "0");
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type TaskPatch = Partial<Pick<AgentTask, "outputs" | "decision" | "experimentIds" | "hypothesisIds">>;

type DiffStats = { mean: number; ci: [number, number]; p: number; n: number };
type Verdict = "effect" | "null" | "unclear";

type FeatureEffect = {
  feature: string;
  verdict: Verdict;
  magnitude: number;
  lo?: number;
  hi?: number;
  bestLevel?: string;
  strongestPersonas: string[];
  hypothesisId: string;
  /** a randomized null audit found outsized responses; worth a structure probe */
  audit?: boolean;
};

export class InvestigationEngine {
  s: InvestigationState;
  private rng: Rng;
  private queue: EngineEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private cancelled = false;
  private c = { obs: 0, exp: 0, hyp: 0, task: 0, handoff: 0, log: 0, persona: 0 };
  private taskStack: { id: string; queries: number }[] = [];

  private personas = new Map<string, Input>();
  private baseline = new Map<string, number>();
  /** sealed test set: scored once, by the final surrogate only */
  private holdout: Observation[] = [];
  /** monitoring set: scored by intermediate surrogates and active-learning rounds */
  private validation: Observation[] = [];
  private abort = new AbortController();
  private exps = new Map<string, Experiment>();
  private hyps = new Map<string, Hypothesis>();
  private effects = new Map<string, FeatureEffect>();
  private thresholds = new Map<string, { lo: number; hi: number }>();

  private floor = 0;
  private floorShare = 0;
  private spread = 1;
  private noiseSd = 0;
  private margin = 1;
  private reserve = 0;
  private surrogateVersion = 0;

  constructor(
    state: InvestigationState,
    private adapter: TargetAdapter,
    private post: (events: EngineEvent[]) => void,
  ) {
    this.s = state;
    this.rng = mulberry32(state.seed);
    this.reserve = Math.round(state.budget.limit * 0.04);
  }

  // ---------------------------------------------------------------- plumbing

  private emit(...events: EngineEvent[]) {
    this.s = applyEvents(this.s, events, Date.now());
    this.queue.push(...events);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 60);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    this.post(batch);
  }

  private log(source: LogLine["source"], level: LogLine["level"], text: string) {
    this.emit({ type: "log", line: { id: ++this.c.log, t: Date.now(), source, level, text } });
  }

  pause() {
    if (this.s.status !== "running") return;
    this.paused = true;
    this.emit({ type: "status", status: "paused" });
    this.log("system", "warn", "Investigation paused by analyst");
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.emit({ type: "status", status: "running" });
    this.log("system", "info", "Investigation resumed");
  }

  cancel() {
    this.cancelled = true;
    this.paused = false;
    // abort in-flight target requests; the run loop turns this into a cancellation
    this.abort.abort();
  }

  setPace(p: Pace) {
    this.s = { ...this.s, pace: p };
  }

  private async checkpoint() {
    while (this.paused && !this.cancelled) await new Promise((r) => setTimeout(r, 120));
    if (this.cancelled) throw new Cancelled();
  }

  private async beat(mult = 1) {
    await this.checkpoint();
    const ms = PACE_MS[this.s.pace] * mult;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    await this.checkpoint();
  }

  private remaining() {
    return this.s.budget.limit - this.reserve - this.s.budget.used;
  }

  private canAfford(n: number) {
    return this.remaining() >= n;
  }

  private setPhase(phase: PhaseId | null) {
    this.emit({ type: "phase", phase });
    if (phase) this.log("system", "info", `── phase: ${phase.toUpperCase()} ──`);
  }

  private progress(phase: PhaseId, p: number) {
    this.emit({ type: "phaseProgress", phase, progress: clamp(p, 0, 1) });
  }

  private handoff(from: AgentId | "target", to: AgentId | "target", payload: string, count?: number) {
    this.emit({ type: "handoff", handoff: { id: `X-${++this.c.handoff}`, from, to, t: Date.now(), payload, count } });
    if (from !== "target" && to !== "target") this.log(from, "info", `⇢ ${to}: ${payload}`);
  }

  private async task<T>(agent: AgentId, title: string, inputs: string, fn: (set: (p: TaskPatch) => void) => Promise<T>): Promise<T> {
    await this.checkpoint();
    const base: AgentTask = {
      id: `T-${pad(++this.c.task, 3)}`,
      agent,
      title,
      phase: this.s.phase ?? "recon",
      status: "running",
      startedAt: Date.now(),
      inputs,
      queries: 0,
    };
    const frame = { id: base.id, queries: 0 };
    this.taskStack.push(frame);
    this.emit({ type: "task", task: base }, { type: "agent", agent, patch: { status: "working", currentTaskId: base.id } });
    let patch: TaskPatch = {};
    const set = (p: TaskPatch) => {
      patch = { ...patch, ...p };
    };
    try {
      const out = await fn(set);
      this.emit(
        { type: "task", task: { ...base, ...patch, status: "done", endedAt: Date.now(), queries: frame.queries } },
        {
          type: "agent",
          agent,
          patch: { status: "idle", currentTaskId: undefined, completed: this.s.agents[agent].completed + 1 },
        },
      );
      if (patch.decision) this.log(agent, "ok", `✓ ${title} — ${patch.decision}`);
      return out;
    } catch (e) {
      const cancelled = e instanceof Cancelled || e instanceof BudgetExhausted;
      this.emit(
        {
          type: "task",
          task: {
            ...base,
            ...patch,
            status: cancelled ? "cancelled" : "error",
            endedAt: Date.now(),
            queries: frame.queries,
            decision: e instanceof BudgetExhausted ? "Stopped: query budget exhausted" : patch.decision,
          },
        },
        { type: "agent", agent, patch: { status: cancelled ? "idle" : "error", currentTaskId: undefined } },
      );
      throw e;
    } finally {
      this.taskStack.pop();
    }
  }

  private async query(inputs: Input[], source: QuerySource, experimentId?: string, personaIds?: (string | undefined)[]): Promise<Observation[]> {
    if (!inputs.length) return [];
    const allowance = source === "holdout" || source === "validation" ? this.s.budget.limit - this.s.budget.used : this.remaining();
    if (inputs.length > allowance) throw new BudgetExhausted();
    const out: Observation[] = [];
    for (let i = 0; i < inputs.length; i += 64) {
      await this.checkpoint();
      const chunk = inputs.slice(i, i + 64);
      this.handoff("experimenter", "target", `${chunk.length} ${source} queries`, chunk.length);
      let res;
      try {
        res = await this.adapter.query(chunk, this.abort.signal);
      } catch (e) {
        if (e instanceof TargetError) {
          if (e.requests) this.emit({ type: "requests", count: e.requests });
          if (e.code === "cancelled" || this.cancelled) throw new Cancelled();
          this.log("target", "error", `Query failed (${e.code}): ${e.message}`);
        }
        throw e;
      }
      this.emit({ type: "requests", count: res.requests });
      const now = Date.now();
      const obs: Observation[] = chunk.map((x, j) => ({
        id: ++this.c.obs,
        input: x,
        output: res.outputs[j],
        t: now,
        source,
        experimentId,
        personaId: personaIds?.[i + j],
      }));
      for (const f of this.taskStack) f.queries += obs.length;
      this.emit(
        { type: "observations", observations: obs },
        { type: "agent", agent: "experimenter", patch: { queries: this.s.agents.experimenter.queries + obs.length } },
      );
      this.handoff("target", "experimenter", `${obs.length} responses · ${res.latencyMs}ms`, obs.length);
      this.log(
        "target",
        "query",
        `${res.receiptId} · ${obs.length}× ${source}${experimentId ? ` · ${experimentId}` : ""} · ${res.requests} request${res.requests === 1 ? "" : "s"} · ${res.latencyMs}ms · budget ${this.s.budget.used}/${this.s.budget.limit}`,
      );
      out.push(...obs);
    }
    return out;
  }

  private putExp(e: Experiment): Experiment {
    this.exps.set(e.id, e);
    this.emit({ type: "experiment", experiment: e });
    return e;
  }

  private newExp(p: Pick<Experiment, "kind" | "title" | "design" | "features"> & Partial<Experiment>): Experiment {
    return this.putExp({
      id: `E-${pad(++this.c.exp, 3)}`,
      phase: this.s.phase ?? "recon",
      status: "planned",
      observationIds: [],
      hypothesisIds: [],
      createdAt: Date.now(),
      agent: "experimenter",
      ...p,
    });
  }

  private patchExp(id: string, p: Partial<Experiment>): Experiment {
    return this.putExp({ ...this.exps.get(id)!, ...p });
  }

  private putHyp(h: Hypothesis): Hypothesis {
    this.hyps.set(h.id, h);
    this.emit({ type: "hypothesis", hypothesis: h });
    return h;
  }

  private propose(kind: Hypothesis["kind"], statement: string, features: string[], extra: Partial<Hypothesis> = {}): Hypothesis {
    const now = Date.now();
    const h = this.putHyp({
      id: `H-${pad(++this.c.hyp, 2)}`,
      kind,
      statement,
      features,
      status: "proposed",
      confidence: 0.5,
      evidence: { supporting: [], conflicting: [] },
      related: [],
      competes: [],
      history: [{ t: now, status: "proposed", note: "Proposed by statistician" }],
      origin: "statistician",
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    this.log("statistician", "info", `${h.id} proposed: ${statement}`);
    return h;
  }

  private patchHyp(id: string, p: Partial<Hypothesis>, status?: HypothesisStatus, note?: string): Hypothesis {
    const h = this.hyps.get(id)!;
    const now = Date.now();
    const next: Hypothesis = { ...h, ...p, updatedAt: now };
    if (status && (status !== h.status || note)) {
      next.status = status;
      next.history = [...h.history, { t: now, status, note: note ?? "" }];
      if (status === "supported") this.log("statistician", "ok", `${id} SUPPORTED · ${next.statement}`);
      else if (status === "rejected") this.log("statistician", "warn", `${id} REJECTED · ${note ?? next.statement}`);
      else if (status === "inconclusive") this.log("statistician", "warn", `${id} INCONCLUSIVE · ${note ?? ""}`);
    }
    return this.putHyp(next);
  }

  private link(hId: string, expId: string, kind: "supporting" | "conflicting") {
    const h = this.hyps.get(hId)!;
    if (!h.evidence[kind].includes(expId)) {
      this.patchHyp(hId, { evidence: { ...h.evidence, [kind]: [...h.evidence[kind], expId] } });
    }
    const e = this.exps.get(expId)!;
    if (!e.hypothesisIds.includes(hId)) this.patchExp(expId, { hypothesisIds: [...e.hypothesisIds, hId] });
  }

  private relate(a: string, b: string, how: "related" | "competes") {
    const ha = this.hyps.get(a)!;
    const hb = this.hyps.get(b)!;
    if (!ha[how].includes(b)) this.patchHyp(a, { [how]: [...ha[how], b] });
    if (!hb[how].includes(a)) this.patchHyp(b, { [how]: [...hb[how], a] });
  }

  private feature(key: string): Feature {
    return this.s.target.features.find((f) => f.key === key)!;
  }

  private out(v: number) {
    return fmtOutput(this.s.target.output, v);
  }

  private delta(v: number) {
    return fmtDelta(this.s.target.output, v);
  }

  private isResponsive(y: number) {
    return this.floorShare < 0.03 || y > this.floor + Math.max(1e-6, this.margin * 0.05);
  }

  /** Persona agent's subject selection: mostly responsive personas, some at random. */
  private pickPersonas(k: number, preferResponsive = 0.75, exclude: string[] = []): string[] {
    const ids = shuffle(
      [...this.personas.keys()].filter((id) => !exclude.includes(id)),
      this.rng,
    );
    const resp = ids.filter((id) => this.isResponsive(this.baseline.get(id) ?? this.floor));
    const nResp = Math.min(resp.length, Math.round(k * preferResponsive));
    const chosen = resp.slice(0, nResp);
    for (const id of ids) {
      if (chosen.length >= k) break;
      if (!chosen.includes(id)) chosen.push(id);
    }
    return chosen;
  }

  private diffStats(diffs: number[]): DiffStats {
    return { mean: mean(diffs), ci: bootstrapCI(diffs, this.rng, 800), p: signFlipP(diffs, this.rng), n: diffs.length };
  }

  private verdict(d: DiffStats, alpha = 0.02): Verdict {
    const excludes = d.ci[0] > 0 || d.ci[1] < 0;
    if (d.p < alpha && excludes && Math.abs(d.mean) >= this.margin * 0.5) return "effect";
    if (d.ci[0] > -this.margin && d.ci[1] < this.margin) return "null";
    return "unclear";
  }

  /** Three-level screening design near both extremes and the centre of the range. */
  private screeningLevels(f: NumericFeature): [number, number, number] {
    return [valueAt(f, 0.04), valueAt(f, 0.5), valueAt(f, 0.96)];
  }

  private interactionLevels(f: NumericFeature): [number, number] {
    return [valueAt(f, 0.2), valueAt(f, 0.8)];
  }

  /** Pairs where both arms sit at the gated floor carry no information about the field. */
  private informative(ps: PairRecord[]): PairRecord[] {
    if (this.floorShare < 0.03) return ps;
    const keep = ps.filter((p) => this.isResponsive(this.obsById(p.a)!.output) || this.isResponsive(this.obsById(p.b)!.output));
    return keep.length >= 6 ? keep : ps;
  }

  // -------------------------------------------------------------------- run

  async run() {
    const t0 = Date.now();
    try {
      this.emit({ type: "status", status: "running" });
      this.log(
        "system",
        "info",
        `Investigation ${this.s.id} opened against ${this.s.target.name} ${this.s.target.version} · budget ${this.s.budget.limit} queries · seed ${this.s.seed}`,
      );
      try {
        await this.phaseRecon();
        await this.phaseScreening();
        await this.phaseStructure();
        await this.phaseInteractions();
        await this.phaseActive();
      } catch (e) {
        if (!(e instanceof BudgetExhausted)) throw e;
        this.log("system", "warn", "Query budget exhausted — proceeding directly to synthesis");
      }
      await this.phaseSynthesis();
      for (const a of ["persona", "experimenter", "statistician", "reporter"] as AgentId[]) {
        this.emit({ type: "agent", agent: a, patch: { status: "done" } });
      }
      this.setPhase(null);
      this.emit({ type: "status", status: "completed" });
      this.log("system", "ok", `Investigation complete in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${this.s.budget.used} queries issued`);
    } catch (e) {
      if (e instanceof Cancelled) {
        for (const ex of this.exps.values()) {
          if (ex.status === "running" || ex.status === "planned") this.patchExp(ex.id, { status: "cancelled" });
        }
        for (const h of this.hyps.values()) {
          if (h.status === "testing") this.patchHyp(h.id, {}, "inconclusive", "Testing interrupted by cancellation");
        }
        this.log("system", "warn", "Investigation cancelled by analyst");
        this.cancelled = false;
        this.abort = new AbortController();
        this.partialReason = `the investigation was cancelled during the ${this.s.phase ?? "final"} phase`;
        try {
          if (this.trainingRows().length >= 30) await this.phaseSynthesis(true);
        } catch {
          /* partial synthesis is best-effort */
        }
        for (const a of ["persona", "experimenter", "statistician", "reporter"] as AgentId[]) {
          this.emit({ type: "agent", agent: a, patch: { status: "idle", currentTaskId: undefined } });
        }
        this.setPhase(null);
        this.emit({ type: "status", status: "cancelled" });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        this.log("system", "error", `Investigation failed: ${msg}`);
        // keep whatever was learned before the target failed, clearly marked as partial
        if (e instanceof TargetError && this.trainingRows().length >= 30) {
          try {
            this.partialReason = `the target stopped answering (${e.code})`;
            await this.phaseSynthesis(true);
          } catch {
            /* partial synthesis is best-effort */
          }
        }
        this.setPhase(null);
        this.emit({ type: "status", status: "error", error: msg });
      }
    } finally {
      this.flush();
    }
  }

  // ------------------------------------------------------------ phase: recon

  private async phaseRecon() {
    this.setPhase("recon");
    const spec = this.s.target;
    const L = this.s.budget.limit;
    const n0 = clamp(Math.round(L * 0.05), 24, 64);

    const ids = await this.task("persona", `Generate ${n0} synthetic personas`, `Public schema: ${spec.features.length} fields`, async (set) => {
      await this.beat();
      const xs = latinHypercube(spec, n0, this.rng);
      const ids = xs.map((x) => {
        const id = `P-${pad(++this.c.persona, 3)}`;
        this.personas.set(id, x);
        return id;
      });
      const nNum = spec.features.filter((f) => f.kind === "numeric").length;
      set({
        outputs: `${n0} personas covering ${nNum} numeric and ${spec.features.length - nNum} categorical fields`,
        decision: "Latin-hypercube stratification on numeric fields, balanced rotation of categorical levels",
      });
      return ids;
    });
    this.handoff("persona", "experimenter", `${ids.length} personas for baseline survey`, ids.length);
    this.progress("recon", 0.2);

    const base = this.newExp({
      kind: "baseline",
      title: "Baseline response survey",
      design: `Query each of ${n0} personas once to map the overall response surface.`,
      features: spec.features.map((f) => f.key),
    });
    await this.task("experimenter", `Execute ${base.id} · baseline survey`, `${n0} personas`, async (set) => {
      this.patchExp(base.id, { status: "running" });
      await this.beat();
      const obs = await this.query(
        ids.map((id) => this.personas.get(id)!),
        "baseline",
        base.id,
        ids,
      );
      obs.forEach((o) => this.baseline.set(o.personaId!, o.output));
      const ys = obs.map((o) => o.output);
      this.patchExp(base.id, {
        status: "done",
        observationIds: obs.map((o) => o.id),
        completedAt: Date.now(),
        result: { summary: `Median ${this.out(median(ys))}, range ${this.out(Math.min(...ys))}–${this.out(Math.max(...ys))}`, n: ys.length },
      });
      set({ outputs: `${obs.length} responses recorded`, decision: `Median response ${this.out(median(ys))}`, experimentIds: [base.id] });
    });
    this.handoff("experimenter", "statistician", `${n0} baseline observations`, n0);
    this.progress("recon", 0.45);

    // floor / gating profile
    const ys = [...this.baseline.values()];
    this.floor = Math.min(...ys);
    this.floorShare = ys.filter((y) => Math.abs(y - this.floor) < 1e-6).length / ys.length;
    this.spread = quantile(ys, 0.9) - quantile(ys, 0.1) || (spec.output.max - spec.output.min) * 0.1;

    // replicates: estimate stochasticity
    const repIds = this.pickPersonas(8, 1);
    const rep = this.newExp({
      kind: "replicate",
      title: "Replicate probes · noise floor",
      design: `Re-query ${repIds.length} personas twice with identical inputs to measure response noise.`,
      features: [],
    });
    await this.task("experimenter", `Execute ${rep.id} · replicate probes`, `${repIds.length} personas × 2 repeats`, async (set) => {
      this.patchExp(rep.id, { status: "running" });
      await this.beat();
      const inputs = [...repIds, ...repIds].map((id) => this.personas.get(id)!);
      const obs = await this.query(inputs, "replicate", rep.id, [...repIds, ...repIds]);
      const groups = repIds.map((id) => [this.baseline.get(id)!, ...obs.filter((o) => o.personaId === id).map((o) => o.output)]);
      const sds = groups.map((g) => sd(g));
      this.noiseSd = Math.sqrt(mean(sds.map((x) => x * x)));
      this.patchExp(rep.id, {
        status: "done",
        observationIds: obs.map((o) => o.id),
        completedAt: Date.now(),
        result: { summary: `Within-input SD ${this.out(this.noiseSd)} — target is ${this.noiseSd > 0 ? "stochastic" : "deterministic"}`, n: obs.length },
      });
      set({ outputs: `${obs.length} repeat responses`, decision: `Noise SD ≈ ${this.out(this.noiseSd)}`, experimentIds: [rep.id] });
    });
    this.progress("recon", 0.65);

    // Held-out data, split in two so that no number shown during the run is the
    // final score: a validation set monitors progress (intermediate surrogates,
    // active-learning error) and a sealed test set is scored once at synthesis.
    // Neither is ever used to fit models, choose queries or decide when to stop.
    const H = clamp(Math.round(L * 0.08), 40, 100);
    const V = Math.round(H * 0.4);
    const T = H - V;
    const val = this.newExp({
      kind: "validation",
      title: "Validation set · progress monitoring",
      design: `${V} uniformly random inputs used only to report progress during the run. Never used for training, query selection or stopping.`,
      features: spec.features.map((f) => f.key),
    });
    const hold = this.newExp({
      kind: "holdout",
      title: "Sealed test set",
      design: `${T} uniformly random inputs, never used for training or monitoring — scored once by the final surrogate.`,
      features: spec.features.map((f) => f.key),
    });
    await this.task("experimenter", `Execute ${val.id}, ${hold.id} · held-out sampling`, `${V} validation + ${T} test inputs`, async (set) => {
      this.patchExp(val.id, { status: "running" });
      this.patchExp(hold.id, { status: "running" });
      await this.beat();
      this.validation = await this.query(Array.from({ length: V }, () => randomInput(spec, this.rng)), "validation", val.id);
      this.patchExp(val.id, { status: "done", observationIds: this.validation.map((o) => o.id), completedAt: Date.now(), result: { summary: `${V} monitoring responses`, n: V } });
      this.holdout = await this.query(Array.from({ length: T }, () => randomInput(spec, this.rng)), "holdout", hold.id);
      this.patchExp(hold.id, {
        status: "done",
        observationIds: this.holdout.map((o) => o.id),
        completedAt: Date.now(),
        result: { summary: `${T} test responses sealed`, n: T },
      });
      set({ outputs: `${V} validation + ${T} sealed test responses`, decision: "Both sets excluded from model fitting and query selection", experimentIds: [val.id, hold.id] });
    });
    this.progress("recon", 0.85);

    await this.task("statistician", "Profile response distribution", `${ys.length} baseline + replicate observations`, async (set) => {
      await this.beat();
      this.margin = Math.max(0.03 * this.spread, 1.5 * this.noiseSd, 1e-6);
      const gate = this.floorShare >= 0.03;
      set({
        outputs: `Spread (P10–P90) ${this.out(this.spread)} · ${(this.floorShare * 100).toFixed(0)}% of personas at floor ${this.out(this.floor)}`,
        decision: `${gate ? `Gating detected at ${this.out(this.floor)} — subjects selected from the responsive region. ` : ""}Equivalence margin δ = ±${this.out(this.margin)}`,
      });
    });
    this.progress("recon", 1);
    this.fitSurrogate("recon");
  }

  // -------------------------------------------------------- phase: screening

  private async phaseScreening() {
    this.setPhase("screening");
    const spec = this.s.target;
    const out = spec.output.label.toLowerCase();
    const k = clamp(Math.round(this.s.budget.limit / 100), 8, 12);

    const hypFor = new Map<string, string>();
    await this.task("statistician", "Propose main-effect hypotheses", `${spec.features.length} input fields`, async (set) => {
      await this.beat();
      for (const f of spec.features) {
        const h = this.propose("effect", `${f.label} influences ${out}`, [f.key]);
        hypFor.set(f.key, h.id);
      }
      set({ outputs: `${spec.features.length} hypotheses`, decision: "Test every field with one-factor counterfactual pairs", hypothesisIds: [...hypFor.values()] });
    });
    this.handoff("statistician", "experimenter", `${hypFor.size} main-effect hypotheses to test`, hypFor.size);

    let i = 0;
    for (const f of spec.features) {
      const hId = hypFor.get(f.key)!;
      const perKind = f.kind === "numeric" ? 3 : f.levels.length;
      if (!this.canAfford(perKind * k)) {
        this.patchHyp(hId, {}, "inconclusive", "Not tested — insufficient budget");
        continue;
      }
      const subjects = await this.task("persona", `Select subjects for ${f.label}`, `${this.personas.size} personas`, async (set) => {
        await this.beat(0.4);
        const ids = this.pickPersonas(k);
        set({ outputs: ids.join(", "), decision: `${ids.length} subjects (${this.floorShare >= 0.03 ? "75% from responsive region" : "random"})` });
        return ids;
      });
      this.handoff("persona", "experimenter", `${subjects.length} subjects for ${f.label}`, subjects.length);
      const r = await this.screenFeature(f, subjects, hId);
      this.effects.set(f.key, r);
      this.progress("screening", ++i / spec.features.length);
    }
    this.fitSurrogate("screening");
  }

  private async runPairs(f: Feature, subjects: string[], expId: string): Promise<PairRecord[]> {
    const inputs: Input[] = [];
    const owners: string[] = [];
    if (f.kind === "numeric") {
      const levels = this.screeningLevels(f);
      for (const id of subjects) {
        for (const v of levels) inputs.push({ ...this.personas.get(id)!, [f.key]: v });
        owners.push(id, id, id);
      }
    } else {
      for (const id of subjects) {
        for (const lv of f.levels) {
          inputs.push({ ...this.personas.get(id)!, [f.key]: lv });
          owners.push(id);
        }
      }
    }
    const obs = await this.query(inputs, "pair", expId, owners);
    const pairs: PairRecord[] = [];
    const step = f.kind === "numeric" ? 3 : f.levels.length;
    for (let s = 0; s < obs.length; s += step) {
      for (let j = 1; j < step; j++) {
        // numeric: consecutive segments (lo→mid, mid→hi); categorical: reference → level
        const a = f.kind === "numeric" ? obs[s + j - 1] : obs[s];
        pairs.push({ a: a.id, b: obs[s + j].id, changed: [f.key], delta: obs[s + j].output - a.output });
      }
    }
    const e = this.exps.get(expId)!;
    this.patchExp(expId, { observationIds: [...e.observationIds, ...obs.map((o) => o.id)], pairs: [...(e.pairs ?? []), ...pairs] });
    return pairs;
  }

  private obsById(id: number): Observation | undefined {
    return this.s.observations.find((o) => o.id === id);
  }

  private async screenFeature(f: Feature, subjects: string[], hId: string): Promise<FeatureEffect> {
    const spec = this.s.target;
    const outLabel = spec.output.label.toLowerCase();
    const design =
      f.kind === "numeric"
        ? `Hold every other field fixed; set ${f.label} to ${this.screeningLevels(f).map((v) => fmtFeature(f, v)).join(" → ")} for each subject.`
        : `Hold every other field fixed; cycle ${f.label} through ${f.levels.join(" / ")} for each subject (reference: ${f.levels[0]}).`;
    const exp = this.newExp({ kind: "counterfactual", title: `${f.label} · counterfactual pairs`, design, features: [f.key] });
    this.link(hId, exp.id, "supporting");
    this.patchHyp(hId, {}, "testing", `Testing with ${exp.id}`);

    let pairs: PairRecord[] = [];
    await this.task("experimenter", `Execute ${exp.id} · ${f.label} counterfactuals`, `${subjects.length} subjects`, async (set) => {
      this.patchExp(exp.id, { status: "running" });
      await this.beat(0.6);
      pairs = await this.runPairs(f, subjects, exp.id);
      set({ outputs: `${pairs.length} controlled pairs`, experimentIds: [exp.id], decision: `${pairs.length} pairs differing only in ${f.key}` });
    });
    this.handoff("experimenter", "statistician", `${pairs.length} pairs for ${f.label}`, pairs.length);

    const zeroShareOf = (ps: PairRecord[]) =>
      ps.filter((p) => !this.isResponsive(this.obsById(p.a)!.output) && !this.isResponsive(this.obsById(p.b)!.output)).length / (ps.length || 1);
    const relOf = (ps: PairRecord[]) => {
      const rs = ps.map((p) => [this.obsById(p.a)!.output, this.obsById(p.b)!.output]).filter(([a]) => a > 0).map(([a, b]) => (b - a) / a);
      return rs.length ? median(rs) : undefined;
    };

    const evaluate = async (ps: PairRecord[], final: boolean): Promise<FeatureEffect | null> => {
      return this.task("statistician", `Evaluate ${f.label} effect`, `${ps.length} paired differences`, async (set) => {
        await this.beat(0.6);
        const strongest = (lv?: string) =>
          [...ps]
            .filter((p) => !lv || this.obsById(p.b)!.input[f.key] === lv)
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 3)
            .map((p) => this.obsById(p.a)!.personaId!)
            .filter(Boolean);

        if (f.kind === "numeric") {
          // pairs arrive as (lo→mid, mid→hi) per subject; test both segments and the total
          const [lo, mid, hi] = this.screeningLevels(f);
          const segs: { a: number; b: number; ps: PairRecord[] }[] = [
            { a: lo, b: mid, ps: ps.filter((_, i) => i % 2 === 0) },
            { a: mid, b: hi, ps: ps.filter((_, i) => i % 2 === 1) },
          ];
          const totals: PairRecord[] = segs[0].ps.map((p, i) => ({ a: p.a, b: segs[1].ps[i].b, changed: [f.key], delta: p.delta + segs[1].ps[i].delta }));
          const tests = [{ a: lo, b: hi, ps: totals }, ...segs].map((t) => {
            const inf = this.informative(t.ps);
            const d = this.diffStats(inf.map((p) => p.delta));
            return { ...t, d, v: this.verdict(d, 0.01), rel: relOf(inf) };
          });
          const sig = tests.filter((t) => t.v === "effect").sort((x, y) => x.d.p - y.d.p || Math.abs(y.d.mean) - Math.abs(x.d.mean));
          const chosen = tests[0].v === "effect" ? tests[0] : (sig[0] ?? tests[0]);
          const v: Verdict = sig.length ? "effect" : tests.every((t) => t.v === "null") ? "null" : "unclear";
          const d = chosen.d;
          const rel = chosen.rel;
          const zs = zeroShareOf(totals);
          this.patchExp(exp.id, {
            result: {
              summary: `Δ ${this.delta(d.mean)} [${this.delta(d.ci[0])}, ${this.delta(d.ci[1])}] · ${fmtP(d.p)}${zs > 0 ? ` · ${(zs * 100).toFixed(0)}% gated pairs` : ""}`,
              effect: d.mean,
              relEffect: rel,
              ci: d.ci,
              p: d.p,
              n: d.n,
              zeroShare: zs,
            },
          });
          if (v === "unclear" && !final) {
            set({ outputs: `Δ ${this.delta(d.mean)}, ${fmtP(d.p)}`, decision: "Ambiguous — request replication" });
            return null;
          }
          return this.settleNumeric(f, hId, exp.id, d, v, rel, chosen.a, chosen.b, strongest(), set);
        }

        // categorical: per-level effects against the reference level
        const levelStats = f.levels.slice(1).map((lv) => {
          const lps = this.informative(ps.filter((p) => this.obsById(p.b)!.input[f.key] === lv));
          const d = this.diffStats(lps.map((p) => p.delta));
          return { lv, d, v: this.verdict(d), rel: relOf(lps) };
        });
        const anyEffect = levelStats.some((l) => l.v === "effect");
        const allNull = levelStats.every((l) => l.v === "null");
        const best = [...levelStats].sort((a, b) => Math.abs(b.d.mean) - Math.abs(a.d.mean))[0];
        this.patchExp(exp.id, {
          result: {
            summary: levelStats.map((l) => `${l.lv}: ${this.delta(l.d.mean)} (${fmtP(l.d.p)})`).join(" · "),
            effect: best.d.mean,
            relEffect: best.rel,
            ci: best.d.ci,
            p: best.d.p,
            n: best.d.n,
            zeroShare: zeroShareOf(ps),
          },
        });
        if (levelStats.some((l) => l.v === "unclear") && !final) {
          set({ outputs: `strongest level ${best.lv}: ${this.delta(best.d.mean)}`, decision: "Ambiguous — request replication" });
          return null;
        }
        if (anyEffect) {
          const sig = levelStats.filter((l) => l.v === "effect");
          const levelIds: string[] = [];
          for (const l of sig) {
            const dir = l.d.mean > 0 ? "raises" : "lowers";
            const rel = l.rel !== undefined ? ` (${fmtPct(l.rel)})` : "";
            const lh = this.propose("level", `${f.label} = ${l.lv.replace(/_/g, " ")} ${dir} ${outLabel} by ${this.delta(l.d.mean).replace(/^[+−]/, "")}${rel} vs ${f.levels[0].replace(/_/g, " ")}`, [f.key], {
              level: l.lv,
            });
            this.link(lh.id, exp.id, "supporting");
            this.patchHyp(
              lh.id,
              {
                effect: { estimate: l.d.mean, ci: l.d.ci, rel: l.rel, unit: spec.output.unit },
                test: { name: "sign-flip permutation", statistic: l.d.mean, p: l.d.p, n: l.d.n },
                confidence: confidenceFrom(l.d.p, l.d.n, true),
              },
              "supported",
              `Paired Δ ${this.delta(l.d.mean)}, ${fmtP(l.d.p)}`,
            );
            this.relate(hId, lh.id, "related");
            levelIds.push(lh.id);
          }
          this.patchHyp(
            hId,
            {
              statement: `${f.label} influences ${outLabel} (${sig.map((l) => l.lv.replace(/_/g, " ")).join(", ")} differ from ${f.levels[0].replace(/_/g, " ")})`,
              effect: { estimate: best.d.mean, ci: best.d.ci, rel: best.rel, unit: spec.output.unit },
              test: { name: "sign-flip permutation", statistic: best.d.mean, p: best.d.p, n: best.d.n },
              confidence: confidenceFrom(best.d.p, best.d.n, true),
            },
            "supported",
            `${sig.length} of ${levelStats.length} levels differ from reference`,
          );
          const nulls = levelStats.filter((l) => l.v === "null").map((l) => l.lv);
          set({
            outputs: levelStats.map((l) => `${l.lv} ${this.delta(l.d.mean)}`).join(", "),
            decision: `Effect supported via ${sig.map((l) => l.lv).join(", ")}${nulls.length ? `; no effect for ${nulls.join(", ")}` : ""}`,
            hypothesisIds: [hId, ...levelIds],
          });
          return {
            feature: f.key,
            verdict: "effect",
            magnitude: Math.abs(best.d.mean),
            bestLevel: best.lv,
            strongestPersonas: strongest(best.lv),
            hypothesisId: hId,
          };
        }
        const pooled = this.diffStats(ps.map((p) => p.delta));
        return this.settleNumeric(f, hId, exp.id, pooled, allNull ? "null" : "unclear", undefined, undefined, undefined, [], set);
      });
    };

    let result = await evaluate(pairs, false);
    if (!result) {
      const more = this.pickPersonas(subjects.length, 0.75, subjects);
      const cost = (f.kind === "numeric" ? 3 : f.levels.length) * more.length;
      if (more.length && this.canAfford(cost)) {
        this.handoff("statistician", "experimenter", `replicate ${f.label} with ${more.length} more subjects`);
        await this.task("experimenter", `Replicate ${exp.id} · ${f.label}`, `${more.length} additional subjects`, async (set) => {
          await this.beat(0.5);
          const extra = await this.runPairs(f, more, exp.id);
          pairs = [...pairs, ...extra];
          set({ outputs: `${extra.length} more pairs`, decision: `Sample size raised to ${pairs.length} pairs` });
        });
      }
      result = (await evaluate(pairs, true))!;
    }
    this.patchExp(exp.id, { status: "done", completedAt: Date.now() });
    if (f.kind === "numeric" && result.verdict === "null") result = await this.nullAudit(f, result);
    return result;
  }

  /** Response large enough that measurement noise cannot plausibly explain it. */
  private outlierThreshold() {
    return Math.max(2 * this.margin, 4 * this.noiseSd * Math.SQRT2);
  }

  /**
   * "No effect" is a strong claim: fixed screening levels can step over a narrow
   * window. Before accepting a null, probe fresh subjects at randomly stratified
   * value pairs across the whole range and look for outsized responses.
   */
  private async nullAudit(f: NumericFeature, prior: FeatureEffect): Promise<FeatureEffect> {
    const k = 12;
    if (!this.canAfford(2 * k)) return prior;
    const subjects = this.pickPersonas(k, 0.9);
    const nullH = [...this.hyps.values()].find((h) => h.kind === "null" && h.features[0] === f.key);
    const exp = this.newExp({
      kind: "counterfactual",
      title: `${f.label} · randomized null audit`,
      design: `Before accepting "no effect", ${k} fresh subjects are queried at two random, stratified values of ${f.label} each, looking for responses noise cannot explain.`,
      features: [f.key],
    });
    if (nullH) this.link(nullH.id, exp.id, "supporting");
    const pairs: PairRecord[] = [];
    await this.task("experimenter", `Execute ${exp.id} · audit ${f.label} null`, `${k} subjects × random value pairs`, async (set) => {
      this.patchExp(exp.id, { status: "running" });
      await this.beat(0.5);
      const inputs: Input[] = [];
      for (let i = 0; i < subjects.length; i++) {
        const a = valueAt(f, (i + this.rng()) / subjects.length);
        let b = valueAt(f, this.rng());
        if (b === a) b = valueAt(f, (positionOf(f, a) + 0.5) % 1);
        inputs.push({ ...this.personas.get(subjects[i])!, [f.key]: a }, { ...this.personas.get(subjects[i])!, [f.key]: b });
      }
      const obs = await this.query(
        inputs,
        "pair",
        exp.id,
        subjects.flatMap((id) => [id, id]),
      );
      for (let i = 0; i < obs.length; i += 2) pairs.push({ a: obs[i].id, b: obs[i + 1].id, changed: [f.key], delta: obs[i + 1].output - obs[i].output });
      this.patchExp(exp.id, { observationIds: obs.map((o) => o.id), pairs });
      set({ outputs: `${pairs.length} random pairs`, experimentIds: [exp.id] });
    });
    return this.task("statistician", `Audit null for ${f.label}`, `${pairs.length} random pairs`, async (set) => {
      await this.beat(0.4);
      const thr = this.outlierThreshold();
      const big = pairs.filter((p) => Math.abs(p.delta) > thr);
      const maxD = Math.max(...pairs.map((p) => Math.abs(p.delta)));
      this.patchExp(exp.id, {
        status: "done",
        completedAt: Date.now(),
        result: { summary: `${big.length} of ${pairs.length} pairs exceed the noise bound ±${this.out(thr)} (max |Δ| ${this.out(maxD)})`, n: pairs.length },
      });
      if (!big.length) {
        set({ outputs: `max |Δ| ${this.out(maxD)} < ${this.out(thr)}`, decision: "Null survives the randomized audit" });
        if (nullH) this.patchHyp(nullH.id, {}, "supported", `Randomized audit: no response beyond ±${this.out(thr)} in ${pairs.length} pairs`);
        return prior;
      }
      if (nullH) {
        this.link(nullH.id, exp.id, "conflicting");
        this.patchHyp(nullH.id, { confidence: 0.2 }, "rejected", `Randomized audit found ${big.length} response(s) beyond noise (max |Δ| ${this.out(maxD)})`);
      }
      this.link(prior.hypothesisId, exp.id, "supporting");
      this.patchHyp(prior.hypothesisId, { confidence: 0.4 }, "inconclusive", `Fixed screening levels showed nothing, but the audit found outsized responses — effect may be confined to a narrow range or conditional`);
      const owners = big.map((p) => this.obsById(p.a)!.personaId!).filter(Boolean);
      set({ outputs: `${big.length} outsized responses`, decision: `Null rejected — escalate ${f.label} to structure probing`, hypothesisIds: [prior.hypothesisId, ...(nullH ? [nullH.id] : [])] });
      return { ...prior, verdict: "unclear", audit: true, magnitude: maxD, strongestPersonas: owners };
    });
  }

  private settleNumeric(
    f: Feature,
    hId: string,
    expId: string,
    d: DiffStats,
    v: Verdict,
    rel: number | undefined,
    lo: number | undefined,
    hi: number | undefined,
    strongest: string[],
    set: (p: TaskPatch) => void,
  ): FeatureEffect {
    const spec = this.s.target;
    const outLabel = spec.output.label.toLowerCase();
    const test = { name: "sign-flip permutation", statistic: d.mean, p: d.p, n: d.n };
    if (v === "effect") {
      const dir = d.mean > 0 ? "raises" : "lowers";
      const statement =
        f.kind === "numeric"
          ? `Raising ${f.label} from ${fmtFeature(f, lo)} to ${fmtFeature(f, hi)} ${dir} ${outLabel} by ${this.delta(d.mean).replace(/^[+−]/, "")}${rel !== undefined ? ` (${fmtPct(rel)})` : ""}`
          : `${f.label} influences ${outLabel}`;
      this.patchHyp(
        hId,
        { statement, effect: { estimate: d.mean, ci: d.ci, rel, unit: spec.output.unit }, test, confidence: confidenceFrom(d.p, d.n, true) },
        "supported",
        `Paired Δ ${this.delta(d.mean)} [${this.delta(d.ci[0])}, ${this.delta(d.ci[1])}], ${fmtP(d.p)}`,
      );
      set({ outputs: `Δ ${this.delta(d.mean)}, ${fmtP(d.p)}`, decision: `Effect supported (${dir} output)`, hypothesisIds: [hId] });
      return { feature: f.key, verdict: "effect", magnitude: Math.abs(d.mean), lo, hi, strongestPersonas: strongest, hypothesisId: hId };
    }
    if (v === "null") {
      this.patchHyp(
        hId,
        { effect: { estimate: d.mean, ci: d.ci, unit: spec.output.unit }, test, confidence: confidenceFrom(d.p, d.n, false) },
        "rejected",
        `CI [${this.delta(d.ci[0])}, ${this.delta(d.ci[1])}] lies within ±${this.out(this.margin)}`,
      );
      const nh = this.propose("null", `No detectable effect of ${f.label} on ${outLabel} within the tested range and budget`, [f.key]);
      this.link(nh.id, expId, "supporting");
      this.patchHyp(
        nh.id,
        {
          effect: { estimate: d.mean, ci: d.ci, unit: spec.output.unit },
          test: { name: "equivalence (bootstrap CI within ±δ)", statistic: d.mean, p: d.p, n: d.n },
          confidence: clamp(0.6 + 0.4 * (1 - (d.ci[1] - d.ci[0]) / (2 * this.margin)), 0.5, 0.97),
        },
        "supported",
        `Equivalence: 95% CI inside ±${this.out(this.margin)}`,
      );
      this.relate(hId, nh.id, "competes");
      set({ outputs: `Δ ${this.delta(d.mean)}, CI within ±δ`, decision: "No detectable effect — null hypothesis supported", hypothesisIds: [hId, nh.id] });
      return { feature: f.key, verdict: "null", magnitude: 0, strongestPersonas: [], hypothesisId: hId };
    }
    this.patchHyp(hId, { effect: { estimate: d.mean, ci: d.ci, rel, unit: spec.output.unit }, test, confidence: 0.35 }, "inconclusive", `Evidence ambiguous after replication (${fmtP(d.p)})`);
    set({ outputs: `Δ ${this.delta(d.mean)}, ${fmtP(d.p)}`, decision: "Inconclusive after replication", hypothesisIds: [hId] });
    return { feature: f.key, verdict: "unclear", magnitude: Math.abs(d.mean), lo, hi, strongestPersonas: strongest, hypothesisId: hId };
  }

  // -------------------------------------------------------- phase: structure

  private async phaseStructure() {
    this.setPhase("structure");
    const spec = this.s.target;
    const candidates = [...this.effects.values()]
      .filter((e) => (e.verdict === "effect" || e.audit) && this.feature(e.feature).kind === "numeric")
      .sort((a, b) => b.magnitude - a.magnitude);
    const budget = Math.round(this.s.budget.limit * 0.24);
    const startUsed = this.s.budget.used;
    let i = 0;
    for (const eff of candidates) {
      const f = this.feature(eff.feature) as NumericFeature;
      const grid = this.sweepGrid(f);
      const cost = grid.length * 3 + 14 + 16;
      if (this.s.budget.used - startUsed + cost > budget || !this.canAfford(cost)) {
        this.log("experimenter", "warn", `Skipping structure probe for ${f.label} — phase budget reached`);
        continue;
      }
      await this.probeStructure(f, eff, grid);
      this.progress("structure", ++i / candidates.length);
    }
    this.progress("structure", 1);
    this.fitSurrogate("structure");
    void spec;
  }

  private sweepGrid(f: NumericFeature): number[] {
    const n = f.integer && f.max - f.min <= 24 ? f.max - f.min + 1 : 11;
    const pts = Array.from({ length: n }, (_, i) => valueAt(f, i / (n - 1)));
    return [...new Set(pts)];
  }

  private async probeStructure(f: NumericFeature, eff: FeatureEffect, grid: number[]) {
    const spec = this.s.target;
    const outLabel = spec.output.label.toLowerCase();
    const log = isLogScale(f);

    const hSmooth = this.propose("linear", `${f.label} acts smoothly (${log ? "logarithmic" : "proportional"} dose-response)`, [f.key]);
    const hStep = this.propose("threshold", `${f.label} acts through a threshold`, [f.key]);
    this.relate(hSmooth.id, hStep.id, "competes");
    this.relate(hSmooth.id, eff.hypothesisId, "related");
    this.relate(hStep.id, eff.hypothesisId, "related");

    const subjects = await this.task("persona", `Select sweep subjects for ${f.label}`, `screening responses`, async (set) => {
      await this.beat(0.4);
      const ids = [...new Set(eff.strongestPersonas)].slice(0, 3);
      const fill = this.pickPersonas(3 - ids.length, 1, ids);
      const all = [...ids, ...fill].slice(0, 3);
      set({ outputs: all.join(", "), decision: "Chose subjects with the strongest screening response" });
      return all;
    });

    const exp = this.newExp({
      kind: "sweep",
      title: `${f.label} · dose-response sweep`,
      design: `Sweep ${f.label} across ${grid.length} ${log ? "log-spaced " : ""}levels for ${subjects.length} subjects, all other fields held fixed.`,
      features: [f.key],
    });
    this.link(hSmooth.id, exp.id, "supporting");
    this.link(hStep.id, exp.id, "supporting");
    this.patchHyp(hSmooth.id, {}, "testing", `Sweep ${exp.id}`);
    this.patchHyp(hStep.id, {}, "testing", `Sweep ${exp.id}`);

    const series: SeriesPoint[] = [];
    await this.task("experimenter", `Execute ${exp.id} · ${f.label} sweep`, `${grid.length} levels × ${subjects.length} subjects`, async (set) => {
      this.patchExp(exp.id, { status: "running" });
      await this.beat(0.6);
      const inputs: Input[] = [];
      const owners: string[] = [];
      for (const id of subjects) for (const g of grid) {
        inputs.push({ ...this.personas.get(id)!, [f.key]: g });
        owners.push(id);
      }
      const obs = await this.query(inputs, "sweep", exp.id, owners);
      obs.forEach((o) => series.push({ x: Number(o.input[f.key]), y: o.output, persona: o.personaId!, obsId: o.id }));
      this.patchExp(exp.id, { observationIds: obs.map((o) => o.id), series });
      set({ outputs: `${obs.length} sweep responses`, experimentIds: [exp.id] });
    });
    this.handoff("experimenter", "statistician", `${series.length} sweep points for ${f.label}`, series.length);

    type Fit = { model: "smooth" | "step" | "window"; bic: number; split?: number; lo?: number; hi?: number; a?: number; b?: number; jump?: number; slopeL?: number; slopeR?: number; inside?: number };
    const analysis = await this.task("statistician", `Model-compare ${f.label} dose-response`, `${series.length} points`, async (set) => {
      await this.beat(0.7);
      // standardize each subject's curve; drop flat (non-responding) curves
      const xs: number[] = [];
      const ys: number[] = [];
      let kept = 0;
      for (const id of subjects) {
        const pts = series.filter((p) => p.persona === id);
        const yv = pts.map((p) => p.y);
        const s = sd(yv);
        if (Math.max(...yv) - Math.min(...yv) < Math.max(3 * this.noiseSd, this.margin * 0.5)) continue;
        kept++;
        const m = mean(yv);
        pts.forEach((p) => {
          xs.push(log ? positionOf(f, p.x) : p.x);
          ys.push((p.y - m) / (s || 1));
        });
      }
      if (kept === 0) {
        set({ decision: "No subject responded across the sweep — dependency is conditional", outputs: "0 responsive curves" });
        return null;
      }
      const n = xs.length;
      const lin = linearSSE(xs, ys);
      const step = stepSSE(xs, ys);
      const fits: Fit[] = [{ model: "smooth", bic: bic(lin.sse, n, 2 + kept) }];
      if (Number.isFinite(step.sse)) {
        const left = xs.map((x, i) => [x, ys[i]] as const).filter(([x]) => x <= step.split);
        const right = xs.map((x, i) => [x, ys[i]] as const).filter(([x]) => x > step.split);
        const lf = linearSSE(left.map((p) => p[0]), left.map((p) => p[1]));
        const rf = linearSSE(right.map((p) => p[0]), right.map((p) => p[1]));
        // A discontinuity shows up as one adjacent grid step far larger than the rest;
        // otherwise the piecewise fit describes a change of slope (kink).
        const grid = [...new Set(xs)].sort((a, b) => a - b);
        const curve = grid.map((g) => mean(ys.filter((_, k) => xs[k] === g)));
        const steps = curve.slice(1).map((c, i) => c - curve[i]);
        let ji = 0;
        steps.forEach((d, i) => {
          if (Math.abs(d) > Math.abs(steps[ji])) ji = i;
        });
        const medStep = median(steps.map(Math.abs));
        const isJump = Math.abs(steps[ji]) > 0.8 && Math.abs(steps[ji]) > 3 * medStep;
        fits.push({
          model: "step",
          bic: bic(step.sse, n, 5 + kept),
          split: isJump ? (grid[ji] + grid[ji + 1]) / 2 : step.split,
          lo: isJump ? grid[ji] : step.lo,
          hi: isJump ? grid[ji + 1] : step.hi,
          jump: isJump ? steps[ji] : 0,
          slopeL: lf.slope,
          slopeR: rf.slope,
        });
      }
      // window: elevated/depressed constant segment strictly inside the range
      const distinct = [...new Set(xs)].sort((a, b) => a - b);
      if (distinct.length >= 8) {
        let best: Fit | null = null;
        for (let i = 1; i < distinct.length - 1; i++) {
          for (let j = i; j < Math.min(distinct.length - 1, i + Math.ceil(distinct.length / 3)); j++) {
            const a = distinct[i];
            const b = distinct[j];
            const ins = ys.filter((_, k) => xs[k] >= a && xs[k] <= b);
            const outs = ys.filter((_, k) => xs[k] < a || xs[k] > b);
            const mi = mean(ins);
            const mo = mean(outs);
            const sse = ins.reduce((s, y) => s + (y - mi) ** 2, 0) + outs.reduce((s, y) => s + (y - mo) ** 2, 0);
            const bb = bic(sse, n, 4 + kept);
            if (!best || bb < best.bic) best = { model: "window", bic: bb, a, b, inside: mi - mo };
          }
        }
        if (best) fits.push(best);
      }
      fits.sort((p, q) => p.bic - q.bic);
      const winner = fits[0];
      const smoothBic = fits.find((x) => x.model === "smooth")!.bic;
      const chosen = winner.model !== "smooth" && smoothBic - winner.bic > 6 ? winner : fits.find((x) => x.model === "smooth")!;
      set({
        outputs: fits.map((x) => `${x.model} BIC ${x.bic.toFixed(1)}`).join(" · "),
        decision: `Best model: ${chosen.model}${chosen.model !== "smooth" ? ` (ΔBIC ${(smoothBic - chosen.bic).toFixed(1)} vs smooth)` : ""}`,
        hypothesisIds: [hSmooth.id, hStep.id],
      });
      return { chosen, smoothBic, fits };
    });

    const unlog = (v: number) => (log ? valueAt(f, v) : v);

    if (!analysis) {
      this.patchHyp(hSmooth.id, {}, "inconclusive", "Sweep subjects showed no response — conditional on other fields");
      this.patchHyp(hStep.id, {}, "inconclusive", "Sweep subjects showed no response — conditional on other fields");
      this.patchExp(exp.id, { status: "done", completedAt: Date.now(), result: { summary: "Flat response for all sweep subjects (conditional effect)" } });
      return;
    }

    const { chosen, smoothBic } = analysis;
    const dBic = smoothBic - chosen.bic;
    if (chosen.model === "smooth") {
      this.patchHyp(
        hSmooth.id,
        {
          statement: `${f.label} has a smooth, ${log ? "diminishing (logarithmic)" : "approximately proportional"} effect on ${outLabel}`,
          confidence: Math.max(0.75, this.hyps.get(eff.hypothesisId)?.confidence ?? 0.75),
          test: this.hyps.get(eff.hypothesisId)?.test ?? { name: "BIC model comparison", statistic: 0, p: 0.05, n: series.length },
          effect: this.hyps.get(eff.hypothesisId)?.effect,
        },
        "supported",
        "Smooth model preferred by BIC",
      );
      this.patchHyp(hStep.id, { confidence: 0.2 }, "rejected", "No discontinuity: threshold model not preferred by BIC");
      this.patchExp(exp.id, { status: "done", completedAt: Date.now(), result: { summary: `Smooth dose-response preferred (BIC)`, n: series.length } });
      return;
    }

    if (chosen.model === "window") {
      const a = unlog(chosen.a!);
      const b = unlog(chosen.b!);
      const dir = (chosen.inside ?? 0) > 0 ? "higher" : "lower";
      this.patchHyp(
        hStep.id,
        {
          statement: `${outLabel[0].toUpperCase() + outLabel.slice(1)} is ${dir} when ${f.label} is within ${fmtFeature(f, a)}–${fmtFeature(f, b)}`,
          threshold: { value: a, lo: a, hi: b, direction: "window", end: b } as Hypothesis["threshold"],
          confidence: clamp(0.6 + dBic / 80, 0.6, 0.95),
          test: { name: "BIC model comparison", statistic: dBic, p: Math.exp(-dBic / 2), n: series.length },
        },
        "testing",
        `Window model preferred (ΔBIC ${dBic.toFixed(1)})`,
      );
      this.patchHyp(hSmooth.id, { confidence: 0.15 }, "rejected", `Window model fits better (ΔBIC ${dBic.toFixed(1)})`);
      this.patchExp(exp.id, { status: "done", completedAt: Date.now(), result: { summary: `Window ${fmtFeature(f, a)}–${fmtFeature(f, b)} (ΔBIC ${dBic.toFixed(1)})`, n: series.length } });
      const inside = f.integer ? Math.round((a + b) / 2) : (a + b) / 2;
      const outside = f.integer ? Math.max(f.min, Math.round(a) - 2) : Math.max(f.min, a - (b - a));
      await this.confirm(f, hStep.id, outside, inside, `inside vs outside the window`);
      this.thresholds.set(f.key, { lo: outside, hi: inside });
      return;
    }

    // step or kink
    const isJump = (chosen.jump ?? 0) !== 0;
    let lo = unlog(chosen.lo!);
    let hi = unlog(chosen.hi!);
    this.patchExp(exp.id, {
      status: "done",
      completedAt: Date.now(),
      result: { summary: `${isJump ? "Discontinuity" : "Slope change"} between ${fmtFeature(f, lo)} and ${fmtFeature(f, hi)} (ΔBIC ${dBic.toFixed(1)})`, n: series.length },
    });
    this.patchHyp(hSmooth.id, { confidence: 0.15 }, "rejected", `Piecewise model fits better (ΔBIC ${dBic.toFixed(1)})`);

    if (isJump) {
      // bisection on the subjects with the largest jump in the bracketing interval
      const toX = (raw: number) => (log ? positionOf(f, raw) : raw);
      const at = (id: string, x: number) => series.find((p) => p.persona === id && Math.abs(toX(p.x) - x) < 1e-9);
      const jumpOf = (id: string) => {
        const a = at(id, chosen.lo!);
        const b = at(id, chosen.hi!);
        return a && b ? { id, ya: a.y, yb: b.y, gap: Math.abs(b.y - a.y) } : null;
      };
      const ranked = subjects.map(jumpOf).filter((x): x is NonNullable<typeof x> => !!x && x.gap > 3 * this.noiseSd).sort((p, q) => q.gap - p.gap).slice(0, 2);
      if (ranked.length) {
        const bis = this.newExp({
          kind: "bisection",
          title: `${f.label} · threshold bisection`,
          design: `Bisect the interval ${fmtFeature(f, lo)}–${fmtFeature(f, hi)} on ${ranked.length} subject(s) to localize the discontinuity.`,
          features: [f.key],
        });
        this.link(hStep.id, bis.id, "supporting");
        await this.task("experimenter", `Execute ${bis.id} · bisect ${f.label}`, `interval ${fmtFeature(f, lo)}–${fmtFeature(f, hi)}`, async (set) => {
          this.patchExp(bis.id, { status: "running" });
          const states = ranked.map((r) => ({ ...r, lo, hi }));
          const obsIds: number[] = [];
          const bseries: SeriesPoint[] = [];
          const tol = f.integer ? 1 : (f.max - f.min) * 0.004;
          for (let it = 0; it < 8; it++) {
            const active = states.filter((s) => s.hi - s.lo > tol);
            if (!active.length) break;
            await this.beat(0.35);
            const mids = active.map((s) => (f.integer ? Math.floor((s.lo + s.hi) / 2) : Math.round(((s.lo + s.hi) / 2) * 1e4) / 1e4));
            const obs = await this.query(
              active.map((s, j) => ({ ...this.personas.get(s.id)!, [f.key]: mids[j] })),
              "bisect",
              bis.id,
              active.map((s) => s.id),
            );
            obs.forEach((o, j) => {
              const st = active[j];
              obsIds.push(o.id);
              bseries.push({ x: mids[j], y: o.output, persona: st.id, obsId: o.id });
              if (Math.abs(o.output - st.ya) < Math.abs(o.output - st.yb)) st.lo = mids[j];
              else st.hi = mids[j];
            });
            this.patchExp(bis.id, { observationIds: [...obsIds], series: [...bseries] });
          }
          lo = Math.min(...states.map((s) => s.lo));
          hi = Math.max(...states.map((s) => s.hi));
          this.patchExp(bis.id, { status: "done", completedAt: Date.now(), result: { summary: `Threshold localized to ${fmtFeature(f, lo)}–${fmtFeature(f, hi)}`, n: obsIds.length } });
          set({ outputs: `interval ${fmtFeature(f, lo)}–${fmtFeature(f, hi)}`, decision: `Threshold ≈ ${fmtFeature(f, (lo + hi) / 2)}`, experimentIds: [bis.id] });
        });
      }
    }

    const jumpDir = (chosen.jump ? chosen.jump : (chosen.slopeR ?? 0) - (chosen.slopeL ?? 0)) > 0 ? "up" : "down";
    const t = f.integer ? hi : (lo + hi) / 2;
    const statement = isJump
      ? `${outLabel[0].toUpperCase() + outLabel.slice(1)} ${jumpDir === "up" ? "jumps up" : "drops sharply"} once ${f.label} ${f.integer ? "reaches" : "exceeds"} ${fmtFeature(f, t)}`
      : Math.abs(chosen.slopeR ?? 0) < Math.abs(chosen.slopeL ?? 1) * 0.25
        ? `The effect of ${f.label} saturates above ~${fmtFeature(f, t)}`
        : `The slope of ${f.label}'s effect changes near ${fmtFeature(f, t)}`;
    this.patchHyp(
      hStep.id,
      {
        statement,
        threshold: { value: t, lo, hi, direction: jumpDir },
        confidence: clamp(0.6 + dBic / 80, 0.6, 0.95),
        test: { name: "BIC model comparison", statistic: dBic, p: Math.exp(-dBic / 2), n: series.length },
      },
      "testing",
      `Piecewise model preferred (ΔBIC ${dBic.toFixed(1)})`,
    );
    if (isJump) {
      this.thresholds.set(f.key, { lo, hi });
      const delta = f.integer ? 0 : Math.max((f.max - f.min) * 0.02, hi - lo);
      await this.confirm(f, hStep.id, f.integer ? lo : Math.max(f.min, lo - delta), f.integer ? hi : Math.min(f.max, hi + delta), `either side of ${fmtFeature(f, t)}`);
    } else {
      this.patchHyp(hStep.id, {}, "supported", `Kink supported by sweep (ΔBIC ${dBic.toFixed(1)})`);
    }
  }

  private async confirm(f: NumericFeature, hId: string, a: number, b: number, what: string) {
    const k = 10;
    if (!this.canAfford(2 * k)) {
      this.patchHyp(hId, {}, "inconclusive", "Confirmation skipped — budget");
      return;
    }
    const subjects = this.pickPersonas(k, 0.9);
    const exp = this.newExp({
      kind: "confirmation",
      title: `${f.label} · confirmatory test`,
      design: `Fresh subjects queried at ${fmtFeature(f, a)} vs ${fmtFeature(f, b)} (${what}) — a pre-registered test of the localized effect.`,
      features: [f.key],
    });
    this.link(hId, exp.id, "supporting");
    const pairs: PairRecord[] = [];
    await this.task("experimenter", `Execute ${exp.id} · confirm ${f.label}`, `${k} fresh subjects`, async (set) => {
      this.patchExp(exp.id, { status: "running" });
      await this.beat(0.5);
      const inputs = subjects.flatMap((id) => [
        { ...this.personas.get(id)!, [f.key]: a },
        { ...this.personas.get(id)!, [f.key]: b },
      ]);
      const obs = await this.query(
        inputs,
        "confirm",
        exp.id,
        subjects.flatMap((id) => [id, id]),
      );
      for (let i = 0; i < obs.length; i += 2) pairs.push({ a: obs[i].id, b: obs[i + 1].id, changed: [f.key], delta: obs[i + 1].output - obs[i].output });
      this.patchExp(exp.id, { observationIds: obs.map((o) => o.id), pairs });
      set({ outputs: `${pairs.length} pairs`, experimentIds: [exp.id] });
    });
    await this.task("statistician", `Evaluate confirmation for ${hId}`, `${pairs.length} pairs`, async (set) => {
      await this.beat(0.5);
      const d = this.diffStats(pairs.map((p) => p.delta));
      const ok = d.p < 0.02 && Math.abs(d.mean) >= this.margin * 0.5 && (d.ci[0] > 0 || d.ci[1] < 0);
      // an effect present in only some subjects (conditional on other fields) shows as
      // several outsized same-sign responses among otherwise null pairs
      const big = pairs.filter((p) => Math.abs(p.delta) > this.outlierThreshold());
      const conditional = !ok && big.length >= 3 && (big.every((p) => p.delta > 0) || big.every((p) => p.delta < 0));
      const rs = pairs.map((p) => [this.obsById(p.a)!.output, this.obsById(p.b)!.output]).filter(([x]) => x > 0).map(([x, y]) => (y - x) / x);
      const rel = rs.length ? median(rs) : undefined;
      this.patchExp(exp.id, {
        status: "done",
        completedAt: Date.now(),
        result: { summary: `Δ ${this.delta(d.mean)} [${this.delta(d.ci[0])}, ${this.delta(d.ci[1])}] · ${fmtP(d.p)}`, effect: d.mean, relEffect: rel, ci: d.ci, p: d.p, n: d.n },
      });
      const h = this.hyps.get(hId)!;
      if (ok) {
        this.patchHyp(
          hId,
          {
            effect: { estimate: d.mean, ci: d.ci, rel, unit: this.s.target.output.unit },
            test: { name: "confirmatory sign-flip test", statistic: d.mean, p: d.p, n: d.n },
            confidence: Math.max(h.confidence, confidenceFrom(d.p, d.n, true)),
          },
          "supported",
          `Confirmed on fresh subjects: Δ ${this.delta(d.mean)}, ${fmtP(d.p)}`,
        );
      } else if (conditional) {
        const bd = this.diffStats(big.map((p) => p.delta));
        this.patchHyp(
          hId,
          {
            statement: `${h.statement} (for ${big.length} of ${pairs.length} subjects — conditional on other fields)`,
            effect: { estimate: bd.mean, ci: bd.ci, unit: this.s.target.output.unit },
            test: { name: "confirmatory test · responders only", statistic: bd.mean, p: d.p, n: big.length },
            confidence: 0.68,
          },
          "supported",
          `Confirmed in ${big.length}/${pairs.length} fresh subjects (all ${big[0].delta > 0 ? "positive" : "negative"}); others unaffected`,
        );
      } else {
        this.link(hId, exp.id, "conflicting");
        const ev = this.hyps.get(hId)!.evidence;
        this.patchHyp(hId, { evidence: { supporting: ev.supporting.filter((x) => x !== exp.id), conflicting: ev.conflicting }, confidence: 0.25 }, "rejected", `Failed confirmation: Δ ${this.delta(d.mean)}, ${fmtP(d.p)}`);
      }
      set({ outputs: `Δ ${this.delta(d.mean)}, ${fmtP(d.p)}`, decision: ok ? "Confirmed" : conditional ? `Confirmed for ${big.length} responders (conditional)` : "Not confirmed", hypothesisIds: [hId] });
      // a confirmed structure also settles the parent effect hypothesis
      const parent = this.hyps.get(hId)!.related.map((r) => this.hyps.get(r)).find((x) => x?.kind === "effect" && x.status === "inconclusive");
      if (parent && (ok || conditional)) this.patchHyp(parent.id, { confidence: 0.75 }, "supported", `Effect localized by ${hId}`);
    });
  }

  // ----------------------------------------------------- phase: interactions

  private armsFor(key: string): [Input[string], Input[string]] {
    const f = this.feature(key);
    if (f.kind === "categorical") {
      const eff = this.effects.get(key);
      return [f.levels[0], eff?.bestLevel ?? f.levels[1]];
    }
    const th = this.thresholds.get(key);
    if (th) {
      const d = f.integer ? 0 : (f.max - f.min) * 0.03;
      return [Math.max(f.min, f.integer ? th.lo : th.lo - d), Math.min(f.max, f.integer ? th.hi : th.hi + d)];
    }
    return this.interactionLevels(f);
  }

  private async phaseInteractions() {
    this.setPhase("interactions");
    const spec = this.s.target;
    const outLabel = spec.output.label.toLowerCase();
    const k = 8;
    const ranked = [...this.effects.values()].filter((e) => e.verdict === "effect").sort((a, b) => b.magnitude - a.magnitude).slice(0, 5);
    const pairs: [FeatureEffect, FeatureEffect][] = [];
    for (let i = 0; i < ranked.length; i++) for (let j = i + 1; j < ranked.length; j++) pairs.push([ranked[i], ranked[j]]);
    pairs.sort((p, q) => q[0].magnitude * q[1].magnitude - p[0].magnitude * p[1].magnitude);
    const maxPairs = Math.max(0, Math.min(pairs.length, Math.floor((this.s.budget.limit * 0.17) / (4 * k))));
    const plan = pairs.slice(0, maxPairs);
    if (!plan.length) {
      this.log("statistician", "warn", "Fewer than two influential fields — no interactions to test");
      this.progress("interactions", 1);
      return;
    }

    const hyps = await this.task("statistician", "Propose interaction hypotheses", `${ranked.length} influential fields`, async (set) => {
      await this.beat();
      const hs = plan.map(([a, b]) =>
        this.propose("interaction", `The effect of ${labelOf(spec, b.feature)} depends on ${labelOf(spec, a.feature)}`, [a.feature, b.feature]),
      );
      set({ outputs: `${hs.length} pairwise hypotheses`, decision: `Prioritized by product of main-effect magnitudes`, hypothesisIds: hs.map((h) => h.id) });
      for (const [i, h] of hs.entries()) {
        this.relate(h.id, plan[i][0].hypothesisId, "related");
        this.relate(h.id, plan[i][1].hypothesisId, "related");
      }
      return hs;
    });
    this.handoff("statistician", "experimenter", `${hyps.length} interaction designs (2×2 factorial)`, hyps.length);

    for (const [i, [A, B]] of plan.entries()) {
      if (!this.canAfford(4 * k)) break;
      const h = hyps[i];
      const fa = this.feature(A.feature);
      const fb = this.feature(B.feature);
      const [a0, a1] = this.armsFor(A.feature);
      const [b0, b1] = this.armsFor(B.feature);
      const subjects = this.pickPersonas(k, 0.8);
      const exp = this.newExp({
        kind: "factorial",
        title: `${fa.label} × ${fb.label} · 2×2 factorial`,
        design: `${fa.label} ∈ {${fmtFeature(fa, a0)}, ${fmtFeature(fa, a1)}} × ${fb.label} ∈ {${fmtFeature(fb, b0)}, ${fmtFeature(fb, b1)}} on ${k} subjects; difference-in-differences.`,
        features: [A.feature, B.feature],
      });
      this.link(h.id, exp.id, "supporting");
      this.patchHyp(h.id, {}, "testing", `Factorial ${exp.id}`);
      let rows: { persona: string; y: number[]; obs: number[] }[] = [];
      await this.task("experimenter", `Execute ${exp.id} · ${fa.label} × ${fb.label}`, `${k} subjects × 4 cells`, async (set) => {
        this.patchExp(exp.id, { status: "running" });
        await this.beat(0.5);
        const inputs: Input[] = [];
        const owners: string[] = [];
        for (const id of subjects) {
          const p = this.personas.get(id)!;
          for (const [va, vb] of [[a0, b0], [a0, b1], [a1, b0], [a1, b1]] as const) {
            inputs.push({ ...p, [A.feature]: va, [B.feature]: vb });
            owners.push(id);
          }
        }
        const obs = await this.query(inputs, "factorial", exp.id, owners);
        rows = subjects.map((id, s) => ({ persona: id, y: obs.slice(s * 4, s * 4 + 4).map((o) => o.output), obs: obs.slice(s * 4, s * 4 + 4).map((o) => o.id) }));
        const cells: FactorialCell[] = [
          [a0, b0, 0],
          [a0, b1, 1],
          [a1, b0, 2],
          [a1, b1, 3],
        ].map(([va, vb, c]) => ({ a: String(va), b: String(vb), mean: mean(rows.map((r) => r.y[c as number])), n: rows.length }));
        const pairsRec: PairRecord[] = rows.flatMap((r) => [
          { a: r.obs[0], b: r.obs[1], changed: [B.feature], delta: r.y[1] - r.y[0] },
          { a: r.obs[2], b: r.obs[3], changed: [B.feature], delta: r.y[3] - r.y[2] },
        ]);
        this.patchExp(exp.id, { observationIds: obs.map((o) => o.id), cells, pairs: pairsRec });
        set({ outputs: `${obs.length} cell responses`, experimentIds: [exp.id] });
      });

      await this.task("statistician", `Evaluate ${h.id} · difference-in-differences`, `${rows.length} subjects`, async (set) => {
        await this.beat(0.6);
        const did = rows.map((r) => r.y[3] - r.y[2] - (r.y[1] - r.y[0]));
        const d = this.diffStats(did);
        const allPos = rows.every((r) => r.y.every((y) => y > 0));
        // multiplicative check on the subjects whose four cells are all positive
        const posRows = rows.filter((r) => r.y.every((y) => y > 0));
        const logD = posRows.length >= 6 ? this.diffStats(posRows.map((r) => Math.log(r.y[3]) - Math.log(r.y[2]) - (Math.log(r.y[1]) - Math.log(r.y[0])))) : null;
        const effB0 = mean(rows.map((r) => r.y[1] - r.y[0]));
        const effB1 = mean(rows.map((r) => r.y[3] - r.y[2]));
        const gatedCell = [0, 1, 2, 3].find((c) => rows.filter((r) => !this.isResponsive(r.y[c])).length / rows.length >= 0.8);
        const rawSig = d.p < 0.02 && Math.abs(d.mean) >= this.margin && (d.ci[0] > 0 || d.ci[1] < 0);
        const logSig = logD ? logD.p < 0.02 && Math.abs(logD.mean) > 0.04 && (logD.ci[0] > 0 || logD.ci[1] < 0) : true;
        const gate = this.floorShare >= 0.03 && gatedCell !== undefined;
        // A gate that zeroes the output at every level of the other field scales its
        // absolute effect without changing its relative effect: not a conditional rule.
        const relRows = rows.filter((r) => r.y[0] > 0 && r.y[2] > 0);
        let proportionalGate = false;
        if (gate && !allPos && relRows.length >= 6) {
          const relD = this.diffStats(relRows.map((r) => (r.y[3] - r.y[2]) / r.y[2] - (r.y[1] - r.y[0]) / r.y[0]));
          proportionalGate = !(relD.p < 0.02 && Math.abs(relD.mean) > 0.05);
        }
        const prev = this.exps.get(exp.id)!;
        this.patchExp(exp.id, {
          status: "done",
          completedAt: Date.now(),
          result: {
            summary: `DiD ${this.delta(d.mean)} [${this.delta(d.ci[0])}, ${this.delta(d.ci[1])}] · ${fmtP(d.p)}${logD ? ` · log-scale ${fmtP(logD.p)}` : ""}`,
            effect: d.mean,
            ci: d.ci,
            p: d.p,
            n: d.n,
          },
          cells: prev.cells,
        });
        const test = { name: "difference-in-differences (sign-flip)", statistic: d.mean, p: d.p, n: d.n };
        const aLabel = (v: Input[string]) => `${fa.label} = ${fmtFeature(fa, v)}`;
        if (rawSig && ((gate && !proportionalGate) || (!gate && logSig))) {
          let statement: string;
          if (gate && Math.abs(effB1) < this.margin && Math.abs(effB0) >= this.margin) {
            statement = `${aLabel(a1)} overrides ${fb.label}: its effect vanishes (${this.delta(effB0)} → ${this.delta(effB1)})`;
          } else if (gate && Math.abs(effB0) < this.margin && Math.abs(effB1) >= this.margin) {
            statement = `${fb.label} only matters when ${aLabel(a1)} (${this.delta(effB0)} → ${this.delta(effB1)})`;
          } else {
            statement = `The ${fb.label} effect shifts from ${this.delta(effB0)} at ${aLabel(a0)} to ${this.delta(effB1)} at ${aLabel(a1)}`;
          }
          this.patchHyp(h.id, { statement, effect: { estimate: d.mean, ci: d.ci, unit: spec.output.unit }, test, confidence: confidenceFrom(d.p, d.n, true) }, "supported", `DiD ${this.delta(d.mean)}, ${fmtP(d.p)}`);
          set({ outputs: `DiD ${this.delta(d.mean)}, ${fmtP(d.p)}`, decision: gate ? "Gating interaction supported" : "Conditional dependency supported", hypothesisIds: [h.id] });
        } else if (rawSig) {
          const why = logD ? `vanishes on log scale (${fmtP(logD.p)})` : "relative effect unchanged across arms";
          this.patchHyp(
            h.id,
            { statement: `${fa.label} and ${fb.label} compose proportionally (no conditional rule)`, effect: { estimate: d.mean, ci: d.ci, unit: spec.output.unit }, test, confidence: 0.3 },
            "rejected",
            `Raw DiD significant but ${why} — multiplicative composition`,
          );
          set({ outputs: `raw ${fmtP(d.p)}${logD ? `, log ${fmtP(logD.p)}` : ""}`, decision: "Explained by proportional scaling", hypothesisIds: [h.id] });
        } else {
          this.patchHyp(h.id, { effect: { estimate: d.mean, ci: d.ci, unit: spec.output.unit }, test, confidence: 0.2 }, "rejected", `No interaction detected (${fmtP(d.p)})`);
          set({ outputs: `DiD ${this.delta(d.mean)}, ${fmtP(d.p)}`, decision: "No interaction", hypothesisIds: [h.id] });
        }
      });
      void outLabel;
      this.progress("interactions", (i + 1) / plan.length);
    }
    this.progress("interactions", 1);
    this.fitSurrogate("interactions");
  }

  // ---------------------------------------------------------- phase: active

  private trainingRows() {
    // analyst probes and verifications are excluded too: the engine learns only from its own designs
    return this.s.observations
      .filter((o) => o.source !== "holdout" && o.source !== "validation" && o.source !== "manual" && o.source !== "verify")
      .map((o) => ({ x: o.input, y: o.output }));
  }

  private async phaseActive() {
    this.setPhase("active");
    const spec = this.s.target;
    const batch = 16;
    const maxRounds = 14;
    const initialRemaining = this.remaining();
    let round = 0;
    while (this.remaining() >= batch && round < maxRounds) {
      round++;
      const rows = this.trainingRows();
      const sel = await this.task("statistician", `Active learning round ${round} · score candidates`, `${rows.length} training observations`, async (set) => {
        await this.beat(0.5);
        const ens = fitEnsemble(rows, spec.features, this.rng, 12);
        const pool = Array.from({ length: 400 }, () => randomInput(spec, this.rng));
        const scored = pool.map((x) => ({ x, ...predictEnsemble(ens, x) }));
        // greedy batch selection: uncertainty × diversity
        const chosen: number[] = [];
        const score = scored.map((c) => c.sd);
        for (let b = 0; b < batch; b++) {
          let bi = -1;
          let bv = -Infinity;
          for (let i = 0; i < scored.length; i++) {
            if (chosen.includes(i)) continue;
            let v = score[i];
            for (const c of chosen) v *= Math.min(1, distance(spec, scored[i].x, scored[c].x) / 0.18);
            if (v > bv) {
              bv = v;
              bi = i;
            }
          }
          chosen.push(bi);
        }
        // monitoring only: the validation error is displayed, never used to steer selection or stopping
        const holdPred = this.validation.map((o) => predictEnsemble(ens, o.input).mean);
        const holdRmse = rmse(this.validation.map((o) => o.output), holdPred);
        // project onto the two most important numeric fields for visualization
        const tree = fitTree(rows, spec.features, { maxDepth: 6, minLeaf: 4 });
        const imp = importance(tree, spec.features);
        const nums = spec.features.filter((f) => f.kind === "numeric").sort((a, b) => (imp[b.key] ?? 0) - (imp[a.key] ?? 0));
        const axes: [string, string] = [nums[0]?.key ?? spec.features[0].key, nums[1]?.key ?? spec.features[1].key];
        const fu = this.feature(axes[0]);
        const fv = this.feature(axes[1]);
        const sample = scored.map((c, i) => ({ c, i })).filter(({ i }) => chosen.includes(i) || i % 2 === 0);
        const sds = scored.map((c) => c.sd);
        this.pendingRound = {
          round,
          axes,
          candidates: sample.map(({ c, i }) => ({ u: positionOf(fu, c.x[axes[0]]), v: positionOf(fv, c.x[axes[1]]), mean: c.mean, sd: c.sd, selected: chosen.includes(i) })),
          explored: rows.slice(-500).map((r) => ({ u: positionOf(fu, r.x[axes[0]]), v: positionOf(fv, r.x[axes[1]]), output: r.y })),
          selectedObsIds: [],
          probes: chosen.map((i) => ({ u: positionOf(fu, scored[i].x[axes[0]]), v: positionOf(fv, scored[i].x[axes[1]]), mean: scored[i].mean, sd: scored[i].sd, selected: true })),
          meanSd: mean(sds),
          maxSd: Math.max(...sds),
          holdoutRmse: holdRmse,
          queriesSoFar: this.s.budget.used,
          at: Date.now(),
        };
        set({
          outputs: `mean σ ${this.out(mean(sds))} · max σ ${this.out(Math.max(...sds))} · validation RMSE ${this.out(holdRmse)}`,
          decision: `Selected ${batch} of 400 candidates by ensemble disagreement × diversity`,
        });
        return chosen.map((i) => scored[i].x);
      });
      this.handoff("statistician", "experimenter", `${sel.length} high-uncertainty probes`, sel.length);
      const exp = this.newExp({
        kind: "active",
        title: `Active learning · round ${round}`,
        design: `${sel.length} probes chosen where a 12-tree bootstrap ensemble disagrees most, spread for diversity.`,
        features: spec.features.map((f) => f.key),
      });
      await this.task("experimenter", `Execute ${exp.id} · uncertainty probes`, `${sel.length} probes`, async (set) => {
        this.patchExp(exp.id, { status: "running" });
        await this.beat(0.4);
        const obs = await this.query(sel, "active", exp.id);
        const ys = obs.map((o) => o.output);
        this.patchExp(exp.id, {
          status: "done",
          completedAt: Date.now(),
          observationIds: obs.map((o) => o.id),
          result: { summary: `${obs.length} probes · responses ${this.out(Math.min(...ys))}–${this.out(Math.max(...ys))}`, n: obs.length },
        });
        if (this.pendingRound) this.emit({ type: "alRound", round: { ...this.pendingRound, selectedObsIds: obs.map((o) => o.id) } });
        this.pendingRound = null;
        set({ outputs: `${obs.length} responses`, experimentIds: [exp.id] });
      });
      this.progress("active", initialRemaining > 0 ? 1 - this.remaining() / initialRemaining : 1);
      this.fitSurrogate("active");
    }
    this.progress("active", 1);
  }

  private pendingRound: InvestigationState["alRounds"][number] | null = null;
  private partialReason = "";

  // ------------------------------------------------------------- surrogate

  private fitSurrogate(stage: string): SurrogateModel | null {
    const rows = this.trainingRows();
    const final = stage === "final";
    const evalSet = final ? this.holdout : this.validation;
    if (rows.length < 12 || !evalSet.length) return null;
    const spec = this.s.target;
    const tree = fitTree(rows, spec.features, { maxDepth: 6, minLeaf: 4, minGain: 0.0015 });
    const actual = evalSet.map((o) => o.output);
    const pred = evalSet.map((o) => predict(tree, o.input));
    const st = treeStats(tree);
    const model: SurrogateModel = {
      version: ++this.surrogateVersion,
      tree,
      fidelity: { r2: r2(actual, pred), mae: mae(actual, pred), rmse: rmse(actual, pred), n: actual.length },
      importance: importance(tree, spec.features),
      residuals: evalSet.map((o, i) => ({ obsId: o.id, actual: actual[i], predicted: pred[i] })),
      trainedOn: rows.length,
      evaluatedOn: final ? "test" : "validation",
      leaves: st.leaves,
      depth: st.depth,
      at: Date.now(),
    };
    this.emit({ type: "surrogate", model });
    this.log("statistician", "info", `Surrogate v${model.version} (${stage}) · ${st.leaves} leaves · ${final ? "sealed test" : "validation"} R² ${model.fidelity.r2.toFixed(3)}`);
    return model;
  }

  // ------------------------------------------------------------- synthesis

  private async phaseSynthesis(partial = false) {
    this.setPhase("synthesis");
    const model = await this.task("statistician", "Fit final surrogate model", `${this.trainingRows().length} observations`, async (set) => {
      await this.beat();
      const m = this.fitSurrogate("final");
      set({
        outputs: m ? `${m.leaves} leaves, depth ${m.depth}` : "insufficient data",
        decision: m ? `Sealed test R² ${m.fidelity.r2.toFixed(3)} · MAE ${this.out(m.fidelity.mae)} (scored once)` : "No surrogate",
      });
      return m;
    });
    this.progress("synthesis", 0.4);
    this.handoff("statistician", "reporter", `${[...this.hyps.values()].filter((h) => h.status === "supported").length} supported hypotheses + surrogate`);
    await this.task("reporter", "Compile the Hidden Rulebook", `${this.hyps.size} hypotheses · ${this.exps.size} experiments`, async (set) => {
      await this.beat(1.2);
      const report = this.buildReport(model, partial);
      this.emit({ type: "report", report });
      set({ outputs: `${report.rules.length} rules · ${report.caveats.length} caveats`, decision: "Rulebook published", hypothesisIds: report.rules.flatMap((r) => r.hypothesisIds) });
    });
    this.progress("synthesis", 1);
  }

  private buildReport(model: SurrogateModel | null, partial: boolean): Report {
    const spec = this.s.target;
    const hs = [...this.hyps.values()];
    const supported = hs.filter((h) => h.status === "supported");
    const order: Record<string, number> = { threshold: 0, interaction: 1, level: 2, effect: 3, linear: 4, null: 5 };
    // effect hypotheses already expressed by a more specific supported rule are folded into it
    const covered = new Set<string>();
    for (const h of supported) {
      if (h.kind === "threshold" || h.kind === "level" || h.kind === "linear") {
        for (const r of h.related) if (this.hyps.get(r)?.kind === "effect") covered.add(r);
      }
    }
    const ruleHyps = supported
      .filter((h) => !(h.kind === "effect" && covered.has(h.id)))
      .filter((h) => !(h.kind === "effect" && this.feature(h.features[0]).kind === "categorical"))
      .sort((a, b) => order[a.kind] - order[b.kind] || b.confidence - a.confidence);

    const rules: Rule[] = ruleHyps.map((h, i) => {
      const f = this.feature(h.features[0]);
      const p = h.test?.p ?? 1;
      const strength: Rule["strength"] = h.kind === "null" ? (h.confidence > 0.8 ? "strong" : "moderate") : p < 0.01 && h.confidence > 0.85 ? "strong" : p < 0.02 ? "moderate" : "weak";
      const relatedEffect = h.related.map((r) => this.hyps.get(r)).find((x) => x?.kind === "effect");
      const expIds = [...new Set([...h.evidence.supporting, ...(relatedEffect?.evidence.supporting ?? [])])];
      const support = expIds.reduce((s, id) => s + (this.exps.get(id)?.observationIds.length ?? 0), 0);
      const alternatives = h.competes.filter((c) => this.hyps.get(c)?.status === "rejected");
      const confirmed = expIds.some((id) => this.exps.get(id)?.kind === "confirmation");
      const testSrc = h.test ?? relatedEffect?.test;
      let conditions: string[] = [];
      let title = "";
      let effect = "";
      const est = h.effect?.estimate;
      const rel = h.effect?.rel;
      const effStr = est !== undefined ? `${this.delta(est)}${rel !== undefined ? ` (${fmtPct(rel)})` : ""}` : "";
      switch (h.kind) {
        case "threshold": {
          const th = h.threshold!;
          if (th.direction === "window") {
            conditions = [`${f.key} ∈ [${fmtFeature(f, th.lo)}, ${fmtFeature(f, th.end ?? th.hi)}]`];
            title = `${f.label} window`;
          } else {
            conditions = [`${f.key} ${(f as NumericFeature).integer ? "≥" : ">"} ${fmtFeature(f, th.value)}`];
            title = `${f.label} threshold`;
          }
          effect = effStr || "change in slope";
          break;
        }
        case "level":
          conditions = [`${f.key} = ${h.level}`];
          title = `${f.label}: ${h.level?.replace(/_/g, " ")}`;
          effect = effStr;
          break;
        case "interaction":
          conditions = h.features.map((k) => `${k}`);
          title = `${labelOf(spec, h.features[0])} × ${labelOf(spec, h.features[1])}`;
          effect = est !== undefined ? `DiD ${this.delta(est)}` : "";
          break;
        case "null":
          conditions = [`any ${f.key}`];
          title = `${f.label} is ignored`;
          effect = "no detectable effect";
          break;
        case "linear":
          conditions = [`${f.key} ↑`];
          title = `${f.label} dose-response`;
          effect = relatedEffect?.effect ? `${this.delta(relatedEffect.effect.estimate)} across 20th→80th pct.` : "smooth";
          break;
        default:
          conditions = [`${f.key} ↑`];
          title = `${f.label} effect`;
          effect = effStr;
      }
      const ciSrc = h.effect ?? relatedEffect?.effect;
      return {
        id: `R-${pad(i + 1, 2)}`,
        index: i + 1,
        kind: h.kind,
        title,
        statement: h.statement,
        features: h.features,
        conditions,
        effect,
        confidence: h.confidence,
        strength,
        ci: ciSrc?.ci,
        estimate: ciSrc?.estimate,
        unit: spec.output.unit,
        support,
        hypothesisIds: [h.id, ...(relatedEffect ? [relatedEffect.id] : [])],
        experimentIds: expIds,
        alternatives,
        confirmed,
        test: testSrc ? { name: testSrc.name, p: testSrc.p, n: testSrc.n, statistic: testSrc.statistic } : undefined,
      };
    });

    const nulls = rules.filter((r) => r.kind === "null").length;
    const rejected = hs.filter((h) => h.status === "rejected").length;
    const inconclusive = hs.filter((h) => h.status === "inconclusive").length;
    const fid = model?.fidelity;
    const external = spec.origin === "external";
    const confirmedN = rules.filter((r) => r.kind !== "null" && r.confirmed).length;
    const summary =
      `AUTOPSY evaluated ${this.s.budget.used} inputs on ${spec.name}${spec.version ? ` ${spec.version}` : ""} (${external ? "external API" : "built-in synthetic target"}) across ${this.exps.size} experiments. ` +
      `${rules.length - nulls} behavioral pattern${rules.length - nulls === 1 ? " is" : "s are"} supported by controlled evidence${confirmedN ? ` (${confirmedN} re-tested on fresh subjects)` : ""}, and ${nulls} input field${nulls === 1 ? " shows" : "s show"} no detectable effect within the tested range and budget. ` +
      `${rejected} competing explanation${rejected === 1 ? " was" : "s were"} rejected${inconclusive ? ` and ${inconclusive} remain inconclusive` : ""}. ` +
      (fid
        ? `A ${model!.leaves}-leaf surrogate tree reaches held-out predictive fit R² = ${fid.r2.toFixed(3)} (MAE ${this.out(fid.mae)}) on ${fid.n} sealed test queries; this measures how well it predicts new responses, not the share of rules recovered.`
        : "");

    const caveats: string[] = [];
    if (partial) caveats.push(`Partial report: ${this.partialReason || "the investigation stopped early"}; findings reflect only the experiments completed.`);
    if (this.noiseSd > 0) caveats.push(`The target is stochastic (replicate SD ≈ ${this.out(this.noiseSd)}); effects smaller than ±${this.out(this.margin)} are treated as practically null.`);
    caveats.push("Rules describe observed input→output behavior within the documented field ranges; behavior outside those ranges was not tested.");
    caveats.push("Statistical support is not proof of mechanism: a supported rule is the simplest explanation consistent with the controlled evidence collected, not a recovery of the target's source code.");
    const tests = hs.filter((h) => h.test).length;
    const unconfirmed = rules.filter((r) => r.kind !== "null" && !r.confirmed).length;
    caveats.push(
      `${tests} hypothesis tests were run, each at α = 0.02 with no family-wise correction, so a small number of false positives is possible. ` +
        (unconfirmed ? `${unconfirmed} supported rule${unconfirmed === 1 ? " was" : "s were"} not re-tested on fresh subjects; use "Test this finding" to check them.` : "Every supported rule was re-tested on fresh subjects."),
    );
    caveats.push('"No detectable effect" means any effect was smaller than the noise-adjusted margin at this budget within the documented ranges, not that the effect is exactly zero.');
    caveats.push("Evidence scores are heuristics combining p-values, interval width and confirmation status. They are not calibrated probabilities that a rule is correct.");
    caveats.push(external ? "This is an external API: findings describe its responses during this session only and may change if the service changes." : "This is a built-in synthetic target built for demonstration; results on it are not real-world validation.");
    if (inconclusive) caveats.push(`${inconclusive} hypothesis(es) could not be resolved within the query budget and are excluded from the rulebook.`);
    if (fid && fid.r2 < 0.9) caveats.push(`Held-out predictive fit is moderate (R² ${fid.r2.toFixed(2)}); the small, readable surrogate tree does not capture all of the target's behavior.`);

    return { summary, rules, caveats, noiseSd: this.noiseSd, generatedAt: Date.now() };
  }
}

// keep tree helpers referenced for consumers importing from this module
export type { TreeNode, CategoricalFeature };
