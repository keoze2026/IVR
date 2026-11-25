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

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton />}
        {data && rows.length === 0 && (
          <div className="p-6">
            <EmptyState title="No numbers yet" description="Add a number you own at your carrier." />
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Carrier</th>
                  <th>Trust rating</th>
                  <th>Calls today</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => {
                  const trust = TRUST[n.attestation] ?? TRUST.C!;
                  return (
                    <tr key={n.id}>
                      <td>
                        <div className="num font-medium text-chalk">{n.phone_e164}</div>
                        {n.friendly_name && <div className="text-xs text-ash-dim">{n.friendly_name}</div>}
                      </td>
                      <td className="capitalize">{n.provider}</td>
                      <td>
                        <span className={cx("rounded-full px-2.5 py-1 text-xs font-medium", trust.tone)}>
                          {n.attestation}
                        </span>
                        <span className="ml-2 text-xs text-ash-dim">{trust.means}</span>
                      </td>
                      <td className="num">{n.calls_today}</td>
                      <td>{n.is_active ? "Active" : "Inactive"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
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
