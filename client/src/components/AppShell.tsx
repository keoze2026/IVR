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
    <div className="min-h-dvh lg:flex lg:gap-4 lg:p-4">
      <aside className="surface-forest sticky top-4 hidden h-[calc(100dvh-2rem)] w-64 shrink-0 flex-col overflow-hidden rounded-[var(--radius-shell)] lg:flex">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
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
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="press -ml-2 flex size-11 items-center justify-center rounded-full text-ash hover:bg-raised lg:hidden"
          >
            <MenuIcon />
          </button>

          <div className="hidden leading-tight md:block">
            <div className="text-xs font-semibold text-ash-dim">Today</div>
            <div className="display text-base text-chalk">
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>

          {running > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-live px-3.5 py-1.5 text-xs font-bold text-live-bright md:ml-3">
              <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
              {running} {running === 1 ? "job" : "jobs"} calling now
            </span>
          )}

          {org && (
            <div className="ml-auto flex items-center gap-3">
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
      <div className="flex h-20 shrink-0 items-center gap-3 px-6">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-mint text-forest">
          <SoundIcon className="size-6" />
        </span>
        <span className="display text-xl text-white">Outbound</span>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-2" aria-label="All sections">
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
          className="press mt-4 flex min-h-11 w-full items-center justify-between rounded-full px-4 text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white"
        >
          Advanced
          <ChevronIcon className={cx("size-4 transition-transform", open && "rotate-180")} />
        </button>
        {open && ADVANCED.map((item) => <NavItem key={item.to} item={item} />)}
      </nav>

      <div className="m-4 mt-2 space-y-1.5 rounded-3xl bg-white/[0.07] p-2">
        <NavItem item={{ to: "/settings", label: "Settings", icon: SettingsIcon }} />
        <button
          onClick={onSignOut}
          className="press flex min-h-12 w-full items-center gap-3 rounded-full px-1.5 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-white/10">
            <LogOutIcon className="size-[18px]" />
          </span>
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
          "press group flex min-h-12 items-center gap-3 rounded-full px-1.5 pr-4 text-sm font-semibold",
          !item.icon && "min-h-10 pl-6",
          isActive
            ? "bg-white text-forest shadow-[var(--shadow-raised)]"
            : "text-white/75 hover:bg-white/10 hover:text-white",
        )
      }
    >
      {({ isActive }) => (
        <>
          {item.icon ? (
            <span
              className={cx(
                "flex size-9 shrink-0 items-center justify-center rounded-full",
                isActive ? "bg-forest text-mint" : "bg-white/10",
              )}
            >
              <item.icon className="size-[18px]" />
            </span>
          ) : (
            <span
              aria-hidden
              className={cx("size-1.5 rounded-full", isActive ? "bg-signal" : "bg-white/35")}
            />
          )}
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
          ? "border-rust/20 bg-[#fdeaea] text-rust"
          : "border-amber/20 bg-[#fdf1dc] text-amber",
      )}
    >
      {children}
    </div>
  );
}
