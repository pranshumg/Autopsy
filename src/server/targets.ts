// Hidden black-box targets. This module is imported only by route handlers:
// the decision logic below never ships to the browser. The investigation
// engine can only learn about it through the HTTP query endpoint.

import type { Input, TargetSpec } from "@/lib/types";

type HiddenTarget = {
  spec: TargetSpec;
  evaluate: (x: Input, noise: () => number) => number;
};

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const num = (x: Input, k: string) => Number(x[k]);
const str = (x: Input, k: string) => String(x[k]);

const meridian: HiddenTarget = {
  spec: {
    id: "meridian-credit",
    name: "Credit Limit",
    vendor: "Meridian Financial (synthetic)",
    version: "v3.2",
    domain: "Consumer lending",
    endpoint: "/api/targets/meridian-credit/query",
    description:
      "Assigns an unsecured credit limit to an applicant. A limit of $0 means the application was declined. Vendor documentation lists the accepted fields but discloses nothing about how they are weighed.",
    output: { key: "credit_limit", label: "Credit limit", unit: "USD", format: "currency", min: 0, max: 50000 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "income", label: "Annual income", kind: "numeric", min: 18000, max: 240000, integer: true, format: "currency", unit: "USD", description: "Self-reported gross annual income." },
      { key: "dti", label: "Debt-to-income", kind: "numeric", min: 0, max: 0.8, format: "percent", description: "Monthly debt obligations divided by monthly income." },
      { key: "credit_age", label: "Credit history", kind: "numeric", min: 0, max: 360, integer: true, unit: "mo", description: "Age of the oldest open tradeline in months." },
      { key: "inquiries", label: "Recent inquiries", kind: "numeric", min: 0, max: 10, integer: true, description: "Hard credit inquiries in the last 12 months." },
      { key: "employment", label: "Employment", kind: "categorical", levels: ["salaried", "self_employed", "contract", "unemployed"], description: "Employment classification." },
      { key: "region", label: "Region", kind: "categorical", levels: ["urban", "suburban", "rural"], description: "Region derived from the applicant's postal code." },
      { key: "age", label: "Applicant age", kind: "numeric", min: 18, max: 80, integer: true, unit: "yr", description: "Applicant age in years." },
      { key: "has_mortgage", label: "Has mortgage", kind: "categorical", levels: ["no", "yes"], description: "Whether the applicant holds an active mortgage." },
    ],
  },
  evaluate(x, noise) {
    const income = num(x, "income");
    if (num(x, "dti") > 0.43) return 0;
    if (str(x, "employment") === "unemployed" && income < 120000) return 0;
    let limit = 0.22 * income;
    if (num(x, "credit_age") < 24) limit *= 0.55;
    if (num(x, "inquiries") >= 4) limit *= 0.7;
    if (str(x, "employment") === "self_employed") limit *= 0.9;
    if (str(x, "region") === "rural") limit *= 0.84;
    if (str(x, "has_mortgage") === "yes") limit += 2500;
    limit = Math.min(limit, 45000);
    limit *= 1 + 0.02 * noise();
    return Math.max(0, Math.round(limit / 50) * 50);
  },
};

const vela: HiddenTarget = {
  spec: {
    id: "vela-pricing",
    name: "Ride Fare",
    vendor: "Vela Mobility (synthetic)",
    version: "2026.10",
    domain: "Dynamic pricing",
    endpoint: "/api/targets/vela-pricing/query",
    description:
      "Quotes a ride fare from trip and context signals. The pricing engine is proprietary; riders only ever see the final quote.",
    output: { key: "fare", label: "Quoted fare", unit: "USD", format: "currency", min: 0, max: 220 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "distance", label: "Distance", kind: "numeric", min: 0.5, max: 40, unit: "km", description: "Routed trip distance." },
      { key: "duration", label: "Duration", kind: "numeric", min: 2, max: 90, integer: true, unit: "min", description: "Estimated trip duration." },
      { key: "hour", label: "Hour of day", kind: "numeric", min: 0, max: 23, integer: true, unit: "h", description: "Local pickup hour." },
      { key: "day", label: "Day type", kind: "categorical", levels: ["weekday", "weekend"], description: "Weekday or weekend pickup." },
      { key: "demand", label: "Demand index", kind: "numeric", min: 0.5, max: 3, description: "Ratio of open requests to available drivers nearby." },
      { key: "device", label: "Device", kind: "categorical", levels: ["android", "ios", "web"], description: "Client platform the request came from." },
      { key: "loyalty", label: "Loyalty tier", kind: "categorical", levels: ["none", "silver", "gold"], description: "Rider loyalty program tier." },
      { key: "weather", label: "Weather", kind: "categorical", levels: ["clear", "rain"], description: "Weather at pickup." },
    ],
  },
  evaluate(x, noise) {
    let fare = 2.8 + 1.15 * num(x, "distance") + 0.32 * num(x, "duration");
    const demand = num(x, "demand");
    const hour = num(x, "hour");
    if (str(x, "day") === "weekday" && hour >= 17 && hour <= 19) fare *= 1.22;
    if (str(x, "weather") === "rain" && demand > 1.2) fare *= 1.18;
    if (str(x, "device") === "ios") fare *= 1.06;
    if (str(x, "loyalty") === "gold") fare *= 0.94;
    if (demand > 1.6) fare *= 1 + 0.55 * (demand - 1.6);
    fare = Math.max(7.5, fare);
    fare *= 1 + 0.015 * noise();
    return Math.round(fare * 100) / 100;
  },
};

