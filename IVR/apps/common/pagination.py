"""
Pagination.

Call logs are the only high-cardinality collection an operator browses, and
they are strictly time-ordered, so cursor pagination is both cheaper and
correct under concurrent inserts. Offset pagination on a table receiving
20 rows/second silently skips and repeats rows.
"""

from rest_framework.pagination import CursorPagination as DRFCursorPagination
from rest_framework.pagination import PageNumberPagination


class CursorPagination(DRFCursorPagination):
    page_size = 50
    max_page_size = 500
    page_size_query_param = "page_size"
    ordering = "-created_at"


class SmallPageNumberPagination(PageNumberPagination):
    """For small, human-sized collections: campaigns, flows, caller IDs."""

    page_size = 25
    max_page_size = 200
    page_size_query_param = "page_size"

    def paginate_queryset(self, queryset, request, view=None):
        # Pages of an unordered query can repeat some rows and skip others.
        # Anything without an order of its own is listed newest first.
        if getattr(queryset, "ordered", True) is False:
            names = {f.name for f in queryset.model._meta.fields}
            queryset = queryset.order_by(
                *(["-created_at", "-pk"] if "created_at" in names else ["-pk"])
            )
        return super().paginate_queryset(queryset, request, view=view)
