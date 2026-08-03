"""
API key authentication.

    Authorization: Bearer ivrk_<random>

Lookup is by SHA-256 of the presented key against a unique index — constant
time in the database and no plaintext at rest. `request.organization` is set
here and is the single source of truth for every downstream tenant filter.
"""

import ipaddress
import logging

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
