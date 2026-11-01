"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState, ViewTransition, type ReactNode } from "react";
import { ChevronRight, History, KeyRound, Pause, Play, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { PHASES, type InvestigationState, type Pace } from "@/lib/types";
import { needsCredential, useLab } from "@/lib/store";
import { cn } from "@/lib/format";
import { Button, ButtonLink, Dot, Empty, Kbd, LogoMark, Meter, Segmented, Skeleton, Ticker, Tip, toneText } from "@/components/ui";
import { INV_STATUS, LAB_VIEWS } from "@/components/meta";
import { InvestigationIdContext, useSelection } from "./context";
import { CredentialField, OriginChip, useCredentialPrompt } from "@/components/target-bits";
import { FindingTestHost } from "./verify";
import { DemoBar } from "./demo-bar";

export function ShellFallback() {
  return (
    <div className="flex h-dvh flex-col bg-ink-950">
      <div className="flex h-12 items-center gap-3 border-b border-line px-4">
        <LogoMark />
        <Skeleton className="h-3 w-48" />
        <Skeleton className="ml-auto h-3 w-64" />
      </div>
      <div className="flex flex-1">
        <div className="hidden w-[64px] border-r border-line md:block" />
        <div className="grid flex-1 grid-cols-[260px_1fr_320px] gap-px bg-line max-lg:grid-cols-1">
          <div className="space-y-3 bg-ink-950 p-4 max-lg:hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
          <div className="bg-ink-950 bg-dots" />
          <div className="space-y-3 bg-ink-950 p-4 max-lg:hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InvestigationShell({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const hydrated = useLab((s) => s.hydrated);
  const inv = useLab((s) => s.investigations[id]);
  const load = useLab((s) => s.load);
  const missing = useLab((s) => !!s.notFound[id]);
  const select = useSelection((s) => s.select);

  useEffect(() => {
    if (hydrated && !inv) load(id);
  }, [hydrated, inv, id, load]);

  useEffect(() => {
    select(null);
  }, [id, select]);

  if (!inv) {
    if (missing)
      return (
        <div className="flex h-dvh items-center justify-center bg-ink-950 bg-grid">
          <Empty
            icon={<TriangleAlert size={22} />}
            title="Investigation not found"
            hint="It may have been deleted, or it was stored in another browser. Investigations are kept in this browser's local storage."
            action={
              <ButtonLink href="/lab" variant="signal">
                Open the registry
              </ButtonLink>
            }
          />
        </div>
      );
    return <ShellFallback />;
  }

  return (
    <InvestigationIdContext.Provider value={id}>
      <div className="flex h-dvh flex-col overflow-hidden bg-ink-950">
        <TopBar inv={inv} />
        <Banners inv={inv} />
        {inv.guided && <DemoBar inv={inv} />}
        <div className="flex min-h-0 flex-1">
          <NavRail id={id} />
          <main className="relative min-w-0 flex-1 pb-14 md:pb-0">{children}</main>
        </div>
        <MobileNav id={id} />
      </div>
      <Shortcuts inv={inv} />
      <FindingTestHost inv={inv} />
    </InvestigationIdContext.Provider>
  );
}

function Banners({ inv }: { inv: InvestigationState }) {
  const { show: askKey } = useCredentialPrompt(inv.target);
  const canQuery = inv.status === "idle" || inv.status === "completed" || inv.status === "cancelled" || inv.status === "error" || inv.status === "interrupted";
  if (inv.saved)
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-amber/25 bg-amber/[0.06] px-4 py-1.5 text-[12px] text-amber" role="note">
        <History size={13} /> Saved recording from {new Date(inv.saved.recordedAt).toLocaleString()}, shown as a demo fallback. It is not a live run and cannot query the target. {inv.saved.note}
      </div>
    );
  if (askKey && canQuery)
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-coral/25 bg-coral/[0.05] px-4 py-2 text-[12px] text-fg-2">
        <KeyRound size={13} className="text-coral" />
        <span>This external target needs its credential for this session before it can be queried.</span>
        <div className="min-w-[260px] flex-1 max-w-md">
          <CredentialField target={inv.target} compact />
        </div>
      </div>
    );
  return null;
}

function useActiveSlug() {
  const path = usePathname();
  const parts = path.split("/").filter(Boolean);
  return parts[2] ?? "";
}

