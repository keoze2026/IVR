/**
 * Create a campaign.
 *
 * One form, with a summary beside it listing what is still missing. Creation is
 * gated on real constraints: a name, a published flow version, an active caller
 * ID and at least one contact list. The pacing must sit under ceilings the
 * client cannot read (G-04), so the server's 400 is surfaced verbatim on the
 * field rather than guessed at with a client-side max.
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
  PanelHeader,
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

const DIAL_MODES = [
  ["fixed", "Fixed", "Keep every line busy."],
  ["pulse", "Pulse", "A set group of calls at regular intervals."],
  ["ramp", "Ramp", "Each group spread randomly across the interval."],
] as const;

/** Fields that can show their own server error. */
const FIELDS = [
  "name",
  "flow_version",
  "caller_id",
  "consent_scope",
  "contact_lists",
  "cps_limit",
  "max_concurrent_channels",
  "dial_batch_size",
  "dial_interval_seconds",
];

export function NewCampaignPage() {
  const navigate = useNavigate();
  const create = useCreateCampaign();

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

  const required = [
    { label: "Name", done: name.trim().length > 0 },
    { label: "Call flow", done: flowVersion !== "" },
    { label: "Caller ID", done: callerId !== "" },
    { label: "Contact list", done: lists.length > 0 },
  ];
  const ready = required.every((r) => r.done);

  const err = (field: string) => create.error?.messageFor(field);
  const showSummary =
    create.error &&
    (!create.error.fieldErrors ||
      Object.keys(create.error.fieldErrors).some(
        (key) =>
          !FIELDS.includes(key) ||
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
    <div className="space-y-6">
      <div className="space-y-1">
        <BackLink to="/campaigns">Campaigns</BackLink>
        <PageHeader title="New campaign" />
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

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Section title="What to call with">
            <Field label="Campaign name" htmlFor="name" error={err("name")}>
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

            <Field
              label="Call flow"
              htmlFor="flow"
              hint="Only published versions are listed."
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

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Caller ID"
                htmlFor="caller"
                hint="Numbers signing below A are more likely to be labelled or blocked."
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
                label="Consent type"
                htmlFor="scope"
                hint="Marketing always needs consent on file. Informational may be exempt; confirm with a lawyer."
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
            </div>
          </Section>

          <Section title="Contact lists" hint="Counts leave out blocked contacts.">
            <fieldset className="min-w-0 space-y-2">
              <legend className="sr-only">Contact lists</legend>
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
                      {formatCount(list.reachable_rows)} can be called
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
            </fieldset>
            {err("contact_lists") && (
              <p role="alert" className="text-xs text-rust">
                {err("contact_lists")}
              </p>
            )}
          </Section>

          <Section title="Speed">
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
                  label="Calls per group"
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
                  label="Seconds between groups"
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
                hint="Limited across your whole account."
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
                label="Calls at the same time"
                htmlFor="channels"
                hint="Limited by your lines and available agents."
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
              With 30-second calls, this speed means about{" "}
              <span className="num font-medium text-chalk">
                {Math.round(Number(cps || 0) * 30)}
              </span>{" "}
              calls at once. Beyond your line capacity, the carrier refuses calls.
            </p>
          </Section>
        </div>

        <Panel className="overflow-hidden lg:sticky lg:top-4">
          <PanelHeader title="Ready to create?" />
          <div className="space-y-4 p-4">
            <ul className="space-y-2">
              {required.map((item) => (
                <li key={item.label} className="flex items-center gap-2.5 text-sm">
                  <span
                    aria-hidden
                    className={cx(
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-xs",
                      item.done
                        ? "bg-live text-live-bright"
                        : "border border-edge-bright",
                    )}
                  >
                    {item.done ? "✓" : ""}
                  </span>
                  <span className={item.done ? "text-chalk" : "text-ash"}>
                    {item.label}
                  </span>
                  <span className="sr-only">{item.done ? "done" : "missing"}</span>
                </li>
              ))}
            </ul>

            {showSummary && <ErrorState error={create.error} />}
            {create.error && !showSummary && (
              <p role="alert" className="text-sm text-rust">
                Check the highlighted fields.
              </p>
            )}

            <Button
              variant="primary"
              className="w-full"
              disabled={!ready}
              loading={create.isPending}
              onClick={() => void submit()}
            >
              Create campaign
            </Button>
            <p className="text-xs text-ash">
              No calls are placed until you run the launch checks and start.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title={title} hint={hint} />
      <div className="space-y-4 p-4">{children}</div>
    </Panel>
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
