#!/usr/bin/env bash
#
# Postgres backup, restore and restore-verification.
#
# An untested backup is not a backup, so the verify path here does not inspect
# the dump file — it restores into a throwaway database and asserts the schema
# and row counts came back. That is the only check that proves anything.
#
# Usage:
#   ./scripts/backup.sh dump                  write a new dump to $BACKUP_DIR
#   ./scripts/backup.sh verify [file]         restore into a scratch DB and check
#   ./scripts/backup.sh restore <file> <db>   restore into a named database
#   ./scripts/backup.sh list                  list dumps, newest first
#
# Reads POSTGRES_* from .env, matching the rest of the project.
#
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ -f .env ]; then
    set -a; . ./.env; set +a
fi

PGHOST="${POSTGRES_HOST:-127.0.0.1}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-ivr}"
PGDATABASE="${POSTGRES_DB:-ivr}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"
export PGHOST PGPORT PGUSER

die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[32m%s\033[0m\n' "$*"; }
info(){ printf '  %s\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found — install postgresql-client"; }
need pg_dump; need psql; need pg_restore

# ---------------------------------------------------------------------------
do_dump() {
    mkdir -p "$BACKUP_DIR"
    local stamp file
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    file="$BACKUP_DIR/${PGDATABASE}-${stamp}.dump"

    # Custom format: compressed, and pg_restore can be selective on it. -Fc is
    # what makes the partitioned call-event table restorable without replaying
    # a multi-gigabyte text stream.
    pg_dump -d "$PGDATABASE" -Fc --no-owner --no-privileges -f "$file"

    [ -s "$file" ] || die "dump produced an empty file"
    ok "wrote $file ($(du -h "$file" | cut -f1))"

    if [ "$RETENTION_DAYS" -gt 0 ]; then
        local pruned
        pruned=$(find "$BACKUP_DIR" -name "${PGDATABASE}-*.dump" -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
        [ "$pruned" -gt 0 ] && info "pruned $pruned dump(s) older than ${RETENTION_DAYS}d"
    fi
    echo "$file"
}

latest_dump() {
    ls -1t "$BACKUP_DIR"/${PGDATABASE}-*.dump 2>/dev/null | head -1
}

do_list() {
    ls -1lht "$BACKUP_DIR"/${PGDATABASE}-*.dump 2>/dev/null || die "no dumps in $BACKUP_DIR"
}

do_restore() {
    local file="$1" target="$2"
    [ -f "$file" ] || die "no such dump: $file"

    # --clean would drop objects in a database that may not be a scratch one.
    # Creating the target fresh is the only safe default; refusing to touch an
    # existing database is deliberate.
    if psql -d postgres -tAc "select 1 from pg_database where datname='$target'" | grep -q 1; then
        die "database '$target' already exists — drop it first, or pick another name"
    fi
    psql -d postgres -q -c "create database \"$target\""
    pg_restore -d "$target" --no-owner --no-privileges "$file" >/dev/null
    ok "restored $file into '$target'"
}

# Restore into a scratch database, compare against the live one, drop it again.
do_verify() {
    local file="${1:-$(latest_dump)}"
    [ -n "$file" ] && [ -f "$file" ] || die "no dump to verify (run: $0 dump)"

    local scratch="verify_restore_$$"
    info "verifying $file"
    # shellcheck disable=SC2064
    trap "psql -d postgres -q -c 'drop database if exists \"$scratch\"' >/dev/null 2>&1 || true" EXIT

    psql -d postgres -q -c "create database \"$scratch\""
    pg_restore -d "$scratch" --no-owner --no-privileges "$file" >/dev/null 2>&1 || true

    local live_tables restored_tables
    live_tables=$(psql -d "$PGDATABASE" -tAc \
        "select count(*) from information_schema.tables where table_schema='public'")
    restored_tables=$(psql -d "$scratch" -tAc \
        "select count(*) from information_schema.tables where table_schema='public'")

    info "tables: live=$live_tables restored=$restored_tables"
    [ "$restored_tables" -gt 0 ] || die "restored database has no tables — the dump is unusable"
    [ "$live_tables" = "$restored_tables" ] \
        || die "table count differs (live $live_tables, restored $restored_tables)"

    # Row counts on the tables that would actually hurt to lose. A schema-only
    # restore passes the check above and still loses every suppression record.
    local mismatch=0
    for t in compliance_dncentry contacts_consentrecord contacts_contact \
             campaigns_campaign telephony_calllog accounts_organization; do
        if psql -d "$PGDATABASE" -tAc "select to_regclass('public.$t')" | grep -q .; then
            local a b
            a=$(psql -d "$PGDATABASE" -tAc "select count(*) from $t" 2>/dev/null || echo skip)
            b=$(psql -d "$scratch"    -tAc "select count(*) from $t" 2>/dev/null || echo skip)
            [ "$a" = skip ] && continue
            if [ "$a" != "$b" ]; then
                printf '  \033[31mMISMATCH\033[0m %-36s live=%s restored=%s\n' "$t" "$a" "$b"
                mismatch=1
            else
                info "$(printf '%-36s %s rows' "$t" "$a")"
            fi
        fi
    done
    [ "$mismatch" -eq 0 ] || die "row counts differ — this backup would lose data"

    ok "restore verified: schema and row counts match"
}

case "${1:-}" in
    dump)    do_dump ;;
    verify)  do_verify "${2:-}" ;;
    restore) [ $# -eq 3 ] || die "usage: $0 restore <file> <target-db>"; do_restore "$2" "$3" ;;
    list)    do_list ;;
    *)       sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
