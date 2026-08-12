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


#: Failed sign-ins tolerated before an account is frozen. Five characters is
#: only safe behind a counter like this.
LOGIN_MAX_ATTEMPTS = 6

#: The per-address limit is deliberately far looser than the per-account one.
#:
#: A whole office arrives from one address, and behind the portal every sign-in
#: reaches this endpoint from the same place. A tight limit here would let one
#: person fumbling their code lock out everybody sitting next to them — a
#: denial of service anyone could trigger by accident. The account limit is the
#: real protection; this one exists only to make a spray across many usernames
#: expensive.
LOGIN_MAX_ATTEMPTS_PER_ADDRESS = 60
LOGIN_LOCKOUT_SECONDS = 15 * 60


class LoginView(APIView):
    """
    `POST /api/v1/auth/login/` — username and password, for a person.

    The only unauthenticated endpoint in the API. It exists because a human
    cannot be issued a credential by a system they cannot yet reach: something
    has to accept a password. Machines keep using API keys and never come here.

    Failures are deliberately indistinguishable. "No such user" and "wrong
    password" tell an attacker which half they have already guessed, and the
    legitimate user cannot act on the difference anyway.
    """

    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request):
        from django.contrib.auth import authenticate

        from apps.accounts.authentication import issue_user_token

        username = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""

        refused = Response(
            {"error": {"code": "invalid_credentials",
                       "message": "Those details were not accepted."}},
            status=status.HTTP_401_UNAUTHORIZED,
        )
        if not username or not password:
            return refused

        # Rate limit before authenticating, not after.
        #
        # An employee access code is five characters, which is short enough to
        # guess offline in seconds and therefore only safe behind a counter.
        # Keyed on the username so one account being attacked cannot lock the
        # rest of the office out, and on the source address so a spray across
        # many usernames is caught too.
        from django.core.cache import cache

        source = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
        source = source or request.META.get("REMOTE_ADDR", "")
        buckets = [
            (f"login-fail:user:{username.lower()}", LOGIN_MAX_ATTEMPTS),
            (f"login-fail:ip:{source}", LOGIN_MAX_ATTEMPTS_PER_ADDRESS),
        ]
        if any((cache.get(name) or 0) >= limit for name, limit in buckets):
            return Response(
                {"error": {
                    "code": "too_many_attempts",
                    "message": (
                        "Too many failed attempts. Wait 15 minutes, or ask an "
                        "administrator to issue a new code."
                    ),
                }},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        user = authenticate(request, username=username, password=password)
        if user is None or not user.is_active:
            for name, _limit in buckets:
                # add() then incr() so the window starts at the first failure
                # and is not extended by later ones — a fixed cooling-off
                # period rather than one an attacker can keep pushing back.
                if cache.add(name, 1, LOGIN_LOCKOUT_SECONDS) is False:
                    try:
                        cache.incr(name)
                    except ValueError:
                        cache.set(name, 1, LOGIN_LOCKOUT_SECONDS)
            return refused

        # Only the account's own counter is cleared. Leaving the address
        # counter alone means an attacker cannot reset it by signing in
        # successfully as themselves between attempts.
        cache.delete(buckets[0][0])

        return Response(
            {
                "token": issue_user_token(user),
                "user": {
                    "id": str(user.pk),
                    "username": user.get_username(),
                    "email": user.email,
                    "role": user.role,
                    "is_superuser": user.is_superuser,
                    "organization": str(user.organization_id)
                    if user.organization_id
                    else None,
                },
            }
        )


# ---------------------------------------------------------------------------
# Employee accounts
# ---------------------------------------------------------------------------

#: Characters an access code is drawn from.
#:
#: No 0/O, 1/I/L, 5/S, 8/B. Codes get read aloud down a phone and copied off a
#: screen by hand, and every one of those pairs is a support call waiting to
#: happen. Losing eight symbols costs about a bit of entropy; the code is not
#: the only credential, so that is the right trade.
CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY2346799"
CODE_LENGTH = 5


def generate_access_code() -> str:
    import secrets

    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


class EmployeeSerializer(serializers.ModelSerializer):
    """A person who signs in to the campaigns portal."""

    full_name = serializers.SerializerMethodField()
    has_code = serializers.SerializerMethodField()

    class Meta:
        from apps.accounts.models import User

        model = User
        fields = [
            "id", "username", "first_name", "last_name", "email", "role",
            "organization", "is_active", "last_seen_at", "full_name", "has_code",
        ]
        read_only_fields = ["id", "last_seen_at", "full_name", "has_code"]

    def get_full_name(self, obj) -> str:
        return f"{obj.first_name} {obj.last_name}".strip() or obj.username

    def get_has_code(self, obj) -> bool:
        return bool(obj.password)


class EmployeeViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """
    /api/v1/employees/ — the people in this organisation who can sign in.

    An access code is issued once, when the account is created, and shown once.
    Only its hash is kept, so "show me their code again" has no answer — the
    only remedy for a lost code is issuing a new one, which is deliberate: a
    code that can be looked up later is a code that can be looked up by the
    wrong person.
    """

    serializer_class = EmployeeSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    required_capabilities = {
        "list": "org.manage",
        "retrieve": "org.manage",
        "create": "org.manage",
        "partial_update": "org.manage",
        "reset_code": "org.manage",
        "default": "org.manage",
    }

    def get_queryset(self):
        from apps.accounts.models import User

        return (
            User.objects.filter(
                organization=self.request.organization, is_superuser=False
            )
            .order_by("first_name", "username")
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from apps.accounts.models import User

        code = generate_access_code()
        user = User.objects.create_user(
            username=serializer.validated_data["username"],
            email=serializer.validated_data.get("email", ""),
            first_name=serializer.validated_data.get("first_name", ""),
            last_name=serializer.validated_data.get("last_name", ""),
            password=code,
            organization=request.organization,
            role=serializer.validated_data.get("role", Role.OPERATOR),
        )
        self.audit("employee.create", user, role=user.role)

        body = self.get_serializer(user).data
        body["access_code"] = code
        return Response(body, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="reset-code")
    def reset_code(self, request, pk=None):
        """Issue a replacement code. The previous one stops working at once."""
        user = self.get_object()
        code = generate_access_code()
        user.set_password(code)
        user.save(update_fields=["password"])
        self.audit("employee.reset_code", user)

        body = self.get_serializer(user).data
        body["access_code"] = code
        return Response(body)
