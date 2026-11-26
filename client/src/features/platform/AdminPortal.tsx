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
import { Link, Navigate, useNavigate, useParams, useLocation } from "react-router-dom";

import {
  AlertIcon,
  ChartIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  FlowIcon,
  HashIcon,
  KeyIcon,
  ListIcon,
  LogOutIcon,
  PhoneIcon,
  ShieldIcon,
  SoundIcon,
  UsersIcon,
  WalletIcon,
  MenuIcon,
  PhoneOutIcon,
  PlusIcon,
  SettingsIcon,
} from "@/components/icons";
import { PulseLoader } from "@/components/styled/PulseLoader";
import {
  BackLink,
  Stat,
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
} from "@/components/ui";
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

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function groupResources(resources: ResourceSchema[]) {
  return Object.entries(
    resources.reduce<Record<string, ResourceSchema[]>>((acc, r) => {
      (acc[r.group] ??= []).push(r);
      return acc;
    }, {}),
  );
}

/** A picture for each group in the menu. */
const GROUP_ICONS: Record<string, typeof ChartIcon> = {
  Tenancy: UsersIcon,
  Calling: PhoneIcon,
  Billing: WalletIcon,
  Contacts: ListIcon,
  Compliance: ShieldIcon,
  Scripts: FlowIcon,
  "Call data": ChartIcon,
};

/** A picture for each kind of record on the overview. */
const RESOURCE_ICONS: Record<string, typeof ChartIcon> = {
  organizations: UsersIcon, users: UsersIcon, "api-keys": KeyIcon,
  "audio-pools": SoundIcon, "cli-pools": HashIcon, "caller-ids": HashIcon,
  campaigns: PhoneIcon, "campaign-contacts": ListIcon, wallets: WalletIcon,
  tariffs: ChartIcon, "contact-lists": ListIcon, contacts: UsersIcon,
  consent: CheckIcon, dnc: ShieldIcon, "calling-windows": ClockIcon,
  "npa-jurisdictions": HashIcon, "scrub-jobs": ClockIcon, incidents: AlertIcon,
  flows: FlowIcon, "flow-versions": FlowIcon, "transfer-endpoints": PhoneIcon,
  audio: SoundIcon, calls: PhoneIcon, dtmf: HashIcon, "audit-log": ListIcon,
};

/** The records an administrator looks at first, shown as headline figures. */
const HEADLINES = ["organizations", "users", "campaigns", "contacts"];

