/**
 * How each node type and each connection kind looks.
 *
 * Which types exist still comes from `GET flows/node-types/`; this only gives
 * them icons, with a plain dot for new ones. Types are shown by their own names.
 */

import type { ReactNode } from "react";

import type { EdgeKind } from "../utils/graph";

const ICONS: Record<string, ReactNode> = {
  play: <path d="M8 5.5v13l10-6.5-10-6.5Z" />,
  menu: <path d="M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M12 18h.01" strokeWidth="3" />,
  collect: <path d="M9 4 7 20M17 4l-2 16M5 9h15M4 15h15" />,
  transfer: <path d="M4 8h14l-4-4M20 16H6l4 4" />,
  opt_out: <><circle cx="12" cy="12" r="8" /><path d="m6.5 6.5 11 11" /></>,
  voicemail: <><circle cx="7" cy="12" r="3.5" /><circle cx="17" cy="12" r="3.5" /><path d="M7 15.500h10" /></>,
  record: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" /></>,
  branch: <path d="M4 12h5l6-6h5M9 12l6 6h5" />,
  hangup: <path d="M7 7l10 10M17 7 7 17" />,
};

export function NodeIcon({ type, className = "size-4" }: { type: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} pointer-events-none shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[type] ?? <circle cx="12" cy="12" r="5" />}
    </svg>
  );
}

/** Wire and port colours, dark enough to read on the light canvas. */
export const KIND_COLORS: Record<EdgeKind, string> = {
  next: "#067a50",
  dtmf: "#1d5fa8",
  optout: "#96590a",
  timeout: "#b4530a",
  invalid: "#b83a33",
  fail: "#b83a33",
  condition: "#7c4dbb",
  default: "#067a50",
};

export const DANGLING_COLOR = "#b83a33";
