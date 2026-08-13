/**
 * Data access for everything that is not a campaign.
 *
 * One module because the shapes are uniform: a paged or cursor list, a detail,
 * and a small number of POST sub-resources. Campaign lifecycle is its own file
 * because its state machine is not uniform with anything else.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import {
  query,
  request,
  type CursorResponse,
  type PagedResponse,
} from "../api";
import { ApiError } from "../errors";
import type {
  AudioAsset,
  CallDetail,
  CallEvent,
  CallSummary,
  CallerID,
  CallingWindow,
  ConsentRecord,
  Contact,
  ContactList,
  DncEntry,
  FlowSummary,
  FlowVersion,
  IngestReport,
  NodeCatalogue,
  Role,
  SuppressionPreview,
  TransferEndpoint,
  ValidationReport,
} from "@/types/domain";

export const keys = {
  contactLists: (f: object = {}) => ["contact-lists", f] as const,
  contactList: (id: string) => ["contact-lists", id] as const,
  contacts: (f: object = {}) => ["contacts", f] as const,
  flows: (f: object = {}) => ["flows", f] as const,
  flow: (id: string) => ["flows", id] as const,
  flowVersions: (flowId: string) => ["flows", flowId, "versions"] as const,
  flowVersion: (id: string) => ["flow-versions", id] as const,
  nodeTypes: () => ["flows", "node-types"] as const,
  calls: (f: object = {}) => ["calls", f] as const,
  call: (id: string) => ["calls", id] as const,
  callEvents: (id: string) => ["calls", id, "events"] as const,
  dnc: (f: object = {}) => ["dnc", f] as const,
  consent: (f: object = {}) => ["consent", f] as const,
  windows: () => ["calling-windows"] as const,
  callerIds: (f: object = {}) => ["caller-ids", f] as const,
};

// --- contact lists ----------------------------------------------------

export function useContactLists(filters: { ingest_status?: string } = {}) {
  return useQuery<PagedResponse<ContactList>, ApiError>({
    queryKey: keys.contactLists(filters),
    queryFn: () =>
      request<PagedResponse<ContactList>>(`contact-lists/${query(filters)}`),
  });
}

/**
 * A single list, polled while an ingest is running.
 *
 * `ingest/` returns a `job_id` that nothing accepts and there is no result
 * backend (G-08), so progress is inferred from `ingest_status` on the list
 * itself. Polling stops the moment it leaves `pending`/`running` — a finished
 * import must not keep spending the org's request budget.
 */
export function useContactList(id: string | undefined) {
  return useQuery<ContactList, ApiError>({
    queryKey: keys.contactList(id ?? ""),
    queryFn: () => request<ContactList>(`contact-lists/${id}/`),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const status = q.state.data?.ingest_status;
      return status === "pending" || status === "running" ? 3000 : false;
    },
  });
}

export function useCreateContactList() {
  const qc = useQueryClient();
  return useMutation<ContactList, ApiError, { name: string; description?: string; default_region?: string }>({
    mutationFn: (body) =>
      request<ContactList>("contact-lists/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact-lists"] }),
  });
}

export interface UploadTicket {
  upload: { url: string; fields: Record<string, string> };
  s3_key: string;
}

export function useUploadTicket(listId: string) {
  return useMutation<
    UploadTicket,
    ApiError,
    { filename: string; content_type?: string; default_region?: string }
  >({
    mutationFn: (body) =>
      request<UploadTicket>(`contact-lists/${listId}/upload-url/`, {
        method: "POST",
        body,
      }),
  });
}

export function useStartIngest(listId: string) {
  const qc = useQueryClient();
  return useMutation<
    { job_id: string; status: string },
    ApiError,
    { s3_key: string; default_region?: string }
  >({
    mutationFn: (body) =>
      request(`contact-lists/${listId}/ingest/`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.contactList(listId) }),
  });
}

