import type { Metadata } from "next";
import { GuidedDemo } from "@/components/demo";
import { SiteShell } from "@/components/platform";

export const metadata: Metadata = { title: "Guided demo" };

export default function DemoPage() {
  return (
    <SiteShell>
      <GuidedDemo />
    </SiteShell>
  );
}
