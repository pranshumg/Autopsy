import math

import numpy as np

from autopsy import stats


def rng():
    return np.random.default_rng(0)


def test_benjamini_hochberg_matches_reference():
    q = stats.benjamini_hochberg([0.01, 0.04, 0.03, 0.2])
    assert np.allclose(q, [0.04, 0.0533333, 0.0533333, 0.2], atol=1e-6)


def test_sign_flip_detects_shift_and_respects_null():
    r = rng()
    assert stats.sign_flip_p(np.full(10, 0.1) + r.normal(0, 0.01, 10), r) < 0.01
    assert stats.sign_flip_p(r.normal(0, 1, 40), r) > 0.05
    assert stats.sign_flip_p(np.zeros(5), r) == 1.0


def test_noise_floor_recovers_relative_noise():
    r = rng()
    groups = [list(200 * (1 + r.uniform(-0.03, 0.03, 40))) for _ in range(3)]
    nf = stats.noise_floor(groups)
    assert abs(nf["sd_log"] - 0.03 / math.sqrt(3)) < 0.005  # SD of U(-a, a) is a/sqrt(3)


def _pairs_threshold(n=40, t=60, add=50.0, noise=0.0):
    r = np.random.default_rng(1)
    out = []
    for _ in range(n):
        a, b = r.integers(18, 81, 2)
        base = r.uniform(200, 400)
        ya = base + (add if a > t else 0) + r.normal(0, noise)
        yb = base + (add if b > t else 0) + r.normal(0, noise)
        out.append({"a": int(a), "b": int(b), "ya": ya, "yb": yb, "persona": {}})
    return out


def test_numeric_threshold_additive_is_classified():
    e = stats.numeric_effect("age", _pairs_threshold(noise=1.0), 1.0, rng())
    assert e.kind == "threshold"
    assert e.scale == "additive"
    assert e.threshold["lo"] <= 60 <= e.threshold["hi"]
    assert e.ci[0] < 50 < e.ci[1]


def test_categorical_multiplicative_level_and_reference():
    r = np.random.default_rng(2)
    levels = ["Android", "iPhone", "Desktop"]
    pairs = []
    for _ in range(30):
        a, b = r.choice(levels, 2, replace=False)
        base = r.uniform(200, 400)
        f = lambda lv: 1.12 if lv == "iPhone" else 1.0
        pairs.append({"a": a, "b": b, "ya": base * f(a) * (1 + r.uniform(-0.01, 0.01)), "yb": base * f(b) * (1 + r.uniform(-0.01, 0.01)), "persona": {}})
    effects = stats.categorical_effects("device", levels, pairs, 2.0, rng())
    iphone = next(e for e in effects if e.level == "iPhone")
    assert iphone.scale == "multiplicative"
    assert abs(iphone.estimate - 1.12) < 0.01
    assert iphone.p < 0.01
    assert iphone.extra["reference"] != "iPhone"


def test_null_feature_false_positive_rate_is_controlled():
    """A feature with no effect should be called 'null' in roughly >= 95% of runs (alpha = 0.05)."""
    hits = 0
    for seed in range(60):
        r = np.random.default_rng(seed)
        pairs = [{"a": float(x), "b": float(y), "ya": 300 + r.normal(0, 3), "yb": 300 + r.normal(0, 3), "persona": {}} for x, y in r.uniform(0, 100, (30, 2))]
        hits += stats.numeric_effect("loyalty", pairs, 3.0, np.random.default_rng(seed)).kind != "null"
    assert hits / 60 <= 0.12
