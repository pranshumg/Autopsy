// Input-space helpers: sampling designs and normalized coordinates.

import type { Feature, Input, NumericFeature, TargetSpec } from "@/lib/types";
import type { Rng } from "./stats";

/** Features spanning several orders of magnitude are explored on a log scale. */
export function isLogScale(f: Feature): boolean {
  return f.kind === "numeric" && f.min >= 0 && f.max / (f.min + 1) > 1000;
}

/** Map t in [0,1] to a feature value (log-aware, integer-aware). */
export function valueAt(f: NumericFeature, t: number): number {
  const c = Math.max(0, Math.min(1, t));
  let v: number;
  if (isLogScale(f)) {
    const a = Math.log(f.min + 1);
    const b = Math.log(f.max + 1);
    v = Math.exp(a + c * (b - a)) - 1;
  } else {
    v = f.min + c * (f.max - f.min);
  }
  if (f.integer) v = Math.round(v);
  else v = Math.round(v * 1e4) / 1e4;
  return Math.max(f.min, Math.min(f.max, v));
}

/** Inverse of valueAt for numeric features; level position for categorical ones. */
export function positionOf(f: Feature, v: unknown): number {
  if (f.kind === "categorical") {
    const i = f.levels.indexOf(String(v));
    return f.levels.length === 1 ? 0.5 : (i + 0.5) / f.levels.length;
  }
  const n = Number(v);
  if (isLogScale(f)) {
    const a = Math.log(f.min + 1);
    const b = Math.log(f.max + 1);
    return (Math.log(n + 1) - a) / (b - a);
  }
  return (n - f.min) / (f.max - f.min || 1);
}

export function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Latin hypercube over numeric fields, balanced rotation over categorical levels. */
export function latinHypercube(spec: TargetSpec, n: number, rng: Rng): Input[] {
  const rows: Input[] = Array.from({ length: n }, () => ({}));
  for (const f of spec.features) {
    if (f.kind === "numeric") {
      const perm = shuffle(
        Array.from({ length: n }, (_, i) => i),
        rng,
      );
      for (let i = 0; i < n; i++) rows[i][f.key] = valueAt(f, (perm[i] + rng()) / n);
    } else {
      const levels = shuffle(
        Array.from({ length: n }, (_, i) => f.levels[i % f.levels.length]),
        rng,
      );
      for (let i = 0; i < n; i++) rows[i][f.key] = levels[i];
    }
  }
  return rows;
}

export function randomInput(spec: TargetSpec, rng: Rng): Input {
  const x: Input = {};
  for (const f of spec.features) {
    x[f.key] = f.kind === "numeric" ? valueAt(f, rng()) : f.levels[Math.floor(rng() * f.levels.length)];
  }
  return x;
}

/** Normalized distance used for batch diversity in active learning. */
export function distance(spec: TargetSpec, a: Input, b: Input): number {
  let s = 0;
  for (const f of spec.features) {
    if (f.kind === "numeric") s += (positionOf(f, a[f.key]) - positionOf(f, b[f.key])) ** 2;
    else s += a[f.key] === b[f.key] ? 0 : 0.25;
  }
  return Math.sqrt(s / spec.features.length);
}
