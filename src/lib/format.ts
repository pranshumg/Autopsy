import type { Feature, Input, OutputSpec, TargetSpec } from "@/lib/types";

export function fmtNum(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(Math.min(digits, 1));
  return v.toFixed(digits);
}

/** Currency symbol from the unit (targets in rupees must not be shown in dollars). */
function sym(unit?: string): string {
  const u = (unit ?? "").toUpperCase();
  return u === "INR" ? "₹" : u === "EUR" ? "€" : u === "GBP" ? "£" : "$";
}

export function fmtFeature(f: Feature | undefined, v: unknown): string {
  if (!f) return String(v);
  if (f.kind === "categorical") return String(v).replace(/_/g, " ");
  const n = Number(v);
  if (f.format === "currency") return `${sym(f.unit)}${fmtNum(n)}`;
  if (f.format === "percent") return `${(n * 100).toFixed(1)}%`;
  const s = f.integer ? Math.round(n).toLocaleString("en-US") : fmtNum(n);
  return f.unit ? `${s} ${f.unit}` : s;
}

export function fmtOutput(o: OutputSpec, v: number, compact = true): string {
  if (!Number.isFinite(v)) return "—";
  if (o.format === "currency") {
    const c = sym(o.unit);
    if (o.max > 1000) return compact ? `${c}${fmtNum(v)}` : `${c}${Math.round(v).toLocaleString("en-US")}`;
    return `${c}${v.toFixed(2)}`;
  }
  if (o.format === "score") return v.toFixed(1);
  return fmtNum(v);
}

/** Signed output delta, e.g. "+$4.2k" or "−6.1". */
export function fmtDelta(o: OutputSpec, v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${fmtOutput(o, Math.abs(v))}`;
}

export function fmtPct(v: number, digits = 1): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%`;
}

export function fmtP(p: number): string {
  if (p < 0.001) return "p < .001";
  return `p = ${p.toFixed(3).replace(/^0/, "")}`;
}

export function featureOf(spec: TargetSpec, key: string): Feature | undefined {
  return spec.features.find((f) => f.key === key);
}

export function labelOf(spec: TargetSpec, key: string): string {
  return featureOf(spec, key)?.label ?? key;
}

export function describeInput(spec: TargetSpec, x: Input, keys?: string[]): string {
  return (keys ?? spec.features.map((f) => f.key))
    .map((k) => `${k}=${fmtFeature(featureOf(spec, k), x[k])}`)
    .join(" ");
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0").slice(0, 2)}`;
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function cn(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
