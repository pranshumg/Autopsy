import Link from "next/link";
import { ArrowLeft, ArrowRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/ui";
import { SiteNav } from "@/components/site-nav";
import { Reveal } from "@/components/site/reveal";

export function PlatformFooter() {
  return (
    <footer className="s-footer">
      <div className="s-wrap s-footer-grid">
        <div>
          <Link href="/" className="s-brand">
            <LogoMark size={26} /> AUTOPSY
          </Link>
          <p className="s-small mt-5 max-w-xs">Autonomous statistical agents that interrogate opaque decision systems through controlled experiments and report what the evidence supports.</p>
        </div>
        <div>
          <h4>Platform & tools</h4>
          <Link href="/demo">Guided demo</Link>
          <Link href="/lab">Investigation lab</Link>
          <Link href="/connect">Connect a black box</Link>
          <Link href="/benchmarks">Benchmark suite</Link>
        </div>
        <div>
          <h4>Research & method</h4>
          <Link href="/method">Six-phase method</Link>
          <Link href="/agents">Agent architecture</Link>
          <Link href="/targets">Black-box targets</Link>
        </div>
        <div>
          <h4>Reference</h4>
          <Link href="/docs">Workflow docs</Link>
          <Link href="/docs#query-api">Query API</Link>
          <Link href="/docs#limits">Limits of evidence</Link>
        </div>
      </div>
      <div className="s-wrap s-footer-bottom">
        <span>© AUTOPSY · black-box algorithm investigation</span>
        <span className="inline-flex items-center gap-2">
          <span className="s-dot" /> Investigation engine operational · synthetic targets
        </span>
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <SiteNav />
      {children}
      <PlatformFooter />
    </div>
  );
}

/** Inner page frame: crumbs, bracketed tag, two-tone pixel headline, lede. */
export function PlatformPage({
  icon: Icon,
  tag,
  note,
  title,
  description,
  aside,
  children,
  cta = true,
}: {
  icon: LucideIcon;
  tag: string;
  note?: string;
  title: ReactNode;
  description: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  cta?: boolean;
}) {
  return (
    <SiteShell>
      <main className="s-page">
        <div className="s-wrap">
          <div className="s-page-head s-rise">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="s-tag">
                  <Icon size={14} /> [ {tag} ]
                </span>
                {note && <span className="s-label-accent">{note}</span>}
              </div>
              <h1 className="s-h1">{title}</h1>
              <p className="s-lede">{description}</p>
            </div>
            {aside}
          </div>
          <div className="mt-14">{children}</div>
          {cta && (
            <Reveal className="mt-28">
              <div className="s-cta">
                <span className="s-tag">[ next step ]</span>
                <h2 className="s-h3 mt-6 max-w-3xl">
                  Ready to open a black box? <span className="pk">Start an investigation.</span>
                </h2>
                <p className="s-body mt-4 max-w-2xl">Pick a target, set a query budget, and watch four agents turn raw responses into a rulebook you can audit.</p>
                <div className="relative z-10 mt-8 flex flex-wrap gap-3">
                  <Link href="/lab" className="s-btn s-btn-accent">
                    Launch the lab <ArrowRight size={15} />
                  </Link>
                  <Link href="/" className="s-btn s-btn-dark">
                    <ArrowLeft size={15} /> Back to overview
                  </Link>
                </div>
              </div>
            </Reveal>
          )}
        </div>
      </main>
    </SiteShell>
  );
}
