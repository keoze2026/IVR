/**
 * Create Job: a target number, a sound (pool), a caller ID (pool) and a pace.
 * No campaign, no flow authoring, no list upload. It posts to the quick-dial
 * builder, which assembles the machinery underneath.
 *
 * The three pacing modes are named and explained exactly where they are
 * chosen, because "ramp" means nothing to someone who has not read the manual.
 */

import { useState } from "react";

import { TrashIcon } from "@/components/icons";
import { Button, Field, Input, Modal, Select, Textarea, cx } from "@/components/ui";
import { audioPools, cliPools, useCallerIds, useQuickDial } from "@/lib/queries/resources";
import type { DialMode } from "@/lib/queries/resources";

export function CreateJobModal({ onClose }: { onClose: () => void }) {
  const callers = useCallerIds();
  const aPools = audioPools.useList();
  const cPools = cliPools.useList();
  const quickDial = useQuickDial();

  const [f, setF] = useState({
    name: "",
    target_number: "",
    cli_source: "", // caller id OR "pool:<id>"
    audio_source: "say", // "say" OR "pool:<id>"
    say_text: "This is a call from our office. Thank you.",
    dial_mode: "fixed" as DialMode,
    max_concurrent_channels: 10,
    dial_batch_size: 5,
    dial_interval_seconds: 30,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  // DTMF steps: Order / Digit / Delay(s).
  const [dtmfOn, setDtmfOn] = useState(false);
  const [steps, setSteps] = useState<{ digit: string; delay: string }[]>([
    { digit: "1", delay: "2.5" },
  ]);

  // Schedule. Off by default: a job runs as soon as it is started.
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
            .map((s, i) => ({
              order: i + 1,
              digit: s.digit.trim(),
              delay: Number(s.delay) || 0,
            })),
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

    try {
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
    } catch {
      // The reason is shown from quickDial.error; keep the form open.
    }
  }

  const ready = f.target_number.trim().length > 3 && f.cli_source !== "";

  return (
    <Modal
      title="Create job"
      subtitle="Dial one or many numbers with a sound."
      onClose={onClose}
      closeOnEscape={false}
    >
      <div className="space-y-5">
        {/* basics */}
        <Field label="Job name" htmlFor="name">
          <Input
            id="name"
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Campaign A"
          />
        </Field>

        <Field
          label="Target numbers"
          htmlFor="targets"
          hint="One per line (or comma-separated). All dial from this one job — set Max concurrency to how many should ring at once."
        >
          <Textarea
            id="targets"
            rows={4}
            value={f.target_number}
            onChange={(e) => set("target_number", e.target.value)}
            placeholder={"+254700000000\n+254711111111\n+254722222222"}
            className="num"
          />
        </Field>

        {/* pools */}
        <Field label="CLI pool / caller ID" htmlFor="from">
          <Select id="from" value={f.cli_source} onChange={(e) => set("cli_source", e.target.value)}>
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
          </Select>
        </Field>

        <Field label="Audio pool / message" htmlFor="audio">
          <Select id="audio" value={f.audio_source} onChange={(e) => set("audio_source", e.target.value)}>
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
          </Select>
          {f.audio_source === "say" && (
            <Textarea
              rows={2}
              aria-label="What is spoken to the person"
              value={f.say_text}
              onChange={(e) => set("say_text", e.target.value)}
              placeholder="What is spoken to the person"
              className="mt-2"
            />
          )}
        </Field>

        {/* concurrency */}
        <div className="border-t border-edge pt-4">
          <span className="eyebrow mb-1.5 block">Concurrency</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="eyebrow">
              Max concurrency
              <Input
                type="number"
                min={1}
                value={f.max_concurrent_channels}
                onChange={(e) => set("max_concurrent_channels", Number(e.target.value))}
                className="mt-1"
              />
            </label>
            <label className="eyebrow">
              Concurrency mode
              <Select
                value={f.dial_mode}
                onChange={(e) => set("dial_mode", e.target.value as DialMode)}
                className="mt-1"
              >
                <option value="fixed">Fixed</option>
                <option value="pulse">Pulse</option>
                <option value="ramp">Ramp</option>
              </Select>
            </label>
            {f.dial_mode !== "fixed" && (
              <>
                <label className="eyebrow">
                  {f.dial_mode === "ramp" ? "Ramp interval (s)" : "Pulse interval (s)"}
                  <Input
                    type="number"
                    min={1}
                    value={f.dial_interval_seconds}
                    onChange={(e) => set("dial_interval_seconds", Number(e.target.value))}
                    className="mt-1"
                  />
                </label>
                <label className="eyebrow">
                  {f.dial_mode === "ramp" ? "Ramp step" : "Pulse size"}
                  <Input
                    type="number"
                    min={1}
                    value={f.dial_batch_size}
                    onChange={(e) => set("dial_batch_size", Number(e.target.value))}
                    className="mt-1"
                  />
                </label>
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

        {/* DTMF */}
        <div className="border-t border-edge pt-4">
          <label className="flex items-center justify-between text-sm font-medium text-chalk">
            <span>DTMF Enabled</span>
            {/* toggle */}
            <button
              type="button"
              onClick={() => setDtmfOn((v) => !v)}
              className={cx("relative h-5 w-9 rounded-full transition-colors", dtmfOn ? "bg-signal" : "bg-edge-bright")}
              aria-pressed={dtmfOn}
            >
              <span className={cx("absolute top-0.5 size-4 rounded-full bg-white transition-all", dtmfOn ? "left-[18px]" : "left-0.5")} />
            </button>
          </label>

          {dtmfOn && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-chalk">DTMF Steps</span>
                <Button type="button" dense onClick={() => setSteps([...steps, { digit: "", delay: "2.5" }])}>
                  + Add Step
                </Button>
              </div>

              <div className="eyebrow grid grid-cols-[64px_1fr_96px_36px] gap-2 pb-1">
                <span>Order</span>
                <span>Digit</span>
                <span>Delay (s)</span>
                <span />
              </div>

              <div className="space-y-2">
                {steps.map((s, i) => (
                  <div key={i} className="grid grid-cols-[64px_1fr_96px_36px] items-center gap-2">
                    <Input aria-label="Order" value={i + 1} readOnly className="text-center" />
                    <Input
                      aria-label="Digit"
                      value={s.digit}
                      onChange={(e) =>
                        setSteps(steps.map((x, j) => (j === i ? { ...x, digit: e.target.value } : x)))
                      }
                      placeholder="e.g. 1"
                    />
                    <Input
                      aria-label="Delay (s)"
                      value={s.delay}
                      onChange={(e) =>
                        setSteps(steps.map((x, j) => (j === i ? { ...x, delay: e.target.value } : x)))
                      }
                      placeholder="2.5"
                    />
                    <button
                      type="button"
                      onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                      className="press flex size-9 items-center justify-center rounded-full text-rust hover:bg-bad-soft"
                      aria-label="Remove step"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Schedule */}
        <div className="border-t border-edge pt-4">
          <label className="flex items-center gap-2 text-sm font-medium text-chalk">
            <input
              type="checkbox"
              checked={scheduleOn}
              onChange={(e) => setScheduleOn(e.target.checked)}
            />
            Schedule it for later
          </label>
          {scheduleOn && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="eyebrow col-span-2">
                Start date &amp; time
                <Input
                  type="datetime-local"
                  value={sched.schedule_start}
                  onChange={(e) => setSched({ ...sched, schedule_start: e.target.value })}
                  className="mt-1"
                />
              </label>
              <label className="eyebrow">
                Calling from
                <Input
                  type="time"
                  value={sched.window_start}
                  onChange={(e) => setSched({ ...sched, window_start: e.target.value })}
                  className="mt-1"
                />
              </label>
              <label className="eyebrow">
                Calling until
                <Input
                  type="time"
                  value={sched.window_end}
                  onChange={(e) => setSched({ ...sched, window_end: e.target.value })}
                  className="mt-1"
                />
              </label>
            </div>
          )}
        </div>

        {quickDial.error && (
          <p role="alert" className="text-sm text-rust">{quickDial.error.message}</p>
        )}

        <div className="flex justify-end gap-3 border-t border-edge pt-4">
          <Button type="button" variant="ghost" onClick={() => void submit(false)} disabled={!ready || quickDial.isPending}>
            Save as draft
          </Button>
          <Button type="button" variant="primary" onClick={() => void submit(true)} loading={quickDial.isPending} disabled={!ready}>
            {quickDial.isPending ? "Starting…" : "Create and start"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
