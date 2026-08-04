/**
 * The frame every signed-in screen sits in.
 *
 * A suspended organisation gets a permanent banner: `is_suspended` makes
 * `pace()` return early on every tick, so a campaign can sit in `running`
 * and place no calls at all. Without the banner that reads as a bug.
 */

import { NavLink, Outlet } from "react-router-dom";

import { Button, Spinner, cx } from "@/components/ui";
import { useSession } from "@/lib/session";

const NAV = [
  { to: "/campaigns", label: "Campaigns" },
  { to: "/contact-lists", label: "Contacts" },
  { to: "/flows", label: "Flows" },
  { to: "/calls", label: "Calls" },
  { to: "/compliance/dnc", label: "Compliance" },
  { to: "/caller-ids", label: "Caller IDs" },
];

export function AppShell() {
  const { me, isLoading, signOut } = useSession();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading your organisation" />
      </div>
    );
  }

  const org = me?.organization;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <span className="text-sm font-semibold text-ink">Outbound IVR</span>

          <nav className="flex items-center gap-1" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-brand-50 font-medium text-brand-700"
                      : "text-muted hover:bg-canvas hover:text-ink",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {org && <span className="text-sm text-muted">{org.name}</span>}
            {me?.role && (
              <span className="rounded-full border border-line px-2 py-0.5 text-xs capitalize text-muted">
                {me.role}
              </span>
            )}
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {org?.is_suspended && (
        <div
          role="alert"
          className="border-b border-stop-600/25 bg-stop-50 px-6 py-2 text-center text-sm text-stop-600"
        >
          <strong className="font-medium">This organisation is suspended.</strong>{" "}
          No campaign will place calls
          {org.suspension_reason ? ` — ${org.suspension_reason}` : "."}
        </div>
      )}

      {me?.degraded && (
        <div className="border-b border-warn-600/25 bg-warn-50 px-6 py-2 text-center text-sm text-warn-600">
          Running against a backend without <code>/api/v1/me/</code>. Permissions
          are not being checked in the UI; the server still enforces them.
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
