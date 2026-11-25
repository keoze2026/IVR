/**
 * The call log.
 *
 * Cursor-paginated, so there is no total and no page number — only newer and
 * older, and the cursors are opaque (G-11). There is no date filter (G-09).
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FilterTabs,
  Panel,
  StatusPill,
  TableSkeleton,
} from "@/components/ui";
import { formatCost, formatDuration, formatRelative } from "@/lib/format";
import { useCalls, type CallFilters } from "@/lib/queries/resources";
import type { CallSummary } from "@/types/domain";

import { answeredByLabel } from "./shared";

const DISPOSITIONS = [
  "",
  "confirmed",
  "transferred",
  "opted_out",
  "voicemail",
  "no_input",
  "abandoned",
  "unreachable",
].map((id) => ({ id, label: id ? sentence(id) : "Any outcome" }));

function sentence(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the person on the call chose, or how the flow ended for them. */
export function DispositionBadge({ value }: { value: string }) {
  const tone =
    value === "opted_out"
      ? "warn"
      : value === "confirmed" || value === "transferred"
        ? "good"
        : "quiet";
  return <Badge tone={tone}>{sentence(value)}</Badge>;
}

export function CallsTable({
  campaignId,
  compact = false,
}: {
  campaignId?: string;
  compact?: boolean;
}) {
  const [filters, setFilters] = useState<CallFilters>(
    campaignId ? { campaign: campaignId } : {},
  );
  const { data, isLoading, error, refetch } = useCalls(filters);

  const rows = data?.results ?? [];

  return (
    <div className="space-y-4">
      {!compact && (
        <FilterTabs
          label="Filter by outcome"
          value={filters.disposition ?? ""}
          onChange={(disposition) =>
            setFilters({ ...filters, disposition, cursor: undefined })
          }
          options={DISPOSITIONS}
        />
      )}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {(isLoading || data) && (
        <Panel className="overflow-hidden">
          {isLoading && <TableSkeleton />}

          {data && rows.length === 0 && (
            <div className="p-4 sm:p-6">
              <EmptyState
                title="No calls here yet"
                description={
                  filters.disposition
                    ? "Nothing with that outcome."
                    : "Calls appear as soon as the campaign starts dialing."
                }
              />
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Status</th>
                    <th>Outcome</th>
                    <th>Answered by</th>
                    <th>Duration</th>
                    <th>Cost</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((call) => (
                    <CallRow key={call.id} call={call} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {data && (data.next || data.previous) && (
        <div className="flex items-center justify-between gap-3">
          <Button
            disabled={!data.previous}
            onClick={() =>
              setFilters({ ...filters, cursor: cursorOf(data.previous) })
            }
          >
            Newer
          </Button>
          <Button
            disabled={!data.next}
            onClick={() => setFilters({ ...filters, cursor: cursorOf(data.next) })}
          >
            Older
          </Button>
        </div>
      )}
    </div>
  );
}

function cursorOf(url: string | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, window.location.origin).searchParams.get("cursor") ?? undefined;
  } catch {
    return undefined;
  }
}

function CallRow({ call }: { call: CallSummary }) {
  return (
    <tr>
      <td>
        <Link
          to={`/calls/${call.id}`}
          className="num inline-flex min-h-9 items-center font-medium text-chalk hover:text-signal"
        >
          {call.to_masked}
        </Link>
        {call.attempt_number > 1 && (
          <span className="num ml-2 text-xs text-ash-dim">
            attempt {call.attempt_number}
          </span>
        )}
      </td>
      <td>
        <StatusPill status={call.status} />
      </td>
      <td>
        {call.disposition ? <DispositionBadge value={call.disposition} /> : "—"}
      </td>
      <td>{answeredByLabel(call.answered_by)}</td>
      <td className="num">
        {call.duration_seconds > 0 ? formatDuration(call.duration_seconds) : "—"}
      </td>
      <td className="num">{call.cost ? formatCost(call.cost) : "—"}</td>
      <td>{formatRelative(call.created_at)}</td>
    </tr>
  );
}
