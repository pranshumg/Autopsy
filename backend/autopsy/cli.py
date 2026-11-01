"""Headless run from the terminal (no UI):
    uv run python -m autopsy.cli pricing --budget 500 --seed 42
    uv run python -m autopsy.cli pricing --benchmark --seeds 3
"""

import argparse
import json

from autopsy.benchmark import run_benchmark
from autopsy.orchestrator import Run
from autopsy.scorecard import fetch_truth, items_from_effects, score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", choices=["pricing", "credit"])
    ap.add_argument("--budget", type=int, default=500)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--no-dowhy", action="store_true")
    ap.add_argument("--strategy", choices=["active", "random"], default="active")
    ap.add_argument("--benchmark", action="store_true")
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    if a.benchmark:
        b = run_benchmark(a.target, a.budget, a.seeds, lambda _: None)
        for k in ("adaptive", "random"):
            print(k, [(p["n"], round(p["found"], 2)) for p in b["rules"][k]], "false positives:", b["rules"]["falsePositives"][k])
        return

    def sink(events):
        if a.quiet:
            return
        for e in events:
            if e["type"] == "log":
                print(e["line"]["text"])

    run = Run(a.target, budget=a.budget, seed=a.seed, sink=sink, strategy=a.strategy, use_llm=not a.no_llm, use_dowhy=not a.no_dowhy, pace="instant")
    out = run.run()
    print("\n=== HIDDEN RULEBOOK ===")
    for r in out["rulebook"]:
        print(f"[{r['badge']:>9}] {r['statement']}")
        if r.get("refuters"):
            print("            refuters:", ", ".join(f"{x['name']}={'pass' if x['passed'] else 'FAIL' if x['passed'] is False else 'skip'}" for x in r["refuters"]))
    sc = score(fetch_truth(a.target), items_from_effects(out["findings"].get("effects", {}), out["findings"].get("interactions", [])))
    print(f"\n=== SCORECARD: {sc['found']}/{sc['total']} recovered, {sc['partial']} partial, {len(sc['falsePositives'])} false positives, {out['used']} queries ===")
    for r in sc["rules"]:
        print(f"  {r['verdict']:>9}  {r['text']}")
    if sc["falsePositives"]:
        print("  false positives:", json.dumps(sc["falsePositives"]))


if __name__ == "__main__":
    main()
