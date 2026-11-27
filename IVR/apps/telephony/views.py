"""Call log endpoints (spec 11.2)."""

import csv
import datetime as dt
import io
import zoneinfo

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.http import StreamingHttpResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import CursorPagination
from apps.common.utils import mask_phone
from apps.telephony.models import CallLog
from apps.telephony.serializers import CallLogListSerializer, CallLogSerializer

#: Most rows one download holds.
EXPORT_LIMIT = 50_000
#: Longest stretch the daily figures cover.
TREND_MAX_DAYS = 90


def _daily_counts(calls, days: int, zone: zoneinfo.ZoneInfo) -> list[dict]:
    """Calls per day for the last `days` days on that clock, quiet days included."""
    today = timezone.now().astimezone(zone).date()
    first = today - dt.timedelta(days=days - 1)
    rows = (
        calls.filter(created_at__gte=dt.datetime.combine(first, dt.time.min, zone))
        .order_by()
        .annotate(day=TruncDate("created_at", tzinfo=zone))
        .values("day")
        .annotate(
            total=Count("id"),
            # The same rule the portal's screens use for "answered".
            answered=Count("id", filter=Q(status__in=["in_progress", "completed"])
                           | Q(answered_by__gt="")),
            failed=Count("id", filter=Q(status="failed")),
        )
    )
    found = {row["day"]: row for row in rows}
    quiet = {"total": 0, "answered": 0, "failed": 0}
    out = []
    for offset in range(days):
        day = first + dt.timedelta(days=offset)
        row = found.get(day, quiet)
        out.append({"date": day.isoformat(),
                    **{key: row[key] for key in quiet}})
    return out


def _safe_cell(value) -> str:
    """Text a spreadsheet will show, never run as a formula."""
    text = "" if value is None else str(value)
    return f"'{text}" if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def _csv_lines(calls):
    """Yield the file a line at a time."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)

    def line(row):
        writer.writerow(row)
        text = buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()
        return text

    yield line([
        "Date (UTC)", "Job", "From", "To", "Status", "Answered by", "Outcome",
        "Duration (s)", "Billable (s)", "Cost", "Carrier", "Error code",
    ])
    for call in calls.iterator(chunk_size=2000):
        yield line([
            call.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            _safe_cell(call.campaign.name),
            call.from_number.lstrip("+"),
            mask_phone(call.to_number).lstrip("+"),
            call.status,
            call.answered_by,
            call.disposition,
            call.duration_seconds,
            call.billable_seconds,
            "" if call.cost is None else call.cost,
            call.provider,
            _safe_cell(call.error_code),
        ])


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
        "trend": "campaign.view",
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

    @action(detail=False, methods=["get"])
    def trend(self, request):
        """
        Calls per day: `?days=7&tz=Africa/Nairobi`.

        Takes the same filters as the list. Days are counted on the clock named,
        so "today" means the viewer's today.
        """
        try:
            days = int(request.query_params.get("days", 7))
        except ValueError:
            days = 7
        days = min(max(days, 1), TREND_MAX_DAYS)
        try:
            zone = zoneinfo.ZoneInfo(request.query_params.get("tz") or "UTC")
        except (zoneinfo.ZoneInfoNotFoundError, ValueError, OSError):
            zone = zoneinfo.ZoneInfo("UTC")
        calls = self.filter_queryset(self.get_queryset())
        return Response({"timezone": zone.key,
                         "days": _daily_counts(calls, days, zone)})

    @action(detail=False, methods=["get"])
    def export(self, request):
        """
        The call records as a CSV file, newest first, with numbers masked.

        Takes the same filters as the list. Capped, so one click cannot tie up
        a worker on millions of rows.
        """
        calls = (
            self.filter_queryset(self.get_queryset())
            .order_by("-created_at")[:EXPORT_LIMIT]
        )
        self.audit("call.export", request.organization)
        response = StreamingHttpResponse(
            _csv_lines(calls), content_type="text/csv; charset=utf-8"
        )
        response["Content-Disposition"] = 'attachment; filename="call-records.csv"'
        return response

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


class CarrierHealthView(APIView):
    """
    /api/v1/carriers/health/

    Operator visibility into carrier circuit breaker states, failure counts,
    and automatic failover availability.
    """

    permission_classes = [IsOrganizationMember]

    def get(self, request):
        from django.conf import settings

        from apps.dialer.circuit_breaker import circuit_breaker

        return Response({
            "failover_enabled": getattr(settings, "ENABLE_CARRIER_FAILOVER", True),
            "primary_provider": getattr(settings, "DEFAULT_PROVIDER", "twilio"),
            "fallback_provider": getattr(settings, "FALLBACK_PROVIDER", "telnyx"),
            "carriers": circuit_breaker.get_all_health(),
        })

