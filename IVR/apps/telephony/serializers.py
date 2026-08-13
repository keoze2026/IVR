"""Call log serialisers (spec 11.2)."""

from rest_framework import serializers

from apps.telephony.models import CallLog, DTMFResponse


class DTMFResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = DTMFResponse
        fields = ["node_id", "digits", "attempt", "latency_ms", "is_valid",
                  "created_at"]


class CallLogSerializer(serializers.ModelSerializer):
    to_masked = serializers.SerializerMethodField()
    dtmf = DTMFResponseSerializer(many=True, read_only=True)

    class Meta:
        model = CallLog
        fields = [
            "id", "campaign", "contact", "flow_version", "provider",
            "provider_call_sid", "from_number", "to_number", "to_masked",
            "attempt_number", "status", "answered_by", "disposition",
            "sip_response_code", "error_code", "error_message",
            "initiated_at", "ringing_at", "answered_at", "ended_at",
            "duration_seconds", "billable_seconds", "ring_seconds",
            "amd_latency_ms", "node_path", "terminal_node", "transferred_to",
            "transfer_duration_seconds", "recording_duration",
            "cost", "cost_currency", "cost_reconciled", "stir_attestation",
            "dtmf", "created_at",
        ]
        read_only_fields = fields

    def get_to_masked(self, obj) -> str:
        from apps.common.utils import mask_phone

        return mask_phone(obj.to_number)


class CallLogListSerializer(serializers.ModelSerializer):
    """
    Lighter payload for the call table.

    The full serialiser prefetches DTMF, which is one query per page but a lot
    of payload on a 500-row page nobody expands.
    """

    to_masked = serializers.SerializerMethodField()
    has_recording = serializers.SerializerMethodField()
    billable_seconds = serializers.IntegerField(read_only=True)

    class Meta:
        model = CallLog
        fields = [
            "id", "campaign", "provider_call_sid", "to_masked", "status",
            "answered_by", "disposition", "attempt_number", "duration_seconds",
            "billable_seconds", "ring_seconds", "cost", "terminal_node",
            "has_recording", "created_at", "ended_at",
        ]
        read_only_fields = fields

    def get_to_masked(self, obj) -> str:
        from apps.common.utils import mask_phone

        return mask_phone(obj.to_number)

    def get_has_recording(self, obj) -> bool:
        # A recording exists and can still be fetched. The CDR's play control is
        # active only when this is true; otherwise there is nothing to play.
        return bool(
            (obj.recording_key or obj.recording_url) and not obj.recording_purged_at
        )
