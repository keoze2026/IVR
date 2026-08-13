/**
 * Audio pools and CLI pools — laid out to match the reference dialer exactly.
 *
 * Breadcrumb, an Add button top-right that opens a modal, a filter box, and a
 * table whose columns are Name / (Files|Numbers) / User / Created / actions.
 * One component serves both because the two differ only in what a member is —
 * an uploaded sound, or a caller ID.
 */

import { useMemo, useState } from "react";

import { Button, EmptyState, Panel, TableSkeleton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  audioPools,
  cliPools,
  useAudioClips,
  useCallerIds,
  useUploadAudio,
  type Pool,
} from "@/lib/queries/resources";

const input =
  "w-full rounded border border-edge bg-void px-3 py-2 text-sm text-chalk placeholder:text-ash/50 focus:border-live-bright focus:outline-none";

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

  const rows = useMemo(() => {
    const all = list.data?.results ?? [];
    const f = filter.trim().toLowerCase();
    return f ? all.filter((p) => p.name.toLowerCase().includes(f)) : all;
  }, [list.data, filter]);

  return (
    <div className="space-y-5">
      {/* breadcrumb */}
      <p className="text-xs text-ash">
        Home <span className="mx-1">›</span>
        <span className="text-chalk">{title}</span>
      </p>

      <div className="flex items-center justify-between">
        <h1 className="display text-2xl font-semibold text-chalk">{title}</h1>
        <Button type="button" onClick={() => setAdding(true)}>
          {addLabel} +
        </Button>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name..."
        className={`${input} max-w-sm`}
      />

      <Panel className="p-0">
        {list.isLoading && <div className="p-4"><TableSkeleton rows={4} /></div>}
        {!list.isLoading && rows.length === 0 && (
          <div className="p-8">
            <EmptyState title="No results." description={`Add ${isAudio ? "an audio" : "a CLI"} pool to get started.`} />
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-ash">
                  <th className="w-8 py-3 pl-4" />
                  <th className="py-3 pr-4">Name</th>
                  <th className="py-3 pr-4">{memberHead}</th>
                  <th className="py-3 pr-4">User</th>
                  <th className="py-3 pr-4">Created</th>
                  <th className="py-3 pr-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-edge/50 hover:bg-raised">
                    <td className="py-3 pl-4">
                      <input type="checkbox" className="accent-signal" />
                    </td>
                    <td className="py-3 pr-4 font-medium text-chalk">{p.name}</td>
                    <td className="py-3 pr-4 tabular-nums text-ash">
                      <span className="inline-flex items-center gap-1.5">
                        {isAudio ? "♪" : "☎"} {p.member_count}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-ash">{p.user || "—"}</td>
                    <td className="py-3 pr-4 text-ash">{formatDateTime(p.created_at)}</td>
                    <td className="py-3 pr-4 text-right">
                      <button
                        onClick={() => setEditing(p)}
                        className="px-2 text-ash hover:text-chalk"
                        aria-label="Actions"
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-edge px-4 py-3 text-xs text-ash">
          <span>{rows.length} row(s) total.</span>
        </div>
      </Panel>

      {(adding || editing) && (
        <PoolModal
          kind={kind}
          pool={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
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
}: {
  kind: Kind;
  pool: Pool | null;
  onClose: () => void;
  onDelete?: () => void;
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-lg rounded-lg border border-edge bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between">
          <h2 className="display text-lg font-semibold text-chalk">
            {pool ? "Edit pool" : isAudio ? "Add Audio Pool" : "Add CLI Pool"}
          </h2>
          <button onClick={onClose} className="text-ash hover:text-chalk">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isAudio ? "e.g. WOW" : "e.g. global-cli-pool"} className={input} autoFocus />
          </div>

          {isAudio && (
            <div>
              <span className="mb-1 block text-xs uppercase tracking-wider text-ash">Upload a sound</span>
              <input type="file" accept="audio/*" onChange={onFile} className="text-sm text-ash file:mr-3 file:rounded file:border-0 file:bg-live-bright file:px-3 file:py-1.5 file:text-void" />
              {upload.isPending && <p className="mt-1 text-xs text-ash">Uploading…</p>}
              {upload.error && <p className="mt-1 text-xs text-rust">{upload.error.message}</p>}
            </div>
          )}

          <div>
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
              {isAudio ? "Files in this pool" : "Numbers in this pool"}
            </span>
            {memberOptions.length === 0 ? (
              <p className="text-sm text-ash">
                {isAudio ? "Upload a sound above to add it." : "Add a caller ID first."}
              </p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {memberOptions.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-chalk">
                    <input
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      onChange={(e) =>
                        setSelected(e.target.checked ? [...selected, m.id] : selected.filter((x) => x !== m.id))
                      }
                      className="accent-signal"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {(create.error || update.error) && (
            <p className="text-sm text-rust">{(create.error ?? update.error)?.message}</p>
          )}

          <div className="flex justify-between border-t border-edge pt-4">
            <div className="flex gap-3">
              <Button type="button" onClick={save} disabled={!name || create.isPending || update.isPending}>
                {pool ? "Save" : "Create"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
            {onDelete && (
              <button onClick={onDelete} className="text-sm text-rust hover:underline">Delete</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
