/**
 * Audio pools and CLI pools.
 *
 * The two are the same shape — a name, a rotation rule, and a set of members —
 * so one component builds both, told which kind it is. Audio pools hold
 * sounds; CLI pools hold caller IDs. The member picker is the only difference,
 * and it is just a different list of checkboxes.
 */

import { useState } from "react";

import { Button, EmptyState, Panel, TableSkeleton } from "@/components/ui";
import {
  audioPools,
  cliPools,
  useAudioClips,
  useCallerIds,
  type Pool,
} from "@/lib/queries/resources";

const input =
  "w-full rounded border border-steel bg-ink px-3 py-2 text-sm text-chalk placeholder:text-ash/50 focus:border-live-bright focus:outline-none";

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
  const create = hooks.useCreate();
  const update = hooks.useUpdate();
  const remove = hooks.useDelete();

  const clips = useAudioClips();
  const callers = useCallerIds();

  const memberOptions = isAudio
    ? (clips.data?.results ?? []).map((c) => ({ id: c.id, label: c.name }))
    : (callers.data?.results ?? []).map((c) => ({ id: c.id, label: c.phone_e164 }));

  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Pool | null>(null);

  const pools = list.data?.results ?? [];
  const title = isAudio ? "Audio pools" : "CLI pools";
  const memberWord = isAudio ? "sounds" : "numbers";

  async function submit() {
    if (editing) {
      await update.mutateAsync({ id: editing.id, name, members: selected });
    } else {
      await create.mutateAsync({ name, members: selected });
    }
    setName("");
    setSelected([]);
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ash">
          {isAudio
            ? "A pool is a set of sounds a job plays from, chosen at random each call."
            : "A pool is a set of caller IDs a job dials from, spread so no one number is over-used."}
        </p>
      </header>

      <Panel>
        <div className="space-y-4">
          <h2 className="display text-base font-semibold text-chalk">
            {editing ? `Edit ${editing.name}` : `New ${isAudio ? "audio" : "CLI"} pool`}
          </h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isAudio ? "e.g. WOW" : "e.g. global-cli-pool"}
            className={`${input} max-w-sm`}
          />
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider text-ash">
              Members ({memberWord})
            </p>
            {memberOptions.length === 0 ? (
              <p className="text-sm text-ash">
                {isAudio ? "Upload a sound first." : "Add a caller ID first."}
              </p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {memberOptions.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-chalk">
                    <input
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, m.id]
                            : selected.filter((x) => x !== m.id),
                        )
                      }
                      className="accent-live-bright"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Button type="button" onClick={submit} disabled={!name || create.isPending || update.isPending}>
              {editing ? "Save pool" : "Create pool"}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={() => { setEditing(null); setName(""); setSelected([]); }}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        {list.isLoading && <TableSkeleton rows={3} />}
        {!list.isLoading && pools.length === 0 && (
          <EmptyState title="No pools yet" description="Create one above." />
        )}
        {pools.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-steel text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">{memberWord}</th>
                  <th className="py-2 pr-4">Rotation</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {pools.map((p) => (
                  <tr key={p.id} className="border-b border-steel/50">
                    <td className="py-2 pr-4 text-chalk">{p.name}</td>
                    <td className="py-2 pr-4 tabular-nums text-ash">{p.member_count}</td>
                    <td className="py-2 pr-4 capitalize text-ash">{p.rotation.replace("_", " ")}</td>
                    <td className="space-x-3 py-2 text-right">
                      <button
                        onClick={() => { setEditing(p); setName(p.name); setSelected(p.members); }}
                        className="text-live-bright hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove.mutate(p.id)}
                        className="text-rust hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
