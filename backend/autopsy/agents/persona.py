"""PersonaAgent: builds realistic, diverse base personas from the input schema.

Uses the LLM when available (it knows, e.g., that wealthy neighbourhoods have
high incomes); every persona is validated against the schema, and a seeded
sampler fills any gap so runs never depend on the model behaving.

Requests it answers:
    make_personas {set, n, purpose, constraints?}
    make_matched  {set, feature, groups: [{label, value}], n_each, reply_type, context}
        -> "10 personas aged 55+ and 10 under 30, otherwise identical"
"""

from __future__ import annotations

import json
import math
from typing import Any

from autopsy.agents.base import Agent


class PersonaAgent(Agent):
    name = "persona"
    title = "Persona"

    def handle(self, msg):
        c = msg["content"]
        if msg["type"] == "make_personas":
            personas, via = self.generate(c["n"], c.get("constraints", ""), c.get("purpose", "base"))
            self.mem.write_fact(f"personas:{c['set']}", personas, self.name)
            self.post(c.get("reply_to", msg["from"]), c.get("reply_type", "personas_ready"), {"set": c["set"], "n": len(personas), **c.get("context", {})}, reason=f"{len(personas)} {c.get('purpose', 'base')} personas ready ({via})")
            return f"{len(personas)} personas via {via}"
        if msg["type"] == "make_matched":
            personas = self.matched(c["feature"], c["groups"], c["n_each"])
            self.mem.write_fact(f"personas:{c['set']}", personas, self.name)
            labels = " and ".join(f"{c['n_each']} {g['label']}" for g in c["groups"])
            self.post(msg["from"], c.get("reply_type", "personas_ready"), {"set": c["set"], "n": len(personas), **c.get("context", {})}, reason=f"{labels}, otherwise identical")
            return f"{len(personas)} matched personas"
        return None

    # -- generation -----------------------------------------------------------
    def generate(self, n: int, constraints: str, purpose: str) -> tuple[list[dict], str]:
        out: list[dict] = []
        via = "seeded sampler"
        if self.ctx.llm.check():
            raw = self.ctx.llm.json(
                "You create realistic, diverse customer personas for testing an API. Reply with JSON only: "
                '{"personas": [ {<field>: <value>, ...}, ... ]}. Use only the allowed values and ranges. Make them varied and plausible.',
                json.dumps(
                    {
                        "count": n,
                        "fields": [{k: v for k, v in f.items() if k in ("key", "kind", "min", "max", "levels", "description")} for f in self.ctx.features],
                        "context": self.ctx.schema.get("context", {}),
                        "constraints": constraints or "diverse, realistic mix",
                    }
                ),
                seed=self.ctx.seed,
            )
            items = raw.get("personas", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []
            for item in items[:n]:
                p = self.validate(item)
                if p:
                    out.append(p)
            if out:
                via = f"LLM {self.ctx.llm.model}" + (f" + sampler for {n - len(out)}" if len(out) < n else "")
                self.log(f"LLM wrote {len(out)}/{n} valid personas")
        if purpose == "base" and len(out) < n:
            out += self.balanced(n - len(out))
        while len(out) < n:
            out.append(self.sample())
        for i, p in enumerate(out):
            p["_id"] = f"{purpose[:2]}{self.ctx.py.randrange(16**6):06x}{i}"
        return out, via

    def validate(self, item: Any) -> dict | None:
        if not isinstance(item, dict):
            return None
        p: dict[str, Any] = {}
        for f in self.ctx.features:
            v = item.get(f["key"])
            if f["kind"] == "categorical":
                if str(v) not in f["levels"]:
                    return None
                p[f["key"]] = str(v)
            else:
                try:
                    x = float(v)
                except (TypeError, ValueError):
                    return None
                if not math.isfinite(x):
                    return None
                x = min(max(x, f["min"]), f["max"])
                p[f["key"]] = int(round(x)) if f.get("integer") else x
        return self.make_consistent(p)

    def sample(self) -> dict:
        """Seeded realistic sampler: uses public context (e.g. postcode census) when the schema provides it."""
        rng = self.ctx.py
        p: dict[str, Any] = {}
        for f in self.ctx.features:
            if f["kind"] == "categorical":
                p[f["key"]] = rng.choice(f["levels"])
            else:
                x = rng.uniform(f["min"], f["max"])
                p[f["key"]] = int(round(x)) if f.get("integer") else round(x, 4)
        ctx = self.ctx.schema.get("context", {})
        if "postcodes" in ctx and "postcode" in p:
            info = ctx["postcodes"][p["postcode"]]
            if "income" in p:
                f = self.ctx.feature("income")
                inc = info["median_income"] * math.exp(rng.gauss(0, 0.35))
                p["income"] = int(min(max(inc, f["min"]), f["max"]))
        return self.make_consistent(p)

    def balanced(self, n: int) -> list[dict]:
        """Space-filling design for screening: every categorical level appears about equally often
        and numeric values are stratified (Latin hypercube), so rare combinations get covered."""
        rng = self.ctx.py
        cols: dict[str, list] = {}
        for f in self.ctx.features:
            if f["kind"] == "categorical":
                lv = (f["levels"] * (n // len(f["levels"]) + 1))[:n]
                rng.shuffle(lv)
                cols[f["key"]] = lv
            else:
                vals = [f["min"] + (f["max"] - f["min"]) * (i + rng.random()) / n for i in range(n)]
                rng.shuffle(vals)
                cols[f["key"]] = [int(round(v)) if f.get("integer") else round(v, 4) for v in vals]
        return [self.make_consistent({k: cols[k][i] for k in cols}) for i in range(n)]

    def make_consistent(self, p: dict) -> dict:
        """Real-world consistency, e.g. a postcode belongs to exactly one city."""
        ctx = self.ctx.schema.get("context", {})
        if "postcodes" in ctx and "postcode" in p and "city" in p:
            p["city"] = ctx["postcodes"][p["postcode"]]["city"]
        return p

    def matched(self, feature: str, groups: list[dict], n_each: int) -> list[dict]:
        """Identical personas except for one feature (one copy per group value)."""
        base, _ = self.generate(n_each, "", "matched")
        out = []
        for b in base:
            for g in groups:
                p = {**b, feature: g["value"], "_id": f"{b['_id']}:{g['label']}", "_base": b["_id"]}
                out.append(p)
        return out
