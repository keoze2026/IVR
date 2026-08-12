/**
 * Quick Dial — the short path to a call.
 *
 * One number, one sound, one pace. Everything on this page maps to something a
 * person can say out loud: "call this number, play this, start now." The heavy
 * campaign builder is still there for lists and branching scripts; this is for
 * when there is nothing to build.
 *
 * The clarity rule that shapes it: the three pacing modes are explained in the
 * words the boss used, right where they are chosen, so nobody has to remember
 * what "ramp" means between the manual and the form.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, EmptyState, Panel } from "@/components/ui";
import {
  useAudioClips,
  useCallerIds,
  useQuickDial,
  useUploadAudio,
  type DialMode,
} from "@/lib/queries/resources";
import { useSession } from "@/lib/session";

const MODES: { value: DialMode; label: string; how: string }[] = [
  {
    value: "fixed",
    label: "Fixed",
    how: "Dial as fast as your pace allows until every line is busy. Best for a small number of calls.",
  },
  {
    value: "pulse",
    label: "Pulse",
    how: "Release a set batch on a steady beat — e.g. 5 calls every 30 seconds — until you hit the line limit.",
  },
  {
    value: "ramp",
    label: "Ramp",
    how: "Like pulse, but the batch trickles out at random moments inside each interval, so calls do not all land at once.",
  },
];

const input =
  "w-full rounded border border-steel bg-ink px-3 py-2 text-sm text-chalk placeholder:text-ash/60 focus:border-live-bright focus:outline-none";
const label = "mb-1 block text-xs uppercase tracking-wider text-ash";

export function QuickDialPage() {
  const navigate = useNavigate();
  const { capabilities } = useSession();
  const callerIds = useCallerIds();
  const clips = useAudioClips();
  const upload = useUploadAudio();
  const quickDial = useQuickDial();

  const [form, setForm] = useState({
    name: "",
    target_number: "",
    caller_id: "",
    sound: "none" as "none" | "say" | string, // "say" or an audio clip id
    say_text: "This is a call from our office. Thank you.",
    dial_mode: "fixed" as DialMode,
    max_concurrent_channels: 10,
    dial_batch_size: 5,
    dial_interval_seconds: 30,
    cps_limit: 5,
  });
  const [uploadName, setUploadName] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const mayDial = capabilities.has("campaign.edit") || capabilities.has("campaign.control");
  const callers = callerIds.data?.results ?? [];
  const sounds = clips.data?.results ?? [];
  const mode = MODES.find((m) => m.value === form.dial_mode)!;

  if (!mayDial) {
    return (
      <EmptyState
        title="You cannot start calls"
        description="Ask an administrator for an operator role if you need to place calls."
      />
    );
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onUpload(file: File | null) {
    if (!file) return;
    const name = uploadName.trim() || file.name.replace(/\.[^.]+$/, "");
    const clip = await upload.mutateAsync({ name, file });
    set("sound", clip.id);
    setUploadName("");
  }

  async function submit(startNow: boolean) {
    const body = {
      name: form.name.trim() || undefined,
      target_number: form.target_number.trim(),
      caller_id: form.caller_id,
      audio: form.sound !== "none" && form.sound !== "say" ? form.sound : null,
      say_text: form.sound === "say" ? form.say_text : undefined,
      dial_mode: form.dial_mode,
      max_concurrent_channels: form.max_concurrent_channels,
      dial_batch_size: form.dial_batch_size,
      dial_interval_seconds: form.dial_interval_seconds,
      cps_limit: form.cps_limit,
      start_now: startNow,
    };
    const res = await quickDial.mutateAsync(body);
    if (startNow && res.started) {
      navigate(`/campaigns/${res.campaign}`);
    } else {
      setResult(
        startNow
          ? "The job was built but could not start — check the campaign for why."
          : "Saved as a draft. Open it from Campaigns to launch when ready.",
      );
    }
  }

  const canSubmit =
    form.target_number.trim().length > 3 &&
    form.caller_id &&
    form.sound !== "none";

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Quick dial</h1>
        <p className="mt-1 text-sm text-ash">
          Call one number with a sound. For calling a whole list, use Campaigns.
        </p>
      </header>

      <Panel>
        <div className="space-y-5">
          {/* number + caller id */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Number to call</span>
              <input
                value={form.target_number}
                onChange={(e) => set("target_number", e.target.value)}
                placeholder="+254700000000"
                className={`${input} font-mono`}
              />
              <span className="mt-1 block text-xs text-ash">
                Include the country code, e.g. +254 for Kenya, +1 for the US.
              </span>
            </label>

            <label className="block">
              <span className={label}>Call from</span>
              <select
                value={form.caller_id}
                onChange={(e) => set("caller_id", e.target.value)}
                className={input}
              >
                <option value="">Choose a caller ID…</option>
                {callers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.phone_e164} {c.friendly_name ? `(${c.friendly_name})` : ""}
                  </option>
                ))}
              </select>
              {callers.length === 0 && (
                <span className="mt-1 block text-xs text-amber">
                  No caller IDs yet. An administrator adds these.
                </span>
              )}
            </label>
          </div>

          {/* the sound */}
          <div>
            <span className={label}>What the person hears</span>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-chalk">
                <input
                  type="radio"
                  checked={form.sound === "say"}
                  onChange={() => set("sound", "say")}
                  className="accent-live-bright"
                />
                Read out a typed message
              </label>
              {form.sound === "say" && (
                <textarea
                  value={form.say_text}
                  onChange={(e) => set("say_text", e.target.value)}
                  rows={2}
                  className={`${input} ml-6 w-[calc(100%-1.5rem)]`}
                  placeholder="Type what should be spoken to the person"
                />
              )}

              {sounds.map((clip) => (
                <label key={clip.id} className="flex items-center gap-2 text-sm text-chalk">
                  <input
                    type="radio"
                    checked={form.sound === clip.id}
                    onChange={() => set("sound", clip.id)}
                    className="accent-live-bright"
                  />
                  {clip.name}
                  {clip.play_url && (
                    <audio controls src={clip.play_url} className="ml-2 h-7" />
                  )}
                </label>
              ))}
            </div>

            {/* upload a new sound */}
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-dashed border-steel p-3">
              <input
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="Name this recording (optional)"
                className={`${input} max-w-[16rem]`}
              />
              <label className="cursor-pointer rounded border border-steel px-3 py-2 text-sm text-ash hover:text-chalk">
                {upload.isPending ? "Uploading…" : "Upload MP3 or WAV"}
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                  className="hidden"
                  onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
                />
              </label>
              {upload.error && (
                <span className="text-xs text-rust">{upload.error.message}</span>
              )}
            </div>
          </div>

          {/* pacing */}
          <div>
            <span className={label}>How fast to dial</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set("dial_mode", m.value)}
                  className={`rounded border px-3 py-2 text-left text-sm ${
                    form.dial_mode === m.value
                      ? "border-live-bright bg-live-bright/10 text-chalk"
                      : "border-steel text-ash hover:text-chalk"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ash">{mode.how}</p>

            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className={label}>Max lines at once</span>
                <input
                  type="number"
                  min={1}
                  value={form.max_concurrent_channels}
                  onChange={(e) => set("max_concurrent_channels", Number(e.target.value))}
                  className={input}
                />
              </label>
              {form.dial_mode !== "fixed" && (
                <>
                  <label className="block">
                    <span className={label}>Calls per batch</span>
                    <input
                      type="number"
                      min={1}
                      value={form.dial_batch_size}
                      onChange={(e) => set("dial_batch_size", Number(e.target.value))}
                      className={input}
                    />
                  </label>
                  <label className="block">
                    <span className={label}>Every … seconds</span>
                    <input
                      type="number"
                      min={1}
                      value={form.dial_interval_seconds}
                      onChange={(e) => set("dial_interval_seconds", Number(e.target.value))}
                      className={input}
                    />
                  </label>
                </>
              )}
            </div>
          </div>

          {quickDial.error && (
            <p className="text-sm text-rust">{quickDial.error.message}</p>
          )}
          {result && <p className="text-sm text-amber">{result}</p>}

          <div className="flex gap-3 border-t border-steel pt-4">
            <Button type="button" disabled={!canSubmit || quickDial.isPending} onClick={() => submit(true)}>
              {quickDial.isPending ? "Starting…" : "Call now"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!canSubmit || quickDial.isPending}
              onClick={() => submit(false)}
            >
              Save as draft
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
