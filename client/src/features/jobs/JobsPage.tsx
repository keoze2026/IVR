/**
 * Jobs / All Jobs: a Create Job button, four stat tiles (Total / Running /
 * Completed / Failed), then the job table with a status control per row.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PhoneOutIcon, TrashIcon } from "@/components/icons";
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, Panel, Stat, TableSkeleton, cx } from "@/components/ui";
import { useCampaigns, useDeleteJob, useJobAction } from "@/lib/queries/campaigns";
import type { Campaign } from "@/types/domain";

import { CreateJobModal } from "./CreateJobModal";

export function JobsPage() {
  // Refetched on an interval so a running job's status moves on its own.
  // The server returns 25 jobs in no set order unless asked for more, which
  // hides new jobs. Ask for its maximum and list the newest first.
  const { data, isLoading, error, refetch } = useCampaigns(
    { page_size: 200 },
    { refetchInterval: 4000 },
  );
  const action = useJobAction();
  const del = useDeleteJob();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const all = useMemo(
    () => [...(data?.results ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data],
  );
  const jobs = useMemo(() => {
    const f = search.trim().toLowerCase();
    return f ? all.filter((j) => j.name.toLowerCase().includes(f)) : all;
  }, [all, search]);
  const failure = action.error ?? del.error;
  const count = (status: string) => all.filter((j) => j.status === status).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Create Job +
          </Button>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {failure && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-rust">
          {failure.message || "That action could not be completed."}
        </p>
      )}

      <div className="stat-grid grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Total Jobs" value={String(all.length)} denominator="All jobs" accent />
        <Stat label="Running" value={String(count("running"))} denominator="% of all jobs" tone="live" />
        <Stat label="Completed" value={String(count("completed"))} denominator="% of all jobs" tone="live" />
        <Stat label="Failed" value={String(count("failed"))} denominator="% of all jobs" tone="rust" />
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter by name..."
        aria-label="Filter by name"
        className="max-w-sm"
      />

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={5} />}
        {!isLoading && jobs.length === 0 && (
          <div className="p-6">
            <EmptyState title="No jobs yet" description="Create a job to dial a number." />
          </div>
        )}
        {jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>User</th>
                  <th>Target Number</th>
                  <th>Max Concurrency</th>
                  <th>Concurrency Mode</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>Audio Pool</th>
                  <th>CLI Pool</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    busy={action.isPending && action.variables?.id === job.id}
                    onAction={(a) => action.mutate({ id: job.id, action: a })}
                    onDelete={() => {
                      if (confirm(`Delete job "${job.name}"? This cannot be undone.`)) {
                        del.mutate(job.id);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating && <CreateJobModal onClose={() => setCreating(false)} />}
    </div>
  );
}

const MODE_TONE = { fixed: "quiet", pulse: "good", ramp: "warn" } as const;

const STATUS_TONE: Record<string, string> = {
  running: "bg-good-soft text-good",
  completed: "bg-raised text-ash",
  paused: "bg-warn-soft text-amber",
  throttled: "bg-warn-soft text-amber",
  draft: "bg-raised text-ash",
  failed: "bg-bad-soft text-rust",
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
    <tr>
      <td>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-live text-live-bright">
            <PhoneOutIcon className="size-[18px]" />
          </span>
          <Link to={`/campaigns/${job.id}`} className="font-bold text-chalk hover:text-signal">
            {job.name}
          </Link>
        </div>
      </td>
      <td>{job.user || "—"}</td>
      <td className="num">{job.target_number || "—"}</td>
      <td className="num">{job.max_concurrent_channels}</td>
      <td>
        <Badge tone={MODE_TONE[mode]}>
          <span className="capitalize">{mode}</span>
        </Badge>
      </td>
      <td className="num">
        {mode === "fixed"
          ? "—"
          : `Interval: ${job.dial_interval_seconds}s · Step: ${job.dial_batch_size}`}
      </td>
      <td>
        {/* Status is a control: pick an action to run it. The current status is
            the shown value; only valid transitions are offered, and the whole
            control disables while the action is in flight so a second click
            cannot race. */}
        <select
          value=""
          disabled={busy}
          aria-label={`Status of ${job.name}`}
          onChange={(e) => {
            const v = e.target.value;
            if (v) onAction(v as "start" | "pause" | "stop");
          }}
          className={cx(
            "min-h-9 rounded-full border border-edge px-3 text-xs font-bold capitalize disabled:opacity-40",
            STATUS_TONE[job.status] ?? "bg-raised text-chalk",
          )}
        >
          <option value="">{busy ? "Working…" : job.status}</option>
          {canStart && <option value="start">▶ Start</option>}
          {canPause && <option value="pause">⏸ Pause</option>}
          {canStop && <option value="stop">⏹ Stop</option>}
        </select>
      </td>
      <td>{job.scheduled_start ? new Date(job.scheduled_start).toLocaleString() : "—"}</td>
      <td>{job.audio_pool_name || "—"}</td>
      <td>{job.cli_pool_name || "—"}</td>
      <td>
        <div className="flex justify-end gap-1">
          <Link
            to={`/campaigns/${job.id}`}
            className="press flex size-10 items-center justify-center rounded-lg bg-panel text-ash ring-1 ring-inset ring-edge hover:bg-live hover:text-signal"
          >
            ⋯
          </Link>
          <button
            type="button"
            onClick={onDelete}
            title="Delete job"
            aria-label="Delete job"
            className="press flex size-10 items-center justify-center rounded-lg bg-panel text-ash ring-1 ring-inset ring-edge hover:bg-bad-soft hover:text-rust"
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
