"""Black-box credit model: a scikit-learn random forest trained on the public
UCI Statlog (German Credit) dataset (CC BY 4.0), served over HTTP.

POST /quote {checking_status, duration, credit_history, purpose, credit_amount,
             savings, employment, age, housing} -> {approved, score}
score = model probability of "good credit" x 100; approved = score >= 50.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

DATA = Path(__file__).parent / "data" / "german.data"

CHECKING = {"A11": "below_0", "A12": "0_to_200", "A13": "above_200", "A14": "no_account"}
HISTORY = {"A30": "no_credits", "A31": "all_paid_here", "A32": "existing_paid", "A33": "past_delays", "A34": "critical"}
PURPOSE = {"A40": "new_car", "A41": "used_car", "A42": "furniture", "A43": "radio_tv", "A44": "other", "A45": "other", "A46": "education", "A47": "other", "A48": "other", "A49": "business", "A410": "other"}
SAVINGS = {"A61": "below_100", "A62": "100_to_500", "A63": "500_to_1000", "A64": "above_1000", "A65": "unknown"}
EMPLOYMENT = {"A71": "unemployed", "A72": "below_1y", "A73": "1_to_4y", "A74": "4_to_7y", "A75": "above_7y"}
HOUSING = {"A151": "rent", "A152": "own", "A153": "free"}

CATEGORICAL = {
    "checking_status": sorted(set(CHECKING.values())),
    "credit_history": sorted(set(HISTORY.values())),
    "purpose": sorted(set(PURPOSE.values())),
    "savings": sorted(set(SAVINGS.values())),
    "employment": sorted(set(EMPLOYMENT.values())),
    "housing": sorted(set(HOUSING.values())),
}
NUMERIC = {"duration": (4, 72), "credit_amount": (250, 18_500), "age": (19, 75)}
COLUMNS = ["checking_status", "duration", "credit_history", "purpose", "credit_amount", "savings", "employment", "age", "housing"]

SCHEMA = {
    "id": "credit",
    "name": "Credit Approval Model",
    "vendor": "scikit-learn random forest on UCI German Credit (public data)",
    "version": "rf-300",
    "domain": "Consumer lending",
    "endpoint": "POST /quote",
    "description": "A machine-learned credit model trained on 1,000 historical German loan applications. Returns an approval score from 0 to 100; 50 or more is approved.",
    "output": {"key": "score", "label": "Approval score", "unit": "pts", "format": "score", "min": 0, "max": 100},
    "defaultBudget": 500,
    "stochastic": False,
    "features": [
        {"key": "checking_status", "label": "Checking account", "kind": "categorical", "levels": CATEGORICAL["checking_status"], "description": "Checking account balance band (DM)."},
        {"key": "duration", "label": "Duration", "kind": "numeric", "min": 4, "max": 72, "integer": True, "unit": "mo", "description": "Loan duration in months."},
        {"key": "credit_history", "label": "Credit history", "kind": "categorical", "levels": CATEGORICAL["credit_history"], "description": "Past repayment record."},
        {"key": "purpose", "label": "Purpose", "kind": "categorical", "levels": CATEGORICAL["purpose"], "description": "Purpose of the loan."},
        {"key": "credit_amount", "label": "Credit amount", "kind": "numeric", "min": 250, "max": 18_500, "integer": True, "unit": "DM", "description": "Requested amount."},
        {"key": "savings", "label": "Savings", "kind": "categorical", "levels": CATEGORICAL["savings"], "description": "Savings balance band (DM)."},
        {"key": "employment", "label": "Employment", "kind": "categorical", "levels": CATEGORICAL["employment"], "description": "Time with current employer."},
        {"key": "age", "label": "Age", "kind": "numeric", "min": 19, "max": 75, "integer": True, "unit": "yr", "description": "Applicant age in years."},
        {"key": "housing", "label": "Housing", "kind": "categorical", "levels": CATEGORICAL["housing"], "description": "Housing status."},
    ],
    "context": {},
}


def load_dataset() -> tuple[pd.DataFrame, np.ndarray]:
    raw = pd.read_csv(DATA, sep=" ", header=None)
    df = pd.DataFrame(
        {
            "checking_status": raw[0].map(CHECKING),
            "duration": raw[1],
            "credit_history": raw[2].map(HISTORY),
            "purpose": raw[3].map(PURPOSE),
            "credit_amount": raw[4],
            "savings": raw[5].map(SAVINGS),
            "employment": raw[6].map(EMPLOYMENT),
            "age": raw[12],
            "housing": raw[14].map(HOUSING),
        }
    )
    y = (raw[20] == 1).astype(int).to_numpy()  # 1 = good credit
    return df, y


@lru_cache(maxsize=1)
def model() -> Pipeline:
    df, y = load_dataset()
    pipe = Pipeline(
        [
            ("enc", ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), list(CATEGORICAL))], remainder="passthrough")),
            ("rf", RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=5, random_state=0)),
        ]
    )
    pipe.fit(df[COLUMNS], y)
    return pipe


def score(rows: pd.DataFrame) -> np.ndarray:
    return np.round(model().predict_proba(rows[COLUMNS])[:, 1] * 100, 2)


class CreditRequest(BaseModel):
    checking_status: str
    duration: int = Field(ge=4, le=72)
    credit_history: str
    purpose: str
    credit_amount: int = Field(ge=250, le=18_500)
    savings: str
    employment: str
    age: int = Field(ge=19, le=75)
    housing: str


app = FastAPI(title="Credit model target")


@app.get("/schema")
def schema():
    return SCHEMA


@app.post("/quote")
def quote(q: CreditRequest):
    for key, levels in CATEGORICAL.items():
        if getattr(q, key) not in levels:
            raise HTTPException(422, f"{key} must be one of {levels}")
    s = float(score(pd.DataFrame([q.model_dump()]))[0])
    return {"approved": s >= 50, "score": s}


@lru_cache(maxsize=1)
def _truth() -> dict:
    """Model internals for the post-run scorecard: permutation importance on the training data."""
    df, _ = load_dataset()
    base = score(df)
    rng = np.random.default_rng(0)
    rules, decoys = [], []
    for col in COLUMNS:
        shuffled = df.copy()
        shuffled[col] = rng.permutation(shuffled[col].to_numpy())
        impact = float(np.mean(np.abs(score(shuffled) - base)))
        entry = {"id": col, "features": [col], "importance": round(impact, 2)}
        if impact >= 1.5:
            rules.append({**entry, "text": f"{col} moves the score by {impact:.1f} points on average (permutation importance)"})
        elif impact < 0.5:
            decoys.append({**entry, "text": f"{col} has almost no influence (mean shift {impact:.2f} points)"})
    rules.sort(key=lambda r: -r["importance"])
    for i, r in enumerate(rules):
        r["id"] = f"R{i + 1}"
    return {"rules": rules, "decoys": decoys, "noise": 0}


@app.get("/reveal")
def reveal():
    return _truth()
