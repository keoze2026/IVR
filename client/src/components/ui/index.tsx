/**
 * Console primitives.
 *
 * Deliberately small. The palette does the work: chrome is near-monochrome,
 * and colour is spent only where it carries state.
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
      className="press -ml-2 -mt-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm text-ash hover:text-chalk"
    >
      <span aria-hidden>←</span>
      {children}
    </Link>
  );
}

// --- surfaces ---------------------------------------------------------

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
        "rounded-[--radius-card] border",
        accent
          ? "border-signal/30 bg-panel"
          : "border-edge bg-panel",
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
    <div className="flex items-start justify-between gap-4 border-b border-edge px-4 py-3">
      <div>
        <h2 className="display text-sm font-semibold text-chalk">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ash">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * A figure and what it counts.
 *
 * Anatomy borrowed from the reference dashboard: label top-left, a circular
 * affordance top-right when the figure leads somewhere, the number large
 * enough to read across a desk, and a context line at the base.
 *
 * `denominator` is not decoration — the API's rates use different bases
 * (`answer` over dialed, `transfer` over answered), and a tile that does not
 * say which produces numbers people quietly distrust.
 *
 * The filled variant is used exactly once per row, on the figure the screen
 * exists to show. Two filled cards and neither reads as primary.
 */
export function Stat({
  label,
  value,
  denominator,
  accent = false,
  tone,
  to,
}: {
  label: string;
  value: string;
  denominator?: string;
  accent?: boolean;
  tone?: "live" | "amber" | "rust";
  /** Makes the whole card a link and shows the corner affordance. */
  to?: string;
}) {
  const valueColor = accent
    ? "text-signal"
    : tone === "live"
      ? "text-live-bright"
      : tone === "amber"
        ? "text-amber"
        : tone === "rust"
          ? "text-rust"
          : "text-chalk";

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="eyebrow pt-1">{label}</span>
        {to && (
          <span
            aria-hidden
            className={cx(
              "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
              accent
                ? "border-signal/40 text-signal group-hover:bg-signal group-hover:text-void"
                : "border-edge-bright text-ash group-hover:border-signal group-hover:text-signal",
            )}
          >
            <ArrowUpRight />
          </span>
        )}
      </div>

      <div className={cx("num mt-3 text-3xl leading-none", valueColor)}>
        {value}
      </div>

      {denominator && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-ash-dim">
          <span
            aria-hidden
            className={cx(
              "size-1.5 rounded-full",
              accent ? "bg-panel0" : "bg-edge-bright",
            )}
          />
          {denominator}
        </div>
      )}
    </>
  );

  const shell = cx(
    "block rounded-[--radius-card] border px-4 py-4 transition-colors",
    accent
      ? "border-signal/30 bg-panel"
      : "border-edge bg-panel",
    to && "group hover:border-edge-bright",
  );

  return to ? (
    <a href={to} className={shell}>
      {body}
    </a>
  ) : (
    <div className={shell}>{body}</div>
  );
}

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
      <path
        d="M5 11L11 5M11 5H6M11 5V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
  primary: "bg-signal text-void hover:bg-[#c9ff63]",
  secondary:
    "bg-raised text-chalk ring-1 ring-inset ring-edge-bright hover:bg-edge",
  danger: "bg-rust text-white hover:bg-[#f05a5f]",
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
        "press inline-flex items-center justify-center gap-2 rounded-md",
        dense ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-sm",
        "font-medium disabled:cursor-not-allowed disabled:opacity-40",
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
  "w-full min-h-11 rounded-md border bg-void px-3 py-2 text-sm text-chalk " +
  "placeholder:text-ash-dim transition-colors focus:border-edge-bright";

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
 * Campaign status.
 *
 * `running` is the only state that gets the live green — it is the only one
 * where calls are actually going out. `throttled` looks like a warning because
 * it is one: the pacer fans out for RUNNING only, so a throttled campaign
 * places no calls at all.
 */
const STATUS: Record<string, { className: string; label?: string }> = {
  running: { className: "border-live-bright/40 bg-live text-live-bright" },
  throttled: {
    className: "border-amber/40 bg-panel text-amber",
    label: "throttled",
  },
  paused: { className: "border-amber/30 bg-panel text-amber" },
  failed: { className: "border-rust/40 bg-panel text-rust" },
  stopped: { className: "border-rust/25 bg-panel text-rust" },
  completed: { className: "border-edge-bright bg-raised text-ash" },
  draft: { className: "border-edge bg-void text-ash-dim" },
  scheduled: { className: "border-signal/30 bg-panel text-signal-dim" },
};

export function StatusPill({ status }: { status: string }) {
  const style = STATUS[status] ?? { className: "border-edge bg-void text-ash" };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5",
        "font-mono text-[10px] uppercase tracking-widest",
        style.className,
      )}
    >
      {status === "running" && (
        <span className="size-1.5 rounded-full bg-live-bright" aria-hidden />
      )}
      {style.label ?? status.replace(/_/g, " ")}
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
    <div className="rounded-[--radius-card] border border-dashed border-edge bg-panel px-6 py-14 text-center">
      <p className="display text-sm font-semibold text-chalk">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ash">{description}</p>
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
      className="rounded-[--radius-card] border border-rust/40 bg-panel px-4 py-3.5"
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
