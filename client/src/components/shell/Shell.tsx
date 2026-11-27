/**
 * The frame both portals share.
 *
 * On a wide screen: a sidebar and a top bar. On a phone, and in the installed
 * app: a top bar with the menu button on the right, a drawer that slides in
 * from that side, and a bar of buttons along the bottom.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import {
  ChevronRightIcon,
  CloseIcon,
  InstallIcon,
  MenuIcon,
  RefreshIcon,
} from "@/components/icons";
import { InstallHelp } from "@/components/shell/InstallHelp";
import { useCardTables } from "@/components/shell/useCardTables";
import { cx } from "@/components/ui";
import { useInstall } from "@/lib/pwa";

type IconType = ComponentType<{ className?: string }>;

export interface MenuEntry {
  to: string;
  label: string;
  icon: IconType;
  /** Only current on exactly this address. */
  end?: boolean;
}

interface ShellProps {
  brand: { icon: IconType; name: string; to?: string };
  /** The two lines naming who is signed in. */
  title?: string;
  subtitle?: string;
  /** The wording beside the avatar on a wide screen, when it differs. */
  wideLabel?: ReactNode;
  /** The menu itself. `close` shuts the drawer after a choice. */
  menu: (close: () => void) => ReactNode;
  /** What sits under the menu: sign out and the like. */
  footer: (close: () => void, install: ReactNode) => ReactNode;
  tabs: MenuEntry[];
  banners?: ReactNode;
  children: ReactNode;
}

export function Shell({
  brand,
  title,
  subtitle,
  wideLabel,
  menu,
  footer,
  tabs,
  banners,
  children,
}: ShellProps) {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { available, canPrompt, install } = useInstall();
  const main = useRef<HTMLElement>(null);
  useCardTables(main);

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

  const close = () => setDrawerOpen(false);
  const startInstall = () => {
    close();
    if (canPrompt) void install();
    else setHelpOpen(true);
  };
  const installItem = available ? (
    <button type="button" onClick={startInstall} className="menu-item w-full text-left">
      <span className="menu-tile">
        <InstallIcon className="size-[18px]" />
      </span>
      <span className="menu-label">Install app</span>
      <ChevronRightIcon className="size-4 text-ash-dim" />
    </button>
  ) : null;

  const initials = (title ?? brand.name).slice(0, 2).toUpperCase();

  return (
    <div className="min-h-dvh text-chalk lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-edge bg-panel lg:flex">
        <BrandMark brand={brand} />
        {menu(close)}
        {footer(close, installItem)}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="absolute inset-0 bg-scrim/50"
          />
          <div className="slide-in absolute inset-y-0 right-0 flex w-[21rem] max-w-[86vw] flex-col bg-panel pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-raised)]">
            <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-void px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))]">
              <BrandTile icon={brand.icon} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-base font-bold text-chalk">{title ?? brand.name}</div>
                {subtitle && <div className="truncate text-sm text-ash-dim">{subtitle}</div>}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="press flex size-11 items-center justify-center rounded-xl text-ash hover:bg-raised"
              >
                <CloseIcon />
              </button>
            </div>
            {/* On a short phone the whole drawer scrolls, footer included. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [&>nav]:flex-none [&>nav]:overflow-visible">
              {menu(close)}
              {footer(close, installItem)}
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-[4.5rem] shrink-0 items-center gap-2 border-b border-edge bg-panel px-4 pt-[env(safe-area-inset-top)] lg:min-h-16 lg:gap-3 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:hidden">
            <BrandTile icon={brand.icon} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-base font-bold text-chalk">{title ?? brand.name}</div>
              {subtitle && (
                <div className="truncate text-[13px] font-medium text-signal">{subtitle}</div>
              )}
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:gap-3">
            {available && (
              <button
                type="button"
                onClick={startInstall}
                className="press hidden min-h-10 items-center gap-2 rounded-xl border border-edge px-4 text-sm font-semibold text-ash hover:bg-raised hover:text-chalk lg:flex"
              >
                <InstallIcon className="size-4" />
                Install app
              </button>
            )}
            <RefreshButton />
            {title && (
              <>
                <div className="hidden text-right leading-tight lg:block">
                  {wideLabel ?? (
                    <>
                      <div className="text-sm font-bold text-chalk">{title}</div>
                      <div className="text-xs font-medium text-ash-dim">{subtitle}</div>
                    </>
                  )}
                </div>
                <span aria-hidden className="btn-solid flex size-10 items-center justify-center rounded-full text-sm font-bold">
                  {initials}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="press -mr-2 flex size-11 items-center justify-center rounded-xl text-chalk hover:bg-raised lg:hidden"
            >
              <MenuIcon className="size-7" />
            </button>
          </div>
        </header>

        {banners}

        <main
          ref={main}
          className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 overflow-x-hidden px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-6 lg:py-7"
        >
          {children}
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-edge bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => cx(TAB, isActive ? "tab-active" : "text-ash")}
          >
            <tab.icon className="size-6" />
            <span className="max-w-full truncate px-1">{tab.label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={() => setDrawerOpen(true)} className={cx(TAB, "text-ash")}>
          <MenuIcon className="size-6" />
          More
        </button>
      </nav>

      {helpOpen && <InstallHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

const TAB = "relative flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium";

function BrandTile({ icon: Icon }: { icon: IconType }) {
  return (
    <span className="btn-solid flex size-11 shrink-0 items-center justify-center rounded-xl">
      <Icon className="size-6" />
    </span>
  );
}

function BrandMark({ brand }: { brand: ShellProps["brand"] }) {
  const body = (
    <>
      <BrandTile icon={brand.icon} />
      <span className={cx("display leading-tight text-chalk", brand.name.length > 12 ? "text-base" : "text-xl")}>
        {brand.name}
      </span>
    </>
  );
  const shell = "flex h-20 shrink-0 items-center gap-3 px-5";
  return brand.to ? (
    <Link to={brand.to} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** Fetches what is on screen again. An installed app has no reload button. */
function RefreshButton() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      aria-label="Refresh"
      title="Refresh"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await queryClient.invalidateQueries();
        } finally {
          setBusy(false);
        }
      }}
      className="press flex size-11 items-center justify-center rounded-xl text-chalk hover:bg-raised"
    >
      <RefreshIcon className={cx("size-[22px]", busy && "animate-spin")} />
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pb-1 text-xs font-bold uppercase tracking-[0.08em] text-ash-dim">{children}</div>
  );
}

export function MenuLink({
  item,
  count = 0,
  onNavigate,
}: {
  item: MenuEntry;
  count?: number;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cx("press menu-item", isActive && "nav-active")}
    >
      <span className="menu-tile">
        <item.icon className="size-[18px]" />
      </span>
      <span className="menu-label">{item.label}</span>
      {count > 0 && (
        <span className="num rounded-full bg-signal px-2 py-0.5 text-[11px] font-bold leading-none text-ink">
          {count}
        </span>
      )}
      <ChevronRightIcon className="size-4 text-ash-dim" />
    </NavLink>
  );
}
