"use client";

import { create } from "zustand";
import type {
  EngineEvent,
  Experiment,
  GroundTruth,
  Input,
  InvestigationState,
  InvestigationStatus,
  Observation,
  Pace,
  QuerySource,
  TargetSpec,
  WorkerCommand,
  WorkerMessage,
} from "@/lib/types";
import { applyEvents, createInvestigation } from "@/lib/engine/reducer";
import { createAdapter, TargetError } from "@/lib/adapter";
import { fetchEngineTargets, PythonEngineHandle } from "@/lib/python-engine";
import { SAMPLE_CHALLENGE_ID, SAMPLE_CHALLENGE_KEY } from "@/lib/examples";

const INDEX_KEY = "autopsy:index:v1";
/** External target definitions (no credentials: those live in memory only). */
const EXTERNAL_KEY = "autopsy:targets:v1";
const invKey = (id: string) => `autopsy:inv:v1:${id}`;

export type IndexEntry = {
  id: string;
  name: string;
  targetId: string;
  targetName: string;
  origin?: "builtin" | "external" | "python";
  saved?: boolean;
  status: InvestigationStatus;
  createdAt: number;
  updatedAt: number;
  used: number;
  limit: number;
  rules: number;
  r2?: number;
};

type ManualOpts = {
  title: string;
  design: string;
  features: string[];
  pair?: boolean;
  source?: Extract<QuerySource, "manual" | "verify">;
  ruleId?: string;
  /** builds the experiment's result from the fresh outputs */
  finalize?: (outputs: number[]) => Partial<Experiment>;
};

