"""IVR API serialisers (spec 11.2)."""

from rest_framework import serializers

from apps.ivr.models import AudioAsset, IVRFlow, IVRFlowVersion, TransferEndpoint
from apps.ivr.validators import validate_flow


class AudioAssetSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = AudioAsset
        fields = [
            "id", "name", "storage_key", "mime_type", "duration_ms",
            "sample_rate", "source", "source_text", "voice_id", "url",
            "created_at",
        ]
        read_only_fields = ["storage_key", "duration_ms", "created_at"]

    def get_url(self, obj) -> str:
        from django.conf import settings

        from apps.common.storage import signed_url

        if not obj.storage_key:
            return ""
        return signed_url(settings.S3_BUCKET_PROMPTS, obj.storage_key)


class TransferEndpointSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransferEndpoint
        fields = [
            "id", "name", "kind", "destination", "caller_id_override",
            "timeout_seconds", "max_concurrent", "is_active", "created_at",
        ]
        read_only_fields = ["created_at"]

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", "pstn"))
        destination = attrs.get("destination",
                                getattr(self.instance, "destination", ""))
        if kind == TransferEndpoint.Kind.SIP:
            if not destination.startswith("sip:"):
                raise serializers.ValidationError({
                    "destination": "SIP endpoints must be a sip: URI."
                })
        else:
            from apps.contacts.ingest import RowError, normalise_phone

            try:
                attrs["destination"] = normalise_phone(destination, "US")[0]
            except RowError as exc:
                raise serializers.ValidationError({"destination": str(exc)}) from exc
        return attrs


class IVRFlowSerializer(serializers.ModelSerializer):
    latest_version = serializers.SerializerMethodField()
    published_version = serializers.SerializerMethodField()

    class Meta:
        model = IVRFlow
        fields = ["id", "name", "description", "is_archived", "latest_version",
                  "published_version", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def get_latest_version(self, obj):
        version = obj.latest_version
        return {"id": str(version.pk), "version": version.version,
                "is_published": version.is_published} if version else None

    def get_published_version(self, obj):
        version = obj.latest_published
        return {"id": str(version.pk), "version": version.version} if version else None


class IVRFlowVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = IVRFlowVersion
        fields = [
            "id", "flow", "version", "definition", "entry_node", "checksum",
            "is_published", "published_at", "rendered_prompts",
            "prompts_rendered_at", "validation_report", "created_at",
        ]
        read_only_fields = [
            "version", "checksum", "is_published", "published_at",
            "rendered_prompts", "prompts_rendered_at", "validation_report",
            "created_at",
        ]

    def validate_definition(self, value):
        """
        Structural validation on write, full validation on publish.

        Cross-table checks (audio assets, transfer endpoints) run at publish
        time so that a draft can reference an asset that is still uploading.
        """
        result = validate_flow(value, organization_id=None)
        blocking = [
            issue for issue in result.errors
            if issue.code not in {"unknown_asset", "unknown_endpoint"}
        ]
        if blocking:
            raise serializers.ValidationError([i.as_dict() for i in blocking])
        return value

    def validate(self, attrs):
        if self.instance and self.instance.is_published:
            raise serializers.ValidationError(
                "Published versions are immutable. Create a new version instead."
            )
        return attrs

    def create(self, validated_data):
        from apps.ivr.services import create_version

        flow = validated_data["flow"]
        return create_version(
            flow,
            validated_data["definition"],
            user=self.context["request"].user
            if self.context["request"].user.is_authenticated else None,
        )


class FlowValidationSerializer(serializers.Serializer):
    definition = serializers.JSONField()
    contact_list_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list,
        help_text="Validate merge variables against these lists.",
    )
