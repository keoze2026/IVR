"""API throttling (spec 11.3).

Throttles are keyed on the organisation, not the user: a tenant with fifty
operators should not get fifty times the quota.
"""

from rest_framework.throttling import SimpleRateThrottle


class _OrgScopedThrottle(SimpleRateThrottle):
    def get_cache_key(self, request, view):
        org = getattr(request, "organization", None)
        if org is None:
            return None  # unauthenticated requests are rejected before this
        return self.cache_format % {"scope": self.scope, "ident": str(org.pk)}


class OrganizationRateThrottle(_OrgScopedThrottle):
    scope = "org"


class BurstRateThrottle(_OrgScopedThrottle):
    scope = "burst"


class UploadRateThrottle(_OrgScopedThrottle):
    scope = "upload"


class CampaignControlThrottle(_OrgScopedThrottle):
    """Start/pause/stop. Tight, because each one moves real money."""

    scope = "campaign_control"
