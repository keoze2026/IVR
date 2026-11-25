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
 *   * Actions are labelled with words, because the people using this are not
 *     using it daily and should not have to remember what an icon means.
 */

import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, useNavigate, useParams, useLocation } from "react-router-dom";

import {
  ChevronIcon,
  HomeIcon,
  LogOutIcon,
  MenuIcon,
  PhoneOutIcon,
  PlusIcon,
  SettingsIcon,
} from "@/components/icons";
import { PulseLoader } from "@/components/styled/PulseLoader";
import {
  BackLink,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Panel,
  PanelHeader,
  TableSkeleton,
  cx,
  Stat,
} from "@/components/ui";
import type { ApiError } from "@/lib/errors";
import {
  useCreateRow,
  useDeleteRow,
  usePlatformList,
  usePlatformOverview,
  usePlatformRow,
  usePlatformSchema,
  useResetCode,
  useUpdateRow,
  type ResourceSchema,
} from "@/lib/queries/platform";
import { useSession } from "@/lib/session";

import { RecordForm, editableFields } from "./RecordForm";

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

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The label for one of something, for "Add …" buttons. */
function singular(label: string): string {
  return label
    .replace(/\bPeople$/i, "person")
    .replace(/ies$/, "y")
    .replace(/s$/, "")
    .toLowerCase();
}

function groupResources(resources: ResourceSchema[]) {
  return Object.entries(
    resources.reduce<Record<string, ResourceSchema[]>>((acc, r) => {
      (acc[r.group] ??= []).push(r);
      return acc;
    }, {}),
  );
}

// ---------------------------------------------------------------- shell

