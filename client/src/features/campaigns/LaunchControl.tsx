/**
 * Preflight and the lifecycle controls.
 *
 * This is the most consequential interaction in the product, so it is the
 * least automatic. `preflight` is a GET that mutates nothing, so the operator
 * sees every check before committing. Warnings do not block, but launching
 * past them requires `force: true` — which is only ever sent after the
 * operator has read them and ticked a box.
 *
 * The point of that control is that "nobody told me the caller ID had a C
 * attestation" is not something anyone gets to say afterwards. Sending force
 * eagerly would defeat it entirely.
 */

import { useState } from "react";

import { ClipButton } from "@/components/styled/ClipButton";
import { Button, Field, Input, Panel, cx } from "@/components/ui";
import { ApiError } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import {
  allowedTransitions,
  usePauseCampaign,
  usePreflight,
  useResumeCampaign,
  useStartCampaign,
  useStopCampaign,
} from "@/lib/queries/campaigns";
import { useCan } from "@/lib/session";
import type { Campaign, Preflight, PreflightIssue } from "@/types/domain";

/** Plain-language readings of the codes preflight emits. */
const EXPLAIN: Record<string, string> = {
  org_suspended: "The organisation is suspended. Nothing will dial.",
  flow_not_published: "The pinned flow version is still a draft.",
  bad_voicemail_node: "The voicemail node named on this campaign is not in the flow.",
  no_recording_disclosure:
    "Recording is on but no disclosure node plays before it.",
  caller_id_inactive: "The caller ID is switched off.",
  consent_gate_disabled: "Consent checking is off for a marketing campaign.",
  org_requires_consent: "This organisation requires consent and none is on file.",
  no_lists: "No contact list is attached.",
  empty_lists: "Every attached list is empty.",
  nothing_reachable: "Every contact is suppressed. There is nobody left to call.",
  empty_window: "The calling window and the jurisdiction rules do not overlap.",
  prompts_not_rendered: "Prompts are still rendering. Early calls fall back to live speech.",
  attestation_below_a:
    "Caller ID signs below A. Expect more calls to be labelled or blocked.",
  poor_reputation: "This number's reputation score is low.",
  high_suppression: "More than 30% of the list is suppressed.",
  cps_clamped: "Your rate is above the organisation ceiling and will be clamped.",
  channels_clamped: "Your channel limit is above the organisation ceiling.",
  all_weekdays: "This campaign is set to dial seven days a week.",
};

function explain(issue: PreflightIssue): string {
  if (EXPLAIN[issue.code]) return EXPLAIN[issue.code]!;
  // Flow warnings arrive prefixed, e.g. flow_no_opt_out.
  if (issue.code.startsWith("flow_")) {
    return issue.message || `Flow: ${issue.code.slice(5).replace(/_/g, " ")}`;
  }
  return issue.message || issue.code;
}

