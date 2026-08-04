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
  /** Set when the backend predates /api/v1/me/ — see docs/API-GAPS.md G-04. */
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
