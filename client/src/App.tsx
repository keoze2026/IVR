/**
 * Routing and global providers.
 *
 * Retry policy is deliberate: 401/403/404 and 4xx generally are not
 * transient, and the API is throttled per-organisation (600/min, 60/sec), so
 * retrying a rejected request wastes budget every other tab is sharing.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/errors";
import { SessionProvider, useSession } from "@/lib/session";
import { LoginPage } from "@/features/auth/LoginPage";
import { CampaignsPage } from "@/features/campaigns/CampaignsPage";

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
        <Spinner />
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Screens planned but not yet built — honest about it rather than a 404. */
function Planned({ name, phase }: { name: string; phase: string }) {
  return (
    <EmptyState
      title={`${name} is not built yet`}
      description={`Scheduled for ${phase}. See the plan for what this screen does.`}
    />
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              element={
                <RequireSession>
                  <AppShell />
                </RequireSession>
              }
            >
              <Route index element={<Navigate to="/campaigns" replace />} />
              <Route path="/campaigns" element={<CampaignsPage />} />
              <Route
                path="/campaigns/new"
                element={<Planned name="The campaign wizard" phase="phase 2" />}
              />
              <Route
                path="/campaigns/:id"
                element={<Planned name="Campaign detail" phase="phase 2" />}
              />
              <Route
                path="/campaigns/:id/live"
                element={<Planned name="The live dashboard" phase="phase 2" />}
              />
              <Route
                path="/contact-lists"
                element={<Planned name="Contact lists" phase="phase 2" />}
              />
              <Route path="/flows" element={<Planned name="Flows" phase="phase 3" />} />
              <Route
                path="/calls"
                element={<Planned name="The call log" phase="phase 4" />}
              />
              <Route
                path="/compliance/dnc"
                element={<Planned name="Compliance" phase="phase 4" />}
              />
              <Route
                path="/caller-ids"
                element={<Planned name="Caller IDs" phase="phase 4" />}
              />
              <Route
                path="*"
                element={<EmptyState title="No such page" />}
              />
            </Route>
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
