"use client";

// Procedural live visuals for the public site. Everything is drawn on canvas
// at runtime: no video, image sequences or external animation runtimes.

import { useEffect, useRef } from "react";

type Pointer = { x: number; y: number; nx: number; ny: number; active: boolean; down: number };
export type Frame = { ctx: CanvasRenderingContext2D; w: number; h: number; t: number; dt: number; p: Pointer; first: boolean; still: boolean };

/**
 * Shared render loop: sizes the canvas to its box, tracks the pointer, caps the
 * frame rate, and stops drawing while offscreen, in a hidden tab, or when the
 * visitor prefers reduced motion (one static frame is drawn instead).
 */
function useCanvasLoop(draw: (f: Frame) => void, { fps = 30, maxDpr = 2, interactive = true }: { fps?: number; maxDpr?: number; interactive?: boolean } = {}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const host = canvas?.parentElement;
    if (!canvas || !ctx || !host) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const p: Pointer = { x: -9999, y: -9999, nx: 0, ny: 0, active: false, down: 0 };
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let t = 0;
    let visible = true;
    let first = true;
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      if (now - last >= 1000 / fps - 2) {
        last = now;
        t += dt;
        drawRef.current({ ctx, w, h, t, dt, p, first, still: reduce.matches });
        first = false;
      }
      if (!reduce.matches) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = performance.now() - 1000;
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const resize = () => {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      first = true;
      kick();
    };
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      p.x = e.clientX - r.left;
      p.y = e.clientY - r.top;
      p.nx = (p.x / r.width) * 2 - 1;
      p.ny = (p.y / r.height) * 2 - 1;
      p.active = p.x >= 0 && p.y >= 0 && p.x <= r.width && p.y <= r.height;
    };
    const leave = () => {
      p.active = false;
      p.x = p.y = -9999;
    };
    const down = () => {
      if (p.active) p.down = performance.now();
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      kick();
    });
    const ro = new ResizeObserver(resize);
    io.observe(host);
    ro.observe(host);
    const target = interactive ? host.closest("section") ?? host : host;
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerleave", leave);
    target.addEventListener("pointerdown", down);
    document.addEventListener("visibilitychange", kick);
    reduce.addEventListener("change", kick);
    resize();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerleave", leave);
      target.removeEventListener("pointerdown", down);
      document.removeEventListener("visibilitychange", kick);
      reduce.removeEventListener("change", kick);
    };
  }, [fps, maxDpr, interactive]);
  return ref;
}

let pixelFont = "";
const FONT_PIXEL = () => (pixelFont ||= `11px ${getComputedStyle(document.documentElement).getPropertyValue("--font-pixel") || "monospace"}`);

// ───────────────────────────────────────────────────────────── 3D helpers

function rot(x: number, y: number, z: number, ry: number, rx: number) {
  const cx = Math.cos(ry);
  const sx = Math.sin(ry);
  const x1 = x * cx - z * sx;
  const z1 = x * sx + z * cx;
  const cX = Math.cos(rx);
  const sX = Math.sin(rx);
  return { x: x1, y: y * cX - z1 * sX, z: y * sX + z1 * cX };
}

// ───────────────────────────────────────────────────────────── black-box cube

type Probe = { a: number; b: number; t: number; speed: number; out: boolean };

