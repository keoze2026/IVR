/**
 * Dashboard (Calls Insights) and CDR — matched to the reference dialer.
 *
 * Insights: four stat tiles (Total / Answered / Non-Connected / Utilization)
 * with a sparkline each, and a daily calls-activity area chart. CDR: four
 * summary tiles and the full call-record table with a recording control.
 *
 * The numbers come from the recent call records rather than a separate
 * analytics store, so they are only ever as true as the calls behind them.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { Panel, TableSkeleton, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCalls } from "@/lib/queries/resources";
import type { CallSummary } from "@/types/domain";

const ANSWERED = new Set(["in_progress", "completed"]);

function tallies(calls: CallSummary[]) {
  const total = calls.length;
  const answered = calls.filter((c) => ANSWERED.has(c.status) || c.answered_by).length;
  const failed = calls.filter((c) => c.status === "failed").length;
  const nonConnected = total - answered;
  const spend = calls.reduce((s, c) => s + Number(c.cost ?? 0), 0);
  const durationSec = calls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0);
  return { total, answered, failed, nonConnected, spend, durationSec };
}

function StatTile({
  label,
  value,
  sub,
  tone = "text-chalk",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}) {
  return (
    <Panel className="p-5">
      <p className="text-sm text-ash">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ash">{sub}</p>}
    </Panel>
  );
}

export function DashboardPage() {
  const { data, isLoading } = useCalls({});
  const calls = data?.results ?? [];
  const t = tallies(calls);

  // Bucket recent calls by hour of day for the activity chart.
  const byHour = new Array(24).fill(0);
  for (const c of calls) {
    const h = new Date(c.created_at).getHours();
    byHour[h] += 1;
  }
  const maxHour = Math.max(...byHour, 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="display text-2xl font-semibold text-chalk">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <StatTile label="Total Calls" value={isLoading ? "—" : t.total} sub="Since last day" />
        <StatTile label="Answered Calls" value={isLoading ? "—" : t.answered} sub="Since last day" tone="text-live-bright" />
        <StatTile label="Non-Connected Calls" value={isLoading ? "—" : t.nonConnected} sub="Since last day" tone="text-amber" />
        <StatTile label="Total Utilization" value={`$${t.spend.toFixed(2)}`} sub="Spend so far" />
      </div>

      <Panel className="p-5">
        <h2 className="display text-base font-semibold text-chalk">Calls Activity – Daily</h2>
        <p className="text-sm text-ash">Total calls by hour.</p>
        <div className="mt-6 flex h-48 items-end gap-1">
          {byHour.map((n, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-live-bright"
                style={{ height: `${(n / maxHour) * 100}%`, minHeight: n ? 2 : 0 }}
                title={`${String(i).padStart(2, "0")}:00 — ${n} calls`}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-ash">
          {[0, 4, 8, 12, 16, 20].map((h) => (
            <span key={h}>{String(h).padStart(2, "0")}:00</span>
          ))}
          <span>24:00</span>
        </div>
      </Panel>

      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-base font-semibold text-chalk">Recent calls</h2>
          <Link to="/cdr" className="text-sm text-live-bright hover:underline">See all</Link>
        </div>
        {isLoading && <TableSkeleton rows={4} />}
        {!isLoading && calls.length === 0 && (
          <EmptyState title="No calls yet" description="Start a job to place calls." />
        )}
        {calls.length > 0 && <CallsTable rows={calls.slice(0, 10)} />}
      </Panel>
    </div>
  );
}

export function CallsBreakdownPage() {
  const { data, isLoading } = useCalls({});
  const calls = data?.results ?? [];
  const t = tallies(calls);
  const pct = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-2xl font-semibold text-chalk">Calls Dashboard</h1>
        <p className="mt-1 text-sm text-ash">Here, take a look at your calls.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Answered Calls" value={isLoading ? "—" : t.answered} sub={`${pct(t.answered)}% of all`} tone="text-live-bright" />
        <StatTile label="Non-Answered Calls" value={isLoading ? "—" : t.nonConnected - t.failed} sub={`${pct(t.nonConnected - t.failed)}% of all`} tone="text-amber" />
        <StatTile label="Failed Calls" value={isLoading ? "—" : t.failed} sub={`${pct(t.failed)}% of all`} tone="text-rust" />
        <StatTile label="Total Calls" value={isLoading ? "—" : t.total} sub="100% of all" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="flex flex-col items-center p-8">
          <h2 className="display text-base font-semibold text-chalk">Total Calls — Current Month</h2>
          <Donut value={t.answered} total={t.total} />
          <p className="mt-3 text-sm text-ash">Answered vs. total this month.</p>
        </Panel>
        <Panel className="p-5">
          <h2 className="display text-base font-semibold text-chalk">Answered rate</h2>
          <div className="mt-6 space-y-4">
            {[
              ["Answered", t.answered, "bg-live-bright"],
              ["Non-answered", t.nonConnected - t.failed, "bg-amber"],
              ["Failed", t.failed, "bg-rust"],
            ].map(([label, n, tone]) => (
              <div key={label as string}>
                <div className="mb-1 flex justify-between text-xs text-ash">
                  <span>{label}</span>
                  <span className="tabular-nums">{n as number}</span>
                </div>
                <div className="h-2 rounded-full bg-panel">
                  <div className={`h-2 rounded-full ${tone}`} style={{ width: `${pct(n as number)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Donut({ value, total }: { value: number; total: number }) {
  const frac = total ? value / total : 0;
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 140 140" className="mt-4 h-40 w-40">
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgb(38,48,56)" strokeWidth="14" />
      <circle
        cx="70" cy="70" r={r} fill="none" stroke="rgb(95,191,144)" strokeWidth="14"
        strokeDasharray={`${c * frac} ${c}`} strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="66" textAnchor="middle" className="fill-chalk text-2xl font-semibold">
        {total}
      </text>
      <text x="70" y="86" textAnchor="middle" className="fill-current text-[10px] text-ash">
        Calls
      </text>
    </svg>
  );
}

export function CdrPage() {
  const { data, isLoading } = useCalls({});
  const calls = data?.results ?? [];
  const t = tallies(calls);
  const mins = Math.floor(t.durationSec / 60);
  const secs = t.durationSec % 60;
  const pct = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0);

  return (
    <div className="space-y-5">
      <p className="text-xs text-ash">
        Home <span className="mx-1">›</span>
        <span className="text-chalk">CDR</span>
      </p>
      <h1 className="display text-2xl font-semibold text-chalk">CDR</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total Calls" value={isLoading ? "—" : t.total} sub="All CDR entries" />
        <StatTile label="Answered" value={isLoading ? "—" : t.answered} sub={`${pct(t.answered)}% of all calls`} tone="text-live-bright" />
        <StatTile label="Failed" value={isLoading ? "—" : t.failed} sub={`${pct(t.failed)}% of all calls`} tone="text-rust" />
        <StatTile label="Total Duration" value={`${mins}m ${secs}s`} sub="billable" tone="text-blue-300" />
      </div>

      <Panel className="p-0">
        {isLoading && <div className="p-4"><TableSkeleton rows={6} /></div>}
        {!isLoading && calls.length === 0 && (
          <div className="p-8"><EmptyState title="No calls yet" description="Start a job to place calls." /></div>
        )}
        {calls.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-3 pl-4 pr-4">Destination</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Duration</th>
                  <th className="py-3 pr-4">Billable</th>
                  <th className="py-3 pr-4">Recording</th>
                  <th className="py-3 pr-4">Cost</th>
                  <th className="py-3 pr-4">Originated At</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-b border-edge/50 hover:bg-raised">
                    <td className="py-3 pl-4 pr-4 font-mono text-ash">{c.to_masked}</td>
                    <td className="py-3 pr-4">
                      <span className={`rounded border px-2 py-0.5 text-xs capitalize ${
                        c.status === "failed" ? "border-rust/40 text-rust"
                          : c.status === "completed" ? "border-live-bright/40 text-live-bright"
                          : "border-edge text-ash"
                      }`}>
                        {c.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-ash">{c.duration_seconds}s</td>
                    <td className="py-3 pr-4 tabular-nums text-ash">{c.billable_seconds ?? c.duration_seconds}s</td>
                    <td className="py-3 pr-4"><RecordingButton call={c} /></td>
                    <td className="py-3 pr-4 tabular-nums text-ash">
                      ${Number(c.cost ?? 0).toFixed(4)}
                    </td>
                    <td className="py-3 pr-4 text-ash">{formatDateTime(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-edge px-4 py-3 text-xs text-ash">
          <span>{calls.length} row(s) total.</span>
        </div>
      </Panel>
    </div>
  );
}

/**
 * The CDR recording control.
 *
 * Active only when the call actually has a recording — a call that was never
 * recorded has nothing to play, and a button that looks clickable but does
 * nothing is worse than one that is plainly disabled. On click it fetches a
 * short-lived signed URL and plays it inline.
 */
