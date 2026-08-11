/**
 * Domain types.
 *
 * Hand-written for the shapes drf-spectacular cannot express — the KPI frame,
 * the preflight result, the flow DSL — and for the serializers the portal
 * leans on hardest. Once `npm run generate:types` is wired against
 * /api/schema/, the CRUD shapes here should be replaced by generated ones and
 * only the hand-written section kept.
 */

// --- enums (mirror apps/common/enums.py) -------------------------------

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "throttled"
  | "completed"
  | "stopped"
  | "failed";

export type CallStatus =
  | "queued"
  | "initiated"
  | "ringing"
  | "in_progress"
  | "completed"
  | "busy"
  | "no_answer"
  | "failed"
  | "canceled";

export type AnsweredBy =
  | "human"
  | "machine_start"
  | "machine_end_beep"
  | "machine_end_silence"
  | "machine_end_other"
  | "fax"
  | "unknown";

export type Disposition =
  | "confirmed"
  | "transferred"
  | "opted_out"
  | "voicemail"
  | "abandoned"
  | "no_input"
  | "unreachable"
  | "suppressed";

export type SuppressionReason =
  | "internal_dnc"
  | "ivr_opt_out"
  | "federal_dnc"
  | "state_dnc"
  | "litigator"
  | "carrier_invalid"
  | "wireless_block"
  | "complaint"
  | "erasure_request"
  | "no_consent"
  | "out_of_window"
  | "attempt_cap";

export type Role = "owner" | "admin" | "operator" | "analyst" | "compliance";

export type Capability =
  | "campaign.view"
  | "campaign.edit"
  | "campaign.control"
  | "contacts.view"
  | "contacts.edit"
  | "contacts.export"
  | "flow.view"
  | "flow.edit"
  | "flow.publish"
  | "compliance.view"
  | "compliance.edit"
  | "recordings.listen"
  | "org.manage";

/** Campaign states in which the pacer will actually place calls. */
export const DIALING_STATES: readonly CampaignStatus[] = ["running"];

/** States from which `stop` is a no-op. */
export const TERMINAL_STATES: readonly CampaignStatus[] = [
  "completed",
  "stopped",
  "failed",
];

// --- identity ---------------------------------------------------------

export interface Me {
  user: {
    id: string;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    mfa_enabled: boolean;
  } | null;
  api_key: {
    id: string;
    name: string;
    prefix: string;
    expires_at: string | null;
  } | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    is_suspended: boolean;
    suspension_reason: string;
    require_consent_for_marketing: boolean;
    permitted_countries: string[];
  } | null;
  role: Role | "";
  capabilities: Capability[];
  ceilings: {
    max_cps: number;
    max_concurrent_channels: number;
    max_contacts: number;
  } | null;
  /** Set only when talking to a backend that predates /api/v1/me/. */
  degraded?: string;
}

// --- campaigns --------------------------------------------------------

export interface CampaignStats {
  total_contacts: number;
  dialed: number;
  answered: number;
  human: number;
  machine: number;
  no_answer: number;
  busy: number;
  failed: number;
  transferred: number;
  opted_out: number;
  suppressed: number;
  confirmed: number;
  voicemail: number;
  dtmf_breakdown: Record<string, number>;
  total_duration_seconds: number;
  total_cost: string;
  last_flushed_at: string | null;
  answer_rate: number;
  human_answer_rate: number;
}

export interface CallerID {
  id: string;
  phone_e164: string;
  friendly_name: string;
  provider: string;
  provider_sid: string;
  /** Assigned by the carrier, never by us. A/B/C. */
  attestation: "A" | "B" | "C";
  cnam_display: string;
  branded_calling_enrolled: boolean;
  reputation_score: number | null;
  reputation_checked_at: string | null;
  is_active: boolean;
  daily_call_cap: number;
  calls_today: number;
  rested_until: string | null;
  /**
   * Advisory only. Nothing in the dial path consults this, and nothing
   * auto-sets `rested_until` — see "Correct behaviour that reads as a bug"
   * in docs/API-GAPS.md. Do not imply the platform will stop dialling.
   */
  is_available: boolean;
  created_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  flow_version: string;
  flow_name: string;
  flow_version_number: number;
  caller_id: string;
  caller_id_detail: CallerID | null;
  /** Bare UUIDs — no nested detail. See docs/API-GAPS.md G-13. */
  contact_lists: string[];
  provider: string;
  requires_consent: boolean;
  consent_scope: "marketing" | "informational";
  cps_limit: number;
  max_concurrent_channels: number;
  ring_timeout_seconds: number;
  scheduled_start: string | null;
  scheduled_end: string | null;
  window_start_local: string;
  window_end_local: string;
  active_weekdays: number[];
  respect_contact_timezone: boolean;
  fallback_timezone: string;
  max_attempts: number;
  retry_delay_minutes: number;
  retry_on_statuses: string[];
  retry_backoff_factor: number;
  max_attempts_per_day: number;
  amd_enabled: boolean;
  amd_mode: string;
  amd_async: boolean;
  amd_timeout_seconds: number;
  voicemail_node: string;
  hangup_on_machine: boolean;
  record_calls: boolean;
  recording_disclosure_node: string;
  started_at: string | null;
  completed_at: string | null;
  /** Carries the carrier's error string while `throttled`. */
  pause_reason: string;
  /** Null means the campaign has never started; `stats` is meaningless. */
  queue_built_at: string | null;
  stats: CampaignStats | null;
  created_at: string;
  updated_at: string;
}

