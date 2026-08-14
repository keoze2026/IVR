/**
 * Campaign data access.
 *
 * Query keys are structural so mutations can invalidate narrowly — throttles
 * are per-organisation (600/min, 60/sec), so a broad invalidation on a busy
 * dashboard is a real cost, not just noise.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { query, request, type PagedResponse } from "../api";
import type { ApiError } from "../errors";
import type { Campaign, CampaignStatus, KpiFrame, Preflight } from "@/types/domain";

export const campaignKeys = {
  all: ["campaigns"] as const,
  list: (filters: CampaignFilters) => ["campaigns", "list", filters] as const,
  detail: (id: string) => ["campaigns", id] as const,
  preflight: (id: string) => ["campaigns", id, "preflight"] as const,
  stats: (id: string) => ["campaigns", id, "stats"] as const,
  amdQuality: (id: string) => ["campaigns", id, "amd-quality"] as const,
};

export interface CampaignFilters {
  status?: CampaignStatus | "";
  caller_id?: string;
  flow_version?: string;
  page?: number;
  page_size?: number;
}

export function useCampaigns(
  filters: CampaignFilters = {},
  options?: Partial<UseQueryOptions<PagedResponse<Campaign>, ApiError>>,
) {
  return useQuery<PagedResponse<Campaign>, ApiError>({
    queryKey: campaignKeys.list(filters),
    queryFn: () =>
      request<PagedResponse<Campaign>>(`campaigns/${query({ ...filters })}`),
    ...options,
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery<Campaign, ApiError>({
    queryKey: campaignKeys.detail(id ?? ""),
    queryFn: () => request<Campaign>(`campaigns/${id}/`),
    enabled: Boolean(id),
  });
}

/** GET, mutates nothing — safe to refetch on focus. */
export function usePreflight(id: string | undefined, enabled = true) {
  return useQuery<Preflight, ApiError>({
    queryKey: campaignKeys.preflight(id ?? ""),
    queryFn: () => request<Preflight>(`campaigns/${id}/preflight/`),
    enabled: Boolean(id) && enabled,
    staleTime: 30_000,
  });
}

/**
 * Initial paint for the live dashboard.
 *
 * Identical payload to the websocket's `kpi.snapshot` — both come from
 * `build_frame` — so there is no flash of different numbers when the socket
 * connects. Also the fallback for clients that cannot hold a socket open.
 */
export function useCampaignStats(id: string | undefined, enabled = true) {
  return useQuery<KpiFrame, ApiError>({
    queryKey: campaignKeys.stats(id ?? ""),
    queryFn: () => request<KpiFrame>(`campaigns/${id}/stats/`),
    enabled: Boolean(id) && enabled,
  });
}

// --- writes -----------------------------------------------------------

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation<Campaign, ApiError, Partial<Campaign>>({
    mutationFn: (body) =>
      request<Campaign>("campaigns/", { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

/**
 * Delete a job. The backend refuses a running/throttled one, so the caller
 * should stop it first; the thrown ApiError carries that message.
 */
export function useDeleteJob() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => request<void>(`campaigns/${id}/`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

/**
 * Patch a campaign.
 *
 * Five fields are refused while running or throttled — the serializer 400s on
 * `flow_version`, `contact_lists`, `caller_id`, `requires_consent` and
 * `consent_scope`. Pacing is editable live, which is the point: you can slow a
 * campaign down without stopping it.
 */
export function useUpdateCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Campaign, ApiError, Partial<Campaign>>({
    mutationFn: (body) =>
      request<Campaign>(`campaigns/${id}/`, { method: "PATCH", body }),
    onSuccess: (campaign) => {
      queryClient.setQueryData(campaignKeys.detail(id), campaign);
      queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    },
  });
}

export function useRebuildStats(id: string) {
  const queryClient = useQueryClient();
  return useMutation<{ status: string }, ApiError, void>({
    mutationFn: () =>
      request(`campaigns/${id}/rebuild-stats/`, { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: campaignKeys.stats(id) }),
  });
}

// --- lifecycle --------------------------------------------------------

/**
 * Start a campaign.
 *
 * `force` must be false on the first attempt. A campaign with warnings answers
 * 422 `compliance_blocked`, carrying the full preflight result in
 * `error.detail`; the UI shows those warnings, takes an explicit
 * acknowledgement, and only then retries with force. Sending force eagerly
 * defeats the control that exists so nobody can say "nobody told me the
 * caller ID had a C attestation".
 */
export function useStartCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Campaign, ApiError, { force?: boolean }>({
    mutationFn: ({ force = false }) =>
      request<Campaign>(`campaigns/${id}/start/`, {
        method: "POST",
        body: { force },
      }),
    onSuccess: (campaign) => {
      queryClient.setQueryData(campaignKeys.detail(id), campaign);
      queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    },
  });
}

export function usePauseCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Campaign, ApiError, { reason?: string }>({
    mutationFn: ({ reason = "" }) =>
      request<Campaign>(`campaigns/${id}/pause/`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: (campaign) => {
      queryClient.setQueryData(campaignKeys.detail(id), campaign);
      queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    },
  });
}

/** Internally `start(force=true)` — preflight *errors* still block it. */
export function useResumeCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Campaign, ApiError, void>({
    mutationFn: () => request<Campaign>(`campaigns/${id}/resume/`, { method: "POST" }),
    onSuccess: (campaign) => {
      queryClient.setQueryData(campaignKeys.detail(id), campaign);
      queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    },
  });
}

/**
 * Irreversible. Sets every pending/dialing queue row to `exhausted`; the
 * campaign can never be restarted. `hangup_live` additionally kills calls
 * mid-sentence and exists for the compliance case — always a separate,
 * deliberate choice.
 */
export function useStopCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Campaign, ApiError, { hangup_live?: boolean }>({
    mutationFn: ({ hangup_live = false }) =>
      request<Campaign>(`campaigns/${id}/stop/`, {
        method: "POST",
        body: { hangup_live },
      }),
    onSuccess: (campaign) => {
      queryClient.setQueryData(campaignKeys.detail(id), campaign);
      queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    },
  });
}

// --- state machine ----------------------------------------------------

/**
 * Which transitions the backend will accept from here.
 *
 * Mirrors `apps/campaigns/services.py`. Anything else answers 409
 * `invalid_state_transition`, which the UI handles by refetching — someone
 * else moved the campaign.
 */
export function allowedTransitions(status: CampaignStatus) {
  return {
    start: ["draft", "scheduled", "paused", "throttled"].includes(status),
    pause: ["running", "throttled"].includes(status),
    resume: ["paused", "throttled"].includes(status),
    stop: !["completed", "stopped"].includes(status),
    edit: !["running", "throttled"].includes(status),
    delete: !["running", "throttled"].includes(status),
  };
}

/** Fields the serializer refuses to change while the campaign is live. */
export const FROZEN_WHILE_RUNNING = [
  "flow_version",
  "contact_lists",
  "caller_id",
  "requires_consent",
  "consent_scope",
] as const;

/**
 * Job control from a list row, where the hooks keyed by id cannot be called.
 * One mutation that takes the id and the action.
 */
export function useJobAction() {
  const qc = useQueryClient();
  return useMutation<
    Campaign,
    ApiError,
    { id: string; action: "start" | "pause" | "stop" }
  >({
    mutationFn: ({ id, action }) =>
      request<Campaign>(`campaigns/${id}/${action}/`, {
        method: "POST",
        body: action === "start" ? { force: true } : {},
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}
