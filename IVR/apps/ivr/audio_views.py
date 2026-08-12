"""
Uploading the sound a caller hears.

An audio file is the plainest possible version of "what plays when they answer":
no flow to author, no text to synthesise, just a recording. It is stored in the
object store and referenced by a campaign; the dial path serves it as a signed
URL that expires, so the file itself is never public.

Kept small on purpose. Validation is about what a phone can actually play — a
codec Twilio rejects is worse than a rejected upload, because it fails silently
mid-call — and about not letting an upload form become a way to fill the disk.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from rest_framework import serializers, status, viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.common import storage
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import SmallPageNumberPagination
from apps.ivr.models import AudioAsset

#: Formats a carrier will actually play back. WAV and MP3 cover every upload a
#: person makes from a phone or a desktop; anything else is refused up front
#: rather than discovered when a live call meets silence.
ALLOWED_TYPES = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
}
MAX_BYTES = 20 * 1024 * 1024  # a prompt is seconds long; 20 MB is already generous


class AudioAssetSerializer(serializers.ModelSerializer):
    play_url = serializers.SerializerMethodField()

    class Meta:
        model = AudioAsset
        fields = [
            "id", "name", "mime_type", "duration_ms", "source",
            "created_at", "play_url",
        ]
        read_only_fields = fields

    def get_play_url(self, obj) -> str:
        # A short-lived signed link, so the list can preview a clip without the
        # bucket ever being public.
        try:
            return storage.signed_url(settings.S3_BUCKET_PROMPTS, obj.storage_key, ttl=600)
        except Exception:  # noqa: BLE001 - a missing object must not 500 the list
            return ""


class AudioAssetViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """/api/v1/audio/ — the organisation's uploaded sounds."""

    serializer_class = AudioAssetSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    parser_classes = [MultiPartParser, FormParser]
    http_method_names = ["get", "post", "delete", "head", "options"]

    required_capabilities = {
        "list": "flow.view",
        "retrieve": "flow.view",
        "create": "flow.edit",
        "destroy": "flow.edit",
        "default": "flow.view",
    }

    def get_queryset(self):
        return AudioAsset.objects.filter(
            organization=self.request.organization
        ).order_by("-created_at")

    def create(self, request, *args, **kwargs):
        upload = request.FILES.get("file")
        name = (request.data.get("name") or "").strip()

        if not upload:
            return self._bad("Choose an audio file to upload.")
        if not name:
            name = upload.name.rsplit(".", 1)[0][:160] or "Recording"

        content_type = (upload.content_type or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_TYPES:
            return self._bad(
                "That file type cannot be played on a call. Upload an MP3 or WAV file."
            )
        if upload.size and upload.size > MAX_BYTES:
            return self._bad("That file is too large. Keep recordings under 20 MB.")

        data = upload.read()
        if not data:
            return self._bad("That file is empty.")

        ext = ALLOWED_TYPES[content_type]
        key = f"{request.organization.id}/audio/{uuid.uuid4().hex}.{ext}"
        storage.put_bytes(settings.S3_BUCKET_PROMPTS, key, data, content_type)

        asset = AudioAsset.objects.create(
            organization=request.organization,
            name=name,
            storage_key=key,
            mime_type=content_type,
            source="upload",
        )
        self.audit("audio.upload", asset, name=asset.name)
        return Response(
            self.get_serializer(asset).data, status=status.HTTP_201_CREATED
        )

    def perform_destroy(self, instance):
        # Remove the object as well as the row; a delete that leaves the file
        # behind quietly fills the bucket.
        import contextlib

        with contextlib.suppress(Exception):
            storage.delete_object(settings.S3_BUCKET_PROMPTS, instance.storage_key)
        self.audit("audio.delete", instance, name=instance.name)
        instance.delete()

    @staticmethod
    def _bad(message: str) -> Response:
        return Response(
            {"error": {"code": "invalid", "message": message}},
            status=status.HTTP_400_BAD_REQUEST,
        )
