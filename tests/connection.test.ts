import { describe, expect, it } from "vitest";
import {
  ContractError,
  extractOutputs,
  inputProblem,
  parsePath,
  sampleInput,
  schemaProblems,
  validateConnection,
  validateEndpointUrl,
  validateHeaderName,
} from "@/lib/connection";
import { minimalDraft, sampleChallengeDraft } from "@/lib/examples";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ContractError).code;
  }
  return "ok";
};

describe("output extraction", () => {
  it("reads a batch array", () => {
    expect(extractOutputs({ outputs: [1, 2.5] }, "outputs", 2, "batch")).toEqual([1, 2.5]);
  });
  it("maps [*] over an array of objects", () => {
    expect(extractOutputs({ data: [{ score: 3 }, { score: 4 }] }, "data[*].score", 2, "batch")).toEqual([3, 4]);
  });
  it("reads nested single outputs", () => {
    expect(extractOutputs({ result: { apr: 7.25 } }, "result.apr", 1, "single")).toEqual([7.25]);
    expect(extractOutputs({ r: [{ v: 9 }] }, "r[0].v", 1, "single")).toEqual([9]);
  });
  it("rejects missing outputs with the path in the message", () => {
    expect(() => extractOutputs({ result: {} }, "result.apr", 1, "single")).toThrow(/missing "apr"/);
    expect(code(() => extractOutputs({}, "outputs", 1, "batch"))).toBe("missing_output");
  });
  it("rejects non-numeric values, including numeric strings and NaN-like values", () => {
    expect(code(() => extractOutputs({ outputs: ["12.5"] }, "outputs", 1, "batch"))).toBe("non_numeric");
    expect(code(() => extractOutputs({ outputs: [null] }, "outputs", 1, "batch"))).toBe("non_numeric");
    expect(code(() => extractOutputs({ v: true }, "v", 1, "single"))).toBe("non_numeric");
  });
  it("rejects response-count mismatches", () => {
    expect(code(() => extractOutputs({ outputs: [1, 2, 3] }, "outputs", 2, "batch"))).toBe("count_mismatch");
  });
  it("requires an array in batch mode and a scalar in single mode", () => {
    expect(code(() => extractOutputs({ outputs: 5 }, "outputs", 1, "batch"))).toBe("missing_output");
    expect(code(() => extractOutputs({ outputs: [5] }, "outputs[*]", 1, "single"))).toBe("bad_output_path");
  });
  it("validates path syntax", () => {
    expect(parsePath("a.b[2][*].c")).toHaveLength(5);
    for (const bad of ["", "a..b", "a.", "1abc", "a[*][*]", "a b"]) expect(code(() => parsePath(bad))).toBe("bad_output_path");
  });
});

describe("connection validation", () => {
  it("requires https unless http is explicitly allowed", () => {
    expect(code(() => validateEndpointUrl("http://example.com/x"))).toBe("invalid_url");
    expect(code(() => validateEndpointUrl("http://localhost:3000/x", { allowHttp: true }))).toBe("ok");
    expect(code(() => validateEndpointUrl("ftp://example.com"))).toBe("invalid_url");
    expect(code(() => validateEndpointUrl("not a url"))).toBe("invalid_url");
  });
  it("refuses credentials embedded in the URL", () => {
    expect(code(() => validateEndpointUrl("https://user:pw@example.com/x"))).toBe("credential_in_url");
    expect(code(() => validateEndpointUrl("https://example.com/x?api_key=abc"))).toBe("credential_in_url");
    expect(code(() => validateEndpointUrl("https://example.com/x?token=abc"))).toBe("credential_in_url");
    expect(code(() => validateEndpointUrl("https://example.com/x?version=2"))).toBe("ok");
  });
  it("only allows safe credential header names", () => {
    expect(validateHeaderName("x-api-key")).toBe("x-api-key");
    for (const bad of ["Host", "cookie", "x api key", "x-forwarded-for", "a\r\nb"]) expect(code(() => validateHeaderName(bad))).toBe("bad_header");
  });
  it("checks the whole connection", () => {
    expect(code(() => validateConnection({ url: "https://a.example/x", mode: "batch", outputPath: "outputs", maxBatch: 65 }))).toBe("bad_batch");
    expect(code(() => validateConnection({ url: "https://a.example/x", mode: "single", outputPath: "o[*]" }))).toBe("bad_output_path");
    expect(code(() => validateConnection({ url: "https://a.example/x", mode: "single", outputPath: "result.score", authHeader: "authorization" }))).toBe("ok");
  });
});

describe("schema validation", () => {
  it("accepts the bundled examples", () => {
    expect(schemaProblems(sampleChallengeDraft("https://x.example"))).toEqual([]);
    expect(schemaProblems(minimalDraft())).toEqual([]);
  });
  it("reports actionable problems", () => {
    const d = minimalDraft();
    const probs = schemaProblems({
      ...d,
      features: [
        { key: "1bad", label: "", kind: "numeric", min: 5, max: 5, description: "" },
        { key: "c", label: "C", kind: "categorical", levels: ["x"], description: "" },
      ],
      defaultBudget: 10,
    });
    expect(probs.join("\n")).toMatch(/key must start with a letter/);
    expect(probs.join("\n")).toMatch(/add a label/);
    expect(probs.join("\n")).toMatch(/min must be less than max/);
    expect(probs.join("\n")).toMatch(/at least two options/);
    expect(probs.join("\n")).toMatch(/budget/);
  });
  it("builds schema-valid sample inputs", () => {
    const f = sampleChallengeDraft("").features;
    expect(inputProblem(f, sampleInput(f))).toBeNull();
    expect(inputProblem(f, { ...sampleInput(f), term_months: 12.5 })).toMatch(/integer/);
    expect(inputProblem(f, { ...sampleInput(f), region: "mars" })).toMatch(/one of/);
  });
});