/** Horizontal bars comparing record counts, longest bar first or in menu order. */
function BarChart({ title, rows }: { title: string; rows: { label: string; total: number }[] }) {
  const max = Math.max(...rows.map((r) => r.total), 0);
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title={title} />
      <ul className="space-y-4 p-5">
        {rows.map(({ label, total }) => (
          <li key={label} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3 text-sm">
            <span className="truncate font-semibold text-ash">{label}</span>
            <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-raised">
              <span
                className="block h-full rounded-full bg-signal"
                style={{ width: total && max ? `${Math.max(2, (total / max) * 100)}%` : 0 }}
              />
            </span>
            <span className="num text-right font-bold text-chalk">{total.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </Panel>
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
    <div className="min-h-dvh text-chalk lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-edge bg-panel lg:flex">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-scrim/50"
          />
          <div className="settle absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-panel shadow-[var(--shadow-raised)]">
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-edge bg-panel px-4 lg:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="press -ml-2 flex size-11 items-center justify-center rounded-xl text-ash hover:bg-raised lg:hidden"
          >
            <MenuIcon />
          </button>

          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="min-w-0 text-right leading-tight">
              <div className="truncate text-sm font-medium text-chalk">Signed in as {name}</div>
            </div>
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-live text-sm font-bold text-live-bright"
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

const NAV_ITEM = "press flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold";
const NAV_IDLE = "text-ash hover:bg-raised hover:text-chalk";

function navClass({ isActive }: { isActive: boolean }) {
  return cx(
    NAV_ITEM,
    isActive ? "nav-active" : NAV_IDLE,
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
        <span className="flex size-10 items-center justify-center rounded-lg btn-solid">
          <SettingsIcon className="size-6" />
        </span>
        <span className="display text-base leading-tight text-chalk">System administration</span>
      </Link>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-2" aria-label="Administration sections">
        {groupResources(resources).map(([group, items]) => (
          <AdminNavGroup key={group} group={group} items={items} />
        ))}
      </nav>

      <div className="m-3 mt-2 space-y-1 rounded-xl border border-edge bg-void p-2">
        <Link to="/campaigns" className={cx(NAV_ITEM, NAV_IDLE)}>
          <PhoneOutIcon />
          Go to the campaigns portal
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
  const Icon = GROUP_ICONS[group] ?? ChartIcon;
  // Open the group by default if it contains the currently active page.
  const isActive = items.some((r) => pathname.startsWith(`/admin/${r.resource}`));

  return (
    <details open={isActive} className="group">
      <summary className="press mt-1 flex min-h-11 w-full cursor-pointer select-none list-none items-center gap-3 rounded-lg px-3 text-sm font-semibold text-chalk hover:bg-raised [&::-webkit-details-marker]:hidden">
        <Icon className="size-[18px] text-ash-dim" />
        <span className="flex-1">{group}</span>
        <ChevronIcon className="size-4 text-ash-dim transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-1">
        {items.map((r) => {
          const isCurrent = pathname.startsWith(`/admin/${r.resource}`);
          return (
            <Link
              key={r.resource}
              to={`/admin/${r.resource}`}
              aria-current={isCurrent ? "page" : undefined}
              className={cx(navClass({ isActive: isCurrent }), "pl-11")}
            >
              {r.label}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- overview

export function AdminOverviewPage() {
  const schema = usePlatformSchema();
  const overview = usePlatformOverview();
  const resources = schema.data?.resources ?? [];
  const groups = groupResources(resources);
  const countOf = (key: string) => overview.data?.counts?.[key] ?? 0;
  const totals = groups.map(([group, items]) => ({
    group,
    total: items.reduce((sum, r) => sum + countOf(r.resource), 0),
  }));
  const headlines = HEADLINES.flatMap((key) => resources.filter((r) => r.resource === key));
  const top = resources
    .map((r) => ({ label: r.label, total: countOf(r.resource) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, totals.length);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Everything in the system"
        subtitle="You can view, add, change and remove any record here, across every organisation. Changes take effect immediately and are recorded in the audit log."
      />

      {schema.error && <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />}
      {overview.error && (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      )}
      {schema.isLoading && (
        <Panel>
          <TableSkeleton rows={6} />
        </Panel>
      )}

      {headlines.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {headlines.map((r) => (
            <Stat
              key={r.resource}
              label={r.label}
              icon={RESOURCE_ICONS[r.resource]}
              value={overview.data ? countOf(r.resource).toLocaleString() : "—"}
            />
          ))}
        </div>
      )}

      {overview.data && totals.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <BarChart
            title="Records by section"
            rows={totals.map((t) => ({ label: t.group, total: t.total }))}
          />
          {top.length > 0 && <BarChart title="Most records" rows={top} />}
        </div>
      )}

      <div className="gap-4 md:columns-2 xl:columns-3">
        {groups.map(([group, items]) => (
          <Panel key={group} className="mb-4 break-inside-avoid overflow-hidden">
            <PanelHeader title={group} />
            <ul className="divide-y divide-edge px-3">
              {items.map((r) => {
                const Icon = RESOURCE_ICONS[r.resource] ?? ChartIcon;
                return (
                  <li key={r.resource}>
                    <Link
                      to={`/admin/${r.resource}`}
                      className="flex min-h-14 items-center gap-3 px-2 py-2.5 hover:bg-void"
                    >
                      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-live text-live-bright">
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-chalk">{r.label}</span>
                      {r.readonly && <Badge>View only</Badge>}
                      <span className="num display min-w-8 text-right text-base text-chalk">
                        {overview.data?.counts?.[r.resource] ?? "—"}
                      </span>
                    </Link>
                  </li>
                );
              })}
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
  const { resource = "" } = useParams();
  const { data, error, refetch } = usePlatformSchema();
  const schema = data?.resources.find((r) => r.resource === resource);

  if (schema) return <>{children(schema)}</>;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data) return <EmptyState title="No such section" />;
  return (
    <Panel>
      <TableSkeleton />
    </Panel>
  );
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

  const subtitle =
    (total != null
      ? `${total} record${total === 1 ? "" : "s"}`
      : `${rows.length} shown`) +
    (schema.readonly ? " · view only, this record cannot be changed" : "");

  return (
    <div className="space-y-6">
      <PageHeader
        title={schema.label}
        subtitle={subtitle}
        actions={
          !schema.readonly && (
            <Button variant="primary" onClick={() => navigate(`/admin/${resource}/new`)}>
              <PlusIcon className="size-4" /> Add {schema.label.replace(/s$/, "").toLowerCase()}
            </Button>
          )
        }
      />

      {schema.search.length > 0 && (
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search by ${schema.search.map(humanise).join(", ")}`}
          className="max-w-md"
        />
      )}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {isLoading && (
        <Panel>
          <TableSkeleton rows={6} />
        </Panel>
      )}

      {!isLoading && rows.length === 0 && (
        <EmptyState
          title={search ? "Nothing matched that search." : "There is nothing here yet."}
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
                          <span
                            title={text}
                            className={cx(
                              "block max-w-64 truncate",
                              i === 0 && "font-medium text-chalk",
                            )}
                          >
                            {text}
                          </span>
                        </td>
                      );
                    })}
                    <td className="text-right">
                      <Link
                        to={`/admin/${resource}/${row.id}`}
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
  return (
    <div role="status" className="flex flex-wrap items-center gap-3">
      <code className="rounded-xl bg-live px-4 py-2.5 font-mono text-2xl tracking-[0.3em] text-live-bright">
        {code}
      </code>
      <Button type="button" onClick={() => navigator.clipboard?.writeText(code)}>
        Copy
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
            <strong className="text-chalk">once</strong> — it cannot be read
            again, only reset.
          </p>
          <p className="break-words text-sm">
            <span className="text-ash">Name:</span>{" "}
            <strong className="text-chalk">{issued.name}</strong>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ash">Code:</span>
            <SignInCode code={issued.code} />
          </div>
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
        <PageHeader title={`Add ${schema.label.replace(/s$/, "").toLowerCase()}`} />
      </div>

      {create.error && !create.error.fieldErrors && <ErrorState error={create.error} />}

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
          <EmptyState title="That record was not found." />
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

      {update.error && !update.error.fieldErrors && <ErrorState error={update.error} />}

      <div
        className={cx(
          "grid grid-cols-1 items-start gap-4",
          hasSide && "lg:grid-cols-[minmax(0,1fr)_320px]",
        )}
      >
        {schema.readonly ? (
          <Panel className="min-w-0 overflow-hidden">
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
                    A code can't be read back — it's stored hashed. Reset to
                    issue a new one and show it here once; the old code stops
                    working immediately.
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
                        Permanently removes it, along with anything that belongs
                        to it. This cannot be undone.
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
        <PulseLoader label="Loading…" />
      </div>
    );
  }
  if (me?.session_kind !== "admin") return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
