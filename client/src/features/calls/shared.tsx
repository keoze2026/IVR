/** Pieces shared by the dashboard and the call history. */

import { useState } from "react";

import { PlayIcon, SoundIcon } from "@/components/icons";
import type { CallSummary } from "@/types/domain";

const ANSWERED = new Set(["in_progress", "completed"]);

export function isAnswered(call: CallSummary): boolean {
  return ANSWERED.has(call.status) || Boolean(call.answered_by);
}

/** The one definition of the call counts, so every screen counts alike. */
export function tallies(calls: CallSummary[]) {
  const total = calls.length;
  const answered = calls.filter(isAnswered).length;
  const failed = calls.filter((c) => c.status === "failed").length;
  const nonConnected = total - answered;
  const spend = calls.reduce((s, c) => s + Number(c.cost ?? 0), 0);
  const durationSec = calls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0);
  return { total, answered, failed, nonConnected, spend, durationSec };
}

export function minutes(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * The recording control.
 *
 * Active only when the call actually has a recording: a button that looks
 * clickable but does nothing is worse than one that is plainly disabled. The
 * short-lived signed link is fetched only when asked for.
 */
export function RecordingButton({ call }: { call: CallSummary }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!call.has_recording) {
    return (
      <span className="text-ash-dim opacity-50" title="No recording for this call">
        <SoundIcon className="size-4" />
      </span>
    );
  }
  if (url) return <audio src={url} controls autoPlay className="h-8 w-44" />;

  return (
    <button
      type="button"
      disabled={loading}
      title="Play recording"
      aria-label="Play recording"
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
      className={`press inline-flex size-9 items-center justify-center rounded-lg bg-panel ring-1 ring-inset ring-edge-bright hover:bg-live ${failed ? "text-rust" : "text-signal"}`}
    >
      {loading ? "…" : <PlayIcon className="size-3.5" />}
    </button>
  );
}
