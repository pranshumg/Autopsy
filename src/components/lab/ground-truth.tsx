"use client";

import { useState } from "react";
import { Eye, Loader2, Lock, Trash2 } from "lucide-react";
import type { GroundTruth, GroundTruthRule, InvestigationState, Rule } from "@/lib/types";
import { useLab } from "@/lib/store";
import { cn } from "@/lib/format";
import { Button, Chip, Label, Segmented } from "@/components/ui";
import { fetchScorecard } from "@/lib/python-engine";

const VERDICTS = [
  { value: "recovered", label: "Recovered" },
  { value: "partial", label: "Partial" },
  { value: "missed", label: "Missed" },
] as const;

/** Fields mentioned in a free-text rule (by key or label). */
function detectFeatures(inv: InvestigationState, text: string): string[] {
  const t = text.toLowerCase();
  return inv.target.features.filter((f) => t.includes(f.key.toLowerCase()) || t.includes(f.label.toLowerCase())).map((f) => f.key);
}

function related(inv: InvestigationState, g: GroundTruthRule): Rule[] {
  if (!inv.report || !g.features.length) return [];
  return inv.report.rules.filter((r) => r.features.some((k) => g.features.includes(k)));
}

export function GroundTruthPanel({ inv }: { inv: InvestigationState }) {
  const setGroundTruth = useLab((s) => s.setGroundTruth);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopped = inv.status === "completed" || inv.status === "cancelled" || inv.status === "error" || inv.status === "interrupted" || !!inv.saved;
  const gt = inv.groundTruth;

  if (!stopped)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line p-4 text-[13px] text-fg-3">
        <Lock size={14} /> Ground truth can be revealed only after the investigation stops, so it can never influence the findings.
      </div>
    );

  const revealSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/challenge/${inv.target.challengeId}/reveal`);
      if (!res.ok) throw new Error(`Reveal failed (HTTP ${res.status})`);
      const data = (await res.json()) as { rules: { id: string; text: string; features: string[] }[] };
      setGroundTruth(inv.id, { source: "Bundled synthetic sample challenge (written by AUTOPSY's authors; not independent validation)", revealedAt: Date.now(), rules: data.rules.map((r) => ({ ...r })) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revealScorecard = async () => {
    setBusy(true);
    setError(null);
    try {
      const sc = await fetchScorecard(inv.id);
      const fp = sc.falsePositives.map((f) => f.features.join(" × ") + (f.levels ? ` (${f.levels.join(", ")})` : ""));
      setGroundTruth(inv.id, {
        source: "Hidden rules of the mock target (read from the target's /reveal endpoint after the run; the agents never saw them)",
        revealedAt: Date.now(),
        rules: [...sc.rules, ...sc.decoys.map((d) => ({ id: d.id, text: `Decoy: ${d.text}`, features: d.features, verdict: d.fooled ? ("missed" as const) : ("recovered" as const) }))],
        scorecard: { found: sc.found, partial: sc.partial, total: sc.total, falsePositives: fp, decoysFooled: sc.decoys.filter((d) => d.fooled).map((d) => d.id), queries: sc.queries },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revealPasted = () => {
    const lines = text
      .split("\n")
      .map((l) => l.replace(/^\s*[-*\d.)]+\s*/, "").trim())
      .filter(Boolean);
    if (!lines.length) return setError("Paste at least one rule.");
    setGroundTruth(inv.id, { source: "Rules supplied by the target's author after the run", revealedAt: Date.now(), rules: lines.map((l, i) => ({ id: `T${i + 1}`, text: l, features: detectFeatures(inv, l) })) });
    setError(null);
  };

  if (!gt)
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {inv.target.origin === "python" && (
          <div className="rounded-xl border border-truth/30 bg-truth/[0.04] p-4">
            <Label>Reveal &amp; scorecard</Label>
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-2">Compare the discovered rulebook with the target&rsquo;s hidden rules: rules found, false positives, decoys and queries used. The hidden rules are read only now, after the run.</p>
            <Button variant="signal" size="sm" className="mt-3" onClick={revealScorecard} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Reveal hidden rules
            </Button>
          </div>
        )}
        {inv.target.challengeId && (
          <div className="rounded-xl border border-amber/30 bg-amber/[0.04] p-4">
            <Label>Bundled sample challenge</Label>
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-2">Fetch the true rules of the synthetic challenge service. AUTOPSY&rsquo;s authors wrote this service, so a good match demonstrates the workflow but is not independent validation.</p>
            <Button variant="signal" size="sm" className="mt-3" onClick={revealSample} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Reveal true rules
            </Button>
          </div>
        )}
        <div className="rounded-xl border border-line p-4">
          <Label>Independent challenge</Label>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-2">Paste the rules from whoever built the API, one per line. Field names in each line are detected so related findings can be shown side by side.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="mt-3 w-full rounded-lg border border-line-2 bg-ink-950 p-2.5 text-[12.5px] text-fg outline-none focus:border-signal/60" placeholder={"Score drops 20 points when income < 30000\nRegion is ignored"} aria-label="True rules, one per line" />
          <Button variant="outline" size="sm" className="mt-2" onClick={revealPasted}>
            <Eye size={12} /> Compare with findings
          </Button>
        </div>
        {error && <p className="text-[12px] text-alert md:col-span-2">{error}</p>}
      </div>
    );

  const setVerdict = (id: string, verdict: GroundTruthRule["verdict"]) => setGroundTruth(inv.id, { ...gt, rules: gt.rules.map((r) => (r.id === id ? { ...r, verdict } : r)) } satisfies GroundTruth);
  const scored = gt.rules.filter((r) => r.verdict);
  const count = (v: string) => gt.rules.filter((r) => r.verdict === v).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-fg-3">
        <span>
          {gt.source} · revealed {new Date(gt.revealedAt).toLocaleString()}
        </span>
        <span className="font-mono text-fg-2">
          {count("recovered")} recovered · {count("partial")} partial · {count("missed")} missed · {gt.rules.length - scored.length} unscored
        </span>
        <button type="button" onClick={() => setGroundTruth(inv.id, undefined)} className="ml-auto inline-flex items-center gap-1 text-[12px] text-fg-4 hover:text-alert">
          <Trash2 size={12} /> Remove comparison
        </button>
      </div>
      {gt.scorecard && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["rules found", `${gt.scorecard.found} / ${gt.scorecard.total}`, gt.scorecard.partial ? `+${gt.scorecard.partial} partial` : "exact match"],
            ["false positives", String(gt.scorecard.falsePositives.length), gt.scorecard.falsePositives.join("; ") || "none"],
            ["decoys", gt.scorecard.decoysFooled.length ? `${gt.scorecard.decoysFooled.length} fooled` : "none fooled", "inputs with no real effect"],
            ["queries used", gt.scorecard.queries.toLocaleString(), "paired probes, noise, holdout"],
          ].map(([k, v, sub]) => (
            <div key={k} className="rounded-xl border border-line p-3">
              <div className="label-mono">{k}</div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-fg">{v}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-fg-4">{sub}</div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11.5px] text-fg-4">{gt.scorecard ? "Verdicts were scored automatically by matching fields, levels and thresholds; you can override them." : "Verdicts are your judgement, made after the fact."} Findings came only from observed responses; the ground truth was not available to the engine.</p>
      <ul className="space-y-2">
        {gt.rules.map((g) => {
          const rel = related(inv, g);
          return (
            <li key={g.id} className={cn("grid gap-3 rounded-xl border p-3 md:grid-cols-[1fr_1fr_auto]", g.verdict === "recovered" ? "border-truth/30" : g.verdict === "missed" ? "border-alert/30" : "border-line")}>
              <div>
                <div className="font-mono text-[10px] text-fg-4">true rule {g.id}</div>
                <div className="mt-0.5 text-[13px] text-fg">{g.text}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-fg-4">AUTOPSY findings on the same fields</div>
                {rel.length ? (
                  <ul className="mt-0.5 space-y-0.5 text-[12px] text-fg-2">
                    {rel.map((r) => (
                      <li key={r.id}>
                        <span className="font-mono text-[10px] text-fg-4">{r.id}</span> {r.statement} {r.kind === "null" && <Chip>null</Chip>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-0.5 text-[12px] text-fg-4">{g.features.length ? "None" : "No field detected in this rule"}</div>
                )}
              </div>
              <Segmented<NonNullable<GroundTruthRule["verdict"]>> label={`Verdict for ${g.id}`} size="xs" value={g.verdict ?? ("" as never)} onChange={(v) => setVerdict(g.id, v)} options={[...VERDICTS]} className="self-start" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
