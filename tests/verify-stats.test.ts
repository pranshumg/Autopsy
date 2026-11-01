import { describe, expect, it } from "vitest";
import { compareArms, permutationP, t975 } from "@/lib/verify-stats";

describe("finding re-test statistics", () => {
  it("uses Student-t quantiles for small samples", () => {
    expect(t975(4)).toBeCloseTo(2.776, 3);
    expect(t975(200)).toBe(1.96);
  });
  it("estimates a clear difference with an interval excluding zero", () => {
    const r = compareArms([10, 10.2, 9.9, 10.1, 9.8], [15, 15.3, 14.8, 15.1, 14.9]);
    expect(r.meanDiff).toBeCloseTo(5.02, 2);
    expect(r.ci[0]).toBeGreaterThan(4.5);
    expect(r.ci[1]).toBeLessThan(5.6);
    // exact permutation with 5 vs 5: the most extreme split has probability 2/252
    expect(r.p).toBeCloseTo(2 / 252, 5);
  });
  it("reports no evidence when arms overlap", () => {
    const r = compareArms([1, 2, 3, 4, 5], [1.5, 2.5, 3.5, 4.5, 2]);
    expect(r.ci[0]).toBeLessThan(0);
    expect(r.ci[1]).toBeGreaterThan(0);
    expect(r.p).toBeGreaterThan(0.3);
  });
  it("handles deterministic targets without dividing by zero", () => {
    const r = compareArms([7, 7, 7], [9, 9, 9]);
    expect(r.deterministic).toBe(true);
    expect(r.ci).toEqual([2, 2]);
    expect(r.p).toBeCloseTo(0.1, 5);
  });
  it("falls back to Monte Carlo for large arms", () => {
    const a = Array.from({ length: 10 }, (_, i) => i);
    const b = a.map((x) => x + 0.5);
    const p = permutationP(a, b, 3);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThanOrEqual(1);
  });
});
