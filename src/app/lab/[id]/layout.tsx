import { Suspense } from "react";
import { InvestigationShell, ShellFallback } from "@/components/lab/shell";

export const instant = false;

export default function InvestigationLayout({ children }: LayoutProps<"/lab/[id]">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <InvestigationShell>{children}</InvestigationShell>
    </Suspense>
  );
}