const halo: HiddenTarget = {
  spec: {
    id: "halo-ranker",
    name: "Social Feed Ranking",
    vendor: "Halo Social (synthetic)",
    version: "r58",
    domain: "Content ranking",
    endpoint: "/api/targets/halo-ranker/query",
    description:
      "Scores a post for distribution in the home feed on a 0-100 scale. Creators observe reach, never the score or its inputs' weights.",
    output: { key: "rank_score", label: "Rank score", unit: "pts", format: "score", min: 0, max: 100 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "engagement", label: "Engagement rate", kind: "numeric", min: 0, max: 0.25, format: "percent", description: "Interactions per impression over the first hour." },
      { key: "followers", label: "Followers", kind: "numeric", min: 0, max: 2000000, integer: true, description: "Author follower count." },
      { key: "account_age", label: "Account age", kind: "numeric", min: 0, max: 3650, integer: true, unit: "d", description: "Days since the author's account was created." },
      { key: "length", label: "Post length", kind: "numeric", min: 10, max: 2000, integer: true, unit: "chars", description: "Characters of body text." },
      { key: "has_link", label: "External link", kind: "categorical", levels: ["no", "yes"], description: "Whether the post contains an off-platform link." },
      { key: "media", label: "Media type", kind: "categorical", levels: ["text", "image", "video"], description: "Primary media attached to the post." },
      { key: "language", label: "Language", kind: "categorical", levels: ["en", "es", "pt", "other"], description: "Detected post language." },
      { key: "posted_hour", label: "Posted hour", kind: "numeric", min: 0, max: 23, integer: true, unit: "h", description: "Local hour the post was published." },
    ],
  },
  evaluate(x, noise) {
    let s = 18 + 180 * num(x, "engagement") + 6 * Math.log10(1 + num(x, "followers"));
    const media = str(x, "media");
    if (media === "image") s += 6;
    if (media === "video") s += 14;
    if (str(x, "has_link") === "yes") s *= 0.62;
    if (num(x, "account_age") < 30) s = Math.min(s, 35);
    if (str(x, "language") === "other") s -= 8;
    if (num(x, "length") > 1200) s -= 6;
    s += 1.2 * noise();
    return Math.round(Math.max(0, Math.min(100, s)) * 100) / 100;
  },
};

