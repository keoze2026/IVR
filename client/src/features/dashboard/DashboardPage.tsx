/**
 * Dashboard and CDR.
 *
 * The reference's landing screen: how many calls, how many answered, how many
 * did not connect, and the money spent. Computed from the recent call records
 * rather than a separate analytics store — the numbers are only ever as true
 * as the calls behind them, and reading them from the same place keeps them
 * honest.
 */

import { Link } from "react-router-dom";

import { Panel, TableSkeleton, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCalls } from "@/lib/queries/resources";
import type { CallSummary } from "@/types/domain";

const ANSWERED = new Set(["in_progress", "completed"]);

export function DashboardPage() {
  const { data, isLoading } = useCalls({});
  const calls = data?.results ?? [];

  const total = calls.length;
  const answered = calls.filter((c) => ANSWERED.has(c.status) || c.answered_by).length;
  const nonConnected = total - answered;
  const spend = calls.reduce((sum, c) => sum + Number(c.cost ?? 0), 0);

  const cards = [
    ["Total calls", total, "text-chalk"],
    ["Answered calls", answered, "text-live-bright"],
    ["Non-connected", nonConnected, "text-amber"],
    ["Spend", `$${spend.toFixed(2)}`, "text-chalk"],
  ] as const;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-ash">Your most recent call activity.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([k, v, tone]) => (
          <Panel key={k} className="p-5">
            <p className="text-xs uppercase tracking-wider text-ash">{k}</p>
            <p className={`mt-1 text-3xl tabular-nums ${tone}`}>{isLoading ? "—" : v}</p>
          </Panel>
        ))}
      </div>

      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-base font-semibold text-chalk">Recent calls</h2>
          <Link to="/cdr" className="text-sm text-live-bright hover:underline">
            See all
          </Link>
        </div>
        {isLoading && <TableSkeleton rows={4} />}
        {!isLoading && calls.length === 0 && (
          <EmptyState title="No calls yet" description="Start a job to place calls." />
        )}
        {calls.length > 0 && <CallsTable rows={calls.slice(0, 10)} />}
      </Panel>
    </div>
  );
}

export function CdrPage() {
  const { data, isLoading } = useCalls({});
  const calls = data?.results ?? [];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">
          Call records
        </h1>
        <p className="mt-1 text-sm text-ash">Every call placed, most recent first.</p>
      </header>
      <Panel>
        {isLoading && <TableSkeleton rows={6} />}
        {!isLoading && calls.length === 0 && (
          <EmptyState title="No calls yet" description="Start a job to place calls." />
        )}
        {calls.length > 0 && <CallsTable rows={calls} />}
      </Panel>
    </div>
  );
}

function CallsTable({ rows }: { rows: CallSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-steel text-left text-xs uppercase tracking-wider text-ash">
            <th className="py-2 pr-4">To</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Answered by</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">Cost</th>
            <th className="py-2 pr-4">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-steel/50">
              <td className="py-2 pr-4 font-mono text-ash">{c.to_masked}</td>
              <td className="py-2 pr-4 capitalize text-chalk">{c.status.replace("_", " ")}</td>
              <td className="py-2 pr-4 text-ash">{c.answered_by || "—"}</td>
              <td className="py-2 pr-4 tabular-nums text-ash">{c.duration_seconds}s</td>
              <td className="py-2 pr-4 tabular-nums text-ash">
                {c.cost ? `$${Number(c.cost).toFixed(4)}` : "—"}
              </td>
              <td className="py-2 pr-4 text-ash">{formatDateTime(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
