# Security & compliance

Specification §12. This document describes **what the code enforces** and, just
as importantly, **what it does not**. Section 12 of the spec was truncated, so
the structure follows its contents listing.

> Nothing here is legal advice. Regulations governing automated outbound calls
> change frequently and differ by jurisdiction; a document written at one point
> in time cannot tell you what the rules are at the moment you read it. Have
> counsel review your consent model, your scripts and your retention policy
> before you place a call. What follows is an engineering description of the
> controls, not a statement of law.

---

## 12.1 Consent and suppression (US traffic)

### What the platform enforces in code

| Control | Where | Behaviour |
|---|---|---|
| Consent required before dial | `compliance/services.py::is_dialable` | A campaign with `requires_consent=True` will not dial a number without an active, unrevoked, unexpired `ConsentRecord` matching the campaign's scope |
| Marketing scope cannot opt out of the gate | `campaigns/serializers.py`, `services.preflight` | Rejected at both the serialiser and the launch check |
| Suppression checked twice | ingest (advisory) + pre-dial (authoritative) | A list uploaded Monday and dialled Friday has accumulated new opt-outs |
| In-call opt-out is immediate | `ivr/runtime.py::_plan_opt_out` → `webhooks._record_opt_out` | The DNC row is committed and the cache key deleted **before** the confirmation TwiML is returned |
| Opt-out stops queued attempts | `services.record_opt_out` | Pending and dialling queue rows across every campaign are moved to `suppressed` |
| Calling windows | `compliance/windows.py` | Intersection of campaign, tenant and statutory windows, evaluated in the *contact's* timezone |
| Per-day attempt cap | `campaigns/services.py::schedule_retry` | Separate from the total cap — "three attempts" and "three attempts today" are different promises |
| Evidence retained | `ConsentRecord` | Timestamp, source, source URL, IP, user agent, exact disclosure text, and an `evidence_ref` for third-party proof |

### Why `ConsentRecord` is a first-class model

Most dialer implementations track DNC and stop there. DNC proves you were told
to stop; consent proves you were allowed to start. The evidence has to be
per-number, timestamped and tied to the exact disclosure language shown, and it
cannot be retrofitted — the historical evidence is gone by then.

The API therefore makes consent records **immutable**. `PUT`/`PATCH` are
rejected outright; corrections are new records and revocation stamps
`revoked_at` rather than deleting the row. A record that can be edited after
the fact is not evidence.

### What the platform does not do

- It does not decide **whether** your consent is valid. It records what you
  captured and enforces its presence, scope and expiry. Whether the disclosure
  you showed was adequate is a legal question.
- It does not scrub against the federal DNC registry or any litigator list out
  of the box. `compliance.tasks._fetch_scrub_numbers` raises
  `NotImplementedError` and the `ScrubJob` row records the failure — so "when
  did you last scrub?" has an honest answer rather than an assumed one.
- It ships **no table of state calling-hour restrictions**. Several US states
  are stricter than the federal rule. A wrong entry in a shipped table is worse
  than no entry because it reads as authoritative. Configure `CallingWindow`
  rows per jurisdiction after legal review; absent one, the federal ceiling
  applies.
- It does not track wireless vs landline reliably without an enrichment pass.
  Number portability means metadata cannot tell you whether a US number is
  currently wireless — `contacts.tasks.enrich_line_types` calls the carrier
  lookup API for that, and it is billable.

### Synthetic voice

Using an artificial or pre-recorded voice is generally the characteristic that
brings a call under stricter consent rules — it is not an implementation
detail of the audio pipeline. Pre-rendering prompts to S3 (§6.4) is a latency
and cost optimisation; it does not change the character of the call. Every
`tts`, `say` and uploaded `audio` prompt is an artificial or pre-recorded
voice.

---

## 12.2 STIR/SHAKEN and deliverability

`CallerID.attestation` is stored but **not settable through the API** — it is
read-only in `CallerIDSerializer`. Attestation is a property of the carrier's
vetting of your right to use a number, not something the application can
assert about itself. Letting a tenant type "A" into a form would turn an
audited fact into a self-assessment.

What the platform does with it:

- `preflight` warns when a campaign is about to launch from a number with
  attestation below A.
- `CallLog.stir_attestation` records what the call actually went out with, and
  the status callback overwrites it from `StirVerstat` when the carrier reports
  one — so you can correlate answer rate against attestation after the fact.
