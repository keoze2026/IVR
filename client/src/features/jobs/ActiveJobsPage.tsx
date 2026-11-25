/**
 * Jobs / Active Jobs: the live view.
 *
 * The same job table as All Jobs, filtered to what is running, with a Live
 * Calls column and a "Connected" badge. It refetches on an interval so the
 * live counts move without a reload.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge, EmptyState, Input, PageHeader, Panel, StatusPill, TableSkeleton } from "@/components/ui";
import { useCampaigns } from "@/lib/queries/campaigns";
import type { Campaign } from "@/types/domain";

/** Calls still in flight = dialed minus everything that has finished. */
function liveCalls(job: Campaign): number {
  const s = job.stats;
  if (!s) return 0;
  const finished = (s.answered ?? 0) + (s.failed ?? 0) + (s.busy ?? 0) + (s.no_answer ?? 0);
  return Math.max(0, (s.dialed ?? 0) - finished);
}

export function ActiveJobsPage() {
  const { data, isLoading } = useCampaigns(
    {},
    // Live view: poll fast so live-call counts move on their own, even in the
    // background, and never serve a stale cached page here.
    { refetchInterval: 2000, refetchIntervalInBackground: true, staleTime: 0 },
  );
  const [filter, setFilter] = useState("");

  const active = useMemo(() => {
    const running = (data?.results ?? []).filter(
      (j) => j.status === "running" || j.status === "throttled",
    );
    const f = filter.trim().toLowerCase();
    return f ? running.filter((j) => j.name.toLowerCase().includes(f)) : running;
  }, [data, filter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Active Jobs"
        actions={
          <Badge tone="good">
            <span className="mr-1.5 size-1.5 rounded-full bg-current" aria-hidden />
            Connected
          </Badge>
        }
      />

      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name..."
        aria-label="Filter by name"
        className="max-w-sm"
      />

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={4} />}
        {!isLoading && active.length === 0 && (
          <div className="p-6">
            <EmptyState title="No results." description="No jobs are running right now." />
          </div>
        )}
        {active.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>User</th>
                  <th>Target Number</th>
                  <th>Live Calls</th>
                  <th>Max Concurrency</th>
                  <th>Concurrency Mode</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>Audio Pool</th>
                  <th>CLI Pool</th>
                </tr>
              </thead>
              <tbody>
                {active.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link to={`/campaigns/${j.id}`} className="font-bold text-chalk hover:text-signal">
                        {j.name}
                      </Link>
                    </td>
                    <td>{j.user || "—"}</td>
                    <td className="num">{j.target_number || "—"}</td>
                    <td>
                      <span className="num inline-flex items-center gap-1.5 font-bold text-live-bright">
                        <span className="size-1.5 rounded-full bg-current" aria-hidden />
                        {liveCalls(j)} / {j.max_concurrent_channels}
                      </span>
                    </td>
                    <td className="num">{j.max_concurrent_channels}</td>
                    <td className="capitalize">{j.dial_mode ?? "fixed"}</td>
                    <td className="num">
                      {j.dial_mode && j.dial_mode !== "fixed"
                        ? `Interval: ${j.dial_interval_seconds}s · Step: ${j.dial_batch_size}`
                        : "—"}
                    </td>
                    <td><StatusPill status={j.status} /></td>
                    <td>{j.scheduled_start ? new Date(j.scheduled_start).toLocaleString() : "—"}</td>
                    <td>{j.audio_pool_name || "—"}</td>
                    <td>{j.cli_pool_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
