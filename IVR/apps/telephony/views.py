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
            from django.conf import settings

            from apps.common.storage import signed_url

            return Response({
                "url": signed_url(settings.S3_BUCKET_RECORDINGS, call.recording_key),
                "duration": call.recording_duration,
            })
        # Still hosted by the carrier; the URL requires carrier credentials and
        # is deliberately not proxied through this API.
        return Response({"url": call.recording_url,
                         "duration": call.recording_duration,
                         "requires_carrier_auth": True})
