/**
 * A fake Django, for looking at the UI without a database.
 *
 * DEV ONLY. This is not an auth bypass — the real login flow still runs, the
 * BFF still holds the credential, and the SPA has no idea it is talking to
 * fixtures. It accepts one key and answers with canned data, so the portal can
 * be reviewed before Postgres exists.
 *
 *   node client/mock/upstream.mjs                    # listens on :8000
 *   IVR_API_BASE=http://localhost:8000 npm run dev:bff
 *
 * Fixtures deliberately cover the states that are easy to get wrong: a
 * throttled campaign carrying a carrier error, a draft that has never started
 * (`queue_built_at: null`, so its counters are meaningless), a caller ID
 * signing below A, and a flow with a deliberate validation warning.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8000);

/**
 * One accepted key, not "anything shaped like a key".
 *
 * An earlier version accepted any well-formed string, which meant the
 * rejection path could never be exercised — every typo logged you in. A
 * fixture that only ever succeeds does not tell you the failure handling
 * works.
 */
const VALID_KEY = "ivrk_localpreviewkey000000000000000000000";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const LIST_ID = "55555555-5555-4555-8555-555555555555";
const FLOW_ID = "66666666-6666-4666-8666-666666666661";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

const ME = {
  user: null,
  api_key: {
    id: "key-1",
    name: "local-fixture",
    prefix: "ivrk_local",
    expires_at: null,
  },
  organization: {
    id: ORG_ID,
    name: "Acme Utilities",
    slug: "acme",
    is_active: true,
    is_suspended: false,
    suspension_reason: "",
    require_consent_for_marketing: true,
    permitted_countries: ["US", "KE"],
  },
  role: "owner",
  capabilities: [
    "campaign.view", "campaign.edit", "campaign.control",
    "contacts.view", "contacts.edit", "contacts.export",
    "flow.view", "flow.edit", "flow.publish",
    "compliance.view", "compliance.edit",
    "recordings.listen", "org.manage",
  ],
  ceilings: { max_cps: 10, max_concurrent_channels: 100, max_contacts: 1_000_000 },
};

const callerId = (o = {}) => ({
  id: CALLER_ID,
  phone_e164: "+12125550100",
  friendly_name: "Acme main",
  provider: "twilio",
  provider_sid: "PN0000",
  attestation: "A",
  cnam_display: "ACME UTIL",
  branded_calling_enrolled: true,
  reputation_score: null,
  reputation_checked_at: null,
  is_active: true,
  daily_call_cap: 0,
  calls_today: 4210,
  rested_until: null,
  is_available: true,
  created_at: "2026-07-01T09:00:00Z",
  ...o,
});

const stats = (o = {}) => ({
  total_contacts: 0, dialed: 0, answered: 0, human: 0, machine: 0,
  no_answer: 0, busy: 0, failed: 0, transferred: 0, opted_out: 0,
  suppressed: 0, confirmed: 0, voicemail: 0, dtmf_breakdown: {},
  total_duration_seconds: 0, total_cost: "0.00000",
  last_flushed_at: null, answer_rate: 0, human_answer_rate: 0,
  ...o,
});

const campaign = (o = {}) => ({
  id: "33333333-3333-4333-8333-333333333333",
  name: "Untitled",
  status: "draft",
  flow_version: VERSION_ID,
  flow_name: "Appointment reminder",
  flow_version_number: 3,
  caller_id: CALLER_ID,
  caller_id_detail: callerId(),
  contact_lists: [LIST_ID],
  provider: "twilio",
  requires_consent: true,
  consent_scope: "marketing",
  cps_limit: 5,
  max_concurrent_channels: 30,
  ring_timeout_seconds: 30,
  scheduled_start: null,
  scheduled_end: null,
  window_start_local: "09:00:00",
  window_end_local: "17:00:00",
  active_weekdays: [0, 1, 2, 3, 4],
  respect_contact_timezone: true,
  fallback_timezone: "UTC",
  max_attempts: 3,
  retry_delay_minutes: 90,
  retry_on_statuses: ["busy", "no_answer"],
  retry_backoff_factor: 1.5,
  max_attempts_per_day: 2,
  amd_enabled: true,
  amd_mode: "DetectMessageEnd",
  amd_async: true,
  amd_timeout_seconds: 30,
  voicemail_node: "voicemail",
  hangup_on_machine: false,
  record_calls: false,
  recording_disclosure_node: "",
  started_at: null,
  completed_at: null,
  pause_reason: "",
  queue_built_at: null,
  stats: stats(),
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-03T14:12:00Z",
  ...o,
});

