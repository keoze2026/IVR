"""
Base model classes and the tenancy guard (spec 4.2, 3.1).

The guard exists because "forgot the organisation filter" is a data-breach class
defect, not a bug. Rather than trusting every future queryset author, the
default manager on a tenant model refuses to materialise a queryset that has not
been explicitly scoped.

Escape hatches, all explicit and greppable:

    Model.objects.for_org(org)      normal application access
    Model.objects.unscoped()        deliberate cross-tenant access (pacer,
                                    reconciliation, admin, migrations)
    Model.unfiltered.all()          plain Django manager, no guard

Related-object access (``campaign.calls.all()``) is implicitly scoped: it is
already constrained by a foreign key to a row whose tenancy was checked when it
was fetched.
"""

import logging
import uuid

from django.conf import settings
from django.db import models

logger = logging.getLogger("ivr.tenancy")


class UnscopedTenantQueryError(RuntimeError):
    """Raised when a tenant queryset is evaluated without an org filter."""


class TenantQuerySet(models.QuerySet):
    """QuerySet that tracks whether it has been scoped to an organisation."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._tenant_scoped = False

    def _clone(self, *args, **kwargs):
        clone = super()._clone(*args, **kwargs)
        clone._tenant_scoped = self._tenant_scoped
        return clone

    # --- scoping -------------------------------------------------------
    def for_org(self, org):
        """Scope to one organisation. Accepts an Organization or its pk."""
        org_id = getattr(org, "pk", org)
        qs = self.filter(organization_id=org_id)
        qs._tenant_scoped = True
        return qs

    def for_orgs(self, orgs):
        ids = [getattr(o, "pk", o) for o in orgs]
        qs = self.filter(organization_id__in=ids)
        qs._tenant_scoped = True
        return qs

    def unscoped(self):
        """Deliberate cross-tenant access. Every call site should justify itself."""
        qs = self._clone()
        qs._tenant_scoped = True
        return qs

    # --- guard ---------------------------------------------------------
    def _check_scoped(self):
        if self._tenant_scoped:
            return
        # A filter on organization by any route counts as scoped; this catches
        # `.filter(organization_id=x)` written directly.
        if self._has_organization_filter():
            return
        msg = (
            f"Unscoped queryset on tenant model {self.model.__name__}. "
            f"Use .for_org(org) or .unscoped() explicitly."
        )
        if getattr(settings, "TENANCY_STRICT", False):
            raise UnscopedTenantQueryError(msg)
        logger.critical(msg, extra={"model": self.model.__name__})

    def _has_organization_filter(self) -> bool:
        try:
            children = self.query.where.children
        except AttributeError:  # pragma: no cover
            return False
        return any(
            getattr(getattr(c, "lhs", None), "target", None) is not None
            and getattr(c.lhs.target, "name", "") == "organization"
            for c in children
        )

    def _fetch_all(self):
        if not self._result_cache:
            self._check_scoped()
        super()._fetch_all()

    def count(self):
        self._check_scoped()
        return super().count()

    def exists(self):
        self._check_scoped()
        return super().exists()


class TenantManager(models.Manager.from_queryset(TenantQuerySet)):
    """Default manager for tenant models."""

    def get_queryset(self):
        qs = super().get_queryset()
        # Related managers (campaign.calls) set `instance`; their queryset is
        # already constrained by FK to an object whose tenancy was checked.
        if getattr(self, "instance", None) is not None:
            qs._tenant_scoped = True
        return qs


class TimestampedModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TenantModel(TimestampedModel):
    organization = models.ForeignKey(
        "accounts.Organization", on_delete=models.CASCADE, related_name="+"
    )

    # Declared before `unfiltered` on purpose: Django takes the first
    # declared manager as _default_manager, and the guard must be it.
    objects = TenantManager()  # noqa: DJ012
    #: Plain manager with no guard. Used as base_manager_name so that Django's
    #: own related-object machinery (FK descriptors, deletion collector,
    #: migrations) never trips the guard.
    unfiltered = models.Manager()

    class Meta:
        abstract = True
        base_manager_name = "unfiltered"


class SoftDeleteModel(models.Model):
    """Retention-aware soft delete. Hard deletion happens via the retention job."""

    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        abstract = True

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
