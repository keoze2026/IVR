/**
 * One campaign: what it is set to do, and whether it may start.
 *
 * Some fields freeze once the campaign is live — flow version, contact lists,
 * caller ID, and the two consent settings. They are shown labelled "Locked"
 * with the reason rather than merely disabled, because a greyed-out control
 * with no explanation reads as a bug.
 */

import type { ReactNode } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";

import { PulseLoader } from "@/components/styled/PulseLoader";
import {
  BackLink,
  Badge,
  ErrorState,
  PageHeader,
  Panel,
  PanelHeader,
  Stat,
  StatusPill,
  cx,
} from "@/components/ui";
import {
  formatCount,
  formatDateTime,
  formatLocalTime,
  formatRate,
  formatWeekdays,
} from "@/lib/format";
import { FROZEN_WHILE_RUNNING, useCampaign } from "@/lib/queries/campaigns";
import type { Campaign } from "@/types/domain";

import { LaunchControl } from "./LaunchControl";

const TABS = [
  { to: ".", label: "Overview", end: true },
  { to: "live", label: "Live", end: false },
  { to: "calls", label: "Calls", end: false },
  { to: "settings", label: "Settings", end: false },
];

export function CampaignDetailLayout() {
  const { id } = useParams();
  const { data: campaign, isLoading, error, refetch } = useCampaign(id);

  if (isLoading) return <PulseLoader label="Loading campaign" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!campaign) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <BackLink to="/campaigns">Campaigns</BackLink>
        <div className="[overflow-wrap:anywhere]">
          <PageHeader
            title={campaign.name}
            subtitle={`${campaign.flow_name} · version ${campaign.flow_version_number}`}
            actions={<StatusPill status={campaign.status} />}
          />
        </div>
      </div>

      {campaign.status === "throttled" && (
        <div
          role="alert"
          className="rounded-xl bg-[#fdf1dc] px-4 py-3 text-sm text-amber"
        >
          <strong className="font-medium">No calls are going out.</strong> The
          carrier is refusing them.
          {campaign.pause_reason && (
            <span className="num mt-1 block text-xs [overflow-wrap:anywhere]">
              {campaign.pause_reason}
            </span>
          )}
        </div>
      )}

      <nav className="flex flex-wrap gap-2" aria-label="Campaign">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cx(
                "press inline-flex min-h-10 items-center rounded-full border px-4 text-sm",
                isActive
                  ? "border-forest bg-forest text-white"
                  : "border-edge bg-panel text-ash hover:border-edge-bright",
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={campaign} />
    </div>
  );
}

