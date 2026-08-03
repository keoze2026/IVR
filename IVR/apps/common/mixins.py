"""
DRF view mixins that make tenant scoping structural rather than remembered.

`TenantViewSetMixin.get_queryset` is the only place in the API that decides
which organisation's rows a request can see. Subclasses supply `queryset` and
never override `get_queryset` without calling super().
"""

from rest_framework.exceptions import NotAuthenticated


class TenantViewSetMixin:
    """Scopes every queryset to request.organization."""

    def get_queryset(self):
        org = getattr(self.request, "organization", None)
        if org is None:
            raise NotAuthenticated("No organisation resolved for this request.")
        qs = super().get_queryset()
        if hasattr(qs, "for_org"):
            return qs.for_org(org)
        return qs.filter(organization=org)

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


class AuditedActionMixin:
    """Records who triggered a state-changing action, for the audit trail."""

    def audit(self, action: str, target, **extra):
        from apps.accounts.models import AuditLogEntry

        AuditLogEntry.objects.create(
            organization=self.request.organization,
            actor=self.request.user if self.request.user.is_authenticated else None,
            action=action,
            target_type=target.__class__.__name__,
            target_id=str(getattr(target, "pk", "")),
            metadata=extra,
            ip_address=_client_ip(self.request),
        )


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