function NavRail({ id }: { id: string }) {
  const active = useActiveSlug();
  return (
    <nav aria-label="Investigation views" className="hidden w-[64px] shrink-0 flex-col items-center gap-1 border-r border-line bg-ink-950 py-3 md:flex">
      {LAB_VIEWS.map((v) => {
        const on = v.slug === active;
        const Icon = v.icon;
        return (
          <Tip
            key={v.slug}
            side="right"
            content={
              <span className="flex items-center gap-2">
                {v.label} <Kbd>{v.key}</Kbd>
              </span>
            }
          >
            <Link
              href={`/lab/${id}${v.slug ? `/${v.slug}` : ""}`}
              aria-current={on ? "page" : undefined}
              aria-label={v.label}
              className={cn(
                "group relative flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-lg transition-colors",
                on ? "text-fg" : "text-fg-3 hover:bg-white/[0.03] hover:text-fg-2",
              )}
            >
              {on && (
                <motion.span
                  layoutId="rail-active"
                  className="absolute inset-0 rounded-lg border border-line-2 bg-white/[0.04]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {on && <motion.span layoutId="rail-bar" className="absolute -left-2 top-3 h-6 w-[2px] rounded-full bg-truth" />}
              <Icon size={17} strokeWidth={1.6} className="relative" />
              <span className="relative font-mono text-[8.5px] uppercase tracking-[0.08em]">{v.short}</span>
            </Link>
          </Tip>
        );
      })}
    </nav>
  );
}

function MobileNav({ id }: { id: string }) {
  const active = useActiveSlug();
  return (
    <nav aria-label="Investigation views" className="glass fixed inset-x-0 bottom-0 z-40 flex h-14 overflow-x-auto border-x-0 border-b-0 md:hidden">
      {LAB_VIEWS.map((v) => {
        const Icon = v.icon;
        const on = v.slug === active;
        return (
          <Link
            key={v.slug}
            href={`/lab/${id}${v.slug ? `/${v.slug}` : ""}`}
            aria-current={on ? "page" : undefined}
            className={cn("flex min-w-[64px] flex-1 flex-col items-center justify-center gap-1", on ? "text-truth" : "text-fg-3")}
          >
            <Icon size={17} strokeWidth={1.6} />
            <span className="font-mono text-[9px] uppercase tracking-wide">{v.short}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function PhaseTrack({ inv }: { inv: InvestigationState }) {
  const activeIdx = PHASES.findIndex((p) => p.id === inv.phase);
  return (
    <div className="hidden items-center gap-1 xl:flex" aria-label="Investigation phases">
      {PHASES.map((p, i) => {
        const prog = inv.phaseProgress[p.id] ?? 0;
        const active = p.id === inv.phase;
        const done = prog >= 1 || (inv.status === "completed" && prog > 0);
        return (
          <Tip key={p.id} content={`${p.label} · ${Math.round(prog * 100)}%`}>
            <div className="flex w-[74px] flex-col gap-1" aria-label={`${p.label} ${Math.round(prog * 100)} percent`}>
              <div className={cn("flex items-center gap-1 whitespace-nowrap font-mono text-[9px] tracking-[0.06em]", active ? "text-signal" : done ? "text-fg-2" : "text-fg-4")}>
                <span className="opacity-60">{String(i + 1).padStart(2, "0")}</span>
                {p.short}
              </div>
              <div className="relative h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", active ? "bg-signal" : done ? "bg-fg-3" : "bg-fg-4")}
                  style={{ width: `${prog * 100}%` }}
                />
                {active && inv.status === "running" && <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,transparent,rgb(78_225_240/0.5),transparent)] bg-[length:200%_100%]" />}
              </div>
            </div>
          </Tip>
        );
      })}
      {activeIdx === -1 && inv.status === "idle" && <span className="ml-2 font-mono text-[10px] text-fg-4">awaiting launch</span>}
    </div>
  );
}

function Stat({ label, children, tip }: { label: string; children: ReactNode; tip: string }) {
  return (
    <Tip content={tip}>
      <div className="flex flex-col items-end leading-none">
        <span className="font-mono text-[13px] text-fg">{children}</span>
        <span className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-fg-4">{label}</span>
      </div>
    </Tip>
  );
}

function TopBar({ inv }: { inv: InvestigationState }) {
  const st = INV_STATUS[inv.status];
  const supported = inv.hypotheses.filter((h) => h.status === "supported").length;
  const live = inv.status === "running";
  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-ink-950/90 px-3 backdrop-blur md:px-4">
      <Link href="/" aria-label="AUTOPSY home" className="text-fg-2 transition-colors hover:text-fg">
        <LogoMark />
      </Link>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <Link href="/lab" className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3 hover:text-fg-2">
          Lab
        </Link>
        <ChevronRight size={12} className="shrink-0 text-fg-4" />
        <ViewTransition name={`inv-title-${inv.id}`} share="morph" default="none">
          <span className="truncate font-medium text-fg">{inv.target.name}</span>
        </ViewTransition>
        <span className="hidden font-mono text-[11px] text-fg-4 sm:inline">#{inv.id.slice(-4).toUpperCase()}</span>
        <span className="hidden md:inline-flex">
          <OriginChip target={inv.target} inv={inv} />
        </span>
      </nav>
      <span
        className={cn("ml-1 hidden items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] sm:inline-flex", "border-current/25", toneText[st.tone])}
        role="status"
        aria-live="polite"
      >
        <Dot tone={st.tone} pulse={live} size={5} />
        {st.label}
      </span>

      <div className="mx-auto">
        <PhaseTrack inv={inv} />
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-4 lg:flex">
          <Tip
            content={`${inv.budget.used} of ${inv.budget.limit} inputs evaluated${inv.budget.requests !== undefined ? ` · ${inv.budget.requests} HTTP requests to the target, retries included` : ""}. Analyst probes and verifications count toward this budget; benchmark queries are counted separately.`}
          >
            <div className="w-[120px]">
              <div className="mb-1 flex items-baseline justify-between font-mono text-[10px]">
                <span className="uppercase tracking-[0.12em] text-fg-4">Budget</span>
                <span className="text-fg-2">
                  <Ticker value={inv.budget.used} />
                  <span className="text-fg-4">/{inv.budget.limit}</span>
                </span>
              </div>
              <Meter value={inv.budget.used / inv.budget.limit} tone={inv.budget.used / inv.budget.limit > 0.92 ? "amber" : "signal"} label="Query budget used" />
            </div>
          </Tip>
          <Stat label="Supported" tip="Hypotheses supported by controlled evidence">
            <Ticker value={supported} />
            <span className="text-fg-4">/{inv.hypotheses.length}</span>
          </Stat>
          <Stat
            label={inv.surrogate?.evaluatedOn === "test" ? "Held-out R²" : "Interim R²"}
            tip={
              inv.surrogate?.evaluatedOn === "test"
                ? "Predictive fit of the final surrogate on the sealed test set, scored once. Not accuracy, and not the share of rules recovered."
                : "Interim predictive fit on the validation set, for monitoring only. The sealed test set is scored once at synthesis."
            }
          >
            {inv.surrogate ? <Ticker value={inv.surrogate.fidelity.r2} format={(v) => v.toFixed(3)} /> : <span className="text-fg-4">—</span>}
          </Stat>
        </div>
        <Controls inv={inv} />
      </div>
    </header>
  );
}

function Controls({ inv }: { inv: InvestigationState }) {
  const { start, pause, resume, cancel, setPace, create } = useLab.getState();
  const router = useRouter();
  const missingKey = useLab((s) => needsCredential(inv.target, s.credentials));
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    if (!confirmCancel) return;
    const t = setTimeout(() => setConfirmCancel(false), 3000);
    return () => clearTimeout(t);
  }, [confirmCancel]);

  const rerun = () => {
    const id = create({ target: inv.target, budget: inv.budget.limit, pace: inv.pace, guided: inv.guided });
    useLab.getState().start(id);
    router.push(`/lab/${id}`);
  };

  if (inv.status === "idle")
    return (
      <Button variant="primary" size="sm" onClick={() => start(inv.id)} disabled={missingKey} title={missingKey ? "Enter the credential first" : undefined}>
        <Play size={13} fill="currentColor" /> Run investigation
      </Button>
    );

  if (inv.status === "running" || inv.status === "paused")
    return (
      <div className="flex items-center gap-1.5">
        <div className="hidden sm:block">
          <Segmented<Pace>
            label="Investigation pace"
            size="xs"
            value={inv.pace}
            onChange={(p) => setPace(inv.id, p)}
            options={[
              { value: "cinematic", label: "1×", title: "Cinematic pace — easiest to follow" },
              { value: "standard", label: "4×", title: "Standard pace" },
              { value: "instant", label: "Max", title: "As fast as the target responds" },
            ]}
          />
        </div>
        {inv.status === "running" ? (
          <Button size="sm" variant="outline" onClick={() => pause(inv.id)} aria-label="Pause investigation">
            <Pause size={12} fill="currentColor" /> <span className="max-sm:hidden">Pause</span>
          </Button>
        ) : (
          <Button size="sm" variant="signal" onClick={() => resume(inv.id)} aria-label="Resume investigation">
            <Play size={12} fill="currentColor" /> <span className="max-sm:hidden">Resume</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          onClick={() => (confirmCancel ? (cancel(inv.id), setConfirmCancel(false)) : setConfirmCancel(true))}
          aria-label={confirmCancel ? "Confirm cancel investigation" : "Cancel investigation"}
        >
          <Square size={10} fill="currentColor" /> <span className="max-sm:hidden">{confirmCancel ? "Confirm" : "Cancel"}</span>
        </Button>
      </div>
    );

  return (
    <Tip content={`Start a fresh investigation of ${inv.target.name} with the same budget`}>
      <Button size="sm" variant="outline" onClick={rerun} disabled={missingKey}>
        <RotateCcw size={12} /> <span className="max-sm:hidden">Re-run</span>
      </Button>
    </Tip>
  );
}

function Shortcuts({ inv }: { inv: InvestigationState }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true], [role=slider], [role=combobox]")) return;
      const view = LAB_VIEWS.find((v) => v.key === e.key);
      if (view) {
        e.preventDefault();
        router.push(`/lab/${inv.id}${view.slug ? `/${view.slug}` : ""}`);
        return;
      }
      if (e.key === " " && !t.closest("button, a")) {
        const { pause, resume } = useLab.getState();
        if (inv.status === "running") {
          e.preventDefault();
          pause(inv.id);
        } else if (inv.status === "paused") {
          e.preventDefault();
          resume(inv.id);
        }
      }
      if (e.key === "Escape") useSelection.getState().select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inv.id, inv.status, router]);
  return null;
}

