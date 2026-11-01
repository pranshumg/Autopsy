// Adaptive (uncertainty sampling) vs random sampling benchmark. Both strategies
// query the live target through the same adapter as the investigation, with
// equal training budgets, a shared starting sample per run and one shared
// held-out evaluation set. Curves report the held-out RMSE of a bootstrap
// ensemble trained on each strategy's observations. Benchmark queries are
// counted separately from the investigation budget.

import type { TargetAdapter } from "@/lib/adapter";
import type { Benchmark, BenchmarkCurve, EngineEvent, Input, InvestigationState } from "@/lib/types";
import { distance, randomInput } from "./design";
import { mean, mulberry32, rmse } from "./stats";
import { fitEnsemble, predictEnsemble } from "./tree";

export async function runBenchmark(
  state: InvestigationState,
  adapter: TargetAdapter,
  seeds: number,
  post: (events: EngineEvent[]) => void,
  isCancelled: () => boolean,
) {
  const spec = state.target;
  const rng = mulberry32(state.seed ^ 0x9e3779b9);
  const INIT = 20;
  const BATCH = 16;
  const ROUNDS = 10;
  const HOLD = 120;
  let used = 0;
  let requests = 0;
  const totalQueries = HOLD + seeds * (INIT + 2 * BATCH * ROUNDS);

  const bm: Benchmark = {
    status: "running",
    seeds,
    holdoutSize: HOLD,
    queriesUsed: 0,
    perStrategyBudget: INIT + BATCH * ROUNDS,
    finals: { adaptive: [], random: [] },
    requests: 0,
    adaptive: [],
    random: [],
    startedAt: Date.now(),
    progress: 0,
  };
  const emit = (patch: Partial<Benchmark>) => {
    Object.assign(bm, patch);
    post([{ type: "benchmark", benchmark: { ...bm, adaptive: [...bm.adaptive], random: [...bm.random], finals: { adaptive: [...bm.finals!.adaptive], random: [...bm.finals!.random] } } }]);
  };

  const q = async (inputs: Input[]): Promise<number[]> => {
    if (isCancelled()) throw new Error("cancelled");
    try {
      const res = await adapter.query(inputs);
      requests += res.requests;
      used += inputs.length;
      emit({ queriesUsed: used, requests, progress: used / totalQueries });
      return res.outputs;
    } catch (e) {
      requests += (e as { requests?: number }).requests ?? 0;
      emit({ requests });
      throw e;
    }
  };

  try {
    emit({});
    const holdX = Array.from({ length: HOLD }, () => randomInput(spec, rng));
    const holdY = await q(holdX);
    const evalRows = (rows: { x: Input; y: number }[]) => {
      const ens = fitEnsemble(rows, spec.features, rng, 10);
      return rmse(holdY, holdX.map((x) => predictEnsemble(ens, x).mean));
    };

    const curves: { adaptive: number[][]; random: number[][] } = { adaptive: [], random: [] };
    const ns: number[] = [];
    for (let r = 0; r <= ROUNDS; r++) ns.push(INIT + r * BATCH);

    for (let s = 0; s < seeds; s++) {
      const initX = Array.from({ length: INIT }, () => randomInput(spec, rng));
      const initY = await q(initX);
      const adaptive = initX.map((x, i) => ({ x, y: initY[i] }));
      const random = adaptive.slice();
      const ca = [evalRows(adaptive)];
      const cr = [ca[0]];
      for (let r = 0; r < ROUNDS; r++) {
        // adaptive: ensemble disagreement × diversity
        const ens = fitEnsemble(adaptive, spec.features, rng, 10);
        const pool = Array.from({ length: 300 }, () => randomInput(spec, rng));
        const sds = pool.map((x) => predictEnsemble(ens, x).sd);
        const chosen: number[] = [];
        for (let b = 0; b < BATCH; b++) {
          let bi = 0;
          let bv = -Infinity;
          for (let i = 0; i < pool.length; i++) {
            if (chosen.includes(i)) continue;
            let v = sds[i];
            for (const c of chosen) v *= Math.min(1, distance(spec, pool[i], pool[c]) / 0.18);
            if (v > bv) {
              bv = v;
              bi = i;
            }
          }
          chosen.push(bi);
        }
        const ax = chosen.map((i) => pool[i]);
        const rx = Array.from({ length: BATCH }, () => randomInput(spec, rng));
        const ys = await q([...ax, ...rx]);
        ax.forEach((x, i) => adaptive.push({ x, y: ys[i] }));
        rx.forEach((x, i) => random.push({ x, y: ys[BATCH + i] }));
        ca.push(evalRows(adaptive));
        cr.push(evalRows(random));
      }
      curves.adaptive.push(ca);
      curves.random.push(cr);
      bm.finals!.adaptive.push(ca[ca.length - 1]);
      bm.finals!.random.push(cr[cr.length - 1]);
      const agg = (c: number[][]): BenchmarkCurve =>
        ns.map((n, i) => {
          const v = c.map((row) => row[i]);
          return { n, rmse: mean(v), lo: Math.min(...v), hi: Math.max(...v) };
        });
      emit({ adaptive: agg(curves.adaptive), random: agg(curves.random) });
    }
    emit({ status: "done", completedAt: Date.now(), progress: 1 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit({ status: msg === "cancelled" ? "cancelled" : "error", error: msg === "cancelled" ? undefined : msg, completedAt: Date.now() });
  }
}
