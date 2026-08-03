"""
Campaign lifecycle: preflight, launch, pause, resume, stop (spec 11.1).

Launching a campaign is the most consequential button in the product — it
starts spending money and calling real people — so the preflight is
deliberately strict and its failures are specific enough to act on.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignContact, CampaignStats
from apps.common.enums import CampaignStatus, ConsentScope, QueueState
from apps.common.exceptions import CampaignStateError, ComplianceError

logger = logging.getLogger("ivr.dialer")

BUILD_BATCH = 5_000


# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
def preflight(campaign) -> dict:
    """
    Everything that must be true before a campaign may run.

    Returns {"ok": bool, "errors": [...], "warnings": [...], "estimate": {...}}.
    Errors block the launch; warnings are surfaced and the operator decides.
    """
    errors: list[dict] = []
    warnings: list[dict] = []

    org = campaign.organization
    if org.is_suspended:
        errors.append({"code": "org_suspended", "message": org.suspension_reason
                       or "Organisation is suspended."})

    # --- Flow -----------------------------------------------------------
    version = campaign.flow_version
    if not version.is_published:
        errors.append({"code": "flow_not_published",
                       "message": "Pinned flow version is not published."})
    if not version.prompts_rendered_at:
        warnings.append({
            "code": "prompts_not_rendered",
            "message": "Flow prompts have not been pre-rendered; the first calls "
                       "will fall back to live speech synthesis.",
        })
    report = version.validation_report or {}
    for warning in report.get("warnings", []):
        warnings.append({"code": f"flow_{warning['code']}",
                         "message": warning["message"]})

    if (campaign.amd_enabled and campaign.voicemail_node
            and campaign.voicemail_node not in (version.definition.get("nodes") or {})):
            errors.append({"code": "bad_voicemail_node",
                           "message": f"voicemail_node '{campaign.voicemail_node}' "
                                      "is not a node in the pinned flow."})
    if campaign.record_calls and not campaign.recording_disclosure_node:
        errors.append({
            "code": "no_recording_disclosure",
            "message": "Call recording is enabled but no disclosure node is set.",
        })

    # --- Caller ID ------------------------------------------------------
    caller = campaign.caller_id
    if not caller.is_active:
        errors.append({"code": "caller_id_inactive",
                       "message": "Selected caller ID is not active."})
    if caller.attestation != "A":
        warnings.append({
            "code": "attestation_below_a",
            "message": f"Caller ID has attestation {caller.attestation}. Calls will "
                       "be more likely to be labelled or blocked than under full "
                       "attestation.",
        })
    if caller.reputation_score is not None and caller.reputation_score < 0.5:
        warnings.append({"code": "poor_reputation",
                         "message": "Caller ID reputation is degraded; consider "
                                    "rotating the number."})

    # --- Consent --------------------------------------------------------
    if campaign.consent_scope == ConsentScope.MARKETING and not campaign.requires_consent:
        errors.append({
            "code": "consent_gate_disabled",
            "message": "A marketing campaign cannot disable the consent gate.",
        })
    if org.require_consent_for_marketing and not campaign.requires_consent:
        errors.append({
            "code": "org_requires_consent",
            "message": "This organisation requires a consent gate on every campaign.",
        })

    # --- Targeting ------------------------------------------------------
    list_ids = list(campaign.contact_lists.values_list("id", flat=True))
    if not list_ids:
        errors.append({"code": "no_lists", "message": "No contact lists selected."})

    estimate = {"total": 0, "reachable": 0, "suppressed": 0}
    if list_ids:
        from apps.contacts.models import Contact

        total = Contact.objects.unscoped().filter(contact_list_id__in=list_ids).count()
        suppressed = (
            Contact.objects.unscoped()
            .filter(contact_list_id__in=list_ids, is_suppressed=True)
            .count()
        )
        estimate = {"total": total, "reachable": total - suppressed,
                    "suppressed": suppressed}
        if total == 0:
            errors.append({"code": "empty_lists",
                           "message": "Selected lists contain no contacts."})
        elif estimate["reachable"] == 0:
            errors.append({"code": "nothing_reachable",
                           "message": "Every contact in the selected lists is "
                                      "suppressed."})
        elif suppressed / total > 0.3:
            warnings.append({
                "code": "high_suppression",
                "message": f"{suppressed} of {total} contacts are suppressed.",
            })

    # --- Pacing ---------------------------------------------------------
    if campaign.cps_limit > org.max_cps:
        warnings.append({
            "code": "cps_clamped",
            "message": f"cps_limit {campaign.cps_limit} exceeds the organisation "
                       f"ceiling {org.max_cps} and will be clamped.",
        })
    if campaign.max_concurrent_channels > org.max_concurrent_channels:
        warnings.append({
            "code": "channels_clamped",
            "message": "max_concurrent_channels exceeds the organisation ceiling "
                       "and will be clamped.",
        })

    # --- Window ---------------------------------------------------------
    if campaign.window_start_local >= campaign.window_end_local:
        errors.append({"code": "empty_window",
                       "message": "Calling window start is not before its end."})
    if not campaign.active_weekdays:
        warnings.append({"code": "all_weekdays",
                         "message": "No weekday restriction set; the campaign will "
                                    "dial seven days a week."})

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "estimate": estimate,
    }


# ---------------------------------------------------------------------------
# Queue construction
# ---------------------------------------------------------------------------
def build_queue(campaign) -> int:
    """
    Materialise the per-campaign work queue.

    Suppressed contacts are excluded here *and* re-checked at dial time. This
    is not redundant: excluding them now keeps the claim index small, and
    re-checking then catches everything that changed in between.
    """
    from apps.contacts.models import Contact

    list_ids = list(campaign.contact_lists.values_list("id", flat=True))
    if not list_ids:
        return 0

    created = 0
    queryset = (
        Contact.objects.unscoped()
        .filter(contact_list_id__in=list_ids, is_suppressed=False)
        .order_by("id")
        .values_list("id", flat=True)
        .iterator(chunk_size=BUILD_BATCH)
    )

    from apps.common.utils import chunked

    for batch in chunked(queryset, BUILD_BATCH):
        rows = [
            CampaignContact(
                organization_id=campaign.organization_id,
                campaign=campaign,
                contact_id=contact_id,
                state=QueueState.PENDING,
            )
            for contact_id in batch
        ]
        with transaction.atomic():
            CampaignContact.objects.bulk_create(
                rows, batch_size=1000, ignore_conflicts=True
            )
        created += len(rows)

    Campaign.objects.unscoped().filter(pk=campaign.pk).update(
        queue_built_at=timezone.now()
    )
    stats, _ = CampaignStats.objects.unscoped().get_or_create(
        campaign=campaign,
        defaults={"organization_id": campaign.organization_id},
    )
    CampaignStats.objects.unscoped().filter(pk=stats.pk).update(
        total_contacts=created
    )
    return created


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------
def start(campaign, *, user=None, force: bool = False) -> Campaign:
    if campaign.status not in {CampaignStatus.DRAFT, CampaignStatus.SCHEDULED,
                               CampaignStatus.PAUSED, CampaignStatus.THROTTLED}:
        raise CampaignStateError(
            detail=f"Cannot start a campaign in state '{campaign.status}'."
        )

    checks = preflight(campaign)
    if not checks["ok"]:
        raise ComplianceError(detail=checks)
    if checks["warnings"] and not force:
        # Warnings do not block, but they must be acknowledged explicitly so
        # that "nobody told me the caller ID had a C attestation" is not a
        # thing anyone gets to say later.
        raise ComplianceError(
            detail={**checks,
                    "message": "Launch has warnings; resubmit with force=true to "
                               "acknowledge."}
        )

    if campaign.queue_built_at is None:
        build_queue(campaign)

    with transaction.atomic():
        updated = Campaign.objects.unscoped().filter(
            pk=campaign.pk, status=campaign.status
        ).update(
            status=CampaignStatus.RUNNING,
            started_at=campaign.started_at or timezone.now(),
            pause_reason="",
        )
    if not updated:
        raise CampaignStateError(detail="Campaign state changed concurrently.")

    from apps.ivr.tasks import warm_flow_cache

    warm_flow_cache.delay(str(campaign.flow_version_id))

    campaign.refresh_from_db()
    logger.info("campaign started", extra={"campaign": str(campaign.pk)})
    return campaign


def pause(campaign, *, reason: str = "", user=None) -> Campaign:
    """
    Stop placing new calls. Calls already in flight run to completion.

    Hanging up live calls on pause would be worse than useless: the caller is
    mid-sentence, the disposition is lost, and the number gets re-dialled later
    for a conversation it already had.
    """
    if campaign.status not in {CampaignStatus.RUNNING, CampaignStatus.THROTTLED}:
        raise CampaignStateError(
            detail=f"Cannot pause a campaign in state '{campaign.status}'."
        )
    Campaign.objects.unscoped().filter(pk=campaign.pk).update(
        status=CampaignStatus.PAUSED, pause_reason=reason[:160]
    )
    campaign.refresh_from_db()
    logger.info("campaign paused", extra={"campaign": str(campaign.pk),
                                          "reason": reason})
    return campaign


def resume(campaign, *, user=None) -> Campaign:
    if campaign.status not in {CampaignStatus.PAUSED, CampaignStatus.THROTTLED}:
        raise CampaignStateError(
            detail=f"Cannot resume a campaign in state '{campaign.status}'."
        )
    return start(campaign, user=user, force=True)


def stop(campaign, *, hangup_live: bool = False, user=None) -> Campaign:
    """
    Terminal stop. Optionally tears down calls that are still up.

    `hangup_live` exists for the compliance case — a script found to be
    non-compliant mid-broadcast — where finishing the calls in flight is worse
    than dropping them.
    """
    if campaign.status in {CampaignStatus.COMPLETED, CampaignStatus.STOPPED}:
        return campaign

    Campaign.objects.unscoped().filter(pk=campaign.pk).update(
        status=CampaignStatus.STOPPED, completed_at=timezone.now()
    )
    CampaignContact.objects.unscoped().filter(
        campaign=campaign, state__in=[QueueState.PENDING, QueueState.DIALING]
    ).update(state=QueueState.EXHAUSTED, claimed_at=None)

    if hangup_live:
        _hangup_live_calls(campaign)

    from apps.telemetry.tasks import flush_campaign_counters

    flush_campaign_counters.delay(str(campaign.pk))
    campaign.refresh_from_db()
    logger.info("campaign stopped", extra={"campaign": str(campaign.pk),
                                           "hangup_live": hangup_live})
    return campaign


def _hangup_live_calls(campaign):
    from apps.common.enums import LIVE_CALL_STATES
    from apps.dialer.tasks import hangup_call
    from apps.telephony.models import CallLog

    sids = (
        CallLog.objects.unscoped()
        .filter(campaign=campaign, status__in=list(LIVE_CALL_STATES))
        .exclude(provider_call_sid__startswith="pending:")
        .values_list("provider_call_sid", flat=True)
    )
    for sid in sids:
        hangup_call.delay(campaign.effective_provider, sid)


def schedule_retry(queue_row, campaign, *, status: str) -> bool:
    """
    Decide whether a finished call earns another attempt.

    Returns True when a retry was scheduled. The backoff is exponential on the
    configured base delay, and the daily cap is enforced separately from the
    total cap because "three attempts" and "three attempts today" are very
    different promises to the person being called.
    """
    if status not in (campaign.retry_on_statuses or []):
        return False
    if queue_row.attempts >= campaign.max_attempts:
        return False


    delay = campaign.retry_delay_minutes * (
        campaign.retry_backoff_factor ** max(0, queue_row.attempts - 1)
    )
    next_at = timezone.now() + timezone.timedelta(minutes=delay)

    if _attempts_today(campaign, queue_row) >= campaign.max_attempts_per_day:
        # Push to the start of tomorrow's window rather than to "now + delay",
        # which would just bounce off the window check repeatedly.
        next_at = max(next_at, _tomorrow_window_open(campaign, queue_row))

    CampaignContact.objects.unscoped().filter(pk=queue_row.pk).update(
        state=QueueState.PENDING, next_attempt_at=next_at, claimed_at=None
    )
    return True


def _attempts_today(campaign, queue_row) -> int:
    from apps.telephony.models import CallLog

    start_of_day = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        CallLog.objects.unscoped()
        .filter(campaign=campaign, contact_id=queue_row.contact_id,
                created_at__gte=start_of_day)
        .count()
    )


def _tomorrow_window_open(campaign, queue_row):
    import datetime as dt

    tomorrow = timezone.now() + dt.timedelta(days=1)
    start = campaign.window_start_local
    return tomorrow.replace(hour=start.hour, minute=start.minute, second=0,
                            microsecond=0)
