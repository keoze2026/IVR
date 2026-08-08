/**
 * Who is signed in, and what they may do.
 *
 * `useCan` and `<Can>` gate affordances only. The server re-checks everything;
 * if these two ever disagree the server wins and the user sees a 403.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { login as postLogin, logout as postLogout } from "./api";
import { capabilitiesFor } from "./capabilities";
import { ApiError } from "./errors";
import type { Capability, Me } from "@/types/domain";

interface SessionValue {
  me: Me | null;
  capabilities: Set<Capability>;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (apiKey: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export const SESSION_KEY = ["session"] as const;

export async function fetchMe(): Promise<Me | null> {
  const response = await fetch("/bff/me", { credentials: "same-origin" });
  if (response.status === 401) return null;
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const envelope =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: never }).error
        : null;
    throw new ApiError(response.status, envelope, "Could not load your profile.");
  }
  return (await response.json()) as Me;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const value = useMemo<SessionValue>(() => {
    const me = data ?? null;
    return {
      me,
      capabilities: capabilitiesFor(me?.role ?? "", me?.capabilities),
      isLoading,
      isAuthenticated: me !== null,

      /**
       * Sign in, then re-resolve who we are *before* returning.
       *
       * The order matters. Clearing the cache drops the session query with it,
       * and nothing re-runs it on its own — so navigating straight after a
       * clear lands on a guarded route with no session and bounces back to
       * the login screen, having just logged in successfully. `fetchQuery`
       * repopulates the cache and the mounted observer picks it up.
       */
      signIn: async (apiKey: string) => {
        await postLogin(apiKey);
        queryClient.clear();
        await queryClient.fetchQuery({
          queryKey: SESSION_KEY,
          queryFn: fetchMe,
        });
      },

      signOut: async () => {
        await postLogout();
        queryClient.clear();
        window.location.assign("/login");
      },
    };
  }, [data, isLoading, queryClient]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

export function useCan(capability: Capability): boolean {
  const { capabilities, me } = useSession();
  // Against a backend with no /me, capabilities are unknown; show everything
  // and let the server refuse. Hiding the whole UI would be worse.
  if (me?.degraded) return true;
  return capabilities.has(capability);
}

export function Can({
  cap,
  children,
  fallback = null,
}: {
  cap: Capability;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(cap) ? <>{children}</> : <>{fallback}</>;
}
