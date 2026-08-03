# Implementation decisions

The specification arrived truncated at §6.1 — sections 6.2 through 14 were cut
off mid-sentence, and re-sending hit the same limit at the same point. Sections
1 through 6.1 are implemented as written. Everything after that is inferred
from the section headers, the two Mermaid diagrams (which are detailed enough
to pin down the pacer, the webhook split, the AMD redirect and the telemetry
path), the §2.3 rationale table, and the field names already present in the
§4 models.

This file records every one of those inferences, plus the places where the
implementation deliberately departs from the spec's own sample code. Nothing
here is hidden in a commit message.

---

## Part 1 — Inferences for the truncated sections

### §6.2 Node types

The spec named the section but not the nodes. The document fragment in §6.1
(`{"schema_version": "1.0", "ent…`) plus the sequence diagram (`<Play>`,
`<Gather>`, `Digits=1`, transfer, voicemail drop) fixes most of the set.
Implemented in `apps/ivr/dsl.py::NODE_SPECS`:

`play` · `menu` · `collect` · `transfer` · `opt_out` · `voicemail` · `record` ·
`branch` · `hangup`

**Assumption:** node types are a closed set with no user-extensible hook. The
spec is explicit that the DSL "is deliberately not a general-purpose scripting
language", so a plugin mechanism would contradict the stated design.

**Assumption:** `branch` needs *some* conditional routing (the §4.3 `variables`
JSONB field and the GIN index over it imply segmentation), but arbitrary
expressions would reintroduce code execution. Resolved with a closed operator
set (`BRANCH_OPERATORS`) evaluated by a `match` statement — no `eval`, no
regex, no arithmetic beyond numeric comparison.

**New model — `ivr.TransferEndpoint`.** The spec says the DSL must be
"impossible to turn into an SSRF vector" but shows no mechanism. Inline dial
strings in a flow document would make flow-edit permission equivalent to
toll-fraud permission, so transfer targets are ids resolved against a
tenant-owned allowlist table. The validator rejects `destination`, `sip_uri`,
`number` and `url` keys on a transfer node outright.

### §6.3 Publish-time validation

Inferred from "every transition target is validated against the node set at
publish time" (§6.1) and the `checksum` / `is_published` / `rendered_prompts`
fields on `IVRFlowVersion`.

Errors block publication; warnings do not but are persisted to
`validation_report` and returned by the API. The split is a judgement call:
"this flow has no opt-out path" should be loud but should not stop an
informational campaign from shipping.

The one graph check that is an *error* rather than a warning is
`no_terminal_path` — a node that can only loop is a call that never hangs up.

### §6.4 Prompt rendering and TTS

