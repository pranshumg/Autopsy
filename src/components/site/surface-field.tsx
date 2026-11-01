"use client";

// Hero backdrop: the decision surface of a black box, seen as an endless
// ridgeline terrain rolling toward the viewer. A glowing cliff (the hidden
// threshold) winds through it, a scan pulse sweeps out to the horizon, data
// streaks fall through an aurora sky, and the cursor ripples the surface.
// One WebGL fragment shader; no video or image assets.

import { useEffect, useRef } from "react";

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseOn;
uniform float uIntro;

const vec3 AMBER = vec3(1.0, 0.62, 0.26);
const vec3 HOT = vec3(1.0, 0.88, 0.66);
const vec3 TEAL = vec3(0.24, 0.8, 0.76);
const float HZ = -0.12;
const float CAMH = 0.36;
const float K = 0.95;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// where the hidden threshold runs across the surface at depth z
float threshold(float z, float t) {
  return 0.9 * sin(z * 0.22 + t * 0.08) + 0.35 * sin(z * 0.61 - t * 0.05);
}

float height(float x, float z, float t) {
  float h = 0.07 * sin(x * 1.1 + z * 0.35 - t * 0.5) + 0.05 * sin(x * 2.3 - z * 0.6 + t * 0.35) + 0.035 * sin(x * 4.1 + z * 1.3 + t * 0.7);
  h += 0.22 * smoothstep(0.12, -0.12, x - threshold(z, t));
  return h * (0.5 + 0.5 * smoothstep(0.0, 1.8, abs(x)));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float sy = p.y - HZ;

  // ── sky ───────────────────────────────────────────────────────────────
  vec3 col = mix(vec3(0.03, 0.08, 0.09), vec3(0.004, 0.012, 0.016), clamp(sy * 1.7, 0.0, 1.0));
  float glow = exp(-length(vec2(p.x * 0.7, (p.y - 0.03) * 1.5)) * 2.4);
  col += AMBER * glow * 0.2 + TEAL * exp(-length(vec2(p.x * 0.45, (p.y - 0.18) * 1.2)) * 1.6) * 0.07;
  col += mix(TEAL, AMBER, exp(-abs(p.x) * 1.4)) * exp(-abs(sy) * 60.0) * 0.28;
  if (sy > 0.0) {
    // aurora curtains drifting across the upper sky
    float a = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float n = noise(vec2(p.x * 1.3 + fi * 3.1 + t * 0.05 * (fi + 1.0), t * 0.06 + fi * 4.0));
      a += smoothstep(0.5, 0.95, n) * smoothstep(0.0, 0.25, sy) * exp(-sy * (1.8 + fi));
    }
    col += mix(TEAL, AMBER, 0.25) * a * 0.12;
    // falling data streaks
    float cid = floor(frag.x / 7.0);
    float hs = hash(vec2(cid, 2.0));
    if (hs > 0.8) {
      float u = frag.y / uRes.y;
      float v = fract(u * 1.3 + t * (0.07 + hs * 0.16) + hs * 7.0);
      float s = smoothstep(0.0, 0.015, v) * pow(1.0 - v, 9.0);
      float fx = abs(fract(frag.x / 7.0) - 0.5);
      col += mix(TEAL, HOT, step(0.93, hs)) * s * smoothstep(0.22, 0.0, fx) * smoothstep(0.0, 0.18, sy) * 0.55;
    }
    // star dust
    vec2 g = frag / 3.0;
    float st = hash(floor(g));
    if (st > 0.996) col += HOT * (0.5 + 0.5 * sin(t * (1.0 + st * 5.0) + st * 60.0)) * 0.5 * smoothstep(0.0, 0.3, sy);
  }

  // ── terrain: ridgelines from near to far, nearer ridges hide farther ones
  float mx = 0.0;
  float mz = -100.0;
  if (uMouseOn > 0.5 && uMouse.y < HZ - 0.02) {
    mz = CAMH * K / (HZ - uMouse.y);
    mx = uMouse.x * mz / K;
  }
  float zs = 0.8 + mod(t * 3.6, 26.0);
  float px = p.x + uMouse.x * 0.02 * uMouseOn;
  float off = fract(t * 1.6);
  bool hidden = false;
  vec3 ground = vec3(0.004, 0.011, 0.013) + AMBER * glow * 0.05;
  float lw = 0.9 / uRes.y;
  for (int i = 0; i < 56; i++) {
    float fi = float(i) - off;
    float z = 0.85 + fi * 0.3 * (1.0 + fi * 0.025);
    if (z < 0.6) continue;
    float xw = px * z / K;
    float h = height(xw, z, t);
    if (mz > 0.0) {
      float d = length(vec2(xw - mx, (z - mz) * 0.6));
      h += (0.09 * sin(d * 7.0 - t * 5.0) + 0.06) * exp(-d * 1.2);
    }
    h *= uIntro;
    float ly = HZ + (h - CAMH) * K / z;
    float d = p.y - ly;
    if (!hidden) {
      if (d < 0.0) {
        col = ground;
        hidden = true;
      }
      float line = smoothstep(lw * (1.0 + 1.2 / z), 0.0, abs(d));
      // ridges thin out and dim toward the horizon so it never becomes a wall
      float fade = exp(-z * 0.16) * smoothstep(0.6, 1.3, z);
      float edge = exp(-pow((xw - threshold(z, t)) / 0.14, 2.0));
      float scan = exp(-pow((z - zs) / 0.4, 2.0));
      // bright data points riding along each ridge
      float pt = smoothstep(0.035, 0.0, abs(fract(xw * 0.8 + t * 0.25 + hash(vec2(floor(fi + off), 3.0))) - 0.5) - 0.465);
      // crest lighting: ridges catch more light where they rise
      float lift = clamp(h * 4.0 + 0.6, 0.5, 1.15);
      vec3 lc = mix(vec3(0.22, 0.62, 0.6) * lift, AMBER, edge);
      lc = mix(lc, HOT, scan * 0.85);
      col += lc * line * fade * (0.5 + 1.1 * edge + 1.4 * scan + 1.6 * pt);
    }
  }

  // ── grade ─────────────────────────────────────────────────────────────
  vec2 q = frag / uRes;
  col *= 0.5 + 0.5 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.22);
  col = 1.0 - exp(-col * 1.4);
  col += (hash(frag + fract(t * 13.0) * 91.0) - 0.5) * 0.03;
  col *= smoothstep(0.0, 1.0, uIntro * 1.4);
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  return s;
}

