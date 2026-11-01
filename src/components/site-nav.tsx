"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { LogoMark } from "@/components/ui";

export const SITE_LINKS = [
  { href: "/lab", label: "Lab" },
  { href: "/benchmarks", label: "Benchmarks" },
  { href: "/targets", label: "Targets" },
  { href: "/agents", label: "Agents" },
  { href: "/method", label: "Method" },
  { href: "/docs", label: "Docs" },
];

export function SiteNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <header className="s-nav">
      <div className="s-nav-row">
        <Link href="/" className="s-home" aria-label="AUTOPSY home" title="AUTOPSY home">
          <LogoMark size={22} />
        </Link>
        <nav className="s-links" aria-label="Main navigation">
          {SITE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isActive(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <button type="button" className="s-burger" aria-expanded={open} aria-controls="site-sheet" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen(!open)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <nav id="site-sheet" className="s-sheet" aria-label="Mobile navigation">
          {SITE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} aria-current={isActive(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
