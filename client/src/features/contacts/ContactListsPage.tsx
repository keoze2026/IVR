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

const STATUS_TONE: Record<string, string> = {
  completed: "text-live-bright",
  running: "text-signal",
  pending: "text-ash",
  failed: "text-rust",
};

export function ContactListsPage() {
  const canEdit = useCan("contacts.edit");
  const { data, isLoading, error, refetch } = useContactLists();
  const create = useCreateContactList();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = data?.results ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Contacts</h1>
          <p className="mt-1 text-sm text-ash">
            Numbers are normalised to E.164 on import, deduplicated, and checked
            against suppression before they ever reach a queue.
          </p>
        </div>
        {canEdit && !creating && (
          <ClipButton onClick={() => setCreating(true)}>New list</ClipButton>
        )}
      </header>

      {creating && (
        <Panel className="p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field
                label="List name"
                htmlFor="list-name"
                error={create.error?.messageFor("name")}
              >
                <Input
                  id="list-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="August renewals"
                />
              </Field>
            </div>
            <Button
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
            title="No lists yet"
            description="A list holds the numbers a campaign may dial. Create one, then upload a CSV."
            action={
              canEdit ? (
                <ClipButton onClick={() => setCreating(true)}>
                  Create a list
                </ClipButton>
              ) : undefined
            }
          />
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-edge md:hidden">
            {rows.map((list) => (
              <li key={list.id}>
                <Link
                  to={`/contact-lists/${list.id}`}
                  className="press block px-4 py-3.5 active:bg-raised/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="display font-medium text-chalk">
                      {list.name}
                    </span>
                    <span
                      className={cx(
                        "font-mono text-[11px] uppercase tracking-wider",
                        STATUS_TONE[list.ingest_status] ?? "text-ash",
                      )}
                    >
                      {list.ingest_status}
                    </span>
                  </div>
                  <dl className="mt-3 flex items-baseline gap-5 text-xs">
                    <div>
                      <dt className="eyebrow">Rows</dt>
                      <dd className="num mt-0.5 text-sm text-chalk">
                        {formatCount(list.total_rows)}
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Reachable</dt>
                      <dd className="num mt-0.5 text-sm text-live-bright">
                        {formatCount(list.reachable_rows)}
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Suppressed</dt>
                      <dd className="num mt-0.5 text-sm text-ash">
                        {formatCount(list.suppressed_rows)}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {rows.length > 0 && (
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b border-edge bg-void/40 text-left">
                {["List", "Import", "Rows", "Reachable", "Suppressed", "Added"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={cx(
                        "eyebrow px-4 py-2.5 font-normal",
                        i >= 2 && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {rows.map((list) => (
                <tr key={list.id} className="group hover:bg-raised/50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/contact-lists/${list.id}`}
                      className="display font-medium text-chalk group-hover:text-signal"
                    >
                      {list.name}
                    </Link>
                    {list.source_filename && (
                      <p className="num mt-0.5 text-[11px] text-ash-dim">
                        {list.source_filename}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cx(
                        "font-mono text-[11px] uppercase tracking-wider",
                        STATUS_TONE[list.ingest_status] ?? "text-ash",
                      )}
                    >
                      {list.ingest_status}
                    </span>
                  </td>
                  <td className="num px-4 py-3 text-right text-chalk">
                    {formatCount(list.total_rows)}
                  </td>
                  <td className="num px-4 py-3 text-right text-live-bright">
                    {formatCount(list.reachable_rows)}
                  </td>
                  <td className="num px-4 py-3 text-right text-ash">
                    {formatCount(list.suppressed_rows)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-ash">
                    {formatRelative(list.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
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

  const importing =
    list.ingest_status === "pending" || list.ingest_status === "running";

  return (
    <div className="space-y-6">
      <header>
        <BackLink to="/contact-lists">Contacts</BackLink>
        <h1 className="display mt-2 text-2xl font-semibold text-chalk">
          {list.name}
        </h1>
        {list.source_filename && (
          <p className="num mt-1 text-xs text-ash">{list.source_filename}</p>
        )}
      </header>

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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

      <div className="grid gap-5 lg:grid-cols-2">
        {canEdit && !importing && <Uploader listId={list.id} />}
        <Reports list={list} />
      </div>
    </div>
  );
}

function ImportProgress({ list }: { list: ContactList }) {
  const report = list.ingest_report ?? {};
  return (
    <Panel accent className="px-5 py-4">
      <div className="flex items-center justify-between gap-4">
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
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-edge pt-3 sm:grid-cols-5">
          {(["total", "valid", "rejected", "duplicates", "suppressed"] as const).map(
            (key) => (
              <div key={key}>
                <dt className="eyebrow">{key}</dt>
                <dd className="num mt-1 text-sm text-chalk">
                  {formatCount((report[key] as number) ?? 0)}
                </dd>
              </div>
            ),
          )}
        </dl>
      )}
    </Panel>
  );
}

function Uploader({ listId }: { listId: string }) {
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

  return (
    <Panel className="p-5">
      <h2 className="display text-sm font-semibold text-chalk">Upload a CSV</h2>
      <p className="mt-1 text-xs text-ash">
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
        className="mt-4 rounded border border-dashed border-edge-bright bg-void px-4 py-8 text-center"
      >
        {uploading ? (
          <PulseLoader label="Uploading" scale={0.8} />
        ) : (
          <>
            <p className="text-sm text-ash">Drop a CSV here</p>
            <Button
              className="mt-3"
              variant="secondary"
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
        <p className="mt-3 text-sm text-rust" role="alert">
          {problem}
        </p>
      )}
      {ticket.error && <div className="mt-3"><ErrorState error={ticket.error} /></div>}
      {ingest.error && <div className="mt-3"><ErrorState error={ingest.error} /></div>}
    </Panel>
  );
}

function Reports({ list }: { list: ContactList }) {
  const [checking, setChecking] = useState(false);
  const preview = useSuppressionPreview(list.id, checking);
  const rejects = useRejects(list.id, list.rejected_rows > 0);

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-sm font-semibold text-chalk">
              Re-check suppression
            </h2>
            <p className="mt-1 text-xs text-ash">
              A list uploaded on Monday and dialed on Friday has picked up new
              opt-outs. This samples the list against the current lists.
            </p>
          </div>
          <Button onClick={() => setChecking(true)} loading={preview.isFetching}>
            Check
          </Button>
        </div>

        {preview.data && (
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-edge pt-3 sm:grid-cols-4">
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
      </Panel>

      {list.rejected_rows > 0 && (
        <Panel className="p-5">
          <h2 className="display text-sm font-semibold text-chalk">
            Rejected rows
          </h2>
          <p className="mt-1 text-xs text-ash">
            {formatCount(list.rejected_rows)} rows could not be parsed. The
            download lists each one with the reason.
          </p>
          {rejects.data?.url && (
            <a
              href={rejects.data.url}
              className="mt-3 inline-block text-sm text-signal hover:underline"
            >
              Download the rejects CSV
            </a>
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
          "num mt-1 text-sm",
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
