"""Scrub, retention and reconciliation jobs (spec 5.1, 12.5)."""

from __future__ import annotations

import logging
from typing import NamedTuple

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common.utils import chunked, phone_hash
from apps.compliance.models import DNCEntry, ScrubJob

logger = logging.getLogger("ivr.compliance")


@shared_task(name="compliance.refresh_external_scrub", queue="maintenance")
def refresh_external_scrub(organization_id: str | None = None):
    """
    Pull external suppression sources and fold them into DNCEntry.

    Fans out one job per organisation so a single tenant's vendor outage does
    not block everyone else's scrub.
    """
    from apps.accounts.models import Organization

    if organization_id is None:
        org_ids = Organization.objects.filter(
            is_active=True, litigator_scrub_enabled=True
        ).values_list("id", flat=True)
        for oid in org_ids:
            refresh_external_scrub.delay(str(oid))
        return {"fanned_out": len(org_ids)}

    org = Organization.objects.get(pk=organization_id)
    job = ScrubJob.objects.create(
        organization=org,
        source=ScrubJob.Source.LITIGATOR,
        status=ScrubJob.Status.RUNNING,
        started_at=timezone.now(),
    )
    try:
        numbers = _fetch_scrub_numbers(org)
        result = apply_suppression_batch(
            org.id, numbers, reason="litigator", notes="vendor scrub"
        )
        job.records_processed = len(numbers)
        job.records_added = result.entries_added
        job.contacts_suppressed = result.contacts_flagged
        job.status = ScrubJob.Status.COMPLETED
    except NotImplementedError as exc:
        # No vendor wired up yet. Recorded rather than silently skipped, so the
        # "when did you last scrub" question has an honest answer.
        job.status = ScrubJob.Status.FAILED
        job.error_message = str(exc)
    except Exception as exc:  # noqa: BLE001
        job.status = ScrubJob.Status.FAILED
        job.error_message = f"{exc.__class__.__name__}: {exc}"
        logger.exception("scrub job failed", extra={"org": str(org.id)})
    finally:
        job.finished_at = timezone.now()
        job.save(update_fields=["records_processed", "records_added",
                                "contacts_suppressed", "status",
                                "error_message", "finished_at"])
    return {"job": str(job.id), "status": job.status}


def _fetch_scrub_numbers(org) -> list[str]:
    """
    Read this organisation's external suppression list.

    The vendor-specific parts — which registry, whose credential, how often —
    stay configuration, because they differ per contract and guessing at one
    produces code that only looks like it works. What every source has in
    common is that it ends in a file of phone numbers, and that part is
    implemented in `scrub_sources`.

    Configure exactly one of:

        SCRUB_SOURCE_DIR   directory the vendor's downloader writes into.
                           Preferred — no credential in this codebase.
        SCRUB_SOURCE_URL   https URL, optionally with SCRUB_SOURCE_TOKEN.
                           May contain {san} and {slug}, filled from the org.

    With neither set this still raises, and the ScrubJob still records the
    failure, so "when did you last scrub?" keeps an honest answer.
    """
    from apps.compliance import scrub_sources

    directory = getattr(settings, "SCRUB_SOURCE_DIR", "")
    url = getattr(settings, "SCRUB_SOURCE_URL", "")

    if directory:
        # Scope the read to this tenant. A shared drop directory that fed one
        # org's list to another would suppress the wrong contacts silently.
        patterns = [f"{org.slug}*", f"*{org.slug}*"]
        if org.dnc_san:
            patterns.append(f"*{org.dnc_san}*")
        return scrub_sources.from_directory(directory, patterns=patterns)

    if url:
        resolved = url.format(san=org.dnc_san or "", slug=org.slug)
        return scrub_sources.from_url(
            resolved, token=getattr(settings, "SCRUB_SOURCE_TOKEN", "")
        )

    raise NotImplementedError(
        "No external scrub source configured for this organisation. Set "
        "SCRUB_SOURCE_DIR or SCRUB_SOURCE_URL, or implement a vendor client "
        "here. Until then no external suppression list is being applied."
    )


class SuppressionResult(NamedTuple):
    """
    Two genuinely different numbers.

    ``entries_added`` is how much the suppression list itself grew.
    ``contacts_flagged`` is how many of *your* contacts that list matched.
    A scrub can add fifty thousand entries and flag none of them, which means
    it worked — not that it did nothing. Reporting one as the other makes a
    healthy scrub look like a broken one and vice versa.
    """

    entries_added: int
    contacts_flagged: int


