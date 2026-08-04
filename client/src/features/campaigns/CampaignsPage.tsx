/**
 * Campaign list.
 *
 * Filters are exactly the three the backend supports — `status`, `caller_id`,
 * `flow_version`. There is deliberately no search box and no sortable column:
 * `?search=` does not exist and `?ordering=` is silently ignored on every
 * viewset but calling-windows (docs/API-GAPS.md G-10). A control that looks
 * like it works and does nothing is worse than no control.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { Button, EmptyState, ErrorState, Spinner, StatusPill } from "@/components/ui";
import { formatCount, formatRate, formatRelative } from "@/lib/format";
import { useCampaigns, type CampaignFilters } from "@/lib/queries/campaigns";
import { useCan } from "@/lib/session";
import type { Campaign, CampaignStatus } from "@/types/domain";

const STATUSES: (CampaignStatus | "")[] = [
  "",
  "draft",
  "running",
  "paused",
  "throttled",
  "completed",
  "stopped",
  "failed",
];

export function CampaignsPage() {
  const [filters, setFilters] = useState<CampaignFilters>({ page: 1 });
  const canEdit = useCan("campaign.edit");
  const { data, isLoading, error, refetch } = useCampaigns(filters);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Campaigns</h1>
          {data && (
            <p className="mt-0.5 text-sm text-muted">
              {formatCount(data.count)} total
            </p>
          )}
        </div>
        {canEdit && (
          <Link
            to="/campaigns/new"
            className="inline-flex items-center rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            New campaign
          </Link>
        )}
      </div>

      <div className="flex items-center gap-2">
        {STATUSES.map((status) => {
          const active = (filters.status ?? "") === status;
          return (
            <button
              key={status || "all"}
              onClick={() => setFilters({ ...filters, status, page: 1 })}
              className={
                active
                  ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted hover:text-ink"
              }
            >
              {status === "" ? "All" : status}
            </button>
          );
        })}
      </div>

      {isLoading && <Spinner label="Loading campaigns" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && data.results.length === 0 && (
        <EmptyState
          title={filters.status ? `No ${filters.status} campaigns` : "No campaigns yet"}
          description={
            filters.status
              ? "Try a different status filter."
              : "A campaign pins a published flow, a verified caller ID and one or more contact lists."
          }
          action={
            canEdit && !filters.status ? (
              <Link
                to="/campaigns/new"
                className="inline-flex items-center rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                Create the first one
              </Link>
            ) : undefined
          }
        />
      )}

      {data && data.results.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr className="text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Campaign</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Flow</th>
                  <th className="px-4 py-2.5 text-right">Dialed</th>
                  <th className="px-4 py-2.5 text-right">Answer rate</th>
                  <th className="px-4 py-2.5 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.results.map((campaign) => (
                  <CampaignRow key={campaign.id} campaign={campaign} />
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            hasPrevious={Boolean(data.previous)}
            hasNext={Boolean(data.next)}
            page={filters.page ?? 1}
            onChange={(page) => setFilters({ ...filters, page })}
          />
        </>
      )}
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  // `queue_built_at` null means the campaign has never started, so `stats`
  // counters are zero-but-meaningless rather than zero-because-nothing-dialed.
  const started = campaign.queue_built_at !== null;
  const stats = campaign.stats;

  return (
    <tr className="hover:bg-canvas">
      <td className="px-4 py-3">
        <Link
          to={`/campaigns/${campaign.id}`}
          className="font-medium text-ink hover:text-brand-700"
        >
          {campaign.name}
        </Link>
        {campaign.status === "throttled" && campaign.pause_reason && (
          <p className="mt-0.5 text-xs text-warn-600">
            Stopped dialling — {campaign.pause_reason}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={campaign.status} />
      </td>
      <td className="px-4 py-3 text-muted">
        {campaign.flow_name}
        <span className="ml-1 text-xs">v{campaign.flow_version_number}</span>
      </td>
      <td className="tnum px-4 py-3 text-right text-ink">
        {started ? formatCount(stats?.dialed ?? 0) : "—"}
      </td>
      <td className="tnum px-4 py-3 text-right text-ink">
        {started && stats ? formatRate(stats.answer_rate) : "—"}
      </td>
      <td className="px-4 py-3 text-right text-muted">
        {formatRelative(campaign.updated_at)}
      </td>
    </tr>
  );
}

function Pagination({
  page,
  hasNext,
  hasPrevious,
  onChange,
}: {
  page: number;
  hasNext: boolean;
  hasPrevious: boolean;
  onChange: (page: number) => void;
}) {
  if (!hasNext && !hasPrevious) return null;
  return (
    <div className="flex items-center justify-between">
      <Button disabled={!hasPrevious} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-muted">Page {page}</span>
      <Button disabled={!hasNext} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </div>
  );
}
