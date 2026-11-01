import type { Metadata } from "next";
import { Registry } from "@/components/registry";
import { SiteShell } from "@/components/platform";

export const metadata: Metadata = { title: "Investigation lab" };

export default function LabIndexPage() {
  return (
    <SiteShell>
      <Registry />
    </SiteShell>
  );
}