/** A dot-matrix black box under interrogation: probes fly in, responses shed out. */
export function DotCube() {
  const st = useRef<{ pts: [number, number, number][]; probes: Probe[]; dust: { x: number; y: number; vy: number; life: number }[] } | null>(null);
  const ref = useCanvasLoop(({ ctx, w, h, t, dt, p }) => {
    if (!st.current) {
      const pts: [number, number, number][] = [];
      const n = 13;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const u = (i / (n - 1)) * 2 - 1;
        const v = (j / (n - 1)) * 2 - 1;
        pts.push([u, v, -1], [u, v, 1], [u, -1, v], [u, 1, v], [-1, u, v], [1, u, v]);
      }
      st.current = { pts, probes: [], dust: [] };
    }
    const s = st.current;
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.43;
    const R = Math.min(w, h) * 0.22;
    const ry = t * 0.32 + (p.active ? p.nx * 0.5 : 0);
    const rx = -0.42 + (p.active ? p.ny * 0.25 : 0) + Math.sin(t * 0.3) * 0.06;
    const proj = (x: number, y: number, z: number) => {
      const r = rot(x, y, z, ry, rx);
      const k = 5 / (5 + r.z);
      return { x: cx + r.x * R * k, y: cy + r.y * R * k, z: r.z, k };
    };
    // spawn probes (inputs) and responses
    if (Math.random() < dt * 5) s.probes.push({ a: Math.random() * Math.PI * 2, b: (Math.random() - 0.5) * 1.6, t: 0, speed: 0.5 + Math.random() * 0.5, out: false });
    if (Math.random() < dt * 3) s.probes.push({ a: Math.random() * Math.PI * 2, b: (Math.random() - 0.5) * 1.2, t: 0, speed: 0.35 + Math.random() * 0.3, out: true });
    let hits = 0;
    for (let i = s.probes.length - 1; i >= 0; i--) {
      const q = s.probes[i];
      q.t += dt * q.speed;
      if (q.t >= 1) {
        if (!q.out) hits++;
        s.probes.splice(i, 1);
        continue;
      }
      const dist = q.out ? 1.1 + q.t * 2.2 : 3.3 - q.t * 2.2;
      const P = proj(Math.cos(q.a) * dist, q.b * dist * 0.5, Math.sin(q.a) * dist);
      const P2 = proj(Math.cos(q.a) * (dist + (q.out ? -0.18 : 0.18)), q.b * (dist + (q.out ? -0.18 : 0.18)) * 0.5, Math.sin(q.a) * (dist + (q.out ? -0.18 : 0.18)));
      ctx.strokeStyle = q.out ? `rgba(255,181,94,${0.8 * (1 - q.t)})` : `rgba(240,236,232,${0.25 + 0.6 * q.t})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(P2.x, P2.y);
      ctx.lineTo(P.x, P.y);
      ctx.stroke();
    }
    // cube surface dots, painted back to front
    const projected = s.pts.map(([x, y, z]) => proj(x, y, z));
    projected.sort((a, b) => b.z - a.z);
    const flash = Math.min(1, hits * 0.5);
    for (const q of projected) {
      const d = Math.max(0, Math.min(1, (1.7 - q.z) / 3.4));
      const size = 1.2 + d * 2.6;
      const tone = 0.35 + d * 0.65;
      const shimmer = 0.85 + 0.15 * Math.sin(t * 4 + q.x * 0.05 + q.y * 0.08);
      ctx.fillStyle = `rgba(${Math.round(150 + 100 * tone)},${Math.round(150 + 80 * tone - flash * 40)},${Math.round(160 + 80 * tone - flash * 20)},${(0.25 + d * 0.75) * shimmer})`;
      ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
    }
    // evidence dust sheds from the box and drifts down
    if (Math.random() < dt * 22) {
      const a = Math.random() * Math.PI * 2;
      const P = proj(Math.cos(a), 1, Math.sin(a));
      s.dust.push({ x: P.x + (Math.random() - 0.5) * R * 0.4, y: P.y, vy: 10 + Math.random() * 25, life: 1 });
    }
    for (let i = s.dust.length - 1; i >= 0; i--) {
      const q = s.dust[i];
      q.y += q.vy * dt;
      q.life -= dt * 0.35;
      if (q.life <= 0) {
        s.dust.splice(i, 1);
        continue;
      }
      ctx.fillStyle = Math.random() < 0.05 ? `rgba(255,181,94,${q.life})` : `rgba(230,224,226,${q.life * 0.7})`;
      ctx.fillRect(q.x, q.y, 1.6, 1.6);
    }
  });
  return <canvas ref={ref} aria-hidden="true" />;
}

// ───────────────────────────────────────────────────────────── hypothesis graph

type GNode = { x: number; y: number; layer: number; state: number; since: number };

/** Inputs → hypotheses → rules: evidence pulses along edges and settles states. */
export function DotGraph() {
  const st = useRef<{ nodes: GNode[]; edges: [number, number][]; pulses: { e: number; t: number }[] } | null>(null);
  const ref = useCanvasLoop(({ ctx, w, h, t, dt, p }) => {
    if (!st.current) {
      const layers = [6, 9, 4];
      const nodes: GNode[] = [];
      layers.forEach((n, L) => {
        for (let i = 0; i < n; i++) nodes.push({ x: 0.16 + L * 0.34, y: (i + 0.5) / n, layer: L, state: L > 0 && Math.random() < 0.5 ? (Math.random() < 0.7 ? 1 : 2) : 0, since: -Math.random() * 4 });
      });
      const edges: [number, number][] = [];
      nodes.forEach((a, i) =>
        nodes.forEach((b, j) => {
          if (b.layer === a.layer + 1 && Math.random() < (a.layer === 0 ? 0.32 : 0.45)) edges.push([i, j]);
        }),
      );
      st.current = { nodes, edges, pulses: [] };
    }
    const s = st.current;
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);
    const X = (n: GNode) => n.x * w;
    const Y = (n: GNode) => h * 0.16 + n.y * h * 0.62;
    // hover focus
    let focus = -1;
    if (p.active) {
      let best = 900;
      s.nodes.forEach((n, i) => {
        const d = (X(n) - p.x) ** 2 + (Y(n) - p.y) ** 2;
        if (d < best) {
          best = d;
          focus = i;
        }
      });
    }
    // dotted edges
    for (const [a, b] of s.edges) {
      const A = s.nodes[a];
      const B = s.nodes[b];
      const hot = focus === a || focus === b;
      const len = Math.hypot(X(B) - X(A), Y(B) - Y(A));
      const steps = Math.floor(len / 7);
      ctx.fillStyle = hot ? "rgba(255,181,94,0.8)" : "rgba(230,224,226,0.2)";
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        ctx.fillRect(X(A) + (X(B) - X(A)) * u, Y(A) + (Y(B) - Y(A)) * u, 1.3, 1.3);
      }
    }
    if (Math.random() < dt * 9) s.pulses.push({ e: Math.floor(Math.random() * s.edges.length), t: 0 });
    for (let i = s.pulses.length - 1; i >= 0; i--) {
      const q = s.pulses[i];
      q.t += dt * 0.9;
      const [a, b] = s.edges[q.e];
      if (q.t >= 1) {
        const B = s.nodes[b];
        if (B.layer > 0 && t - B.since > 2.5) {
          B.state = B.layer === 2 ? (Math.random() < 0.8 ? 1 : 2) : Math.random() < 0.6 ? 1 : 2;
          B.since = t;
        }
        s.pulses.splice(i, 1);
        continue;
      }
      const A = s.nodes[a];
      const B = s.nodes[b];
      const x = X(A) + (X(B) - X(A)) * q.t;
      const y = Y(A) + (Y(B) - Y(A)) * q.t;
      ctx.fillStyle = "rgba(255,244,226,0.95)";
      ctx.fillRect(x - 2, y - 2, 4, 4);
      ctx.fillStyle = "rgba(255,181,94,0.35)";
      ctx.fillRect(x - 5, y - 5, 10, 10);
    }
    // nodes: dot-matrix discs
    s.nodes.forEach((n, i) => {
      if (n.layer > 0 && n.state !== 0 && t - n.since > 6) {
        n.state = 0;
        n.since = t;
      }
      const r = n.layer === 0 ? 12 : n.layer === 1 ? 15 : 22;
      const col = n.layer === 0 ? [230, 224, 226] : n.state === 1 ? [255, 181, 94] : n.state === 2 ? [120, 78, 40] : [160, 150, 160];
      const pulse = n.layer > 0 && n.state === 0 ? 0.55 + 0.45 * Math.sin(t * 5 + i) : 1;
      for (let gx = -r; gx <= r; gx += 3) for (let gy = -r; gy <= r; gy += 3) {
        if (gx * gx + gy * gy > r * r) continue;
        const edge = Math.sqrt(gx * gx + gy * gy) / r;
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(0.35 + 0.65 * (1 - edge * 0.6)) * pulse * (focus === i ? 1 : 0.9)})`;
        ctx.fillRect(X(n) + gx - 0.9, Y(n) + gy - 0.9, 1.8, 1.8);
      }
    });
    ctx.font = FONT_PIXEL();
    ctx.fillStyle = "rgba(200,192,198,0.6)";
    ctx.textAlign = "center";
    ["INPUTS", "HYPOTHESES", "RULES"].forEach((l, i) => ctx.fillText(l, w * (0.16 + i * 0.34), h * 0.12));
  });
  return <canvas ref={ref} aria-hidden="true" />;
}

