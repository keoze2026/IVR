# Outbound IVR Blasting & Voice Automation Platform

Backend implementation of the v1.0 specification: Django 5.2 · DRF · Celery ·
Redis · Channels · PostgreSQL 16 · Twilio Programmable Voice / Telnyx TeXML.

The design goal is **sustained, deliverable throughput under a hard compliance
envelope** — not raw throughput. Every architectural decision here is
subordinate to that, and the places where it costs performance are commented as
such.

---

## Quick start

```bash
cp .env.example .env          # fill in at minimum PHONE_HASH_PEPPER + DB creds
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python manage.py makemigrations    # see "Migrations" below
python manage.py migrate
python manage.py setup_partitions  # creates the partitioned call-event table
python manage.py bootstrap_org --name "Acme" --slug acme --email ops@acme.test

python manage.py runserver
```

Or the whole topology:

```bash
docker compose -f deploy/docker-compose.yml up --build
```

## Testing

```bash
./scripts/verify.sh          # tiers 1-4
./scripts/verify.sh 2        # stop after unit tests
```

Five tiers, each needing more infrastructure and each proving something the
previous one cannot.

### Tier 1 — static (no dependencies)

Byte-compiles every module, runs ruff, and walks the import graph asserting
that every internal `from apps.x import Y` resolves to a name that exists.
That last check matters because a bad import in a Celery task does not surface
when the web process starts — it surfaces when a worker picks up the task.

### Tier 2 — unit (needs `pip install -r requirements.txt`, and Redis)

```bash
pytest tests/test_windows.py tests/test_flow_validator.py \
       tests/test_runtime.py tests/test_ingest.py -q   # no infra needed
pytest tests/test_limits.py tests/test_idempotency.py -q  # needs Redis
```

The limiter tests run against a **real** Redis on logical DB 15, flushed around
each test. The token bucket and semaphore are Lua scripts executed server-side;
a mock returning whatever the test expects would prove nothing about them. If
no Redis is reachable those tests skip rather than fail.

What is actually asserted: the bucket never grants above capacity, refills over
time, and denies when Redis is down; the semaphore never exceeds its ceiling
under contention, survives the queue-row → call-SID re-key without freeing the
channel, and reconciles leaks in both directions.

### Tier 3 — database (needs Postgres)

```bash
python manage.py makemigrations --check --dry-run   # models match migrations
python manage.py migrate
python manage.py setup_partitions
pytest tests/test_tenancy.py -q
```

`makemigrations --check` is the one to keep in CI — migrations are generated
rather than checked in, so this is what stops the models and the schema
drifting apart.

### Tier 4 — boot

Asserts production settings validate, all Celery tasks register under their
expected names, the ASGI app builds with both protocol routers, and the
critical URLs resolve. Catches the failures that only appear when a specific
process type starts.

### Tier 5 — carrier loop (manual; costs money and rings a phone)

Nothing below this line is automated, because all of it has real-world side
effects.

```bash
# 1. Expose the callback surface. The carrier must reach you.
ngrok http 8000
#    Set PUBLIC_BASE_URL to the https URL it prints. Signature verification
#    rebuilds the signed URL from this value — if it is wrong, every webhook
#    fails with a 403 and that is the first thing to check.

# 2. Bring up the workers (each role separately, so you can read the logs)
celery -A config worker -Q pacer      -c 2 -l info &
celery -A config worker -Q dispatch   -c 4 -l info &
celery -A config worker -Q events     -c 4 -l info &
celery -A config beat -l info -S django_celery_beat.schedulers:DatabaseScheduler &

# 3. Seed a tenant, then via the API: caller ID -> flow -> publish -> list ->
#    upload -> ingest -> campaign -> preflight -> start
python manage.py bootstrap_org --name "Test" --slug test --email you@example.test
```

Start with a **one-contact list, your own mobile, `cps_limit=0.1`, and
`max_attempts=1`.** In that order of importance.

Then verify, in this order:

| Check | How | What a failure means |
|---|---|---|
| Preflight blocks correctly | `GET /campaigns/{id}/preflight/` before consent exists | The consent gate is not wired |
| Suppression gate holds | Add your number to `/dnc/`, start the campaign | The pre-dial check is being skipped |
| Pacing is respected | `cps_limit=0.1`, watch dispatch logs for ~1 call per 10s | The bucket is not being consulted |
| Signature verification | Replay a callback with a tampered body via curl | Must 403; if it 200s, stop and fix before anything else |
| Idempotency | POST the same status callback twice | Second must be a no-op; counters must not double |
| Channel release | Watch `ZCARD live_calls:{campaign}` in Redis across a call | Must return to 0; if it does not, callbacks are being lost |
| Window enforcement | Set the window to a past hour, start the campaign | Must place no calls |
| Opt-out | Press 9 in the IVR | `DNCEntry` must exist *before* the call ends |

