/**
 * Suppression, consent and calling hours.
 *
 * These three screens are the ones someone opens when a complaint lands, so
 * they are built around lookup first and browsing second.
 */

import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

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
  Textarea,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  useAddDnc,
  useBulkDnc,
  useCallingWindows,
  useConsentLookup,
  useConsentRecords,
  useDeleteDnc,
  useDncCheck,
  useDncEntries,
  useRecordConsent,
  useRevokeConsent,
  useSaveWindow,
} from "@/lib/queries/resources";
import { useCan } from "@/lib/session";
import type { ConsentRecord } from "@/types/domain";

const REASONS: Record<string, string> = {
  internal_dnc: "Internal do-not-call",
  ivr_opt_out: "Opted out on a call",
  federal_dnc: "Federal do-not-call",
  state_dnc: "State do-not-call",
  litigator: "Litigator",
  complaint: "Complaint",
  carrier_invalid: "Invalid number (carrier)",
};

const CONSENT_TYPES: Record<string, string> = {
  express_written: "Express written",
  express_oral: "Express oral",
  ebr: "Existing business relationship",
  transactional: "Transactional",
};

const SCOPES: Record<string, string> = {
  marketing: "Marketing",
  informational: "Informational",
};

const plain = (map: Record<string, string>, key: string) =>
  map[key] ?? key.replace(/_/g, " ");

// --- shared layout ----------------------------------------------------

const SECTIONS = [
  { to: "/compliance/dnc", label: "Do not call" },
  { to: "/compliance/consent", label: "Consent" },
  { to: "/compliance/windows", label: "Calling hours" },
];

