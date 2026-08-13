/**
 * Flows and their versions.
 *
 * A published version is immutable — campaigns pin one, so editing a flow must
 * never change calls already in flight. The only action on a published version
 * is therefore Clone, which is presented as the primary path rather than as a
 * consolation for not being able to edit.
 */

import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ClipButton } from "@/components/styled/ClipButton";
import { PulseLoader } from "@/components/styled/PulseLoader";
import {
  BackLink,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Panel,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  useCloneVersion,
  useCreateFlow,
  useCreateVersion,
  useFlow,
  useFlowVersions,
  useFlows,
} from "@/lib/queries/resources";
import { useCan } from "@/lib/session";
import type { FlowDefinition, FlowVersion } from "@/types/domain";

/** A minimal legal flow: greeting, a menu with an opt-out, and a goodbye. */
const STARTER: FlowDefinition = {
  schema_version: "1.0",
  entry: "greeting",
  default_locale: "en",
  nodes: {
    greeting: {
      type: "play",
      label: "Greeting",
      prompt: {
        kind: "tts",
        text: "Hello {{first_name}}, this is {{organization_name}}.",
      },
      next: "menu",
    },
    menu: {
      type: "menu",
      label: "Main menu",
      prompt: {
        kind: "tts",
        text: "Press 1 to confirm. Press 9 to be removed from our list.",
      },
      options: { "1": "confirm", "9": "optout" },
      timeout_seconds: 5,
      max_attempts: 2,
      on_timeout: "goodbye",
      on_invalid: "goodbye",
    },
    confirm: {
      type: "play",
      prompt: { kind: "tts", text: "Thank you." },
      disposition: "confirmed",
      next: "goodbye",
    },
    optout: {
      type: "opt_out",
      scope: "organization",
      prompt: { kind: "tts", text: "You will not be called again." },
    },
    goodbye: { type: "hangup", prompt: { kind: "tts", text: "Goodbye." } },
  },
};

export function FlowsPage() {
  const canEdit = useCan("flow.edit");
  const { data, isLoading, error, refetch } = useFlows();
  const createFlow = useCreateFlow();
  const createVersion = useCreateVersion();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = data?.results ?? [];

  async function create() {
    const flow = await createFlow.mutateAsync({ name: name.trim() });
    // A flow with no version is not useful, so seed a draft immediately.
    await createVersion.mutateAsync({ flow: flow.id, definition: STARTER });
    setName("");
    setCreating(false);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Flows</h1>
          <p className="mt-1 text-sm text-ash">
            What the caller hears, and where each keypress leads. Node types are
            fixed and every transition is checked before a flow can go live.
          </p>
        </div>
        {canEdit && !creating && (
          <ClipButton onClick={() => setCreating(true)}>New flow</ClipButton>
        )}
      </header>

      {creating && (
        <Panel className="p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field
                label="Flow name"
                htmlFor="flow-name"
                error={createFlow.error?.messageFor("name")}
              >
                <Input
                  id="flow-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Appointment reminder"
                />
              </Field>
            </div>
            <Button
              variant="primary"
              disabled={!name.trim()}
              loading={createFlow.isPending || createVersion.isPending}
              onClick={() => void create()}
            >
              Create
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </Panel>
      )}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton />}
        {data && rows.length === 0 && !creating && (
          <EmptyState
            title="No flows yet"
            description="A flow is a small graph of typed nodes. It cannot run arbitrary code, and every destination it dials must be pre-approved."
            action={
              canEdit ? (
                <ClipButton onClick={() => setCreating(true)}>
                  Create a flow
                </ClipButton>
              ) : undefined
            }
          />
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-edge">
            {rows.map((flow) => (
              <li key={flow.id}>
                <Link
                  to={`/flows/${flow.id}`}
                  className="group flex items-center gap-4 px-4 py-3.5 hover:bg-raised"
                >
                  <div className="min-w-0 flex-1">
                    <span className="display font-medium text-chalk group-hover:text-signal">
                      {flow.name}
                    </span>
                    {flow.description && (
                      <p className="mt-0.5 truncate text-xs text-ash">
                        {flow.description}
                      </p>
                    )}
                  </div>

                  {flow.published_version ? (
                    <span className="num rounded border border-live-bright/40 px-2 py-0.5 text-[11px] text-live-bright">
                      live v{flow.published_version.version}
                    </span>
                  ) : (
                    <span className="rounded border border-edge px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-ash-dim">
                      never published
                    </span>
                  )}

                  {flow.latest_version && !flow.latest_version.is_published && (
                    <span className="num rounded border border-signal/40 px-2 py-0.5 text-[11px] text-signal">
                      draft v{flow.latest_version.version}
                    </span>
                  )}

                  <span className="w-24 text-right text-xs text-ash">
                    {formatRelative(flow.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// --- version history --------------------------------------------------

export function FlowVersionsPage() {
  const { id } = useParams();
  const canEdit = useCan("flow.edit");
  const flow = useFlow(id);
  const versions = useFlowVersions(id);
  const clone = useCloneVersion();

  if (flow.isLoading || versions.isLoading)
    return <PulseLoader label="Loading flow" />;
  if (flow.error) return <ErrorState error={flow.error} />;
  if (!flow.data) return null;

  const list = versions.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <BackLink to="/flows">Flows</BackLink>
        <h1 className="display mt-2 text-2xl font-semibold text-chalk">
          {flow.data.name}
        </h1>
        <p className="mt-1 text-sm text-ash">
          Every edit is a new version. Publishing freezes one so campaigns can
          pin it.
        </p>
      </header>

      <Panel className="overflow-hidden">
        <ul className="divide-y divide-edge">
          {list.map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              canEdit={canEdit}
              onClone={() => clone.mutate(version.id)}
              cloning={clone.isPending}
            />
          ))}
          {list.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-ash">
              No versions yet.
            </li>
          )}
        </ul>
      </Panel>
    </div>
  );
}

function VersionRow({
  version,
  canEdit,
  onClone,
  cloning,
}: {
  version: FlowVersion;
  canEdit: boolean;
  onClone: () => void;
  cloning: boolean;
}) {
  const report = version.validation_report;
  const errors = report?.errors.length ?? 0;
  const warnings = report?.warnings.length ?? 0;

  return (
    <li className="flex flex-wrap items-center gap-4 px-4 py-3.5">
      <span className="num text-lg text-chalk">v{version.version}</span>

      {version.is_published ? (
        <span className="rounded border border-live-bright/40 bg-live px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-live-bright">
          published
        </span>
      ) : (
        <span className="rounded border border-signal/40 bg-panel px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-signal">
          draft
        </span>
      )}

      {errors > 0 && (
        <span className="num text-xs text-rust">{errors} errors</span>
      )}
      {warnings > 0 && (
        <span className="num text-xs text-amber">{warnings} warnings</span>
      )}

      {version.is_published && !version.prompts_rendered_at && (
        <span className="text-xs text-amber">prompts still rendering</span>
      )}

      <span className="ml-auto text-xs text-ash">
        {version.published_at
          ? `published ${formatDateTime(version.published_at)}`
          : `created ${formatRelative(version.created_at)}`}
      </span>

      <div className="flex gap-2">
        <Link to={`/flows/${version.flow}/versions/${version.id}`}>
          <Button variant="secondary">
            {version.is_published ? "Inspect" : "Edit"}
          </Button>
        </Link>
        {canEdit && version.is_published && (
          <Button variant="ghost" onClick={onClone} loading={cloning}>
            Clone to draft
          </Button>
        )}
      </div>
    </li>
  );
}

export { cx };
