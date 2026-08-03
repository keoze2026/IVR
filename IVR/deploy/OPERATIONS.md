# Operations

Covers spec §13.2 (alerting) and §13.3 (load expectations). The process
topology in §13.1 is expressed in [`entrypoint.sh`](entrypoint.sh) and
[`docker-compose.yml`](docker-compose.yml).

## Process topology

| Role | Replicas (starting point) | Scales with | Notes |
|---|---|---|---|
| `web` | 2+ | API request rate | Runs migrations on deploy; set `RUN_MIGRATIONS=0` on all others |
| `asgi` | 2 | concurrent dashboards | Long-lived sockets; separate from `web` so idle sockets don't eat request workers |
| `beat` | **exactly 1** | — | Two schedulers means two pacer ticks per second. Enforce singleton |
| `pacer` | 2 | number of concurrently running campaigns | Tiny tasks; must never queue |
| `dispatch` | 2–8 | aggregate CPS | Each task is one blocking carrier call |
| `events` | 2–6 | CPS × callbacks per call (≈4) | Absorbs carrier retry bursts |
| `telemetry` | 1–2 | number of open dashboards | Droppable under load |
| `maintenance` | 1–2 | ingest volume | Long time limits; keep concurrency low |

`beat` being a singleton is load-bearing. Everything else is safe to run at any
replica count because the pacing decision is centralised in Redis, not in a
process.

## Alerting

Alert on the things that mean *calls are wrong*, not on the things that mean a
graph moved.

### Page immediately

| Condition | Why |
|---|---|
| `pacer` queue depth > 50 for 30s | Ticks are backing up; campaigns are dialling late or not at all |
| Webhook 5xx rate > 1% over 1 min | Callers are hearing dead air right now |
| Webhook p99 latency > 2s | The carrier is about to start treating responses as failures |
| Redis unreachable from any dispatch worker | Both limiters fail closed — dialling stops entirely |
| `dialer.reconcile_live_channels` released > 20% of channels | Callbacks are being lost at scale |
| Any campaign at `THROTTLED` for > 15 min | The carrier is refusing traffic and nobody has looked |
| `ComplianceIncident` created | Something that should have been impossible happened |
| Partition for next month missing | Every raw-event insert will fail on the 1st |

### Investigate next morning

| Condition | Why |
|---|---|
| Answer rate drops > 30% day over day for a caller ID | Number is being labelled; rotate it |
| AMD false-machine rate > 5% | Humans are being hung up on |
| `sweep_stuck_calls` finding > 10 calls per run | Systematic callback loss |
| Ingest reject rate > 10% for a list | Upstream data quality problem |
| `cost_reconciled = false` older than 6 hours | Carrier billing feed is stale |

### Metrics worth having

Exported as Prometheus gauges/counters (`django-prometheus` is already in
`requirements.txt`; the custom gauges below are the ones that matter):

```
ivr_live_channels{campaign}          gauge    ChannelSemaphore.live()
ivr_cps_configured{campaign}         gauge    Campaign.effective_cps()
ivr_cps_actual{campaign}             counter  place_call successes, rate()
ivr_token_bucket_denials{campaign}   counter  pace() reason="no_tokens"
ivr_channel_denials{campaign}        counter  pace() reason="no_channel_headroom"
ivr_webhook_latency_seconds{view}    histogram
ivr_webhook_signature_failures       counter
ivr_queue_depth{queue}               gauge    Celery queue lengths
ivr_suppression_blocks{reason}       counter  is_dialable() denials
```

`ivr_cps_actual` versus `ivr_cps_configured` is the single most useful panel on
the dashboard: a sustained gap means something upstream of the carrier is the
bottleneck, and a sustained overshoot means the limiter is not working.

## Load expectations

Rough figures for one campaign at 20 CPS with a 60-second average call:

| Quantity | Value | Derivation |
|---|---|---|
| Calls placed | 72,000/hour | 20 × 3600 |
| Live channels at steady state | ~1,200 | 20 CPS × 60s |
| Carrier callbacks | ~80/s | 4 per call minimum |
| Webhook requests (incl. IVR turns) | ~120/s | + one per DTMF turn |
| Raw event rows | ~290k/hour | one per callback |
| Call log rows | 72k/hour | |
| Redis ops | ~600/s | counters, state, dedupe |

A 500k-contact campaign at three attempts produces up to 1.5M call rows and
roughly 8M event rows — which is why events are partitioned monthly and dropped
by partition rather than deleted.

Note that 1,200 live channels is far above the default per-campaign ceiling of
30 and above `GLOBAL_CHANNEL_CEILING`. That is intentional: the ceilings are
sized for the compliance envelope, not for the theoretical throughput. Raising
them is a commercial and carrier-capacity decision, not a code change.

### Where it breaks first

1. **Carrier CPS** — long before anything in this stack. That is the point.
2. **`events` queue** — 4 callbacks per call at high CPS is the highest-volume
   path in the system. Scale replicas before scaling anything else.
3. **Postgres write throughput on `call_logs`** — mitigated by keeping the
   webhook path write-free and batching KPI flushes.
4. **Redis** — one round trip per keypress. Watch `used_memory` on the call
   state DB; 4-hour TTLs bound it, but a stuck campaign can hold a lot of
   hashes.

## Runbook fragments

**Campaign is dialling too fast.** Pause it. `cps_limit` changes do not apply
retroactively to tokens already granted, but the bucket refills at the new rate
within a second of the change.

**Dashboard numbers look wrong.** Redis counters are a view, not the record.
`POST /api/v1/campaigns/{id}/rebuild-stats/` recomputes them from `call_logs`.

**Channels leaked after an incident.** `dialer.reconcile_live_channels` runs
every 60s and rebuilds the set from Postgres. To force it:
`celery -A config call dialer.reconcile_live_channels`.

**Carrier is returning 429s.** Campaigns move to `THROTTLED` automatically.
`campaigns.recover_throttled` brings them back at half the configured rate; it
is not on the beat schedule by default because the right response to sustained
throttling is a human deciding whether the rate was ever appropriate.