function ComplianceNav() {
  return (
    <nav aria-label="Compliance" className="flex flex-wrap gap-2">
      {SECTIONS.map((section) => (
        <NavLink
          key={section.to}
          to={section.to}
          className={({ isActive }) =>
            cx(
              "press inline-flex min-h-10 items-center rounded-full border px-4 text-sm",
              isActive
                ? "border-signal bg-signal text-white"
                : "border-edge bg-panel text-ash hover:border-edge-bright",
            )
          }
        >
          {section.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ModalActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
      {children}
    </div>
  );
}

// --- suppression ------------------------------------------------------

export function DncPage() {
  const canEdit = useCan("compliance.edit");
  const entries = useDncEntries();
  const check = useDncCheck();
  const add = useAddDnc();
  const bulk = useBulkDnc();
  const remove = useDeleteDnc();

  const [phone, setPhone] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [reason, setReason] = useState("internal_dnc");
  const [paste, setPaste] = useState("");
  const [dialog, setDialog] = useState<"add" | "bulk" | null>(null);

  const numbers = paste
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean);

  const rows = entries.data?.results ?? [];

  const reasonField = (
    <Field label="Reason" htmlFor="add-reason">
      <Select id="add-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
        {Object.entries(REASONS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Do not call"
        subtitle="Numbers that must never be called."
        actions={
          canEdit && (
            <>
              <Button onClick={() => setDialog("bulk")}>Import</Button>
              <Button
                variant="primary"
                onClick={() => {
                  add.reset();
                  setDialog("add");
                }}
              >
                <PlusIcon className="size-4" /> Add number
              </Button>
            </>
          )
        }
      />

      <ComplianceNav />

      {entries.error && (
        <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
      )}
      {remove.error && <ErrorState error={remove.error} />}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* --- the question you actually came here to ask --------------- */}
        <Panel className="min-w-0 lg:order-last">
          <PanelHeader title="Check a number" />
          <div className="space-y-4 p-4">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (phone.trim()) check.mutate(phone.trim());
              }}
            >
              <Field label="Phone number" htmlFor="check-phone">
                <Input
                  id="check-phone"
                  type="tel"
                  className="num"
                  placeholder="+1 212 555 0123"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={!phone.trim()}
                loading={check.isPending}
              >
                Check
              </Button>
            </form>

            {check.data && (
              <div
                role="status"
                className={cx(
                  "rounded-xl px-4 py-3",
                  check.data.suppressed ? "bg-[#fdeaea]" : "bg-live",
                )}
              >
                <p className="num text-sm font-medium text-chalk">{check.data.phone_e164}</p>
                <p
                  className={cx(
                    "mt-1 text-sm",
                    check.data.suppressed ? "text-rust" : "text-live-bright",
                  )}
                >
                  {check.data.suppressed
                    ? `Do not call: ${plain(REASONS, check.data.reason)}`
                    : "Not blocked. This number may be called."}
                </p>
              </div>
            )}
            {check.error && <ErrorState error={check.error} />}
          </div>
        </Panel>

        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="Blocked numbers" hint="Removals are recorded in the audit log." />
          {entries.isLoading && <TableSkeleton />}
          {entries.data && rows.length === 0 && (
            <div className="p-4">
              <EmptyState
                title="No blocked numbers"
                description="Opt-outs made during calls appear here."
              />
            </div>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Reason</th>
                    <th>Added</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.id}>
                      <td className="num font-medium text-chalk">{entry.phone_masked}</td>
                      <td>
                        <span className="flex items-center gap-1.5">
                          <Badge>{plain(REASONS, entry.reason)}</Badge>
                          {entry.is_global && <Badge tone="warn">Platform-wide</Badge>}
                        </span>
                      </td>
                      <td>{formatRelative(entry.created_at)}</td>
                      <td className="text-right">
                        {canEdit && !entry.is_global && (
                          <Button
                            dense
                            variant="ghost"
                            className="hover:!text-rust"
                            aria-label={`Remove ${entry.phone_masked}`}
                            title="Removing a number is recorded in the audit log"
                            onClick={() => remove.mutate(entry.id)}
                          >
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {entries.data?.next && (
            <p className="border-t border-edge px-4 py-3 text-xs text-ash-dim">
              Showing the latest {rows.length}. Use the check to find older numbers.
            </p>
          )}
        </Panel>
      </div>

      {canEdit && dialog === "add" && (
        <Modal title="Add to do-not-call" onClose={() => setDialog(null)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newPhone.trim()) return;
              add.mutate(
                { phone_e164: newPhone.trim(), reason },
                {
                  onSuccess: () => {
                    setNewPhone("");
                    setDialog(null);
                  },
                },
              );
            }}
          >
            <Field
              label="Phone number"
              htmlFor="add-phone"
              error={add.error?.messageFor("phone_e164")}
            >
              <Input
                id="add-phone"
                type="tel"
                className="num"
                autoFocus
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </Field>
            {reasonField}
            {add.error && !add.error.messageFor("phone_e164") && (
              <ErrorState error={add.error} />
            )}
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!newPhone.trim()}
                loading={add.isPending}
              >
                Add number
              </Button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {canEdit && dialog === "bulk" && (
        <Modal
          title="Import numbers"
          subtitle="Up to 10,000 at a time."
          onClose={() => setDialog(null)}
        >
          <div className="space-y-4">
            <Field label="Phone numbers" htmlFor="bulk-numbers" hint="One per line.">
              <Textarea
                id="bulk-numbers"
                rows={6}
                className="num"
                autoFocus
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
            </Field>
            {reasonField}

            {bulk.error && <ErrorState error={bulk.error} />}

            {bulk.data && (
              <div role="status" className="rounded-xl bg-void px-4 py-3 text-sm">
                <p className="text-chalk">
                  <span className="num">{bulk.data.submitted}</span> accepted
                  {bulk.data.entries_added !== undefined && (
                    <>
                      , <span className="num">{bulk.data.entries_added}</span> new
                    </>
                  )}
                  , <span className="num">{bulk.data.contacts_flagged}</span> contacts flagged
                </p>
                {bulk.data.rejected.length > 0 && (
                  <>
                    <p className="mt-2 text-rust">
                      <span className="num">{bulk.data.rejected.length}</span> rejected
                    </p>
                    <ul className="mt-1 space-y-0.5 break-all text-xs text-rust">
                      {bulk.data.rejected.slice(0, 8).map((r, i) => (
                        <li key={i} className="num">
                          {r.input}: {r.reason}
                        </li>
                      ))}
                      {bulk.data.rejected.length > 8 && (
                        <li>and {bulk.data.rejected.length - 8} more</li>
                      )}
                    </ul>
                  </>
                )}
              </div>
            )}

            <ModalActions>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                disabled={numbers.length === 0}
                loading={bulk.isPending}
                onClick={() => bulk.mutate({ numbers, reason })}
              >
                Block {numbers.length || ""} {numbers.length === 1 ? "number" : "numbers"}
              </Button>
            </ModalActions>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- consent ----------------------------------------------------------

export function ConsentPage() {
  const canEdit = useCan("compliance.edit");
  const records = useConsentRecords();
  const lookup = useConsentLookup();
  const record = useRecordConsent();
  const revoke = useRevokeConsent();

  const [phone, setPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    phone_e164: "",
    consent_type: "express_written",
    scope: "marketing",
    source: "web_form",
    disclosure_text: "",
    captured_at: new Date().toISOString().slice(0, 16),
  });

  const rows = records.data?.results ?? [];
  const fieldError =
    record.error?.messageFor("phone_e164") ??
    record.error?.messageFor("disclosure_text");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consent"
        subtitle="Proof that people agreed to be called."
        actions={
          canEdit && (
            <Button
              variant="primary"
              onClick={() => {
                record.reset();
                setAdding(true);
              }}
            >
              <PlusIcon className="size-4" /> Record consent
            </Button>
          )
        }
      />

      <ComplianceNav />

      {records.error && (
        <ErrorState error={records.error} onRetry={() => void records.refetch()} />
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel className="min-w-0 lg:order-last">
          <PanelHeader title="Look up a number" hint="Works even after an erasure request." />
          <div className="space-y-4 p-4">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (phone.trim()) lookup.mutate(phone.trim());
              }}
            >
              <Field label="Phone number" htmlFor="consent-phone">
                <Input
                  id="consent-phone"
                  type="tel"
                  className="num"
                  placeholder="+1 212 555 0123"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={!phone.trim()}
                loading={lookup.isPending}
              >
                Look up
              </Button>
            </form>

            {lookup.error && <ErrorState error={lookup.error} />}
            {revoke.error && <ErrorState error={revoke.error} />}

            {lookup.data &&
              (lookup.data.length === 0 ? (
                <p role="status" className="rounded-xl bg-[#fdeaea] px-4 py-3 text-sm text-rust">
                  No consent on file for this number.
                </p>
              ) : (
                <ul className="space-y-3">
                  {lookup.data.map((c) => (
                    <ConsentCard
                      key={c.id}
                      record={c}
                      canEdit={canEdit}
                      onRevoke={() =>
                        revoke.mutate(
                          { id: c.id },
                          {
                            // Look up again so the card shows the new state.
                            onSuccess: () => {
                              if (lookup.variables) lookup.mutate(lookup.variables);
                            },
                          },
                        )
                      }
                      revoking={revoke.isPending}
                    />
                  ))}
                </ul>
              ))}
          </div>
        </Panel>

        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="Recent records" />
          {records.isLoading && <TableSkeleton />}
          {records.data && rows.length === 0 && (
            <div className="p-4">
              <EmptyState title="No consent records yet" />
            </div>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th>Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="num font-medium text-chalk">{c.phone_e164 || "—"}</td>
                      <td>{plain(CONSENT_TYPES, c.consent_type)}</td>
                      <td>{plain(SCOPES, c.scope)}</td>
                      <td><ConsentState active={c.is_active} /></td>
                      <td title={formatDateTime(c.captured_at)}>
                        {formatRelative(c.captured_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {records.data?.next && (
            <p className="border-t border-edge px-4 py-3 text-xs text-ash-dim">
              Showing the latest {rows.length}. Use the lookup to find older records.
            </p>
          )}
        </Panel>
      </div>

      {canEdit && adding && (
        <Modal title="Record consent" onClose={() => setAdding(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.phone_e164.trim() || !form.disclosure_text.trim() || !form.captured_at) {
                return;
              }
              record.mutate(
                {
                  ...form,
                  captured_at: new Date(form.captured_at).toISOString(),
                } as never,
                { onSuccess: () => setAdding(false) },
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Phone number"
                htmlFor="c-phone"
                error={record.error?.messageFor("phone_e164")}
              >
                <Input
                  id="c-phone"
                  type="tel"
                  className="num"
                  autoFocus
                  value={form.phone_e164}
                  onChange={(e) => setForm({ ...form, phone_e164: e.target.value })}
                />
              </Field>
              <Field label="Captured at" htmlFor="c-when">
                <Input
                  id="c-when"
                  type="datetime-local"
                  className="num"
                  value={form.captured_at}
                  onChange={(e) => setForm({ ...form, captured_at: e.target.value })}
                />
              </Field>
              <Field label="Type" htmlFor="c-type">
                <Select
                  id="c-type"
                  value={form.consent_type}
                  onChange={(e) => setForm({ ...form, consent_type: e.target.value })}
                >
                  {Object.entries(CONSENT_TYPES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Scope" htmlFor="c-scope">
                <Select
                  id="c-scope"
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value })}
                >
                  {Object.entries(SCOPES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Disclosure shown"
              htmlFor="c-disclosure"
              hint="Paste the exact words the person agreed to. Do not paraphrase."
              error={record.error?.messageFor("disclosure_text")}
            >
              <Textarea
                id="c-disclosure"
                rows={4}
                value={form.disclosure_text}
                onChange={(e) => setForm({ ...form, disclosure_text: e.target.value })}
              />
            </Field>

            {record.error && !fieldError && <ErrorState error={record.error} />}

            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={record.isPending}
                disabled={
                  !form.phone_e164.trim() ||
                  !form.disclosure_text.trim() ||
                  !form.captured_at
                }
              >
                Record consent
              </Button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ConsentState({ active }: { active: boolean }) {
  return <Badge tone={active ? "good" : "quiet"}>{active ? "Active" : "Revoked"}</Badge>;
}

function ConsentCard({
  record,
  canEdit,
  onRevoke,
  revoking,
}: {
  record: ConsentRecord;
  canEdit: boolean;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded-xl border border-edge p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-chalk">
            {plain(CONSENT_TYPES, record.consent_type)}
          </p>
          <p className="num text-xs text-ash">
            {plain(SCOPES, record.scope)} · {formatDateTime(record.captured_at)}
          </p>
        </div>
        <ConsentState active={record.is_active} />
      </div>

      {record.disclosure_text && (
        <blockquote className="mt-3 break-words rounded-lg bg-void px-3 py-2 text-xs italic text-ash">
          {record.disclosure_text}
        </blockquote>
      )}

      <dl className="num mt-3 space-y-0.5 break-all text-xs text-ash-dim">
        <div className="flex gap-1.5">
          <dt>Source:</dt>
          <dd>{record.source}</dd>
        </div>
        {record.captured_ip && (
          <div className="flex gap-1.5">
            <dt>IP address:</dt>
            <dd>{record.captured_ip}</dd>
          </div>
        )}
        {record.evidence_ref && (
          <div className="flex gap-1.5">
            <dt>Evidence:</dt>
            <dd>{record.evidence_ref}</dd>
          </div>
        )}
      </dl>

      {canEdit && record.is_active && (
        <div className="mt-3">
          {confirming ? (
            <div role="alert" className="rounded-lg bg-[#fdf1dc] px-3 py-3">
              <p className="text-sm text-amber">
                Revoking also adds this number to the do-not-call list. Both happen
                at once and neither can be undone from here.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button dense variant="danger" loading={revoking} onClick={onRevoke}>
                  Revoke and block
                </Button>
                <Button dense onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button dense onClick={() => setConfirming(true)}>
              Revoke consent
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// --- calling hours ----------------------------------------------------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CallingWindowsPage() {
  const canEdit = useCan("compliance.edit");
  const windows = useCallingWindows();
  const save = useSaveWindow();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    jurisdiction: "",
    start_local: "09:00",
    end_local: "17:00",
    weekdays: [0, 1, 2, 3, 4],
  });

  const rows = windows.data?.results ?? [];
  const fieldError =
    save.error?.messageFor("jurisdiction") ?? save.error?.messageFor("end_local");

  const addButton = canEdit && (
    <Button
      variant="primary"
      onClick={() => {
        save.reset();
        setAdding(true);
      }}
    >
      <PlusIcon className="size-4" /> Add hours
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calling hours"
        subtitle="Set in the local time of the person called."
        actions={addButton}
      />

      <ComplianceNav />

      {windows.error && (
        <ErrorState error={windows.error} onRetry={() => void windows.refetch()} />
      )}

      {windows.isLoading && (
        <Panel>
          <TableSkeleton />
        </Panel>
      )}
      {windows.data && rows.length === 0 && (
        <EmptyState
          title="Using the default hours"
          description="Calls are allowed 8am to 9pm in the called person's local time."
        />
      )}

      {rows.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((w) => (
            <li key={w.id}>
              <Panel className="h-full p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="display num text-base text-chalk">{w.jurisdiction}</h2>
                  {w.holidays_blocked && <Badge tone="info">Holidays blocked</Badge>}
                </div>
                <p className="num mt-3 text-3xl font-light text-chalk">
                  {w.start_local.slice(0, 5)}–{w.end_local.slice(0, 5)}
                </p>
                <p className="sr-only">
                  Days: {w.weekdays.map((d) => DAYS[d]).join(", ")}
                </p>
                <div aria-hidden className="mt-4 grid grid-cols-7 gap-1">
                  {DAYS.map((day, i) => (
                    <span
                      key={day}
                      className={cx(
                        "rounded-md py-1 text-center text-[11px]",
                        w.weekdays.includes(i)
                          ? "bg-live font-medium text-live-bright"
                          : "bg-void text-ash-dim line-through",
                      )}
                    >
                      {day}
                    </span>
                  ))}
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {canEdit && adding && (
        <Modal
          title="Add calling hours"
          subtitle="You can narrow the legal hours, never widen them."
          onClose={() => setAdding(false)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.jurisdiction.trim()) return;
              save.mutate(
                {
                  jurisdiction: form.jurisdiction,
                  start_local: `${form.start_local}:00`,
                  end_local: `${form.end_local}:00`,
                  weekdays: form.weekdays,
                },
                { onSuccess: () => setAdding(false) },
              );
            }}
          >
            <Field
              label="Region"
              htmlFor="j"
              hint="For example US, US-FL or KE"
              error={save.error?.messageFor("jurisdiction")}
            >
              <Input
                id="j"
                className="num"
                placeholder="US-FL"
                autoFocus
                value={form.jurisdiction}
                onChange={(e) =>
                  setForm({ ...form, jurisdiction: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From" htmlFor="s">
                <Input
                  id="s"
                  type="time"
                  className="num"
                  value={form.start_local}
                  onChange={(e) => setForm({ ...form, start_local: e.target.value })}
                />
              </Field>
              <Field label="To" htmlFor="e" error={save.error?.messageFor("end_local")}>
                <Input
                  id="e"
                  type="time"
                  className="num"
                  value={form.end_local}
                  onChange={(e) => setForm({ ...form, end_local: e.target.value })}
                />
              </Field>
            </div>

            <fieldset className="min-w-0">
              <legend className="eyebrow mb-2">Days</legend>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {DAYS.map((day, i) => {
                  const on = form.weekdays.includes(i);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setForm({
                          ...form,
                          weekdays: on
                            ? form.weekdays.filter((d) => d !== i)
                            : [...form.weekdays, i].sort(),
                        })
                      }
                      className={cx(
                        "press min-h-10 rounded-xl border text-sm",
                        on
                          ? "border-signal bg-signal text-white"
                          : "border-edge bg-panel text-ash hover:border-edge-bright",
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {save.error && !fieldError && <ErrorState error={save.error} />}

            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={save.isPending}
                disabled={!form.jurisdiction.trim()}
              >
                Save hours
              </Button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}
