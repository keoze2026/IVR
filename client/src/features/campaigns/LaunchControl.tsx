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

import { PauseIcon, PlayIcon, StopIcon } from "@/components/icons";
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Input,
  Modal,
  Panel,
  PanelHeader,
  TableSkeleton,
  cx,
} from "@/components/ui";
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
  org_suspended: "Your organisation is suspended. No calls will be placed.",
  flow_not_published: "The chosen flow version is still a draft.",
  bad_voicemail_node: "The voicemail step set on this campaign is not in the flow.",
  no_recording_disclosure: "Recording is on but no recording notice plays first.",
  caller_id_inactive: "The caller ID is switched off.",
  consent_gate_disabled: "Consent checking is off for a marketing campaign.",
  org_requires_consent: "Your organisation requires consent and none is on file.",
  no_lists: "No contact list is attached.",
  empty_lists: "Every attached list is empty.",
  nothing_reachable: "Every contact is blocked. There is nobody left to call.",
  empty_window: "Your calling hours fall outside the legally allowed hours.",
  prompts_not_rendered:
    "Audio is still being prepared. Early calls use a computer voice.",
  attestation_below_a:
    "Caller ID signs below A. Expect more calls to be labelled or blocked.",
  poor_reputation: "This number's reputation score is low.",
  high_suppression: "More than 30% of the list is blocked.",
  cps_clamped: "Calls per second is above your account limit and will be lowered.",
  channels_clamped: "Calls at once is above your account limit.",
  all_weekdays: "This campaign calls seven days a week.",
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
  const blocked = (report?.errors.length ?? 0) > 0;
  const ackBlocked = (ack?.errors?.length ?? 0) > 0;
  const startError =
    start.error && !start.error.isComplianceBlock ? start.error.message : null;
  const actionError = startError ?? pause.error?.message ?? resume.error?.message;
  const hasActions = can.start || can.resume || can.pause || can.stop;

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

  function closeAck() {
    setAck(null);
    setAcknowledged(false);
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Launch checks"
        hint="Checking does not start any calls."
        action={
          <Button
            dense
            onClick={() => void preflight.refetch()}
            loading={preflight.isFetching}
          >
            Re-check
          </Button>
        }
      />

      {preflight.isLoading && <TableSkeleton rows={3} />}

      {preflight.error && (
        <div className="p-4">
          <ErrorState
            error={preflight.error}
            onRetry={() => void preflight.refetch()}
          />
        </div>
      )}

      {report && (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
            <Figure label="Contacts" value={formatCount(report.estimate.total)} />
            <Figure
              label="Can be called"
              value={formatCount(report.estimate.reachable)}
              tone={report.estimate.reachable === 0 ? "rust" : "signal"}
            />
            <Figure
              label="Blocked"
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
            <ul className="space-y-2">
              {report.errors.map((issue) => (
                <IssueRow key={issue.code} issue={issue} level="error" />
              ))}
              {report.warnings.map((issue) => (
                <IssueRow key={issue.code} issue={issue} level="warning" />
              ))}
            </ul>
          )}

          {report.ok && report.warnings.length === 0 && (
            <p className="rounded-xl bg-live px-3 py-2.5 text-sm text-live-bright">
              All checks passed.
            </p>
          )}
        </div>
      )}

      {/* --- actions ---------------------------------------------------- */}
      {canControl && hasActions && (
        <div className="space-y-3 border-t border-edge bg-void px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {can.start && (
              <Button
                variant="primary"
                onClick={() => void launch(false)}
                loading={start.isPending && !ack}
                disabled={start.isPending || preflight.isLoading || blocked}
              >
                <PlayIcon className="size-4" />
                {campaign.status === "paused" ? "Start again" : "Start calling"}
              </Button>
            )}

            {can.resume && campaign.status !== "paused" && (
              <Button onClick={() => resume.mutate()} loading={resume.isPending}>
                Resume
              </Button>
            )}

            {can.stop && (
              <Button
                variant="ghost"
                className="ml-auto text-rust hover:text-rust"
                onClick={() => setConfirmStop(true)}
              >
                <StopIcon className="size-4" /> Stop permanently
              </Button>
            )}
          </div>

          {can.start && blocked && (
            <p className="text-xs text-rust">Fix the blocking problems to start.</p>
          )}

          {can.pause && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Pause reason (optional)"
                aria-label="Pause reason (optional)"
                value={pauseReason}
                maxLength={160}
                onChange={(e) => setPauseReason(e.target.value)}
                className="min-w-0 flex-1 basis-48"
              />
              <Button
                onClick={() => pause.mutate({ reason: pauseReason })}
                loading={pause.isPending}
              >
                <PauseIcon className="size-4" /> Pause
              </Button>
            </div>
          )}
        </div>
      )}

      {actionError && !ack && (
        <p role="alert" className="bg-[#fdeaea] px-4 py-3 text-sm text-rust">
          {actionError}
        </p>
      )}

      {/* --- warning acknowledgement ------------------------------------ */}
      {ack && (
        <Modal
          title="Start with warnings?"
          subtitle="Your acceptance is recorded with this launch."
          onClose={closeAck}
        >
          <ul className="space-y-2">
            {ack.errors?.map((issue) => (
              <IssueRow key={issue.code} issue={issue} level="error" />
            ))}
            {ack.warnings.map((issue) => (
              <IssueRow key={issue.code} issue={issue} level="warning" />
            ))}
          </ul>

          <label className="mt-4 flex min-h-9 cursor-pointer items-start gap-3 text-sm text-chalk">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-signal"
            />
            I have read these warnings and want to call anyway.
          </label>

          {startError && (
            <p role="alert" className="mt-3 text-sm text-rust">
              {startError}
            </p>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
            <Button variant="ghost" onClick={closeAck}>
              Go back
            </Button>
            <Button
              variant="primary"
              disabled={!acknowledged || ackBlocked}
              loading={start.isPending}
              onClick={() => void launch(true)}
            >
              Start calling
            </Button>
          </div>
        </Modal>
      )}

      {/* --- stop confirmation ------------------------------------------ */}
      {confirmStop && (
        <Modal title="Stop this campaign?" onClose={() => setConfirmStop(false)}>
          <p className="rounded-xl bg-[#fdeaea] px-3 py-2.5 text-sm text-rust">
            This is permanent. Contacts still waiting will not be called, and the
            campaign cannot be started again. To stop for now, use Pause.
          </p>

          <label className="mt-4 flex min-h-9 cursor-pointer items-start gap-3 text-sm text-chalk">
            <input
              type="checkbox"
              checked={hangupLive}
              onChange={(e) => setHangupLive(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-rust"
            />
            <span>
              Also hang up calls in progress
              <span className="mt-0.5 block text-xs text-ash">
                Cuts people off mid-sentence.
              </span>
            </span>
          </label>

          <div className="mt-4 [overflow-wrap:anywhere]">
            <Field label={`Type ${campaign.name} to confirm`} htmlFor="confirm-name">
              <Input
                id="confirm-name"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          {stop.error && (
            <p role="alert" className="mt-3 text-sm text-rust">
              {stop.error.message}
            </p>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
            <Button variant="ghost" onClick={() => setConfirmStop(false)}>
              Cancel
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
        </Modal>
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
    <div className="min-w-0 rounded-xl border border-edge px-3 py-3">
      <div className="eyebrow">{label}</div>
      <div
        className={cx(
          "num mt-1.5 text-xl font-bold",
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

/** One check result. The raw code stays on hover for support requests. */
function IssueRow({
  issue,
  level,
}: {
  issue: PreflightIssue;
  level: "error" | "warning";
}) {
  return (
    <li
      title={issue.code}
      className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-xl border border-edge px-3 py-2.5"
    >
      <Badge tone={level === "error" ? "bad" : "warn"}>
        {level === "error" ? "Blocks start" : "Warning"}
      </Badge>
      <p className="min-w-0 flex-1 basis-44 text-sm text-chalk [overflow-wrap:anywhere]">
        {explain(issue)}
      </p>
    </li>
  );
}