/** The same frame as the calling portal: sidebar, top bar, drawer below `lg`. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { data } = usePlatformSchema();
  const { me, signOut } = useSession();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const name = me?.session_username ?? "administrator";
  const sidebar = (
    <AdminSidebar resources={data?.resources ?? []} onSignOut={() => void signOut()} />
  );

  return (
    <div className="min-h-dvh text-chalk lg:flex lg:gap-4 lg:p-4">
      <aside className="surface-forest sticky top-4 hidden h-[calc(100dvh-2rem)] w-64 shrink-0 flex-col overflow-hidden rounded-[var(--radius-shell)] lg:flex">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-forest/55 backdrop-blur-sm"
          />
          <div className="surface-forest settle absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col rounded-r-[var(--radius-shell)]">
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col bg-void lg:rounded-[var(--radius-shell)]">
        <header className="m-3 mb-0 flex min-h-16 shrink-0 items-center gap-3 rounded-3xl border border-edge/70 bg-panel px-4 shadow-[var(--shadow-card)] lg:mx-6 lg:mt-5 lg:px-5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="press -ml-2 flex size-11 items-center justify-center rounded-xl text-ash hover:bg-raised lg:hidden"
          >
            <MenuIcon />
          </button>

          <div className="hidden leading-tight md:block">
            <div className="text-xs font-semibold text-ash-dim">Today</div>
            <div className="display text-base text-chalk">
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="min-w-0 text-right leading-tight">
              <div className="truncate text-sm font-medium text-chalk">{name}</div>
              <div className="truncate text-xs text-ash-dim">System administrator</div>
            </div>
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-forest text-sm font-extrabold text-mint ring-4 ring-live"
            >
              {name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 overflow-x-hidden px-4 py-6 lg:px-6 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}

const NAV_ITEM = "press flex min-h-12 items-center gap-3 rounded-full px-4 text-sm font-semibold";
const NAV_IDLE = "text-white/75 hover:bg-white/10 hover:text-white";

function navClass({ isActive }: { isActive: boolean }) {
  return cx(
    NAV_ITEM,
    isActive ? "bg-white text-forest shadow-[var(--shadow-raised)]" : NAV_IDLE,
  );
}

function AdminSidebar({
  resources,
  onSignOut,
}: {
  resources: ResourceSchema[];
  onSignOut: () => void;
}) {
  return (
    <>
      <Link to="/admin" className="flex h-20 shrink-0 items-center gap-3 px-6">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-mint text-forest">
          <SettingsIcon className="size-6" />
        </span>
        <span className="display text-lg text-white">Administration</span>
      </Link>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-2" aria-label="Administration sections">
        <NavLink to="/admin" end className={navClass}>
          <HomeIcon />
          Overview
        </NavLink>
        {groupResources(resources).map(([group, items]) => (
          <AdminNavGroup key={group} group={group} items={items} />
        ))}
      </nav>

      <div className="m-4 mt-2 space-y-1 rounded-3xl bg-white/[0.07] p-2">
        <Link to="/dashboard" className={cx(NAV_ITEM, NAV_IDLE)}>
          <PhoneOutIcon />
          Calling portal
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          className={cx(NAV_ITEM, "w-full", NAV_IDLE)}
        >
          <LogOutIcon />
          Sign out
        </button>
      </div>
    </>
  );
}

function AdminNavGroup({ group, items }: { group: string; items: ResourceSchema[] }) {
  const { pathname } = useLocation();
  // Open the group by default if it contains the currently active page.
  const isActive = items.some(
    (r) => pathname === `/admin/${r.resource}` || pathname.startsWith(`/admin/${r.resource}/`),
  );
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="press mt-3 flex min-h-11 w-full items-center justify-between rounded-full px-4 text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white"
      >
        {group}
        <ChevronIcon className={cx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-1">
          {items.map((r) => (
            <NavLink
              key={r.resource}
              to={`/admin/${r.resource}`}
              className={(state) => cx(navClass(state), "pl-6")}
            >
              {r.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- overview

export function AdminOverviewPage() {
  const schema = usePlatformSchema();
  const overview = usePlatformOverview();
  const resources = schema.data?.resources ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Changes apply immediately and are logged." />

      {schema.error && <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />}
      {overview.error && (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      )}
      {schema.isLoading && (
        <Panel>
          <TableSkeleton rows={6} />
        </Panel>
      )}

      {resources.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {resources.slice(0, 4).map((r) => (
            <Stat
              key={r.resource}
              label={r.label}
              value={String(overview.data?.counts?.[r.resource] ?? "—")}
              to={`/admin/${r.resource}`}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groupResources(resources).map(([group, items]) => (
          <Panel key={group} className="overflow-hidden">
            <PanelHeader title={group} />
            <ul className="space-y-1 p-3">
              {items.map((r) => (
                <li key={r.resource}>
                  <Link
                    to={`/admin/${r.resource}`}
                    className="flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 hover:bg-void"
                  >
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-live text-sm font-extrabold text-live-bright"
                    >
                      {r.label.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-chalk">{r.label}</span>
                    {r.readonly && <Badge>View only</Badge>}
                    <span className="num display min-w-10 text-right text-xl text-chalk">
                      {overview.data?.counts?.[r.resource] ?? "—"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- schema gate

/** Resolves the resource in the address, or says why it cannot be shown. */
function ResourceGate({
  children,
}: {
  children: (schema: ResourceSchema) => React.ReactNode;
}) {
  const { resource = "", id } = useParams();
  const { data, error, refetch } = usePlatformSchema();
  const schema = data?.resources.find((r) => r.resource === resource);

  if (schema) {
    // Keyed so a search box or a revealed code never carries over to another page.
    return <div key={`${resource}/${id ?? ""}`}>{children(schema)}</div>;
  }
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data) return <EmptyState title="No such section" />;
  return (
    <Panel>
      <TableSkeleton />
    </Panel>
  );
}

/** A save error that no single field on the form is able to show. */
function FormError({ error, schema }: { error: ApiError | null; schema: ResourceSchema }) {
  if (!error) return null;
  const shown = new Set(editableFields(schema).map((f) => f.name));
  const names = Object.keys(error.fieldErrors ?? {});
  if (names.length > 0 && names.every((n) => shown.has(n))) return null;
  return <ErrorState error={error} />;
}

// ---------------------------------------------------------------- list

export function AdminListPage() {
  return <ResourceGate>{(schema) => <ResourceList schema={schema} />}</ResourceGate>;
}