const CAMPAIGNS = [
  campaign({
    id: "33333333-3333-4333-8333-333333333331",
    name: "August renewals — wave 2",
    status: "running",
    started_at: "2026-08-03T09:00:00Z",
    queue_built_at: "2026-08-03T08:58:00Z",
    updated_at: "2026-08-03T15:41:00Z",
    stats: stats({
      total_contacts: 12000, dialed: 4210, answered: 1180, human: 902,
      machine: 278, no_answer: 2600, busy: 140, failed: 90, transferred: 88,
      opted_out: 31, confirmed: 640, voicemail: 210,
      dtmf_breakdown: { 1: 640, 2: 140, 9: 31 },
      total_duration_seconds: 41230, total_cost: "38.41200",
      last_flushed_at: "2026-08-03T15:41:00Z",
      answer_rate: 0.2803, human_answer_rate: 0.2142,
    }),
  }),
  campaign({
    id: "33333333-3333-4333-8333-333333333332",
    name: "Payment reminder — Nairobi",
    status: "throttled",
    pause_reason: "HTTP 429 Too Many Requests — carrier rate limit exceeded",
    started_at: "2026-08-03T11:00:00Z",
    queue_built_at: "2026-08-03T10:59:00Z",
    updated_at: "2026-08-03T15:20:00Z",
    caller_id_detail: callerId({ attestation: "C", friendly_name: "KE line" }),
    stats: stats({
      total_contacts: 8000, dialed: 910, answered: 190, human: 130,
      machine: 60, no_answer: 620, busy: 60, failed: 40, confirmed: 88,
      answer_rate: 0.2088, human_answer_rate: 0.1429,
      last_flushed_at: "2026-08-03T15:20:00Z",
    }),
  }),
  campaign({
    id: "33333333-3333-4333-8333-333333333333",
    name: "Survey pilot",
    status: "draft",
    flow_name: "Post-service survey",
    flow_version_number: 1,
  }),
  campaign({
    id: "33333333-3333-4333-8333-333333333334",
    name: "July outage notice",
    status: "completed",
    consent_scope: "informational",
    started_at: "2026-07-28T09:00:00Z",
    completed_at: "2026-07-28T16:30:00Z",
    queue_built_at: "2026-07-28T08:55:00Z",
    updated_at: "2026-07-28T16:30:00Z",
    stats: stats({
      total_contacts: 5400, dialed: 5400, answered: 2106, human: 1580,
      machine: 526, no_answer: 2800, busy: 300, failed: 194,
      confirmed: 1402, voicemail: 480,
      dtmf_breakdown: { 1: 1402, 9: 12 },
      total_duration_seconds: 88900, total_cost: "72.10000",
      answer_rate: 0.39, human_answer_rate: 0.2926,
      last_flushed_at: "2026-07-28T16:30:00Z",
    }),
  }),
  campaign({
    id: "33333333-3333-4333-8333-333333333335",
    name: "Winback — lapsed accounts",
    status: "paused",
    pause_reason: "Reviewing script with compliance",
    started_at: "2026-08-02T09:00:00Z",
    queue_built_at: "2026-08-02T08:58:00Z",
    updated_at: "2026-08-02T13:05:00Z",
    stats: stats({
      total_contacts: 3000, dialed: 420, answered: 96, human: 71, machine: 25,
      no_answer: 280, busy: 24, failed: 20, confirmed: 44, opted_out: 9,
      dtmf_breakdown: { 1: 44, 9: 9 },
      answer_rate: 0.2286, human_answer_rate: 0.169,
      last_flushed_at: "2026-08-02T13:05:00Z",
    }),
  }),
];

const FRAME = {
  campaign_id: CAMPAIGNS[0].id,
  dialed: 4210, answered: 1180, human: 902, machine: 278,
  busy: 140, no_answer: 2600, failed: 90, completed: 0, suppressed: 12,
  transferred: 88, opted_out: 31, confirmed: 640, voicemail: 210,
  duration_seconds: 41230,
  live_channels: 23,
  dtmf: { 1: 640, 2: 140, 9: 31 },
  dispositions: { confirmed: 640, transferred: 88, opted_out: 31, voicemail: 210 },
  rates: { answer: 0.2803, human: 0.2142, machine: 0.2356, transfer: 0.0746, opt_out: 0.0263 },
};

