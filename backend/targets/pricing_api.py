"""Mock black-box pricing API.

POST /quote  {device, age, city, postcode, income, day_of_week, hour, loyalty_tier} -> {price}
GET  /schema public API documentation (field names, types, ranges). Reveals no rules.

The hidden rules live in hidden_rules.json and are applied here. Run standalone with
    uv run uvicorn targets.pricing_api:app --port 8101
"""

from __future__ import annotations

import hashlib
import json
import os
import random
from collections import Counter
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

RULES = json.loads((Path(__file__).parent / "hidden_rules.json").read_text())

DEVICES = ["Android", "iPhone", "Desktop"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
TIERS = ["none", "silver", "gold", "platinum"]
CITIES = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Jaipur"]

# Public "census" facts an investigator could look up: which city each postcode belongs to
# and the neighbourhood's median household income. This is world knowledge, not a pricing rule.
POSTCODES = {
    "400001": ("Mumbai", 2_400_000),
    "400050": ("Mumbai", 2_100_000),
    "400070": ("Mumbai", 650_000),
    "110003": ("Delhi", 2_600_000),
    "110092": ("Delhi", 520_000),
    "560001": ("Bengaluru", 2_000_000),
    "560068": ("Bengaluru", 700_000),
    "411001": ("Pune", 900_000),
    "411014": ("Pune", 600_000),
    "302001": ("Jaipur", 450_000),
}

SCHEMA = {
    "id": "pricing",
    "name": "Ride Pricing API",
    "vendor": "Mock ride-hailing quote service (synthetic)",
    "version": "v1",
    "domain": "Dynamic pricing",
    "endpoint": "POST /quote",
    "description": "Quotes a ride price in rupees for a customer. The vendor documents the request fields but not how the price is computed.",
    "output": {"key": "price", "label": "Price", "unit": "INR", "format": "currency", "min": 0, "max": 600},
    "defaultBudget": 500,
    "stochastic": True,
    "features": [
        {"key": "device", "label": "Device", "kind": "categorical", "levels": DEVICES, "description": "Device the request came from."},
        {"key": "age", "label": "Age", "kind": "numeric", "min": 18, "max": 80, "integer": True, "unit": "yr", "description": "Customer age in years."},
        {"key": "city", "label": "City", "kind": "categorical", "levels": CITIES, "description": "City of the pickup."},
        {"key": "postcode", "label": "Postcode", "kind": "categorical", "levels": list(POSTCODES), "description": "Pickup postcode."},
        {"key": "income", "label": "Income", "kind": "numeric", "min": 200_000, "max": 5_000_000, "integer": True, "unit": "INR", "format": "currency", "description": "Declared annual income."},
        {"key": "day_of_week", "label": "Day of week", "kind": "categorical", "levels": DAYS, "description": "Day of the ride."},
        {"key": "hour", "label": "Hour", "kind": "numeric", "min": 0, "max": 23, "integer": True, "unit": "h", "description": "Hour of the ride (0-23)."},
        {"key": "loyalty_tier", "label": "Loyalty tier", "kind": "categorical", "levels": TIERS, "description": "Customer loyalty programme tier."},
    ],
    # public census data that personas may use to stay realistic
    "context": {"postcodes": {k: {"city": c, "median_income": m} for k, (c, m) in POSTCODES.items()}},
}


class QuoteRequest(BaseModel):
    device: str
    age: int = Field(ge=18, le=80)
    city: str
    postcode: str
    income: int = Field(ge=200_000, le=5_000_000)
    day_of_week: str
    hour: int = Field(ge=0, le=23)
    loyalty_tier: str


def hidden_price(q: QuoteRequest, rng: random.Random) -> float:
    price = float(RULES["base_price"])
    if q.device == "iPhone":
        price *= 1.12
    if q.day_of_week in RULES["weekend_days"] and q.hour >= 20:
        price *= 1.5
    if q.postcode in RULES["premium_postcodes"]:
        price *= 1.20
    if q.age > 60:
        price += 50  # flat surcharge, applied after the multipliers
    # loyalty_tier, income and city are accepted but ignored
    noise = RULES["noise"]
    price *= 1 + rng.uniform(-noise, noise)
    return round(price, 2)


app = FastAPI(title="Mock pricing target")
_rng = random.Random()
# AUTOPSY_TARGET_SEED makes the noise reproducible: it depends on the request and on
# how many times that exact request has been seen, not on request order across inputs.
_SEED = os.environ.get("AUTOPSY_TARGET_SEED")
_seen: Counter = Counter()


def _noise_rng(q: QuoteRequest) -> random.Random:
    if _SEED is None:
        return _rng
    key = q.model_dump_json()
    _seen[key] += 1
    h = hashlib.sha256(f"{_SEED}|{key}|{_seen[key]}".encode()).digest()
    return random.Random(int.from_bytes(h[:8], "big"))


@app.get("/schema")
def schema():
    return SCHEMA


@app.post("/quote")
def quote(q: QuoteRequest):
    for key, allowed in (("device", DEVICES), ("city", CITIES), ("postcode", list(POSTCODES)), ("day_of_week", DAYS), ("loyalty_tier", TIERS)):
        if getattr(q, key) not in allowed:
            raise HTTPException(422, f"{key} must be one of {allowed}")
    return {"price": hidden_price(q, _noise_rng(q))}


@app.post("/reset")
def reset():
    """Demo reproducibility: restart the seeded noise sequence (no effect without AUTOPSY_TARGET_SEED)."""
    _seen.clear()
    return {"ok": True, "seeded": _SEED is not None}


@app.get("/reveal")
def reveal():
    """Post-run ground truth for the scorecard. Never called by the agents."""
    return {"rules": RULES["rules"], "decoys": RULES["decoys"], "noise": RULES["noise"]}
