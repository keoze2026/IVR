/**
 * The people who can sign in to this organisation.
 *
 * This is the screen an office administrator uses most, so it does one thing
 * per step and says what will happen before it happens.
 *
 * The code is shown once, on creation, and never again — only its hash is
 * stored. That constraint is not an implementation detail to be hidden; it is
 * the single most important thing on the page, so the reveal blocks until it
 * is acknowledged rather than passing by in a toast.
 */

import { useState } from "react";

import { Button, EmptyState, ErrorState, Panel, TableSkeleton, cx } from "@/components/ui";
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

const inputClass =
  "w-full rounded border border-edge bg-void px-3 py-2 text-sm text-chalk placeholder:text-ash/60 focus:border-live-bright focus:outline-none";

/** The one-time reveal. Blocking, because a code missed here is a code lost. */
function CodeReveal({
  issued,
  onDone,
}: {
  issued: IssuedEmployee;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Panel className="border-live-bright/50 bg-panel">
      <div className="space-y-4">
        <div>
          <h2 className="display text-base font-semibold text-chalk">
            Access code for {issued.full_name}
          </h2>
          <p className="mt-1 text-sm text-ash">
            Send them their name{" "}
            <strong className="text-chalk">{issued.username}</strong> and this
            code. It cannot be shown again — if it is lost, issue a new one.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="rounded border border-live-bright/30 bg-void px-5 py-3 text-center font-mono text-3xl tracking-[0.35em] text-live-bright">
            {issued.access_code}
          </code>
          <Button
            type="button"
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

        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" onClick={onDone}>
            I have sent it
          </Button>
          {!copied && <span className="text-xs text-amber">Not copied yet.</span>}
        </div>
      </div>
    </Panel>
  );
}

export function PeoplePage() {
  const { capabilities } = useSession();
  const { data, isLoading, error, refetch } = useEmployees();
  const create = useCreateEmployee();
  const reset = useResetEmployeeCode();
  const update = useUpdateEmployee();

  const [form, setForm] = useState({ first_name: "", last_name: "", username: "", role: "operator" as Role });
  const [issued, setIssued] = useState<IssuedEmployee | null>(null);
  const [confirmReset, setConfirmReset] = useState<Employee | null>(null);

  const mayManage = capabilities.has("org.manage");
  const rows = data?.results ?? [];

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
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">People</h1>
        <p className="mt-1 max-w-2xl text-sm text-ash">
          Everyone who signs in gets their own name and access code. One per
          person, never shared — a shared code cannot be taken away from one
          person without locking out everybody else.
        </p>
      </header>

      {issued && <CodeReveal issued={issued} onDone={() => setIssued(null)} />}

      <Panel>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await create.mutateAsync(form);
            setIssued(result);
            setForm({ first_name: "", last_name: "", username: "", role: "operator" });
          }}
        >
          <h2 className="display text-base font-semibold text-chalk">Add someone</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
                First name
              </span>
              <input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                className={inputClass}
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
                Last name
              </span>
              <input
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
                Sign-in name
              </span>
              <input
                value={form.username}
                onChange={(e) =>
                  setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s+/g, "") })
                }
                placeholder="e.g. jane"
                className={inputClass}
                required
              />
              <span className="mt-1 block text-xs text-ash">
                What they type to sign in. Short and lower case is easiest.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
                What they can do
              </span>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className={inputClass}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ash">
                {ROLES.find((r) => r.value === form.role)?.blurb}
              </span>
            </label>
          </div>

          {create.error && <p className="text-sm text-rust">{create.error.message}</p>}

          <Button type="submit" disabled={create.isPending || !form.username || !form.first_name}>
            {create.isPending ? "Adding…" : "Add person and issue code"}
          </Button>
        </form>
      </Panel>

      <Panel>
        <h2 className="display mb-4 text-base font-semibold text-chalk">
          Who can sign in
        </h2>

        {isLoading && <TableSkeleton rows={3} />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {!isLoading && !error && rows.length === 0 && (
          <EmptyState
            title="Nobody has been added yet"
            description="Add someone above and send them their name and code."
          />
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Signs in as</th>
                  <th className="py-2 pr-4">Can do</th>
                  <th className="py-2 pr-4">Last seen</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((person) => (
                  <tr key={person.id} className="border-b border-edge/50">
                    <td className="py-2 pr-4 text-chalk">{person.full_name}</td>
                    <td className="py-2 pr-4 font-mono text-ash">{person.username}</td>
                    <td className="py-2 pr-4 text-ash">
                      {ROLES.find((r) => r.value === person.role)?.label ?? person.role}
                    </td>
                    <td className="py-2 pr-4 text-ash">
                      {person.last_seen_at ? formatDateTime(person.last_seen_at) : "Never"}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={cx(
                          "rounded border px-2 py-0.5 text-xs",
                          person.is_active
                            ? "border-live-bright/40 text-live-bright"
                            : "border-rust/40 text-rust",
                        )}
                      >
                        {person.is_active ? "Active" : "Blocked"}
                      </span>
                    </td>
                    <td className="space-x-2 py-2 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setConfirmReset(person)}
                      >
                        New code
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          update.mutate({ id: person.id, is_active: !person.is_active })
                        }
                      >
                        {person.is_active ? "Block" : "Unblock"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {confirmReset && (
        <Panel className="border-amber/50 bg-panel">
          <div className="space-y-3">
            <h2 className="display text-base font-semibold text-chalk">
              Issue a new code for {confirmReset.full_name}?
            </h2>
            <p className="text-sm text-ash">
              Their current code stops working immediately, and they will need
              the new one to sign in again.
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                disabled={reset.isPending}
                onClick={async () => {
                  const result = await reset.mutateAsync(confirmReset.id);
                  setIssued(result);
                  setConfirmReset(null);
                }}
              >
                {reset.isPending ? "Issuing…" : "Issue new code"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmReset(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