/** Warnings but no errors — exercises the force-acknowledge path. */
const PREFLIGHT = {
  ok: true,
  errors: [],
  warnings: [
    { code: "attestation_below_a", message: "Caller ID signs B." },
    { code: "high_suppression", message: "31% of the list is suppressed." },
    { code: "flow_no_timeout_target", message: "Menu has no timeout branch." },
  ],
  estimate: { total: 12000, reachable: 8280, suppressed: 3720 },
};

const AMD = {
  answered: 1180, machine: 278, human: 902, unknown: 0,
  machine_with_dtmf: 14, human_no_input: 120,
  false_machine_rate: 0.0503, suspected_false_human_rate: 0.021, machine_rate: 0.2356,
};

const NODE_TYPES = {
  prompt_kinds: ["audio", "say", "tts"],
  branch_operators: ["eq", "gt", "gte", "in", "is_empty", "is_set", "lt", "lte", "neq", "not_in", "starts_with"],
  nodes: [
    { type: "play", required: ["prompt"], optional: ["loop", "next", "pause_after"], transitions: ["next"], terminal: false, gathers_input: false, description: "Play a prompt, then move on." },
    { type: "menu", required: ["options", "prompt"], optional: ["finish_on_key", "invalid_prompt", "max_attempts", "num_digits", "on_invalid", "on_timeout", "timeout_prompt", "timeout_seconds"], transitions: ["on_timeout", "on_invalid"], terminal: false, gathers_input: true, description: "Play a prompt and branch on a single keypress." },
    { type: "collect", required: ["prompt", "variable", "next"], optional: ["finish_on_key", "max_attempts", "max_digits", "min_digits", "on_invalid", "on_timeout", "timeout_seconds"], transitions: ["next", "on_invalid", "on_timeout"], terminal: false, gathers_input: true, description: "Collect a string of digits into a variable." },
    { type: "transfer", required: ["endpoint"], optional: ["on_fail", "record", "ring_prompt", "timeout_seconds", "whisper"], transitions: ["on_fail"], terminal: false, gathers_input: false, description: "Bridge the caller to an approved destination." },
    { type: "opt_out", required: ["prompt"], optional: ["next", "scope"], transitions: ["next"], terminal: true, gathers_input: false, description: "Suppress the number, then close." },
    { type: "voicemail", required: ["prompt"], optional: ["max_length_seconds"], transitions: [], terminal: true, gathers_input: false, description: "Leave a message and hang up." },
    { type: "record", required: ["prompt"], optional: ["finish_on_key", "max_length_seconds", "next", "play_beep", "transcribe"], transitions: ["next"], terminal: false, gathers_input: false, description: "Record the caller." },
    { type: "branch", required: ["conditions", "default"], optional: [], transitions: ["default"], terminal: false, gathers_input: false, description: "Take the first matching condition." },
    { type: "hangup", required: [], optional: ["prompt"], transitions: [], terminal: true, gathers_input: false, description: "End the call." },
  ],
};

const DEFINITION = {
  schema_version: "1.0",
  entry: "greeting",
  default_locale: "en",
  nodes: {
    greeting: { type: "play", label: "Greeting", prompt: { kind: "tts", text: "Hello {{first_name}}, this is {{organization_name}}." }, next: "menu" },
    menu: { type: "menu", label: "Main menu", prompt: { kind: "tts", text: "Press 1 to confirm. Press 9 to be removed from our list." }, options: { 1: "confirm", 9: "optout" }, timeout_seconds: 5, max_attempts: 2, on_invalid: "goodbye" },
    confirm: { type: "play", prompt: { kind: "tts", text: "Thank you." }, disposition: "confirmed", next: "goodbye" },
    optout: { type: "opt_out", scope: "organization", prompt: { kind: "tts", text: "You will not be called again." } },
    goodbye: { type: "hangup", prompt: { kind: "tts", text: "Goodbye." } },
  },
};

/** Deliberately warns: the menu has no on_timeout branch. */
const REPORT = {
  ok: true,
  errors: [],
  warnings: [
    { level: "warning", code: "no_timeout_target", message: "Menu has no timeout branch — the call hangs up with no closing message.", node: "menu" },
  ],
};

const version = (o = {}) => ({
  id: VERSION_ID, flow: FLOW_ID, version: 3, definition: DEFINITION,
  entry_node: "greeting", checksum: "a1b2c3", is_published: true,
  published_at: "2026-07-30T12:00:00Z", rendered_prompts: {},
  prompts_rendered_at: "2026-07-30T12:04:00Z", validation_report: REPORT,
  created_at: "2026-07-30T11:40:00Z", ...o,
});

