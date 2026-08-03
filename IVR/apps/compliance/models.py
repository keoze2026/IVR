"""Suppression, DNC and calling windows (spec 4.4)."""

from django.db import models

from apps.common.enums import SuppressionReason
from apps.common.models import TenantModel, TimestampedModel


class DNCEntry(TenantModel):
    # Kept for operator display and export. Nulled on erasure — every matching
    # path uses phone_hash, so suppression survives erasure (spec 4.8).
    phone_e164 = models.CharField(max_length=16, blank=True)
    phone_hash = models.CharField(max_length=64)
    reason = models.CharField(max_length=24, choices=SuppressionReason.choices)
    # NULL = organisation-wide. Set to scope a revocation to one brand/campaign.
    scope_campaign = models.ForeignKey(
        "campaigns.Campaign", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="dnc_entries",
    )
    source_call = models.ForeignKey(
        "telephony.CallLog", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    notes = models.TextField(blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_global = models.BooleanField(
        default=False,
        help_text="Platform-wide suppression, visible to every tenant.",
    )

    class Meta:
        constraints = [
            # PostgreSQL treats NULLs as distinct, so a single unique constraint
            # over a nullable scope_campaign would happily allow unlimited
            # duplicate org-wide entries. Two partial constraints instead.
            models.UniqueConstraint(
                fields=["organization", "phone_hash", "scope_campaign"],
                condition=models.Q(scope_campaign__isnull=False),
                name="uniq_dnc_scoped",
            ),
            models.UniqueConstraint(
                fields=["organization", "phone_hash"],
                condition=models.Q(scope_campaign__isnull=True),
                name="uniq_dnc_org_wide",
            ),
        ]
        indexes = [
            models.Index(fields=["organization", "phone_hash"]),
            models.Index(
                fields=["phone_hash"],
                condition=models.Q(is_global=True),
                name="idx_dnc_global",
            ),
            models.Index(fields=["organization", "-created_at"]),
        ]
        verbose_name = "DNC entry"
        verbose_name_plural = "DNC entries"

    def __str__(self):
        from apps.common.utils import mask_phone

        return f"{mask_phone(self.phone_e164) or self.phone_hash[:12]} · {self.reason}"


class CallingWindow(TenantModel):
    """Per-jurisdiction dialing hours. Defaults ship for US federal (8:00-21:00
    local) plus the stricter state overrides; operators may tighten, never widen."""

    jurisdiction = models.CharField(max_length=8)  # "US", "US-FL", "KE"
    start_local = models.TimeField()
    end_local = models.TimeField()
    weekdays = models.JSONField(default=list)  # [0..6], Mon=0
    holidays_blocked = models.BooleanField(default=True)
    notes = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "jurisdiction"],
                name="uniq_window_per_jurisdiction",
            ),
        ]
        indexes = [models.Index(fields=["organization", "jurisdiction"])]

    def __str__(self):
        return f"{self.jurisdiction} {self.start_local}–{self.end_local}"


class NpaJurisdiction(TimestampedModel):
    """
    NANPA area code → state, for US state-level calling windows.

    Not tenant-scoped: it is reference data. Loaded by
    ``manage.py load_npa_jurisdictions <csv>``. Without it, US traffic falls
    back to the federal window, which is the safe direction to be wrong in
    (federal 08:00–21:00 is never looser than a state rule).
    """

    npa = models.CharField(max_length=3, unique=True)
    state = models.CharField(max_length=2)
    timezone = models.CharField(max_length=48, blank=True)

    class Meta:
        indexes = [models.Index(fields=["npa"])]

    def __str__(self):
        return f"{self.npa} → {self.state}"


class ScrubJob(TenantModel):
    """
    A run of an external suppression source: federal DNC SAN download, state
    registry, or a litigator/trap-line vendor.

    Recorded because "when did you last scrub?" is the first question in any
    TCPA dispute, and "continuously, we think" is not an answer.
    """

    class Source(models.TextChoices):
        FEDERAL_DNC = "federal_dnc", "Federal DNC registry"
        STATE_DNC = "state_dnc", "State DNC registry"
        LITIGATOR = "litigator", "Litigator / trap line vendor"
        MANUAL = "manual", "Manual upload"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    source = models.CharField(max_length=16, choices=Source.choices)
    status = models.CharField(max_length=12, choices=Status.choices,
                              default=Status.PENDING)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    records_processed = models.PositiveIntegerField(default=0)
    records_added = models.PositiveIntegerField(default=0)
    contacts_suppressed = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)
    detail = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [models.Index(fields=["organization", "source", "-created_at"])]


class ComplianceIncident(TenantModel):
    """
    Anything that should have been impossible.

    A call placed outside a window, a dial against a suppressed number, a
    consent gate bypassed by a manual override. These are written by the code
    paths that detect them and are never auto-resolved; someone has to look.
    """

    class Kind(models.TextChoices):
        OUT_OF_WINDOW_DIAL = "out_of_window_dial", "Call placed outside window"
        SUPPRESSED_DIAL = "suppressed_dial", "Call placed to suppressed number"
        MISSING_CONSENT = "missing_consent", "Call placed without consent record"
        RATE_BREACH = "rate_breach", "Configured pacing limit exceeded"
        COMPLAINT = "complaint", "Consumer complaint"

    kind = models.CharField(max_length=32, choices=Kind.choices)
    campaign = models.ForeignKey(
        "campaigns.Campaign", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="incidents",
    )
    call = models.ForeignKey(
        "telephony.CallLog", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="incidents",
    )
    detail = models.JSONField(default=dict, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(
        "accounts.User", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        indexes = [
            models.Index(fields=["organization", "kind", "-created_at"]),
            models.Index(
                fields=["organization", "-created_at"],
                condition=models.Q(acknowledged_at__isnull=True),
                name="idx_incident_open",
            ),
        ]
