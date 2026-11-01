"""Agent base class and the shared run context.

Agents communicate ONLY through the blackboard (Memory). Every message is
{from, to, type, content, reason}. Each agent reacts to open messages addressed to it.
"""

from __future__ import annotations

import itertools
import random
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from autopsy.events import Emitter, now_ms
from autopsy.llm import LLM
from autopsy.memory import Memory, Message
from autopsy.probes import ProbeStore, TargetClient

PHASE_OF = {
    "make_personas": "recon",
    "personas_ready": "recon",
    "measure_noise": "recon",
    "noise_data": "recon",
    "holdout": "recon",
    "holdout_data": "recon",
    "screen": "screening",
    "screen_data": "screening",
    "interaction": "interactions",
    "interaction_data": "interactions",
    "conditional": "interactions",
    "probe": "active",
    "probe_data": "active",
    "make_matched": "structure",
    "confirm": "structure",
    "confirm_personas": "structure",
    "confirm_data": "structure",
    "analysis_complete": "synthesis",
    "budget_exhausted": "synthesis",
    "more_evidence": "active",
}


@dataclass
class Context:
    run_id: str
    target_id: str
    schema: dict[str, Any]
    memory: Memory
    store: ProbeStore
    client: TargetClient
    emit: Emitter
    llm: LLM
    seed: int
    use_dowhy: bool = True
    strategy: str = "active"  # "active" | "random"
    rng: np.random.Generator = field(init=False)
    py: random.Random = field(init=False)
    exp_ids: Any = field(default_factory=lambda: itertools.count(1))
    hyp_versions: dict[str, int] = field(default_factory=dict)

    def __post_init__(self):
        self.rng = np.random.default_rng(self.seed)
        self.py = random.Random(self.seed)

    @property
    def features(self) -> list[dict]:
        return self.schema["features"]

    def feature(self, key: str) -> dict:
        return next(f for f in self.features if f["key"] == key)

    def new_experiment_id(self) -> str:
        return f"exp_{next(self.exp_ids):03d}"


class Agent:
    name = "agent"
    title = "Agent"

    def __init__(self, ctx: Context):
        self.ctx = ctx

    # helpers ---------------------------------------------------------------
    @property
    def mem(self) -> Memory:
        return self.ctx.memory

    def log(self, text: str, level: str = "info"):
        self.ctx.emit.log(self.name, text, level)

    def post(self, to: str, type_: str, content: dict | None = None, reason: str = "") -> Message:
        msg = self.mem.post_message({"from": self.name, "to": to, "type": type_, "content": content or {}, "reason": reason})
        self.ctx.emit.handoff(self.name, to, f"{type_}: {reason}" if reason else type_)
        self.ctx.emit.log(self.name, f"→ {to} · {type_}" + (f" — {reason}" if reason else ""))
        return msg

    def run_turn(self, msg: Message) -> None:
        """Handle one message, wrapped in a UI task."""
        phase = PHASE_OF.get(msg["type"], "active")
        task = {
            "id": f"task_{msg['id']}",
            "agent": self.name,
            "title": f"{self.title}: {msg['type'].replace('_', ' ')}",
            "phase": phase,
            "status": "running",
            "startedAt": now_ms(),
            "inputs": msg.get("reason") or msg["type"],
            "queries": 0,
        }
        before = self.ctx.client.used
        self.ctx.emit.task(task)
        self.ctx.emit.agent(self.name, status="working", currentTaskId=task["id"])
        started = time.time()
        try:
            out = self.handle(msg) or ""
            task.update(status="done", outputs=out)
        except Exception as e:
            task.update(status="error", outputs=str(e))
            raise
        finally:
            q = self.ctx.client.used - before
            task.update(endedAt=now_ms(), queries=q)
            self.ctx.emit.task(task)
            done = self.mem.read_fact(f"_turns:{self.name}", 0) + 1
            self.mem.write_fact(f"_turns:{self.name}", done, "system")
            spent = self.mem.read_fact(f"_queries:{self.name}", 0) + q
            self.mem.write_fact(f"_queries:{self.name}", spent, "system")
            self.ctx.emit.agent(self.name, status="idle", currentTaskId=None, completed=done, queries=spent)
            _ = started

    def handle(self, msg: Message) -> str | None:  # pragma: no cover - abstract
        raise NotImplementedError
