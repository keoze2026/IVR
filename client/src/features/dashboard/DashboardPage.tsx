/**
 * Dashboard: how calling is going right now, at a glance.
 *
 * Built from the most recent call records, so the figures describe those calls
 * and are labelled that way.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { PhoneOutIcon, PlusIcon } from "@/components/icons";
import { Button, EmptyState, ErrorState, PageHeader, Panel, StatusPill, TableSkeleton, cx } from "@/components/ui";
import { RecordingButton, clock, tally } from "@/features/calls/shared";
import { CreateJobModal } from "@/features/jobs/CreateJobModal";
import { formatRelative } from "@/lib/format";
import { useCallerIds, useCalls } from "@/lib/queries/resources";
import type { CallSummary } from "@/types/domain";

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useCalls({}, { refetchInterval: 5000 });
  const numbers = useCallerIds();
  const calls = data?.results ?? [];
  const t = tally(calls);
  const [creating, setCreating] = useState(false);
  const show = (value: string | number) => (isLoading ? "—" : String(value));
  const rate = t.total ? Math.round((t.answered / t.total) * 100) : 0;

  return (
    <div className="space-y-6">
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

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Panel className="flex flex-col items-center justify-center p-5">
          <Ring percent={rate} />
          <p className="mt-3 text-sm text-ash">
            <span className="num">{t.answered}</span> of <span className="num">{t.total}</span> answered
          </p>
        </Panel>

        <Panel className="grid grid-cols-2 gap-y-6 p-6 md:grid-cols-4 md:divide-x md:divide-edge">
          <Figure label="Total calls" value={show(t.total)} />
          <Figure label="Not answered" value={show(t.missed)} />
          <Figure label="Average talk time" value={isLoading ? "—" : clock(t.average)} />
          <Figure label="Spend" value={isLoading ? "—" : `$${t.spend.toFixed(2)}`} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel className="p-6">
          <h2 className="display text-base text-chalk">Calls by hour</h2>
          <HourChart calls={calls} />
        </Panel>

        <Panel className="p-6">
          <h2 className="display text-base text-chalk">Outcomes</h2>
          <div className="mt-5 space-y-5">
            <Outcome label="Answered" count={t.answered} total={t.total} color="bg-chart-answered" />
            <Outcome label="Not answered" count={t.missed} total={t.total} color="bg-chart-missed" />
            <Outcome label="Failed" count={t.failed} total={t.total} color="bg-chart-failed" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel className="overflow-hidden">
          <CardHeader title="Recent calls" to="/cdr" link="View all" />
          {isLoading && <TableSkeleton rows={4} />}
          {!isLoading && calls.length === 0 && (
            <div className="p-6">
              <EmptyState title="No calls yet" description="Create a job to place your first call." />
            </div>
          )}
          <ul className="divide-y divide-edge">
            {calls.slice(0, 6).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                <span className="flex size-9 items-center justify-center rounded-full bg-live text-live-bright">
                  <PhoneOutIcon className="size-4" />
                </span>
                <div className="min-w-0">
                  <Link to={`/calls/${c.id}`} className="num block text-sm font-medium text-chalk hover:text-signal">
                    {c.to_masked}
                  </Link>
                  <span className="text-xs text-ash-dim">
                    {formatRelative(c.created_at)} · {clock(c.duration_seconds ?? 0)}
                  </span>
                </div>
                <span className="ml-auto"><StatusPill status={c.status} /></span>
                <span className="w-20 text-right"><RecordingButton call={c} /></span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="self-start overflow-hidden">
          <CardHeader title="Your numbers" to="/caller-ids" link="Manage" />
          {numbers.data?.results.length === 0 && (
            <p className="px-6 py-5 text-sm text-ash">Add a number to start calling.</p>
          )}
          <ul className="divide-y divide-edge">
            {(numbers.data?.results ?? []).slice(0, 6).map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-6 py-3.5">
                <span
                  aria-hidden
                  className={cx("size-2 rounded-full", n.is_active ? "bg-chart-answered" : "bg-edge-bright")}
                />
                <div className="min-w-0">
                  <div className="num text-sm font-medium text-chalk">{n.phone_e164}</div>
                  <div className="text-xs capitalize text-ash-dim">
                    {n.provider}{n.is_active ? "" : " · inactive"}
                  </div>
                </div>
                <span className="num ml-auto text-xs text-ash">{n.calls_today} today</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {creating && <CreateJobModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CardHeader({ title, to, link }: { title: string; to: string; link: string }) {
  return (
    <div className="flex items-center justify-between border-b border-edge px-6 py-4">
      <h2 className="display text-base text-chalk">{title}</h2>
      <Link to={to} className="text-sm font-medium text-signal hover:underline">{link}</Link>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-3 text-center">
      <span className="num text-4xl font-light text-chalk">{value}</span>
      <span className="mt-1 text-sm text-ash">{label}</span>
    </div>
  );
}

/** Share of calls answered. */
function Ring({ percent }: { percent: number }) {
  const r = 52;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 128 128" className="size-32" role="img" aria-label={`${percent} percent answered`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="10" />
      {percent > 0 && (
        <circle
          cx="64" cy="64" r={r} fill="none" stroke="var(--color-chart-answered)" strokeWidth="10"
          strokeLinecap="round" strokeDasharray={`${(percent / 100) * length} ${length}`}
          transform="rotate(-90 64 64)"
        />
      )}
      <text x="64" y="64" textAnchor="middle" fontSize="28" fontWeight="500" fill="var(--color-chalk)">
        {percent}%
      </text>
      <text x="64" y="84" textAnchor="middle" fontSize="11" fill="var(--color-ash-dim)">
        answered
      </text>
    </svg>
  );
}

function Outcome({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-ash">
          <span className={cx("size-2.5 rounded-full", color)} aria-hidden />
          {label}
        </span>
        <span className="num text-chalk">{count} <span className="text-ash-dim">({percent}%)</span></span>
      </div>
      <div className="h-2 rounded-full bg-raised">
        <div className={cx("h-2 rounded-full", color)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function HourChart({ calls }: { calls: CallSummary[] }) {
  const hours = new Array<number>(24).fill(0);
  for (const call of calls) {
    const hour = new Date(call.created_at).getHours();
    hours[hour] = (hours[hour] ?? 0) + 1;
  }
  const max = Math.max(...hours, 1);
  const [hover, setHover] = useState<number | null>(null);
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <div className="mt-2">
      <p className="num h-5 text-xs text-ash" aria-live="polite">
        {hover === null
          ? `Busiest hour: ${max > 0 && calls.length ? `${pad(hours.indexOf(max))} (${max})` : "none yet"}`
          : `${pad(hover)}: ${hours[hover]} ${hours[hover] === 1 ? "call" : "calls"}`}
      </p>
      <div className="mt-3 flex h-44 items-end gap-0.5 border-b border-edge" onMouseLeave={() => setHover(null)}>
        {hours.map((n, h) => (
          <button
            key={h}
            type="button"
            aria-label={`${pad(h)}: ${n} calls`}
            onMouseEnter={() => setHover(h)}
            onFocus={() => setHover(h)}
            className="flex h-full flex-1 items-end justify-center rounded-t hover:bg-void"
          >
            <span
              className="w-full max-w-5 rounded-t bg-chart-answered"
              style={{ height: n ? `max(4px, ${(n / max) * 100}%)` : 0 }}
            />
          </button>
        ))}
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px] text-ash-dim">
        {[0, 4, 8, 12, 16, 20, 23].map((h) => <span key={h}>{pad(h)}</span>)}
      </div>
    </div>
  );
}
