"""Campaigns, caller IDs and the per-campaign work queue (spec 4.6)."""

import datetime as dt

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.common.enums import CampaignStatus, ConsentScope, QueueState
from apps.common.models import TenantModel


class CallerID(TenantModel):
    """A verified outbound number. Attestation level is recorded because it is a
    property of the carrier's vetting, not something the application can assert."""

    phone_e164 = models.CharField(max_length=16, unique=True)
    friendly_name = models.CharField(max_length=80, blank=True)
    provider = models.CharField(max_length=16)  # twilio|telnyx
    provider_sid = models.CharField(max_length=64, blank=True)
    attestation = models.CharField(max_length=1, default="C")  # A|B|C
    trust_product_sid = models.CharField(max_length=64, blank=True)
    cnam_display = models.CharField(max_length=15, blank=True)
    branded_calling_enrolled = models.BooleanField(default=False)
    reputation_score = models.FloatField(null=True, blank=True)
    reputation_checked_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    # Rotation support. A number that has been dialling all day is a number
    # the analytics engines have had all day to score.
    daily_call_cap = models.PositiveIntegerField(default=0)  # 0 = uncapped
    calls_today = models.PositiveIntegerField(default=0)
    calls_today_date = models.DateField(null=True, blank=True)
    rested_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "is_active"]),
            models.Index(fields=["provider", "is_active"]),
        ]

    def __str__(self):
        return f"{self.friendly_name or self.phone_e164} ({self.attestation})"

    @property
    def is_available(self) -> bool:
        from django.utils import timezone

        if not self.is_active:
            return False
        if self.rested_until and self.rested_until > timezone.now():
            return False
        if self.daily_call_cap:
            today = timezone.localdate()
            if self.calls_today_date == today and self.calls_today >= self.daily_call_cap:
                return False
        return True


