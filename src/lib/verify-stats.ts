// Statistics for controlled re-tests of a finding: repeated queries of a
// baseline and a variant input. Small samples, possibly zero variance.

import { mulberry32 } from "@/lib/engine/stats";

const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/** Two-sided 97.5% Student-t quantile (df rounded down; normal beyond 30). */
export function t975(df: number): number {
  if (!Number.isFinite(df) || df >= 31) return df >= 120 ? 1.96 : 2.0;
  return T975[Math.max(1, Math.floor(df)) - 1];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0;
};

export type DiffResult = { meanDiff: number; ci: [number, number]; p: number; df: number; sdBaseline: number; sdVariant: number; method: string; deterministic: boolean };

/** Mean difference (variant − baseline), Welch 95% interval and a permutation p-value. */
export function compareArms(baseline: number[], variant: number[], seed = 1): DiffResult {
  if (baseline.length < 2 || variant.length < 2) throw new Error("need at least two observations per arm");
  const d = mean(variant) - mean(baseline);
  const vb = variance(baseline) / baseline.length;
  const vv = variance(variant) / variant.length;
  const se = Math.sqrt(vb + vv);
  const deterministic = se === 0;
  const df = deterministic ? Infinity : (vb + vv) ** 2 / ((vb * vb) / (baseline.length - 1) + (vv * vv) / (variant.length - 1));
  const half = deterministic ? 0 : t975(df) * se;
  const p = permutationP(baseline, variant, seed);
  return {
    meanDiff: d,
    ci: [d - half, d + half],
    p,
    df,
    sdBaseline: Math.sqrt(variance(baseline)),
    sdVariant: Math.sqrt(variance(variant)),
    deterministic,
    method: deterministic
      ? "Identical outputs within each arm (no sampling variation observed); interval collapses to the observed difference. Permutation test on the difference in means."
      : `Welch two-sample t interval (df ≈ ${df.toFixed(1)}); two-sided permutation test on the difference in means.`,
  };
}

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Two-sided permutation p-value for a difference in means; exact when feasible, Monte Carlo otherwise. */
export function permutationP(a: number[], b: number[], seed = 1): number {
  const all = [...a, ...b];
  const n = all.length;
  const k = a.length;
  const total = all.reduce((s, x) => s + x, 0);
  const obs = Math.abs(mean(b) - mean(a));
  const eps = 1e-9 * (1 + obs);
  const stat = (sumA: number) => Math.abs((total - sumA) / (n - k) - sumA / k);
  if (choose(n, k) <= 20000) {
    let hits = 0;
    let count = 0;
    const rec = (start: number, left: number, sum: number) => {
      if (left === 0) {
        count++;
        if (stat(sum) >= obs - eps) hits++;
        return;
      }
      for (let i = start; i <= n - left; i++) rec(i + 1, left - 1, sum + all[i]);
    };
    rec(0, k, 0);
    return hits / count;
  }
  const rng = mulberry32(seed);
  const iters = 5000;
  let hits = 0;
  const idx = all.map((_, i) => i);
  for (let it = 0; it < iters; it++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    let s = 0;
    for (let i = 0; i < k; i++) s += all[idx[i]];
    if (stat(s) >= obs - eps) hits++;
  }
  return (hits + 1) / (iters + 1);
}
