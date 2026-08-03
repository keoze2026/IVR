"""Call records and raw events (spec 4.7)."""

from django.db import models

from apps.common.enums import AnsweredBy, CallStatus, Disposition
from apps.common.models import TenantModel


class CallLog(TenantModel):
    campaign = models.ForeignKey(
        "campaigns.Campaign", on_delete=models.CASCADE, related_name="calls"
    )
    contact = models.ForeignKey(
        "contacts.Contact", on_delete=models.SET_NULL, null=True, related_name="calls"
    )
    flow_version = models.ForeignKey(
        "ivr.IVRFlowVersion", on_delete=models.PROTECT, related_name="calls"
    )
    # The consent record that authorised this call, captured at dial time.
    # Nullable because informational campaigns may run without one — but when
    # one exists, this is the answer to "on what basis did you call me?"
    consent_record = models.ForeignKey(
        "contacts.ConsentRecord", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    provider = models.CharField(max_length=16)
    provider_call_sid = models.CharField(max_length=64, unique=True)
    parent_call_sid = models.CharField(max_length=64, blank=True)  # transfer legs

    from_number = models.CharField(max_length=16)
    to_number = models.CharField(max_length=16)
    attempt_number = models.PositiveSmallIntegerField(default=1)

    status = models.CharField(
        max_length=16, choices=CallStatus.choices,
        default=CallStatus.QUEUED, db_index=True,
    )
    answered_by = models.CharField(max_length=20, choices=AnsweredBy.choices, blank=True)
    disposition = models.CharField(max_length=20, choices=Disposition.choices, blank=True)
    sip_response_code = models.PositiveSmallIntegerField(null=True, blank=True)
    error_code = models.CharField(max_length=16, blank=True)
    error_message = models.TextField(blank=True)

    initiated_at = models.DateTimeField(null=True, blank=True)
    ringing_at = models.DateTimeField(null=True, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    billable_seconds = models.PositiveIntegerField(default=0)
    ring_seconds = models.PositiveSmallIntegerField(default=0)
    # Time from answer to the AMD verdict. The single most useful number when
    # tuning AMD, and impossible to reconstruct after the fact (spec 9.2).
    amd_latency_ms = models.PositiveIntegerField(null=True, blank=True)

    # Path the caller actually walked, e.g. ["greeting","menu","confirm"]
    node_path = models.JSONField(default=list, blank=True)
    terminal_node = models.CharField(max_length=64, blank=True)

    transferred_to = models.CharField(max_length=64, blank=True)
    transfer_duration_seconds = models.PositiveIntegerField(default=0)

    recording_url = models.CharField(max_length=512, blank=True)
    recording_key = models.CharField(max_length=512, blank=True)
    recording_duration = models.PositiveIntegerField(default=0)
    recording_purged_at = models.DateTimeField(null=True, blank=True)

    cost = models.DecimalField(max_digits=10, decimal_places=5, null=True, blank=True)
    cost_currency = models.CharField(max_length=3, default="USD")
    cost_reconciled = models.BooleanField(default=False)

    stir_attestation = models.CharField(max_length=1, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["campaign", "-created_at"]),
            models.Index(fields=["campaign", "status"]),
            models.Index(fields=["organization", "to_number", "-created_at"]),
            models.Index(
                fields=["campaign"],
                condition=models.Q(
                    status__in=["queued", "initiated", "ringing", "in_progress"]
                ),
                name="idx_calls_live",
            ),
            models.Index(
                fields=["cost_reconciled", "-created_at"],
                condition=models.Q(cost_reconciled=False),
                name="idx_calls_unreconciled",
            ),
        ]

    def __str__(self):
        return f"{self.provider_call_sid} → {self.to_number[-4:]}"

    @property
    def is_live(self) -> bool:
        from apps.common.enums import LIVE_CALL_STATES

        return self.status in LIVE_CALL_STATES

    @property
    def was_machine(self) -> bool:
        from apps.common.enums import MACHINE_ANSWERS

        return self.answered_by in MACHINE_ANSWERS


class CallEvent(models.Model):
    """Append-only raw callback log. Never updated. Retained 90 days, then
    dropped by partition. This is the audit trail when a carrier disputes."""

    id = models.BigAutoField(primary_key=True)
    call = models.ForeignKey(
        CallLog, on_delete=models.CASCADE, related_name="events", db_constraint=False
    )
    provider_call_sid = models.CharField(max_length=64, db_index=True)
    event_type = models.CharField(max_length=32)
    sequence_number = models.IntegerField(null=True, blank=True)
    payload = models.JSONField()
    signature_valid = models.BooleanField(default=False)
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        # The real table is partitioned by received_at and its unique index
        # includes the partition key; see the RunSQL migration. Django's
        # managed=False keeps the ORM from trying to own that DDL.
        managed = False
        db_table = "telephony_callevent"
        constraints = [
            models.UniqueConstraint(
                fields=["provider_call_sid", "event_type", "sequence_number"],
                name="uniq_call_event",
            ),
        ]

    def __str__(self):
        return f"{self.provider_call_sid} {self.event_type}"


class DTMFResponse(TenantModel):
    call = models.ForeignKey(CallLog, on_delete=models.CASCADE, related_name="dtmf")
    node_id = models.CharField(max_length=64)
    digits = models.CharField(max_length=32)
    attempt = models.PositiveSmallIntegerField(default=1)
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    is_valid = models.BooleanField(default=True)

    class Meta:
        indexes = [
            models.Index(fields=["call", "node_id"]),
            models.Index(fields=["organization", "-created_at"]),
        ]
