/**
 * Shared interface primitives: headers, cards, buttons, form controls, dialogs
 * and status labels. Every screen is built from these.
 */

import { Link } from "react-router-dom";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import {
  AlertIcon,
  ChartIcon,
  CheckIcon,
  ClockIcon,
  FlowIcon,
  KeyIcon,
  MissedIcon,
  PhoneIcon,
  ShieldIcon,
  SoundIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";
import { ApiError, NetworkError } from "@/lib/errors";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * A figure that acknowledges its own change.
 *
 * On a dashboard that updates itself, a number silently becoming a different
 * number is easy to miss. A single brief flash says "this moved" without
 * asking for attention the way a colour change or a slide would.
 */
export function LiveValue({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [flash, setFlash] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 640);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [value]);

  return (
    <span className={cx(className, flash && "ticked")} aria-live="polite">
      {value}
    </span>
  );
}

/**
 * Back to the parent screen.
 *
 * Exists as a component because the obvious version — a small text link — is
 * a 14px tap target, which is unusable on a phone and was the single most
 * common miss in the layout audit. The negative margin keeps it visually
 * where a text link would sit while the hit area extends to 44px.
 */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="press -ml-2 -mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ash hover:text-chalk"
    >
      <span aria-hidden>←</span>
      {children}
    </Link>
  );
}

// --- surfaces ---------------------------------------------------------

/** Title, one line of context, and the page's actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="display break-words text-[28px] leading-tight text-chalk">{title}</h1>
        {subtitle && <p className="mt-1 text-sm font-medium text-ash">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A centred dialog. Closes on Escape or a click outside. */
