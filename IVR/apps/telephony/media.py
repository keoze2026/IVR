"""
Serve prompt audio to the carrier over the app's own public URL.

Twilio fetches a ``<Play>`` URL from the public internet, so it cannot use a
presigned link to MinIO on an internal address (``http://minio:9000/...``) —
that host does not resolve outside the compose network. This streams the object
from storage through the app instead, at

    https://<public-base>/webhooks/media/prompt/<asset-id>/

which is already public and HTTPS. The id is an unguessable UUID and the audio
is an operator's own uploaded prompt, so it is served without authentication so
the carrier can fetch it; nothing sensitive (recordings, PII) is exposed here.
"""

from __future__ import annotations

from django.conf import settings
from django.http import Http404, StreamingHttpResponse
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView


class PromptMediaView(APIView):
    # Public: the carrier fetches this with no credential and no signature.
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request, asset_id):
        from apps.common.storage import s3_client
        from apps.ivr.models import AudioAsset

        asset = (
            AudioAsset.objects.unscoped()
            .filter(pk=asset_id)
            .only("id", "storage_key", "mime_type")
            .first()
        )
        if not asset or not asset.storage_key:
            raise Http404("Unknown audio.")

        obj = s3_client().get_object(
            Bucket=settings.S3_BUCKET_PROMPTS, Key=asset.storage_key
        )
        response = StreamingHttpResponse(
            obj["Body"].iter_chunks(),
            content_type=asset.mime_type or obj.get("ContentType") or "audio/mpeg",
        )
        length = obj.get("ContentLength")
        if length is not None:
            response["Content-Length"] = str(length)
        response["Cache-Control"] = "private, max-age=3600"
        return response
