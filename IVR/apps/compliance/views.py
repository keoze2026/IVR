"""Compliance endpoints (spec 11.2)."""

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import CursorPagination, SmallPageNumberPagination
from apps.compliance.models import CallingWindow, DNCEntry
from apps.compliance.serializers import (
    CallingWindowSerializer,
    DNCBulkSerializer,
    DNCEntrySerializer,
    RevokeConsentSerializer,
)
from apps.contacts.models import ConsentRecord
from apps.contacts.serializers import ConsentRecordSerializer


class DNCEntryViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """
    /api/v1/dnc/

    Deleting a suppression is possible but audited loudly: removing a number
    from DNC is the single most consequential write in the API, and "it was
    added by mistake" needs to be a decision someone owns.
    """

    queryset = DNCEntry.objects.all().select_related("scope_campaign")
    serializer_class = DNCEntrySerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = CursorPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["reason", "scope_campaign", "is_global"]

    required_capabilities = {
        "list": "compliance.view",
        "retrieve": "compliance.view",
        "create": "compliance.edit",
        "update": "compliance.edit",
        "partial_update": "compliance.edit",
        "destroy": "compliance.edit",
        "bulk": "compliance.edit",
        "check": "compliance.view",
        "default": "compliance.view",
    }

    def perform_create(self, serializer):
        from apps.common.utils import phone_hash

        e164 = serializer.validated_data["phone_e164"]
        entry = serializer.save(
            organization=self.request.organization, phone_hash=phone_hash(e164)
        )
        # Make it effective immediately rather than within the cache TTL.
        from apps.compliance.services import invalidate_suppression_cache

        invalidate_suppression_cache(self.request.organization.pk, entry.phone_hash)
        self.audit("dnc.create", entry, reason=entry.reason)

    def perform_destroy(self, instance):
        from apps.compliance.services import invalidate_suppression_cache

        self.audit("dnc.delete", instance, reason=instance.reason,
                   phone_hash=instance.phone_hash)
        invalidate_suppression_cache(self.request.organization.pk,
                                     instance.phone_hash)
        instance.delete()

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """Add many suppressions at once — a customer's own opt-out export."""
        from apps.compliance.tasks import apply_suppression_batch

        body = DNCBulkSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        from apps.contacts.ingest import RowError, normalise_phone

        cleaned, rejected = [], []
        for raw in body.validated_data["numbers"]:
            try:
                e164, _cc, _tz = normalise_phone(raw, "US")
                cleaned.append(e164)
            except RowError as exc:
                rejected.append({"input": raw, "reason": str(exc)})

        added = apply_suppression_batch(
            request.organization.pk,
            cleaned,
            reason=body.validated_data["reason"],
            notes=body.validated_data.get("notes", ""),
        )
        self.audit("dnc.bulk", request.organization, count=len(cleaned))
        return Response(
            {"submitted": len(cleaned), "contacts_flagged": added,
             "rejected": rejected},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["get"])
    def check(self, request):
        """Is this number suppressed for this tenant? ?phone=+1555…"""
        from apps.common.utils import phone_hash
        from apps.compliance.services import bulk_suppression_check
        from apps.contacts.ingest import RowError, normalise_phone

        raw = request.query_params.get("phone", "")
        if not raw:
            return Response({"error": {"code": "missing_phone",
                                       "message": "phone is required"}},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            e164, _cc, _tz = normalise_phone(raw, "US")
        except RowError as exc:
            return Response({"error": {"code": "invalid_phone",
                                       "message": str(exc)}},
                            status=status.HTTP_400_BAD_REQUEST)

        digest = phone_hash(e164)
        hits = bulk_suppression_check(request.organization.pk, [digest])
        return Response({
            "phone_e164": e164,
            "suppressed": digest in hits,
            "reason": hits.get(digest, ""),
        })


class ConsentRecordViewSet(TenantViewSetMixin, AuditedActionMixin,
                           viewsets.ModelViewSet):
    """
    /api/v1/consent/

    Records are immutable once written. Revocation is a separate action that
    stamps revoked_at rather than deleting the row — the record that consent
    once existed is as important as the record that it was withdrawn.
    """

    queryset = ConsentRecord.objects.all()
    serializer_class = ConsentRecordSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = CursorPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["consent_type", "scope", "source"]

    required_capabilities = {
        "list": "compliance.view",
        "retrieve": "compliance.view",
        "create": "compliance.edit",
        "revoke": "compliance.edit",
        "lookup": "compliance.view",
        "default": "compliance.view",
    }
    http_method_names = ["get", "post", "head", "options"]

    def perform_create(self, serializer):
        record = serializer.save(organization=self.request.organization)
        self.audit("consent.create", record, scope=record.scope,
                   consent_type=record.consent_type)

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        from django.utils import timezone

        body = RevokeConsentSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        record = self.get_object()
        if record.revoked_at:
            return Response(self.get_serializer(record).data)

        ConsentRecord.objects.unscoped().filter(pk=record.pk).update(
            revoked_at=timezone.now(),
            revocation_channel=body.validated_data["channel"],
        )
        # A revocation that does not also suppress is a filing exercise.
        from apps.compliance.services import record_opt_out

        record_opt_out(
            request.organization.pk,
            record.phone_e164,
            reason="internal_dnc",
            notes=f"Consent {record.pk} revoked via "
                  f"{body.validated_data['channel']}",
        )
        record.refresh_from_db()
        self.audit("consent.revoke", record)
        return Response(self.get_serializer(record).data)

    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Every consent record for a number, newest first. ?phone=+1555…"""
        from apps.common.utils import phone_hash

        raw = request.query_params.get("phone", "")
        if not raw:
            return Response({"error": {"code": "missing_phone",
                                       "message": "phone is required"}},
                            status=status.HTTP_400_BAD_REQUEST)
        from apps.contacts.ingest import RowError, normalise_phone

        try:
            e164, _cc, _tz = normalise_phone(raw, "US")
        except RowError as exc:
            return Response({"error": {"code": "invalid_phone",
                                       "message": str(exc)}},
                            status=status.HTTP_400_BAD_REQUEST)

        records = self.get_queryset().filter(
            phone_hash=phone_hash(e164)
        ).order_by("-captured_at")
        return Response(self.get_serializer(records, many=True).data)


class CallingWindowViewSet(TenantViewSetMixin, AuditedActionMixin,
                           viewsets.ModelViewSet):
    """/api/v1/calling-windows/"""

    queryset = CallingWindow.objects.all()
    serializer_class = CallingWindowSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination

    required_capabilities = {
        "list": "compliance.view",
        "retrieve": "compliance.view",
        "create": "compliance.edit",
        "update": "compliance.edit",
        "partial_update": "compliance.edit",
        "destroy": "compliance.edit",
        "default": "compliance.view",
    }

    def perform_create(self, serializer):
        window = serializer.save(organization=self.request.organization)
        self._bust_cache(window)
        self.audit("calling_window.create", window,
                   jurisdiction=window.jurisdiction)

    def perform_update(self, serializer):
        window = serializer.save()
        self._bust_cache(window)
        self.audit("calling_window.update", window,
                   jurisdiction=window.jurisdiction)

    def _bust_cache(self, window):
        from django.core.cache import cache

        cache.delete(f"window:{window.organization_id}:{window.jurisdiction}")
