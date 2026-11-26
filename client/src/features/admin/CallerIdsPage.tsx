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

import { useState, type ReactNode } from "react";

import { PlusIcon } from "@/components/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Panel,
  PanelHeader,
  Select,
  Stat,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { formatCount, formatDateTime } from "@/lib/format";
import { useCallerIds, useCreateCallerId, useUpdateCallerId } from "@/lib/queries/resources";
import { useCan, useSession } from "@/lib/session";
import type { CallerID } from "@/types/domain";

const ATTESTATION: Record<string, { tone: string; means: string }> = {
  A: {
    tone: "bg-live text-live-bright",
    means: "The carrier knows you and knows you may use this number.",
  },
  B: {
    tone: "bg-warn-soft text-amber",
    means: "The carrier knows you but cannot vouch for the number.",
  },
  C: {
    tone: "bg-bad-soft text-rust",
    means: "Unregistered. Expect blocking or a spam label.",
  },
};

export function CallerIdsPage() {
  const { data, isLoading, error, refetch } = useCallerIds();
  const rows = data?.results ?? [];

  const belowA = rows.filter((c) => c.attestation !== "A").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caller IDs"
        subtitle="Attestation is assigned by your carrier, not by this platform. No setting here can raise it — the only path is registration with the carrier."
      />

      <AddNumberForm />

      {rows.length > 0 && (
        <div className="stagger grid gap-4 sm:grid-cols-3">
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

      {isLoading && (
        <Panel className="overflow-hidden"><TableSkeleton /></Panel>
      )}
      {data && rows.length === 0 && (
        <EmptyState
          title="No caller IDs"
          description="Add a number you own at your carrier using the form above."
        />
      )}

      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((caller) => (
          <CallerCard key={caller.id} caller={caller} />
        ))}
      </div>

      <p className="text-sm text-ash-dim">
        Daily caps and rest periods help you spread volume across numbers.
        Review them alongside answer rate.
      </p>
    </div>
  );
}

function CallerCard({ caller }: { caller: CallerID }) {
  const update = useUpdateCallerId();
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(String(caller.daily_call_cap));

  const att = ATTESTATION[caller.attestation] ?? ATTESTATION.C!;
  const resting =
    caller.rested_until !== null && new Date(caller.rested_until) > new Date();

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-edge bg-void p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-live px-3 py-1 text-xs font-bold capitalize text-live-bright">
            {caller.provider}
          </span>
          {!caller.is_active && (
            <span className="flex items-center gap-2 text-xs font-bold text-ash">
              <span aria-hidden className="size-2 rounded-full bg-edge-bright" />
              inactive
            </span>
          )}
        </div>
        <div className="num display mt-5 break-all text-2xl">{caller.phone_e164}</div>
        {caller.friendly_name && (
          <div className="mt-1 text-sm font-semibold text-ash">{caller.friendly_name}</div>
        )}
      </div>

      <div className="divide-y divide-edge px-5">
        <div className="py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cx("rounded-full px-3 py-1 text-xs font-extrabold", att.tone)}
              title={att.means}
            >
              signs {caller.attestation}
            </span>
            {caller.branded_calling_enrolled && <Badge tone="info">branded</Badge>}
          </div>
          <p className="mt-1.5 text-xs font-medium text-ash-dim">{att.means}</p>
        </div>

        {resting && (
          <p className="py-3 text-xs font-semibold text-amber">
            resting until {formatDateTime(caller.rested_until)}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 py-3">
          <span className="num text-sm font-bold text-chalk">
            {formatCount(caller.calls_today)} today
            {caller.daily_call_cap > 0 && ` / ${formatCount(caller.daily_call_cap)}`}
          </span>
          <Button dense variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? "Close" : "Adjust"}
          </Button>
        </div>

        {editing && (
          <div className="flex flex-wrap items-end gap-2 py-3.5">
            <label className="eyebrow w-full">
              Daily cap (0 = none)
              <Input
                type="number"
                min="0"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                className="num mt-1"
              />
            </label>

            <Button
              dense
              loading={update.isPending}
              onClick={() =>
                update.mutate({ id: caller.id, daily_call_cap: Number(cap) })
              }
            >
              Save
            </Button>

            <Button
              dense
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
                dense
                variant="ghost"
                onClick={() => update.mutate({ id: caller.id, rested_until: null })}
              >
                End rest
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Accepts "(213) 527-1071" as readily as "+12135271071". */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (!raw.trim().startsWith("+") && digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function AddNumberForm() {
  const mayManage = useCan("org.manage");
  const create = useCreateCallerId();
  const [phone, setPhone] = useState("");
  const [provider, setProvider] = useState("telnyx");

  if (!mayManage) {
    return <p className="text-sm text-ash">Only an owner can add numbers.</p>;
  }

  return (
    <Panel className="p-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { phone_e164: toE164(phone), provider },
            { onSuccess: () => setPhone("") },
          );
        }}
      >
        <div className="w-full sm:w-64">
          <Field label="Phone number" htmlFor="phone">
            <Input id="phone" type="tel" value={phone} placeholder="+1 213 555 0100"
              onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div className="w-full sm:w-44">
          <Field label="Carrier" htmlFor="carrier">
            <Select id="carrier" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="telnyx">Telnyx</option>
              <option value="twilio">Twilio</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" variant="primary" loading={create.isPending} disabled={!toE164(phone)}>
          <PlusIcon className="size-4" /> Add number
        </Button>
      </form>
      {create.error && <p role="alert" className="mt-2 text-sm text-rust">{create.error.message}</p>}
    </Panel>
  );
}

// --- settings ---------------------------------------------------------

export function SettingsPage() {
  const { me } = useSession();

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Settings" />

      <Panel>
        <PanelHeader title="This session" />
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
                <span className="num">{formatCount(me.ceilings.max_contacts)}</span>
              </Row>
            </>
          )}
        </dl>
      </Panel>

      {me?.capabilities && me.capabilities.length > 0 && (
        <Panel className="p-5">
          <h2 className="display text-base text-chalk">What this role can do</h2>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {me.capabilities.map((cap) => (
              <li key={cap} className="num rounded-full bg-raised px-3 py-1 text-xs text-ash">
                {cap}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="p-5">
        <h2 className="display text-base text-chalk">Managing access</h2>
        <p className="mt-1.5 text-sm text-ash">
          Contact your administrator to issue, rotate or revoke a key, or to
          change what a teammate can do.
        </p>
      </Panel>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-5 py-3.5 sm:grid-cols-[14rem_1fr] sm:gap-3">
      <dt className="text-ash">{label}</dt>
      <dd className="font-medium text-chalk">{children}</dd>
    </div>
  );
}
