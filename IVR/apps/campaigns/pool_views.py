"""
Pools, wallet and tariffs — the resources a job is assembled from.

Audio pools and CLI pools are collections the dispatcher rotates across; the
wallet is the credit a job spends; tariffs are what a minute costs. All are
org-scoped and edited by an operator, so they sit on the ordinary tenant
viewset base rather than the platform-admin surface.
"""

from __future__ import annotations

from rest_framework import serializers, viewsets

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.campaigns.models import CLIPool, Tariff, Wallet, WalletEntry
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import SmallPageNumberPagination
from apps.ivr.models import AudioPool


class AudioPoolSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()
    user = serializers.SerializerMethodField()

    class Meta:
        model = AudioPool
        fields = ["id", "name", "description", "rotation", "members",
                  "member_count", "user", "created_at"]
        read_only_fields = ["id", "created_at", "member_count", "user"]

    def get_member_count(self, obj) -> int:
        return obj.members.count()

    def get_user(self, obj) -> str:
        return getattr(obj.created_by, "username", "") or ""

    def validate_members(self, value):
        org = self.context["request"].organization
        for asset in value:
            if asset.organization_id != org.id:
                raise serializers.ValidationError("A sound from another organisation.")
        return value


class AudioPoolViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """/api/v1/audio-pools/ — collections of sounds a job plays from."""

    queryset = AudioPool.objects.prefetch_related("members").order_by("name")
    serializer_class = AudioPoolSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    required_capabilities = {
        "list": "flow.view", "retrieve": "flow.view",
        "create": "flow.edit", "update": "flow.edit",
        "partial_update": "flow.edit", "destroy": "flow.edit",
        "default": "flow.view",
    }

    def perform_create(self, serializer):
        user = self.request.user if hasattr(self.request.user, "_meta") else None
        serializer.save(organization=self.request.organization, created_by=user)

class CLIPoolSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()
    user = serializers.SerializerMethodField()

    class Meta:
        model = CLIPool
        fields = ["id", "name", "description", "rotation", "members",
                  "member_count", "user", "created_at"]
        read_only_fields = ["id", "created_at", "member_count", "user"]

    def get_member_count(self, obj) -> int:
        return obj.members.count()

    def get_user(self, obj) -> str:
        return getattr(obj.created_by, "username", "") or ""

    def validate_members(self, value):
        org = self.context["request"].organization
        for caller in value:
            if caller.organization_id != org.id:
                raise serializers.ValidationError("A number from another organisation.")
        return value


class CLIPoolViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """/api/v1/cli-pools/ — collections of caller IDs a job dials from."""

    queryset = CLIPool.objects.prefetch_related("members").order_by("name")
    serializer_class = CLIPoolSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    required_capabilities = {
        "list": "campaign.view", "retrieve": "campaign.view",
        "create": "org.manage", "update": "org.manage",
        "partial_update": "org.manage", "destroy": "org.manage",
        "default": "campaign.view",
    }

class WalletEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = WalletEntry
        fields = ["id", "kind", "amount", "description", "created_at"]


class WalletSerializer(serializers.ModelSerializer):
    recent = serializers.SerializerMethodField()

    class Meta:
        model = Wallet
        fields = ["id", "balance", "currency", "low_balance_threshold", "recent"]
        read_only_fields = fields

    def get_recent(self, obj):
        return WalletEntrySerializer(
            obj.entries.order_by("-created_at")[:20], many=True
        ).data


class WalletViewSet(TenantViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    /api/v1/wallet/ — the organisation's calling credit.

    Read-only to operators: money moves through top-ups and reconciled call
    costs, never by editing the balance directly. A settable balance is a
    settable invoice.
    """

    queryset = Wallet.objects.all()
    serializer_class = WalletSerializer
    permission_classes = [IsOrganizationMember]
    pagination_class = SmallPageNumberPagination

    def list(self, request, *args, **kwargs):
        # One wallet per org; create it lazily so a fresh tenant is not a 404.
        Wallet.objects.get_or_create(organization=request.organization)
        return super().list(request, *args, **kwargs)


class TariffSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tariff
        fields = ["id", "name", "prefix", "per_minute", "connect_fee",
                  "increment_seconds", "currency", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]


class TariffViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """/api/v1/tariffs/ — per-destination call pricing."""

    queryset = Tariff.objects.order_by("-prefix")
    serializer_class = TariffSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    required_capabilities = {
        "list": "campaign.view", "retrieve": "campaign.view",
        "create": "org.manage", "update": "org.manage",
        "partial_update": "org.manage", "destroy": "org.manage",
        "default": "campaign.view",
    }
