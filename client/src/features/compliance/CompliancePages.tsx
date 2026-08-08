/**
 * Suppression, consent and calling hours.
 *
 * These three screens are the ones someone opens when a complaint lands, so
 * they are built around lookup first and browsing second.
 */

import { useState } from "react";

import { ClipButton } from "@/components/styled/ClipButton";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Panel,
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

const REASONS = [
  "internal_dnc",
  "ivr_opt_out",
  "federal_dnc",
  "state_dnc",
  "litigator",
  "complaint",
  "carrier_invalid",
];

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
  const [showBulk, setShowBulk] = useState(false);

  const numbers = paste
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Suppression</h1>
        <p className="mt-1 text-sm text-ash">
          Numbers that must not be dialed. Checked at import and again
          immediately before every call — a list uploaded on Monday and dialed
          on Friday has picked up new opt-outs.
        </p>
      </header>

      {/* --- the question you actually came here to ask --------------- */}
      <Panel className="p-5">
        <h2 className="display text-sm font-semibold text-chalk">
          Is this number suppressed?
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Phone number" htmlFor="check-phone">
              <Input
                id="check-phone"
                className="num"
                placeholder="+1 212 555 0123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={!phone.trim()}
            loading={check.isPending}
            onClick={() => check.mutate(phone.trim())}
          >
            Check
          </Button>
        </div>

        {check.data && (
          <div
            className={cx(
              "mt-4 rounded border px-4 py-3",
              check.data.suppressed
                ? "border-rust/40 bg-rust/[0.07]"
                : "border-live-bright/40 bg-live/10",
            )}
          >
            <p className="num text-sm text-chalk">{check.data.phone_e164}</p>
            <p
              className={cx(
                "mt-1 text-sm",
                check.data.suppressed ? "text-rust" : "text-live-bright",
              )}
            >
              {check.data.suppressed
                ? `Suppressed — ${check.data.reason.replace(/_/g, " ")}`
                : "Not suppressed. This number may be dialed."}
            </p>
          </div>
        )}
        {check.error && <div className="mt-3"><ErrorState error={check.error} /></div>}
      </Panel>

      {canEdit && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel className="p-5">
            <h2 className="display text-sm font-semibold text-chalk">
              Suppress a number
            </h2>
            <div className="mt-3 space-y-3">
              <Field
                label="Phone number"
                htmlFor="add-phone"
                error={add.error?.messageFor("phone_e164")}
              >
                <Input
                  id="add-phone"
                  className="num"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </Field>
              <Field label="Reason" htmlFor="add-reason">
                <Select
                  id="add-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
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
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="display text-sm font-semibold text-chalk">
                  Import many
                </h2>
                <p className="mt-1 text-xs text-ash">
                  Up to 10,000 at a time. Anything unparseable comes back listed.
                </p>
              </div>
              {!showBulk && (
                <Button onClick={() => setShowBulk(true)}>Paste numbers</Button>
              )}
            </div>

            {showBulk && (
              <div className="mt-3 space-y-3">
                <Textarea
                  rows={5}
                  className="num text-xs"
                  placeholder="One per line"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                />
                <div className="flex items-center gap-3">
                  <ClipButton
                    disabled={numbers.length === 0 || bulk.isPending}
                    onClick={() => bulk.mutate({ numbers, reason })}
                  >
                    Suppress {numbers.length || ""}
                  </ClipButton>
                  <Button variant="ghost" onClick={() => setShowBulk(false)}>
                    Cancel
                  </Button>
                </div>

                {bulk.data && (
                  <div className="rounded border border-edge bg-void px-3 py-2.5 text-xs">
                    <p className="text-chalk">
                      <span className="num">{bulk.data.submitted}</span> accepted
                      {bulk.data.entries_added !== undefined && (
                        <>
                          , <span className="num">{bulk.data.entries_added}</span>{" "}
                          new
                        </>
                      )}
                      , <span className="num">{bulk.data.contacts_flagged}</span>{" "}
                      contacts flagged
                    </p>
                    {bulk.data.rejected.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-rust">
                        {bulk.data.rejected.slice(0, 8).map((r, i) => (
                          <li key={i} className="num">
                            {r.input} — {r.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>
      )}

      <Panel className="overflow-hidden">
        <div className="border-b border-edge px-4 py-3">
          <h2 className="display text-sm font-semibold text-chalk">
            Suppressed numbers
          </h2>
        </div>
        {entries.isLoading && <TableSkeleton />}
        {entries.data?.results.length === 0 && (
          <EmptyState
            title="Nothing suppressed yet"
            description="Opt-outs captured through the IVR land here automatically."
          />
        )}
        <ul className="divide-y divide-edge">
          {(entries.data?.results ?? []).map((entry) => (
            <li key={entry.id} className="flex items-center gap-4 px-4 py-2.5">
              <span className="num text-sm text-chalk">{entry.phone_masked}</span>
              <span className="rounded border border-edge px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ash">
                {entry.reason.replace(/_/g, " ")}
              </span>
              {entry.is_global && (
                <span className="font-mono text-[10px] uppercase text-amber">
                  platform-wide
                </span>
              )}
              <span className="ml-auto text-xs text-ash">
                {formatRelative(entry.created_at)}
              </span>
              {canEdit && !entry.is_global && (
                <button
                  onClick={() => remove.mutate(entry.id)}
                  className="press -mr-2 min-h-11 shrink-0 rounded-full px-3 text-xs text-ash hover:text-rust"
                  title="Removing a suppression is audit-logged"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
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

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Consent</h1>
          <p className="mt-1 text-sm text-ash">
            Suppression proves you were told to stop. Consent proves you were
            allowed to start — and in a dispute, the burden of proving it is
            yours.
          </p>
        </div>
        {canEdit && !adding && (
          <ClipButton onClick={() => setAdding(true)}>Record consent</ClipButton>
        )}
      </header>

      <Panel className="p-5">
        <h2 className="display text-sm font-semibold text-chalk">
          Consent history for a number
        </h2>
        <p className="mt-1 text-xs text-ash">
          Matched on a hash, so it still resolves after an erasure request.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Phone number" htmlFor="consent-phone">
              <Input
                id="consent-phone"
                className="num"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={!phone.trim()}
            loading={lookup.isPending}
            onClick={() => lookup.mutate(phone.trim())}
          >
            Look up
          </Button>
        </div>

        {lookup.data && (
          <div className="mt-4">
            {lookup.data.length === 0 ? (
              <p className="rounded border border-rust/40 bg-rust/[0.07] px-4 py-3 text-sm text-rust">
                No consent on file for this number.
              </p>
            ) : (
              <ul className="space-y-2">
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
            )}
          </div>
        )}
      </Panel>

      {adding && (
        <Panel className="p-5">
          <h2 className="display text-sm font-semibold text-chalk">
            Record a consent event
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Phone number"
              htmlFor="c-phone"
              error={record.error?.messageFor("phone_e164")}
            >
              <Input
                id="c-phone"
                className="num"
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
                <option value="express_written">Express written</option>
                <option value="express_oral">Express oral</option>
                <option value="ebr">Existing business relationship</option>
                <option value="transactional">Transactional</option>
              </Select>
            </Field>
            <Field label="Scope" htmlFor="c-scope">
              <Select
                id="c-scope"
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
              >
                <option value="marketing">Marketing</option>
                <option value="informational">Informational</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Disclosure shown"
                htmlFor="c-disclosure"
                hint="The exact words the person agreed to. This is the field that matters in a dispute — paste it, do not paraphrase it."
                error={record.error?.messageFor("disclosure_text")}
              >
                <Textarea
                  id="c-disclosure"
                  rows={3}
                  value={form.disclosure_text}
                  onChange={(e) =>
                    setForm({ ...form, disclosure_text: e.target.value })
                  }
                />
              </Field>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              loading={record.isPending}
              disabled={!form.phone_e164.trim() || !form.disclosure_text.trim()}
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
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </Panel>
      )}

      <Panel className="overflow-hidden">
        <div className="border-b border-edge px-4 py-3">
          <h2 className="display text-sm font-semibold text-chalk">
            Recent records
          </h2>
        </div>
        {records.isLoading && <TableSkeleton />}
        <ul className="divide-y divide-edge">
          {(records.data?.results ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-4 px-4 py-2.5">
              <span className="num text-sm text-chalk">{c.phone_e164}</span>
              <span className="text-xs text-ash">
                {c.consent_type.replace(/_/g, " ")} · {c.scope}
              </span>
              <span
                className={cx(
                  "rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                  c.is_active
                    ? "border-live-bright/40 text-live-bright"
                    : "border-edge text-ash-dim",
                )}
              >
                {c.is_active ? "active" : "revoked"}
              </span>
              <span className="ml-auto text-xs text-ash">
                {formatRelative(c.captured_at)}
              </span>
            </li>
          ))}
        </ul>
        {records.data?.results.length === 0 && (
          <EmptyState title="No consent records yet" />
        )}
      </Panel>
    </div>
  );
}

function ConsentCard({
  record,
  canEdit,
  onRevoke,
  revoking,
}: {
  record: import("@/types/domain").ConsentRecord;
  canEdit: boolean;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded border border-edge bg-void px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-chalk">
          {record.consent_type.replace(/_/g, " ")}
        </span>
        <span className="text-xs text-ash">{record.scope}</span>
        <span className="num text-xs text-ash">
          {formatDateTime(record.captured_at)}
        </span>
        <span
          className={cx(
            "ml-auto rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
            record.is_active
              ? "border-live-bright/40 text-live-bright"
              : "border-edge text-ash-dim",
          )}
        >
          {record.is_active ? "active" : "revoked"}
        </span>
      </div>

      {record.disclosure_text && (
        <blockquote className="mt-2 border-l-2 border-edge-bright pl-3 text-xs italic text-ash">
          {record.disclosure_text}
        </blockquote>
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px] text-ash-dim">
        <span className="num">from {record.source}</span>
        {record.captured_ip && <span className="num">{record.captured_ip}</span>}
        {record.evidence_ref && (
          <span className="num">evidence {record.evidence_ref}</span>
        )}
      </div>

      {canEdit && record.is_active && (
        <div className="mt-3">
          {confirming ? (
            <div className="rounded border border-amber/40 bg-amber/[0.07] px-3 py-2">
              <p className="text-xs text-amber">
                Revoking also adds this number to suppression. Both happen at
                once and neither can be undone from here.
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="danger" loading={revoking} onClick={onRevoke}>
                  Revoke and suppress
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
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

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">
            Calling hours
          </h1>
          <p className="mt-1 text-sm text-ash">
            Resolved in the called party's local time, per contact. Your window
            can only tighten a jurisdiction's rules — never widen them.
          </p>
        </div>
        {canEdit && !adding && (
          <ClipButton onClick={() => setAdding(true)}>Add a window</ClipButton>
        )}
      </header>

      {adding && (
        <Panel className="p-5">
          <div className="grid gap-4 sm:grid-cols-3">
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
                value={form.jurisdiction}
                onChange={(e) =>
                  setForm({ ...form, jurisdiction: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label="From" htmlFor="s">
              <Input
                id="s"
                type="time"
                className="num"
                value={form.start_local}
                onChange={(e) => setForm({ ...form, start_local: e.target.value })}
              />
            </Field>
            <Field
              label="To"
              htmlFor="e"
              error={save.error?.messageFor("end_local")}
            >
              <Input
                id="e"
                type="time"
                className="num"
                value={form.end_local}
                onChange={(e) => setForm({ ...form, end_local: e.target.value })}
              />
            </Field>
          </div>

          <div className="mt-4">
            <div className="eyebrow mb-2">Days</div>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((day, i) => {
                const on = form.weekdays.includes(i);
                return (
                  <button
                    key={day}
                    onClick={() =>
                      setForm({
                        ...form,
                        weekdays: on
                          ? form.weekdays.filter((d) => d !== i)
                          : [...form.weekdays, i].sort(),
                      })
                    }
                    className={
                      on
                        ? "rounded border border-signal bg-signal px-2.5 py-1 font-mono text-[11px] text-void"
                        : "rounded border border-edge bg-void px-2.5 py-1 font-mono text-[11px] text-ash"
                    }
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
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
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </Panel>
      )}

      <Panel className="overflow-hidden">
        {windows.isLoading && <TableSkeleton />}
        {windows.data?.results.length === 0 && (
          <EmptyState
            title="No overrides set"
            description="Without an override, the platform default applies: 8am to 9pm in the called party's local time."
          />
        )}
        <ul className="divide-y divide-edge">
          {(windows.data?.results ?? []).map((w) => (
            <li key={w.id} className="flex items-center gap-4 px-4 py-3">
              <span className="num rounded border border-edge px-2 py-0.5 text-sm text-chalk">
                {w.jurisdiction}
              </span>
              <span className="num text-sm text-chalk">
                {w.start_local.slice(0, 5)}–{w.end_local.slice(0, 5)}
              </span>
              <span className="text-xs text-ash">
                {w.weekdays.map((d) => DAYS[d]).join(", ")}
              </span>
              {w.holidays_blocked && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-ash-dim">
                  holidays blocked
                </span>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
