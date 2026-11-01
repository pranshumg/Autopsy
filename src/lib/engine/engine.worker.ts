/// <reference lib="webworker" />
// Web worker hosting one investigation (or benchmark) so long-running
// statistics never block the UI thread.

import type { EngineEvent, WorkerCommand } from "@/lib/types";
import { createAdapter } from "@/lib/adapter";
import { InvestigationEngine } from "./orchestrator";
import { runBenchmark } from "./benchmark";

declare const self: DedicatedWorkerGlobalScope;

let engine: InvestigationEngine | null = null;
let benchCancelled = false;

const post = (id: string) => (events: EngineEvent[]) => self.postMessage({ id, events });

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const msg = e.data;
  switch (msg.cmd) {
    case "start":
      engine = new InvestigationEngine(msg.state, createAdapter(msg.state.target, { origin: msg.origin, credential: msg.credential }), post(msg.state.id));
      void engine.run();
      break;
    case "pause":
      engine?.pause();
      engine?.flush();
      break;
    case "resume":
      engine?.resume();
      engine?.flush();
      break;
    case "cancel":
      engine?.cancel();
      benchCancelled = true;
      break;
    case "pace":
      engine?.setPace(msg.pace);
      break;
    case "benchmark":
      benchCancelled = false;
      void runBenchmark(msg.state, createAdapter(msg.state.target, { origin: msg.origin, credential: msg.credential }), msg.seeds, post(msg.state.id), () => benchCancelled);
      break;
  }
};
