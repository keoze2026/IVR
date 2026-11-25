/** Jobs: what is being called, from which number, and its controls. */

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { PauseIcon, PlayIcon, PlusIcon, StopIcon, TrashIcon } from "@/components/icons";
import { Button, EmptyState, ErrorState, Input, PageHeader, Panel, Stat, StatusPill, TableSkeleton, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCampaigns, useDeleteJob, useJobAction } from "@/lib/queries/campaigns";
import type { Campaign } from "@/types/domain";

import { CreateJobModal } from "./CreateJobModal";

export function JobsPage() {
  // Refetched on an interval so a running job's status moves on its own.
  const { data, isLoading, error, refetch } = useCampaigns({}, { refetchInterval: 4000 });
  const action = useJobAction();
  const del = useDeleteJob();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const all = data?.results ?? [];
  const term = search.trim().toLowerCase();
  const jobs = term
    ? all.filter((j) => `${j.name} ${j.target_number}`.toLowerCase().includes(term))
    : all;
  const failure = action.error ?? del.error;
  const count = (status: string) => all.filter((j) => j.status === status).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        subtitle="Each job calls one or more numbers and plays your message."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon className="size-4" /> New job
          </Button>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {failure && (
        <p role="alert" className="rounded-xl bg-[#fdeaea] px-4 py-3 text-sm text-rust">
          {failure.message || "That action could not be completed."}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total jobs" value={String(all.length)} accent />
        <Stat label="Running" value={String(count("running"))} tone="live" />
        <Stat label="Completed" value={String(count("completed"))} tone="live" />
        <Stat label="Failed" value={String(count("failed"))} tone="rust" />
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or number"
        aria-label="Search jobs"
        className="max-w-sm"
      />

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={5} />}
        {!isLoading && jobs.length === 0 && (
          <div className="p-6">
            <EmptyState title="No jobs" description="Create a job to start calling." />
          </div>
        )}
        {jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Calling</th>
                  <th>From</th>
                  <th>At once</th>
                  <th>Status</th>
                  <th>Created</th>
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
  const canStart = ["draft", "scheduled", "paused"].includes(job.status);
  const canPause = job.status === "running";
  const canStop = ["running", "paused", "scheduled", "throttled"].includes(job.status);

  return (
    <tr>
      <td>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-forest text-sm font-extrabold uppercase text-mint">
            {job.name.slice(0, 1)}
          </span>
          <Link to={`/campaigns/${job.id}`} className="font-bold text-chalk hover:text-signal">
            {job.name}
          </Link>
        </div>
      </td>
      <td className="num">{job.target_number || "Contact list"}</td>
      <td className="num">{job.cli_pool_name || job.caller_id_detail?.phone_e164 || "—"}</td>
      <td className="num">
        {job.max_concurrent_channels}
        {job.dial_mode && job.dial_mode !== "fixed" && (
          <span className="ml-1.5 text-xs capitalize text-ash-dim">{job.dial_mode}</span>
        )}
      </td>
      <td title={job.pause_reason || undefined}><StatusPill status={job.status} /></td>
      <td>{formatDateTime(job.scheduled_start ?? job.created_at)}</td>
      <td>
        <div className="flex justify-end gap-1">
          {canStart && (
            <Action label="Start" disabled={busy} onClick={() => onAction("start")}><PlayIcon className="size-4" /></Action>
          )}
          {canPause && (
            <Action label="Pause" disabled={busy} onClick={() => onAction("pause")}><PauseIcon className="size-4" /></Action>
          )}
          {canStop && (
            <Action label="Stop" disabled={busy} onClick={() => onAction("stop")}><StopIcon className="size-4" /></Action>
          )}
          <Action label="Delete" danger onClick={onDelete}><TrashIcon className="size-4" /></Action>
        </div>
      </td>
    </tr>
  );
}

function Action({
  label,
  children,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cx(
        "press flex size-10 items-center justify-center rounded-full bg-panel text-ash ring-1 ring-inset ring-edge disabled:opacity-40",
        danger ? "hover:bg-[#fdeaea] hover:text-rust" : "hover:bg-live hover:text-signal",
      )}
    >
      {children}
    </button>
  );
}
