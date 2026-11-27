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
          <p className="px-4 py-10 text-center text-sm text-ash">No counters yet.</p>
        )}
      </Panel>
    );
  }

  const answered = kpi.answered || 0;
  const reached = kpi.human + kpi.machine;
  const total = campaign.stats?.total_contacts ?? 0;

  return (
    <div className="space-y-4">
      <div className="stat-grid grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Answer rate"
          value={formatRate(kpi.rates.answer)}
          denominator="of calls placed"
          tone={kpi.rates.answer < 0.08 ? "amber" : "live"}
        />
        <Stat
          label="Dialed"
          value={formatCount(kpi.dialed)}
          denominator="calls placed"
          to={`/campaigns/${campaign.id}/calls`}
        />
        <Stat
          label="Reached a person"
          value={formatRate(kpi.rates.human)}
          denominator="of calls placed"
        />
        <Stat
          label="Opted out"
          value={formatRate(kpi.rates.opt_out)}
          denominator="of answered calls"
          tone={kpi.rates.opt_out > 0.02 ? "amber" : undefined}
        />
      </div>

      {kpi.rates.answer < 0.08 && kpi.dialed > 200 && (
        <p role="alert" className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-amber">
          Answer rate under 8% usually means the caller ID is being labelled,
          not that the list is bad. Check the number's reputation before blaming
          the data.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="overflow-hidden" accent={dialing}>
          <PanelHeader
            title="Channels in use"
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
                  dialing ? "text-good" : "text-chalk",
                )}
              />
              <span className="num text-sm text-ash">
                / {campaign.max_concurrent_channels}
              </span>
            </div>
            <LineMeter
              live={kpi.live_channels}
              ceiling={campaign.max_concurrent_channels}
            />
          </div>
          <dl className="grid grid-cols-1 gap-4 border-t border-edge px-4 py-4 min-[400px]:grid-cols-2">
            <Mini label="Talk time" value={formatDuration(kpi.duration_seconds)} />
            {answered > 0 && (
              <Mini
                label="avg per answer"
                value={formatDuration(Math.round(kpi.duration_seconds / answered))}
              />
            )}
          </dl>
          <p className="border-t border-edge px-4 py-3 text-xs text-ash-dim">
            Updated continuously while dialing
          </p>
        </Panel>

        <Panel className="flex flex-col overflow-hidden">
          <PanelHeader title="Queue worked" />
          <div className="flex flex-1 items-center justify-center p-5">
            {total > 0 ? (
              <div className="w-full">
                <Gauge
                  value={kpi.dialed / total}
                  label="Queue worked"
                  caption={`${formatCount(
                    Math.max(0, total - kpi.dialed),
                  )} contacts left`}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-3 text-xs">
                  <span className="text-ash">
                    <span className="num text-chalk">
                      {formatCount(kpi.dialed)}
                    </span>{" "}
                    of <span className="num">{formatCount(total)}</span> contacts
                    dialed
                  </span>
                  <span className="num text-ash">
                    {formatRate(kpi.dialed / total)} complete
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-center text-sm text-ash">
                Progress appears once the queue is built.
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
            <Bar label="Suppressed before dial" value={kpi.suppressed} total={kpi.dialed} color="bg-edge-bright" />
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t border-edge px-4 py-4 sm:grid-cols-4">
            <Mini label="Confirmed" value={formatCount(kpi.confirmed)} />
            <Mini label="Transferred" value={formatCount(kpi.transferred)} />
            <Mini label="Voicemail" value={formatCount(kpi.voicemail)} />
            <Mini label="Opted out" value={formatCount(kpi.opted_out)} tone="amber" />
          </dl>
        </Panel>

        <Panel className="self-start overflow-hidden">
          <PanelHeader title="Keypresses" hint="Key 9 is the opt-out. Watch it." />
          <div className="px-4 py-4">
            {Object.keys(kpi.dtmf).length === 0 ? (
              <p className="py-6 text-center text-sm text-ash">
                Nobody has pressed anything yet.
              </p>
            ) : (
              <Keypad dtmf={kpi.dtmf} />
            )}
          </div>
        </Panel>
      </div>

      {campaign.amd_enabled && amd.data && (
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Machine detection"
            hint="Detection is a classifier. The costly error is calling a human a machine — you hang up on, or leave voicemail in the ear of, a person who answered."
          />
          <dl className="grid grid-cols-2 gap-4 px-4 py-4 lg:grid-cols-4">
            <Mini label="Human" value={formatCount(amd.data.human)} />
            <Mini label="Machine" value={formatCount(amd.data.machine)} />
            <Mini
              label="Machine, then pressed"
              value={formatCount(amd.data.machine_with_dtmf)}
              tone="rust"
              hint="A person was called a machine"
            />
            <Mini label="Unknown" value={formatCount(amd.data.unknown)} />
          </dl>
          {reached > 0 && (
            <p className="border-t border-edge px-4 py-3 text-sm text-ash">
              <span className="num font-medium text-chalk">
                {formatRate(amd.data.false_machine_rate)}
              </span>{" "}
              of machine verdicts look wrong.
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
        <Badge tone="warn">Counters may be stale</Badge>
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
      aria-label={`${live} of ${ceiling} channels in use`}
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
  tone?: "amber" | "rust";
  hint?: string;
}) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cx(
          "num mt-1 text-xl font-bold",
          tone === "amber"
            ? "text-amber"
            : tone === "rust"
              ? "text-rust"
              : "text-chalk",
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
