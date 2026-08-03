"""
Create the partitioned telephony_callevent table and its initial partitions.

Why this is a management command and not a model migration
----------------------------------------------------------
Django does not manage native partitioning. The table has to be created with
PARTITION BY RANGE, its primary key has to include the partition key, and its
unique index has to include it too — none of which the ORM can express. The
model is declared `managed = False` for exactly this reason, so `migrate` will
never try to own this table.

Run order on a fresh database:

    manage.py migrate
    manage.py setup_partitions

Both are idempotent. `setup_partitions` is also safe to run on every deploy,
and deploy/entrypoint.sh does exactly that so a missed partition can never
become an insert error on every webhook.
"""

from django.core.management.base import BaseCommand
from django.db import connection

DDL = """
CREATE TABLE IF NOT EXISTS telephony_callevent (
    id                bigserial   NOT NULL,
    call_id           uuid        NOT NULL,
    provider_call_sid varchar(64) NOT NULL,
    event_type        varchar(32) NOT NULL,
    sequence_number   integer,
    payload           jsonb       NOT NULL,
    signature_valid   boolean     NOT NULL DEFAULT false,
    received_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);

-- Idempotency backstop for callbacks that slipped past the Redis dedupe.
-- The partition key has to be part of every unique index on a partitioned
-- table, which is why received_at appears here even though it is not part of
-- the logical key.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_call_event
    ON telephony_callevent (provider_call_sid, event_type, sequence_number,
                            received_at);

CREATE INDEX IF NOT EXISTS idx_callevent_sid
    ON telephony_callevent (provider_call_sid);

CREATE INDEX IF NOT EXISTS idx_callevent_call
    ON telephony_callevent (call_id);

-- BRIN is the right call on an append-only, time-ordered partition:
-- roughly a thousandth the size of a btree for the same range-scan
-- performance. A btree here would be several GB per month for no benefit.
CREATE INDEX IF NOT EXISTS idx_callevent_brin
    ON telephony_callevent USING BRIN (received_at) WITH (pages_per_range = 64);
"""


class Command(BaseCommand):
    help = "Create the partitioned call-event table and provision partitions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--months-ahead", type=int, default=3,
            help="How many future monthly partitions to create (default 3).",
        )
        parser.add_argument(
            "--drop-expired", action="store_true",
            help="Also drop partitions past the retention horizon.",
        )

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute(DDL)
        self.stdout.write(self.style.SUCCESS("Parent table and indexes ensured"))

        from apps.telephony.partitions import (
            drop_partitions_older_than,
            ensure_partitions,
            partition_report,
        )

        created = ensure_partitions(months_ahead=options["months_ahead"])
        for name in created:
            self.stdout.write(f"  created {name}")
        if not created:
            self.stdout.write("  all partitions already present")

        if options["drop_expired"]:
            from django.conf import settings

            dropped = drop_partitions_older_than(settings.CALL_EVENT_RETENTION_DAYS)
            for name in dropped:
                self.stdout.write(self.style.WARNING(f"  dropped {name}"))

        self.stdout.write("")
        for row in partition_report():
            self.stdout.write(
                f"  {row['partition']:<32} {row['size']:>10}  "
                f"~{row['estimated_rows']} rows"
            )
