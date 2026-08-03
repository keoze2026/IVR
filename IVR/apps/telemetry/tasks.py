"""
The flusher and the websocket fan-out (spec 10.2).

Two separate concerns that are easy to conflate:

  flush     Redis counters → CampaignStats, every 5 seconds. Durability.
  broadcast Redis counters → websocket group, on change. Liveness.

They run at different rates on purpose. The dashboard should update the moment
a call completes; the database does not need to hear about it 80 times a
second.
"""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from celery import shared_task
from channels.layers import get_channel_layer
from django.utils import timezone

from apps.common.redis_clients import Keys
from apps.telemetry import counters

logger = logging.getLogger("ivr.dialer")


@shared_task(name="telemetry.flush_all_counters", queue="telemetry", expires=10)
def flush_all_counters():
    """Flush every campaign whose counters changed since the last run."""
    campaign_ids = counters.dirty_campaigns()
    for campaign_id in campaign_ids:
        flush_campaign_counters.apply_async(args=[campaign_id], queue="telemetry")
    return {"flushed": len(campaign_ids)}


@shared_task(name="telemetry.flush_campaign_counters", queue="telemetry")
def flush_campaign_counters(campaign_id: str):
    """
    Write one campaign's counters to CampaignStats.

    Absolute values, not deltas. A lost flush therefore costs nothing — the
    next one writes the correct total — whereas a delta-based flush that runs
    twice or not at all is permanently wrong.
    """
    from apps.campaigns.models import Campaign, CampaignStats

    stats = counters.snapshot(campaign_id)
    if not stats:
        counters.clear_dirty(campaign_id)
        return {"campaign": campaign_id, "result": "empty"}

    campaign = (
        Campaign.objects.unscoped()
        .filter(pk=campaign_id)
        .values("id", "organization_id")
        .first()
    )
    if campaign is None:
        counters.clear_dirty(campaign_id)
        counters.reset(campaign_id)
        return {"campaign": campaign_id, "result": "gone"}

    frame = counters.build_frame(campaign_id, stats)
    dispositions = frame["dispositions"]

    CampaignStats.objects.unscoped().update_or_create(
        campaign_id=campaign["id"],
        defaults={
            "organization_id": campaign["organization_id"],
            "dialed": frame["dialed"],
            "answered": frame["answered"],
            "human": frame["human"],
            "machine": frame["machine"],
            "no_answer": frame["no_answer"],
            "busy": frame["busy"],
            "failed": frame["failed"],
            "suppressed": frame["suppressed"],
            "transferred": dispositions.get("transferred", 0),
            "opted_out": dispositions.get("opted_out", 0),
            "confirmed": dispositions.get("confirmed", 0),
            "voicemail": dispositions.get("voicemail", 0),
            "dtmf_breakdown": frame["dtmf"],
            "total_duration_seconds": frame["duration_seconds"],
            "last_flushed_at": timezone.now(),
        },
    )
    counters.clear_dirty(campaign_id)
    _push(campaign_id, "kpi.tick", frame)
    return {"campaign": campaign_id, "result": "flushed"}


@shared_task(name="telemetry.broadcast_campaign_kpis", queue="telemetry")
def broadcast_campaign_kpis(campaign_id: str):
    """Push the current frame to the campaign's websocket group."""
    _push(campaign_id, "kpi.tick", counters.build_frame(campaign_id))


@shared_task(name="telemetry.broadcast_event", queue="telemetry")
def broadcast_event(campaign_id: str, event_type: str, payload: dict):
    """
    Push a discrete event (a single call's disposition, a state change).

    Kept separate from the KPI frame so the frontend can drive a live call feed
    without diffing aggregate counters to work out what happened.
    """
    _push(campaign_id, event_type, payload)


def _push(campaign_id, message_type: str, payload: dict):
    layer = get_channel_layer()
    if layer is None:  # pragma: no cover - no channel layer in some test runs
        return
    try:
        async_to_sync(layer.group_send)(
            Keys.channel_group(campaign_id),
            {
                "type": "campaign.message",
                "message_type": message_type,
                "payload": payload,
                "ts": timezone.now().isoformat(),
            },
        )
    except Exception:  # noqa: BLE001 - a dead dashboard must not break dialling
        logger.warning("websocket fan-out failed",
                       extra={"campaign": str(campaign_id)})


@shared_task(name="telemetry.rebuild_stats_from_calls", queue="maintenance")
def rebuild_stats_from_calls(campaign_id: str):
    """
    Recompute a campaign's counters from call_logs.

    The escape hatch for when Redis has lost counters (eviction, restart
    without AOF) and the dashboard is visibly wrong. Slow by design — a full
    scan of one campaign's calls — so it is operator-triggered, not scheduled.
    """
    from django.db.models import Count, Q, Sum

    from apps.common.enums import MACHINE_ANSWERS, AnsweredBy, CallStatus
    from apps.telephony.models import CallLog

    agg = CallLog.objects.unscoped().filter(campaign_id=campaign_id).aggregate(
        dialed=Count("id"),
        answered=Count("id", filter=Q(answered_at__isnull=False)),
        human=Count("id", filter=Q(answered_by=AnsweredBy.HUMAN)),
        machine=Count("id", filter=Q(answered_by__in=list(MACHINE_ANSWERS))),
        busy=Count("id", filter=Q(status=CallStatus.BUSY)),
        no_answer=Count("id", filter=Q(status=CallStatus.NO_ANSWER)),
        failed=Count("id", filter=Q(status=CallStatus.FAILED)),
        duration=Sum("duration_seconds"),
    )

    counters.reset(campaign_id)
    for field, value in agg.items():
        if value:
            counters.incr(campaign_id,
                          "duration_seconds" if field == "duration" else field,
                          int(value))

    flush_campaign_counters.delay(str(campaign_id))
    return agg
