/**
 * Editable campaign settings.
 *
 * Pacing is deliberately editable while a campaign is dialing — slowing down
 * without stopping is the correct response to a rising complaint rate, and
 * making it require a stop would push operators toward stopping instead.
 *
 * The five frozen fields live on the overview, shown locked. They are not
 * repeated here as disabled inputs, because a form full of dead controls
 * teaches people the form is broken.
 */

import { useState, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";

import {
  Button,
  ErrorState,
  Field,
  Input,
  Panel,
  PanelHeader,
  cx,
} from "@/components/ui";
import { formatWeekdays } from "@/lib/format";
import { useRebuildStats, useUpdateCampaign } from "@/lib/queries/campaigns";
import { useCan } from "@/lib/session";
import type { Campaign } from "@/types/domain";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RETRY_STATUSES = ["busy", "no_answer", "failed", "canceled"] as const;

export function CampaignSettingsPage() {
  const campaign = useOutletContext<Campaign>();
  const canEdit = useCan("campaign.edit");
  const update = useUpdateCampaign(campaign.id);
  const rebuild = useRebuildStats(campaign.id);

  const [draft, setDraft] = useState({
    cps_limit: String(campaign.cps_limit),
    max_concurrent_channels: String(campaign.max_concurrent_channels),
    ring_timeout_seconds: String(campaign.ring_timeout_seconds),
    window_start_local: campaign.window_start_local.slice(0, 5),
    window_end_local: campaign.window_end_local.slice(0, 5),
    active_weekdays: campaign.active_weekdays,
    max_attempts: String(campaign.max_attempts),
    max_attempts_per_day: String(campaign.max_attempts_per_day),
    retry_delay_minutes: String(campaign.retry_delay_minutes),
    retry_on_statuses: campaign.retry_on_statuses,
    amd_enabled: campaign.amd_enabled,
    hangup_on_machine: campaign.hangup_on_machine,
    voicemail_node: campaign.voicemail_node,
    record_calls: campaign.record_calls,
    recording_disclosure_node: campaign.recording_disclosure_node,
  });

  function save() {
    update.mutate({
      cps_limit: Number(draft.cps_limit),
      max_concurrent_channels: Number(draft.max_concurrent_channels),
      ring_timeout_seconds: Number(draft.ring_timeout_seconds),
      window_start_local: `${draft.window_start_local}:00`,
      window_end_local: `${draft.window_end_local}:00`,
      active_weekdays: draft.active_weekdays,
      max_attempts: Number(draft.max_attempts),
      max_attempts_per_day: Number(draft.max_attempts_per_day),
      retry_delay_minutes: Number(draft.retry_delay_minutes),
      retry_on_statuses: draft.retry_on_statuses,
      amd_enabled: draft.amd_enabled,
      hangup_on_machine: draft.hangup_on_machine,
      voicemail_node: draft.voicemail_node,
      record_calls: draft.record_calls,
      recording_disclosure_node: draft.recording_disclosure_node,
    });
  }

  const err = (field: string) => update.error?.messageFor(field);
  // An error about something with no field on screen needs the summary box.
  const hidden = [
    !draft.amd_enabled && "hangup_on_machine",
    !(draft.amd_enabled && !draft.hangup_on_machine) && "voicemail_node",
    !draft.record_calls && "recording_disclosure_node",
  ];
  const showSummary =
    update.error &&
    (!update.error.fieldErrors ||
      Object.keys(update.error.fieldErrors).some(
        (key) => !(key in draft) || hidden.includes(key),
      ));

  const number = (
    key:
      | "cps_limit"
      | "max_concurrent_channels"
      | "ring_timeout_seconds"
      | "max_attempts"
      | "max_attempts_per_day"
      | "retry_delay_minutes",
    label: string,
    min: string,
    step?: string,
  ) => (
    <Field label={label} htmlFor={key} error={err(key)}>
      <Input
        id={key}
        type="number"
        min={min}
        step={step}
        className="num"
        invalid={Boolean(err(key))}
        value={draft[key]}
        disabled={!canEdit}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Section
          title="Pace"
          hint="Editable while dialing. Slowing down is the right answer to a rising complaint rate; stopping is not."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {number("cps_limit", "Calls per second", "0.1", "0.1")}
            {number("max_concurrent_channels", "Concurrent channels", "1")}
            {number("ring_timeout_seconds", "Ring timeout (sec)", "5")}
          </div>
        </Section>

        <Section
          title="Calling hours"
          hint="Resolved in the called party's local time. Your window can only tighten the jurisdiction's, never widen it."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="from" error={err("window_start_local")}>
              <Input
                id="from"
                type="time"
                className="num"
                value={draft.window_start_local}
                disabled={!canEdit}
                onChange={(e) =>
                  setDraft({ ...draft, window_start_local: e.target.value })
                }
              />
            </Field>
            <Field label="To" htmlFor="to" error={err("window_end_local")}>
              <Input
                id="to"
                type="time"
                className="num"
                value={draft.window_end_local}
                disabled={!canEdit}
                onChange={(e) =>
                  setDraft({ ...draft, window_end_local: e.target.value })
                }
              />
            </Field>
          </div>

          <Chips label="Days" error={err("active_weekdays")}>
            {WEEKDAYS.map((day, i) => {
              const on = draft.active_weekdays.includes(i);
              return (
                <Chip
                  key={day}
                  on={on}
                  disabled={!canEdit}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      active_weekdays: on
                        ? draft.active_weekdays.filter((d) => d !== i)
                        : [...draft.active_weekdays, i].sort(),
                    })
                  }
                >
                  {day}
                </Chip>
              );
            })}
          </Chips>
          <p className="text-xs text-ash">
            {formatWeekdays(draft.active_weekdays)}
          </p>
        </Section>

        <Section
          title="Retries"
          hint="Attempt caps exist as much for your number's reputation as for compliance. Repeated unanswered calls to the same number are scored."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {number("max_attempts", "Max attempts", "1")}
            {number("max_attempts_per_day", "Per day", "1")}
            {number("retry_delay_minutes", "Delay (min)", "1")}
          </div>

          <Chips label="Retry on" error={err("retry_on_statuses")}>
            {RETRY_STATUSES.map((status) => {
              const on = draft.retry_on_statuses.includes(status);
              return (
                <Chip
                  key={status}
                  on={on}
                  disabled={!canEdit}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      retry_on_statuses: on
                        ? draft.retry_on_statuses.filter((s) => s !== status)
                        : [...draft.retry_on_statuses, status],
                    })
                  }
                >
                  {status.replace("_", " ")}
                </Chip>
              );
            })}
          </Chips>
        </Section>

        <Section title="Machine detection & recording">
          <Toggle
            label="Detect answering machines"
            hint="Async detection connects the call immediately and delivers the verdict out of band."
            checked={draft.amd_enabled}
            disabled={!canEdit}
            error={err("amd_enabled")}
            onChange={(v) => setDraft({ ...draft, amd_enabled: v })}
          />
          {draft.amd_enabled && (
            <>
              <Toggle
                label="Hang up on a machine"
                hint="Otherwise the call is redirected to the voicemail branch."
                checked={draft.hangup_on_machine}
                disabled={!canEdit}
                error={err("hangup_on_machine")}
                onChange={(v) => setDraft({ ...draft, hangup_on_machine: v })}
              />
              {!draft.hangup_on_machine && (
                <Field
                  label="Voicemail node"
                  htmlFor="vm"
                  error={err("voicemail_node")}
                >
                  <Input
                    id="vm"
                    className="num"
                    placeholder="voicemail"
                    value={draft.voicemail_node}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setDraft({ ...draft, voicemail_node: e.target.value })
                    }
                  />
                </Field>
              )}
            </>
          )}

          <div className="space-y-4 border-t border-edge pt-4">
            <Toggle
              label="Record calls"
              hint="Many jurisdictions require all-party consent. A disclosure must play first."
              checked={draft.record_calls}
              disabled={!canEdit}
              error={err("record_calls")}
              onChange={(v) => setDraft({ ...draft, record_calls: v })}
            />
            {draft.record_calls && (
              <Field
                label="Disclosure node"
                htmlFor="disclosure"
                hint="Must be reachable before any recording starts."
                error={err("recording_disclosure_node")}
              >
                <Input
                  id="disclosure"
                  className="num"
                  value={draft.recording_disclosure_node}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      recording_disclosure_node: e.target.value,
                    })
                  }
                />
              </Field>
            )}
          </div>
        </Section>
      </div>

      {showSummary && <ErrorState error={update.error} />}
      {rebuild.error && <ErrorState error={rebuild.error} />}

      {canEdit && (
        <Panel className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Button variant="primary" onClick={save} loading={update.isPending}>
            Save changes
          </Button>
          <span role="status" className="text-sm">
            {update.isSuccess && !update.isPending && (
              <span className="text-good">Saved</span>
            )}
            {update.error && !showSummary && (
              <span className="text-rust">Check the highlighted fields.</span>
            )}
          </span>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => rebuild.mutate()}
            loading={rebuild.isPending}
            title="Recomputes counters from the call log. Slow by design."
          >
            Rebuild counters
          </Button>
        </Panel>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title={title} hint={hint} />
      <div className="space-y-4 p-4">{children}</div>
    </Panel>
  );
}

function Chips({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-rust">
          {error}
        </p>
      )}
    </div>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "press min-h-10 min-w-12 rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60",
        on
          ? "btn-solid border-transparent"
          : "border-edge bg-panel text-ash hover:border-edge-bright",
      )}
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  error,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <label className="flex min-h-9 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-signal"
        />
        <span>
          <span className="text-sm font-medium text-chalk">{label}</span>
          {hint && <span className="mt-0.5 block text-xs text-ash">{hint}</span>}
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-rust">
          {error}
        </p>
      )}
    </div>
  );
}
