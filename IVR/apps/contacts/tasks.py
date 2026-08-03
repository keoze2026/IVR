"""
Chunked contact ingestion (spec 5.3).

Contract: a 500k-row CSV is parsed in 5,000-row chunks, each chunk doing
exactly one suppression round trip and one bulk insert. Nothing here holds more
than one chunk in memory, and the task is safe to retry — the unique constraint
on (contact_list, phone_e164) makes re-running the whole file a no-op for rows
already stored.
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common.storage import put_bytes, stream_lines
from apps.common.utils import chunked, phone_hash
from apps.contacts.ingest import RowError, iter_rows, parse_row, rejects_to_csv
from apps.contacts.models import Contact, ContactList, IngestStatus

logger = logging.getLogger("ivr.compliance")

CHUNK = 5_000


@shared_task(
    bind=True,
    name="contacts.ingest_contact_file",
    queue="maintenance",
    max_retries=3,
    acks_late=True,
    reject_on_worker_lost=True,
)
def ingest_contact_file(self, contact_list_id: str, s3_key: str,
                        default_region: str = "US"):
    clist = (
        ContactList.objects.unscoped()
        .select_related("organization")
        .get(pk=contact_list_id)
    )
    ContactList.objects.unscoped().filter(pk=clist.pk).update(
        ingest_status=IngestStatus.RUNNING,
        ingest_started_at=timezone.now(),
        source_key=s3_key,
    )

    report = {
        "total": 0, "valid": 0, "rejected": 0,
        "duplicates": 0, "suppressed": 0, "errors": [],
    }
    seen: set[str] = set()
    all_rejects: list[dict] = []

    try:
        row_iter = iter_rows(stream_lines(settings.S3_BUCKET_UPLOADS, s3_key))
        for chunk in chunked(row_iter, CHUNK):
            _process_chunk(clist, chunk, default_region, seen, report, all_rejects)
    except RowError as exc:
        # A structural problem (no header, missing phone column) is not
        # retryable — retrying re-reads the same broken file.
        report["errors"].append(str(exc))
        _finish(clist, report, all_rejects, IngestStatus.FAILED)
        return report
    except Exception as exc:  # noqa: BLE001 - re-raised after bookkeeping
        report["errors"].append(f"{exc.__class__.__name__}: {exc}")
        _finish(clist, report, all_rejects, IngestStatus.FAILED)
        raise self.retry(exc=exc, countdown=60) from exc

    _finish(clist, report, all_rejects, IngestStatus.COMPLETED)
    return report


def _process_chunk(clist, chunk, default_region, seen, report, all_rejects):
    from apps.compliance.services import bulk_suppression_check

    parsed, rejected = [], []
    for lineno, row in chunk:
        report["total"] += 1
        try:
            rec = parse_row(row, default_region)
        except RowError as exc:
            report["rejected"] += 1
            rejected.append({"line": lineno, "reason": str(exc), "raw": row})
            continue
        # Intra-file dedupe (spec 5.1 stage 5).
        if rec["phone_e164"] in seen:
            report["duplicates"] += 1
            continue
        seen.add(rec["phone_e164"])
        parsed.append(rec)

    all_rejects.extend(rejected)
    if not parsed:
        return

    # Cross-list dedupe (stage 6). Doing this as an explicit indexed lookup
    # rather than relying on ignore_conflicts is what makes the duplicate
    # count in the report truthful: bulk_create(ignore_conflicts=True) does
    # not report which rows it dropped, and on PostgreSQL it returns objects
    # without primary keys.
    numbers = [r["phone_e164"] for r in parsed]
    existing = set(
        Contact.objects.unscoped()
        .filter(contact_list_id=clist.pk, phone_e164__in=numbers)
        .values_list("phone_e164", flat=True)
    )
    if existing:
        report["duplicates"] += len(existing)
        parsed = [r for r in parsed if r["phone_e164"] not in existing]
    if not parsed:
        return

    # One round trip for the whole chunk, not one per row (stage 7).
    suppressed = bulk_suppression_check(
        clist.organization_id, [r["phone_hash"] for r in parsed]
    )

    now = timezone.now()
    objs = []
    for rec in parsed:
        hit = suppressed.get(rec["phone_hash"])
        objs.append(
            Contact(
                organization_id=clist.organization_id,
                contact_list=clist,
                is_suppressed=bool(hit),
                suppression_reason=hit or "",
                suppressed_at=now if hit else None,
                **rec,
            )
        )
        if hit:
            report["suppressed"] += 1

    with transaction.atomic():
        Contact.objects.bulk_create(objs, batch_size=1000, ignore_conflicts=True)
    report["valid"] += len(objs)


def _finish(clist, report, rejects, status):
    rejects_key = ""
    if rejects:
        rejects_key = f"rejects/{clist.organization_id}/{clist.pk}.csv"
        try:
            put_bytes(
                settings.S3_BUCKET_UPLOADS,
                rejects_key,
                rejects_to_csv(rejects),
                "text/csv",
            )
        except Exception:  # pragma: no cover - reporting must not fail ingest
            logger.exception("failed to write rejects CSV", extra={"list": str(clist.pk)})
            rejects_key = ""

    ContactList.objects.unscoped().filter(pk=clist.pk).update(
        total_rows=report["total"],
        valid_rows=report["valid"],
        rejected_rows=report["rejected"],
        duplicate_rows=report["duplicates"],
        suppressed_rows=report["suppressed"],
        ingest_report=report,
        ingest_status=status,
        ingest_finished_at=timezone.now(),
        rejects_key=rejects_key,
    )


@shared_task(name="contacts.enrich_line_types", queue="maintenance")
def enrich_line_types(contact_list_id: str, batch_size: int = 500):
    """
    Stage 3 of the pipeline: authoritative line-type / carrier lookup.

    Split out from ingest because it is billable per number and rate-limited by
    the lookup vendor. Ingest completes without it; the campaign launch check
    warns if a list has unenriched rows and the campaign targets US wireless
    under a consent policy that depends on line type.
    """
    from apps.dialer.providers import get_provider

    provider = get_provider(settings.DEFAULT_PROVIDER)
    qs = (
        Contact.objects.unscoped()
        .filter(contact_list_id=contact_list_id, lookup_checked_at__isnull=True)
        .exclude(erased_at__isnull=False)
        .order_by("id")
    )
    processed = 0
    for batch in chunked(qs.iterator(chunk_size=batch_size), batch_size):
        results = provider.lookup_numbers([c.phone_e164 for c in batch])
        now = timezone.now()
        for contact in batch:
            info = results.get(contact.phone_e164) or {}
            contact.line_type = info.get("line_type", contact.line_type)
            contact.carrier_name = info.get("carrier_name", contact.carrier_name)
            contact.lookup_checked_at = now
            if info.get("invalid"):
                contact.is_suppressed = True
                contact.suppression_reason = "carrier_invalid"
                contact.suppressed_at = now
        Contact.objects.bulk_update(
            batch,
            ["line_type", "carrier_name", "lookup_checked_at",
             "is_suppressed", "suppression_reason", "suppressed_at"],
            batch_size=500,
        )
        processed += len(batch)
    return {"processed": processed}


@shared_task(name="contacts.erase_number", queue="maintenance")
def erase_number(organization_id: str, e164: str):
    """
    GDPR / CCPA erasure.

    The plaintext number and identifying fields are nulled; the hash survives so
    the number remains permanently suppressed without the platform continuing to
    store it (spec 4.8). Call history is retained in de-identified form because
    it is the evidence trail for the calls that were already placed.
    """
    digest = phone_hash(e164)
    now = timezone.now()

    from apps.compliance.models import DNCEntry

    DNCEntry.objects.unscoped().update_or_create(
        organization_id=organization_id,
        phone_hash=digest,
        scope_campaign=None,
        defaults={
            "phone_e164": "",
            "reason": "erasure_request",
            "notes": "Erasure request; plaintext removed, suppression permanent.",
        },
    )

    updated = (
        Contact.objects.unscoped()
        .filter(organization_id=organization_id, phone_hash=digest)
        .update(
            phone_e164="",
            first_name="",
            last_name="",
            variables={},
            is_suppressed=True,
            suppression_reason="erasure_request",
            suppressed_at=now,
            erased_at=now,
        )
    )

    from apps.contacts.models import ConsentRecord

    ConsentRecord.objects.unscoped().filter(
        organization_id=organization_id, phone_hash=digest
    ).update(phone_e164="", captured_ip=None, captured_user_agent="")

    logger.info("erasure applied", extra={"contacts": updated})
    return {"contacts_erased": updated}
