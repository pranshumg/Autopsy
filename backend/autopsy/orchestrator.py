"""Orchestrator: routes turns on the blackboard.

Any agent with an open message addressed to it acts next (oldest message first).
The run stops when there are no open requests, or the budget is spent and the
rulebook has been written. Strategy "active" uses the full agent loop with active
learning; strategy "random" is the baseline (random paired probes).
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Callable

from autopsy import config
from autopsy.agents.base import PHASE_OF, Context
from autopsy.agents.experimenter import ExperimenterAgent
from autopsy.agents.persona import PersonaAgent
from autopsy.agents.reporter import ReporterAgent
from autopsy.agents.statistician import StatisticianAgent
from autopsy.events import Emitter
from autopsy.llm import LLM
from autopsy.memory import make_memory
from autopsy.probes import ProbeStore, TargetClient, TargetUnavailable, fetch_schema

PHASES = ["recon", "screening", "structure", "interactions", "active", "synthesis"]
PACE_DELAY = {"cinematic": 0.35, "standard": 0.08, "instant": 0.0}


class Run:
    def __init__(self, target_id: str, budget: int = 500, seed: int | None = None, sink: Callable[[list[dict]], None] | None = None, strategy: str = "active", use_llm: bool = True, use_dowhy: bool = True, pace: str = "standard", run_id: str | None = None, db_path: str | None = None):
        self.run_id = run_id or f"run_{uuid.uuid4().hex[:10]}"
        self.seed = seed if seed is not None else int(time.time()) % 2**31
        self.emit = Emitter(sink or (lambda _: None))
        self.schema = fetch_schema(target_id)
        reset_target_noise(target_id)
        self.memory = make_memory(self.run_id) if db_path is None else make_memory_at(self.run_id, db_path)
        self.store = ProbeStore(self.run_id, db_path)
        self.client = TargetClient(target_id, self.schema, budget, self.store, on_probe=self.emit.observations, on_request=self.emit.requests)
        llm = LLM()
        if not use_llm:
            llm.provider = "off"
        self.ctx = Context(self.run_id, target_id, self.schema, self.memory, self.store, self.client, self.emit, llm, self.seed, use_dowhy=use_dowhy, strategy=strategy)
        self.agents = {a.name: a for a in (PersonaAgent(self.ctx), ExperimenterAgent(self.ctx), StatisticianAgent(self.ctx), ReporterAgent(self.ctx))}
        self.pace = pace
        self.paused = threading.Event()
        self.paused.set()
        self.cancelled = False
        self.status = "idle"
        self.phase: str | None = None
        self.turns = 0

    # ------------------------------------------------------------- controls
    def pause(self):
        self.paused.clear()
        self.emit.status("paused")

    def resume(self):
        self.paused.set()
        self.emit.status("running")

    def cancel(self):
        self.cancelled = True
        self.client.cancelled = True
        self.paused.set()

    # ------------------------------------------------------------------ run
    def kickoff(self):
        F = len(self.schema["features"])
        budget = self.client.budget
        n_base = max(4, min(16, int(budget * 0.25 / (F + 1))))
        n_hold = 0 if self.ctx.strategy == "random" and budget < 100 else max(15, min(50, int(budget * 0.06)))
        boss = "orchestrator"
        post = lambda to, t, c, r: (self.memory.post_message({"from": boss, "to": to, "type": t, "content": c, "reason": r}), self.emit.handoff(boss, to, f"{t}: {r}"), self.emit.log(boss, f"→ {to} · {t} — {r}"))
        post("persona", "make_personas", {"set": "base", "n": n_base, "purpose": "base", "reply_to": "experimenter"}, f"{n_base} diverse base personas for screening")
        post("persona", "make_personas", {"set": "pool", "n": 30, "purpose": "pool", "constraints": "a broad, realistic mix", "reply_to": "experimenter"}, "30-persona pool for follow-up probes")
        if n_hold:
            post("persona", "make_personas", {"set": "holdout", "n": n_hold, "purpose": "holdout", "constraints": "realistic customers as they occur in the real population", "reply_to": "experimenter"}, f"{n_hold} realistic held-out personas")

    def run(self) -> dict[str, Any]:
        self.status = "running"
        self.emit.status("running")
        self.emit.log("system", f"Investigating {self.schema['name']} · budget {self.client.budget} · seed {self.seed} · LLM {self.ctx.llm.label} · memory {config.MEMORY_BACKEND} · strategy {self.ctx.strategy}")
        try:
            self.kickoff()
            while not self.cancelled:
                self.paused.wait()
                msg = self.memory.next_open()
                if msg is None:
                    break
                agent = self.agents.get(msg["to"])
                if agent is None:
                    self.memory.resolve(msg["id"])
                    continue
                phase = PHASE_OF.get(msg["type"], self.phase or "recon")
                if phase != self.phase:
                    if self.phase:
                        self.emit.progress(self.phase, 1.0)
                    self.phase = phase
                    self.emit.phase(phase)
                self.emit.progress(phase, min(0.95, self.client.used / max(1, self.client.budget)))
                self.memory.resolve(msg["id"])
                agent.run_turn(msg)
                self.turns += 1
                if self.turns > 400:
                    self.emit.log("system", "Turn limit reached; stopping", "warn")
                    break
                if PACE_DELAY.get(self.pace):
                    time.sleep(PACE_DELAY[self.pace])
            if self.cancelled:
                self.status = "cancelled"
                self.emit.status("cancelled")
            else:
                for p in PHASES:
                    self.emit.progress(p, 1.0)
                self.emit.phase(None)
                self.status = "completed"
                self.emit.log("system", f"Done: {self.client.used}/{self.client.budget} queries, {self.client.requests} HTTP requests, {self.turns} agent turns", "ok")
                self.emit.status("completed")
        except TargetUnavailable as e:
            self.status = "error"
            self.emit.log("system", str(e), "error")
            self.emit.status("error", str(e))
        except Exception as e:  # noqa: BLE001
            self.status = "error"
            self.emit.log("system", f"{type(e).__name__}: {e}", "error")
            self.emit.status("error", f"{type(e).__name__}: {e}")
            raise
        finally:
            self.emit.flush()
        return {"status": self.status, "used": self.client.used, "rulebook": self.memory.read_fact("rulebook", []), "findings": self.memory.read_fact("findings", {})}


def reset_target_noise(target_id: str) -> None:
    """Mock targets with AUTOPSY_TARGET_SEED expose POST /reset so a seeded demo replays exactly.
    Real targets have no such endpoint; a 404 is ignored. Agents never call this."""
    import httpx

    try:
        httpx.post(f"{config.TARGETS_URL}/{target_id}/reset", timeout=3)
    except httpx.HTTPError:
        pass


def make_memory_at(run_id: str, path: str):
    from autopsy.memory import SQLiteMemory

    return SQLiteMemory(run_id, path)
