#!/usr/bin/env bash
#
# Process dispatcher (spec 13.1).
#
# Each role gets its own concurrency and prefetch settings because the queues
# have genuinely different shapes:
#
#   pacer       many tiny tasks, latency-critical, must never queue
#   dispatch    one blocking HTTP call each; concurrency is about I/O wait
#   events      bursty, absorbs carrier retries, tolerant of lag
#   telemetry   droppable under load
#   maintenance long-running, low concurrency, must not starve the others
#
set -euo pipefail

ROLE="${1:-web}"
shift || true

wait_for() {
    local name="$1" host="$2" port="$3" tries=0
    until (echo > "/dev/tcp/${host}/${port}") 2>/dev/null; do
        tries=$((tries + 1))
        if [ "$tries" -gt 60 ]; then
            echo "timed out waiting for ${name} at ${host}:${port}" >&2
            exit 1
        fi
        sleep 1
    done
}

wait_for postgres "${POSTGRES_HOST:-postgres}" "${POSTGRES_PORT:-5432}"

case "$ROLE" in
  web)
      # Migrations run from the web role only, so N worker containers do not
      # race each other on the same DDL.
      if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
          python manage.py migrate --noinput
          python manage.py setup_partitions --months-ahead 3
      fi
      exec gunicorn config.wsgi:application \
          --bind 0.0.0.0:8000 \
          --workers "${WEB_WORKERS:-4}" \
          --worker-class uvicorn.workers.UvicornWorker \
          --max-requests 2000 \
          --max-requests-jitter 200 \
          --timeout 30 \
          --graceful-timeout 30 \
          --access-logfile - \
          --error-logfile -
      ;;

  asgi)
      # Websockets only. Separated from the sync API surface so a dashboard
      # holding 500 idle sockets cannot consume request workers.
      exec daphne -b 0.0.0.0 -p 8000 config.asgi:application
      ;;

  beat)
      exec celery -A config beat \
          --loglevel="${LOG_LEVEL:-info}" \
          --scheduler django_celery_beat.schedulers:DatabaseScheduler
      ;;

  pacer)
      # High concurrency, tiny tasks. prefetch 1 so a slow campaign's tick
      # cannot hold tokens destined for another campaign.
      exec celery -A config worker \
          --queues=pacer \
          --concurrency="${PACER_CONCURRENCY:-8}" \
          --prefetch-multiplier=1 \
          --max-tasks-per-child=5000 \
          --loglevel="${LOG_LEVEL:-info}"
      ;;

  dispatch)
      # Each task is one blocking HTTPS call to the carrier, so concurrency is
      # bounded by I/O wait, not CPU. The gevent pool would be better still;
      # the prefork pool is used here because the Twilio SDK is not guaranteed
      # green-thread safe across versions.
      exec celery -A config worker \
          --queues=dispatch \
          --concurrency="${DISPATCH_CONCURRENCY:-16}" \
          --prefetch-multiplier=1 \
          --max-tasks-per-child=2000 \
          --loglevel="${LOG_LEVEL:-info}"
      ;;

  events)
      exec celery -A config worker \
          --queues=events \
          --concurrency="${EVENTS_CONCURRENCY:-8}" \
          --prefetch-multiplier=4 \
          --max-tasks-per-child=5000 \
          --loglevel="${LOG_LEVEL:-info}"
      ;;

  telemetry)
      exec celery -A config worker \
          --queues=telemetry \
          --concurrency="${TELEMETRY_CONCURRENCY:-4}" \
          --prefetch-multiplier=8 \
          --loglevel="${LOG_LEVEL:-info}"
      ;;

  maintenance)
      # Low concurrency, long time limits. A 500k-row ingest lives here.
      exec celery -A config worker \
          --queues=maintenance \
          --concurrency="${MAINTENANCE_CONCURRENCY:-2}" \
          --prefetch-multiplier=1 \
          --max-tasks-per-child=50 \
          --loglevel="${LOG_LEVEL:-info}"
      ;;

  flower)
      exec celery -A config flower --port=5555
      ;;

  shell)
      exec python manage.py shell
      ;;

  *)
      exec "$ROLE" "$@"
      ;;
esac
