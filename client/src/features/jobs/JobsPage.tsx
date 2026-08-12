/**
 * Jobs — the dialer's home screen, in the reference's own terms.
 *
 * A job is a dial run: a target, a pace, a status. It maps onto the campaign
 * engine underneath, but nothing on this screen says "campaign" — the word
 * does not appear in the product this mirrors.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { Button, EmptyState, Panel, TableSkeleton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCampaigns } from "@/lib/queries/campaigns";

import { CreateJobModal } from "./CreateJobModal";

const STATUS_TONE: Record<string, string> = {
  running: "border-live-bright/40 text-live-bright",
  completed: "border-steel text-ash",
  paused: "border-amber/40 text-amber",
  draft: "border-steel text-ash",
  failed: "border-rust/40 text-rust",
};

export function JobsPage() {
  const { data, isLoading } = useCampaigns();
  const [creating, setCreating] = useState(false);
  const jobs = data?.results ?? [];

  const running = jobs.filter((j) => j.status === "running").length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Jobs</h1>
          <p className="mt-1 text-sm text-ash">Dial a number with a sound.</p>
        </div>
        <Button type="button" onClick={() => setCreating(true)}>
          Create job
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total jobs", jobs.length, "text-chalk"],
          ["Running", running, "text-live-bright"],
          ["Completed", completed, "text-ash"],
          ["Failed", failed, "text-rust"],
        ].map(([k, v, tone]) => (
          <Panel key={k as string} className="p-4">
            <p className="text-xs uppercase tracking-wider text-ash">{k}</p>
            <p className={`mt-1 text-2xl tabular-nums ${tone}`}>{v}</p>
          </Panel>
        ))}
      </div>

      <Panel>
        {isLoading && <TableSkeleton rows={4} />}
        {!isLoading && jobs.length === 0 && (
          <EmptyState
            title="No jobs yet"
            description="Create a job to dial a number."
          />
        )}
        {jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-steel text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Max concurrency</th>
                  <th className="py-2 pr-4">Mode</th>
                  <th className="py-2 pr-4">Details</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b border-steel/50">
                    <td className="py-2 pr-4 text-chalk">{j.name}</td>
                    <td className="py-2 pr-4 tabular-nums text-ash">
                      {j.max_concurrent_channels}
                    </td>
                    <td className="py-2 pr-4 capitalize text-ash">{j.dial_mode ?? "fixed"}</td>
                    <td className="py-2 pr-4 text-xs text-ash">
                      {j.dial_mode && j.dial_mode !== "fixed"
                        ? `Interval ${j.dial_interval_seconds}s · Step ${j.dial_batch_size}`
                        : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded border px-2 py-0.5 text-xs capitalize ${
                          STATUS_TONE[j.status] ?? "border-steel text-ash"
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-ash">{formatDateTime(j.created_at)}</td>
                    <td className="py-2 text-right">
                      <Link to={`/campaigns/${j.id}`} className="text-live-bright hover:underline">
                        Open
                      </Link>
                    </td>
                  </tr>
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
