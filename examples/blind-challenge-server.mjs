// Minimal blind-challenge scoring API implementing the AUTOPSY batch contract.
//
//   node examples/blind-challenge-server.mjs            (listens on PORT or 8787)
//
// The challenge author replaces score() with secret rules, deploys it on a
// public HTTPS URL, and shares only the printed schema, the URL and API_KEY.
// No dependencies; Node 18+.

import http from "node:http";

const API_KEY = process.env.API_KEY ?? "change-me";
const PORT = Number(process.env.PORT ?? 8787);

// Public schema: safe to share with the investigator.
const SCHEMA = {
  name: "Blind challenge · Insurance risk score",
  description: "Returns a 0-100 risk score for an applicant. Rules are secret until the reveal.",
  connection: { url: "https://YOUR-PUBLIC-URL/score", mode: "batch", outputPath: "outputs", authHeader: "x-api-key" },
  features: [
    { key: "age", label: "Age", kind: "numeric", min: 18, max: 90, integer: true },
    { key: "bmi", label: "BMI", kind: "numeric", min: 15, max: 45 },
    { key: "smoker", label: "Smoker", kind: "categorical", levels: ["no", "yes"] },
    { key: "region", label: "Region", kind: "categorical", levels: ["north", "south", "east", "west"] },
    { key: "visits", label: "Doctor visits last year", kind: "numeric", min: 0, max: 20, integer: true },
  ],
  output: { key: "score", label: "Risk score", unit: "pts", format: "score", min: 0, max: 100 },
  defaultBudget: 800,
};

// SECRET RULES: replace these with your own before sharing the URL.
function score(x) {
  let s = 10 + 0.4 * (x.age - 18);
  if (x.bmi > 30) s += 12;
  if (x.smoker === "yes") s += 20;
  if (x.smoker === "yes" && x.age > 50) s += 8; // interaction
  s += 1.5 * Math.min(x.visits, 8);
  // region is deliberately ignored
  s += (Math.random() - 0.5) * 2; // small noise
  return Math.round(Math.max(0, Math.min(100, s)) * 100) / 100;
}

function valid(x) {
  if (!x || typeof x !== "object") return "input must be an object";
  for (const f of SCHEMA.features) {
    const v = x[f.key];
    if (f.kind === "numeric") {
      if (typeof v !== "number" || v < f.min || v > f.max || (f.integer && !Number.isInteger(v))) return `bad ${f.key}`;
    } else if (!f.levels.includes(v)) return `bad ${f.key}`;
  }
  return null;
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/score") return send(res, 404, { error: "POST /score" });
    if (req.headers["x-api-key"] !== API_KEY) return send(res, 401, { error: "invalid x-api-key" });
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 500_000) req.destroy();
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "body must be JSON" });
      }
      const inputs = body?.inputs;
      if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 64) return send(res, 400, { error: "inputs must be 1-64 objects" });
      for (let i = 0; i < inputs.length; i++) {
        const err = valid(inputs[i]);
        if (err) return send(res, 422, { error: `inputs[${i}]: ${err}` });
      }
      send(res, 200, { outputs: inputs.map(score) });
    });
  })
  .listen(PORT, () => {
    console.log(`Blind challenge listening on :${PORT}  (POST /score, header x-api-key)`);
    console.log("Schema to share (set connection.url to your public HTTPS URL):");
    console.log(JSON.stringify(SCHEMA, null, 2));
  });