const VERSIONS = [
  version({ id: "44444444-4444-4444-8444-444444444404", version: 4, is_published: false, published_at: null, prompts_rendered_at: null }),
  version(),
  version({ id: "44444444-4444-4444-8444-444444444402", version: 2, published_at: "2026-07-20T10:00:00Z" }),
];

const FLOWS = [
  { id: FLOW_ID, name: "Appointment reminder", description: "Confirm, transfer, or opt out.", is_archived: false, latest_version: { id: VERSIONS[0].id, version: 4, is_published: false }, published_version: { id: VERSION_ID, version: 3 }, created_at: "2026-07-01T09:00:00Z", updated_at: "2026-08-02T14:00:00Z" },
  { id: "66666666-6666-4666-8666-666666666662", name: "Post-service survey", description: "", is_archived: false, latest_version: { id: "x1", version: 1, is_published: false }, published_version: null, created_at: "2026-07-25T09:00:00Z", updated_at: "2026-07-25T09:00:00Z" },
];

const LISTS = [
  { id: LIST_ID, name: "August renewals", description: "", default_region: "US", source_filename: "renewals-aug.csv", total_rows: 12000, valid_rows: 11940, rejected_rows: 60, duplicate_rows: 140, suppressed_rows: 3720, reachable_rows: 8220, ingest_status: "completed", ingest_started_at: "2026-08-01T10:00:00Z", ingest_finished_at: "2026-08-01T10:04:00Z", ingest_report: { total: 12000, valid: 11940, rejected: 60, duplicates: 140, suppressed: 3720 }, created_at: "2026-08-01T09:58:00Z" },
  { id: "55555555-5555-4555-8555-555555555556", name: "Nairobi customers", description: "", default_region: "KE", source_filename: "ke.csv", total_rows: 8000, valid_rows: 7980, rejected_rows: 20, duplicate_rows: 0, suppressed_rows: 120, reachable_rows: 7860, ingest_status: "completed", ingest_started_at: null, ingest_finished_at: "2026-07-29T08:00:00Z", ingest_report: {}, created_at: "2026-07-29T07:55:00Z" },
];

const call = (o = {}) => ({
  id: "77777777-7777-4777-8777-777777777771",
  campaign: CAMPAIGNS[0].id,
  provider_call_sid: "CA9f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d",
  to_masked: "+1212***0123",
  status: "completed", answered_by: "human", disposition: "confirmed",
  attempt_number: 1, duration_seconds: 38, ring_seconds: 6,
  cost: "0.00840", terminal_node: "goodbye",
  created_at: "2026-08-03T15:38:00Z", ended_at: "2026-08-03T15:39:04Z",
  ...o,
});

const CALLS = [
  call(),
  call({ id: "77777777-7777-4777-8777-777777777772", to_masked: "+1212***0456", answered_by: "machine_end_beep", disposition: "voicemail", duration_seconds: 22, terminal_node: "voicemail" }),
  call({ id: "77777777-7777-4777-8777-777777777773", to_masked: "+1212***0789", status: "no_answer", answered_by: "", disposition: "", duration_seconds: 0, ring_seconds: 30, cost: "0.00200", terminal_node: "" }),
  call({ id: "77777777-7777-4777-8777-777777777774", to_masked: "+1212***0999", disposition: "opted_out", duration_seconds: 14, terminal_node: "optout" }),
  call({ id: "77777777-7777-4777-8777-777777777775", to_masked: "+1212***0222", status: "busy", answered_by: "", disposition: "", duration_seconds: 0, attempt_number: 2, cost: null, terminal_node: "" }),
];

const CALL_DETAIL = {
  ...CALLS[0],
  contact: "c1", flow_version: VERSION_ID, provider: "twilio",
  from_number: "+12125550100", to_number: "+12125550123",
  sip_response_code: 200, error_code: "", error_message: "",
  initiated_at: "2026-08-03T15:38:00Z", ringing_at: "2026-08-03T15:38:02Z",
  answered_at: "2026-08-03T15:38:08Z",
  amd_latency_ms: 1840,
  node_path: ["greeting", "menu", "confirm", "goodbye"],
  transferred_to: "", transfer_duration_seconds: 0, recording_duration: 0,
  cost_currency: "USD", cost_reconciled: false, stir_attestation: "A",
  dtmf: [{ node_id: "menu", digits: "1", attempt: 1, latency_ms: 1420, is_valid: true, created_at: "2026-08-03T15:38:31Z" }],
};