export function SurfaceField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const section = canvas?.closest("section");
    if (!canvas || !section) return;
    const gl = canvas.getContext("webgl", { antialias: false, powerPreference: "high-performance" });
    if (!gl) {
      canvas.dataset.fallback = "true";
      return;
    }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
    } catch (e) {
      console.warn("AUTOPSY hero shader unavailable:", e);
      canvas.dataset.fallback = "true";
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = U("uRes");
    const uTime = U("uTime");
    const uMouse = U("uMouse");
    const uMouseOn = U("uMouseOn");
    const uIntro = U("uIntro");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mouse = { x: 0, y: 0, tx: 0, ty: 0, on: 0 };
    let raf = 0;
    let visible = true;
    const start = performance.now();

    const draw = (now: number) => {
      const t = reduce.matches ? 12 : (now - start) / 1000;
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;
      gl.uniform1f(uTime, t);
      gl.uniform1f(uIntro, reduce.matches ? 1 : 1 - Math.pow(1 - Math.min(1, t / 2.4), 3));
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uMouseOn, mouse.on);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const resize = () => {
      const r = section.getBoundingClientRect();
      // ridgelines need near-native resolution to stay crisp
    const scale = Math.min(window.devicePixelRatio || 1, 1.25) * (r.width * r.height > 2.2e6 ? 0.8 : 1);
      canvas.width = Math.max(1, Math.round(r.width * scale));
      canvas.height = Math.max(1, Math.round(r.height * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      draw(performance.now());
    };
    const loop = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw(now);
      if (!reduce.matches) raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    // pointer in the shader's coordinates: origin at the centre, height = 1
    const move = (e: PointerEvent) => {
      const r = section.getBoundingClientRect();
      mouse.tx = (e.clientX - r.left - r.width / 2) / r.height;
      mouse.ty = (r.height / 2 - (e.clientY - r.top)) / r.height;
      mouse.on = 1;
    };
    const leave = () => {
      mouse.on = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      kick();
    });
    const ro = new ResizeObserver(resize);
    io.observe(section);
    ro.observe(section);
    section.addEventListener("pointermove", move as EventListener);
    section.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", kick);
    reduce.addEventListener("change", kick);
    resize();
    kick();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      section.removeEventListener("pointermove", move as EventListener);
      section.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", kick);
      reduce.removeEventListener("change", kick);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, []);
  return <canvas ref={ref} className="s-hero-canvas" aria-hidden="true" />;
}
