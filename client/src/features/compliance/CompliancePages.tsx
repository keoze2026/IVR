/**
 * Suppression, consent and calling hours.
 *
 * These three screens are the ones someone opens when a complaint lands, so
 * they are built around lookup first and browsing second.
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

const REASONS = [
  "internal_dnc",
  "ivr_opt_out",
  "federal_dnc",
  "state_dnc",
  "litigator",
  "complaint",
  "carrier_invalid",
];

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

/** A stored code as it is shown on screen. */
const plain = (code: string) => code.replace(/_/g, " ");

// --- shared layout ----------------------------------------------------

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
        {REASONS.map((r) => (
          <option key={r} value={r}>
            {plain(r)}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppression"
        subtitle="Numbers that must not be dialed. Checked at import and again immediately before every call — a list uploaded on Monday and dialed on Friday has picked up new opt-outs."
        actions={
          canEdit && (
            <>
              <Button onClick={() => setDialog("bulk")}>Paste numbers</Button>
              <Button variant="primary" onClick={() => setDialog("add")}>
                <PlusIcon className="size-4" /> Suppress a number
              </Button>
            </>
          )
        }
      />

      {entries.error && (
        <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
      )}
      {remove.error && <ErrorState error={remove.error} />}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* --- the question you actually came here to ask --------------- */}
        <Panel className="min-w-0 lg:order-last">
          <PanelHeader title="Is this number suppressed?" />
          <div className="space-y-4 p-4">
            {/* Enter does not submit; the button does. */}
            <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
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
                type="button"
                variant="primary"
                className="w-full"
                disabled={!phone.trim()}
                loading={check.isPending}
                onClick={() => check.mutate(phone.trim())}
              >
                Check
              </Button>
            </form>

            {check.data && (
              <div
                role="status"
                className={cx(
                  "rounded-xl px-4 py-3",
                  check.data.suppressed ? "bg-bad-soft" : "bg-live",
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
                    ? `Suppressed — ${plain(check.data.reason)}`
                    : "Not suppressed. This number may be dialed."}
                </p>
              </div>
            )}
            {check.error && <ErrorState error={check.error} />}
          </div>
        </Panel>

        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="Suppressed numbers" />
          {entries.isLoading && <TableSkeleton />}
          {entries.data && rows.length === 0 && (
            <div className="p-4">
              <EmptyState
                title="Nothing suppressed yet"
                description="Opt-outs captured through the IVR land here automatically."
              />
            </div>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.id}>
                      <td className="num font-medium text-chalk">{entry.phone_masked}</td>
                      <td>
                        <span className="flex items-center gap-1.5">
                          <Badge>{plain(entry.reason)}</Badge>
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
                            title="Removing a suppression is audit-logged"
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
        </Panel>
      </div>

      {canEdit && dialog === "add" && (
        <Modal
          title="Suppress a number"
          onClose={() => setDialog(null)}
          closeOnEscape={false}
          closeOnBackdrop={false}
        >
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
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
                type="button"
                variant="primary"
                disabled={!newPhone.trim()}
                loading={add.isPending}
                onClick={() =>
                  add.mutate(
                    { phone_e164: newPhone.trim(), reason },
                    { onSuccess: () => setNewPhone("") },
                  )
                }
              >
                Add to suppression
              </Button>
            </ModalActions>
          </form>
        </Modal>
      )}

      {canEdit && dialog === "bulk" && (
        <Modal
          title="Import many"
          subtitle="Up to 10,000 at a time. Anything unparseable comes back listed."
          onClose={() => setDialog(null)}
          closeOnEscape={false}
          closeOnBackdrop={false}
        >
          <div className="space-y-4">
            <Textarea
              rows={6}
              className="num"
              autoFocus
              aria-label="Import many"
              placeholder="One per line"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
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
                  <ul className="mt-2 space-y-0.5 break-all text-xs text-rust">
                    {bulk.data.rejected.slice(0, 8).map((r, i) => (
                      <li key={i} className="num">
                        {r.input} — {r.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <ModalActions>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={numbers.length === 0}
                loading={bulk.isPending}
                onClick={() => bulk.mutate({ numbers, reason })}
              >
                Suppress {numbers.length || ""}
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
        subtitle="Suppression proves you were told to stop. Consent proves you were allowed to start — and in a dispute, the burden of proving it is yours."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <PlusIcon className="size-4" /> Record consent
            </Button>
          )
        }
      />

      {records.error && (
        <ErrorState error={records.error} onRetry={() => void records.refetch()} />
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel className="min-w-0 lg:order-last">
          <PanelHeader
            title="Consent history for a number"
            hint="Matched on a hash, so it still resolves after an erasure request."
          />
          <div className="space-y-4 p-4">
            <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
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
                type="button"
                variant="primary"
                className="w-full"
                disabled={!phone.trim()}
                loading={lookup.isPending}
                onClick={() => lookup.mutate(phone.trim())}
              >
                Look up
              </Button>
            </form>

            {lookup.error && <ErrorState error={lookup.error} />}
            {revoke.error && <ErrorState error={revoke.error} />}

            {lookup.data &&
              (lookup.data.length === 0 ? (
                <p role="status" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-rust">
                  No consent on file for this number.
                </p>
              ) : (
                <ul className="space-y-3">
                  {lookup.data.map((c) => (
                    <ConsentCard
                      key={c.id}
                      record={c}
                      canEdit={canEdit}
                      onRevoke={() => revoke.mutate({ id: c.id })}
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
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="num font-medium text-chalk">{c.phone_e164}</td>
                      <td>
                        {plain(c.consent_type)} · {c.scope}
                      </td>
                      <td><ConsentState active={c.is_active} /></td>
                      <td>{formatRelative(c.captured_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {canEdit && adding && (
        <Modal
          title="Record a consent event"
          onClose={() => setAdding(false)}
          closeOnEscape={false}
          closeOnBackdrop={false}
        >
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
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
              hint="The exact words the person agreed to. This is the field that matters in a dispute — paste it, do not paraphrase it."
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
              {/* An empty capture time cannot be converted to a date, so it
                  also blocks the button. */}
              <Button
                type="button"
                variant="primary"
                loading={record.isPending}
                disabled={
                  !form.phone_e164.trim() ||
                  !form.disclosure_text.trim() ||
                  !form.captured_at
                }
                onClick={() =>
                  record.mutate(
                    {
                      ...form,
                      captured_at: new Date(form.captured_at).toISOString(),
                    } as never,
                    { onSuccess: () => setAdding(false) },
                  )
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
            {plain(record.consent_type)}
          </p>
          <p className="num text-xs text-ash">
            {record.scope} · {formatDateTime(record.captured_at)}
          </p>
        </div>
        <ConsentState active={record.is_active} />
      </div>

      {record.disclosure_text && (
        <blockquote className="mt-3 break-words rounded-lg bg-void px-3 py-2 text-xs italic text-ash">
          {record.disclosure_text}
        </blockquote>
      )}

      <div className="num mt-3 flex flex-wrap gap-x-3 gap-y-0.5 break-all text-xs text-ash-dim">
        <span>from {record.source}</span>
        {record.captured_ip && <span>{record.captured_ip}</span>}
        {record.evidence_ref && <span>evidence {record.evidence_ref}</span>}
      </div>

      {canEdit && record.is_active && (
        <div className="mt-3">
          {confirming ? (
            <div role="alert" className="rounded-lg bg-warn-soft px-3 py-3">
              <p className="text-sm text-amber">
                Revoking also adds this number to suppression. Both happen at once
                and neither can be undone from here.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button dense variant="danger" loading={revoking} onClick={onRevoke}>
                  Revoke and suppress
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
    <Button variant="primary" onClick={() => setAdding(true)}>
      <PlusIcon className="size-4" /> Add a window
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calling hours"
        subtitle="Resolved in the called party's local time, per contact. Your window can only tighten a jurisdiction's rules — never widen them."
        actions={addButton}
      />

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
          title="No overrides set"
          description="Without an override, the platform default applies: 8am to 9pm in the called party's local time."
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
          title="Add a window"
          onClose={() => setAdding(false)}
          closeOnEscape={false}
          closeOnBackdrop={false}
        >
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <Field
              label="Jurisdiction"
              htmlFor="j"
              hint="US, US-FL, KE"
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
                          ? "neon border-transparent"
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
                type="button"
                variant="primary"
                loading={save.isPending}
                disabled={!form.jurisdiction.trim()}
                onClick={() =>
                  save.mutate(
                    {
                      jurisdiction: form.jurisdiction,
                      start_local: `${form.start_local}:00`,
                      end_local: `${form.end_local}:00`,
                      weekdays: form.weekdays,
                    },
                    { onSuccess: () => setAdding(false) },
                  )
                }
              >
                Save window
              </Button>
            </ModalActions>
          </form>
        </Modal>
      )}
    </div>
  );
}