const talon: HiddenTarget = {
  spec: {
    id: "talon-hiring",
    name: "Resume Screening",
    vendor: "Talon Talent (synthetic)",
    version: "4.1",
    domain: "Hiring",
    endpoint: "/api/targets/talon-hiring/query",
    description:
      "Applicant-tracking screen that scores a parsed résumé against a job requisition. Recruiters only see candidates above a cut-off; rejected applicants are never told why.",
    output: { key: "fit_score", label: "Fit score", unit: "pts", format: "score", min: 0, max: 100 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "skill_match", label: "Keyword match", kind: "numeric", min: 0, max: 1, format: "percent", description: "Share of requisition keywords found in the résumé." },
      { key: "experience", label: "Experience", kind: "numeric", min: 0, max: 30, integer: true, unit: "yr", description: "Years of relevant work experience." },
      { key: "gap_months", label: "Employment gap", kind: "numeric", min: 0, max: 48, integer: true, unit: "mo", description: "Longest gap between consecutive roles." },
      { key: "degree", label: "Highest degree", kind: "categorical", levels: ["none", "bachelors", "masters", "phd"], description: "Highest completed degree." },
      { key: "grad_year", label: "Graduation year", kind: "numeric", min: 1975, max: 2025, integer: true, description: "Year of the most recent graduation." },
      { key: "referral", label: "Employee referral", kind: "categorical", levels: ["no", "yes"], description: "Whether a current employee referred the applicant." },
      { key: "commute_km", label: "Commute distance", kind: "numeric", min: 1, max: 80, integer: true, unit: "km", description: "Distance from home address to the office." },
    ],
  },
  evaluate(x, noise) {
    let s = 24 + 45 * num(x, "skill_match");
    if (num(x, "experience") < 3) s -= 15;
    const degree = str(x, "degree");
    if (degree === "bachelors") s += 6;
    if (degree === "masters" || degree === "phd") s += 9;
    if (num(x, "gap_months") > 6) s -= 12;
    if (num(x, "grad_year") < 1995) s -= 9;
    if (str(x, "referral") === "yes") s += 7;
    s += 1.0 * noise();
    return Math.round(Math.max(0, Math.min(100, s)) * 100) / 100;
  },
};

const bastion: HiddenTarget = {
  spec: {
    id: "bastion-auto",
    name: "Car Insurance Price",
    vendor: "Bastion Mutual (synthetic)",
    version: "2026-Q3",
    domain: "Insurance pricing",
    endpoint: "/api/targets/bastion-auto/query",
    description:
      "Quotes a twelve-month auto insurance premium. Filed rating factors are summarized for regulators, but the quoting model applied to each applicant is not disclosed.",
    output: { key: "premium", label: "Annual premium", unit: "USD", format: "currency", min: 0, max: 20000 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "driver_age", label: "Driver age", kind: "numeric", min: 16, max: 85, integer: true, unit: "yr", description: "Age of the primary driver." },
      { key: "claims", label: "At-fault claims", kind: "numeric", min: 0, max: 5, integer: true, description: "At-fault claims in the last five years." },
      { key: "annual_miles", label: "Annual mileage", kind: "numeric", min: 2000, max: 30000, integer: true, unit: "mi", description: "Declared miles driven per year." },
      { key: "credit_tier", label: "Credit tier", kind: "categorical", levels: ["excellent", "good", "fair", "poor"], description: "Insurance credit tier from a bureau soft pull." },
      { key: "vehicle", label: "Vehicle class", kind: "categorical", levels: ["sedan", "suv", "sports", "ev"], description: "Body class of the insured vehicle." },
      { key: "territory", label: "Rating territory", kind: "categorical", levels: ["zone_a", "zone_b", "zone_c"], description: "Territory derived from the garaging ZIP code." },
      { key: "gender", label: "Gender", kind: "categorical", levels: ["female", "male", "nonbinary"], description: "Gender marker on the driver's licence." },
      { key: "telematics", label: "Telematics opt-in", kind: "categorical", levels: ["no", "yes"], description: "Whether the driver shares app-based driving data." },
    ],
  },
  evaluate(x, noise) {
    let p = 900 + 0.035 * num(x, "annual_miles");
    const age = num(x, "driver_age");
    if (age < 25) p *= 1.6;
    p += 420 * num(x, "claims");
    p *= { excellent: 0.85, good: 1, fair: 1.2, poor: 1.45 }[str(x, "credit_tier")] ?? 1;
    p *= { sedan: 1, suv: 1.08, sports: 1.35, ev: 1.12 }[str(x, "vehicle")] ?? 1;
    p *= { zone_a: 1, zone_b: 1.1, zone_c: 1.3 }[str(x, "territory")] ?? 1;
    if (str(x, "telematics") === "yes") p *= 0.92;
    p *= 1 + 0.01 * noise();
    return Math.round(Math.min(20000, p));
  },
};

