/**
 * Display helpers.
 *
 * Phone masking matters here: the dashboard is the most-shared screen in the
 * building and ends up on projectors and in screenshots. The API already
 * returns masked variants (`to_masked`, `phone_masked`); this covers the
 * places where only the raw value is available.
 */

export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  if (e164.length <= 6) return e164;
  return `${e164.slice(0, 5)}${"*".repeat(Math.max(0, e164.length - 7))}${e164.slice(-2)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat().format(value);
}

/** Rates arrive as 0..1 floats rounded to 4dp. */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const deltaSeconds = Math.round((then - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.35],
    ["month", 12],
    ["year", Number.POSITIVE_INFINITY],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let value = deltaSeconds;
  for (const [unit, step] of units) {
    if (Math.abs(value) < step) return formatter.format(Math.round(value), unit);
    value /= step;
  }
  return formatDateTime(iso);
}

/**
 * Cost is eventually consistent — Twilio back-fills `Price` minutes after the
 * call. Never present an unreconciled figure as final; it is always low.
 */
export function formatCost(
  amount: string | null | undefined,
  currency = "USD",
  reconciled = true,
): string {
  if (amount === null || amount === undefined) return "—";
  const value = Number(amount);
  if (Number.isNaN(value)) return "—";
  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  }).format(value);
  return reconciled ? formatted : `${formatted} (provisional)`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Backend uses Mon=0. */
export function formatWeekdays(days: number[] | null | undefined): string {
  if (!days || days.length === 0) return "Every day";
  if (days.length === 7) return "Every day";
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAYS[d] ?? String(d))
    .join(", ");
}

/** "09:00:00" → "09:00" */
export function formatLocalTime(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 5);
}
