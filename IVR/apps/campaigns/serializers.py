"""Campaign API serialisers (spec 11.1)."""

from rest_framework import serializers

from apps.campaigns.models import CallerID, Campaign, CampaignStats
from apps.common.enums import CampaignStatus, ConsentScope
from apps.common.serializers import UnscopedUniqueValidatorsMixin


class CallerIDSerializer(UnscopedUniqueValidatorsMixin, serializers.ModelSerializer):
    # phone_e164 is unique platform-wide: one carrier number belongs to exactly
    # one tenant. The duplicate check therefore has to see every tenant's rows,
    # or a number already claimed elsewhere would validate here and fail at the
    # INSERT with a 500 instead of a 400.
    is_available = serializers.BooleanField(read_only=True)

    class Meta:
        model = CallerID
        fields = [
            "id", "phone_e164", "friendly_name", "provider", "provider_sid",
            "attestation", "cnam_display", "branded_calling_enrolled",
            "reputation_score", "reputation_checked_at", "is_active",
            "daily_call_cap", "calls_today", "rested_until", "is_available",
            "created_at",
        ]
        read_only_fields = [
            # Attestation is assigned by the carrier's vetting process. Letting
            # a tenant set it would turn an audited fact into a self-assessment.
            "attestation", "reputation_score", "reputation_checked_at",
            "calls_today", "created_at",
        ]


class CampaignStatsSerializer(serializers.ModelSerializer):
    answer_rate = serializers.FloatField(read_only=True)
    human_answer_rate = serializers.FloatField(read_only=True)

    class Meta:
        model = CampaignStats
        fields = [
            "total_contacts", "dialed", "answered", "human", "machine",
            "no_answer", "busy", "failed", "transferred", "opted_out",
            "suppressed", "confirmed", "voicemail", "dtmf_breakdown",
            "total_duration_seconds", "total_cost", "last_flushed_at",
            "answer_rate", "human_answer_rate",
        ]


class CampaignSerializer(serializers.ModelSerializer):
    stats = CampaignStatsSerializer(read_only=True)
    caller_id_detail = CallerIDSerializer(source="caller_id", read_only=True)
    flow_name = serializers.CharField(source="flow_version.flow.name", read_only=True)
    flow_version_number = serializers.IntegerField(
        source="flow_version.version", read_only=True
    )
    # Job-facing columns for the Jobs list (reference dialer).
    audio_pool_name = serializers.CharField(
        source="audio_pool.name", read_only=True, default=""
    )
    cli_pool_name = serializers.CharField(
        source="cli_pool.name", read_only=True, default=""
    )
    user = serializers.CharField(
        source="created_by.username", read_only=True, default=""
    )

    class Meta:
        model = Campaign
        fields = [
            "id", "name", "status", "flow_version", "flow_name",
            "flow_version_number", "caller_id", "caller_id_detail",
            "contact_lists", "provider",
            "target_number", "audio_pool", "cli_pool",
            "audio_pool_name", "cli_pool_name", "user",
            "requires_consent", "consent_scope",
            "cps_limit", "max_concurrent_channels", "ring_timeout_seconds",
            "dial_mode", "dial_batch_size", "dial_interval_seconds",
            "scheduled_start", "scheduled_end", "window_start_local",
            "window_end_local", "active_weekdays", "respect_contact_timezone",
            "fallback_timezone",
            "max_attempts", "retry_delay_minutes", "retry_on_statuses",
            "retry_backoff_factor", "max_attempts_per_day",
            "amd_enabled", "amd_mode", "amd_async", "amd_timeout_seconds",
            "voicemail_node", "hangup_on_machine",
            "record_calls", "recording_disclosure_node",
            "started_at", "completed_at", "pause_reason", "queue_built_at",
            "stats", "created_at", "updated_at",
        ]
        read_only_fields = [
            "status", "started_at", "completed_at", "pause_reason",
            "queue_built_at", "created_at", "updated_at",
        ]

    def validate(self, attrs):
        instance = self.instance

        # A running campaign's targeting and pacing are not editable in place.
        # Changing the flow or the lists mid-flight would mean calls in the
        # same campaign ran different scripts with no record of which.
        if instance and instance.status in {
            CampaignStatus.RUNNING, CampaignStatus.THROTTLED
        }:
            frozen = {"flow_version", "contact_lists", "caller_id",
                      "requires_consent", "consent_scope"}
            changed = frozen & set(attrs)
            if changed:
                raise serializers.ValidationError({
                    field: "Cannot be changed while the campaign is running."
                    for field in changed
                })

        scope = attrs.get("consent_scope",
                          getattr(instance, "consent_scope", ConsentScope.MARKETING))
        requires = attrs.get("requires_consent",
                             getattr(instance, "requires_consent", True))
        if scope == ConsentScope.MARKETING and not requires:
            raise serializers.ValidationError({
                "requires_consent":
                    "A marketing campaign cannot disable the consent gate."
            })

        start = attrs.get("window_start_local",
                          getattr(instance, "window_start_local", None))
        end = attrs.get("window_end_local",
                        getattr(instance, "window_end_local", None))
        if start and end and start >= end:
            raise serializers.ValidationError({
                "window_end_local": "Calling window end must be after its start."
            })

        weekdays = attrs.get("active_weekdays")
        if weekdays is not None and (not isinstance(weekdays, list) or any(
            not isinstance(d, int) or not 0 <= d <= 6 for d in weekdays
        )):
            raise serializers.ValidationError({
                "active_weekdays": "Must be a list of integers 0-6 (Mon=0)."
            })

        statuses = attrs.get("retry_on_statuses")
        if statuses is not None:
            allowed = {"busy", "no_answer", "failed", "canceled"}
            invalid = set(statuses) - allowed
            if invalid:
                raise serializers.ValidationError({
                    "retry_on_statuses":
                        f"Unsupported status(es): {', '.join(sorted(invalid))}."
                })

        flow_version = attrs.get("flow_version",
                                 getattr(instance, "flow_version", None))
        if flow_version is not None and not flow_version.is_published:
            raise serializers.ValidationError({
                "flow_version": "Only a published flow version can be pinned."
            })

        return attrs

    def validate_cps_limit(self, value):
        org = self.context["request"].organization
        if value > org.max_cps:
            raise serializers.ValidationError(
                f"Exceeds the organisation ceiling of {org.max_cps} CPS."
            )
        return value

    def validate_max_concurrent_channels(self, value):
        org = self.context["request"].organization
        if value > org.max_concurrent_channels:
            raise serializers.ValidationError(
                f"Exceeds the organisation ceiling of "
                f"{org.max_concurrent_channels} channels."
            )
        return value


class CampaignControlSerializer(serializers.Serializer):
    """Body for start / pause / stop."""

    reason = serializers.CharField(required=False, allow_blank=True, max_length=160)
    force = serializers.BooleanField(
        required=False, default=False,
        help_text="Acknowledge preflight warnings and start anyway.",
    )
    hangup_live = serializers.BooleanField(
        required=False, default=False,
        help_text="Stop only: also terminate calls that are still connected.",
    )


class PreflightSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    errors = serializers.ListField()
    warnings = serializers.ListField()
    estimate = serializers.DictField()
