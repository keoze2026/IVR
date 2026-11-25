/**
 * Dashboard: how calling is going right now, at a glance.
 *
 * Built from the most recent call records, so the figures describe those calls
 * and are labelled that way.
 */

import { useState, type ComponentType } from "react";
import { Link } from "react-router-dom";

import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  MissedIcon,
  PhoneIcon,
  PhoneOutIcon,
  PlusIcon,
  WalletIcon,
} from "@/components/icons";
import { Button, EmptyState, ErrorState, PageHeader, Panel, PanelHeader, StatusPill, TableSkeleton, cx } from "@/components/ui";
import { RecordingButton, clock, outcomeOf, tally } from "@/features/calls/shared";
import { CreateJobModal } from "@/features/jobs/CreateJobModal";
import { formatRelative } from "@/lib/format";
import { useCallerIds, useCalls } from "@/lib/queries/resources";
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
  const { data, isLoading, error, refetch } = useCalls({}, { refetchInterval: 5000 });
  const numbers = useCallerIds();
  const calls = data?.results ?? [];
  const t = tally(calls);
  const [creating, setCreating] = useState(false);
  const show = (value: string | number) => (isLoading ? "—" : String(value));
  const share = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0);
  const only = (outcome: string) => calls.filter((c) => outcomeOf(c) === outcome);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle={`Based on your latest ${t.total} calls.`}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon className="size-4" /> New job
          </Button>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          featured
          icon={PhoneIcon}
          label="Total calls"
          value={show(t.total)}
          note={`${t.active} in progress`}
          series={byHour(calls)}
        />
        <Metric
          icon={CheckIcon}
          label="Answered"
          value={show(t.answered)}
          note={`${share(t.answered)}% of calls`}
          series={byHour(only("answered"))}
          color="var(--color-chart-answered)"
          badge="bg-live text-live-bright"
        />
        <Metric
          icon={MissedIcon}
          label="Not answered"
          value={show(t.missed)}
          note={`${share(t.missed)}% of calls`}
          series={byHour(only("missed"))}
          color="var(--color-chart-missed)"
          badge="bg-[#fdf1dc] text-amber"
        />
        <Metric
          icon={AlertIcon}
          label="Failed"
          value={show(t.failed)}
          note={`${share(t.failed)}% of calls`}
          series={byHour(only("failed"))}
          color="var(--color-chart-failed)"
          badge="bg-[#fdeaea] text-rust"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Call activity" hint="Calls by hour of the day" />
          <ActivityChart hours={byHour(calls)} />
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Outcomes" hint="How your calls ended" />
          <div className="flex flex-col items-center p-6">
            <Donut
              percent={share(t.answered)}
              parts={[
                { value: t.answered, color: "var(--color-chart-answered)" },
                { value: t.missed, color: "var(--color-chart-missed)" },
                { value: t.failed, color: "var(--color-chart-failed)" },
              ]}
              total={t.total}
            />
            <ul className="mt-6 w-full space-y-2">
              <Legend label="Answered" count={t.answered} percent={share(t.answered)} color="bg-chart-answered" />
              <Legend label="Not answered" count={t.missed} percent={share(t.missed)} color="bg-chart-missed" />
              <Legend label="Failed" count={t.failed} percent={share(t.failed)} color="bg-chart-failed" />
            </ul>
          </div>
        </Panel>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_360px]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Recent calls"
            hint="Updates automatically"
            action={<Link to="/cdr" className="rounded-full bg-live px-4 py-2 text-xs font-bold text-live-bright hover:bg-raised">View all</Link>}
          />
          {isLoading && <TableSkeleton rows={4} />}
          {!isLoading && calls.length === 0 && (
            <div className="p-5">
              <EmptyState title="No calls yet" description="Create a job to place your first call." />
            </div>
          )}
          <ul className="space-y-1 p-3">
            {calls.slice(0, 7).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl px-3 py-3 odd:bg-void/70 hover:bg-live/60">
                <span className="flex size-11 items-center justify-center rounded-full bg-forest text-mint">
                  <PhoneOutIcon className="size-5" />
                </span>
                <div className="min-w-0">
                  <Link to={`/calls/${c.id}`} className="num block text-sm font-bold text-chalk hover:text-signal">
                    {c.to_masked}
                  </Link>
                  <span className="text-xs font-semibold text-ash-dim">{formatRelative(c.created_at)}</span>
                </div>
                <span className="num ml-auto hidden items-center gap-1.5 rounded-full border border-edge bg-panel px-3 py-1 text-xs font-bold text-ash sm:inline-flex">
                  <ClockIcon className="size-3.5" />
                  {clock(c.duration_seconds ?? 0)}
                </span>
                <span className="ml-auto flex justify-end sm:ml-0 sm:w-32"><StatusPill status={c.status} /></span>
                <span className="flex w-20 justify-end"><RecordingButton call={c} /></span>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <div className="surface-forest rounded-[var(--radius-card)] p-6 shadow-[var(--shadow-raised)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white/75">Spend on these calls</span>
              <span className="flex size-10 items-center justify-center rounded-2xl bg-white/10 text-mint">
                <WalletIcon />
              </span>
            </div>
            <div className="num display mt-2 text-4xl">{isLoading ? "—" : `$${t.spend.toFixed(2)}`}</div>
            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/[0.08] p-3">
                <dt className="text-xs font-semibold text-white/65">Average talk time</dt>
                <dd className="num display mt-1 text-xl text-mint">{isLoading ? "—" : clock(t.average)}</dd>
              </div>
              <div className="rounded-2xl bg-white/[0.08] p-3">
                <dt className="text-xs font-semibold text-white/65">Total talk time</dt>
                <dd className="num display mt-1 text-xl text-mint">{isLoading ? "—" : clock(t.seconds)}</dd>
              </div>
            </dl>
          </div>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Your numbers"
              action={<Link to="/caller-ids" className="rounded-full bg-live px-4 py-2 text-xs font-bold text-live-bright hover:bg-raised">Manage</Link>}
            />
            {numbers.data?.results.length === 0 && (
              <p className="px-5 py-5 text-sm font-medium text-ash">Add a number to start calling.</p>
            )}
            <ul className="space-y-1 p-3">
              {(numbers.data?.results ?? []).slice(0, 6).map((n) => (
                <li key={n.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-void">
                  <span className="relative flex size-10 items-center justify-center rounded-full bg-live text-sm font-extrabold uppercase text-live-bright">
                    {n.provider.slice(0, 2)}
                    <span
                      aria-hidden
                      className={cx("absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-white", n.is_active ? "bg-chart-answered" : "bg-edge-bright")}
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="num text-sm font-bold text-chalk">{n.phone_e164}</div>
                    <div className="text-xs font-semibold capitalize text-ash-dim">
                      {n.provider}{n.is_active ? "" : " · inactive"}
                    </div>
                  </div>
                  <span className="num ml-auto text-xs font-bold text-ash">{n.calls_today} today</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {creating && <CreateJobModal onClose={() => setCreating(false)} />}
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
          : "border border-edge/70 bg-panel shadow-[var(--shadow-card)]",
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cx("flex size-11 items-center justify-center rounded-2xl", featured ? "bg-mint text-forest" : badge)}>
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
            <path d={line} fill="none" stroke="var(--color-chart-answered)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {at !== null && (
            <>
              <span aria-hidden className="absolute bottom-0 top-0 w-px bg-signal/30" style={{ left: `${(at / 23) * 100}%` }} />
              <span
                aria-hidden
                className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-forest shadow"
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

/** Outcome shares around the answer rate. */
function Donut({
  parts,
  total,
  percent,
}: {
  parts: { value: number; color: string }[];
  total: number;
  percent: number;
}) {
  const r = 70;
  const length = 2 * Math.PI * r;
  const shown = parts.filter((p) => p.value > 0);
  let offset = 0;

  return (
    <svg viewBox="0 0 180 180" className="size-48" role="img" aria-label={`${percent} percent answered`}>
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
      <text x="90" y="90" textAnchor="middle" fontSize="36" fontWeight="800" fill="var(--color-chalk)">{percent}%</text>
      <text x="90" y="112" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-ash-dim)">answered</text>
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
