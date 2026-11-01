import type { Metadata } from "next";
import { Workflow } from "lucide-react";
import { PlatformPage } from "@/components/platform";
import { MethodStepper } from "@/components/site/method";

export const metadata: Metadata = { title: "Investigation method" };

export default function MethodPage() {
  return (
    <PlatformPage
      icon={Workflow}
      tag="six-phase investigation method"
      note="from recon to rulebook"
      title={
        <>
          Characterize behavior
          <br />
          <span className="pk">one controlled query at a time.</span>
        </>
      }
      description="A repeatable experimental protocol for learning how a decision system behaves using only its inputs and outputs. Each phase decides what the next one should ask."
    >
      <MethodStepper />
    </PlatformPage>
  );
}