export function useSuppressionPreview(listId: string | undefined, on: boolean) {
  return useQuery<SuppressionPreview, ApiError>({
    queryKey: ["contact-lists", listId, "suppression-preview"],
    queryFn: () =>
      request<SuppressionPreview>(`contact-lists/${listId}/suppression-preview/`),
    enabled: Boolean(listId) && on,
  });
}

export function useRejects(listId: string | undefined, on: boolean) {
  return useQuery<{ url: string | null; rejected_rows: number }, ApiError>({
    queryKey: ["contact-lists", listId, "rejects"],
    queryFn: () => request(`contact-lists/${listId}/rejects/`),
    enabled: Boolean(listId) && on,
  });
}

// --- contacts ---------------------------------------------------------

export interface ContactFilters extends Record<string, unknown> {
  contact_list?: string;
  is_suppressed?: string;
  line_type?: string;
  suppression_reason?: string;
  cursor?: string;
}

export function useContacts(filters: ContactFilters = {}) {
  return useQuery<CursorResponse<Contact>, ApiError>({
    queryKey: keys.contacts(filters),
    queryFn: () => request<CursorResponse<Contact>>(`contacts/${query(filters)}`),
  });
}

export function useEraseContact() {
  const qc = useQueryClient();
  return useMutation<{ status: string }, ApiError, string>({
    mutationFn: (id) => request(`contacts/${id}/erase/`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

// --- flows ------------------------------------------------------------

export function useFlows(filters: { is_archived?: string } = {}) {
  return useQuery<PagedResponse<FlowSummary>, ApiError>({
    queryKey: keys.flows(filters),
    queryFn: () => request<PagedResponse<FlowSummary>>(`flows/${query(filters)}`),
  });
}

export function useFlow(id: string | undefined) {
  return useQuery<FlowSummary, ApiError>({
    queryKey: keys.flow(id ?? ""),
    queryFn: () => request<FlowSummary>(`flows/${id}/`),
    enabled: Boolean(id),
  });
}

/** Unpaginated bare array, newest version first. */
export function useFlowVersions(flowId: string | undefined) {
  return useQuery<FlowVersion[], ApiError>({
    queryKey: keys.flowVersions(flowId ?? ""),
    queryFn: () => request<FlowVersion[]>(`flows/${flowId}/versions/`),
    enabled: Boolean(flowId),
  });
}

export function useFlowVersion(id: string | undefined) {
  return useQuery<FlowVersion, ApiError>({
    queryKey: keys.flowVersion(id ?? ""),
    queryFn: () => request<FlowVersion>(`flow-versions/${id}/`),
    enabled: Boolean(id),
  });
}

export function useCreateFlow() {
  const qc = useQueryClient();
  return useMutation<FlowSummary, ApiError, { name: string; description?: string }>({
    mutationFn: (body) => request<FlowSummary>("flows/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flows"] }),
  });
}

/**
 * The node catalogue that drives the builder palette.
 *
 * Generated server-side from NODE_SPECS specifically so the builder cannot
 * drift from the DSL. Never hardcode this list. Immutable in practice, so it
 * is cached for the session.
 */
export function useNodeTypes() {
  return useQuery<NodeCatalogue, ApiError>({
    queryKey: keys.nodeTypes(),
    queryFn: () => request<NodeCatalogue>("flows/node-types/"),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Dry-run validation. Always 200, even when the document is invalid — the
 * report is the payload, not the status code.
 */
export function useValidateFlow() {
  return useMutation<
    ValidationReport,
    ApiError,
    { definition: unknown; contact_list_ids?: string[] }
  >({
    mutationFn: (body) =>
      request<ValidationReport>("flows/validate/", { method: "POST", body }),
  });
}

export function useSaveDraft(versionId: string) {
  const qc = useQueryClient();
  return useMutation<FlowVersion, ApiError, { definition: unknown }>({
    mutationFn: (body) =>
      request<FlowVersion>(`flow-versions/${versionId}/`, {
        method: "PATCH",
        body,
      }),
    onSuccess: (v) => qc.setQueryData(keys.flowVersion(versionId), v),
  });
}

export function usePublishVersion(versionId: string) {
  const qc = useQueryClient();
  return useMutation<FlowVersion, ApiError, void>({
    mutationFn: () =>
      request<FlowVersion>(`flow-versions/${versionId}/publish/`, {
        method: "POST",
      }),
    onSuccess: (v) => {
      qc.setQueryData(keys.flowVersion(versionId), v);
      qc.invalidateQueries({ queryKey: ["flows"] });
    },
  });
}

export function useCloneVersion() {
  const qc = useQueryClient();
  return useMutation<FlowVersion, ApiError, string>({
    mutationFn: (versionId) =>
      request<FlowVersion>(`flow-versions/${versionId}/clone/`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flows"] }),
  });
}

export function useCreateVersion() {
  const qc = useQueryClient();
  return useMutation<FlowVersion, ApiError, { flow: string; definition: unknown }>({
    mutationFn: (body) =>
      request<FlowVersion>("flow-versions/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flows"] }),
  });
}

// --- calls ------------------------------------------------------------

export interface CallFilters extends Record<string, unknown> {
  campaign?: string;
  status?: string;
  disposition?: string;
  answered_by?: string;
  attempt_number?: string;
  cursor?: string;
}

export function useCalls(
  filters: CallFilters = {},
  options?: Partial<UseQueryOptions<CursorResponse<CallSummary>, ApiError>>,
) {
  return useQuery<CursorResponse<CallSummary>, ApiError>({
    queryKey: keys.calls(filters),
    queryFn: () =>
      request<CursorResponse<CallSummary>>(`calls/${query(filters)}`),
    ...options,
  });
}

export function useCall(id: string | undefined) {
  return useQuery<CallDetail, ApiError>({
    queryKey: keys.call(id ?? ""),
    queryFn: () => request<CallDetail>(`calls/${id}/`),
    enabled: Boolean(id),
  });
}

export function useCallEvents(id: string | undefined) {
  return useQuery<CallEvent[], ApiError>({
    queryKey: keys.callEvents(id ?? ""),
    queryFn: () => request<CallEvent[]>(`calls/${id}/events/`),
    enabled: Boolean(id),
  });
}

/**
 * Recording access. Four outcomes: a signed URL, a carrier URL needing its own
 * auth, never recorded, or 410 once retention has purged it. Every fetch is
 * audited server-side, which is why this is a mutation and not a query — it is
 * an action someone takes, not data a page loads.
 */
export function useRecording() {
  return useMutation<
    { url: string | null; duration?: number; requires_carrier_auth?: boolean },
    ApiError,
    string
  >({
    mutationFn: (callId) => request(`calls/${callId}/recording/`),
  });
}

// --- suppression ------------------------------------------------------

export function useDncEntries(filters: { reason?: string; cursor?: string } = {}) {
  return useQuery<CursorResponse<DncEntry>, ApiError>({
    queryKey: keys.dnc(filters),
    queryFn: () => request<CursorResponse<DncEntry>>(`dnc/${query(filters)}`),
  });
}

export function useAddDnc() {
  const qc = useQueryClient();
  return useMutation<
    DncEntry,
    ApiError,
    { phone_e164: string; reason: string; notes?: string }
  >({
    mutationFn: (body) => request<DncEntry>("dnc/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dnc"] }),
  });
}

/** `entries_added` arrived with the scrub work; older backends omit it. */
export interface BulkDncResult {
  submitted: number;
  entries_added?: number;
  contacts_flagged: number;
  rejected: { input: string; reason: string }[];
}

export function useBulkDnc() {
  const qc = useQueryClient();
  return useMutation<
    BulkDncResult,
    ApiError,
    { numbers: string[]; reason?: string; notes?: string }
  >({
    mutationFn: (body) =>
      request<BulkDncResult>("dnc/bulk/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dnc"] }),
  });
}

