// CART regression trees over mixed numeric / categorical inputs, plus a
// bootstrap ensemble used for uncertainty estimates in active learning.

import type { Feature, Input, TreeNode } from "@/lib/types";
import { mean, sd, type Rng } from "./stats";

type Row = { x: Input; y: number };

export type TreeOptions = {
  maxDepth: number;
  minLeaf: number;
  minGain?: number;
  featureFraction?: number;
  rng?: Rng;
};

let nodeId = 0;

function sse(ys: number[]): number {
  if (ys.length < 2) return 0;
  const m = mean(ys);
  let s = 0;
  for (const y of ys) s += (y - m) ** 2;
  return s;
}

type Split = {
  gain: number;
  feature: string;
  threshold?: number;
  levels?: string[];
  left: Row[];
  right: Row[];
};

function bestSplit(rows: Row[], features: Feature[], minLeaf: number): Split | null {
  const parent = sse(rows.map((r) => r.y));
  let best: Split | null = null;

  for (const f of features) {
    if (f.kind === "numeric") {
      const sorted = [...rows].sort((a, b) => Number(a.x[f.key]) - Number(b.x[f.key]));
      const n = sorted.length;
      // prefix sums for O(n) evaluation of every cut point
      const ps = new Float64Array(n + 1);
      const ps2 = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) {
        ps[i + 1] = ps[i] + sorted[i].y;
        ps2[i + 1] = ps2[i] + sorted[i].y * sorted[i].y;
      }
      for (let i = minLeaf; i <= n - minLeaf; i++) {
        const xl = Number(sorted[i - 1].x[f.key]);
        const xr = Number(sorted[i].x[f.key]);
        if (xl === xr) continue;
        const ls = ps[i];
        const ls2 = ps2[i];
        const rs = ps[n] - ls;
        const rs2 = ps2[n] - ls2;
        const childSSE = ls2 - (ls * ls) / i + (rs2 - (rs * rs) / (n - i));
        const gain = parent - childSSE;
        if (!best || gain > best.gain) {
          best = { gain, feature: f.key, threshold: (xl + xr) / 2, left: sorted.slice(0, i), right: sorted.slice(i) };
        }
      }
    } else {
      // order levels by mean response: optimal binary partition for regression
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const k = String(r.x[f.key]);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r.y);
      }
      if (groups.size < 2) continue;
      const ordered = [...groups.entries()].sort((a, b) => mean(a[1]) - mean(b[1])).map(([k]) => k);
      for (let i = 1; i < ordered.length; i++) {
        const leftLevels = new Set(ordered.slice(0, i));
        const left = rows.filter((r) => leftLevels.has(String(r.x[f.key])));
        const right = rows.filter((r) => !leftLevels.has(String(r.x[f.key])));
        if (left.length < minLeaf || right.length < minLeaf) continue;
        const gain = parent - sse(left.map((r) => r.y)) - sse(right.map((r) => r.y));
        if (!best || gain > best.gain) {
          best = { gain, feature: f.key, levels: [...leftLevels], left, right };
        }
      }
    }
  }
  return best;
}

function grow(rows: Row[], features: Feature[], depth: number, opts: TreeOptions, totalSSE: number): TreeNode {
  const ys = rows.map((r) => r.y);
  const node: TreeNode = { id: nodeId++, n: rows.length, value: mean(ys), sd: sd(ys), depth };
  if (depth >= opts.maxDepth || rows.length < opts.minLeaf * 2) return node;

  let feats = features;
  if (opts.featureFraction && opts.featureFraction < 1 && opts.rng) {
    const k = Math.max(1, Math.round(features.length * opts.featureFraction));
    feats = [...features].sort(() => opts.rng!() - 0.5).slice(0, k);
  }
  const split = bestSplit(rows, feats, opts.minLeaf);
  const minGain = (opts.minGain ?? 0) * totalSSE;
  if (!split || split.gain <= Math.max(minGain, 1e-9)) return node;

  node.feature = split.feature;
  node.threshold = split.threshold;
  node.levels = split.levels;
  node.gain = split.gain;
  node.left = grow(split.left, features, depth + 1, opts, totalSSE);
  node.right = grow(split.right, features, depth + 1, opts, totalSSE);
  return node;
}

export function fitTree(rows: Row[], features: Feature[], opts: TreeOptions): TreeNode {
  nodeId = 0;
  const total = sse(rows.map((r) => r.y));
  return grow(rows, features, 0, opts, total);
}

export function goesLeft(node: TreeNode, x: Input): boolean {
  if (node.levels) return node.levels.includes(String(x[node.feature!]));
  return Number(x[node.feature!]) <= node.threshold!;
}

export function predict(node: TreeNode, x: Input): number {
  let cur = node;
  while (cur.left && cur.right) cur = goesLeft(cur, x) ? cur.left : cur.right;
  return cur.value;
}

/** Returns the ids of nodes visited from root to leaf. */
export function decisionPath(node: TreeNode, x: Input): number[] {
  const path: number[] = [];
  let cur: TreeNode | undefined = node;
  while (cur) {
    path.push(cur.id);
    if (!cur.left || !cur.right) break;
    cur = goesLeft(cur, x) ? cur.left : cur.right;
  }
  return path;
}

export function importance(node: TreeNode, features: Feature[]): Record<string, number> {
  const imp: Record<string, number> = Object.fromEntries(features.map((f) => [f.key, 0]));
  const walk = (n?: TreeNode) => {
    if (!n || !n.feature) return;
    imp[n.feature] += n.gain ?? 0;
    walk(n.left);
    walk(n.right);
  };
  walk(node);
  const total = Object.values(imp).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(imp)) imp[k] /= total;
  return imp;
}

export function treeStats(node: TreeNode): { leaves: number; depth: number } {
  if (!node.left || !node.right) return { leaves: 1, depth: node.depth };
  const l = treeStats(node.left);
  const r = treeStats(node.right);
  return { leaves: l.leaves + r.leaves, depth: Math.max(l.depth, r.depth) };
}

export type Ensemble = TreeNode[];

export function fitEnsemble(rows: Row[], features: Feature[], rng: Rng, size = 12): Ensemble {
  const trees: TreeNode[] = [];
  for (let i = 0; i < size; i++) {
    const sample: Row[] = [];
    for (let j = 0; j < rows.length; j++) sample.push(rows[Math.floor(rng() * rows.length)]);
    trees.push(fitTree(sample, features, { maxDepth: 7, minLeaf: 3, featureFraction: 0.75, rng }));
  }
  return trees;
}

export function predictEnsemble(trees: Ensemble, x: Input): { mean: number; sd: number } {
  const ps = trees.map((t) => predict(t, x));
  return { mean: mean(ps), sd: sd(ps) };
}
