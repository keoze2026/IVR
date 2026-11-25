/**
 * The people who can sign in to this organisation.
 *
 * This is the screen an office administrator uses most, so it does one thing
 * per step and says what will happen before it happens.
 *
 * The code is shown once, on creation, and never again — only its hash is
 * stored. That constraint is not an implementation detail to be hidden; it is
 * the single most important thing on the page, so the reveal stays until it is
 * acknowledged rather than passing by in a toast.
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
  useCreateEmployee,
  useEmployees,
  useResetEmployeeCode,
  useUpdateEmployee,
  type Employee,
  type IssuedEmployee,
} from "@/lib/queries/resources";
import { useSession } from "@/lib/session";
import type { Role } from "@/types/domain";

const ROLES: { value: Role; label: string; blurb: string }[] = [
  {
    value: "operator",
    label: "Operator",
    blurb: "Runs campaigns day to day: starts and stops calling, edits contact lists.",
  },
  {
    value: "analyst",
    label: "Analyst",
    blurb: "Can see everything and change nothing. Safest for reporting or someone new.",
  },
  {
    value: "compliance",
    label: "Compliance",
    blurb: "Can stop a campaign and add do-not-call numbers, but cannot start calling.",
  },
  {
    value: "admin",
    label: "Administrator",
    blurb: "Everything an operator can do, plus editing call scripts and settings.",
  },
  {
    value: "owner",
    label: "Owner",
    blurb: "Full control of this organisation, including managing people.",
  },
];

const EMPTY = { first_name: "", last_name: "", username: "", role: "operator" as Role };

/** The one-time reveal. It stays put, because a code missed here is a code lost. */
function CodeReveal({
  issued,
  onDone,
}: {
  issued: IssuedEmployee;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div role="status">
      <Panel accent className="space-y-4 p-5">
        <div>
          <h2 className="display text-base text-chalk">
            Access code for {issued.full_name}
          </h2>
          <p className="mt-1 text-sm text-ash">
            Send them their name{" "}
            <strong className="text-chalk">{issued.username}</strong> and this
            code. It cannot be shown again — if it is lost, issue a new one.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="rounded-xl bg-live px-5 py-3 text-center font-mono text-3xl tracking-[0.35em] text-live-bright">
            {issued.access_code}
          </code>
          <Button
            type="button"
            variant="primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `Name: ${issued.username}\nCode: ${issued.access_code}`,
                );
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy name and code"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
          <Button type="button" onClick={onDone}>
            I have sent it
          </Button>
          {!copied && <span className="text-sm text-amber">Not copied yet.</span>}
        </div>
      </Panel>
    </div>
  );
}

export function PeoplePage() {
  const { capabilities } = useSession();
  const { data, isLoading, error, refetch } = useEmployees();
  const create = useCreateEmployee();
  const reset = useResetEmployeeCode();
  const update = useUpdateEmployee();

  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<IssuedEmployee | null>(null);
  const [confirmReset, setConfirmReset] = useState<Employee | null>(null);

  const mayManage = capabilities.has("org.manage");
  const rows = data?.results ?? [];
  const active = rows.filter((p) => p.is_active).length;
  const show = (n: number) => (data ? String(n) : "—");

  if (!mayManage) {
    return (
      <EmptyState
        title="You cannot manage people"
        description="Only an owner can add or remove access. Ask whoever set up your account."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="People"
        subtitle="Everyone who signs in gets their own name and access code. One per person, never shared — a shared code cannot be taken away from one person without locking out everybody else."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" /> Add someone
          </Button>
        }
      />

      {issued && <CodeReveal issued={issued} onDone={() => setIssued(null)} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="People" value={show(data?.count ?? rows.length)} />
        <Stat label="Active" value={show(active)} tone="live" />
        <Stat label="Blocked" value={show(rows.length - active)} />
      </div>

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {update.error && <ErrorState error={update.error} />}

      <Panel className="overflow-hidden">
        <PanelHeader title="Who can sign in" />
        {isLoading && <TableSkeleton rows={3} />}
        {!isLoading && !error && rows.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="Nobody has been added yet"
              description="Add someone above and send them their name and code."
            />
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Signs in as</th>
                  <th>Can do</th>
                  <th>Last seen</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((person) => (
                  <tr key={person.id}>
                    <td className="font-medium !text-chalk">{person.full_name}</td>
                    <td className="font-mono">{person.username}</td>
                    <td>{ROLES.find((r) => r.value === person.role)?.label ?? person.role}</td>
                    <td>{person.last_seen_at ? formatDateTime(person.last_seen_at) : "Never"}</td>
                    <td>
                      <Badge tone={person.is_active ? "good" : "bad"}>
                        {person.is_active ? "Active" : "Blocked"}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <Button
                          dense
                          type="button"
                          onClick={() => setConfirmReset(person)}
                        >
                          New code
                        </Button>
                        <Button
                          dense
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            update.mutate({ id: person.id, is_active: !person.is_active })
                          }
                        >
                          {person.is_active ? "Block" : "Unblock"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {adding && (
        <Modal
          title="Add someone"
          onClose={() => setAdding(false)}
          closeOnEscape={false}
          closeOnBackdrop={false}
        >
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await create.mutateAsync(form);
              setIssued(result);
              setForm(EMPTY);
              setAdding(false);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" htmlFor="p-first">
                <Input
                  id="p-first"
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Last name" htmlFor="p-last">
                <Input
                  id="p-last"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </Field>
            </div>
            <Field
              label="Sign-in name"
              htmlFor="p-username"
              hint="What they type to sign in. Short and lower case is easiest."
            >
              <Input
                id="p-username"
                value={form.username}
                onChange={(e) =>
                  setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s+/g, "") })
                }
                placeholder="e.g. jane"
                required
              />
            </Field>
            <Field
              label="What they can do"
              htmlFor="p-role"
              hint={ROLES.find((r) => r.value === form.role)?.blurb}
            >
              <Select
                id="p-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
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
                disabled={!form.username || !form.first_name}
              >
                {create.isPending ? "Adding…" : "Add person and issue code"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {confirmReset && (
        <Modal
          title={`Issue a new code for ${confirmReset.full_name}?`}
          onClose={() => setConfirmReset(null)}
          closeOnEscape={false}
          closeOnBackdrop={false}
        >
          <div className="space-y-4">
            <p className="text-sm text-ash">
              Their current code stops working immediately, and they will need
              the new one to sign in again.
            </p>
            {reset.error && reset.variables === confirmReset.id && (
              <ErrorState error={reset.error} />
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
              <Button type="button" variant="ghost" onClick={() => setConfirmReset(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={reset.isPending}
                onClick={async () => {
                  const result = await reset.mutateAsync(confirmReset.id);
                  setIssued(result);
                  setConfirmReset(null);
                }}
              >
                {reset.isPending ? "Issuing…" : "Issue new code"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
