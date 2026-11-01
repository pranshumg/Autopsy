"""Engine HTTP API consumed by the AUTOPSY web UI (via the Next.js /api/engine proxy).

GET  /health
GET  /targets                         public specs of the Python targets
POST /runs                            start an investigation  {id, target, budget, seed?, pace?, strategy?}
GET  /runs/{id}/events                Server-Sent Events: EngineEvent batches (replayed from the start)
POST /runs/{id}/pause|resume|cancel
GET  /runs/{id}/scorecard             after the run: discovered vs hidden rules
POST /targets/{id}/query              manual / "test this finding" queries  {inputs: [...]}
POST /benchmark                       active vs random  {id, target, budget, seeds}
GET  /benchmark/{id}/events
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from autopsy import causal, config
from autopsy.benchmark import run_benchmark
from autopsy.llm import LLM
from autopsy.orchestrator import Run
from autopsy.probes import TargetUnavailable, fetch_schema
from autopsy.scorecard import fetch_truth, items_from_effects, score

app = FastAPI(title="AUTOPSY engine")
PREFIX = "py-"


class Channel:
    """Event log for one run: replayable, so a reconnecting browser sees everything."""

    def __init__(self):
        self.batches: list[list[dict]] = []
        self.closed = False
        self.lock = threading.Lock()

    def push(self, events: list[dict]):
        with self.lock:
            self.batches.append(events)
            if any(e.get("type") == "status" and e.get("status") in ("completed", "cancelled", "error") for e in events):
                self.closed = True
            if any(e.get("type") == "benchmark" and e["benchmark"].get("status") in ("done", "cancelled", "error") for e in events):
                self.closed = True


RUNS: dict[str, tuple[Run | None, Channel]] = {}
BENCH: dict[str, tuple[dict[str, Any], Channel]] = {}


def to_spec(schema: dict) -> dict:
    spec = {k: v for k, v in schema.items() if k != "context"}
    spec["id"] = PREFIX + schema["id"]
    spec["origin"] = "python"
    spec["endpoint"] = f"{config.TARGETS_URL}/{schema['id']}/quote"
    return spec


def target_of(spec_id: str) -> str:
    return spec_id[len(PREFIX):] if spec_id.startswith(PREFIX) else spec_id


@app.get("/health")
def health():
    llm = LLM()
    ok = {}
    for t in config.TARGET_IDS:
        try:
            fetch_schema(t)
            ok[t] = True
        except TargetUnavailable:
            ok[t] = False
    return {"ok": True, "targets": ok, "llm": llm.label, "llmAvailable": llm.check(), "memory": config.MEMORY_BACKEND, "dowhy": causal.HAVE_DOWHY}


@app.get("/targets")
def targets():
    out, errors = [], []
    for t in config.TARGET_IDS:
        try:
            out.append(to_spec(fetch_schema(t)))
        except TargetUnavailable as e:
            errors.append(str(e))
    return {"targets": out, "errors": errors}


class StartRun(BaseModel):
    id: str
    target: str
    budget: int = Field(default=500, ge=50, le=5000)
    seed: int | None = None
    pace: str = "standard"
    strategy: str = "active"


@app.post("/runs")
def start_run(body: StartRun):
    if body.id in RUNS and RUNS[body.id][0] and RUNS[body.id][0].status == "running":
        raise HTTPException(409, "run already in progress")
    ch = Channel()
    try:
        run = Run(target_of(body.target), budget=body.budget, seed=body.seed, sink=ch.push, strategy=body.strategy, pace=body.pace, run_id=body.id)
    except TargetUnavailable as e:
        raise HTTPException(503, str(e)) from e
    RUNS[body.id] = (run, ch)
    threading.Thread(target=_safe(run.run), daemon=True).start()
    return {"id": body.id, "seed": run.seed, "llm": run.ctx.llm.label}


def _safe(fn):
    def wrapped():
        try:
            fn()
        except Exception:  # noqa: BLE001 - already reported as an error event
            pass

    return wrapped


def _stream(ch: Channel, request: Request | None = None):
    # every batch carries its index as the SSE id, so a browser that reconnects
    # (EventSource sends Last-Event-ID) resumes after the last batch it received
    try:
        start = int(request.headers.get("last-event-id", "0")) if request is not None else 0
    except ValueError:
        start = 0

    async def gen():
        i = max(0, start)
        last = time.time()
        while True:
            with ch.lock:
                new = ch.batches[i:]
                closed = ch.closed
            for k, b in enumerate(new):
                yield f"id: {i + k + 1}\ndata: {json.dumps(b)}\n\n"
            i += len(new)
            if new:
                last = time.time()
            if closed and not new:
                yield "event: end\ndata: {}\n\n"
                return
            if time.time() - last > 15:
                yield ": keep-alive\n\n"
                last = time.time()
            await asyncio.sleep(0.1)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-cache", "x-accel-buffering": "no"})


@app.get("/runs/{run_id}/events")
def run_events(run_id: str, request: Request):
    if run_id not in RUNS:
        raise HTTPException(404, "unknown run (the engine may have restarted)")
    return _stream(RUNS[run_id][1], request)


@app.post("/runs/{run_id}/{action}")
def control(run_id: str, action: str):
    run = RUNS.get(run_id, (None, None))[0]
    if not run:
        raise HTTPException(404, "unknown run")
    if action == "pause":
        run.pause()
    elif action == "resume":
        run.resume()
    elif action == "cancel":
        run.cancel()
    elif action == "pace":
        pass
    else:
        raise HTTPException(400, "unknown action")
    return {"ok": True}


@app.get("/runs/{run_id}/scorecard")
def scorecard(run_id: str):
    run = RUNS.get(run_id, (None, None))[0]
    if not run:
        raise HTTPException(404, "unknown run (the engine may have restarted)")
    if run.status not in ("completed", "cancelled", "error"):
        raise HTTPException(409, "the scorecard is available only after the run stops")
    findings = run.memory.read_fact("findings", {})
    truth = fetch_truth(run.ctx.target_id)
    sc = score(truth, items_from_effects(findings.get("effects", {}), findings.get("interactions", [])))
    sc["queries"] = run.client.used
    sc["requests"] = run.client.requests
    return sc


class Query(BaseModel):
    inputs: list[dict[str, Any]] = Field(min_length=1, max_length=64)


@app.post("/targets/{spec_id}/query")
def manual_query(spec_id: str, body: Query):
    t = target_of(spec_id)
    schema = fetch_schema(t)
    key = schema["output"]["key"]
    outs = []
    t0 = time.time()
    with httpx.Client(timeout=10) as http:
        for x in body.inputs:
            r = http.post(f"{config.TARGETS_URL}/{t}/quote", json=x)
            if r.status_code >= 400:
                raise HTTPException(422, f"target rejected input: {r.text[:200]}")
            outs.append(float(r.json()[key]))
    return {"outputs": outs, "receipt": {"id": f"rcpt_{int(t0 * 1000)}", "served": len(outs), "latencyMs": int((time.time() - t0) * 1000), "at": int(t0 * 1000)}}


class StartBench(BaseModel):
    id: str
    target: str
    budget: int = Field(default=500, ge=50, le=3000)
    seeds: int = Field(default=3, ge=1, le=10)


@app.post("/benchmark")
def start_benchmark(body: StartBench):
    ch = Channel()
    state = {"cancel": False}
    BENCH[body.id] = (state, ch)

    def work():
        try:
            run_benchmark(target_of(body.target), body.budget, body.seeds, lambda b: ch.push([{"type": "benchmark", "benchmark": dict(b)}]), lambda: state["cancel"])
        except Exception as e:  # noqa: BLE001
            ch.push([{"type": "benchmark", "benchmark": {"status": "error", "error": f"{type(e).__name__}: {e}", "seeds": body.seeds, "holdoutSize": 0, "queriesUsed": 0, "adaptive": [], "random": [], "startedAt": int(time.time() * 1000), "progress": 0}}])

    threading.Thread(target=work, daemon=True).start()
    return {"id": body.id}


@app.get("/benchmark/{bench_id}/events")
def bench_events(bench_id: str, request: Request):
    if bench_id not in BENCH:
        raise HTTPException(404, "unknown benchmark")
    return _stream(BENCH[bench_id][1], request)


@app.post("/benchmark/{bench_id}/cancel")
def bench_cancel(bench_id: str):
    if bench_id in BENCH:
        BENCH[bench_id][0]["cancel"] = True
    return {"ok": True}
