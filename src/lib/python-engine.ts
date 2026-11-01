// Client for the Python multi-agent engine (backend/). Exposes the same
// postMessage/terminate surface as the in-browser engine worker, so the store
// drives both the same way. Events arrive over Server-Sent Events in the exact
// EngineEvent shape the reducer already understands.

import type { EngineEvent, WorkerCommand } from "@/lib/types";

const BASE = "/api/engine";

async function post(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${BASE}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
    throw new Error(data?.error ?? data?.detail ?? `Engine HTTP ${res.status}`);
  }
  return res;
}

export class PythonEngineHandle {
  private source: EventSource | null = null;
  private runId = "";
  private benchId = "";
  private ended = false;

  constructor(private onEvents: (events: EngineEvent[]) => void) {}

  private fail(message: string) {
    this.onEvents([
      { type: "log", line: { id: Date.now(), t: Date.now(), source: "system", level: "error", text: message } },
      { type: "status", status: "error", error: message },
    ]);
  }

  private listen(path: string, onFail: (msg: string) => void) {
    this.source?.close();
    this.ended = false;
    const es = new EventSource(`${BASE}/${path}`);
    this.source = es;
    // A dropped connection is not a failed run: the engine keeps working, and the browser
    // reconnects on its own, sending Last-Event-ID so the engine resumes after the last batch.
    // Give up only if the stream is closed for good, or reconnects keep failing.
    let failures = 0;
    es.onmessage = (e) => {
      failures = 0;
      try {
        this.onEvents(JSON.parse(e.data) as EngineEvent[]);
      } catch {
        /* ignore malformed batch */
      }
    };
    es.addEventListener("end", () => {
      this.ended = true;
      es.close();
    });
    es.onerror = () => {
      if (this.ended) return;
      failures++;
      if (es.readyState === EventSource.CLOSED || failures >= 8) {
        es.close();
        onFail("Lost connection to the Python engine. Is `uv run python run.py` still running?");
      }
    };
  }

  postMessage(cmd: WorkerCommand) {
    switch (cmd.cmd) {
      case "start":
        this.runId = cmd.state.id;
        post("runs", { id: cmd.state.id, target: cmd.state.target.id, budget: cmd.state.budget.limit, seed: cmd.state.seed, pace: cmd.state.pace })
          .then(() => this.listen(`runs/${this.runId}/events`, (m) => this.fail(m)))
          .catch((e: Error) => this.fail(e.message));
        break;
      case "pause":
      case "resume":
      case "cancel":
        if (this.benchId && cmd.cmd === "cancel") void post(`benchmark/${this.benchId}/cancel`).catch(() => {});
        if (this.runId) void post(`runs/${this.runId}/${cmd.cmd}`).catch(() => {});
        break;
      case "benchmark":
        this.benchId = `${cmd.state.id}-bench-${Date.now().toString(36)}`;
        post("benchmark", { id: this.benchId, target: cmd.state.target.id, budget: cmd.state.budget.limit, seeds: cmd.seeds })
          .then(() =>
            this.listen(`benchmark/${this.benchId}/events`, (m) =>
              this.onEvents([{ type: "log", line: { id: Date.now(), t: Date.now(), source: "system", level: "error", text: m } }]),
            ),
          )
          .catch((e: Error) => this.onEvents([{ type: "log", line: { id: Date.now(), t: Date.now(), source: "system", level: "error", text: e.message } }]));
        break;
      case "pace":
        break;
    }
  }

  terminate() {
    this.ended = true;
    this.source?.close();
    this.source = null;
  }
}

export type Scorecard = {
  rules: { id: string; text: string; features: string[]; verdict: "recovered" | "partial" | "missed" }[];
  found: number;
  partial: number;
  total: number;
  falsePositives: { features: string[]; levels: string[] | null }[];
  decoys: { id: string; text: string; features: string[]; fooled: boolean }[];
  queries: number;
  requests: number;
};

export async function fetchScorecard(runId: string): Promise<Scorecard> {
  const res = await fetch(`${BASE}/runs/${runId}/scorecard`);
  const data = (await res.json().catch(() => null)) as (Scorecard & { error?: string; detail?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? data?.detail ?? `Scorecard failed (HTTP ${res.status})`);
  return data;
}

export async function fetchEngineTargets() {
  const res = await fetch(`${BASE}/targets`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { targets: import("@/lib/types").TargetSpec[]; errors: string[] };
}
