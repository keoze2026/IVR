/**
 * The portal frame: a sidebar with the everyday screens, a quiet "Advanced"
 * group for everything else, and a top bar naming the signed-in organisation.
 * Below `lg` the sidebar becomes a drawer and a bottom bar carries the three
 * screens used on a phone.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import {
  ChevronIcon,
  HashIcon,
  HomeIcon,
  ListIcon,
  LogOutIcon,
  MenuIcon,
  PhoneOutIcon,
  SettingsIcon,
  SoundIcon,
  WalletIcon,
} from "@/components/icons";
import { PulseLoader } from "@/components/styled/PulseLoader";
import { cx } from "@/components/ui";
import { request, type PagedResponse } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Campaign } from "@/types/domain";

interface NavEntry {
  to: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

const MAIN: NavEntry[] = [
  { to: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { to: "/jobs", label: "Jobs", icon: PhoneOutIcon },
  { to: "/cdr", label: "Call history", icon: ListIcon },
  { to: "/caller-ids", label: "Numbers", icon: HashIcon },
  { to: "/audio-pools", label: "Audio", icon: SoundIcon },
  { to: "/wallet", label: "Billing", icon: WalletIcon },
];

const ADVANCED: NavEntry[] = [
  { to: "/campaigns", label: "Campaigns" },
  { to: "/contact-lists", label: "Contact lists" },
  { to: "/flows", label: "Call flows" },
  { to: "/cli-pools", label: "Number pools" },
  { to: "/tariffs", label: "Rates" },
  { to: "/compliance", label: "Compliance" },
  { to: "/people", label: "People" },
  { to: "/access-keys", label: "Access keys" },
];

const TABS = MAIN.slice(0, 3);

/** How many jobs are dialing right now. */
function useRunningJobs(): number {
  const { data } = useQuery({
    queryKey: ["campaigns", "live-rollup"],
    queryFn: () =>
      request<PagedResponse<Campaign>>("campaigns/?status=running&page_size=100"),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
  return data?.results.length ?? 0;
}

export function AppShell() {
  const { me, isLoading, signOut } = useSession();
  const running = useRunningJobs();
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
        <PulseLoader label="Loading" />
      </div>
    );
  }

  const org = me?.organization;
  const sidebar = <Sidebar running={running} onSignOut={signOut} />;

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-edge bg-panel lg:flex">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-chalk/40"
          />
          <div className="settle absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col border-r border-edge bg-panel">
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-edge bg-panel px-4 lg:px-8">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="press -ml-2 flex size-11 items-center justify-center rounded-xl text-ash hover:bg-raised lg:hidden"
          >
            <MenuIcon />
          </button>

          {running > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-live px-3 py-1 text-xs font-medium text-live-bright">
              <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
              {running} {running === 1 ? "job" : "jobs"} calling now
            </span>
          )}

          {org && (
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-sm font-medium text-chalk">{org.name}</div>
                <div className="text-xs capitalize text-ash-dim">
                  {me?.role || "signed in"}
                </div>
              </div>
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal text-sm font-bold text-white"
              >
                {org.name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
        </header>

        {org?.is_suspended && (
          <Banner tone="rust">
            <strong className="font-medium">This organisation is suspended.</strong>{" "}
            No calls will be placed
            {org.suspension_reason ? `: ${org.suspension_reason}` : "."}
          </Banner>
        )}

        {me?.degraded && (
          <Banner tone="amber">
            Some of your permissions could not be confirmed. You may see options
            that are unavailable to your role.
          </Banner>
        )}

        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 overflow-x-hidden px-4 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:py-8">
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
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px]",
                isActive ? "text-signal" : "text-ash",
              )
            }
          >
            {tab.icon && <tab.icon />}
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

function Sidebar({ running, onSignOut }: { running: number; onSignOut: () => void }) {
  const { pathname } = useLocation();
  const inAdvanced = ADVANCED.some((n) => pathname.startsWith(n.to));
  const [open, setOpen] = useState(inAdvanced);

  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-signal text-white">
          <SoundIcon />
        </span>
        <span className="display text-lg text-chalk">Outbound</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="All sections">
        {MAIN.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            count={item.to === "/jobs" ? running : 0}
          />
        ))}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="press mt-3 flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-xs font-medium text-ash-dim hover:bg-raised"
        >
          Advanced
          <ChevronIcon className={cx("size-4 transition-transform", open && "rotate-180")} />
        </button>
        {open && ADVANCED.map((item) => <NavItem key={item.to} item={item} />)}
      </nav>

      <div className="space-y-1 border-t border-edge px-3 py-3">
        <NavItem item={{ to: "/settings", label: "Settings", icon: SettingsIcon }} />
        <button
          onClick={onSignOut}
          className="press flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-ash hover:bg-raised hover:text-chalk"
        >
          <LogOutIcon />
          Sign out
        </button>
      </div>
    </>
  );
}

function NavItem({ item, count = 0 }: { item: NavEntry; count?: number }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cx(
          "press flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
          !item.icon && "pl-11",
          isActive
            ? "bg-live font-medium text-live-bright"
            : "text-ash hover:bg-raised hover:text-chalk",
        )
      }
    >
      {item.icon && <item.icon />}
      <span className="flex-1">{item.label}</span>
      {count > 0 && (
        <span className="num rounded-full bg-signal px-2 py-0.5 text-[11px] leading-none text-white">
          {count}
        </span>
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
          ? "border-rust/20 bg-[#fdeaea] text-rust"
          : "border-amber/20 bg-[#fdf1dc] text-amber",
      )}
    >
      {children}
    </div>
  );
}
