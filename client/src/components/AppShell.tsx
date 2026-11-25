/**
 * The portal frame: a sidebar grouped into Operations, Analytics and
 * Infrastructure, and a top bar naming the signed-in organisation. Below `lg`
 * the sidebar becomes a drawer and a bottom bar carries the screens used on a
 * phone.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import {
  FlowIcon,
  HashIcon,
  HomeIcon,
  ListIcon,
  LogOutIcon,
  MenuIcon,
  PhoneIcon,
  PhoneOutIcon,
  SettingsIcon,
  ShieldIcon,
  SoundIcon,
  UsersIcon,
  WalletIcon,
  ChartIcon,
} from "@/components/icons";
import { PulseLoader } from "@/components/styled/PulseLoader";
import { cx } from "@/components/ui";
import { request, type PagedResponse } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Campaign, KpiFrame } from "@/types/domain";

interface NavEntry {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV: { label: string; items: NavEntry[] }[] = [
  {
    label: "Operations",
    items: [
      { to: "/campaigns", label: "Campaigns", icon: PhoneOutIcon },
      { to: "/flows", label: "Flows", icon: FlowIcon },
      { to: "/contact-lists", label: "Contact Lists", icon: UsersIcon },
    ],
  },
  {
    label: "Analytics",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: HomeIcon },
      { to: "/calls", label: "Calls", icon: PhoneIcon },
      { to: "/jobs", label: "Jobs", icon: PhoneOutIcon },
      { to: "/cdr", label: "CDR", icon: ListIcon },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { to: "/caller-ids", label: "My Numbers", icon: HashIcon },
      { to: "/audio-pools", label: "Audio Pools", icon: SoundIcon },
      { to: "/cli-pools", label: "CLI Pools", icon: HashIcon },
      { to: "/wallet", label: "Wallets", icon: WalletIcon },
      { to: "/tariffs", label: "Tariffs", icon: ChartIcon },
    ],
  },
];

/** The screens someone uses on a phone. */
const TABS: NavEntry[] = [
  { to: "/campaigns", label: "Campaigns", icon: ChartIcon },
  { to: "/calls", label: "Calls", icon: PhoneIcon },
  { to: "/compliance/dnc", label: "Suppression", icon: ShieldIcon },
];

interface Rollup {
  live: number;
  ceiling: number;
  dialing: number;
  dialed: number;
}

function useLiveRollup(): Rollup {
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

function useNavCounts(): Record<string, number> {
  const { data } = useQuery({
    queryKey: ["campaigns", "nav-counts"],
    queryFn: () => request<PagedResponse<Campaign>>("campaigns/?page_size=100"),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const all = data?.results ?? [];
  return { "/campaigns": all.filter((c) => c.status === "running").length };
}

export function AppShell() {
  const { me, isLoading, signOut } = useSession();
  const rollup = useLiveRollup();
  const counts = useNavCounts();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

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
  const sidebar = (
    <Sidebar
      counts={counts}
      rollup={rollup}
      onSignOut={signOut}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <div className="min-h-dvh lg:flex lg:gap-4 lg:p-4">
      <aside className="surface-forest sticky top-4 hidden h-[calc(100dvh-2rem)] w-64 shrink-0 flex-col overflow-hidden rounded-[var(--radius-shell)] lg:flex">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-scrim/75 backdrop-blur-sm"
          />
          <div className="surface-forest settle absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col rounded-r-[var(--radius-shell)]">
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="m-3 mb-0 flex min-h-14 shrink-0 items-center gap-3 lg:mx-6 lg:mt-1">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="press -ml-2 flex size-11 items-center justify-center rounded-full text-ash hover:bg-raised lg:hidden"
          >
            <MenuIcon />
          </button>

          {org && (
            <div className="card ml-auto flex items-center gap-3 rounded-full border border-edge bg-panel/80 p-1.5 backdrop-blur-md sm:pl-5">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-sm font-bold text-chalk">{org.name}</div>
                <div className="text-xs font-semibold capitalize text-ash-dim">
                  {me?.role || "signed in"}
                </div>
              </div>
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-forest text-sm font-extrabold text-mint ring-4 ring-live"
              >
                {org.name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
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
            Some of your permissions could not be confirmed. You may see options
            that are unavailable to your role.
          </Banner>
        )}

        <main className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 overflow-x-hidden px-4 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:px-6 lg:py-7">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-edge bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cx(
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold",
                isActive ? "text-signal" : "text-ash",
              )
            }
          >
            <tab.icon />
            {tab.label}
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

function Sidebar({
  counts,
  rollup,
  onSignOut,
  onNavigate,
}: {
  counts: Record<string, number>;
  rollup: Rollup;
  onSignOut: () => void;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="flex h-20 shrink-0 items-center gap-3 px-6">
        <span className="flex size-11 items-center justify-center rounded-2xl neon">
          <SoundIcon className="size-6" />
        </span>
        <span className="display text-xl text-white">Outbound</span>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-2" aria-label="All sections">
        {NAV.map((group) => (
          <div key={group.label} className="space-y-1">
            <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-white/50">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavItem key={item.to} item={item} count={counts[item.to]} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>

      <div className="m-4 mt-2 shrink-0 space-y-1 rounded-3xl bg-white/[0.07] p-2">
        <div className="px-3 pb-2 pt-1.5">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">
            Account capacity
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={cx("num text-2xl font-extrabold leading-none", rollup.dialing > 0 ? "text-mint" : "text-white")}>
              {rollup.live}
            </span>
            <span className="num text-xs text-white/60">/ {rollup.ceiling || "—"} channels</span>
          </div>
          <p className="mt-1 text-xs text-white/70">
            {rollup.dialing === 0
              ? "Nothing is dialing right now."
              : `${rollup.dialing} campaign${rollup.dialing > 1 ? "s" : ""} dialing · ${formatCount(rollup.dialed)} placed`}
          </p>
        </div>
        <NavItem item={{ to: "/settings", label: "Settings", icon: SettingsIcon }} onNavigate={onNavigate} />
        <button
          onClick={onSignOut}
          className="press flex min-h-10 w-full items-center gap-3 rounded-full px-1.5 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-white/10">
            <LogOutIcon className="size-4" />
          </span>
          Sign out
        </button>
      </div>
    </>
  );
}

function NavItem({
  item,
  count = 0,
  onNavigate,
}: {
  item: NavEntry;
  count?: number;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          "press group flex min-h-10 items-center gap-3 rounded-full px-1.5 pr-4 text-sm font-semibold",
          isActive
            ? "nav-active"
            : "text-white/75 hover:bg-white/10 hover:text-white",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cx(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              isActive ? "neon" : "bg-white/10",
            )}
          >
            <item.icon className="size-4" />
          </span>
          <span className="flex-1">{item.label}</span>
          {count > 0 && (
            <span className="num rounded-full bg-mint px-2 py-0.5 text-[11px] font-extrabold leading-none text-forest">
              {count}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Banner({ tone, children }: { tone: "rust" | "amber"; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cx(
        "border-b px-4 py-2.5 text-center text-sm lg:px-8",
        tone === "rust"
          ? "border-rust/20 bg-bad-soft text-rust"
          : "border-amber/20 bg-warn-soft text-amber",
      )}
    >
      {children}
    </div>
  );
}
