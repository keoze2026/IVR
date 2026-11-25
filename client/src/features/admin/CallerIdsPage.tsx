/**
 * Numbers you call from, and the account settings.
 *
 * The trust rating (A, B or C) is assigned by the carrier and cannot be changed
 * here.
 */

import { useState, type ReactNode } from "react";

import { PlusIcon } from "@/components/icons";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { useCallerIds, useCreateCallerId } from "@/lib/queries/resources";
import { useCan, useSession } from "@/lib/session";

const TRUST: Record<string, { tone: string; means: string }> = {
  A: { tone: "bg-live text-live-bright", means: "Verified by your carrier" },
  B: { tone: "bg-[#fdf1dc] text-amber", means: "Partly verified" },
  C: { tone: "bg-[#fdeaea] text-rust", means: "Not registered: may be blocked or marked as spam" },
};

export function CallerIdsPage() {
  const { data, isLoading, error, refetch } = useCallerIds();
  const rows = data?.results ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Numbers" subtitle="The numbers your calls come from." />

      <AddNumberForm />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {isLoading && (
        <Panel className="overflow-hidden"><TableSkeleton /></Panel>
      )}
      {data && rows.length === 0 && (
        <EmptyState title="No numbers yet" description="Add a number you own at your carrier." />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((n) => {
          const trust = TRUST[n.attestation] ?? TRUST.C!;
          return (
            <Panel key={n.id} className="overflow-hidden">
              <div className="surface-forest p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-bold capitalize text-white">
                    {n.provider}
                  </span>
                  <span className="flex items-center gap-2 text-xs font-bold text-white/80">
                    <span aria-hidden className={cx("size-2 rounded-full", n.is_active ? "bg-mint" : "bg-white/35")} />
                    {n.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="num display mt-5 break-all text-2xl">{n.phone_e164}</div>
                <div className="mt-1 text-sm font-semibold text-white/65">{n.friendly_name || "Caller number"}</div>
              </div>
              <dl className="divide-y divide-edge px-5">
                <div className="flex items-center justify-between py-3.5">
                  <dt className="text-sm font-semibold text-ash">Calls today</dt>
                  <dd className="num display text-xl text-chalk">{n.calls_today}</dd>
                </div>
                <div className="py-3.5">
                  <dt className="flex items-center justify-between text-sm font-semibold text-ash">
                    Trust rating
                    <span className={cx("rounded-full px-3 py-1 text-xs font-extrabold", trust.tone)}>{n.attestation}</span>
                  </dt>
                  <dd className="mt-1 text-xs font-medium text-ash-dim">{trust.means}</dd>
                </div>
              </dl>
            </Panel>
          );
        })}
      </div>
    </div>
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
      <PageHeader title="Settings" subtitle="Ask your administrator to change access or limits." />

      <Panel>
        <dl className="divide-y divide-edge text-sm">
          <Row label="Organisation">{me?.organization?.name ?? "—"}</Row>
          <Row label="Role"><span className="capitalize">{me?.role || "—"}</span></Row>
          <Row label="Signed in as">
            {me?.user ? me.user.username : me?.api_key ? `API key ${me.api_key.prefix}…` : "—"}
          </Row>
          {me?.ceilings && (
            <>
              <Row label="Calls at the same time">
                <span className="num">{me.ceilings.max_concurrent_channels}</span>
              </Row>
              <Row label="New calls per second">
                <span className="num">{me.ceilings.max_cps}</span>
              </Row>
            </>
          )}
        </dl>
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
