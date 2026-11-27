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

**Design.** Light and flat: a pale blue canvas, white rounded cards with thin
borders and one blue for actions and the current screen, with no gradients.
Green, amber and red say how a call or job went. Set in Roboto. Colours, radius,
surfaces, menu rows and table style are defined once in `client/src/index.css`;
shared components are in `client/src/components/ui/`, the page frame (sidebar,
phone drawer and bottom bar) in `client/src/components/shell/`, and icons in
`client/src/components/icons.tsx`. On a phone, table rows show as cards.

**Installable apps.** The portal installs on a phone or computer as two apps:
"Outbound" (the operator portal) and "Admin" (`/admin`). Use **Install app** on a
sign-in screen or in the menu; on iPhone, Safari's Share then "Add to Home
Screen". Manifests, icons and the offline page are in `client/public/assets/pwa/`;
the service worker is served by `client/server/pwa.ts` at `/bff/sw.js`. It only
shows an offline page: no screens or call data are stored on the device, so an
internet connection is needed. Installing needs HTTPS (or localhost). A browser
may stop offering the Admin install once the Outbound app is installed on the same
device, so install Admin first where both are wanted. Sign-ins last 12 idle hours.

**Screens.** The sidebar has three groups: Operations (Campaigns, Flows,
Contact Lists), Analytics (Dashboard, Calls, Jobs, CDR) and Infrastructure (My
Numbers, Audio Pools, CLI Pools, Wallets, Tariffs), with account capacity and
Settings below. Compliance, People and Access keys are not on the staff sidebar.
The Jobs and Active Jobs screens ask for up to 200 jobs, because the server's
default is 25 in no set order; Jobs lists the newest first.

**Create Job options.** "Tries per number" (1-5) redials busy and unanswered
numbers after the chosen gap. A job that includes a US number says who is
calling and offers "press 9" to stop; set `QUICK_DIAL_US_OPT_OUT=false` to turn
that off. One job holds up to about 14,000 numbers. "Spoken voice" picks a female
(default) or male voice for typed messages. "If a machine answers" hangs up
(default) or leaves the message; this has not been verified on a real call.

**Connecting to a person.** An administrator registers the numbers under System
administration, Scripts, Transfer numbers. They can then be chosen for a key in
Create Job, or as "Transfer To" on a transfer step in the flow builder. The agent
sees the job's caller ID unless the number sets its own. Calls can only be
connected to registered numbers. Not yet verified on a real call.

**Calls Trend.** The dashboard charts calls per day for the last 7, 30 or 90 days
on the viewer's clock, from `GET /api/v1/calls/trend/?days=7&tz=...`, counted over
every call. The other dashboard figures still use the latest page of calls.

**Starting a job** from the Jobs screen shows any launch warnings first.

**Call report.** The CDR screen has "Download CSV" for owners, administrators
and compliance officers: up to 50,000 calls, newest first, numbers masked.

**Carrier limits.** When every carrier line is busy, the number goes back in the
queue and is retried after a few seconds. A campaign the carrier slows down
resumes by itself after about a minute.

**Alerts and backups.** On the server, `IVR/deploy/monitor.sh` checks the site,
webhook, services, disk and backup age every five minutes and sends a message
when something breaks or recovers; put a Telegram bot or a Slack/Discord webhook
in `/etc/ivr-monitor.env`. `IVR/deploy/backup-daily.sh` writes a verified
database backup each night to `/root/ivr-backups` and keeps two weeks. It runs on
the same server, so also copy backups elsewhere (`BACKUP_REMOTE`) and use an
outside uptime service.

**Live updates.** While a tab is visible, call, campaign, contact list, flow,
number, wallet and admin list screens fetch fresh data every 5 seconds
(`client/src/lib/live.ts`); Jobs uses 4 seconds and Active Jobs 2. Screens with
an editable form do not. The campaign live screen also uses a websocket, which
accepts both API keys and name-and-code sign-ins.

**Calling hours for new jobs.** A job made with Create Job reads each number's
country and timezone from the number itself, so its calling window, and the
holidays that block it, are the called person's. US numbers are also held to
08:00-21:00 local time. US toll-free numbers have no location and use Central
time. Jobs created before this keep their old values.

**Spoken text on Telnyx.** English messages are sent with the voice `woman` and
accent `en-US`, set in `IVR/apps/ivr/renderers.py`.

**Recordings.** Twilio and Telnyx recordings are copied into the platform's own
storage, which is what the CDR's play button streams. For Telnyx calls whose
recording was not copied, run `python manage.py copy_telnyx_recordings`.

The administration portal at `/admin` uses the same design; its home page shows
headline figures and bar charts built from the record counts. On a phone it has a
bottom bar with Home, People, Campaigns and More.

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
