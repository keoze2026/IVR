"""Query-string filtering that stays inside the caller's organisation."""

from django_filters.rest_framework import DjangoFilterBackend


class TenantFilterBackend(DjangoFilterBackend):
    """
    `?campaign=<id>` and the like first look the named record up.

    That lookup is a query on a tenant model like any other, so it is scoped to
    the caller's organisation. Another organisation's id is rejected.
    """

    def get_filterset(self, request, queryset, view):
        filterset = super().get_filterset(request, queryset, view)
        org = getattr(request, "organization", None)
        if filterset is None or org is None:
            return filterset
        for item in filterset.filters.values():
            choices = getattr(item, "queryset", None)
            if hasattr(choices, "for_org"):
                item.queryset = choices.for_org(org)
        return filterset
