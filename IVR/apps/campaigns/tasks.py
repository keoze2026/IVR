"""Campaign background tasks: the beat tick, scheduling, housekeeping."""

from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from apps.campaigns.models import Campaign
from apps.campaigns.pacer import acquire_tick_lock, pace, release_tick_lock
from apps.common.enums import CampaignStatus

logger = logging.getLogger("ivr.dialer")


@shared_task(name="campaigns.pacer_tick", queue="pacer", expires=2)
def pacer_tick():
    """
    Fan out one pace_campaign task per running campaign, once a second.

    This task deliberately does no work of its own beyond one indexed query
    against the partial index on status='running', so its runtime is
    independent of how many contacts those campaigns hold.
    """
    campaign_ids = list(
        Campaign.objects.unscoped()
        .filter(status=CampaignStatus.RUNNING)
        .values_list("id", flat=True)
    )
    for campaign_id in campaign_ids:
        pace_campaign.apply_async(args=[str(campaign_id)], queue="pacer", expires=5)
    return len(campaign_ids)


@shared_task(name="campaigns.pace_campaign", queue="pacer", expires=5)
def pace_campaign(campaign_id: str):
    """One pacing tick for one campaign, guarded by a short Redis lock."""
    if not acquire_tick_lock(campaign_id):
        # Previous tick still running, or beat double-fired. Skipping is
        # correct: the next tick is one second away.
        return {"campaign": campaign_id, "reason": "locked"}

    try:
        campaign = (
            Campaign.objects.unscoped()
            .select_related("organization", "caller_id")
            .get(pk=campaign_id)
        )
        report = pace(campaign)
        if report["dispatched"]:
            logger.debug("paced", extra=report)
        return report
    except Campaign.DoesNotExist:
        return {"campaign": campaign_id, "reason": "gone"}
    finally:
        release_tick_lock(campaign_id)


@shared_task(name="campaigns.promote_scheduled", queue="maintenance")
def promote_scheduled():
    """
    Start campaigns whose scheduled_start has arrived, and stop those past
    scheduled_end.

    Preflight runs again at promotion time, not only at the point the operator
    scheduled it: a list can be emptied, a caller ID deactivated or a flow
    unpublished in the days between scheduling and starting.
    """
    from apps.campaigns.services import start, stop
    from apps.common.exceptions import ComplianceError

    now = timezone.now()
    started, stopped, blocked = 0, 0, []

    due = Campaign.objects.unscoped().filter(
        status=CampaignStatus.SCHEDULED, scheduled_start__lte=now
    ).select_related("organization", "caller_id", "flow_version")
    for campaign in due:
        try:
            start(campaign, force=True)
            started += 1
        except ComplianceError as exc:
            blocked.append({"campaign": str(campaign.pk), "detail": exc.detail})
            Campaign.objects.unscoped().filter(pk=campaign.pk).update(
                status=CampaignStatus.FAILED,
                pause_reason="Preflight failed at scheduled start",
            )
            logger.warning("scheduled campaign blocked by preflight",
                           extra={"campaign": str(campaign.pk)})

    expired = Campaign.objects.unscoped().filter(
        status__in=[CampaignStatus.RUNNING, CampaignStatus.THROTTLED,
                    CampaignStatus.PAUSED],
        scheduled_end__isnull=False,
        scheduled_end__lte=now,
    ).select_related("organization", "caller_id")
    for campaign in expired:
        stop(campaign)
        stopped += 1

    return {"started": started, "stopped": stopped, "blocked": blocked}


@shared_task(name="campaigns.build_queue", queue="maintenance")
def build_queue_task(campaign_id: str):
    from apps.campaigns.services import build_queue

    campaign = Campaign.objects.unscoped().get(pk=campaign_id)
    return {"created": build_queue(campaign)}


@shared_task(name="campaigns.recover_throttled", queue="maintenance")
def recover_throttled(max_age_minutes: int = 5):
    """
    Bring throttled campaigns back after the carrier has had time to settle.

    Deliberately conservative: THROTTLED means the carrier told us we were
    going too fast, and the correct response is to wait, not to immediately
    re-test the limit at the same rate.
    """
    cutoff = timezone.now() - timezone.timedelta(minutes=max_age_minutes)
    recovered = 0
    for campaign in Campaign.objects.unscoped().filter(
        status=CampaignStatus.THROTTLED, updated_at__lte=cutoff
    ):
        Campaign.objects.unscoped().filter(pk=campaign.pk).update(
            status=CampaignStatus.RUNNING,
            pause_reason="",
            # Halve the configured rate on recovery; an operator who wants the
            # original rate back can set it explicitly.
            cps_limit=max(0.1, campaign.cps_limit / 2),
        )
        recovered += 1
        logger.info("campaign recovered from throttle",
                    extra={"campaign": str(campaign.pk)})
    return {"recovered": recovered}


@shared_task(name="campaigns.refresh_caller_id_reputation", queue="maintenance")
def refresh_caller_id_reputation():
    """
    Refresh number reputation scores.

    Left as an integration point rather than a stub that pretends to work:
    reputation data comes from the analytics engines (or a reseller in front of
    them) under contract, and there is no free, reliable API to guess at. The
    honest version of reputation management is in the README.
    """
    from apps.campaigns.models import CallerID

    stale = CallerID.objects.unscoped().filter(is_active=True).count()
    logger.info("caller id reputation refresh is not wired to a provider",
                extra={"caller_ids": stale})
    return {"checked": 0, "eligible": stale}
