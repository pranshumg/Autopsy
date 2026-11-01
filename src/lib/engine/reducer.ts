import {
  AGENTS,
  type AgentRuntime,
  type EngineEvent,
  type InvestigationState,
  type Pace,
  type PhaseId,
  type TargetSpec,
} from "@/lib/types";

const MAX_LOGS = 1500;
const MAX_HANDOFFS = 400;

export function createInvestigation(opts: {
  id: string;
  target: TargetSpec;
  budget: number;
  pace: Pace;
  seed: number;
  name?: string;
  now: number;
}): InvestigationState {
  const agents = Object.fromEntries(
    AGENTS.map((a) => [a, { status: "idle", completed: 0, queries: 0 } satisfies AgentRuntime]),
  ) as InvestigationState["agents"];
  return {
    id: opts.id,
    name: opts.name ?? `${opts.target.name} · #${opts.id.slice(-4).toUpperCase()}`,
    target: opts.target,
    status: "idle",
    phase: null,
    phaseProgress: { recon: 0, screening: 0, structure: 0, interactions: 0, active: 0, synthesis: 0 } as Record<PhaseId, number>,
    budget: { limit: opts.budget, used: 0 },
    pace: opts.pace,
    seed: opts.seed,
    createdAt: opts.now,
    updatedAt: opts.now,
    observations: [],
    experiments: [],
    hypotheses: [],
    agents,
    tasks: [],
    handoffs: [],
    logs: [],
    alRounds: [],
  };
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

/** Pure reducer: applies a batch of engine events to an investigation. */
export function applyEvents(state: InvestigationState, events: EngineEvent[], now: number): InvestigationState {
  if (!events.length) return state;
  const s: InvestigationState = { ...state, updatedAt: now };
  for (const e of events) {
    switch (e.type) {
      case "status":
        s.status = e.status;
        if (e.error) s.error = e.error;
        break;
      case "phase":
        s.phase = e.phase;
        break;
      case "phaseProgress":
        s.phaseProgress = { ...s.phaseProgress, [e.phase]: e.progress };
        break;
      case "agent":
        s.agents = { ...s.agents, [e.agent]: { ...s.agents[e.agent], ...e.patch } };
        break;
      case "task":
        s.tasks = upsert(s.tasks, e.task);
        break;
      case "handoff":
        s.handoffs = [...s.handoffs, e.handoff].slice(-MAX_HANDOFFS);
        break;
      case "requests":
        s.budget = { ...s.budget, requests: (s.budget.requests ?? 0) + e.count };
        break;
      case "observations": {
        s.observations = [...s.observations, ...e.observations];
        const counted = e.observations.length;
        s.budget = { ...s.budget, used: s.budget.used + counted };
        break;
      }
      case "experiment":
        s.experiments = upsert(s.experiments, e.experiment);
        break;
      case "hypothesis":
        s.hypotheses = upsert(s.hypotheses, e.hypothesis);
        break;
      case "log":
        s.logs = s.logs.length >= MAX_LOGS ? [...s.logs.slice(-MAX_LOGS + 1), e.line] : [...s.logs, e.line];
        break;
      case "surrogate":
        s.surrogate = e.model;
        break;
      case "alRound":
        s.alRounds = [...s.alRounds, e.round];
        break;
      case "report":
        s.report = e.report;
        break;
      case "benchmark":
        s.benchmark = e.benchmark;
        break;
    }
  }
  return s;
}
