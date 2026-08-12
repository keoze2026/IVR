/**
 * Create Job — the reference dialer's job form, on this system.
 *
 * A job is a target number, a sound (pool), a caller ID (pool) and a pace.
 * No campaign, no flow authoring, no list upload — the things the reference
 * does not have and this form must not ask for. It posts to the quick-dial
 * builder, which assembles the machinery underneath.
 *
 * The three pacing modes are named and explained exactly where they are
 * chosen, because "ramp" means nothing to someone who has not read the manual.
 */

import { useState } from "react";

import { Button } from "@/components/ui";
import {
  audioPools,
  cliPools,
  useCallerIds,
  useQuickDial,
} from "@/lib/queries/resources";
import type { DialMode } from "@/lib/queries/resources";

const input =
  "w-full rounded border border-steel bg-ink px-3 py-2 text-sm text-chalk placeholder:text-ash/50 focus:border-live-bright focus:outline-none";
const label = "mb-1 block text-xs uppercase tracking-wider text-ash";

export function CreateJobModal({ onClose }: { onClose: () => void }) {
  const callers = useCallerIds();
  const aPools = audioPools.useList();
  const cPools = cliPools.useList();
  const quickDial = useQuickDial();

  const [f, setF] = useState({
    name: "",
    target_number: "",
    cli_source: "",       // caller id OR "pool:<id>"
    audio_source: "say",  // "say" OR "pool:<id>"
    say_text: "This is a call from our office. Thank you.",
    dial_mode: "fixed" as DialMode,
    max_concurrent_channels: 10,
    dial_batch_size: 5,
    dial_interval_seconds: 30,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  // Keys the caller can press. Off by default — a plain broadcast just plays.
  const [dtmfOn, setDtmfOn] = useState(false);
  const [steps, setSteps] = useState<{ digit: string; action: string }[]>([
    { digit: "1", action: "confirm" },
  ]);

  // Schedule. Off by default — a job runs as soon as it is started.
  const [scheduleOn, setScheduleOn] = useState(false);
  const [sched, setSched] = useState({
    schedule_start: "",
    window_start: "09:00",
    window_end: "17:00",
  });

  async function submit(startNow: boolean) {
    const cli = f.cli_source.startsWith("pool:")
      ? { cli_pool: f.cli_source.slice(5) }
      : { caller_id: f.cli_source };
    const audio =
      f.audio_source === "say"
        ? { say_text: f.say_text }
        : { audio_pool: f.audio_source.slice(5) };

    const dtmf = dtmfOn
      ? {
          dtmf_steps: steps
            .filter((s) => s.digit.trim())
            .map((s, i) => ({ order: i + 1, digit: s.digit.trim(), action: s.action })),
        }
      : {};
    const schedule = scheduleOn
      ? {
          // datetime-local has no zone; treat it as the browser's local time
          // and send an absolute instant so the server does not guess.
          schedule_start: sched.schedule_start
            ? new Date(sched.schedule_start).toISOString()
            : undefined,
          window_start: sched.window_start || undefined,
          window_end: sched.window_end || undefined,
        }
      : {};

    await quickDial.mutateAsync({
      name: f.name.trim() || undefined,
      target_number: f.target_number.trim(),
      ...cli,
      ...audio,
      ...dtmf,
      ...schedule,
      dial_mode: f.dial_mode,
      max_concurrent_channels: f.max_concurrent_channels,
      dial_batch_size: f.dial_batch_size,
      dial_interval_seconds: f.dial_interval_seconds,
      cps_limit: 5,
      start_now: startNow,
    } as Parameters<typeof quickDial.mutateAsync>[0]);
    onClose();
  }

  const ready = f.target_number.trim().length > 3 && f.cli_source !== "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-lg rounded-lg border border-steel bg-graphite p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="display text-lg font-semibold text-chalk">Create job</h2>
            <p className="text-sm text-ash">Dial one number with a sound.</p>
          </div>
          <button onClick={onClose} className="text-ash hover:text-chalk">✕</button>
        </div>

        <div className="space-y-5">
          {/* basics */}
          <div>
            <span className={label}>Job name</span>
            <input
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Campaign A"
              className={input}
            />
          </div>

          <div>
            <span className={label}>Target number</span>
            <input
              value={f.target_number}
              onChange={(e) => set("target_number", e.target.value)}
              placeholder="+254700000000"
              className={`${input} font-mono`}
            />
          </div>

          {/* pools */}
          <div>
            <span className={label}>CLI pool / caller ID</span>
            <select
              value={f.cli_source}
              onChange={(e) => set("cli_source", e.target.value)}
              className={input}
            >
              <option value="">Choose who it calls from…</option>
              {(cPools.data?.results ?? []).length > 0 && (
                <optgroup label="CLI pools">
                  {(cPools.data?.results ?? []).map((p) => (
                    <option key={p.id} value={`pool:${p.id}`}>
                      {p.name} ({p.member_count} numbers)
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Single numbers">
                {(callers.data?.results ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.phone_e164}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <span className={label}>Audio pool / message</span>
            <select
              value={f.audio_source}
              onChange={(e) => set("audio_source", e.target.value)}
              className={input}
            >
              <option value="say">Read out a typed message</option>
              {(aPools.data?.results ?? []).length > 0 && (
                <optgroup label="Audio pools">
                  {(aPools.data?.results ?? []).map((p) => (
                    <option key={p.id} value={`pool:${p.id}`}>
                      {p.name} ({p.member_count} sounds)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {f.audio_source === "say" && (
              <textarea
                value={f.say_text}
                onChange={(e) => set("say_text", e.target.value)}
                rows={2}
                className={`${input} mt-2`}
                placeholder="What is spoken to the person"
              />
            )}
          </div>

          {/* concurrency */}
          <div className="border-t border-steel pt-4">
            <span className={label}>Concurrency</span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-xs text-ash">Max concurrency</span>
                <input
                  type="number"
                  min={1}
                  value={f.max_concurrent_channels}
                  onChange={(e) => set("max_concurrent_channels", Number(e.target.value))}
                  className={input}
                />
              </div>
              <div>
                <span className="mb-1 block text-xs text-ash">Concurrency mode</span>
                <select
                  value={f.dial_mode}
                  onChange={(e) => set("dial_mode", e.target.value as DialMode)}
                  className={input}
                >
                  <option value="fixed">Fixed</option>
                  <option value="pulse">Pulse</option>
                  <option value="ramp">Ramp</option>
                </select>
              </div>
              {f.dial_mode !== "fixed" && (
                <>
                  <div>
                    <span className="mb-1 block text-xs text-ash">
                      {f.dial_mode === "ramp" ? "Ramp interval (s)" : "Pulse interval (s)"}
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={f.dial_interval_seconds}
                      onChange={(e) => set("dial_interval_seconds", Number(e.target.value))}
                      className={input}
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ash">
                      {f.dial_mode === "ramp" ? "Ramp step" : "Pulse size"}
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={f.dial_batch_size}
                      onChange={(e) => set("dial_batch_size", Number(e.target.value))}
                      className={input}
                    />
                  </div>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-ash">
              {f.dial_mode === "fixed" && "Dial as fast as pacing allows until every line is busy."}
              {f.dial_mode === "pulse" &&
                `Release ${f.dial_batch_size} calls every ${f.dial_interval_seconds}s until the line limit.`}
              {f.dial_mode === "ramp" &&
                `Release ${f.dial_batch_size} calls per ${f.dial_interval_seconds}s, at random moments.`}
            </p>
          </div>

          {/* DTMF steps */}
          <div className="border-t border-steel pt-4">
            <label className="flex items-center gap-2 text-sm text-chalk">
              <input
                type="checkbox"
                checked={dtmfOn}
                onChange={(e) => setDtmfOn(e.target.checked)}
                className="accent-live-bright"
              />
              Let the caller press a key
            </label>
            {dtmfOn && (
              <div className="mt-3 space-y-2">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-6 text-xs text-ash">{i + 1}</span>
                    <input
                      value={s.digit}
                      maxLength={1}
                      onChange={(e) =>
                        setSteps(steps.map((x, j) => (j === i ? { ...x, digit: e.target.value } : x)))
                      }
                      placeholder="1"
                      className={`${input} w-16 text-center font-mono`}
                    />
                    <select
                      value={s.action}
                      onChange={(e) =>
                        setSteps(steps.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))
                      }
                      className={input}
                    >
                      <option value="confirm">Confirm / count them in</option>
                      <option value="opt_out">Opt out — stop calling them</option>
                      <option value="repeat">Repeat the message</option>
                      <option value="hangup">Hang up</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                      className="text-rust"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSteps([...steps, { digit: "", action: "confirm" }])}
                >
                  + Add key
                </Button>
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="border-t border-steel pt-4">
            <label className="flex items-center gap-2 text-sm text-chalk">
              <input
                type="checkbox"
                checked={scheduleOn}
                onChange={(e) => setScheduleOn(e.target.checked)}
                className="accent-live-bright"
              />
              Schedule it for later
            </label>
            {scheduleOn && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <span className="mb-1 block text-xs text-ash">Start date &amp; time</span>
                  <input
                    type="datetime-local"
                    value={sched.schedule_start}
                    onChange={(e) => setSched({ ...sched, schedule_start: e.target.value })}
                    className={input}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-ash">Calling from</span>
                  <input
                    type="time"
                    value={sched.window_start}
                    onChange={(e) => setSched({ ...sched, window_start: e.target.value })}
                    className={input}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-ash">Calling until</span>
                  <input
                    type="time"
                    value={sched.window_end}
                    onChange={(e) => setSched({ ...sched, window_end: e.target.value })}
                    className={input}
                  />
                </div>
              </div>
            )}
          </div>

          {quickDial.error && (
            <p className="text-sm text-rust">{quickDial.error.message}</p>
          )}

          <div className="flex justify-end gap-3 border-t border-steel pt-4">
            <Button type="button" variant="ghost" onClick={() => submit(false)} disabled={!ready || quickDial.isPending}>
              Save as draft
            </Button>
            <Button type="button" onClick={() => submit(true)} disabled={!ready || quickDial.isPending}>
              {quickDial.isPending ? "Starting…" : "Create and start"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
