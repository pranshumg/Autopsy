"""Pure-code statistics for the Statistician. No LLM ever touches these numbers.

Conventions: a "pair" is a counterfactual probe (same persona, ONE feature changed).
    {feature, a, b, ya, yb, persona: {...base input...}}
Effects are analysed on two scales: additive (yb - ya) and multiplicative (log yb/ya).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import product
from typing import Any

import numpy as np
from scipy import stats as sps

EPS = 1e-9


# ---------------------------------------------------------------------------
# basic inference


def bootstrap_ci(values: np.ndarray, rng: np.random.Generator, B: int = 2000, level: float = 0.95, stat=np.mean) -> tuple[float, float]:
    v = np.asarray(values, float)
    if len(v) == 0:
        return (math.nan, math.nan)
    if len(v) == 1:
        return (float(v[0]), float(v[0]))
    idx = rng.integers(0, len(v), size=(B, len(v)))
    boots = stat(v[idx], axis=1)
    a = (1 - level) / 2
    return (float(np.quantile(boots, a)), float(np.quantile(boots, 1 - a)))


def sign_flip_p(diffs: np.ndarray, rng: np.random.Generator, B: int = 4000) -> float:
    """Two-sided paired permutation test of mean(diffs) == 0 by random sign flips (exact for n <= 14)."""
    d = np.asarray(diffs, float)
    n = len(d)
    if n == 0:
        return 1.0
    obs = abs(d.mean())
    if np.allclose(d, 0):
        return 1.0
    if n <= 14:
        signs = np.array(list(product([-1, 1], repeat=n)))
    else:
        signs = rng.choice([-1, 1], size=(B, n))
    null = np.abs((signs * d).mean(axis=1))
    # +1 correction keeps the Monte-Carlo p-value valid
    return float((np.sum(null >= obs - 1e-12) + (0 if n <= 14 else 1)) / (len(null) + (0 if n <= 14 else 1)))


def benjamini_hochberg(pvals: list[float]) -> list[float]:
    p = np.asarray(pvals, float)
    m = len(p)
    if m == 0:
        return []
    order = np.argsort(p)
    ranked = p[order] * m / (np.arange(m) + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(m)
    out[order] = np.minimum(q, 1)
    return out.tolist()


def noise_floor(groups: list[list[float]]) -> dict[str, float]:
    """Repeated identical queries -> noise SD on the absolute and log scales."""
    abs_res, log_res = [], []
    for g in groups:
        g = np.asarray(g, float)
        if len(g) < 2:
            continue
        abs_res.extend(g - g.mean())
        lg = np.log(np.maximum(g, EPS))
        log_res.extend(lg - lg.mean())
    dof = max(1, len(abs_res) - len(groups))
    sd_abs = float(math.sqrt(np.sum(np.square(abs_res)) / dof)) if abs_res else 0.0
    sd_log = float(math.sqrt(np.sum(np.square(log_res)) / dof)) if log_res else 0.0
    return {"sd": sd_abs, "sd_log": sd_log, "cv": sd_log, "n": int(sum(len(g) for g in groups))}


# ---------------------------------------------------------------------------
# effect estimation


@dataclass
class Effect:
    feature: str
    kind: str  # "level" | "threshold" | "linear" | "null"
    scale: str  # "additive" | "multiplicative"
    estimate: float  # additive: output units; multiplicative: ratio (e.g. 1.12)
    ci: tuple[float, float]
    p: float
    n: int
    level: str | None = None
    threshold: dict[str, float] | None = None
    heterogeneity: dict[str, Any] | None = None
    q: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def width(self) -> float:
        lo, hi = self.ci
        return (hi - lo) if self.scale == "additive" else math.log(max(hi, EPS)) - math.log(max(lo, EPS))

    @property
    def nonzero(self) -> bool:
        null = 0.0 if self.scale == "additive" else 1.0
        return not (self.ci[0] <= null <= self.ci[1])

    def key(self) -> str:
        return f"{self.feature}={self.level}" if self.level is not None else self.feature

    def as_dict(self) -> dict[str, Any]:
        return {
            "feature": self.feature,
            "kind": self.kind,
            "scale": self.scale,
            "estimate": self.estimate,
            "ci": list(self.ci),
            "p": self.p,
            "q": self.q,
            "n": self.n,
            "level": self.level,
            "threshold": self.threshold,
            "heterogeneity": self.heterogeneity,
            **self.extra,
        }


def choose_scale(pairs: list[dict], nz_mask: np.ndarray | None = None) -> str:
    """Multiplicative if the size of the change grows with the base output; additive if it stays flat.

    Multiplicative effect: |yb - ya| is proportional to the base and |log ratio| is constant.
    Additive effect: |yb - ya| is constant and |log ratio| shrinks as the base grows.
    """
    ya = np.array([p["ya"] for p in pairs], float)
    yb = np.array([p["yb"] for p in pairs], float)
    if np.any(ya <= 0) or np.any(yb <= 0):
        return "additive"
    if nz_mask is not None:
        ya, yb = ya[nz_mask], yb[nz_mask]
    if len(ya) < 4:
        return "multiplicative"
    base = np.minimum(ya, yb)
    d, r = np.abs(yb - ya), np.abs(np.log(yb / ya))
    if np.std(base) < EPS or np.std(d) < EPS or np.std(r) < EPS:
        return "multiplicative"
    c_abs = float(np.corrcoef(d, base)[0, 1])  # ~ +1 if multiplicative, ~ 0 if additive
    c_rel = float(np.corrcoef(r, base)[0, 1])  # ~ 0 if multiplicative, ~ -1 if additive
    return "multiplicative" if c_abs > -c_rel else "additive"


def _scaled(pairs: list[dict], scale: str) -> np.ndarray:
    ya = np.array([p["ya"] for p in pairs], float)
    yb = np.array([p["yb"] for p in pairs], float)
    return np.log(np.maximum(yb, EPS) / np.maximum(ya, EPS)) if scale == "multiplicative" else yb - ya


def _to_estimate(v: float, scale: str) -> float:
    return float(math.exp(v)) if scale == "multiplicative" else float(v)


def categorical_effects(feature: str, levels: list[str], pairs: list[dict], noise_sd: float, rng: np.random.Generator) -> list[Effect]:
    """Per-level effects against a "typical" reference level.

    The reference is re-chosen as the level whose effect sits at the median, so that e.g. the
    four premium postcodes read as "+20%" rather than six ordinary ones reading as "-17%".
    """
    seen = [lv for lv in levels if any(p["a"] == lv or p["b"] == lv for p in pairs)]
    if len(seen) < 2:
        return []
    first = _categorical_fit(feature, seen, pairs, noise_sd, rng, B=50)
    betas = {seen[0]: 0.0, **{e.level: (math.log(e.estimate) if e.scale == "multiplicative" else e.estimate) for e in first}}
    med = float(np.median(list(betas.values())))
    ref = min(betas, key=lambda lv: (abs(betas[lv] - med), seen.index(lv)))
    order = [ref] + [lv for lv in seen if lv != ref]
    return _categorical_fit(feature, order, pairs, noise_sd, rng)


def _categorical_fit(feature: str, levels: list[str], pairs: list[dict], noise_sd: float, rng: np.random.Generator, B: int = 600) -> list[Effect]:
    """Model: s(yb) - s(ya) = beta[b] - beta[a], beta[ref=levels[0]] = 0; least squares + pair bootstrap."""
    others = levels[1:]
    col = {lv: i for i, lv in enumerate(others)}
    X = np.zeros((len(pairs), len(others)))
    for i, p in enumerate(pairs):
        if p["b"] in col:
            X[i, col[p["b"]]] += 1
        if p["a"] in col:
            X[i, col[p["a"]]] -= 1

    def resid_for(scale: str) -> np.ndarray:
        yy = _scaled(pairs, scale)
        beta, *_ = np.linalg.lstsq(X, yy, rcond=None)
        return yy - X @ beta

    scale = pick_scale(pairs, resid_for)
    y = _scaled(pairs, scale)

    def fit(rows: np.ndarray) -> np.ndarray:
        beta, *_ = np.linalg.lstsq(X[rows], y[rows], rcond=None)
        return beta

    beta = fit(np.arange(len(pairs)))
    boots = np.array([fit(rng.integers(0, len(pairs), len(pairs))) for _ in range(B)])
    out = []
    for lv in others:
        j = col[lv]
        involved = np.nonzero(X[:, j])[0]
        if len(involved) == 0:
            continue
        lo, hi = np.quantile(boots[:, j], [0.025, 0.975])
        # paired permutation on rows that involve this level, oriented as (lv - other) minus the other level's fitted effect
        oriented = []
        for i in involved:
            other = pairs[i]["a"] if X[i, j] > 0 else pairs[i]["b"]
            ob = beta[col[other]] if other in col else 0.0
            oriented.append(y[i] * X[i, j] + ob)
        p = sign_flip_p(np.array(oriented), rng)
        out.append(Effect(feature, "level", scale, _to_estimate(beta[j], scale), (_to_estimate(lo, scale), _to_estimate(hi, scale)), p, int(len(involved)), level=lv, extra={"reference": levels[0]}))
    return out


def pick_scale(pairs: list[dict], resid_for) -> str:
    """Fit the model on both scales; keep the one whose residuals look like the target's noise.

    Response noise is relative (a % of the output), so additive residuals are divided by the
    output level before comparing. The noise level itself cancels out of the comparison.
    """
    ya = np.array([p["ya"] for p in pairs], float)
    yb = np.array([p["yb"] for p in pairs], float)
    if np.any(ya <= 0) or np.any(yb <= 0):
        return "additive"
    level = (ya + yb) / 2
    sse_add = float(np.sum((resid_for("additive") / level) ** 2))
    sse_mul = float(np.sum(resid_for("multiplicative") ** 2))
    return "multiplicative" if sse_mul <= sse_add else "additive"


def _nonzero_mask(pairs: list[dict], noise_sd: float) -> np.ndarray:
    d = np.array([p["yb"] - p["ya"] for p in pairs], float)
    return np.abs(d) > 3 * max(noise_sd, EPS) * math.sqrt(2)


def _step_z_p(y: np.ndarray, z: np.ndarray, sigma: np.ndarray, n_thresholds: int) -> float:
    """z-test of a step against the MEASURED noise floor (per-pair difference SD = sqrt(2) * sigma_i),
    Bonferroni-corrected for the number of thresholds searched. Lets a few clean crossings count."""
    k = int(np.sum(z != 0))
    if k == 0 or np.all(sigma <= 0):
        return 1.0
    zz = float(np.sum(z * z))
    delta = float(np.sum(y * z) / zz)
    se = math.sqrt(float(np.sum(z * z * 2 * sigma**2))) / zz
    return float(min(1.0, 2 * sps.norm.sf(abs(delta) / se) * max(1, n_thresholds)))


def numeric_effect(feature: str, pairs: list[dict], noise_sd: float, rng: np.random.Generator, noise_log: float = 0.0) -> Effect:
    """Classify a numeric feature's effect as threshold (step), linear, or null; estimate it with a bootstrap CI."""
    if not pairs:
        return Effect(feature, "null", "additive", 0.0, (0.0, 0.0), 1.0, 0)
    xa = np.array([float(p["a"]) for p in pairs])
    xb = np.array([float(p["b"]) for p in pairs])
    n = len(pairs)

    def resid_for(sc: str) -> np.ndarray:
        """Residuals of the better of the step and linear fits on scale `sc`."""
        yy = _scaled(pairs, sc)
        z = xb - xa
        beta = float(z @ yy) / float(z @ z) if float(z @ z) else 0.0
        best = yy - beta * z
        xs = np.unique(np.concatenate([xa, xb]))
        for t in (xs[:-1] + xs[1:]) / 2 if len(xs) > 1 else xs:
            zz = (xb > t).astype(float) - (xa > t).astype(float)
            dd = float(zz @ zz)
            if dd == 0:
                continue
            r = yy - (float(zz @ yy) / dd) * zz
            if np.sum(r**2) < np.sum(best**2):
                best = r
        return best

    scale = pick_scale(pairs, resid_for)
    y = _scaled(pairs, scale)
    # noise is relative (a % of the output): on the additive scale each pair's SD grows with its level
    level = np.array([(p["ya"] + p["yb"]) / 2 for p in pairs], float)
    rel = noise_log if noise_log > 0 else (noise_sd / max(float(level.mean()), EPS))
    sigma = np.full(len(pairs), rel) if scale == "multiplicative" else rel * level
    n_thr = max(1, len(np.unique(np.concatenate([xa, xb]))) - 1)

    def step_fit(idx: np.ndarray):
        best = None
        xs = np.unique(np.concatenate([xa[idx], xb[idx]]))
        for t in (xs[:-1] + xs[1:]) / 2 if len(xs) > 1 else xs:
            z = (xb[idx] > t).astype(float) - (xa[idx] > t).astype(float)
            denom = float(z @ z)
            if denom == 0:
                continue
            delta = float(z @ y[idx]) / denom
            sse = float(np.sum((y[idx] - delta * z) ** 2))
            if best is None or sse < best[0] - 1e-12:
                best = (sse, t, delta)
        return best

    def lin_fit(idx: np.ndarray):
        z = xb[idx] - xa[idx]
        denom = float(z @ z)
        beta = float(z @ y[idx]) / denom if denom else 0.0
        return float(np.sum((y[idx] - beta * z) ** 2)), beta

    all_idx = np.arange(n)
    sse0 = float(np.sum(y**2))
    sse_lin, beta = lin_fit(all_idx)
    step = step_fit(all_idx)
    sse_step = step[0] if step else math.inf

    def bic(sse: float, k: int) -> float:
        return n * math.log(max(sse, EPS) / n) + k * math.log(n)

    # the threshold location is searched, so it counts as a parameter (k=3)
    scores = {"null": bic(sse0, 0), "linear": bic(sse_lin, 1), "threshold": bic(sse_step, 3) if step else math.inf}
    kind = min(scores, key=scores.get)
    # a shape only counts if its permutation test is significant; otherwise report no detectable effect
    if kind == "threshold":
        z = (xb > step[1]).astype(float) - (xa > step[1]).astype(float)
        if min(sign_flip_p(y * z, rng), _step_z_p(y, z, sigma, n_thr)) >= 0.05:
            kind = "linear" if scores["linear"] < scores["null"] else "null"
    if kind == "linear" and sign_flip_p(y * (xb - xa), rng) >= 0.05:
        kind = "null"

    if kind == "threshold":
        _, t, delta = step
        boots = []
        for _ in range(400):
            b = step_fit(rng.integers(0, n, n))
            if b:
                boots.append((b[1], b[2]))
        bt = np.array(boots)
        lo_d, hi_d = np.quantile(bt[:, 1], [0.025, 0.975])
        # threshold interval: tightest observed x values on either side of t
        xs = np.unique(np.concatenate([xa, xb]))
        below, above = xs[xs < t], xs[xs > t]
        z = (xb > t).astype(float) - (xa > t).astype(float)
        p = sign_flip_p(y[z != 0] * z[z != 0], rng) if np.any(z != 0) else 1.0
        p = min(p, _step_z_p(y, z, sigma, n_thr))
        thr = {
            "value": float(t),
            "lo": float(below.max()) if len(below) else float(t),
            "hi": float(above.min()) if len(above) else float(t),
            "direction": "up" if delta > 0 else "down",
        }
        resid = y - delta * z
        return Effect(feature, "threshold", scale, _to_estimate(delta, scale), (_to_estimate(lo_d, scale), _to_estimate(hi_d, scale)), p, n, threshold=thr, extra={"resid": resid.tolist(), "crossing": int(np.sum(z != 0))})

    if kind == "linear":
        boots = [lin_fit(rng.integers(0, n, n))[1] for _ in range(600)]
        lo_b, hi_b = np.quantile(boots, [0.025, 0.975])
        z = xb - xa
        p = sign_flip_p(y * z, rng)  # flipping y's sign under H0 flips y*z
        resid = y - beta * z
        # report linear effects per unit on the additive scale or as per-unit ratio
        return Effect(feature, "linear", scale, _to_estimate(beta, scale), (_to_estimate(lo_b, scale), _to_estimate(hi_b, scale)), p, n, extra={"per_unit": True, "resid": resid.tolist()})

    lo, hi = bootstrap_ci(y, rng)
    p = sign_flip_p(y, rng)
    return Effect(feature, "null", scale, _to_estimate(float(y.mean()), scale), (_to_estimate(lo, scale), _to_estimate(hi, scale)), p, n, extra={"resid": y.tolist()})


