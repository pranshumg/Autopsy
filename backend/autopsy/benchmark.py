"""Active learning vs RANDOM probing, same budget, same seeds.

For each seed both strategies run the full engine (LLM and DoWhy off for speed and
determinism). Afterwards, every checkpoint is replayed with only the probes known
at that point, and scored against the target's ground truth (evaluation only).
Also reports surrogate RMSE on a shared evaluation set, for the existing UI chart.
"""

from __future__ import annotations

import random
import time
from typing import Callable

import httpx
import numpy as np

from autopsy import config
from autopsy.orchestrator import Run
from autopsy.probes import fetch_schema
from autopsy.scorecard import fetch_truth, items_from_effects, score
from autopsy.surrogate import holdout_rmse


def eval_set(target_id: str, schema: dict, n: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    rows = []
    ctx = schema.get("context", {})
    with httpx.Client(timeout=10) as http:
        for i in range(n):
            x = {}
            for f in schema["features"]:
                if f["kind"] == "categorical":
                    x[f["key"]] = rng.choice(f["levels"])
                else:
                    v = rng.uniform(f["min"], f["max"])
                    x[f["key"]] = int(round(v)) if f.get("integer") else v
            if "postcodes" in ctx and "postcode" in x:
                info = ctx["postcodes"][x["postcode"]]
                x["city"] = info["city"]
                if "income" in x:
                    f = next(ff for ff in schema["features"] if ff["key"] == "income")
                    x["income"] = int(min(max(info["median_income"] * np.exp(rng.gauss(0, 0.35)), f["min"]), f["max"]))
            y = http.post(f"{config.TARGETS_URL}/{target_id}/quote", json=x).json()[schema["output"]["key"]]
            rows.append({"id": -(i + 1), "input": x, "output": float(y)})
    return rows


def run_benchmark(target_id: str, budget: int, seeds: int, emit: Callable[[dict], None], cancelled: Callable[[], bool] = lambda: False, base_seed: int = 7) -> dict:
    schema = fetch_schema(target_id)
    truth = fetch_truth(target_id)
    evals = eval_set(target_id, schema, 60, base_seed)
    step = max(25, budget // 10)
    started = int(time.time() * 1000)
    curves: dict[str, list[list[tuple[int, float, float]]]] = {"active": [], "random": []}
    finals: dict[str, list[float]] = {"active": [], "random": []}
    fp: dict[str, list[int]] = {"active": [], "random": []}
    requests = len(evals)
    used = len(evals)
    total_runs = seeds * 2
    bench = {"status": "running", "seeds": seeds, "holdoutSize": len(evals), "queriesUsed": used, "adaptive": [], "random": [], "startedAt": started, "progress": 0.0, "perStrategyBudget": budget, "finals": {"adaptive": [], "random": []}, "requests": requests, "rules": {"total": len(truth["rules"]), "adaptive": [], "random": []}}
    emit(bench)
    done = 0
    for s in range(seeds):
        for strategy in ("active", "random"):
            if cancelled():
                bench["status"] = "cancelled"
                emit(bench)
                return bench
            run = Run(target_id, budget=budget, seed=base_seed + 1000 * s, strategy=strategy, use_llm=False, use_dowhy=False, pace="instant", db_path=":memory:")
            run.run()
            used += run.client.used
            requests += run.client.requests
            stat = run.agents["statistician"]
            rows = run.store.all()
            pts = []
            for n in list(range(step, run.client.used + 1, step)) + ([run.client.used] if run.client.used % step else []):
                effects = {stat.ekey(e): e.as_dict() for e in stat.analyze(max_id=n)}
                sc = score(truth, items_from_effects(effects, stat.interactions_upto(n)))
                rmse = holdout_rmse([r for r in rows if r["id"] <= n], evals, schema["features"], base_seed) or float("nan")
                pts.append((n, sc["found"] + 0.5 * sc["partial"], rmse, len(sc["falsePositives"])))
            curves[strategy].append([(n, f, r) for n, f, r, _ in pts])
            finals[strategy].append(pts[-1][2])
            fp[strategy].append(pts[-1][3])
            done += 1
            bench.update(_summarise(curves, finals, fp))
            bench["rules"]["total"] = len(truth["rules"])
            bench.update(progress=done / total_runs, queriesUsed=used, requests=requests)
            emit(bench)
    bench.update(status="done", completedAt=int(time.time() * 1000), progress=1.0)
    emit(bench)
    return bench


def _summarise(curves, finals, fp) -> dict:
    def agg(runs: list[list[tuple[int, float, float]]], idx: int) -> list[dict]:
        if not runs:
            return []
        ns = sorted({p[0] for r in runs for p in r})
        out = []
        for n in ns:
            vals = []
            for r in runs:
                prior = [p for p in r if p[0] <= n]
                if prior:
                    vals.append(prior[-1][idx])
            vals = [v for v in vals if v == v]
            if vals:
                out.append({"n": n, "mean": float(np.mean(vals)), "lo": float(np.min(vals)), "hi": float(np.max(vals))})
        return out

    rmse_a, rmse_r = agg(curves["active"], 2), agg(curves["random"], 2)
    rules_a, rules_r = agg(curves["active"], 1), agg(curves["random"], 1)
    return {
        "adaptive": [{"n": p["n"], "rmse": p["mean"], "lo": p["lo"], "hi": p["hi"]} for p in rmse_a],
        "random": [{"n": p["n"], "rmse": p["mean"], "lo": p["lo"], "hi": p["hi"]} for p in rmse_r],
        "finals": {"adaptive": finals["active"], "random": finals["random"]},
        "rules": {
            "adaptive": [{"n": p["n"], "found": p["mean"], "lo": p["lo"], "hi": p["hi"]} for p in rules_a],
            "random": [{"n": p["n"], "found": p["mean"], "lo": p["lo"], "hi": p["hi"]} for p in rules_r],
            "falsePositives": {"adaptive": fp["active"], "random": fp["random"]},
        },
    }