export function Modal({
  title,
  subtitle,
  onClose,
  closeOnEscape = true,
  closeOnBackdrop = true,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, closeOnEscape]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim/50 p-4"
      onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="settle my-8 w-full max-w-lg rounded-[var(--radius-shell)] bg-panel p-7 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-xl text-chalk">{title}</h2>
            {subtitle && <p className="text-sm text-ash">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press -mr-2 -mt-2 flex size-9 items-center justify-center rounded-lg text-ash hover:bg-raised hover:text-chalk"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Panel({
  children,
  className,
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-[var(--radius-card)] border bg-panel shadow-[var(--shadow-card)]",
        accent ? "border-signal/50" : "border-edge",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  action,
  hint,
}: {
  title: string;
  action?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-edge px-5 py-4">
      <div>
        <h2 className="display text-base text-chalk">{title}</h2>
        {hint && <p className="mt-0.5 text-xs font-medium text-ash-dim">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/** A segmented row of filters, one active at a time. */
export function FilterTabs<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  /** Names the group for screen readers. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string; count?: number }[];
}) {
  return (
    <div
      className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-edge/70 bg-panel p-1.5 shadow-[var(--shadow-card)]"
      role="tablist"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={cx(
            "press flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold",
            value === option.id
              ? "btn-solid"
              : "text-ash hover:bg-raised hover:text-chalk",
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <span
              className={cx(
                "num rounded-full px-1.5 text-xs",
                value === option.id ? "bg-ink/20 text-ink" : "bg-raised text-ash-dim",
              )}
            >
              {option.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** A short coloured label for a fact that is not a job or call status. */
export function Badge({
  tone = "quiet",
  children,
  title,
}: {
  tone?: "good" | "warn" | "bad" | "info" | "quiet";
  children: ReactNode;
  title?: string;
}) {
  const tones = {
    good: "bg-live text-live-bright",
    warn: "bg-warn-soft text-amber",
    bad: "bg-bad-soft text-rust",
    info: "bg-info-soft text-info",
    quiet: "bg-raised text-ash",
  };
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Picks an icon from what a figure's label says it counts. */
function iconFor(label: string) {
  const rules: [RegExp, typeof ChartIcon][] = [
    [/fail|reject|block|attention|error|opt/i, AlertIcon],
    [/not answered|no answer|missed/i, MissedIcon],
    [/rate|answered|valid|active|reach|publish|complete|credit/i, CheckIcon],
    [/time|ring|wait|hour|duration/i, ClockIcon],
    [/balance|spend|cost|charge/i, WalletIcon],
    [/contact|people|person|row|list/i, UsersIcon],
    [/flow|draft/i, FlowIcon],
    [/key|revok|used/i, KeyIcon],
    [/suppress|consent/i, ShieldIcon],
    [/call|dial|running|job/i, PhoneIcon],
  ];
  return rules.find(([pattern]) => pattern.test(label))?.[1] ?? ChartIcon;
}

/** A figure and what it counts, with an icon that names the subject. */
export function Stat({
  label,
  value,
  denominator,
  accent = false,
  tone,
  to,
  icon,
}: {
  label: string;
  /** Overrides the icon picked from the label. */
  icon?: typeof ChartIcon;
  value: string;
  denominator?: string;
  accent?: boolean;
  tone?: "live" | "amber" | "rust";
  /** Makes the whole card a link. */
  to?: string;
}) {
  const Icon = icon ?? iconFor(label);
  const badge = accent
    ? "btn-solid"
    : tone === "amber"
      ? "bg-warn-soft text-amber"
      : tone === "rust"
        ? "bg-bad-soft text-rust"
        : tone === "live"
          ? "bg-live text-live-bright"
          : "bg-live text-live-bright";

  const body = (
    <>
      <span className={cx("flex size-12 shrink-0 items-center justify-center rounded-lg", badge)}>
        <Icon className="size-[22px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-ash-dim">{label}</span>
        <span className="num display mt-0.5 block text-[28px] leading-none text-chalk">{value}</span>
        {denominator && (
          <span className="mt-1.5 block text-xs font-medium text-ash-dim">{denominator}</span>
        )}
      </span>
    </>
  );

  const shell = cx(
    "flex items-center gap-4 rounded-[var(--radius-card)] border border-edge bg-panel px-5 py-5 shadow-[var(--shadow-card)]",
    to && "transition-transform hover:-translate-y-0.5 hover:border-signal/40",
  );

  return to ? (
    <a href={to} className={shell}>
      {body}
    </a>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/**
 * A semicircular gauge, after the reference's progress dial.
 *
 * Used where a figure is genuinely a proportion of a known whole — dialled
 * against queued. The remainder is hatched rather than empty, so the arc
 * reads as "this much left to do" instead of "this much missing".
 */
export function Gauge({
  value,
  label,
  caption,
}: {
  /** 0–1. */
  value: number;
  label: string;
  caption?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  // Semicircle: r=52, length = πr ≈ 163.4
  const LENGTH = Math.PI * 52;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 82" className="w-full max-w-60" role="img"
           aria-label={`${label}: ${Math.round(clamped * 100)} percent`}>
        <defs>
          <pattern
            id="gauge-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--color-edge-bright)"
              strokeWidth="2"
            />
          </pattern>
        </defs>

        {/* Remainder, hatched. */}
        <path
          d="M 18 70 A 52 52 0 0 1 122 70"
          fill="none"
          stroke="url(#gauge-hatch)"
          strokeWidth="15"
          strokeLinecap="round"
        />
        {/* Done. */}
        <path
          d="M 18 70 A 52 52 0 0 1 122 70"
          fill="none"
          stroke="var(--color-live-bright)"
          strokeWidth="15"
          strokeLinecap="round"
          strokeDasharray={`${clamped * LENGTH} ${LENGTH}`}
          style={{ transition: "stroke-dasharray 600ms cubic-bezier(0.22,0.8,0.3,1)" }}
        />
      </svg>

      <div className="-mt-6 text-center">
        <div className="num text-2xl leading-none text-chalk">
          {Math.round(clamped * 100)}%
        </div>
        <div className="eyebrow mt-1.5">{label}</div>
        {caption && <div className="mt-1 text-xs text-ash">{caption}</div>}
      </div>
    </div>
  );
}

// --- controls ---------------------------------------------------------

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary:
    "btn-solid",
  secondary:
    "bg-panel text-chalk ring-1 ring-inset ring-edge-bright hover:bg-raised",
  danger: "bg-rust text-white hover:brightness-95",
  ghost: "text-ash hover:text-chalk hover:bg-raised",
};

/**
 * `dense` is for controls that sit inside a table row, where a 44px target
 * would break the row rhythm. Everything else meets 44px, and dense controls
 * keep 8px of separation so they are still comfortably hittable.
 */
export function Button({
  variant = "secondary",
  loading = false,
  dense = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  dense?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "press inline-flex items-center justify-center gap-2 rounded-lg",
        dense ? "min-h-9 px-4 text-sm" : "min-h-11 px-5 text-sm",
        "font-bold disabled:cursor-not-allowed disabled:opacity-40",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="eyebrow block">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-rust" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ash">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "w-full min-h-11 rounded-lg border bg-panel px-3.5 py-2.5 text-sm font-medium text-chalk " +
  "placeholder:text-ash-dim/70 transition-colors focus:border-signal focus:shadow-[0_0_0_3px_rgb(6_122_80/0.14)]";

export function Input({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, invalid ? "border-rust" : "border-edge", className)}
    />
  );
}

export function Textarea({
  invalid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, invalid ? "border-rust" : "border-edge", className)}
    />
  );
}

export function Select({
  invalid,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, invalid ? "border-rust" : "border-edge", className)}
    >
      {children}
    </select>
  );
}

// --- state ------------------------------------------------------------

/**
 * Status of a job or a call, as a soft coloured label with its name spelled out.
 * `throttled` looks like a warning because no calls go out while it lasts.
 */
const GOOD = "bg-live text-live-bright";
const WARN = "bg-warn-soft text-amber";
const BAD = "bg-bad-soft text-rust";
const QUIET = "bg-raised text-ash";

const STATUS: Record<string, string> = {
  running: GOOD,
  completed: GOOD,
  in_progress: GOOD,
  throttled: WARN,
  paused: WARN,
  busy: WARN,
  no_answer: WARN,
  failed: BAD,
  stopped: QUIET,
  canceled: QUIET,
  draft: QUIET,
  scheduled: "bg-info-soft text-info",
};

export function StatusPill({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
        STATUS[status] ?? QUIET,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] bg-void px-6 py-14 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-lg bg-live text-live-bright">
        <SoundIcon className="size-6" />
      </span>
      <p className="display mt-4 text-base text-chalk">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm font-medium text-ash">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * `request_id` is always shown. It is the only handle support has, and quoting
 * a short string beats asking someone to reproduce a 500.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const isNetwork = error instanceof NetworkError;
  const api = error instanceof ApiError ? error : null;

  return (
    <div
      role="alert"
      className="rounded-[var(--radius-card)] border border-rust/40 bg-panel px-4 py-3.5"
    >
      <p className="display text-sm font-semibold text-rust">
        {api?.isForbidden
          ? "Your role does not permit this"
          : isNetwork
            ? "Could not reach the server"
            : "Something went wrong"}
      </p>
      <p className="mt-1 text-sm text-chalk">
        {error instanceof Error ? error.message : String(error)}
      </p>

      {api?.fieldErrors && (
        <ul className="mt-2 space-y-0.5 text-sm text-ash">
          {Object.entries(api.fieldErrors).map(([field, messages]) => (
            <li key={field}>
              <span className="num text-xs text-chalk">{field}</span>{" "}
              {messages.join(" ")}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-4">
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs font-medium text-signal hover:underline"
          >
            Try again
          </button>
        )}
        {api?.requestId && (
          <code className="num text-[11px] text-ash-dim">
            ref {api.requestId}
          </code>
        )}
      </div>
    </div>
  );
}

/** Rows of muted bars while a table loads — keeps the layout from jumping. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-edge">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3 w-1/4 rounded bg-edge" />
          <div className="h-3 w-16 rounded bg-edge" />
          <div className="ml-auto h-3 w-20 rounded bg-edge" />
        </div>
      ))}
    </div>
  );
}
