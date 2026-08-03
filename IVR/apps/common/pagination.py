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
