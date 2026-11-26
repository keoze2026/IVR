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

import { PlusIcon } from "@/components/icons";
import {
  Button,
  EmptyState,
  ErrorState,
  FilterTabs,
  PageHeader,
  Panel,
  Stat,
  StatusPill,
  TableSkeleton,
} from "@/components/ui";
import { formatCount, formatRate, formatRelative } from "@/lib/format";
import { useCampaigns, type CampaignFilters } from "@/lib/queries/campaigns";
import { useCan } from "@/lib/session";
import type { Campaign, CampaignStatus } from "@/types/domain";

const FILTERS: { id: CampaignStatus | ""; label: string }[] = [
  { id: "", label: "All" },
  { id: "running", label: "Dialing" },
  { id: "throttled", label: "Throttled" },
  { id: "paused", label: "Paused" },
  { id: "draft", label: "Draft" },
  { id: "completed", label: "Completed" },
  { id: "stopped", label: "Stopped" },
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

  const newCampaign = (label: string) => (
    <Link
      to="/campaigns/new"
      className="press inline-flex min-h-11 items-center gap-2 rounded-lg btn-solid px-5 text-sm font-bold"
    >
      <PlusIcon className="size-4" /> {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        subtitle="A campaign pins one published flow, one caller ID, and the lists it may dial."
        actions={canEdit ? newCampaign("New campaign") : undefined}
      />

      {data && rows.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <FilterTabs
        label="Filter campaigns by status"
        value={filters.status ?? ""}
        onChange={(status) => setFilters({ ...filters, status, page: 1 })}
        options={FILTERS}
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton />}

        {data && rows.length === 0 && (
          <div className="p-6">
            <EmptyState
              title={
                filters.status
                  ? `Nothing ${FILTERS.find((f) => f.id === filters.status)?.label.toLowerCase()}`
                  : "No campaigns yet"
              }
              description={
                filters.status
                  ? "Try another filter."
                  : "You will need a published flow, a verified caller ID, and at least one contact list."
              }
              action={
                canEdit && !filters.status
                  ? newCampaign("Create the first one")
                  : undefined
              }
            />
          </div>
        )}

        {/* A six-column table on a phone means sideways scrolling, so below
            `md` each row becomes a card carrying the same facts. */}
        {rows.length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>State</th>
                    <th>Flow</th>
                    <th>Dialed</th>
                    <th>Answer</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((campaign) => (
                    <Row key={campaign.id} campaign={campaign} />
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-edge md:hidden">
              {rows.map((campaign) => (
                <MobileRow key={campaign.id} campaign={campaign} />
              ))}
            </ul>
          </>
        )}
      </Panel>

      {data && (data.next || data.previous) && (
        <div className="flex items-center justify-between gap-3">
          <Button
            disabled={!data.previous}
            onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) - 1 })}
          >
            Previous
          </Button>
          <span className="num text-center text-xs text-ash">
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

/** Why a throttled or paused campaign is not calling, if the server says. */
function reasonFor(campaign: Campaign): { text: string; tone: string } | null {
  if (!campaign.pause_reason) return null;
  if (campaign.status === "throttled") {
    return {
      text: `Stopped dialing — ${campaign.pause_reason}`,
      tone: "text-amber",
    };
  }
  if (campaign.status === "paused") {
    return { text: campaign.pause_reason, tone: "text-ash-dim" };
  }
  return null;
}

/**
 * Figures for a campaign that has run. `queue_built_at` null means it never
 * started, so its counters are zero because nothing was queued; showing a 0%
 * answer rate there would mislead.
 */
function figuresFor(campaign: Campaign) {
  const started = campaign.queue_built_at !== null;
  const stats = campaign.stats;
  return {
    dialed: started ? formatCount(stats?.dialed ?? 0) : "—",
    rate: started && stats ? formatRate(stats.answer_rate) : "—",
    low: Boolean(started && stats && stats.answer_rate <= 0.08),
  };
}

/** The same row, stacked. The whole card is the tap target. */
function MobileRow({ campaign }: { campaign: Campaign }) {
  const figures = figuresFor(campaign);
  // On the stacked card only a throttled campaign states its reason.
  const reason = campaign.status === "throttled" ? reasonFor(campaign) : null;

  return (
    <li>
      <Link
        to={`/campaigns/${campaign.id}`}
        className="press block px-4 py-4 active:bg-raised"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 font-medium text-chalk [overflow-wrap:anywhere]">
            {campaign.name}
          </span>
          <StatusPill status={campaign.status} />
        </div>

        <div className="mt-1 text-xs text-ash-dim [overflow-wrap:anywhere]">
          {campaign.flow_name}
          <span className="num ml-1.5">v{campaign.flow_version_number}</span>
        </div>

        {reason && (
          <p className={`mt-2 text-xs [overflow-wrap:anywhere] ${reason.tone}`}>
            {reason.text}
          </p>
        )}

        <dl className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <div>
            <dt className="eyebrow">Dialed</dt>
            <dd className="num mt-0.5 text-sm text-chalk">{figures.dialed}</dd>
          </div>
          <div>
            <dt className="eyebrow">Answer</dt>
            <dd
              className={`num mt-0.5 text-sm ${figures.low ? "text-amber" : "text-chalk"}`}
            >
              {figures.rate}
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
  const figures = figuresFor(campaign);
  const reason = reasonFor(campaign);

  return (
    <tr>
      <td>
        <Link
          to={`/campaigns/${campaign.id}`}
          className="inline-flex min-h-9 items-center font-medium text-chalk hover:text-signal"
        >
          {campaign.name}
        </Link>
        {reason && (
          <p
            className={`max-w-xs truncate text-xs ${reason.tone}`}
            title={campaign.pause_reason}
          >
            {reason.text}
          </p>
        )}
      </td>
      <td>
        <StatusPill status={campaign.status} />
      </td>
      <td>
        {campaign.flow_name}
        <span className="num ml-1.5 text-xs text-ash-dim">
          v{campaign.flow_version_number}
        </span>
      </td>
      <td className="num">{figures.dialed}</td>
      <td className="num">
        <span className={figures.low ? "text-amber" : undefined}>
          {figures.rate}
        </span>
      </td>
      <td>{formatRelative(campaign.updated_at)}</td>
    </tr>
  );
}
