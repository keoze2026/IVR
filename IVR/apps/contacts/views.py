"""Contact and list endpoints (spec 11.2)."""

import uuid

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import CursorPagination, SmallPageNumberPagination
from apps.common.throttling import UploadRateThrottle
from apps.contacts.models import Contact, ContactList
from apps.contacts.serializers import (
    ContactIngestSerializer,
    ContactListSerializer,
    ContactSerializer,
    ContactUploadSerializer,
)


class ContactListViewSet(TenantViewSetMixin, AuditedActionMixin,
                         viewsets.ModelViewSet):
    """/api/v1/contact-lists/"""

    queryset = ContactList.objects.all()
    serializer_class = ContactListSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["ingest_status"]

    required_capabilities = {
        "list": "contacts.view",
        "retrieve": "contacts.view",
        "create": "contacts.edit",
        "update": "contacts.edit",
        "partial_update": "contacts.edit",
        "destroy": "contacts.edit",
        "upload_url": "contacts.edit",
        "ingest": "contacts.edit",
        "suppression_preview": "contacts.view",
        "rejects": "contacts.view",
        "default": "contacts.view",
    }

    def get_throttles(self):
        if self.action in {"upload_url", "ingest"}:
            return [UploadRateThrottle()]
        return super().get_throttles()

    @action(detail=True, methods=["post"], url_path="upload-url")
    def upload_url(self, request, pk=None):
        """
        Hand back a presigned POST so the client uploads straight to storage.

        The file never touches the application tier: a 500k-row CSV streamed
        through Django would hold a worker for the duration of the transfer
        and buffer tens of megabytes per concurrent upload.
        """
        from django.conf import settings

        from apps.common.storage import signed_upload_url

        contact_list = self.get_object()
        body = ContactUploadSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        key = (
            f"uploads/{request.organization.pk}/{contact_list.pk}/"
            f"{uuid.uuid4()}.csv"
        )
        presigned = signed_upload_url(
            settings.S3_BUCKET_UPLOADS, key, body.validated_data["content_type"]
        )
        ContactList.objects.unscoped().filter(pk=contact_list.pk).update(
            source_filename=body.validated_data["filename"],
            source_key=key,
            default_region=body.validated_data["default_region"],
        )
        return Response({"upload": presigned, "s3_key": key},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def ingest(self, request, pk=None):
        """Start asynchronous ingestion of an uploaded object."""
        from apps.contacts.models import IngestStatus
        from apps.contacts.tasks import ingest_contact_file

        contact_list = self.get_object()
        body = ContactIngestSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        key = body.validated_data["s3_key"]
        # Only keys inside this tenant's own upload prefix. Without this check
        # the parameter is a read primitive over the whole bucket.
        expected_prefix = f"uploads/{request.organization.pk}/{contact_list.pk}/"
        if not key.startswith(expected_prefix):
            return Response(
                {"error": {"code": "invalid_key",
                           "message": "Key does not belong to this contact list."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ContactList.objects.unscoped().filter(pk=contact_list.pk).update(
            ingest_status=IngestStatus.PENDING
        )
        task = ingest_contact_file.delay(
            str(contact_list.pk), key, body.validated_data["default_region"]
        )
        self.audit("contacts.ingest", contact_list, s3_key=key)
        return Response({"job_id": task.id, "status": "queued"},
                        status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["get"], url_path="suppression-preview")
    def suppression_preview(self, request, pk=None):
        """How many of these contacts are actually reachable right now."""
        from apps.compliance.services import suppression_preview

        contact_list = self.get_object()
        return Response(
            suppression_preview(request.organization.pk, contact_list.pk)
        )

    @action(detail=True, methods=["get"])
    def rejects(self, request, pk=None):
        """Signed URL for the rejected-rows CSV produced during ingest."""
        from django.conf import settings

        from apps.common.storage import signed_url

        contact_list = self.get_object()
        if not contact_list.rejects_key:
            return Response({"url": None, "rejected_rows": 0})
        return Response({
            "url": signed_url(settings.S3_BUCKET_UPLOADS, contact_list.rejects_key),
            "rejected_rows": contact_list.rejected_rows,
        })


class ContactViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """/api/v1/contacts/"""

    queryset = Contact.objects.all().select_related("contact_list")
    serializer_class = ContactSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = CursorPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["contact_list", "is_suppressed", "line_type",
                        "suppression_reason"]

    required_capabilities = {
        "list": "contacts.view",
        "retrieve": "contacts.view",
        "create": "contacts.edit",
        "update": "contacts.edit",
        "partial_update": "contacts.edit",
        "destroy": "contacts.edit",
        "erase": "compliance.edit",
        "default": "contacts.view",
    }

    @action(detail=True, methods=["post"])
    def erase(self, request, pk=None):
        """
        GDPR / CCPA erasure for this number.

        Nulls the plaintext everywhere it is held and keeps the hash so the
        number stays suppressed permanently — erasure must not become a route
        back onto the dialling list.
        """
        from apps.contacts.tasks import erase_number

        contact = self.get_object()
        if not contact.phone_e164:
            return Response({"status": "already_erased"})
        erase_number.delay(str(request.organization.pk), contact.phone_e164)
        self.audit("contacts.erase", contact)
        return Response({"status": "queued"}, status=status.HTTP_202_ACCEPTED)