const sentinel: HiddenTarget = {
  spec: {
    id: "sentinel-fraud",
    name: "Fraud Detection",
    vendor: "Sentinel Payments (synthetic)",
    version: "fx-12",
    domain: "Fraud detection",
    endpoint: "/api/targets/sentinel-fraud/query",
    description:
      "Real-time card-transaction risk score. Transactions above the issuer's threshold are declined or challenged; cardholders only see the decline.",
    output: { key: "risk_score", label: "Fraud risk", unit: "pts", format: "score", min: 0, max: 100 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "amount", label: "Amount", kind: "numeric", min: 1, max: 5000, format: "currency", unit: "USD", description: "Transaction amount." },
      { key: "distance_km", label: "Distance from home", kind: "numeric", min: 0, max: 5000, integer: true, unit: "km", description: "Distance between the merchant and the cardholder's billing address." },
      { key: "hour", label: "Local hour", kind: "numeric", min: 0, max: 23, integer: true, unit: "h", description: "Cardholder-local hour of the transaction." },
      { key: "merchant", label: "Merchant category", kind: "categorical", levels: ["grocery", "electronics", "travel", "gift_cards", "crypto"], description: "Merchant category code group." },
      { key: "card_present", label: "Card present", kind: "categorical", levels: ["yes", "no"], description: "Chip or tap transaction versus card-not-present." },
      { key: "account_age", label: "Account age", kind: "numeric", min: 0, max: 3650, integer: true, unit: "d", description: "Days since the card account was opened." },
      { key: "velocity", label: "Transactions last hour", kind: "numeric", min: 0, max: 12, integer: true, description: "Authorizations on this card in the past 60 minutes." },
      { key: "device_os", label: "Device OS", kind: "categorical", levels: ["android", "ios", "other"], description: "Operating system of the paying device, when known." },
    ],
  },
  evaluate(x, noise) {
    let s = 8 + 6 * Math.log10(1 + num(x, "amount"));
    const far = num(x, "distance_km") > 500;
    const cnp = str(x, "card_present") === "no";
    if (far) s += 18;
    const hour = num(x, "hour");
    if (hour <= 5) s += 12;
    s += { grocery: 0, electronics: 8, travel: 5, gift_cards: 16, crypto: 20 }[str(x, "merchant")] ?? 0;
    if (cnp) s += 9;
    if (far && cnp) s += 8;
    if (num(x, "account_age") < 90) s += 12;
    s += 3.5 * num(x, "velocity");
    s += 1.2 * noise();
    return Math.round(Math.max(0, Math.min(100, s)) * 100) / 100;
  },
};

const arbiter: HiddenTarget = {
  spec: {
    id: "arbiter-pretrial",
    name: "Bail Risk Score",
    vendor: "Arbiter Justice Analytics (synthetic)",
    version: "2.7",
    domain: "Criminal justice",
    endpoint: "/api/targets/arbiter-pretrial/query",
    description:
      "Pretrial risk assessment used to inform release and bail decisions. Courts receive a 0-10 score; the vendor treats the weighting as a trade secret.",
    output: { key: "risk", label: "Risk score", unit: "pts", format: "score", min: 0, max: 10 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "age", label: "Defendant age", kind: "numeric", min: 18, max: 75, integer: true, unit: "yr", description: "Age at booking." },
      { key: "priors", label: "Prior convictions", kind: "numeric", min: 0, max: 20, integer: true, description: "Number of prior convictions." },
      { key: "failures_to_appear", label: "Failures to appear", kind: "numeric", min: 0, max: 6, integer: true, description: "Missed court dates in the last two years." },
      { key: "charge", label: "Current charge", kind: "categorical", levels: ["misdemeanor", "felony"], description: "Severity of the current charge." },
      { key: "juvenile_record", label: "Juvenile record", kind: "categorical", levels: ["no", "yes"], description: "Any adjudication before age 18." },
      { key: "employment", label: "Employment", kind: "categorical", levels: ["employed", "unemployed", "student"], description: "Employment status at booking." },
      { key: "zip_poverty", label: "Neighbourhood poverty", kind: "numeric", min: 0, max: 0.6, format: "percent", description: "Poverty rate of the defendant's home ZIP code." },
      { key: "marital", label: "Marital status", kind: "categorical", levels: ["single", "married"], description: "Marital status at booking." },
    ],
  },
  evaluate(x, noise) {
    let r = 2 + 0.35 * Math.min(num(x, "priors"), 10);
    const age = num(x, "age");
    r += age < 25 ? 1.4 : -0.02 * (age - 25);
    r += 0.6 * num(x, "failures_to_appear");
    if (str(x, "charge") === "felony") r += 0.8;
    if (str(x, "juvenile_record") === "yes") r += 0.9;
    if (str(x, "employment") === "unemployed") r += 0.7;
    if (num(x, "zip_poverty") > 0.3) r += 1.1;
    r += 0.12 * noise();
    return Math.round(Math.max(0, Math.min(10, r)) * 100) / 100;
  },
};

