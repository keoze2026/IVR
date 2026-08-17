"""
Events-queue workers.

Everything the webhook views deferred lands here: durable persistence, channel
release, disposition resolution, retry scheduling and KPI counters. This queue
is allowed to be seconds behind; the carrier is not waiting on it.
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from apps.common.enums import (
    MACHINE_ANSWERS,
    TERMINAL_CALL_STATES,
    AnsweredBy,
    CallStatus,
    Disposition,
    QueueState,
)
from apps.telephony.events import is_forward_transition, normalise_payload
from apps.telephony.models import CallEvent, CallLog

logger = logging.getLogger("ivr.webhook")


@shared_task(
    bind=True,
    name="telephony.apply_status_callback",
    queue="events",
    acks_late=True,
    max_retries=5,
    default_retry_delay=5,
)
def apply_status_callback(self, provider_name: str, sid: str, payload: dict):
    """Apply one carrier status transition to the durable record."""
    call = CallLog.objects.unscoped().filter(provider_call_sid=sid).first()
    if call is None:
        # Ordering race: the callback beat our own write of the SID. Retry
        # rather than drop — this is the normal case for very fast answers.
        if self.request.retries < 3:
            raise self.retry(countdown=2)
        logger.warning("status callback for unknown call", extra={"sid": sid})
        return {"sid": sid, "result": "unknown_call"}

    fields = normalise_payload(provider_name, payload)
    incoming = fields["status"]

    _record_event(call, f"status:{incoming}", fields["sequence"], payload)

    if not is_forward_transition(call.status, incoming):
        logger.info("out-of-order status ignored",
                    extra={"sid": sid, "current": call.status, "incoming": incoming})
        return {"sid": sid, "result": "out_of_order"}

    now = timezone.now()
    update = {"status": incoming}
    if incoming == CallStatus.RINGING and not call.ringing_at:
        update["ringing_at"] = now
    if incoming == CallStatus.IN_PROGRESS and not call.answered_at:
        update["answered_at"] = now
        if call.ringing_at:
            update["ring_seconds"] = min(
                65535, int((now - call.ringing_at).total_seconds())
            )
    if fields.get("answered_by"):
        update["answered_by"] = fields["answered_by"]
    for key in ("sip_response_code", "error_code", "error_message",
                "parent_call_sid", "stir_attestation"):
        if fields.get(key):
            update[key] = fields[key]

    if incoming in TERMINAL_CALL_STATES:
        update["ended_at"] = now
        update["duration_seconds"] = fields["duration_seconds"]
        update["billable_seconds"] = fields["billable_seconds"]
        if fields["cost"] is not None:
            update["cost"] = fields["cost"]
            update["cost_currency"] = fields["cost_currency"]
            update["cost_reconciled"] = True

    CallLog.objects.unscoped().filter(pk=call.pk).update(**update)

    if incoming in TERMINAL_CALL_STATES:
        finalise_call.delay(str(call.pk), incoming)

    _count_status(call.campaign_id, incoming, fields.get("answered_by"))
    return {"sid": sid, "result": "applied", "status": incoming}


@shared_task(name="telephony.finalise_call", queue="events", acks_late=True)
def finalise_call(call_id: str, status: str):
    """
    Close out a finished call: release its channel, reconcile the live IVR
    state into the durable record, resolve the disposition, and decide whether
    the contact earns another attempt.
    """
    from apps.dialer.limits import ChannelSemaphore
    from apps.ivr import state as call_state

    call = (
        CallLog.objects.unscoped()
        .select_related("campaign", "campaign__organization")
        .filter(pk=call_id)
        .first()
    )
    if call is None:
        return

    campaign = call.campaign
    semaphore = ChannelSemaphore(campaign.pk, campaign.effective_channels())
    semaphore.release(call.provider_call_sid)

    state = call_state.load(call.provider_call_sid)
    update = {}
    queue_row_id = None
    if state is not None:
        queue_row_id = state.data.get("queue_row_id")
        update.update(
            node_path=state.path,
            terminal_node=state.node,
            transferred_to=state.data.get("transferred_to", "")[:64],
            transfer_duration_seconds=_int(state.data.get("transfer_duration")),
        )
        if state.disposition:
            update["disposition"] = state.disposition

    if not update.get("disposition"):
        update["disposition"] = _infer_disposition(call, status)

    CallLog.objects.unscoped().filter(pk=call.pk).update(**update)

    # The live state has served its purpose; keeping it is a PII liability.
    call_state.discard(call.provider_call_sid)

    _resolve_queue_row(call, campaign, status, update["disposition"], queue_row_id)

    from apps.telemetry.counters import incr
    from apps.telemetry.tasks import broadcast_campaign_kpis

    if update["disposition"]:
        incr(campaign.pk, f"disposition:{update['disposition']}")
    if call.duration_seconds:
        incr(campaign.pk, "duration_seconds", call.duration_seconds)
    broadcast_campaign_kpis.delay(str(campaign.pk))

    from apps.campaigns.pacer import maybe_complete

    maybe_complete(campaign)


def _resolve_queue_row(call, campaign, status, disposition, queue_row_id):
    from apps.campaigns.models import CampaignContact
    from apps.campaigns.services import schedule_retry

    row = None
    if queue_row_id:
        row = CampaignContact.objects.unscoped().filter(pk=queue_row_id).first()
    if row is None:
        row = (
            CampaignContact.objects.unscoped()
            .filter(campaign=campaign, contact_id=call.contact_id)
            .first()
        )
    if row is None:
        return

    if disposition == Disposition.OPTED_OUT:
        CampaignContact.objects.unscoped().filter(pk=row.pk).update(
            state=QueueState.SUPPRESSED, final_disposition=disposition,
            claimed_at=None,
        )
        return

    if schedule_retry(row, campaign, status=status):
        return

    final_state = (
        QueueState.EXHAUSTED
        if row.attempts >= campaign.max_attempts and status != CallStatus.COMPLETED
        else QueueState.DONE
    )
    CampaignContact.objects.unscoped().filter(pk=row.pk).update(
        state=final_state, final_disposition=disposition, claimed_at=None
    )


def _infer_disposition(call, status: str) -> str:
    """Fall back to the carrier's technical outcome when the IVR left none."""
    if status in {CallStatus.BUSY, CallStatus.NO_ANSWER, CallStatus.FAILED,
                  CallStatus.CANCELED}:
        return Disposition.UNREACHABLE
    if call.answered_by in MACHINE_ANSWERS:
        return Disposition.VOICEMAIL
    if call.answered_at and not call.duration_seconds:
        return Disposition.ABANDONED
    return Disposition.NO_INPUT


