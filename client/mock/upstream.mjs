/**
 * A fake Django, for looking at the UI without a database.
 *
 * DEV ONLY. This is not an auth bypass — the real login flow still runs, the
 * BFF still holds the credential, the SPA still has no idea it is talking to
 * fixtures. It just accepts any well-formed `ivrk_` key and answers with
 * canned data, so the portal can be reviewed before Postgres exists.
 *
 *   node client/mock/upstream.mjs            # listens on :8000
 *   IVR_API_BASE=http://localhost:8000 npm run dev:bff
 *
 * The fixtures deliberately cover the states that are easy to get wrong:
 * a throttled campaign carrying a carrier error, a draft that has never been
 * started (`queue_built_at: null`, so counters are meaningless), and a
 * completed one.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8000);
const KEY_PATTERN = /^ivrk_[A-Za-z0-9_-]{20,}$/;

const ME = {
  user: null,
  api_key: { id: "key-1", name: "local-fixture", prefix: "ivrk_local", expires_at: null },
  organization: {
    id: "11111111-1111-4111-8111-111111111111",
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

function callerId(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
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
    ...overrides,
  };
}

function stats(overrides = {}) {
  return {
    total_contacts: 0, dialed: 0, answered: 0, human: 0, machine: 0,
    no_answer: 0, busy: 0, failed: 0, transferred: 0, opted_out: 0,
    suppressed: 0, confirmed: 0, voicemail: 0, dtmf_breakdown: {},
    total_duration_seconds: 0, total_cost: "0.00000",
    last_flushed_at: null, answer_rate: 0, human_answer_rate: 0,
    ...overrides,
  };
}

function campaign(overrides = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Untitled",
    status: "draft",
    flow_version: "44444444-4444-4444-8444-444444444444",
    flow_name: "Appointment reminder",
    flow_version_number: 3,
    caller_id: "22222222-2222-4222-8222-222222222222",
    caller_id_detail: callerId(),
    contact_lists: ["55555555-5555-4555-8555-555555555555"],
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
    ...overrides,
  };
}

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
    // The only diagnostic a throttled campaign gives you.
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

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const err = (res, code, error) => json(res, code, { error });

createServer((req, res) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const url = new URL(req.url ?? "/", "http://localhost");

  if (!KEY_PATTERN.test(token)) {
    return err(res, 401, {
      code: "authentication_failed",
      message: "Invalid API key.",
      detail: null,
      request_id: "mock-" + Math.random().toString(36).slice(2, 8),
    });
  }

  if (url.pathname === "/api/v1/me/") return json(res, 200, ME);

  if (url.pathname === "/api/v1/campaigns/") {
    const status = url.searchParams.get("status");
    const results = status ? CAMPAIGNS.filter((c) => c.status === status) : CAMPAIGNS;
    return json(res, 200, {
      count: results.length,
      next: null,
      previous: null,
      results,
    });
  }

  const detail = url.pathname.match(/^\/api\/v1\/campaigns\/([^/]+)\/$/);
  if (detail) {
    const found = CAMPAIGNS.find((c) => c.id === detail[1]);
    return found
      ? json(res, 200, found)
      : err(res, 404, { code: "not_found", message: "Not found.", detail: null });
  }

  err(res, 404, {
    code: "not_found",
    message: `No fixture for ${url.pathname}. Add one in client/mock/upstream.mjs.`,
    detail: null,
  });
}).listen(PORT, () => {
  console.log(`Fixture upstream on http://localhost:${PORT}`);
  console.log("Accepts any key matching ivrk_[A-Za-z0-9_-]{20,}");
});