type LabState = {
  targets: TargetSpec[] | null;
  /** analyst-defined external targets, persisted locally without credentials */
  externalTargets: TargetSpec[];
  /** session credentials keyed by target id; never persisted or exported */
  credentials: Record<string, string>;
  targetsError: string | null;
  investigations: Record<string, InvestigationState>;
  index: IndexEntry[];
  hydrated: boolean;
  /** ids that were looked up but exist neither in memory nor in storage */
  notFound: Record<string, true>;
  /** investigations that should not be written to storage (landing-page demo runs) */
  ephemeral: Record<string, true>;
  loadTargets: () => Promise<void>;
  hydrate: () => void;
  load: (id: string) => InvestigationState | null;
  create: (opts: { target: TargetSpec; budget: number; pace: Pace; seed?: number; name?: string; ephemeral?: boolean; guided?: boolean }) => string;
  start: (id: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  setPace: (id: string, pace: Pace) => void;
  apply: (id: string, events: EngineEvent[]) => void;
  remove: (id: string) => void;
  persistNow: (id: string) => void;
  adopt: (id: string) => void;
  runBenchmark: (id: string, seeds: number) => void;
  cancelBenchmark: (id: string) => void;
  manualQuery: (id: string, inputs: Input[], opts: ManualOpts) => Promise<Observation[]>;
  saveExternal: (t: TargetSpec) => void;
  removeExternal: (targetId: string) => void;
  setCredential: (targetId: string, value: string) => void;
  loadSavedRun: (url: string) => Promise<string>;
  setGroundTruth: (id: string, gt: GroundTruth | undefined) => void;
};

/** Built-in targets followed by the analyst's external targets. */
/** Two saved external targets describe the same API: same name and same endpoint URL. */
export function sameExternal(a: TargetSpec, b: TargetSpec): boolean {
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && (a.connection?.url ?? "").trim() === (b.connection?.url ?? "").trim();
}

/** Keeps the first (most recent) of any duplicates. */
function dedupeExternal(list: TargetSpec[]): TargetSpec[] {
  return list.filter((t, i) => list.findIndex((u) => sameExternal(u, t)) === i);
}

export function allTargets(st: Pick<LabState, "targets" | "externalTargets">): TargetSpec[] {
  return [...(st.targets ?? []), ...st.externalTargets];
}

/** True when the target needs a session credential that has not been entered yet. */
export function needsCredential(t: TargetSpec, credentials: Record<string, string>): boolean {
  return t.origin === "external" && !!t.connection?.authHeader && !credentials[t.id];
}

// --------------------------------------------------------------------------
// Workers (outside React state)

type EngineHandle = Pick<Worker, "postMessage" | "terminate">;
const workers = new Map<string, EngineHandle>();
const benchWorkers = new Map<string, EngineHandle>();

/** Python-engine targets run in backend/; all others in the in-browser worker. */
function spawn(id: string, onEvents: (events: EngineEvent[]) => void, target?: TargetSpec): EngineHandle {
  if (target?.origin === "python") return new PythonEngineHandle(onEvents);
  const w = new Worker(new URL("./engine/engine.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<WorkerMessage>) => {
    if (e.data.id === id) onEvents(e.data.events);
  };
  w.onerror = (e) => {
    onEvents([
      { type: "log", line: { id: Date.now(), t: Date.now(), source: "system", level: "error", text: `Engine worker crashed: ${e.message}` } },
      { type: "status", status: "error", error: e.message },
    ]);
  };
  return w;
}

function send(w: EngineHandle | undefined, cmd: WorkerCommand) {
  w?.postMessage(cmd);
}

// --------------------------------------------------------------------------
// Persistence (best effort; storage may be unavailable or full)

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function toEntry(s: InvestigationState): IndexEntry {
  return {
    id: s.id,
    name: s.name,
    targetId: s.target.id,
    targetName: s.target.name,
    origin: s.target.origin ?? "builtin",
    saved: !!s.saved,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    used: s.budget.used,
    limit: s.budget.limit,
    rules: s.report?.rules.length ?? 0,
    r2: s.surrogate?.fidelity.r2,
  };
}

/** Storage copy: trims the bulkiest, least essential arrays. */
function compact(s: InvestigationState, aggressive: boolean): InvestigationState {
  return {
    ...s,
    logs: s.logs.slice(aggressive ? -150 : -600),
    handoffs: s.handoffs.slice(aggressive ? -60 : -200),
    alRounds: s.alRounds.map((r, i, all) =>
      aggressive || i < all.length - 3 ? { ...r, candidates: r.candidates.filter((c, j) => c.selected || j % 3 === 0) } : r,
    ),
  };
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// --------------------------------------------------------------------------

let manualObsId = 1_000_000;
let manualExpId = 0;

export const useLab = create<LabState>((set, get) => {
  const writeIndex = () => {
    const idx = get().index;
    safeSet(INDEX_KEY, JSON.stringify(idx));
  };

  const persist = (id: string) => {
    const s = get().investigations[id];
    if (!s || get().ephemeral[id]) return;
    let ok = safeSet(invKey(id), JSON.stringify(compact(s, false)));
    if (!ok) ok = safeSet(invKey(id), JSON.stringify(compact(s, true)));
    if (!ok) {
      // evict the oldest finished investigations until it fits
      const victims = get()
        .index.filter((e) => e.id !== id && e.status !== "running")
        .sort((a, b) => a.updatedAt - b.updatedAt);
      const evicted = new Set<string>();
      for (const v of victims) {
        safeRemove(invKey(v.id));
        evicted.add(v.id);
        if ((ok = safeSet(invKey(id), JSON.stringify(compact(s, true))))) break;
      }
      // an evicted run has no data left to open, so it must leave the case-file list too
      if (evicted.size) set((st) => ({ index: st.index.filter((e) => !evicted.has(e.id)) }));
    }
    const entry = toEntry(s);
    set((st) => ({ index: [entry, ...st.index.filter((e) => e.id !== id)].sort((a, b) => b.createdAt - a.createdAt) }));
    writeIndex();
  };

  const schedulePersist = (id: string, ms = 900) => {
    if (get().ephemeral[id]) return;
    const t = saveTimers.get(id);
    if (t) clearTimeout(t);
    saveTimers.set(
      id,
      setTimeout(() => {
        saveTimers.delete(id);
        persist(id);
      }, ms),
    );
  };

  return {
    targets: null,
    externalTargets: [],
    credentials: {},
    targetsError: null,
    investigations: {},
    index: [],
    hydrated: false,
    notFound: {},
    ephemeral: {},

    async loadTargets() {
      if (get().targets) return;
      try {
        const [res, engine] = await Promise.all([fetch("/api/targets"), fetchEngineTargets().catch(() => ({ targets: [] as TargetSpec[], errors: [] }))]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { targets: TargetSpec[] };
        // Python multi-agent targets first; built-in synthetic targets stay available without the backend
        set({ targets: [...engine.targets, ...data.targets], targetsError: null });
      } catch (e) {
        set({ targetsError: e instanceof Error ? e.message : "Failed to load targets" });
      }
    },

    hydrate() {
      if (get().hydrated) return;
      let index: IndexEntry[] = [];
      try {
        index = JSON.parse(safeGet(INDEX_KEY) ?? "[]") as IndexEntry[];
      } catch {
        index = [];
      }
      // drop entries whose saved data is gone (evicted when storage was full by earlier versions)
      const before = index.length;
      index = index.filter((e) => safeGet(invKey(e.id)) !== null);
      if (index.length !== before) safeSet(INDEX_KEY, JSON.stringify(index));
      // anything that was mid-flight when the page unloaded cannot resume
      index = index.map((e) => (e.status === "running" || e.status === "paused" ? { ...e, status: "interrupted" } : e));
      let externalTargets: TargetSpec[] = [];
      try {
        const stored = JSON.parse(safeGet(EXTERNAL_KEY) ?? "[]") as TargetSpec[];
        // earlier versions saved a new copy every time the same API was saved again
        externalTargets = dedupeExternal(stored);
        if (externalTargets.length !== stored.length) safeSet(EXTERNAL_KEY, JSON.stringify(externalTargets));
      } catch {
        externalTargets = [];
      }
      // the bundled sample challenge uses a published demo key, not a secret: fill it in so the
      // Lab does not ask for it after every reload (real credentials still live only in memory)
      const credentials = { ...get().credentials };
      for (const t of externalTargets) if (t.challengeId === SAMPLE_CHALLENGE_ID && !credentials[t.id]) credentials[t.id] = SAMPLE_CHALLENGE_KEY;
      set({ index, externalTargets, credentials, hydrated: true });
    },

    load(id) {
      const have = get().investigations[id];
      if (have) return have;
      const raw = safeGet(invKey(id));
      if (!raw) {
        if (!get().notFound[id]) set((st) => ({ notFound: { ...st.notFound, [id]: true } }));
        return null;
      }
      try {
        let s = JSON.parse(raw) as InvestigationState;
        if (s.status === "running" || s.status === "paused" || s.status === "idle") {
          s = {
            ...s,
            status: s.status === "idle" ? "idle" : "interrupted",
            agents: Object.fromEntries(Object.entries(s.agents).map(([k, a]) => [k, { ...a, status: a.status === "done" ? "done" : "idle", currentTaskId: undefined }])) as InvestigationState["agents"],
          };
        }
        if (s.benchmark?.status === "running") s = { ...s, benchmark: { ...s.benchmark, status: "cancelled" } };
        set((st) => ({ investigations: { ...st.investigations, [id]: s } }));
        return s;
      } catch {
        return null;
      }
    },

    create({ target, budget, pace, seed, name, ephemeral, guided }) {
      const id = `inv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const s = createInvestigation({
        id,
        target,
        budget,
        pace,
        seed: seed ?? Math.floor(Math.random() * 2 ** 31),
        name,
        now: Date.now(),
      });
      if (guided) s.guided = true;
      set((st) => ({
        investigations: { ...st.investigations, [id]: s },
        ephemeral: ephemeral ? { ...st.ephemeral, [id]: true } : st.ephemeral,
      }));
      if (!ephemeral) persist(id);
      return id;
    },

    start(id) {
      const s = get().investigations[id];
      if (!s || workers.has(id)) return;
      const w = spawn(id, (events) => get().apply(id, events), s.target);
      workers.set(id, w);
      send(w, { cmd: "start", state: s, origin: window.location.origin, credential: get().credentials[s.target.id] });
    },

    pause(id) {
      send(workers.get(id), { cmd: "pause" });
    },
    resume(id) {
      send(workers.get(id), { cmd: "resume" });
    },
    cancel(id) {
      send(workers.get(id), { cmd: "cancel" });
    },
    setPace(id, pace) {
      send(workers.get(id), { cmd: "pace", pace });
      set((st) => {
        const s = st.investigations[id];
        return s ? { investigations: { ...st.investigations, [id]: { ...s, pace } } } : {};
      });
    },

    apply(id, events) {
      const s = get().investigations[id];
      if (!s) return;
      const next = applyEvents(s, events, Date.now());
      set((st) => ({ investigations: { ...st.investigations, [id]: next } }));
      const terminal = events.some((e) => e.type === "status" && ["completed", "cancelled", "error"].includes(e.status));
      if (terminal) {
        const w = workers.get(id);
        if (w) {
          w.terminate();
          workers.delete(id);
        }
        schedulePersist(id, 50);
      } else {
        schedulePersist(id);
      }
      const bench = events.find((e) => e.type === "benchmark");
      if (bench && bench.type === "benchmark" && bench.benchmark.status !== "running") {
        benchWorkers.get(id)?.terminate();
        benchWorkers.delete(id);
      }
    },

    remove(id) {
      workers.get(id)?.terminate();
      workers.delete(id);
      safeRemove(invKey(id));
      set((st) => {
        const investigations = { ...st.investigations };
        delete investigations[id];
        return { investigations, index: st.index.filter((e) => e.id !== id) };
      });
      writeIndex();
    },

    persistNow(id) {
      persist(id);
    },

    adopt(id) {
      set((st) => {
        const ephemeral = { ...st.ephemeral };
        delete ephemeral[id];
        return { ephemeral };
      });
      persist(id);
    },

    runBenchmark(id, seeds) {
      const s = get().investigations[id];
      if (!s || s.saved || benchWorkers.has(id)) return;
      const w = spawn(id, (events) => get().apply(id, events), s.target);
      benchWorkers.set(id, w);
      send(w, { cmd: "benchmark", state: s, origin: window.location.origin, seeds, credential: get().credentials[s.target.id] });
    },

    cancelBenchmark(id) {
      send(benchWorkers.get(id), { cmd: "cancel" });
    },

    async manualQuery(id, inputs, opts) {
      const s = get().investigations[id];
      if (!s) throw new Error("Investigation not loaded");
      if (s.saved) throw new Error("This is a saved recording. Start a live investigation to query the target.");
      const adapter = createAdapter(s.target, { origin: window.location.origin, credential: get().credentials[s.target.id] });
      let data;
      try {
        data = await adapter.query(inputs);
      } catch (e) {
        const n = e instanceof TargetError ? e.requests : 0;
        if (n) get().apply(id, [{ type: "requests", count: n }]);
        throw e;
      }
      const now = Date.now();
      const source = opts.source ?? "manual";
      const prefix = source === "verify" ? "V" : "M";
      const expId = `${prefix}-${String(++manualExpId + s.experiments.filter((e) => e.id.startsWith(`${prefix}-`)).length).padStart(3, "0")}`;
      const obs: Observation[] = inputs.map((x, i) => ({ id: ++manualObsId, input: x, output: data.outputs[i], t: now, source, experimentId: expId }));
      const base: Experiment = {
        id: expId,
        kind: source === "verify" ? "verification" : "manual",
        phase: s.phase ?? "synthesis",
        title: opts.title,
        design: opts.design,
        features: opts.features,
        status: "done",
        observationIds: obs.map((o) => o.id),
        pairs: opts.pair && obs.length === 2 ? [{ a: obs[0].id, b: obs[1].id, changed: opts.features, delta: obs[1].output - obs[0].output }] : undefined,
        hypothesisIds: [],
        createdAt: now,
        completedAt: now,
        agent: "experimenter",
        ruleId: opts.ruleId,
        result: { summary: obs.length === 2 && opts.pair ? `Δ ${obs[1].output - obs[0].output}` : `${obs.length} analyst probe(s)`, n: obs.length },
      };
      const exp: Experiment = { ...base, ...opts.finalize?.(data.outputs) };
      get().apply(id, [
        { type: "requests", count: data.requests },
        { type: "observations", observations: obs },
        { type: "experiment", experiment: exp },
        {
          type: "log",
          line: { id: now, t: now, source: "target", level: "query", text: `${data.receiptId} · ${obs.length}× ${source} · ${expId} · ${data.requests} request${data.requests === 1 ? "" : "s"} · ${data.latencyMs}ms (analyst)` },
        },
      ]);
      return obs;
    },

    saveExternal(t) {
      // saving the same API again replaces the old entry instead of adding a duplicate
      const list = [t, ...get().externalTargets.filter((x) => x.id !== t.id && !sameExternal(x, t))];
      set({ externalTargets: list });
      safeSet(EXTERNAL_KEY, JSON.stringify(list));
    },

    removeExternal(targetId) {
      const list = get().externalTargets.filter((x) => x.id !== targetId);
      const credentials = { ...get().credentials };
      delete credentials[targetId];
      set({ externalTargets: list, credentials });
      safeSet(EXTERNAL_KEY, JSON.stringify(list));
    },

    setCredential(targetId, value) {
      const credentials = { ...get().credentials };
      if (value) credentials[targetId] = value;
      else delete credentials[targetId];
      set({ credentials });
    },

    async loadSavedRun(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load the saved run (HTTP ${res.status})`);
      const rec = (await res.json()) as InvestigationState;
      if (!rec.saved || !rec.report) throw new Error("File is not a saved AUTOPSY run");
      const id = `inv_saved_${Date.now().toString(36)}`;
      const s: InvestigationState = { ...rec, id, name: `${rec.target.name} · saved run`, guided: true };
      set((st) => ({ investigations: { ...st.investigations, [id]: s }, ephemeral: { ...st.ephemeral, [id]: true } }));
      return id;
    },

    setGroundTruth(id, gt) {
      const s = get().investigations[id];
      if (!s) return;
      set((st) => ({ investigations: { ...st.investigations, [id]: { ...s, groundTruth: gt, updatedAt: Date.now() } } }));
      schedulePersist(id, 50);
    },
  };
});

/** Remaining budget the analyst may spend right now. While the engine runs, only its reserve is available. */
export function analystAllowance(s: InvestigationState): number {
  if (s.saved) return 0;
  const manualUsed = s.observations.filter((o) => o.source === "manual" || o.source === "verify").length;
  if (s.status === "running" || s.status === "paused") {
    return Math.max(0, Math.round(s.budget.limit * 0.04) - manualUsed);
  }
  return Math.max(0, s.budget.limit - s.budget.used);
}

export function useInvestigation(id: string | undefined): InvestigationState | undefined {
  return useLab((st) => (id ? st.investigations[id] : undefined));
}
