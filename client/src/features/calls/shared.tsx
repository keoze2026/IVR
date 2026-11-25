/** Pieces shared by the dashboard and the call history. */

import { useState } from "react";

import { PlayIcon } from "@/components/icons";
import type { CallSummary } from "@/types/domain";

export type Outcome = "answered" | "failed" | "missed" | "active";

/** The one definition of how a call ended, so every screen counts alike. */
export function outcomeOf(call: CallSummary): Outcome {
  if (call.status === "failed") return "failed";
  if (["queued", "initiated", "ringing"].includes(call.status)) return "active";
  if (["in_progress", "completed"].includes(call.status) || call.answered_by) {
    return "answered";
  }
  return "missed";
}

export function tally(calls: CallSummary[]) {
  const count = { answered: 0, failed: 0, missed: 0, active: 0 };
  let seconds = 0;
  let spend = 0;
  for (const call of calls) {
    count[outcomeOf(call)] += 1;
    seconds += call.duration_seconds ?? 0;
    spend += Number(call.cost ?? 0);
  }
  return {
    ...count,
    total: calls.length,
    spend,
    seconds,
    average: count.answered ? Math.round(seconds / count.answered) : 0,
  };
}

/** Carriers report several machine variants; people only need which it was. */
export function answeredByLabel(value: string): string {
  if (!value) return "—";
  if (value.startsWith("machine")) return "Voicemail";
  if (value === "human") return "Person";
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Plays a call's recording. The signed link is fetched only when asked for, and
 * the control is absent when there is nothing to play.
 */
export function RecordingButton({ call }: { call: CallSummary }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!call.has_recording) return <span className="text-ash-dim">—</span>;
  if (url) return <audio src={url} controls autoPlay className="h-8 w-48" />;

  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        setFailed(false);
        try {
          const res = await fetch(`/bff/api/calls/${call.id}/recording/`, {
            credentials: "same-origin",
          });
          if (!res.ok) throw new Error();
          setUrl(((await res.json()) as { url: string }).url);
        } catch {
          setFailed(true);
        } finally {
          setLoading(false);
        }
      }}
      className="press inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-signal ring-1 ring-inset ring-edge-bright hover:bg-live"
    >
      <PlayIcon className="size-3.5" />
      {loading ? "Loading…" : failed ? "Retry" : "Play"}
    </button>
  );
}
