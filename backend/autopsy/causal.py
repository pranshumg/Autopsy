"""DoWhy refuters and the proxy (postcode -> income) check.

DoWhy is optional at import time so the rest of the engine still runs without it;
refuters are then reported as "skipped", never as passed.
"""

from __future__ import annotations

import logging
import math
import warnings
from typing import Any

import numpy as np
import pandas as pd

try:  # heavy optional dependency
    from dowhy import CausalModel

    logging.getLogger("dowhy").setLevel(logging.ERROR)
    HAVE_DOWHY = True
except Exception:  # noqa: BLE001
    CausalModel = None
    HAVE_DOWHY = False


def _design(rows: list[dict], treatment: list[int], outcome: list[float], covariates: list[str], features: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame([{k: r[k] for k in covariates} for r in rows])
    cat = [f["key"] for f in features if f["kind"] == "categorical" and f["key"] in covariates]
    if cat:
        df = pd.get_dummies(df, columns=cat, drop_first=True, dtype=float)
    df = df.astype(float)
    # drop constant columns (DoWhy's regression chokes on them)
    df = df.loc[:, df.std() > 0]
    df.columns = [f"c_{i}" for i in range(df.shape[1])]
    df["T"] = np.asarray(treatment, float)
    df["Y"] = np.asarray(outcome, float)
    return df


def refute(rows: list[dict], treatment: list[int], outcome: list[float], covariates: list[str], features: list[dict], seed: int, sims: int = 40) -> dict[str, Any]:
    """Estimate T -> Y by backdoor linear regression, then run three DoWhy refuters."""
    if not HAVE_DOWHY:
        return {"estimate": None, "refuters": [{"name": n, "passed": None, "detail": "skipped: DoWhy not installed"} for n in ("placebo treatment", "random common cause", "data subset")]}
    if len(set(treatment)) < 2 or len(rows) < 8:
        return {"estimate": None, "refuters": [{"name": n, "passed": None, "detail": "skipped: not enough variation"} for n in ("placebo treatment", "random common cause", "data subset")]}
    df = _design(rows, treatment, outcome, covariates, features)
    common = [c for c in df.columns if c.startswith("c_")]
    np.random.seed(seed)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = CausalModel(data=df, treatment="T", outcome="Y", common_causes=common or None)
        estimand = model.identify_effect(proceed_when_unidentifiable=True)
        est = model.estimate_effect(estimand, method_name="backdoor.linear_regression")
        orig = float(est.value)
        out = []
        checks = [
            ("placebo treatment", dict(method_name="placebo_treatment_refuter", placebo_type="permute", num_simulations=sims), lambda new: abs(new) <= 0.25 * abs(orig) + 1e-9, "effect should vanish when the treatment is shuffled"),
            ("random common cause", dict(method_name="random_common_cause", num_simulations=sims), lambda new: abs(new - orig) <= 0.1 * abs(orig) + 1e-9, "effect should not move when a random confounder is added"),
            ("data subset", dict(method_name="data_subset_refuter", subset_fraction=0.8, num_simulations=sims), lambda new: abs(new - orig) <= 0.15 * abs(orig) + 1e-9, "effect should hold on random 80% subsets"),
        ]
        for name, kwargs, ok, why in checks:
            try:
                r = model.refute_estimate(estimand, est, **kwargs)
                new = float(r.new_effect if not isinstance(r.new_effect, (list, tuple, np.ndarray)) else np.mean(r.new_effect))
                out.append({"name": name, "passed": bool(ok(new)), "original": orig, "new": new, "detail": why})
            except Exception as e:  # noqa: BLE001
                out.append({"name": name, "passed": None, "detail": f"skipped: {type(e).__name__}"})
    return {"estimate": orig, "refuters": out}


def proxy_check(observational: list[dict], outputs: list[float], x_key: str, c_key: str, levels: list[str], direct_x_effect: dict | None, seed: int) -> dict[str, Any] | None:
    """Is categorical feature `c_key` (restricted to `levels`) acting as a proxy for numeric `x_key`?

    Example: postcode as a proxy for income. Uses realistic (observational) personas, where the two
    co-vary as in the real world, plus a DoWhy causal graph  x -> C -> Y,  x -> Y.
    The counterfactual probes already measured x's DIRECT effect (C held fixed).
    """
    if not levels or len(observational) < 15:
        return None
    x = np.array([float(r[x_key]) for r in observational])
    scale = 10 ** max(0, int(math.log10(max(np.abs(x).max(), 1))) - 1)  # readable unit, e.g. per 1M
    df = pd.DataFrame(
        {
            "X": x / scale,
            "C": [1.0 if str(r[c_key]) in levels else 0.0 for r in observational],
            "Y": np.log(np.maximum(np.asarray(outputs, float), 1e-9)),
        }
    )
    if df["C"].std() == 0 or df["X"].std() == 0:
        return None
    corr = float(np.corrcoef(df["X"], df["C"])[0, 1])
    from scipy import stats as sps

    corr_p = float(sps.pearsonr(df["X"], df["C"])[1])
    res: dict[str, Any] = {"x": x_key, "c": c_key, "levels": levels, "unit": scale, "corr": corr, "corr_p": corr_p, "n": len(df)}
    res["naive_x_effect"] = math.exp(float(np.polyfit(df["X"], df["Y"], 1)[0]))  # price vs x in the real population
    if HAVE_DOWHY:
        np.random.seed(seed)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            graph = "digraph { X -> C; X -> Y; C -> Y; }"
            m = CausalModel(data=df, treatment="C", outcome="Y", graph=graph)
            e = m.estimate_effect(m.identify_effect(proceed_when_unidentifiable=True), method_name="backdoor.linear_regression")
            res["c_effect_adjusted"] = math.exp(float(e.value))
            m2 = CausalModel(data=df, treatment="X", outcome="Y", graph=graph)
            e2 = m2.estimate_effect(m2.identify_effect(proceed_when_unidentifiable=True), method_name="backdoor.linear_regression")
            res["x_total_effect"] = math.exp(float(e2.value))
        res["method"] = f"DoWhy backdoor linear regression on graph {x_key}→{c_key}→output, {x_key}→output"
    else:
        res["method"] = "least squares (DoWhy not installed)"
    direct_null = bool(direct_x_effect and direct_x_effect.get("kind") == "null")
    res["direct_x_effect"] = {k: direct_x_effect.get(k) for k in ("kind", "estimate", "ci", "p")} if direct_x_effect else None
    res["is_proxy"] = bool(corr > 0.3 and res["naive_x_effect"] > 1.005 and direct_null)
    return res
