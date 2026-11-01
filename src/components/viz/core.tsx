"use client";

import { scaleLinear } from "d3-scale";
import { line as d3line, curveMonotoneX } from "d3-shape";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { InvestigationState, Observation, OutputSpec } from "@/lib/types";
import { cn, fmtOutput } from "@/lib/format";

export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize((s) => (Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1 ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function useObsMap(inv: InvestigationState): Map<number, Observation> {
  return useMemo(() => new Map(inv.observations.map((o) => [o.id, o])), [inv.observations]);
}

/** Responsive SVG container that measures its width. */
export function Chart({ height, className, children, label }: { height: number; className?: string; children: (w: number, h: number) => ReactNode; label: string }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {children(width, height)}
        </svg>
      )}
    </div>
  );
}

export function AxisLabel({ x, y, children, anchor = "start" }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="fill-fg-4 font-mono" fontSize={9} letterSpacing="0.06em">
      {children}
    </text>
  );
}

/** Horizontal estimate with 95% CI, drawn on a zero-centred axis. */
export function CIBar({
  estimate,
  ci,
  domain,
  tone = "var(--color-model)",
  height = 22,
  margin,
  className,
}: {
  estimate: number;
  ci: [number, number];
  domain: [number, number];
  tone?: string;
  height?: number;
  margin?: number;
  className?: string;
}) {
  return (
    <Chart height={height} className={className} label={`Estimate ${estimate.toFixed(2)}, 95% interval ${ci[0].toFixed(2)} to ${ci[1].toFixed(2)}`}>
      {(w, h) => {
        const x = scaleLinear().domain(domain).range([4, w - 4]).clamp(true);
        const cy = h / 2;
        return (
          <g>
            {margin !== undefined && <rect x={x(-margin)} y={2} width={Math.max(0, x(margin) - x(-margin))} height={h - 4} fill="rgb(255 255 255 / 0.04)" rx={2} />}
            <line x1={x(0)} x2={x(0)} y1={1} y2={h - 1} stroke="var(--color-line-3)" strokeDasharray="2 2" />
            <line x1={x(ci[0])} x2={x(ci[1])} y1={cy} y2={cy} stroke={tone} strokeWidth={2} strokeOpacity={0.6} strokeLinecap="round" />
            <line x1={x(ci[0])} x2={x(ci[0])} y1={cy - 4} y2={cy + 4} stroke={tone} strokeOpacity={0.7} />
            <line x1={x(ci[1])} x2={x(ci[1])} y1={cy - 4} y2={cy + 4} stroke={tone} strokeOpacity={0.7} />
            <circle cx={x(estimate)} cy={cy} r={4} fill={tone} stroke="var(--color-ink-950)" strokeWidth={1.5} />
          </g>
        );
      }}
    </Chart>
  );
}

export function Histogram({
  values,
  bins = 24,
  height = 90,
  color = "var(--color-signal)",
  domain,
  format,
  highlight,
  label = "Distribution",
}: {
  values: number[];
  bins?: number;
  height?: number;
  color?: string;
  domain?: [number, number];
  format?: (v: number) => string;
  highlight?: number;
  label?: string;
}) {
  const [lo, hi] = domain ?? [Math.min(...values, 0), Math.max(...values, 1)];
  const counts = useMemo(() => {
    const c = new Array(bins).fill(0);
    const span = hi - lo || 1;
    for (const v of values) c[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / span) * bins)))]++;
    return c as number[];
  }, [values, bins, lo, hi]);
  const max = Math.max(1, ...counts);
  return (
    <Chart height={height} label={label}>
      {(w, h) => {
        const bw = w / bins;
        const y = scaleLinear().domain([0, max]).range([h - 14, 2]);
        const x = scaleLinear().domain([lo, hi]).range([0, w]);
        return (
          <g>
            {counts.map((c, i) => (
              <rect key={i} x={i * bw + 0.5} y={y(c)} width={Math.max(0.5, bw - 1.5)} height={h - 14 - y(c)} fill={color} fillOpacity={c ? 0.75 : 0} rx={1}>
                <title>{`${format ? format(lo + (i / bins) * (hi - lo)) : (lo + (i / bins) * (hi - lo)).toFixed(1)} — ${c}`}</title>
              </rect>
            ))}
            <line x1={0} x2={w} y1={h - 13.5} y2={h - 13.5} stroke="var(--color-line-2)" />
            {highlight !== undefined && <line x1={x(highlight)} x2={x(highlight)} y1={0} y2={h - 14} stroke="var(--color-truth)" strokeWidth={1.5} />}
            <AxisLabel x={0} y={h - 2}>
              {format ? format(lo) : lo.toFixed(1)}
            </AxisLabel>
            <AxisLabel x={w} y={h - 2} anchor="end">
              {format ? format(hi) : hi.toFixed(1)}
            </AxisLabel>
          </g>
        );
      }}
    </Chart>
  );
}

export function Sparkline({ values, height = 28, color = "var(--color-signal)", fill = true, label = "Trend" }: { values: number[]; height?: number; color?: string; fill?: boolean; label?: string }) {
  return (
    <Chart height={height} label={label}>
      {(w, h) => {
        if (values.length < 2) return <line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke="var(--color-line-2)" strokeDasharray="2 3" />;
        const x = scaleLinear().domain([0, values.length - 1]).range([1, w - 1]);
        const ext = [Math.min(...values), Math.max(...values)];
        const y = scaleLinear().domain(ext[0] === ext[1] ? [ext[0] - 1, ext[1] + 1] : ext).range([h - 2, 2]);
        const d = d3line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX)(values) ?? "";
        return (
          <g>
            {fill && <path d={`${d} L ${x(values.length - 1)} ${h} L ${x(0)} ${h} Z`} fill={color} fillOpacity={0.08} />}
            <path d={d} fill="none" stroke={color} strokeWidth={1.4} />
            <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.2} fill={color} />
          </g>
        );
      }}
    </Chart>
  );
}

export function outputDomain(o: OutputSpec, values: number[]): [number, number] {
  if (!values.length) return [o.min, o.max];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;
  return [Math.max(o.min, lo - pad), Math.min(o.max * 1.05, hi + pad)];
}

export function ValueTip({ o, v }: { o: OutputSpec; v: number }) {
  return <>{fmtOutput(o, v)}</>;
}
