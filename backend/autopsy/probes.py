"""Raw probe results: every query sent to the target, in a SQLite `probes` table.

Agent memory holds only messages and conclusions; the numbers live here.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any

import httpx

from autopsy import config


class BudgetExhausted(Exception):
    pass


class TargetUnavailable(Exception):
    pass


class ProbeStore:
    def __init__(self, run_id: str, path: str | None = None):
        self.run_id = run_id
        self.db = sqlite3.connect(path or str(config.DATA_DIR / "autopsy.db"), check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS probes (run TEXT, id INTEGER, target TEXT, source TEXT, experiment TEXT,
                   persona TEXT, input TEXT, output REAL, t REAL, PRIMARY KEY (run, id))"""
            )
            self.db.commit()

    def add(self, row: dict[str, Any]) -> None:
        with self.lock:
            self.db.execute(
                "INSERT INTO probes VALUES (?,?,?,?,?,?,?,?,?)",
                (self.run_id, row["id"], row["target"], row["source"], row.get("experiment"), row.get("persona"), json.dumps(row["input"]), row["output"], row["t"]),
            )
            self.db.commit()

    def all(self, source: str | None = None) -> list[dict[str, Any]]:
        q, args = "SELECT id, source, experiment, persona, input, output, t FROM probes WHERE run=?", [self.run_id]
        if source:
            q, args = q + " AND source=?", args + [source]
        with self.lock:
            rows = self.db.execute(q + " ORDER BY id", args).fetchall()
        return [{"id": i, "source": s, "experiment": e, "persona": p, "input": json.loads(x), "output": o, "t": t} for i, s, e, p, x, o, t in rows]

    def get(self, ids: list[int]) -> dict[int, dict[str, Any]]:
        wanted = set(ids)
        return {r["id"]: r for r in self.all() if r["id"] in wanted}


def fetch_schema(target_id: str) -> dict[str, Any]:
    """Public API documentation for a target (field names, ranges). No rules."""
    try:
        r = httpx.get(f"{config.TARGETS_URL}/{target_id}/schema", timeout=10)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as e:
        raise TargetUnavailable(f"Target '{target_id}' is not reachable at {config.TARGETS_URL} ({e}). Start it with `uv run python run.py`.") from e


class TargetClient:
    """The ONLY way agents touch a target: POST /quote over HTTP, with a hard query budget."""

    def __init__(self, target_id: str, schema: dict[str, Any], budget: int, store: ProbeStore, on_probe=None, on_request=None):
        self.target_id = target_id
        self.output_key = schema["output"]["key"]
        self.budget = budget
        self.used = 0
        self.requests = 0
        self.store = store
        self.on_probe = on_probe or (lambda rows: None)
        self.on_request = on_request or (lambda n: None)
        self.http = httpx.Client(timeout=10)
        self.next_id = 1
        self.cancelled = False

    @property
    def remaining(self) -> int:
        return self.budget - self.used

    def query(self, inputs: list[dict[str, Any]], source: str, experiment: str | None = None, personas: list[str | None] | None = None) -> list[dict[str, Any]]:
        if len(inputs) > self.remaining:
            raise BudgetExhausted(f"needs {len(inputs)} queries, {self.remaining} left")
        rows = []
        for i, x in enumerate(inputs):
            if self.cancelled:
                raise BudgetExhausted("cancelled")
            y = self._post(x)
            row = {"id": self.next_id, "target": self.target_id, "source": source, "experiment": experiment, "persona": (personas or [None] * len(inputs))[i], "input": x, "output": y, "t": time.time()}
            self.next_id += 1
            self.used += 1
            self.store.add(row)
            rows.append(row)
        self.on_probe(rows)
        return rows

    def _post(self, x: dict[str, Any]) -> float:
        last: Exception | None = None
        for attempt in range(3):
            self.requests += 1
            self.on_request(1)
            try:
                r = self.http.post(f"{config.TARGETS_URL}/{self.target_id}/quote", json=x)
                if r.status_code in (429, 502, 503, 504):
                    last = TargetUnavailable(f"HTTP {r.status_code}")
                    time.sleep(0.2 * (attempt + 1))
                    continue
                if r.status_code >= 400:
                    raise TargetUnavailable(f"target rejected input ({r.status_code}): {r.text[:200]}")
                value = r.json()[self.output_key]
                return float(value)
            except httpx.TransportError as e:
                last = e
                time.sleep(0.2 * (attempt + 1))
        raise TargetUnavailable(f"target unreachable: {last}")
