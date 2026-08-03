"""
The dispatch task (spec 7.5).

Dispatch workers are dumb executors: by the time a task lands here the pacer
has already decided a call *may* be placed and has reserved a channel. What
this task still does is re-check the things that can change between the
pacing decision and the dial — suppression, campaign state, calling window —
because "the queue row was claimed 800ms ago" is not a defence.

Everything here is written so that a worker dying at any point leaks at most
one channel reservation for one reconciliation interval, and never places a
call it cannot account for.
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common.enums import (
    LIVE_CALL_STATES,
    CampaignStatus,
    Disposition,
    QueueState,
)
from apps.dialer.limits import ChannelSemaphore
from apps.dialer.providers import get_provider
from apps.dialer.providers.base import (
    OriginateRequest,
    ProviderCallError,
    ProviderRateLimited,
)

logger = logging.getLogger("ivr.dialer")


@shared_task(
    bind=True,
    name="dialer.place_call",
    queue="dispatch",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,  # retries are a campaign-level concept, not a Celery one
)
def place_call(self, queue_row_id: str, reservation: str):
    """Place one outbound call for one claimed queue row."""
    from apps.campaigns.models import CampaignContact
    from apps.compliance.services import is_dialable
    from apps.compliance.windows import is_within_window
    from apps.ivr import state as call_state
    from apps.telemetry.counters import incr
    from apps.telephony.models import CallLog

    row = (
        CampaignContact.objects.unscoped()
        .select_related("campaign", "campaign__caller_id", "campaign__organization",
                        "contact")
        .filter(pk=queue_row_id)
        .first()
    )
    if row is None:
        logger.warning("dispatch for unknown queue row", extra={"row": queue_row_id})
        return

    campaign, contact = row.campaign, row.contact
    semaphore = ChannelSemaphore(campaign.pk, campaign.effective_channels())

    def abandon(state: str, disposition: str = "", reason: str = ""):
        semaphore.release(reservation)
        CampaignContact.objects.unscoped().filter(pk=row.pk).update(
            state=state, final_disposition=disposition, claimed_at=None
        )
        if reason:
            logger.info("dial abandoned", extra={"reason": reason,
                                                 "campaign": str(campaign.pk)})

    # --- Re-checks ------------------------------------------------------
    if campaign.status != CampaignStatus.RUNNING:
        # Pause/stop between claim and dial. Return the row to the queue.
        abandon(QueueState.PENDING, reason="campaign_not_running")
        return

    if campaign.organization.is_suspended:
        abandon(QueueState.PENDING, reason="organization_suspended")
        return

    allowed, suppression_reason = is_dialable(campaign.organization_id, campaign, contact)
    if not allowed:
        incr(campaign.pk, "suppressed")
        abandon(QueueState.SUPPRESSED, Disposition.SUPPRESSED,
                reason=f"suppressed:{suppression_reason}")
        return

    window = is_within_window(campaign, contact)
    if not window.allowed:
        # Not an error — the pacer works on a claimed batch and a contact three
        # timezones east can fall out of window inside the same batch.
        CampaignContact.objects.unscoped().filter(pk=row.pk).update(
            state=QueueState.PENDING,
            next_attempt_at=window.next_open_at,
            claimed_at=None,
        )
        semaphore.release(reservation)
        return

    # --- Durable record before the dial ---------------------------------
    # The CallLog row exists before the carrier is called so that a callback
    # arriving before our own response is processed still has something to
    # attach to (the carrier is genuinely that fast on short-code routes).
    provider_name = campaign.effective_provider
    call = CallLog.objects.create(
        organization_id=campaign.organization_id,
        campaign=campaign,
        contact=contact,
        flow_version_id=campaign.flow_version_id,
        provider=provider_name,
        provider_call_sid=f"pending:{row.pk}",
        from_number=campaign.caller_id.phone_e164,
        to_number=contact.phone_e164,
        attempt_number=row.attempts + 1,
        stir_attestation=campaign.caller_id.attestation,
    )

    request = OriginateRequest(
        to=contact.phone_e164,
        from_=campaign.caller_id.phone_e164,
        answer_url=_url(f"/webhooks/{provider_name}/ivr/entry/?call={call.pk}"),
        status_callback_url=_url(f"/webhooks/{provider_name}/status/?call={call.pk}"),
        ring_timeout=campaign.ring_timeout_seconds,
        amd_enabled=campaign.amd_enabled,
        amd_mode=campaign.amd_mode,
        amd_async=campaign.amd_async,
        amd_timeout=campaign.amd_timeout_seconds,
        amd_callback_url=_url(f"/webhooks/{provider_name}/amd/?call={call.pk}"),
        record=campaign.record_calls,
        recording_callback_url=_url(
            f"/webhooks/{provider_name}/recording/?call={call.pk}"
        ),
        caller_name=campaign.caller_id.cnam_display,
    )

    provider = get_provider(provider_name)
    try:
        handle = provider.place_call(request)
    except ProviderRateLimited as exc:
        # The carrier is telling us our pacing is wrong. Believe it.
        logger.warning("carrier rate limited", extra={"campaign": str(campaign.pk)})
        _mark_throttled(campaign, str(exc))
        call.delete()
        CampaignContact.objects.unscoped().filter(pk=row.pk).update(
            state=QueueState.PENDING,
            next_attempt_at=timezone.now() + timezone.timedelta(
                seconds=max(1, int(getattr(exc, "retry_after", 1)))
            ),
            claimed_at=None,
        )
        semaphore.release(reservation)
        return
    except ProviderCallError as exc:
        _record_originate_failure(call, row, exc, semaphore, reservation)
        return

    # --- Success --------------------------------------------------------
    now = timezone.now()
    with transaction.atomic():
        CallLog.objects.unscoped().filter(pk=call.pk).update(
            provider_call_sid=handle.sid,
            status=provider.normalise_status(handle.status),
            initiated_at=now,
        )
        CampaignContact.objects.unscoped().filter(pk=row.pk).update(
            state=QueueState.DIALING,
            attempts=row.attempts + 1,
            last_attempt_at=now,
            claimed_at=now,
        )
        type(contact).objects.unscoped().filter(pk=contact.pk).update(
            last_called_at=now, total_attempts=contact.total_attempts + 1
        )

    # Re-key the reservation from the queue row to the call SID so the status
    # callback can release it without knowing which row it came from.
    semaphore.rename(reservation, handle.sid)

    # Snapshot everything the IVR will need, so no webhook has to touch
    # Postgres to render a prompt or decide where to go next.
    call_state.create(
        handle.sid,
        organization_id=str(campaign.organization_id),
        campaign_id=str(campaign.pk),
        contact_id=str(contact.pk),
        call_id=str(call.pk),
        flow_version_id=str(campaign.flow_version_id),
        queue_row_id=str(row.pk),
        provider=provider_name,
        to_number=contact.phone_e164,
        locale=(contact.variables or {}).get("locale", "en"),
        voicemail_node=campaign.voicemail_node,
        merge={
            **contact.merge_context(),
            "campaign_name": campaign.name,
            "organization_name": campaign.organization.name,
            "caller_id": campaign.caller_id.phone_e164,
        },
    )

    incr(campaign.pk, "dialed")
    _bump_caller_id_usage(campaign.caller_id_id)
    logger.info("call placed", extra={"campaign": str(campaign.pk), "sid": handle.sid})


def _url(path: str) -> str:
    return f"{settings.PUBLIC_BASE_URL.rstrip('/')}{path}"


def _record_originate_failure(call, row, exc, semaphore, reservation):
    from apps.campaigns.models import CampaignContact
    from apps.common.enums import CallStatus
    from apps.telemetry.counters import incr
    from apps.telephony.models import CallLog

    CallLog.objects.unscoped().filter(pk=call.pk).update(
        status=CallStatus.FAILED,
        error_code=exc.code,
        error_message=str(exc)[:500],
        ended_at=timezone.now(),
        disposition=Disposition.UNREACHABLE,
    )
    semaphore.release(reservation)
    incr(call.campaign_id, "failed")

    campaign = row.campaign
    attempts = row.attempts + 1
    if exc.retryable and attempts < campaign.max_attempts:
        next_at = timezone.now() + timezone.timedelta(
            minutes=campaign.retry_delay_minutes
        )
        CampaignContact.objects.unscoped().filter(pk=row.pk).update(
            state=QueueState.PENDING, attempts=attempts,
            last_attempt_at=timezone.now(), next_attempt_at=next_at, claimed_at=None,
        )
    else:
        CampaignContact.objects.unscoped().filter(pk=row.pk).update(
            state=QueueState.FAILED, attempts=attempts,
            last_attempt_at=timezone.now(),
            final_disposition=Disposition.UNREACHABLE, claimed_at=None,
        )
    logger.warning("originate failed", extra={"code": exc.code,
                                              "retryable": exc.retryable})


def _mark_throttled(campaign, reason: str):
    from apps.campaigns.models import Campaign

    Campaign.objects.unscoped().filter(
        pk=campaign.pk, status=CampaignStatus.RUNNING
    ).update(status=CampaignStatus.THROTTLED, pause_reason=reason[:160])


def _bump_caller_id_usage(caller_id_id):
    from django.db.models import Case, F, IntegerField, Value, When

    from apps.campaigns.models import CallerID

    today = timezone.localdate()
    # Resets to 1 on the first call of a new day rather than needing a separate
    # midnight job to zero the counter.
    CallerID.objects.unscoped().filter(pk=caller_id_id).update(
        calls_today=Case(
            When(calls_today_date=today, then=F("calls_today") + 1),
            default=Value(1),
            output_field=IntegerField(),
        ),
        calls_today_date=today,
    )


@shared_task(name="dialer.reconcile_live_channels", queue="maintenance")
def reconcile_live_channels():
    """
    Rebuild every running campaign's channel set from Postgres.

    The semaphore trims entries older than four hours by itself, but a call
    that ended after ninety seconds and whose completion callback was lost
    would otherwise hold a channel for the rest of those four hours. This is
    the cheap periodic correction: one indexed query per running campaign
    against the partial index on live call states.
    """
    from apps.campaigns.models import Campaign
    from apps.telephony.models import CallLog

    reconciled = {}
    campaigns = Campaign.objects.unscoped().filter(
        status__in=[CampaignStatus.RUNNING, CampaignStatus.THROTTLED]
    ).select_related("organization")

    for campaign in campaigns:
        live = set(
            CallLog.objects.unscoped()
            .filter(campaign=campaign, status__in=list(LIVE_CALL_STATES))
            .exclude(provider_call_sid__startswith="pending:")
            .values_list("provider_call_sid", flat=True)
        )
        semaphore = ChannelSemaphore(campaign.pk, campaign.effective_channels())
        leaked = semaphore.reconcile(live)
        if leaked:
            reconciled[str(campaign.pk)] = leaked
            logger.info("released leaked channels",
                        extra={"campaign": str(campaign.pk), "count": leaked})
    return reconciled


@shared_task(name="dialer.hangup_call", queue="dispatch")
def hangup_call(provider_name: str, sid: str):
    """Terminate a live call — used by the stop-campaign path and the sweeper."""
    try:
        get_provider(provider_name).hangup(sid)
    except ProviderCallError as exc:
        logger.warning("hangup failed", extra={"sid": sid, "code": exc.code})
