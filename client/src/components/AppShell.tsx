/**
 * The console frame.
 *
 * Desktop follows the reference dashboard: the application floats on a darker
 * page as one rounded panel, rather than bleeding to the window edges.
 *
 * On a phone that shell would waste the only screen there is, so below `lg`
 * it goes edge to edge, the rail becomes a drawer, and the four things
 * someone actually does on a phone move to a thumb-reachable bar at the
 * bottom: check what is dialing, look at calls, check a number against
 * suppression, and everything else.
 *
 * There is no search field. Search does not exist on this API, and a box that
 * looks like it works and does nothing is worse than no box.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { ChannelMeter } from "@/components/styled/ChannelMeter";
import { PulseLoader } from "@/components/styled/PulseLoader";
import { cx } from "@/components/ui";
import { request, type PagedResponse } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Campaign, KpiFrame } from "@/types/domain";

interface NavEntry {
  to: string;
  label: string;
  group: "general" | "management" | "telephony";
  /** Sub-items shown indented under the parent, matching the reference. */
  children?: { to: string; label: string }[];
}

// Ordered and grouped exactly as the reference dialer's sidebar:
// General (Dashboard, Jobs, CDR) · Management (Wallets, Tariffs) ·
// Telephony (Audio Pools, CLI Pools). The platform's own compliance and
// access screens follow under Govern.
const NAV: NavEntry[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    group: "general",
    children: [
      { to: "/dashboard", label: "Calls Insights" },
      { to: "/dashboard/breakdown", label: "Calls Breakdown" },
    ],
  },
  {
    to: "/jobs",
    label: "Jobs",
    group: "general",
    children: [
      { to: "/jobs", label: "All Jobs" },
      { to: "/jobs/active", label: "Active Jobs" },
    ],
  },
  { to: "/cdr", label: "CDR", group: "general" },

  { to: "/wallet", label: "Wallets", group: "management" },
  { to: "/tariffs", label: "Tariffs", group: "management" },

  { to: "/audio-pools", label: "Audio Pools", group: "telephony" },
  { to: "/cli-pools", label: "CLI Pools", group: "telephony" },
  { to: "/caller-ids", label: "Caller IDs", group: "telephony" },
];
// The staff portal shows only what the reference does: General, Management,
// Telephony. Compliance, People and access keys are administration and live in
// the /admin portal, not here. Their routes still exist for a direct link, but
// they are deliberately off the operator's sidebar.

/** Four, because a fifth stops being thumb-reachable and starts being a menu. */
const TABS = [
  { to: "/campaigns", label: "Campaigns", icon: BarsIcon },
  { to: "/calls", label: "Calls", icon: PhoneIcon },
  { to: "/compliance/dnc", label: "Suppression", icon: ShieldIcon },
];

