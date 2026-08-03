"""Contacts and consent (spec 4.3)."""

from django.contrib.postgres.indexes import GinIndex
from django.db import models

from apps.common.enums import ConsentScope, ConsentType, SuppressionReason
from apps.common.models import TenantModel


class IngestStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    RUNNING = "running", "Running"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"


class ContactList(TenantModel):
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    source_filename = models.CharField(max_length=255, blank=True)
    source_key = models.CharField(max_length=512, blank=True)  # S3 key of the upload

    total_rows = models.PositiveIntegerField(default=0)
    valid_rows = models.PositiveIntegerField(default=0)
    rejected_rows = models.PositiveIntegerField(default=0)
    duplicate_rows = models.PositiveIntegerField(default=0)
    suppressed_rows = models.PositiveIntegerField(default=0)
    ingest_report = models.JSONField(default=dict, blank=True)

    ingest_status = models.CharField(
        max_length=12, choices=IngestStatus.choices, default=IngestStatus.PENDING
    )
    ingest_started_at = models.DateTimeField(null=True, blank=True)
    ingest_finished_at = models.DateTimeField(null=True, blank=True)
    rejects_key = models.CharField(max_length=512, blank=True)  # rejected-rows CSV

    # Region used to parse numbers that arrive without a country code.
    default_region = models.CharField(max_length=2, default="US")

    class Meta:
        indexes = [models.Index(fields=["organization", "-created_at"])]

    def __str__(self):
        return self.name

    @property
    def reachable_rows(self) -> int:
        """What the operator will actually be billed to dial."""
        return max(0, self.valid_rows - self.suppressed_rows)


class Contact(TenantModel):
    contact_list = models.ForeignKey(
        ContactList, on_delete=models.CASCADE, related_name="contacts"
    )
    # Stored E.164 without formatting: +254712345678
    phone_e164 = models.CharField(max_length=16, db_index=True)
    # Hash lets us do suppression joins and erasure without exposing plaintext
    phone_hash = models.CharField(max_length=64, db_index=True)
    country_code = models.CharField(max_length=4, blank=True)
    line_type = models.CharField(max_length=16, blank=True)  # mobile|landline|voip
    carrier_name = models.CharField(max_length=80, blank=True)
    lookup_checked_at = models.DateTimeField(null=True, blank=True)

    first_name = models.CharField(max_length=80, blank=True)
    last_name = models.CharField(max_length=80, blank=True)
    # Arbitrary merge fields for personalised prompts: {"balance": "1,240"}
    variables = models.JSONField(default=dict, blank=True)

    # Resolved at ingest from NPA/NXX or country code. Drives calling windows.
    timezone = models.CharField(max_length=48, default="UTC")

    is_suppressed = models.BooleanField(default=False)
    suppression_reason = models.CharField(
        max_length=24, choices=SuppressionReason.choices, blank=True
    )
    suppressed_at = models.DateTimeField(null=True, blank=True)

    last_called_at = models.DateTimeField(null=True, blank=True)
    total_attempts = models.PositiveSmallIntegerField(default=0)

    # Set when an erasure request lands: phone_e164 and the name fields are
    # nulled, the hash is retained so the number stays suppressed forever
    # without the platform continuing to hold it (spec 4.8).
    erased_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["contact_list", "phone_e164"],
                name="uniq_contact_per_list",
            ),
        ]
        indexes = [
            models.Index(fields=["organization", "phone_hash"]),
            # Partial index: the pacer only ever scans dialable rows.
            models.Index(
                fields=["contact_list", "id"],
                condition=models.Q(is_suppressed=False),
                name="idx_contact_dialable",
            ),
            GinIndex(fields=["variables"], name="idx_contact_vars_gin"),
        ]

    def __str__(self):
        from apps.common.utils import mask_phone

        return mask_phone(self.phone_e164)

    @property
    def full_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.last_name) if p)

    def merge_context(self) -> dict:
        """Variables available to prompt templates for this contact."""
        return {
            "first_name": self.first_name,
            "last_name": self.last_name,
            "full_name": self.full_name,
            **(self.variables or {}),
        }


class ConsentRecord(TenantModel):
    """Proof that this number may lawfully be dialled. Immutable once written."""

    phone_e164 = models.CharField(max_length=16, db_index=True)
    phone_hash = models.CharField(max_length=64, db_index=True)
    consent_type = models.CharField(max_length=32, choices=ConsentType.choices)
    scope = models.CharField(max_length=32, choices=ConsentScope.choices)
    source = models.CharField(max_length=64)  # web_form|ivr|import|api
    source_url = models.URLField(blank=True)
    disclosure_text = models.TextField(blank=True)  # exact language shown
    captured_at = models.DateTimeField()
    captured_ip = models.GenericIPAddressField(null=True, blank=True)
    captured_user_agent = models.TextField(blank=True)
    evidence_ref = models.CharField(max_length=255, blank=True)  # S3 key: TrustedForm etc.
    revoked_at = models.DateTimeField(null=True, blank=True)
    revocation_channel = models.CharField(max_length=32, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "phone_e164", "-captured_at"]),
            models.Index(
                fields=["organization", "phone_e164"],
                condition=models.Q(revoked_at__isnull=True),
                name="idx_consent_active",
            ),
            # The pre-dial gate matches on hash, not plaintext, so erased
            # contacts can still resolve their consent history.
            models.Index(
                fields=["organization", "phone_hash", "scope"],
                condition=models.Q(revoked_at__isnull=True),
                name="idx_consent_hash_active",
            ),
        ]

    def __str__(self):
        from apps.common.utils import mask_phone

        return f"{mask_phone(self.phone_e164)} · {self.consent_type} · {self.scope}"

    @property
    def is_active(self) -> bool:
        from django.utils import timezone

        if self.revoked_at:
            return False
        return not (self.expires_at and self.expires_at <= timezone.now())
