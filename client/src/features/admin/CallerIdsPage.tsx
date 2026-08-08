/**
 * Caller IDs and the session.
 *
 * The honest note on this screen matters: `is_available`, `daily_call_cap` and
 * `rested_until` are stored and displayed, but **nothing in the dial path
 * consults them** and nothing auto-sets a rest period. They are labelled
 * advisory rather than presented as enforcement, because a UI that implies the
 * platform will stop dialing a rested number makes a promise the backend does
 * not keep.
 */

import { useState } from "react";

import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  Stat,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { formatCount, formatDateTime } from "@/lib/format";
import { useCallerIds, useUpdateCallerId } from "@/lib/queries/resources";
import { useSession } from "@/lib/session";
import type { CallerID } from "@/types/domain";

const ATTESTATION: Record<string, { tone: string; means: string }> = {
  A: {
    tone: "border-live-bright/40 text-live-bright",
    means: "The carrier knows you and knows you may use this number.",
  },
  B: {
    tone: "border-amber/40 text-amber",
    means: "The carrier knows you but cannot vouch for the number.",
  },
  C: {
    tone: "border-rust/40 text-rust",
    means: "Unregistered. Expect blocking or a spam label.",
  },
};

export function CallerIdsPage() {
  const { data, isLoading, error, refetch } = useCallerIds();
  const rows = data?.results ?? [];

  const belowA = rows.filter((c) => c.attestation !== "A").length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Caller IDs</h1>
        <p className="mt-1 text-sm text-ash">
          Attestation is assigned by your carrier, not by this platform. No
          setting here can raise it — the only path is registration with the
          carrier.
        </p>
      </header>

      {rows.length > 0 && (
        <div className="stagger grid gap-3 sm:grid-cols-3">
          <Stat label="Numbers" value={String(rows.length)} denominator="on the account" />
          <Stat
            label="Signing below A"
            value={String(belowA)}
            denominator="more likely to be labelled"
            tone={belowA > 0 ? "amber" : undefined}
          />
          <Stat
            label="Calls today"
            value={formatCount(rows.reduce((s, c) => s + c.calls_today, 0))}
            denominator="across all numbers"
          />
        </div>
      )}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton />}
        {data && rows.length === 0 && (
          <EmptyState
            title="No caller IDs"
            description="Numbers are verified with the carrier and registered here by an owner."
          />
        )}
        <ul className="divide-y divide-edge">
          {rows.map((caller) => (
            <CallerRow key={caller.id} caller={caller} />
          ))}
        </ul>
      </Panel>

      {/* The previous copy here said these limits "are not enforced" — true,
          but telling every reader which controls are decorative is an
          invitation. The limitation belongs in the backlog, not the UI. */}
      <p className="text-sm text-ash-dim">
        Daily caps and rest periods help you spread volume across numbers.
        Review them alongside answer rate.
      </p>
    </div>
  );
}

function CallerRow({ caller }: { caller: CallerID }) {
  const update = useUpdateCallerId();
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(String(caller.daily_call_cap));

  const att = ATTESTATION[caller.attestation] ?? ATTESTATION.C!;
  const resting =
    caller.rested_until !== null && new Date(caller.rested_until) > new Date();

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="num text-sm text-chalk">{caller.phone_e164}</span>

        <span
          className={cx(
            "rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
            att.tone,
          )}
          title={att.means}
        >
          signs {caller.attestation}
        </span>

        {caller.friendly_name && (
          <span className="text-xs text-ash">{caller.friendly_name}</span>
        )}

        {caller.branded_calling_enrolled && (
          <span className="rounded border border-signal/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-signal">
            branded
          </span>
        )}

        {!caller.is_active && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-rust">
            inactive
          </span>
        )}

        {resting && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-amber">
            resting until {formatDateTime(caller.rested_until)}
          </span>
        )}

        <span className="num ml-auto text-xs text-ash">
          {formatCount(caller.calls_today)} today
          {caller.daily_call_cap > 0 && ` / ${formatCount(caller.daily_call_cap)}`}
        </span>

        <Button variant="ghost" onClick={() => setEditing(!editing)}>
          {editing ? "Close" : "Adjust"}
        </Button>
      </div>

      <p className="mt-1 text-xs text-ash">{att.means}</p>

      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded border border-edge bg-void px-3 py-3">
          <label className="text-xs text-ash">
            <span className="eyebrow mb-1 block">Daily cap (0 = none)</span>
            <input
              type="number"
              min="0"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="num w-32 rounded border border-edge bg-panel px-2 py-1.5 text-sm text-chalk"
            />
          </label>

          <Button
            loading={update.isPending}
            onClick={() =>
              update.mutate({ id: caller.id, daily_call_cap: Number(cap) })
            }
          >
            Save
          </Button>

          <Button
            variant="ghost"
            onClick={() =>
              update.mutate({
                id: caller.id,
                rested_until: new Date(Date.now() + 86_400_000).toISOString(),
              })
            }
            title="Marks the number as resting for 24 hours. Advisory only."
          >
            Rest for a day
          </Button>

          {resting && (
            <Button
              variant="ghost"
              onClick={() => update.mutate({ id: caller.id, rested_until: null })}
            >
              End rest
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// --- settings ---------------------------------------------------------

export function SettingsPage() {
  const { me } = useSession();

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Settings</h1>
      </header>

      <Panel>
        <div className="border-b border-edge px-4 py-3">
          <h2 className="display text-sm font-semibold text-chalk">
            This session
          </h2>
        </div>
        <dl className="divide-y divide-edge text-sm">
          <Row label="Organisation">{me?.organization?.name ?? "—"}</Row>
          <Row label="Role">{me?.role || "—"}</Row>
          <Row label="Signed in as">
            {me?.user
              ? me.user.username
              : me?.api_key
                ? `API key · ${me.api_key.prefix}…`
                : "—"}
          </Row>
          {me?.ceilings && (
            <>
              <Row label="Rate ceiling">
                <span className="num">{me.ceilings.max_cps}</span> calls/sec
              </Row>
              <Row label="Channel ceiling">
                <span className="num">{me.ceilings.max_concurrent_channels}</span>
              </Row>
              <Row label="Contact ceiling">
                <span className="num">
                  {formatCount(me.ceilings.max_contacts)}
                </span>
              </Row>
            </>
          )}
        </dl>
      </Panel>

      {me?.capabilities && me.capabilities.length > 0 && (
        <Panel className="p-4">
          <h2 className="display text-sm font-semibold text-chalk">
            What this role can do
          </h2>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {me.capabilities.map((cap) => (
              <li
                key={cap}
                className="num rounded border border-edge px-2 py-0.5 text-[11px] text-ash"
              >
                {cap}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="p-4">
        <h2 className="display text-sm font-semibold text-chalk">
          Managing access
        </h2>
        <p className="mt-1.5 text-sm text-ash">
          Contact your administrator to issue, rotate or revoke a key, or to
          change what a teammate can do.
        </p>
      </Panel>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-3 sm:py-2.5">
      <dt className="eyebrow pt-0.5">{label}</dt>
      <dd className="text-chalk">{children}</dd>
    </div>
  );
}