// --- preflight --------------------------------------------------------

export interface PreflightIssue {
  code: string;
  message: string;
}

export interface Preflight {
  ok: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  estimate: {
    total: number;
    reachable: number;
    suppressed: number;
  };
  /** Present when returned inside a 422 rather than from the GET. */
  message?: string;
}

// --- telemetry --------------------------------------------------------

/**
 * The KPI frame. Produced by exactly one backend function (`build_frame`), so
 * the websocket, `GET campaigns/{id}/stats/` and exports cannot disagree.
 *
 * Counters are absolute, never deltas — always replace state wholesale.
 *
 * Rates use *different denominators*: `answer` and `human` are over `dialed`;
 * `machine`, `transfer` and `opt_out` are over `answered`. Every tile must
 * say which.
 */
export interface KpiFrame {
  campaign_id: string;
  dialed: number;
  answered: number;
  human: number;
  machine: number;
  busy: number;
  no_answer: number;
  failed: number;
  completed: number;
  suppressed: number;
  transferred: number;
  opted_out: number;
  confirmed: number;
  voicemail: number;
  duration_seconds: number;
  live_channels: number;
  dtmf: Record<string, number>;
  dispositions: Record<string, number>;
  rates: {
    answer: number;
    human: number;
    machine: number;
    transfer: number;
    opt_out: number;
  };
}

export type ServerMessage =
  | { type: "kpi.snapshot"; payload: KpiFrame }
  | { type: "kpi.tick"; payload: KpiFrame; ts: string }
  | { type: "pong" }
  | { type: "error"; payload: { code: string; action?: string } };

export interface AmdQuality {
  answered: number;
  machine: number;
  human: number;
  unknown: number;
  machine_with_dtmf: number;
  human_no_input: number;
  /** The expensive error: a human hung up on or dropped into voicemail. */
  false_machine_rate: number;
  suspected_false_human_rate: number;
  machine_rate: number;
}

// --- contacts ---------------------------------------------------------

export type IngestStatus = "pending" | "running" | "completed" | "failed";

export interface IngestReport {
  total?: number;
  valid?: number;
  rejected?: number;
  duplicates?: number;
  suppressed?: number;
  errors?: unknown[];
  [key: string]: unknown;
}

export interface ContactList {
  id: string;
  name: string;
  description: string;
  default_region: string;
  source_filename: string;
  total_rows: number;
  valid_rows: number;
  rejected_rows: number;
  duplicate_rows: number;
  suppressed_rows: number;
  reachable_rows: number;
  ingest_status: IngestStatus;
  ingest_started_at: string | null;
  ingest_finished_at: string | null;
  ingest_report: IngestReport;
  created_at: string;
}

export interface Contact {
  id: string;
  contact_list: string;
  phone_e164: string;
  phone_masked: string;
  country_code: string;
  line_type: string;
  carrier_name: string;
  first_name: string;
  last_name: string;
  variables: Record<string, string>;
  timezone: string;
  is_suppressed: boolean;
  suppression_reason: SuppressionReason | "";
  suppressed_at: string | null;
  last_called_at: string | null;
  total_attempts: number;
  created_at: string;
}

export interface SuppressionPreview {
  total: number;
  already_suppressed: number;
  newly_suppressed: number;
  reachable: number;
  sampled: number;
}

// --- flows ------------------------------------------------------------

export interface FlowSummary {
  id: string;
  name: string;
  description: string;
  is_archived: boolean;
  latest_version: { id: string; version: number; is_published: boolean } | null;
  published_version: { id: string; version: number } | null;
  created_at: string;
  updated_at: string;
}

export interface FlowVersion {
  id: string;
  flow: string;
  version: number;
  definition: FlowDefinition;
  entry_node: string;
  checksum: string;
  is_published: boolean;
  published_at: string | null;
  rendered_prompts: Record<string, Record<string, string>>;
  prompts_rendered_at: string | null;
  validation_report: ValidationReport | null;
  created_at: string;
}

/** The DSL document. `metadata` is free-form and never validated — the only
 *  legal place to keep builder canvas positions, since any unknown key on a
 *  node is a hard `unknown_field` error. */
