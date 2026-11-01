// Statistical primitives used by the Statistician agent.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1);
}

export const sd = (xs: number[]) => Math.sqrt(variance(xs));

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs: number[]) => quantile(xs, 0.5);

/** Percentile bootstrap CI for the mean. */
export function bootstrapCI(xs: number[], rng: Rng, iters = 1000, alpha = 0.05): [number, number] {
  if (xs.length === 0) return [0, 0];
  if (xs.length === 1) return [xs[0], xs[0]];
  const means = new Array<number>(iters);
  const n = xs.length;
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += xs[Math.floor(rng() * n)];
    means[i] = s / n;
  }
  return [quantile(means, alpha / 2), quantile(means, 1 - alpha / 2)];
}

/**
 * Two-sided sign-flip permutation test for paired differences (H0: symmetric
 * around zero). Exact for n <= 14, Monte-Carlo otherwise.
 */
export function signFlipP(diffs: number[], rng: Rng, iters = 4000): number {
  const n = diffs.length;
  if (n === 0) return 1;
  const obs = Math.abs(sum(diffs));
  if (obs === 0) return 1;
  let extreme = 0;
  let total = 0;
  if (n <= 14) {
    const combos = 1 << n;
    for (let mask = 0; mask < combos; mask++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += mask & (1 << j) ? -diffs[j] : diffs[j];
      if (Math.abs(s) >= obs - 1e-9) extreme++;
      total++;
    }
  } else {
    for (let i = 0; i < iters; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += rng() < 0.5 ? -diffs[j] : diffs[j];
      if (Math.abs(s) >= obs - 1e-9) extreme++;
      total++;
    }
    // add-one smoothing so Monte-Carlo p is never exactly zero
    return (extreme + 1) / (total + 1);
  }
  return extreme / total;
}

/** Map a p-value and effect clarity into a 0..1 confidence score. */
export function confidenceFrom(p: number, n: number, ciExcludesZero: boolean): number {
  const fromP = 1 - Math.min(1, p * 4);
  const fromN = 1 - Math.exp(-n / 10);
  const c = 0.55 * fromP + 0.3 * fromN + (ciExcludesZero ? 0.15 : 0);
  return Math.max(0.02, Math.min(0.995, c));
}

/** Least-squares line; returns SSE. */
export function linearSSE(xs: number[], ys: number[]): { sse: number; slope: number; intercept: number } {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  return { sse, slope, intercept };
}

/**
 * Best single-breakpoint piecewise model: separate linear fits either side of
 * a split between consecutive distinct x values. Returns the split midpoint
 * and the SSE.
 */
export function stepSSE(xs: number[], ys: number[]): { sse: number; split: number; lo: number; hi: number } {
  const order = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b]);
  const sx = order.map((i) => xs[i]);
  const sy = order.map((i) => ys[i]);
  const distinct = [...new Set(sx)];
  let best = { sse: Infinity, split: distinct[0], lo: distinct[0], hi: distinct[0] };
  for (let k = 1; k < distinct.length - 1; k++) {
    const cut = distinct[k];
    const li = sx.findIndex((x) => x >= cut);
    if (li < 3 || sx.length - li < 3) continue;
    const a = linearSSE(sx.slice(0, li), sy.slice(0, li));
    const b = linearSSE(sx.slice(li), sy.slice(li));
    const sse = a.sse + b.sse;
    if (sse < best.sse) best = { sse, split: (distinct[k - 1] + cut) / 2, lo: distinct[k - 1], hi: cut };
  }
  return best;
}

/** BIC for a Gaussian model with k parameters. */
export function bic(sse: number, n: number, k: number): number {
  const s = Math.max(sse / n, 1e-9);
  return n * Math.log(s) + k * Math.log(n);
}

export function r2(actual: number[], predicted: number[]): number {
  const m = mean(actual);
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < actual.length; i++) {
    ssr += (actual[i] - predicted[i]) ** 2;
    sst += (actual[i] - m) ** 2;
  }
  return sst === 0 ? 0 : 1 - ssr / sst;
}

export function rmse(actual: number[], predicted: number[]): number {
  if (!actual.length) return 0;
  let s = 0;
  for (let i = 0; i < actual.length; i++) s += (actual[i] - predicted[i]) ** 2;
  return Math.sqrt(s / actual.length);
}

export function mae(actual: number[], predicted: number[]): number {
  if (!actual.length) return 0;
  let s = 0;
  for (let i = 0; i < actual.length; i++) s += Math.abs(actual[i] - predicted[i]);
  return s / actual.length;
}
