/**
 * New job.
 *
 * Three questions — who to call, which number to call from, and what to say —
 * with everything else folded under "More options". It posts to the quick-dial
 * builder, which assembles the campaign underneath.
 */

import { useState, type FormEvent } from "react";

import { ChevronIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Button, Field, Input, Modal, Select, Textarea, cx } from "@/components/ui";
import { audioPools, cliPools, useCallerIds, useQuickDial } from "@/lib/queries/resources";
import type { DialMode } from "@/lib/queries/resources";

const ACTIONS = [
  ["confirm", "Confirm"],
  ["repeat", "Replay the message"],
  ["opt_out", "Stop calling me"],
  ["hangup", "Hang up"],
] as const;

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
    max_concurrent_channels: 1,
    dial_batch_size: 5,
    dial_interval_seconds: 30,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const [more, setMore] = useState(false);
  const [steps, setSteps] = useState<{ digit: string; action: string }[]>([]);
  const [sched, setSched] = useState({ start: "", from: "09:00", until: "17:00" });

  const numbers = callers.data?.results ?? [];
  const pools = cPools.data?.results ?? [];
  // With a single number there is nothing to choose, so it is chosen.
  const source =
    f.cli_source || (numbers.length === 1 && pools.length === 0 ? numbers[0]!.id : "");

  const targets = new Set(f.target_number.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean));
  const ready = targets.size > 0 && source !== "";

  async function submit(startNow: boolean) {
    if (!ready) return;
    const cli = source.startsWith("pool:")
      ? { cli_pool: source.slice(5) }
      : { caller_id: source };
    const audio =
      f.audio_source === "say"
        ? { say_text: f.say_text }
        : { audio_pool: f.audio_source.slice(5) };
    const dtmf = steps
      .filter((s) => s.digit.trim())
      .map((s, i) => ({ order: i + 1, digit: s.digit.trim(), action: s.action }));

    try {
      await quickDial.mutateAsync({
        name: f.name.trim() || undefined,
        target_number: f.target_number.trim(),
        ...cli,
        ...audio,
        ...(dtmf.length ? { dtmf_steps: dtmf } : {}),
        // datetime-local has no zone: read it as the browser's local time.
        ...(sched.start
          ? {
              schedule_start: new Date(sched.start).toISOString(),
              window_start: sched.from || undefined,
              window_end: sched.until || undefined,
            }
          : {}),
        dial_mode: f.dial_mode,
        max_concurrent_channels: f.max_concurrent_channels,
        dial_batch_size: f.dial_batch_size,
        dial_interval_seconds: f.dial_interval_seconds,
        cps_limit: 5,
        start_now: startNow,
      });
      onClose();
    } catch {
      // The reason is shown from quickDial.error; keep the form open.
    }
  }

  return (
    <Modal title="New job" subtitle="Call one or more numbers with your message." onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit(true);
        }}
      >
        <Field
          label="Numbers to call"
          htmlFor="targets"
          hint={targets.size ? `${targets.size} number${targets.size > 1 ? "s" : ""}` : "One per line, with country code."}
        >
          <Textarea
            id="targets"
            rows={3}
            autoFocus
            value={f.target_number}
            onChange={(e) => set("target_number", e.target.value)}
            placeholder={"+1 213 555 0100\n+1 213 555 0101"}
          />
        </Field>

        <Field label="Call from" htmlFor="from">
          <Select id="from" value={source} onChange={(e) => set("cli_source", e.target.value)}>
            <option value="">Choose a number…</option>
            {numbers.map((c) => (
              <option key={c.id} value={c.id}>{c.phone_e164} ({c.provider})</option>
            ))}
            {pools.length > 0 && (
              <optgroup label="Number pools">
                {pools.map((p) => (
                  <option key={p.id} value={`pool:${p.id}`}>{p.name} ({p.member_count} numbers)</option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>

        <Field label="Message" htmlFor="audio">
          <Select id="audio" value={f.audio_source} onChange={(e) => set("audio_source", e.target.value)}>
            <option value="say">Read out typed text</option>
            {(aPools.data?.results ?? []).map((p) => (
              <option key={p.id} value={`pool:${p.id}`}>Audio: {p.name}</option>
            ))}
          </Select>
          {f.audio_source === "say" && (
            <Textarea
              rows={2}
              aria-label="Text to read out"
              value={f.say_text}
              onChange={(e) => set("say_text", e.target.value)}
              className="mt-2"
            />
          )}
        </Field>

        <Field label="Calls at the same time" htmlFor="lines">
          <Input
            id="lines"
            type="number"
            min={1}
            max={1000}
            value={f.max_concurrent_channels}
            onChange={(e) => set("max_concurrent_channels", Number(e.target.value))}
            className="max-w-28"
          />
        </Field>

        <div className="border-t border-edge pt-3">
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            className="press flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-signal"
          >
            More options
            <ChevronIcon className={cx("size-4 transition-transform", more && "rotate-180")} />
          </button>

          {more && (
            <div className="mt-3 space-y-5">
              <Field label="Job name" htmlFor="name">
                <Input id="name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Optional" />
              </Field>

              <Field label="Pacing" htmlFor="mode">
                <Select id="mode" value={f.dial_mode} onChange={(e) => set("dial_mode", e.target.value as DialMode)}>
                  <option value="fixed">Fixed: keep every line busy</option>
                  <option value="pulse">Pulse: groups at set intervals</option>
                  <option value="ramp">Ramp: spread out at random moments</option>
                </Select>
                {f.dial_mode !== "fixed" && (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="eyebrow">
                      Calls per step
                      <Input type="number" min={1} value={f.dial_batch_size}
                        onChange={(e) => set("dial_batch_size", Number(e.target.value))} className="mt-1" />
                    </label>
                    <label className="eyebrow">
                      Seconds between steps
                      <Input type="number" min={1} value={f.dial_interval_seconds}
                        onChange={(e) => set("dial_interval_seconds", Number(e.target.value))} className="mt-1" />
                    </label>
                  </div>
                )}
              </Field>

              <div className="space-y-2">
                <span className="eyebrow block">Keypad options</span>
                {steps.map((s, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      aria-label="Key"
                      maxLength={1}
                      placeholder="Key"
                      value={s.digit}
                      onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, digit: e.target.value } : x)))}
                      className="max-w-20 text-center"
                    />
                    <Select
                      aria-label="What the key does"
                      value={s.action}
                      onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))}
                    >
                      {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                    <Button type="button" variant="ghost" aria-label="Remove key"
                      onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" dense onClick={() => setSteps([...steps, { digit: "", action: "confirm" }])}>
                  <PlusIcon className="size-4" /> Add a key
                </Button>
              </div>

              <Field label="Start later" htmlFor="start" hint="Leave empty to start now.">
                <Input id="start" type="datetime-local" value={sched.start}
                  onChange={(e) => setSched({ ...sched, start: e.target.value })} />
                {sched.start && (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="eyebrow">
                      Call from
                      <Input type="time" value={sched.from}
                        onChange={(e) => setSched({ ...sched, from: e.target.value })} className="mt-1" />
                    </label>
                    <label className="eyebrow">
                      Until
                      <Input type="time" value={sched.until}
                        onChange={(e) => setSched({ ...sched, until: e.target.value })} className="mt-1" />
                    </label>
                  </div>
                )}
              </Field>
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
          <Button type="submit" variant="primary" loading={quickDial.isPending} disabled={!ready}>
            Start calling
          </Button>
        </div>
      </form>
    </Modal>
  );
}
