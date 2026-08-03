"""
DRF view mixins that make tenant scoping structural rather than remembered.

`TenantViewSetMixin.get_queryset` is the only place in the API that decides
which organisation's rows a request can see. Subclasses supply `queryset` and
never override `get_queryset` without calling super().

`get_serializer` closes the other half of the same question. `get_queryset`
governs the rows a request may *read*; it says nothing about the primary keys
a request body may *name*. Both are done here rather than per-serialiser so
that a new endpoint is scoped by construction.
"""

from rest_framework.exceptions import NotAuthenticated

from apps.common.serializers import (
    add_org_scoped_unique_validators,
    scope_related_fields,
)


class TenantViewSetMixin:
    """Scopes every queryset — and every writable relation — to request.organization."""

    def get_queryset(self):
        org = getattr(self.request, "organization", None)
        if org is None:
            raise NotAuthenticated("No organisation resolved for this request.")
        qs = super().get_queryset()
        if hasattr(qs, "for_org"):
            return qs.for_org(org)
        return qs.filter(organization=org)

    def get_serializer(self, *args, **kwargs):
        """Restrict relational fields to the caller's own rows.

        Without this a tenant can pin another tenant's caller ID, contact list
        or flow version to its own campaign by naming the id in the body.
        """
        serializer = super().get_serializer(*args, **kwargs)
        org = getattr(self.request, "organization", None)
        if org is not None:
            scope_related_fields(serializer, org)
            add_org_scoped_unique_validators(serializer, org)
        return serializer

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


class AuditedActionMixin:
    """Records who triggered a state-changing action, for the audit trail."""

    def audit(self, action: str, target, **extra):
        """Attribute the action to a user or to an API key, whichever it was.

        API-key requests carry an `APIKeyUser`, which duck-types the user
        contract but is not a `User` row, so assigning it to `actor` raises.
        `AuditLogEntry` has a separate `api_key` FK for exactly this case —
        machine credentials are the normal way this API is driven, and an
        audit trail that 500s on them records nothing at all.
        """
        from apps.accounts.models import AuditLogEntry
        from apps.common.utils import acting_user

        AuditLogEntry.objects.create(
            organization=self.request.organization,
            actor=acting_user(self.request),
            api_key=getattr(self.request, "api_key", None),
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
