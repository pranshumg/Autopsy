import type { Metadata } from "next";
import { Database } from "lucide-react";
import { PlatformPage } from "@/components/platform";
import { TargetCatalog } from "@/components/site/targets";

export const metadata: Metadata = { title: "Black-box targets" };

export default function TargetsPage() {
  return (
    <PlatformPage
      icon={Database}
      tag="target registry & contracts"
      note="10 built-in synthetic endpoints"
      title={
        <>
          Black-box decision systems
          <br />
          <span className="pk">open for interrogation.</span>
        </>
      }
      description="Each built-in target is a synthetic demonstration that publishes only what a real vendor would: an input schema and a query endpoint. The decision logic runs on the server and is never sent to the browser. To audit your own API, use Connect a black box."
    >
      <TargetCatalog />
    </PlatformPage>
  );
}
