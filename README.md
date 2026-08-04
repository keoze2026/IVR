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
pacer, work queue) · `dialer` (token bucket, channel semaphore, provider
adapters) · `telephony` (webhooks, signature validation, AMD, call records) ·
`telemetry` (KPI counters, WebSocket fan-out).

See [`IVR/README.md`](./IVR/README.md) for the reading order,
[`IVR/DECISIONS.md`](./IVR/DECISIONS.md) for why things are the way they are,
and [`IVR/deploy/OPERATIONS.md`](./IVR/deploy/OPERATIONS.md) for running it.

### Frontend

A Vite SPA plus a thin Hono BFF. The BFF holds the API key server-side and
gives the browser a session cookie, so no credential ever reaches the client
and CORS never enters the picture. See
[`docs/FRONTEND-ARCHITECTURE.md`](./docs/FRONTEND-ARCHITECTURE.md).

**Current state: phase 1.** Auth, app shell, and the campaign list are built.
The campaign wizard, live dashboard, flow builder, call log, and compliance
screens are scaffolded routes that say so.

> **The backend is unmodified.** The portal is built against the API exactly as
> it stands at commit `cba8ef3`. Four things it needs are missing or broken
> there — including one defect that makes every write endpoint return 500 for
> API-key clients. Those are specified in
> [`docs/BACKEND-REQUIREMENTS.md`](./docs/BACKEND-REQUIREMENTS.md).

To look at the UI without a backend, `client/mock/upstream.mjs` is a fixture
server — the real login flow, fake data, no changes to shipping code.

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

### Frontend

```bash
cd client
cp .env.example .env    # SESSION_SECRET (32+ chars), IVR_API_BASE
npm install
npm run dev             # BFF :8787, Vite :5173
```

Open http://localhost:5173 and paste the API key.

### Checks

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
