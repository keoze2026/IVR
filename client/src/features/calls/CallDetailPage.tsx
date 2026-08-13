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
  Button,
  ErrorState,
  Panel,
  StatusPill,
  cx,
} from "@/components/ui";
import { ApiError } from "@/lib/errors";
import { formatCost, formatDateTime, formatDuration } from "@/lib/format";
import { useCall, useCallEvents, useRecording } from "@/lib/queries/resources";
import { useCan } from "@/lib/session";

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

  return (
    <div className="space-y-6">
      <header>
        <BackLink to="/calls">Calls</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="display num text-2xl font-semibold text-chalk">
            {call.to_masked}
          </h1>
          <StatusPill status={call.status} />
          {call.disposition && (
            <span className="rounded border border-edge-bright px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ash">
              {call.disposition.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <p className="num mt-1.5 text-xs text-ash-dim">
          {call.provider_call_sid}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_1.1fr]">
        <div className="space-y-5">
          {/* --- what happened, in order ------------------------------ */}
          <Panel>
            <div className="border-b border-edge px-4 py-3">
              <h2 className="display text-sm font-semibold text-chalk">
                Timeline
              </h2>
            </div>
            <ol className="px-4 py-4">
              {timeline.map(([label, at], i) => (
                <li key={label} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cx(
                        "size-2 rounded-full",
                        at ? "bg-signal" : "bg-edge",
                      )}
                      aria-hidden
                    />
                    {i < timeline.length - 1 && (
                      <span
                        className={cx(
                          "w-px flex-1",
                          at ? "bg-signal" : "bg-edge",
                        )}
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="pb-4">
                    <div
                      className={cx(
                        "text-sm",
                        at ? "text-chalk" : "text-ash-dim",
                      )}
                    >
                      {label}
                    </div>
                    <div className="num text-xs text-ash">
                      {at ? formatDateTime(at) : "did not happen"}
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <dl className="grid grid-cols-2 divide-x divide-edge border-t border-edge">
              <Cell label="Talk time" value={formatDuration(call.duration_seconds)} />
              <Cell label="Ring time" value={formatDuration(call.ring_seconds)} />
            </dl>
          </Panel>

          {/* --- money ------------------------------------------------ */}
          <Panel className="px-4 py-3.5">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Cost</span>
              <span className="num text-lg text-chalk">
                {formatCost(call.cost, call.cost_currency, call.cost_reconciled)}
              </span>
            </div>
            {!call.cost_reconciled && (
              <p className="mt-1.5 text-xs text-amber">
                The carrier has not settled this yet. The figure will rise.
              </p>
            )}
          </Panel>

          {call.error_code && (
            <Panel className="border-rust/40 px-4 py-3.5">
              <div className="eyebrow text-rust">Carrier error</div>
              <p className="num mt-1.5 text-sm text-chalk">{call.error_code}</p>
              {call.error_message && (
                <p className="mt-1 text-xs text-ash">{call.error_message}</p>
              )}
              {call.sip_response_code && (
                <p className="num mt-1 text-xs text-ash-dim">
                  SIP {call.sip_response_code}
                </p>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          {/* --- the route through the flow --------------------------- */}
          <Panel>
            <div className="border-b border-edge px-4 py-3">
              <h2 className="display text-sm font-semibold text-chalk">
                Path through the flow
              </h2>
            </div>
            <div className="px-4 py-4">
              {call.node_path.length === 0 ? (
                <p className="text-sm text-ash">
                  The call never entered the flow.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {call.node_path.map((node, i) => (
                    <span key={`${node}-${i}`} className="flex items-center gap-1.5">
                      <span
                        className={cx(
                          "num rounded border px-2 py-1 text-xs",
                          node === call.terminal_node
                            ? "border-signal/50 bg-panel text-signal"
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
                    </span>
                  ))}
                </div>
              )}
            </div>

            {call.dtmf.length > 0 && (
              <div className="border-t border-edge">
                <div className="eyebrow px-4 pt-3">Keypresses</div>
                <ul className="divide-y divide-edge">
                  {call.dtmf.map((press, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 px-4 py-2 text-sm"
                    >
                      <span
                        className={cx(
                          "num flex size-7 items-center justify-center rounded border",
                          press.is_valid
                            ? "border-signal/40 text-signal"
                            : "border-amber/40 text-amber",
                        )}
                      >
                        {press.digits}
                      </span>
                      <span className="num text-xs text-ash">{press.node_id}</span>
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

          {/* --- recording -------------------------------------------- */}
          {canListen && (
            <Panel className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="eyebrow">Recording</div>
                  <p className="mt-1 text-xs text-ash">
                    Opening a recording is written to the audit log.
                  </p>
                </div>
                <Button
                  onClick={() => recording.mutate(call.id)}
                  loading={recording.isPending}
                >
                  Fetch
                </Button>
              </div>

              {recording.data?.url && (
                <audio
                  controls
                  src={recording.data.url}
                  className="mt-3 w-full"
                  preload="none"
                />
              )}
              {recording.data && recording.data.url === null && (
                <p className="mt-2 text-sm text-ash">
                  This call was never recorded.
                </p>
              )}
              {recording.data?.requires_carrier_auth && (
                <p className="mt-2 text-xs text-amber">
                  Stored at the carrier — the link needs their credentials.
                </p>
              )}
              {recording.error instanceof ApiError &&
                recording.error.code === "recording_purged" && (
                  <p className="mt-2 text-sm text-ash">
                    Deleted under the retention policy.
                  </p>
                )}
            </Panel>
          )}

          {/* --- raw callbacks ---------------------------------------- */}
          <Panel>
            <div className="border-b border-edge px-4 py-3">
              <h2 className="display text-sm font-semibold text-chalk">
                Carrier callbacks
              </h2>
              <p className="mt-0.5 text-xs text-ash">
                The audit trail if a carrier disputes what happened.
              </p>
            </div>
            <ul className="max-h-72 divide-y divide-edge overflow-y-auto">
              {(events.data ?? []).map((event, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2">
                  <span className="num text-xs text-chalk">{event.event_type}</span>
                  {event.sequence_number !== null && (
                    <span className="num text-[10px] text-ash-dim">
                      #{event.sequence_number}
                    </span>
                  )}
                  {!event.signature_valid && (
                    <span className="font-mono text-[10px] uppercase text-rust">
                      unsigned
                    </span>
                  )}
                  <span className="num ml-auto text-xs text-ash">
                    {formatDateTime(event.received_at)}
                  </span>
                </li>
              ))}
              {(events.data ?? []).length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-ash">
                  No callbacks recorded.
                </li>
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-1 text-sm text-chalk">{value}</dd>
    </div>
  );
}