def apply_suppression_batch(org_id, numbers: list[str], *, reason: str,
                            notes: str = "") -> SuppressionResult:
    """Insert a batch of suppressions and flag matching contacts."""
    from apps.contacts.models import Contact

    entries_added = 0
    contacts_flagged = 0
    for batch in chunked(numbers, 5_000):
        digests = [phone_hash(n) for n in batch]
        entries = [
            DNCEntry(
                organization_id=org_id,
                phone_e164=n,
                phone_hash=d,
                reason=reason,
                notes=notes,
            )
            for n, d in zip(batch, digests, strict=True)
        ]
        with transaction.atomic():
            # bulk_create's return value is unusable for counting on
            # PostgreSQL with ignore_conflicts (see DECISIONS.md item 6), so
            # the pre-existing rows are counted explicitly against the unique
            # index rather than inferred.
            already = DNCEntry.objects.unscoped().filter(
                organization_id=org_id, phone_hash__in=digests
            ).count()
            DNCEntry.objects.bulk_create(entries, batch_size=1000,
                                         ignore_conflicts=True)
            entries_added += len(set(digests)) - already

            contacts_flagged += Contact.objects.unscoped().filter(
                organization_id=org_id, phone_hash__in=digests, is_suppressed=False
            ).update(
                is_suppressed=True,
                suppression_reason=reason,
                suppressed_at=timezone.now(),
            )

        from apps.compliance.services import invalidate_suppression_cache

        for digest in digests:
            invalidate_suppression_cache(org_id, digest)
    return SuppressionResult(entries_added, contacts_flagged)


@shared_task(name="compliance.apply_retention_policy", queue="maintenance")
def apply_retention_policy():
    """
    Retention (spec 12.5).

    Three distinct clocks, because the data has three distinct justifications:

      recordings      shortest — highest sensitivity, lowest evidentiary value
      raw call events 90 days  — carrier dispute window
      consent records kept     — they are the defence; deleting them is
                                 destroying your own evidence

    Contacts are not deleted here. A contact stops being dialled by
    suppression, not by disappearing, and a deleted contact can be re-uploaded
    tomorrow with no memory of the opt-out.
    """
    from apps.telephony.models import CallLog

    now = timezone.now()
    results = {}

    recording_cutoff = now - timezone.timedelta(days=settings.RECORDING_RETENTION_DAYS)
    stale = (
        CallLog.objects.unscoped()
        .filter(created_at__lt=recording_cutoff)
        .exclude(recording_url="")
    )
    purged = 0
    for call in stale.iterator(chunk_size=500):
        try:
            _delete_recording(call)
            purged += 1
        except Exception:  # pragma: no cover
            logger.exception("failed to purge recording", extra={"call": str(call.pk)})
    results["recordings_purged"] = purged

    # Raw events are dropped by partition, not by DELETE — see
    # telephony.tasks.drop_expired_partitions.
    results["events"] = "handled by partition drop"
    return results


def _delete_recording(call):
    from apps.common.storage import delete_object

    if call.recording_key:
        delete_object(settings.S3_BUCKET_RECORDINGS, call.recording_key)
    type(call).objects.unscoped().filter(pk=call.pk).update(
        recording_url="", recording_key="", recording_purged_at=timezone.now()
    )


@shared_task(name="compliance.seed_default_windows", queue="maintenance")
def seed_default_windows(organization_id: str):
    """
    Give a new tenant the US federal window as a starting point.

    Only the federal ceiling is seeded. State overrides are the tenant's to
    configure after legal review — see the module docstring in windows.py for
    why no state table ships here.
    """
    from apps.compliance.models import CallingWindow

    CallingWindow.objects.unscoped().get_or_create(
        organization_id=organization_id,
        jurisdiction="US",
        defaults={
            "start_local": settings.US_FEDERAL_WINDOW_START,
            "end_local": settings.US_FEDERAL_WINDOW_END,
            "weekdays": [0, 1, 2, 3, 4, 5, 6],
            "holidays_blocked": True,
            "notes": "US federal default. Review state overrides with counsel.",
        },
    )
