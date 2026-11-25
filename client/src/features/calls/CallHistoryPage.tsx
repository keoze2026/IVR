/**
 * Call history: every recent call, filtered by how it ended.
 *
 * Counts describe the calls loaded on this page, and the page says so rather
 * than presenting them as all-time totals.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState, ErrorState, FilterTabs, PageHeader, Panel, StatusPill, TableSkeleton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCalls } from "@/lib/queries/resources";

import { RecordingButton, answeredByLabel, clock, outcomeOf, tally, type Outcome } from "./shared";

type Filter = "all" | Outcome;

export function CdrPage() {
  const { data, isLoading, error, refetch } = useCalls({}, { refetchInterval: 5000 });
  const calls = data?.results ?? [];
  const t = tally(calls);
  const [filter, setFilter] = useState<Filter>("all");
  const rows = filter === "all" ? calls : calls.filter((c) => outcomeOf(c) === filter);

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: t.total },
    { id: "answered", label: "Answered", count: t.answered },
    { id: "missed", label: "Not answered", count: t.missed },
    { id: "failed", label: "Failed", count: t.failed },
    { id: "active", label: "In progress", count: t.active },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call history"
        subtitle={`Your latest ${t.total} calls, refreshed automatically.`}
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <FilterTabs label="Filter calls" value={filter} onChange={setFilter} options={tabs} />

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={6} />}
        {!isLoading && rows.length === 0 && (
          <div className="p-6">
            <EmptyState title="No calls to show" description="Calls appear here as soon as a job places them." />
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Status</th>
                  <th>Answered by</th>
                  <th>Duration</th>
                  <th>Cost</th>
                  <th>When</th>
                  <th>Recording</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/calls/${c.id}`} className="num font-medium text-chalk hover:text-signal">
                        {c.to_masked}
                      </Link>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td>{answeredByLabel(c.answered_by)}</td>
                    <td className="num">{clock(c.duration_seconds ?? 0)}</td>
                    <td className="num">{c.cost ? `$${Number(c.cost).toFixed(4)}` : "—"}</td>
                    <td>{formatDateTime(c.created_at)}</td>
                    <td><RecordingButton call={c} /></td>
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