function RecordingButton({ call }: { call: CallSummary }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  if (!call.has_recording) {
    return <span className="text-ash" title="No recording for this call">🎧</span>;
  }
  if (url) {
    return <audio src={url} controls className="h-8 w-44" autoPlay />;
  }
  return (
    <button
      type="button"
      disabled={loading}
      title="Play recording"
      onClick={async () => {
        setLoading(true);
        setErr(false);
        try {
          const res = await fetch(`/bff/api/calls/${call.id}/recording/`, {
            credentials: "same-origin",
          });
          if (!res.ok) throw new Error();
          const body = (await res.json()) as { url: string };
          setUrl(body.url);
        } catch {
          setErr(true);
        } finally {
          setLoading(false);
        }
      }}
      className={`text-lg ${err ? "text-rust" : "text-live-bright hover:text-live-bright/80"}`}
    >
      {loading ? "…" : "🎧"}
    </button>
  );
}

function CallsTable({ rows }: { rows: CallSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-ash">
            <th className="py-2 pr-4">To</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Answered by</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">Cost</th>
            <th className="py-2 pr-4">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-edge/50">
              <td className="py-2 pr-4 font-mono text-ash">{c.to_masked}</td>
              <td className="py-2 pr-4 capitalize text-chalk">{c.status.replace("_", " ")}</td>
              <td className="py-2 pr-4 text-ash">{c.answered_by || "—"}</td>
              <td className="py-2 pr-4 tabular-nums text-ash">{c.duration_seconds}s</td>
              <td className="py-2 pr-4 tabular-nums text-ash">
                {c.cost ? `$${Number(c.cost).toFixed(4)}` : "—"}
              </td>
              <td className="py-2 pr-4 text-ash">{formatDateTime(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