const caduceus: HiddenTarget = {
  spec: {
    id: "caduceus-care",
    name: "Patient Priority",
    vendor: "Caduceus Health (synthetic)",
    version: "cm-9",
    domain: "Healthcare",
    endpoint: "/api/targets/caduceus-care/query",
    description:
      "Ranks patients for enrolment in a high-risk care-management programme. Clinicians see a priority score; the model behind it is licensed, not inspected.",
    output: { key: "priority", label: "Care priority", unit: "pts", format: "score", min: 0, max: 100 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "chronic_conditions", label: "Chronic conditions", kind: "numeric", min: 0, max: 10, integer: true, description: "Count of active chronic diagnoses." },
      { key: "prior_cost", label: "Prior-year spending", kind: "numeric", min: 0, max: 80000, integer: true, format: "currency", unit: "USD", description: "Total billed healthcare cost over the past 12 months." },
      { key: "age", label: "Patient age", kind: "numeric", min: 18, max: 95, integer: true, unit: "yr", description: "Age in years." },
      { key: "er_visits", label: "ER visits", kind: "numeric", min: 0, max: 12, integer: true, description: "Emergency department visits in the past year." },
      { key: "insurance", label: "Coverage", kind: "categorical", levels: ["commercial", "medicare", "medicaid", "uninsured"], description: "Primary coverage type." },
      { key: "a1c", label: "HbA1c", kind: "numeric", min: 4, max: 14, unit: "%", description: "Most recent glycated haemoglobin reading." },
      { key: "systolic_bp", label: "Systolic BP", kind: "numeric", min: 90, max: 200, integer: true, unit: "mmHg", description: "Most recent systolic blood pressure." },
    ],
  },
  evaluate(x, noise) {
    let s = 10 + 40 * (Math.log10(1 + num(x, "prior_cost")) / Math.log10(80001));
    s += 2.5 * num(x, "chronic_conditions");
    s += 3 * Math.min(num(x, "er_visits"), 5);
    if (num(x, "age") >= 65) s += 6;
    const ins = str(x, "insurance");
    if (ins === "uninsured") s -= 10;
    if (ins === "medicaid") s -= 5;
    s += 1.0 * noise();
    return Math.round(Math.max(0, Math.min(100, s)) * 100) / 100;
  },
};

const keystone: HiddenTarget = {
  spec: {
    id: "keystone-tenant",
    name: "Rental Screening",
    vendor: "Keystone Screening (synthetic)",
    version: "ts-5",
    domain: "Housing",
    endpoint: "/api/targets/keystone-tenant/query",
    description:
      "Rental-application screening score sold to landlords. Applicants below the landlord's cut-off are denied, usually with a one-line adverse-action notice.",
    output: { key: "screen_score", label: "Screening score", unit: "pts", format: "score", min: 0, max: 100 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "credit_score", label: "Credit score", kind: "numeric", min: 300, max: 850, integer: true, description: "Bureau credit score." },
      { key: "rent_to_income", label: "Rent-to-income", kind: "numeric", min: 0.1, max: 0.7, format: "percent", description: "Monthly rent divided by monthly income." },
      { key: "evictions", label: "Eviction filings", kind: "numeric", min: 0, max: 3, integer: true, description: "Eviction filings on record in the last seven years." },
      { key: "income_source", label: "Income source", kind: "categorical", levels: ["wages", "self_employed", "voucher", "benefits"], description: "Primary source of income used to pay rent." },
      { key: "months_at_job", label: "Time at current job", kind: "numeric", min: 0, max: 240, integer: true, unit: "mo", description: "Tenure with the current employer or income source." },
      { key: "criminal_record", label: "Criminal record", kind: "categorical", levels: ["none", "misdemeanor", "felony"], description: "Most serious conviction in a background check." },
      { key: "has_pets", label: "Pets", kind: "categorical", levels: ["no", "yes"], description: "Whether the applicant declared pets." },
    ],
  },
  evaluate(x, noise) {
    let s = 40 + 0.09 * (num(x, "credit_score") - 300);
    if (num(x, "rent_to_income") > 0.35) s -= 22;
    const src = str(x, "income_source");
    if (src === "voucher") s -= 14;
    if (src === "benefits") s -= 8;
    if (num(x, "months_at_job") < 12) s -= 7;
    const rec = str(x, "criminal_record");
    if (rec === "felony") s -= 15;
    if (rec === "misdemeanor") s -= 5;
    if (num(x, "evictions") >= 1) s = Math.min(s, 30);
    s += 1.0 * noise();
    return Math.round(Math.max(0, Math.min(100, s)) * 100) / 100;
  },
};