function useLiveRollup() {
  const { data } = useQuery({
    queryKey: ["campaigns", "live-rollup"],
    queryFn: () =>
      request<PagedResponse<Campaign>>("campaigns/?status=running&page_size=100"),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  const running = data?.results ?? [];

  const stats = useQueries({
    queries: running.map((campaign) => ({
      queryKey: ["campaigns", campaign.id, "stats"],
      queryFn: () => request<KpiFrame>(`campaigns/${campaign.id}/stats/`),
      refetchInterval: 10_000,
      staleTime: 8_000,
    })),
  });

  return {
    live: stats.reduce((sum, q) => sum + (q.data?.live_channels ?? 0), 0),
    ceiling: running.reduce((sum, c) => sum + c.max_concurrent_channels, 0),
    dialing: running.length,
    dialed: stats.reduce((sum, q) => sum + (q.data?.dialed ?? 0), 0),
  };
}

function useNavCounts() {
  const { data } = useQuery({
    queryKey: ["campaigns", "nav-counts"],
    queryFn: () => request<PagedResponse<Campaign>>("campaigns/?page_size=100"),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const all = data?.results ?? [];
  return { "/campaigns": all.filter((c) => c.status === "running").length } as Record<
    string,
    number
  >;
}

export function AppShell() {
  const { me, isLoading, signOut } = useSession();
  const rollup = useLiveRollup();
  const counts = useNavCounts();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);

  // Navigating away is the most common reason the drawer should close, and
  // leaving it open over the new page is disorienting.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // Escape closes it, and the page behind must not scroll while it is open.
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

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <PulseLoader label="Opening console" />
      </div>
    );
  }

  const org = me?.organization;

  const rail = (
    <Rail
      counts={counts}
      rollup={rollup}
      onSignOut={signOut}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <div className="min-h-dvh lg:p-4">
      <div
        className="flex min-h-dvh flex-col overflow-hidden border-edge bg-void
                   lg:min-h-[calc(100dvh-2rem)] lg:flex-row lg:rounded-[--radius-shell] lg:border"
      >
        {/* --- rail: fixed on desktop, drawer below lg ------------------ */}
        <aside className="hidden w-60 shrink-0 border-r border-edge bg-panel lg:flex lg:flex-col">
          {rail}
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 bg-backdrop/80"
            />
            <div className="settle absolute inset-y-0 left-0 flex w-68 max-w-[85vw] flex-col border-r border-edge bg-panel">
              {rail}
            </div>
          </div>
        )}

        {/* --- main ----------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-edge px-4 lg:h-16 lg:gap-6 lg:px-6">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="press -ml-2 flex size-11 items-center justify-center rounded-full text-ash hover:bg-raised hover:text-chalk lg:hidden"
            >
              <MenuIcon />
            </button>

            <span className="flex items-center gap-2 lg:hidden">
              <Mark />
              <span className="display text-sm font-medium text-chalk">Outbound</span>
            </span>

            {/* The full meter needs room to be countable. On a phone it
                collapses to the two numbers that matter. */}
            <div className="hidden w-64 lg:block xl:w-80">
              <ChannelMeter
                live={rollup.live}
                ceiling={rollup.ceiling || 1}
                label={rollup.dialing > 0 ? "channels in use" : "idle"}
              />
            </div>

            <div className="ml-auto flex items-center gap-2 lg:gap-3">
              <span
                className={cx(
                  "num rounded-full border px-2.5 py-1 text-xs lg:hidden",
                  rollup.dialing > 0
                    ? "border-live-bright/40 text-live-bright"
                    : "border-edge text-ash",
                )}
                title="Channels in use across the account"
              >
                {rollup.live}/{rollup.ceiling || "—"}
              </span>

              {org && (
                <>
                  <div className="hidden text-right leading-tight sm:block">
                    <div className="text-sm text-chalk">{org.name}</div>
                    <div className="text-xs capitalize text-ash-dim">
                      {me?.role || "signed in"}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-edge-bright bg-raised text-sm font-medium text-signal"
                  >
                    {org.name.slice(0, 1).toUpperCase()}
                  </span>
                </>
              )}
            </div>
          </header>

          {org?.is_suspended && (
            <Banner tone="rust">
              <strong className="font-medium">This organisation is suspended.</strong>{" "}
              No campaign will place calls
              {org.suspension_reason ? ` — ${org.suspension_reason}` : "."}
            </Banner>
          )}

          {me?.degraded && (
            <Banner tone="amber">
              Some of your permissions could not be confirmed. You may see
              options that are unavailable to your role.
            </Banner>
          )}

          {/* pb clears the bottom bar on mobile, including the home indicator. */}
          <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:px-6 lg:py-6 lg:pb-6">
            <Outlet />
          </main>
        </div>
      </div>

      {/* --- thumb bar ------------------------------------------------- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-edge bg-panel
                   pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cx(
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px]",
                isActive ? "text-signal" : "text-ash",
              )
            }
          >
            {({ isActive }) => (
              <>
                <tab.icon active={isActive} />
                {tab.label}
              </>
            )}
          </NavLink>
        ))}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] text-ash"
        >
          <MenuIcon />
          More
        </button>
      </nav>
    </div>
  );
}

// --- rail contents ----------------------------------------------------

function Rail({
  counts,
  rollup,
  onSignOut,
  onNavigate,
}: {
  counts: Record<string, number>;
  rollup: { live: number; ceiling: number; dialing: number; dialed: number };
  onSignOut: () => void;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="flex h-14 items-center gap-2.5 px-5 lg:h-16">
        <Mark />
        <span className="display text-[15px] font-medium tracking-tight text-chalk">
          Outbound
        </span>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3" aria-label="All sections">
        <NavGroup
          label="General"
          items={NAV.filter((n) => n.group === "general")}
          counts={counts}
          onNavigate={onNavigate}
        />
        <NavGroup
          label="Management"
          items={NAV.filter((n) => n.group === "management")}
          counts={counts}
          onNavigate={onNavigate}
        />
        <NavGroup
          label="Telephony"
          items={NAV.filter((n) => n.group === "telephony")}
          counts={counts}
          onNavigate={onNavigate}
        />
      </nav>

      <div className="px-3 pb-3">
        {/* The reference puts a promo card here. A console should spend that
            slot on something load-bearing. */}
        <div className="rounded-[--radius-card] border border-edge-bright bg-raised p-4">
          <div className="eyebrow">Account capacity</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className={cx(
                "num text-2xl leading-none",
                rollup.dialing > 0 ? "text-live-bright" : "text-ash",
              )}
            >
              {rollup.live}
            </span>
            <span className="num text-xs text-ash-dim">
              / {rollup.ceiling || "—"} channels
            </span>
          </div>
          <p className="mt-2 text-xs text-ash">
            {rollup.dialing === 0
              ? "Nothing is dialing right now."
              : `${rollup.dialing} campaign${rollup.dialing > 1 ? "s" : ""} dialing · ${formatCount(rollup.dialed)} placed`}
          </p>
        </div>

        <div className="mt-2 space-y-0.5">
          <NavItem to="/settings" label="Settings" onNavigate={onNavigate} />
          <button
            onClick={onSignOut}
            className="press min-h-11 w-full rounded-full px-4 text-left text-sm text-ash hover:bg-raised hover:text-chalk"
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}