- `CallerID` carries `cnam_display` and `branded_calling_enrolled` for the
  display-name and branded-calling programmes, which are separate from
  attestation and separately contracted.

Getting full attestation is a carrier onboarding exercise (business identity
verification, number ownership proof). No code change achieves it.

---

## 12.3 Reputation management — the honest version

Numbers get labelled "Spam Likely" by analytics engines that are proprietary,
opaque, and not obliged to tell you why. What is actually true:

**There is no reliable free API for reputation.** The data comes from the
analytics providers or a reseller in front of them, under contract.
`campaigns.tasks.refresh_caller_id_reputation` therefore logs that it is not
wired to a provider and returns zero rather than inventing a score. A fake
number here would be worse than none — people would make rotation decisions on
it.

**What the platform gives you instead** is the levers that actually work,
without pretending they are automatic:

| Lever | Field / mechanism |
|---|---|
| Number rotation | `CallerID.daily_call_cap`, `calls_today`, `rested_until`, `is_available` |
| Answer-rate monitoring per number | `CallLog.from_number` + campaign KPIs — a collapsing answer rate is the earliest signal you own |
| Call duration and abandon rate | `duration_seconds`, `Disposition.ABANDONED` — short calls and high abandons drive labelling |
| Frequency capping | `max_attempts`, `max_attempts_per_day`, `retry_backoff_factor` |
| Attestation and CNAM | `attestation`, `cnam_display`, `branded_calling_enrolled` |

**What does not work**, and is not implemented for that reason: rotating
through a large pool of cheap numbers to outrun labelling. The analytics
engines score calling *patterns*, not just numbers, and a burst of new numbers
exhibiting identical behaviour is itself a pattern. It also makes the traffic
harder to defend as legitimate.

The honest summary: reputation is a consequence of what you dial, how often,
and whether people want the call. The dialer can enforce the pacing and the
frequency caps. It cannot make an unwanted call welcome.

---

## 12.4 Application security checklist

### Authentication and authorisation

- [x] API keys stored as SHA-256; plaintext shown once, never recoverable
- [x] Keys carry `expires_at`, `revoked_at` and optional CIDR restrictions
- [x] `last_used_at` written on every request, so stale keys are visible
- [x] Role → capability matrix as data (`ROLE_CAPABILITIES`), not scattered
      `if role ==` checks
- [x] Views declare `required_capabilities` per action; unmapped write actions
      **deny by default**
- [x] Object-level check (`has_object_permission`) in addition to queryset
      scoping

### Tenant isolation (§1.1: "a data-breach class defect, not a bug")

- [x] `TenantModel.objects` refuses to materialise an unscoped queryset —
      raises under `TENANCY_STRICT`, logs critical otherwise
- [x] `count()` and `exists()` guarded too, not just iteration
- [x] `.unscoped()` is explicit and greppable; every call site is a deliberate
      cross-tenant access
- [x] Related-manager access is implicitly scoped (already FK-constrained)
- [x] Admin opts out explicitly and logs every cross-tenant read
- [x] WebSocket consumer authorises the campaign against the connection's
      organisation before joining the group (close `4003`)
- [x] Covered by `tests/test_tenancy.py`

### Webhook surface

- [x] Provider signature verification (Twilio HMAC, Telnyx Ed25519)
- [x] URL rebuilt from `PUBLIC_BASE_URL`, not `build_absolute_uri()` — behind a
      TLS-terminating LB the latter breaks every signature
- [x] Telnyx timestamp skew checked **before** the signature, bounding replay
- [x] Correlation check: the SID in the body must match the call the URL claims
- [x] IP allowlist middleware, configurable, applied before any view runs
- [x] nginx **sets** rather than appends `X-Forwarded-For`, so the allowlist
      cannot be spoofed by a client-supplied header
- [x] CSRF exempt (correct — there is no session to protect; the signature is
      strictly stronger for this threat model)

### Injection and SSRF

- [x] Flow DSL has a closed node-type set, no code execution, no expressions
- [x] Audio prompts reference an `AudioAsset` id; a `url` key is a validation
      error
- [x] Transfer targets are `TransferEndpoint` ids; inline dial strings rejected
- [x] Branch conditions restricted to a closed operator set
- [x] TwiML built with explicit XML escaping on text and attributes
- [x] Merge-variable substitution is one level of dotted access, no filters, no
      attribute traversal
