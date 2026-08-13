/**
 * The system administration portal.
 *
 * One screen per model, all generated from the schema. The parts that are
 * deliberate rather than incidental:
 *
 *   * Everything is named in plain words. The sidebar says "People", not
 *     "accounts.User", and a delete says what it will take with it.
 *
 *   * Destructive actions are two steps and name the thing being destroyed.
 *     An administrator here can delete an organisation and every call it ever
 *     placed; that should never be one misplaced click.
 *
 *   * Nothing is hidden behind an icon. Labels are words, because the people
 *     using this are not using it daily and should not have to remember.
 */

import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import {
  useCreateRow,
  useDeleteRow,
  usePlatformList,
  usePlatformOverview,
  usePlatformRow,
  usePlatformSchema,
  useUpdateRow,
  type ResourceSchema,
} from "@/lib/queries/platform";
import { useSession } from "@/lib/session";

import { RecordForm } from "./RecordForm";

// ---------------------------------------------------------------- helpers

/** A value as a person should read it, whatever the column happens to hold. */
function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  // ISO timestamps are unreadable in a table; dates are what people scan for.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return text;
}

function humanise(name: string): string {
  return name.replace(/_/g, " ").replace(/\bid\b/i, "").trim() || name;
}

// ---------------------------------------------------------------- shell

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { data } = usePlatformSchema();
  const { me, signOut } = useSession();
  const resources = data?.resources ?? [];

  const groups = resources.reduce<Record<string, ResourceSchema[]>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="flex min-h-screen bg-void text-chalk">
      <aside className="hidden w-60 shrink-0 border-r border-edge bg-panel md:block">
        <div className="border-b border-edge px-4 py-4">
          <Link to="/admin" className="display text-sm font-semibold text-chalk">
            System administration
          </Link>
          <p className="mt-1 text-xs text-ash">
            Signed in as {me?.session_username ?? "administrator"}
          </p>
        </div>

        <nav className="space-y-5 px-3 py-4" aria-label="Administration sections">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p className="px-2 pb-1 text-[0.65rem] uppercase tracking-widest text-ash">
                {group}
              </p>
              {items.map((r) => (
                <Link
                  key={r.resource}
                  to={`/admin/${r.resource}`}
                  className="block rounded px-2 py-1.5 text-sm text-ash hover:bg-void hover:text-chalk"
                >
                  {r.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-edge px-3 py-3">
          <Link
            to="/campaigns"
            className="block rounded px-2 py-1.5 text-sm text-ash hover:text-chalk"
          >
            Go to the campaigns portal
          </Link>
          <button
            type="button"
            onClick={() => signOut()}
            className="mt-1 block w-full rounded px-2 py-1.5 text-left text-sm text-ash hover:text-chalk"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------- overview

export function AdminOverviewPage() {
  const { data: schema } = usePlatformSchema();
  const { data: overview } = usePlatformOverview();
  const resources = schema?.resources ?? [];

  const groups = resources.reduce<Record<string, ResourceSchema[]>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <header>
        <h1 className="display text-2xl font-semibold">Everything in the system</h1>
        <p className="mt-1 max-w-2xl text-sm text-ash">
          You can view, add, change and remove any record here, across every
          organisation. Changes take effect immediately and are recorded in the
          audit log.
        </p>
      </header>

      {Object.entries(groups).map(([group, items]) => (
        <section key={group}>
          <h2 className="mb-3 text-xs uppercase tracking-widest text-ash">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((r) => (
              <Link
                key={r.resource}
                to={`/admin/${r.resource}`}
                className="rounded border border-edge bg-panel p-4 hover:border-live-bright"
              >
                <p className="text-sm font-semibold text-chalk">{r.label}</p>
                <p className="mt-1 text-2xl tabular-nums text-live-bright">
                  {overview?.counts?.[r.resource] ?? "—"}
                </p>
                {r.readonly && (
                  <p className="mt-1 text-xs text-ash">View only</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- list

export function AdminListPage() {
  const { resource = "" } = useParams();
  const navigate = useNavigate();
  const { data: schemaData } = usePlatformSchema();
  const schema = schemaData?.resources.find((r) => r.resource === resource);

  const [search, setSearch] = useState("");
  const { data, isLoading, error } = usePlatformList(resource, search);
  const rows = data?.results ?? [];

  if (!schema) {
    return <p className="text-sm text-ash">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display text-2xl font-semibold">{schema.label}</h1>
          <p className="mt-1 text-sm text-ash">
            {data?.count != null
              ? `${data.count} record${data.count === 1 ? "" : "s"}`
              : `${rows.length} shown`}
            {schema.readonly && " · view only, this record cannot be changed"}
          </p>
        </div>
        {!schema.readonly && (
          <button
            type="button"
            onClick={() => navigate(`/admin/${resource}/new`)}
            className="rounded bg-live-bright px-4 py-2 text-sm font-semibold uppercase tracking-wider text-void"
          >
            Add {schema.label.replace(/s$/, "").toLowerCase()}
          </button>
        )}
      </header>

      {schema.search.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search by ${schema.search.map(humanise).join(", ")}`}
          className="w-full max-w-md rounded border border-edge bg-panel px-3 py-2 text-sm text-chalk placeholder:text-ash/60 focus:border-live-bright focus:outline-none"
        />
      )}

      {isLoading && <p className="text-sm text-ash">Loading…</p>}
      {error && <p className="text-sm text-rust">{error.message}</p>}

      {!isLoading && rows.length === 0 && (
        <p className="rounded border border-dashed border-edge px-4 py-8 text-center text-sm text-ash">
          {search ? "Nothing matched that search." : "There is nothing here yet."}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-edge">
          <table className="w-full text-sm">
            <thead className="bg-panel">
              <tr className="text-left text-xs uppercase tracking-wider text-ash">
                {schema.columns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2">
                    {humanise(c)}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-edge/60 hover:bg-raised">
                  {schema.columns.map((c) => (
                    <td key={c} className="whitespace-nowrap px-3 py-2 text-ash">
                      {cell(row[c])}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <Link
                      to={`/admin/${resource}/${row.id}`}
                      className="text-live-bright hover:underline"
                    >
                      {schema.readonly ? "View" : "Change"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- create

export function AdminCreatePage() {
  const { resource = "" } = useParams();
  const navigate = useNavigate();
  const { data } = usePlatformSchema();
  const schema = data?.resources.find((r) => r.resource === resource);
  const create = useCreateRow(resource);

  if (!schema) return <p className="text-sm text-ash">Loading…</p>;

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <Link to={`/admin/${resource}`} className="text-sm text-ash hover:text-chalk">
          ← Back to {schema.label.toLowerCase()}
        </Link>
        <h1 className="display mt-2 text-2xl font-semibold">
          Add {schema.label.replace(/s$/, "").toLowerCase()}
        </h1>
      </header>

      {create.error && !create.error.fieldErrors && (
        <p className="text-sm text-rust">{create.error.message}</p>
      )}

      <RecordForm
        schema={schema}
        submitLabel="Create"
        submitting={create.isPending}
        fieldErrors={create.error?.fieldErrors}
        onCancel={() => navigate(`/admin/${resource}`)}
        onSubmit={async (values) => {
          await create.mutateAsync(stripEmpty(values));
          navigate(`/admin/${resource}`);
        }}
      />
    </div>
  );
}

/**
 * Drop untouched fields rather than sending nulls.
 *
 * A blank optional field means "leave it to the server's default", and posting
 * an explicit null instead overwrites that default with nothing.
 */
function stripEmpty(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- edit

export function AdminEditPage() {
  const { resource = "", id = "" } = useParams();
  const navigate = useNavigate();
  const { data } = usePlatformSchema();
  const schema = data?.resources.find((r) => r.resource === resource);
  const { data: row, isLoading } = usePlatformRow(resource, id);
  const update = useUpdateRow(resource);
  const remove = useDeleteRow(resource);
  const [confirming, setConfirming] = useState(false);

  if (!schema || isLoading) return <p className="text-sm text-ash">Loading…</p>;
  if (!row) return <p className="text-sm text-rust">That record was not found.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <Link to={`/admin/${resource}`} className="text-sm text-ash hover:text-chalk">
          ← Back to {schema.label.toLowerCase()}
        </Link>
        <h1 className="display mt-2 text-2xl font-semibold">
          {row.display ?? schema.label}
        </h1>
        <p className="mt-1 text-xs text-ash">Reference: {row.id}</p>
      </header>

      {update.error && !update.error.fieldErrors && (
        <p className="text-sm text-rust">{update.error.message}</p>
      )}

      {schema.readonly ? (
        <dl className="grid gap-3 rounded border border-edge bg-panel p-4 sm:grid-cols-2">
          {schema.fields.map((f) => (
            <div key={f.name}>
              <dt className="text-xs uppercase tracking-wider text-ash">{f.label}</dt>
              <dd className="text-sm text-chalk">{cell(row[f.name])}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <RecordForm
          schema={schema}
          initial={row}
          submitLabel="Save changes"
          submitting={update.isPending}
          fieldErrors={update.error?.fieldErrors}
          onCancel={() => navigate(`/admin/${resource}`)}
          onSubmit={async (values) => {
            await update.mutateAsync({ id, body: values });
            navigate(`/admin/${resource}`);
          }}
        />
      )}

      {!schema.readonly && (
        <section className="rounded border border-rust/40 bg-panel p-4">
          <h2 className="text-sm font-semibold text-chalk">Delete this record</h2>
          {!confirming ? (
            <>
              <p className="mt-1 text-sm text-ash">
                Permanently removes it, along with anything that belongs to it.
                This cannot be undone.
              </p>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="mt-3 rounded border border-rust px-3 py-1.5 text-sm text-rust hover:bg-rust hover:text-void"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-chalk">
                Delete <strong>{row.display ?? "this record"}</strong>? Everything
                belonging to it is deleted too.
              </p>
              {remove.error && (
                <p className="mt-2 text-sm text-rust">{remove.error.message}</p>
              )}
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={async () => {
                    await remove.mutateAsync(id);
                    navigate(`/admin/${resource}`);
                  }}
                  className="rounded bg-rust px-3 py-1.5 text-sm font-semibold text-void disabled:opacity-50"
                >
                  {remove.isPending ? "Deleting…" : "Yes, delete it"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded border border-edge px-3 py-1.5 text-sm text-ash hover:text-chalk"
                >
                  Keep it
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- guard

/** Sends anyone who is not an administrator to the right sign-in page. */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { me, isLoading } = useSession();
  if (isLoading) return <p className="p-8 text-sm text-ash">Loading…</p>;
  if (me?.session_kind !== "admin") return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
