"""Emits events in the exact shape the AUTOPSY web UI already renders
(src/lib/types.ts `EngineEvent`), so the existing lab works unchanged."""

from __future__ import annotations

import itertools
import threading
import time
from typing import Any, Callable

EMOJI = {"persona": "🎭", "experimenter": "🧪", "statistician": "📊", "reporter": "📝", "system": "⚙️", "target": "🎯", "orchestrator": "⚙️"}


def now_ms() -> int:
    return int(time.time() * 1000)


class Emitter:
    def __init__(self, sink: Callable[[list[dict]], None]):
        self.sink = sink
        self.buf: list[dict] = []
        self.lock = threading.Lock()
        self.ids = itertools.count(1)
        self.last_flush = time.time()

    def _push(self, *events: dict) -> None:
        with self.lock:
            self.buf.extend(events)
        if time.time() - self.last_flush > 0.15:
            self.flush()

    def flush(self) -> None:
        with self.lock:
            batch, self.buf = self.buf, []
            self.last_flush = time.time()
        if batch:
            self.sink(batch)

    # -- primitives -------------------------------------------------------
    def status(self, status: str, error: str | None = None):
        self._push({"type": "status", "status": status, **({"error": error} if error else {})})
        self.flush()

    def phase(self, phase: str | None):
        self._push({"type": "phase", "phase": phase})

    def progress(self, phase: str, value: float):
        self._push({"type": "phaseProgress", "phase": phase, "progress": max(0.0, min(1.0, value))})

    def agent(self, agent: str, **patch):
        self._push({"type": "agent", "agent": agent, "patch": patch})

    def task(self, task: dict):
        self._push({"type": "task", "task": task})

    def log(self, source: str, text: str, level: str = "info"):
        src = source if source in ("persona", "experimenter", "statistician", "reporter", "target") else "system"
        self._push({"type": "log", "line": {"id": next(self.ids), "t": now_ms(), "source": src, "level": level, "text": f"{EMOJI.get(source, '')} {text}".strip()}})

    def handoff(self, sender: str, to: str, payload: str, count: int | None = None):
        def norm(a: str) -> str:
            return a if a in ("persona", "experimenter", "statistician", "reporter", "target") else "reporter" if a == "orchestrator" else a

        h = {"id": f"h{next(self.ids)}", "from": norm(sender), "to": norm(to), "t": now_ms(), "payload": payload}
        if count is not None:
            h["count"] = count
        self._push({"type": "handoff", "handoff": h})

    def observations(self, rows: list[dict]):
        src_map = {"noise": "replicate", "screen": "pair", "holdout": "holdout", "factorial": "factorial", "active": "active", "confirm": "confirm", "conditional": "sweep", "random": "active", "verify": "verify", "manual": "manual"}
        obs = [
            {
                "id": r["id"],
                "input": r["input"],
                "output": r["output"],
                "t": int(r["t"] * 1000),
                "source": src_map.get(r["source"], "active"),
                **({"experimentId": r["experiment"]} if r.get("experiment") else {}),
                **({"personaId": r["persona"]} if r.get("persona") else {}),
            }
            for r in rows
        ]
        self._push({"type": "observations", "observations": obs})

    def requests(self, n: int):
        self._push({"type": "requests", "count": n})

    def experiment(self, exp: dict):
        self._push({"type": "experiment", "experiment": exp})

    def hypothesis(self, h: dict):
        self._push({"type": "hypothesis", "hypothesis": h})

    def surrogate(self, model: dict):
        self._push({"type": "surrogate", "model": model})

    def report(self, report: dict):
        self._push({"type": "report", "report": report})
        self.flush()

    def benchmark(self, bench: dict):
        self._push({"type": "benchmark", "benchmark": bench})
        self.flush()


class NullEmitter(Emitter):
    def __init__(self):
        super().__init__(lambda _: None)

    def _push(self, *events):
        pass