const aisle: HiddenTarget = {
  spec: {
    id: "aisle-buybox",
    name: "Seller Ranking",
    vendor: "Aisle Marketplace (synthetic)",
    version: "bb-31",
    domain: "Marketplace ranking",
    endpoint: "/api/targets/aisle-buybox/query",
    description:
      "Decides which seller's offer wins the default \"Add to cart\" button on a product page. Sellers see whether they won, not how offers are compared.",
    output: { key: "buybox_score", label: "Buy-box score", unit: "pts", format: "score", min: 0, max: 100 },
    defaultBudget: 1000,
    stochastic: true,
    features: [
      { key: "price_ratio", label: "Price vs. lowest offer", kind: "numeric", min: 0.7, max: 1.5, description: "Offer price divided by the lowest competing offer." },
      { key: "seller_rating", label: "Seller rating", kind: "numeric", min: 1, max: 5, description: "Average buyer rating over the last 12 months." },
      { key: "ship_days", label: "Delivery promise", kind: "numeric", min: 1, max: 14, integer: true, unit: "d", description: "Promised days to delivery." },
      { key: "fulfillment", label: "Fulfilment", kind: "categorical", levels: ["merchant", "platform"], description: "Shipped by the seller or by the marketplace's own logistics." },
      { key: "stock_units", label: "Stock on hand", kind: "numeric", min: 0, max: 500, integer: true, description: "Units available to ship." },
      { key: "return_rate", label: "Return rate", kind: "numeric", min: 0, max: 0.3, format: "percent", description: "Share of orders returned in the last 90 days." },
      { key: "photos", label: "Listing photos", kind: "numeric", min: 1, max: 12, integer: true, description: "Number of images on the offer." },
    ],
  },
  evaluate(x, noise) {
    let s = 55 - 70 * (num(x, "price_ratio") - 1);
    if (str(x, "fulfillment") === "platform") s += 15;
    if (num(x, "seller_rating") < 4.3) s -= 18;
    const days = num(x, "ship_days");
    if (days > 3) s -= 2.5 * (days - 3);
    if (num(x, "stock_units") < 10) s -= 25;
    s -= 40 * num(x, "return_rate");
    s += 1.0 * noise();
    return Math.round(Math.max(0, Math.min(100, s)) * 100) / 100;
  },
};

const TARGETS: Record<string, HiddenTarget> = Object.fromEntries(
  [meridian, vela, halo, talon, bastion, sentinel, arbiter, caduceus, keystone, aisle].map((t) => [t.spec.id, t]),
);


export function listSpecs(): TargetSpec[] {
  return Object.values(TARGETS).map((t) => t.spec);
}

export function getSpec(id: string): TargetSpec | undefined {
  return TARGETS[id]?.spec;
}

export const MAX_BATCH = 64;

/** Validates an input against the public schema. Returns an error message or null. */
export function validateInput(spec: TargetSpec, x: unknown): string | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return "input must be an object";
  const rec = x as Record<string, unknown>;
  for (const f of spec.features) {
    const v = rec[f.key];
    if (v === undefined) return `missing field "${f.key}"`;
    if (f.kind === "numeric") {
      if (typeof v !== "number" || !Number.isFinite(v)) return `"${f.key}" must be a finite number`;
      if (v < f.min || v > f.max) return `"${f.key}" out of range [${f.min}, ${f.max}]`;
    } else if (typeof v !== "string" || !f.levels.includes(v)) {
      return `"${f.key}" must be one of ${f.levels.join(", ")}`;
    }
  }
  return null;
}

export function evaluate(id: string, inputs: Input[]): number[] {
  const t = TARGETS[id];
  if (!t) throw new Error(`unknown target ${id}`);
  return inputs.map((x) => t.evaluate(x, gauss));
}
