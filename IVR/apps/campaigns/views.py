"""Campaign lifecycle endpoints (spec 11.1)."""

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.campaigns.models import CallerID, Campaign
from apps.campaigns.serializers import (
    CallerIDSerializer,
    CampaignControlSerializer,
    CampaignSerializer,
)
from apps.campaigns.services import pause, preflight, resume, start, stop
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import SmallPageNumberPagination
from apps.common.throttling import CampaignControlThrottle


class CampaignViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """
    /api/v1/campaigns/

    Lifecycle actions are POST sub-resources rather than PATCHes of `status`.
    A state machine driven by writes to a status field is a state machine
    anyone can drive into an invalid state; making each transition its own
    endpoint means each one gets its own permission, throttle and audit entry.
    """

    queryset = (
        Campaign.objects.all()
        .select_related("caller_id", "flow_version", "flow_version__flow", "stats")
        .prefetch_related("contact_lists")
    )
    serializer_class = CampaignSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["status", "caller_id", "flow_version"]
    ordering_fields = ["created_at", "name", "status"]

    required_capabilities = {
        "list": "campaign.view",
        "retrieve": "campaign.view",
        "create": "campaign.edit",
        "update": "campaign.edit",
        "partial_update": "campaign.edit",
        "destroy": "campaign.edit",
        "preflight": "campaign.view",
        "start": "campaign.control",
        "pause": "campaign.control",
        "resume": "campaign.control",
        "stop": "campaign.control",
        "stats": "campaign.view",
        "amd_quality": "campaign.view",
        "rebuild_stats": "campaign.edit",
        "default": "campaign.view",
    }

    def get_throttles(self):
        if self.action in {"start", "pause", "resume", "stop"}:
            return [CampaignControlThrottle()]
        return super().get_throttles()

    def perform_create(self, serializer):
        from apps.common.utils import acting_user

        campaign = serializer.save(
            organization=self.request.organization,
            created_by=acting_user(self.request),
        )
        self.audit("campaign.create", campaign, name=campaign.name)

    # --- lifecycle ------------------------------------------------------
    @action(detail=True, methods=["get"])
    def preflight(self, request, pk=None):
        """Dry run of every launch check. Never mutates anything."""
        return Response(preflight(self.get_object()))

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        body = CampaignControlSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        campaign = start(
            self.get_object(),
            user=request.user,
            force=body.validated_data.get("force", False),
        )
        self.audit("campaign.start", campaign,
                   forced=body.validated_data.get("force", False))
        return Response(self.get_serializer(campaign).data)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        body = CampaignControlSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        campaign = pause(
            self.get_object(),
            reason=body.validated_data.get("reason", ""),
            user=request.user,
        )
        self.audit("campaign.pause", campaign,
                   reason=body.validated_data.get("reason", ""))
        return Response(self.get_serializer(campaign).data)

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        campaign = resume(self.get_object(), user=request.user)
        self.audit("campaign.resume", campaign)
        return Response(self.get_serializer(campaign).data)

    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        body = CampaignControlSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        campaign = stop(
            self.get_object(),
            hangup_live=body.validated_data.get("hangup_live", False),
            user=request.user,
        )
        self.audit("campaign.stop", campaign,
                   hangup_live=body.validated_data.get("hangup_live", False))
        return Response(self.get_serializer(campaign).data)

    # --- telemetry ------------------------------------------------------
    @action(detail=True, methods=["get"])
    def stats(self, request, pk=None):
        """
        Live counters straight from Redis.

        The websocket is the primary channel; this exists for the initial page
        load and for clients that cannot hold a socket open.
        """
        from apps.telemetry.counters import build_frame

        campaign = self.get_object()
        return Response(build_frame(campaign.pk))

    @action(detail=True, methods=["get"], url_path="amd-quality")
    def amd_quality(self, request, pk=None):
        from apps.telephony.amd import amd_quality_report

        return Response(amd_quality_report(self.get_object()))

    @action(detail=True, methods=["post"], url_path="rebuild-stats")
    def rebuild_stats(self, request, pk=None):
        from apps.telemetry.tasks import rebuild_stats_from_calls

        campaign = self.get_object()
        rebuild_stats_from_calls.delay(str(campaign.pk))
        self.audit("campaign.rebuild_stats", campaign)
        return Response({"status": "queued"}, status=status.HTTP_202_ACCEPTED)

    def destroy(self, request, *args, **kwargs):
        from apps.common.enums import CampaignStatus
        from apps.common.exceptions import CampaignStateError

        campaign = self.get_object()
        if campaign.status in {CampaignStatus.RUNNING, CampaignStatus.THROTTLED}:
            raise CampaignStateError(detail="Stop the campaign before deleting it.")
        self.audit("campaign.delete", campaign, name=campaign.name)
        return super().destroy(request, *args, **kwargs)


class CallerIDViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """/api/v1/caller-ids/"""

    queryset = CallerID.objects.all()
    serializer_class = CallerIDSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["provider", "is_active", "attestation"]

    required_capabilities = {
        "list": "campaign.view",
        "retrieve": "campaign.view",
        "create": "org.manage",
        "update": "org.manage",
        "partial_update": "org.manage",
        "destroy": "org.manage",
        "default": "campaign.view",
    }
