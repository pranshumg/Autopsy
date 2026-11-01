// SYNTHETIC blind-challenge service bundled for demonstration. Its rules are
// server-only: the investigation sees nothing but the public schema and the
// HTTP contract. Because it was written alongside AUTOPSY it demonstrates the
// workflow; it is not independent validation. A real blind challenge should be
// implemented by someone else from docs/BLIND_CHALLENGE.md.

import { inputProblem } from "@/lib/connection";
import { sampleChallengeDraft, SAMPLE_CHALLENGE_ID, SAMPLE_CHALLENGE_KEY } from "@/lib/examples";
import type { Input } from "@/lib/types";

type Challenge = {
  key: string;
  evaluate: (x: Input, noise: () => number) => number;
  truth: { id: string; text: string; features: string[] }[];
};

const n = (x: Input, k: string) => Number(x[k]);
const s = (x: Input, k: string) => String(x[k]);

const loanApr: Challenge = {
  key: SAMPLE_CHALLENGE_KEY,
  evaluate(x, noise) {
    let apr = 6 + (22 * (850 - n(x, "credit_score"))) / 550;
    if (n(x, "term_months") > 48) apr += 2;
    if (n(x, "loan_amount") / n(x, "annual_income") > 0.35) apr += 4.5;
    if (n(x, "employment_years") < 2) apr += 1.5;
    if (s(x, "region") === "south") apr += 1.2;
    if (s(x, "purpose") === "medical") apr += 2;
    apr += 0.05 * noise();
    return Math.round(Math.max(3, Math.min(36, apr)) * 100) / 100;
  },
  truth: [
    { id: "T1", text: "APR falls linearly as credit score rises: from 28% at 300 to 6% at 850.", features: ["credit_score"] },
    { id: "T2", text: "Terms longer than 48 months add 2.0 points.", features: ["term_months"] },
    { id: "T3", text: "If loan amount exceeds 35% of annual income, APR rises by 4.5 points (an interaction between the two fields).", features: ["loan_amount", "annual_income"] },
    { id: "T4", text: "Fewer than 2 years with the current employer adds 1.5 points.", features: ["employment_years"] },
    { id: "T5", text: "Applicants in the south region pay 1.2 points more (a geographic proxy worth reviewing).", features: ["region"] },
    { id: "T6", text: "Medical loans cost 2.0 points more than other purposes.", features: ["purpose"] },
    { id: "T7", text: "Home ownership is ignored.", features: ["home_ownership"] },
    { id: "T8", text: "Responses carry small Gaussian noise (SD 0.05 points) and are clamped to 3–36%.", features: [] },
  ],
};

const CHALLENGES: Record<string, Challenge> = { [SAMPLE_CHALLENGE_ID]: loanApr };

export function getChallenge(id: string): Challenge | undefined {
  return CHALLENGES[id];
}

export function validateChallengeInput(x: unknown): string | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return "input must be an object";
  return inputProblem(sampleChallengeDraft("").features, x as Input);
}

// A small per-instance token bucket so the challenge behaves like a real
// rate-limited API (HTTP 429 + Retry-After) under heavy load.
const bucket = { tokens: 60, at: Date.now() };
const CAPACITY = 60;
const REFILL_PER_SEC = 80;

export function takeToken(): boolean {
  const now = Date.now();
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + ((now - bucket.at) / 1000) * REFILL_PER_SEC);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