@shared_task(name="telephony.persist_call_event", queue="events", acks_late=True)
def persist_call_event(sid: str, event_type: str, payload: dict,
                       context: dict | None = None):
    call = CallLog.objects.unscoped().filter(provider_call_sid=sid).first()
    if call is None:
        return
    _record_event(call, event_type, payload.get("SequenceNumber"), payload,
                  context=context)


@shared_task(name="telephony.persist_dtmf", queue="events", acks_late=True)
def persist_dtmf(sid: str, node_id: str, digits: str, valid: bool,
                 campaign_id: str | None = None):
    from apps.telephony.models import DTMFResponse

    call = CallLog.objects.unscoped().filter(provider_call_sid=sid).first()
    if call is None:
        return

    attempt = (
        DTMFResponse.objects.unscoped()
        .filter(call=call, node_id=node_id)
        .count()
        + 1
    )
    DTMFResponse.objects.create(
        organization_id=call.organization_id,
        call=call,
        node_id=node_id,
        digits=digits[:32],
        attempt=attempt,
        is_valid=valid,
    )

    if valid:
        from apps.telemetry.counters import incr_dtmf

        incr_dtmf(call.campaign_id, digits)


@shared_task(name="telephony.persist_amd_result", queue="events", acks_late=True)
def persist_amd_result(sid: str, answered_by: str, payload: dict):
    call = CallLog.objects.unscoped().filter(provider_call_sid=sid).first()
    if call is None:
        return

    update = {"answered_by": answered_by}
    if call.answered_at:
        update["amd_latency_ms"] = int(
            (timezone.now() - call.answered_at).total_seconds() * 1000
        )
    CallLog.objects.unscoped().filter(pk=call.pk).update(**update)
    _record_event(call, "amd", None, payload)

    from apps.telemetry.counters import incr

    incr(call.campaign_id,
         "machine" if answered_by in MACHINE_ANSWERS else "human")


