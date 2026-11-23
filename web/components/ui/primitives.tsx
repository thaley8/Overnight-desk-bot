"use client";

import { ArrowDownRight, ArrowUpRight, Minus, Search, X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "@/lib/format";

/* ─────────────── Surfaces ─────────────── */

export function Panel({ children, className, as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx("rounded-lg border border-line bg-panel", className)} {...rest}>
      {children}
    </As>
  );
}

export function PanelHeader({ title, index, subtitle, right, className }: { title: ReactNode; index?: string; subtitle?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <header className={cx("flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hairline-b", className)}>
      <div className="flex min-w-0 items-baseline gap-2.5">
        {index && <span className="num text-2xs text-fg-4">{index}</span>}
        <h2 className="truncate text-[13px] font-medium text-fg">{title}</h2>
        {subtitle && <span className="hidden truncate text-xs text-fg-3 sm:inline">{subtitle}</span>}
      </div>
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}

export function PageHeader({ title, description, right, eyebrow }: { title: string; description?: ReactNode; right?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4 pb-6">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-2">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.015em] text-fg">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-fg-2">{description}</p>}
      </div>
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/* ─────────────── Text & status ─────────────── */

export type Tone = "neutral" | "accent" | "cyan" | "pos" | "neg" | "warn";

const toneText: Record<Tone, string> = {
  neutral: "text-fg-2",
  accent: "text-accent-2",
  cyan: "text-cyan",
  pos: "text-pos",
  neg: "text-neg",
  warn: "text-warn",
};
const toneBadge: Record<Tone, string> = {
  neutral: "bg-fg-3/10 text-fg-2 ring-fg-3/20",
  accent: "bg-accent/12 text-accent-2 ring-accent/25",
  cyan: "bg-cyan/10 text-cyan ring-cyan/20",
  pos: "bg-pos/10 text-pos ring-pos/20",
  neg: "bg-neg/10 text-neg ring-neg/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
};
const toneDot: Record<Tone, string> = {
  neutral: "bg-fg-3 text-fg-3",
  accent: "bg-accent text-accent",
  cyan: "bg-cyan text-cyan",
  pos: "bg-pos text-pos",
  neg: "bg-neg text-neg",
  warn: "bg-warn text-warn",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-2xs font-medium uppercase tracking-[0.06em] ring-1 ring-inset", toneBadge[tone], className)}>
      {dot && <span className={cx("size-1.5 rounded-full", toneDot[tone])} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone = "pos", pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden className={cx("inline-block size-1.5 shrink-0 rounded-full", toneDot[tone], pulse && "animate-pulse-dot", className)} />;
}

export function Delta({ value, format, className, icon = true, muted }: { value: number | null; format: (v: number) => string; className?: string; icon?: boolean; muted?: boolean }) {
  if (value === null || Number.isNaN(value)) return <span className={cx("num text-fg-4", className)}>—</span>;
  const tone = value > 0 ? "text-pos" : value < 0 ? "text-neg" : "text-fg-3";
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cx("num inline-flex items-center gap-0.5 whitespace-nowrap", muted ? "text-fg-2" : tone, className)}>
      {icon && <Icon className={cx("size-3.5 shrink-0", tone)} strokeWidth={2} />}
      {format(value)}
    </span>
  );
}

