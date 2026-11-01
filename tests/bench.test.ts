import { describe, expect, it } from "vitest";
import { benchmarkVerdict } from "@/lib/bench";

describe("benchmark verdict", () => {
  it("is null without finished runs", () => expect(benchmarkVerdict({})).toBeNull());
  it("never concludes from a single run", () => expect(benchmarkVerdict({ finals: { adaptive: [1], random: [2] } })?.label).toBe("inconclusive"));
  it("reports a consistent advantage only when every run agrees", () => {
    expect(benchmarkVerdict({ finals: { adaptive: [1, 1.2], random: [2, 2] } })?.label).toBe("adaptive lower");
    expect(benchmarkVerdict({ finals: { adaptive: [3, 3], random: [2, 2] } })?.label).toBe("random lower");
    const mixed = benchmarkVerdict({ finals: { adaptive: [1, 3], random: [2, 2] } })!;
    expect(mixed.label).toBe("inconclusive");
    expect(mixed.adaptiveWins).toBe(1);
  });
});