The last one is worth doing by hand every release. It is the control with the
most expensive failure mode, and it is the one where a caching mistake produces
no error — just a number that keeps getting called.

### What none of this proves

No amount of local testing tells you how the carrier behaves under load, how
AMD performs against real answering machines, or whether your numbers get
labelled. Those are discovered in production, which is why the first real
campaign should be small, slow, and on a number you are willing to burn.

### Migrations

Model migrations are **not** checked in — run `makemigrations` once against the
models, which are the source of truth. This is deliberate: the environment this
was authored in has no Django installed, and a hand-written migration that
silently disagrees with `models.py` on an index name or a constraint condition
is worse than no migration at all. Everything the ORM *cannot* express — the
partitioned `telephony_callevent` table, its composite primary key, its BRIN
index — lives in `manage.py setup_partitions`, which is idempotent and runs on
every deploy.

---

## How a call actually happens

```
beat ──1 Hz──▶ campaigns.pacer_tick
                    │  one task per RUNNING campaign
                    ▼
              campaigns.pace_campaign          ← the ONLY component that decides
                    │                            whether a call may be placed
                    ├─ channel headroom?        apps/dialer/limits.py
                    ├─ CPS tokens?              apps/dialer/limits.py
                    ├─ claim rows               SELECT … FOR UPDATE SKIP LOCKED
                    ▼
              dialer.place_call                 ← dumb executor
                    ├─ re-check suppression     apps/compliance/services.py
                    ├─ re-check calling window  apps/compliance/windows.py
                    ├─ write CallLog            (before the dial, deliberately)
                    └─ POST /Calls ─────────────▶ carrier
                                                     │
      apps/telephony/webhooks.py ◀── callbacks ──────┘
                    ├─ verify signature         < 5 ms
                    ├─ read Redis call state    < 5 ms
                    ├─ plan + render TwiML      < 5 ms   ← no Postgres writes
                    └─ enqueue ─────▶ events queue ──▶ durable persistence,
                                                       channel release, KPIs,
                                                       websocket fan-out
```

The two things worth internalising:

1. **The pacer is the only place that authorises a dial.** Dispatch workers
   scale horizontally without multiplying the rate limit, because the limit
   lives in Redis, not in a process.
2. **Nothing writes to Postgres inside the carrier's critical path.** A slow
   query would become dropped calls, not a slow dashboard.

---

## Repository map

| Path | What lives there | Spec |
|---|---|---|
| `config/` | settings, Celery routing + beat, ASGI, URLs | §3.1 |
| `apps/common/` | `TenantModel` + tenancy guard, enums, Redis keys, errors | §4.2 |
| `apps/accounts/` | `Organization`, `User`, API keys, RBAC, audit log | §12.4 |
| `apps/contacts/` | `Contact`, `ContactList`, `ConsentRecord`, ingest pipeline | §4.3, §5 |
| `apps/compliance/` | DNC, calling windows, suppression gate, scrub, retention | §4.4, §5.4, §7.4, §12.5 |
| `apps/ivr/` | flow DSL, publish validator, orchestrator, renderers, call state, TTS | §4.5, §6 |
| `apps/campaigns/` | campaigns, work queue, **the pacer**, lifecycle services | §4.6, §7.3 |
| `apps/dialer/` | token bucket, channel semaphore, provider adapters, `place_call` | §7 |
| `apps/telephony/` | signatures, webhook views, event normaliser, AMD, partitions | §4.7, §8, §9 |
| `apps/telemetry/` | Redis counters, flusher, Channels consumer | §10 |
| `deploy/` | Dockerfile, compose, nginx, entrypoint, **OPERATIONS.md** | §13 |
| `DECISIONS.md` | every inference made for the truncated spec sections | — |
| `COMPLIANCE.md` | what the code enforces, and what it explicitly does not | §12 |

---

## The load-bearing pieces

**`apps/dialer/limits.py`** — the two independent limits. CPS is a *rate*;
concurrent channels is a *level*. A dialer controlling only one will eventually
breach the other. Both fail closed: if Redis is unreachable, nothing dials.
Read the module docstring for why Celery's `rate_limit` cannot be the primary
control.

**`apps/campaigns/pacer.py`** — the whole pacing decision in one readable
function. Channel headroom is checked before tokens are consumed, so a campaign
sitting at its ceiling does not silently burn its CPS allowance.

**`apps/compliance/services.py`** — the pre-dial gate. Suppression is checked
at ingest (advisory) and again immediately before the dial (authoritative),
because a list uploaded on Monday and dialled on Friday has accumulated new
opt-outs. Only the *negative* result is cached; opt-outs write through
synchronously.

**`apps/ivr/dsl.py` + `validators.py`** — a fixed set of node types, no code
execution, and every outward reference (audio, transfer target) is an id
resolved against a tenant-owned table rather than a URL. That is what stops a
flow from being an SSRF or toll-fraud primitive. `tests/test_flow_validator.py`
tests those surfaces directly.