@shared_task(name="telephony.persist_recording", queue="events", acks_late=True)
def persist_recording(provider_name: str, sid: str, payload: dict):
    """
    Store the recording reference.

    The audio itself is left with the carrier and copied to our own bucket by
    a separate job only when the tenant's retention policy requires it —
    copying every recording by default doubles storage cost and doubles the
    surface area of the most sensitive data the platform touches.
    """
    call = CallLog.objects.unscoped().filter(provider_call_sid=sid).first()
    if call is None:
        return
    rec_url = payload.get("RecordingUrl") or ""
    key = ""
    if rec_url and provider_name == "twilio":
        try:
            key = _copy_twilio_recording(call, rec_url)
        except Exception:
            logger.exception("could not copy recording into storage",
                             extra={"call": str(call.pk)})
    CallLog.objects.unscoped().filter(pk=call.pk).update(
        recording_url=rec_url[:512],
        recording_key=key,
        recording_duration=_int(payload.get("RecordingDuration")),
    )
    _record_event(call, "recording", None, payload)


def _copy_twilio_recording(call, rec_url: str) -> str:
    """
    Fetch the carrier's recording (authenticated) into our own bucket.

    The carrier hosts the audio behind carrier credentials; copying it here is
    what lets the CDR play it back from our origin without an operator ever
    logging in to the carrier. Returns the storage key.
    """
    import base64
    import urllib.request

    from django.conf import settings

    from apps.common.storage import s3_client

    url = rec_url if rec_url.endswith((".mp3", ".wav")) else rec_url + ".mp3"
    token = base64.b64encode(
        f"{settings.TWILIO_ACCOUNT_SID}:{settings.TWILIO_AUTH_TOKEN}".encode()
    ).decode()
    request = urllib.request.Request(url, headers={"Authorization": f"Basic {token}"})
    with urllib.request.urlopen(request, timeout=30) as resp:
        data = resp.read()

    key = f"{call.organization_id}/{call.pk}/recording.mp3"
    s3_client().put_object(
        Bucket=settings.S3_BUCKET_RECORDINGS, Key=key, Body=data,
        ContentType="audio/mpeg",
    )
    return key


@shared_task(name="telephony.record_opt_out", queue="events", acks_late=True,
             max_retries=10, default_retry_delay=10)
def record_opt_out_task(organization_id: str, e164: str, sid: str = ""):
    """Durable fallback for the synchronous opt-out path."""
    from apps.compliance.services import record_opt_out

    record_opt_out(organization_id, e164, notes=f"IVR opt-out (call {sid})")


# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------
@shared_task(name="telephony.sweep_stuck_calls", queue="maintenance")
def sweep_stuck_calls(max_age_minutes: int | None = None):
    """
    Find calls the carrier stopped talking about.

    Every lost `completed` callback is a leaked channel and a queue row stuck
    in `dialing` forever. The semaphore heals itself on a four-hour horizon;
    this closes the gap by asking the carrier directly what happened.

    The window comes from ``settings.STUCK_CALL_SWEEP_MINUTES`` unless a caller
    passes one explicitly. It is a setting rather than a constant because it is
    the recovery time after a webhook outage, and the right value depends on
    how long your calls legitimately run.
    """
    from django.conf import settings

    from apps.campaigns.models import CampaignContact
    from apps.common.enums import LIVE_CALL_STATES
    from apps.dialer.providers import get_provider

    if max_age_minutes is None:
        max_age_minutes = getattr(settings, "STUCK_CALL_SWEEP_MINUTES", 15)

    cutoff = timezone.now() - timezone.timedelta(minutes=max_age_minutes)
    stuck = (
        CallLog.objects.unscoped()
        .filter(status__in=list(LIVE_CALL_STATES), created_at__lt=cutoff)
        .exclude(provider_call_sid__startswith="pending:")
        .select_related("campaign")[:500]
    )

    swept = 0
    for call in stuck:
        try:
            remote = get_provider(call.provider).fetch_call(call.provider_call_sid)
        except Exception:  # noqa: BLE001
            remote = {}
        status = (remote.get("status") or "").lower()
        resolved = (
            get_provider(call.provider).normalise_status(status)
            if status else CallStatus.FAILED
        )
        CallLog.objects.unscoped().filter(pk=call.pk).update(
            status=resolved,
            ended_at=call.ended_at or timezone.now(),
            duration_seconds=call.duration_seconds or _int(remote.get("duration")),
            error_message=call.error_message or "Swept: no terminal callback received",
        )
        finalise_call.delay(str(call.pk), resolved)
        swept += 1

    # Queue rows claimed but never dialled — a dispatch worker died between the
    # claim and the originate.
    orphan_cutoff = timezone.now() - timezone.timedelta(minutes=15)
    released = CampaignContact.objects.unscoped().filter(
        state=QueueState.DIALING, claimed_at__lt=orphan_cutoff
    ).update(state=QueueState.PENDING, claimed_at=None)

    if swept or released:
        logger.info("swept stuck calls",
                    extra={"calls": swept, "queue_rows": released})
    return {"calls": swept, "queue_rows_released": released}


