// Public, client-safe example definitions for the "Connect a black box" flow.
// These contain only what an investigator is allowed to know: schema and
// contract. The sample challenge's true rules live in src/server/challenges.ts
// and are returned only by its reveal endpoint after an investigation.

import type { Connection, Feature, OutputSpec } from "@/lib/types";

export type TargetDraft = {
  name: string;
  description: string;
  connection: Connection;
  features: Feature[];
  output: OutputSpec;
  defaultBudget: number;
  challengeId?: string;
};

export const SAMPLE_CHALLENGE_ID = "loan-apr";
export const SAMPLE_CHALLENGE_KEY = "autopsy-demo-key";

/** Public schema of the bundled synthetic challenge service (no rules). */
export function sampleChallengeDraft(origin: string): TargetDraft {
  return {
    name: "Sample challenge · Loan APR quote",
    description:
      "SYNTHETIC blind challenge bundled with AUTOPSY. Quotes an annual percentage rate for a personal loan. Its rules are hidden on the server and can be revealed only after the investigation, for comparison. Because AUTOPSY's authors wrote it, it is a demo of the workflow, not independent validation.",
    connection: { url: `${origin}/api/challenge/${SAMPLE_CHALLENGE_ID}`, mode: "single", outputPath: "result.apr", authHeader: "x-api-key" },
    features: [
      { key: "credit_score", label: "Credit score", kind: "numeric", min: 300, max: 850, integer: true, description: "Bureau credit score." },
      { key: "loan_amount", label: "Loan amount", kind: "numeric", min: 1000, max: 50000, integer: true, format: "currency", unit: "USD", description: "Requested principal." },
      { key: "annual_income", label: "Annual income", kind: "numeric", min: 15000, max: 250000, integer: true, format: "currency", unit: "USD", description: "Stated gross annual income." },
      { key: "term_months", label: "Term", kind: "numeric", min: 12, max: 72, integer: true, unit: "mo", description: "Repayment term in months." },
      { key: "employment_years", label: "Years employed", kind: "numeric", min: 0, max: 30, integer: true, unit: "yr", description: "Years with current employer." },
      { key: "home_ownership", label: "Home ownership", kind: "categorical", levels: ["rent", "own", "mortgage"], description: "Housing status." },
      { key: "region", label: "Region", kind: "categorical", levels: ["north", "south", "east", "west"], description: "Region derived from the applicant's address." },
      { key: "purpose", label: "Loan purpose", kind: "categorical", levels: ["debt_consolidation", "auto", "home_improvement", "medical"], description: "Stated purpose of the loan." },
    ],
    output: { key: "apr", label: "APR", unit: "%", format: "number", min: 0, max: 40 },
    defaultBudget: 1000,
    challengeId: SAMPLE_CHALLENGE_ID,
  };
}

/** A minimal two-field example to show the schema format. */
export function minimalDraft(): TargetDraft {
  return {
    name: "My scoring API",
    description: "Describe what the system decides and what its output means.",
    connection: { url: "https://", mode: "batch", outputPath: "outputs" },
    features: [
      { key: "income", label: "Annual income", kind: "numeric", min: 10000, max: 200000, integer: true, description: "" },
      { key: "segment", label: "Segment", kind: "categorical", levels: ["a", "b", "c"], description: "" },
    ],
    output: { key: "score", label: "Score", unit: "pts", format: "score", min: 0, max: 100 },
    defaultBudget: 800,
  };
}
