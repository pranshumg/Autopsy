import type { Metadata } from "next";
import { SiteShell } from "@/components/platform";
import { DocsView } from "@/components/site/docs";

export const metadata: Metadata = { title: "Workflow documentation" };

export default function DocsPage() {
  return (
    <SiteShell>
      <DocsView />
    </SiteShell>
  );
}
