# Outbound IVR & Voice Automation Platform

High-volume outbound voice campaigns through a CPaaS carrier (Twilio
Programmable Voice / Telnyx TeXML): plays audio, collects DTMF through a
configurable IVR tree, optionally bridges to a live agent over SIP, and
streams per-call disposition telemetry to an operator dashboard in real time.

The design goal is not raw throughput. Any competent engineer can push 500
calls per second at a carrier; the carrier then rate-limits you, the analytics
engines tag your numbers "Spam Likely", and your answer rate collapses within
48 hours. The goal is **sustained, deliverable throughput under a hard
compliance envelope**, and every architectural decision is subordinate to that.

> **Compliance.** This platform places automated outbound calls, which is
> heavily regulated — specifically so in the United States. The controls in
> `IVR/COMPLIANCE.md` are enforced in code and are necessary but not
> sufficient. They do not substitute for legal review of your consent model,
> your scripts, or your retention policy.

---

## Layout

| Path | What it is |
|---|---|
| [`IVR/`](./IVR) | Django 5.2 backend — DRF, Celery, Channels, PostgreSQL 16, Redis 7 |
| [`client/`](./client) | React + TypeScript operator portal, and the BFF that fronts it |
| [`docs/`](./docs) | Cross-cutting docs: API gaps, frontend architecture |

### Backend

Eight apps, each mapping to a section of the specification:

`accounts` (tenancy, RBAC, API keys, audit) · `contacts` (ingest, E.164
normalisation, dedupe) · `compliance` (DNC, consent, calling windows) ·
`ivr` (flow DSL, validator, runtime, TwiML rendering) · `campaigns` (lifecycle,
pacer, work queue) · `dialer` (token bucket, channel semaphore, multi-carrier failover,
circuit breaker, provider adapters) · `telephony` (webhooks, signature validation,
carrier health API, AMD, call records) · `telemetry` (KPI counters, WebSocket fan-out).

See [`IVR/README.md`](./IVR/README.md) for the reading order,
[`IVR/DECISIONS.md`](./IVR/DECISIONS.md) for why things are the way they are,
and [`IVR/deploy/OPERATIONS.md`](./IVR/deploy/OPERATIONS.md) for running it.

### Frontend

A Vite SPA plus a thin Hono BFF. The BFF holds the credential server-side and
gives the browser a session cookie, so no credential ever reaches the client
and CORS never enters the picture.

**Design.** A dark theme: a faint grid backdrop, glass cards with lit edges and a
teal-to-sky glow for actions and the current screen. Headings are set in Space
Grotesk, text in Plus Jakarta Sans. Colours, radius, surfaces and table style are
defined once in `client/src/index.css`; shared components are in
`client/src/components/ui/` and icons in `client/src/components/icons.tsx`.

**Screens.** The sidebar has three groups: Operations (Campaigns, Flows,
Contact Lists), Analytics (Dashboard, Calls, Jobs, CDR) and Infrastructure (My
Numbers, Audio Pools, CLI Pools, Wallets, Tariffs), with account capacity and
Settings below. Compliance, People and Access keys are not on the staff sidebar.
The administration portal at `/admin` uses the same design.

To look at the UI without a backend, run `npm run demo` in `client/`.
`client/mock/upstream.mjs` is a fixture server with fake data.

---

## Running it

### Backend

```bash
cd IVR
python -m venv .venv && . .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                            # fill in SECRET_KEY, PHONE_HASH_PEPPER

python manage.py makemigrations                 # models are the source of truth
python manage.py migrate
python manage.py bootstrap_org --name "Dev" --slug dev --email dev@local
python manage.py runserver
```

`bootstrap_org` prints an `ivrk_…` API key **once**. Keep it — you cannot look
it up again.

Or bring the whole stack up:

```bash
docker compose -f IVR/deploy/docker-compose.yml up
```

### Carriers

Telnyx needs four values in `IVR/.env`:

| Variable | What it is |
|---|---|
| `TELNYX_API_KEY` | API key from the Telnyx portal |
| `TELNYX_PUBLIC_KEY` | Public key used to verify Telnyx webhooks |
| `TELNYX_ACCOUNT_SID` | Telnyx account (user) ID |
| `TELNYX_CONNECTION_ID` | TeXML Application ID |

`IVR/scripts/telnyx_setup.py`, run on the server, asks for the API key and
fills in these values.

The answering-machine detection timeout is converted from seconds to the
milliseconds Telnyx expects.

Toll-free (+1 8xx) destinations are routed to `TOLL_FREE_PROVIDER`
(default `telnyx`) and never to Twilio. This routing and the Telnyx call path
have not yet been verified with a real call.

### Frontend

```bash
cd client
cp .env.example .env    # SESSION_SECRET (32+ chars), IVR_API_BASE
npm install
npm run dev             # BFF :8787, Vite :5173
```

Open http://localhost:5173 and paste the API key.

### Adding a phone number

In the portal, open **Numbers**, type the number, choose the carrier and press
**Add number** (owner role). The number must already be yours at that carrier.

### Checks

`kombu` is pinned to 5.6.2 (5.7.0 needs redis-py 6.1 or later). A green CI run
does not currently prove the tests passed: check the log for `FAILED`.

```bash
cd IVR    && pytest              # backend
cd client && npm run typecheck && npm test && npm run build
```

---

## Where to start reading

**Backend engineer:** [`docs/BACKEND-REQUIREMENTS.md`](./docs/BACKEND-REQUIREMENTS.md)
— the prioritised spec for what the portal needs, with suggested patches.

**Frontend engineer:** [`docs/FRONTEND-ARCHITECTURE.md`](./docs/FRONTEND-ARCHITECTURE.md)
— the portal's architecture and conventions.

**Either:** [`docs/API-GAPS.md`](./docs/API-GAPS.md) — the gap catalogue, plus
backend behaviour that will otherwise be mistaken for a frontend bug.
[`IVR/README.md`](./IVR/README.md) is the backend's own tour.

---

## ⚠️ Security note

`IVR/.env` is **committed to this repository** with a live `DJANGO_SECRET_KEY`
and `PHONE_HASH_PEPPER`, and there is no `.gitignore` under `IVR/`, so 136
`.pyc` files are tracked too.

Both secrets should be rotated and the file untracked — but note that rotating
`PHONE_HASH_PEPPER` invalidates every stored `phone_hash`, which is what
suppression matching, cross-tenant DNC checks and erasure verification all run
on. Free on an empty database; **silently breaks DNC on a populated one**.

See [`docs/BACKEND-REQUIREMENTS.md`](./docs/BACKEND-REQUIREMENTS.md) §0.
