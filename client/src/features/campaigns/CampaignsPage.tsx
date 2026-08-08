/**
 * Campaign list.
 *
 * Filters are exactly the three the backend supports. There is deliberately no
 * search box and no sortable column: `?search=` does not exist and
 * `?ordering=` is silently ignored on nine of ten viewsets (G-10). A control
 * that looks like it works and does nothing is worse than no control.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { ClipButton } from "@/components/styled/ClipButton";
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  Stat,
  StatusPill,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { formatCount, formatRate, formatRelative } from "@/lib/format";
import { useCampaigns, type CampaignFilters } from "@/lib/queries/campaigns";
import { useCan } from "@/lib/session";
import type { Campaign, CampaignStatus } from "@/types/domain";

const FILTERS: { value: CampaignStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "running", label: "Dialing" },
  { value: "throttled", label: "Throttled" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Draft" },
  { value: "completed", label: "Completed" },
  { value: "stopped", label: "Stopped" },
];

export function CampaignsPage() {
  const [filters, setFilters] = useState<CampaignFilters>({ page: 1 });
  const canEdit = useCan("campaign.edit");
  const { data, isLoading, error, refetch } = useCampaigns(filters);

  const rows = data?.results ?? [];
  const dialing = rows.filter((c) => c.status === "running").length;
  const attention = rows.filter(
    (c) => c.status === "throttled" || c.status === "failed",
  ).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Campaigns</h1>
          <p className="mt-1 text-sm text-ash">
            A campaign pins one published flow, one caller ID, and the lists it
            may dial.
          </p>
        </div>
        {canEdit && (
          <Link to="/campaigns/new">
            <ClipButton>New campaign</ClipButton>
          </Link>
        )}
      </header>

      {data && rows.length > 0 && (
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* One filled card per row, on the figure the screen exists for. */}
          <Stat
            label="Dialing now"
            value={String(dialing)}
            denominator={`of ${data.count} campaigns`}
            accent
            to="/campaigns?status=running"
          />
          <Stat
            label="Needs attention"
            value={String(attention)}
            denominator="throttled or failed"
            tone={attention > 0 ? "amber" : undefined}
            to="/campaigns?status=throttled"
          />
          <Stat
            label="Calls placed"
            value={formatCount(
              rows.reduce((sum, c) => sum + (c.stats?.dialed ?? 0), 0),
            )}
            denominator="across these campaigns"
            to="/calls"
          />
          <Stat
            label="Answered"
            value={formatCount(
              rows.reduce((sum, c) => sum + (c.stats?.answered ?? 0), 0),
            )}
            denominator="across these campaigns"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = (filters.status ?? "") === f.value;
          return (
            <button
              key={f.value || "all"}
              onClick={() => setFilters({ ...filters, status: f.value, page: 1 })}
              className={cx(
                "press min-h-9 rounded-full border px-3.5 font-mono text-[11px] uppercase tracking-wider",
                active
                  ? "border-signal bg-signal text-void"
                  : "border-edge bg-panel text-ash hover:border-edge-bright hover:text-chalk",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton />}

        {data && rows.length === 0 && (
          <EmptyState
            title={
              filters.status
                ? `Nothing ${FILTERS.find((f) => f.value === filters.status)?.label.toLowerCase()}`
                : "No campaigns yet"
            }
            description={
              filters.status
                ? "Try another filter."
                : "You will need a published flow, a verified caller ID, and at least one contact list."
            }
            action={
              canEdit && !filters.status ? (
                <Link to="/campaigns/new">
                  <ClipButton>Create the first one</ClipButton>
                </Link>
              ) : undefined
            }
          />
        )}

        {/* A seven-column table on a phone means sideways scrolling, so below
            `md` each row becomes a card carrying the same facts. */}
        {rows.length > 0 && (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-edge bg-void/40 text-left">
                  {["Campaign", "State", "Flow", "Dialed", "Answer", "Updated"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={cx(
                          "eyebrow px-4 py-2.5 font-normal",
                          i >= 3 && "text-right",
                        )}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {rows.map((campaign) => (
                  <Row key={campaign.id} campaign={campaign} />
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-edge md:hidden">
              {rows.map((campaign) => (
                <MobileRow key={campaign.id} campaign={campaign} />
              ))}
            </ul>
          </>
        )}
      </Panel>

      {data && (data.next || data.previous) && (
        <div className="flex items-center justify-between">
          <Button
            disabled={!data.previous}
            onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) - 1 })}
          >
            Previous
          </Button>
          <span className="num text-xs text-ash">
            page {filters.page ?? 1} · {formatCount(data.count)} total
          </span>
          <Button
            disabled={!data.next}
            onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) + 1 })}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The same row, stacked.
 *
 * Whole card is the tap target — a 44px link inside a list row is a smaller
 * target than the row itself, and people aim at the row.
 */
function MobileRow({ campaign }: { campaign: Campaign }) {
  const started = campaign.queue_built_at !== null;
  const stats = campaign.stats;

  return (
    <li>
      <Link
        to={`/campaigns/${campaign.id}`}
        className="press block px-4 py-3.5 active:bg-raised/60"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="display font-medium text-chalk">{campaign.name}</span>
          <StatusPill status={campaign.status} />
        </div>

        <div className="mt-1 text-xs text-ash">
          {campaign.flow_name}
          <span className="num ml-1.5 text-ash-dim">
            v{campaign.flow_version_number}
          </span>
        </div>

        {campaign.status === "throttled" && campaign.pause_reason && (
          <p className="mt-2 text-xs text-amber">
            Stopped dialing — {campaign.pause_reason}
          </p>
        )}

        <dl className="mt-3 flex items-baseline gap-5 text-xs">
          <div>
            <dt className="eyebrow">Dialed</dt>
            <dd className="num mt-0.5 text-sm text-chalk">
              {started ? formatCount(stats?.dialed ?? 0) : "—"}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Answer</dt>
            <dd className="num mt-0.5 text-sm text-chalk">
              {started && stats ? formatRate(stats.answer_rate) : "—"}
            </dd>
          </div>
          <div className="ml-auto text-right">
            <dt className="eyebrow">Updated</dt>
            <dd className="mt-0.5 text-sm text-ash">
              {formatRelative(campaign.updated_at)}
            </dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}

function Row({ campaign }: { campaign: Campaign }) {
  // queue_built_at null means the campaign has never started, so the counters
  // are zero-because-unbuilt rather than zero-because-nothing-answered. Showing
  // 0% answer rate on a campaign that has not dialed is a lie of omission.
  const started = campaign.queue_built_at !== null;
  const stats = campaign.stats;

  return (
    <tr className="group transition-colors hover:bg-raised/50">
      <td className="px-4 py-3">
        <Link
          to={`/campaigns/${campaign.id}`}
          className="display font-medium text-chalk transition-colors group-hover:text-signal"
        >
          {campaign.name}
        </Link>
        {campaign.status === "throttled" && campaign.pause_reason && (
          <p className="mt-1 max-w-md truncate text-xs text-amber">
            Stopped dialing — {campaign.pause_reason}
          </p>
        )}
        {campaign.status === "paused" && campaign.pause_reason && (
          <p className="mt-1 max-w-md truncate text-xs text-ash">
            {campaign.pause_reason}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={campaign.status} />
      </td>
      <td className="px-4 py-3 text-ash">
        <span className="text-chalk">{campaign.flow_name}</span>
        <span className="num ml-1.5 text-xs text-ash-dim">
          v{campaign.flow_version_number}
        </span>
      </td>
      <td className="num px-4 py-3 text-right text-chalk">
        {started ? formatCount(stats?.dialed ?? 0) : "—"}
      </td>
      <td className="num px-4 py-3 text-right">
        {started && stats ? (
          <span className={stats.answer_rate > 0.08 ? "text-chalk" : "text-amber"}>
            {formatRate(stats.answer_rate)}
          </span>
        ) : (
          <span className="text-ash-dim">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right text-xs text-ash">
        {formatRelative(campaign.updated_at)}
      </td>
    </tr>
  );
}