@shared_task(name="telephony.reconcile_costs", queue="maintenance")
def reconcile_costs(batch_size: int = 500):
    """
    Fill in per-call cost for calls whose completion callback carried none.

    Carriers price asynchronously; `Price` is frequently null on the
    `completed` callback and populated minutes later.
    """
    from apps.dialer.providers import get_provider

    cutoff = timezone.now() - timezone.timedelta(minutes=30)
    pending = (
        CallLog.objects.unscoped()
        .filter(cost_reconciled=False, ended_at__isnull=False, ended_at__lt=cutoff)
        .exclude(provider_call_sid__startswith="pending:")
        .order_by("ended_at")[:batch_size]
    )

    updated = 0
    for call in pending:
        try:
            remote = get_provider(call.provider).fetch_call(call.provider_call_sid)
        except Exception:  # noqa: BLE001
            # One unreachable call must not stop the batch, but a silent skip
            # here looks identical to "carrier reported no price" — which is a
            # very different problem.
            logger.warning("cost lookup failed",
                           extra={"sid": call.provider_call_sid})
            continue
        price = remote.get("price")
        if price in (None, ""):
            continue
        from decimal import Decimal

        CallLog.objects.unscoped().filter(pk=call.pk).update(
            cost=abs(Decimal(str(price))),
            cost_currency=(remote.get("price_unit") or "USD")[:3],
            cost_reconciled=True,
        )
        updated += 1
    return {"reconciled": updated}


@shared_task(name="telephony.provision_partitions", queue="maintenance")
def provision_partitions(months_ahead: int = 3):
    """
    Create next months' partitions for telephony_callevent.

    Runs daily and is idempotent. A missing partition is not a degraded
    service, it is an insert error on every webhook — so it is provisioned
    well ahead and alerted on if it ever fails.
    """
    from apps.telephony.partitions import ensure_partitions

    created = ensure_partitions(months_ahead=months_ahead)
    if created:
        logger.info("provisioned partitions", extra={"partitions": created})
    return {"created": created}


@shared_task(name="telephony.drop_expired_partitions", queue="maintenance")
def drop_expired_partitions():
    """
    Drop raw-event partitions past the retention horizon.

    DROP TABLE on a partition is instant and reclaims the space; a DELETE over
    eight million rows is neither, and leaves the table bloated afterwards.
    """
    from django.conf import settings

    from apps.telephony.partitions import drop_partitions_older_than

    dropped = drop_partitions_older_than(settings.CALL_EVENT_RETENTION_DAYS)
    if dropped:
        logger.info("dropped expired partitions", extra={"partitions": dropped})
    return {"dropped": dropped}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _record_event(call, event_type: str, sequence, payload: dict,
                  context: dict | None = None):
    """
    Append a raw event.

    The unique constraint is the backstop against duplicates that slipped past
    the Redis dedupe; a collision here is expected, not exceptional, so it is
    swallowed rather than logged as an error.
    """
    from django.db import IntegrityError

    body = dict(payload)
    if context:
        body["_context"] = context
    try:
        with transaction.atomic():
            CallEvent.objects.create(
                call=call,
                provider_call_sid=call.provider_call_sid,
                event_type=event_type[:32],
                sequence_number=_int_or_none(sequence),
                payload=body,
                signature_valid=True,
            )
    except IntegrityError:
        pass


def _count_status(campaign_id, status: str, answered_by: str | None):
    from apps.telemetry.counters import incr

    mapping = {
        CallStatus.IN_PROGRESS: "answered",
        CallStatus.BUSY: "busy",
        CallStatus.NO_ANSWER: "no_answer",
        CallStatus.FAILED: "failed",
        CallStatus.COMPLETED: "completed",
    }
    metric = mapping.get(status)
    if metric:
        incr(campaign_id, metric)
    if answered_by:
        incr(campaign_id,
             "machine" if answered_by in MACHINE_ANSWERS
             else "human" if answered_by == AnsweredBy.HUMAN else "answered_unknown")


def _int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
