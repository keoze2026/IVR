"""Call log endpoints (spec 11.2)."""

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import CursorPagination
from apps.telephony.models import CallLog
from apps.telephony.serializers import CallLogListSerializer, CallLogSerializer


class CallLogViewSet(TenantViewSetMixin, AuditedActionMixin,
                     viewsets.ReadOnlyModelViewSet):
    """
    /api/v1/calls/

    Read-only. Call records are evidence — the durable answer to "who did you
    call, on what basis, and what happened" — so nothing in the API mutates
    them. Corrections happen through the event pipeline or not at all.
    """

    queryset = CallLog.objects.all().select_related("campaign", "contact")
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = CursorPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["campaign", "status", "disposition", "answered_by",
                        "contact", "attempt_number"]

    required_capabilities = {
        "list": "campaign.view",
        "retrieve": "campaign.view",
        "events": "campaign.view",
        "recording": "recordings.listen",
        "recording_stream": "recordings.listen",
        "export": "contacts.export",
        "default": "campaign.view",
    }

    def get_serializer_class(self):
        if self.action == "list":
            return CallLogListSerializer
        return CallLogSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "retrieve":
            return qs.prefetch_related("dtmf")
        return qs

    @action(detail=True, methods=["get"])
    def events(self, request, pk=None):
        """Raw carrier callbacks for one call — the audit trail (spec 4.7)."""
        call = self.get_object()
        events = call.events.order_by("received_at").values(
            "event_type", "sequence_number", "payload", "signature_valid",
            "received_at",
        )
        return Response(list(events))

    @action(detail=True, methods=["get"])
    def recording(self, request, pk=None):
        """
        Short-lived signed URL for the recording.

        Gated on its own capability rather than on general call access:
        listening to a recording is a materially different act from reading a
        disposition, and the audit entry says who did it.
        """
        call = self.get_object()
        if call.recording_purged_at:
            return Response(
                {"error": {"code": "recording_purged",
                           "message": "Recording was deleted under the retention "
                                      "policy."}},
                status=status.HTTP_410_GONE,
            )
        if not (call.recording_key or call.recording_url):
            return Response({"url": None})

        self.audit("call.recording_access", call)

        if call.recording_key:
            # A same-origin URL the browser can play directly: it streams back
            # through this API (see recording_stream), so no MinIO endpoint and
            # no carrier login are ever exposed to the operator.
            return Response({
                "url": f"/bff/api/calls/{call.pk}/recording/stream/",
                "duration": call.recording_duration,
            })
        # Not yet copied into our storage — the copy job may still be running.
        # We do not hand back the carrier URL, since it requires a carrier login.
        return Response({"url": None,
                         "duration": call.recording_duration,
                         "pending": True})

    @action(detail=True, methods=["get"], url_path="recording/stream")
    def recording_stream(self, request, pk=None):
        """
        Stream the stored recording, so the browser plays it from our own
        origin instead of following a carrier link that demands a carrier login.
        """
        from django.conf import settings
        from django.http import Http404, StreamingHttpResponse

        from apps.common.storage import s3_client

        call = self.get_object()
        if call.recording_purged_at or not call.recording_key:
            raise Http404("No recording.")

        self.audit("call.recording_access", call)
        obj = s3_client().get_object(
            Bucket=settings.S3_BUCKET_RECORDINGS, Key=call.recording_key
        )
        response = StreamingHttpResponse(
            obj["Body"].iter_chunks(),
            content_type=obj.get("ContentType") or "audio/mpeg",
        )
        length = obj.get("ContentLength")
        if length is not None:
            response["Content-Length"] = str(length)
        response["Cache-Control"] = "private, max-age=600"
        return response
