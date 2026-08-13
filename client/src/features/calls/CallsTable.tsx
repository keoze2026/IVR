/**
 * The call log.
 *
 * Cursor-paginated, so there is no total and no page number — only next and
 * previous, and the cursors are opaque (G-11). There is also no date filter
 * (G-09), which is the single most-missed control here: at the documented
 * load this table cannot be narrowed to "yesterday afternoon". The header says
 * so rather than pretending otherwise.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  StatusPill,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { formatCost, formatDuration, formatRelative } from "@/lib/format";
import { useCalls, type CallFilters } from "@/lib/queries/resources";
import type { CallSummary } from "@/types/domain";

const DISPOSITIONS = [
  "",
  "confirmed",
  "transferred",
  "opted_out",
  "voicemail",
  "no_input",
  "abandoned",
  "unreachable",
];

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
        <div className="flex flex-wrap items-center gap-1.5">
          {DISPOSITIONS.map((d) => {
            const active = (filters.disposition ?? "") === d;
            return (
              <button
                key={d || "any"}
                onClick={() =>
                  setFilters({ ...filters, disposition: d, cursor: undefined })
                }
                className={cx(
                  "press min-h-9 rounded-full border px-3.5 font-mono text-[11px] uppercase tracking-wider",
                  active
                    ? "border-signal bg-signal text-void"
                    : "border-edge bg-panel text-ash hover:border-edge-bright hover:text-chalk",
                )}
              >
                {d ? d.replace(/_/g, " ") : "Any outcome"}
              </button>
            );
          })}
        </div>
      )}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton />}

        {data && rows.length === 0 && (
          <EmptyState
            title="No calls here yet"
            description={
              filters.disposition
                ? "Nothing with that outcome."
                : "Calls appear as soon as the campaign starts dialing."
            }
          />
        )}

        {rows.length > 0 && (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-edge bg-void text-left">
                  {["To", "State", "Outcome", "Answered by", "Duration", "Cost", "When"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={cx(
                          "eyebrow px-4 py-2.5 font-normal",
                          i >= 4 && "text-right",
                        )}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {rows.map((call) => (
                  <CallRow key={call.id} call={call} />
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-edge md:hidden">
              {rows.map((call) => (
                <MobileCallRow key={call.id} call={call} />
              ))}
            </ul>
          </>
        )}
      </Panel>

      {data && (data.next || data.previous) && (
        <div className="flex items-center justify-between">
          <Button
            disabled={!data.previous}
            onClick={() =>
              setFilters({ ...filters, cursor: cursorOf(data.previous) })
            }
          >
            Newer
          </Button>
          {/* No count — cursor pagination omits it, so no "page 3 of 40". */}
          <span className="text-xs text-ash-dim">
            Showing the most recent calls
          </span>
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

function MobileCallRow({ call }: { call: CallSummary }) {
  const machine = call.answered_by.startsWith("machine");

  return (
    <li>
      <Link
        to={`/calls/${call.id}`}
        className="press block px-4 py-3.5 active:bg-raised"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="num text-sm text-chalk">{call.to_masked}</span>
          <StatusPill status={call.status} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {call.disposition && (
            <span
              className={cx(
                call.disposition === "opted_out"
                  ? "text-amber"
                  : call.disposition === "confirmed" ||
                      call.disposition === "transferred"
                    ? "text-live-bright"
                    : "text-ash",
              )}
            >
              {call.disposition.replace(/_/g, " ")}
            </span>
          )}
          {call.answered_by && (
            <span className="text-ash">{machine ? "machine" : "person"}</span>
          )}
          {call.duration_seconds > 0 && (
            <span className="num text-ash">
              {formatDuration(call.duration_seconds)}
            </span>
          )}
          {call.attempt_number > 1 && (
            <span className="num text-ash-dim">attempt {call.attempt_number}</span>
          )}
          <span className="ml-auto text-ash-dim">
            {formatRelative(call.created_at)}
          </span>
        </div>
      </Link>
    </li>
  );
}

function CallRow({ call }: { call: CallSummary }) {
  const machine = call.answered_by.startsWith("machine");

  return (
    <tr className="group transition-colors hover:bg-raised">
      <td className="px-4 py-2.5">
        <Link
          to={`/calls/${call.id}`}
          className="num text-chalk transition-colors group-hover:text-signal"
        >
          {call.to_masked}
        </Link>
        {call.attempt_number > 1 && (
          <span className="num ml-2 text-[10px] text-ash-dim">
            attempt {call.attempt_number}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <StatusPill status={call.status} />
      </td>
      <td className="px-4 py-2.5">
        {call.disposition ? (
          <span
            className={cx(
              "text-xs",
              call.disposition === "opted_out"
                ? "text-amber"
                : call.disposition === "confirmed" ||
                    call.disposition === "transferred"
                  ? "text-live-bright"
                  : "text-ash",
            )}
          >
            {call.disposition.replace(/_/g, " ")}
          </span>
        ) : (
          <span className="text-ash-dim">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className={cx("text-xs", machine ? "text-ash" : "text-chalk")}>
          {call.answered_by ? (machine ? "machine" : call.answered_by) : "—"}
        </span>
      </td>
      <td className="num px-4 py-2.5 text-right text-chalk">
        {call.duration_seconds > 0 ? formatDuration(call.duration_seconds) : "—"}
      </td>
      <td className="num px-4 py-2.5 text-right text-ash">
        {call.cost ? formatCost(call.cost) : "—"}
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-ash">
        {formatRelative(call.created_at)}
      </td>
    </tr>
  );
}
