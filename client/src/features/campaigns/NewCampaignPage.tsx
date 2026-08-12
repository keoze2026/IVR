/**
 * Create a campaign.
 *
 * Four steps, each gated on a real constraint rather than on taste:
 * a flow version must be published, a caller ID must be active, at least one
 * list must be attached, and the pacing must sit under ceilings the client
 * cannot read (G-04) — so the server's 400 is surfaced verbatim on the field
 * rather than guessed at with a client-side max.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ClipButton } from "@/components/styled/ClipButton";
import {
  BackLink,
  Button,
  ErrorState,
  Field,
  Input,
  Panel,
  Select,
  cx,
} from "@/components/ui";
import { formatCount } from "@/lib/format";
import { useCreateCampaign } from "@/lib/queries/campaigns";
import {
  useCallerIds,
  useContactLists,
  useFlows,
} from "@/lib/queries/resources";

const STEPS = ["Name", "Flow", "Caller ID", "Lists", "Pace"] as const;

export function NewCampaignPage() {
  const navigate = useNavigate();
  const create = useCreateCampaign();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [flowVersion, setFlowVersion] = useState("");
  const [callerId, setCallerId] = useState("");
  const [lists, setLists] = useState<string[]>([]);
  const [cps, setCps] = useState("1");
  const [channels, setChannels] = useState("30");
  const [scope, setScope] = useState<"marketing" | "informational">("marketing");
  const [dialMode, setDialMode] = useState<"fixed" | "pulse" | "ramp">("fixed");
  const [batchSize, setBatchSize] = useState("5");
  const [interval, setIntervalSecs] = useState("30");

  const flows = useFlows();
  const callerIds = useCallerIds({ is_active: "true" });
  const contactLists = useContactLists();

  // Only published versions can be pinned — the serializer rejects drafts.
  const publishable = (flows.data?.results ?? []).filter(
    (f) => f.published_version !== null,
  );

  const complete = [
    name.trim().length > 0,
    flowVersion !== "",
    callerId !== "",
    lists.length > 0,
    true,
  ];

  async function submit() {
    const campaign = await create.mutateAsync({
      name: name.trim(),
      flow_version: flowVersion,
      caller_id: callerId,
      contact_lists: lists,
      cps_limit: Number(cps),
      max_concurrent_channels: Number(channels),
      dial_mode: dialMode,
      dial_batch_size: Number(batchSize),
      dial_interval_seconds: Number(interval),
      consent_scope: scope,
      requires_consent: true,
    });
    navigate(`/campaigns/${campaign.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <BackLink to="/campaigns">Campaigns</BackLink>
        <h1 className="display mt-2 text-2xl font-semibold text-chalk">
          New campaign
        </h1>
        <p className="mt-1 text-sm text-ash">
          Nothing dials until you run the launch checks and start it.
        </p>
      </header>

      {/* Steps are numbered because they are genuinely sequential — you
          cannot choose a caller ID before you know what you are dialing. */}
      <ol className="flex flex-wrap gap-1">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              onClick={() => setStep(i)}
              disabled={i > 0 && !complete[i - 1]}
              className={cx(
                "press flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs disabled:opacity-40",
                i === step
                  ? "border-signal bg-signal/10 text-chalk"
                  : complete[i]
                    ? "border-edge-bright bg-panel text-ash hover:text-chalk"
                    : "border-edge bg-panel text-ash-dim",
              )}
            >
              <span className="num text-[10px]">{i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <Panel className="p-5">
        {step === 0 && (
          <Field
            label="Campaign name"
            htmlFor="name"
            hint="Something you will recognise in a list at 3am."
            error={create.error?.messageFor("name")}
          >
            <Input
              id="name"
              value={name}
              autoFocus
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
              placeholder="August renewals — wave 2"
            />
          </Field>
        )}

        {step === 1 && (
          <Field
            label="Flow version"
            htmlFor="flow"
            hint="Only published versions can be pinned. Publishing freezes a version so editing a flow never changes calls already in flight."
            error={create.error?.messageFor("flow_version")}
          >
            {publishable.length === 0 ? (
              <p className="rounded border border-edge bg-void px-3 py-3 text-sm text-ash">
                No published flows yet.{" "}
                <Link to="/flows" className="text-signal hover:underline">
                  Build one first
                </Link>
                .
              </p>
            ) : (
              <Select
                id="flow"
                value={flowVersion}
                onChange={(e) => setFlowVersion(e.target.value)}
              >
                <option value="">Choose a flow…</option>
                {publishable.map((flow) => (
                  <option key={flow.id} value={flow.published_version!.id}>
                    {flow.name} — v{flow.published_version!.version}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Field
              label="Caller ID"
              htmlFor="caller"
              hint="Attestation is assigned by the carrier. Anything below A is more likely to be labelled or blocked."
              error={create.error?.messageFor("caller_id")}
            >
              <Select
                id="caller"
                value={callerId}
                onChange={(e) => setCallerId(e.target.value)}
              >
                <option value="">Choose a number…</option>
                {(callerIds.data?.results ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.phone_e164}
                    {c.friendly_name ? ` · ${c.friendly_name}` : ""} — signs{" "}
                    {c.attestation}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Consent scope"
              htmlFor="scope"
              hint="Marketing always requires consent on file. Informational may be exempt — check with counsel, not with this form."
            >
              <Select
                id="scope"
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as "marketing" | "informational")
                }
              >
                <option value="marketing">Marketing</option>
                <option value="informational">Informational</option>
              </Select>
            </Field>
          </div>
        )}

        {step === 3 && (
          <Field
            label="Contact lists"
            hint="Reachable counts exclude anything already suppressed."
            error={create.error?.messageFor("contact_lists")}
          >
            <div className="space-y-1.5">
              {(contactLists.data?.results ?? []).map((list) => {
                const checked = lists.includes(list.id);
                return (
                  <label
                    key={list.id}
                    className={cx(
                      "flex cursor-pointer items-center gap-3 rounded border px-3 py-2.5 transition-colors",
                      checked
                        ? "border-signal/40 bg-signal/[0.06]"
                        : "border-edge bg-void hover:border-edge-bright",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setLists(
                          e.target.checked
                            ? [...lists, list.id]
                            : lists.filter((id) => id !== list.id),
                        )
                      }
                      className="size-4 accent-signal"
                    />
                    <span className="flex-1 text-sm text-chalk">{list.name}</span>
                    <span className="num text-xs text-ash">
                      {formatCount(list.reachable_rows)} reachable
                    </span>
                  </label>
                );
              })}
              {(contactLists.data?.results ?? []).length === 0 && (
                <p className="rounded border border-edge bg-void px-3 py-3 text-sm text-ash">
                  No lists yet.{" "}
                  <Link to="/contact-lists" className="text-signal hover:underline">
                    Upload one
                  </Link>
                  .
                </p>
              )}
            </div>
          </Field>
        )}

        {step === 4 && (
          <div className="space-y-5">
            {/* Dial mode — the boss's Fixed / Pulse / Ramp, on the form that
                actually creates a campaign. */}
            <div>
              <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
                How calls are released
              </span>
              <div className="grid gap-2 sm:grid-cols-3">
                {([
                  ["fixed", "Fixed", "Dial as fast as the pace allows until every line is busy."],
                  ["pulse", "Pulse", "A set batch on a steady beat — e.g. 5 calls every 30 seconds."],
                  ["ramp", "Ramp", "The batch trickles out at random moments inside each interval."],
                ] as const).map(([value, label, how]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDialMode(value)}
                    className={cx(
                      "rounded border px-3 py-2 text-left text-sm",
                      dialMode === value
                        ? "border-signal bg-signal/10 text-chalk"
                        : "border-edge text-ash hover:text-chalk",
                    )}
                  >
                    <span className="block font-semibold">{label}</span>
                    <span className="mt-0.5 block text-xs text-ash">{how}</span>
                  </button>
                ))}
              </div>
            </div>

            {dialMode !== "fixed" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Calls per batch" htmlFor="batch">
                  <Input
                    id="batch"
                    type="number"
                    min="1"
                    value={batchSize}
                    onChange={(e) => setBatchSize(e.target.value)}
                    className="num"
                  />
                </Field>
                <Field label="Every … seconds" htmlFor="interval">
                  <Input
                    id="interval"
                    type="number"
                    min="1"
                    value={interval}
                    onChange={(e) => setIntervalSecs(e.target.value)}
                    className="num"
                  />
                </Field>
              </div>
            )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Calls per second"
              htmlFor="cps"
              hint="How fast new calls are placed. This limit applies to your whole account."
              error={create.error?.messageFor("cps_limit")}
            >
              <Input
                id="cps"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={cps}
                onChange={(e) => setCps(e.target.value)}
                className="num"
              />
            </Field>
            <Field
              label="Concurrent channels"
              htmlFor="channels"
              hint="How many calls may be live at once. Bounded by your line capacity, and by how many agents are free."
              error={create.error?.messageFor("max_concurrent_channels")}
            >
              <Input
                id="channels"
                type="number"
                min="1"
                value={channels}
                onChange={(e) => setChannels(e.target.value)}
                className="num"
              />
            </Field>
            <p className="text-xs text-ash sm:col-span-2">
              At {cps || 0} calls/sec with 30-second calls you would settle
              around{" "}
              <span className="num text-chalk">
                {Math.round(Number(cps || 0) * 30)}
              </span>{" "}
              concurrent channels. If that is above your trunk capacity the
              carrier starts refusing calls.
            </p>
          </div>
          </div>
        )}

        {create.error && !create.error.fieldErrors && (
          <div className="mt-4">
            <ErrorState error={create.error} />
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-edge pt-4">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              disabled={!complete[step]}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </Button>
          ) : (
            <ClipButton
              disabled={!complete.every(Boolean) || create.isPending}
              onClick={() => void submit()}
            >
              {create.isPending ? "Creating…" : "Create campaign"}
            </ClipButton>
          )}
        </div>
      </Panel>
    </div>
  );
}
