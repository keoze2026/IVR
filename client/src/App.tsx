/**
 * Routing and global providers.
 *
 * Retry policy is deliberate: nothing below 500 is retried. A 403 will never
 * become a 200, and retrying into a 429 spends a budget shared by every
 * operator in the organisation.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useOutletContext,
} from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { PulseLoader } from "@/components/styled/PulseLoader";
import { EmptyState } from "@/components/ui";
import { ApiError } from "@/lib/errors";
import { SessionProvider, useSession } from "@/lib/session";

import { AccessKeysPage } from "@/features/admin/AccessKeysPage";
import { AdminLoginPage } from "@/features/platform/AdminLoginPage";
import {
  AdminCreatePage,
  AdminEditPage,
  AdminListPage,
  AdminOverviewPage,
  AdminShell,
  RequireAdmin,
} from "@/features/platform/AdminPortal";
import { CallerIdsPage, SettingsPage } from "@/features/admin/CallerIdsPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { CallDetailPage } from "@/features/calls/CallDetailPage";
import { CallsTable } from "@/features/calls/CallsTable";
import { CampaignCallsPage } from "@/features/campaigns/CampaignCallsPage";
import {
  CampaignDetailLayout,
  CampaignOverview,
} from "@/features/campaigns/CampaignDetailPage";
import { CampaignSettingsPage } from "@/features/campaigns/CampaignSettingsPage";
import { CampaignsPage } from "@/features/campaigns/CampaignsPage";
import { LivePage } from "@/features/campaigns/LivePage";
import { NewCampaignPage } from "@/features/campaigns/NewCampaignPage";
import {
  CallingWindowsPage,
  ConsentPage,
  DncPage,
} from "@/features/compliance/CompliancePages";
import {
  ContactListDetailPage,
  ContactListsPage,
} from "@/features/contacts/ContactListsPage";
import { FlowBuilderPage } from "@/features/flows/FlowBuilderPage";
import { FlowVersionsPage, FlowsPage } from "@/features/flows/FlowsPage";
import type { Campaign } from "@/types/domain";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry(failureCount, error) {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

function RequireSession({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <PulseLoader label="Checking your session" />
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Hands the loaded campaign down to the overview tab. */
function CampaignOverviewRoute() {
  const campaign = useOutletContext<Campaign>();
  return <CampaignOverview campaign={campaign} />;
}

function GlobalCalls() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Calls</h1>
        <p className="mt-1 text-sm text-ash">
          Every attempt and how it ended. Filter by outcome, or open a campaign
          to see only its calls.
        </p>
      </header>
      <CallsTable />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />

            {/* System administration. A separate area with its own sign-in:
                a platform administrator has no organisation, so none of the
                tenant-scoped screens below would have anything to show. */}
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminShell>
                    <Outlet />
                  </AdminShell>
                </RequireAdmin>
              }
            >
              <Route index element={<AdminOverviewPage />} />
              <Route path=":resource" element={<AdminListPage />} />
              <Route path=":resource/new" element={<AdminCreatePage />} />
              <Route path=":resource/:id" element={<AdminEditPage />} />
            </Route>

            <Route
              element={
                <RequireSession>
                  <AppShell />
                </RequireSession>
              }
            >
              <Route index element={<Navigate to="/campaigns" replace />} />

              {/* --- campaigns ------------------------------------- */}
              <Route path="/campaigns" element={<CampaignsPage />} />
              <Route path="/campaigns/new" element={<NewCampaignPage />} />
              <Route path="/campaigns/:id" element={<CampaignDetailLayout />}>
                <Route index element={<CampaignOverviewRoute />} />
                <Route path="live" element={<LivePage />} />
                <Route path="calls" element={<CampaignCallsPage />} />
                <Route path="settings" element={<CampaignSettingsPage />} />
              </Route>

              {/* --- contacts -------------------------------------- */}
              <Route path="/contact-lists" element={<ContactListsPage />} />
              <Route
                path="/contact-lists/:id"
                element={<ContactListDetailPage />}
              />

              {/* --- flows ----------------------------------------- */}
              <Route path="/flows" element={<FlowsPage />} />
              <Route path="/flows/:id" element={<FlowVersionsPage />} />
              <Route
                path="/flows/:id/versions/:versionId"
                element={<FlowBuilderPage />}
              />

              {/* --- calls ----------------------------------------- */}
              <Route path="/calls" element={<GlobalCalls />} />
              <Route path="/calls/:id" element={<CallDetailPage />} />

              {/* --- compliance ------------------------------------ */}
              <Route path="/compliance" element={<Outlet />}>
                <Route index element={<Navigate to="/compliance/dnc" replace />} />
                <Route path="dnc" element={<DncPage />} />
                <Route path="consent" element={<ConsentPage />} />
                <Route path="windows" element={<CallingWindowsPage />} />
              </Route>

              {/* --- admin ----------------------------------------- */}
              <Route path="/caller-ids" element={<CallerIdsPage />} />
              <Route path="/access-keys" element={<AccessKeysPage />} />
              <Route path="/settings" element={<SettingsPage />} />

              <Route
                path="*"
                element={
                  <EmptyState
                    title="No such page"
                    description="Check the address, or head back to your campaigns."
                  />
                }
              />
            </Route>
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
