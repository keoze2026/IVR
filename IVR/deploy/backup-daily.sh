#!/usr/bin/env bash
#
# Daily database backup. Run on the server by cron.
#
# Writes a compressed dump, checks that it can be read back, and keeps two
# weeks of them. Set BACKUP_REMOTE (an scp destination such as
# user@host:/folder) in /etc/ivr-monitor.env to also copy each one off this
# server; a backup that lives only here is lost with the server.
#
# Restore:  docker exec -i ivr-platform-postgres-1 \
#             sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean' < file
#
# Call recordings and uploaded audio are in object storage and are not included.
#
set -euo pipefail

CONFIG="${MONITOR_CONFIG:-/etc/ivr-monitor.env}"
[ -f "$CONFIG" ] && . "$CONFIG"

CONTAINER="${BACKUP_CONTAINER:-ivr-platform-postgres-1}"
BACKUP_DIR="${BACKUP_DIR:-/root/ivr-backups}"
KEEP_DAYS="${BACKUP_RETENTION_DAYS:-14}"

umask 077
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/ivr-$(date -u +%Y%m%d-%H%M%S).dump"
partial="$file.partial"

docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial"

if [ ! -s "$partial" ] || ! docker exec -i "$CONTAINER" pg_restore --list < "$partial" > /dev/null; then
    echo "$(date -u '+%F %T') BACKUP FAILED: $partial is empty or unreadable" >&2
    exit 1
fi
mv "$partial" "$file"
echo "$(date -u '+%F %T') backup written: $file ($(du -h "$file" | cut -f1))"

# Only after a good backup exists are old ones removed.
find "$BACKUP_DIR" -maxdepth 1 -name 'ivr-*.dump' -mtime "+$KEEP_DAYS" -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
    scp -q -o BatchMode=yes "$file" "$BACKUP_REMOTE/" \
        && echo "copied to $BACKUP_REMOTE" \
        || { echo "$(date -u '+%F %T') copy to $BACKUP_REMOTE FAILED" >&2; exit 1; }
fi
