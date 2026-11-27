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
  CalendarIcon,
  CheckIcon,
  MissedIcon,
  PhoneIcon,
  PhoneOutIcon,
  WalletIcon,
} from "@/components/icons";
import { EmptyState, ErrorState, PageHeader, Panel, PanelHeader, StatusPill, TableSkeleton, cx } from "@/components/ui";
import { isAnswered, minutes, tallies } from "@/features/calls/shared";
import { formatDateTime } from "@/lib/format";
import { useCalls, useCallTrend } from "@/lib/queries/resources";
import { useSession } from "@/lib/session";
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

const greeting = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

export function DashboardPage() {
  const name = useSession().me?.session_username;
  const { data, isLoading, error, refetch } = useCalls({});
  const calls = data?.results ?? [];
  const t = tallies(calls);
  const nonAnswered = t.nonConnected - t.failed;
  const show = (value: string | number) => (isLoading ? "—" : String(value));
  const share = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0);
  const average = t.answered ? Math.round(t.durationSec / t.answered) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle={`${greeting(new Date().getHours())}${name ? `, ${name}` : ""}. Here is how your calls are going.`}
        actions={
          <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-edge bg-panel px-4 text-sm font-medium text-chalk shadow-[var(--shadow-card)]">
            <CalendarIcon className="size-[18px] text-signal" />
            {new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
          </span>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <div className="stat-grid grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Metric
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
          badge="bg-good text-white"
        />
        <Metric
          icon={MissedIcon}
          label="Non-Connected Calls"
          value={show(t.nonConnected)}
          note="Since last day"
          series={byHour(calls.filter((c) => !isAnswered(c)))}
          color="var(--color-chart-missed)"
          badge="bg-chart-missed text-white"
        />
        <Metric
          icon={AlertIcon}
          label="Failed Calls"
          value={show(t.failed)}
          note={`${share(t.failed)}% of all`}
          series={byHour(calls.filter((c) => c.status === "failed"))}
          color="var(--color-chart-failed)"
          badge="bg-rust text-white"
        />
      </div>

      <CallsTrend />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="Calls Activity – Daily" hint="Total calls by hour." />
          <AreaChart
            values={byHour(calls)}
            labels={Array.from({ length: 24 }, (_, h) => hourLabel(h))}
            ticks={[0, 4, 8, 12, 16, 20, 23]}
            peakNote="busiest hour"
          />
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

        <div className="rounded-[var(--radius-card)] border border-edge bg-panel p-6 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ash">Total Utilization</span>
            <span className="flex size-10 items-center justify-center rounded-lg bg-live text-live-bright">
              <WalletIcon />
            </span>
          </div>
          <div className="num display mt-2 text-4xl">{isLoading ? "—" : `$${t.spend.toFixed(2)}`}</div>
          <div className="mt-1 text-xs font-semibold text-ash-dim">Spend so far</div>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-void p-3">
              <dt className="text-xs font-semibold text-ash-dim">Average talk time</dt>
              <dd className="num display mt-1 text-xl text-chalk">{isLoading ? "—" : minutes(average)}</dd>
            </div>
            <div className="rounded-lg bg-void p-3">
              <dt className="text-xs font-semibold text-ash-dim">Total Duration</dt>
              <dd className="num display mt-1 text-xl text-chalk">{isLoading ? "—" : minutes(t.durationSec)}</dd>
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

      <div className="stat-grid grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Metric
          icon={CheckIcon}
          label="Answered Calls"
          value={show(t.answered)}
          note={`${pct(t.answered)}% of all`}
          series={byHour(calls.filter(isAnswered))}
          color="var(--color-chart-answered)"
          badge="bg-good text-white"
        />
        <Metric
          icon={MissedIcon}
          label="Non-Answered Calls"
          value={show(nonAnswered)}
          note={`${pct(nonAnswered)}% of all`}
          series={byHour(calls.filter((c) => !isAnswered(c) && c.status !== "failed"))}
          color="var(--color-chart-missed)"
          badge="bg-chart-missed text-white"
        />
        <Metric
          icon={AlertIcon}
          label="Failed Calls"
          value={show(t.failed)}
          note={`${pct(t.failed)}% of all`}
          series={byHour(calls.filter((c) => c.status === "failed"))}
          color="var(--color-chart-failed)"
          badge="bg-rust text-white"
        />
        <Metric
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
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-live text-live-bright">
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
  color = "var(--color-signal)",
  badge = "btn-solid",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note: string;
  series: number[];
  color?: string;
  badge?: string;
}) {
  const max = Math.max(...series, 1);
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[var(--radius-card)] border border-edge bg-panel px-3.5 py-4 shadow-[var(--shadow-card)] sm:gap-4 sm:p-5">
      <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-full sm:size-14", badge)}>
        <Icon className="size-[22px] sm:size-7" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-tight text-ash-dim sm:text-sm">{label}</div>
        <div className="num display mt-1 text-2xl leading-none text-chalk sm:text-3xl">{value}</div>
        <div className="mt-1.5 text-xs font-medium text-ash-dim">{note}</div>
      </div>
      {/* Shape of the day for this figure; the large chart gives the values. */}
      <div aria-hidden className="hidden h-12 w-24 items-end gap-px self-end 2xl:flex">
        {series.map((n, i) => (
          <span
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: n ? `${Math.max(12, (n / max) * 100)}%` : 3,
              background: color,
              opacity: n ? 1 : 0.22,
            }}
          />
        ))}
      </div>
    </div>
  );
}

