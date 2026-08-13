/**
 * The live dashboard.
 *
 * Painted first from `GET stats/`, then driven by the socket — both come from
 * the same `build_frame`, so the numbers never jump when the socket connects.
 *
 * Every rate tile states its denominator. The API computes `answer` and
 * `human` over *dialed*, and `machine`, `transfer` and `opt_out` over
 * *answered*. A tile that shows five percentages without saying which base
 * each uses produces numbers people quietly stop trusting.
 */

import { useOutletContext } from "react-router-dom";

import { ChannelMeter } from "@/components/styled/ChannelMeter";
import { Button, Gauge, LiveValue, Panel, Stat, cx } from "@/components/ui";
import { formatCount, formatDuration, formatRate } from "@/lib/format";
import { useCampaignStats } from "@/lib/queries/campaigns";
import { useCampaignSocket } from "@/lib/useCampaignSocket";
import type { AmdQuality, Campaign, KpiFrame } from "@/types/domain";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";

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
    return (
      <Panel className="px-4 py-10 text-center text-sm text-ash">
        No counters yet.
      </Panel>
    );
  }

  const answered = kpi.answered || 0;
  const reached = kpi.human + kpi.machine;

  return (
    <div className="space-y-5">
      {/* --- the thing you actually watch ------------------------------- */}
      <Panel className="px-5 py-4" accent={dialing}>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="eyebrow">Channels in use</div>
            <div className="mt-1 flex items-baseline gap-2">
              <LiveValue
                value={String(kpi.live_channels)}
                className={cx(
                  "num text-4xl leading-none",
                  dialing ? "text-live-bright" : "text-chalk",
                )}
              />
              <span className="num text-sm text-ash">
                / {campaign.max_concurrent_channels}
              </span>
            </div>
          </div>
          <ConnectionBadge state={state} isStale={isStale} onRefresh={refresh} />
        </div>

        <div className="mt-4">
          <ChannelMeter
            live={kpi.live_channels}
            ceiling={campaign.max_concurrent_channels}
            size="lg"
          />
        </div>

        {campaign.stats && campaign.stats.total_contacts > 0 && (
          <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-xs">
            <span className="text-ash">
              <span className="num text-chalk">{formatCount(kpi.dialed)}</span> of{" "}
              <span className="num">
                {formatCount(campaign.stats.total_contacts)}
              </span>{" "}
              contacts dialed
            </span>
            <span className="num text-ash">
              {formatRate(kpi.dialed / campaign.stats.total_contacts)} complete
            </span>
          </div>
        )}
      </Panel>

      {/* --- progress beside the headline rates ------------------------- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_1fr]">
        {campaign.stats && campaign.stats.total_contacts > 0 ? (
          <Panel className="flex items-center px-5 py-5">
            <Gauge
              value={kpi.dialed / campaign.stats.total_contacts}
              label="Queue worked"
              caption={`${formatCount(
                Math.max(0, campaign.stats.total_contacts - kpi.dialed),
              )} contacts left`}
            />
          </Panel>
        ) : (
          <Panel className="flex items-center justify-center px-5 py-8 text-center text-sm text-ash">
            Progress appears once the queue is built.
          </Panel>
        )}

        <div className="stagger grid gap-3 sm:grid-cols-2">
          <Stat
            label="Answer rate"
            value={formatRate(kpi.rates.answer)}
            denominator="of calls placed"
            accent
            tone={kpi.rates.answer < 0.08 ? "amber" : undefined}
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
      </div>

      {kpi.rates.answer < 0.08 && kpi.dialed > 200 && (
        <p className="rounded border border-amber/30 bg-panel px-3 py-2 text-sm text-amber">
          Answer rate under 8% usually means the caller ID is being labelled,
          not that the list is bad. Check the number's reputation before blaming
          the data.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* --- what happened to the calls ----------------------------- */}
        <Panel className="lg:col-span-2">
          <div className="border-b border-edge px-4 py-3">
            <h2 className="display text-sm font-semibold text-chalk">Outcomes</h2>
          </div>
          <div className="space-y-3 px-4 py-4">
            <Bar label="Answered" value={kpi.answered} total={kpi.dialed} tone="live" />
            <Bar label="No answer" value={kpi.no_answer} total={kpi.dialed} />
            <Bar label="Busy" value={kpi.busy} total={kpi.dialed} />
            <Bar label="Failed" value={kpi.failed} total={kpi.dialed} tone="rust" />
            <Bar
              label="Suppressed before dial"
              value={kpi.suppressed}
              total={kpi.dialed}
              tone="amber"
            />
          </div>

          <div className="grid grid-cols-2 divide-x divide-edge border-t border-edge sm:grid-cols-4">
            <Mini label="Confirmed" value={kpi.confirmed} />
            <Mini label="Transferred" value={kpi.transferred} />
            <Mini label="Voicemail" value={kpi.voicemail} />
            <Mini label="Opted out" value={kpi.opted_out} tone="amber" />
          </div>
        </Panel>

        {/* --- keypresses --------------------------------------------- */}
        <Panel>
          <div className="border-b border-edge px-4 py-3">
            <h2 className="display text-sm font-semibold text-chalk">
              Keypresses
            </h2>
            <p className="mt-0.5 text-xs text-ash">
              Key 9 is the opt-out. Watch it.
            </p>
          </div>
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

      {/* --- AMD ------------------------------------------------------- */}
      {campaign.amd_enabled && amd.data && (
        <Panel>
          <div className="border-b border-edge px-4 py-3">
            <h2 className="display text-sm font-semibold text-chalk">
              Machine detection
            </h2>
            <p className="mt-0.5 text-xs text-ash">
              Detection is a classifier. The costly error is calling a human a
              machine — you hang up on, or leave voicemail in the ear of, a
              person who answered.
            </p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-edge sm:grid-cols-4">
            <Mini label="Human" value={amd.data.human} />
            <Mini label="Machine" value={amd.data.machine} />
            <Mini
              label="Machine, then pressed"
              value={amd.data.machine_with_dtmf}
              tone="rust"
              hint="A person was called a machine"
            />
            <Mini label="Unknown" value={amd.data.unknown} />
          </div>
          {reached > 0 && (
            <p className="border-t border-edge px-4 py-2.5 text-xs text-ash">
              <span className="num text-chalk">
                {formatRate(amd.data.false_machine_rate)}
              </span>{" "}
              of machine verdicts look wrong.
            </p>
          )}
        </Panel>
      )}

      <div className="flex items-center justify-between text-xs text-ash">
        <span>
          Talk time{" "}
          <span className="num text-chalk">
            {formatDuration(kpi.duration_seconds)}
          </span>
          {answered > 0 && (
            <>
              {" · "}avg{" "}
              <span className="num text-chalk">
                {formatDuration(Math.round(kpi.duration_seconds / answered))}
              </span>{" "}
              per answer
            </>
          )}
        </span>
        <span className="text-ash-dim">Updated continuously while dialing</span>
      </div>
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
    return (
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-live-bright">
        <span className="size-1.5 rounded-full bg-live-bright" aria-hidden />
        live
      </span>
    );
  }
  if (isStale) {
    return (
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-amber">
          counters may be stale
        </span>
        <Button variant="ghost" onClick={onRefresh}>
          Refresh
        </Button>
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
      {state === "offline" ? "updating periodically" : "connecting…"}
    </span>
  );
}

