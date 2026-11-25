/**
 * CDR: four summary tiles and the call-record table with a recording control.
 *
 * The numbers come from the recent call records, so they are only ever as true
 * as the calls behind them.
 */

import { PhoneOutIcon } from "@/components/icons";
import { EmptyState, ErrorState, PageHeader, Panel, Stat, StatusPill, TableSkeleton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCalls } from "@/lib/queries/resources";

import { RecordingButton, minutes, tallies } from "./shared";

export function CdrPage() {
  const { data, isLoading, error, refetch } = useCalls({});
  const calls = data?.results ?? [];
  const t = tallies(calls);
  const pct = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0);
  const show = (n: number) => (isLoading ? "—" : String(n));

  return (
    <div className="space-y-6">
      <PageHeader title="CDR" />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total Calls" value={show(t.total)} denominator="All CDR entries" accent />
        <Stat label="Answered" value={show(t.answered)} denominator={`${pct(t.answered)}% of all calls`} tone="live" />
        <Stat label="Failed" value={show(t.failed)} denominator={`${pct(t.failed)}% of all calls`} tone="rust" />
        <Stat label="Total Duration" value={minutes(t.durationSec)} denominator="billable" />
      </div>

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={6} />}
        {!isLoading && calls.length === 0 && (
          <div className="p-6">
            <EmptyState title="No calls yet" description="Start a job to place calls." />
          </div>
        )}
        {calls.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Billable</th>
                  <th>Recording</th>
                  <th>Cost</th>
                  <th>Originated At</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-live text-live-bright">
                          <PhoneOutIcon className="size-[18px]" />
                        </span>
                        <span className="num font-bold text-chalk">{c.to_masked}</span>
                      </div>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td className="num">{c.duration_seconds}s</td>
                    <td className="num">{c.billable_seconds ?? c.duration_seconds}s</td>
                    <td><RecordingButton call={c} /></td>
                    <td className="num">${Number(c.cost ?? 0).toFixed(4)}</td>
                    <td>{formatDateTime(c.created_at)}</td>
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
