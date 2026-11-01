"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import type { InvestigationState, TargetSpec } from "@/lib/types";
import { needsCredential, useLab } from "@/lib/store";
import { Chip, Tip } from "@/components/ui";

/** Where a target's answers come from. Saved recordings are never shown as live. */
export function OriginChip({ target, inv }: { target: TargetSpec; inv?: InvestigationState }) {
  if (inv?.saved)
    return (
      <Tip content={`Recorded ${new Date(inv.saved.recordedAt).toLocaleString()}. ${inv.saved.note}`}>
        <span>
          <Chip tone="amber">saved run · not live</Chip>
        </span>
      </Tip>
    );
  if (target.origin === "python")
    return (
      <Tip content="Investigated by the Python multi-agent engine (backend/): persona, experimenter, statistician and reporter agents on a shared blackboard, probing the target over HTTP only.">
        <span>
          <Chip tone="truth">python agents</Chip>
        </span>
      </Tip>
    );
  return target.origin === "external" ? (
    <Tip content={`Independently hosted API reached through the AUTOPSY relay${target.connection ? ` · ${new URL(target.connection.url).host}` : ""}`}>
      <span>
        <Chip tone="coral">external API</Chip>
      </span>
    </Tip>
  ) : (
    <Tip content="Built-in synthetic target for demonstration. Results on it are not real-world validation.">
      <span>
        <Chip tone="signal">built-in synthetic</Chip>
      </span>
    </Tip>
  );
}

/**
 * Whether to show a credential prompt. Latches once shown, so the field does not
 * disappear on the first keystroke; `missing` still says whether queries are blocked.
 */
export function useCredentialPrompt(target: TargetSpec): { show: boolean; missing: boolean } {
  const missing = useLab((s) => needsCredential(target, s.credentials));
  const [seen, setSeen] = useState(missing);
  if (missing && !seen) setSeen(true);
  return { show: seen || missing, missing };
}

/** Session-only credential input. The value lives in memory and is never persisted or exported. */
export function CredentialField({ target, compact }: { target: TargetSpec; compact?: boolean }) {
  const id = useId();
  const value = useLab((s) => s.credentials[target.id] ?? "");
  const setCredential = useLab((s) => s.setCredential);
  const [show, setShow] = useState(false);
  if (target.origin !== "external" || !target.connection?.authHeader) return null;
  return (
    <div className={compact ? "" : "mt-4"}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] text-fg-2">
        <KeyRound size={12} /> Credential for <code className="font-mono text-[11px] text-fg">{target.connection.authHeader}</code>
      </label>
      <div className="mt-1.5 flex gap-1.5">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setCredential(target.id, e.target.value)}
          placeholder="kept in memory for this session only"
          className="h-8 min-w-0 flex-1 rounded-md border border-line-2 bg-ink-950 px-2.5 font-mono text-xs text-fg outline-none focus:border-signal/60"
        />
        <button type="button" onClick={() => setShow(!show)} className="h-8 rounded-md border border-line-2 px-2 text-fg-3 hover:text-fg" aria-label={show ? "Hide credential" : "Show credential"}>
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-fg-4">Never saved to storage, case files or exports. Re-enter it after reloading the page.</p>
    </div>
  );
}
