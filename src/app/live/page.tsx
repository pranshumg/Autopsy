import type { Metadata } from "next";
import { SiteShell } from "@/components/platform";
import { LiveConsole } from "@/components/site/live-console";

export const metadata: Metadata = { title: "Live investigation" };

export default function LivePage() {
  return (
    <SiteShell>
      <main className="s-page">
        <div className="s-wrap">
          <LiveConsole />
        </div>
      </main>
    </SiteShell>
  );
}