**`apps/telephony/events.py`** — three independent idempotency mechanisms,
because none of them is sufficient alone: a Redis dedupe key catches literal
duplicates, a unique constraint catches what the cache missed, and a monotonic
status rank catches *reordering*.

---

## What is wired, and what is an integration point

Implemented end to end:

- contact ingest, normalisation, dedupe, suppression join, rejects export
- consent capture, revocation, erasure (hash-preserving)
- flow authoring, publish-time validation, TTS pre-render, versioning
- pacing, dispatch, both limiters, retries with backoff and per-day caps
- webhook ingestion, IVR traversal, DTMF, transfer, opt-out, AMD voicemail drop
- KPI counters, 5-second flusher, websocket fan-out with tenant authorisation
- the full REST surface, RBAC, throttling, audit log
- partition provisioning and retention-driven drops

Deliberately left as marked integration points, because guessing at them
produces code that *looks* like it works:

| Where | Why |
|---|---|
| `compliance.tasks._fetch_scrub_numbers` | Federal DNC SAN and litigator vendors each have their own contract, file format and cadence |
| `campaigns.tasks.refresh_caller_id_reputation` | Reputation data comes from the analytics engines under contract; there is no reliable free API |
| `compliance/models.NpaJurisdiction` | Needs the NANPA dataset — load with `manage.py load_npa_jurisdictions` |
| US state calling windows | No state table ships; see `apps/compliance/windows.py` for why |

Each raises or logs explicitly rather than silently doing nothing.

---

## Configuration worth knowing about

| Setting | Effect |
|---|---|
| `PHONE_HASH_PEPPER` | Peppers every `phone_hash`. **Rotating it orphans every suppression record.** Treat as permanent |
| `TENANCY_STRICT` | Unscoped tenant queryset raises (default on in dev) instead of logging critical |
| `GLOBAL_CPS_CEILING` / `GLOBAL_CHANNEL_CEILING` | Platform-wide clamps applied on top of per-org and per-campaign limits |
| `WEBHOOK_IP_ALLOWLIST` | Carrier CIDRs. Empty disables the check; signatures still apply |
| `WEBHOOK_VERIFY_SIGNATURES` | Only togglable in dev, and it warns loudly when off |
| `CALL_EVENT_RETENTION_DAYS` | Drives which raw-event partitions get dropped |

`config/settings/prod.py` refuses to boot on a missing secret, a
still-default pepper, or a non-HTTPS `PUBLIC_BASE_URL`.

---

## Websocket contract (§10.4)

Connect to `wss://…/ws/campaigns/{campaign_id}/?token=<api_key>`.

Server → client:

```jsonc
{"type": "kpi.snapshot", "payload": { /* full frame, sent on connect */ }}
{"type": "kpi.tick",     "payload": { /* same shape, on every flush */ }, "ts": "…"}
{"type": "pong"}
{"type": "error", "payload": {"code": "unknown_action", "action": "…"}}
```

Client → server: `{"action": "ping"}` · `{"action": "refresh"}`

Frame shape (`apps/telemetry/counters.py::build_frame` is the single source of
truth — rates are computed server-side so every consumer agrees on what
"answer rate" means):

```jsonc
{
  "campaign_id": "…",
  "dialed": 4210, "answered": 1180, "human": 902, "machine": 278,
  "busy": 140, "no_answer": 2600, "failed": 90, "suppressed": 12,
  "transferred": 88, "opted_out": 31, "confirmed": 640, "voicemail": 210,
  "duration_seconds": 41230, "live_channels": 27,
  "dtmf": {"1": 640, "2": 140, "9": 31},
  "dispositions": {"confirmed": 640, "transferred": 88, "opted_out": 31},
  "rates": {"answer": 0.2803, "human": 0.2142, "machine": 0.2356,
            "transfer": 0.0746, "opt_out": 0.0263}
}
```

Close codes: `4001` unauthenticated · `4003` forbidden (cross-tenant) ·
`4004` unknown campaign.

---

## Reading order for a new engineer

1. `apps/dialer/limits.py` — the constraint the whole system is built around
2. `apps/campaigns/pacer.py` — the one place that authorises a dial
3. `apps/compliance/services.py` and `windows.py` — the gates
4. `apps/telephony/webhooks.py` — the latency budget and why it exists
5. `apps/ivr/dsl.py` — what a flow can and cannot express
6. `DECISIONS.md` — where this implementation had to make a judgement call
7. `COMPLIANCE.md` — what is enforced in code and what is not

---

## Compliance notice

This platform places automated outbound voice calls, an activity that is
heavily regulated in many jurisdictions. The controls in `COMPLIANCE.md` are
necessary but not sufficient: they do not substitute for legal review of your
consent model, your scripts and your retention policy. Nothing in this
repository is legal advice.
