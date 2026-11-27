/**
 * Flows and their versions.
 *
 * A published version is immutable — campaigns pin one, so editing a flow must
 * never change calls already in flight. The only action on a published version
 * is therefore Clone, which is presented as the primary path rather than as a
 * consolation for not being able to edit.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { PlusIcon } from "@/components/icons";
import { PulseLoader } from "@/components/styled/PulseLoader";
import {
  BackLink,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  Stat,
  TableSkeleton,
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
import type { FlowDefinition, FlowSummary, FlowVersion } from "@/types/domain";

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
  const navigate = useNavigate();

  const rows = data?.results ?? [];
  const count = (matches: (flow: FlowSummary) => boolean) =>
    data ? String(rows.filter(matches).length) : "—";
  // Counts only cover the flows loaded here; say so when there are more.
  const scope = data?.next ? "In the flows shown" : undefined;

  const pending = createFlow.isPending || createVersion.isPending;
  const nameError = createFlow.error?.messageFor("name");
  const otherError = createVersion.error ?? (nameError ? null : createFlow.error);

  async function create() {
    try {
      const flow = await createFlow.mutateAsync({ name: name.trim() });
      // A flow with no version is not useful, so seed a draft immediately.
      await createVersion.mutateAsync({ flow: flow.id, definition: STARTER });
      setName("");
      setCreating(false);
    } catch {
      // Shown from the mutation's error; the form stays open.
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Flows"
        subtitle="What the caller hears, and where each keypress leads. Node types are fixed and every transition is checked before a flow can go live."
        actions={
          canEdit && !creating && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon className="size-4" /> New flow
            </Button>
          )
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <div className="stat-grid grid gap-4 sm:grid-cols-3">
        <Stat label="Flows" value={data ? String(data.count ?? rows.length) : "—"} />
        <Stat label="Published" value={count((f) => Boolean(f.published_version))} denominator={scope} accent />
        <Stat
          label="Draft"
          value={count((f) => Boolean(f.latest_version && !f.latest_version.is_published))}
          denominator={scope}
        />
      </div>

      {(isLoading || data) && (
        <Panel className="overflow-hidden">
          {isLoading && <TableSkeleton />}
          {data && rows.length === 0 && (
            <div className="p-4 sm:p-6">
              <EmptyState
                title="No flows yet"
                description="A flow is a small graph of typed nodes. It cannot run arbitrary code, and every destination it dials must be pre-approved."
                action={
                  canEdit ? (
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      Create a flow
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Flow</th>
                    <th>Published</th>
                    <th>Draft</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((flow) => (
                    <tr
                      key={flow.id}
                      className="cursor-pointer"
                      onClick={(e) => {
                        // The whole row opens the flow; the name link handles itself.
                        if (!(e.target as HTMLElement).closest("a")) {
                          navigate(`/flows/${flow.id}`);
                        }
                      }}
                    >
                      <td>
                        <Link
                          to={`/flows/${flow.id}`}
                          className="flex min-h-9 flex-col justify-center font-medium text-chalk hover:text-signal"
                        >
                          {flow.name}
                          {flow.description && (
                            <span className="max-w-xs truncate text-xs font-normal text-ash-dim">
                              {flow.description}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td>
                        {flow.published_version ? (
                          <Badge tone="good">live v{flow.published_version.version}</Badge>
                        ) : (
                          <Badge>never published</Badge>
                        )}
                      </td>
                      <td>
                        {flow.latest_version && !flow.latest_version.is_published ? (
                          <Badge tone="info">draft v{flow.latest_version.version}</Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{formatRelative(flow.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {creating && (
        <Modal
          title="New flow"
          onClose={() => setCreating(false)}
          closeOnEscape={false}
          closeOnBackdrop={false}
        >
          <div className="space-y-5">
            <Field label="Flow name" htmlFor="flow-name" error={nameError}>
              <Input
                id="flow-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Appointment reminder"
              />
            </Field>
            {otherError && <ErrorState error={otherError} />}
            <div className="flex justify-end gap-3 border-t border-edge pt-4">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!name.trim()}
                loading={pending}
                onClick={() => void create()}
              >
                Create
              </Button>
            </div>
          </div>
        </Modal>
      )}
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
  if (flow.error)
    return <ErrorState error={flow.error} onRetry={() => void flow.refetch()} />;
  if (!flow.data) return null;

  const list = versions.data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink to="/flows">Flows</BackLink>
        <PageHeader
          title={flow.data.name}
          subtitle="Every edit is a new version. Publishing freezes one so campaigns can pin it."
        />
      </div>

      {versions.error && (
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      )}
      {clone.error && <ErrorState error={clone.error} />}

      {versions.data && (
        <Panel className="overflow-hidden">
          {list.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ash">No versions yet.</p>
          ) : (
            // `relative` keeps the hidden column heading inside the scroller.
            <div className="relative overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Checks</th>
                    <th>Date</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((version) => (
                    <VersionRow
                      key={version.id}
                      version={version}
                      canEdit={canEdit}
                      onClone={() => clone.mutate(version.id)}
                      cloning={clone.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
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
  const errors = report?.errors?.length ?? 0;
  const warnings = report?.warnings?.length ?? 0;

  return (
    <tr>
      <td className="num font-medium !text-chalk">v{version.version}</td>
      <td>
        <span className="flex gap-2">
          {version.is_published ? (
            <Badge tone="good">published</Badge>
          ) : (
            <Badge tone="info">draft</Badge>
          )}
          {version.is_published && !version.prompts_rendered_at && (
            <Badge tone="warn">prompts still rendering</Badge>
          )}
        </span>
      </td>
      <td>
        <span className="flex gap-2">
          {errors > 0 && (
            <Badge tone="bad">{errors} errors</Badge>
          )}
          {warnings > 0 && (
            <Badge tone="warn">{warnings} warnings</Badge>
          )}
          {errors === 0 && warnings === 0 && "—"}
        </span>
      </td>
      <td>
        {version.published_at
          ? `published ${formatDateTime(version.published_at)}`
          : `created ${formatRelative(version.created_at)}`}
      </td>
      <td>
        <div className="flex justify-end gap-2">
          <Link
            to={`/flows/${version.flow}/versions/${version.id}`}
            className="press inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-medium text-chalk ring-1 ring-inset ring-edge-bright hover:bg-raised"
          >
            {version.is_published ? "Inspect" : "Edit"}
          </Link>
          {canEdit && version.is_published && (
            <Button dense variant="ghost" onClick={onClone} loading={cloning}>
              Clone to draft
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
