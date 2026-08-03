"""Contact API serialisers (spec 11.2)."""

from rest_framework import serializers

from apps.common.serializers import UnscopedUniqueValidatorsMixin
from apps.contacts.models import ConsentRecord, Contact, ContactList


class ContactListSerializer(serializers.ModelSerializer):
    reachable_rows = serializers.IntegerField(read_only=True)

    class Meta:
        model = ContactList
        fields = [
            "id", "name", "description", "default_region",
            "source_filename", "total_rows", "valid_rows", "rejected_rows",
            "duplicate_rows", "suppressed_rows", "reachable_rows",
            "ingest_status", "ingest_started_at", "ingest_finished_at",
            "ingest_report", "created_at",
        ]
        read_only_fields = [
            "source_filename", "total_rows", "valid_rows", "rejected_rows",
            "duplicate_rows", "suppressed_rows", "ingest_status",
            "ingest_started_at", "ingest_finished_at", "ingest_report",
            "created_at",
        ]


class ContactSerializer(UnscopedUniqueValidatorsMixin, serializers.ModelSerializer):
    # (contact_list, phone_e164) is unique. contact_list already pins the row to
    # one tenant, so running the duplicate check unscoped reads no more than the
    # scoped version would — it just satisfies the guard explicitly.
    phone_masked = serializers.SerializerMethodField()

    class Meta:
        model = Contact
        fields = [
            "id", "contact_list", "phone_e164", "phone_masked", "country_code",
            "line_type", "carrier_name", "first_name", "last_name", "variables",
            "timezone", "is_suppressed", "suppression_reason", "suppressed_at",
            "last_called_at", "total_attempts", "created_at",
        ]
        read_only_fields = [
            "phone_hash", "is_suppressed", "suppression_reason", "suppressed_at",
            "last_called_at", "total_attempts", "created_at",
        ]

    def get_phone_masked(self, obj) -> str:
        from apps.common.utils import mask_phone

        return mask_phone(obj.phone_e164)

    def validate_phone_e164(self, value):
        from apps.contacts.ingest import RowError, normalise_phone

        region = self.context["request"].data.get("region", "US")
        try:
            e164, _cc, _tz = normalise_phone(value, region)
        except RowError as exc:
            raise serializers.ValidationError(str(exc)) from exc
        return e164

    def create(self, validated_data):
        from apps.common.utils import phone_hash

        validated_data["phone_hash"] = phone_hash(validated_data["phone_e164"])
        return super().create(validated_data)


class ContactUploadSerializer(serializers.Serializer):
    """
    Upload initiation.

    The file itself goes straight to object storage; this endpoint only records
    the job. A 500k-row CSV must never be parsed inside a request/response
    cycle (spec 5.1).
    """

    filename = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=64, default="text/csv")
    default_region = serializers.CharField(max_length=2, default="US")

    def validate_content_type(self, value):
        if value not in {"text/csv", "application/csv", "text/plain"}:
            raise serializers.ValidationError("Only CSV uploads are supported.")
        return value


class ContactIngestSerializer(serializers.Serializer):
    """Kick off ingestion of an already-uploaded object."""

    s3_key = serializers.CharField(max_length=512)
    default_region = serializers.CharField(max_length=2, default="US")


class ConsentRecordSerializer(serializers.ModelSerializer):
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = ConsentRecord
        fields = [
            "id", "phone_e164", "consent_type", "scope", "source", "source_url",
            "disclosure_text", "captured_at", "captured_ip",
            "captured_user_agent", "evidence_ref", "revoked_at",
            "revocation_channel", "expires_at", "is_active", "created_at",
        ]
        read_only_fields = ["revoked_at", "revocation_channel", "created_at"]

    def validate(self, attrs):
        # The disclosure text is the evidence. A consent record without it
        # proves that someone ticked something, not what they agreed to.
        if not attrs.get("disclosure_text"):
            raise serializers.ValidationError({
                "disclosure_text":
                    "Record the exact disclosure language shown to the consumer."
            })
        return attrs

    def create(self, validated_data):
        from apps.common.utils import phone_hash

        validated_data["phone_hash"] = phone_hash(validated_data["phone_e164"])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Consent records are immutable once written (spec 4.3). Corrections
        # are new records; revocation is its own endpoint.
        raise serializers.ValidationError(
            "Consent records are immutable. Create a new record, or use "
            "/consent/{id}/revoke/."
        )