export function ToneText({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cx(toneText[tone], className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-line-2 bg-bg-2 px-1 text-2xs text-fg-3">{children}</kbd>;
}

/* ─────────────── Controls ─────────────── */

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
const btnBase = "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[12.5px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:opacity-45";
const btnVariant: Record<BtnVariant, string> = {
  primary: "bg-accent text-white hover:bg-[#4d97ff] active:bg-[#2f7ef0] shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]",
  secondary: "border border-line-2 bg-elevated text-fg hover:border-line-3 hover:bg-hover",
  ghost: "text-fg-2 hover:bg-elevated hover:text-fg",
  danger: "border border-neg/30 bg-neg/8 text-neg hover:bg-neg/14 hover:border-neg/45",
  "danger-solid": "bg-neg text-white hover:bg-[#e8737d]",
};
const btnSize = { sm: "h-7 px-2.5", md: "h-8 px-3", lg: "h-10 px-4 text-[13px]" };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: keyof typeof btnSize }>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={cx(btnBase, btnVariant[variant], btnSize[size], className)} {...rest} />;
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(function IconButton(
  { label, className, active, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx("relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-elevated hover:text-fg", active && "bg-elevated text-fg", className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Segmented<T extends string>({ value, onChange, options, size = "md", className, label }: { value: T; onChange: (v: T) => void; options: readonly (T | { value: T; label: ReactNode })[]; size?: "sm" | "md"; className?: string; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex max-w-full shrink-0 items-center overflow-x-auto rounded-md border border-line bg-bg-2 p-0.5", className)}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={cx(
              "num shrink-0 whitespace-nowrap rounded-[5px] font-medium transition-colors",
              size === "sm" ? "h-6 px-2 text-2xs" : "h-7 px-2.5 text-xs",
              on ? "bg-elevated text-fg shadow-[inset_0_0_0_1px_var(--color-line-2)]" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("flex items-center gap-5 overflow-x-auto", className)}>
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange(t.value)}
            className={cx("relative flex h-12 shrink-0 items-center gap-1.5 text-[12.5px] font-medium transition-colors", on ? "text-fg" : "text-fg-3 hover:text-fg-2")}
          >
            {t.label}
            {t.count !== undefined && <span className={cx("num rounded px-1 text-2xs", on ? "bg-accent/15 text-accent-2" : "bg-fg-3/10 text-fg-3")}>{t.count}</span>}
            <span className={cx("absolute inset-x-0 -bottom-px h-px transition-colors", on ? "bg-accent" : "bg-transparent")} />
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search", className, ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className={cx("group relative flex h-8 items-center", className)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-fg-3 group-focus-within:text-fg-2" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-full w-full rounded-md border border-line bg-bg-2 pl-8 pr-7 text-[12.5px] text-fg placeholder:text-fg-4 transition-colors hover:border-line-2 focus:border-accent/60 focus:outline-none"
        {...rest}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-1.5 rounded p-0.5 text-fg-3 hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string }) {
  return (
    <label className={cx("relative inline-flex h-8 items-center rounded-md border border-line bg-bg-2 pl-2.5 pr-1 text-[12.5px] transition-colors hover:border-line-2 focus-within:border-accent/60", className)}>
      <span className="mr-1.5 text-fg-3">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-full cursor-pointer appearance-none bg-transparent pr-5 font-medium text-fg focus:outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-elevated">
            {o.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2 size-3 text-fg-3" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled, size = "md" }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40",
        size === "sm" ? "h-4 w-7" : "h-5 w-9",
        checked ? "bg-accent" : "bg-fg-4/50 hover:bg-fg-4/70",
      )}
    >
      <span className={cx("inline-block rounded-full bg-white shadow transition-transform duration-200", size === "sm" ? "size-3" : "size-4", checked ? (size === "sm" ? "translate-x-3.5" : "translate-x-[18px]") : "translate-x-0.5")} />
    </button>
  );
}

/* ─────────────── Data display ─────────────── */

export function Stat({ label, value, sub, className, size = "md" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="label truncate">{label}</div>
      <div className={cx("num mt-1.5 truncate font-medium text-fg", size === "lg" ? "text-[30px] leading-9 tracking-[-0.02em]" : size === "md" ? "text-[19px] leading-6" : "text-[15px] leading-5")}>{value}</div>
      {sub && <div className="mt-1 truncate text-xs text-fg-3">{sub}</div>}
    </div>
  );
}

export function Meter({ value: raw, max = 1, tone, className, height = 4, marks }: { value: number | null; max?: number; tone?: Tone; className?: string; height?: number; marks?: number[] }) {
  const value = raw ?? 0;
  const pct = Math.max(0, Math.min(1, value / max));
  const autoTone: Tone = tone ?? (pct >= 0.9 ? "neg" : pct >= 0.7 ? "warn" : "accent");
  const color = { neutral: "bg-fg-3", accent: "bg-accent", cyan: "bg-cyan", pos: "bg-pos", neg: "bg-neg", warn: "bg-warn" }[autoTone];
  return (
    <div className={cx("relative w-full overflow-hidden rounded-full bg-fg-4/25", className)} style={{ height }}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct * 100}%` }} />
      {marks?.map((m) => (
        <span key={m} className="absolute top-0 h-full w-px bg-bg/80" style={{ left: `${m * 100}%` }} />
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function Empty({ title, detail, icon, action }: { title: string; detail?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-fg-4">{icon}</div>}
      <div className="text-sm font-medium text-fg-2">{title}</div>
      {detail && <div className="max-w-sm text-xs text-fg-3">{detail}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function KeyValue({ items, className, cols = 2 }: { items: { k: ReactNode; v: ReactNode }[]; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx("grid gap-x-6", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
          <dt className="shrink-0 text-xs text-fg-3">{it.k}</dt>
          <dd className="num min-w-0 truncate text-right text-[12.5px] text-fg">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return <span className={cx("inline-flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#26406a] to-[#16263d] text-2xs font-semibold text-fg ring-1 ring-line-2", className)}>{initials}</span>;
}

/** A token glyph: two-letter monogram on a deterministic tint. */
export function TokenMark({ symbol, size = 24 }: { symbol: string; size?: number }) {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 360;
  const hue = 190 + (h % 60); // stays in the blue–cyan family
  return (
    <span
      aria-hidden
      className="num inline-flex shrink-0 items-center justify-center rounded-md font-medium text-fg ring-1 ring-inset ring-white/8"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(140deg, hsl(${hue} 55% 26%), hsl(${hue + 12} 45% 16%))` }}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

/** A labelled hole where the data source has nothing to show. Never filled with placeholder figures. */
export function Gap({ title, detail, className, compact }: { title: string; detail?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center justify-center rounded-md border border-dashed border-line-2 text-center", compact ? "gap-1 px-4 py-5" : "gap-1.5 px-6 py-10", className)}>
      <div className="label text-fg-3">{title}</div>
      {detail && <div className="max-w-md text-xs leading-5 text-fg-4">{detail}</div>}
    </div>
  );
}