class Campaign(TenantModel):
    name = models.CharField(max_length=160)
    status = models.CharField(
        max_length=16, choices=CampaignStatus.choices,
        default=CampaignStatus.DRAFT, db_index=True,
    )

    flow_version = models.ForeignKey(
        "ivr.IVRFlowVersion", on_delete=models.PROTECT, related_name="campaigns"
    )
    caller_id = models.ForeignKey(
        CallerID, on_delete=models.PROTECT, related_name="campaigns"
    )
    contact_lists = models.ManyToManyField(
        "contacts.ContactList", related_name="campaigns"
    )
    provider = models.CharField(max_length=16, blank=True)  # blank = settings default

    # --- Consent ---------------------------------------------------------
    # Referenced by the pre-dial gate (spec 5.4). A marketing campaign cannot
    # turn this off; the serializer enforces that, and so does start().
    requires_consent = models.BooleanField(default=True)
    consent_scope = models.CharField(
        max_length=32, choices=ConsentScope.choices, default=ConsentScope.MARKETING
    )

    # --- Pacing ----------------------------------------------------------
    cps_limit = models.FloatField(
        default=1.0,
        validators=[MinValueValidator(0.1), MaxValueValidator(100)],
        help_text="Calls placed per second, enforced globally via Redis token bucket.",
    )
    max_concurrent_channels = models.PositiveIntegerField(
        default=30, help_text="Ceiling on simultaneously live calls."
    )
    ring_timeout_seconds = models.PositiveSmallIntegerField(default=30)

    # --- Dial mode -------------------------------------------------------
    # How calls are released *towards* the concurrency ceiling. cps_limit is
    # still the hard safety rail underneath all three: a mode may ask for a
    # burst, but the token bucket never lets it exceed the configured rate.
    class DialMode(models.TextChoices):
        FIXED = "fixed", "Fixed — fill to the ceiling as fast as pacing allows"
        PULSE = "pulse", "Pulse — a fixed batch on a fixed beat"
        RAMP = "ramp", "Ramp — a batch per interval, released at random moments"

    dial_mode = models.CharField(
        max_length=8, choices=DialMode.choices, default=DialMode.FIXED
    )
    # Pulse and Ramp share the same two knobs; the difference is only *when*
    # inside the interval the batch goes out (on the beat vs. scattered).
    dial_batch_size = models.PositiveIntegerField(
        default=5,
        help_text="Calls released per interval, in pulse and ramp modes.",
    )
    dial_interval_seconds = models.PositiveIntegerField(
        default=30,
        help_text="Seconds between batches, in pulse and ramp modes.",
    )

    # --- Scheduling ------------------------------------------------------
    scheduled_start = models.DateTimeField(null=True, blank=True)
    scheduled_end = models.DateTimeField(null=True, blank=True)
    window_start_local = models.TimeField(default=dt.time(9, 0))
    window_end_local = models.TimeField(default=dt.time(17, 0))
    active_weekdays = models.JSONField(default=list)  # [0,1,2,3,4]
    respect_contact_timezone = models.BooleanField(default=True)
    # Used when respect_contact_timezone is off, or a contact has no timezone.
    fallback_timezone = models.CharField(max_length=48, default="UTC")

    # --- Retries ---------------------------------------------------------
    max_attempts = models.PositiveSmallIntegerField(default=3)
    retry_delay_minutes = models.PositiveIntegerField(default=90)
    retry_on_statuses = models.JSONField(default=list)  # ["busy","no_answer"]
    retry_backoff_factor = models.FloatField(default=1.5)
    max_attempts_per_day = models.PositiveSmallIntegerField(default=2)

    # --- AMD -------------------------------------------------------------
    amd_enabled = models.BooleanField(default=True)
    amd_mode = models.CharField(max_length=20, default="DetectMessageEnd")
    amd_async = models.BooleanField(default=True)
    amd_timeout_seconds = models.PositiveSmallIntegerField(default=30)
    voicemail_node = models.CharField(max_length=64, blank=True)
    hangup_on_machine = models.BooleanField(default=False)

    # --- Recording -------------------------------------------------------
    record_calls = models.BooleanField(default=False)
    recording_disclosure_node = models.CharField(max_length=64, blank=True)

    # --- Bookkeeping -----------------------------------------------------
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    pause_reason = models.CharField(max_length=160, blank=True)
    queue_built_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        indexes = [
            models.Index(fields=["organization", "status", "-created_at"]),
            models.Index(
                fields=["status"],
                condition=models.Q(status="running"),
                name="idx_campaign_running",
            ),
            models.Index(
                fields=["scheduled_start"],
                condition=models.Q(status="scheduled"),
                name="idx_campaign_scheduled",
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def is_dialable(self) -> bool:
        return self.status == CampaignStatus.RUNNING

    @property
    def effective_provider(self) -> str:
        from django.conf import settings

        return self.provider or self.caller_id.provider or settings.DEFAULT_PROVIDER

    def effective_cps(self) -> float:
        """Campaign limit, clamped by the tenant's and the platform's ceilings."""
        from django.conf import settings

        return min(
            float(self.cps_limit),
            float(self.organization.max_cps),
            float(settings.GLOBAL_CPS_CEILING),
        )

    def effective_channels(self) -> int:
        from django.conf import settings

        return min(
            int(self.max_concurrent_channels),
            int(self.organization.max_concurrent_channels),
            int(settings.GLOBAL_CHANNEL_CEILING),
        )


class CampaignContact(TenantModel):
    """Per-campaign work queue row. Claimed with SELECT ... FOR UPDATE SKIP LOCKED."""

    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE, related_name="queue")
    contact = models.ForeignKey(
        "contacts.Contact", on_delete=models.CASCADE, related_name="campaign_entries"
    )
    state = models.CharField(
        max_length=16, choices=QueueState.choices,
        default=QueueState.PENDING, db_index=True,
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    next_attempt_at = models.DateTimeField(null=True, blank=True, db_index=True)
    final_disposition = models.CharField(max_length=20, blank=True)
    priority = models.SmallIntegerField(default=0)
    # Set when the row is claimed, cleared when the call reaches a terminal
    # state. Lets the sweeper find rows orphaned by a worker that died between
    # claiming and dialling.
    claimed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["campaign", "contact"], name="uniq_campaign_contact"
            ),
        ]
        indexes = [
            # The pacer's hot path. Covers the claim query entirely.
            models.Index(
                fields=["campaign", "priority", "next_attempt_at"],
                condition=models.Q(state="pending"),
                name="idx_queue_claimable",
            ),
            models.Index(
                fields=["campaign", "claimed_at"],
                condition=models.Q(state="dialing"),
                name="idx_queue_stuck",
            ),
        ]


class CampaignStats(TenantModel):
    """Denormalised counters flushed from Redis every 5s. The dashboard reads
    Redis directly; this table is the durable, queryable history."""

    campaign = models.OneToOneField(
        Campaign, on_delete=models.CASCADE, related_name="stats"
    )
    total_contacts = models.PositiveIntegerField(default=0)
    dialed = models.PositiveIntegerField(default=0)
    answered = models.PositiveIntegerField(default=0)
    human = models.PositiveIntegerField(default=0)
    machine = models.PositiveIntegerField(default=0)
    no_answer = models.PositiveIntegerField(default=0)
    busy = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    transferred = models.PositiveIntegerField(default=0)
    opted_out = models.PositiveIntegerField(default=0)
    suppressed = models.PositiveIntegerField(default=0)
    confirmed = models.PositiveIntegerField(default=0)
    voicemail = models.PositiveIntegerField(default=0)
    dtmf_breakdown = models.JSONField(default=dict)  # {"1": 812, "2": 140, "9": 33}
    total_duration_seconds = models.BigIntegerField(default=0)
    total_cost = models.DecimalField(max_digits=12, decimal_places=5, default=0)
    last_flushed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["organization", "-updated_at"])]

    @property
    def answer_rate(self) -> float:
        return (self.answered / self.dialed) if self.dialed else 0.0

    @property
    def human_answer_rate(self) -> float:
        return (self.human / self.dialed) if self.dialed else 0.0
