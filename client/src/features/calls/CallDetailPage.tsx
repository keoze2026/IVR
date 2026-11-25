/**
 * One call, reconstructed.
 *
 * This is the screen someone opens when a complaint lands, so it answers the
 * questions a complaint raises: when did it ring, who or what answered, which
 * way through the flow did they go, what did they press, and what did it cost.
 *
 * Recording access is a button, not a fetch on mount — every access is audited
 * server-side, and loading a page should not create an audit record.
 */

import { useParams } from "react-router-dom";

import { PulseLoader } from "@/components/styled/PulseLoader";
import {
  BackLink,
  Badge,
  Button,
  ErrorState,
  PageHeader,
  Panel,
  PanelHeader,
  Stat,
  StatusPill,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { ApiError } from "@/lib/errors";
import { formatCost, formatDateTime, formatDuration } from "@/lib/format";
import { useCall, useCallEvents, useRecording } from "@/lib/queries/resources";
import { useCan } from "@/lib/session";

import { DispositionBadge } from "./CallsTable";

export function CallDetailPage() {
  const { id } = useParams();
  const { data: call, isLoading, error, refetch } = useCall(id);
  const events = useCallEvents(id);
  const recording = useRecording();
  const canListen = useCan("recordings.listen");

  if (isLoading) return <PulseLoader label="Loading call" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!call) return null;

  const timeline = [
    ["Placed", call.initiated_at],
    ["Ringing", call.ringing_at],
    ["Answered", call.answered_at],
    ["Ended", call.ended_at],
  ] as const;

  const purged =
    recording.error instanceof ApiError &&
    recording.error.code === "recording_purged";
  const eventRows = events.data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink to="/calls">Calls</BackLink>
        <PageHeader
          title={call.to_masked}
          subtitle={call.provider_call_sid}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={call.status} />
              {call.disposition && <DispositionBadge value={call.disposition} />}
            </div>
          }
        />
      </div>

      {call.error_code && (
        <Panel className="border-rust/40 px-4 py-3.5">
          <h2 className="display text-sm font-semibold text-rust">Carrier error</h2>
          <p className="num mt-1 break-words text-sm text-chalk">{call.error_code}</p>
          {call.error_message && (
            <p className="mt-1 break-words text-sm text-ash">{call.error_message}</p>
          )}
          {call.sip_response_code && (
            <p className="num mt-1 text-xs text-ash-dim">
              SIP {call.sip_response_code}
            </p>
          )}
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Talk time" value={formatDuration(call.duration_seconds)} />
        <Stat label="Ring time" value={formatDuration(call.ring_seconds)} />
        <Stat
          label="Cost"
          value={formatCost(call.cost, call.cost_currency, call.cost_reconciled)}
          tone={call.cost_reconciled ? undefined : "amber"}
          denominator={
            call.cost_reconciled
              ? undefined
              : "The carrier has not settled this yet. The figure will rise."
          }
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {canListen && (
            // A header with nothing under it needs no dividing line.
            <Panel className="[&>:last-child]:border-b-0">
              <PanelHeader
                title="Recording"
                hint="Opening a recording is written to the audit log."
                action={
                  <Button
                    variant="primary"
                    onClick={() => recording.mutate(call.id)}
                    loading={recording.isPending}
                    className="shrink-0"
                  >
                    Fetch
                  </Button>
                }
              />
              {(recording.data || recording.error) && (
                <div className="space-y-2 p-4">
                  {recording.data?.url && (
                    <audio
                      controls
                      src={recording.data.url}
                      className="w-full"
                      preload="none"
                    />
                  )}
                  {recording.data && recording.data.url === null && (
                    <p className="text-sm text-ash">This call was never recorded.</p>
                  )}
                  {recording.data?.requires_carrier_auth && (
                    <p className="text-sm text-amber">
                      Stored at the carrier — the link needs their credentials.
                    </p>
                  )}
                  {purged && (
                    <p className="text-sm text-ash">
                      Deleted under the retention policy.
                    </p>
                  )}
                  {recording.error && !purged && (
                    <ErrorState error={recording.error} />
                  )}
                </div>
              )}
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHeader title="Path through the flow" />
            <div className="p-4">
              {call.node_path.length === 0 ? (
                <p className="text-sm text-ash">The call never entered the flow.</p>
              ) : (
                <ol className="flex flex-wrap items-center gap-1.5">
                  {call.node_path.map((node, i) => (
                    <li key={`${node}-${i}`} className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cx(
                          "num break-all rounded-lg border px-2.5 py-1.5 text-xs",
                          node === call.terminal_node
                            ? "border-signal/40 bg-live font-medium text-live-bright"
                            : "border-edge bg-void text-chalk",
                        )}
                      >
                        {node}
                      </span>
                      {i < call.node_path.length - 1 && (
                        <span className="text-ash-dim" aria-hidden>
                          →
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {call.dtmf.length > 0 && (
              <div className="border-t border-edge">
                <div className="eyebrow px-5 pt-3">Keypresses</div>
                <ul className="divide-y divide-edge">
                  {call.dtmf.map((press, i) => (
                    <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span
                        className={cx(
                          "num inline-flex min-w-8 items-center justify-center rounded-lg px-2 py-1 font-medium",
                          press.is_valid
                            ? "bg-live text-live-bright"
                            : "bg-warn-soft text-amber",
                        )}
                      >
                        {press.digits}
                      </span>
                      <span className="num break-all text-xs text-ash">{press.node_id}</span>
                      {press.latency_ms !== null && (
                        <span className="num ml-auto text-xs text-ash-dim">
                          {press.latency_ms}ms
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Carrier callbacks"
              hint="The audit trail if a carrier disputes what happened."
            />
            {events.isLoading && <TableSkeleton rows={3} />}
            {events.error && (
              <div className="p-4">
                <ErrorState error={events.error} onRetry={() => void events.refetch()} />
              </div>
            )}
            {events.data && eventRows.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-ash">
                No callbacks recorded.
              </p>
            )}
            {eventRows.length > 0 && (
              <ul className="max-h-80 divide-y divide-edge overflow-y-auto">
                {eventRows.map((event, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <span className="num break-all text-xs text-chalk">{event.event_type}</span>
                    {event.sequence_number !== null && (
                      <span className="num text-[11px] text-ash-dim">
                        #{event.sequence_number}
                      </span>
                    )}
                    {!event.signature_valid && <Badge tone="bad">unsigned</Badge>}
                    <span className="num ml-auto text-xs text-ash">
                      {formatDateTime(event.received_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title="Timeline" />
            <ol className="px-4 pt-4">
              {timeline.map(([label, at], i) => (
                <li key={label} className="flex gap-3">
                  <div className="flex flex-col items-center pt-1">
                    <span
                      className={cx(
                        "size-2.5 rounded-full",
                        at ? "bg-signal" : "bg-edge-bright",
                      )}
                      aria-hidden
                    />
                    {i < timeline.length - 1 && (
                      <span
                        className={cx("w-px flex-1", at ? "bg-signal" : "bg-edge")}
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="pb-4">
                    <div className={cx("text-sm", at ? "text-chalk" : "text-ash-dim")}>
                      {label}
                    </div>
                    <div className="num text-xs text-ash">
                      {at ? formatDateTime(at) : "did not happen"}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