export function useDncCheck() {
  return useMutation<
    { phone_e164: string; suppressed: boolean; reason: string },
    ApiError,
    string
  >({
    mutationFn: (phone) => request(`dnc/check/${query({ phone })}`),
  });
}

export function useDeleteDnc() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => request<void>(`dnc/${id}/`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dnc"] }),
  });
}

// --- consent ----------------------------------------------------------

export function useConsentRecords(
  filters: { consent_type?: string; scope?: string; cursor?: string } = {},
) {
  return useQuery<CursorResponse<ConsentRecord>, ApiError>({
    queryKey: keys.consent(filters),
    queryFn: () =>
      request<CursorResponse<ConsentRecord>>(`consent/${query(filters)}`),
  });
}

/** Bare array, newest capture first. Matched on hash, so it survives erasure. */
export function useConsentLookup() {
  return useMutation<ConsentRecord[], ApiError, string>({
    mutationFn: (phone) =>
      request<ConsentRecord[]>(`consent/lookup/${query({ phone })}`),
  });
}

export function useRecordConsent() {
  const qc = useQueryClient();
  return useMutation<ConsentRecord, ApiError, Partial<ConsentRecord>>({
    mutationFn: (body) =>
      request<ConsentRecord>("consent/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consent"] }),
  });
}

