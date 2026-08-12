"""
Identity for the caller (spec 11, frontend contract G-04).

One endpoint, answering "who am I, what may I do, and what are my ceilings?"

The capability list is the point. Without it a client either hides everything —
leaving an operator staring at a portal with no buttons — or offers actions
that can only 403. The matrix already exists in `ROLE_CAPABILITIES`; this
exposes it rather than asking the client to keep its own copy in step.

Both principals are supported. A session user and an API key duck-type the same
contract, and the client should not have to care which one it is holding.
"""

from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ROLE_CAPABILITIES, APIKey, Role
from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import SmallPageNumberPagination


class MeView(APIView):
    """`GET /api/v1/me/` — the caller's identity, role and capabilities."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        principal = request.user
        organization = getattr(request, "organization", None) or getattr(
            principal, "organization", None
        )
        role = getattr(principal, "role", "") or ""

        # A superuser is not in the matrix but passes every capability check,
        # so report the full set rather than an empty one the UI would read as
        # "no permissions".
        if getattr(principal, "is_superuser", False):
            capabilities = sorted(
                {cap for caps in ROLE_CAPABILITIES.values() for cap in caps}
            )
        else:
            capabilities = sorted(ROLE_CAPABILITIES.get(role, set()))

        api_key = getattr(principal, "api_key", None)
        is_key = isinstance(api_key, APIKey)

        return Response(
            {
                # Null for an API key: there is no human behind it, and
                # inventing one would put a fictitious name in the audit trail.
                "user": None
                if is_key
                else {
                    "id": str(principal.pk),
                    "username": principal.get_username(),
                    "email": principal.email,
                    "first_name": principal.first_name,
                    "last_name": principal.last_name,
                    "mfa_enabled": getattr(principal, "mfa_enabled", False),
                },
                "api_key": {
                    "id": str(api_key.pk),
                    "name": api_key.name,
                    "prefix": api_key.prefix,
                    "expires_at": api_key.expires_at.isoformat()
                    if api_key.expires_at
                    else None,
                }
                if is_key
                else None,
                "organization": {
                    "id": str(organization.pk),
                    "name": organization.name,
                    "slug": organization.slug,
                    "is_active": organization.is_active,
                    "is_suspended": organization.is_suspended,
                    "suspension_reason": organization.suspension_reason,
                    "require_consent_for_marketing": (
                        organization.require_consent_for_marketing
                    ),
                    "permitted_countries": organization.permitted_countries,
                }
                if organization
                else None,
                "role": role,
                "capabilities": capabilities,
                # Ceilings drive client-side validation on campaign forms, so a
                # user is told the limit before submitting rather than after.
                "ceilings": {
                    "max_cps": float(organization.max_cps),
                    "max_concurrent_channels": organization.max_concurrent_channels,
                    "max_contacts": organization.max_contacts,
                }
                if organization
                else None,
            }
        )


class APIKeySerializer(serializers.ModelSerializer):
    """
    The key as it can safely be shown afterwards.

    There is no field for the secret here, deliberately. It exists for exactly
    one response — the create — and is assembled there rather than on the
    serializer, so no later list or retrieve can grow a path to it by accident.
    """

    is_active = serializers.BooleanField(read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = APIKey
        fields = [
            "id", "name", "prefix", "role", "created_at", "last_used_at",
            "expires_at", "revoked_at", "is_active", "allowed_cidrs",
            "created_by_name",
        ]
        read_only_fields = [
            "id", "prefix", "created_at", "last_used_at", "revoked_at",
            "is_active", "created_by_name",
        ]

    def get_created_by_name(self, obj) -> str:
        return getattr(obj.created_by, "username", "") or ""

    def validate_role(self, value):
        # An operator issuing themselves an owner key would be a privilege
        # escalation with no audit signal, so a key may not exceed the role of
        # whoever is creating it. Owners are unrestricted.
        actor_role = getattr(self.context["request"].user, "role", "")
        if actor_role != Role.OWNER and value in (Role.OWNER, Role.ADMIN):
            raise serializers.ValidationError(
                "You cannot issue a key with more access than your own role."
            )
        return value


class APIKeyViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """
    /api/v1/api-keys/ — issuing access to the console.

    This is how a non-technical administrator gives somebody access. Without
    it the only route was a Django shell, which is not a thing an office
    administrator can be asked to do.

    The secret is returned once, by `create`, and never again: only its SHA-256
    is stored, so nothing here can reproduce it. That is the same reason the
    UI has to make the operator copy it before leaving the screen.
    """

    queryset = APIKey.objects.all()
    serializer_class = APIKeySerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    # Issuing and revoking access is an ownership action, not an operational
    # one. Seeing which keys exist is deliberately wider: anyone who can be
    # asked "is this key yours?" should be able to look.
    required_capabilities = {
        "list": "org.manage",
        "retrieve": "org.manage",
        "create": "org.manage",
        "partial_update": "org.manage",
        "revoke": "org.manage",
        "default": "org.manage",
    }

    def get_queryset(self):
        return super().get_queryset().order_by("-created_at")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        key, raw = APIKey.generate(
            request.organization,
            name=serializer.validated_data["name"],
            role=serializer.validated_data.get("role", Role.OPERATOR),
            expires_at=serializer.validated_data.get("expires_at"),
            allowed_cidrs=serializer.validated_data.get("allowed_cidrs", []),
            created_by=request.user if hasattr(request.user, "_meta") else None,
        )
        self.audit("apikey.create", key, role=key.role, name=key.name)

        body = self.get_serializer(key).data
        # The only time this value exists in a response. Named distinctly from
        # the model's fields so it cannot be mistaken for something readable
        # later, and so a client that stores the object does not store it.
        body["secret"] = raw
        return Response(body, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        """
        Revoke rather than delete.

        A deleted key takes its audit trail's referent with it — "which key
        did this?" stops having an answer. Revoking leaves the row and stops
        the credential working from the next request.
        """
        key = self.get_object()
        if key.revoked_at:
            return Response(self.get_serializer(key).data)
        key.revoked_at = timezone.now()
        key.save(update_fields=["revoked_at"])
        self.audit("apikey.revoke", key, name=key.name)
        return Response(self.get_serializer(key).data)
