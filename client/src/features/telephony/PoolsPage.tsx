/**
 * Audio and number pools. One component serves both because they differ only in
 * what a member is: an uploaded sound, or a caller ID.
 */

import { useMemo, useState } from "react";

import { EditIcon, HashIcon, PlusIcon, SoundIcon } from "@/components/icons";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  TableSkeleton,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  audioPools,
  cliPools,
  useAudioClips,
  useCallerIds,
  useUploadAudio,
  type Pool,
} from "@/lib/queries/resources";

type Kind = "audio" | "cli";

export function AudioPoolsPage() {
  return <PoolsPage kind="audio" />;
}
export function CliPoolsPage() {
  return <PoolsPage kind="cli" />;
}

function PoolsPage({ kind }: { kind: Kind }) {
  const isAudio = kind === "audio";
  const hooks = isAudio ? audioPools : cliPools;
  const list = hooks.useList();
  const remove = hooks.useDelete();

  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Pool | null>(null);

  const title = isAudio ? "Audio" : "Number pools";
  const addLabel = isAudio ? "Add audio" : "Add pool";
  const unit = isAudio ? "file" : "number";
  const Glyph = isAudio ? SoundIcon : HashIcon;

  const rows = useMemo(() => {
    const all = list.data?.results ?? [];
    const f = filter.trim().toLowerCase();
    return f ? all.filter((p) => p.name.toLowerCase().includes(f)) : all;
  }, [list.data, filter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={isAudio ? "Recordings your jobs can play." : "Groups of numbers to rotate between."}
        actions={
          <Button type="button" variant="primary" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" /> {addLabel}
          </Button>
        }
      />

      <Input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search by name"
        aria-label="Search by name"
        className="max-w-sm"
      />

      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}

      {list.isLoading && (
        <Panel>
          <TableSkeleton rows={4} />
        </Panel>
      )}

      {list.data && rows.length === 0 && (
        <EmptyState
          title={filter.trim() ? "No matches" : "Nothing here yet"}
          description={
            filter.trim()
              ? "Try another name."
              : isAudio
                ? "Add audio to play it on calls."
                : "Add a pool to rotate numbers."
          }
        />
      )}

      {rows.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id} className="min-w-0">
              <Panel className="flex h-full flex-col">
                <div className="flex items-start gap-3 p-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-live text-live-bright">
                    <Glyph />
                  </span>
                  <div className="min-w-0">
                    <h2 className="display break-words text-base text-chalk">{p.name}</h2>
                    <p className="num text-sm text-ash">
                      {p.member_count} {p.member_count === 1 ? unit : `${unit}s`}
                    </p>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-edge px-5 py-3">
                  <p className="min-w-0 break-words text-xs text-ash-dim">
                    {p.user ? `${p.user} · ` : ""}
                    {formatDateTime(p.created_at)}
                  </p>
                  <Button
                    dense
                    aria-label={`Edit ${p.name}`}
                    onClick={() => {
                      remove.reset();
                      setEditing(p);
                    }}
                  >
                    <EditIcon className="size-4" /> Edit
                  </Button>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {(adding || editing) && (
        <PoolModal
          kind={kind}
          pool={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          deleting={remove.isPending}
          deleteError={remove.error}
          onDelete={
            editing
              ? async () => {
                  await remove.mutateAsync(editing.id);
                  setEditing(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** The Add / Edit modal. Audio pools can upload a new sound inline. */
function PoolModal({
  kind,
  pool,
  onClose,
  onDelete,
  deleting,
  deleteError,
}: {
  kind: Kind;
  pool: Pool | null;
  onClose: () => void;
  onDelete?: () => void;
  deleting: boolean;
  deleteError: Error | null;
}) {
  const isAudio = kind === "audio";
  const hooks = isAudio ? audioPools : cliPools;
  const create = hooks.useCreate();
  const update = hooks.useUpdate();

  const clips = useAudioClips();
  const callers = useCallerIds();
  const upload = useUploadAudio();

  const [name, setName] = useState(pool?.name ?? "");
  const [selected, setSelected] = useState<string[]>(pool?.members ?? []);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const memberOptions = isAudio
    ? (clips.data?.results ?? []).map((c) => ({ id: c.id, label: c.name }))
    : (callers.data?.results ?? []).map((c) => ({ id: c.id, label: c.phone_e164 }));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const clip = await upload.mutateAsync({ name: file.name.replace(/\.[^.]+$/, ""), file });
    setSelected((s) => [...s, clip.id]);
  }

  async function save() {
    if (pool) {
      await update.mutateAsync({ id: pool.id, name, members: selected });
    } else {
      await create.mutateAsync({ name, members: selected });
    }
    onClose();
  }

  return (
    <Modal
      title={pool ? `Edit ${pool.name}` : isAudio ? "Add audio" : "Add number pool"}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="pool-name">
          <Input
            id="pool-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isAudio ? "e.g. Welcome message" : "e.g. US numbers"}
            autoFocus
          />
        </Field>

        {isAudio && (
          <Field label="Upload a sound" htmlFor="pool-file">
            <input
              id="pool-file"
              type="file"
              accept="audio/*"
              onChange={onFile}
              className="w-full text-sm text-ash file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-live file:px-3 file:font-medium file:text-live-bright"
            />
            {upload.isPending && <p className="text-xs text-ash">Uploading…</p>}
            {upload.error && (
              <p role="alert" className="text-xs text-rust">{upload.error.message}</p>
            )}
          </Field>
        )}

        <fieldset className="min-w-0">
          <legend className="eyebrow mb-1.5">{isAudio ? "Files" : "Numbers"}</legend>
          {memberOptions.length === 0 ? (
            <p className="text-sm text-ash">
              {isAudio ? "Upload a sound above to add it." : "Add a number first."}
            </p>
          ) : (
            <div className="max-h-56 divide-y divide-edge overflow-y-auto rounded-xl border border-edge">
              {memberOptions.map((m) => (
                <label
                  key={m.id}
                  className="flex min-h-11 items-center gap-3 px-3 text-sm text-chalk hover:bg-void"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(m.id)}
                    onChange={(e) =>
                      setSelected(e.target.checked ? [...selected, m.id] : selected.filter((x) => x !== m.id))
                    }
                    className="size-4 shrink-0 accent-signal"
                  />
                  <span className="min-w-0 break-words">{m.label}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {(create.error || update.error) && (
          <p role="alert" className="text-sm text-rust">
            {(create.error ?? update.error)?.message}
          </p>
        )}
        {deleteError && (
          <p role="alert" className="text-sm text-rust">{deleteError.message}</p>
        )}

        {confirmingDelete && onDelete ? (
          <div role="alert" className="rounded-xl bg-[#fdeaea] p-3">
            <p className="text-sm text-rust">Delete this pool? This cannot be undone.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button dense type="button" variant="danger" loading={deleting} onClick={onDelete}>
                Yes, delete
              </Button>
              <Button dense type="button" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-4">
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                className="!text-rust"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                type="button"
                variant="primary"
                onClick={save}
                loading={create.isPending || update.isPending}
                disabled={!name}
              >
                {pool ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
