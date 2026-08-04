/**
 * Primitives.
 *
 * Deliberately small — no component library. The portal needs about eight
 * shapes and every one of them is here.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import { ApiError, NetworkError } from "@/lib/errors";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// --- button -----------------------------------------------------------

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/40",
  secondary:
    "bg-surface text-ink border border-line hover:bg-canvas disabled:opacity-50",
  danger:
    "bg-stop-600 text-white hover:brightness-95 disabled:bg-stop-600/40",
  ghost: "text-muted hover:text-ink hover:bg-canvas disabled:opacity-50",
};

export function Button({
  variant = "secondary",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5",
        "text-sm font-medium transition-colors disabled:cursor-not-allowed",
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

// --- field ------------------------------------------------------------

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
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-stop-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={cx(
        "w-full rounded-md border bg-surface px-3 py-2 text-sm",
        "placeholder:text-muted/70",
        invalid ? "border-stop-600" : "border-line",
        className,
      )}
    />
  );
}

// --- status -----------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  running: "bg-live-50 text-live-600 border-live-600/25",
  throttled: "bg-warn-50 text-warn-600 border-warn-600/25",
  paused: "bg-warn-50 text-warn-600 border-warn-600/25",
  failed: "bg-stop-50 text-stop-600 border-stop-600/25",
  stopped: "bg-stop-50 text-stop-600 border-stop-600/25",
  completed: "bg-brand-50 text-brand-700 border-brand-600/20",
  draft: "bg-canvas text-muted border-line",
  scheduled: "bg-brand-50 text-brand-700 border-brand-600/20",
};

/**
 * `throttled` reads as a warning, not a success. The pacer only fans out for
 * `running`, so a throttled campaign places no calls at all — the label says
 * "stopped dialling" elsewhere in the UI, never "slower".
 */
export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5",
        "text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-canvas text-muted border-line",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// --- states -----------------------------------------------------------

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
    <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted" role="status">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-muted/40 border-t-muted"
      />
      {label}…
    </div>
  );
}

/**
 * Error display.
 *
 * `request_id` is always surfaced — it is the only handle support has, and
 * asking a user to reproduce a 500 is worse than showing them a short string
 * to quote.
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
      className="rounded-lg border border-stop-600/25 bg-stop-50 px-4 py-3"
    >
      <p className="text-sm font-medium text-stop-600">
        {api?.isForbidden
          ? "Your role does not permit this"
          : isNetwork
            ? "Could not reach the server"
            : "Something went wrong"}
      </p>
      <p className="mt-1 text-sm text-ink">
        {error instanceof Error ? error.message : String(error)}
      </p>

      {api?.fieldErrors && (
        <ul className="mt-2 space-y-0.5 text-sm text-ink">
          {Object.entries(api.fieldErrors).map(([field, messages]) => (
            <li key={field}>
              <span className="font-medium">{field}</span>: {messages.join(" ")}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            Try again
          </button>
        )}
        {api?.requestId && (
          <code className="text-xs text-muted">ref {api.requestId}</code>
        )}
      </div>
    </div>
  );
}
