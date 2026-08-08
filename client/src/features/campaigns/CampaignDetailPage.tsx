/**
 * One campaign: what it is set to do, and whether it may start.
 *
 * Five fields freeze once the campaign is live — flow version, contact lists,
 * caller ID, and the two consent settings. They are shown locked with the
 * reason rather than merely disabled, because a greyed-out control with no
 * explanation reads as a bug.
 */

import { NavLink, Outlet, useParams } from "react-router-dom";

import { PulseLoader } from "@/components/styled/PulseLoader";
import { BackLink, ErrorState, Panel, StatusPill, cx } from "@/components/ui";
import {
  formatCount,
  formatDateTime,
  formatLocalTime,
  formatWeekdays,
} from "@/lib/format";
import { FROZEN_WHILE_RUNNING, useCampaign } from "@/lib/queries/campaigns";
import type { Campaign } from "@/types/domain";

import { LaunchControl } from "./LaunchControl";

export function CampaignDetailLayout() {
  const { id } = useParams();
  const { data: campaign, isLoading, error, refetch } = useCampaign(id);

  if (isLoading) return <PulseLoader label="Loading campaign" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!campaign) return null;

  const tabs = [
    { to: ".", label: "Overview", end: true },
    { to: "live", label: "Live" },
    { to: "calls", label: "Calls" },
    { to: "settings", label: "Settings" },
  ];

  return (
    <div className="space-y-6">
      <header>
        <BackLink to="/campaigns">Campaigns</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">
            {campaign.name}
          </h1>
          <StatusPill status={campaign.status} />
        </div>

        {campaign.status === "throttled" && (
          <p className="mt-2 max-w-2xl rounded border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
            <strong className="font-semibold">Stopped dialing.</strong> The
            carrier is refusing traffic, so no calls are going out.
            {campaign.pause_reason && (
              <span className="num mt-1 block text-xs opacity-90">
                {campaign.pause_reason}
              </span>
            )}
          </p>
        )}
      </header>

      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-edge px-4 lg:mx-0 lg:px-0" aria-label="Campaign">
        {tabs.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cx(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-signal font-medium text-chalk"
                  : "border-transparent text-ash hover:text-chalk",
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

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_minmax(0,1fr)]">
      <LaunchControl campaign={campaign} />

      <Panel className="overflow-hidden">
        <div className="border-b border-edge px-4 py-3">
          <h2 className="display text-sm font-semibold text-chalk">
            Configuration
          </h2>
          {frozen && (
            <p className="mt-0.5 text-xs text-amber">
              Locked while dialing — stop or pause the campaign to change these.
            </p>
          )}
        </div>

        <dl className="divide-y divide-edge text-sm">
          <Row
            label="Flow"
            locked={frozen && FROZEN_WHILE_RUNNING.includes("flow_version")}
          >
            {campaign.flow_name}{" "}
            <span className="num text-xs text-ash">
              v{campaign.flow_version_number}
            </span>
          </Row>

          <Row
            label="Caller ID"
            locked={frozen && FROZEN_WHILE_RUNNING.includes("caller_id")}
          >
            <span className="num">
              {campaign.caller_id_detail?.phone_e164 ?? "—"}
            </span>
            {campaign.caller_id_detail && (
              <span
                className={cx(
                  "ml-2 rounded border px-1.5 py-0.5 font-mono text-[10px]",
                  campaign.caller_id_detail.attestation === "A"
                    ? "border-live-bright/40 text-live-bright"
                    : "border-amber/40 text-amber",
                )}
                title="STIR/SHAKEN attestation, assigned by the carrier"
              >
                {campaign.caller_id_detail.attestation}
              </span>
            )}
          </Row>

          <Row
            label="Lists"
            locked={frozen && FROZEN_WHILE_RUNNING.includes("contact_lists")}
          >
            {campaign.contact_lists.length === 0
              ? "None attached"
              : `${campaign.contact_lists.length} attached`}
          </Row>

          <Row label="Consent" locked={frozen}>
            {campaign.requires_consent
              ? `Required · ${campaign.consent_scope}`
              : "Not required"}
          </Row>

          <Row label="Pace">
            <span className="num">{campaign.cps_limit}</span> calls/sec, up to{" "}
            <span className="num">{campaign.max_concurrent_channels}</span>{" "}
            channels
          </Row>

          <Row label="Calling hours">
            <span className="num">
              {formatLocalTime(campaign.window_start_local)}–
              {formatLocalTime(campaign.window_end_local)}
            </span>{" "}
            <span className="text-ash">
              {campaign.respect_contact_timezone
                ? "in the contact's timezone"
                : `in ${campaign.fallback_timezone}`}
            </span>
            <div className="mt-0.5 text-xs text-ash">
              {formatWeekdays(campaign.active_weekdays)}
            </div>
          </Row>

          <Row label="Retries">
            Up to <span className="num">{campaign.max_attempts}</span> attempts,{" "}
            <span className="num">{campaign.max_attempts_per_day}</span> per day
            <div className="mt-0.5 text-xs text-ash">
              {campaign.retry_on_statuses.length > 0
                ? `Retries ${campaign.retry_on_statuses.join(", ")}`
                : "No retry statuses set"}
            </div>
          </Row>

          <Row label="Machine detection">
            {campaign.amd_enabled ? (
              <>
                <span className="num">{campaign.amd_mode}</span>
                <div className="mt-0.5 text-xs text-ash">
                  {campaign.hangup_on_machine
                    ? "Hangs up on a machine"
                    : campaign.voicemail_node
                      ? `Drops to ${campaign.voicemail_node}`
                      : "No voicemail branch set"}
                </div>
              </>
            ) : (
              "Off"
            )}
          </Row>

          <Row label="Recording">
            {campaign.record_calls ? "On" : "Off"}
            {campaign.record_calls && !campaign.recording_disclosure_node && (
              <span className="ml-2 text-xs text-rust">
                No disclosure node set
              </span>
            )}
          </Row>

          <Row label="Queue">
            {campaign.queue_built_at ? (
              <>
                Built {formatDateTime(campaign.queue_built_at)}
                {campaign.stats && (
                  <span className="num ml-2 text-ash">
                    {formatCount(campaign.stats.total_contacts)} contacts
                  </span>
                )}
              </>
            ) : (
              <span className="text-ash">
                Not built — the campaign has never started
              </span>
            )}
          </Row>
        </dl>
      </Panel>
    </div>
  );
}

function Row({
  label,
  children,
  locked,
}: {
  label: string;
  children: React.ReactNode;
  locked?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[8.5rem_1fr] sm:gap-3 sm:py-2.5">
      <dt className="eyebrow pt-1">{label}</dt>
      <dd className="text-chalk">
        {children}
        {locked && (
          <span
            className="ml-2 font-mono text-[10px] uppercase tracking-wider text-amber"
            title="Cannot be changed while the campaign is dialing"
          >
            locked
          </span>
        )}
      </dd>
    </div>
  );
}
