#!/usr/bin/env bash
#
# Is the platform up? Run on the server every few minutes by cron.
#
# Checks the public site, the call webhook, every service, disk space and the
# age of the last backup. A message is sent when something breaks and again when
# it recovers, not on every run.
#
# Where to send it, in /etc/ivr-monitor.env (any one is enough):
#   ALERT_TELEGRAM_BOT_TOKEN=...   ALERT_TELEGRAM_CHAT_ID=...
#   ALERT_WEBHOOK_URL=...          a Slack or Discord incoming webhook
# Without either, problems are only written to the log.
#
# This runs on the server it watches, so it cannot report the whole server
# being down. Use an outside uptime service for that.
#
set -uo pipefail

CONFIG="${MONITOR_CONFIG:-/etc/ivr-monitor.env}"
[ -f "$CONFIG" ] && . "$CONFIG"

SITE="${MONITOR_SITE:-https://voiceecho.io}"
PROJECT="${MONITOR_PROJECT:-ivr-platform}"
STATE="${MONITOR_STATE:-/var/tmp/ivr-monitor.state}"
LOG="${MONITOR_LOG:-/var/log/ivr-monitor.log}"
BACKUP_DIR="${BACKUP_DIR:-/root/ivr-backups}"
DISK_LIMIT="${MONITOR_DISK_LIMIT:-90}"
SERVICES="postgres redis minio web asgi beat pacer dispatch events telemetry maintenance client nginx"

problems=()

code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$SITE/")
[ "$code" = 200 ] || problems+=("portal answers $code")

# An unsigned request must be refused: 403 shows the app received it.
code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST "$SITE/webhooks/telnyx/ivr/entry/")
[ "$code" = 403 ] || problems+=("call webhook answers $code")

for service in $SERVICES; do
    states=$(docker ps -a \
        --filter "label=com.docker.compose.project=$PROJECT" \
        --filter "label=com.docker.compose.service=$service" \
        --format '{{.State}}|{{.Status}}')
    if [ -z "$states" ]; then
        problems+=("$service is missing")
    elif printf '%s\n' "$states" | grep -qv '^running|'; then
        problems+=("$service is not running")
    elif printf '%s\n' "$states" | grep -q '(unhealthy)'; then
        problems+=("$service is unhealthy")
    fi
done

used=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')
[ -n "$used" ] && [ "$used" -ge "$DISK_LIMIT" ] && problems+=("disk is ${used}% full")

if [ -z "$(find "$BACKUP_DIR" -name '*.dump' -mmin -1560 2>/dev/null | head -1)" ]; then
    problems+=("no database backup in the last 26 hours")
fi

now=""
[ "${#problems[@]}" -gt 0 ] && now=$(printf '%s; ' "${problems[@]}")
before=$(cat "$STATE" 2>/dev/null || true)

send() {
    printf '%s %s\n' "$(date -u '+%F %T')" "$1" >> "$LOG"
    if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
        curl -s -m 20 -o /dev/null \
            "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" \
            --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" \
            --data-urlencode "text=$1" || echo "telegram alert failed" >> "$LOG"
    fi
    if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
        # Slack reads "text", Discord reads "content". Messages here contain no
        # quotes or backslashes.
        curl -s -m 20 -o /dev/null -H 'Content-Type: application/json' \
            -d "{\"text\":\"$1\",\"content\":\"$1\"}" "$ALERT_WEBHOOK_URL" \
            || echo "webhook alert failed" >> "$LOG"
    fi
}

if [ "$now" != "$before" ]; then
    if [ -n "$now" ]; then
        send "IVR problem on $SITE: $now"
    else
        send "IVR recovered on $SITE"
    fi
    printf '%s' "$now" > "$STATE"
fi

if [ -n "$now" ]; then
    echo "PROBLEM: $now"
    exit 1
fi
echo "all checks passed"
