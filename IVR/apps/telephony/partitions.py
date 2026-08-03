"""
Monthly partition management for telephony_callevent (spec 4.8).

Django does not manage native partitioning, so the parent table is created in a
RunSQL migration and children are provisioned here. Two operations, both
idempotent and both safe to run from a scheduled task:

    ensure_partitions()          create this month and the next N
    drop_partitions_older_than() drop children entirely past retention

DROP TABLE on a child is O(1) and returns the disk. A DELETE over a month of
raw callbacks — roughly eight million rows for a single large campaign — takes
minutes, generates as much WAL as the data it removes, and leaves the table
bloated until a VACUUM FULL nobody schedules.
"""

from __future__ import annotations

import datetime as dt
import logging
import re

from django.db import connection

logger = logging.getLogger("ivr.webhook")

PARENT_TABLE = "telephony_callevent"
CHILD_RE = re.compile(rf"^{PARENT_TABLE}_(\d{{4}})_(\d{{2}})$")


def _month_bounds(year: int, month: int) -> tuple[dt.date, dt.date]:
    start = dt.date(year, month, 1)
    end = dt.date(year + (month // 12), (month % 12) + 1, 1)
    return start, end


def partition_name(day: dt.date) -> str:
    return f"{PARENT_TABLE}_{day.year:04d}_{day.month:02d}"


def existing_partitions() -> set[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.relname
            FROM pg_class c
            JOIN pg_inherits i ON i.inhrelid = c.oid
            JOIN pg_class p ON p.oid = i.inhparent
            WHERE p.relname = %s
            """,
            [PARENT_TABLE],
        )
        return {row[0] for row in cursor.fetchall()}


def ensure_partitions(months_ahead: int = 3, today: dt.date | None = None) -> list[str]:
    """Create the current month's partition and the next `months_ahead`."""
    today = today or dt.date.today()
    existing = existing_partitions()
    created = []

    for offset in range(0, months_ahead + 1):
        month = today.month + offset
        year = today.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        start, end = _month_bounds(year, month)
        name = partition_name(start)
        if name in existing:
            continue
        with connection.cursor() as cursor:
            # Identifiers are derived from integers, never from user input.
            cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {name}
                PARTITION OF {PARENT_TABLE}
                FOR VALUES FROM (%s) TO (%s)
                """,
                [start.isoformat(), end.isoformat()],
            )
        created.append(name)
        logger.info("created partition", extra={"partition": name})
    return created


def drop_partitions_older_than(retention_days: int,
                               today: dt.date | None = None) -> list[str]:
    """
    Drop partitions whose entire range predates the retention horizon.

    A partition is dropped only when its *upper* bound is older than the
    cutoff, so the month containing the cutoff is always kept whole.
    """
    today = today or dt.date.today()
    cutoff = today - dt.timedelta(days=retention_days)
    dropped = []

    for name in sorted(existing_partitions()):
        match = CHILD_RE.match(name)
        if not match:
            continue
        year, month = int(match.group(1)), int(match.group(2))
        _, end = _month_bounds(year, month)
        if end > cutoff:
            continue
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {name}")
        dropped.append(name)
        logger.info("dropped partition", extra={"partition": name})
    return dropped


def partition_report() -> list[dict]:
    """Size and row estimate per partition, for the ops dashboard."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.relname,
                   pg_size_pretty(pg_total_relation_size(c.oid)),
                   c.reltuples::bigint
            FROM pg_class c
            JOIN pg_inherits i ON i.inhrelid = c.oid
            JOIN pg_class p ON p.oid = i.inhparent
            WHERE p.relname = %s
            ORDER BY c.relname
            """,
            [PARENT_TABLE],
        )
        return [
            {"partition": name, "size": size, "estimated_rows": rows}
            for name, size, rows in cursor.fetchall()
        ]
