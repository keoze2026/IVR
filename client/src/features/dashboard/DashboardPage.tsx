/**
 * Dashboard (Calls Insights) and the calls breakdown.
 *
 * The numbers come from the recent call records rather than a separate
 * analytics store, so they are only ever as true as the calls behind them.
 */

import { useState, type ComponentType } from "react";
import { Link } from "react-router-dom";

import {
  AlertIcon,
  CheckIcon,
  MissedIcon,
  PhoneIcon,
  PhoneOutIcon,
  WalletIcon,
} from "@/components/icons";
import { EmptyState, ErrorState, PageHeader, Panel, PanelHeader, StatusPill, TableSkeleton, cx } from "@/components/ui";
import { isAnswered, minutes, tallies } from "@/features/calls/shared";
import { formatDateTime } from "@/lib/format";
import { useCalls } from "@/lib/queries/resources";
import type { CallSummary } from "@/types/domain";

/** Calls counted into the 24 hours of the day. */
function byHour(calls: CallSummary[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const call of calls) {
    const hour = new Date(call.created_at).getHours();
    hours[hour] = (hours[hour] ?? 0) + 1;
  }
  return hours;
}

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useCalls({});
  const calls = data?.results ?? [];
  const t = tallies(calls);
  const nonAnswered = t.nonConnected - t.failed;
  const show = (value: string | number) => (isLoading ? "—" : String(value));
  const share = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0);
  const average = t.answered ? Math.round(t.durationSec / t.answered) : 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          featured
          icon={PhoneIcon}
          label="Total Calls"
          value={show(t.total)}
          note="Since last day"
          series={byHour(calls)}
        />
        <Metric
          icon={CheckIcon}
          label="Answered Calls"
          value={show(t.answered)}
          note="Since last day"
          series={byHour(calls.filter(isAnswered))}
          color="var(--color-chart-answered)"
          badge="bg-live text-live-bright"
        />
        <Metric
          icon={MissedIcon}
          label="Non-Connected Calls"
          value={show(t.nonConnected)}
          note="Since last day"
          series={byHour(calls.filter((c) => !isAnswered(c)))}
          color="var(--color-chart-missed)"
          badge="bg-warn-soft text-amber"
        />
        <Metric
          icon={AlertIcon}
          label="Failed Calls"
          value={show(t.failed)}
          note={`${share(t.failed)}% of all`}
          series={byHour(calls.filter((c) => c.status === "failed"))}
          color="var(--color-chart-failed)"
          badge="bg-bad-soft text-rust"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Calls Activity – Daily" hint="Total calls by hour." />
          <ActivityChart hours={byHour(calls)} />
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Answered rate" />
          <div className="flex flex-col items-center p-6">
            <Donut
              figure={`${share(t.answered)}%`}
              caption="answered"
              label={`${share(t.answered)} percent answered`}
              parts={[
                { value: t.answered, color: "var(--color-chart-answered)" },
                { value: nonAnswered, color: "var(--color-chart-missed)" },
                { value: t.failed, color: "var(--color-chart-failed)" },
              ]}
              total={t.total}
            />
            <ul className="mt-6 w-full space-y-2">
              <Legend label="Answered" count={t.answered} percent={share(t.answered)} color="bg-chart-answered" />
              <Legend label="Non-answered" count={nonAnswered} percent={share(nonAnswered)} color="bg-chart-missed" />
              <Legend label="Failed" count={t.failed} percent={share(t.failed)} color="bg-chart-failed" />
            </ul>
          </div>
        </Panel>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_360px]">
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader
            title="Recent calls"
            action={<Link to="/cdr" className="rounded-full bg-live px-4 py-2 text-xs font-bold text-live-bright hover:bg-raised">See all</Link>}
          />
          {isLoading && <TableSkeleton rows={4} />}
          {!isLoading && calls.length === 0 && (
            <div className="p-5">
              <EmptyState title="No calls yet" description="Start a job to place calls." />
            </div>
          )}
          {calls.length > 0 && <RecentCalls rows={calls.slice(0, 10)} />}
        </Panel>

        <div className="surface-forest rounded-[var(--radius-card)] p-6 shadow-[var(--shadow-raised)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white/75">Total Utilization</span>
            <span className="flex size-10 items-center justify-center rounded-2xl bg-white/10 text-mint">
              <WalletIcon />
            </span>
          </div>
          <div className="num display mt-2 text-4xl">{isLoading ? "—" : `$${t.spend.toFixed(2)}`}</div>
          <div className="mt-1 text-xs font-semibold text-white/65">Spend so far</div>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/[0.08] p-3">
              <dt className="text-xs font-semibold text-white/65">Average talk time</dt>
              <dd className="num display mt-1 text-xl text-mint">{isLoading ? "—" : minutes(average)}</dd>
            </div>
            <div className="rounded-2xl bg-white/[0.08] p-3">
              <dt className="text-xs font-semibold text-white/65">Total Duration</dt>
              <dd className="num display mt-1 text-xl text-mint">{isLoading ? "—" : minutes(t.durationSec)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

export function CallsBreakdownPage() {
  const { data, isLoading, error, refetch } = useCalls({});
  const calls = data?.results ?? [];
  const t = tallies(calls);
  const nonAnswered = t.nonConnected - t.failed;
  const show = (value: number) => (isLoading ? "—" : String(value));
  const pct = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Calls Dashboard" subtitle="Here, take a look at your calls." />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={CheckIcon}
          label="Answered Calls"
          value={show(t.answered)}
          note={`${pct(t.answered)}% of all`}
          series={byHour(calls.filter(isAnswered))}
          color="var(--color-chart-answered)"
          badge="bg-live text-live-bright"
        />
        <Metric
          icon={MissedIcon}
          label="Non-Answered Calls"
          value={show(nonAnswered)}
          note={`${pct(nonAnswered)}% of all`}
          series={byHour(calls.filter((c) => !isAnswered(c) && c.status !== "failed"))}
          color="var(--color-chart-missed)"
          badge="bg-warn-soft text-amber"
        />
        <Metric
          icon={AlertIcon}
          label="Failed Calls"
          value={show(t.failed)}
          note={`${pct(t.failed)}% of all`}
          series={byHour(calls.filter((c) => c.status === "failed"))}
          color="var(--color-chart-failed)"
          badge="bg-bad-soft text-rust"
        />
        <Metric
          featured
          icon={PhoneIcon}
          label="Total Calls"
          value={show(t.total)}
          note="100% of all"
          series={byHour(calls)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHeader title="Total Calls — Current Month" />
          <div className="flex flex-col items-center p-8">
            <Donut
              figure={String(t.total)}
              caption="Calls"
              label={`${t.answered} of ${t.total} calls answered`}
              parts={[{ value: t.answered, color: "var(--color-chart-answered)" }]}
              total={t.total}
            />
            <p className="mt-4 text-sm font-medium text-ash">Answered vs. total this month.</p>
          </div>
        </Panel>
        <Panel className="overflow-hidden">
          <PanelHeader title="Answered rate" />
          <div className="space-y-5 p-6">
            {([
              ["Answered", t.answered, "bg-chart-answered"],
              ["Non-answered", nonAnswered, "bg-chart-missed"],
              ["Failed", t.failed, "bg-chart-failed"],
            ] as const).map(([label, n, tone]) => (
              <div key={label}>
                <div className="mb-1.5 flex justify-between text-sm font-semibold text-ash">
                  <span>{label}</span>
                  <span className="num text-chalk">{n}</span>
                </div>
                <div className="h-2.5 rounded-full bg-raised">
                  <div className={cx("h-2.5 rounded-full", tone)} style={{ width: `${pct(n)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function RecentCalls({ rows }: { rows: CallSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>To</th>
            <th>Status</th>
            <th>Answered by</th>
            <th>Duration</th>
            <th>Cost</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <div className="flex items-center gap-3">
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-forest text-mint">
                    <PhoneOutIcon className="size-[18px]" />
                  </span>
                  <span className="num font-bold text-chalk">{c.to_masked}</span>
                </div>
              </td>
              <td><StatusPill status={c.status} /></td>
              <td>{c.answered_by || "—"}</td>
              <td className="num">{c.duration_seconds}s</td>
              <td className="num">{c.cost ? `$${Number(c.cost).toFixed(4)}` : "—"}</td>
              <td>{formatDateTime(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  note,
  series,
  color,
  badge,
  featured = false,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note: string;
  series: number[];
  color?: string;
  badge?: string;
  featured?: boolean;
}) {
  const max = Math.max(...series, 1);
  return (
    <div
      className={cx(
        "rounded-[var(--radius-card)] p-5",
        featured
          ? "surface-forest shadow-[var(--shadow-raised)]"
          : "card border border-edge bg-panel shadow-[var(--shadow-card)]",
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cx("flex size-11 items-center justify-center rounded-2xl", featured ? "neon" : badge)}>
          <Icon className="size-[22px]" />
        </span>
        <span className={cx("text-sm font-bold", featured ? "text-white/80" : "text-ash")}>{label}</span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className={cx("num display text-4xl leading-none", featured ? "text-white" : "text-chalk")}>{value}</div>
          <div className={cx("mt-2 text-xs font-semibold", featured ? "text-white/65" : "text-ash-dim")}>{note}</div>
        </div>
        {/* Shape of the day for this figure; the large chart gives the values. */}
        <div aria-hidden className="flex h-12 w-28 items-end gap-[2px]">
          {series.map((n, i) => (
            <span
              key={i}
              className="flex-1 rounded-sm"
              style={{
                height: n ? `${Math.max(12, (n / max) * 100)}%` : 3,
                background: featured ? "var(--color-mint)" : color,
                opacity: n ? 1 : 0.22,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Area chart of calls through the day, with the value of the hour under the pointer. */
function ActivityChart({ hours }: { hours: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = hours.reduce((a, b) => a + b, 0);
  const peak = Math.max(...hours);
  // A round ceiling divisible into four whole-number gridlines.
  const top = Math.max(4, Math.ceil(peak / 4) * 4);
  const x = (h: number) => (h / 23) * 1000;
  const y = (n: number) => 240 - (n / top) * 230;
  const line = hours.map((n, h) => `${h ? "L" : "M"}${x(h)} ${y(n)}`).join(" ");
  const at = hover ?? (total ? hours.indexOf(peak) : null);

  return (
    <div className="p-5">
      <p className="num h-6 text-sm font-bold text-chalk" aria-live="polite">
        {at === null ? (
          <span className="text-ash-dim">No calls yet</span>
        ) : (
          <>
            {hours[at]} {hours[at] === 1 ? "call" : "calls"}
            <span className="ml-2 font-semibold text-ash-dim">
              {hover === null ? "busiest hour, " : ""}{hourLabel(at)}
            </span>
          </>
        )}
      </p>

      <div className="mt-4 flex gap-3">
        <div className="num flex h-64 flex-col justify-between text-right text-[11px] font-semibold text-ash-dim">
          {[4, 3, 2, 1, 0].map((i) => <span key={i} className="-my-2 w-6">{(top / 4) * i}</span>)}
        </div>
        <div className="relative h-64 min-w-0 flex-1" onMouseLeave={() => setHover(null)}>
          <svg viewBox="0 0 1000 240" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-answered)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--color-chart-answered)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3, 4].map((i) => (
              <line key={i} x1="0" x2="1000" y1={y((top / 4) * i)} y2={y((top / 4) * i)} stroke="var(--color-edge)" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={`${line} L1000 240 L0 240 Z`} fill="url(#activity-fill)" />
            <path className="glow" d={line} fill="none" stroke="var(--color-signal)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {at !== null && (
            <>
              <span aria-hidden className="absolute bottom-0 top-0 w-px bg-signal/30" style={{ left: `${(at / 23) * 100}%` }} />
              <span
                aria-hidden
                className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-panel bg-mint shadow"
                style={{ left: `${(at / 23) * 100}%`, top: `${(y(hours[at] ?? 0) / 240) * 100}%` }}
              />
            </>
          )}

          <div className="absolute inset-0 flex">
            {hours.map((n, h) => (
              <button
                key={h}
                type="button"
                aria-label={`${hourLabel(h)}: ${n} calls`}
                onMouseEnter={() => setHover(h)}
                onFocus={() => setHover(h)}
                className="h-full flex-1"
              />
            ))}
          </div>
        </div>
      </div>
      <div className="num ml-9 mt-3 flex justify-between text-[11px] font-semibold text-ash-dim">
        {[0, 4, 8, 12, 16, 20, 23].map((h) => <span key={h}>{hourLabel(h)}</span>)}
      </div>
    </div>
  );
}

/** Outcome shares around a headline figure. */
function Donut({
  parts,
  total,
  figure,
  caption,
  label,
}: {
  parts: { value: number; color: string }[];
  total: number;
  figure: string;
  caption: string;
  label: string;
}) {
  const r = 70;
  const length = 2 * Math.PI * r;
  const shown = parts.filter((p) => p.value > 0);
  let offset = 0;

  return (
    <svg viewBox="0 0 180 180" className="size-48" role="img" aria-label={label}>
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="22" />
      {shown.map((p) => {
        const size = (p.value / (total || 1)) * length;
        const gap = shown.length > 1 ? 3 : 0;
        const arc = (
          <circle
            key={p.color}
            cx="90" cy="90" r={r} fill="none" stroke={p.color} strokeWidth="22"
            strokeDasharray={`${Math.max(0, size - gap)} ${length}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 90 90)"
          />
        );
        offset += size;
        return arc;
      })}
      <text x="90" y="90" textAnchor="middle" fontSize="36" fontWeight="800" fill="var(--color-chalk)">{figure}</text>
      <text x="90" y="112" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-ash-dim)">{caption}</text>
    </svg>
  );
}

function Legend({ label, count, percent, color }: { label: string; count: number; percent: number; color: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-void px-4 py-2.5 text-sm font-semibold">
      <span className={cx("size-3 rounded-full", color)} aria-hidden />
      <span className="text-ash">{label}</span>
      <span className="num ml-auto font-extrabold text-chalk">{count}</span>
      <span className="num w-11 text-right text-ash-dim">{percent}%</span>
    </li>
  );
}
