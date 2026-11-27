/**
 * The operator portal: its menu, grouped into Operations, Analytics and
 * Infrastructure, and the frame around it (components/shell).
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

import {
  FlowIcon,
  HashIcon,
  HomeIcon,
  ListIcon,
  LogOutIcon,
  PhoneIcon,
  PhoneOutIcon,
  SettingsIcon,
  ShieldIcon,
  SoundIcon,
  UsersIcon,
  WalletIcon,
  ChartIcon,
} from "@/components/icons";
import { MenuHeading, MenuLink, Shell, type MenuEntry } from "@/components/shell/Shell";
import { PulseLoader } from "@/components/styled/PulseLoader";
import { cx } from "@/components/ui";
import { request, type PagedResponse } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Campaign, KpiFrame } from "@/types/domain";

const NAV: { label: string; items: MenuEntry[] }[] = [
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
const TABS: MenuEntry[] = [
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

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

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

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <PulseLoader label="Opening console" />
      </div>
    );
  }

  const org = me?.organization;

  return (
    <Shell
      brand={{ icon: SoundIcon, name: "Outbound" }}
      title={org?.name}
      subtitle={org ? capitalise(me?.role || "signed in") : undefined}
      tabs={TABS}
      menu={(close) => <Menu counts={counts} onNavigate={close} />}
      footer={(close, install) => (
        <Footer rollup={rollup} install={install} onSignOut={signOut} onNavigate={close} />
      )}
      banners={
        <>
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
        </>
      }
    >
      <Outlet />
    </Shell>
  );
}

function Menu({
  counts,
  onNavigate,
}: {
  counts: Record<string, number>;
  onNavigate: () => void;
}) {
  return (
    <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3 lg:space-y-3" aria-label="All sections">
      {NAV.map((group) => (
        <div key={group.label} className="space-y-2 lg:space-y-0.5">
          <MenuHeading>{group.label}</MenuHeading>
          {group.items.map((item) => (
            <MenuLink key={item.to} item={item} count={counts[item.to]} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function Footer({
  rollup,
  install,
  onSignOut,
  onNavigate,
}: {
  rollup: Rollup;
  /** The "Install app" row, when there is something to install. */
  install: ReactNode;
  onSignOut: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className="shrink-0 space-y-2 border-t border-edge p-4 lg:p-3">
      <div className="rounded-xl bg-void px-3.5 py-2.5">
        <div className="text-xs font-semibold text-ash-dim">Account capacity</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className={cx("num text-2xl font-bold leading-none", rollup.dialing > 0 ? "text-signal" : "text-chalk")}>
            {rollup.live}
          </span>
          <span className="num text-xs text-ash-dim">/ {rollup.ceiling || "—"} channels</span>
        </div>
        <p className="mt-1 text-xs text-ash">
          {rollup.dialing === 0
            ? "Nothing is dialing right now."
            : `${rollup.dialing} campaign${rollup.dialing > 1 ? "s" : ""} dialing · ${formatCount(rollup.dialed)} placed`}
        </p>
      </div>
      {/* The top bar carries this on a wide screen. */}
      <div className="lg:hidden">{install}</div>
      <div className="flex gap-2">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              "press flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border text-sm font-bold",
              isActive ? "btn-solid border-transparent" : "border-edge text-chalk hover:bg-raised",
            )
          }
        >
          <SettingsIcon className="size-4" />
          Settings
        </NavLink>
        <button
          type="button"
          onClick={onSignOut}
          className="press flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-rust/20 bg-bad-soft text-sm font-bold text-rust hover:border-rust/50"
        >
          <LogOutIcon className="size-4" />
          Sign out
        </button>
      </div>
    </div>
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
