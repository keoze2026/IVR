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

import { useState } from "react";
import { useOutletContext } from "react-router-dom";

import { Button, ErrorState, Field, Input, Panel } from "@/components/ui";
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

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel className="p-5">
        <h2 className="display text-sm font-semibold text-chalk">Pace</h2>
        <p className="mt-1 text-xs text-ash">
          Editable while dialing. Slowing down is the right answer to a rising
          complaint rate; stopping is not.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Calls per second" htmlFor="cps" error={err("cps_limit")}>
            <Input
              id="cps"
              type="number"
              step="0.1"
              min="0.1"
              className="num"
              value={draft.cps_limit}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, cps_limit: e.target.value })}
            />
          </Field>
          <Field
            label="Concurrent channels"
            htmlFor="channels"
            error={err("max_concurrent_channels")}
          >
            <Input
              id="channels"
              type="number"
              min="1"
              className="num"
              value={draft.max_concurrent_channels}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft({ ...draft, max_concurrent_channels: e.target.value })
              }
            />
          </Field>
          <Field label="Ring timeout (sec)" htmlFor="ring">
            <Input
              id="ring"
              type="number"
              min="5"
              className="num"
              value={draft.ring_timeout_seconds}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft({ ...draft, ring_timeout_seconds: e.target.value })
              }
            />
          </Field>
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="display text-sm font-semibold text-chalk">
          Calling hours
        </h2>
        <p className="mt-1 text-xs text-ash">
          Resolved in the called party's local time. Your window can only
          tighten the jurisdiction's, never widen it.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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

        <div className="mt-4">
          <div className="eyebrow mb-2">Days</div>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day, i) => {
              const on = draft.active_weekdays.includes(i);
              return (
                <button
                  key={day}
                  disabled={!canEdit}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      active_weekdays: on
                        ? draft.active_weekdays.filter((d) => d !== i)
                        : [...draft.active_weekdays, i].sort(),
                    })
                  }
                  className={
                    on
                      ? "rounded border border-signal bg-signal px-2.5 py-1 font-mono text-[11px] text-void"
                      : "rounded border border-edge bg-void px-2.5 py-1 font-mono text-[11px] text-ash hover:text-chalk"
                  }
                >
                  {day}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ash">
            {formatWeekdays(draft.active_weekdays)}
          </p>
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="display text-sm font-semibold text-chalk">Retries</h2>
        <p className="mt-1 text-xs text-ash">
          Attempt caps exist as much for your number's reputation as for
          compliance. Repeated unanswered calls to the same number are scored.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Max attempts" htmlFor="attempts">
            <Input
              id="attempts"
              type="number"
              min="1"
              className="num"
              value={draft.max_attempts}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, max_attempts: e.target.value })}
            />
          </Field>
          <Field label="Per day" htmlFor="per-day">
            <Input
              id="per-day"
              type="number"
              min="1"
              className="num"
              value={draft.max_attempts_per_day}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft({ ...draft, max_attempts_per_day: e.target.value })
              }
            />
          </Field>
          <Field label="Delay (min)" htmlFor="delay">
            <Input
              id="delay"
              type="number"
              min="1"
              className="num"
              value={draft.retry_delay_minutes}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft({ ...draft, retry_delay_minutes: e.target.value })
              }
            />
          </Field>
        </div>

        <div className="mt-4">
          <div className="eyebrow mb-2">Retry on</div>
          <div className="flex flex-wrap gap-1">
            {RETRY_STATUSES.map((status) => {
              const on = draft.retry_on_statuses.includes(status);
              return (
                <button
                  key={status}
                  disabled={!canEdit}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      retry_on_statuses: on
                        ? draft.retry_on_statuses.filter((s) => s !== status)
                        : [...draft.retry_on_statuses, status],
                    })
                  }
                  className={
                    on
                      ? "rounded border border-signal bg-signal px-2.5 py-1 font-mono text-[11px] text-void"
                      : "rounded border border-edge bg-void px-2.5 py-1 font-mono text-[11px] text-ash hover:text-chalk"
                  }
                >
                  {status.replace("_", " ")}
                </button>
              );
            })}
          </div>
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="display text-sm font-semibold text-chalk">
          Machine detection & recording
        </h2>
        <div className="mt-4 space-y-3">
          <Toggle
            label="Detect answering machines"
            hint="Async detection connects the call immediately and delivers the verdict out of band."
            checked={draft.amd_enabled}
            disabled={!canEdit}
            onChange={(v) => setDraft({ ...draft, amd_enabled: v })}
          />
          {draft.amd_enabled && (
            <>
              <Toggle
                label="Hang up on a machine"
                hint="Otherwise the call is redirected to the voicemail branch."
                checked={draft.hangup_on_machine}
                disabled={!canEdit}
                onChange={(v) => setDraft({ ...draft, hangup_on_machine: v })}
              />
              {!draft.hangup_on_machine && (
                <Field label="Voicemail node" htmlFor="vm">
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

          <Toggle
            label="Record calls"
            hint="Many jurisdictions require all-party consent. A disclosure must play first."
            checked={draft.record_calls}
            disabled={!canEdit}
            onChange={(v) => setDraft({ ...draft, record_calls: v })}
          />
          {draft.record_calls && (
            <Field
              label="Disclosure node"
              htmlFor="disclosure"
              hint="Must be reachable before any recording starts."
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
      </Panel>

      {update.error && !update.error.fieldErrors && (
        <div className="lg:col-span-2">
          <ErrorState error={update.error} />
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-3 lg:col-span-2">
          <Button variant="primary" onClick={save} loading={update.isPending}>
            Save changes
          </Button>
          {update.isSuccess && !update.isPending && (
            <span className="text-xs text-live-bright">Saved</span>
          )}
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => rebuild.mutate()}
            loading={rebuild.isPending}
            title="Recomputes counters from the call log. Slow by design."
          >
            Rebuild counters
          </Button>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-signal"
      />
      <span>
        <span className="text-sm text-chalk">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ash">{hint}</span>}
      </span>
    </label>
  );
}
