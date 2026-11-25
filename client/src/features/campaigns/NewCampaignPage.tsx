/**
 * Create a campaign.
 *
 * Five steps, each gated on a real constraint rather than on taste: a flow
 * version must be published, a caller ID must be active, at least one list must
 * be attached, and the pacing must sit under ceilings the client cannot read
 * (G-04) — so the server's 400 is surfaced verbatim on the field rather than
 * guessed at with a client-side max.
 */

import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  BackLink,
  Button,
  ErrorState,
  Field,
  Input,
  PageHeader,
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

const DIAL_MODES = [
  ["fixed", "Fixed", "Dial as fast as the pace allows until every line is busy."],
  ["pulse", "Pulse", "A set batch on a steady beat — e.g. 5 calls every 30 seconds."],
  ["ramp", "Ramp", "The batch trickles out at random moments inside each interval."],
] as const;

/** The fields each step shows, which can carry their own server error. */
const STEP_FIELDS: string[][] = [
  ["name"],
  ["flow_version"],
  ["caller_id", "consent_scope"],
  ["contact_lists"],
  [
    "cps_limit",
    "max_concurrent_channels",
    "dial_batch_size",
    "dial_interval_seconds",
  ],
];

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
  const availableLists = contactLists.data?.results ?? [];
  const loadFailure = flows.error ?? callerIds.error ?? contactLists.error;

  const complete = [
    name.trim().length > 0,
    flowVersion !== "",
    callerId !== "",
    lists.length > 0,
    true,
  ];

  const err = (field: string) => create.error?.messageFor(field);
  // An error about something not on this step needs the summary box.
  const showSummary =
    create.error &&
    (!create.error.fieldErrors ||
      Object.keys(create.error.fieldErrors).some(
        (key) =>
          !STEP_FIELDS[step]!.includes(key) ||
          (dialMode === "fixed" &&
            (key === "dial_batch_size" || key === "dial_interval_seconds")),
      ));

  async function submit() {
    try {
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
    } catch {
      // The reason is shown from create.error; keep the form as it is.
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <BackLink to="/campaigns">Campaigns</BackLink>
        <PageHeader
          title="New campaign"
          subtitle="Nothing dials until you run the launch checks and start it."
        />
      </div>

      {loadFailure && (
        <ErrorState
          error={loadFailure}
          onRetry={() => {
            void flows.refetch();
            void callerIds.refetch();
            void contactLists.refetch();
          }}
        />
      )}

      {/* Steps are numbered because they are genuinely sequential — you
          cannot choose a caller ID before you know what you are dialing. */}
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              disabled={i > 0 && !complete[i - 1]}
              aria-current={i === step ? "step" : undefined}
              className={cx(
                "press flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40",
                i === step
                  ? "neon border-transparent"
                  : complete[i]
                    ? "border-edge-bright bg-panel text-ash hover:text-chalk"
                    : "border-edge bg-panel text-ash-dim",
              )}
            >
              <span className="num text-xs">{i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <Panel className="space-y-4 p-5">
        {step === 0 && (
          <Field
            label="Campaign name"
            htmlFor="name"
            hint="Something you will recognise in a list at 3am."
            error={err("name")}
          >
            <Input
              id="name"
              value={name}
              autoFocus
              maxLength={160}
              invalid={Boolean(err("name"))}
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
            error={err("flow_version")}
          >
            {!flows.isLoading && !flows.error && publishable.length === 0 ? (
              <Missing to="/flows" link="Build one first">
                No published flows yet.
              </Missing>
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
          <>
            <Field
              label="Caller ID"
              htmlFor="caller"
              hint="Attestation is assigned by the carrier. Anything below A is more likely to be labelled or blocked."
              error={err("caller_id")}
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
              error={err("consent_scope")}
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
          </>
        )}

        {step === 3 && (
          <Field
            label="Contact lists"
            hint="Reachable counts exclude anything already suppressed."
            error={err("contact_lists")}
          >
            <div className="space-y-2">
              {availableLists.map((list) => {
                const checked = lists.includes(list.id);
                return (
                  <label
                    key={list.id}
                    className={cx(
                      "flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 transition-colors",
                      checked
                        ? "border-signal bg-live/50"
                        : "border-edge hover:border-edge-bright",
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
                      className="size-4 shrink-0 accent-signal"
                    />
                    <span className="min-w-0 flex-1 text-sm text-chalk [overflow-wrap:anywhere]">
                      {list.name}
                    </span>
                    <span className="num text-xs text-ash">
                      {formatCount(list.reachable_rows)} reachable
                    </span>
                  </label>
                );
              })}
              {contactLists.isLoading && (
                <p className="text-sm text-ash">Loading lists…</p>
              )}
              {!contactLists.isLoading &&
                !contactLists.error &&
                availableLists.length === 0 && (
                  <Missing to="/contact-lists" link="Upload one">
                    No lists yet.
                  </Missing>
                )}
            </div>
          </Field>
        )}

        {step === 4 && (
          <>
            <div role="group" aria-label="How calls are released">
              <div className="eyebrow mb-1.5">How calls are released</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {DIAL_MODES.map(([value, label, how]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={dialMode === value}
                    onClick={() => setDialMode(value)}
                    className={cx(
                      "press rounded-xl border px-3 py-2.5 text-left text-sm",
                      dialMode === value
                        ? "border-signal bg-live/50 text-chalk"
                        : "border-edge text-ash hover:border-edge-bright",
                    )}
                  >
                    <span className="block font-medium text-chalk">{label}</span>
                    <span className="mt-0.5 block text-xs text-ash">{how}</span>
                  </button>
                ))}
              </div>
            </div>

            {dialMode !== "fixed" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Calls per batch"
                  htmlFor="batch"
                  error={err("dial_batch_size")}
                >
                  <Input
                    id="batch"
                    type="number"
                    min="1"
                    value={batchSize}
                    onChange={(e) => setBatchSize(e.target.value)}
                    className="num"
                  />
                </Field>
                <Field
                  label="Every … seconds"
                  htmlFor="interval"
                  error={err("dial_interval_seconds")}
                >
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
                error={err("cps_limit")}
              >
                <Input
                  id="cps"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={cps}
                  invalid={Boolean(err("cps_limit"))}
                  onChange={(e) => setCps(e.target.value)}
                  className="num"
                />
              </Field>
              <Field
                label="Concurrent channels"
                htmlFor="channels"
                hint="How many calls may be live at once. Bounded by your line capacity, and by how many agents are free."
                error={err("max_concurrent_channels")}
              >
                <Input
                  id="channels"
                  type="number"
                  min="1"
                  value={channels}
                  invalid={Boolean(err("max_concurrent_channels"))}
                  onChange={(e) => setChannels(e.target.value)}
                  className="num"
                />
              </Field>
            </div>
            <p className="rounded-xl bg-void px-3 py-2.5 text-xs text-ash">
              At {cps || 0} calls/sec with 30-second calls you would settle
              around{" "}
              <span className="num font-medium text-chalk">
                {Math.round(Number(cps || 0) * 30)}
              </span>{" "}
              concurrent channels. If that is above your trunk capacity the
              carrier starts refusing calls.
            </p>
          </>
        )}

        {showSummary && <ErrorState error={create.error} />}
        {create.error && !showSummary && (
          <p role="alert" className="text-sm text-rust">
            Check the highlighted fields.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-edge pt-4">
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
            <Button
              variant="primary"
              disabled={!complete.every(Boolean) || create.isPending}
              onClick={() => void submit()}
            >
              {create.isPending ? "Creating…" : "Create campaign"}
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}

/** A required resource that does not exist yet, with the way to make one. */
function Missing({
  to,
  link,
  children,
}: {
  to: string;
  link: string;
  children: ReactNode;
}) {
  return (
    <p className="rounded-xl bg-void px-3 py-3 text-sm text-ash">
      {children}{" "}
      <Link to={to} className="font-medium text-signal hover:underline">
        {link}
      </Link>
    </p>
  );
}
