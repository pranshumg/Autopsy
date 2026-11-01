"use client";

import { LabView, useCurrent } from "./context";
import { AgentCommand } from "./agents";
import { ExperimentExplorer } from "./experiments";
import { HypothesisMap } from "./hypotheses";
import { ActiveLearning } from "./learning";
import { Rulebook } from "./rulebook";
import { SurrogateExplorer } from "./surrogate";
import { Workspace } from "./workspace";

const VIEWS = {
  laboratory: Workspace,
  agents: AgentCommand,
  experiments: ExperimentExplorer,
  hypotheses: HypothesisMap,
  learning: ActiveLearning,
  surrogate: SurrogateExplorer,
  rulebook: Rulebook,
} as const;

export type LabViewName = keyof typeof VIEWS;

/** Renders one investigation view from the client-side store. */
export function LabRoute({ view }: { view: LabViewName }) {
  const inv = useCurrent();
  const View = VIEWS[view];
  return (
    <LabView>
      <div className="h-full">
        <View inv={inv} />
      </div>
    </LabView>
  );
}
