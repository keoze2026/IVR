/**
 * Audio and number pools. One component serves both because they differ only in
 * what a member is: an uploaded sound, or a caller ID.
 */

import { useMemo, useState } from "react";

import { HashIcon, SoundIcon } from "@/components/icons";
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

  const title = isAudio ? "Audio Pools" : "CLI Pools";
  const addLabel = isAudio ? "Add Audio Pool" : "Add CLI Pool";
  const memberHead = isAudio ? "Files" : "Numbers";
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
        actions={
          <Button type="button" variant="primary" onClick={() => setAdding(true)}>
            {addLabel} +
          </Button>
        }
      />

      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name..."
        aria-label="Filter by name"
        className="max-w-sm"
      />

      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}

      {list.isLoading && (
        <Panel>
          <TableSkeleton rows={4} />
        </Panel>
      )}

      {!list.isLoading && rows.length === 0 && (
        <EmptyState
          title="No results."
          description={`Add ${isAudio ? "an audio" : "a CLI"} pool to get started.`}
        />
      )}

      {rows.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id} className="min-w-0">
              <Panel className="flex h-full flex-col">
                <div className="flex items-start gap-3 p-5">
                  <input type="checkbox" className="mt-3 shrink-0" />
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-live text-live-bright">
                    <Glyph />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="eyebrow block">Name</span>
                    <h2 className="display break-words text-base text-chalk">{p.name}</h2>
                  </div>
                  <Button dense aria-label="Actions" onClick={() => {
                    remove.reset();
                    setEditing(p);
                  }}>
                    ⋯
                  </Button>
                </div>
                <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-edge px-5 py-3 text-sm">
                  <dt className="eyebrow self-center">{memberHead}</dt>
                  <dd className="num text-right text-ash">{p.member_count}</dd>
                  <dt className="eyebrow self-center">User</dt>
                  <dd className="min-w-0 break-words text-right text-ash">{p.user || "—"}</dd>
                  <dt className="eyebrow self-center">Created</dt>
                  <dd className="text-right text-ash">{formatDateTime(p.created_at)}</dd>
                </dl>
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
          deleteError={editing ? remove.error : null}
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
  deleteError,
}: {
  kind: Kind;
  pool: Pool | null;
  onClose: () => void;
  onDelete?: () => void;
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
      title={pool ? "Edit pool" : isAudio ? "Add Audio Pool" : "Add CLI Pool"}
      onClose={onClose}
      closeOnEscape={false}
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="pool-name">
          <Input
            id="pool-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isAudio ? "e.g. WOW" : "e.g. global-cli-pool"}
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
          <legend className="eyebrow mb-1.5">{isAudio ? "Files in this pool" : "Numbers in this pool"}</legend>
          {memberOptions.length === 0 ? (
            <p className="text-sm text-ash">
              {isAudio ? "Upload a sound above to add it." : "Add a caller ID first."}
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-4">
          {onDelete ? (
            <Button type="button" variant="ghost" className="!text-rust" onClick={onDelete}>
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
      </div>
    </Modal>
  );
}