- [x] Ingest caps variable length (256) and count (40) per row
- [x] S3 ingest keys validated against the tenant's own prefix — otherwise the
      parameter is a read primitive over the whole bucket
- [x] Partition DDL builds identifiers from integers only, never from input
- [x] Covered by `tests/test_flow_validator.py`

### Data handling

- [x] Phone numbers peppered and hashed; suppression, global DNC and erasure
      all match on the hash and never read plaintext
- [x] Log formatter redacts anything E.164-shaped to its last four digits
- [x] Sentry configured with `send_default_pii=False`
- [x] Admin contact search deliberately excludes `phone_e164` — otherwise staff
      access makes the contact database greppable from a browser
- [x] API responses expose masked numbers alongside full ones, so UIs can
      default to masked
- [x] All object-storage access via short-lived signed URLs; nothing public
- [x] Recording access is its own capability and writes an audit entry naming
      who listened

### Transport and process

- [x] `prod.py` refuses to boot on a missing secret, a default pepper, or a
      non-HTTPS `PUBLIC_BASE_URL`
- [x] HSTS, secure cookies, `X-Frame-Options: DENY`, nosniff, referrer policy
- [x] Container runs as non-root (uid 10001)
- [x] `statement_timeout=15s` — no runaway query holds a dispatch worker
- [x] Audit log is append-only and unmodifiable through the admin

### Known gaps

- MFA is a field on `User`, not an enforced flow
- No secret-manager integration; secrets arrive as environment variables
- No per-tenant encryption keys — one pepper platform-wide
- Rate limiting is per-organisation, not per-key

---

## 12.5 Data protection (GDPR, CCPA, Kenya DPA)

### Retention

Three separate clocks, because the data has three separate justifications:

| Data | Default | Mechanism | Rationale |
|---|---|---|---|
| Recordings | `RECORDING_RETENTION_DAYS` (365) | `compliance.apply_retention_policy` | Highest sensitivity, lowest evidentiary value |
| Raw call events | `CALL_EVENT_RETENTION_DAYS` (90) | `DROP TABLE` on the monthly partition | Carrier dispute window |
| Call logs | retained | — | The record of what you did |
| Consent records | retained | — | They are the defence; deleting them destroys your own evidence |

Raw events are dropped **by partition**, not by `DELETE`. Dropping a partition
is instant and returns the disk; deleting eight million rows takes minutes,
generates as much WAL as it removes, and leaves the table bloated.

### Erasure

`contacts.tasks.erase_number` implements the pattern from §4.8:

1. Write a permanent `DNCEntry` keyed on the hash with reason
   `erasure_request`
2. Null `phone_e164`, names and `variables` on every matching `Contact`;
   stamp `erased_at`
3. Null the plaintext, IP and user agent on matching `ConsentRecord` rows
4. Keep the hash everywhere

The number therefore stays suppressed forever without the platform continuing
to hold it. **Erasure must never become a route back onto the dialling list** —
a contact deleted outright could be re-uploaded tomorrow with no memory of the
opt-out. This is why suppression matching is hash-based throughout.

Call history is retained in de-identified form: it is the evidence trail for
calls already placed, and destroying it does not help the data subject.

### Subject rights

| Right | Endpoint |
|---|---|
| Access | `GET /api/v1/contacts/?...`, `GET /api/v1/calls/?contact=…`, `GET /api/v1/consent/lookup/?phone=…` |
| Erasure | `POST /api/v1/contacts/{id}/erase/` |
| Objection / withdrawal | `POST /api/v1/consent/{id}/revoke/` (also writes a suppression) |
| Portability | `GET /api/v1/contacts/` with `contacts.export` capability |

### Cross-border

`Organization.permitted_countries` scopes which countries a tenant may dial.
Recordings, prompts and uploads live in whichever bucket and region
`AWS_S3_REGION_NAME` names — for EU or Kenyan data-residency requirements,
that is a per-tenant deployment decision this codebase does not make for you.

### Recording disclosure

`Campaign.record_calls` cannot be enabled without
`recording_disclosure_node` — `preflight` fails otherwise. The validator also
warns whenever a flow contains a `record` node, because the disclosure has to
be *on the path* to it, not merely present somewhere in the document. Two-party
consent jurisdictions require the disclosure to precede recording on every
path; the validator cannot prove that for you, so it says so.
