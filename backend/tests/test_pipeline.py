"""End-to-end over real HTTP: mock target -> agents -> rulebook -> scorecard."""

import httpx

from autopsy.orchestrator import Run
from autopsy.scorecard import fetch_truth, items_from_effects, score


def test_pricing_target_contract(targets_url):
    x = {"device": "iPhone", "age": 65, "city": "Mumbai", "postcode": "400001", "income": 2_000_000, "day_of_week": "Sat", "hour": 22, "loyalty_tier": "gold"}
    p = httpx.post(f"{targets_url}/pricing/quote", json=x).json()["price"]
    expected = 200 * 1.12 * 1.5 * 1.2 + 50  # multipliers first, then the flat senior surcharge
    assert abs(p - expected) <= 0.031 * expected  # the target's ±3% noise applies to the final price
    assert httpx.post(f"{targets_url}/pricing/quote", json={**x, "device": "Nokia"}).status_code == 422
    schema = httpx.get(f"{targets_url}/pricing/schema").json()
    assert "premium" not in str(schema).lower() and "1.12" not in str(schema)


def test_credit_target_contract(targets_url):
    x = {"checking_status": "no_account", "duration": 12, "credit_history": "critical", "purpose": "radio_tv", "credit_amount": 2000, "savings": "unknown", "employment": "above_7y", "age": 40, "housing": "own"}
    r = httpx.post(f"{targets_url}/credit/quote", json=x).json()
    assert 0 <= r["score"] <= 100 and r["approved"] == (r["score"] >= 50)


def test_full_run_recovers_pricing_rules(targets_url):
    events = []
    run = Run("pricing", budget=500, seed=42, sink=events.extend, use_llm=False, use_dowhy=False, pace="instant", db_path=":memory:")
    out = run.run()
    assert out["status"] == "completed"
    assert run.client.used <= 500
    sc = score(fetch_truth("pricing"), items_from_effects(out["findings"]["effects"], out["findings"]["interactions"]))
    verdicts = {r["id"]: r["verdict"] for r in sc["rules"]}
    assert verdicts["R1"] == "recovered"  # iPhone x1.12
    assert verdicts["R2"] in ("recovered", "partial")  # age > 60
    assert verdicts["R4"] in ("recovered", "partial")  # premium postcodes
    assert not any(d["fooled"] for d in sc["decoys"] if d["id"] == "D1")  # loyalty_tier decoy
    # UI protocol sanity
    types = {e["type"] for e in events}
    assert {"status", "observations", "hypothesis", "report", "handoff", "log"} <= types
    obs = sum(len(e["observations"]) for e in events if e["type"] == "observations")
    assert obs == run.client.used
