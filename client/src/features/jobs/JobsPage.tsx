/**
 * Jobs / All Jobs — matched to the reference dialer screen.
 *
 * Breadcrumb, a Create Job button, four stat tiles (Total / Running /
 * Completed / Failed), then a table with the reference's exact columns:
 * Name, User, Target Number, Max Concurrency, Concurrency Mode, Details
 * (Interval/Step), Status (a control dropdown), Scheduled, Audio Pool,
 * CLI Pool, and a per-row actions menu.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button, EmptyState, Panel, TableSkeleton } from "@/components/ui";
import { useCampaigns, useDeleteJob, useJobAction } from "@/lib/queries/campaigns";
import type { Campaign } from "@/types/domain";

import { CreateJobModal } from "./CreateJobModal";

const input =
  "w-full rounded border border-edge bg-void px-3 py-2 text-sm text-chalk placeholder:text-ash/50 focus:border-live-bright focus:outline-none";

const MODE_BADGE: Record<string, string> = {
  fixed: "border-edge text-ash",
  pulse: "border-live-bright/40 text-live-bright",
  ramp: "border-amber/40 text-amber",
};

export function JobsPage() {
  // Jobs list refetches on an interval so a status change or a running job's
  // progress shows without a manual reload.
  const { data, isLoading } = useCampaigns({}, { refetchInterval: 4000 });
  const action = useJobAction();
  const del = useDeleteJob();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  const all = data?.results ?? [];
  const jobs = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? all.filter((j) => j.name.toLowerCase().includes(f)) : all;
  }, [all, filter]);

  const total = all.length;
  const running = all.filter((j) => j.status === "running").length;
  const completed = all.filter((j) => j.status === "completed").length;
  const failed = all.filter((j) => j.status === "failed").length;

  return (
    <div className="space-y-5">
      <p className="text-xs text-ash">
        Home <span className="mx-1">›</span>
        <span className="text-chalk">Jobs</span>
      </p>

      <div className="flex items-center justify-between">
        <h1 className="display text-2xl font-semibold text-chalk">Jobs</h1>
        <Button type="button" onClick={() => setCreating(true)}>
          Create Job +
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Total Jobs", total, "All jobs", "text-chalk"],
          ["Running", running, "% of all jobs", "text-live-bright"],
          ["Completed", completed, "% of all jobs", "text-ash"],
          ["Failed", failed, "% of all jobs", "text-rust"],
        ].map(([label, value, sub, tone]) => (
          <Panel key={label as string} className="p-4">
            <p className="text-xs uppercase tracking-wider text-ash">{label}</p>
            <p className={`mt-1 text-3xl tabular-nums ${tone}`}>{value}</p>
            <p className="mt-1 text-xs text-ash">{sub}</p>
          </Panel>
        ))}
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name..."
        className={`${input} max-w-sm`}
      />

      {/* A failed status change is no longer silent — the reason shows here. */}
      {(action.error || del.error) && (
        <div className="rounded border border-rust/40 bg-panel px-4 py-3 text-sm text-rust">
          {(action.error ?? del.error)?.message || "That action could not be completed."}
        </div>
      )}

      <Panel className="p-0">
        {isLoading && <div className="p-4"><TableSkeleton rows={5} /></div>}
        {!isLoading && jobs.length === 0 && (
          <div className="p-8">
            <EmptyState title="No jobs yet" description="Create a job to dial a number." />
          </div>
        )}
        {jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-3 pl-4 pr-4">Name</th>
                  <th className="py-3 pr-4">User</th>
                  <th className="py-3 pr-4">Target Number</th>
                  <th className="py-3 pr-4">Max Concurrency</th>
                  <th className="py-3 pr-4">Concurrency Mode</th>
                  <th className="py-3 pr-4">Details</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Scheduled</th>
                  <th className="py-3 pr-4">Audio Pool</th>
                  <th className="py-3 pr-4">CLI Pool</th>
                  <th className="py-3 pr-4" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    busy={action.isPending && action.variables?.id === j.id}
                    onAction={(a) => action.mutate({ id: j.id, action: a })}
                    onDelete={() => {
                      if (confirm(`Delete job "${j.name}"? This cannot be undone.`)) {
                        del.mutate(j.id);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-edge px-4 py-3 text-xs text-ash">
          <span>{jobs.length} row(s) total.</span>
        </div>
      </Panel>

      {creating && <CreateJobModal onClose={() => setCreating(false)} />}
    </div>
  );
}

const STATUS_TONE_ROW: Record<string, string> = {
  running: "text-live-bright",
  completed: "text-ash",
  paused: "text-amber",
  draft: "text-ash",
  failed: "text-rust",
};

function JobRow({
  job,
  busy,
  onAction,
  onDelete,
}: {
  job: Campaign;
  busy: boolean;
  onAction: (a: "start" | "pause" | "stop") => void;
  onDelete: () => void;
}) {
  const mode = job.dial_mode ?? "fixed";
  const canStart = ["draft", "scheduled", "paused"].includes(job.status);
  const canPause = job.status === "running";
  const canStop = ["running", "paused", "scheduled"].includes(job.status);
  return (
    <tr className="border-b border-edge/50 hover:bg-raised">
      <td className="py-3 pl-4 pr-4">
        <Link to={`/campaigns/${job.id}`} className="text-live-bright hover:underline">
          {job.name}
        </Link>
      </td>
      <td className="py-3 pr-4 text-ash">{job.user || "—"}</td>
      <td className="py-3 pr-4 font-mono text-ash">{job.target_number || "—"}</td>
      <td className="py-3 pr-4 tabular-nums text-ash">{job.max_concurrent_channels}</td>
      <td className="py-3 pr-4">
        <span className={`rounded border px-2 py-0.5 text-xs capitalize ${MODE_BADGE[mode]}`}>
          {mode}
        </span>
      </td>
      <td className="py-3 pr-4 text-xs text-ash">
        {mode === "fixed"
          ? "—"
          : `Interval: ${job.dial_interval_seconds}s · Step: ${job.dial_batch_size}`}
      </td>
      <td className="py-3 pr-4">
        {/* Status is a control, as in the reference: pick an action to run it.
            The current status is the shown value; only valid transitions are
            offered, and the whole control disables while the action is in
            flight so a second click cannot race. */}
        <select
          value=""
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value;
            if (v) onAction(v as "start" | "pause" | "stop");
          }}
          className={`rounded border border-edge bg-void px-2 py-1 text-xs capitalize ${STATUS_TONE_ROW[job.status] ?? "text-chalk"}`}
        >
          <option value="">{busy ? "Working…" : job.status}</option>
          {canStart && <option value="start">▶ Start</option>}
          {canPause && <option value="pause">⏸ Pause</option>}
          {canStop && <option value="stop">⏹ Stop</option>}
        </select>
      </td>
      <td className="py-3 pr-4 text-ash">
        {job.scheduled_start ? new Date(job.scheduled_start).toLocaleString() : "—"}
      </td>
      <td className="py-3 pr-4 text-ash">{job.audio_pool_name || "—"}</td>
      <td className="py-3 pr-4 text-ash">{job.cli_pool_name || "—"}</td>
      <td className="py-3 pr-4 text-right">
        <Link to={`/campaigns/${job.id}`} className="px-2 text-ash hover:text-chalk">
          ⋯
        </Link>
        <button
          type="button"
          onClick={onDelete}
          className="px-2 text-ash hover:text-rust"
          title="Delete job"
          aria-label="Delete job"
        >
          🗑
        </button>
      </td>
    </tr>
  );
}