function Bar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone?: "live" | "amber" | "rust";
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const fill =
    tone === "live"
      ? "bg-live-bright"
      : tone === "amber"
        ? "bg-amber"
        : tone === "rust"
          ? "bg-rust"
          : "bg-edge-bright";

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ash">{label}</span>
        <span className="num text-chalk">{formatCount(value)}</span>
      </div>
      {/* Hatched track, solid fill — the unfilled part is remaining volume,
          not absent data. */}
      <div className="hatch mt-1.5 h-2 overflow-hidden rounded-full bg-void">
        <div
          className={cx("h-full rounded-full transition-[width] duration-500", fill)}
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
  value: number;
  tone?: "amber" | "rust";
  hint?: string;
}) {
  return (
    <div className="px-4 py-3" title={hint}>
      <div className="eyebrow">{label}</div>
      <div
        className={cx(
          "num mt-1.5 text-lg",
          tone === "amber" ? "text-amber" : tone === "rust" ? "text-rust" : "text-chalk",
        )}
      >
        {formatCount(value)}
      </div>
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
    <div className="grid grid-cols-3 gap-1.5">
      {KEYS.map((key) => {
        const count = dtmf[key] ?? 0;
        const intensity = count / max;
        const isOptOut = key === "9";
        return (
          <div
            key={key}
            className={cx(
              "rounded border px-2 py-2.5 text-center transition-colors",
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
                      ? `color-mix(in oklab, var(--color-amber) ${8 + intensity * 22}%, transparent)`
                      : `color-mix(in oklab, var(--color-signal) ${8 + intensity * 22}%, transparent)`,
                  }
                : undefined
            }
          >
            <div
              className={cx(
                "num text-sm",
                count === 0 ? "text-ash-dim" : isOptOut ? "text-amber" : "text-signal",
              )}
            >
              {key}
            </div>
            <div className="num mt-0.5 text-[11px] text-chalk">
              {count > 0 ? formatCount(count) : "·"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