/** Also writes a DNC entry server-side — the confirm dialog says so. */
export function useRevokeConsent() {
  const qc = useQueryClient();
  return useMutation<ConsentRecord, ApiError, { id: string; channel?: string }>({
    mutationFn: ({ id, channel = "api" }) =>
      request<ConsentRecord>(`consent/${id}/revoke/`, {
        method: "POST",
        body: { channel },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consent"] });
      qc.invalidateQueries({ queryKey: ["dnc"] });
    },
  });
}

// --- calling windows --------------------------------------------------

export function useCallingWindows() {
  return useQuery<PagedResponse<CallingWindow>, ApiError>({
    queryKey: keys.windows(),
    queryFn: () => request<PagedResponse<CallingWindow>>("calling-windows/"),
  });
}

export function useSaveWindow() {
  const qc = useQueryClient();
  return useMutation<CallingWindow, ApiError, Partial<CallingWindow> & { id?: string }>({
    mutationFn: ({ id, ...body }) =>
      id
        ? request<CallingWindow>(`calling-windows/${id}/`, { method: "PATCH", body })
        : request<CallingWindow>("calling-windows/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.windows() }),
  });
}

// --- caller IDs -------------------------------------------------------

export function useCallerIds(
  filters: { provider?: string; is_active?: string; attestation?: string } = {},
) {
  return useQuery<PagedResponse<CallerID>, ApiError>({
    queryKey: keys.callerIds(filters),
    queryFn: () => request<PagedResponse<CallerID>>(`caller-ids/${query(filters)}`),
  });
}

export function useUpdateCallerId() {
  const qc = useQueryClient();
  return useMutation<CallerID, ApiError, { id: string } & Partial<CallerID>>({
    mutationFn: ({ id, ...body }) =>
      request<CallerID>(`caller-ids/${id}/`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["caller-ids"] }),
  });
}

// --- unrouted upstream ------------------------------------------------

/**
 * Transfer endpoints and audio assets have serializers but no viewset
 * (G-03), so these 404 today. They are written against the shape the
 * serializers already define, so wiring the routes is all that is needed.
 * The builder degrades to a plain id field until then.
 */
export function useTransferEndpoints() {
  return useQuery<PagedResponse<TransferEndpoint>, ApiError>({
    queryKey: ["transfer-endpoints"],
    queryFn: () => request<PagedResponse<TransferEndpoint>>("transfer-endpoints/"),
    retry: false,
  });
}

export function useAudioAssets() {
  return useQuery<PagedResponse<AudioAsset>, ApiError>({
    queryKey: ["audio-assets"],
    queryFn: () => request<PagedResponse<AudioAsset>>("audio-assets/"),
    retry: false,
  });
}

export type { IngestReport };

// --- access keys ------------------------------------------------------

/**
 * Issuing console access.
 *
 * `secret` appears on exactly one response — the create — because only its
 * hash is stored. Nothing refetches it, so the mutation result is the single
 * place it exists client-side and the UI must show it before navigating away.
 */
export interface AccessKey {
  id: string;
  name: string;
  prefix: string;
  role: Role;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  is_active: boolean;
  allowed_cidrs: string[];
  created_by_name: string;
}

export interface CreatedAccessKey extends AccessKey {
  secret: string;
}

export function useAccessKeys() {
  return useQuery<PagedResponse<AccessKey>, ApiError>({
    queryKey: ["api-keys"],
    queryFn: () => request<PagedResponse<AccessKey>>("api-keys/"),
  });
}

export function useCreateAccessKey() {
  const qc = useQueryClient();
  return useMutation<
    CreatedAccessKey,
    ApiError,
    { name: string; role: Role; expires_at?: string | null }
  >({
    mutationFn: (body) =>
      request<CreatedAccessKey>("api-keys/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRevokeAccessKey() {
  const qc = useQueryClient();
  return useMutation<AccessKey, ApiError, string>({
    mutationFn: (id) => request<AccessKey>(`api-keys/${id}/revoke/`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

// --- people -----------------------------------------------------------

/**
 * Employees of this organisation.
 *
 * `access_code` appears on exactly two responses — creating a person, and
 * issuing them a replacement — because only its hash is stored. There is no
 * endpoint that can return it again, by design.
 */
export interface Employee {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  organization: string;
  is_active: boolean;
  last_seen_at: string | null;
  full_name: string;
  has_code: boolean;
}

export interface IssuedEmployee extends Employee {
  access_code: string;
}

export function useEmployees() {
  return useQuery<PagedResponse<Employee>, ApiError>({
    queryKey: ["employees"],
    queryFn: () => request<PagedResponse<Employee>>("employees/"),
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation<
    IssuedEmployee,
    ApiError,
    { username: string; first_name: string; last_name: string; role: Role }
  >({
    mutationFn: (body) =>
      request<IssuedEmployee>("employees/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useResetEmployeeCode() {
  const qc = useQueryClient();
  return useMutation<IssuedEmployee, ApiError, string>({
    mutationFn: (id) =>
      request<IssuedEmployee>(`employees/${id}/reset-code/`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation<Employee, ApiError, { id: string } & Partial<Employee>>({
    mutationFn: ({ id, ...body }) =>
      request<Employee>(`employees/${id}/`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

// --- audio & quick dial -----------------------------------------------

export interface AudioClip {
  id: string;
  name: string;
  mime_type: string;
  duration_ms: number;
  source: string;
  created_at: string;
  play_url: string;
}

export function useAudioClips() {
  return useQuery<PagedResponse<AudioClip>, ApiError>({
    queryKey: ["audio"],
    queryFn: () => request<PagedResponse<AudioClip>>("audio/"),
  });
}

/**
 * Uploads a sound. Multipart, so it does not go through the JSON `request`
 * helper — the BFF forwards the body untouched either way.
 */
export function useUploadAudio() {
  const qc = useQueryClient();
  return useMutation<AudioClip, ApiError, { name: string; file: File }>({
    mutationFn: async ({ name, file }) => {
      const form = new FormData();
      form.append("name", name);
      form.append("file", file);
      const response = await fetch("/bff/api/audio/", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new ApiError(response.status, payload?.error ?? null, "Upload failed.");
      }
      return (await response.json()) as AudioClip;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audio"] }),
  });
}

export type DialMode = "fixed" | "pulse" | "ramp";

export interface QuickDialBody {
  name?: string;
  target_number: string;
  // One of a single caller ID or a CLI pool.
  caller_id?: string;
  cli_pool?: string;
  // One of a single sound, an audio pool, or spoken text.
  audio?: string | null;
  audio_pool?: string;
  say_text?: string;
  dial_mode: DialMode;
  max_concurrent_channels: number;
  dial_batch_size: number;
  dial_interval_seconds: number;
  cps_limit: number;
  // Keys the caller can press, and what each does.
  dtmf_steps?: { order: number; digit: string; action: string }[];
  // When the job may run.
  schedule_start?: string;
  window_start?: string;
  window_end?: string;
  start_now: boolean;
}

export interface QuickDialResult {
  campaign: string;
  name: string;
  target: string;
  status: string;
  started?: boolean;
  blocked?: unknown;
}

export function useQuickDial() {
  const qc = useQueryClient();
  return useMutation<QuickDialResult, ApiError, QuickDialBody>({
    mutationFn: (body) => request<QuickDialResult>("quick-dial/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

// --- audio pools & cli pools ------------------------------------------

export interface Pool {
  id: string;
  name: string;
  description: string;
  rotation: string;
  members: string[];
  member_count: number;
  user: string;
  created_at: string;
}

function poolHooks(path: string, key: string) {
  return {
    useList: () =>
      useQuery<PagedResponse<Pool>, ApiError>({
        queryKey: [key],
        queryFn: () => request<PagedResponse<Pool>>(`${path}/`),
      }),
    useCreate: () => {
      const qc = useQueryClient();
      return useMutation<Pool, ApiError, Partial<Pool>>({
        mutationFn: (body) => request<Pool>(`${path}/`, { method: "POST", body }),
        onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
      });
    },
    useUpdate: () => {
      const qc = useQueryClient();
      return useMutation<Pool, ApiError, { id: string } & Partial<Pool>>({
        mutationFn: ({ id, ...body }) =>
          request<Pool>(`${path}/${id}/`, { method: "PATCH", body }),
        onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
      });
    },
    useDelete: () => {
      const qc = useQueryClient();
      return useMutation<void, ApiError, string>({
        mutationFn: (id) => request<void>(`${path}/${id}/`, { method: "DELETE" }),
        onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
      });
    },
  };
}

export const audioPools = poolHooks("audio-pools", "audio-pools");
export const cliPools = poolHooks("cli-pools", "cli-pools");

// --- wallet & tariffs -------------------------------------------------

export interface WalletEntry {
  id: string;
  kind: string;
  amount: string;
  description: string;
  created_at: string;
}
export interface WalletData {
  id: string;
  balance: string;
  currency: string;
  low_balance_threshold: string;
  recent: WalletEntry[];
}

export function useWallet() {
  return useQuery<PagedResponse<WalletData>, ApiError>({
    queryKey: ["wallet"],
    queryFn: () => request<PagedResponse<WalletData>>("wallet/"),
  });
}

export interface Tariff {
  id: string;
  name: string;
  prefix: string;
  per_minute: string;
  connect_fee: string;
  increment_seconds: number;
  currency: string;
  is_active: boolean;
  created_at: string;
}

export function useTariffs() {
  return useQuery<PagedResponse<Tariff>, ApiError>({
    queryKey: ["tariffs"],
    queryFn: () => request<PagedResponse<Tariff>>("tariffs/"),
  });
}
export function useCreateTariff() {
  const qc = useQueryClient();
  return useMutation<Tariff, ApiError, Partial<Tariff>>({
    mutationFn: (body) => request<Tariff>("tariffs/", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tariffs"] }),
  });
}
export function useDeleteTariff() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => request<void>(`tariffs/${id}/`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tariffs"] }),
  });
}