export function LaunchControl({ campaign }: { campaign: Campaign }) {
  const canControl = useCan("campaign.control");
  const preflight = usePreflight(campaign.id);
  const start = useStartCampaign(campaign.id);
  const pause = usePauseCampaign(campaign.id);
  const resume = useResumeCampaign(campaign.id);
  const stop = useStopCampaign(campaign.id);

  const [ack, setAck] = useState<Preflight | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [hangupLive, setHangupLive] = useState(false);
  const [pauseReason, setPauseReason] = useState("");

  const can = allowedTransitions(campaign.status);
  const report = preflight.data;

  async function launch(force: boolean) {
    try {
      await start.mutateAsync({ force });
      setAck(null);
      setAcknowledged(false);
    } catch (cause) {
      // 422 compliance_blocked carries the whole preflight result in `detail`.
      // Warnings-only launches land here; show them and let the operator
      // acknowledge, then resubmit with force.
      if (cause instanceof ApiError && cause.isComplianceBlock) {
        setAck(cause.detail as Preflight);
      }
    }
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-edge px-4 py-3">
        <div>
          <h2 className="display text-sm font-semibold text-chalk">
            Launch checks
          </h2>
          <p className="mt-0.5 text-xs text-ash">
            Nothing here changes the campaign. Run it before every start.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => void preflight.refetch()}
          loading={preflight.isFetching}
        >
          Re-check
        </Button>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-3 divide-x divide-edge border-b border-edge">
            <Figure label="On the lists" value={formatCount(report.estimate.total)} />
            <Figure
              label="Reachable"
              value={formatCount(report.estimate.reachable)}
              tone={report.estimate.reachable === 0 ? "rust" : "signal"}
            />
            <Figure
              label="Suppressed"
              value={formatCount(report.estimate.suppressed)}
              tone={
                report.estimate.total > 0 &&
                report.estimate.suppressed / report.estimate.total > 0.3
                  ? "amber"
                  : undefined
              }
            />
          </div>

          {(report.errors.length > 0 || report.warnings.length > 0) && (
            <ul className="divide-y divide-edge">
              {report.errors.map((issue) => (
                <IssueRow key={issue.code} issue={issue} level="error" />
              ))}
              {report.warnings.map((issue) => (
                <IssueRow key={issue.code} issue={issue} level="warning" />
              ))}
            </ul>
          )}

          {report.ok && report.warnings.length === 0 && (
            <p className="px-4 py-3 text-sm text-ash">
              Every check passed.
            </p>
          )}
        </>
      )}

      {/* --- actions ---------------------------------------------------- */}
      {canControl && (
        <div className="flex flex-wrap items-center gap-2 border-t border-edge bg-void px-4 py-3">
          {can.start && (
            <ClipButton
              onClick={() => void launch(false)}
              disabled={
                start.isPending ||
                preflight.isLoading ||
                (report?.errors.length ?? 0) > 0
              }
            >
              {campaign.status === "paused" ? "Start again" : "Start dialing"}
            </ClipButton>
          )}

          {can.resume && campaign.status !== "paused" && (
            <Button
              variant="secondary"
              onClick={() => resume.mutate()}
              loading={resume.isPending}
            >
              Resume
            </Button>
          )}

          {can.pause && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Reason (optional)"
                value={pauseReason}
                maxLength={160}
                onChange={(e) => setPauseReason(e.target.value)}
                className="w-56"
              />
              <Button
                onClick={() => pause.mutate({ reason: pauseReason })}
                loading={pause.isPending}
              >
                Pause
              </Button>
            </div>
          )}

          {can.stop && (
            <Button
              variant="ghost"
              className="ml-auto text-rust hover:bg-panel hover:text-rust"
              onClick={() => setConfirmStop(true)}
            >
              Stop permanently
            </Button>
          )}
        </div>
      )}

      {start.error && !start.error.isComplianceBlock && (
        <p className="border-t border-rust/30 bg-panel px-4 py-2.5 text-sm text-rust">
          {start.error.message}
        </p>
      )}

      {/* --- warning acknowledgement ------------------------------------ */}
      {ack && (
        <Dialog
          title="Launch with warnings?"
          onClose={() => {
            setAck(null);
            setAcknowledged(false);
          }}
        >
          <p className="text-sm text-ash">
            These do not block the launch, but they are recorded against it.
            Read them before you continue.
          </p>

          <ul className="mt-4 space-y-2">
            {ack.warnings.map((issue) => (
              <li
                key={issue.code}
                className="rounded border border-amber/30 bg-panel px-3 py-2.5"
              >
                <p className="text-sm text-chalk">{explain(issue)}</p>
              </li>
            ))}
          </ul>

          <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm text-chalk">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 size-4 accent-signal"
            />
            I have read these warnings and want to dial anyway.
          </label>

          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAck(null);
                setAcknowledged(false);
              }}
            >
              Go back
            </Button>
            <ClipButton
              disabled={!acknowledged || start.isPending}
              onClick={() => void launch(true)}
            >
              Start dialing
            </ClipButton>
          </div>
        </Dialog>
      )}

      {/* --- stop confirmation ------------------------------------------ */}
      {confirmStop && (
        <Dialog title="Stop this campaign?" onClose={() => setConfirmStop(false)}>
          <p className="text-sm text-ash">
            Stopping is permanent. Every contact still queued is marked
            exhausted and the campaign cannot be started again. To pause
            temporarily, use Pause instead.
          </p>

          <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm text-chalk">
            <input
              type="checkbox"
              checked={hangupLive}
              onChange={(e) => setHangupLive(e.target.checked)}
              className="mt-0.5 size-4 accent-rust"
            />
            <span>
              Also hang up calls in progress.
              <span className="mt-0.5 block text-xs text-ash">
                Cuts off live callers mid-sentence. Only for a script that must
                stop immediately.
              </span>
            </span>
          </label>

          <div className="mt-5">
            <Field
              label={`Type ${campaign.name} to confirm`}
              htmlFor="confirm-name"
            >
              <Input
                id="confirm-name"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmStop(false)}>
              Keep dialing
            </Button>
            <Button
              variant="danger"
              disabled={typedName !== campaign.name}
              loading={stop.isPending}
              onClick={() =>
                stop.mutate(
                  { hangup_live: hangupLive },
                  { onSuccess: () => setConfirmStop(false) },
                )
              }
            >
              Stop permanently
            </Button>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "signal" | "amber" | "rust";
}) {
  return (
    <div className="px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div
        className={cx(
          "num mt-1.5 text-xl",
          tone === "signal"
            ? "text-signal"
            : tone === "amber"
              ? "text-amber"
              : tone === "rust"
                ? "text-rust"
                : "text-chalk",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function IssueRow({
  issue,
  level,
}: {
  issue: PreflightIssue;
  level: "error" | "warning";
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span
        aria-hidden
        className={cx(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          level === "error" ? "bg-rust" : "bg-amber",
        )}
      />
      <div className="min-w-0">
        <p className="text-sm text-chalk">{explain(issue)}</p>
        <code className="num text-[10px] text-ash-dim">{issue.code}</code>
      </div>
    </li>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    /* Bottom sheet on a phone, centred dialog above `sm`. A centred modal on a
       small screen puts its actions in the middle, where the thumb is not. */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-backdrop/80 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="settle max-h-[88dvh] w-full overflow-y-auto rounded-t-[--radius-shell]
                   border border-edge-bright bg-panel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]
                   shadow-2xl sm:max-w-lg sm:rounded-[--radius-shell] sm:pb-5"
      >
        <h3 className="display text-base font-semibold text-chalk">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