§2.3 gives the design ("rendered once per (flow version, variable set) into S3
and served as `<Play>`. Only genuinely per-contact fragments use live TTS") and
§6.4's contents line mentions "the TCPA implications of synthetic voice".

Three prompt kinds: `audio` (uploaded asset), `tts` (pre-rendered), `say`
(live). A `tts` prompt containing merge variables cannot be pre-rendered as a
unit, so it is marked `__dynamic__` and falls back to `<Say>` **without** the
"not pre-rendered" warning — otherwise every call would log a false alarm.

The spec's parenthetical about synthetic voice is addressed in
`apps/ivr/prompts.py`'s docstring: pre-rendering is an audio-pipeline
optimisation and does not change the legal character of the call. The consent
gate governs that, not the renderer.

### §6.5 Live call state in Redis

§2.3 gives the contract exactly: "Redis is the working set… written to Redis
with a 4-hour TTL and reconciled into `call_logs` on completion."

**Added beyond the spec:** `load_or_rebuild()`. If Redis loses a key mid-call
the webhook rebuilds minimal state from `CallLog` and restarts at the flow's
entry node rather than hanging up. A caller hearing the greeting twice is a bad
experience; a caller hearing silence is a hangup and a wasted dial. The rebuild
is deliberately minimal — reconstructing the caller's exact position is not
possible and pretending otherwise would replay side effects.

### §7.1–7.2 The two limits

§1.1 and the §2.3 table state the conclusion ("Celery's built-in `rate_limit`
is per-worker and therefore unsuitable"); the reasoning is reconstructed in
`apps/dialer/limits.py`'s docstring.

**Failure posture — an inference with teeth:** both primitives *deny* when
Redis is unreachable. The spec does not say this. A dialer that keeps dialling
when it cannot verify its own limits is precisely the failure the design exists
to prevent.

### §7.3 The pacer

The sequence diagram gives the algorithm nearly line by line:

```
P->>R: GET live_channels:{cid}
P->>R: token_bucket.take(cps, n)
P->>P: n = min(cps_tokens, max_channels - live)
P->>D: enqueue place_call x n (SKIP LOCKED claim)
```

Implemented in that order, with one change: **channel headroom is computed
before tokens are consumed**, not after. Taking tokens first and then
discovering there is no channel room would burn CPS allowance on calls that are
never placed.

**Added:** a per-campaign Redis lock (`LOCK_TTL_SECONDS = 5`). Beat can
double-fire across a scheduler failover, and two concurrent ticks would each
read the same headroom and collectively dispatch twice the batch.

**Added:** a `pacer` Celery queue. The spec lists four queues (dispatch,
events, telemetry, maintenance) and shows the pacer as a beat entry. A pacer
task sitting behind a `place_call` in the dispatch queue would be paced by the
carrier's latency, so it gets its own queue and its own worker pool.

### §7.4 Calling-window resolution

Inferred from `CallingWindow` (§4.4), `Contact.timezone` ("Drives calling
windows"), and the campaign's `respect_contact_timezone`.

The effective window is the **intersection** of campaign, tenant and statutory
rules — §4.4's "operators may tighten, never widen" made explicit in code.

**Deliberate omission:** no table of US state calling-hour restrictions ships.
Several states are stricter than the federal rule, and a wrong entry in a
shipped table is worse than no entry because it reads as authoritative. Absent
a tenant-configured `CallingWindow` row, US traffic gets the federal ceiling,
which is the safe direction to be wrong in. This is argued in the
`apps/compliance/windows.py` module docstring.

**New model — `compliance.NpaJurisdiction`.** State-level windows need an area
code → state map. The NANPA dataset is not embedded; it loads via
`manage.py load_npa_jurisdictions`.

### §7.5 The dispatch task

The diagram shows `INCR live_channels` → `POST /Calls` → `201 {sid}`.

**Added:** the channel is reserved using the *queue row id* before the carrier
round trip, then re-keyed to the call SID once it exists
(`ChannelSemaphore.rename`). Reserving only after the carrier responds would
let a burst of concurrent dispatches overshoot the ceiling during the round
trip.

**Added:** suppression and calling-window are re-checked inside `place_call`,
not only in the pacer. A batch claimed 800 ms ago can contain a contact three
timezones east who has just fallen out of window.

**Added:** the `CallLog` row is written *before* the originate, with a
placeholder SID (`pending:{row_id}`). Carriers can deliver the first status
callback before the originate response returns.

### §7.6 Provider adapter

Interface inferred from the §3 stack table ("Adapter pattern — both speak
near-identical XML dialects"). Implemented as `place_call` / `hangup` /
`redirect` / `fetch_call` / `lookup_numbers` / `verify_signature`.

`redirect` exists specifically for the §9 async-AMD voicemail drop, which the
sequence diagram shows as `calls(sid).update(twiml=voicemail_drop)`.

Telnyx is implemented over the REST API rather than its SDK — the TeXML surface
is a handful of endpoints, and one fewer vendor SDK in the dispatch path is one
fewer thing to pin and patch.

### §8.1 Latency budget

The spec gives the requirement ("within a few seconds", "ack < 200 ms" in the
diagram) but not the breakdown. The budget in
`apps/telephony/webhooks.py`'s docstring — 5 ms signature, 5 ms Redis, 1 ms
flow, 5 ms render, 50 ms p99 target, 200 ms hard ceiling — is inferred and
enforced by a log line when exceeded.

### §8.2 Signature validation

Twilio: `RequestValidator` over the form-encoded body, with the URL rebuilt
from `PUBLIC_BASE_URL` rather than `build_absolute_uri()` — behind a
TLS-terminating load balancer the latter yields `http://` and every signature
fails.

Telnyx: Ed25519 over `"{timestamp}|{body}"`. The timestamp is checked against
`WEBHOOK_MAX_SKEW_SECONDS` **before** the signature, because a valid signature
on a six-hour-old body is a replay and verifying it first leaves the replay
window unbounded.

**Added — third layer:** `signatures.correlates()`. A valid signature proves
the request came from the carrier, not that it refers to *our* call.

### §8.3–8.4 Webhook views and TwiML rendering

Endpoint shapes inferred from the sequence diagram: `/ivr/entry/`,
`/ivr/gather/`, AMD callback, status callback, plus recording and whisper.

The provider is part of the URL path (`/webhooks/twilio/…`) so a callback can
never be verified against the wrong provider's key, and so the edge can rate
limit each carrier independently.

Rendering builds XML with explicit escaping. Prompt text carries
contact-supplied merge variables; an unescaped `&` in a customer's name is a
malformed-TwiML error on a live call, and an unescaped `<` is markup injection
into the call script. `tests/test_runtime.py` covers both.

### §8.5 Idempotent status handling

The diagram shows `SETNX dedupe:{sid}:{seq}`. Implemented, plus two more
layers, because SETNX alone does not survive a Redis restart and does not
address *reordering* at all:

1. Redis `SETNX` — literal duplicates, 24-hour TTL
2. unique constraint on `(sid, event_type, sequence_number)` — the backstop
3. `CALL_STATUS_RANK` monotonic check — a `ringing` arriving after `completed`
   is recorded as a raw event but does not mutate `CallLog.status`

**Inference on failure posture:** the dedupe check fails *open* (opposite of
the limiters). Dropping a `completed` callback leaks a channel and strands a
queue row; processing a duplicate is recoverable.

### §9 Answering machine detection

§9.1 "Async AMD flow" is given by the diagram; the reasoning — synchronous AMD
means 2–4 seconds of dead air on every answered call including the human ones —
is reconstructed in `apps/telephony/amd.py`'s docstring, along with the race it
creates and the two mitigations.

§9.2 "Measuring AMD quality" had no content. Implemented as
`amd_quality_report()` over two observable proxies:

- **false machine** — `answered_by=machine` but DTMF was subsequently pressed.
  Directly measurable, and the expensive error.
- **false human** — `answered_by=human`, no DTMF, short duration. Inferred, not
  certain, and labelled `suspected_` in the API.

`CallLog.amd_latency_ms` was added for this; it cannot be reconstructed later.

**Judgement call:** `AnsweredBy.UNKNOWN` is treated as human. The cost of
talking to a machine is a wasted minute; the cost of hanging up on a person is
a complaint.

**Judgement call:** AMD on with no `voicemail_node` configured hangs up rather
than playing the human script to a machine.

### §10 Telemetry

§10.1 "Counter strategy" — the diagram shows `HINCRBY kpi:{cid}` and §4.6 says
stats are "flushed from Redis every 5s". The comparison against
`UPDATE … SET answered = answered + 1` and against per-event inserts is
reconstructed in `apps/telemetry/counters.py`'s docstring.

**Inference:** the flusher writes **absolute values, not deltas**, so a lost
flush self-corrects on the next one.

§10.3 consumer authorisation is the part the spec could not have omitted
safely: `/ws/campaigns/<uuid>/` with someone else's campaign id must be
*refused*, not merely uninteresting. Close code `4003`.

§10.4 frame contract is documented in the README and produced by exactly one
function (`build_frame`) so websocket, REST and exports cannot disagree about
what "answer rate" means.

### §11 REST API

Resource layout inferred from the §4 models. The notable shape decision:
lifecycle transitions are POST sub-resources (`/campaigns/{id}/start/`) rather
than PATCHes of `status`. A state machine driven by writes to a status field is
one anyone can drive into an invalid state; separate endpoints get separate
permissions, throttles and audit entries.

`preflight` is a GET that mutates nothing, so an operator can see every launch
check before committing. Warnings do not block, but launching with warnings
requires `force=true` — so "nobody told me the caller ID had a C attestation"
is not something anyone gets to say afterwards.

§11.3 error envelope: every error has the same `{"error": {code, message,
detail, request_id}}` shape, so the frontend has exactly one error path.

### §12 Security & compliance

See `COMPLIANCE.md`. §12.3 ("Reputation management — the honest version") is
answered honestly: reputation data comes from the analytics engines under
contract, there is no reliable free API, and
`campaigns.tasks.refresh_caller_id_reputation` says so rather than pretending.

### §13 Deployment

See `deploy/OPERATIONS.md` for the process topology (§13.1), alert thresholds
(§13.2) and load figures (§13.3). The load numbers are derived arithmetic —
20 CPS × 60 s average = ~1,200 live channels, 4+ callbacks per call = ~80
callbacks/s — not measurements.

**Inference with real consequences:** `beat` must be a singleton. Two
schedulers means two pacer ticks per second and double the intended rate.
Everything else scales freely.

### §14 Open risks

The spec's own risk list was truncated. Part 3 below is this implementation's
version.

---

## Part 2 — Departures from the spec's literal code

The spec's §4–5 code samples are implemented as written except where they would
not work or would silently produce wrong data. Each change is listed with its
reason.

| # | Spec | Change | Why |
|---|---|---|---|
| 1 | §5.4 `is_dialable` references `campaign.requires_consent` and `campaign.consent_scope` | Added both fields to `Campaign` | The gate is specified but the fields are absent from §4.6 |
| 2 | §5.4 returns `WIRELESS_BLOCK` when consent is missing | Added `SuppressionReason.NO_CONSENT` | "Wireless block" describes a different fact; conflating them makes the suppression report unreadable |
| 3 | §5.4 caches the consent result under the DNC key | Consent is **not** cached | It is the control with statutory damages attached, it is one partial-index lookup, and a stale cache here is the one failure mode you cannot argue away |
| 4 | §4.4 `UniqueConstraint(["organization", "phone_e164", "scope_campaign"])` | Split into two partial constraints on `phone_hash` | PostgreSQL treats NULLs as distinct, so the original permits unlimited duplicate org-wide entries — the exact rows that most need to be unique |
| 5 | §4.4 DNC matches on `phone_e164` | Matches on `phone_hash` | §4.8 requires suppression to survive erasure, which nulls the plaintext |
| 6 | §5.3 `report["valid"] += len(objs)` after `bulk_create(ignore_conflicts=True)` | Cross-list duplicates counted by an explicit indexed lookup first | The spec's own note says the return value is unusable on PostgreSQL; as written the report counts dropped rows as inserted |
| 7 | §5.2/§5.3 `phone_hash` defined in `ingest.py` | Moved to `common/utils.py`, re-exported | Compliance, erasure and the API all need it; three copies of a hash function is three chances to diverge |
| 8 | §4.7 `CallEvent` as a managed model | `managed = False` + `setup_partitions` | Django cannot express `PARTITION BY RANGE`, a composite PK including the partition key, or BRIN. `migrate` would fight the DDL |
| 9 | §4.6 `window_start_local = TimeField(default="09:00")` | `default=datetime.time(9, 0)` | String defaults serialise unpredictably into migrations |
| 10 | Diagram: `INCR`/`DECR live_channels` | Sorted set of live SIDs scored by dial time | A counter drifts: every lost `completed` leaks a channel permanently, and after a day a campaign configured for 30 channels is dialling 4. The sorted set self-heals and is reconstructable from `CallLog` |
| 11 | §5.4 `redis_cache.get(key)` where `key = f"dnc:{org}:{hash}"` | Prefix dropped (the cache alias already namespaces it) | Double-prefixing made the documented invalidation call miss the key it was meant to delete |

### Fields added to the §4 models

| Model | Field | Why |
|---|---|---|
| `Campaign` | `requires_consent`, `consent_scope` | Referenced by §5.4 but not defined |
| `Campaign` | `fallback_timezone` | `respect_contact_timezone=False` needs a clock to fall back to |
| `Campaign` | `provider`, `queue_built_at`, `created_by` | Dual-carrier routing; launch idempotency; audit |
| `CallerID` | `daily_call_cap`, `calls_today`, `rested_until` | Number rotation — §12.3 is meaningless without it |
| `CallLog` | `amd_latency_ms` | §9.2 is unmeasurable without it, and it cannot be backfilled |
| `CallLog` | `consent_record` FK | §1.1 requires knowing "which consent record authorised it" |
| `CallLog` | `recording_key`, `recording_purged_at` | Retention needs to distinguish "no recording" from "purged" |
| `CampaignContact` | `claimed_at` | Finding rows orphaned by a worker that died between claim and dial |
| `Contact` | `erased_at`, `lookup_checked_at` | Erasure audit; knowing whether the line-type lookup has run |
| `ConsentRecord` | `phone_hash` | So the gate matches on hash like every other suppression path |
| `ContactList` | `ingest_status`, `rejects_key`, `default_region` | The §5.1 pipeline produces these and has nowhere to put them |

### Models added beyond §4

`accounts.APIKey`, `accounts.AuditLogEntry`, `ivr.TransferEndpoint`,
`compliance.NpaJurisdiction`, `compliance.ScrubJob`,
`compliance.ComplianceIncident`. Rationale for each is in its docstring; the
first two are implied by §12.4, the rest by §6.2, §7.4 and §12.5 respectively.

---

## Part 3 — Open risks

Ordered by how expensive they are to discover late.

1. **The AMD race is not fully winnable.** Async AMD means the human script has
   already started when the verdict arrives. `DetectMessageEnd` and a neutral
   opening line mitigate it; nothing eliminates it. Watch
   `false_machine_rate` and be prepared to accept a worse machine-detection
   rate in exchange for not hanging up on people.

2. **Suppression has a 300-second negative-cache window.** An opt-out captured
   *outside* this platform (a web form, an inbound call, a letter) is not
   effective until the cache expires. In-IVR opt-outs invalidate synchronously.
   If external opt-out sources exist, they must call
   `invalidate_suppression_cache` — this is the most likely place for a
   compliance gap to open quietly.

3. **`beat` singleton is enforced by convention, not by code.** Two schedulers
   double the dial rate. Enforce it with a systemd unit or a Kubernetes
   `StatefulSet` replica of 1, and alert on duplicate `pacer_tick` executions.

4. **`PHONE_HASH_PEPPER` is unrotatable in practice.** Rotating it orphans
   every stored `phone_hash` and therefore every suppression record. There is
   no migration path short of re-hashing from plaintext, which erased contacts
   no longer have. Treat it as permanent from day one.

5. **State calling windows are unconfigured out of the box.** Federal hours
   apply until someone loads the NPA table and creates `CallingWindow` rows.
   That is safe but not correct; it needs a legal review before US traffic at
   volume.

6. **The `events` queue is the first thing that will fall behind.** Four
   callbacks per call at 20 CPS is 80/s sustained. Lag there shows up as stale
   dashboards first and stuck `dialing` queue rows second.

7. **Costs are eventually consistent.** Carriers price asynchronously;
   `cost_reconciled=False` calls are reconciled hourly. Any billing built on
   `CallLog.cost` must respect that flag.

8. **`select_for_update(of=("self",))` is PostgreSQL-specific.** The claim
   query does not port to MySQL. This is not a portable-ORM codebase and does
   not try to be.

9. **Transfer capacity is not coordinated with the pacer.** `TransferEndpoint`
   carries `max_concurrent`, but the pacer has no visibility into agent
   availability. A broadcast that transfers well will queue callers at the
   agent group. Predictive pacing against agent availability is out of scope
   (§1.2) and would be the next real feature.

10. **No load test has been run.** The §13.3 figures are arithmetic, not
    measurements. The first real campaign is the first real measurement — start
    at 1 CPS with a small list and a caller ID you are willing to burn.
