#!/usr/bin/env bash
#
# Start the whole dialer locally, in one command.
#
# A dialer is not one server. The web process only serves the API and the UI;
# the calls are placed by Celery workers that beat wakes every second. Starting
# only the web process leaves jobs sitting in "running" with nothing dialing —
# which looks broken but is just the engine not started.
#
# This launches every process the dial path needs and streams their logs to
# ./run/. Stop everything with Ctrl-C.
#
#   ./scripts/dev-up.sh
#
# It does NOT start the Cloudflare tunnel (that exposes your machine, so it is
# your call) or the BFF (that lives in ../client). Both are printed at the end.

set -uo pipefail
cd "$(dirname "$0")/.."

PY=.venv/bin/python
RUN=run
mkdir -p "$RUN"
pids=()

start() {  # start <name> <command...>
  local name="$1"; shift
  echo "  starting $name"
  "$@" >"$RUN/$name.log" 2>&1 &
  pids+=($!)
}

cleanup() {
  echo
  echo "stopping…"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null; done
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo "Bringing up the dialer:"

# 1. Web — the API and the UI's data.
start web $PY manage.py runserver 127.0.0.1:8000 --noreload

# 2. Beat — the 1 Hz heartbeat that tells the pacer to tick.
start beat $PY -m celery -A config beat -l warning \
  -S django_celery_beat.schedulers:DatabaseScheduler

# 3. Workers — the three roles the dial path uses.
#    pacer   decides who to call; dispatch places the call; events ingests the
#    carrier callbacks and everything else.
start pacer    $PY -m celery -A config worker -Q pacer    -c 2 -l warning -n pacer@dev
start dispatch $PY -m celery -A config worker -Q dispatch -c 4 -l warning -n dispatch@dev
start events   $PY -m celery -A config worker \
  -Q events,telemetry,maintenance,default -c 4 -l warning -n events@dev

sleep 6
echo
echo "Up. Logs are in ./run/  (tail -f run/dispatch.log to watch calls place)."
echo
echo "Still needed, in their own terminals:"
echo "  BFF     :  cd ../client && npm run dev:bff"
echo "  Tunnel  :  ~/.local/bin/cloudflared tunnel --url http://127.0.0.1:8000"
echo "            then put its https URL in .env as PUBLIC_BASE_URL and restart this."
echo
echo "Ctrl-C here stops the web process and all workers."
wait