// ───────────────────────────────────────────────────────────── decision surface

/** Response surface with a hidden threshold cliff, swept by a probing plane. */
export function DotSurface() {
  const ref = useCanvasLoop(({ ctx, w, h, t, p }) => {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);
    const n = w < 500 ? 34 : 46;
    const ry = -0.75 + Math.sin(t * 0.18) * 0.35 + (p.active ? p.nx * 0.4 : 0);
    const rx = 0.62 + (p.active ? p.ny * 0.12 : 0);
    const S = Math.min(w, h) * 0.33;
    const sweep = ((t * 0.16) % 1.4) * 2 - 1.2;
    const pts: { x: number; y: number; z: number; v: number; cliff: number; lit: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const u = (i / (n - 1)) * 2 - 1;
      const v = (j / (n - 1)) * 2 - 1;
      const th = 0.18 + 0.08 * Math.sin(v * 2 + t * 0.3);
      const ripple = 0.04 * Math.sin(u * 6 + t * 1.4) * Math.cos(v * 5 - t);
      const height = 0.62 * (u < th ? 0.1 + 0.28 * (u + 1) * (0.7 + 0.3 * Math.cos(v * 1.6)) + ripple : -0.3 + ripple * 0.5);
      const r = rot(u, -height, v, ry, rx);
      const k = 5 / (5 + r.z);
      pts.push({ x: w / 2 + r.x * S * k, y: h * 0.45 + r.y * S * k, z: r.z, v: height, cliff: Math.abs(u - th) < 0.06 ? 1 : 0, lit: Math.max(0, 1 - Math.abs(u - sweep) / 0.06) });
    }
    pts.sort((a, b) => b.z - a.z);
    for (const q of pts) {
      const d = Math.max(0, Math.min(1, (1.5 - q.z) / 3));
      const size = 1 + d * 2.8;
      const bright = Math.max(0, Math.min(1, 0.3 + (q.v + 0.2) * 1.4));
      if (q.cliff) ctx.fillStyle = `rgba(255,181,94,${0.5 + d * 0.5})`;
      else {
        const g = Math.round(90 + bright * 150 + q.lit * 60);
        ctx.fillStyle = `rgba(${g},${g - 6},${g - 2},${0.25 + d * 0.6 + q.lit * 0.3})`;
      }
      ctx.beginPath();
      ctx.arc(q.x, q.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return <canvas ref={ref} aria-hidden="true" />;
}

// ───────────────────────────────────────────────────────────── agent pipeline

const FLOW_NODES = [
  { k: "PERSONA", x: 0.12, y: 0.42 },
  { k: "EXPERIMENTER", x: 0.38, y: 0.42 },
  { k: "STATISTICIAN", x: 0.64, y: 0.42 },
  { k: "REPORTER", x: 0.88, y: 0.42 },
  { k: "BLACK BOX", x: 0.38, y: 0.78 },
];
const FLOW_EDGES: [number, number, number][] = [
  [0, 1, 0],
  [1, 4, 0.06],
  [4, 1, 0.06],
  [1, 2, -0.12],
  [2, 1, 0.12],
  [2, 3, 0],
];

/** Live packet flow between the four agents and the target; `active` highlights one agent. */
export function AgentFlow({ active }: { active: number }) {
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const packets = useRef<{ e: number; t: number; v: number }[]>([]);
  const ref = useCanvasLoop(({ ctx, w, h, t, dt }) => {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);
    const a = activeRef.current;
    const pos = (i: number) => ({ x: FLOW_NODES[i].x * w, y: FLOW_NODES[i].y * h });
    const curve = (e: [number, number, number], u: number) => {
      const A = pos(e[0]);
      const B = pos(e[1]);
      const mx = (A.x + B.x) / 2 + e[2] * h * (B.y === A.y ? 0 : 1);
      const my = (A.y + B.y) / 2 + e[2] * h * (B.y === A.y ? 1 : 0);
      const iu = 1 - u;
      return { x: iu * iu * A.x + 2 * iu * u * mx + u * u * B.x, y: iu * iu * A.y + 2 * iu * u * my + u * u * B.y };
    };
    FLOW_EDGES.forEach((e) => {
      const hot = e[0] === a || e[1] === a;
      ctx.fillStyle = hot ? "rgba(255,181,94,0.55)" : "rgba(230,224,226,0.14)";
      for (let k = 0; k <= 60; k++) {
        const P = curve(e, k / 60);
        ctx.fillRect(P.x - 0.8, P.y - 0.8, 1.6, 1.6);
      }
    });
    const rate = 6;
    if (Math.random() < dt * rate) {
      const pool = FLOW_EDGES.map((e, i) => ({ e, i })).filter(({ e }) => e[0] === a || Math.random() < 0.45);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick) packets.current.push({ e: pick.i, t: 0, v: 0.5 + Math.random() * 0.4 });
    }
    for (let i = packets.current.length - 1; i >= 0; i--) {
      const q = packets.current[i];
      q.t += dt * q.v;
      if (q.t >= 1) {
        packets.current.splice(i, 1);
        continue;
      }
      const P = curve(FLOW_EDGES[q.e], q.t);
      const hot = FLOW_EDGES[q.e][0] === a;
      ctx.fillStyle = hot ? "rgba(255,234,204,1)" : "rgba(220,214,218,0.75)";
      ctx.fillRect(P.x - 2.5, P.y - 2.5, 5, 5);
      if (hot) {
        ctx.fillStyle = "rgba(255,181,94,0.3)";
        ctx.fillRect(P.x - 6, P.y - 6, 12, 12);
      }
    }
    ctx.font = FONT_PIXEL();
    ctx.textAlign = "center";
    FLOW_NODES.forEach((n, i) => {
      const P = pos(i);
      const on = i === a;
      const box = i === 4;
      const r = box ? 26 : on ? 30 + Math.sin(t * 4) * 2 : 24;
      for (let gx = -r; gx <= r; gx += 3) for (let gy = -r; gy <= r; gy += 3) {
        const inside = box ? Math.abs(gx) <= r && Math.abs(gy) <= r * 0.7 : gx * gx + gy * gy <= r * r;
        if (!inside) continue;
        const edge = box ? Math.max(Math.abs(gx) / r, Math.abs(gy) / (r * 0.7)) : Math.sqrt(gx * gx + gy * gy) / r;
        const alpha = box ? (edge > 0.86 ? 0.8 : 0.12) : 0.25 + 0.75 * (1 - edge * 0.7);
        ctx.fillStyle = on ? `rgba(255,181,94,${alpha})` : `rgba(226,220,224,${alpha * 0.75})`;
        ctx.fillRect(P.x + gx - 0.9, P.y + gy - 0.9, 1.8, 1.8);
      }
      ctx.fillStyle = on ? "rgba(255,234,204,0.95)" : "rgba(200,192,198,0.7)";
      ctx.fillText(n.k, P.x, P.y + r + 22);
    });
  });
  return <canvas ref={ref} aria-hidden="true" />;
}

// ───────────────────────────────────────────────────────────── method phases

/** One live scene per investigation phase; the scene restarts when `phase` changes. */
export function PhaseScene({ phase }: { phase: number }) {
  const phaseRef = useRef({ phase, since: -1 });
  useEffect(() => {
    phaseRef.current = { phase, since: -1 };
  }, [phase]);
  const seeds = useRef(Array.from({ length: 160 }, (_, i) => ({ a: Math.sin(i * 12.9898) * 43758.5453 % 1, b: Math.sin(i * 78.233) * 12345.678 % 1 })).map(({ a, b }) => ({ a: Math.abs(a), b: Math.abs(b) })));
  const ref = useCanvasLoop(({ ctx, w, h, t }) => {
    const st = phaseRef.current;
    if (st.since < 0) st.since = t;
    const k = t - st.since;
    const S = seeds.current;
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);
    const L = w * 0.12;
    const R = w * 0.9;
    const T = h * 0.14;
    const B = h * 0.72;
    const X = (u: number) => L + u * (R - L);
    const Y = (v: number) => B - v * (B - T);
    // dotted axes
    ctx.fillStyle = "rgba(230,224,226,0.18)";
    for (let x = L; x <= R; x += 6) ctx.fillRect(x, B, 1.5, 1.5);
    for (let y = T; y <= B; y += 6) ctx.fillRect(L, y, 1.5, 1.5);
    const dot = (x: number, y: number, s: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    };
    const accent = (a: number) => `rgba(255,181,94,${a})`;
    const bone = (a: number) => `rgba(236,230,232,${a})`;
    const f = (u: number) => (u < 0.55 ? 0.25 + u * 0.95 : 0.1);
    switch (st.phase) {
      case 0: {
        // stratified personas fan out; replicate rings show noise
        S.slice(0, 90).forEach((p, i) => {
          const g = Math.min(1, Math.max(0, (k * 1.4 - i * 0.012) * 1.6));
          const u = (Math.floor(p.a * 9) + p.b) / 9;
          const v = f(u) + (p.b - 0.5) * 0.12;
          const x = X(0.5) + (X(u) - X(0.5)) * g;
          const y = Y(0.5) + (Y(v) - Y(0.5)) * g;
          dot(x, y, 3.2, bone(0.25 + 0.6 * g));
          if (i % 11 === 0 && g >= 1) {
            ctx.strokeStyle = accent(0.6 + 0.4 * Math.sin(t * 3 + i));
            ctx.beginPath();
            ctx.arc(x, y, 7 + Math.sin(t * 2 + i) * 2, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
        break;
      }
      case 1: {
        // counterfactual triples: lo → mid → hi per subject
        for (let i = 0; i < 10; i++) {
          const y = T + 10 + i * ((B - T - 20) / 9);
          const base = 0.15 + S[i].a * 0.3;
          const pts = [base, base + 0.18, i % 3 === 0 ? 0.05 : base + 0.36];
          const g = Math.min(1, Math.max(0, k * 0.9 - i * 0.08));
          const show = Math.floor(g * 3.99);
          for (let j = 0; j <= Math.min(2, show); j++) {
            if (j > 0) {
              ctx.fillStyle = pts[j] < pts[j - 1] ? accent(0.65) : bone(0.35);
              const steps = Math.abs(X(pts[j]) - X(pts[j - 1])) / 5;
              for (let s2 = 0; s2 < steps; s2++) ctx.fillRect(X(pts[j - 1]) + ((X(pts[j]) - X(pts[j - 1])) * s2) / steps, y, 2, 1.5);
            }
            dot(X(pts[j]), y, j === 2 ? 6 : 4.5, j === 2 && pts[2] < pts[1] ? accent(1) : bone(0.9));
          }
        }
        break;
      }
      case 2: {
        // dose-response sweep with a cliff, then bisection converges on it
        const n = 40;
        const drawn = Math.min(n, Math.floor(k * 18));
        for (let i = 0; i <= drawn; i++) {
          const u = i / n;
          dot(X(u), Y(f(u) + (S[i].a - 0.5) * 0.03), 4, u > 0.55 ? accent(0.9) : bone(0.85));
        }
        if (drawn >= n) {
          let lo = 0.3;
          let hi = 0.8;
          const iters = Math.min(6, Math.floor((k - 2.4) * 2));
          for (let i = 0; i < iters; i++) {
            const mid = (lo + hi) / 2;
            if (mid < 0.55) lo = mid;
            else hi = mid;
            ctx.fillStyle = accent(0.35 + (i / 6) * 0.65);
            ctx.fillRect(X(mid) - 1, B + 8, 2, 14);
          }
          ctx.fillStyle = accent(0.12);
          ctx.fillRect(X(lo), T, Math.max(2, X(hi) - X(lo)), B - T);
          ctx.font = FONT_PIXEL();
          ctx.fillStyle = accent(0.95);
          ctx.textAlign = "left";
          ctx.fillText(`threshold ∈ [${lo.toFixed(3)}, ${hi.toFixed(3)}]`, X(hi) + 10, T + 14);
        }
        break;
      }
      case 3: {
        // 2×2 factorial: non-parallel lines reveal an interaction
        const g = Math.min(1, k * 0.8);
        const lines = [
          { a: 0.3, b: 0.62, c: bone },
          { a: 0.26, b: 0.26 + (0.08 - 0.26) * g + 0.02, c: accent },
        ];
        lines.forEach((l) => {
          const steps = 40;
          for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            dot(X(0.2 + u * 0.6), Y(l.a + (l.b - l.a) * u), 2.4, l.c(0.85));
          }
          dot(X(0.2), Y(l.a), 9, l.c(1));
          dot(X(0.8), Y(l.b), 9, l.c(1));
        });
        ctx.font = FONT_PIXEL();
        ctx.textAlign = "center";
        ctx.fillStyle = bone(0.6);
        ctx.fillText("B = low", X(0.2), B + 22);
        ctx.fillText("B = high", X(0.8), B + 22);
        ctx.fillStyle = accent(0.9);
        ctx.fillText(`ΔΔ = ${(-(0.36 + 0.18 * g)).toFixed(2)}`, X(0.5), T + 4);
        break;
      }
      case 4: {
        // uncertainty field: candidates scored, most disputed probes selected
        for (let gx = 0; gx < 36; gx++) for (let gy = 0; gy < 18; gy++) {
          const u = gx / 35;
          const v = gy / 17;
          const sd = Math.exp(-((u - 0.55) ** 2) / 0.01) * 0.8 + Math.exp(-((u - 0.2) ** 2 + (v - 0.7) ** 2) / 0.03) * 0.6 * Math.max(0, 1 - k * 0.15);
          const a = 0.08 + Math.min(0.9, sd) * (0.7 + 0.3 * Math.sin(t * 2 + gx * 0.4));
          dot(X(u), Y(v), 3.2, sd > 0.45 ? accent(a) : bone(a * 0.6));
        }
        [0.54, 0.56, 0.55, 0.21, 0.53].forEach((u, i) => {
          const v = [0.2, 0.55, 0.85, 0.7, 0.4][i];
          const pulse = (t * 0.8 + i * 0.2) % 1;
          ctx.strokeStyle = accent(1 - pulse);
          ctx.beginPath();
          ctx.arc(X(u), Y(v), 4 + pulse * 16, 0, Math.PI * 2);
          ctx.stroke();
          dot(X(u), Y(v), 6, "rgba(255,240,214,1)");
        });
        break;
      }
      default: {
        // surrogate tree grows split by split; leaves glow
        const depth = Math.min(4, Math.floor(k * 1.4));
        const node = (x: number, y: number, d: number, span: number) => {
          dot(x, y, d === depth ? 7 : 6, d === depth ? accent(0.95) : bone(0.9));
          if (d >= depth) return;
          const ny = y + (B - T) / 4.4;
          [x - span, x + span].forEach((cx) => {
            const steps = 14;
            for (let i = 1; i < steps; i++) dot(x + ((cx - x) * i) / steps, y + ((ny - y) * i) / steps, 1.6, bone(0.35));
            node(cx, ny, d + 1, span / 2);
          });
        };
        node(X(0.5), T, 0, (R - L) / 4);
        break;
      }
    }
  });
  return <canvas ref={ref} aria-hidden="true" />;
}