const CALL_EVENTS = [
  { event_type: "initiated", sequence_number: 0, payload: {}, signature_valid: true, received_at: "2026-08-03T15:38:00Z" },
  { event_type: "ringing", sequence_number: 1, payload: {}, signature_valid: true, received_at: "2026-08-03T15:38:02Z" },
  { event_type: "answered", sequence_number: 2, payload: {}, signature_valid: true, received_at: "2026-08-03T15:38:08Z" },
  { event_type: "completed", sequence_number: 3, payload: {}, signature_valid: true, received_at: "2026-08-03T15:39:04Z" },
];

const DNC = [
  { id: "d1", phone_e164: "+12125550999", phone_masked: "+1212***0999", reason: "ivr_opt_out", scope_campaign: null, notes: "", expires_at: null, is_global: false, created_at: "2026-08-03T15:38:45Z" },
  { id: "d2", phone_e164: "+12125550888", phone_masked: "+1212***0888", reason: "litigator", scope_campaign: null, notes: "Known trap line", expires_at: null, is_global: true, created_at: "2026-07-12T09:00:00Z" },
  { id: "d3", phone_e164: "+12125550777", phone_masked: "+1212***0777", reason: "complaint", scope_campaign: null, notes: "", expires_at: null, is_global: false, created_at: "2026-07-30T14:20:00Z" },
];

const CONSENT = [
  { id: "k1", phone_e164: "+12125550123", consent_type: "express_written", scope: "marketing", source: "web_form", source_url: "https://acme.example/signup", disclosure_text: "I agree to receive automated calls and texts from Acme Utilities at the number provided, including by artificial or prerecorded voice. Consent is not a condition of purchase.", captured_at: "2026-06-14T11:22:00Z", captured_ip: "203.0.113.44", captured_user_agent: "Mozilla/5.0", evidence_ref: "tf_01H8XYZ", revoked_at: null, revocation_channel: "", expires_at: null, is_active: true, created_at: "2026-06-14T11:22:00Z" },
  { id: "k2", phone_e164: "+12125550999", consent_type: "express_written", scope: "marketing", source: "import", source_url: "", disclosure_text: "Agreed to receive service notifications by phone.", captured_at: "2026-05-02T09:00:00Z", captured_ip: null, captured_user_agent: "", evidence_ref: "", revoked_at: "2026-08-03T15:38:45Z", revocation_channel: "ivr", expires_at: null, is_active: false, created_at: "2026-05-02T09:00:00Z" },
];

const WINDOWS = [
  { id: "w1", jurisdiction: "US", start_local: "09:00:00", end_local: "18:00:00", weekdays: [0, 1, 2, 3, 4], holidays_blocked: true, notes: "", created_at: "2026-07-01T09:00:00Z" },
  { id: "w2", jurisdiction: "US-FL", start_local: "09:00:00", end_local: "17:00:00", weekdays: [0, 1, 2, 3, 4], holidays_blocked: true, notes: "State rule is stricter", created_at: "2026-07-01T09:00:00Z" },
];

// --- plumbing ---------------------------------------------------------

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const err = (res, code, error) => json(res, code, { error });
const page = (res, results) =>
  json(res, 200, { count: results.length, next: null, previous: null, results });
const cursor = (res, results) =>
  json(res, 200, { next: null, previous: null, results });

