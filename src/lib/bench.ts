// Honest summary of the adaptive-vs-random benchmark: per-run outcomes,
// no confidence-interval language for min/max ranges, and an explicit
// "inconclusive" when runs disagree or there is only one.

import type { Benchmark } from "@/lib/types";

export type BenchVerdict = {
  runs: number;
  adaptiveWins: number;
  meanRelDiff: number;
  minRelDiff: number;
  maxRelDiff: number;
  label: "adaptive lower" | "random lower" | "inconclusive";
  text: string;
};

/** Relative difference per run = (random − adaptive) / random; positive favours adaptive. */
export function benchmarkVerdict(b: Pick<Benchmark, "finals">): BenchVerdict | null {
  const a = b.finals?.adaptive ?? [];
  const r = b.finals?.random ?? [];
  const runs = Math.min(a.length, r.length);
  if (!runs) return null;
  const rel = Array.from({ length: runs }, (_, i) => (r[i] > 0 ? (r[i] - a[i]) / r[i] : 0));
  const adaptiveWins = rel.filter((x) => x > 0).length;
  const meanRelDiff = rel.reduce((s, x) => s + x, 0) / runs;
  const base = { runs, adaptiveWins, meanRelDiff, minRelDiff: Math.min(...rel), maxRelDiff: Math.max(...rel) };
  if (runs < 2) return { ...base, label: "inconclusive", text: "Single run: no estimate of run-to-run variation, so no conclusion is drawn." };
  if (adaptiveWins === runs) return { ...base, label: "adaptive lower", text: `Adaptive sampling had lower held-out error in all ${runs} runs.` };
  if (adaptiveWins === 0) return { ...base, label: "random lower", text: `Random sampling had lower held-out error in all ${runs} runs.` };
  return { ...base, label: "inconclusive", text: `Mixed: adaptive was lower in ${adaptiveWins} of ${runs} runs. No consistent advantage.` };
}
