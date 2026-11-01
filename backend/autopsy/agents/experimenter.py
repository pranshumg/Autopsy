"""ExperimenterAgent: designs counterfactual probes and sends them to the target.

A paired probe = same persona, ONE feature changed. Raw outputs go to the probes
table; only probe ids and designs are shared on the blackboard.

    measure_noise {set, k, reps}       repeated identical queries (noise floor)
    screen {set}                       phase 1: every feature, one change per persona
    holdout {set}                      realistic personas kept aside for validation
    probe {feature, n, focus?, cond?}  phase 2: active-learning follow-up on one feature
    interaction {a, b, n}              phase 3: 2x2 factorial for a suspected interaction
    confirm {key, feature, a, b, cond?} fresh matched personas (asks the Persona agent)
    random_probe {n}                   random baseline: random persona, random feature
"""

from __future__ import annotations

from typing import Any

from autopsy.agents.base import Agent
from autopsy.events import now_ms
from autopsy.probes import BudgetExhausted

SOURCE_KIND = {"noise": "replicate", "screen": "counterfactual", "holdout": "holdout", "active": "active", "confirm": "confirmation", "factorial": "factorial", "conditional": "sweep", "random": "active"}


class ExperimenterAgent(Agent):
    name = "experimenter"
    title = "Experimenter"

    # -- helpers ----------------------------------------------------------------
    def clean(self, p: dict) -> dict:
        return {f["key"]: p[f["key"]] for f in self.ctx.features}

    def pool(self) -> list[dict]:
        return self.mem.read_fact("personas:pool", []) or self.mem.read_fact("personas:base", [])

    def pairs(self) -> list[dict]:
        return self.mem.read_fact("pairs", [])

    def save_pairs(self, new: list[dict]):
        self.mem.write_fact("pairs", self.pairs() + new, self.name)

    def other_value(self, f: dict, current: Any, avoid_close: bool = True) -> Any:
        rng = self.ctx.py
        if f["kind"] == "categorical":
            return rng.choice([lv for lv in f["levels"] if lv != current])
        span = f["max"] - f["min"]
        for _ in range(50):
            v = rng.uniform(f["min"], f["max"])
            v = int(round(v)) if f.get("integer") else round(v, 4)
            if v != current and (not avoid_close or abs(v - float(current)) >= 0.1 * span):
                return v
        return f["max"] if float(current) < (f["min"] + f["max"]) / 2 else f["min"]

    def query(self, inputs: list[dict], source: str, exp_id: str, personas: list[str | None]) -> list[dict]:
        return self.ctx.client.query([self.clean(x) for x in inputs], source=source, experiment=exp_id, personas=personas)

    def affordable(self, per_unit: int, wanted: int) -> int:
        return max(0, min(wanted, self.ctx.client.remaining // per_unit))

    def emit_experiment(self, exp_id: str, source: str, title: str, design: str, features: list[str], rows: list[dict], pairs: list[dict] | None = None, cells: list[dict] | None = None, summary: str = ""):
        exp: dict[str, Any] = {
            "id": exp_id,
            "kind": SOURCE_KIND.get(source, "active"),
            "phase": {"noise": "recon", "holdout": "recon", "screen": "screening", "factorial": "interactions", "conditional": "interactions", "confirm": "structure"}.get(source, "active"),
            "title": title,
            "design": design,
            "features": features,
            "status": "done",
            "observationIds": [r["id"] for r in rows],
            "hypothesisIds": [],
            "createdAt": now_ms(),
            "completedAt": now_ms(),
            "agent": "experimenter",
            "result": {"summary": summary or f"{len(rows)} queries", "n": len(rows)},
        }
        if pairs:
            out = {r["id"]: r["output"] for r in rows}
            exp["pairs"] = [{"a": p["ia"], "b": p["ib"], "changed": [p["f"]], "delta": out.get(p["ib"], 0) - out.get(p["ia"], 0)} for p in pairs if p["ia"] in out and p["ib"] in out]
        if cells:
            exp["cells"] = cells
        self.ctx.emit.experiment(exp)

    # -- message handling -----------------------------------------------------
    def handle(self, msg):
        c = msg["content"]
        t = msg["type"]
        try:
            if t == "personas_ready":
                return self.on_personas(msg)
            if t == "measure_noise":
                return self.measure_noise(c)
            if t == "screen":
                return self.screen(c)
            if t == "holdout":
                return self.holdout(c)
            if t in ("probe", "more_evidence"):
                return self.probe(c, reply=("probe_data" if t == "probe" else "evidence_data"), requester=msg["from"])
            if t == "interaction":
                return self.interaction(c)
            if t == "confirm":
                return self.confirm_request(c)
            if t == "confirm_personas":
                return self.confirm_run(c)
            if t == "random_probe":
                return self.random_probe(c)
        except BudgetExhausted as e:
            self.post("statistician", "budget_exhausted", {}, reason=f"query budget spent ({e})")
            return "budget exhausted"
        return None

    def on_personas(self, msg):
        c = msg["content"]
        if c["set"] == "base":
            self.measure_noise({"set": "base"})
            self.screen({"set": "base"})
        elif c["set"] == "holdout":
            self.holdout({"set": "holdout"})
        return f"used persona set {c['set']}"

    def measure_noise(self, c):
        personas = self.mem.read_fact(f"personas:{c['set']}", [])
        k = min(3, len(personas))
        reps = self.affordable(k, c.get("reps", 6 if self.ctx.schema.get("stochastic") else 3))
        if reps < 2:
            raise BudgetExhausted("no budget for the noise floor")
        exp_id = self.ctx.new_experiment_id()
        groups, rows_all = [], []
        for p in personas[:k]:
            rows = self.query([p] * reps, "noise", exp_id, [p["_id"]] * reps)
            groups.append([r["id"] for r in rows])
            rows_all += rows
        self.emit_experiment(exp_id, "noise", "Noise floor", f"{k} personas × {reps} identical repeats", [], rows_all, summary="repeat identical queries to measure response noise")
        self.post("statistician", "noise_data", {"groups": groups, "experiment": exp_id}, reason=f"{k}×{reps} identical queries to measure noise")
        return f"{len(rows_all)} noise queries"

    def screen(self, c):
        personas = self.mem.read_fact(f"personas:{c['set']}", [])
        F = len(self.ctx.features)
        n = self.affordable(F + 1, len(personas))
        if n < 2:
            raise BudgetExhausted("no budget for screening")
        exp_id = self.ctx.new_experiment_id()
        new_pairs, rows_all = [], []
        for p in personas[:n]:
            variants = []
            for f in self.ctx.features:
                v = dict(p)
                v[f["key"]] = self.other_value(f, p[f["key"]])
                variants.append((f["key"], v))
            rows = self.query([p] + [v for _, v in variants], "screen", exp_id, [p["_id"]] * (F + 1))
            base = rows[0]
            for (key, v), r in zip(variants, rows[1:]):
                new_pairs.append({"f": key, "a": p[key], "b": v[key], "ia": base["id"], "ib": r["id"], "cond": None, "src": "screen"})
            rows_all += rows
        self.save_pairs(new_pairs)
        self.emit_experiment(exp_id, "screen", "Sensitivity screening", f"{n} personas; each feature changed alone once per persona (one-at-a-time counterfactuals)", [f["key"] for f in self.ctx.features], rows_all, pairs=new_pairs)
        self.post("statistician", "screen_data", {"experiment": exp_id, "pairs": len(new_pairs)}, reason=f"{len(new_pairs)} paired probes across {F} features")
        return f"{len(rows_all)} screening queries"

    def holdout(self, c):
        personas = self.mem.read_fact(f"personas:{c['set']}", [])
        n = self.affordable(1, len(personas))
        if n == 0:
            raise BudgetExhausted("no budget for holdout")
        exp_id = self.ctx.new_experiment_id()
        rows = self.query(personas[:n], "holdout", exp_id, [p["_id"] for p in personas[:n]])
        self.mem.write_fact("holdout_ids", [r["id"] for r in rows], self.name)
        self.emit_experiment(exp_id, "holdout", "Held-out realistic personas", f"{n} realistic personas, never used for fitting", [], rows, summary="sealed test set for the surrogate and the proxy check")
        self.post("statistician", "holdout_data", {"n": n}, reason=f"{n} held-out realistic personas")
        return f"{n} holdout queries"

    def probe(self, c, reply: str, requester: str):
        f = self.ctx.feature(c["feature"])
        n = self.affordable(2, c.get("n", 6))
        if n == 0:
            raise BudgetExhausted("no budget for follow-up probes")
        pool = self.pool()
        cond = c.get("cond") or None
        focus = c.get("focus")
        rng = self.ctx.py
        exp_id = self.ctx.new_experiment_id()
        inputs, ids, meta = [], [], []
        sweep = f["kind"] == "numeric" and c.get("sweep")
        for i in range(n):
            p = dict(rng.choice(pool))
            if cond:
                p.update(cond)
            if sweep:
                # sweep: one side anchored at the minimum, the other spread evenly over the range
                a = f["min"]
                b = f["min"] + (f["max"] - f["min"]) * (i + 1) / n
                if f.get("integer"):
                    b = int(round(b))
            elif f["kind"] == "numeric" and focus:
                lo, hi = focus["lo"], focus["hi"]
                w = max(1.0, (hi - lo))
                a = rng.uniform(max(f["min"], lo - w), (lo + hi) / 2)
                b = rng.uniform((lo + hi) / 2, min(f["max"], hi + w))
                if f.get("integer"):
                    a, b = int(round(a)), int(round(b))
                    if a == b:
                        b = min(f["max"], a + 1)
                if rng.random() < 0.5:
                    a, b = b, a
            elif f["kind"] == "categorical" and c.get("levels"):
                a = rng.choice(c["levels"])
                b = self.other_value(f, a)
            else:
                a = p[f["key"]]
                b = self.other_value(f, a)
            pa, pb = {**p, f["key"]: a}, {**p, f["key"]: b}
            inputs += [pa, pb]
            ids += [p["_id"], p["_id"]]
            meta.append((a, b))
        rows = self.query(inputs, "conditional" if cond else "active", exp_id, ids)
        new_pairs = [{"f": f["key"], "a": a, "b": b, "ia": rows[2 * i]["id"], "ib": rows[2 * i + 1]["id"], "cond": cond, "src": "conditional" if cond else "active"} for i, (a, b) in enumerate(meta)]
        self.save_pairs(new_pairs)
        where = f" with {', '.join(f'{k}={v}' for k, v in cond.items())}" if cond else ""
        design = f"{n} paired probes on {f['key']}{where}" + (f", straddling {focus['lo']:g}–{focus['hi']:g}" if focus else "")
        self.emit_experiment(exp_id, "conditional" if cond else "active", f"Follow-up: {f['label']}{where}", design, [f["key"]], rows, pairs=new_pairs)
        self.post("statistician", reply, {"feature": f["key"], "experiment": exp_id, "cond": cond}, reason=design)
        return design

    def interaction(self, c):
        A, B = c["a"], c["b"]
        n = self.affordable(4, c.get("n", 6))
        if n < 3:
            raise BudgetExhausted("no budget for an interaction test")
        pool = self.pool()
        exp_id = self.ctx.new_experiment_id()
        rows_all, cells_ids = [], []
        for _ in range(n):
            p = dict(self.ctx.py.choice(pool))
            combos = [(A["low"], B["low"]), (A["low"], B["high"]), (A["high"], B["low"]), (A["high"], B["high"])]
            inputs = [{**p, A["feature"]: va, B["feature"]: vb} for va, vb in combos]
            rows = self.query(inputs, "factorial", exp_id, [p["_id"]] * 4)
            cells_ids.append([r["id"] for r in rows])
            rows_all += rows
        facts = self.mem.read_fact("factorials", [])
        facts.append({"a": A, "b": B, "rows": cells_ids, "experiment": exp_id})
        self.mem.write_fact("factorials", facts, self.name)
        out = {r["id"]: r["output"] for r in rows_all}
        labels = [(f"{A['feature']}={A['low']}", f"{B['feature']}={B['low']}"), (f"{A['feature']}={A['low']}", f"{B['feature']}={B['high']}"), (f"{A['feature']}={A['high']}", f"{B['feature']}={B['low']}"), (f"{A['feature']}={A['high']}", f"{B['feature']}={B['high']}")]
        cells = [{"a": la, "b": lb, "mean": sum(out[r[j]] for r in cells_ids) / n, "n": n} for j, (la, lb) in enumerate(labels)]
        design = f"2×2 factorial: {A['feature']} {A['low']}/{A['high']} × {B['feature']} {B['low']}/{B['high']} on {n} personas"
        self.emit_experiment(exp_id, "factorial", f"Interaction: {A['feature']} × {B['feature']}", design, [A["feature"], B["feature"]], rows_all, cells=cells)
        self.post("statistician", "interaction_data", {"experiment": exp_id}, reason=design)
        return design

    def confirm_request(self, c):
        f = self.ctx.feature(c["feature"])
        # 8 pairs: the exact two-sided sign-flip test cannot go below p = 2/2^n, so n >= 6 is needed for p < 0.05
        n_each = min(8, self.ctx.client.remaining // 2)
        if n_each < 6:
            raise BudgetExhausted("no budget for confirmation")
        groups = [{"label": f"{f['key']}={c['a']}", "value": c["a"]}, {"label": f"{f['key']}={c['b']}", "value": c["b"]}]
        set_id = f"confirm_{c['key']}".replace(" ", "")
        self.post("persona", "make_matched", {"set": set_id, "feature": f["key"], "groups": groups, "n_each": n_each, "reply_type": "confirm_personas", "context": {"key": c["key"], "feature": f["key"], "cond": c.get("cond")}}, reason=f"need {n_each} fresh persona pairs differing only in {f['key']} to confirm '{c['key']}'")
        return f"asked persona agent for matched pairs on {f['key']}"

    def confirm_run(self, c):
        personas = self.mem.read_fact(f"personas:{c['set']}", [])
        cond = c.get("cond") or None
        if cond:
            personas = [{**p, **cond} for p in personas]
        n = self.affordable(2, len(personas) // 2)
        if n == 0:
            raise BudgetExhausted("no budget to run confirmation")
        personas = personas[: 2 * n]
        exp_id = self.ctx.new_experiment_id()
        rows = self.query(personas, "confirm", exp_id, [p.get("_base", p["_id"]) for p in personas])
        key = c["feature"]
        new_pairs = [{"f": key, "a": personas[2 * i][key], "b": personas[2 * i + 1][key], "ia": rows[2 * i]["id"], "ib": rows[2 * i + 1]["id"], "cond": cond, "src": "confirm", "rule": c["key"]} for i in range(n)]
        self.save_pairs(new_pairs)
        self.emit_experiment(exp_id, "confirm", f"Confirmation: {c['key']}", f"{n} fresh matched persona pairs (persona agent), only {key} differs", [key], rows, pairs=new_pairs)
        self.post("statistician", "confirm_data", {"key": c["key"], "feature": key, "experiment": exp_id}, reason=f"{n} fresh pairs to confirm '{c['key']}'")
        return f"{n} confirmation pairs"

    def random_probe(self, c):
        """Random baseline: uniformly random persona and feature for every pair."""
        n = self.affordable(2, c.get("n", 10))
        if n == 0:
            raise BudgetExhausted("no budget")
        pool = self.pool()
        exp_id = self.ctx.new_experiment_id()
        inputs, ids, meta = [], [], []
        for _ in range(n):
            p = dict(self.ctx.py.choice(pool))
            f = self.ctx.py.choice(self.ctx.features)
            a = p[f["key"]]
            b = self.other_value(f, a)
            inputs += [p, {**p, f["key"]: b}]
            ids += [p["_id"]] * 2
            meta.append((f["key"], a, b))
        rows = self.query(inputs, "random", exp_id, ids)
        new_pairs = [{"f": k, "a": a, "b": b, "ia": rows[2 * i]["id"], "ib": rows[2 * i + 1]["id"], "cond": None, "src": "random"} for i, (k, a, b) in enumerate(meta)]
        self.save_pairs(new_pairs)
        self.emit_experiment(exp_id, "random", "Random probes", f"{n} pairs, random persona and feature", sorted({m[0] for m in meta}), rows, pairs=new_pairs)
        self.post("statistician", "random_data", {"experiment": exp_id}, reason=f"{n} random paired probes")
        return f"{n} random pairs"
