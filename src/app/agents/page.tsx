import type { Metadata } from "next";
import { Network } from "lucide-react";
import { PlatformPage } from "@/components/platform";
import { AgentRoster } from "@/components/site/agents";

export const metadata: Metadata = { title: "Agent architecture" };

export default function AgentsPage() {
  return (
    <PlatformPage
      icon={Network}
      tag="multi-agent architecture"
      note="handoff protocol"
      title={
        <>
          Four specialists.
          <br />
          <span className="pk">One chain of evidence.</span>
        </>
      }
      description="Each agent owns one job and writes everything it does into a shared investigation record. They are statistical procedures, not chatbots: every step is an observable operation you can audit."
    >
      <AgentRoster />
    </PlatformPage>
  );
}