export function CampaignOverview({ campaign }: { campaign: Campaign }) {
  const frozen = ["running", "throttled"].includes(campaign.status);
  const locked = (field: (typeof FROZEN_WHILE_RUNNING)[number]) =>
    frozen && FROZEN_WHILE_RUNNING.includes(field);
  // Counters mean nothing until the queue has been built.
  const stats = campaign.queue_built_at ? campaign.stats : null;

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 lg:grid-cols-4">
          <Stat label="Contacts" value={formatCount(stats.total_contacts)} />
          <Stat label="Calls placed" value={formatCount(stats.dialed)} to="calls" />
          <Stat label="Answered" value={formatCount(stats.answered)} />
          <Stat
            label="Answer rate"
            value={formatRate(stats.answer_rate)}
            denominator="of calls placed"
            tone={stats.answer_rate <= 0.08 ? "amber" : "live"}
          />
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <LaunchControl campaign={campaign} />

        <div className="space-y-4">
          <Card
            title="Setup"
            hint={frozen ? "Pause or stop to change locked items." : undefined}
          >
            <Row label="Flow" locked={locked("flow_version")}>
              {campaign.flow_name}{" "}
              <span className="num text-xs text-ash">
                v{campaign.flow_version_number}
              </span>
            </Row>

            <Row label="Caller ID" locked={locked("caller_id")}>
              <span className="num mr-2">
                {campaign.caller_id_detail?.phone_e164 ?? "—"}
              </span>
              {campaign.caller_id_detail && (
                <Badge
                  tone={
                    campaign.caller_id_detail.attestation === "A" ? "good" : "warn"
                  }
                  title="STIR/SHAKEN attestation, assigned by the carrier"
                >
                  Signs {campaign.caller_id_detail.attestation}
                </Badge>
              )}
            </Row>

            <Row label="Contact lists" locked={locked("contact_lists")}>
              {campaign.contact_lists.length === 0
                ? "None attached"
                : `${campaign.contact_lists.length} attached`}
            </Row>

            <Row label="Consent" locked={frozen}>
              {campaign.requires_consent
                ? `Required · ${campaign.consent_scope}`
                : "Not required"}
            </Row>
          </Card>

          <Card title="Schedule and speed">
            <Row label="Calling hours">
              <span className="num">
                {formatLocalTime(campaign.window_start_local)}–
                {formatLocalTime(campaign.window_end_local)}
              </span>{" "}
              <span className="text-ash">
                {campaign.respect_contact_timezone
                  ? "contact's local time"
                  : campaign.fallback_timezone}
              </span>
              <div className="text-xs text-ash">
                {formatWeekdays(campaign.active_weekdays)}
              </div>
            </Row>

            <Row label="Speed">
              <span className="num">{campaign.cps_limit}</span> calls per second,
              up to <span className="num">{campaign.max_concurrent_channels}</span>{" "}
              at once
            </Row>

            <Row label="Retries">
              Up to <span className="num">{campaign.max_attempts}</span> attempts,{" "}
              <span className="num">{campaign.max_attempts_per_day}</span> per day
              <div className="text-xs text-ash">
                {campaign.retry_on_statuses.length > 0
                  ? `Retries when ${campaign.retry_on_statuses
                      .map((s) => s.replace(/_/g, " "))
                      .join(", ")}`
                  : "No retry results chosen"}
              </div>
            </Row>
          </Card>

          <Card title="Call handling">
            <Row label="Voicemail detection">
              {campaign.amd_enabled ? (
                <>
                  <span title={campaign.amd_mode}>On</span>
                  <div className="text-xs text-ash">
                    {campaign.hangup_on_machine
                      ? "Hangs up on voicemail"
                      : campaign.voicemail_node
                        ? `Voicemail goes to step "${campaign.voicemail_node}"`
                        : "No voicemail step set"}
                  </div>
                </>
              ) : (
                "Off"
              )}
            </Row>

            <Row label="Recording">
              <span className="mr-2">{campaign.record_calls ? "On" : "Off"}</span>
              {campaign.record_calls && !campaign.recording_disclosure_node && (
                <Badge tone="bad">No recording notice set</Badge>
              )}
            </Row>

            <Row label="Call queue">
              {campaign.queue_built_at ? (
                <>
                  Built {formatDateTime(campaign.queue_built_at)}
                  {campaign.stats && (
                    <div className="num text-xs text-ash">
                      {formatCount(campaign.stats.total_contacts)} contacts
                    </div>
                  )}
                </>
              ) : (
                <span className="text-ash">Not built yet (never started)</span>
              )}
            </Row>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title={title} hint={hint} />
      <dl className="divide-y divide-edge text-sm">{children}</dl>
    </Panel>
  );
}

function Row({
  label,
  children,
  locked,
}: {
  label: string;
  children: ReactNode;
  locked?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className="eyebrow flex flex-wrap items-center gap-2 self-start sm:flex-col sm:items-start sm:gap-1 sm:pt-0.5">
        {label}
        {locked && (
          <Badge tone="warn" title="Cannot be changed while the campaign is calling">
            Locked
          </Badge>
        )}
      </dt>
      <dd className="min-w-0 text-chalk [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