function NavGroup({
  label,
  items,
  counts,
  onNavigate,
}: {
  label: string;
  items: NavEntry[];
  counts: Record<string, number>;
  onNavigate: () => void;
}) {
  return (
    <div>
      <div className="eyebrow px-4 pb-2">{label}</div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <div key={item.to}>
            <NavItem
              to={item.to}
              label={item.label}
              count={counts[item.to]}
              onNavigate={onNavigate}
            />
            {/* Sub-items, indented, exactly like the reference's expandable
                Dashboard and Jobs groups. */}
            {item.children && (
              <div className="mb-1 ml-4 space-y-0.5 border-l border-edge pl-2">
                {item.children.map((child) => (
                  <NavItem
                    key={child.to}
                    to={child.to}
                    label={child.label}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavItem({
  to,
  label,
  count,
  onNavigate,
}: {
  to: string;
  label: string;
  count?: number;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          "press relative flex min-h-11 items-center gap-2 rounded-full pl-4 pr-3 text-sm",
          isActive
            ? "bg-raised font-medium text-chalk"
            : "text-ash hover:bg-raised hover:text-chalk",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-signal"
              aria-hidden
            />
          )}
          <span className="flex-1">{label}</span>
          {count !== undefined && count > 0 && (
            <span className="num rounded-full bg-live px-2 py-0.5 text-[11px] leading-none text-chalk">
              {count}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

// --- marks ------------------------------------------------------------

/** Three bars at different heights — the channel meter, shrunk to a logo. */
function Mark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0" aria-hidden>
      <rect x="1" y="8" width="3.5" height="4" rx="1.2" fill="var(--color-signal)" />
      <rect x="6.5" y="4" width="3.5" height="12" rx="1.2" fill="var(--color-signal)" />
      <rect x="12" y="6" width="3.5" height="8" rx="1.2" fill="var(--color-live-bright)" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
      {[5, 10, 15].map((y) => (
        <line
          key={y}
          x1="3"
          y1={y}
          x2="17"
          y2={y}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function BarsIcon({ active }: { active?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
      <rect x="2" y="9" width="3.5" height="8" rx="1.2" fill="currentColor" opacity={active ? 1 : 0.75} />
      <rect x="8.25" y="4" width="3.5" height="13" rx="1.2" fill="currentColor" />
      <rect x="14.5" y="7" width="3.5" height="10" rx="1.2" fill="currentColor" opacity={active ? 1 : 0.75} />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
      <path
        d="M5.5 3.5h2.2l1.1 2.8-1.4 1a8.5 8.5 0 0 0 4.3 4.3l1-1.4 2.8 1.1v2.2a1.5 1.5 0 0 1-1.6 1.5C8.4 14.5 5.5 11.6 4 6.1A1.5 1.5 0 0 1 5.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
      <path
        d="M10 2.8l5.5 2v4.6c0 3.3-2.2 6.3-5.5 7.4-3.3-1.1-5.5-4.1-5.5-7.4V4.8l5.5-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Banner({ tone, children }: { tone: "rust" | "amber"; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cx(
        "border-b px-4 py-2.5 text-center text-sm lg:px-6",
        tone === "rust"
          ? "border-rust/30 bg-panel text-rust"
          : "border-amber/30 bg-panel text-amber",
      )}
    >
      {children}
    </div>
  );
}
