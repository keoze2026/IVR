/**
 * Contact lists, and getting a CSV into one.
 *
 * The upload is three steps that look like one: ask for a presigned ticket,
 * POST the file straight to object storage, then tell the API the key is
 * there. The file never touches Django — a 500k-row CSV streamed through a
 * worker would hold it for the whole transfer.
 *
 * `ingest/` returns a `job_id` that nothing accepts and there is no result
 * backend (G-08), so progress comes from polling the list's own
 * `ingest_status`. That polling stops the moment the import finishes.
 */

import { useRef, useState } from "react";
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
  PanelHeader,
  Stat,
  TableSkeleton,
  cx,
} from "@/components/ui";
import { formatCount, formatDateTime, formatRelative } from "@/lib/format";
import {
  useContactList,
  useContactLists,
  useCreateContactList,
  useRejects,
  useStartIngest,
  useSuppressionPreview,
  useUploadTicket,
} from "@/lib/queries/resources";
import { useCan } from "@/lib/session";
import type { ContactList } from "@/types/domain";

const STATUS_TONE = {
  completed: "good",
  running: "info",
  pending: "quiet",
  failed: "bad",
} as const;

function ImportBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "quiet"}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export function ContactListsPage() {
  const canEdit = useCan("contacts.edit");
  const { data, isLoading, error, refetch } = useContactLists();
  const create = useCreateContactList();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = data?.results ?? [];
  const sum = (pick: (list: ContactList) => number) =>
    data ? formatCount(rows.reduce((total, list) => total + pick(list), 0)) : "—";
  // Totals only cover the lists loaded here; say so when there are more.
  const scope = data?.next ? "In the lists shown" : undefined;
  const nameError = create.error?.messageFor("name");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        subtitle="Numbers are normalised to E.164 on import, deduplicated, and checked against suppression before they ever reach a queue."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon className="size-4" /> New list
            </Button>
          )
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      <div className="grid gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <Stat label="Lists" value={data ? formatCount(data.count ?? rows.length) : "—"} />
        <Stat label="Rows" value={sum((l) => l.total_rows)} denominator={scope} />
        <Stat label="Reachable" value={sum((l) => l.reachable_rows)} denominator={scope} accent />
        <Stat label="Suppressed" value={sum((l) => l.suppressed_rows)} denominator={scope} />
      </div>

      {(isLoading || data) && (
        <Panel className="overflow-hidden">
          {isLoading && <TableSkeleton />}
          {data && rows.length === 0 && (
            <div className="p-4 sm:p-6">
              <EmptyState
                title="No lists yet"
                description="A list holds the numbers a campaign may dial. Create one, then upload a CSV."
                action={
                  canEdit ? (
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      Create a list
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
                    <th>List</th>
                    <th>Import</th>
                    <th>Rows</th>
                    <th>Reachable</th>
                    <th>Suppressed</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((list) => (
                    <tr key={list.id}>
                      <td>
                        <Link
                          to={`/contact-lists/${list.id}`}
                          className="flex min-h-9 flex-col justify-center font-medium text-chalk hover:text-signal"
                        >
                          {list.name}
                          {list.source_filename && (
                            <span className="num text-xs font-normal text-ash-dim">
                              {list.source_filename}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td>
                        <ImportBadge status={list.ingest_status} />
                      </td>
                      <td className="num">{formatCount(list.total_rows)}</td>
                      <td className="num">{formatCount(list.reachable_rows)}</td>
                      <td className="num">{formatCount(list.suppressed_rows)}</td>
                      <td>{formatRelative(list.created_at)}</td>
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
          title="New list"
          onClose={() => setCreating(false)}
          closeOnEscape={false}
          closeOnBackdrop={false}
        >
          {/* Enter does not submit; the button does. */}
          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <Field label="List name" htmlFor="list-name" error={nameError}>
              <Input
                id="list-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="August renewals"
              />
            </Field>
            {create.error && !nameError && <ErrorState error={create.error} />}
            <div className="flex justify-end gap-3 border-t border-edge pt-4">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!name.trim()}
                loading={create.isPending}
                onClick={() =>
                  create.mutate(
                    { name: name.trim() },
                    {
                      onSuccess: () => {
                        setName("");
                        setCreating(false);
                      },
                    },
                  )
                }
              >
                Create
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// --- one list ---------------------------------------------------------

export function ContactListDetailPage() {
  const { id } = useParams();
  const canEdit = useCan("contacts.edit");
  const { data: list, isLoading, error, refetch } = useContactList(id);

  if (isLoading) return <PulseLoader label="Loading list" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!list) return null;

  const pending = list.ingest_status === "pending";
  const running = list.ingest_status === "running";
  // A new list is `pending` before it has any file. Treating that as an import
  // would hide the uploader, leaving no way to give the list its first file.
  const importing = running || (pending && Boolean(list.source_filename));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink to="/contact-lists">Contacts</BackLink>
        <PageHeader
          title={list.name}
          subtitle={list.source_filename || undefined}
        />
      </div>

      <div className="grid gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Rows" value={formatCount(list.total_rows)} denominator="in the file" />
        <Stat label="Valid" value={formatCount(list.valid_rows)} denominator="parsed to E.164" />
        <Stat
          label="Reachable"
          value={formatCount(list.reachable_rows)}
          denominator="after suppression"
          accent
        />
        <Stat
          label="Suppressed"
          value={formatCount(list.suppressed_rows)}
          denominator="already on a list"
          tone={
            list.total_rows > 0 && list.suppressed_rows / list.total_rows > 0.3
              ? "amber"
              : undefined
          }
        />
        <Stat
          label="Rejected"
          value={formatCount(list.rejected_rows)}
          denominator="could not be parsed"
          tone={list.rejected_rows > 0 ? "rust" : undefined}
        />
      </div>

      {importing && <ImportProgress list={list} />}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* The API names the file before the upload has succeeded, so a
            pending list keeps the uploader for a retry. */}
        {canEdit && !running && <Uploader listId={list.id} pending={pending} />}
        <Reports list={list} />
      </div>
    </div>
  );
}

function ImportProgress({ list }: { list: ContactList }) {
  const report = list.ingest_report ?? {};
  return (
    <Panel accent className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="eyebrow">Importing</div>
          <p className="mt-1 text-sm text-chalk">
            Reading the file in chunks and checking every number against
            suppression.
          </p>
        </div>
        <PulseLoader scale={0.7} />
      </div>
      {Object.keys(report).length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-edge pt-3 sm:grid-cols-5">
          {(["total", "valid", "rejected", "duplicates", "suppressed"] as const).map(
            (key) => (
              <Figure
                key={key}
                label={key}
                value={formatCount((report[key] as number) ?? 0)}
              />
            ),
          )}
        </dl>
      )}
    </Panel>
  );
}

function Uploader({ listId, pending }: { listId: string; pending: boolean }) {
  const ticket = useUploadTicket(listId);
  const ingest = useStartIngest(listId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function handle(file: File) {
    setProblem(null);
    setUploading(true);
    try {
      // 1. A presigned ticket, scoped to this org and list.
      const { upload, s3_key } = await ticket.mutateAsync({
        filename: file.name,
        content_type: "text/csv",
      });

      // 2. Straight to object storage. Field order matters — the policy is
      //    evaluated against the form, and `file` must come last.
      const form = new FormData();
      Object.entries(upload.fields).forEach(([k, v]) => form.append(k, v));
      form.append("file", file);

      const response = await fetch(upload.url, { method: "POST", body: form });
      if (!response.ok) {
        throw new Error(
          "That file could not be accepted. Check it is a CSV and under 512 MB.",
        );
      }

      // 3. Now the API can read it.
      await ingest.mutateAsync({ s3_key });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // The API has accepted the file and the import is on its way. Offering
  // another upload now would queue the same list twice.
  if (pending && ingest.isSuccess) return null;

  return (
    <Panel>
      <PanelHeader title="Upload a CSV" />
      <div className="space-y-3 p-4">
        <p className="text-xs text-ash">
          One column must be <code className="num">phone</code>. Anything else
          becomes a merge variable your prompts can use. Uploads are capped at
          twenty an hour.
        </p>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void handle(file);
          }}
          className="rounded-xl border border-dashed border-edge-bright bg-void px-4 py-8 text-center"
        >
          {uploading ? (
            <PulseLoader label="Uploading" scale={0.8} />
          ) : (
            <>
              <p className="text-sm text-ash">Drop a CSV here</p>
              <Button
                className="mt-3"
                variant="primary"
                onClick={() => inputRef.current?.click()}
              >
                Choose a file
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handle(file);
                }}
              />
            </>
          )}
        </div>

        {problem && (
          <p className="text-sm text-rust" role="alert">
            {problem}
          </p>
        )}
        {ticket.error && <ErrorState error={ticket.error} />}
        {ingest.error && <ErrorState error={ingest.error} />}
      </div>
    </Panel>
  );
}

function Reports({ list }: { list: ContactList }) {
  const [checking, setChecking] = useState(false);
  const preview = useSuppressionPreview(list.id, checking);
  const rejects = useRejects(list.id, list.rejected_rows > 0);

  return (
    <div className="min-w-0 space-y-4">
      {/* A header with nothing under it needs no dividing line. */}
      <Panel className="[&>:last-child]:border-b-0">
        <PanelHeader
          title="Re-check suppression"
          hint="A list uploaded on Monday and dialed on Friday has picked up new opt-outs. This samples the list against the current lists."
          action={
            <Button
              onClick={() => setChecking(true)}
              loading={preview.isFetching}
              className="shrink-0"
            >
              Check
            </Button>
          }
        />

        {preview.data && (
          <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <Figure label="Sampled" value={formatCount(preview.data.sampled)} />
            <Figure
              label="Already suppressed"
              value={formatCount(preview.data.already_suppressed)}
            />
            <Figure
              label="Newly suppressed"
              value={formatCount(preview.data.newly_suppressed)}
              tone={preview.data.newly_suppressed > 0 ? "amber" : undefined}
            />
            <Figure
              label="Reachable"
              value={formatCount(preview.data.reachable)}
              tone="signal"
            />
          </dl>
        )}
        {preview.error && (
          <div className="p-4">
            <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
          </div>
        )}
      </Panel>

      {list.rejected_rows > 0 && (
        <Panel className="[&>:last-child]:border-b-0">
          <PanelHeader
            title="Rejected rows"
            hint={`${formatCount(list.rejected_rows)} rows could not be parsed. The download lists each one with the reason.`}
            action={
              rejects.data?.url && (
                <a
                  href={rejects.data.url}
                  className="press inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-medium text-signal ring-1 ring-inset ring-edge-bright hover:bg-live"
                >
                  Download the rejects CSV
                </a>
              )
            }
          />
          {rejects.error && (
            <div className="p-4">
              <ErrorState error={rejects.error} onRetry={() => void rejects.refetch()} />
            </div>
          )}
        </Panel>
      )}

      {list.ingest_finished_at && (
        <p className="text-xs text-ash-dim">
          Last import finished {formatDateTime(list.ingest_finished_at)}
        </p>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "signal" | "amber";
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cx(
          "num mt-1 text-lg font-medium",
          tone === "signal"
            ? "text-signal"
            : tone === "amber"
              ? "text-amber"
              : "text-chalk",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
