"""Interpretable surrogate: a shallow decision tree fitted to the probe data,
scored once on the held-out realistic personas. Converted to the UI's TreeNode shape."""

from __future__ import annotations

import itertools
import time

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeRegressor


def _encode(inputs: list[dict], features: list[dict]) -> tuple[pd.DataFrame, list[tuple[str, str | None]]]:
    cols, meta = {}, []
    for f in features:
        k = f["key"]
        if f["kind"] == "categorical":
            for lv in f["levels"]:
                cols[f"{k}={lv}"] = [1.0 if str(x[k]) == lv else 0.0 for x in inputs]
                meta.append((k, lv))
        else:
            cols[k] = [float(x[k]) for x in inputs]
            meta.append((k, None))
    return pd.DataFrame(cols), meta


def fit_surrogate(train: list[dict], test: list[dict], features: list[dict], version: int, seed: int) -> dict | None:
    if len(train) < 20:
        return None
    Xtr, meta = _encode([r["input"] for r in train], features)
    ytr = np.array([r["output"] for r in train])
    tree = DecisionTreeRegressor(max_depth=5, min_samples_leaf=4, random_state=seed).fit(Xtr, ytr)
    t = tree.tree_
    ids = itertools.count(0)

    def node(i: int, depth: int) -> dict:
        n = {"id": next(ids), "n": int(t.n_node_samples[i]), "value": float(t.value[i][0][0]), "sd": float(np.sqrt(max(t.impurity[i], 0))), "depth": depth}
        if t.children_left[i] != -1:
            key, lv = meta[t.feature[i]]
            f = next(ff for ff in features if ff["key"] == key)
            n["feature"] = key
            if lv is None:
                n["threshold"] = float(t.threshold[i])
            else:  # one-hot "key=lv" <= 0.5 goes left -> every other level goes left
                n["levels"] = [x for x in f["levels"] if x != lv]
            n["gain"] = float(t.impurity[i] * t.n_node_samples[i] - t.impurity[t.children_left[i]] * t.n_node_samples[t.children_left[i]] - t.impurity[t.children_right[i]] * t.n_node_samples[t.children_right[i]])
            n["left"] = node(t.children_left[i], depth + 1)
            n["right"] = node(t.children_right[i], depth + 1)
        return n

    root = node(0, 0)
    imp: dict[str, float] = {f["key"]: 0.0 for f in features}
    for (key, _), v in zip(meta, tree.feature_importances_):
        imp[key] += float(v)
    fid = {"r2": 0.0, "mae": 0.0, "rmse": 0.0, "n": 0}
    residuals = []
    if test:
        Xte, _ = _encode([r["input"] for r in test], features)
        yte = np.array([r["output"] for r in test])
        pred = tree.predict(Xte)
        ss = float(np.sum((yte - yte.mean()) ** 2)) or 1.0
        fid = {"r2": float(1 - np.sum((yte - pred) ** 2) / ss), "mae": float(np.mean(np.abs(yte - pred))), "rmse": float(np.sqrt(np.mean((yte - pred) ** 2))), "n": len(test)}
        residuals = [{"obsId": r["id"], "actual": float(a), "predicted": float(p)} for r, a, p in zip(test, yte, pred)]
    return {
        "version": version,
        "tree": root,
        "fidelity": fid,
        "importance": imp,
        "residuals": residuals,
        "trainedOn": len(train),
        "evaluatedOn": "test",
        "leaves": int(tree.get_n_leaves()),
        "depth": int(tree.get_depth()),
        "at": int(time.time() * 1000),
    }


def holdout_rmse(train: list[dict], test: list[dict], features: list[dict], seed: int) -> float | None:
    m = fit_surrogate(train, test, features, 0, seed)
    return m["fidelity"]["rmse"] if m and test else None