# ---------------------------------------------------------------------------
# heterogeneity: does the effect depend on another feature?


def heterogeneity(resid: np.ndarray, personas: list[dict], feature: str, schema_features: list[dict], noise_sd_scaled: float, rng: np.random.Generator) -> dict[str, Any] | None:
    """Residual spread beyond what noise explains -> find the other feature that best explains it."""
    r = np.asarray(resid, float)
    if len(r) < 6:
        return None
    expected = 2 * max(noise_sd_scaled, 1e-6) ** 2  # variance of a difference of two noisy measurements
    ratio = float(np.var(r, ddof=1) / expected)
    crit = float(sps.chi2.ppf(0.99, len(r) - 1) / (len(r) - 1))
    if ratio <= crit:
        return None
    best = None
    per_feature: dict[str, dict] = {}
    for f in schema_features:
        k = f["key"]
        if k == feature:
            continue
        vals = [p[k] for p in personas]
        splits: list[tuple[str, np.ndarray]] = []
        if f["kind"] == "categorical":
            for lv in f["levels"]:
                g = np.array([v == lv for v in vals])
                if 2 <= g.sum() <= len(g) - 2:
                    splits.append((f"{k}={lv}", g))
            # also group levels by sign of mean residual (e.g. {Sat, Sun} vs weekdays)
            means = {lv: r[np.array([v == lv for v in vals])].mean() for lv in set(vals)}
            hi = [lv for lv, m in means.items() if abs(m) > np.median(np.abs(r))]
            if hi and len(hi) < len(means):
                g = np.array([v in hi for v in vals])
                if 2 <= g.sum() <= len(g) - 2:
                    splits.append((f"{k} in {sorted(hi)}", g))
        else:
            x = np.array(vals, float)
            for q in (0.25, 0.5, 0.75, 0.85):
                t = float(np.quantile(x, q))
                g = x > t
                if 2 <= g.sum() <= len(g) - 2:
                    splits.append((f"{k}>{t:g}", g))
        for label, g in splits:
            eta2 = _eta2(np.abs(r), g)
            if k not in per_feature or eta2 > per_feature[k]["eta2"]:
                per_feature[k] = {"by": k, "split": label, "eta2": eta2, "group": g}
    # keep the 3 best explaining features that pass a permutation test (strict: a 2x2 test is costly)
    ranked = sorted(per_feature.values(), key=lambda c: -c["eta2"])[:3]
    cands = []
    for c in ranked:
        if c["eta2"] < 0.3:
            continue
        g = c.pop("group")
        null = [_eta2(np.abs(r), rng.permutation(g)) for _ in range(999)]
        c["p"] = float((np.sum(np.array(null) >= c["eta2"]) + 1) / 1000)
        if c["p"] <= 0.01:
            cands.append(c)
    if not cands:
        return {"ratio": ratio, "by": None}
    return {**cands[0], "ratio": ratio, "candidates": cands}


