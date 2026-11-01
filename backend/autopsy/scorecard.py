"""Post-run evaluation against the target's ground truth.

This module is the ONLY engine code that sees ground truth, and only via the
target's /reveal endpoint after a run has finished. Agents never import it.
"""

from __future__ import annotations

from typing import Any

import httpx

from autopsy import config


def _q(q):
    """q-value with None meaning 'not tested' (1.0). Note q can legitimately be 0."""
    return 1.0 if q is None else q

FDR = 0.05


def fetch_truth(target_id: str) -> dict[str, Any]:
    r = httpx.get(f"{config.TARGETS_URL}/{target_id}/reveal", timeout=60)
    r.raise_for_status()
    return r.json()


def items_from_effects(effects: dict[str, dict], interactions: list[dict]) -> list[dict]:
    """Discovered findings in a comparable form: {features, levels?, threshold?, null?}."""
    sig_inter = [i for i in interactions if i.get("significant")]
    in_inter = {f for i in sig_inter for f in (i["a"]["feature"], i["b"]["feature"])}
    items: dict[str, dict] = {}
    nulls = []
    for e in effects.values():
        if e.get("cond"):
            continue
        f = e["feature"]
        null_v = 1.0 if e["scale"] == "multiplicative" else 0.0
        sig = e["kind"] != "null" and _q(e.get("q")) < FDR and not (e["ci"][0] <= null_v <= e["ci"][1])
        if e["kind"] == "null":
            nulls.append({"features": [f], "null": True})
            continue
        if not sig or f in in_inter:
            continue
        it = items.setdefault(f, {"features": [f], "levels": [], "kind": e["kind"]})
        if e["kind"] == "level":
            it["levels"].append(e["level"])
        if e["kind"] == "threshold":
            it["threshold"] = [e["threshold"]["lo"], e["threshold"]["hi"]]
    out = list(items.values())
    for i in sig_inter:
        out.append({"features": sorted([i["a"]["feature"], i["b"]["feature"]]), "kind": "interaction"})
    return out + nulls


def score(truth: dict[str, Any], items: list[dict]) -> dict[str, Any]:
    found_items = [it for it in items if not it.get("null")]
    used: set[int] = set()
    rules = []
    for t in truth["rules"]:
        tf = set(t["features"])
        verdict, match = "missed", None
        importance_only = "importance" in t  # learned model: truth is "this feature matters"
        for j, it in enumerate(found_items):
            if importance_only and tf <= set(it["features"]):
                verdict, match = "recovered", j
                break
            if set(it["features"]) != tf:
                continue
            verdict, match = "partial", j
            ok = True
            if t.get("levels") and len(tf) == 1:
                ok = sorted(it.get("levels", [])) == sorted(t["levels"])
            if t.get("threshold") is not None and len(tf) == 1:
                th = it.get("threshold")
                ok = bool(th) and th[0] - 1 <= t["threshold"] <= th[1] + 1
            if ok:
                verdict = "recovered"
                break
        if match is not None:
            used.add(match)
        rules.append({"id": t["id"], "text": t["text"], "features": t["features"], "verdict": verdict})
    truth_feats = {f for t in truth["rules"] for f in t["features"]}
    false_pos = [it for j, it in enumerate(found_items) if j not in used and not (it.get("kind") == "interaction" and set(it["features"]) <= truth_feats and all("importance" in t for t in truth["rules"]))]
    decoys = []
    for d in truth.get("decoys", []):
        claimed = any(set(d["features"]) & set(it["features"]) for it in false_pos)
        decoys.append({"id": d["id"], "text": d["text"], "features": d["features"], "fooled": claimed})
    return {
        "rules": rules,
        "found": sum(r["verdict"] == "recovered" for r in rules),
        "partial": sum(r["verdict"] == "partial" for r in rules),
        "total": len(rules),
        "falsePositives": [{"features": it["features"], "levels": it.get("levels") or None} for it in false_pos],
        "decoys": decoys,
    }
