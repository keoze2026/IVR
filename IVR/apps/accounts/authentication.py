"""
API key authentication.

    Authorization: Bearer ivrk_<random>

Lookup is by SHA-256 of the presented key against a unique index — constant
time in the database and no plaintext at rest. `request.organization` is set
here and is the single source of truth for every downstream tenant filter.
"""

import hashlib
import ipaddress
import logging

from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import authentication, exceptions

from apps.accounts.models import APIKey

logger = logging.getLogger("ivr.api")


class APIKeyUser:
    """
    A non-persistent principal representing an API key.

    Duck-types the parts of the user contract DRF and the permission classes
    touch, so views do not need to care whether a request came from a session
    or a key.
    """

    is_authenticated = True
    is_anonymous = False
    is_active = True
    is_superuser = False
    is_staff = False

    def __init__(self, api_key: APIKey):
        self.api_key = api_key
        self.organization = api_key.organization
        self.role = api_key.role
        self.pk = f"apikey:{api_key.pk}"

    def __str__(self):
        return f"APIKey<{self.api_key.prefix}…>"

    def has_capability(self, capability: str) -> bool:
        from apps.accounts.models import ROLE_CAPABILITIES

        return capability in ROLE_CAPABILITIES.get(self.role, set())


class APIKeyAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Malformed Authorization header.")

        raw = header[1].decode()
        try:
            key = (
                APIKey.objects.select_related("organization")
                .get(key_hash=APIKey.hash_key(raw))
            )
        except APIKey.DoesNotExist:
            raise exceptions.AuthenticationFailed("Invalid API key.") from None

        if not key.is_active:
            raise exceptions.AuthenticationFailed("API key is revoked or expired.")
        if not key.organization.is_active:
            raise exceptions.AuthenticationFailed("Organisation is inactive.")

        self._check_source_ip(request, key)

        # Written unconditionally but cheaply; a UPDATE per request on a single
        # row is acceptable at this call volume and makes key rotation auditable.
        APIKey.objects.filter(pk=key.pk).update(last_used_at=timezone.now())

        user = APIKeyUser(key)
        request.organization = key.organization
        request.api_key = key
        return user, key

    @staticmethod
    def _check_source_ip(request, key: APIKey):
        if not key.allowed_cidrs:
            return
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        raw_ip = (forwarded.split(",")[0].strip() if forwarded
                  else request.META.get("REMOTE_ADDR", ""))
        try:
            addr = ipaddress.ip_address(raw_ip)
        except ValueError:
            raise exceptions.AuthenticationFailed("Unresolvable source address.") from None
        for cidr in key.allowed_cidrs:
            try:
                if addr in ipaddress.ip_network(cidr, strict=False):
                    return
            except ValueError:
                continue
        logger.warning(
            "api key used from disallowed address",
            extra={"key_prefix": key.prefix, "ip": raw_ip},
        )
        raise exceptions.AuthenticationFailed("Source address not permitted for this key.")

    def authenticate_header(self, request):
        return self.keyword


# ---------------------------------------------------------------------------
# Human sessions
# ---------------------------------------------------------------------------

#: Prefix distinguishing a person's session token from a machine's API key, so
#: the two authentication classes never have to guess which they are holding.
USER_TOKEN_PREFIX = "ivrt_"  # noqa: S105 - a prefix, not a secret

#: Session lifetime. Short enough that a token copied off a shared screen stops
#: working the same day, long enough not to interrupt a shift.
USER_TOKEN_MAX_AGE = 12 * 60 * 60


def issue_user_token(user) -> str:
    """
    Mint a signed session token for a human.

    Signed rather than stored: there is no row to look up, so a token cannot be
    left valid by a failed delete, and no table grows with every login. The
    password hash is folded into the payload, which means changing or resetting
    somebody's credential invalidates every token they hold — the property that
    makes "remove their access" actually remove it.
    """
    from django.core.signing import TimestampSigner

    signer = TimestampSigner(salt="ivr.user-token")
    fingerprint = hashlib.sha256(user.password.encode()).hexdigest()[:16]
    return USER_TOKEN_PREFIX + signer.sign(f"{user.pk}:{fingerprint}")


class UserTokenAuthentication(authentication.BaseAuthentication):
    """
    Authenticates a person holding a token from `issue_user_token`.

    Sits alongside APIKeyAuthentication rather than replacing it: machines keep
    using long-lived keys, people get a session that expires.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        from django.core.signing import BadSignature, SignatureExpired, TimestampSigner

        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None
        if len(header) != 2:
            return None

        raw = header[1].decode()
        if not raw.startswith(USER_TOKEN_PREFIX):
            # An API key. Let APIKeyAuthentication have it.
            return None

        signer = TimestampSigner(salt="ivr.user-token")
        try:
            payload = signer.unsign(
                raw[len(USER_TOKEN_PREFIX):], max_age=USER_TOKEN_MAX_AGE
            )
        except SignatureExpired:
            raise exceptions.AuthenticationFailed("Session expired.") from None
        except BadSignature:
            raise exceptions.AuthenticationFailed("Invalid session.") from None

        user_id, _, fingerprint = payload.partition(":")
        from apps.accounts.models import User

        try:
            user = User.objects.select_related("organization").get(pk=user_id)
        except (User.DoesNotExist, ValueError, ValidationError):
            raise exceptions.AuthenticationFailed("Invalid session.") from None

        if not user.is_active:
            raise exceptions.AuthenticationFailed("This account is disabled.")
        if hashlib.sha256(user.password.encode()).hexdigest()[:16] != fingerprint:
            # The credential changed after this token was issued.
            raise exceptions.AuthenticationFailed("Session no longer valid.")

        # A platform administrator has no organisation; everyone else is scoped
        # to theirs, exactly as an API key would be.
        request.organization = user.organization
        request.api_key = None
        User.objects.filter(pk=user.pk).update(last_seen_at=timezone.now())
        return user, None