def _eta2(v: np.ndarray, g: np.ndarray) -> float:
    if g.sum() == 0 or g.sum() == len(g):
        return 0.0
    tot = np.sum((v - v.mean()) ** 2)
    if tot < EPS:
        return 0.0
    between = g.sum() * (v[g].mean() - v.mean()) ** 2 + (~g).sum() * (v[~g].mean() - v.mean()) ** 2
    return float(between / tot)


def interaction_test(rows: list[list[float]], rng: np.random.Generator) -> dict[str, Any]:
    """A real interaction must survive a change of scale: an additive effect combined with a
    multiplicative one looks like an interaction on either single scale, but not on both.
    Significant only if the contrast is significant (p < 0.01) on BOTH the additive and multiplicative scales."""
    positive = all(v > 0 for r in rows for v in r)
    add = interaction_contrast({"rows": rows}, "additive", rng)
    add_sig = add["p"] < 0.01 and not (add["ci"][0] <= 0 <= add["ci"][1])
    if not positive:
        return {**add, "significant": bool(add_sig), "scale_robust": False}
    mul = interaction_contrast({"rows": rows}, "multiplicative", rng)
    mul_sig = mul["p"] < 0.01 and not (mul["ci"][0] <= 1 <= mul["ci"][1])
    return {**mul, "significant": bool(add_sig and mul_sig), "additive_p": add["p"], "multiplicative_p": mul["p"], "scale_robust": True}


def interaction_contrast(cells: dict[str, Any], scale: str, rng: np.random.Generator) -> dict[str, Any]:
    """2x2 factorial per persona: (y00, y01, y10, y11). Interaction = (y11 - y10) - (y01 - y00)."""
    rows = cells["rows"]  # list of (y00, y01, y10, y11)
    arr = np.array(rows, float)
    if scale == "multiplicative":
        arr = np.log(np.maximum(arr, EPS))
    inter = (arr[:, 3] - arr[:, 2]) - (arr[:, 1] - arr[:, 0])
    lo, hi = bootstrap_ci(inter, rng)
    p = sign_flip_p(inter, rng)
    est = float(inter.mean())
    conv = (lambda v: float(math.exp(v))) if scale == "multiplicative" else float
    main_a = conv(float((arr[:, 2] - arr[:, 0]).mean()))
    main_b = conv(float((arr[:, 1] - arr[:, 0]).mean()))
    joint = conv(float((arr[:, 3] - arr[:, 0]).mean()))
    return {"estimate": conv(est), "ci": [conv(lo), conv(hi)], "p": p, "n": len(rows), "scale": scale, "main_a": main_a, "main_b": main_b, "joint": joint}