const ROUTES = [
  [/^\/api\/v1\/me\/$/, (res) => json(res, 200, ME)],

  [/^\/api\/v1\/campaigns\/$/, (res, _m, url) => {
    const status = url.searchParams.get("status");
    page(res, status ? CAMPAIGNS.filter((c) => c.status === status) : CAMPAIGNS);
  }],
  [/^\/api\/v1\/campaigns\/([^/]+)\/stats\/$/, (res) => json(res, 200, FRAME)],
  [/^\/api\/v1\/campaigns\/([^/]+)\/preflight\/$/, (res) => json(res, 200, PREFLIGHT)],
  [/^\/api\/v1\/campaigns\/([^/]+)\/amd-quality\/$/, (res) => json(res, 200, AMD)],
  [/^\/api\/v1\/campaigns\/([^/]+)\/$/, (res, m) => {
    const found = CAMPAIGNS.find((c) => c.id === m[1]);
    return found
      ? json(res, 200, found)
      : err(res, 404, { code: "not_found", message: "Not found.", detail: null });
  }],

  [/^\/api\/v1\/flows\/node-types\/$/, (res) => json(res, 200, NODE_TYPES)],
  [/^\/api\/v1\/flows\/([^/]+)\/versions\/$/, (res) => json(res, 200, VERSIONS)],
  [/^\/api\/v1\/flows\/$/, (res) => page(res, FLOWS)],
  [/^\/api\/v1\/flows\/([^/]+)\/$/, (res, m) => {
    const found = FLOWS.find((f) => f.id === m[1]);
    return found ? json(res, 200, found) : err(res, 404, { code: "not_found", message: "Not found." });
  }],
  [/^\/api\/v1\/flow-versions\/([^/]+)\/$/, (res, m) => {
    const found = VERSIONS.find((v) => v.id === m[1]) ?? VERSIONS[0];
    return json(res, 200, found);
  }],

  [/^\/api\/v1\/contact-lists\/$/, (res) => page(res, LISTS)],
  [/^\/api\/v1\/contact-lists\/([^/]+)\/$/, (res, m) => {
    const found = LISTS.find((l) => l.id === m[1]) ?? LISTS[0];
    return json(res, 200, found);
  }],

  [/^\/api\/v1\/calls\/([^/]+)\/events\/$/, (res) => json(res, 200, CALL_EVENTS)],
  [/^\/api\/v1\/calls\/$/, (res) => cursor(res, CALLS)],
  [/^\/api\/v1\/calls\/([^/]+)\/$/, (res) => json(res, 200, CALL_DETAIL)],

  [/^\/api\/v1\/dnc\/check\/$/, (res, _m, url) => {
    const phone = url.searchParams.get("phone") ?? "";
    const hit = DNC.find((d) => d.phone_e164 === phone.replace(/\s/g, ""));
    json(res, 200, {
      phone_e164: phone,
      suppressed: Boolean(hit),
      reason: hit?.reason ?? "",
    });
  }],
  [/^\/api\/v1\/dnc\/$/, (res) => cursor(res, DNC)],

  [/^\/api\/v1\/consent\/lookup\/$/, (res, _m, url) => {
    const phone = url.searchParams.get("phone") ?? "";
    json(res, 200, CONSENT.filter((c) => c.phone_e164 === phone.replace(/\s/g, "")));
  }],
  [/^\/api\/v1\/consent\/$/, (res) => cursor(res, CONSENT)],

  [/^\/api\/v1\/calling-windows\/$/, (res) => page(res, WINDOWS)],
  [/^\/api\/v1\/caller-ids\/$/, (res) =>
    page(res, [callerId(), callerId({ id: "c2", phone_e164: "+254712345678", friendly_name: "KE line", attestation: "C", calls_today: 910, daily_call_cap: 5000, branded_calling_enrolled: false })]),
  ],
];

createServer((req, res) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const url = new URL(req.url ?? "/", "http://localhost");

  if (token !== VALID_KEY) {
    return err(res, 401, {
      code: "authentication_failed",
      message: "Invalid API key.",
      detail: null,
      request_id: "mock-" + Math.random().toString(36).slice(2, 8),
    });
  }

  // Writes are accepted but not persisted — enough to exercise the UI paths.
  if (req.method !== "GET") {
    if (/\/start\/$/.test(url.pathname)) {
      // Warnings without force → 422, the acknowledge-then-retry path.
      let body = "";
      req.on("data", (c) => (body += c));
      return req.on("end", () => {
        const forced = (() => {
          try {
            return JSON.parse(body || "{}").force === true;
          } catch {
            return false;
          }
        })();
        if (!forced) {
          return err(res, 422, {
            code: "compliance_blocked",
            message: "Launch has warnings.",
            detail: {
              ...PREFLIGHT,
              message: "Launch has warnings; resubmit with force=true to acknowledge.",
            },
            request_id: "mock-422",
          });
        }
        json(res, 200, { ...CAMPAIGNS[0], status: "running" });
      });
    }
    return json(res, 200, CAMPAIGNS[0]);
  }

  for (const [pattern, handler] of ROUTES) {
    const match = pattern.exec(url.pathname);
    if (match) return handler(res, match, url);
  }

  err(res, 404, {
    code: "not_found",
    message: `No fixture for ${url.pathname}. Add one in client/mock/upstream.mjs.`,
    detail: null,
  });
}).listen(PORT, () => {
  console.log(`Fixture upstream on http://localhost:${PORT}`);
  console.log(`Accepts exactly one key: ${VALID_KEY}`);
});
