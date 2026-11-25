/**
 * The live dashboard.
 *
 * Painted first from `GET stats/`, then driven by the socket — both come from
 * the same `build_frame`, so the numbers never jump when the socket connects.
 *
 * Every rate states its denominator. The API computes `answer` and `human`
 * over *dialed*, and `machine`, `transfer` and `opt_out` over *answered*.
 * Percentages without their base produce numbers people stop trusting.
 */

import { useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";

import {
  Badge,
  Button,
  ErrorState,
  Gauge,
  LiveValue,
  Panel,
  PanelHeader,
  Stat,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { request } from "@/lib/api";
import { formatCount, formatDuration, formatRate } from "@/lib/format";
import { useCampaignStats } from "@/lib/queries/campaigns";
import { useCampaignSocket } from "@/lib/useCampaignSocket";
import type { AmdQuality, Campaign, KpiFrame } from "@/types/domain";

export function LivePage() {
  const campaign = useOutletContext<Campaign>();
  const dialing = campaign.status === "running";

  const rest = useCampaignStats(campaign.id);
  const { frame, state, isStale, refresh } = useCampaignSocket(campaign.id);

  // Socket wins once it has a frame; REST covers first paint and the case
  // where the socket never opens.
  const kpi: KpiFrame | undefined = frame ?? rest.data;

  const amd = useQuery<AmdQuality>({
    queryKey: ["campaigns", campaign.id, "amd-quality"],
    queryFn: () => request<AmdQuality>(`campaigns/${campaign.id}/amd-quality/`),
    refetchInterval: dialing ? 30_000 : false,
  });

  if (!kpi) {
    if (rest.error) {
      return <ErrorState error={rest.error} onRetry={() => void rest.refetch()} />;
    }
    return (
      <Panel className="overflow-hidden">
        {rest.isLoading ? (
          <TableSkeleton />
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ash">No figures yet.</p>
        )}
      </Panel>
    );
  }

  const answered = kpi.answered || 0;
  const reached = kpi.human + kpi.machine;
  const total = campaign.stats?.total_contacts ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Calls placed"
          value={formatCount(kpi.dialed)}
          to={`/campaigns/${campaign.id}/calls`}
        />
        <Stat
          label="Answer rate"
          value={formatRate(kpi.rates.answer)}
          denominator="of calls placed"
          tone={kpi.rates.answer < 0.08 ? "amber" : "live"}
        />
        <Stat
          label="Reached a person"
          value={formatRate(kpi.rates.human)}
          denominator="of calls placed"
        />
        <Stat
          label="Opted out"
          value={formatRate(kpi.rates.opt_out)}
          denominator={`${formatCount(kpi.opted_out)} · of answered calls`}
          tone={kpi.rates.opt_out > 0.02 ? "amber" : undefined}
        />
      </div>

      {kpi.rates.answer < 0.08 && kpi.dialed > 200 && (
        <p role="alert" className="rounded-xl bg-[#fdf1dc] px-4 py-3 text-sm text-amber">
          Answer rate is under 8%. Check whether your caller ID is being labelled
          as spam.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="overflow-hidden" accent={dialing}>
          <PanelHeader
            title="Calls in progress"
            action={
              <ConnectionBadge state={state} isStale={isStale} onRefresh={refresh} />
            }
          />
          <div className="px-4 py-5">
            <div className="flex items-baseline gap-2">
              <LiveValue
                value={String(kpi.live_channels)}
                className={cx(
                  "num text-5xl font-light leading-none",
                  dialing ? "text-live-bright" : "text-chalk",
                )}
              />
              <span className="num text-sm text-ash">
                of {campaign.max_concurrent_channels} lines
              </span>
            </div>
            <LineMeter
              live={kpi.live_channels}
              ceiling={campaign.max_concurrent_channels}
            />
          </div>
          <dl className="grid grid-cols-1 gap-4 border-t border-edge px-4 py-4 min-[400px]:grid-cols-2">
            <Mini label="Total talk time" value={formatDuration(kpi.duration_seconds)} />
            <Mini
              label="Average per answered call"
              value={
                answered > 0
                  ? formatDuration(Math.round(kpi.duration_seconds / answered))
                  : "—"
              }
            />
          </dl>
        </Panel>

        <Panel className="flex flex-col overflow-hidden">
          <PanelHeader title="Progress" />
          <div className="flex flex-1 items-center justify-center p-5">
            {total > 0 ? (
              <div className="w-full">
                <Gauge
                  value={kpi.dialed / total}
                  label="Contacts called"
                  caption={`${formatCount(kpi.dialed)} of ${formatCount(total)} · ${formatCount(
                    Math.max(0, total - kpi.dialed),
                  )} left`}
                />
              </div>
            ) : (
              <p className="text-center text-sm text-ash">
                Shows once calling starts.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Outcomes" />
          <div className="space-y-4 px-4 py-4">
            <Bar label="Answered" value={kpi.answered} total={kpi.dialed} color="bg-chart-answered" />
            <Bar label="No answer" value={kpi.no_answer} total={kpi.dialed} color="bg-chart-missed" />
            <Bar label="Busy" value={kpi.busy} total={kpi.dialed} color="bg-chart-missed" />
            <Bar label="Failed" value={kpi.failed} total={kpi.dialed} color="bg-chart-failed" />
            <Bar label="Blocked before calling" value={kpi.suppressed} total={kpi.dialed} color="bg-edge-bright" />
          </div>
          <dl className="grid grid-cols-1 gap-4 border-t border-edge px-4 py-4 min-[400px]:grid-cols-3">
            <Mini label="Confirmed" value={formatCount(kpi.confirmed)} />
            <Mini label="Transferred" value={formatCount(kpi.transferred)} />
            <Mini label="Voicemail" value={formatCount(kpi.voicemail)} />
          </dl>
        </Panel>

        <Panel className="self-start overflow-hidden">
          <PanelHeader title="Keys pressed" hint="Key 9 is opt-out." />
          <div className="px-4 py-4">
            {Object.keys(kpi.dtmf).length === 0 ? (
              <p className="py-6 text-center text-sm text-ash">No key presses yet.</p>
            ) : (
              <Keypad dtmf={kpi.dtmf} />
            )}
          </div>
        </Panel>
      </div>

      {campaign.amd_enabled && amd.data && (
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Voicemail detection"
            hint="Detection can be wrong: a real person may be treated as voicemail."
          />
          <dl className="grid grid-cols-2 gap-4 px-4 py-4 lg:grid-cols-4">
            <Mini label="Person" value={formatCount(amd.data.human)} />
            <Mini label="Voicemail" value={formatCount(amd.data.machine)} />
            <Mini
              label="Voicemail, but pressed a key"
              value={formatCount(amd.data.machine_with_dtmf)}
              tone="rust"
              hint="Likely a real person treated as voicemail"
            />
            <Mini label="Unknown" value={formatCount(amd.data.unknown)} />
          </dl>
          {reached > 0 && (
            <p className="border-t border-edge px-4 py-3 text-sm text-ash">
              <span className="num font-medium text-chalk">
                {formatRate(amd.data.false_machine_rate)}
              </span>{" "}
              of voicemail results look wrong.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

function ConnectionBadge({
  state,
  isStale,
  onRefresh,
}: {
  state: string;
  isStale: boolean;
  onRefresh: () => void;
}) {
  if (state === "open" && !isStale) {
    return <Badge tone="good">Live</Badge>;
  }
  if (isStale) {
    return (
      <span className="flex flex-wrap items-center justify-end gap-2">
        <Badge tone="warn">Figures may be out of date</Badge>
        <Button dense onClick={onRefresh}>
          Refresh
        </Button>
      </span>
    );
  }
  return (
    <Badge>{state === "offline" ? "Updating periodically" : "Connecting…"}</Badge>
  );
}

/** Lines in use against the campaign's limit. Red if the limit is exceeded. */
function LineMeter({ live, ceiling }: { live: number; ceiling: number }) {
  const percent = Math.min(100, (live / Math.max(1, ceiling)) * 100);

  return (
    <div
      role="meter"
      aria-valuenow={live}
      aria-valuemin={0}
      aria-valuemax={ceiling}
      aria-label={`${live} of ${ceiling} lines in use`}
      className="mt-4 h-3 overflow-hidden rounded-full bg-raised"
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-500",
          live > ceiling ? "bg-rust" : "bg-chart-answered",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function Bar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-ash">
          <span className={cx("size-2.5 rounded-full", color)} aria-hidden />
          {label}
        </span>
        <span className="num text-chalk">{formatCount(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-raised">
        <div
          className={cx("h-full rounded-full transition-[width] duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "rust";
  hint?: string;
}) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cx(
          "num mt-1 text-xl font-bold",
          tone === "rust" ? "text-rust" : "text-chalk",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The keypad, not a bar chart.
 *
 * DTMF is a phone keypad; laying the counts out in that shape means an
 * operator reads "9 is climbing" positionally, the way they think about it.
 */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function Keypad({ dtmf }: { dtmf: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(dtmf));

  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((key) => {
        const count = dtmf[key] ?? 0;
        const intensity = count / max;
        const isOptOut = key === "9";
        return (
          <div
            key={key}
            className={cx(
              "rounded-xl border px-2 py-2.5 text-center transition-colors",
              count === 0
                ? "border-edge bg-void"
                : isOptOut
                  ? "border-amber/40"
                  : "border-signal/40",
            )}
            style={
              count > 0
                ? {
                    backgroundColor: isOptOut
                      ? `color-mix(in oklab, var(--color-amber) ${8 + intensity * 16}%, transparent)`
                      : `color-mix(in oklab, var(--color-signal) ${8 + intensity * 16}%, transparent)`,
                  }
                : undefined
            }
          >
            <div
              className={cx(
                "num text-base font-bold",
                count === 0 ? "text-ash-dim" : "text-chalk",
              )}
            >
              {key}
            </div>
            <div className="num mt-0.5 text-xs text-chalk">
              {count > 0 ? formatCount(count) : "·"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
