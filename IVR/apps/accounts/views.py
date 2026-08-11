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

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ROLE_CAPABILITIES, APIKey


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
