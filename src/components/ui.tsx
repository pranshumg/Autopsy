"use client";

import * as RTooltip from "@radix-ui/react-tooltip";
import { animate, useReducedMotion } from "motion/react";
import Link from "next/link";
import { forwardRef, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/format";

export type Tone = "signal" | "model" | "truth" | "amber" | "alert" | "coral" | "neutral";

export const toneText: Record<Tone, string> = {
  signal: "text-signal",
  model: "text-model",
  truth: "text-truth",
  amber: "text-amber",
  alert: "text-alert",
  coral: "text-coral",
  neutral: "text-fg-2",
};

export const toneBg: Record<Tone, string> = {
  signal: "bg-signal",
  model: "bg-model",
  truth: "bg-truth",
  amber: "bg-amber",
  alert: "bg-alert",
  coral: "bg-coral",
  neutral: "bg-fg-3",
};

export const toneVar: Record<Tone, string> = {
  signal: "var(--color-signal)",
  model: "var(--color-model)",
  truth: "var(--color-truth)",
  amber: "var(--color-amber)",
  alert: "var(--color-alert)",
  coral: "var(--color-coral)",
  neutral: "var(--color-fg-3)",
};

// ── Button ───────────────────────────────────────────────────────────────────

type BtnVariant = "primary" | "signal" | "outline" | "ghost" | "danger";
type BtnSize = "xs" | "sm" | "md" | "lg";

const btnBase =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background,color,border-color,box-shadow,transform] duration-200 disabled:opacity-40 disabled:pointer-events-none active:translate-y-px select-none";
const btnVariant: Record<BtnVariant, string> = {
  primary: "bg-white text-black hover:bg-neutral-200 shadow-[0_2px_20px_-8px_rgb(255_255_255/0.3)]",
  signal: "bg-signal/12 text-signal border border-signal/30 hover:bg-signal/20 hover:border-signal/50",
  outline: "border border-line-2 text-fg hover:border-line-3 hover:bg-white/[0.03]",
  ghost: "text-fg-2 hover:text-fg hover:bg-white/[0.04]",
  danger: "border border-alert/30 text-alert hover:bg-alert/10 hover:border-alert/50",
};
const btnSize: Record<BtnSize, string> = {
  xs: "h-6 px-2 text-[11px] rounded-[5px]",
  sm: "h-7 px-2.5 text-xs rounded-md",
  md: "h-9 px-3.5 text-[13px] rounded-md",
  lg: "h-11 px-5 text-sm rounded-lg",
};

type ButtonProps = ComponentProps<"button"> & { variant?: BtnVariant; size?: BtnSize };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "sm", className, type = "button", ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={cn(btnBase, btnVariant[variant], btnSize[size], className)} {...rest} />;
});

export function ButtonLink({
  variant = "outline",
  size = "sm",
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: BtnSize }) {
  return <Link className={cn(btnBase, btnVariant[variant], btnSize[size], className)} {...rest} />;
}

// ── Chips, dots, labels ─────────────────────────────────────────────────────

export function Chip({ tone = "neutral", children, className, solid }: { tone?: Tone; children: ReactNode; className?: string; solid?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-[4px] px-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] whitespace-nowrap",
        solid ? cn(toneBg[tone], "text-ink-950") : cn(toneText[tone], "border border-current/25 bg-current/[0.07]"),
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse, size = 6, className }: { tone?: Tone; pulse?: boolean; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full", toneBg[tone], toneText[tone], pulse && "animate-pulse-dot", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("label-mono", className)}>{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-2 bg-ink-800 px-1 font-mono text-[10px] text-fg-2">
      {children}
    </kbd>
  );
}

// ── Meter ───────────────────────────────────────────────────────────────────

export function Meter({ value, tone = "signal", className, height = 3, label }: { value: number; tone?: Tone; className?: string; height?: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
      className={cn("relative w-full overflow-hidden rounded-full bg-white/[0.06]", className)}
      style={{ height }}
    >
      <div className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-expo", toneBg[tone])} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** Small circular confidence gauge. */
export function Ring({ value, tone = "model", size = 28, stroke = 2.5, children }: { value: number; tone?: Tone; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={toneVar[tone]}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] text-fg-2">{children}</span>}
    </span>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

export function Tip({ content, children, side = "top", delay = 250 }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; delay?: number }) {
  return (
    <RTooltip.Root delayDuration={delay}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[100] max-w-xs rounded-md border border-line-2 bg-ink-800/95 px-2.5 py-1.5 text-xs text-fg-2 shadow-xl backdrop-blur data-[state=delayed-open]:animate-rise"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

// ── Segmented control ───────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "xs" | "sm";
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-md border border-line bg-ink-950/60 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[4px] font-mono uppercase tracking-[0.08em] transition-colors",
              size === "xs" ? "h-5 px-1.5 text-[9.5px]" : "h-6 px-2 text-[10px]",
              active ? "bg-ink-700 text-fg shadow-[inset_0_0_0_1px_var(--color-line-2)]" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Animated number ─────────────────────────────────────────────────────────

export function Ticker({ value, format = (v) => Math.round(v).toLocaleString("en-US"), className }: { value: number; format?: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || !Number.isFinite(value) || !Number.isFinite(prev.current)) {
      el.textContent = format(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = format(v);
      },
    });
    prev.current = value;
    return () => controls.stop();
    // format is intentionally excluded: callers pass inline closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);
  return (
    <span ref={ref} className={cn("tabular", className)}>
      {format(value)}
    </span>
  );
}

// ── Panel header / empty / skeleton ─────────────────────────────────────────

export function PanelHeader({ title, index, right, className }: { title: ReactNode; index?: string; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-9 shrink-0 items-center gap-2 border-b border-line px-3", className)}>
      {index && <span className="font-mono text-[10px] text-fg-4">{index}</span>}
      <div className="label-mono !text-fg-2 truncate">{title}</div>
      <div className="ml-auto flex items-center gap-1.5">{right}</div>
    </div>
  );
}

export function Empty({ icon, title, hint, action, className }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {icon && <div className="mb-1 text-fg-4">{icon}</div>}
      <div className="text-sm text-fg-2">{title}</div>
      {hint && <div className="max-w-xs text-xs leading-relaxed text-fg-3">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

// ── Visibility (pause animations while hidden by Activity or off-screen) ────

export function useInView<T extends Element>(rootMargin = "100px"): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, inView];
}

// ── Logo ────────────────────────────────────────────────────────────────────

export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="3" stroke="currentColor" strokeOpacity="0.9" strokeWidth="1.4" />
      <path d="M6 18 L18 6" stroke="var(--color-truth)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6 12.5 L9.5 12.5" stroke="var(--color-signal)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 9.5 L8 9.5" stroke="var(--color-signal)" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.6" />
      <circle cx="18" cy="6" r="1.6" fill="var(--color-truth)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <LogoMark />
      <span className="font-mono text-[13px] font-semibold tracking-[0.28em]">AUTOPSY</span>
    </span>
  );
}
