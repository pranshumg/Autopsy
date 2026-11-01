import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { PlatformPage } from "@/components/platform";
import { BenchmarkSuite } from "@/components/site/benchmarks";

export const metadata: Metadata = { title: "Benchmark suite" };

export default function BenchmarksPage() {
  return (
    <PlatformPage
      icon={BarChart3}
      tag="method benchmark // 10 synthetic targets"
      note="live benchmark suite"
      title={
        <>
          Measured on live black boxes.
          <br />
          <span className="pk">Not on slides.</span>
        </>
      }
      description="Every number on this page is computed in your browser against the built-in synthetic targets: full investigations, held-out predictive fit on sealed test sets, and an adaptive-vs-random comparison with equal training budgets and a shared held-out set. Negative and mixed results are shown as they are."
    >
      <BenchmarkSuite />
    </PlatformPage>
  );
}
