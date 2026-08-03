"""Compliance API serialisers (spec 11.2)."""

from rest_framework import serializers

from apps.compliance.models import CallingWindow, DNCEntry


class DNCEntrySerializer(serializers.ModelSerializer):
    phone_masked = serializers.SerializerMethodField()

    class Meta:
        model = DNCEntry
        fields = [
            "id", "phone_e164", "phone_masked", "reason", "scope_campaign",
            "notes", "expires_at", "is_global", "created_at",
        ]
        read_only_fields = ["is_global", "created_at"]

    def get_phone_masked(self, obj) -> str:
        from apps.common.utils import mask_phone

        return mask_phone(obj.phone_e164)

    def validate_phone_e164(self, value):
        from apps.contacts.ingest import RowError, normalise_phone

        try:
            e164, _cc, _tz = normalise_phone(value, "US")
        except RowError as exc:
            raise serializers.ValidationError(str(exc)) from exc
        return e164


class DNCBulkSerializer(serializers.Serializer):
    numbers = serializers.ListField(
        child=serializers.CharField(max_length=32), min_length=1, max_length=10_000
    )
    reason = serializers.CharField(max_length=24, default="internal_dnc")
    notes = serializers.CharField(required=False, allow_blank=True, max_length=500)


class CallingWindowSerializer(serializers.ModelSerializer):
    class Meta:
        model = CallingWindow
        fields = [
            "id", "jurisdiction", "start_local", "end_local", "weekdays",
            "holidays_blocked", "notes", "created_at",
        ]
        read_only_fields = ["created_at"]

    def validate(self, attrs):
        start = attrs.get("start_local", getattr(self.instance, "start_local", None))
        end = attrs.get("end_local", getattr(self.instance, "end_local", None))
        if start and end and start >= end:
            raise serializers.ValidationError({
                "end_local": "Window end must be after its start."
            })

        # Operators may tighten a jurisdiction's window, never widen it past
        # the statutory ceiling (spec 4.4).
        jurisdiction = attrs.get(
            "jurisdiction", getattr(self.instance, "jurisdiction", "")
        )
        from apps.compliance.windows import federal_ceiling

        ceiling = federal_ceiling(jurisdiction)
        if ceiling and start and end and (start < ceiling[0] or end > ceiling[1]):
            raise serializers.ValidationError({
                "jurisdiction":
                    f"{jurisdiction} windows may not extend beyond "
                    f"{ceiling[0]:%H:%M}–{ceiling[1]:%H:%M} local.",
            })
        return attrs

    def validate_weekdays(self, value):
        if not isinstance(value, list) or any(
            not isinstance(d, int) or not 0 <= d <= 6 for d in value
        ):
            raise serializers.ValidationError(
                "Must be a list of integers 0-6 (Mon=0)."
            )
        return value


class RevokeConsentSerializer(serializers.Serializer):
    channel = serializers.CharField(max_length=32, default="api")
