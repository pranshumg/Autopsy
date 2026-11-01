"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, FlaskConical, ScanSearch, ShieldCheck } from "lucide-react";
import { SurfaceField } from "./surface-field";
import { useLab } from "@/lib/store";

type Dot = { ox: number; oy: number; sx: number; sy: number; x: number; y: number; r: number; delay: number; seed: number };

/**
 * The wordmark drawn as dots: they gather from a scattered cloud, drift gently
 * at rest, part around the cursor, and burst and re-form when clicked.
 */
function ParticleTitle({ text }: { text: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let dots: Dot[] = [];
    let start = performance.now();
    let raf = 0;
    let visible = true;
    const mouse = { x: -9999, y: -9999, on: false };
    const GATHER = 1600;
    const STAGGER = 420;

    const build = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = r.width || 800;
      const h = r.height || 160;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const off = document.createElement("canvas");
      off.width = Math.ceil(w);
      off.height = Math.ceil(h);
      const o = off.getContext("2d")!;
      const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-geist") || "sans-serif";
      const size = Math.max(40, Math.min(w * 0.135, h * 0.78, 104));
      o.font = `800 ${size}px ${fam}`;
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.fillStyle = "#fff";
      o.letterSpacing = `${size * 0.02}px`;
      o.fillText(text, w / 2, h / 2);
      const data = o.getImageData(0, 0, off.width, off.height).data;
      const step = size < 64 ? 3 : 4;
      const pr = step * 0.52;
      dots = [];
      for (let y = 0; y < off.height; y += step) {
        for (let x = 0; x < off.width; x += step) {
          const a = data[(y * off.width + x) * 4 + 3];
          if (a > 60) {
            const ang = Math.random() * Math.PI * 2;
            const dist = 190 * (0.3 + Math.random() * 0.9);
            const sx = x + Math.cos(ang) * dist;
            const sy = y + Math.sin(ang) * dist;
            dots.push({ ox: x, oy: y, sx, sy, x: sx, y: sy, r: pr * (0.85 + Math.random() * 0.3), delay: Math.random() * STAGGER, seed: Math.random() * 1000 });
          }
        }
      }
      start = reduce.matches ? -1e6 : performance.now();
    };

    const scatter = () => {
      for (const d of dots) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 120 * (0.4 + Math.random());
        d.sx = d.x + Math.cos(ang) * dist;
        d.sy = d.y + Math.sin(ang) * dist;
        d.delay = Math.random() * 260;
      }
      start = performance.now();
    };

    const render = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.restore();
      const el = now - start;
      for (const d of dots) {
        const prog = Math.min(1, Math.max(0, (el - d.delay) / GATHER));
        const e = 1 - Math.pow(1 - prog, 3);
        let x = d.sx + (d.ox - d.sx) * e;
        let y = d.sy + (d.oy - d.sy) * e;
        if (prog >= 1 && !reduce.matches) {
          const tt = now * 0.001 + d.seed;
          x += Math.sin(tt * 1.5) * 0.65;
          y += Math.cos(tt * 1.2) * 0.65;
        }
        let near = 0;
        if (mouse.on) {
          const dx = x - mouse.x;
          const dy = y - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 120 && dist > 0) {
            near = 1 - dist / 120;
            x += (dx / dist) * near * 42;
            y += (dy / dist) * near * 42;
          }
        }
        d.x = x;
        d.y = y;
        ctx.globalAlpha = Math.max(0.12, Math.min(1, prog * 1.2));
        ctx.fillStyle = near > 0.15 ? "#ffc27a" : "#f2ece6";
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduce.matches) raf = requestAnimationFrame(render);
    };
    const kick = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (visible && !document.hidden) raf = requestAnimationFrame(render);
    };

    const move = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.on = true;
      if (reduce.matches) kick();
    };
    const leave = () => {
      mouse.on = false;
      if (reduce.matches) kick();
    };
    const click = () => {
      if (!reduce.matches) scatter();
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      kick();
    });
    const ro = new ResizeObserver(() => {
      build();
      kick();
    });
    io.observe(wrap);
    ro.observe(wrap);
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerleave", leave);
    wrap.addEventListener("click", click);
    document.addEventListener("visibilitychange", kick);
    // fonts may arrive after first layout; rebuild so the dots match the real glyphs
    void document.fonts?.ready.then(() => {
      build();
      kick();
    });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerleave", leave);
      wrap.removeEventListener("click", click);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [text]);
  return (
    <div ref={wrapRef} className="s-title-wrap" title="Move to disturb · click to scatter">
      <canvas ref={canvasRef} role="img" aria-label={text} />
    </div>
  );
}

/** Counts each stat up from zero once, like an instrument settling. */
function HeroStats() {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  // live count: built-in targets plus the Python engine's targets when it is running
  const targets = useLab((s) => s.targets);
  const builtIn = targets?.filter((t) => t.origin !== "python").length ?? 10;
  const python = targets?.filter((t) => t.origin === "python").length ?? 0;
  const STATS = [
    { glyph: "<", target: 4, suffix: " Agents", label: "Cooperating statistical roles" },
    { glyph: "#", target: 6, suffix: " Phases", label: "Recon to rulebook" },
    { glyph: "*", target: builtIn + python, suffix: " Targets", label: python ? `${builtIn} built-in + ${python} Python agent targets, plus your own APIs` : "Built-in synthetic black boxes, plus your own APIs" },
    { glyph: "%", target: 0, suffix: " Rules", label: "Ever shipped to the browser" },
  ];
  const total = builtIn + python;
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const begin = performance.now() + 500;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - begin) / 1600));
      const e = 1 - Math.pow(1 - p, 3);
      STATS.forEach((s, i) => {
        const el = refs.current[i];
        if (el) el.textContent = `${Math.round(e * s.target)}${s.suffix}`;
      });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // re-count when the target list arrives (STATS is rebuilt each render from `total`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);
  return (
    <div className="s-stats">
      {STATS.map((s, i) => (
        <div key={s.label} className="s-rise" style={{ animationDelay: `${500 + i * 80}ms` }}>
          <b>
            <i>{s.glyph}</i>
            <span ref={(el) => void (refs.current[i] = el)}>
              {s.target}
              {s.suffix}
            </span>
          </b>
          <p>{s.label}</p>
        </div>
      ))}
    </div>
  );
}

export function Hero() {
  return (
    <section className="s-hero" id="home">
      <SurfaceField />
      <div className="s-hero-main">
        <div className="s-badge s-rise" style={{ animationDelay: "50ms" }}>
          <div className="s-badge-icons">
            {[ScanSearch, FlaskConical, ShieldCheck].map((I, i) => (
              <span key={i}>
                <i>
                  <I size={14} />
                </i>
              </span>
            ))}
          </div>
          <span className="s-badge-text">Black-Box Algorithm Intelligence</span>
        </div>
        <ParticleTitle text="AUTOPSY" />
        <p className="s-hero-lede s-rise" style={{ animationDelay: "280ms" }}>
          Autonomous statistical agents that interrogate opaque scoring systems, test competing explanations, and report the behavioral patterns the evidence supports.
        </p>
        <div className="s-actions s-rise" style={{ animationDelay: "400ms" }}>
          <Link href="/lab" className="s-btn s-btn-white">
            Open the Lab <ArrowRight size={15} />
          </Link>
        </div>
      </div>
      <HeroStats />
    </section>
  );
}
