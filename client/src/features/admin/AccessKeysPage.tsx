/**
 * Issuing console access.
 *
 * This screen exists because the alternative was a Django shell, which is not
 * something an office administrator can be asked to run. It is written for
 * somebody who does not know what an API key is, so it says "access key",
 * explains what each role can do in plain terms, and never shows a raw
 * identifier where a name would do.
 *
 * The one hard constraint shapes the whole design: the key is shown **once**.
 * Only its hash is stored, so nothing can reproduce it afterwards. The reveal
 * is therefore a blocking step with an explicit acknowledgement rather than a
 * toast that can be missed — a key lost at this moment costs a new key and a
 * revocation, and the person it was meant for is left waiting.
 */

import { useState } from "react";

import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  useAccessKeys,
  useCreateAccessKey,
  useRevokeAccessKey,
  type AccessKey,
  type CreatedAccessKey,
} from "@/lib/queries/resources";
import { useSession } from "@/lib/session";
import type { Role } from "@/types/domain";

/**
 * What each role means to the person choosing it.
 *
 * Deliberately phrased as consequences rather than capability names: an office
 * administrator picking access for a colleague needs to know "can they start
 * calls going out", not whether they hold `campaign.control`.
 */
const ROLES: { value: Role; label: string; blurb: string }[] = [
  {
    value: "operator",
    label: "Operator",
    blurb: "Runs campaigns day to day. Can start and stop calling, and edit contact lists. Cannot change call scripts.",
  },
  {
    value: "analyst",
    label: "Analyst",
    blurb: "Can see everything and change nothing. Safest choice for reporting or for someone new.",
  },
  {
    value: "compliance",
    label: "Compliance",
    blurb: "Can stop a campaign and add numbers to the do-not-call list, but cannot start calling or edit a campaign.",
  },
  {
    value: "admin",
    label: "Administrator",
    blurb: "Everything an operator can do, plus editing call scripts and managing settings.",
  },
  {
    value: "owner",
    label: "Owner",
    blurb: "Full control, including issuing and revoking access keys like this one.",
  },
];

export function AccessKeysPage() {
  const { capabilities } = useSession();
  const { data, isLoading, error, refetch } = useAccessKeys();
  const create = useCreateAccessKey();
  const revoke = useRevokeAccessKey();

  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [issued, setIssued] = useState<CreatedAccessKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<AccessKey | null>(null);

  const mayManage = capabilities.has("org.manage");
  const rows = data?.results ?? [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const key = await create.mutateAsync({ name: name.trim(), role });
    setIssued(key);
    setCopied(false);
    setName("");
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access is refused outside a secure context. The key is on
      // screen and selectable, so this is recoverable — say so rather than
      // failing silently and leaving them unsure whether it copied.
      setCopied(false);
    }
  }

  if (!mayManage) {
    return (
      <EmptyState
        title="You cannot issue access keys"
        description="Only an owner can create or revoke access for this organisation. Ask whoever set up your account."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">
          Access keys
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ash">
          Each person who signs in to this console uses their own access key.
          Issue one per person, never a shared one — a shared key cannot be
          taken away from one person without locking out everybody else.
        </p>
      </header>

      {/* --- the reveal, shown once ------------------------------------ */}
      {issued && (
        <Panel className="border-live-bright/50 bg-live-bright/5">
          <div className="space-y-4">
            <div>
              <h2 className="display text-base font-semibold text-chalk">
                Key for {issued.name}
              </h2>
              <p className="mt-1 text-sm text-ash">
                Copy this now and send it to them. It cannot be shown again —
                if it is lost you will have to revoke this key and issue a new
                one.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                className="flex-1 overflow-x-auto rounded border border-live-bright/30 bg-ink px-3 py-2 font-mono text-sm text-live-bright"
                data-testid="issued-key"
              >
                {issued.secret}
              </code>
              <Button type="button" onClick={() => copy(issued.secret)}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIssued(null);
                  setCopied(false);
                }}
              >
                I have saved it
              </Button>
              {!copied && (
                <span className="text-xs text-amber">
                  Not copied yet.
                </span>
              )}
            </div>
          </div>
        </Panel>
      )}

      {/* --- issue ----------------------------------------------------- */}
      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <h2 className="display text-base font-semibold text-chalk">
            Give someone access
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
                Who is this for
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jane, reception desk"
                required
                maxLength={80}
                className="w-full rounded border border-steel bg-ink px-3 py-2 text-sm text-chalk placeholder:text-ash/60 focus:border-live-bright focus:outline-none"
              />
              <span className="mt-1 block text-xs text-ash">
                A name you will recognise later, so you know whose access to
                remove when they leave.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
                What they can do
              </span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full rounded border border-steel bg-ink px-3 py-2 text-sm text-chalk focus:border-live-bright focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ash">
                {ROLES.find((r) => r.value === role)?.blurb}
              </span>
            </label>
          </div>

          {create.error && (
            <p className="text-sm text-rust">{create.error.message}</p>
          )}

          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? "Creating…" : "Create access key"}
          </Button>
        </form>
      </Panel>

      {/* --- existing -------------------------------------------------- */}
      <Panel>
        <h2 className="display mb-4 text-base font-semibold text-chalk">
          Who has access
        </h2>

        {isLoading && <TableSkeleton rows={3} />}
        {error && <ErrorState error={error} onRetry={refetch} />}

        {!isLoading && !error && rows.length === 0 && (
          <EmptyState
            title="Nobody has been given access yet"
            description="Create a key above and send it to the person who needs it."
          />
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-steel text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Access</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Last used</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((key) => (
                  <tr key={key.id} className="border-b border-steel/50">
                    <td className="py-2 pr-4 text-chalk">
                      {key.name}
                      <span className="ml-2 font-mono text-xs text-ash">
                        {key.prefix}…
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-ash">
                      {ROLES.find((r) => r.value === key.role)?.label ?? key.role}
                    </td>
                    <td className="py-2 pr-4 text-ash">
                      {formatDateTime(key.created_at)}
                    </td>
                    <td className="py-2 pr-4 text-ash">
                      {/* "Never" is the useful signal here: a key issued days
                          ago and never used usually means it never arrived. */}
                      {key.last_used_at ? formatDateTime(key.last_used_at) : "Never"}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={cx(
                          "rounded border px-2 py-0.5 text-xs",
                          key.revoked_at
                            ? "border-rust/40 text-rust"
                            : "border-live-bright/40 text-live-bright",
                        )}
                      >
                        {key.revoked_at ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {!key.revoked_at && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setConfirmRevoke(key)}
                        >
                          Remove access
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* --- revoke confirmation --------------------------------------- */}
      {confirmRevoke && (
        <Panel className="border-rust/50 bg-rust/5">
          <div className="space-y-3">
            <h2 className="display text-base font-semibold text-chalk">
              Remove access for {confirmRevoke.name}?
            </h2>
            <p className="text-sm text-ash">
              They will be signed out and their key will stop working
              immediately. This cannot be undone — you would have to issue a new
              key. Any campaigns already running are not affected.
            </p>
            {revoke.error && (
              <p className="text-sm text-rust">{revoke.error.message}</p>
            )}
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={async () => {
                  await revoke.mutateAsync(confirmRevoke.id);
                  setConfirmRevoke(null);
                }}
                disabled={revoke.isPending}
              >
                {revoke.isPending ? "Removing…" : "Remove access"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmRevoke(null)}
              >
                Keep it
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
