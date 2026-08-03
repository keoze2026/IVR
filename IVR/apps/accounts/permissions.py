"""
Permission classes.

Two layers:

  IsOrganizationMember   the request resolves to exactly one organisation
  HasCapability          the principal's role grants the named capability

Views declare `required_capabilities` as a dict of {action: capability}; the
default is deny, so a new action added without a mapping is refused rather than
silently public.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsOrganizationMember(BasePermission):
    message = "No organisation is associated with this request."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return False

        org = getattr(request, "organization", None)
        if org is None:
            org = getattr(user, "organization", None)
            request.organization = org
        if org is None:
            return False
        if not org.is_active:
            self.message = "Organisation is inactive."
            return False
        return True

    def has_object_permission(self, request, view, obj):
        org = getattr(request, "organization", None)
        obj_org_id = getattr(obj, "organization_id", None)
        # Belt and braces: the queryset is already scoped, but an object fetched
        # by any other route must still be checked before it is returned.
        return org is not None and obj_org_id == org.pk


class HasCapability(BasePermission):
    message = "Your role does not permit this action."

    def has_permission(self, request, view):
        required = getattr(view, "required_capabilities", None)
        if not required:
            return True
        capability = required.get(view.action) if hasattr(view, "action") else None
        if capability is None:
            capability = required.get("default")
        if capability is None:
            # Unmapped action: allow reads, refuse writes.
            return request.method in SAFE_METHODS
        return request.user.has_capability(capability)


class IsComplianceOfficer(BasePermission):
    """For endpoints that must remain available even to a suspended tenant —
    opt-outs and erasure requests never stop being processable."""

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.has_capability(
            "compliance.edit"
        )
