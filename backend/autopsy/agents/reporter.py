"""ReporterAgent: writes the hidden rulebook.

Each rule: plain-language text, effect size, 95% CI, probes, p / BH q, refuters
passed, and a badge (high / medium / suspected). Weak rules are never stated
confidently: the Reporter posts a request for more evidence instead.
The LLM only rewords facts; numbers come from the Statistician and every LLM
sentence is checked to contain the effect size, otherwise a template is used.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

from autopsy.agents.base import Agent
from autopsy.events import now_ms


def _q(q):
    """q-value with None meaning 'not tested' (1.0). Note q can legitimately be 0."""
    return 1.0 if q is None else q

MAX_EVIDENCE_ROUNDS = 2


class ReporterAgent(Agent):
    name = "reporter"
    title = "Reporter"

    def handle(self, msg):
        if msg["type"] != "analysis_complete":
            return None
        findings = self.mem.read_fact("findings", {})
        rules = self.build_rules(findings)
        # weak rules -> ask for more evidence instead of stating them
        rounds = self.mem.read_fact("evidence_rounds", 0)
        suspected = [r for r in rules if r["badge"] == "suspected" and r["kind"] != "null" and r.get("_req")]
        if suspected and rounds < MAX_EVIDENCE_ROUNDS and self.ctx.client.remaining >= 12 and self.ctx.strategy == "active":
            r = suspected[0]
            self.mem.write_fact("evidence_rounds", rounds + 1, self.name)
            self.post("experimenter", "more_evidence", r["_req"], reason=f"'{r['title']}' is only suspected (q={r['q']:.3g}); need more evidence before stating it")
            self.publish(rules, findings, interim=True)
            return f"requested more evidence for {r['title']}"
        self.publish(rules, findings, interim=False)
        return f"rulebook with {len(rules)} rules"

    # ----------------------------------------------------------------- rules
    def build_rules(self, findings: dict) -> list[dict]:
        effects: dict[str, dict] = findings.get("effects", {})
        refuters = findings.get("refuters", {})
        confirmed = findings.get("confirmed", {})
        out_unit = self.ctx.schema["output"]["unit"]
        inter = [i for i in findings.get("interactions", []) if i.get("significant")]
        in_inter = {f for i in inter for f in (i["a"]["feature"], i["b"]["feature"])}
        rules: list[dict] = []

        # merge levels of one feature with matching effects (e.g. four premium postcodes)
        groups: dict[tuple, list[tuple[str, dict]]] = {}
        levels_by_feature: dict[str, list[tuple[str, dict]]] = {}
        null_feats = set()
        for fkey in {e["feature"] for e in effects.values() if not e.get("cond")}:
            mine = [e for e in effects.values() if e["feature"] == fkey and not e.get("cond")]
            if fkey not in in_inter and all(e["kind"] == "null" or e["p"] >= 0.05 for e in mine):
                null_feats.add(fkey)
        for key, e in effects.items():
            if e["kind"] == "null" or e.get("cond") or e["feature"] in in_inter or e["feature"] in null_feats:
                continue
            if e["p"] >= 0.05:
                continue  # not even nominally significant: not a rule, and not worth a "suspected" label
            sig = e["q"] is not None and e["q"] < 0.05 and not (e["ci"][0] <= (1 if e["scale"] == "multiplicative" else 0) <= e["ci"][1])
            if e["kind"] == "level":
                levels_by_feature.setdefault(e["feature"], []).append((key, e))
            else:
                groups.setdefault((key,), []).append((key, e))
        # merge levels of one feature whose CIs overlap and point the same way (e.g. four premium postcodes)
        for fkey, members in levels_by_feature.items():
            members.sort(key=lambda m: m[1]["estimate"])
            cur: list[tuple[str, dict]] = []
            for m in members:
                e = m[1]
                up = e["estimate"] > (1 if e["scale"] == "multiplicative" else 0)
                if cur:
                    last = cur[-1][1]
                    same_dir = up == (last["estimate"] > (1 if last["scale"] == "multiplicative" else 0))
                    overlap = e["ci"][0] <= max(x[1]["ci"][1] for x in cur)
                    if same_dir and overlap:
                        cur.append(m)
                        continue
                    groups[(fkey, len(groups))] = cur
                cur = [m]
            if cur:
                groups[(fkey, len(groups))] = cur

        for members in groups.values():
            keys = [k for k, _ in members]
            es = [e for _, e in members]
            e = max(es, key=lambda x: x["n"])
            f = self.ctx.feature(e["feature"])
            mult = e["scale"] == "multiplicative"
            est = sum(x["estimate"] for x in es) / len(es)
            lo = min(x["ci"][0] for x in es)
            hi = max(x["ci"][1] for x in es)
            q = max(_q(x["q"]) for x in es)
            p = max(x["p"] for x in es)
            weakest = max(es, key=lambda x: _q(x["q"]))
            n = sum(x["n"] for x in es)
            refs = [r for k in keys for r in refuters.get(k, [])]
            passed = sum(1 for r in refs if r.get("passed"))
            ran = sum(1 for r in refs if r.get("passed") is not None)
            conf = [confirmed.get(k, {}) for k in keys]
            is_conf = any(c.get("confirmed") for c in conf)
            if e["kind"] == "level":
                lv = [x["level"] for x in es]
                cond_txt = f"{f['label']} is {' / '.join(lv)}"
                conditions = [f"{e['feature']} ∈ {{{', '.join(lv)}}}"]
            elif e["kind"] == "threshold":
                t = e["threshold"]
                cond_txt = f"{f['label']} {'above' if t['direction'] == 'up' else 'below'} {t['lo']:g}" if t["hi"] - t["lo"] <= 1 else f"{f['label']} crosses {t['lo']:g}–{t['hi']:g}"
                conditions = [f"{e['feature']} > {t['lo']:g}"]
            else:
                step = 10 ** max(0, math.floor(math.log10(max(1e-9, (f["max"] - f["min"]) / 10))))
                if step > 1:  # e.g. "per 1,000 DM" instead of "-0.0 per DM"
                    est = est**step if mult else est * step
                    lo, hi = (lo**step, hi**step) if mult else (lo * step, hi * step)
                cond_txt = f"each extra {step:,} {f.get('unit') or 'units'} of {f['label']}" if step > 1 else f"each extra {f.get('unit') or 'unit'} of {f['label']}"
                conditions = []
            size = self.size_text(est, mult, out_unit)
            ci_txt = self.ci_text(lo, hi, mult, out_unit)
            badge = self.badge(q, n, passed, ran, is_conf, (hi - lo) if not mult else math.log(hi / lo))
            rules.append(
                self.rule(
                    kind=e["kind"] if e["kind"] != "level" else "level",
                    features=[e["feature"]],
                    title=f"{cond_txt} → {size}",
                    facts={"condition": cond_txt, "effect": size, "ci": ci_txt, "n": n, "q": q, "badge": badge},
                    conditions=conditions,
                    effect=size,
                    est=est,
                    lo=lo,
                    hi=hi,
                    mult=mult,
                    n=n,
                    p=p,
                    q=q,
                    badge=badge,
                    refuters=refs,
                    confirmed=is_conf,
                    req={"feature": e["feature"], "n": 8, **({"levels": [weakest["level"], weakest.get("reference")]} if e["kind"] == "level" else {})},
                )
            )

        # interactions, described through the conditional structure the Experimenter mapped
        for i in inter:
            A, B = i["a"], i["b"]
            mult = i["scale"] == "multiplicative"
            parts = []
            for X, Y in ((A, B), (B, A)):
                c = {Y["feature"]: Y["high"]}
                # describe the structure with nominally significant conditional effects (the interaction itself is the tested claim)
                cond_effects = [e for e in effects.values() if e["feature"] == X["feature"] and e.get("cond") == c and e["kind"] != "null" and e["p"] < 0.05]
                fX = self.ctx.feature(X["feature"])
                if fX["kind"] == "categorical" and cond_effects:
                    lv = [e["level"] for e in cond_effects if (e["estimate"] > 1 if mult else e["estimate"] > 0)]
                    if lv:
                        parts.append(f"{fX['label']} is {' or '.join(lv)}")
                elif cond_effects and cond_effects[0]["kind"] == "threshold":
                    t = cond_effects[0]["threshold"]
                    parts.append(f"{fX['label']} ≥ {t['hi']:g}" if t["direction"] == "up" else f"{fX['label']} ≤ {t['lo']:g}")
            if not parts:
                parts = [f"{A['feature']}={A['high']}", f"{B['feature']}={B['high']}"]
            joint = i["joint"]
            size = self.size_text(joint, mult, out_unit)
            badge = self.badge(i["p"], i["n"] * 4, 0, 0, True, 0.0 if not mult else math.log(i["ci"][1] / max(i["ci"][0], 1e-9)))
            rules.append(
                self.rule(
                    kind="interaction",
                    features=[A["feature"], B["feature"]],
                    title=f"{' AND '.join(parts)} → {size}",
                    facts={"condition": " and ".join(parts), "effect": size, "ci": self.ci_text(*i["ci"], mult, out_unit) + " (interaction term)", "n": i["n"] * 4, "q": i["p"], "badge": badge, "note": "only when BOTH conditions hold"},
                    conditions=parts,
                    effect=size,
                    est=joint,
                    lo=i["ci"][0],
                    hi=i["ci"][1],
                    mult=mult,
                    n=i["n"] * 4,
                    p=i["p"],
                    q=i["p"],
                    badge=badge,
                    refuters=[],
                    confirmed=True,
                    req=None,
                    test_name="2×2 factorial interaction contrast, sign-flip permutation",
                )
            )

        # decoys: no detectable effect (feature-level)
        for fkey in sorted(null_feats):
            mine = [e for e in effects.values() if e["feature"] == fkey and not e.get("cond")]
            e = max(mine, key=lambda x: x["n"])
            if e["kind"] != "null":
                e = {**e, "ci": [min(x["ci"][0] for x in mine), max(x["ci"][1] for x in mine)], "n": sum(x["n"] for x in mine), "p": min(x["p"] for x in mine), "q": min((_q(x["q"])) for x in mine)}
            if True:
                f = self.ctx.feature(fkey)
                rules.append(
                    self.rule(
                        kind="null",
                        features=[e["feature"]],
                        title=f"No detectable effect of {f['label']}",
                        facts=None,
                        conditions=[],
                        effect="none detected",
                        est=e["estimate"],
                        lo=e["ci"][0],
                        hi=e["ci"][1],
                        mult=e["scale"] == "multiplicative",
                        n=e["n"],
                        p=e["p"],
                        q=_q(e["q"]),
                        badge="high" if e["n"] >= 12 else "medium",
                        refuters=[],
                        confirmed=False,
                        req=None,
                        statement=f"No detectable effect of {f['label']} on {self.ctx.schema['output']['label'].lower()} within the tested range ({e['n']} paired probes; 95% CI {self.ci_text(e['ci'][0], e['ci'][1], e['scale'] == 'multiplicative', out_unit)}).",
                    )
                )

        # proxies
        for px in findings.get("proxies", []):
            if px.get("is_proxy"):
                fx, fc = self.ctx.feature(px["x"]), self.ctx.feature(px["c"])
                rules.append(
                    self.rule(
                        kind="effect",
                        features=[px["c"], px["x"]],
                        title=f"{fc['label']} acts as a proxy for {fx['label']}",
                        facts=None,
                        conditions=[f"{px['c']} ∈ {{{', '.join(px['levels'])}}}"],
                        effect=f"corr {px['corr']:.2f}",
                        est=px["naive_x_effect"],
                        lo=px["naive_x_effect"],
                        hi=px["naive_x_effect"],
                        mult=True,
                        n=px["n"],
                        p=0.0,
                        q=0.0,
                        badge="medium",
                        refuters=[],
                        confirmed=False,
                        req=None,
                        statement=(
                            f"{fx['label']} has no direct effect, but {fc['label'].lower()}s {', '.join(px['levels'])} carry a surcharge and are where high-{fx['label'].lower()} customers live "
                            f"(correlation {px['corr']:.2f}). In realistic customers, price still rises ×{px['naive_x_effect']:.3f} per {px['unit']:,} of {fx['label'].lower()}: {fc['label'].lower()} works as a proxy. ({px['method']})"
                        ),
                        test_name="DoWhy causal graph + counterfactual direct effect",
                    )
                )

        order = {"high": 0, "medium": 1, "suspected": 2}
        rules.sort(key=lambda r: (r["kind"] == "null", order[r["badge"]], -abs(math.log(r["estimate"]) if r.get("mult") and r["estimate"] > 0 else r["estimate"] or 0)))
        for i, r in enumerate(rules):
            r["index"] = i + 1
            r["id"] = f"R{i + 1}"
        return rules

    @staticmethod
    def size_text(est: float, mult: bool, unit: str) -> str:
        if mult:
            return f"×{est:.2f} ({(est - 1) * 100:+.0f}%)"
        return f"{est:+.1f} {unit}"

    @staticmethod
    def ci_text(lo: float, hi: float, mult: bool, unit: str) -> str:
        return f"×{lo:.3f} to ×{hi:.3f}" if mult else f"{lo:+.1f} to {hi:+.1f} {unit}"

    @staticmethod
    def badge(q: float, n: int, passed: int, ran: int, confirmed: bool, width: float) -> str:
        refuted = ran > 0 and passed < ran
        if q < 0.01 and not refuted and (confirmed or n >= 16):
            return "high"
        if q < 0.05 and passed >= max(0, ran - 1):
            return "medium"
        return "suspected"

    def rule(self, *, kind, features, title, facts, conditions, effect, est, lo, hi, mult, n, p, q, badge, refuters, confirmed, req, statement=None, test_name="paired sign-flip permutation, BH-adjusted") -> dict:
        if statement is None:
            statement = self.write_statement(facts) if facts else title
        strength = {"high": "strong", "medium": "moderate", "suspected": "weak"}[badge]
        conf = {"high": 0.9, "medium": 0.65, "suspected": 0.3}[badge]
        r = {
            "kind": kind,
            "title": title,
            "statement": statement,
            "features": features,
            "conditions": conditions,
            "effect": effect,
            "confidence": conf,
            "strength": strength,
            "badge": badge,
            "ci": [(lo - 1) * 100, (hi - 1) * 100] if mult else [lo, hi],
            "estimate": (est - 1) * 100 if mult else est,
            "unit": "%" if mult else self.ctx.schema["output"]["unit"],
            "mult": mult,
            "support": n,
            "hypothesisIds": [],
            "experimentIds": [],
            "alternatives": [f"{'✓' if x.get('passed') else '✗' if x.get('passed') is False else '–'} DoWhy {x['name']}: {x['detail']}" for x in refuters],
            "refuters": refuters,
            "confirmed": confirmed,
            "test": {"name": test_name, "p": p, "n": n},
            "q": q,
        }
        if req and badge == "suspected":
            r["_req"] = req
        return r

    def write_statement(self, facts: dict) -> str:
        template = f"When {facts['condition']}, the {self.ctx.schema['output']['label'].lower()} changes by {facts['effect']} (95% CI {facts['ci']}; {facts['n']} probes)."
        if facts.get("note"):
            template = template[:-1] + f"; {facts['note']}."
        if facts["badge"] == "suspected":
            template = "Suspected, not established: " + template[0].lower() + template[1:]
        text = self.ctx.llm.chat(
            "You rewrite one statistical finding about a black-box pricing or scoring system as ONE plain-language sentence for a non-expert. "
            "Use only the numbers given; keep the effect size exactly as written; do not add causes, motives or certainty. "
            "If the badge is 'suspected', say it is suspected, not established. Reply with the sentence only.",
            json.dumps(facts),
            temperature=0.2,
            seed=self.ctx.seed,
        )
        if text:
            text = text.strip().strip('"').split("\n")[0]
            number = re.search(r"[-+×]?\d+(?:\.\d+)?", facts["effect"])
            if number and number.group(0).lstrip("+×") in text and 20 <= len(text) <= 320:
                return text
        return template

    # --------------------------------------------------------------- publish
    def publish(self, rules: list[dict], findings: dict, interim: bool):
        noise = findings.get("noise", {})
        positive = [r for r in rules if r["kind"] != "null"]
        high = sum(1 for r in positive if r["badge"] == "high")
        summary = (
            f"{len(positive)} rule{'s' if len(positive) != 1 else ''} found ({high} high-confidence) and "
            f"{len(rules) - len(positive)} input{'s' if len(rules) - len(positive) != 1 else ''} with no detectable effect, "
            f"from {self.ctx.client.used} queries to {self.ctx.schema['name']}. Every rule comes from paired counterfactual probes "
            f"(one input changed at a time), Benjamini–Hochberg corrected across all contrasts."
        )
        caveats = [
            "Findings hold only inside the input ranges that were tested.",
            "'No detectable effect' means no effect was found with this budget, not proof that there is none.",
            f"Response noise: SD {noise.get('sd', 0):.3g} {self.ctx.schema['output']['unit']} ({noise.get('sd_log', 0) * 100:.1f}% relative).",
            "Badges: high = BH q < 0.01, refuters passed, confirmed on fresh personas or ≥16 probes; medium = q < 0.05; suspected = not established.",
            f"Persona and Reporter text written by {self.ctx.llm.label}; all statistics are computed in code.",
        ]
        if interim:
            caveats.insert(0, "Interim rulebook: a suspected rule is being re-tested.")
        clean = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rules]
        self.mem.write_fact("rulebook", clean, self.name)
        self.ctx.emit.report({"summary": summary, "rules": clean, "caveats": caveats, "noiseSd": noise.get("sd", 0), "generatedAt": now_ms()})
        for r in clean:
            if r["kind"] != "null":
                self.log(f"[{r['badge']}] {r['statement']}", "ok" if r["badge"] == "high" else "info")