const dayLabel = (iso: string) =>
  // Noon, so no time zone can move the date.
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Calls per day, from the server's count of every call rather than the latest page. */
function CallsTrend() {
  const [span, setSpan] = useState(7);
  const { data, error, isLoading, refetch } = useCallTrend(span);
  const days = data?.days ?? [];
  const sum = (key: "total" | "answered") => days.reduce((n, d) => n + d[key], 0);
  const step = Math.max(1, Math.ceil((days.length - 1) / 6));

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Calls Trend"
        hint={data ? `${sum("total")} calls, ${sum("answered")} answered` : undefined}
        action={
          <select
            aria-label="Period"
            value={span}
            onChange={(e) => setSpan(Number(e.target.value))}
            className="min-h-10 rounded-xl border border-edge bg-panel px-3 text-sm font-medium text-chalk"
          >
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
          </select>
        }
      />
      {error ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : isLoading || days.length === 0 ? (
        <TableSkeleton rows={4} />
      ) : (
        <AreaChart
          key={span}
          values={days.map((d) => d.total)}
          labels={days.map((d) => dayLabel(d.date))}
          notes={days.map((d) => `${d.answered} answered, ${d.failed} failed`)}
          ticks={days.map((_, i) => i).filter((i) => (days.length - 1 - i) % step === 0)}
          peakNote="busiest day"
        />
      )}
    </Panel>
  );
}

/** Calls along a time line, with the value under the pointer spelled out. */
function AreaChart({
  values,
  labels,
  ticks,
  peakNote,
  notes,
}: {
  values: number[];
  labels: string[];
  /** Which points are named along the bottom. */
  ticks: number[];
  peakNote: string;
  /** Extra words about each point. */
  notes?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = values.reduce((a, b) => a + b, 0);
  const peak = Math.max(...values, 0);
  // A round ceiling divisible into four whole-number gridlines.
  const top = Math.max(4, Math.ceil(peak / 4) * 4);
  const last = Math.max(values.length - 1, 1);
  const x = (i: number) => (i / last) * 1000;
  const y = (n: number) => 240 - (n / top) * 230;
  const line = values.map((n, i) => `${i ? "L" : "M"}${x(i)} ${y(n)}`).join(" ");
  const at = hover ?? (total ? values.indexOf(peak) : null);

  return (
    <div className="p-5">
      <p className="num min-h-6 text-sm font-bold text-chalk" aria-live="polite">
        {at === null ? (
          <span className="text-ash-dim">No calls yet</span>
        ) : (
          <>
            {values[at]} {values[at] === 1 ? "call" : "calls"}
            <span className="ml-2 font-medium text-ash-dim">
              {hover === null ? `${peakNote}, ` : ""}{labels[at]}
              {notes ? ` · ${notes[at]}` : ""}
            </span>
          </>
        )}
      </p>

      <div className="mt-4 flex gap-3">
        <div className="num flex h-56 flex-col justify-between text-right text-[11px] font-medium text-ash-dim sm:h-64">
          {[4, 3, 2, 1, 0].map((i) => <span key={i} className="-my-2 w-6">{(top / 4) * i}</span>)}
        </div>
        <div className="relative h-56 min-w-0 flex-1 sm:h-64" onMouseLeave={() => setHover(null)}>
          <svg viewBox="0 0 1000 240" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <line key={i} x1="0" x2="1000" y1={y((top / 4) * i)} y2={y((top / 4) * i)} stroke="var(--color-edge)" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={`${line} L1000 240 L0 240 Z`} fill="var(--color-signal)" fillOpacity="0.1" />
            <path d={line} fill="none" stroke="var(--color-signal)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {at !== null && (
            <>
              <span aria-hidden className="absolute bottom-0 top-0 w-px bg-signal/30" style={{ left: `${(at / last) * 100}%` }} />
              <span
                aria-hidden
                className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-panel bg-signal shadow"
                style={{ left: `${(at / last) * 100}%`, top: `${(y(values[at] ?? 0) / 240) * 100}%` }}
              />
            </>
          )}

          <div className="absolute inset-0 flex">
            {values.map((n, i) => (
              <button
                key={i}
                type="button"
                aria-label={`${labels[i]}: ${n} calls`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => setHover(i)}
                className="h-full min-w-0 flex-1"
              />
            ))}
          </div>
        </div>
      </div>
      {/* Each name sits under its own point. */}
      <div className="num relative ml-9 mt-3 h-4 text-[11px] font-medium text-ash-dim">
        {ticks.map((i, n) => (
          <span
            key={i}
            className={cx(
              "absolute whitespace-nowrap",
              i === 0 ? "" : i === last ? "-translate-x-full" : "-translate-x-1/2",
              // Half the names on a narrow screen, counted from the newest.
              (ticks.length - 1 - n) % 2 === 1 && "hidden sm:inline",
            )}
            style={{ left: `${(i / last) * 100}%` }}
          >
            {labels[i]}
          </span>
        ))}
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
    <li className="flex items-center gap-3 rounded-lg bg-void px-4 py-2.5 text-sm font-semibold">
      <span className={cx("size-3 rounded-full", color)} aria-hidden />
      <span className="text-ash">{label}</span>
      <span className="num ml-auto font-extrabold text-chalk">{count}</span>
      <span className="num w-11 text-right text-ash-dim">{percent}%</span>
    </li>
  );
}