export interface FlowDefinition {
  schema_version: "1.0";
  entry: string;
  default_locale?: string;
  locales?: string[];
  metadata?: Record<string, unknown> & {
    positions?: Record<string, { x: number; y: number }>;
  };
  nodes: Record<string, FlowNode>;
}

export type NodeType =
  | "play"
  | "menu"
  | "collect"
  | "transfer"
  | "opt_out"
  | "voicemail"
  | "record"
  | "branch"
  | "hangup";

export type PromptKind = "audio" | "tts" | "say";

export interface Prompt {
  kind: PromptKind;
  /** audio only — an AudioAsset id. A `url` key is a hard error (SSRF guard). */
  asset?: string;
  text?: string;
  voice?: string;
}

export interface BranchCondition {
  variable: string;
  op: string;
  value?: unknown;
  then: string;
}

export interface FlowNode {
  type: NodeType;
  label?: string;
  disposition?: string;
  tags?: string[];
  barge_in?: boolean;
  prompt?: Prompt;
  invalid_prompt?: Prompt;
  timeout_prompt?: Prompt;
  whisper?: Prompt;
  ring_prompt?: Prompt;
  next?: string;
  on_timeout?: string;
  on_invalid?: string;
  on_fail?: string;
  options?: Record<string, string>;
  conditions?: BranchCondition[];
  default?: string;
  variable?: string;
  endpoint?: string;
  scope?: string;
  [key: string]: unknown;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  /** "" for document-level issues. */
  node: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface NodeSpec {
  type: NodeType;
  required: string[];
  optional: string[];
  transitions: string[];
  terminal: boolean;
  gathers_input: boolean;
  description: string;
}

export interface NodeCatalogue {
  prompt_kinds: PromptKind[];
  branch_operators: string[];
  nodes: NodeSpec[];
}

export interface TransferEndpoint {
  id: string;
  name: string;
  kind: "pstn" | "sip";
  destination: string;
  caller_id_override: string;
  timeout_seconds: number;
  max_concurrent: number;
  is_active: boolean;
  created_at: string;
}

export interface AudioAsset {
  id: string;
  name: string;
  storage_key: string;
  mime_type: string;
  duration_ms: number;
  sample_rate: number;
  source: string;
  source_text: string;
  voice_id: string;
  url: string;
  created_at: string;
}

// --- calls ------------------------------------------------------------

export interface CallSummary {
  id: string;
  campaign: string;
  provider_call_sid: string;
  to_masked: string;
  status: CallStatus;
  answered_by: AnsweredBy | "";
  disposition: Disposition | "";
  attempt_number: number;
  duration_seconds: number;
  ring_seconds: number;
  cost: string | null;
  terminal_node: string;
  created_at: string;
  ended_at: string | null;
}

export interface DtmfPress {
  node_id: string;
  digits: string;
  attempt: number;
  latency_ms: number | null;
  is_valid: boolean;
  created_at: string;
}

export interface CallDetail extends CallSummary {
  contact: string | null;
  flow_version: string;
  provider: string;
  from_number: string;
  to_number: string;
  sip_response_code: number | null;
  error_code: string;
  error_message: string;
  initiated_at: string | null;
  ringing_at: string | null;
  answered_at: string | null;
  amd_latency_ms: number | null;
  node_path: string[];
  transferred_to: string;
  transfer_duration_seconds: number;
  recording_duration: number;
  cost_currency: string;
  /** Twilio back-fills Price minutes later. Never present cost as final
   *  while this is false — the figure is always low. */
  cost_reconciled: boolean;
  stir_attestation: string;
  dtmf: DtmfPress[];
}

export interface CallEvent {
  event_type: string;
  sequence_number: number | null;
  payload: Record<string, unknown>;
  signature_valid: boolean;
  received_at: string;
}

// --- compliance -------------------------------------------------------

export interface DncEntry {
  id: string;
  phone_e164: string;
  phone_masked: string;
  reason: SuppressionReason;
  scope_campaign: string | null;
  notes: string;
  expires_at: string | null;
  is_global: boolean;
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  phone_e164: string;
  consent_type: "express_written" | "express_oral" | "ebr" | "transactional";
  scope: "marketing" | "informational";
  source: string;
  source_url: string;
  /** Required and non-empty. The exact language shown — in a TCPA dispute
   *  this field is the evidence. */
  disclosure_text: string;
  captured_at: string;
  captured_ip: string | null;
  captured_user_agent: string;
  evidence_ref: string;
  revoked_at: string | null;
  revocation_channel: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CallingWindow {
  id: string;
  jurisdiction: string;
  start_local: string;
  end_local: string;
  weekdays: number[];
  holidays_blocked: boolean;
  notes: string;
  created_at: string;
}
