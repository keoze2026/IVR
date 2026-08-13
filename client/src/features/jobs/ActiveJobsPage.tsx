/**
 * Jobs / Active Jobs — the reference's live view.
 *
 * The same job table as All Jobs, filtered to what is running, with a Live
 * Calls column and a "Connected" badge. It refetches on an interval so the
 * live counts move without a reload.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState, Panel, TableSkeleton } from "@/components/ui";
import { useCampaigns } from "@/lib/queries/campaigns";

const input =
  "w-full rounded border border-edge bg-void px-3 py-2 text-sm text-chalk placeholder:text-ash/50 focus:border-live-bright focus:outline-none";

/** Calls still in flight = dialed minus everything that has finished. */
function liveCalls(j: { stats: { dialed: number; answered: number; failed: number; busy: number; no_answer: number } | null }): number {
  const s = j.stats;
  if (!s) return 0;
  const finished = (s.answered ?? 0) + (s.failed ?? 0) + (s.busy ?? 0) + (s.no_answer ?? 0);
  return Math.max(0, (s.dialed ?? 0) - finished);
}

export function ActiveJobsPage() {
  const { data, isLoading, isFetching } = useCampaigns(
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
    <div className="space-y-5">
      <p className="text-xs text-ash">
        Home <span className="mx-1">›</span> Jobs <span className="mx-1">›</span>
        <span className="text-chalk">Active Jobs</span>
      </p>

      <div className="flex items-center gap-3">
        <h1 className="display text-2xl font-semibold text-chalk">Active Jobs</h1>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
            isFetching
              ? "border-live-bright/40 text-live-bright"
              : "border-live-bright/40 text-live-bright"
          }`}
        >
          <span className="size-1.5 rounded-full bg-live-bright" />
          Connected
        </span>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name..."
        className={`${input} max-w-sm`}
      />

      <Panel className="p-0">
        {isLoading && <div className="p-4"><TableSkeleton rows={4} /></div>}
        {!isLoading && active.length === 0 && (
          <div className="p-8">
            <EmptyState title="No results." description="No jobs are running right now." />
          </div>
        )}
        {active.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-3 pl-4 pr-4">Name</th>
                  <th className="py-3 pr-4">User</th>
                  <th className="py-3 pr-4">Target Number</th>
                  <th className="py-3 pr-4">Live Calls</th>
                  <th className="py-3 pr-4">Max Concurrency</th>
                  <th className="py-3 pr-4">Concurrency Mode</th>
                  <th className="py-3 pr-4">Details</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Scheduled</th>
                  <th className="py-3 pr-4">Audio Pool</th>
                  <th className="py-3 pr-4">CLI Pool</th>
                </tr>
              </thead>
              <tbody>
                {active.map((j) => (
                  <tr key={j.id} className="border-b border-edge/50 hover:bg-raised">
                    <td className="py-3 pl-4 pr-4">
                      <Link to={`/campaigns/${j.id}`} className="text-live-bright hover:underline">
                        {j.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-ash">{j.user || "—"}</td>
                    <td className="py-3 pr-4 font-mono text-ash">{j.target_number || "—"}</td>
                    <td className="py-3 pr-4">
                      {/* Live calls: still in flight = dialed minus everything
                          that reached a terminal state. A green dot marks it
                          live, like the reference. */}
                      <span className="inline-flex items-center gap-1.5 tabular-nums text-live-bright">
                        <span className="size-1.5 rounded-full bg-live-bright" />
                        {liveCalls(j)} / {j.max_concurrent_channels}
                      </span>
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-ash">{j.max_concurrent_channels}</td>
                    <td className="py-3 pr-4 capitalize text-ash">{j.dial_mode ?? "fixed"}</td>
                    <td className="py-3 pr-4 text-xs text-ash">
                      {j.dial_mode && j.dial_mode !== "fixed"
                        ? `Interval: ${j.dial_interval_seconds}s · Step: ${j.dial_batch_size}`
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 capitalize text-chalk">{j.status}</td>
                    <td className="py-3 pr-4 text-ash">
                      {j.scheduled_start ? new Date(j.scheduled_start).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 pr-4 text-ash">{j.audio_pool_name || "—"}</td>
                    <td className="py-3 pr-4 text-ash">{j.cli_pool_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-edge px-4 py-3 text-xs text-ash">
          <span>{active.length} row(s) total.</span>
        </div>
      </Panel>
    </div>
  );
}
