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
 * therefore stays on screen until explicitly acknowledged, rather than being a
 * toast that can be missed — a key lost at this moment costs a new key and a
 * revocation, and the person it was meant for is left waiting.
 */

import { useState } from "react";

import { PlusIcon } from "@/components/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  PanelHeader,
  Select,
  Stat,
  TableSkeleton,
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

import { AccessTabs } from "./PeoplePage";

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
    blurb: "Starts and stops calling, and edits contact lists. Cannot change call scripts.",
  },
  {
    value: "analyst",
    label: "Analyst",
    blurb: "Can see everything and change nothing. Safest for someone new.",
  },
  {
    value: "compliance",
    label: "Compliance",
    blurb: "Can stop a campaign and add do-not-call numbers, but cannot start calling or edit a campaign.",
  },
  {
    value: "admin",
    label: "Administrator",
    blurb: "Everything an operator can do, plus editing call scripts and settings.",
  },
  {
    value: "owner",
    label: "Owner",
    blurb: "Full control, including issuing and revoking access keys.",
  },
];

export function AccessKeysPage() {
  const { capabilities } = useSession();
  const { data, isLoading, error, refetch } = useAccessKeys();
  const create = useCreateAccessKey();
  const revoke = useRevokeAccessKey();

  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<CreatedAccessKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<AccessKey | null>(null);

  const mayManage = capabilities.has("org.manage");
  const rows = data?.results ?? [];
  const live = rows.filter((k) => !k.revoked_at);
  const show = (n: number) => (data ? String(n) : "—");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const key = await create.mutateAsync({ name: name.trim(), role });
    setIssued(key);
    setCopied(false);
    setName("");
    setAdding(false);
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
      <PageHeader
        title="Access keys"
        subtitle="One key per person."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              create.reset();
              setAdding(true);
            }}
          >
            <PlusIcon className="size-4" /> New key
          </Button>
        }
      />

      <AccessTabs />

      {/* --- the reveal, shown once ------------------------------------ */}
      {issued && (
        <div role="status">
          <Panel accent className="space-y-4 p-5">
            <div>
              <h2 className="display text-base text-chalk">Key for {issued.name}</h2>
              <p className="mt-1 text-sm text-ash">
                Copy this now and send it to them. It is shown only once. If it is
                lost, revoke it and issue a new one.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                className="min-w-0 flex-1 select-all break-all rounded-xl bg-live px-4 py-3 font-mono text-sm text-live-bright"
                data-testid="issued-key"
              >
                {issued.secret}
              </code>
              <Button type="button" variant="primary" onClick={() => copy(issued.secret)}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
              <Button
                type="button"
                onClick={() => {
                  setIssued(null);
                  setCopied(false);
                }}
              >
                I have saved it
              </Button>
              {!copied && <span className="text-sm text-amber">Not copied yet.</span>}
            </div>
          </Panel>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Active keys" value={show(live.length)} tone="live" />
        {/* A key issued days ago and never used usually means it never arrived. */}
        <Stat label="Never used" value={show(live.filter((k) => !k.last_used_at).length)} />
        <Stat label="Revoked" value={show(rows.length - live.length)} />
      </div>

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <Panel className="overflow-hidden">
        <PanelHeader title="Who has access" />
        {isLoading && <TableSkeleton rows={3} />}

        {!isLoading && !error && rows.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="Nobody has been given access yet"
              description="Create a key and send it to the person who needs it."
            />
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <div className="font-medium text-chalk">{key.name}</div>
                      <div className="font-mono text-xs text-ash-dim">{key.prefix}…</div>
                    </td>
                    <td>{ROLES.find((r) => r.value === key.role)?.label ?? key.role}</td>
                    <td>{formatDateTime(key.created_at)}</td>
                    <td>{key.last_used_at ? formatDateTime(key.last_used_at) : "Never"}</td>
                    <td>
                      <Badge tone={key.revoked_at ? "bad" : "good"}>
                        {key.revoked_at ? "Revoked" : "Active"}
                      </Badge>
                    </td>
                    <td className="text-right">
                      {!key.revoked_at && (
                        <Button
                          dense
                          type="button"
                          variant="ghost"
                          className="hover:!text-rust"
                          aria-label={`Remove access for ${key.name}`}
                          onClick={() => {
                            revoke.reset();
                            setConfirmRevoke(key);
                          }}
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

      {/* --- issue ----------------------------------------------------- */}
      {adding && (
        <Modal title="New access key" onClose={() => setAdding(false)}>
          <form onSubmit={submit} className="space-y-4">
            <Field
              label="Who is this for"
              htmlFor="k-name"
              hint="Use a name you will recognise when removing access."
            >
              <Input
                id="k-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jane, reception desk"
                autoFocus
                required
                maxLength={80}
              />
            </Field>

            <Field
              label="Role"
              htmlFor="k-role"
              hint={ROLES.find((r) => r.value === role)?.blurb}
            >
              <Select id="k-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>

            {create.error && <ErrorState error={create.error} />}

            <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={create.isPending}
                disabled={!name.trim()}
              >
                Create access key
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* --- revoke confirmation --------------------------------------- */}
      {confirmRevoke && (
        <Modal
          title={`Remove access for ${confirmRevoke.name}?`}
          onClose={() => setConfirmRevoke(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-ash">
              They are signed out and their key stops working immediately. This
              cannot be undone. Running campaigns are not affected.
            </p>
            {revoke.error && <ErrorState error={revoke.error} />}
            <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
              <Button type="button" variant="ghost" onClick={() => setConfirmRevoke(null)}>
                Keep it
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={revoke.isPending}
                onClick={async () => {
                  await revoke.mutateAsync(confirmRevoke.id);
                  setConfirmRevoke(null);
                }}
              >
                Remove access
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
