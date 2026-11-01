"""StatisticianAgent (pure code, no LLM math).

Measures the noise floor; turns paired probes into effects with bootstrap CIs and
sign-flip permutation tests; applies Benjamini–Hochberg across all contrasts;
classifies shape (multiplicative / additive / threshold / linear); flags
heterogeneous effects and asks for interaction tests; runs active learning
(next probe = argmax CI width × P(effect ≠ 0)); runs DoWhy refuters and the proxy check.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np

from autopsy import causal, stats
from autopsy.agents.base import Agent
from autopsy.events import now_ms
from autopsy.surrogate import fit_surrogate


MAX_REFUTED = 10

def _q(q):
    """q-value with None meaning 'not tested' (1.0). Note q can legitimately be 0."""
    return 1.0 if q is None else q

FDR = 0.05
PROBE_BATCH = 6  # pairs per active-learning request


def cond_key(cond: dict | None) -> str:
    return json.dumps(cond, sort_keys=True) if cond else ""


class StatisticianAgent(Agent):
    name = "statistician"
    title = "Statistician"

    # ------------------------------------------------------------------ data
    def outputs(self) -> dict[int, dict]:
        return {r["id"]: r for r in self.ctx.store.all()}

    def noise(self) -> dict:
        return self.mem.read_fact("noise", {"sd": 0.0, "sd_log": 0.0})

    def noise_scale(self, scale: str) -> float:
        n = self.noise()
        out = self.ctx.schema["output"]
        if scale == "multiplicative":
            return max(n.get("sd_log", 0.0), 0.004)
        return max(n.get("sd", 0.0), 0.004 * (out["max"] - out["min"]))

    def pair_rows(self, rows: dict[int, dict], pairs: list[dict]) -> list[dict]:
        out = []
        for p in pairs:
            if p["ia"] in rows and p["ib"] in rows:
                out.append({**p, "ya": rows[p["ia"]]["output"], "yb": rows[p["ib"]]["output"], "persona": rows[p["ia"]]["input"]})
        return out

    # -------------------------------------------------------------- analysis
    def analyze(self, max_id: int | None = None) -> list[stats.Effect]:
        rows = self.outputs()
        pairs = self.pair_rows(rows, self.mem.read_fact("pairs", []))
        if max_id is not None:  # benchmark replay: only what was known after `max_id` queries
            pairs = [p for p in pairs if p["ia"] <= max_id and p["ib"] <= max_id]
        groups: dict[tuple[str, str], list[dict]] = {}
        for p in pairs:
            groups.setdefault((p["f"], cond_key(p.get("cond"))), []).append(p)
        sd = self.noise().get("sd", 0.0)
        effects: list[stats.Effect] = []
        for (fkey, ck), ps in groups.items():
            f = self.ctx.feature(fkey)
            cond = json.loads(ck) if ck else None
            if f["kind"] == "categorical":
                found = stats.categorical_effects(fkey, f["levels"], ps, sd, self.ctx.rng)
                if not found:
                    continue
                # heterogeneity on the residuals of the level model
                resid = self._level_residuals(found, ps)
            else:
                e = stats.numeric_effect(fkey, ps, sd, self.ctx.rng, noise_log=self.noise().get("sd_log", 0.0))
                found = [e]
                resid = np.array(e.extra.pop("resid", []))
            scale = found[0].scale
            if scale == "additive" and len(resid) == len(ps):
                # noise is proportional to the output level, so judge additive residuals relative to it
                resid = resid / np.array([max((p["ya"] + p["yb"]) / 2, 1e-9) for p in ps])
                scale = "multiplicative"
            if not cond and self.ctx.strategy == "active" and max_id is None:
                het = stats.heterogeneity(resid, [p["persona"] for p in ps], fkey, self.ctx.features, self.noise_scale(scale), self.ctx.rng)
                for e in found:
                    e.heterogeneity = het
            for e in found:
                e.extra.pop("resid", None)
                e.extra["cond"] = cond
                e.extra["confirm_n"] = sum(1 for p in ps if p.get("src") == "confirm")
            effects.extend(found)
        qs = stats.benjamini_hochberg([e.p for e in effects])
        for e, q in zip(effects, qs):
            e.q = q
        return effects

    def _level_residuals(self, effects: list[stats.Effect], ps: list[dict]) -> np.ndarray:
        scale = effects[0].scale
        beta = {e.level: (math.log(e.estimate) if scale == "multiplicative" else e.estimate) for e in effects}
        out = []
        for p in ps:
            y = math.log(max(p["yb"], 1e-9) / max(p["ya"], 1e-9)) if scale == "multiplicative" else p["yb"] - p["ya"]
            out.append(y - (beta.get(p["b"], 0.0) - beta.get(p["a"], 0.0)))
        return np.array(out)

    def ekey(self, e: stats.Effect) -> str:
        c = e.extra.get("cond")
        return e.key() + (" | " + ", ".join(f"{k}={v}" for k, v in c.items()) if c else "")

    def supported(self, e: stats.Effect) -> bool:
        return e.kind != "null" and e.q is not None and e.q < FDR and e.nonzero

    def save(self, effects: list[stats.Effect]):
        self.mem.write_fact("effects", {self.ekey(e): e.as_dict() for e in effects}, self.name)
        for e in effects:
            self.emit_hypothesis(e)

    # -------------------------------------------------------------- UI events
    def emit_hypothesis(self, e: stats.Effect):
        key = self.ekey(e)
        hid = "H-" + "".join(ch if ch.isalnum() else "-" for ch in key)[:60]
        mult = e.scale == "multiplicative"
        est = (e.estimate - 1) * 100 if mult else e.estimate
        ci = [(e.ci[0] - 1) * 100, (e.ci[1] - 1) * 100] if mult else list(e.ci)
        unit = "%" if mult else self.ctx.schema["output"]["unit"]
        if e.kind == "linear":
            unit = f"{unit} per {self.ctx.feature(e.feature).get('unit') or 'unit'}"
        status = "supported" if self.supported(e) else "rejected" if (e.kind == "null" or (not e.nonzero and e.n >= 12)) else "testing"
        if status == "testing" and getattr(self, "_final", False):
            status = "inconclusive"  # the run is over: undecided means inconclusive, not still testing
        conf = max(0.02, min(0.99, (1 - (e.q if e.q is not None else 1)) * (0.6 + 0.4 * min(1, e.n / 30))))
        h: dict[str, Any] = {
            "id": hid,
            "kind": {"level": "level", "threshold": "threshold", "linear": "linear", "null": "null"}[e.kind],
            "statement": self.describe(e),
            "features": [e.feature] + list((e.extra.get("cond") or {}).keys()),
            "status": status,
            "confidence": conf,
            "effect": {"estimate": est, "ci": ci, "unit": unit},
            "test": {"name": "sign-flip permutation (BH-adjusted q={:.3g})".format(e.q if e.q is not None else 1), "statistic": est, "p": e.p, "n": e.n},
            "evidence": {"supporting": [], "conflicting": []},
            "related": [],
            "competes": [],
            "history": [{"t": now_ms(), "status": status, "note": f"n={e.n}, CI [{ci[0]:.3g}, {ci[1]:.3g}] {unit}"}],
            "origin": "statistician",
            "createdAt": now_ms(),
            "updatedAt": now_ms(),
        }
        if e.level is not None:
            h["level"] = e.level
        if e.threshold:
            h["threshold"] = {k: e.threshold[k] for k in ("value", "lo", "hi", "direction")}
        self.ctx.emit.hypothesis(h)

    def describe(self, e: stats.Effect) -> str:
        f = self.ctx.feature(e.feature)
        unit = self.ctx.schema["output"]["unit"]
        cond = e.extra.get("cond")
        where = (" when " + " and ".join(f"{k}={v}" for k, v in cond.items())) if cond else ""
        if e.kind == "null":
            return f"No detectable effect of {f['label']}{where} (n={e.n})"
        size = f"×{e.estimate:.3f}" if e.scale == "multiplicative" else f"{e.estimate:+.2f} {unit}"
        if e.kind == "level":
            return f"{f['label']} = {e.level} vs {e.extra.get('reference')}: {size}{where}"
        if e.kind == "threshold":
            t = e.threshold
            return f"{f['label']} crossing {t['lo']:g}–{t['hi']:g}: {size}{where}"
        return f"{f['label']}: {size} per {f.get('unit') or 'unit'}{where}"

    # ------------------------------------------------------------- messages
    def handle(self, msg):
        t = msg["type"]
        if t == "noise_data":
            groups = msg["content"]["groups"]
            rows = self.outputs()
            nf = stats.noise_floor([[rows[i]["output"] for i in g] for g in groups])
            self.mem.write_fact("noise", nf, self.name)
            self.log(f"Noise floor: SD {nf['sd']:.3g} {self.ctx.schema['output']['unit']} ({nf['sd_log'] * 100:.2f}% relative) from {nf['n']} repeats", "ok")
            return f"noise sd={nf['sd']:.3g}"
        if t == "holdout_data":
            return "holdout recorded"
        if t == "interaction_data":
            self.analyze_interactions()
        if t == "confirm_data":
            self.check_confirmation(msg["content"]["key"])
        if t == "budget_exhausted":
            self.log("Budget spent: synthesising with the evidence collected so far", "warn")
            return self.finalize(reason="budget")
        effects = self.analyze()
        self.save(effects)
        self.refit_surrogate(final=False)
        if t == "evidence_data":
            return self.finalize(reason="evidence")
        return self.next_step(effects)

    # --------------------------------------------------------- interactions
    def interactions_upto(self, max_id: int) -> list[dict]:
        rows = self.outputs()
        out = []
        for fx in self.mem.read_fact("factorials", []):
            if any(i > max_id for r in fx["rows"] for i in r):
                continue
            cells = [[rows[i]["output"] for i in r] for r in fx["rows"]]
            res = stats.interaction_test(cells, self.ctx.rng)
            out.append({**res, "a": fx["a"], "b": fx["b"]})
        return out

    def analyze_interactions(self):
        rows = self.outputs()
        results = self.mem.read_fact("interactions", [])
        done = {r["experiment"] for r in results}
        for fx in self.mem.read_fact("factorials", []):
            if fx["experiment"] in done:
                continue
            cells = [[rows[i]["output"] for i in r] for r in fx["rows"]]
            res = stats.interaction_test(cells, self.ctx.rng)
            res.update({"a": fx["a"], "b": fx["b"], "experiment": fx["experiment"]})
            results.append(res)
            A, B = fx["a"], fx["b"]
            if not res["significant"] and min(res.get("additive_p", 1), res.get("multiplicative_p", 1)) < 0.05:
                self.log(f"{A['feature']} × {B['feature']}: interaction on one scale only (additive p={res.get('additive_p', 1):.3g}, multiplicative p={res.get('multiplicative_p', 1):.3g}), so it is explained by one additive and one multiplicative effect, not a real interaction")
            if res["significant"]:
                self.log(f"Interaction confirmed: {A['feature']} × {B['feature']} (joint effect ×{res['joint']:.3f}, interaction ×{res['estimate']:.3f}, p={res['p']:.3g})", "ok")
                queue = self.mem.read_fact("queue", [])
                # map each factor's structure inside the "on" condition of the other
                for X, Y in ((A, B), (B, A)):
                    fx_ = self.ctx.feature(X["feature"])
                    req = {"feature": X["feature"], "n": 12, "cond": {Y["feature"]: Y["high"]}}
                    if fx_["kind"] == "numeric":
                        req["sweep"] = True
                    queue.append({"type": "probe", "content": req, "reason": f"map {X['feature']} where {Y['feature']}={Y['high']} (interaction found)"})
                self.mem.write_fact("queue", queue, self.name)
            else:
                self.log(f"No interaction detected between {A['feature']} and {B['feature']} (p={res['p']:.3g})")
        self.mem.write_fact("interactions", results, self.name)

    def plan_interaction(self, e: stats.Effect, effects: list[stats.Effect]) -> dict | None:
        tested = set(self.mem.read_fact("interactions_tested", []))
        het, by = None, None
        for cand in (e.heterogeneity or {}).get("candidates", []):
            if "×".join(sorted([e.feature, cand["by"]])) not in tested:
                het, by = cand, cand["by"]
                break
        if not by:
            return None
        key = "×".join(sorted([e.feature, by]))
        fa, fb = self.ctx.feature(e.feature), self.ctx.feature(by)

        def levels_for(f: dict, split: str | None, own: list[stats.Effect]) -> tuple[Any, Any]:
            if f["kind"] == "numeric":
                return f["min"], f["max"]
            if split and " in " in split:
                group = json.loads(split.split(" in ", 1)[1].replace("'", '"'))
                low = next((lv for lv in f["levels"] if lv not in group), f["levels"][0])
                return low, group[0]
            if split and "=" in split:
                hi = split.split("=", 1)[1]
                low = next(lv for lv in f["levels"] if lv != hi)
                return low, hi
            if own:
                strongest = max(own, key=lambda x: abs(math.log(x.estimate)) if x.scale == "multiplicative" else abs(x.estimate))
                return strongest.extra.get("reference", f["levels"][0]), strongest.level
            return f["levels"][0], f["levels"][-1]

        lb, hb = levels_for(fb, het.get("split"), [])
        if fb["kind"] == "categorical":
            lb, hb = self.levels_by_magnitude(e.feature, by, (lb, hb))
        if fa["kind"] == "categorical":
            split = het.get("split") or ""
            thr = float(split.split(">", 1)[1]) if fb["kind"] == "numeric" and ">" in split else None
            la, ha = self.levels_where(e.feature, by, hb, thr)
        else:
            la, ha = levels_for(fa, None, [])
        tested.add(key)
        self.mem.write_fact("interactions_tested", sorted(tested), self.name)
        if len(tested) > 4:
            return None  # cap the number of interaction tests per run
        return {"a": {"feature": e.feature, "low": la, "high": ha}, "b": {"feature": by, "low": lb, "high": hb}, "n": 8, "_why": f"effect of {e.feature} varies with {het.get('split')} (η²={het.get('eta2', 0):.2f}, p={het.get('p', 1):.3g})"}

    def levels_by_magnitude(self, feature: str, by: str, default: tuple[Any, Any]) -> tuple[Any, Any]:
        """Level of `by` where changing `feature` matters most (high) and least (low), from the data."""
        rows = self.outputs()
        pairs = [p for p in self.pair_rows(rows, self.mem.read_fact("pairs", [])) if p["f"] == feature and not p.get("cond")]
        mags: dict[Any, list[float]] = {}
        for p in pairs:
            mags.setdefault(p["persona"][by], []).append(abs(math.log(max(p["yb"], 1e-9) / max(p["ya"], 1e-9))))
        means = {k: float(np.mean(v)) for k, v in mags.items() if v}
        if len(means) < 2:
            return default
        return min(means, key=means.get), max(means, key=means.get)

    def levels_where(self, feature: str, by: str, on_value: Any, thr: float | None = None) -> tuple[Any, Any]:
        """For a categorical feature: the level whose effect is largest where `by` is "on", and a baseline level."""
        f, fb = self.ctx.feature(feature), self.ctx.feature(by)
        rows = self.outputs()
        pairs = [p for p in self.pair_rows(rows, self.mem.read_fact("pairs", [])) if p["f"] == feature and not p.get("cond")]

        def on(v):
            if fb["kind"] == "numeric":
                return float(v) > (thr if thr is not None else (fb["min"] + fb["max"]) / 2)
            return v == on_value

        sums: dict[str, list[float]] = {lv: [] for lv in f["levels"]}
        for p in pairs:
            if not on(p["persona"][by]):
                continue
            y = math.log(max(p["yb"], 1e-9) / max(p["ya"], 1e-9))
            sums[p["b"]].append(y)
            sums[p["a"]].append(-y)
        means = {lv: float(np.mean(v)) for lv, v in sums.items() if v}
        if len(means) < 2:
            return f["levels"][0], f["levels"][-1]
        high = max(means, key=lambda lv: means[lv])
        low = min(means, key=lambda lv: abs(means[lv] - float(np.median(list(means.values())))) if lv != high else 1e9)
        return low, high

    # --------------------------------------------------------- confirmation
    def check_confirmation(self, key: str):
        rows = self.outputs()
        pairs = [p for p in self.pair_rows(rows, self.mem.read_fact("pairs", [])) if p.get("rule") == key]
        if not pairs:
            return
        mult = all(p["ya"] > 0 and p["yb"] > 0 for p in pairs)
        y = np.array([math.log(p["yb"] / p["ya"]) if mult else p["yb"] - p["ya"] for p in pairs])
        p = stats.sign_flip_p(y, self.ctx.rng)
        effects = self.mem.read_fact("effects", {})
        orig = effects.get(key, {})
        expected = (math.log(orig["estimate"]) if orig.get("scale") == "multiplicative" else orig.get("estimate", 0)) if orig else 0
        # each confirm pair is (a -> b) with b the "effect on" side, so the sign should match
        ok = bool(p < 0.05 and np.sign(y.mean()) == np.sign(expected or y.mean()))
        conf = self.mem.read_fact("confirmed", {})
        conf[key] = {"confirmed": ok, "p": p, "n": len(y)}
        self.mem.write_fact("confirmed", conf, self.name)
        self.log(f"{'Confirmed' if ok else 'Not confirmed'} on fresh matched personas: {key} (p={p:.3g}, n={len(y)})", "ok" if ok else "warn")

    # -------------------------------------------------- active-learning step
    def open_candidates(self, effects: list[stats.Effect]) -> list[tuple[float, stats.Effect, dict]]:
        """Score each still-open contrast: CI width (in noise units) × P(effect ≠ 0)."""
        out = []
        sig_inter = {f for r in self.mem.read_fact("interactions", []) if r.get("significant") for f in (r["a"]["feature"], r["b"]["feature"])}
        for e in effects:
            cond = e.extra.get("cond")
            if not cond and e.feature in sig_inter:
                continue  # its marginal effect is an average over an interaction; mapped conditionally instead
            width = e.width / self.noise_scale(e.scale)
            p_nonzero = 1 - min(1.0, e.p)
            decisive = e.nonzero and _q(e.q) < 0.01 and width < 4.0 and e.n >= 8
            needs_evidence = e.nonzero and _q(e.q) >= 0.05  # looks real, not yet reportable
            closed = e.n >= 36 or decisive or (width < 3.0 and not needs_evidence) or (not e.nonzero and width < 4.0 and e.n >= 10)
            thr_open = False
            if e.kind == "threshold" and e.threshold:
                f = self.ctx.feature(e.feature)
                gap = e.threshold["hi"] - e.threshold["lo"]
                thr_open = gap > (1 if f.get("integer") else 0.02 * (f["max"] - f["min"]))
                closed = closed and not thr_open
                if thr_open and e.n < 60:
                    closed = False
            if closed:
                continue
            score = width * max(p_nonzero, 0.05) + (5.0 if thr_open else 0.0)
            if e.nonzero and _q(e.q) >= 0.05:
                score *= 2.5  # looks real but not yet reportable after multiple-testing correction: needs probes
            req: dict[str, Any] = {"feature": e.feature, "n": PROBE_BATCH}
            if cond:
                req["cond"] = cond
            if e.kind == "threshold" and e.threshold:
                req["focus"] = {"lo": e.threshold["lo"], "hi": e.threshold["hi"]}
            if e.kind == "level":
                req["levels"] = [e.level, e.extra.get("reference")]
            out.append((score, e, req))
        out.sort(key=lambda x: -x[0])
        return out

    def next_step(self, effects: list[stats.Effect]) -> str:
        remaining = self.ctx.client.remaining
        if self.ctx.strategy == "random":
            if remaining >= 2:
                self.post("experimenter", "random_probe", {"n": min(10, remaining // 2)}, reason=f"random baseline, {remaining} queries left")
                return "random probe requested"
            return self.finalize(reason="budget")
        if not self.mem.read_fact("screened"):
            self.mem.write_fact("screened", True, self.name)
        # 1. queued follow-ups (e.g. mapping an interaction)
        queue = self.mem.read_fact("queue", [])
        if queue and remaining >= 12:
            item = queue.pop(0)
            self.mem.write_fact("queue", queue, self.name)
            self.post("experimenter", item["type"], item["content"], reason=item["reason"])
            return item["reason"]
        # 2. heterogeneous effects -> interaction tests
        if remaining >= 32:
            for e in sorted(effects, key=lambda x: ((x.heterogeneity or {}).get("p", 1), -(x.heterogeneity or {}).get("eta2", 0))):
                plan = self.plan_interaction(e, effects)
                if plan:
                    why = plan.pop("_why")
                    self.post("experimenter", "interaction", plan, reason=why)
                    return why
        # 3. active learning
        cands = self.open_candidates(effects)
        if cands and remaining >= 2 * PROBE_BATCH + 20:
            score, e, req = cands[0]
            reason = f"most informative next probe: {self.ekey(e)} (CI width × P(effect≠0) = {score:.2f})"
            self.post("experimenter", "probe", req, reason=reason)
            return reason
        # 4. confirm supported findings on fresh matched personas
        if remaining >= 16:
            requested = set(self.mem.read_fact("confirm_requested", []))
            for e in sorted(effects, key=lambda x: _q(x.q)):
                key = self.ekey(e)
                if not self.supported(e) or key in requested:
                    continue
                ab = self.confirm_values(e)
                if not ab:
                    continue
                requested.add(key)
                self.mem.write_fact("confirm_requested", sorted(requested), self.name)
                self.post("experimenter", "confirm", {"key": key, "feature": e.feature, "a": ab[0], "b": ab[1], "cond": e.extra.get("cond")}, reason=f"confirm '{key}' on fresh personas before reporting it")
                return f"confirm {key}"
        return self.finalize(reason="converged" if not cands else "budget")

    def confirm_values(self, e: stats.Effect) -> tuple[Any, Any] | None:
        f = self.ctx.feature(e.feature)
        if e.kind == "level":
            return e.extra.get("reference"), e.level
        if e.kind == "threshold" and e.threshold:
            lo, hi = e.threshold["lo"], e.threshold["hi"]
            return max(f["min"], lo), min(f["max"], hi)
        if e.kind == "linear":
            span = f["max"] - f["min"]
            a, b = f["min"] + 0.2 * span, f["max"] - 0.2 * span
            return (int(a), int(b)) if f.get("integer") else (a, b)
        return None

    # ---------------------------------------------------------------- finish
    def refit_surrogate(self, final: bool):
        rows = self.ctx.store.all()
        hold = set(self.mem.read_fact("holdout_ids", []))
        train = [r for r in rows if r["id"] not in hold]
        test = [r for r in rows if r["id"] in hold]
        v = self.mem.read_fact("_surrogate_v", 0) + 1
        self.mem.write_fact("_surrogate_v", v, self.name)
        m = fit_surrogate(train, test, self.ctx.features, v, self.ctx.seed)
        if m:
            self.ctx.emit.surrogate(m)
            if final:
                self.log(f"Surrogate decision tree: held-out R² {m['fidelity']['r2']:.3f} on {m['fidelity']['n']} realistic personas (depth {m['depth']}, {m['leaves']} leaves)", "ok")

    def refute_all(self, effects: list[stats.Effect]) -> dict[str, Any]:
        """DoWhy refuters for every supported finding."""
        out = self.mem.read_fact("refuters", {})
        if not self.ctx.use_dowhy:
            return out
        rows = self.outputs()
        pairs = self.pair_rows(rows, self.mem.read_fact("pairs", []))
        sig = {(e.feature, e.level) for e in effects if self.supported(e) and e.kind == "level"}
        # DoWhy is slow (3 refuters x 40 simulations each): check the strongest findings only, so a
        # target with many supported levels (e.g. credit) does not stall the run for minutes
        ranked = sorted((e for e in effects if self.supported(e)), key=lambda e: (_q(e.q), e.p if e.p is not None else 1.0))
        checked = {self.ekey(e) for e in ranked[:MAX_REFUTED]}
        for e in effects:
            key = self.ekey(e)
            if not self.supported(e) or key in out:
                continue
            if key not in checked:
                out[key] = [{"name": n, "passed": None, "detail": f"skipped: only the {MAX_REFUTED} strongest findings are refuted"} for n in ("placebo treatment", "random common cause", "data subset")]
                continue
            cond = e.extra.get("cond")
            ps = [p for p in pairs if p["f"] == e.feature and cond_key(p.get("cond")) == cond_key(cond)]
            data, T, Y = [], [], []
            mult = e.scale == "multiplicative"
            for p in ps:
                for side, val, y in (("a", p["a"], p["ya"]), ("b", p["b"], p["yb"])):
                    if e.kind == "level":
                        other = p["b"] if side == "a" else p["a"]
                        if val != e.level and (other != e.level):
                            continue
                        if val != e.level and (e.feature, val) in sig:
                            continue
                        t = 1 if val == e.level else 0
                    elif e.kind == "threshold":
                        if (float(p["a"]) > e.threshold["value"]) == (float(p["b"]) > e.threshold["value"]):
                            continue
                        t = 1 if float(val) > e.threshold["value"] else 0
                    else:
                        t = float(val)
                    row = {**p["persona"], e.feature: val}
                    data.append(row)
                    T.append(t)
                    Y.append(math.log(max(y, 1e-9)) if mult else y)
            covs = [f["key"] for f in self.ctx.features if f["key"] != e.feature and f["key"] not in (cond or {})]
            res = causal.refute(data, T, Y, covs, self.ctx.features, self.ctx.seed)
            out[key] = res["refuters"]
            passed = sum(1 for r in res["refuters"] if r["passed"])
            self.log(f"DoWhy refuters for {key}: {passed}/3 passed" + ("" if causal.HAVE_DOWHY else " (DoWhy missing: skipped)"), "ok" if passed == 3 else "warn")
        self.mem.write_fact("refuters", out, self.name)
        return out

    def proxy_checks(self, effects: list[stats.Effect]) -> list[dict]:
        """Does a categorical feature with real effects stand in for a numeric feature that has none?"""
        rows = self.ctx.store.all()
        hold = set(self.mem.read_fact("holdout_ids", []))
        # realistic personas only: the held-out set mirrors the real population
        # (screening personas follow a balanced design, which deliberately breaks real-world correlations)
        obs = [r for r in rows if r["id"] in hold]
        # one row per distinct persona (the noise floor repeats the same personas)
        uniq: dict[str, dict] = {}
        for r in obs:
            uniq.setdefault(json.dumps(r["input"], sort_keys=True), r)
        obs = list(uniq.values())
        in_inter = {f for r in self.mem.read_fact("interactions", []) if r.get("significant") for f in (r["a"]["feature"], r["b"]["feature"])}
        results = []
        for fx in self.ctx.features:
            if fx["kind"] != "numeric" or fx["key"] in in_inter:
                continue
            direct = next((e for e in effects if e.feature == fx["key"] and not e.extra.get("cond")), None)
            if not direct or direct.kind != "null":
                continue
            for fc in self.ctx.features:
                if fc["kind"] != "categorical" or fc["key"] in in_inter:
                    continue
                lv = [e.level for e in effects if e.feature == fc["key"] and self.supported(e) and not e.extra.get("cond") and e.estimate > (1 if e.scale == "multiplicative" else 0)]
                if not lv:
                    continue
                res = causal.proxy_check([r["input"] for r in obs], [r["output"] for r in obs], fx["key"], fc["key"], lv, direct.as_dict(), self.ctx.seed)
                if res and abs(res["corr"]) > 0.3 and res["corr_p"] < 0.001:
                    results.append(res)
                    if res["is_proxy"]:
                        self.log(f"Proxy check: {fc['key']} ∈ {lv} acts as a proxy for {fx['key']} (corr {res['corr']:.2f}; {fx['key']} has no direct effect, yet higher-{fx['key']} people pay ×{res['naive_x_effect']:.3f} per {res['unit']:,} in the realistic population)", "warn")
        self.mem.write_fact("proxies", results, self.name)
        return results

    def finalize(self, reason: str) -> str:
        self._final = True
        effects = self.analyze()
        self.save(effects)
        refuters = self.refute_all(effects)
        proxies = self.proxy_checks(effects)
        self.refit_surrogate(final=True)
        findings = {
            "effects": {self.ekey(e): e.as_dict() for e in effects},
            "supported": [self.ekey(e) for e in effects if self.supported(e)],
            "refuters": refuters,
            "interactions": self.mem.read_fact("interactions", []),
            "confirmed": self.mem.read_fact("confirmed", {}),
            "proxies": proxies,
            "noise": self.noise(),
            "reason": reason,
        }
        self.mem.write_fact("findings", findings, self.name)
        self.post("reporter", "analysis_complete", {"supported": len(findings["supported"]), "reason": reason}, reason=f"{len(findings['supported'])} supported effects after BH correction ({reason})")
        return "analysis complete"