function ResourceList({ schema }: { schema: ResourceSchema }) {
  const { resource } = schema;
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch } = usePlatformList(resource, search);
  const rows = data?.results ?? [];
  const total = data?.count;

  const subtitle = [
    total == null
      ? data && `${rows.length} shown`
      : total > rows.length
        ? `Showing ${rows.length} of ${total} records`
        : `${total} record${total === 1 ? "" : "s"}`,
    schema.readonly && "View only",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        title={schema.label}
        subtitle={subtitle || undefined}
        actions={
          !schema.readonly && (
            <Button variant="primary" onClick={() => navigate(`/admin/${resource}/new`)}>
              <PlusIcon className="size-4" /> Add {singular(schema.label)}
            </Button>
          )
        }
      />

      {schema.search.length > 0 && (
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search by ${schema.search.map(humanise).join(", ")}`}
          aria-label={`Search ${schema.label}`}
          className="max-w-md"
        />
      )}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {isLoading && (
        <Panel>
          <TableSkeleton rows={6} />
        </Panel>
      )}

      {data && rows.length === 0 && (
        <EmptyState
          title={search ? "Nothing matched that search" : "There is nothing here yet"}
        />
      )}

      {rows.length > 0 && (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {schema.columns.map((c) => (
                    <th key={c}>{capitalise(humanise(c))}</th>
                  ))}
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {schema.columns.map((c, i) => {
                      const text = cell(row[c]);
                      return (
                        <td key={c}>
                          {i === 0 ? (
                            <Link
                              to={`/admin/${resource}/${row.id}`}
                              title={text}
                              className="flex min-h-9 max-w-64 items-center font-medium text-chalk hover:text-signal"
                            >
                              <span className="truncate">{text}</span>
                            </Link>
                          ) : (
                            <span title={text} className="block max-w-64 truncate">
                              {text}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-right">
                      <Link
                        to={`/admin/${resource}/${row.id}`}
                        aria-label={`${schema.readonly ? "View" : "Change"} ${row.display ?? cell(row[schema.columns[0] ?? "id"])}`}
                        className="press inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-medium text-signal ring-1 ring-inset ring-edge hover:bg-live"
                      >
                        {schema.readonly ? "View" : "Change"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- create

export function AdminCreatePage() {
  return <ResourceGate>{(schema) => <ResourceCreate schema={schema} />}</ResourceGate>;
}

/** A one-time sign-in code with its copy button. */
function SignInCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div role="status" className="flex flex-wrap items-center gap-3">
      <code className="rounded-xl bg-live px-4 py-2.5 font-mono text-2xl tracking-[0.3em] text-live-bright">
        {code}
      </code>
      <Button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          } catch {
            // The code stays on screen to be copied by hand.
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function ResourceCreate({ schema }: { schema: ResourceSchema }) {
  const { resource } = schema;
  const navigate = useNavigate();
  const create = useCreateRow(resource);
  // A person's sign-in code is generated on creation and can be read exactly
  // once. When the server returns one, hold the create page open and show it
  // rather than navigating straight back to the list, where it would be lost.
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);

  if (issued) {
    return (
      <div className="max-w-lg space-y-6">
        <PageHeader title="Person added" />
        <Panel accent className="space-y-4 p-5">
          <p className="text-sm text-ash">
            Give this person their sign-in details. The code is shown{" "}
            <strong className="text-chalk">once</strong>. It cannot be read again,
            only reset.
          </p>
          <p className="break-words text-sm">
            <span className="text-ash">Name:</span>{" "}
            <strong className="text-chalk">{issued.name}</strong>
          </p>
          <SignInCode code={issued.code} />
          <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
            <Button type="button" onClick={() => setIssued(null)}>
              Add another
            </Button>
            <Button type="button" variant="primary" onClick={() => navigate(`/admin/${resource}`)}>
              Done
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <BackLink to={`/admin/${resource}`}>Back to {schema.label.toLowerCase()}</BackLink>
        <PageHeader title={`Add ${singular(schema.label)}`} />
      </div>

      <FormError error={create.error} schema={schema} />

      <RecordForm
        schema={schema}
        submitLabel="Create"
        submitting={create.isPending}
        fieldErrors={create.error?.fieldErrors}
        onCancel={() => navigate(`/admin/${resource}`)}
        onSubmit={async (values) => {
          const row = (await create.mutateAsync(stripEmpty(values))) as Record<
            string,
            unknown
          >;
          const code = row?.access_code;
          if (resource === "users" && typeof code === "string") {
            setIssued({
              name: String(row.username ?? values.username ?? "the new person"),
              code,
            });
          } else {
            navigate(`/admin/${resource}`);
          }
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
  return <ResourceGate>{(schema) => <ResourceEdit schema={schema} />}</ResourceGate>;
}

function ResourceEdit({ schema }: { schema: ResourceSchema }) {
  const { resource } = schema;
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: row, isLoading, error, refetch } = usePlatformRow(resource, id);
  const update = useUpdateRow(resource);
  const remove = useDeleteRow(resource);
  const resetCode = useResetCode(resource);
  const [confirming, setConfirming] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Panel>
        <TableSkeleton />
      </Panel>
    );
  }
  if (!row) {
    return (
      <div className="space-y-4">
        <BackLink to={`/admin/${resource}`}>Back to {schema.label.toLowerCase()}</BackLink>
        {error && error.status !== 404 ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <EmptyState title="That record was not found" />
        )}
      </div>
    );
  }

  const hasSide = resource === "users" || !schema.readonly;

  return (
    <div className="space-y-6">
      <div className="space-y-2 [overflow-wrap:anywhere]">
        <BackLink to={`/admin/${resource}`}>Back to {schema.label.toLowerCase()}</BackLink>
        <PageHeader
          title={String(row.display ?? schema.label)}
          subtitle={`Reference: ${row.id}`}
        />
      </div>

      <FormError error={update.error} schema={schema} />

      <div
        className={cx(
          "grid grid-cols-1 items-start gap-4",
          hasSide && "lg:grid-cols-[minmax(0,1fr)_320px]",
        )}
      >
        {schema.readonly ? (
          <Panel className="min-w-0 overflow-hidden">
            <PanelHeader title="Details" action={<Badge>View only</Badge>} />
            <dl className="divide-y divide-edge text-sm">
              {schema.fields.map((f) => (
                <div key={f.name} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:gap-3">
                  <dt className="text-ash">{f.label}</dt>
                  <dd className="min-w-0 break-words font-medium text-chalk [overflow-wrap:anywhere]">
                    {cell(row[f.name])}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
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

        {hasSide && (
          <div className="min-w-0 space-y-4">
            {resource === "users" && (
              <Panel>
                <PanelHeader title="Sign-in code" />
                <div className="space-y-3 p-4">
                  <p className="text-sm text-ash">
                    Codes cannot be read back. A reset stops the old one
                    immediately and shows the new one once.
                  </p>
                  {newCode ? (
                    <SignInCode code={newCode} />
                  ) : (
                    <Button
                      type="button"
                      loading={resetCode.isPending}
                      onClick={async () => {
                        const r = await resetCode.mutateAsync(id);
                        setNewCode(r.access_code);
                      }}
                    >
                      {resetCode.isPending ? "Issuing…" : "Reset sign-in code"}
                    </Button>
                  )}
                  {resetCode.error && <ErrorState error={resetCode.error} />}
                </div>
              </Panel>
            )}

            {!schema.readonly && (
              <section className="rounded-[var(--radius-card)] border border-rust/40 bg-panel shadow-[var(--shadow-card)]">
                <h2 className="display border-b border-edge px-4 py-3 text-sm text-chalk">
                  Delete this record
                </h2>
                <div className="space-y-3 p-4 [overflow-wrap:anywhere]">
                  {!confirming ? (
                    <>
                      <p className="text-sm text-ash">
                        Removes it and everything that belongs to it. This cannot
                        be undone.
                      </p>
                      <Button
                        type="button"
                        className="!text-rust"
                        onClick={() => setConfirming(true)}
                      >
                        Delete
                      </Button>
                    </>
                  ) : (
                    <div role="alert" className="space-y-3">
                      <p className="text-sm text-chalk">
                        Delete <strong>{row.display ?? "this record"}</strong>?
                        Everything belonging to it is deleted too.
                      </p>
                      {remove.error && <ErrorState error={remove.error} />}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="danger"
                          loading={remove.isPending}
                          onClick={async () => {
                            await remove.mutateAsync(id);
                            navigate(`/admin/${resource}`);
                          }}
                        >
                          {remove.isPending ? "Deleting…" : "Yes, delete it"}
                        </Button>
                        <Button type="button" onClick={() => setConfirming(false)}>
                          Keep it
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- guard

/** Sends anyone who is not an administrator to the right sign-in page. */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { me, isLoading } = useSession();
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <PulseLoader label="Loading" />
      </div>
    );
  }
  if (me?.session_kind !== "admin") return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
