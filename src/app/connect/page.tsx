import type { Metadata } from "next";
import { ConnectBlackBox } from "@/components/connect";
import { SiteShell } from "@/components/platform";

export const metadata: Metadata = { title: "Connect a black box" };

export default function ConnectPage() {
  return (
    <SiteShell>
      <ConnectBlackBox />
    </SiteShell>
  );
}
