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
  const [creating, setCreating] = useState(false);

  const rows = data?.results ?? [];
  const count = (matches: (flow: FlowSummary) => boolean) =>
    data ? String(rows.filter(matches).length) : "—";
  // Counts only cover the flows loaded here; say so when there are more.
  const scope = data?.next ? "In the flows shown" : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call flows"
        subtitle="What callers hear and what each key does."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon className="size-4" /> New flow
            </Button>
          )
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Flows" value={data ? String(data.count ?? rows.length) : "—"} />
        <Stat label="Published" value={count((f) => Boolean(f.published_version))} denominator={scope} accent />
        <Stat
          label="With a draft"
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
                description="Start with a ready-made greeting and keypad menu."
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
                    <tr key={flow.id}>
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
                          <Badge tone="good">Live v{flow.published_version.version}</Badge>
                        ) : (
                          <Badge>Never published</Badge>
                        )}
                      </td>
                      <td>
                        {flow.latest_version && !flow.latest_version.is_published ? (
                          <Badge tone="info">Draft v{flow.latest_version.version}</Badge>
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

      {creating && <NewFlowModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewFlowModal({ onClose }: { onClose: () => void }) {
  const createFlow = useCreateFlow();
  const createVersion = useCreateVersion();
  const [name, setName] = useState("");
  const pending = createFlow.isPending || createVersion.isPending;
  const nameError = createFlow.error?.messageFor("name");
  const otherError = createVersion.error ?? (nameError ? null : createFlow.error);

  async function create() {
    try {
      const flow = await createFlow.mutateAsync({ name: name.trim() });
      // A flow with no version is not useful, so seed a draft immediately.
      await createVersion.mutateAsync({ flow: flow.id, definition: STARTER });
      onClose();
    } catch {
      // Shown from the mutation's error; the form stays open.
    }
  }

  return (
    <Modal title="New flow" onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !pending) void create();
        }}
      >
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
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()} loading={pending}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
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
        <BackLink to="/flows">Call flows</BackLink>
        <PageHeader
          title={flow.data.name}
          subtitle="Published versions cannot be edited. Clone one to make changes."
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
                      cloning={clone.isPending && clone.variables === version.id}
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
            <Badge tone="good">Published</Badge>
          ) : (
            <Badge tone="info">Draft</Badge>
          )}
          {version.is_published && !version.prompts_rendered_at && (
            <Badge tone="warn">Audio still preparing</Badge>
          )}
        </span>
      </td>
      <td>
        <span className="flex gap-2">
          {errors > 0 && (
            <Badge tone="bad">
              {errors} error{errors > 1 ? "s" : ""}
            </Badge>
          )}
          {warnings > 0 && (
            <Badge tone="warn">
              {warnings} warning{warnings > 1 ? "s" : ""}
            </Badge>
          )}
          {errors === 0 && warnings === 0 && "—"}
        </span>
      </td>
      <td>
        {version.published_at
          ? `Published ${formatDateTime(version.published_at)}`
          : `Created ${formatRelative(version.created_at)}`}
      </td>
      <td>
        <div className="flex justify-end gap-2">
          <Link
            to={`/flows/${version.flow}/versions/${version.id}`}
            className="press inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-medium text-chalk ring-1 ring-inset ring-edge-bright hover:bg-raised"
          >
            {version.is_published ? "View" : "Edit"}
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
