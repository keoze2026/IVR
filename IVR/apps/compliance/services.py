"""
The suppression gate (spec 5.4).

Checked twice: once at ingest (advisory, so the operator sees the real
reachable count before spending money) and once immediately before dial
(authoritative). The second check is non-optional — a list uploaded on Monday
and dialled on Friday will have accumulated new opt-outs.
"""

from __future__ import annotations

import logging

from django.core.cache import caches
from django.db.models import Q
from django.utils import timezone

from apps.common.enums import SuppressionReason
from apps.common.utils import phone_hash
from apps.compliance.models import DNCEntry

logger = logging.getLogger("ivr.compliance")

redis_cache = caches["dnc"]
DNC_TTL = 300


def bulk_suppression_check(org_id, phone_hashes: list[str]) -> dict[str, str]:
    """Return {phone_hash: reason} for every suppressed number in the batch."""
    if not phone_hashes:
        return {}
    rows = (
        DNCEntry.objects.unscoped()
        .filter(
            Q(organization_id=org_id) | Q(is_global=True),
            phone_hash__in=phone_hashes,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .values_list("phone_hash", "reason")
    )
    return dict(rows)


def is_dialable(org_id, campaign, contact) -> tuple[bool, str]:
    """Authoritative pre-dial gate. Cheap path first, expensive path last."""
    key = f"{org_id}:{contact.phone_hash}"
    cached = redis_cache.get(key)
    if cached is not None:
        return (False, cached) if cached else _consent_gate(org_id, campaign, contact)

    hit = (
        DNCEntry.objects.unscoped()
        .filter(
            Q(organization_id=org_id) | Q(is_global=True),
            phone_hash=contact.phone_hash,
        )
        .filter(Q(scope_campaign__isnull=True) | Q(scope_campaign=campaign))
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .values_list("reason", flat=True)
        .first()
    )

    if hit:
        redis_cache.set(key, hit, DNC_TTL)
        return False, hit

    # Only the *negative* result is cached. A positive suppression is written
    # through immediately by record_opt_out(), so a cached "clean" answer can
    # never outlive an opt-out by more than the round trip of that delete.
    redis_cache.set(key, "", DNC_TTL)
    return _consent_gate(org_id, campaign, contact)


def _consent_gate(org_id, campaign, contact) -> tuple[bool, str]:
    """
    Consent gate. Informational campaigns may be exempt; marketing never is.

    Deliberately not cached: consent is the control that carries legal weight,
    it is cheap (one partial-index lookup), and a stale cache here is the one
    failure mode with statutory damages attached.
    """
    if not campaign.requires_consent:
        return True, ""

    from apps.contacts.models import ConsentRecord

    has_consent = (
        ConsentRecord.objects.unscoped()
        .filter(
            organization_id=org_id,
            phone_hash=contact.phone_hash,
            revoked_at__isnull=True,
            scope=campaign.consent_scope,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .exists()
    )
    if not has_consent:
        return False, SuppressionReason.NO_CONSENT
    return True, ""


def invalidate_suppression_cache(org_id, digest: str) -> None:
    """Drop the negative cache entry for one number, synchronously.

    Called by the opt-out handler *before* it returns TwiML, so the caller's
    "press 9 to stop" has taken effect by the time the call ends.
    """
    redis_cache.delete(f"{org_id}:{digest}")


def record_opt_out(
    org_id,
    e164: str,
    *,
    reason: str = SuppressionReason.IVR_OPT_OUT,
    call=None,
    scope_campaign=None,
    notes: str = "",
) -> DNCEntry:
    """
    Write a suppression and make it effective immediately.

    Ordering matters: the DNC row is committed, then the cache key is deleted,
    then the contact rows are flagged. If the process dies between steps the
    worst outcome is a redundant flag pass, never a live cache entry claiming a
    suppressed number is clean.
    """
    digest = phone_hash(e164) if e164 else None
    if digest is None:
        raise ValueError("record_opt_out requires a phone number")

    entry, _created = DNCEntry.objects.unscoped().update_or_create(
        organization_id=org_id,
        phone_hash=digest,
        scope_campaign=scope_campaign,
        defaults={
            "phone_e164": e164,
            "reason": reason,
            "source_call": call,
            "notes": notes,
        },
    )

    invalidate_suppression_cache(org_id, digest)

    from apps.contacts.models import Contact

    Contact.objects.unscoped().filter(
        organization_id=org_id, phone_hash=digest, is_suppressed=False
    ).update(
        is_suppressed=True,
        suppression_reason=reason,
        suppressed_at=timezone.now(),
    )

    # Stop any queued attempts for this number across every running campaign.
    from apps.campaigns.models import CampaignContact
    from apps.common.enums import QueueState

    qs = CampaignContact.objects.unscoped().filter(
        organization_id=org_id,
        contact__phone_hash=digest,
        state__in=[QueueState.PENDING, QueueState.DIALING],
    )
    if scope_campaign is not None:
        qs = qs.filter(campaign=scope_campaign)
    qs.update(state=QueueState.SUPPRESSED, final_disposition="suppressed")

    logger.info(
        "opt-out recorded",
        extra={"reason": reason, "org": str(org_id), "scoped": bool(scope_campaign)},
    )
    return entry


def revoke_consent(org_id, e164: str, *, channel: str = "ivr") -> int:
    """Mark every active consent record for a number as revoked."""
    from apps.contacts.models import ConsentRecord

    return (
        ConsentRecord.objects.unscoped()
        .filter(
            organization_id=org_id,
            phone_hash=phone_hash(e164),
            revoked_at__isnull=True,
        )
        .update(revoked_at=timezone.now(), revocation_channel=channel)
    )


def suppression_preview(org_id, contact_list_id) -> dict:
    """
    What a campaign against this list would actually reach, right now.

    Used by the launch preflight so an operator sees the damage before they
    press start rather than in the first minute of dialling.
    """
    from apps.contacts.models import Contact

    total = Contact.objects.unscoped().filter(contact_list_id=contact_list_id).count()
    suppressed = (
        Contact.objects.unscoped()
        .filter(contact_list_id=contact_list_id, is_suppressed=True)
        .count()
    )
    hashes = list(
        Contact.objects.unscoped()
        .filter(contact_list_id=contact_list_id, is_suppressed=False)
        .values_list("phone_hash", flat=True)[:50_000]
    )
    newly = bulk_suppression_check(org_id, hashes)
    return {
        "total": total,
        "already_suppressed": suppressed,
        "newly_suppressed": len(newly),
        "reachable": max(0, total - suppressed - len(newly)),
        "sampled": len(hashes),
    }
