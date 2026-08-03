"""
Admin base class.

Tenant models guard their default manager, which the stock ModelAdmin would
trip on every changelist. Admin is deliberately cross-tenant (it is a support
tool), so it opts out explicitly and every access is logged.
"""

import logging

from django.contrib import admin

logger = logging.getLogger("ivr.tenancy")


class TenantModelAdmin(admin.ModelAdmin):
    list_select_related = ("organization",)

    def get_queryset(self, request):
        qs = self.model._default_manager.get_queryset()
        if hasattr(qs, "unscoped"):
            qs = qs.unscoped()
        logger.info(
            "cross-tenant admin access",
            extra={"model": self.model.__name__, "user": str(request.user)},
        )
        return qs
