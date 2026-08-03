"""
Celery application, queue routing and beat schedule.

Queue isolation is load-bearing, not cosmetic (spec 2.3): a 500k-row CSV ingest
must never sit in front of a place_call task. Each queue gets its own worker
pool with its own concurrency and prefetch settings — see deploy/.

Queues
------
pacer        one short task per RUNNING campaign per second; must never queue
dispatch     place_call; the only queue that talks to the carrier
events       webhook post-processing; bursty, must absorb carrier retries
telemetry    KPI rollups and websocket fan-out; droppable under load
maintenance  ingest, scrub, partition provisioning, reconciliation
"""

import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("ivr_platform")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------
app.conf.task_routes = {
    "campaigns.pacer_tick": {"queue": "pacer"},
    "campaigns.pace_campaign": {"queue": "pacer"},
    "campaigns.*": {"queue": "maintenance"},
    "dialer.place_call": {"queue": "dispatch"},
    "dialer.*": {"queue": "dispatch"},
    "telephony.persist_call_event": {"queue": "events"},
    "telephony.*": {"queue": "events"},
    "telemetry.*": {"queue": "telemetry"},
    "contacts.*": {"queue": "maintenance"},
    "compliance.*": {"queue": "maintenance"},
    "ivr.*": {"queue": "maintenance"},
}

app.conf.task_queues_order = ["pacer", "dispatch", "events", "telemetry", "maintenance"]

# A place_call that has been sitting in the queue for longer than this is
# worthless — the pacing decision that authorised it has expired. Better to
# drop it than to place a call outside the window it was cleared for.
app.conf.task_annotations = {
    "dialer.place_call": {"expires": 30, "time_limit": 30, "soft_time_limit": 20},
    "campaigns.pace_campaign": {"expires": 5, "time_limit": 10, "soft_time_limit": 5},
    "telephony.persist_call_event": {"time_limit": 60, "soft_time_limit": 45},
    "contacts.ingest_contact_file": {"time_limit": 7200, "soft_time_limit": 7000},
}


# ---------------------------------------------------------------------------
# Beat schedule
#
# The 1 Hz tick is a fan-out only: it reads the set of RUNNING campaigns and
# enqueues one pace_campaign task each. It never touches contacts itself, so
# its runtime is independent of campaign size.
# ---------------------------------------------------------------------------
app.conf.beat_schedule = {
    "pacer-tick": {
        "task": "campaigns.pacer_tick",
        "schedule": 1.0,
        "options": {"queue": "pacer", "expires": 2},
    },
    "flush-kpi-counters": {
        "task": "telemetry.flush_all_counters",
        "schedule": 5.0,
        "options": {"queue": "telemetry", "expires": 10},
    },
    "reconcile-live-channels": {
        "task": "dialer.reconcile_live_channels",
        "schedule": 60.0,
        "options": {"queue": "maintenance"},
    },
    "sweep-stuck-calls": {
        "task": "telephony.sweep_stuck_calls",
        "schedule": 120.0,
        "options": {"queue": "maintenance"},
    },
    "promote-scheduled-campaigns": {
        "task": "campaigns.promote_scheduled",
        "schedule": 30.0,
        "options": {"queue": "maintenance"},
    },
    "reconcile-call-costs": {
        "task": "telephony.reconcile_costs",
        "schedule": crontab(minute=17),
        "options": {"queue": "maintenance"},
    },
    "provision-partitions": {
        "task": "telephony.provision_partitions",
        "schedule": crontab(hour=3, minute=0),
        "options": {"queue": "maintenance"},
    },
    "drop-expired-partitions": {
        "task": "telephony.drop_expired_partitions",
        "schedule": crontab(hour=3, minute=30),
        "options": {"queue": "maintenance"},
    },
    "refresh-dnc-scrub": {
        "task": "compliance.refresh_external_scrub",
        "schedule": crontab(hour=4, minute=0),
        "options": {"queue": "maintenance"},
    },
    "apply-retention-policy": {
        "task": "compliance.apply_retention_policy",
        "schedule": crontab(hour=5, minute=0),
        "options": {"queue": "maintenance"},
    },
    "refresh-caller-id-reputation": {
        "task": "campaigns.refresh_caller_id_reputation",
        "schedule": crontab(hour=6, minute=0),
        "options": {"queue": "maintenance"},
    },
}


@app.task(bind=True, name="debug.ping")
def debug_ping(self):  # pragma: no cover - operational helper
    return {"task_id": self.request.id, "worker": self.request.hostname}
